/* validate-escuela.js — pruebas de la Escuela (contrato v7 §7) en Node, sin DOM.
 *   node tests/validate-escuela.js
 * Cubre:
 *  - src/data/escuela/indice.json: esquema, ids únicos y con la forma AAA-NN-NN, módulos en orden, tipos de componente conocidos, tamaño (≤ 200 KB);
 *  - cada src/data/escuela/<ID>.json: lecciones presentes en el índice como "completo", 2–4 objetivos, contenido, preguntas con 4 opciones y
 *    `correcta` válida, sin textos vacíos, enlaces contra los ids reales de la app (controles, poses, experimentos AIRE, situaciones, lecciones
 *    de la app y otras lecciones de la Escuela) y componentes: tipo registrado o en la lista "más adelante";
 *  - el motor: todo `normalizar` registrado (también los de src/escuela/c-*.js) corre en Node sobre los datos de las lecciones y devuelve un valor
 *    o null SIN tirar error; un normalizar que tira se trata como null;
 *  - la lógica pura del ejecutor (armar pasos, mezclar con semilla estable, elegir preguntas) y del store (estrellas, cajas de Leitner, racha,
 *    minutos, exportar / importar, saneado de claves peligrosas, almacenamiento bloqueado) y de los datos (páginas, siguiente / anterior, carga por fetch);
 *  - si ya corriste node build.js: los bloques inline y cabina-cessna-150/escuela/<ID>.json coinciden con src/.
 *  - componentes B (E3): clasificar, emparejar, situación y enlace 3D: normalizar sobre alias y datos basura, evaluador de consignas, y los esbozos reales del plan
 *    (≥ 80 % normalizan) con cada destino de enlace 3D contrastado contra los ids reales de la app (controles, poses, experimentos AIRE, vistas, focos, situaciones…).
 * Los archivos src/escuela/c-*.js y modelos.js (componentes de las pasadas siguientes) se cargan acá con un Kit de mentira: su código de primer nivel
 * no puede tocar el DOM (sólo registrar con C150.ESCUELA.componentes.register; el DOM se usa dentro de render). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
let pruebas = 0, fallas = 0;
function ok(cond, msg) { pruebas++; if (!cond) { fallas++; console.error('  FALLA: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (esperado ' + JSON.stringify(b) + ', fue ' + JSON.stringify(a) + ')'); }
function seccion(t) { console.log('\n== ' + t); }
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m };
}
function load(extra) {
  const sandbox = { console, Math, Date, JSON, Promise, setTimeout, clearTimeout };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.localStorage = memStorage();
  Object.assign(sandbox, extra || {});
  vm.createContext(sandbox);
  vm.runInContext('var C150 = this.C150 = this.C150 || {};', sandbox);
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
  ['data/controls-a.js', 'data/controls-b.js', 'data/learning.js', 'data/lab.js', 'data/situations.js'].forEach(run);
  run('sim.js'); run('exterior.js');
  run('icons.js'); run('kit.js'); run('progress.js'); run('glossary.js'); run('search.js');
  ['escuela/datos.js', 'escuela/store.js', 'escuela/motor.js', 'escuela/texto.js', 'escuela/bloques.js', 'escuela/leccion.js', 'escuela/pantallas.js', 'escuela/visor.js', 'escuela/escuela.js'].forEach(run);
  // un Kit de mentira para los componentes (sin DOM)
  vm.runInContext('C150.Kit = C150.Kit || {}; if (!C150.Kit.el) { C150.Kit.el = function () { return {}; }; C150.Kit.icon = function () { return {}; }; }', sandbox);
  const dir = path.join(SRC, 'escuela');
  const prio = (f) => (f === 'modelos.js' ? 0 : f === 'figuras.js' ? 1 : 2);
  const comps = fs.readdirSync(dir).filter((f) => /^(c-.*|modelos|figuras)\.js$/.test(f)).sort((a, b) => (prio(a) - prio(b)) || a.localeCompare(b));
  comps.forEach((f) => { try { run('escuela/' + f); } catch (e) { ok(false, f + ' se carga en Node sin tocar el DOM: ' + e.message); } });
  return { S: sandbox, C: sandbox.C150, comps };
}

const { S, C, comps } = load();
const ES = C.ESCUELA, D = ES.datos, ST = ES.store, Mot = ES.componentes, LE = ES.leccion;
const ED = path.join(SRC, 'data', 'escuela');

/* ------------------------------------------------------------------ índice */
seccion('índice');
const rawIx = fs.readFileSync(path.join(ED, 'indice.json'), 'utf8');
const ix = JSON.parse(rawIx);
ok(ix.v === 1 && Array.isArray(ix.modulos), 'indice.json: {v:1, modulos:[…]}');
ok(Buffer.byteLength(rawIx) <= 200 * 1024, 'indice.json pesa ≤ 200 KB (' + (Buffer.byteLength(rawIx) / 1024).toFixed(0) + ' KB)');
eq(ix.modulos.map((m) => m.id), ['INT', 'AER', 'INS', 'AYM', 'COM', 'ATM', 'RTF', 'MET', 'NAV', 'REG', 'PER', 'FHU'], 'los 12 módulos en el orden del curso y luego los complementarios');
const ids = [], DETALLES = ['completo', 'proximamente', 'pendiente'];
ix.modulos.forEach((m, i) => {
  ok(m.orden === i + 1 && /^#[0-9A-Fa-f]{6}$/.test(m.color) && m.titulo && m.resumen && ['aerosur', 'complementario'].includes(m.fuente), m.id + ': orden, color, título, resumen y fuente');
  ok(i < 7 ? m.fuente === 'aerosur' && /^\d+–\d+$/.test(m.paginas) : m.fuente === 'complementario', m.id + ': el curso lleva páginas; los demás son "complementario"');
  ok(C.Icons.has(m.icono) && C.Icons.has('star') && C.Icons.has('cap'), m.id + ': el icono "' + m.icono + '" existe en src/icons.js');
  ok(m.examen && m.examen.numPreguntas > 0, m.id + ': examen.numPreguntas');
  m.unidades.forEach((u) => {
    ok(/^[A-Z]{3}-\d{2}$/.test(u.id) && u.id.startsWith(m.id + '-') && u.titulo && u.lecciones.length > 0, u.id + ': unidad bien formada');
    u.lecciones.forEach((l) => {
      ids.push(l.id);
      ok(/^[A-Z]{3}-\d{2}-\d{2}$/.test(l.id) && l.id.startsWith(u.id + '-') && l.titulo && l.minutos > 0 && DETALLES.includes(l.detalle) && Array.isArray(l.componentes) && typeof l.enlaces === 'number', l.id + ': lección bien formada');
      l.componentes.forEach((t) => ok(Mot.conocido(t), l.id + ': tipo de componente conocido (' + t + ')'));
      ok(l.paginas === '' || !!D.rangos(l.paginas), l.id + ': páginas legibles (' + l.paginas + ')');
    });
  });
});
ok(new Set(ids).size === ids.length && ids.length > 800, 'ids de lección únicos (' + ids.length + ')');
ok(D.setIndice(ix) === true, 'Datos.setIndice acepta el índice');
ok(D.total() === ids.filter((id) => D.leccion(id).lec.detalle === 'completo').length, 'Datos.total = lecciones "completo"');

/* ------------------------------------------------------------------ módulos */
seccion('módulos (src/data/escuela/<ID>.json)');
const APP = C.DATA;
const controles = new Set(APP.controls.map((c) => c.id)), exps = new Set(APP.labExperiments.map((e) => e.id)), lecsApp = new Set(APP.lessons.map((l) => l.id)), sits = new Set(APP.situations.map((s) => s.id));
const poses = new Set((C.Exterior && C.Exterior.POSES || []).map((p) => p.id));
ok(controles.size >= 40 && exps.size > 0 && poses.size > 0 && sits.size > 0, 'datos reales de la app cargados (controles, AIRE, poses, situaciones)');
const modFiles = fs.readdirSync(ED).filter((f) => /^[A-Z]{3}\.json$/.test(f));
ok(modFiles.length >= 1, 'hay al menos un módulo (' + modFiles.join(', ') + ')');
function vacios(o, p, out) {
  if (typeof o === 'string') { if (!o.trim()) out.push(p); }
  else if (Array.isArray(o)) o.forEach((x, i) => vacios(x, p + '[' + i + ']', out));
  else if (o && typeof o === 'object') Object.keys(o).forEach((k) => vacios(o[k], p + '.' + k, out));
  return out;
}
const todasLasLecciones = [];
modFiles.forEach((f) => {
  const mod = readJson(path.join(ED, f)), id = f.replace('.json', '');
  ok(mod.id === id && mod.v === 1 && Array.isArray(mod.unidades), f + ': {id, v:1, unidades}');
  const mm = D.normalizarModulo(mod, id);
  ok(!!mm && Object.keys(mm.lecs).length > 0, f + ': Datos.normalizarModulo lo acepta');
  mod.unidades.forEach((u) => {
    ok(!!D.unidad(u.id) && D.unidad(u.id).mod.id === id, f + ': unidad ' + u.id + ' existe en el índice');
    u.lecciones.forEach((l) => {
      todasLasLecciones.push(l);
      const w = l.id;
      const e = D.leccion(w);
      ok(!!e && e.lec.detalle === 'completo' && e.unidad.id === u.id, w + ': está en el índice como "completo" y en su unidad');
      ok(l.titulo === e.lec.titulo && l.paginas === e.lec.paginas && l.minutos === e.lec.minutos, w + ': título, páginas y minutos iguales a los del índice');
      ok(Array.isArray(l.objetivos) && l.objetivos.length >= 2 && l.objetivos.length <= 4, w + ': 2 a 4 objetivos');
      ok(Array.isArray(l.contenido) && l.contenido.length >= 1, w + ': contenido con puntos clave');
      ok(Array.isArray(l.componentes) && l.componentes.length >= 1, w + ': al menos un componente');
      ok(JSON.stringify(l.componentes.map((c) => c.tipo)) === JSON.stringify(e.lec.componentes), w + ': los tipos de componente coinciden con el índice');
      l.componentes.forEach((c, i) => ok(Mot.conocido(c.tipo) && c.titulo && c.descripcion && c.datos !== undefined, w + ': componente ' + i + ' (' + c.tipo + ') con tipo, título, descripción y datos'));
      ok(Array.isArray(l.preguntas) && l.preguntas.length >= 3, w + ': al menos 3 preguntas para el mini-quiz');
      (l.preguntas || []).forEach((q, i) => {
        ok(q.pregunta && Array.isArray(q.opciones) && q.opciones.length === 4, w + ' P' + (i + 1) + ': 4 opciones');
        ok(Number.isInteger(q.correcta) && q.correcta >= 0 && q.correcta < 4, w + ' P' + (i + 1) + ': correcta válida');
        ok(new Set(q.opciones).size === q.opciones.length, w + ' P' + (i + 1) + ': opciones distintas');
        ok(q.explicacion && Number.isInteger(q.pagina) && q.pagina > 0, w + ' P' + (i + 1) + ': explicación y página del curso');
      });
      (l.glosario || []).forEach((g) => ok(g.termino && g.definicion, w + ': glosario con término y definición'));
      (l.enlaces || []).forEach((n) => {
        const t = n.tipo, k = n.id;
        const existe = t === 'control' ? controles.has(k) : (t === 'aire' || t === 'experimento') ? exps.has(k) : t === 'leccion' ? lecsApp.has(k) : t === 'situacion' ? sits.has(k) : t === 'pose' ? poses.has(k) : t === 'escuela' ? !!D.leccion(k) : false;
        ok(existe, w + ': enlace ' + t + ' → ' + k + ' existe en la app');
      });
      eq(vacios(l, w, []), [], w + ': sin textos vacíos');
      ok(!('notas' in l), w + ': sin "notas" (las dudas para el instructor se quedan en el plan)');
    });
  });
});

/* ------------------------------------------------------------------ motor de componentes */
seccion('motor de componentes');
const originales = { simulador: Mot.get('simulador'), diagrama: Mot.get('diagrama') };   // los reales (c-*.js): se restauran después de probar el motor con simulados
ok(Mot.TIPOS_P1.length === 8 && Mot.TODOS.length === 16 && Mot.TODOS.every((t) => Mot.META[t] && Mot.META[t].codigo), '16 tipos con código y nombre (8 de la pasada 1)');
ok(Mot.esPractica('clasificar') && Mot.esPractica('situacion') && !Mot.esPractica('simulador') && !Mot.esPractica('diagrama'), 'esPractica: clasificar / situación sí, simulador / diagrama no');
ok(Mot.register('simulador', { render: () => ({}) }) === true && Mot.has('simulador'), 'register acepta un tipo conocido');
ok(Mot.register('inventado', { render: () => ({}) }) === false, 'register rechaza un tipo desconocido');
ok(Mot.register('clasificar', {}) === false, 'register rechaza una definición sin render');
Mot.register('diagrama', { normalizar: () => { throw new Error('boom'); }, render: () => ({}) });
ok(Mot.normalizar({ tipo: 'diagrama', datos: {} }, {}) === null, 'un normalizar que tira devuelve null (la lección cae a la reserva)');
ok(Mot.normalizar({ tipo: 'enlace3d', datos: {} }, {}) === null, 'tipo sin registrar → null');
Mot.register('simulador', { normalizar: (d) => d && d.controles ? d : null, render: () => ({}) });
ok(Mot.normalizar({ tipo: 'simulador', datos: { controles: [] } }, {}) !== null && Mot.normalizar({ tipo: 'simulador', datos: {} }, {}) === null, 'normalizar devuelve datos o null');
['simulador', 'diagrama'].forEach((t) => Mot.unregister(t));
Object.keys(originales).forEach((t) => { if (originales[t]) Mot.register(t, originales[t]); });
// los normalizar REALES (los que registran src/escuela/c-*.js) sobre los datos de todas las lecciones
const registrados = Mot.tipos();
const ctxNode = { reducedMotion: false, onDark: true };
let nNorm = 0, nNull = 0;
todasLasLecciones.forEach((l) => l.componentes.forEach((c) => {
  if (!Mot.has(c.tipo)) return;
  let r, tiro = false;
  try { r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c); } catch (e) { tiro = true; }
  ok(!tiro, l.id + ': normalizar(' + c.tipo + ') no tira error con los datos del plan');
  ok(r === null || (r !== undefined && typeof r === 'object'), l.id + ': normalizar(' + c.tipo + ') devuelve un objeto o null');
  nNorm++; if (r === null) nNull++;
}));
console.log('  componentes registrados: ' + (registrados.length ? registrados.join(', ') : '(ninguno todavía: todos usan la reserva)') + ' · normalizados: ' + nNorm + ' (null: ' + nNull + ') · archivos c-*.js: ' + (comps.join(', ') || 'ninguno'));
// todo componente de las lecciones está registrado o en la lista "más adelante"
todasLasLecciones.forEach((l) => l.componentes.forEach((c) => ok(Mot.has(c.tipo) || Mot.TIPOS_P1.concat(Mot.TIPOS_P2, Mot.TIPOS_LUEGO).includes(c.tipo), l.id + ': ' + c.tipo + ' registrado o conocido')));

/* ------------------------------------------------------------------ componentes A (E2): simulador, calculadora, diagrama, animación */
seccion('componentes A: modelos, herramientas, figuras');
const MD = ES.modelos, HR = ES.herramientas, FG = ES.figuras, UT = MD && MD.util;
ok(!!MD && !!HR && !!FG && !!UT, 'existen ES.modelos, ES.herramientas, ES.figuras y las utilidades puras');
['simulador', 'calculadora', 'diagrama', 'animacion'].forEach((t) => ok(Mot.has(t), 'componente "' + t + '" registrado'));
const r2 = (x, d) => Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0);
// utilidades
eq([UT.num('−10'), UT.num('3,5'), UT.num('12 kt'), UT.num('x', 7), UT.horaAMin('19:30'), UT.horaAMin('25:00'), UT.minAHora(1170), UT.minAHora(-30)], [-10, 3.5, 12, 7, 1170, null, '19:30', '23:30'], 'util: num, hora y minutos');
eq([UT.fechaISO(UT.sumarMeses(UT.parseFecha('2026-03-15'), 18)), UT.fechaISO(UT.sumarMeses(UT.parseFecha('2026-08-31'), 6)), UT.fechaISO(UT.sumarDias(UT.parseFecha('2026-08-04'), 3)), UT.diasEntre(UT.parseFecha('2026-01-01'), UT.parseFecha('2026-03-01'))],
  ['2027-09-15', '2027-02-28', '2026-08-07', 59], 'util: fechas (18 meses desde el 15/3/2026 = 15/9/2027; fin de mes cae en el último día; +3 días; diferencia)');
