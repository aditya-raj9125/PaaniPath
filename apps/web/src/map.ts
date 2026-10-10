import type { Coordinates, Place, PublicSpot, MapMetadata, RouteOption } from '@paanipath/domain';
import { escapeHtml, icon, requiredElement } from '@paanipath/ui';
import { fitViewBox, mapBounds, project, unproject, visibleTiles } from './map-geometry.ts';
import type { ViewBox } from './map-geometry.ts';

const COLORS: Readonly<Record<string, string>> = { damaging: '#174d7d', marginal: '#74a7ce', passable: '#b3d5ef', stale: '#95b5cf', cleared: '#b9d5e9' };
interface MapCallbacks { readonly selectSpot: (id: string) => void; readonly selectPoint: (coords: Coordinates) => void }

/** Real street tiles with geographically aligned OSM routing and report overlays. */
export class PilotMap {
  private readonly svg: SVGSVGElement;
  private readonly graph: { readonly metadata: MapMetadata };
  private readonly bbox: readonly [number, number, number, number];
  private box = [0, 0, 1000, 760];
  private drag: { x: number; y: number; box: number[]; moved: boolean } | undefined;
  private pick = false;
  private roadOverlay = false;
  private readonly tiles = new Map<string, SVGImageElement>();

  constructor(private readonly root: HTMLElement, graph: { readonly metadata: MapMetadata }, private readonly callbacks: MapCallbacks) {
    this.graph = graph;
    this.bbox = mapBounds(graph.metadata.bbox);
    root.innerHTML = `<svg class="pilot-map" viewBox="0 0 1000 760" role="group" aria-label="Delhi NCR map with routes and waterlogging reports">
      <defs><pattern id="paper" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".4" fill="#b7d7ec" opacity=".12"/></pattern>
      <filter id="marker-shadow" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".12"/></filter></defs>
      <g id="map-background"></g><g id="map-tiles"></g><g id="map-roads"></g><g id="map-labels"></g><g id="map-routes"></g><g id="map-spots"></g><g id="map-stops"></g><g id="map-picked"></g>
      </svg><div class="map-topline"><div class="map-region">${icon('pin', 15)} Delhi NCR <span>ONLINE ROAD ROUTING</span></div><button class="map-layer" id="street-layer" title="Show the NCR search region; route availability depends on the provider" aria-pressed="false">${icon('layers', 17)} Search region</button></div>
      <div class="map-tools"><button id="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button id="zoom-out" aria-label="Zoom out">−</button><span></span><button id="map-reset" aria-label="Fit NCR search region">${icon('locate')}</button></div>
      <div class="map-tile-status" role="status" hidden>Street tiles could not load. Check your internet connection; route overlays come from the directions API.</div>
      <div class="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://openrouteservice.org/" target="_blank" rel="noopener noreferrer">Routing: openrouteservice</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Report a map issue</a></div>`;
    this.svg = requiredElement<SVGSVGElement>('svg.pilot-map', root);
    this.drawBase();
    this.bind();
    this.renderTiles();
    new ResizeObserver(() => this.renderTiles()).observe(this.svg);
  }

  project(coords: Coordinates): readonly [number, number] {
    return project(coords, this.bbox);
  }
  private unproject(x: number, y: number): Coordinates {
    return unproject(x, y, this.bbox);
  }
  private layer(id: string, html: string): void { requiredElement(`#${id}`, this.root).innerHTML = html; }

  private drawBase(): void {
    this.layer('map-background', '<rect x="-10000" y="-10000" width="30000" height="30000" fill="#eaf5ff"/>');
    const [south, west, north, east] = this.graph.metadata.bbox;
    const corners: readonly Coordinates[] = [[south, west], [north, west], [north, east], [south, east]];
    const points = corners.map(point => this.project(point).join(',')).join(' ');
    this.layer('map-roads', `<polygon points="${points}" fill="#1768a6" fill-opacity=".035" stroke="#1768a6" stroke-width="2" stroke-dasharray="8 6"><title>NCR search viewport, not an administrative or routing boundary.</title></polygon>`);
    requiredElement<SVGElement>('#map-roads', this.root).style.display = 'none';
  }

