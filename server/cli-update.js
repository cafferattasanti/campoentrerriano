// Actualiza todas las fuentes una vez y termina. Útil para probar conexiones o para usar con un cron externo:
//   npm run update-now            -> todas
//   npm run update-now -- bcr-pizarra smn-alertas
import { SOURCES } from './sources/index.js';
import { initSources, runSource } from './scheduler.js';

initSources();
const ids = process.argv.slice(2).length ? process.argv.slice(2) : SOURCES.map((s) => s.id);
let fails = 0;
for (const id of ids) {
  const r = await runSource(id, { manual: true });
  console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${id}: ${r.ok ? r.message || '' : r.error}`);
  if (!r.ok) fails++;
}
process.exit(fails ? 1 : 0);
