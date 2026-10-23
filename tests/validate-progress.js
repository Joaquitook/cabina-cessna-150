/* validate-progress.js — pruebas de src/progress.js (C150.Progress) en Node, sin DOM.
 *   node tests/validate-progress.js
 * Cubre: almacenamiento (bloqueado → memoria, persistencia y recarga), mark/get/list/last/touch, mejor puntaje del quiz,
 * etapas de "Tu camino" (summary), onChange, reset y la etapa reservada de la Escuela. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
let pruebas = 0, fallas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallas++; console.error('  FALLA: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (esperado ' + JSON.stringify(b) + ', fue ' + JSON.stringify(a) + ')'); }
function seccion(t) { console.log('\n== ' + t); }

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m };
}
function load(opts) {
  opts = opts || {};
  const sandbox = { console, Math, Date, JSON };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  if (opts.storage !== null) sandbox.localStorage = opts.storage || memStorage();
  vm.createContext(sandbox);
  vm.runInContext('var C150 = this.C150 = this.C150 || {};', sandbox);
  if (opts.data !== false) {
    for (const f of ['data/controls-a.js', 'data/controls-b.js', 'data/learning.js', 'data/lab.js', 'data/situations.js']) {
      vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
    }
  }
  vm.runInContext(fs.readFileSync(path.join(SRC, 'progress.js'), 'utf8'), sandbox, { filename: 'progress.js' });
  return sandbox;
}

/* ------------------------------------------------------------------ básico */
seccion('mark / get / list');
let S = load();
let P = S.C150.Progress;
ok(!!P && typeof P.mark === 'function' && typeof P.summary === 'function', 'C150.Progress expone mark y summary');
ok(P.get('leccion', 'x') === null, 'get de algo no marcado → null');
const D = S.C150.DATA;
const lessonIds = D.lessons.map((l) => l.id), clIds = D.checklists.map((c) => c.id), misIds = D.missions.map((m) => m.id);
const sitIds = (D.situations || []).map((s) => s.id), expIds = (D.labExperiments || []).map((e) => e.id), ctlIds = D.controls.map((c) => c.id);
ok(lessonIds.length >= 10 && clIds.length >= 4 && misIds.length >= 3 && ctlIds.length >= 40, 'datos cargados (' + [lessonIds.length, clIds.length, misIds.length, sitIds.length, expIds.length, ctlIds.length] + ')');
const e1 = P.mark('leccion', lessonIds[0], { paso: 3 });
ok(e1 && e1.kind === 'leccion' && e1.id === lessonIds[0] && typeof e1.t === 'number', 'mark devuelve la entrada');
eq(P.get('leccion', lessonIds[0]).d, { paso: 3 }, 'get devuelve los datos');
P.mark('leccion', lessonIds[0]);
eq(P.list('leccion').length, 1, 'marcar dos veces no duplica');
eq(P.get('leccion', lessonIds[0]).n, 2, 'cuenta de veces');
P.mark('leccion', lessonIds[1]);
eq(P.list('leccion').map((e) => e.id)[0], lessonIds[1], 'list: la más nueva primero');
ok(P.mark('', 'x') === null && P.mark('leccion', '') === null, 'mark ignora kind o id vacíos');

seccion('quiz: se guarda el mejor puntaje');
P.mark('quiz', 'best', { score: 5, total: 10 });
P.mark('quiz', 'best', { score: 3, total: 10 });
eq(P.get('quiz', 'best').d, { score: 5, total: 10 }, 'un intento peor no pisa el mejor');
P.mark('quiz', 'best', { score: 9, total: 10 });
eq(P.get('quiz', 'best').d, { score: 9, total: 10 }, 'un intento mejor lo reemplaza');

