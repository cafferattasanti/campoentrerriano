// Endpoints públicos de la API (solo lectura desde la base local: el usuario nunca espera a una fuente externa,
// salvo el buscador de medicamentos que consulta el registro del SENASA con caché).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';
import { currentRegion, findLocality, nearestStation } from './regions/index.js';
import { getSnapshot, listNews, listManual, getSetting, allSourceStates } from './db.js';
import { meta } from './lib/meta.js';
import { NEWS_CATEGORIES } from './lib/news-classify.js';
import { SOURCES } from './sources/index.js';
import { FEEDS } from './sources/noticias.js';
import { searchMedicamentos, VADEMECUM_URL } from './services/vademecum.js';
import { normalize } from './lib/text.js';

const loadJson = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
let ANIMALES = loadJson('content/animales.json');
let CULTIVOS = loadJson('content/cultivos.json');
export function reloadContent() {
  ANIMALES = loadJson('content/animales.json');
  CULTIVOS = loadJson('content/cultivos.json');
}

const FRESH_OBS_MIN = 180;
const isFresh = (iso, min) => iso && Date.now() - Date.parse(iso) < min * 60e3;

export const DISCLAIMER_VET = 'La información de esta sección es orientativa y no reemplaza la evaluación de un veterinario.';

// ------------------------------------------------------------------ CLIMA
export function clima(locId) {
  const loc = findLocality(locId);
  const station = nearestStation(loc);
  const sFc = getSnapshot('smn-pronostico', loc.id);
  const sNow = getSnapshot('smn-actual', loc.id);
  const sObs = getSnapshot('smn-observacion', station.id);
  const sModel = getSnapshot('smn-modelo', station.id);
  const sOm = getSnapshot('open-meteo', loc.id);

  // Estado actual: 1) SMN estación más cercana vía servicio del SMN, 2) datos abiertos SMN, 3) modelo Open-Meteo.
  let current = null;
  if (sNow && isFresh(sNow.data.observedAt, FRESH_OBS_MIN)) {
    current = { ...sNow.data, origin: 'smn', originLabel: `Observado por el SMN${sNow.data.distanceKm ? ` (estación a ${Math.round(sNow.data.distanceKm)} km)` : ''}` };
  } else if (sObs && isFresh(sObs.data.observedAt, FRESH_OBS_MIN)) {
    current = { ...sObs.data, origin: 'smn-abiertos', originLabel: `Observado por el SMN en ${sObs.data.station} (a ${station.km} km)` };
  } else if (sOm) {
    current = { ...sOm.data.current, origin: 'modelo', originLabel: 'Estimado por modelo (Open-Meteo). No es una medición.' };
  }
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
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  days = days.filter((d) => d.date >= today);

  return {
    locality: loc,
    station: { name: station.obsName, km: station.km },
    current,
    forecastOrigin,
    days,
    modelStation: sModel ? { name: station.obsName, days: sModel.data.days, file: sModel.data.file } : null,
    meta: {
      pronostico: forecastOrigin === 'smn' ? meta('smn-pronostico', sFc) : meta('open-meteo', sOm),
      actual: current?.origin === 'smn' ? meta('smn-pronostico', sNow) : current?.origin === 'smn-abiertos' ? meta('smn-datos-abiertos', sObs) : meta('open-meteo', sOm),
      observacion: meta('smn-datos-abiertos', sObs),
      modelo: meta('open-meteo', sOm),
    },
    attribution: forecastOrigin === 'smn'
      ? 'Pronóstico: Servicio Meteorológico Nacional. Milímetros y ráfagas estimados: Open-Meteo.com (CC BY 4.0), por modelo numérico.'
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
    noAlertsText: 'No hay alertas meteorológicas activas para esta zona.',
  };
}

