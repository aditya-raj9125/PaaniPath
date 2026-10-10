import { errorMessage } from '@paanipath/domain';
import type { Coordinates, Depth, PublicSpot, VehicleType } from '@paanipath/domain';
import { escapeHtml, icon, requiredElement } from '@paanipath/ui';
import { api } from './api.ts';
import { PilotMap } from './map.ts';
import { PlacePicker } from './place-picker.ts';
import { remapDrafts } from './trip.ts';
import { flushReports, queueReport, queuedReports } from './offline.ts';
import { preparePhoto } from './photos.ts';
import { spotsForVehicle, state } from './state.ts';
import { aboutDialog, planner, reportDialog, routeCard, shell, spotDetail } from './views.ts';

let map: PilotMap | undefined;
let routeController: AbortController | undefined;
let toastTimeout: ReturnType<typeof setTimeout> | undefined;
let refreshRunning = false;
let reportSubmitting = false;
let lastMinute = Math.floor(Date.now() / 60_000);
let lastRouteRisk = '';
const picker = new PlacePicker((index, place) => { state.locations[index] = place; map?.focus(place.coords); void compare(); });

function toast(message: string): void {
  const element = requiredElement<HTMLElement>('#toast');
  element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => element.classList.remove('visible'), 5000);
}
function showError(error: unknown): void {
  const dialog = document.querySelector<HTMLDialogElement>('#report-dialog');
  const field = dialog?.querySelector<HTMLElement>('#report-error');
  if (dialog?.open && field) { field.hidden = false; field.textContent = errorMessage(error); }
  else toast(errorMessage(error));
}
function renderPlanner(): void { requiredElement('#planner-content').innerHTML = planner(); }
function activeSpots(): PublicSpot[] { return spotsForVehicle().filter(spot => !spot.cleared && !spot.archived); }
function renderMap(): void {
  const spots = activeSpots();
  const routes = state.routes?.routes ?? [];
  map?.update(spots, routes, state.selectedRoute, state.locations.filter(place => place.name.length > 0), state.selectedSpot);
  const recommended = routes.find(route => route.recommended);
  requiredElement('#map-summary').innerHTML = `<div><span>ON YOUR RADAR</span><strong>${spots.length}<small>active spots</small></strong></div><div><span>FRESH REPORTS</span><strong>${spots.filter(spot => spot.ageMinutes < 60).length}<small>under 60 min</small></strong></div><div><span>YOUR CLEARER ROUTE</span><strong>${recommended?.score.damaging ?? '—'}<small>damaging spots</small></strong></div>`;
  const selected = spots.find(spot => spot.id === state.selectedSpot);
  requiredElement('#spot-detail').innerHTML = selected === undefined ? '' : spotDetail(selected);
}
function renderRoutes(): void {
  const routes = state.routes?.routes ?? [];
  requiredElement('#routes').innerHTML = routes.length > 0 ? routes.map(routeCard).join('') :
    `<div class="routes-placeholder">${icon('route', 28)}<span>${state.loading ? 'Comparing exposure across your trip…' : escapeHtml(state.error || 'Choose your stops to compare routes.')}</span></div>`;
  const stats = state.routes?.stats;
  requiredElement('#route-count').innerHTML = stats === undefined ? '' : `${routes.length} routes · ${stats.durationMs} ms <span>API candidates</span>`;
  if (state.routes !== undefined) requiredElement('#routes').insertAdjacentHTML('beforeend', `<p class="dialog-footnote">${escapeHtml(state.routes.warning)}</p>`);
}

async function compare(fit = true): Promise<void> {
  picker.close();
  if (state.locations.some((place, index) => !place.name || (state.drafts[index] !== undefined && state.drafts[index] !== place.name))) {
    routeController?.abort(); state.loading = false; state.routes = undefined;
    state.error = 'Select a search result or map point for every stop before routing.';
    renderPlanner(); renderRoutes(); renderMap(); return;
  }
  state.drafts = {};
  routeController?.abort();
  const controller = new AbortController(); routeController = controller;
  state.loading = true; state.error = ''; renderPlanner();
  if (state.routes === undefined) renderRoutes();
  try {
    const result = await api.routes({ locations: state.locations, profile: state.profile, detourFactor: state.detourFactor, optimizeOrder: state.optimizeOrder }, controller.signal);
    if (controller.signal.aborted) return;
    state.routes = result; state.selectedRoute = 'route-0';
    lastRouteRisk = JSON.stringify(result.spots.map(spot => [spot.id, spot.depth, spot.verdict]));
    if (fit) map?.fit(result.routes[0]?.geometry ?? state.locations.map(place => place.coords));
    renderMap(); renderRoutes();
  } catch (error) {
    if (controller.signal.aborted) return;
    state.error = errorMessage(error); state.routes = undefined; renderRoutes(); renderMap();
  } finally {
    if (!controller.signal.aborted) { state.loading = false; renderPlanner(); }
  }
}

