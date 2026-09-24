// MET Norway (Instituto Meteorológico de Noruega) — pronóstico por modelo, gratis y sin clave, para cualquier punto.
// Se usa como RESPALDO de Open-Meteo: solo se consulta para las localidades que no tienen un dato reciente de
// Open-Meteo (por ejemplo, cuando el servicio gratuito de Open-Meteo rechaza el servidor por exceso de consultas).
// Licencia de datos: CC BY 4.0 (atribución «Datos de MET Norway»). Condiciones: identificarse con un User-Agent
// con contacto y no superar 20 consultas por segundo (acá: ~1 por segundo como máximo).
import { getJson } from '../lib/http.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot, getSnapshot } from '../db.js';
import { degToDir } from './open-meteo.js';

const API = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const UA = 'campoentrerriano/1.0 https://github.com/cafferattasanti/campoentrerriano';

// Símbolos de MET → descripción en castellano y un código tipo WMO (para los avisos).
const SYM = {
  clearsky: ['Despejado', 0], fair: ['Mayormente despejado', 1], partlycloudy: ['Parcialmente nublado', 2], cloudy: ['Nublado', 3], fog: ['Niebla', 45],
  lightrain: ['Lluvia débil', 61], rain: ['Lluvia', 63], heavyrain: ['Lluvia fuerte', 65],
  lightrainshowers: ['Chaparrones débiles', 80], rainshowers: ['Chaparrones', 81], heavyrainshowers: ['Chaparrones fuertes', 82],
  lightrainandthunder: ['Lluvia débil y tormenta', 95], rainandthunder: ['Lluvia y tormenta', 95], heavyrainandthunder: ['Lluvia fuerte y tormenta', 95],
  lightrainshowersandthunder: ['Chaparrones y tormenta', 95], rainshowersandthunder: ['Chaparrones y tormenta', 95], heavyrainshowersandthunder: ['Chaparrones fuertes y tormenta', 95],
  lightsleet: ['Aguanieve débil', 66], sleet: ['Aguanieve', 66], heavysleet: ['Aguanieve fuerte', 67], lightsleetshowers: ['Aguanieve', 66], sleetshowers: ['Aguanieve', 66], heavysleetshowers: ['Aguanieve fuerte', 67],
  lightsnow: ['Nevada débil', 71], snow: ['Nevada', 73], heavysnow: ['Nevada fuerte', 75], lightsnowshowers: ['Nevada débil', 71], snowshowers: ['Nevada', 73], heavysnowshowers: ['Nevada fuerte', 75],
};
const RANK = { 0: 0, 1: 1, 2: 2, 3: 3, 45: 3, 61: 4, 80: 4, 63: 5, 81: 5, 66: 5, 71: 5, 65: 6, 82: 6, 67: 6, 73: 6, 75: 6, 95: 7 };
function sym(code) {
  if (!code) return { text: null, code: null };
  const s = SYM[String(code).replace(/_(day|night|polartwilight)$/, '')];
  return s ? { text: s[0], code: s[1] } : { text: null, code: null };
}
// UTC → hora local de Argentina (UTC-3, sin horario de verano): "2026-09-24T17:00"
const local = (iso) => new Date(Date.parse(iso) - 3 * 36e5).toISOString().slice(0, 16);
const kmh = (ms) => (ms === undefined || ms === null ? null : Math.round(ms * 3.6));

