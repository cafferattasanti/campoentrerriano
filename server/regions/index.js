import entreRios from './entre-rios.js';
import { config } from '../config.js';

// Registrar acá nuevas provincias: { 'santa-fe': santaFe, ... }
export const REGIONS = { 'entre-rios': entreRios };

export function currentRegion() {
  const r = REGIONS[config.region];
  if (!r) throw new Error(`Región desconocida: ${config.region}`);
  return r;
}

export function findLocality(id) {
  const r = currentRegion();
  return r.localities.find((l) => l.id === id) || r.localities.find((l) => l.id === r.defaultLocality);
}

function dist(a, b) {
  const dx = (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dy = a.lat - b.lat;
  return Math.sqrt(dx * dx + dy * dy) * 111; // km aprox.
}

export function nearestStation(loc) {
  const r = currentRegion();
  let best = null;
  for (const s of r.stations) {
    const d = dist(loc, s);
    if (!best || d < best.km) best = { ...s, km: Math.round(d) };
  }
  return best;
}
