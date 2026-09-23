// Cliente HTTP con timeout, reintento corto y User-Agent identificable.
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(message, status, url) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

async function once(url, { headers = {}, timeoutMs = config.httpTimeoutMs, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { 'User-Agent': config.userAgent, 'Accept-Language': 'es-AR,es;q=0.9', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new HttpError(`HTTP ${res.status} en ${url}`, res.status, url);
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new HttpError(`Tiempo de espera agotado (${timeoutMs} ms) en ${url}`, 0, url);
    if (e instanceof HttpError) throw e;
    throw new HttpError(`Error de red en ${url}: ${e.cause?.code || e.message}`, 0, url);
  } finally {
    clearTimeout(t);
  }
}

// Reintenta una vez ante errores de red o 5xx (no ante 4xx).
export async function request(url, opts = {}) {
  try {
    return await once(url, opts);
  } catch (e) {
    if (e.status >= 400 && e.status < 500) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return once(url, opts);
  }
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (opts.encoding) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder(opts.encoding).decode(buf);
  }
  return res.text();
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new HttpError(`Respuesta no es JSON válido en ${url}`, res.status, url);
  }
}

export async function getBuffer(url, opts = {}) {
  const res = await request(url, opts);
  return Buffer.from(await res.arrayBuffer());
}
