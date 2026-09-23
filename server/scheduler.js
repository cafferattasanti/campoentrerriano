// Planificador interno: cada fuente se actualiza sola con su propia frecuencia.
// Si una fuente falla, se reintenta con espera creciente (sin martillar al servidor) y se conserva el último dato bueno.
import { SOURCES, getSource } from './sources/index.js';
import { ensureSource, getSourceState, updateSourceState, log, pruneLogs, pruneCache } from './db.js';

const running = new Set();
let timer = null;

function nextRun(everyMin, failures) {
  const base = everyMin * 60e3;
  const backoff = failures ? Math.min(Math.max(base * 2 ** (failures - 1), 5 * 60e3), 6 * 3600e3) : base;
  const jitter = backoff * (Math.random() * 0.1 - 0.05);
  return new Date(Date.now() + backoff + jitter).toISOString();
}

export function initSources() {
  for (const s of SOURCES) {
    ensureSource(s.id, s.everyMin, s.enabledByDefault !== false);
    // Fuentes que se desactivaron por defecto en una versión nueva: si nunca funcionaron, se apagan.
    const st = getSourceState(s.id);
    if (s.enabledByDefault === false && st && !st.last_success_at && st.enabled) updateSourceState(s.id, { enabled: 0 });
    // Al reiniciar, las fuentes que venían fallando se reintentan enseguida (puede haber un arreglo nuevo).
    else if (st && st.consecutive_failures > 0) updateSourceState(s.id, { next_run_at: null });
  }
}

export async function runSource(id, { manual = false } = {}) {
  const src = getSource(id);
  if (!src) throw new Error(`Fuente desconocida: ${id}`);
  if (running.has(id)) return { skipped: true, message: 'Ya se está actualizando' };
  running.add(id);
  const t0 = Date.now();
  const state = getSourceState(id);
  const everyMin = state?.every_min || src.everyMin;
  updateSourceState(id, { last_run_at: new Date().toISOString() });
  try {
    const res = (await src.run({ log: (level, msg) => log(level, id, msg) })) || {};
    updateSourceState(id, {
      last_success_at: new Date().toISOString(),
      consecutive_failures: 0,
      last_duration_ms: Date.now() - t0,
      last_items: res.items ?? null,
      next_run_at: nextRun(everyMin, 0),
    });
    log('info', id, `${manual ? '[manual] ' : ''}OK en ${Date.now() - t0} ms — ${res.message || ''}`);
    return { ok: true, ...res };
  } catch (e) {
    const failures = (state?.consecutive_failures || 0) + 1;
    updateSourceState(id, {
      last_error_at: new Date().toISOString(),
      last_error: String(e.message || e).slice(0, 500),
      consecutive_failures: failures,
      last_duration_ms: Date.now() - t0,
      next_run_at: nextRun(everyMin, failures),
    });
    log('error', id, `${manual ? '[manual] ' : ''}Falló (intento ${failures}): ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    running.delete(id);
  }
}

async function tick() {
  const now = Date.now();
  for (const s of SOURCES) {
    const st = getSourceState(s.id);
    if (!st || !st.enabled || running.has(s.id)) continue;
    if (st.next_run_at && Date.parse(st.next_run_at) > now) continue;
    // Una fuente por vez en cada vuelta para no disparar todo junto.
    await runSource(s.id);
  }
}

export function startScheduler() {
  initSources();
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { log('error', 'scheduler', e.message); } finally { busy = false; }
  };
  setTimeout(loop, 2000);
  timer = setInterval(loop, 30e3);
  setInterval(() => { pruneLogs(); pruneCache(); }, 6 * 3600e3);
  log('info', 'scheduler', `Actualización automática activa (${SOURCES.length} fuentes).`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
}

export function isRunning(id) {
  return running.has(id);
}
