// Sesión de administrador: cookie firmada (HMAC), HttpOnly, SameSite=Strict, 12 horas.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const SECRET = config.sessionSecret && config.sessionSecret.length >= 24 ? config.sessionSecret : randomBytes(32).toString('hex');
const COOKIE = 'campo_admin';
const TTL = 12 * 3600e3;
const attempts = new Map();

const sign = (s) => createHmac('sha256', SECRET).update(s).digest('base64url');

export function adminEnabled() {
  return !!config.adminPassword && config.adminPassword.length >= 10;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(ip, list);
  return list.length >= 5;
}

export function checkPassword(ip, password) {
  if (!adminEnabled()) return false;
  const ok = safeEqual(password || '', config.adminPassword);
  if (!ok) attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
  return ok;
}

export function sessionCookie(secure) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL })).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}${secure ? '; Secure' : ''}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function isAdmin(req) {
  if (!adminEnabled()) return false;
  const raw = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}
