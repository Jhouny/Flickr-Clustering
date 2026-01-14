
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
        resolve(rows);
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
        const [south, west, north, east] = bbox;
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
  fs.createReadStream(csvPath)
    .pipe(parse({ columns: true, trim: true }))
    .on('data', (row) => {
      results.push(row);
    })
    .on('end', () => {
      // Sort by n_points descending (convert to number)
      results.sort((a, b) => (parseInt(b.n_points, 10) || 0) - (parseInt(a.n_points, 10) || 0));
      let limit = 5;
      if (zoom >= 5 && zoom < 10) limit = 10;
      else if (zoom >= 10 && zoom <= minZoomDetail) limit = 15;
      // For zoom > minZoomDetail, show all
      const filtered = results.slice(0, limit);
      res.json(filtered);
    })
    .on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
