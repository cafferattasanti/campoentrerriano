// Metadatos de frescura y estado de cada dato mostrado (para no presentar nunca un dato viejo como actual).
import { getSource } from '../sources/index.js';
import { getSourceState } from '../db.js';

export function meta(sourceId, snap) {
  const src = getSource(sourceId);
  const st = getSourceState(sourceId);
  const fetchedAt = snap?.fetchedAt || null;
  const ageMin = fetchedAt ? Math.round((Date.now() - Date.parse(fetchedAt)) / 60e3) : null;
  const failing = !!(st?.last_error_at && (!st.last_success_at || st.last_error_at > st.last_success_at));
  let status;
  if (!snap) status = failing ? 'error' : st && !st.enabled ? 'disabled' : 'pending';
  else if (ageMin > (src?.staleAfterMin ?? 180)) status = 'stale';
  else status = failing ? 'retrying' : 'ok';
  return {
    source: sourceId,
    sourceName: src?.org || sourceId,
    url: src?.url || null,
    official: !!src?.official,
    fetchedAt,
    dataDate: snap?.dataDate || null,
    ageMin,
    status,
    failing,
  };
}
