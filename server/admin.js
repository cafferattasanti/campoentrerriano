// Endpoints del panel de administración (requieren sesión).
import { SOURCES, getSource } from './sources/index.js';
import { FEEDS } from './sources/noticias.js';
import { runSource, isRunning } from './scheduler.js';
import { allSourceStates, updateSourceState, listLogs, listManual, insertManual, setManualActive, listNews, insertNews, db, getSetting, setSetting, log } from './db.js';
import { reloadContent } from './api.js';

const TYPES = ['aviso', 'precio', 'alerta_sanitaria', 'alerta_meteo'];

export function estado() {
  const states = Object.fromEntries(allSourceStates().map((s) => [s.id, s]));
  return {
    sources: SOURCES.map((s) => ({
      id: s.id, name: s.name, category: s.category, url: s.url, official: s.official, defaultEveryMin: s.everyMin,
      running: isRunning(s.id), ...states[s.id],
    })),
    feeds: FEEDS.map((f) => ({ id: f.id, name: f.name, url: f.url, enabled: !getSetting('news_disabled_feeds', []).includes(f.id) })),
    serverTime: new Date().toISOString(),
    uptimeMin: Math.round(process.uptime() / 60),
  };
}

export async function handleAdmin(method, path, body, send) {
  let m;
  if (method === 'GET' && path === '/api/admin/estado') return send(200, estado());
  if (method === 'GET' && path === '/api/admin/logs') return send(200, { logs: listLogs(300, body?.source || null) });

  if ((m = path.match(/^\/api\/admin\/fuentes\/([a-z0-9-]+)\/(actualizar|activar|desactivar|intervalo)$/)) && method === 'POST') {
    const [, id, action] = m;
    if (!getSource(id)) return send(404, { error: 'Fuente desconocida' });
    if (action === 'actualizar') return send(200, await runSource(id, { manual: true }));
    if (action === 'activar' || action === 'desactivar') {
      updateSourceState(id, { enabled: action === 'activar' ? 1 : 0, next_run_at: null });
      log('info', 'admin', `Fuente ${id} ${action === 'activar' ? 'activada' : 'desactivada'}`);
      return send(200, { ok: true });
    }
    const every = Number(body?.everyMin);
    const min = Math.max(getSource(id).everyMin / 2, 10);
    if (!Number.isFinite(every) || every < min || every > 60 * 24 * 7) return send(400, { error: `El intervalo debe estar entre ${min} y 10080 minutos.` });
    updateSourceState(id, { every_min: Math.round(every) });
    log('info', 'admin', `Intervalo de ${id}: ${every} min`);
    return send(200, { ok: true });
  }

  if ((m = path.match(/^\/api\/admin\/feeds\/([a-z0-9-]+)\/(activar|desactivar)$/)) && method === 'POST') {
    const list = new Set(getSetting('news_disabled_feeds', []));
    if (m[2] === 'desactivar') list.add(m[1]); else list.delete(m[1]);
    setSetting('news_disabled_feeds', [...list]);
    return send(200, { ok: true });
  }

  if (path === '/api/admin/contenido' && method === 'GET') return send(200, { items: listManual(null, false) });
  if (path === '/api/admin/contenido' && method === 'POST') {
    const b = body || {};
    if (!TYPES.includes(b.type)) return send(400, { error: 'Tipo inválido' });
    if (!b.title || String(b.title).trim().length < 3) return send(400, { error: 'Falta el título' });
    if (!b.sourceName || String(b.sourceName).trim().length < 2) return send(400, { error: 'Indicá la fuente del dato (obligatorio para no publicar información sin respaldo).' });
    if (b.url && !/^https?:\/\//.test(b.url)) return send(400, { error: 'El enlace debe empezar con http:// o https://' });
    const value = b.value === '' || b.value === undefined || b.value === null ? null : Number(String(b.value).replace(/\./g, '').replace(',', '.'));
    if (b.type === 'precio' && !Number.isFinite(value)) return send(400, { error: 'Precio inválido' });
    const id = insertManual({
      type: b.type, title: String(b.title).trim().slice(0, 200), body: b.body ? String(b.body).slice(0, 2000) : null,
      url: b.url || null, sourceName: String(b.sourceName).trim().slice(0, 150), value, unit: b.unit || null, currency: b.currency || null,
      contentDate: b.contentDate || new Date().toISOString().slice(0, 10),
    });
    log('info', 'admin', `Contenido manual agregado (${b.type}): ${b.title}`);
    return send(200, { ok: true, id });
  }
  if ((m = path.match(/^\/api\/admin\/contenido\/(\d+)\/(activar|desactivar)$/)) && method === 'POST') {
    setManualActive(Number(m[1]), m[2] === 'activar');
    return send(200, { ok: true });
  }

  if (path === '/api/admin/noticias' && method === 'GET') return send(200, { items: listNews({ limit: 100, includeHidden: true }) });
  if (path === '/api/admin/noticias' && method === 'POST') {
    const b = body || {};
    if (!b.title || !/^https?:\/\//.test(b.url || '')) return send(400, { error: 'Título y enlace (http/https) son obligatorios' });
    const ok = insertNews({ source: 'manual', sourceName: String(b.sourceName || 'Administración').slice(0, 100), category: String(b.category || 'entre-rios'), title: String(b.title).slice(0, 250), url: b.url, summary: b.summary ? String(b.summary).slice(0, 400) : null, publishedAt: new Date().toISOString(), manual: true });
    return send(ok ? 200 : 409, ok ? { ok: true } : { error: 'Ya existe una noticia con ese enlace' });
  }
  if ((m = path.match(/^\/api\/admin\/noticias\/(\d+)\/(ocultar|mostrar|fijar|desfijar)$/)) && method === 'POST') {
    const col = m[2] === 'ocultar' || m[2] === 'mostrar' ? 'hidden' : 'pinned';
    const val = m[2] === 'ocultar' || m[2] === 'fijar' ? 1 : 0;
    db.prepare(`UPDATE news SET ${col} = ? WHERE id = ?`).run(val, Number(m[1]));
    return send(200, { ok: true });
  }
  if (path === '/api/admin/recargar-contenido' && method === 'POST') {
    try { reloadContent(); return send(200, { ok: true }); } catch (e) { return send(500, { error: 'JSON inválido: ' + e.message }); }
  }
  return send(404, { error: 'No encontrado' });
}
