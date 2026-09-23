// Alertas oficiales del SMN en formato CAP (Common Alerting Protocol, estándar internacional de alertas).
// Fuente abierta: https://ssl.smn.gob.ar/CAP/AR.php (listado) + un archivo XML por alerta.
// Cada alerta trae fenómeno, severidad, inicio, fin, descripción, recomendaciones y el polígono de la zona:
// se calcula qué localidades de la provincia quedan dentro del polígono.
import { getText } from '../lib/http.js';
import { decodeEntities } from '../lib/text.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot, cacheGet, cacheSet } from '../db.js';
import { mapLimit } from '../lib/pool.js';

const LIST = 'https://ssl.smn.gob.ar/CAP/AR.php';

// Severidad CAP → nivel del Sistema de Alerta Temprana del SMN.
const LEVEL = { Extreme: 'Rojo', Severe: 'Naranja', Moderate: 'Amarillo', Minor: 'Amarillo' };
const RANK = { Amarillo: 1, Naranja: 2, Rojo: 3 };

export function parseCapList(html) {
  // El listado llega como RSS (XML) o, en el navegador, transformado a HTML: se aceptan ambos.
  const urls = [...String(html).matchAll(/(https:\/\/ssl\.smn\.gob\.ar\/feeds\/CAP\/[^"<\s]+\.xml)/g)].map((m) => m[1]);
  return [...new Set(urls)];
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
  return m ? decodeEntities(m[1]).trim() : null;
};

export function parseCap(xml) {
  const info = (xml.match(/<info>([\s\S]*?)<\/info>/) || [])[1];
  if (!info) return null;
  const polygons = [...info.matchAll(/<polygon>([\s\S]*?)<\/polygon>/g)].map((m) =>
    m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)));
  const severity = tag(info, 'severity');
  return {
    identifier: tag(xml, 'identifier'),
    sent: tag(xml, 'sent'),
    msgType: tag(xml, 'msgType'),
    status: tag(xml, 'status'),
    event: tag(info, 'event'),
    severity,
    levelName: LEVEL[severity] || null,
    rank: RANK[LEVEL[severity]] || 0,
    urgency: tag(info, 'urgency'),
    onset: tag(info, 'onset'),
    expires: tag(info, 'expires'),
    headline: tag(info, 'headline'),
    description: tag(info, 'description'),
    instruction: tag(info, 'instruction'),
    areaDesc: tag(info, 'areaDesc'),
    polygons,
  };
}

// Punto dentro de polígono (lat, lon).
export function inPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Las instrucciones vienen como "1- Evitá salir. 2- Retirá..." en una sola línea: se separan en renglones.
const tidyInstruction = (s) => (s ? s.replace(/\s+(\d{1,2})-\s/g, '\n$1- ').trim() : null);

export default {
  id: 'smn-cap',
  name: 'SMN — Alertas oficiales en formato CAP',
  org: 'Servicio Meteorológico Nacional',
  category: 'alertas',
  url: 'https://www.smn.gob.ar/alertas',
  official: true,
  access: 'Feed público oficial (CAP). Sin API Key.',
  everyMin: 20,
  staleAfterMin: 90,
  async run() {
    const region = currentRegion();
    const listHtml = await getText(LIST, { headers: { Accept: 'text/html' } });
    // Nunca informar "sin alertas" si la página recibida no es el listado oficial (ej. una página de verificación).
    if (!/RSS CAP|<rss[\s>]/i.test(listHtml)) throw new Error('La página de alertas CAP del SMN no respondió con el listado esperado: ' + listHtml.replace(/\s+/g, ' ').slice(0, 160));
    const urls = parseCapList(listHtml);
    // Cada XML tiene nombre único e inmutable: se guarda en caché y solo se descargan los nuevos.
    const res = await mapLimit(urls, 3, async (u) => {
      const hit = cacheGet('cap:' + u);
      if (hit) return hit;
      const cap = parseCap(await getText(u, { headers: { Accept: 'application/xml' } }));
      if (cap) cacheSet('cap:' + u, cap, 5 * 864e5);
      return cap;
    }, 150);
    const failed = res.filter((r) => !r.ok).length;
    if (urls.length && failed === urls.length) throw new Error('No se pudo leer ningún archivo CAP del SMN');
    const now = Date.now();
    const grouped = new Map();
    for (const [i, r] of res.entries()) {
      const cap = r.ok ? r.value : null;
      if (!cap || cap.status !== 'Actual' || cap.msgType === 'Cancel') continue;
      if (cap.expires && Date.parse(cap.expires) < now) continue;
      const locs = region.localities.filter((l) => cap.polygons.some((p) => inPolygon(l.lat, l.lon, p))).map((l) => l.id);
      if (!locs.length) continue; // alerta de otra provincia
      const key = `${cap.event}|${cap.levelName}|${cap.onset}|${cap.expires}|${cap.description}`;
      const g = grouped.get(key) || { ...cap, polygons: undefined, localities: [], xml: urls[i] };
      g.localities = [...new Set([...g.localities, ...locs])];
      grouped.set(key, g);
    }
    const alerts = [...grouped.values()].map((a) => ({
      event: a.event, levelName: a.levelName, rank: a.rank, severity: a.severity,
      from: a.onset, to: a.expires, sent: a.sent, description: a.description,
      instruction: tidyInstruction(a.instruction), localities: a.localities, xml: a.xml, kind: 'cap',
    })).sort((x, y) => y.rank - x.rank || String(x.from).localeCompare(String(y.from)));
    putSnapshot('smn-cap', 'vigentes', { checkedAt: new Date().toISOString(), totalNacional: urls.length, alerts }, null);
    return { items: alerts.length, message: `${urls.length} archivos CAP en el país; ${alerts.length} alerta(s) vigentes en la provincia` };
  },
};
