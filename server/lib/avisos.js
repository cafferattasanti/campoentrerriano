// Avisos de lluvia y tiempo para el productor, calculados con el pronóstico hora por hora (Open-Meteo)
// y la observación del SMN cuando hay una estación cerca. Criterio pedido: ROJO solo si llueve ahora o si la
// lluvia prevista para hoy/mañana es probable Y de cantidad considerable. Nada de alarmar por lloviznas.
//
//  LLUEVE AHORA (rojo): observación del SMN con lluvia/tormenta (estación a ≤ 40 km) o, si no hay, el modelo
//     indica ≥ 0,2 mm en la hora actual o código de lluvia/tormenta.
//  LLUVIA PREVISTA HOY / MAÑANA (rojo): ≥ 5 mm con probabilidad ≥ 60 %, o ≥ 10 mm con probabilidad ≥ 40 %.
//  Posible lluvia (amarillo): probabilidad ≥ 40 % y ≥ 1 mm. Por debajo de eso no se avisa.
//  Tormenta (amarillo; rojo si además es lluvia fuerte): código 95-99 con probabilidad ≥ 40 %.
//  Granizo (amarillo, el modelo lo indica como posible): códigos 96 y 99.
//  Viento: ráfagas ≥ 60 km/h amarillo, ≥ 80 km/h rojo.
//  Helada: mínima ≤ 2 °C amarillo (posible helada), ≤ -2 °C rojo (helada fuerte).
//  Calor: máxima ≥ 37 °C amarillo, ≥ 40 °C rojo.
export const CRITERIOS = [
  'LLUEVE AHORA (rojo): el SMN observa lluvia en una estación cercana, o el modelo indica al menos 0,2 mm en la hora actual.',
  'LLUVIA PREVISTA (rojo): 5 mm o más con probabilidad de 60 % o más, o 10 mm o más con probabilidad de 40 % o más.',
  'Posible lluvia (amarillo): probabilidad de 40 % o más y al menos 1 mm. Con menos no se avisa.',
  'Tormentas: probabilidad de 40 % o más. Granizo: cuando el modelo lo indica (es orientativo).',
  'Viento: ráfagas de 60 km/h (amarillo) u 80 km/h o más (rojo).',
  'Helada: mínima de 2 °C o menos (amarillo), −2 °C o menos (rojo). Calor: máxima de 37 °C (amarillo), 40 °C o más (rojo).',
];

