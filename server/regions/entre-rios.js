// Región: Entre Ríos.
// "smnArea": zona de alerta del SMN verificada (las demás se resuelven solas).
// Los "smnId" y coordenadas fueron verificados contra el georreferenciador del SMN (23/09/2026).
// Para sumar otra provincia: copiar este archivo (ej. santa-fe.js), completar localidades y registrarla en regions/index.js.

export default {
  id: 'entre-rios',
  name: 'Entre Ríos',
  defaultLocality: 'parana',
  departments: [
    'Colón', 'Concordia', 'Diamante', 'Federación', 'Federal', 'Feliciano', 'Gualeguay', 'Gualeguaychú',
    'Islas del Ibicuy', 'La Paz', 'Nogoyá', 'Paraná', 'San Salvador', 'Tala', 'Uruguay', 'Victoria', 'Villaguay',
  ],
  // Estaciones de observación del SMN en la provincia (datos abiertos "tiempo presente" y "pronóstico 5 días").
  stations: [
    { id: 'parana', obsName: 'Paraná', pron5dName: 'PARANA_AERO', lat: -31.7833, lon: -60.4833 },
    { id: 'concordia', obsName: 'Concordia', pron5dName: 'CONCORDIA_AERO', lat: -31.3, lon: -58.0167 },
    { id: 'gualeguaychu', obsName: 'Gualeguaychú', pron5dName: 'GUALEGUAYCHU_AERO', lat: -33.0, lon: -58.6167 },
  ],
  localities: [
    // Cabeceras de departamento
    { id: 'parana', name: 'Paraná', department: 'Paraná', smnId: 7641, lat: -31.7392, lon: -60.5207, smnArea: 3423 },
    { id: 'concordia', name: 'Concordia', department: 'Concordia', smnId: 7706, lat: -31.3801, lon: -58.0199, smnArea: 3396 },
    { id: 'gualeguaychu', name: 'Gualeguaychú', department: 'Gualeguaychú', smnId: 7851, lat: -33.0111, lon: -58.5094, smnArea: 3406 },
    { id: 'concepcion-del-uruguay', name: 'Concepción del Uruguay', department: 'Uruguay', smnId: 7831, lat: -32.4749, lon: -58.2434, smnArea: 3406 },
    { id: 'gualeguay', name: 'Gualeguay', department: 'Gualeguay', smnId: 7852, lat: -33.1514, lon: -59.3188, smnArea: 3429 },
    { id: 'villaguay', name: 'Villaguay', department: 'Villaguay', smnId: 7601, lat: -31.8678, lon: -59.0418, smnArea: 3423 },
    { id: 'la-paz', name: 'La Paz', department: 'La Paz', smnId: 7533, lat: -30.7436, lon: -59.6446, smnArea: 3423 },
    { id: 'federacion', name: 'Federación', department: 'Federación', smnId: 7710, lat: -31.0079, lon: -57.8985, smnArea: 3396 },
    { id: 'federal', name: 'Federal', department: 'Federal', smnId: 7535, lat: -30.9475, lon: -58.7859, smnArea: 3396 },
    { id: 'nogoya', name: 'Nogoyá', department: 'Nogoyá', smnId: 7767, lat: -32.3978, lon: -59.7932, smnArea: 3423 },
    { id: 'victoria', name: 'Victoria', department: 'Victoria', smnId: 7803, lat: -32.6197, lon: -60.1563, smnArea: 3429 },
    { id: 'diamante', name: 'Diamante', department: 'Diamante', smnId: 7804, lat: -32.0675, lon: -60.6397, smnArea: 3423 },
    { id: 'colon', name: 'Colón', department: 'Colón', smnId: 7836, lat: -32.2224, lon: -58.1423, smnArea: 3406 },
    { id: 'rosario-del-tala', name: 'Rosario del Tala', department: 'Tala', smnId: 7771, lat: -32.3025, lon: -59.1439, smnArea: 3406 },
    { id: 'san-jose-de-feliciano', name: 'San José de Feliciano', department: 'Feliciano', smnId: 7534, lat: -30.384, lon: -58.7516, smnArea: 3396 },
    { id: 'ibicuy', name: 'Ibicuy', department: 'Islas del Ibicuy', smnId: 7870, lat: -33.7437, lon: -59.1542, smnArea: 3406 },
    { id: 'san-salvador', name: 'San Salvador', department: 'San Salvador', smnId: 7715, lat: -31.6265, lon: -58.4967, smnArea: 3396 },
    // Otras localidades importantes
    { id: 'chajari', name: 'Chajarí', department: 'Federación', smnId: 7564, lat: -30.7534, lon: -57.985, smnArea: 3396 },
    { id: 'crespo', name: 'Crespo', department: 'Paraná', smnId: 7808, lat: -32.0301, lon: -60.3105, smnArea: 3423 },
    { id: 'basavilbaso', name: 'Basavilbaso', department: 'Uruguay', smnId: 7773, lat: -32.3747, lon: -58.8742, smnArea: 3406 },
    { id: 'villa-elisa', name: 'Villa Elisa', department: 'Colón', smnId: 7827, lat: -32.1607, lon: -58.4044 },
    { id: 'viale', name: 'Viale', department: 'Paraná', smnId: 7669, lat: -31.8688, lon: -60.0088 },
    { id: 'hasenkamp', name: 'Hasenkamp', department: 'Paraná', smnId: 7570, lat: -31.513, lon: -59.8355 },
    { id: 'maria-grande', name: 'María Grande', department: 'Paraná', smnId: 7572, lat: -31.6648, lon: -59.901 },
    { id: 'segui', name: 'Seguí', department: 'Paraná', smnId: 7668, lat: -31.9571, lon: -60.1286 },
    { id: 'larroque', name: 'Larroque', department: 'Gualeguaychú', smnId: 7868, lat: -33.0369, lon: -59.0072 },
    { id: 'urdinarrain', name: 'Urdinarrain', department: 'Gualeguaychú', smnId: 7763, lat: -32.6824, lon: -58.8908 },
    { id: 'villa-paranacito', name: 'Villa Paranacito', department: 'Islas del Ibicuy', smnId: 7850, lat: -33.7153, lon: -58.6615 },
    { id: 'bovril', name: 'Bovril', department: 'La Paz', smnId: 7587, lat: -31.3436, lon: -59.4467 },
    { id: 'santa-elena', name: 'Santa Elena', department: 'La Paz', smnId: 7537, lat: -30.9473, lon: -59.7878 },
    { id: 'lucas-gonzalez', name: 'Lucas González', department: 'Nogoyá', smnId: 7768, lat: -32.3859, lon: -59.5307 },
  ],
};
