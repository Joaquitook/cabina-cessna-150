var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/visor.js — C150.Escuela.visor: el VISOR 3D a pedido de la Escuela (contrato v8, §2).
 *
 * En la pestaña ESCUELA la cabina 3D no está a la vista: la lección ocupa toda la pantalla. Cuando un paso dice "mirá el mando" / "mirá el avión",
 * el visor muestra EL MISMO canvas (no hay un segundo renderer) al costado (escritorio ≥ 1000 px) o arriba (45 svh, tablet y teléfono), con una
 * cabecera "CABINA · …" + "Cerrar visor", una barra de leyenda con la consigna y el botón "Volver a la lección".
 *
 * API (todo guardado: sin 3D, sin ui.js o en Node no tira):
 *   visor.open(target, {caption, returnLabel, label, opener, onClose, restoring}) → bool    abre (o reapunta si ya estaba abierto)
 *        target: function (corre tras abrir: mueve la cámara)  |  'exterior' | 'cabina' | id de un mando  |  objeto JSON-able:
 *          { control:'throttle' }                       selecciona y encuadra el mando (cabina)
 *          { pose:'flaps-full' }                        avión por fuera en esa pose (ver Exterior.POSES); se suelta al cerrar
 *          { vista:'exterior'|'cabina', foco?:'wing'|'flaps'|… (afuera) | 'panel'|… (focusPreset, adentro) }
 *          { fn: function }                             (no se guarda en capture / reload)
 *        opts.caption     texto de la barra de abajo (la consigna del paso)      opts.label  lo que dice la cabecera ("Acelerador")
 *        opts.returnLabel texto del botón de la barra (por defecto "Volver a la lección")
 *   visor.close({restore:true, quiet:false, focus:true}) → bool     cierra; devuelve la cámara a donde estaba y el foco al botón que lo abrió
 *   visor.isOpen() · visor.target() · visor.setCaption(texto) · visor.onChange(fn({open, target})) → off · visor.supported() (hay 3D)
 *   visor.capture() → {open, target, caption, label}      visor.restore(obj)       estado para el proveedor de C150.Nav (open + target)
 *   visor.resume(ruta)    tras un reload: si había un visor abierto en esa ruta (sessionStorage) lo vuelve a abrir cuando el 3D está listo
 *   visor.init(api)       lo llama Escuela.mount (api = labApi de ui.js)       visor.setRoute(fn → 'escuela/INT-01-04/3')
 *
 * Capas: el estado vive en <div id="app" data-visor="open"> (CSS en styles.css, bloque "v8 · ESCUELA"); la cabecera es el primer hijo de #vp-stage y la barra
 * de leyenda cuelga de #vp-bottom (así el cartel .callout3d de ui.js las esquiva). Mientras el visor está cerrado el escenario está colapsado y Core
 * hace Core.setSuspended(true) (sin dibujar). Esc y el botón Atrás cierran el visor primero: se registra como overlay de C150.Nav.
 */
