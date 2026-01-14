const map = L.map('map').setView([45.757156, 4.847609], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let markers = [];

function clearMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}

function loadData() {
  clearMarkers();
  const zoom = map.getZoom();
  const bbox = map.getBounds();
  const bboxParam = `${bbox.getSouth()},${bbox.getWest()},${bbox.getNorth()},${bbox.getEast()}`;
  let url = `/data?zoom=${zoom}`;
  if (zoom > 17) {
    url += `&bbox=${bboxParam}`;
  }
  fetch(url)
    .then(res => res.json())
    .then(data => {
      data.forEach(row => {
        const lat = parseFloat(row.lat);
        const lon = parseFloat(row.long);
        if (!isNaN(lat) && !isNaN(lon)) {
          const marker = L.marker([lat, lon]).addTo(map)
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
