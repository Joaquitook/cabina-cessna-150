var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * ui.js — C150.UI: the whole app shell and every DOM interaction (contract §4 ui, §7, §8).
 *
 *   C150.UI.init()            boots once (auto on DOMContentLoaded): theme, tabs, help, viewport overlays,
 *                             Core.init({container:#viewport, state}) and the six modes.
 *   C150.UI.setMode(name)     'inicio' | 'explorar' | 'basico' | 'recorrido' | 'checklists' | 'volar' | 'quiz' | 'aire' | 'escuela'
 *                             or a nav group: 'cabina' (= explorar) | 'lecciones' | 'practicar' (open the sub-tab used last).
 *   C150.UI.go(path)          route string, like the URL hash: 'lecciones/basico', 'practicar', 'cabina/yoke', 'aire/<expId>',
 *                             'escuela/AER-03-02' (reserved: handed to C150.Escuela.go(rest)). Returns false if unknown.
 *   C150.UI.showControl(id)   opens Explorar with that control's card.
 *   C150.UI.getMode()         current mode name.   C150.UI.getGroup()   current nav group id.
 *   C150.UI.openLab(expId?)   opens the AIRE tab ("Laboratorio del aire", lab.js) and, if given, that experiment.
 *   C150.UI.toast({text, kind}) small message over the 3D view (kind: info | warn | good).
 *   C150.UI.syncNav()         re-reads nav state (shows the ESCUELA item once window.C150.Escuela exists).
 *  Contract v4 (UI/UX redesign, wave U1 — shell):
 *  - Navigation = groups: Inicio · Cabina · Lecciones (Recorrido guiado | Lecciones) · Practicar (Checklists | Misiones y situaciones | Quiz)
 *    · Aire · [Escuela]. Hash routing: #inicio #cabina #lecciones #practicar #aire #escuela plus every old hash (#explorar #basico #recorrido
 *    #checklists #volar #quiz) as aliases; no hash → Inicio. The sub-tab used last in a group is remembered (localStorage 'c150.sub.<group>').
 *  - 'inicio' is rendered by C150.Home.render(sectionEl, api) when home.js exists, else by a small "Tu camino" placeholder (Progress.summary()).
 *  - Phones (≤ 760 px portrait): bottom nav + the panel is a bottom sheet with 3 snap points (peek 88 px / half 50 % / full 90 %), drag handle,
 *    swipe, tap/Enter to cycle, remembered per mode ('c150.sheet'). ui.js writes --sheet-* px vars on .main (styles.css reads them).
 *  - Progress: C150.Progress.mark() from the existing activities (store.set hooks + explicit marks), see "progress bridge".
 *
 *  Contract v4, wave U3 — Cabina cards + 3D overlay:
 *  - Cabina (explorar): header + progress ("Viste N de M controles", C150.Progress 'cabina'), "Empezá por acá" (next essentials), search
 *    field (C150.Search.rank when present), category chips with icons, list grouped by category with the essentials first and a check on
 *    what was already opened. The card: category / Esencial / Visto badges, summary, actions (Mostrámelo en 3D · Ver en el avión · Ver el
 *    aire), "Probalo" (kit-styled widgets), then accordions: Dónde está + Qué hace (open), Cada parte, Qué pasa en el avión, Cómo se usa
 *    (numbered), Cuándo se usa, Errores comunes, Truco, Dato curioso, Marcas de colores, En otros años y modelos; related chips; prev/next.
 *  - Over the 3D (contract v5 — the AIRE language on every tab, Kit.hud / Kit.dock / Kit.chainBar):
 *      HUD (top-left, #hud): big MOTOR · VELOCIDAD · ALTURA (each opens a popover with the plain explanation and "Ver en 3D"), a mono line
 *      (Corriente (master) · flaps · en tierra/en vuelo) and a status pill; below it the tab's extras (hudExtra): the control picked in
 *      Cabina + its live value, the lesson step + its two live numbers, the checklist / mission progress. Hidden in Inicio.
 *      Dock (bottom, #dock): VISTA (camera presets, keys 1–8) · DISEÑO (Cabina · Las dos · Afuera) · ESCENARIO chip (popover with SCN_PLAIN +
 *      C150.Sim.PRESETS; "Demostración en curso" + "Volver al escenario" during a demonstration). On phones one scrollable row above the sheet.
 *      Chain bar (#chain-bar, over the dock): max 3 chips, hidden when empty (chainContent): Cabina [control → what it does → what it moves],
 *      Recorrido / Lecciones [step → what is happening], checklists [item → why], missions [goal → hint]; with nothing contextual, the
 *      instructor's tip (COACH_TIPS; dismissals in localStorage 'c150.coach'; UI.resetTips()) is shown there as "Consejo".
 *      Hover / selected / target controls get the .callout3d pill with a leader line (Core.projectControl).
 *      'Las dos' side by side keeps the dock and the chain under the cockpit half.
 *  - Quiz: start card, one question per card with progress and score, big options, friendly feedback (+ "La correcta: …"), result with score ring,
 *    "Temas para repasar" (QZ_TOPICS → lesson), the wrong ones in an accordion and "Seguí con…".
 *  - "Siguiente paso" bar (#nextbar, NX): one suggestion from Progress + the open tab (nxPick), hidden while an activity runs or a completion
 *    screen is up (nxBusy), dismissible per tab for the session (sessionStorage 'c150.nx'), sticky at the panel bottom (above the nav on phones).
 *  - The subtitle box (#inset-caption) is gone: its text now goes into the chain bar (v5).
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
 *  - AIRE mode is built by C150.Lab (lab.js) through labApi(): the same helpers (h, icon, cc, setInput,
 *    applyPreset…) so every Core call stays guarded. Without lab.js the tab shows a short notice.
 *  Contract v3:
 *  - Checklists: an item ticks only after its check() has been true for ≥ 0.8 s continuously AND nothing is being
 *    touched (uiInteracting(): any pointer down in the page, held flight keys, hold buttons, Core.isInteracting()).
 *    Meanwhile the row shows "✓ Bien — soltá". Camera moves wait for idle (whenIdle). UI pointers are reported to
 *    Core.setInteracting('ui', bool) so core's own fly-to also waits.
 *  - Lessons: pasos[].acciones → buttons that HOLD a movement (Core.poseExterior, else ext.pose, else the closest
 *    animation looped) + "Automático" (the step animation, optional loop). Desktop (≥ 700 px, not mobile) switches to
 *    the 'dos' layout for the lesson and gives the previous layout back at the end; phones keep the inset. The cockpit
 *    view is labelled "Así se ve desde adentro" while a lesson / pose / animation is mirrored.
 *  - Layout switch "Cabina · Las dos · Afuera" in the dock (Core.setLayout; 'Las dos' hidden without it), persisted
 *    in localStorage 'c150.layout'. 3D callouts: label + leader line for the hovered control (any mode) or the
 *    selected one (Explorar, Recorrido, Checklists, Lo básico), anchored with Core.projectControl.
 *  - VOLAR has two sections: "Practicar" (as before) and "Situaciones" (C150.Situations, situations.js + data).
 *    A "Mostrar el aire" switch (both sections; on by default on computers, off on phones, localStorage 'c150.volarAir')
 *    turns on Core.setAirPeek('vuelo'): the flow is always drawn in the exterior view while flying and the caption shows
 *    only the calm air explanations of deliberate inputs (no generic surfaces line).
 *  - Demonstrations (a lesson / Explorar animation or a held pose mirrored into the cockpit): the "Escenario" selector
 *    shows "Demostración en curso" with a "Volver al escenario" button, and a "Demostración" chip leads the status
 *    chips (which then describe the demonstration airplane); picking a scenario ends the demonstration first.
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
      if (STORE_HOOKS && STORE_HOOKS[k]) safe(function () { STORE_HOOKS[k](v, false); }, 'progress hook ' + k);
    }
  };

  /* ================================================================== progress bridge (C150.Progress, progress.js)
     The existing activities already persist their own state through store.set(); the hooks below turn each of those
     writes into a Progress.mark() (so lessons, checklists, missions, situations, AIRE experiments and the quiz
     count towards "Tu camino" without touching their code). Recorrido and "controls opened" are marked explicitly. */
  function PG() { var p = C150.Progress; return (p && typeof p.mark === 'function') ? p : null; }
  function progMark(kind, id, data, silent) {
    var p = PG();
    if (!p) return;
    safe(function () { if (silent) { if (!p.get(kind, id)) p.mark(kind, id, data, { silent: true }); } else p.mark(kind, id, data); }, 'progress.mark');
  }
  function progTouch(kind, id, data) { var p = PG(); if (p && typeof p.touch === 'function') safe(function () { p.touch(kind, id, data); }, 'progress.touch'); }
  var STORE_HOOKS = {
    // v = the value just stored; silent = importing what an earlier visit stored (does not count as "last activity")
    lessonsDone: function (v, silent) { arr(v).forEach(function (id) { if (!silent && PG() && PG().get('leccion', id)) return; progMark('leccion', id, undefined, silent); }); },
    checklistsDone: function (v, silent) { arr(v).forEach(function (id) { if (!silent && PG() && PG().get('checklist', id)) return; progMark('checklist', id, undefined, silent); }); },
    labDone: function (v, silent) { arr(v).forEach(function (id) { if (!silent && PG() && PG().get('aire', id)) return; progMark('aire', id, undefined, silent); }); },
    situationsDone: function (v, silent) {
      Object.keys(v || {}).forEach(function (id) { if (!v[id]) return; if (!silent && PG() && PG().get('situacion', id)) return; progMark('situacion', id, undefined, silent); });
    },
    missionsBest: function (v, silent) {
      Object.keys(v || {}).forEach(function (id) {
        if (num(v[id], 0) < 1) return;
        if (!silent && PG() && PG().get('mision', id)) return;
        progMark('mision', id, { mejor: 1 }, silent);
      });
    },
    quizBest: function (v, silent) { if (v && num(v.total, 0) > 0) progMark('quiz', 'best', { score: num(v.score, 0), total: v.total }, silent); }
  };
  function importLegacyProgress() {
    Object.keys(STORE_HOOKS).forEach(function (k) { var v = store.get(k, null); if (v !== null) safe(function () { STORE_HOOKS[k](v, true); }, 'import ' + k); });
  }

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
    cabin: '<path d="M3 18c2-7 5-10 9-10s7 3 9 10"/><path d="M8 18v-3h8v3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h16a3 3 0 1 1-3 3M3 16.5h7"/>',
    split: '<rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="M12 5v14"/>',
    alt: '<path d="M12 20V5M7.5 9.5L12 5l4.5 4.5"/><path d="M5 20h14"/>'
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
    syncScenarioBtn();
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

  /* ================================================================== "is the student still moving something?"
   * Checklists (and lessons/situations) must never advance, move the camera or touch the controls while the student is
   * still dragging a knob, holding a button or flying with the keyboard. Core.isInteracting() (contract v3) covers the
   * 3D drags; this UI-side tracker covers every pointer that is down anywhere in the page (Probalo sliders, the pad,
   * hold buttons), held flight keys and press-and-hold buttons, so the fix works with or without the new Core API. */
  var ptrDown = {}, ptrCount = 0, ptrLastAct = 0, keysDown = {}, keyCount = 0;
  var FLY_KEYS = { arrowleft: 1, arrowright: 1, arrowup: 1, arrowdown: 1, z: 1, x: 1, b: 1, f: 1, t: 1, g: 1,
    pageup: 1, pagedown: 1, '+': 1, '-': 1, '=': 1 };
  var idleQueue = [];
  function resetInteraction() { var was = ptrCount; ptrDown = {}; ptrCount = 0; keysDown = {}; keyCount = 0; if (was) cc('setInteracting', 'ui', false); }
  function setupInteractionTracking() {
    function down(e) {
      ptrLastAct = now();
      if (!ptrDown[e.pointerId]) { ptrDown[e.pointerId] = 1; ptrCount++; if (ptrCount === 1) cc('setInteracting', 'ui', true); }
    }
    function up(e) {
      if (!ptrDown[e.pointerId]) return;
      delete ptrDown[e.pointerId];
      ptrCount = Math.max(0, ptrCount - 1);
      if (!ptrCount) cc('setInteracting', 'ui', false);
      kick();
    }
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('pointerup', up, true);
    root.addEventListener('pointercancel', up, true);
    root.addEventListener('pointermove', function (e) {
      if (!ptrCount) return;
      ptrLastAct = now();
      if (e.pointerType === 'mouse' && e.buttons === 0 && ptrDown[e.pointerId]) up(e);   // released outside the window
    }, true);
    root.addEventListener('blur', function () { resetInteraction(); kick(); });
    doc.addEventListener('keydown', function (e) {
      var k = String(e.key || '').toLowerCase();
      if (!FLY_KEYS[k] || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!keysDown[k]) { keysDown[k] = 1; keyCount++; }
    }, true);
    doc.addEventListener('keyup', function (e) {
      var k = String(e.key || '').toLowerCase();
      if (keysDown[k]) { delete keysDown[k]; keyCount = Math.max(0, keyCount - 1); kick(); }
      if (!e.key || e.key === 'Shift') { keysDown = {}; keyCount = 0; }
    }, true);
  }
  function uiInteracting() {
    if (ptrCount > 0 && now() - ptrLastAct > 20000) resetInteraction();   // a lost pointerup never blocks for good
    if (ptrCount > 0 || keyCount > 0 || activeHolds.length) return true;
    return cc('isInteracting') === true;
  }
  /** Runs fn now if the student is not touching anything, otherwise as soon as they let go. */
  function whenIdle(fn, key) {
    if (!uiInteracting()) { safe(fn, 'whenIdle'); return; }
    for (var i = 0; i < idleQueue.length; i++) if (key && idleQueue[i].key === key) { idleQueue[i].fn = fn; return; }
    idleQueue.push({ fn: fn, key: key || null });
  }
  function flushIdle() {
    if (!idleQueue.length || uiInteracting()) return;
    var q = idleQueue.splice(0, idleQueue.length);
    q.forEach(function (x) { safe(x.fn, 'whenIdle'); });
  }

  /* ================================================================== modes framework */

  var MODES = ['inicio', 'explorar', 'basico', 'recorrido', 'checklists', 'volar', 'quiz', 'aire', 'escuela'];
  var modeImpl = {};          // name → { render(section), enter(), exit(), slow(state), frame(state, dt) }
  var rendered = {};
  var scrollMem = {};
  var mode = null;

  /* ---- navigation groups (contract v4 §2). Modes are unchanged; groups only decide what the nav and the sub-tabs show. */
  var GROUPS = [
    { id: 'inicio', modes: ['inicio'] },
    { id: 'cabina', modes: ['explorar'] },
    { id: 'lecciones', modes: ['recorrido', 'basico'], first: 'recorrido' },
    { id: 'practicar', modes: ['checklists', 'volar', 'quiz'], first: 'checklists' },
    { id: 'aire', modes: ['aire'] },
    { id: 'escuela', modes: ['escuela'] }
  ];
  var GROUP_OF = {};
  GROUPS.forEach(function (g) { g.modes.forEach(function (m) { GROUP_OF[m] = g.id; }); });
  var MODE_INFO = {                                        // title / one-line help / icon (bottom-sheet header, window title)
    inicio: { title: 'Inicio', sub: 'Tu camino y qué hacer ahora', icon: 'home' },
    explorar: { title: 'Cabina', sub: 'Tocá un mando o instrumento para conocerlo', icon: 'cabin' },
    recorrido: { title: 'Recorrido guiado', sub: 'Control por control, como el primer día', icon: 'route' },
    basico: { title: 'Lecciones', sub: 'Cómo vuela un avión, paso a paso', icon: 'book' },
    checklists: { title: 'Checklists', sub: 'Los pasos antes de cada maniobra', icon: 'checklist' },
    volar: { title: 'Misiones y situaciones', sub: 'Pasá de mirar a volar', icon: 'plane' },
    quiz: { title: 'Quiz', sub: 'Probá lo que sabés', icon: 'quiz' },
    aire: { title: 'Aire', sub: 'Mirá cómo se mueve el aire alrededor del avión', icon: 'wind' },
    escuela: { title: 'Escuela', sub: 'Teoría para el examen', icon: 'cap' }
  };
  var ROUTE_ALIAS = { cabina: 'explorar' };
  function escuelaOk() { return !!C150.Escuela; }
  function groupOf(m) { return GROUP_OF[m] || 'inicio'; }
  function groupDef(id) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === id) return GROUPS[i]; return null; }
  function hashFor(m) { return m === 'explorar' ? 'cabina' : m; }
  /** Mode name, group id ('lecciones', 'practicar', 'cabina') or old alias → a real mode, or null when unknown. */
  function resolveMode(name) {
    name = String(name || '').toLowerCase();
    if (ROUTE_ALIAS[name]) name = ROUTE_ALIAS[name];
    if (MODES.indexOf(name) >= 0) return (name === 'escuela' && !escuelaOk()) ? null : name;
    var g = groupDef(name);
    if (g && g.first) {
      var sub = store.get('sub.' + g.id, g.first);
      return g.modes.indexOf(sub) >= 0 ? sub : g.first;
    }
    return null;
  }

  /* ---- 3D context per tab (contract v6): what the student sees of the 3D scene is saved when a tab is left and given back when it is
   *  entered again (only for the tabs whose enter() does not frame the camera itself); AIRE's tunnel / backdrop / airflow never leak. */
  var tabCtx = {};
  var preAire = null;
  var CTX_MODES = { explorar: 1, volar: 1, quiz: 1 };
  var navQuiet = 0;                    // > 0 while Nav (popstate, show) performs a change: the user-level wrappers must not write history
  function restoreCtx(v) { if (v && coreReady) { cc('setViewState', v, { smooth: false }); syncMainView(); } }

  /** RAW tab switch (no history): the user-level entry points are navGo / navOpen (IR / ABRIR) below. */
  function setMode(name, opts) {
    name = resolveMode(name) || 'inicio';
    if (name === mode) { syncNav(); return; }
    var panel = $('panel'), ctxLeft = null;
    if (mode) {
      scrollMem[mode] = panel.scrollTop;
      ctxLeft = coreReady ? cc('getViewState') : null;
      if (ctxLeft) tabCtx[mode] = ctxLeft;
      var prev = modeImpl[mode];
      releaseAllHolds();
      navProv(mode, 'pause');
      if (prev && prev.exit) safe(prev.exit, 'exit ' + mode);
      $('panel-' + mode).hidden = true;
      if (mode === 'aire' && preAire) { restoreCtx(preAire); preAire = null; }
    }
    if (C150.Nav && isFn(C150.Nav.clearLook)) C150.Nav.clearLook();
    mode = name;
    if (name === 'aire') preAire = ctxLeft || (coreReady ? cc('getViewState') : null);
    var app = $('app');
    if (app) {
      app.setAttribute('data-mode', name);               // hook for per-mode CSS
      app.setAttribute('data-group', groupOf(name));
    }
    MODES.forEach(function (m) { var el = $('panel-' + m); if (el) el.hidden = m !== name; });
    syncNav(opts);
    var sec = $('panel-' + name);
    sec.hidden = false;
    var impl = modeImpl[name];
    if (!rendered[name] && impl && impl.render) { rendered[name] = true; safe(function () { impl.render(sec); }, 'render ' + name); }
    if (impl && impl.enter) safe(impl.enter, 'enter ' + name);
    if (CTX_MODES[name] && tabCtx[name] && coreReady) cc('setViewState', tabCtx[name], { smooth: true });
    navProv(name, 'resume');
    panel.scrollTop = scrollMem[name] || 0;
    hidePeek();
    syncAirPeek();
    sheetOnMode();
    var g = groupDef(groupOf(name));
    if (g && g.first) store.set('sub.' + g.id, name);
    store.set('lastMode', name);
    kick();
  }

  /** RAW route (same strings as the URL hash, without '#'): 'cabina', 'lecciones/basico', 'cabina/yoke', 'basico/<lessonId>',
   *  'checklists/<id>', 'aire/<expId>', 'escuela/<lessonId>'. No history is written here; Nav calls it to show a route. */
  function go(path, opts) {
    path = String(path || '').replace(/^#\/?/, '');
    var parts = path.split('/'), head = (parts[0] || '').toLowerCase(), rest = parts.slice(1).join('/');
    var m = resolveMode(head);
    if (!m) return false;
    var g = groupDef(groupOf(m));
    var sub = rest.split('/')[0];
    if (rest && g && g.modes.indexOf(sub) >= 0) { m = sub; rest = rest.split('/').slice(1).join('/'); }       // 'lecciones/basico[/id]'
    setMode(m, opts);
    if (rest) {
      if (m === 'explorar' && CTRL[rest]) openControlRaw(rest, 'list');
      else if (m === 'aire' && C150.Lab && isFn(C150.Lab.startExperiment)) safe(function () { C150.Lab.startExperiment(rest); }, 'Lab.startExperiment');
      else if (m === 'basico') { var li = lessonIndexById(rest); if (li >= 0 && !(LB.open && LB.idx === li)) lbOpenRaw(li); }
      else if (m === 'checklists') { for (var ci = 0; ci < CHECKLISTS.length; ci++) if (CHECKLISTS[ci].id === rest) { if (!(CL.open && CL.cur && CL.cur.idx === ci)) clOpenRaw(ci); break; } }
      else if (m === 'volar' && sitOk() && isFn(C150.Situations.open)) {
        var cur = isFn(C150.Situations.current) ? C150.Situations.current() : null;
        if (!(cur === rest && sitPhase() !== 'lista')) { voSetTab('situaciones'); safe(function () { C150.Situations.open(rest); }, 'Situations.open'); }
      }
      else if (m === 'escuela' && C150.Escuela && isFn(C150.Escuela.go)) safe(function () { C150.Escuela.go(rest); }, 'Escuela.go');
    }
    return true;
  }

  /* ================================================================== NAVIGATION (contract v6, src/nav.js, docs/NAVEGACION.md)
   * IR (navGo) top nav / sub-tabs / Home tiles · ABRIR (navOpen) a detail somewhere else, with the "← Volver a …" bar ·
   * MIRAR (navLook) only the camera moves, with the "Volver a la vista anterior" chip · detail / replace inside a tab.
   * Every panel registers a provider (see registerNavProviders) so Back / Forward / UP restore the exact state. */
  function NAV() { return C150.Nav || null; }
  function navOn() { var n = NAV(); return !!(n && isFn(n.mounted) && n.mounted() && navQuiet === 0); }
  function quiet(fn) { return function () { navQuiet++; try { if (isFn(fn)) fn(); } finally { navQuiet--; } }; }
  /** 'lecciones' / 'lecciones/basico' / 'cabina/yoke' / old alias → canonical route ('basico', 'cabina/yoke'), or null. */
  function routeFor(path) {
    path = String(path || '').replace(/^#\/?/, '');
    var parts = path.split('/'), head = (parts[0] || '').toLowerCase(), rest = parts.slice(1).join('/');
    var m = resolveMode(head);
    if (!m) return null;
    var g = groupDef(groupOf(m)), sub = rest.split('/')[0];
    if (rest && g && g.modes.indexOf(sub) >= 0) { m = sub; rest = rest.split('/').slice(1).join('/'); }
    return hashFor(m) + (rest ? '/' + rest : '');
  }
  function navProvider(m) { var n = NAV(); return (n && isFn(n.provider)) ? n.provider(m) : null; }
  function navProv(m, fn) {
    var p = navProvider(m);
    if (p && isFn(p[fn])) safe(function () { p[fn](); }, 'nav ' + fn + ' ' + m);
  }
  function navRoute() {
    var p = navProvider(mode);
    var r = p && isFn(p.route) ? safe(function () { return p.route(); }, 'nav route') : null;
    return r || hashFor(mode || 'inicio');
  }
  function navLabel() {
    var p = navProvider(mode);
    var l = p && isFn(p.label) ? safe(function () { return p.label(); }, 'nav label') : '';
    return l || (MODE_INFO[mode] || {}).title || '';
  }
  function navCapture() {
    var p = navProvider(mode), pn = $('panel');
    return {
      route: navRoute(), mode: mode, label: navLabel(), scroll: pn ? pn.scrollTop : 0,
      prov: p && isFn(p.capture) ? (safe(function () { return p.capture(); }, 'nav capture ' + mode) || null) : null,
      view: coreReady ? (cc('getViewState') || null) : null
    };
  }
  /** Brings a location back exactly: tab, the panel's inner state, scroll and the 3D view. */
  function restoreSnap(snap) {
    setMode(snap.mode);
    var p = navProvider(snap.mode);
    if (p && isFn(p.restore) && snap.prov) safe(function () { p.restore(snap.prov); }, 'nav restore ' + snap.mode);
    var n = NAV(), pn = $('panel');
    if (n && isFn(n.refresh)) n.refresh(true);                       // the bars first: they change the head's height
    if (pn) { pn.scrollTop = num(snap.scroll, 0); setTimeout(function () { if (mode === snap.mode) pn.scrollTop = num(snap.scroll, 0); }, 120); }
    if (snap.view && coreReady) cc('setViewState', snap.view, { smooth: true });
    sheetEnsure('half');
    kick();
  }
  function navShow(route, snap, meta) {
    var K = C150.Kit;
    if (K && isFn(K.closePopover)) K.closePopover();                  // a popover (glossary, status, scenario) never outlives a navigation
    quiet(function () {
      if (meta && meta.kind === 'pop' && snap && snap.mode) restoreSnap(snap);
      else if (!go(route)) setMode('inicio');
    })();
    var n = NAV();
    if (n && isFn(n.refresh)) n.refresh(true);
  }
  /** UP: the panel's own "go to the list" (keeps activities alive). */
  function navUp() {
    var p = navProvider(mode), done = false;
    if (!p || !isFn(p.inDetail) || !p.inDetail() || !isFn(p.up)) return false;
    quiet(function () { done = !!safe(function () { return p.up(); }, 'nav up'); })();
    if (done) { scrollPanelTop(); kick(); }
    return done;
  }

  function navUpTap() {
    var n = NAV(), p = navProvider(mode);
    if (!p || !isFn(p.inDetail) || !p.inDetail()) return false;
    if (navOn() && n && isFn(n.up)) return !!n.up();
    return navUp();
  }
  /** IR: ordinary navigation (top nav, sub-tabs, brand). Each tab remembers its own state. */
  function navGo(path, o) {
    var r = routeFor(path);
    if (!r) return false;
    if (!navOn()) { go(r); return true; }
    NAV().go(r, o);
    return true;
  }
  /** ABRIR: a detail somewhere else (lesson → ficha, ficha → AIRE, search result, Home card…): the current place stays on the stack and the
   *  destination shows "← Volver a <returnLabel>". o: {returnLabel, run} (run is called right after the route is shown). */
  function navOpen(path, o) {
    o = o || {};
    var r = routeFor(path);
    if (!r) return false;
    if (!navOn()) { var okGo = go(r); if (isFn(o.run)) o.run(); return okGo; }
    NAV().push(r, { returnLabel: o.returnLabel || navLabel(), run: quiet(function () { go(r); if (isFn(o.run)) o.run(); }) });
    return true;
  }
  /** Same tab: open a card / lesson / run (kind 'detail': UP == Back) or change it in place (kind 'replace': prev / next). */
  function navDetail(kind, route, fn) {
    if (!navOn()) { fn(); return; }
    NAV()[kind](route, { run: quiet(fn) });
  }
  /** MIRAR: only the 3D moves; the tab never changes. Shows the chip "Volver a la vista anterior". */
  function navLook(fn, label) {
    var n = NAV();
    if (!n || !isFn(n.look) || !coreReady) { fn(); return; }
    n.look(fn, { label: label || '' });
  }
  function navClearLook() { var n = NAV(); if (n && isFn(n.clearLook)) n.clearLook(); }

  /** Nav buttons (aria-current), sub-tabs, bottom-sheet header, window title, ring: everything that mirrors "where am I". */
  function syncNav() {
    var gid = groupOf(mode), info = MODE_INFO[mode] || MODE_INFO.inicio;
    var items = doc.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var g = items[i].getAttribute('data-group');
      if (g === 'escuela') items[i].hidden = !escuelaOk();
      if (g === gid) items[i].setAttribute('aria-current', 'page'); else items[i].removeAttribute('aria-current');
    }
    var lists = doc.querySelectorAll('.subtabs'), anySub = false;
    for (var j = 0; j < lists.length; j++) {
      var mine = lists[j].getAttribute('data-group') === gid;
      lists[j].hidden = !mine;
      if (mine) anySub = true;
      var tb = lists[j].querySelectorAll('.subtab');
      for (var k = 0; k < tb.length; k++) {
        var on = tb[k].getAttribute('data-mode') === mode;
        tb[k].setAttribute('aria-selected', on ? 'true' : 'false');
        tb[k].tabIndex = on ? 0 : -1;
      }
    }
    toggleClass($('panel-head'), 'has-subtabs', anySub);
    setText($('sheet-title'), info.title);
    setText($('sheet-sub'), info.sub);
    var use = $('sheet-ico-use');
    if (use) use.setAttribute('href', '#i-' + info.icon);
    try { doc.title = (mode === 'inicio' ? '' : info.title + ' · ') + 'Cabina Cessna 150'; } catch (e) { /* título fijo */ }
  }

  function scrollPanelTop() { var p = $('panel'); if (p) p.scrollTop = 0; }
  /** "El aire" in the whole app: where the student explores the cockpit, moving a flight control briefly shows the air
   *  around that part of the airplane in the exterior view (Core.setAirPeek; lessons and AIRE own the flow themselves). */
  var AIR_PEEK_MODES = { explorar: 1, recorrido: 1, checklists: 1 };
  /** VOLAR: "Mostrar el aire" → Core.setAirPeek('vuelo'): the flow is always drawn while flying and a calm caption
   *  explains only deliberate inputs (core.js "el aire en VOLAR"). On by default on computers, off on phones; remembered. */
  var volarAir = null;
  function voAirOn() {
    if (volarAir === null) {
      var v = store.get('volarAir', null);
      if (typeof v === 'boolean') volarAir = v;
      else if (coreReady) volarAir = !cc('isMobile');
      else return true;
    }
    return volarAir;
  }
  function syncAirPeek() {
    if (!has('setAirPeek')) return;
    if (mode === 'volar') cc('setAirPeek', voAirOn() ? 'vuelo' : false);
    else cc('setAirPeek', !!AIR_PEEK_MODES[mode]);
  }

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
    [['Ctrl K', '/'], 'Abrir el buscador (mandos, términos, lecciones)'],
    [['?'], 'Abrir esta ayuda'],
    [['1', '8'], 'Posiciones de la cámara (del 1 al 8)'],
    [['C'], 'Cambiar la vista grande: cabina o avión desde afuera'],
    [['P'], 'Pausa'],
    [['Esc'], 'Cerrar lo que esté abierto; si no, subir a la lista (y deseleccionar)'],
    [['Alt', '←'], 'Volver atrás (también el botón Atrás del navegador o del celular)'],
    [['Alt', '→'], 'Ir adelante']
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
  var helpTok = null;
  function openHelp() {
    var m = $('help');
    if (!m.hidden) return;
    helpReturn = doc.activeElement;
    m.hidden = false;
    var nv = NAV();
    if (nv && isFn(nv.overlayOpen) && nv.mounted && nv.mounted()) helpTok = nv.overlayOpen(function () { closeHelp(); });
    m.querySelector('.modal-card').focus();
    doc.addEventListener('keydown', helpKeys, true);
  }
  function closeHelp() {
    var m = $('help');
    if (m.hidden) return;
    m.hidden = true;
    if (helpTok) { var nv = NAV(); if (nv && isFn(nv.overlayClosed)) nv.overlayClosed(helpTok); helpTok = null; }
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
    var ht = $('help-tour'), hs = $('help-search');
    if (ht) ht.addEventListener('click', function () {
      closeHelp();
      var Ob = C150.Onboarding;
      if (Ob && isFn(Ob.start)) safe(function () { Ob.start({ force: true }); }, 'Onboarding.start');
      else showToast({ text: 'El tutorial no está disponible en este momento.', kind: 'info' });
    });
    if (hs) hs.addEventListener('click', function () { closeHelp(); openSearch(); });
    var hp = $('help-tips');
    if (hp) hp.addEventListener('click', function () { coachReset(); closeHelp(); showToast({ text: 'Listo: los consejos del instructor vuelven a aparecer abajo en la vista 3D.', kind: 'good' }); });
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

  function setupNav() {
    var items = Array.prototype.slice.call(doc.querySelectorAll('.nav-item'));
    items.forEach(function (it) {
      it.addEventListener('click', function () {
        var g = it.getAttribute('data-group');
        sheetEnsure('half');
        if (groupOf(mode) === g) {                                    // re-tap: inside a detail → UP to the tab's list; again → back to the top
          if (!navUpTap()) { scrollPanelTop(); syncNav(); }
          return;
        }
        navGo(g);
      });
      it.addEventListener('keydown', function (e) {
        var vis = items.filter(function (x) { return !x.hidden; }), i = vis.indexOf(it), j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % vis.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + vis.length) % vis.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = vis.length - 1;
        if (j < 0) return;
        e.preventDefault(); e.stopPropagation();
        vis[j].focus();
      });
    });
    var subs = Array.prototype.slice.call(doc.querySelectorAll('.subtab'));
    subs.forEach(function (t) {
      t.addEventListener('click', function () { navGo(t.getAttribute('data-mode')); });
      t.addEventListener('keydown', function (e) {
        var sibs = Array.prototype.slice.call(t.parentNode.querySelectorAll('.subtab')), i = sibs.indexOf(t), j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % sibs.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + sibs.length) % sibs.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = sibs.length - 1;
        if (j < 0) return;
        e.preventDefault(); e.stopPropagation();
        navGo(sibs[j].getAttribute('data-mode'));
        sibs[j].focus();
      });
    });
    var skip = $('skip-link');          // "Saltar al contenido": no cambia el hash (lo usa el ruteo), sólo mueve el foco al panel activo
    if (skip) skip.addEventListener('click', function (e) {
      e.preventDefault();
      var cur = doc.querySelector('.mode:not([hidden])');
      sheetEnsure('half');
      if (cur) cur.focus();
    });
    var brand = $('brand');
    if (brand) brand.addEventListener('click', function () { navGo('inicio'); sheetEnsure('half'); });
    var ring = $('btn-progress');
    if (ring) ring.addEventListener('click', function () { navGo('inicio'); sheetEnsure('half'); });
    var sb = $('btn-search');
    if (sb) sb.addEventListener('click', function () { openSearch(); });
    doc.addEventListener('keydown', function (e) {
      if (isTyping(e.target)) return;
      var k = e.key;
      if ((k === 'k' || k === 'K') && (e.ctrlKey || e.metaKey) && searchOk()) { e.preventDefault(); openSearch(); }
      else if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && searchOk()) { e.preventDefault(); openSearch(); }
    });
    root.addEventListener('hashchange', function () {                // typed / pasted hashes; Back and Forward arrive through Nav's popstate
      var h2 = (root.location.hash || '').slice(1);
      if (!h2) return;
      var n = NAV();
      if (n && isFn(n.mounted) && n.mounted()) { if (h2 !== n.currentRoute()) navGo(h2); return; }
      go(h2);
    });
    syncSearchBtn();
  }
  /* search: C150.Search (search.js, wave U2). Until it exists the button explains that it is coming. */
  function searchOk() { var S2 = C150.Search; return !!(S2 && isFn(S2.open)); }
  function openSearch() {
    if (searchOk()) { safe(function () { C150.Search.open(); }, 'Search.open'); return; }
    showToast({ text: 'El buscador llega pronto: vas a poder buscar mandos, términos y lecciones.', kind: 'info' });
  }
  function syncSearchBtn() {
    var sb = $('btn-search');
    if (!sb) return;
    var t = searchOk() ? 'Buscar (Ctrl+K o /)' : 'Buscar: próximamente';
    sb.title = t;
  }

  /* ================================================================== bottom sheet (phones in portrait, ≤ 760 px)
     The side panel becomes a sheet over the bottom of .main with three snap points. Layout is plain CSS driven by
     four px variables written on .main: --sheet-full (panel height), --sheet-visible (how much of it shows),
     --sheet-reserve (height taken from the 3D view: peek / half; "full" keeps the half size) and --sheet-pad. */
  var SNAPS = ['peek', 'half', 'full'];
  var SH = { mq: null, active: false, snap: 'half', mem: {}, drag: null, raf: 0 };
  var PEEK_PX = 88;

  function sheetMain() { return doc.querySelector('.main'); }
  function sheetMetrics() {
    var m = sheetMain(), H = m ? m.clientHeight : 0;
    var half = Math.max(Math.round(H * 0.5), PEEK_PX + 48);
    return { H: H, peek: PEEK_PX, half: half, full: Math.max(Math.round(H * 0.9), half + 48) };
  }
  function sheetVisible(snap, m) { return snap === 'full' ? m.full : (snap === 'half' ? m.half : m.peek); }
  function sheetApply(snap, remember) {
    if (!SH.active) return;
    var m = sheetMetrics(), main = sheetMain(), panel = $('panel');
    if (!main || !panel || !m.H) return;
    if (SNAPS.indexOf(snap) < 0) snap = 'half';
    SH.snap = snap;
    var vis = sheetVisible(snap, m);
    main.style.setProperty('--sheet-full', m.full + 'px');
    main.style.setProperty('--sheet-visible', vis + 'px');
    main.style.setProperty('--sheet-reserve', (snap === 'full' ? m.half : vis) + 'px');
    main.style.setProperty('--sheet-pad', (m.full - vis) + 'px');
    panel.setAttribute('data-snap', snap);
    setAttr($('sheet-grip'), 'aria-expanded', snap === 'peek' ? 'false' : 'true');
    if (remember && mode) { SH.mem[mode] = snap; store.set('sheet', SH.mem); }
    positionCaption();
    kick();
  }
  function sheetOnMode() { if (SH.active && mode) sheetApply(SH.mem[mode] || 'half', false); }
  /** Make sure at least `min` of the panel is showing (a control was tapped in 3D, a nav item chosen…). */
  function sheetEnsure(min) {
    if (SH.active && SNAPS.indexOf(SH.snap) < SNAPS.indexOf(min)) sheetApply(min, false);
  }
  function sheetCycle() { sheetApply(SH.snap === 'peek' ? 'half' : (SH.snap === 'half' ? 'full' : 'half'), true); }
  function sheetRefresh() {
    var was = SH.active, main = sheetMain(), panel = $('panel');
    SH.active = !!(SH.mq && SH.mq.matches);
    toggleClass($('panel-head'), 'is-sheet', SH.active);
    if (SH.active) { sheetOnMode(); return; }
    if (was && main && panel) {
      ['--sheet-full', '--sheet-visible', '--sheet-reserve', '--sheet-pad'].forEach(function (p) { main.style.removeProperty(p); });
      panel.removeAttribute('data-snap');
      panel.style.transform = '';
      panel.classList.remove('is-dragging');
      kick();
    }
  }
  function setupSheet() {
    var grip = $('sheet-grip'), panel = $('panel');
    if (!grip || !panel) return;
    var saved = store.get('sheet', {});
    SH.mem = (saved && typeof saved === 'object') ? saved : {};
    SH.mq = root.matchMedia ? root.matchMedia('(max-width: 760px) and (orientation: portrait)') : null;
    if (SH.mq) { if (SH.mq.addEventListener) SH.mq.addEventListener('change', sheetRefresh); else if (SH.mq.addListener) SH.mq.addListener(sheetRefresh); }
    root.addEventListener('resize', function () {
      if (!SH.active || SH.raf) return;
      SH.raf = setTimeout(function () { SH.raf = 0; sheetApply(SH.snap, false); }, 60);
    });
    grip.addEventListener('pointerdown', function (e) {
      if (!SH.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var m = sheetMetrics(), v0 = sheetVisible(SH.snap, m);
      SH.drag = { id: e.pointerId, y0: e.clientY, vis0: v0, vis: v0, m: m, moved: false, pts: [{ y: e.clientY, t: now() }] };
      try { grip.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ }
      panel.classList.add('is-dragging');
    });
    grip.addEventListener('pointermove', function (e) {
      var d = SH.drag;
      if (!d || e.pointerId !== d.id) return;
      var dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dy) > 5) d.moved = true;
      if (!d.moved) return;
      d.vis = clamp(d.vis0 - dy, d.m.peek, d.m.full);
      panel.style.transform = 'translate3d(0,' + (d.m.full - d.vis) + 'px,0)';
      d.pts.push({ y: e.clientY, t: now() });
      if (d.pts.length > 6) d.pts.shift();
      e.preventDefault();
    });
    function end(e, cancel) {
      var d = SH.drag;
      if (!d || (e && e.pointerId !== d.id)) return;
      SH.drag = null;
      panel.classList.remove('is-dragging');
      panel.style.transform = '';
      try { grip.releasePointerCapture(d.id); } catch (x) { /* ya liberado */ }
      if (!d.moved) { if (!cancel) sheetCycle(); return; }
      var a = d.pts[0], b = d.pts[d.pts.length - 1];
      var v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;            // px/ms, negative = going up
      var proj = d.vis - v * 220, best = 'half', bd = Infinity;
      SNAPS.forEach(function (s) { var dd = Math.abs(sheetVisible(s, d.m) - proj); if (dd < bd) { bd = dd; best = s; } });
      sheetApply(best, true);
    }
    grip.addEventListener('pointerup', function (e) { end(e, false); });
    grip.addEventListener('pointercancel', function (e) { end(e, true); });
    grip.addEventListener('keydown', function (e) {
      if (!SH.active) return;
      var i = SNAPS.indexOf(SH.snap);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheetCycle(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sheetApply(SNAPS[Math.min(2, i + 1)], true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sheetApply(SNAPS[Math.max(0, i - 1)], true); }
    });
    sheetRefresh();
  }

  /* ================================================================== progress ring (top bar) + Inicio */
  var PRG = { done: null, off: null };
  function updateRing(sum) {
    var btn = $('btn-progress');
    if (!btn) return;
    var p = sum ? sum.porcentaje : 0;
    var fill = btn.querySelector('.r-fill'), n = btn.querySelector('.ring-btn-n');
    if (fill) fill.setAttribute('stroke-dashoffset', (94.25 * (1 - p / 100)).toFixed(2));
    setText(n, String(p));
    var t = 'Tu avance: ' + p + ' %' + (sum && sum.siguiente ? '. Siguiente: ' + sum.siguiente.titulo : '');
    btn.setAttribute('aria-label', t + '. Ir al inicio');
    btn.title = t;
  }
  function setupProgress() {
    var P = PG();
    if (!P) return;
    safe(importLegacyProgress, 'importLegacy');
    var sum = P.summary();
    PRG.done = {};
    sum.camino.forEach(function (s) { if (s.completa) PRG.done[s.id] = true; });
    updateRing(sum);
    P.onChange(function (ev) {
      var s = ev.summary || P.summary();
      updateRing(s);
      s.camino.forEach(function (st) {                      // celebrate a finished stage once
        if (st.completa && !PRG.done[st.id]) {
          PRG.done[st.id] = true;
          showToast({ text: '¡Etapa completa: ' + st.titulo + '!', kind: 'good' });
        } else if (!st.completa) PRG.done[st.id] = false;
      });
      if (mode === 'inicio' && ev.kind === 'reset') inicioRender();
    });
  }
  function progNow() { var P = PG(); return P ? P.summary() : null; }

  /* Inicio: C150.Home.render(sectionEl, api) when home.js is present (wave U2); until then a small "Tu camino" built with the kit. */
  var INI = { view: null };
  function homeApi() {
    var api = labApi();
    api.go = function (p) { return navOpen(p, { returnLabel: 'Inicio' }); };            // Home cards are ABRIR: Back lands on Inicio
    api.open = api.go; api.look = lookAtControl;
    api.progress = PG(); api.kit = C150.Kit; api.showControl = UI.showControl; api.openLab = UI.openLab;
    api.groups = GROUPS; api.escuela = escuelaOk(); api.sheetEnsure = sheetEnsure;
    return api;
  }
  function inicioRender() {
    var v = INI.view;
    if (!v) return;
    clear(v);
    v.className = '';
    if (C150.Home && isFn(C150.Home.render)) { safe(function () { C150.Home.render(v, homeApi()); }, 'Home.render'); return; }
    var K = C150.Kit, P = PG();
    v.className = 'home-lite';
    v.appendChild(h('div', { class: 'mode-head' },
      h('p', { class: 'mode-kicker' }, h('span', { class: 'mode-kicker-dot', 'aria-hidden': 'true' }), 'Inicio'),
      h('h2', { class: 'placard mode-title', text: 'Tu camino' }),
      h('p', { class: 'mode-sub', text: 'Seis pasos para pasar de no saber nada de aviones a conocer tu cabina, entender cómo vuela y practicar. Seguilos en orden o salteá lo que ya sabés.' })));
    if (!K || !P) { v.appendChild(h('p', { class: 'soft', text: 'Tu avance no está disponible en este momento.' })); return; }
    var sum = P.summary(), next = sum.siguiente, last = P.last();
    var ring = K.progressRing(sum.porcentaje / 100, { size: 84, label: 'avance', ok: sum.porcentaje >= 100 });
    v.appendChild(h('div', { class: 'hl-ring' }, ring, h('div', null,
      h('p', null, h('strong', { text: next ? 'Vas por el ' + sum.porcentaje + ' %' : '¡Terminaste el camino!' })),
      h('p', { class: 'soft small', text: next ? 'Lo que sigue: ' + next.titulo + '.' : 'Ya recorriste todas las etapas. Volvé cuando quieras a repasar.' }),
      next ? K.button({ label: sum.porcentaje ? 'Seguir' : 'Empezar', variant: 'primary', size: 'small', iconRight: 'arrow-right', onClick: function () { navOpen(next.ruta, { returnLabel: 'Inicio' }); sheetEnsure('half'); } }) : null)));
    if (last && !last.hecho) {
      v.appendChild(K.card({
        variant: 'flat', icon: 'play', title: 'Continuar donde dejaste', sub: last.titulo,
        onClick: function () { navOpen(last.ruta, { returnLabel: 'Inicio' }); sheetEnsure('half'); }
      }));
    }
    var ul = h('ul', { class: 'stage-list', 'aria-label': 'Etapas de tu camino' });
    sum.camino.forEach(function (st) {
      var isNext = next && next.id === st.id;
      var started = st.fraccion > 0;
      var li = h('li', { class: 'stage' + (st.completa ? ' is-done' : '') + (isNext ? ' is-next' : '') },
        h('span', { class: 'stage-n', 'aria-hidden': 'true' }, st.completa ? K.icon('check') : String(st.n)),
        h('div', { style: { 'min-width': '0' } },
          h('h3', { class: 'stage-t' }, st.titulo, st.completa ? h('span', { class: 'sr-only', text: ' (completa)' }) : null),
          h('p', { class: 'stage-d', text: st.descripcion }),
          h('div', { class: 'stage-p' }, K.progressBar(st.fraccion, { ok: st.completa, label: st.titulo }),
            h('span', { class: 'count', text: st.hecho + '/' + st.total })),
          K.button({
            label: st.completa ? 'Repasar' : (started ? 'Continuar' : 'Empezar'), size: 'small', variant: isNext ? 'primary' : 'secondary',
            iconRight: 'arrow-right', onClick: function () { navOpen(st.ruta, { returnLabel: 'Inicio' }); sheetEnsure('half'); }
          })));
      ul.appendChild(li);
    });
    v.appendChild(ul);
    v.appendChild(h('p', { class: 'aviso', text: AVISO }));
  }
  modeImpl.inicio = {
    render: function (sec) { INI.view = h('div'); sec.appendChild(INI.view); inicioRender(); },
    enter: function () { inicioRender(); },
    exit: function () { var Hm = C150.Home; if (Hm && isFn(Hm.exit)) safe(function () { Hm.exit(); }, 'Home.exit'); }
  };
  modeImpl.escuela = {
    render: function (sec) {
      var E = C150.Escuela;
      if (E && isFn(E.mount)) safe(function () { E.mount(sec, labApi()); }, 'Escuela.mount');
      else sec.appendChild(h('div', { class: 'mode-head' }, h('h2', { class: 'placard mode-title', text: 'Escuela' }), h('p', { class: 'mode-sub', text: 'Esta parte llega pronto.' })));
    },
    enter: function () { var E = C150.Escuela; if (E && isFn(E.enter)) safe(function () { E.enter(); }, 'Escuela.enter'); },
    exit: function () { var E = C150.Escuela; if (E && isFn(E.exit)) safe(function () { E.exit(); }, 'Escuela.exit'); },
    slow: function (s) { var E = C150.Escuela; if (E && isFn(E.slow)) E.slow(s); }
  };

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
  var layoutMode = 'cabina';            // 'cabina' | 'dos' | 'afuera' (Core.setLayout, contract v3)
  var insetRect = null;
  var labelsOn = false;
  var extraCaption = '';
  var status = {};

  /* ---------------------------------------------------------------- dock (contract v5 §3): VISTA · DISEÑO · ESCENARIO
   * ONE row of glass groups at the bottom of the 3D view, styled like AIRE's toolbars (Kit.dock): the camera presets as segmented
   * buttons, the layout switch and the "Escenario" chip with its popover. On phones it becomes one scrollable row above the sheet. */
  var CAM_DESC = { pilot: 'Tus ojos, en el asiento del piloto', flight: 'Mirar afuera, como en vuelo', panel: 'Todo el tablero de frente',
    left: 'Instrumentos de vuelo', center: 'Motor y radio', right: 'El lado derecho', floor: 'Pedales y combustible', overhead: 'Techo y parabrisas' };
  var CAM_SHORT = { pilot: 'Piloto', flight: 'Horizonte', panel: 'Tablero', left: 'Izq.', center: 'Centro', right: 'Der.', floor: 'Piso', overhead: 'Techo' };
  var currentCam = null;
  var DOCK = { el: null, cams: null, layout: null, scn: null };
  var HUD = { el: null };
  var CH = { bar: null };

  /* ---------------------------------------------------------------- "Escenario": un botón con un popover (en lugar del <select>) */
  var SCN_PLAIN = {
    parked: 'Apagado en la plataforma, con todo frío. Ideal para conocer la cabina y practicar el arranque.',
    runup: 'Motor en marcha, esperando en la cabecera. Para practicar la prueba de motor antes de despegar.',
    runway: 'Alineado en la pista, listo para despegar: acelerador a fondo y a volar.',
    cruise: 'Volando derecho y nivelado a 3000 pies. Si no tocás nada, el avión sigue solo.',
    approach: 'En final, a punto de aterrizar: 65 nudos, flaps abajo y bajando de a poco.'
  };
  function openScenarios(anchor) {
    var K = C150.Kit;
    if (!K || !isFn(K.popover)) return;
    var P = (C150.Sim && C150.Sim.PRESETS) || {};
    var pop = null;
    var list = h('div', { class: 'scn-list', role: 'radiogroup', 'aria-label': 'Escenario' });
    SCENARIOS.forEach(function (sc) {
      var id = sc[0], on = !demoOn && currentPreset === id, spec = P[id] || {};
      list.appendChild(h('button', {
        type: 'button', class: 'scn-opt' + (on ? ' is-on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false',
        onclick: function () { if (pop) pop.close(); if (demoOn) endDemo(); applyPreset(id); }
      },
        h('span', { class: 'scn-dot', 'aria-hidden': 'true' }, on ? kic('check') : null),
        h('span', { class: 'scn-main' },
          h('strong', { text: sc[1] }),
          h('span', { class: 'scn-desc', text: SCN_PLAIN[id] || spec.description || '' }),
          spec.label ? h('span', { class: 'scn-name', text: spec.label }) : null)));
    });
    pop = K.popover(anchor, {
      title: '¿Dónde está el avión?', label: 'Escenario',
      content: [h('p', { class: 'pop-sub', text: demoOn ? 'Ahora hay una demostración en curso. Si elegís un escenario, la demostración termina.' : 'Elegí cómo empezar. Podés cambiarlo cuando quieras: el avión vuelve a ese punto.' }), list]
    });
    pop.el.classList.add('pop--scn');
  }
  function syncScenarioBtn() {
    var v = $('vp-scenario-v'), b = $('vp-scenario-btn');
    if (v) setText(v, demoOn ? 'Demostración en curso' : scenarioName(currentPreset));
    if (b) setAttr(b, 'aria-label', demoOn ? 'Escenario: ahora hay una demostración en curso. Tocá para elegir un escenario y terminarla'
      : 'Escenario: ' + scenarioName(currentPreset) + '. Tocá para cambiarlo');
  }

  /** The bottom dock: VISTA (camera presets) · DISEÑO (Cabina · Las dos · Afuera) · ESCENARIO (chip + popover). */
  function buildDock() {
    var K = C150.Kit, bottom = $('vp-bottom');
    if (!K || !isFn(K.dock) || !bottom) return;
    CH.bar = K.chainBar(); CH.bar.id = 'chain-bar';
    DOCK.cams = K.dockGroup({
      label: 'Vista', aria: 'Vista de la cámara: desde dónde mirar la cabina (teclas 1 a 8)', value: null,
      items: CAMS.map(function (c) { return { value: c[0], label: CAM_SHORT[c[0]] || c[1], title: c[1] + ': ' + (CAM_DESC[c[0]] || ''), aria: 'Mirar desde: ' + c[1], data: { cam: c[0] } }; }),
      onChange: function (id) { cc('focusPreset', id); }
    });
    DOCK.layout = K.dockGroup({
      label: 'Diseño', aria: 'Qué ver en grande: la cabina, las dos vistas o el avión desde afuera', value: layoutMode,
      items: LAYOUT_IDS.map(function (id) {
        return { value: id, label: LAYOUT_NAMES[id], data: { layout: id },
          aria: LAYOUT_NAMES[id] + ': ' + (id === 'dos' ? 'la cabina y el avión de afuera, lado a lado' : (id === 'cabina' ? 'la cabina en grande' : 'el avión desde afuera en grande')),
          title: id === 'dos' ? 'Las dos vistas: la cabina y el avión de afuera, lado a lado' : (id === 'cabina' ? 'La cabina en grande' : 'El avión desde afuera en grande') };
      }),
      onChange: function (id) { chooseLayout(id); }
    });
    var scnBtn = h('button', { type: 'button', id: 'vp-scenario-btn', class: 'seg-btn scn-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
      h('span', { class: 'scn-btn-v', id: 'vp-scenario-v' }), kic('chevron-down'));
    var back = h('button', { type: 'button', id: 'vp-scenario-back', class: 'seg-btn scn-back', 'aria-label': 'Volver al escenario', hidden: true },
      h('span', { class: 'vsb-long', text: 'Volver al escenario' }), h('span', { class: 'vsb-short', text: 'Volver' }));
    DOCK.scn = h('div', { id: 'vp-scenario', class: 'dock-group dock-group--scn', role: 'group', 'aria-label': 'Escenario: dónde y cómo está el avión' },
      h('span', { class: 'dock-label', text: 'Escenario' }), scnBtn, back);
    scnBtn.addEventListener('click', function () {
      if (scnBtn.getAttribute('aria-expanded') === 'true') { K.closePopover(); return; }
      openScenarios(scnBtn);
    });
    back.addEventListener('click', function () { endDemo(); });
    DOCK.el = K.dock([DOCK.cams, DOCK.layout, DOCK.scn], { label: 'Vista de la cámara, diseño y escenario' });
    DOCK.el.id = 'dock';
    bottom.appendChild(CH.bar);
    bottom.appendChild(DOCK.el);
    syncScenarioBtn();
    syncLayoutSwitch();
  }

  /** The glass HUD (top-left): big MOTOR · VELOCIDAD · ALTURA, one mono line, a status pill and tab-specific extras. */
  function infoToggle(key) {
    return function (e) {
      var el = e.currentTarget, K = C150.Kit;
      if (el.getAttribute('aria-expanded') === 'true') { if (K) K.closePopover(); return; }
      openStatusInfo(key, el);
    };
  }
  function buildStageHud() {
    var K = C150.Kit, stage = $('vp-stage');
    if (!K || !isFn(K.hud) || !stage) return;
    HUD.el = K.hud({
      label: 'Estado del avión: tocá cada dato para saber qué significa', kicker: 'Cabina',
      bigs: [
        { label: 'Motor', unit: 'rpm', title: 'Motor: tocá para saber qué es', onClick: infoToggle('engine') },
        { label: 'Velocidad', unit: 'nudos', title: 'Velocidad (IAS): tocá para saber qué es', onClick: infoToggle('ias') },
        { label: 'Altura', unit: 'pies', title: 'Altura: tocá para saber qué es', onClick: infoToggle('alt') }
      ]
    });
    HUD.el.id = 'hud';
    stage.insertBefore(HUD.el, stage.firstChild);
    if (root.ResizeObserver) new ResizeObserver(function () { if (layoutMode === 'dos') positionPaneLabels(); }).observe(HUD.el);
  }

  function setupViewport() {
    syncScenarioBtn();
    // inset buttons
    $('inset-swap').addEventListener('click', function () {
      cc('setMainView', mainView === 'exterior' ? 'cockpit' : 'exterior');
      syncMainView();
    });
    $('inset-labels').addEventListener('click', function () {
      labelsOn = !labelsOn;
      setExteriorLabels(labelsOn);
      syncLabelsBtns();
    });

    safe(buildStageHud, 'hud');
    safe(buildDock, 'dock');
    safe(buildPaneLabels, 'pane labels');
    safe(buildCallout, 'callout');

    var vp = $('viewport');
    function place() { positionInset(); positionPaneLabels(); if (DOCK.el && DOCK.el.refresh) DOCK.el.refresh(); }
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
    // VOLAR with "Mostrar el aire": only the calm air explanations (the generic surfaces line would change all the time)
    if (mode === 'volar' && coreReady && voAirOn() && c && isFn(c.getAirPeek)) {
      var pk = safe(function () { return c.getAirPeek(); });
      return pk && typeof pk.caption === 'string' ? pk.caption : '';
    }
    if (c && isFn(c.getCaption)) { var t = safe(function () { return c.getCaption(); }); if (typeof t === 'string') return t; }
    var ext = c && (c.exterior || c.ext);
    if (ext && typeof ext.caption === 'string') return ext.caption;
    return extraCaption || '';
  }

  /** True while the cockpit is mirroring an exterior movement (lesson animation or held pose, contract v3). */
  function mirroring() {
    if (LB && LB.open && !LB.finished && mode === 'basico') return true;
    var a = cc('getAnimState');
    return !!(a && a.active);
  }
  function cockpitLabel() { return mirroring() ? 'Así se ve desde adentro' : 'Cabina'; }

  function syncMainView() {
    var v = cc('getMainView');
    if (v === 'cockpit' || v === 'exterior') mainView = v;
    if (has('getLayout')) { var lm = cc('getLayout'); if (LAYOUT_IDS.indexOf(lm) >= 0) layoutMode = lm; }
    else if (layoutMode !== 'dos') layoutMode = mainView === 'exterior' ? 'afuera' : 'cabina';
    var ext = mainView === 'exterior';
    setText($('inset-label'), ext ? cockpitLabel() : 'Así se ve desde afuera');
    setAttr($('inset-swap'), 'aria-label', ext ? 'Volver a la cabina en grande' : 'Agrandar la vista de afuera');
    syncLayoutSwitch();
    positionPaneLabels();
    positionCaption();
  }

  /* ---------------------------------------------------------------- layout: Cabina · Las dos · Afuera (contract v3) */
  var LAYOUT_IDS = ['cabina', 'dos', 'afuera'];
  var LAYOUT_NAMES = { cabina: 'Cabina', dos: 'Las dos', afuera: 'Afuera' };
  var userLayout = (function () { var l = store.get('layout', 'cabina'); return LAYOUT_IDS.indexOf(l) >= 0 ? l : 'cabina'; })();
  var paneRects = null;                 // { cockpit:{x,y,w,h}, exterior:{x,y,w,h} } in 'dos'
  var dosShrinkPending = false;
  function canDos() { return has('setLayout') && dosFits(); }
  /** 'Las dos' needs room: two halves of at least ~300 px (side by side) or ~250 px tall (stacked). On a phone the
   *  halves would be tiny and buried under the overlays, so there the cockpit + inset layout is used instead. */
  function dosSideBySide() { var vp = $('viewport'); return !vp || vp.clientWidth >= vp.clientHeight; }
  function dosFits() {
    var vp = $('viewport'), W = vp ? vp.clientWidth : 0, H = vp ? vp.clientHeight : 0;
    if (!W || !H) return true;          // not laid out yet: decide later
    return W >= H ? (W / 2 >= 300 && H >= 300) : (H / 2 >= 250 && W >= 300);
  }
  /** Applies a layout; Core.setLayout when present, else the classic main view + inset ('dos' falls back to 'cabina'). */
  function applyLayout(name) {
    if (LAYOUT_IDS.indexOf(name) < 0) name = 'cabina';
    if (name === 'dos' && !dosFits()) name = 'cabina';
    if (has('setLayout')) {
      cc('setLayout', name);
      var got = cc('getLayout');
      layoutMode = LAYOUT_IDS.indexOf(got) >= 0 ? got : name;
    } else {
      if (name === 'dos') name = 'cabina';
      cc('setMainView', name === 'afuera' ? 'exterior' : 'cockpit');
      layoutMode = name;
    }
    if (layoutMode !== 'dos') paneRects = null;
    syncMainView();
    var r = cc('getInsetRect');
    onLayout(r || null);
    kick();
  }
  /** The student picked a layout in the toolbar: apply it and remember it (this browser). */
  function chooseLayout(name) {
    userLayout = name;
    store.set('layout', name);
    LB.layoutForced = false;            // a choice during a lesson wins over the lesson's 'dos'
    LB.userChose = LB.open && mode === 'basico';
    applyLayout(name);
  }
  function syncLayoutSwitch() {
    if (!DOCK.layout) return;
    DOCK.layout.setValue(layoutMode, false);
    var b = DOCK.layout.btn('dos');
    if (b) b.hidden = coreReady && !canDos() && layoutMode !== 'dos';
  }

  /* pane labels for 'dos': "Así se ve desde adentro" / "Cabina" over the cockpit, "Afuera" over the exterior */
  var paneEls = null;
  function buildPaneLabels() {
    var vp = $('viewport');
    if (!vp) return;
    var labelsBtn = h('button', { type: 'button', class: 'inset-btn', 'aria-pressed': 'false', title: 'Mostrar los nombres de las partes',
      onclick: function () { labelsOn = !labelsOn; setExteriorLabels(labelsOn); syncLabelsBtns(); } }, 'Ver etiquetas');
    paneEls = {
      cockpit: h('div', { class: 'pane-label pane-label--cockpit', hidden: true }, h('span', { class: 'pane-label-text' })),
      exterior: h('div', { class: 'pane-label pane-label--exterior', hidden: true }, h('span', { class: 'pane-label-text', text: 'Así se ve desde afuera' }), labelsBtn),
      labelsBtn: labelsBtn
    };
    vp.appendChild(paneEls.cockpit);
    vp.appendChild(paneEls.exterior);
  }
  function syncLabelsBtns() {
    setAttr($('inset-labels'), 'aria-pressed', labelsOn ? 'true' : 'false');
    if (paneEls) setAttr(paneEls.labelsBtn, 'aria-pressed', labelsOn ? 'true' : 'false');
  }
  /** Pane rectangles in 'dos': from Core's 'layout' event when it gives them, else halves of the viewport. */
  function dosRects() {
    if (paneRects && paneRects.cockpit && paneRects.exterior) return paneRects;
    var vp = $('viewport');
    var W = vp ? vp.clientWidth : 0, H = vp ? vp.clientHeight : 0;
    if (W >= H) return { cockpit: { x: 0, y: 0, w: W / 2, h: H }, exterior: { x: W / 2, y: 0, w: W / 2, h: H } };
    return { cockpit: { x: 0, y: 0, w: W, h: H / 2 }, exterior: { x: 0, y: H / 2, w: W, h: H / 2 } };
  }
  function positionPaneLabels() {
    if (!paneEls) return;
    var on = layoutMode === 'dos';
    var app = $('app');
    if (app) toggleClass(app, 'is-dos', on);
    paneEls.cockpit.hidden = !on;
    paneEls.exterior.hidden = !on;
    if (!on) { if (app) toggleClass(app, 'is-dos-side', false); return; }
    var R = dosRects();
    var side = R.exterior.x > R.cockpit.x + 1;      // side by side (else stacked)
    if (app) toggleClass(app, 'is-dos-side', side);
    ['cockpit', 'exterior'].forEach(function (k) {
      var el = paneEls[k], r = R[k];
      el.style.left = Math.round(r.x + 10) + 'px';
      el.style.top = Math.round(r.y + 10) + 'px';
      el.style.maxWidth = Math.max(80, Math.round(r.w - 20)) + 'px';
    });
    // the HUD sits top-left: a pane label it would cover goes below it
    var hudEl = HUD.el, vp = $('viewport');
    if (hudEl && vp && !hudEl.hidden && hudEl.offsetHeight) {
      var vb = vp.getBoundingClientRect(), hr = hudEl.getBoundingClientRect();
      var right = hr.right - vb.left, bottom = hr.bottom - vb.top;
      ['cockpit', 'exterior'].forEach(function (k) {
        var r = R[k];
        if (r.x + 10 < right && r.y + 10 < bottom) paneEls[k].style.top = Math.round(bottom + 8) + 'px';
      });
    }
    setText(paneEls.cockpit.querySelector('.pane-label-text'), cockpitLabel());
  }

  function onLayout(r) {
    if (r && typeof r.mode === 'string' && LAYOUT_IDS.indexOf(r.mode) >= 0) {
      layoutMode = r.mode;
      paneRects = (r.mode === 'dos' && r.rects) ? r.rects : null;
      var ins = r.rects && r.rects.inset ? r.rects.inset : (r.inset || null);
      if (r.mode === 'dos') r = null;
      else if (ins) r = ins;
    }
    insetRect = (r && num(r.w, 0) > 0) ? { x: num(r.x, 0), y: num(r.y, 0), w: r.w, h: num(r.h, 0) } : null;
    // the view got too small for 'Las dos' (phone rotated, window narrowed): back to the cockpit + inset
    if (layoutMode === 'dos' && !dosFits() && !dosShrinkPending) {
      dosShrinkPending = true;
      setTimeout(function () { dosShrinkPending = false; if (layoutMode === 'dos' && !dosFits()) applyLayout('cabina'); }, 0);
    }
    syncLayoutSwitch();
    positionPaneLabels();
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
  /** The subtitle box is gone (contract v5): what it said now travels in the chain bar over the dock (chainContent). */
  function capBottom() { return 62; }
  function positionCaption() {
    var cap = $('inset-caption');
    if (cap && !cap.hidden) cap.hidden = true;
  }
  function updateCaption() {
    var t = getCaption();
    if (t !== captionText) { captionText = t; setText($('inset-caption'), t); positionCaption(); }
    updateAirLive();
  }
  /** Phones in Volar with the flight pad over the 3D view and the sheet open: the air explanation is shown in the panel
   *  (card "Mostrar el aire"), because over the 3D view it would cover the status chips, the inset and the pad. */
  function airInPanel() {
    if (mode !== 'volar' || !flypadShown() || !voAirOn()) return false;
    var pn = $('panel');
    return !!pn && pn.getAttribute('data-snap') !== 'peek';
  }
  function updateAirLive() {
    var el = $('panel-live');
    if (!el) return;
    var on = airInPanel() && !!captionText;
    if (on) setText(el, captionText);
    if (el.hidden === on) el.hidden = !on;
  }

  /* ---------------------------------------------------------------- 3D callouts (contract v3)
   * The hovered control (or, without hover, the selected one) gets a label anchored to it in the 3D view with a leader
   * line: name, English name and the one-line "resumen". Anchor = Core.projectControl(id) (css px in the viewport). */
  var CO = { hoverId: null, hoverSub: null, selId: null, key: '', svg: null, line: null, ring: null, box: null, bw: 0, bh: 0, raf: 0, shown: false };
  function buildCallout() {
    var vp = $('viewport');
    if (!vp) return;
    var svg = doc.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'callout3d-svg');
    svg.setAttribute('aria-hidden', 'true');
    var line = doc.createElementNS(SVGNS, 'line');
    var ring = doc.createElementNS(SVGNS, 'circle');
    ring.setAttribute('r', '5');
    svg.appendChild(line); svg.appendChild(ring);
    CO.svg = svg; CO.line = line; CO.ring = ring;
    CO.box = h('div', { class: 'callout3d', 'aria-hidden': 'true' },
      h('span', { class: 'callout3d-name' }), h('span', { class: 'callout3d-en' }), h('span', { class: 'callout3d-sum' }),
      h('span', { class: 'callout3d-hint', text: 'Tocá para conocerlo' }));
    svg.style.display = 'none'; CO.box.style.display = 'none';
    vp.appendChild(svg); vp.appendChild(CO.box);
  }
  function hideCallout() {
    if (!CO.shown) return;
    CO.shown = false;
    CO.svg.style.display = 'none'; CO.box.style.display = 'none';
  }
  function calloutLoop() {
    CO.raf = 0;
    if (!CO.shown) return;
    updateCallout();
    if (CO.shown && root.requestAnimationFrame) CO.raf = root.requestAnimationFrame(calloutLoop);
  }
  function updateCallout() {
    if (!CO.box) return;
    // hover anywhere; the selection only where it means "this one" (fichas, recorrido, checklists, lecciones)
    var selOk = mode === 'explorar' || mode === 'recorrido' || mode === 'checklists' || mode === 'basico';
    var id = CO.hoverId || (selOk ? CO.selId : null), sub = CO.hoverId ? CO.hoverSub : null;
    var c = id && CTRL[id];
    var cockpitShown = layoutMode === 'dos' || mainView === 'cockpit';
    if (!c || !coreReady || !has('projectControl') || !cockpitShown || mode === 'aire') { hideCallout(); return; }
    var p = cc('projectControl', id);
    if (!p || !p.visible || !isFinite(p.x) || !isFinite(p.y)) { hideCallout(); return; }
    var key = id + '|' + (sub || '');
    var hov = !!CO.hoverId && CO.hoverId !== CO.selId;          // hovering something that is not the open card: invite to tap
    if (key !== CO.key || hov !== CO.hov) {
      CO.hov = hov;
      toggleClass(CO.box, 'is-hover', hov);
      CO.key = key;
      var lb = ctrlLabel(c, sub);
      setText(CO.box.querySelector('.callout3d-name'), lb.name);
      setText(CO.box.querySelector('.callout3d-en'), lb.en);
      setText(CO.box.querySelector('.callout3d-sum'), c.resumen || '');
      CO.box.style.setProperty('--cat', catColor(c));
      CO.box.style.display = ''; CO.box.style.visibility = 'hidden';
      CO.bw = CO.box.offsetWidth; CO.bh = CO.box.offsetHeight;
      CO.box.style.visibility = '';
    }
    var vp = $('viewport');
    var area = layoutMode === 'dos' ? dosRects().cockpit : { x: 0, y: 0, w: vp.clientWidth, h: vp.clientHeight };
    var x = p.x, y = p.y, bw = CO.bw, bh = CO.bh, gap = 40;
    // keep clear of the HUD (top-left) and of the chain bar + dock (bottom): measured, they change height with the tab
    var vr0 = vp.getBoundingClientRect(), hudBottom = 0, hudRight = 0, botTop = area.y + area.h;
    if (HUD.el && !HUD.el.hidden && HUD.el.offsetHeight) { var hr0 = HUD.el.getBoundingClientRect(); hudBottom = hr0.bottom - vr0.top; hudRight = hr0.right - vr0.left; }
    var vb0 = $('vp-bottom');
    if (vb0 && vb0.offsetHeight) botTop = Math.min(botTop, vp.clientHeight - vb0.offsetHeight);
    var bx = x + gap, by = y - bh - gap * 0.7;
    if (bx + bw > area.x + area.w - 8) bx = x - gap - bw;
    if (by < area.y + 12 || (by < hudBottom + 6 && bx < hudRight + 6)) by = y + gap * 0.7;
    bx = Math.max(area.x + 8, Math.min(area.x + area.w - bw - 8, bx));
    by = Math.max(area.y + 8, Math.min(botTop - bh - 8, by));
    if (by < hudBottom + 6 && bx < hudRight + 6) bx = Math.min(area.x + area.w - bw - 8, hudRight + 10);
    var tx = Math.max(bx, Math.min(bx + bw, x)), ty = Math.max(by, Math.min(by + bh, y));
    CO.box.style.transform = 'translate(' + Math.round(bx) + 'px,' + Math.round(by) + 'px)';
    CO.line.setAttribute('x1', x.toFixed(1)); CO.line.setAttribute('y1', y.toFixed(1));
    CO.line.setAttribute('x2', tx.toFixed(1)); CO.line.setAttribute('y2', ty.toFixed(1));
    CO.ring.setAttribute('cx', x.toFixed(1)); CO.ring.setAttribute('cy', y.toFixed(1));
    if (!CO.shown) {
      CO.shown = true;
      CO.svg.style.display = ''; CO.box.style.display = '';
      if (!CO.raf && root.requestAnimationFrame) CO.raf = root.requestAnimationFrame(calloutLoop);
    }
  }
  function ctrlLabel(c, sub) {
    var name = c.nombre, en = c.ingles || '';
    if (sub) {
      var si = arr(c.subitems).filter(function (x) { return x && x.subId === sub; })[0];
      if (si) { name = si.nombre || (c.nombre + ' ' + sub); en = si.ingles || en; }
      else if (SUB_NAMES[sub]) name = c.nombre + ' (' + SUB_NAMES[sub] + ')';
    }
    return { name: name, en: en };
  }
  function onHover(id, sub) {
    var c = id && CTRL[id];
    CO.hoverId = c ? id : null; CO.hoverSub = c ? (sub || null) : null;
    updateCallout();
  }

  /* ---------------------------------------------------------------- demonstrations vs the "Escenario" selector
   * While an exterior animation or a held pose is mirrored into the cockpit (Core.isMirroring), the airplane is NOT in
   * the selected scenario: the selector says "Demostración en curso" (a disabled option), a "Volver al escenario" button
   * ends the demonstration (the core then gives the scenario's airplane back), the status chips show the demonstration
   * airplane with a "Demostración" chip first. Picking another scenario ends the demonstration and applies it. */
  var demoOn = false;
  function demoActive() {
    if (!coreReady) return false;
    if (has('isMirroring')) return !!cc('isMirroring');
    var a = cc('getAnimState');
    return !!(a && a.active);
  }
  function scenarioName(id) {
    for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i][0] === id) return SCENARIOS[i][1];
    return id || '';
  }
  function demoLabel() {
    var c = Core(), ext = c && (c.exterior || c.ext), id = ext && ext.posing;
    if (id) {
      var P = arr(cc('getPoses'));
      for (var i = 0; i < P.length; i++) if (P[i] && P[i].id === id && P[i].etiqueta) return 'Demostración: ' + P[i].etiqueta;
    }
    return 'Demostración en curso';
  }
  function syncDemo() {
    var on = demoActive();
    var back = $('vp-scenario-back'), box = $('vp-scenario') || doc.querySelector('.vp-scenario');
    if (back) setAttr(back, 'title', 'Termina la demostración y vuelve al escenario: ' + scenarioName(currentPreset));
    if (on === demoOn) return;
    demoOn = on;
    if (back) back.hidden = !on;
    if (box) toggleClass(box, 'is-demo', on);
    toggleClass($('app'), 'is-demonstrating', on);
    syncScenarioBtn();
    positionPaneLabels();
    positionCaption();
  }
  /** Ends the demonstration (pose / animation) wherever it came from; a lesson step keeps its buttons in sync. */
  function endDemo() {
    var inLesson = mode === 'basico' && LB.open;
    if (inLesson) { LB.pose = null; LB.auto = false; LB.poseCaption = ''; }
    clearExteriorPose();
    cc('playExterior', null);
    if (inLesson) { lbSyncActions(); var p = lbStep(); if (p) lbAir(p); }
    syncMainView();
    kick();
  }

  /* ---------------------------------------------------------------- status strip: plain words, an icon and a popover each
   * Motor · Corriente (master) · En tierra / En vuelo · Velocidad · Altura. Each chip is a button: it opens a short explanation
   * of the term (and "Ver en 3D" when there is a control behind it). Updates only touch the DOM when the text changes. */
  var STATUS_INFO = {
    engine: function (s) {
      var e = s.engine || {};
      return {
        title: 'Motor',
        paras: [
          e.running ? 'El motor está en marcha a ' + Math.round(num(e.rpm, 0) / 10) * 10 + ' RPM. Es lo que mueve la hélice y da la fuerza para rodar y volar.'
            : (e.cranking ? 'El motor de arranque está girando la hélice para que el motor prenda. Se suelta la llave apenas arranca.'
              : 'El motor está apagado: la hélice está quieta. Para arrancarlo hay una checklist paso a paso en Practicar.'),
          'RPM son las vueltas por minuto de la hélice. En crucero, el Cessna 150 anda a unas 2400.'],
        go: e.running ? ['tachometer', 'Ver el tacómetro en 3D'] : ['ignition', 'Ver la llave de arranque en 3D']
      };
    },
    master: function (s) {
      return {
        title: 'Corriente (master)',
        paras: [
          s.masterBat ? (s.masterAlt ? 'La corriente eléctrica está encendida: andan la radio, las luces y los instrumentos eléctricos.'
            : 'Sólo está la batería: el alternador, que recarga la batería en vuelo, está apagado.')
            : 'La corriente está apagada: no anda nada eléctrico (radio, luces, indicadores).',
          'El «master» es el interruptor general. Tiene dos mitades: BAT (la batería) y ALT (el alternador). El motor no necesita electricidad para andar: tiene su propio encendido.'],
        go: ['master', 'Ver el master en 3D']
      };
    },
    ground: function (s) {
      var a = s.air || {};
      return {
        title: a.onGround === false ? 'En vuelo' : 'En tierra',
        paras: [a.onGround === false ? 'El avión está en el aire: las ruedas no tocan el suelo y lo sostienen las alas. Ahora mandan el volante y la velocidad.'
          : 'El avión está apoyado en el suelo. Rueda con las ruedas, se frena con los pedales y se dirige con los pedales y la rueda de nariz.',
        'Para ver la actitud del avión mirá la vista de afuera.'],
        extra: ['Ver el avión desde afuera', function () { chooseLayout(canDos() ? 'dos' : 'afuera'); }]
      };
    },
    ias: function () {
      return {
        title: 'Velocidad (IAS)',
        paras: ['Con qué velocidad pasa el aire por el avión, en nudos (1 nudo son unos 1,85 km/h). Es lo que marca el velocímetro.',
          'IAS quiere decir velocidad indicada. El Cessna 150 despega a unos 50 nudos y vuela de crucero a unos 100.'],
        go: ['asi', 'Ver el velocímetro en 3D']
      };
    },
    alt: function () {
      return {
        title: 'Altura',
        paras: ['A qué altura sobre el nivel del mar está el avión, en pies (1 pie son unos 30 cm). La marca el altímetro.',
          'Parado en la pista marca la altura del aeródromo (unos 100 pies). Al subir, el número crece.'],
        go: ['altimeter', 'Ver el altímetro en 3D']
      };
    }
  };
  /** MIRAR: the camera goes to a control and the tab never changes; "Volver a la vista anterior" (chip over the dock) brings the view back. */
  function lookAtControl(id) {
    if (!CTRL[id]) return;
    navLook(function () {
      if (mainView === 'exterior' && layoutMode !== 'dos') { cc('setMainView', 'cockpit'); syncMainView(); }
      focusControl(id, true);
    }, ctrlName(id));
  }
  function lookAt3D(id) { lookAtControl(id); }
  function openStatusInfo(key, anchor) {
    var K = C150.Kit, s = S();
    if (!K || !isFn(K.popover) || !s || !STATUS_INFO[key]) return;
    var info = STATUS_INFO[key](s), pop = null, body = [];
    info.paras.forEach(function (t) { body.push(h('p', { text: t })); });
    var acts = [];
    if (info.go && CTRL[info.go[0]]) acts.push(K.button({ label: info.go[1], icon: 'target', size: 'small', variant: 'primary', onClick: function () { if (pop) pop.close(); lookAt3D(info.go[0]); } }));
    if (info.extra) acts.push(K.button({ label: info.extra[0], icon: 'plane', size: 'small', onClick: function () { if (pop) pop.close(); navLook(info.extra[1], 'el avión'); } }));
    if (acts.length) body.push(h('div', { class: 'pop-actions' }, acts));
    pop = K.popover(anchor, { title: info.title, content: body, label: info.title });
  }

  /* ---------------------------------------------------------------- the HUD (top-left of the 3D view), plain words
   * MOTOR · VELOCIDAD · ALTURA as big numbers (each one opens a short explanation, with "Ver en 3D"), a mono line (Corriente (master) ·
   * flaps · en tierra / en vuelo) and a pill with a dot; below, what the tab is about: the control picked in Cabina, the lesson step
   * and its live numbers, the checklist or mission progress. Updates only touch the DOM when the text changes. */
  var HUD_KICK = { inicio: 'Cabina', explorar: 'Cabina', recorrido: 'Recorrido guiado', basico: 'Lecciones', checklists: 'Checklists',
    volar: 'Misiones', quiz: 'Quiz', escuela: 'Escuela', aire: 'Aire' };
  /** Live value of a cockpit control, in plain words ('' when it only makes sense to look at it). */
  function ctrlLiveValue(id, s) {
    var a = s.air || {}, e = s.engine || {};
    switch (id) {
      case 'throttle': return pct(s.throttle) + ' · ' + (e.running ? Math.round(num(e.rpm, 0) / 10) * 10 + ' rpm' : 'motor apagado');
      case 'mixture': return s.mixture < 0.04 ? 'Corte (idle cut-off)' : (s.mixture > 0.96 ? 'Rica (full rich)' : pct(s.mixture) + ' (empobrecida)');
      case 'carb-heat': return s.carbHeat < 0.04 ? 'Fría (cold)' : (s.carbHeat > 0.96 ? 'Caliente (hot)' : pct(s.carbHeat));
      case 'trim-wheel': return Math.abs(num(s.trim, 0)) < 0.04 ? 'Despegue (take off)' : fmtSigned(num(s.trim, 0), 2) + (s.trim > 0 ? ' · nariz arriba' : ' · nariz abajo');
      case 'flap-switch': case 'flap-indicator': return Math.round(num(s.flaps, 0)) + '° de flaps';
      case 'ignition': return 'Llave en ' + s.ignition;
      case 'master': return 'Batería ' + (s.masterBat ? 'ON' : 'OFF') + ' · alternador ' + (s.masterAlt ? 'ON' : 'OFF');
      case 'fuel-shutoff': return s.fuelValve ? 'Abierta (ON)' : 'Cerrada (OFF)';
      case 'parking-brake': return s.parkingBrake ? 'Puesto' : 'Suelto';
      case 'control-lock': return s.controlLock ? 'Puesta' : 'Sacada';
      case 'cabin-heat': return s.cabinHeat < 0.04 ? 'Cerrada' : 'Abierta ' + pct(s.cabinHeat);
      case 'cabin-air': return s.cabinAir < 0.04 ? 'Cerrada' : 'Abierta ' + pct(s.cabinAir);
      case 'tachometer': return Math.round(num(e.rpm, 0) / 10) * 10 + ' rpm';
      case 'asi': return Math.round(Math.max(0, num(a.ias, 0))) + ' nudos';
      case 'altimeter': return Math.round(num(a.indicatedAlt, num(a.altitude, 0)) / 10) * 10 + ' pies';
      case 'vsi': return fmtSigned(Math.round(num(a.vs, 0) / 10) * 10, 0) + ' pies/min';
      case 'heading-indicator': case 'compass': return heading3(a.heading) + '°';
      case 'attitude': case 'yoke': return 'Alabeo ' + Math.round(num(a.bank, 0)) + '° · cabeceo ' + Math.round(num(a.pitch, 0)) + '°';
      case 'rudder-pedals': return 'Pedal ' + (s.rudder < -0.04 ? 'izquierdo' : (s.rudder > 0.04 ? 'derecho' : 'al medio'));
      case 'toe-brakes': return (s.brakeL > 0.1 || s.brakeR > 0.1) ? 'Frenando' : 'Sin frenar';
      default: return '';
    }
  }
  /** The two live numbers each lesson is about (alabeo, cabeceo, flaps…). */
  var LESSON_NUMS = { 'tres-ejes': ['bank', 'pitch'], coordinacion: ['bank', 'slip'], 'cuatro-fuerzas': ['pitch', 'ias'], 'ala-angulo-ataque': ['aoa', 'ias'],
    perdida: ['aoa', 'ias'], flaps: ['flaps', 'ias'], compensador: ['trim', 'pitch'], motor: ['rpm', 'thr'], instrumentos: ['ias', 'alt'],
    'actitud-potencia': ['pitch', 'rpm'], 'en-tierra': ['gs', 'ias'], 'primera-clase': ['ias', 'rpm'] };
  function numCell(kind, s) {
    var a = s.air || {}, e = s.engine || {}, b, p;
    switch (kind) {
      case 'bank': b = num(a.bank, 0); return { v: Math.abs(Math.round(b)), u: b > 1.5 ? '° der.' : (b < -1.5 ? '° izq.' : '°'), l: 'Alabeo' };
      case 'pitch': p = num(a.pitch, 0); return { v: Math.abs(Math.round(p)), u: p > 1.5 ? '° arriba' : (p < -1.5 ? '° abajo' : '°'), l: 'Cabeceo' };
      case 'slip': return { v: Math.round(Math.abs(num(a.slip, 0)) * 100), u: '% ' + (num(a.slip, 0) > 0.05 ? 'der.' : (num(a.slip, 0) < -0.05 ? 'izq.' : '')), l: 'Bolita' };
      case 'aoa': return { v: fmt(num(a.aoa, 0), 1), u: '°', l: 'Ángulo de ataque' };
      case 'ias': return { v: Math.round(Math.max(0, num(a.ias, 0))), u: 'nudos', l: 'Velocidad' };
      case 'gs': return { v: Math.round(num(a.groundSpeed, 0)), u: 'nudos', l: 'En tierra' };
      case 'alt': return { v: Math.round(num(a.indicatedAlt, num(a.altitude, 0)) / 10) * 10, u: 'pies', l: 'Altura' };
      case 'flaps': return { v: Math.round(num(s.flaps, 0)), u: '°', l: 'Flaps' };
      case 'trim': return { v: fmtSigned(num(s.trim, 0), 2), u: '', l: 'Compensador' };
      case 'rpm': return { v: Math.round(num(e.rpm, 0) / 10) * 10, u: 'rpm', l: 'Motor' };
      case 'thr': return { v: Math.round(clamp(num(s.throttle, 0), 0, 1) * 100), u: '%', l: 'Acelerador' };
      default: return { v: '', u: '', l: '' };
    }
  }
  function hudExtra(s) {
    var c, id;
    switch (mode) {
      case 'explorar': case 'recorrido':
        id = mode === 'explorar' ? (EX.id || CO.selId) : ((!TR.finished && TOUR[TR.i] && TOUR[TR.i].control) || CO.selId);
        c = id && CTRL[id];
        return c ? { k: mode === 'explorar' ? 'Elegiste' : 'Mirá este control', t: c.nombre, v: ctrlLiveValue(id, s) } : null;
      case 'basico': {
        if (!LB.open || LB.finished) return null;
        var L = LESSONS[LB.idx], n = arr(L && L.pasos).length, kinds = LESSON_NUMS[L && L.id] || ['bank', 'pitch'];
        return { k: 'Lección ' + (LB.idx + 1) + ' · paso ' + (LB.i + 1) + ' de ' + n, t: '', nums: kinds.map(function (kd) { return numCell(kd, s); }) };
      }
      case 'checklists': {
        var cur = CL.cur;
        if (!cur || cur.finished) return null;
        var items = arr(cur.cl.items), dn = 0;
        for (var i = 0; i < cur.done.length; i++) if (cur.done[i]) dn++;
        return { k: 'Checklist', t: cur.cl.titulo || '', v: dn + ' de ' + items.length + ' pasos', bar: items.length ? dn / items.length : 0 };
      }
      case 'volar':
        if (!VO.m) return null;
        return { k: VO.achieved ? 'Misión cumplida' : 'Misión', t: VO.m.titulo || '', v: Math.round(VO.progress * 100) + ' % del objetivo', bar: VO.progress };
      default: return null;
    }
  }
  function updateHud(s) {
    if (!s) return;
    syncDemo();
    if (!HUD.el) return;
    var e = s.engine || {}, a = s.air || {};
    var rpm = Math.round(num(e.rpm, 0) / 10) * 10;
    var ias = Math.round(Math.max(0, num(a.ias, 0)));
    var alt = Math.round(num(a.indicatedAlt, num(a.altitude, 0)) / 10) * 10;
    var stalled = !!a.stallWarning && !s.paused;
    var air = a.onGround === false;
    var pill;
    if (demoOn) pill = { text: demoLabel(), tone: 'is-demo' };
    else if (s.paused) pill = { text: 'En pausa', tone: 'is-pause' };
    else if (stalled) pill = { text: 'Bocina de pérdida', tone: 'is-stall' };
    else if (air) pill = { text: 'En vuelo', tone: 'is-air' };
    else if (e.running) pill = { text: 'Motor en marcha', tone: 'is-ok' };
    else if (e.cranking) pill = { text: 'Arrancando el motor…', tone: 'is-horn' };
    else pill = { text: 'Motor apagado', tone: '' };
    HUD.el.set({
      kicker: (HUD_KICK[mode] || 'Cabina') + (mode === 'recorrido' && !TR.finished && TOUR.length ? ' ' + (TR.i + 1) + '/' + TOUR.length : '') + (demoOn ? '' : ' · ' + scenarioName(currentPreset)),
      live: !s.paused,
      bigs: [{ v: rpm, u: 'rpm', l: 'Motor', dim: !e.running && !e.cranking }, { v: ias, u: 'nudos', l: 'Velocidad', warn: stalled }, { v: alt, u: 'pies', l: 'Altura' }],
      row: [
        { text: 'Corriente (master) ' + (s.masterBat ? (s.masterAlt ? 'encendida' : 'sólo batería') : 'apagada'), onClick: infoToggle('master'), title: 'Corriente (master): tocá para saber qué es' },
        { text: 'Flaps ' + Math.round(num(s.flaps, 0)) + '°' },
        { text: air ? 'En vuelo' : 'En tierra', onClick: infoToggle('ground'), title: 'En tierra o en vuelo: tocá para saber qué significa' }
      ],
      pill: pill,
      extra: hudExtra(s)
    });
  }

  /* ---------------------------------------------------------------- the chain bar (over the dock): cause → effect, 3 chips at most
   * Cabina: [control] → [what it does] → [what it moves]; Recorrido and Lecciones: [step] → [what is happening]; checklists:
   * [item] → [why it matters]; missions: [goal] → [hint]. With nothing contextual, the instructor's tip (coach) takes its place. */
  /** A short one-line version of a sentence: cut at the first clause, then at a word boundary. */
  function shortText(t, max, clause) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (clause) {
      var m = t.search(/[;:]|\s[—–]\s|\.\s|\.$/);
      if (m > 14) t = t.slice(0, m);
      if (t.length > max) { var cm = t.lastIndexOf(',', max); if (cm > 24) t = t.slice(0, cm); }
    }
    t = t.replace(/[.,;:\s]+$/, '');
    if (t.length > max) {
      t = t.slice(0, max);
      var sp = t.lastIndexOf(' ');
      if (sp > max * 0.6) t = t.slice(0, sp);
      t = t.replace(/[.,;:\s(]+$/, '') + '…';
    }
    return t;
  }
  function chainContent() {
    var c, id;
    switch (mode) {
      case 'explorar':
        id = EX.id || CO.selId; c = id && CTRL[id];
        if (!c) return null;
        return { key: 'c:' + id, items: [c.nombre, shortText(c.resumen, 72, true), shortText(c.enElAvion, 84, true)] };
      case 'recorrido': {
        if (TR.finished || !TOUR.length) return null;
        var st = TOUR[TR.i];
        return st ? { key: 'r:' + TR.i, items: [shortText(st.titulo, 64), shortText(st.texto, 100, true)] } : null;
      }
      case 'basico': {
        if (!LB.open || LB.finished) return null;
        var p = lbStep();
        if (!p) return null;
        var cap = LB.poseCaption || captionText;
        return { key: 'l:' + LB.idx + ':' + LB.i, items: [shortText(p.titulo, 64), cap ? shortText(cap, 110, true) : shortText(p.texto, 100, true)] };
      }
      case 'checklists': {
        var cur = CL.cur;
        if (!cur || cur.finished) return null;
        var it = arr(cur.cl.items)[cur.i];
        if (!it) return null;
        return { key: 'k:' + cur.cl.id + ':' + cur.i, items: [shortText(it.texto, 72), shortText(it.detalle, 104, true)] };
      }
      case 'volar': {
        var m = VO.m;
        if (!m) return null;
        var ps = arr(m.pasos), k = ps.length ? clamp(Math.floor(VO.progress * ps.length), 0, ps.length - 1) : 0;
        if (VO.achieved) return { key: 'm:' + m.id + ':ok', tone: 'good', items: ['¡Misión cumplida!', shortText(m.titulo, 64)] };
        return { key: 'm:' + m.id, items: [shortText(m.objetivo || m.titulo, 84, true), ps.length ? shortText(ps[k], 110, true) : null] };
      }
      default: return null;
    }
  }
  function chainUpdate(ts) {
    if (!CH.bar) return;
    var c = chainContent();
    if (c) { COACH.tip = null; COACH.shownId = null; COACH.cand = null; CH.bar.set(c.items, { tone: c.tone, key: c.key }); return; }
    var tip = coachPick(ts);
    if (!tip) { CH.bar.clear(); return; }
    var text = '';
    try { text = tip.text(); } catch (e) { text = ''; }
    if (!text) { CH.bar.clear(); return; }
    COACH.tip = tip; COACH.shownId = tip.id;
    var items = ['Consejo', { text: shortText(text, 150), keep: true }];
    if (tip.action) items.push({ text: tip.action[0], onClick: function () { safe(tip.action[1], 'coach action'); } });
    CH.bar.set(items, { tone: 'info', key: 'tip:' + tip.id, dismiss: coachDismiss, dismissLabel: 'Cerrar este consejo' });
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

  /* ---------------------------------------------------------------- "Consejo": the instructor's bubble at the bottom of the 3D view
   * One short suggestion for the next thing to do, chosen from the tab and the state of the airplane (first tip whose condition
   * holds and that the student has not closed). Closing a tip is remembered (localStorage 'c150.coach'), so it never comes back.
   * It steps aside for captions, the stall banner, the flight pad, AIRE, and on phones while the sheet is half / full. */
  var COACH = { el: null, txt: null, act: null, tip: null, cand: null, candT: 0, last: 0, shownId: null, dismissed: store.get('coach', {}) || {} };

  function coachSeenCount() { var n = 0; for (var k in EX.seen) if (Object.prototype.hasOwnProperty.call(EX.seen, k)) n++; return n; }
  function coachNextEssential() { var ids = essentialsNext(1); return ids.length ? ids[0] : null; }
  var COACH_TIPS = [
    { id: 'inicio-mirar', when: function () { return mode === 'inicio'; },
      text: function () { return 'Arrastrá con el mouse o el dedo sobre la cabina para mirar alrededor. Con la rueda del mouse (o pellizcando) te acercás.'; } },
    { id: 'cab-acelerador', when: function () { return mode === 'explorar' && !EX.id && coachSeenCount() === 0 && !!CTRL.throttle; },
      text: function () { return 'Tocá la perilla negra grande, abajo en el centro: es el acelerador.'; },
      action: ['Mostrámelo', function () { lookAtControl('throttle'); }] },
    { id: 'cab-siguiente', when: function () { return mode === 'explorar' && !EX.id && coachSeenCount() > 0 && !!coachNextEssential(); },
      text: function () { return 'Seguí con «' + ctrlName(coachNextEssential()) + '»: es un control esencial que todavía no viste.'; },
      action: ['Verlo', function () { var id = coachNextEssential(); if (id) { openControl(id, 'list'); sheetEnsure('half'); } }] },
    { id: 'cab-probalo', when: function () { return mode === 'explorar' && !!EX.id && !!(CTRL[EX.id] && CTRL[EX.id].probar); },
      text: function () { return 'Probá «' + ctrlName(EX.id) + '» en la sección Probalo de la ficha, o tocalo otra vez acá en la cabina. Mirá cómo reacciona el avión.'; } },
    { id: 'cab-instrumento', when: function () { return mode === 'explorar' && !!EX.id && !(CTRL[EX.id] && CTRL[EX.id].probar); },
      text: function () { return '«' + ctrlName(EX.id) + '» sólo se mira: cambia solo cuando el motor anda o el avión vuela. Probá volar en Practicar.'; },
      action: ['Ir a volar', function () { navOpen('practicar/volar'); sheetEnsure('half'); }] },
    { id: 'rec-pasos', when: function () { return mode === 'recorrido'; },
      text: function () { return 'Seguí los pasos del recorrido en el panel: te llevo por la cabina, control por control, como en la primera clase.'; } },
    { id: 'lec-elegir', when: function () { return mode === 'basico' && !LB.open; },
      text: function () { return 'Elegí una lección en el panel: te la voy mostrando en el avión con animaciones.'; } },
    { id: 'lec-acciones', when: function () { return mode === 'basico' && LB.open && !LB.finished; },
      text: function () { return 'Usá los botones de la lección para mover los mandos del avión y mirá cómo reacciona.'; } },
    { id: 'chk-elegir', when: function () { return mode === 'checklists' && !CL.cur; },
      text: function () { return 'Elegí una checklist: son las listas de pasos del manual, en el orden en que se hacen en el avión.'; } },
    { id: 'chk-correr', when: function () { return mode === 'checklists' && !!CL.cur; },
      text: function () { return 'Hacé cada paso en la cabina 3D: el ítem se tilda solo cuando está bien hecho.'; } },
    { id: 'vol-motor', when: function () { var s = S(); return mode === 'volar' && !!s && !(s.engine && (s.engine.running || s.engine.cranking)) && !(s.air && s.air.onGround === false); },
      text: function () { return 'El motor está apagado. Para arrancarlo, seguí la checklist «Arranque»: te guía paso a paso.'; },
      action: ['Abrir la checklist', function () { openChecklist('arranque'); sheetEnsure('half'); }] },
    { id: 'vol-mandos', when: function () { return mode === 'volar'; },
      text: function () { return cc('isMobile') ? 'Movés el volante y el acelerador con los controles de abajo. Probá de a poquito.' : 'Mové el volante con las flechas del teclado y los pedales con Z y X. Probá de a poquito.'; } },
    { id: 'quiz-donde', when: function () { return mode === 'quiz'; },
      text: function () { return 'Si la pregunta dice “¿dónde está…?”, tocá ese control directamente en la cabina 3D.'; } }
  ];

  function coachBuild() { /* the tip now lives in the chain bar over the dock (chainUpdate) */ }
  function coachPlace() { /* nothing to measure any more */ }
  function coachDismiss() {
    if (!COACH.tip) return;
    COACH.dismissed[COACH.tip.id] = 1;
    store.set('coach', COACH.dismissed);
    coachHide();
    COACH.last = 0;
    chainUpdate(now());
  }
  function coachHide() { COACH.tip = null; COACH.shownId = null; COACH.cand = null; }
  /** Reserved: the student wants the tips back (Ayuda). */
  function coachReset() { COACH.dismissed = {}; store.set('coach', {}); COACH.cand = null; }
  function coachBlocked() {
    if (!coreReady || !overlayDone || mode === 'aire') return true;
    if (stallOn || flypadShown()) return true;
    if (SH.active && SH.snap !== 'peek') return true;           // phones: the sheet needs the room
    return false;
  }
  /** The tip to show now (first whose condition holds and that the student has not closed), after a short wait so it does not flicker. */
  function coachPick(ts) {
    if (ts - COACH.last < 250) return COACH.tip;
    COACH.last = ts;
    var tip = null;
    if (!coachBlocked()) {
      for (var i = 0; i < COACH_TIPS.length; i++) {
        var t = COACH_TIPS[i];
        if (COACH.dismissed[t.id]) continue;
        var ok = false;
        try { ok = !!t.when(); } catch (e) { ok = false; }
        if (ok) { tip = t; break; }
      }
    }
    if (!tip) { COACH.cand = null; return null; }
    if (COACH.cand !== tip.id) { COACH.cand = tip.id; COACH.candT = ts; }
    if (COACH.shownId !== tip.id && ts - COACH.candT < 1400) return null;
    return tip;
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
    if (CO.shown || CO.selId || CO.hoverId) updateCallout();
    var impl = modeImpl[mode];
    if (impl && impl.frame) { try { impl.frame(s, dt); } catch (e) { logError('frame ' + mode, e); } }
    for (var i = 0; i < frameHooks.length; i++) { try { frameHooks[i](s, dt); } catch (e2) { logError('frame hook', e2); } }
    slowAcc += dt;
    if (kickFlag || slowAcc >= 0.06) {          // Core sends ~15 frames/s: refresh text on each
      slowAcc = 0; kickFlag = false;
      updateHud(s);
      updateCaption();
      chainUpdate(now());
      if (!insetRect && coreReady) { var r = cc('getInsetRect'); if (r) onLayout(r); }
      if (impl && impl.slow) { try { impl.slow(s); } catch (e3) { logError('slow ' + mode, e3); } }
      runLive(liveGlobal, s);
      flushIdle();
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

  /* v5 · V2 — los "Probalo" con el lenguaje de AIRE (Kit.slider / .ctl / .detents / .quick) y fichas de interruptor con punto. */

  /** Toggle chip with a dot (the panel version of the dock's .tchip): name + state in mono. */
  function switchBtn(name, get, set, onTxt, offTxt, live) {
    var st = h('span', { class: 'ctog-state' });
    var b = h('button', { type: 'button', class: 'ctog', role: 'switch', 'aria-checked': 'false' },
      h('span', { class: 'ctog-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'ctog-text' }, h('span', { class: 'ctog-name', text: name }), st));
    b.addEventListener('click', function () { set(!get()); upd(); });
    function upd() {
      var v = !!get();
      setAttr(b, 'aria-checked', v ? 'true' : 'false');
      setText(st, v ? onTxt : offTxt);
    }
    live.push(upd); upd();
    return b;
  }
  function togGrid(btns, one) { return h('div', { class: 'ctog-grid' + (one ? ' ctog-grid--1' : '') }, btns); }

  /** The AIRE control shell: mono label + big live readout on one line; the widget adds the rest below. */
  function ctlShell(label, big) {
    var val = h('output', { class: 'ctl-val' });
    var sub = h('p', { class: 'ctl-sub' });
    var el = h('div', { class: 'ctl' + (big === false ? '' : ' ctl--big') }, h('div', { class: 'ctl-top' }, h('span', { class: 'ctl-lbl', text: label }), val));
    return { el: el, val: val, sub: sub };
  }
  /** Small mono caption above a group of controls ("PEDALES · TIMÓN DE DIRECCIÓN"). */
  function ctlCap(text) { return h('p', { class: 'ctl-cap', text: text }); }
  function ctlHint(text) { return h('p', { class: 'ctl-sub', text: text }); }
  /** Segmented row of press-and-hold buttons (pedals, brakes, flaps DOWN): the .seg look of the app. */
  function holdSeg(label, items) {
    var seg = h('div', { class: 'seg seg--hold', role: 'group', 'aria-label': label });
    items.forEach(function (it) {
      var b = holdButton(it.content, it.down, it.up, '', it.label);
      b.className = '';
      seg.appendChild(b);
    });
    return seg;
  }

  /** AIRE slider (Kit.slider): big readout, ticks, quick chips and a live line, kept in step with the simulator. */
  function ctlSlider(o, live) {
    var lastUser = 0, dragging = false;
    var api = C150.Kit.slider({
      label: o.label, min: o.min, max: o.max, step: o.step, value: num(o.get(), o.min), format: o.format, big: o.big !== false, center: o.center,
      ticks: o.ticks, ends: o.ends, quick: o.quick, sub: o.sub ? '' : undefined,
      onInput: function (v) { lastUser = now(); o.set(v); }
    });
    api.input.addEventListener('pointerdown', function () { dragging = true; });
    api.input.addEventListener('pointerup', function () { dragging = false; });
    api.input.addEventListener('pointercancel', function () { dragging = false; });
    live.push(function (s) {
      var v = num(o.get(), o.min);
      if (!dragging && now() - lastUser > 400 && Math.abs(num(api.value, 0) - v) > 1e-6) api.set(v);
      if (o.sub) api.setSub(o.sub(s, num(api.value, v)));
    });
    return api;
  }

  function engineText(s) {
    var e = (s && s.engine) || {};
    if (e.running) return 'Motor en marcha · ' + Math.round(num(e.rpm, 0) / 10) * 10 + ' RPM';
    if (e.cranking) return 'Motor de arranque girando…';
    return 'Motor apagado';
  }
  function busOn(s) { return !!(s && s.elec && num(s.elec.busVolts, 0) > 8); }

  /** "+ = trailing edge down" surface angle in words. */
  function surfWord(deg) {
    if (deg < -0.5) return 'arriba ' + fmt(-deg, 0) + '°';
    if (deg > 0.5) return 'abajo ' + fmt(deg, 0) + '°';
    return 'al medio';
  }

  /** What each slider shows: short readout, ticks, quick values and a live line (units in plain words). */
  function sliderSpec(clave, min, max) {
    var T = function (v, t) { return { v: v, t: t }; };
    var pc = [T(0, '0 %'), T(0.5, '50 %'), T(1, '100 %')];
    var lowHigh = function (lo, hi) { return function (v) { return v < 0.04 ? lo : (v > 0.96 ? hi : pct(v)); }; };
    switch (clave) {
      case 'throttle':
        return { format: pct, ticks: pc, quick: [T(0, 'RALENTÍ'), T(0.5, 'MEDIA'), T(1, 'A FONDO')],
          sub: function (s) {
            var e = (s && s.engine) || {};
            return (e.running || num(e.rpm, 0) > 50) ? 'Motor en marcha · ' + Math.round(num(e.rpm, 0) / 10) * 10 + ' RPM' : 'Motor apagado · 0 RPM';
          } };
      case 'mixture':
        return { format: lowHigh('CORTE', 'RICA'), ticks: [T(0, 'CORTE'), T(0.5, '50 %'), T(1, 'RICA')], quick: [T(0, 'CORTE'), T(0.7, 'EMPOBRECIDA'), T(1, 'RICA')],
          sub: function (s, v) {
            return v < 0.04 ? 'IDLE CUT-OFF: sin nafta, el motor se apaga' : (v > 0.96 ? 'FULL RICH: toda la nafta, para arrancar y despegar'
              : 'Empobrecida: menos nafta para el mismo aire');
          } };
      case 'carbHeat':
        return { format: lowHigh('FRÍA', 'CALIENTE'), ticks: [T(0, 'FRÍA'), T(0.5, '50 %'), T(1, 'CALIENTE')], quick: [T(0, 'FRÍA'), T(1, 'CALIENTE')],
          sub: function (s, v) {
            return v < 0.04 ? 'COLD: aire de afuera, sin calentar' : (v > 0.96 ? 'HOT: aire caliente que derrite el hielo del carburador' : 'Aire calentado a medias');
          } };
      case 'trim':
        return { center: true, format: function (v) { return Math.abs(v) < 0.04 ? 'TAKE OFF' : fmtSigned(v, 2); },
          ticks: [T(min, 'NARIZ ABAJO'), T(0, 'TAKE OFF'), T(max, 'NARIZ ARRIBA')], quick: [T(-0.5, 'ABAJO'), T(0, 'TAKE OFF'), T(0.5, 'ARRIBA')],
          sub: function (s, v) {
            var sf = (s && s.surfaces) || {};
            return 'Aleta del compensador: ' + surfWord(num(sf.trimTab, 0)) + (Math.abs(v) < 0.04 ? '' : (v > 0 ? ' · nariz arriba' : ' · nariz abajo'));
          } };
      case 'cabinHeat': case 'cabinAir':
        return { format: lowHigh('CERRADA', 'ABIERTA'), ticks: [T(0, 'CERRADA'), T(0.5, '50 %'), T(1, 'ABIERTA')], quick: [T(0, 'CERRADA'), T(1, 'ABIERTA')],
          sub: function (s, v) { return v < 0.04 ? 'Cerrada' : (v > 0.96 ? 'Abierta del todo' : 'Abierta ' + pct(v)); } };
      default:
        return { format: function (v) { return fmt(v, 2); } };
    }
  }

  function wSlider(p, c, live) {
    var min = num(p.min, 0), max = num(p.max, 1), sp = sliderSpec(p.clave, min, max);
    return ctlSlider({
      min: min, max: max, step: num(p.paso, 0.01), label: c.nombre,
      get: function () { return num(getInput(p.clave), min); },
      set: function (v) { setInput(p.clave, clamp(v, min, max)); },
      format: sp.format, ticks: sp.ticks, quick: sp.quick, center: sp.center, sub: sp.sub,
      ends: (p.etiquetaMin || p.etiquetaMax) ? [p.etiquetaMin || '', p.etiquetaMax || ''] : null
    }, live);
  }

  /** On / off switch: the big word is the state, the two-option .seg shows both positions (the full wording goes in the line below). */
  function wToggle(p, c, live) {
    var shell = ctlShell(c.nombre), onT = p.on || 'Sí', offT = p.off || 'No';
    var short = function (t) { return String(t).replace(/\s*\(.*\)\s*$/, ''); };
    var off = h('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { setInput(p.clave, false); upd(); } }, offT);
    var on = h('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { setInput(p.clave, true); upd(); } }, onT);
    function upd() {
      var v = !!getInput(p.clave);
      setAttr(on, 'aria-pressed', v ? 'true' : 'false');
      setAttr(off, 'aria-pressed', v ? 'false' : 'true');
      setText(shell.val, short(v ? onT : offT));
      setText(shell.sub, v ? onT : offT);
    }
    live.push(upd); upd();
    shell.el.appendChild(h('div', { class: 'seg seg--two', role: 'group', 'aria-label': c.nombre }, off, on));
    shell.el.appendChild(shell.sub);
    return shell.el;
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
    var ro = compact ? null : h('div', { class: 'ctl-sub ctl-sub--lines' });
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
    var pedSub = h('p', { class: 'ctl-sub ctl-sub--lines' }), brkSub = h('p', { class: 'ctl-sub' });
    var pedals = h('div', { class: 'ctl-group' },
      ctlCap('Pedales · timón de dirección'),
      holdSeg('Pedales: mantené apretado', [
        { content: ['◀ ', 'Pedal izq'], down: function () { hold('rudder-pedals', 'left', true); }, up: function () { hold('rudder-pedals', 'left', false); }, label: 'Pisar el pedal izquierdo (mantené apretado)' },
        { content: ['Pedal der', ' ▶'], down: function () { hold('rudder-pedals', 'right', true); }, up: function () { hold('rudder-pedals', 'right', false); }, label: 'Pisar el pedal derecho (mantené apretado)' }]),
      ctlSlider({
        min: -1, max: 1, step: 0.05, label: 'Pedales: izquierda a derecha', center: true,
        get: function () { return num(getInput('rudder'), 0); },
        set: function (v) { setInput('rudder', Math.abs(v) < 0.03 ? 0 : v); },
        format: function (v) { return Math.abs(v) < 0.03 ? 'PAREJOS' : (v < 0 ? 'IZQ ' : 'DER ') + pct(Math.abs(v)); },
        ticks: [{ v: -1, t: 'IZQ' }, { v: 0, t: 'AL MEDIO' }, { v: 1, t: 'DER' }], ends: ['Izquierdo a fondo', 'Derecho a fondo']
      }, live),
      pedSub);
    var brakes = h('div', { class: 'ctl-group' },
      ctlCap('Frenos · puntas de los pies'),
      holdSeg('Frenos: mantené apretado', [
        { content: 'Freno izq', down: function () { hold('toe-brakes', 'left', true); }, up: function () { hold('toe-brakes', 'left', false); }, label: 'Freno izquierdo (mantené apretado)' },
        { content: 'Los dos', down: function () { hold('toe-brakes', null, true); }, up: function () { hold('toe-brakes', null, false); }, label: 'Los dos frenos (mantené apretado)' },
        { content: 'Freno der', down: function () { hold('toe-brakes', 'right', true); }, up: function () { hold('toe-brakes', 'right', false); }, label: 'Freno derecho (mantené apretado)' }]),
      brkSub);
    live.push(function (s) {
      var sf = s.surfaces || {}, rd = num(sf.rudder, 0), nw = num(s.noseWheelAngle, 0);
      setText(pedSub, 'Timón de dirección: ' + (Math.abs(rd) < 0.5 ? 'al medio' : fmt(Math.abs(rd), 0) + '° a la ' + (rd < 0 ? 'izquierda' : 'derecha')) +
        '\nRueda de nariz: ' + (Math.abs(nw) < 0.5 ? 'recta' : fmt(Math.abs(nw), 0) + '° a la ' + (nw < 0 ? 'izquierda' : 'derecha')));
      setText(brkSub, 'Freno izq ' + pct(s.brakeL) + ' · der ' + pct(s.brakeR) + (s.parkingBrake ? ' · estacionamiento PUESTO' : ''));
    });
    // toe-brakes card: brakes first; rudder-pedals card: pedals first
    return c.id === 'toe-brakes' ? h('div', null, brakes, pedals) : h('div', null, pedals, brakes);
  }

  function wIgnition(p, c, live) {
    var vals = arr(p.valores).length ? p.valores : ['OFF', 'R', 'L', 'BOTH', 'START'];
    var NAMES = { OFF: 'Apagado', R: 'Sólo magneto derecho', L: 'Sólo magneto izquierdo', BOTH: 'Los dos magnetos', START: 'Arranque' };
    var btns = {}, shell = ctlShell('Posición de la llave');
    var det = h('div', { class: 'detents', role: 'group', 'aria-label': 'Posición de la llave', style: { 'grid-template-columns': 'repeat(' + vals.length + ', 1fr)' } });
    vals.forEach(function (v) {
      var b;
      if (v === 'START') {
        b = holdButton(h('span', { class: 'detent-n', text: 'START' }), function () { hold('ignition', null, true); }, function () { hold('ignition', null, false); }, 'is-start', 'START: mantené apretado para arrancar');
        b.className = 'detent is-start';
      } else {
        b = h('button', { type: 'button', class: 'detent', 'aria-pressed': 'false', 'aria-label': v + ': ' + (NAMES[v] || v), onclick: function () { setIgnition(v); } },
          h('span', { class: 'detent-n', text: v }));
      }
      btns[v] = b; det.appendChild(b);
    });
    live.push(function (s) {
      for (var k in btns) setAttr(btns[k], 'aria-pressed', s.ignition === k ? 'true' : 'false');
      setText(shell.val, s.ignition || '');
      setText(shell.sub, (NAMES[s.ignition] || s.ignition) + ' · ' + engineText(s));
    });
    shell.el.appendChild(det); shell.el.appendChild(shell.sub);
    shell.el.appendChild(ctlHint('START es a resorte: mantenelo apretado y, al soltar, vuelve solo a BOTH.'));
    return shell.el;
  }

  function wMaster(c, live) {
    var shell = ctlShell('Corriente de la barra');
    var box = togGrid([
      switchBtn('ALT · alternador', function () { return !!getInput('masterAlt'); }, function (v) { setMaster('alt', v); }, 'ON', 'OFF', live),
      switchBtn('BAT · batería', function () { return !!getInput('masterBat'); }, function (v) { setMaster('bat', v); }, 'ON', 'OFF', live)]);
    live.push(function (s) {
      var el = s.elec || {};
      setText(shell.val, fmt(num(el.busVolts, 0), 1) + ' V');
      setText(shell.sub, 'Amperímetro ' + fmtSigned(num(el.ammeterAmps, 0), 0) + ' A');
    });
    shell.el.appendChild(box); shell.el.appendChild(shell.sub);
    shell.el.appendChild(ctlHint('Están unidos: si prendés ALT se prende BAT, y si apagás BAT se apaga ALT.'));
    return shell.el;
  }

  /** Flaps: the real switch (UP stays, DOWN is a spring: hold it) plus detents that run the little electric motor to 0 / 10 / 20 / 30 / 40°. */
  function wFlaps(c, live) {
    var shell = ctlShell('Flaps'), STOPS = [0, 10, 20, 30, 40], target = null;
    var fill = h('span', { class: 'ctl-meter-fill' }), mark = h('i', { class: 'ctl-meter-mark', hidden: true });
    var warn = h('p', { class: 'ctl-note', hidden: true, text: 'Los flaps son eléctricos: sin el master prendido no se mueven.' });
    function stop() {
      if (target === null) return;
      target = null;
      var i = activeHolds.indexOf(stop); if (i >= 0) activeHolds.splice(i, 1);
      setFlapSwitch('OFF');
    }
    function motor(s) {
      if (target === null) return;
      if (!busOn(s)) { stop(); return; }
      var d = target - num(s.flaps, 0);
      if (Math.abs(d) < 0.7) { var t = target; stop(); s.flaps = t; kick(); return; }
      var want = d > 0 ? 'DOWN' : 'UP';
      if (s.flapSwitch !== want) setFlapSwitch(want);
    }
    function goTo(v) {
      var s = S();
      if (!s) return;
      if (!busOn(s)) { warn.hidden = false; return; }
      if (target === null) activeHolds.push(stop);
      target = v;
      motor(s);
    }
    var det = h('div', { class: 'detents', role: 'group', 'aria-label': 'Flaps: posiciones', style: { 'grid-template-columns': 'repeat(' + STOPS.length + ', 1fr)' } });
    var dBtns = STOPS.map(function (v) {
      var b = h('button', { type: 'button', class: 'detent', 'aria-pressed': 'false', 'aria-label': 'Flaps a ' + v + ' grados', onclick: function () { goTo(v); } }, h('span', { class: 'detent-n', text: v + '°' }));
      det.appendChild(b);
      return b;
    });
    var up = h('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { stop(); setFlapSwitch(getInput('flapSwitch') === 'UP' ? 'OFF' : 'UP'); } }, 'Subir (UP)');
    var dn = holdButton('Bajar (mantener)', function () { stop(); hold('flap-switch', null, true); }, function () { hold('flap-switch', null, false); }, '', 'Bajar flaps: mantené apretado');
    dn.className = '';
    var seg = h('div', { class: 'seg seg--hold', role: 'group', 'aria-label': 'Interruptor de flaps' }, up, dn);
    live.push(function (s) {
      motor(s);
      var f = clamp(num(s.flaps, 0), 0, 40);
      fill.style.width = (f / 40 * 100).toFixed(1) + '%';
      mark.hidden = target === null;
      if (target !== null) mark.style.left = (target / 40 * 100).toFixed(1) + '%';
      dBtns.forEach(function (b, i) {
        setAttr(b, 'aria-pressed', Math.abs(f - STOPS[i]) < 1.5 ? 'true' : 'false');
        toggleClass(b, 'is-moving', target === STOPS[i]);
      });
      setAttr(up, 'aria-pressed', s.flapSwitch === 'UP' ? 'true' : 'false');
      setText(shell.val, Math.round(f) + '°');
      setText(shell.sub, 'Interruptor: ' + (s.flapSwitch === 'UP' ? 'UP' : (s.flapSwitch === 'DOWN' ? 'DOWN' : 'OFF (al medio)')) + (target !== null ? ' · yendo a ' + target + '°' : ''));
      warn.hidden = busOn(s);
    });
    shell.el.appendChild(h('div', { class: 'ctl-meter', 'aria-hidden': 'true' }, fill, mark));
    shell.el.appendChild(det); shell.el.appendChild(shell.sub); shell.el.appendChild(warn);
    shell.el.appendChild(ctlCap('Interruptor de la cabina'));
    shell.el.appendChild(seg);
    shell.el.appendChild(ctlHint('DOWN es a resorte: bajan sólo mientras lo mantenés. UP queda trabado y los sube hasta 0°.'));
    return shell.el;
  }

  function wPrimer(p, c, live) {
    var shell = ctlShell('Cebador (primer)');
    var pump = h('button', {
      type: 'button', class: 'btn btn--primary btn--small',
      onclick: function () { if (has('operate')) operate('primer'); else simAction('primeStroke'); }
    }, p.etiqueta || 'Dar un bombeo');
    live.push(function (s) {
      var e = s.engine || {}, n = num(e.primeCharges, 0);
      setText(shell.val, n + (n === 1 ? ' bombeo' : ' bombeos'));
      setText(shell.sub, (e.flooded ? '¡Motor ahogado! ' : '') + (e.running ? 'Motor en marcha' : 'Motor apagado'));
    });
    shell.el.appendChild(h('div', { class: 'ctl-row' }, pump));
    shell.el.appendChild(togGrid(switchBtn('Cebador trabado', function () { return !!getInput('primerLocked'); },
      function (v) { setInput('primerLocked', v); }, 'Adentro y trabado', 'Suelto (destrabado)', live), true));
    shell.el.appendChild(shell.sub);
    return shell.el;
  }

  var LIGHTS = [
    ['lights.dome', 'DOME · luz de cabina'], ['pitotHeat', 'PITOT HT · calef. pitot'], ['lights.nav', 'NAV · navegación'],
    ['lights.strobe', 'STROBE · destellos'], ['lights.beacon', 'BCN · baliza'], ['lights.taxi', 'TAXI · rodaje'],
    ['lights.landing', 'LDG · aterrizaje']
  ];
  function wLuces(c, live) {
    var shell = ctlShell('Luces e interruptores', false);
    var grid = togGrid(LIGHTS.map(function (l) {
      return switchBtn(l[1], function () { return !!getInput(l[0]); }, function (v) { setInput(l[0], v); }, 'ON', 'OFF', live);
    }));
    var warn = h('p', { class: 'ctl-note', hidden: true, text: 'Sin el master prendido las luces no encienden: prendé BAT (en la ficha del master o con la tecla M).' });
    live.push(function (s) {
      warn.hidden = busOn(s);
      setText(shell.val, 'Amp ' + fmtSigned(num(s.elec && s.elec.ammeterAmps, 0), 0) + ' A');
    });
    shell.el.appendChild(grid); shell.el.appendChild(warn);
    return shell.el;
  }

  function wDoors(c, live) {
    return togGrid([
      switchBtn('Puerta izquierda', function () { return !!getInput('doorLeftOpen'); }, function (v) { setInput('doorLeftOpen', v); }, 'Abierta', 'Cerrada', live),
      switchBtn('Puerta derecha', function () { return !!getInput('doorRightOpen'); }, function (v) { setInput('doorRightOpen', v); }, 'Abierta', 'Cerrada', live),
      switchBtn('Ventanilla izquierda', function () { return !!getInput('windowLeftOpen'); }, function (v) { setInput('windowLeftOpen', v); }, 'Abierta', 'Cerrada', live)]);
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
    var shell = ctlShell(c.nombre);
    function nudge(dir) {
      var v = num(getInput(p.clave), min) + dir * step;
      if (wrap) { var span = max - min + step; v = min + ((((v - min) % span) + span) % span); }
      v = clamp(v, min, max);
      var dec = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
      setInput(p.clave, Number(v.toFixed(dec)));
      upd();
    }
    function upd() {
      var s = S(); if (!s) return;
      var v = num(getPath(s, p.clave), min);
      var parts = knobFormat(p, v, s).split(' · '), also = parts.slice(1).join(' · ');     // the big readout is the first part; the rest goes to the line below
      setText(shell.val, parts[0]);
      if (p.clave === 'hiCorrection') {
        var a = s.air || {};
        setText(shell.sub, 'Direccional ' + heading3(a.hiHeading) + '° · Brújula ' + heading3(a.heading) + '°');
      } else if (p.clave === 'altimeterSetting') {
        var al = s.air || {};
        setText(shell.sub, (also ? also + ' · ' : '') + 'El altímetro marca ' + Math.round(num(al.indicatedAlt, 0) / 10) * 10 + ' ft (el aeródromo está a ' + Math.round(num(s.fieldElevation, 100)) + ' ft)');
      } else if (p.clave === 'radio.obs') {
        setText(shell.sub, 'Curso elegido en el indicador VOR');
      } else setText(shell.sub, also);
      shell.sub.hidden = !shell.sub.textContent;
    }
    live.push(upd);
    var row = h('div', { class: 'ctl-step' },
      repeatButton([h('span', { class: 'ctl-step-sym', 'aria-hidden': 'true', text: '−' }), h('span', { text: 'Bajar' })], function () { nudge(-1); }, 'ctl-step-btn', 'Bajar'),
      repeatButton([h('span', { class: 'ctl-step-sym', 'aria-hidden': 'true', text: '+' }), h('span', { text: 'Subir' })], function () { nudge(1); }, 'ctl-step-btn', 'Subir'));
    shell.el.appendChild(row);
    shell.el.appendChild(shell.sub);
    if (p.clave === 'altimeterSetting') {
      shell.el.appendChild(h('div', { class: 'quick', role: 'group', 'aria-label': 'Valores rápidos' },
        h('button', { type: 'button', class: 'qbtn', onclick: function () { setInput('altimeterSetting', 29.92); upd(); } }, 'ESTÁNDAR · 1013 hPa')));
    }
    upd();
    return shell.el;
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

  /** Probalo section for a control (null when the control is informational only). `bare`: only the widgets (the sheet wraps them in a numbered section). */
  function buildProbalo(c, live, compact, bare) {
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
    var wrap = h('div', { class: 'probalo probalo--ctl' + (compact ? ' is-compact' : ''), role: 'group', 'aria-label': 'Probalo: ' + c.nombre });
    if (!bare) {
      wrap.appendChild(h('div', { class: 'probalo-head' },
        h('h3', { class: 'ctl-cap ctl-cap--accent' }, h('span', { class: 'probalo-ico', 'aria-hidden': 'true' }, kic('hand')), 'Probalo'),
        compact ? null : h('span', { class: 'probalo-hint', text: 'o tocalo en la cabina 3D' })));
    }
    wrap.appendChild(body);
    return wrap;
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
  /** Instrument markings as horizontal coloured bars (the AIRE .bars look): one row per colour, its stretch drawn on the instrument's scale, grouped by unit. */
  var RANGE_VAR = { blanco: 'var(--arc-white)', verde: 'var(--arc-green)', amarillo: 'var(--arc-yellow)', rojo: 'var(--arc-red)', azul: '#2F6FA8' };
  function rangesView(rangos) {
    var groups = {}, order = [];
    rangos.forEach(function (r) {
      if (!r || typeof r.desde !== 'number' || typeof r.hasta !== 'number') return;
      var u = r.unidad || '';
      if (!groups[u]) { groups[u] = []; order.push(u); }
      groups[u].push(r);
    });
    var box = h('div', { class: 'ranges bars' });
    order.forEach(function (u) {
      var g = groups[u], lo = Infinity, hi = -Infinity;
      g.forEach(function (r) { lo = Math.min(lo, r.desde, r.hasta); hi = Math.max(hi, r.desde, r.hasta); });
      var span = hi - lo;
      if (span <= 0) span = Math.max(1, Math.abs(hi) * 0.4);
      var a = lo - span * 0.04, b = hi + span * 0.04;
      if (hi === lo) { a = lo - span; b = hi + span; }
      function x(v) { return ((v - a) / (b - a) * 100); }
      box.appendChild(h('p', { class: 'bars-cap', text: u ? 'Escala en ' + u + ' · de ' + nf(lo) + ' a ' + nf(hi) : 'Escala de ' + nf(lo) + ' a ' + nf(hi) }));
      g.forEach(function (r) {
        var col = COLOR_NAME[r.color] ? r.color : 'blanco';
        var f = Math.min(r.desde, r.hasta), t = Math.max(r.desde, r.hasta);
        var fill = f === t
          ? h('span', { class: 'range-line c-' + col, style: { left: x(f).toFixed(2) + '%' } })
          : h('span', { class: 'range-fill c-' + col, style: { left: x(f).toFixed(2) + '%', width: Math.max(1.5, x(t) - x(f)).toFixed(2) + '%' } });
        box.appendChild(h('div', { class: 'bar-row range-row', style: { '--c': RANGE_VAR[col] } },
          h('span', { class: 'bar-name' }, h('span', { class: 'sr-only', text: 'Marca: ' }), COLOR_NAME[col]),
          h('span', { class: 'bar-track', 'aria-hidden': 'true' }, fill),
          h('span', { class: 'bar-val', text: (f === t ? nf(f) : nf(f) + '–' + nf(t)) + (u ? ' ' + u : '') })));
        if (r.texto) box.appendChild(h('p', { class: 'range-txt', text: r.texto }));
      });
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

  /* ---- Cabina (contract v4 §3, wave U3): chips por categoría con ícono, buscador, lista agrupada con "esencial" primero y tilde
   * en lo que ya abriste (C150.Progress 'cabina'), ficha con acciones claras y acordeones. Nada de esto toca los datos. */
  var CAT_ICON = { mandos: 'hand', motor: 'engine', combustible: 'drop', electrico: 'bolt', vuelo: 'gauge', sistemas: 'settings', radio: 'compass', cabina: 'cabin' };
  function catIcon(id) { return CAT_ICON[id] || 'dot'; }
  /** Sprite icon (C150.Kit) when it has the name, else the small local set. */
  function kic(name, size) {
    var I = C150.Icons, K = C150.Kit;
    if (I && isFn(I.has) && I.has(name) && K && isFn(K.icon)) return K.icon(name, size);
    return icon(name);
  }
  function kbadge(text, variant, iconName) {
    var K = C150.Kit;
    if (K && isFn(K.badge)) return K.badge(text, variant, iconName);
    return h('span', { class: 'badge' + (variant ? ' badge--' + variant : '') }, text);
  }
  /** Animated accordion (Kit) with a plain <details> fallback. */
  function acc(title, content, o) {
    var K = C150.Kit;
    o = o || {};
    if (K && isFn(K.accordion)) return K.accordion({ title: title, content: content, open: !!o.open, icon: o.icon });
    var d = h('details', { class: 'acc' }, h('summary', { class: 'acc-sum' }, h('span', { text: title })), h('div', { class: 'acc-body' }, content));
    if (o.open) d.open = true;
    return d;
  }

  var EX = { listView: null, detailView: null, ul: null, count: null, query: '', cat: '', id: null, live: [], visible: [], catBtns: [], listScroll: 0, secOpen: {}, csOpen: {},
    seen: {}, prog: null, progText: null, start: null, catInfo: null, input: null, help: null };

  function exSeen() {
    var P = PG(), m = {}, n = 0;
    CONTROLS.forEach(function (c) { if (P && safe(function () { return P.get('cabina', c.id); }, 'progress.get')) { m[c.id] = true; n++; } });
    EX.seen = m;
    return n;
  }

  /** Controls to show: ranked by C150.Search.rank when there is a query, else by category with the essentials first. */
  function exFiltered() {
    var q = EX.query.trim(), list;
    if (q) {
      var S2 = C150.Search, ranked = null;
      if (S2 && isFn(S2.rank)) {
        ranked = safe(function () {
          return S2.rank(q, CONTROLS, function (c) {
            return [[c.nombre, 12], [arr(c.otrosNombres).join(' '), 9], [c.ingles, 8], [c.id, 4], [c.resumen, 2]];
          });
        }, 'Search.rank');
      }
      if (ranked && ranked.length) list = ranked.map(function (r) { return r.x; });
      else {
        var words = norm(q).split(/\s+/);
        list = CONTROLS.filter(function (c) {
          var hay = norm([c.nombre, c.ingles, c.id, arr(c.otrosNombres).join(' '), c.resumen].join(' '));
          return words.every(function (w) { return hay.indexOf(w) >= 0; });
        });
      }
      if (EX.cat) list = list.filter(function (c) { return c.categoria === EX.cat; });
      return list;
    }
    var catIndex = {};
    CATEGORIES.forEach(function (k, i) { if (k) catIndex[k.id] = i; });
    list = CONTROLS.filter(function (c) { return !EX.cat || c.categoria === EX.cat; });
    return list.map(function (c, i) { return { c: c, i: i }; }).sort(function (p, q2) {
      var a = catIndex[p.c.categoria], b = catIndex[q2.c.categoria];
      a = (a === undefined) ? 99 : a; b = (b === undefined) ? 99 : b;
      return (a - b) || ((p.c.prioridad === 1 ? 0 : 1) - (q2.c.prioridad === 1 ? 0 : 1)) || (p.i - q2.i);
    }).map(function (o) { return o.c; });
  }

  /* v5 · V2 — Cabina con el lenguaje de AIRE: un código por categoría (MOT, MAN…), secciones numeradas plegables, tarjetas con código. */
  var CAT_CODE = { mandos: 'MAN', motor: 'MOT', combustible: 'COM', electrico: 'ELE', vuelo: 'VUE', sistemas: 'SIS', radio: 'RAD', cabina: 'CAB' };
  function catCode(id) { return CAT_CODE[id] || String(id || '').slice(0, 3).toUpperCase(); }

  /** One control as a compact row: category code chip, name + English name in mono, "esencial" tag and the done check. */
  function exRow(c) {
    var seen = !!EX.seen[c.id];
    return h('button', {
      type: 'button', class: 'cr' + (seen ? ' is-seen' : ''), 'data-id': c.id, 'aria-current': EX.id === c.id ? 'true' : null,
      onclick: function () { openControl(c.id, 'list'); }
    },
      h('span', { class: 'cr-code', style: { '--cat': catColor(c) }, 'aria-hidden': 'true', text: catCode(c.categoria) }),
      h('span', { class: 'cr-main' },
        h('span', { class: 'cr-name', text: c.nombre }),
        c.ingles ? h('span', { class: 'cr-en', lang: 'en', text: c.ingles }) : null),
      h('span', { class: 'cr-end' },
        c.prioridad === 1 ? h('span', { class: 'cr-tag', text: 'Esencial' }) : null,
        seen ? h('span', { class: 'cr-check', title: 'Ya lo viste' }, kic('check'), h('span', { class: 'sr-only', text: 'Ya lo viste' }))
          : h('span', { class: 'cr-chev', 'aria-hidden': 'true' }, kic('chevron-right'))));
  }

  /** "Empezá por acá": the next essentials the student has not opened yet (hidden once they have them all). */
  function essentialsNext(n) {
    var out = [];
    SUGGESTED.concat(CONTROLS.map(function (c) { return c.id; })).forEach(function (id) {
      var c = CTRL[id];
      if (out.length < n && c && c.prioridad === 1 && !EX.seen[id] && out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }
  function renderExStart() {
    var box = EX.start, K = C150.Kit;
    if (!box) return;
    clear(box);
    var ids = (EX.query.trim() || EX.cat) ? [] : essentialsNext(4);
    box.hidden = !ids.length;
    if (!ids.length) return;
    var first = !Object.keys(EX.seen).length;
    var items = ids.map(function (id, i) {
      var c = CTRL[id], k = CAT[c.categoria];
      return { code: catCode(c.categoria), title: c.nombre, sum: c.resumen || '', meta: (k ? k.nombre + ' · ' : '') + 'esencial',
        tag: i === 0 ? (first ? 'Empezá acá' : 'Siguiente') : null, onClick: function () { openControl(id, 'list'); } };
    });
    box.appendChild(K.section({ num: 'ES', title: first ? 'Empezá por acá' : 'Seguí con lo esencial', meta: ids.length + (ids.length === 1 ? ' pendiente' : ' pendientes'),
      open: true, key: 'start', body: K.cardCarousel({ items: items, label: 'Controles esenciales para empezar' }) }));
  }

  function renderExList() {
    var ul = EX.ul, K = C150.Kit;
    clear(ul);
    var seenN = exSeen();
    var list = exFiltered();
    EX.visible = list.map(function (c) { return c.id; });
    setText(EX.count, list.length === 1 ? '1 control' : list.length + ' controles');
    if (EX.prog) EX.prog.set(CONTROLS.length ? seenN / CONTROLS.length : 0);
    setText(EX.progText, seenN ? 'Viste ' + seenN + ' de ' + CONTROLS.length + ' controles' : 'Todavía no abriste ninguno: son ' + CONTROLS.length);
    renderExStart();
    var k0 = CAT[EX.cat];
    if (EX.catInfo) { setText(EX.catInfo, k0 && k0.descripcion ? k0.descripcion : ''); EX.catInfo.hidden = !(k0 && k0.descripcion); }
    if (!list.length) {
      var q = EX.query.trim();
      ul.appendChild(h('div', { class: 'ex-empty' },
        (K && isFn(K.emptyState))
          ? K.emptyState({ icon: 'search', title: 'No encontré ese control',
            text: CONTROLS.length ? 'Probá con otra palabra, por ejemplo “nafta”, “luces” o “velocidad”.' : 'Todavía no hay controles cargados.',
            action: (q && C150.Search && isFn(C150.Search.open)) ? { label: 'Buscar en toda la app', icon: 'search', variant: 'secondary', onClick: function () { C150.Search.open({ query: q }); } } : null })
          : h('p', { class: 'empty', text: 'No encontré nada con esa búsqueda.' })));
      return;
    }
    if (EX.query.trim() || EX.cat) {                       // search / one category: a flat list (the chip of each row says which category)
      var flat = h('ul', { class: 'cr-list', 'aria-label': 'Controles de la cabina' });
      list.forEach(function (c) { flat.appendChild(h('li', null, exRow(c))); });
      ul.appendChild(flat);
      return;
    }
    var cats = [], byCat = {}, firstOpen = null;
    list.forEach(function (c) { if (!byCat[c.categoria]) { byCat[c.categoria] = []; cats.push(c.categoria); } byCat[c.categoria].push(c); });
    cats.forEach(function (id) {
      if (firstOpen === null && byCat[id].some(function (x) { return x.prioridad === 1 && !EX.seen[x.id]; })) firstOpen = id;
    });
    if (firstOpen === null) firstOpen = cats[0];
    cats.forEach(function (id) {
      var k = CAT[id], inCat = byCat[id];
      var seenIn = inCat.filter(function (x) { return EX.seen[x.id]; }).length;
      var sl = h('ul', { class: 'cr-list', 'aria-label': k ? k.nombre : id });
      inCat.forEach(function (c) { sl.appendChild(h('li', null, exRow(c))); });
      var sec = K.section({ num: catCode(id), title: k ? k.nombre : id, meta: seenIn + '/' + inCat.length + ' vistos', key: 'cat-' + id,
        open: EX.secOpen[id] !== undefined ? EX.secOpen[id] : id === firstOpen, body: sl, onToggle: function (o) { EX.secOpen[id] = o; } });
      sec.style.setProperty('--cat', (k && k.color) || 'var(--fg-soft)');
      ul.appendChild(sec);
    });
  }

  /** Opens a checklist by id (the welcome path links straight to "Antes de arrancar" / "Arranque"). */
  function openChecklist(id) {
    for (var i = 0; i < CHECKLISTS.length; i++) { if (CHECKLISTS[i].id === id) { clOpen(i); return; } }
  }

  function exIntro() {
    var K = C150.Kit;
    EX.prog = K.progressBar(0, { label: 'Controles que ya viste' });
    EX.progText = h('span', { class: 'ex-prog-t' });
    EX.start = h('div', { class: 'ex-start' });
    var how = h('ul', { class: 'bullets how-list' },
      h('li', null, h('strong', { text: 'Tocá' }), ' cualquier cosa de la cabina, o elegila de la lista: acá aparece su ficha.'),
      h('li', null, h('strong', { text: 'Tocala otra vez' }), ' para usarla, o ', h('strong', { text: 'arrastrá' }), ' las perillas, el volante y los pedales.'),
      h('li', null, h('strong', { text: 'Arrastrá el fondo' }), ' para mirar alrededor; con la rueda del mouse o pellizcando te acercás.'),
      h('li', null, 'Atajos de teclado en ', h('button', { type: 'button', class: 'linklike', onclick: openHelp }, 'la ayuda'), '.'));
    return h('div', { class: 'ex-head' },
      K.pageHeader({ kicker: '01 · Cabina', title: 'Conocé la cabina',
        sub: 'Tocá cualquier mando o instrumento en el 3D, o elegilo de la lista: te cuento qué es, para qué sirve y cómo se usa.',
        children: h('div', { class: 'ex-prog' }, EX.prog, EX.progText) }),
      EX.start,
      acc('Cómo se usa la cabina 3D', how, { icon: 'hand' }));
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

  /** The control sheet, AIRE style: kicker "01 · CABINA · CATEGORÍA", big name, English name in mono, then numbered sections
   *  (01 DÓNDE ESTÁ · 02 QUÉ HACE · 03 PROBALO · 04 QUÉ PASA EN EL AVIÓN · 05 CÓMO SE USA · 06 ERRORES COMUNES · 07 DATO …). */
  function renderDetail(c) {
    releaseAllHolds();
    EX.live = [];
    var v = EX.detailView, K = C150.Kit;
    clear(v);
    var k = CAT[c.categoria];
    var order = EX.visible.indexOf(c.id) >= 0 ? EX.visible : CONTROLS.map(function (x) { return x.id; });
    var i = order.indexOf(c.id);
    var prevId = i > 0 ? order[i - 1] : null, nextId = (i >= 0 && i < order.length - 1) ? order[i + 1] : null;

    var titleId = 'ex-title-' + c.id;
    var parts = arr(c.partesAvion);
    var showBtn = h('button', {
      type: 'button', class: 'btn btn--primary',
      onclick: function () { navLook(function () { if (mainView === 'exterior') { cc('setMainView', 'cockpit'); syncMainView(); } focusControl(c.id, true); }, c.nombre); }
    }, kic('target'), h('span', { text: 'Mostrámelo en 3D' }));
    var extLbl = h('span', { text: 'Ver en el avión' });
    var extBtn = parts.length ? h('button', { type: 'button', class: 'btn btn--secondary', onclick: function () { if (mainView === 'exterior') toggleOnAirplane(c); else navLook(function () { toggleOnAirplane(c); }, c.nombre); } }, kic('plane'), extLbl) : null;
    if (extBtn) EX.live.push(function () { setText(extLbl, mainView === 'exterior' ? 'Volver a la cabina' : 'Ver en el avión'); });
    var airExps = (C150.Lab && isFn(C150.Lab.experimentsFor)) ? arr(safe(function () { return C150.Lab.experimentsFor(c.id); })) : [];
    var airBtns = airExps.slice(0, 2).map(function (x) {
      return h('button', { type: 'button', class: 'btn btn--air', onclick: function () { UI.openLab(x.id); } },
        kic('wind'), h('span', { text: airExps.length > 1 ? 'Ver el aire: ' + x.titulo.toLowerCase() : 'Ver el aire' }));
    });

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
    var usoBody = (steps || c.cuando) ? h('div', null, steps,
      c.cuando ? h('p', { class: 'cs-when' }, h('span', { class: 'cs-when-k', text: 'Cuándo se usa' }), c.cuando) : null) : null;
    var errs = null;
    if (errores.length) { errs = h('ul', { class: 'bullets bullets--warn' }); errores.forEach(function (e) { errs.appendChild(h('li', { text: e })); }); }
    var datoBody = (c.truco || c.dato) ? h('div', null, c.truco ? callK('tip', 'Truco', c.truco) : null, c.dato ? callK('dato', 'Dato curioso', c.dato) : null) : null;
    var relChips = null;
    if (rel.length) {
      relChips = h('div', { class: 'chips' });
      rel.forEach(function (id) {
        var r = CTRL[id];
        relChips.appendChild(K.chip({ label: r.nombre, color: catColor(r), onClick: function () { openControl(id, 'related'); } }));
      });
    }

    function navBtn(id, dir) {
      if (!id) return h('span', { style: { flex: '1' } });
      return h('button', {
        type: 'button', class: 'btn btn--small detail-nav-btn' + (dir > 0 ? ' is-next' : ''), 'aria-label': (dir < 0 ? 'Anterior: ' : 'Siguiente: ') + ctrlName(id),
        onclick: function () { openControl(id, 'pager'); }
      }, dir < 0 ? kic('chevron-left') : null,
        h('span', { class: 'dn-text' }, h('span', { class: 'dn-k', text: dir < 0 ? 'Anterior' : 'Siguiente' }), h('span', { class: 'dn-n', text: ctrlName(id) })),
        dir > 0 ? kic('chevron-right') : null);
    }

    // header
    var head = K.pageHeader({ kicker: '01 · Cabina · ' + (k ? k.nombre : ''), title: c.nombre, sub: c.resumen || null,
      children: h('div', { class: 'cs-actions' }, showBtn, extBtn, airBtns) });
    var ttl = head.querySelector('.pg-title');
    ttl.id = titleId; ttl.tabIndex = -1; ttl.classList.add('detail-title');
    head.classList.add('cs-head');
    var ref = head.querySelector('.pg-sub') || head.querySelector('.cs-actions');
    [c.ingles ? h('p', { class: 'cs-en', lang: 'en', text: c.ingles }) : null,
      h('div', { class: 'cs-tags' },
        h('span', { class: 'cr-code', style: { '--cat': catColor(c) }, text: catCode(c.categoria) }),
        c.prioridad === 1 ? h('span', { class: 'cr-tag', text: 'Esencial' }) : null,
        EX.seen[c.id] ? h('span', { class: 'cs-seen' }, kic('check'), 'Visto') : null),
      otros.length ? h('p', { class: 'cs-also' }, h('span', { class: 'cs-also-k', text: 'También le dicen' }), otros.join(' · ')) : null
    ].forEach(function (n) { if (n) head.insertBefore(n, ref); });

    // numbered sections: only the ones this control has; what the student opened stays open on the next control
    var secs = [], n = 0;
    function addSec(title, meta, body, open, key) {
      if (!body) return;
      n++;
      secs.push(K.section({ num: n, title: title, meta: meta || '', body: body, key: key,
        open: EX.csOpen[key] !== undefined ? EX.csOpen[key] : !!open, onToggle: function (o) { EX.csOpen[key] = o; } }));
    }
    addSec('Dónde está', '', para(c.ubicacion), true, 'donde');
    addSec('Qué hace', '', para(c.queHace), true, 'que-hace');
    addSec('Cada parte', subs.length + (subs.length === 1 ? ' parte' : ' partes'), subList, false, 'partes');
    addSec('Probalo', 'en vivo', buildProbalo(c, EX.live, false, true), true, 'probalo');
    addSec('Qué pasa en el avión', '', para(c.enElAvion), false, 'avion');
    addSec('Cómo se usa', pasos.length ? pasos.length + (pasos.length === 1 ? ' paso' : ' pasos') : '', usoBody, false, 'uso');
    addSec('Errores comunes', errores.length + (errores.length === 1 ? ' error' : ' errores'), errs, false, 'errores');
    addSec('Dato', '', datoBody, false, 'dato');
    addSec('Marcas de colores', 'en el reloj', rangos.length ? rangesView(rangos) : null, false, 'marcas');
    addSec('En otros años y modelos', '', para(c.otrosModelos), false, 'modelos');

    v.appendChild(h('div', { class: 'detail-top cs-top' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--small back-btn', onclick: closeDetail }, kic('back'), 'Todos los controles'),
      i >= 0 ? h('span', { class: 'detail-pos', 'aria-label': 'Control ' + (i + 1) + ' de ' + order.length, text: (i + 1) + ' / ' + order.length }) : null));
    v.appendChild(h('article', { class: 'cs', 'aria-labelledby': titleId, style: { '--cat': catColor(c) } },
      head, secs,
      relChips ? h('div', { class: 'cs-rel' }, ctlCap('Relacionados'), relChips) : null));
    v.appendChild(h('nav', { class: 'detail-nav', 'aria-label': 'Otros controles' }, navBtn(prevId, -1), navBtn(nextId, 1)));
    var s = S();
    if (s) runLive(EX.live, s);
  }

  /** User-level (contract v6): from another tab it is an ABRIR; list → card is a detail entry (UP == Back); card → card by prev / next
   *  or a tap in 3D replaces the entry; a related chip adds one. */
  function openControl(id, source) {
    if (!CTRL[id]) return;
    if (!navOn()) { openControlRaw(id, source); return; }
    if (mode !== 'explorar') { navOpen('cabina/' + id); return; }
    navDetail(!EX.id || source === 'related' ? 'detail' : 'replace', 'cabina/' + id, function () { openControlRaw(id, source); });
  }
  function openControlRaw(id, source) {
    var c = CTRL[id];
    if (!c) return;
    if (!EX.listView) { setMode('explorar'); if (!EX.listView) return; }
    if (!EX.id) EX.listScroll = $('panel').scrollTop;
    EX.id = id;
    exSeen();
    progMark('cabina', id);
    renderDetail(c);
    gloss(EX.detailView, { control: id });
    EX.listView.hidden = true;
    EX.detailView.hidden = false;
    scrollPanelTop();
    cc('setExteriorHighlight', arr(c.partesAvion));
    if (source !== '3d') {
      focusControl(id, false);
      var t = EX.detailView.querySelector('.detail-title');
      if (t) safe(function () { t.focus({ preventScroll: true }); });
    }
    kick();
  }

  /** User-level: "Todos los controles" / a tap on empty space. With Nav it is UP (== Back when the card was opened from the list). */
  function closeDetail() {
    var n = NAV();
    if (navOn() && n && isFn(n.up)) { if (isFn(n.pending) && n.pending() > 0) return; if (n.up()) return; }
    closeDetailRaw();
  }
  function closeDetailRaw() {
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
    kick();
  }

  modeImpl.explorar = {
    render: function (sec) {
      EX.ul = h('div', { class: 'cr-groups' });
      EX.count = h('p', { class: 'count', 'aria-live': 'polite' });
      var input = h('input', {
        type: 'search', placeholder: 'Buscar: acelerador, flaps, nafta…', 'aria-label': 'Buscar un control',
        autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search'
      });
      EX.input = input;
      input.addEventListener('input', function () { EX.query = input.value; renderExList(); });
      var cats = h('div', { class: 'ex-cats', role: 'group', 'aria-label': 'Filtrar por categoría' });
      function catBtn(id, label, color, iconName) {
        var K = C150.Kit;
        var onClick = function () {
          EX.cat = (EX.cat === id) ? '' : id;
          EX.catBtns.forEach(function (x) { setAttr(x.b, 'aria-pressed', x.id === EX.cat ? 'true' : 'false'); });
          renderExList();
        };
        var b = (K && isFn(K.chip)) ? K.chip({ label: label, color: color, selected: EX.cat === id, onClick: onClick })
          : h('button', { type: 'button', class: 'chip', 'aria-pressed': EX.cat === id ? 'true' : 'false', onclick: onClick }, label);
        EX.catBtns.push({ id: id, b: b });
        cats.appendChild(b);
      }
      catBtn('', 'Todas', null, 'list');
      CATEGORIES.forEach(function (k) { if (k && k.id) catBtn(k.id, k.nombre || k.id, k.color || null, catIcon(k.id)); });
      EX.catInfo = h('p', { class: 'ex-cat-info', hidden: true });
      var clearBtn = h('button', { type: 'button', class: 'search-clear', 'aria-label': 'Borrar la búsqueda', hidden: true, onclick: function () {
        input.value = ''; EX.query = ''; renderExList(); clearBtn.hidden = true; input.focus();
      } }, kic('close'));
      input.addEventListener('input', function () { clearBtn.hidden = !input.value; });
      EX.listView = h('div', null, exIntro(),
        h('div', { class: 'ex-list-block' },
          h('div', { class: 'search ex-search' }, kic('search'), input, clearBtn),
          cats, EX.catInfo, EX.count, EX.ul));
      EX.detailView = h('div', { hidden: true });
      sec.appendChild(EX.listView);
      sec.appendChild(EX.detailView);
      renderExList();
      var P = PG();
      if (P && isFn(P.onChange)) P.onChange(function (e) { if (e && e.kind === 'cabina' && !EX.id && EX.listView && !EX.listView.hidden) renderExList(); });
    },
    enter: function () {
      if (EX.id && CTRL[EX.id]) cc('setExteriorHighlight', arr(CTRL[EX.id].partesAvion));
      else if (EX.listView && !EX.listView.hidden) renderExList();
    },
    exit: function () { },
    slow: function (s) { runLive(EX.live, s); }
  };

  /* ================================================================== LO BÁSICO (lecciones + glosario) */

  var LESSONS = arr(DATA.lessons).filter(function (l) { return l && arr(l.pasos).length; });
  var GLOSSARY = arr(DATA.glossary).filter(function (g) { return g && g.termino; }).slice().sort(function (a, b) {
    return String(a.termino).localeCompare(String(b.termino), 'es');
  });
  var LB = { listView: null, lessonView: null, secOpen: {}, idx: -1, open: false, i: 0, seen: {}, finished: false, done: arr(store.get('lessonsDone', [])),
    pose: null, auto: false, loop: store.get('lessonLoop', false) === true, layoutForced: false, layoutBefore: null, userChose: false,
    actBtns: [], autoBtn: null, loopBtn: null, nowEl: null, poseCaption: '',
    air: store.get('lessonAir', true) !== false, airOn: false, airBtn: null };

  /* Panel header (same family as the AIRE lab): numbered mono kicker (the tab's place in the order) + big display title
   * + short lead, closed by a hairline. */
  var MODE_KICKER = { 'Lo básico': '02 · Lecciones', Lecciones: '02 · Lecciones', Recorrido: '02 · Lecciones · Recorrido',
    'Recorrido guiado': '02 · Lecciones · Recorrido', Checklists: '03 · Practicar · Checklists',
    Volar: '03 · Practicar · Misiones', 'Misiones y situaciones': '03 · Practicar · Misiones', Quiz: '03 · Practicar · Quiz' };
  function modeKicker(text) {
    return h('p', { class: 'mode-kicker' }, h('span', { class: 'mode-kicker-dot', 'aria-hidden': 'true' }), text);
  }
  function modeHead(title, sub, extra) {
    return h('div', { class: 'mode-head' }, MODE_KICKER[title] ? modeKicker(MODE_KICKER[title]) : null,
      h('h2', { class: 'placard mode-title', text: title }), sub ? h('p', { class: 'mode-sub', text: sub }) : null, extra || null);
  }
  function emptyState(text) { return h('p', { class: 'empty', text: text }); }

  /* ---- Contract v4, wave U4 — shared pieces of Lecciones and Practicar (styles: "v4 · U4" block of styles.css) ---- */
  var DIFF_TXT = ['', 'Fácil', 'Intermedio', 'Más difícil'];
  /** Three dots, n filled: difficulty (the words are for everybody, not only a colour or a count). */
  function diffDots(n) {
    n = clamp(Math.round(num(n, 1)), 1, 3);
    var w = h('span', { class: 'diff', role: 'img', 'aria-label': 'Dificultad: ' + DIFF_TXT[n].toLowerCase() });
    for (var i = 1; i <= 3; i++) w.appendChild(h('i', { class: i <= n ? 'on' : null, 'aria-hidden': 'true' }));
    w.appendChild(h('span', { class: 'diff-t', 'aria-hidden': 'true', text: DIFF_TXT[n] }));
    return w;
  }
  function metaItem(iconName, text) { return h('span', { class: 'meta-i' }, kic(iconName), h('span', { text: text })); }
  /** One segment per step; the current one is orange, the ones already seen are filled. */
  function stepBar(n, cur, seen, onGo, label) {
    var w = h('div', { class: 'stepbar', role: 'group', 'aria-label': label || 'Pasos' });
    for (var k = 0; k < n; k++) {
      (function (k) {
        var on = k === cur, st = seen && seen[k];
        var cls = 'stepbar-seg' + (on ? ' is-cur' : (st === 'skip' ? ' is-skip' : (st ? ' is-seen' : '')));
        if (!isFn(onGo)) { w.appendChild(h('span', { class: cls + ' is-static', 'aria-hidden': 'true' })); return; }   // not clickable (checklists go in order)
        w.appendChild(h('button', {
          type: 'button', class: cls, 'aria-label': 'Ir al paso ' + (k + 1), 'aria-current': on ? 'step' : null, onclick: function () { onGo(k); }
        }));
      })(k);
    }
    return w;
  }
  /** A calm burst of small dots (CSS only; static with reduced motion). */
  function celebrateEl() {
    var w = h('div', { class: 'celebrate', 'aria-hidden': 'true' });
    for (var i = 0; i < 16; i++) {
      w.appendChild(h('i', { style: { '--x': ((i * 41 + 7) % 100) + '%', '--dx': (((i * 29) % 60) - 30) + 'px', '--dl': ((i % 8) * 0.07).toFixed(2) + 's', '--c': String(i % 4) } }));
    }
    return w;
  }
  /** "En curso" row on top of a list: the activity that was left half way (Continuar) and a small ✕ to forget it. */
  function continueRow(o) {
    return h('div', { class: 'cont', role: 'group', 'aria-label': 'Actividad en curso: ' + o.title },
      h('button', { type: 'button', class: 'cont-main', onclick: o.onResume },
        h('span', { class: 'cont-ico', 'aria-hidden': 'true' }, kic(o.icon || 'play')),
        h('span', { class: 'cont-t' }, h('span', { class: 'cont-k', text: 'En curso' }), h('strong', { text: o.title }), o.text ? h('span', { class: 'cont-d', text: o.text }) : null),
        h('span', { class: 'cont-go' }, 'Continuar', kic('chevron-right'))),
      h('button', { type: 'button', class: 'cont-x', 'aria-label': o.exitLabel || 'Dejar esta actividad', title: o.exitLabel || 'Dejar esta actividad', onclick: function () { confirmLeave(o.exitLabel || 'Dejar esta actividad', o.confirm, o.onExit); } }, kic('close')));
  }
  /** One-line confirmation before throwing away progress (skipped when there is none to lose: text empty). */
  function confirmLeave(title, text, onYes) {
    var K = C150.Kit;
    if (!text || !K || !isFn(K.dialog)) { if (isFn(onYes)) onYes(); return; }
    K.dialog({ title: title, body: text, actions: [{ label: 'Seguir acá', variant: 'secondary' }, { label: 'Sí, dejarla', variant: 'primary', onClick: onYes }] });
  }
  /** "Seguí con…" suggestion: icon, title, one line, chevron. */
  function sgCard(s) {
    return h('button', { type: 'button', class: 'sg' + (s.primary ? ' is-primary' : ''), onclick: s.onClick },
      h('span', { class: 'sg-ico', 'aria-hidden': 'true' }, kic(s.icon || 'chevron-right')),
      h('span', { class: 'sg-main' }, h('strong', { text: s.title }), s.text ? h('span', { text: s.text }) : null),
      h('span', { class: 'sg-go', 'aria-hidden': 'true' }, kic('chevron-right')));
  }
  /** Completion screen: medal, title, one sentence, "Seguí con…" suggestions and secondary actions. */
  function doneCard(o) {
    var sg = arr(o.suggestions).filter(Boolean);
    return h('article', { class: 'card done-card done-card--u4', 'aria-labelledby': o.id || null },
      celebrateEl(),
      h('span', { class: 'done-medal', 'aria-hidden': 'true' }, kic(o.icon || 'trophy')),
      h('p', { class: 'done-k', text: o.kicker || '¡Muy bien!' }),
      h('h3', { class: 'done-t', id: o.id || null, tabindex: o.id ? '-1' : null, text: o.title }),
      o.text ? h('p', { class: 'done-p', text: o.text }) : null,
      sg.length ? h('div', { class: 'sg-wrap' }, h('p', { class: 'sg-k', text: 'Seguí con…' }), h('div', { class: 'sg-list' }, sg.map(sgCard))) : null,
      o.actions ? h('div', { class: 'btn-row done-actions' }, o.actions) : null);
  }
  function pgBar(frac, text, ok) {
    return h('div', { class: 'pg-line' }, progressBar(frac, ok), h('span', { class: 'pg-t', text: text }));
  }
  /** Not yet done by the student? (Progress when present, else false.) */
  function isDone(kind, id) { var p = PG(); return !!(p && safe(function () { return p.get(kind, id); }, 'progress.get')); }
  function firstUndone(list, kind, skipId) {
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id !== skipId && !isDone(kind, list[i].id)) return i;
    return -1;
  }

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
    return acc('Glosario · ' + GLOSSARY.length + ' palabras', h('div', null,
      h('p', { class: 'soft small', text: 'Todas las palabras técnicas que aparecen en la app, explicadas en simple.' }),
      h('div', { class: 'search', style: { 'margin-top': '0' } }, icon('search'), input), dl), { icon: 'book' });
  }

  /* ---- Lecciones: lista de tarjetas (duración, dificultad, hecha) ---- */
  var LESSON_LEVEL = { 'cuatro-fuerzas': 1, 'tres-ejes': 1, flaps: 1, motor: 1, 'en-tierra': 1, 'primera-clase': 1,
    'ala-angulo-ataque': 2, perdida: 2, coordinacion: 2, compensador: 2, instrumentos: 2, 'actitud-potencia': 3 };
  /** Lesson → the AIRE experiment that shows the same idea (data/lab.js ids), for "Probalo en el Aire". */
  var LESSON_LAB = { 'cuatro-fuerzas': 'fuerzas', 'tres-ejes': 'alerones', 'ala-angulo-ataque': 'perdida', perdida: 'perdida',
    coordinacion: 'timon', flaps: 'flaps', compensador: 'profundidad', motor: 'acelerador', 'actitud-potencia': 'acelerador' };
  function lessonMin(l) { return Math.max(3, Math.round(arr(l.pasos).length * 1.5)); }
  function lessonLevel(l) { return LESSON_LEVEL[l.id] || 2; }

  /* ---- v5 · V2 — Lecciones con el lenguaje de AIRE: secciones numeradas por nivel con tarjetas con código (L1…), el reproductor es el "runner" ---- */
  var LESSON_LEVELS = [{ n: 1, title: 'Para empezar' }, { n: 2, title: 'Para entender mejor' }, { n: 3, title: 'Más fino' }];
  /** The check chip of a finished card (cardCarousel only knows code, tag and meta). */
  function cardDone(ul, k) {
    var cards = ul.querySelectorAll('.card-h'), c = cards[k];
    if (!c) return;
    c.classList.add('is-done');
    var top = c.querySelector('.card-h-top');
    if (top) top.appendChild(h('span', { class: 'card-h-check', title: 'Hecha' }, kic('check'), h('span', { class: 'sr-only', text: 'Hecha' })));
  }
  /** v5 · V3 — a thin progress line at the foot of card k (best attempt of a mission, share of a checklist…). */
  function cardBar(ul, k, frac, label) {
    var cards = ul.querySelectorAll('.card-h'), c = cards[k];
    if (!c || !(frac > 0)) return;
    c.appendChild(h('span', { class: 'card-h-bar', role: 'img', 'aria-label': label || 'Avance' }, h('span', { style: { width: (clamp(frac, 0, 1) * 100).toFixed(0) + '%' } })));
  }
  /** A numbered AIRE section (Kit.section) whose open/closed state is remembered per key while the panel lives. */
  var SEC_OPEN = {};
  function secK(num, title, meta, body, key, openDef) {
    var K = C150.Kit;
    return K.section({ num: num, title: title, meta: meta || '', body: body, key: key,
      open: SEC_OPEN[key] !== undefined ? SEC_OPEN[key] : (openDef !== false), onToggle: function (o) { SEC_OPEN[key] = o; } });
  }

  function lbRenderList() {
    var v = LB.listView, K = C150.Kit;
    clear(v);
    var doneN = LESSONS.filter(function (l) { return LB.done.indexOf(l.id) >= 0; }).length;
    v.appendChild(modeHead('Lecciones', 'Cada lección explica una idea de cómo vuela el avión, con animaciones y botones para probarla vos. Van de lo más simple a lo más fino: conviene hacerlas en orden.'));
    if (!LESSONS.length) { v.appendChild(emptyState('Las lecciones todavía no están cargadas.')); }
    else {
      if (LB.idx >= 0 && !LB.finished && !LB.open && LESSONS[LB.idx]) {
        var cl0 = LESSONS[LB.idx];
        v.appendChild(continueRow({ icon: 'book', title: 'Lección «' + (cl0.titulo || '') + '»', text: 'Vas por el paso ' + (LB.i + 1) + ' de ' + arr(cl0.pasos).length,
          onResume: lbResume, onExit: lbExit, exitLabel: 'Dejar esta lección' }));
      }
      var nextIdx = -1;
      for (var q = 0; q < LESSONS.length; q++) if (LB.done.indexOf(LESSONS[q].id) < 0) { nextIdx = q; break; }
      v.appendChild(h('div', { class: 'lc-prog' }, pgBar(LESSONS.length ? doneN / LESSONS.length : 0, doneN + ' de ' + LESSONS.length + ' hechas', doneN === LESSONS.length)));
      var secN = 0;
      LESSON_LEVELS.forEach(function (lv) {
        var items = [], idxs = [];
        LESSONS.forEach(function (l, i) {
          if (lessonLevel(l) !== lv.n) return;
          var n = arr(l.pasos).length, running = i === LB.idx && !LB.finished;
          items.push({ code: 'L' + (i + 1), title: l.titulo || 'Lección', sum: l.resumen || '', current: running,
            meta: n + (n === 1 ? ' paso' : ' pasos') + ' · ' + lessonMin(l) + ' min',
            tag: running ? 'En curso' : (i === nextIdx ? (LB.done.length ? 'Siguiente' : 'Empezá acá') : null),
            onClick: function () { lbOpen(i); } });
          idxs.push(i);
        });
        if (!items.length) return;
        var hechas = idxs.filter(function (i) { return LB.done.indexOf(LESSONS[i].id) >= 0; }).length;
        var ul = K.cardCarousel({ items: items, list: true, label: 'Lecciones: ' + lv.title.toLowerCase() });
        idxs.forEach(function (i, k) { if (LB.done.indexOf(LESSONS[i].id) >= 0) cardDone(ul, k); });
        secN++;
        v.appendChild(K.section({ num: secN, title: lv.title, meta: hechas + '/' + items.length + ' hechas', open: LB.secOpen[lv.n] !== undefined ? LB.secOpen[lv.n] : true,
          body: ul, key: 'lv' + lv.n, onToggle: function (o) { LB.secOpen[lv.n] = o; } }));
      });
    }
    var g = glossaryBlock();
    if (g) v.appendChild(h('div', { class: 'lc-gloss' }, g));
  }
  /** User-level: list → lesson is a detail entry (UP == Back); from another tab it is an ABRIR. */
  function lbOpen(idx) {
    var L = LESSONS[idx];
    if (!L) return;
    if (!navOn()) { if (mode !== 'basico') setMode('basico'); lbOpenRaw(idx); return; }
    if (mode !== 'basico') { navOpen('basico/' + L.id); return; }
    navDetail('detail', 'basico/' + L.id, function () { lbOpenRaw(idx); });
  }
  function lbOpenRaw(idx) {
    if (!LESSONS[idx]) return;
    if (!LB.listView) { setMode('basico'); if (!LB.listView) return; }
    if (idx === LB.idx && !LB.finished && LB.idx >= 0) { lbShowRaw(); return; }         // the lesson already in progress: go on where it was
    LB.idx = idx; LB.i = 0; LB.seen = { 0: true }; LB.finished = false; LB.open = true;
    progTouch('leccion', LESSONS[idx].id);
    LB.listView.hidden = true;
    LB.lessonView.hidden = false;
    lbRenderStep(true);
    scrollPanelTop();
  }
  /** "Continuar": back into the lesson that was left half way (same step). */
  function lbResume() {
    var L = LESSONS[LB.idx];
    if (!L) return;
    if (!navOn() || mode !== 'basico') { lbShowRaw(); return; }
    navDetail('detail', 'basico/' + L.id, lbShowRaw);
  }
  function lbShowRaw() {
    if (!LESSONS[LB.idx]) return;
    LB.open = true;
    LB.listView.hidden = true;
    LB.lessonView.hidden = false;
    lbRenderStep(!LB.finished);
    scrollPanelTop();
  }

  /* --- exterior movements: automatic animation or held poses (contract v3: Core.poseExterior / ext.pose) --- */
  // Fallback while the pose API is missing: play the closest classic animation (looped) so no button is dead.
  var POSE_FALLBACK_ANIM = {
    nivelado: 'four-forces', ascenso: 'four-forces', descenso: 'four-forces',
    'alabeo-izq': 'axes-roll', 'alabeo-der': 'axes-roll', 'cabeceo-arriba': 'axes-pitch', 'cabeceo-abajo': 'axes-pitch',
    'guinada-izq': 'axes-yaw', 'guinada-der': 'axes-yaw', 'motor-on': 'propeller-throttle', 'motor-off': 'propeller-throttle',
    'potencia-max': 'propeller-throttle', 'potencia-ralenti': 'propeller-throttle', 'flaps-0': 'flaps-extend',
    'flaps-10': 'flaps-extend', 'flaps-20': 'flaps-extend', 'flaps-40': 'flaps-extend', 'viraje-izq': 'coordinated-turn',
    'viraje-der': 'coordinated-turn', perdida: 'aoa-stall', 'carreteo-izq': 'ground-steering', 'carreteo-der': 'ground-steering',
    'compensador-arriba': 'trim-tab', 'compensador-abajo': 'trim-tab'
  };
  function extObj() { var c = Core(); return (c && (c.exterior || c.ext)) || null; }
  function poseSupported() { if (has('poseExterior')) return true; var e = extObj(); return !!(e && isFn(e.pose)); }
  function poseExterior(name) {
    if (has('poseExterior')) return cc('poseExterior', name);
    var e = extObj();
    if (e && isFn(e.pose)) return safe(function () { return e.pose(name); }, 'ext.pose');
    return undefined;
  }
  function clearExteriorPose() {
    if (has('clearPose')) { cc('clearPose'); return; }
    var e = extObj();
    if (e && isFn(e.clearPose)) safe(function () { e.clearPose(); }, 'ext.clearPose');
  }

  /* lessons use 'Las dos' (cockpit + exterior side by side) on desktop, so the student sees the cockpit react */
  function lbWide() { var vp = $('viewport'); return !cc('isMobile') && !!vp && vp.clientWidth >= 700; }
  function lbEnterLayout() {
    if (LB.layoutBefore === null && !LB.userChose) LB.layoutBefore = layoutMode;   // given back when the lesson ends
    if (LB.layoutForced || LB.userChose || !canDos() || !lbWide() || layoutMode === 'dos') return;
    LB.layoutForced = true;
    applyLayout('dos');
  }
  function lbExitLayout() {
    var back = LB.layoutBefore, chose = LB.userChose;
    LB.layoutBefore = null; LB.layoutForced = false; LB.userChose = false;
    if (chose || !back) return;                 // the student picked a layout during the lesson: keep it
    if (layoutMode !== back) applyLayout(back);
  }
  /** Main view for a step when there is no 'dos' (phones): exterior steps show the airplane big + cockpit inset. */
  function lbView(p, enlarged) {
    if (layoutMode === 'dos') return;
    if (p.vista === 'exterior') { if (!enlarged) cc('setMainView', 'exterior'); }
    else cc('setMainView', 'cockpit');
  }

  function lbRun(p) {
    if (!p) return;
    navClearLook();
    lbEnterLayout();
    var foco = p.foco && CTRL[p.foco] ? p.foco : null;
    // a movement seen from outside: the cockpit frames the horizon, the flight instruments and the yoke together
    // ("así se ve desde adentro"); a cockpit step goes to its control. A selection left over from another tab
    // (its callout) would cover the picture, so it is cleared.
    var inside = p.vista === 'exterior' || (!foco && arr(p.acciones).length > 0);
    if (CO.selId && CO.selId !== foco) cc('select', null);
    if (inside) cc('focusPreset', 'inside', { keepView: true });
    else if (foco) focusControl(foco, true);
    cc('setTargetHighlight', foco);
    lbAuto(p);
  }
  /** "Automático": the step's own animation (optionally looped). */
  function lbAuto(p) {
    p = p || lbStep();
    if (!p) return;
    LB.pose = null;
    LB.poseCaption = '';
    clearExteriorPose();
    var enlarge = layoutMode !== 'dos' && p.vista === 'exterior';
    var played = p.anim ? cc('playExterior', p.anim, { enlarge: enlarge, loop: !!LB.loop }) : cc('playExterior', null);
    LB.auto = !!p.anim && played !== false;
    lbView(p, enlarge && LB.auto);
    syncMainView();
    lbSyncActions();
    if (LB.open) lbAir(p);
    kick();
  }
  /** Action button: hold that movement (pose) until another one or "Automático". */
  function lbPose(p, a) {
    if (!a || !a.pose) return;
    LB.auto = false;
    LB.pose = a.pose;
    cc('playExterior', null);
    lbView(p, false);
    var cap;
    if (poseSupported()) cap = poseExterior(a.pose);
    else {
      var anim = POSE_FALLBACK_ANIM[a.pose] || p.anim;
      if (anim) cc('playExterior', anim, { enlarge: false, loop: true });
    }
    LB.poseCaption = typeof cap === 'string' ? cap : '';
    syncMainView();
    lbSyncActions();
    lbAir(p);
    kick();
  }
  function lbStep() { var L = LESSONS[LB.idx]; return L ? arr(L.pasos)[LB.i] || null : null; }
  function lbSyncActions() {
    LB.actBtns.forEach(function (x) { setAttr(x.b, 'aria-pressed', x.pose === LB.pose ? 'true' : 'false'); });
    if (LB.autoBtn) setAttr(LB.autoBtn, 'aria-pressed', LB.auto ? 'true' : 'false');
    if (LB.loopBtn) setAttr(LB.loopBtn, 'aria-checked', LB.loop ? 'true' : 'false');
    if (LB.airBtn) setAttr(LB.airBtn, 'aria-checked', LB.air ? 'true' : 'false');
  }
  /* "El aire" in the lessons about the air (data: pasos[].aire = { flujo, fuerzas, giros, foco }): the flow, the force
   * arrows (kg) and the moment arcs on the exterior airplane while the step's movement plays; "Ver el aire" turns it
   * off (remembered). The flow uses the mirrored sim state, so it is the real air of the movement being shown. */
  function lbAir(p) {
    var a = p && p.aire;
    if (!a || !LB.air || !has('setAirflow') || mode !== 'basico') { lbAirOff(); return; }
    // while "Automático" plays, the animation's own overlays (force arrows, angle-of-attack arc) explain: the flow then
    // only draws the air; a held pose gets the live force arrows and the pressure tint
    var f = !!a.fuerzas && !LB.auto;
    cc('setAirflow', { enabled: true, streamlines: a.flujo !== false, propwash: true, vortices: a.flujo !== false,
      pressure: f, forces: f, moments: !!a.giros, trails: false });
    var fl = Core() && Core().airflow;
    if (fl && isFn(fl.focus)) safe(function () { fl.focus(a.foco || null); }, 'airflow.focus');
    LB.airOn = true;
  }
  function lbAirOff() {
    if (!LB.airOn) return;
    LB.airOn = false;
    cc('setAirflow', { enabled: false, forces: false, moments: false, pressure: false });
    var fl = Core() && Core().airflow;
    if (fl && isFn(fl.focus)) safe(function () { fl.focus(null); }, 'airflow.focus');
  }
  function lbLeave() {
    LB.pose = null; LB.auto = false; LB.poseCaption = '';
    lbAirOff();
    clearExteriorPose();
    cc('playExterior', null);
    lbExitLayout();
    cc('setTargetHighlight', null);
    syncMainView();
  }

  /** Kit callout (icon + title + text) with a plain fallback. */
  function callK(variant, title, text) {
    var K = C150.Kit;
    if (K && isFn(K.callout)) return K.callout({ variant: variant, title: title, text: text });
    return h('aside', { class: 'callout callout--' + variant }, h('h3', { class: 'placard', text: title }), h('p', { text: text }));
  }

  function lbActions(p) {
    var acts = arr(p.acciones).filter(function (a) { return a && a.pose && a.etiqueta; });
    LB.actBtns = []; LB.autoBtn = null; LB.loopBtn = null; LB.airBtn = null;
    if (!acts.length && !p.anim) return null;
    var grid = h('div', { class: 'lb-act-grid', role: 'group', 'aria-label': 'Movimientos del avión' });
    acts.forEach(function (a) {
      var b = h('button', { type: 'button', class: 'btn lb-act', 'aria-pressed': 'false', onclick: function () { lbPose(p, a); } }, a.etiqueta);
      LB.actBtns.push({ b: b, pose: a.pose });
      grid.appendChild(b);
    });
    var play = null;
    if (p.anim) {
      LB.autoBtn = h('button', { type: 'button', class: 'btn lb-auto', 'aria-pressed': 'false', onclick: function () { lbAuto(p); } }, kic('play'), 'Automático');
      LB.loopBtn = h('button', {
        type: 'button', class: 'lb-loop', role: 'switch', 'aria-checked': 'false',
        onclick: function () { LB.loop = !LB.loop; store.set('lessonLoop', LB.loop); if (LB.auto) lbAuto(p); else lbSyncActions(); }
      }, h('span', { class: 'lb-loop-track', 'aria-hidden': 'true' }), 'Repetir sin parar');
      play = h('div', { class: 'lb-play', role: 'group', 'aria-label': 'Animación automática' },
        h('span', { class: 'lb-play-k', text: 'Que lo haga solo' }), h('div', { class: 'lb-play-row' }, LB.autoBtn, LB.loopBtn));
    }
    var air = null;
    if (p.aire && has('setAirflow')) {
      LB.airBtn = h('button', {
        type: 'button', class: 'lb-loop lb-air', role: 'switch', 'aria-checked': LB.air ? 'true' : 'false',
        title: 'Muestra el aire alrededor del avión: líneas de flujo, fuerzas y giros',
        onclick: function () { LB.air = !LB.air; store.set('lessonAir', LB.air); lbAir(p); lbSyncActions(); }
      }, h('span', { class: 'lb-loop-track', 'aria-hidden': 'true' }), 'Ver el aire');
      air = h('div', { class: 'lb-airrow' }, LB.airBtn, h('span', { class: 'lb-air-d', text: 'Dibuja el aire que pasa por el avión.' }));
    }
    return h('section', { class: 'lb-actions', 'aria-label': 'Probá el movimiento' },
      h('p', { class: 'lb-actions-title' }, h('span', { text: 'Probá el movimiento' }),
        acts.length ? h('small', { text: 'Tocá un botón: el avión lo hace y se queda así, para que lo mires con calma.' }) : null),
      acts.length ? grid : null, play, air);
  }

  function lbLabTitle(id) {
    var xs = arr(DATA.labExperiments);
    for (var i = 0; i < xs.length; i++) if (xs[i] && xs[i].id === id) return xs[i].titulo || id;
    return null;
  }
  /** "Seguí con…" after a lesson: the next one not done yet, the matching AIRE experiment, then the next area of the path. */
  function lbSuggestions(L) {
    var out = [], ni = -1, k;
    for (k = LB.idx + 1; k < LESSONS.length; k++) if (LB.done.indexOf(LESSONS[k].id) < 0) { ni = k; break; }
    if (ni < 0) for (k = 0; k < LESSONS.length; k++) if (k !== LB.idx && LB.done.indexOf(LESSONS[k].id) < 0) { ni = k; break; }
    if (ni >= 0) {
      out.push({ primary: true, icon: 'book', title: 'Lección: ' + (LESSONS[ni].titulo || ''), text: lessonMin(LESSONS[ni]) + ' min · ' + DIFF_TXT[lessonLevel(LESSONS[ni])].toLowerCase(),
        onClick: function () { lbOpen(ni); } });
    }
    var exp = LESSON_LAB[L && L.id], et = exp && labOk() ? lbLabTitle(exp) : null;
    if (et) out.push({ icon: 'wind', title: 'Probalo en el Aire', text: 'Experimento: ' + et, onClick: function () { UI.openLab(exp); sheetEnsure('half'); } });
    if (ni < 0) {
      out.push({ primary: true, icon: 'checklist', title: 'Checklist “Antes de arrancar”', text: 'Practicá los pasos de verdad, en la cabina 3D', onClick: function () { openChecklist('antes-arrancar'); } });
      out.push({ icon: 'quiz', title: 'Quiz rápido', text: 'Probá lo que aprendiste', onClick: function () { navOpen('quiz'); } });
    }
    return out;
  }

  /** The AIRE runner (Kit .runner): kicker + count, ✕, progress bar, big step title and text. The caller appends actions, "Mirá:", nav and dots. */
  function runnerEl(o) {
    return h('article', { class: 'runner ' + (o.cls || ''), 'aria-labelledby': o.titleId },
      h('div', { class: 'runner-top' },
        h('p', { class: 'runner-kicker' }, h('span', { text: o.kicker }), h('span', { class: 'runner-count', text: o.count })),
        h('button', { type: 'button', class: 'icon-btn icon-btn--small runner-close', 'aria-label': o.closeLabel, title: o.closeLabel, onclick: o.onClose }, kic('close'))),
      h('div', { class: 'runner-prog', 'aria-hidden': 'true' }, h('span', { style: { width: (clamp(o.frac, 0, 1) * 100).toFixed(1) + '%' } })),
      h('h2', { class: 'runner-title', id: o.titleId, tabindex: '-1', text: o.title }),
      o.text ? h('p', { class: 'runner-text step-text', text: o.text }) : null);
  }
  /** One dot per step (the current one is a wide orange pill, the seen ones are dark). */
  function runnerDots(n, cur, seen, onGo, label, titles) {
    var w = h('div', { class: 'runner-dots', role: 'group', 'aria-label': label });
    for (var k = 0; k < n; k++) {
      (function (k) {
        w.appendChild(h('button', {
          type: 'button', class: 'runner-dot' + (k !== cur && seen && seen[k] ? ' is-seen' : ''), 'aria-current': k === cur ? 'step' : null,
          'aria-label': 'Ir al paso ' + (k + 1) + (titles && titles[k] ? ': ' + titles[k] : ''), onclick: function () { onGo(k); }
        }));
      })(k);
    }
    return w;
  }
  /** "Mirá: …" callout of the runner (eye icon, sky-blue edge). */
  function runnerMira(text) {
    return text ? h('p', { class: 'runner-mira' }, kic('eye'), h('span', null, h('strong', { text: 'Mirá: ' }), text)) : null;
  }

  function lbRenderStep(run) {
    var v = LB.lessonView, L = LESSONS[LB.idx];
    clear(v);
    LB.actBtns = []; LB.autoBtn = null; LB.loopBtn = null; LB.nowEl = null;
    if (!L) return;
    var pasos = arr(L.pasos), n = pasos.length;
    if (LB.finished) {
      v.appendChild(doneCard({
        id: 'lb-done-title', kicker: 'Lección terminada', title: L.titulo || '¡Lección terminada!',
        text: 'Muy bien: completaste ' + n + (n === 1 ? ' paso.' : ' pasos.') + ' Si querés, repetila: las animaciones se entienden mejor la segunda vez.',
        suggestions: lbSuggestions(L),
        actions: [h('button', { type: 'button', class: 'btn', onclick: function () { lbOpen(LB.idx); } }, icon('retry'), 'Repetir'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: lbBack }, 'Todas las lecciones')]
      }));
      return;
    }
    var p = pasos[LB.i] || {};
    var foco = p.foco && CTRL[p.foco] ? p.foco : null;
    var moves = p.vista === 'exterior' || arr(p.acciones).length > 0;
    var hint = moves
      ? (lbWide() && canDos() ? (dosSideBySide() ? 'a la izquierda, la cabina: así se ve desde adentro; a la derecha, el avión desde afuera.'
        : 'arriba, la cabina: así se ve desde adentro; abajo, el avión desde afuera.')
        : 'ves el avión desde afuera; el cuadrito muestra cómo se ve desde adentro: volante, horizonte e instrumentos.')
      : '';
    if (foco) hint += (hint ? ' ' : '') + 'En la cabina, lo que titila es ' + ctrlName(foco) + '.';
    var last = LB.i >= n - 1;
    var titleId = 'lb-step-title';
    LB.nowEl = h('p', { class: 'lb-now', hidden: true }, h('span', { class: 'lb-now-k', text: 'Ahora' }), h('span', { class: 'lb-now-t' }));
    var R = runnerEl({ cls: 'lb-runner', titleId: titleId, kicker: 'Lección L' + (LB.idx + 1) + ' · ' + (L.titulo || ''), count: (LB.i + 1) + ' / ' + n,
      closeLabel: 'Volver a la lista de lecciones', onClose: lbBack, frac: (LB.i + 1) / n, title: p.titulo || '', text: p.texto });
    [lbActions(p), LB.nowEl, runnerMira(hint)].forEach(function (x) { if (x) R.appendChild(x); });
    if (foco) {
      R.appendChild(h('div', { class: 'runner-links' },
        h('button', { type: 'button', class: 'btn btn--small', onclick: function () { lookAtControl(foco); } }, kic('target'), 'Mostrámelo en 3D'),
        h('button', { type: 'button', class: 'btn btn--small', onclick: function () { UI.showControl(foco); } }, kic('cabin'), 'Ver la ficha: ' + ctrlName(foco))));
    }
    R.appendChild(h('div', { class: 'runner-nav' },
      h('button', { type: 'button', class: 'btn', disabled: LB.i === 0, onclick: function () { lbGo(LB.i - 1); } }, icon('back'), 'Anterior'),
      last
        ? h('button', { type: 'button', class: 'btn btn--primary', onclick: lbFinish }, 'Terminar la lección', icon('check'))
        : h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { lbGo(LB.i + 1); } }, 'Siguiente', icon('next'))));
    R.appendChild(runnerDots(n, LB.i, LB.seen, lbGo, 'Pasos de la lección', pasos.map(function (x) { return x && x.titulo; })));
    v.appendChild(R);
    if (run) lbRun(p);
    else lbSyncActions();
    glossText(v, '.step-text, .callout-body, .lb-actions-title small, .runner-mira > span');
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
    var dt = $('lb-done-title');
    if (dt) safe(function () { dt.focus({ preventScroll: true }); });
  }
  /** "Lecciones" button / UP: back to the list. A lesson half done stays in progress ("Continuar"); a finished one is closed. */
  function lbBack() {
    var n = NAV();
    if (navOn() && n && isFn(n.up) && n.up()) return;
    lbBackRaw();
  }
  function lbBackRaw() {
    lbLeave();
    if (LB.finished) LB.idx = -1;
    LB.open = false;
    LB.lessonView.hidden = true;
    LB.listView.hidden = false;
    lbRenderList();
    scrollPanelTop();
  }
  /** "Dejar esta lección": forget the progress of the lesson in progress. */
  function lbExit() {
    LB.idx = -1; LB.finished = false;
    if (LB.open) lbBackRaw(); else { lbRenderList(); kick(); }
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
      if (LB.open && !LB.finished) { var L = LESSONS[LB.idx]; if (L) lbRun(arr(L.pasos)[LB.i]); }
    },
    exit: function () { if (LB.idx >= 0) lbLeave(); },
    slow: function () {
      if (!LB.nowEl) return;
      var t = getCaption() || LB.poseCaption || '';
      LB.nowEl.hidden = !t;
      setText(LB.nowEl.querySelector('.lb-now-t'), t);
    }
  };
  /** An exterior animation ended on its own (not looped): "Automático" is no longer running. */
  function onAnimEnd() { if (LB.auto) { LB.auto = false; lbSyncActions(); if (LB.open && mode === 'basico') lbAir(lbStep()); } }

  /* ================================================================== RECORRIDO (tour guiado) */

  var TOUR = arr(DATA.tour).filter(function (t) { return t && t.control; });
  var TR = { view: null, secOpen: false, i: clamp(num(store.get('tourStep', 0), 0), 0, Math.max(0, TOUR.length - 1)), finished: false };

  function trFocus(isLook) {
    if (isLook !== true) navClearLook();
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
    progTouch('recorrido', 'tour', { paso: TR.i });
    trRender();
    trFocus();
    var t = $('tr-title');
    if (t) safe(function () { t.focus({ preventScroll: true }); });
  }
  function trRender() {
    var v = TR.view, K = C150.Kit;
    clear(v);
    v.appendChild(modeHead('Recorrido guiado', 'Tu primer día en la cabina: un paseo control por control, en el orden en que los vas a usar. En cada paso el control titila en el 3D.'));
    if (!TOUR.length) { v.appendChild(emptyState('El recorrido todavía no está cargado.')); return; }
    var n = TOUR.length;
    if (TR.finished) {
      var nl = firstUndone(LESSONS, 'leccion');
      v.appendChild(doneCard({
        id: 'tr-done-title', kicker: 'Recorrido completo', title: '¡Ya conocés la cabina!',
        text: 'Pasaste por los ' + n + ' puntos de la cabina. Ahora toca entender por qué vuela el avión, y después practicar los pasos.',
        suggestions: [
          { primary: true, icon: 'book', title: nl >= 0 ? 'Lección: ' + (LESSONS[nl].titulo || '') : 'Lecciones', text: 'Cómo vuela un avión, paso a paso', onClick: function () { if (nl >= 0) lbOpen(nl); else navOpen('basico'); } },
          { icon: 'checklist', title: 'Checklist “Antes de arrancar”', text: 'Los primeros pasos antes de prender el motor', onClick: function () { openChecklist('antes-arrancar'); } }
        ],
        actions: [h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () { trGo(0); } }, icon('retry'), 'Empezar de nuevo')]
      }));
      var tt = $('tr-done-title');
      if (tt && mode === 'recorrido') safe(function () { tt.focus({ preventScroll: true }); });
      return;
    }
    var st = TOUR[TR.i], c = CTRL[st.control];
    var last = TR.i >= n - 1;
    var R = runnerEl({ cls: 'tr-runner', titleId: 'tr-title', kicker: 'Paso R' + (TR.i + 1) + (c ? ' · ' + c.nombre : ''), count: (TR.i + 1) + ' / ' + n,
      closeLabel: 'Volver al principio del recorrido', onClose: function () { trGo(0); }, frac: (TR.i + 1) / n, title: st.titulo || (c ? c.nombre : ''), text: st.texto });
    if (c) {
      R.appendChild(runnerMira('el control titila en la cabina. Si lo perdés de vista, tocá “Mostrámelo de nuevo” y la cámara va hacia él.'));
      R.appendChild(h('div', { class: 'runner-links' },
        h('button', { type: 'button', class: 'btn btn--small', onclick: function () { navLook(function () { trFocus(true); }, c.nombre); } }, kic('target'), 'Mostrámelo de nuevo'),
        h('button', { type: 'button', class: 'btn btn--small', onclick: function () { UI.showControl(st.control); } }, 'Más detalles', icon('next'))));
    }
    R.appendChild(h('div', { class: 'runner-nav' },
      h('button', { type: 'button', class: 'btn', disabled: TR.i === 0, onclick: function () { trGo(TR.i - 1); } }, icon('back'), 'Anterior'),
      last
        ? h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { TR.finished = true; progMark('recorrido', 'tour'); store.set('tourStep', 0); trRender(); trFocus(); } }, 'Terminar el recorrido', icon('check'))
        : h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { trGo(TR.i + 1); } }, 'Siguiente', icon('next'))));
    v.appendChild(R);
    // every step as a card: jump straight to any control of the walk
    var items = TOUR.map(function (x, j) {
      var cj = CTRL[x.control];
      return { code: 'R' + (j + 1), title: x.titulo || (cj ? cj.nombre : ''), sum: cj ? cj.nombre : '', meta: j < TR.i ? 'visto' : (j === TR.i ? 'estás acá' : 'por ver'),
        current: j === TR.i, onClick: function () { trGo(j); } };
    });
    var cards = K.cardCarousel({ items: items, label: 'Todos los pasos del recorrido' });
    for (var m = 0; m < TR.i; m++) cardDone(cards, m);
    v.appendChild(K.section({ num: 'PA', title: 'Todos los pasos', meta: n + ' controles', open: !!TR.secOpen, body: cards, key: 'pasos',
      onToggle: function (o) { TR.secOpen = o; } }));
    glossText(v, '.step-text, .callout-body, .runner-mira > span', { control: st.control });
  }

  modeImpl.recorrido = {
    render: function (sec) { TR.view = h('div'); sec.appendChild(TR.view); trRender(); },
    enter: function () { trFocus(); },
    exit: function () { cc('setTargetHighlight', null); }
  };

  /* ================================================================== CHECKLISTS */

  var CHECKLISTS = arr(DATA.checklists).filter(function (c) { return c && arr(c.items).length; });
  var CL = { listView: null, runView: null, announce: null, cur: null, open: false, live: [], lastDone: null, doneIds: arr(store.get('checklistsDone', [])) };

  function splitItem(t) {
    t = String(t || '');
    var m = t.split(/\s+[—–]\s+/);
    return m.length >= 2 ? [m[0], m.slice(1).join(' — ')] : [t, ''];
  }

  function clMin(cl) { return Math.max(2, Math.round(arr(cl.items).length * 0.5)); }
  /* v5 · V3 — Checklists con el lenguaje de AIRE: secciones numeradas por momento del vuelo, tarjetas con código (C1…) y el "runner" */
  var CL_PHASES = [
    { title: 'Antes de despegar', ids: ['antes-arrancar', 'arranque', 'prueba-motor'] },
    { title: 'Aterrizar y cerrar', ids: ['antes-aterrizar', 'apagado'] }
  ];
  function clMeta(cl) { var n = arr(cl.items).length; return n + (n === 1 ? ' paso' : ' pasos') + ' · ' + clMin(cl) + ' min'; }
  function clRenderList() {
    var v = CL.listView, K = C150.Kit;
    clear(v);
    v.appendChild(modeHead('Checklists', 'Una checklist es la lista de pasos que el piloto repite siempre, en el mismo orden, para no olvidarse de nada. Acá la hacés de verdad en la cabina 3D: cada paso se tilda solo cuando lo hacés bien.'));
    if (!CHECKLISTS.length) { v.appendChild(emptyState('Las checklists todavía no están cargadas.')); return; }
    if (CL.cur && !CL.cur.finished && !CL.open) {
      v.appendChild(continueRow({ icon: 'checklist', title: 'Checklist «' + (CL.cur.cl.titulo || '') + '»',
        text: CL.cur.done.filter(Boolean).length + ' de ' + arr(CL.cur.cl.items).length + ' ítems hechos', onResume: clResume, onExit: clExit,
        exitLabel: 'Dejar esta checklist', confirm: CL.cur.done.filter(Boolean).length ? 'Si la dejás, vas a perder los ítems que ya hiciste. ¿La dejamos?' : '' }));
    }
    var doneN = CHECKLISTS.filter(function (c) { return CL.doneIds.indexOf(c.id) >= 0; }).length;
    var nextIdx = -1;
    for (var q = 0; q < CHECKLISTS.length; q++) if (CL.doneIds.indexOf(CHECKLISTS[q].id) < 0) { nextIdx = q; break; }
    v.appendChild(h('div', { class: 'lc-prog' }, pgBar(doneN / CHECKLISTS.length, doneN + ' de ' + CHECKLISTS.length + ' hechas', doneN === CHECKLISTS.length)));
    // sections = moments of the flight; a checklist that is not listed in CL_PHASES goes with the last group
    var groups = CL_PHASES.map(function (p) {
      return { title: p.title, idx: CHECKLISTS.map(function (c, i) { return p.ids.indexOf(c.id) >= 0 ? i : -1; }).filter(function (i) { return i >= 0; }) };
    }).filter(function (g) { return g.idx.length; });
    var listed = {};
    groups.forEach(function (g) { g.idx.forEach(function (i) { listed[i] = true; }); });
    var rest = CHECKLISTS.map(function (c, i) { return i; }).filter(function (i) { return !listed[i]; });
    if (rest.length) { if (groups.length) groups[groups.length - 1].idx = groups[groups.length - 1].idx.concat(rest); else groups.push({ title: 'Checklists', idx: rest }); }
    groups.forEach(function (g, gi) {
      var items = g.idx.map(function (i) {
        var cl = CHECKLISTS[i], running = !!(CL.cur && !CL.cur.finished && CL.cur.idx === i);
        return { code: 'C' + (i + 1), title: cl.titulo || cl.id, sum: cl.descripcion || '', meta: clMeta(cl), current: running,
          tag: running ? 'En curso' : (i === nextIdx ? (CL.doneIds.length ? 'Siguiente' : 'Empezá acá') : null), onClick: function () { clOpen(i); } };
      });
      var ul = K.cardCarousel({ items: items, list: true, label: 'Checklists: ' + g.title.toLowerCase() });
      var hechas = 0;
      g.idx.forEach(function (i, k) {
        if (CL.doneIds.indexOf(CHECKLISTS[i].id) >= 0) { hechas++; cardDone(ul, k); }
        else if (CL.cur && !CL.cur.finished && CL.cur.idx === i) cardBar(ul, k, CL.cur.done.filter(Boolean).length / Math.max(1, arr(CL.cur.cl.items).length), 'Ítems hechos');
      });
      v.appendChild(secK(gi + 1, g.title, hechas + '/' + g.idx.length + ' hechas', ul, 'cl-g' + gi));
    });
    v.appendChild(acc('¿Por qué los pilotos usan checklists?', h('div', null,
      h('p', { text: 'Porque la memoria falla, incluso con mucha experiencia. Una lista escrita asegura que cada vuelo empiece igual y que no se salte nada importante, como sacar la traba de comandos o abrir la válvula de nafta.' }),
      h('p', { text: 'Se lee un ítem, se hace, se verifica, y recién entonces se pasa al siguiente. Eso es justo lo que practicás acá.' })), { icon: 'bulb' }));
    v.appendChild(callK('cuidado', 'Para practicar', 'Estas listas siguen el manual del avión (POH del 150M). En el avión de verdad manda siempre la checklist de tu escuela y tu instructor.'));
    glossText(v, '.mode-sub, .acc-body, .callout-body');
  }

  /** User-level: list → run is a detail entry (UP == Back); from another tab it is an ABRIR. */
  function clOpen(idx, forceFresh) {
    var cl = CHECKLISTS[idx];
    if (!cl) return;
    if (!navOn()) { if (mode !== 'checklists') setMode('checklists'); clOpenRaw(idx, forceFresh); return; }
    if (mode !== 'checklists') { navOpen('checklists/' + cl.id); return; }
    navDetail('detail', 'checklists/' + cl.id, function () { clOpenRaw(idx, forceFresh); });
  }
  function clOpenRaw(idx, forceFresh) {
    var cl = CHECKLISTS[idx];
    if (!cl) return;
    if (!CL.listView) { setMode('checklists'); if (!CL.listView) return; }
    if (!forceFresh && CL.cur && CL.cur.idx === idx && !CL.cur.finished) { clShowRaw(); return; }   // the run in progress: go on where it was
    var carry = !forceFresh && !!cl.continuaDe && CL.lastDone === cl.continuaDe;
    if (!carry && cl.preset) applyPreset(cl.preset);
    progTouch('checklist', cl.id);
    CL.cur = { cl: cl, idx: idx, done: arr(cl.items).map(function () { return false; }), i: 0, finished: false, carried: carry, skipped: 0 };
    CL.open = true;
    CL.listView.hidden = true;
    CL.runView.hidden = false;
    clRenderRun();
    clFocusCurrent();
    scrollPanelTop();
    setText(CL.announce, 'Checklist ' + (cl.titulo || '') + ': ' + arr(cl.items).length + ' ítems.');
  }

  /** "Checklists" button / UP: back to the list. A run half done stays in progress ("Continuar"); a finished one is closed. */
  function clBack() {
    var n = NAV();
    if (navOn() && n && isFn(n.up) && n.up()) return;
    clBackRaw();
  }
  function clBackRaw() {
    releaseAllHolds();
    if (CL.cur && CL.cur.finished) CL.cur = null;
    CL.live = [];
    CL.open = false;
    cc('setTargetHighlight', null);
    CL.runView.hidden = true;
    CL.listView.hidden = false;
    clRenderList();
    scrollPanelTop();
  }
  /** "Continuar": back into the run that was left half way. */
  function clResume() {
    if (!CL.cur) return;
    if (!navOn() || mode !== 'checklists') { clShowRaw(); return; }
    navDetail('detail', 'checklists/' + CL.cur.cl.id, clShowRaw);
  }
  function clShowRaw() {
    if (!CL.cur) return;
    CL.open = true;
    CL.listView.hidden = true;
    CL.runView.hidden = false;
    clRenderRun();
    clFocusCurrent();
    scrollPanelTop();
  }
  /** "Dejar esta checklist": forget the progress of the run in progress. */
  function clExit() {
    CL.cur = null;
    if (CL.open) clBackRaw(); else { clRenderList(); kick(); }
  }

  /** Highlights the current item's control and flies the camera to it — never while the student is still moving
   *  something (that was the bug: the camera and the 3D drag jumped to the next control mid-drag). */
  function clFocusCurrent(isLook) {
    if (isLook !== true) navClearLook();
    whenIdle(function () {
      var cur = CL.cur;
      if (mode !== 'checklists' || !CL.open) return;
      if (!cur || cur.finished) { cc('setTargetHighlight', null); return; }
      var it = cur.cl.items[cur.i];
      var id = it && CTRL[it.control] ? it.control : null;
      cc('setTargetHighlight', id);
      if (id) {
        if (mainView === 'exterior' && layoutMode !== 'dos') { cc('setMainView', 'cockpit'); syncMainView(); }
        focusControl(id, true);
      }
    }, 'clFocus');
  }

  /** A finished (or skipped) item as a quiet row: tick, name, what it asked for. */
  function clDoneRow(it, k, cur) {
    var parts = splitItem(it.texto), skip = cur.done[k] === 'skip';
    return h('li', { class: 'stp-row' + (skip ? ' is-skip' : '') + (k === cur.justDone ? ' is-just-done' : '') },
      h('span', { class: 'stp-tick', 'aria-hidden': 'true' }, skip ? kic('minus') : kic('check')),
      h('span', { class: 'stp-row-l', text: parts[0] }),
      parts[1] ? h('span', { class: 'stp-row-r', text: parts[1] }) : null,
      h('span', { class: 'sr-only', text: skip ? ' (salteado)' : ' (hecho)' }));
  }
  function clTodoRow(it, k) {
    var parts = splitItem(it.texto);
    return h('li', { class: 'stp-row is-todo' },
      h('span', { class: 'stp-tick stp-tick--n', 'aria-hidden': 'true', text: String(k + 1) }),
      h('span', { class: 'stp-row-l', text: parts[0] }),
      parts[1] ? h('span', { class: 'stp-row-r', text: parts[1] }) : null);
  }

  /** What each control reads as a live bar: [label, fraction 0..1, words]. The ones that are not here only get the readout (ctrlLiveValue). */
  function pctWord(s, f) { return Math.round(f * 100) + ' %'; }
  var CL_BAR = {
    throttle: ['Potencia', function (s) { return num(s.throttle, 0); }, pctWord],
    mixture: ['Mezcla', function (s) { return num(s.mixture, 0); }, function (s, f) { return f < 0.04 ? 'Corte' : (f > 0.96 ? 'Rica' : pctWord(s, f)); }],
    'carb-heat': ['Calor', function (s) { return num(s.carbHeat, 0); }, function (s, f) { return f < 0.04 ? 'Fría' : (f > 0.96 ? 'Caliente' : pctWord(s, f)); }],
    'trim-wheel': ['Compens.', function (s) { return (num(s.trim, 0) + 1) / 2; }, function (s) { return fmtSigned(num(s.trim, 0), 2); }],
    'flap-switch': ['Flaps', function (s) { return num(s.flaps, 0) / 40; }, function (s) { return Math.round(num(s.flaps, 0)) + '°'; }],
    'flap-indicator': ['Flaps', function (s) { return num(s.flaps, 0) / 40; }, function (s) { return Math.round(num(s.flaps, 0)) + '°'; }],
    'cabin-heat': ['Apertura', function (s) { return num(s.cabinHeat, 0); }, pctWord],
    'cabin-air': ['Apertura', function (s) { return num(s.cabinAir, 0); }, pctWord],
    tachometer: ['Vueltas', function (s) { return num((s.engine || {}).rpm, 0) / 3000; }, function (s) { return Math.round(num((s.engine || {}).rpm, 0) / 10) * 10 + ''; }],
    asi: ['Velocidad', function (s) { return Math.max(0, num((s.air || {}).ias, 0)) / 160; }, function (s) { return Math.round(Math.max(0, num((s.air || {}).ias, 0))) + ' kt'; }],
    'parking-brake': ['Freno', function (s) { return s.parkingBrake ? 1 : 0; }, function (s) { return s.parkingBrake ? 'Puesto' : 'Suelto'; }],
    'control-lock': ['Traba', function (s) { return s.controlLock ? 1 : 0; }, function (s) { return s.controlLock ? 'Puesta' : 'Sacada'; }],
    'fuel-shutoff': ['Válvula', function (s) { return s.fuelValve ? 1 : 0; }, function (s) { return s.fuelValve ? 'Abierta' : 'Cerrada'; }]
  };
  /** "Ahora": the live value of the control this item is about, big, and as an AIRE bar when it is a position. null when there is nothing to read. */
  function clMeter(id, live) {
    var s0 = S(), K = C150.Kit, spec = CL_BAR[id];
    if (!s0 || (!spec && !ctrlLiveValue(id, s0))) return null;
    var read = h('output', { class: 'cl-now-v' });
    var bars = spec && K && isFn(K.bars) ? K.bars({ rows: [{ key: 'v', label: spec[0], color: 'var(--accent)' }] }) : null;
    live.push(function (s) {
      setText(read, ctrlLiveValue(id, s) || '—');
      if (bars) { var f = clamp(num(spec[1](s), 0), 0, 1); bars.set('v', f, spec[2](s, f)); }
    });
    return h('div', { class: 'cl-now', role: 'group', 'aria-label': 'Cómo está ahora' },
      h('p', { class: 'cl-now-k' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Ahora está'), read, bars);
  }
  /** One-line cue under the title ("Hacelo: …" / "Ojo: …"), same family as the runner's "Mirá:". */
  function clCue(iconName, label, text) {
    return h('p', { class: 'runner-mira cl-hint' }, kic(iconName), h('span', null, h('strong', { text: label + ' ' }), text));
  }

  /** The current item as the AIRE runner: kicker, count, progress, the item as a big title, "Dejalo en" pill, live reading, actions. */
  function clRunner(cur) {
    var cl = cur.cl, n = arr(cl.items).length, it = cl.items[cur.i] || {}, parts = splitItem(it.texto), c = CTRL[it.control], auto = isFn(it.check);
    var doneN = cur.done.filter(Boolean).length;
    var okEl = auto ? h('p', { class: 'cl-ok', hidden: true, role: 'status' }, icon('check'), h('span', { class: 'cl-ok-text' })) : null;
    CL.okEl = okEl;
    var R = runnerEl({ cls: 'cl-runner', titleId: 'stp-name', kicker: 'Checklist C' + (cur.idx + 1) + ' · ' + (cl.titulo || ''), count: (cur.i + 1) + ' / ' + n,
      closeLabel: 'Volver a las checklists', onClose: clBack, frac: doneN / n, title: parts[0], text: '' });
    if (parts[1]) R.appendChild(h('p', { class: 'cl-val' }, h('span', { class: 'cl-val-k', text: 'Dejalo en' }), h('strong', { text: parts[1] })));
    var meter = c ? clMeter(it.control, CL.live) : null;
    if (meter) R.appendChild(meter);
    if (okEl) R.appendChild(okEl);
    R.appendChild(auto ? clCue('hand', 'Hacelo:', 'en la cabina 3D (o con “Probalo”). Cuando esté bien y lo soltás, se tilda solo.')
      : clCue('eye', 'Ojo:', 'este paso no se puede comprobar en el simulador. Hacelo mentalmente y tocá “Hecho”.'));
    if (c) {
      R.appendChild(h('div', { class: 'runner-links' },
        h('button', { type: 'button', class: 'btn btn--small', onclick: function () { navLook(function () { clFocusCurrent(true); }, c.nombre); } }, kic('target'), 'Mostrámelo en 3D'),
        h('button', { type: 'button', class: 'btn btn--small', onclick: function () { UI.showControl(it.control); } }, kic('cabin'), 'Ver la ficha: ' + c.nombre)));
    }
    if (!auto) {
      R.appendChild(h('div', { class: 'runner-nav cl-nav' },
        h('button', { type: 'button', class: 'btn', onclick: function () { clTick(true); } }, kic('minus'), 'Saltear'),
        h('button', { type: 'button', class: 'btn btn--primary cl-confirm', onclick: function () { clTick(false); } }, 'Hecho', kic('check'))));
    } else {
      R.appendChild(h('div', { class: 'stp-skip' }, h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: function () { clTick(true); } }, 'No me sale: saltear este ítem')));
    }
    return R;
  }

  function clRenderRun() {
    var v = CL.runView, cur = CL.cur;
    var hadFocus = v.contains(doc.activeElement);
    releaseAllHolds();
    CL.live = [];
    CL.okEl = null; CL.okKind = null;
    clear(v);
    if (!cur) return;
    var cl = cur.cl, items = arr(cl.items), n = items.length;
    var past = [], todo = [];
    items.forEach(function (it, k) { if (cur.done[k]) past.push(k); else if (k > cur.i) todo.push(k); });
    var secs = [];                                                           // [title, meta, body, key, openByDefault]
    function pastBody() {
      var shown = cur.finished ? [] : past.slice(-3), older = cur.finished ? past : past.slice(0, -3), box = h('div');
      if (shown.length) box.appendChild(h('ol', { class: 'stp-list stp-list--done', 'aria-label': 'Ítems ya hechos' }, shown.map(function (k) { return clDoneRow(items[k] || {}, k, cur); })));
      if (older.length) {
        box.appendChild(older.length > 4 && !cur.finished
          ? acc('Ver los ' + older.length + ' anteriores', h('ol', { class: 'stp-list stp-list--done', 'aria-label': 'Ítems anteriores' }, older.map(function (k) { return clDoneRow(items[k] || {}, k, cur); })), { icon: 'check' })
          : h('ol', { class: 'stp-list stp-list--done', 'aria-label': 'Ítems anteriores' }, older.map(function (k) { return clDoneRow(items[k] || {}, k, cur); })));
      }
      return box;
    }
    if (cur.finished) {
      var nx = clNextChecklist(cur), nm = firstUndone(MISSIONS, 'mision');
      var sg = [];
      if (nx !== null) sg.push({ primary: true, icon: 'checklist', title: 'Checklist: ' + (CHECKLISTS[nx].titulo || ''), text: clMin(CHECKLISTS[nx]) + ' min · ' + arr(CHECKLISTS[nx].items).length + ' pasos', onClick: function () { clOpen(nx); } });
      if (nm >= 0) sg.push({ primary: nx === null, icon: 'plane', title: 'Misión: ' + (MISSIONS[nm].titulo || ''), text: 'Ahora volalo vos', onClick: function () { startMission(MISSIONS[nm]); sheetEnsure('half'); } });
      else sg.push({ icon: 'quiz', title: 'Quiz rápido', text: 'Probá lo que aprendiste', onClick: function () { navOpen('quiz'); } });
      v.appendChild(doneCard({
        id: 'cl-done-title', kicker: 'Checklist C' + (cur.idx + 1) + ' completa', title: cl.titulo || '¡Checklist completa!',
        text: 'Hiciste los ' + n + ' ítems en orden.' + (cur.skipped ? ' Salteaste ' + cur.skipped + (cur.skipped === 1 ? ' ítem: practicalo de nuevo.' : ' ítems: practicalos de nuevo.') : ' Así, siempre en el mismo orden, se vuelve automático.'),
        suggestions: sg,
        actions: [h('button', { type: 'button', class: 'btn', onclick: function () { clOpen(cur.idx, true); } }, icon('retry'), 'Repetir'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: clBack }, 'Todas las checklists')]
      }));
      secs.push(['Lo que hiciste', past.length + '/' + n, pastBody(), 'cl-r-done', false]);
    } else {
      var it = items[cur.i] || {}, c = CTRL[it.control];
      v.appendChild(clRunner(cur));
      if (cur.carried) {
        v.appendChild(h('div', { class: 'cl-carried' }, callK('dato', 'Seguís con el mismo avión', 'Quedó tal como lo dejaste al terminar la checklist anterior.'),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn--small', onclick: function () { clOpen(cur.idx, true); } }, 'Empezar de cero'))));
      }
      var pb = c ? buildProbalo(c, CL.live, true, true) : null;
      if (pb) secs.push(['Probalo', 'o en el 3D', h('div', { class: 'cl-probalo' }, pb), 'cl-r-pb', true]);
      if (it.detalle) secs.push(['Por qué importa', '', h('p', { class: 'cl-why', text: it.detalle }), 'cl-r-why', !cc('isMobile')]);
      if (past.length) secs.push(['Ya hecho', past.length + '/' + n, pastBody(), 'cl-r-done', true]);
      if (todo.length) secs.push(['Lo que sigue', todo.length + (todo.length === 1 ? ' ítem' : ' ítems'),
        h('ol', { class: 'stp-list', 'aria-label': 'Ítems que siguen' }, todo.map(function (k) { return clTodoRow(items[k] || {}, k); })), 'cl-r-todo', false]);
    }
    secs.forEach(function (x, i) { v.appendChild(secK(i + 1, x[0], x[1], x[2], x[3], x[4])); });
    if (!cur.finished) {
      v.appendChild(h('div', { class: 'btn-row stp-reset' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () { clOpen(cur.idx, true); } }, icon('retry'), 'Reiniciar la checklist')));
    }
    glossText(v, '.cl-hint > span, .cl-why, .callout-body');
    var s = S();
    if (s) runLive(CL.live, s);
    if (hadFocus) {
      var target = v.querySelector('.cl-runner .cl-confirm') || v.querySelector('.cl-runner .btn') || v.querySelector('.done-card button') || $('stp-name') || $('cl-done-title');
      if (target) safe(function () { target.focus({ preventScroll: true }); });
    }
    var curEl = v.querySelector('.cl-runner');
    if (curEl && mode === 'checklists' && curEl.scrollIntoView) {
      safe(function () { curEl.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); });
    }
  }

  function clNextChecklist(cur) {
    var i, x = null;
    for (i = 0; i < CHECKLISTS.length; i++) if (CHECKLISTS[i].continuaDe === cur.cl.id) { x = i; break; }
    if (x === null) for (i = cur.idx + 1; i < CHECKLISTS.length; i++) if (CL.doneIds.indexOf(CHECKLISTS[i].id) < 0) { x = i; break; }
    return x;
  }

  function clTick(skipped) {
    var cur = CL.cur;
    if (!cur || cur.finished) return;
    var it = cur.cl.items[cur.i] || {};
    cur.done[cur.i] = skipped ? 'skip' : true;
    if (skipped) cur.skipped++;
    cur.justDone = cur.i;
    cur.okSince = 0;
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
    // advance smoothly: the row just ticked flashes, then (a beat later, and only once the hands are off) the camera
    // goes to the next control
    var token = cur.i;
    setTimeout(function () { if (CL.cur === cur && cur.i === token) clFocusCurrent(); }, reducedMotion() ? 0 : 450);
  }

  /** "✓ Bien — soltá" (value right but the student is still holding it) / "✓ Bien" (stable, about to tick). */
  function clSetOk(kind) {
    if (CL.okKind === kind) return;
    CL.okKind = kind;
    var el = CL.okEl;
    if (!el) return;
    el.hidden = !kind;
    toggleClass(el, 'is-hold', kind === 'hold');
    setText(el.querySelector('.cl-ok-text'), kind === 'hold' ? 'Bien — soltá' : (kind === 'ok' ? 'Bien' : ''));
  }

  var CL_STABLE_MS = 800, CL_RELEASED_MS = 450;
  /** Runs ≈10 Hz whatever the open mode. The current item ticks only when its check() has been true for ≥ 0.8 s
   *  continuously AND the student is not touching anything (no drag, no held button or key) AND let go at least
   *  0.45 s ago (they see "✓ Bien" first): passing through the target mid-drag never jumps to the next item. */
  function clEvaluate(s) {
    var cur = CL.cur;
    if (!cur || cur.finished || !CL.open || mode !== 'checklists') return;              // a run left on the side waits, exactly where it was
    var it = cur.cl.items[cur.i];
    if (!it || !isFn(it.check)) { clSetOk(null); return; }
    var ok = false;
    try { ok = !!it.check(s); } catch (e) { logError('checklist check', e); }
    var t = now();
    var busy = uiInteracting();
    if (busy) cur.busyAt = t;
    if (!ok) { cur.okSince = 0; clSetOk(null); runLive(CL.live, s); return; }
    if (!cur.okSince) cur.okSince = t;
    if (busy) { clSetOk('hold'); runLive(CL.live, s); return; }
    if (t - cur.okSince >= CL_STABLE_MS && t - (cur.busyAt || 0) >= CL_RELEASED_MS) { clSetOk(null); clTick(false); return; }
    clSetOk('ok');
    runLive(CL.live, s);
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
    enter: function () { if (CL.open && CL.cur) clFocusCurrent(); },
    exit: function () { cc('setTargetHighlight', null); }
  };

  /* ================================================================== VOLAR (escenarios, misiones, pad de vuelo, HUD) */

  var MISSIONS = arr(DATA.missions).filter(function (m) { return m && m.id && isFn(m.check); });
  var VO = {
    view: null, live: [], m: null, ctx: null, progress: 0, achieved: false, starting: false, trimDir: 0,
    overlay: null, ovLive: [], setH: null,
    tab: store.get('volarTab', 'practicar') === 'situaciones' ? 'situaciones' : 'practicar', sitView: null,
    best: (function () { var b = store.get('missionsBest', {}); return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {}; })(),
    savedBest: {}
  };

  function freshCtx() { return { t: 0, dt: 0, hold: 0, data: {} }; }

  /** User-level: from another tab it is an ABRIR to Misiones. */
  function startMission(m) {
    if (mode !== 'volar' && navOn()) { navOpen('volar', { run: function () { startMissionRaw(m); } }); return; }
    startMissionRaw(m);
  }
  function startMissionRaw(m) {
    if (sitOk() && isFn(C150.Situations.stop)) safe(function () { C150.Situations.stop(); }, 'Situations.stop');
    VO.tab = 'practicar';
    progTouch('mision', m.id);
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

  /** One instrument cell: plain name, live number, unit (always with its unit; the long explanation lives in "¿Qué mide cada número?"). */
  function hudCell(label, unit, extraClass, tip) {
    var v = h('span');
    var cell = h('div', { class: 'hud-cell' + (extraClass ? ' ' + extraClass : ''), title: tip || null },
      h('div', { class: 'hud-lbl', text: label }), h('div', { class: 'hud-val' }, v, unit ? h('small', { text: unit }) : null));
    cell.v = v;
    return cell;
  }
  var HUD_EXPLAIN = [
    ['Velocidad (nudos)', 'Qué tan rápido va el avión por el aire. Un nudo es una milla náutica por hora: casi 1,85 km/h. El Cessna 150 vuela cómodo a unos 85–90 nudos. Por debajo de unos 47 nudos (flaps arriba y sin motor) el ala deja de sustentar.'],
    ['Altura (pies)', 'Qué tan arriba estás. Un pie son 30 centímetros: 1000 pies son unos 300 metros, y 3000 pies unos 900 metros.'],
    ['Sube / baja (pies por minuto)', 'Si el avión está subiendo (+) o bajando (−) y a qué ritmo. Un ascenso tranquilo es de unos 500 pies por minuto.'],
    ['Motor (RPM)', 'Vueltas por minuto de la hélice. En crucero ronda las 2300–2500; con el motor al ralentí, unas 600–1000.'],
    ['Rumbo (grados)', 'Hacia dónde apunta la nariz: 000° es el norte, 090° el este, 180° el sur y 270° el oeste.'],
    ['Inclinación (grados)', 'Cuánto está inclinado el avión hacia un costado (alabeo). 0° es con las alas niveladas.'],
    ['Bolita (coordinación)', 'Un tubito con una bolita: si el avión vuela “derecho”, la bolita queda al medio. Si se va a un costado, el avión derrapa: apretá el pedal de ese lado.'],
    ['Flaps (grados)', 'Los flaps son las tapas que bajan del ala para volar lento y aterrizar. 0° es todo arriba; 40° es todo abajo.']
  ];
  function buildHud(live) {
    var ias = hudCell('Velocidad', 'nudos', null, 'Nudos: millas náuticas por hora'), alt = hudCell('Altura', 'pies', null, 'Pies sobre el nivel del mar (1 pie = 30 cm)'),
      vs = hudCell('Sube / baja', 'pies/min', null, 'Pies por minuto: positivo sube, negativo baja');
    var rpm = hudCell('Motor', 'RPM', null, 'Vueltas por minuto de la hélice'), hdg = hudCell('Rumbo', '°', null, 'Hacia dónde apunta la nariz, en grados'),
      bank = hudCell('Inclinación', '', null, 'Cuánto está inclinado hacia un costado');
    var ball = h('span', { class: 'ball' });
    var ballCell = h('div', { class: 'hud-cell hud-cell--ball', title: 'Si la bolita está al medio, el avión vuela coordinado' },
      h('div', { class: 'hud-lbl', text: 'Bolita (coordinación)' }), h('div', { class: 'ball-tube', 'aria-hidden': 'true' }, ball));
    var flaps = hudCell('Flaps', '°', null, 'Posición de los flaps en grados');
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
    var dl = h('dl', { class: 'hud-explain' });
    HUD_EXPLAIN.forEach(function (x) { dl.appendChild(h('dt', { text: x[0] })); dl.appendChild(h('dd', { text: x[1] })); });
    return h('div', { role: 'group', 'aria-label': 'Instrumentos principales' },
      h('div', { class: 'hud-panel' }, ias, alt, vs, rpm, hdg, bank, ballCell, flaps), sr,
      acc('¿Qué mide cada número?', dl, { icon: 'gauge' }));
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


  /** The panel's flight controls with the AIRE components: the yoke pad, then each control as a Kit slider / detents / hold segmented row. */
  function flightPad(live) {
    var yoke = wYoke(CTRL.yoke || { nombre: 'Volante' }, live, true);
    function widget(id) { var c = CTRL[id]; return c ? buildProbalo(c, live, true, true) : null; }
    function grp(cap, kids, cls) { return h('div', { class: 'ctl-group' + (cls ? ' ' + cls : '') }, ctlCap(cap), kids); }
    var pause = switchBtn('Pausa', function () { var s = S(); return !!(s && s.paused); }, function (on) {
      var s = S(); if (!s) return;
      if (has('setPaused')) cc('setPaused', !!on); else s.paused = !!on;
      kick();
    }, 'congelado', 'volando', live);
    var view = switchBtn('Ver desde afuera', function () { return mainView === 'exterior'; }, function (on) {
      cc('setMainView', on ? 'exterior' : 'cockpit'); syncMainView(); kick();
    }, 'afuera', 'adentro', live);
    return h('div', { class: 'flypad', role: 'group', 'aria-label': 'Mandos en pantalla' },
      h('p', { class: 'flypad-ovnote' }, 'El ', h('strong', { text: 'volante' }), ', los pedales, los frenos y el acelerador están sobre la vista 3D, abajo. Acá tenés el resto.'),
      grp('Volante · inclinar y cabecear', yoke, 'flypad-yoke'),
      grp('Motor · potencia, mezcla y calor', [widget('throttle'), widget('mixture'), widget('carb-heat')], 'flypad-engine'),
      grp('Flaps · para volar lento', widget('flap-switch')),
      grp('Compensador · aliviar el volante', widget('trim-wheel')),
      grp('Pedales y frenos', widget('rudder-pedals'), 'flypad-feet'),
      grp('Vista y pausa', togGrid([pause, view])));
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

  var MISSION_LEVEL = { arrancar: 1, carreteo: 1, despegue: 2, 'recto-nivelado': 2, ascenso: 2, viraje: 3, perdida: 3, aproximacion: 3 };
  function missionLevel(m) { return MISSION_LEVEL[m.id] || 2; }
  // by level (stable): M1, M2… follow the order of the sections, so the "next" mission is always the next one down the list
  MISSIONS = MISSIONS.map(function (m, i) { return [m, i]; }).sort(function (x, y) { return (missionLevel(x[0]) - missionLevel(y[0])) || (x[1] - y[1]); }).map(function (x) { return x[0]; });
  var MISSION_LEVELS = [{ n: 1, title: 'Primeros pasos' }, { n: 2, title: 'Volar de verdad' }, { n: 3, title: 'Maniobras' }];
  /** "01 ── Título ───" (Kit) with a plain fallback. */
  function sectHead(n, title, meta) {
    var K = C150.Kit;
    if (K && isFn(K.sectionHeader)) return K.sectionHeader(n, title, meta);
    return h('h3', { class: 'placard placard--small block-title', text: title });
  }
  function ringOf(frac, ok, size) {
    var K = C150.Kit;
    if (K && isFn(K.progressRing)) return K.progressRing(frac, { size: size || 56, ok: !!ok, text: Math.round(clamp(frac, 0, 1) * 100) + '%', ariaLabel: 'Mejor intento' });
    return h('span', { class: 'pct', text: Math.round(clamp(frac, 0, 1) * 100) + ' %' });
  }
  function clockText(t) { t = Math.max(0, Math.floor(num(t, 0))); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
  /** "AHORA" block of a run (AIRE look): mono label with the live dot, a big readout and, under it, live bars. Returns {el, big, bars}. */
  function nowBlock(label, barLabel) {
    var K = C150.Kit;
    var big = h('output', { class: 'cl-now-v vo-big' });
    var bars = K && isFn(K.bars) ? K.bars({ rows: [{ key: 'p', label: barLabel || 'Avance', color: 'var(--accent)' }] }) : null;
    return { el: h('div', { class: 'cl-now vo-now', role: 'group', 'aria-label': label }, h('p', { class: 'cl-now-k' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), label), big, bars), big: big, bars: bars };
  }

  function endMission() {
    if (!VO.achieved && VO.progress > 0.1) confirmLeave('Terminar la misión', 'Si la terminás ahora, perdés lo que llevás de esta vez. ¿La terminamos?', stopMission); else stopMission();
  }
  /** The running mission as the AIRE runner: kicker M3 · level, live percentage, progress line, title, objective, live bars; steps and tip below. */
  function missionPanel(live, secs) {
    var m = VO.m, mi = MISSIONS.indexOf(m);
    var R = runnerEl({ cls: 'vo-runner', titleId: 'vo-mission-title', kicker: 'Misión M' + (mi + 1) + ' · ' + DIFF_TXT[missionLevel(m)], count: '0 %', closeLabel: 'Terminar la misión',
      onClose: endMission, frac: 0, title: m.titulo || '', text: m.objetivo || '' });
    var fill = R.querySelector('.runner-prog > span'), count = R.querySelector('.runner-count');
    var now = nowBlock('Tu avance', 'Objetivo');
    var clock = h('p', { class: 'vo-clock' }, kic('clock'), h('span', { class: 'vo-clock-t' }), h('span', { class: 'vo-clock-b' }));
    live.push(function () {
      var f = clamp(VO.progress, 0, 1), p = Math.round(f * 100) + ' %';
      if (fill) fill.style.width = (f * 100).toFixed(1) + '%';
      setText(count, VO.achieved ? 'Cumplida' : p);
      setText(now.big, VO.achieved ? '¡Cumplida!' : p);
      if (now.bars) now.bars.set('p', f, p);
      setText(clock.querySelector('.vo-clock-t'), 'Tiempo ' + clockText(VO.ctx ? VO.ctx.t : 0));
      var b = clamp(num(VO.best[m.id], 0), 0, 1);
      setText(clock.querySelector('.vo-clock-b'), b > 0 ? ' · mejor intento ' + Math.round(b * 100) + ' %' : '');
    });
    R.setAttribute('role', 'status');
    R.appendChild(now.el);
    R.appendChild(clock);
    R.appendChild(h('div', { class: 'runner-nav vo-nav' },
      h('button', { type: 'button', class: 'btn', onclick: endMission }, 'Terminar misión'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { startMission(m); } }, icon('retry'), VO.achieved ? 'Otra vez' : 'Reintentar')));
    var out = [R];
    var pasos = arr(m.pasos);
    if (pasos.length || m.consejo) {
      var body = h('div');
      if (pasos.length) { var ol = h('ol', { class: 'steps' }); pasos.forEach(function (p) { ol.appendChild(h('li', { text: typeof p === 'string' ? p : (p && p.texto) || '' })); }); body.appendChild(ol); }
      if (m.consejo) body.appendChild(callK('tip', 'Consejo', m.consejo));
      secs.push(['Paso a paso', pasos.length + (pasos.length === 1 ? ' paso' : ' pasos'), body, 'vo-m-steps', true]);
    }
    if (VO.achieved) {
      var nm = firstUndone(MISSIONS, 'mision', m.id), sg = [];
      if (nm >= 0) sg.push({ primary: true, icon: 'plane', title: 'Misión: ' + (MISSIONS[nm].titulo || ''), text: DIFF_TXT[missionLevel(MISSIONS[nm])], onClick: function () { startMission(MISSIONS[nm]); } });
      if (sitOk() && arr(C150.Situations.list).length) sg.push({ primary: nm < 0, icon: 'flag', title: 'Situaciones: ¿qué harías?', text: 'Cosas que pasan en un vuelo, en el simulador', onClick: function () { stopMission(); voSetTab('situaciones'); scrollPanelTop(); } });
      sg.push({ icon: 'quiz', title: 'Quiz rápido', text: 'Probá lo que sabés', onClick: function () { navOpen('quiz'); } });
      out.push(doneCard({ id: 'vo-done-title', kicker: 'Misión M' + (mi + 1) + ' cumplida', title: m.titulo || '¡Misión cumplida!', text: 'Lo lograste. Probá la siguiente o repetila para hacerlo más prolijo.', suggestions: sg }));
    }
    return out;
  }

  /** The missions of one level as AIRE cards (M1…): best attempt as a thin line, "Empezá acá" on the next one. */
  function missionSection(level, nextId, num0, forceTitle) {
    var K = C150.Kit, idxs = [], items = [];
    MISSIONS.forEach(function (m, i) {
      if (VO.m === m) return;
      if (level && missionLevel(m) !== level.n) return;
      var best = clamp(num(VO.best[m.id], 0), 0, 1), active = VO.m === m;
      idxs.push(i);
      items.push({ code: 'M' + (i + 1), title: m.titulo || m.id, sum: m.objetivo || '', current: active,
        meta: DIFF_TXT[missionLevel(m)] + ' · ' + (best >= 1 ? 'lograda' : (best > 0 ? 'mejor intento ' + Math.round(best * 100) + ' %' : 'sin intentar')),
        tag: nextId === m.id ? (Object.keys(VO.best).length ? 'Siguiente' : 'Empezá acá') : null, onClick: function () { startMission(m); } });
    });
    if (!items.length) return null;
    var ul = K.cardCarousel({ items: items, list: true, label: 'Misiones: ' + (forceTitle || level.title).toLowerCase() });
    var hechas = 0;
    idxs.forEach(function (i, k) {
      var b = clamp(num(VO.best[MISSIONS[i].id], 0), 0, 1);
      if (b >= 1) { hechas++; cardDone(ul, k); } else cardBar(ul, k, b, 'Mejor intento');
    });
    return { title: forceTitle || level.title, meta: hechas + '/' + items.length + ' logradas', body: ul, key: 'vo-lv' + (level ? level.n : 'x') };
  }

  function voRender() {
    var v = VO.view, K = C150.Kit;
    if (!v) return;
    var hadFocus = v.contains(doc.activeElement);
    releaseAllHolds();
    VO.trimDir = 0;
    VO.live = [];
    clear(v);
    if (!(VO.m && VO.tab === 'practicar')) v.appendChild(modeHead('Misiones y situaciones', 'Pasá de mirar a volar: elegí una misión con un objetivo claro, o una situación real (“¿qué harías?”). Los instrumentos y los mandos están acá abajo.'));
    v.appendChild(voTabs());
    var airRow = voAirToggle(VO.live);
    if (airRow) v.appendChild(airRow);
    if (VO.tab === 'situaciones' && VO.sitView) {      // "Situaciones prácticas" (situations.js keeps its own DOM)
      v.appendChild(VO.sitView);
      if (hadFocus) { var tb = v.querySelector('.vo-tab[aria-selected="true"]'); if (tb) safe(function () { tb.focus({ preventScroll: true }); }); }
      return;
    }
    var secs = [];                                  // [title, meta, body, key, openByDefault]
    if (VO.m) add(v, missionPanel(VO.live, secs));

    var inst = ['Instrumentos', 'en vivo', buildHud(VO.live), 'vo-s-inst', !!VO.m];
    var pad = ['Mandos', 'para volar', flightPad(VO.live), 'vo-s-pad', !!VO.m];

    // scenarios: where and how the airplane is
    var P = (C150.Sim && C150.Sim.PRESETS) || {};
    var scen = h('div', { class: 'scen-grid' });
    var scenBtns = [];
    SCENARIOS.forEach(function (sc) {
      var label = (P[sc[0]] && P[sc[0]].label) || sc[1];
      var b = h('button', {
        type: 'button', class: 'scen-btn', 'aria-pressed': 'false', title: (P[sc[0]] && P[sc[0]].description) || null,
        onclick: function () { applyPreset(sc[0]); }
      }, label);
      scenBtns.push([sc[0], b]);
      scen.appendChild(b);
    });
    VO.live.push(function () { scenBtns.forEach(function (x) { setAttr(x[1], 'aria-pressed', currentPreset === x[0] ? 'true' : 'false'); }); });
    var scenSec = ['Dónde está el avión', 'escenario', h('div', null, scen, h('p', { class: 'ctl-sub vo-note', text: 'Cambiar de escenario reinicia el avión: motor, palancas y posición.' })), 'vo-s-scen', false];

    // missions as cards: one numbered section per level (the running one is left out)
    var nextId = null;
    for (var q = 0; q < MISSIONS.length; q++) if (num(VO.best[MISSIONS[q].id], 0) < 1) { nextId = MISSIONS[q].id; break; }
    var misSecs = [];
    if (!MISSIONS.length) misSecs.push(['Misiones', '', h('p', { class: 'empty', text: 'Las misiones todavía no están cargadas.' }), 'vo-lv0', true]);
    else if (VO.m) { var o = missionSection(null, nextId, 0, 'Otras misiones'); if (o) misSecs.push([o.title, o.meta, o.body, o.key, false]); }
    else MISSION_LEVELS.forEach(function (lv) { var o = missionSection(lv, nextId); if (o) misSecs.push([o.title, o.meta, o.body, o.key, true]); });

    var all = VO.m ? secs.concat([inst, pad, scenSec], misSecs) : misSecs.concat([scenSec, inst, pad]);
    all.forEach(function (x, i) { v.appendChild(secK(i + 1, x[0], x[1], x[2], x[3], x[4])); });

    v.appendChild(acc('Atajos del teclado', keysTable(), { icon: 'keyboard' }));
    glossText(v, '.mode-sub, .callout-body');
    var s = S();
    if (s) runLive(VO.live, s);
    if (hadFocus) { var t = $('vo-done-title') || $('vo-mission-title') || v.querySelector('button'); if (t) safe(function () { t.focus({ preventScroll: true }); }); }
  }

  /** "Mostrar el aire": the flow around the airplane in the exterior view while flying, and a short explanation when a control
   *  is moved on purpose (core.js "el aire en VOLAR"). Both sections of the tab. */
  function voAirToggle(live) {
    if (!coreReady || !has('setAirPeek')) return null;
    var b = switchBtn('Mostrar el aire', function () { return voAirOn(); }, function (on) {
      volarAir = !!on;
      store.set('volarAir', volarAir);
      syncAirPeek();
      kick();
    }, 'activado', 'desactivado', live);
    b.title = 'Líneas de aire alrededor del avión en la vista de afuera y una explicación corta cuando movés un mando a propósito';
    return h('div', { class: 'vo-air-row' }, b,
      h('p', { class: 'ctl-sub vo-air-hint', text: 'Mientras volás, en la vista de afuera se dibuja el aire que pasa por el avión. Cuando movés un mando a propósito, te explico qué le hace al aire.' }));
  }

  /* --- sections of the tab: "Misiones" (free flight + missions) · "Situaciones" (situations.js, contract v3) --- */
  function sitOk() { var Si = C150.Situations; return !!(Si && isFn(Si.mount) && isFn(Si.frame)); }
  function voTabs() {
    var wrap = h('div', { class: 'vo-tabs seg seg--two', role: 'tablist', 'aria-label': 'Secciones de Misiones y situaciones' });
    [['practicar', 'Misiones', MISSIONS.length], ['situaciones', 'Situaciones', sitOk() ? arr(C150.Situations.list).length : 0]].forEach(function (t) {
      if (t[0] === 'situaciones' && !sitOk()) return;
      var on = VO.tab === t[0];
      wrap.appendChild(h('button', {
        type: 'button', class: 'vo-tab', role: 'tab', 'aria-selected': on ? 'true' : 'false', tabindex: on ? '0' : '-1',
        onclick: function () { voSetTab(t[0]); }
      }, h('span', { class: 'vo-tab-t', text: t[1] }), h('span', { class: 'vo-tab-n', text: String(t[2]) })));
    });
    return wrap;
  }
  function voSetTab(tab) {
    if (tab !== 'situaciones' || !sitOk()) tab = 'practicar';
    if (VO.tab === tab) return;
    VO.tab = tab;
    store.set('volarTab', tab);
    voRender();
    scrollPanelTop();
    var tb = VO.view && VO.view.querySelector('.vo-tab[aria-selected="true"]');
    if (tb) safe(function () { tb.focus({ preventScroll: true }); });
  }
  function sitApi() {
    return {
      annotate: gloss, h: h, icon: icon, setText: setText, setAttr: setAttr, toggleClass: toggleClass, safe: safe, store: store,
      kic: kic, callK: callK, acc: acc, sectHead: sectHead, diffDots: diffDots, pgBar: pgBar, sgCard: sgCard, go: function (p) { return navOpen(p); },
      secK: secK, runnerEl: runnerEl, cardDone: cardDone, cardBar: cardBar, DIFF_TXT: DIFF_TXT, clockText: clockText,
      cc: cc, has: has, S: S, applyPreset: applyPreset, kick: kick, showToast: showToast, now: now,
      buildHud: buildHud, flightPad: flightPad, CTRL: CTRL, progressBar: progressBar, reducedMotion: reducedMotion,
      scrollPanelTop: scrollPanelTop, releaseAllHolds: releaseAllHolds,
      open: function (p) { return navOpen(p); }, showControl: function (id) { UI.showControl(id); },
      navDetail: function (route, fn) { navDetail('detail', route, fn); },
      probalo: function (id, live) {
        var w = buildProbalo(CTRL[id], live, true);
        var head = w && w.querySelector('.probalo-head');
        if (head) head.parentNode.removeChild(head);
        return w;
      },
      focusControl: function (id) {                                    // MIRAR: only the camera moves
        navLook(function () {
          whenIdle(function () {
            if (mainView === 'exterior' && layoutMode !== 'dos') { cc('setMainView', 'cockpit'); syncMainView(); }
            cc('setTargetHighlight', id);
            focusControl(id, true);
          }, 'sitFocus');
        }, ctrlName(id));
      },
      showPractice: function () { voSetTab('practicar'); },
      stopMission: function () { if (VO.m) { VO.m = null; VO.ctx = null; VO.progress = 0; VO.achieved = false; } }
    };
  }
  frameHooks.push(function (s, dt) { if (sitOk()) C150.Situations.frame(s, dt); });
  presetListeners.push(function (name) { if (sitOk() && isFn(C150.Situations.onPreset)) C150.Situations.onPreset(name); });

  modeImpl.volar = {
    render: function (sec) {
      VO.view = h('div');
      sec.appendChild(VO.view);
      if (sitOk()) {
        VO.sitView = h('div', { class: 'sit-view' });
        safe(function () { C150.Situations.mount(VO.sitView, sitApi()); }, 'Situations.mount');
      }
      voRender();
    },
    enter: function () { showFlightOverlay(true); },
    exit: function () { VO.trimDir = 0; showFlightOverlay(false); },
    slow: function (s) {
      toggleClass(VO.view, 'is-sit-detail', sitDetail());
      if (VO.tab === 'situaciones' && sitOk()) C150.Situations.slow(s);
      else runLive(VO.live, s);
      if (VO.overlay && !VO.overlay.hidden) runLive(VO.ovLive, s);
    }
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
    progMark('quiz', 'best', { score: QZ.score, total: total });
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
    QZ.fb = { ok: ok, title: ok ? '¡Correcto!' : 'No era esa, pero así se aprende', text: q.explicacion || '', answer: ok ? null : arr(q.opciones)[q.correcta] };
    qzRender(false);
  }

  /** Topic of a question, for "temas para repasar": the control's category ("¿Dónde está?") or a keyword guess for the options ones.
   *  `lesson` = the lesson that explains it (opened from the result screen). */
  var QZ_TOPICS = [
    { re: /pérdida|bocina|ángulo de ataque|angulo de ataque/i, label: 'Pérdida y ángulo de ataque', lesson: 'perdida' },
    { re: /flap/i, label: 'Flaps', lesson: 'flaps' },
    { re: /compensador|trim/i, label: 'Compensador', lesson: 'compensador' },
    { re: /alerón|alabeo|timón de profundidad|timón de dirección|pedal|volante|cabeceo|guiñada|eje/i, label: 'Mandos de vuelo y ejes', lesson: 'tres-ejes' },
    { re: /viraje|coordina|bolita|derrap/i, label: 'Viraje y coordinación', lesson: 'coordinacion' },
    { re: /sustentación|resistencia|empuje|peso\b|fuerza/i, label: 'Las 4 fuerzas', lesson: 'cuatro-fuerzas' },
    { re: /motor|mezcla|carburador|aceite|rpm|magneto|combustible|nafta|cebador|hélice/i, label: 'Motor y combustible', lesson: 'motor' },
    { re: /altímetro|velocímetro|horizonte|variómetro|pitot|instrumento|nudos|qnh|presión estática/i, label: 'Instrumentos', lesson: 'instrumentos' },
    { re: /carreteo|freno|estacionamiento|tierra|viento/i, label: 'En tierra', lesson: 'en-tierra' }
  ];
  function qzTopic(q) {
    if (q.tipo === 'donde') {
      var c = CTRL[q.control], k = c && CAT[c.categoria];
      return { label: k ? 'Dónde está: ' + k.nombre : 'Dónde está cada control', lesson: null, control: q.control };
    }
    var t = q.pregunta + ' ' + arr(q.opciones).join(' ') + ' ' + (q.explicacion || '');
    for (var i = 0; i < QZ_TOPICS.length; i++) if (QZ_TOPICS[i].re.test(t)) return { label: QZ_TOPICS[i].label, lesson: QZ_TOPICS[i].lesson };
    return { label: 'Repaso general', lesson: 'primera-clase' };
  }
  /** Wrong answers grouped by topic, the most frequent first. */
  function qzWeak(wrong) {
    var by = {}, order = [];
    wrong.forEach(function (x) {
      var t = qzTopic(x.q);
      if (!by[t.label]) { by[t.label] = { t: t, n: 0 }; order.push(t.label); }
      by[t.label].n++;
    });
    return order.map(function (k) { return by[k]; }).sort(function (a, b) { return b.n - a.n; });
  }
  function lessonIndexById(id) { for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return i; return -1; }

  /** One dot per question: the ones answered right are green, the wrong ones amber, the current one a wide orange pill. */
  function qzDots(n) {
    var w = h('div', { class: 'qz-dots', role: 'img', 'aria-label': 'Pregunta ' + (QZ.i + 1) + ' de ' + n + '. Correctas hasta ahora: ' + QZ.score });
    for (var k = 0; k < n; k++) {
      var r = QZ.results[k], cur = k === QZ.i;
      w.appendChild(h('span', { class: 'qz-dot' + (cur ? ' is-cur' : '') + (r && !(cur && !QZ.answered) ? (r.ok ? ' is-ok' : ' is-bad') : '') }));
    }
    return w;
  }
  /** ✕ on the question card: the same as UP (confirms only when there are answers to lose). */
  function qzLeave() {
    var lose = QZ.phase === 'q' && (QZ.i > 0 || QZ.answered);
    confirmLeave('Dejar el quiz', lose ? 'Si salís ahora, perdés las respuestas de este intento. ¿Salimos?' : '', function () { qzReset(); });
  }

  function qzRender(focusTitle) {
    var v = QZ.view, K = C150.Kit;
    if (!v) return;
    clear(v);
    var n = QZ.qs.length;
    if (QZ.phase === 'start') {
      var b = qzBest();
      v.appendChild(modeHead('Quiz', 'Un repaso corto para ver qué quedó. No hay nota ni apuro: cada respuesta viene con su explicación.'));
      if (!QUIZ.length) { v.appendChild(emptyState('Las preguntas todavía no están cargadas.')); return; }
      var canPick = coreReady && has('pickMode');
      var len = Math.min(QUIZ_LEN, QUIZ.length);
      var start = h('article', { class: 'runner qz-start', 'aria-labelledby': 'qz-start-t' },
        h('p', { class: 'runner-kicker' }, h('span', { text: 'Quiz · listo para empezar' }), h('span', { class: 'runner-count', text: len + ' preguntas' })),
        h('h3', { class: 'runner-title', id: 'qz-start-t', text: len + ' preguntas al azar' }),
        h('p', { class: 'runner-text', text: 'Cada vez salen otras, así que podés repetirlo cuando quieras. Se aprueba con el 70 % o más.' }),
        !canPick ? callK('dato', 'Sin la cabina 3D', 'El quiz usa sólo preguntas de opciones.') : null,
        h('div', { class: 'runner-nav qz-startnav' }, h('button', { type: 'button', class: 'btn btn--primary qz-go', id: 'qz-start', onclick: qzStart }, 'Empezar el quiz', icon('next'))));
      v.appendChild(start);
      var hows = h('ul', { class: 'qz-how' },
        canPick ? h('li', null, h('span', { class: 'qz-how-ico', 'aria-hidden': 'true' }, kic('hand')),
          h('span', null, h('strong', { text: '¿Dónde está?' }), 'Respondés tocando el control en la cabina 3D. Tenés dos intentos.')) : null,
        h('li', null, h('span', { class: 'qz-how-ico', 'aria-hidden': 'true' }, kic('list')),
          h('span', null, h('strong', { text: 'Opciones' }), 'Elegís una respuesta y te explico por qué.')),
        h('li', null, h('span', { class: 'qz-how-ico', 'aria-hidden': 'true' }, kic('swap')),
          h('span', null, h('strong', { text: 'Cada vez distinto' }), 'Las preguntas salen al azar: podés repetirlo cuando quieras.')));
      var secs = [['Cómo funciona', canPick ? '2 tipos' : '1 tipo', hows, 'qz-s-how', true]];
      if (b) secs.push(['Tu mejor resultado', b.score + ' de ' + b.total, h('div', { class: 'qz-best' }, ringOf(b.total ? b.score / b.total : 0, b.total && b.score / b.total >= 0.7, 72),
        h('span', null, h('strong', { text: Math.round(b.total ? b.score / b.total * 100 : 0) + ' % de aciertos' }), h('span', { class: 'ctl-sub', text: b.score + ' de ' + b.total + ' correctas · se aprueba con 70 %' }))), 'qz-s-best', true]);
      secs.forEach(function (x, i) { v.appendChild(secK(i + 1, x[0], x[1], x[2], x[3], x[4])); });
      glossText(v, '.mode-sub, .runner-text, .callout-body');
      return;
    }
    if (QZ.phase === 'end') {
      var r = n ? QZ.score / n : 0, pass = r >= 0.7;
      var msg = r >= 0.9 ? '¡Excelente! Ya conocés la cabina como para tu primera clase.'
        : (r >= 0.7 ? 'Muy bien: aprobaste. Repasá las que te costaron y volvé a probar para afianzar.'
          : (r >= 0.35 ? 'Vas bien, pero todavía falta. Repasá los temas de abajo y probá otra vez.'
            : 'Es normal al principio. Hacé el recorrido y las lecciones, y volvé a probar.'));
      var wrong = QZ.results.filter(function (x) { return !x.ok; });
      var weak = qzWeak(wrong);
      var best = qzBest();
      var ring = ringOf(r, pass, 124);
      if (ring.set) ring.set(r, QZ.score + '/' + n);
      var card = h('article', { class: 'runner qz-result' + (pass ? ' is-pass' : ''), 'aria-labelledby': 'qz-title' },
        celebrateEl(),
        h('p', { class: 'runner-kicker' }, h('span', { text: 'Quiz · resultado' }), h('span', { class: 'runner-count', text: pass ? 'Aprobado' : Math.round(r * 100) + ' %' })),
        h('div', { class: 'qz-result-top' }, ring,
          h('div', { class: 'qz-result-main' },
            h('h2', { class: 'runner-title qz-result-t', id: 'qz-title', tabindex: '-1', text: QZ.score + ' de ' + n + ' correctas' }),
            h('p', { class: 'ctl-sub', text: pass ? 'Aprobado: 70 % o más.' : 'Para aprobar hace falta el 70 %.' }),
            best ? h('p', { class: 'ctl-sub', text: QZ.newBest ? '¡Es tu mejor resultado hasta ahora!' : 'Tu mejor resultado: ' + best.score + ' de ' + best.total }) : null)),
        h('p', { class: 'runner-text', text: msg }));
      v.appendChild(card);
      var secs2 = [];
      if (weak.length) {
        var wl = h('ul', { class: 'qz-weak' });
        weak.slice(0, 4).forEach(function (w) {
          var li = lessonIndexById(w.t.lesson);
          wl.appendChild(h('li', null,
            h('span', { class: 'qz-weak-n', text: String(w.n) }),
            h('span', { class: 'qz-weak-t' }, h('strong', { text: w.t.label }), h('span', { class: 'ctl-sub', text: w.n + (w.n === 1 ? ' respuesta para repasar' : ' respuestas para repasar') })),
            li >= 0 ? h('button', { type: 'button', class: 'btn btn--small', onclick: function () { lbOpen(li); sheetEnsure('half'); } }, kic('book'), 'Repasar')
              : (w.t.control ? h('button', { type: 'button', class: 'btn btn--small', onclick: function () { UI.showControl(w.t.control); } }, kic('cabin'), 'Ver') : null)));
        });
        secs2.push(['Temas para repasar', weak.length + (weak.length === 1 ? ' tema' : ' temas'), wl, 'qz-e-weak', true]);
      }
      if (wrong.length) {
        var list = h('ul', { class: 'rows' });
        wrong.forEach(function (x) {
          var q = x.q, ans = q.tipo === 'donde' ? ctrlName(q.control) : arr(q.opciones)[q.correcta];
          list.appendChild(h('li', { class: 'qz-wrong' },
            h('p', { class: 'qz-wrong-q', text: q.pregunta }),
            h('p', { class: 'small qz-wrong-a' }, h('span', { class: 'soft', text: 'Respuesta: ' }), h('strong', { text: ans || '' })),
            q.explicacion ? h('p', { class: 'small soft', text: q.explicacion }) : null,
            q.tipo === 'donde' ? h('div', { style: { 'margin-top': '6px' } }, controlChip(q.control)) : null));
        });
        secs2.push(['Las que fallaste', wrong.length + (wrong.length === 1 ? ' pregunta' : ' preguntas'), list, 'qz-e-wrong', false]);
      }
      secs2.forEach(function (x, i) { v.appendChild(secK(i + 1, x[0], x[1], x[2], x[3], x[4])); });
      var sg = [];
      if (!pass) {
        var wl0 = weak.length ? lessonIndexById(weak[0].t.lesson) : -1;
        if (wl0 >= 0) sg.push({ primary: true, icon: 'book', title: 'Lección: ' + (LESSONS[wl0].titulo || ''), text: 'Repasá “' + weak[0].t.label + '”', onClick: function () { lbOpen(wl0); sheetEnsure('half'); } });
        else sg.push({ primary: true, icon: 'route', title: 'Recorrido guiado', text: 'Control por control, desde cero', onClick: function () { navOpen('recorrido'); } });
        sg.push({ icon: 'retry', title: 'Probar de nuevo', text: 'Otras preguntas al azar', onClick: qzStart });
      } else {
        var nk = firstUndone(CHECKLISTS, 'checklist');
        if (nk >= 0) sg.push({ primary: true, icon: 'checklist', title: 'Checklist “' + (CHECKLISTS[nk].titulo || '') + '”', text: 'Seguí practicando los procedimientos', onClick: function () { clOpen(nk); sheetEnsure('half'); } });
        sg.push({ primary: nk < 0, icon: 'flag', title: 'Situaciones: ¿qué harías?', text: 'Cosas reales que pasan en un vuelo', onClick: function () { navOpen('volar', { run: function () { voSetTab('situaciones'); } }); } });
        sg.push({ icon: 'retry', title: 'Otra tanda de preguntas', text: 'Para afianzar', onClick: qzStart });
      }
      v.appendChild(h('div', { class: 'qz-sec sg-wrap' }, h('p', { class: 'sg-k', text: 'Seguí con…' }), h('div', { class: 'sg-list' }, sg.map(sgCard))));
      if (focusTitle) { var tt = $('qz-title'); if (tt) safe(function () { tt.focus({ preventScroll: true }); }); }
      return;
    }

    var q = qzCur();
    if (!q) return;
    var body;
    if (q.tipo === 'donde') {
      body = h('div', null,
        QZ.answered ? null : h('div', { class: 'pick-hint' }, kic('hand'),
          h('span', { text: 'Tocá el control en la cabina 3D. Podés girar la vista o usar los botones de Vista, abajo.' })),
        !QZ.answered ? h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: qzGiveUp }, 'No sé: mostrámelo')) : null);
    } else {
      body = h('div', { class: 'opts', role: 'group', 'aria-label': 'Opciones' });
      arr(q.opciones).forEach(function (o, k) {
        var cls = 'opt';
        if (QZ.answered && k === q.correcta) cls += ' is-correct';
        else if (QZ.answered && k === QZ.chosen) cls += ' is-wrong';
        body.appendChild(h('button', { type: 'button', class: cls, disabled: QZ.answered, onclick: function () { qzAnswer(k); } },
          h('span', { class: 'opt-letter', 'aria-hidden': 'true', text: 'ABCDEFGH'.charAt(k) }), h('span', { class: 'opt-t', text: o }),
          QZ.answered && k === q.correcta ? h('span', { class: 'opt-flag', 'aria-hidden': 'true' }, kic('check')) : null,
          QZ.answered && k === q.correcta ? h('span', { class: 'sr-only', text: ' (correcta)' }) : null,
          QZ.answered && k === QZ.chosen && k !== q.correcta ? h('span', { class: 'sr-only', text: ' (tu respuesta)' }) : null));
      });
    }
    var fb = QZ.fb ? h('div', { class: 'feedback qz-fb ' + (QZ.fb.ok ? 'feedback--ok' : 'feedback--bad'), role: 'status' },
      h('span', { class: 'qz-fb-ico', 'aria-hidden': 'true' }, kic(QZ.fb.ok ? 'check' : 'bulb')),
      h('div', { class: 'qz-fb-b' }, h('strong', { text: QZ.fb.title }),
        QZ.fb.answer ? h('span', { class: 'qz-fb-a' }, 'La correcta: ', h('b', { text: QZ.fb.answer })) : null,
        QZ.fb.text ? h('span', { text: QZ.fb.text }) : null)) : null;
    var nextBtn = QZ.answered ? h('button', { type: 'button', class: 'btn btn--primary btn--large', id: 'qz-next', onclick: qzNext },
      QZ.i + 1 >= n ? 'Ver el resultado' : 'Siguiente pregunta', icon('next')) : null;
    var Rn = h('article', { class: 'runner qz-card', 'aria-labelledby': 'qz-q' },
      h('div', { class: 'runner-top' },
        h('p', { class: 'runner-kicker' }, h('span', { text: 'Quiz · ' + (q.tipo === 'donde' ? '¿Dónde está?' : 'Elegí una opción') }),
          h('span', { class: 'runner-count', text: (QZ.i + 1) + ' / ' + n }), h('span', { class: 'qz-score', title: 'Respuestas correctas hasta ahora' }, kic('check'), QZ.score)),
        h('button', { type: 'button', class: 'icon-btn icon-btn--small runner-close', 'aria-label': 'Dejar el quiz', title: 'Dejar el quiz', onclick: qzLeave }, kic('close'))),
      h('div', { class: 'runner-prog', 'aria-hidden': 'true' }, h('span', { style: { width: ((QZ.i + (QZ.answered ? 1 : 0)) / n * 100).toFixed(1) + '%' } })),
      h('h2', { class: 'runner-title quiz-q', id: 'qz-q', tabindex: '-1', text: q.pregunta }),
      body, fb,
      nextBtn ? h('div', { class: 'runner-nav qz-next' }, nextBtn) : null,
      qzDots(n));
    v.appendChild(Rn);
    if (focusTitle) { var qt = $('qz-q'); if (qt && mode === 'quiz') safe(function () { qt.focus({ preventScroll: true }); }); }
    else if (nextBtn && mode === 'quiz') safe(function () { nextBtn.focus({ preventScroll: true }); });
  }

  modeImpl.quiz = {
    render: function (sec) { QZ.view = h('div'); sec.appendChild(QZ.view); qzRender(false); },
    enter: function () { qzArm(); if (QZ.phase === 'q' && QZ.answered && QZ.fb && !QZ.fb.ok) { var q = qzCur(); if (q && q.tipo === 'donde') cc('setTargetHighlight', q.control); } },
    exit: function () { cc('pickMode', null); cc('setTargetHighlight', null); }
  };

  /* ================================================================== AIRE (laboratorio del aire, lab.js) */

  /** Wraps the known jargon in rootEl with glossary popovers (C150.Glossary, glossary.js). Cheap; safe without the module. */
  function gloss(el, opts) {
    var Gl = C150.Glossary;
    if (el && Gl && isFn(Gl.annotate)) safe(function () { Gl.annotate(el, opts); }, 'Glossary.annotate');
  }
  /** Glossary popovers only inside the reading text (not in kickers, titles or buttons): each match is annotated on its own. */
  function glossText(root, sel, opts) {
    if (!root) return;
    var els = root.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) gloss(els[i], opts);
  }
  function labApi() {
    return {
      annotate: gloss, h: h, icon: icon, setText: setText, setAttr: setAttr, toggleClass: toggleClass, fmt: fmt, safe: safe, store: store,
      kic: kic, acc: acc, callK: callK,
      cc: cc, has: has, core: Core, S: S, setInput: setInput, applyPreset: applyPreset, setFlapSwitch: setFlapSwitch,
      kick: kick, viewport: $('viewport'), panel: $('panel'), setMode: function (m) { navGo(m); }, getMode: function () { return mode; },
      currentPreset: function () { return currentPreset; }, getMainView: function () { return mainView; },
      syncMainView: syncMainView, reducedMotion: reducedMotion, now: now, showToast: showToast,
      navDetail: function (route, fn) { navDetail('detail', route, fn); },
      navUp: function () { var n = NAV(); return !!(navOn() && n && isFn(n.up) && n.up()); }
    };
  }
  function labOk() { var Lb = C150.Lab; return !!(Lb && isFn(Lb.mount) && isFn(Lb.enter)); }
  modeImpl.aire = {
    render: function (sec) {
      if (labOk()) { safe(function () { C150.Lab.mount(sec, labApi()); }, 'Lab.mount'); return; }
      sec.appendChild(h('div', { class: 'mode-head' }, h('h2', { class: 'placard mode-title', text: 'Laboratorio del aire' }),
        h('p', { class: 'mode-sub', text: 'Esta parte no se pudo cargar. Recargá la página.' })));
    },
    enter: function () { if (labOk()) { C150.Lab.enter(); kick(); } },
    exit: function () {
      if (labOk()) C150.Lab.exit();
      if (userLayout === 'dos' && layoutMode !== 'dos' && canDos()) applyLayout('dos');   // AIRE forced the exterior: give back 'Las dos'
    },
    slow: function (s) { if (labOk() && isFn(C150.Lab.slow)) C150.Lab.slow(s); }
  };

  /* ================================================================== "SIGUIENTE PASO" (barra al pie del panel, contract v4 U4)
   * One suggestion, from C150.Progress and the tab that is open: "Seguí con: Checklist «Antes de arrancar»" + a primary button.
   * It does not show while the student is in the middle of something (a lesson, a checklist, a mission, a quiz question, the tour)
   * nor on a completion screen (those already say "Seguí con…"), nor on Inicio (it has its own "Continuar"). The ✕ hides it for
   * that tab during this session (sessionStorage 'c150.nx'); on phones it sits right above the bottom of the sheet and is
   * hidden while the sheet is only peeking. */
  var NX = { el: null, k: null, t: null, go: null, ver: 0, key: '', sug: null, hid: (function () {
    try { var v = JSON.parse(root.sessionStorage.getItem('c150.nx')); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; }
  })() };
  function nxSaveHidden() { try { root.sessionStorage.setItem('c150.nx', JSON.stringify(NX.hid)); } catch (e) { /* sin sessionStorage */ } }
  /** True when a completion screen or an activity in progress already says what to do next. */
  function nxBusy() {
    switch (mode) {
      case 'recorrido': return true;
      case 'basico': return LB.idx >= 0;
      case 'checklists': return !!CL.cur;
      case 'volar': return !!VO.m || sitDetail();
      case 'quiz': return QZ.phase !== 'start';
      case 'inicio': case 'escuela': return true;
    }
    return false;
  }
  /** True while a situation's briefing, live run or debrief is on screen (not the list of cards). */
  function sitDetail() { return !!(VO.tab === 'situaciones' && VO.sitView && VO.sitView.querySelector('.sit-brief, .sit-run, .sit-debrief')); }
  function nxGeneric() {
    var P = PG(), sm = P ? safe(function () { return P.summary(); }, 'progress.summary') : null, st = sm && sm.siguiente;
    if (!st) return null;
    var rq = null;
    for (var i = 0; i < st.requisitos.length; i++) if (!st.requisitos[i].hecho) { rq = st.requisitos[i]; break; }
    if (!rq) return null;
    return { id: 'g:' + st.id, title: rq.texto, btn: 'Ir', icon: 'flag', fn: function () { navOpen(String(rq.ruta || '#inicio')); sheetEnsure('half'); } };
  }
  function nxPick() {
    var i, g = null;
    switch (mode) {
      case 'explorar':
        if (exSeen() < 10) {
          var ids = essentialsNext(1);
          if (ids.length) return { id: 'c:' + ids[0], title: 'Conocé: ' + ctrlName(ids[0]), btn: 'Verlo', icon: 'cabin', fn: function () { openControl(ids[0], 'list'); } };
        }
        if (!isDone('recorrido', 'tour') && TOUR.length) return { id: 'tour', title: 'El recorrido guiado', btn: 'Empezar', icon: 'route', fn: function () { navOpen('recorrido'); sheetEnsure('half'); } };
        break;
      case 'basico':
        i = firstUndone(LESSONS, 'leccion');
        if (i >= 0) return { id: 'l:' + LESSONS[i].id, title: 'Lección: ' + (LESSONS[i].titulo || ''), btn: 'Empezar', icon: 'book', fn: function () { lbOpen(i); sheetEnsure('half'); } };
        break;
      case 'checklists':
        i = firstUndone(CHECKLISTS, 'checklist');
        if (i >= 0) return { id: 'k:' + CHECKLISTS[i].id, title: 'Checklist “' + (CHECKLISTS[i].titulo || '') + '”', btn: 'Empezar', icon: 'checklist', fn: function () { clOpen(i); sheetEnsure('half'); } };
        break;
      case 'volar':
        var nMis = firstUndone(MISSIONS, 'mision'), sl = sitOk() ? arr(C150.Situations.list) : [], nSit = firstUndone(sl, 'situacion');
        var sMis = nMis >= 0 ? { id: 'm:' + MISSIONS[nMis].id, title: 'Misión: ' + (MISSIONS[nMis].titulo || ''), btn: 'Probar', icon: 'plane', fn: function () { startMission(MISSIONS[nMis]); sheetEnsure('half'); } } : null;
        var sSit = (nSit >= 0 && isFn(C150.Situations.open)) ? { id: 's:' + sl[nSit].id, title: 'Situación: ' + (sl[nSit].titulo || sl[nSit].nombre || ''), btn: 'Ver', icon: 'flag', fn: function () { voSetTab('situaciones'); safe(function () { C150.Situations.open(sl[nSit].id); }, 'Situations.open'); sheetEnsure('half'); } } : null;
        g = (VO.tab === 'situaciones') ? (sSit || sMis) : (sMis || sSit);
        if (g) return g;
        break;
      case 'quiz':
        break;
      case 'aire':
        var xs = arr(DATA.labExperiments);
        i = firstUndone(xs, 'aire');
        if (i >= 0) return { id: 'a:' + xs[i].id, title: 'Experimento: ' + (xs[i].titulo || xs[i].id), btn: 'Probar', icon: 'wind', fn: function () { UI.openLab(xs[i].id); sheetEnsure('half'); } };
        break;
    }
    g = nxGeneric();
    if (g && mode === 'quiz' && g.id === 'g:quiz') return null;      // already in the quiz tab
    return g;
  }
  function nxRender() {
    var el = NX.el;
    if (!el) return;
    var s = (!nxBusy() && !NX.hid[mode]) ? NX.sug : null;
    el.hidden = !s;
    if (!s) return;
    setText(NX.t, s.title);
    setText($('nextbar-go'), s.btn);
    var u = el.querySelector('.nextbar-ico use');
    if (u) u.setAttribute('href', '#i-' + (s.icon || 'flag'));
  }
  function nxRefresh(force) {
    if (!NX.el) return;
    var busy = nxBusy();
    var key = mode + '|' + NX.ver + '|' + (busy ? 1 : 0) + '|' + (NX.hid[mode] ? 1 : 0) + '|' + (mode === 'volar' ? VO.tab : '');
    if (!force && key === NX.key) return;
    NX.key = key;
    NX.sug = busy ? null : safe(nxPick, 'nextStep');
    nxRender();
  }
  function setupNextBar() {
    NX.el = $('nextbar');
    if (!NX.el) return;
    NX.t = $('nextbar-t');
    $('nextbar-go').addEventListener('click', function () { var s = NX.sug; if (s && isFn(s.fn)) safe(s.fn, 'nextStep.go'); });
    $('nextbar-x').addEventListener('click', function () { NX.hid[mode] = true; nxSaveHidden(); nxRefresh(true); });
    var P = PG();
    if (P && isFn(P.onChange)) P.onChange(function () { NX.ver++; });
    liveGlobal.push(function () { nxRefresh(false); });
    liveGlobal.push(function () { var n = NAV(); if (n && isFn(n.refresh)) n.refresh(false); var np = $('nav-pause'); if (np && np.hidden === navPauseBarOn()) np.hidden = !np.hidden; });
  }

  /* ================================================================== NAVIGATION PROVIDERS (contract v6)
   * Every panel tells C150.Nav how to label itself, what to save and restore, how to go UP to its list, whether it is "in detail" and
   * whether an activity is in progress ("EN CURSO"). Nav calls them when it leaves / returns to a place (Back, Forward, the return bar). */

  /* A mission / situation run that was left on the side pauses the simulation (so the airplane does not fly on its own) and, when the
   * student comes back, a "Pausado — Continuar" banner (#nav-pause in the panel head) gives the controls back. */
  var NAVP = { paused: false };
  function volarActive() {
    return !!((VO.m && !VO.achieved) || (sitOk() && isFn(C150.Situations.phase) && C150.Situations.phase() === 'run'));
  }
  function navPauseSim() {
    var s = S();
    if (!volarActive() || !s || s.paused) return;
    NAVP.paused = true;
    if (has('setPaused')) cc('setPaused', true); else s.paused = true;
    kick();
  }
  function navResumeSim() {
    if (!NAVP.paused) return;
    NAVP.paused = false;
    var s = S();
    if (s && s.paused) { if (has('setPaused')) cc('setPaused', false); else s.paused = false; }
    kick();
  }
  function navPauseBarOn() {
    var s = S();
    if (NAVP.paused && !(s && s.paused)) NAVP.paused = false;      // the student already pressed "Seguir"
    return !!(NAVP.paused && mode === 'volar');
  }
  function sitPhase() { return (sitOk() && isFn(C150.Situations.phase)) ? C150.Situations.phase() : 'lista'; }
  function sitTitle() {
    var id = sitOk() && isFn(C150.Situations.current) ? C150.Situations.current() : null, list = sitOk() ? arr(C150.Situations.list) : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].titulo || list[i].nombre || id;
    return '';
  }

  function registerNavProviders() {
    var N = NAV();
    if (!N || !isFn(N.registerProvider)) return;
    var F = N.fmtLabel;
    function none() { return false; }
    N.registerProvider('inicio', {
      label: function () { return 'Inicio'; }, crumbs: function () { return ['Inicio']; }, route: function () { return 'inicio'; },
      capture: function () { return {}; }, restore: function () {}, up: none, inDetail: none, active: none
    });
    N.registerProvider('explorar', {
      label: function () { return EX.id ? F({ kind: 'Ficha', title: ctrlName(EX.id) }) : 'Cabina'; },
      crumbs: function () { return EX.id ? ['Cabina', ctrlName(EX.id)] : ['Cabina']; },
      route: function () { return EX.id ? 'cabina/' + EX.id : 'cabina'; },
      capture: function () { return { id: EX.id }; },
      restore: function (o) {
        if (o.id && CTRL[o.id]) { if (EX.id !== o.id) openControlRaw(o.id, '3d'); }
        else if (EX.id) closeDetailRaw();
      },
      up: function () { if (!EX.id) return false; closeDetailRaw(); return true; },
      inDetail: function () { return !!EX.id; }, active: none
    });
    function lessonNow() { return LB.open ? LESSONS[LB.idx] || null : null; }
    N.registerProvider('basico', {
      label: function () { var L = lessonNow(); return L ? F({ kind: 'Lección', title: L.titulo, detail: LB.finished ? 'terminada' : 'paso ' + (LB.i + 1) }) : 'Lecciones'; },
      crumbs: function () { var L = lessonNow(); return L ? ['Lecciones', L.titulo || 'Lección', LB.finished ? 'Terminada' : 'Paso ' + (LB.i + 1)] : ['Lecciones']; },
      route: function () { var L = lessonNow(); return L ? 'basico/' + L.id : 'basico'; },
      capture: function () { return { idx: LB.idx, i: LB.i, open: LB.open, finished: LB.finished, seen: JSON.parse(JSON.stringify(LB.seen || {})) }; },
      restore: function (o) {
        if (o.open && o.idx >= 0 && LESSONS[o.idx]) {
          if (LB.idx !== o.idx || !LB.listView || LB.listView.hidden === false) { lbOpenRaw(o.idx); }
          LB.i = clamp(num(o.i, 0), 0, arr(LESSONS[o.idx].pasos).length - 1);
          LB.seen = o.seen || LB.seen; LB.finished = !!o.finished; LB.open = true;
          LB.listView.hidden = true; LB.lessonView.hidden = false;
          if (LB.finished) lbLeave();
          lbRenderStep(!LB.finished);
        } else if (LB.open) lbBackRaw();
      },
      up: function () { if (!LB.open) return false; lbBackRaw(); return true; },
      inDetail: function () { return !!lessonNow(); },
      active: function () { return LB.idx >= 0 && !LB.finished; }
    });
    N.registerProvider('recorrido', {
      label: function () { return TR.finished ? 'Recorrido guiado · terminado' : F({ kind: 'Recorrido guiado', detail: 'paso ' + (TR.i + 1) }); },
      crumbs: function () { return ['Recorrido guiado']; }, route: function () { return 'recorrido'; },
      capture: function () { return { i: TR.i, finished: TR.finished }; },
      restore: function (o) {
        if (typeof o.i === 'number' && TOUR.length && (o.i !== TR.i || !!o.finished !== TR.finished)) {
          TR.i = clamp(o.i, 0, TOUR.length - 1); TR.finished = !!o.finished; store.set('tourStep', TR.i); trRender(); trFocus();
        }
      },
      up: none, inDetail: none,
      active: function () { return TOUR.length > 0 && !TR.finished && TR.i > 0; }
    });
    function clNow() { return (CL.open && CL.cur) ? CL.cur : null; }
    N.registerProvider('checklists', {
      label: function () { var c = clNow(); return c ? F({ kind: 'Checklist', title: c.cl.titulo, detail: c.finished ? 'completa' : 'ítem ' + (c.i + 1) }) : 'Checklists'; },
      crumbs: function () { var c = clNow(); return c ? ['Checklists', c.cl.titulo || 'Checklist', c.finished ? 'Completa' : 'Ítem ' + (c.i + 1)] : ['Checklists']; },
      route: function () { var c = clNow(); return c ? 'checklists/' + c.cl.id : 'checklists'; },
      capture: function () { return { open: CL.open, id: CL.cur ? CL.cur.cl.id : null }; },
      restore: function (o) {
        if (o.open && o.id) {
          if (CL.cur && CL.cur.cl.id === o.id) { if (!CL.open) clShowRaw(); }
          else for (var i = 0; i < CHECKLISTS.length; i++) if (CHECKLISTS[i].id === o.id) { clOpenRaw(i); break; }
        } else if (CL.open) clBackRaw();
      },
      up: function () { if (!CL.open) return false; clBackRaw(); return true; },
      inDetail: function () { return !!clNow(); },
      active: function () { return !!(CL.cur && !CL.cur.finished); }
    });
    N.registerProvider('volar', {
      label: function () {
        if (sitPhase() !== 'lista' && VO.tab === 'situaciones') return F({ kind: 'Situación', title: sitTitle() });
        if (VO.m) return F({ kind: 'Misión', title: VO.m.titulo });
        return 'Misiones y situaciones';
      },
      crumbs: function () { return ['Misiones y situaciones', sitTitle() || 'Situación']; },
      route: function () { var id = (VO.tab === 'situaciones' && sitPhase() !== 'lista' && isFn(C150.Situations.current)) ? C150.Situations.current() : null; return id ? 'volar/' + id : 'volar'; },
      capture: function () { return { tab: VO.tab, sit: sitPhase() !== 'lista' ? (C150.Situations.current && C150.Situations.current()) : null }; },
      restore: function (o) {
        if (o.tab && o.tab !== VO.tab) voSetTab(o.tab);
        if (o.sit && sitOk() && isFn(C150.Situations.open) && (sitPhase() === 'lista' || C150.Situations.current() !== o.sit)) safe(function () { C150.Situations.open(o.sit); }, 'Situations.open');
        else if (!o.sit && sitOk() && VO.tab === 'situaciones' && sitPhase() !== 'lista' && isFn(C150.Situations.toList)) safe(function () { C150.Situations.toList(); }, 'Situations.toList');
      },
      up: function () {
        if (!(sitOk() && sitPhase() !== 'lista' && isFn(C150.Situations.toList))) return false;
        var ph = sitPhase();
        if (ph === 'run') confirmLeave('Salir de la situación', 'Si salís ahora, la situación se corta y el avión vuelve a su escenario. ¿Salimos?', function () { C150.Situations.toList(); scrollPanelTop(); });
        else C150.Situations.toList();
        return true;
      },
      inDetail: function () { return VO.tab === 'situaciones' && sitPhase() !== 'lista'; },
      active: function () { return volarActive(); },
      pause: navPauseSim, resume: function () { /* the banner (navPauseBarOn) gives the controls back */ }
    });
    N.registerProvider('quiz', {
      label: function () { return QZ.phase === 'q' ? F({ kind: 'Quiz', detail: 'pregunta ' + (QZ.i + 1) }) : 'Quiz'; },
      crumbs: function () { return QZ.phase === 'q' ? ['Quiz', 'Pregunta ' + (QZ.i + 1) + ' de ' + QZ.qs.length] : ['Quiz', 'Resultado']; },
      route: function () { return 'quiz'; },
      capture: function () { return { phase: QZ.phase, i: QZ.i }; }, restore: function () {},
      up: function () {
        if (QZ.phase === 'start') return false;
        var lose = QZ.phase === 'q' && (QZ.i > 0 || QZ.answered);
        confirmLeave('Dejar el quiz', lose ? 'Si salís ahora, perdés las respuestas de este intento. ¿Salimos?' : '', function () { qzReset(); });
        return true;
      },
      inDetail: function () { return QZ.phase !== 'start'; },
      active: function () { return QZ.phase === 'q' && (QZ.i > 0 || QZ.answered); }
    });
    function labExp() { var Lb = C150.Lab, i = (Lb && isFn(Lb.getInfo)) ? safe(function () { return Lb.getInfo(); }, 'Lab.getInfo') : null; return (i && i.experiment) ? i : null; }
    function labTitle(id) { return lbLabTitle(id) || id; }
    N.registerProvider('aire', {
      label: function () { var e = labExp(); return e ? F({ kind: 'Aire · experimento', title: labTitle(e.experiment) }) : 'Aire'; },
      crumbs: function () { var e = labExp(); return e ? ['Aire', labTitle(e.experiment)] : ['Aire']; },
      route: function () { var e = labExp(); return e ? 'aire/' + e.experiment : 'aire'; },
      capture: function () { var e = labExp(); return { exp: e ? e.experiment : null, step: e ? e.step : 0 }; },
      restore: function (o) {
        var Lb = C150.Lab;
        if (!Lb) return;
        if (o.exp) { var e = labExp(); if (!e || e.experiment !== o.exp || e.step !== o.step) safe(function () { Lb.startExperiment(o.exp, o.step); }, 'Lab.startExperiment'); }
        else if (labExp() && isFn(Lb.stopExperiment)) safe(function () { Lb.stopExperiment(); }, 'Lab.stopExperiment');
      },
      up: function () { var Lb = C150.Lab; if (!labExp() || !Lb || !isFn(Lb.stopExperiment)) return false; Lb.stopExperiment(); return true; },
      inDetail: function () { return !!labExp(); }, active: none
    });
    N.registerProvider('escuela', {
      label: function () { return 'Escuela'; }, crumbs: function () { return ['Escuela']; }, route: function () { return 'escuela'; },
      capture: function () { return {}; }, restore: function () {}, up: none, inDetail: none, active: none
    });
  }

  /** Modal things the system Back button must close first: the help dialog, every Kit.dialog (welcome, confirmations) and the search palette. */
  function navOverlayWrap() {
    var K = C150.Kit, n = NAV();
    if (!K || !n || !isFn(n.overlayOpen) || K._navWrapped) return;
    K._navWrapped = true;
    if (isFn(K.dialog)) {
      var orig = K.dialog;
      K.dialog = function (o) {
        o = o || {};
        var tok = null, onClose = o.onClose;
        var o2 = {};
        for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) o2[k] = o[k];
        o2.onClose = function () { if (tok && isFn(n.overlayClosed)) n.overlayClosed(tok); if (isFn(onClose)) onClose(); };
        var api = orig.call(K, o2);
        tok = n.overlayOpen(function () { api.close(); });
        return api;
      };
    }
  }
  /** One tap on "Continuar" in the pause banner. */
  function setupPauseBanner() {
    var b = $('nav-pause-go');
    if (b) b.addEventListener('click', function () { navResumeSim(); var n = NAV(); if (n && isFn(n.refresh)) n.refresh(true); });
  }
  /** Starts Nav (history, popstate, bars, chip) once the first route is shown. */
  function mountNav() {
    var n = NAV();
    if (!n || !isFn(n.mount)) return;
    safe(function () {
      n.mount({
        doc: doc, win: root, h: h, icon: kic,
        getMode: function () { return mode; }, groupOf: groupOf,
        capture: navCapture, show: navShow, label: navLabel, route: navRoute, up: navUp,
        getView: function () { return coreReady ? cc('getViewState') : null; },
        setView: function (v, o) { if (coreReady) { cc('setViewState', v, o); syncMainView(); } },
        announce: function (t) { var el = $('nav-live'); if (el) el.textContent = t; },
        focusPanel: function () { var cur = doc.querySelector('.mode:not([hidden])'); if (cur) safe(function () { cur.focus({ preventScroll: true }); }); },
        extra: navPauseBarOn,
        onNavRender: function (info) {
          var pb = $('nav-pause'); if (pb) pb.hidden = !navPauseBarOn();
          var sub = $('sheet-sub');
          if (sub) setText(sub, info.returnLabel ? 'Volver a ' + info.returnLabel : (info.detail && info.crumbs.length ? N_CRUMB(info.crumbs) : (MODE_INFO[mode] || {}).sub || ''));
        }
      });
    }, 'Nav.mount');
    navOverlayWrap();
  }
  function N_CRUMB(list) { var n = NAV(); return n && isFn(n.crumbText) ? n.crumbText(list) : list.join(' › '); }
  function qzReset() {
    QZ.phase = 'start'; QZ.qs = []; QZ.i = 0; QZ.score = 0; QZ.results = []; QZ.answered = false; QZ.chosen = -1; QZ.fb = null;
    cc('pickMode', null); cc('setTargetHighlight', null);
    qzRender(true);
    kick();
  }

  /* ================================================================== boot */

  function onSelect(id) {
    kick();
    CO.selId = id && CTRL[id] ? id : null;
    updateCallout();
    if (mode === 'explorar') {
      if (id && CTRL[id]) { if (EX.id !== id && !isProgrammatic(id)) openControl(id, '3d'); sheetEnsure('half'); }   // a "look" (Mostrámelo) selects without changing the card
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
    safe(syncAirPeek, 'airpeek');
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
        if (!name) { var nv = NAV(); if (nv && isFn(nv.noteManual)) nv.noteManual(); }
        currentCam = name || null;
        if (DOCK.cams) DOCK.cams.setValue(currentCam, false);
      });
      Co.on('scenario', function (name) { if (!applyingPreset && name) presetApplied(name); });
      Co.on('interactionend', function () { kick(); });
      Co.on('animend', function () { onAnimEnd(); kick(); });
    }
    var r = cc('getInsetRect');
    if (r) onLayout(r);
    syncMainView();
    if (userLayout !== 'cabina') safe(function () { applyLayout(userLayout); }, 'layout');
    safe(syncQuality, 'quality');
    setTimeout(hideOverlay, 8000);               // never leave the veil up if frames are slow to arrive
    return true;
  }

  /** On phones .main clips the sheet that sits below the 3D view; focusing something inside the closed sheet could scroll the 3D view out of sight. */
  function guardMainScroll() {
    var m = doc.querySelector('.main');
    if (!m) return;
    m.addEventListener('scroll', function () { if (m.scrollTop || m.scrollLeft) { m.scrollTop = 0; m.scrollLeft = 0; } }, { passive: true });
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
    safe(setupNav, 'nav');
    safe(setupSheet, 'sheet');
    safe(guardMainScroll, 'main scroll');
    safe(setupViewport, 'viewport');
    safe(setupPeek, 'peek');
    safe(setupInteractionTracking, 'interaction');
    safe(setupProgress, 'progress');
    safe(setupNextBar, 'nextbar');
    safe(registerNavProviders, 'nav providers');
    safe(setupPauseBanner, 'pause banner');
    root.addEventListener('blur', releaseAllHolds);
    var ok = safe(function () { return startCore(state); }, 'startCore');
    if (!ok) { coreReady = false; if (state) startLocalLoop(); }
    var m = (root.location.hash || '').slice(1);
    if (!m || !go(m)) setMode('inicio');
    mountNav();                                                   // history + return bar + UP + "Volver a la vista anterior" (after the first route)
    if (!state) showToast({ text: 'No se pudo cargar la simulación: las fichas funcionan, pero los controles no se mueven.', kind: 'warn' });
    var Ob = C150.Onboarding;
    if (Ob && isFn(Ob.maybeStart)) safe(function () { Ob.maybeStart(); }, 'Onboarding.maybeStart');
  };
  UI.setMode = function (name) { navGo(name); };
  UI.getMode = function () { return mode; };
  UI.getGroup = function () { return groupOf(mode); };
  UI.go = function (path) { return navGo(path); };                           // IR (top nav, deep links)
  UI.open = function (path, o) { return navOpen(path, o); };                   // ABRIR: a detail somewhere else, with "← Volver a …"
  UI.lookAt = function (id) { lookAtControl(id); };                            // MIRAR: only the camera moves (glossary "Verlo en 3D")
  UI.back = function () { var n = NAV(); return !!(n && isFn(n.back) && n.back()); };
  UI.up = function () { var n = NAV(); return !!(navOn() && n && isFn(n.up) ? n.up() : navUp()); };
  UI.toast = function (e) { showToast(e); };
  UI.syncNav = function () { syncNav(); syncSearchBtn(); };
  UI.progressSummary = progNow;
  UI.resetTips = function () { coachReset(); };
  UI.openLab = function (expId) { navOpen(expId ? 'aire/' + expId : 'aire'); };
  /* deep links used by the search palette, Inicio and the onboarding (each opens its mode first) */
  UI.openHelp = function () { openHelp(); };
  UI.sheet = function (snap) { sheetEnsure(snap || 'half'); };
  UI.openLesson = function (id) {
    for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) { lbOpen(i); sheetEnsure('half'); return true; }
    return false;
  };
  UI.openChecklist = function (id) { openChecklist(id); sheetEnsure('half'); };
  UI.openMission = function (id) {
    for (var i = 0; i < MISSIONS.length; i++) if (MISSIONS[i].id === id) { startMission(MISSIONS[i]); sheetEnsure('half'); return true; }
    return false;
  };
  UI.openSituation = function (id) {
    navOpen('volar/' + id, { run: function () {
      if (sitOk()) { voSetTab('situaciones'); if (isFn(C150.Situations.open)) safe(function () { C150.Situations.open(id); }, 'Situations.open'); }
    } });
    sheetEnsure('half');
  };
  UI.startQuiz = function () { navOpen('quiz', { run: function () { qzStart(); } }); sheetEnsure('half'); };
  UI.showControl = function (id) {
    if (!CTRL[id]) return;
    navOpen('cabina/' + id);
    sheetEnsure('half');
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { UI.init(); });
  else UI.init();
})(root.C150);
