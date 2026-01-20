
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

// Load already crawled user/id pairs from the output CSV
async function loadCompletedPairs(outputCsv) {
    return new Promise((resolve, reject) => {
        const completed = new Set();
        if (!fs.existsSync(outputCsv)) {
            resolve(completed);
            return;
        }
        fs.createReadStream(outputCsv)
            .pipe(parse({ columns: true, trim: true }))
            .on('data', (row) => {
                if (row.user && row.id && row.photo_url && row.photo_url !== '') {
                    completed.add(`${Number(row.id)}`);
                }
            })
            .on('end', () => resolve(completed))
            .on('error', reject);
    });
}


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


// Helper: async pool for concurrency control
async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = [];
    const executing = [];
    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item));
        ret.push(p);
        if (poolLimit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
}


(async () => {
    try {
        const cleanedOutputCsvPath = path.join(__dirname, '../data', 'flickr_photo_urls_cleaned.csv');
        const outputCsvPath = path.join(__dirname, '../data', 'flickr_photo_urls.csv');
        flickrData = await preloadCSV('data_cleaned_titles.csv');
        console.log('data_cleaned_titles.csv preloaded.');
        const completedPairs = await loadCompletedPairs(cleanedOutputCsvPath);
        console.log(`Loaded ${completedPairs.size} completed pairs from output CSV.`);

        // Filter out already completed pairs
        const toCrawl = flickrData.filter(row => {
            return row.user && row.id && !completedPairs.has(`${Number(row.id)}`);
        });
        const total = toCrawl.length;
        let processed = 0;
        let startTime = Date.now();
        const results = [];
        const FLUSH_INTERVAL = 10; // Write to disk every 10 processed items

        // Create output CSV with header if it doesn't exist and copy cleaned results over
        if (!fs.existsSync(outputCsvPath)) {
            if (fs.existsSync(cleanedOutputCsvPath)) {
                const cleanedData = fs.readFileSync(cleanedOutputCsvPath, 'utf-8');
                fs.appendFileSync(outputCsvPath, cleanedData);
                console.log('Copied cleaned results to new output CSV.');
            }
        }

        await asyncPool(4, toCrawl, async (row) => { // 4 = concurrency limit
            try {
                if (!row.user || !row.id) {
                    console.warn(`Missing user or id for row: ${JSON.stringify(row)}`);
                    return;
                }
                const photoUrl = await getFlickrPhoto(row.user, Number(row.id));
                const largerPhotoUrl = photoUrl ? photoUrl.replace('_s.', '.') : null;
                let finalPhotoUrl = photoUrl;
                if (largerPhotoUrl) {
                    const response = await fetch(largerPhotoUrl, { method: 'HEAD' });
                    if (response.ok) {
                        finalPhotoUrl = largerPhotoUrl;
                    }
                }
                results.push(`${row.user},${Number(row.id)},${finalPhotoUrl}\n`);
            } catch (err) {
                console.error(`Failed to fetch photo for photo_id ${Number(row.id)}:`, err);
            }
            processed++;
            const itemsLeft = total - processed;
            const elapsed = (Date.now() - startTime) / 1000;
            const avgTimePerItem = elapsed / processed;
            const eta = itemsLeft * avgTimePerItem;
            console.log(`Processed: ${processed}/${total} | Items left: ${itemsLeft} | ETA: ${formatTime(eta)}`);

            // Flush results to disk every FLUSH_INTERVAL processed items
            if (results.length >= FLUSH_INTERVAL) {
                fs.appendFileSync(outputCsvPath, results.join(''));
                results.length = 0; // Clear the array
                results.splice(0, results.length); // Clear the array
            }
        });
        // Final flush for any remaining results
        if (results.length > 0) {
            fs.appendFileSync(outputCsvPath, results.join(''));
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