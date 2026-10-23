// Prueba de src/search.js (parte pura, sin DOM): puntaje, proveedores de fábrica, registro de proveedores y acciones.
//   node tests/validate-search.js
'use strict';
const path = require('path');
global.window = global; global.C150 = {};
['controls-a', 'controls-b', 'learning', 'lab', 'situations'].forEach((f) => require(path.join('..', 'src', 'data', f + '.js')));
require('../src/glossary.js');
require('../src/search.js');
const S = C150.Search, D = C150.DATA;

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('  FALLA: ' + msg); } }
const flat = (q) => { const out = []; S.query(q).forEach((g) => g.items.forEach((it) => out.push({ g: g.id, it }))); return out; };
const first = (q) => { const f = flat(q)[0]; return f ? f.it.titulo : null; };

// espías de C150.UI
const calls = [];
C150.UI = {};
['go', 'showControl', 'openLesson', 'openChecklist', 'openMission', 'openSituation', 'startQuiz', 'openLab', 'sheet', 'openHelp']
  .forEach((n) => { C150.UI[n] = function () { calls.push([n].concat(Array.prototype.slice.call(arguments))); return true; }; });

// ---- tokens y plegado
ok(S.fold('Pérdida ÁÉÍÓÚ ñ') === 'perdida aeiou n', 'fold: sin tildes ni mayúsculas');
ok(JSON.stringify(S.tokens('ir a los Flaps')) === '["flaps"]', 'tokens: se saltean las palabras vacías ("ir a los")');
ok(JSON.stringify(S.tokens('¿qué es el QNH?')) === '["qnh"]', 'tokens: "¿qué es el QNH?" → qnh');
ok(JSON.stringify(S.tokens('a')) === '["a"]', 'tokens: una letra sola se conserva');
ok(S.tokens('').length === 0, 'tokens: vacío');

// ---- proveedores de fábrica
ok(S.providers().join() === 'atajos,mandos,glosario,lecciones,practicar,aire', 'proveedores de fábrica: ' + S.providers().join());
ok(first('acelerador') === 'Acelerador', 'acelerador → el mando Acelerador (' + first('acelerador') + ')');
ok(first('QNH') === 'QNH', 'QNH → el término QNH (' + first('QNH') + ')');
ok(flat('perdida').some((r) => r.g === 'glosario' && /rdida/.test(r.it.titulo)), 'sin tildes: "perdida" encuentra Pérdida');
ok(flat('flaps').some((r) => r.g === 'mandos' && /flaps/i.test(r.it.titulo)), 'flaps → el interruptor de flaps');
ok(flat('flaps').some((r) => r.g === 'glosario' && r.it.titulo === 'Flaps'), 'flaps → el término Flaps');
ok(flat('nafta').some((r) => r.g === 'mandos'), 'nafta → algún mando (otros nombres)');
ok(flat('checklist arranque').some((r) => r.g === 'practicar' && /arranque/i.test(r.it.titulo)), 'checklist de arranque → la checklist');
ok(flat('hielo').some((r) => r.g === 'practicar' && /Situaci/.test(r.it.titulo)), 'hielo → la situación de hielo en el carburador');
ok(flat('fuerzas').some((r) => r.g === 'aire'), 'fuerzas → un experimento del aire');
ok(flat('fuerzas').some((r) => r.g === 'lecciones'), 'fuerzas → una lección');
ok(first('ir a checklists') === 'Checklists', '"ir a checklists" → el atajo Checklists (' + first('ir a checklists') + ')');
ok(first('tutorial') && /tutorial/i.test(first('tutorial')), 'tutorial → ver el tutorial');
ok(flat('xyzzyq').length === 0, 'una búsqueda sin nada no devuelve resultados');
const empty = S.query('');
ok(empty.length === 1 && empty[0].id === 'atajos' && empty[0].items.length >= 5, 'pantalla vacía: sólo atajos (≥ 5)');
ok(flat('flap').every((r) => r.it.score > 0 && typeof r.it.accion === 'function' && r.it.titulo), 'todos los resultados tienen título, puntaje y acción');
// las coincidencias sólo en el texto largo no ensucian
const fl = flat('flap').map((r) => r.it.titulo);
ok(fl.indexOf('Borde de fuga') < 0 && fl.indexOf('Arremetida') < 0, 'flap: los términos que sólo nombran flaps en su definición no aparecen (' + fl.join(' | ') + ')');
// ranking dentro de un grupo: empieza-con gana a contiene
const m = S.query('trim').filter((g) => g.id === 'mandos')[0];
ok(m && /ompensador|trim/i.test(m.items[0].titulo), 'trim → el compensador primero');
// grupos ordenados por su mejor resultado
const g1 = S.query('flaps');
ok(g1.length >= 2 && g1[0].top >= g1[1].top, 'los grupos vienen ordenados por su mejor resultado');
ok(g1.every((g) => g.items.length <= 5), 'máximo 5 por grupo');

