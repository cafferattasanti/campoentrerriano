// Tests de los lectores de cada fuente contra muestras REALES capturadas el 23/09/2026.
// Si una fuente cambia su formato, estos tests (y el panel de administración) lo detectan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

process.env.DB_PATH = '/tmp/campo-test-' + process.pid + '-' + Date.now() + '.db'; // base nueva en cada corrida
const fx = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url));

const { parsePizarra } = await import('../server/sources/bcr-pizarra.js');
const { parseCanuelas } = await import('../server/sources/mag-canuelas.js');
const { parseArroz } = await import('../server/sources/magyp-arroz.js');
const { parseRss, parseGobListado } = await import('../server/sources/noticias.js');
const { parseEpidemiologia } = await import('../server/sources/senasa-epidemiologia.js');
const { parseTiepre, parsePron5d } = await import('../server/sources/smn-datos-abiertos.js');
const { normalizeForecast } = await import('../server/sources/smn-pronostico.js');
const { normalizeAreaAlerts, normalizeTempWarning } = await import('../server/sources/smn-alertas.js');
const { extractToken } = await import('../server/sources/smn-client.js');
const { unzip, parseArNumber, spanishLongDateToIso } = await import('../server/lib/text.js');
const { classify, isExcluded } = await import('../server/lib/news-classify.js');
const { parseAlturas, selectRegionRivers, prefDate, levelStatus } = await import('../server/sources/prefectura-rios.js');
const { parseIndice } = await import('../server/sources/mag-indices.js');
const { normalizeRosgan } = await import('../server/sources/rosgan.js');
const { parseBna, normalizeDolarApi } = await import('../server/sources/dolar.js');
const { parseAtom, parseGobEr, FEEDS } = await import('../server/sources/noticias.js');
const { relevance } = await import('../server/lib/news-classify.js');
const { computeAvisos } = await import('../server/lib/avisos.js');
const { default: entreRios } = await import('../server/regions/entre-rios.js');

test('BCR pizarra: fecha, 5 granos, S/C y estimativo', () => {
  const p = parsePizarra(fx('bcr-pizarra.html').toString());
  assert.equal(p.date, '2026-09-22');
  assert.equal(p.boards.length, 5);
  const trigo = p.boards.find((b) => b.key === 'trigo');
  assert.equal(trigo.value, 346150);
  assert.equal(trigo.usd, 230);
  assert.equal(trigo.direction, 'sube');
  const gira = p.boards.find((b) => b.key === 'girasol');
  assert.equal(gira.sinCotizacion, true);
  assert.equal(gira.estimated, true);
  assert.equal(gira.value, 760000);
  assert.equal(p.boards.find((b) => b.key === 'soja').value, 560000);
  assert.deepEqual(p.tcBna, { date: '2026-09-22', value: 1505 });
  assert.equal(p.publishedAt, '2026-09-23T10:17:00-03:00');
});

test('Cañuelas: filas, grupos ponderados y estado', () => {
  const p = parseCanuelas(fx('canuelas.html').toString());
  assert.equal(p.date, '2026-09-23');
  assert.equal(p.status, 'definitivos');
  assert.equal(p.rows.length, 11);
  const nov = p.groups.find((g) => g.group === 'NOVILLOS');
  assert.equal(nov.heads, 913);
  assert.equal(Math.round(nov.avg * 100) / 100, 4263.15); // igual al subtotal publicado por el Mercado
  assert.ok(p.groups.find((g) => g.group === 'VACAS'));
});

test('Arroz SAGyP: último mes y sin duplicados', () => {
  const p = parseArroz(fx('arroz.html').toString());
  assert.equal(p.latest.period, '2026-08');
  assert.equal(p.latest.largoFino, 30000);
  assert.equal(p.latest.largoAncho, 40000);
  assert.equal(p.rows.filter((r) => r.period === '2026-06').length, 1);
});

