/*
 * validate-situations.js — Valida src/data/situations.js ("Situaciones prácticas", contrato v3).
 * Uso: node tests/validate-situations.js   (sale con código 1 si algo falla)
 *
 *  1. Esquema: ≥ 8 situaciones, ids únicos, textos, preset válido, setup/check funciones, señales, pistas, errores,
 *     mandos con ids de fichas reales.
 *  2. Robustez: cada setup / durante / check corre sin tirar error sobre estados de TODOS los presets del simulador
 *     (y del túnel), con y sin Sim.actions.fail, y devuelve { progress 0..1, ok, fail, mensaje }; check no escribe
 *     el estado.
 *  3. Se puede jugar: un "piloto" simple (sólo entradas que un alumno toca, a velocidad de mano/tecla) resuelve cada
 *     situación con el simulador real, y un piloto que no hace nada NO la resuelve.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '..', 'src');
function cargar(archivos) {
  var sb = { console: console, Math: Math, JSON: JSON, Date: Date };
  sb.globalThis = sb;
  vm.createContext(sb);
  archivos.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sb, { filename: f }); });
  return sb.C150;
}
var C150 = cargar(['sim.js', 'data/controls-a.js', 'data/controls-b.js', 'data/situations.js']);
var Sim = C150.Sim, A = Sim.actions, DATA = C150.DATA;
var SIT = DATA.situations;

var fallas = 0, pruebas = 0;
function ok(c, msg) { pruebas++; if (!c) { fallas++; console.error('  FALLA: ' + msg); } }
function texto(v) { return typeof v === 'string' && v.trim().length > 0; }
function seccion(t) { console.log('\n== ' + t); }
var CTRL = {};
(DATA.controls || []).forEach(function (c) { CTRL[c.id] = c; });
var PRESETS = Object.keys(Sim.PRESETS).concat(Sim.PRESETS.tunnel ? ['tunnel'] : []);

/* ───────────────────────────── 1. esquema ───────────────────────────── */
seccion('Esquema');
ok(Array.isArray(SIT) && SIT.length >= 8, 'situations: al menos 8 (hay ' + (SIT && SIT.length) + ')');
ok(Array.isArray(DATA.situationFailures) && DATA.situationFailures.length >= 8, 'situationFailures: lista de fallas que el runner limpia');
var ids = {};
(SIT || []).forEach(function (x, i) {
  var n = 'situations[' + i + '] ' + (x && x.id);
  ok(x && texto(x.id) && /^[a-z0-9-]+$/.test(x.id) && !ids[x.id], n + ': id único en minúsculas');
  ids[x.id] = true;
  ok(texto(x.titulo) && x.titulo.length <= 60, n + ': titulo (≤ 60)');
  ok(['emergencia', 'anormal', 'en tierra'].indexOf(x.tipo) >= 0, n + ': tipo válido');
  ok(texto(x.contexto) && x.contexto.length <= 260, n + ': contexto corto');
  ok(PRESETS.indexOf(x.preset) >= 0, n + ': preset válido (' + x.preset + ')');
  ok(typeof x.setup === 'function', n + ': setup()');
  ok(typeof x.check === 'function', n + ': check()');
  ok(x.durante === undefined || typeof x.durante === 'function', n + ': durante() opcional');
  var sen = x['señales'];
  ok(Array.isArray(sen) && sen.length >= 2 && sen.length <= 5 && sen.every(texto), n + ': 2–5 señales');
  ok(texto(x.objetivo) && x.objetivo.length <= 260, n + ': objetivo');
  ok(Array.isArray(x.pistas) && x.pistas.length >= 2 && x.pistas.length <= 5 && x.pistas.every(texto), n + ': 2–5 pistas');
  ok(texto(x.debrief) && x.debrief.length >= 80 && x.debrief.length <= 900, n + ': debrief (80–900)');
  ok(Array.isArray(x.errores) && x.errores.length >= 2 && x.errores.every(texto), n + ': errores comunes');
  ok(Array.isArray(x.mandos) && x.mandos.length >= 1 && x.mandos.every(function (id) { return !!CTRL[id]; }),
    n + ': mandos con ids de fichas reales (' + (x.mandos || []).filter(function (id) { return !CTRL[id]; }).join(',') + ')');
  // voseo y sin "tú"
  var todo = [x.titulo, x.contexto, x.objetivo, x.debrief].concat(sen || [], x.pistas || [], x.errores || []).join(' ');
  ok(!/\b(tú|tienes|puedes|debes|haz|mira)\b/i.test(todo), n + ': voseo rioplatense (sin tuteo)');
});

