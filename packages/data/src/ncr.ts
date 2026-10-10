import type { Place, Spot } from '@paanipath/domain';
import { PLACES } from './pilot.ts';
import { GURUGRAM_PLACES, seedGurugramSpots } from './gurugram.ts';

/** City/landmark shortcuts; online search supplies actual addresses and POIs. */
const NCR_BASE_PLACES: readonly Place[] = [...PLACES,
  { id: 'noida', name: 'Noida, Uttar Pradesh', coords: [28.5708, 77.3261] },
  { id: 'greater-noida', name: 'Greater Noida, Uttar Pradesh', coords: [28.4744, 77.5030] },
  { id: 'gurugram', name: 'Gurugram (Gurgaon), Haryana', coords: [28.4595, 77.0266] },
  { id: 'ghaziabad', name: 'Ghaziabad, Uttar Pradesh', coords: [28.6692, 77.4538] },
  { id: 'faridabad', name: 'Faridabad, Haryana', coords: [28.4089, 77.3178] },
  { id: 'dwarka', name: 'Dwarka, Delhi', coords: [28.5921, 77.0460] },
  { id: 'rohini', name: 'Rohini, Delhi', coords: [28.7383, 77.0822] },
  { id: 'saket', name: 'Saket, Delhi', coords: [28.5246, 77.2066] },
  { id: 'lajpat', name: 'Lajpat Nagar, Delhi', coords: [28.5677, 77.2433] },
  { id: 'karol-bagh', name: 'Karol Bagh, Delhi', coords: [28.6514, 77.1907] },
  { id: 'anand-vihar', name: 'Anand Vihar, Delhi', coords: [28.6469, 77.3160] },
  { id: 'nizamuddin', name: 'Nizamuddin, Delhi', coords: [28.5899, 77.2540] },
  { id: 'nehru-place', name: 'Nehru Place, Delhi', coords: [28.5494, 77.2519] },
  { id: 'noida-62', name: 'Sector 62, Noida', coords: [28.6271, 77.3736] },
  { id: 'noida-18', name: 'Sector 18, Noida', coords: [28.5707, 77.3211] },
  { id: 'noida-137', name: 'Sector 137, Noida', coords: [28.5065, 77.4094] },
  { id: 'pari-chowk', name: 'Pari Chowk, Greater Noida', coords: [28.4651, 77.5107] },
  { id: 'indira', name: 'Indirapuram, Ghaziabad', coords: [28.6415, 77.3695] },
  { id: 'vaishali', name: 'Vaishali, Ghaziabad', coords: [28.6446, 77.3393] },
  { id: 'crossings', name: 'Crossings Republik, Ghaziabad', coords: [28.6257, 77.4388] },
  { id: 'cyber-city', name: 'DLF Cyber City, Gurugram', coords: [28.4950, 77.0895] },
  { id: 'sohna', name: 'Sohna, Haryana', coords: [28.2475, 77.0650] },
  { id: 'manesar', name: 'Manesar, Haryana', coords: [28.3540, 76.9370] },
  { id: 'bahadurgarh', name: 'Bahadurgarh, Haryana', coords: [28.6929, 76.9355] },
  { id: 'sonipat', name: 'Sonipat, Haryana', coords: [28.9931, 77.0151] },
  { id: 'meerut', name: 'Meerut, Uttar Pradesh', coords: [28.9845, 77.7064] },
  { id: 'hapur', name: 'Hapur, Uttar Pradesh', coords: [28.7306, 77.7759] },
  { id: 'palwal', name: 'Palwal, Haryana', coords: [28.1487, 77.3320] },
  { id: 'rohtak', name: 'Rohtak, Haryana', coords: [28.8955, 76.6066] },
  { id: 'rewari', name: 'Rewari, Haryana', coords: [28.1989, 76.6193] },
  { id: 'panipat', name: 'Panipat, Haryana', coords: [29.3909, 76.9635] },
  { id: 'karnal', name: 'Karnal, Haryana', coords: [29.6857, 76.9905] },
  { id: 'jind', name: 'Jind, Haryana', coords: [29.3158, 76.3150] },
  { id: 'bhiwani', name: 'Bhiwani, Haryana', coords: [28.7990, 76.1335] },
  { id: 'dadri', name: 'Charkhi Dadri, Haryana', coords: [28.5910, 76.2711] },
  { id: 'mahendragarh', name: 'Mahendragarh, Haryana', coords: [28.2734, 76.1401] },
  { id: 'nuh', name: 'Nuh, Haryana', coords: [28.1024, 77.0019] },
  { id: 'jhajjar', name: 'Jhajjar, Haryana', coords: [28.6063, 76.6565] },
  { id: 'baghpat', name: 'Baghpat, Uttar Pradesh', coords: [28.9449, 77.2187] },
  { id: 'bulandshahr', name: 'Bulandshahr, Uttar Pradesh', coords: [28.4069, 77.8498] },
  { id: 'shamli', name: 'Shamli, Uttar Pradesh', coords: [29.4497, 77.3130] },
  { id: 'muzaffarnagar', name: 'Muzaffarnagar, Uttar Pradesh', coords: [29.4727, 77.7085] },
  { id: 'alwar', name: 'Alwar, Rajasthan', coords: [27.5530, 76.6346] },
  { id: 'bharatpur', name: 'Bharatpur, Rajasthan', coords: [27.2152, 77.4928] },
];
export const NCR_PLACES: readonly Place[] = [...NCR_BASE_PLACES, ...GURUGRAM_PLACES];
export const SEED_VERSION = 'api-gurugram-v2';

/** Simulated observations near saved places; not surveyed flood reports or road-snapped pins. */
export function seedApiSpots(now: number): Spot[] {
  const general = NCR_BASE_PLACES.flatMap((place, index) => Array.from({ length: 4 }, (_item, offset) => {
    const coords = [place.coords[0] + offset * .0004, place.coords[1] + offset * .0004] as const;
    const age = index % 9 === 0 ? 75 : 2 + index % 45;
    return { id: `api-seed-${index}-${offset}`, name: `${place.name} · simulated location report`, coords,
      segmentId: `location:${coords.join(':')}`, depth: ((index + offset) % 4 + 1) as Spot['depth'],
      source: 'seeded' as const, createdAt: now - age * 60_000, lastConfirmedAt: now - age * 60_000,
      confirms: index % 4, dismisses: 0, cleared: false, reporterId: 'ncr-simulation', votes: {} };
  }));
  return [...general, ...seedGurugramSpots(now)];
}

/** One-time catalogue upgrade: preserve community data and existing scenario votes/freshness. */
export function reconcileSeedSpots(previous: readonly Spot[], now: number): Spot[] {
  const community = previous.filter(spot => spot.source === 'community');
  const existing = new Map(previous.filter(spot => spot.source === 'seeded').map(spot => [spot.id, spot]));
  const catalogue = seedApiSpots(now).sort((a, b) => Number(b.evidence !== undefined) - Number(a.evidence !== undefined));
  const seeds = catalogue.slice(0, Math.max(0, 400 - community.length)).map(seed => {
    const old = existing.get(seed.id);
    return old === undefined ? seed : { ...old, ...(seed.evidence === undefined ? {} : { evidence: seed.evidence }) };
  });
  return [...community, ...seeds];
}
