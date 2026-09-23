// Clasificación simple y transparente de noticias por palabras clave.
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

const RULES = {
  // Se evitan nombres ambiguos (Paraná, Victoria, Colón, La Paz) para no etiquetar mal noticias de otras zonas.
  'entre-rios': ['entre rios', 'entrerrian', 'gualeguay', 'concepcion del uruguay', 'villaguay', 'nogoya', 'chajari', 'crespo', 'bolsacer', 'feliciano', 'islas del ibicuy', 'rosario del tala', 'basavilbaso', 'urdinarrain', 'larroque'],
  clima: ['clima', 'lluvia', 'lluvias', 'sequia', 'helada', 'tormenta', 'granizo', 'pronostico', 'smn', 'meteorolog', 'temperatura', 'inundacion', 'el nino', 'la nina', 'precipitacion', 'humedad del suelo', 'ola de calor'],
  agricultura: ['soja', 'maiz', 'trigo', 'girasol', 'arroz', 'sorgo', 'cebada', 'siembra', 'cosecha', 'cultivo', 'agricol', 'granos', 'fertiliz', 'semilla', 'rinde', 'campana agricola', 'citric', 'arandano', 'forestal'],
  ganaderia: ['hacienda', 'novillo', 'ternero', 'vaca', 'bovino', 'ganader', 'carne', 'tambo', 'lecher', 'feedlot', 'cerdo', 'porcin', 'avicol', 'pollo', 'ovino', 'caprino', 'equino', 'rodeo', 'invernada', 'cria'],
  precios: ['precio', 'cotiza', 'mercado', 'exportac', 'importac', 'retenciones', 'derechos de exportacion', 'chicago', 'matba', 'rofex', 'pizarra', 'canuelas', 'liniers', 'remate', 'valor'],
  sanidad: ['sanidad', 'sanitari', 'vacun', 'enfermedad', 'plaga', 'brote', 'influenza', 'aftosa', 'garrapata', 'brucelosis', 'tuberculosis', 'fitosanit', 'chicharrita', 'hlb', 'triquinosis', 'encefalomielitis', 'carbunclo', 'zoonosis', 'bioseguridad', 'roya', 'fusariosis'],
  senasa: ['senasa'],
  legislacion: ['ley ', 'resolucion', 'decreto', 'boletin oficial', 'normativa', 'reglament', 'disposicion', 'legislatura', 'proyecto de ley'],
};

// Noticias que no aportan al productor (se descartan de fuentes generales).
const EXCLUDE = ['dolar blue', 'euro blue', 'dolar hoy', 'dolar mep', 'horoscopo', 'loteria', 'quiniela', 'receta de', 'futbol'];

export function classify(title, summary = '', sourceDefaults = []) {
  const t = ' ' + normalize(`${title} ${summary}`) + ' ';
  const cats = new Set(sourceDefaults);
  for (const [cat, words] of Object.entries(RULES)) {
    if (words.some((w) => t.includes(w))) cats.add(cat);
  }
  if (cats.has('senasa')) cats.add('sanidad');
  return [...cats];
}

export function isExcluded(title) {
  const t = normalize(title);
  return EXCLUDE.some((w) => t.includes(w));
}

export function isAgroRelevant(cats) {
  return cats.some((c) => ['clima', 'agricultura', 'ganaderia', 'precios', 'sanidad', 'senasa'].includes(c));
}
