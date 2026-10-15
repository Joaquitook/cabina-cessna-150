/*
 * tests/sim.test.js: plain Node tests for src/sim.js (no dependencies).
 * Run:  node tests/sim.test.js
 * Prints a pass/fail list and a table with the flight-performance numbers achieved.
 */
'use strict';
var assert = require('assert');
var path = require('path');
var Sim = require(path.join(__dirname, '..', 'src', 'sim.js'));

var DT = 0.05;
var KT = 0.514444;
var results = [];
var perf = [];
var failures = 0;

function test(name, fn) {
  try {
    fn();
    results.push({ test: name, result: 'ok' });
  } catch (err) {
    failures++;
    results.push({ test: name, result: 'FAIL' });
    console.error('\nFAIL: ' + name + '\n  ' + (err && err.message));
  }
}
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function wrap180(h) { h = ((h % 360) + 360) % 360; return h > 180 ? h - 360 : h; }
function run(s, seconds, fn, dt) {
  dt = dt || DT;
  var n = Math.round(seconds / dt);
  for (var i = 0; i < n; i++) {
    if (fn && fn(s, i * dt) === false) return i * dt;
    Sim.step(s, dt);
  }
  return seconds;
}
function inRange(v, lo, hi, what) {
  assert.ok(v >= lo && v <= hi, what + ' = ' + (Math.round(v * 100) / 100) + ' (expected ' + lo + '…' + hi + ')');
}
function hasEvent(s, re) { return s.events.some(function (e) { return re.test(e.text); }); }
function record(name, value, target, unit) {
  perf.push({ medida: name, valor: Math.round(value * 10) / 10, objetivo: target, unidad: unit });
}

/** Airborne, clean, at a given altitude/IAS. A sea-level test flies below the (moved) field. */
function airborne(altFt, ias) {
  var s = Sim.createState('cruise');
  s.fieldElevation = -4000;               // move the ground out of the way for sea-level tests
  s.air.altitude = altFt;
  s._sim.V = ias * KT / Math.sqrt(Sim._internal.sigmaAt(altFt));
  return s;
}
/** PI speed hold through the yoke (pull when too fast). */
function speedHold(target) {
  var I = 0;
  return function (s) {
    var e = s.air.ias - target;
    I = clamp(I + e * DT * 0.01, -1, 1);
    s.yokePitch = clamp(0.04 * e + I, -1, 1);
  };
}
/** PID altitude hold through the yoke. */
function altHold(alt0) {
  var I = 0;
  return function (s) {
    var e = alt0 - s.air.altitude;
    I = clamp(I + e * DT * 0.0004, -1, 1);
    s.yokePitch = clamp(0.004 * e - 0.0015 * s.air.vs + I, -1, 1);
  };
}
/** Cold-engine start from the 'parked' preset following the POH order. Returns the state. */
function parkedReady(opts) {
  opts = opts || {};
  var s = Sim.createState('parked');
  s.controlLock = !!opts.keepLock;
  s.mixture = opts.mixture !== undefined ? opts.mixture : 1;
  s.throttle = opts.throttle !== undefined ? opts.throttle : 0.1;
  Sim.actions.setMaster(s, 'bat', true);
  Sim.actions.setMaster(s, 'alt', true);
  s.lights.beacon = true;
  var primes = opts.primes !== undefined ? opts.primes : 3;
  for (var i = 0; i < primes; i++) Sim.actions.primeStroke(s);
  s.primerLocked = true;
  run(s, 1);
  return s;
}
function crank(s, seconds) {
  Sim.actions.setIgnition(s, 'START');
  var t = run(s, seconds, function (st) { if (st.engine.running) return false; });
  Sim.actions.setIgnition(s, 'BOTH');
  return t;
}

/* ===================================================================== tests */

test('createState: every preset, finite values, same reference on applyPreset', function () {
  Object.keys(Sim.PRESETS).forEach(function (p) {
    var s = Sim.createState(p);
    assert.ok(Sim.PRESETS[p].label && Sim.PRESETS[p].description, 'preset text ' + p);
    ['ias', 'tas', 'altitude', 'indicatedAlt', 'vs', 'pitch', 'bank', 'heading', 'hiHeading', 'turnRate',
      'slip', 'aoa', 'gLoad', 'groundSpeed'].forEach(function (k) {
      assert.ok(isFinite(s.air[k]), p + ' air.' + k);
    });
    assert.ok(isFinite(s.engine.rpm) && isFinite(s.elec.busVolts) && isFinite(s.surfaces.elevator), p + ' outputs');
    assert.strictEqual(s.events.length, 0, p + ' events empty');
    assert.strictEqual(s.fieldElevation, 100);
  });
  var s = Sim.createState('parked');
  var air = s.air, ev = s.events, lights = s.lights;
  s.events.push({ t: 0, text: 'x', kind: 'info' });
  var back = Sim.applyPreset(s, 'cruise');
  assert.strictEqual(back, s);
  assert.strictEqual(s.air, air, 'air sub-object kept');
  assert.strictEqual(s.events, ev, 'events array kept');
  assert.strictEqual(s.lights, lights, 'lights kept');
  assert.strictEqual(s.events.length, 0, 'events cleared');
  assert.strictEqual(globalThis.C150.Sim, Sim, 'global namespace');
});

test('presets: positions, configuration and engine state', function () {
  var A = Sim.AIRPORT;
  var p = Sim.createState('parked');
  assert.ok(p.controlLock && p.parkingBrake && !p.masterBat && !p.masterAlt && p.ignition === 'OFF');
  assert.ok(p.mixture === 0 && p.throttle === 0 && p.fuelValve && !p.engine.running);
  assert.ok(p.fuel.leftGal === 11 && p.fuel.rightGal === 11 && p.engine.oilTempF === 68 && p.gyro.aiSpin === 0);
  assert.ok(p.pos.x === A.spots.parked.x && p.pos.z === A.spots.parked.z && p.air.heading === 150 && p.air.onGround);
  var r = Sim.createState('runup');
  inRange(r.engine.rpm, 950, 1050, 'runup rpm');
  assert.ok(r.parkingBrake && !r.controlLock && r.masterBat && r.masterAlt && r.lights.beacon && r.lights.nav && r.radio.comOn);
  assert.ok(r.engine.oilTempF === 150 && r.gyro.aiSpin === 1 && r.trim === 0);
  var w = Sim.createState('runway');
  assert.ok(!w.parkingBrake && w.lights.landing && w.lights.strobe && w.radio.xpdrMode === 'ALT' && w.engine.running);
  assert.ok(Math.abs(w.pos.x - A.spots.runway.x) < 1e-9 && w.air.heading === 60);
  var c = Sim.createState('cruise');
  inRange(c.air.altitude, 2999, 3001, 'cruise altitude'); inRange(c.engine.rpm, 2380, 2420, 'cruise rpm');
  assert.ok(!c.air.onGround && c.air.heading === 60);
  var a = Sim.createState('approach');
  inRange(a.air.altitude - a.fieldElevation, 699, 701, 'approach AGL');
  inRange(a.air.ias, 64.5, 65.5, 'approach IAS'); inRange(a.air.vs, -460, -440, 'approach VS');
  assert.ok(a.flaps === 20 && a.carbHeat === 1);
  var dx = a.pos.x - A.threshold06.x, dz = a.pos.z - A.threshold06.z;
  inRange(Math.hypot(dx, dz), 3690, 3710, 'approach distance to threshold');
  inRange(Math.atan2(dx, -dz) * 180 / Math.PI, -120.5, -119.5, 'approach on extended centreline (bearing 240 from threshold)');
});

