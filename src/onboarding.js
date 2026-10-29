var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * onboarding.js — C150.Onboarding: la bienvenida de la primera vez y el tutorial de 5 pasos (contrato UI/UX v4 §4, ola U2).
 *
 *   Onboarding.maybeStart()   lo llama ui.js al final del arranque: si es la primera vez (y no es un navegador automatizado), muestra la
 *                             bienvenida a los ~0,9 s. Nunca interrumpe si ya la vio.
 *   Onboarding.start(opts?)   {force:true} la muestra siempre (Ayuda → "Ver el tutorial", Inicio, el buscador). Si ya está abierta no hace nada.
 *   Onboarding.tour(opts?)    sólo los 5 pasos con foco (sin la pregunta del nivel). opts.level: 'cero' | 'algo'.
 *   Onboarding.stop()         cierra lo que esté abierto (cuenta como terminado).
 *   Onboarding.isDone() · Onboarding.level() · Onboarding.reset()  (reset sólo borra la marca de "ya la vio")
 *
 * Flujo: 1) diálogo de bienvenida con la pregunta "¿cuánto sabés de aviones?" (Nunca volé / Ya sé algo / Saltar)
 *        2) tutorial con foco (el resto se oscurece): menú → vista 3D → panel → buscador → tu avance. ← → Enter Esc; Atrás / Siguiente / Saltar.
 *        3) al terminar: "Nunca volé" te deja en Inicio con "Tu camino" resaltado; "Ya sé algo", en la Cabina.
 * Persistencia: localStorage 'c150.onboarding.v1' = {done, level, t}; además Progress.mark('onboarding', 'welcome' | 'tour').
 * En teléfonos, antes del paso del panel se abre la hoja a la mitad (UI.sheet('half')) para que se vea lo que se explica.
 */