const RAIN_CODES = new Set([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const STORM = new Set([95, 96, 99]);
const HAIL = new Set([96, 99]);
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString('es-AR');

function segment(hours, date) {
  const hs = hours.filter((h) => h.time.slice(0, 10) === date);
  if (!hs.length) return null;
  const mm = Math.round(hs.reduce((a, h) => a + (h.rainMm || 0), 0) * 10) / 10;
  const prob = Math.max(0, ...hs.map((h) => h.rainProb || 0));
  const wet = hs.filter((h) => (h.rainMm || 0) >= 0.3 && (h.rainProb || 0) >= 40);
  const storm = hs.filter((h) => STORM.has(h.code) && (h.rainProb || 0) >= 40);
  const hail = hs.filter((h) => HAIL.has(h.code) && (h.rainProb || 0) >= 40);
  const gust = Math.max(0, ...hs.map((h) => h.gust || 0));
  const hr = (x) => x.time.slice(11, 13) + ' h';
  return { date, mm, prob, from: wet[0] ? hr(wet[0]) : null, to: wet.length ? hr(wet[wet.length - 1]) : null, storm: storm.length ? hr(storm[0]) : null, hail: hail.length > 0, gust, hours: hs.length };
}

// om: snapshot normalizado de Open-Meteo para la localidad. obs: observación SMN cercana (o null). nowIso: hora actual.
export function computeAvisos({ om, obs = null, obsKm = null, now = new Date() }) {
  const out = [];
  if (!om) return out;
  const tz = 'America/Argentina/Buenos_Aires';
  const today = now.toLocaleDateString('en-CA', { timeZone: tz });
  const tomorrow = new Date(Date.parse(today + 'T12:00:00-03:00') + 864e5).toLocaleDateString('en-CA', { timeZone: tz });
  const nowHour = now.toLocaleString('sv-SE', { timeZone: tz }).slice(0, 13).replace(' ', 'T');
  const hours = (om.hours || []).filter((h) => h.time.slice(0, 13) >= nowHour);

  // 1) Llueve ahora
  const obsRain = obs && /lluvi|llovizn|chaparr|tormenta/i.test(obs.weather || '');
  const cur = om.current || {};
  const modelRain = (cur.precipitation ?? 0) >= 0.2 || RAIN_CODES.has(cur.code);
  if (obsRain) out.push({ id: 'llueve', level: 'rojo', icon: '🌧️', title: 'LLUEVE AHORA', detail: `El SMN informa «${obs.weather}» en ${obs.station}${obsKm ? ` (a ${obsKm} km)` : ''}.`, origin: 'Observación del SMN' });
  else if (!obs && modelRain) out.push({ id: 'llueve', level: 'rojo', icon: '🌧️', title: 'LLUEVE AHORA', detail: `${cur.weather || 'Lluvia'}${cur.precipitation ? `: ${fmt1(cur.precipitation)} mm en la última hora` : ''}.`, origin: 'Estimado por modelo (Open-Meteo), no es una medición' });

  // 2) Hoy y mañana
  for (const [date, name] of [[today, 'HOY'], [tomorrow, 'MAÑANA']]) {
    const s = segment(hours, date);
    if (!s) continue;
    const when = s.from ? (s.from === s.to ? ` alrededor de las ${s.from}` : ` entre las ${s.from} y las ${s.to}`) : '';
    const strong = (s.mm >= 5 && s.prob >= 60) || (s.mm >= 10 && s.prob >= 40);
    if (strong) out.push({ id: 'lluvia-' + name, level: 'rojo', icon: '🌧️', title: `LLUVIA PREVISTA ${name}`, detail: `Unos ${fmt1(s.mm)} mm, probabilidad ${s.prob} %${when}.`, origin: 'Pronóstico por modelo (Open-Meteo)', date });
    else if (s.prob >= 40 && s.mm >= 1) out.push({ id: 'lluvia-' + name, level: 'amarillo', icon: '🌦️', title: `Posible lluvia ${name.toLowerCase()}`, detail: `Poca cantidad: unos ${fmt1(s.mm)} mm, probabilidad ${s.prob} %${when}.`, origin: 'Pronóstico por modelo (Open-Meteo)', date });
    if (s.storm) out.push({ id: 'tormenta-' + name, level: strong ? 'rojo' : 'amarillo', icon: '⛈️', title: `Tormentas ${name.toLowerCase()}`, detail: `Posibles tormentas desde las ${s.storm}${s.hail ? '. El modelo indica posible granizo (orientativo)' : ''}.`, origin: 'Pronóstico por modelo (Open-Meteo)', date });
    else if (s.hail) out.push({ id: 'granizo-' + name, level: 'amarillo', icon: '🧊', title: `Posible granizo ${name.toLowerCase()}`, detail: 'El modelo indica posible granizo (orientativo).', origin: 'Pronóstico por modelo (Open-Meteo)', date });
    if (s.gust >= 60) out.push({ id: 'viento-' + name, level: s.gust >= 80 ? 'rojo' : 'amarillo', icon: '💨', title: `Viento fuerte ${name.toLowerCase()}`, detail: `Ráfagas de hasta ${s.gust} km/h.`, origin: 'Pronóstico por modelo (Open-Meteo)', date });
  }

  // 3) Heladas y calor (mínima/máxima diaria de hoy y mañana)
  for (const d of (om.days || []).filter((x) => x.date === today || x.date === tomorrow)) {
    const name = d.date === today ? 'hoy' : 'mañana';
    if (d.tMin !== null && d.tMin <= 2) out.push({ id: 'helada-' + name, level: d.tMin <= -2 ? 'rojo' : 'amarillo', icon: '❄️', title: d.tMin <= -2 ? `Helada fuerte ${name}` : `Posible helada ${name}`, detail: `Mínima prevista de ${fmt1(d.tMin)} °C.`, origin: 'Pronóstico por modelo (Open-Meteo)', date: d.date });
    if (d.tMax !== null && d.tMax >= 37) out.push({ id: 'calor-' + name, level: d.tMax >= 40 ? 'rojo' : 'amarillo', icon: '🌡️', title: `Calor extremo ${name}`, detail: `Máxima prevista de ${fmt1(d.tMax)} °C.`, origin: 'Pronóstico por modelo (Open-Meteo)', date: d.date });
  }
  // Rojos primero
  return out.sort((a, b) => (a.level === 'rojo' ? 0 : 1) - (b.level === 'rojo' ? 0 : 1));
}
