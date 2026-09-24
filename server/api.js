// Endpoints públicos de la API (solo lectura desde la base local: el usuario nunca espera a una fuente externa).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';
import { currentRegion, findLocality, nearestStation } from './regions/index.js';
import { getSnapshot, listNews, listManual, getSetting, allSourceStates } from './db.js';
import { meta } from './lib/meta.js';
import { NEWS_CATEGORIES, NEWS_ZONES, relevance, dedupeKey } from './lib/news-classify.js';
import { computeAvisos, CRITERIOS } from './lib/avisos.js';
import { SOURCES } from './sources/index.js';
import { FEEDS } from './sources/noticias.js';
import { PAGE_INMAG, PAGE_IGMAG } from './sources/mag-indices.js';
import { PAGE_ROSGAN } from './sources/rosgan.js';
import { URL_ALTURAS } from './sources/prefectura-rios.js';
import { PAGE_HID, PAGE_HID_GUALEGUAY } from './sources/hidraulica-rios.js';
import { normalize } from './lib/text.js';

const loadJson = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
let CULTIVOS = loadJson('content/cultivos.json');
export function reloadContent() {
  CULTIVOS = loadJson('content/cultivos.json');
}

const FRESH_OBS_MIN = 180;
const NEAR_STATION_KM = 40; // más lejos que esto, la estación del SMN no representa "lo que pasa ahora" en la localidad
const isFresh = (iso, min) => iso && Date.now() - Date.parse(iso) < min * 60e3;

// ------------------------------------------------------------------ CLIMA
// Modelo de pronóstico: Open-Meteo si tiene dato reciente; si no, MET Norway (respaldo).
function modelSnapshot(locId) {
  const om = getSnapshot('open-meteo', locId);
  const met = getSnapshot('met-no', locId);
  const fresh = (s) => s && Date.now() - Date.parse(s.fetchedAt) < 180 * 60e3;
  if (om && (fresh(om) || !met || Date.parse(om.fetchedAt) >= Date.parse(met.fetchedAt))) return { snap: om, source: 'open-meteo', label: 'Open-Meteo' };
  if (met) return { snap: met, source: 'met-no', label: 'MET Norway' };
  return { snap: om, source: 'open-meteo', label: 'Open-Meteo' };
}

