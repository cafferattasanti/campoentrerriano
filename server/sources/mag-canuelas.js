// Mercado Agroganadero de Cañuelas (ex Liniers): precios de hacienda por categoría, $/kg vivo.
import { getText } from '../lib/http.js';
import { stripTags, parseArNumber, arDateToIso } from '../lib/text.js';
import { putSnapshot, savePrice, previousPrice } from '../db.js';

const URL = 'https://www.mercadoagroganadero.com.ar/dll/hacienda1.dll/haciinfo000002';
const GROUPS = ['NOVILLOS', 'NOVILLITOS', 'VAQUILLONAS', 'VACAS', 'TOROS', 'MEJ'];
const GROUP_LABEL = { NOVILLOS: 'Novillos', NOVILLITOS: 'Novillitos', VAQUILLONAS: 'Vaquillonas', VACAS: 'Vacas', TOROS: 'Toros', MEJ: 'MEJ (machos enteros jóvenes)' };

export function parseCanuelas(html) {
  const text = stripTags(html);
  const hm = text.match(/PRECIOS POR CATEGORIA DESDE EL \S+ (\d{2}\/\d{2}\/\d{4}) AL \S+ (\d{2}\/\d{2}\/\d{4})\s*(PRECIOS \S+)?/i);
  const rows = [];
  const re = /<TR[^>]*>\s*<TD>(?:<BR>)?([^<]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>\s*<TD[^>]*>\$?([\d.,]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>/gi;
  let m;
  while ((m = re.exec(html))) {
    const name = m[1].replace(/&nbsp;/g, ' ').trim();
    rows.push({
      category: name,
      group: GROUPS.find((g) => name.toUpperCase().startsWith(g + ' ')) || null,
      min: parseArNumber(m[2]), max: parseArNumber(m[3]), avg: parseArNumber(m[4]), median: parseArNumber(m[5]),
      heads: parseArNumber(m[6]), amount: parseArNumber(m[7]), kg: parseArNumber(m[8]), avgKg: parseArNumber(m[9]),
    });
  }
  const groups = GROUPS.map((g) => {
    const rs = rows.filter((r) => r.group === g);
    const kg = rs.reduce((a, r) => a + (r.kg || 0), 0);
    const amount = rs.reduce((a, r) => a + (r.amount || 0), 0);
    return rs.length && kg ? { group: g, label: GROUP_LABEL[g], avg: Math.round((amount / kg) * 1000) / 1000, heads: rs.reduce((a, r) => a + (r.heads || 0), 0) } : null;
  }).filter(Boolean);
  const kgAll = rows.reduce((a, r) => a + (r.kg || 0), 0);
  const amountAll = rows.reduce((a, r) => a + (r.amount || 0), 0);
  return {
    dateFrom: hm ? arDateToIso(hm[1]) : null,
    date: hm ? arDateToIso(hm[2]) : null,
    status: hm && hm[3] ? hm[3].replace(/^PRECIOS\s+/i, '').toLowerCase() : null, // "definitivos" / "provisorios"
    rows,
    groups,
    general: kgAll ? { avg: Math.round((amountAll / kgAll) * 1000) / 1000, heads: rows.reduce((a, r) => a + (r.heads || 0), 0) } : null,
    note: 'Precios en pesos por kilo vivo. Promedios por grupo ponderados por kilos (importe total / kilos), calculados con los datos publicados por el Mercado.',
  };
}

export default {
  id: 'mag-canuelas',
  name: 'Mercado Agroganadero de Cañuelas — Precios de hacienda',
  org: 'Mercado Agroganadero S.A.',
  category: 'precios',
  url: URL,
  official: false,
  officialNote: 'Mercado de referencia nacional para hacienda vacuna (no es organismo estatal).',
  access: 'Página pública. Sin API Key.',
  everyMin: 60,
  staleAfterMin: 60 * 24 * 4,
  async run() {
    const html = await getText(URL, { encoding: 'windows-1252', headers: { Accept: 'text/html' } });
    const p = parseCanuelas(html);
    if (!p.rows.length) return { items: 0, message: 'Sin remate publicado en este momento (se conserva el último dato).' };
    for (const g of p.groups) {
      const prev = previousPrice('Hacienda: ' + g.label, 'Cañuelas', p.date);
      g.previous = prev ? { date: prev.date, value: prev.value } : null;
      if (p.status === 'definitivos') savePrice({ product: 'Hacienda: ' + g.label, market: 'Cañuelas', date: p.date, value: g.avg, unit: 'kg vivo', currency: 'ARS', source: 'mag-canuelas' });
    }
    putSnapshot('mag-canuelas', 'ultimo', p, p.date);
    return { items: p.rows.length, message: `Remate del ${p.date} (${p.status || 'estado s/d'})` };
  },
};