test('limits(): 150M and A150M markings', function () {
  var s = Sim.createState('parked');
  var L = Sim.limits(s);
  assert.deepStrictEqual([L.vso, L.vs1, L.vfe, L.vno, L.vne, L.va], [42, 47, 85, 107, 141, 97]);
  assert.deepStrictEqual(L.whiteArc, [42, 85]); assert.deepStrictEqual(L.greenArc, [47, 107]);
  assert.deepStrictEqual(L.yellowArc, [107, 141]); assert.deepStrictEqual(L.suctionGreen, [4.6, 5.4]);
  assert.strictEqual(L.rpmRed, 2750); assert.strictEqual(L.oilTempRed, 240);
  s.variant = 'A150M';
  var A = Sim.limits(s);
  assert.deepStrictEqual([A.vne, A.vno, A.va, A.redLine], [164, 123, 105, 164]);
  assert.ok(Object.isFrozen(A) && Object.isFrozen(A.greenArc));
});

test('engine start from parked (POH sequence): cranking, catch, oil pressure, ammeter', function () {
  var s = parkedReady();
  inRange(s.elec.busVolts, 12.2, 12.45, 'bus volts BAT only');
  Sim.actions.setIgnition(s, 'START');
  run(s, 0.6);
  assert.ok(s.engine.cranking, 'cranking');
  inRange(s.engine.rpm, 140, 200, 'cranking rpm');
  inRange(s.elec.busVolts, 10.0, 11.0, 'bus volts while cranking');
  var t = run(s, 3, function (st) { if (st.engine.running) return false; });
  assert.ok(s.engine.running, 'engine caught');
  inRange(t + 0.6, 1.0, 1.6, 'cranking time before catch');
  assert.ok(hasEvent(s, /Motor en marcha/), 'start event');
  Sim.actions.setIgnition(s, 'BOTH');
  run(s, 2);
  inRange(s.elec.ammeterAmps, 12, 19, 'ammeter right after start');
  inRange(s.elec.busVolts, 13.8, 14.3, 'bus volts with alternator');
  run(s, 3);
  inRange(s.engine.oilPressPsi, 45, 62, 'cold oil pressure 5 s after start');
  inRange(s.engine.rpm, 780, 900, 'rpm after start at throttle 0.1');
  run(s, 55);
  inRange(s.elec.ammeterAmps, 0.8, 2.6, 'ammeter after 60 s');
  assert.ok(!s.elec.highVoltageLight);
  assert.strictEqual(s.engine.primeCharges, 0);
});

test('engine start fails: cold without prime, mixture cut-off, fuel valve off', function () {
  var s = parkedReady({ primes: 0 });
  crank(s, 6);
  assert.ok(!s.engine.running, 'no start without prime when cold');
  assert.ok(hasEvent(s, /frío/), 'hint about priming');
  var m = parkedReady({ mixture: 0 });
  crank(m, 6);
  assert.ok(!m.engine.running, 'no start with mixture cut-off');
  assert.ok(hasEvent(m, /mezcla/), 'hint about mixture');
  var f = parkedReady();
  f.fuelValve = false;
  crank(f, 6);
  assert.ok(!f.engine.running, 'no start with fuel valve off');
  // A warm engine starts without priming
  var w = parkedReady({ primes: 0 });
  w.engine.oilTempF = 120;
  crank(w, 4);
  assert.ok(w.engine.running, 'warm engine starts without prime');
});

test('flooded engine: no start, clearing procedure, then start without priming', function () {
  var s = parkedReady({ primes: 7 });
  assert.ok(s.engine.flooded, 'flooded after 7 strokes');
  assert.ok(hasEvent(s, /ahogado/), 'flooded event');
  crank(s, 5);
  assert.ok(!s.engine.running, 'flooded engine does not start');
  s.mixture = 0; s.throttle = 1;
  crank(s, 3.5);
  assert.ok(!s.engine.flooded, 'cleared after ≥ 3 s cranking at cut-off/full throttle');
  assert.ok(hasEvent(s, /despejado/));
  s.mixture = 1; s.throttle = 0.1;
  crank(s, 3);
  assert.ok(s.engine.running, 'starts without priming after clearing');
});

test('warnings: control lock while cranking, START while running, START without master', function () {
  var s = parkedReady({ keepLock: true });
  crank(s, 3);
  assert.ok(hasEvent(s, /traba de comandos/), 'control lock warning');
  s.events.length = 0;
  Sim.actions.setIgnition(s, 'START');
  run(s, 0.2);
  assert.ok(hasEvent(s, /ya está en marcha/), 'START while running');
  Sim.actions.setIgnition(s, 'BOTH');
  var p = Sim.createState('parked');
  Sim.actions.setIgnition(p, 'START');
  run(p, 1);
  assert.ok(!p.engine.cranking && hasEvent(p, /master/), 'no starter without master');
  var y = Sim.createState('parked');
  y.yokePitch = 1;
  run(y, 0.5);
  assert.ok(hasEvent(y, /volante no se mueve/) && y.surfaces.elevator === 0, 'locked yoke');
});

function rpmAt(s, seconds) { run(s, seconds); return s.engine.rpm; }

test('run-up at 1700 RPM: magneto drops and carb heat drop', function () {
  var s = Sim.createState('runup');
  s.throttle = (1700 - 650) / 1850;
  var base = rpmAt(s, 4);
  inRange(base, 1690, 1710, 'run-up rpm');
  s.ignition = 'L'; var l = rpmAt(s, 3);
  s.ignition = 'BOTH'; rpmAt(s, 3);
  s.ignition = 'R'; var r = rpmAt(s, 3);
  s.ignition = 'BOTH'; rpmAt(s, 3);
  s.carbHeat = 1; var ch = rpmAt(s, 3);
  s.carbHeat = 0;
  var dL = base - l, dR = base - r, dC = base - ch;
  inRange(dL, 80, 100, 'left mag drop'); inRange(dR, 60, 80, 'right mag drop');
  inRange(Math.abs(dL - dR), 0, 75, 'mag difference');
  inRange(dC, 60, 90, 'carb heat drop at 1700');
  record('Caída magneto L / R a 1700', dL, 'máx 150', 'rpm'); perf[perf.length - 1].valor += ' / ' + Math.round(dR);
  record('Caída calefacción carburador a 1700', dC, '≈ 75', 'rpm');
  s.throttle = 1;
  var full = rpmAt(s, 4);
  inRange(full, 2460, 2560, 'static rpm');
  s.carbHeat = 1;
  var fullHot = rpmAt(s, 3);
  inRange(full - fullHot, 200, 250, 'carb heat drop at full throttle');
  record('RPM estáticas (acelerador a fondo)', full, '2460–2560', 'rpm');
  record('Caída calefacción carburador a fondo', full - fullHot, '200–250', 'rpm');
  assert.ok(s.air.groundSpeed === 0, 'parking brake holds full power');
  s.ignition = 'OFF';
  run(s, 1);
  assert.ok(!s.engine.running && hasEvent(s, /magnetos en OFF/), 'mags OFF stops the engine');
});

test('mixture: leaning peak, roughness, idle cut-off stops the engine', function () {
  var s = Sim.createState('cruise');
  var rich = rpmAt(s, 2);
  var best = 0, bestM = 1;
  for (var m = 1; m >= 0.4; m -= 0.05) { s.mixture = m; var v = rpmAt(s, 2); if (v > best) { best = v; bestM = m; } }
  inRange(best - rich, 15, 70, 'rpm gain at peak');
  inRange(bestM, 0.65, 0.85, 'peak mixture');
  s.mixture = 0.3; run(s, 2);
  assert.ok(s.engine.roughness > 0.4 && s.engine.rpm < rich - 300, 'very lean is rough and slow');
  s.mixture = 0;
  var t = run(s, 5, function (st) { if (!st.engine.running) return false; });
  assert.ok(!s.engine.running, 'cut-off stops the engine');
  inRange(t, 1.5, 3, 'time to stop at cut-off');
  assert.ok(hasEvent(s, /mezcla en corte/));
  run(s, 5);
  inRange(s.propRpm, 8 * s.air.ias - 40, 8 * s.air.ias + 40, 'windmilling prop rpm');
});

