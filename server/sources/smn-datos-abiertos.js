// Datos abiertos oficiales del SMN (descarga pública, sin clave):
//  - "tiepre": tiempo presente observado en estaciones.
//  - "pron5d": pronóstico por modelo numérico a 5 días, cada 3 horas (el propio SMN aclara que puede diferir del pronóstico emitido).
import { getBuffer } from '../lib/http.js';
import { unzip, parseArNumber } from '../lib/text.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot } from '../db.js';

const BASE = 'https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=';
const MON = { ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12 };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('latin1').decode(buf);
  }
}

// "Paraná;23-septiembre-2026;12:00;Algo nublado;15 km;16.8;No se calcula; 47;Norte  27;1009.2 /"
export function parseTiepre(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*\/\s*$/, '').trim();
    if (!line) continue;
    const f = line.split(';').map((s) => s.trim());
    if (f.length < 10) continue;
    const [name, fecha, hora, cielo, visib, temp, st, hum, viento, pres] = f;
    const dm = fecha.match(/(\d{1,2})-([a-záéíóú]+)-(\d{4})/i);
    let observedAt = null;
    if (dm) {
      const mi = MESES.indexOf(dm[2].toLowerCase().replace('setiembre', 'septiembre'));
      if (mi >= 0) observedAt = `${dm[3]}-${String(mi + 1).padStart(2, '0')}-${dm[1].padStart(2, '0')}T${hora.padStart(5, '0')}:00-03:00`;
    }
    const wm = viento.match(/^([A-Za-zÁÉÍÓÚáéíóú ]+?)\s+(\d+)/);
    out[name] = {
      station: name,
      observedAt,
      weather: cielo || null,
      visibility: visib || null,
      temp: parseArNumber(temp.replace('.', ',')),
      feelsLike: /\d/.test(st) ? parseArNumber(st.replace('.', ',')) : null,
      humidity: parseArNumber(hum),
      windDir: wm ? wm[1].trim() : (/calma/i.test(viento) ? 'Calma' : null),
      windSpeed: wm ? Number(wm[2]) : (/calma/i.test(viento) ? 0 : null),
      pressure: parseArNumber(pres.replace('.', ',')),
    };
  }
  return out;
}

//  " PARANA_AERO" ... "  23/SEP/2026 00Hs.   5.2   14 |  13   0.0"
export function parsePron5d(text, wanted) {
  const want = new Set(wanted);
  const out = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.trim();
    if (/^[A-Z][A-Z_]+$/.test(name)) { current = want.has(name) ? name : null; if (current) out[current] = []; continue; }
    if (!current) continue;
    const m = raw.match(/(\d{2})\/([A-Z]{3})\/(\d{4})\s+(\d{2})Hs\.\s+(-?[\d.]+)\s+(\d+)\s*\|\s*(\d+)\s+([\d.]+)/);
    if (!m) continue;
    out[current].push({
      date: `${m[3]}-${String(MON[m[2]] || 0).padStart(2, '0')}-${m[1]}`,
      hour: Number(m[4]),
      temp: Number(m[5]),
      windDeg: Number(m[6]),
      windKmh: Number(m[7]),
      rainMm: Number(m[8]),
    });
  }
  const daily = {};
  for (const [st, rows] of Object.entries(out)) {
    const byDay = {};
    for (const r of rows) (byDay[r.date] ||= []).push(r);
    daily[st] = Object.entries(byDay).map(([date, rs]) => ({
      date,
      tMin: Math.min(...rs.map((r) => r.temp)),
      tMax: Math.max(...rs.map((r) => r.temp)),
      rainMm: Math.round(rs.reduce((a, r) => a + r.rainMm, 0) * 10) / 10,
      windMaxKmh: Math.max(...rs.map((r) => r.windKmh)),
      hours: rs.length,
    }));
  }
  return daily;
}

export default {
  id: 'smn-datos-abiertos',
  name: 'SMN — Datos abiertos (tiempo presente y pronóstico 5 días por modelo)',
  org: 'Servicio Meteorológico Nacional',
  category: 'clima',
  url: 'https://www.smn.gob.ar/descarga-de-datos',
  official: true,
  access: 'Descarga pública oficial. Sin API Key.',
  everyMin: 60,
  staleAfterMin: 240,
  async run({ log }) {
    const region = currentRegion();
    let items = 0;
    // Tiempo presente
    const tz = unzip(await getBuffer(BASE + 'tiepre'));
    if (!tz.length) throw new Error('El archivo de tiempo presente vino vacío');
    const obs = parseTiepre(decode(tz[0].data));
    for (const st of region.stations) {
      const o = obs[st.obsName];
      if (o) { putSnapshot('smn-observacion', st.id, o, o.observedAt); items++; }
    }
    // Pronóstico por modelo (se publica una vez por día; basta refrescarlo cada tanto).
    try {
      const pz = unzip(await getBuffer(BASE + 'pron5d'));
      if (pz.length) {
        const daily = parsePron5d(decode(pz[0].data), region.stations.map((s) => s.pron5dName));
        for (const st of region.stations) {
          if (daily[st.pron5dName]?.length) { putSnapshot('smn-modelo', st.id, { file: pz[0].name, days: daily[st.pron5dName] }, pz[0].name); items++; }
        }
      }
    } catch (e) {
      log('warn', `Pronóstico 5 días (modelo) no disponible: ${e.message}`);
    }
    if (!items) throw new Error('No se encontraron estaciones de la provincia en los archivos del SMN');
    return { items, message: `${items} registros de estaciones` };
  },
};
