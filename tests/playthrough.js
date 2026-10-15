/*
 * playthrough.js — "¿Se puede jugar?" Recorre TODAS las checklists y TODAS las misiones de
 * src/data/learning.js con el simulador real (src/sim.js), tocando SÓLO lo que un alumno puede tocar:
 * los campos de entrada del contrato §3a y C150.Sim.actions.*. Nunca escribe campos de salida.
 *
 * Uso: node tests/playthrough.js     (sale con código 1 si algo falla)
 *
 *  - Checklists: igual que la UI, sólo se evalúa el ítem actual (≈10 Hz) y queda tildado en cuanto su
 *    check(state) da true; los ítems con check === null se confirman a mano (acá, automáticamente).
 *    'arranque' (continuaDe 'antes-arrancar') se prueba de las dos formas: siguiendo con el mismo
 *    estado y desde el preset.
 *  - Misiones: preset, ctx = { t, dt, hold:0, data:{} } nuevo, check() en cada cuadro (como ui.js)
 *    hasta llegar a progreso 1.
 *  - Los "pilotos" de abajo usan entradas moderadas y suaves (volante dentro de ±0,7, cambios a
 *    velocidad de tecla), nada que un alumno no pueda hacer con el teclado o el mouse.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '..', 'src');
var sandbox = { console: console, Math: Math };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['sim.js', 'data/controls-a.js', 'data/controls-b.js', 'data/learning.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
});
var C150 = sandbox.C150;
var Sim = C150.Sim, A = Sim.actions, DATA = C150.DATA;

var DT = 1 / 30;            // paso de simulación (≈ 30 Hz, como el temporizador de respaldo de core)
var EVAL_EVERY = 0.1;       // la UI evalúa la checklist ≈ 10 Hz

/* ───────────────────────────── entradas permitidas (contrato §3a) ───────────────────────────── */
var ALLOWED = {
  yokeRoll: 1, yokePitch: 1, rudder: 1, brakeL: 1, brakeR: 1, parkingBrake: 1, controlLock: 1,
  throttle: 1, mixture: 1, carbHeat: 1, primerOut: 1, primerLocked: 1, trim: 1, fuelValve: 1,
  cabinHeat: 1, cabinAir: 1, pitotHeat: 1, panelLights: 1, altimeterSetting: 1, hiCorrection: 1,
  doorLeftOpen: 1, doorRightOpen: 1, windowLeftOpen: 1,
  'lights.dome': 1, 'lights.nav': 1, 'lights.strobe': 1, 'lights.beacon': 1, 'lights.taxi': 1, 'lights.landing': 1,
  'radio.comOn': 1, 'radio.comFreq': 1, 'radio.comStby': 1, 'radio.navFreq': 1, 'radio.navStby': 1,
  'radio.obs': 1, 'radio.xpdrMode': 1, 'radio.xpdrCode': 1
  // ignition / masterBat / masterAlt / flapSwitch: sólo a través de Sim.actions (como la UI)
};
var RANGES = { yokeRoll: [-1, 1], yokePitch: [-1, 1], rudder: [-1, 1], trim: [-1, 1] };

function set(s, key, v) {
  if (!ALLOWED[key]) throw new Error('el piloto intentó escribir un campo que no es de entrada: ' + key);
  if (typeof v === 'number') {
    var r = RANGES[key] || [0, 1];
    if (key === 'altimeterSetting' || key === 'hiCorrection' || key.indexOf('radio.') === 0) r = [-1e9, 1e9];
    v = Math.max(r[0], Math.min(r[1], v));
  }
  var p = key.split('.');
  if (p.length === 2) s[p[0]][p[1]] = v; else s[key] = v;
}
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
/** Mueve una entrada hacia `target` como mucho a `rate` por segundo (velocidad de tecla/mano). */
function ease(s, key, target, rate) {
  var cur = key.indexOf('.') > 0 ? s[key.split('.')[0]][key.split('.')[1]] : s[key];
  var step = rate * DT;
  set(s, key, Math.abs(target - cur) <= step ? target : cur + (target > cur ? step : -step));
}
/** Acelerador hacia unas RPM objetivo (el alumno mira el tacómetro y mueve la palanca de a poco). */
function throttleTo(s, rpm) {
  var err = rpm - s.engine.rpm;
  ease(s, 'throttle', clamp(s.throttle + err * 0.0004, 0, 1), 0.3);
}
/** Mantener una velocidad con la nariz (tirar/empujar suave) y descargar la fuerza con el compensador. */
function makePitchHold(gainP, trimRate) {
  return function (s, iasTarget) {
    var e = s.air.ias - iasTarget;                     // rápido → tirar (+)
    var cmd = clamp(e * gainP, -0.6, 0.6);
    ease(s, 'yokePitch', cmd, 1.5);
    if (Math.abs(s.yokePitch) > 0.05) set(s, 'trim', s.trim + Math.sign(s.yokePitch) * trimRate * DT);
  };
}
/** Alas a un ángulo de inclinación y bolita al centro. */
function bankHold(s, bankTarget) {
  var rr = s.air.rollRate || 0;
  ease(s, 'yokeRoll', clamp((bankTarget - s.air.bank) * 0.04 - rr * 0.02, -0.6, 0.6), 1.5);
  ease(s, 'rudder', clamp(s.yokeRoll * 0.3 + s.air.slip * 1.5, -0.7, 0.7), 1.5);
}
/** Altura con la nariz (para los virajes y la pérdida). */
function altHold(s, altTarget, maxPull, mem) {
  // variómetro deseado según cuánto me fui de la altura; el volante sigue esa corrección despacio
  // (una parte proporcional y una "memoria" lenta que va sumando el tirón que hace falta al frenar)
  var vsWant = clamp((altTarget - s.air.altitude) * 1, -200, 200);
  var err = vsWant - s.air.vs;
  var base = mem.base || 0;
  base = clamp(base + err * 0.00015 * DT, -0.3, maxPull);
  mem.base = base;
  ease(s, 'yokePitch', clamp(base + err * 0.0002, -0.4, maxPull), 0.5);
}