// ---- acciones
function run(q, g, re) { const r = flat(q).filter((x) => x.g === g && re.test(x.it.titulo))[0]; calls.length = 0; if (r) r.it.accion(); return calls.slice(); }
let c = run('acelerador', 'mandos', /^Acelerador$/);
ok(c.length === 1 && c[0][0] === 'showControl' && c[0][1] === 'throttle', 'acción de un mando → UI.showControl("throttle")');
c = run('cuatro fuerzas', 'lecciones', /fuerzas/i);
ok(c.length === 1 && c[0][0] === 'openLesson' && c[0][1] === 'cuatro-fuerzas', 'acción de una lección → UI.openLesson');
c = run('antes de arrancar', 'practicar', /Checklist/);
ok(c.length === 1 && c[0][0] === 'openChecklist', 'acción de una checklist → UI.openChecklist (' + JSON.stringify(c) + ')');
c = run('arrancá el motor', 'practicar', /Misi/);
ok(c.length === 1 && c[0][0] === 'openMission', 'acción de una misión → UI.openMission');
c = run('hielo carburador', 'practicar', /Situaci/);
ok(c.length === 1 && c[0][0] === 'openSituation' && c[0][1] === 'hielo-carburador', 'acción de una situación → UI.openSituation');
c = run('fuerzas', 'aire', /fuerzas/i);
ok(c.length === 1 && c[0][0] === 'openLab' && c[0][1] === 'fuerzas', 'acción de un experimento → UI.openLab');
c = run('quiz', 'practicar', /Quiz r/);
ok(c.length === 1 && c[0][0] === 'startQuiz', 'acción del quiz → UI.startQuiz');
c = run('ir a inicio', 'atajos', /Inicio/);
ok(c.some((x) => x[0] === 'go' && x[1] === 'inicio'), 'atajo "Ir al Inicio" → UI.go("inicio")');

// ---- registro de proveedores (ESCUELA agrega el suyo)
let hit = 0;
ok(S.register({ id: 'escuela', label: 'Escuela', icon: 'cap', order: 6, items: (q) => (S.tokens(q).indexOf('aerodinamica') >= 0 ? [{ titulo: 'Aerodinámica básica', detalle: 'Teoría', icono: 'cap', accion: () => { hit++; } }] : []) }) === true, 'register devuelve true');
const es = flat('aerodinamica').filter((x) => x.g === 'escuela');
ok(es.length === 1 && es[0].it.titulo === 'Aerodinámica básica', 'un proveedor nuevo aparece en los resultados');
es[0].it.accion();
ok(hit === 1, 'y su acción funciona');
S.register({ id: 'roto', label: 'Roto', items: () => { throw new Error('a propósito'); } });
const origErr = console.error; console.error = () => {};
let threw = false; try { flat('flaps'); } catch (e) { threw = true; }
console.error = origErr;
ok(!threw, 'un proveedor que falla no rompe la búsqueda');
S.unregister('roto'); S.unregister('escuela');
ok(S.providers().indexOf('escuela') < 0, 'unregister');
ok(S.register({ id: 'x' }) === false, 'register sin items() se rechaza');

console.log(fails ? '\n' + fails + ' falla(s) de ' + checks : '\nOK: ' + checks + ' comprobaciones');
process.exit(fails ? 1 : 0);