test('fuel valve OFF in flight: engine quits after ≈ 15 s, restarts windmilling when ON', function () {
  var s = Sim.createState('cruise');
  s.fuelValve = false;
  var t = run(s, 30, function (st) { if (!st.engine.running) return false; });
  inRange(t, 13, 17, 'seconds until the engine quits');
  assert.ok(hasEvent(s, /válvula de corte en OFF/));
  run(s, 5, speedHold(65));
  s.fuelValve = true;
  run(s, 10, speedHold(65));
  assert.ok(s.engine.running && hasEvent(s, /volvió a arrancar/), 'windmill restart');
});

test('cruise preset holds altitude (±50 ft) and heading for 60 s with no input', function () {
  var s = Sim.createState('cruise');
  var a0 = s.air.altitude, h0 = s.air.heading, maxDA = 0, maxDH = 0;
  run(s, 60, function (st) {
    maxDA = Math.max(maxDA, Math.abs(st.air.altitude - a0));
    maxDH = Math.max(maxDH, Math.abs(wrap180(st.air.heading - h0)));
  });
  inRange(maxDA, 0, 50, 'altitude deviation');
  inRange(maxDH, 0, 5, 'heading deviation');
  record('Crucero 3000 ft: RPM / KIAS', s.engine.rpm, '≈ 2400', 'rpm'); perf[perf.length - 1].valor += ' / ' + s.air.ias.toFixed(1) + ' kt';
  record('Crucero: desvío de altura en 60 s', maxDA, '≤ 50', 'ft');
});

test('approach preset holds ≈ −450 ft/min at 65 KIAS', function () {
  var s = Sim.createState('approach');
  var sum = 0, n = 0;
  run(s, 20, function (st) { sum += st.air.vs; n++; inRange(st.air.ias, 62, 68, 'approach IAS'); });
  inRange(sum / n, -550, -350, 'approach vertical speed');
  record('Aproximación flaps 20: VS media', sum / n, '≈ −450', 'ft/min');
});

test('performance: Vmax, 2400 RPM level speed, climb, glide, stall speeds', function () {
  var s = airborne(0, 100); s.throttle = 1;
  run(s, 300, altHold(0));
  inRange(s.air.ias, 105, 110, 'full-throttle level speed');
  record('Vel. máx. nivelado a fondo (nivel del mar)', s.air.ias, '105–110', 'KIAS');
  record('RPM a fondo a velocidad máxima', s.engine.rpm, '≈ 2700–2750', 'rpm');

  var c = airborne(0, 90), ah = altHold(0);
  run(c, 400, function (st) { ah(st); st.throttle = clamp(st.throttle + (2400 - st.engine.rpm) * 0.00002, 0, 1); });
  inRange(c.engine.rpm, 2390, 2410, 'rpm');
  inRange(c.air.ias, 85, 92, '2400 rpm level speed');
  record('2400 RPM nivelado (nivel del mar)', c.air.ias, '85–92', 'KIAS');

  var k = airborne(-2500, 68); k.throttle = 1;
  run(k, 60, speedHold(68));
  var a0 = k.air.altitude;
  run(k, 20, speedHold(68));
  var roc = (k.air.altitude - a0) * 3;
  inRange(roc, 550, 750, 'full-throttle climb at 68 KIAS');
  record('Ascenso a fondo a 68 KIAS (Vy)', roc, '550–750 (POH 670)', 'ft/min');

  var g = airborne(-1000, 60); g.throttle = 0;
  run(g, 60, speedHold(60));
  var g0 = g.air.altitude;
  run(g, 30, speedHold(60));
  var sink = (g.air.altitude - g0) * 2;
  inRange(sink, -800, -550, 'idle glide at 60 KIAS');
  record('Planeo en ralentí a 60 KIAS', sink, '−550…−800', 'ft/min');

  function stallSpeed(flaps) {
    var st = airborne(3000, 70); st.flaps = flaps; st.throttle = 0;
    var vst = null, horn = null, hold = altHold(3000);
    run(st, 120, function (x) {
      if (horn === null && x.air.stallWarning) horn = x.air.ias;
      if (x.air.stalled) { vst = x.air.ias; return false; }
      hold(x);
    });
    return { vs: vst, horn: horn };
  }
  var clean = stallSpeed(0), full = stallSpeed(40);
  inRange(clean.vs, 45, 49, 'clean stall');
  inRange(full.vs, 40, 44, 'flaps-40 stall');
  inRange(clean.horn - clean.vs, 4, 10, 'horn margin clean');
  record('Pérdida sin flaps', clean.vs, '45–49 (POH 47)', 'KIAS');
  record('Pérdida flaps 40°', full.vs, '40–44 (POH 42)', 'KIAS');
  record('Bocina antes de la pérdida (sin flaps)', clean.horn - clean.vs, '5–10', 'kt');
});

test('pull → climb and slow down; push → descend and speed up', function () {
  var s = Sim.createState('cruise');
  var ias0 = s.air.ias, alt0 = s.air.altitude;
  s.yokePitch = 0.3;
  run(s, 6);
  assert.ok(s.air.vs > 300 && s.air.altitude > alt0 + 20, 'climbing after pull');
  assert.ok(s.air.ias < ias0 - 5, 'slower after pull');
  assert.ok(s.air.pitch > 5, 'nose up');
  var p = Sim.createState('cruise');
  p.yokePitch = -0.3;
  run(p, 6);
  assert.ok(p.air.vs < -300 && p.air.altitude < alt0 - 20, 'descending after push');
  assert.ok(p.air.ias > ias0 + 5, 'faster after push');
  assert.ok(p.air.pitch < -1, 'nose down');
});

test('phugoid is damped: a short pull then release settles within ≈ 20 s', function () {
  var s = Sim.createState('cruise');
  s.yokePitch = 0.3; run(s, 2); s.yokePitch = 0;
  run(s, 25);
  var maxVs = 0;
  run(s, 10, function (st) { maxVs = Math.max(maxVs, Math.abs(st.air.vs)); });
  inRange(maxVs, 0, 150, 'residual vertical speed oscillation');
});

test('roll left → left bank, heading decreases; roll right → heading increases', function () {
  var s = Sim.createState('cruise');
  var h0 = s.air.heading;
  s.yokeRoll = -0.5; run(s, 1.2); s.yokeRoll = 0;
  assert.ok(s.air.bank < -15, 'left bank ' + s.air.bank);
  assert.ok(s.air.turnRate < 0, 'turning left');
  run(s, 10);
  assert.ok(wrap180(s.air.heading - h0) < -15, 'heading decreased');
  assert.ok(s.air.bank < -15, 'bank holds (neutral stability)');
  var r = Sim.createState('cruise');
  r.yokeRoll = 0.5; run(r, 1.2); r.yokeRoll = 0; run(r, 10);
  assert.ok(wrap180(r.air.heading - h0) > 15, 'heading increased');
  r.yokeRoll = -0.5;
  var surf = (Sim.step(r, 0.02), r.surfaces);
  assert.ok(surf.aileronL < 0 && surf.aileronR > 0, 'wheel left: left aileron up, right down');
});

test('coordination: adverse yaw shows on the ball, correct rudder centres it', function () {
  var s = Sim.createState('cruise'), maxSlip = 0;
  s.yokeRoll = 0.6;
  run(s, 1.5, function (st) { maxSlip = Math.max(maxSlip, st.air.slip); });
  assert.ok(maxSlip > 0.12, 'ball right without rudder during a right roll-in: ' + maxSlip);
  var c = Sim.createState('cruise'), worst = 0;
  c.yokeRoll = 0.6;
  run(c, 1.5, function (st, t) {
    st.rudder = 0.35 * st.air.rollRate / 50;
    if (t > 0.3) worst = Math.max(worst, Math.abs(st.air.slip));
  });
  inRange(worst, 0, 0.06, 'slip with coordinated rudder');
  c.yokeRoll = 0; c.rudder = 0;
  run(c, 3);
  inRange(Math.abs(c.air.slip), 0, 0.03, 'ball centred in the steady turn');
  record('Bola con pie coordinado al inclinar', worst, '≈ 0', '');
});

