// Clasificación y FILTRO de noticias, simple y transparente (palabras clave con límites de palabra).
// Criterio pedido: primero Gualeguay y alrededores, después departamentos de Entre Ríos, después la provincia,
// y lo nacional solo si tiene impacto concreto para el productor entrerriano. Nada de espectáculos, deportes,
// curiosidades ni noticias de otras provincias.
import { normalize } from './text.js';

export const NEWS_CATEGORIES = [
  { id: 'entre-rios', label: 'Entre Ríos' },
  { id: 'clima', label: 'Clima' },
  { id: 'agricultura', label: 'Agricultura' },
  { id: 'ganaderia', label: 'Ganadería' },
  { id: 'precios', label: 'Precios y mercados' },
  { id: 'sanidad', label: 'Sanidad' },
  { id: 'senasa', label: 'SENASA' },
  { id: 'legislacion', label: 'Legislación' },
];

// Zonas (se muestran en la página de Noticias).
export const NEWS_ZONES = [
  { id: 'local', label: 'Gualeguay y zona' },
  { id: 'departamentos', label: 'Departamentos de Entre Ríos' },
  { id: 'provincia', label: 'Entre Ríos' },
  { id: 'nacional', label: 'Nacional con impacto en Entre Ríos' },
];

const rx = (words) => new RegExp('(?:^|[^a-z0-9])(?:' + words.join('|') + ')', 'i');

const RULES = {
  'entre-rios': rx(['entre rios', 'entrerrian', 'gualeguay', 'concepcion del uruguay', 'villaguay', 'nogoya', 'chajari', 'crespo', 'bolsacer', 'feliciano', 'ibicuy', 'rosario del tala', 'basavilbaso', 'urdinarrain', 'larroque']),
  clima: rx(['clima', 'lluvias?\\b', 'sequia', 'heladas?\\b', 'tormentas?\\b', 'granizo', 'pronostico', 'smn\\b', 'meteorolog', 'inundac', 'el nino', 'la nina', 'precipitacion', 'ola de calor']),
  agricultura: rx(['soja', 'maiz', 'trigo', 'girasol', 'arroz', 'sorgo', 'cebada', 'siembra', 'sembr', 'cosech', 'cultivos?\\b', 'agricol', 'granos?\\b', 'fertiliz', 'semillas?\\b', 'rindes?\\b', 'citric', 'arandano', 'forestal']),
  ganaderia: rx(['hacienda', 'novill', 'terneros?\\b', 'terneras?\\b', 'vacas?\\b', 'vacuno', 'bovin', 'ganad', 'carne vacuna', 'frigorific', 'tambos?\\b', 'lecher', 'feedlot', 'cerdos?\\b', 'porcin', 'avicol', 'ovin', 'invernada', 'faena', 'abigeato', 'apicult']),
  precios: rx(['precios? de (?:la |los )?(?:hacienda|granos|soja|maiz|trigo|carne|leche)', 'cotiza', 'retenciones', 'derechos de exportacion', 'chicago', 'matba', 'rofex', 'pizarra', 'canuelas', 'remates?\\b']),
  sanidad: rx(['sanidad', 'sanitari', 'vacunacion', 'plagas?\\b', 'brotes?\\b', 'influenza aviar', 'gripe aviar', 'aftosa', 'garrapata', 'brucelosis', 'tuberculosis bovina', 'fitosanit', 'chicharrita', 'hlb\\b', 'langosta', 'roya', 'fusariosis']),
  senasa: rx(['senasa']),
  legislacion: rx(['ley\\b', 'resolucion', 'decreto', 'boletin oficial', 'normativa', 'legislatura']),
};

