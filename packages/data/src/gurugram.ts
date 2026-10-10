import type { Place, Spot } from '@paanipath/domain';

export const HOTSPOT_SOURCES = {
  abp: { title: 'ABP Live: Gurugram waterlogging', url: 'https://news.abplive.com/cities/gurugram-comes-to-standstill-as-roads-flooded-offices-announce-work-from-home-video-1786690', publishedAt: '2025-07-10' },
  moneycontrol: { title: 'Moneycontrol: Gurugram rain disruption', url: 'https://www.moneycontrol.com/city/gurugram-advises-wfh-for-corporate-offices-as-heavy-rain-triggers-nh-48-cave-in-massive-traffic-chaos-article-13968420.html/amp', publishedAt: '2026-07-08' },
} as const;
interface Hotspot extends Place { readonly reference: keyof typeof HOTSPOT_SOURCES }
/** Approximate landmark/sector anchors, not source-supplied GPS fixes or surveyed flood limits. */
export const GURUGRAM_HOTSPOTS: readonly Hotspot[] = [
  { id: 'narsinghpur', name: 'Narsinghpur NH-48', coords: [28.4110, 76.9950], reference: 'abp' },
  { id: 'hero-honda', name: 'Hero Honda Chowk', coords: [28.4335, 77.0055], reference: 'moneycontrol' },
  { id: 'basai-chowk', name: 'Basai Chowk', coords: [28.4672, 76.9891], reference: 'abp' },
  { id: 'rajiv-chowk', name: 'Rajiv Chowk', coords: [28.4468, 77.0359], reference: 'abp' },
  { id: 'sheetla-mata', name: 'Sheetla Mata Road', coords: [28.4867, 77.0324], reference: 'abp' },
  { id: 'sadar-bazar', name: 'Sadar Bazar', coords: [28.4607, 77.0292], reference: 'abp' },
  { id: 'bus-adda', name: 'Gurugram Bus Stand', coords: [28.4677, 77.0312], reference: 'abp' },
  { id: 'khandsa', name: 'Khandsa Road', coords: [28.4357, 77.0002], reference: 'abp' },
  { id: 'sanjay-gram', name: 'Sanjay Gram Road', coords: [28.4771, 77.0413], reference: 'abp' },
  { id: 'sohna-road', name: 'Sohna Road', coords: [28.4197, 77.0408], reference: 'abp' },
  { id: 'subhash-chowk', name: 'Subhash Chowk', coords: [28.4281, 77.0397], reference: 'abp' },
  { id: 'golf-extension', name: 'Golf Course Extension Road', coords: [28.4077, 77.0858], reference: 'abp' },
  { id: 'sector-30', name: 'Sector 30', coords: [28.4598, 77.0524], reference: 'abp' },
  { id: 'sector-31', name: 'Sector 31', coords: [28.4507, 77.0495], reference: 'abp' },
  { id: 'sector-40', name: 'Sector 40', coords: [28.4478, 77.0620], reference: 'abp' },
  { id: 'sector-45', name: 'Sector 45', coords: [28.4452, 77.0742], reference: 'abp' },
  { id: 'sector-47', name: 'Sector 47', coords: [28.4268, 77.0556], reference: 'abp' },
  { id: 'sector-51', name: 'Sector 51', coords: [28.4315, 77.0727], reference: 'abp' },
  { id: 'sector-22', name: 'Sector 22', coords: [28.5113, 77.0684], reference: 'abp' },
  { id: 'sector-23', name: 'Sector 23', coords: [28.5110, 77.0474], reference: 'abp' },
  { id: 'sector-4', name: 'Sector 4', coords: [28.4741, 77.0054], reference: 'abp' },
  { id: 'sector-5', name: 'Sector 5', coords: [28.4842, 77.0117], reference: 'abp' },
  { id: 'sector-12', name: 'Sector 12', coords: [28.4774, 77.0301], reference: 'abp' },
  { id: 'sector-13', name: 'Sector 13', coords: [28.4870, 77.0375], reference: 'abp' },
];
export const GURUGRAM_PLACES: readonly Place[] = GURUGRAM_HOTSPOTS.map(hotspot => ({
  id: `ggn-${hotspot.id}`, name: `${hotspot.name}, Gurugram`, coords: hotspot.coords,
}));

export function seedGurugramSpots(now: number): Spot[] {
  const offsets = [[0, 0], [.0007, 0], [0, .0007], [-.0007, -.0007]] as const;
  return GURUGRAM_HOTSPOTS.flatMap((hotspot, index) => offsets.map(([lat, lng], variant) => {
    const coords = [hotspot.coords[0] + lat, hotspot.coords[1] + lng] as const;
    const age = variant === 3 ? 75 : 5 + index;
    return { id: `ggn-seed-${hotspot.id}-${variant}`, name: `${hotspot.name}, Gurugram · simulated scenario ${variant + 1}`,
      coords, segmentId: `location:${coords.join(':')}`, depth: ((index + variant) % 4 + 1) as Spot['depth'],
      source: 'seeded' as const, createdAt: now - age * 60_000, lastConfirmedAt: now - age * 60_000,
      confirms: 0, dismisses: 0, cleared: false, reporterId: 'gurugram-simulation', votes: {},
      evidence: { ...HOTSPOT_SOURCES[hotspot.reference], coordinates: 'approximate' as const, scenario: true as const } };
  }));
}