eq([UT.fmt(1234.5, 1), UT.fmt(-3, 0), UT.fmt(0.34, 2), UT.fmt(15000, 0)], ['1234,5', '−3', '0,34', '15 000'], 'util: formato rioplatense (coma decimal, espacio fino desde 5 cifras)');
ok(UT.rng('a')() === UT.rng('a')() && UT.rng('a')() !== UT.rng('b')(), 'util: rng con semilla es determinista');
eq([r2(UT.viento(360, 90, 12).cruzado), r2(UT.viento(360, 0, 15).frente), r2(UT.viento(360, 180, 10).frente), UT.viento(360, 90, 12).lado, UT.viento(360, 270, 12).lado], [12, 15, -10, 'derecha', 'izquierda'], 'util: componentes del viento');
ok(Math.abs(UT.isaPresion(0) - 1013.25) < 0.01 && Math.abs(UT.isaTemp(5000) - 5.1) < 0.01 && Math.abs(UT.isaPresion(5000) - 843.1) < 0.5 && Math.abs(UT.sigma(5000) - 0.8616) < 0.002, 'util: ISA (1013,25 hPa al nivel del mar; 5,1 °C y 843 hPa a 5 000 ft; densidad 86 %)');
// modelos
ok(MD.ids().length >= 10, 'hay al menos 10 modelos de partida (' + MD.ids().join(', ') + ')');
MD.ids().forEach((id) => {
  const d = MD.get(id), cs = d.controles, w = id + ': ';
  ok(d.nombre && d.resumen && Array.isArray(d.reconoce) && d.reconoce.every((x) => Object.prototype.toString.call(x) === '[object RegExp]'), w + 'nombre, resumen y reconoce');
  ok(new Set(cs.map((c) => c.id)).size === cs.length && cs.every((c) => c.id && c.etiqueta && ['rango', 'opcion', 'hora'].includes(c.tipo)), w + 'controles con id único, etiqueta y tipo válido');
  cs.filter((c) => c.tipo === 'rango').forEach((c) => ok(c.min <= c.valor && c.valor <= c.max && c.paso > 0 && (c.fijo || c.max > c.min), w + 'control ' + c.id + ': min ≤ valor ≤ max y paso > 0'));
  const base = {}; cs.forEach((c) => { base[c.id] = c.valor; });
  const p0 = id === 'franjas' ? { franjas: [{ nombre: 'A', desde: 0, hasta: 5, tono: 'ok' }, { nombre: 'B', desde: 5, hasta: 24, tono: 'bad' }] } : (id === 'riesgo-mitigacion' ? { base: { 'Charco de aceite': 80 } } : {});
  const o0 = MD.calc(id, base, p0);
  ok(d.salidas.every((s) => s.id && s.etiqueta && o0[s.id] !== undefined && (s.tipo === 'texto' || s.tipo === 'hora' || (typeof o0[s.id] === 'number' && isFinite(o0[s.id])))), w + 'cada salida existe y es finita con los valores por defecto');
  let finitos = true, tira = false;
  cs.filter((c) => c.tipo === 'rango' && !c.fijo).forEach((c) => [c.min, c.max, (c.min + c.max) / 2].forEach((v) => {
    const vv = Object.assign({}, base, { [c.id]: v });
    try { const o = MD.calc(id, vv, p0); d.salidas.forEach((s) => { if (typeof o[s.id] === 'number' && !isFinite(o[s.id])) finitos = false; }); } catch (e) { tira = true; }
  }));
  ok(finitos && !tira, w + 'las salidas siguen finitas en los extremos y el medio de cada control');
  (d.escenarios || []).forEach((e) => ok(e.nombre && Object.keys(e.valores).every((k) => cs.some((c) => c.id === k)), w + 'escenario «' + e.nombre + '» usa controles que existen'));
  if (d.grafico) ok(cs.some((c) => c.id === d.grafico.x) && d.grafico.y.every((y) => d.salidas.some((s) => s.id === y)), w + 'el gráfico usa un control y salidas que existen');
  (d.umbrales || []).forEach((u) => ok(u.siempre || o0[u.salida] !== undefined, w + 'umbral sobre una salida que existe'));
  if (d.consigna) ok(o0[d.consigna.salida] !== undefined, w + 'la consigna usa una salida que existe');
});
const A = (id, v) => MD.calc(id, v);
ok(A('sustentacion-alfa', { alfa: 17, vel: 47 }).nivel === 'perdida' && A('sustentacion-alfa', { alfa: 15.5, vel: 60 }).nivel === 'bocina' && A('sustentacion-alfa', { alfa: 4, vel: 70 }).nivel === 'normal', 'sustentacion-alfa: normal, bocina y pérdida según el ángulo');
ok(A('sustentacion-alfa', { alfa: 8, vel: 70 }).cl > A('sustentacion-alfa', { alfa: 4, vel: 70 }).cl && A('sustentacion-alfa', { alfa: 18, vel: 70 }).cl < A('sustentacion-alfa', { alfa: 16, vel: 70 }).cl, 'sustentacion-alfa: CL sube con el ángulo y cae pasada la pérdida');
ok(A('sustentacion-alfa', { alfa: 16, vel: 60 }).nivel === 'perdida' && A('sustentacion-alfa', { alfa: 16, vel: 100 }).nivel === 'perdida', 'la pérdida llega al mismo ángulo a cualquier velocidad');
ok(Math.abs(A('sustentacion-alfa', { alfa: 15, vel: 47 }).sust - A('sustentacion-alfa', { alfa: 15, vel: 47 }).peso) < 120, 'sustentacion-alfa: a 47 kt y ángulo cercano al crítico la sustentación ronda el peso');
eq([r2(A('factor-carga', { alabeo: 60 }).n, 2), r2(A('factor-carga', { alabeo: 0 }).n, 2), r2(A('factor-carga', { alabeo: 45 }).n, 2)], [2, 1, 1.41], 'factor-carga: n = 1 / cos(alabeo)');
ok(A('factor-carga', { alabeo: 60 }).vs > 47 * 1.4 && A('factor-carga', { alabeo: 60 }).vs < 47 * 1.42, 'factor-carga: la velocidad de pérdida crece con la raíz de n');
eq([r2(A('viento-cruzado', { pista: 36, dir: 90, vel: 12 }).cruzado), A('viento-cruzado', { pista: 36, dir: 90, vel: 12 }).lado], [12, 'derecha'], 'viento-cruzado: 12 kt desde el este en la pista 36 llegan por la derecha');
eq([A('porcentaje-umbral', { aciertos: 15 }).resultado, A('porcentaje-umbral', { aciertos: 14 }).resultado, A('porcentaje-umbral', { aciertos: 14 }).faltan, A('porcentaje-umbral', { aciertos: 15 }).pct], ['Aprobado', 'A repasar', 1, 75], 'porcentaje-umbral: 15 de 20 es justo el 75 %');
eq([A('clase-recreos', { duracion: 120, inicio: '19:00' }).recreos, A('clase-recreos', { duracion: 120, inicio: '19:00' }).fin, A('clase-recreos', { duracion: 60, inicio: '19:00' }).recreos, A('clase-recreos', { duracion: 40, inicio: '19:00' }).recreos], [2, '21:00', 1, 0], 'clase-recreos: floor((duración−1)/40) recreos');
eq([A('bernoulli', { v: 10 }).p, r2(A('venturi', { estrechamiento: 0 }).v, 1), r2(A('venturi', { estrechamiento: 60 }).p, 1), A('velocidad-perdida', { peso: 1600, altitud: 0 }).ias], [5, 5, 2.5, 47], 'bernoulli, venturi (V + P = 15) y velocidad de pérdida a 1 600 lb');
ok(A('velocidad-perdida', { peso: 1100, altitud: 0 }).ias < 47 && A('velocidad-perdida', { peso: 1600, altitud: 8000 }).tas > A('velocidad-perdida', { peso: 1600, altitud: 0 }).tas && A('velocidad-perdida', { peso: 1600, altitud: 8000 }).ias === 47, 'velocidad-perdida: menos peso, menos IAS; más altura, más TAS pero igual IAS');
eq([r2(A('sustentacion-formula', {}).L, 0), r2(A('sustentacion-formula', { vel: 40 }).L, 0), A('sustentacion-formula', { temp: 5 }).L > 100], [100, 25, true], 'sustentacion-formula: 100 % de referencia, un cuarto al bajar a la mitad la velocidad, más sustentación con aire frío');
eq([A('fuerzas-acelerador', { acelerador: 100, vel: 100 }).T === A('fuerzas-acelerador', { acelerador: 100, vel: 100 }).D, A('fuerzas-acelerador', { acelerador: 100, vel: 100 }).eq], [true, 100], 'fuerzas-acelerador: a plena potencia el equilibrio llega a 100 kt (T = D)');
eq([r2(A('isa', { altitud: 5000 }).temp, 1), r2(A('isa', { altitud: 0 }).inhg, 2)], [5.1, 29.92], 'isa: temperatura y presión estándar');
// venturi con los números del curso (base = 10: V = 10 y P = 5 en el tubo recto; la garganta lleva a V = 12 y P = 3)
{
  const vv = (e) => MD.calc('venturi', { estrechamiento: e }, { base: 10 });
  ok(vv(0).v === 10 && vv(0).p === 5 && Math.abs(vv(17).v - 12.05) < 0.01 && Math.abs(vv(17).p - 2.95) < 0.01 && vv(30).v + vv(30).p === 15, 'venturi con base 10: tubo recto V = 10 y P = 5; con 17 % de estrechamiento V ≈ 12 y P ≈ 3 (suma 15)');
  ok(MD.get('venturi').desdeDatos({ base: 10 }).params.base === 10 && MD.get('venturi').desdeDatos({}) === null && MD.get('venturi').desdeDatos({ base: 99 }) === null, 'venturi: desdeDatos toma la base de los datos y descarta la que no sirve');
}
// AER-01 y AER-02: ala-presion, descomposicion-fuerza, alfa-actitud, flujo-alfa, verano-invierno
eq([A('ala-presion', { curv: 100 }).Va, A('ala-presion', { curv: 100 }).Pa, A('ala-presion', { curv: 100 }).Pb, A('ala-presion', { curv: 100 }).F, A('ala-presion', { curv: 0 }).F, A('ala-presion', { curv: 50 }).Va], [12, 3, 5, 100, 0, 11], 'ala-presion: con la curvatura del curso la partícula de arriba va a V = 12 y P = 3, la de abajo sigue en P = 5; sin curvatura no hay fuerza');
ok([0, 30, 70, 100].every((k) => A('ala-presion', { curv: k }).Va + A('ala-presion', { curv: k }).Pa === 15), 'ala-presion: velocidad + presión = 15 a cualquier curvatura (Bernoulli del curso)');
eq([r2(A('descomposicion-fuerza', { alfa: 0 }).L, 1), r2(A('descomposicion-fuerza', { alfa: 0 }).D, 1), r2(A('descomposicion-fuerza', { alfa: 10 }).L, 1), r2(A('descomposicion-fuerza', { alfa: 10 }).D, 1)], [100, 0, 98.5, 17.4], 'descomposicion-fuerza: L = F cos α y D = F sen α (10°: 98,5 y 17,4)');
ok([2, 8, 16, 20].every((a) => Math.abs(Math.hypot(A('descomposicion-fuerza', { alfa: a }).L, A('descomposicion-fuerza', { alfa: a }).D) - 100) < 1e-9) && A('descomposicion-fuerza', { alfa: 16 }).D > A('descomposicion-fuerza', { alfa: 8 }).D, 'descomposicion-fuerza: L y D siempre componen F (Pitágoras) y D crece con el ángulo');
eq([A('alfa-actitud', { actitud: 8, trayectoria: 0 }).alfa, A('alfa-actitud', { actitud: 8, trayectoria: 5 }).alfa, A('alfa-actitud', { actitud: 8, trayectoria: -6 }).alfa, A('alfa-actitud', { actitud: 12, trayectoria: -6 }).nivel, A('alfa-actitud', { actitud: 8, trayectoria: 0 }).nivel], [8, 3, 14, 'perdida', 'normal'], 'alfa-actitud: α = actitud − trayectoria; con 12° de nariz y −6° de trayectoria se pasa el crítico');
eq([[0, 8, 12, 17, 19, 22].map((a) => A('flujo-alfa', { alfa: a }).turb), A('flujo-alfa', { alfa: 8 }).nivel, A('flujo-alfa', { alfa: 12 }).nivel, A('flujo-alfa', { alfa: 17 }).nivel, A('flujo-alfa', { alfa: 19 }).nivel], [[0, 12, 35, 70, 92, 100], 'pegado', 'avanza', 'critico', 'perdida'], 'flujo-alfa: la capa turbulenta crece con el ángulo (12, 35, 70, 92 %) y las cuatro fases del curso');
ok(A('flujo-alfa', { alfa: 16 }).cl > A('flujo-alfa', { alfa: 12 }).cl && A('flujo-alfa', { alfa: 19 }).cl < A('flujo-alfa', { alfa: 16 }).cl && A('flujo-alfa', { alfa: 16 }).aS === 16, 'flujo-alfa: CL llega al máximo en el crítico (16°) y cae después');
eq([r2(A('verano-invierno', {}).rho, 0), r2(A('verano-invierno', {}).masVel, 1), r2(A('verano-invierno', {}).carrera, 0), r2(A('verano-invierno', { tcalor: 5, tfrio: 5 }).masVel, 1)], [90, 5.3, 11, 0], 'verano-invierno: a 35 °C el aire tiene el 90 % de la densidad que a 5 °C y hay que ir un 5 % más rápido');
['ala-presion', 'descomposicion-fuerza', 'alfa-actitud', 'flujo-alfa', 'verano-invierno'].forEach((id) => ok(MD.has(id) && MD.get(id).prioridad > 90, id + ': registrado con prioridad baja (no le saca el modelo a los esbozos de otros módulos)'));
{
  const f = MD.get('franjas'), fr = [{ nombre: 'Leve', desde: 1, hasta: 3 }, { nombre: 'Media', desde: 1, hasta: 6 }, { nombre: 'Grave', desde: 6, hasta: 24 }];
  const dd = f.desdeDatos({ franjas: fr });
  ok(dd && dd.params.franjas.length === 3 && MD.calc('franjas', { cantidad: 6 }, dd.params).franja === 'Media y Grave' && MD.calc('franjas', { cantidad: 0 }, dd.params).franja === 'Sin franja' && f.desdeDatos({ franjas: [] }) === null, 'franjas: las franjas vienen de los datos (se solapan en el 6) y sin franjas no hay modelo');
}
eq([MD.inferir('Pérdida a cualquier velocidad α = α crítico'), MD.inferir('suma 15 balanza de bernoulli'), MD.inferir('el tubo se estrecha: estrechamiento y garganta'), MD.inferir('nada que ver'), MD.inferir('L ∝ ρ · V² · S')], ['sustentacion-alfa', 'bernoulli', 'venturi', null, 'sustentacion-formula'], 'inferir: elige el modelo por palabras (el más específico primero)');
// herramientas
ok(HR.ids().length >= 10, 'hay al menos 10 herramientas de cálculo (' + HR.ids().join(', ') + ')');
HR.ids().forEach((id) => {
  const d = HR.get(id), w = id + ': ';
  ok(d.nombre && d.resumen && Array.isArray(d.reconoce) && d.reconoce.every((x) => Object.prototype.toString.call(x) === '[object RegExp]'), w + 'nombre, resumen y reconoce');
  ok(d.entradas.every((e) => e.id && e.etiqueta && ['numero', 'opcion', 'fecha', 'hora', 'dia-hora'].includes(e.tipo)) && new Set(d.entradas.map((e) => e.id)).size === d.entradas.length, w + 'entradas con id único, etiqueta y tipo válido');
  (d.ejemplos || []).forEach((e) => { const r = HR.calc(id, Object.assign({ _hoy: '2026-10-29' }, e.valores), {}); ok(!r.error && r.salidas.length && r.pasos.length, w + 'el ejemplo «' + (e.nombre || '') + '» calcula sin error, con salidas y pasos'); });
  if (d.desafio && d.desafio.generar) for (let k = 0; k < 6; k++) {
    const v = d.desafio.generar(UT.rng(id + k)), r = HR.calc(id, v, id === 'hora-llegada' ? { reglas: { Vuelo: { antes: 30 }, Simulador: { antes: 15 }, 'Teórico': { antes: 0 } } } : {});
    ok(!r.error && r.salidas.some((s) => s.id === d.desafio.salida && (typeof s.valor === 'number' ? isFinite(s.valor) : typeof s.valor === 'string')), w + 'desafío ' + k + ': el problema generado se puede calcular y tiene la salida pedida');
  }
});
const C_ = (id, v, p) => HR.calc(id, v, p);
const sal = (r, id) => r.salidas.filter((s) => s.id === id)[0].valor;
eq([r2(sal(C_('conversion', { magnitud: 'Longitud', valor: 5000, de: 'ft', a: 'm' }), 'resultado'), 0), r2(sal(C_('conversion', { magnitud: 'Velocidad', valor: 65, de: 'kt', a: 'km/h' }), 'resultado'), 1), r2(sal(C_('conversion', { magnitud: 'Temperatura', valor: 15, de: '°C', a: '°F' }), 'resultado'), 0), r2(sal(C_('conversion', { magnitud: 'Peso', valor: 1600, de: 'lb', a: 'kg' }), 'resultado'), 0)], [1524, 120.4, 59, 726], 'conversion: ft a m, kt a km/h, °C a °F, lb a kg');
ok(C_('conversion', { magnitud: 'Longitud', valor: 1, de: 'ft', a: 'kt' }).error, 'conversion: unidades de magnitudes distintas dan un aviso');
eq([r2(sal(C_('viento-cruzado', { pista: 36, dir: 90, vel: 12 }), 'cruzado')), r2(sal(C_('viento-cruzado', { pista: 36, dir: 0, vel: 15 }), 'frente')), sal(C_('viento-cruzado', { pista: 36, dir: 0, vel: 15 }), 'cruzado') < 0.001], [12, 15, true], 'viento-cruzado (herramienta): componentes');
eq([sal(C_('tvd', { incognita: 'Tiempo', dist: 45, vel: 90 }), 'resultado'), sal(C_('tvd', { incognita: 'Distancia', vel: 100, tiempo: 25 }), 'resultado') > 41.6, sal(C_('tvd', { incognita: 'Velocidad', dist: 30, tiempo: 20 }), 'resultado')], [30, true, 90], 'tvd: tiempo, distancia y velocidad');
eq([sal(C_('combustible', { incognita: 'Autonomía', comb: 20, cons: 5, reserva: 30 }), 'resultado'), sal(C_('combustible', { incognita: 'Combustible necesario', cons: 6, tiempo: 90, reserva: 30 }), 'resultado')], [210, 12], 'combustible: autonomía utilizable y combustible necesario con reserva');
eq([r2(sal(C_('altitud-isa', { elev: 0, qnh: 1013.25, temp: 15 }), 'ap'), 0), r2(sal(C_('altitud-isa', { elev: 0, qnh: 1013.25, temp: 15 }), 'dt'), 0), r2(sal(C_('altitud-isa', { elev: 1000, qnh: 1003.25, temp: 20 }), 'ap'), 0)], [0, 0, 1270], 'altitud-isa: presión estándar = elevación; 10 hPa menos suman 270 ft');
eq([sal(C_('plazo', { inicio: '2026-03-15', cantidad: 18, unidad: 'meses', _hoy: '2026-10-29' }), 'limite'), C_('plazo', { inicio: '', cantidad: 18 }).error ? 'error' : 'ok', sal(C_('plazo', { inicio: '2026-03-15', cantidad: 18, unidad: 'meses', _hoy: '2026-10-29' }), 'consumido') > 40], ['miércoles 15 de septiembre de 2027', 'error', true], 'plazo: 18 meses desde el 15/3/2026; sin fecha avisa');
eq([sal(C_('fecha-minima', { base: '2026-08-04', dias: 3, prueba: '2026-08-05' }), 'minima'), sal(C_('fecha-minima', { base: '2026-08-04', dias: 3, prueba: '2026-08-05' }), 'puede'), sal(C_('fecha-minima', { base: '2026-08-04', dias: 3, prueba: '2026-08-07' }), 'puede')], ['viernes 7 de agosto de 2026', 'No: es antes de la fecha mínima', 'Sí, se puede'], 'fecha-minima: +3 días');
eq([sal(C_('anticipacion', { visita: 'miércoles 10:00', tramite: 'lunes 10:00' }), 'alcanza'), sal(C_('anticipacion', { visita: 'miércoles 10:00', tramite: 'martes 12:00' }), 'alcanza'), sal(C_('anticipacion', { visita: 'domingo 11:00', tramite: 'jueves 18:00' }), 'alcanza'), sal(C_('anticipacion', { visita: 'domingo 11:00', tramite: 'viernes 09:00' }), 'alcanza')], ['Sí, alcanza', 'No alcanza', 'Sí, alcanza', 'No alcanza'], 'anticipacion: 48 h entre semana; el jueves a más tardar para fin de semana');
eq([sal(C_('area-ala', { envergadura: 10, cuerda: 1.5 }), 'm2'), r2(sal(C_('area-ala', { envergadura: 10, cuerda: 1.5 }), 'ft2'), 0)], [15, 161], 'area-ala: m² y ft²');
eq([sal(C_('sesion-estudio', { hora: '19:00', bloques: 3 }), 'fin'), sal(C_('sesion-estudio', { hora: '19:00', bloques: 3 }), 'recreos'), sal(C_('sesion-estudio', { hora: '18:00', bloques: 2 }), 'fin'), sal(C_('sesion-estudio', { hora: '19:00', bloques: 1 }), 'recreos'), C_('sesion-estudio', { hora: '', bloques: 3 }).error ? 'error' : 'ok'], ['21:10', 2, '19:25', 0, 'error'], 'sesion-estudio: tres bloques de 40 min con dos recreos de 5 desde las 19:00 terminan a las 21:10');
{
  const hl = HR.get('hora-llegada').desdeDatos({ regla: { Vuelo: { antes: 30, hora_acordada_es: 'la puesta en marcha', haces: 'revisar el avión' }, Simulador: { antes: 15 }, 'Teórico': { antes: 0 } } });
  ok(hl && sal(C_('hora-llegada', { tipo: 'Vuelo', hora: '10:30' }, hl.params), 'llegada') === '10:00' && sal(C_('hora-llegada', { tipo: 'Simulador', hora: '15:00' }, hl.params), 'llegada') === '14:45' && HR.get('hora-llegada').desdeDatos({ regla: 3 }) === null, 'hora-llegada: vuelo 30 min antes, simulador 15; sin reglas no hay herramienta');
  const hr = HR.get('horario-reglas').desdeDatos({ reglas: [{ dias: 'lunes a viernes', desde: '06:00', hasta: '21:00', porton: '6A' }, { dias: 'sábado y domingo', desde: '06:00', hasta: '19:00', porton: '6A' }, { fuera: true, porton: 'Bomberos (24 horas)' }] });
  ok(hr && sal(C_('horario-reglas', { dia: 'domingo', hora: '19:30' }, hr.params), 'resultado') === 'Bomberos (24 horas)' && sal(C_('horario-reglas', { dia: 'viernes', hora: '20:00' }, hr.params), 'resultado') === '6A' && sal(C_('horario-reglas', { dia: 'sábado', hora: '18:00' }, hr.params), 'resultado') === '6A', 'horario-reglas: portón según día y hora');
  const co = HR.get('costo-opcion').desdeDatos({ reglas: { gabinete: 4, hechos: 2 }, unidad: 'UR' });
  ok(co && sal(C_('costo-opcion', { donde: 'gabinete', valor: 1500 }, co.params), 'pesos') === 6000 && C_('costo-opcion', { donde: 'hechos' }, co.params).salidas.length === 1, 'costo-opcion: UR por valor; sin valor sólo muestra las UR');
  const li = HR.get('lista-condicional').desdeDatos({ entradas: [{ id: 'lugar', opciones: ['a', 'b'] }, { id: 'edad', opciones: ['no', 'sí'] }], siempre: ['foto'], siLugar: { a: ['ayuno'] }, siEdad: { 'sí': ['ergometría'] } });
  ok(li && sal(C_('lista-condicional', { lugar: 'a', edad: 'sí' }, li.params), 'lista').join('|') === 'foto|ayuno|ergometría' && sal(C_('lista-condicional', { lugar: 'b', edad: 'no' }, li.params), 'lista').join('|') === 'foto', 'lista-condicional: la lista cambia con las respuestas');
  // tramite-licencia (INT-07-06): psicofísico + 3 días = cita en DINACIA; 4 UR en el gabinete y 2 UR con los estudios hechos; ergometría desde los 50
  const tl1 = C_('tramite-licencia', { fecha: '2026-08-04', lugar: 'en Medicina Aeronáutica', edad: 'no' }), tl2 = C_('tramite-licencia', { fecha: '2026-08-11', lugar: 'en mi mutualista', edad: 'sí' });
  ok(HR.has('tramite-licencia') && sal(tl1, 'cita') === 'viernes 7 de agosto de 2026' && sal(tl1, 'costo') === 4 && sal(tl2, 'cita') === 'viernes 14 de agosto de 2026' && sal(tl2, 'costo') === 2, 'tramite-licencia: la cita es 3 días después del psicofísico; 4 UR en el gabinete, 2 UR con los estudios hechos');
  ok(sal(tl1, 'medicina').includes('Ayuno de 12 horas') && !sal(tl1, 'medicina').some((x) => /Ergometr/.test(x)) && !sal(tl2, 'medicina').includes('Ayuno de 12 horas') && sal(tl2, 'medicina').some((x) => /Ergometr/.test(x)) && sal(tl2, 'medicina').some((x) => /tira/.test(x)), 'tramite-licencia: el ayuno sólo en Medicina Aeronáutica, la tira sólo en la mutualista y la ergometría sólo desde los 50');
  ok(sal(tl1, 'dinacia').length === 2 && sal(tl1, 'hitos').length === 3 && C_('tramite-licencia', { fecha: '' }).error, 'tramite-licencia: lo que se lleva a DINACIA (carta y foto), tres hitos y aviso si falta la fecha');
}
// figuras
ok(FG.ids().length >= 2, 'figuras propias: ' + FG.ids().join(', '));
FG.ids().forEach((id) => {
  const f = FG.get(id), ids = f.capas.map((c) => c.id), w = id + ': ';
  ok(/^0 0 \d+ \d+$/.test(f.viewBox) && new Set(ids).size === ids.length && f.capas.every((c) => c.nombre && typeof c.svg === 'string' && c.svg.length > 10), w + 'viewBox, capas con id único y dibujo');
  ok(f.capas.every((c) => (c.svg.match(/<\/?([a-z]+)/g) || []).every((t) => /^<\/?(g|path|line|rect|circle|ellipse|polygon|polyline|text|tspan)$/.test(t))), w + 'el SVG usa sólo formas y textos (nada de scripts, enlaces ni imágenes)');
  ok(!f.capas.some((c) => /on[a-z]+\s*=|style\s*=|href|javascript:/i.test(c.svg)), w + 'sin eventos, estilos en línea ni enlaces');
  ok(f.hotspots.length >= 4 && new Set(f.hotspots.map((x) => x.id)).size === f.hotspots.length && f.hotspots.every((x) => x.titulo && x.texto && isFinite(x.x) && isFinite(x.y) && (!x.capa || ids.includes(x.capa))), w + 'puntos con título, texto, coordenadas y capa válida');
});
eq([FG.paraNombres(['contorno', 'cuerda', 'presión', 'partículas']), FG.paraNombres(['planta', 'perfil']), FG.paraNombres(['uno', 'dos'])], ['perfil-ala', 'ala-planta', null], 'figuras: se elige por los nombres de las capas');
// figuras de Aerodinámica (AER-01 y AER-02): cada una sirve de entrada al diagrama y a la animación, y sus números son los de los modelos
{
  const AERF = ['cuatro-fuerzas', 'venturi-tubo', 'carburador-venturi', 'perfil-presiones', 'fuerza-descompuesta', 'angulo-ataque', 'actitud-alfa', 'flujo-aoa', 'perfiles-comparados', 'ala-rodajas', 'formula-sustentacion'];
  AERF.forEach((id) => {
    const d = Mot.get('diagrama').normalizar({ figura: id }, {}, {}), a = d && Mot.get('diagrama').normalizar(d, {}, {});
    ok(FG.has(id) && d && d.figura === id && d.hotspots.length >= 4 && d.modoPrueba === true && a && a.hotspots.length === d.hotspots.length, id + ': {figura:"' + id + '"} normaliza como diagrama (con modo prueba) y la salida vuelve a normalizarse');
    const an = Mot.get('animacion').normalizar({ figura: id, forma: 'figura', escenas: [{ t: 0, texto: 'uno', cambios: { mostrar: [FG.get(id).capas[0].id] } }, { t: 2, texto: 'dos', cambios: { ocultar: [FG.get(id).capas[0].id] } }] }, {}, {});
    ok(an && an.forma === 'figura' && an.figura === id, id + ': sirve de figura para una animación');
  });
  // las cuatro flechas de fuerza miden lo mismo (vuelo recto y nivelado: las fuerzas se igualan de a pares)
  const larga = (capa) => { const m = /x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/.exec(FG.get('cuatro-fuerzas').capas.find((c) => c.id === capa).svg); return Math.hypot(m[3] - m[1], m[4] - m[2]); };
  ok(['sustentacion', 'peso', 'traccion', 'resistencia'].every((k) => Math.abs(larga(k) - larga('sustentacion')) < 14) && larga('peso-menos') < larga('peso') && larga('sust-menos') < larga('sustentacion'), 'cuatro-fuerzas: sustentación, peso, tracción y resistencia miden lo mismo; las variantes "menor" son más cortas');
  // actitud-alfa: los rótulos de cada escena son los α del modelo (8° de actitud con trayectoria 0°, +5° y −6°)
  const nom = (id) => FG.get('actitud-alfa').capas.find((c) => c.id === id).nombre;
  eq(['nivelado', 'ascenso', 'descenso'].map((k) => +/α = (\d+)°/.exec(nom(k))[1]), [[0, 5, -6].map((g) => A('alfa-actitud', { actitud: 8, trayectoria: g }).alfa)][0], 'actitud-alfa: los α de las tres escenas son los del modelo alfa-actitud');
  // flujo-aoa: una capa por cada ángulo del curso y un punto por capa
  const fa = FG.get('flujo-aoa');
  ok(['t8', 't12', 't17', 't19'].every((k) => fa.capas.some((c) => c.id === k) && fa.hotspots.some((h) => h.capa === k)) && fa.capas.find((c) => c.id === 't8').visible === true, 'flujo-aoa: una capa y un punto por cada ángulo (8°, 12°, 16°–18°, 18°–20°)');
}
// normalizar sobre entradas raras: nunca tira, devuelve null u objeto
const raros = [undefined, null, 0, 'texto', [], [1, 2], {}, { a: 1 }, { escenas: 'x' }, { pasos: [1] }, { hotspots: [{}, {}] }, { entradas: [null, 3, 'x'] }, { modelo: 'no-existe' }, { herramienta: 'no-existe' }, { figura: 'no-existe', capas: [1] }, JSON.parse('{"pasos":[null,{},"a","b"]}')];
['simulador', 'calculadora', 'diagrama', 'animacion'].forEach((t) => {
  let tira = 0, malos = 0;
  raros.forEach((d) => { try { const r = Mot.get(t).normalizar(d, {}, { tipo: t, titulo: '', descripcion: '' }); if (!(r === null || typeof r === 'object')) malos++; } catch (e) { tira++; } });
  ok(tira === 0 && malos === 0, t + ': normalizar no tira error con entradas raras (' + raros.length + ' casos)');
});
eq(Mot.get('animacion').normalizar({ pasos: 3 }, {}, { descripcion: 'Secuencia paso a paso: 1) dos partículas con V = 10; 2) entra el perfil; 3) (a) pasa por el estrechamiento; 4) la presión baja.' }).escenas.map((e) => e.texto.slice(0, 8)), ['Dos part', 'Entra el', '(a) pasa', 'La presi'], 'animacion: "pasos: N" con "1) … 2) …" en la descripción');
ok(Mot.get('animacion').normalizar({ pasos: 3 }, {}, { descripcion: 'Una sola idea sin numeración' }) === null, 'animacion: "pasos: N" sin pasos numerados da null');
ok(Mot.get('animacion').normalizar({ bloques: [{ tipo: 'clase', min: 40 }, { tipo: 'recreo', min: 5 }] }, {}, {}).forma === 'bloques', 'animacion: bloques con minutos dan una línea de tiempo proporcional');
// esquema canónico: lo que devuelve normalizar sirve de entrada de nuevo
{
  const a = Mot.get('simulador').normalizar({ modelo: 'isa' }, {}, {}), b = Mot.get('simulador').normalizar(a, {}, {});
  ok(a && b && b.modelo === 'isa' && JSON.stringify(b.controles.map((c) => c.id)) === JSON.stringify(a.controles.map((c) => c.id)), 'simulador: {modelo:"isa"} alcanza y la salida de normalizar vuelve a normalizarse');
  const c1 = Mot.get('calculadora').normalizar({ herramienta: 'tvd' }, {}, {}), c2 = Mot.get('calculadora').normalizar(c1, {}, {});
  ok(c1 && c2 && c2.herramienta === 'tvd' && c2.entradas.length === c1.entradas.length && c1.desafio === true, 'calculadora: {herramienta:"tvd"} alcanza, tiene desafío y la salida vuelve a normalizarse');
  const d1 = Mot.get('diagrama').normalizar({ figura: 'perfil-ala' }, {}, {}), d2 = Mot.get('diagrama').normalizar(d1, {}, {});
  ok(d1 && d1.hotspots.length >= 6 && d1.modoPrueba === true && d2 && d2.hotspots.length === d1.hotspots.length, 'diagrama: {figura:"perfil-ala"} alcanza y la salida vuelve a normalizarse');
  const d3 = Mot.get('diagrama').normalizar({ viewBox: '0 0 300 200', capas: [{ id: 'a', nombre: 'A', svg: '<rect x="0" y="0" width="5" height="5"/>' }], hotspots: [{ id: 'x', x: 10, y: 20, titulo: 'X', texto: 't' }, { id: 'y', x: 90, y: 20, titulo: 'Y', texto: 'u', capa: 'a' }] }, {}, {});
  ok(d3 && d3.hotspots.length === 2 && d3.hotspots[0].forma === 'punto' && d3.capas.length === 1 && d3.modoPrueba === false, 'diagrama: esquema canónico con coordenadas (con 2 puntos el modo prueba no se ofrece por defecto)');
}
/** Invariantes de lo que devuelve cada normalizar (lo que el render da por sentado). */
function validarNormalizado(tipo, r, w) {
  const fin = (x) => typeof x === 'number' && isFinite(x);
  if (tipo === 'simulador') {
    ok(MD.has(r.modelo) && r.controles.length >= 1 && r.salidas.length >= 1 && new Set(r.controles.map((c) => c.id)).size === r.controles.length, w + ': modelo registrado, controles únicos y salidas');
    ok(r.controles.every((c) => c.tipo !== 'rango' || (fin(c.min) && fin(c.max) && c.max >= c.min && c.paso > 0 && c.valor >= c.min && c.valor <= c.max)) && r.salidas.every((s) => MD.get(r.modelo).salidas.some((x) => x.id === s.id)), w + ': controles en rango y salidas del modelo');
    ok((!r.grafico || r.controles.some((c) => c.id === r.grafico.x)) && r.escenarios.every((e) => Object.keys(e.valores).every((k) => r.controles.some((c) => c.id === k))), w + ': gráfico y escenarios apuntan a controles que existen');
    const o = MD.calc(r.modelo, Object.fromEntries(r.controles.map((c) => [c.id, c.valor])), r.params);
    ok(r.salidas.every((s) => o[s.id] !== undefined), w + ': el modelo calcula todas las salidas con los valores iniciales');
  } else if (tipo === 'calculadora') {
    ok(HR.has(r.herramienta) && r.entradas.length >= 1 && r.entradas.every((e) => e.id && e.etiqueta && e.tipo), w + ': herramienta registrada y entradas completas');
    ok(r.entradas.every((e) => e.tipo !== 'opcion' || HR.get(r.herramienta).entradas.some((x) => x.id === e.id && typeof x.opciones === 'function') || (Array.isArray(e.opciones) && e.opciones.length >= 2)), w + ': las entradas de opción traen sus opciones');
  } else if (tipo === 'diagrama') {
    const ids = r.hotspots.map((x) => x.id), vb = r.viewBox.split(' ').map(Number);
    ok(vb.length === 4 && vb.every(fin) && r.hotspots.length >= 2 && new Set(ids).size === ids.length && r.hotspots.every((x) => fin(x.x) && fin(x.y) && x.titulo && (!x.capa || r.capas.some((c) => c.id === x.capa))), w + ': viewBox, puntos con coordenadas, ids únicos y capas válidas');
    ok(r.hotspots.every((x) => x.x >= vb[0] && x.x <= vb[0] + vb[2] && x.y >= vb[1] && x.y <= vb[1] + vb[3]) && (r.conectores || []).every((c) => ids.includes(c[0]) && ids.includes(c[1])), w + ': todos los puntos caen dentro del dibujo');
  } else if (tipo === 'animacion') {
    const ts = r.escenas.map((e) => e.t);
    ok(r.escenas.length >= 2 && ts.every(fin) && ts.every((t, i) => i === 0 || t >= ts[i - 1]) && r.duracion > ts[ts.length - 1] && ['camino', 'bloques', 'figura'].includes(r.forma) && r.escenas.every((e) => e.texto), w + ': escenas con texto y tiempos crecientes, duración mayor que la última escena');
  }
}
// los esbozos del plan: cuántos de los cuatro tipos normalizan (INT-01..INT-08 y AER-01..AER-03). _teorico/ no se publica: si no está, se salta.
const PLAN = path.join(ROOT, '_teorico', 'mapa', 'plan');
if (fs.existsSync(path.join(PLAN, 'INT.json')) && fs.existsSync(path.join(PLAN, 'AER.json'))) {
  const cuenta = {}, falla = [], enAlcance = /^(INT-0[1-8]|AER-0[1-3])$/, tipos4 = ['simulador', 'calculadora', 'diagrama', 'animacion'];
  ['INT', 'AER'].forEach((m) => readJson(path.join(PLAN, m + '.json')).unidades.filter((u) => enAlcance.test(u.id)).forEach((u) => (u.lecciones || []).forEach((l) => (l.componentes || []).forEach((c) => {
    if (!tipos4.includes(c.tipo) || c.datos === undefined) return;
    const t = cuenta[c.tipo] = cuenta[c.tipo] || { n: 0, ok: 0 };
    let r = null, tiro = false;
    try { r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c); } catch (e) { tiro = true; }
    ok(!tiro, l.id + ': ' + c.tipo + ' «' + c.titulo + '» normaliza sin tirar error');
    t.n++;
    if (r) { t.ok++; validarNormalizado(c.tipo, r, l.id + ' ' + c.tipo); } else falla.push(l.id + ' ' + c.tipo + ' «' + c.titulo + '» ' + JSON.stringify(c.datos).slice(0, 70));
  }))));
  let N = 0, O = 0;
  tipos4.forEach((t) => { const x = cuenta[t] || { n: 0, ok: 0 }; N += x.n; O += x.ok; console.log('  plan · ' + t + ': ' + x.ok + ' de ' + x.n + ' normalizan (' + (x.n ? Math.round(100 * x.ok / x.n) : 0) + ' %)'); });
  console.log('  plan · TOTAL: ' + O + ' de ' + N + ' (' + Math.round(100 * O / N) + ' %)' + (falla.length ? '. Sin normalizar (usarán la reserva hasta la pasada de contenido):\n    - ' + falla.join('\n    - ') : ''));
  ok(N >= 50 && O / N >= 0.8, 'al menos el 80 % de los esbozos del plan para simulador, calculadora, diagrama y animación normalizan (' + Math.round(100 * O / N) + ' %)');
} else console.log('  (sin _teorico/mapa/plan: se salta el chequeo de los esbozos del plan)');

