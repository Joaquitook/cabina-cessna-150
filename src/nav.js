var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * nav.js — C150.Nav: one coherent "volver atrás" for the whole app (contract v6, docs/NAVEGACION.md).
 *
 * Three kinds of actions, used the same way everywhere:
 *   MIRAR (look)   Nav.look(fn, {label})   only the 3D camera / view moves; the tab never changes. The chip
 *                  "Volver a la vista anterior" (over the dock) puts the camera, main view and layout back (Nav.restoreLook()).
 *   ABRIR (open)   Nav.push(route, {returnLabel, run})   a detail in another place: the current location (route + provider
 *                  state + scroll + 3D) stays on the stack and the destination shows a sticky "← Volver a …" bar.
 *   IR (navigate)  Nav.go(route, {run})   top nav, sub-tabs, Home tiles: ordinary history entries, no back bar.
 *   (detail)       Nav.detail(route, {run})   opening a card / lesson / run INSIDE the same tab: a history entry whose parent
 *                  is the list, so UP == Back; Nav.replace(route, {run}) changes the entry in place (prev / next, 3D taps).
 *
 * History: every route change does history.pushState({nav: id}, '', '#route'); popstate restores the snapshot of that entry
 * (route + provider state + panel scroll + 3D view). Forward works too. Modal overlays (search palette, help, dialogs) push a
 * pseudo entry (Nav.overlayOpen / overlayClosed) so the system Back closes them first.
 *
 * Layout of this file:
 *   1. pure core  Nav.create(env) → instance      (no DOM; Node-testable: tests/validate-nav.js)
 *   2. providers registry + label helpers          (Nav.registerProvider(mode, {...}), Nav.fmtLabel, Nav.crumbText)
 *   3. DOM glue   Nav.mount(api)                   (back bar, UP row + breadcrumb, look chip, Esc / Alt+←, popstate wiring)
 *   4. the singleton API used by ui.js and the other modules (Nav.go / push / detail / replace / back / up / look …)
 *
 * env (all optional) for Nav.create:
 *   history {pushState, replaceState, go|back|forward}   the browser's, or a fake in tests
 *   hash(route) → url fragment ('#route')       locRoute() → route read from the address bar (typed hash)
 *   capture() → plain snapshot {route, mode, label, prov, scroll, view}   taken just before leaving a location
 *   show(route, snap, meta)   performs the visible change. meta.kind: go | push | detail | replace | same | pop | ext
 *   label() → label of the current location      route() → route of the current state      up() → bool (provider-level UP)
 *   getView() / setView(view, {smooth})   the 3D view state (Core.getViewState / setViewState)
 *   now() · schedule(fn, ms) · unschedule(t)   injectable clocks
 *
 * Provider (per mode; registered by ui.js):
 *   { label()      'Lección «Los 3 ejes» · paso 3'        crumbs() ['Lecciones', 'Los 3 ejes', 'Paso 3']
 *     route()      'basico/tres-ejes'                      capture() → plain object        restore(obj)
 *     up() → bool  go to the tab's list (keeps activities) inDetail() → bool                canLeave() → bool
 *     active() → bool  an activity is in progress ("EN CURSO")     pause() / resume()  when the tab is left / entered }
 */
