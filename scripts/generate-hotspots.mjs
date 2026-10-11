/** One-time API seed curation: emit JSON to stdout; never save credentials or road graphs. */
import { NCR_PLACES } from '../dist/modules/packages/data/src/ncr.js';
const key = process.env.ORS_API_KEY?.trim();
if (!key) throw new Error('Configure server ORS_API_KEY before curating road-snapped seeds.');
let state = 0x502026;
function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }
function offset(coords, radius) {
  const angle = random() * Math.PI * 2; const metres = Math.sqrt(random()) * radius;
  return [coords[0] + Math.sin(angle) * metres / 111320, coords[1] + Math.cos(angle) * metres / (111320 * Math.cos(coords[0] * Math.PI / 180))];
}
function distance(a, b) { return Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180)); }
const regions = [
  { name: 'Gurugram', count: 150, places: NCR_PLACES.filter(p => p.id.startsWith('ggn-') || ['gurugram', 'cyber-city', 'manesar', 'sohna'].includes(p.id)), radius: 4500 },
  { name: 'Delhi', count: 130, places: NCR_PLACES.filter(p => p.name.includes('Delhi') || ['cp', 'ito', 'india-gate', 'dwarka', 'rohini', 'saket', 'lajpat', 'karol-bagh', 'anand-vihar', 'nizamuddin', 'nehru-place'].includes(p.id)), radius: 7000 },
  { name: 'Noida', count: 70, places: NCR_PLACES.filter(p => ['noida', 'noida-62', 'noida-18', 'noida-137'].includes(p.id)), radius: 6000 },
  { name: 'Greater Noida', count: 45, places: NCR_PLACES.filter(p => ['greater-noida', 'pari-chowk'].includes(p.id)), radius: 6500 },
  { name: 'Ghaziabad', count: 45, places: NCR_PLACES.filter(p => ['ghaziabad', 'indira', 'vaishali', 'crossings'].includes(p.id)), radius: 6500 },
  { name: 'Faridabad and outer NCR', count: 60, places: NCR_PLACES.filter(p => ['faridabad', 'bahadurgarh', 'sonipat', 'meerut', 'hapur', 'palwal', 'rohtak', 'rewari', 'panipat', 'karnal', 'jind', 'bhiwani', 'dadri', 'mahendragarh', 'nuh', 'jhajjar', 'baghpat', 'bulandshahr', 'shamli', 'muzaffarnagar', 'alwar', 'bharatpur'].includes(p.id)), radius: 4000 },
];
let metadata;
async function snap(points) {
  const result = [];
  for (let start = 0; start < points.length; start += 4000) {
    const response = await fetch('https://api.openrouteservice.org/v2/snap/driving-car/json', { method: 'POST',
      headers: { Authorization: key, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ locations: points.slice(start, start + 4000).map(p => [p[1], p[0]]), radius: 350 }) });
    if (!response.ok) throw new Error(`Road snapping rejected (HTTP ${response.status}); no catalogue emitted.`);
    const body = await response.json();
    if (!Array.isArray(body.locations) || body.locations.length !== Math.min(4000, points.length - start)) throw new Error('Invalid snapping response.');
    metadata = body.metadata;
    result.push(...body.locations.map(p => p && ({ coords: [p.location[1], p.location[0]], road: p.name || 'Unnamed road' })));
    console.error(`Road-snapped batch ${start + 1}-${Math.min(start + 4000, points.length)} / ${points.length}`);
  }
  return result;
}
const anchors = [];
for (const region of regions) {
  if (!region.places.length) throw new Error('Missing region shortcuts.');
  const attempts = Array.from({ length: region.count * 5 }, (_, index) => {
    const place = region.places[index % region.places.length];
    return { place, coords: offset(place.coords, region.radius) };
  });
  const roads = await snap(attempts.map(p => p.coords));
  let count = 0;
  for (let i = 0; i < roads.length && count < region.count; i++) {
    const road = roads[i]; if (!road || anchors.some(a => distance(a.coords, road.coords) < 650)) continue;
    anchors.push({ id: `hotspot-${anchors.length + 1}`, region: region.name, name: `${road.road}, ${region.name}`,
      coords: road.coords, cases: 6 + Math.floor(random() * 15) }); count++;
  }
  if (count !== region.count) throw new Error(`Insufficient separated road anchors for ${region.name}; no catalogue emitted.`);
}
anchors[0].cases = 6; anchors[1].cases = 20;
const requests = anchors.flatMap(anchor => Array.from({ length: anchor.cases * 3 }, () => offset(anchor.coords, 240)));
const roads = await snap(requests);
let cursor = 0;
const hotspots = anchors.map(anchor => {
  const unique = [];
  for (const road of roads.slice(cursor, cursor + anchor.cases * 3)) {
    if (road && distance(road.coords, anchor.coords) <= 480 && !unique.some(p => distance(p, road.coords) < 2)) unique.push(road.coords);
    if (unique.length === anchor.cases) break;
  }
  cursor += anchor.cases * 3;
  if (unique.length !== anchor.cases) throw new Error(`Insufficient unique road-snapped cases at ${anchor.id}; no catalogue emitted.`);
  return { id: anchor.id, name: anchor.name, region: anchor.region, coords: anchor.coords, cases: unique };
});
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), provider: 'OpenRouteService snap/driving-car',
  graphDate: metadata?.engine?.graph_date ?? 'Provider-managed', attribution: metadata?.attribution, hotspots }));