export function normalizeMet(j) {
  const ts = j?.properties?.timeseries || [];
  if (!ts.length) return null;
  const f = ts[0];
  const i0 = f.data?.instant?.details || {};
  const n1 = f.data?.next_1_hours;
  const s0 = sym(n1?.summary?.symbol_code || f.data?.next_6_hours?.summary?.symbol_code);
  const current = {
    observedAt: local(f.time) + ':00-03:00',
    temp: i0.air_temperature ?? null,
    feelsLike: i0.apparent_air_temperature ?? null,
    humidity: i0.relative_humidity !== undefined ? Math.round(i0.relative_humidity) : null,
    precipitation: n1?.details?.precipitation_amount ?? null,
    weather: s0.text,
    code: s0.code,
    windSpeed: kmh(i0.wind_speed),
    windDir: degToDir(i0.wind_from_direction),
    gust: kmh(i0.wind_speed_of_gust),
  };
  const t0 = Date.parse(f.time);
  const hours = ts.filter((e) => e.data?.next_1_hours && Date.parse(e.time) < t0 + 72 * 36e5).map((e) => {
    const s = sym(e.data.next_1_hours.summary?.symbol_code);
    const d = e.data.next_1_hours.details || {};
    return { time: local(e.time), rainMm: d.precipitation_amount ?? null, rainProb: d.probability_of_precipitation ?? null, code: s.code, gust: kmh(e.data.instant?.details?.wind_speed_of_gust), temp: e.data.instant?.details?.air_temperature ?? null };
  });
  const byDay = {};
  for (const e of ts) {
    const date = local(e.time).slice(0, 10);
    const d = (byDay[date] ||= { date, temps: [], rain: 0, probs: [], wind: [], gust: [], syms: [], noon: null });
    const inst = e.data?.instant?.details || {};
    if (inst.air_temperature !== undefined) d.temps.push(inst.air_temperature);
    if (inst.wind_speed !== undefined) d.wind.push({ v: inst.wind_speed, dir: inst.wind_from_direction });
    if (inst.wind_speed_of_gust !== undefined) d.gust.push(inst.wind_speed_of_gust);
    const n = e.data?.next_1_hours || e.data?.next_6_hours;
    if (e.data?.next_1_hours) d.rain += e.data.next_1_hours.details?.precipitation_amount || 0;
    else if (e.data?.next_6_hours) { d.rain += e.data.next_6_hours.details?.precipitation_amount || 0; const x = e.data.next_6_hours.details || {}; if (x.air_temperature_max !== undefined) d.temps.push(x.air_temperature_max, x.air_temperature_min); }
    if (n?.details?.probability_of_precipitation !== undefined) d.probs.push(n.details.probability_of_precipitation);
    const s = sym(n?.summary?.symbol_code);
    if (s.code !== null) d.syms.push(s);
    const h = Number(local(e.time).slice(11, 13));
    if (h >= 12 && h <= 15 && !d.noon && s.code !== null) d.noon = s;
  }
  const days = Object.values(byDay).filter((d) => d.temps.length).map((d) => {
    const rainy = d.syms.filter((s) => s.code >= 61).sort((a, b) => RANK[b.code] - RANK[a.code])[0];
    const w = d.wind.sort((a, b) => b.v - a.v)[0];
    const main = d.rain >= 1 && rainy ? rainy : d.noon || d.syms[0] || { text: null };
    return {
      date: d.date,
      weather: main.text,
      tMax: Math.round(Math.max(...d.temps) * 10) / 10,
      tMin: Math.round(Math.min(...d.temps) * 10) / 10,
      rainMm: Math.round(d.rain * 10) / 10,
      rainProb: d.probs.length ? Math.max(...d.probs) : null,
      windMax: w ? kmh(w.v) : null,
      gustMax: d.gust.length ? kmh(Math.max(...d.gust)) : null,
      windDir: w ? degToDir(w.dir) : null,
    };
  });
  return { provider: 'met', current, days, hours };
}

export default {
  id: 'met-no',
  name: 'MET Norway — Pronóstico por modelo (respaldo cuando Open-Meteo no responde)',
  org: 'Instituto Meteorológico de Noruega (MET Norway, CC BY 4.0)',
  category: 'clima',
  url: 'https://api.met.no/',
  official: false,
  officialNote: 'Servicio meteorológico público de Noruega; pronóstico global por modelo. Solo se usa si Open-Meteo no tiene dato reciente.',
  access: 'API pública. Sin clave.',
  everyMin: 60,
  staleAfterMin: 240,
  async run({ log } = {}) {
    const region = currentRegion();
    const need = region.localities.filter((l) => {
      const s = getSnapshot('open-meteo', l.id);
      return !s || Date.now() - Date.parse(s.fetchedAt) > 150 * 60e3;
    });
    if (!need.length) return { items: 0, message: 'No hace falta: Open-Meteo está al día.' };
    // Primero la localidad por defecto.
    need.sort((a, b) => (b.id === region.defaultLocality) - (a.id === region.defaultLocality));
    let ok = 0;
    const errors = [];
    for (const l of need) {
      try {
        const j = await getJson(`${API}?lat=${l.lat.toFixed(4)}&lon=${l.lon.toFixed(4)}`, { headers: { 'User-Agent': UA } });
        const n = normalizeMet(j);
        if (!n) throw new Error('respuesta sin datos');
        putSnapshot('met-no', l.id, n, n.current.observedAt);
        ok++;
      } catch (e) {
        errors.push(`${l.name}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
    if (errors.length) log?.('warn', errors.slice(0, 3).join(' | '));
    if (!ok) throw new Error(errors[0] || 'Sin datos');
    return { items: ok, message: `${ok}/${need.length} localidades sin dato de Open-Meteo` };
  },
};