async function refresh(replan = true): Promise<void> {
  if (refreshRunning || !navigator.onLine) return;
  refreshRunning = true;
  try {
    const next = await api.reports();
    const changed = next.revision !== state.bootstrap?.revision;
    const minute = Math.floor(Date.now() / 60_000);
    const aged = minute !== lastMinute; lastMinute = minute;
    if (state.bootstrap !== undefined) state.bootstrap = { ...state.bootstrap, spots: next.spots, revision: next.revision };
    connection(true);
    if (changed || aged) {
      renderMap(); if (state.view === 'reports') renderPlanner();
      const risk = JSON.stringify(activeSpots().map(spot => [spot.id, spot.depth, spot.verdict]));
      if (replan && state.routes !== undefined && (changed || risk !== lastRouteRisk) && Object.keys(state.drafts).length === 0) await compare(false);
    }
  } catch { connection(false); }
  finally { refreshRunning = false; }
}
function connection(connected: boolean): void {
  const element = requiredElement('#connection');
  const pending = queuedReports().length;
  element.classList.toggle('offline', !connected);
  element.innerHTML = `<i></i>${connected ? 'Connected to NCR' : 'Offline · reports may be outdated'}${pending ? ` · ${pending} queued` : ''}`;
}

function selectSpot(id: string): void { state.selectedSpot = id; renderMap(); }
function beginReport(): void {
  state.pickStop = undefined;
  state.pickLocation = true; map?.setPicking(true);
  const hint = requiredElement<HTMLElement>('#pick-hint'); hint.hidden = false;
  hint.innerHTML = `${icon('pin', 17)} Tap a road to place your report<button data-action="cancel-pick">Cancel</button>`;
  requiredElement('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('Tap near a road on the map to report waterlogging.');
}
function cancelPick(): void {
  state.pickStop = undefined;
  state.pickLocation = false; map?.setPicking(false); requiredElement<HTMLElement>('#pick-hint').hidden = true;
}
function selectPoint(coords: Coordinates): void {
  const stop = state.pickStop;
  if (stop !== undefined) {
    cancelPick();
    state.locations[stop] = { id: `map-${stop}`, name: coords.map(value => value.toFixed(5)).join(', '), coords };
    delete state.drafts[stop];
    void compare(); return;
  }
  state.pickedCoords = coords; cancelPick();
  const dialog = requiredElement<HTMLDialogElement>('#report-dialog'); dialog.innerHTML = reportDialog(); dialog.showModal();
}

async function submitReport(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (reportSubmitting || state.pickedCoords === undefined) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const data = new FormData(form);
  const input = { coords: state.pickedCoords, depth: Number(data.get('depth')) as Depth,
    name: String(data.get('name') ?? '').trim() || 'Community report', ...(state.reportPhoto === undefined ? {} : { photo: state.reportPhoto }) };
  const button = requiredElement<HTMLButtonElement>('#submit-report'); button.disabled = true; button.textContent = 'Sharing…'; reportSubmitting = true;
  try {
    if (!navigator.onLine) { queueReport(input); toast('Queued on this device. This report is not visible to others until it syncs.'); }
    else { const result = await api.report(input); toast(result.merged ? 'Merged with the nearby report and confirmed.' : 'Report shared. Routes are being updated.'); }
    requiredElement<HTMLDialogElement>('#report-dialog').close(); state.reportPhoto = undefined; await refresh();
  } catch (error) {
    const message = requiredElement<HTMLElement>('#report-error'); message.hidden = false; message.textContent = errorMessage(error);
  } finally { reportSubmitting = false; button.disabled = false; button.innerHTML = `Share this report ${icon('arrow', 19)}`; }
}

async function geoLocation(): Promise<Coordinates> {
  if (!navigator.geolocation) throw new Error('This device does not support location. Select a named stop instead.');
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve([position.coords.latitude, position.coords.longitude]),
    () => reject(new Error('Location is unavailable. Enable location permission or choose a named stop.')), { timeout: 8000, maximumAge: 30_000 }));
}

