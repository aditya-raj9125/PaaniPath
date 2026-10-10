import type { Place } from '@paanipath/domain';
import { errorMessage } from '@paanipath/domain';
import { escapeHtml, icon } from '@paanipath/ui';
import { api } from './api.ts';
import { state } from './state.ts';

/** Delegated accessible combobox: bounded debounce, keyboard selection and stale-response cancellation. */
export class PlacePicker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private index = -1;
  private active = -1;
  private results: readonly Place[] = [];
  private generation = 0;
  constructor(private readonly select: (index: number, place: Place) => void) {}

  bind(): void {
    document.addEventListener('input', event => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.dataset.location !== undefined) this.changed(input);
    });
    document.addEventListener('focusin', event => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.dataset.location !== undefined) this.changed(input, false);
    });
    document.addEventListener('keydown', event => this.keydown(event));
    document.addEventListener('focusout', event => {
      if (event.target instanceof HTMLInputElement && event.target.dataset.location !== undefined &&
        !(event.relatedTarget instanceof Element && event.target.closest('.stop-input')?.contains(event.relatedTarget))) this.close();
    });
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-place-option]') : null;
      if (button !== null) this.choose(Number(button.dataset.placeOption));
      else if (event.target instanceof Element && !event.target.closest('.stop-input')) this.close();
    });
  }
  close(): void {
    clearTimeout(this.timer); this.controller?.abort(); this.generation++;
    document.querySelectorAll<HTMLElement>('.place-results').forEach(element => { element.hidden = true; });
    document.querySelectorAll<HTMLInputElement>('[data-location]').forEach(input => { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); });
  }
  private changed(input: HTMLInputElement, edit = true): void {
    this.close(); this.index = Number(input.dataset.location); this.active = -1;
    const query = input.value.trim();
    if (edit) state.drafts[this.index] = input.value;
    if (query.length < 2) { this.show([], 'Type a place, sector, landmark or address in NCR.'); return; }
    const words = query.toLowerCase().split(/\s+/);
    const local = (state.bootstrap?.places ?? []).filter(place => words.every(word => place.name.toLowerCase().includes(word))).slice(0, 6);
    this.show(local, edit ? 'Searching NCR addresses…' : 'Choose a saved result, or type to search NCR addresses.');
    if (!edit) return;
    const generation = this.generation;
    this.timer = setTimeout(() => { void this.remote(query, generation); }, 1200);
  }
  private async remote(query: string, generation: number): Promise<void> {
    const controller = new AbortController(); this.controller = controller;
    try {
      const response = await api.places(query, controller.signal);
      if (controller.signal.aborted || generation !== this.generation) return;
      this.show(response.places, response.warning ?? (response.places.length ? 'Select a result · search data © OpenStreetMap contributors' : 'No matches. Try a city/sector or pick the location on the map.'));
    } catch (error) {
      if (!controller.signal.aborted && generation === this.generation) this.show(this.results, errorMessage(error));
    }
  }
  private show(places: readonly Place[], message: string): void {
    this.results = places; this.active = -1;
    const list = document.getElementById(`results-${this.index}`);
    const input = document.getElementById(`stop-${this.index}`);
    if (list === null || input === null) return;
    input.removeAttribute('aria-activedescendant');
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    list.innerHTML = places.map((place, index) => `<button type="button" id="result-${this.index}-${index}" role="option" tabindex="-1" data-place-option="${index}" aria-selected="${index === this.active}">${icon('pin', 15)}<span>${escapeHtml(place.name)}</span></button>`).join('') + `<p role="status">${escapeHtml(message)}</p>`;
  }
  private keydown(event: KeyboardEvent): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.dataset.location === undefined) return;
    if (event.key === 'Escape') { this.close(); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.results.length > 0) this.choose(this.active >= 0 ? this.active : 0);
      else { clearTimeout(this.timer); void this.remote(input.value.trim(), this.generation); }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (this.results.length === 0) return;
    event.preventDefault();
    this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.results.length) % this.results.length;
    input.setAttribute('aria-activedescendant', `result-${this.index}-${this.active}`);
    document.querySelectorAll<HTMLElement>(`#results-${this.index} [role="option"]`).forEach((option, index) => option.setAttribute('aria-selected', String(index === this.active)));
  }
  private choose(index: number): void {
    const place = this.results[index]; const stop = this.index;
    if (place === undefined || stop < 0) return;
    this.close(); delete state.drafts[stop]; this.select(stop, place);
  }
}
