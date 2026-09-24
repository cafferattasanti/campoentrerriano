// Mercado Agroganadero de Cañuelas — índices diarios publicados por el propio Mercado:
//  - INMAG (Índice Novillo Mercado Agroganadero): referencia de precio del NOVILLO, $/kg vivo.
//  - IGMAG (Índice General Mercado Agroganadero): promedio de toda la hacienda vendida en pie, $/kg vivo.
// Se consultan los últimos 20 días para tener la variación contra el remate anterior.
import { getText } from '../lib/http.js';
import { parseArNumber, arDateToIso } from '../lib/text.js';
import { putSnapshot } from '../db.js';

const BASE = 'https://www.mercadoagroganadero.com.ar/dll/hacienda2.dll/';
export const PAGE_INMAG = BASE + 'haciinfo000011';
export const PAGE_IGMAG = BASE + 'haciinfo000014';

const ddmmyyyy = (d) => d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' });

// Filas: <TD>Ma&nbsp;15/09/2026</TD><TD>6.522</TD><TD>10.969.894.550,00</TD><TD>4.155,888</TD>
export function parseIndice(html) {
  const out = [];
  const re = /<TR[^>]*>\s*<TD[^>]*>\s*[A-Za-zÁÉÍÓÚáéíóú]{2}(?:&nbsp;|\s)+(\d{2}\/\d{2}\/\d{4})\s*<\/TD>\s*<TD[^>]*>([\d.]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>\s*<TD[^>]*>([\d.,]+)<\/TD>/gi;
  let m;
  while ((m = re.exec(html))) {
    const value = parseArNumber(m[4]);
    if (value) out.push({ date: arDateToIso(m[1]), heads: parseArNumber(m[2]), amount: parseArNumber(m[3]), value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchIndice(url, days = 20) {
  const now = new Date();
  const from = new Date(now.getTime() - days * 864e5);
  const body = new URLSearchParams({ ID: '', CP: '', FLASH: '', USUARIO: 'SIN IDENTIFICAR', OPCIONMENU: '', OPCIONSUBMENU: '', txtFechaIni: ddmmyyyy(from), txtFechaFin: ddmmyyyy(now) }).toString();
  const html = await getText(url, { method: 'POST', body, encoding: 'windows-1252', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' } });
  return parseIndice(html);
}

export default {
  id: 'mag-indices',
  name: 'Mercado Agroganadero de Cañuelas — Índices Novillo (INMAG) y General (IGMAG)',
  org: 'Mercado Agroganadero S.A. (Cañuelas)',
  category: 'precios',
  url: PAGE_INMAG,
  official: false,
  officialNote: 'Índices publicados por el Mercado de referencia nacional de hacienda (no es organismo estatal).',
  access: 'Página pública. Sin API Key.',
  everyMin: 30,
  staleAfterMin: 60 * 24 * 5,
  async run({ log }) {
    const [inmag, igmag] = await Promise.all([
      fetchIndice(PAGE_INMAG),
      fetchIndice(PAGE_IGMAG).catch((e) => { log('warn', 'IGMAG: ' + e.message); return []; }),
    ]);
    if (!inmag.length && !igmag.length) throw new Error('No se encontraron índices en los últimos 20 días (¿cambió el formato?)');
    const last = inmag[inmag.length - 1] || igmag[igmag.length - 1];
    putSnapshot('mag-indices', 'ultimos', { inmag, igmag }, last.date);
    return { items: inmag.length + igmag.length, message: `INMAG ${inmag.at(-1)?.value ?? 's/d'} · IGMAG ${igmag.at(-1)?.value ?? 's/d'} (${last.date})` };
  },
};