/* ───────────────────────────── 2. robustez ───────────────────────────── */
seccion('Robustez (todos los presets)');
function resOk(r) {
  return r && typeof r === 'object' && typeof r.progress === 'number' && r.progress >= 0 && r.progress <= 1 &&
    typeof r.ok === 'boolean' && typeof r.fail === 'boolean' && typeof r.mensaje === 'string' && !(r.ok && r.fail);
}
function snapshot(s) { return JSON.stringify(s, function (k, v) { return k === '_sim' || k === 'events' ? undefined : v; }); }
(SIT || []).forEach(function (x) {
  PRESETS.forEach(function (p) {
    [true, false].forEach(function (conFail) {
      var tag = x.id + ' sobre ' + p + (conFail ? '' : ' (sin Sim.actions.fail)');
      var s = Sim.createState(p), ctx = { t: 0, dt: 0, hold: 0, data: {} };
      var guard = A.fail;
      if (!conFail) A.fail = undefined;
      try {
        x.setup(s);
        var tiro = null;
        for (var i = 0; i < 90 && !tiro; i++) {
          ctx.t += 1 / 30; ctx.dt = 1 / 30;
          try {
            if (x.durante) x.durante(s, ctx);
            var antes = snapshot(s);
            var r = x.check(s, ctx);
            if (!resOk(r)) tiro = 'resultado con forma incorrecta: ' + JSON.stringify(r);
            else if (snapshot(s) !== antes) tiro = 'check() escribió el estado';
          } catch (e) { tiro = e.message; }
          Sim.step(s, 1 / 30);
        }
        ok(!tiro, tag + ': ' + tiro);
      } catch (e) { ok(false, tag + ': setup tiró ' + e.message); }
      finally { A.fail = guard; }
    });
  });
});

/* ───────────────────────────── 3. se puede jugar ───────────────────────────── */
seccion('Se puede jugar (simulador real)');
var DT = 1 / 30;
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function ease(s, key, target, rate) {
  var cur = s[key], st = rate * DT;
  s[key] = Math.abs(target - cur) <= st ? target : cur + (target > cur ? st : -st);
}
/** Mantener una velocidad con la nariz, compensando de a poco (como en playthrough.js). */
function pitchFor(s, ias, gain) {
  var cmd = clamp((s.air.ias - ias) * (gain || 0.05), -0.6, 0.6);
  ease(s, 'yokePitch', cmd, 1.5);
  if (Math.abs(s.yokePitch) > 0.05) s.trim = clamp(s.trim + Math.sign(s.yokePitch) * 0.08 * DT, -1, 1);
}
function levelWings(s) { ease(s, 'yokeRoll', clamp(-s.air.bank * 0.04, -0.5, 0.5), 2); }
/** Mantener la altura con la nariz (vs → 0) sin pasar de una velocidad mínima. */
function holdAlt(s, alt0) {
  var target = clamp((alt0 - s.air.altitude) * 2, -500, 500);
  var cmd = clamp((target - s.air.vs) * 0.0012, -0.5, 0.5);
  ease(s, 'yokePitch', cmd, 1.2);
  if (Math.abs(s.yokePitch) > 0.08) s.trim = clamp(s.trim + Math.sign(s.yokePitch) * 0.05 * DT, -1, 1);
}