export function clima(locId) {
  const loc = findLocality(locId);
  const station = nearestStation(loc);
  const sFc = getSnapshot('smn-pronostico', loc.id);
  const sNow = getSnapshot('smn-actual', loc.id);
  const sObs = getSnapshot('smn-observacion', station.id);
  const sModel = getSnapshot('smn-modelo', station.id);
  const mdl = modelSnapshot(loc.id);
  const sOm = mdl.snap;

  // Estado actual: 1) SMN (servicio por localidad), 2) datos abiertos SMN si la estación está cerca (≤ 40 km),
  // 3) modelo Open-Meteo en el punto exacto de la localidad. Si la estación está lejos (ej. Gualeguay: la más
  // cercana es Gualeguaychú, a unos 70 km), se muestra el modelo y, aparte, la observación oficial más cercana.
  const obsFresh = sObs && isFresh(sObs.data.observedAt, FRESH_OBS_MIN) ? sObs.data : null;
  let current = null;
  if (sNow && isFresh(sNow.data.observedAt, FRESH_OBS_MIN)) {
    current = { ...sNow.data, origin: 'smn', originLabel: `Observado por el SMN${sNow.data.distanceKm ? ` (estación a ${Math.round(sNow.data.distanceKm)} km)` : ''}` };
  } else if (obsFresh && station.km <= NEAR_STATION_KM) {
    current = { ...obsFresh, origin: 'smn-abiertos', originLabel: `Observado por el SMN en ${obsFresh.station}${station.km > 5 ? ` (a ${station.km} km)` : ''}` };
  } else if (sOm) {
    current = { ...sOm.data.current, origin: 'modelo', originLabel: `Estimado por modelo (${mdl.label}) para ${loc.name}. No es una medición.` };
  } else if (obsFresh) {
    // Respaldo si el modelo no está disponible: la observación oficial más cercana, aclarando la distancia.
    current = { ...obsFresh, origin: 'smn-abiertos', originLabel: `Observado por el SMN en ${obsFresh.station} (a ${station.km} km de ${loc.name}).` };
  }
  const nearestObs = obsFresh && current?.origin === 'modelo' ? { station: obsFresh.station, km: station.km, temp: obsFresh.temp, weather: obsFresh.weather, observedAt: obsFresh.observedAt } : null;
  const avisos = computeAvisos({ om: sOm?.data, obs: obsFresh && station.km <= NEAR_STATION_KM ? obsFresh : null, obsKm: station.km, provider: mdl.label });
  if (current) {
    const om = sOm?.data?.current;
    current.estimated = {};
    if (current.feelsLike === null && om?.feelsLike !== undefined && current.origin !== 'modelo') {
      current.feelsLike = om.feelsLike;
      current.estimated.feelsLike = true;
    }
    if (current.gust === undefined && om?.gust !== undefined) {
      current.gust = om.gust;
      current.estimated.gust = true;
    }
  }

  // Pronóstico: oficial del SMN; se agregan milímetros y ráfagas estimados por modelo, claramente separados.
  const omByDate = Object.fromEntries((sOm?.data?.days || []).map((d) => [d.date, d]));
  let days = [];
  let forecastOrigin = null;
  if (sFc?.data?.days?.length) {
    forecastOrigin = 'smn';
    days = sFc.data.days.map((d) => ({ ...d, model: omByDate[d.date] ? { rainMm: omByDate[d.date].rainMm, rainProb: omByDate[d.date].rainProb, gustMax: omByDate[d.date].gustMax, weather: omByDate[d.date].weather } : null }));
  } else if (sOm?.data?.days?.length) {
    forecastOrigin = 'modelo';
    days = sOm.data.days.map((d) => ({ date: d.date, tMin: d.tMin, tMax: d.tMax, summary: d.weather, rainProbMax: d.rainProb, rainMm: d.rainMm, rainMmComplete: true, windMax: d.windMax, windDir: d.windDir, gustMax: d.gustMax, periods: [], model: null }));
  } else if (sModel?.data?.days?.length) {
    // Respaldo: pronóstico por modelo que publica el SMN para la estación más cercana.
    forecastOrigin = 'smn-modelo';
    days = sModel.data.days.map((d) => ({ date: d.date, tMin: d.tMin, tMax: d.tMax, summary: `Pronóstico por modelo del SMN para ${station.obsName}`, rainProbMax: null, rainMm: d.rainMm, rainMmComplete: true, windMax: d.windMaxKmh, windDir: null, gustMax: null, periods: [], model: null }));
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  days = days.filter((d) => d.date >= today);

  return {
    locality: loc,
    station: { name: station.obsName, km: station.km },
    current,
    nearestObs,
    avisos,
    criterios: CRITERIOS,
    forecastOrigin,
    days,
    modelStation: sModel ? { name: station.obsName, days: sModel.data.days, file: sModel.data.file } : null,
    meta: {
      pronostico: forecastOrigin === 'smn' ? meta('smn-pronostico', sFc) : forecastOrigin === 'smn-modelo' ? meta('smn-datos-abiertos', sModel) : meta(mdl.source, sOm),
      actual: current?.origin === 'smn' ? meta('smn-pronostico', sNow) : current?.origin === 'smn-abiertos' ? meta('smn-datos-abiertos', sObs) : meta(mdl.source, sOm),
      observacion: meta('smn-datos-abiertos', sObs),
      modelo: meta(mdl.source, sOm),
    },
    attribution: forecastOrigin === 'smn'
      ? 'Pronóstico: Servicio Meteorológico Nacional. Milímetros y ráfagas estimados: Open-Meteo.com (CC BY 4.0), por modelo numérico.'
      : mdl.source === 'met-no'
        ? 'Pronóstico por modelo numérico: datos de MET Norway (Instituto Meteorológico de Noruega, CC BY 4.0), usados como respaldo porque Open-Meteo no respondió. Observaciones: Servicio Meteorológico Nacional (datos abiertos). Alertas: SMN.'
        : 'Pronóstico por modelo numérico: Open-Meteo.com (CC BY 4.0), que combina modelos de servicios meteorológicos nacionales. Observaciones y pronóstico por estación: Servicio Meteorológico Nacional (datos abiertos). Alertas: SMN.',
  };
}

// ------------------------------------------------------------------ ALERTAS
function areaOf(locId) {
  const map = getSetting('smn_area_map', {});
  const loc = currentRegion().localities.find((l) => l.id === locId);
  return map[locId]?.area || loc?.smnArea || null;
}

export function alertas(locId) {
  const region = currentRegion();
  const loc = findLocality(locId);
  const names = Object.fromEntries(region.localities.map((l) => [l.id, l.name]));
  const cap = getSnapshot('smn-cap', 'vigentes');
  const withNames = (a) => ({ ...a, localityNames: (a.localities || []).map((id) => names[id]).filter(Boolean) });

  // Fuente principal: feed oficial CAP del SMN (abierto).
  if (cap || !getSnapshot('smn-alertas', `area:${areaOf(loc.id)}`)) {
    const all = (cap?.data?.alerts || []).map(withNames);
    return {
      locality: loc,
      alerts: all.filter((a) => a.localities.includes(loc.id)),
      province: all,
      updated: cap?.data?.checkedAt || null,
      shortTerm: { active: false },
      manual: listManual('alerta_meteo'),
      officialUrl: 'https://www.smn.gob.ar/alertas',
      meta: meta('smn-cap', cap),
      avisos: clima(loc.id).avisos,
      criterios: CRITERIOS,
      metaModelo: (() => { const m = modelSnapshot(loc.id); return meta(m.source, m.snap); })(),
      sanitarias: sanitarias(),
      noAlertsText: 'No hay alertas meteorológicas activas para esta zona.',
    };
  }

  // Respaldo: servicio web del SMN (solo si el administrador lo habilitó y tiene acceso).
  const area = areaOf(loc.id);
  const snap = getSnapshot('smn-alertas', `area:${area}`);
  const alertsArea = (snap?.data?.alerts || []);
  const province = [];
  for (const l of region.localities) {
    const s = getSnapshot('smn-alertas', `area:${areaOf(l.id)}`);
    for (const a of s?.data?.alerts || []) {
      const key = a.event + a.levelName + a.from;
      let p = province.find((x) => x.key === key);
      if (!p) { p = { ...a, key, localityNames: [] }; province.push(p); }
      p.localityNames.push(l.name);
    }
  }
  return {
    locality: loc,
    alerts: alertsArea.map((a) => ({ ...a, localityNames: region.localities.filter((l) => areaOf(l.id) === area).map((l) => l.name) })),
    province,
    updated: snap?.data?.updated || null,
    shortTerm: { active: false },
    manual: listManual('alerta_meteo'),
    officialUrl: 'https://www.smn.gob.ar/alertas',
    meta: meta('smn-alertas', snap),
    avisos: clima(loc.id).avisos,
    criterios: CRITERIOS,
    metaModelo: (() => { const m = modelSnapshot(loc.id); return meta(m.source, m.snap); })(),
    sanitarias: sanitarias(),
    noAlertsText: 'No hay alertas meteorológicas activas para esta zona.',
  };
}

// ------------------------------------------------------------------ utilidades de precios
const variation = (cur, prev) => {
  if (!prev || prev.value === null || prev.value === undefined || !prev.value || cur === null || cur === undefined) return null;
  return { pct: Math.round(((cur - prev.value) / prev.value) * 1000) / 10, previous: prev.value, previousDate: prev.date };
};
const daysOld = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso.length === 10 ? iso + 'T12:00:00-03:00' : iso)) / 864e5) : null);

