// Precios pizarra de la Cámara Arbitral de Cereales de la Bolsa de Comercio de Rosario.
// Referencia principal de granos para el productor entrerriano (no hay pizarra oficial en Entre Ríos).
import { getText } from '../lib/http.js';
import { stripTags, parseArNumber, arDateToIso, spanishLongDateToIso } from '../lib/text.js';
import { putSnapshot, savePrice, previousPrice } from '../db.js';

const URL = 'https://www.cac.bcr.com.ar/es/precios-de-pizarra';

export function parsePizarra(html) {
  const dateM = html.match(/Precios Pizarra del d[ií]a\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const date = dateM ? arDateToIso(dateM[1]) : null;
  const boards = [];
  const re = /<div class="board board-([a-z]+)[^"]*">([\s\S]*?)(?=<div class="board board-|<div class="price-board-footer")/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[2];
    const name = stripTags((block.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || m[1]);
    const priceHtml = (block.match(/<div class="price">([\s\S]*?)<\/div>/) || [])[1] || '';
    const priceTxt = stripTags(priceHtml);
    const sinCotizacion = /S\/C/i.test(priceTxt);
    const estimated = /\(E\)/.test(priceTxt);
    const numM = priceTxt.match(/\$\s*([\d.]+,\d+)/);
    const usdTxt = stripTags((block.match(/<strong>US\$<\/strong>([\s\S]*?)<\/div>/) || [])[1] || '');
    const usdM = usdTxt.match(/([\d.]+,\d+)/);
    const dir = /fa-arrow-up/.test(block) ? 'sube' : /fa-arrow-down/.test(block) ? 'baja' : /direction nofont">=/.test(block) ? 'igual' : null;
    boards.push({
      key: m[1],
      product: name,
      value: numM ? parseArNumber(numM[1]) : null,
      usd: usdM ? parseArNumber(usdM[1]) : null,
      sinCotizacion,
      estimated,
      direction: dir,
    });
  }
  const tcM = html.match(/TC BNA Divisas<\/strong>\s*Comprador\s*(\d{1,2}\/\d{1,2}\/\d{4}):\s*<strong>\$\s*([\d.,]+)/i);
  const pubM = stripTags(html).match(/Rosario,\s*(\d{1,2} de [A-Za-zé]+ del? \d{4})\s*-\s*Hora:\s*(\d{1,2}:\d{2})/i);
  return {
    date,
    boards,
    tcBna: tcM ? { date: arDateToIso(tcM[1]), value: parseArNumber(tcM[2]) } : null,
    publishedAt: pubM ? `${spanishLongDateToIso(pubM[1])}T${pubM[2].padStart(5, '0')}:00-03:00` : null,
    note: 'Precios corrientes en $/t, mercadería entrega inmediata, pago contado, puesta sobre camión/vagón en zona Rosario. La conversión a dólares es informativa (dólar BNA divisa comprador).',
  };
}

export default {
  id: 'bcr-pizarra',
  name: 'Cámara Arbitral de Cereales (Bolsa de Comercio de Rosario) — Precios pizarra',
  org: 'Bolsa de Comercio de Rosario',
  category: 'precios',
  url: URL,
  official: false,
  officialNote: 'Institución profesional de referencia nacional (no es organismo estatal).',
  access: 'Página pública. Sin API Key.',
  everyMin: 60,
  staleAfterMin: 60 * 30,
  async run() {
    const html = await getText(URL, { headers: { Accept: 'text/html' } });
    const p = parsePizarra(html);
    if (!p.date || !p.boards.length) throw new Error('No se pudo leer la pizarra (¿cambió el formato de la página?)');
    for (const b of p.boards) {
      const prev = previousPrice(b.product, 'Rosario', p.date);
      b.previous = prev ? { date: prev.date, value: prev.value } : null;
      if (b.value !== null && !b.estimated && !b.sinCotizacion) savePrice({ product: b.product, market: 'Rosario', date: p.date, value: b.value, unit: 't', currency: 'ARS', source: 'bcr-pizarra' });
    }
    putSnapshot('bcr-pizarra', 'rosario', p, p.date);
    return { items: p.boards.length, message: `Pizarra del ${p.date}` };
  },
};
