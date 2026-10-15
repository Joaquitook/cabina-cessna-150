/*
 * validate-lab.js — Valida el Laboratorio del aire: src/data/lab.js (experimentos y narración) y la parte pura
 * de src/lab.js (snap, curva, narrador). Uso: node tests/validate-lab.js   (sale con código 1 si algo falla)
 *
 *  1. Carga sim.js (si existe), data/lab.js y lab.js en un contexto aislado (sin DOM).
 *  2. Experimentos: esquema (ids únicos, 4–7 pasos, textos, vistas, regiones, capas), claves de mandos válidas
 *     (contrato §3a + tunnel + flaps) con rangos, 'luego' programados, cadena causa → efecto, voseo y coma decimal.
 *  3. Narración: esquema de cada regla; todas corren sin error y devuelven cadenas limpias contra fotos de cada
 *     preset del Sim (y del túnel) con muchas variaciones de mandos, ángulos y velocidades.
 *  4. Escenarios con el Sim real (túnel y vuelo): las reglas clave se disparan (flaps, ángulo, bocina, pérdida,
 *     recuperación, potencia, velocidad, alerones, pedal, inclinación, alas niveladas).
 *  5. Curva de sustentación (Lab.clCurve / stallAoa), botones "Ver el aire" de Explorar y orden de scripts.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');

var CONTROL_IDS = [
  'yoke', 'rudder-pedals', 'toe-brakes', 'parking-brake', 'control-lock', 'trim-wheel', 'flap-switch',
  'flap-indicator', 'throttle', 'mixture', 'carb-heat', 'primer', 'ignition', 'fuel-shutoff', 'fuel-gauges',
  'master', 'light-switches', 'dimmers', 'circuit-breakers', 'ammeter',
  'asi', 'attitude', 'altimeter', 'turn-coordinator', 'heading-indicator', 'vsi', 'compass', 'clock', 'oat',
  'tachometer', 'oil-gauges', 'suction', 'stall-warning', 'navcom', 'transponder', 'vor-indicator',
  'audio-panel', 'microphone', 'cabin-heat', 'cabin-air', 'air-vents', 'seats', 'seatbelts', 'doors', 'placards'
];
var VIEWS = ['lado', 'frente', 'arriba', 'tres-cuartos', 'persecucion'];
var REGIONS = ['flaps', 'ailerons', 'elevator', 'rudder', 'prop', 'wingtips', 'stall', 'tail', 'wing'];
var CAPAS = ['streamlines', 'propwash', 'vortices', 'pressure', 'forces', 'moments', 'trails', 'slowmo'];
var SET_RANGES = {
  throttle: [0, 1], mixture: [0, 1], carbHeat: [0, 1],
  yokeRoll: [-1, 1], yokePitch: [-1, 1], rudder: [-1, 1], trim: [-1, 1], flaps: [0, 40]
};
var TUNNEL_RANGES = { ias: [0, 145], aoa: [-6, 22], beta: [-30, 30] };
var NEED_AIR_BUTTON = ['yoke', 'rudder-pedals', 'throttle', 'flap-switch', 'trim-wheel', 'carb-heat', 'stall-warning'];
// tuteo: formas que sólo existen con "tú", e imperativos sin tilde al empezar una frase ("Mira", "Empuja"…)
var TUTEO = /\b(tienes|puedes|quieres|debes|sabes|haces|haz|pulsa|presiona|eres)\b|(^|\s)tú[\s,.]|(^|[.:!¡¿]\s+)(Mira|Empuja|Tira|Gira|Pisa|Mueve|Fíjate|Toca)\b/;

var fallas = 0, pruebas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallas++; console.error('  FALLA: ' + msg); } }
function seccion(t) { console.log('\n== ' + t); }
function texto(v) { return typeof v === 'string' && v.trim().length > 0; }
function isNum(v) { return typeof v === 'number' && isFinite(v); }

/* ------------------------------------------------------------------ carga */
var ctx = { console: console, Math: Math, JSON: JSON };
vm.createContext(ctx);
function cargar(rel, opcional) {
  var f = path.join(SRC, rel);
  if (!fs.existsSync(f)) { if (!opcional) ok(false, 'falta src/' + rel); return false; }
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  return true;
}
var hasSim = cargar('sim.js', true);
cargar('data/lab.js');
cargar('lab.js');
var C = ctx.C150 || {};
var DATA = C.DATA || {};
var Lab = C.Lab;
var Sim = C.Sim;
var X = DATA.labExperiments, R = DATA.labNarration;

