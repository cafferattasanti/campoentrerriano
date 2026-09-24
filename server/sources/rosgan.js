// ROSGAN (Mercado Ganadero de Rosario): precios promedio del último remate mensual por pantalla (invernada y cría).
// De acá sale el precio del TERNERO (Índice Ternero ROSGAN), $/kg vivo. Es MENSUAL: un remate "habitual" por mes.
import { getJson } from '../lib/http.js';
import { putSnapshot } from '../db.js';

export const API_ROSGAN = 'https://api.rosgannet.com.ar/api/db/rosgan/app/public/precios_fede';
export const PAGE_ROSGAN = 'https://www.rosgan.com.ar/';

export function normalizeRosgan(j) {
  const list = [...(j?.data || [])].filter((x) => x && x.fecha_remate).sort((a, b) => b.anio_remate - a.anio_remate || b.mes_remate - a.mes_remate);
  const pack = (x) => x && ({
    date: x.fecha_remate,
    indiceTernero: x.indice_ternero || null,
    invernada: x.piri || null,
    tipos: (x.tipos || []).map((t) => ({
      titulo: t.titulo,
      unidad: /cria|cría/i.test(t.titulo) ? '$ por cabeza' : '$ por kg vivo',
      categorias: (t.categorias || []).filter((c) => c.precio > 0).map((c) => ({ titulo: c.titulo, precio: c.precio, ilustrativo: /ilustrativo/i.test(c.observacion || '') })),
    })).filter((t) => t.categorias.length),
  });
  return { latest: pack(list[0]), previous: pack(list[1]) };
}

export default {
  id: 'rosgan',
  name: 'ROSGAN — Remate mensual de invernada y cría (Índice Ternero)',
  org: 'Mercado Ganadero S.A. (ROSGAN)',
  category: 'precios',
  url: PAGE_ROSGAN,
  official: false,
  officialNote: 'Mercado ganadero de referencia para invernada (no es organismo estatal). Un remate por mes.',
  access: 'Servicio público de datos del sitio de ROSGAN. Sin API Key.',
  everyMin: 60 * 6,
  staleAfterMin: 60 * 24 * 45,
  async run() {
    const r = normalizeRosgan(await getJson(API_ROSGAN));
    if (!r.latest?.indiceTernero) throw new Error('No vino el Índice Ternero (¿cambió el formato?)');
    putSnapshot('rosgan', 'ultimo', r, r.latest.date);
    return { items: 1, message: `Remate del ${r.latest.date}: Índice Ternero ${r.latest.indiceTernero}` };
  },
};
