const map = L.map('map').setView([45.757156, 4.847609], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  maxNativeZoom:19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let markers = [];

function clearMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}

let lastBbox = null;

function createColoredIcon(color) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='25' height='25' viewBox='0 0 25 25'>
      <circle cx='12.5' cy='12.5' r='10' fill='${color}' stroke='black' stroke-width='2'/>
      <circle cx='12.5' cy='12.5' r='5' fill='white' />
    </svg>`;
    return L.icon({
        iconUrl: 'data:image/svg+xml;base64,' + btoa(svg),
        iconSize: [25, 25],
        shadowUrl: null,
    });
}
function loadData() {
  const zoom = map.getZoom();
  const bbox = map.getBounds();
  if (!lastBbox) { lastBbox = bbox; }
  else {  // Check if bbox has changed significantly
    const latDiff = Math.abs(bbox.getNorth() - lastBbox.getNorth())
    const lonDiff = Math.abs(bbox.getEast() - lastBbox.getEast());
    if ((zoom == 18 && latDiff < 0.002 && lonDiff < 0.002) || 
        (zoom == 19 && latDiff < 0.001 && lonDiff < 0.001) ||
        (zoom >= 20 && latDiff < 0.001 && lonDiff < 0.001)
    ) { return; }
  }
  lastBbox = bbox;
  clearMarkers();
  const bboxParam = `${bbox.getSouth()},${bbox.getWest()},${bbox.getNorth()},${bbox.getEast()}`;
  let url = `/data?zoom=${zoom}&algorithm=${document.getElementById('algorithm').value}`;
  if (zoom > 17) {
    url += `&bbox=${bboxParam}`;
    fetch(url)
        .then(res => res.json())
        .then(data => {
        data.forEach(row => {
            const lat = parseFloat(row.lat);
            const lon = parseFloat(row.long);
            if (!isNaN(lat) && !isNaN(lon)) {
                const marker = L.marker([lat, lon], { icon: createColoredIcon(row.color) }).addTo(map)
                .bindPopup(Object.entries(row).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>'));
                markers.push(marker);
            }
        });
    });
  } else {
    fetch(url)
        .then(res => res.json())
        .then(data => {
            // Data contains (cluster_id, list([point_lat, point_lon], ...))
            data.forEach(row => {
                const cluster_id = row.cluster_id;
                console.log(cluster_id);
                if (!row.convex_hull) { return; }
                let points;
                try {
                    points = JSON.parse(row.convex_hull);
                } catch (e) {
                    console.error('Error parsing convex_hull for cluster_id', cluster_id, e);
                    return;
                }
                if (points && points.length >= 3) {
                    const latlngs = points.map(pt => [pt[0], pt[1]]);
                    const polygon = L.polygon(latlngs, { color: row.color, weight: 1, fillOpacity: 0.25 }).addTo(map)
                    .bindPopup(`<b>Cluster ID</b>: ${cluster_id}<br>`);
                    markers.push(polygon);
                } else if (points && points.length > 0) {
                    // If less than 3 points, just plot them as markers
                    points.forEach(pt => {
                        const lat = pt[0];
                        const lon = pt[1];
                        const marker = L.marker([lat, lon], { icon: createColoredIcon(row.color) }).addTo(map)
                        .bindPopup(`<b>Cluster ID</b>: ${cluster_id}<br>`);
                        markers.push(marker);
                    });
                }
            });
        });
  }
}

map.on('zoomend', loadData);
map.on('moveend', loadData);

// Reload data when clustering algorithm changes
document.getElementById('algorithm').addEventListener('change', () => { loadData(); });

// Popup on marker click will request original photo from flickr
map.on('popupopen', function(e) {
    // Retrieve userId and photoId from popup content
    const popupContent = e.popup.getContent();
    const userIdMatch = popupContent.match(/<b>user<\/b>:\s*(\d+)@N*(\d+)/);
    const photoIdMatch = popupContent.match(/<b>id<\/b>:\s*(\d+)/);
    if (userIdMatch && photoIdMatch) {
        const userId = userIdMatch[1] + '@N' + userIdMatch[2];
        const photoId = photoIdMatch[1];
        fetch(`/photo?userId=${userId}&photoId=${photoId}`)
            .then(res => res.json())
            .then(data => {
                if (data.imageUrl) {
                    document.getElementById('photo-container').innerHTML = `<img src="${data.imageUrl}" alt="Photo" style="max-width:100%;">`;
                } else {
                    document.getElementById('photo-container').innerHTML = '<img src="static/no-image-icon-23485.png" alt="No image available"/>';
                }
            });
    }
});

// Zoom-in photo overlay
document.getElementById('photo-embed').addEventListener('click', (e) => {
    const phEmb = document.getElementById('photo-embed');
    if (phEmb.classList.contains('overlay')) {
        phEmb.classList.remove('overlay');
        document.getElementById('photo-container').classList.remove('overlay');
    } else {
        if (phEmb.innerHTML.trim() === '' || phEmb.innerHTML.includes('no-image-icon-23485.png')) {
            return; // Do not activate overlay if no image is present
        }
        phEmb.classList.add('overlay');
        document.getElementById('photo-container').classList.add('overlay');
    }
});

// Toggle overlay if clicked outside image
document.addEventListener('click', (e) => {
    const target = e.target;
    const phEmb = document.getElementById('photo-embed');
    if (!phEmb.contains(target) && phEmb.classList.contains('overlay')) {
        phEmb.classList.remove('overlay');
        document.getElementById('photo-container').classList.remove('overlay');
    }
});

document.getElementById('photo-embed').addEventListener('mouseover', (e) => {
    if (document.getElementById('photo-embed').innerHTML.trim() === '' || document.getElementById('photo-embed').innerHTML.includes('no-image-icon-23485.png')) {
        return; // Do not change cursor if no image is present
    }
    document.getElementById('photo-embed').style.cursor = 'zoom-in';
});

// Initial load
loadData();