(function (root) {
  'use strict';
  var C150 = root.C150 = root.C150 || {};
  var Nav = C150.Nav = C150.Nav || {};

  var LOOK_IDLE_MS = 12000;           // the "Volver a la vista anterior" chip goes away after this long without a look
  function isFn(f) { return typeof f === 'function'; }

  /* ================================================================== 1. pure core */
  function create(env) {
    env = env || {};
    var H = env.history || null;
    var real = false;                                   // true once the browser history accepted a pushState / replaceState
    var sid = (env.sid || Math.floor(Math.random() * 1e6).toString(36)) + '';
    var seq = 0;
    var entries = [], idx = -1;
    var listeners = {};
    var queue = [], expects = [], timer = null;
    var overlays = [];
    var look = null;

    function now() { return isFn(env.now) ? env.now() : Date.now(); }
    function sched(fn, ms) { return isFn(env.schedule) ? env.schedule(fn, ms) : setTimeout(fn, ms); }
    function unsched(t) { if (isFn(env.unschedule)) env.unschedule(t); else clearTimeout(t); }
    function hashOf(route) { return isFn(env.hash) ? env.hash(route) : '#' + route; }
    function emit(ev, arg) {
      var l = listeners[ev];
      if (!l) return;
      l.slice().forEach(function (fn) { try { fn(arg); } catch (e) { if (root.console) console.error('[Nav] ' + ev, e); } });
    }
    function cur() { return entries[idx] || null; }
    function indexOfId(id) { for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return i; return -1; }
    function mk(route, kind) { seq++; return { id: 'n' + sid + '.' + seq, route: String(route || ''), kind: kind, snap: null, ret: null, parent: null }; }
    function capture() { try { return isFn(env.capture) ? env.capture() : null; } catch (e) { if (root.console) console.error('[Nav] capture', e); return null; } }
    function show(route, snap, meta) { if (isFn(env.show)) { try { env.show(route, snap, meta); } catch (e) { if (root.console) console.error('[Nav] show', e); } } }

    function writeHist(op, e) {
      if (!H || !isFn(H[op + 'State'])) { real = false; return false; }
      try { H[op + 'State']({ nav: e.id }, '', hashOf(e.route)); real = true; return true; }
      catch (x) { real = false; return false; }
    }

    /* ---- queue: while a history traversal we started is still in flight, new navigations wait for its popstate */
    function flush() {
      while (queue.length && !expects.length) {
        var f = queue.shift();
        try { f(); } catch (e) { if (root.console) console.error('[Nav] queued', e); }
      }
    }
    function armWatchdog() {
      if (timer) return;
      timer = sched(function () {
        timer = null;
        if (!expects.length) return;
        var ex = expects.shift();          // the popstate never came: do it by hand and stop trusting the browser history
        real = false;
        if (ex.kind === 'travel') travel(ex.target);
        if (expects.length) armWatchdog(); else flush();
      }, 450);
    }
    function disarm() { if (timer && !expects.length) { unsched(timer); timer = null; } }

    /* ---- moving through the entries */
    function clearLook(silent) {
      if (!look) return false;
      look = null;
      if (!silent) emit('look', { active: false });
      return true;
    }
    function travel(t) {
      t = Math.max(0, Math.min(entries.length - 1, t));
      var from = cur();
      if (from) from.snap = capture();
      clearLook();
      idx = t;
      var e = entries[idx];
      show(e.route, e.snap, { kind: 'pop', entry: e });
      emit('change', { kind: 'pop' });
    }
    function traverse(target) {
      if (target < 0 || target > entries.length - 1 || target === idx) return false;
      if (overlays.length) closeOverlays();
      if (real && H) {
        expects.push({ kind: 'travel', target: target });
        armWatchdog();
        try {
          if (isFn(H.go)) H.go(target - idx);
          else if (target < idx) H.back();
          else H.forward();
        } catch (e) { expects.pop(); real = false; travel(target); }
        return true;
      }
      travel(target);
      return true;
    }

    /** A history traversal we started has not arrived yet: the new request waits for it and is evaluated afterwards. */
    function inflight(fn) { if (!expects.length) return false; queue.push(fn); return true; }

    function init(route) {
      var e = mk(route, 'init');
      entries = [e]; idx = 0;
      writeHist('replace', e);
      emit('change', { kind: 'init' });
      return e;
    }

    /** kind: go (IR) | push (ABRIR) | detail (same tab) | replace. opts: {returnLabel, run, force, label} */
    function navigate(kind, route, opts) {
      opts = opts || {};
      route = String(route || '');
      if (overlays.length) closeOverlays();
      if (expects.length) { queue.push(function () { navigate(kind, route, opts); }); return null; }
      var c = cur();
      if (!c) c = init(route);
      function perform(snap, meta) {
        if (isFn(opts.run)) { try { opts.run(); } catch (e) { if (root.console) console.error('[Nav] run', e); } }
        else show(route, snap, meta);
      }
      if (kind === 'replace') {
        c.route = route;
        writeHist('replace', c);
        perform(null, { kind: 'replace', entry: c });
        emit('change', { kind: 'replace' });
        return c;
      }
      if (c.route === route && !opts.force) {                       // dedupe: already here
        perform(null, { kind: 'same', entry: c });
        emit('change', { kind: 'same' });
        return c;
      }
      c.snap = capture();
      var label = opts.returnLabel || (c.snap && c.snap.label) || (isFn(env.label) ? safeLabel() : '');
      entries.length = idx + 1;                                      // the browser drops the forward entries too
      var e = mk(route, kind);
      if (kind === 'push') e.ret = { label: label, dismissed: false };
      if (kind === 'detail') e.parent = c.parent || c.id;          // every detail of a chain points at the list it came from
      entries.push(e); idx++;
      writeHist('push', e);
      clearLook();
      perform(null, { kind: kind, entry: e });
      emit('change', { kind: kind });
      return e;
    }
    function safeLabel() { try { return env.label(); } catch (e) { return ''; } }

    function onPop(state) {
      var ex = expects.shift();
      disarm();
      if (ex && ex.kind === 'ignore') { flush(); return 'ignored'; }       // the pop of a pseudo entry we closed ourselves
      var id = state && state.nav, k = -1, i;
      if (state && state.ov) for (i = 0; i < overlays.length; i++) if (overlays[i].id === id) k = i;
      if (state && state.ov && k < 0) {
        expects.push({ kind: 'ignore' }); armWatchdog();                   // forward onto a dead pseudo entry: bounce back
        try { H.back(); } catch (e2) { expects.pop(); }
        return 'stale';
      }
      if (overlays.length) {                                              // Back while overlays are open: close the ones above, stay
        while (overlays.length > k + 1) {
          var o = overlays.pop();
          o.popped = true;
          try { o.close(); } catch (e) { if (root.console) console.error('[Nav] overlay close', e); }
        }
        if (k >= 0 || !id || (cur() && id === cur().id)) { flush(); return 'overlay'; }
      }
      var ti = id ? indexOfId(id) : -1;
      if (ti >= 0) {
        if (ti !== idx) travel(ti);
        flush();
        return 'travel';
      }
      // unknown entry (the address bar was edited, or the page was reloaded): adopt it as a new location
      var route = isFn(env.locRoute) ? env.locRoute() : '';
      var c = cur();
      if (c && route === c.route) { writeHist('replace', c); flush(); return 'same'; }
      if (c) c.snap = capture();
      entries.length = idx + 1;
      var ne = mk(route, 'ext');
      entries.push(ne); idx++;
      writeHist('replace', ne);
      clearLook();
      show(route, null, { kind: 'ext', entry: ne });
      emit('change', { kind: 'ext' });
      flush();
      return 'adopted';
    }

    /* ---- overlays: modal things that the system Back button must close first */
    function overlayOpen(close) {
      var tok = { id: 'ov' + sid + '.' + (++seq), close: close, popped: false };
      overlays.push(tok);
      if (real && H) {
        try { H.pushState({ nav: tok.id, ov: true }, '', hashOf(cur() ? cur().route : '')); } catch (e) { real = false; }
      }
      return tok;
    }
    function overlayClosed(tok) {
      var i = overlays.indexOf(tok);
      if (i < 0) return false;
      overlays.splice(i, 1);
      if (tok.popped || !real || !H) return true;
      expects.push({ kind: 'ignore' }); armWatchdog();
      try { H.back(); } catch (e) { expects.pop(); real = false; }
      return true;
    }
    function closeOverlays() {
      var n = 0;
      while (overlays.length && n++ < 20) {
        var o = overlays[overlays.length - 1];
        try { o.close(); } catch (e) { if (root.console) console.error('[Nav] overlay close', e); }
        if (overlays.indexOf(o) >= 0) overlayClosed(o);
      }
    }

    /* ---- the return bar ("← Volver a …") */
    /** The pushed entry that owns the return for entry i: itself, or the one it was opened from through same-tab details. */
    function retIndex(i) {
      for (var j = i; j >= 0; j--) {
        var e = entries[j];
        if (e.ret) return e.ret.dismissed ? -1 : j;
        if (e.kind !== 'detail') return -1;
      }
      return -1;
    }

    /* ---- the 3D "look" */
    function doLook(fn, o) {
      o = o || {};
      if (!look) look = { view: isFn(env.getView) ? env.getView() : null, label: o.label || '', t: now(), manual: 0 };
      else if (o.label) look.label = o.label;
      look.t = now(); look.manual = 0;
      if (isFn(fn)) { try { fn(); } catch (e) { if (root.console) console.error('[Nav] look', e); } }
      emit('look', { active: true });
      return true;
    }

    var api = {
      init: init, onPop: onPop,
      go: function (route, opts) { return navigate('go', route, opts); },
      push: function (route, opts) { return navigate('push', route, opts); },
      detail: function (route, opts) { return navigate('detail', route, opts); },
      replace: function (route, opts) { return navigate('replace', route, opts); },
      back: function () { if (inflight(api.back)) return true; return traverse(idx - 1); },
      forward: function () { if (inflight(api.forward)) return true; return traverse(idx + 1); },
      /** Back to where the return bar points (the location before the ABRIR), through any details opened since. */
      returnBack: function () { if (inflight(api.returnBack)) return true; var j = retIndex(idx); return j > 0 ? traverse(j - 1) : false; },
      up: function () {
        if (inflight(api.up)) return true;                              // one traversal at a time (Esc reaches both Nav and Core)
        var c = cur();
        if (!c) return false;
        var pi = c.parent ? indexOfId(c.parent) : -1;
        if (pi >= 0 && pi < idx) return traverse(pi);                   // the list this detail was opened from: UP is a (multi-step) Back
        if (isFn(env.up)) {
          var done = false;
          try { done = !!env.up(); } catch (e) { if (root.console) console.error('[Nav] up', e); }
          if (done) { c.parent = null; api.sync(); emit('change', { kind: 'up' }); }
          return done;
        }
        return false;
      },
      /** Makes the current entry's route follow the real state (a card opened by a tap in 3D, a closed detail…) without a new entry. */
      sync: function () {
        var c = cur();
        if (!c || !isFn(env.route) || expects.length) return false;
        var r = '';
        try { r = env.route(); } catch (e) { r = ''; }
        if (!r || r === c.route) return false;
        c.route = r;
        writeHist('replace', c);
        emit('change', { kind: 'sync' });
        return true;
      },
      canBack: function () { return idx > 0; },
      canForward: function () { return idx < entries.length - 1; },
      backLabel: function () { var j = retIndex(idx); return j >= 0 ? entries[j].ret.label : ''; },
      hasReturn: function () { return retIndex(idx) >= 0; },
      clearReturn: function () { var j = retIndex(idx); if (j < 0) return false; entries[j].ret.dismissed = true; emit('change', { kind: 'return' }); return true; },
      stackSize: function () { return entries.length; },
      index: function () { return idx; },
      currentRoute: function () { return cur() ? cur().route : ''; },
      isReal: function () { return real; },
      snapshot: function () {
        return { idx: idx, size: entries.length, overlays: overlays.length, look: !!look,
          entries: entries.map(function (e) { return { id: e.id, route: e.route, kind: e.kind, parent: e.parent, ret: e.ret ? { label: e.ret.label, dismissed: e.ret.dismissed } : null, snap: e.snap ? true : false }; }) };
      },
      entry: function (i) { return entries[i] || null; },
      /* look */
      look: doLook,
      restoreLook: function () {
        if (!look) return false;
        var l = look;
        look = null;
        if (isFn(env.setView) && l.view) { try { env.setView(l.view, { smooth: true }); } catch (e) { if (root.console) console.error('[Nav] setView', e); } }
        emit('look', { active: false, restored: true });
        return true;
      },
      clearLook: function () { return clearLook(); },
      hasLook: function () { return !!look; },
      lookInfo: function () { return look ? { label: look.label, t: look.t } : null; },
      /** The student moved the camera by hand: the chip stays for LOOK_IDLE_MS more, then goes away. */
      noteManual: function () { if (look && now() - look.t > 300) look.manual = now(); },
      tick: function (t) { t = t === undefined ? now() : t; if (look && look.manual && t - look.manual > LOOK_IDLE_MS) clearLook(); },
      /* overlays */
      overlayOpen: overlayOpen, overlayClosed: overlayClosed, closeOverlays: closeOverlays,
      overlayCount: function () { return overlays.length; },
      pending: function () { return expects.length + queue.length; },
      on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return function () { var l = listeners[ev] || [], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
    };
    return api;
  }

  /* ================================================================== 2. providers + labels */
  var providers = {};
  Nav.registerProvider = function (mode, p) { if (mode && p) providers[mode] = p; return p; };
  Nav.provider = function (mode) { return providers[mode] || null; };
  Nav.providers = function () { return Object.keys(providers); };

  /** fmtLabel({kind:'Lección', title:'Los 3 ejes', detail:'paso 3'}) → 'Lección «Los 3 ejes» · paso 3' */
  Nav.fmtLabel = function (o) {
    o = o || {};
    var s = o.kind || '';
    if (o.title) s += (s ? ' ' : '') + '«' + o.title + '»';
    if (o.detail) s += (s ? ' · ' : '') + o.detail;
    return s || o.fallback || '';
  };
  /** crumbText(['Lecciones', 'Los 3 ejes', 'Paso 3']) → 'Lecciones › Los 3 ejes › Paso 3' */
  Nav.crumbText = function (list) { return (list || []).filter(Boolean).join(' › '); };
  Nav.create = create;
  Nav.LOOK_IDLE_MS = LOOK_IDLE_MS;

  /* ================================================================== 3. DOM glue */
  var inst = null;            // the live instance (after mount)
  var G = null;               // glue state

  function mount(api) {
    if (typeof document === 'undefined' || inst) return inst;
    var doc = api.doc || document, win = api.win || window;
    G = { api: api, doc: doc, win: win, key: '', liveKey: '', el: {}, chip: null, chipBtn: null, chipText: null, last: 0 };
    inst = create({
      history: win.history, hash: function (r) { return '#' + r; },
      locRoute: function () { return String(win.location.hash || '').replace(/^#\/?/, ''); },
      capture: api.capture, show: api.show, label: api.label, route: api.route, up: api.up,
      getView: api.getView, setView: api.setView
    });
    inst.init(api.route());
    win.addEventListener('popstate', function (e) { inst.onPop(e.state); });
    var $ = function (id) { return doc.getElementById(id); };
    G.el = { head: $('panel-head'), bar: $('navbar'), ret: $('nav-return'), retBtn: $('nav-return-btn'), retT: $('nav-return-t'), retX: $('nav-return-x'),
      up: $('nav-up'), upBtn: $('nav-up-btn'), crumbs: $('nav-crumbs'), live: $('panel-live') };
    if (G.el.retBtn) G.el.retBtn.addEventListener('click', function () { inst.returnBack(); announce('Volviste a ' + (G.el.retT && G.el.retT.textContent || '')); });
    if (G.el.retX) G.el.retX.addEventListener('click', function () { inst.clearReturn(); render(true); });
    if (G.el.upBtn) G.el.upBtn.addEventListener('click', function () { if (inst.up()) { render(true); focusPanel(); } });
    buildChip();
    inst.on('change', function () { render(true); });
    inst.on('look', function () { renderChip(); });
    doc.addEventListener('keydown', onKey);
    render(true);
    return inst;
  }

  function announce(text) { if (G && G.api && isFn(G.api.announce)) G.api.announce(text); }
  function focusPanel() { if (G && G.api && isFn(G.api.focusPanel)) G.api.focusPanel(); }
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
  }
  function onKey(e) {
    if (!inst) return;
    if (e.key === 'Escape' && !e.defaultPrevented && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (inst.overlayCount()) return;                                  // overlays close themselves first (capture phase)
      if (inst.hasLook()) { inst.restoreLook(); e.preventDefault(); return; }
      if (inst.up()) { e.preventDefault(); render(true); }
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !inst.isReal()) {      // with a real history the browser does Alt+← / Alt+→ itself
      if (e.key === 'ArrowLeft') { e.preventDefault(); inst.back(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); inst.forward(); }
    }
  }

  /** The chip "Volver a la vista anterior": first group of the dock (same glass language as VISTA / DISEÑO / ESCENARIO). */
  function buildChip() {
    var doc = G.doc, h = G.api.h;
    if (!h) return;
    var ic = G.api.icon ? G.api.icon('back') : null;
    G.chipText = [h('span', { class: 'look-chip-long', text: 'Volver a la vista anterior' }), h('span', { class: 'look-chip-short', text: 'Vista anterior' })];
    G.chipBtn = h('button', { type: 'button', class: 'look-chip-btn', id: 'look-chip-btn', 'aria-label': 'Volver a la vista anterior', title: 'Volver a donde estaba la cámara (Esc)' }, ic, G.chipText);
    G.chipBtn.addEventListener('click', function () { inst.restoreLook(); });
    G.chip = h('div', { class: 'dock-group dock-group--look', id: 'look-chip', role: 'group', 'aria-label': 'Vista del 3D', hidden: true }, G.chipBtn);
    var dock = doc.getElementById('dock'), bottom = doc.getElementById('vp-bottom');
    if (dock) dock.insertBefore(G.chip, dock.firstChild);
    else if (bottom) bottom.appendChild(G.chip);
  }
  function renderChip() {
    if (!G || !G.chip) return;
    var on = inst.hasLook();
    if (G.chip.hidden === !on) return;
    G.chip.hidden = !on;
    if (on) announce('La cámara se movió. Tenés el botón “Volver a la vista anterior” abajo.');
    var dock = G.doc.getElementById('dock');
    if (dock && isFn(dock.refresh)) dock.refresh();
  }

  /** Redraws the return bar, the UP row + breadcrumb and the "EN CURSO" dots; cheap when nothing changed (called ≈ 15 Hz). */
  function render(force) {
    if (!G || !inst) return;
    var api = G.api, mode = api.getMode ? api.getMode() : null, p = providers[mode] || null;
    var retLabel = inst.hasReturn() ? inst.backLabel() : '';
    var detail = false, crumbs = [];
    if (p) { try { detail = !!(isFn(p.inDetail) && p.inDetail()); crumbs = detail && isFn(p.crumbs) ? (p.crumbs() || []) : []; } catch (e) { detail = false; } }
    var extra = false;
    if (isFn(api.extra)) { try { extra = !!api.extra(); } catch (e2) { extra = false; } }
    var key = [mode, retLabel, detail ? 1 : 0, crumbs.join('›'), inst.hasLook() ? 1 : 0, extra ? 1 : 0].join('|');
    if (force || key !== G.key) {
      G.key = key;
      var el = G.el;
      if (el.ret) {
        el.ret.hidden = !retLabel;
        if (el.retT) { while (el.retT.firstChild) el.retT.removeChild(el.retT.firstChild); el.retT.appendChild(G.doc.createTextNode(retLabel)); }
        if (el.retBtn) { el.retBtn.setAttribute('aria-label', 'Volver a ' + retLabel); el.retBtn.title = 'Volver a ' + retLabel; }
      }
      if (el.up) {
        el.up.hidden = !detail;
        if (el.crumbs) {
          while (el.crumbs.firstChild) el.crumbs.removeChild(el.crumbs.firstChild);
          crumbs.forEach(function (c, i) {
            var li = G.doc.createElement('li');
            li.textContent = c;
            if (i === crumbs.length - 1) li.setAttribute('aria-current', 'location');
            el.crumbs.appendChild(li);
          });
        }
        if (el.upBtn) el.upBtn.setAttribute('aria-label', crumbs.length ? 'Subir a ' + crumbs[0] + ' (Esc)' : 'Subir (Esc)');
      }
      var on = !!retLabel || detail || extra;
      if (el.bar) el.bar.hidden = !on;
      if (el.head) el.head.classList.toggle('has-nav', on);
      if (api.onNavRender) api.onNavRender({ mode: mode, returnLabel: retLabel, detail: detail, crumbs: crumbs, extra: extra });
      renderChip();
    }
    renderLive();
  }
  /** "EN CURSO": a dot on the tab / sub-tab whose activity is in progress. */
  function renderLive() {
    if (!G) return;
    var live = [], key;
    Object.keys(providers).forEach(function (m) {
      var p = providers[m];
      try { if (p && isFn(p.active) && p.active()) live.push(m); } catch (e) { /* un proveedor roto no rompe la barra */ }
    });
    key = live.join(',');
    if (key === G.liveKey) return;
    G.liveKey = key;
    var api = G.api, doc = G.doc;
    var nodes = doc.querySelectorAll('.nav-item[data-group], .subtab[data-mode]'), i;
    var groups = {};
    live.forEach(function (m) { groups[api.groupOf ? api.groupOf(m) : m] = true; });
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i], isSub = n.classList.contains('subtab');
      var on = isSub ? live.indexOf(n.getAttribute('data-mode')) >= 0 : !!groups[n.getAttribute('data-group')];
      if (on) n.setAttribute('data-live', '1'); else n.removeAttribute('data-live');
      var lbl = n.getAttribute('data-label0');
      if (lbl === null) { lbl = n.getAttribute('aria-label') || ''; n.setAttribute('data-label0', lbl); }
      if (on) n.setAttribute('aria-label', ((n.textContent || '').trim() + ': en curso').replace(/\s+/g, ' ')); else if (lbl) n.setAttribute('aria-label', lbl); else n.removeAttribute('aria-label');
    }
    if (api.onLive) api.onLive(live);
  }

  /* ================================================================== 4. the singleton API */
  function d(name, fallback) {
    return function () {
      if (!inst) return isFn(fallback) ? fallback.apply(null, arguments) : fallback;
      return inst[name].apply(inst, arguments);
    };
  }
  Nav.mount = mount;
  Nav.mounted = function () { return !!inst; };
  Nav.instance = function () { return inst; };
  Nav.go = d('go', null);                    // IR
  Nav.push = d('push', null);                // ABRIR
  Nav.detail = d('detail', null);            // open something inside the same tab
  Nav.replace = d('replace', null);
  Nav.back = d('back', false);
  Nav.forward = d('forward', false);
  Nav.returnBack = d('returnBack', false);
  Nav.up = d('up', false);
  Nav.sync = d('sync', false);
  Nav.canBack = d('canBack', false);
  Nav.canForward = d('canForward', false);
  Nav.backLabel = d('backLabel', '');
  Nav.hasReturn = d('hasReturn', false);
  Nav.clearReturn = d('clearReturn', false);
  Nav.stackSize = d('stackSize', 0);
  Nav.currentRoute = d('currentRoute', '');
  Nav.isReal = d('isReal', false);
  Nav.pending = d('pending', 0);
  Nav.snapshot = d('snapshot', null);
  Nav.restoreLook = d('restoreLook', false);
  Nav.clearLook = d('clearLook', false);
  Nav.hasLook = d('hasLook', false);
  Nav.noteManual = d('noteManual', undefined);
  Nav.overlayOpen = d('overlayOpen', null);
  Nav.overlayClosed = d('overlayClosed', false);
  Nav.closeOverlays = d('closeOverlays', undefined);
  Nav.overlayCount = d('overlayCount', 0);
  /** Nav.look(fn, {label}): runs fn (moves the camera / view) after remembering the 3D view; shows the "Volver a la vista anterior" chip. */
  Nav.look = function (fn, o) {
    if (!inst) { if (isFn(fn)) fn(); return false; }
    return inst.look(fn, o);
  };
  Nav.on = function (ev, fn) { return inst ? inst.on(ev, fn) : function () {}; };
  /** Called by ui.js ≈ 15 Hz: look expiry + redraw of the bar / dots when something changed. */
  Nav.refresh = function (force) { if (!inst) return; inst.tick(); if (!force) inst.sync(); render(!!force); };

  if (typeof module !== 'undefined' && module.exports) module.exports = Nav;
})(root);