seccion('Carga');
ok(Array.isArray(X), 'C150.DATA.labExperiments es un array');
ok(Array.isArray(R), 'C150.DATA.labNarration es un array');
ok(Lab && typeof Lab.snap === 'function' && typeof Lab.createNarrator === 'function', 'C150.Lab (parte pura) cargado sin DOM');
if (!Array.isArray(X) || !Array.isArray(R) || !Lab) { console.error('\nNo se puede seguir.'); process.exit(1); }
var tunnelOk = !!(hasSim && Sim && Sim.PRESETS && Sim.PRESETS.tunnel);
console.log('  sim.js: ' + (hasSim ? 'sí' : 'no') + ' · túnel en el Sim: ' + (tunnelOk ? 'sí' : 'no (se usa el túnel estimado)'));

/* ------------------------------------------------------------------ textos */
function revisaTexto(t, donde) {
  ok(texto(t), donde + ': texto vacío');
  if (!texto(t)) return;
  ok(!TUTEO.test(t), donde + ': usa tuteo (tiene que ser voseo): "' + t + '"');
  ok(!/\d\.\d/.test(t), donde + ': decimal con punto (en Uruguay va coma): "' + t + '"');
  ok(!/undefined|NaN|Infinity|\[object/.test(t), donde + ': texto roto: "' + t + '"');
}

function revisaSet(set, donde, modo) {
  ok(set && typeof set === 'object' && !Array.isArray(set), donde + ': set es un objeto');
  if (!set || typeof set !== 'object') return;
  Object.keys(set).forEach(function (k) {
    var v = set[k];
    if (k === 'tunnel') {
      ok(v && typeof v === 'object', donde + ': tunnel es un objeto');
      if (!v || typeof v !== 'object') return;
      Object.keys(v).forEach(function (tk) {
        ok(TUNNEL_RANGES[tk], donde + ': clave de túnel desconocida "' + tk + '"');
        if (TUNNEL_RANGES[tk]) ok(isNum(v[tk]) && v[tk] >= TUNNEL_RANGES[tk][0] && v[tk] <= TUNNEL_RANGES[tk][1], donde + ': tunnel.' + tk + ' fuera de rango (' + v[tk] + ')');
      });
      return;
    }
    ok(SET_RANGES[k], donde + ': clave de mando desconocida "' + k + '" (contrato §3a + tunnel + flaps)');
    if (SET_RANGES[k]) ok(isNum(v) && v >= SET_RANGES[k][0] && v <= SET_RANGES[k][1], donde + ': ' + k + ' fuera de rango (' + v + ')');
  });
}

/* ------------------------------------------------------------------ experimentos */
seccion('Experimentos (' + X.length + ')');
ok(X.length >= 6, 'al menos 6 experimentos');
var ids = {};
var obligatorios = ['flaps', 'alerones', 'acelerador', 'perdida', 'timon', 'profundidad'];
X.forEach(function (x, i) {
  var w = 'experimento ' + (x && x.id || i);
  ok(x && texto(x.id) && /^[a-z0-9-]+$/.test(x.id), w + ': id válido');
  ok(!ids[x.id], w + ': id repetido'); ids[x.id] = true;
  revisaTexto(x.titulo, w + '.titulo');
  revisaTexto(x.resumen, w + '.resumen');
  ok(x.modo === 'tunel' || x.modo === 'vuelo', w + ': modo tunel|vuelo');
  ok(REGIONS.indexOf(x.foco) >= 0, w + ': foco es una región del flujo');
  ok(Array.isArray(x.controles) && x.controles.length > 0, w + ': controles (para "Ver el aire")');
  (x.controles || []).forEach(function (c) { ok(CONTROL_IDS.indexOf(c) >= 0, w + ': control desconocido "' + c + '"'); });
  ok(Array.isArray(x.pasos) && x.pasos.length >= 4 && x.pasos.length <= 7, w + ': de 4 a 7 pasos (tiene ' + (x.pasos || []).length + ')');
  var modo = x.modo;
  (x.pasos || []).forEach(function (p, k) {
    var wp = w + ' paso ' + (k + 1);
    revisaTexto(p.titulo, wp + '.titulo');
    revisaTexto(p.texto, wp + '.texto');
    revisaTexto(p.mira, wp + '.mira');
    ok(p.texto.length <= 360, wp + ': texto corto (≤ 360 caracteres)');
    if (p.modo !== undefined) { ok(p.modo === 'tunel' || p.modo === 'vuelo', wp + ': modo tunel|vuelo'); modo = p.modo; }
    ok(VIEWS.indexOf(p.vista) >= 0, wp + ': vista válida (' + p.vista + ')');
    ok(p.foco === undefined || p.foco === null || REGIONS.indexOf(p.foco) >= 0, wp + ': foco válido (' + p.foco + ')');
    if (p.acercar !== undefined) ok(typeof p.acercar === 'boolean' && !!p.foco, wp + ': acercar es booleano y necesita foco');
    if (p.reiniciar !== undefined) ok(typeof p.reiniciar === 'boolean', wp + ': reiniciar es booleano');
    revisaSet(p.set, wp + '.set', modo);
    if (modo === 'vuelo' && p.set && p.set.tunnel) ok(false, wp + ': set.tunnel en modo vuelo no hace nada');
    if (p.capas !== undefined) {
      ok(p.capas && typeof p.capas === 'object', wp + ': capas es un objeto');
      Object.keys(p.capas || {}).forEach(function (c) {
        ok(CAPAS.indexOf(c) >= 0, wp + ': capa desconocida "' + c + '"');
        ok(typeof p.capas[c] === 'boolean', wp + ': capa ' + c + ' es booleana');
      });
    }
    if (p.luego !== undefined) {
      ok(Array.isArray(p.luego), wp + ': luego es un array');
      (p.luego || []).forEach(function (l, j) {
        ok(l && isNum(l.tras) && l.tras > 0 && l.tras < 30, wp + ': luego[' + j + '].tras entre 0 y 30 s');
        revisaSet(l && l.set, wp + '.luego[' + j + '].set', modo);
      });
    }
    ok(Array.isArray(p.cadena) && p.cadena.length >= 2 && p.cadena.length <= 5, wp + ': cadena de 2 a 5 eslabones');
    (p.cadena || []).forEach(function (t, j) { revisaTexto(t, wp + '.cadena[' + j + ']'); ok(t.length <= 64, wp + '.cadena[' + j + '] corta (≤ 64)'); });
  });
  if (x.pasos && x.pasos[0]) ok(!x.pasos[0].modo || x.pasos[0].modo === x.modo, w + ': el primer paso usa el modo del experimento');
});
obligatorios.forEach(function (id) { ok(ids[id], 'experimento obligatorio "' + id + '" (contrato v2 §4)'); });

seccion('Botones "Ver el aire"');
NEED_AIR_BUTTON.forEach(function (c) {
  var r = Lab.experimentsFor(c);
  ok(Array.isArray(r) && r.length >= 1, 'la ficha "' + c + '" tiene al menos un experimento');
});
ok(Lab.experimentsFor('flap-switch').some(function (e) { return e.id === 'flaps'; }), 'flap-switch → experimento flaps');
ok(Lab.experimentsFor('stall-warning').some(function (e) { return e.id === 'perdida'; }), 'stall-warning → experimento pérdida');

/* ------------------------------------------------------------------ narración: esquema */
seccion('Narración: reglas (' + R.length + ')');
ok(R.length >= 25, 'al menos 25 reglas');
var rids = {};
var temas = {};
R.forEach(function (r, i) {
  var w = 'regla ' + (r && r.id || i);
  ok(r && texto(r.id), w + ': id');
  ok(!rids[r.id], w + ': id repetido'); rids[r.id] = true;
  ok(texto(r.tema), w + ': tema'); temas[r.tema] = (temas[r.tema] || 0) + 1;
  ok(r.tipo === 'evento' || r.tipo === 'estado', w + ': tipo evento|estado');
  ok(['info', 'warn', 'good'].indexOf(r.tono) >= 0, w + ': tono info|warn|good');
  ok(isNum(r.prioridad) && r.prioridad >= 1 && r.prioridad <= 5, w + ': prioridad 1..5');
  ok(isNum(r.espera) && r.espera >= 0, w + ': espera ≥ 0');
  ok(r.solo === undefined || r.solo === 'tunel' || r.solo === 'vuelo', w + ': solo tunel|vuelo');
  ok(typeof r.cuando === 'function' && typeof r.cadena === 'function', w + ': cuando() y cadena() son funciones');
});
['flaps', 'alerones', 'profundidad', 'timon', 'acelerador', 'velocidad', 'angulo', 'perdida', 'fuerzas'].forEach(function (t) {
  ok(temas[t] > 0, 'hay reglas del tema "' + t + '"');
});

/* ------------------------------------------------------------------ narración: robustez contra fotos */
seccion('Narración: corre contra estados de todos los presets');
var PRESETS = ['parked', 'runup', 'runway', 'cruise', 'approach'];
if (tunnelOk) PRESETS.push('tunnel');
function nuevoEstado(preset) {
  if (hasSim && Sim && typeof Sim.createState === 'function') return Sim.createState(preset);
  return { flaps: 0, throttle: 0.5, yokeRoll: 0, yokePitch: 0, rudder: 0, trim: 0, propRpm: 2200,
    engine: { running: true, rpm: 2200 }, air: { ias: 90, aoa: 4, pitch: 1, bank: 0, vs: 0, onGround: false },
    surfaces: {}, tunnel: { on: preset === 'tunnel', ias: 80, aoa: 4, beta: 0 } };
}
function paso(s, dt) { if (hasSim && Sim && typeof Sim.step === 'function') Sim.step(s, dt); }
var variantes = [
  {}, { flaps: 20 }, { flaps: 40 }, { throttle: 0 }, { throttle: 1 }, { yokeRoll: 1 }, { yokeRoll: -1 },
  { yokePitch: 1 }, { yokePitch: -1 }, { rudder: 1 }, { rudder: -1 }, { trim: 1 }, { trim: -1 },
  { yokeRoll: 0.6, rudder: 0 }, { throttle: 1, rudder: 0.4 }
];
var tunelVars = [];
[0, 30, 50, 100, 145].forEach(function (ias) { [-6, 0, 4, 12.5, 16, 22].forEach(function (aoa) { tunelVars.push({ ias: ias, aoa: aoa }); }); });
var corridas = 0, errores = 0, malas = 0, disparos = 0;
function correReglas(c, p) {
  R.forEach(function (r) {
    var d = {};
    try {
      r.cuando(c, p, d);
      r.cuando(c, c, d);                   // segunda vuelta con memoria (refs ya fijadas)
      var out = r.cadena(c, p, d);
      corridas++;
      if (!Array.isArray(out) || out.length < 2 || out.length > 5 || !out.every(function (t) { return texto(t) && !/undefined|NaN|Infinity|\[object/.test(t); })) {
        malas++;
        if (malas <= 5) console.error('  cadena inválida en ' + r.id + ': ' + JSON.stringify(out));
      } else if (out.some(function (t) { return TUTEO.test(t) || /\d\.\d/.test(t); })) {
        malas++;
        if (malas <= 5) console.error('  cadena con tuteo o punto decimal en ' + r.id + ': ' + JSON.stringify(out));
      }
    } catch (e) {
      errores++;
      if (errores <= 5) console.error('  error en la regla ' + r.id + ': ' + e.message);
    }
  });
}
PRESETS.forEach(function (pr) {
  variantes.forEach(function (v) {
    var s = nuevoEstado(pr);
    Object.keys(v).forEach(function (k) { s[k] = v[k]; });
    paso(s, 0.05);
    var p = Lab.snap(s, 0);
    paso(s, 0.25);
    var c = Lab.snap(s, 0.3);
    correReglas(c, p);
    correReglas(c, null);
    var n = Lab.createNarrator(R);
    for (var k = 0; k < 6; k++) { paso(s, 0.25); disparos += n.update(Lab.snap(s, 0.5 + k * 0.25)).length; }
    ok(n.errors === 0, 'narrador sin errores (' + pr + ' ' + JSON.stringify(v) + ')');
  });
});
// túnel (real o estimado) en todo el rango de velocidad y ángulo
var sT = tunnelOk ? nuevoEstado('tunnel') : nuevoEstado('cruise');
tunelVars.forEach(function (tv) {
  [0, 20, 40].forEach(function (fl) {
    sT.flaps = fl;
    var fake = tunnelOk ? null : { ias: tv.ias, aoa: tv.aoa, beta: 0 };
    if (tunnelOk) { sT.tunnel.ias = tv.ias; sT.tunnel.aoa = tv.aoa; }
    paso(sT, 0.1);
    var c = Lab.snap(sT, 1, fake);
    ok(isNum(c.cl) && isNum(c.liftKg) && isNum(c.dragKg) && isNum(c.n), 'foto numérica (túnel ' + tv.ias + ' kt, ' + tv.aoa + '°, flaps ' + fl + ')');
    correReglas(c, null);
  });
});
console.log('  ' + corridas + ' corridas de reglas, ' + disparos + ' disparos del narrador');
ok(errores === 0, 'ninguna regla tira error (' + errores + ')');
ok(malas === 0, 'todas las cadenas son textos limpios de 2 a 5 eslabones (' + malas + ' malas)');

/* ------------------------------------------------------------------ escenarios con el Sim */
seccion('Narración: escenarios');
if (hasSim && Sim) {
  var dis = {};
  var t = 0;
  function corre(s, n, seg, fake, fn) {
    var steps = Math.round(seg / 0.05);
    for (var k = 0; k < steps; k++) {
      if (fn) fn(s);
      Sim.step(s, 0.05); t += 0.05;
      if (k % 5 === 4) n.update(Lab.snap(s, t, fake ? s.tunnel : null)).forEach(function (f) { dis[f.id] = (dis[f.id] || 0) + 1; });
    }
  }
  // túnel
  var s1 = tunnelOk ? Sim.createState('tunnel') : Sim.createState('cruise');
  if (!s1.tunnel) s1.tunnel = { on: false, ias: 80, aoa: 4, beta: 0 };
  var fake = !tunnelOk;
  var n1 = Lab.createNarrator(R);
  corre(s1, n1, 2, fake);
  s1.tunnel.aoa = 9; corre(s1, n1, 2, fake);
  Sim.actions.setFlapSwitch(s1, 'DOWN'); corre(s1, n1, 4.6, fake); Sim.actions.setFlapSwitch(s1, 'OFF'); corre(s1, n1, 1.5, fake);
  ok(s1.flaps > 15 && s1.flaps < 25, 'el motor de flaps llevó a ≈ 20° (' + s1.flaps.toFixed(1) + ')');
  s1.tunnel.aoa = Lab.stallAoa(s1.flaps) - 2; corre(s1, n1, 2, fake);
  s1.tunnel.aoa = 19; corre(s1, n1, 2.5, fake);
  s1.tunnel.aoa = 5; corre(s1, n1, 3, fake);
  s1.throttle = 1; corre(s1, n1, 2, fake);
  s1.tunnel.ias = 120; corre(s1, n1, 2, fake);
  s1.yokeRoll = 0.6; corre(s1, n1, 3, fake);
  s1.rudder = 0.5; corre(s1, n1, 1.5, fake);
  s1.yokePitch = 0.5; corre(s1, n1, 1.5, fake);
  s1.trim = 0.6; corre(s1, n1, 1.5, fake);
  ['angulo', 'flaps-moviendo', 'flaps-cambio', 'bocina', 'perdida', 'recuperacion', 'potencia', 'velocidad', 'flaps-vfe',
    'alerones', 'pedal', 'profundidad', 'compensador'].forEach(function (id) {
    ok(dis[id] > 0, 'en el túnel se dispara "' + id + '"');
  });
  // vuelo
  var s2 = Sim.createState('cruise');
  var n2 = Lab.createNarrator(R);
  corre(s2, n2, 1, false);
  s2.yokeRoll = 0.45; corre(s2, n2, 4, false);
  s2.yokeRoll = 0; corre(s2, n2, 2, false);
  s2.yokeRoll = -0.45; corre(s2, n2, 30, false, function (s) {
    if (Math.abs(s.air.bank) < 2) s.yokeRoll = 0;
  });
  ['alerones', 'inclinacion-sigue', 'alas-niveladas'].forEach(function (id) { ok(dis[id] > 0, 'en vuelo se dispara "' + id + '"'); });
  ok(Object.keys(dis).length >= 16, 'variedad: ' + Object.keys(dis).length + ' reglas distintas dispararon');
  console.log('  disparos: ' + Object.keys(dis).sort().map(function (k) { return k + '×' + dis[k]; }).join(', '));
} else console.log('  (sin sim.js: se saltean)');

/* ------------------------------------------------------------------ curva y pérdida */
seccion('Curva de sustentación');
[0, 20, 40].forEach(function (f) {
  var pts = Lab.clCurve(f), as = Lab.stallAoa(f);
  ok(Array.isArray(pts) && pts.length >= 40, 'clCurve(' + f + ') tiene puntos');
  ok(pts[0].aoa <= -7.9 && pts[pts.length - 1].aoa >= 21.9, 'clCurve(' + f + ') va de −8° a +22°');
  var maxI = 0;
  pts.forEach(function (p, i) { if (p.cl > pts[maxI].cl) maxI = i; });
  ok(Math.abs(pts[maxI].aoa - as) <= 1, 'el máximo de cl está en el ángulo de pérdida (' + pts[maxI].aoa + ' vs ' + as + ')');
  ok(pts[pts.length - 1].cl < pts[maxI].cl, 'clCurve(' + f + ') cae después de la pérdida');
});
ok(Lab.stallAoa(0) > Lab.stallAoa(40), 'con flaps la pérdida llega a un ángulo algo menor');
ok(Lab.clCurve(40)[30].cl > Lab.clCurve(0)[30].cl, 'con flaps hay más cl al mismo ángulo');
var fb = Lab.aeroFallback({ flaps: 0, tunnel: { on: true, ias: 80, aoa: 5.4, beta: 0 }, engine: {}, air: {} });
ok(Math.abs(fb.liftN / fb.weightN - 1) < 0.1, 'estimación: a 80 kt y 5,4° la sustentación ≈ peso (' + (fb.liftN / fb.weightN).toFixed(2) + ')');

/* ------------------------------------------------------------------ index.html */
seccion('index.html');
var html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
function pos(f) { return html.indexOf('data-inline="' + f + '"'); }
ok(/data-mode="aire"/.test(html) && /id="panel-aire"/.test(html), 'pestaña y panel AIRE');
ok(pos('data/lab.js') > pos('data/learning.js') && pos('data/learning.js') >= 0, 'data/lab.js después de data/learning.js');
ok(pos('airfoil.js') > pos('gauges.js') && pos('gauges.js') >= 0, 'airfoil.js después de gauges.js');
ok(pos('airflow.js') > pos('exterior.js') && pos('exterior.js') >= 0, 'airflow.js después de exterior.js');
ok(pos('airflow.js') < pos('core.js'), 'airflow.js antes de core.js');
ok(pos('lab.js') > 0 && pos('lab.js') < pos('ui.js'), 'lab.js antes de ui.js');

console.log('\n' + (pruebas - fallas) + '/' + pruebas + ' pruebas OK');
if (fallas) { console.error(fallas + ' FALLAS'); process.exit(1); }
