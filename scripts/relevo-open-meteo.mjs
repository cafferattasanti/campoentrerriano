// Lo ejecuta GitHub Actions cada hora (ver .github/workflows/datos-clima.yml).
// Descarga el pronóstico de Open-Meteo para todas las localidades y lo guarda en datos/open-meteo.json
// (rama "datos"). El servidor público lo usa cuando Open-Meteo le niega el acceso directo por exceso de
// consultas en su IP compartida. Es exactamente el mismo dato de Open-Meteo, con probabilidad de lluvia.
import { writeFileSync, mkdirSync } from 'node:fs';
import region from '../server/regions/entre-rios.js';

const locs = region.localities;
const params = new URLSearchParams({
  latitude: locs.map((l) => l.lat).join(','),
  longitude: locs.map((l) => l.lon).join(','),
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
  hourly: 'precipitation,precipitation_probability,weather_code,wind_gusts_10m,temperature_2m',
  forecast_hours: '48',
  timezone: 'America/Argentina/Buenos_Aires',
  forecast_days: '7',
  wind_speed_unit: 'kmh',
});
let data = null;
for (let intento = 1; intento <= 3 && !data; intento++) {
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + params, { headers: { 'User-Agent': 'campoentrerriano-relevo/1.0 (github.com/cafferattasanti/campoentrerriano)' } });
  if (r.ok) data = await r.json();
  else { console.log('Open-Meteo respondió', r.status); await new Promise((s) => setTimeout(s, 20000)); }
}
if (!data) process.exit(1);
const arr = Array.isArray(data) ? data : [data];
if (arr.length !== locs.length) { console.log('cantidad inesperada', arr.length); process.exit(1); }
mkdirSync('salida', { recursive: true });
writeFileSync('salida/open-meteo.json', JSON.stringify({ generado: new Date().toISOString(), fuente: 'Open-Meteo.com (CC BY 4.0)', ids: locs.map((l) => l.id), datos: arr }));
console.log('OK', arr.length, 'localidades');
