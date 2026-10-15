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