async function vote(id: string, action: 'confirm' | 'dismiss', button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const spot = activeSpots().find(candidate => candidate.id === id);
    const demo = state.bootstrap?.demoMode === true && spot?.source === 'seeded';
    const coords = demo ? undefined : await geoLocation();
    await api.vote(id, { action, demo, ...(coords === undefined ? {} : { coords }) });
    toast(action === 'confirm' ? 'Confirmation saved. Freshness updated.' : 'Cleared vote saved. The independent-vote threshold still applies.'); await refresh();
  } catch (error) { toast(errorMessage(error)); }
  finally { button.disabled = false; }
}

function setView(view: 'planner' | 'reports'): void {
  state.view = view; renderPlanner();
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
}

async function action(name: string): Promise<void> {
  const report = requiredElement<HTMLDialogElement>('#report-dialog');
  const about = requiredElement<HTMLDialogElement>('#about-dialog');
  switch (name) {
    case 'report': state.reportPhoto = undefined; beginReport(); break;
    case 'cancel-pick': cancelPick(); break;
    case 'close-report': report.close(); break;
    case 'repick': report.close(); beginReport(); break;
    case 'compare': await compare(); break;
    case 'close-spot': state.selectedSpot = undefined; renderMap(); break;
    case 'limits': { const editor = requiredElement<HTMLElement>('#limits-editor'); editor.hidden = !editor.hidden; break; }
    case 'add-stop': addStop(); break;
    case 'reverse-trip': state.drafts = remapDrafts(state.drafts, state.locations.map((_, index) => index).reverse()); state.locations.reverse(); await compare(); break;
    case 'about': about.innerHTML = aboutDialog(); about.showModal(); break;
    case 'close-about': about.close(); break;
    case 'use-location': { const coords = await geoLocation(); state.locations[0] = { id: 'current', name: 'My current location', coords }; delete state.drafts[0]; await compare(); break; }
    case 'reset-demo': await resetSeeds(); about.close(); break;
    default: break;
  }
}

function addStop(): void {
  if (state.locations.length >= 4) return;
  routeController?.abort(); state.loading = false; state.error = '';
  picker.close();
  const order = state.locations.map((_, index) => index); order.splice(state.locations.length - 1, 0, -1);
  state.drafts = remapDrafts(state.drafts, order);
  state.locations.splice(state.locations.length - 1, 0, { id: `pending-${Date.now()}`, name: '', coords: [0, 0] });
  state.routes = undefined; renderPlanner(); renderRoutes(); renderMap();
  requiredElement<HTMLInputElement>(`#stop-${state.locations.length - 2}`).focus();
}
async function resetSeeds(): Promise<void> {
  const result = await api.demo({ action: 'reset' });
  await refresh(); toast(result.message);
}

function bindEvents(): void {
  picker.bind();
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (button === null || button.disabled) return;
    void handleClick(button).catch(showError);
  });
  document.addEventListener('change', event => { void handleChange(event).catch(showError); });
  document.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && event.target.id === 'detour') requiredElement('#detour-value').textContent = `${event.target.value}× fastest`;
  });
  requiredElement('#report-dialog').addEventListener('submit', event => { if (event instanceof SubmitEvent) void submitReport(event); });
  for (const id of ['report-dialog', 'about-dialog']) {
    const dialog = requiredElement<HTMLDialogElement>(`#${id}`);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  }
}

async function handleClick(button: HTMLButtonElement): Promise<void> {
  const data = button.dataset;
  if (data.moveStop !== undefined) {
    const index = Number(data.moveStop); const target = index + Number(data.direction);
    const a = state.locations[index]; const b = state.locations[target];
    if (a !== undefined && b !== undefined) {
      const order = state.locations.map((_, i) => i); order[index] = target; order[target] = index;
      state.locations[index] = b; state.locations[target] = a; state.drafts = remapDrafts(state.drafts, order); await compare();
    }
    return;
  }
  if (data.pickStop !== undefined) {
    state.pickStop = Number(data.pickStop); state.pickLocation = true; map?.setPicking(true);
    const hint = requiredElement<HTMLElement>('#pick-hint'); hint.hidden = false;
    hint.innerHTML = `${icon('pin', 17)} Tap the street map to set stop ${String.fromCharCode(65 + state.pickStop)}<button data-action="cancel-pick">Cancel</button>`;
    requiredElement('#map').scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
  }
  if (data.action !== undefined) await action(data.action);
  if (data.view === 'planner' || data.view === 'reports') setView(data.view);
  if (data.vehicle !== undefined) {
    const profile = state.bootstrap?.profiles.find(candidate => candidate.type === data.vehicle as VehicleType);
    if (profile !== undefined) { state.profile = profile; await compare(); }
  }
  if (data.route !== undefined) {
    state.selectedRoute = data.route; const route = state.routes?.routes.find(candidate => candidate.id === data.route);
    if (route !== undefined) map?.fit(route.geometry);
    renderMap(); renderRoutes();
  }
  if (data.removeStop !== undefined) {
    const removed = Number(data.removeStop); state.drafts = remapDrafts(state.drafts, state.locations.map((_, i) => i).filter(i => i !== removed));
    state.locations.splice(removed, 1); await compare();
  }
  if (data.spotId !== undefined) selectSpot(data.spotId);
  if (data.filter === 'all' || data.filter === 'damaging' || data.filter === 'stale') { state.filter = data.filter; renderPlanner(); }
  if ((data.vote === 'confirm' || data.vote === 'dismiss') && data.voteId !== undefined) await vote(data.voteId, data.vote, button);
}

