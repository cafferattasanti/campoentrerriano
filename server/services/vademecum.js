// Buscador de medicamentos veterinarios sobre el Registro Oficial de Productos Veterinarios del SENASA (Vademécum).
// Consulta EN VIVO el servicio público que usa la propia página del SENASA (sin clave) y guarda caché
// para no repetir consultas. No se inventa ni se completa ningún dato: solo se muestra lo que figura en el registro.
//
// Decisión deliberada: NO se muestran dosis. Las dosis dependen del animal, del diagnóstico y del
// prospecto aprobado; deben indicarlas un veterinario y el prospecto oficial.
import { getJson } from '../lib/http.js';
import { normalize } from '../lib/text.js';
import { cacheGet, cacheSet, cacheGetStale } from '../db.js';

const API = 'https://aps2.senasa.gov.ar/adt_api/api';
const TP = encodeURIComponent('https://aps2.senasa.gov.ar/adt_api/api/tiposProductos/5');
export const VADEMECUM_URL = 'https://aps2.senasa.gov.ar/vademecumVet/app/publico/farmacos';
const DAY = 864e5;

async function cached(key, ttl, fn) {
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const v = await fn();
    cacheSet(key, v, ttl);
    return v;
  } catch (e) {
    const stale = cacheGetStale(key);
    if (stale) return stale;
    throw e;
  }
}

// Listas de referencia oficiales (principios activos e indicaciones), refrescadas semanalmente.
export async function principiosActivos() {
  return cached('vad:componentes', 7 * DAY, async () => {
    const url = `${API}/componentes/search/publicSearchListByTipoAndTipoProducto?tipoComponente=${encodeURIComponent(API + '/tiposComponentes/10')}&tipoProducto=${TP}&projection=componenteProjection&sort=nombre%2Casc`;
    const j = await getJson(url);
    return (j._embedded?.componentes || []).filter((c) => c.activo !== false).map((c) => ({ id: c.id, nombre: c.nombre }));
  });
}
export async function indicaciones() {
  return cached('vad:indicaciones', 7 * DAY, async () => {
    const j = await getJson(`${API}/enfermedades/search/publicSearchByTipoProducto?tipoProducto=${TP}`);
    return (j._embedded?.enfermedades || []).map((e) => ({ id: e.id, nombre: e.nombre.trim() }));
  });
}

async function listBy(params) {
  const qs = new URLSearchParams({ page: '0', size: '25', projection: 'productoFarmacoLiteProjection', ...params });
  const j = await getJson(`${API}/productosFarmacos/search/publicSearchProductoFarmacoDTO?${qs}`);
  return { items: j._embedded?.productosFarmacos || [], total: j.page?.totalElements ?? 0 };
}
async function listByName(q) {
  const qs = new URLSearchParams({ search: q, page: '0', size: '25' });
  const j = await getJson(`${API}/productosFarmacos/search/publicSearchProductoFarmacoDTOByString?${qs}`);
  return { items: j._embedded?.productosFarmacos || [], total: j.page?.totalElements ?? 0 };
}

export function normalizeDetail(j, lite = {}) {
  const firma = (j.productosFirmas || [])[0] || {};
  const prod = j.productoEspecieCategoria?.[0]?.producto || {};
  const principios = (j.componentesPorProducto || [])
    .filter((c) => c.componente?.tipoComponente?.id === 10)
    .map((c) => ({
      nombre: c.componente.nombre,
      cantidad: c.cantidadCompleja ?? c.cantidad ?? null,
      unidad: c.unidadMedida?.siglaEstandarizada || c.unidadMedida?.descripcion || null,
    }));
  const especies = (j.productoEspecieCategoria || []).map((e) => ({
    especie: e.especie?.descripcion || null,
    categoria: e.categoriaUso?.descripcion && e.categoriaUso.descripcion !== e.especie?.descripcion ? e.categoriaUso.descripcion : null,
    retiro: e.tiempoPrefaena || null,
  }));
  return {
    id: j.id ?? lite.id,
    certificado: j.numeroInscripcion || lite.numeroInscripcion || null,
    nombre: firma.nombreComercial || lite.nombreComercial || null,
    empresa: firma.firma?.nombre || lite.nombreFirma || null,
    estado: j.estadoProducto?.descripcion || firma.estadoProducto?.descripcion || null,
    revisionSenasa: firma.estadoRevision?.descripcion || null,
    tipoRegistro: j.tipoRegistro?.descripcion || null,
    presentacion: j.tipoPresentacion?.descripcion || null,
    principios,
    especies,
    vias: (j.productosFarmacoViaPorProducto || []).map((v) => v.farmacoVia?.viaAdministracion).filter(Boolean),
    indicacionesCategorias: (j.enfermedadesProductoFarmaco || []).map((e) => e.enfermedad?.nombre?.trim()).filter(Boolean),
    indicaciones: j.indicacionesYVias || null,
    observaciones: j.observaciones || null,
    restricciones: {
      leche: j.restriccionPreordenie || null,
      huevos: j.restriccionHuevos || null,
      miel: j.restriccionMiel || null,
    },
    prospectos: (j.productoDocumentos || []).filter((d) => d.activo && !d.esPrivado).map((d) => d.nombre),
    fechaValidez: j.fechaValidez || null,
    ultimaModificacion: prod.fechaUltimaModificacion || null,
    fuente: 'SENASA — Registro de Productos Veterinarios (Vademécum oficial)',
    fuenteUrl: VADEMECUM_URL,
  };
}

