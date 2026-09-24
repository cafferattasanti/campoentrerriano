// Open-Meteo: pronóstico por modelos numéricos (complemento y respaldo del SMN).
// Gratis y sin clave para uso NO comercial (límite: 10.000 consultas/día, 5.000/hora, 600/minuto).
// Uso comercial (publicidad o suscripciones): contratar plan y cargar OPEN_METEO_API_KEY.
// Licencia de datos CC BY 4.0: la app muestra la atribución.
import { getJson } from '../lib/http.js';
import { config } from '../config.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot } from '../db.js';

export const WMO = {
  0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla con escarcha',
  51: 'Llovizna débil', 53: 'Llovizna', 55: 'Llovizna intensa', 56: 'Llovizna helada', 57: 'Llovizna helada intensa',
  61: 'Lluvia débil', 63: 'Lluvia', 65: 'Lluvia fuerte', 66: 'Lluvia helada', 67: 'Lluvia helada fuerte',
  71: 'Nevada débil', 73: 'Nevada', 75: 'Nevada fuerte', 77: 'Granos de nieve',
  80: 'Chaparrones débiles', 81: 'Chaparrones', 82: 'Chaparrones fuertes',
  85: 'Chaparrones de nieve', 86: 'Chaparrones de nieve fuertes',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta fuerte con granizo',
};

export function degToDir(deg) {
  if (deg === null || deg === undefined) return null;
  const dirs = ['Norte', 'Noreste', 'Este', 'Sudeste', 'Sur', 'Sudoeste', 'Oeste', 'Noroeste'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function normalizeOpenMeteo(r) {
  const c = r.current || {};
  const d = r.daily || {};
  return {
    current: {
      observedAt: c.time ? c.time + ':00-03:00' : null,
      temp: c.temperature_2m ?? null,
      feelsLike: c.apparent_temperature ?? null,
      humidity: c.relative_humidity_2m ?? null,
      precipitation: c.precipitation ?? null,
      weather: WMO[c.weather_code] ?? null,
      code: c.weather_code ?? null,
      windSpeed: c.wind_speed_10m !== undefined ? Math.round(c.wind_speed_10m) : null,
      windDir: degToDir(c.wind_direction_10m),
      gust: c.wind_gusts_10m !== undefined ? Math.round(c.wind_gusts_10m) : null,
    },
    days: (d.time || []).map((date, i) => ({
      date,
      weather: WMO[d.weather_code?.[i]] ?? null,
      tMax: d.temperature_2m_max?.[i] ?? null,
      tMin: d.temperature_2m_min?.[i] ?? null,
      rainMm: d.precipitation_sum?.[i] ?? null,
      rainProb: d.precipitation_probability_max?.[i] ?? null,
      windMax: d.wind_speed_10m_max?.[i] !== undefined ? Math.round(d.wind_speed_10m_max[i]) : null,
      gustMax: d.wind_gusts_10m_max?.[i] !== undefined ? Math.round(d.wind_gusts_10m_max[i]) : null,
      windDir: degToDir(d.wind_direction_10m_dominant?.[i]),
    })),
    // Próximas 48 horas, hora por hora (para los avisos de lluvia, tormenta y viento).
    hours: (r.hourly?.time || []).map((t, i) => ({
      time: t,
      rainMm: r.hourly.precipitation?.[i] ?? null,
      rainProb: r.hourly.precipitation_probability?.[i] ?? null,
      code: r.hourly.weather_code?.[i] ?? null,
      gust: r.hourly.wind_gusts_10m?.[i] !== undefined && r.hourly.wind_gusts_10m[i] !== null ? Math.round(r.hourly.wind_gusts_10m[i]) : null,
      temp: r.hourly.temperature_2m?.[i] ?? null,
    })),
  };
}

export default {
  id: 'open-meteo',
  name: 'Open-Meteo — Pronóstico por modelos (respaldo y milímetros estimados)',
  org: 'Open-Meteo.com (datos de servicios meteorológicos nacionales, CC BY 4.0)',
  category: 'clima',
  url: 'https://open-meteo.com/',
  official: false,
  access: 'API pública. Sin clave para uso no comercial; con OPEN_METEO_API_KEY para uso comercial.',
  everyMin: 60,
  staleAfterMin: 180,
  // Primero la localidad por defecto (Gualeguay), después el resto en tandas chicas: si el servicio gratuito
  // limita la cantidad de consultas (HTTP 429), al menos la localidad principal queda actualizada.
  async run({ log } = {}) {
    const region = currentRegion();
    const all = region.localities;
    const first = all.filter((l) => l.id === region.defaultLocality);
    const rest = all.filter((l) => l.id !== region.defaultLocality);
    const groups = [first];
    for (let i = 0; i < rest.length; i += 10) groups.push(rest.slice(i, i + 10));
    let ok = 0;
    const errors = [];
    for (const [gi, locs] of groups.entries()) {
      if (!locs.length) continue;
      if (gi > 0) await sleep(2000);
      try {
        let data;
        try { data = await getJson(url(locs)); } catch (e) {
          if (e.status !== 429) throw e;
          await sleep(20000);
          data = await getJson(url(locs));
        }
        const arr = Array.isArray(data) ? data : [data];
        if (arr.length !== locs.length) throw new Error(`Open-Meteo devolvió ${arr.length} puntos para ${locs.length} localidades`);
        arr.forEach((r, i) => putSnapshot('open-meteo', locs[i].id, normalizeOpenMeteo(r), r.current?.time || null));
        ok += arr.length;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (errors.length) log?.('warn', `${errors.length} tanda(s) sin datos: ${errors[0]}`);
    if (!ok) throw new Error(errors[0] || 'Sin datos');
    return { items: ok, message: `${ok}/${all.length} localidades` };
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function url(locs) {
  const params = new URLSearchParams({
    latitude: locs.map((l) => l.lat).join(','),
    longitude: locs.map((l) => l.lon).join(','),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
    hourly: 'precipitation,precipitation_probability,weather_code,wind_gusts_10m,temperature_2m',
    forecast_hours: '48',
    timezone: config.timezone,
    forecast_days: '7',
    wind_speed_unit: 'kmh',
  });
  let base = 'https://api.open-meteo.com/v1/forecast';
  if (config.openMeteoApiKey) {
    base = 'https://customer-api.open-meteo.com/v1/forecast';
    params.set('apikey', config.openMeteoApiKey);
  }
  return `${base}?${params}`;
}