(function (C150) {
  'use strict';

  var Escuela = C150.Escuela = C150.Escuela || {};
  var V = Escuela.visor = Escuela.visor || {};
  var SKEY = 'c150.es.visor';

  var A = null, K = null, h = null, appEl = null, vpEl = null;
  var st = { sheetPrev: null, open: false, target: null, fn: null, label: '', caption: '', returnLabel: '', opener: null, prev: null, tok: null, onClose: null, forced: null, anim: 0, aimT: 0 };
  var els = null, listeners = [], routeFn = null, retry = 0;

  function isFn(f) { return typeof f === 'function'; }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(x) { return typeof x === 'string' ? x.trim() : ''; }
  function now() { return Date.now(); }
  function Nv() { return C150.Nav || null; }
  function cc() { return A && isFn(A.cc) ? A.cc.apply(null, arguments) : undefined; }
  function reduced() { return A && isFn(A.reducedMotion) ? !!A.reducedMotion() : !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function ss(op, key, val) {
    try {
      var S = root.sessionStorage;
      if (!S) return null;
      if (op === 'get') return S.getItem(key);
      if (op === 'set') S.setItem(key, val);
      else S.removeItem(key);
    } catch (e) { /* sin sessionStorage (ventana privada…): el visor igual anda */ }
    return null;
  }

  /* ------------------------------------------------------------------ el dato
   * normalizar → {t: JSON-able | null, fn: function | null}. Lo que no se puede guardar queda sólo en memoria. */
  function normalizar(target) {
    var t = {}, fn = null;
    if (isFn(target)) return { t: null, fn: target };
    if (typeof target === 'string') {
      var s = str(target);
      if (!s) return { t: null, fn: null };
      if (s === 'exterior' || s === 'afuera') t.vista = 'exterior';
      else if (s === 'cabina' || s === 'cockpit') t.vista = 'cabina';
      else t.control = s;
      return { t: t, fn: null };
    }
    if (!esObj(target)) return { t: null, fn: null };
    if (isFn(target.fn)) fn = target.fn;
    if (str(target.control)) t.control = str(target.control);
    else if (str(target.pose)) t.pose = str(target.pose);
    else if (str(target.vista)) t.vista = /^(exterior|afuera)$/i.test(str(target.vista)) ? 'exterior' : 'cabina';
    if (str(target.foco)) t.foco = str(target.foco);
    if (str(target.label)) t.label = str(target.label);
    if (!t.control && !t.pose && !t.vista && !fn) return { t: null, fn: null };
    return { t: t, fn: fn };
  }
  function kindOf(t) { return t && (t.pose || t.vista === 'exterior') ? 'exterior' : 'cabina'; }

  /* ------------------------------------------------------------------ DOM (lazy: primera vez que se abre) */
  function icon(n) { return K && isFn(K.icon) ? K.icon(n) : null; }
  function build() {
    if (els) return true;
    var stage = document.getElementById('vp-stage'), bottom = document.getElementById('vp-bottom');
    if (!stage || !bottom || !h) return false;
    var kick = h('span', { 'class': 'es-visor-k' });
    var title = h('span', { 'class': 'es-visor-t' });
    var close = h('button', { type: 'button', 'class': 'es-visor-x', 'aria-label': 'Cerrar el visor 3D (Esc)', title: 'Cerrar el visor 3D (Esc)', onclick: function () { V.close(); } },
      icon('close'), h('span', { text: 'Cerrar visor' }));
    var head = h('div', { 'class': 'es-visor-head', role: 'group', 'aria-label': 'Visor 3D' },
      h('span', { 'class': 'es-visor-dot', 'aria-hidden': 'true' }), kick, h('span', { 'class': 'es-visor-sep', 'aria-hidden': 'true', text: '·' }), title, close);
    var capT = h('p', { 'class': 'es-visor-cap-t' });
    var back = h('button', { type: 'button', 'class': 'btn btn--primary btn--small es-visor-back', onclick: function () { V.close(); } }, icon('back'), h('span', { 'class': 'es-visor-back-t', text: 'Volver a la lección' }));
    var cap = h('div', { 'class': 'es-visor-cap', role: 'status', 'aria-live': 'polite' }, capT, back);
    stage.insertBefore(head, stage.firstChild);
    bottom.insertBefore(cap, bottom.firstChild);
    els = { head: head, kick: kick, title: title, close: close, cap: cap, capT: capT, back: back, backT: back.querySelector('.es-visor-back-t') };
    return true;
  }
  function pintar() {
    if (!els) return;
    var k = kindOf(st.target);
    els.kick.textContent = k === 'exterior' ? 'AVIÓN' : 'CABINA';
    els.title.textContent = st.label || (st.target && st.target.control ? st.target.control : (k === 'exterior' ? 'Desde afuera' : 'Vista de la cabina'));
    els.capT.textContent = st.caption || '';
    els.cap.classList.toggle('is-empty', !st.caption);
    els.backT.textContent = st.returnLabel || 'Volver a la lección';
    els.back.setAttribute('aria-label', st.returnLabel || 'Volver a la lección');
  }

  /* ------------------------------------------------------------------ cámara */
  function listo() { return !!A && isFn(A.cc) && !!A.cc('getViewState'); }
  function aplicar() {
    var t = st.target, fn = st.fn;
    if (!st.open || !listo()) return;
    try {
      if (t && t.control) { if (isFn(A.lookControl)) A.lookControl(t.control); else cc('select', t.control, { focus: true }); }
      else if (t && t.pose) { cc('setMainView', 'exterior'); if (isFn(A.syncMainView)) A.syncMainView(); cc('poseExterior', t.pose); }
      else if (t && t.vista === 'exterior') {
        cc('setMainView', 'exterior'); if (isFn(A.syncMainView)) A.syncMainView();
        if (t.foco) cc('setExteriorView', t.foco);
      } else if (t && t.vista === 'cabina') {
        cc('setMainView', 'cockpit'); if (isFn(A.syncMainView)) A.syncMainView();
        cc('focusPreset', t.foco || 'panel');
      }
      if (isFn(fn)) fn();
    } catch (e) { if (root.console) console.error('[Escuela] visor aplicar', e); }
    if (A && isFn(A.kick)) A.kick();
  }
  function soltarPose() { if (st.target && st.target.pose && A && isFn(A.has) && A.has('clearPose')) { try { cc('clearPose'); } catch (e) { /* el avión ya no está */ } } }

  /* ------------------------------------------------------------------ abrir / cerrar */
  /** En pantallas angostas (teléfono, tablet: < 1000 px) el visor ocupa la parte de arriba y la lección queda debajo: lo que siga abierto tapando (el cajón del índice
   *  de la lección, la hoja de abajo de la app) se repliega para que se vea el visor. Avisa por un evento del documento (la lección cierra su índice sin acoplarse al visor)
   *  y le pide a ui.js que baje la hoja; al cerrar el visor la hoja vuelve a donde estaba. */
  function colapsarEnTelefono() {
    var angosto = root.matchMedia ? root.matchMedia('(max-width: 999px)').matches : (root.innerWidth || 1200) < 1000;
    if (!angosto) return;
    try { document.dispatchEvent(new CustomEvent('c150-visor-abierto', { detail: { open: true } })); } catch (e) { /* sin CustomEvent: el cajón se cierra solo al tocar afuera */ }
    if (A && isFn(A.sheetCollapse)) { try { st.sheetPrev = A.sheetCollapse(); } catch (e2) { st.sheetPrev = null; } }
  }
  function avisar() { var ev = { open: st.open, target: st.target }; listeners.slice().forEach(function (f) { try { f(ev); } catch (e) { /* un oyente roto no frena al visor */ } }); }
  function guardar() {
    if (!st.open || !st.target) { ss('del', SKEY); return; }
    var ruta = isFn(routeFn) ? routeFn() : '';
    ss('set', SKEY, JSON.stringify({ t: now(), ruta: ruta, target: st.target, label: st.label, caption: st.caption, returnLabel: st.returnLabel }));
  }
  function onKey(e) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    e.preventDefault(); V.close();
  }

  V.init = function (api) {
    A = api || A; K = C150.Kit || K; h = K && K.el ? K.el : h;
    appEl = (A && A.app) || document.getElementById('app');
    vpEl = (A && A.viewport) || document.getElementById('viewport');
    if (!V._hooked) { V._hooked = true; root.addEventListener('pagehide', function () { if (st.open) guardar(); }); }      // un reload con el visor abierto lo vuelve a abrir (resume)
  };
  V.setRoute = function (fn) { routeFn = fn; };
  V.supported = function () { return !!A && listo(); };
  V.isOpen = function () { return !!st.open; };
  V.target = function () { return st.target ? JSON.parse(JSON.stringify(st.target)) : null; };
  V.onChange = function (fn) { if (isFn(fn)) listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  V.setCaption = function (texto) { st.caption = str(texto); pintar(); guardar(); };

  V.open = function (target, o) {
    o = o || {};
    if (!A || !appEl || !h) return false;
    var n = normalizar(target);
    if (!n.t && !n.fn) return false;
    if (!listo()) {                                                   // sin WebGL, o el 3D todavía no arrancó
      if (o.restoring && retry < 24) { retry++; setTimeout(function () { if (!st.open) V.open(target, o); }, 250); return false; }
      if (isFn(A.showToast)) A.showToast({ text: 'No pudimos abrir la vista 3D en este dispositivo. Seguí con la lección.', kind: 'warn' });
      return false;
    }
    retry = 0;
    if (!build()) return false;
    var wasOpen = st.open;
    if (wasOpen) soltarPose();                                        // reapuntar: la pose anterior se suelta antes de cambiar de dato
    st.target = n.t; st.fn = n.fn;
    st.label = str(o.label) || (n.t && n.t.label) || '';
    st.caption = str(o.caption);
    st.returnLabel = str(o.returnLabel);
    if (isFn(o.onClose)) st.onClose = o.onClose;
    if (!wasOpen) {
      var ae = document.activeElement;
      st.opener = o.opener || (ae && ae !== document.body && ae.tagName ? ae : null);
      st.prev = { view: cc('getViewState') || null };
      st.open = true; st.forced = null;
      appEl.setAttribute('data-visor', 'open');
      if (isFn(A.stageSuspend)) A.stageSuspend(false);
      cc('setInsetVisible', false);
      if (!reduced() && vpEl) {
        vpEl.classList.add('es-visor-in');
        clearTimeout(st.anim); st.anim = setTimeout(function () { if (vpEl) vpEl.classList.remove('es-visor-in'); }, 420);
      }
      var N = Nv();
      if (N && isFn(N.overlayOpen)) st.tok = N.overlayOpen(function () { V.close({ fromNav: true }); });
      document.addEventListener('keydown', onKey);
      if (isFn(A.hidePeek)) A.hidePeek();
      colapsarEnTelefono();
    }
    pintar();
    guardar();
    clearTimeout(st.aimT);
    st.aimT = setTimeout(aplicar, wasOpen ? 0 : (o.restoring ? 120 : 70));         // el canvas necesita medirse de nuevo antes de volar a un mando
    if (A && isFn(A.kick)) A.kick();
    avisar();
    return true;
  };

  V.close = function (o) {
    o = o || {};
    if (!st.open) return false;
    clearTimeout(st.aimT); clearTimeout(st.anim);
    var tok = st.tok, opener = st.opener, prev = st.prev, cb = st.onClose, target = st.target, cap = st.caption, label = st.label;
    if (o.fromNav) st.forced = { target: target, caption: cap, label: label, returnLabel: st.returnLabel, t: now() };
    soltarPose();
    if (st.sheetPrev && A && isFn(A.sheetRestore)) { try { A.sheetRestore(st.sheetPrev); } catch (e0) { /* idem */ } }
    st.sheetPrev = null;
    st.open = false; st.tok = null; st.opener = null; st.prev = null; st.onClose = null; st.target = null; st.fn = null;
    document.removeEventListener('keydown', onKey);
    if (appEl) appEl.removeAttribute('data-visor');
    if (vpEl) vpEl.classList.remove('es-visor-in');
    ss('del', SKEY);
    if (tok) { var N = Nv(); if (N && isFn(N.overlayClosed)) N.overlayClosed(tok); }
    if (o.restore !== false && A) {
      cc('setInsetVisible', true);
      if (prev && prev.view) cc('setViewState', prev.view, { smooth: false });
      cc('select', null);
    } else if (A) cc('setInsetVisible', true);
    if (isFn(A && A.stageSuspend) && A.getMode && A.getMode() === 'escuela' && !o.keepRunning) A.stageSuspend(true);
    if (A && isFn(A.kick)) A.kick();
    if (isFn(cb)) { try { cb(); } catch (e) { /* idem */ } }
    if (o.focus !== false && !o.fromNav) {
      var el = opener && opener.isConnected && !opener.disabled ? opener : null;
      if (!el) { var sec = document.getElementById('panel-escuela'); el = sec; }
      if (el && isFn(el.focus)) { try { el.focus({ preventScroll: true }); } catch (e2) { /* sin foco */ } }
      if (el && opener === el && isFn(el.scrollIntoView)) { try { el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e3) { /* idem */ } }
    }
    avisar();
    return true;
  };

  /* ------------------------------------------------------------------ proveedor de Nav y reload */
  V.capture = function () {
    if (st.open && st.target) return { open: true, target: V.target(), caption: st.caption, label: st.label, returnLabel: st.returnLabel };
    var f = st.forced;                                                // Nav acaba de cerrarlo para navegar (ABRIR / paso / UP): la foto debe recordarlo abierto
    if (f && f.target && now() - f.t < 400) return { open: true, target: JSON.parse(JSON.stringify(f.target)), caption: f.caption, label: f.label, returnLabel: f.returnLabel };
    return { open: false };
  };
  V.restore = function (o) {
    if (o && o.open && o.target) V.open(o.target, { caption: o.caption, label: o.label, returnLabel: o.returnLabel, restoring: true });
    else if (st.open) V.close({ restore: false, focus: false });
  };
  V.resume = function (ruta) {
    if (st.open) return false;
    var raw = ss('get', SKEY), d = null;
    if (!raw) return false;
    try { d = JSON.parse(raw); } catch (e) { d = null; }
    ss('del', SKEY);
    if (!d || !d.target || (d.ruta && ruta && d.ruta !== ruta) || (d.t && now() - d.t > 60000)) return false;      // sólo para un reload de verdad (≤ 1 min)
    retry = 0;
    V.open(d.target, { caption: d.caption, label: d.label, returnLabel: d.returnLabel, restoring: true });
    return true;
  };

  V.normalizar = normalizar;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(root.C150);
