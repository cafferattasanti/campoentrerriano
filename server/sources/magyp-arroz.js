// Precio mensual del arroz cáscara publicado por la Secretaría de Agricultura, Ganadería y Pesca.
import { getText } from '../lib/http.js';
import { stripTags, parseArNumber } from '../lib/text.js';
import { putSnapshot, savePrice } from '../db.js';

const URL = 'https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/areas/regionales/_archivos/000010_Precios%20Locales/000020_Arroz/000001_Precios%20de%20Arroz%20C%C3%A1scara%20Internos.php';

export function parseArroz(html) {
  const rows = [];
  const re = /<tr>\s*<td[^>]*>\s*(\d{4})\/(\d{2})\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html))) {
    const period = `${m[1]}-${m[2]}`;
    if (seen.has(period)) continue; // la tabla oficial a veces repite un mes
    seen.add(period);
    rows.push({ period, largoFino: parseArNumber(stripTags(m[3])), largoAncho: parseArNumber(stripTags(m[4])) });
  }
  rows.sort((a, b) => b.period.localeCompare(a.period));
  return { unit: '$/quintal (100 kg)', rows: rows.slice(0, 13), latest: rows[0] || null };
}

export default {
  id: 'magyp-arroz',
  name: 'SAGyP — Precio mensual del arroz cáscara',
  org: 'Secretaría de Agricultura, Ganadería y Pesca de la Nación',
  category: 'precios',
  url: URL,
  official: true,
  access: 'Página pública oficial. Sin API Key.',
  everyMin: 60 * 12,
  staleAfterMin: 60 * 24 * 70,
  async run() {
    const p = parseArroz(await getText(URL, { headers: { Accept: 'text/html' } }));
    if (!p.latest) throw new Error('No se encontró la tabla de precios de arroz');
    for (const r of p.rows.slice(0, 3)) {
      if (r.largoFino !== null) savePrice({ product: 'Arroz cáscara largo fino', market: 'Nacional (SAGyP)', date: r.period + '-01', value: r.largoFino, unit: 'quintal', currency: 'ARS', source: 'magyp-arroz' });
      if (r.largoAncho !== null) savePrice({ product: 'Arroz cáscara largo ancho', market: 'Nacional (SAGyP)', date: r.period + '-01', value: r.largoAncho, unit: 'quintal', currency: 'ARS', source: 'magyp-arroz' });
    }
    putSnapshot('magyp-arroz', 'mensual', p, p.latest.period);
    return { items: p.rows.length, message: `Último mes publicado: ${p.latest.period}` };
  },
};
