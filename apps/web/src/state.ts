import type { BootstrapResponse, Coordinates, Depth, Place, PublicSpot, RouteResponse, VehicleProfile } from '@paanipath/domain';
import { PROFILES } from '@paanipath/domain';

export interface AppState {
  bootstrap: BootstrapResponse | undefined;
  profile: VehicleProfile;
  locations: Place[];
  drafts: Record<number, string>;
  routes: RouteResponse | undefined;
  selectedRoute: string;
  selectedSpot: string | undefined;
  detourFactor: number;
  optimizeOrder: boolean;
  loading: boolean;
  error: string;
  view: 'planner' | 'reports';
  pickLocation: boolean;
  pickStop: number | undefined;
  pickedCoords: Coordinates | undefined;
  reportDepth: Depth;
  reportPhoto: string | undefined;
  filter: 'all' | 'damaging' | 'stale';
}
export const state: AppState = { bootstrap: undefined, profile: PROFILES[1] ?? { type: 'motorbike', name: 'Motorbike', marginal: 2, damaging: 3 },
  locations: [], drafts: {}, routes: undefined, selectedRoute: 'route-0', selectedSpot: undefined, detourFactor: 2, optimizeOrder: true,
  loading: false, error: '', view: 'planner', pickLocation: false, pickStop: undefined, pickedCoords: undefined, reportDepth: 2, reportPhoto: undefined, filter: 'all' };

export function spotsForVehicle(): PublicSpot[] {
  const source = state.bootstrap?.spots ?? [];
  return source.map(spot => ({ ...spot,
    verdict: spot.cleared ? 'cleared' : spot.ageMinutes >= 60 ? 'stale' : spot.depth >= state.profile.damaging ? 'damaging' : spot.depth >= state.profile.marginal ? 'marginal' : 'passable' }));
}
