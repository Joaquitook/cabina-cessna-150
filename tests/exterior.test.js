// tests/exterior.test.js: the held movements ("poses") of src/exterior.js (pure part, no THREE, no DOM).
//   node tests/exterior.test.js
// Checks the pose list of contract v3, the channel rules (a pose changes only its own channels), and that every pose
// moves the airplane the right way with realistic numbers (1977 150M POH: cruise ≈ 88 kt, Vy 68 kt ≈ 650 ft/min,
// glide 60 kt, stall 47 kt with the horn before it, static RPM ≈ 2500, flaps ≈ 4.4°/s, nose wheel 8.5°).
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'exterior.js'));
const E = globalThis.C150.Exterior;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FALLA: ' + msg); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const REQUIRED = ['nivelado', 'alabeo-izq', 'alabeo-der', 'cabeceo-arriba', 'cabeceo-abajo', 'guinada-izq', 'guinada-der',
  'motor-on', 'motor-off', 'potencia-max', 'potencia-ralenti', 'flaps-0', 'flaps-10', 'flaps-20', 'flaps-40', 'viraje-izq',
  'viraje-der', 'ascenso', 'descenso', 'perdida', 'carreteo-izq', 'carreteo-der', 'compensador-arriba', 'compensador-abajo'];

/* ---------------- the list */
const ids = E.POSES.map((p) => p.id);
REQUIRED.forEach((id) => ok(ids.includes(id), 'falta la pose ' + id));
E.POSES.forEach((p) => {
  ok(typeof p.etiqueta === 'string' && p.etiqueta.length > 2 && p.etiqueta.length <= 26, p.id + ': etiqueta corta');
  ok(typeof p.descripcion === 'string' && p.descripcion.length > 20 && /[.]$/.test(p.descripcion), p.id + ': descripción en una oración');
});
ok(E.TIME_STRETCH >= 1.5 && E.TIME_STRETCH <= 1.7, 'las animaciones duran ≈ 1,6 veces más');

/* ---------------- helpers */
const PARKED = { air: { onGround: true }, engine: { running: false }, propRpm: 0, throttle: 0, flaps: 0, trim: 0 };
const CRUISE = { air: { onGround: false, ias: 88, vs: 0 }, engine: { running: true }, propRpm: 2380, throttle: 0.8, flaps: 0, trim: 0 };
function run(chain, start, t) {
  let S = E.specFromState(start);
  chain.forEach((id) => { S = E.poseSpec(S, id); });
  const st = start.air || {};
  const F = { bank: 0, pitch: 0, yaw: 0, ias: st.onGround === false ? 88 : 0, vs: 0, flaps: start.flaps || 0, trim: 0,
    air: st.onGround === false, engineOn: !!(start.engine && start.engine.running), rpm: start.propRpm || 0 };
  const P = {};
  E.poseFrame(S, t, F, P);
  return { S, P };
}
const FIELDS = ['ail', 'elevCmd', 'rudCmd', 'flaps', 'pitch', 'bank', 'yaw', 'rpm', 'ias', 'vs', 'thr', 'aoa', 'trim', 'rawTab', 'elevOffset', 'nose', 'rollSpeed'];

/* ---------------- every pose: finite values, a caption, from the ground and from cruise */
REQUIRED.forEach((id) => {
  [PARKED, CRUISE].forEach((start, k) => {
    [0, 0.7, 2, 5, 9, 20].forEach((t) => {
      const { P } = run([id], start, t);
      const bad = FIELDS.filter((f) => typeof P[f] !== 'number' || !isFinite(P[f]));
      ok(bad.length === 0, id + (k ? ' (crucero)' : ' (estacionado)') + ' t=' + t + ': valores no finitos ' + bad.join(','));
      ok(typeof P.caption === 'string' && P.caption.length > 10, id + ' t=' + t + ': leyenda');
      ok(Math.abs(P.ail) <= 1.05 && Math.abs(P.elevCmd) <= 1.05 && Math.abs(P.rudCmd) <= 1.05, id + ': mandos dentro de ±1');
      ok(P.ias >= 0 && P.ias < 141, id + ': velocidad entre 0 y Vne');
    });
  });
});

