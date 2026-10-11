import type { DemoJourney, Place } from '@paanipath/domain';
import { NCR_PLACES } from './ncr.ts';

function place(id: string): Place {
  const found = NCR_PLACES.find(candidate => candidate.id === id);
  if (found === undefined) throw new Error(`Missing demo journey place: ${id}`);
  return found;
}

/** Stop shortcuts only. Geometry, exposure and alternatives always come from live API requests. */
export const DEMO_JOURNEYS: readonly DemoJourney[] = [
  { id: 'journey-1', title: 'Central Delhi: Connaught Place to India Gate', locations: ['cp', 'india-gate'].map(place) },
  { id: 'journey-2', title: 'Gurugram: Hero Honda Chowk to Basai Chowk', locations: ['ggn-hero-honda', 'ggn-basai-chowk'].map(place) },
  { id: 'journey-3', title: 'Gurugram: Sector 30 to Sector 40', locations: ['ggn-sector-30', 'ggn-sector-40'].map(place) },
  { id: 'journey-4', title: 'Noida: Sector 18 to Sector 62', locations: ['noida-18', 'noida-62'].map(place) },
  { id: 'journey-5', title: 'Greater Noida: local road hotspot crossing', locations: [
    { id: 'gn-demo-north', name: 'Greater Noida demo road approach (north)', coords: [28.475421, 77.483587] },
    { id: 'gn-demo-south', name: 'Greater Noida demo road exit (south)', coords: [28.462985, 77.482297] },
  ] },
  { id: 'journey-6', title: 'Ghaziabad: Indirapuram to Crossings Republik', locations: ['indira', 'crossings'].map(place) },
  { id: 'journey-7', title: 'Delhi: Connaught Place to ITO', locations: ['cp', 'ito'].map(place) },
  { id: 'journey-8', title: 'Gurugram with a stop: Hero Honda → Basai → Rajiv Chowk', locations: ['ggn-hero-honda', 'ggn-basai-chowk', 'ggn-rajiv-chowk'].map(place) },
  { id: 'journey-9', title: 'Delhi with a stop: Connaught Place → ITO → India Gate', locations: ['cp', 'ito', 'india-gate'].map(place) },
  { id: 'journey-10', title: 'Delhi with two stops: Connaught Place → Minto Bridge → ITO → India Gate', locations: ['cp', 'minto', 'ito', 'india-gate'].map(place) },
];
