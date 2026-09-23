// Servidor HTTP: sirve la web (archivos estáticos), la API pública, el panel de administración
// y arranca el sistema de actualización automática.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, normalize as normPath } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { config, ROOT, assertProductionConfig } from './config.js';
import { log } from './db.js';
import * as api from './api.js';
import { handleAdmin } from './admin.js';
import { isAdmin, checkPassword, sessionCookie, clearCookie, tooManyAttempts, adminEnabled } from './auth.js';
import { startScheduler, initSources } from './scheduler.js';

const PUBLIC = resolve(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
};

// Caché en memoria de archivos estáticos ya comprimidos (el sitio pesa muy poco).
const fileCache = new Map();
function loadStatic(rel) {
  const full = resolve(PUBLIC, '.' + normPath('/' + rel));
  if (!full.startsWith(PUBLIC) || !existsSync(full) || !statSync(full).isFile()) return null;
  const mtime = statSync(full).mtimeMs;
  const hit = fileCache.get(full);
  if (hit && hit.mtime === mtime) return hit;
  const body = readFileSync(full);
  const type = MIME[extname(full)] || 'application/octet-stream';
  const entry = { body, gz: /text|json|svg|javascript|manifest/.test(type) ? gzipSync(body, { level: 9 }) : null, type, etag: '"' + createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"', mtime };
  fileCache.set(full, entry);
  return entry;
}

function sendJson(req, res, status, obj, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && body.length > 1024;
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}), ...extraHeaders });
  res.end(gz ? gzipSync(body) : body);
}

async function readBody(req, limit = 20000) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody({});
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  const send = (s, o, h) => sendJson(req, res, s, o, h);

  if (path === '/salud') return send(200, { ok: true, time: new Date().toISOString() });

  if (path.startsWith('/api/')) {
    try {
      // --- Públicos (solo GET) ---
      if (req.method === 'GET') {
        if (path === '/api/meta') return send(200, api.metaInfo());
        if (path === '/api/inicio') return send(200, api.inicio(q.loc));
        if (path === '/api/clima') return send(200, api.clima(q.loc));
        if (path === '/api/alertas') return send(200, api.alertas(q.loc));
        if (path === '/api/precios') return send(200, api.precios());
        if (path === '/api/noticias') return send(200, api.noticias({ cat: q.cat, limit: q.limit, source: q.fuente }));
        if (path === '/api/sanidad') return send(200, api.sanidad());
        if (path.startsWith('/api/sanidad/')) {
          const e = api.especie(path.split('/').pop());
          return e ? send(200, e) : send(404, { error: 'Especie no encontrada' });
        }
        if (path === '/api/cultivos') return send(200, api.cultivos());
        if (path === '/api/fuentes') return send(200, api.fuentes());
        if (path === '/api/medicamentos') {
          try {
            return send(200, await api.medicamentos(q.q || '', q.especie || ''));
          } catch (e) {
            log('warn', 'vademecum', e.message);
            return send(503, { error: 'No pudimos consultar el registro oficial del SENASA en este momento. Probá de nuevo en unos minutos.', vademecumUrl: 'https://aps2.senasa.gov.ar/vademecumVet/app/publico/farmacos' });
          }
        }
        if (path === '/api/admin/sesion') return send(200, { admin: isAdmin(req), enabled: adminEnabled() });
      }

      // --- Administración ---
      if (path === '/api/admin/login' && req.method === 'POST') {
        const ip = clientIp(req);
        if (!adminEnabled()) return send(503, { error: 'El panel está deshabilitado: falta configurar ADMIN_PASSWORD en el servidor.' });
        if (tooManyAttempts(ip)) return send(429, { error: 'Demasiados intentos. Esperá 15 minutos.' });
        const body = await readBody(req);
        if (!checkPassword(ip, body.password)) { log('warn', 'admin', `Intento de ingreso fallido desde ${ip}`); return send(401, { error: 'Contraseña incorrecta' }); }
        log('info', 'admin', `Ingreso al panel desde ${ip}`);
        return send(200, { ok: true }, { 'Set-Cookie': sessionCookie(req.headers['x-forwarded-proto'] === 'https') });
      }
      if (path === '/api/admin/logout' && req.method === 'POST') return send(200, { ok: true }, { 'Set-Cookie': clearCookie() });
      if (path.startsWith('/api/admin/')) {
        if (!isAdmin(req)) return send(401, { error: 'Sesión vencida. Ingresá de nuevo.' });
        if (req.method === 'POST' && req.headers['x-requested-with'] !== 'campo-admin') return send(403, { error: 'Solicitud no permitida' });
        const body = req.method === 'POST' ? await readBody(req) : q;
        return await handleAdmin(req.method, path, body, send);
      }
      return send(404, { error: 'No encontrado' });
    } catch (e) {
      log('error', 'api', `${req.method} ${path}: ${e.stack || e.message}`);
      return send(500, { error: 'Error interno' });
    }
  }

  // --- Archivos estáticos ---
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel = path === '/' ? '/index.html' : path === '/admin' || path === '/admin/' ? '/admin.html' : path;
  let f = loadStatic(rel);
  if (!f) { f = loadStatic('/404.html'); if (!f) { res.writeHead(404); return res.end('No encontrado'); } res.statusCode = 404; }
  const isHtml = f.type.startsWith('text/html');
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, { ETag: f.etag }); return res.end(); }
  const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(res.statusCode || 200, {
    ...SECURITY,
    'Content-Type': f.type,
    ETag: f.etag,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
    ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : gz ? f.gz : f.body);
}

assertProductionConfig((m) => log('warn', 'config', m));
const server = createServer((req, res) => { handle(req, res).catch((e) => { log('error', 'http', e.message); if (!res.headersSent) { res.writeHead(500); res.end(); } }); });
server.listen(config.port, config.host, () => {
  log('info', 'server', `Campo Entre Ríos escuchando en http://${config.host}:${config.port}`);
  // Direcciones para abrir la app desde el celular conectado al mismo Wi-Fi.
  const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${config.port}`);
  console.log('\n  En esta computadora abrí:  http://localhost:' + config.port);
  if (lan.length) console.log('  En el celular (mismo Wi-Fi): ' + lan.join('  o  '));
  console.log('  Para apagar la app: cerrá esta ventana.\n');
  if (config.schedulerEnabled) startScheduler(); else { initSources(); log('warn', 'scheduler', 'Actualización automática DESACTIVADA (SCHEDULER_ENABLED=false).'); }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log('info', 'server', 'Apagando…'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