test('stall: full aft yoke at idle stalls (nose drops, altitude lost) and recovers', function () {
  // Classic power-off stall: idle, back pressure increased smoothly up to full aft, then held.
  var s = Sim.createState('cruise');
  s.throttle = 0;
  var stalledAt = null, pitchAtBreak = 0, pitchAfter = 99, alt0 = null;
  run(s, 60, function (st, t) {
    st.yokePitch = Math.min(1, 0.05 * t);
    if (stalledAt === null) {
      if (st.air.stalled) { stalledAt = t; alt0 = st.air.altitude; pitchAtBreak = st.air.pitch; }
    } else if (t < stalledAt + 2.5) pitchAfter = Math.min(pitchAfter, st.air.pitch);
  });
  assert.ok(stalledAt !== null, 'stalled');
  assert.ok(hasEvent(s, /Pérdida!/), 'stall event');
  assert.ok(hasEvent(s, /Bocina de pérdida/), 'horn event');
  inRange(pitchAtBreak - pitchAfter, 8, 30, 'nose drop at the break');
  assert.ok(s.air.altitude < alt0, 'altitude lost while holding full aft');
  // Recovery: release back pressure, full power
  s.yokePitch = 0; s.throttle = 1;
  var t = run(s, 10, function (st) { if (!st.air.stalled) return false; });
  inRange(t, 0, 3, 'seconds to un-stall');
  run(s, 15, speedHold(70));
  assert.ok(!s.air.stalled && s.air.ias > 55 && s.air.vs > -200, 'recovered: ' + s.air.ias.toFixed(0) + ' kt ' + s.air.vs.toFixed(0) + ' fpm');
});

test('abrupt full aft yoke at cruise speed: accelerated stall, recovers when released', function () {
  var s = Sim.createState('cruise');
  s.throttle = 0; s.yokePitch = 1;
  var gMax = 0;
  run(s, 3, function (st) { gMax = Math.max(gMax, st.air.gLoad); });
  assert.ok(hasEvent(s, /Pérdida!/), 'stall event');
  inRange(gMax, 1.8, 4.4, 'load factor at the accelerated stall');
  s.yokePitch = 0; s.throttle = 1;
  run(s, 20, speedHold(75));
  assert.ok(!s.air.stalled && s.air.ias > 60, 'recovered');
});

test('takeoff from runway 06: full throttle, rotate at 50, climb to 600 ft AGL', function () {
  var s = Sim.createState('runway');
  var x0 = s.pos.x, z0 = s.pos.z, roll = null, lof = null, t600 = null;
  s.throttle = 1;
  run(s, 150, function (st, t) {
    var err = wrap180(60 - st.air.heading);
    if (st.air.onGround) {
      st.rudder = clamp(0.3 * err, -1, 1);
      st.yokePitch = st.air.ias > 50 ? 0.8 : 0;
    } else {
      if (roll === null) { roll = Math.hypot(st.pos.x - x0, st.pos.z - z0); lof = st.air.ias; }
      st.yokePitch = 0;
      st.yokeRoll = clamp(0.05 * (2 * err - st.air.bank), -1, 1);
      st.rudder = clamp(0.35 * st.air.rollRate / 50 + 0.16, -1, 1);
      if (st.air.altitude - st.fieldElevation >= 600) { t600 = t; return false; }
    }
  });
  assert.ok(hasEvent(s, /Despegaste/), 'takeoff event');
  inRange(roll, 200, 260, 'takeoff ground roll (POH 735 ft = 224 m)');
  inRange(lof, 48, 57, 'lift-off speed');
  assert.ok(t600 !== null && t600 < 120, 'reached 600 ft AGL');
  inRange(Math.abs(wrap180(s.air.heading - 60)), 0, 10, 'heading kept');
  record('Carrera de despegue', roll, '200–260 (POH 224 m)', 'm');
  record('Velocidad de despegue (rotación a 50)', lof, '50–55', 'KIAS');
  record('Tiempo hasta 600 ft AGL', t600, '< 120', 's');
});

test('landing from the approach preset: flare gives a good touchdown', function () {
  var s = Sim.createState('approach');
  var flare = false, landed = false;
  run(s, 150, function (st) {
    var agl = st.air.altitude - st.fieldElevation;
    if (!flare && agl < 25) { flare = true; st.throttle = 0; }
    if (flare && !st.air.onGround) st.yokePitch = clamp(0.25 + (-st.air.vs - 150) * 0.002, 0, 1);
    if (st.air.onGround) { landed = true; st.yokePitch = 0; st.brakeL = st.brakeR = 0.6; }
    if (landed && st.air.groundSpeed < 1) return false;
  });
  assert.ok(landed, 'touched down');
  assert.ok(hasEvent(s, /Tocaste la pista/) && !hasEvent(s, /Aterrizaje duro/), 'good landing: ' + s.events.map(function (e) { return e.text; }).join(' | '));
  assert.ok(s.air.groundSpeed < 1, 'stopped with brakes');
  // A dive into the runway is reported as hard (no crash model)
  var h = Sim.createState('approach');
  h.yokePitch = -0.6;
  run(h, 60, function (st) { if (st.air.onGround) return false; });
  assert.ok(h.air.onGround && hasEvent(h, /Aterrizaje duro/), 'hard landing event');
});

test('ground handling: taxi speed at 1000 RPM, nose-wheel steering, brakes', function () {
  var s = Sim.createState('runup');
  s.parkingBrake = false;
  run(s, 60);
  inRange(s.air.groundSpeed, 6, 10, 'taxi speed at ~1000 rpm');
  record('Rodaje a ~1000 RPM sin frenos', s.air.groundSpeed, '6–10', 'kt');
  var h0 = s.air.heading;
  s.rudder = -1; run(s, 2);
  assert.ok(wrap180(s.air.heading - h0) < -10 && s.noseWheelAngle === -8.5, 'left pedal turns left');
  assert.ok(s.air.turnRate < 0 && s.air.slip > 0, 'TC left, ball right in a left taxi turn');
  s.rudder = 0; s.brakeL = 1; s.brakeR = 1; s.throttle = 0;
  run(s, 3);
  assert.ok(s.air.groundSpeed === 0, 'brakes stop the airplane');
  var idle = Sim.createState('runway');
  run(idle, 10);
  assert.ok(idle.air.groundSpeed === 0, 'no creep at idle');
});

test('flaps: ≈ 9 s to extend while DOWN is held, ≈ 6 s to retract, need power', function () {
  var s = Sim.createState('runup');
  Sim.actions.setFlapSwitch(s, 'DOWN');
  var t = run(s, 15, function (st) { if (st.flaps >= 40) return false; });
  inRange(t, 8.5, 9.6, 'extension time');
  Sim.actions.setFlapSwitch(s, 'OFF');
  run(s, 1);
  assert.strictEqual(s.flaps, 40);
  Sim.actions.setFlapSwitch(s, 'UP');
  t = run(s, 10, function (st) { if (st.flaps <= 0) return false; });
  inRange(t, 5.5, 6.6, 'retraction time');
  Sim.actions.setFlapSwitch(s, 'DOWN');
  run(s, 2);
  Sim.actions.setFlapSwitch(s, 'OFF');
  inRange(s.flaps, 8, 10, 'two seconds of DOWN');
  Sim.actions.setFlapSwitch(s, 'BOGUS');
  assert.strictEqual(s.flapSwitch, 'OFF');
  var p = Sim.createState('parked');
  Sim.actions.setFlapSwitch(p, 'DOWN');
  run(p, 3);
  assert.strictEqual(p.flaps, 0, 'no flaps without electrical power');
  assert.strictEqual(p.surfaces.flaps, 0);
  // Overspeed warning with flaps out
  var c = Sim.createState('cruise');
  c.flaps = 10; c.yokePitch = -0.2;
  run(c, 6);
  assert.ok(hasEvent(c, /Flaps abajo/), 'flap overspeed event');
});

