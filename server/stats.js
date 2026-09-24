// Contador de visitas propio, simple y sin datos personales.
// - No usa cookies ni servicios externos.
// - Para contar "personas distintas por día" se guarda un código irreversible (hash) de IP + navegador,
//   mezclado con una clave al azar que cambia cada día: no se puede saber quién es ni seguirlo entre días.
// - Esos códigos se borran a los 2 días. Solo quedan totales por día.
import { createHash, randomBytes } from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS stats_daily (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key));
CREATE TABLE IF NOT EXISTS stats_seen (day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (day, h));
`);

const BOT = /bot|crawl|spider|slurp|curl|wget|python|node-fetch|axios|headless|lighthouse|monitor|uptime|preview|facebookexternalhit|whatsapp|telegram/i;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const stInc = db.prepare('INSERT INTO stats_daily (day, key, n) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET n = n + 1');
const stSeen = db.prepare('INSERT INTO stats_seen (day, h) VALUES (?, ?) ON CONFLICT DO NOTHING');

function salt(day) {
  const s = getSetting('stats_salt', null);
  if (s && s.day === day) return s.value;
  const value = randomBytes(16).toString('hex');
  setSetting('stats_salt', { day, value });
  db.prepare('DELETE FROM stats_seen WHERE day < ?').run(day);
  return value;
}

// Secciones que interesan a un auspiciante (qué mira la gente).
const SECTIONS = { '/api/inicio': 'inicio', '/api/clima': 'clima', '/api/alertas': 'alertas', '/api/mercado': 'mercado', '/api/dolar': 'dolar', '/api/rios': 'rios', '/api/sanitarias': 'sanitarias', '/api/cultivos': 'cultivos', '/api/noticias': 'noticias' };

export function track(req, path, ip) {
  try {
    const ua = req.headers['user-agent'] || '';
    if (!ua || BOT.test(ua)) return;
    const day = today();
    if (path === '/api/meta') {
      // /api/meta se pide una vez por cada apertura de la página.
      stInc.run(day, 'visitas');
      const h = createHash('sha256').update(salt(day) + '|' + ip + '|' + ua).digest('base64url').slice(0, 22);
      if (stSeen.run(day, h).changes) stInc.run(day, 'personas');
      if (/Android|iPhone|iPad|Mobile/i.test(ua)) stInc.run(day, 'celular');
      return;
    }
    const sec = SECTIONS[path] || null;
    if (sec) stInc.run(day, 'sec:' + sec);
  } catch { /* el contador nunca debe romper la página */ }
}

export function statsSummary(days = 30) {
  const d = Math.min(Math.max(Number(days) || 30, 1), 400);
  const from = new Date(Date.now() - d * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const rows = db.prepare('SELECT day, key, n FROM stats_daily WHERE day >= ? ORDER BY day').all(from);
  const byDay = {};
  for (const r of rows) {
    const o = (byDay[r.day] ||= { dia: r.day, visitas: 0, personas: 0, celular: 0, secciones: {} });
    if (r.key.startsWith('sec:')) o.secciones[r.key.slice(4)] = r.n; else o[r.key] = r.n;
  }
  return {
    nota: 'Totales por día (hora de Argentina). "personas" = visitantes distintos en el día. Sin datos personales. El contador empieza de cero si el servidor se reinicia; el historial se guarda cada día en GitHub (rama "estadisticas").',
    desde: from,
    generado: new Date().toISOString(),
    dias: Object.values(byDay),
  };
}