/* ------------------------------------------------------------------ componentes B (E3): clasificar, emparejar, situación, enlace 3D */
seccion('componentes B: clasificar, emparejar, situación, enlace 3D');
const TIPOS_B = ['clasificar', 'emparejar', 'situacion', 'enlace3d'];
TIPOS_B.forEach((t) => ok(Mot.has(t), 'componente "' + t + '" registrado'));
const AR = ES.arrastre, E3 = ES.enlace3d, EMP = ES.emparejar;
ok(!!AR && !!E3 && !!EMP && typeof AR.hacer === 'function', 'existen ES.arrastre (compartido), ES.enlace3d y ES.emparejar');
const NB = (t, d) => Mot.get(t).normalizar(JSON.parse(JSON.stringify(d)), ctxNode, { tipo: t, titulo: 'x', descripcion: 'y', datos: d });
// ---- arrastre: utilidades puras
eq(AR.mezclar([1, 2, 3, 4, 5, 6], 'a'), AR.mezclar([1, 2, 3, 4, 5, 6], 'a'), 'mezclar: la misma semilla da el mismo orden');
ok(JSON.stringify(AR.mezclar([1, 2, 3, 4, 5, 6], 'a')) !== JSON.stringify(AR.mezclar([1, 2, 3, 4, 5, 6], 'b')) || JSON.stringify(AR.mezclar([1, 2, 3, 4, 5, 6], 'a')) !== JSON.stringify(AR.mezclar([1, 2, 3, 4, 5, 6], 'c')), 'mezclar: otra semilla suele dar otro orden');
eq(AR.mezclar([3, 1, 2, 5, 4], 'x').slice().sort(), [1, 2, 3, 4, 5], 'mezclar: es una permutación (no pierde ni repite)');
{ const orig = [1, 2, 3]; AR.mezclar(orig, 's'); eq(orig, [1, 2, 3], 'mezclar: no modifica la lista original'); }
ok(AR.hash('abc') === AR.hash('abc') && AR.hash('abc') !== AR.hash('abd'), 'hash estable');
ok([0, 1, 2, 3, 4].every(() => { const r = AR.rng('z')(); return r >= 0 && r < 1; }), 'rng devuelve [0, 1)');
// ---- clasificar
{
  const base = { categorias: [{ id: 'a', nombre: 'Caja A' }, { id: 'b', nombre: 'Caja B' }], items: [{ texto: 'uno', categoria: 'a' }, { texto: 'dos', cat: 'Caja B', explicacion: 'porque sí' }, { texto: 'tres', cat: 'b' }] };
  const n = NB('clasificar', base);
  ok(n && n.categorias.length === 2 && n.items.length === 3 && n.items.every((x) => ['a', 'b'].includes(x.cat)), 'clasificar: acepta cat / categoria y resuelve la caja por id o por nombre');
  eq(NB('clasificar', n), n, 'clasificar: normalizar es idempotente');
  eq(NB('clasificar', { categorias: ['X', 'Y'], items: [{ texto: 'p', cat: 1 }, { texto: 'q', cat: 2 }] }).items.map((x) => x.cat), ['x', 'y'], 'clasificar: la caja puede ser un número (1 a n)');
  eq(NB('clasificar', { columnas: ['X', 'Y'], items: [{ texto: 'p', cat: 0 }, { texto: 'q', cat: 1 }] }).items.map((x) => x.cat), ['x', 'y'], 'clasificar: o desde 0 si hay un 0');
  const par = NB('clasificar', { factores: ['ángulo', 'coeficiente'], acciones: ['tirar', 'bajar flaps'] });
  ok(par && par.categorias.length === 2 && par.items[0].cat === par.categorias[0].id && par.items[1].cat === par.categorias[1].id, 'clasificar: dos listas paralelas (factores ↔ acciones)');
  ok(NB('clasificar', { columnas: ['A', 'B'], items: ['x', 'y', 'z'] }) === null, 'clasificar: fichas sin respuesta → null (reserva)');
  ok(NB('clasificar', { categorias: ['A'], items: [{ texto: 'x', cat: 'A' }, { texto: 'y', cat: 'A' }] }) === null, 'clasificar: una sola caja → null');
  ok(NB('clasificar', { categorias: ['A', 'B'], items: [{ texto: 'x', cat: 'A' }, { texto: 'y', cat: 'A' }] }) === null, 'clasificar: todas las fichas en la misma caja → null');
  eq(NB('clasificar', { categorias: ['A', 'B'], items: [{ texto: 'x', cat: 'A' }, { texto: 'y', cat: 'B' }, { texto: 'z', cat: 'inexistente' }] }).items.length, 2, 'clasificar: una ficha con caja inexistente se descarta');
  ok(NB('clasificar', { categorias: ['A', 'B'], items: [{ texto: 'x', cat: 'A', explicacion: 'Esto se confirma con el instructor: a confirmar' }, { texto: 'y', cat: 'B', explicacion: 'Sí, el instructor te lo explica.' }] }).items.map((x) => x.explicacion).join('|') === '|Sí, el instructor te lo explica.', 'clasificar: oculta las notas "a confirmar" del plan pero no las explicaciones que nombran al instructor');
  const fl = NB('clasificar', { flechas: [{ nombre: 'Sustentación', sentido: 'arriba' }, { nombre: 'Peso', sentido: 'abajo' }, { nombre: 'Tracción', sentido: 'adelante' }] });
  ok(fl && fl.categorias.length === 3 && fl.items.length === 3 && fl.items[0].cat === fl.categorias[0].id, 'clasificar: [{nombre, sentido}] → las cajas salen de los valores distintos (flechas por sentido)');
  ok(['x', 1, null, [], [[1]], { items: 5 }, { categorias: 'a', items: 'b' }].every((d) => NB('clasificar', d) === null), 'clasificar: datos basura → null sin tirar error');
}
// ---- emparejar
{
  const n = NB('emparejar', { pares: [['CIAC', 'Centro'], { a: 'MEC', b: 'Ministerio' }, { termino: 'DINACIA', definicion: 'Dirección' }] });
  ok(n && n.pares.length === 3 && n.pares.every((p) => p.a && p.b), 'emparejar: pares como [a,b], {a,b} y {termino, definicion}');
  eq(NB('emparejar', n), n, 'emparejar: normalizar es idempotente');
  eq(NB('emparejar', { pares: [['Peso', 'abajo', 'la Tierra'], ['Sustentación', 'arriba', 'el ala']] }).pares.map((p) => p.extra), ['la Tierra', 'el ala'], 'emparejar: un tercer elemento pasa a "extra" (se muestra al unir)');
  eq(NB('emparejar', { pares: { A: '1', B: '2' } }).pares.map((p) => p.a + p.b), ['A1', 'B2'], 'emparejar: un objeto {a: b}');
  eq(NB('emparejar', { terminos: ['x', 'y'], definiciones: ['1', '2'] }).pares.length, 2, 'emparejar: dos listas paralelas');
  eq(NB('emparejar', { pares: [['a', '1'], ['a', '1'], ['b', '2']] }).pares.length, 2, 'emparejar: un par repetido cuenta una vez');
  ok(NB('emparejar', { pares: [['solo', 'uno']] }) === null && NB('emparejar', { etiquetas: ['a', 'b'] }) === null && NB('emparejar', { pares: [['a', ''], ['b', 'c']] }) === null, 'emparejar: menos de 2 pares válidos → null');
  eq(NB('emparejar', { pares: [['a', '1'], ['b', '2']], distractoresB: ['1', 'x', 'y'] }).distractoresB, ['x', 'y'], 'emparejar: los distractores no pueden repetir una respuesta real');
  const muchos = Array.from({ length: 14 }, (_, i) => ['a' + i, 'b' + i]);
  const rd = EMP.rondas(NB('emparejar', { pares: muchos }).pares);
  ok(rd.length >= 2 && rd.every((x) => x.length <= 6) && rd.reduce((s, x) => s + x.length, 0) === 14, 'emparejar: más de 10 pares se reparten en rondas de hasta 6 sin perder ninguno');
  eq(EMP.rondas(NB('emparejar', { pares: muchos.slice(0, 8) }).pares).length, 1, 'emparejar: 8 pares caben en una ronda');
  ok(['x', 1, null, [], { pares: 5 }, { pares: [1, 2] }].every((d) => NB('emparejar', d) === null), 'emparejar: datos basura → null sin tirar error');
}
// ---- situación
{
  const esc = (nBase, extra) => Object.assign({ escenario: 'Pasa algo.', opciones: [{ texto: 'A', correcta: true, resultado: 'Bien.' }, { texto: 'B', correcta: false, resultado: 'Mal.' }, { texto: 'C', correcta: false }] }, extra || {});
  const n = NB('situacion', esc());
  ok(n && n.escenas.length === 1 && n.escenas[0].opciones.length === 3 && !n.escenas[0].multiple, 'situación: {escenario, opciones:[{texto, correcta, resultado}]} → una escena');
  eq(NB('situacion', n), n, 'situación: normalizar es idempotente');
  ok(NB('situacion', { escena: 'x', opciones: esc().opciones, leccionFinal: 'Lo que hay que llevarse.' }).leccionFinal === 'Lo que hay que llevarse.', 'situación: acepta el formato del plan {escena, opciones, leccionFinal}');
  const mv = NB('situacion', { escenario: 'q', motivos: [{ texto: 'a', valido: true }, { texto: 'b', valido: true }, { texto: 'c', valido: false }] });
  ok(mv && mv.escenas[0].multiple === true && mv.escenas[0].opciones.filter((o) => o.correcta).length === 2, 'situación: {motivos:[{texto, valido}]} → "elegí todas las correctas"');
  const seq = NB('situacion', { escenas: [esc(), esc({ escenario: 'Segunda' })] });
  ok(seq && seq.escenas.length === 2 && seq.escenas[0].id !== seq.escenas[1].id, 'situación: {escenas:[…]} → escenas con ids únicos');
  const ram = NB('situacion', { escenas: [{ id: 'ini', escenario: 'x', opciones: [{ texto: 'a', correcta: false, siguiente: 'malo' }, { texto: 'b', correcta: true, siguiente: 'fin' }, { texto: 'c', siguiente: 'no-existe' }] }, { id: 'malo', escenario: 'y', opciones: [{ texto: 'a', correcta: true }, { texto: 'b' }] }] });
  eq(ram.escenas[0].opciones.map((o) => o.siguiente), ['malo', 'fin', ''], 'situación: la rama "siguiente" se resuelve (id, "fin") y una rama que no existe se descarta');
  const cs = NB('situacion', { casos: [{ escenario: 'e1', respuesta: 'se anota', explicacion: 'x' }, { escenario: 'e2', respuesta: 'no se anota', explicacion: 'y' }, { escenario: 'e3', respuesta: 'se anota' }], mensajeFinal: 'Cierre.' });
  ok(cs && cs.escenas.length === 3 && cs.leccionFinal === 'Cierre.' && cs.escenas.every((e) => e.opciones.length === 2 && e.opciones.filter((o) => o.correcta).length === 1), 'situación: {casos:[{escenario, respuesta}]} → una escena por caso con las respuestas distintas como opciones');
  ok(NB('situacion', { casos: [{ escenario: 'a', correcta: 'jso' }, { escenario: 'b', correcta: 'jit' }, { escenario: 'c', correcta: 'cgc' }] }) === null, 'situación: respuestas que son siglas sueltas → null (nadie podría leerlas)');
  ok(NB('situacion', { casos: [{ escenario: 'a', correcta: 'reportarlo' }, { escenario: 'b', correcta: 'reportarlo' }] }) === null, 'situación: una sola respuesta distinta en todos los casos → null (no hay con qué armar opciones)');
  ok(NB('situacion', { escenario: 'x', opciones: [{ texto: 'a', correcta: true }, { texto: 'b', correcta: true }] }) === null, 'situación: todas correctas → null (no hay nada para decidir)');
  ok(NB('situacion', { escenario: 'x', opciones: [{ texto: 'solo una' }] }) === null && NB('situacion', { correcta: 'algo' }) === null, 'situación: sin opciones suficientes → null');
  const sapp = NB('situacion', { situacion: 'bocina-aproximacion' }), snop = NB('situacion', { situacion: 'no-existe' });
  ok(sapp && sapp.situacionApp === 'bocina-aproximacion' && snop === null, 'situación: {situacion:"id"} usa una situación viva de la app si existe');
  const vl = NB('situacion', { casos: [{ escenario: 'e1', validas: ['web', 'QR', 'buzón'] }, { escenario: 'e2', validas: ['web'] }, { escenario: 'e3', validas: ['QR', 'web'], explicacion: 'Con conexión.' }] });
  ok(vl && vl.escenas.length === 2 && vl.escenas.every((e) => e.multiple && e.opciones.length === 3 && e.opciones.some((o) => o.correcta) && e.opciones.some((o) => !o.correcta)), 'situación: {casos:[{escenario, validas}]} → "elegí todas" (el caso donde valen todas se descarta)');
  ok(['x', 1, null, [], { escenas: [] }, { casos: 'x' }, { escenas: [{}] }].every((d) => NB('situacion', d) === null), 'situación: datos basura → null sin tirar error');
  ok(!JSON.stringify(NB('situacion', esc({ opciones: [{ texto: 'A', correcta: true, resultado: 'Esto es a confirmar con el instructor' }, { texto: 'B' }] }))).includes('a confirmar'), 'situación: oculta las notas "a confirmar" del plan');
}
// ---- enlace 3D
{
  const n = NB('enlace3d', { destino: 'cabina', controles: ['rudder-pedals', 'toe-brakes', 'no-existe'] });
  eq(n && n.controles, ['rudder-pedals', 'toe-brakes'], 'enlace3d: descarta los controles que la app no tiene');
  eq(NB('enlace3d', n), n, 'enlace3d: normalizar es idempotente');
  ok(NB('enlace3d', { destino: 'cabina', controles: ['no-existe'] }) === null && NB('enlace3d', { aire: 'inventado' }) === null && NB('enlace3d', {}) === null, 'enlace3d: lo pedido no existe (o no hay nada) → null');
  ok(NB('enlace3d', { destino: 'exterior' }) !== null && NB('enlace3d', { destino: 'cabina' }) !== null, 'enlace3d: sólo un destino conocido → botón genérico');
  eq(NB('enlace3d', { control: 'asi', resaltar: ['altimeter', 'asi'] }).controles, ['asi', 'altimeter'], 'enlace3d: control + resaltar se juntan en controles (sin repetir)');
  eq(NB('enlace3d', { aire: 'perfil', capas: ['partículas', 'presión', 'fuerzas'] }).aire, { foco: 'wing', seccion: 'ala', capas: ['streamlines', 'pressure', 'forces'] }, 'enlace3d: aire:"perfil" abre la sección «El ala por dentro»; las capas en español se traducen');
  eq(NB('enlace3d', { modo: 'tunel', ias: 80 }).aire, { modo: 'tunel', ias: 80 }, 'enlace3d: modo / ias sueltos pasan al laboratorio');
  eq(NB('enlace3d', { experimento: 'perdida', pose: 'perdida' }).poses, ['perdida'], 'enlace3d: experimento + pose');
  eq(NB('enlace3d', { destino: 'cabina-y-exterior', controles: ['master'], poses: ['motor-on'], aire: 'prop' }).destino, 'cabina', 'enlace3d: "cabina-y-exterior" es cabina con poses');
  const c = NB('enlace3d', { controles: ['flap-switch'], preset: 'parked', estado: { flaps: 0, 'lights.beacon': false, 'ruta.mala': 1, '__proto__': 1 }, consigna: { texto: 'Flaps en 20', cumple: { flaps: 20, 'no.existe': 1 } } });
  ok(c.preset === 'parked' && JSON.stringify(c.estado) === JSON.stringify({ flaps: 0, 'lights.beacon': false }) && c.consigna.cumple.length === 1 && c.consigna.cumple[0].campo === 'flaps', 'enlace3d: preset, estado y consigna con rutas del estado del Sim; las rutas inexistentes o peligrosas se descartan');
  ok(NB('enlace3d', { destino: 'cabina', checklist: 'apagado', situacionRelacionada: 'magneto-prueba' }).situacion === 'magneto-prueba', 'enlace3d: situacionRelacionada → situacion');
  ok(NB('enlace3d', { destino: 'aire', experimento: 'inventado', aire: { vista: 'lado' } }).aire.vista === 'lado' && !('experimento' in NB('enlace3d', { destino: 'aire', experimento: 'inventado', aire: { vista: 'lado' } }).aire), 'enlace3d: un experimento inexistente se descarta pero la vista queda');
  ok(['x', 1, null, [], { controles: 5 }, { aire: 5 }].every((d) => NB('enlace3d', d) === null), 'enlace3d: datos basura → null sin tirar error');
  // consigna: el evaluador contra el estado real del Sim
  const s0 = C.Sim.createState(), cum = (cond, s) => E3.cumple(cond, s || s0);
  ok(cum([{ campo: 'flaps', eq: 0 }]) && !cum([{ campo: 'flaps', eq: 20 }]) && cum([{ campo: 'flaps', min: 0, max: 40 }]) && cum([{ campo: 'flaps', entre: [-1, 1] }]) && cum([{ campo: 'parkingBrake', eq: true }]) && cum([{ campo: 'ignition', eq: 'OFF' }]) && cum([{ campo: 'ignition', ne: 'BOTH' }]), 'consigna: eq / ne / min / max / entre, con números, booleanos y textos');
  ok(cum([{ campo: 'lights.beacon', eq: false }]) && cum([{ campo: 'air.onGround', eq: true }]) && !cum([{ campo: 'no.existe', eq: 1 }]) && !cum([]) && !cum([{ campo: 'flaps', eq: 0 }, { campo: 'throttle', min: 0.5 }]), 'consigna: rutas anidadas, ruta inexistente = no se cumple, sin condiciones = nunca, todas deben cumplirse');
  s0.flaps = 19.8; ok(cum([{ campo: 'flaps', eq: 20 }]) && !cum([{ campo: 'flaps', eq: 20, tol: 0.1 }]), 'consigna: eq numérico con tolerancia (por defecto, 3 %)');
  ok(!E3.rutaOk('__proto__') && !E3.rutaOk('a.constructor') && !E3.rutaOk('a..b') && !E3.rutaOk('1a') && E3.rutaOk('air.ias') && !E3.cumple([{ campo: 'constructor', eq: 1 }], s0), 'consigna: rutas peligrosas o mal formadas rechazadas');
}
// ---- los esbozos reales del plan para estos cuatro tipos (INT-01..INT-08 y AER-01..AER-03)
const sabeApp = { controles: new Set(C.DATA.controls.map((x) => x.id)), exps: new Set(C.DATA.labExperiments.map((x) => x.id)), chk: new Set(C.DATA.checklists.map((x) => x.id)), sits: new Set(C.DATA.situations.map((x) => x.id)), lecs: new Set(C.DATA.lessons.map((x) => x.id)), poses: new Set(C.Exterior.POSES.map((x) => x.id)), presets: new Set(['parked', 'runup', 'runway', 'cruise', 'approach']) };
const baseSim = C.Sim.createState();
function leerRuta(o, r) { return r.split('.').reduce((a, k) => (a !== undefined && a !== null && typeof a === 'object' && k in a ? a[k] : undefined), o); }
/** Todo lo que el dato de un enlace3d PIDE existe en la app (controles, poses, experimentos, checklists, situaciones, lecciones, presets, vistas, focos, capas, rutas del estado). */
function validarEnlace3d(datos, w) {
  const p = E3.referencias(datos);
  p.controles.forEach((x) => ok(sabeApp.controles.has(x), w + ': el control «' + x + '» existe en la app'));
  p.poses.forEach((x) => ok(sabeApp.poses.has(x), w + ': la pose «' + x + '» existe en exterior.js'));
  if (p.experimento) ok(sabeApp.exps.has(p.experimento), w + ': el experimento AIRE «' + p.experimento + '» existe');
  if (p.checklist) ok(sabeApp.chk.has(p.checklist), w + ': la checklist «' + p.checklist + '» existe');
  if (p.situacion) ok(sabeApp.sits.has(p.situacion), w + ': la situación «' + p.situacion + '» existe');
  if (p.leccionApp) ok(sabeApp.lecs.has(p.leccionApp), w + ': la lección de la app «' + p.leccionApp + '» existe');
  if (p.preset) ok(sabeApp.presets.has(p.preset), w + ': el escenario «' + p.preset + '» existe en Sim.PRESETS');
  if (p.aire.modo) ok(['tunel', 'vuelo'].includes(p.aire.modo), w + ': modo de AIRE «' + p.aire.modo + '»');
  if (p.aire.vista) ok(E3.VISTAS.includes(p.aire.vista), w + ': vista de AIRE «' + p.aire.vista + '»');
  if (p.aire.foco) ok(E3.FOCOS.includes(p.aire.foco), w + ': foco de AIRE «' + p.aire.foco + '»');
  p.aire.capas.forEach((x) => ok(E3.CAPAS.includes(x), w + ': capa de AIRE «' + x + '»'));
  Object.keys(p.estado || {}).forEach((k) => ok(E3.rutaOk(k) && leerRuta(baseSim, k) !== undefined, w + ': la ruta de estado «' + k + '» existe en Sim.createState()'));
  ((p.consigna && p.consigna.cumple) || []).forEach((c) => ok(E3.rutaOk(c.campo) && leerRuta(baseSim, c.campo) !== undefined, w + ': la consigna mira «' + c.campo + '», que existe en el estado del Sim'));
  const n = Mot.get('enlace3d').normalizar(JSON.parse(JSON.stringify(datos)), ctxNode, {});
  ok(n !== null, w + ': enlace3d normaliza');
  if (n) {
    eq(n.controles, p.controles, w + ': ningún control se descartó');
    eq(n.poses, p.poses, w + ': ninguna pose se descartó');
  }
}
function validarB(tipo, r, w) {
  if (tipo === 'clasificar') {
    const cs = r.categorias.map((c) => c.id);
    ok(r.categorias.length >= 2 && r.categorias.length <= 6 && new Set(cs).size === cs.length && r.categorias.every((c) => c.id && c.nombre), w + ': 2 a 6 cajas con id y nombre únicos');
    ok(r.items.length >= 2 && r.items.every((x) => x.texto && cs.includes(x.cat)) && new Set(r.items.map((x) => x.cat)).size >= 2, w + ': fichas con texto y caja válida, en al menos 2 cajas');
  } else if (tipo === 'emparejar') {
    ok(r.pares.length >= 2 && r.pares.every((p) => p.a && p.b) && new Set(r.pares.map((p) => p.id)).size === r.pares.length, w + ': al menos 2 pares con los dos lados');
  } else if (tipo === 'situacion') {
    if (r.situacionApp) { ok(sabeApp.sits.has(r.situacionApp), w + ': la situación de la app existe'); return; }
    const ids2 = r.escenas.map((e) => e.id);
    ok(new Set(ids2).size === ids2.length, w + ': ids de escena únicos');
    r.escenas.forEach((e) => {
      ok(e.contexto && e.opciones.length >= 2 && e.opciones.length <= 6 && e.opciones.every((o) => o.texto), w + ' ' + e.id + ': contexto y 2 a 6 opciones con texto');
      ok(e.opciones.every((o) => !o.siguiente || o.siguiente === 'fin' || ids2.includes(o.siguiente)), w + ' ' + e.id + ': las ramas apuntan a escenas que existen');
      const nOk = e.opciones.filter((o) => o.correcta).length;
      ok(nOk < e.opciones.length && (e.multiple ? nOk >= 1 : nOk <= 1), w + ' ' + e.id + ': ' + (e.multiple ? 'elegí todas: al menos una correcta' : 'a lo sumo una correcta') + ' y no todas');
    });
  } else if (tipo === 'enlace3d') {
    ok(['cabina', 'aire', 'exterior', 'vuelo'].includes(r.destino), w + ': destino conocido');
  }
}
{
  const cuenta = {}, falla = [];
  let inicio = pruebas;
  const enAlcance = /^(INT-0[1-8]|AER-0[1-3])$/;
  if (fs.existsSync(path.join(PLAN, 'INT.json')) && fs.existsSync(path.join(PLAN, 'AER.json'))) {
    ['INT', 'AER'].forEach((m) => readJson(path.join(PLAN, m + '.json')).unidades.filter((u) => enAlcance.test(u.id)).forEach((u) => (u.lecciones || []).forEach((l) => (l.componentes || []).forEach((c) => {
      if (!TIPOS_B.includes(c.tipo) || c.datos === undefined) return;
      const t = cuenta[c.tipo] = cuenta[c.tipo] || { n: 0, ok: 0 };
      let r = null, tiro = false;
      try { r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c); } catch (e) { tiro = true; }
      ok(!tiro, l.id + ': ' + c.tipo + ' «' + c.titulo + '» normaliza sin tirar error');
      t.n++;
      if (r) { t.ok++; validarB(c.tipo, r, l.id + ' ' + c.tipo); } else falla.push(l.id + ' ' + c.tipo + ' ' + JSON.stringify(c.datos).slice(0, 80));
      if (c.tipo === 'enlace3d') validarEnlace3d(c.datos, l.id + ' enlace3d «' + c.titulo + '»');
    }))));
    let N = 0, O = 0;
    TIPOS_B.forEach((t) => { const x = cuenta[t] || { n: 0, ok: 0 }; N += x.n; O += x.ok; console.log('  plan · ' + t + ': ' + x.ok + ' de ' + x.n + ' normalizan (' + (x.n ? Math.round(100 * x.ok / x.n) : 0) + ' %)'); });
    console.log('  plan · TOTAL B: ' + O + ' de ' + N + ' (' + Math.round(100 * O / N) + ' %)' + (falla.length ? '. Sin normalizar (usarán la reserva hasta la pasada de contenido):\n    - ' + falla.join('\n    - ') : ''));
    ok(N >= 60 && O / N >= 0.8, 'al menos el 80 % de los esbozos del plan para clasificar, emparejar, situación y enlace 3D normalizan (' + Math.round(100 * O / N) + ' %)');
    ok((cuenta.enlace3d || { n: 0, ok: 0 }).ok === (cuenta.enlace3d || { n: 0 }).n, 'todos los enlaces 3D del plan normalizan (los ids son los de la app)');
  } else console.log('  (sin _teorico/mapa/plan: se salta el chequeo de los esbozos del plan para los componentes B)');
  // y el contenido ya publicado en src/data/escuela/*.json: sus enlace3d apuntan a ids reales
  todasLasLecciones.forEach((l) => l.componentes.forEach((c, i) => { if (c.tipo === 'enlace3d') validarEnlace3d(c.datos, l.id + ' enlace3d #' + i); }));
}

