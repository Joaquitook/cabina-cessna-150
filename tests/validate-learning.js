/*
 * validate-learning.js — Valida src/data/learning.js contra el contrato técnico.
 * Uso: node tests/validate-learning.js   (sale con código 1 si algo falla)
 *
 *  1. Carga el archivo en un contexto aislado (global falso, sin window) y lee C150.DATA.
 *  2. Verifica estructura y cantidades de lessons, tour, checklists, quiz, glossary y missions.
 *  3. Verifica que todo id de control, animación exterior y preset exista en las listas del contrato.
 *  4. Ejecuta cada check() con estados falsos (campos §3a/§3b) para asegurar que ninguno tira error
 *     y que devuelven el tipo correcto; además simula escenarios para cada checklist y misión y
 *     comprueba que se pueden completar.
 *  5. Si existen src/data/controls-a.js / controls-b.js / src/sim.js, también cruza los ids con las
 *     fichas reales y corre los check() contra estados creados por el simulador real.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');

// ── Listas del contrato (§3c, §5, §6) ──
var CONTROL_IDS = [
  'yoke', 'rudder-pedals', 'toe-brakes', 'parking-brake', 'control-lock', 'trim-wheel', 'flap-switch',
  'flap-indicator', 'throttle', 'mixture', 'carb-heat', 'primer', 'ignition', 'fuel-shutoff', 'fuel-gauges',
  'master', 'light-switches', 'dimmers', 'circuit-breakers', 'ammeter',
  'asi', 'attitude', 'altimeter', 'turn-coordinator', 'heading-indicator', 'vsi', 'compass', 'clock', 'oat',
  'tachometer', 'oil-gauges', 'suction', 'stall-warning', 'navcom', 'transponder', 'vor-indicator',
  'audio-panel', 'microphone', 'cabin-heat', 'cabin-air', 'air-vents', 'seats', 'seatbelts', 'doors', 'placards'
];
var ANIMS = [
  'axes-roll', 'axes-pitch', 'axes-yaw', 'four-forces', 'aoa-stall', 'flaps-extend', 'trim-tab', 'adverse-yaw',
  'left-turning', 'coordinated-turn', 'ground-steering', 'propeller-throttle', 'lights-demo', 'controls-check',
  'carb-ice', 'pitot-static'
];
var PRESETS = ['parked', 'runup', 'runway', 'cruise', 'approach'];

var fallas = 0, pruebas = 0;
function ok(cond, msg) {
  pruebas++;
  if (!cond) { fallas++; console.error('  FALLA: ' + msg); }
}
function seccion(t) { console.log('\n== ' + t); }
function texto(v) { return typeof v === 'string' && v.trim().length > 0; }

// ── Carga en contexto aislado ──
function cargar(archivos) {
  var ctx = { console: console, Math: Math };
  vm.createContext(ctx);
  archivos.forEach(function (f) {
    var code = fs.readFileSync(f, 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  });
  return ctx;
}

var learningPath = path.join(SRC, 'data', 'learning.js');
var sandbox = cargar([learningPath]);
var DATA = sandbox.C150 && sandbox.C150.DATA;
ok(!!DATA, 'C150.DATA existe después de cargar learning.js');
if (!DATA) { console.error('No se pudo cargar C150.DATA'); process.exit(1); }

// ── Estado falso con todos los campos de §3a/§3b ──
function merge(base, extra) {
  Object.keys(extra || {}).forEach(function (k) {
    var v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') merge(base[k], v);
    else base[k] = v;
  });
  return base;
}
// Copia profunda de `base` con `extra` mezclado encima (no modifica `base`).
function mezclar(base, extra) { return merge(JSON.parse(JSON.stringify(base)), extra); }
function estado(extra) {
  var s = {
    variant: '150M', yokeRoll: 0, yokePitch: 0, rudder: 0, brakeL: 0, brakeR: 0, parkingBrake: true,
    controlLock: true, throttle: 0, mixture: 0, carbHeat: 0, primerOut: 0, primerLocked: true,
    ignition: 'OFF', masterBat: false, masterAlt: false, flapSwitch: 'OFF', trim: 0, fuelValve: true,
    cabinHeat: 0, cabinAir: 0,
    lights: { dome: false, nav: false, strobe: false, beacon: false, taxi: false, landing: false },
    pitotHeat: false, panelLights: 0,
    radio: { comOn: false, comFreq: 118.10, comStby: 121.90, navFreq: 113.90, navStby: 116.30, obs: 0, xpdrMode: 'OFF', xpdrCode: '7000' },
    altimeterSetting: 29.92, hiCorrection: 0, doorLeftOpen: false, doorRightOpen: false, windowLeftOpen: false, paused: false,
    engine: { running: false, cranking: false, rpm: 0, oilTempF: 70, oilPressPsi: 0, primeCharges: 0, flooded: false, carbIce: 0, startAttemptTime: 0 },
    elec: { busVolts: 0, ammeterAmps: 0, batteryPct: 100, highVoltageLight: false },
    vacuum: { suctionInHg: 0 },
    gyro: { aiSpin: 0, hiSpin: 0, tcPowered: false },
    fuel: { leftGal: 11.25, rightGal: 11.25 },
    flaps: 0,
    air: { ias: 0, tas: 0, altitude: 100, indicatedAlt: 100, vs: 0, pitch: 0, bank: 0, heading: 150, hiHeading: 150,
      turnRate: 0, slip: 0, aoa: 0, gLoad: 1, onGround: true, stallWarning: false, stalled: false, groundSpeed: 0 },
    pos: { x: 0, z: 0 },
    surfaces: { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, trimTab: 0, flaps: 0 },
    propRpm: 0, noseWheelAngle: 0, events: [], time: 0, fieldElevation: 100
  };
  return merge(s, extra);
}
var ENCENDIDO = { engine: { running: true, rpm: 1000, oilTempF: 150, oilPressPsi: 45 }, masterBat: true, masterAlt: true,
  vacuum: { suctionInHg: 5.0 }, elec: { busVolts: 14, ammeterAmps: 2 }, ignition: 'BOTH', mixture: 1, controlLock: false };
var CRUCERO = mezclar(ENCENDIDO, { parkingBrake: false, throttle: 0.75,
  engine: { rpm: 2400 }, air: { ias: 95, altitude: 3000, indicatedAlt: 3000, heading: 60, onGround: false, groundSpeed: 95 } });

// Estados variados para el "no tira error"
var ESTADOS_PRUEBA = [
  estado(),
  estado(ENCENDIDO),
  estado(CRUCERO),
  estado(mezclar(CRUCERO, { flaps: 40, air: { ias: 44, stallWarning: true, stalled: true, bank: -60, slip: 1, vs: -1500 } })),
  estado({ engine: { rpm: NaN }, air: { ias: NaN, altitude: NaN } })
];

// ════════════════════════════════ ESTRUCTURA ════════════════════════════════
seccion('Lecciones');
var L = DATA.lessons;
ok(Array.isArray(L) && L.length >= 10 && L.length <= 12, 'lessons: entre 10 y 12 (hay ' + (L && L.length) + ')');
var idsLecciones = {};
(L || []).forEach(function (les, i) {
  var n = 'lessons[' + i + '] ' + les.id;
  ok(texto(les.id) && !idsLecciones[les.id], n + ': id único');
  idsLecciones[les.id] = true;
  ok(texto(les.titulo) && texto(les.resumen), n + ': titulo y resumen');
  ok(Array.isArray(les.pasos) && les.pasos.length >= 3 && les.pasos.length <= 6, n + ': 3–6 pasos');
  (les.pasos || []).forEach(function (p, j) {
    var m = n + ' paso ' + j;
    ok(texto(p.titulo) && texto(p.texto), m + ': titulo y texto');
    ok(p.anim === null || ANIMS.indexOf(p.anim) >= 0, m + ': anim válida (' + p.anim + ')');
    ok(p.foco === null || CONTROL_IDS.indexOf(p.foco) >= 0, m + ': foco válido (' + p.foco + ')');
    ok(p.anim !== null || p.foco !== null, m + ': tiene animación o foco');
    ok(p.vista === 'exterior' || p.vista === 'cockpit', m + ': vista válida');
    ok(!(p.vista === 'cockpit' && p.foco === null), m + ': vista cockpit con foco');
    ok(!(p.vista === 'exterior' && p.anim === null), m + ': vista exterior con animación');
  });
});

seccion('Recorrido');
var T = DATA.tour;
ok(Array.isArray(T) && T.length >= 22 && T.length <= 26, 'tour: 22–26 pasos (hay ' + (T && T.length) + ')');
var vistosTour = {};
(T || []).forEach(function (p, i) {
  ok(CONTROL_IDS.indexOf(p.control) >= 0, 'tour[' + i + ']: control válido (' + p.control + ')');
  ok(!vistosTour[p.control], 'tour[' + i + ']: control no repetido (' + p.control + ')');
  vistosTour[p.control] = true;
  ok(texto(p.titulo) && texto(p.texto), 'tour[' + i + ']: titulo y texto');
});
['yoke', 'rudder-pedals', 'throttle', 'mixture', 'carb-heat', 'ignition', 'master', 'fuel-shutoff', 'trim-wheel',
  'flap-switch', 'asi', 'attitude', 'altimeter', 'turn-coordinator', 'heading-indicator', 'vsi'].forEach(function (id) {
  ok(vistosTour[id], 'tour incluye el control esencial ' + id);
});

seccion('Checklists');
var C = DATA.checklists;
var idsChk = (C || []).map(function (c) { return c.id; });
['antes-arrancar', 'arranque', 'prueba-motor', 'antes-aterrizar', 'apagado'].forEach(function (id) {
  ok(idsChk.indexOf(id) >= 0, 'existe la checklist ' + id);
});
(C || []).forEach(function (c) {
  ok(texto(c.titulo) && texto(c.descripcion), c.id + ': titulo y descripcion');
  ok(PRESETS.indexOf(c.preset) >= 0, c.id + ': preset válido (' + c.preset + ')');
  ok(c.continuaDe === undefined || idsChk.indexOf(c.continuaDe) >= 0, c.id + ': continuaDe válido');
  ok(Array.isArray(c.items) && c.items.length >= 4, c.id + ': tiene ítems');
  c.items.forEach(function (it, j) {
    var n = c.id + '[' + j + ']';
    ok(CONTROL_IDS.indexOf(it.control) >= 0, n + ': control válido (' + it.control + ')');
    ok(texto(it.texto) && it.texto.indexOf('—') > 0, n + ': texto estilo checklist "Ítem — ACCIÓN"');
    ok(texto(it.detalle), n + ': detalle');
    ok(it.check === null || typeof it.check === 'function', n + ': check es función o null');
    if (typeof it.check === 'function') {
      ESTADOS_PRUEBA.forEach(function (s, k) {
        var r;
        try { r = it.check(JSON.parse(JSON.stringify(s))); } catch (e) { ok(false, n + ': check tiró error con estado ' + k + ': ' + e.message); return; }
        ok(typeof r === 'boolean', n + ': check devuelve boolean con estado ' + k + ' (devolvió ' + r + ')');
      });
    }
  });
});

seccion('Quiz');
var Q = DATA.quiz;
var donde = (Q || []).filter(function (q) { return q.tipo === 'donde'; });
var opc = (Q || []).filter(function (q) { return q.tipo === 'opciones'; });
ok(Q.length >= 40, 'quiz: 40 o más preguntas (hay ' + Q.length + ')');
ok(donde.length >= 16, 'quiz: unas 18 de tipo donde (hay ' + donde.length + ')');
ok(opc.length >= 22, 'quiz: unas 24 de tipo opciones (hay ' + opc.length + ')');
ok(donde.length + opc.length === Q.length, 'quiz: todos los tipos son donde u opciones');
var preguntas = {};
Q.forEach(function (q, i) {
  var n = 'quiz[' + i + ']';
  ok(texto(q.pregunta) && !preguntas[q.pregunta], n + ': pregunta no vacía y única');
  preguntas[q.pregunta] = true;
  if (q.tipo === 'donde') {
    ok(CONTROL_IDS.indexOf(q.control) >= 0, n + ': control válido (' + q.control + ')');
  } else {
    ok(Array.isArray(q.opciones) && q.opciones.length === 4, n + ': 4 opciones');
    ok((q.opciones || []).every(texto), n + ': opciones no vacías');
    ok(new Set(q.opciones).size === 4, n + ': opciones distintas');
    ok(Number.isInteger(q.correcta) && q.correcta >= 0 && q.correcta < 4, n + ': correcta es índice 0..3');
    ok(texto(q.explicacion), n + ': explicacion');
  }
});
var dondeIds = new Set(donde.map(function (q) { return q.control; }));
ok(dondeIds.size === donde.length, 'quiz donde: sin controles repetidos');
var usoCorrecta = [0, 0, 0, 0];
opc.forEach(function (q) { usoCorrecta[q.correcta]++; });
ok(usoCorrecta.every(function (n) { return n > 0; }), 'quiz: la respuesta correcta aparece en las 4 posiciones ' + JSON.stringify(usoCorrecta));

seccion('Glosario');
var G = DATA.glossary;
ok(Array.isArray(G) && G.length >= 45, 'glossary: 45 o más términos (hay ' + (G && G.length) + ')');
var terminos = {};
G.forEach(function (g, i) {
  ok(texto(g.termino) && texto(g.ingles) && texto(g.definicion), 'glossary[' + i + ']: campos completos');
  ok(!terminos[g.termino.toLowerCase()], 'glossary: término único ' + g.termino);
  terminos[g.termino.toLowerCase()] = true;
});
['alabeo', 'cabeceo', 'guiñada', 'ángulo de ataque', 'pérdida', 'viento relativo', 'sustentación', 'resistencia',
  'peso', 'qnh', 'nudo', 'pie', 'rpm', 'magneto', 'carburador', 'hielo en el carburador', 'mezcla', 'compensador',
  'flaps', 'guiñada adversa', 'factor p', 'viraje coordinado', 'viraje estándar', 'actitud', 'pitot', 'toma estática',
  'giróscopo', 'precesión', 'desviación', 'variación magnética', 'carreteo', 'prueba de motor', 'vfr', 'poh',
  'checklist', 'va', 'vfe', 'vne', 'vno', 'vx', 'vy', 'vs0 / vs1', 'centro de gravedad'].forEach(function (t) {
  ok(terminos[t], 'glossary incluye "' + t + '"');
});

seccion('Misiones');
var M = DATA.missions;
var idsMis = (M || []).map(function (m) { return m.id; });
ok(M.length === 8, 'missions: 8 misiones (hay ' + M.length + ')');
['arrancar', 'carreteo', 'despegue', 'recto-nivelado', 'viraje', 'ascenso', 'perdida', 'aproximacion'].forEach(function (id) {
  ok(idsMis.indexOf(id) >= 0, 'existe la misión ' + id);
});
M.forEach(function (m) {
  ok(texto(m.titulo) && texto(m.objetivo) && texto(m.consejo), m.id + ': titulo, objetivo y consejo');
  ok(PRESETS.indexOf(m.preset) >= 0, m.id + ': preset válido');
  ok(Array.isArray(m.pasos) && m.pasos.length >= 3 && m.pasos.length <= 5 && m.pasos.every(texto), m.id + ': 3–5 pasos de texto');
  ok(typeof m.check === 'function', m.id + ': check es función');
  ESTADOS_PRUEBA.forEach(function (s, k) {
    var c = { t: 0, dt: 0.1, hold: 0, data: {} };
    for (var i = 0; i < 3; i++) {
      var r;
      try { r = m.check(JSON.parse(JSON.stringify(s)), c); } catch (e) { ok(false, m.id + ': check tiró error con estado ' + k + ': ' + e.message); return; }
      ok(typeof r === 'number' && r >= 0 && r <= 1, m.id + ': progreso 0..1 con estado ' + k + ' (devolvió ' + r + ')');
      c.t += c.dt;
    }
  });
  // ctx sin data: la misión tiene que crearla
  try { m.check(estado(), { t: 0, dt: 0.1 }); ok(true, ''); } catch (e) { ok(false, m.id + ': falla si ctx.data no existe'); }
});

// ════════════════════════════════ ESCENARIOS ════════════════════════════════
seccion('Escenarios de checklists (un alumno las completa en orden)');
function chk(id) { return C.filter(function (c) { return c.id === id; })[0]; }

// Para cada ítem verificable: el cambio que hace el alumno. Al final, el ítem tiene que dar true.
function correrChecklist(id, s, acciones) {
  var c = chk(id);
  ok(acciones.length === c.items.length, id + ': escenario cubre todos los ítems');
  c.items.forEach(function (it, j) {
    var accion = acciones[j];
    if (accion) accion(s);
    if (it.check) ok(it.check(s) === true, id + '[' + j + '] "' + it.texto + '" se cumple después de la acción');
  });
}

var s1 = estado({ controlLock: true, fuelValve: false, parkingBrake: false, lights: { nav: true }, radio: { comOn: true } });
ok(chk('antes-arrancar').items[0].check(s1) === false, 'antes-arrancar: traba puesta no se da por cumplida');
correrChecklist('antes-arrancar', s1, [
  function (s) { s.controlLock = false; }, null, null,
  function (s) { s.fuelValve = true; },
  function (s) { s.radio.comOn = false; },
  function (s) { s.lights.nav = false; },
  function (s) { s.parkingBrake = true; }, null
]);
correrChecklist('arranque', s1, [
  function (s) { s.mixture = 1; },
  function (s) { s.carbHeat = 0; },
  function (s) { s.masterBat = true; s.masterAlt = true; },
  function (s) { s.lights.beacon = true; },
  function (s) { s.primerLocked = false; s.engine.primeCharges = 2; },
  function (s) { s.primerLocked = true; },
  function (s) { s.throttle = 0.12; },
  null,
  function (s) { s.engine.running = true; s.engine.rpm = 1100; s.engine.oilPressPsi = 5; },
  function (s) { s.engine.oilPressPsi = 25; },
  function (s) { s.engine.rpm = 1000; s.throttle = 0.15; },
  function (s) { s.radio.comOn = true; }
]);
var s2 = estado(mezclar(ENCENDIDO, { trim: 0.6, flaps: 10, engine: { oilTempF: 140 } }));
correrChecklist('prueba-motor', s2, [
  null, null, null, null, null, null,
  function (s) { s.trim = 0.05; },
  function (s) { s.throttle = 0.45; s.engine.rpm = 1700; },
  function (s) { s.ignition = 'R'; s.engine.rpm = 1620; },
  function (s) { s.ignition = 'BOTH'; s.engine.rpm = 1700; },
  function (s) { s.ignition = 'L'; s.engine.rpm = 1600; },
  function (s) { s.ignition = 'BOTH'; s.engine.rpm = 1700; },
  function (s) { s.carbHeat = 1; s.engine.rpm = 1620; },
  function (s) { s.carbHeat = 0; s.engine.rpm = 1700; },
  null, null,
  function (s) { s.throttle = 0; s.engine.rpm = 650; },
  function (s) { s.flaps = 0; },
  null
]);
ok(chk('prueba-motor').items[8].check(estado(ENCENDIDO)) === false, 'prueba-motor: magneto R no se cumple en BOTH');
var s3 = estado(mezclar(CRUCERO, { mixture: 0.8, air: { ias: 75, altitude: 800 } }));
correrChecklist('antes-aterrizar', s3, [
  null,
  function (s) { s.mixture = 1; },
  function (s) { s.carbHeat = 1; },
  function (s) { s.flaps = 20; },
  function (s) { s.air.ias = 57; }
]);
var s4 = estado(mezclar(ENCENDIDO, { parkingBrake: false, lights: { beacon: true, nav: true }, radio: { comOn: true, xpdrMode: 'SBY' } }));
correrChecklist('apagado', s4, [
  function (s) { s.parkingBrake = true; },
  function (s) { s.radio.comOn = false; s.radio.xpdrMode = 'OFF'; },
  function (s) { s.lights.beacon = false; s.lights.nav = false; },
  function (s) { s.mixture = 0; s.engine.running = false; s.engine.rpm = 0; },
  function (s) { s.ignition = 'OFF'; },
  function (s) { s.masterBat = false; s.masterAlt = false; },
  function (s) { s.controlLock = true; }
]);

seccion('Escenarios de misiones (simulación a mano, dt = 0,1 s)');
function mision(id) { return M.filter(function (m) { return m.id === id; })[0]; }
// Corre la misión `seg` segundos llamando a `paso(s, t)` antes de cada check; devuelve el progreso máximo y final.
function correrMision(id, s, seg, paso) {
  var m = mision(id), c = { t: 0, dt: 0.1, hold: 0, data: {} }, max = 0, r = 0;
  for (var t = 0; t < seg; t += 0.1) {
    if (paso) paso(s, t);
    r = m.check(s, c);
    if (r > max) max = r;
    c.t += c.dt;
  }
  return { max: max, final: r, data: c.data };
}

var r;
// Arrancar: hitos en orden
var sa = estado();
r = correrMision('arrancar', sa, 5, function (s, t) {
  if (t > 1) s.controlLock = false;
  if (t > 2) { s.masterBat = true; s.masterAlt = true; }
  if (t > 3) s.engine.primeCharges = 2;
  if (t > 4) s.engine.running = true;
});
ok(r.final === 1, 'arrancar: llega a 1 con el motor en marcha');
ok(mision('arrancar').check(estado(), { dt: 0.1, data: {} }) === 0, 'arrancar: 0 al empezar');
ok(Math.abs(mision('arrancar').check(estado({ controlLock: false, masterBat: true }), { dt: 0.1, data: {} }) - 0.5) < 1e-9, 'arrancar: 2 hitos = 0,5');

// Carreteo: soltar freno, acelerar a 15 kt, frenar hasta parar
var sc = estado(ENCENDIDO);
r = correrMision('carreteo', sc, 30, function (s, t) {
  if (t > 1) s.parkingBrake = false;
  if (t > 2 && t < 12) s.air.groundSpeed = Math.min(16, (t - 2) * 2);
  if (t >= 12) { s.brakeL = 0.8; s.brakeR = 0.8; s.air.groundSpeed = Math.max(0, 16 - (t - 12) * 3); }
});
ok(r.final === 1, 'carreteo: llega a 1 al frenar hasta parar');
ok(correrMision('carreteo', estado(ENCENDIDO), 3, null).max === 0, 'carreteo: 0 con el freno de estacionamiento puesto');

// Despegue: potencia, rotación, ascenso a 600 ft
var sd = estado(mezclar(ENCENDIDO, { parkingBrake: false, air: { heading: 60 } }));
r = correrMision('despegue', sd, 90, function (s, t) {
  s.throttle = 1;
  if (t < 15) { s.air.ias = t * 4; s.air.onGround = s.air.ias < 50; }
  else { s.air.ias = 65; s.air.onGround = false; s.air.altitude = 100 + (t - 15) * 10; }
});
ok(r.final === 1, 'despegue: llega a 1 a 500 ft sobre el aeródromo');
var sd2 = estado(mezclar(ENCENDIDO, { air: { altitude: 300 } }));
ok(mision('despegue').check(sd2, { dt: 0.1, data: {} }) < 1, 'despegue: en tierra no se da por cumplida');

// Recto y nivelado: 20 s estable
var sr = estado(CRUCERO);
r = correrMision('recto-nivelado', sr, 21, function (s, t) { s.air.altitude = 3000 + 40 * Math.sin(t); s.air.heading = (60 + 5 * Math.sin(t / 3) + 360) % 360; });
ok(r.final === 1, 'recto-nivelado: llega a 1 tras 20 s dentro de tolerancia');
r = correrMision('recto-nivelado', estado(CRUCERO), 30, function (s, t) { s.air.heading = (60 + t * 2) % 360; });
ok(r.final < 1, 'recto-nivelado: no se cumple si el rumbo se va');
var sw = estado(mezclar(CRUCERO, { air: { heading: 355 } }));
r = correrMision('recto-nivelado', sw, 21, function (s, t) { s.air.heading = (t % 2 < 1) ? 3 : 356; });
ok(r.final === 1, 'recto-nivelado: tolera el cruce 360/000');

// Viraje a la izquierda 30°
r = correrMision('viraje', estado(CRUCERO), 15, function (s, t) {
  s.air.bank = t < 3 ? -t * 10 : -30; s.air.slip = 0.1; s.air.altitude = 3000 - t * 5;
});
ok(r.final === 1, 'viraje: llega a 1 con 30° izquierda coordinado 10 s');
r = correrMision('viraje', estado(CRUCERO), 15, function (s) { s.air.bank = 30; });
ok(r.final === 0, 'viraje: inclinación a la derecha no cuenta');
r = correrMision('viraje', estado(CRUCERO), 15, function (s) { s.air.bank = -30; s.air.slip = 0.6; });
ok(r.final < 0.31, 'viraje: con la bolita afuera no avanza');

// Ascenso 500 ft a 68 kt
r = correrMision('ascenso', estado(CRUCERO), 60, function (s, t) {
  s.throttle = 1; s.air.ias = 68; s.air.vs = 600; s.air.altitude = 3000 + t * 10;
});
ok(r.final === 1, 'ascenso: llega a 1 subiendo 500 ft a 68 kt');
r = correrMision('ascenso', estado(CRUCERO), 60, function (s, t) {
  s.throttle = 1; s.air.ias = 85; s.air.altitude = 3000 + t * 10;
});
ok(r.final === 0, 'ascenso: a 85 kt no cuenta');

// Pérdida: sacar potencia, frenar, bocina, recuperar
var sp = estado(CRUCERO);
r = correrMision('perdida', sp, 40, function (s, t) {
  if (t > 1) s.throttle = 0;
  if (t > 1 && t < 15) { s.air.ias = 95 - (t - 1) * 3.5; s.air.pitch = 8; }
  if (t >= 15 && t < 17) { s.air.stallWarning = true; s.air.ias = 46; s.air.pitch = 10; }
  if (t >= 17) { s.air.stallWarning = false; s.throttle = 1; s.air.pitch = -3; s.air.ias = 46 + (t - 17) * 4; s.air.altitude = 3000 - Math.min(150, (t - 17) * 30); }
});
ok(r.final === 1, 'perdida: llega a 1 con recuperación correcta');
var sp2 = estado(CRUCERO);
r = correrMision('perdida', sp2, 40, function (s, t) {
  if (t > 1) s.throttle = 0;
  if (t > 1 && t < 15) s.air.ias = 95 - (t - 1) * 3.5;
  if (t >= 15) { s.air.stallWarning = t < 17; s.air.ias = 46 + Math.max(0, t - 17) * 4; s.air.pitch = -10; s.air.altitude = 3000 - (t - 15) * 80; }
});
ok(r.final < 1, 'perdida: perder 300 ft o más no cuenta');

// Aproximación con flaps
r = correrMision('aproximacion', estado(mezclar(CRUCERO, { air: { ias: 70, altitude: 800 } })), 25, function (s, t) {
  s.flaps = Math.min(30, t * 5); s.air.ias = 60; s.air.vs = -500;
});
ok(r.final === 1, 'aproximacion: llega a 1 con flaps 20+, 60 kt, -500 fpm');
r = correrMision('aproximacion', estado(CRUCERO), 25, function (s) { s.flaps = 10; s.air.ias = 60; s.air.vs = -500; });
ok(r.final <= 0.25, 'aproximacion: con flaps 10 no avanza');

// ════════════════════════════════ TEXTOS ════════════════════════════════
seccion('Textos (voseo, sin marcadores pendientes)');
var crudo = fs.readFileSync(learningPath, 'utf8');
// TODO en mayúsculas (marcador pendiente); "todo" en minúscula es español normal.
ok(!/\b(TODO|FIXME|XXX)\b/.test(crudo) && !/lorem ipsum/i.test(crudo), 'sin TODO/FIXME/lorem');
// Formas de tuteo que no pueden ser tercera persona (mira/tira/empuja sí pueden: "el peso tira").
var tuteo = crudo.match(/(^|[^\wáéíóúñ])(puedes|tienes|debes|quieres|eres|sabes|fíjate|acuérdate|sientes|vuelas|tú)(?![\wáéíóúñ])/gi);
ok(!tuteo, 'sin formas de tuteo (' + (tuteo ? tuteo.join(', ') : '') + ')');
ok(/SAND/.test(crudo) && !/\bANDS\b/.test(crudo), 'brújula: regla del hemisferio sur (SAND)');
ok(!/\b67 ?kt|\bVy 67\b|30° m[aá]x/i.test(crudo), 'sin números del Cessna 152');

// ════════════════════════════ CON ARCHIVOS REALES ════════════════════════════
seccion('Cruce con archivos reales (si existen)');
var ctrlFiles = ['controls-a.js', 'controls-b.js'].map(function (f) { return path.join(SRC, 'data', f); }).filter(fs.existsSync);
if (ctrlFiles.length) {
  var sbC = cargar(ctrlFiles);
  var reales = (sbC.C150.DATA.controls || []).map(function (c) { return c.id; });
  var usados = new Set();
  L.forEach(function (l) { l.pasos.forEach(function (p) { if (p.foco) usados.add(p.foco); }); });
  T.forEach(function (p) { usados.add(p.control); });
  C.forEach(function (c) { c.items.forEach(function (it) { usados.add(it.control); }); });
  donde.forEach(function (q) { usados.add(q.control); });
  var faltan = [];
  usados.forEach(function (id) { if (reales.indexOf(id) < 0) faltan.push(id); });
  var completos = ctrlFiles.length === 2;
  if (completos) ok(faltan.length === 0, 'todos los controles usados existen en controls-a/b (faltan: ' + faltan.join(', ') + ')');
  else console.log('  (sólo hay ' + ctrlFiles.map(function (f) { return path.basename(f); }).join(', ') + '; ids no encontrados todavía: ' + faltan.length + ')');
} else {
  console.log('  (no hay fichas de controles todavía)');
}

var simPath = path.join(SRC, 'sim.js');
if (fs.existsSync(simPath)) {
  var sbS = cargar([path.join(SRC, 'data', 'learning.js'), simPath]);
  var Sim = sbS.C150.Sim, D2 = sbS.C150.DATA;
  PRESETS.forEach(function (p) {
    var s;
    try { s = Sim.createState(p); for (var i = 0; i < 20; i++) Sim.step(s, 0.1); }
    catch (e) { console.log('  (el simulador falló creando ' + p + ': ' + e.message + ')'); return; }
    D2.checklists.forEach(function (c) {
      c.items.forEach(function (it, j) {
        if (!it.check) return;
        try { var v = it.check(s); ok(typeof v === 'boolean', c.id + '[' + j + '] con sim real ' + p + ': boolean'); }
        catch (e) { ok(false, c.id + '[' + j + '] tira error con sim real ' + p + ': ' + e.message); }
      });
    });
    D2.missions.forEach(function (m) {
      try { var v = m.check(s, { t: 0, dt: 0.1, hold: 0, data: {} }); ok(typeof v === 'number' && v >= 0 && v <= 1, m.id + ' con sim real ' + p + ': 0..1'); }
      catch (e) { ok(false, m.id + ' tira error con sim real ' + p + ': ' + e.message); }
    });
  });
  console.log('  simulador real probado con ' + PRESETS.join(', '));
} else {
  console.log('  (src/sim.js no existe todavía: se usan sólo estados falsos)');
}

console.log('\n' + (pruebas - fallas) + '/' + pruebas + ' verificaciones OK');
if (fallas) { console.error(fallas + ' FALLAS'); process.exit(1); }
console.log('validate-learning: TODO BIEN');
