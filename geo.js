/* geo.js — géocodage (Nominatim/OpenStreetMap), distances et optimisation de trajet (OSRM).
   Principe : si Internet est indisponible ou qu'un service échoue, on retombe sur une
   estimation locale (distance à vol d'oiseau) — jamais de blocage de l'appli. */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_TRIP_URL = "https://router.project-osrm.org/trip/v1/driving/";
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";

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

// Distance et durée routières entre deux points (service "route" d'OSRM).
async function osrmRoadLeg(a, b) {
  if (!navigator.onLine) return null;
  try {
    const url = `${OSRM_ROUTE_URL}${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes || !data.routes[0]) return null;
    return { km: data.routes[0].distance / 1000, min: data.routes[0].duration / 60 };
  } catch (e) {
    return null;
  }
}

// Optimisation avec un point de départ fixe (first) et/ou d'arrivée fixe (last), le tout
// calculé sur le réseau routier réel : OSRM sait fixer le premier et le dernier point
// (source=first / destination=last), il optimise l'ordre de tout ce qui est entre les deux.
// Retourne null si le service est indisponible (l'appelant retombe alors sur l'estimation).
async function osrmConstrainedTrip(anchor, middle, end) {
  if (!navigator.onLine) return null;
  const coords = [...(anchor ? [anchor] : []), ...middle, ...(end ? [end] : [])];
  if (coords.length < 2) return null;
  try {
    const coordStr = coords.map((p) => `${p.lon},${p.lat}`).join(";");
    const source = anchor ? "first" : "any";
    const destination = end ? "last" : "any";
    const url = `${OSRM_TRIP_URL}${coordStr}?source=${source}&destination=${destination}&roundtrip=false&overview=false`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok" || !data.trips || !data.trips[0]) return null;
    const offset = anchor ? 1 : 0;
    const mid = data.waypoints.slice(offset, offset + middle.length).map((w, i) => ({ id: middle[i].id, idx: w.waypoint_index }));
    mid.sort((a, b) => a.idx - b.idx);
    return {
      middleOrder: mid.map((m) => m.id),
      distanceKm: data.trips[0].distance / 1000,
      durationMin: data.trips[0].duration / 60,
    };
  } catch (e) {
    return null;
  }
}

// Variante avec premier et/ou dernier client imposés.
// Si un premier client est imposé, le trajet démarre directement chez lui (pas de détour
// par le point de départ). Le retour au point de départ, lui, reste compté.
async function optimizeTripConstrained(points, startPoint, roundtrip, forceFirstId, forceLastId) {
  const remaining = points.slice();
  let forcedFirst = null, forcedLast = null;

  if (forceFirstId) {
    const idx = remaining.findIndex((p) => p.id === forceFirstId);
    if (idx !== -1) forcedFirst = remaining.splice(idx, 1)[0];
  }
  if (forceLastId) {
    const idx = remaining.findIndex((p) => p.id === forceLastId);
    if (idx !== -1) forcedLast = remaining.splice(idx, 1)[0];
  }

  if (!forcedFirst && !forcedLast) {
    return optimizeTrip(points, startPoint, roundtrip);
  }

  const anchor = forcedFirst || startPoint;
  const byId = Object.fromEntries(points.map((p) => [p.id, p]));
  let middleOrder, distanceKm, durationMin = null, estimated = false;

  const trip = await osrmConstrainedTrip(anchor, remaining, forcedLast);
  if (trip) {
    middleOrder = trip.middleOrder;
    distanceKm = trip.distanceKm;
    durationMin = trip.durationMin;
  } else if (!anchor && !forcedLast) {
    middleOrder = remaining.map((p) => p.id);
    distanceKm = 0;
  } else {
    // Repli hors ligne : plus proche voisin + distances à vol d'oiseau.
    estimated = true;
    const ordered = remaining.length ? nearestNeighborOrder(remaining, anchor) : [];
    middleOrder = ordered.map((p) => p.id);
    distanceKm = 0;
    let prev = anchor;
    for (const p of ordered) { if (prev) distanceKm += haversineKm(prev.lat, prev.lon, p.lat, p.lon); prev = p; }
    if (forcedLast && prev) distanceKm += haversineKm(prev.lat, prev.lon, forcedLast.lat, forcedLast.lon);
  }

  const order = [];
  if (forcedFirst) order.push(forcedFirst.id);
  order.push(...middleOrder);
  if (forcedLast) order.push(forcedLast.id);

  // Retour au point de départ, lui aussi sur route réelle.
  if (roundtrip && startPoint) {
    const lastPoint = byId[order[order.length - 1]];
    if (lastPoint) {
      const leg = await osrmRoadLeg(lastPoint, startPoint);
      if (leg) {
        distanceKm += leg.km;
        durationMin = durationMin != null ? durationMin + leg.min : null;
      } else {
        distanceKm += haversineKm(lastPoint.lat, lastPoint.lon, startPoint.lat, startPoint.lon);
        durationMin = null;
        estimated = true;
      }
    }
  }

  return { order, distanceKm, durationMin, estimated };
}