async function detail(lite) {
  return cached(`vad:det:${lite.id}`, 7 * DAY, async () => {
    const self = encodeURIComponent(`${API}/productosFarmacos/${lite.id}`);
    const j = await getJson(`${API}/productosFarmacos/search/publicSearchProducto?producto=${self}&projection=productoFarmacoDetallePublicoProjection`);
    return normalizeDetail(j, lite);
  });
}

const ESPECIES_ALIAS = {
  bovinos: ['BOVINOS', 'BOVINOS LECHEROS', 'BOVINO', 'BUBALINO', 'BOVINOS (BÚFALOS)'],
  equinos: ['EQUINOS'],
  porcinos: ['PORCINOS'],
  ovinos: ['OVINOS'],
  caprinos: ['CAPRINOS'],
  aves: ['AVES', 'AVES PARA CONSUMO HUMANO (POLLOS Y GALLINAS)', 'AVES PARA CONSUMO HUMANO (GALLINAS)', 'AVES PARA CONSUMO HUMANO (PAVOS)', 'AVES PARA CONSUMO HUMANO (OTROS)', 'AVES PARA CONSUMO HUMANO (PATOS, GANSOS Y OTROS)', 'AVES PARA CONSUMO HUMANO (CODORNICES)'],
};

export async function searchMedicamentos({ q = '', especie = '', limit = 12 }) {
  const query = String(q).trim().slice(0, 60);
  const nq = normalize(query);
  if (nq.length < 3) return { query, results: [], total: 0, matched: {}, note: 'Escribí al menos 3 letras.' };

  return cached(`vad:q:${nq}|${especie}`, DAY, async () => {
    const [comps, inds] = await Promise.all([principiosActivos().catch(() => []), indicaciones().catch(() => [])]);
    const compMatch = comps.filter((c) => normalize(c.nombre).includes(nq)).slice(0, 15);
    const indMatch = inds.filter((i) => normalize(i.nombre).includes(nq)).slice(0, 5);

    const tasks = [listByName(query)];
    if (compMatch.length) tasks.push(listBy({ idComponentes: compMatch.map((c) => c.id).join(',') }));
    if (indMatch.length) tasks.push(listBy({ idIndicaciones: indMatch.map((i) => i.id).join(',') }));
    let failed = 0;
    let lastErr = null;
    const lists = await Promise.all(tasks.map((t) => t.catch((e) => { failed++; lastErr = e; return { items: [], total: 0 }; })));
    // Si el registro del SENASA no respondió, se informa el error: nunca se muestra "sin resultados" por una falla.
    if (failed === tasks.length) throw lastErr || new Error('El registro del SENASA no respondió');

    const seen = new Map();
    for (const l of lists) for (const it of l.items) if (!seen.has(it.id)) seen.set(it.id, it);
    const total = Math.max(...lists.map((l) => l.total), seen.size);

    // Detalle de los primeros resultados (con pausa para no saturar el servicio del SENASA).
    const candidates = [...seen.values()].slice(0, especie ? 25 : limit + 4);
    const details = [];
    let detailErrors = 0;
    for (const lite of candidates) {
      try { details.push(await detail(lite)); } catch { detailErrors++; /* se omite un producto si su ficha no responde */ }
      if (details.length >= (especie ? 25 : limit)) break;
    }
    if (candidates.length && !details.length) throw new Error('No se pudieron leer las fichas del registro del SENASA');
    let results = details;
    if (especie && ESPECIES_ALIAS[especie]) {
      const allowed = new Set(ESPECIES_ALIAS[especie].map(normalize));
      results = details.filter((d) => d.especies.some((e) => allowed.has(normalize(e.especie || ''))));
    }
    // Primero productos activos y corroborados por SENASA.
    results.sort((a, b) => (b.estado === 'ACTIVO') - (a.estado === 'ACTIVO') || (b.revisionSenasa === 'CORROBORADO') - (a.revisionSenasa === 'CORROBORADO'));
    return {
      query,
      total,
      results: results.slice(0, limit),
      matched: { principiosActivos: compMatch.map((c) => c.nombre), indicaciones: indMatch.map((i) => i.nombre) },
      consultedAt: new Date().toISOString(),
      incomplete: detailErrors > 0,
    };
  });
}
