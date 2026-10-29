var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * lab.js — C150.Lab: el "Laboratorio del aire" (pestaña AIRE, contrato v2 §4).
 *
 * Parte pura (también en Node, la usa tests/validate-lab.js):
 *   C150.Lab.stallAoa(flaps)          ángulo de pérdida (Sim.stallAoa si existe)
 *   C150.Lab.clCurve(flaps)           [{aoa, cl}] −8…+22° (Sim.clCurve si existe; si no, el mismo modelo simple)
 *   C150.Lab.aero(state, fake)        state.aero si existe; si no, una estimación con las constantes del Sim
 *                                     (fake = {ias, aoa, beta}: túnel "de mentira" cuando el Sim no tiene túnel)
 *   C150.Lab.snap(state, t, fake)     foto para las reglas de narración (campos en el encabezado de data/lab.js)
 *   C150.Lab.createNarrator(rules)    → { update(snap) → [{id, tema, tono, tipo, prioridad, cadena, t}], reset() }
 *   C150.Lab.experimentsFor(controlId) → [{id, titulo}]   (botones "Ver el aire" de Explorar)
 *
 * Parte de pantalla (la monta ui.js como el modo 'aire'):
 *   C150.Lab.mount(section, api)      api = utilidades de ui.js (h, icon, cc, has, core, S, setInput, applyPreset,
 *                                     setFlapSwitch, store, fmt, …; ver labApi() en ui.js)
 *   C150.Lab.enter() / exit()         al entrar: preset 'tunnel', vista exterior, fondo 'tunel', flujo de aire;
 *                                     al salir: vuelve el preset, la vista y el fondo de antes y apaga el flujo
 *   C150.Lab.slow(state)              ≈ 15 Hz (paneles, narración, gráfico)
 *   C150.Lab.setLabMode('tunel'|'vuelo') · startExperiment(id, paso?) · stopExperiment() · getInfo()
 *
 * Decisiones (para los otros módulos):
 *  - Todas las llamadas a Core pasan por api.cc/has: sin setAirflow / setBackdrop / setExteriorView / airflow /
 *    Airfoil / Sim.aero el laboratorio sigue andando (capas deshabilitadas, vistas viejas, valores estimados,
 *    panel 04 oculto).
 *  - Las animaciones suaves (mandos que se mueven solos en los experimentos, motor de flaps, lienzos 2D) corren en
 *    un bucle propio (requestAnimationFrame + temporizador de respaldo) sólo mientras la pestaña está abierta.
 *  - Flaps: los botones 0/10/20/30/40 usan el motor real (≈ 9 s de 0° a 40°, flapSwitch DOWN/UP) y al llegar
 *    dejan el valor exacto; sin tensión en la barra los ponen directo.
 *  - Vistas de región (acercar): Core.setExteriorView(región) si la acepta; si no, la vista con nombre del paso.
 *  - Narración y pérdida: mientras el ala está en pérdida la franja de abajo del avión (y "Qué está pasando") muestra
 *    siempre la explicación de la pérdida (la regla 'perdida' de data/lab.js aunque esté en su 'espera', o el paso del
 *    experimento que la provoca); las otras líneas de ese momento van sólo al historial. La franja entra con un brillo
 *    corto, nunca desde opacidad 0 (donde las animaciones CSS se congelan, el texto igual se ve).
 */
