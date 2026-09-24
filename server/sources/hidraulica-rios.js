// Dirección de Hidráulica de Entre Ríos (DGHyOS) — niveles de los ríos. Se usa junto con Prefectura:
//  - Ríos principales (Paraná, Uruguay, Delta): datos del Instituto Nacional del Agua (INA) que publica
//    la Dirección en https://www.hidraulica.gob.ar/nivhidr.php (JSON público).
//  - Río Gualeguay (Puerto Ruiz y Rosario del Tala): escalas propias de la Dirección, lectura diaria.
// Prefectura bloquea las conexiones desde servidores fuera de Argentina; esta fuente sí responde desde afuera,
// así la web pública siempre tiene el dato de los ríos.
import { getJson } from '../lib/http.js';
import { currentRegion } from '../regions/index.js';
import { putSnapshot } from '../db.js';

const BASE = 'https://www.hidraulica.gob.ar/';
export const PAGE_HID = BASE + 'nivhidr.php';
export const PAGE_HID_GUALEGUAY = BASE + 'gualeguay_nivhidr.php';

// "24/09/2026 00:00" -> "2026-09-24T00:00:00-03:00"
export function inaDate(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00` : null;
}

export function normalizeIna(arr) {
  return (Array.isArray(arr) ? arr : []).filter((e) => e && e.provincia === 'ENTRERIOS').map((e) => ({
    nombre: e.nombre,
    cuenca: e.cuenca,
    height: typeof e.valor_actual === 'number' ? e.valor_actual : null,
    at: inaDate(e.fecha_actual),
    delta: typeof e.delta === 'number' ? e.delta : null,
    tendencia: e.tendencia || null, // sube / baja / estable / sin_dato
    alert: e.nivel_alerta ?? null,
    evacuation: e.nivel_evacuacion ?? null,
    vigente: e.vigente !== false,
  }));
}

// [{f:"2026-09-23", v:"140"}] en centímetros → metros
export function normalizeGualeguay(arr) {
  const rows = (Array.isArray(arr) ? arr : []).map((x) => ({ date: x.f, height: Number(x.v) / 100 })).filter((x) => x.date && Number.isFinite(x.height)).sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export default {
  id: 'hidraulica-rios',
  name: 'Dirección de Hidráulica de Entre Ríos — Niveles de los ríos (con datos del INA)',
  org: 'Dirección General de Hidráulica de Entre Ríos · Instituto Nacional del Agua',
  category: 'rios',
  url: PAGE_HID,
  official: true,
  access: 'Página y datos públicos oficiales. Sin API Key. Lecturas diarias.',
  everyMin: 120,
  staleAfterMin: 60 * 72,
  async run({ log } = {}) {
    const region = currentRegion();
    let ina = [];
    const gual = {};
    const errors = [];
    try { ina = normalizeIna(await getJson(BASE + 'ina/ajax.estaciones.json.php')); } catch (e) { errors.push('INA: ' + e.message); }
    for (const code of [...new Set(region.rivers.map((r) => r.hid).filter(Boolean))]) {
      try { gual[code] = normalizeGualeguay(await getJson(`${BASE}gualeguay_nivhidr.ajax.php?estacion=${code}&tiempo=A`)); } catch (e) { errors.push(code + ': ' + e.message); }
    }
    if (errors.length) log?.('warn', errors.join(' | '));
    if (!ina.length && !Object.values(gual).some((x) => x.length)) throw new Error(errors[0] || 'Sin datos');
    const pr = gual.PR?.at(-1);
    putSnapshot('hidraulica-rios', 'entre-rios', { ina, gualeguay: gual }, pr?.date || ina[0]?.at || null);
    return { items: ina.length + Object.keys(gual).length, message: `${ina.length} estaciones INA · Puerto Ruiz ${pr ? pr.height + ' m (' + pr.date + ')' : 's/d'}` };
  },
};