/* ------------------------------------------------------------------ ejecutor (parte pura) */
seccion('ejecutor de lecciones (puro)');
todasLasLecciones.forEach((l) => {
  const pasos = LE.armar(l), w = l.id;
  ok(pasos[0].k === 'intro' && pasos[pasos.length - 1].k === 'resumen', w + ': empieza en la intro y termina en el resumen');
  const n = pasos.filter((p) => p.k === 'paso').length;
  const expl = l.componentes.filter((c) => !Mot.esPractica(c.tipo)).length;
  ok(n === Math.max(l.contenido.length, expl), w + ': un paso por punto clave (o por componente que sobra) → ' + n);
  const prac = pasos.find((p) => p.k === 'practica');
  ok(!!prac === l.componentes.some((c) => Mot.esPractica(c.tipo)) && (!prac || prac.comps.every((e) => Mot.esPractica(e.c.tipo))), w + ': la práctica tiene sólo los componentes que califican');
  const quiz = pasos.find((p) => p.k === 'quiz');
  ok(quiz && quiz.preguntas.length >= 3 && quiz.preguntas.length <= 5, w + ': mini-quiz de 3 a 5 preguntas');
  quiz.preguntas.forEach((q) => {
    const orig = l.preguntas.find((o) => o.pregunta === q.pregunta);
    ok(!!orig && q.opciones.length === 4 && q.opciones[q.correcta] === orig.opciones[orig.correcta] && [...q.opciones].sort().join('|') === [...orig.opciones].sort().join('|'), w + ': mezclado conserva las opciones y la correcta');
  });
  eq(LE.armar(l).find((p) => p.k === 'quiz').preguntas.map((q) => q.opciones.join('|')), quiz.preguntas.map((q) => q.opciones.join('|')), w + ': el mezclado es estable (misma semilla, mismo orden)');
  pasos.forEach((p, i) => { const k = LE.claveDe(pasos, i); ok(LE.idxDe(pasos, k) === i, w + ': clave de ruta ida y vuelta (' + JSON.stringify(k) + ')'); });
});
const lx = { id: 'XXX-01-01', contenido: ['a', 'b'], componentes: [{ tipo: 'diagrama', titulo: 't1' }, { tipo: 'simulador', titulo: 't2' }, { tipo: 'animacion', titulo: 't3' }, { tipo: 'clasificar', titulo: 't4' }], preguntas: [] };
const px = LE.armar(lx);
eq(px.map((p) => p.k + (p.n || '')), ['intro', 'paso1', 'paso2', 'paso3', 'practica', 'resumen'], 'armar: más componentes que puntos → un paso extra; sin preguntas no hay quiz');
ok(px[3].texto === null && px[3].comps.length === 1, 'armar: el paso extra no lleva texto');
ok(LE.armar({ id: 'XXX-01-02', contenido: ['a', 'b', 'c'], componentes: [], preguntas: [] }).filter((p) => p.k === 'paso').length === 3, 'armar: puntos sin componentes → pasos de sólo texto');
eq(LE.mezclar(['a', 'b', 'c', 'd'], 2, 'semilla').correcta, LE.mezclar(['a', 'b', 'c', 'd'], 2, 'semilla').correcta, 'mezclar es determinista');
ok(['a', 'b', 'c', 'd'].map((_, i) => LE.mezclar(['a', 'b', 'c', 'd'], 1, 's' + i)).every((m) => m.opciones[m.correcta] === 'b'), 'mezclar: la correcta sigue siendo la misma opción');
const muchas = { id: 'XXX-01-03', contenido: [], componentes: [], preguntas: Array.from({ length: 9 }, (_, i) => ({ pregunta: 'P' + i, opciones: ['a', 'b', 'c', 'd'], correcta: i % 4, explicacion: 'x' })) };
ok(LE.elegirPreguntas(muchas).length === 5, 'elegirPreguntas recorta a 5');
eq(LE.elegirPreguntas(muchas).map((q) => q.pregunta), LE.elegirPreguntas(muchas).map((q) => q.pregunta), 'elegirPreguntas es estable');
ok(LE.elegirPreguntas({ id: 'XXX-01-04', preguntas: [{ pregunta: 'x', opciones: ['a'], correcta: 0 }, { pregunta: '', opciones: ['a', 'b'], correcta: 0 }, { pregunta: 'ok', opciones: ['a', 'b'], correcta: 5 }] }).length === 0, 'elegirPreguntas descarta las preguntas mal formadas');