seccion('last / touch');
S = load(); P = S.C150.Progress;
ok(P.last() === null, 'sin actividad: last() es null');
P.mark('onboarding', 'visto');
ok(P.last() === null, 'onboarding no cuenta como última actividad');
P.mark('cabina', 'yoke');
eq(P.last().kind, 'cabina', 'last: cabina');
ok(P.last().hecho === true && P.last().ruta === '#cabina', 'last: hecho + ruta');
P.touch('leccion', lessonIds[2], { paso: 4 });
const l = P.last();
ok(l.kind === 'leccion' && l.hecho === false && l.ruta === '#basico' && l.d.paso === 4, 'touch: última actividad sin marcarla hecha');
ok(/Lecci/.test(l.titulo), 'last: título legible (' + l.titulo + ')');
ok(!P.get('leccion', lessonIds[2]), 'touch no marca como hecho');

seccion('onChange');
S = load(); P = S.C150.Progress;
let calls = 0, lastEv = null;
const off = P.onChange((ev) => { calls++; lastEv = ev; });
P.mark('checklist', clIds[0]);
eq(calls, 1, 'onChange al marcar algo nuevo');
ok(lastEv.kind === 'checklist' && lastEv.summary && Array.isArray(lastEv.summary.camino), 'el evento trae kind y summary');
P.mark('checklist', clIds[0]);
eq(calls, 1, 'marcar lo mismo otra vez no vuelve a avisar');
P.mark('checklist', clIds[1]);
eq(calls, 2, 'otro id: avisa');
off();
P.mark('checklist', clIds[2]);
eq(calls, 2, 'desuscribir funciona');
P.onChange(() => { throw new Error('oyente roto'); });
let threw = false; try { P.mark('checklist', clIds[3]); } catch (e) { threw = true; }
ok(!threw, 'un oyente que falla no rompe mark');

/* ------------------------------------------------------------------ almacenamiento */
seccion('almacenamiento');
const store = memStorage();
S = load({ storage: store }); P = S.C150.Progress;
P.mark('mision', misIds[0]);
ok(!!store._m['c150.progress.v1'], 'guarda en la clave c150.progress.v1');
ok(P.persistent === true, 'persistent = true con localStorage');
S = load({ storage: store }); P = S.C150.Progress;
ok(!!P.get('mision', misIds[0]), 'al recargar recupera lo guardado');
store._m['c150.progress.v1'] = '{roto';
S = load({ storage: store }); P = S.C150.Progress;
eq(P.list('mision').length, 0, 'JSON roto → arranca de cero sin explotar');
store._m['c150.progress.v1'] = JSON.stringify({ v: 99, items: {} });
S = load({ storage: store }); P = S.C150.Progress;
eq(P.list('mision').length, 0, 'versión desconocida → arranca de cero');

const blocked = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
S = load({ storage: blocked }); P = S.C150.Progress;
let t2 = false; try { P.mark('cabina', 'yoke'); } catch (e) { t2 = true; }
ok(!t2, 'localStorage bloqueado: mark no lanza');
ok(!!P.get('cabina', 'yoke'), 'localStorage bloqueado: sigue funcionando en memoria');
ok(P.persistent === false, 'persistent = false cuando no se puede guardar');
S = load({ storage: null }); P = S.C150.Progress;
let t3 = false; try { P.mark('cabina', 'yoke'); P.summary(); } catch (e) { t3 = true; }
ok(!t3 && !!P.get('cabina', 'yoke'), 'sin localStorage en absoluto: memoria');