// ------------------------------------------------------------------ PRECIOS
export function precios() {
  const bcr = getSnapshot('bcr-pizarra', 'rosario');
  const mag = getSnapshot('mag-canuelas', 'ultimo');
  const arroz = getSnapshot('magyp-arroz', 'mensual');
  return {
    granos: bcr ? bcr.data : null,
    hacienda: mag ? { ...mag.data, rows: undefined, categories: mag.data.rows } : null,
    arroz: arroz ? arroz.data : null,
    manual: listManual('precio'),
    pendientes: [
      { producto: 'Carne porcina (capón)', motivo: 'La Secretaría de Agricultura publica el precio semanal solo en PDF. Se muestra el enlace oficial; el administrador puede cargarlo a mano.', url: 'https://www.magyp.gob.ar/sitio/areas/porcinos/informes/' },
      { producto: 'Precios regionales de Entre Ríos', motivo: 'La Bolsa de Cereales de Entre Ríos no publica una pizarra diaria abierta. Se muestran sus informes en Noticias.', url: 'https://bolsacer.org.ar/site/siber/' },
    ],
    meta: { granos: meta('bcr-pizarra', bcr), hacienda: meta('mag-canuelas', mag), arroz: meta('magyp-arroz', arroz) },
  };
}

// ------------------------------------------------------------------ NOTICIAS
export function noticias({ cat = null, limit = 30, source = null } = {}) {
  const items = listNews({ category: cat || null, limit: Math.min(Number(limit) || 30, 60), sources: source ? [source] : null }).map((n) => ({
    id: n.id, title: n.title, url: n.url, summary: n.summary, publishedAt: n.published_at, source: n.source, sourceName: n.source_name,
    categories: (n.category || '').split(',').filter(Boolean), manual: !!n.manual, pinned: !!n.pinned,
  }));
  return { categories: NEWS_CATEGORIES, items, meta: meta('noticias', items.length ? { fetchedAt: getSnapshotTime('noticias') } : null) };
}
function getSnapshotTime(id) {
  const st = allSourceStates().find((s) => s.id === id);
  return st?.last_success_at || null;
}

