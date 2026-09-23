// Cliente del servicio web que usa el propio sitio del Servicio Meteorológico Nacional (ws1.smn.gob.ar).
//
// IMPORTANTE (transparencia): este servicio NO está publicado como API abierta documentada.
// Es el mismo que consume www.smn.gob.ar: el sitio entrega a cada visitante un token anónimo
// (rol "web", válido ~1 hora) dentro de la página. Lo obtenemos igual que un navegador,
// lo reutilizamos hasta que vence y hacemos pocas consultas (con caché) para no cargar el servicio.
// Si el SMN cambia este mecanismo, la app sigue funcionando con las fuentes alternativas
// (datos abiertos del SMN y Open-Meteo) y el panel de administración muestra el error.
import { getText, getJson, HttpError } from '../lib/http.js';

export const SMN_WS = 'https://ws1.smn.gob.ar/v1';
const SMN_HOME = 'https://www.smn.gob.ar/';

let token = null;
let tokenExp = 0;

function decodeExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return (payload.exp || 0) * 1000;
  } catch {
    return Date.now() + 30 * 60e3;
  }
}

export function extractToken(html) {
  const m = String(html).match(/localStorage\.setItem\(\s*['"]token['"]\s*,\s*['"]([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)['"]\s*\)/);
  return m ? m[1] : null;
}

async function getToken(force = false) {
  if (!force && token && Date.now() < tokenExp - 120e3) return token;
  const html = await getText(SMN_HOME, { headers: { Accept: 'text/html' } });
  const t = extractToken(html);
  if (!t) throw new Error('No se encontró el token público en la página del SMN (¿cambió el sitio?).');
  token = t;
  tokenExp = decodeExp(t);
  return token;
}

export async function smnGet(path) {
  let t = await getToken();
  try {
    return await getJson(SMN_WS + path, { headers: { Authorization: 'JWT ' + t } });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      t = await getToken(true);
      return getJson(SMN_WS + path, { headers: { Authorization: 'JWT ' + t } });
    }
    throw e;
  }
}

// Códigos verificados en el código del sitio del SMN (barra_alerta.js / alertas.js, 23/09/2026).
export const SMN_EVENTS = {
  41: 'Tormentas', 37: 'Lluvias', 42: 'Nevadas', 39: 'Viento', 47: 'Viento zonda',
  43: 'Temperaturas altas (calor extremo)', 44: 'Temperaturas bajas (frío extremo)',
  40: 'Niebla', 46: 'Polvo en suspensión', 54: 'Humo', 45: 'Ceniza volcánica',
};

// Alertas por fenómeno: 3 amarillo, 4 naranja, 5 rojo (1-2 = sin alerta).
export function alertLevelName(level) {
  return level >= 5 ? 'Rojo' : level === 4 ? 'Naranja' : level === 3 ? 'Amarillo' : null;
}
// Sistema de temperaturas extremas: 2 amarillo, 3 naranja, 4 rojo (1 = sin alerta).
export function tempLevelName(level) {
  return level >= 4 ? 'Rojo' : level === 3 ? 'Naranja' : level === 2 ? 'Amarillo' : null;
}
// Nivel unificado para la interfaz: 1 amarillo, 2 naranja, 3 rojo.
export const LEVEL_RANK = { Amarillo: 1, Naranja: 2, Rojo: 3 };

export const PERIODS = { early_morning: 'madrugada', morning: 'mañana', afternoon: 'tarde', night: 'noche' };
