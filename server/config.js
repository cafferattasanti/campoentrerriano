// Configuración central. Todo lo sensible viene de variables de entorno (.env).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Carga mínima de .env sin dependencias externas.
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|si|sí|yes)$/i.test(v));

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  dbPath: resolve(ROOT, env.DB_PATH || 'data/campo.db'),
  region: env.REGION || 'entre-rios',
  timezone: 'America/Argentina/Buenos_Aires',

  // Panel de administración
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || '',

  // Actualización automática
  schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
  userAgent: env.HTTP_USER_AGENT || 'CampoEntreRios/1.0 (+app informativa para productores; contacto: ' + (env.CONTACT_EMAIL || 'sin-contacto') + ')',
  httpTimeoutMs: Number(env.HTTP_TIMEOUT_MS || 20000),

  // Open-Meteo: gratis sin clave para uso NO comercial.
  // Si la app tiene publicidad o suscripciones, contratar plan y poner la clave acá.
  openMeteoApiKey: env.OPEN_METEO_API_KEY || '',
};

export function assertProductionConfig(log) {
  if (!config.adminPassword || config.adminPassword.length < 10) {
    log('ADVERTENCIA: ADMIN_PASSWORD no está configurada (o tiene menos de 10 caracteres). El panel /admin queda DESHABILITADO hasta configurarla.');
  }
  if (!config.sessionSecret || config.sessionSecret.length < 24) {
    log('ADVERTENCIA: SESSION_SECRET no está configurada (mínimo 24 caracteres). Se usará una clave temporal: las sesiones de admin se cierran al reiniciar.');
  }
}
