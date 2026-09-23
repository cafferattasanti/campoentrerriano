// Utilidades de texto, números y fechas en formato argentino.
import { inflateRawSync } from 'node:zlib';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', ndash: '–', mdash: '—', ordm: 'º', deg: '°' };

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));
}

export function stripTags(html = '') {
  return decodeEntities(String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s = '', n = 280) {
  s = String(s).trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[,;:.\s]+$/, '') + '…';
}

// "346.150,00" -> 346150 ; "4390,050" -> 4390.05
export function parseArNumber(s) {
  if (s === null || s === undefined) return null;
  const clean = String(s).replace(/[^\d.,-]/g, '');
  if (!clean) return null;
  const n = Number(clean.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// dd/mm/yyyy -> yyyy-mm-dd
export function arDateToIso(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// "7 de mayo de 2026" -> 2026-05-07
export function spanishLongDateToIso(s) {
  const m = String(s || '').toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de|del)\s+(\d{4})/);
  if (!m) return null;
  const mi = MESES.indexOf(m[2].replace('setiembre', 'septiembre'));
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function normalize(s = '') {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Descompresor ZIP mínimo (solo "stored" y "deflate"), suficiente para los datos abiertos del SMN.
export function unzip(buf) {
  const files = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const flags = buf.readUInt16LE(p + 6);
    const method = buf.readUInt16LE(p + 8);
    let csize = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26);
    const elen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString('utf8');
    const start = p + 30 + nlen + elen;
    if (flags & 0x08 && csize === 0) throw new Error('ZIP con descriptor de datos no soportado');
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : method === 0 ? raw : null;
    if (!data) throw new Error(`Método de compresión ZIP ${method} no soportado`);
    files.push({ name, data });
    p = start + csize;
  }
  return files;
}
