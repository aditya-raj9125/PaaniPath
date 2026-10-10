import { assert } from './errors.ts';
import { PROFILES } from './policy.ts';
import type { Coordinates, Depth, Place, ReportInput, RouteRequest, VehicleProfile, VoteInput } from './types.ts';

export function object(value: unknown): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_INPUT', 'Expected a JSON object.');
  return value as Record<string, unknown>;
}
export function coordinates(value: unknown): Coordinates {
  assert(Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && Number.isFinite(v)), 'INVALID_COORDINATES', 'Provide finite latitude and longitude.');
  const lat: unknown = value[0];
  const lng: unknown = value[1];
  assert(typeof lat === 'number' && typeof lng === 'number' && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180, 'INVALID_COORDINATES', 'Coordinates are out of range.');
  return [lat, lng];
}
export function depth(value: unknown): Depth {
  assert(value === 1 || value === 2 || value === 3 || value === 4, 'INVALID_DEPTH', 'Depth must be a whole level between 1 and 4.');
  return value;
}
export function text(value: unknown, fallback: string, max = 100): string {
  if (value === undefined) return fallback;
  assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 'INVALID_TEXT', `Use 1–${max} characters.`);
  return value.trim();
}
export function profileInput(value: unknown): VehicleProfile {
  const input = object(value);
  const preset = PROFILES.find(p => p.type === input.type);
  assert(preset, 'INVALID_VEHICLE', 'Choose a supported vehicle.');
  const marginal = depth(input.marginal ?? preset.marginal);
  const damaging = depth(input.damaging ?? preset.damaging);
  assert(marginal <= damaging, 'INVALID_LIMITS', 'Marginal level cannot exceed damaging level.');
  return { ...preset, marginal, damaging };
}
export function routeInput(value: unknown): RouteRequest {
  const input = object(value);
  assert(Array.isArray(input.locations) && input.locations.length >= 2 && input.locations.length <= 4, 'INVALID_STOPS', 'Choose an origin and one to three stops.');
  const locations: Place[] = input.locations.map((value: unknown, i: number) => {
    const location = object(value);
    return { id: text(location.id, `stop-${i}`), name: text(location.name, `Stop ${i + 1}`), coords: coordinates(location.coords) };
  });
  const detourFactor = input.detourFactor ?? 2;
  assert(typeof detourFactor === 'number' && Number.isFinite(detourFactor) && detourFactor >= 1 && detourFactor <= 3, 'INVALID_DETOUR', 'Detour allowance must be 1–3 times fastest.');
  assert(input.optimizeOrder === undefined || typeof input.optimizeOrder === 'boolean', 'INVALID_STOPS', 'Optimize order must be a boolean.');
  return { locations, profile: profileInput(input.profile), detourFactor, optimizeOrder: input.optimizeOrder !== false };
}
export function reportInput(value: unknown): ReportInput {
  const input = object(value);
  const result: ReportInput = { name: text(input.name, 'Community report', 80), coords: coordinates(input.coords), depth: depth(input.depth) };
  if (input.photo === undefined) return result;
  assert(typeof input.photo === 'string' && input.photo.length <= 1_450_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(input.photo), 'INVALID_PHOTO', 'Use a JPEG or PNG photo smaller than 1 MB.');
  return { ...result, photo: input.photo };
}
export function voteInput(value: unknown): VoteInput {
  const input = object(value);
  assert(input.action === 'confirm' || input.action === 'dismiss', 'INVALID_VOTE', 'Choose still flooded or cleared.');
  assert(input.demo === undefined || typeof input.demo === 'boolean', 'INVALID_VOTE', 'Demo flag must be a boolean.');
  const result: VoteInput = { action: input.action, demo: input.demo === true };
  return input.coords === undefined ? result : { ...result, coords: coordinates(input.coords) };
}
