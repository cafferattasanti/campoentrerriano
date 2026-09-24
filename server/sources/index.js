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
import magIndices from './mag-indices.js';
import rosgan from './rosgan.js';
import dolar from './dolar.js';
import prefecturaRios from './prefectura-rios.js';

// Para agregar una fuente nueva: crear un módulo con { id, name, category, everyMin, run() } y sumarlo acá.
export const SOURCES = [smnCap, smnAlertas, smnPronostico, smnDatosAbiertos, openMeteo, magIndices, magCanuelas, rosgan, bcrPizarra, magypArroz, dolar, prefecturaRios, senasaEpidemiologia, noticias];

export function getSource(id) {
  return SOURCES.find((s) => s.id === id) || null;
}