  update(spots: readonly PublicSpot[], routes: readonly RouteOption[], selectedRoute: string, locations: readonly Place[], selectedSpot?: string): void {
    const sorted = [...routes].sort((a, b) => Number(a.id === selectedRoute) - Number(b.id === selectedRoute));
    this.layer('map-routes', sorted.map(route => {
      const points = route.geometry.map(coords => this.project(coords).join(',')).join(' ');
      const active = route.id === selectedRoute;
      return `<polyline points="${points}" fill="none" stroke="white" stroke-width="${active ? 10 : 7}" stroke-linejoin="round" stroke-linecap="round" opacity="${active ? 1 : .55}"/>
        <polyline points="${points}" fill="none" stroke="${active ? '#1768a6' : '#86b5d7'}" stroke-width="${active ? 5 : 3}" stroke-linejoin="round" stroke-linecap="round" ${active ? '' : 'stroke-dasharray="8 6"'} opacity="${active ? 1 : .65}"/>`;
    }).join(''));
    this.layer('map-spots', spots.filter(spot => !spot.cleared).map(spot => {
      const [x, y] = this.project(spot.coords);
      const color = COLORS[spot.verdict];
      return `<g class="map-spot ${spot.id === selectedSpot ? 'selected' : ''}" data-spot="${escapeHtml(spot.id)}" transform="translate(${x},${y})" role="button" tabindex="0" aria-label="${escapeHtml(`${spot.name}, depth ${spot.depth}, ${spot.verdict}, ${spot.ageMinutes} minutes old`)}">
        <title>${escapeHtml(spot.name)} · ${spot.verdict} · ${spot.ageMinutes} min ago</title>
        <circle r="${spot.id === selectedSpot ? 24 : 19}" fill="${color}" opacity=".20"/><circle r="9" fill="${color}" stroke="#fff" stroke-width="2.5" filter="url(#marker-shadow)"/>
        <text y="3.5" text-anchor="middle" fill="${spot.verdict === 'damaging' ? 'white' : '#15334b'}" font-size="10" font-weight="700">${spot.depth}</text></g>`;
    }).join(''));
    this.layer('map-stops', locations.map((place, index) => {
      const [x, y] = this.project(place.coords);
      return `<g transform="translate(${x},${y})"><circle r="15" fill="white" stroke="#1768a6" stroke-width="2.5"/><text y="4.5" text-anchor="middle" fill="#1768a6" font-size="12" font-weight="800">${String.fromCharCode(65 + index)}</text></g>`;
    }).join(''));
    this.scaleMarkers();
  }

  setPicking(enabled: boolean): void { this.pick = enabled; this.root.classList.toggle('picking', enabled); }
  markPoint(coords: Coordinates): void {
    const [x, y] = this.project(coords);
    this.layer('map-picked', `<g transform="translate(${x},${y})"><circle r="22" fill="#1768a6" opacity=".15"/><circle r="5" fill="#1768a6"/><path d="M-14 0H14M0-14V14" stroke="#1768a6" stroke-width="2"/></g>`);
    this.scaleMarkers();
  }
  focus(coords: Coordinates): void { this.fit([coords]); }
  reset(): void { this.box = [0, 0, 1000, 760]; this.setBox(); }
  fit(coords: readonly Coordinates[]): void {
    const box = fitViewBox(coords, this.bbox);
    if (box === undefined) return;
    this.box = [...box];
    this.setBox();
  }
  private scaleMarkers(): void {
    const scale = (this.box[2] ?? 1000) / 1000;
    this.root.querySelectorAll<SVGElement>('#map-spots > g, #map-stops > g, #map-picked > g').forEach(marker => {
      const translation = (marker.getAttribute('transform') ?? '').split(' scale(')[0] ?? '';
      marker.setAttribute('transform', `${translation} scale(${scale})`);
    });
  }
  private setBox(): void { this.svg.setAttribute('viewBox', this.box.join(' ')); this.scaleMarkers(); this.renderTiles(); }
  private zoom(factor: number): void {
    const [x = 0, y = 0, w = 1000, h = 760] = this.box;
    const width = Math.max(.5, Math.min(1800, w * factor));
    const height = width * 0.76;
    this.box = [x + (w - width) / 2, y + (h - height) / 2, width, height]; this.setBox();
  }

