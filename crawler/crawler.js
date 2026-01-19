
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const puppeteer = require('puppeteer');

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
      .on('end', () => { resolve(rows); })
      .on('error', reject);
  });
};


// Preload flickr_dataset.csv at server start
let flickrData = null;

// Request original photograph from flickr.com
async function getFlickrPhoto(userId, photoId) {
    const url = `https://www.flickr.com/photos/${userId}/${photoId}`;
    console.log(`Fetching photo from URL: ${url}`);
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setRequestInterception(true);

    let imageUrl = null;
    // Listen for requests with the photoId in the URL
    page.on('request', request => {
        const reqUrl = request.url();
        if (reqUrl.includes(photoId) && (reqUrl.endsWith('.jpg') || reqUrl.endsWith('.png'))) {
            imageUrl = reqUrl;
            request.abort();  // Stop further processing
        } else {
            request.continue();
        }
    });

    await page.goto(url, { waitUntil: 'networkidle2' });

    await browser.close();
    return imageUrl; 
}

fs.appendFileSync(path.join(__dirname, '../data', 'flickr_photo_urls.csv'), 'id,user,photo_url\n');

(async () => {
    try {
        flickrData = await preloadCSV('data_cleaned_titles.csv');
        console.log('data_cleaned_titles.csv preloaded.');
        const total = flickrData.length;
        let processed = 0;
        let startTime = Date.now();
        for (const row of flickrData) {
            const itemStart = Date.now();
            try {
                if (!row.user || !row.id) {
                    console.warn(`Missing user or id for row: ${JSON.stringify(row)}`);
                    continue;
                }
                const photoUrl = await getFlickrPhoto(row.user, Number(row.id));
                // Try to fetch the photo url without the trailing '_s' to check if a larger image exists
                const largerPhotoUrl = photoUrl ? photoUrl.replace('_s.', '.') : null;
                // Make a HEAD request to check if the larger image exists
                let finalPhotoUrl = photoUrl;
                if (largerPhotoUrl) {
                    const response = await fetch(largerPhotoUrl, { method: 'HEAD' });
                    if (response.ok) {
                        finalPhotoUrl = largerPhotoUrl;
                    } // else keep the original small photo URL
                }
                // Save the url to a new CSV along with its photo and user IDs
                const outputLine = `${row.user},${Number(row.id)},${finalPhotoUrl}\n`;
                fs.appendFileSync(path.join(__dirname, '../data', 'flickr_photo_urls.csv'), outputLine);
            } catch (err) {
                console.error(`Failed to fetch photo for photo_id ${Number(row.id)}:`, err);
            }
            processed++;
            const itemsLeft = total - processed;
            const elapsed = (Date.now() - startTime) / 1000; // seconds
            const avgTimePerItem = elapsed / processed;
            const eta = itemsLeft * avgTimePerItem; // seconds
            // Show progress and ETA in console
            console.log(`Processed: ${processed}/${total} | Items left: ${itemsLeft} | ETA: ${formatTime(eta)}`);
        }
    } catch (err) {
        console.error('Failed to preload data_cleaned_titles.csv:', err);
    }
})();

// Helper to format seconds as HH:MM:SS
function formatTime(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}