test('master interlock, bus voltages, ammeter and HIGH VOLTAGE light', function () {
  var s = Sim.createState('parked');
  Sim.actions.setMaster(s, 'alt', true);
  assert.ok(s.masterAlt && s.masterBat, 'ALT on pushes BAT on');
  Sim.actions.setMaster(s, 'bat', false);
  assert.ok(!s.masterAlt && !s.masterBat, 'BAT off takes ALT off');
  s.masterAlt = true; s.masterBat = false;
  Sim.step(s, 0.02);
  assert.ok(!s.masterAlt, 'step enforces ALT ⇒ BAT');
  Sim.actions.setMaster(s, 'bat', true);
  run(s, 0.5);
  assert.ok(s.elec.highVoltageLight, 'light test with BAT only');
  assert.ok(s.gyro.tcPowered, 'turn coordinator powered');
  s.lights.landing = true; s.pitotHeat = true;
  run(s, 0.5);
  inRange(s.elec.ammeterAmps, -21, -18, 'discharge = loads');
  var pct0 = s.elec.batteryPct;
  run(s, 60);
  assert.ok(s.elec.batteryPct < pct0 - 3, 'battery drains');
  Sim.actions.setMaster(s, 'bat', false);
  run(s, 0.1);
  assert.ok(s.elec.busVolts === 0 && !s.gyro.tcPowered && !s.elec.highVoltageLight);
  var r = Sim.createState('runup');
  inRange(r.elec.busVolts, 14.0, 14.2, 'alternator bus voltage');
  r.masterAlt = false;
  run(r, 1);
  assert.ok(r.elec.ammeterAmps < -5 && r.elec.busVolts < 12.6 && r.elec.highVoltageLight, 'ALT off: battery carries the loads');
});

test('vacuum and gyros: suction at idle and 1700, spin-up and spin-down, HI drift', function () {
  var s = parkedReady();
  crank(s, 3);
  s.throttle = 0;
  run(s, 3);
  inRange(s.vacuum.suctionInHg, 3.6, 4.0, 'suction at idle');
  s.throttle = 0.57; s.parkingBrake = true;
  run(s, 3);
  inRange(s.vacuum.suctionInHg, 4.9, 5.1, 'suction at 1700');
  run(s, 60);
  assert.ok(s.gyro.aiSpin > 0.95 && s.gyro.hiSpin > 0.95, 'gyros spun up');
  var c = Sim.createState('cruise');
  run(c, 120);
  var drift = wrap180(c.air.hiHeading - c.air.heading);
  inRange(drift, 1.5, 2.5, 'HI drift after 2 min (accelerated ≈ 1°/min)');
  c.hiCorrection = -drift;
  run(c, 0.1);
  inRange(Math.abs(wrap180(c.air.hiHeading - c.air.heading)), 0, 0.1, 'knob realigns the HI');
  c.mixture = 0;
  run(c, 90, speedHold(65));
  assert.ok(c.gyro.aiSpin < 0.8, 'gyros spin down without vacuum');
});

test('oil temperature and pressure trends', function () {
  var s = parkedReady();
  crank(s, 3);
  s.throttle = 0.2;
  run(s, 300);
  inRange(s.engine.oilTempF, 110, 150, 'oil temp after 5 min at ~1000 rpm');
  var w = Sim.createState('runup');
  w.engine.oilTempF = 180; w.throttle = 0;
  run(w, 10);
  inRange(w.engine.oilPressPsi, 18, 28, 'warm idle oil pressure');
  var c = Sim.createState('cruise');
  run(c, 300);
  inRange(c.engine.oilTempF, 160, 200, 'cruise oil temp');
  inRange(c.engine.oilPressPsi, 40, 55, 'cruise oil pressure');
  c.ignition = 'OFF';
  run(c, 10);
  inRange(c.engine.oilPressPsi, 0, 10, 'pressure decays after shutdown (windmilling)');
});

test('carburetor ice: forms only when enabled, carb heat melts it', function () {
  var off = Sim.createState('cruise');
  off.throttle = 0.6;
  run(off, 60);
  assert.strictEqual(off.engine.carbIce, 0, 'no ice when disabled');
  var s = Sim.createState('cruise');
  s.carbIceEnabled = true; s.throttle = 0.6;
  run(s, 5, altHold(3000));
  var before = s.engine.rpm;
  run(s, 60, altHold(3000));
  assert.ok(s.engine.carbIce > 0.5 && s.engine.rpm < before - 120, 'rpm lost to ice');
  assert.ok(hasEvent(s, /hielo en el carburador/));
  var iced = s.engine.rpm;
  s.carbHeat = 1;
  run(s, 2, altHold(3000));
  assert.ok(s.engine.rpm < iced && s.engine.roughness > 0.3, 'rough while the ice melts');
  run(s, 25, altHold(3000));
  assert.ok(s.engine.carbIce < 0.05, 'ice melted');
  s.carbHeat = 0;
  run(s, 5, altHold(3000));
  assert.ok(s.engine.rpm > iced + 120, 'rpm recovered');
});

test('limit events: Vne, red line, battery low', function () {
  var s = Sim.createState('cruise');
  s.throttle = 1; s.yokePitch = -0.8;
  run(s, 40, function (st) { if (st.air.ias > 150) return false; });
  assert.ok(hasEvent(s, /VNE/), 'Vne event');
  assert.ok(hasEvent(s, /línea roja/), 'red line event');
  var b = Sim.createState('parked');
  Sim.actions.setMaster(b, 'bat', true);
  b.lights.landing = true; b.lights.taxi = true; b.pitotHeat = true; b.lights.nav = true;
  run(b, 600);
  assert.ok(hasEvent(b, /Batería baja/), 'battery low event');
});

test('no NaN: 10 minutes of random inputs from every preset', function () {
  var seed = 7;
  function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  var ign = ['OFF', 'R', 'L', 'BOTH', 'START'], flap = ['UP', 'OFF', 'DOWN'];
  Object.keys(Sim.PRESETS).forEach(function (p) {
    var s = Sim.createState(p);
    s.carbIceEnabled = true;
    for (var i = 0; i < 6000; i++) {
      if (i % 20 === 0) {
        s.yokeRoll = rand() * 2 - 1; s.yokePitch = rand() * 2 - 1; s.rudder = rand() * 2 - 1;
        s.throttle = rand(); s.brakeL = rand() < 0.2 ? rand() : 0; s.brakeR = rand() < 0.2 ? rand() : 0;
        if (rand() < 0.05) s.mixture = rand(); else if (s.mixture < 0.7) s.mixture = 1;
        if (rand() < 0.05) s.carbHeat = rand();
        if (rand() < 0.03) s.ignition = ign[Math.floor(rand() * 5)];
        if (rand() < 0.03) s.flapSwitch = flap[Math.floor(rand() * 3)];
        if (rand() < 0.02) Sim.actions.setMaster(s, rand() < 0.5 ? 'bat' : 'alt', rand() < 0.7);
        if (rand() < 0.02) s.fuelValve = rand() < 0.8;
        if (rand() < 0.02) Sim.actions.primeStroke(s);
        if (rand() < 0.02) s.trim = rand() * 2 - 1;
        if (rand() < 0.01) s.controlLock = rand() < 0.2;
        if (rand() < 0.01) s.parkingBrake = rand() < 0.3;
      }
      Sim.step(s, 0.02 + rand() * 0.15);
      if (s.events.length > 30) s.events.length = 0;
    }
    var vals = [s.air.ias, s.air.tas, s.air.altitude, s.air.vs, s.air.pitch, s.air.bank, s.air.heading, s.air.hiHeading,
      s.air.turnRate, s.air.slip, s.air.aoa, s.air.gLoad, s.air.groundSpeed, s.pos.x, s.pos.z, s.engine.rpm,
      s.engine.oilTempF, s.engine.oilPressPsi, s.elec.busVolts, s.elec.ammeterAmps, s.elec.batteryPct,
      s.vacuum.suctionInHg, s.gyro.aiSpin, s.flaps, s.surfaces.elevator, s.noseWheelAngle, s.propRpm, s.time];
    vals.forEach(function (v, i) { assert.ok(isFinite(v), p + ': value #' + i + ' is ' + v); });
    assert.ok(s.air.ias >= 0 && s.air.altitude >= s.fieldElevation - 1e-6, p + ': ias/altitude bounds');
    assert.ok(s.air.heading >= 0 && s.air.heading < 360 && Math.abs(s.air.slip) <= 1, p + ': heading/slip bounds');
  });
});