// ------------------------------------------------------------------ MERCADO (hacienda, granos, arroz)
function haciendaFijada() {
  const idx = getSnapshot('mag-indices', 'ultimos');
  const mag = getSnapshot('mag-canuelas', 'ultimo');
  const ros = getSnapshot('rosgan', 'ultimo');
  const inmag = idx?.data?.inmag || [];
  const igmag = idx?.data?.igmag || [];

  let novillo = null;
  if (inmag.length) {
    const l = inmag[inmag.length - 1];
    const p = inmag[inmag.length - 2];
    novillo = { value: l.value, unit: '$ por kg vivo', date: l.date, variation: variation(l.value, p), market: 'Mercado Agroganadero de Cañuelas', index: 'INMAG (Índice Novillo del Mercado)', url: PAGE_INMAG, fetchedAt: idx.fetchedAt, heads: l.heads };
  } else {
    const g = mag?.data?.groups?.find((x) => x.group === 'NOVILLOS');
    if (g) novillo = { value: g.avg, unit: '$ por kg vivo', date: mag.data.date, variation: variation(g.avg, g.previous), market: 'Mercado Agroganadero de Cañuelas', index: 'Promedio ponderado de Novillos', url: mag ? 'https://www.mercadoagroganadero.com.ar/dll/hacienda1.dll/haciinfo000002' : null, fetchedAt: mag.fetchedAt, heads: g.heads };
  }
  const gv = mag?.data?.groups?.find((x) => x.group === 'VACAS');
  const vaca = gv ? { value: gv.avg, unit: '$ por kg vivo', date: mag.data.date, variation: variation(gv.avg, gv.previous), market: 'Mercado Agroganadero de Cañuelas', index: 'Promedio ponderado de todas las Vacas', status: mag.data.status, url: 'https://www.mercadoagroganadero.com.ar/dll/hacienda1.dll/haciinfo000002', fetchedAt: mag.fetchedAt, heads: gv.heads } : null;
  const rl = ros?.data?.latest;
  const ternero = rl?.indiceTernero ? { value: rl.indiceTernero, unit: '$ por kg vivo', date: rl.date, variation: variation(rl.indiceTernero, ros.data.previous ? { value: ros.data.previous.indiceTernero, date: ros.data.previous.date } : null), market: 'ROSGAN (Mercado Ganadero de Rosario)', index: 'Índice Ternero ROSGAN (remate mensual)', monthly: true, url: PAGE_ROSGAN, fetchedAt: ros.fetchedAt } : null;
  let enPie = null;
  if (igmag.length) {
    const l = igmag[igmag.length - 1];
    enPie = { value: l.value, unit: '$ por kg vivo', date: l.date, variation: variation(l.value, igmag[igmag.length - 2]), market: 'Mercado Agroganadero de Cañuelas', index: 'IGMAG (Índice General del Mercado: todas las categorías)', url: PAGE_IGMAG, fetchedAt: idx.fetchedAt, heads: l.heads, history: igmag.slice(-6) };
  } else if (mag?.data?.general) {
    enPie = { value: mag.data.general.avg, unit: '$ por kg vivo', date: mag.data.date, variation: null, market: 'Mercado Agroganadero de Cañuelas', index: 'Promedio general del día', url: 'https://www.mercadoagroganadero.com.ar/dll/hacienda1.dll/haciinfo000002', fetchedAt: mag.fetchedAt, heads: mag.data.general.heads };
  }
  for (const x of [novillo, vaca, ternero, enPie]) if (x) { x.daysOld = daysOld(x.date); x.stale = x.monthly ? x.daysOld > 45 : x.daysOld > 6; }
  return {
    novillo, vaca, ternero, enPie,
    meta: { indices: meta('mag-indices', idx), canuelas: meta('mag-canuelas', mag), rosgan: meta('rosgan', ros) },
  };
}

