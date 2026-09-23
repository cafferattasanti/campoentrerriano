(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

  async function call(method, path, body) {
    const r = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'campo-admin' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/api/admin/login') { showLogin(); throw new Error(j.error || 'Sesión vencida'); }
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }

  function showLogin(msg) {
    $('panel').hidden = true;
    $('login').hidden = false;
    if (msg) { $('loginmsg').textContent = msg; $('loginmsg').hidden = false; }
  }

  async function loadEstado() {
    const d = await call('GET', '/api/admin/estado');
    $('sources').innerHTML = `<thead><tr><th>Fuente</th><th>Estado</th><th>Último OK</th><th>Último error</th><th>Próxima</th><th>Cada (min)</th><th>Acciones</th></tr></thead><tbody>${d.sources.map((s) => {
      const failing = s.last_error_at && (!s.last_success_at || s.last_error_at > s.last_success_at);
      return `<tr>
        <td><strong>${esc(s.name)}</strong><br><span class="small">${esc(s.id)}</span></td>
        <td>${!s.enabled ? '<span class="err-cell">Desactivada</span>' : s.running ? 'Actualizando…' : failing ? `<span class="err-cell">Con error (${s.consecutive_failures} seguidos)</span>` : s.last_success_at ? '<span class="ok-cell">OK</span>' : 'Sin datos aún'}${s.last_items !== null && s.last_items !== undefined ? `<br><span class="small">${s.last_items} ítems · ${s.last_duration_ms || 0} ms</span>` : ''}</td>
        <td>${when(s.last_success_at)}</td>
        <td>${s.last_error ? `${when(s.last_error_at)}<br><span class="small">${esc(s.last_error)}</span>` : '—'}</td>
        <td>${when(s.next_run_at)}</td>
        <td><input type="number" min="10" value="${esc(s.every_min || s.defaultEveryMin)}" data-int="${esc(s.id)}" aria-label="Intervalo en minutos"><button data-act="intervalo" data-id="${esc(s.id)}">Guardar</button></td>
        <td><button data-act="actualizar" data-id="${esc(s.id)}">Actualizar ahora</button><br><button data-act="${s.enabled ? 'desactivar' : 'activar'}" data-id="${esc(s.id)}">${s.enabled ? 'Desactivar' : 'Activar'}</button></td>
      </tr>`;
    }).join('')}</tbody>`;
    $('feeds').innerHTML = d.feeds.map((f) => `<p><strong>${esc(f.name)}</strong> — ${f.enabled ? '<span class="ok-cell">activa</span>' : '<span class="err-cell">desactivada</span>'} <button class="chip" data-feed="${esc(f.id)}" data-on="${f.enabled ? 'desactivar' : 'activar'}">${f.enabled ? 'Desactivar' : 'Activar'}</button></p>`).join('');
    const logs = await call('GET', '/api/admin/logs');
    $('logs').textContent = logs.logs.map((l) => `${when(l.ts)} ${l.level.toUpperCase().padEnd(5)} ${l.source || ''}: ${l.message}`).join('\n');
  }

  async function loadManual() {
    const d = await call('GET', '/api/admin/contenido');
    $('manual').innerHTML = d.items.length ? `<table class="prices admin-table"><tbody>${d.items.map((m) => `<tr><td><strong>${esc(m.title)}</strong><br><span class="small">${esc(m.type)} · ${esc(m.source_name)} · ${esc(m.content_date || '')}${m.value !== null ? ' · ' + esc(m.value) + ' ' + esc(m.unit || '') : ''}</span></td><td>${m.active ? '<span class="ok-cell">visible</span>' : 'oculto'}</td><td><button data-manual="${m.id}" data-on="${m.active ? 'desactivar' : 'activar'}">${m.active ? 'Ocultar' : 'Mostrar'}</button></td></tr>`).join('')}</tbody></table>` : '<p>No hay contenido manual.</p>';
    const n = await call('GET', '/api/admin/noticias');
    $('news').innerHTML = `<thead><tr><th>Noticia</th><th>Fuente</th><th>Acciones</th></tr></thead><tbody>${n.items.map((x) => `<tr><td><a href="${/^https?:/.test(x.url) ? esc(x.url) : '#'}" target="_blank" rel="noopener">${esc(x.title)}</a><br><span class="small">${esc(x.category || '')} · ${when(x.published_at)}</span></td><td>${esc(x.source_name)}</td><td><button data-news="${x.id}" data-on="${x.hidden ? 'mostrar' : 'ocultar'}">${x.hidden ? 'Mostrar' : 'Ocultar'}</button><br><button data-news="${x.id}" data-on="${x.pinned ? 'desfijar' : 'fijar'}">${x.pinned ? 'Quitar destacado' : 'Destacar'}</button></td></tr>`).join('')}</tbody>`;
  }

  async function loadAll() {
    $('login').hidden = true;
    $('panel').hidden = false;
    await Promise.all([loadEstado(), loadManual()]);
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.act) {
        b.disabled = true;
        const body = b.dataset.act === 'intervalo' ? { everyMin: Number(document.querySelector(`[data-int="${b.dataset.id}"]`).value) } : undefined;
        if (b.dataset.act === 'actualizar') b.textContent = 'Actualizando…';
        const r = await call('POST', `/api/admin/fuentes/${b.dataset.id}/${b.dataset.act}`, body);
        if (b.dataset.act === 'actualizar') alertMsg(r.ok ? `Actualizado: ${r.message || 'OK'}` : `Falló: ${r.error}`);
        await loadEstado();
      } else if (b.dataset.feed) {
        await call('POST', `/api/admin/feeds/${b.dataset.feed}/${b.dataset.on}`); await loadEstado();
      } else if (b.dataset.manual) {
        await call('POST', `/api/admin/contenido/${b.dataset.manual}/${b.dataset.on}`); await loadManual();
      } else if (b.dataset.news) {
        await call('POST', `/api/admin/noticias/${b.dataset.news}/${b.dataset.on}`); await loadManual();
      }
    } catch (e) { alertMsg(e.message); } finally { b.disabled = false; }
  });

  function alertMsg(t) { const p = $('manualmsg'); p.textContent = t; p.hidden = false; p.scrollIntoView({ block: 'nearest' }); setTimeout(() => { p.hidden = true; }, 8000); }

  $('loginform').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await call('POST', '/api/admin/login', { password: $('pw').value }); $('pw').value = ''; $('loginmsg').hidden = true; await loadAll(); } catch (e) { showLogin(e.message); }
  };
  $('logout').onclick = async () => { await call('POST', '/api/admin/logout').catch(() => {}); showLogin(); };
  $('refresh').onclick = () => loadAll().catch((e) => alertMsg(e.message));
  $('manualform').onsubmit = async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    const msg = $('manualmsg');
    try { await call('POST', '/api/admin/contenido', data); ev.target.reset(); msg.className = 'status'; msg.textContent = 'Guardado.'; msg.hidden = false; await loadManual(); } catch (e) { msg.className = 'status error'; msg.textContent = e.message; msg.hidden = false; }
  };
  $('newsform').onsubmit = async (ev) => {
    ev.preventDefault();
    const msg = $('newsmsg');
    try { await call('POST', '/api/admin/noticias', Object.fromEntries(new FormData(ev.target))); ev.target.reset(); msg.className = 'status'; msg.textContent = 'Noticia agregada.'; msg.hidden = false; await loadManual(); } catch (e) { msg.className = 'status error'; msg.textContent = e.message; msg.hidden = false; }
  };

  fetch('/api/admin/sesion').then((r) => r.json()).then((s) => {
    if (!s.enabled) return showLogin('El panel está deshabilitado: configurá ADMIN_PASSWORD (mínimo 10 caracteres) en el archivo .env del servidor.');
    if (s.admin) loadAll(); else showLogin();
  }).catch(() => showLogin('No se pudo conectar con el servidor.'));
})();