/* ------------------------------------------------------------------ store */
seccion('lectura editorial (puro): texto.js, tipos de punto clave, mini-marcado');
{
  const T = ES.texto;
  ok(T && ['markup', 'plano', 'balanceado', 'partir', 'parrafos', 'item', 'validarItem', 'tituloPaso', 'etiquetaTipo', 'listaLineas', 'layoutPaso', 'recorte', 'resumenPaso', 'resumenLeccion', 'promesa', 'minutosFalta', 'nbsp', 'p2'].every((k) => typeof T[k] === 'function'), 'ES.texto expone la parte pura');
  eq(T.TIPOS, ['texto', 'definicion', 'regla', 'dato', 'idea', 'ojo', 'ejemplo', 'lista'], 'los 8 tipos de punto clave');
  // mini-marcado
  eq(T.markup('La **ala** y ==esto== vale {{75|%}} o {{5}}').map((x) => x.t + ':' + x.v + (x.u !== undefined ? '|' + x.u : '')), ['txt:La ', 'term:ala', 'txt: y ', 'clave:esto', 'txt: vale ', 'dato:75|%', 'txt: o ', 'dato:5|'], 'markup: término, clave y cifra con unidad');
  eq(T.plano('La **ala** y ==esto== vale {{75|%}}'), 'La ala y esto vale 75 %', 'plano: sin marcado');
  ok(T.balanceado('a **b** c') && T.balanceado('{{1|kt}} ==x==') && !T.balanceado('a **b') && !T.balanceado('==x') && !T.balanceado('{{75|%') && !T.balanceado('75}} x') && !T.balanceado('**  **'), 'balanceado: detecta marcas sin cerrar o vacías');
  eq(T.markup('sin marcas **').map((x) => x.t), ['txt'], 'markup: una marca suelta queda como texto (no rompe)');
  // primera oración (lead)
  eq(T.partir('Primero esto es una oración completa. Luego sigue otra.'), { lead: 'Primero esto es una oración completa.', resto: 'Luego sigue otra.' }, 'partir: primera oración y resto');
  eq(T.partir('Una sola oración sin punto final'), { lead: 'Una sola oración sin punto final', resto: '' }, 'partir: una sola oración = todo lead');
  eq(T.partir('Mirá el plano en pp. 12 del curso, que explica todo. Después vemos más.').lead, 'Mirá el plano en pp. 12 del curso, que explica todo.', 'partir: no corta en abreviaturas (pp.)');
  eq(T.partir('Es la **regla. Nando** del recuento y vale mucho. Y sigue.').lead, 'Es la **regla. Nando** del recuento y vale mucho.', 'partir: no corta dentro de un marcado');
  eq(T.partir('Sí. Esto sigue siendo la primera oración larga. Y la tercera.').lead, 'Sí. Esto sigue siendo la primera oración larga.', 'partir: una oración muy cortita se une con la que sigue');
  eq(T.partir('Primer párrafo corto de una oración sola.\nSegundo párrafo. Con dos oraciones.'), { lead: 'Primer párrafo corto de una oración sola.', resto: 'Segundo párrafo. Con dos oraciones.' }, 'partir: el primer párrafo manda');
  eq(T.partir(''), { lead: '', resto: '' }, 'partir: vacío');
  eq(T.parrafos('a\n\n b \nc'), ['a', 'b', 'c'], 'parrafos');
  eq(T.listaLineas('Para entrar:\n1. Mostrá el DNI\n- Firmá\nEsperá'), { intro: 'Para entrar:', items: ['Mostrá el DNI', 'Firmá', 'Esperá'] }, 'listaLineas: introducción con ":" y viñetas');
  eq(T.listaLineas('uno\ndos').items, ['uno', 'dos'], 'listaLineas: sin introducción');
  ok(T.recorte('palabra '.repeat(40), 50).length <= 51 && /…$/.test(T.recorte('palabra '.repeat(40), 50)) && T.recorte('corto', 50) === 'corto', 'recorte');
  eq([T.p2(3), T.p2(12), T.nbsp('75 % y 3 min').split('').filter((c) => c.charCodeAt(0) === 160).length], ['03', '12', 2], 'p2 y nbsp');
  // puntos clave
  ok(T.item('  hola  ').texto === 'hola' && T.item('  hola  ').tipo === 'texto' && T.item('') === null && T.item('   ') === null && T.item(null) === null && T.item(5) === null && T.item([]) === null, 'item: string (formato viejo), vacíos y basura');
  const it = T.item({ titulo: ' T ', texto: 'x', tipo: 'regla', n: 3, ejemplo: 'e', ojo: 'o', dato: { valor: 75, unidad: '%', etiqueta: 'Mínimo' } });
  eq([it.titulo, it.tipo, it.n, it.ejemplo, it.ojo, it.dato], ['T', 'regla', '3', 'e', 'o', { valor: '75', unidad: '%', etiqueta: 'Mínimo' }], 'item: objeto completo normalizado');
  ok(T.item({ tipo: 'inventado', texto: 'x' }).tipo === 'texto' && T.item({ tipo: 'dato', dato: { valor: 5 } }).dato.valor === '5' && T.item({ titulo: 'solo título' }) === null && T.item({ tipo: 'dato', dato: { valor: '' } }) === null, 'item: tipo desconocido cae a texto; sin nada que mostrar = null');
  // validación
  const v = (x) => T.validarItem(x).length;
  ok(v('un texto') === 0 && v({ texto: 'x' }) === 0 && v({ titulo: 'Portón 6A', tipo: 'definicion', texto: 'x', ejemplo: 'y' }) === 0 && v({ tipo: 'dato', dato: { valor: 75, unidad: '%' } }) === 0 && v({ tipo: 'lista', texto: 'a\nb' }) === 0 && v({ tipo: 'idea', texto: 'x', ojo: 'y' }) === 0, 'validarItem: acepta los formatos buenos');
  ok(v('') > 0 && v('a **b') > 0 && v(5) > 0 && v({ texto: 'x', tipo: 'inventado' }) > 0 && v({ tipo: 'dato', texto: 'x' }) > 0 && v({ tipo: 'dato', dato: { unidad: '%' } }) > 0 && v({ tipo: 'definicion', texto: 'x' }) > 0 && v({ tipo: 'lista', texto: 'una sola' }) > 0 && v({ texto: 'x', raro: 1 }) > 0 && v({ texto: 'x', ojo: 'a ==b' }) > 0 && v({ tipo: 'ojo', texto: 'x', ojo: 'y' }) > 0 && v({ tipo: 'regla' }) > 0 && v({ texto: 7 }) > 0, 'validarItem: rechaza tipo desconocido, dato sin valor, definición sin título, lista de una línea, marcado sin cerrar, campos raros');
  // título del paso, rótulo, layout
  eq([T.tituloPaso({ titulo: 'El **mínimo**' }, { titulo: 'Comp' }, 2), T.tituloPaso({ titulo: '' }, { titulo: 'Comp' }, 2), T.tituloPaso(T.item('x'), null, 4), T.tituloPaso(null, { titulo: '  ' }, 1)], ['El mínimo', 'Comp', 'Punto clave 4', 'Punto clave 1'], 'tituloPaso: titulo → título del componente → «Punto clave N»');
  eq([T.etiquetaTipo({ tipo: 'dato' }, 'Simulador'), T.etiquetaTipo({ tipo: 'texto' }, 'Simulador'), T.etiquetaTipo(null, ''), T.etiquetaTipo({ tipo: 'ojo' }, '')], ['Dato', 'Simulador', 'Punto clave', 'Ojo'], 'etiquetaTipo');
  eq([T.layoutPaso(T.item('x'), []), T.layoutPaso(null, [{ tipo: 'simulador' }]), T.layoutPaso(T.item('x'), [{ tipo: 'diagrama' }]), T.layoutPaso(T.item('x'), [{ c: { tipo: 'enlace3d' } }]), T.layoutPaso(T.item('x'), [{ tipo: 'clasificar' }]), T.layoutPaso(T.item('x'), [{ tipo: 'situacion' }, { tipo: 'calculadora' }])], ['texto', 'solo', 'dos', 'dos', 'centro', 'dos'], 'layoutPaso: texto / solo / dos columnas / centrada');
  // resumen, promesa, tiempo
  eq([T.resumenPaso({ resumen: ['a', ' b '] }, T.item('x'), 1), T.resumenPaso({ resumen: ['a'] }, T.item('x'), 3), T.resumenPaso({ resumen: 'una' }, T.item('x'), 0), T.resumenPaso({}, T.item({ texto: 'x', resumen: 'del ítem' }), 0)], ['b', '', '', 'del ítem'], 'resumenPaso: lista por punto clave o el campo del ítem');
  eq([T.resumenLeccion({ resumen: ' una ' }), T.resumenLeccion({ resumen: ['a'] }), T.promesa({ resumen: 'Mi frase.' }, 8), T.promesa({ objetivos: ['Explicar cómo son los tests.'] }, 8), T.promesa({ objetivos: ['ADS-B es útil'] }, 0), T.promesa({ titulo: 'Sólo título' }, 0)], ['una', '', 'Mi frase.', 'En unos 8 minutos vas a poder explicar cómo son los tests.', 'En esta lección vas a poder ADS-B es útil.', 'Sólo título'], 'promesa: resumen, primer objetivo o título');
  eq([T.minutosFalta(8, 0, 9), T.minutosFalta(8, 4, 9), T.minutosFalta(8, 8, 9), T.minutosFalta(8, 99, 9), T.minutosFalta(0, 3, 9), T.minutosFalta(8, 0, 1)], [8, 4, 0, 0, 0, 8], 'minutosFalta: de todos los minutos a cero');
}

