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

  const loc = () => store.get('loc', null) || (META && META.defaultLocality) || 'parana';
  const back = '<a class="back" href="#/">← Volver al inicio</a>';
  const setTitle = (t) => { document.title = t ? `${t} — El Campo Entrerriano` : 'El Campo Entrerriano — clima, alertas, precios y sanidad'; };

  function render(html) {
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
    if (p === null || p === undefined) return '—';
    if (p === 0) return 'Sin lluvia prevista';
    return `${p}% de probabilidad`;
  }
  const levelBadge = (l) => `<span class="level ${esc(l)}">Alerta ${esc(l).toLowerCase()}</span>`;
  function alertRange(a) {
    if (a.kind === 'temperatura') return `Vigente según la última emisión del SMN (${fechaHora(a.updated)}).`;
    if (a.kind === 'cap') return a.from && a.to ? `Desde el ${fechaHora(a.from)} hasta el ${fechaHora(a.to)}.` : a.to ? `Hasta el ${fechaHora(a.to)}.` : 'Vigente.';
    return a.from === a.to ? `Para ${dayLabel(a.from).toLowerCase()}.` : `Desde el ${fecha(a.from)} hasta el ${fecha(a.to)}.`;
  }
  function trend(cur, prev) {
    if (!prev || cur === null || cur === undefined || !prev.value) return '';
    const diff = ((cur - prev.value) / prev.value) * 100;
    if (Math.abs(diff) < 0.05) return `<span class="trend">= igual que el ${fecha(prev.date)}</span>`;
    return `<span class="trend ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${num(Math.abs(diff), 1)}% vs. ${fecha(prev.date)}</span>`;
  }

  // ---------------- INICIO ----------------
  async function pageHome() {
    setTitle('');
    const d = await api('/api/inicio?loc=' + encodeURIComponent(loc()));
    const h = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
    const saludo = h >= 5 && h < 13 ? 'Buen día' : h >= 13 && h < 20 ? 'Buenas tardes' : 'Buenas noches';
    const c = d.clima;
    const cur = c.current;
    const today = c.today;
    let clima = '';
    if (cur || today) {
      clima = `<div class="now">
          ${cur ? `<span class="temp-big">${num(cur.temp)}°</span>` : ''}
          <span class="sky">${esc((cur && cur.weather) || (today && today.summary) || '')}</span>
        </div>
        <dl class="facts">
          <div><dt>Sensación térmica</dt><dd>${cur && cur.feelsLike !== null && cur.feelsLike !== undefined ? num(cur.feelsLike) + '°' + (cur.estimated && cur.estimated.feelsLike ? ' <span class="badge">estimada</span>' : '') : '—'}</dd></div>
          <div><dt>Viento</dt><dd>${cur ? windTxt(cur.windDir, cur.windSpeed) : '—'}</dd></div>
          <div><dt>Humedad</dt><dd>${cur && cur.humidity !== null ? num(cur.humidity) + '%' : '—'}</dd></div>
          <div><dt>Lluvia hoy</dt><dd>${rainTxt(today)}</dd></div>
          <div><dt>Mínima / máxima</dt><dd>${today ? `${num(today.tMin)}° / ${num(today.tMax)}°` : '—'}</dd></div>
          <div><dt>Mañana</dt><dd>${c.tomorrow ? `${esc(c.tomorrow.summary || '')} ${num(c.tomorrow.tMin)}° / ${num(c.tomorrow.tMax)}°` : '—'}</dd></div>
        </dl>
        ${cur ? `<p class="src">${esc(cur.originLabel)}</p>` : ''}`;
    } else {
      clima = '<p>Todavía no hay datos del clima para esta localidad.</p>';
    }

    const al = d.alertas;
    let alertas;
    if (al.meta.status === 'pending' || al.meta.status === 'error') alertas = status(al.meta);
    else if (al.count) {
      alertas = al.top.map((a) => `<div class="alert-box ${esc(a.levelName)}"><h3>⚠️ ${esc(a.event)}</h3>${levelBadge(a.levelName)}<p>${alertRange(a)}</p></div>`).join('') + (al.count > 2 ? `<p>Y ${al.count - 2} alerta(s) más.</p>` : '');
    } else alertas = `<p class="no-alert">✔ ${esc(al.noAlertsText)}</p>`;
    if (al.shortTerm && al.shortTerm.active) alertas = `<div class="alert-box Rojo"><h3>⛈️ Aviso a muy corto plazo</h3><p>El SMN emitió un aviso de tormentas fuertes para las próximas horas en esta zona.</p></div>` + alertas;

    const p = d.precios;
    const rows = p.granos.map((g) => `<tr><td>${esc(g.product)}</td><td class="num">${g.sinCotizacion && !g.estimated ? 'Sin cotización' : pesos(g.value)}${g.estimated ? '<span class="sub">estimativo</span>' : ''}</td></tr>`).join('');
    const precios = (p.granos.length || p.novillos || p.arroz)
      ? `<table class="prices"><thead><tr><th>Producto</th><th class="num">Precio</th></tr></thead><tbody>
          ${rows ? rows + `<tr><td colspan="2" class="src">Granos: $ por tonelada, pizarra Rosario del ${fecha(p.granosFecha)}</td></tr>` : ''}
          ${p.novillos ? `<tr><td>Novillos (Cañuelas)</td><td class="num">${pesos(p.novillos.avg, 2)}<span class="sub">por kg vivo · ${fecha(p.haciendaFecha)}</span></td></tr>` : ''}
          ${p.arroz ? `<tr><td>Arroz cáscara largo fino</td><td class="num">${pesos(p.arroz.largoFino)}<span class="sub">por quintal · mes ${esc(p.arroz.period)}</span></td></tr>` : ''}
        </tbody></table>`
      : status(p.meta.granos);

    const s = d.sanidad;
    const sanidad = s.ultima ? `<p><span class="kicker">Último comunicado sanitario oficial</span><br>${ext(s.ultima.url, s.ultima.title)}<br><span class="src">${fecha(s.ultima.date)} · ${esc(s.ultima.origin)}</span></p>` : '<p>Sin comunicados sanitarios cargados todavía.</p>';

    const noticias = d.noticias.length ? `<ul class="news">${d.noticias.map((n) => `<li><a class="title" href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><div class="meta">${esc(n.sourceName)} · ${fecha(n.publishedAt)}</div></li>`).join('')}</ul>` : '<p>Todavía no hay noticias cargadas.</p>';

    render(`
      <p class="greeting">${saludo}</p>
      <p class="kicker">📍 ${esc(d.locality.name)}, Entre Ríos</p>
      <div class="grid grid-2">
        <section class="card" aria-labelledby="h-clima"><h3 id="h-clima"><span class="emoji">🌤️</span> Clima de hoy</h3>${clima}${status(c.meta)}<a class="btn" href="#/clima">🌤️ Ver clima y pronóstico</a></section>
        <section class="card ${al.count ? '' : 'green'}" aria-labelledby="h-alertas"><h3 id="h-alertas"><span class="emoji">⚠️</span> Alertas</h3>${alertas}<a class="btn ${al.count ? 'alert' : 'secondary'}" href="#/alertas">⚠️ Ver alertas</a></section>
        <section class="card earth" aria-labelledby="h-precios"><h3 id="h-precios"><span class="emoji">💰</span> Precios</h3>${precios}<a class="btn" href="#/precios">💰 Ver todos los precios</a></section>
        <section class="card green" aria-labelledby="h-sanidad"><h3 id="h-sanidad"><span class="emoji">🐄</span> Sanidad</h3>${sanidad}<a class="btn" href="#/sanidad">🐄 Sanidad animal</a><a class="btn secondary" href="#/medicamentos">💊 Buscar medicamentos</a></section>
      </div>
      <nav class="menu-grid" aria-label="Secciones">
        <a class="btn" href="#/clima">🌤️ Ver clima</a>
        <a class="btn" href="#/alertas">⚠️ Alertas</a>
        <a class="btn" href="#/precios">💰 Ver precios</a>
        <a class="btn" href="#/sanidad">🐄 Sanidad animal</a>
        <a class="btn" href="#/medicamentos">💊 Medicamentos</a>
        <a class="btn" href="#/cultivos">🌱 Cultivos y plagas</a>
        <a class="btn" href="#/noticias">📰 Noticias</a>
        <a class="btn" href="#/fuentes">📚 Fuentes</a>
      </nav>
      <section class="card" aria-labelledby="h-news"><h3 id="h-news"><span class="emoji">📰</span> Noticias del campo</h3>${noticias}<a class="btn" href="#/noticias">📰 Ver más noticias</a></section>
    `);
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
        <div><dt>Presión</dt><dd>${cur.pressure ? num(cur.pressure, 1) + ' hPa' : '—'}</dd></div>
        <div><dt>Hora del dato</dt><dd>${cur.observedAt ? dt(cur.observedAt, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' h' : '—'}</dd></div>
      </dl>
      <p class="src">${esc(cur.originLabel)}</p>` : '<p>No hay datos actuales disponibles.</p>';

    const days = d.days.map((day) => {
      const periods = day.periods.map((p) => `<div class="period"><strong>${esc(p.label)}</strong>${esc(p.weather || '')}<br>${p.temp !== null ? num(p.temp) + '°' : ''}${p.rainProb && p.rainProb[1] > 0 ? ` · lluvia ${p.rainProb[0]}–${p.rainProb[1]}%` : ' · sin lluvia'}${p.rainMm ? ` · ${num(p.rainMm, 1)} mm` : ''}<br>Viento ${windTxt(p.windDir, null, p.windSpeed)}${p.gust ? ` · ráfagas ${p.gust[0]}–${p.gust[1]} km/h` : ''}</div>`).join('');
      const m = day.model;
      const smnMm = day.rainMm && day.rainMmComplete ? `${num(day.rainMm, 1)} mm` : null;
      const windLine = day.windMax !== undefined && day.windMax !== null ? `<p>Viento: ${esc(day.windDir || '')} hasta ${num(day.windMax)} km/h${day.gustMax ? ` · ráfagas de hasta ${num(day.gustMax)} km/h` : ''}</p>` : '';
      return `<article class="day">
        <div class="day-head"><span class="day-name">${esc(dayLabel(day.date))}</span><span class="minmax"><span class="min">Mín ${num(day.tMin)}°</span> · <span class="max">Máx ${num(day.tMax)}°</span></span></div>
        <p><strong>${esc(day.summary || '')}</strong> · Lluvia: ${rainTxt(day)}${smnMm ? ' · ' + smnMm : ''}${day.humMin !== undefined && day.humMin !== null ? ` · Humedad ${num(day.humMin)}–${num(day.humMax)}%` : ''}</p>
        ${windLine}
        ${periods ? `<div class="periods">${periods}</div>` : ''}
        ${m ? `<p class="model-note">Estimación por modelo (Open-Meteo): ${m.rainMm !== null ? num(m.rainMm, 1) + ' mm de lluvia' : 'mm s/d'}${m.rainProb !== null ? `, probabilidad ${m.rainProb}%` : ''}${m.gustMax !== null ? `, ráfagas de hasta ${m.gustMax} km/h` : ''}. No es el pronóstico oficial.</p>` : ''}
      </article>`;
    }).join('');

    const model = d.modelStation ? `<details><summary>Ver pronóstico por modelo del SMN para la estación ${esc(d.modelStation.name)}</summary>
      <p class="small">El SMN aclara que este producto se basa en un modelo numérico y puede diferir del pronóstico que emite.</p>
      <div class="table-wrap"><table class="prices"><thead><tr><th>Día</th><th class="num">Mín / Máx</th><th class="num">Lluvia</th><th class="num">Viento máx.</th></tr></thead><tbody>
      ${d.modelStation.days.map((x) => `<tr><td>${esc(dayLabel(x.date))}</td><td class="num">${num(x.tMin, 1)}° / ${num(x.tMax, 1)}°</td><td class="num">${num(x.rainMm, 1)} mm</td><td class="num">${num(x.windMaxKmh)} km/h</td></tr>`).join('')}
      </tbody></table></div>${status(d.meta.observacion)}</details>` : '';

    render(`${back}
      <h2 class="page-title">🌤️ Clima en ${esc(d.locality.name)}</h2>
      <section class="card"><h3>Ahora</h3>${nowHtml}</section>
      <section class="card mt"><h3>Pronóstico ${d.forecastOrigin === 'smn' ? 'oficial del SMN' : d.forecastOrigin === 'modelo' ? 'para los próximos días (modelo numérico)' : ''}</h3>
        ${days || '<p>No hay pronóstico disponible en este momento.</p>'}
        ${status(d.meta.pronostico)}
        ${d.forecastOrigin === 'modelo' ? `<p class="note">Este pronóstico sale de modelos numéricos (Open-Meteo). El SMN no publica su pronóstico por localidad en formato abierto: para el pronóstico oficial consultá ${ext('https://www.smn.gob.ar/pronostico', 'smn.gob.ar')}. Las <strong>alertas</strong> sí son oficiales del SMN.</p>` : ''}
        ${status(d.meta.modelo, 'Milímetros y ráfagas estimados por modelo.')}
        ${model}
      </section>
      <p class="small muted">${esc(d.attribution)}</p>
      <a class="btn secondary" href="#/alertas">⚠️ Ver alertas</a>`);
  }

  // ---------------- ALERTAS ----------------
  async function pageAlertas() {
    setTitle('Alertas');
    const d = await api('/api/alertas?loc=' + encodeURIComponent(loc()));
    let body = '';
    if (d.shortTerm.active) body += `<div class="alert-box Rojo"><h3>⛈️ Aviso a muy corto plazo</h3><p>El SMN emitió un aviso de tormentas fuertes para las próximas horas que alcanza a ${esc(d.locality.name)}.</p><p>${ext(d.shortTerm.url, 'Ver el aviso en el sitio del SMN')}</p></div>`;
    if (d.meta.status === 'pending' || d.meta.status === 'error') body += status(d.meta) + `<p>Mientras tanto podés consultar las alertas en el ${ext(d.officialUrl, 'sitio oficial del SMN')}.</p>`;
    else if (!d.alerts.length) body += `<p class="no-alert">✔ ${esc(d.noAlertsText)}</p>`;
    else body += d.alerts.map((a) => `<article class="alert-box ${esc(a.levelName)}">
        <h3>⚠️ ${esc(a.event)}</h3>${levelBadge(a.levelName)}
        <p><strong>Zona:</strong> ${esc((a.localityNames && a.localityNames.length ? a.localityNames : [d.locality.name]).join(', '))}.<br><strong>Cuándo:</strong> ${alertRange(a)}</p>
        ${a.days && a.days.length ? `<ul>${a.days.map((x) => `<li>${esc(dayLabel(x.date))}: ${x.periods.length ? x.periods.map((p) => `${esc(p.period)} (${esc(p.levelName.toLowerCase())})`).join(', ') : esc(x.levelName.toLowerCase())}</li>`).join('')}</ul>` : ''}
        ${a.description ? `<p><strong>Qué ocurre:</strong> ${esc(a.description)}</p>` : ''}
        ${a.instruction ? `<p><strong>Qué recomienda el SMN:</strong></p><div class="instructions">${esc(a.instruction)}</div>` : ''}
        ${a.moreInfo ? `<p>${ext(a.moreInfo, 'Más información en el SMN')}</p>` : ''}
      </article>`).join('');
    if (d.alerts.length || d.meta.status === 'ok' || d.meta.status === 'retrying' || d.meta.status === 'stale') body += status(d.meta, d.updated ? `Emisión del SMN: ${fechaHora(d.updated)}.` : '');

    const zones = d.province.map((a) => `<tr><td>${levelBadge(a.levelName)} <strong>${esc(a.event)}</strong><br><span class="small">${alertRange(a)}</span></td><td>${esc((a.localityNames || []).join(', '))}</td></tr>`).join('');
    const manual = d.manual.map((m) => `<div class="note"><strong>${esc(m.title)}</strong><br>${esc(m.body || '')}<br><span class="src">Fuente: ${m.url ? ext(m.url, m.source_name) : esc(m.source_name)} · ${fecha(m.content_date)}</span></div>`).join('');

    render(`${back}
      <h2 class="page-title">⚠️ Alertas meteorológicas</h2>
      <p class="lead">Alertas oficiales del Servicio Meteorológico Nacional para ${esc(d.locality.name)}.</p>
      ${body}
      ${manual ? `<h3>Avisos cargados por la administración</h3>${manual}` : ''}
      <section class="card mt"><h3>Toda la provincia, por zona</h3>
        ${zones ? `<div class="table-wrap"><table class="prices"><thead><tr><th>Alerta</th><th>Localidades alcanzadas</th></tr></thead><tbody>${zones}</tbody></table></div>` : (d.meta.status === 'ok' || d.meta.status === 'retrying' ? '<p class="no-alert">✔ No hay alertas del SMN vigentes en ninguna localidad de Entre Ríos.</p>' : '<p>Todavía no hay datos de alertas.</p>')}
        <p class="small">Niveles del SMN: <strong>amarillo</strong> (fenómenos que pueden ser peligrosos), <strong>naranja</strong> (fenómenos peligrosos), <strong>rojo</strong> (fenómenos excepcionalmente peligrosos).</p>
        <a class="btn secondary" href="${safeUrl(d.officialUrl)}" target="_blank" rel="noopener noreferrer">Ver el mapa oficial del SMN</a>
      </section>`);
  }

  // ---------------- PRECIOS ----------------
  async function pagePrecios() {
    setTitle('Precios');
    const d = await api('/api/precios');
    const g = d.granos;
    const granos = g ? `<div class="table-wrap"><table class="prices"><caption>Granos — Pizarra Rosario del ${fecha(g.date)}</caption>
      <thead><tr><th>Producto</th><th class="num">Precio por tonelada</th></tr></thead><tbody>
      ${g.boards.map((b) => `<tr><td><strong>${esc(b.product)}</strong><br>${b.estimated ? '<span class="badge">estimativo (E)</span>' : ''}${b.sinCotizacion ? '<span class="badge">sin cotización (S/C)</span>' : ''}${trend(b.value, b.previous)}</td>
        <td class="num">${b.sinCotizacion && !b.estimated ? '—' : pesos(b.value)}<span class="sub">${b.usd !== null ? 'US$ ' + num(b.usd, 2) : ''}</span></td></tr>`).join('')}
      </tbody></table></div>
      <p class="small">${esc(g.note)}${g.tcBna ? ` Dólar BNA divisa comprador del ${fecha(g.tcBna.date)}: ${pesos(g.tcBna.value, 2)}.` : ''} «S/C»: sin cotización; «(E)»: valor estimativo de la Cámara.</p>
      <p class="small">Mercado: Cámara Arbitral de Cereales de la Bolsa de Comercio de Rosario. Es la referencia que usan los productores de Entre Ríos: el precio en tu zona se calcula descontando flete y gastos.</p>` : '';
    const h = d.hacienda;
    const hacienda = h ? `<div class="table-wrap"><table class="prices"><caption>Hacienda — Mercado Agroganadero de Cañuelas, ${fecha(h.date)}</caption>
      <thead><tr><th>Categoría</th><th class="num">$ por kg vivo (promedio)</th></tr></thead><tbody>
      ${h.groups.map((x) => `<tr><td><strong>${esc(x.label)}</strong><br>${trend(x.avg, x.previous)}</td><td class="num">${pesos(x.avg, 2)}<span class="sub">${num(x.heads)} cabezas</span></td></tr>`).join('')}
      ${h.general ? `<tr><td><strong>Promedio general del día</strong></td><td class="num">${pesos(h.general.avg, 2)}<span class="sub">${num(h.general.heads)} cabezas</span></td></tr>` : ''}
      </tbody></table></div>
      <p class="small">Precios ${h.status ? `<strong>${esc(h.status)}</strong>` : ''}. ${esc(h.note)}</p>
      <details><summary>Ver detalle por categoría (mínimo, máximo, promedio)</summary><div class="table-wrap"><table class="prices"><thead><tr><th>Categoría</th><th class="num">Mín.</th><th class="num">Máx.</th><th class="num">Prom.</th><th class="num">Cab.</th></tr></thead><tbody>
      ${h.categories.map((r) => `<tr><td>${esc(r.category)}</td><td class="num">${num(r.min)}</td><td class="num">${num(r.max)}</td><td class="num">${num(r.avg, 2)}</td><td class="num">${num(r.heads)}</td></tr>`).join('')}
      </tbody></table></div></details>` : '';
    const a = d.arroz;
    const arroz = a ? `<div class="table-wrap"><table class="prices"><caption>Arroz cáscara — precio mensual nacional (SAGyP)</caption>
      <thead><tr><th>Mes</th><th class="num">Largo fino</th><th class="num">Largo ancho</th></tr></thead><tbody>
      ${a.rows.slice(0, 6).map((r) => `<tr><td class="nowrap">${esc(r.period)}</td><td class="num">${pesos(r.largoFino)}</td><td class="num">${pesos(r.largoAncho)}</td></tr>`).join('')}
      </tbody></table></div><p class="small">Pesos por quintal (100 kg). <strong>No es un precio diario:</strong> la Secretaría de Agricultura lo publica una vez por mes.</p>` : '';
    const manual = d.manual.map((m) => `<tr><td><strong>${esc(m.title)}</strong><br><span class="src">${esc(m.source_name)}${m.url ? ' · ' + ext(m.url, 'ver fuente') : ''}</span></td><td class="num">${esc(m.currency === 'USD' ? 'US$ ' : '$ ')}${num(m.value, 2)}<span class="sub">${esc(m.unit || '')} · ${fecha(m.content_date)}</span></td></tr>`).join('');

    render(`${back}
      <h2 class="page-title">💰 Precios del campo</h2>
      <p class="lead">Precios de referencia publicados por mercados y organismos. No son precios de compra garantizados.</p>
      <section class="card earth">${granos || '<h3>Granos</h3>'}${status(d.meta.granos)}</section>
      <section class="card earth mt">${hacienda || '<h3>Hacienda</h3>'}${status(d.meta.hacienda)}</section>
      <section class="card earth mt">${arroz || '<h3>Arroz</h3>'}${status(d.meta.arroz)}</section>
      ${manual ? `<section class="card earth mt"><h3>Otros precios cargados por la administración</h3><table class="prices"><tbody>${manual}</tbody></table></section>` : ''}
      <section class="card mt"><h3>Precios que todavía no se actualizan solos</h3>
        ${d.pendientes.map((p) => `<p><strong>${esc(p.producto)}:</strong> ${esc(p.motivo)} ${ext(p.url, 'Ver fuente oficial')}</p>`).join('')}
      </section>`);
  }

  // ---------------- SANIDAD ----------------
  async function pageSanidad() {
    setTitle('Sanidad animal');
    const d = await api('/api/sanidad');
    const item = (i) => `<li><a class="title" href="${safeUrl(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><div class="meta">${fecha(i.date)} · ${esc(i.origin)}${i.departments && i.departments.length ? ' · Departamento: ' + esc(i.departments.join(', ')) : ''}</div></li>`;
    const manual = d.manual.map((m) => `<div class="alert-box"><h3>${esc(m.title)}</h3><p>${esc(m.body || '')}</p><p class="src">Fuente: ${m.url ? ext(m.url, m.source_name) : esc(m.source_name)} · ${fecha(m.content_date)}</p></div>`).join('');
    render(`${back}
      <h2 class="page-title">🐄 Sanidad animal</h2>
      <p class="disclaimer">${esc(d.disclaimer)}</p>
      <h3>Elegí la especie</h3>
      <nav class="menu-grid" aria-label="Especies">${d.especies.map((e) => `<a class="btn" href="#/sanidad/${esc(e.id)}">${esc(e.emoji)} ${esc(e.nombre)}</a>`).join('')}</nav>
      <a class="btn secondary" href="#/medicamentos">💊 ¿Qué medicamento estás buscando?</a>
      <section class="card green mt"><h3>Alertas sanitarias en Entre Ríos</h3>
        ${manual}
        ${d.enProvincia.length ? `<ul class="news">${d.enProvincia.map(item).join('')}</ul>` : '<p>No hay comunicados oficiales recientes del SENASA que mencionen a Entre Ríos.</p>'}
        <p class="note">${esc(d.mapaNota)}</p>
      </section>
      <section class="card mt"><h3>Últimos comunicados sanitarios del SENASA (todo el país)</h3>
        ${d.alertas.length ? `<ul class="news">${d.alertas.slice(0, 12).map(item).join('')}</ul>` : '<p>Todavía no se cargaron comunicados.</p>'}
        ${status(d.meta)}
      </section>
      <section class="card mt"><h3>${esc(d.avisoSenasa.titulo)}</h3><p>${esc(d.avisoSenasa.texto)}</p><ul>${d.avisoSenasa.canales.map((c) => `<li>${esc(c)}</li>`).join('')}</ul><p class="src">Fuente: ${ext(d.avisoSenasa.fuente.url, d.avisoSenasa.fuente.nombre)}</p></section>`);
  }

  function fuente(f) { return f ? `<p class="src">Fuente: ${ext(f.url, f.nombre)}${f.fecha ? ` · consultada/publicada: ${fecha(f.fecha)}` : ''}</p>` : ''; }

  async function pageEspecie(id) {
    const e = await api('/api/sanidad/' + encodeURIComponent(id));
    setTitle('Sanidad — ' + e.nombre);
    render(`<a class="back" href="#/sanidad">← Volver a sanidad animal</a>
      <h2 class="page-title">${esc(e.emoji)} ${esc(e.nombre)}</h2>
      <p class="disclaimer">${esc(e.disclaimer)}</p>
      ${e.vacunacion.length ? `<section class="card green"><h3>Vacunación y controles obligatorios</h3>${e.vacunacion.map((v) => `<h4>${esc(v.titulo)}</h4><p>${esc(v.texto)}</p>${fuente(v.fuente)}`).join('')}</section>` : ''}
      <h3>Enfermedades y problemas sanitarios</h3>
      ${e.enfermedades.map((x) => `<article class="ficha">
        <h3>${esc(x.nombre)}</h3><p class="sci">${esc(x.tipo)}</p>
        <p>${x.denuncia ? '<span class="badge red">Denuncia obligatoria al SENASA</span>' : ''}${x.zoonosis ? '<span class="badge red">Se contagia a las personas</span>' : ''}</p>
        <dl><dt>Síntomas</dt><dd>${esc(x.sintomas)}</dd><dt>Prevención</dt><dd>${esc(x.prevencion)}</dd><dt>Qué hacer</dt><dd>${esc(x.queHacer)}</dd><dt>Nivel de riesgo</dt><dd>${esc(x.riesgo)}</dd></dl>
        ${fuente(x.fuente)}</article>`).join('')}
      <section class="card mt"><h3>🩺 Cuándo llamar al veterinario</h3><ul>${e.cuandoLlamarVeterinario.map((c) => `<li>${esc(c)}</li>`).join('')}</ul><p class="src">${esc(e.cuandoLlamarFuente)}</p></section>
      <section class="card mt"><h3>${esc(e.avisoSenasa.titulo)}</h3><ul>${e.avisoSenasa.canales.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>
      <a class="btn" href="#/medicamentos?especie=${esc(e.id)}">💊 Buscar medicamentos para ${esc(e.nombre.toLowerCase())}</a>
      <p class="small muted">Contenido revisado el ${fecha(e.revisado)}. Parásitos, manejo y otros problemas frecuentes: consultá al veterinario y a la agencia del INTA de tu zona.</p>`);
  }

  // ---------------- MEDICAMENTOS ----------------
  async function pageMedicamentos(params) {
    setTitle('Medicamentos veterinarios');
    const q = params.get('q') || '';
    const especie = params.get('especie') || '';
    const opts = (META ? META.especies : []).map((e) => `<option value="${esc(e.id)}"${e.id === especie ? ' selected' : ''}>${esc(e.nombre)}</option>`).join('');
    render(`${back}
      <h2 class="page-title">💊 ¿Qué medicamento estás buscando?</h2>
      <p class="disclaimer">La información de esta sección es orientativa y no reemplaza la evaluación de un veterinario.</p>
      <form class="search" id="medform" role="search">
        <label class="sr-only" for="q">Nombre comercial, principio activo o problema</label>
        <input type="search" id="q" name="q" value="${esc(q)}" placeholder="Ej.: ivermectina, oxitetraciclina, parasitosis" autocomplete="off" minlength="3" required>
        <label class="sr-only" for="esp">Especie</label>
        <select id="esp" name="especie"><option value="">Todas las especies</option>${opts}</select>
        <button class="btn" type="submit">Buscar</button>
      </form>
      <p class="small">Busca por <strong>nombre comercial</strong>, <strong>principio activo</strong> o <strong>tipo de problema</strong> (por ejemplo «parasitosis internas», «infecciones bacterianas»). Los datos salen <strong>en vivo del Registro Oficial de Productos Veterinarios del SENASA</strong>.</p>
      <div id="medres" aria-live="polite"></div>`);
    document.getElementById('medform').onsubmit = (ev) => {
      ev.preventDefault();
      const nq = document.getElementById('q').value.trim();
      const ne = document.getElementById('esp').value;
      location.hash = `#/medicamentos?q=${encodeURIComponent(nq)}${ne ? '&especie=' + encodeURIComponent(ne) : ''}`;
    };
    if (q.length < 3) return;
    const box = document.getElementById('medres');
    box.innerHTML = '<p class="loading">Consultando el registro oficial del SENASA… (puede tardar unos segundos)</p>';
    try {
      const d = await api(`/api/medicamentos?q=${encodeURIComponent(q)}${especie ? '&especie=' + encodeURIComponent(especie) : ''}`);
      const matched = [];
      if (d.matched.principiosActivos && d.matched.principiosActivos.length) matched.push('principio activo: ' + d.matched.principiosActivos.slice(0, 6).join(', '));
      if (d.matched.indicaciones && d.matched.indicaciones.length) matched.push('indicación: ' + d.matched.indicaciones.join(', '));
      box.innerHTML = `<p><strong>${d.results.length ? `Se muestran ${d.results.length} productos` : 'No se encontraron productos'}</strong>${d.total > d.results.length ? ` (el registro tiene ${num(d.total)} coincidencias; refiná la búsqueda o buscalos en el ${ext(d.vademecumUrl, 'Vademécum del SENASA')})` : ''}.${matched.length ? `<br><span class="small">Coincidencias por ${esc(matched.join(' · '))}.</span>` : ''}</p>
        <p class="note"><strong>No mostramos dosis a propósito.</strong> La dosis depende del animal, del diagnóstico y del prospecto aprobado: la indica el veterinario. Leé siempre el prospecto.</p>
        ${d.incomplete ? '<p class="status warn">Algunas fichas del registro no respondieron y no se muestran. Probá de nuevo más tarde.</p>' : ''}
        ${d.results.map(medCard).join('')}
        <p class="status">Consultado ${hace(d.consultedAt)} (${fechaHora(d.consultedAt)}). Fuente: ${ext(d.vademecumUrl, 'SENASA — Registro de Productos Veterinarios')}.</p>`;
    } catch (e) {
      box.innerHTML = `<p class="status error">${esc(e.message)}</p>${e.data && e.data.vademecumUrl ? `<p>Podés buscar directamente en el ${ext(e.data.vademecumUrl, 'Vademécum oficial del SENASA')}.</p>` : ''}`;
    }
  }

  function medCard(m) {
    const warn = [];
    if (m.estado && m.estado !== 'ACTIVO') warn.push(`Estado en el registro: <strong>${esc(m.estado)}</strong>.`);
    if (m.tipoRegistro && /EXPORT/i.test(m.tipoRegistro)) warn.push(`Tipo de registro: <strong>${esc(m.tipoRegistro.toLowerCase())}</strong> (según el SENASA).`);
    if (m.revisionSenasa && m.revisionSenasa !== 'CORROBORADO') warn.push('Datos cargados por la empresa: el SENASA todavía <strong>no los corroboró</strong>. No tomarlos como confirmados.');
    const r = m.restricciones || {};
    const restr = [['Leche', r.leche], ['Huevos', r.huevos], ['Miel', r.miel]].filter(([, v]) => v).map(([k, v]) => `${k}: ${esc(v)}`).join(' · ');
    return `<article class="ficha med">
      <h3>${esc(m.nombre || 'Producto sin nombre')}</h3>
      <p class="sci">${esc(m.empresa || '')} · Certificado SENASA N.º ${esc(m.certificado || '—')}</p>
      ${warn.length ? `<div class="status warn">${warn.join('<br>')}</div>` : '<p><span class="badge ok">Activo</span><span class="badge ok">Corroborado por SENASA</span></p>'}
      <dl>
        <dt>Principio activo</dt><dd>${m.principios.length ? m.principios.map((p) => `${esc(p.nombre)}${p.cantidad ? ` ${esc(p.cantidad)}${esc(p.unidad || '')}` : ''}`).join(', ') : 'No figura en el registro'}</dd>
        <dt>Especies</dt><dd>${m.especies.length ? m.especies.map((e) => esc(e.especie) + (e.categoria ? ` (${esc(e.categoria.toLowerCase())})` : '')).join(', ') : 'No figura'}</dd>
        <dt>Uso (según el registro)</dt><dd>${m.indicacionesCategorias.length ? esc(m.indicacionesCategorias.join(', ')) + '. ' : ''}${m.indicaciones ? esc(m.indicaciones) : ''}${!m.indicaciones && !m.indicacionesCategorias.length ? 'No figura' : ''}</dd>
        <dt>Vía de administración</dt><dd>${m.vias.length ? esc(m.vias.join(', ')) : 'No figura'}${m.presentacion ? ` · Presentación: ${esc(m.presentacion.toLowerCase())}` : ''}</dd>
        <dt>Tiempo de retiro (antes de faena)</dt><dd>${m.especies.some((e) => e.retiro) ? m.especies.filter((e) => e.retiro).map((e) => `<strong>${esc(e.especie)}:</strong> ${esc(e.retiro)}`).join('<br>') : 'No figura en el registro: consultar el prospecto y al veterinario'}</dd>
        ${restr ? `<dt>Restricciones para leche, huevos y miel</dt><dd>${restr}</dd>` : ''}
        <dt>Advertencias y contraindicaciones</dt><dd>El registro público no las detalla: leer el prospecto oficial${m.prospectos.length ? ` («${esc(m.prospectos[0])}»)` : ''} y consultar al veterinario antes de usarlo.</dd>
      </dl>
      <p class="src">Fuente: ${ext(m.fuenteUrl, m.fuente)} (buscar por N.º ${esc(m.certificado || '')}). Última modificación en el registro: ${m.ultimaModificacion ? fecha(m.ultimaModificacion.replace(' ', 'T') + '-03:00') : 's/d'}.</p>
    </article>`;
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
      <a class="btn secondary" href="#/sanidad">🐄 Enfermedades de los animales</a>`);
  }

  // ---------------- NOTICIAS ----------------
  async function pageNoticias(params) {
    setTitle('Noticias');
    const cat = params.get('cat') || '';
    const d = await api('/api/noticias?limit=40' + (cat ? '&cat=' + encodeURIComponent(cat) : ''));
    render(`${back}
      <h2 class="page-title">📰 Noticias del campo</h2>
      <p class="lead">Títulos y resúmenes breves. Tocá el título para leer la nota completa en el sitio original.</p>
      <div class="chips" role="group" aria-label="Categoría"><a class="chip${!cat ? ' active' : ''}" href="#/noticias">Todas</a>${d.categories.map((c) => `<a class="chip${c.id === cat ? ' active' : ''}" href="#/noticias?cat=${esc(c.id)}">${esc(c.label)}</a>`).join('')}</div>
      <section class="card">${d.items.length ? `<ul class="news">${d.items.map((n) => `<li>
        <a class="title" href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <div class="meta">${n.pinned ? '<span class="badge">destacada</span>' : ''}${esc(n.sourceName)} · ${fecha(n.publishedAt)}</div>
        ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}</li>`).join('')}</ul>` : '<p>No hay noticias en esta categoría por ahora.</p>'}
        ${status(d.meta)}</section>`);
  }

  // ---------------- FUENTES ----------------
  async function pageFuentes() {
    setTitle('Fuentes');
    const d = await api('/api/fuentes');
    const cada = (m) => (m >= 1440 ? `cada ${Math.round(m / 1440)} día(s)` : m >= 60 ? `cada ${Math.round(m / 60)} hora(s)` : `cada ${m} minutos`);
    render(`${back}
      <h2 class="page-title">📚 ¿De dónde sale la información?</h2>
      <p class="lead">Priorizamos organismos oficiales. Cuando usamos otra fuente, lo decimos. Si una fuente falla, mostramos el último dato con su fecha y avisamos.</p>
      <section class="card"><h3>Datos que se actualizan solos</h3>
      ${d.automaticas.map((s) => `<article class="ficha ${s.conProblemas ? 'bad' : 'good'}">
        <h3>${esc(s.nombre)}</h3>
        <p>${s.oficial ? '<span class="badge ok">Organismo oficial</span>' : '<span class="badge">Fuente profesional / privada</span>'}${!s.activa ? '<span class="badge red">desactivada</span>' : ''}${s.conProblemas ? '<span class="badge red">con problemas</span>' : ''}</p>
        <p>${esc(s.organismo)}${s.nota ? ` — ${esc(s.nota)}` : ''}<br>Se actualiza ${cada(s.cadaMin)}. Última actualización: ${s.ultimaActualizacion ? `${hace(s.ultimaActualizacion)} (${fechaHora(s.ultimaActualizacion)})` : 'todavía ninguna'}.</p>
        <p class="small">${esc(s.acceso)}${s.url ? ' · ' + ext(s.url, 'Ver fuente') : ''}</p></article>`).join('')}
      </section>
      <section class="card mt"><h3>Contenido de referencia</h3><ul>${d.contenido.map((c) => `<li>${ext(c.url, c.nombre)} — ${esc(c.uso)}</li>`).join('')}</ul>
        <p class="small">Fichas de sanidad revisadas el ${fecha(d.revisionContenido.animales)}; fichas de cultivos el ${fecha(d.revisionContenido.cultivos)}.</p></section>
      <section class="card mt"><h3>Noticias</h3><ul>${d.noticias.map((n) => `<li>${ext(n.url, n.nombre)}${n.oficial ? ' <span class="badge ok">oficial</span>' : ''}</li>`).join('')}</ul></section>
      <p class="small"><a href="/admin">Acceso de administración</a></p>`);
  }

  // ---------------- enrutador ----------------
  async function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = hash.split('?');
    const params = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean);
    const run = async () => {
      main.innerHTML = '<p class="loading">Cargando…</p>';
      try {
        if (!parts.length) return await pageHome();
        switch (parts[0]) {
          case 'clima': return await pageClima();
          case 'alertas': return await pageAlertas();
          case 'precios': return await pagePrecios();
          case 'sanidad': return parts[1] ? await pageEspecie(parts[1]) : await pageSanidad();
          case 'medicamentos': return await pageMedicamentos(params);
          case 'cultivos': return await pageCultivos(parts[1]);
          case 'noticias': return await pageNoticias(params);
          case 'fuentes': return await pageFuentes();
          default: render(`${back}<h2 class="page-title">Página no encontrada</h2>`);
        }
      } catch (e) { renderError(e, run); }
    };
    await run();
  }

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
    try {
      META = await api('/api/meta');
      const byDept = {};
      META.localities.forEach((l) => { (byDept[l.department] = byDept[l.department] || []).push(l); });
      locSel.innerHTML = Object.keys(byDept).sort((a, b) => a.localeCompare(b, 'es')).map((d) => `<optgroup label="Depto. ${esc(d)}">${byDept[d].map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</optgroup>`).join('');
      if (!META.localities.some((l) => l.id === loc())) store.set('loc', META.defaultLocality);
      locSel.value = loc();
      locSel.onchange = () => { store.set('loc', locSel.value); route(); };
    } catch (e) { /* el enrutador muestra el error */ }
    window.addEventListener('hashchange', route);
    route();
  }
  init();

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