test('Noticias: RSS, listado argentina.gob.ar y filtros', () => {
  const rss = parseRss(fx('rss.xml').toString());
  assert.equal(rss.length, 2);
  assert.equal(rss[0].publishedAt, '2026-09-22T19:00:24.000Z');
  assert.ok(isExcluded(rss[1].title));
  const gob = parseGobListado(fx('gob-listado.html').toString());
  assert.equal(gob.length, 2);
  assert.match(gob[0].url, /^https:\/\/www\.argentina\.gob\.ar\/noticias\//);
  assert.ok(gob[0].summary.startsWith('Los productores de vid'));
  assert.ok(classify('Brote de influenza aviar en Gualeguaychú', '').includes('entre-rios'));
  assert.ok(classify('Precio de la soja en Rosario', '').includes('precios'));
});

test('SENASA situación epidemiológica', () => {
  const items = parseEpidemiologia(fx('epidemiologia.html').toString());
  assert.equal(items.length, 3);
  assert.equal(items[0].date, '2026-05-07');
  assert.match(items[0].title, /Valcheta/);
});

test('SMN datos abiertos: tiempo presente (latin1) y pronóstico por modelo', () => {
  const t = parseTiepre(new TextDecoder('latin1').decode(fx('tiepre.txt')));
  assert.equal(t['Paraná'].temp, 16.8);
  assert.equal(t['Paraná'].humidity, 47);
  assert.equal(t['Paraná'].windDir, 'Norte');
  assert.equal(t['Paraná'].windSpeed, 27);
  assert.equal(t['Paraná'].feelsLike, null);
  assert.equal(t['Paraná'].observedAt, '2026-09-23T12:00:00-03:00');
  const m = parsePron5d(fx('pron5d.txt').toString(), ['PARANA_AERO']);
  assert.equal(m.PARANA_AERO.length, 2);
  const d27 = m.PARANA_AERO.find((d) => d.date === '2026-09-27');
  assert.equal(d27.rainMm, 0.6);
  assert.equal(m.ROSARIO_AERO, undefined);
});

test('ZIP mínimo', () => {
  const data = Buffer.from('hola campo');
  const comp = deflateRawSync(data);
  const name = Buffer.from('a.txt');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
  const [f] = unzip(Buffer.concat([h, name, comp]));
  assert.equal(f.name, 'a.txt');
  assert.equal(f.data.toString(), 'hola campo');
});

test('SMN pronóstico oficial normalizado', () => {
  const f = normalizeForecast(JSON.parse(fx('smn-forecast.json')));
  assert.equal(f.days.length, 2);
  assert.equal(f.days[0].tMax, 22);
  assert.equal(f.days[0].summary, 'Algo nublado');
  assert.equal(f.days[1].rainProbMax, 40);
  assert.equal(f.days[1].rainMmComplete, false); // un período sin milímetros: no se inventa el total
});

test('SMN alertas: niveles, fechas e instrucciones oficiales', () => {
  const a = normalizeAreaAlerts(JSON.parse(fx('smn-alert-area.json')));
  assert.equal(a.alerts.length, 2);
  const nev = a.alerts.find((x) => x.eventId === 42);
  assert.equal(nev.levelName, 'Naranja');
  assert.equal(nev.from, '2026-09-23');
  assert.equal(nev.to, '2026-09-25');
  assert.match(nev.instruction, /aire libre/);
  const viento = a.alerts.find((x) => x.eventId === 39);
  assert.equal(viento.levelName, 'Amarillo');
  assert.equal(viento.from, '2026-09-24');
  assert.equal(a.alerts[0].eventId, 42); // más grave primero
  assert.equal(normalizeTempWarning({ level: 1, updated: 'x' }, 43), null);
  assert.equal(normalizeTempWarning({ level: 3, updated: '2026-12-01T10:00:00-03:00' }, 43).levelName, 'Naranja');
});

test('SMN token público en la página', () => {
  const html = "<script>\n localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3OTAxODY3MjN9.abc-DEF_123');\n</script>";
  assert.equal(extractToken(html), 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3OTAxODY3MjN9.abc-DEF_123');
  assert.equal(extractToken('<html></html>'), null);
});

test('Utilidades de números y fechas', () => {
  assert.equal(parseArNumber('$1.901.130.450,00'), 1901130450);
  assert.equal(spanishLongDateToIso('23 de Septiembre del 2026'), '2026-09-23');
});

test('SMN CAP: listado, alerta oficial y localidades alcanzadas', async () => {
  const { parseCapList, parseCap, inPolygon } = await import('../server/sources/smn-cap.js');
  const urls = parseCapList(fx('cap-list.html').toString());
  assert.equal(urls.length, 2);
  const c = parseCap(fx('cap.xml').toString());
  assert.equal(c.event, 'Viento');
  assert.equal(c.levelName, 'Amarillo');
  assert.equal(c.onset, '2026-09-23T21:00:00-03:00');
  assert.match(c.description, /área cordillerana/);
  assert.equal(c.polygons.length, 1);
  assert.equal(inPolygon(-31.5, -69.75, c.polygons[0]), true); // dentro de la cordillera
  assert.equal(inPolygon(-31.7392, -60.5207, c.polygons[0]), false); // Paraná: afuera
  const cuadrado = [[-31, -61], [-31, -60], [-32, -60], [-32, -61], [-31, -61]];
  assert.equal(inPolygon(-31.7392, -60.5207, cuadrado), true);
});

test('SMN CAP: listado en formato RSS', async () => {
  const { parseCapList } = await import('../server/sources/smn-cap.js');
  const rss = '<?xml version="1.0"?><rss><channel><item><title>Viento</title><link>https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_1_Viento_alertas_3.xml</link></item><item><link>https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_1_Viento_alertas_3.xml</link></item></channel></rss>';
  assert.deepEqual(parseCapList(rss), ['https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_1_Viento_alertas_3.xml']);
});

test('Prefectura: alturas, Gualeguay en Puerto Ruiz primero y niveles', () => {
  const rows = parseAlturas(fx('prefectura.html').toString());
  assert.ok(rows.length > 30);
  const list = selectRegionRivers(rows, entreRios.rivers);
  const g = list[0];
  assert.equal(g.port, 'PUERTO RUIZ');
  assert.equal(g.river, 'GUALEGUAY');
  assert.equal(g.main, true);
  assert.equal(g.height, 1.6);
  assert.equal(g.alert, 4.5);
  assert.equal(g.evacuation, 5);
  assert.equal(g.state, 'ESTAC');
  assert.equal(g.at, '2026-09-24T12:00:00-03:00');
  assert.equal(g.status.key, 'normal');
  assert.deepEqual(list.filter((x) => x.missing).map((x) => x.label), ['Río Gualeguay en Rosario del Tala (aguas arriba de Gualeguay)']); // esa escala no es de Prefectura
  assert.equal(list.find((x) => x.port === 'CONCORDIA').river, 'URUGUAY');
  assert.equal(prefDate('01/ENE/27 - 0000'), '2027-01-01T00:00:00-03:00');
  assert.equal(levelStatus({ height: 4.6, alert: 4.5, evacuation: 5 }).key, 'alerta');
  assert.equal(levelStatus({ height: 4.1, alert: 4.5, evacuation: 5 }).key, 'cerca');
  assert.equal(levelStatus({ height: null }).key, 'sd');
  // "S/E" (sin dato) nunca se convierte en número
  const se = parseAlturas('<tr><th data-label="Puerto:">X</th><td data-label="Río:">Y</td><td data-label="Ultimo Registro:">S/E</td><td data-label="Fecha Hora:"><b>S/E</b></td></tr>');
  assert.equal(se[0].height, null);
  assert.equal(se[0].at, null);
});

test('Mercado Agroganadero: INMAG (novillo) e IGMAG (en pie)', () => {
  const inmag = parseIndice(fx('mag-inmag.html').toString());
  const igmag = parseIndice(fx('mag-igmag.html').toString());
  assert.equal(inmag.length, 6); // la fila de "Totales" no cuenta
  assert.deepEqual(inmag.at(-1), { date: '2026-09-23', heads: 4717, amount: 8123004400, value: 4263.15 });
  assert.equal(inmag.at(-2).value, 4216.059);
  assert.equal(igmag.at(-1).value, 3772.019);
  // El INMAG coincide con el promedio ponderado de Novillos calculado de la planilla de categorías
  const c = parseCanuelas(fx('canuelas.html').toString());
  assert.equal(Math.round(c.groups.find((g) => g.group === 'NOVILLOS').avg * 100) / 100, Math.round(inmag.at(-1).value * 100) / 100);
});

test('ROSGAN: Índice Ternero del último remate y el anterior', () => {
  const r = normalizeRosgan(JSON.parse(fx('rosgan.json')));
  assert.equal(r.latest.date, '2026-09-09');
  assert.equal(r.latest.indiceTernero, 6135.4);
  assert.equal(r.previous.indiceTernero, 6187.46);
  const inv = r.latest.tipos.find((t) => t.titulo === 'Invernada');
  assert.equal(inv.unidad, '$ por kg vivo');
  assert.ok(!inv.categorias.some((c) => c.precio === 0)); // categorías sin ventas no se muestran
  assert.equal(inv.categorias.find((c) => c.titulo === 'Novillos 2 a 3 años').ilustrativo, true);
  assert.equal(r.latest.tipos.find((t) => t.titulo === 'Cria').unidad, '$ por cabeza');
});

test('Dólar: Banco Nación billete y DolarApi', () => {
  const b = parseBna(fx('bna.html').toString());
  assert.deepEqual(b, { compra: 1490, venta: 1540, date: '2026-09-24', time: '12:22', at: '2026-09-24T12:22:00-03:00' });
  const d = normalizeDolarApi(JSON.parse(fx('dolarapi.json')));
  assert.equal(d.blue.venta, 1560);
  assert.equal(d.mayorista.compra, 1509);
  assert.equal(d.oficial.venta, 1540);
  assert.equal(parseBna('<html>sin tabla</html>'), null);
});

test('Noticias locales: Atom de El Debate Pregón, portal de Entre Ríos y filtro estricto', () => {
  const atom = parseAtom(fx('debatepregon.xml').toString());
  assert.equal(atom.length, 7);
  const feeds = Object.fromEntries(FEEDS.map((f) => [f.id, f]));
  const keep = atom.filter((n) => relevance(n, feeds.debatepregon, entreRios).ok).map((n) => n.title);
  assert.deepEqual(keep, [
    'Avanzan a buen ritmo los trabajos de ensanche y limpieza en el Canal de Mihura',
    'Productores de Gualeguay analizan la campaña de soja y el estado de los caminos rurales',
  ]);
  assert.equal(relevance(atom[6], feeds.debatepregon, entreRios).zone, 'local');
  const gob = parseGobEr(JSON.parse(fx('gob-er.json')));
  assert.equal(gob[2].url, 'https://portal.entrerios.gov.ar/noticias/80063');
  const gkeep = gob.filter((n) => relevance(n, feeds['gob-er'], entreRios).ok).map((n) => n.title);
  assert.deepEqual(gkeep, [
    'Comenzó la construcción de una calzada sumergible entre Concordia y Federación',
    'Continúa la construcción de calzadas sumergibles en el departamento Nogoyá',
  ]);
  // Nacional: solo con impacto concreto; otras provincias, fuera; "vacaciones" no es "vaca".
  assert.equal(relevance({ title: 'El Gobierno bajó las retenciones a la soja y el maíz' }, feeds.infocampo, entreRios).ok, true);
  assert.equal(relevance({ title: 'Córdoba: récord de siembra de maíz' }, feeds.infocampo, entreRios).ok, false);
  assert.equal(relevance({ title: 'Vacaciones de invierno en Paraná' }, feeds.debatepregon, entreRios).ok, false);
  assert.equal(relevance({ title: 'Un apostador de Larroque ganó el Quini 6' }, feeds.debatepregon, entreRios).ok, false);
});

test('Avisos de lluvia: rojo solo con lluvia probable y considerable', () => {
  const now = new Date('2026-09-24T10:30:00-03:00');
  const h = (d, hh, mm, p, code = 3, gust = 20) => ({ time: `${d}T${String(hh).padStart(2, '0')}:00`, rainMm: mm, rainProb: p, code, gust, temp: 15 });
  const base = (fn) => { const hours = []; for (const d of ['2026-09-24', '2026-09-25']) for (let i = 0; i < 24; i++) hours.push(fn(d, i)); return hours; };
  const om = (hours, cur = {}, days = []) => ({ current: { precipitation: 0, code: 1, weather: 'Despejado', ...cur }, hours, days });
  // Llovizna leve: no avisa nada
  let a = computeAvisos({ om: om(base((d, i) => h(d, i, 0.1, 30))), now });
  assert.equal(a.length, 0);
  // Mañana 12 mm con 70 %: rojo "LLUVIA PREVISTA MAÑANA"
  a = computeAvisos({ om: om(base((d, i) => h(d, i, d === '2026-09-25' && i >= 14 && i < 20 ? 2 : 0, d === '2026-09-25' ? 70 : 10))), now });
  assert.equal(a[0].title, 'LLUVIA PREVISTA MAÑANA');
  assert.equal(a[0].level, 'rojo');
  assert.match(a[0].detail, /12 mm/);
  // 2 mm con 50 %: amarillo
  a = computeAvisos({ om: om(base((d, i) => h(d, i, d === '2026-09-24' && i === 18 ? 2 : 0, 50))), now });
  assert.equal(a[0].level, 'amarillo');
  assert.equal(a[0].title, 'Posible lluvia hoy');
  // Llueve ahora según el modelo
  a = computeAvisos({ om: om([], { precipitation: 1.2, code: 63, weather: 'Lluvia' }), now });
  assert.equal(a[0].title, 'LLUEVE AHORA');
  // Observación del SMN cercana manda sobre el modelo
  a = computeAvisos({ om: om([], { precipitation: 1.2, code: 63 }), obs: { weather: 'Despejado', station: 'Paraná' }, now });
  assert.equal(a.length, 0);
  // Helada, viento y tormenta
  a = computeAvisos({ om: om(base((d, i) => h(d, i, 0, 50, d === '2026-09-25' && i === 17 ? 95 : 2, 85)), {}, [{ date: '2026-09-25', tMin: -3, tMax: 12 }]), now });
  const ids = a.map((x) => x.id);
  assert.ok(ids.includes('helada-mañana'));
  assert.equal(a.find((x) => x.id === 'helada-mañana').level, 'rojo');
  assert.equal(a.find((x) => x.id === 'viento-HOY').level, 'rojo');
  assert.ok(ids.includes('tormenta-MAÑANA'));
});

test('Dirección de Hidráulica ER: INA y escalas del río Gualeguay', async () => {
  const { normalizeIna, normalizeGualeguay, inaDate } = await import('../server/sources/hidraulica-rios.js');
  const ina = normalizeIna(JSON.parse(fx('hid-ina.json')));
  assert.equal(ina.length, 6); // solo Entre Ríos
  const d = ina.find((x) => x.nombre === 'Diamante');
  assert.deepEqual([d.height, d.alert, d.evacuation, d.tendencia, d.at], [3.22, 5.3, 5.5, 'sube', '2026-09-24T00:00:00-03:00']);
  assert.equal(ina.find((x) => x.nombre === 'Federación').vigente, false);
  const pr = normalizeGualeguay(JSON.parse(fx('hid-pr.json')));
  assert.deepEqual(pr.at(-1), { date: '2026-09-23', height: 1.4 });
  assert.equal(inaDate('x'), null);
});

test('Ríos: se combina Prefectura con Hidráulica y se toma la lectura más reciente', async () => {
  const db = await import('../server/db.js');
  const { normalizeIna, normalizeGualeguay } = await import('../server/sources/hidraulica-rios.js');
  const api = await import('../server/api.js');
  // Solo Hidráulica (como pasa en el servidor público, donde Prefectura no responde)
  db.putSnapshot('hidraulica-rios', 'entre-rios', { ina: normalizeIna(JSON.parse(fx('hid-ina.json'))), gualeguay: { PR: normalizeGualeguay(JSON.parse(fx('hid-pr.json'))), RT: normalizeGualeguay(JSON.parse(fx('hid-rt.json'))) } });
  let r = api.rios();
  assert.equal(r.main.label, 'Río Gualeguay en Puerto Ruiz (Gualeguay)');
  assert.equal(r.main.height, 1.4);
  assert.equal(r.main.state, 'BAJA');
  assert.equal(r.main.alert, null); // no se inventan niveles de alerta
  assert.equal(r.main.status.key, 'nolevel');
  assert.equal(r.main.dateOnly, true);
  const g = r.stations.find((x) => x.label.startsWith('Río Gualeguaychú'));
  assert.deepEqual([g.height, g.alert, g.state, g.fuente], [1.9, 3.5, 'BAJA', 'Dirección de Hidráulica de Entre Ríos (datos del INA)']);
  // Con Prefectura más nueva: gana Prefectura, con sus niveles de alerta
  const { parseAlturas, selectRegionRivers } = await import('../server/sources/prefectura-rios.js');
  const { default: region } = await import('../server/regions/entre-rios.js');
  db.putSnapshot('prefectura-rios', 'entre-rios', { stations: selectRegionRivers(parseAlturas(fx('prefectura.html').toString()), region.rivers) });
  r = api.rios();
  assert.equal(r.main.height, 1.6);
  assert.equal(r.main.alert, 4.5);
  assert.equal(r.main.fuente, 'Prefectura Naval Argentina');
  // La lectura de Hidráulica (1,4 m del 23/09) es más vieja que la de Prefectura: no se muestra como "También".
  assert.equal(r.main.otherSource, null);
  const gy = r.stations.find((x) => x.label.startsWith('Río Gualeguaychú'));
  assert.equal(gy.previous, 1.9);
  assert.equal(gy.otherSource, null); // Hidráulica repite la lectura anterior de Prefectura (1,9 m)
  // Río de cada localidad (inicio y parte del día)
  const rio = (id) => api.inicio(id).rio.main;
  assert.equal(rio('gualeguay').titulo, 'Río Gualeguay en Puerto Ruiz');
  assert.equal(rio('concordia').titulo, 'Río Uruguay en Concordia');
  assert.equal(rio('parana').titulo, 'Río Paraná en Paraná');
  assert.equal(rio('colon').titulo, 'Río Uruguay en Colón');
  assert.equal(rio('victoria').titulo, 'Río Paraná en Victoria');
  assert.equal(rio('la-paz').titulo, 'Río Paraná en La Paz');
  assert.equal(rio('gualeguaychu').titulo, 'Río Gualeguaychú en Gualeguaychú');
  const fed = rio('federal');
  assert.equal(fed.relacion, 'cercana');
  assert.match(fed.nota, /Federal no está sobre un río/);
  // /api/rios mantiene su estructura
  assert.equal(r.all, undefined);
});

test('Noticias: lo "local" depende de la localidad elegida', async () => {
  const db = await import('../server/db.js');
  const api = await import('../server/api.js');
  const now = new Date().toISOString();
  db.insertNews({ source: 'debatepregon', sourceName: 'El Debate Pregón (Gualeguay)', title: 'Avanza la limpieza del Canal de Mihura para los productores rurales', url: 'https://www.diariodebatepregon.com/locales/mihura-test', summary: 'Obra de desagüe en la zona rural.', publishedAt: now });
  db.insertNews({ source: 'gob-er', sourceName: 'Gobierno de Entre Ríos', title: 'Concordia: productores citrícolas reciben asistencia por la sequía', url: 'https://x/concordia-test', summary: 'El municipio de Concordia, Entre Ríos, asiste a productores.', publishedAt: now });
  const top = (loc) => api.noticias({ loc }).items;
  const g = top('gualeguay');
  assert.equal(g.find((n) => /Mihura/.test(n.title)).zone, 'local');
  const c = top('concordia');
  assert.equal(c[0].title.startsWith('Concordia:'), true);
  assert.equal(c.find((n) => /Mihura/.test(n.title)).zone, 'departamentos'); // no es "local" para Concordia
  assert.equal(api.noticias({ loc: 'concordia' }).zones[0].label, 'Concordia y zona');
});

test('MET Norway: normalización y avisos sin dato de probabilidad', async () => {
  const { normalizeMet } = await import('../server/sources/met-no.js');
  const m = normalizeMet(JSON.parse(fx('metno.json')));
  assert.equal(m.current.observedAt, '2026-09-24T17:00:00-03:00'); // 20 UTC = 17 h de Argentina
  assert.equal(m.current.windSpeed, 17); // 4,8 m/s
  assert.equal(m.current.windDir, 'Norte');
  assert.equal(m.hours.length, 64); // toda la parte horaria (MET la da para ~2,5 días)
  assert.equal(m.hours[0].rainProb, null);
  const d27 = m.days.find((d) => d.date === '2026-09-27');
  assert.ok(d27.rainMm > 50, 'lluvia del 26/27 sumada por hora local');
  assert.equal(d27.weather, 'Lluvia fuerte');
  const d26 = m.days.find((d) => d.date === '2026-09-26');
  assert.equal(d26.rainMm, 27); // 18 h a 23 h locales del 26: 0,5+1,3+4+5+5,4+10,8
  // Sin probabilidad no se dan avisos de lluvia (podrían ser engañosos)
  const avisos = computeAvisos({ om: m, now: new Date('2026-09-26T10:00:00-03:00'), provider: 'MET Norway' });
  assert.equal(avisos.filter((a) => /lluvia|tormenta/i.test(a.id)).length, 0);
});
