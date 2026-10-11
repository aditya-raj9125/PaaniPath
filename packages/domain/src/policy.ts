import type { Depth, PublicSpot, Spot, VehicleProfile, Verdict } from './types.ts';

export const STALE_AFTER_MS = 60 * 60 * 1000;
export const REPORT_CAPACITY = 10_000;
export const SAFETY_WARNING = 'Never enter standing water. Reports can be incomplete or outdated; assumed vehicle limits do not guarantee safety.';
export const PROFILES: readonly VehicleProfile[] = [
  { type: 'scooter', name: 'Scooter', marginal: 2, damaging: 3 },
  { type: 'motorbike', name: 'Motorbike', marginal: 2, damaging: 3 },
  { type: 'car', name: 'Car', marginal: 3, damaging: 4 },
  { type: 'auto', name: 'Auto', marginal: 2, damaging: 3 },
  { type: 'bus', name: 'Bus', marginal: 3, damaging: 4 },
];
export const DEPTHS: readonly { level: Depth; name: string; landmark: string }[] = [
  { level: 1, name: 'Ankle level', landmark: 'Wet road · around your ankle' },
  { level: 2, name: 'Half a tyre', landmark: 'Water reaches halfway up a tyre' },
  { level: 3, name: 'Footrest level', landmark: 'Above the exhaust or footrest' },
  { level: 4, name: 'Door / seat level', landmark: 'Water reaches the door or seat' },
];
export function classifySpot(spot: Spot, profile: VehicleProfile, now: number): Verdict {
  if (spot.cleared) return 'cleared';
  if (now - spot.lastConfirmedAt >= STALE_AFTER_MS) return 'stale';
  if (spot.depth >= profile.damaging) return 'damaging';
  if (spot.depth >= profile.marginal) return 'marginal';
  return 'passable';
}
export function publicSpot(spot: Spot, profile: VehicleProfile, now: number): PublicSpot {
  const { reporterId: _reporter, votes: _votes, ...visible } = spot;
  return { ...visible, verdict: classifySpot(spot, profile, now),
    confidence: Math.round(100 * (spot.confirms + 1) / (spot.confirms + spot.dismisses + 2)),
    ageMinutes: Math.max(0, Math.floor((now - spot.lastConfirmedAt) / 60_000)),
    sourceLabel: spot.source === 'seeded' ? 'Simulated seed' : spot.confirms >= 2 ? 'Community corroborated' : 'Single report' };
}
