/* geo.js — géocodage (Nominatim/OpenStreetMap), distances et optimisation de trajet (OSRM).
   Principe : si Internet est indisponible ou qu'un service échoue, on retombe sur une
   estimation locale (distance à vol d'oiseau) — jamais de blocage de l'appli. */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_TRIP_URL = "https://router.project-osrm.org/trip/v1/driving/";

// File d'attente simple : Nominatim demande max ~1 requête/seconde.
let geocodeQueueTail = Promise.resolve();
function queueGeocode(fn) {
  const run = geocodeQueueTail.then(fn);
  geocodeQueueTail = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

async function geocodeAddress(address) {
  if (!address || !address.trim() || !navigator.onLine) return null;
  return queueGeocode(async () => {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=fr&q=${encodeURIComponent(address)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "Accept-Language": "fr" } });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data[0]) return null;
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    } catch (e) {
      clearTimeout(t);
      return null;
    }
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Heuristique plus-proche-voisin — repli hors ligne ou si OSRM échoue.
function nearestNeighborOrder(points, startPoint) {
  const remaining = points.slice();
  const ordered = [];
  let current = startPoint;
  if (!current) { current = remaining.shift(); ordered.push(current); }
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((p, i) => {
      const d = haversineKm(current.lat, current.lon, p.lat, p.lon);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    current = remaining.splice(bestIdx, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

async function optimizeTrip(points, startPoint, roundtrip) {
  // points: [{ id, lat, lon }] — clients du jour. startPoint: { lat, lon } | null.
  // Retourne { order: [id,...], distanceKm, durationMin|null, estimated }
  if (navigator.onLine) {
    try {
      const allCoords = startPoint ? [startPoint, ...points] : points;
      const coordStr = allCoords.map((p) => `${p.lon},${p.lat}`).join(";");
      const url = `${OSRM_TRIP_URL}${coordStr}?source=first&roundtrip=${roundtrip ? "true" : "false"}&overview=false`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        if (data.code === "Ok" && data.trips && data.trips[0]) {
          const offset = startPoint ? 1 : 0;
          const clientWps = data.waypoints.slice(offset).map((w, i) => ({ id: points[i].id, idx: w.waypoint_index }));
          clientWps.sort((a, b) => a.idx - b.idx);
          return {
            order: clientWps.map((w) => w.id),
            distanceKm: data.trips[0].distance / 1000,
            durationMin: data.trips[0].duration / 60,
            estimated: false,
          };
        }
      }
    } catch (e) { /* repli ci-dessous */ }
  }

  const ordered = nearestNeighborOrder(points, startPoint);
  let dist = 0;
  let prev = startPoint || ordered[0];
  const seq = startPoint ? ordered : ordered.slice(1);
  for (const p of seq) { dist += haversineKm(prev.lat, prev.lon, p.lat, p.lon); prev = p; }
  if (roundtrip && startPoint) dist += haversineKm(prev.lat, prev.lon, startPoint.lat, startPoint.lon);
  return { order: ordered.map((p) => p.id), distanceKm: dist, durationMin: null, estimated: true };
}