/* ------------------------------------------------------------------ Tu camino */
seccion('summary: Tu camino');
S = load(); P = S.C150.Progress;
let sum = P.summary();
eq(sum.camino.length, 5, '5 etapas (sin Escuela)');
eq(sum.camino.map((s) => s.id), ['cabina', 'vuelo', 'procedimientos', 'practica', 'quiz'], 'orden de las etapas');
ok(sum.porcentaje === 0 && sum.completas === 0, 'al empezar: 0 %');
ok(sum.siguiente && sum.siguiente.id === 'cabina', 'la siguiente etapa es la primera');
sum.camino.forEach((s) => ok(s.titulo && s.descripcion && /^#/.test(s.ruta) && s.total >= 1 && s.fraccion === 0 && s.completa === false && s.requisitos.length === s.total, 'etapa ' + s.id + ': campos completos'));

ctlIds.slice(0, 9).forEach((id) => P.mark('cabina', id));
sum = P.summary();
ok(sum.camino[0].fraccion > 0 && sum.camino[0].fraccion < 0.5 && !sum.camino[0].completa, '9 mandos: etapa 1 a medias');
ok(sum.camino[0].requisitos[0].actual === 9 && sum.camino[0].requisitos[0].total === 10, 'requisito de mandos 9/10');
P.mark('cabina', ctlIds[9]);
P.mark('cabina', 'id-que-no-existe');
ok(P.summary().camino[0].requisitos[0].hecho && !P.summary().camino[0].completa, '10 mandos: requisito hecho, etapa aún no (falta el recorrido)');
ok(P.summary().camino[0].ruta === '#recorrido', 'la ruta de la etapa apunta a lo que falta');
eq(P.summary().camino[0].requisitos[0].actual, 10, 'ids desconocidos no suman');
P.mark('recorrido', 'tour');
sum = P.summary();
ok(sum.camino[0].completa && sum.camino[0].fraccion === 1, 'etapa 1 completa con 10 mandos + recorrido');
ok(sum.siguiente.id === 'vuelo' && sum.completas === 1, 'la siguiente es la etapa 2');
ok(sum.porcentaje === 20, 'una etapa de cinco = 20 % (' + sum.porcentaje + ')');

lessonIds.forEach((id) => P.mark('leccion', id));
expIds.slice(0, 3).forEach((id) => P.mark('aire', id));
ok(P.summary().camino[1].completa, 'etapa 2: todas las lecciones + 3 experimentos');
clIds.forEach((id) => P.mark('checklist', id));
ok(P.summary().camino[2].completa, 'etapa 3: todas las checklists');
misIds.slice(0, 3).forEach((id) => P.mark('mision', id));
ok(!P.summary().camino[3].completa, 'etapa 4: sólo misiones no alcanza');
sitIds.slice(0, 2).forEach((id) => P.mark('situacion', id));
ok(P.summary().camino[3].completa, 'etapa 4: misiones + situaciones');
P.mark('quiz', 'best', { score: 6, total: 10 });
ok(!P.summary().camino[4].completa && P.summary().camino[4].fraccion === 0, 'etapa 5: 60 % no alcanza');
ok(P.summary().camino[4].mejor.score === 6, 'etapa 5 informa el mejor puntaje');
P.mark('quiz', 'best', { score: 7, total: 10 });
sum = P.summary();
ok(sum.camino[4].completa, 'etapa 5: 70 % alcanza');
ok(sum.porcentaje === 100 && sum.completas === 5 && sum.siguiente === null, 'todo hecho: 100 % y sin siguiente');

seccion('etapa reservada: Escuela');
S.C150.Escuela = { total: 4 };
sum = P.summary();
eq(sum.camino.length, 6, 'con C150.Escuela aparece la etapa 6');
ok(sum.camino[5].id === 'escuela' && !sum.camino[5].completa && sum.siguiente.id === 'escuela', 'etapa 6 pendiente');
['a', 'b', 'c', 'd'].forEach((id) => P.mark('escuela', id));
ok(P.summary().camino[5].completa && P.summary().porcentaje === 100, 'etapa 6 completa al estudiar todas');

seccion('reset');
let rcalls = 0; P.onChange(() => { rcalls++; });
P.reset();
ok(P.list('leccion').length === 0 && P.summary().porcentaje === 0 && P.last() === null, 'reset borra todo');
ok(rcalls >= 1, 'reset avisa a los oyentes');

seccion('sin datos (C150.DATA ausente)');
S = load({ data: false }); P = S.C150.Progress;
let t4 = false; try { P.mark('leccion', 'x'); P.summary(); } catch (e) { t4 = true; }
ok(!t4, 'sin datos: summary no explota');
eq(P.summary().camino.length, 5, 'sin datos: 5 etapas con totales por defecto');

console.log('\n' + (pruebas - fallas) + '/' + pruebas + ' pruebas OK');
if (fallas) { console.error(fallas + ' FALLAS'); process.exit(1); }
console.log('validate-progress: TODO BIEN');