/* ─────────────────────────────── pilotos para cada checklist ─────────────────────────────── */
// Un "driver" por ítem, en el mismo orden que en learning.js. null = ítem que el alumno confirma.
function startDriver(s) {
  if (s.engine.running) { if (s.ignition === 'START') A.setIgnition(s, 'BOTH'); }
  else if (s.ignition !== 'START') A.setIgnition(s, 'START');
}
function releaseKey(s) { if (s.ignition === 'START') A.setIgnition(s, 'BOTH'); }
function primeDriver(s, t) {
  // un bombeo cada medio segundo: tirar el émbolo y empujarlo
  if (s.engine.primeCharges < 2 && !s.engine.running && t > 0.5 * (s.engine.primeCharges + 1)) {
    set(s, 'primerOut', 1); A.primeStroke(s); set(s, 'primerOut', 0);
  }
}
var CHECKLIST_DRIVERS = {
  'antes-arrancar': [
    function (s) { set(s, 'controlLock', false); },
    null, null,
    function (s) { set(s, 'fuelValve', true); },
    function (s) { set(s, 'radio.comOn', false); set(s, 'radio.xpdrMode', 'OFF'); },
    function (s) { ['dome', 'nav', 'strobe', 'beacon', 'taxi', 'landing'].forEach(function (k) { set(s, 'lights.' + k, false); }); set(s, 'pitotHeat', false); },
    function (s) { set(s, 'parkingBrake', true); },
    null
  ],
  'arranque': [
    function (s) { ease(s, 'mixture', 1, 2); },
    function (s) { set(s, 'carbHeat', 0); },
    function (s) { A.setMaster(s, 'bat', true); A.setMaster(s, 'alt', true); },
    function (s) { set(s, 'lights.beacon', true); },
    primeDriver,
    function (s) { set(s, 'primerOut', 0); set(s, 'primerLocked', true); },
    function (s) { ease(s, 'throttle', 0.1, 0.5); },
    null,
    startDriver,
    releaseKey,
    function (s) { releaseKey(s); throttleTo(s, 1050); },
    function (s) { set(s, 'radio.comOn', true); }
  ],
  'prueba-motor': [
    function (s) { set(s, 'doorLeftOpen', false); set(s, 'doorRightOpen', false); },
    function (s) { set(s, 'parkingBrake', true); },
    null, null,
    function (s) { set(s, 'fuelValve', true); },
    function (s) { ease(s, 'mixture', 1, 2); },
    function (s) { set(s, 'trim', 0); },
    function (s) { throttleTo(s, 1700); },
    function (s) { A.setIgnition(s, 'R'); },
    function (s) { A.setIgnition(s, 'BOTH'); },
    function (s) { A.setIgnition(s, 'L'); },
    function (s) { A.setIgnition(s, 'BOTH'); },
    function (s) { ease(s, 'carbHeat', 1, 2); },
    function (s) { ease(s, 'carbHeat', 0, 2); },
    function (s) { throttleTo(s, 1700); },
    function (s) { throttleTo(s, 1700); },
    function (s) { ease(s, 'throttle', 0, 0.5); },
    function (s) { A.setFlapSwitch(s, 'UP'); },
    null
  ],
  'antes-aterrizar': [
    null,
    function (s) { ease(s, 'mixture', 1, 2); },
    function (s) { ease(s, 'carbHeat', 1, 2); },
    function (s) { if (s.flaps < 10) A.setFlapSwitch(s, 'DOWN'); else A.setFlapSwitch(s, 'OFF'); },
    (function () { var hold = makePitchHold(0.06, 0.05); return function (s) { hold(s, 56); bankHold(s, 0); ease(s, 'throttle', 0.25, 0.3); }; })()
  ],
  'apagado': [
    function (s) { set(s, 'parkingBrake', true); },
    function (s) { set(s, 'radio.comOn', false); set(s, 'radio.xpdrMode', 'OFF'); },
    function (s) { ['dome', 'nav', 'strobe', 'beacon', 'taxi', 'landing'].forEach(function (k) { set(s, 'lights.' + k, false); }); set(s, 'pitotHeat', false); },
    function (s) { ease(s, 'throttle', 0, 0.5); ease(s, 'mixture', 0, 1); },
    function (s) { A.setIgnition(s, 'OFF'); },
    function (s) { A.setMaster(s, 'bat', false); },
    function (s) { set(s, 'controlLock', true); }
  ]
};