(function (C150) {
  'use strict';

  var Lab = C150.Lab = C150.Lab || {};

  /* ================================================================== pure part */

  var KT = 0.514444, G = 9.80665, RHO0 = 1.225;
  var FLAP_MAX = 40, FLAP_DCL = 0.45, FLAP_DCD = 0.055, STALL_LIFT = 0.72, STALL_DRAG = 0.08, HORN_MARGIN = 3.5;
  var AOA_MIN = -6, AOA_MAX = 22, IAS_MAX = 145;
  var QUIET_FOR = 6;            // s without events before 'estado' rules may speak
  var NARR_DT = 0.25;           // s between narrator evaluations

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function isFn(f) { return typeof f === 'function'; }
  function Sim() { return C150.Sim || null; }
  function consts() {
    var S = Sim(), I = S && S._internal && S._internal.constants;
    return {
      MASS: num(I && I.MASS, 725.7), S: num(I && I.S_WING, 14.86), CLA: num(I && I.CLA, 0.085),
      CD0: num(I && I.CD0, 0.027), K: num(I && I.K_IND, 0.06)
    };
  }
  function smooth01(x) { return x <= 0 ? 0 : (x >= 1 ? 1 : x * x * (3 - 2 * x)); }

  Lab.stallAoa = function (flaps) {
    var S = Sim(), f = clamp(num(flaps, 0), 0, FLAP_MAX), v;
    if (S && isFn(S.stallAoa)) { try { v = S.stallAoa(f); if (isFinite(v)) return v; } catch (e) { /* sigue */ } }
    if (S && S._internal && isFn(S._internal.alphaStall)) { try { v = S._internal.alphaStall(f); if (isFinite(v)) return v; } catch (e2) { /* sigue */ } }
    return 16 - f / FLAP_MAX;
  };

  function clFallback(aoa, flaps) {
    var k = consts(), f = clamp(num(flaps, 0), 0, FLAP_MAX), dcl = FLAP_DCL * f / FLAP_MAX, as = Lab.stallAoa(f);
    if (aoa <= as) return k.CLA * aoa + dcl;
    var cmax = k.CLA * as + dcl;
    return cmax + (STALL_LIFT * cmax - cmax) * smooth01((aoa - as) / 2) - 0.01 * Math.max(0, aoa - as - 2);
  }

  var curveCache = {};
  Lab.clCurve = function (flaps) {
    var f = Math.round(clamp(num(flaps, 0), 0, FLAP_MAX) * 2) / 2;
    var key = String(f);
    if (curveCache[key]) return curveCache[key];
    var S = Sim(), pts = null;
    if (S && isFn(S.clCurve)) {
      try {
        var r = S.clCurve(f);
        if (Array.isArray(r) && r.length > 4 && r.every(function (p) { return p && isFinite(p.aoa) && isFinite(p.cl); })) pts = r;
      } catch (e) { pts = null; }
    }
    if (!pts) {
      pts = [];
      for (var a = -8; a <= 22.001; a += 0.5) pts.push({ aoa: a, cl: clFallback(a, f) });
    }
    curveCache[key] = pts;
    return pts;
  };

  function thrustOf(rpm, ias) {
    var S = Sim();
    if (S && S._internal && isFn(S._internal.thrustN)) {
      try { var t = S._internal.thrustN(rpm, ias, 1); if (isFinite(t)) return t; } catch (e) { /* sigue */ }
    }
    var r = rpm / 2550;
    return Math.max(-600, 1980 * r * (r - 0.00625 * ias));
  }

  /** Rough aero snapshot with the Sim constants (only while state.aero does not exist). */
  Lab.aeroFallback = function (s, fake) {
    s = s || {};
    var k = consts(), air = s.air || {}, tun = fake || s.tunnel || {};
    var tunnel = !!fake || !!tun.on;
    var ias = Math.max(0, tunnel ? num(tun.ias, 0) : num(air.ias, 0));
    var aoa = tunnel ? num(tun.aoa, 0) : num(air.aoa, 3);
    var flaps = clamp(num(s.flaps, 0), 0, FLAP_MAX), fr = flaps / FLAP_MAX;
    var V = ias * KT, q = 0.5 * RHO0 * V * V, wind = ias >= 0.5;
    var as = Lab.stallAoa(flaps);
    var cl = wind ? clFallback(aoa, flaps) : 0;
    var sep = smooth01((aoa - as) / 2);
    var cd = wind ? k.CD0 + FLAP_DCD * fr + k.K * cl * cl + STALL_DRAG * sep : 0;
    var L = q * k.S * cl, D = q * k.S * cd, W = k.MASS * G;
    var e = s.engine || {};
    var rpm = num(s.propRpm, num(e.rpm, 0));
    var T = rpm > 100 ? thrustOf(rpm, ias) : 0;
    var thr = e.running ? clamp(num(s.throttle, 0), 0, 1) : 0;
    var lock = !!s.controlLock;
    var yr = lock ? 0 : clamp(num(s.yokeRoll, 0), -1, 1), yp = lock ? 0 : clamp(num(s.yokePitch, 0), -1, 1);
    var rud = clamp(num(s.rudder, 0), -1, 1), trim = clamp(num(s.trim, 0), -1, 1);
    var spd = clamp(ias / 60, 0, 1), auth = clamp(ias / 80, 0, 1.2);
    var pF = 0.3 * clamp((thr - 0.6) / 0.4, 0, 1) * clamp((85 - ias) / 35, 0, 1);
    var diff = wind ? q * 0.5 * k.S * 0.11 * yr : 0;
    var A = Math.PI * 0.876 * 0.876;
    var vi = T > 0 ? 0.5 * (-V + Math.sqrt(V * V + 2 * T / (RHO0 * A))) : 0;
    return {
      ias: ias, tas: ias, aoa: aoa, beta: tunnel ? num(tun.beta, 0) : 0, q: q,
      cl: cl, cd: cd, lOverD: D > 1e-6 ? L / D : 0,
      liftN: L, dragN: D, thrustN: T, weightN: W,
      liftLN: 0.5 * L + 0.5 * diff, liftRN: 0.5 * L - 0.5 * diff,
      flapLiftN: wind ? q * k.S * FLAP_DCL * fr : 0,
      tailN: wind ? q * 1.6 * clamp(-0.08 * cl - 0.03 * (yp * 20) - 0.01 * trim * 10, -1.1, 1.1) * 0.5 : 0,
      rollMoment: clamp(yr * auth, -1, 1),
      pitchMoment: clamp((yp + 0.4 * trim + 0.25 * fr) * spd, -1, 1),
      yawMoment: clamp((rud - pF - 0.15 * yr) * spd, -1, 1),
      downwashDeg: 5.2 * cl, propWashMs: 2 * vi,
      propSwirl: rpm > 100 ? clamp(0.12 * rpm / 2500 + 0.9 * Math.max(0, T) / 1900 * (1 - 0.45 * clamp(ias / 110, 0, 1)), 0, 1) : 0,
      stallBlend: smooth01((aoa - (as - 3)) / 4.5), groundEffect: 0, _estimado: true
    };
  };

  Lab.aero = function (s, fake) {
    var a = s && s.aero;
    if (!fake && a && typeof a === 'object' && isFinite(a.cl) && isFinite(a.liftN)) return a;
    return Lab.aeroFallback(s, fake);
  };

  /** Photo of the state for the narration rules (data/lab.js header lists the fields). */
  Lab.snap = function (s, t, fake) {
    s = s || {};
    var a = Lab.aero(s, fake), air = s.air || {}, k = consts();
    var tunnel = !!fake || !!(s.tunnel && s.tunnel.on);
    var flaps = clamp(num(s.flaps, 0), 0, FLAP_MAX);
    var stallAoa = Lab.stallAoa(flaps), hornAoa = stallAoa - HORN_MARGIN;
    var aoa = num(a.aoa, num(air.aoa, 0)), ias = num(a.ias, num(air.ias, 0));
    var W = num(a.weightN, k.MASS * G);
    var stalled = (!!air.stalled && !(fake)) || (ias > 15 && aoa > stallAoa);
    var horn = (!!air.stallWarning && !fake) || (ias > 15 && aoa >= hornAoa);
    var sf = s.surfaces || {};
    var e = s.engine || {};
    return {
      t: num(t, num(s.time, 0)), tunel: tunnel,
      ias: ias, aoa: aoa, beta: num(a.beta, 0),
      flaps: flaps, throttle: clamp(num(s.throttle, 0), 0, 1), rpm: num(s.propRpm, num(e.rpm, 0)),
      yokeRoll: num(s.yokeRoll, 0), yokePitch: num(s.yokePitch, 0), rudder: num(s.rudder, 0), trim: num(s.trim, 0),
      bank: tunnel ? 0 : num(air.bank, 0), pitch: tunnel ? aoa : num(air.pitch, 0), vs: tunnel ? 0 : num(air.vs, 0),
      rollRate: tunnel ? 0 : num(air.rollRate, 0), onGround: !tunnel && !!air.onGround,
      stallAoa: stallAoa, hornAoa: hornAoa, horn: horn, stalled: stalled,
      stallBlend: clamp(num(a.stallBlend, 0), 0, 1),
      cl: num(a.cl, 0), cd: num(a.cd, 0), lOverD: num(a.lOverD, 0),
      liftKg: num(a.liftN, 0) / G, weightKg: W / G, thrustKg: num(a.thrustN, 0) / G, dragKg: num(a.dragN, 0) / G,
      liftLKg: num(a.liftLN, 0) / G, liftRKg: num(a.liftRN, 0) / G, flapLiftKg: num(a.flapLiftN, 0) / G,
      tailKg: num(a.tailN, 0) / G, n: W > 0 ? num(a.liftN, 0) / W : 0,
      rollM: clamp(num(a.rollMoment, 0), -1, 1), pitchM: clamp(num(a.pitchMoment, 0), -1, 1), yawM: clamp(num(a.yawMoment, 0), -1, 1),
      propWash: num(a.propWashMs, 0), propSwirl: clamp(num(a.propSwirl, 0), 0, 1),
      sf: { aileronL: num(sf.aileronL, 0), aileronR: num(sf.aileronR, 0), elevator: num(sf.elevator, 0),
        rudder: num(sf.rudder, 0), trimTab: num(sf.trimTab, 0) }
    };
  };

  function validChain(ch) {
    if (!Array.isArray(ch) || ch.length < 2) return null;
    var out = [];
    for (var i = 0; i < ch.length; i++) if (typeof ch[i] === 'string' && ch[i].trim()) out.push(ch[i]);
    return out.length >= 2 ? out : null;
  }

  /** Narration engine: evaluates the rules on each photo and returns what to say (at most 2 per call). */
  Lab.createNarrator = function (rules) {
    rules = (Array.isArray(rules) ? rules : []).filter(function (r) { return r && r.id && isFn(r.cuando) && isFn(r.cadena); });
    var mem = {}, last = {}, prev = null, lastEvent = -1e9, t0 = null;
    var n = {
      errors: 0,
      reset: function () { mem = {}; prev = null; t0 = null; },
      update: function (c) {
        if (!c) return [];
        if (t0 === null) { t0 = c.t; lastEvent = c.t; }
        var quiet = c.t - lastEvent >= QUIET_FOR;
        var fired = [];
        for (var i = 0; i < rules.length; i++) {
          var r = rules[i];
          if (r.solo === 'tunel' && !c.tunel) continue;
          if (r.solo === 'vuelo' && c.tunel) continue;
          var estado = r.tipo === 'estado';
          if (estado && !quiet) continue;
          var d = mem[r.id] || (mem[r.id] = {});
          var hit = false;
          try { hit = !!r.cuando(c, prev, d); } catch (e) { n.errors++; hit = false; }
          if (!hit) continue;
          if (last[r.id] !== undefined && c.t - last[r.id] < num(r.espera, 5) && c.t >= last[r.id]) continue;
          var ch = null;
          try { ch = validChain(r.cadena(c, prev, d)); } catch (e2) { n.errors++; ch = null; }
          if (!ch) continue;
          fired.push({ id: r.id, tema: r.tema || '', tono: r.tono || 'info', tipo: estado ? 'estado' : 'evento',
            prioridad: num(r.prioridad, 1), cadena: ch, t: c.t });
        }
        prev = c;
        if (!fired.length) return fired;
        var events = fired.filter(function (f) { return f.tipo === 'evento'; });
        var pick = events.length ? events : fired;
        pick.sort(function (a, b) { return b.prioridad - a.prioridad; });
        pick = pick.slice(0, events.length ? 2 : 1);
        pick.forEach(function (f) { last[f.id] = c.t; if (f.tipo === 'evento') lastEvent = c.t; });
        if (!events.length) lastEvent = c.t - QUIET_FOR / 2;     // estado lines do not chain every tick
        return pick;
      }
    };
    return n;
  };

  Lab.experimentsFor = function (controlId) {
    var X = (C150.DATA && C150.DATA.labExperiments) || [];
    return X.filter(function (x) { return x && Array.isArray(x.controles) && x.controles.indexOf(controlId) >= 0; })
      .map(function (x) { return { id: x.id, titulo: x.titulo }; });
  };

  if (typeof document === 'undefined') return;

  /* ================================================================== screen part */

  var A = null;                 // api from ui.js
  var VIEWS = [
    ['lado', 'Lado'], ['frente', 'Frente'], ['arriba', 'Arriba'], ['tres-cuartos', '3/4'], ['persecucion', 'Persecución']
  ];
  var OLD_VIEW = {              // exterior.js views when Core.setExteriorView does not exist yet
    lado: 'side', frente: 'front', arriba: 'top', 'tres-cuartos': 'rear34', persecucion: 'rearHigh',
    flaps: 'flaps', ailerons: 'front34', elevator: 'tail', rudder: 'tail', tail: 'tail', prop: 'engine',
    wingtips: 'front', stall: 'aoa', wing: 'flaps'
  };
  var REGION_FALLBACK = {
    flaps: 'tres-cuartos', ailerons: 'frente', elevator: 'lado', rudder: 'arriba', tail: 'lado', prop: 'tres-cuartos',
    wingtips: 'frente', stall: 'lado', wing: 'lado'
  };
  var CAPAS = [
    ['streamlines', 'Flujo', 'Las líneas de aire alrededor del avión'],
    ['propwash', 'Hélice', 'El chorro de aire de la hélice'],
    ['vortices', 'Vórtices', 'Los remolinos de las puntas de ala'],
    ['pressure', 'Presión', 'Azul = baja presión, rojo = alta presión'],
    ['forces', 'Fuerzas', 'Las cuatro fuerzas en kilos'],
    ['moments', 'Giros', 'Hacia dónde quiere girar el avión'],
    ['trails', 'Estelas', 'El camino que dejan las puntas de ala'],
    ['slowmo', 'Cámara lenta', 'El aire se mueve más despacio']
  ];
  var DEFAULT_CAPAS = { streamlines: true, propwash: true, vortices: true, pressure: true, forces: true, moments: true, trails: false, slowmo: false };
  var TWEEN_TIME = 1.0;

  var L = {
    mounted: false, active: false, mode: 'tunel', fake: false,
    capas: null, view: 'tres-cuartos', exp: null, step: 0, stepT: 0, timers: [],
    tweens: {}, flapTarget: null, live: [], narrator: null, history: [], current: null, narrT: 0,
    prev: null, loopOn: false, lastT: 0, lastRaf: 0, iv: 0, el: {}, af: null, chartDirty: true, chartKey: '',
    hoverAoa: null, open: {}, done: []
  };

  function S() { return A ? A.S() : null; }
  function core() { return A ? A.core() : null; }
  function flow() { var c = core(); return (c && c.airflow) || null; }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function reduced() { return !!(A && A.reducedMotion()); }
  function tunnelSupported() { var Sm = Sim(); return !!(Sm && Sm.PRESETS && Sm.PRESETS.tunnel); }
  function fakeTunnel() { var s = S(); return (L.fake && L.mode === 'tunel' && s) ? (s.tunnel || null) : null; }
  function getPath(o, p) { p = p.split('.'); for (var i = 0; i < p.length; i++) { if (o == null) return undefined; o = o[p[i]]; } return o; }
  function f0(x) { return A.fmt(x, 0); }
  function f1(x) { return A.fmt(x, 1); }
  function kg(n) { return Math.round(Math.abs(num(n, 0))) + ''; }
  function h() { return A.h.apply(null, arguments); }
  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function cssVar(el, name, d) {
    try { var v = getComputedStyle(el).getPropertyValue(name).trim(); return v || d; } catch (e) { return d; }
  }
  function EXPS() { return ((C150.DATA && C150.DATA.labExperiments) || []).filter(function (x) { return x && x.id && Array.isArray(x.pasos) && x.pasos.length; }); }
  function expById(id) { return EXPS().filter(function (x) { return x.id === id; })[0] || null; }

  /* ------------------------------------------------------------------ inputs: direct, tweens, flap motor */

  function setIn(path, v) {
    var s = S();
    if (!s) return;
    if (path.indexOf('tunnel.') === 0 && !s.tunnel) s.tunnel = { on: false, ias: 80, aoa: 4, beta: 0 };
    A.setInput(path, v);
  }
  function getIn(path) { var s = S(); return s ? getPath(s, path) : undefined; }
  function cancelTween(path) { delete L.tweens[path]; }
  function tweenTo(path, to) {
    var from = num(getIn(path), to);
    if (reduced() || Math.abs(from - to) < 1e-4) { cancelTween(path); setIn(path, to); return; }
    L.tweens[path] = { from: from, to: to, t: 0, dur: TWEEN_TIME };
  }
  function runTweens(dt) {
    for (var p in L.tweens) {
      if (!Object.prototype.hasOwnProperty.call(L.tweens, p)) continue;
      var tw = L.tweens[p];
      tw.t += dt;
      var u = clamp(tw.t / tw.dur, 0, 1), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      setIn(p, tw.from + (tw.to - tw.from) * e);
      if (u >= 1) delete L.tweens[p];
    }
  }
  function busOn(s) { return !!(s && s.masterBat && s.elec && num(s.elec.busVolts, 0) > 11); }
  function setFlaps(target) {
    target = clamp(num(target, 0), 0, FLAP_MAX);
    var s = S();
    if (!s) return;
    if (!busOn(s) || reduced()) { L.flapTarget = null; A.setFlapSwitch('OFF'); s.flaps = target; A.kick(); return; }
    L.flapTarget = target;
    flapMotor();
  }
  function flapMotor() {
    var s = S();
    if (L.flapTarget === null || !s) return;
    var d = L.flapTarget - num(s.flaps, 0);
    if (Math.abs(d) < 0.3 || !busOn(s)) {
      A.setFlapSwitch('OFF');
      s.flaps = L.flapTarget;               // exact detent (the motor stops within a fraction of a degree)
      L.flapTarget = null;
      A.kick();
      return;
    }
    var want = d > 0 ? 'DOWN' : 'UP';
    if (s.flapSwitch !== want) A.setFlapSwitch(want);
  }
  function stopFlapMotor() {
    if (L.flapTarget !== null) { L.flapTarget = null; A.setFlapSwitch('OFF'); }
  }

  function applySet(set) {
    if (!set || typeof set !== 'object') return;
    for (var k in set) {
      if (!Object.prototype.hasOwnProperty.call(set, k)) continue;
      var v = set[k];
      if (k === 'tunnel') {
        if (L.mode !== 'tunel' || !v) continue;
        if (isFinite(v.ias)) tweenTo('tunnel.ias', clamp(v.ias, 0, IAS_MAX));
        if (isFinite(v.aoa)) tweenTo('tunnel.aoa', clamp(v.aoa, AOA_MIN, AOA_MAX));
        if (isFinite(v.beta)) tweenTo('tunnel.beta', v.beta);
      } else if (k === 'flaps') setFlaps(v);
      else if (isFinite(v)) tweenTo(k, v);
    }
  }

  /* ------------------------------------------------------------------ Core bridges (all optional) */

  function pushAirflow() {
    var c = L.capas;
    var o = { enabled: true, streamlines: !!c.streamlines, propwash: !!c.propwash, vortices: !!c.vortices,
      pressure: !!c.pressure, forces: !!c.forces, moments: !!c.moments, trails: !!c.trails, slowmo: c.slowmo ? 0.3 : 1 };
    if (A.has('setAirflow')) { A.cc('setAirflow', o); return true; }
    var f = flow();
    if (f && isFn(f.set)) { A.safe(function () { f.set(o); }, 'airflow.set'); return true; }
    return false;
  }
  function airflowOff() {
    if (A.has('setAirflow')) { A.cc('setAirflow', { enabled: false }); return; }
    var f = flow();
    if (f && isFn(f.set)) A.safe(function () { f.set({ enabled: false }); }, 'airflow.set');
  }
  function airflowAvailable() { var f = flow(); return A.has('setAirflow') || !!(f && isFn(f.set)); }
  function flowFocus(region) {
    var f = flow();
    if (f && isFn(f.focus)) A.safe(function () { f.focus(region || null); }, 'airflow.focus');
  }
  function setBackdrop(name) { if (A.has('setBackdrop')) A.cc('setBackdrop', name); }
  function ensureExterior() {
    if (A.has('getMainView') && A.cc('getMainView') !== 'exterior') { A.cc('setMainView', 'exterior'); A.syncMainView(); }
  }
  /** Named view ('lado', …) or a flow region ('flaps', …). Returns true if the camera moved. */
  function setLabView(name) {
    if (!name) return false;
    ensureExterior();
    var isNamed = VIEWS.some(function (v) { return v[0] === name; });
    if (A.has('setExteriorView')) {
      var r = A.cc('setExteriorView', name);
      if (r !== false && (isNamed || r === true)) { if (isNamed) markView(name); return true; }
      if (!isNamed) return setLabView(REGION_FALLBACK[name] || 'tres-cuartos');
    }
    var c = core(), ext = c && c.exterior;
    if (ext && isFn(ext.setView) && OLD_VIEW[name]) {
      A.safe(function () { ext.setView(OLD_VIEW[name]); }, 'ext.setView');
      if (isNamed) markView(name);
      return true;
    }
    return false;
  }
  function markView(name) {
    L.view = name;
    var bs = L.el.viewBtns || [];
    for (var i = 0; i < bs.length; i++) A.setAttr(bs[i], 'aria-pressed', bs[i].getAttribute('data-view') === name ? 'true' : 'false');
  }

  /* ------------------------------------------------------------------ modes */

  function setLabMode(m, opts) {
    opts = opts || {};
    if (m !== 'vuelo') m = 'tunel';
    var s = S();
    var keepTunnel = s && s.tunnel ? { ias: num(s.tunnel.ias, 80), aoa: num(s.tunnel.aoa, 4) } : null;
    L.mode = m;
    stopFlapMotor();
    L.tweens = {};
    if (m === 'tunel') {
      L.fake = !tunnelSupported();
      A.applyPreset(L.fake ? 'cruise' : 'tunnel');
      s = S();
      if (s) {
        if (!s.tunnel || typeof s.tunnel !== 'object') s.tunnel = { on: false, ias: 80, aoa: 4, beta: 0 };
        if (L.fake) { s.tunnel.ias = keepTunnel ? keepTunnel.ias : 80; s.tunnel.aoa = keepTunnel ? keepTunnel.aoa : 4; }
      }
      setBackdrop('tunel');
      L.capas.trails = false;
      if (!opts.keepView) setLabView('tres-cuartos');
    } else {
      L.fake = false;
      A.applyPreset('cruise');
      setBackdrop('cielo');
      L.capas.trails = true;
      if (!opts.keepView) setLabView('persecucion');
    }
    ensureExterior();
    pushAirflow();
    syncCapas();
    if (L.narrator) L.narrator.reset();
    A.store.set('labMode', m);
    syncMode();
    A.kick();
  }

  function syncMode() {
    var tun = L.mode === 'tunel';
    var b = L.el.modeBtns || {};
    if (b.tunel) A.setAttr(b.tunel, 'aria-pressed', tun ? 'true' : 'false');
    if (b.vuelo) A.setAttr(b.vuelo, 'aria-pressed', tun ? 'false' : 'true');
    if (L.el.panel) L.el.panel.setAttribute('data-lab-mode', L.mode);
    if (L.el.stage) L.el.stage.setAttribute('data-lab-mode', L.mode);
    (L.el.tunnelOnly || []).forEach(function (x) { if (x.inp) x.inp.disabled = !tun; });
    A.setText(L.el.modeNote, tun
      ? 'El avión está quieto y el viento sopla: vos elegís la velocidad y el ángulo de ataque.'
      : 'El avión vuela de verdad: la velocidad y el ángulo los decide el avión. Usá acelerador, volante, pedales y flaps.');
  }

  /* ------------------------------------------------------------------ experiments */

  function startExperiment(id, stepIdx) {
    var ex = expById(id);
    if (!ex) return false;
    L.exp = ex;
    applyStep(clamp(num(stepIdx, 0), 0, ex.pasos.length - 1), true);
    renderExpList();
    if (A.panel) A.panel.scrollTop = 0;
    var t = L.el.run && L.el.run.querySelector('.lab-run-title');
    if (t) A.safe(function () { t.focus({ preventScroll: true }); });
    return true;
  }
  function stopExperiment() {
    L.exp = null; L.timers = [];
    flowFocus(null);
    if (L.el.run) L.el.run.hidden = true;
    renderExpList();
    A.kick();
  }
  function applyStep(i, first) {
    var ex = L.exp;
    if (!ex) return;
    var st = ex.pasos[i];
    if (!st) return;
    L.step = i; L.stepT = 0; L.timers = [];
    var m = st.modo || (first ? ex.modo : null);
    var viewSet = false;
    if (m && (m !== L.mode || st.reiniciar || (first && m === 'tunel'))) setLabMode(m, { keepView: true });
    if (st.capas) {
      for (var k in st.capas) {
        if (Object.prototype.hasOwnProperty.call(L.capas, k)) L.capas[k] = !!st.capas[k];
      }
      pushAirflow(); syncCapas();
    }
    if (st.acercar && st.foco && A.has('setExteriorView')) {
      var r = A.cc('setExteriorView', st.foco);
      viewSet = r !== false && r !== undefined;
      if (viewSet) markView(null);
    }
    if (!viewSet) setLabView(st.vista || (L.mode === 'vuelo' ? 'persecucion' : 'tres-cuartos'));
    flowFocus(st.foco || ex.foco || null);
    applySet(st.set);
    (Array.isArray(st.luego) ? st.luego : []).forEach(function (l) { if (l && isFinite(l.tras) && l.set) L.timers.push({ t: l.tras, set: l.set }); });
    if (L.narrator) L.narrator.reset();
    if (Array.isArray(st.cadena) && st.cadena.length >= 2) {
      // a step that takes the wing past the critical angle explains the stall itself: it stays on screen while stalled
      var ta = st.set && st.set.tunnel ? num(st.set.tunnel.aoa, NaN) : NaN;
      var tf = st.set && isFinite(st.set.flaps) ? st.set.flaps : num(S() && S().flaps, 0);
      say({ id: 'exp', tono: 'info', tipo: 'evento', cadena: st.cadena, t: 0, exp: true, stall: isFinite(ta) && ta >= Lab.stallAoa(tf) });
    }
    if (i === ex.pasos.length - 1) markDone(ex.id);
    renderRun();
    A.kick();
  }
  function runTimers(dt) {
    if (!L.timers.length) return;
    L.stepT += dt;
    for (var i = 0; i < L.timers.length; i++) {
      if (L.stepT >= L.timers[i].t) { applySet(L.timers[i].set); L.timers.splice(i, 1); i--; }
    }
  }
  function markDone(id) {
    if (L.done.indexOf(id) < 0) { L.done.push(id); A.store.set('labDone', L.done); }
  }

  /* ------------------------------------------------------------------ narration */

  /** keep = true: the line goes to the log ("Antes") but the strip keeps showing the current one (while stalled). */
  function say(item, keep) {
    if (!item) return;
    if (keep && L.current) L.history.splice(1, 0, item);
    else { L.current = item; L.history.unshift(item); }
    if (L.history.length > 6) L.history.length = 6;
    renderNarration();
  }
  /** A line that explains the stall itself (the 'perdida' rules, or an experiment step that stalls the wing). */
  function isStallLine(it) {
    return !!it && (!!it.stall || (it.tema === 'perdida' && it.id !== 'bocina' && it.id !== 'recuperacion'));
  }
  /** The stall narration from the 'perdida' rule of data/lab.js (it may be waiting for its 'espera': we still say it). */
  function stallLine(c) {
    var rules = (C150.DATA && C150.DATA.labNarration) || [], ch = null;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i] && rules[i].id === 'perdida' && isFn(rules[i].cadena)) {
        try { ch = validChain(rules[i].cadena(c, null, {})); } catch (e) { ch = null; }
        break;
      }
    }
    if (!ch) ch = ['Pasaste el ángulo crítico (' + f0(c.stallAoa) + '°)', 'el aire se despega de la parte de arriba del ala', '¡PÉRDIDA! Nariz abajo y potencia'];
    return { id: 'perdida', tema: 'perdida', tono: 'warn', tipo: 'evento', prioridad: 5, cadena: ch, t: c.t };
  }
  /** Narration tick: what the rules said, but while the wing is stalled the strip keeps explaining the stall (other
   *  lines only go to the log) and, if no stall line is showing yet, it says one right away. */
  function narrate(c, said) {
    var stalled = !!(c && c.stalled);
    for (var j = said.length - 1; j >= 0; j--) say(said[j], stalled && !isStallLine(said[j]) && isStallLine(L.current));
    if (stalled && !isStallLine(L.current)) say(stallLine(c));
  }
  function chainEl(cadena, tono, compact) {
    var wrap = h('div', { class: 'lab-chain' + (compact ? ' lab-chain--compact' : '') + ' is-' + (tono || 'info'), role: 'group' });
    var list = compact && cadena.length > 2 ? [cadena[0], cadena[cadena.length - 1]] : cadena;
    wrap.setAttribute('aria-label', cadena.join(', entonces '));
    list.forEach(function (t, i) {
      if (i > 0) wrap.appendChild(h('span', { class: 'lab-chain-arrow', 'aria-hidden': 'true' }));
      var cls = i === 0 ? 'lab-chain-cause' : (i === list.length - 1 ? 'lab-chain-effect' : 'lab-chain-step');
      wrap.appendChild(h('span', { class: 'lab-chain-item ' + cls, 'aria-hidden': 'true', text: t }));
    });
    return wrap;
  }
  function renderNarration() {
    var cur = L.current, el = L.el;
    if (!el.narrNow) return;
    A.toggleClass(el.narrNow, 'is-empty', !cur);
    while (el.narrNow.firstChild) el.narrNow.removeChild(el.narrNow.firstChild);
    if (cur) {
      el.narrNow.appendChild(h('p', { class: 'lab-narr-tag', text: cur.exp ? 'Experimento' : (cur.tono === 'warn' ? 'Atención' : (cur.tono === 'good' ? 'Bien' : 'Causa → efecto')) }));
      el.narrNow.appendChild(chainEl(cur.cadena, cur.tono, false));
    } else {
      el.narrNow.appendChild(h('p', { class: 'lab-narr-empty', text: 'Mové un mando y acá te cuento qué le pasa al aire y al avión.' }));
    }
    var log = el.narrLog;
    while (log.firstChild) log.removeChild(log.firstChild);
    L.history.slice(1, 5).forEach(function (it) {
      log.appendChild(h('li', { class: 'is-' + it.tono, text: it.cadena[0] + ' → ' + it.cadena[it.cadena.length - 1] }));
    });
    el.narrLogWrap.hidden = L.history.length < 2;
    if (A.annotate && cur) A.annotate(el.narrNow);
    // overlay on the 3D (compact)
    var ov = el.stageNarr;
    if (ov) {
      while (ov.firstChild) ov.removeChild(ov.firstChild);
      if (cur) {
        ov.appendChild(chainEl(cur.cadena, cur.tono, false));
        ov.appendChild(chainEl(cur.cadena, cur.tono, true));
        ov.hidden = false;
        ov.classList.remove('is-new'); void ov.offsetWidth; ov.classList.add('is-new');
      } else ov.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ DOM builders */

  function secBlock(num2, key, title, metaFn, body, openDefault) {
    var open = L.open[key] !== undefined ? !!L.open[key] : openDefault !== false;
    var meta = h('span', { class: 'lab-sec-meta' });
    var bodyWrap = h('div', { class: 'lab-sec-body', id: 'lab-body-' + key }, body);
    var head = h('button', { type: 'button', class: 'lab-sec-head', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'lab-body-' + key },
      h('span', { class: 'lab-num', text: num2 }),
      h('span', { class: 'lab-sec-title', text: title }),
      meta,
      h('span', { class: 'lab-chev', 'aria-hidden': 'true' }));
    bodyWrap.hidden = !open;
    head.addEventListener('click', function () {
      var o = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', o ? 'true' : 'false');
      bodyWrap.hidden = !o;
      L.open[key] = o; A.store.set('labOpen', L.open);
      if (o) { L.chartDirty = true; if (L.af && isFn(L.af.resize)) A.safe(function () { L.af.resize(); }); }
    });
    if (metaFn) L.live.push(function (s, c) { A.setText(meta, metaFn(s, c)); });
    return h('section', { class: 'lab-sec', 'data-sec': key }, head, bodyWrap);
  }

  /** Range control: o = {key, label, path, min, max, step, fmt(v,c), sub(c), ends, ticks[{v,t}], quick[{v,t}], track(c)} */
  function control(o) {
    var lastUser = 0, dragging = false;
    var inp = h('input', { type: 'range', class: 'lab-range', min: o.min, max: o.max, step: o.step, 'aria-label': o.label, id: 'lab-in-' + o.key });
    var val = h('output', { class: 'lab-ctl-val', for: 'lab-in-' + o.key });
    var sub = o.sub ? h('p', { class: 'lab-ctl-sub' }) : null;
    function setV(v) {
      lastUser = now();
      cancelTween(o.path);
      if (o.set) o.set(v); else setIn(o.path, v);
      if (L.exp && !o.keepExp) noteManual();
    }
    inp.addEventListener('input', function () { setV(parseFloat(inp.value)); });
    inp.addEventListener('pointerdown', function () { dragging = true; });
    inp.addEventListener('pointerup', function () { dragging = false; });
    inp.addEventListener('pointercancel', function () { dragging = false; });
    var trackWrap = h('div', { class: 'lab-track' }, inp);
    if (o.center) trackWrap.appendChild(h('span', { class: 'lab-center', 'aria-hidden': 'true' }));
    var ticks = null;
    if (o.ticks) {
      ticks = h('div', { class: 'lab-ticks', 'aria-hidden': 'true' });
      o.ticks.forEach(function (tk, i) {
        var sp = h('span', { class: 'lab-tick' + (i % 2 ? ' is-alt' : ''), text: tk.t });
        sp.style.left = ((tk.v - o.min) / (o.max - o.min) * 100) + '%';
        if (tk.cls) sp.classList.add(tk.cls);
        ticks.appendChild(sp);
        tk.el = sp;
      });
    }
    var quick = null;
    if (o.quick) {
      quick = h('div', { class: 'lab-quick', role: 'group', 'aria-label': o.label + ': valores rápidos' });
      o.quick.forEach(function (q) {
        quick.appendChild(h('button', { type: 'button', class: 'lab-qbtn', onclick: function () {
          if (inp.disabled) return;
          lastUser = 0;
          if (o.set) { cancelTween(o.path); o.set(q.v); } else tweenTo(o.path, q.v);
          if (L.exp && !o.keepExp) noteManual();
        } }, q.t));
      });
    }
    var ends = o.ends ? h('div', { class: 'lab-ends', 'aria-hidden': 'true' }, h('span', { text: o.ends[0] }), h('span', { text: o.ends[1] })) : null;
    var row = h('div', { class: 'lab-ctl' + (o.cls ? ' ' + o.cls : '') },
      h('div', { class: 'lab-ctl-head' }, h('label', { class: 'lab-ctl-label', for: 'lab-in-' + o.key, text: o.label }), val),
      trackWrap, ticks, ends, sub, quick);
    function upd(s, c) {
      var v = num(o.get ? o.get(s, c) : getIn(o.path), o.min);
      if ((inp.disabled || (!dragging && now() - lastUser > 350)) && Math.abs(parseFloat(inp.value) - v) > o.step / 2) inp.value = v;
      var txt = o.fmt(v, c, s);
      A.setText(val, txt);
      A.setAttr(inp, 'aria-valuetext', txt);
      if (sub) A.setText(sub, o.sub(c, s));
      if (o.track) { var tr = o.track(c); if (tr !== o._tr) { o._tr = tr; trackWrap.style.setProperty('--trk', tr); } }
      if (o.onUpd) o.onUpd(c, o);
    }
    L.live.push(upd);
    return { row: row, inp: inp, upd: upd, o: o };
  }
  var manualNoted = 0;
  function noteManual() {
    // touching a control during an experiment is welcome: the step card just says so once
    if (!L.exp || now() - manualNoted < 8000) return;
    manualNoted = now();
    if (L.el.runHint) { L.el.runHint.hidden = false; }
  }

  function pctOf(v, a, b) { return clamp((v - a) / (b - a) * 100, 0, 100).toFixed(2) + '%'; }
  function speedTrack() {
    var p = function (v) { return pctOf(v, 0, IAS_MAX); };
    var top = 'linear-gradient(90deg, transparent ' + p(42) + ', var(--lab-arc-white) ' + p(42) + ', var(--lab-arc-white) ' + p(85) + ', transparent ' + p(85) + ')';
    var bot = 'linear-gradient(90deg, transparent ' + p(47) + ', var(--arc-green) ' + p(47) + ', var(--arc-green) ' + p(107) +
      ', var(--arc-yellow) ' + p(107) + ', var(--arc-yellow) ' + p(141) + ', var(--arc-red) ' + p(141) + ')';
    return top + ' top / 100% 45% no-repeat, ' + bot + ' bottom / 100% 55% no-repeat, var(--lab-track)';
  }
  function aoaTrack(c) {
    var st = c ? c.stallAoa : 16, hn = c ? c.hornAoa : 12.5;
    var p = function (v) { return pctOf(v, AOA_MIN, AOA_MAX); };
    return 'linear-gradient(90deg, var(--lab-track) ' + p(0) + ', color-mix(in srgb, var(--arc-green) 70%, var(--lab-track)) ' + p(0) +
      ', var(--arc-green) ' + p(hn) + ', var(--arc-yellow) ' + p(hn) + ', var(--arc-yellow) ' + p(st) + ', var(--arc-red) ' + p(st) + ')';
  }
  function side(v, l, r, zero) { return Math.abs(v) < 0.02 ? (zero || 'Al centro') : (v < 0 ? l : r) + ' ' + Math.round(Math.abs(v) * 100) + ' %'; }
  function degTxt(d, up, down) { return Math.abs(d) < 0.5 ? '0°' : (d < 0 ? up : down) + ' ' + f0(Math.abs(d)) + '°'; }

  function buildControls() {
    var lim = { vs1: 47, vy: 68, vfe: 85, vne: 141 };
    var tunnelOnly = [];
    var ias = control({
      key: 'ias', label: 'Velocidad del viento', path: 'tunnel.ias', min: 0, max: IAS_MAX, step: 1, cls: 'lab-ctl--big',
      get: function (s, c) { return L.mode === 'tunel' ? num(getIn('tunnel.ias'), 0) : (c ? c.ias : 0); },
      fmt: function (v) { return f0(v) + ' kt'; },
      track: function () { return speedTrack(); },
      ticks: [{ v: lim.vs1, t: '47' }, { v: lim.vy, t: '68' }, { v: lim.vfe, t: '85' }, { v: lim.vne, t: '141', cls: 'is-red' }],
      quick: [{ v: 47, t: 'Pérdida 47' }, { v: 65, t: 'Aproximación 65' }, { v: 68, t: 'Vy 68' }, { v: 90, t: 'Crucero 90' }, { v: 141, t: 'Vne 141' }],
      sub: function (c) {
        if (!c) return '';
        if (c.ias >= 141) return 'Línea roja: nunca exceder (Vne).';
        if (c.ias > 107) return 'Arco amarillo: sólo con aire calmo.';
        if (c.flaps > 2 && c.ias > 85) return 'Con flaps, no más de 85 kt (fin del arco blanco).';
        if (c.ias < 1) return 'Sin viento no hay sustentación.';
        return 'Presión del aire: ' + f0(c.ias * c.ias * 0.5 * RHO0 * KT * KT / 9.81) + ' kg por m² de ala.';
      }
    });
    var aoa = control({
      key: 'aoa', label: 'Ángulo de ataque', path: 'tunnel.aoa', min: AOA_MIN, max: AOA_MAX, step: 0.1, cls: 'lab-ctl--big',
      get: function (s, c) { return L.mode === 'tunel' ? num(getIn('tunnel.aoa'), 0) : (c ? c.aoa : 0); },
      fmt: function (v) { return f1(v) + '°'; },
      track: function (c) { return aoaTrack(c); },
      ticks: [{ v: 0, t: '0°' }, { v: 12.5, t: 'bocina' }, { v: 16, t: 'pérdida', cls: 'is-red' }],
      onUpd: function (c, o) {
        if (!c || !o.ticks) return;
        var t1 = o.ticks[1].el, t2 = o.ticks[2].el;
        if (t1) t1.style.left = pctOf(c.hornAoa, AOA_MIN, AOA_MAX);
        if (t2) { t2.style.left = pctOf(c.stallAoa, AOA_MIN, AOA_MAX); A.setText(t2, 'pérdida ' + f0(c.stallAoa) + '°'); }
      },
      quick: [{ v: 0, t: '0°' }, { v: 4, t: 'Crucero 4°' }, { v: 8, t: 'Planeo 8°' }, { v: 13.5, t: 'Bocina' }, { v: 18, t: 'Pérdida' }],
      sub: function (c) {
        if (!c) return '';
        if (c.stalled) return 'Pérdida: el aire se despega del ala.';
        if (c.horn) return 'Bocina: faltan ' + f1(c.stallAoa - c.aoa) + '° para la pérdida.';
        if (c.aoa < 0) return 'Ángulo negativo: el ala empuja para abajo.';
        return 'Ángulo entre el ala y el viento que le llega.';
      }
    });
    tunnelOnly.push(ias, aoa);
    var thr = control({
      key: 'thr', label: 'Acelerador', path: 'throttle', min: 0, max: 1, step: 0.01,
      fmt: function (v, c) { return Math.round(v * 100) + ' % · ' + (c ? Math.round(c.rpm / 10) * 10 : 0) + ' RPM'; },
      ends: ['Ralentí', 'A fondo'],
      quick: [{ v: 0, t: 'Ralentí' }, { v: 0.5, t: 'Media' }, { v: 0.8, t: 'Crucero' }, { v: 1, t: 'A fondo' }],
      sub: function (c) { return c ? 'Empuje ' + kg(c.thrustKg) + ' kg · chorro de la hélice +' + f0(c.propWash * 1.944) + ' kt' : ''; }
    });
    var flaps = buildFlaps();
    var roll = control({
      key: 'roll', label: 'Volante: girar', path: 'yokeRoll', min: -1, max: 1, step: 0.02, center: true,
      fmt: function (v) { return side(v, 'Izquierda', 'Derecha'); }, ends: ['← Izquierda', 'Derecha →'],
      sub: function (c) { return c ? 'Alerón izq. ' + degTxt(c.sf.aileronL, '↑', '↓') + ' · der. ' + degTxt(c.sf.aileronR, '↑', '↓') : ''; }
    });
    var pitch = control({
      key: 'pitch', label: 'Volante: tirar / empujar', path: 'yokePitch', min: -1, max: 1, step: 0.02, center: true,
      fmt: function (v) { return side(v, 'Empujado', 'Tirado'); }, ends: ['Empujar', 'Tirar'],
      sub: function (c) { return c ? 'Timón de profundidad ' + degTxt(c.sf.elevator, '↑', '↓') : ''; }
    });
    var rud = control({
      key: 'rud', label: 'Pedales', path: 'rudder', min: -1, max: 1, step: 0.02, center: true,
      fmt: function (v) { return side(v, 'Izquierdo', 'Derecho', 'Pies parejos'); }, ends: ['← Pedal izq.', 'Pedal der. →'],
      sub: function (c) { return c ? 'Timón de dirección ' + (Math.abs(c.sf.rudder) < 0.5 ? '0°' : f0(Math.abs(c.sf.rudder)) + '° a la ' + (c.sf.rudder > 0 ? 'derecha' : 'izquierda')) : ''; }
    });
    var trim = control({
      key: 'trim', label: 'Compensador', path: 'trim', min: -1, max: 1, step: 0.02, center: true,
      fmt: function (v) { return side(v, 'Nariz abajo', 'Nariz arriba', 'Neutro'); }, ends: ['Nariz abajo', 'Nariz arriba'],
      sub: function (c) { return c ? 'Aletita del compensador ' + degTxt(c.sf.trimTab, '↑', '↓') : ''; }
    });
    L.el.tunnelOnly = tunnelOnly;
    var center = h('button', { type: 'button', class: 'btn btn--small lab-center-btn', onclick: function () {
      ['yokeRoll', 'yokePitch', 'rudder'].forEach(function (p) { tweenTo(p, 0); });
    } }, A.icon('retry'), 'Centrar volante y pedales');
    L.el.modeNote = h('p', { class: 'lab-mode-note' });
    return h('div', { class: 'lab-ctls' },
      L.el.modeNote,
      h('div', { class: 'lab-ctl-group lab-ctl-group--wind' }, ias.row, aoa.row),
      h('div', { class: 'lab-ctl-group' }, thr.row, flaps),
      h('div', { class: 'lab-ctl-group' }, roll.row, pitch.row, rud.row, trim.row, h('div', { class: 'lab-ctl-actions' }, center)));
  }

  function buildFlaps() {
    var btns = [];
    var seg = h('div', { class: 'lab-detents', role: 'group', 'aria-label': 'Flaps: elegí la posición' });
    [0, 10, 20, 30, 40].forEach(function (d) {
      var b = h('button', { type: 'button', class: 'lab-detent', 'aria-pressed': 'false', onclick: function () {
        setFlaps(d);
        if (L.exp) noteManual();
      } }, h('span', { class: 'lab-detent-n', text: d + '°' }));
      b.setAttribute('aria-label', 'Flaps ' + d + ' grados');
      btns.push({ d: d, b: b });
      seg.appendChild(b);
    });
    var fill = h('span', { class: 'lab-flapbar-fill' });
    var tgt = h('span', { class: 'lab-flapbar-target', hidden: true });
    var bar = h('div', { class: 'lab-flapbar', 'aria-hidden': 'true' }, fill, tgt);
    var val = h('output', { class: 'lab-ctl-val' });
    var sub = h('p', { class: 'lab-ctl-sub' });
    L.live.push(function (s, c) {
      var f = c ? c.flaps : 0, tg = L.flapTarget;
      fill.style.width = (f / FLAP_MAX * 100).toFixed(2) + '%';
      tgt.hidden = tg === null;
      if (tg !== null) tgt.style.left = (tg / FLAP_MAX * 100).toFixed(2) + '%';
      var moving = tg !== null || (s && (s.flapSwitch === 'DOWN' || s.flapSwitch === 'UP') && busOn(s));
      A.setText(val, f0(f) + '°' + (moving ? (s && s.flapSwitch === 'UP' ? ' ↑' : ' ↓') : ''));
      btns.forEach(function (x) {
        var on = tg !== null ? x.d === tg : (Math.abs(f - x.d) < 0.6);
        A.setAttr(x.b, 'aria-pressed', on ? 'true' : 'false');
        A.toggleClass(x.b, 'is-moving', tg !== null && x.d === tg);
      });
      if (!s || !busOn(s)) A.setText(sub, 'Sin electricidad los flaps no se mueven: acá los ponemos directo.');
      else if (tg !== null) A.setText(sub, 'El motor eléctrico los mueve a la velocidad real (≈ 9 s de 0° a 40°)…');
      else if (c) A.setText(sub, f < 1 ? 'Flaps arriba: ala limpia.' : 'Sustentación extra de los flaps: ' + kg(c.flapLiftKg) + ' kg');
    });
    return h('div', { class: 'lab-ctl' },
      h('div', { class: 'lab-ctl-head' }, h('span', { class: 'lab-ctl-label', text: 'Flaps' }), val),
      seg, bar, sub);
  }

  /* ---------- 03 FUERZAS: free-body diagram + bars */

  var FB = { cx: 168, cy: 98, wingX: 162, wingY: 76, noseX: 92, tailX: 252, scaleW: 44 };
  function buildForces() {
    var svg = svgEl('svg', { viewBox: '0 0 340 200', class: 'lab-fbd', role: 'img', 'aria-label': 'Diagrama de las cuatro fuerzas sobre el avión' });
    var defs = svgEl('defs', {});
    ['lift', 'weight', 'thrust', 'drag', 'net', 'wind'].forEach(function (k) {
      var m = svgEl('marker', { id: 'lab-ah-' + k, viewBox: '0 0 10 10', refX: '7', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' });
      m.appendChild(svgEl('path', { d: 'M0,0 L10,5 L0,10 z', class: 'lab-ah lab-ah--' + k }));
      defs.appendChild(m);
    });
    svg.appendChild(defs);
    var wind = svgEl('g', { class: 'lab-fbd-wind' });
    [40, 70, 130, 160].forEach(function (y) {
      wind.appendChild(svgEl('line', { x1: '8', y1: String(y), x2: '46', y2: String(y), 'marker-end': 'url(#lab-ah-wind)' }));
    });
    var windLbl = svgEl('text', { x: '8', y: '190', class: 'lab-fbd-small' }); windLbl.textContent = 'viento relativo →';
    wind.appendChild(windLbl);
    svg.appendChild(wind);
    var plane = svgEl('g', { class: 'lab-fbd-plane' });
    plane.appendChild(svgEl('path', { class: 'lab-fbd-body', d: 'M96,101 C96,94 103,91 112,90 L130,89 L139,80 L178,78 L186,86 L242,93 L254,94 L254,99 L186,106 L120,108 C104,108 96,106 96,101 Z' }));
    plane.appendChild(svgEl('path', { class: 'lab-fbd-wing', d: 'M140,78 C144,73 164,72 184,76 L184,79 L140,79 Z' }));
    plane.appendChild(svgEl('path', { class: 'lab-fbd-body', d: 'M228,93 L240,64 L252,64 L255,94 Z' }));
    plane.appendChild(svgEl('path', { class: 'lab-fbd-body', d: 'M230,96 L258,95 L258,98 L232,99 Z' }));
    plane.appendChild(svgEl('line', { class: 'lab-fbd-prop', x1: '93', y1: '82', x2: '93', y2: '120' }));
    plane.appendChild(svgEl('line', { class: 'lab-fbd-strut', x1: '150', y1: '79', x2: '158', y2: '96' }));
    plane.appendChild(svgEl('line', { class: 'lab-fbd-strut', x1: '160', y1: '106', x2: '164', y2: '120' }));
    plane.appendChild(svgEl('circle', { class: 'lab-fbd-wheel', cx: '164', cy: '123', r: '5' }));
    plane.appendChild(svgEl('line', { class: 'lab-fbd-strut', x1: '112', y1: '107', x2: '112', y2: '120' }));
    plane.appendChild(svgEl('circle', { class: 'lab-fbd-wheel', cx: '112', cy: '123', r: '4' }));
    svg.appendChild(plane);
    var arrows = {};
    ['lift', 'weight', 'thrust', 'drag', 'net'].forEach(function (k) {
      var g = svgEl('g', { class: 'lab-fbd-arrow lab-fbd-arrow--' + k });
      var ln = svgEl('line', { 'marker-end': 'url(#lab-ah-' + k + ')' });
      var tx = svgEl('text', { class: 'lab-fbd-label' });
      g.appendChild(ln); g.appendChild(tx);
      svg.appendChild(g);
      arrows[k] = { g: g, ln: ln, tx: tx };
    });
    var cg = svgEl('circle', { class: 'lab-fbd-cg', cx: String(FB.cx), cy: String(FB.cy), r: '3.2' });
    svg.appendChild(cg);
    L.el.fbd = { svg: svg, plane: plane, wind: wind, arrows: arrows };

    function bar(key, label) {
      var fill = h('span', { class: 'lab-bar-fill' });
      var over = h('span', { class: 'lab-bar-over', hidden: true, text: '›' });
      var v = h('span', { class: 'lab-bar-val' });
      var row = h('div', { class: 'lab-bar lab-bar--' + key },
        h('span', { class: 'lab-bar-name', text: label }),
        h('span', { class: 'lab-bar-track', 'aria-hidden': 'true' }, fill, over), v);
      return { row: row, fill: fill, over: over, v: v };
    }
    var bars = { lift: bar('lift', 'Sustentación'), weight: bar('weight', 'Peso'), thrust: bar('thrust', 'Empuje'), drag: bar('drag', 'Resistencia') };
    L.el.bars = bars;
    var balV = h('span', { class: 'lab-bal-v' }), balH = h('span', { class: 'lab-bal-h' }), ld = h('span', { class: 'lab-ld' });
    var ldBar = h('span', { class: 'lab-ld-fill' });
    L.el.bal = { v: balV, h: balH, ld: ld, ldBar: ldBar };
    return h('div', { class: 'lab-forces' },
      svg,
      h('div', { class: 'lab-bars' },
        h('p', { class: 'lab-bars-cap', text: 'Arriba y abajo' }), bars.lift.row, bars.weight.row,
        h('p', { class: 'lab-bars-cap', text: 'Adelante y atrás' }), bars.thrust.row, bars.drag.row),
      h('div', { class: 'lab-balance' },
        h('div', { class: 'lab-bal' }, h('span', { class: 'lab-bal-k', text: 'Vertical' }), balV),
        h('div', { class: 'lab-bal' }, h('span', { class: 'lab-bal-k', text: 'Horizontal' }), balH),
        h('div', { class: 'lab-bal lab-bal--ld' }, h('span', { class: 'lab-bal-k', text: 'Eficiencia del ala (L/D)', title: 'Cuántos metros avanza el avión por cada metro que baja, planeando' }), ld,
          h('span', { class: 'lab-ld-track', 'aria-hidden': 'true' }, ldBar))));
  }

  function setArrow(a, x1, y1, x2, y2, label, lx, ly, anchor, show) {
    a.g.style.display = show ? '' : 'none';
    if (!show) return;
    a.ln.setAttribute('x1', x1.toFixed(1)); a.ln.setAttribute('y1', y1.toFixed(1));
    a.ln.setAttribute('x2', x2.toFixed(1)); a.ln.setAttribute('y2', y2.toFixed(1));
    a.tx.setAttribute('x', lx.toFixed(1)); a.tx.setAttribute('y', ly.toFixed(1));
    a.tx.setAttribute('text-anchor', anchor);
    if (a.tx.textContent !== label) a.tx.textContent = label;
  }

  function updateForces(c) {
    var F = L.el.fbd, B = L.el.bars;
    if (!F || !c) return;
    var W = Math.max(1, c.weightKg), sc = FB.scaleW / W;          // px per kg (vertical)
    var hs = 0.28;                                                // px per kg (horizontal)
    var gam = c.tunel ? 0 : clamp(Math.atan2(c.vs * 0.00508, Math.max(5, c.ias * KT)) * 180 / Math.PI, -25, 25);
    var pitchDeg = c.tunel ? c.aoa - 3 : c.pitch;                // fuselage reference is 3° below the wing zero-lift line
    F.plane.setAttribute('transform', 'rotate(' + (pitchDeg).toFixed(2) + ' ' + FB.cx + ' ' + FB.cy + ')');
    F.wind.setAttribute('transform', 'rotate(' + (-gam).toFixed(2) + ' 27 100)');
    // lift ⟂ relative wind, drag ∥ relative wind, weight down, thrust along the fuselage
    var gr = -gam * Math.PI / 180;              // screen angle of the wind (nose left → wind blows toward +x)
    var wx = Math.cos(gr), wy = Math.sin(gr);   // wind direction (toward the tail)
    var lx = wy, ly = -wx;                      // perpendicular, pointing up
    var Lp = clamp(c.liftKg * sc, 0, 82), Wp = c.weightKg * sc;
    setArrow(F.arrows.lift, FB.wingX, FB.wingY, FB.wingX + lx * Lp, FB.wingY + ly * Lp,
      'Sustentación ' + kg(c.liftKg) + ' kg', FB.wingX + lx * Lp + 6, Math.max(12, FB.wingY + ly * Lp + 4), 'start', Lp > 2);
    setArrow(F.arrows.weight, FB.cx, FB.cy, FB.cx, FB.cy + Wp, 'Peso ' + kg(c.weightKg) + ' kg', FB.cx + 9, Math.min(196, FB.cy + Wp + 2), 'start', true);
    var pr = pitchDeg * Math.PI / 180, ax = -Math.cos(pr), ay = -Math.sin(pr);   // nose direction on screen
    var nx = FB.cx + (FB.noseX - FB.cx) * Math.cos(pr), ny = FB.cy + (FB.noseX - FB.cx) * Math.sin(pr);
    var Tp = clamp(Math.max(0, c.thrustKg) * hs, 0, 82);
    setArrow(F.arrows.thrust, nx, ny, nx + ax * Tp, ny + ay * Tp, 'Empuje ' + kg(Math.max(0, c.thrustKg)) + ' kg',
      4, Math.min(ny, ny + ay * Tp) - 12, 'start', Tp > 2);
    var tx0 = FB.cx + (FB.tailX - FB.cx) * Math.cos(pr), ty0 = FB.cy + (FB.tailX - FB.cx) * Math.sin(pr);
    var Dp = clamp(c.dragKg * hs, 0, 72);
    setArrow(F.arrows.drag, tx0, ty0, tx0 + wx * Dp, ty0 + wy * Dp, 'Resistencia ' + kg(c.dragKg) + ' kg',
      336, Math.max(ty0, ty0 + wy * Dp) + 24, 'end', Dp > 2);
    // net force (where the airplane would go): vertical L·cos − W and horizontal T − D (body-ish frame)
    var netV = c.liftKg - c.weightKg, netH = Math.max(0, c.thrustKg) - c.dragKg;
    var nlen = Math.sqrt(netV * netV + netH * netH);
    var show = nlen > Math.max(25, 0.05 * W) && c.ias > 5;
    var k2 = clamp(nlen * 0.12, 10, 46) / Math.max(nlen, 1e-6);
    // drawn from a point just left of the CG so it never hides the weight arrow; label on the left side
    var nx0 = FB.cx - 22, ny0 = FB.cy + 2;
    setArrow(F.arrows.net, nx0, ny0, nx0 - netH * k2, ny0 - netV * k2, c.tunel ? '- - › hacia dónde iría suelto' : '- - › fuerza neta',
      336, 194, 'end', show);
    // bars
    var vMax = Math.max(2 * W, 1), hMax = Math.max(250, Math.ceil(Math.max(c.thrustKg, c.dragKg) / 50) * 50);
    if (hMax > 600) hMax = 600;
    function setBar(b, v, max) {
      var f = clamp(Math.abs(v) / max, 0, 1);
      b.fill.style.transform = 'scaleX(' + f.toFixed(4) + ')';
      b.over.hidden = Math.abs(v) <= max;
      A.setText(b.v, kg(v) + ' kg');
    }
    setBar(B.lift, c.liftKg, vMax); setBar(B.weight, c.weightKg, vMax);
    setBar(B.thrust, Math.max(0, c.thrustKg), hMax); setBar(B.drag, c.dragKg, hMax);
    var pre = c.tunel ? 'Suelto: ' : '';
    var tolV = 0.05 * W;
    A.setText(L.el.bal.v, c.ias < 3 ? 'sin viento' : (netV > tolV ? pre + 'sube ↑' : (netV < -tolV ? pre + 'baja ↓' : 'equilibrio =')));
    A.setText(L.el.bal.h, c.ias < 3 && c.thrustKg < 5 ? '—' : (netH > 8 ? pre + 'acelera →' : (netH < -8 ? pre + 'frena ←' : 'velocidad constante =')));
    A.setText(L.el.bal.ld, c.ias < 3 ? '—' : f1(c.lOverD) + ' : 1');
    L.el.bal.ldBar.style.transform = 'scaleX(' + clamp(c.lOverD / 14, 0, 1).toFixed(3) + ')';
  }

  /* ---------- 04 EL ALA POR DENTRO */

  function buildAirfoil() {
    var Af = C150.Airfoil;
    if (!Af || !isFn(Af.create)) return null;
    var cv = h('canvas', { class: 'lab-airfoil', role: 'img', 'aria-label': 'El perfil del ala con el aire pasando: arrastrá para cambiar el ángulo de ataque' });
    var hint = h('p', { class: 'lab-hint' }, A.icon('hand'), h('span', { text: 'Arrastrá sobre el ala para cambiar el ángulo de ataque (en el túnel).' }));
    var legend = h('ul', { class: 'lab-legend', 'aria-label': 'Colores' },
      h('li', null, h('span', { class: 'lab-sw lab-sw--low' }), 'Baja presión (arriba)'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--high' }), 'Alta presión (abajo)'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--slow' }), 'Aire lento'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--fast' }), 'Aire rápido'));
    var wrap = h('div', { class: 'lab-airfoil-wrap' }, cv, hint, legend);
    L.el.afCanvas = cv;
    L.el.afHint = hint;
    return wrap;
  }
  function ensureAirfoil() {
    if (L.af || !L.el.afCanvas) return;
    var Af = C150.Airfoil;
    L.af = A.safe(function () {
      return Af.create(L.el.afCanvas, {
        onDrag: function (aoa) {
          if (L.mode !== 'tunel' || !isFinite(aoa)) return;
          cancelTween('tunnel.aoa');
          setIn('tunnel.aoa', clamp(aoa, AOA_MIN, AOA_MAX));
          if (L.exp) noteManual();
        }
      });
    }, 'Airfoil.create') || null;
    if (!L.af) { var sec = L.el.secAirfoil; if (sec) sec.hidden = true; }
  }

  /* ---------- 05 CURVA DE SUSTENTACIÓN */

  function buildChart() {
    var cv = h('canvas', { class: 'lab-chart', role: 'img', 'aria-label': 'Curva de sustentación: coeficiente de sustentación según el ángulo de ataque' });
    var tip = h('div', { class: 'lab-chart-tip', hidden: true, 'aria-hidden': 'true' });
    var legend = h('ul', { class: 'lab-legend lab-legend--chart' },
      h('li', null, h('span', { class: 'lab-sw lab-sw--curve' }), h('span', { class: 'lab-leg-cur' })),
      h('li', { class: 'lab-leg-ref' }, h('span', { class: 'lab-sw lab-sw--ref' }), 'Flaps 0° (referencia)'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--stall' }), 'Zona de pérdida'));
    var read = h('p', { class: 'lab-chart-read' });
    var box = h('div', { class: 'lab-chart-box' }, cv, tip);
    cv.addEventListener('pointermove', function (e) {
      var r = cv.getBoundingClientRect(), pl = chartPlot(r.width, r.height);
      var a = pl.a0 + (e.clientX - r.left - pl.x0) / (pl.x1 - pl.x0) * (pl.a1 - pl.a0);
      L.hoverAoa = (a >= pl.a0 && a <= pl.a1) ? a : null;
      L.chartDirty = true;
    });
    cv.addEventListener('pointerleave', function () { L.hoverAoa = null; L.chartDirty = true; });
    L.el.chart = cv; L.el.chartTip = tip; L.el.chartRead = read;
    L.el.legCur = legend.querySelector('.lab-leg-cur'); L.el.legRef = legend.querySelector('.lab-leg-ref');
    return h('div', { class: 'lab-chart-wrap' }, box, legend, read);
  }
  function chartPlot(w, hh) {
    return { x0: 34, x1: w - 10, y0: 10, y1: hh - 26, a0: -8, a1: 22, c0: -0.6, c1: 2.0 };
  }
  function clAtCurve(pts, a) {
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].aoa >= a) {
        var p0 = pts[i - 1], p1 = pts[i], u = (a - p0.aoa) / ((p1.aoa - p0.aoa) || 1);
        return p0.cl + (p1.cl - p0.cl) * u;
      }
    }
    return pts.length ? pts[pts.length - 1].cl : 0;
  }
  function drawChart(c) {
    var cv = L.el.chart;
    if (!cv || !c || cv.offsetParent === null) return;
    var w = cv.clientWidth, hh = cv.clientHeight;
    if (w < 40 || hh < 40) return;
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    var g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    var host = L.el.panel;
    var col = {
      fg: cssVar(host, '--fg', '#13202B'), soft: cssVar(host, '--fg-soft', '#4A5966'), line: cssVar(host, '--line', '#C3CCD3'),
      acc: cssVar(host, '--accent', '#C8641A'), red: cssVar(host, '--arc-red', '#C7362B'), yel: cssVar(host, '--arc-yellow', '#D9A400'),
      surf: cssVar(host, '--surface', '#F6F8F9')
    };
    var pl = chartPlot(w, hh);
    function X(a) { return pl.x0 + (a - pl.a0) / (pl.a1 - pl.a0) * (pl.x1 - pl.x0); }
    function Y(v) { return pl.y1 - (v - pl.c0) / (pl.c1 - pl.c0) * (pl.y1 - pl.y0); }
    g.font = '11px ' + cssVar(host, '--font-data', 'monospace');
    // zones
    g.globalAlpha = 0.14; g.fillStyle = col.yel; g.fillRect(X(c.hornAoa), pl.y0, X(c.stallAoa) - X(c.hornAoa), pl.y1 - pl.y0);
    g.globalAlpha = 0.16; g.fillStyle = col.red; g.fillRect(X(c.stallAoa), pl.y0, pl.x1 - X(c.stallAoa), pl.y1 - pl.y0);
    g.globalAlpha = 1;
    g.fillStyle = col.red; g.textAlign = 'right'; g.fillText('PÉRDIDA', pl.x1 - 4, pl.y0 + 12);
    // grid
    g.strokeStyle = col.line; g.lineWidth = 1; g.fillStyle = col.soft;
    g.textAlign = 'right';
    [-0.5, 0, 0.5, 1, 1.5].forEach(function (v) {
      g.globalAlpha = v === 0 ? 0.9 : 0.5;
      g.beginPath(); g.moveTo(pl.x0, Math.round(Y(v)) + 0.5); g.lineTo(pl.x1, Math.round(Y(v)) + 0.5); g.stroke();
      g.globalAlpha = 1; g.fillText(A.fmt(v, 1), pl.x0 - 4, Y(v) + 4);
    });
    g.textAlign = 'center';
    [-5, 0, 5, 10, 15, 20].forEach(function (a) {
      g.globalAlpha = a === 0 ? 0.9 : 0.35;
      g.beginPath(); g.moveTo(Math.round(X(a)) + 0.5, pl.y0); g.lineTo(Math.round(X(a)) + 0.5, pl.y1); g.stroke();
      g.globalAlpha = 1; g.fillText(A.fmt(a, 0) + '°', X(a), pl.y1 + 14);
    });
    g.fillStyle = col.soft; g.textAlign = 'left'; g.fillText('cl', 4, pl.y0 + 8);
    g.textAlign = 'right'; g.fillText('ángulo de ataque', pl.x1, hh - 1);
    // curves
    function curve(pts, color, width, dash) {
      g.save(); g.beginPath(); g.rect(pl.x0, pl.y0, pl.x1 - pl.x0, pl.y1 - pl.y0); g.clip();
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.lineJoin = 'round';
      g.beginPath();
      pts.forEach(function (p, i) { if (i) g.lineTo(X(p.aoa), Y(p.cl)); else g.moveTo(X(p.aoa), Y(p.cl)); });
      g.stroke(); g.restore();
    }
    var ptsCur = Lab.clCurve(c.flaps);
    if (c.flaps > 1) curve(Lab.clCurve(0), col.soft, 1.5, [5, 4]);
    curve(ptsCur, col.acc, 2.5);
    // current point (the live AoA / cl)
    var a = clamp(c.aoa, pl.a0, pl.a1), cl = (c.ias > 1) ? clAtCurve(ptsCur, a) : clAtCurve(ptsCur, a);
    if (c.ias > 1 && isFinite(c.cl) && Math.abs(c.cl - cl) < 0.6) cl = c.cl;
    var px = X(a), py = Y(clamp(cl, pl.c0, pl.c1));
    g.setLineDash([3, 3]); g.strokeStyle = col.soft; g.lineWidth = 1; g.globalAlpha = 0.8;
    g.beginPath(); g.moveTo(px, pl.y1); g.lineTo(px, py); g.lineTo(pl.x0, py); g.stroke();
    g.setLineDash([]); g.globalAlpha = 0.25; g.fillStyle = c.stalled ? col.red : col.acc;
    g.beginPath(); g.arc(px, py, 11, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1; g.beginPath(); g.arc(px, py, 5.5, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = col.surf; g.stroke();
    // hover readout
    var tip = L.el.chartTip;
    if (L.hoverAoa !== null) {
      var hc = clAtCurve(ptsCur, L.hoverAoa), hx = X(L.hoverAoa);
      g.strokeStyle = col.fg; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); g.moveTo(hx, pl.y0); g.lineTo(hx, pl.y1); g.stroke();
      g.globalAlpha = 1; g.fillStyle = col.fg; g.beginPath(); g.arc(hx, Y(clamp(hc, pl.c0, pl.c1)), 3.5, 0, Math.PI * 2); g.fill();
      tip.hidden = false;
      A.setText(tip, f1(L.hoverAoa) + '° → cl ' + A.fmt(hc, 2) + (L.hoverAoa > c.stallAoa ? ' · pérdida' : ''));
      tip.style.left = clamp(hx, 60, w - 60) + 'px';
    } else tip.hidden = true;
  }
  function updateChartText(c) {
    if (!L.el.chartRead || !c) return;
    A.setText(L.el.legCur, 'Flaps ' + f0(c.flaps) + '° (ahora)');
    L.el.legRef.hidden = c.flaps <= 1;
    A.setText(L.el.chartRead, c.ias < 1 ? 'Sin viento: el punto marca el ángulo, pero no hay sustentación.'
      : 'Ahora: ' + f1(c.aoa) + '° → cl ' + A.fmt(c.cl, 2) + '. Pérdida a ' + f0(c.stallAoa) + '° · cl máx. ' + A.fmt(maxCl(c.flaps), 2) + '.');
    var key = [Math.round(c.aoa * 10), Math.round(c.flaps * 2), Math.round(c.cl * 100), c.stalled ? 1 : 0, L.hoverAoa === null ? '' : Math.round(L.hoverAoa * 10)].join('|');
    if (key !== L.chartKey) { L.chartKey = key; L.chartDirty = true; }
  }
  function maxCl(f) { return Lab.clCurve(f).reduce(function (m, p) { return Math.max(m, p.cl); }, 0); }

  /* ---------- the stage over the 3D */

  function buildStage() {
    var vp = A.viewport;
    if (!vp) return;
    var big1v = h('span', { class: 'lab-big-v' }), big1u = h('span', { class: 'lab-big-u' }), big1l = h('span', { class: 'lab-big-l' });
    var big2v = h('span', { class: 'lab-big-v' }), big2u = h('span', { class: 'lab-big-u' }), big2l = h('span', { class: 'lab-big-l' });
    var kick = h('span', { class: 'lab-hud-mode' });
    var row = h('p', { class: 'lab-hud-row' });
    var flowSt = h('p', { class: 'lab-flowstate' });
    var hud = h('div', { class: 'lab-hud' },
      h('p', { class: 'lab-hud-kicker' }, h('span', { class: 'lab-live-dot', 'aria-hidden': 'true' }), kick),
      h('div', { class: 'lab-hud-big' },
        h('div', { class: 'lab-big' }, h('span', { class: 'lab-big-num' }, big1v, big1u), big1l),
        h('div', { class: 'lab-big' }, h('span', { class: 'lab-big-num' }, big2v, big2u), big2l)),
      row, flowSt);
    var narr = h('div', { class: 'lab-stage-narr', hidden: true, 'aria-hidden': 'true' });
    var viewGrp = h('div', { class: 'lab-bar-grp', role: 'group', 'aria-label': 'Vista de la cámara' }, h('span', { class: 'lab-bar-k', text: 'Vista' }));
    L.el.viewBtns = [];
    VIEWS.forEach(function (v) {
      var b = h('button', { type: 'button', class: 'lab-tb', 'data-view': v[0], 'aria-pressed': 'false', onclick: function () { setLabView(v[0]); } }, v[1]);
      L.el.viewBtns.push(b); viewGrp.appendChild(b);
    });
    var capGrp = h('div', { class: 'lab-bar-grp', role: 'group', 'aria-label': 'Qué mostrar en el aire' }, h('span', { class: 'lab-bar-k', text: 'Capas' }));
    L.el.capBtns = [];
    CAPAS.forEach(function (cp) {
      var b = h('button', { type: 'button', class: 'lab-tb lab-tb--chip', 'data-capa': cp[0], 'aria-pressed': 'false', title: cp[2], onclick: function () {
        L.capas[cp[0]] = !L.capas[cp[0]];
        A.store.set('labCapas', L.capas);
        pushAirflow(); syncCapas();
      } }, h('span', { class: 'lab-tb-dot', 'aria-hidden': 'true' }), cp[1]);
      L.el.capBtns.push(b); capGrp.appendChild(b);
    });
    var bar = h('div', { class: 'lab-toolbar' }, viewGrp, capGrp);
    var stage = h('div', { class: 'lab-stage', id: 'lab-stage', hidden: true }, hud, narr, bar);
    vp.appendChild(stage);
    L.el.stage = stage; L.el.stageNarr = narr; L.el.toolbar = bar;
    function barH() { if (!stage.hidden) vp.style.setProperty('--lab-bar-h', Math.round(bar.offsetHeight || 52) + 'px'); }
    if (root.ResizeObserver) new ResizeObserver(barH).observe(bar);
    L.barH = barH;
    L.el.hud = { kick: kick, b1: [big1v, big1u, big1l], b2: [big2v, big2u, big2l], row: row, flow: flowSt };
  }
  function syncCapas() {
    var avail = airflowAvailable();
    (L.el.capBtns || []).forEach(function (b) {
      var k = b.getAttribute('data-capa');
      A.setAttr(b, 'aria-pressed', L.capas[k] ? 'true' : 'false');
      b.disabled = !avail;
      if (!avail) b.title = 'El flujo de aire 3D no está disponible en este navegador';
    });
  }
  function updateHud(c) {
    var H = L.el.hud;
    if (!H || !c) return;
    var tun = c.tunel;
    A.setText(H.kick, tun ? 'Túnel de viento · avión quieto' + (L.fake ? ' (estimado)' : '') : 'En vuelo · el avión reacciona');
    if (tun) {
      A.setText(H.b1[0], f0(c.ias)); A.setText(H.b1[1], 'nudos'); A.setText(H.b1[2], 'viento');
      A.setText(H.b2[0], f1(c.aoa)); A.setText(H.b2[1], '°'); A.setText(H.b2[2], 'ángulo de ataque');
    } else {
      A.setText(H.b1[0], f0(c.ias)); A.setText(H.b1[1], 'nudos'); A.setText(H.b1[2], 'velocidad');
      A.setText(H.b2[0], (c.vs > 0 ? '+' : '') + f0(Math.round(c.vs / 10) * 10)); A.setText(H.b2[1], 'pies/min'); A.setText(H.b2[2], c.vs > 100 ? 'subiendo' : (c.vs < -100 ? 'bajando' : 'nivelado'));
    }
    A.setText(H.row, Math.round(c.rpm / 10) * 10 + ' RPM · flaps ' + f0(c.flaps) + '° · eficiencia (L/D) ' + f1(c.lOverD) +
      (tun ? '' : ' · inclinación ' + f0(Math.abs(c.bank)) + '°' + (Math.abs(c.bank) >= 1 ? (c.bank > 0 ? ' der.' : ' izq.') : '')));
    var st = c.ias < 3 ? ['sin viento', 'is-calm'] : (c.stalled ? ['pérdida · aire despegado', 'is-stall'] : (c.horn ? ['bocina · cerca de la pérdida', 'is-horn'] : ['aire pegado al ala', 'is-ok']));
    A.setText(H.flow, st[0]);
    H.flow.className = 'lab-flowstate ' + st[1];
  }

  /* ---------- panel */

  function renderExpList() {
    var ul = L.el.expList;
    if (!ul) return;
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    EXPS().forEach(function (x, i) {
      var cur = L.exp && L.exp.id === x.id;
      var done = L.done.indexOf(x.id) >= 0;
      ul.appendChild(h('li', null, h('button', {
        type: 'button', class: 'lab-exp' + (cur ? ' is-current' : ''), 'aria-current': cur ? 'true' : null,
        onclick: function () { if (A.navDetail) A.navDetail('aire/' + x.id, function () { startExperiment(x.id); }); else startExperiment(x.id); }
      },
        h('span', { class: 'lab-exp-n', text: 'E' + (i + 1) }),
        h('span', { class: 'lab-exp-title', text: x.titulo }),
        h('span', { class: 'lab-exp-sum', text: x.resumen || '' }),
        h('span', { class: 'lab-exp-meta', text: x.pasos.length + ' pasos · ' + (x.modo === 'vuelo' ? 'en vuelo' : 'túnel') + (done ? ' · ✓ hecho' : '') }))));
    });
  }

  function renderRun() {
    var R = L.el.run, ex = L.exp;
    if (!R) return;
    if (!ex) { R.hidden = true; return; }
    var st = ex.pasos[L.step], n = ex.pasos.length, i = L.step;
    R.hidden = false;
    while (R.firstChild) R.removeChild(R.firstChild);
    var idx = EXPS().indexOf(ex);
    var dots = h('div', { class: 'lab-run-dots', role: 'group', 'aria-label': 'Pasos' });
    ex.pasos.forEach(function (p, k) {
      dots.appendChild(h('button', { type: 'button', class: 'lab-run-dot' + (k < i ? ' is-seen' : ''), 'aria-current': k === i ? 'step' : null,
        'aria-label': 'Paso ' + (k + 1) + ': ' + p.titulo, onclick: function () { applyStep(k); } }));
    });
    L.el.runHint = h('p', { class: 'lab-run-hint', hidden: true, text: 'Tocaste un mando: ¡bien! Probá libremente; "Repetir" vuelve a poner el paso.' });
    R.appendChild(h('div', { class: 'lab-run-top' },
      h('p', { class: 'lab-run-kicker' }, h('span', { text: 'Experimento E' + (idx + 1) + ' · ' + ex.titulo }), h('span', { class: 'lab-run-count', text: (i + 1) + ' / ' + n })),
      h('button', { type: 'button', class: 'icon-btn icon-btn--small lab-run-close', 'aria-label': 'Salir del experimento', title: 'Salir del experimento', onclick: function () { if (!(A.navUp && A.navUp())) stopExperiment(); } },
        A.icon('close'))));
    R.appendChild(h('div', { class: 'lab-run-prog', 'aria-hidden': 'true' }, h('span', { style: { width: ((i + 1) / n * 100).toFixed(1) + '%' } })));
    R.appendChild(h('h3', { class: 'lab-run-title', tabindex: '-1', text: st.titulo }));
    R.appendChild(h('p', { class: 'lab-run-text', text: st.texto }));
    if (st.mira) R.appendChild(h('p', { class: 'lab-run-mira' }, A.icon('eye'), h('span', null, h('strong', { text: 'Mirá: ' }), st.mira.replace(/^Mirá:?\s*/i, ''))));
    if (Array.isArray(st.cadena) && st.cadena.length >= 2) R.appendChild(chainEl(st.cadena, 'info', false));
    R.appendChild(L.el.runHint);
    var last = i === n - 1;
    R.appendChild(h('div', { class: 'lab-run-nav' },
      h('button', { type: 'button', class: 'btn btn--small', disabled: i === 0 ? true : null, onclick: function () { applyStep(i - 1); } }, A.icon('back'), 'Anterior'),
      h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: function () { applyStep(i); } }, A.icon('retry'), 'Repetir'),
      last
        ? h('button', { type: 'button', class: 'btn btn--small btn--primary', onclick: function () { markDone(ex.id); if (!(A.navUp && A.navUp())) stopExperiment(); } }, A.icon('check'), 'Terminar')
        : h('button', { type: 'button', class: 'btn btn--small btn--primary', onclick: function () { applyStep(i + 1); } }, 'Siguiente', A.icon('next'))));
    R.appendChild(dots);
    if (A.annotate) A.annotate(R);
  }

  Lab.mount = function (section, api) {
    if (L.mounted) return;
    A = api;
    L.mounted = true;
    L.capas = {};
    var saved = A.store.get('labCapas', null) || {};
    for (var k in DEFAULT_CAPAS) L.capas[k] = (typeof saved[k] === 'boolean') ? saved[k] : DEFAULT_CAPAS[k];
    L.open = A.store.get('labOpen', {}) || {};
    L.done = (A.store.get('labDone', []) || []).filter(function (x) { return typeof x === 'string'; });
    L.mode = A.store.get('labMode', 'tunel') === 'vuelo' ? 'vuelo' : 'tunel';
    L.narrator = Lab.createNarrator((C150.DATA && C150.DATA.labNarration) || []);
    section.classList.add('lab');
    L.el.panel = section;

    var modeBtns = {
      tunel: h('button', { type: 'button', class: 'lab-mode', 'aria-pressed': 'false', onclick: function () { stopExperimentIfAny(); setLabMode('tunel'); } },
        h('span', { class: 'lab-mode-t', text: 'Túnel de viento' }), h('span', { class: 'lab-mode-s', text: 'el avión quieto' })),
      vuelo: h('button', { type: 'button', class: 'lab-mode', 'aria-pressed': 'false', onclick: function () { stopExperimentIfAny(); setLabMode('vuelo'); } },
        h('span', { class: 'lab-mode-t', text: 'En vuelo' }), h('span', { class: 'lab-mode-s', text: 'el avión reacciona' }))
    };
    L.el.modeBtns = modeBtns;

    var head = h('header', { class: 'lab-head' },
      h('p', { class: 'lab-kicker' }, h('span', { class: 'lab-kicker-dot', 'aria-hidden': 'true' }), '04 · Aire · Laboratorio del aire'),
      h('h2', { class: 'lab-title', text: 'Cómo el aire hace volar al avión' }),
      h('p', { class: 'lab-sub', text: 'Mové los mandos y mirá en vivo cómo se mueve el aire, qué fuerzas aparecen y cómo reacciona el avión.' }),
      h('div', { class: 'lab-modes', role: 'group', 'aria-label': 'Modo del laboratorio' }, modeBtns.tunel, modeBtns.vuelo));

    var how = A.acc ? A.acc('Cómo se usa el laboratorio', h('ol', { class: 'steps' },
      h('li', { text: 'Elegí “Túnel de viento” (el avión queda quieto y el aire se mueve) o “En vuelo” (el avión vuela de verdad).' }),
      h('li', { text: 'Empezá por un experimento guiado: te dice qué mover y qué mirar.' }),
      h('li', { text: 'O mové vos los mandos y leé abajo, en “Qué está pasando”, qué le hace eso al aire y al avión.' }),
      h('li', { text: 'Las capas (líneas de aire, fuerzas, presión) se prenden y apagan con los botones sobre el 3D.' })), { icon: 'help' }) : null;
    L.el.run = h('div', { class: 'lab-run', hidden: true, 'aria-live': 'polite' });
    L.el.expList = h('ul', { class: 'lab-exps' });

    var narrNow = h('div', { class: 'lab-narr-now', 'aria-live': 'polite' });
    var narrLog = h('ol', { class: 'lab-narr-log' });
    var narrLogWrap = h('div', { class: 'lab-narr-logwrap', hidden: true }, h('p', { class: 'lab-narr-k', text: 'Antes' }), narrLog);
    var nowLine = h('p', { class: 'lab-nowline' });
    L.el.narrNow = narrNow; L.el.narrLog = narrLog; L.el.narrLogWrap = narrLogWrap; L.el.nowLine = nowLine;
    var colors = h('ul', { class: 'lab-legend lab-legend--air', 'aria-label': 'Colores del aire en el 3D' },
      h('li', null, h('span', { class: 'lab-sw lab-sw--slow' }), 'Aire lento'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--free' }), 'Aire libre'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--fast' }), 'Aire rápido'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--prop' }), 'Chorro de la hélice'),
      h('li', null, h('span', { class: 'lab-sw lab-sw--stall' }), 'Aire despegado'));

    var afBody = buildAirfoil();
    var secs = [
      secBlock('EX', 'exps', 'Experimentos', function () { return EXPS().length + ' guiados'; }, L.el.expList, true),
      secBlock('01', 'mandos', 'Mandos', function (s, c) { return c ? (c.tunel ? f0(c.ias) + ' nudos · ángulo ' + f1(c.aoa) + '°' : f0(c.ias) + ' nudos') : ''; }, buildControls(), true),
      secBlock('02', 'pasa', 'Qué está pasando', null, h('div', null, narrNow, nowLine, narrLogWrap, colors), true),
      secBlock('03', 'fuerzas', 'Fuerzas', function (s, c) { return c ? A.fmt(c.n, 2) + ' g · eficiencia ' + f1(c.lOverD) + ' a 1' : ''; }, buildForces(), true)
    ];
    if (afBody) { L.el.secAirfoil = secBlock('04', 'ala', 'El ala por dentro', function (s, c) { return c ? 'sustentación ' + A.fmt(c.cl, 2) : ''; }, afBody, true); secs.push(L.el.secAirfoil); }
    secs.push(secBlock(afBody ? '05' : '04', 'curva', 'Curva de sustentación', function (s, c) { return c ? 'pérdida ' + f0(c.stallAoa) + '°' : ''; }, buildChart(), true));

    section.appendChild(head);
    if (how) section.appendChild(h('div', { class: 'lab-how' }, how));
    section.appendChild(L.el.run);
    secs.forEach(function (x) { section.appendChild(x); });
    section.appendChild(h('p', { class: 'aviso lab-aviso', text: 'Física simplificada para aprender: los números son aproximados. En el avión real siempre manda el manual (POH) y tu instructor.' }));
    renderExpList();
    buildStage();
    syncCapas();
    syncMode();
    renderNarration();
    if (A.annotate) A.safe(function () {              // glossary popovers in the reading text only
      var txt = section.querySelectorAll('.lab-sub, .lab-how .acc-body, .lab-sec-body > p, .lab-aviso');
      for (var q = 0; q < txt.length; q++) A.annotate(txt[q]);
    }, 'lab.annotate');
  };
  function stopExperimentIfAny() { if (L.exp) stopExperiment(); }

  /* ------------------------------------------------------------------ enter / exit / loop */

  Lab.enter = function () {
    if (!L.mounted || L.active) return;
    L.active = true;
    var vp = A.getMainView();
    L.prev = { preset: A.currentPreset(), view: vp, backdrop: A.has('getBackdrop') ? A.cc('getBackdrop') : null };
    if (L.prev.preset === 'tunnel') L.prev.preset = 'parked';
    if (L.el.stage) L.el.stage.hidden = false;
    if (L.barH) L.barH();
    setLabMode(L.mode);
    ensureAirfoil();
    L.chartDirty = true;
    loopStart();
  };
  Lab.exit = function () {
    if (!L.active) return;
    L.active = false;
    loopStop();
    L.tweens = {}; L.timers = [];
    stopFlapMotor();
    if (L.exp) { L.exp = null; if (L.el.run) L.el.run.hidden = true; renderExpList(); }
    flowFocus(null);
    airflowOff();
    if (L.el.stage) L.el.stage.hidden = true;
    var p = L.prev || {};
    setBackdrop(p.backdrop || 'cielo');
    A.applyPreset(p.preset || 'parked');
    A.cc('setMainView', p.view === 'exterior' ? 'exterior' : 'cockpit');
    A.syncMainView();
    A.kick();
  };

  function loopStart() {
    if (L.loopOn) return;
    L.loopOn = true; L.lastT = now(); L.lastRaf = 0;
    var raf = root.requestAnimationFrame;
    function frame() {
      if (!L.loopOn) return;
      L.lastRaf = now(); tickLoop();
      if (raf) raf(frame);
    }
    if (raf) raf(frame);
    L.iv = root.setInterval(function () { if (L.loopOn && !document.hidden && now() - L.lastRaf > 250) tickLoop(); }, 33);
  }
  function loopStop() { L.loopOn = false; if (L.iv) { root.clearInterval(L.iv); L.iv = 0; } }
  function tickLoop() {
    var t = now(), dt = clamp((t - L.lastT) / 1000, 0, 0.1);
    L.lastT = t;
    A.safe(function () {
      runTweens(dt);
      flapMotor();
      runTimers(dt);
      if (L.af && isFn(L.af.frame) && L.el.afCanvas && L.el.afCanvas.offsetParent !== null) L.af.frame(dt);
      if (L.chartDirty && L.lastSnap) { L.chartDirty = false; drawChart(L.lastSnap); }
    }, 'lab loop');
  }

  Lab.slow = function (s) {
    if (!L.active || !s) return;
    var t = now() / 1000;
    var c = Lab.snap(s, t, fakeTunnel());
    L.lastSnap = c;
    for (var i = 0; i < L.live.length; i++) { try { L.live[i](s, c); } catch (e) { if (root.console) console.error('[Lab] live', e); } }
    updateHud(c);
    updateForces(c);
    updateChartText(c);
    A.setText(L.el.nowLine, c.ias < 1 ? 'Ahora: sin viento, no hay sustentación.' :
      'Ahora: ángulo ' + f1(c.aoa) + '° · cl ' + A.fmt(c.cl, 2) + ' · sustentación ' + kg(c.liftKg) + ' kg = ' + A.fmt(c.n, 2) + ' × peso');
    if (L.af && isFn(L.af.set)) {
      A.safe(function () { L.af.set({ aoa: c.aoa, flaps: c.flaps, ias: c.ias, stallBlend: c.stallBlend, pressure: true, streamlines: true, labels: true }); }, 'airfoil.set');
    }
    if (L.el.afHint) L.el.afHint.hidden = L.mode !== 'tunel';
    if (t - L.narrT >= NARR_DT) {
      L.narrT = t;
      narrate(c, L.narrator ? L.narrator.update(c) : []);
    }
  };
  Lab.frame = function () { /* the lab runs its own smooth loop (tickLoop) */ };

  Lab.setLabMode = function (m) { if (L.mounted) { stopExperimentIfAny(); setLabMode(m); } };
  Lab.startExperiment = function (id, step) { return L.mounted ? startExperiment(id, step) : false; };
  Lab.stopExperiment = function () { if (L.mounted) stopExperiment(); };
  Lab.setView = function (name) { return L.mounted ? setLabView(name) : false; };
  Lab.getInfo = function () {
    return { active: L.active, mode: L.mode, fake: L.fake, experiment: L.exp ? L.exp.id : null, step: L.step,
      capas: L.capas, view: L.view, history: L.history.map(function (x) { return x.cadena.join(' → '); }),
      airflow: L.mounted ? airflowAvailable() : false, airfoil: !!L.af };
  };
})(root.C150);
