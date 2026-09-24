/* El Campo Entrerriano — interfaz pública.
   Sin librerías: carga rápida en conexiones lentas. Todo texto externo se escapa antes de mostrarse. */
(function () {
  'use strict';
  const TZ = 'America/Argentina/Buenos_Aires';
  const main = document.getElementById('contenido');
  const locSel = document.getElementById('loc');
  let META = null;

  // ---------------- utilidades ----------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: no pasa nada */ } },
  };
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
  const ext = (u, txt) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>`;
  const num = (n, d = 0) => (n === null || n === undefined || isNaN(n) ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pesos = (n, d = 0) => (n === null || n === undefined ? '—' : '$ ' + num(n, d));
  const plata = (n) => (n === null || n === undefined ? '—' : '$ ' + num(n, Number.isInteger(n) ? 0 : 2));
  const dt = (iso, opts) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T12:00:00-03:00' : iso); return isNaN(d) ? esc(iso) : d.toLocaleString('es-AR', { timeZone: TZ, ...opts }); };
  const fecha = (iso) => dt(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fechaHora = (iso) => dt(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' h';
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  function dayLabel(iso) {
    const t = todayIso();
    const tm = new Date(Date.parse(t + 'T12:00:00-03:00') + 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
    const name = dt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
    if (iso === t) return 'Hoy, ' + name;
    if (iso === tm) return 'Mañana, ' + name;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  function hace(iso) {
    if (!iso) return '';
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 2) return 'hace un momento';
    if (min < 60) return `hace ${min} minutos`;
    const h = Math.round(min / 60);
    if (h < 48) return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
    return `hace ${Math.round(h / 24)} días`;
  }

  // Línea de estado: siempre dice de dónde sale el dato y cuándo se actualizó.
  function status(m, extra) {
    if (!m) return '';
    const src = m.url ? ext(m.url, m.sourceName) : esc(m.sourceName);
    if (m.status === 'pending') return `<p class="status pending">Fuente pendiente de conexión: todavía no se obtuvo el primer dato de ${src}.</p>`;
    if (m.status === 'disabled') return `<p class="status pending">Esta fuente está desactivada por el administrador.</p>`;
    if (m.status === 'error') return `<p class="status error">Estamos teniendo problemas para actualizar esta información (${src}). Todavía no hay datos guardados.</p>`;
    const when = `Última actualización: ${hace(m.fetchedAt)} (${fechaHora(m.fetchedAt)})`;
    if (m.status === 'stale') return `<p class="status warn"><strong>Estamos teniendo problemas para actualizar esta información.</strong><br>${when}. Fuente: ${src}.</p>`;
    if (m.status === 'retrying') return `<p class="status warn">${when}. Fuente: ${src}. El último intento de actualización falló; se reintenta automáticamente.</p>`;
    return `<p class="status">${when}. Fuente: ${src}${m.official ? ' <span class="badge ok">oficial</span>' : ''}.${extra ? ' ' + extra : ''}</p>`;
  }

  async function api(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(path, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.data = j; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }

  // Localidad: por defecto GUALEGUAY. Se usa una clave nueva ('loc2') para que quien tenía guardada otra
  // localidad de la versión anterior (que arrancaba en Paraná) vuelva a ver Gualeguay; si elige otra, se respeta.
  const loc = () => store.get('loc2', null) || (META && META.defaultLocality) || 'gualeguay';
  const back = '<a class="back" href="#/">← Volver al inicio</a>';
  const setTitle = (t) => { document.title = t ? `${t} — El Campo Entrerriano` : 'El Campo Entrerriano — clima, hacienda, granos y ríos'; };

  let silent = false; // actualización automática: no mover la pantalla ni el foco
  function render(html) {
    if (silent) { const y = window.scrollY; main.innerHTML = html; window.scrollTo(0, y); return; }
    main.innerHTML = html;
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function renderError(e, retry) {
    main.innerHTML = `${back}<div class="status error"><strong>No pudimos cargar esta sección.</strong><br>${esc(e.message || '')}<br>Revisá la conexión a internet.</div><button class="btn" id="retry" type="button">Intentar de nuevo</button>`;
    document.getElementById('retry').onclick = retry;
  }

  // ---------------- piezas reutilizables ----------------
  function windTxt(dir, speed, range) {
    if (range) return `${esc(dir || '')} ${range[0]}–${range[1]} km/h`.trim();
    if (speed === null || speed === undefined) return '—';
    if (speed === 0) return 'Calma';
    return `${esc(dir || '')} ${num(speed)} km/h`.trim();
  }
  function rainTxt(day) {
    if (!day) return '—';
    const p = day.rainProbMax;
    if ((p === null || p === undefined) && day.rainMm !== null && day.rainMm !== undefined) return `${num(day.rainMm, 1)} mm`;
    if (p === null || p === undefined) return '—';
    if (p === 0) return 'Sin lluvia prevista';
    return `${p}% de probabilidad${day.rainMm ? ` · ${num(day.rainMm, 1)} mm` : ''}`;
  }
  const levelBadge = (l) => `<span class="level ${esc(l)}">Alerta ${esc(l).toLowerCase()}</span>`;
  function alertRange(a) {
    if (a.kind === 'temperatura') return `Vigente según la última emisión del SMN (${fechaHora(a.updated)}).`;
    if (a.kind === 'cap') return a.from && a.to ? `Desde el ${fechaHora(a.from)} hasta el ${fechaHora(a.to)}.` : a.to ? `Hasta el ${fechaHora(a.to)}.` : 'Vigente.';
    return a.from === a.to ? `Para ${dayLabel(a.from).toLowerCase()}.` : `Desde el ${fecha(a.from)} hasta el ${fecha(a.to)}.`;
  }
  // Variación contra el dato anterior (solo si hay un dato anterior confiable).
  function varTxt(v, short) {
    if (!v || v.pct === null || v.pct === undefined) return short ? '' : '<span class="trend">Sin dato anterior para comparar</span>';
    if (Math.abs(v.pct) < 0.05) return `<span class="trend">= igual que el ${fecha(v.previousDate)}</span>`;
    return `<span class="trend ${v.pct > 0 ? 'up' : 'down'}">${v.pct > 0 ? '▲' : '▼'} ${num(Math.abs(v.pct), 1)}%${short ? '' : ` vs. ${fecha(v.previousDate)} (${pesos(v.previous, 0)})`}</span>`;
  }
  function trend(cur, prev) {
    if (!prev || cur === null || cur === undefined || !prev.value) return '';
    return varTxt({ pct: Math.round(((cur - prev.value) / prev.value) * 1000) / 10, previous: prev.value, previousDate: prev.date });
  }
  const srcLink = (url, name) => (url ? ext(url, name) : esc(name));

  // Avisos de lluvia y tiempo (rojo / amarillo).
  function avisosHtml(list, compact) {
    if (!list || !list.length) return '';
    return `<div class="avisos">${list.map((a) => `<div class="aviso ${esc(a.level)}" role="${a.level === 'rojo' ? 'alert' : 'status'}">
      <span class="aviso-ico" aria-hidden="true">${esc(a.icon)}</span>
      <div><strong class="aviso-t">${esc(a.title)}</strong><span class="aviso-d">${esc(a.detail)}</span>${compact ? '' : `<span class="aviso-o">${esc(a.origin)}</span>`}</div>
    </div>`).join('')}</div>`;
  }

  // Tarjeta de precio de hacienda (novillo / vaca / ternero).
  function hTile(emoji, name, x, big) {
    if (!x) return `<div class="htile"><div class="htile-n">${emoji} ${esc(name)}</div><div class="htile-v">—</div><div class="htile-s">Todavía sin dato</div></div>`;
    return `<div class="htile${x.stale ? ' old' : ''}">
      <div class="htile-n">${emoji} ${esc(name)}</div>
      <div class="htile-v">${pesos(x.value, big ? 0 : 0)}</div>
      <div class="htile-u">${esc(x.unit.replace('$ por kg vivo', '$/kg vivo'))}</div>
      ${varTxt(x.variation, !big)}
      <div class="htile-s">${x.monthly ? 'Remate mensual' : 'Remate'} del ${fecha(x.date)}${x.stale ? ' · <strong>dato viejo</strong>' : ''}</div>
      ${big ? `<div class="htile-s">${esc(x.index)}<br>${srcLink(x.url, x.market)}${x.status ? ` · precios ${esc(x.status)}` : ''}<br>Consultado: ${fechaHora(x.fetchedAt)}</div>` : ''}
    </div>`;
  }

  // Franja fija de hacienda (en todas las páginas).
  const strip = document.getElementById('fijados');
  async function loadStrip() {
    if (!strip) return;
    try {
      const f = await api('/api/fijados');
      const cell = (e, n, x) => `<a class="fij" href="#/mercado"><span class="fij-n">${e} ${n}</span><span class="fij-v">${x ? pesos(x.value) : '—'}</span><span class="fij-s">${x ? `/kg · ${dt(x.date, { day: '2-digit', month: '2-digit' })}` : 'sin dato'}</span></a>`;
      strip.innerHTML = cell('🐂', 'NOVILLO', f.novillo) + cell('🐄', 'VACA', f.vaca) + cell('🐄', 'TERNERO', f.ternero);
      strip.hidden = false;
    } catch (e) { /* si falla, no se muestra: nunca números inventados */ }
  }

  // ---------------- INICIO ----------------
  async function pageHome() {
    setTitle('');
    const d = await api('/api/inicio?loc=' + encodeURIComponent(loc()));
    const c = d.clima;
    const cur = c.current;
    const today = c.today;

    // 1) Ubicación + clima
    const clima = (cur || today) ? `
      <div class="now">
        ${cur ? `<span class="temp-big">${num(cur.temp)}°</span>` : ''}
        <span class="sky">${esc((cur && cur.weather) || (today && today.summary) || '')}</span>
      </div>
      <dl class="facts">
        <div><dt>Mínima / máxima hoy</dt><dd>${today ? `${num(today.tMin)}° / ${num(today.tMax)}°` : '—'}</dd></div>
        <div><dt>Lluvia hoy</dt><dd>${rainTxt(today)}</dd></div>
        <div><dt>Viento</dt><dd>${cur ? windTxt(cur.windDir, cur.windSpeed) : '—'}</dd></div>
        <div><dt>Humedad</dt><dd>${cur && cur.humidity !== null && cur.humidity !== undefined ? num(cur.humidity) + '%' : '—'}</dd></div>
        <div><dt>Mañana</dt><dd>${c.tomorrow ? `${esc(c.tomorrow.summary || '')} ${num(c.tomorrow.tMin)}° / ${num(c.tomorrow.tMax)}°` : '—'}</dd></div>
        <div><dt>Lluvia mañana</dt><dd>${rainTxt(c.tomorrow)}</dd></div>
      </dl>
      ${cur ? `<p class="src">${esc(cur.originLabel)}${cur.observedAt ? ` Dato de las ${dt(cur.observedAt, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} h.` : ''}</p>` : ''}
      ${c.nearestObs ? `<p class="src">Observación oficial más cercana: SMN ${esc(c.nearestObs.station)} (a ${num(c.nearestObs.km)} km): ${num(c.nearestObs.temp, 1)}°, ${esc(c.nearestObs.weather || '')}.</p>` : ''}`
      : '<p>Todavía no hay datos del clima para esta localidad.</p>';

    // 2) Alertas: oficiales del SMN + sanitarias
    const al = d.alertas;
    let meteo;
    if (al.meta.status === 'pending' || al.meta.status === 'error') meteo = status(al.meta);
    else if (al.count) meteo = al.top.map((a) => `<div class="alert-box ${esc(a.levelName)}"><h4>⚠️ ${esc(a.event)} ${levelBadge(a.levelName)}</h4><p>${alertRange(a)}</p></div>`).join('') + (al.count > 2 ? `<p>Y ${al.count - 2} alerta(s) más.</p>` : '');
    else meteo = `<p class="no-alert">✔ ${esc(al.noAlertsText)} <span class="src">(SMN)</span></p>`;
    const s = d.sanitarias;
    const sanit = s.top.length
      ? s.top.map((x) => `<div class="alert-box san ${esc(x.importancia.nivel)}"><h4>🩺 ${esc(x.que)}</h4><p><strong>${esc(x.importancia.texto)}</strong> · ${esc(x.zona)} · ${fecha(x.fecha)}</p><p class="src">${srcLink(x.url, x.fuente)}</p></div>`).join('')
      : `<p class="no-alert">✔ ${esc(s.vacioTexto)}</p>`;

    // 3) Hacienda fijada
    const h = d.hacienda;
    const hac = `<div class="htiles">${hTile('🐂', 'NOVILLO', h.novillo)}${hTile('🐄', 'VACA', h.vaca)}${hTile('🐄', 'TERNERO', h.ternero)}</div>
      <div class="enpie"><span class="enpie-n">Hacienda en pie · promedio general</span><span class="enpie-v">${h.enPie ? pesos(h.enPie.value) : '—'}</span><span class="enpie-s">${h.enPie ? `$ por kg vivo · ${fecha(h.enPie.date)} ${varTxt(h.enPie.variation, true)}` : 'sin dato'}</span></div>
      <p class="src">Novillo (INMAG), vaca e índice general: Mercado Agroganadero de Cañuelas, último remate. Ternero: Índice Ternero de ROSGAN (remate mensual).</p>`;

    // 4) Granos
    const g = d.granos;
    const gr = g.items.length ? `<table class="prices"><thead><tr><th>Producto</th><th class="num">$ por tonelada</th></tr></thead><tbody>
      ${g.items.map((x) => `<tr><td>${esc(x.product)}${x.estimated ? ' <span class="badge">estimativo</span>' : ''}</td><td class="num">${x.sinCotizacion && !x.estimated ? 'S/C' : pesos(x.value)}</td></tr>`).join('')}
      ${g.arroz ? `<tr><td>Arroz cáscara largo fino <span class="badge">mensual</span></td><td class="num">${pesos(g.arroz.largoFino)}<span class="sub">por quintal · ${esc(g.arroz.period)}</span></td></tr>` : ''}
      </tbody></table><p class="src">Pizarra de la Cámara Arbitral de Rosario del ${fecha(g.date)} (referencia para Entre Ríos). Arroz: Secretaría de Agricultura.</p>` : status(g.meta);

    // 5) Dólar
    const dl = d.dolar;
    const dol = dl.oficial || dl.blue ? `<div class="table-wrap"><table class="prices"><thead><tr><th></th><th class="num">Compra</th><th class="num">Venta</th></tr></thead><tbody>
      ${dl.oficial ? `<tr><td><strong>Oficial</strong><span class="sub">Banco Nación</span></td><td class="num">${plata(dl.oficial.compra)}</td><td class="num">${plata(dl.oficial.venta)}</td></tr>` : ''}
      ${dl.mayorista ? `<tr><td>Mayorista</td><td class="num">${plata(dl.mayorista.compra)}</td><td class="num">${plata(dl.mayorista.venta)}</td></tr>` : ''}
      ${dl.blue ? `<tr><td>Blue <span class="badge">informal</span></td><td class="num">${plata(dl.blue.compra)}</td><td class="num">${plata(dl.blue.venta)}</td></tr>` : ''}
      </tbody></table></div><p class="src">${dl.oficial ? `Oficial: ${esc(dl.oficial.fuente)}, ${fecha(dl.oficial.date || dl.oficial.at)}${dl.oficial.time ? ' ' + esc(dl.oficial.time) + ' h' : ''}. ` : ''}Mayorista y blue: DolarApi.com.</p>` : status(dl.meta);

    // 6) Río Gualeguay
    const r = d.rio.main;
    const rio = r && !r.missing ? `<div class="rio-main ${esc(r.status.key)}">
        <div class="rio-h"><span class="rio-v">${r.height !== null ? num(r.height, 2) + ' m' : 'S/D'}</span><span class="rio-t">${rioTrend(r)}</span></div>
        <p><strong>${esc(r.status.label)}</strong> (alerta ${num(r.alert, 2)} m · evacuación ${num(r.evacuation, 2)} m)</p>
        <p class="src">${esc(r.label)} · lectura del ${fechaHora(r.at)}${r.stale ? ' · <strong>dato viejo</strong>' : ''} · Prefectura Naval Argentina</p></div>` : status(d.rio.meta);

    // 7) Noticias
    const n = d.noticias;
    const news = n.items.length ? `<ul class="news">${n.items.map((x) => `<li><a class="title" href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><div class="meta">${esc(zoneLabel(x.zone))} · ${esc(x.sourceName)} · ${fecha(x.publishedAt)}</div></li>`).join('')}</ul>` : `<p>${esc(n.vacioTexto)}</p>`;

    render(`
      <section class="hero" aria-labelledby="h-loc">
        <p class="kicker">${saludo()}</p>
        <h2 id="h-loc" class="loc-title"><span class="pin" aria-hidden="true">📍</span> ${esc(d.locality.name.toUpperCase())}</h2>
        ${avisosHtml(d.avisos, true)}
        ${clima}
        ${status(c.meta)}
        <a class="btn" href="#/clima">🌤️ Pronóstico de 7 días</a>
      </section>
      <section class="card ${al.count || d.avisos.length ? 'red' : 'green'} mt" aria-labelledby="h-alertas"><h3 id="h-alertas">⚠️ Alertas</h3>
        <h4 class="sub-h">Meteorológicas oficiales</h4>${meteo}
        <h4 class="sub-h">Sanitarias (SENASA)</h4>${sanit}
        <a class="btn secondary" href="#/alertas">Ver todas las alertas</a></section>
      <section class="card earth mt" aria-labelledby="h-hac"><h3 id="h-hac">🐂 Hacienda</h3>${hac}<a class="btn" href="#/mercado">💰 Ver mercado completo</a></section>
      <div class="grid grid-2 mt">
        <section class="card earth" aria-labelledby="h-granos"><h3 id="h-granos">🌾 Granos</h3>${gr}<a class="btn secondary" href="#/mercado#granos">Ver granos</a></section>
        <section class="card" aria-labelledby="h-dolar"><h3 id="h-dolar">💵 Dólar</h3>${dol}<a class="btn secondary" href="#/dolar">Ver dólar</a></section>
      </div>
      <section class="card mt" aria-labelledby="h-rio"><h3 id="h-rio">🌊 Río Gualeguay</h3>${rio}<a class="btn secondary" href="#/rios">Ver todos los ríos</a></section>
      <section class="card mt" aria-labelledby="h-news"><h3 id="h-news">📰 Noticias del campo</h3>${news}<a class="btn secondary" href="#/noticias">Ver más noticias</a></section>
      <nav class="menu-grid" aria-label="Secciones">
        <a class="btn" href="#/clima">🌤️ Clima</a>
        <a class="btn" href="#/alertas">⚠️ Alertas</a>
        <a class="btn" href="#/mercado">💰 Mercado</a>
        <a class="btn" href="#/dolar">💵 Dólar</a>
        <a class="btn" href="#/rios">🌊 Ríos</a>
        <a class="btn" href="#/cultivos">🌱 Plagas de cultivos</a>
        <a class="btn" href="#/noticias">📰 Noticias</a>
        <a class="btn" href="#/fuentes">📚 Fuentes</a>
      </nav>
      <p class="small muted">La página se actualiza sola cada 5 minutos mientras está abierta.</p>
    `);
  }
  function saludo() {
    const h = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
    return h >= 5 && h < 13 ? 'Buen día' : h >= 13 && h < 20 ? 'Buenas tardes' : 'Buenas noches';
  }
  const ZONES = { local: 'Gualeguay y zona', departamentos: 'Entre Ríos (departamentos)', provincia: 'Entre Ríos', nacional: 'Nacional' };
  const zoneLabel = (z) => ZONES[z] || '';
  function rioTrend(r) {
    if (!r.state || r.state === 'S/E') return 'sin tendencia';
    if (r.state === 'CRECE') return `▲ crece ${r.variation ? num(Math.abs(r.variation), 2) + ' m' : ''}`;
    if (r.state === 'BAJA') return `▼ baja ${r.variation ? num(Math.abs(r.variation), 2) + ' m' : ''}`;
    return '= estacionario';
  }

  // ---------------- CLIMA ----------------
  async function pageClima() {
    setTitle('Clima');
    const d = await api('/api/clima?loc=' + encodeURIComponent(loc()));
    const cur = d.current;
    const est = (k) => (cur && cur.estimated && cur.estimated[k] ? ' <span class="badge">estimado</span>' : '');
    const nowHtml = cur ? `
      <div class="now"><span class="temp-big">${num(cur.temp, 1)}°</span><span class="sky">${esc(cur.weather || '')}</span></div>
      <dl class="facts">
        <div><dt>Sensación térmica</dt><dd>${cur.feelsLike !== null && cur.feelsLike !== undefined ? num(cur.feelsLike, 1) + '°' + est('feelsLike') : '—'}</dd></div>
        <div><dt>Humedad</dt><dd>${cur.humidity !== null && cur.humidity !== undefined ? num(cur.humidity) + '%' : '—'}</dd></div>
        <div><dt>Viento</dt><dd>${windTxt(cur.windDir, cur.windSpeed)}</dd></div>
        <div><dt>Ráfagas</dt><dd>${cur.gust !== null && cur.gust !== undefined ? num(cur.gust) + ' km/h' + est('gust') : '—'}</dd></div>
        <div><dt>Lluvia última hora</dt><dd>${cur.precipitation !== null && cur.precipitation !== undefined ? num(cur.precipitation, 1) + ' mm' : '—'}</dd></div>
        <div><dt>Hora del dato</dt><dd>${cur.observedAt ? dt(cur.observedAt, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' h' : '—'}</dd></div>
      </dl>
      <p class="src">${esc(cur.originLabel)}</p>
      ${d.nearestObs ? `<p class="src">Observación oficial más cercana: SMN ${esc(d.nearestObs.station)} (a ${num(d.nearestObs.km)} km): ${num(d.nearestObs.temp, 1)}°, ${esc(d.nearestObs.weather || '')}, ${fechaHora(d.nearestObs.observedAt)}.</p>` : ''}` : '<p>No hay datos actuales disponibles.</p>';

    const days = d.days.map((day) => {
      const periods = day.periods.map((p) => `<div class="period"><strong>${esc(p.label)}</strong>${esc(p.weather || '')}<br>${p.temp !== null ? num(p.temp) + '°' : ''}${p.rainProb && p.rainProb[1] > 0 ? ` · lluvia ${p.rainProb[0]}–${p.rainProb[1]}%` : ' · sin lluvia'}${p.rainMm ? ` · ${num(p.rainMm, 1)} mm` : ''}<br>Viento ${windTxt(p.windDir, null, p.windSpeed)}${p.gust ? ` · ráfagas ${p.gust[0]}–${p.gust[1]} km/h` : ''}</div>`).join('');
      const m = day.model;
      const windLine = day.windMax !== undefined && day.windMax !== null ? `<p>Viento: ${esc(day.windDir || '')} hasta ${num(day.windMax)} km/h${day.gustMax ? ` · ráfagas de hasta ${num(day.gustMax)} km/h` : ''}</p>` : '';
      return `<article class="day">
        <div class="day-head"><span class="day-name">${esc(dayLabel(day.date))}</span><span class="minmax"><span class="min">Mín ${num(day.tMin)}°</span> · <span class="max">Máx ${num(day.tMax)}°</span></span></div>
        <p><strong>${esc(day.summary || '')}</strong> · Lluvia: ${rainTxt(day)}</p>
        ${windLine}
        ${periods ? `<div class="periods">${periods}</div>` : ''}
        ${m ? `<p class="model-note">Estimación por modelo (Open-Meteo): ${m.rainMm !== null ? num(m.rainMm, 1) + ' mm de lluvia' : 'mm s/d'}${m.rainProb !== null ? `, probabilidad ${m.rainProb}%` : ''}${m.gustMax !== null ? `, ráfagas de hasta ${m.gustMax} km/h` : ''}. No es el pronóstico oficial.</p>` : ''}
      </article>`;
    }).join('');

    render(`${back}
      <h2 class="page-title">🌤️ Clima en ${esc(d.locality.name)}</h2>
      ${avisosHtml(d.avisos)}
      <section class="card"><h3>Ahora</h3>${nowHtml}${status(d.meta.actual)}</section>
      <section class="card mt"><h3>Pronóstico ${d.forecastOrigin === 'smn' ? 'oficial del SMN' : 'de los próximos días (modelo numérico)'}</h3>
        ${days || '<p>No hay pronóstico disponible en este momento.</p>'}
        ${status(d.meta.pronostico)}
        ${d.forecastOrigin === 'modelo' ? `<p class="note">Este pronóstico sale de modelos numéricos (Open-Meteo). El SMN no publica su pronóstico por localidad en formato abierto: para el pronóstico oficial consultá ${ext('https://www.smn.gob.ar/pronostico', 'smn.gob.ar')}. Las <strong>alertas</strong> sí son oficiales del SMN.</p>` : ''}
      </section>
      <details class="mt"><summary>¿Cuándo se marca un aviso en rojo?</summary><ul>${d.criterios.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
      <p class="small muted">${esc(d.attribution)}</p>
      <a class="btn secondary" href="#/alertas">⚠️ Ver alertas</a>`);
  }

  // ---------------- ALERTAS ----------------
  async function pageAlertas() {
    setTitle('Alertas');
    const d = await api('/api/alertas?loc=' + encodeURIComponent(loc()));
    let body = '';
    if (d.meta.status === 'pending' || d.meta.status === 'error') body += status(d.meta) + `<p>Mientras tanto podés consultar las alertas en el ${ext(d.officialUrl, 'sitio oficial del SMN')}.</p>`;
    else if (!d.alerts.length) body += `<p class="no-alert">✔ ${esc(d.noAlertsText)}</p>`;
    else body += d.alerts.map((a) => `<article class="alert-box ${esc(a.levelName)}">
        <h3>⚠️ ${esc(a.event)}</h3>${levelBadge(a.levelName)}
        <p><strong>Zona:</strong> ${esc((a.localityNames && a.localityNames.length ? a.localityNames : [d.locality.name]).join(', '))}.<br><strong>Cuándo:</strong> ${alertRange(a)}</p>
        ${a.description ? `<p><strong>Qué ocurre:</strong> ${esc(a.description)}</p>` : ''}
        ${a.instruction ? `<p><strong>Qué recomienda el SMN:</strong></p><div class="instructions">${esc(a.instruction)}</div>` : ''}
        ${a.moreInfo ? `<p>${ext(a.moreInfo, 'Más información en el SMN')}</p>` : ''}
      </article>`).join('');
    if (d.alerts.length || ['ok', 'retrying', 'stale'].includes(d.meta.status)) body += status(d.meta, d.updated ? `Emisión del SMN: ${fechaHora(d.updated)}.` : '');

    const zones = d.province.map((a) => `<tr><td>${levelBadge(a.levelName)} <strong>${esc(a.event)}</strong><br><span class="small">${alertRange(a)}</span></td><td>${esc((a.localityNames || []).join(', '))}</td></tr>`).join('');
    const manual = d.manual.map((m) => `<div class="note"><strong>${esc(m.title)}</strong><br>${esc(m.body || '')}<br><span class="src">Fuente: ${m.url ? ext(m.url, m.source_name) : esc(m.source_name)} · ${fecha(m.content_date)}</span></div>`).join('');

    const s = d.sanitarias;
    const san = s.items.length ? s.items.map((x) => `<article class="alert-box san ${esc(x.importancia.nivel)}">
        <h3>🩺 ${esc(x.que)}</h3>
        <dl class="sanit">
          <div><dt>Qué sucede</dt><dd>${esc(x.detalle || x.que)}</dd></div>
          <div><dt>Zona afectada</dt><dd>${esc(x.zona)}</dd></div>
          <div><dt>Fecha</dt><dd>${fecha(x.fecha)}</dd></div>
          <div><dt>Importancia</dt><dd><strong>${esc(x.importancia.texto)}</strong>${x.tipo ? ` · ${esc(x.tipo)}` : ''}</dd></div>
          <div><dt>Fuente</dt><dd>${srcLink(x.url, x.fuente)}</dd></div>
        </dl>
        ${x.url ? `<p><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">Leer el comunicado oficial →</a></p>` : ''}
      </article>`).join('') : '';

    render(`${back}
      <h2 class="page-title">⚠️ Alertas para ${esc(d.locality.name)}</h2>
      <h3>🌧️ Lluvia y tiempo en las próximas 48 horas</h3>
      ${d.avisos.length ? avisosHtml(d.avisos) : `<p class="no-alert">✔ Sin lluvias importantes, tormentas, vientos fuertes, heladas ni calor extremo previstos para hoy y mañana.</p>`}
      ${status(d.metaModelo, 'Avisos calculados con el pronóstico por modelo; las alertas oficiales son las del SMN (abajo).')}
      <details><summary>¿Cuándo se marca un aviso en rojo?</summary><ul>${d.criterios.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
      <h3 class="mt">⚠️ Alertas meteorológicas oficiales (SMN)</h3>
      ${body}
      ${manual ? `<h3>Avisos cargados por la administración</h3>${manual}` : ''}
      <section class="card mt"><h3>Toda la provincia, por zona</h3>
        ${zones ? `<div class="table-wrap"><table class="prices"><thead><tr><th>Alerta</th><th>Localidades alcanzadas</th></tr></thead><tbody>${zones}</tbody></table></div>` : (['ok', 'retrying'].includes(d.meta.status) ? '<p class="no-alert">✔ No hay alertas del SMN vigentes en ninguna localidad de Entre Ríos.</p>' : '<p>Todavía no hay datos de alertas.</p>')}
        <p class="small">Niveles del SMN: <strong>amarillo</strong> (fenómenos que pueden ser peligrosos), <strong>naranja</strong> (peligrosos), <strong>rojo</strong> (excepcionalmente peligrosos).</p>
        <a class="btn secondary" href="${safeUrl(d.officialUrl)}" target="_blank" rel="noopener noreferrer">Ver el mapa oficial del SMN</a>
      </section>
      <h3 class="mt" id="sanitarias">🩺 Alertas sanitarias importantes (SENASA)</h3>
      ${s.enER ? '' : `<p class="no-alert">✔ ${esc(s.vacioTexto)}</p>`}
      ${san ? `${s.enER ? '' : '<p class="small">Comunicados oficiales recientes de otras zonas del país, para estar atentos:</p>'}${san}` : ''}
      <p class="small">${esc(s.criterio)}</p>
      ${status(s.meta)}`);
  }

  // ---------------- MERCADO ----------------
  async function pageMercado() {
    setTitle('Mercado');
    const d = await api('/api/mercado');
    const f = d.fijados;
    const hac = `<div class="htiles big">${hTile('🐂', 'NOVILLO', f.novillo, true)}${hTile('🐄', 'VACA', f.vaca, true)}${hTile('🐄', 'TERNERO', f.ternero, true)}</div>
      <p class="note"><strong>Cómo leerlo:</strong> novillo y vaca son precios de <strong>faena</strong> (hacienda gorda que va a frigorífico) en el Mercado de Cañuelas, en pesos por kilo vivo, del último remate. El ternero es de <strong>invernada</strong> (para recría/engorde): Índice Ternero de ROSGAN, que hace <strong>un remate por mes</strong>. La variación compara con el remate anterior de cada mercado.</p>`;

    const p = d.enPie;
    const enPie = p ? `<div class="enpie big"><span class="enpie-n">Hacienda en pie · Índice General (IGMAG)</span><span class="enpie-v">${pesos(p.value, 2)}</span><span class="enpie-s">$ por kg vivo · remate del ${fecha(p.date)} · ${num(p.heads)} cabezas ${varTxt(p.variation)}</span></div>
      ${p.history && p.history.length > 1 ? `<div class="table-wrap"><table class="prices"><caption>Últimos remates</caption><thead><tr><th>Fecha</th><th class="num">Índice general</th><th class="num">Cabezas</th></tr></thead><tbody>${p.history.slice().reverse().map((x) => `<tr><td>${fecha(x.date)}</td><td class="num">${pesos(x.value, 2)}</td><td class="num">${num(x.heads)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="src">${esc(p.index)} · ${srcLink(p.url, p.market)} · consultado ${fechaHora(p.fetchedAt)}</p>` : status(d.meta.indices);

    const h = d.canuelas;
    const cat = h ? `<div class="table-wrap"><table class="prices"><caption>Faena — Mercado de Cañuelas, remate del ${fecha(h.date)}${h.status ? ` (precios ${esc(h.status)})` : ''}</caption>
      <thead><tr><th>Categoría</th><th class="num">$ por kg vivo</th></tr></thead><tbody>
      ${h.groups.map((x) => `<tr><td><strong>${esc(x.label)}</strong><br>${trend(x.avg, x.previous)}</td><td class="num">${pesos(x.avg, 2)}<span class="sub">${num(x.heads)} cabezas</span></td></tr>`).join('')}
      </tbody></table></div>
      <details><summary>Ver detalle por categoría (mínimo, máximo, promedio)</summary><div class="table-wrap"><table class="prices"><thead><tr><th>Categoría</th><th class="num">Mín.</th><th class="num">Máx.</th><th class="num">Prom.</th><th class="num">Cab.</th></tr></thead><tbody>
      ${h.categories.map((r) => `<tr><td>${esc(r.category)}</td><td class="num">${num(r.min)}</td><td class="num">${num(r.max)}</td><td class="num">${num(r.avg, 2)}</td><td class="num">${num(r.heads)}</td></tr>`).join('')}
      </tbody></table></div></details>
      <p class="small">${esc(h.note)}</p>` : '';

    const inv = d.invernada;
    const invHtml = inv ? inv.tipos.map((t) => `<div class="table-wrap"><table class="prices"><caption>${esc(t.titulo === 'Cria' ? 'Cría' : t.titulo)} — ROSGAN, remate del ${fecha(inv.date)}</caption>
      <thead><tr><th>Categoría</th><th class="num">${esc(t.unidad)}</th></tr></thead><tbody>
      ${t.categorias.map((c) => `<tr><td>${esc(c.titulo)}${c.ilustrativo ? ' <span class="badge">pocos lotes</span>' : ''}</td><td class="num">${pesos(c.precio, 0)}</td></tr>`).join('')}
      </tbody></table></div>`).join('') + `<p class="small">«Pocos lotes»: ROSGAN aclara que ese promedio es solo ilustrativo porque se vendieron entre 3 y 5 lotes. Remate mensual por pantalla.</p>` : '';

    const g = d.granos;
    const granos = g ? `<div class="table-wrap"><table class="prices"><caption>Pizarra Rosario del ${fecha(g.date)}</caption>
      <thead><tr><th>Producto</th><th class="num">Precio · unidad · fecha</th></tr></thead><tbody>
      ${g.boards.map((b) => `<tr><td><strong>${esc(b.product)}</strong><br>${b.estimated ? '<span class="badge">estimativo</span>' : ''}${b.sinCotizacion ? '<span class="badge">sin cotización</span>' : ''}${trend(b.value, b.previous)}</td>
        <td class="num">${b.sinCotizacion && !b.estimated ? '—' : pesos(b.value)}<span class="sub">$ por tonelada · ${fecha(g.date)}${b.usd !== null && b.usd !== undefined ? `<br>US$ ${num(b.usd, 2)}` : ''}</span></td></tr>`).join('')}
      ${d.arroz ? `<tr><td><strong>Arroz cáscara largo fino</strong><br><span class="badge">precio mensual</span></td><td class="num">${pesos(d.arroz.latest.largoFino)}<span class="sub">$ por quintal (100 kg) · mes ${esc(d.arroz.latest.period)}</span></td></tr>
      <tr><td><strong>Arroz cáscara largo ancho</strong><br><span class="badge">precio mensual</span></td><td class="num">${pesos(d.arroz.latest.largoAncho)}<span class="sub">$ por quintal (100 kg) · mes ${esc(d.arroz.latest.period)}</span></td></tr>` : ''}
      </tbody></table></div>
      <p class="small">Fuente granos: ${ext('https://www.cac.bcr.com.ar/es/precios-de-pizarra', 'Cámara Arbitral de Cereales de la Bolsa de Comercio de Rosario')}. Fuente arroz: ${ext('https://www.magyp.gob.ar/sitio/areas/ss_mercados_agropecuarios/precios/', 'Secretaría de Agricultura (SAGyP)')}.${g.tcBna ? ` Dólar BNA divisa usado por la Cámara: ${pesos(g.tcBna.value, 2)} (${fecha(g.tcBna.date)}).` : ''}</p>
      <div class="note"><strong>Tipos de cotización, en simple:</strong>
        <ul><li><strong>Pizarra:</strong> precio de referencia que fija la Cámara Arbitral de Rosario para la mercadería disponible (entrega inmediata) en los puertos del Gran Rosario. En Entre Ríos se cobra ese precio menos flete y gastos.</li>
        <li><strong>Estimativo:</strong> no hubo negocios suficientes ese día y la Cámara publica un valor aproximado.</li>
        <li><strong>S/C (sin cotización):</strong> no hubo precio ese día.</li>
        <li><strong>Arroz:</strong> promedio mensual nacional que publica la Secretaría de Agricultura, no un precio diario.</li></ul></div>` : '';

    const manual = d.manual.map((m) => `<tr><td><strong>${esc(m.title)}</strong><br><span class="src">${esc(m.source_name)}${m.url ? ' · ' + ext(m.url, 'ver fuente') : ''}</span></td><td class="num">${esc(m.currency === 'USD' ? 'US$ ' : '$ ')}${num(m.value, 2)}<span class="sub">${esc(m.unit || '')} · ${fecha(m.content_date)}</span></td></tr>`).join('');

    render(`${back}
      <h2 class="page-title">💰 Mercado</h2>
      <p class="lead">Precios de referencia publicados por los mercados. No son precios de compra garantizados.</p>
      <section class="card earth"><h3>🐂 Novillo, vaca y ternero</h3>${hac}${status(d.meta.indices)}</section>
      <section class="card earth mt"><h3>Hacienda en pie</h3>${enPie}</section>
      <section class="card earth mt"><h3>Faena por categoría (Cañuelas)</h3>${cat || ''}${status(d.meta.hacienda)}</section>
      <section class="card earth mt"><h3>Invernada y cría (ROSGAN)</h3>${invHtml}${status(d.meta.rosgan)}</section>
      <section class="card earth mt" id="granos"><h3>🌾 Granos</h3>${granos}${status(d.meta.granos)}${status(d.meta.arroz)}</section>
      ${manual ? `<section class="card earth mt"><h3>Otros precios cargados por la administración</h3><table class="prices"><tbody>${manual}</tbody></table></section>` : ''}
      <section class="card mt"><h3>Lo que todavía no se puede actualizar solo</h3>
        ${d.pendientes.map((p) => `<p><strong>${esc(p.producto)}:</strong> ${esc(p.motivo)} ${ext(p.url, 'Ver fuente')}</p>`).join('')}
      </section>`);
  }

  // ---------------- DÓLAR ----------------
  async function pageDolar() {
    setTitle('Dólar');
    const d = await api('/api/dolar');
    const row = (name, x, note) => x ? `<article class="ficha">
        <h3>${name}</h3>
        <div class="dol"><div><span class="dol-l">Compra</span><span class="dol-v">${plata(x.compra)}</span></div><div><span class="dol-l">Venta</span><span class="dol-v">${plata(x.venta)}</span></div></div>
        <p class="src">Actualizado: ${x.at ? fechaHora(x.at) : fecha(x.date)} · Fuente: ${srcLink(x.url, x.fuente)}</p>
        ${note ? `<p class="small">${note}</p>` : ''}</article>` : `<article class="ficha"><h3>${name}</h3><p>Sin dato en este momento.</p></article>`;
    render(`${back}
      <h2 class="page-title">💵 Dólar</h2>
      ${row('Dólar oficial (Banco Nación, billete)', d.oficial, 'Es la cotización de ventanilla del Banco Nación.')}
      ${row('Dólar mayorista', d.mayorista, 'Referencia del mercado de cambios (BCRA). Es el que se usa para comercio exterior y, por eso, para los precios de los granos.')}
      ${row('Dólar blue <span class="badge">informal</span>', d.blue, 'Valor del mercado informal, relevado por DolarApi.com. No es una cotización oficial.')}
      ${status(d.meta)}`);
  }

  // ---------------- RÍOS ----------------
  async function pageRios() {
    setTitle('Ríos');
    const d = await api('/api/rios');
    const card = (r) => r.missing ? `<article class="ficha"><h3>${esc(r.label)}</h3><p>La Prefectura no publicó dato para este puerto.</p></article>` : `<article class="ficha rio ${esc(r.status.key)}${r.main ? ' main' : ''}">
        <h3>${esc(r.label)}</h3>
        <div class="rio-h"><span class="rio-v">${r.height !== null ? num(r.height, 2) + ' m' : 'S/D'}</span><span class="rio-t">${rioTrend(r)}</span></div>
        <p><strong>${esc(r.status.label)}</strong></p>
        <dl class="facts"><div><dt>Nivel de alerta</dt><dd>${r.alert !== null ? num(r.alert, 2) + ' m' : '—'}</dd></div><div><dt>Nivel de evacuación</dt><dd>${r.evacuation !== null ? num(r.evacuation, 2) + ' m' : '—'}</dd></div>
        <div><dt>Lectura</dt><dd>${r.at ? fechaHora(r.at) : '—'}</dd></div><div><dt>Anterior</dt><dd>${r.previous !== null ? num(r.previous, 2) + ' m' : '—'}${r.previousAt ? ` (${dt(r.previousAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })})` : ''}</dd></div></dl>
        ${r.stale ? '<p class="status warn">Dato viejo: la última lectura publicada tiene más de 36 horas.</p>' : ''}
        <p class="src">Estación: ${esc(r.port)} · Río ${esc(r.river)} · Prefectura Naval Argentina</p></article>`;
    const main = d.stations.filter((r) => r.main);
    const rest = d.stations.filter((r) => !r.main);
    render(`${back}
      <h2 class="page-title">🌊 Ríos de Entre Ríos</h2>
      ${main.map(card).join('')}
      <h3>Otros ríos de la provincia</h3>
      <div class="grid grid-2">${rest.map(card).join('')}</div>
      <p class="note">${esc(d.nota)}</p>
      ${status(d.meta)}
      <a class="btn secondary" href="${safeUrl(d.url)}" target="_blank" rel="noopener noreferrer">Ver la tabla oficial de Prefectura</a>`);
  }

  // ---------------- CULTIVOS ----------------
  async function pageCultivos(id) {
    setTitle('Cultivos y plagas');
    const d = await api('/api/cultivos');
    const sel = d.cultivos.find((c) => c.id === id) || d.cultivos[0];
    render(`${back}
      <h2 class="page-title">🌱 Enfermedades y plagas de cultivos</h2>
      <p class="lead">Fichas oficiales del Sistema Nacional de Vigilancia y Monitoreo de Plagas (SENASA) para los cultivos de Entre Ríos.</p>
      <div class="chips" role="group" aria-label="Cultivo">${d.cultivos.map((c) => `<a class="chip${c.id === sel.id ? ' active' : ''}" href="#/cultivos/${esc(c.id)}"${c.id === sel.id ? ' aria-current="page"' : ''}>${esc(c.nombre)}</a>`).join('')}</div>
      <h3>${esc(sel.nombre)}</h3>
      ${sel.plagas.map((p) => `<article class="ficha">
        <h3>${esc(p.nombre)}</h3><p class="sci">${esc(p.cientifico)} · ${esc(p.tipo)}</p>
        <dl><dt>Síntomas y daños</dt><dd>${esc(p.sintomas)}</dd><dt>Cómo identificarla</dt><dd>${esc(p.identificar)}</dd>
        <dt>Cuándo aparece</dt><dd>${esc(p.condiciones)}</dd><dt>Prevención</dt><dd>${esc(p.prevencion)}</dd>
        ${p.avisar ? `<dt>Aviso al SENASA</dt><dd>${esc(p.avisar)}</dd>` : ''}
        <dt>Nivel de riesgo</dt><dd>${esc(p.riesgo)}</dd></dl>
        <p class="src">Fuente: ${ext(p.fuente.url, p.fuente.nombre)}</p></article>`).join('')}
      <section class="card green"><h3>Qué hacer ante una plaga o enfermedad</h3><ul>${d.queHacerGeneral.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
      <p class="small muted">${esc(d._nota)}</p>
      <a class="btn secondary" href="#/alertas">⚠️ Ver alertas sanitarias oficiales</a>`);
  }

  // ---------------- NOTICIAS ----------------
  async function pageNoticias(params) {
    setTitle('Noticias');
    const zona = params.get('zona') || '';
    const d = await api('/api/noticias?limit=60' + (zona ? '&zona=' + encodeURIComponent(zona) : ''));
    render(`${back}
      <h2 class="page-title">📰 Noticias del campo</h2>
      <p class="lead">Solo lo que le importa al productor de Entre Ríos. Tocá el título para leer la nota completa en el sitio original.</p>
      <div class="chips" role="group" aria-label="Zona"><a class="chip${!zona ? ' active' : ''}" href="#/noticias">Todas</a>${d.zones.map((z) => `<a class="chip${z.id === zona ? ' active' : ''}" href="#/noticias?zona=${esc(z.id)}">${esc(z.label)}</a>`).join('')}</div>
      <section class="card">${d.items.length ? `<ul class="news">${d.items.map((n) => `<li>
        <a class="title" href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <div class="meta">${n.pinned ? '<span class="badge">destacada</span>' : ''}<span class="badge">${esc(zoneLabel(n.zone))}</span> ${esc(n.sourceName)} · ${fecha(n.publishedAt)}</div>
        ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}</li>`).join('')}</ul>` : `<p class="no-alert">${esc(d.vacioTexto)}</p>`}
        ${status(d.meta)}</section>
      <p class="small muted">${esc(d.criterio)}</p>`);
  }

  // ---------------- FUENTES ----------------
  async function pageFuentes() {
    setTitle('Fuentes');
    const d = await api('/api/fuentes');
    const cada = (m) => (m >= 1440 ? `cada ${Math.round(m / 1440)} día(s)` : m >= 60 ? `cada ${Math.round(m / 60)} hora(s)` : `cada ${m} minutos`);
    render(`${back}
      <h2 class="page-title">📚 ¿De dónde sale la información?</h2>
      <p class="lead">Priorizamos organismos oficiales y mercados de referencia. Cuando usamos otra fuente, lo decimos. Si una fuente falla, mostramos el último dato con su fecha y avisamos.</p>
      <section class="card"><h3>Datos que se actualizan solos</h3>
      ${d.automaticas.filter((s) => s.activa || s.ultimaActualizacion).map((s) => `<article class="ficha ${s.conProblemas ? 'bad' : 'good'}">
        <h3>${esc(s.nombre)}</h3>
        <p>${s.oficial ? '<span class="badge ok">Organismo oficial</span>' : '<span class="badge">Mercado / fuente privada reconocida</span>'}${s.conProblemas ? '<span class="badge red">con problemas</span>' : ''}</p>
        <p>${esc(s.organismo)}${s.nota ? ` — ${esc(s.nota)}` : ''}<br>Se consulta ${cada(s.cadaMin)}. Última actualización: ${s.ultimaActualizacion ? `${hace(s.ultimaActualizacion)} (${fechaHora(s.ultimaActualizacion)})` : 'todavía ninguna'}.</p>
        <p class="small">${esc(s.acceso)}${s.url ? ' · ' + ext(s.url, 'Ver fuente') : ''}</p></article>`).join('')}
      </section>
      <section class="card mt"><h3>Contenido de referencia</h3><ul>${d.contenido.map((c) => `<li>${ext(c.url, c.nombre)} — ${esc(c.uso)}</li>`).join('')}</ul>
        <p class="small">Fichas de plagas de cultivos revisadas el ${fecha(d.revisionContenido.cultivos)}.</p></section>
      <section class="card mt"><h3>Noticias</h3><ul>${d.noticias.map((n) => `<li>${ext(n.url, n.nombre)}${n.oficial ? ' <span class="badge ok">oficial</span>' : ''}</li>`).join('')}</ul></section>
      <p class="small"><a href="/admin">Acceso de administración</a></p>`);
  }

  // ---------------- enrutador ----------------
  async function route(opts) {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [pathAndAnchor, qs] = hash.split('?');
    const path = pathAndAnchor.split('#')[0];
    const params = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean);
    silent = !!(opts && opts.silent);
    const run = async () => {
      if (!silent) main.innerHTML = '<p class="loading">Cargando…</p>';
      try {
        if (!parts.length) return await pageHome();
        switch (parts[0]) {
          case 'clima': return await pageClima();
          case 'alertas': return await pageAlertas();
          case 'mercado': case 'precios': return await pageMercado();
          case 'dolar': return await pageDolar();
          case 'rios': return await pageRios();
          case 'cultivos': return await pageCultivos(parts[1]);
          case 'noticias': return await pageNoticias(params);
          case 'fuentes': return await pageFuentes();
          default: render(`${back}<h2 class="page-title">Página no encontrada</h2>`);
        }
      } catch (e) { if (!silent) renderError(e, run); }
    };
    await run();
    silent = false;
    const anchor = pathAndAnchor.split('#')[1];
    if (anchor && !(opts && opts.silent)) { const el = document.getElementById(anchor); if (el) el.scrollIntoView(); }
    lastRefresh = Date.now();
  }

  // Actualización automática: cada 5 minutos mientras la página está a la vista (sin mover la pantalla).
  let lastRefresh = Date.now();
  const REFRESH_MS = 5 * 60 * 1000;
  function autoRefresh() {
    if (document.visibilityState !== 'visible') return;
    if (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (Date.now() - lastRefresh < REFRESH_MS - 5000) return;
    loadStrip();
    route({ silent: true });
  }
  setInterval(autoRefresh, 60 * 1000);
  document.addEventListener('visibilitychange', autoRefresh);

  // ---------------- tamaño de letra ----------------
  const SIZES = [18, 20, 22, 24, 27, 30];
  function applyFont(i) {
    const idx = Math.max(0, Math.min(SIZES.length - 1, i));
    document.documentElement.style.setProperty('--fs', SIZES[idx] + 'px');
    store.set('font', idx);
    document.getElementById('font-down').disabled = idx === 0;
    document.getElementById('font-up').disabled = idx === SIZES.length - 1;
    return idx;
  }
  let fontIdx = applyFont(store.get('font', 1));
  document.getElementById('font-up').onclick = () => { fontIdx = applyFont(fontIdx + 1); };
  document.getElementById('font-down').onclick = () => { fontIdx = applyFont(fontIdx - 1); };

  document.getElementById('fecha-hoy').textContent = new Date().toLocaleDateString('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()) + ' · Entre Ríos';

  async function init() {
    loadStrip();
    try {
      META = await api('/api/meta');
      const byDept = {};
      META.localities.forEach((l) => { (byDept[l.department] = byDept[l.department] || []).push(l); });
      locSel.innerHTML = Object.keys(byDept).sort((a, b) => a.localeCompare(b, 'es')).map((d) => `<optgroup label="Depto. ${esc(d)}">${byDept[d].map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</optgroup>`).join('');
      if (!META.localities.some((l) => l.id === loc())) store.set('loc2', META.defaultLocality);
      locSel.value = loc();
      locSel.onchange = () => { store.set('loc2', locSel.value); route(); };
    } catch (e) { /* el enrutador muestra el error */ }
    window.addEventListener('hashchange', () => route());
    route();
  }
  init();

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