export function mercado() {
  const bcr = getSnapshot('bcr-pizarra', 'rosario');
  const mag = getSnapshot('mag-canuelas', 'ultimo');
  const arroz = getSnapshot('magyp-arroz', 'mensual');
  const ros = getSnapshot('rosgan', 'ultimo');
  const fij = haciendaFijada();
  return {
    fijados: { novillo: fij.novillo, vaca: fij.vaca, ternero: fij.ternero },
    enPie: fij.enPie,
    canuelas: mag ? { date: mag.data.date, status: mag.data.status, groups: mag.data.groups, general: mag.data.general, categories: mag.data.rows, note: mag.data.note } : null,
    invernada: ros?.data?.latest || null,
    granos: bcr ? bcr.data : null,
    arroz: arroz ? arroz.data : null,
    manual: listManual('precio'),
    pendientes: [
      { producto: 'Precio de granos puesto en Entre Ríos', motivo: 'La Bolsa de Cereales de Entre Ríos no publica una pizarra diaria en formato abierto. Se muestra la pizarra de Rosario, que es la referencia: el precio en tu zona se calcula descontando flete y gastos.', url: 'https://bolsacer.org.ar/site/siber/' },
      { producto: 'Carne porcina (capón)', motivo: 'La Secretaría de Agricultura publica el precio semanal solo en PDF.', url: 'https://www.magyp.gob.ar/sitio/areas/porcinos/informes/' },
    ],
    meta: { granos: meta('bcr-pizarra', bcr), hacienda: meta('mag-canuelas', mag), arroz: meta('magyp-arroz', arroz), ...fij.meta },
  };
}