  private bind(): void {
    requiredElement('#zoom-in', this.root).addEventListener('click', () => this.zoom(0.8));
    requiredElement('#zoom-out', this.root).addEventListener('click', () => this.zoom(1.25));
    requiredElement('#map-reset', this.root).addEventListener('click', () => this.reset());
    requiredElement('#street-layer', this.root).addEventListener('click', () => {
      this.roadOverlay = !this.roadOverlay;
      requiredElement('#street-layer', this.root).setAttribute('aria-pressed', String(this.roadOverlay));
      requiredElement<SVGElement>('#map-roads', this.root).style.display = this.roadOverlay ? '' : 'none';
    });
    this.svg.addEventListener('wheel', event => { event.preventDefault(); this.zoom(event.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
    this.svg.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('[data-spot]'))) return;
      this.drag = { x: event.clientX, y: event.clientY, box: [...this.box], moved: false };
      this.svg.setPointerCapture(event.pointerId);
    });
    this.svg.addEventListener('pointermove', event => {
      if (this.drag === undefined) return;
      const dx = event.clientX - this.drag.x; const dy = event.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
      if (!this.drag.moved) return;
      const rect = this.svg.getBoundingClientRect();
      const [x = 0, y = 0, w = 1000, h = 760] = this.drag.box;
      const scale = Math.max(w / rect.width, h / rect.height);
      this.box = [x - dx * scale, y - dy * scale, w, h]; this.setBox();
    });
    this.svg.addEventListener('pointerup', event => this.pointerUp(event));
    this.svg.addEventListener('pointercancel', () => { this.drag = undefined; });
    this.svg.addEventListener('click', event => {
      const id = event.target instanceof Element ? event.target.closest('[data-spot]')?.getAttribute('data-spot') : null;
      if (id) this.callbacks.selectSpot(id);
    });
    this.svg.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const id = event.target instanceof Element ? event.target.closest('[data-spot]')?.getAttribute('data-spot') : null;
      if (id) { event.preventDefault(); this.callbacks.selectSpot(id); }
    });
  }

  private pointerUp(event: PointerEvent): void {
    const dragged = this.drag?.moved ?? false;
    this.drag = undefined;
    if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    if (!this.pick || dragged) return;
    const matrix = this.svg.getScreenCTM()?.inverse();
    if (matrix === undefined) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    const coords = this.unproject(point.x, point.y);
    this.markPoint(coords); this.callbacks.selectPoint(coords);
  }

  private renderTiles(): void {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const [x = 0, y = 0, width = 1000, height = 760] = this.box;
    const scale = Math.max(width / rect.width, height / rect.height);
    const visibleWidth = rect.width * scale; const visibleHeight = rect.height * scale;
    const viewport: ViewBox = [x - (visibleWidth - width) / 2, y - (visibleHeight - height) / 2, visibleWidth, visibleHeight];
    const wanted = visibleTiles(this.bbox, viewport, rect.width);
    const keys = new Set(wanted.map(tile => tile.key));
    for (const [key, image] of this.tiles) {
      if (!keys.has(key)) { image.remove(); this.tiles.delete(key); }
    }
    const status = requiredElement<HTMLElement>('.map-tile-status', this.root);
    for (const tile of wanted) {
      if (this.tiles.has(tile.key)) continue;
      const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      image.setAttribute('x', String(tile.x)); image.setAttribute('y', String(tile.y));
      image.setAttribute('width', String(tile.width)); image.setAttribute('height', String(tile.height));
      image.setAttribute('preserveAspectRatio', 'none');
      image.addEventListener('error', () => { image.dataset.failed = 'true'; status.hidden = false; });
      image.addEventListener('load', () => { status.hidden = [...this.tiles.values()].every(value => value.dataset.failed !== 'true'); });
      image.setAttribute('href', tile.url);
      this.tiles.set(tile.key, image);
      requiredElement('#map-tiles', this.root).append(image);
    }
  }
}
