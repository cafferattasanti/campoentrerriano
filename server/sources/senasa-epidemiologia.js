// SENASA — "Situación epidemiológica": comunicados oficiales de detecciones (hoy centrado en influenza aviar).
import { getText } from '../lib/http.js';
import { stripTags, spanishLongDateToIso } from '../lib/text.js';
import { putSnapshot } from '../db.js';

const URL = 'https://www.argentina.gob.ar/senasa/situacion-epidemiologica';

export function parseEpidemiologia(html) {
  const items = [];
  const re = /<p>\s*(\d{1,2} de [a-záéíóú]+ de \d{4})\s*<br\s*\/?>\s*<a href="([^"]+)"[^>]*>\s*(?:<strong>)?([\s\S]*?)(?:<\/strong>)?\s*<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    items.push({ date: spanishLongDateToIso(m[1]), url: m[2].startsWith('http') ? m[2] : 'https://www.argentina.gob.ar' + m[2], title: stripTags(m[3]) });
  }
  return items;
}

export default {
  id: 'senasa-epidemiologia',
  name: 'SENASA — Situación epidemiológica (comunicados de detecciones)',
  org: 'Servicio Nacional de Sanidad y Calidad Agroalimentaria',
  category: 'sanidad',
  url: URL,
  official: true,
  access: 'Página pública oficial. Sin API Key.',
  everyMin: 60 * 3,
  staleAfterMin: 60 * 24 * 3,
  async run() {
    const items = parseEpidemiologia(await getText(URL, { headers: { Accept: 'text/html' } }));
    if (!items.length) throw new Error('No se encontraron comunicados (¿cambió el formato?)');
    putSnapshot('senasa-epidemiologia', 'lista', { items: items.slice(0, 40) }, items[0].date);
    return { items: items.length, message: `Último comunicado: ${items[0].date}` };
  },
};