seccion('lectura editorial (puro): el contenido real y el armado de pasos');
{
  const T = ES.texto;
  const tiposVistos = {};
  todasLasLecciones.forEach((l) => {
    const w = l.id;
    l.contenido.forEach((x, i) => { const pr = T.validarItem(x); ok(pr.length === 0, w + ' punto clave ' + (i + 1) + ': ' + pr.join('; ')); if (x && typeof x === 'object') tiposVistos[x.tipo || 'texto'] = (tiposVistos[x.tipo || 'texto'] || 0) + 1; });
    ok(l.contenido.every((x) => T.item(x) !== null), w + ': todos los puntos clave tienen algo que mostrar');
    if (l.resumen !== undefined) ok((typeof l.resumen === 'string' && T.balanceado(l.resumen) && l.resumen.trim().length > 0) || (Array.isArray(l.resumen) && l.resumen.length <= l.contenido.length && l.resumen.every((r) => typeof r === 'string' && T.balanceado(r))), w + ': resumen = texto o una línea por punto clave');
    const pasos = LE.armar(l);
    pasos.filter((p) => p.k === 'paso').forEach((p) => ok(typeof p.titulo === 'string' && p.titulo.trim() && p.n >= 1, w + ' paso ' + p.n + ': tiene título'));
    const ind = LE.indice(pasos);
    ok(ind.length === pasos.length && ind.every((e, i) => e.idx === i && e.titulo) && ind[0].k === 'intro' && ind[ind.length - 1].k === 'resumen', w + ': el índice de la lección tiene una entrada con título por etapa');
    ok(LE.llevas(pasos, l).every((x) => x.texto && x.titulo && x.texto.length <= 175), w + ': "Lo que te llevás" con texto corto');
  });
  // las tres lecciones de muestra (INT.json) usan los tipos nuevos y mantienen sus componentes y preguntas
  const lec = (id) => todasLasLecciones.find((l) => l.id === id);
  const tipos = (id) => lec(id).contenido.map((x) => (typeof x === 'object' ? x.tipo || 'texto' : 'texto'));
  const extras = (id, k) => lec(id).contenido.some((x) => typeof x === 'object' && x[k]);
  ok(tipos('INT-02-02').includes('dato') && tipos('INT-02-02').includes('regla') && lec('INT-02-02').contenido.some((x) => x.dato && x.dato.valor === 75), 'INT-02-02: dato (75 %) y regla');
  ok(tipos('INT-03-02').includes('idea') && extras('INT-03-02', 'ojo') && tipos('INT-03-02').filter((t) => t === 'regla').length >= 4, 'INT-03-02: idea + ojo + reglas numeradas');
  ok(tipos('INT-04-01').includes('definicion') && tipos('INT-04-01').includes('lista') && extras('INT-04-01', 'ejemplo') && tipos('INT-04-01').includes('ojo'), 'INT-04-01: definición + ejemplo + lista');
  ['INT-02-02', 'INT-03-02', 'INT-04-01'].forEach((id) => ok(lec(id).componentes.length >= 3 && lec(id).preguntas.length >= 3 && lec(id).resumen, id + ': conserva componentes y preguntas y tiene resumen'));
  ok(Object.keys(tiposVistos).length >= 5, 'el contenido real usa varios tipos de punto clave (' + Object.keys(tiposVistos).join(', ') + ')');
  // armar con objetos: título, tipo, número de regla, texto
  const px = LE.armar({ id: 'XXX-02-01', contenido: ['Texto viejo. Con dos oraciones.', { titulo: 'Mi regla', tipo: 'regla', texto: 'a' }, { tipo: 'regla', texto: 'b' }, { tipo: 'dato', dato: { valor: 5, unidad: 'kt' } }], componentes: [{ tipo: 'diagrama', titulo: 'Figura 1' }, { tipo: 'simulador', titulo: 'Sim 2' }], preguntas: [] });
  const pp = px.filter((p) => p.k === 'paso');
  eq(pp.map((p) => p.titulo), ['Figura 1', 'Mi regla', 'Punto clave 3', 'Punto clave 4'], 'armar: título = titulo del punto, o del componente, o «Punto clave N»');
  eq(pp.map((p) => p.tipo), ['texto', 'regla', 'regla', 'dato'], 'armar: tipo de cada paso');
  eq(pp.map((p) => p.reglaN), [0, 1, 2, 0], 'armar: las reglas se numeran solas');
  ok(pp[0].texto === 'Texto viejo. Con dos oraciones.' && pp[0].item.obj === false && pp[3].texto === '' && pp[3].item.dato.valor === '5', 'armar: un texto viejo sigue siendo texto; el dato sin texto es válido');
  eq(LE.indice(px).map((e) => e.num + '|' + e.titulo), ['|Antes de empezar', '01|Figura 1', '02|Mi regla', '03|Punto clave 3', '04|Punto clave 4', '|Resumen'], 'indice: número y título de cada etapa');
  eq(LE.llevas(px, { resumen: ['Línea uno'] }).map((x) => x.n + ':' + x.texto), ['1:Línea uno', '2:a', '3:b', '4:5 kt'], 'llevas: resumen del punto, primera oración o el dato');
  { const pl = LE.armar({ id: 'XXX-01-01', contenido: [{ titulo: 'Los pasos', tipo: 'lista', texto: 'Para entrar:\n1. Mostrá el DNI\n2. Firmá' }], componentes: [], preguntas: [] }), ll = LE.llevas(pl, {}); ok(ll.length === 1 && ll[0].texto === 'Para entrar: Mostrá el DNI' && !/:$/.test(ll[0].texto), 'llevas: una lista sin resumen propio no queda con los dos puntos colgando'); }
}

