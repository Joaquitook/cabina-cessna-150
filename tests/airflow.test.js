// tests/airflow.test.js: the air model of src/airflow.js (no THREE, no DOM).
//   node tests/airflow.test.js
// Checks the aero snapshot fallback and the physics directions of C150.Airflow.Field (contract v2 §3, §5):
// upwash ahead / downwash behind, faster over the wing, flaps → more downwash, aileron down → more lift on that side,
// tip vortices (up outboard, down inboard), slipstream faster + clockwise swirl seen from behind (hits the LEFT side
// of the fin), rudder TE right → air right, stall → separated flow over the upper wing, particles kept out of solids.
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'sim.js'));
require(path.join(__dirname, '..', 'src', 'airflow.js'));
const C150 = globalThis.C150;
const A = C150.Airflow;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FALLA: ' + msg); } }
const DEG = Math.PI / 180;

function tunnelState(o) {
  const s = C150.Sim.createState('cruise');
  s.tunnel = { on: true, ias: o.ias != null ? o.ias : 80, aoa: o.aoa != null ? o.aoa : 4, beta: 0 };
  s.flaps = o.flaps || 0;
  s.yokeRoll = o.roll || 0; s.yokePitch = o.pitch || 0; s.rudder = o.rud || 0; s.controlLock = false;
  s.surfaces = null;   // derived from the yoke by airflow.js
  s.propRpm = o.rpm != null ? o.rpm : 2300;
  s.throttle = o.thr != null ? o.thr : 0.6;
  delete s.aero;
  return s;
}
function aero(o) { return A.aeroFromState(tunnelState(o)); }
function surf(o) {
  const yr = o.roll || 0, yp = o.pitch || 0;
  return { aileronL: yr < 0 ? 20 * yr : 14 * yr, aileronR: yr < 0 ? -14 * yr : -20 * yr, elevator: yp > 0 ? -25 * yp : -15 * yp,
    rudder: 23 * (o.rud || 0), flaps: o.flaps || 0 };
}
function field(o) {
  const f = new A.Field();
  f.configure(aero(o), surf(o), { alphaDeg: o.aoa != null ? o.aoa : 4, time: 1 });
  return f;
}
const v = [0, 0, 0, 0];
function vel(f, x, y, z) { f.velocity(x, y, z, v); return v.slice(); }
function angle(w) { return Math.atan2(w[1], w[2]) / DEG; }   // flow angle in the body x-z plane (+ = up)

/* ---------------- aero snapshot */
{
  const a = aero({ ias: 90, aoa: 4 });
  ok(a.liftN > 0 && a.dragN > 0 && a.weightN > 7000, 'snapshot: lift, drag and weight are positive');
  ok(Math.abs(a.liftLN - a.liftRN) < 1, 'snapshot: wings level → equal half-wing lift');
  const f0 = aero({ ias: 70, aoa: 5, flaps: 0 }), f30 = aero({ ias: 70, aoa: 5, flaps: 30 });
  ok(f30.cl > f0.cl && f30.cd > f0.cd && f30.flapLiftN > 0, 'snapshot: flaps raise cl AND cd');
  const r = aero({ ias: 80, aoa: 4, roll: 1 });
  ok(r.liftLN > r.liftRN && r.rollMoment > 0, 'snapshot: yoke right → left aileron down → more lift left → roll right');
  ok(r.yawMoment < 0, 'snapshot: adverse yaw toward the raised (left) wing when rolling right');
  const t1 = aero({ ias: 60, rpm: 1500, thr: 0.3 }), t2 = aero({ ias: 60, rpm: 2500, thr: 1 });
  ok(t2.thrustN > t1.thrustN && t2.propWashMs > t1.propWashMs, 'snapshot: more RPM → more thrust and faster slipstream');
  ok(t2.yawMoment < 0, 'snapshot: full power at low speed → the nose yaws left (P-factor / slipstream)');
  ok(aero({ ias: 60, aoa: 2 }).stallBlend === 0 && aero({ ias: 60, aoa: 19 }).stallBlend === 1, 'snapshot: stallBlend 0 attached → 1 past the stall');
  ok(aero({ ias: 0, aoa: 4 }).liftN === 0, 'snapshot: no wind → no lift');
  const s = tunnelState({});
  s.aero = { liftN: 1234, liftLN: 600, liftRN: 634, dragN: 10 };
  const snap = A.snapshot(s, {});
  ok(snap.fromSim && snap.liftN === 1234 && snap.weightN > 7000, 'snapshot(): uses state.aero from sim.js when present');
}