// ------------------------------------------------------------------ DÓLAR
export function dolar() {
  const s = getSnapshot('dolar', 'ultimo');
  const d = s?.data || {};
  return { oficial: d.oficial || null, mayorista: d.mayorista || null, blue: d.blue || null, meta: meta('dolar', s), fetchedAt: s?.fetchedAt || null };
}

// ------------------------------------------------------------------ RÍOS
// Dos fuentes oficiales: Prefectura (lectura cada ~12 h) y la Dirección de Hidráulica de Entre Ríos (INA y escalas
// propias en el río Gualeguay, lectura diaria). Para cada estación se muestra la lectura más reciente de las dos.
const TEND = { sube: 'CRECE', baja: 'BAJA', estable: 'ESTAC' };
function riverStatus(r) {
  if (r.height === null || r.height === undefined) return { key: 'sd', label: 'Sin dato' };
  if (r.alert === null || r.alert === undefined) return { key: 'nolevel', label: 'La fuente no publica nivel de alerta para esta escala' };
  if (r.evacuation !== null && r.evacuation !== undefined && r.height >= r.evacuation) return { key: 'evacuacion', label: 'Nivel de EVACUACIÓN' };
  if (r.height >= r.alert) return { key: 'alerta', label: 'Nivel de ALERTA' };
  if (r.height >= r.alert - 0.5) return { key: 'cerca', label: 'Cerca del nivel de alerta' };
  return { key: 'normal', label: 'Por debajo del nivel de alerta' };
}
export function rios() {
  const region = currentRegion();
  const sp = getSnapshot('prefectura-rios', 'entre-rios');
  const sh = getSnapshot('hidraulica-rios', 'entre-rios');
  const prefList = sp?.data?.stations || [];
  const ina = sh?.data?.ina || [];
  const gual = sh?.data?.gualeguay || {};
  const hoursOld = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 36e5) : null);
  const stations = region.rivers.map((w) => {
    const p = prefList.find((x) => x.label === w.label && !x.missing);
    const cands = [];
    if (p && p.at) cands.push({ ...p, fuente: 'Prefectura Naval Argentina', fuenteUrl: URL_ALTURAS, dateOnly: false });
    if (w.ina) {
      const i = ina.find((x) => x.nombre === w.ina && x.vigente && x.height !== null);
      if (i) cands.push({ port: w.port, river: w.river, label: w.label, main: !!w.main, height: i.height, variation: i.delta, at: i.at, state: TEND[i.tendencia] || null, previous: i.delta !== null ? Math.round((i.height - i.delta) * 100) / 100 : null, previousAt: null, alert: i.alert, evacuation: i.evacuation, fuente: 'Dirección de Hidráulica de Entre Ríos (datos del INA)', fuenteUrl: PAGE_HID, dateOnly: false });
    }
    if (w.hid && gual[w.hid]?.length) {
      const g = gual[w.hid];
      const l = g[g.length - 1];
      const pv = g[g.length - 2];
      const d = pv ? Math.round((l.height - pv.height) * 100) / 100 : null;
      // Niveles de alerta: solo si Prefectura los publica para la misma escala (Puerto Ruiz); si no, no se inventan.
      cands.push({ port: w.port, river: w.river, label: w.label, main: !!w.main, height: l.height, variation: d, at: l.date + 'T12:00:00-03:00', state: d === null ? null : d > 0.02 ? 'CRECE' : d < -0.02 ? 'BAJA' : 'ESTAC', previous: pv ? pv.height : null, previousAt: pv ? pv.date + 'T12:00:00-03:00' : null, alert: null, evacuation: null, fuente: 'Dirección de Hidráulica de Entre Ríos', fuenteUrl: PAGE_HID_GUALEGUAY, dateOnly: true, history: g.slice(-7) });
    }
    if (!cands.length) return { port: w.port, river: w.river, label: w.label, main: !!w.main, missing: true };
    cands.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const r = cands[0];
    const out = { ...r, label: w.label, main: !!w.main, hoursOld: hoursOld(r.at) };
    out.stale = out.hoursOld === null || out.hoursOld > (r.dateOnly ? 60 : 36);
    out.status = riverStatus(out);
    out.otherSource = cands[1] ? { fuente: cands[1].fuente, height: cands[1].height, at: cands[1].at, dateOnly: cands[1].dateOnly } : null;
    return out;
  }).filter((r) => !r.missing || r.main);
  const metaP = meta('prefectura-rios', sp);
  const metaH = meta('hidraulica-rios', sh);
  return {
    main: stations.find((r) => r.main) || null,
    stations,
    url: URL_ALTURAS,
    urlHidraulica: PAGE_HID,
    nota: 'Alturas en metros según la escala (hidrómetro) de cada lugar; no es la profundidad del río. Cada estación muestra la lectura más reciente entre Prefectura Naval (cada ~12 h) y la Dirección de Hidráulica de Entre Ríos (datos del INA y escalas propias en el río Gualeguay, lectura diaria). «Alerta» y «Evacuación» son los niveles de referencia que publica cada organismo. Las escalas de distintos organismos pueden no coincidir exactamente.',
    meta: metaP.status === 'ok' || metaP.status === 'retrying' ? metaP : metaH.status === 'ok' || metaH.status === 'retrying' ? metaH : metaP,
    metas: [metaP, metaH],
  };
}