/* ---------------- channel rules */
{
  const s1 = E.poseSpec(E.specFromState(PARKED), 'alabeo-der');
  ok(s1.air && s1.engine && s1.thr >= 0.8, 'despegar a una pose en vuelo arranca el motor en crucero');
  const s2 = E.poseSpec(s1, 'flaps-20');
  ok(s2.att === 'roll' && s2.side === 1 && s2.flaps === 20, 'flaps 20 mantiene el alabeo que había');
  const s3 = E.poseSpec(s2, 'motor-off');
  ok(!s3.engine && s3.air && s3.flaps === 20, 'motor apagado mantiene la actitud y los flaps');
  const s4 = E.poseSpec(s3, 'carreteo-izq');
  ok(!s4.air && s4.engine && s4.att === 'taxi' && s4.side === -1, 'carreteo: en tierra con motor');
  ok(E.poseSpec(s4, 'no-existe') === null, 'pose desconocida → null');
}

/* ---------------- each movement goes the right way */
{
  let r = run(['alabeo-der'], CRUISE, 1.0);
  ok(r.P.ail > 0.3, 'alabeo derecho: volante a la derecha mientras se inclina (' + r.P.ail.toFixed(2) + ')');
  r = run(['alabeo-der'], CRUISE, 8);
  ok(near(r.P.bank, 25, 2.5) && Math.abs(r.P.ail) < 0.1, 'alabeo derecho: queda inclinado ~25° con el volante al centro');
  r = run(['alabeo-izq'], CRUISE, 8);
  ok(near(r.P.bank, -25, 2.5), 'alabeo izquierdo: −25°');
  r = run(['viraje-der'], CRUISE, 1.0);
  ok(r.P.ail > 0.3 && r.P.rudCmd > 0.1, 'viraje derecho: volante y pedal derechos juntos');
  r = run(['viraje-der'], CRUISE, 8);
  ok(near(r.P.bank, 30, 2.5) && r.P.elevCmd > 0.1, 'viraje derecho: 30° con presión atrás');
  r = run(['cabeceo-arriba'], CRUISE, 8);
  ok(r.P.pitch > 7 && r.P.elevCmd > 0.2 && r.P.ias < 80 && r.P.vs > 300, 'nariz arriba: tira, sube, frena');
  r = run(['cabeceo-abajo'], CRUISE, 8);
  ok(r.P.pitch < -4 && r.P.elevCmd < 0 && r.P.ias > 95 && r.P.vs < -500, 'nariz abajo: empuja, baja, acelera');
  r = run(['guinada-der'], CRUISE, 5);
  ok(r.P.yaw > 8 && r.P.rudCmd > 0.5, 'guiñada derecha: pedal derecho, nariz a la derecha');
  r = run(['guinada-izq'], CRUISE, 5);
  ok(r.P.yaw < -8 && r.P.rudCmd < -0.5, 'guiñada izquierda');
  r = run(['nivelado'], CRUISE, 10);
  ok(near(r.P.ias, 88, 4) && near(r.P.vs, 0, 30) && near(r.P.bank, 0, 1.2), 'nivelado: ≈ 88 kt sin subir ni bajar');
  r = run(['ascenso'], CRUISE, 25);
  ok(near(r.P.ias, 68, 3) && near(r.P.vs, 650, 60) && r.P.rpm > 2400 && r.P.carbHeat === 0, 'ascenso: Vy 68 kt, ≈ 650 ft/min, potencia máxima');
  ok(r.P.rudCmd > 0.2, 'ascenso: pedal derecho por la tendencia a la izquierda');
  r = run(['descenso'], CRUISE, 25);
  ok(near(r.P.ias, 76, 3) && near(r.P.vs, -500, 60) && r.P.carbHeat === 1 && near(r.P.rpm, 1700, 120), 'descenso: 75 kt, −500 ft/min, 1700 RPM y calefacción');
  r = run(['perdida'], CRUISE, 4.5);
  ok(r.P.stallWarn && r.P.ias > 47, 'pérdida: la bocina suena antes de la pérdida');
  r = run(['perdida'], CRUISE, 9);
  ok(r.P.aoa > 14 && r.P.ias < 50 && r.P.vs < -300 && r.P.elevCmd > 0.8 && r.P.thr === 0, 'pérdida: ángulo de ataque alto, poca velocidad, baja');
  r = run(['motor-off'], CRUISE, 8);
  ok(r.P.engineOn === false && r.P.rpm > 200 && r.P.rpm < 950 && near(r.P.ias, 62, 4) && r.P.vs < -500, 'motor apagado en vuelo: hélice en molinete, planeo ≈ 60 kt');
  r = run(['motor-off'], PARKED, 3);
  ok(r.P.rpm === 0, 'motor apagado en tierra: hélice quieta');
  r = run(['motor-on'], PARKED, 0.6);
  ok(near(r.P.rpm, 170, 1) && r.P.engineOn === false, 'arranque: el motor de arranque gira la hélice');
  r = run(['motor-on'], PARKED, 3);
  ok(r.P.engineOn && r.P.rpm > 700 && r.P.rpm < 1100, 'arranque: después queda en ralentí');
  r = run(['potencia-max'], PARKED, 3);
  ok(near(r.P.rpm, 2500, 60) && r.P.brakeL === 1 && r.P.brakeR === 1, 'potencia máxima en tierra: ≈ 2500 RPM con frenos');
  r = run(['potencia-ralenti'], PARKED, 3);
  ok(r.P.rpm < 800 && r.P.rpm > 600, 'ralentí en tierra ≈ 700 RPM');
  r = run(['flaps-40'], PARKED, 4.5);
  ok(near(r.P.flaps, 19.8, 0.5), 'flaps: bajan a ≈ 4,4°/s');
  r = run(['flaps-40'], PARKED, 10);
  ok(r.P.flaps === 40, 'flaps 40°');
  r = run(['flaps-40'], CRUISE, 4);
  ok(r.P.pitch > run(['flaps-0'], CRUISE, 4).P.pitch, 'flaps bajando: la nariz tiende a subir (globo)');
  r = run(['flaps-40'], CRUISE, 30);
  ok(r.P.ias < 85, 'con flaps 40 vuela por debajo de Vfe 85 kt');
  r = run(['carreteo-der'], PARKED, 4);
  ok(!r.P.ground === false && r.P.nose > 5 && r.P.rollSpeed > 2 && r.P.rudCmd > 0.5 && r.P.engineOn, 'carreteo derecho: pedal y rueda de nariz a la derecha');
  r = run(['compensador-arriba'], CRUISE, 3);
  ok(near(r.P.trim, 0.6, 0.01) && r.P.rawTab > 10 && r.P.elevOffset < -5, 'compensador nariz arriba: la aleta baja y el timón de profundidad sube');
  r = run(['compensador-abajo'], CRUISE, 3);
  ok(r.P.rawTab < -4 && r.P.elevOffset > 5, 'compensador nariz abajo: la aleta sube y el timón de profundidad baja');
}