test('step(): dt clamping, pause, garbage dt', function () {
  var s = Sim.createState('cruise');
  Sim.step(s, 5);
  inRange(s.time, 0.099, 0.101, 'dt clamped to 0.1');
  s.paused = true; Sim.step(s, 0.05);
  inRange(s.time, 0.099, 0.101, 'paused');
  s.paused = false;
  Sim.step(s, NaN); Sim.step(s, -1); Sim.step(s, 0);
  inRange(s.time, 0.099, 0.101, 'ignored bad dt');
  var t0 = Date.now();
  var b = Sim.createState('cruise');
  for (var i = 0; i < 36000; i++) Sim.step(b, 1 / 60);      // 10 simulated minutes at 60 fps
  var ms = Date.now() - t0;
  assert.ok(ms < 3000, '10 min of sim took ' + ms + ' ms');
  record('Costo: 10 min simulados a 60 fps', ms, '< 3000', 'ms');
});

/* ====================================================== aero snapshot (v2 §1) */

var AERO_KEYS = ['ias', 'tas', 'aoa', 'beta', 'q', 'cl', 'cd', 'lOverD', 'liftN', 'dragN', 'thrustN', 'weightN',
  'liftLN', 'liftRN', 'flapLiftN', 'tailN', 'rollMoment', 'pitchMoment', 'yawMoment', 'downwashDeg', 'propWashMs',
  'propSwirl', 'stallBlend', 'groundEffect'];
function aeroFinite(a, what) {
  AERO_KEYS.forEach(function (k) { assert.ok(typeof a[k] === 'number' && isFinite(a[k]), what + ': aero.' + k + ' = ' + a[k]); });
  ['rollMoment', 'pitchMoment', 'yawMoment'].forEach(function (k) { inRange(a[k], -1, 1, what + ' ' + k); });
  inRange(a.stallBlend, 0, 1, what + ' stallBlend');
  inRange(a.propSwirl, 0, 1, what + ' propSwirl');
  inRange(a.groundEffect, 0, 1, what + ' groundEffect');
}
function tunnelState(ias, aoa) {
  var s = Sim.createState('parked');
  Sim.applyPreset(s, 'tunnel');
  if (ias !== undefined) s.tunnel.ias = ias;
  if (aoa !== undefined) s.tunnel.aoa = aoa;
  run(s, 0.5);
  return s;
}

test('aero: every preset has a complete snapshot (same object across steps and presets)', function () {
  ['parked', 'runup', 'runway', 'cruise', 'approach', 'tunnel'].forEach(function (p) {
    var s = Sim.createState(p);
    var ref = s.aero;
    aeroFinite(s.aero, p + ' (preset)');
    run(s, 1);
    assert.ok(s.aero === ref, p + ': state.aero keeps its reference');
    aeroFinite(s.aero, p + ' (1 s)');
    Sim.applyPreset(s, 'cruise');
    assert.ok(s.aero === ref, p + ': applyPreset keeps the aero reference');
  });
  var parked = Sim.createState('parked');
  assert.strictEqual(parked.aero.liftN, 0, 'no wind → no lift');
  assert.strictEqual(parked.aero.cl, 0, 'no wind → cl 0');
  inRange(parked.aero.weightN, 7000, 7200, 'weight always reported (N)');
});

test('aero: lift ≈ weight and thrust ≈ drag in level cruise', function () {
  var s = Sim.createState('cruise');
  run(s, 10);
  var a = s.aero;
  inRange(a.liftN / a.weightN, 0.97, 1.03, 'lift / weight');
  inRange(a.thrustN / a.dragN, 0.9, 1.1, 'thrust / drag');
  inRange(a.lOverD, 8, 14, 'L/D cruise');
  inRange(Math.abs(a.liftLN - a.liftRN), 0, 30, 'wings even with the wheel centred (N)');
  assert.ok(a.tailN < 0, 'the horizontal tail pushes DOWN in cruise (' + Math.round(a.tailN) + ' N)');
  inRange(a.downwashDeg, 1, 4, 'downwash behind the wing (deg)');
  inRange(a.propWashMs, 2, 12, 'prop wash in cruise (m/s)');
  inRange(Math.abs(a.pitchMoment) + Math.abs(a.rollMoment) + Math.abs(a.yawMoment), 0, 0.1, 'trimmed: no tendencies');
  assert.strictEqual(a.stallBlend, 0, 'attached flow');
  record('Sustentación / peso en crucero', a.liftN / a.weightN, '≈ 1', '');
  record('L/D en crucero', a.lOverD, '8…14', '');
  var ap = Sim.createState('approach');
  run(ap, 3);
  inRange(ap.aero.liftN / ap.aero.weightN, 0.95, 1.05, 'lift / weight on the approach');
  assert.ok(ap.aero.flapLiftN > 1500, 'flaps 20 carry part of the lift on the approach');
});

test('aero: flaps raise cl and cd (pure function and tunnel)', function () {
  var c0 = Sim.aero({ ias: 70, aoa: 6, flaps: 0 }), c20 = Sim.aero({ ias: 70, aoa: 6, flaps: 20 });
  var c40 = Sim.aero({ ias: 70, aoa: 6, flaps: 40 });
  assert.ok(c20.cl > c0.cl && c40.cl > c20.cl, 'cl grows with flaps');
  assert.ok(c20.cd > c0.cd && c40.cd > c20.cd, 'cd grows with flaps');
  assert.ok(c40.flapLiftN > 0 && c0.flapLiftN === 0, 'flapLiftN only with flaps');
  assert.ok(c40.downwashDeg > c0.downwashDeg, 'more downwash with flaps');
  assert.ok(c40.lOverD < c0.lOverD, 'flaps lower L/D');
  var s = tunnelState(70, 6);
  var before = { cl: s.aero.cl, cd: s.aero.cd, lift: s.aero.liftN, drag: s.aero.dragN, pm: s.aero.pitchMoment };
  Sim.actions.setFlapSwitch(s, 'DOWN');
  run(s, 10);
  inRange(s.flaps, 39.9, 40, 'flaps run down in the tunnel');
  assert.ok(s.aero.cl > before.cl + 0.3 && s.aero.cd > before.cd + 0.03, 'tunnel: cl and cd up with flaps');
  assert.ok(s.aero.liftN > before.lift && s.aero.dragN > before.drag, 'tunnel: more lift AND more drag');
  assert.ok(s.aero.pitchMoment > before.pm + 0.1, 'flaps: nose-up tendency (balloon)');
  assert.ok(s.aero.tailN < 0, 'tail down force with flaps');
});