// Palabras que hacen que una nota sea "del campo" (hace falta al menos una para fuentes generales).
const AGRO = rx([
  'soja', 'maiz', 'trigo', 'girasol', 'arroz', 'sorgo', 'cebada', 'lino\\b', 'siembra', 'sembr', 'cosech', 'cultivos?\\b', 'agricol', 'agropecuari', 'agro\\b', 'agroindustr', 'granos?\\b', 'fertiliz', 'semillas?\\b', 'rindes?\\b',
  'hacienda', 'novill', 'terneros?\\b', 'terneras?\\b', 'vacas?\\b', 'vacuno', 'bovin', 'ganad', 'carne vacuna', 'frigorific', 'tambos?\\b', 'lecher', 'feedlot', 'porcin', 'avicol', 'ovin', 'apicult', 'forraj', 'pasturas?\\b', 'faena', 'abigeato',
  'productores? (?:rurales|agropecuarios|ganaderos|agricolas|arroceros|apicolas|tamberos|avicolas)', 'productores? del campo', 'sector agropecuario', 'caminos? rural', 'calzadas?\\b', 'enripiad', 'ripio', 'terraplen', 'alcantarill', 'desague', 'canales? de (?:riego|drenaje|desague)',
  'sequia', 'inundac', 'granizo', 'heladas?\\b', 'emergencia agropecuaria', 'emergencia hidrica', 'retenciones', 'derechos de exportacion',
  'forestal', 'citric', 'arandano', 'plagas?\\b', 'chicharrita', 'langosta', 'aftosa', 'brucelosis', 'influenza aviar', 'gripe aviar', 'riego', 'acopio', 'feria ganadera', 'remate ganadero', 'sociedad rural', 'federacion agraria',
]);
// Obras de canales en la zona (ej. limpieza del Canal de Mihura en Gualeguay).
const CANAL_OBRA = /(?:^|[^a-z])canal(?:es)? de [a-z]+/;
const OBRA = /(?:limpieza|ensanche|desague|obra|drenaje)/;

// Lo nacional solo entra con impacto concreto para el productor.
const NATIONAL_IMPACT = rx(['retenciones', 'derechos de exportacion', 'emergencia agropecuaria', 'aftosa', 'influenza aviar', 'gripe aviar', 'chicharrita', 'precios? de (?:la |los )?(?:hacienda|granos|soja|maiz|trigo|novillo|ternero)', 'mercado de (?:hacienda|granos|canuelas|liniers)', 'exportaciones? de (?:carne|granos|soja|maiz|trigo)', 'cuota hilton', 'senasa (?:dispuso|establecio|resolvio|informo)', 'vacunacion antiaftosa', 'campana (?:agricola|fina|gruesa|de soja|de trigo|de maiz)', 'siembra de (?:trigo|soja|maiz|girasol|arroz)', 'cosecha de (?:trigo|soja|maiz|girasol|arroz)', 'bolsa de comercio de rosario', 'bolsa de cereales']);

// Nunca: espectáculos, deportes, curiosidades, policiales generales, horóscopo, juegos de azar, recetas.
const EXCLUDE = rx(['horoscopo', 'loteria', 'quiniela', 'quini ?6', 'receta', 'futbol', 'deportiv', 'torneo', 'campeonato', 'rugby', 'basquet', 'voley', 'hockey', 'boxeo', 'tenis', 'espectaculo', 'farandula', 'famos', 'actriz', 'cantante', 'reality', 'gran hermano', 'dolar blue', 'dolar hoy', 'dolar mep', 'euro blue', 'asi estara el (?:clima|tiempo)', 'como estara el (?:clima|tiempo)']);
const EXCLUDE_SECTIONS = /\/(?:deportes|espectaculos[^/]*|policiales|horoscopo|tecnologia|mundo|internacionales)\//i;

const OTHER_PROVINCES = rx(['santa fe', 'santafesin', 'cordoba', 'cordobes', 'la pampa', 'pampeano', 'chaco', 'chaquen', 'salta', 'tucuman', 'mendoza', 'corrientes', 'correntin', 'misiones', 'rio negro', 'neuquen', 'chubut', 'santiago del estero', 'jujuy', 'formosa', 'catamarca', 'la rioja', 'san juan', 'san luis', 'santa cruz', 'tierra del fuego', 'bonaerense', 'provincia de buenos aires']);