// ------------------------------------------------------------------ ALERTAS SANITARIAS (SENASA)
const PROVINCES = ['Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];
const OUTBREAK = /(?:^|[^a-z])(?:brotes?|focos?|casos?|detect|confirm|emergencia|sospech|positiv|cuarentena|interdic)/;
const STATUS = /(?:restituy|recuper|libre de|estatus|levant)/;
const PHYTO = /(?:plaga|chicharrita|langosta|hlb|cancrosis|mosca de los frutos|picudo|lobesia|fitosanit)/;
const ANIMAL_DISEASE = /(?:influenza aviar|gripe aviar|aftosa|newcastle|peste porcina|brucelosis|tuberculosis|encefalomielitis|anemia infecciosa|rabia|carbunclo|triquinosis|leptospirosis|sarna|garrapata|enfermedad)/;

export function sanitarias() {
  const region = currentRegion();
  const epi = getSnapshot('senasa-epidemiologia', 'lista');
  const cutoff = new Date(Date.now() - 150 * 864e5).toISOString().slice(0, 10);
  const fromNews = listNews({ limit: 120, sources: ['senasa'] }).map((n) => ({ date: n.published_at?.slice(0, 10), title: n.title, summary: n.summary, url: n.url, fuente: 'SENASA — Comunicados' }));
  const fromEpi = (epi?.data?.items || []).map((i) => ({ ...i, fuente: 'SENASA — Situación epidemiológica' }));
  const seen = new Set();
  const out = [];
  for (const i of [...fromEpi, ...fromNews]) {
    if (!i.url || seen.has(i.url) || !i.date || i.date < cutoff) continue;
    const t = ' ' + normalize(`${i.title} ${i.summary || ''}`) + ' ';
    const isOutbreak = OUTBREAK.test(t) && (ANIMAL_DISEASE.test(t) || PHYTO.test(t));
    const isStatus = STATUS.test(t) && (ANIMAL_DISEASE.test(t) || PHYTO.test(t));
    if (i.fuente.includes('Comunicados') && !isOutbreak && !isStatus) continue; // de los comunicados generales, solo alertas reales
    seen.add(i.url);
    const tt = normalize(i.title);
    const prefix = (i.title.match(/^([A-ZÁÉÍÓÚ][^:]{2,30}):/) || [])[1];
    const prov = PROVINCES.find((p) => (prefix && normalize(prefix) === normalize(p)) || tt.includes(normalize(p)));
    const deps = region.departments.filter((d) => normalize(d).length > 5 && tt.includes(normalize(d)));
    const enER = prov === 'Entre Ríos' || /entre rios|entrerrian/.test(t) || deps.length > 0;
    const zona = enER ? `Entre Ríos${deps.length ? ' — departamento ' + deps.join(', ') : ''}` : prov ? `Provincia de ${prov}` : 'Argentina (alcance nacional)';
    let importancia;
    if (enER && isOutbreak) importancia = { nivel: 'alta', texto: 'ALTA — afecta a Entre Ríos' };
    else if (isOutbreak && !prov) importancia = { nivel: 'alta', texto: 'ALTA — alcance nacional' };
    else if (isOutbreak) importancia = { nivel: 'media', texto: 'MEDIA — caso en otra provincia (vigilancia)' };
    else importancia = { nivel: 'info', texto: 'INFORMATIVA — cambio de estatus sanitario' };
    const tipo = PHYTO.test(t) ? 'Fitosanitaria (cultivos)' : 'Animales de producción';
    out.push({ que: i.title, detalle: i.summary || null, zona, fecha: i.date, importancia, tipo, fuente: i.fuente, url: i.url, enER });
  }
  const rank = { alta: 0, media: 1, info: 2 };
  out.sort((a, b) => (b.enER - a.enER) || rank[a.importancia.nivel] - rank[b.importancia.nivel] || b.fecha.localeCompare(a.fecha));
  const manual = listManual('alerta_sanitaria').map((m) => ({ que: m.title, detalle: m.body, zona: 'Entre Ríos', fecha: m.content_date, importancia: { nivel: 'alta', texto: 'Aviso cargado por la administración' }, fuente: m.source_name, url: m.url, enER: true, manual: true }));
  return {
    items: [...manual, ...out].slice(0, 12),
    enER: [...manual, ...out].filter((x) => x.enER).length,
    vacioTexto: 'No hay alertas sanitarias oficiales recientes del SENASA para Entre Ríos.',
    criterio: 'Solo se muestran comunicados oficiales del SENASA de los últimos 5 meses sobre brotes, detecciones, emergencias o cambios de estatus sanitario (animales de producción y plagas de cultivos). Primero lo que afecta a Entre Ríos.',
    meta: meta('senasa-epidemiologia', epi),
    metaNoticias: meta('noticias', null),
  };
}

// ------------------------------------------------------------------ NOTICIAS
const ZONE_RANK = { local: 0, departamentos: 1, provincia: 2, nacional: 3 };
export function noticias({ zone = null, limit = 40 } = {}) {
  const region = currentRegion();
  const feeds = Object.fromEntries(FEEDS.map((f) => [f.id, f]));
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const seen = new Set();
  const items = [];
  for (const n of listNews({ limit: 600 })) {
    if (!n.manual && !n.pinned && (!n.published_at || n.published_at < cutoff)) continue;
    const rel = n.manual || n.pinned ? { ok: true, zone: 'provincia' } : relevance({ title: n.title, summary: n.summary, url: n.url }, feeds[n.source] || { id: n.source }, region);
    if (!rel.ok) continue;
    const key = dedupeKey(n.title);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id: n.id, title: n.title, url: n.url, summary: n.summary, publishedAt: n.published_at, source: n.source, sourceName: n.source_name, zone: rel.zone, manual: !!n.manual, pinned: !!n.pinned });
  }
  items.sort((a, b) => (b.pinned - a.pinned) || ZONE_RANK[a.zone] - ZONE_RANK[b.zone] || (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const filtered = zone ? items.filter((i) => i.zone === zone) : items;
  const st = allSourceStates().find((s) => s.id === 'noticias');
  return {
    zones: NEWS_ZONES,
    items: filtered.slice(0, Math.min(Number(limit) || 40, 80)),
    vacioTexto: 'No hay novedades importantes para el campo de Entre Ríos en este momento.',
    criterio: 'Primero Gualeguay y la zona, después los departamentos de Entre Ríos, la provincia, y lo nacional solo si impacta al productor entrerriano (retenciones, sanidad, mercados, campaña). No se muestran espectáculos, deportes, curiosidades ni noticias de otras provincias. Últimos 30 días.',
    meta: meta('noticias', st?.last_success_at ? { fetchedAt: st.last_success_at } : null),
  };
}

// Para la portada: pocas y bien elegidas (últimos 10 días).
function noticiasPortada() {
  const n = noticias({ limit: 80 });
  const cutoff = new Date(Date.now() - 10 * 864e5).toISOString();
  return { items: n.items.filter((i) => i.pinned || (i.publishedAt || '') >= cutoff).slice(0, 5), vacioTexto: n.vacioTexto, meta: n.meta };
}

export function cultivos() {
  return CULTIVOS;
}

// ------------------------------------------------------------------ INICIO (orden pedido por el productor)
export function inicio(locId) {
  const c = clima(locId);
  const a = alertas(locId);
  const m = mercado();
  const pick = (k) => m.granos?.boards?.find((b) => b.key === k) || null;
  const r = rios();
  return {
    locality: c.locality,
    clima: { current: c.current, nearestObs: c.nearestObs, today: c.days[0] || null, tomorrow: c.days[1] || null, meta: c.meta.actual, metaPronostico: c.meta.pronostico, forecastOrigin: c.forecastOrigin },
    avisos: c.avisos,
    alertas: { count: a.alerts.length, top: a.alerts.slice(0, 2), meta: a.meta, noAlertsText: a.noAlertsText },
    sanitarias: { top: a.sanitarias.items.filter((x) => x.enER || x.importancia.nivel === 'alta').slice(0, 2), enER: a.sanitarias.enER, vacioTexto: a.sanitarias.vacioTexto, meta: a.sanitarias.meta },
    hacienda: { ...m.fijados, enPie: m.enPie, meta: { indices: m.meta.indices, canuelas: m.meta.canuelas, rosgan: m.meta.rosgan } },
    granos: { items: ['soja', 'maiz', 'trigo', 'girasol', 'sorgo'].map(pick).filter(Boolean), date: m.granos?.date || null, arroz: m.arroz?.latest || null, meta: m.meta.granos, metaArroz: m.meta.arroz },
    dolar: dolar(),
    rio: { main: r.main, meta: r.meta },
    noticias: noticiasPortada(),
  };
}

// ------------------------------------------------------------------ FUENTES
export function fuentes() {
  const states = Object.fromEntries(allSourceStates().map((s) => [s.id, s]));
  return {
    automaticas: SOURCES.map((s) => ({
      id: s.id, nombre: s.name, organismo: s.org, categoria: s.category, url: s.url, oficial: s.official, nota: s.officialNote || null,
      acceso: s.access, cadaMin: states[s.id]?.every_min || s.everyMin, activa: !!states[s.id]?.enabled,
      ultimaActualizacion: states[s.id]?.last_success_at || null,
      conProblemas: !!(states[s.id]?.last_error_at && (!states[s.id]?.last_success_at || states[s.id].last_error_at > states[s.id].last_success_at)),
      ultimoError: states[s.id]?.last_error_at && (!states[s.id]?.last_success_at || states[s.id].last_error_at > states[s.id].last_success_at) ? String(states[s.id].last_error || '').slice(0, 200) : null,
    })),
    noticias: FEEDS.map((f) => ({ nombre: f.name, url: f.site || f.url, oficial: f.official })),
    contenido: [
      { nombre: 'SENASA — Situación epidemiológica y comunicados', url: 'https://www.argentina.gob.ar/senasa/situacion-epidemiologica', uso: 'Alertas sanitarias oficiales (brotes, emergencias, estatus)' },
      { nombre: 'SINAVIMO — Sistema Nacional de Vigilancia y Monitoreo de Plagas (SENASA)', url: 'https://www.sinavimo.gob.ar/', uso: 'Fichas de plagas y enfermedades de cultivos' },
    ],
    revisionContenido: { cultivos: CULTIVOS.revisado },
  };
}

export function metaInfo() {
  const r = currentRegion();
  return {
    region: { id: r.id, name: r.name },
    localities: r.localities.map((l) => ({ id: l.id, name: l.name, department: l.department })),
    defaultLocality: r.defaultLocality,
    newsCategories: NEWS_CATEGORIES,
  };
}

// Novillo / vaca / ternero para la franja fija que se ve en todas las páginas.
export function fijados() {
  const f = haciendaFijada();
  const slim = (x) => x && { value: x.value, unit: x.unit, date: x.date, variation: x.variation, market: x.market, stale: x.stale, monthly: !!x.monthly };
  return { novillo: slim(f.novillo), vaca: slim(f.vaca), ternero: slim(f.ternero) };
}
