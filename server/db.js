// Base de datos SQLite embebida (módulo nativo node:sqlite, sin dependencias).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  every_min INTEGER,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  last_duration_ms INTEGER,
  last_items INTEGER
);
CREATE TABLE IF NOT EXISTS snapshots (
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  data_date TEXT,
  PRIMARY KEY (source, key)
);
CREATE TABLE IF NOT EXISTS price_history (
  product TEXT NOT NULL,
  market TEXT NOT NULL,
  date TEXT NOT NULL,
  value REAL,
  unit TEXT,
  currency TEXT,
  source TEXT,
  PRIMARY KEY (product, market, date)
);
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_name TEXT,
  category TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  summary TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  manual INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_news_pub ON news(published_at DESC);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS manual_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  source_name TEXT,
  value REAL,
  unit TEXT,
  currency TEXT,
  content_date TEXT,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

const nowIso = () => new Date().toISOString();

// ---------- snapshots (datos ya procesados de cada fuente) ----------
const stPut = db.prepare(`INSERT INTO snapshots (source, key, data, fetched_at, data_date) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(source, key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, data_date = excluded.data_date`);
const stGet = db.prepare('SELECT data, fetched_at, data_date FROM snapshots WHERE source = ? AND key = ?');
const stList = db.prepare('SELECT key, data, fetched_at, data_date FROM snapshots WHERE source = ?');

export function putSnapshot(source, key, data, dataDate = null) {
  stPut.run(source, key, JSON.stringify(data), nowIso(), dataDate);
}
export function getSnapshot(source, key) {
  const r = stGet.get(source, key);
  return r ? { data: JSON.parse(r.data), fetchedAt: r.fetched_at, dataDate: r.data_date } : null;
}
export function listSnapshots(source) {
  return stList.all(source).map((r) => ({ key: r.key, data: JSON.parse(r.data), fetchedAt: r.fetched_at, dataDate: r.data_date }));
}

// ---------- historial de precios ----------
const stPrice = db.prepare(`INSERT INTO price_history (product, market, date, value, unit, currency, source) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(product, market, date) DO UPDATE SET value = excluded.value, unit = excluded.unit, currency = excluded.currency, source = excluded.source`);
const stPricePrev = db.prepare('SELECT date, value FROM price_history WHERE product = ? AND market = ? AND date < ? AND value IS NOT NULL ORDER BY date DESC LIMIT 1');
export function savePrice(p) {
  stPrice.run(p.product, p.market, p.date, p.value ?? null, p.unit ?? null, p.currency ?? null, p.source ?? null);
}
export function previousPrice(product, market, date) {
  return stPricePrev.get(product, market, date) || null;
}

// ---------- noticias ----------
const stNewsIns = db.prepare(`INSERT INTO news (source, source_name, category, title, url, summary, published_at, fetched_at, manual)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING`);
export function insertNews(n) {
  const r = stNewsIns.run(n.source, n.sourceName ?? null, n.category ?? null, n.title, n.url, n.summary ?? null, n.publishedAt ?? null, nowIso(), n.manual ? 1 : 0);
  return r.changes > 0;
}
export function listNews({ category = null, limit = 30, includeHidden = false, sources = null } = {}) {
  const where = [];
  const args = [];
  if (!includeHidden) where.push('hidden = 0');
  if (category) { where.push("(',' || category || ',') LIKE ?"); args.push(`%,${category},%`); }
  if (sources && sources.length) { where.push(`source IN (${sources.map(() => '?').join(',')})`); args.push(...sources); }
  const sql = `SELECT * FROM news ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args);
}
export function pruneNews(maxAgeDays = 120) {
  const cutoff = new Date(Date.now() - maxAgeDays * 864e5).toISOString();
  db.prepare('DELETE FROM news WHERE manual = 0 AND pinned = 0 AND published_at < ?').run(cutoff);
}

// ---------- logs ----------
const stLog = db.prepare('INSERT INTO logs (ts, level, source, message) VALUES (?, ?, ?, ?)');
export function log(level, source, message) {
  const ts = nowIso();
  stLog.run(ts, level, source ?? null, String(message).slice(0, 2000));
  const line = `[${ts}] ${level.toUpperCase()}${source ? ' ' + source : ''}: ${message}`;
  if (level === 'error') console.error(line); else console.log(line);
}
export function listLogs(limit = 200, source = null) {
  if (source) return db.prepare('SELECT * FROM logs WHERE source = ? ORDER BY id DESC LIMIT ?').all(source, limit);
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit);
}
export function pruneLogs(keep = 5000) {
  db.prepare('DELETE FROM logs WHERE id < (SELECT COALESCE(MAX(id), 0) - ? FROM logs)').run(keep);
}

// ---------- settings ----------
export function getSetting(key, def = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : def;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

// ---------- caché genérica con vencimiento ----------
export function cacheGet(key) {
  const r = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key);
  if (!r) return null;
  if (r.expires_at < Date.now()) return null;
  return JSON.parse(r.value);
}
export function cacheGetStale(key) {
  const r = db.prepare('SELECT value FROM cache WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : null;
}
export function cacheSet(key, value, ttlMs) {
  db.prepare('INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
    .run(key, JSON.stringify(value), Date.now() + ttlMs);
}
export function pruneCache() {
  db.prepare('DELETE FROM cache WHERE expires_at < ?').run(Date.now() - 30 * 864e5);
}

// ---------- estado de fuentes ----------
export function ensureSource(id, everyMin, enabledDefault = true) {
  db.prepare('INSERT INTO sources (id, enabled, every_min) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING').run(id, enabledDefault ? 1 : 0, everyMin);
}
export function getSourceState(id) {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) || null;
}
export function allSourceStates() {
  return db.prepare('SELECT * FROM sources').all();
}
export function updateSourceState(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE sources SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}

// ---------- contenido manual del administrador ----------
export function listManual(type = null, onlyActive = true) {
  const where = [];
  const args = [];
  if (type) { where.push('type = ?'); args.push(type); }
  if (onlyActive) where.push('active = 1');
  return db.prepare(`SELECT * FROM manual_content ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(content_date, created_at) DESC, id DESC`).all(...args);
}
export function insertManual(m) {
  return db.prepare(`INSERT INTO manual_content (type, title, body, url, source_name, value, unit, currency, content_date, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(m.type, m.title, m.body ?? null, m.url ?? null, m.sourceName ?? null,
    m.value ?? null, m.unit ?? null, m.currency ?? null, m.contentDate ?? null, nowIso()).lastInsertRowid;
}
export function setManualActive(id, active) {
  db.prepare('UPDATE manual_content SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}
