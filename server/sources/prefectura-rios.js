// Prefectura Naval Argentina — Alturas de los ríos (registro oficial, se actualiza cada 12 horas aprox.).
// Página pública: https://contenidosweb.prefecturanaval.gob.ar/alturas/
import { getText } from '../lib/http.js';
import { stripTags } from '../lib/text.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot } from '../db.js';

export const URL_ALTURAS = 'https://contenidosweb.prefecturanaval.gob.ar/alturas/';
const MON = { ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12 };

const num = (s) => {
  const t = String(s || '').trim();
  if (!t || /^s\/?e$/i.test(t) || t === '-') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// "24/SEP/26 - 1200" -> "2026-09-24T12:00:00-03:00"
export function prefDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/([A-Z]{3})\/(\d{2,4})\s*-\s*(\d{2})(\d{2})/i);
  if (!m || !MON[m[2].toUpperCase()]) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${String(MON[m[2].toUpperCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4]}:${m[5]}:00-03:00`;
}

export function parseAlturas(html) {
  const rows = [];
  const re = /<tr[^>]*>\s*<th data-label="Puerto:">([\s\S]*?)<\/th>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cells = {};
    const cre = /<td data-label="([^"]+)"[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = cre.exec(m[2]))) cells[c[1].replace(/:$/, '').trim()] = stripTags(c[2]);
    const img = (m[2].match(/img\/(\w+)\.svg/) || [])[1] || null;
    rows.push({
      port: stripTags(m[1]).toUpperCase(),
      river: (cells['Río'] || '').toUpperCase(),
      height: num(cells['Ultimo Registro']),
      variation: num(cells['Variacion']),
      periodH: num(cells['Periodo']),
      at: prefDate(cells['Fecha Hora']),
      state: (cells['Estado'] || '').replace(/\.$/, '').toUpperCase() || null, // CRECE / BAJA / ESTAC / S/E
      icon: img,
      previous: num(cells['Registro Anterior']),
      previousAt: prefDate(cells['Fecha Anterior']),
      alert: num(cells['Alerta']),
      evacuation: num(cells['Evacuación'] ?? cells['Evacuacion']),
    });
  }
  return rows;
}

// Estado frente a los niveles de referencia publicados por Prefectura.
export function levelStatus(r) {
  if (r.height === null) return { key: 'sd', label: 'Sin dato' };
  if (r.evacuation !== null && r.height >= r.evacuation) return { key: 'evacuacion', label: 'Nivel de EVACUACIÓN' };
  if (r.alert !== null && r.height >= r.alert) return { key: 'alerta', label: 'Nivel de ALERTA' };
  if (r.alert !== null && r.height >= r.alert - 0.5) return { key: 'cerca', label: 'Cerca del nivel de alerta' };
  return { key: 'normal', label: 'Por debajo del nivel de alerta' };
}

export function selectRegionRivers(rows, list) {
  return list.map((w) => {
    const r = rows.find((x) => x.port === w.port && x.river === w.river) || rows.find((x) => x.port === w.port);
    return r ? { ...r, label: w.label, main: !!w.main, status: levelStatus(r) } : { port: w.port, river: w.river, label: w.label, main: !!w.main, missing: true };
  });
}

export default {
  id: 'prefectura-rios',
  name: 'Prefectura Naval Argentina — Altura de los ríos',
  org: 'Prefectura Naval Argentina',
  category: 'rios',
  url: URL_ALTURAS,
  official: true,
  access: 'Página pública oficial. Sin API Key. Prefectura publica una lectura cada 12 horas aprox.',
  everyMin: 60,
  staleAfterMin: 60 * 36,
  async run() {
    const html = await getText(URL_ALTURAS, { headers: { Accept: 'text/html' } });
    const rows = parseAlturas(html);
    if (!rows.length) throw new Error('No se encontró la tabla de alturas (¿cambió el formato?)');
    const list = selectRegionRivers(rows, currentRegion().rivers);
    const found = list.filter((r) => !r.missing);
    if (!found.length) throw new Error('No aparecen las estaciones de Entre Ríos en la tabla de Prefectura');
    const main = list.find((r) => r.main);
    putSnapshot('prefectura-rios', 'entre-rios', { stations: list }, main?.at || found[0].at);
    return { items: found.length, message: `${found.length} estaciones. ${main?.label}: ${main?.height ?? 's/d'} m (${main?.at || 's/d'})` };
  },
};
