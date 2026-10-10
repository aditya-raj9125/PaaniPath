/** UI primitives shared across planner, dialogs, map and reports. No framework runtime. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
export function requiredElement<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Required UI element missing: ${selector}`);
  return element;
}
export function icon(name: string, size = 20): string {
  const paths: Readonly<Record<string, string>> = {
    drop: '<path d="M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
    route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h9a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h9"/>',
    map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16m6-14v16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    chevron: '<path d="m8 4 8 8-8 8"/>',
    pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
    shield: '<path d="m12 3 8 3v6c0 6-8 9-8 9s-8-3-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    warning: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>',
    scooter: '<circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="M8 18h7l-3-7h5l2 7M10 7h5m2 4-2-7h-3"/>',
    motorbike: '<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m5 17 5-8 5 8H5m5-8h6l3 8m-3-8-2-5h-3m-5 5h4"/>',
    car: '<path d="m3 11 3-6h12l3 6v8H3Zm0 0h18M6 19v2m12-2v2M6 14h2m8 0h2"/>',
    auto: '<path d="M4 17V8l4-4h9l3 4v9ZM4 10h16M12 4v6"/><circle cx="7" cy="18" r="3"/><circle cx="18" cy="18" r="3"/>',
    bus: '<rect x="4" y="3" width="16" height="17" rx="3"/><path d="M4 11h16M12 3v8M7 15h1m8 0h1M7 20v2m10-2v2"/>',
    locate: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
    layers: '<path d="m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5m-18 5 9 5 9-5"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    play: '<path d="m8 4 13 8-13 8Z"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
    photo: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="m8 5 2-3h4l2 3"/><circle cx="12" cy="12" r="4"/>',
    cloud: '<path d="M7 17a5 5 0 1 1 1-10 7 7 0 0 1 13 4 4 4 0 0 1-1 8H7"/><path d="m7 20-1 2m6-2-1 2m6-2-1 2"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
}
export function minutes(seconds: number): string { return `${Math.max(1, Math.round(seconds / 60))} min`; }
export function kilometres(metres: number): string { return `${(metres / 1000).toFixed(1)} km`; }