var PILOTOS = {
  'hielo-carburador': function (s, t, d) {
    levelWings(s); holdAlt(s, 3000);
    if (s.engine.rpm < 2320) d.vio = true;
    if (d.vio && !d.frio) ease(s, 'carbHeat', 1, 2);
    if (d.vio && s.engine.carbIce !== undefined && s.engine.carbIce < 0.02 && s.carbHeat >= 1) d.t = (d.t || 0) + DT;
    if ((d.t || 0) > 8) { d.frio = true; ease(s, 'carbHeat', 0, 2); }
  },
  'bocina-aproximacion': function (s, t, d) {
    if (t > 1.5) { ease(s, 'throttle', 1, 1.5); ease(s, 'carbHeat', 0, 2); pitchFor(s, 60, 0.06); levelWings(s); }
  },
  'falla-motor-crucero': function (s, t, d) {
    levelWings(s); pitchFor(s, 60, 0.05);
    if (t > 4) ease(s, 'carbHeat', 1, 2);
    if (s.engine.running && t > 40) d.x = 1;
    if (t > 30) { ease(s, 'mixture', 0, 1); s.fuelValve = false; if (t > 32 && s.ignition !== 'OFF') A.setIgnition(s, 'OFF'); }
  },
  'falla-alternador': function (s, t, d) {
    levelWings(s); holdAlt(s, 3000);
    if (t > 3) A.setMaster(s, 'alt', false);
    if (t > 5) s.lights.landing = false;
    if (t > 6) s.lights.taxi = false;
    if (t > 7) s.pitotHeat = false;
  },
  'puerta-abierta': function (s, t, d) {
    levelWings(s);
    if (t > 2) { ease(s, 'throttle', 0.45, 0.3); var tgt = 65; var cmd = clamp((s.air.ias - tgt) * 0.04 + (3000 - s.air.altitude) * 0.0006, -0.5, 0.5); ease(s, 'yokePitch', cmd, 1.2); }
    if (s.air.ias < 70) d.lento = (d.lento || 0) + DT;
    if ((d.lento || 0) > 5) s.doorRightOpen = false;
  },
  'presion-aceite': function (s, t, d) {
    levelWings(s);
    if (t > 8) { ease(s, 'throttle', 0.5, 0.3); pitchFor(s, 70, 0.04); }
  },
  'falla-vacio': function (s, t, d) { levelWings(s); holdAlt(s, 3000); },
  'magneto-prueba': function (s, t, d) {
    if (!d.ph) d.ph = 1;
    if (d.ph === 1) { ease(s, 'throttle', clamp(s.throttle + (1700 - s.engine.rpm) * 0.0003, 0, 1), 0.3); if (Math.abs(s.engine.rpm - 1700) < 40) { d.k = (d.k || 0) + DT; if (d.k > 2) { d.ph = 2; d.t0 = t; A.setIgnition(s, 'R'); } } }
    else if (d.ph === 2 && t - d.t0 > 4) { A.setIgnition(s, 'BOTH'); d.ph = 3; d.t0 = t; }
    else if (d.ph === 3 && t - d.t0 > 3) { A.setIgnition(s, 'L'); d.ph = 4; d.t0 = t; }
    else if (d.ph === 4 && t - d.t0 > 4) { A.setIgnition(s, 'BOTH'); d.ph = 5; d.t0 = t; }
    else if (d.ph === 5 && t - d.t0 > 2) ease(s, 'throttle', 0, 0.4);
  },
  'motor-y-al-aire': function (s, t, d) {
    if (t > 1) {
      ease(s, 'throttle', 1, 1.5); ease(s, 'carbHeat', 0, 2); levelWings(s); pitchFor(s, 56, 0.06);
      if (s.flaps > 21) A.setFlapSwitch(s, 'UP'); else if (s.flapSwitch === 'UP') A.setFlapSwitch(s, 'OFF');
      ease(s, 'rudder', 0.15, 1);
    }
  },
  'traba-comandos': function (s, t, d) {
    if (t > 2) s.controlLock = false;
    var seq = [[-1, 0], [1, 0], [0, 1], [0, -1], [0, 0]];
    if (t > 3) { var k = Math.min(seq.length - 1, Math.floor((t - 3) / 1.5)); ease(s, 'yokeRoll', seq[k][0], 2.5); ease(s, 'yokePitch', seq[k][1], 2.5); }
  }
};
function jugar(x, piloto, maxT) {
  var s = Sim.createState(x.preset), ctx = { t: 0, dt: 0, hold: 0, data: {} }, d = {};
  x.setup(s);
  var r = null;
  for (var t = 0; t < maxT; t += DT) {
    if (piloto) piloto(s, t, d);
    Sim.step(s, DT);
    ctx.t += DT; ctx.dt = DT;
    if (x.durante) x.durante(s, ctx);
    r = x.check(s, ctx);
    if (r.ok || r.fail) return { r: r, t: t };
    s.events.length = 0;
  }
  return { r: r, t: maxT };
}
(SIT || []).forEach(function (x) {
  var p = PILOTOS[x.id];
  ok(!!p, x.id + ': hay un piloto de prueba');
  if (!p) return;
  var out = jugar(x, p, 240);
  ok(out.r && out.r.ok, x.id + ': el piloto la resuelve (' + (out.r && (out.r.ok ? 'ok' : out.r.fail ? 'falló: ' : 'sin terminar: ') + (out.r && out.r.mensaje)) + ', t=' + out.t.toFixed(1) + ' s)');
  console.log('  ' + (out.r && out.r.ok ? 'RESUELTA ' : 'NO       ') + x.id + '  en ' + out.t.toFixed(0) + ' s');
  var nada = jugar(x, null, 90);
  ok(!(nada.r && nada.r.ok), x.id + ': sin tocar nada NO se resuelve');
});

console.log('\n' + (pruebas - fallas) + '/' + pruebas + ' verificaciones OK');
if (fallas) { console.error('validate-situations: ' + fallas + ' FALLAS'); process.exit(1); }
console.log('validate-situations: TODO BIEN');