test('aero: ailerons make liftL ≠ liftR with the right sign (and adverse yaw)', function () {
  var s = tunnelState(80, 4);
  s.yokeRoll = 1;                                         // wheel right: left aileron DOWN
  run(s, 0.5);
  assert.ok(s.surfaces.aileronL > 0 && s.surfaces.aileronR < 0, 'surfaces: left down, right up');
  assert.ok(s.aero.liftLN > s.aero.liftRN + 500, 'wheel right: LEFT wing lifts more (' +
    Math.round(s.aero.liftLN) + ' vs ' + Math.round(s.aero.liftRN) + ')');
  assert.ok(s.aero.rollMoment > 0.5, 'wheel right: right wing goes down (+)');
  assert.ok(s.aero.yawMoment < 0, 'adverse yaw: the nose goes LEFT, toward the rising wing');
  s.yokeRoll = -1;
  run(s, 0.5);
  assert.ok(s.aero.liftRN > s.aero.liftLN + 500 && s.aero.rollMoment < -0.5, 'wheel left: mirror');
  assert.ok(s.aero.yawMoment > 0, 'wheel left: adverse yaw to the right');
  s.yokeRoll = 0; s.rudder = 1;
  run(s, 0.5);
  assert.ok(s.aero.yawMoment > 0.5, 'right pedal: nose right');
  // In flight the airplane really rolls; roll damping shrinks (but keeps) the differential.
  var f = Sim.createState('cruise');
  f.yokeRoll = 0.6;
  run(f, 0.1);
  var d0 = f.aero.liftLN - f.aero.liftRN;
  run(f, 2);
  var d1 = f.aero.liftLN - f.aero.liftRN;
  assert.ok(d0 > 0 && d1 > 0 && d1 < d0, 'flight: differential shrinks with roll damping (' + Math.round(d0) + ' → ' + Math.round(d1) + ')');
  assert.ok(f.air.bank > 10, 'flight: the airplane banks right');
  assert.ok(f.aero.rollMoment > 0, 'flight: roll tendency to the right while rolling');
  // Sideslip in the tunnel: wind from the right lifts the right wing (dihedral) and weathercocks the nose right.
  var b = tunnelState(80, 4);
  b.tunnel.beta = 10;
  run(b, 0.3);
  assert.ok(b.aero.liftRN > b.aero.liftLN && b.aero.rollMoment < 0 && b.aero.yawMoment > 0, 'sideslip from the right');
});

test('aero: throttle raises thrust, prop wash and swirl; P-factor yaws left', function () {
  var s = tunnelState(50, 6);
  s.throttle = 0.2;
  run(s, 4);
  var lo = { T: s.aero.thrustN, w: s.aero.propWashMs, sw: s.aero.propSwirl, pm: s.aero.pitchMoment };
  s.throttle = 1;
  run(s, 4);
  assert.ok(s.engine.rpm > 2200, 'full throttle in the tunnel: rpm up (' + Math.round(s.engine.rpm) + ')');
  assert.ok(s.aero.thrustN > lo.T + 500, 'thrust up (' + Math.round(lo.T) + ' → ' + Math.round(s.aero.thrustN) + ' N)');
  assert.ok(s.aero.propWashMs > lo.w + 5, 'prop wash up (' + lo.w.toFixed(1) + ' → ' + s.aero.propWashMs.toFixed(1) + ' m/s)');
  assert.ok(s.aero.propSwirl > lo.sw, 'swirl up');
  assert.ok(s.aero.yawMoment < -0.1, 'P-factor + slipstream at 50 kt full power: nose left');
  assert.ok(s.aero.pitchMoment > lo.pm + 0.1, 'power pitches the nose up');
  var r = Sim.createState('runup');
  r.throttle = 1;
  run(r, 4);
  inRange(r.aero.propWashMs, 25, 45, 'static full-power slipstream (m/s)');
  assert.strictEqual(r.aero.liftN, 0, 'no wind on the ground → no lift');
});

test('aero: stallBlend → 1 past the stall (tunnel and flight), 0 when attached', function () {
  var s = tunnelState(60, 4);
  assert.ok(s.aero.stallBlend < 0.01, 'attached at 4°');
  s.tunnel.aoa = 14;
  run(s, 1.5);
  assert.ok(s.aero.stallBlend > 0.1 && s.aero.stallBlend < 0.9 && s.air.stallWarning && !s.air.stalled,
    'near the stall: partial separation + horn (' + s.aero.stallBlend.toFixed(2) + ')');
  var clNear = s.aero.cl;
  s.tunnel.aoa = 20;
  run(s, 1.5);
  assert.ok(s.aero.stallBlend > 0.97 && s.air.stalled, 'stalled at 20° (' + s.aero.stallBlend.toFixed(2) + ')');
  assert.ok(s.aero.cl < clNear, 'lift coefficient drops past the stall');
  assert.ok(!hasEvent(s, /Pérdida!/), 'no stall event in the tunnel');
  var f = Sim.createState('cruise');
  f.throttle = 0;
  run(f, 40, function (st) { st.yokePitch = 1; if (st.air.stalled) return false; });
  assert.ok(f.air.stalled, 'flight: full pull stalls');
  run(f, 0.8, function (st) { st.yokePitch = 1; });
  assert.ok(f.aero.stallBlend > 0.9, 'flight: stallBlend high when stalled (' + f.aero.stallBlend.toFixed(2) + ')');
  var curve = Sim.clCurve(0);
  assert.strictEqual(curve.length, 61, 'clCurve −8…22 every 0.5');
  assert.ok(curve[0].aoa === -8 && curve[60].aoa === 22, 'clCurve range');
  var best = curve.reduce(function (m, p) { return p.cl > m.cl ? p : m; });
  assert.strictEqual(best.aoa, Sim.stallAoa(0), 'CLmax at the stall AoA');
  inRange(best.cl, 1.3, 1.42, 'CLmax clean');
  assert.ok(curve[60].cl < best.cl * 0.8, 'post-stall drop');
  inRange(Sim.stallAoa(0), 15.9, 16.1, 'stallAoa clean');
  inRange(Sim.stallAoa(40), 14.9, 15.1, 'stallAoa flaps 40');
  var c40 = Sim.clCurve(40);
  assert.ok(c40[24].cl > curve[24].cl + 0.4, 'flaps 40 shift the curve up');
});

