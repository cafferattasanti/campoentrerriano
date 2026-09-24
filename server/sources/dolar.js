// Dólar: cotización oficial del Banco Nación (billete, la que se usa en ventanilla) y, como respaldo y para
// las demás referencias, DolarApi.com (servicio público que recopila cotizaciones; el "blue" es un valor INFORMAL).
import { getText, getJson } from '../lib/http.js';
import { parseArNumber, arDateToIso } from '../lib/text.js';
import { putSnapshot } from '../db.js';

export const BNA_URL = 'https://www.bna.com.ar/Personas';
export const DOLARAPI_URL = 'https://dolarapi.com/v1/dolares';

// Tabla "billetes" del BNA: fecha, Dolar U.S.A compra/venta y "Hora Actualización".
export function parseBna(html) {
  const i = html.indexOf('id="billetes"');
  if (i < 0) return null;
  const j = html.indexOf('id="divisas"', i);
  const block = html.slice(i, j > 0 ? j : i + 4000);
  const fecha = (block.match(/class="fechaCot">\s*(\d{1,2}\/\d{1,2}\/\d{4})/) || [])[1];
  const row = block.match(/Dolar U\.S\.A<\/td>\s*<td>([\d.,]+)<\/td>\s*<td>([\d.,]+)<\/td>/i);
  const hora = (block.match(/Hora Actualizaci[oó]n:\s*(\d{1,2}:\d{2})/i) || [])[1] || null;
  if (!row || !fecha) return null;
  const date = arDateToIso(fecha);
  return { compra: parseArNumber(row[1]), venta: parseArNumber(row[2]), date, time: hora, at: hora ? `${date}T${hora.padStart(5, '0')}:00-03:00` : null };
}

export function normalizeDolarApi(arr) {
  const by = Object.fromEntries((Array.isArray(arr) ? arr : []).map((d) => [d.casa, d]));
  const pick = (k) => by[k] && by[k].venta ? { compra: by[k].compra ?? null, venta: by[k].venta, at: by[k].fechaActualizacion || null } : null;
  return { oficial: pick('oficial'), blue: pick('blue'), mayorista: pick('mayorista') };
}

export default {
  id: 'dolar',
  name: 'Dólar — Banco Nación (oficial) y DolarApi (mayorista y blue)',
  org: 'Banco de la Nación Argentina · DolarApi.com',
  category: 'precios',
  url: BNA_URL,
  official: true,
  officialNote: 'El oficial sale del Banco Nación. Mayorista y blue salen de DolarApi.com (el blue es un mercado informal).',
  access: 'Páginas y servicios públicos. Sin API Key.',
  everyMin: 30,
  staleAfterMin: 60 * 24 * 3,
  async run({ log }) {
    const [bna, api] = await Promise.all([
      getText(BNA_URL, { headers: { Accept: 'text/html' } }).then(parseBna).catch((e) => { log('warn', 'Banco Nación: ' + e.message); return null; }),
      getJson(DOLARAPI_URL).then(normalizeDolarApi).catch((e) => { log('warn', 'DolarApi: ' + e.message); return null; }),
    ]);
    if (!bna && !api) throw new Error('No respondió ni el Banco Nación ni DolarApi');
    const oficial = bna ? { ...bna, fuente: 'Banco de la Nación Argentina (billete)', url: BNA_URL }
      : api?.oficial ? { ...api.oficial, fuente: 'DolarApi.com (oficial, respaldo: el Banco Nación no respondió)', url: 'https://dolarapi.com' } : null;
    const data = {
      oficial,
      mayorista: api?.mayorista ? { ...api.mayorista, fuente: 'DolarApi.com (mayorista, referencia BCRA)', url: 'https://dolarapi.com' } : null,
      blue: api?.blue ? { ...api.blue, fuente: 'DolarApi.com (blue: mercado informal)', url: 'https://dolarapi.com' } : null,
    };
    putSnapshot('dolar', 'ultimo', data, oficial?.date || null);
    return { items: [data.oficial, data.mayorista, data.blue].filter(Boolean).length, message: `Oficial BNA ${oficial?.venta ?? 's/d'}` };
  },
};
