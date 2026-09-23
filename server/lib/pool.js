// Ejecuta tareas con concurrencia limitada y pausa entre llamadas (para no saturar servicios públicos).
export async function mapLimit(items, limit, fn, pauseMs = 250) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (e) {
        results[idx] = { ok: false, error: e };
      }
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