test('tunnel: holds position and attitude, no takeoff/landing events, leaves with any preset', function () {
  var s = tunnelState();
  assert.ok(s.tunnel.on && Sim.PRESETS.tunnel && Sim.PRESETS.tunnel.label === 'Túnel de viento', 'tunnel preset');
  assert.ok(Object.keys(Sim.PRESETS).indexOf('tunnel') < 0, 'tunnel preset is not enumerable');
  var x = s.pos.x, z = s.pos.z, alt = s.air.altitude, hdg = s.air.heading;
  inRange(s.air.ias, 79.9, 80.1, 'tunnel ias');
  inRange(s.air.pitch, 3.99, 4.01, 'pitch = aoa');
  assert.ok(s.engine.running && s.masterBat && s.gyro.aiSpin > 0.99, 'engine running, master on, gyros spun');
  inRange(s.aero.pitchMoment, -0.02, 0.02, 'tunnel preset is trimmed');
  inRange(s.aero.thrustN / s.aero.dragN, 0.9, 1.1, 'tunnel preset: thrust ≈ drag');
  s.yokePitch = 1; s.yokeRoll = 0.7; s.rudder = -0.5; s.throttle = 1;
  run(s, 30);
  assert.ok(s.pos.x === x && s.pos.z === z && s.air.altitude === alt && s.air.heading === hdg, 'position held');
  assert.ok(s.air.bank === 0 && s.air.vs === 0 && s.air.groundSpeed === 0 && !s.air.onGround, 'attitude held');
  inRange(s.air.pitch, 3.99, 4.01, 'pitch still = aoa');
  assert.ok(s.aero.pitchMoment > 0.5, 'pull: nose-up tendency');
  assert.ok(s.surfaces.elevator < -20, 'elevator moves in the tunnel');
  assert.ok(!hasEvent(s, /Despegaste|Tocaste|Aterrizaje/), 'no takeoff/landing events');
  s.tunnel.ias = 110; s.tunnel.aoa = 2;
  run(s, 0.5);
  inRange(s.aero.ias, 109.9, 110.1, 'tunnel ias follows the input');
  inRange(s.air.pitch, 1.99, 2.01, 'pitch follows the tunnel aoa');
  s.tunnel.ias = 0;
  run(s, 0.5);
  assert.ok(s.aero.liftN === 0 && s.aero.cl === 0 && s.aero.thrustN > 0, 'no wind: no lift, the prop still pushes');
  Sim.applyPreset(s, 'cruise');
  assert.ok(!s.tunnel.on, 'applyPreset(cruise) leaves the tunnel');
  var x0 = s.pos.x;
  run(s, 2);
  assert.ok(s.pos.x !== x0, 'flying again');
  // The pure snapshot uses the same formulas as the tunnel.
  var t = tunnelState(90, 7);
  var p = Sim.aero({ ias: 90, aoa: 7, flaps: t.flaps, rpm: t._sim.rpmS, throttle: t.throttle, trim: t.trim,
    altitude: t.air.altitude });
  ['cl', 'cd', 'liftN', 'dragN', 'thrustN', 'tailN', 'pitchMoment', 'propWashMs'].forEach(function (k) {
    assert.ok(Math.abs(p[k] - t.aero[k]) <= 1e-6 * Math.max(1, Math.abs(p[k])), 'Sim.aero == tunnel for ' + k + ' (' + p[k] + ' vs ' + t.aero[k] + ')');
  });
  var z0 = Sim.aero({});
  aeroFinite(z0, 'Sim.aero({})');
  assert.ok(z0.liftN === 0 && z0.thrustN === 0, 'Sim.aero with no input: still air');
});

test('tunnel: no NaN with random tunnel inputs', function () {
  var seed = 11;
  function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  var s = tunnelState();
  for (var i = 0; i < 3000; i++) {
    if (i % 15 === 0) {
      s.tunnel.ias = rand() * 220 - 10; s.tunnel.aoa = rand() * 60 - 25; s.tunnel.beta = rand() * 50 - 25;
      s.yokeRoll = rand() * 2 - 1; s.yokePitch = rand() * 2 - 1; s.rudder = rand() * 2 - 1; s.throttle = rand();
      s.trim = rand() * 2 - 1;
      if (rand() < 0.1) Sim.actions.setFlapSwitch(s, ['UP', 'OFF', 'DOWN'][Math.floor(rand() * 3)]);
      if (rand() < 0.02) s.tunnel.ias = NaN;
    }
    Sim.step(s, 1 / 30);
  }
  aeroFinite(s.aero, 'random tunnel');
  assert.ok(isFinite(s.air.ias) && isFinite(s.air.pitch), 'air data finite');
});

/* ============================================ airfoil.js flow model (v2 §2) */

test('airfoil model: NACA 2412-like section, Kutta lift, flaps, streamlines never enter the section', function () {
  var M = require(path.join(__dirname, '..', 'src', 'airfoil.js')).model;
  var S0 = M.buildSection(0);
  var NX = S0.upDef.length, tmax = 0, xt = 0, cmax = 0;
  for (var k = 0; k < NX; k++) {
    var t = S0.upDef[k] - S0.loDef[k], x = k / (NX - 1);
    if (t > tmax) { tmax = t; xt = x; }
    cmax = Math.max(cmax, S0.camber[k]);
  }
  inRange(tmax, 0.11, 0.13, 'thickness / chord');
  inRange(xt, 0.25, 0.35, 'max thickness position');
  inRange(cmax, 0.015, 0.025, 'camber / chord');
  inRange(S0.tex, 0.999, 1.001, 'TE at x = 1 with flaps up');
  // lift grows linearly with the angle of attack; zero lift a little below 0° (cambered section)
  var cl0 = M.sectionCl(M.solveFlow(S0, 0, 0, null)), cl8 = M.sectionCl(M.solveFlow(S0, 8, 0, null));
  inRange((cl8 - cl0) / 8, 0.105, 0.125, '2D lift slope per degree (≈ 2π/rad)');
  inRange(-cl0 / ((cl8 - cl0) / 8), -3, -1.5, 'zero-lift angle (deg)');
  // flaps: the trailing edge goes down and back up the circulation
  var S40 = M.buildSection(40);
  assert.ok(S40.tey < -0.12 && S40.tex > 0.9, 'flap 40°: TE down (' + S40.tex.toFixed(2) + ', ' + S40.tey.toFixed(2) + ')');
  var clF = M.sectionCl(M.solveFlow(S40, 4, 0, null)), clC = M.sectionCl(M.solveFlow(S0, 4, 0, null));
  inRange(clF - clC, 0.8, 1.6, '2D ΔCL of a 40° flap');
  // forward 70 % of the section does not move with the flap
  inRange(Math.abs(S40.upDef[Math.round(0.3 * (NX - 1) / S40.tex)] - S0.upDef[Math.round(0.3 * (NX - 1))]), 0, 0.01, 'flap leaves the front alone');
  // Kutta: the upper surface is faster than the lower one, the flow leaves the TE smoothly
  var F = M.solveFlow(S0, 6, 0, null), cp = F.surfCp, minUp = 9, minLo = 9;
  for (k = 0; k < cp.length; k++) {
    if (k <= S0.iLE) minUp = Math.min(minUp, cp[k]); else minLo = Math.min(minLo, cp[k]);
  }
  assert.ok(minUp < -1 && minUp < minLo - 0.5, 'suction peak on top (' + minUp.toFixed(2) + ' vs ' + minLo.toFixed(2) + ')');
  // streamlines with a real view: none crosses into the drawn section (flaps 30, stalled and attached)
  function pointIn(S, x, y) {
    if (x <= 0.002 || x >= S.tex - 0.002) return false;
    var f = x / S.tex * (NX - 1), i = Math.floor(f), u = f - i;
    var yu = S.upDef[i] + (S.upDef[Math.min(NX - 1, i + 1)] - S.upDef[i]) * u;
    var yl = S.loDef[i] + (S.loDef[Math.min(NX - 1, i + 1)] - S.loDef[i]) * u;
    return y < yu - 0.004 && y > yl + 0.004;
  }
  [[30, 6, 0], [0, 18, 1], [20, 10, 0.5], [0, -5, 0]].forEach(function (c) {
    var S = M.buildSection(c[0]);
    var Fl = M.solveFlowBody(S, c[1], c[2], 30);
    var inside = 0, total = 0;
    Fl.lines.forEach(function (L) {
      for (var j = 0; j < L.n; j++) { total++; if (pointIn(S, L.bx[j], L.by[j])) inside++; }
    });
    assert.ok(Fl.lines.length >= 20, 'flaps ' + c[0] + ' aoa ' + c[1] + ': streamlines traced (' + Fl.lines.length + ')');
    assert.ok(inside === 0, 'flaps ' + c[0] + ' aoa ' + c[1] + ' stall ' + c[2] + ': ' + inside + ' of ' + total + ' points inside the section');
    var ups = Fl.lines.filter(function (L) { return L.upper; }).length;
    assert.ok(ups > 3 && ups < Fl.lines.length - 3, 'lines on both sides');
  });
});

/* ================================================================== summary */
console.log('\nC150.Sim tests');
console.table(results);
console.log('Performance achieved:');
console.table(perf);
if (failures) {
  console.error(failures + ' test(s) FAILED');
  process.exit(1);
} else {
  console.log('All ' + results.length + ' tests passed.');
}
