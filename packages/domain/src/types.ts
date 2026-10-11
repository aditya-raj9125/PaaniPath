export type Coordinates = readonly [latitude: number, longitude: number];
export type Depth = 1 | 2 | 3 | 4;
export type VehicleType = 'scooter' | 'motorbike' | 'car' | 'auto' | 'bus';
export type Verdict = 'passable' | 'marginal' | 'damaging' | 'stale' | 'cleared';

export interface VehicleProfile {
  readonly type: VehicleType;
  readonly name: string;
  readonly marginal: Depth;
  readonly damaging: Depth;
}
export interface Spot {
  readonly id: string;
  readonly name: string;
  readonly coords: Coordinates;
  readonly segmentId: string;
  readonly depth: Depth;
  readonly source: 'seeded' | 'community';
  readonly createdAt: number;
  readonly lastConfirmedAt: number;
  readonly confirms: number;
  readonly dismisses: number;
  readonly cleared: boolean;
  readonly reporterId: string;
  readonly votes: Readonly<Record<string, 'confirm' | 'dismiss'>>;
  readonly photoId?: string;
  readonly archived?: boolean;
  readonly hotspot?: { readonly id: string; readonly name: string; readonly coords: Coordinates };
  readonly roadPlacement?: { readonly provider: 'openrouteservice'; readonly graphDate: string; readonly snapped: true };
  readonly evidence?: { readonly title: string; readonly url: string; readonly publishedAt: string; readonly coordinates: 'approximate'; readonly scenario: true };
}
export interface PublicSpot extends Omit<Spot, 'reporterId' | 'votes'> {
  readonly verdict: Verdict;
  readonly confidence: number;
  readonly ageMinutes: number;
  readonly sourceLabel: string;
}
export interface MapMetadata {
  readonly source: 'openrouteservice';
  readonly attribution: string;
  readonly fetchedAt: string;
  readonly bbox: readonly [number, number, number, number];
  readonly limitations: string;
}
export interface Place { readonly id: string; readonly name: string; readonly coords: Coordinates }
export interface DemoJourney {
  readonly id: string;
  readonly title: string;
  readonly locations: readonly Place[];
}
export interface PlaceSearchResponse {
  readonly places: readonly Place[];
  readonly source: 'local' | 'photon' | 'mixed';
  readonly warning?: string;
}
export interface RouteRequest {
  readonly locations: readonly Place[];
  readonly profile: VehicleProfile;
  readonly detourFactor: number;
  readonly optimizeOrder: boolean;
}
export interface RouteScore {
  readonly damaging: number;
  readonly marginal: number;
  readonly worstDepth: number;
  readonly seconds: number;
}
export interface RouteOption {
  readonly id: string;
  readonly score: RouteScore;
  readonly order: readonly number[];
  readonly geometry: readonly Coordinates[];
  readonly edgeIds: readonly string[];
  readonly distanceMetres: number;
  readonly spotIds: readonly string[];
  readonly recommended: boolean;
  readonly fastest: boolean;
  readonly extraSeconds: number;
  readonly withinDetour: boolean;
}
export interface SearchStats {
  readonly expanded: number;
  readonly pruned: number;
  readonly labels: number;
  readonly durationMs: number;
  readonly optimal: boolean;
  readonly bounded: boolean;
  readonly ordersEvaluated: number;
  readonly algorithm: string;
}
export interface RouteResponse {
  readonly routes: readonly RouteOption[];
  readonly spots: readonly PublicSpot[];
  readonly stats: SearchStats;
  readonly reason: string;
  readonly warning: string;
  readonly graphSource: MapMetadata['source'];
  readonly revision: number;
}
export interface BootstrapResponse {
  readonly graph: { readonly metadata: MapMetadata };
  readonly places: readonly Place[];
  readonly journeys?: readonly DemoJourney[];
  readonly profiles: readonly VehicleProfile[];
  readonly spots: readonly PublicSpot[];
  readonly revision: number;
  readonly demoMode: boolean;
  readonly actorId: string;
  readonly seededMode?: boolean;
  readonly coverage?: { readonly nodes: number; readonly edges: number; readonly preview: boolean };
}
export interface ReportsResponse { readonly spots: readonly PublicSpot[]; readonly revision: number }
export interface ReportInput {
  readonly name: string;
  readonly coords: Coordinates;
  readonly depth: Depth;
  readonly photo?: string;
}
export interface VoteInput { readonly action: 'confirm' | 'dismiss'; readonly coords?: Coordinates; readonly demo: boolean }
export interface ApiProblem { readonly error: { readonly code: string; readonly message: string; readonly requestId: string } }
