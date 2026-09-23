// Pronóstico oficial por localidad y estado actual (SMN).
import { smnGet, PERIODS } from './smn-client.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot, getSetting, setSetting } from '../db.js';
import { mapLimit } from '../lib/pool.js';

export function normalizeForecast(fc) {
  const days = (fc.forecast || []).map((d) => {
    const periods = [];
    for (const [key, label] of Object.entries(PERIODS)) {
      const p = d[key];
      if (!p) continue;
      periods.push({
        key, label,
        temp: p.temperature ?? null,
        humidity: p.humidity ?? null,
        weather: p.weather?.description || null,
        weatherId: p.weather?.id ?? null,
        rainProb: Array.isArray(p.rain_prob_range) ? p.rain_prob_range : null,
        rainMm: typeof p.rain06h === 'number' ? p.rain06h : null,
        windDir: p.wind?.direction || null,
        windSpeed: Array.isArray(p.wind?.speed_range) ? p.wind.speed_range : null,
        gust: Array.isArray(p.gust_range) ? p.gust_range : null,
        visibility: p.visibility || null,
      });
    }
    const probs = periods.map((p) => p.rainProb?.[1]).filter((x) => typeof x === 'number');
    const mms = periods.map((p) => p.rainMm).filter((x) => typeof x === 'number');
    const main = periods.find((p) => p.key === 'afternoon') || periods[periods.length - 1] || null;
    return {
      date: d.date,
      tMin: d.temp_min ?? null,
      tMax: d.temp_max ?? null,
      humMin: d.humidity_min ?? null,
      humMax: d.humidity_max ?? null,
      summary: main?.weather || null,
      rainProbMax: probs.length ? Math.max(...probs) : null,
      rainMm: mms.length ? Math.round(mms.reduce((a, b) => a + b, 0) * 10) / 10 : null,
      rainMmComplete: mms.length === periods.length && periods.length > 0,
      periods,
    };
  });
  return { updated: fc.updated || null, location: fc.location?.name || null, days };
}

export function normalizeWeather(w) {
  if (!w || typeof w !== 'object') return null;
  return {
    observedAt: w.date || null,
    temp: w.temperature ?? null,
    feelsLike: w.feels_like ?? null,
    humidity: w.humidity ?? null,
    pressure: w.pressure ?? null,
    weather: w.weather?.description || null,
    windDir: w.wind?.direction || null,
    windSpeed: w.wind?.speed ?? null,
    stationId: w.station_id ?? null,
    distanceKm: w.location?.distance ?? null,
  };
}

export default {
  id: 'smn-pronostico',
  name: 'SMN — Pronóstico por localidad y tiempo actual',
  org: 'Servicio Meteorológico Nacional',
  category: 'clima',
  url: 'https://www.smn.gob.ar/pronostico',
  official: true,
  // Desactivada por defecto: el SMN bloquea (HTTP 403) el acceso automatizado a este servicio.
  // Activarla desde /admin solo si el SMN otorga acceso formal.
  enabledByDefault: false,
  access: 'Servicio web del sitio del SMN (no documentado públicamente). Sin API Key.',
  everyMin: 60,
  staleAfterMin: 180,
  async run({ log }) {
    const region = currentRegion();
    const areaMap = getSetting('smn_area_map', {});
    const today = new Date().toISOString().slice(0, 10);
    let ok = 0;
    const res = await mapLimit(region.localities, 3, async (loc) => {
      const [fc, w] = await Promise.all([
        smnGet(`/forecast/location/${loc.smnId}`),
        smnGet(`/weather/location/${loc.smnId}`).catch(() => null),
      ]);
      const forecast = normalizeForecast(fc);
      if (!forecast.days.length) throw new Error(`Pronóstico vacío para ${loc.name}`);
      putSnapshot('smn-pronostico', loc.id, forecast, forecast.updated);
      const current = normalizeWeather(w);
      if (current) putSnapshot('smn-actual', loc.id, current, current.observedAt);
      // Zona de alerta del SMN para la localidad (se refresca una vez por día).
      if (!areaMap[loc.id] || areaMap[loc.id].checked !== today) {
        const a = await smnGet(`/warning/alert/location/${loc.smnId}`).catch(() => null);
        if (a?.area_id) areaMap[loc.id] = { area: a.area_id, checked: today };
      }
      ok++;
    });
    setSetting('smn_area_map', areaMap);
    const failed = res.filter((r) => !r.ok);
    if (failed.length) log('warn', `${failed.length} localidades sin pronóstico SMN: ${failed[0].error.message}`);
    if (!ok) throw failed[0]?.error || new Error('Sin datos');
    return { items: ok, message: `${ok}/${region.localities.length} localidades` };
  },
};