seccion('calidad del contenido publicado (INT y AER-01..03): tipos, títulos, preguntas, componentes');
{
  const T = ES.texto;
  // el contenido terminado: INT completa (37 lecciones) y AER-01..03 (17)
  const lecIdx = (modId, unidades) => ix.modulos.find((m) => m.id === modId).unidades.filter((u) => !unidades || unidades.includes(u.id)).flatMap((u) => u.lecciones);
  const terminadas = lecIdx('INT').concat(lecIdx('AER', ['AER-01', 'AER-02', 'AER-03']));
  eq([lecIdx('INT').length, lecIdx('AER', ['AER-01', 'AER-02', 'AER-03']).length], [37, 17], 'INT tiene 37 lecciones y AER-01..03 tienen 17');
  ok(terminadas.every((l) => l.detalle === 'completo'), 'las 54 lecciones de INT y AER-01..03 están "completo" en el índice (' + terminadas.filter((l) => l.detalle !== 'completo').map((l) => l.id).join(', ') + ')');
  const terminadasIds = new Set(terminadas.map((l) => l.id));
  const lecciones = todasLasLecciones.filter((l) => terminadasIds.has(l.id));
  ok(lecciones.length === 54, 'los archivos de módulo traen las 54 lecciones terminadas (' + lecciones.length + ')');
  const palabras = (s) => T.plano(String(s || '')).trim().split(/\s+/).filter(Boolean).length;
  const SOLO_TITULO_GENERICO = /^punto clave\s*\d*$/i;
  lecciones.forEach((l) => {
    const w = l.id, xs = l.contenido, tipos = xs.map((x) => (x && typeof x === 'object' ? (x.tipo || 'texto') : 'texto'));
    ok(!('notas' in l), w + ': sin notas');
    ok(xs.every((x) => x && typeof x === 'object'), w + ': todos los puntos clave son objetos (formato editorial)');
    xs.forEach((x, i) => {
      if (!x || typeof x !== 'object') return;
      const n = palabras(x.titulo), tt = x.tipo || 'texto';
      ok(typeof x.titulo === 'string' && x.titulo.trim() && !SOLO_TITULO_GENERICO.test(x.titulo.trim()), w + ' punto ' + (i + 1) + ': título real (no «Punto clave N»)');
      ok(tt === 'definicion' ? (n >= 1 && n <= 8) : (n >= 3 && n <= 7), w + ' punto ' + (i + 1) + ': el título «' + x.titulo + '» tiene de 3 a 7 palabras (la definición lleva el término: ' + n + ')');
      ok(T.TIPOS.includes(tt), w + ' punto ' + (i + 1) + ': tipo válido (' + tt + ')');
      if (x.dato !== undefined) ok(x.dato && String(x.dato.valor === undefined ? '' : x.dato.valor).trim() && String(x.dato.etiqueta || '').trim(), w + ' punto ' + (i + 1) + ': el dato lleva valor y etiqueta');
      if (tt === 'dato') ok(!!x.dato, w + ' punto ' + (i + 1) + ': el punto de tipo dato trae su dato');
    });
    let racha = 1, maxRacha = 1;
    tipos.forEach((t, i) => { racha = i && t === tipos[i - 1] ? racha + 1 : 1; maxRacha = Math.max(maxRacha, racha); });
    ok(maxRacha <= 2, w + ': no hay más de dos puntos seguidos del mismo tipo (racha ' + maxRacha + ': ' + tipos.join(' · ') + ')');
    if (xs.length >= 4) ok(new Set(tipos).size >= 3, w + ': con ' + xs.length + ' puntos usa al menos 3 tipos distintos (' + [...new Set(tipos)].join(', ') + ')');
    ok(tipos.filter((t) => t === 'idea').length <= 1, w + ': a lo sumo una idea');
    ok((typeof l.resumen === 'string' && l.resumen.trim()) || (Array.isArray(l.resumen) && l.resumen.length), w + ': tiene resumen');
    // glosario: términos únicos dentro de la lección
    const gl = (l.glosario || []).map((g) => g.termino.trim().toLowerCase());
    ok(new Set(gl).size === gl.length, w + ': glosario sin términos repetidos');
    // preguntas: 3 a 5
    ok(l.preguntas.length >= 3 && l.preguntas.length <= 5, w + ': de 3 a 5 preguntas (' + l.preguntas.length + ')');
    // la reserva (normalizar → null) no es aceptable para los ocho tipos implementados; cada lección trae algo interactivo que funciona
    let buenos = 0;
    l.componentes.forEach((c, i) => {
      if (!Mot.TIPOS_P1.includes(c.tipo) || !Mot.has(c.tipo)) return;
      let r = null; try { r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c); } catch (e) { r = null; }
      ok(r !== null, w + ': el componente ' + i + ' (' + c.tipo + ' «' + c.titulo + '») no cae a la tarjeta de reserva');
      if (r !== null) buenos++;
    });
    ok(buenos >= 1, w + ': al menos un componente implementado que funciona');
    // animaciones y diagramas sobre una figura propia: todo id que nombran las escenas existe en la figura
    l.componentes.forEach((c) => {
      if (c.tipo !== 'animacion' || !c.datos || c.datos.forma !== 'figura' || !FG.has(c.datos.figura)) return;
      const capas = new Set(FG.get(c.datos.figura).capas.map((k) => k.id)), malos = [];
      (c.datos.escenas || []).forEach((e, j) => {
        const cm = e.cambios || {};
        ['mostrar', 'ocultar', 'resaltar', 'atenuar'].forEach((k) => (cm[k] || []).forEach((id) => { if (!capas.has(id)) malos.push('escena ' + (j + 1) + ' ' + k + ' ' + id); }));
        ['mover', 'rotar', 'escala', 'opacidad', 'texto'].forEach((k) => Object.keys(cm[k] || {}).forEach((id) => { if (!capas.has(id)) malos.push('escena ' + (j + 1) + ' ' + k + ' ' + id); }));
      });
      eq(malos, [], w + ': las escenas de «' + c.titulo + '» sólo nombran capas de la figura ' + c.datos.figura);
    });
  });
  // preguntas por módulo: la correcta repartida entre A, B, C y D (ninguna letra pasa del 40 %) y que no sea la opción más larga de forma sistemática (≤ 45 %)
  ['INT', 'AER'].forEach((mid) => {
    const qs = lecciones.filter((l) => l.id.startsWith(mid + '-')).flatMap((l) => l.preguntas.map((q) => ({ w: l.id, q })));
    const cuenta = [0, 0, 0, 0]; let masLarga = 0;
    qs.forEach(({ q }) => {
      cuenta[q.correcta]++;
      const lens = q.opciones.map((o) => o.length), max = Math.max(...lens);
      if (lens[q.correcta] === max && lens.filter((n) => n === max).length === 1) masLarga++;
    });
    const reparto = cuenta.map((n) => Math.round(100 * n / qs.length));
    ok(Math.max(...cuenta) / qs.length <= 0.40, mid + ': la opción correcta está repartida (A/B/C/D: ' + cuenta.join('/') + ' = ' + reparto.join(' / ') + ' %, ninguna letra pasa del 40 %)');
    ok(masLarga / qs.length <= 0.45, mid + ': la correcta es la opción más larga en ' + masLarga + ' de ' + qs.length + ' preguntas (' + Math.round(100 * masLarga / qs.length) + ' %, tope 45 %)');
  });
  // AER-03: los modelos y las figuras nuevas (la pérdida)
  ok(['aviso-perdida', 'recuperacion-perdida'].every((id) => MD.has(id) && MD.get(id).prioridad > 90), 'aviso-perdida y recuperacion-perdida: registrados con prioridad baja');
  const AV = (v) => MD.calc('aviso-perdida', { vel: v });
  eq([70, 54, 49, 46].map((v) => AV(v).nivel), ['normal', 'bocina', 'buffet', 'perdida'], 'aviso-perdida: normal a 70 kt, bocina a 54, bocina con vibración a 49 y pérdida a 46');
  ok(AV(40).alfa > AV(47).alfa && AV(47).alfa > AV(60).alfa && AV(60).alfa > AV(80).alfa && Math.abs(AV(47).alfa - MD.alfaPerdida(0)) < 0.5 && AV(40).alfa <= 22 && AV(55).nivel === 'normal', 'aviso-perdida: al frenar el ángulo necesario sube y a la velocidad de pérdida (47 kt) está en el crítico');
  const RC = (n, p, t) => MD.calc('recuperacion-perdida', { nariz: n, potencia: p, tiro: t });
  const ABAJO = 'Bajarla bajo el horizonte', ARRIBA = 'Dejarla arriba', TODA = 'Toda la potencia', RAL = 'Ralentí';
  eq([RC(ARRIBA, TODA, 62).nivel, RC(ABAJO, TODA, 50).nivel, RC(ABAJO, TODA, 62).nivel, RC(ABAJO, RAL, 62).nivel, RC(ABAJO, TODA, 85).nivel], ['perdida', 'secundaria', 'ok', 'mucha', 'mucha'], 'recuperacion-perdida: sin bajar la nariz sigue la pérdida; tirar a 50 kt da pérdida secundaria; nariz + potencia + 62 kt recupera; sin potencia o tarde se pierde mucha altura');
  ok(Math.round(RC(ABAJO, TODA, 62).vmin) === 58 && RC(ABAJO, TODA, 57).nivel === 'secundaria' && RC(ABAJO, TODA, 58).nivel === 'ok' && RC(ABAJO, TODA, 62).altura < RC(ABAJO, RAL, 62).altura && RC(ABAJO, TODA, 62).altura < RC(ABAJO, TODA, 85).altura, 'recuperacion-perdida: se puede tirar a partir de unos 58 kt; con toda la potencia y sin esperar de más se pierde menos altura');
  const NF = ['curva-sustentacion', 'aterrizaje-alfa', 'tres-perdidas', 'bocina-ala', 'recuperacion-perdida'];
  NF.forEach((id) => {
    const d = Mot.get('diagrama').normalizar({ figura: id }, {}, {}), an = Mot.get('animacion').normalizar({ figura: id, forma: 'figura', escenas: [{ t: 0, texto: 'uno', cambios: { mostrar: [FG.get(id).capas[0].id] } }, { t: 2, texto: 'dos', cambios: { ocultar: [FG.get(id).capas[0].id] } }] }, {}, {});
    ok(FG.has(id) && d && d.figura === id && d.hotspots.length >= 4 && d.modoPrueba === true && an && an.forma === 'figura', id + ': normaliza como diagrama (con modo prueba) y sirve de figura para una animación');
  });
  // tres-perdidas: los números del dibujo son los del modelo velocidad-perdida
  {
    const num = (capa) => (FG.get('tres-perdidas').capas.find((c) => c.id === capa).svg.match(/\d+ kt/g) || []).map((s) => parseInt(s, 10));
    const VP = (p, a) => MD.calc('velocidad-perdida', { peso: p, altitud: a });
    eq(num('ias'), [VP(1100, 0).ias, VP(1600, 0).ias, VP(1100, 8000).ias].map((v) => Math.round(v)), 'tres-perdidas: las IAS dibujadas son las del modelo velocidad-perdida (liviano, pesado, liviano a 8 000 ft)');
    eq(num('tas'), [VP(1100, 0).tas, VP(1600, 0).tas, VP(1100, 8000).tas].map((v) => Math.round(v)), 'tres-perdidas: las TAS dibujadas son las del modelo');
  }
  // curva-sustentacion: marcas del curso (12°, 18°, 20°), pico y capa de pérdida
  {
    const cs = FG.get('curva-sustentacion');
    ok(['ejes', 'curva', 'marcas', 'pico', 'avion', 'perdida'].every((k) => cs.capas.some((c) => c.id === k)) && cs.capas.find((c) => c.id === 'perdida').visible === false && ['12°', '18°', '20°'].every((m) => cs.capas.find((c) => c.id === 'marcas').svg.includes('>' + m + '<')), 'curva-sustentacion: ejes, curva, marcas de 12°, 18° y 20°, pico y alas en rojo (capa «Pérdida» apagada de entrada)');
  }
}

seccion('visor 3D (puro: sin DOM ni 3D)');
{
  const VS = C.Escuela && C.Escuela.visor;
  ok(VS && ['open', 'close', 'isOpen', 'capture', 'restore', 'resume', 'init', 'setCaption', 'onChange', 'normalizar'].every((k) => typeof VS[k] === 'function'), 'Escuela.visor expone open / close / isOpen / capture / restore / resume / init / setCaption / onChange');
  const n = (t) => VS.normalizar(t);
  ok(n({ control: 'throttle' }).t.control === 'throttle', 'normalizar: {control}');
  ok(n('exterior').t.vista === 'exterior' && n('cabina').t.vista === 'cabina' && n('throttle').t.control === 'throttle', 'normalizar: "exterior" / "cabina" / id de mando');
  ok(n({ pose: 'nivelado', label: 'Nivelado' }).t.pose === 'nivelado' && n({ pose: 'nivelado', label: 'Nivelado' }).t.label === 'Nivelado', 'normalizar: {pose, label}');
  ok(n({ vista: 'afuera', foco: 'wing' }).t.vista === 'exterior' && n({ vista: 'afuera', foco: 'wing' }).t.foco === 'wing', 'normalizar: {vista:"afuera", foco}');
  const f = () => 1, nf = n(f);
  ok(nf.fn === f && nf.t === null, 'normalizar: una función se corre pero no se guarda (capture / reload)');
  ok(n({}).t === null && !n({}).fn && n(null).t === null && n(42).t === null, 'normalizar: lo que no se entiende da null');
  ok(JSON.stringify(n({ control: 'x', fn: f }).t) === '{"control":"x"}', 'normalizar: lo guardable es JSON puro (sin la función)');
  ok(VS.open('throttle') === false && VS.isOpen() === false, 'open() sin ui.js (sin init) devuelve false y no abre nada');
  ok(JSON.stringify(VS.capture()) === '{"open":false}' && VS.resume('escuela/INT-01-02') === false, 'capture() cerrado = {open:false}; resume() sin nada guardado = false');
  ok(VS.close() === false, 'close() con el visor cerrado devuelve false');
}

