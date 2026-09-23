import smnPronostico from './smn-pronostico.js';
import smnAlertas from './smn-alertas.js';
import smnCap from './smn-cap.js';
import smnDatosAbiertos from './smn-datos-abiertos.js';
import openMeteo from './open-meteo.js';
import bcrPizarra from './bcr-pizarra.js';
import magCanuelas from './mag-canuelas.js';
import magypArroz from './magyp-arroz.js';
import noticias from './noticias.js';
import senasaEpidemiologia from './senasa-epidemiologia.js';

// Para agregar una fuente nueva: crear un módulo con { id, name, category, everyMin, run() } y sumarlo acá.
export const SOURCES = [smnCap, smnAlertas, smnPronostico, smnDatosAbiertos, openMeteo, bcrPizarra, magCanuelas, magypArroz, senasaEpidemiologia, noticias];

export function getSource(id) {
  return SOURCES.find((s) => s.id === id) || null;
}
