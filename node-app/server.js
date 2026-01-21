
const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

const app = express();
const PORT = 3000;
app.use(express.static(path.join(__dirname, 'public')));

// Preload and sort large dataset (e.g., flickr_dataset.csv)
const preloadCSV = (csvFile) => {
  return new Promise((resolve, reject) => {
    const csvPath = path.join(__dirname, '../data', csvFile);
    const rows = [];
    fs.createReadStream(csvPath)
      .pipe(parse({ columns: true, trim: true }))
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', () => {
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
        const threshold = 0.0003;
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

// Preload flickr_dataset.csv at server start
let flickrData = null;
preloadCSV('data_cleaned_titles.csv').then(data => {
    flickrData = data;
    
    console.log('data_cleaned_titles.csv preloaded and sorted.');
}).catch(err => {
    console.error('Failed to preload data_cleaned_titles.csv:', err);
});

const minZoomDetail = 17;
app.get('/data', (req, res) => {
  if (!req.query.zoom) {
    return res.status(400).json({ error: 'Missing zoom parameter' });
  }
  if (!req.query.bbox && parseInt(req.query.zoom, 10) > minZoomDetail) {
    return res.status(400).json({ error: `Missing bbox parameter for zoom levels > ${minZoomDetail}` });
  }
  const zoom = parseInt(req.query.zoom, 10) || 0;
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
        return res.json(filteredData);
    }
    return res.json([]);
  }
  // Otherwise, load and serve the clustered dataset, ordered and filtered by n_points and zoom
  const csvPath = path.join(__dirname, '../data', 'centroids.csv');
  const results = [];
  const algorithm = (req.query.algorithm || 'kmean').toLowerCase();
  fs.createReadStream(csvPath)
    .pipe(parse({ columns: true, trim: true }))
    .on('data', (row) => {
      results.push(row);
    })
    .on('end', () => {
      // Filter by algorithm
      const filteredByAlgorithm = results.filter(row => row.algo === algorithm);
      // Sort by n_points descending (convert to number)
      filteredByAlgorithm.sort((a, b) => (parseInt(b.n_points, 10) || 0) - (parseInt(a.n_points, 10) || 0));
      res.json(filteredByAlgorithm);
    })
    .on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
});

// Retrieve photo URL from the indexed CSV
async function getPhotoURL(userId, photoId) {
    const url = `https://www.flickr.com/photos/${userId}/${photoId}`;
    let imageUrl = null;
    // Find the photo in the preloaded flickrData
    for (const row of flickrData) {
        if (row.user_id === userId && row.photo_id === photoId) {
            imageUrl = row.image_url;
            break;
        }
    }
    return imageUrl; 
}

app.get('/photo', async (req, res) => {
    const { userId, photoId } = req.query;
    if (!userId || !photoId) {
        return res.status(400).json({ error: 'Missing userId or photoId parameter' });
    }
    try {
        const imageUrl = await getPhotoURL(userId, photoId);
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