// ------------------------------------------------------------------ SANIDAD
const SANITARY_WORDS = ['brote', 'foco', 'caso', 'detect', 'alerta', 'emergencia', 'confirm', 'positivo'];
export function sanidad() {
  const region = currentRegion();
  const epi = getSnapshot('senasa-epidemiologia', 'lista');
  const senasaNews = listNews({ limit: 60, sources: ['senasa'] })
    .filter((n) => SANITARY_WORDS.some((w) => normalize(n.title).includes(w)))
    .map((n) => ({ date: n.published_at?.slice(0, 10), title: n.title, url: n.url, origin: 'SENASA Comunica' }));
  const epiItems = (epi?.data?.items || []).map((i) => ({ ...i, origin: 'SENASA — Situación epidemiológica' }));
  const seen = new Set();
  const all = [...epiItems, ...senasaNews].filter((i) => (seen.has(i.url) ? false : seen.add(i.url))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Agrupación geográfica honesta: solo si el texto oficial nombra la provincia o un departamento.
  const deptNorm = region.departments.map((d) => [d, normalize(d)]);
  for (const i of all) {
    const t = normalize(i.title);
    i.province = t.includes('entre rios') ? region.name : null;
    i.departments = deptNorm.filter(([, n]) => n.length > 5 && t.includes(n)).map(([d]) => d);
  }
  return {
    especies: ANIMALES.especies.map((e) => ({ id: e.id, nombre: e.nombre, emoji: e.emoji, count: e.enfermedades.length })),
    alertas: all.slice(0, 25),
    enProvincia: all.filter((i) => i.province || i.departments.length),
    manual: listManual('alerta_sanitaria'),
    avisoSenasa: ANIMALES.avisoSenasa,
    disclaimer: DISCLAIMER_VET,
    meta: meta('senasa-epidemiologia', epi),
    mapaNota: 'No existen datos públicos oficiales con ubicación exacta de brotes. Por eso no se dibujan puntos en un mapa: se muestran los comunicados oficiales y, cuando el texto oficial menciona Entre Ríos o un departamento, se agrupan por zona.',
  };
}

export function especie(id) {
  const e = ANIMALES.especies.find((x) => x.id === id);
  if (!e) return null;
  return { ...e, cuandoLlamarVeterinario: ANIMALES.cuandoLlamarVeterinario, cuandoLlamarFuente: ANIMALES.cuandoLlamarFuente, avisoSenasa: ANIMALES.avisoSenasa, disclaimer: DISCLAIMER_VET, revisado: ANIMALES.revisado };
}

export function cultivos() {
  return CULTIVOS;
}

// ------------------------------------------------------------------ MEDICAMENTOS
export async function medicamentos(q, especieId) {
  const r = await searchMedicamentos({ q, especie: especieId });
  return { ...r, disclaimer: DISCLAIMER_VET, vademecumUrl: VADEMECUM_URL };
}

// ------------------------------------------------------------------ INICIO
export function inicio(locId) {
  const c = clima(locId);
  const a = alertas(locId);
  const p = precios();
  const n = noticias({ limit: 12 });
  const s = sanidad();
  const pick = (k) => p.granos?.boards?.find((b) => b.key === k) || null;
  const erNews = n.items.filter((i) => i.categories.includes('entre-rios'));
  const topNews = [...erNews.slice(0, 2), ...n.items.filter((i) => !erNews.includes(i))].slice(0, 4);
  return {
    locality: c.locality,
    clima: { current: c.current, today: c.days[0] || null, tomorrow: c.days[1] || null, meta: c.meta.pronostico, forecastOrigin: c.forecastOrigin },
    alertas: { count: a.alerts.length, top: a.alerts.slice(0, 2), shortTerm: a.shortTerm, meta: a.meta, noAlertsText: a.noAlertsText },
    precios: {
      granos: ['soja', 'maiz', 'trigo', 'girasol', 'sorgo'].map(pick).filter(Boolean),
      granosFecha: p.granos?.date || null,
      novillos: p.hacienda?.groups?.find((g) => g.group === 'NOVILLOS') || null,
      haciendaFecha: p.hacienda?.date || null,
      arroz: p.arroz?.latest || null,
      meta: p.meta,
    },
    sanidad: { ultima: s.enProvincia[0] || s.alertas[0] || null, enProvincia: s.enProvincia.slice(0, 2) },
    noticias: topNews,
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
    })),
    noticias: FEEDS.map((f) => ({ nombre: f.name, url: f.url, oficial: f.official })),
    contenido: [
      { nombre: 'SENASA — Programas sanitarios y comunicados', url: 'https://www.argentina.gob.ar/senasa', uso: 'Sanidad animal, vacunación, enfermedades' },
      { nombre: 'SENASA — Registro de Productos Veterinarios (Vademécum)', url: VADEMECUM_URL, uso: 'Buscador de medicamentos (consulta en vivo)' },
      { nombre: 'SINAVIMO — Sistema Nacional de Vigilancia y Monitoreo de Plagas (SENASA)', url: 'https://www.sinavimo.gob.ar/', uso: 'Fichas de plagas y enfermedades de cultivos' },
      { nombre: 'INTA', url: 'https://www.argentina.gob.ar/inta', uso: 'Recomendaciones técnicas y noticias' },
    ],
    revisionContenido: { animales: ANIMALES.revisado, cultivos: CULTIVOS.revisado },
  };
}

export function metaInfo() {
  const r = currentRegion();
  return {
    region: { id: r.id, name: r.name },
    localities: r.localities.map((l) => ({ id: l.id, name: l.name, department: l.department })),
    defaultLocality: r.defaultLocality,
    newsCategories: NEWS_CATEGORIES,
    especies: ANIMALES.especies.map((e) => ({ id: e.id, nombre: e.nombre, emoji: e.emoji })),
  };
}