/* ---------------- engine / airspeed helpers */
{
  ok(near(E.rpmFor(0, 0, true), 650, 1) && near(E.rpmFor(1, 0, true), 2500, 1), 'RPM en tierra: ralentí 650, estática 2500');
  [[0.8, 88], [1, 68], [0.45, 76]].forEach(([thr, ias]) => ok(near(E.thrFor(E.rpmFor(thr, ias, false), ias, false), thr, 1e-6), 'thrFor invierte rpmFor'));
  const L = E.perfLevel(0.8, 0);
  ok(near(L.ias, 88, 2) && L.vs === 0, 'crucero ≈ 88 kt nivelado');
  ok(near(E.aoaFor(46.6, 0), 16, 0.2), 'ángulo de ataque ≈ 16° a 46,6 kt (pérdida limpia, como sim.js)');
  ok(near(E.aoaFor(95, 0), 3.85, 0.1), 'crucero 95 kt: ≈ 3,9° (sustentación = peso con el modelo de sim.js)');
  ok(E.aoaFor(70, 0, 1 / Math.cos(30 * Math.PI / 180)) > E.aoaFor(70, 0) + 0.8, 'en viraje de 30° hace falta más ángulo de ataque (1,15 g)');
  ok(E.aoaFor(60, 40) < E.aoaFor(60, 0) - 4, 'con flaps 40 el mismo peso se sostiene con menos ángulo de ataque');
}

console.log((fail ? 'FALLAS: ' + fail + ' · ' : '') + 'OK: ' + pass + ' comprobaciones de las poses del exterior pasaron.');
if (fail) process.exitCode = 1;
