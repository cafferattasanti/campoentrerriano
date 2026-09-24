// Mercado Agroganadero de Cañuelas (ex Liniers): precios de hacienda por categoría, $/kg vivo.
import { getText } from '../lib/http.js';
import { stripTags, parseArNumber, arDateToIso } from '../lib/text.js';
import { putSnapshot, getSnapshot, savePrice, previousPrice } from '../db.js';

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

// Planilla de un día puntual (yyyy-mm-dd), con el mismo formulario que usa el sitio del Mercado.
async function fetchDay(d) {
  const ar = d.split('-').reverse().join('/');
  const body = new URLSearchParams({ ID: '', CP: '', FLASH: '', USUARIO: 'SIN IDENTIFICAR', txtFechaIni: ar, txtFechaFin: ar }).toString();
  const h = await getText(URL, { method: 'POST', body, encoding: 'windows-1252', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' } });
  return parseCanuelas(h);
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
  async run({ log } = {}) {
    const html = await getText(URL, { encoding: 'windows-1252', headers: { Accept: 'text/html' } });
    let p = parseCanuelas(html);
    const idx = getSnapshot('mag-indices', 'ultimos')?.data;
    const knownDates = [...new Set([...(idx?.inmag || []), ...(idx?.igmag || [])].map((x) => x.date))].sort();
    // Fuera del horario de remate la planilla del día viene vacía: se pide la del último remate conocido.
    if (!p.rows.length && knownDates.length) {
      try { p = await fetchDay(knownDates[knownDates.length - 1]); } catch (e) { log?.('warn', 'No se pudo leer el último remate: ' + e.message); }
    }
    if (!p.rows.length) return { items: 0, message: 'Sin remate publicado en este momento (se conserva el último dato).' };
    // Remate anterior (para la variación): se consulta la misma planilla del Mercado para esa fecha.
    let prev = getSnapshot('mag-canuelas', 'anterior')?.data || null;
    if (!prev || !(prev.date < p.date) || prev.forDate !== p.date) {
      prev = null;
      try {
        const known = knownDates.filter((d) => d < p.date);
        const candidates = known.length ? [known[known.length - 1]] : [];
        for (let i = 1; i <= 7 && candidates.length < 8; i++) {
          const d = new Date(Date.parse(p.date + 'T12:00:00-03:00') - i * 864e5).toISOString().slice(0, 10);
          if (!candidates.includes(d)) candidates.push(d);
        }
        for (const d of candidates) {
          const q = await fetchDay(d);
          if (q.rows.length && q.date && q.date < p.date) { prev = { date: q.date, groups: q.groups, general: q.general, forDate: p.date }; break; }
        }
        if (prev) putSnapshot('mag-canuelas', 'anterior', prev, prev.date);
      } catch (e) {
        log?.('warn', 'No se pudo leer el remate anterior: ' + e.message);
      }
    }
    for (const g of p.groups) {
      const pg = prev?.groups?.find((x) => x.group === g.group);
      const ph = pg ? null : previousPrice('Hacienda: ' + g.label, 'Cañuelas', p.date);
      g.previous = pg ? { date: prev.date, value: pg.avg } : ph ? { date: ph.date, value: ph.value } : null;
      if (p.status === 'definitivos') savePrice({ product: 'Hacienda: ' + g.label, market: 'Cañuelas', date: p.date, value: g.avg, unit: 'kg vivo', currency: 'ARS', source: 'mag-canuelas' });
    }
    putSnapshot('mag-canuelas', 'ultimo', p, p.date);
    return { items: p.rows.length, message: `Remate del ${p.date} (${p.status || 'estado s/d'})${prev ? ', anterior ' + prev.date : ''}` };
  },
};
