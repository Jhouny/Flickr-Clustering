
const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { get } = require('http');

const app = express();
const PORT = 3001;
app.use(express.static(path.join(__dirname, 'public')));

// Preload and sort large dataset (e.g., flickr_dataset.csv)
const preloadCSV = (csvFile, filter=true) => {
  return new Promise((resolve, reject) => {
    const csvPath = path.join(__dirname, '../data', csvFile);
    const rows = [];
    fs.createReadStream(csvPath)
      .pipe(parse({ columns: true, trim: true }))
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
        if (!filter) { return resolve(rows); }

        // Sort by latitude, then longitude
        rows.sort((a, b) => {
          const latA = parseFloat(a['lat']);
          const latB = parseFloat(b['lat']);
          if (latA !== latB) return latA - latB;
          const lonA = parseFloat(a['long']);
          const lonB = parseFloat(b['long']);
          return lonA - lonB;
        });
        // Merge points that are extremely close (within ~10 meters)
        const mergedRows = [];
        const threshold = 0.0006;
        for (let i = 0; i < rows.length; i++) {
            const current = rows[i];
            const latCurrent = parseFloat(current['lat']);
            const lonCurrent = parseFloat(current['long']);
            if (mergedRows.length === 0) {
                mergedRows.push(current);
            } else {
                const last = mergedRows[mergedRows.length - 1];
                const latLast = parseFloat(last['lat']);
                const lonLast = parseFloat(last['long']);
                if (Math.abs(latCurrent - latLast) < threshold && Math.abs(lonCurrent - lonLast) < threshold) {
                    continue;
                } else {
                    mergedRows.push(current);
                }
            }
        }
        resolve(mergedRows);
      })
      .on('error', reject);
  });
};


// Preload CSVs in order using an async IIFE
let flickrData = null;
let clusterData = {};
let results = {};
(async () => {
    try {
        flickrData = await preloadCSV('data_cleaned_titles.csv');
        console.log('data_cleaned_titles.csv preloaded and sorted.');

        const predictions = await preloadCSV('predictions.csv', false);
        predictions.forEach(row => {
            clusterData[row.id] = {
                kmean: row.kmean,
                dbscan: row.dbscan,
                hdbscan: row.hdbscan
            };
        });
        console.log('predictions.csv preloaded.');
        
        const kmeanHulls = await preloadCSV('kmean_convex_hulls.csv', false);
        kmeanHulls.forEach(row => {
            results[`kmean_${row.cluster_id}`] = {
                convex_hull: row.convex_hull,
                color: getColor(row.cluster_id)
            };
        });
        const dbscanHulls = await preloadCSV('dbscan_convex_hulls.csv', false);
        dbscanHulls.forEach(row => {
            results[`dbscan_${row.cluster_id}`] = {
                convex_hull: row.convex_hull,
                color: getColor(row.cluster_id)
            };
        });
        const hdbscanHulls = await preloadCSV('hdbscan_convex_hulls.csv', false);
        hdbscanHulls.forEach(row => {
            results[`hdbscan_${row.cluster_id}`] = {
                convex_hull: row.convex_hull,
                color: getColor(row.cluster_id)
            };
        });
        console.log('Convex hull CSVs preloaded.');

        // Preload cluster descriptions
        const kmeanDesc = await preloadCSV('cluster_descriptions_kmean.csv', false);
        kmeanDesc.forEach(row => {
            if (results[`kmean_${row.cluster}`]) {
                let description = row.words.split(' ').slice(0, 5).join(', ');
                results[`kmean_${row.cluster}`].description = description;
            }
        });
        const dbscanDesc = await preloadCSV('cluster_descriptions_dbscan.csv', false);
        dbscanDesc.forEach(row => {
            if (results[`dbscan_${row.cluster}`]) {
                let description = row.words.split(' ').slice(0, 5).join(', ');
                results[`dbscan_${row.cluster}`].description = description;
            }
        });
        const hdbscanDesc = await preloadCSV('cluster_descriptions_hdbscan.csv', false);
        hdbscanDesc.forEach(row => {
            if (results[`hdbscan_${row.cluster}`]) {
                let description = row.words.split(' ').slice(0, 5).join(', ');
                results[`hdbscan_${row.cluster}`].description = description;
            }
        });
        console.log('Cluster descriptions preloaded.');
    } catch (err) {
        console.error('Failed to preload CSVs:', err);
    }
})();