async function handleChange(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
  if (input.dataset.location !== undefined) {
    return; // The combobox accepts only an explicit selected result, never free text as coordinates.
  }
  if (input.id === 'optimize' && input instanceof HTMLInputElement) { state.optimizeOrder = input.checked; await compare(); }
  if (input.id === 'detour') { state.detourFactor = Number(input.value); await compare(); }
  if (input.id === 'marginal-limit' || input.id === 'damaging-limit') {
    state.profile = { ...state.profile, [input.id === 'marginal-limit' ? 'marginal' : 'damaging']: Number(input.value) as Depth }; await compare();
  }
  if (input.id === 'photo-file' && input instanceof HTMLInputElement) {
    const file = input.files?.[0];
    if (file !== undefined) {
      state.reportPhoto = await preparePhoto(file);
      requiredElement('#photo-preview').innerHTML = `<img src="${state.reportPhoto}" alt="Preview of your waterlogging photo"/><button type="button" id="remove-photo">Remove</button>`;
      requiredElement('#remove-photo').addEventListener('click', () => { state.reportPhoto = undefined; requiredElement('#photo-preview').innerHTML = ''; input.value = ''; });
    }
  }
}

async function boot(): Promise<void> {
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('paanipath-theme');
  const bootstrap = await api.bootstrap(); state.bootstrap = bootstrap;
  const origin = bootstrap.places[0]; const destination = bootstrap.places[1];
  if (origin === undefined || destination === undefined) throw new Error('Pilot locations are missing.');
  state.locations = [origin, destination];
  requiredElement('#app').innerHTML = shell();
  if (!bootstrap.demoMode) requiredElement('#demo-banner').innerHTML = `${icon('info', 16)} Community reports · ${escapeHtml(bootstrap.graph.metadata.limitations)}`;
  else if (bootstrap.graph.metadata.source === 'openrouteservice') requiredElement('#demo-banner').innerHTML = `${icon('info', 16)} Demo: water depths and reports are simulated. Routes come from OpenRouteService; travel times are estimates.`;
  if (bootstrap.seededMode) requiredElement('#demo-banner').innerHTML = `${icon('info', 16)} <strong>API road routing · simulated waterlogging.</strong> Seed pins are approximate location examples, not verified road or flood observations. Community reports are labelled separately.`;
  map = new PilotMap(requiredElement<HTMLElement>('#map'), bootstrap.graph, { selectSpot, selectPoint });
  bindEvents(); renderPlanner(); renderMap(); await compare();
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => { /* App remains usable without shell caching. */ });
  window.addEventListener('offline', () => connection(false));
  window.addEventListener('online', () => { void flushReports().then(count => { if (count > 0) toast(`${count} queued reports synced.`); return refresh(); }); });
  setInterval(() => { if (!document.hidden && !reportSubmitting && !state.pickLocation) void refresh(); }, 5000);
  if (navigator.onLine && queuedReports().length > 0) { const count = await flushReports(); if (count > 0) toast(`${count} queued reports synced.`); await refresh(); }
}

void boot().catch(error => {
  requiredElement('#app').innerHTML = `<div class="boot boot-error"><span class="boot-mark">p.</span><h1>We couldn’t load the pilot.</h1><p>${escapeHtml(errorMessage(error))}</p><button id="retry-boot" class="compare-button">Try again</button></div>`;
  requiredElement('#retry-boot').addEventListener('click', () => location.reload());
});
