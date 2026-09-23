// Alertas meteorológicas oficiales del SMN para las zonas de la provincia.
import { smnGet, SMN_EVENTS, alertLevelName, tempLevelName, LEVEL_RANK, PERIODS } from './smn-client.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot, getSetting } from '../db.js';
import { mapLimit } from '../lib/pool.js';

// Zonas de alerta verificadas para Entre Ríos (se completan solas con el mapa de localidades).
const FALLBACK_AREAS = [3423, 3396, 3406, 3429];

export function normalizeAreaAlerts(a) {
  const byEvent = new Map();
  for (const w of a.warnings || []) {
    for (const ev of w.events || []) {
      const lvlName = alertLevelName(ev.max_level);
      if (!lvlName) continue;
      const periods = Object.entries(ev.levels || {})
        .filter(([, v]) => alertLevelName(v))
        .map(([k, v]) => ({ period: PERIODS[k] || k, levelName: alertLevelName(v) }));
      if (!byEvent.has(ev.id)) byEvent.set(ev.id, []);
      byEvent.get(ev.id).push({ date: w.date, level: ev.max_level, levelName: lvlName, periods });
    }
  }
  const alerts = [];
  for (const [id, days] of byEvent) {
    days.sort((x, y) => x.date.localeCompare(y.date));
    const maxLevel = Math.max(...days.map((d) => d.level));
    const rep = (a.reports || []).find((r) => r.event_id === id);
    const lv = rep?.levels?.find((l) => l.level === maxLevel) || rep?.levels?.[rep.levels.length - 1] || null;
    alerts.push({
      eventId: id,
      event: SMN_EVENTS[id] || `Fenómeno (código SMN ${id})`,
      levelName: alertLevelName(maxLevel),
      rank: LEVEL_RANK[alertLevelName(maxLevel)],
      from: days[0].date,
      to: days[days.length - 1].date,
      days,
      description: lv?.description || null,
      instruction: lv?.instruction || null,
      kind: 'alerta',
    });
  }
  alerts.sort((x, y) => y.rank - x.rank || x.from.localeCompare(y.from));
  return { updated: a.updated || null, alerts };
}

export function normalizeTempWarning(obj, eventId) {
  if (!obj || typeof obj.level !== 'number') return null;
  const levelName = tempLevelName(obj.level);
  if (!levelName) return null;
  return {
    eventId,
    event: SMN_EVENTS[eventId],
    levelName,
    rank: LEVEL_RANK[levelName],
    from: obj.updated ? obj.updated.slice(0, 10) : null,
    to: null,
    days: [],
    description: null,
    instruction: null,
    kind: 'temperatura',
    updated: obj.updated || null,
    moreInfo: eventId === 43 ? 'https://www.smn.gob.ar/sistema_temp_extremas_calor' : 'https://www.smn.gob.ar/sistema_temp_extremas_frio',
  };
}

export default {
  id: 'smn-alertas',
  name: 'SMN — Alertas meteorológicas, temperaturas extremas y avisos a corto plazo',
  org: 'Servicio Meteorológico Nacional',
  category: 'alertas',
  url: 'https://www.smn.gob.ar/alertas',
  official: true,
  // Desactivada por defecto: el SMN bloquea (HTTP 403) el acceso automatizado a este servicio.
  // Activarla desde /admin solo si el SMN otorga acceso formal.
  enabledByDefault: false,
  access: 'Servicio web del sitio del SMN (no documentado públicamente). Sin API Key.',
  everyMin: 20,
  staleAfterMin: 90,
  async run({ log }) {
    const region = currentRegion();
    const areaMap = getSetting('smn_area_map', {});
    const areas = [...new Set([...FALLBACK_AREAS, ...Object.values(areaMap).map((x) => x.area)])];
    let ok = 0;
    const res = await mapLimit(areas, 2, async (area) => {
      const [a, heat, cold] = await Promise.all([
        smnGet(`/warning/alert/area/${area}`),
        smnGet(`/warning/heat/area/${area}`).catch(() => null),
        smnGet(`/warning/cold/area/${area}`).catch(() => null),
      ]);
      const norm = normalizeAreaAlerts(a);
      for (const t of [normalizeTempWarning(heat, 43), normalizeTempWarning(cold, 44)]) if (t) norm.alerts.push(t);
      norm.alerts.sort((x, y) => y.rank - x.rank);
      putSnapshot('smn-alertas', `area:${area}`, norm, norm.updated);
      ok++;
    });
    const failed = res.filter((r) => !r.ok);
    if (failed.length) log('warn', `${failed.length} zonas sin respuesta: ${failed[0].error.message}`);
    if (!ok) throw failed[0]?.error || new Error('Sin datos de alertas');

    // Avisos a muy corto plazo (tormentas severas en las próximas horas).
    try {
      const acp = await smnGet('/warning/shortterm');
      const list = Array.isArray(acp) ? acp : [];
      const affected = [];
      if (list.length) {
        const checks = await mapLimit(region.localities, 3, async (loc) => {
          const r = await smnGet(`/warning/shortterm/location/${loc.smnId}`);
          return Array.isArray(r) && r.length ? loc.id : null;
        });
        for (const c of checks) if (c.ok && c.value) affected.push(c.value);
      }
      putSnapshot('smn-alertas', 'shortterm', { nationalCount: list.length, localities: affected, checkedAt: new Date().toISOString() });
    } catch (e) {
      log('warn', `Avisos a corto plazo no disponibles: ${e.message}`);
    }
    return { items: ok, message: `${ok}/${areas.length} zonas` };
  },
};
