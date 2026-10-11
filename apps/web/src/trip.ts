import type { DemoJourney, Place } from '@paanipath/domain';

/** Preserve uncommitted search text when stops are inserted, removed, reversed or reordered. */
export function remapDrafts(drafts: Readonly<Record<number, string>>, originalIndices: readonly number[]): Record<number, string> {
  const next: Record<number, string> = {};
  originalIndices.forEach((original, current) => {
    const value = drafts[original];
    if (value !== undefined) next[current] = value;
  });
  return next;
}

export function emptyTrip(): Place[] {
  return [0, 1].map(index => ({ id: `empty-${index}`, name: '', coords: [0, 0] }));
}

export function tripReady(locations: readonly Place[], drafts: Readonly<Record<number, string>>): boolean {
  return locations.length >= 2 && locations.length <= 4 && locations.every((place, index) =>
    place.name.trim().length > 0 && (drafts[index] === undefined || drafts[index] === place.name));
}

/** Editable copies prevent a reversed/changed trip from mutating the shared preset catalogue. */
export function journeyTrip(journey: DemoJourney): Place[] {
  return journey.locations.map(place => ({ ...place, coords: [place.coords[0], place.coords[1]] }));
}

export function matchesJourney(locations: readonly Place[], journey: DemoJourney): boolean {
  return locations.length === journey.locations.length && locations.every((place, index) => {
    const original = journey.locations[index];
    return original !== undefined && place.id === original.id && place.coords[0] === original.coords[0] && place.coords[1] === original.coords[1];
  });
}
