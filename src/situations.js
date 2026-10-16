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
  function chipFocus(id) {
    var c = A.CTRL[id];
    if (!c) return null;
    return A.h('button', { type: 'button', class: 'chip', onclick: function () { A.focusControl(id); } }, A.icon('target'), c.nombre);
  }
  function tipoBadge(x) {
    var t = x.tipo || 'anormal';
    return A.h('span', { class: 'sit-tipo sit-tipo--' + t.replace(/\s+/g, '-'), text: TIPO[t] || t });
  }

  function renderList() {
    var h = A.h;
    // panel header in the app's family: numbered mono kicker + display title + lead, closed by a hairline
    V.appendChild(h('div', { class: 'mode-head' },
      h('p', { class: 'mode-kicker' }, h('span', { class: 'mode-kicker-dot', 'aria-hidden': 'true' }), '05 · Situaciones prácticas'),
      h('h2', { class: 'placard mode-title', text: '¿Qué harías?' }),
      h('p', { class: 'mode-sub sit-intro', text: 'Cosas que pueden pasar en un vuelo y qué hacés. No es teoría: el avión las vive en el simulador y vos actuás con los mandos (los botones de acá, el teclado o la cabina 3D).' })));
    if (!SIT.length) { V.appendChild(h('p', { class: 'empty', text: 'Las situaciones todavía no están cargadas.' })); return; }
    var grid = h('ul', { class: 'sit-grid', 'aria-label': 'Situaciones prácticas' });
    SIT.forEach(function (x, i) {
      var done = !!R.best[x.id];
      grid.appendChild(h('li', null, h('button', { type: 'button', class: 'sit-card' + (done ? ' is-done' : ''), onclick: function () { open(x.id); } },
        h('span', { class: 'sit-card-top' }, h('span', { class: 'sit-num', text: ('0' + (i + 1)).slice(-2) }), tipoBadge(x),
          done ? h('span', { class: 'sit-done' }, A.icon('check'), 'Resuelta') : null),
        h('span', { class: 'sit-card-title', text: x.titulo }),
        h('span', { class: 'sit-card-ctx', text: x.contexto }))));
    });
    V.appendChild(grid);
    V.appendChild(h('p', { class: 'aviso', text: 'Procedimientos según el POH del 150M, simplificados para practicar. En el avión mandan el manual, la checklist de tu escuela y el instructor.' }));
  }

  function renderBrief() {
    var h = A.h, x = R.x;
    var sen = h('ul', { class: 'bullets' });
    senales(x).forEach(function (t) { sen.appendChild(h('li', { text: t })); });
    V.appendChild(h('div', { class: 'detail-top' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small back-btn', onclick: backToList }, A.icon('back'), 'Situaciones')));
    V.appendChild(h('article', { class: 'card sit-brief', 'aria-labelledby': 'sit-title' },
      h('p', { class: 'kicker' }, tipoBadge(x), ' Situación práctica'),
      h('h2', { class: 'placard detail-title', id: 'sit-title', tabindex: '-1', text: x.titulo }),
      h('p', { class: 'sit-ctx', text: x.contexto }),
      h('div', { class: 'sit-goal' }, h('span', { class: 'sit-goal-k', text: 'Tu objetivo' }), h('p', { text: x.objetivo })),
      h('details', { class: 'fold' }, h('summary', null, 'Qué vas a notar'), sen),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--primary btn--big', onclick: start }, A.icon('play'), 'Empezar'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: backToList }, 'Elegir otra')),
      h('p', { class: 'soft small', text: 'Al empezar, el avión se pone en el escenario y la situación arranca. Tomate tu tiempo: primero, siempre, volar el avión.' })));
  }

  function renderRun() {
    var h = A.h, x = R.x;
    var bar = A.progressBar(0, false);
    var msg = h('p', { class: 'sit-msg', role: 'status', 'aria-live': 'polite' });
    var pct = h('span', { class: 'pct' });
    var clock = h('span', { class: 'sit-clock' });
    R.live.push(function () {
      var r = R.res || {};
      bar.set(num(r.progress, 0), false);
      A.setText(pct, Math.round(clamp01(num(r.progress, 0)) * 100) + ' %');
      A.setText(msg, r.mensaje || '');
      var t = R.ctx ? R.ctx.t : 0;
      A.setText(clock, Math.floor(t / 60) + ':' + ('0' + Math.floor(t % 60)).slice(-2));
    });
    V.appendChild(h('div', { class: 'mission-bar sit-bar' },
      h('div', { class: 'mission-bar-top' }, h('span', { class: 'mission-bar-title', text: x.titulo }), clock, pct), bar, msg));

    // what you notice + objective + hints
    var sen = h('ul', { class: 'bullets' });
    senales(x).forEach(function (t) { sen.appendChild(h('li', { text: t })); });
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
    V.appendChild(h('article', { class: 'card sit-run', 'aria-labelledby': 'sit-title' },
      h('p', { class: 'kicker' }, tipoBadge(x), ' En curso'),
      h('h2', { class: 'placard detail-title', id: 'sit-title', tabindex: '-1', text: x.titulo }),
      h('div', { class: 'sit-goal' }, h('span', { class: 'sit-goal-k', text: 'Objetivo' }), h('p', { text: x.objetivo })),
      h('details', { class: 'fold' }, h('summary', null, 'Qué notás'), sen),
      h('div', { class: 'sit-pistas-box' }, pl, pbtn),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--small', onclick: start }, A.icon('retry'), 'Empezar de nuevo'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () { stop(); } }, 'Salir'))));

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
    V.appendChild(h('div', { class: 'block' },
      h('h3', { class: 'placard placard--small block-title', text: 'Mandos de esta situación' }),
      h('p', { class: 'soft small', text: 'Tocá un nombre para que la cámara te lo muestre en la cabina.' }), chips,
      widgets.firstChild ? widgets : null));
    V.appendChild(h('div', { class: 'block' },
      h('h3', { class: 'placard placard--small block-title', text: 'Instrumentos' }), A.buildHud(R.live)));
    V.appendChild(h('div', { class: 'block' },
      h('h3', { class: 'placard placard--small block-title', text: 'Mandos de vuelo' }), A.flightPad(R.live)));
  }

  function renderFin() {
    var h = A.h, x = R.x, r = R.res || {};
    var errs = h('ul', { class: 'bullets bullets--warn' });
    (Array.isArray(x.errores) ? x.errores : []).forEach(function (t) { errs.appendChild(h('li', { text: t })); });
    var t = R.ctx ? num(R.ctx.final, R.ctx.t) : 0;
    V.appendChild(h('div', { class: 'detail-top' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small back-btn', onclick: backToList }, A.icon('back'), 'Situaciones')));
    V.appendChild(h('article', { class: 'card sit-debrief ' + (r.ok ? 'is-ok' : 'is-fail'), 'aria-labelledby': 'sit-title' },
      h('p', { class: 'kicker' }, tipoBadge(x), ' Repaso'),
      h('h2', { class: 'placard detail-title', id: 'sit-title', tabindex: '-1', text: r.ok ? '¡Bien resuelta!' : 'Esta vez no salió' }),
      h('p', { class: 'sit-result' }, A.icon(r.ok ? 'check' : 'warn'), h('span', { text: r.mensaje || '' })),
      h('p', { class: 'soft small', text: x.titulo + ' · ' + Math.floor(t / 60) + ' min ' + Math.round(t % 60) + ' s · el avión quedó en pausa.' }),
      h('section', { class: 'sec' }, h('h3', { class: 'placard placard--small', text: 'Lo que hace un piloto' }), h('p', { class: 'sit-debrief-text', text: x.debrief || '' })),
      h('section', { class: 'sec' }, h('h3', { class: 'placard placard--small', text: 'Errores comunes' }), errs),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: start }, A.icon('retry'), r.ok ? 'Otra vez' : 'Probar de nuevo'),
        h('button', { type: 'button', class: 'btn', onclick: backToList }, 'Otra situación'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () { stop(); backToList(); if (A.showPractice) A.showPractice(); } }, 'Seguir volando libre'))));
  }

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
    open: open
  };
})(root.C150);