function runChecklist(cl, s) {
  var drivers = CHECKLIST_DRIVERS[cl.id];
  if (!drivers) return { ok: false, msg: 'no hay piloto para esta checklist' };
  if (drivers.length !== cl.items.length) return { ok: false, msg: 'la checklist tiene ' + cl.items.length + ' ítems y el piloto ' + drivers.length };
  s = s || Sim.createState(cl.preset);
  var total = 0;
  for (var i = 0; i < cl.items.length; i++) {
    var it = cl.items[i];
    if (typeof it.check !== 'function') {
      if (drivers[i] !== null) return { ok: false, msg: 'ítem ' + (i + 1) + ' sin check pero el piloto espera uno' };
      continue;                                                    // confirmado a mano
    }
    if (typeof drivers[i] !== 'function') return { ok: false, msg: 'ítem ' + (i + 1) + ' tiene check pero no piloto' };
    var t = 0, nextEval = 0, done = false;
    while (t < 120) {
      drivers[i](s, t);
      Sim.step(s, DT); t += DT; total += DT;
      if (t >= nextEval) { nextEval += EVAL_EVERY; if (it.check(s)) { done = true; break; } }
    }
    if (!done) return { ok: false, msg: 'ítem ' + (i + 1) + ' «' + it.texto + '» no se cumple en 120 s', s: s };
  }
  return { ok: true, msg: cl.items.length + ' ítems en ' + total.toFixed(1) + ' s', s: s };
}