/* ---------------- flow field */
{
  const f = field({ ias: 80, aoa: 4 });
  ok(f.active && f.nSeg > 6, 'field: active with horseshoe vortices');
  const U = angle(f.U);
  ok(Math.abs(U - 4) < 0.01, 'field: free stream at the body angle of attack');
  const ahead = angle(vel(f, -1.5, 0.55, -1.4)), behind = angle(vel(f, -1.5, 0.45, 2.4));
  ok(ahead > U + 0.5, 'field: upwash ahead of the wing (' + ahead.toFixed(1) + '° > ' + U.toFixed(1) + '°)');
  ok(behind < U - 0.5, 'field: downwash behind the wing (' + behind.toFixed(1) + '° < ' + U.toFixed(1) + '°)');
  const above = Math.hypot(...vel(f, -2.0, 0.85, 0.0).slice(0, 3)), below = Math.hypot(...vel(f, -2.0, 0.3, 0.0).slice(0, 3));
  ok(above > 1.03 && below < 0.97, 'field: faster over the wing, slower under it (' + above.toFixed(2) + ' / ' + below.toFixed(2) + ')');
  // tip vortices: up outboard, down inboard, mirror images
  const outR = vel(f, 5.5, 0.6, 1.6), inR = vel(f, 4.4, 0.6, 1.6), outL = vel(f, -5.5, 0.6, 1.6);
  ok(outR[1] - f.U[1] > 0.02 && inR[1] - f.U[1] < -0.02, 'field: right tip vortex → upwash outboard, downwash inboard');
  ok(Math.abs(outL[1] - outR[1]) < 1e-9, 'field: left and right tips are mirror images when the lift is equal');
  // flaps → more downwash behind the flap span
  const fl = field({ ias: 80, aoa: 4, flaps: 30 });
  ok(angle(vel(fl, -1.5, 0.45, 2.4)) < behind - 2, 'field: flaps 30° bend the air further down behind the wing');
  // ailerons: yoke right → left aileron down → more downwash behind the left aileron than behind the right one
  const ar = field({ ias: 80, aoa: 4, roll: 1 });
  const dl = angle(vel(ar, -3.6, 0.6, 1.6)), dr = angle(vel(ar, 3.6, 0.6, 1.6));
  ok(dl < dr - 1, 'field: aileron down (left) pushes the air down more than the raised one (' + dl.toFixed(1) + '° < ' + dr.toFixed(1) + '°)');
  ok(Math.abs(ar.gOutL) > Math.abs(ar.gOutR), 'field: the outer panel with the aileron down carries more circulation');
  // rudder right (TE right) → air deflected to the right behind it
  const rr = field({ ias: 80, aoa: 4, rud: 1 });
  ok(vel(rr, 0, 0.9, 4.8)[0] > 0.05, 'field: rudder TE right → air goes right behind the rudder');
  // elevator: yoke back → TE up → air deflected up behind the tail
  const ep = field({ ias: 80, aoa: 4, pitch: 1 }), e0 = field({ ias: 80, aoa: 4 });
  ok(vel(ep, 0.8, 0.1, 4.3)[1] > vel(e0, 0.8, 0.1, 4.3)[1] + 0.05, 'field: elevator up → air deflected up behind the tail');
}

/* ---------------- propeller slipstream */
{
  const lo = field({ ias: 50, aoa: 6, rpm: 1200, thr: 0.2 }), hi = field({ ias: 50, aoa: 6, rpm: 2500, thr: 1 });
  ok(hi.w > lo.w && hi.w > 0.2, 'slipstream: full throttle → stronger slipstream');
  const zb = -0.6, yax = hi.slipAxisY(zb);
  const wHi = vel(hi, 0.62, yax, zb)[2], wLo = vel(lo, 0.62, yax, zb)[2];
  ok(wHi > wLo + 0.1, 'slipstream: faster air behind the propeller at full throttle');
  const top = vel(hi, 0, yax + 0.6, zb), side = vel(hi, 0.6, yax, zb);
  ok(top[0] > 0.05 && side[1] < -0.05, 'slipstream: clockwise seen from behind (top moves right → hits the LEFT side of the fin)');
  const g = field({ ias: 0, aoa: 0, rpm: 1700, thr: 0.5 });
  ok(g.active && g.U0 === 0 && g.w > 0, 'slipstream: on the ground with no wind only the slipstream blows');
}

/* ---------------- stall */
{
  const att = field({ ias: 55, aoa: 6 }), st = field({ ias: 55, aoa: 19 });
  ok(vel(att, -1.5, 0.78, 0.6)[3] === 0, 'stall: attached flow → no separation');
  const s1 = vel(st, -1.5, 0.78, 0.6);
  ok(s1[3] > 0.3, 'stall: separated (red) flow over the upper wing behind ~30 % chord');
  ok(s1[2] < 0.6, 'stall: the separated air is slow');
  ok(vel(st, -1.5, 0.78, -0.4)[3] === 0, 'stall: ahead of the separation point the flow is still attached');
}

/* ---------------- solids and sanity */
{
  const f = field({ ias: 80, aoa: 4, flaps: 20 });
  const p = [-1.5, 0.58, 0.1], prev = [-1.5, 0.75, 0.0];
  ok(f.constrain(p, prev) && p[1] > 0.62, 'constrain: a particle coming from above cannot cross into the wing');
  const p2 = [0.0, 0.0, 0.5], prev2 = [0.0, 0.0, 0.4];
  ok(f.constrain(p2, prev2) && Math.hypot(p2[0], p2[1] - 0.0) > 0.4, 'constrain: pushed out of the fuselage');
  let nan = 0;
  for (let x = -7; x <= 7; x += 0.7) for (let y = -2; y <= 2.5; y += 0.45) for (let z = -6; z <= 8; z += 0.7) {
    f.velocity(x, y, z, v); if (!(isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2]))) nan++;
  }
  ok(nan === 0, 'field: finite velocity everywhere on a grid');
  ok(A.REGIONS.length === 9 && A.REGIONS.every((r) => A.VIEWS[r] && A.FOCUS[r]), 'regions: 9 focus regions, each with a view');
}

console.log(fail ? `\n${fail} FALLARON, ${pass} pasaron` : `\nOK: ${pass} comprobaciones del flujo de aire pasaron.`);
process.exit(fail ? 1 : 0);
