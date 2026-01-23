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
const icon = L.icon({
    iconUrl: 'https://images.emojiterra.com/google/noto-emoji/unicode-16.0/color/512px/1f4cd.png',
    iconSize: [25, 25],
    shadowUrl: null,
});
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
  let url = `/data?zoom=${zoom}`;
  if (zoom > 17) {
    url += `&bbox=${bboxParam}`;
  } else {
    url += `&algorithm=${document.getElementById('algorithm').value}`;
  }
  fetch(url)
    .then(res => res.json())
    .then(data => {
      data.forEach(row => {
        const lat = parseFloat(row.lat);
        const lon = parseFloat(row.long);
        if (!isNaN(lat) && !isNaN(lon)) {
          const marker = L.marker([lat, lon], { icon: icon }).addTo(map)
            .bindPopup(Object.entries(row).map(([k, v]) => `<b>${k}</b>: ${v}`).join('<br>'));
          markers.push(marker);
        }
      });
    });
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
