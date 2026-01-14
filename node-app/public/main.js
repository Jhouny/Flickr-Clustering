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
  console.log(`Fetching new data for zoom ${zoom} and bbox ${bbox.toBBoxString()}`);
  clearMarkers();
  const bboxParam = `${bbox.getSouth()},${bbox.getWest()},${bbox.getNorth()},${bbox.getEast()}`;
  let url = `/data?zoom=${zoom}`;
  if (zoom > 18) {
    url += `&bbox=${bboxParam}`;
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

// Initial load
loadData();