(function (C150) {
  'use strict';
  if (typeof document === 'undefined') return;

  var Onboarding = C150.Onboarding = C150.Onboarding || {};
  var doc = document;
  var KEY = 'c150.onboarding.v1';
  var cur = null;                  // {dialog?, tour?}
  var timer = 0;

  function isFn(f) { return typeof f === 'function'; }
  function K() { return C150.Kit; }
  function UI() { return C150.UI || {}; }
  function safe(fn, tag) { try { return fn(); } catch (e) { if (root.console) console.error('[Onboarding' + (tag ? ' ' + tag : '') + ']', e); return undefined; } }
  function reduced() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  function read() { try { var v = JSON.parse(root.localStorage.getItem(KEY)); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
  function write(o) { try { root.localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* almacenamiento bloqueado */ } }
  function mark(id, data) { var P = C150.Progress; if (P && isFn(P.mark)) safe(function () { P.mark('onboarding', id, data); }, 'progress'); }
  function finish(level, how) {
    var o = read() || {};
    o.done = true; o.t = Date.now(); if (level) o.level = level; o.how = how || o.how || 'tour';
    write(o);
  }

  Onboarding.isDone = function () { var o = read(); return !!(o && o.done); };
  Onboarding.level = function () { var o = read(); return o && o.level || null; };
  Onboarding.reset = function () { try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
  Onboarding.maybeStart = function () {
    if (Onboarding.isDone()) return;
    var nav = root.navigator || {};
    if (nav.webdriver) return;                         // navegadores automatizados (pruebas): no interrumpir
    clearTimeout(timer);
    timer = setTimeout(function () { if (!Onboarding.isDone()) Onboarding.start(); }, 900);
  };
  Onboarding.start = function (opts) {
    opts = opts || {};
    if (cur) return false;
    if (!opts.force && Onboarding.isDone()) return false;
    return welcome(opts);
  };
  Onboarding.tour = function (opts) { opts = opts || {}; if (cur) return false; return runTour(opts.level || Onboarding.level() || 'cero', opts); };
  Onboarding.stop = function () {
    if (!cur) return;
    var c = cur; cur = null;
    if (c.tour) c.tour.close(true);
    if (c.dialog) c.dialog.close();
  };

  /* ------------------------------------------------------------------ 1) bienvenida */
  function welcome(opts) {
    var Kit = K();
    if (!Kit || !isFn(Kit.dialog)) return false;
    var h = Kit.el, chosen = false, dlg = null;
    function choose(level) {
      chosen = true;
      mark('welcome', { level: level });
      var o = read() || {}; o.level = level; write(o);
      if (dlg) dlg.close();
      cur = null;
      setTimeout(function () { runTour(level, opts); }, reduced() ? 0 : 280);
    }
    function option(icon, title, sub, level, tag) {
      return h('button', { type: 'button', 'class': 'ob-choice', onclick: function () { choose(level); } },
        h('span', { 'class': 'ob-choice-ico', 'aria-hidden': 'true' }, Kit.icon(icon)),
        h('span', { 'class': 'ob-choice-txt' }, tag ? h('span', { 'class': 'ob-choice-k', text: tag }) : null, h('span', { 'class': 'ob-choice-t', text: title }), h('span', { 'class': 'ob-choice-d', text: sub })),
        h('span', { 'class': 'ob-choice-go', 'aria-hidden': 'true' }, Kit.icon('arrow-right')));
    }
    var first = option('star', 'Nunca volé', 'No sé nada de aviones: empezamos desde lo más básico, con una guía paso a paso.', 'cero', 'Nivel 1 · desde cero');
    first.setAttribute('data-autofocus', '1');
    var body = h('div', { 'class': 'ob-welcome' },
      h('p', { 'class': 'ob-lead', text: 'Una cabina de Cessna 150 en 3D para aprender qué es cada mando, cómo hace un avión para volar y practicar sin ningún riesgo.' }),
      h('p', { 'class': 'ob-ask', id: 'ob-ask', text: '¿Cuánto sabés de aviones?' }),
      h('div', { 'class': 'ob-choices', role: 'group', 'aria-labelledby': 'ob-ask' },
        first,
        option('cabin', 'Ya sé algo', 'Conozco algunos mandos o ya tuve una clase: voy directo a la cabina.', 'algo', 'Nivel 2 · ya sé algo')),
      h('p', { 'class': 'ob-note', text: 'Después te muestro la pantalla en 5 pasos cortos. Lo podés volver a ver desde el botón de ayuda (?).' }));
    dlg = Kit.dialog({
      kicker: 'Bienvenido a bordo', title: 'Cabina Cessna 150', body: body, label: 'Bienvenida',
      actions: [{ label: 'Saltar la introducción', variant: 'ghost' }],
      onClose: function () {
        if (chosen) return;
        cur = null;
        mark('welcome', { level: 'saltó' });
        finish(null, 'skip');
      }
    });
    cur = { dialog: dlg };
    return true;
  }

  /* ------------------------------------------------------------------ 2) tutorial con foco */
  var STEPS = [
    { id: 'nav', sel: '#nav', title: 'Tu menú', text: 'Acá están las secciones: Inicio, Cabina (los mandos y los instrumentos), Lecciones, Practicar y Aire (cómo se mueve el aire). Desde cualquiera podés volver a Inicio.', pad: 4 },
    { id: 'viewport', sel: '#viewport', title: 'La cabina en 3D', text: 'Arrastrá para mirar alrededor y tocá cualquier mando para saber qué hace. Con la rueda del mouse (o con dos dedos) te acercás y te alejás.', pad: 0, inside: true },
    { id: 'panel', sel: '#panel', title: 'Tu panel', text: 'Acá aparece la explicación de lo que tocás, las lecciones y los ejercicios. En el celular lo deslizás hacia arriba para leer más y hacia abajo para ver más cabina.', pad: 0, sheet: 'half' },
    { id: 'search', sel: '#btn-search', title: 'Buscá lo que sea', text: 'Escribí una palabra, como flaps, QNH o pérdida, y te llevo directo. Atajo: Ctrl K o la tecla /.', pad: 6 },
    { id: 'progress', sel: '#btn-progress', title: 'Tu avance', text: 'El anillo muestra cuánto llevás de tu camino. Tocalo para volver a Inicio y ver qué sigue.', pad: 6 }
  ];

  function visibleRect(sel) {
    var el = doc.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  }

  function runTour(level, opts) {
    var Kit = K();
    if (!Kit || !isFn(Kit.el)) return false;
    var h = Kit.el, i = 0, closed = false;
    var vw = function () { return root.innerWidth || doc.documentElement.clientWidth; };
    var vh = function () { return root.innerHeight || doc.documentElement.clientHeight; };
    var prev = doc.activeElement;

    var hole = h('div', { 'class': 'ob-hole', 'aria-hidden': 'true' });
    var title = h('h2', { 'class': 'ob-t', id: 'ob-t' });
    var text = h('p', { 'class': 'ob-p', id: 'ob-p' });
    var count = h('span', { 'class': 'ob-count data' });
    var dots = h('span', { 'class': 'ob-dots', 'aria-hidden': 'true' });
    STEPS.forEach(function () { dots.appendChild(h('span', { 'class': 'ob-dot' })); });
    var btnBack = Kit.button({ label: 'Atrás', icon: 'chevron-left', variant: 'ghost', size: 'small', onClick: function () { go(i - 1); } });
    var btnNext = Kit.button({ label: 'Siguiente', iconRight: 'chevron-right', variant: 'primary', size: 'small', onClick: function () { if (i >= STEPS.length - 1) close(false); else go(i + 1); } });
    var btnSkip = h('button', { type: 'button', 'class': 'ob-skip', onclick: function () { close(true); } }, 'Saltar el tutorial');
    var pop = h('div', { 'class': 'ob-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ob-t', 'aria-describedby': 'ob-p', tabindex: '-1' },
      h('div', { 'class': 'ob-pop-top' }, count, dots),
      title, text,
      h('div', { 'class': 'ob-pop-bar' }, btnBack, btnNext),
      btnSkip);
    var live = h('p', { 'class': 'sr-only', 'aria-live': 'polite' });
    var shade = h('div', { 'class': 'ob-shade' });
    var el = h('div', { 'class': 'ob' }, shade, hole, pop, live);

    function place() {
      var s = STEPS[i];
      var r = visibleRect(s.sel);
      var W = vw(), H = vh(), M = 12;
      var pw = Math.min(pop.offsetWidth || 340, W - 2 * M), ph = pop.offsetHeight || 190;
      var left, top;
      if (!r) {
        hole.style.cssText = 'left:50%;top:50%;width:0;height:0;';
        left = (W - pw) / 2; top = Math.max(M, (H - ph) / 2);
      } else {
        var pad = s.pad === undefined ? 6 : s.pad;
        var hl = Math.max(0, r.left - pad), ht = Math.max(0, r.top - pad);
        var hw = Math.min(W - hl, r.width + pad * 2), hh = Math.min(H - ht, r.height + pad * 2);
        hole.style.cssText = 'left:' + hl + 'px;top:' + ht + 'px;width:' + hw + 'px;height:' + hh + 'px;';
        var spaceBelow = H - (r.bottom + pad) - M, spaceAbove = r.top - pad - M;
        if (s.inside) {
          // el blanco es grande (la vista 3D): la tarjeta va adentro, abajo y centrada
          left = r.left + (r.width - pw) / 2;
          top = r.top + r.height - ph - 18;
          if (r.height < ph + 60) top = r.top + 12;
        } else if (spaceBelow >= ph + 10) {
          left = r.left + r.width / 2 - pw / 2; top = r.bottom + pad + 12;
        } else if (spaceAbove >= ph + 10) {
          left = r.left + r.width / 2 - pw / 2; top = r.top - pad - 12 - ph;
        } else if (r.left >= pw + 2 * M) {
          left = r.left - pw - 16; top = r.top + Math.min(40, r.height / 8);       // al costado, sobre la vista 3D (el panel de la derecha)
        } else {
          left = r.left + (r.width - pw) / 2; top = r.top + 12;
        }
      }
      left = Math.max(M, Math.min(W - pw - M, left));
      top = Math.max(M, Math.min(H - ph - M, top));
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
      pop.style.width = pw + 'px';
    }
    function paint() {
      var s = STEPS[i];
      title.textContent = s.title;
      text.textContent = s.text;
      count.textContent = 'Paso ' + (i + 1) + ' de ' + STEPS.length;
      var ds = dots.children;
      for (var d = 0; d < ds.length; d++) ds[d].className = 'ob-dot' + (d === i ? ' is-on' : (d < i ? ' is-past' : ''));
      btnBack.disabled = i === 0;
      var lbl = btnNext.querySelector('span');
      if (lbl) lbl.textContent = i >= STEPS.length - 1 ? (level === 'algo' ? 'A la cabina' : 'Empezar') : 'Siguiente';
      live.textContent = s.title + '. ' + s.text;
      place();
    }
    function go(k) {
      i = Math.max(0, Math.min(STEPS.length - 1, k));
      var s = STEPS[i];
      var u = UI();
      if (s.sheet && isFn(u.sheet)) safe(function () { u.sheet(s.sheet); }, 'sheet');
      paint();
      setTimeout(function () { if (!closed) place(); }, 330);          // la hoja inferior tarda en acomodarse
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (i < STEPS.length - 1) go(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (i > 0) go(i - 1); }
      else if (e.key === 'Tab') {
        var f = [btnBack, btnNext, btnSkip].filter(function (n) { return !n.disabled; });
        var k = f.indexOf(doc.activeElement);
        e.preventDefault(); f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    }
    function onResize() { if (!closed) place(); }
    var navTok = null;
    function close(skipped) {
      if (closed) return;
      closed = true;
      if (navTok && C150.Nav && isFn(C150.Nav.overlayClosed)) { C150.Nav.overlayClosed(navTok); navTok = null; }
      doc.removeEventListener('keydown', onKey, true);
      root.removeEventListener('resize', onResize);
      root.removeEventListener('orientationchange', onResize);
      el.classList.remove('is-on');
      var gone = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      if (reduced()) gone(); else setTimeout(gone, 220);
      cur = null;
      mark('tour', { level: level, saltado: !!skipped });
      finish(level, skipped ? 'skip' : 'tour');
      if (prev && prev.focus && doc.contains(prev)) safe(function () { prev.focus({ preventScroll: true }); });
      if (!opts || !opts.noNavigate) setTimeout(function () { land(level, skipped); }, 60);
    }

    doc.body.appendChild(el);
    doc.addEventListener('keydown', onKey, true);
    root.addEventListener('resize', onResize);
    root.addEventListener('orientationchange', onResize);
    cur = { tour: { close: close } };
    if (C150.Nav && isFn(C150.Nav.overlayOpen) && C150.Nav.mounted && C150.Nav.mounted()) navTok = C150.Nav.overlayOpen(function () { close(true); });   // the system Back button closes the tutorial
    go(0);
    void el.offsetWidth;
    el.classList.add('is-on');
    safe(function () { btnNext.focus({ preventScroll: true }); }, 'focus');
    return true;
  }

  /** Dónde queda el alumno al terminar: "Nunca volé" → Inicio con el camino resaltado; "Ya sé algo" → Cabina. */
  function land(level, skipped) {
    var u = UI(), Hm = C150.Home;
    if (level === 'algo') { if (isFn(u.go)) u.go('cabina'); return; }
    if (isFn(u.go)) u.go('inicio');
    if (isFn(u.sheet)) u.sheet('half');
    if (!skipped && Hm && isFn(Hm.highlight)) setTimeout(function () { Hm.highlight(); }, 260);
  }
})(root.C150);
