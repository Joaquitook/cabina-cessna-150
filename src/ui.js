var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * ui.js — C150.UI: the whole app shell and every DOM interaction (contract §4 ui, §7, §8).
 *
 *   C150.UI.init()            boots once (auto on DOMContentLoaded): theme, tabs, help, viewport overlays,
 *                             Core.init({container:#viewport, state}) and the six modes.
 *   C150.UI.setMode(name)     'explorar' | 'basico' | 'recorrido' | 'checklists' | 'volar' | 'quiz'
 *   C150.UI.showControl(id)   opens Explorar with that control's card.
 *   C150.UI.getMode()         current mode name.
 *
 * Decisions where the contract leaves room (other agents: please read):
 *  - Every Core call goes through cc(): a missing core.js, a missing method or a failed WebGL start never
 *    throws. Without Core the panels still work and a tiny local loop steps C150.Sim so Probalo, the HUD,
 *    checklists and missions stay alive (quiz "¿dónde está?" questions are then skipped).
 *  - hold(id, subId, on) → Core.hold with subIds 'left' / 'right' for 'rudder-pedals' and 'toe-brakes'
 *    (null = both brakes), null for 'flap-switch' and 'ignition' (START). Without Core.hold the UI writes
 *    the inputs itself.
 *  - The Probalo yoke pad writes yokeRoll/yokePitch with Core.setInput and springs back itself (≈0.3 s).
 *  - Master, ignition and flap switch positions go through C150.Sim.actions (interlock + START feedback).
 *  - Caption under the inset: Core.getCaption() if present, else Core.exterior.caption, else a `caption`
 *    field in the 3rd argument of the 'frame' event.
 *  - Checklist items are latched IN ORDER (learning.js header): only the current item is evaluated,
 *    at most one tick per evaluation (≈ 8 Hz). Missions get a fresh ctx {t, dt, hold, data:{}} per attempt
 *    and are checked every frame, also while another tab is open.
 *  - Numbers in Spanish labels use a decimal comma (29,92 inHg); radio readouts use a dot, like the
 *    real displays (118.10).
 *  - The 'select' event opens the card in Explorar; in other modes it shows a small "Tocaste…" bar
 *    instead of leaving the current activity.
 */
(function (C150) {
  'use strict';
  if (typeof document === 'undefined') return;

  var UI = C150.UI = C150.UI || {};
  var doc = document;
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ================================================================== utilities */

  function $(id) { return doc.getElementById(id); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function isFn(f) { return typeof f === 'function'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function logError(where, e) { if (root.console) console.error('[UI] ' + where, e); }
  function safe(fn, where) { try { return fn(); } catch (e) { logError(where || 'error', e); return undefined; } }

  /** h('div', {class, text, 'aria-x': '…', onclick: fn, style: {'--cat': '#fff'}}, ...children) */
  function h(tag, props) {
    var el = doc.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = String(v);
        else if (k === 'style') { for (var s in v) el.style.setProperty(s, v[s]); }
        else if (k.slice(0, 2) === 'on' && isFn(v)) el.addEventListener(k.slice(2), v);
        else if (k === 'hidden' || k === 'disabled') el[k] = true;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) add(el, c[i]); return; }
    el.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function setText(el, s) {
    s = (s === null || s === undefined) ? '' : String(s);
    if (el && el.textContent !== s) el.textContent = s;
  }
  function setAttr(el, k, v) { v = String(v); if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); }
  function toggleClass(el, c, on) { if (el && el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); }

  /** Decimal comma and a real minus sign, as written in Uruguay. */
  function fmt(n, d) {
    n = num(n, 0);
    var s = n.toFixed(d || 0);
    if (/^-0([.,]0+)?$/.test(s)) s = s.slice(1);
    return s.replace('.', ',').replace('-', '−');
  }
  function fmtSigned(n, d) { var s = fmt(n, d); return (num(n, 0) > 0 && s !== fmt(0, d)) ? '+' + s : s; }
  function heading3(h) {
    var n = Math.round(((num(h, 0) % 360) + 360) % 360);
    if (n === 0) n = 360;
    return ('00' + n).slice(-3);
  }
  function pct(v) { return Math.round(clamp(num(v, 0), 0, 1) * 100) + ' %'; }
  function norm(s) {
    s = String(s || '').toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* localStorage only inside try/catch (contract §1) */
  var store = {
    get: function (k, d) {
      try { var v = root.localStorage.getItem('c150.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { root.localStorage.setItem('c150.' + k, JSON.stringify(v)); } catch (e) { /* almacenamiento bloqueado */ }
    }
  };

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  var ICONS = {
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    warn: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
    plane: '<path d="M12 3c.9 0 1.4 1 1.4 2.6V10l8 2.4v2l-8-1v4.6l2.6 2v1.6L12 20.6l-4 1v-1.6l2.6-2v-4.6l-8 1v-2l8-2.4V5.6C10.6 4 11.1 3 12 3z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5V4.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v6.5a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.6 14a1.5 1.5 0 0 1 2.4-1.8L9 15"/>',
    retry: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/>',
    cabin: '<path d="M3 18c2-7 5-10 9-10s7 3 9 10"/><path d="M8 18v-3h8v3"/>'
  };
  function icon(name) {
    var s = doc.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.innerHTML = ICONS[name] || '';           // static markup only, never data
    return s;
  }

  /* ================================================================== data access */

  var DATA = C150.DATA || {};
  var CONTROLS = arr(DATA.controls).filter(function (c) { return c && c.id; });
  var CATEGORIES = arr(DATA.categories);
  var CTRL = {};
  CONTROLS.forEach(function (c) { CTRL[c.id] = c; });
  var CAT = {};
  CATEGORIES.forEach(function (c) { if (c && c.id) CAT[c.id] = c; });
  var META = DATA.meta || {};
  var AVISO = META.aviso || 'Basado en un Cessna 150M 1976. El avión de tu escuela puede tener diferencias: siempre manda el manual (POH) y el instructor.';

  function catColor(c) { var k = c && CAT[c.categoria]; return (k && k.color) || 'var(--fg-soft)'; }
  function ctrlName(id) { var c = CTRL[id]; return c ? c.nombre : id; }
  function dot(color) { return h('span', { class: 'dot', 'aria-hidden': 'true', style: { '--cat': color } }); }

  /* ================================================================== Core bridge */

  var coreReady = false;
  function Core() { return coreReady ? C150.Core : null; }
  function has(name) { var c = Core(); return !!(c && isFn(c[name])); }
  function cc(name) {
    var c = Core();
    if (!c || !isFn(c[name])) return undefined;
    try { return c[name].apply(c, Array.prototype.slice.call(arguments, 1)); }
    catch (e) { logError('Core.' + name, e); return undefined; }
  }
  /** The ONE shared sim state (Core keeps the same reference it was given). */
  function S() { var c = Core(); return (c && c.state) || UI.state || null; }

  function getPath(o, path) {
    var p = String(path).split('.');
    for (var i = 0; i < p.length; i++) { if (o === null || o === undefined) return undefined; o = o[p[i]]; }
    return o;
  }
  function setPath(o, path, v) {
    var p = String(path).split('.');
    for (var i = 0; i < p.length - 1; i++) { if (o[p[i]] === null || typeof o[p[i]] !== 'object') o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = v;
  }
  function getInput(path) { var s = S(); return s ? getPath(s, path) : undefined; }
  function setInput(path, v) {
    if (has('setInput')) cc('setInput', path, v);
    else { var s = S(); if (s) setPath(s, path, v); }
    kick();
  }
  function simAction(name, a, b) {
    var A = C150.Sim && C150.Sim.actions, s = S();
    if (!A || !isFn(A[name]) || !s) return undefined;
    try { var r = A[name](s, a, b); kick(); return r; } catch (e) { logError('Sim.actions.' + name, e); return undefined; }
  }
  function setMaster(which, on) {
    if (simAction('setMaster', which, on) === undefined) setInput(which === 'alt' ? 'masterAlt' : 'masterBat', !!on);
  }
  function setIgnition(pos) {
    if (simAction('setIgnition', pos) === undefined) setInput('ignition', pos);
  }
  function setFlapSwitch(pos) {
    if (simAction('setFlapSwitch', pos) === undefined) setInput('flapSwitch', pos);
  }
  /** Press-and-hold (pedals, brakes, flap DOWN, ignition START). */
  function hold(id, sub, on) {
    if (has('hold')) { cc('hold', id, sub, !!on); kick(); return; }
    var s = S();
    if (!s) return;
    if (id === 'rudder-pedals') s.rudder = on ? (sub === 'right' ? 1 : -1) : 0;
    else if (id === 'toe-brakes') {
      if (sub !== 'right') s.brakeL = on ? 1 : 0;
      if (sub !== 'left') s.brakeR = on ? 1 : 0;
    } else if (id === 'flap-switch') setFlapSwitch(on ? 'DOWN' : 'OFF');
    else if (id === 'ignition') setIgnition(on ? 'START' : 'BOTH');
    kick();
  }
  function operate(id, sub) { if (has('operate')) cc('operate', id, sub || null); kick(); }

  /** Select + (optionally) fly the camera to a control, remembering that the UI asked for it. */
  var progSel = null;
  function focusControl(id, focus) {
    if (!id) return;
    progSel = { id: id, t: now() };
    cc('select', id, { focus: focus !== false });
  }
  function isProgrammatic(id) { return !!(progSel && progSel.id === id && now() - progSel.t < 800); }

  var currentPreset = 'parked';
  var presetListeners = [];
  var applyingPreset = false;
  function applyPreset(name) {
    if (!name) return;
    if (has('applyPreset')) {
      applyingPreset = true;
      try { cc('applyPreset', name); } finally { applyingPreset = false; }
    } else if (C150.Sim && isFn(C150.Sim.applyPreset) && S()) safe(function () { C150.Sim.applyPreset(S(), name); }, 'applyPreset');
    presetApplied(name);
  }
  /** A sim preset was applied (by the UI or by anyone calling Core.applyPreset): keep the selector and listeners in sync. */
  function presetApplied(name) {
    currentPreset = name;
    var sel = $('vp-scenario-select');
    if (sel && sel.value !== name) sel.value = name;
    presetListeners.forEach(function (fn) { safe(function () { fn(name); }, 'preset listener'); });
    kick();
  }

  /* ================================================================== press-and-hold buttons */

  var activeHolds = [];
  function releaseAllHolds() {
    var list = activeHolds.slice();
    activeHolds.length = 0;
    list.forEach(function (end) { safe(end, 'release hold'); });
  }

  /** Button that calls onDown while pressed (pointer, Space or Enter) and onUp when released. */
  function holdButton(content, onDown, onUp, cls, label) {
    var down = false;
    var b = h('button', { type: 'button', class: 'btn ' + (cls || ''), 'aria-label': label || null, title: 'Mantené apretado' }, content);
    function end() {
      if (!down) return;
      down = false;
      var i = activeHolds.indexOf(end);
      if (i >= 0) activeHolds.splice(i, 1);
      b.classList.remove('is-down');
      onUp();
    }
    function start() {
      if (down || b.disabled) return;
      down = true;
      activeHolds.push(end);
      b.classList.add('is-down');
      onDown();
    }
    b.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ }
      start();
    });
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
    b.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) start(); }
    });
    b.addEventListener('keyup', function (e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); end(); }
    });
    b.addEventListener('blur', end);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return b;
  }

  /** Repeats `fn` while pressed (first at once, then every 70 ms after 400 ms). Keyboard: one step per click. */
  function repeatButton(content, fn, cls, label) {
    var t1 = 0, t2 = 0, pressed = false;
    var b = h('button', { type: 'button', class: 'btn ' + (cls || ''), 'aria-label': label || null }, content);
    function stop() { pressed = false; clearTimeout(t1); clearInterval(t2); }
    b.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ }
      pressed = true;
      fn();
      t1 = setTimeout(function () { t2 = setInterval(function () { if (pressed) fn(); }, 70); }, 400);
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('lostpointercapture', stop);
    b.addEventListener('click', function (e) { if (e.detail === 0) fn(); });   // keyboard activation
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return b;
  }

  /* ================================================================== modes framework */

  var MODES = ['explorar', 'basico', 'recorrido', 'checklists', 'volar', 'quiz'];
  var modeImpl = {};          // name → { render(section), enter(), exit(), slow(state), frame(state, dt) }
  var rendered = {};
  var scrollMem = {};
  var mode = null;

  function setMode(name, opts) {
    if (MODES.indexOf(name) < 0) name = 'explorar';
    if (name === mode) return;
    var panel = $('panel');
    if (mode) {
      scrollMem[mode] = panel.scrollTop;
      var prev = modeImpl[mode];
      releaseAllHolds();
      if (prev && prev.exit) safe(prev.exit, 'exit ' + mode);
      $('panel-' + mode).hidden = true;
    }
    mode = name;
    var app = $('app');
    if (app) app.setAttribute('data-mode', name);       // hook for per-mode CSS
    MODES.forEach(function (m) { var el = $('panel-' + m); if (el) el.hidden = m !== name; });
    var tabs = doc.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-mode') === name;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
      if (on && tabs[i].scrollIntoView && !(opts && opts.noScrollTab)) {
        safe(function () { tabs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      }
    }
    var sec = $('panel-' + name);
    sec.hidden = false;
    var impl = modeImpl[name];
    if (!rendered[name] && impl && impl.render) { rendered[name] = true; safe(function () { impl.render(sec); }, 'render ' + name); }
    if (impl && impl.enter) safe(impl.enter, 'enter ' + name);
    panel.scrollTop = scrollMem[name] || 0;
    hidePeek();
    if (!(opts && opts.fromHash)) {
      try { root.history.replaceState(null, '', '#' + name); } catch (e) { /* sin historial (sandbox) */ }
    }
    kick();
  }

  function scrollPanelTop() { var p = $('panel'); if (p) p.scrollTop = 0; }

  /* ================================================================== theme, sound, help, tabs */

  var THEME_LABEL = {
    auto: 'Tema: automático, según el sistema. Tocá para pasar a claro.',
    light: 'Tema: claro. Tocá para pasar a oscuro.',
    dark: 'Tema: oscuro. Tocá para volver a automático.'
  };
  function applyTheme(t) {
    var de = doc.documentElement, btn = $('btn-theme');
    if (t === 'light' || t === 'dark') de.setAttribute('data-theme', t);
    else { de.removeAttribute('data-theme'); t = 'auto'; }
    if (btn) { btn.setAttribute('data-mode', t); btn.setAttribute('aria-label', THEME_LABEL[t]); btn.title = THEME_LABEL[t]; }
    return t;
  }
  function setupTheme() {
    var t = applyTheme(store.get('theme', 'auto'));
    $('btn-theme').addEventListener('click', function () {
      t = applyTheme(t === 'auto' ? 'light' : (t === 'light' ? 'dark' : 'auto'));
      store.set('theme', t);
    });
  }

  /* Stall horn: optional WebAudio tone, created only after the student turns sound on (a user gesture). */
  var audio = { enabled: false, ctx: null, gain: null };
  function ensureAudio() {
    if (audio.ctx) return audio.ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      var ctx = new AC();
      var g = ctx.createGain(); g.gain.value = 0;
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1900;
      var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 560;
      var o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 566;
      var lfo = ctx.createOscillator(); lfo.frequency.value = 7;
      var depth = ctx.createGain(); depth.gain.value = 22;
      lfo.connect(depth); depth.connect(o1.frequency); depth.connect(o2.frequency);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(ctx.destination);
      o1.start(); o2.start(); lfo.start();
      audio.ctx = ctx; audio.gain = g;
      return ctx;
    } catch (e) { logError('audio', e); return null; }
  }
  function hornLevel(level, attack) {
    if (!audio.ctx || !audio.gain) return;
    var t = audio.ctx.currentTime;
    audio.gain.gain.cancelScheduledValues(t);
    audio.gain.gain.setTargetAtTime(level, t, attack || 0.03);
  }
  var stallOn = false;
  function updateHorn() { hornLevel((stallOn && audio.enabled && !doc.hidden) ? 0.05 : 0); }
  function setupSound() {
    var btn = $('btn-sound');
    btn.addEventListener('click', function () {
      audio.enabled = !audio.enabled;
      btn.setAttribute('aria-pressed', audio.enabled ? 'true' : 'false');
      btn.setAttribute('aria-label', 'Sonido de la bocina de pérdida: ' + (audio.enabled ? 'prendido' : 'apagado'));
      if (audio.enabled) {
        var ctx = ensureAudio();
        if (ctx) {
          safe(function () { if (ctx.resume) ctx.resume(); });
          if (!stallOn) {                                  // short chirp so the student hears it works
            hornLevel(0.04, 0.01);
            setTimeout(function () { if (!stallOn) hornLevel(0, 0.02); }, 180);
          }
        }
      } else if (audio.ctx) {
        hornLevel(0, 0.01);
        setTimeout(function () { if (!audio.enabled && audio.ctx && audio.ctx.suspend) safe(function () { audio.ctx.suspend(); }); }, 120);
      }
      updateHorn();
    });
    doc.addEventListener('visibilitychange', updateHorn);
  }

  var KEYS = [
    [['←', '→'], 'Volante: inclinar a la izquierda / a la derecha'],
    [['↑', '↓'], 'Volante: empujar (nariz abajo) / tirar (nariz arriba)'],
    [['Z', 'X'], 'Pedal izquierdo / derecho (en tierra también doblás)'],
    [['B'], 'Frenos (mantené apretado)'],
    [['+', '−'], 'Acelerador: más / menos (también RePág / AvPág)'],
    [['F'], 'Bajar flaps (mantené apretado)'],
    [['R'], 'Subir flaps'],
    [['T', 'G'], 'Compensador: nariz abajo / nariz arriba'],
    [['M'], 'Master (batería y alternador)'],
    [['1', '8'], 'Posiciones de la cámara (del 1 al 8)'],
    [['C'], 'Cambiar la vista grande: cabina o avión desde afuera'],
    [['P'], 'Pausa'],
    [['Esc'], 'Deseleccionar']
  ];
  function keysTable() {
    var tb = h('tbody');
    KEYS.forEach(function (k) {
      var th = h('th', { scope: 'row' });
      k[0].forEach(function (key, i) {
        if (i > 0) add(th, k[0].length === 2 && key === '8' ? ' a ' : ' ');
        add(th, h('kbd', { text: key }));
      });
      tb.appendChild(h('tr', null, th, h('td', { text: k[1] })));
    });
    return h('table', { class: 'keys' }, h('caption', { class: 'sr-only', text: 'Atajos de teclado' }), tb);
  }

  var helpReturn = null;
  function openHelp() {
    var m = $('help');
    if (!m.hidden) return;
    helpReturn = doc.activeElement;
    m.hidden = false;
    m.querySelector('.modal-card').focus();
    doc.addEventListener('keydown', helpKeys, true);
  }
  function closeHelp() {
    var m = $('help');
    if (m.hidden) return;
    m.hidden = true;
    doc.removeEventListener('keydown', helpKeys, true);
    if (helpReturn && helpReturn.focus) safe(function () { helpReturn.focus(); });
  }
  function helpKeys(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHelp(); return; }
    if (e.key === 'Tab') {
      var card = $('help').querySelector('.modal-card');
      var f = card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    e.stopPropagation();                         // flight keys do nothing while the help is open
  }
  /* Graphics quality (Core.setQuality): auto | alta | media | baja, remembered per browser. */
  var QUALITY_NOTE = {
    alta: 'Alta: sombras suaves, reflejos y texturas finas.',
    media: 'Media: sombras más simples y menos resolución. Ideal para celulares.',
    baja: 'Baja: sin sombras, lo más liviano posible.'
  };
  function syncQuality() {
    var seg = $('quality-seg'), note = $('quality-note');
    if (!seg) return;
    var setting = cc('getQualitySetting') || store.get('quality', 'auto'), level = cc('getQuality');
    var bs = seg.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-q') === setting ? 'true' : 'false');
    if (note && level && QUALITY_NOTE[level]) setText(note, (setting === 'auto' ? 'Automática → ' : '') + QUALITY_NOTE[level]);
  }
  function setupQuality() {
    var seg = $('quality-seg');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-q]') : null;
      if (!b) return;
      var q = b.getAttribute('data-q');
      store.set('quality', q);
      cc('setQuality', q);
      syncQuality();
    });
  }
  function setupHelp() {
    $('help-keys').appendChild(keysTable());
    setText($('help-aviso'), AVISO);
    $('btn-help').addEventListener('click', openHelp);
    $('help').addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== this) { if (t.getAttribute && t.getAttribute('data-close')) { closeHelp(); return; } t = t.parentNode; }
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === '?' && !isTyping(e.target)) { e.preventDefault(); openHelp(); }
    });
  }
  function isTyping(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  function setupTabs() {
    var tabs = Array.prototype.slice.call(doc.querySelectorAll('.tab'));
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { setMode(t.getAttribute('data-mode')); });
      t.addEventListener('keydown', function (e) {
        var j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = tabs.length - 1;
        if (j < 0) return;
        e.preventDefault(); e.stopPropagation();
        setMode(tabs[j].getAttribute('data-mode'));
        tabs[j].focus();
      });
    });
    root.addEventListener('hashchange', function () {
      var m = (root.location.hash || '').slice(1);
      if (MODES.indexOf(m) >= 0) setMode(m, { fromHash: true });
    });
  }

  /* ================================================================== viewport overlays */

  var CAMS = [
    ['pilot', 'Piloto'], ['flight', 'Vista afuera'], ['panel', 'Tablero'], ['left', 'Izquierda'],
    ['center', 'Centro'], ['right', 'Derecha'], ['floor', 'Piso'], ['overhead', 'Techo']
  ];
  var SCENARIOS = [
    ['parked', 'Estacionado'], ['runup', 'Listo en cabecera'], ['runway', 'En pista'],
    ['cruise', 'En vuelo'], ['approach', 'Aproximación']
  ];
  var SUB_NAMES = { left: 'izquierdo', right: 'derecho', window: 'ventanilla', alt: 'ALT', bat: 'BAT' };

  var mainView = 'cockpit';
  var insetRect = null;
  var labelsOn = false;
  var extraCaption = '';
  var status = {};

  function setupViewport() {
    // camera presets
    var list = $('vp-cams-list'), wrap = $('vp-cams'), toggle = $('vp-cams-toggle');
    CAMS.forEach(function (c) {
      list.appendChild(h('button', {
        type: 'button', class: 'cam-btn', 'data-cam': c[0],
        onclick: function () { cc('focusPreset', c[0]); closeCams(); }
      }, c[1]));
    });
    function closeCams() { wrap.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); }
    toggle.addEventListener('click', function () {
      var open = !wrap.classList.contains('is-open');
      wrap.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    doc.addEventListener('pointerdown', function (e) { if (!wrap.contains(e.target)) closeCams(); });
    wrap.addEventListener('keydown', function (e) { if (e.key === 'Escape' && wrap.classList.contains('is-open')) { e.stopPropagation(); closeCams(); toggle.focus(); } });

    // scenario switcher
    var sel = $('vp-scenario-select');
    var P = (C150.Sim && C150.Sim.PRESETS) || {};
    SCENARIOS.forEach(function (sc) {
      var desc = P[sc[0]] && (P[sc[0]].description || P[sc[0]].label);
      sel.appendChild(h('option', { value: sc[0], title: desc || null }, sc[1]));
    });
    sel.value = currentPreset;
    sel.addEventListener('change', function () { applyPreset(sel.value); });

    // inset buttons
    $('inset-swap').addEventListener('click', function () {
      cc('setMainView', mainView === 'exterior' ? 'cockpit' : 'exterior');
      syncMainView();
    });
    $('inset-labels').addEventListener('click', function () {
      labelsOn = !labelsOn;
      setExteriorLabels(labelsOn);
      $('inset-labels').setAttribute('aria-pressed', labelsOn ? 'true' : 'false');
    });

    buildStatus();

    // narrow viewport: scenario switcher moves to the bottom bar, next to "Vistas"
    var vp = $('viewport'), scen = doc.querySelector('.vp-scenario'), top = doc.querySelector('.vp-top');
    function place() {
      var narrow = vp.clientWidth < 760;
      var parent = narrow ? wrap : top;
      if (scen.parentNode !== parent) parent.appendChild(scen);
      positionInset();
    }
    if (root.ResizeObserver) new ResizeObserver(place).observe(vp);
    else root.addEventListener('resize', place);
    place();
  }

  function setExteriorLabels(on) {
    if (has('showExteriorLabels')) { cc('showExteriorLabels', on); return; }
    if (has('setExteriorLabels')) { cc('setExteriorLabels', on); return; }
    var c = Core(), ext = c && (c.exterior || c.ext);
    if (ext && isFn(ext.showLabels)) safe(function () { ext.showLabels(on); }, 'showLabels');
  }

  function getCaption() {
    var c = Core();
    if (c && isFn(c.getCaption)) { var t = safe(function () { return c.getCaption(); }); if (typeof t === 'string') return t; }
    var ext = c && (c.exterior || c.ext);
    if (ext && typeof ext.caption === 'string') return ext.caption;
    return extraCaption || '';
  }

  function syncMainView() {
    var v = cc('getMainView');
    if (v === 'cockpit' || v === 'exterior') mainView = v;
    var ext = mainView === 'exterior';
    setText($('inset-label'), ext ? 'Cabina' : 'Así se ve desde afuera');
    setAttr($('inset-swap'), 'aria-label', ext ? 'Volver a la cabina en grande' : 'Agrandar la vista de afuera');
    positionCaption();
  }

  function onLayout(r) {
    insetRect = (r && num(r.w, 0) > 0) ? { x: num(r.x, 0), y: num(r.y, 0), w: r.w, h: num(r.h, 0) } : null;
    positionInset();
  }
  function positionInset() {
    var f = $('inset-frame'), vp = $('viewport');
    if (!f) return;
    if (!insetRect) {
      f.hidden = true;
      vp.style.setProperty('--inset-w', '0px');
      positionCaption();
      return;
    }
    f.hidden = false;
    toggleClass(f, 'is-small', insetRect.w < 240);           // small inset (phones): buttons go below it
    f.style.left = insetRect.x + 'px';
    f.style.top = insetRect.y + 'px';
    f.style.width = insetRect.w + 'px';
    f.style.height = insetRect.h + 'px';
    vp.style.setProperty('--inset-w', Math.round(insetRect.w) + 'px');
    positionCaption();
  }
  var captionText = '';
  function positionCaption() {
    var cap = $('inset-caption');
    if (!cap) return;
    if (!captionText || (!insetRect && mainView !== 'exterior')) { cap.hidden = true; return; }
    cap.hidden = false;
    var st = cap.style;
    // big exterior, or a small inset (phones, where a caption under it would be clipped): caption as a subtitle
    if (mainView === 'exterior' || !insetRect || insetRect.w < 240) {
      // left+right+fit-content+auto margins: centred, and it may use the whole width (left:50% would halve it)
      st.left = '12px'; st.right = '12px'; st.top = 'auto'; st.bottom = (flypadShown() ? VO.overlay.offsetHeight + 74 : 62) + 'px';
      st.width = 'fit-content'; st.marginLeft = st.marginRight = 'auto';
      st.maxWidth = 'min(560px, calc(100% - 24px))'; st.transform = 'none'; st.textAlign = 'center';
    } else {
      st.left = insetRect.x + 'px'; st.right = 'auto'; st.top = (insetRect.y + insetRect.h + 6) + 'px'; st.bottom = 'auto';
      st.marginLeft = st.marginRight = '0';
      st.width = insetRect.w + 'px'; st.maxWidth = 'none'; st.transform = 'none'; st.textAlign = 'left';
    }
  }
  function updateCaption() {
    var t = getCaption();
    if (t !== captionText) { captionText = t; setText($('inset-caption'), t); positionCaption(); }
  }

  function onHover(id, sub, pos) {
    var tt = $('vp-tooltip');
    var c = id && CTRL[id];
    if (!c || !pos) { tt.hidden = true; return; }
    var name = c.nombre, en = c.ingles || '';
    if (sub) {
      var si = arr(c.subitems).filter(function (x) { return x && x.subId === sub; })[0];
      if (si) { name = si.nombre || (c.nombre + ' ' + sub); en = si.ingles || en; }
      else if (SUB_NAMES[sub]) name = c.nombre + ' (' + SUB_NAMES[sub] + ')';
    }
    setText(tt.querySelector('.vp-tooltip-name'), name);
    setText(tt.querySelector('.vp-tooltip-en'), en);
    tt.hidden = false;
    var vp = $('viewport');
    var x = num(pos.x, 0) + 16, y = num(pos.y, 0) + 16;
    var w = tt.offsetWidth, hh = tt.offsetHeight;
    if (x + w > vp.clientWidth - 6) x = Math.max(6, num(pos.x, 0) - w - 12);
    if (y + hh > vp.clientHeight - 6) y = Math.max(6, num(pos.y, 0) - hh - 12);
    tt.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  function buildStatus() {
    var box = $('vp-status');
    function chip(key) {
      var t = h('span', { class: 'chip-st-text' });
      var el = h('span', { class: 'chip-st' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), t);
      box.appendChild(el);
      status[key] = { el: el, t: t };
    }
    chip('paused'); chip('engine'); chip('master'); chip('ground'); chip('ias'); chip('alt');
    status.paused.el.classList.add('is-paused');
    setText(status.paused.t, 'Pausa');
    status.paused.el.hidden = true;
  }
  function updateStatus(s) {
    if (!status.engine || !s) return;
    var e = s.engine || {}, a = s.air || {};
    status.paused.el.hidden = !s.paused;
    if (e.running) {
      setText(status.engine.t, 'Motor en marcha · ' + Math.round(num(e.rpm, 0) / 10) * 10 + ' RPM');
      status.engine.el.className = 'chip-st is-on';
    } else if (e.cranking) {
      setText(status.engine.t, 'Arrancando…');
      status.engine.el.className = 'chip-st is-warn';
    } else {
      setText(status.engine.t, 'Motor apagado');
      status.engine.el.className = 'chip-st';
    }
    var m = s.masterBat ? (s.masterAlt ? 'Master ON' : 'Master: sólo BAT') : 'Master OFF';
    setText(status.master.t, m);
    status.master.el.className = 'chip-st' + (s.masterBat ? (s.masterAlt ? ' is-on' : ' is-warn') : '');
    var gs = num(a.groundSpeed, 0);
    setText(status.ground.t, a.onGround === false ? 'En vuelo' : ('En tierra' + (gs >= 1 ? ' · ' + Math.round(gs) + ' kt' : '')));
    status.ground.el.className = 'chip-st' + (a.onGround === false ? ' is-air' : '');
    setText(status.ias.t, 'IAS ' + Math.round(Math.max(0, num(a.ias, 0))) + ' kt');
    setText(status.alt.t, 'ALT ' + Math.round(num(a.indicatedAlt, num(a.altitude, 0)) / 10) * 10 + ' ft');
  }

  /* toasts from state.events (consumed and cleared here) */
  var toasts = [];
  function consumeEvents(s) {
    var ev = s.events;
    if (!ev || !ev.length) return;
    var batch = ev.splice(0, ev.length);
    for (var i = Math.max(0, batch.length - 3); i < batch.length; i++) showToast(batch[i]);
  }
  function showToast(e) {
    if (!e || !e.text) return;
    var kind = (e.kind === 'warn' || e.kind === 'good') ? e.kind : 'info';
    for (var i = 0; i < toasts.length; i++) {
      if (toasts[i].text === e.text) { clearTimeout(toasts[i].timer); armToast(toasts[i]); return; }
    }
    var el = h('div', { class: 'toast toast--' + kind },
      icon(kind === 'warn' ? 'warn' : (kind === 'good' ? 'check' : 'info')),
      h('span', null, kind === 'warn' ? h('span', { class: 'sr-only', text: 'Atención: ' }) : null, e.text));
    $('toasts').appendChild(el);
    var rec = { el: el, text: e.text, timer: 0 };
    toasts.push(rec);
    while (toasts.length > 3) removeToast(toasts[0], true);
    armToast(rec);
  }
  function armToast(rec) { rec.timer = setTimeout(function () { removeToast(rec, false); }, 4000); }
  function removeToast(rec, instant) {
    var i = toasts.indexOf(rec);
    if (i >= 0) toasts.splice(i, 1);
    clearTimeout(rec.timer);
    if (instant || reducedMotion()) { if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el); return; }
    rec.el.classList.add('is-leaving');
    setTimeout(function () { if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el); }, 320);
  }

  function updateStall(s) {
    var on = !!(s.air && s.air.stallWarning) && !s.paused;
    if (on === stallOn) return;
    stallOn = on;
    $('vp-stall').hidden = !on;
    updateHorn();
  }

  var overlayDone = false;
  function hideOverlay() {
    if (overlayDone) return;
    overlayDone = true;
    var o = $('vp-overlay');
    o.classList.add('is-done');
    o.setAttribute('aria-hidden', 'true');
    setTimeout(function () { o.hidden = true; }, reducedMotion() ? 0 : 450);
  }
  function showOverlayError(title, text) {
    var o = $('vp-overlay');
    o.hidden = false;
    o.classList.remove('is-done');
    o.classList.add('is-error');
    o.removeAttribute('aria-hidden');
    setText($('vp-overlay-title'), title);
    setText($('vp-overlay-text'), text);
    overlayDone = true;
  }

  /* "Tocaste…" bar for selections made in 3D while another mode is open */
  var peekId = null;
  function showPeek(id) {
    var c = CTRL[id];
    if (!c) return;
    peekId = id;
    setText($('peek-name'), c.nombre);
    $('peek').querySelector('.peek-dot').style.setProperty('--cat', catColor(c));
    $('peek').hidden = false;
  }
  function hidePeek() { peekId = null; var p = $('peek'); if (p) p.hidden = true; }
  function setupPeek() {
    $('peek-open').addEventListener('click', function () { var id = peekId; hidePeek(); if (id) UI.showControl(id); });
    $('peek-close').addEventListener('click', hidePeek);
  }

  /* ================================================================== frame loop */

  var slowAcc = 0, kickFlag = true;
  function kick() { kickFlag = true; }
  var liveGlobal = [];                       // updaters that run whatever the mode (Volar mission bar etc.)

  function runLive(list, s) {
    for (var i = 0; i < list.length; i++) {
      try { list[i](s); } catch (e) { logError('live', e); list.splice(i, 1); i--; }
    }
  }

  function onFrame(state, dt, extra) {
    if (state && typeof state === 'object') UI.state = state;
    var s = S();
    if (!s) return;
    dt = clamp(num(dt, 0.016), 0, 0.25);
    hideOverlay();
    if (extra && typeof extra.caption === 'string') extraCaption = extra.caption;
    consumeEvents(s);
    updateStall(s);
    var impl = modeImpl[mode];
    if (impl && impl.frame) { try { impl.frame(s, dt); } catch (e) { logError('frame ' + mode, e); } }
    for (var i = 0; i < frameHooks.length; i++) { try { frameHooks[i](s, dt); } catch (e2) { logError('frame hook', e2); } }
    slowAcc += dt;
    if (kickFlag || slowAcc >= 0.06) {          // Core sends ~15 frames/s: refresh text on each
      slowAcc = 0; kickFlag = false;
      updateStatus(s);
      updateCaption();
      if (!insetRect && coreReady) { var r = cc('getInsetRect'); if (r) onLayout(r); }
      if (impl && impl.slow) { try { impl.slow(s); } catch (e3) { logError('slow ' + mode, e3); } }
      runLive(liveGlobal, s);
    }
  }
  var frameHooks = [];

  /* Without Core (no WebGL) a small loop keeps the simulation and the panels alive. */
  function startLocalLoop() {
    var last = now(), lastRaf = now();
    function step() {
      var t = now(), dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      var s = S();
      if (s && C150.Sim && isFn(C150.Sim.step)) safe(function () { C150.Sim.step(s, dt); }, 'Sim.step');
      onFrame(s, dt);
    }
    function tick() { lastRaf = now(); step(); root.requestAnimationFrame(tick); }
    root.requestAnimationFrame(tick);
    // hosts that pause requestAnimationFrame on a visible page: keep the sim alive with a slower timer
    root.setInterval(function () { if (!document.hidden && now() - lastRaf > 250) step(); }, 50);
  }

  /* ================================================================== Probalo widgets (contract §7) */

  /** Each builder returns an element and pushes updaters (fn(state)) into `live`. */

  function switchBtn(name, get, set, onTxt, offTxt, live) {
    var st = h('span', { class: 'switch-state' });
    var b = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'false' },
      h('span', { class: 'switch-text' }, h('span', { class: 'switch-name', text: name }), st),
      h('span', { class: 'switch-track', 'aria-hidden': 'true' }));
    b.addEventListener('click', function () { set(!get()); upd(); });
    function upd() {
      var v = !!get();
      setAttr(b, 'aria-checked', v ? 'true' : 'false');
      setText(st, v ? onTxt : offTxt);
    }
    live.push(upd); upd();
    return b;
  }

  function rangeSlider(o, live) {
    var lastUser = 0, dragging = false;
    var inp = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, 'aria-label': o.label });
    var out = h('div', { class: 'readout', 'aria-hidden': 'true' });
    inp.value = num(o.get(), o.min);
    inp.addEventListener('input', function () { lastUser = now(); o.set(parseFloat(inp.value)); upd(); });
    inp.addEventListener('pointerdown', function () { dragging = true; });
    inp.addEventListener('pointerup', function () { dragging = false; });
    inp.addEventListener('pointercancel', function () { dragging = false; });
    function upd() {
      var v = num(o.get(), o.min);
      if (!dragging && now() - lastUser > 400 && Math.abs(parseFloat(inp.value) - v) > 1e-6) inp.value = v;
      var txt = o.format(v);
      setText(out, txt);
      setAttr(inp, 'aria-valuetext', txt);
    }
    live.push(upd); upd();
    return h('div', { class: 'slider' }, out, inp,
      (o.ends && (o.ends[0] || o.ends[1])) ? h('div', { class: 'slider-ends', 'aria-hidden': 'true' },
        h('span', { text: o.ends[0] || '' }), h('span', { text: o.ends[1] || '' })) : null);
  }

  function engineText(s) {
    var e = (s && s.engine) || {};
    if (e.running) return 'Motor en marcha · ' + Math.round(num(e.rpm, 0) / 10) * 10 + ' RPM';
    if (e.cranking) return 'Motor de arranque girando…';
    return 'Motor apagado';
  }
  function busOn(s) { return !!(s && s.elec && num(s.elec.busVolts, 0) > 8); }

  /** Live value text for slider claves, in real units. */
  function sliderText(clave, v, s) {
    var e = (s && s.engine) || {}, sf = (s && s.surfaces) || {};
    switch (clave) {
      case 'throttle':
        return 'Acelerador ' + pct(v) + ' · ' + (e.running || num(e.rpm, 0) > 50 ? Math.round(num(e.rpm, 0) / 10) * 10 + ' RPM' : 'motor apagado');
      case 'mixture':
        return 'Mezcla ' + (v < 0.04 ? 'IDLE CUT-OFF (corte)' : (v > 0.96 ? 'FULL RICH (rica)' : pct(v) + ' (empobrecida)'));
      case 'carbHeat':
        return 'Calef. carburador ' + (v < 0.04 ? 'COLD (fría)' : (v > 0.96 ? 'HOT (caliente)' : pct(v)));
      case 'trim':
        return 'Compensador ' + (Math.abs(v) < 0.04 ? 'TAKE OFF' : fmtSigned(v, 2) + (v > 0 ? ' nariz arriba' : ' nariz abajo')) +
          ' · aleta ' + surfWord(num(sf.trimTab, 0));
      case 'cabinHeat': case 'cabinAir':
        return (v < 0.04 ? 'Cerrada' : (v > 0.96 ? 'Abierta del todo' : 'Abierta ' + pct(v)));
      default:
        return fmt(v, 2);
    }
  }
  /** "+ = trailing edge down" surface angle in words. */
  function surfWord(deg) {
    if (deg < -0.5) return 'arriba ' + fmt(-deg, 0) + '°';
    if (deg > 0.5) return 'abajo ' + fmt(deg, 0) + '°';
    return 'al medio';
  }

  function wSlider(p, c, live) {
    var min = num(p.min, 0), max = num(p.max, 1);
    return rangeSlider({
      min: min, max: max, step: num(p.paso, 0.01), label: c.nombre,
      get: function () { return num(getInput(p.clave), min); },
      set: function (v) { setInput(p.clave, clamp(v, min, max)); },
      format: function (v) { return sliderText(p.clave, v, S()); },
      ends: [p.etiquetaMin, p.etiquetaMax]
    }, live);
  }

  function wToggle(p, c, live) {
    return switchBtn(c.nombre,
      function () { return !!getInput(p.clave); },
      function (v) { setInput(p.clave, v); },
      p.on || 'Sí', p.off || 'No', live);
  }

  function wYoke(c, live, compact) {
    var knob = h('div', { class: 'pad-knob' });
    var pad = h('div', {
      class: 'pad', tabindex: '0', role: 'group',
      'aria-label': 'Volante. Arrastrá el punto o usá las flechas: izquierda y derecha inclinan, arriba empuja y abajo tira.'
    },
      h('span', { class: 'pad-lbl pad-lbl--t', text: compact ? 'Empujar' : 'Empujar · nariz abajo' }),
      h('span', { class: 'pad-lbl pad-lbl--b', text: compact ? 'Tirar' : 'Tirar · nariz arriba' }),
      h('span', { class: 'pad-lbl pad-lbl--l', text: 'Izq' }),
      h('span', { class: 'pad-lbl pad-lbl--r', text: 'Der' }),
      knob);
    var drag = null, springRaf = 0, keyAxes = { r: 0, p: 0 };
    function locked() { var s = S(); return !!(s && s.controlLock); }
    function place(r, p) {
      var rx = pad.clientWidth / 2 - 25, ry = pad.clientHeight / 2 - 25;
      knob.style.transform = 'translate(' + (clamp(r, -1, 1) * rx).toFixed(1) + 'px,' + (clamp(p, -1, 1) * ry).toFixed(1) + 'px)';
    }
    function write(r, p) { setInput('yokeRoll', clamp(r, -1, 1)); setInput('yokePitch', clamp(p, -1, 1)); place(r, p); }
    function fromEvent(e) {
      var b = pad.getBoundingClientRect();
      var rx = b.width / 2 - 25, ry = b.height / 2 - 25;
      return [clamp((e.clientX - b.left - b.width / 2) / rx, -1, 1), clamp((e.clientY - b.top - b.height / 2) / ry, -1, 1)];
    }
    // timer (not requestAnimationFrame): the spring must finish even in hosts that pause animation frames
    function stopSpring() { if (springRaf) { root.clearTimeout(springRaf); springRaf = 0; } }
    function springBack() {
      stopSpring();
      var s = S(); if (!s) return;
      var r0 = num(s.yokeRoll, 0), p0 = num(s.yokePitch, 0);
      if (reducedMotion()) { write(0, 0); return; }
      var t0 = now();
      (function step() {
        var k = clamp((now() - t0) / 300, 0, 1), e = 1 - Math.pow(1 - k, 3);
        write(r0 * (1 - e), p0 * (1 - e));
        springRaf = k < 1 ? root.setTimeout(step, 16) : 0;
      })();
    }
    pad.addEventListener('pointerdown', function (e) {
      if (locked()) { kick(); return; }
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ }
      drag = e.pointerId; stopSpring();
      pad.classList.add('is-dragging');
      activeHolds.push(endDrag);
      var v = fromEvent(e); write(v[0], v[1]);
    });
    pad.addEventListener('pointermove', function (e) {
      if (drag !== e.pointerId) return;
      var v = fromEvent(e); write(v[0], v[1]);
    });
    function endDrag() {
      if (drag === null) return;
      drag = null;
      var i = activeHolds.indexOf(endDrag); if (i >= 0) activeHolds.splice(i, 1);
      pad.classList.remove('is-dragging');
      springBack();
    }
    pad.addEventListener('pointerup', endDrag);
    pad.addEventListener('pointercancel', endDrag);
    pad.addEventListener('lostpointercapture', endDrag);
    var KEYMAP = { ArrowLeft: ['r', -0.7], ArrowRight: ['r', 0.7], ArrowUp: ['p', -0.7], ArrowDown: ['p', 0.7] };
    pad.addEventListener('keydown', function (e) {
      var k = KEYMAP[e.key]; if (!k) return;
      e.preventDefault(); e.stopPropagation();
      if (locked()) return;
      stopSpring(); keyAxes[k[0]] = k[1]; write(keyAxes.r, keyAxes.p);
    });
    pad.addEventListener('keyup', function (e) {
      var k = KEYMAP[e.key]; if (!k) return;
      e.preventDefault(); e.stopPropagation();
      keyAxes[k[0]] = 0;
      if (!keyAxes.r && !keyAxes.p) springBack(); else write(keyAxes.r, keyAxes.p);
    });
    pad.addEventListener('blur', function () { if (keyAxes.r || keyAxes.p) { keyAxes.r = 0; keyAxes.p = 0; springBack(); } });

    var note = h('div', { class: 'note', hidden: true },
      'La traba de comandos está puesta: el volante no se mueve. ',
      h('button', { type: 'button', class: 'btn btn--small', onclick: function () { setInput('controlLock', false); } }, 'Sacar la traba'));
    var ro = compact ? null : h('div', { class: 'readout small' });
    live.push(function (s) {
      var lk = !!s.controlLock;
      toggleClass(pad, 'is-locked', lk);
      note.hidden = !lk;
      if (drag === null && !springRaf) place(num(s.yokeRoll, 0), num(s.yokePitch, 0));
      if (ro) {
        var sf = s.surfaces || {};
        setText(ro, 'Alerón izquierdo: ' + surfWord(num(sf.aileronL, 0)) + '\nAlerón derecho: ' + surfWord(num(sf.aileronR, 0)) +
          '\nTimón de profundidad: ' + surfWord(num(sf.elevator, 0)));
      }
    });
    if (ro) ro.style.whiteSpace = 'pre-line';
    return h('div', { class: 'pad-wrap' }, pad, note, ro);
  }

  function wPedales(c, live) {
    var ro = h('div', { class: 'readout small', style: { 'white-space': 'pre-line' } });
    var brk = h('div', { class: 'readout small' });
    var pedals = h('div', { class: 'w-group' },
      h('div', { class: 'w-label', text: 'Pedales (timón de dirección)' }),
      h('div', { class: 'btn-row btn-row--split' },
        holdButton(['◀ ', 'Pedal izq'], function () { hold('rudder-pedals', 'left', true); }, function () { hold('rudder-pedals', 'left', false); }, '', 'Pisar el pedal izquierdo (mantené apretado)'),
        holdButton(['Pedal der', ' ▶'], function () { hold('rudder-pedals', 'right', true); }, function () { hold('rudder-pedals', 'right', false); }, '', 'Pisar el pedal derecho (mantené apretado)')),
      h('div', { class: 'w-row', style: { 'margin-top': '10px' } }, h('div', { style: { flex: '1' } }, rangeSlider({
        min: -1, max: 1, step: 0.05, label: 'Pedales: izquierda a derecha',
        get: function () { return num(getInput('rudder'), 0); },
        set: function (v) { setInput('rudder', Math.abs(v) < 0.03 ? 0 : v); },
        format: function (v) { return Math.abs(v) < 0.03 ? 'Pedales parejos' : (v < 0 ? 'Pedal izquierdo ' : 'Pedal derecho ') + pct(Math.abs(v)); },
        ends: ['Izquierdo a fondo', 'Derecho a fondo']
      }, live))),
      ro);
    var brakes = h('div', { class: 'w-group' },
      h('div', { class: 'w-label', text: 'Frenos (puntas de los pies)' }),
      h('div', { class: 'btn-row btn-row--split' },
        holdButton('Freno izq', function () { hold('toe-brakes', 'left', true); }, function () { hold('toe-brakes', 'left', false); }, '', 'Freno izquierdo (mantené apretado)'),
        holdButton('Los dos', function () { hold('toe-brakes', null, true); }, function () { hold('toe-brakes', null, false); }, '', 'Los dos frenos (mantené apretado)'),
        holdButton('Freno der', function () { hold('toe-brakes', 'right', true); }, function () { hold('toe-brakes', 'right', false); }, '', 'Freno derecho (mantené apretado)')),
      brk);
    live.push(function (s) {
      var sf = s.surfaces || {}, rd = num(sf.rudder, 0), nw = num(s.noseWheelAngle, 0);
      setText(ro, 'Timón de dirección: ' + (Math.abs(rd) < 0.5 ? 'al medio' : fmt(Math.abs(rd), 0) + '° a la ' + (rd < 0 ? 'izquierda' : 'derecha')) +
        '\nRueda de nariz: ' + (Math.abs(nw) < 0.5 ? 'recta' : fmt(Math.abs(nw), 0) + '° a la ' + (nw < 0 ? 'izquierda' : 'derecha')));
      setText(brk, 'Freno izq ' + pct(s.brakeL) + ' · der ' + pct(s.brakeR) + (s.parkingBrake ? ' · estacionamiento PUESTO' : ''));
    });
    // toe-brakes card: brakes first; rudder-pedals card: pedals first
    return c.id === 'toe-brakes' ? h('div', null, brakes, pedals) : h('div', null, pedals, brakes);
  }

  function wIgnition(p, c, live) {
    var vals = arr(p.valores).length ? p.valores : ['OFF', 'R', 'L', 'BOTH', 'START'];
    var NAMES = { OFF: 'Apagado', R: 'Sólo magneto derecho', L: 'Sólo magneto izquierdo', BOTH: 'Los dos magnetos', START: 'Arranque' };
    var btns = {};
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Posición de la llave' });
    vals.forEach(function (v) {
      var b;
      if (v === 'START') {
        b = holdButton('START', function () { hold('ignition', null, true); }, function () { hold('ignition', null, false); }, 'is-start', 'START: mantené apretado para arrancar');
        b.className = 'is-start';
      } else {
        b = h('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': v + ': ' + (NAMES[v] || v), onclick: function () { setIgnition(v); } }, v);
      }
      btns[v] = b; seg.appendChild(b);
    });
    var ro = h('div', { class: 'readout small' });
    live.push(function (s) {
      for (var k in btns) setAttr(btns[k], 'aria-pressed', s.ignition === k ? 'true' : 'false');
      setText(ro, 'Llave: ' + (NAMES[s.ignition] || s.ignition) + ' · ' + engineText(s));
    });
    return h('div', null, seg, ro,
      h('p', { class: 'probalo-hint', style: { margin: '6px 0 0' }, text: 'START es a resorte: mantenelo apretado y, al soltar, vuelve solo a BOTH.' }));
  }

  function wMaster(c, live) {
    var ro = h('div', { class: 'readout small' });
    var box = h('div', { class: 'switch-grid' },
      switchBtn('ALT · alternador', function () { return !!getInput('masterAlt'); }, function (v) { setMaster('alt', v); }, 'ON', 'OFF', live),
      switchBtn('BAT · batería', function () { return !!getInput('masterBat'); }, function (v) { setMaster('bat', v); }, 'ON', 'OFF', live));
    live.push(function (s) {
      var el = s.elec || {};
      setText(ro, 'Barra ' + fmt(num(el.busVolts, 0), 1) + ' V · Amperímetro ' + fmtSigned(num(el.ammeterAmps, 0), 0) + ' A');
    });
    return h('div', null, box, ro,
      h('p', { class: 'probalo-hint', style: { margin: '6px 0 0' }, text: 'Están unidos: si prendés ALT se prende BAT, y si apagás BAT se apaga ALT.' }));
  }

  function wFlaps(c, live) {
    var up = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', onclick: function () { setFlapSwitch(getInput('flapSwitch') === 'UP' ? 'OFF' : 'UP'); } }, 'Subir (UP)');
    var dn = holdButton('Bajar (mantener)', function () { hold('flap-switch', null, true); }, function () { hold('flap-switch', null, false); }, 'btn--primary', 'Bajar flaps: mantené apretado');
    var fill = h('span');
    var ro = h('div', { class: 'readout readout--big' });
    var warn = h('div', { class: 'note note--info', hidden: true, text: 'Los flaps son eléctricos: sin el master prendido no se mueven.' });
    live.push(function (s) {
      var f = clamp(num(s.flaps, 0), 0, 40);
      setAttr(up, 'aria-pressed', s.flapSwitch === 'UP' ? 'true' : 'false');
      fill.style.width = (f / 40 * 100).toFixed(1) + '%';
      var sw = s.flapSwitch === 'UP' ? 'UP' : (s.flapSwitch === 'DOWN' ? 'DOWN' : 'OFF (al medio)');
      setText(ro, 'Flaps ' + Math.round(f) + '° · interruptor ' + sw);
      warn.hidden = busOn(s);
    });
    return h('div', null,
      h('div', { class: 'btn-row btn-row--split', style: { 'margin-top': '0' } }, up, dn),
      h('div', { style: { margin: '12px 0 4px' } }, h('div', { class: 'flapbar', 'aria-hidden': 'true' }, fill),
        h('div', { class: 'flapticks', 'aria-hidden': 'true' }, h('span', { text: '0°' }), h('span', { text: '10°' }), h('span', { text: '20°' }), h('span', { text: '30°' }), h('span', { text: '40°' }))),
      ro, warn,
      h('p', { class: 'probalo-hint', style: { margin: '6px 0 0' }, text: 'DOWN es a resorte: bajan sólo mientras lo mantenés. UP queda trabado y los sube hasta 0°.' }));
  }

  function wPrimer(p, c, live) {
    var ro = h('div', { class: 'readout small' });
    var pump = h('button', {
      type: 'button', class: 'btn btn--primary',
      onclick: function () {
        if (has('operate')) operate('primer'); else simAction('primeStroke');
      }
    }, p.etiqueta || 'Dar un bombeo');
    live.push(function (s) {
      var e = s.engine || {};
      setText(ro, 'Bombeos: ' + num(e.primeCharges, 0) + (e.flooded ? ' · ¡motor ahogado!' : '') + (e.running ? ' · motor en marcha' : ''));
    });
    return h('div', null,
      h('div', { class: 'btn-row', style: { 'margin-top': '0' } }, pump), ro,
      h('div', { style: { 'margin-top': '10px' } }, switchBtn('Cebador trabado', function () { return !!getInput('primerLocked'); },
        function (v) { setInput('primerLocked', v); }, 'Adentro y trabado', 'Suelto (destrabado)', live)));
  }

  var LIGHTS = [
    ['lights.dome', 'DOME · luz de cabina'], ['pitotHeat', 'PITOT HT · calef. pitot'], ['lights.nav', 'NAV · navegación'],
    ['lights.strobe', 'STROBE · destellos'], ['lights.beacon', 'BCN · baliza'], ['lights.taxi', 'TAXI · rodaje'],
    ['lights.landing', 'LDG · aterrizaje']
  ];
  function wLuces(c, live) {
    var grid = h('div', { class: 'switch-grid' });
    LIGHTS.forEach(function (l) {
      grid.appendChild(switchBtn(l[1], function () { return !!getInput(l[0]); }, function (v) { setInput(l[0], v); }, 'ON', 'OFF', live));
    });
    var warn = h('div', { class: 'note note--info', hidden: true, text: 'Sin el master prendido las luces no encienden: prendé BAT (en la ficha del master o con la tecla M).' });
    var ro = h('div', { class: 'readout small' });
    live.push(function (s) {
      warn.hidden = busOn(s);
      setText(ro, 'Amperímetro ' + fmtSigned(num(s.elec && s.elec.ammeterAmps, 0), 0) + ' A');
    });
    return h('div', null, grid, warn, ro);
  }

  function wDoors(c, live) {
    return h('div', null,
      switchBtn('Puerta izquierda', function () { return !!getInput('doorLeftOpen'); }, function (v) { setInput('doorLeftOpen', v); }, 'Abierta', 'Cerrada', live),
      switchBtn('Puerta derecha', function () { return !!getInput('doorRightOpen'); }, function (v) { setInput('doorRightOpen', v); }, 'Abierta', 'Cerrada', live),
      switchBtn('Ventanilla izquierda', function () { return !!getInput('windowLeftOpen'); }, function (v) { setInput('windowLeftOpen', v); }, 'Abierta', 'Cerrada', live));
  }

  /* perilla: stepper with auto-repeat and a formatted value */
  function knobFormat(p, v, s) {
    switch (p.formato) {
      case 'inHg': return fmt(v, 2) + ' inHg · ' + Math.round(v * 33.8639) + ' hPa';
      case 'porcentaje': return pct(v);
      case 'grados':
        if (p.clave === 'radio.obs') return 'OBS ' + heading3(v) + '°';
        if (p.clave === 'hiCorrection') return 'Corrección ' + fmtSigned(v, 0) + '°';
        return fmt(v, 0) + '°';
      default: return fmt(v, 2);
    }
  }
  function wPerilla(p, c, live) {
    var min = num(p.min, 0), max = num(p.max, 1), step = num(p.paso, 0.1);
    var wrap = p.clave === 'radio.obs';
    function nudge(dir) {
      var v = num(getInput(p.clave), min) + dir * step;
      if (wrap) { var span = max - min + step; v = min + ((((v - min) % span) + span) % span); }
      v = clamp(v, min, max);
      var dec = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
      setInput(p.clave, Number(v.toFixed(dec)));
      upd();
    }
    var val = h('div', { class: 'readout readout--big stepper-val', 'aria-live': 'polite' });
    var extra = h('div', { class: 'readout small' });
    function upd() {
      var s = S(); if (!s) return;
      var v = num(getPath(s, p.clave), min);
      setText(val, knobFormat(p, v, s));
      if (p.clave === 'hiCorrection') {
        var a = s.air || {};
        setText(extra, 'Direccional ' + heading3(a.hiHeading) + '° · Brújula ' + heading3(a.heading) + '°');
      } else if (p.clave === 'altimeterSetting') {
        var al = s.air || {};
        setText(extra, 'El altímetro marca ' + Math.round(num(al.indicatedAlt, 0) / 10) * 10 + ' ft (el aeródromo está a ' + Math.round(num(s.fieldElevation, 100)) + ' ft)');
      } else if (p.clave === 'radio.obs') {
        setText(extra, 'Curso elegido en el indicador VOR');
      } else setText(extra, '');
      extra.hidden = !extra.textContent;
    }
    live.push(upd);
    var row = h('div', { class: 'stepper', style: { width: '100%', 'justify-content': 'space-between' } },
      repeatButton('−', function () { nudge(-1); }, '', 'Bajar'),
      val,
      repeatButton('+', function () { nudge(1); }, '', 'Subir'));
    var quick = null;
    if (p.clave === 'altimeterSetting') {
      quick = h('div', { class: 'chips', style: { 'margin-top': '8px' } },
        h('button', { type: 'button', class: 'chip', onclick: function () { setInput('altimeterSetting', 29.92); upd(); } }, 'Estándar: 1013 hPa'));
    }
    upd();
    return h('div', null, row, extra, quick);
  }

  /* radio: COM + NAV (flip-flop and knobs) and transponder */
  function freqStr(f) {
    var k = Math.round(num(f, 0) * 1000);
    return (k % 10 === 0) ? (k / 1000).toFixed(2) : (k / 1000).toFixed(3);
  }
  function stepFreq(f, part, dir, lo, hi, kstep) {
    var k = Math.round(num(f, lo) * 1000), mhz = Math.floor(k / 1000), khz = k - mhz * 1000;
    if (part === 'mhz') { mhz += dir; if (mhz > hi) mhz = lo; if (mhz < lo) mhz = hi; }
    else { khz = ((khz + dir * kstep) % 1000 + 1000) % 1000; }
    return Number(((mhz * 1000 + khz) / 1000).toFixed(3));
  }
  function wRadio(c, live) {
    function radioBlock(kind) {
      var isCom = kind === 'com';
      var act = isCom ? 'radio.comFreq' : 'radio.navFreq', sby = isCom ? 'radio.comStby' : 'radio.navStby';
      var lo = isCom ? 118 : 108, hi = isCom ? 136 : 117, ks = isCom ? 25 : 50;
      var fa = h('span', { class: 'radio-freq' }), fs = h('span', { class: 'radio-freq radio-freq--stby' });
      var box = h('div', { class: 'radio-box' + (isCom ? '' : ' is-nav') },
        h('div', { class: 'radio-line' }, h('small', { text: isCom ? 'COM USE' : 'NAV USE' }), h('small', { text: 'STBY' })),
        h('div', { class: 'radio-line' }, fa, fs));
      function knob(part, dir, lbl) {
        return repeatButton(lbl, function () { setInput(sby, stepFreq(getInput(sby), part, dir, lo, hi, ks)); }, 'btn--small', (dir > 0 ? 'Subir ' : 'Bajar ') + (part === 'mhz' ? 'megahertz' : 'kilohertz') + ' de la frecuencia en espera');
      }
      var flip = h('button', {
        type: 'button', class: 'btn btn--small', 'aria-label': 'Intercambiar la frecuencia en uso con la de espera',
        onclick: function () { var a = getInput(act), b = getInput(sby); setInput(act, b); setInput(sby, a); }
      }, icon('swap'), 'Cambiar');
      live.push(function (s) {
        var r = s.radio || {}, on = !!r.comOn && busOn(s);
        toggleClass(box, 'is-off', !on);
        setText(fa, freqStr(getPath(s, act)));
        setText(fs, freqStr(getPath(s, sby)));
      });
      return h('div', { class: 'w-group' },
        h('div', { class: 'w-label', text: isCom ? 'COM · para hablar' : 'NAV · para el VOR' }), box,
        h('div', { class: 'w-row', style: { 'margin-top': '6px' } }, flip,
          h('span', { class: 'soft small', text: 'MHz' }), knob('mhz', -1, '−'), knob('mhz', 1, '+'),
          h('span', { class: 'soft small', text: 'kHz' }), knob('khz', -1, '−'), knob('khz', 1, '+')));
    }
    var power = switchBtn('Radio NAV/COM', function () { return !!getInput('radio.comOn'); }, function (v) { setInput('radio.comOn', v); }, 'Prendida', 'Apagada', live);
    var warn = h('div', { class: 'note note--info', hidden: true, text: 'La radio es eléctrica: necesita el master prendido.' });
    live.push(function (s) { warn.hidden = busOn(s); });

    // transponder
    var MODES_X = ['OFF', 'SBY', 'ON', 'ALT'];
    var xb = {};
    var xseg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo del transpondedor' });
    MODES_X.forEach(function (m) {
      xb[m] = h('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { setInput('radio.xpdrMode', m); } }, m);
      xseg.appendChild(xb[m]);
    });
    var digits = h('div', { class: 'xpdr-code', role: 'group', 'aria-label': 'Código del transpondedor' });
    var dEls = [];
    function setDigit(i, dir) {
      var code = String(getInput('radio.xpdrCode') || '0000');
      while (code.length < 4) code = '0' + code;
      var d = (parseInt(code.charAt(i), 10) || 0) + dir;
      d = (d + 8) % 8;                                   // squawk digits go 0–7
      setInput('radio.xpdrCode', code.slice(0, i) + d + code.slice(i + 1));
    }
    for (var i = 0; i < 4; i++) {
      (function (i) {
        var dEl = h('span', { class: 'digit' });
        dEls.push(dEl);
        digits.appendChild(h('div', { class: 'xpdr-digit' },
          h('button', { type: 'button', class: 'btn', 'aria-label': 'Subir el dígito ' + (i + 1), onclick: function () { setDigit(i, 1); } }, '+'),
          dEl,
          h('button', { type: 'button', class: 'btn', 'aria-label': 'Bajar el dígito ' + (i + 1), onclick: function () { setDigit(i, -1); } }, '−')));
      })(i);
    }
    live.push(function (s) {
      var r = s.radio || {};
      MODES_X.forEach(function (m) { setAttr(xb[m], 'aria-pressed', r.xpdrMode === m ? 'true' : 'false'); });
      var code = String(r.xpdrCode || '0000');
      for (var j = 0; j < 4; j++) setText(dEls[j], code.charAt(j) || '0');
    });
    var xpdr = h('div', { class: 'w-group' },
      h('div', { class: 'w-label', text: 'Transpondedor' }), xseg,
      h('div', { class: 'w-row', style: { 'margin-top': '8px' } }, digits),
      h('p', { class: 'probalo-hint', style: { margin: '6px 0 0' }, text: 'El código te lo asigna el control de tránsito aéreo o el instructor; 7000 es sólo un ejemplo.' }));

    var comGroup = h('div', null, power, warn, radioBlock('com'), radioBlock('nav'));
    return c.id === 'transponder' ? h('div', null, xpdr, h('div', { class: 'w-group' }, comGroup)) : h('div', null, comGroup, xpdr);
  }

  /** Probalo section for a control (null when the control is informational only). */
  function buildProbalo(c, live, compact) {
    var p = c && c.probar;
    if (!p || !p.tipo) return null;
    var body = null;
    switch (p.tipo) {
      case 'yoke': body = wYoke(c, live, false); break;
      case 'pedales': body = wPedales(c, live); break;
      case 'slider': if (p.clave) body = wSlider(p, c, live); break;
      case 'toggle': if (p.clave) body = wToggle(p, c, live); break;
      case 'opciones': body = wIgnition(p, c, live); break;
      case 'master': body = wMaster(c, live); break;
      case 'flaps': body = wFlaps(c, live); break;
      case 'accion': body = wPrimer(p, c, live); break;
      case 'luces': body = wLuces(c, live); break;
      case 'radio': body = wRadio(c, live); break;
      case 'perilla': if (p.clave) body = wPerilla(p, c, live); break;
      case 'puertas': body = wDoors(c, live); break;
    }
    if (!body) return null;
    return h('div', { class: 'probalo', role: 'group', 'aria-label': 'Probalo: ' + c.nombre },
      h('div', { class: 'probalo-head' },
        h('h3', { class: 'placard', text: 'Probalo' }),
        compact ? null : h('span', { class: 'probalo-hint', text: 'o tocalo en la cabina 3D' })),
      body);
  }

  /* ================================================================== shared card pieces */

  function sec(title, content) {
    return h('section', { class: 'sec' }, h('h3', { class: 'placard placard--small', text: title }), content);
  }
  function para(t) { return t ? h('p', { text: t }) : null; }
  function callout(label, text, kind) {
    return h('aside', { class: 'callout' + (kind ? ' callout--' + kind : '') },
      h('h3', { class: 'placard', text: label }), h('p', { text: text }));
  }
  function controlChip(id, onclick) {
    var c = CTRL[id];
    if (!c) return null;
    return h('button', { type: 'button', class: 'chip', onclick: onclick || function () { UI.showControl(id); } }, dot(catColor(c)), c.nombre);
  }
  function progressBar(frac, ok) {
    var fill = h('span', { style: { width: (clamp(num(frac, 0), 0, 1) * 100).toFixed(1) + '%' } });
    var bar = h('div', { class: 'progress' + (ok ? ' progress--ok' : ''), 'aria-hidden': 'true' }, fill);
    bar.set = function (f, isOk) {
      fill.style.width = (clamp(num(f, 0), 0, 1) * 100).toFixed(1) + '%';
      toggleClass(bar, 'progress--ok', !!isOk);
    };
    return bar;
  }

  var COLOR_NAME = { blanco: 'Arco blanco', verde: 'Arco verde', amarillo: 'Arco amarillo', rojo: 'Rojo', azul: 'Azul' };
  function nf(v) {
    v = num(v, 0);
    if (Math.abs(v - Math.round(v)) < 1e-9) return fmt(v, 0);
    return Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? fmt(v, 1) : fmt(v, 2);
  }
  /** Small colour bars for instrument markings (semantic arc colours), grouped by unit. */
  function rangesView(rangos) {
    var groups = {}, order = [];
    rangos.forEach(function (r) {
      if (!r || typeof r.desde !== 'number' || typeof r.hasta !== 'number') return;
      var u = r.unidad || '';
      if (!groups[u]) { groups[u] = []; order.push(u); }
      groups[u].push(r);
    });
    var box = h('div', { class: 'ranges' });
    order.forEach(function (u) {
      var g = groups[u], lo = Infinity, hi = -Infinity;
      g.forEach(function (r) { lo = Math.min(lo, r.desde, r.hasta); hi = Math.max(hi, r.desde, r.hasta); });
      var span = hi - lo;
      if (span <= 0) span = Math.max(1, Math.abs(hi) * 0.4);
      var a = lo - span * 0.06, b = hi + span * 0.06;
      if (hi === lo) { a = lo - span; b = hi + span; }
      function x(v) { return ((v - a) / (b - a) * 100); }
      var lanes = [], segs = [], lines = [];
      g.forEach(function (r) {
        var f = Math.min(r.desde, r.hasta), t = Math.max(r.desde, r.hasta);
        if (f === t) { lines.push(r); return; }
        var lane = 0;
        while (lanes[lane] && lanes[lane].some(function (s) { return f < s[1] && t > s[0]; })) lane++;
        (lanes[lane] = lanes[lane] || []).push([f, t]);
        segs.push({ r: r, f: f, t: t, lane: lane });
      });
      var nL = Math.max(1, lanes.length);
      var scale = h('div', { class: 'range-scale', 'aria-hidden': 'true', style: { height: (6 + nL * 8) + 'px' } });
      segs.forEach(function (s) {
        scale.appendChild(h('span', {
          class: 'range-seg c-' + (COLOR_NAME[s.r.color] ? s.r.color : 'blanco'),
          style: { left: x(s.f).toFixed(2) + '%', width: (x(s.t) - x(s.f)).toFixed(2) + '%', top: (3 + s.lane * 8) + 'px', height: '6px', bottom: 'auto' }
        }));
      });
      lines.forEach(function (r) {
        scale.appendChild(h('span', { class: 'range-seg range-seg--line c-' + (COLOR_NAME[r.color] ? r.color : 'rojo'), style: { left: x(r.desde).toFixed(2) + '%' } }));
      });
      var vals = [];
      g.forEach(function (r) { [r.desde, r.hasta].forEach(function (v) { if (vals.indexOf(v) < 0) vals.push(v); }); });
      vals.sort(function (p, q) { return p - q; });
      var ticks = h('div', { class: 'range-ticks', 'aria-hidden': 'true' }), lastX = -100;
      vals.forEach(function (v) {
        var px = x(v);
        if (px - lastX < 10) return;
        lastX = px;
        ticks.appendChild(h('span', { style: { left: px.toFixed(2) + '%' }, text: nf(v) }));
      });
      var leg = h('ul', { class: 'range-legend' });
      g.forEach(function (r) {
        var col = COLOR_NAME[r.color] ? r.color : 'blanco';
        leg.appendChild(h('li', null,
          h('span', { class: 'swatch c-' + col, 'aria-hidden': 'true' }),
          h('span', { class: 'range-num' }, h('span', { class: 'sr-only', text: COLOR_NAME[col] + ': ' }),
            (r.desde === r.hasta ? nf(r.desde) : nf(r.desde) + '–' + nf(r.hasta)) + (u ? ' ' + u : '')),
          h('span', { text: r.texto || '' })));
      });
      box.appendChild(h('div', null, scale, ticks, leg));
    });
    return box;
  }

  /* ================================================================== EXPLORAR */

  /** Exterior animation that best shows what each control does to the airplane. */
  var ANIM_FOR = {
    'yoke': 'axes-roll', 'trim-wheel': 'trim-tab', 'flap-switch': 'flaps-extend', 'flap-indicator': 'flaps-extend',
    'rudder-pedals': 'axes-yaw', 'throttle': 'propeller-throttle', 'carb-heat': 'carb-ice',
    'asi': 'pitot-static', 'altimeter': 'pitot-static', 'vsi': 'pitot-static',
    'stall-warning': 'aoa-stall', 'light-switches': 'lights-demo', 'control-lock': 'controls-check',
    'turn-coordinator': 'coordinated-turn'
  };
  var SUGGESTED = ['yoke', 'throttle', 'rudder-pedals', 'asi', 'attitude', 'altimeter', 'mixture', 'master',
    'ignition', 'toe-brakes', 'trim-wheel', 'flap-switch'];

  var EX = { listView: null, detailView: null, ul: null, count: null, query: '', cat: '', id: null, live: [], visible: [], catBtns: [], listScroll: 0 };

  function exFiltered() {
    var q = norm(EX.query).trim(), words = q ? q.split(/\s+/) : [];
    var catIndex = {};
    CATEGORIES.forEach(function (k, i) { if (k) catIndex[k.id] = i; });
    var list = CONTROLS.filter(function (c) {
      if (EX.cat && c.categoria !== EX.cat) return false;
      if (!words.length) return true;
      var hay = norm([c.nombre, c.ingles, c.id, arr(c.otrosNombres).join(' '), c.resumen].join(' '));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    if (!words.length && !EX.cat) {
      list = list.map(function (c, i) { return { c: c, i: i }; }).sort(function (p, q2) {
        var a = catIndex[p.c.categoria], b = catIndex[q2.c.categoria];
        a = (a === undefined) ? 99 : a; b = (b === undefined) ? 99 : b;
        return (a - b) || (p.i - q2.i);
      }).map(function (o) { return o.c; });
    }
    return list;
  }

  function exRow(c) {
    return h('button', {
      type: 'button', class: 'row', 'data-id': c.id, 'aria-current': EX.id === c.id ? 'true' : null,
      onclick: function () { openControl(c.id, 'list'); }
    },
      dot(catColor(c)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-name', text: c.nombre }), c.ingles ? h('span', { class: 'row-sub', lang: 'en', text: c.ingles }) : null),
      h('span', { class: 'row-end' }, c.prioridad === 1 ? h('span', { class: 'tag-esencial', text: 'esencial' }) : null));
  }

  function renderExList() {
    var ul = EX.ul;
    clear(ul);
    var list = exFiltered();
    EX.visible = list.map(function (c) { return c.id; });
    setText(EX.count, list.length === 1 ? '1 control' : list.length + ' controles');
    if (!list.length) {
      ul.appendChild(h('li', { class: 'empty' }, CONTROLS.length
        ? 'No encontré nada con esa búsqueda. Probá con otra palabra, por ejemplo “nafta”, “luces” o “velocidad”.'
        : 'Todavía no hay controles cargados.'));
      return;
    }
    var grouped = !EX.query.trim() && !EX.cat, lastCat = null;
    list.forEach(function (c) {
      if (grouped && c.categoria !== lastCat) {
        lastCat = c.categoria;
        var k = CAT[lastCat];
        ul.appendChild(h('li', { class: 'rows-group' }, h('h3', { class: 'placard placard--small', text: k ? k.nombre : lastCat })));
      }
      ul.appendChild(h('li', null, exRow(c)));
    });
  }

  /** Opens a checklist by id (the welcome path links straight to "Antes de arrancar" / "Arranque"). */
  function openChecklist(id) {
    setMode('checklists');
    for (var i = 0; i < CHECKLISTS.length; i++) { if (CHECKLISTS[i].id === id) { clOpen(i); return; } }
  }

  /** Suggested order for a first visit: Recorrido → Lo básico → Checklists → Volar. */
  function startPath() {
    function go(m) { return function () { setMode(m); scrollPanelTop(); }; }
    function step(title, text, buttons) {
      return h('li', { class: 'path-step' },
        h('div', { class: 'path-body' }, h('strong', { class: 'path-title', text: title }), h('span', { class: 'path-text', text: text })),
        h('div', { class: 'path-btns' }, buttons));
    }
    var clBtns = [];
    [['antes-arrancar', 'Antes de arrancar'], ['arranque', 'Arranque']].forEach(function (x) {
      if (CHECKLISTS.some(function (c) { return c.id === x[0]; })) {
        clBtns.push(h('button', { type: 'button', class: 'btn btn--small', onclick: function () { openChecklist(x[0]); } }, x[1]));
      }
    });
    if (!clBtns.length) clBtns.push(h('button', { type: 'button', class: 'btn btn--small', onclick: go('checklists') }, 'Checklists'));
    return h('ol', { class: 'path', 'aria-label': 'Por dónde empezar' },
      step('Recorrido', 'Un paseo guiado por la cabina, control por control.',
        h('button', { type: 'button', class: 'btn btn--small btn--primary', onclick: go('recorrido') }, 'Empezar el recorrido', icon('next'))),
      step('Lo básico', 'Lecciones cortas: cómo vuela el avión, los 3 ejes, la pérdida, los flaps…',
        h('button', { type: 'button', class: 'btn btn--small', onclick: go('basico') }, 'Ver las lecciones')),
      step('Checklists', 'Prepará la cabina y arrancá el motor, paso a paso, como en la primera clase.', clBtns),
      step('Volar', 'Mové el volante, los pedales y el acelerador, mirá los instrumentos y probá las misiones.',
        h('button', { type: 'button', class: 'btn btn--small', onclick: go('volar') }, 'Ir a volar')));
  }

  function exWelcome() {
    var sug = SUGGESTED.filter(function (id) { return CTRL[id] && CTRL[id].prioridad === 1; });
    CONTROLS.forEach(function (c) { if (sug.length < 6 && c.prioridad === 1 && sug.indexOf(c.id) < 0) sug.push(c.id); });
    sug = sug.slice(0, 6);
    var chips = h('div', { class: 'chips' });
    sug.forEach(function (id) { chips.appendChild(controlChip(id, function () { openControl(id, 'list'); })); });
    return h('div', { class: 'card' },
      h('h2', { class: 'placard mode-title', text: 'Conocé la cabina' }),
      h('p', { class: 'lead', text: 'Una cabina de Cessna 150 en 3D para recorrer antes de tu primera clase: cada mando y cada instrumento, qué hace y qué le pasa al avión cuando lo usás.' }),
      h('p', { class: 'aviso aviso--top', text: AVISO }),
      h('div', { class: 'block' }, h('h3', { class: 'placard placard--small block-title', text: '¿Primera vez? Seguí este orden' }), startPath()),
      h('div', { class: 'block' }, h('h3', { class: 'placard placard--small block-title', text: 'Cómo se usa la cabina 3D' }),
        h('ul', { class: 'bullets' },
          h('li', null, h('strong', { text: 'Tocá' }), ' cualquier cosa en la cabina, o elegila de la lista, y acá aparece su ficha.'),
          h('li', null, h('strong', { text: 'Tocala otra vez' }), ' para usarla, o ', h('strong', { text: 'arrastrá' }), ' las perillas, el volante y los pedales.'),
          h('li', null, h('strong', { text: 'Arrastrá el fondo' }), ' para mirar alrededor; con la rueda del mouse o pellizcando te acercás.'),
          h('li', null, 'Con el teclado: flechas = volante, Z y X = pedales, + y − = acelerador. Todos los atajos en ',
            h('button', { type: 'button', class: 'linklike', onclick: openHelp }, 'la ayuda'), '.'))),
      sug.length ? h('div', { class: 'block' }, h('h3', { class: 'placard placard--small block-title', text: 'Los controles esenciales' }), chips) : null);
  }

  function toggleOnAirplane(c) {
    var parts = arr(c.partesAvion);
    if (mainView === 'exterior') {
      cc('playExterior', null);
      cc('setMainView', 'cockpit');
      cc('setExteriorHighlight', parts);
    } else {
      cc('setExteriorHighlight', parts);
      var anim = ANIM_FOR[c.id];
      if (anim && has('playExterior')) cc('playExterior', anim, { enlarge: true });
      else cc('setMainView', 'exterior');
    }
    syncMainView();
    kick();
  }

  function renderDetail(c) {
    releaseAllHolds();
    EX.live = [];
    var v = EX.detailView;
    clear(v);
    var k = CAT[c.categoria];
    var order = EX.visible.indexOf(c.id) >= 0 ? EX.visible : CONTROLS.map(function (x) { return x.id; });
    var i = order.indexOf(c.id);
    var prevId = i > 0 ? order[i - 1] : null, nextId = (i >= 0 && i < order.length - 1) ? order[i + 1] : null;

    var titleId = 'ex-title-' + c.id;
    var parts = arr(c.partesAvion);
    var showBtn = h('button', {
      type: 'button', class: 'btn btn--primary',
      onclick: function () { if (mainView === 'exterior') { cc('setMainView', 'cockpit'); syncMainView(); } focusControl(c.id, true); }
    }, icon('target'), 'Mostrámelo');
    var extLbl = h('span', { text: 'Ver en el avión' });
    var extBtn = parts.length ? h('button', { type: 'button', class: 'btn', onclick: function () { toggleOnAirplane(c); } }, icon('plane'), extLbl) : null;
    if (extBtn) EX.live.push(function () { setText(extLbl, mainView === 'exterior' ? 'Volver a la cabina' : 'Ver en el avión'); });

    var otros = arr(c.otrosNombres).filter(function (x) { return x && x !== c.nombre; });
    var pasos = arr(c.comoSeUsa), errores = arr(c.errores), rangos = arr(c.rangos), subs = arr(c.subitems);
    var rel = arr(c.relacionados).filter(function (id) { return CTRL[id] && id !== c.id; });

    var subList = null;
    if (subs.length) {
      subList = h('dl', { class: 'gloss' });
      subs.forEach(function (s) {
        if (!s) return;
        subList.appendChild(h('dt', null, s.nombre || s.subId, s.ingles ? h('small', { lang: 'en', text: ' · ' + s.ingles }) : null));
        subList.appendChild(h('dd', { text: s.texto || '' }));
      });
    }
    var steps = null;
    if (pasos.length) { steps = h('ol', { class: 'steps' }); pasos.forEach(function (p) { steps.appendChild(h('li', { text: p })); }); }
    var errs = null;
    if (errores.length) { errs = h('ul', { class: 'bullets bullets--warn' }); errores.forEach(function (e) { errs.appendChild(h('li', { text: e })); }); }
    var relChips = null;
    if (rel.length) { relChips = h('div', { class: 'chips' }); rel.forEach(function (id) { relChips.appendChild(controlChip(id, function () { openControl(id, 'list'); })); }); }

    function navBtn(id, dir) {
      if (!id) return h('span', { style: { flex: '1' } });
      return h('button', {
        type: 'button', class: 'btn btn--small', 'aria-label': (dir < 0 ? 'Anterior: ' : 'Siguiente: ') + ctrlName(id),
        onclick: function () { openControl(id, 'list'); }
      }, dir < 0 ? icon('back') : null, h('span', { text: ctrlName(id) }), dir > 0 ? icon('next') : null);
    }

    v.appendChild(h('div', { class: 'detail-top' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small back-btn', onclick: closeDetail }, icon('back'), 'Todos los controles')));
    v.appendChild(h('article', { class: 'card', 'aria-labelledby': titleId },
      h('p', { class: 'kicker' }, dot(catColor(c)), k ? k.nombre : '', c.prioridad === 1 ? h('span', { class: 'tag-esencial', text: 'esencial' }) : null),
      h('h2', { class: 'placard detail-title', id: titleId, tabindex: '-1', text: c.nombre }),
      c.ingles ? h('p', { class: 'detail-en', lang: 'en', text: c.ingles }) : null,
      otros.length ? h('p', { class: 'detail-also', text: 'También le dicen: ' + otros.join(' · ') }) : null,
      c.resumen ? h('p', { class: 'lead', text: c.resumen }) : null,
      h('div', { class: 'btn-row' }, showBtn, extBtn),
      c.ubicacion ? sec('Dónde está', para(c.ubicacion)) : null,
      c.queHace ? sec('Qué hace', para(c.queHace)) : null,
      subList ? sec('Cada parte', subList) : null,
      c.enElAvion ? sec('Qué pasa en el avión', para(c.enElAvion)) : null,
      buildProbalo(c, EX.live, false),
      steps ? sec('Cómo se usa', steps) : null,
      c.cuando ? sec('Cuándo', para(c.cuando)) : null,
      errs ? sec('Errores comunes', errs) : null,
      c.truco ? callout('Truco', c.truco) : null,
      c.dato ? callout('Dato', c.dato, 'dato') : null,
      rangos.length ? sec('Marcas de colores', rangesView(rangos)) : null,
      c.otrosModelos ? sec('En otros años y modelos', para(c.otrosModelos)) : null,
      relChips ? sec('Relacionados', relChips) : null,
      h('nav', { class: 'detail-nav', 'aria-label': 'Otros controles' }, navBtn(prevId, -1), navBtn(nextId, 1))));
    var s = S();
    if (s) runLive(EX.live, s);
  }

  function openControl(id, source) {
    var c = CTRL[id];
    if (!c) return;
    if (!EX.listView) { setMode('explorar'); if (!EX.listView) return; }
    if (!EX.id) EX.listScroll = $('panel').scrollTop;
    EX.id = id;
    renderDetail(c);
    EX.listView.hidden = true;
    EX.detailView.hidden = false;
    scrollPanelTop();
    cc('setExteriorHighlight', arr(c.partesAvion));
    if (source !== '3d') {
      focusControl(id, false);
      var t = EX.detailView.querySelector('.detail-title');
      if (t) safe(function () { t.focus({ preventScroll: true }); });
    }
  }

  function closeDetail() {
    var was = EX.id;
    releaseAllHolds();
    EX.id = null;
    EX.live = [];
    clear(EX.detailView);
    EX.detailView.hidden = true;
    EX.listView.hidden = false;
    renderExList();
    $('panel').scrollTop = EX.listScroll || 0;
    cc('setExteriorHighlight', []);
    if (was) {
      progSel = { id: null, t: now() };
      cc('select', null);
      var b = EX.ul.querySelector('[data-id="' + was + '"]');
      if (b) safe(function () { b.focus({ preventScroll: true }); });
    }
  }

  modeImpl.explorar = {
    render: function (sec) {
      EX.ul = h('ul', { class: 'rows', 'aria-label': 'Controles de la cabina' });
      EX.count = h('p', { class: 'count', 'aria-live': 'polite' });
      var input = h('input', {
        type: 'search', placeholder: 'Buscar: acelerador, flaps, nafta…', 'aria-label': 'Buscar un control',
        autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search'
      });
      input.addEventListener('input', function () { EX.query = input.value; renderExList(); });
      var cats = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por categoría' });
      function catBtn(id, label, color) {
        var b = h('button', {
          type: 'button', class: 'chip', 'aria-pressed': EX.cat === id ? 'true' : 'false',
          onclick: function () {
            EX.cat = (EX.cat === id) ? '' : id;
            EX.catBtns.forEach(function (x) { setAttr(x.b, 'aria-pressed', x.id === EX.cat ? 'true' : 'false'); });
            renderExList();
          }
        }, color ? dot(color) : null, label);
        EX.catBtns.push({ id: id, b: b });
        cats.appendChild(b);
      }
      catBtn('', 'Todas', null);
      CATEGORIES.forEach(function (k) { if (k && k.id) catBtn(k.id, k.nombre || k.id, k.color || null); });
      EX.listView = h('div', null, exWelcome(),
        h('div', { class: 'block' },
          h('h2', { class: 'placard block-title', text: 'Todos los controles' }),
          h('div', { class: 'search' }, icon('search'), input),
          cats, EX.count, EX.ul));
      EX.detailView = h('div', { hidden: true });
      sec.appendChild(EX.listView);
      sec.appendChild(EX.detailView);
      renderExList();
    },
    enter: function () {
      if (EX.id && CTRL[EX.id]) cc('setExteriorHighlight', arr(CTRL[EX.id].partesAvion));
    },
    exit: function () { },
    slow: function (s) { runLive(EX.live, s); }
  };

  /* ================================================================== LO BÁSICO (lecciones + glosario) */

  var LESSONS = arr(DATA.lessons).filter(function (l) { return l && arr(l.pasos).length; });
  var GLOSSARY = arr(DATA.glossary).filter(function (g) { return g && g.termino; }).slice().sort(function (a, b) {
    return String(a.termino).localeCompare(String(b.termino), 'es');
  });
  var LB = { listView: null, lessonView: null, idx: -1, i: 0, seen: {}, finished: false, done: arr(store.get('lessonsDone', [])) };

  function modeHead(title, sub) {
    return h('div', { class: 'mode-head' }, h('h2', { class: 'placard mode-title', text: title }), sub ? h('p', { class: 'mode-sub', text: sub }) : null);
  }
  function emptyState(text) { return h('p', { class: 'empty', text: text }); }

  function glossaryBlock() {
    if (!GLOSSARY.length) return null;
    var dl = h('dl', { class: 'gloss' });
    var input = h('input', { type: 'search', placeholder: 'Buscar una palabra…', 'aria-label': 'Buscar en el glosario', autocomplete: 'off', spellcheck: 'false' });
    function fill() {
      clear(dl);
      var q = norm(input.value).trim(), n = 0;
      GLOSSARY.forEach(function (g) {
        if (q && norm(g.termino + ' ' + (g.ingles || '') + ' ' + (g.definicion || '')).indexOf(q) < 0) return;
        n++;
        dl.appendChild(h('dt', null, g.termino, g.ingles ? h('small', { lang: 'en', text: ' · ' + g.ingles }) : null));
        dl.appendChild(h('dd', { text: g.definicion || '' }));
      });
      if (!n) dl.appendChild(h('dd', { class: 'empty', text: 'No hay ninguna palabra así en el glosario.' }));
    }
    input.addEventListener('input', fill);
    fill();
    return h('details', { class: 'fold' },
      h('summary', null, 'Glosario · ' + GLOSSARY.length + ' palabras'),
      h('div', { class: 'search', style: { 'margin-top': '0' } }, icon('search'), input), dl);
  }

  function lbRenderList() {
    var v = LB.listView;
    clear(v);
    v.appendChild(modeHead('Lo básico', 'Lecciones cortas para entender cómo vuela el avión y qué hace cada mando, con animaciones del avión visto desde afuera.'));
    if (!LESSONS.length) { v.appendChild(emptyState('Las lecciones todavía no están cargadas.')); }
    else {
      var ul = h('ul', { class: 'rows', 'aria-label': 'Lecciones' });
      LESSONS.forEach(function (l, i) {
        var done = LB.done.indexOf(l.id) >= 0;
        ul.appendChild(h('li', null, h('button', { type: 'button', class: 'row', onclick: function () { lbOpen(i); } },
          h('span', { class: 'row-num', text: ('0' + (i + 1)).slice(-2) }),
          h('span', { class: 'row-main' }, h('span', { class: 'row-name', text: l.titulo || 'Lección' }), l.resumen ? h('span', { class: 'row-sub', text: l.resumen }) : null),
          h('span', { class: 'row-end' }, done ? h('span', { class: 'row-done' }, 'Hecha', h('span', { class: 'sr-only', text: ' (lección completada)' })) : arr(l.pasos).length + ' pasos'))));
      });
      v.appendChild(ul);
    }
    var g = glossaryBlock();
    if (g) v.appendChild(g);
  }

  function lbOpen(idx) {
    if (!LESSONS[idx]) return;
    LB.idx = idx; LB.i = 0; LB.seen = { 0: true }; LB.finished = false;
    LB.listView.hidden = true;
    LB.lessonView.hidden = false;
    lbRenderStep(true);
    scrollPanelTop();
  }

  function lbRun(p) {
    if (!p) return;
    var foco = p.foco && CTRL[p.foco] ? p.foco : null;
    if (foco) focusControl(foco, true);
    cc('setTargetHighlight', foco);
    if (p.vista === 'exterior') {
      if (p.anim) cc('playExterior', p.anim, { enlarge: true });
      else { cc('playExterior', null); cc('setMainView', 'exterior'); }
    } else {
      cc('setMainView', 'cockpit');
      cc('playExterior', p.anim || null, { enlarge: false });
    }
    syncMainView();
    kick();
  }
  function lbLeave() {
    cc('playExterior', null);
    cc('setMainView', 'cockpit');
    cc('setTargetHighlight', null);
    syncMainView();
  }

  function lbRenderStep(run) {
    var v = LB.lessonView, L = LESSONS[LB.idx];
    clear(v);
    if (!L) return;
    var pasos = arr(L.pasos), n = pasos.length;
    v.appendChild(h('div', { class: 'detail-top' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small back-btn', onclick: lbBack }, icon('back'), 'Lecciones')));
    if (LB.finished) {
      var next = LESSONS[LB.idx + 1];
      v.appendChild(h('div', { class: 'card done-card' },
        h('h3', { class: 'placard', text: '¡Lección terminada!' }),
        h('p', { text: 'Completaste “' + (L.titulo || 'la lección') + '”. Si querés, repetila: las animaciones se entienden mejor la segunda vez.' }),
        h('div', { class: 'btn-row' },
          next ? h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { lbOpen(LB.idx + 1); } }, 'Siguiente: ' + (next.titulo || 'lección'), icon('next'))
            : h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { openChecklist('antes-arrancar'); } }, 'Seguí con las checklists', icon('next')),
          h('button', { type: 'button', class: 'btn', onclick: function () { lbOpen(LB.idx); } }, icon('retry'), 'Repetir'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: lbBack }, 'Todas las lecciones'))));
      return;
    }
    var p = pasos[LB.i] || {};
    var foco = p.foco && CTRL[p.foco] ? p.foco : null;
    var hint = p.vista === 'exterior'
      ? 'Mirá el avión desde afuera: la vista grande muestra la animación.'
      : (foco ? 'En la cabina, lo que titila es ' + ctrlName(foco) + '.' : '');
    var dots = h('div', { class: 'dots', role: 'group', 'aria-label': 'Pasos de la lección' });
    pasos.forEach(function (q, k) {
      dots.appendChild(h('button', {
        type: 'button', class: LB.seen[k] ? 'is-seen' : null, 'aria-label': 'Paso ' + (k + 1) + ': ' + (q.titulo || ''),
        'aria-current': k === LB.i ? 'step' : null, onclick: function () { lbGo(k); }
      }));
    });
    var last = LB.i >= n - 1;
    var titleId = 'lb-step-title';
    v.appendChild(h('article', { class: 'card step-card', 'aria-labelledby': titleId },
      h('p', { class: 'kicker', text: 'Lección ' + (LB.idx + 1) + ' · ' + (L.titulo || '') }),
      h('p', { class: 'step-n', text: 'Paso ' + (LB.i + 1) + ' de ' + n }),
      h('h2', { class: 'placard', id: titleId, tabindex: '-1', text: p.titulo || '' }),
      p.texto ? h('p', { class: 'step-text', text: p.texto }) : null,
      hint ? h('p', { class: 'soft small', text: hint }) : null,
      h('div', { class: 'btn-row' },
        p.anim ? h('button', { type: 'button', class: 'btn btn--small', onclick: function () { lbRun(p); } }, icon('play'), 'Ver otra vez') : null,
        foco ? h('button', { type: 'button', class: 'btn btn--small', onclick: function () { UI.showControl(foco); } }, 'Ficha: ' + ctrlName(foco)) : null),
      h('div', { class: 'btn-row btn-row--split' },
        h('button', { type: 'button', class: 'btn', disabled: LB.i === 0, onclick: function () { lbGo(LB.i - 1); } }, icon('back'), 'Anterior'),
        last
          ? h('button', { type: 'button', class: 'btn btn--primary', onclick: lbFinish }, 'Terminar', icon('check'))
          : h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { lbGo(LB.i + 1); } }, 'Siguiente', icon('next'))),
      dots));
    if (run) lbRun(p);
  }
  function lbGo(k) {
    var L = LESSONS[LB.idx];
    if (!L) return;
    LB.i = clamp(k, 0, arr(L.pasos).length - 1);
    LB.seen[LB.i] = true;
    lbRenderStep(true);
    var t = $('lb-step-title');
    if (t) safe(function () { t.focus({ preventScroll: true }); });
  }
  function lbFinish() {
    var L = LESSONS[LB.idx];
    if (L && LB.done.indexOf(L.id) < 0) { LB.done.push(L.id); store.set('lessonsDone', LB.done); }
    LB.finished = true;
    lbLeave();
    lbRenderStep(false);
    scrollPanelTop();
  }
  function lbBack() {
    lbLeave();
    LB.idx = -1;
    LB.lessonView.hidden = true;
    LB.listView.hidden = false;
    lbRenderList();
    scrollPanelTop();
  }

  modeImpl.basico = {
    render: function (sec) {
      LB.listView = h('div');
      LB.lessonView = h('div', { hidden: true });
      sec.appendChild(LB.listView);
      sec.appendChild(LB.lessonView);
      lbRenderList();
    },
    enter: function () {
      if (LB.idx >= 0 && !LB.finished) { var L = LESSONS[LB.idx]; if (L) lbRun(arr(L.pasos)[LB.i]); }
    },
    exit: function () { if (LB.idx >= 0) lbLeave(); }
  };

  /* ================================================================== RECORRIDO (tour guiado) */

  var TOUR = arr(DATA.tour).filter(function (t) { return t && t.control; });
  var TR = { view: null, i: clamp(num(store.get('tourStep', 0), 0), 0, Math.max(0, TOUR.length - 1)), finished: false };

  function trFocus() {
    if (TR.finished) { cc('setTargetHighlight', null); cc('select', null); return; }
    var st = TOUR[TR.i];
    if (!st || !CTRL[st.control]) { cc('setTargetHighlight', null); return; }
    if (mainView === 'exterior') { cc('setMainView', 'cockpit'); syncMainView(); }
    focusControl(st.control, true);
    cc('setTargetHighlight', st.control);
  }
  function trGo(i) {
    TR.i = clamp(i, 0, TOUR.length - 1);
    TR.finished = false;
    store.set('tourStep', TR.i);
    trRender();
    trFocus();
    var t = $('tr-title');
    if (t) safe(function () { t.focus({ preventScroll: true }); });
  }
  function trRender() {
    var v = TR.view;
    clear(v);
    v.appendChild(modeHead('Recorrido', 'Tu primer día en la cabina: un paseo guiado, control por control, en el orden en que los vas a usar.'));
    if (!TOUR.length) { v.appendChild(emptyState('El recorrido todavía no está cargado.')); return; }
    var n = TOUR.length;
    if (TR.finished) {
      v.appendChild(h('div', { class: 'card done-card' },
        h('h3', { class: 'placard', text: '¡Recorrido completo!' }),
        h('p', { text: 'Ya pasaste por los ' + n + ' puntos de la cabina. El próximo paso: las lecciones de Lo básico (cómo vuela el avión). Después, las checklists.' }),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { setMode('basico'); scrollPanelTop(); } }, 'Lo básico', icon('next')),
          h('button', { type: 'button', class: 'btn', onclick: function () { setMode('checklists'); } }, 'Checklists'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () { trGo(0); } }, icon('retry'), 'Empezar de nuevo'))));
      return;
    }
    var st = TOUR[TR.i], c = CTRL[st.control];
    var last = TR.i >= n - 1;
    v.appendChild(h('div', { class: 'cl-progress', style: { margin: '0 0 12px' } }, progressBar((TR.i + 1) / n), h('span', { class: 'pct', text: (TR.i + 1) + '/' + n })));
    v.appendChild(h('article', { class: 'card step-card', 'aria-labelledby': 'tr-title' },
      h('p', { class: 'step-n', text: 'Paso ' + (TR.i + 1) + ' de ' + n }),
      h('h2', { class: 'placard', id: 'tr-title', tabindex: '-1', text: st.titulo || (c ? c.nombre : '') }),
      c ? h('p', { class: 'kicker' }, dot(catColor(c)), c.nombre) : null,
      st.texto ? h('p', { class: 'step-text', text: st.texto }) : null,
      c ? h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--small', onclick: trFocus }, icon('target'), 'Mostrámelo de nuevo'),
        h('button', { type: 'button', class: 'btn btn--small', onclick: function () { UI.showControl(st.control); } }, 'Más detalles', icon('next'))) : null,
      h('div', { class: 'btn-row btn-row--split' },
        h('button', { type: 'button', class: 'btn', disabled: TR.i === 0, onclick: function () { trGo(TR.i - 1); } }, icon('back'), 'Anterior'),
        last
          ? h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { TR.finished = true; store.set('tourStep', 0); trRender(); trFocus(); } }, 'Terminar', icon('check'))
          : h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { trGo(TR.i + 1); } }, 'Siguiente', icon('next')))));
    v.appendChild(h('p', { class: 'aviso', text: 'El control de cada paso titila en la cabina. Si lo perdés de vista, tocá “Mostrámelo de nuevo”.' }));
  }

  modeImpl.recorrido = {
    render: function (sec) { TR.view = h('div'); sec.appendChild(TR.view); trRender(); },
    enter: function () { trFocus(); },
    exit: function () { cc('setTargetHighlight', null); }
  };

  /* ================================================================== CHECKLISTS */

  var CHECKLISTS = arr(DATA.checklists).filter(function (c) { return c && arr(c.items).length; });
  var CL = { listView: null, runView: null, announce: null, cur: null, live: [], lastDone: null, doneIds: arr(store.get('checklistsDone', [])) };

  function splitItem(t) {
    t = String(t || '');
    var m = t.split(/\s+[—–]\s+/);
    return m.length >= 2 ? [m[0], m.slice(1).join(' — ')] : [t, ''];
  }

  function clRenderList() {
    var v = CL.listView;
    clear(v);
    v.appendChild(modeHead('Checklists', 'Las listas del manual, paso a paso. Cada ítem se tilda solo cuando hacés lo que pide, en la cabina 3D o con el “Probalo”.'));
    if (!CHECKLISTS.length) { v.appendChild(emptyState('Las checklists todavía no están cargadas.')); return; }
    var ul = h('ul', { class: 'rows', 'aria-label': 'Checklists' });
    CHECKLISTS.forEach(function (cl, i) {
      var done = CL.doneIds.indexOf(cl.id) >= 0;
      ul.appendChild(h('li', null, h('button', { type: 'button', class: 'row', onclick: function () { clOpen(i); } },
        h('span', { class: 'row-num', text: ('0' + (i + 1)).slice(-2) }),
        h('span', { class: 'row-main' }, h('span', { class: 'row-name', text: cl.titulo || cl.id }), cl.descripcion ? h('span', { class: 'row-sub', text: cl.descripcion }) : null),
        h('span', { class: 'row-end' }, done ? h('span', { class: 'row-done' }, 'Hecha', h('span', { class: 'sr-only', text: ' (completada)' })) : arr(cl.items).length + ' ítems'))));
    });
    v.appendChild(ul);
    v.appendChild(h('p', { class: 'aviso', text: 'Siguen el POH del 150M y son para practicar. En el avión manda la checklist de tu escuela.' }));
  }

  function clOpen(idx, forceFresh) {
    var cl = CHECKLISTS[idx];
    if (!cl) return;
    var carry = !forceFresh && !!cl.continuaDe && CL.lastDone === cl.continuaDe;
    if (!carry && cl.preset) applyPreset(cl.preset);
    CL.cur = { cl: cl, idx: idx, done: arr(cl.items).map(function () { return false; }), i: 0, finished: false, carried: carry, skipped: 0 };
    CL.listView.hidden = true;
    CL.runView.hidden = false;
    clRenderRun();
    clFocusCurrent();
    scrollPanelTop();
    setText(CL.announce, 'Checklist ' + (cl.titulo || '') + ': ' + arr(cl.items).length + ' ítems.');
  }

  function clBack() {
    releaseAllHolds();
    CL.cur = null;
    CL.live = [];
    cc('setTargetHighlight', null);
    CL.runView.hidden = true;
    CL.listView.hidden = false;
    clRenderList();
    scrollPanelTop();
  }

  function clFocusCurrent() {
    var cur = CL.cur;
    if (mode !== 'checklists') return;
    if (!cur || cur.finished) { cc('setTargetHighlight', null); return; }
    var it = cur.cl.items[cur.i];
    var id = it && CTRL[it.control] ? it.control : null;
    cc('setTargetHighlight', id);
    if (id) {
      if (mainView === 'exterior') { cc('setMainView', 'cockpit'); syncMainView(); }
      focusControl(id, true);
    }
  }

  function clItem(it, k, cur) {
    var parts = splitItem(it.texto);
    var isDone = !!cur.done[k], isCur = !cur.finished && k === cur.i;
    var li = h('li', { class: 'cl-item' + (isDone ? ' is-done' : '') + (isCur ? ' is-current' : ''), 'aria-current': isCur ? 'step' : null });
    var row = h('div', { class: 'cl-row' },
      h('span', { class: 'cl-mark', 'aria-hidden': 'true' }, icon('check')),
      h('div', { class: 'cl-line' },
        h('span', { class: 'cl-left', text: parts[0] }),
        parts[1] ? h('span', { class: 'cl-leader', 'aria-hidden': 'true' }) : null,
        parts[1] ? h('span', { class: 'cl-right', text: parts[1] }) : null,
        h('span', { class: 'sr-only', text: isDone ? (cur.done[k] === 'skip' ? ' (salteado)' : ' (hecho)') : (isCur ? ' (ahora)' : '') })));
    if (isCur) {
      if (it.detalle) row.appendChild(h('p', { class: 'cl-detail', text: it.detalle }));
      var c = CTRL[it.control];
      var actions = h('div', { class: 'cl-actions' });
      if (c) actions.appendChild(h('button', { type: 'button', class: 'btn btn--small', onclick: clFocusCurrent }, icon('target'), 'Mostrámelo'));
      if (!isFn(it.check)) actions.appendChild(h('button', { type: 'button', class: 'btn btn--small btn--primary cl-confirm', onclick: function () { clTick(false); } }, icon('check'), 'Hecho'));
      else actions.appendChild(h('span', { class: 'soft small', style: { 'align-self': 'center' }, text: 'Se tilda solo cuando lo hacés.' }));
      row.appendChild(actions);
      var pb = c ? buildProbalo(c, CL.live, true) : null;
      if (pb) row.appendChild(h('div', { class: 'cl-probalo' }, pb));
      if (isFn(it.check)) row.appendChild(h('div', { class: 'cl-actions' },
        h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: function () { clTick(true); } }, 'No me sale: saltear este ítem')));
    }
    li.appendChild(row);
    return li;
  }

  function clRenderRun() {
    var v = CL.runView, cur = CL.cur;
    var hadFocus = v.contains(doc.activeElement);
    releaseAllHolds();
    CL.live = [];
    clear(v);
    if (!cur) return;
    var cl = cur.cl, items = arr(cl.items), n = items.length;
    var doneN = cur.done.filter(Boolean).length;
    v.appendChild(h('div', { class: 'detail-top' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small back-btn', onclick: clBack }, icon('back'), 'Checklists')));
    var ol = h('ol', { class: 'cl', 'aria-label': 'Ítems de la checklist' });
    items.forEach(function (it, k) { ol.appendChild(clItem(it || {}, k, cur)); });
    var next = null;
    if (cur.finished) CHECKLISTS.forEach(function (x, i) { if (!next && x.continuaDe === cl.id) next = { cl: x, i: i }; });
    v.appendChild(h('article', { class: 'card', 'aria-labelledby': 'cl-title' },
      h('p', { class: 'kicker', text: 'Checklist' }),
      h('h2', { class: 'placard detail-title', id: 'cl-title', tabindex: '-1', text: cl.titulo || '' }),
      cl.descripcion ? h('p', { class: 'soft', text: cl.descripcion }) : null,
      cur.carried ? h('div', { class: 'note note--info' }, 'Seguís con el avión tal como quedó al terminar la checklist anterior. ',
        h('button', { type: 'button', class: 'linklike', onclick: function () { clOpen(cur.idx, true); } }, 'Empezar de cero')) : null,
      h('div', { class: 'cl-progress' }, progressBar(doneN / n, cur.finished), h('span', { class: 'pct', text: doneN + ' de ' + n })),
      ol,
      cur.finished ? h('div', { class: 'card done-card' },
        h('h3', { class: 'placard', text: '¡Checklist completa!' }),
        h('p', { text: 'Hiciste los ' + n + ' ítems en orden.' + (cur.skipped ? ' Salteaste ' + cur.skipped + (cur.skipped === 1 ? ' ítem: practicalo de nuevo.' : ' ítems: practicalos de nuevo.') : ' Así, siempre en el mismo orden, se vuelve automático.') }),
        h('div', { class: 'btn-row' },
          next ? h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { clOpen(next.i); } }, 'Seguir con: ' + (next.cl.titulo || ''), icon('next')) : null,
          h('button', { type: 'button', class: 'btn', onclick: function () { clOpen(cur.idx, true); } }, icon('retry'), 'Repetir'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: clBack }, 'Todas las checklists'))) : null,
      cur.finished ? null : h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () { clOpen(cur.idx, true); } }, icon('retry'), 'Reiniciar'))));
    var s = S();
    if (s) runLive(CL.live, s);
    if (hadFocus) {
      var target = v.querySelector('.cl-item.is-current button') || v.querySelector('.done-card button') || $('cl-title');
      if (target) safe(function () { target.focus({ preventScroll: true }); });
    }
    var curLi = v.querySelector('.cl-item.is-current');
    if (curLi && mode === 'checklists' && curLi.scrollIntoView) {
      safe(function () { curLi.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); });
    }
  }

  function clTick(skipped) {
    var cur = CL.cur;
    if (!cur || cur.finished) return;
    var it = cur.cl.items[cur.i] || {};
    cur.done[cur.i] = skipped ? 'skip' : true;
    if (skipped) cur.skipped++;
    cur.i++;
    var n = arr(cur.cl.items).length;
    var msg = (skipped ? 'Salteado: ' : 'Listo: ') + splitItem(it.texto).join(' ') + '. ' + cur.done.filter(Boolean).length + ' de ' + n + '.';
    if (cur.i >= n) {
      cur.finished = true;
      CL.lastDone = cur.cl.id;
      if (CL.doneIds.indexOf(cur.cl.id) < 0) { CL.doneIds.push(cur.cl.id); store.set('checklistsDone', CL.doneIds); }
      msg += ' ¡Checklist completa!';
    }
    setText(CL.announce, msg);
    clRenderRun();
    clFocusCurrent();
  }

  /** Runs ≈10 Hz whatever the open mode: latches the current item when its check() becomes true. */
  function clEvaluate(s) {
    var cur = CL.cur;
    if (!cur || cur.finished) return;
    var it = cur.cl.items[cur.i];
    if (!it || !isFn(it.check)) return;
    var ok = false;
    try { ok = !!it.check(s); } catch (e) { logError('checklist check', e); }
    if (ok) clTick(false);
    else runLive(CL.live, s);
  }
  liveGlobal.push(clEvaluate);

  modeImpl.checklists = {
    render: function (sec) {
      CL.announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
      CL.listView = h('div');
      CL.runView = h('div', { hidden: true });
      sec.appendChild(CL.announce);
      sec.appendChild(CL.listView);
      sec.appendChild(CL.runView);
      clRenderList();
    },
    enter: function () { if (CL.cur) clFocusCurrent(); },
    exit: function () { cc('setTargetHighlight', null); }
  };

  /* ================================================================== VOLAR (escenarios, misiones, pad de vuelo, HUD) */

  var MISSIONS = arr(DATA.missions).filter(function (m) { return m && m.id && isFn(m.check); });
  var VO = {
    view: null, live: [], m: null, ctx: null, progress: 0, achieved: false, starting: false, trimDir: 0,
    overlay: null, ovLive: [], setH: null,
    best: (function () { var b = store.get('missionsBest', {}); return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {}; })(),
    savedBest: {}
  };

  function freshCtx() { return { t: 0, dt: 0, hold: 0, data: {} }; }

  function startMission(m) {
    VO.starting = true;
    applyPreset(m.preset || 'parked');
    VO.starting = false;
    VO.m = m; VO.ctx = freshCtx(); VO.progress = 0; VO.achieved = false;
    if (mode !== 'volar') setMode('volar');
    voRender();
    scrollPanelTop();
    var t = $('vo-mission-title');
    if (t) safe(function () { t.focus({ preventScroll: true }); });
  }
  function stopMission() { VO.m = null; VO.ctx = null; VO.progress = 0; VO.achieved = false; voRender(); }
  function saveBest(id, p) {
    var prev = num(VO.best[id], 0);
    if (p <= prev) return;
    VO.best[id] = p;
    if (p >= 1 || p - num(VO.savedBest[id], 0) >= 0.05) { VO.savedBest[id] = p; store.set('missionsBest', VO.best); }
  }

  /* missions are checked on EVERY frame (their timers use ctx.dt), whatever tab is open */
  frameHooks.push(function (s, dt) {
    if (VO.trimDir && !s.paused) {
      var tv = clamp(num(s.trim, 0) + VO.trimDir * 0.35 * dt, -1, 1);
      if (has('setInput')) cc('setInput', 'trim', tv); else s.trim = tv;
    }
    if (!VO.m || !VO.ctx || VO.achieved || s.paused || dt <= 0) return;
    VO.ctx.t += dt; VO.ctx.dt = dt;
    var p = 0;
    try { p = num(VO.m.check(s, VO.ctx), 0); } catch (e) { logError('mission check', e); }
    VO.progress = clamp(p, 0, 1);
    saveBest(VO.m.id, VO.progress);
    if (VO.progress >= 1) {
      VO.achieved = true;
      showToast({ text: '¡Misión cumplida: ' + (VO.m.titulo || '') + '!', kind: 'good' });
      voRender();
    }
  });
  presetListeners.push(function () {
    if (VO.m && !VO.starting) { VO.ctx = freshCtx(); VO.progress = 0; VO.achieved = false; voRender(); }
  });

  function hudCell(label, unit, extraClass) {
    var v = h('span');
    var cell = h('div', { class: 'hud-cell' + (extraClass ? ' ' + extraClass : '') },
      h('div', { class: 'hud-lbl', text: label }), h('div', { class: 'hud-val' }, v, unit ? h('small', { text: unit }) : null));
    cell.v = v;
    return cell;
  }
  function buildHud(live) {
    var ias = hudCell('Velocidad', 'kt'), alt = hudCell('Altímetro', 'ft'), vs = hudCell('Variómetro', 'ft/min');
    var rpm = hudCell('Motor', 'RPM'), hdg = hudCell('Rumbo', '°'), bank = hudCell('Inclinación', '');
    var ball = h('span', { class: 'ball' });
    var ballCell = h('div', { class: 'hud-cell', style: { 'grid-column': 'span 2' } },
      h('div', { class: 'hud-lbl', text: 'Bolita (coordinación)' }), h('div', { class: 'ball-tube', 'aria-hidden': 'true' }, ball));
    var flaps = hudCell('Flaps', '°');
    var sr = h('p', { class: 'sr-only', 'aria-live': 'off' });
    live.push(function (s) {
      var a = s.air || {}, e = s.engine || {};
      var L = (C150.Sim && isFn(C150.Sim.limits)) ? safe(function () { return C150.Sim.limits(s); }) : null;
      var v = Math.max(0, num(a.ias, 0));
      setText(ias.v, Math.round(v));
      toggleClass(ias, 'is-warn', !!a.stallWarning || (L && v > num(L.vne, 999)));
      setText(alt.v, Math.round(num(a.indicatedAlt, num(a.altitude, 0)) / 10) * 10);
      var vv = Math.round(num(a.vs, 0) / 10) * 10;
      setText(vs.v, (vv > 0 ? '+' : '') + fmt(vv, 0));
      setText(rpm.v, Math.round(num(e.rpm, 0) / 10) * 10);
      setText(hdg.v, heading3(a.heading));
      var b = num(a.bank, 0);
      setText(bank.v, Math.abs(b) < 1 ? '0°' : Math.round(Math.abs(b)) + '° ' + (b > 0 ? 'der' : 'izq'));
      ball.style.left = (50 + clamp(num(a.slip, 0), -1, 1) * 42).toFixed(1) + '%';
      setText(flaps.v, Math.round(num(s.flaps, 0)));
      setText(sr, 'Velocidad ' + Math.round(v) + ' nudos, altura ' + Math.round(num(a.indicatedAlt, 0)) + ' pies.');
    });
    return h('div', { role: 'group', 'aria-label': 'Instrumentos principales' },
      h('div', { class: 'hud' }, ias, alt, vs, rpm, hdg, bank, ballCell, flaps), sr);
  }

  /** Vertical knob slider (throttle / mixture): up = pushed in. */
  function vSlider(name, key, red, live, format) {
    var fill = h('span', { class: 'vsl-fill' }), knob = h('span', { class: 'vsl-knob' });
    var track = h('div', {
      class: 'vsl-track', role: 'slider', tabindex: '0', 'aria-label': name, 'aria-orientation': 'vertical',
      'aria-valuemin': '0', 'aria-valuemax': '100'
    }, fill, knob);
    var val = h('div', { class: 'vsl-val' });
    var drag = null;
    function H() { return (track.clientHeight || 170) - 28; }
    function setFromY(y) {
      var b = track.getBoundingClientRect();
      setInput(key, clamp(1 - (y - b.top - 14) / ((b.height || 170) - 28), 0, 1));
      upd();
    }
    track.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try { track.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ }
      drag = e.pointerId; track.focus({ preventScroll: true }); setFromY(e.clientY);
    });
    track.addEventListener('pointermove', function (e) { if (drag === e.pointerId) setFromY(e.clientY); });
    function end() { drag = null; }
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('lostpointercapture', end);
    track.addEventListener('keydown', function (e) {
      var v = num(getInput(key), 0), d = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') d = v + 0.05;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') d = v - 0.05;
      else if (e.key === 'PageUp') d = v + 0.2;
      else if (e.key === 'PageDown') d = v - 0.2;
      else if (e.key === 'Home') d = 0;
      else if (e.key === 'End') d = 1;
      if (d === null) return;
      e.preventDefault(); e.stopPropagation();
      setInput(key, clamp(d, 0, 1)); upd();
    });
    function upd() {
      var v = clamp(num(getInput(key), 0), 0, 1), hh = H();
      knob.style.bottom = (14 + v * hh - 13).toFixed(1) + 'px';
      fill.style.height = (v * hh).toFixed(1) + 'px';
      var t = format(v, S());
      setText(val, t);
      setAttr(track, 'aria-valuenow', Math.round(v * 100));
      setAttr(track, 'aria-valuetext', t.replace(/\n/g, ' · '));
    }
    live.push(upd);
    return h('div', { class: 'vsl' + (red ? ' vsl--red' : '') }, h('span', { class: 'vsl-name', text: name }), track, val);
  }

  function stackLabel(main, small) { return [h('span', { text: main }), h('small', { text: small })]; }

  function flightPad(live) {
    var yoke = wYoke(CTRL.yoke || { nombre: 'Volante' }, live, true);
    var thr = vSlider('Acelerador', 'throttle', false, live, function (v, s) {
      var e = (s && s.engine) || {};
      return pct(v) + '\n' + (num(e.rpm, 0) > 50 ? Math.round(num(e.rpm, 0) / 10) * 10 + ' RPM' : 'apagado');
    });
    var mix = vSlider('Mezcla', 'mixture', true, live, function (v) {
      return v < 0.04 ? 'CORTE' : (v > 0.96 ? 'RICA' : pct(v));
    });

    var carb = h('button', {
      type: 'button', class: 'btn btn--stack', 'aria-pressed': 'false',
      onclick: function () { setInput('carbHeat', num(getInput('carbHeat'), 0) > 0.5 ? 0 : 1); }
    }, stackLabel('Calef. carb', 'COLD'));
    var flapUp = h('button', {
      type: 'button', class: 'btn btn--stack', 'aria-pressed': 'false',
      onclick: function () { setFlapSwitch(getInput('flapSwitch') === 'UP' ? 'OFF' : 'UP'); }
    }, stackLabel('Flaps UP', 'R'));
    var flapDnSmall = h('small', { text: 'F' });
    var flapDn = holdButton([h('span', { text: 'Flaps DOWN' }), flapDnSmall],
      function () { hold('flap-switch', null, true); }, function () { hold('flap-switch', null, false); }, 'btn--stack', 'Bajar flaps: mantené apretado');
    var view = h('button', {
      type: 'button', class: 'btn btn--stack span2',
      onclick: function () { cc('setMainView', mainView === 'exterior' ? 'cockpit' : 'exterior'); syncMainView(); kick(); }
    }, h('span', { class: 'vo-view-lbl', text: 'Ver desde afuera' }), h('small', { text: 'C' }));
    var pause = h('button', {
      type: 'button', class: 'btn btn--stack span2', 'aria-pressed': 'false',
      onclick: function () {
        var s = S(); if (!s) return;
        if (has('setPaused')) cc('setPaused', !s.paused); else s.paused = !s.paused;
        kick();
      }
    }, h('span', { class: 'vo-pause-lbl', text: 'Pausa' }), h('small', { text: 'P' }));

    live.push(function (s) {
      var ch = num(s.carbHeat, 0) > 0.5;
      setAttr(carb, 'aria-pressed', ch ? 'true' : 'false');
      setText(carb.querySelector('small'), ch ? 'HOT' : 'COLD');
      setAttr(flapUp, 'aria-pressed', s.flapSwitch === 'UP' ? 'true' : 'false');
      setText(flapDnSmall, 'F · ' + Math.round(num(s.flaps, 0)) + '°');
      setText(view.querySelector('.vo-view-lbl'), mainView === 'exterior' ? 'Ver la cabina' : 'Ver desde afuera');
      setAttr(pause, 'aria-pressed', s.paused ? 'true' : 'false');
      setText(pause.querySelector('.vo-pause-lbl'), s.paused ? 'Seguir' : 'Pausa');
    });

    return h('div', { class: 'flypad', role: 'group', 'aria-label': 'Mandos en pantalla' },
      h('p', { class: 'flypad-ovnote' }, 'El ', h('strong', { text: 'volante' }), ', los pedales, los frenos y el acelerador están sobre la vista 3D, abajo. Acá tenés el resto.'),
      yoke,
      h('div', { class: 'flypad-sliders' }, thr, mix),
      h('div', { class: 'flypad-btns' },
        holdButton(stackLabel('◀ Pedal', 'Z'), function () { hold('rudder-pedals', 'left', true); }, function () { hold('rudder-pedals', 'left', false); }, 'btn--stack', 'Pedal izquierdo: mantené apretado'),
        holdButton(stackLabel('Frenos', 'B'), function () { hold('toe-brakes', null, true); }, function () { hold('toe-brakes', null, false); }, 'btn--stack', 'Frenos: mantené apretado'),
        holdButton(stackLabel('Pedal ▶', 'X'), function () { hold('rudder-pedals', 'right', true); }, function () { hold('rudder-pedals', 'right', false); }, 'btn--stack', 'Pedal derecho: mantené apretado'),
        carb,
        flapUp, flapDn,
        holdButton(stackLabel('Trim ▼', 'nariz abajo · T'), function () { VO.trimDir = -1; }, function () { VO.trimDir = 0; }, 'btn--stack', 'Compensador nariz abajo: mantené apretado'),
        holdButton(stackLabel('Trim ▲', 'nariz arriba · G'), function () { VO.trimDir = 1; }, function () { VO.trimDir = 0; }, 'btn--stack', 'Compensador nariz arriba: mantené apretado'),
        view, pause));
  }

  /**
   * Phones in portrait: a compact pad over the bottom of the 3D view (volante, pedales, frenos, acelerador,
   * pausa), so the student flies while watching the cabin instead of scrolling the panel. CSS shows it only on
   * narrow portrait screens; the rest of the controls stay in the panel.
   */
  function flightOverlay(live) {
    var yoke = wYoke(CTRL.yoke || { nombre: 'Volante' }, live, true);
    var thr = vSlider('Acelerador', 'throttle', false, live, function (v, s) {
      var e = (s && s.engine) || {};
      return pct(v) + '\n' + (num(e.rpm, 0) > 50 ? Math.round(num(e.rpm, 0) / 10) * 10 + ' rpm' : 'apagado');
    });
    var pause = h('button', {
      type: 'button', class: 'btn btn--ov', 'aria-pressed': 'false',
      onclick: function () {
        var s = S(); if (!s) return;
        if (has('setPaused')) cc('setPaused', !s.paused); else s.paused = !s.paused;
        kick();
      }
    }, 'Pausa');
    live.push(function (s) {
      setAttr(pause, 'aria-pressed', s.paused ? 'true' : 'false');
      setText(pause, s.paused ? 'Seguir' : 'Pausa');
    });
    var mid = h('div', { class: 'vfp-mid' },
      h('div', { class: 'vfp-row' },
        holdButton('◀ Pedal', function () { hold('rudder-pedals', 'left', true); }, function () { hold('rudder-pedals', 'left', false); }, 'btn--ov', 'Pedal izquierdo: mantené apretado'),
        holdButton('Pedal ▶', function () { hold('rudder-pedals', 'right', true); }, function () { hold('rudder-pedals', 'right', false); }, 'btn--ov', 'Pedal derecho: mantené apretado')),
      holdButton('Frenos', function () { hold('toe-brakes', null, true); }, function () { hold('toe-brakes', null, false); }, 'btn--ov', 'Frenos: mantené apretado'),
      pause);
    return h('div', { id: 'vp-flypad', class: 'vp-flypad', role: 'group', 'aria-label': 'Mandos de vuelo sobre la vista 3D', hidden: true },
      yoke, mid, thr);
  }
  function showFlightOverlay(on) {
    var vp = $('viewport');
    if (!vp) return;
    if (on && !VO.overlay && coreReady) {
      VO.overlay = flightOverlay(VO.ovLive);
      vp.appendChild(VO.overlay);
      var setH = function () { if (VO.overlay) vp.style.setProperty('--flypad-h', (VO.overlay.offsetHeight || 0) + 'px'); positionCaption(); };
      if (root.ResizeObserver) new ResizeObserver(setH).observe(VO.overlay);
      VO.setH = setH;
    }
    if (!VO.overlay) return;
    VO.overlay.hidden = !on;
    toggleClass($('app'), 'has-flypad', !!on);
    if (on && VO.setH) VO.setH(); else positionCaption();
    var s = S();
    if (on && s) runLive(VO.ovLive, s);
  }
  /** True when the overlay pad is really on screen (CSS hides it on wide or landscape screens). */
  function flypadShown() { return !!(VO && VO.overlay && !VO.overlay.hidden && VO.overlay.offsetHeight > 0); }

  function missionPanel(live) {
    var m = VO.m;
    var bar = progressBar(VO.progress, VO.achieved);
    var pctEl = h('span', { class: 'pct' });
    live.push(function () {
      bar.set(VO.progress, VO.achieved);
      setText(pctEl, VO.achieved ? 'Cumplida' : Math.round(VO.progress * 100) + ' %');
    });
    var pasos = arr(m.pasos);
    var ol = null;
    if (pasos.length) { ol = h('ol', { class: 'steps' }); pasos.forEach(function (p) { ol.appendChild(h('li', { text: typeof p === 'string' ? p : (p && p.texto) || '' })); }); }
    return [
      h('div', { class: 'mission-bar', role: 'status' },
        h('div', { class: 'mission-bar-top' }, h('span', { class: 'mission-bar-title', text: 'Misión: ' + (m.titulo || '') }), pctEl),
        bar),
      h('article', { class: 'card', 'aria-labelledby': 'vo-mission-title' },
        h('p', { class: 'kicker', text: 'Misión' }),
        h('h2', { class: 'placard detail-title', id: 'vo-mission-title', tabindex: '-1', text: m.titulo || '' }),
        m.objetivo ? h('p', { class: 'lead', text: m.objetivo }) : null,
        VO.achieved ? h('div', { class: 'card done-card' },
          h('h3', { class: 'placard', text: '¡Misión cumplida!' }),
          h('p', { text: 'Lo lograste. Probá la siguiente o repetila para hacerlo más prolijo.' })) : null,
        ol ? sec('Paso a paso', ol) : null,
        m.consejo ? callout('Consejo', m.consejo) : null,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { startMission(m); } }, icon('retry'), VO.achieved ? 'Otra vez' : 'Reintentar'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: stopMission }, 'Terminar misión')))
    ];
  }

  function voRender() {
    var v = VO.view;
    if (!v) return;
    var hadFocus = v.contains(doc.activeElement);
    releaseAllHolds();
    VO.trimDir = 0;
    VO.live = [];
    clear(v);
    if (VO.m) add(v, missionPanel(VO.live));
    else v.appendChild(modeHead('Volar', 'Elegí dónde está el avión, practicá con los mandos y mirá cómo responden los instrumentos.'));

    v.appendChild(h('div', { class: 'block', style: VO.m ? null : { 'margin-top': '4px' } },
      h('h3', { class: 'placard placard--small block-title', text: 'Instrumentos' }), buildHud(VO.live)));
    v.appendChild(h('div', { class: 'block' },
      h('h3', { class: 'placard placard--small block-title', text: 'Mandos' }), flightPad(VO.live)));

    var P = (C150.Sim && C150.Sim.PRESETS) || {};
    var scen = h('div', { class: 'scen-grid' });
    var scenBtns = [];
    SCENARIOS.forEach(function (sc) {
      var label = (P[sc[0]] && P[sc[0]].label) || sc[1];
      var b = h('button', {
        type: 'button', class: 'btn', 'aria-pressed': 'false', title: (P[sc[0]] && P[sc[0]].description) || null,
        onclick: function () { applyPreset(sc[0]); }
      }, label);
      scenBtns.push([sc[0], b]);
      scen.appendChild(b);
    });
    VO.live.push(function () { scenBtns.forEach(function (x) { setAttr(x[1], 'aria-pressed', currentPreset === x[0] ? 'true' : 'false'); }); });
    v.appendChild(h('div', { class: 'block' },
      h('h3', { class: 'placard placard--small block-title', text: 'Escenarios' }), scen,
      h('p', { class: 'soft small', style: { 'margin-top': '6px' }, text: 'Cambiar de escenario reinicia el avión: motor, palancas y posición.' })));

    var ml = h('ul', { class: 'rows', 'aria-label': 'Misiones' });
    if (!MISSIONS.length) ml.appendChild(h('li', { class: 'empty', text: 'Las misiones todavía no están cargadas.' }));
    MISSIONS.forEach(function (m, i) {
      var best = clamp(num(VO.best[m.id], 0), 0, 1);
      var active = VO.m === m;
      ml.appendChild(h('li', null, h('button', {
        type: 'button', class: 'row', 'aria-current': active ? 'true' : null, onclick: function () { startMission(m); }
      },
        h('span', { class: 'row-num', text: ('0' + (i + 1)).slice(-2) }),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-name', text: m.titulo || m.id }),
          m.objetivo ? h('span', { class: 'row-sub', text: m.objetivo }) : null,
          best > 0 ? h('span', { class: 'mission-row-progress', 'aria-hidden': 'true' }, progressBar(best, best >= 1)) : null),
        h('span', { class: 'row-end' }, best >= 1
          ? h('span', { class: 'row-done' }, 'Lograda')
          : (best > 0 ? h('span', { class: 'pct', text: 'mejor ' + Math.round(best * 100) + ' %' }) : (active ? 'en curso' : 'Empezar'))))));
    });
    v.appendChild(h('div', { class: 'block' }, h('h3', { class: 'placard placard--small block-title', text: 'Misiones' }), ml));

    v.appendChild(h('details', { class: 'fold' }, h('summary', null, 'Teclado'), keysTable()));
    var s = S();
    if (s) runLive(VO.live, s);
    if (hadFocus) { var t = $('vo-mission-title') || v.querySelector('button'); if (t) safe(function () { t.focus({ preventScroll: true }); }); }
  }

  modeImpl.volar = {
    render: function (sec) { VO.view = h('div'); sec.appendChild(VO.view); voRender(); },
    enter: function () { showFlightOverlay(true); },
    exit: function () { VO.trimDir = 0; showFlightOverlay(false); },
    slow: function (s) { runLive(VO.live, s); if (VO.overlay && !VO.overlay.hidden) runLive(VO.ovLive, s); }
  };

  /* ================================================================== QUIZ */

  var QUIZ = arr(DATA.quiz).filter(function (q) {
    if (!q || !q.pregunta) return false;
    if (q.tipo === 'donde') return !!CTRL[q.control];
    return q.tipo === 'opciones' && arr(q.opciones).length >= 2 && typeof q.correcta === 'number';
  });
  var QZ = { view: null, phase: 'start', qs: [], i: 0, score: 0, tries: 0, answered: false, chosen: -1, results: [], fb: null, lastPick: { id: null, t: 0 } };
  var QUIZ_LEN = 12;

  function qzBest() { var b = store.get('quizBest', null); return (b && typeof b.score === 'number' && typeof b.total === 'number') ? b : null; }
  function qzCur() { return QZ.qs[QZ.i] || null; }
  function qzArm() {
    var q = qzCur();
    if (mode === 'quiz' && QZ.phase === 'q' && q && q.tipo === 'donde' && !QZ.answered) {
      if (mainView === 'exterior') { cc('setMainView', 'cockpit'); syncMainView(); }
      cc('pickMode', qzOnPick);
    } else cc('pickMode', null);
  }
  function qzStart() {
    var canPick = coreReady && has('pickMode');
    var pool = QUIZ.filter(function (q) { return q.tipo !== 'donde' || canPick; });
    QZ.qs = shuffle(pool).slice(0, QUIZ_LEN);
    QZ.i = 0; QZ.score = 0; QZ.results = []; QZ.phase = QZ.qs.length ? 'q' : 'start';
    qzNewQuestion();
  }
  function qzNewQuestion() {
    QZ.tries = 0; QZ.answered = false; QZ.chosen = -1; QZ.fb = null;
    cc('setTargetHighlight', null);
    qzRender(true);
    qzArm();
  }
  function qzNext() {
    if (QZ.i + 1 >= QZ.qs.length) { qzFinish(); return; }
    QZ.i++;
    qzNewQuestion();
  }
  function qzFinish() {
    QZ.phase = 'end';
    cc('pickMode', null);
    cc('setTargetHighlight', null);
    var b = qzBest(), total = QZ.qs.length;
    QZ.newBest = !b || (QZ.score / total) > (b.score / b.total);
    if (QZ.newBest) store.set('quizBest', { score: QZ.score, total: total });
    qzRender(true);
  }
  function qzReveal(q) {
    cc('setTargetHighlight', q.control);
    focusControl(q.control, true);
  }
  function qzOnPick(id) {
    var t = now();
    if (QZ.lastPick.id === id && t - QZ.lastPick.t < 150) return;      // callback + 'pick' event of the same click
    QZ.lastPick = { id: id, t: t };
    var q = qzCur();
    if (QZ.phase !== 'q' || !q || q.tipo !== 'donde' || QZ.answered) return;
    var target = CTRL[q.control];
    if (id === q.control) {
      QZ.answered = true; QZ.score++;
      QZ.results.push({ q: q, ok: true });
      QZ.fb = { ok: true, title: '¡Correcto!', text: 'Es ' + target.nombre + '. ' + (q.explicacion || target.resumen || '') };
      focusControl(id, true);
    } else {
      QZ.tries++;
      var name = (id && CTRL[id]) ? CTRL[id].nombre : 'otra cosa';
      if (QZ.tries >= 2) {
        QZ.answered = true;
        QZ.results.push({ q: q, ok: false });
        QZ.fb = { ok: false, title: 'Era otro', text: 'Tocaste ' + name + '. Te marco el correcto: ' + target.nombre + '. ' + (q.explicacion || '') };
        qzReveal(q);
      } else {
        QZ.fb = { ok: false, title: 'Casi', text: 'Eso es ' + name + '. Probá otra vez: te queda un intento.' };
        setTimeout(qzArm, 0);
      }
    }
    qzRender(false);
  }
  function qzGiveUp() {
    var q = qzCur();
    if (!q || QZ.answered) return;
    QZ.answered = true;
    QZ.results.push({ q: q, ok: false });
    cc('pickMode', null);
    var target = CTRL[q.control];
    QZ.fb = { ok: false, title: 'Acá está', text: (target ? target.nombre + '. ' : '') + (q.explicacion || '') };
    qzReveal(q);
    qzRender(false);
  }
  function qzAnswer(k) {
    var q = qzCur();
    if (!q || QZ.answered) return;
    QZ.answered = true; QZ.chosen = k;
    var ok = k === q.correcta;
    if (ok) QZ.score++;
    QZ.results.push({ q: q, ok: ok });
    QZ.fb = { ok: ok, title: ok ? '¡Correcto!' : 'No era esa', text: q.explicacion || '' };
    qzRender(false);
  }

  function qzRender(focusTitle) {
    var v = QZ.view;
    if (!v) return;
    clear(v);
    var n = QZ.qs.length;
    if (QZ.phase === 'start') {
      var b = qzBest();
      v.appendChild(modeHead('Quiz', 'Ponete a prueba antes de la clase.'));
      if (!QUIZ.length) { v.appendChild(emptyState('Las preguntas todavía no están cargadas.')); return; }
      var canPick = coreReady && has('pickMode');
      v.appendChild(h('div', { class: 'card' },
        h('h3', { class: 'placard', style: { 'font-size': '22px' }, text: Math.min(QUIZ_LEN, QUIZ.length) + ' preguntas al azar' }),
        h('ul', { class: 'bullets', style: { margin: '8px 0 0' } },
          canPick ? h('li', null, h('strong', { text: '¿Dónde está?' }), ': respondés tocando el control en la cabina 3D. Tenés dos intentos.') : null,
          h('li', null, h('strong', { text: 'Opciones' }), ': elegís una y te explico por qué.'),
          h('li', { text: 'Cada vez salen preguntas distintas.' })),
        !canPick ? h('p', { class: 'note note--info', text: 'Sin la cabina 3D, el quiz usa sólo preguntas de opciones.' }) : null,
        b ? h('p', { class: 'soft', style: { margin: '10px 0 0' } }, 'Tu mejor resultado: ', h('strong', { class: 'mono', text: b.score + '/' + b.total })) : null,
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn--primary', id: 'qz-start', onclick: qzStart }, 'Empezar', icon('next')))));
      return;
    }
    if (QZ.phase === 'end') {
      var r = n ? QZ.score / n : 0;
      var msg = r >= 0.9 ? '¡Excelente! Ya conocés la cabina como para tu primera clase.'
        : (r >= 0.6 ? 'Muy bien. Repasá las que te costaron y volvé a probar.'
          : (r >= 0.35 ? 'Vas bien. Repasá en Explorar y en Lo básico, y probá otra vez.'
            : 'Es normal al principio. Hacé el Recorrido y las lecciones de Lo básico, y volvé a probar.'));
      var wrong = QZ.results.filter(function (x) { return !x.ok; });
      var list = null;
      if (wrong.length) {
        list = h('ul', { class: 'rows' });
        wrong.forEach(function (x) {
          var q = x.q, ans = q.tipo === 'donde' ? ctrlName(q.control) : arr(q.opciones)[q.correcta];
          list.appendChild(h('li', { style: { padding: '10px 4px' } },
            h('p', { style: { margin: '0 0 2px' }, text: q.pregunta }),
            h('p', { class: 'small', style: { margin: '0' } }, h('span', { class: 'soft', text: 'Respuesta: ' }), h('strong', { text: ans || '' })),
            q.tipo === 'donde' ? h('div', { style: { 'margin-top': '6px' } }, controlChip(q.control)) : null));
        });
      }
      var best = qzBest();
      v.appendChild(modeHead('Quiz', null));
      v.appendChild(h('article', { class: 'card', 'aria-labelledby': 'qz-title' },
        h('h2', { class: 'placard', id: 'qz-title', tabindex: '-1', style: { 'font-size': '22px' }, text: 'Resultado' }),
        h('p', { class: 'score' }, String(QZ.score), h('small', { text: '/' + n })),
        h('p', { class: 'lead', text: msg }),
        best ? h('p', { class: 'soft small', text: QZ.newBest ? '¡Es tu mejor resultado hasta ahora!' : 'Tu mejor resultado: ' + best.score + '/' + best.total }) : null,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn--primary', onclick: qzStart }, icon('retry'), 'Otra vez'),
          h('button', { type: 'button', class: 'btn', onclick: function () { setMode('explorar'); } }, 'Ir a Explorar')),
        list ? sec('Para repasar', list) : null));
      if (focusTitle) { var tt = $('qz-title'); if (tt) safe(function () { tt.focus({ preventScroll: true }); }); }
      return;
    }

    var q = qzCur();
    if (!q) return;
    var body;
    if (q.tipo === 'donde') {
      body = h('div', null,
        QZ.answered ? null : h('div', { class: 'pick-hint' }, icon('hand'),
          h('span', { text: 'Tocá el control en la cabina 3D. Podés girar la vista o usar los botones de Vistas.' })),
        !QZ.answered ? h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: qzGiveUp }, 'No sé: mostrámelo')) : null);
    } else {
      body = h('div', { class: 'opts', role: 'group', 'aria-label': 'Opciones' });
      arr(q.opciones).forEach(function (o, k) {
        var cls = 'opt';
        if (QZ.answered && k === q.correcta) cls += ' is-correct';
        else if (QZ.answered && k === QZ.chosen) cls += ' is-wrong';
        body.appendChild(h('button', { type: 'button', class: cls, disabled: QZ.answered, onclick: function () { qzAnswer(k); } },
          h('span', { class: 'opt-letter', 'aria-hidden': 'true', text: 'ABCDEFGH'.charAt(k) }), h('span', { text: o }),
          QZ.answered && k === q.correcta ? h('span', { class: 'sr-only', text: ' (correcta)' }) : null,
          QZ.answered && k === QZ.chosen && k !== q.correcta ? h('span', { class: 'sr-only', text: ' (tu respuesta)' }) : null));
      });
    }
    var fb = QZ.fb ? h('div', { class: 'feedback ' + (QZ.fb.ok ? 'feedback--ok' : 'feedback--bad'), role: 'status' },
      h('strong', { text: QZ.fb.title }), QZ.fb.text ? h('span', { text: QZ.fb.text }) : null) : null;
    var nextBtn = QZ.answered ? h('button', { type: 'button', class: 'btn btn--primary', id: 'qz-next', onclick: qzNext },
      QZ.i + 1 >= n ? 'Ver el resultado' : 'Siguiente', icon('next')) : null;
    v.appendChild(h('div', { class: 'cl-progress', style: { margin: '0 0 12px' } },
      progressBar((QZ.i + (QZ.answered ? 1 : 0)) / n), h('span', { class: 'pct', text: (QZ.i + 1) + '/' + n })));
    v.appendChild(h('article', { class: 'card', 'aria-labelledby': 'qz-q' },
      h('p', { class: 'kicker' }, 'Pregunta ' + (QZ.i + 1) + ' de ' + n, h('span', { class: 'soft', text: ' · ' + (q.tipo === 'donde' ? '¿Dónde está?' : 'Opciones') })),
      h('h2', { class: 'quiz-q', id: 'qz-q', tabindex: '-1', text: q.pregunta }),
      body, fb,
      nextBtn ? h('div', { class: 'btn-row' }, nextBtn) : null,
      h('p', { class: 'soft small', style: { margin: '12px 0 0' }, text: 'Puntaje: ' + QZ.score + ' de ' + (QZ.i + (QZ.answered ? 1 : 0)) })));
    if (focusTitle) { var qt = $('qz-q'); if (qt && mode === 'quiz') safe(function () { qt.focus({ preventScroll: true }); }); }
    else if (nextBtn && mode === 'quiz') safe(function () { nextBtn.focus({ preventScroll: true }); });
  }

  modeImpl.quiz = {
    render: function (sec) { QZ.view = h('div'); sec.appendChild(QZ.view); qzRender(false); },
    enter: function () { qzArm(); if (QZ.phase === 'q' && QZ.answered && QZ.fb && !QZ.fb.ok) { var q = qzCur(); if (q && q.tipo === 'donde') cc('setTargetHighlight', q.control); } },
    exit: function () { cc('pickMode', null); cc('setTargetHighlight', null); }
  };

  /* ================================================================== boot */

  function onSelect(id) {
    kick();
    if (mode === 'explorar') {
      if (id && CTRL[id]) { if (EX.id !== id) openControl(id, '3d'); }
      else if (!id && EX.id && !isProgrammatic(null)) closeDetail();
      return;
    }
    if (id && CTRL[id] && !isProgrammatic(id)) showPeek(id);
  }

  function startCore(state) {
    var Co = C150.Core;
    var errMsg = '';
    if (!Co || !isFn(Co.init)) {
      showOverlayError('No se pudo iniciar la cabina 3D', 'Falta una parte del programa. Recargá la página. Mientras tanto podés usar las fichas, las lecciones, las checklists y el quiz de opciones.');
      return false;
    }
    if (isFn(Co.on)) safe(function () { Co.on('error', function (m) { if (typeof m === 'string') errMsg = m; }); });
    var ok = false;
    if (!root.THREE) errMsg = errMsg || 'No se pudo cargar la biblioteca de gráficos 3D (Three.js). Revisá la conexión a internet y recargá la página.';
    else {
      var q0 = store.get('quality', 'auto');
      if (['auto', 'alta', 'media', 'baja'].indexOf(q0) < 0) q0 = 'auto';
      try { ok = Co.init({ container: $('viewport'), state: state, quality: q0 }) !== false; }
      catch (e) { logError('Core.init', e); ok = false; }
    }
    if (!ok) {
      showOverlayError('Tu navegador no pudo mostrar el 3D',
        (errMsg || 'No pudimos iniciar los gráficos 3D (WebGL). Probá con Chrome, Edge, Firefox o Safari actualizados, o activá la aceleración por hardware.') +
        ' Igual podés usar las fichas, las lecciones, las checklists y el quiz de opciones.');
      return false;
    }
    coreReady = true;
    if (Co.state) UI.state = Co.state;
    if (isFn(Co.on)) {
      Co.on('frame', onFrame);
      Co.on('hover', onHover);
      Co.on('select', onSelect);
      Co.on('operate', function () { kick(); });
      Co.on('viewchange', function (name) { if (name === 'cockpit' || name === 'exterior') mainView = name; syncMainView(); kick(); });
      Co.on('layout', onLayout);
      Co.on('pick', function (id) { if (mode === 'quiz') qzOnPick(id); });
      Co.on('pause', function () { kick(); });
      Co.on('quality', function () { syncQuality(); });
      Co.on('preset', function (name) {         // mark the camera preset in use ("Vistas")
        var bs = doc.querySelectorAll('.cam-btn');
        for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-cam') === name ? 'true' : 'false');
      });
      Co.on('scenario', function (name) { if (!applyingPreset && name) presetApplied(name); });
    }
    var r = cc('getInsetRect');
    if (r) onLayout(r);
    syncMainView();
    safe(syncQuality, 'quality');
    setTimeout(hideOverlay, 8000);               // never leave the veil up if frames are slow to arrive
    return true;
  }

  UI.init = function () {
    if (UI._booted) return;
    UI._booted = true;
    var state = null;
    if (C150.Sim && isFn(C150.Sim.createState)) state = safe(function () { return C150.Sim.createState('parked'); }, 'createState') || null;
    UI.state = state;
    safe(setupTheme, 'theme');
    safe(setupSound, 'sound');
    safe(setupHelp, 'help');
    safe(setupQuality, 'quality');
    safe(setupTabs, 'tabs');
    safe(setupViewport, 'viewport');
    safe(setupPeek, 'peek');
    root.addEventListener('blur', releaseAllHolds);
    var ok = safe(function () { return startCore(state); }, 'startCore');
    if (!ok) { coreReady = false; if (state) startLocalLoop(); }
    var m = (root.location.hash || '').slice(1);
    setMode(MODES.indexOf(m) >= 0 ? m : 'explorar', { fromHash: true, noScrollTab: true });
    if (!state) showToast({ text: 'No se pudo cargar la simulación: las fichas funcionan, pero los controles no se mueven.', kind: 'warn' });
  };
  UI.setMode = function (name) { setMode(name); };
  UI.getMode = function () { return mode; };
  UI.showControl = function (id) {
    if (!CTRL[id]) return;
    setMode('explorar');
    openControl(id, 'list');
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { UI.init(); });
  else UI.init();
})(root.C150);
