/* geo.js — géocodage (Nominatim/OpenStreetMap), distances et optimisation de trajet (OSRM).
   Principe : si Internet est indisponible ou qu'un service échoue, on retombe sur une
   estimation locale (distance à vol d'oiseau) — jamais de blocage de l'appli. */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_TRIP_URL = "https://router.project-osrm.org/trip/v1/driving/";
const OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving/";
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

// ---------- Optimisation d'ordre (critère : TEMPS de trajet) ----------
// Matrice de durées (min) et de distances (km) entre tous les points, via le service
// "table" d'OSRM (routes réelles). Hors ligne ou en cas d'échec : distances à vol
// d'oiseau (durée inconnue), signalé par estimated = true.
async function travelMatrix(coords) {
  const n = coords.length;
  if (navigator.onLine) {
    try {
      const coordStr = coords.map((p) => `${p.lon},${p.lat}`).join(";");
      const url = `${OSRM_TABLE_URL}${coordStr}?annotations=duration,distance`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        const ok = data.code === "Ok" && data.durations && data.distances &&
          data.durations.every((row) => row.every((v) => v != null)) &&
          data.distances.every((row) => row.every((v) => v != null));
        if (ok) {
          return {
            D: data.durations.map((row) => row.map((v) => v / 60)),
            K: data.distances.map((row) => row.map((v) => v / 1000)),
            estimated: false,
          };
        }
      }
    } catch (e) { /* repli ci-dessous */ }
  }
  const K = coords.map((a) => coords.map((b) => haversineKm(a.lat, a.lon, b.lat, b.lon)));
  return { D: K, K, estimated: true };
}

// Cherche l'ordre des clients "libres" qui minimise la somme des coûts D (temps de trajet),
// entre un début et une fin éventuellement imposés. Exact (programmation dynamique) jusqu'à
// 12 clients libres, puis plus-proche-voisin + 2-opt au-delà.
//   startIdx : indice du point de départ du premier trajet (ou -1 : début libre, gratuit)
//   endIdx   : indice du point d'arrivée du dernier trajet (ou -1 : fin libre, gratuite)
function bestOrder(D, free, startIdx, endIdx) {
  const m = free.length;
  const sCost = (i) => (startIdx >= 0 ? D[startIdx][free[i]] : 0);
  const eCost = (i) => (endIdx >= 0 ? D[free[i]][endIdx] : 0);
  if (m === 0) return [];
  if (m <= 12) {
    const FULL = 1 << m;
    const dp = Array.from({ length: FULL }, () => new Float64Array(m).fill(Infinity));
    const par = Array.from({ length: FULL }, () => new Int8Array(m).fill(-1));
    for (let i = 0; i < m; i++) dp[1 << i][i] = sCost(i);
    for (let mask = 1; mask < FULL; mask++) {
      for (let last = 0; last < m; last++) {
        const cur = dp[mask][last];
        if (cur === Infinity) continue;
        for (let nx = 0; nx < m; nx++) {
          if (mask & (1 << nx)) continue;
          const nm = mask | (1 << nx);
          const c = cur + D[free[last]][free[nx]];
          if (c < dp[nm][nx]) { dp[nm][nx] = c; par[nm][nx] = last; }
        }
      }
    }
    let bestLast = 0, best = Infinity;
    for (let i = 0; i < m; i++) {
      const c = dp[FULL - 1][i] + eCost(i);
      if (c < best) { best = c; bestLast = i; }
    }
    const seq = [];
    let mask = FULL - 1, cur = bestLast;
    while (cur !== -1) { seq.push(free[cur]); const p = par[mask][cur]; mask &= ~(1 << cur); cur = p; }
    return seq.reverse();
  }
  // Heuristique pour les grandes tournées.
  const pathCost = (seq) => {
    let c = startIdx >= 0 ? D[startIdx][seq[0]] : 0;
    for (let i = 1; i < seq.length; i++) c += D[seq[i - 1]][seq[i]];
    return c + (endIdx >= 0 ? D[seq[seq.length - 1]][endIdx] : 0);
  };
  const left = free.slice();
  const seq = [];
  let from = startIdx;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((p, i) => { const d = from >= 0 ? D[from][p] : 0; if (d < bd) { bd = d; bi = i; } });
    from = left.splice(bi, 1)[0];
    seq.push(from);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < seq.length - 1; i++) {
      for (let j = i + 1; j < seq.length; j++) {
        const cand = seq.slice(0, i).concat(seq.slice(i, j + 1).reverse(), seq.slice(j + 1));
        if (pathCost(cand) < pathCost(seq) - 1e-9) { seq.splice(0, seq.length, ...cand); improved = true; }
      }
    }
  }
  return seq;
}

// Optimisation de la tournée, avec premier et/ou dernier client éventuellement imposés.
//  - Critère : temps de trajet total (comme le GPS), pas le kilomètrage. La distance affichée
//    est celle du trajet retenu.
//  - Le trajet démarre au point de départ (domicile/GPS), sauf si un premier client est imposé :
//    il démarre alors directement chez lui (pas de trajet départ → premier client compté).
//  - Si un dernier client est imposé, la tournée s'arrête chez lui. Sinon, avec un point de
//    départ, le retour y est inclus dans l'optimisation (le dernier client est choisi en tenant
//    compte du retour).
async function optimizeTripConstrained(points, startPoint, roundtrip, forceFirstId, forceLastId) {
  const firstP = forceFirstId ? points.find((p) => p.id === forceFirstId) : null;
  const lastP = forceLastId ? points.find((p) => p.id === forceLastId) : null;
  const free = points.filter((p) => p !== firstP && p !== lastP);

  // Indices dans la matrice : points…, puis le point de départ en dernier si présent.
  const all = points.slice();
  const startIdxInAll = startPoint ? all.push(startPoint) - 1 : -1;
  const idxOf = (p) => all.indexOf(p);

  const { D, K, estimated } = await travelMatrix(all);

  const beginIdx = firstP ? idxOf(firstP) : startIdxInAll;
  let endIdx = -1;
  if (lastP) endIdx = idxOf(lastP);
  else if (roundtrip && startPoint) endIdx = startIdxInAll;

  const freeIdx = free.map(idxOf);
  const mid = bestOrder(D, freeIdx, beginIdx, endIdx);

  const orderIdx = [];
  if (firstP) orderIdx.push(idxOf(firstP));
  orderIdx.push(...mid);
  if (lastP) orderIdx.push(idxOf(lastP));

  // Totaux le long du trajet retenu.
  const route = [];
  if (startPoint && !firstP) route.push(startIdxInAll);
  route.push(...orderIdx);
  if (roundtrip && startPoint) route.push(startIdxInAll);
  let km = 0, min = 0;
  for (let i = 1; i < route.length; i++) { km += K[route[i - 1]][route[i]]; min += D[route[i - 1]][route[i]]; }

  return {
    order: orderIdx.map((i) => all[i].id),
    distanceKm: km,
    durationMin: estimated ? null : min,
    estimated,
  };
}
