var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * situations.js — C150.Situations: "Situaciones prácticas" inside VOLAR (contract v3). Data: C150.DATA.situations
 * (data/situations.js). ui.js mounts it with the same guarded helpers it gives lab.js (no Core call here throws).
 *
 *   C150.Situations.mount(container, api)   builds the section once (cards → briefing → live run → debrief)
 *   C150.Situations.frame(state, dt)        every frame (ui.js frame hook): durante() + check(), finishes on ok / fail
 *   C150.Situations.slow(state)             ≈ 15 Hz: live UI (progress, coaching message, HUD, pad)
 *   C150.Situations.active() → bool          a situation is running (briefing excluded)
 *   C150.Situations.stop(reason?)           ends the running one (teardown: failures cleared, sim un-paused)
 *   C150.Situations.onPreset(name)          a sim preset was applied by someone else → the run is aborted
 *   C150.Situations.open(id)                opens that situation's briefing
 *
 * api (from ui.js): { h, icon, setText, setAttr, toggleClass, safe, store, cc, has, S, applyPreset, kick, showToast,
 *   buildHud(live), flightPad(live), probalo(id, live), focusControl(id), CTRL, progressBar, reducedMotion,
 *   scrollPanelTop, releaseAllHolds, stopMission, now }
 *
 * Decisions:
 *  - Start = applyPreset(preset) + setup(state) + sim un-paused; ctx = { t, dt, hold, data:{} } fresh per attempt.
 *  - check() runs every frame while not paused; the first ok / fail result ends the run: the sim is PAUSED so the
 *    debrief can be read calmly, and un-paused (failures cleared) when the student leaves the debrief.
 *  - Mandos: ids already in the flight pad (acelerador, mezcla, calefacción, flaps, compensador, volante, pedales)
 *    only get a "Mostrámelo" chip; instruments too; the rest (puertas, master, luces, llave, combustible, cebador,
 *    traba) get their Probalo widget so the student can act from the panel as well as in 3D.
 */