/* ─────────────────────────────── pilotos para cada misión ─────────────────────────────── */
var MISSION_PILOTS = {
  arrancar: function () {
    var k = 0;
    var seq = CHECKLIST_DRIVERS['arranque'];
    return function (s, t, d) {
      if (t < 1) { set(s, 'controlLock', false); return; }
      if (t < 2) { set(s, 'fuelValve', true); ease(s, 'mixture', 1, 2); set(s, 'carbHeat', 0); return; }
      if (t < 3) { A.setMaster(s, 'alt', true); return; }
      if (s.engine.primeCharges < 2 && !s.engine.running) { primeDriver(s, t - 2); return; }
      set(s, 'primerLocked', true);
      if (s.throttle < 0.1) { ease(s, 'throttle', 0.1, 0.5); return; }
      startDriver(s);
      if (s.engine.running) throttleTo(s, 1000);
    };
  },
  carreteo: function () {
    var phase = 0;
    return function (s) {
      set(s, 'parkingBrake', false);
      if (phase === 0) { ease(s, 'throttle', 0.45, 0.3); if (s.air.groundSpeed >= 10.5) phase = 1; }
      else { ease(s, 'throttle', 0, 1); ease(s, 'brakeL', 1, 3); ease(s, 'brakeR', 1, 3); }
      ease(s, 'rudder', 0, 2);
    };
  },
  despegue: function () {
    var hold = makePitchHold(0.05, 0.05), hdg0 = null;
    return function (s) {
      if (hdg0 === null) hdg0 = s.air.heading;
      ease(s, 'throttle', 1, 0.4);
      set(s, 'carbHeat', 0);
      var herr = ((s.air.heading - hdg0 + 540) % 360) - 180;
      if (s.air.onGround) {
        ease(s, 'rudder', clamp(-herr * 0.15, -0.6, 0.6), 2);
        ease(s, 'yokePitch', s.air.ias >= 50 ? 0.45 : 0, 1.5);
      } else {
        hold(s, 65);
        bankHold(s, clamp(-herr * 1.5, -10, 10));
      }
    };
  },
  'recto-nivelado': function () {
    return function () { /* compensado: no tocar nada es la mitad del truco */ };
  },
  viraje: function () {
    var alt0 = null, mem = {};
    return function (s) {
      if (alt0 === null) alt0 = s.air.altitude;
      bankHold(s, -30);
      altHold(s, alt0, 0.5, mem);
    };
  },
  ascenso: function () {
    var hold = makePitchHold(0.05, 0.08);
    return function (s) {
      ease(s, 'throttle', 1, 0.5);
      hold(s, 68);
      bankHold(s, 0);
    };
  },
  perdida: function () {
    var phase = 0, alt0 = null, mem = {};
    return function (s) {
      if (alt0 === null) alt0 = s.air.altitude;
      bankHold(s, 0);
      if (phase === 0) {                                // potencia afuera, mantener la altura
        ease(s, 'carbHeat', 1, 2);
        ease(s, 'throttle', 0, 0.5);
        altHold(s, alt0, 0.9, mem);
        if (s.air.stallWarning) phase = 1;
      } else {                                          // salida: empujar, potencia, nivelar
        ease(s, 'throttle', 1, 1.0);
        ease(s, 'carbHeat', 0, 2);
        if (s.air.ias < 62) ease(s, 'yokePitch', -0.3, 3);
        else ease(s, 'yokePitch', 0, 2);
      }
    };
  },
  aproximacion: function () {
    var hold = makePitchHold(0.03, 0.03);
    return function (s) {
      set(s, 'carbHeat', 1);
      if (s.flaps < 20) A.setFlapSwitch(s, 'DOWN'); else if (s.flapSwitch === 'DOWN') A.setFlapSwitch(s, 'OFF');
      hold(s, 55);
      bankHold(s, 0);
      // acelerador de a poquito sólo si el variómetro se va de −400…−700 ft/min
      if (s.air.vs < -700) ease(s, 'throttle', 1, 0.03);
      else if (s.air.vs > -400) ease(s, 'throttle', 0, 0.03);
    };
  }
};

function runMission(m) {
  var mk = MISSION_PILOTS[m.id];
  if (!mk) return { ok: false, msg: 'no hay piloto para esta misión' };
  var s = Sim.createState(m.preset || 'parked');
  var pilot = mk(), ctx = { t: 0, dt: 0, hold: 0, data: {} };
  var p = 0, best = 0, limit = 240;
  while (ctx.t < limit) {
    pilot(s, ctx.t, ctx.data);
    Sim.step(s, DT);
    ctx.t += DT; ctx.dt = DT;
    p = Number(m.check(s, ctx)) || 0;
    if (p > best) best = p;
    if (p >= 1) break;
    if (s.air.onGround && m.preset !== 'parked' && m.preset !== 'runup' && m.preset !== 'runway' && ctx.t > 1) break;
  }
  return { ok: p >= 1, msg: (p >= 1 ? 'progreso 1 en ' : 'llegó a ' + best.toFixed(2) + ' en ') + ctx.t.toFixed(1) + ' s', s: s };
}

/* ─────────────────────────────────────────── correr ─────────────────────────────────────────── */
var rows = [], fails = 0;
function row(kind, id, r) {
  rows.push([kind, id, r.ok ? 'PASA' : 'FALLA', r.msg]);
  if (!r.ok) fails++;
}

var first = null;
DATA.checklists.forEach(function (cl) {
  var r = runChecklist(cl);
  row('checklist', cl.id, r);
  if (cl.id === 'antes-arrancar') first = r.ok ? r.s : null;
});
DATA.checklists.forEach(function (cl) {
  if (!cl.continuaDe) return;
  if (cl.continuaDe !== 'antes-arrancar' || !first) { row('checklist', cl.id + ' (seguida)', { ok: false, msg: 'no se pudo encadenar' }); return; }
  row('checklist', cl.id + ' (seguida de ' + cl.continuaDe + ')', runChecklist(cl, first));
});
DATA.missions.forEach(function (m) { row('misión', m.id, runMission(m)); });

var w = [0, 0, 0, 0];
rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i], String(c).length); }); });
function pad(x, n) { x = String(x); while (x.length < n) x += ' '; return x; }
console.log('\nPLAYTHROUGH — checklists y misiones con el simulador real (sólo entradas de alumno)\n');
rows.forEach(function (r) { console.log('  ' + r.map(function (c, i) { return pad(c, w[i]); }).join('  ')); });
console.log('\n' + (rows.length - fails) + '/' + rows.length + ' pasan' + (fails ? ' — ' + fails + ' FALLAN' : ''));
process.exit(fails ? 1 : 0);