seccion('pantallas (puro): saludo, minutos, estado de lección y geometría del camino');
{
  const Pn = ES.pantallas;
  ok(typeof Pn.mapa === 'function' && typeof Pn.modulo === 'function' && typeof Pn.reservada === 'function' && typeof Pn.proximamente === 'function', 'pantallas.js: mapa, módulo, reservada y próximamente');
  eq([Pn.fmtMin(0), Pn.fmtMin(7), Pn.fmtMin(59), Pn.fmtMin(60), Pn.fmtMin(65), Pn.fmtMin(264)], ['0 min', '7 min', '59 min', '1 h 00 min', '1 h 05 min', '4 h 24 min'], 'fmtMin: minutos y horas');
  eq([Pn.saludo(0), Pn.saludo(5), Pn.saludo(6), Pn.saludo(12), Pn.saludo(13), Pn.saludo(19), Pn.saludo(20), Pn.saludo(23)], ['Buenas noches', 'Buenas noches', 'Buen día', 'Buen día', 'Buenas tardes', 'Buenas tardes', 'Buenas noches', 'Buenas noches'], 'saludo: voseo por franja horaria');
  const st = ST.crear({ storage: null });
  eq(Pn.estadoLec(st, 'INT-01-01'), { estado: 'nueva', estrellas: 0, paso: 0 }, 'estadoLec: sin registro = nueva');
  st.tocar('INT-01-01', 3);
  ok(Pn.estadoLec(st, 'INT-01-01').estado === 'en-curso' && Pn.estadoLec(st, 'INT-01-01').paso === 3, 'estadoLec: con paso = en curso');
  st.quiz('INT-01-01', 4, 4); st.marcarLista('INT-01-01', { minutos: 8 });
  ok(Pn.estadoLec(st, 'INT-01-01').estado === 'hecha' && Pn.estadoLec(st, 'INT-01-01').estrellas >= 1, 'estadoLec: marcada = hecha con estrellas');
  // el camino: una fila de 100 unidades por estación, zigzag entre dos x, tramos de entrada y de salida
  const g = Pn.geometriaCamino(12, [36, 64]);
  eq(g.ys, [50, 150, 250, 350, 450, 550, 650, 750, 850, 950, 1050, 1150], 'camino: la estación i va a y = 100·i + 50');
  eq(g.x.slice(0, 4), [36, 64, 36, 64], 'camino: alterna izquierda y derecha');
  ok(g.d.startsWith('M 36 0 L 36 50') && g.d.endsWith('L 64 1200') && (g.d.match(/ C /g) || []).length === 11, 'camino: entra desde arriba, 11 curvas y sale por abajo');
  ok(g.dHasta(0) === 'M 36 50' && g.dHasta(2).startsWith('M 36 50 C 36 98, 64 102, 64 150') && (g.dHasta(5).match(/ C /g) || []).length === 5, 'camino: dHasta(k) recorta el trazo hasta la estación k');
  ok(Pn.geometriaCamino(0, [20, 80]).d === '' && Pn.geometriaCamino(1, [20, 80]).d === 'M 20 0 L 20 50 L 20 100', 'camino: sin estaciones no hay trazo; con una, un tramo recto');
  // los 12 módulos reales: cada uno tiene icono y color para su tarjeta y su estación
  ES.datos.modulos().forEach((m) => ok(/^#[0-9A-Fa-f]{6}$/.test(m.color) && C.Icons.has(m.icono), 'tarjeta y estación de ' + m.id + ': color e icono válidos'));
  // la tarjeta de lección usa un icono por tipo de componente: todos existen
  ['simulador', 'diagrama', 'animacion', 'clasificar', 'emparejar', 'enlace3d', 'calculadora', 'situacion', 'ordenar', 'completar', 'tarjetas', 'diapositiva', 'quiz', 'caso', 'mapa', 'fraseologia'].forEach((t) => ok(Mot.META[t] && Mot.META[t].codigo, 'componente ' + t + ': tiene código para su ficha en la tarjeta'));
}

seccion('store (estrellas, Leitner, racha, exportar / importar)');
eq([ST.estrellas(1, true), ST.estrellas(1, false), ST.estrellas(0.7, true), ST.estrellas(0.69, true), ST.estrellas(0, true), ST.estrellas(0.99, true)], [3, 2, 2, 1, 1, 2], 'estrellas: 3 con 100 % al primer intento, 2 con ≥ 70 %, 1 al terminar');
eq([1, 2, 3, 4, 5].map((c) => ST.cajaSiguiente(c, true)), [2, 3, 4, 5, 5], 'Leitner: acertar sube de caja (tope 5)');
eq([1, 3, 5].map((c) => ST.cajaSiguiente(c, false)), [1, 1, 1], 'Leitner: errar vuelve a la caja 1');
eq(ST.INTERVALOS, [1, 3, 7, 14, 30], 'intervalos 1, 3, 7, 14 y 30 días');
eq([ST.semanaDe('2026-10-29'), ST.semanaDe('2026-01-01'), ST.semanaDe('2025-12-29'), ST.semanaDe('2027-01-03')], ['2026-W44', '2026-W01', '2026-W01', '2026-W53'], 'semana ISO');
eq([ST.diasEntre('2026-02-27', '2026-03-02'), ST.sumarDias('2026-12-30', 3), ST.sumarDias('2026-03-01', -1)], [3, '2027-01-02', '2026-02-28'], 'diasEntre / sumarDias cruzan fin de mes y de año');
let r = {};
['2026-10-26', '2026-10-27', '2026-10-27'].forEach((d) => { r = ST.rachaActualizar(r, d); });
eq([r.dias, r.ultimo], [2, '2026-10-27'], 'racha: dos días seguidos (el mismo día no suma)');
r = ST.rachaActualizar(r, '2026-10-29');
eq([r.dias, r.gracia], [3, '2026-W44'], 'racha: un día de gracia por semana cubre un salto');
eq(ST.rachaVigente(r, '2026-10-30'), 3, 'racha vigente al día siguiente');
r = ST.rachaActualizar(r, '2026-11-02');
eq(r.dias, 1, 'racha: sin gracia disponible (ya usada esa semana) o pasaron días → vuelve a 1');
eq([ST.rachaVigente({ dias: 5, ultimo: '2026-10-20', gracia: '' }, '2026-10-29'), ST.rachaVigente({}, '2026-10-29')], [0, 0], 'racha vigente: 0 si pasó mucho tiempo o no hay');
ok(ST.hashTexto('abc') === ST.hashTexto('abc') && ST.hashTexto('abc') !== ST.hashTexto('abd') && /^[0-9a-f]{8}$/.test(ST.hashTexto('abc')), 'hashTexto estable y de 8 hex');

let t = Date.parse('2026-10-29T12:00:00');
const mem = memStorage();
const s1 = ST.crear({ storage: mem, now: () => t });
ok(s1.lec('INT-01-01') === null && s1.ultima() === null && s1.racha() === 0, 'store nuevo: vacío');
s1.tocar('INT-01-01', 3);
eq([s1.lec('INT-01-01').estado, s1.lec('INT-01-01').paso, s1.ultima().paso], ['en-curso', 3, 3], 'tocar: en curso y "última" con el paso');
ok(s1.hecho('INT-01-01', 'p1.0') && s1.hecho('INT-01-01', 'p1.0') && s1.lec('INT-01-01').h.length === 1 && !s1.hecho('INT-01-01', 'MAL KEY!'), 'hecho: guarda cada componente una vez y rechaza claves raras');
const q1 = s1.quiz('INT-01-01', 4, 4);
eq([q1.estrellas, q1.primero, q1.insignias], [3, true, ['sin-errores']], 'quiz perfecto al primer intento: 3 estrellas e insignia "Sin errores"');
const q2 = s1.quiz('INT-01-01', 2, 4);
eq([q2.estrellas, q2.primero, s1.lec('INT-01-01').estrellas, s1.lec('INT-01-01').mejor, s1.lec('INT-01-01').intentos], [1, false, 3, 1, 2], 'el mejor resultado no baja nunca');
const m1 = s1.marcarLista('INT-01-01', { minutos: 8 });
eq([m1.nueva, m1.estrellas, m1.insignias, s1.lec('INT-01-01').estado], [true, 3, ['primera'], 'hecha'], 'marcarLista: hecha, estrellas e insignia "Primera lección"');
eq([s1.marcarLista('INT-01-01', { minutos: 8 }).nueva, s1.minutosSemana()], [false, 8], 'marcarLista dos veces no duplica minutos');
eq(s1.racha(), 1, 'la racha empieza con la primera lección');
ok(s1.mazoAgregar({ id: 'INT-01-02:clasificar:3', tipo: 'clasificar', ref: '3' }) && Object.keys(s1.mazo()).length === 1, 'mazoAgregar');
eq(s1.vencidas('2026-10-29').length, 0, 'un ítem fallado vence mañana, no hoy');
eq(s1.vencidas('2026-10-30').length, 1, 'vence mañana');
const rv = s1.repasar('INT-01-02:clasificar:3', true);
eq([rv.caja, rv.prox], [2, '2026-11-01'], 'repasar bien: caja 2, vuelve en 3 días');
eq(s1.repasar('INT-01-02:clasificar:3', false).caja, 1, 'repasar mal: caja 1');
ok(s1.repasar('no-existe', true) === null, 'repasar un ítem inexistente → null');
t += 86400000; s1.otorgar('x1');
eq(s1.racha(), 1, 'al día siguiente la racha sigue vigente');
// persistencia
const s2 = ST.crear({ storage: mem, now: () => t });
eq(s2.lec('INT-01-01').estado, 'hecha', 'se guarda en localStorage y se recupera al recargar');
// exportar / importar (ida y vuelta)
const txt = s2.exportar();
const s3 = ST.crear({ storage: memStorage(), now: () => t });
const imp = s3.importar(txt);
ok(imp.ok && imp.lecciones === 1, 'importar: ok');
eq(s3.estado(), s2.estado(), 'exportar → importar deja el mismo estado');
ok(s3.importar('no es json').ok === false && s3.importar(JSON.stringify({ app: 'otra', v: 1, datos: {} })).ok === false && s3.importar(JSON.stringify({ app: 'cabina-c150-escuela', v: 2, datos: {} })).ok === false, 'importar rechaza lo que no es un progreso de la Escuela');
const malo = JSON.stringify({ app: 'cabina-c150-escuela', v: 1, datos: { lecciones: { '__proto__': { estado: 'hecha' }, 'INT-01-09': { estado: 'hecha', estrellas: 99, mejor: 7, paso: -3, h: ['ok.1', '<script>'] }, 'x': 1 }, mazo: { 'a': { tipo: 'x', ref: 1, caja: 99, prox: 'mañana' } }, insignias: { '__proto__': 1, 'constructor': 2, 'buena': 3 }, polluted: true } });
const s4 = ST.crear({ storage: memStorage(), now: () => t });
ok(s4.importar(malo).ok, 'importar acepta un archivo con valores raros pero lo sanea');
const e4 = s4.estado();
eq([Object.keys(e4.lecciones), e4.lecciones['INT-01-09'].estrellas, e4.lecciones['INT-01-09'].mejor, e4.lecciones['INT-01-09'].paso, e4.lecciones['INT-01-09'].h, Object.keys(e4.mazo), Object.keys(e4.insignias), 'polluted' in e4, ({}).estado === undefined], [['INT-01-09'], 3, 1, 0, ['ok.1'], [], ['buena'], false, true], 'sanear: descarta claves peligrosas, recorta rangos y no contamina el prototipo');
// fusión: se queda con lo mejor
const f = ST.fusionar({ lecciones: { 'INT-01-01': { estado: 'en-curso', estrellas: 1, mejor: 0.5, intentos: 1, paso: 2, t: 5 } }, minutos: { '2026-10-29': 5 } }, { lecciones: { 'INT-01-01': { estado: 'hecha', estrellas: 2, mejor: 0.75, intentos: 3, paso: 7, t: 9 } }, minutos: { '2026-10-29': 8 } });
eq([f.lecciones['INT-01-01'].estado, f.lecciones['INT-01-01'].estrellas, f.lecciones['INT-01-01'].intentos, f.minutos['2026-10-29']], ['hecha', 2, 3, 8], 'fusionar conserva lo mejor de cada uno');
// almacenamiento bloqueado
const bloqueado = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const s5 = ST.crear({ storage: bloqueado, now: () => t });
s5.tocar('INT-01-01', 1); s5.marcarLista('INT-01-01', { minutos: 3 });
ok(s5.lec('INT-01-01').estado === 'hecha' && s5.persistente === false, 'almacenamiento bloqueado: sigue en memoria y lo avisa');
const s6 = ST.crear({ storage: null, now: () => t });
s6.tocar('INT-01-01', 1);
ok(s6.lec('INT-01-01') !== null, 'sin almacenamiento: sigue en memoria');
let avisos = 0; const off = s6.onChange(() => { avisos++; }); s6.tocar('INT-01-01', 2); off(); s6.tocar('INT-01-01', 3);
eq(avisos, 1, 'onChange avisa y se puede desuscribir');
s6.reset();
ok(s6.lec('INT-01-01') === null, 'reset borra todo');

/* ------------------------------------------------------------------ datos */
seccion('datos (páginas, orden, carga perezosa)');
eq([D.paginas('1–4'), D.paginas('5'), D.paginas('7-8'), D.paginas(''), D.paginas('x'), D.paginas('9–3')], [[1, 4], [5, 5], [7, 8], null, null, [3, 9]], 'paginas()');
eq([D.tipoId('AER'), D.tipoId('AER-03'), D.tipoId('AER-03-02'), D.tipoId('aer'), D.tipoId('AER-3')], ['modulo', 'unidad', 'leccion', null, null], 'tipoId()');
ok(D.rangos('524–525, 527').length === 2 && D.rangos('1–4, x') === null && D.porPagina(527).some((e) => e.id === 'AYM-13-02') && D.porPagina(9).some((e) => e.id === 'INT-01-05') && D.porPagina(4).some((e) => e.id === 'INT-01-01') && D.porPagina(0).length === 0, 'porPagina: "p. 9" → INT-01-05, "p. 4" → INT-01-01');
ok(D.siguiente('INT-01-01').id === 'INT-01-02' && D.anterior('INT-01-02').id === 'INT-01-01' && D.anterior('INT-01-01') === null, 'siguiente / anterior sólo cuentan lecciones disponibles');
ok(D.siguiente('INT-01-06') === null || D.siguiente('INT-01-06').lec.detalle === 'completo', 'siguiente de la última disponible');
const tm = D.totalesModulo('INT');
ok(tm.lecciones === 37 && tm.disponibles >= 6 && tm.minutosDisp > 0, 'totalesModulo(INT): 37 lecciones, ≥ 6 disponibles');
ok(D.cargarSync('INT') === null, 'sin DOM no hay bloque inline: cargarSync → null');
ok(D.cargado('INT') === null, 'aún no cargado');
(async () => {
  const pedidos = [];
  S.fetch = (url) => { pedidos.push(url); return url.indexOf('NOPE') >= 0 ? Promise.resolve({ ok: false, status: 404 }) : Promise.resolve({ ok: true, json: () => Promise.resolve(readJson(path.join(ED, 'INT.json'))) }); };
  let cargados = 0; D.onCargado(() => { cargados++; });
  const [a, b] = await Promise.all([D.cargar('INT'), D.cargar('INT')]);
  ok(a === b && a.lecs['INT-01-01'] && pedidos.length === 1 && pedidos[0] === 'escuela/INT.json', 'cargar(): un solo fetch a escuela/INT.json aunque se pida dos veces');
  ok(cargados === 1 && D.cargado('INT') === a && D.leccionDatos('INT-01-01').id === 'INT-01-01' && D.cargarSync('INT') === a, 'onCargado una vez, caché y leccionDatos');
  const msg = (e) => (e && typeof e.message === 'string') ? e.message : '';
  let err = null; try { await D.cargar('xx'); } catch (e) { err = e; }
  ok(msg(err) !== '', 'cargar("xx") rechaza un id mal formado');
  err = null; S.fetch = () => Promise.resolve({ ok: false, status: 500 }); try { await D.cargar('AER'); } catch (e) { err = e; }
  ok(/AER/.test(msg(err)) && D.cargado('AER') === null, 'cargar(): un 500 rechaza con un mensaje claro y no deja caché');
  S.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ nada: 1 }) }); err = null; try { await D.cargar('INS'); } catch (e) { err = e; }
  ok(msg(err) !== '' && D.cargado('INS') === null, 'cargar(): un archivo sin la forma esperada rechaza');
  seccion('integración con el resto (Escuela, Search, Glossary)');
  ok(C.Escuela && C.Escuela.total === D.total() && typeof C.Escuela.mount === 'function' && typeof C.Escuela.navProvider === 'function' && typeof C.Escuela.cargar === 'function', 'C150.Escuela: mount, navProvider, cargar y total');
  const prov = C.Escuela.navProvider();
  ok(['label', 'crumbs', 'route', 'capture', 'restore', 'up', 'inDetail', 'active'].every((k) => typeof prov[k] === 'function') && prov.route() === 'escuela' && prov.inDetail() === false && prov.up() === false, 'proveedor de Nav completo (mapa: ruta "escuela", sin detalle)');
  ok(C.Search.providers().includes('escuela'), 'Search.register("escuela")');
  const pag = C.Search.query('p. 9').find((g) => g.id === 'escuela');
  ok(pag && /El curso de Piloto Privado/.test(pag.items[0].titulo), 'buscar "p. 9" lleva a INT-01-05');
  const lecq = C.Search.query('quiénes somos').find((g) => g.id === 'escuela');
  ok(lecq && lecq.items.some((i) => /Lección: ¿Quiénes somos/.test(i.titulo)), 'buscar una lección por su título');
  ok(C.Search.query('aerodinámica').some((g) => g.id === 'escuela' && g.items.some((i) => /Aerodinámica/.test(i.titulo))), 'buscar un módulo');
  ok(C.Glossary.define('CIAC') && /inspectores/.test(C.Glossary.define('CIAC').definicion), 'al cargar un módulo se registran sus términos en el glosario (CIAC)');
  const P2 = C.Progress; P2.mark('escuela', 'INT-01-01'); P2.mark('escuela', 'INT-01-02');
  const et = P2.summary().camino.find((c) => c.id === 'escuela');
  ok(et && et.requisitos[0].total === D.total() && et.requisitos[0].actual === 2, 'Progress: la etapa 6 usa C150.Escuela.total (' + D.total() + ') y cuenta las lecciones marcadas');
  P2.touch('escuela', 'INT-01-02', { ruta: 'INT-01-02/3' });
  const ul = P2.last();
  ok(ul.ruta === '#escuela/INT-01-02/3' && /Quiénes somos/.test(ul.titulo), 'Progress.last(): "Continuar" vuelve al paso exacto de la lección');

  /* ---------------------------------------------------------------- salida del build */
  seccion('salida de build.js (si existe)');
  const site = path.join(ROOT, 'cabina-cessna-150', 'escuela'), html = path.join(ROOT, 'cabina-cessna-150', 'index.html');
  if (fs.existsSync(html) && fs.existsSync(site)) {
    const h = fs.readFileSync(html, 'utf8'), art = fs.existsSync(path.join(ROOT, 'dist', 'artifact.html')) ? fs.readFileSync(path.join(ROOT, 'dist', 'artifact.html'), 'utf8') : '';
    ok(h.includes('<script type="application/json" id="escuela-indice">') && !h.includes('<!--ESCUELA-JSON-->'), 'index.html trae el bloque escuela-indice');
    modFiles.forEach((f) => {
      const id = f.replace('.json', '');
      ok(h.includes('id="escuela-' + id + '">') && (!art || art.includes('id="escuela-' + id + '">')), 'el HTML y el artifact traen el bloque escuela-' + id);
      ok(fs.existsSync(path.join(site, f)) && JSON.stringify(readJson(path.join(site, f))) === JSON.stringify(readJson(path.join(ED, f))) && !/\n/.test(fs.readFileSync(path.join(site, f), 'utf8')), 'cabina-cessna-150/escuela/' + f + ' es el mismo contenido, minificado');
    });
    ok(!/_teorico|Teorico\.pdf|teorico-ocr/.test(h), 'el HTML publicado no menciona _teorico ni el PDF/OCR del curso');
  } else console.log('  (sin build: corré node build.js para chequear esta parte)');

  console.log('\n' + (fallas ? fallas + ' de ' + pruebas + ' pruebas fallaron.' : pruebas + '/' + pruebas + ' pruebas OK'));
  console.log(fallas ? 'validate-escuela: HAY FALLAS' : 'validate-escuela: TODO BIEN');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