export function classify(title, summary = '', sourceDefaults = []) {
  const t = ' ' + normalize(`${title} ${summary}`) + ' ';
  const cats = new Set(sourceDefaults);
  for (const [cat, re] of Object.entries(RULES)) if (re.test(t)) cats.add(cat);
  if (cats.has('senasa')) cats.add('sanidad');
  return [...cats];
}

export function isExcluded(title, url = '') {
  return EXCLUDE.test(' ' + normalize(title)) || EXCLUDE_SECTIONS.test(url || '');
}

export function isAgroRelevant(cats) {
  return cats.some((c) => ['clima', 'agricultura', 'ganaderia', 'precios', 'sanidad', 'senasa'].includes(c));
}

// Zona geográfica de una nota. region: { newsLocal, departments }
export function geoZone(text, region) {
  const t = ' ' + normalize(text) + ' ';
  const has = (w) => new RegExp('(?:^|[^a-z])' + normalize(w) + '(?:[^a-z]|$)').test(t);
  if ((region?.newsLocal || []).some(has)) return 'local';
  // Nombres de departamentos ambiguos (Paraná, Victoria, Colón, La Paz, Federal, Uruguay) solo cuentan con "departamento".
  const AMBIG = ['parana', 'victoria', 'colon', 'la paz', 'federal', 'uruguay', 'tala', 'diamante', 'concordia', 'federacion', 'san salvador'];
  for (const d of region?.departments || []) {
    const n = normalize(d);
    if (AMBIG.includes(n)) { if (new RegExp('(?:departamentos?|dpto\\.?) ' + n).test(t)) return 'departamentos'; }
    else if (has(n)) return 'departamentos';
  }
  if (/(?:^|[^a-z])(?:concordia|concepcion del uruguay|villaguay|nogoya|chajari|crespo|viale|san jose de feliciano|federal|basavilbaso|urdinarrain|maciá|macia|lucas gonzalez|hernandarias|santa elena)(?:[^a-z]|$)/.test(t) && /entre rios|entrerrian|departamento|provincia/.test(t)) return 'departamentos';
  if (/entre rios|entrerrian|bolsacer/.test(t)) return 'provincia';
  return 'nacional';
}

// ¿Se muestra? Devuelve { ok, zone, reason }.
// source: { id, local (diario/gobierno de ER), agro (medio especializado u organismo del agro) }
export function relevance(item, source, region) {
  const text = `${item.title} ${item.summary || ''}`;
  const t = ' ' + normalize(text) + ' ';
  if (isExcluded(item.title, item.url)) return { ok: false, reason: 'excluida (tema no rural)' };
  let zone = geoZone(text, region);
  // Fuentes entrerrianas: si el texto no nombra un lugar, la zona es la de la fuente
  // (El Debate Pregón "locales" = Gualeguay; Gobierno de Entre Ríos y Bolsa de Cereales de ER = provincia).
  if (zone === 'nacional' && source?.zoneFor) zone = source.zoneFor(item) || zone;
  const agro = AGRO.test(t) || (zone === 'local' && CANAL_OBRA.test(t) && OBRA.test(t));
  if (!agro) return { ok: false, zone, reason: 'sin relación con el campo' };
  if (zone === 'nacional') {
    if (OTHER_PROVINCES.test(t)) return { ok: false, zone, reason: 'otra provincia' };
    if (!NATIONAL_IMPACT.test(t)) return { ok: false, zone, reason: 'nacional sin impacto concreto' };
  }
  return { ok: true, zone };
}

// Clave para detectar la misma noticia publicada por dos fuentes.
export function dedupeKey(title) {
  return normalize(title).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 7).sort().join(' ');
}
