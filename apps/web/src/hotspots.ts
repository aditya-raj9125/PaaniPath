import type { Coordinates, PublicSpot } from '@paanipath/domain';
import { escapeHtml } from '@paanipath/ui';
import { distanceToSegment, PointIndex } from '@paanipath/routing';

export const HOTSPOT_ROUTE_RADIUS_METRES = 750;

export interface MapHotspot { readonly id: string; readonly name: string; readonly coords: Coordinates; readonly spots: readonly PublicSpot[]; readonly members?: readonly MapHotspot[] }
/** Curated seed groups; community cases use small stable geographic buckets. */
export function groupHotspots(spots: readonly PublicSpot[]): MapHotspot[] {
  const groups = new Map<string, { id: string; name: string; coords: Coordinates; spots: PublicSpot[] }>();
  for (const spot of spots) {
    if (spot.cleared || spot.archived) continue;
    const id = spot.hotspot?.id ?? `community-${Math.floor(spot.coords[0] / .004)}-${Math.floor(spot.coords[1] / .004)}`;
    const group = groups.get(id) ?? { id, name: spot.hotspot?.name ?? 'Community observations', coords: spot.hotspot?.coords ?? spot.coords, spots: [] };
    group.spots.push(spot); groups.set(id, group);
  }
  return [...groups.values()];
}

/** Show complete hotspots if their centre or any active case is within the route corridor. */
export function routeHotspots(spots: readonly PublicSpot[], geometry: readonly Coordinates[] | undefined): MapHotspot[] {
  if (geometry === undefined || geometry.length < 2) return [];
  const hotspots = groupHotspots(spots);
  const probes = hotspots.flatMap(hotspot => [{ id: hotspot.id, coords: hotspot.coords },
    ...hotspot.spots.map(spot => ({ id: hotspot.id, coords: spot.coords }))]);
  const index = new PointIndex(probes);
  const visible = new Set<string>();
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1]; const b = geometry[i];
    if (a === undefined || b === undefined) continue;
    for (const probe of index.nearSegment(a, b, HOTSPOT_ROUTE_RADIUS_METRES)) {
      if (!visible.has(probe.id) && distanceToSegment(probe.coords, a, b) <= HOTSPOT_ROUTE_RADIUS_METRES) visible.add(probe.id);
    }
  }
  return hotspots.filter(hotspot => visible.has(hotspot.id));
}
export function densityStyle(count: number): { readonly radius: number; readonly opacity: number; readonly label: string } {
  const density = Math.min(1, Math.max(0, count) / 20);
  return { radius: 17 + 20 * density, opacity: .2 + .65 * density, label: count >= 14 ? 'High' : count >= 9 ? 'Moderate' : 'Low' };
}
/** Screen-space aggregation prevents hundreds of overlapping markers at NCR overview zoom. */
export function clusterHotspots(hotspots: readonly MapHotspot[], project: (coords: Coordinates) => readonly [number, number], scale: number): MapHotspot[] {
  const size = 55 / Math.max(.001, scale); const cells = new Map<string, MapHotspot[]>();
  for (const hotspot of hotspots) {
    const [x, y] = project(hotspot.coords); const key = `${Math.floor(x / size)}:${Math.floor(y / size)}`;
    const members = cells.get(key) ?? []; members.push(hotspot); cells.set(key, members);
  }
  const result: MapHotspot[] = [];
  for (const [cell, members] of cells) {
    const first = members[0]; if (first === undefined) continue;
    result.push(members.length === 1 ? first : { id: `overview-${cell}`, name: `${members.length} nearby hotspots`, coords: first.coords,
      spots: members.flatMap(member => member.spots), members });
  }
  return result;
}
export function hotspotMarker(hotspot: MapHotspot, point: readonly [number, number]): string {
  const style = densityStyle(hotspot.spots.length);
  return `<g class="map-hotspot" data-hotspot="${escapeHtml(hotspot.id)}" transform="translate(${point.join(',')})" role="button" tabindex="0" aria-label="${escapeHtml(hotspot.name)}, ${hotspot.spots.length} cases, ${style.label.toLowerCase()} case density. View cases">
    <circle r="${style.radius + 9}" fill="#1768a6" opacity="${style.opacity * .18}"/>
    <circle r="${style.radius}" fill="#1768a6" opacity="${style.opacity}" stroke="#fff" stroke-width="2"/>
    <circle r="14" fill="#174d7d" stroke="#eaf5ff" stroke-width="1"/>
    <text y="4" text-anchor="middle" fill="white" font-size="12" font-weight="800">${hotspot.spots.length}</text></g>`;
}
export function caseMarker(spot: PublicSpot, point: readonly [number, number], selected: boolean): string {
  return `<g class="map-spot ${selected ? 'selected' : ''}" data-spot="${escapeHtml(spot.id)}" transform="translate(${point.join(',')})" role="button" tabindex="0" aria-label="Open case: ${escapeHtml(spot.name)}">
    <circle r="${selected ? 15 : 10}" fill="#1768a6" opacity=".18"/><circle r="6" fill="#1768a6" stroke="white" stroke-width="2"/>
    <text y="3" text-anchor="middle" fill="white" font-size="8" font-weight="700">${spot.depth}</text></g>`;
}
export function hotspotSummary(hotspot: MapHotspot, expanded = false): string {
  const count = hotspot.spots.length; const style = densityStyle(count);
  return `<div class="spot-popover hotspot-popover"><div class="spot-popover-top"><span class="depth-tag">${style.label.toUpperCase()} CASE DENSITY</span><button data-close-hotspot="1" aria-label="Close hotspot">Close</button></div>
    <h3>${escapeHtml(hotspot.name)}</h3><div class="hotspot-count"><strong>${count}</strong> cases in this hotspot</div>
    <p>Intensity shows case count, not measured flood depth or safety. ${hotspot.spots.every(spot => spot.source === 'seeded') ? 'Simulated cases on provider-snapped road coordinates.' : 'Includes community observations.'}</p>
    ${expanded ? `<button class="hotspot-button" data-close-hotspot="1">Back to intensity map</button><div class="hotspot-case-list">${hotspot.spots.map(spot => `<button data-spot-id="${escapeHtml(spot.id)}"><span>Level ${spot.depth}</span> ${escapeHtml(spot.name)}<small>${spot.ageMinutes} min old · ${escapeHtml(spot.sourceLabel)}</small></button>`).join('')}</div>` : `<button class="hotspot-button" data-open-hotspot="${escapeHtml(hotspot.id)}">View ${count} cases</button>`}</div>`;
}