(function (C150) {
  'use strict';
  if (typeof document === 'undefined') return;

  var SIT = (C150.DATA && Array.isArray(C150.DATA.situations)) ? C150.DATA.situations.filter(function (x) {
    return x && x.id && typeof x.check === 'function' && typeof x.setup === 'function';
  }) : [];
  var FAILS = (C150.DATA && Array.isArray(C150.DATA.situationFailures)) ? C150.DATA.situationFailures : [];
  var IN_PAD = { throttle: 1, mixture: 1, 'carb-heat': 1, 'flap-switch': 1, 'trim-wheel': 1, yoke: 1, 'rudder-pedals': 1 };
  var TIPO = { emergencia: 'Emergencia', anormal: 'Anormal', 'en tierra': 'En tierra' };

  // by type (stable): S1, S2… follow the order of the sections of the list
  (function () {
    var ord = { 'en tierra': 0, anormal: 1, emergencia: 2 };
    var tmp = SIT.map(function (x, i) { return [x, i]; }).sort(function (a, b) { return ((ord[a[0].tipo] === undefined ? 1 : ord[a[0].tipo]) - (ord[b[0].tipo] === undefined ? 1 : ord[b[0].tipo])) || (a[1] - b[1]); });
    tmp.forEach(function (t, i) { SIT[i] = t[0]; });
  })();

  var A = null;                 // api from ui.js
  var V = null;                 // container
  var R = {                     // runtime
    phase: 'lista',             // 'lista' | 'brief' | 'run' | 'fin'
    x: null, ctx: null, res: null, live: [], pista: 0, starting: false, best: {}, pausedByUs: false,
    els: null
  };

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function byId(id) { for (var i = 0; i < SIT.length; i++) if (SIT[i].id === id) return SIT[i]; return null; }
  function senales(x) { return Array.isArray(x['señales']) ? x['señales'] : (Array.isArray(x.senales) ? x.senales : []); }
  function runLive(s) {
    for (var i = 0; i < R.live.length; i++) {
      try { R.live[i](s); } catch (e) { if (root.console) console.error('[Situaciones] live', e); R.live.splice(i, 1); i--; }
    }
  }

  /* ------------------------------------------------------------------ teardown / failures */
  function clearFailures() {
    var s = A && A.S();
    if (!s || !s.failures) return;
    var act = C150.Sim && C150.Sim.actions;
    FAILS.forEach(function (n) {
      if (!s.failures[n]) return;
      if (act && typeof act.fail === 'function') A.safe(function () { act.fail(s, n, false); }, 'fail off');
      else s.failures[n] = false;
    });
  }
  function unpause() {
    if (!R.pausedByUs) return;
    R.pausedByUs = false;
    var s = A.S();
    if (s && s.paused) { if (A.has('setPaused')) A.cc('setPaused', false); else s.paused = false; }
  }
  function teardown() {
    A.releaseAllHolds();
    clearFailures();
    unpause();
  }

  /* ------------------------------------------------------------------ flow */
  /** User-level (contract v6): list → briefing is a history entry 'volar/<id>' (Back / UP return to the list). */
  function openNav(id) {
    if (A && A.navDetail) A.navDetail('volar/' + id, function () { open(id); });
    else open(id);
  }
  function open(id) {
    var x = byId(id);
    if (!x) return;
    if (R.phase === 'run') stop();
    R.x = x; R.phase = 'brief'; R.res = null; R.pista = 0;
    render(true);
  }
  function start() {
    var x = R.x;
    if (!x) return;
    if (A.stopMission) A.safe(A.stopMission, 'stopMission');
    teardown();
    R.starting = true;
    try { A.applyPreset(x.preset || 'cruise'); } finally { R.starting = false; }
    var s = A.S();
    if (s) A.safe(function () { x.setup(s); }, 'setup ' + x.id);
    if (s && s.paused) { if (A.has('setPaused')) A.cc('setPaused', false); else s.paused = false; }
    R.ctx = { t: 0, dt: 0, hold: 0, data: {} };
    R.res = { progress: 0, ok: false, fail: false, mensaje: 'Empezó. Volá el avión y prestá atención…' };
    R.phase = 'run'; R.pista = 0;
    render(true);
    A.kick();
  }
  function finish(r) {
    R.res = r;
    R.phase = 'fin';
    R.ctx.final = R.ctx.t;
    if (r.ok) {
      R.best[R.x.id] = true;
      A.store.set('situationsDone', R.best);
      A.showToast({ text: '¡Situación resuelta: ' + (R.x.titulo || '') + '!', kind: 'good' });
    }
    var s = A.S();
    if (s && !s.paused) {                       // freeze the airplane so the debrief can be read calmly
      R.pausedByUs = true;
      if (A.has('setPaused')) A.cc('setPaused', true); else s.paused = true;
    }
    A.releaseAllHolds();
    render(true);
  }
  /** Leaves the run / debrief: failures cleared and the sim running again. */
  function stop(reason) {
    if (R.phase === 'run' || R.phase === 'fin') teardown();
    R.phase = R.x ? 'brief' : 'lista';
    if (reason) A.showToast({ text: reason, kind: 'info' });
    render(false);
  }
  function backToList() {
    if (R.phase === 'run' || R.phase === 'fin') teardown();
    R.phase = 'lista'; R.x = null; R.res = null;
    render(true);
  }

  /* ------------------------------------------------------------------ rendering */
  /** "Mostrámelo" (MIRAR: only the camera moves) + a small "ficha" button (ABRIR: the control's card, with a way back to this situation). */
  function chipFocus(id) {
    var c = A.CTRL[id];
    if (!c) return null;
    var look = A.h('button', { type: 'button', class: 'chip', title: 'Mostrámelo en 3D', onclick: function () { A.focusControl(id); } }, A.icon('target'), c.nombre);
    if (!A.showControl) return look;
    var card = A.h('button', { type: 'button', class: 'chip chip--ficha', 'aria-label': 'Ver la ficha de ' + c.nombre, title: 'Ver la ficha: ' + c.nombre,
      onclick: function () { A.showControl(id); } }, A.icon('cabin'));
    return A.h('span', { class: 'chip-pair' }, look, card);
  }
  function tipoBadge(x) {
    var t = x.tipo || 'anormal';
    return A.h('span', { class: 'sit-tipo sit-tipo--' + t.replace(/\s+/g, '-'), text: TIPO[t] || t });
  }

  /* Visual alignment with the rest of the app (contract v4 U4): every helper below comes from ui.js through the api and has a plain fallback. */
  var NIVEL = { 'en tierra': 1, anormal: 2, emergencia: 3 };
  function nivelOf(x) { return NIVEL[x.tipo || 'anormal'] || 2; }
  function ico(name) { return (A.kic ? A.kic(name) : A.icon(name)); }
  function practicas(x) {
    var names = [];
    (Array.isArray(x.mandos) ? x.mandos : []).forEach(function (id) { var c = A.CTRL[id]; if (c && names.length < 3) names.push(c.nombre); });
    return names.length ? names.join(' · ') : '';
  }
  function callout(variant, title, text) {
    if (A.callK) return A.callK(variant, title, text);
    return A.h('aside', { class: 'callout callout--' + variant }, A.h('h3', { class: 'placard', text: title }), A.h('p', { text: text }));
  }
  function fold(title, content, open) {
    if (A.acc) return A.acc(title, content, { open: !!open });
    var d = A.h('details', { class: 'fold' }, A.h('summary', null, title), content);
    if (open) d.open = true;
    return d;
  }
  function head(n, title, meta) { return A.sectHead ? A.sectHead(n, title, meta) : A.h('h3', { class: 'placard placard--small block-title', text: title }); }

  /* v5 · V3 — el lenguaje de AIRE: secciones numeradas por tipo (En tierra · Algo anormal · Emergencias), tarjetas con código S1…, el "runner" para
   * la presentación, la situación en curso y el repaso, y barras vivas. Los helpers vienen de ui.js (secK, runnerEl, cardDone…). */
  var GRUPOS = [['en tierra', 'En tierra'], ['anormal', 'Algo anormal'], ['emergencia', 'Emergencias']];
  function codeOf(x) { return 'S' + (SIT.indexOf(x) + 1); }
  function tipoLabel(x) { return TIPO[x.tipo || 'anormal'] || x.tipo || 'Anormal'; }
  function secs(list) { list.forEach(function (s, i) { V.appendChild(A.secK(i + 1, s[0], s[1], s[2], s[3], s[4])); }); }
  function bullets(arrx) { var ul = A.h('ul', { class: 'bullets' }); arrx.forEach(function (t) { ul.appendChild(A.h('li', { text: t })); }); return ul; }

  function renderList() {
    var h = A.h, K = C150.Kit;
    V.appendChild(h('p', { class: 'sit-intro', text: 'Cosas que pueden pasar en un vuelo y qué hacés. No es teoría: el avión las vive en el simulador y vos actuás con los mandos (los botones de acá, el teclado o la cabina 3D).' }));
    if (!SIT.length) { V.appendChild(h('p', { class: 'empty', text: 'Las situaciones todavía no están cargadas.' })); return; }
    var doneN = SIT.filter(function (x) { return !!R.best[x.id]; }).length, nextIdx = -1;
    for (var q = 0; q < SIT.length; q++) if (!R.best[SIT[q].id]) { nextIdx = q; break; }
    if (A.pgBar) V.appendChild(h('div', { class: 'lc-prog' }, A.pgBar(doneN / SIT.length, doneN + ' de ' + SIT.length + ' resueltas', doneN === SIT.length)));
    var list = [];
    GRUPOS.forEach(function (g) {
      var idxs = [];
      SIT.forEach(function (x, i) { var t = x.tipo || 'anormal'; if (t === g[0] || (g[0] === 'anormal' && !TIPO[t])) idxs.push(i); });
      if (!idxs.length) return;
      var items = idxs.map(function (i) {
        var x = SIT[i], pr = practicas(x);
        return { code: 'S' + (i + 1), title: x.titulo, sum: x.contexto || '', meta: tipoLabel(x) + (pr ? ' · ' + pr : ''),
          tag: i === nextIdx ? (doneN ? 'Siguiente' : 'Empezá acá') : null, onClick: function () { openNav(x.id); } };
      });
      var ul = K.cardCarousel({ items: items, list: true, label: 'Situaciones: ' + g[1].toLowerCase() }), hechas = 0;
      idxs.forEach(function (i, k) { if (R.best[SIT[i].id]) { hechas++; A.cardDone(ul, k); } });
      list.push([g[1], hechas + '/' + idxs.length + ' resueltas', ul, 'sit-g-' + g[0], true]);
    });
    secs(list);
    V.appendChild(callout('cuidado', 'Para practicar', 'Procedimientos según el POH del 150M, simplificados. En el avión mandan el manual, la checklist de tu escuela y el instructor.'));
  }

  function renderBrief() {
    var h = A.h, x = R.x, pr = practicas(x);
    var Rn = A.runnerEl({ cls: 'sit-runner sit-brief', titleId: 'sit-title', kicker: 'Situación ' + codeOf(x) + ' · ' + tipoLabel(x), count: A.DIFF_TXT[nivelOf(x)],
      closeLabel: 'Volver a las situaciones', onClose: backToList, frac: 0, title: x.titulo, text: x.contexto });
    Rn.appendChild(callout('tip', 'Tu objetivo', x.objetivo));
    if (pr) Rn.appendChild(h('p', { class: 'sit-practicas sit-practicas--big' }, ico('target'), h('span', null, h('b', { text: 'Qué practicás: ' }), pr)));
    Rn.appendChild(h('div', { class: 'runner-nav sit-nav' },
      h('button', { type: 'button', class: 'btn', onclick: backToList }, 'Elegir otra'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: start }, A.icon('play'), 'Empezar')));
    Rn.appendChild(h('p', { class: 'ctl-sub', text: 'Al empezar, el avión se pone en el escenario y la situación arranca. Tomate tu tiempo: primero, siempre, volar el avión.' }));
    V.appendChild(Rn);
    var sen = senales(x);
    if (sen.length) secs([['Qué vas a notar', sen.length + (sen.length === 1 ? ' señal' : ' señales'), bullets(sen), 'sit-b-sen', true]]);
  }

  function renderRun() {
    var h = A.h, x = R.x, K = C150.Kit;
    var Rn = A.runnerEl({ cls: 'sit-runner sit-run', titleId: 'sit-title', kicker: 'Situación ' + codeOf(x) + ' · en curso', count: '0:00', closeLabel: 'Salir de la situación',
      onClose: function () { stop(); }, frac: 0, title: x.titulo, text: '' });
    var fill = Rn.querySelector('.runner-prog > span'), count = Rn.querySelector('.runner-count');
    var msg = h('p', { class: 'sit-msg', role: 'status', 'aria-live': 'polite' });
    var bars = K && K.bars ? K.bars({ rows: [{ key: 'p', label: 'Avance', color: 'var(--accent)' }] }) : null;
    R.live.push(function () {
      var r = R.res || {}, f = clamp01(num(r.progress, 0)), p = Math.round(f * 100) + ' %';
      if (fill) fill.style.width = (f * 100).toFixed(1) + '%';
      A.setText(count, clockOf(R.ctx ? R.ctx.t : 0));
      A.setText(msg, r.mensaje || '');
      if (bars) bars.set('p', f, p);
    });
    Rn.appendChild(callout('tip', 'Objetivo', x.objetivo));
    Rn.appendChild(h('div', { class: 'cl-now sit-now' }, h('p', { class: 'cl-now-k' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Ahora'), msg, bars));
    Rn.appendChild(h('div', { class: 'runner-nav sit-nav' },
      h('button', { type: 'button', class: 'btn', onclick: function () { stop(); } }, 'Salir'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: start }, A.icon('retry'), 'Empezar de nuevo')));
    V.appendChild(Rn);

    var pistas = Array.isArray(x.pistas) ? x.pistas : [];
    var pl = h('ol', { class: 'steps sit-pistas' });
    var pbtn = h('button', { type: 'button', class: 'btn btn--small' }, 'Dame una pista');
    function fillPistas() {
      while (pl.firstChild) pl.removeChild(pl.firstChild);
      for (var i = 0; i < R.pista && i < pistas.length; i++) pl.appendChild(h('li', { text: pistas[i] }));
      pbtn.hidden = R.pista >= pistas.length;
      A.setText(pbtn, R.pista ? 'Otra pista (' + R.pista + ' de ' + pistas.length + ')' : 'Dame una pista');
    }
    pbtn.addEventListener('click', function () { R.pista = Math.min(pistas.length, R.pista + 1); fillPistas(); });
    fillPistas();

    // the controls for this situation
    var mandos = Array.isArray(x.mandos) ? x.mandos : [];
    var chips = h('div', { class: 'chips' });
    var widgets = h('div', { class: 'sit-widgets' });
    mandos.forEach(function (id) {
      var c = A.CTRL[id];
      if (!c) return;
      chips.appendChild(chipFocus(id));
      if (IN_PAD[id] || !c.probar) return;
      var w = A.probalo(id, R.live);
      if (w) widgets.appendChild(h('div', { class: 'sit-widget' }, h('h4', { class: 'sit-widget-name', text: c.nombre }), w));
    });
    var sen = senales(x), list = [];
    if (sen.length) list.push(['Qué notás', sen.length + (sen.length === 1 ? ' señal' : ' señales'), bullets(sen), 'sit-r-sen', false]);
    if (pistas.length) list.push(['Pistas', pistas.length + (pistas.length === 1 ? ' pista' : ' pistas'), h('div', { class: 'sit-pistas-box' }, pl, pbtn), 'sit-r-pis', true]);
    list.push(['Mandos de esta situación', 'tocá para ver', h('div', null, h('p', { class: 'ctl-sub', text: 'Tocá un nombre para que la cámara te lo muestre en la cabina.' }), chips, widgets.firstChild ? widgets : null), 'sit-r-man', true]);
    list.push(['Instrumentos', 'en vivo', A.buildHud(R.live), 'sit-r-ins', true]);
    list.push(['Mandos de vuelo', 'para volar', A.flightPad(R.live), 'sit-r-pad', true]);
    secs(list);
  }

  function renderFin() {
    var h = A.h, x = R.x, r = R.res || {};
    var t = R.ctx ? num(R.ctx.final, R.ctx.t) : 0;
    var nx = -1;
    for (var k = 0; k < SIT.length; k++) if (SIT[k].id !== x.id && !R.best[SIT[k].id]) { nx = k; break; }
    var sg = [];
    if (!r.ok) sg.push({ primary: true, icon: 'retry', title: 'Probar de nuevo', text: 'Con lo que viste, ahora sale', onClick: start });
    if (nx >= 0) sg.push({ primary: !!r.ok, icon: 'flag', title: 'Situación: ' + (SIT[nx].titulo || ''), text: practicas(SIT[nx]) ? 'Practicás: ' + practicas(SIT[nx]) : '', onClick: function () { openNav(SIT[nx].id); } });
    else if (r.ok) sg.push({ primary: true, icon: 'quiz', title: 'Quiz rápido', text: 'Probá lo que aprendiste', onClick: function () { stop(); backToList(); if (A.go) A.go('quiz'); } });
    if (r.ok) sg.push({ icon: 'retry', title: 'Otra vez', text: 'Para hacerlo más prolijo', onClick: start });
    sg.push({ icon: 'plane', title: 'Seguir volando libre', text: 'Misiones, instrumentos y mandos', onClick: function () { stop(); backToList(); if (A.showPractice) A.showPractice(); } });
    var Rn = A.runnerEl({ cls: 'sit-runner sit-debrief ' + (r.ok ? 'is-ok' : 'is-fail'), titleId: 'sit-title', kicker: 'Repaso · ' + codeOf(x) + ' · ' + x.titulo, count: clockOf(t),
      closeLabel: 'Volver a las situaciones', onClose: backToList, frac: r.ok ? 1 : clamp01(num(r.progress, 0)), title: r.ok ? '¡Bien resuelta!' : 'Esta vez no salió', text: '' });
    Rn.appendChild(callout(r.ok ? 'ok' : 'cuidado', r.ok ? 'Lo lograste' : 'Qué pasó', r.mensaje || ''));
    Rn.appendChild(h('p', { class: 'ctl-sub sit-time' }, ico('clock'), Math.floor(t / 60) + ' min ' + Math.round(t % 60) + ' s · el avión quedó en pausa para que lo leas con calma.'));
    V.appendChild(Rn);
    var errs = Array.isArray(x.errores) ? x.errores : [];
    var list = [['Lo que hace un piloto', '', h('p', { class: 'sit-debrief-text', text: x.debrief || '' }), 'sit-f-deb', true]];
    if (errs.length) list.push(['Errores comunes', errs.length + (errs.length === 1 ? ' error' : ' errores'), (function () { var ul = bullets(errs); ul.className = 'bullets bullets--warn'; return ul; })(), 'sit-f-err', false]);
    secs(list);
    V.appendChild(h('div', { class: 'sg-wrap' }, h('p', { class: 'sg-k', text: 'Seguí con…' }), h('div', { class: 'sg-list' }, sg.map(function (s) { return A.sgCard ? A.sgCard(s) : null; }))));
  }
  function clockOf(t) { t = Math.max(0, Math.floor(num(t, 0))); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function render(focusTitle) {
    if (!V) return;
    var hadFocus = V.contains(document.activeElement);
    A.releaseAllHolds();
    R.live = [];
    while (V.firstChild) V.removeChild(V.firstChild);
    if (R.phase === 'brief' && R.x) renderBrief();
    else if (R.phase === 'run' && R.x) renderRun();
    else if (R.phase === 'fin' && R.x) renderFin();
    else { R.phase = 'lista'; renderList(); }
    if (A.annotate && R.phase !== 'run') {          // glossary popovers only in the reading text, not in titles or kickers
      var txt = V.querySelectorAll('.sit-intro, .runner-text, .callout-body, .acc-body, .sit-debrief-text, .sit-brief .ctl-sub');
      for (var q = 0; q < txt.length; q++) A.annotate(txt[q]);
    }
    var s = A.S();
    if (s) runLive(s);
    if (focusTitle || hadFocus) {
      var t = document.getElementById('sit-title') || V.querySelector('button');
      if (t && R.phase !== 'lista') A.safe(function () { t.focus({ preventScroll: true }); });
    }
    if (focusTitle && R.phase !== 'lista') A.scrollPanelTop();
  }

  /* ------------------------------------------------------------------ public */
  var Situations = C150.Situations = {
    list: SIT,
    mount: function (container, api) {
      A = api; V = container;
      var b = A.store.get('situationsDone', {});
      R.best = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
      render(false);
    },
    frame: function (s, dt) {
      if (R.phase !== 'run' || !R.x || !R.ctx || !s || s.paused || !(dt > 0)) return;
      R.ctx.t += dt; R.ctx.dt = dt;
      var x = R.x;
      if (typeof x.durante === 'function') { try { x.durante(s, R.ctx); } catch (e) { if (root.console) console.error('[Situaciones] durante', e); } }
      var r = null;
      try { r = x.check(s, R.ctx); } catch (e2) { if (root.console) console.error('[Situaciones] check', e2); }
      if (!r || typeof r !== 'object') return;
      R.res = { progress: clamp01(num(r.progress, 0)), ok: !!r.ok, fail: !!r.fail, mensaje: String(r.mensaje || '') };
      if (R.res.ok || R.res.fail) finish(R.res);
    },
    slow: function (s) { if (V && R.live.length && s) runLive(s); },
    active: function () { return R.phase === 'run'; },
    phase: function () { return R.phase; },
    current: function () { return R.x ? R.x.id : null; },
    stop: function (reason) { if (R.phase === 'run' || R.phase === 'fin') stop(reason); },
    onPreset: function () {
      if (R.starting) return;
      if (R.phase === 'run') stop('Cambiaste de escenario: la situación se cortó.');
      else if (R.phase === 'fin') { R.pausedByUs = false; teardown(); R.phase = 'brief'; render(false); }
    },
    open: open,
    /** UP / "volver a la lista" (contract v6): ends a run or debrief and shows the list of situations. */
    toList: function () {
      var was = R.phase;
      backToList();
      if (was === 'run' && A) A.showToast({ text: 'Saliste de la situación.', kind: 'info' });
    }
  };
})(root.C150);
