/* El Campo Entrerriano — "Parte del día": una imagen lista para compartir por WhatsApp.
   Se dibuja en el mismo teléfono (canvas), sin servicios externos ni cuentas.
   Solo usa datos reales de /api/inicio; si falta un dato, se escribe "sin dato" (nunca se inventa). */
(function () {
  'use strict';
  const TZ = 'America/Argentina/Buenos_Aires';
  const WEB = 'campoentrerriano.onrender.com';
  const WEB_URL = 'https://' + WEB + '/?p=wa';
  const W = 1080, H = 1390;
  const C = { navy: '#1b2a47', paper: '#f5efe3', card: '#fffdf8', earth: '#6e4f2f', line: '#cbb99a', ink: '#161616', muted: '#4a4339', up: '#1f6b2e', down: '#9e1b1b', red: '#9e1b1b', redSoft: '#fbe9e7', yellow: '#8a6d00', yellowSoft: '#fff4c7' };
  const SERIF = 'Georgia, "Times New Roman", "Liberation Serif", serif';
  const SANS = '"Segoe UI", Roboto, "Helvetica Neue", Arial, "Liberation Sans", sans-serif';

  const num = (n, d = 0) => (n === null || n === undefined || isNaN(n) ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pesos = (n) => (n === null || n === undefined ? 'sin dato' : '$ ' + num(n));
  const dd = (iso) => { if (!iso) return ''; const d = new Date(iso.length === 10 ? iso + 'T12:00:00-03:00' : iso); if (isNaN(d)) return ''; const [y, m, dia] = d.toLocaleDateString('en-CA', { timeZone: TZ }).split('-'); return dia + '/' + m; };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

  // Versión corta para la imagen: "80 % · 25,4 mm".
  function rainImg(day) {
    if (!day) return { t: 'sin dato', fuerte: false };
    const p = day.rainProbMax, mm = day.rainMm;
    if (p === null || p === undefined) {
      if (mm === null || mm === undefined) return { t: 'sin dato', fuerte: false };
      return mm < 0.1 ? { t: 'sin lluvia prevista', fuerte: false } : { t: `${num(mm, 1)} mm (sin probab.)`, fuerte: false };
    }
    if (p === 0 || (mm !== null && mm !== undefined && mm < 0.1 && p < 20)) return { t: 'sin lluvia prevista', fuerte: false };
    return { t: `${p} %${mm ? ` · ${num(mm, 1)} mm` : ''}`, fuerte: p >= 40 && mm >= 1 };
  }
  function rainShort(day, conProb) {
    if (!day) return 'sin dato';
    const p = day.rainProbMax, mm = day.rainMm;
    if (p === null || p === undefined) {
      if (mm === null || mm === undefined) return 'sin dato';
      return mm < 0.1 ? 'sin lluvia prevista' : `${num(mm, 1)} mm${conProb === false ? ' (sin probabilidad)' : ''}`;
    }
    if (p === 0 || (mm !== null && mm !== undefined && mm < 0.1 && p < 20)) return 'sin lluvia prevista';
    return `${p}% de probabilidad${mm ? ` · ${num(mm, 1)} mm` : ''}`;
  }
  // Cuándo rige una alerta: "vigente" o "Dom 27, 9 a 15 h" (14:59 se redondea a 15 h).
  function cuando(a) {
    if (!a) return '';
    const iso = (x) => x && String(x).length > 10;
    if (a.kind === 'temperatura') return 'vigente';
    const ahora = Date.now();
    if (!iso(a.from) && !iso(a.to)) {
      if (!a.from) return '';
      const dia = (x) => { const d = new Date(x + 'T12:00:00-03:00'); return cap(d.toLocaleDateString('es-AR', { timeZone: TZ, weekday: 'short' }).replace('.', '')) + ' ' + d.toLocaleDateString('es-AR', { timeZone: TZ, day: 'numeric' }); };
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
      if (a.from <= hoy && (!a.to || a.to >= hoy)) return 'vigente';
      return a.to && a.to !== a.from ? `${dia(a.from)} a ${dia(a.to)}` : dia(a.from);
    }
    const f = a.from ? Date.parse(a.from) : null, t = a.to ? Date.parse(a.to) : null;
    if ((f === null || f <= ahora) && (t === null || t > ahora)) return 'vigente';
    const partes = (ms) => {
      const d = new Date(ms);
      let h = Number(d.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }));
      const m = Number(d.toLocaleString('en-US', { timeZone: TZ, minute: 'numeric' }));
      let dm = ms;
      if (m >= 59) { h += 1; dm = ms + 60e3; }
      const d2 = new Date(dm);
      if (h === 24) h = 0;
      const dia = cap(d2.toLocaleDateString('es-AR', { timeZone: TZ, weekday: 'short' }).replace('.', '')) + ' ' + d2.toLocaleDateString('es-AR', { timeZone: TZ, day: 'numeric' });
      return { dia, h: m > 0 && m < 59 ? `${h}:${String(m).padStart(2, '0')}` : String(h) };
    };
    const A = f !== null ? partes(f) : null, B = t !== null ? partes(t) : null;
    if (A && B) return A.dia === B.dia ? `${A.dia}, ${A.h} a ${B.h} h` : `${A.dia} ${A.h} h a ${B.dia} ${B.h} h`;
    if (A) return `desde ${A.dia}, ${A.h} h`;
    return `hasta ${B.dia}, ${B.h} h`;
  }
  // Fuente real del dato de río que se muestra (Prefectura o Hidráulica).
  function fuenteRio(r) {
    const f = (r && r.fuente) || '';
    return /prefectura/i.test(f) ? 'Prefectura Naval' : /hidr[aá]ulica/i.test(f) ? 'Hidráulica ER' : '';
  }
  function rioTitulo(r) {
    if (!r) return 'Río';
    return r.titulo || r.label || 'Río';
  }

  function rioTxt(r) {
    if (!r || r.missing || r.height === null || r.height === undefined) return null;
    const t = r.state === 'CRECE' ? 'crece' : r.state === 'BAJA' ? 'baja' : r.state === 'ESTAC' ? 'estacionario' : '';
    return { h: num(r.height, 2) + ' m', dir: r.state === 'CRECE' ? 1 : r.state === 'BAJA' ? -1 : 0, t: t + (r.variation && r.state !== 'ESTAC' ? ' ' + num(Math.abs(r.variation), 2) + ' m' : ''), when: dd(r.at) };
  }

  // ---------- dibujo ----------
  function tri(ctx, x, y, s, dir, color) {
    ctx.fillStyle = color; ctx.beginPath();
    if (dir > 0) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s / 2, y); }
    else { ctx.moveTo(x, y); ctx.lineTo(x + s, y); ctx.lineTo(x + s / 2, y + s); }
    ctx.closePath(); ctx.fill();
  }
  function text(ctx, s, x, y, font, color, align) { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y); }
  function fit(ctx, s, font, max) { ctx.font = font; if (ctx.measureText(s).width <= max) return s; while (s.length > 3 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; }
  function rule(ctx, y, x0 = 60, x1 = W - 60, color = C.line, w = 2) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
  function varBadge(ctx, v, xRight, y) {
    if (!v || v.pct === null || v.pct === undefined) return;
    if (Math.abs(v.pct) < 0.05) { text(ctx, '= sin cambio', xRight, y, `600 30px ${SANS}`, C.muted, 'right'); return; }
    const up = v.pct > 0, col = up ? C.up : C.down, s = num(Math.abs(v.pct), 1) + ' %';
    ctx.font = `700 34px ${SANS}`; const w = ctx.measureText(s).width;
    text(ctx, s, xRight, y, `700 34px ${SANS}`, col, 'right');
    tri(ctx, xRight - w - 34, y - 25, 24, up ? 1 : -1, col);
  }

  function draw(d) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);

    // Cabecera
    ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, 190);
    text(ctx, 'EL CAMPO ENTRERRIANO', W / 2, 88, `700 62px ${SERIF}`, '#fff', 'center');
    const now = new Date();
    const fechaLarga = cap(now.toLocaleDateString('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }));
    const hora = now.toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    text(ctx, `PARTE DEL DÍA · ${d.locality.name.toUpperCase()}`, W / 2, 140, `700 32px ${SANS}`, '#e8dcc6', 'center');
    text(ctx, `${fechaLarga} · ${hora} h`, W / 2, 176, `400 28px ${SANS}`, '#e8dcc6', 'center');

    let y = 250;
    const hayAviso = (d.avisos && d.avisos.length) || (d.alertas && d.alertas.count);
    if (!hayAviso) y += 45;
    // Aviso rojo/amarillo o alerta oficial (si hay)
    const av = (d.avisos || [])[0];
    const al = d.alertas && d.alertas.count ? d.alertas.top[0] : null;
    if (av || al) {
      const rojo = (av && av.level === 'rojo') || (al && /roj|naranj/i.test(al.levelName || ''));
      ctx.fillStyle = rojo ? C.redSoft : C.yellowSoft; ctx.fillRect(60, y - 44, W - 120, 70);
      ctx.fillStyle = rojo ? C.red : C.yellow; ctx.fillRect(60, y - 44, 10, 70);
      const q = al ? cuando(al) : '';
      const msg = al ? `Alerta SMN: ${al.event} (${String(al.levelName || '').toLowerCase()})${q ? ' · ' + q : ''}` : av.title;
      text(ctx, fit(ctx, msg, `700 32px ${SANS}`, W - 170), 92, y + 2, `700 32px ${SANS}`, rojo ? C.red : C.yellow);
      y += 70;
    }

    // Hacienda
    text(ctx, 'HACIENDA', 60, y, `700 30px ${SANS}`, C.earth);
    text(ctx, '$ por kg vivo', W - 60, y, `400 26px ${SANS}`, C.muted, 'right');
    rule(ctx, y + 16, 60, W - 60, C.earth, 3);
    y += 16;
    const h = d.hacienda || {};
    const rows = [
      ['Novillo', h.novillo, (x) => `Cañuelas · remate ${dd(x.date)}`],
      ['Vaca', h.vaca, (x) => `Cañuelas · remate ${dd(x.date)}`],
      ['Ternero', h.ternero, (x) => `ROSGAN · remate mensual ${dd(x.date)}`],
    ];
    for (const [name, x, sub] of rows) {
      y += 94;
      text(ctx, name, 60, y - 18, `700 44px ${SERIF}`, C.ink);
      text(ctx, x ? sub(x) + (x.stale ? ' · dato viejo' : '') : 'todavía sin dato', 60, y + 20, `400 25px ${SANS}`, C.muted);
      text(ctx, x ? pesos(Math.round(x.value)) : '—', 760, y, `700 60px ${SANS}`, C.navy, 'right');
      if (x) varBadge(ctx, x.variation, W - 60, y - 6);
      rule(ctx, y + 40);
    }

    // Dólar + granos
    y += 100;
    const dol = d.dolar && d.dolar.oficial;
    text(ctx, 'DÓLAR BNA', 60, y, `700 30px ${SANS}`, C.earth);
    text(ctx, dol ? `$ ${num(dol.venta)}` : 'sin dato', 60, y + 58, `700 52px ${SANS}`, C.navy);
    if (dol) text(ctx, `venta · compra $ ${num(dol.compra)}`, 60, y + 94, `400 25px ${SANS}`, C.muted);
    const g = d.granos && d.granos.items ? d.granos.items.filter((i) => ['soja', 'maiz', 'trigo'].includes(i.key)) : [];
    text(ctx, 'GRANOS ROSARIO · $/t', 470, y, `700 30px ${SANS}`, C.earth);
    g.slice(0, 3).forEach((i, k) => {
      const yy = y + 44 + k * 38;
      text(ctx, i.product.replace(/\s*\(.*\)/, ''), 470, yy, `400 30px ${SANS}`, C.ink);
      text(ctx, i.sinCotizacion && !i.estimated ? 'S/C' : pesos(Math.round(i.value)) + (i.estimated ? '*' : ''), W - 60, yy, `700 30px ${SANS}`, C.navy, 'right');
    });
    if (!g.length) text(ctx, 'sin dato', 470, y + 44, `400 30px ${SANS}`, C.muted);
    y += 150;
    rule(ctx, y - 12, 60, W - 60, C.earth, 3);

    // Clima
    const c = d.clima || {};
    text(ctx, `CLIMA · ${d.locality.name.toUpperCase()}`, 60, y + 34, `700 30px ${SANS}`, C.earth);
    const dia = (lbl, x, x0) => {
      text(ctx, lbl, x0, y + 84, `700 34px ${SANS}`, C.ink);
      ctx.font = `700 34px ${SANS}`; const w = ctx.measureText(lbl).width;
      text(ctx, x ? `${num(x.tMin)}° / ${num(x.tMax)}°` : '—', x0 + w + 20, y + 84, `700 34px ${SANS}`, C.navy);
      text(ctx, fit(ctx, x ? cap(x.summary || '') : 'sin dato', `400 28px ${SANS}`, 440), x0, y + 122, `400 28px ${SANS}`, C.ink);
      const rr = rainImg(x);
      text(ctx, fit(ctx, 'Lluvia: ' + rr.t, `${rr.fuerte ? 700 : 400} 28px ${SANS}`, 440), x0, y + 160, `${rr.fuerte ? 700 : 400} 28px ${SANS}`, rr.fuerte ? C.red : C.ink);
    };
    dia('Hoy', c.today, 60);
    dia('Mañana', c.tomorrow, 560);
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(530, y + 58); ctx.lineTo(530, y + 170); ctx.stroke();
    y += 192;
    rule(ctx, y);

    // Río
    const rm = d.rio && d.rio.main;
    const r = rioTxt(rm);
    const tit = rioTitulo(rm).replace(' en ', ' · ').toUpperCase();
    text(ctx, fit(ctx, tit, `700 30px ${SANS}`, rm && rm.km && rm.relacion !== 'propio' ? 640 : W - 120), 60, y + 50, `700 30px ${SANS}`, C.earth);
    if (rm && rm.km && rm.relacion !== 'propio') text(ctx, `estación más cercana · ${rm.km} km`, W - 60, y + 50, `400 24px ${SANS}`, C.muted, 'right');
    if (r) {
      text(ctx, r.h, 60, y + 108, `700 52px ${SANS}`, C.navy);
      ctx.font = `700 52px ${SANS}`; const w = ctx.measureText(r.h).width;
      if (r.dir) tri(ctx, 60 + w + 24, y + 72, 30, r.dir, r.dir > 0 ? C.red : C.up);
      text(ctx, `${r.t}${r.when ? ` · lectura ${r.when}` : ''}`, 60 + w + (r.dir ? 70 : 24), y + 104, `400 30px ${SANS}`, C.ink);
    } else text(ctx, 'sin dato reciente', 60, y + 104, `400 30px ${SANS}`, C.muted);

    // Pie
    ctx.fillStyle = C.navy; ctx.fillRect(0, H - 160, W, 160);
    text(ctx, 'Todo actualizado en', W / 2, H - 110, `400 28px ${SANS}`, '#e8dcc6', 'center');
    text(ctx, WEB, W / 2, H - 66, `700 42px ${SANS}`, '#fff', 'center');
    const fr = r ? fuenteRio(rm) : '';
    text(ctx, fit(ctx, 'Fuentes: Mercado Agroganadero · ROSGAN · BNA · Bolsa de Rosario · Open-Meteo' + (fr ? ' · ' + fr : ''), `400 21px ${SANS}`, W - 60), W / 2, H - 24, `400 21px ${SANS}`, '#cbb99a', 'center');
    return cv;
  }

  // Texto para acompañar la imagen (o para mandar solo texto).
  function resumen(d) {
    const h = d.hacienda || {};
    const v = (x) => (x && x.variation && x.variation.pct !== null && x.variation.pct !== undefined ? ` (${x.variation.pct > 0 ? '▲' : x.variation.pct < 0 ? '▼' : '='} ${num(Math.abs(x.variation.pct), 1)}%)` : '');
    const p = (n, x) => `${n}: ${x ? pesos(Math.round(x.value)) + '/kg' + v(x) : 'sin dato'}`;
    const c = d.clima || {};
    const conProb = c.modelo ? c.modelo.conProbabilidad : null;
    const rm = d.rio && d.rio.main;
    const r = rioTxt(rm);
    const g = (d.granos && d.granos.items ? d.granos.items : []).filter((i) => ['soja', 'maiz', 'trigo'].includes(i.key));
    const granos = g.length ? 'Granos Rosario ($/t): ' + g.map((i) => `${i.product.replace(/\s*\(.*\)/, '')} ${i.sinCotizacion && !i.estimated ? 'S/C' : pesos(Math.round(i.value)) + (i.estimated ? ' (estimativo)' : '')}`).join(' · ') : 'Granos Rosario: sin dato';
    const fechaCorta = dd(new Date().toISOString());
    return [
      `*Parte del día · ${d.locality.name} (${fechaCorta})*`,
      p('Novillo', h.novillo), p('Vaca', h.vaca), p('Ternero', h.ternero) + (h.ternero ? ' · ROSGAN' : ''),
      `Dólar BNA: ${d.dolar && d.dolar.oficial ? '$ ' + num(d.dolar.oficial.venta) : 'sin dato'}`,
      granos,
      `Lluvia hoy: ${rainShort(c.today, conProb)} · mañana: ${rainShort(c.tomorrow, conProb)}`,
      `${rioTitulo(rm)}${rm && rm.km && rm.relacion !== 'propio' ? ` (estación más cercana, a ${rm.km} km)` : ''}: ${r ? r.h + (r.t ? ', ' + r.t : '') : 'sin dato'}${r && fuenteRio(rm) ? ' · ' + fuenteRio(rm) : ''}`,
      `Más en ${WEB_URL}`,
    ].join('\n');
  }

  function evento(a) { try { fetch('/api/parte?a=' + a, { cache: 'no-store' }).catch(() => {}); } catch (e) { /* nada */ } }

  // ---------- ventana de vista previa ----------
  async function abrir(loc) {
    const prev = document.getElementById('parte-modal'); if (prev) prev.remove();
    const m = document.createElement('div');
    m.id = 'parte-modal'; m.className = 'parte-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Parte del día para compartir');
    m.innerHTML = '<div class="parte-box"><p class="loading">Armando el parte del día…</p></div>';
    document.body.appendChild(m);
    const cerrar = () => { m.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', esc);
    m.addEventListener('click', (e) => { if (e.target === m) cerrar(); });
    const box = m.firstChild;
    let d;
    try {
      const r = await fetch('/api/inicio?loc=' + encodeURIComponent(loc), { headers: { Accept: 'application/json' } });
      d = await r.json(); if (!r.ok) throw new Error(d.error || 'Error');
    } catch (e) {
      box.innerHTML = '<p class="status error">No se pudieron cargar los datos. Revisá la conexión.</p><button class="btn secondary" type="button" id="parte-x">Cerrar</button>';
      document.getElementById('parte-x').onclick = cerrar; return;
    }
    const h0 = d.hacienda || {};
    if (!h0.novillo && !h0.vaca && !h0.ternero) {
      box.innerHTML = '<p class="status warn">Todavía no hay precios de hacienda cargados para armar el parte. Probá de nuevo en un rato.</p><button class="btn secondary" type="button" id="parte-x">Cerrar</button>';
      document.getElementById('parte-x').onclick = cerrar; return;
    }
    const cv = draw(d);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    const nombre = 'parte-del-dia-' + new Date().toLocaleDateString('en-CA', { timeZone: TZ }) + '.png';
    const file = blob ? new File([blob], nombre, { type: 'image/png' }) : null;
    const texto = resumen(d);
    const puedeArchivo = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    const urlImg = URL.createObjectURL(blob);
    box.innerHTML = `<h2 class="parte-t">📲 Parte del día</h2>
      <img class="parte-img" src="${urlImg}" alt="Imagen del parte del día con precios de hacienda, dólar, granos, clima y río.">
      ${puedeArchivo ? '<button class="btn wa" type="button" id="parte-share">Compartir imagen (WhatsApp)</button>' : ''}
      <a class="btn wa${puedeArchivo ? ' secondary' : ''}" id="parte-texto" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener noreferrer">Enviar como texto por WhatsApp</a>
      <a class="btn secondary" id="parte-dl" href="${urlImg}" download="${nombre}">Descargar imagen</a>
      <button class="btn secondary" type="button" id="parte-x">Cerrar</button>
      <p class="small muted">${puedeArchivo ? 'Al tocar «Compartir imagen», elegí WhatsApp y el grupo o contacto.' : 'En la computadora: descargá la imagen y adjuntala en WhatsApp Web, o mandá el texto.'}</p>`;
    document.getElementById('parte-x').onclick = () => { URL.revokeObjectURL(urlImg); cerrar(); };
    document.getElementById('parte-dl').onclick = () => evento('descargar');
    document.getElementById('parte-texto').onclick = () => evento('texto');
    const sh = document.getElementById('parte-share');
    if (sh) sh.onclick = async () => {
      try { await navigator.share({ files: [file], text: texto }); evento('compartir'); }
      catch (e) { if (e && e.name !== 'AbortError') { try { await navigator.share({ files: [file] }); evento('compartir'); } catch (e2) { /* cancelado */ } } }
    };
    (sh || document.getElementById('parte-texto')).focus();
  }

  window.CampoParte = { abrir, draw, resumen, cuando };
  // Visita que llega desde un parte compartido por WhatsApp (solo se cuenta el total).
  if (/[?&]p=wa\b/.test(location.search)) { evento('llegada'); try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* nada */ } }
})();