// Create color mapping for clusters and markers
function getColor(clusterId) {
    const colors = ['red', 'blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'yellow', 'brown', 'pink'];  // Must be usable in Leaflet markers
    return colors[Number(clusterId) % colors.length];
}

// Endpoint to get data based on zoom level and bounding box
const minZoomDetail = 17;
app.get('/data', (req, res) => {
  if (!req.query.zoom) { return res.status(400).json({ error: 'Missing zoom parameter' }); }
  if (!req.query.bbox && parseInt(req.query.zoom, 10) > minZoomDetail) { return res.status(400).json({ error: `Missing bbox parameter for zoom levels > ${minZoomDetail}` }); }

  const zoom = parseInt(req.query.zoom, 10) || 3;
  if (zoom > minZoomDetail) {  // Load data in the view window only for high zoom levels
    const bbox = req.query.bbox ? req.query.bbox.split(',').map(parseFloat) : null;
    if (bbox && bbox.length === 4) {
        let [south, west, north, east] = bbox;
        // Pad the bbox slightly to reduce endpoint calls
        const padAmount = 0.001;
        south -= padAmount;
        west -= padAmount;
        north += padAmount;
        east += padAmount;
        const filteredData = flickrData.filter(row => {
            const lat = parseFloat(row.lat);
            const lon = parseFloat(row.long);
            return lat >= south && lat <= north && lon >= west && lon <= east;
        });
        // Add color info based on clustering
        const algorithm = (req.query.algorithm || 'kmean').toLowerCase();
        filteredData.forEach(row => {
            const clusterInfo = clusterData[row.id];
            if (clusterInfo) {
                row.color = getColor(clusterInfo[algorithm]);
            }
        });
        return res.json(filteredData);
    }
    return res.json([]);
  }
  // Otherwise, load and serve the clustered dataset, ordered and filtered by n_points and zoom
  const algorithm = (req.query.algorithm || 'kmean').toLowerCase();
  if (!['kmean', 'dbscan', 'hdbscan'].includes(algorithm)) { return res.status(400).json({ error: 'Invalid algorithm parameter' }); }

    const clusteredResults = [];
    try {
        for (const key in results) {
            if (key.startsWith(algorithm)) {
                const cluster_id = key.split('_')[1];
                clusteredResults.push({
                    cluster_id: cluster_id,
                    convex_hull: results[key].convex_hull,
                    color: results[key].color,
                    description: results[key].description || ''
                });
            }
        }
        return res.json(clusteredResults);
    } catch (err) {
        console.error('Error processing clustered results:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Load image URLs from crawled flickr dataset
let photoURLs = {};
fs.createReadStream(path.join(__dirname, '../data', 'flickr_photo_urls_cleaned.csv'))
  .pipe(parse({ columns: true, trim: true }))
  .on('data', (row) => {
    const key = `${row.user}_${Number(row.id)}`;
    photoURLs[key] = row.photo_url;
  });

app.get('/photo', async (req, res) => {
    const { userId, photoId } = req.query;
    if (!userId || !photoId) {
        return res.status(400).json({ error: 'Missing userId or photoId parameter' });
    }
    try {
        const key = `${userId}_${Number(photoId)}`;
        const imageUrl = photoURLs[key];
        if (imageUrl) {
            res.json({ imageUrl });
        } else {
            res.status(404).json({ error: 'Photo not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
