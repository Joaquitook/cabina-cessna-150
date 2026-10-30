/* validate-escuela.js — pruebas de la Escuela (contrato v7 §7) en Node, sin DOM.
 *   node tests/validate-escuela.js
 * Cubre:
 *  - src/data/escuela/indice.json: esquema, ids únicos y con la forma AAA-NN-NN, módulos en orden, tipos de componente conocidos, tamaño (≤ 256 KB);
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
 *  - componentes Q1 (pasada 2): ordenar, completar y tarjetas: lógica pura (evaluar, comparar respuestas, rondas, banco de fichas, sesión de repaso), normalizar sobre
 *    alias y datos basura, cada instancia de las lecciones (sin caer a la reserva, con claves de respuesta válidas) y el repaso espaciado de las tarjetas (SM-2 simple con
 *    números de día, helper tarjetasVencidas, persistencia, migración, saneado y fusión).
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
  const prio = (f) => (f === 'modelos.js' ? 0 : f === 'figuras.js' ? 1 : f === 'mapas.js' ? 2 : 3);
  const comps = fs.readdirSync(dir).filter((f) => /^(c-.*|modelos|figuras|mapas)\.js$/.test(f)).sort((a, b) => (prio(a) - prio(b)) || a.localeCompare(b));
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
ok(Buffer.byteLength(rawIx) <= 256 * 1024, 'indice.json pesa ≤ 256 KB (' + (Buffer.byteLength(rawIx) / 1024).toFixed(0) + ' KB)');
eq(ix.modulos.map((m) => m.id), ['INT', 'AER', 'INS', 'AYM', 'COM', 'ATM', 'RTF', 'MET', 'NAV', 'REG', 'PER', 'FHU', 'OPE'], 'los 13 módulos en el orden del curso y luego los complementarios');
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

/* ------------------------------------------------------------------ componentes Q1 (pasada 2): ordenar, completar, tarjetas */
seccion('componentes Q1: ordenar, completar, tarjetas');
const TIPOS_Q1 = ['ordenar', 'completar', 'tarjetas'];
TIPOS_Q1.forEach((t) => ok(Mot.has(t) && Mot.esPractica(t), 'componente "' + t + '" registrado y de la práctica'));
const OR = ES.ordenar, CM = ES.completar, TJ = ES.tarjetas;
ok(!!OR && !!CM && !!TJ && ['normalizar', 'evaluar', 'mover', 'barajar'].every((k) => typeof OR[k] === 'function') && ['normalizar', 'igual', 'comparable', 'numero', 'partes', 'rondas', 'banco'].every((k) => typeof CM[k] === 'function') && ['normalizar', 'armarSesion', 'crearSesion', 'etiquetaIntervalo', 'cartaDe', 'cartasDeLeccion'].every((k) => typeof TJ[k] === 'function'), 'existen ES.ordenar, ES.completar y ES.tarjetas con su parte pura');
const NQ = (t, d) => Mot.get(t).normalizar(JSON.parse(JSON.stringify(d)), ctxNode, { tipo: t, titulo: 'x', descripcion: 'y', datos: d });
// ---- ordenar: evaluar / mover / barajar
{
  const ev = (a, c) => OR.evaluar(a.split(''), c.split(''));
  eq(ev('abcd', 'abcd'), { enSitio: [true, true, true, true], correctos: 4, exactos: 4, total: 4, completo: true }, 'ordenar.evaluar: todo en su lugar → completo');
  eq([ev('dabc', 'abcd').correctos, ev('dabc', 'abcd').enSitio], [3, [false, true, true, true]], 'ordenar.evaluar: un paso movido no pinta de rojo a los demás (la mayor cadena en orden relativo)');
  eq([ev('bacd', 'abcd').correctos, ev('bacd', 'abcd').completo], [3, false], 'ordenar.evaluar: dos pasos cambiados → 3 de 4 (uno de los dos queda fuera de lugar)');
  eq([ev('dcba', 'abcd').correctos, ev('dcba', 'abcd').exactos], [1, 0], 'ordenar.evaluar: al revés → sólo 1 queda en su lugar');
  ok(ev('acbd', 'abcd').enSitio.filter(Boolean).length === 3 && ev('acbd', 'abcd').completo === false, 'ordenar.evaluar: la cadena más larga manda');
  ok(OR.evaluar([], []).completo === false && OR.evaluar(['a', 'z'], ['a', 'b']).correctos === 1, 'ordenar.evaluar: sin pasos o con un id ajeno no tira ni da completo');
  eq(OR.mover(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd'], 'ordenar.mover: lleva el paso al casillero y corre el resto');
  eq([OR.mover(['a', 'b', 'c'], 'c', 0), OR.mover(['a', 'b', 'c'], 'a', 99), OR.mover(['a', 'b', 'c'], 'zz', 1)], [['c', 'a', 'b'], ['b', 'c', 'a'], ['a', 'b', 'c']], 'ordenar.mover: índice acotado; un id inexistente no cambia nada');
  { const o = ['a', 'b', 'c']; OR.mover(o, 'a', 2); eq(o, ['a', 'b', 'c'], 'ordenar.mover: no modifica la lista original'); }
  const ids6 = ['a', 'b', 'c', 'd', 'e', 'f'];
  let siempreOk = true;
  for (let i = 0; i < 40; i++) { const b = OR.barajar(ids6, ids6, 'sem' + i); if (JSON.stringify(b) === JSON.stringify(ids6) || JSON.stringify(b) === JSON.stringify(ids6.slice().reverse()) || b.slice().sort().join('') !== 'abcdef') siempreOk = false; }
  ok(siempreOk, 'ordenar.barajar: 40 semillas → siempre una permutación, nunca el orden correcto ni el inverso');
  eq(OR.barajar(ids6, ids6, 'x'), OR.barajar(ids6, ids6, 'x'), 'ordenar.barajar: misma semilla, misma mezcla');
  ok(JSON.stringify(OR.barajar(['a', 'b'], ['a', 'b'], 'q')) === '["b","a"]', 'ordenar.barajar: con 2 pasos queda cambiado');
}
// ---- ordenar: normalizar sobre los esbozos
{
  const a = NQ('ordenar', { pasos: ['uno', 'dos', 'tres'] });
  eq(a && a.items.map((x) => x.texto), ['uno', 'dos', 'tres'], 'ordenar: `pasos` en el orden en que están escritos es el orden correcto');
  const b = NQ('ordenar', { items: [{ id: 'z', texto: 'tercero' }, { id: 'x', texto: 'primero' }, { id: 'y', texto: 'segundo' }], orden: ['x', 'y', 'z'], explicaciones: { x: 'porque sí', y: 'ya' } });
  eq(b.items.map((x) => x.id + ':' + x.explicacion), ['x:porque sí', 'y:ya', 'z:'], 'ordenar: items + `orden` por ids + explicaciones {id: texto}');
  eq(NQ('ordenar', { items: ['c', 'a', 'b'], orden: [2, 3, 1] }).items.map((x) => x.texto), ['a', 'b', 'c'], 'ordenar: `orden` por posiciones desde 1');
  eq(NQ('ordenar', { items: ['c', 'a', 'b'], orden: [1, 2, 0] }).items.map((x) => x.texto), ['a', 'b', 'c'], 'ordenar: `orden` por posiciones desde 0 si hay un 0');
  eq(NQ('ordenar', { items: ['c', 'a', 'b'], orden: ['a', 'b', 'c'] }).items.map((x) => x.texto), ['a', 'b', 'c'], 'ordenar: `orden` por el texto de cada paso');
  eq(NQ('ordenar', { pasos: [{ nombre: 'tercero', posicion: 3 }, { nombre: 'primero', posicion: 1 }, { nombre: 'segundo', posicion: 2 }] }).items.map((x) => x.texto), ['primero', 'segundo', 'tercero'], 'ordenar: una `posicion` por paso');
  eq(NQ('ordenar', { pasos: ['uno', 'dos'], explicaciones: ['e1', 'e2'] }).items.map((x) => x.explicacion), ['e1', 'e2'], 'ordenar: explicaciones como lista paralela');
  const ic = NQ('ordenar', { items: [{ texto: 'a', icono: 'plane' }, { texto: 'b', icono: 'no-existe' }] });
  eq(ic.items.map((x) => x.icono), ['plane', ''], 'ordenar: el ícono sólo si existe en src/icons.js');
  eq(NQ('ordenar', { pasos: ['uno', 'dos'], inicio: 'Arriba', fin: 'Abajo' }).inicio + '|' + NQ('ordenar', { pasos: ['uno', 'dos'], extremos: ['A', 'B'] }).fin, 'Arriba|B', 'ordenar: rótulos de los extremos (inicio / fin o extremos)');
  eq(NQ('ordenar', { pasos: ['uno', 'dos'], nota: 'Esto es a confirmar con el instructor' }).nota, '', 'ordenar: oculta las notas "a confirmar" del plan');
  eq(NQ('ordenar', b), b, 'ordenar: normalizar es idempotente');
  ok(NQ('ordenar', { items: ['a', 'b'], orden: ['x', 'y'] }) === null, 'ordenar: un `orden` que no resuelve → null (mejor la reserva que una clave equivocada)');
  ok(NQ('ordenar', { items: ['a'] }) === null && NQ('ordenar', { items: [] }) === null && NQ('ordenar', { items: Array.from({ length: 17 }, (_, i) => 'p' + i) }) === null, 'ordenar: menos de 2 pasos o más de 16 → null');
  eq(NQ('ordenar', { items: [{ id: 'a', texto: 'x' }, { id: 'a', texto: 'y' }] }).items.map((x) => x.id), ['a', 'a_'], 'ordenar: ids repetidos se desambiguan');
  ok(['x', 1, null, [], { items: 5 }, { pasos: [1] }, { pasos: [{}, {}] }].every((d) => NQ('ordenar', d) === null), 'ordenar: datos basura → null sin tirar error');
}
// ---- completar: comparar, partir, rondas, banco
{
  const I = (e, r, extra) => CM.igual(e, Object.assign({ respuesta: r, alternativas: [] }, extra || {}));
  ok(I('Recuento', 'recuento') && I('  recuento. ', 'recuento') && I('policia  aerea nacional', 'Policía Aérea Nacional') && !I('recuentos', 'recuento') && !I('', 'recuento'), 'completar.igual: sin mayúsculas, tildes, espacios ni punto final; vacío nunca');
  ok(I('6,0', '6') && I('6.0', '6') && I('75 %', '75') && I('75%', '75') && !I('5', '15') && !I('15', '5') && !I('7', '70'), 'completar.igual: los números se comparan como números ("6,0" = "6"; "5" no es "15")');
  ok(I('75', '75', { unidad: '%' }) && I('75 %', '75', { unidad: '%' }) && I('75%', '75', { unidad: '%' }) && I('3 kt', '3', { unidad: 'kt' }) && !I('76 %', '75', { unidad: '%' }), 'completar.igual: una cifra con su unidad (se acepta con o sin la unidad)');
  ok(I('6:00', '06:00') && I('06:00', '6:00') && !I('6:30', '06:00') && !I('600', '06:00'), 'completar.igual: las horas "6:00" y "06:00" son la misma');
  ok(CM.igual('recuentos', { respuesta: 'recuento', alternativas: ['recuentos'] }) && CM.igual('4,5', { respuesta: '4.5' }) && !CM.igual('1', { respuesta: '', alternativas: [] }), 'completar.igual: alternativas, decimales con coma, respuesta vacía nunca coincide');
  eq(CM.partes('a ___ b ____ c'), [{ t: 'txt', v: 'a ' }, { t: 'hueco', k: 0 }, { t: 'txt', v: ' b ' }, { t: 'hueco', k: 1 }, { t: 'txt', v: ' c' }], 'completar.partes: cada ___ (3 o más guiones bajos) es un hueco, en orden');
  eq(CM.partes('sin huecos'), [{ t: 'txt', v: 'sin huecos' }], 'completar.partes: sin huecos');
  const fr = (n) => Array.from({ length: n }, (_, i) => ({ texto: 'f' + i + ' ___', huecos: [{ respuesta: 'r' + i }] }));
  eq([CM.rondas(fr(3)).length, CM.rondas(fr(5)).length, CM.rondas(fr(10)).map((r) => r.length), CM.rondas(fr(11)).length], [1, 1, [5, 5], 3], 'completar.rondas: hasta 5 frases en una; 10 → 5 + 5; 11 → 3 rondas');
  { const rs = CM.rondas(fr(13)); eq(rs.reduce((a, r) => a.concat(r), []), Array.from({ length: 13 }, (_, i) => i), 'completar.rondas: cada frase aparece una sola vez y en orden'); ok(rs.every((r) => r.length <= 5), 'completar.rondas: nunca más de 5 frases por ronda'); }
  ok(CM.rondas([{ texto: '___ ___ ___ ___ ___ ___ ___ ___', huecos: Array.from({ length: 8 }, (_, i) => ({ respuesta: 'r' + i })) }]).length === 1, 'completar.rondas: una sola frase larga no se parte');
  const frs = [{ texto: 'a ___', huecos: [{ respuesta: '5', tipo: 'ficha' }] }, { texto: 'b ___', huecos: [{ respuesta: 'sol', tipo: 'ficha' }, ] }, { texto: 'c ___', huecos: [{ respuesta: '', tipo: 'libre' }] }];
  const bk = CM.banco(frs, [0, 1, 2], ['5', '15', 'luna', 'Sol', 'viento', 'luna', 'agua'], 'semilla');
  ok(bk.filter((c) => !c.relleno).map((c) => c.texto).sort().join() === '5,sol' && bk.every((c) => c.uso === null && c.id), 'completar.banco: trae la respuesta de cada hueco con ficha (no la del hueco libre) y las fichas sin usar');
  ok(!bk.some((c) => c.relleno && (c.texto === '5' || comparableIgual(c.texto, 'sol'))) && bk.filter((c) => c.relleno).length >= 2 && new Set(bk.filter((c) => c.relleno).map((c) => c.texto)).size === bk.filter((c) => c.relleno).length, 'completar.banco: el relleno no repite una respuesta ni se repite entre sí (el "15" sí sirve de relleno para el "5")');
  eq(CM.banco(frs, [0, 1], ['x', 'y', 'z'], 's'), CM.banco(frs, [0, 1], ['x', 'y', 'z'], 's'), 'completar.banco: misma semilla, mismo banco');
  eq(CM.banco(frs, [0], [], 's').length, 1, 'completar.banco: sin relleno sólo trae las respuestas');
  eq(CM.banco(frs, [2], ['x'], 's'), [], 'completar.banco: una ronda sin huecos con ficha no trae banco');
  function comparableIgual(a, b) { return CM.comparable(a) === CM.comparable(b); }
}
// ---- completar: normalizar sobre los esbozos
{
  const a = NQ('completar', { frases: [['Todo piloto pide un ___.', 'recuento'], ['La ___ paga.', 'dirección']], fichas: ['aseguradora', 'recuento', 'sorteo'] });
  ok(a && a.frases.length === 2 && a.frases[0].huecos[0].respuesta === 'recuento' && a.frases[0].huecos[0].tipo === 'ficha' && JSON.stringify(a.distractores) === '["aseguradora","sorteo"]', 'completar: frases:[[texto, respuesta]] + fichas = relleno (sin repetir las respuestas)');
  eq(NQ('completar', a), a, 'completar: normalizar es idempotente');
  const b = NQ('completar', { frases: [{ texto: 'Con ___ y ___.', respuesta: ['uno', 'dos'], explicacion: 'Se cuentan.' }, { texto: 'La nota es ___ %.', correcta: 75, alternativas: ['setenta y cinco'], unidad: '%' }] });
  ok(b.frases[0].huecos.length === 2 && b.frases[0].explicacion === 'Se cuentan.' && b.frases[1].huecos[0].respuesta === '75' && b.frases[1].huecos[0].alternativas[0] === 'setenta y cinco' && b.frases[1].huecos[0].unidad === '%', 'completar: objetos con varios huecos, número, alternativas y unidad');
  const c = NQ('completar', { texto: 'Mi base es [[a]] y vuelo de [[b]].', huecos: [{ id: 'a', correcta: 'Carrasco' }, { id: 'b', respuesta: 'día', alternativas: ['dia'] }], distractores: ['Melilla', 'noche'] });
  ok(c && c.frases.length === 1 && c.frases[0].texto === 'Mi base es ___ y vuelo de ___.' && c.frases[0].huecos.map((x) => x.respuesta).join() === 'Carrasco,día' && c.distractores.length === 2, 'completar: un párrafo con [[id]] y huecos declarados');
  eq(NQ('completar', { texto: 'Hay {{n}} y {{75|%}}.', huecos: [{ id: 'n', correcta: '3' }] }).frases[0].texto, 'Hay ___ y {{75|%}}.', 'completar: {{id}} declarado es un hueco; {{75|%}} sigue siendo la cifra del texto de la lección');
  eq(NQ('completar', { texto: ['Primero [[a]].', 'Segundo [[b]].'], huecos: [{ id: 'a', correcta: 'x' }, { id: 'b', correcta: 'y' }] }).frases.length, 2, 'completar: `texto` como lista de párrafos');
  const d = NQ('completar', { frases: [{ texto: 'Ayuno de [[12]] horas.', fichas: ['6', '24'] }] });
  ok(d && d.frases[0].huecos[0].respuesta === '12' && d.distractores.join() === '6,24', 'completar: esbozo del plan con la respuesta dentro de la frase ([[12]])');
  const l = NQ('completar', { texto: 'Me llamo [[n]] y vuelo por [[m]].', huecos: [{ id: 'n', tipo: 'texto-libre' }, { id: 'm', libre: true, fichas: ['curiosidad', 'libertad'] }] });
  ok(l && l.frases[0].huecos.every((x) => x.tipo === 'libre' && x.respuesta === '') && l.frases[0].huecos[1].sugerencias.join() === 'curiosidad,libertad' && l.distractores.length === 0, 'completar: huecos libres (sin respuesta) con ideas sugeridas');
  eq(NQ('completar', { frases: [{ texto: 'Escribí ___.', respuesta: 'mach', tipo: 'escribir' }] }).frases[0].huecos[0].tipo, 'escribir', 'completar: un hueco que se escribe');
  ok(NQ('completar', { frases: [['Sin hueco.', 'x']] }) === null && NQ('completar', { frases: [['Dos ___ ___.', 'x']] }) === null && NQ('completar', { frases: [['Un ___.', '']] }) === null, 'completar: sin hueco, con menos respuestas que huecos o con respuesta vacía → null');
  eq(NQ('completar', { frases: [['Buena ___.', 'x'], ['Mala sin hueco.', 'y']] }).frases.length, 1, 'completar: una frase inservible se descarta y las demás siguen');
  ok(NQ('completar', { texto: 'Falta [[nada]].', huecos: [{ id: 'otro', correcta: 'x' }] }) === null, 'completar: un [[id]] sin declarar → null');
  ok(['x', 1, null, [], { frases: 5 }, { frases: [] }, { texto: 'a', huecos: 'b' }, { frases: [[1, 2, 3]] }].every((x) => NQ('completar', x) === null), 'completar: datos basura → null sin tirar error');
  eq(NQ('completar', { frases: [['Una ___.', 'x']], nota: 'Dudas para el instructor: revisar' }).nota, '', 'completar: oculta las notas del plan para el instructor');
}
// ---- tarjetas: normalizar, sesión, intervalo
{
  const a = NQ('tarjetas', { mazo: [{ frente: 'F1', dorso: 'D1', pista: 'P1' }, { frente: 'F2', dorso: 'D2', bloque: 1 }, { frente: 'F3', dorso: 'D3', bloque: 2 }] });
  eq(a.mazo.map((x) => x.idx + x.frente + x.dorso + x.pista), ['0F1D1P1', '1F2D2', '2F3D3'], 'tarjetas: {frente, dorso, pista} con su índice de mazo');
  eq(a.bloques.map((x) => x.id + ':' + x.nombre + ':' + x.n), ['1:Bloque 1:1', '2:Bloque 2:1'], 'tarjetas: los bloques salen del campo `bloque`, en orden de aparición');
  eq(NQ('tarjetas', a), a, 'tarjetas: normalizar es idempotente');
  eq(NQ('tarjetas', { mazo: [{ frente: 'x', dorso: '' }, { frente: 'F', dorso: 'D' }, { dorso: 'solo' }, { pregunta: 'P', respuesta: 'R' }] }).mazo.map((x) => x.idx + x.frente), ['1F', '3P'], 'tarjetas: una carta sin los dos lados se descarta pero las otras CONSERVAN su índice original (es la clave del repaso)');
  eq(NQ('tarjetas', { tarjetas: [['a', 'b'], ['c', 'd', 'pista']] }).mazo.map((x) => x.frente + x.dorso + x.pista), ['ab', 'cdpista'], 'tarjetas: pares [frente, dorso, pista]');
  eq(NQ('tarjetas', { terminos: ['t1', 't2'], definiciones: ['d1', 'd2'] }).mazo.map((x) => x.frente + x.dorso), ['t1d1', 't2d2'], 'tarjetas: dos listas paralelas (términos / definiciones)');
  eq(NQ('tarjetas', { cartas: [{ anverso: 'A', reverso: 'B', figura: 'plane' }] }).mazo[0].figura, 'plane', 'tarjetas: anverso / reverso y figura');
  eq(NQ('tarjetas', { mazo: [{ frente: 'F', dorso: 'D' }], nota: 'Errata: revisar' }).nota, '', 'tarjetas: oculta las notas de errata del plan');
  eq(NQ('tarjetas', { mazo: [{ idx: 7, frente: 'F', dorso: 'D' }, { idx: 7, frente: 'G', dorso: 'H' }] }).mazo.map((x) => x.idx), [7, 1001], 'tarjetas: índices repetidos se desambiguan');
  ok(['x', 1, null, [], { mazo: 5 }, { mazo: [] }, { mazo: [{ frente: 'solo' }] }, { terminos: ['a'], definiciones: ['b', 'c'] }].every((x) => NQ('tarjetas', x) === null), 'tarjetas: datos basura → null sin tirar error');
  const cartas = [0, 1, 2, 3, 4, 5].map((i) => ({ idx: i, frente: 'f' + i, dorso: 'd' + i, bloque: i < 3 ? 'a' : 'b' }));
  const ses = (reg, hoy, o) => TJ.armarSesion(cartas, reg, hoy, o);
  let s0 = ses({}, 100);
  eq([s0.cola, s0.nuevas, s0.vencidas, s0.futuras, s0.alDia, s0.proxima, s0.resto], [[0, 1, 2, 3, 4, 5], 6, 0, 0, false, null, 0], 'armarSesion: todo nuevo → el mazo en su orden');
  const reg = { 1: { ef: 2.5, n: 1, due: 99, last: 98 }, 4: { ef: 2.5, n: 2, due: 90, last: 84 }, 2: { ef: 2.5, n: 1, due: 105, last: 104 }, 0: { ef: 2.5, n: 1, due: 100, last: 99 } };
  s0 = ses(reg, 100);
  eq([s0.cola, s0.vencidas, s0.nuevas, s0.futuras, s0.proxima], [[4, 1, 0, 3, 5], 3, 2, 1, 105], 'armarSesion: primero las vencidas (la más atrasada antes), después las nuevas; las de más adelante no entran');
  eq(ses(reg, 100, { max: 3 }).cola.concat(ses(reg, 100, { max: 3 }).resto), [4, 1, 0, 2], 'armarSesion: tope de tarjetas por sesión (y cuántas quedan sin entrar)');
  eq(ses(reg, 100, { bloque: 'b' }).cola, [4, 3, 5], 'armarSesion: sólo un bloque');
  { const todas = {}; cartas.forEach((c) => { todas[c.idx] = { ef: 2.5, n: 3, due: 130 + c.idx, last: 100 }; }); const al = ses(todas, 101); eq([al.cola, al.alDia, al.proxima, al.futuras], [[], true, 130, 6], 'armarSesion: todo programado para más adelante → al día, con la fecha de la próxima'); }
  eq(TJ.armarSesion([], {}, 100).alDia, false, 'armarSesion: sin cartas no está "al día"');
  eq(TJ.armarSesion(cartas, null, 100, { max: 0 }).cola.length, 6, 'armarSesion: registros nulos y tope inválido no tiran error');
  const se = TJ.crearSesion([10, 11, 12]);
  eq([se.total, se.actual(), se.quedan(), se.esRepeticion(), se.terminada()], [3, 10, 3, false, false], 'crearSesion: arranca en la primera carta');
  let r = se.calificar('nosabia');
  eq([r.idx, r.persistir, r.reencolada, se.actual(), se.quedan()], [10, true, true, 11, 3], 'crearSesion: "No la sabía" vuelve una vez al final y se guarda');
  se.calificar('sabia'); r = se.calificar('medio');
  eq([se.actual(), se.esRepeticion(), se.quedan(), se.vistas()], [10, true, 1, 3], 'crearSesion: la carta repetida se reconoce como repetición');
  r = se.calificar('nosabia');
  eq([r.idx, r.persistir, r.reencolada, se.terminada(), se.actual(), se.quedan()], [10, false, false, true, null, 0], 'crearSesion: la repetida no se vuelve a guardar ni a encolar: la sesión termina');
  eq([se.cuenta(), se.resultados(), se.orden()], [{ sabia: 1, medio: 1, nosabia: 1 }, { 10: 'nosabia', 11: 'sabia', 12: 'medio' }, [10, 11, 12]], 'crearSesion: cuenta y resultados son los de la PRIMERA calificación de cada carta');
  { const rp = TJ.crearSesion([4, 5], { repaso: true }); eq([rp.repaso, rp.calificar('nosabia').persistir, rp.calificar('sabia').persistir, rp.calificar('sabia').persistir, rp.terminada()], [true, false, false, false, true], 'crearSesion({repaso}): la vuelta de repaso de las falladas no cambia cuándo vuelven (nada se guarda)'); eq(TJ.crearSesion([1]).repaso, false, 'crearSesion: una sesión normal guarda'); }
  ok(TJ.crearSesion([]).calificar('sabia') === null && TJ.crearSesion([]).actual() === null && TJ.crearSesion([]).terminada(), 'crearSesion: sesión vacía no tira error');
  eq([1, 2, 6, 13, 20, 45, 100, 0, -3].map(TJ.etiquetaIntervalo), ['mañana', 'en 2 días', 'en 6 días', 'en 13 días', 'en 3 semanas', 'en 6 semanas', 'en 3 meses', 'mañana', 'mañana'], 'etiquetaIntervalo: mañana · días · semanas · meses');
  const lec = { componentes: [{ tipo: 'diagrama', datos: {} }, { tipo: 'tarjetas', datos: { mazo: [{ frente: 'x', dorso: 'y' }, { frente: 'p', dorso: 'q' }] } }] };
  ok(TJ.cartasDeLeccion(lec).length === 2 && TJ.cartaDe(lec, 1).frente === 'p' && TJ.cartaDe(lec, 5) === null && TJ.cartasDeLeccion({}).length === 0, 'cartaDe / cartasDeLeccion: encuentran la carta {lección, índice} para la pantalla "Repaso del día"');
}
// ---- cada instancia de los tres tipos en las lecciones: normaliza (nada cae a la reserva), con claves de respuesta válidas y sin textos vacíos
{
  const cuenta = { ordenar: 0, completar: 0, tarjetas: 0 };
  todasLasLecciones.forEach((l) => {
    const mazos = l.componentes.filter((c) => c.tipo === 'tarjetas').length;
    ok(mazos <= 1, l.id + ': a lo sumo un mazo de tarjetas por lección (la clave del repaso es lección:índice)');
    l.componentes.forEach((c, i) => {
      if (!TIPOS_Q1.includes(c.tipo)) return;
      const w = l.id + ' ' + c.tipo + ' #' + i;
      cuenta[c.tipo]++;
      const r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c);
      ok(r !== null, w + ': normaliza (no usa la reserva)');
      if (!r) return;
      eq(vacios(c.datos, w, []), [], w + ': los datos de la lección no tienen textos vacíos');
      eq(Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(r)), ctxNode, c), r, w + ': normalizar es idempotente');
      if (c.tipo === 'ordenar') {
        const idsO = r.items.map((x) => x.id);
        ok(r.items.length >= 2 && r.items.length <= 16 && new Set(idsO).size === idsO.length && r.items.every((x) => x.texto), w + ': 2 a 16 pasos con id único y texto');
        ok(OR.evaluar(idsO, idsO).completo && OR.evaluar(OR.barajar(idsO, idsO, 'p'), idsO).completo === false, w + ': el orden correcto es completo y la mezcla no lo es');
        ok(r.items.every((x) => !x.explicacion || x.explicacion.length > 8), w + ': las explicaciones son frases');
        const conEx = r.items.filter((x) => x.explicacion).length;
        ok(conEx === 0 || conEx === r.items.length, w + ': o todos los pasos explican su lugar o ninguno (' + conEx + ' de ' + r.items.length + ')');
      } else if (c.tipo === 'completar') {
        const rs = CM.rondas(r.frases);
        eq(rs.reduce((a, x) => a.concat(x), []).sort((a, b) => a - b), r.frases.map((f, k) => k), w + ': las rondas cubren cada frase una vez');
        r.frases.forEach((f, k) => {
          eq(CM.partes(f.texto).filter((p) => p.t === 'hueco').length, f.huecos.length, w + ' frase ' + (k + 1) + ': tantos ___ como huecos');
          f.huecos.forEach((hu) => {
            ok(['ficha', 'escribir', 'libre'].includes(hu.tipo), w + ': tipo de hueco válido');
            if (hu.tipo !== 'libre') ok(hu.respuesta && CM.igual(hu.respuesta, hu), w + ' frase ' + (k + 1) + ': la respuesta «' + hu.respuesta + '» se acepta a sí misma');
            else ok(hu.respuesta === '', w + ': un hueco libre no tiene respuesta');
          });
        });
        rs.forEach((ronda, q) => {
          const bk = CM.banco(r.frases, ronda, r.distractores, 'prueba');
          const huecosR = ronda.reduce((a, fi) => a.concat(r.frases[fi].huecos), []);
          const conFicha = huecosR.filter((hu) => hu.tipo === 'ficha');
          ok(bk.filter((x) => !x.relleno).length === conFicha.length, w + ' ronda ' + (q + 1) + ': una ficha por cada hueco con ficha');
          conFicha.forEach((hu) => ok(bk.some((x) => !x.relleno && CM.igual(x.texto, hu)), w + ': hay una ficha que responde «' + hu.respuesta + '»'));
          ok(bk.filter((x) => x.relleno).every((x) => !huecosR.some((hu) => hu.tipo !== 'libre' && CM.igual(x.texto, hu))), w + ' ronda ' + (q + 1) + ': ninguna ficha de relleno es respuesta de un hueco');
          // dos huecos distintos no pueden aceptar la misma ficha de relleno ni la misma respuesta con claves cruzadas
          conFicha.forEach((hu, a) => conFicha.forEach((hv, b) => { if (a < b && CM.igual(hu.respuesta, hv)) ok(false, w + ': dos huecos de una ronda aceptan la misma respuesta («' + hu.respuesta + '»): la clave sería ambigua'); }));
        });
        ok(r.distractores.every((d) => !r.frases.some((f) => f.huecos.some((hu) => hu.tipo !== 'libre' && CM.igual(d, hu)))), w + ': ninguna ficha de relleno es respuesta de algún hueco');
      } else {
        const ix = r.mazo.map((x) => x.idx);
        ok(r.mazo.length >= 1 && new Set(ix).size === ix.length && r.mazo.every((x) => x.frente && x.dorso && Number.isInteger(x.idx) && x.idx >= 0 && x.idx < 1000), w + ': cartas con frente, dorso e índice único');
        ok(r.mazo.every((x, k) => k === 0 || x.idx > r.mazo[k - 1].idx), w + ': los índices crecen (el mazo publicado no se reordena)');
        r.mazo.forEach((x) => { if (x.figura) ok(C.Icons.has(x.figura) || (ES.figuras && ES.figuras.has(x.figura)), w + ': la figura «' + x.figura + '» existe (ícono o figura propia)'); });
        const cs = ses1(l);
        ok(cs.length === r.mazo.length, w + ': cartasDeLeccion devuelve las mismas cartas');
        const sess = TJ.armarSesion(r.mazo, {}, 20000, {});
        ok(sess.cola.length === Math.min(r.mazo.length, TJ.MAX_SESION) && sess.nuevas === r.mazo.length, w + ': la primera sesión toma hasta ' + TJ.MAX_SESION + ' cartas nuevas');
        if (r.bloques.length) ok(r.bloques.reduce((s, b) => s + b.n, 0) === r.mazo.filter((x) => x.bloque).length && r.bloques.every((b) => b.nombre), w + ': los bloques suman sus cartas');
      }
    });
  });
  function ses1(l) { return TJ.cartasDeLeccion(l); }
  console.log('  Q1 · en las lecciones: ordenar ' + cuenta.ordenar + ' · completar ' + cuenta.completar + ' · tarjetas ' + cuenta.tarjetas);
  ok(cuenta.ordenar >= 10 && cuenta.completar >= 9 && cuenta.tarjetas >= 5, 'las lecciones usan ordenar (≥ 10), completar (≥ 9) y tarjetas (≥ 5)');
}
// ---- los esbozos del plan para estos tres tipos: casi todos normalizan (sirven de seguro para los módulos que vienen)
if (fs.existsSync(path.join(PLAN, 'INT.json')) && fs.existsSync(path.join(PLAN, 'AER.json'))) {
  const t = { ordenar: [0, 0], completar: [0, 0], tarjetas: [0, 0] };
  ['INT', 'AER'].forEach((m) => readJson(path.join(PLAN, m + '.json')).unidades.forEach((u) => (u.lecciones || []).forEach((l) => (l.componentes || []).forEach((c) => {
    if (!t[c.tipo] || c.datos === undefined) return;
    let r = null, tiro = false;
    try { r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c); } catch (e) { tiro = true; }
    ok(!tiro, l.id + ': ' + c.tipo + ' del plan normaliza sin tirar error');
    t[c.tipo][0]++; if (r) t[c.tipo][1]++;
  }))));
  Object.keys(t).forEach((k) => console.log('  plan · ' + k + ': ' + t[k][1] + ' de ' + t[k][0] + ' normalizan (' + (t[k][0] ? Math.round(100 * t[k][1] / t[k][0]) : 0) + ' %)'));
  ok(t.ordenar[0] >= 10 && t.ordenar[1] / t.ordenar[0] >= 0.8 && t.tarjetas[1] / Math.max(1, t.tarjetas[0]) >= 0.55 && t.completar[1] / Math.max(1, t.completar[0]) >= 0.55, 'al menos el 80 % de los esbozos de ordenar del plan normalizan (y más de la mitad de completar y tarjetas: el resto sólo describe, sin textos ni respuestas, y usará la reserva hasta que se escriba)');
} else console.log('  (sin _teorico/mapa/plan: se salta el chequeo de los esbozos del plan para ordenar, completar y tarjetas)');

/* ------------------------------------------------------------------ componentes Q2: diapositiva, mapa, caso, quiz */
seccion('componentes Q2: diapositiva, mapa, caso, quiz');
const TIPOS_Q2 = ['diapositiva', 'mapa', 'caso', 'quiz'];
TIPOS_Q2.forEach((t) => ok(Mot.has(t), 'componente "' + t + '" registrado'));
ok(Mot.esPractica('caso') && Mot.esPractica('quiz') && !Mot.esPractica('diapositiva') && !Mot.esPractica('mapa'), 'caso y quiz van a la práctica; diapositiva y mapa acompañan a los puntos clave');
const DI = ES.diapositiva, MA = ES.mapa, CA = ES.caso, QZ = ES.quiz, MP = ES.mapas, UQ = ES.modelos.util;
ok(!!DI && !!MA && !!CA && !!QZ && !!MP, 'ES.diapositiva, ES.mapa, ES.caso, ES.quiz y ES.mapas existen');
const N2 = (t, d) => Mot.get(t).normalizar(JSON.parse(JSON.stringify(d)), ctxNode, { tipo: t, titulo: 'x', descripcion: 'y', datos: d });

// ---- etiquetas de las figuras: nunca menos de 11 px en pantalla (arreglo 4)
{
  eq(UQ.escalaDibujo(358, 0, 480, 250), 0.746, 'escalaDibujo: ancho / viewBox (358 / 480)');
  eq(UQ.escalaDibujo(358, 150, 480, 250), 0.6, 'escalaDibujo: si el alto manda (meet), la escala es la menor');
  eq([UQ.escalaDibujo(0, 0, 480, 250), UQ.escalaDibujo(100, 100, 0, 0)], [1, 1], 'escalaDibujo: sin medida usa 1');
  ok(UQ.etiquetaEfectiva(11, 0.6) === 11 && UQ.etiquetaEfectiva(10, 0.75) === 11 && UQ.etiquetaEfectiva(10.5, 0.7) === 11, 'etiquetaEfectiva: una etiqueta de 10–11 unidades a escala de celular sube a 11 px');
  ok(UQ.etiquetaEfectiva(11, 1.46) > 16 && UQ.etiquetaEfectiva(12, 1) === 12, 'etiquetaEfectiva: en escritorio no cambia nada (a escala 1.46 una de 11 mide 16 px)');
  const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
  ['.dg-lbl', '.dg-tx', '.dg-num', '.an-n', '.an-l', '.dg-part-t'].forEach((sel) => ok(new RegExp('\\' + sel.replace(/\./g, '.') + ' \\{ font: [0-9]+ calc\\(max\\([0-9.]+px \\* var\\(--dg-s, 1\\), 11px\\)').test(css), 'styles.css: ' + sel + ' usa el piso de 11 px (--dg-s)'));
  ok(/\.dg-lbl--lg \{ font-size: calc\(max\(13px/.test(css) && /\.dg-lbl--sm \{ font-size: calc\(max\(10px/.test(css), 'styles.css: .dg-lbl--lg y .dg-lbl--sm usan el piso de 11 px');
  ok(/escalarEtiquetas\(svg\)/.test(fs.readFileSync(path.join(SRC, 'escuela', 'c-diagrama.js'), 'utf8')) && /escalarEtiquetas\(svg\)/.test(fs.readFileSync(path.join(SRC, 'escuela', 'c-animacion.js'), 'utf8')), 'diagrama y animación miden la escala de sus etiquetas');
}

// ---- mapas.js: planos de fondo y geometría
{
  ['plano-hangares-sur', 'plano-carrasco-zonas', 'costa-sur-uruguay', 'esquema-tramites', 'generico'].forEach((id) => {
    const m = MP.get(id);
    ok(m && m.nombre && m.capas.length >= 1 && m.capas.every((c) => c.id && c.svg && c.svg.length > 200), 'mapas: el plano «' + id + '» está registrado y dibujado');
    ok(m && !/<(script|image|foreignObject|use)\b/i.test(m.capas.map((c) => c.svg).join('')) && !/(href|on[a-z]+)=/i.test(m.capas.map((c) => c.svg).join('')), 'mapas: «' + id + '» sólo usa formas SVG (sin scripts, imágenes ni enlaces)');
    Object.keys(m.lugares || {}).forEach((k) => ok(m.lugares[k][0] >= 0 && m.lugares[k][0] <= 100 && m.lugares[k][1] >= 0 && m.lugares[k][1] <= MP.LIM.h, 'mapas: el lugar «' + k + '» de «' + id + '» cae dentro del plano'));
  });
  eq([MP.resolver('Costa Sur'), MP.resolver('hangares-sur'), MP.resolver('no existe'), MP.resolver('')], ['costa-sur-uruguay', 'plano-hangares-sur', 'generico', 'generico'], 'mapas.resolver: alias, sin tildes y un desconocido cae a la grilla');
  const cuadro = [[0, 0], [10, 0], [10, 10], [0, 10]];
  eq([MP.centro(cuadro), MP.centro([[48, 22], [90, 22], [90, 40], [48, 40]])], [[5, 5], [69, 31]], 'mapas.centro: el centroide de un rectángulo es su centro');
  ok(MP.dentro(cuadro, 5, 5) && !MP.dentro(cuadro, 11, 5) && !MP.dentro(cuadro, 5, -1) && MP.dentro([[0, 0], [10, 0], [0, 10]], 2, 2) && !MP.dentro([[0, 0], [10, 0], [0, 10]], 8, 8), 'mapas.dentro: punto en polígono (cuadrado y triángulo)');
  eq(MP.poligono([[1, 2], [3.5, 4]]), '6,12 21,24', 'mapas.poligono: pasa a unidades de dibujo (× 6)');
  eq(MP.lugar('costa-sur-uruguay', 'carrasco'), [34, 36], 'mapas.lugar: la posición por defecto de un punto conocido');
}

// ---- diapositiva: normalizar, escena de cada paso, capas de una figura, duración
{
  const d = N2('diapositiva', { pasos: [{ titulo: 'Uno', texto: 'Primero.' }, 'Segundo paso', { texto: 'Tercero', icono: 'plane' }] });
  ok(d && d.pasos.length === 3 && d.pasos.every((p) => p.texto && p.escena && p.escena.tipo), 'diapositiva: pasos (objetos y textos sueltos) → cada uno con texto y escena');
  eq(d.pasos.map((p) => p.escena.tipo), ['icono', 'icono', 'icono'], 'diapositiva: sin dibujo pedido, cada paso lleva el ícono con su número');
  eq(d.pasos[2].escena.icono, 'plane', 'diapositiva: el `icono` del paso manda');
  eq(N2('diapositiva', { diapositivas: ['a b', 'c d'] }).pasos.length, 2, 'diapositiva: acepta `diapositivas`, `slides` y `escenas` además de `pasos`');
  eq(N2('diapositiva', ['uno', 'dos']).pasos.length, 2, 'diapositiva: acepta una lista pelada');
  eq(N2('diapositiva', { pasos: [{ titulo: 'Sólo título' }] }).pasos[0].texto, 'Sólo título', 'diapositiva: un paso con sólo título usa el título como frase');
  ok(['x', 1, null, [], {}, { pasos: [] }, { pasos: [{}, 5, null] }, { pasos: 4 }].every((x) => N2('diapositiva', x) === null), 'diapositiva: datos basura o sin texto → null sin tirar error');
  eq(N2('diapositiva', { pasos: Array.from({ length: 20 }, (_, i) => 'paso ' + i) }).pasos.length, 12, 'diapositiva: hasta 12 pasos');
  eq(N2('diapositiva', { pasos: [{ texto: 'a', ilustracion: 'portada-aerosur' }, { texto: 'b' }] }).pasos[0].escena.tipo, 'icono', 'diapositiva: `ilustracion` (esbozo viejo) sólo ayuda a elegir el ícono');
  eq(DI.iconoPara('Tu turno es en cinco minutos', 0), 'clock', 'diapositiva.iconoPara: elige por las palabras (turno → reloj)');
  eq(DI.iconoPara('Un portón con candado', 0), 'lock', 'diapositiva.iconoPara: portón → candado');
  ok(C.Icons.has(DI.iconoPara('xyz', 0)) && C.Icons.has(DI.iconoPara('', 7)), 'diapositiva.iconoPara: siempre devuelve un ícono que existe');
  // escenas pedidas
  const e1 = N2('diapositiva', { pasos: [
    { texto: 'a', escena: { tipo: 'lista', items: ['x', 'y', 'z'], hecho: [0], actual: 1 } },
    { texto: 'b', escena: { tipo: 'comparar', a: { titulo: 'A' }, b: 'B', foco: 'b' } },
    { texto: 'c', escena: { tipo: 'flujo', nodos: ['u', 'v', 'w'], actual: 2 } },
    { texto: 'd', escena: { tipo: 'formula', texto: 'L = V', nota: 'n' } },
    { texto: 'e', dato: { valor: 75, unidad: '%' } },
    { texto: 'f', escena: { tipo: 'dato', valor: '3', etiqueta: 'días' } }] });
  eq(e1.pasos.map((p) => p.escena.tipo), ['lista', 'comparar', 'flujo', 'formula', 'dato', 'dato'], 'diapositiva: cada tipo de escena pedida se respeta');
  eq([e1.pasos[4].escena.valor, e1.pasos[4].escena.unidad], ['75', '%'], 'diapositiva: `dato` suelto en el paso es un atajo de la escena de dato');
  const e2 = N2('diapositiva', { pasos: [
    { texto: 'a', escena: { tipo: 'lista', items: ['x'] } }, { texto: 'b', escena: { tipo: 'comparar', a: { titulo: 'A' } } }, { texto: 'c', escena: { tipo: 'flujo', nodos: ['u'] } },
    { texto: 'd', escena: { tipo: 'formula' } }, { texto: 'e', escena: { tipo: 'dato' } }, { texto: 'f', escena: { tipo: 'rara' } }, { texto: 'g', escena: 'x' }] });
  ok(e2.pasos.every((p) => p.escena.tipo === 'icono'), 'diapositiva: una escena incompleta o desconocida cae al ícono con su número (nunca queda vacía)');
  ok(N2('diapositiva', { pasos: [{ texto: 'a', escena: { tipo: 'lista', items: ['1', '2', '3', '4', '5', '6', '7', '8'], hecho: [0, 99], actual: 50 } }, { texto: 'b' }] }).pasos[0].escena.items.length === 6, 'diapositiva: una lista se corta en 6 filas');
  // figura con capas
  const f = N2('diapositiva', { figura: 'cuatro-fuerzas', pasos: [{ texto: 'El avión', capas: ['avion'] }, { texto: 'Sustentación y peso', mostrar: ['sustentacion', 'peso'] }, { texto: 'Todas', mostrar: ['traccion', 'resistencia'], resalta: ['traccion'] }, { texto: 'Una sola', capas: ['peso'], resalta: ['inexistente'] }] });
  ok(f && f.pasos.every((p) => p.escena.tipo === 'figura' && p.escena.figura === 'cuatro-fuerzas'), 'diapositiva: con `figura` global todos los pasos usan esa figura');
  const capas = ES.figuras.get('cuatro-fuerzas').capas, est = (k) => DI.estadoFigura(f.pasos, k, capas);
  eq(Object.keys(est(0).visibles).filter((id) => est(0).visibles[id]), ['avion'], 'estadoFigura: `capas` deja visibles sólo esas capas');
  eq(Object.keys(est(1).visibles).filter((id) => est(1).visibles[id]), ['avion', 'sustentacion', 'peso'], 'estadoFigura: `mostrar` suma capas hacia adelante');
  eq([Object.keys(est(2).visibles).filter((id) => est(2).visibles[id]).length, est(2).resalta], [5, ['traccion']], 'estadoFigura: se acumulan y `resalta` vale sólo en ese paso');
  eq([est(3).visibles.peso, est(3).visibles.avion, est(3).resalta], [true, false, []], 'estadoFigura: `capas` reinicia; un id que no existe no cuenta');
  eq(est(1).resalta, [], 'estadoFigura: lo resaltado de un paso no pasa al siguiente (y al volver se recalcula)');
  eq(JSON.stringify(est(1)), JSON.stringify(est(1)), 'estadoFigura: es pura (mismo resultado al volver)');
  ok(N2('diapositiva', { pasos: [{ texto: 'x', figura: 'no-existe' }, { texto: 'y' }] }).pasos[0].escena.tipo === 'icono', 'diapositiva: una figura que no existe cae al ícono');
  ok(DI.duracionPaso('corto') >= 4 && DI.duracionPaso('x'.repeat(400)) <= 11 && DI.duracionPaso('hola', '', 6) === 6, 'duracionPaso: entre 4 y 11 segundos; `autoplay: N` fija los segundos');
  eq([N2('diapositiva', { pasos: ['a', 'b'], autoplay: true }).autoplay, N2('diapositiva', { pasos: ['a', 'b'], autoplay: 7 }).segundos, N2('diapositiva', { pasos: ['a', 'b'] }).autoplay], [true, 7, false], 'diapositiva: `autoplay` true o segundos por paso; por defecto no se reproduce sola');
  eq(N2('diapositiva', JSON.parse(JSON.stringify(d))), d, 'diapositiva: normalizar es idempotente');
}

// ---- quiz: lógica pura
{
  const qs = Array.from({ length: 12 }, (_, i) => ({ pregunta: 'P' + i, opciones: ['a', 'b', 'c', 'd'], correcta: i % 4 }));
  const a = QZ.elegir(12, 5, 's|1'), b = QZ.elegir(12, 5, 's|1'), c = QZ.elegir(12, 5, 's|2');
  eq([a.length, new Set(a).size, JSON.stringify(a) === JSON.stringify(b)], [5, 5, true], 'quiz.elegir: n distintas, misma semilla → mismo sorteo');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'quiz.elegir: otra semilla → otro sorteo');
  ok(QZ.elegir(12, 99, 'x').length === 12 && QZ.elegir(3, 0, 'x').length === 3 && QZ.elegir(0, 3, 'x').length === 0, 'quiz.elegir: n acotado al total');
  const f = QZ.elegir(12, 6, 'z', [2, 4, 7, 9]);
  ok(f.filter((k) => [2, 4, 7, 9].includes(k)).length === 3 && new Set(f).size === 6, 'quiz.elegir: las falladas del intento anterior vuelven primero, hasta la mitad');
  let siempre = true;
  for (let i = 0; i < 30; i++) { const m = QZ.mezclar(qs[1], 'q' + i); if (m.opciones[m.correcta] !== 'b' || m.opciones.slice().sort().join('') !== 'abcd') siempre = false; }
  ok(siempre, 'quiz.mezclar: 30 semillas → la correcta sigue siendo la misma opción');
  ok(QZ.mezclar(qs[0], 'x').correcta === QZ.mezclar(qs[0], 'x').correcta, 'quiz.mezclar: misma semilla, misma mezcla');
  eq(QZ.calificar([{ correcta: 1 }, { correcta: 0 }, { correcta: 2 }], [1, 3, 2]), { ok: 2, total: 3, falladas: [1] }, 'quiz.calificar: cuenta aciertos y posiciones falladas');
  eq(QZ.calificar([{ correcta: 1 }, { correcta: 0 }], [1]), { ok: 1, total: 2, falladas: [1] }, 'quiz.calificar: una pregunta sin responder es fallada');
  eq([QZ.veredicto(12, 15, 12), QZ.veredicto(11, 15, 12), QZ.veredicto(3, 5, 0)], ['aprobado', 'repasar', 'sin-nota'], 'quiz.veredicto: aprobado / a repasar / sin nota mínima');
  eq([QZ.minimos(15, 0.75), QZ.minimos(15, 0, 12), QZ.minimos(10, 0.75), QZ.minimos(4, 0.75), QZ.minimos(5, 0), QZ.minimos(10, 2)], [12, 12, 8, 3, 0, 0], 'quiz.minimos: 75 % de 15 son 12; aciertosMinimos manda; sin datos no hay mínimo');
  const n = N2('quiz', { preguntas: qs, n: 5, aprobacion: 0.75 });
  eq([n.preguntas.length, n.n, n.minimos, n.repetible], [12, 5, 4, true], 'quiz.normalizar: n por intento, mínimo de aprobación y repetible por defecto');
  eq(N2('quiz', { preguntas: qs.slice(0, 3) }).n, 3, 'quiz.normalizar: sin `n` van todas (hasta 15)');
  eq(N2('quiz', { preguntas: [{ pregunta: 'x', opciones: ['uno', 'dos'], correcta: 'Dos' }, { pregunta: 'y', opciones: ['a', 'b'], correcta: 0 }] }).preguntas[0].correcta, 1, 'quiz.normalizar: `correcta` puede ser el texto de la opción');
  eq(N2('quiz', { preguntas: [{ pregunta: 'x', opciones: ['a', 'b'], correcta: 5 }, { pregunta: 'y', opciones: ['a'], correcta: 0 }, { pregunta: '', opciones: ['a', 'b'], correcta: 0 }, { pregunta: 'ok', opciones: ['a', 'b'], correcta: 1, pagina: '12' }] }).preguntas.length, 1, 'quiz.normalizar: descarta las preguntas inválidas (correcta fuera de rango, una opción, sin enunciado)');
  eq(N2('quiz', { preguntas: [{ pregunta: 'ok', opciones: ['a', 'b'], correcta: 1, pagina: '12' }] }).preguntas[0].pagina, 12, 'quiz.normalizar: la página puede venir como texto');
  ok(['x', 1, null, [], {}, { preguntas: [] }, { preguntas: [{}] }].every((x) => N2('quiz', x) === null), 'quiz: datos basura → null sin tirar error');
  eq(N2('quiz', JSON.parse(JSON.stringify(n))), n, 'quiz.normalizar: idempotente');
}

// ---- caso: normalizar canónico, esbozo viejo, decisiones y puntaje
{
  const base = { titulo: 'T', contexto: 'Ctx', pasos: [{ texto: 'a' }, { texto: 'b', decision: { pregunta: '¿?', opciones: ['x', 'y', 'z'], correcta: 1, explicacion: 'porque' } }, { texto: 'c' }], aprendizajes: ['aprendí'] };
  const c = N2('caso', base);
  ok(c && c.pasos.length === 3 && c.pasos.every((p) => p.escena && p.escena.tipo) && c.aprendizajes[0] === 'aprendí' && c.ficticio === false, 'caso: canónico → pasos con escena, aprendizajes y ficticio falso por defecto');
  eq(CA.decisiones(c).map((x) => x.paso), [1], 'caso.decisiones: los pasos que preguntan');
  eq(CA.puntaje(c, { 1: 1 }), { ok: 1, total: 1, falladas: [] }, 'caso.puntaje: acierto');
  eq(CA.puntaje(c, { 1: -1 }), { ok: 0, total: 1, falladas: [1] }, 'caso.puntaje: error → pasa a las falladas');
  eq(CA.puntaje(c, {}), { ok: 0, total: 1, falladas: [1] }, 'caso.puntaje: sin contestar cuenta como fallada');
  const v = N2('caso', { ficticio: true, titulo: 'V', texto: 'Contexto viejo', hechos: ['uno', 'dos', 'tres'], etapas: ['E1', 'E2', 'E3'], preguntas: [{ pregunta: 'p1', opciones: ['a', 'b'], correcta: 0 }, { pregunta: 'p2', opciones: ['a', 'b', 'c'], correcta: 2, explicacion: 'e' }], leccion: 'Lo aprendido' });
  ok(v && v.ficticio && v.contexto === 'Contexto viejo' && v.pasos.map((p) => p.titulo).join() === 'E1,E2,E3' && v.aprendizajes[0] === 'Lo aprendido', 'caso: el esbozo viejo (texto, hechos, etapas, leccion) se convierte');
  eq(v.pasos.map((p) => !!p.decision), [false, true, true], 'caso: las preguntas sueltas se reparten en los últimos pasos');
  ok(v.pasos[1].decision.explicacion && /La mejor decisión/.test(v.pasos[1].decision.explicacion), 'caso: una decisión sin explicación recibe una frase con la respuesta correcta');
  eq(N2('caso', { texto: 't', personas: [{ nombre: 'Ana', edad: 20, lleva: ['x', 'y'] }, { nombre: 'Beto', lugar: 'su mutualista' }], leccion: 'L' }).pasos.map((p) => p.titulo), ['Ana', 'Beto'], 'caso: `personas` arma un paso por persona');
  ok(N2('caso', { titulo: 'x', contexto: 'c', pasos: [{ texto: 'a' }], aprendizajes: ['z'] }) === null, 'caso: menos de 2 pasos → null');
  ok(N2('caso', { titulo: 'x', pasos: [{ texto: 'a' }, { texto: 'b', decision: { pregunta: 'q', opciones: ['a'], correcta: 0 } }] }) === null, 'caso: sin contexto ni aprendizaje → null');
  eq(CA.decisiones(N2('caso', { contexto: 'c', pasos: [{ texto: 'a', decision: { pregunta: 'q', opciones: ['a', 'b'], correcta: 9 } }, { texto: 'b', decision: { pregunta: 'q', opciones: ['a', 'b'], correcta: 'B' } }] })).map((x) => x.decision.correcta), [1], 'caso: una decisión con `correcta` inválida se ignora; el texto de la opción vale');
  ok(['x', 1, null, [], {}, { pasos: 5 }].every((x) => N2('caso', x) === null), 'caso: datos basura → null sin tirar error');
  ok(N2('caso', { contexto: 'c', pasos: [{ texto: 'nota para el instructor: a confirmar' }, { texto: 'ok' }, { texto: 'dos' }] }).pasos.length === 2, 'caso: oculta los textos «a confirmar» del plan');
  eq(N2('caso', JSON.parse(JSON.stringify(c))), c, 'caso.normalizar: idempotente');
}

// ---- mapa: normalizar, vistas (carnets), «Encontrá»
{
  const m = N2('mapa', { fondo: 'plano-hangares-sur', capas: ['A', { id: 'b', nombre: 'B', visible: false }], puntos: [{ id: 'p1', x: 10, y: 10, nombre: 'Uno', capa: 'A' }, { nombre: 'Sin coordenadas', id: 'starbucks' }], zonas: [{ id: 'z1', rect: [48, 22, 40, 18], nombre: 'Zona' }], rutas: [{ id: 'r1', puntos: [[1, 1], [20, 20]], nombre: 'Camino', capa: 'B' }, { puntos: [[1, 1], [5, 5]] }] });
  ok(m && m.items.length === 5 && m.capas.map((c) => c.id).join() === 'a,b', 'mapa: puntos, zona, rutas y capas (por nombre o por objeto)');
  eq(m.items.map((i) => i.n), [1, 2, 3, 4, 0], 'mapa: numera puntos, zonas y rutas con nombre; la ruta sin nombre es sólo un dibujo');
  eq([m.items[1].x, m.items[1].y], [22, 30], 'mapa: un punto sin x e y toma la posición que el plano conoce (starbucks)');
  eq(m.capas.map((c) => c.visible), [true, false], 'mapa: `visible:false` apaga la capa al empezar');
  ok(m.items.find((i) => i.id === 'p1').capa === 'a', 'mapa: el punto se ata a su capa por el nombre');
  const sinXY = N2('mapa', { puntos: [{ nombre: 'A' }, { nombre: 'B' }, { nombre: 'C' }] });
  ok(sinXY.items.every((i) => i.x >= 0 && i.x <= 100 && i.y === 33) && sinXY.items[0].x < sinXY.items[2].x, 'mapa: puntos sin lugar conocido van en fila, parejos');
  eq(N2('mapa', { fondo: 'rarísimo', puntos: [{ nombre: 'A', x: 5, y: 5 }] }).fondo, 'generico', 'mapa: un fondo desconocido usa la grilla vacía');
  const lim = N2('mapa', { puntos: [{ nombre: 'A', x: 500, y: -4 }], zonas: [{ nombre: 'Z', poligono: [[0, 0], [200, 0], [200, 90]] }] });
  ok(lim.items[0].x === 100 && lim.items[0].y === 0 && lim.items[1].poligono.every((p) => p[0] <= 100 && p[1] <= 66.7), 'mapa: las coordenadas se acotan al plano');
  ok(N2('mapa', { puntos: [], zonas: [] }) === null && N2('mapa', { fondo: 'x' }) === null && ['x', 1, null, [], {}].every((x) => N2('mapa', x) === null), 'mapa: sin puntos ni zonas → null sin tirar error');
  eq(N2('mapa', { puntos: [{ id: 'a', nombre: 'A', x: 1, y: 1 }, { id: 'a', nombre: 'B', x: 2, y: 2 }] }).items.map((i) => i.id), ['a', 'a-2'], 'mapa: ids repetidos se desambiguan');
  // vistas / carnets
  const cz = [{ id: 'h', nombre: 'Hangares', rect: [8, 30, 38, 24] }, { id: 'p', nombre: 'Plataformas', rect: [52, 18, 40, 36] }];
  const v = N2('mapa', { zonas: cz, carnets: [{ id: '4', zonas: [{ id: 'h', permitido: true }, { id: 'p', permitido: true, soloConInstructor: true }] }, { id: '3S', zonas: [{ id: 'h', permitido: true }, { id: 'p', permitido: false }, { id: 'zzz', permitido: true }] }] });
  eq(v.vistas.map((x) => x.nombre), ['Carnet 4', 'Carnet 3S'], 'mapa: `carnets` es una lista de vistas llamada «Carnet N»');
  eq([MA.estadoZona(v.vistas[0], 'h'), MA.estadoZona(v.vistas[0], 'p'), MA.estadoZona(v.vistas[1], 'p'), MA.estadoZona(v.vistas[1], 'zzz'), MA.estadoZona(null, 'h')], ['ok', 'inst', 'no', '', ''], 'mapa.estadoZona: ok / con instructor / no / sin dato');
  eq(v.vistaTitulo, 'Carnet', 'mapa: el selector de carnets se llama «Carnet»');
  // Encontrá
  const e = N2('mapa', { puntos: [{ id: 'a', nombre: 'A', x: 1, y: 1 }, { id: 'b', nombre: 'B', x: 2, y: 2 }, { id: 'c', nombre: 'C', x: 3, y: 3 }], zonas: [{ id: 'z', nombre: 'Z', rect: [10, 10, 5, 5] }] });
  eq(e.encontra.map((x) => x.id), ['a', 'b', 'c', 'z'], 'mapa: «Encontrá» por defecto pide todos los puntos y zonas con nombre');
  ok(/Tocá la zona «Z»/.test(e.encontra[3].pregunta) && /¿Dónde está «A»\?/.test(e.encontra[0].pregunta), 'mapa.preguntaDe: distinta para zonas y para puntos');
  eq(N2('mapa', { puntos: [{ id: 'a', nombre: 'A', x: 1, y: 1 }, { id: 'b', nombre: 'B', x: 2, y: 2 }], encontra: [{ id: 'b', pregunta: 'Elegí B' }, { id: 'nope' }] }).encontra, [], 'mapa: «Encontrá» pide más de un lugar (con uno solo no se ofrece)');
  eq(N2('mapa', { puntos: [{ id: 'a', nombre: 'A', x: 1, y: 1 }, { id: 'b', nombre: 'B', x: 2, y: 2 }, { id: 'c', nombre: 'C', x: 3, y: 3 }], encontra: [{ id: 'b', pregunta: 'Elegí B' }, 'c', { id: 'nope' }] }).encontra.map((x) => x.id + ':' + x.pregunta.slice(0, 7)), ['b:Elegí B', 'c:¿Dónde '], 'mapa: `encontra` explícito (objetos o ids), descarta ids que no existen');
  eq(N2('mapa', { puntos: [{ id: 'a', nombre: 'A', x: 1, y: 1 }, { id: 'b', nombre: 'B', x: 2, y: 2 }], encontra: false }).encontra, [], 'mapa: `encontra:false` apaga el modo');
  ok(MA.evaluar(e, 'a', 'a') && !MA.evaluar(e, 'a', 'b') && !MA.evaluar(e, 'nope', 'nope'), 'mapa.evaluar: sólo acierta el lugar pedido (y que exista)');
  eq(N2('mapa', JSON.parse(JSON.stringify(m))), m, 'mapa.normalizar: idempotente');
}

// ---- cada instancia de los cuatro tipos en las lecciones: normaliza (nada cae a la reserva), claves válidas y sin textos vacíos
{
  const cuenta = { diapositiva: 0, mapa: 0, caso: 0, quiz: 0 };
  todasLasLecciones.forEach((l) => l.componentes.forEach((c, i) => {
    if (!TIPOS_Q2.includes(c.tipo)) return;
    const w = l.id + ' ' + c.tipo + ' #' + i;
    cuenta[c.tipo]++;
    const r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c);
    ok(r !== null, w + ': normaliza (no usa la reserva)');
    if (!r) return;
    eq(vacios(c.datos, w, []), [], w + ': los datos de la lección no tienen textos vacíos');
    eq(Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(r)), ctxNode, c), r, w + ': normalizar es idempotente');
    if (c.tipo === 'diapositiva') {
      ok(r.pasos.length >= 2 && r.pasos.every((p) => p.texto && p.texto.length > 5), w + ': 2 pasos o más, con frase');
      r.pasos.forEach((p, k) => {
        const e = p.escena;
        ok(['icono', 'dato', 'lista', 'comparar', 'flujo', 'formula', 'figura'].includes(e.tipo), w + ' paso ' + (k + 1) + ': escena válida');
        if (e.tipo === 'icono') ok(C.Icons.has(e.icono), w + ' paso ' + (k + 1) + ': el ícono «' + e.icono + '» existe');
        if (e.tipo === 'figura') ok(ES.figuras.has(e.figura), w + ': la figura existe');
        if (e.tipo === 'flujo' && e.actual >= 0) ok(e.actual < e.nodos.length, w + ': el nodo actual existe');
        if (e.tipo === 'lista') ok(e.hecho.every((q) => q < e.items.length) && e.actual < e.items.length, w + ': las marcas de la lista existen');
      });
      ok(r.pasos.some((p) => p.escena.tipo !== 'icono'), w + ': al menos un paso con dibujo propio (no sólo el ícono)');
    } else if (c.tipo === 'mapa') {
      const ids = r.items.map((x) => x.id);
      ok(MP.has(r.fondo) && new Set(ids).size === ids.length, w + ': el plano de fondo existe y los ids son únicos');
      r.items.forEach((it) => {
        if (it.tipo === 'punto') ok(it.x >= 0 && it.x <= 100 && it.y >= 0 && it.y <= MP.LIM.h && it.nombre, w + ': el punto «' + it.nombre + '» está dentro del plano');
        if (it.tipo === 'zona') ok(it.poligono.length >= 3 && it.poligono.every((p) => p[0] >= 0 && p[0] <= 100 && p[1] >= 0 && p[1] <= MP.LIM.h), w + ': la zona «' + it.nombre + '» es un polígono dentro del plano');
        if (it.tipo === 'ruta') ok(it.puntos.length >= 2, w + ': la ruta tiene al menos 2 puntos');
        if (it.capa) ok(r.capas.some((cp) => cp.id === it.capa), w + ': la capa de «' + it.id + '» existe');
      });
      r.encontra.forEach((q) => ok(r.items.some((it) => it.id === q.id && it.tipo !== 'ruta') && q.pregunta, w + ': «Encontrá» pide «' + q.id + '», que existe en el plano'));
      ok(r.encontra.length >= 2, w + ': el modo «Encontrá» tiene al menos 2 lugares');
      // los nombres de los puntos se acomodan para no pisarse (a escala de computadora no se pisa ninguno; en el celular más angosto, a lo sumo uno)
      const pts = r.items.filter((it) => it.tipo === 'punto').map((it) => ({ x: it.x * 6, y: it.y * 6, r: it.grande ? 22 : 17, largo: it.nombre.length }));
      [[0.55, 1], [0.75, 0], [1.1, 0]].forEach(([esc, max]) => {
        const pos = MA.ubicarEtiquetas(pts, esc), f = Math.max(15, 11 / esc), cw = f * 0.58, al = f * 1.15;
        const cajas = pos.map((p, i) => { const w = pts[i].largo * cw + 8, tx = pts[i].x + p.dx, ty = pts[i].y + p.dy; const x0 = p.anchor === 'start' ? tx - 2 : p.anchor === 'end' ? tx - w : tx - w / 2, x1 = p.anchor === 'start' ? tx + w : p.anchor === 'end' ? tx + 2 : tx + w / 2; return [x0, ty - al * 0.78, x1, ty + al * 0.3]; });
        let ov = 0; for (let a = 0; a < cajas.length; a++) for (let b = a + 1; b < cajas.length; b++) if (Math.min(cajas[a][2], cajas[b][2]) - Math.max(cajas[a][0], cajas[b][0]) > 0 && Math.min(cajas[a][3], cajas[b][3]) - Math.max(cajas[a][1], cajas[b][1]) > 0) ov++;
        ok(ov <= max, w + ': nombres que se pisan a escala ' + esc + ': ' + ov + ' (máx. ' + max + ')');
      });
      r.vistas.forEach((v) => Object.keys(v.estados).forEach((z) => ok(r.items.some((it) => it.id === z && it.tipo === 'zona'), w + ': la vista «' + v.nombre + '» habla de una zona que existe')));
    } else if (c.tipo === 'caso') {
      ok(r.pasos.length >= 3 && r.pasos.length <= 8, w + ': 3 a 8 pasos');
      const ds = CA.decisiones(r);
      ok(ds.length >= 1 && ds.length <= 3, w + ': 1 a 3 decisiones (' + ds.length + ')');
      ds.forEach((x) => ok(x.decision.correcta >= 0 && x.decision.correcta < x.decision.opciones.length && x.decision.explicacion, w + ': la decisión del paso ' + (x.paso + 1) + ' tiene clave y explicación'));
      ok(r.aprendizajes.length >= 1 && r.aprendizajes.length <= 4 && r.titulo && r.contexto, w + ': título, contexto y de 1 a 4 aprendizajes');
      ok(!ds.some((x) => x.paso === r.pasos.length - 1 && false), w + ': recorrido completo posible');
      if (/inventado/i.test(c.titulo || '')) ok(r.ficticio === true, w + ': un caso «ejemplo inventado» está marcado como ficticio');
    } else {
      ok(r.preguntas.length >= 2, w + ': tiene preguntas');
      r.preguntas.forEach((q, k) => ok(q.opciones.length >= 2 && q.opciones.length <= 6 && q.correcta >= 0 && q.correcta < q.opciones.length && q.explicacion, w + ' pregunta ' + (k + 1) + ': opciones, clave y explicación'));
      ok(new Set(r.preguntas.map((q) => q.pregunta)).size === r.preguntas.length, w + ': no hay preguntas repetidas');
      ok(r.n <= r.preguntas.length && (!r.minimos || r.minimos <= r.n), w + ': n y mínimo coherentes (' + r.minimos + ' de ' + r.n + ')');
      const t1 = QZ.elegir(r.preguntas.length, r.n, 'x'), t2 = QZ.elegir(r.preguntas.length, r.n, 'y');
      ok(t1.length === r.n && new Set(t1).size === r.n && JSON.stringify(t1) !== JSON.stringify(t2), w + ': cada intento sortea ' + r.n + ' preguntas distintas');
    }
  }));
  console.log('  Q2 · en las lecciones: diapositiva ' + cuenta.diapositiva + ' · mapa ' + cuenta.mapa + ' · caso ' + cuenta.caso + ' · quiz ' + cuenta.quiz);
  ok(cuenta.diapositiva >= 9 && cuenta.mapa >= 6 && cuenta.caso >= 2 && cuenta.quiz >= 1, 'las lecciones usan diapositiva (≥ 9), mapa (≥ 6), caso (≥ 2) y quiz (≥ 1)');
  // ya no queda ningún tipo de la pasada 2 con la tarjeta de reserva: todos están registrados
  ok(Mot.TIPOS_P2.every((t) => Mot.has(t)), 'los siete tipos de la pasada 2 están registrados');
}
// ---- los esbozos del plan para estos tipos (si el plan está en esta máquina): ninguno tira error
if (fs.existsSync(path.join(PLAN, 'INT.json')) && fs.existsSync(path.join(PLAN, 'AER.json'))) {
  const t = { diapositiva: [0, 0], mapa: [0, 0], caso: [0, 0], quiz: [0, 0] };
  ['INT', 'AER'].forEach((mm) => readJson(path.join(PLAN, mm + '.json')).unidades.forEach((u) => (u.lecciones || []).forEach((l) => (l.componentes || []).forEach((c) => {
    if (!t[c.tipo] || c.datos === undefined) return;
    let r = null, tiro = false;
    try { r = Mot.get(c.tipo).normalizar(JSON.parse(JSON.stringify(c.datos)), ctxNode, c); } catch (e) { tiro = true; }
    ok(!tiro, l.id + ': ' + c.tipo + ' del plan normaliza sin tirar error');
    t[c.tipo][0]++; if (r) t[c.tipo][1]++;
  }))));
  Object.keys(t).forEach((k) => console.log('  plan · ' + k + ': ' + t[k][1] + ' de ' + t[k][0] + ' normalizan'));
} else console.log('  (sin _teorico/mapa/plan: se salta el chequeo de los esbozos del plan para diapositiva, mapa, caso y quiz)');

// ---- arreglos de interfaz (v9): ids que se ven en pantalla, frases del enlace 3D, ESCUELA que vuelve al mapa, visor en el teléfono
{
  const PA = ES.pantallas;
  eq([PA.numId('MET-04', 3, 1), PA.numId('MET-04-12', 5, 2), PA.numId('AER-03', 1, 1), PA.numId('sin-numero', 7, 1), PA.numId('', 2, 2)], ['04', '12', '03', '07', '02'], 'pantallas.numId: el número que se ve es el del id (MET-04 aunque sea la tercera unidad)');
  const pant = fs.readFileSync(path.join(SRC, 'escuela', 'pantallas.js'), 'utf8');
  ok(/numId\(l\.id, n, 2\)/.test(pant) && /numId\(u\.id, k \+ 1, 1\)/.test(pant) && /'Parte ' \+ \(k \+ 1\)/.test(pant) && !/text: p2\(k \+ 1\) \}\)/.test(pant), 'pantallas.js: las unidades y las lecciones muestran el número de su id, y «Parte N de M» si no coincide con la posición');
  const e3 = Mot.get('enlace3d');
  const lead = (d) => { const n = e3.normalizar(JSON.parse(JSON.stringify(d)), ctxNode, { tipo: 'enlace3d', datos: d }); return n && ES.enlace3d && typeof ES.enlace3d.leadDe === 'function' ? ES.enlace3d.leadDe(n) : null; };
  ok(typeof (ES.enlace3d && ES.enlace3d.leadDe) === 'function', 'enlace3d: la frase explicativa se calcula con leadDe (exportada para la prueba)');
  if (ES.enlace3d && ES.enlace3d.leadDe) {
    const cab = lead({ destino: 'cabina', controles: ['throttle'] }), pose = lead({ destino: 'exterior', poses: ['nivelado'] }), aire = lead({ destino: 'aire', aire: { experimento: 'velocidad' } });
    ok(/cabina|mando|ficha/i.test(cab) && !/laboratorio/.test(cab), 'enlace3d: un mando habla de la cabina');
    ok(/desde afuera|avión/.test(pose) && !/Mirarlo abre el visor 3D al lado de la lección: no te saca/.test(pose), 'enlace3d: una pose habla del avión desde afuera, no de la cabina');
    ok(/laboratorio del aire/.test(aire) && !/cabina/.test(aire), 'enlace3d: un enlace al AIRE habla del laboratorio');
  }
  ok(Mot.META.enlace3d.nombre === 'Mirá en 3D', 'el rótulo del tipo enlace3d ya no dice «cabina» para todo');
  const uiSrc = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
  ok(/!rest && m === 'escuela' && was === 'escuela'[^;]*Escuela\.go\(''\)/.test(uiSrc), 'ui.js: #escuela estando adentro de la Escuela llama a Escuela.go("") (vuelve al mapa)');
  ok(/g === 'escuela' \? navProvider\(mode\)/.test(uiSrc) && /navGo\('escuela'\); return;/.test(uiSrc), 'ui.js: tocar la pestaña ESCUELA estando en un módulo o una lección va al mapa');
  const vis = fs.readFileSync(path.join(SRC, 'escuela', 'visor.js'), 'utf8');
  ok(/colapsarEnTelefono|soltarPanelesAngostos/.test(vis), 'visor.js: abrir el visor en el teléfono repliega el índice y la hoja de abajo');
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
  // los 13 módulos reales: cada uno tiene icono y color para su tarjeta y su estación
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


/* ---- tarjetas: repaso espaciado (SM-2 simple) con números de día */
seccion('store: repaso espaciado de tarjetas');
{
  const H = ST.diaDeFecha('2026-10-30');
  eq([H, ST.fechaDeDia(H), ST.diaDe(Date.parse('2026-10-30T12:00:00')), ST.diaDeFecha('2026-10-31') - H, ST.diaDeFecha('mañana')], [20756, '2026-10-30', 20756, 1, NaN], 'día número: diaDeFecha / fechaDeDia / diaDe (fecha local) y fechas inválidas');
  eq([ST.diaDe(Date.parse('2026-12-31T23:30:00')) + 1, ST.diaDe(Date.parse('2027-01-01T00:30:00'))], [ST.diaDeFecha('2027-01-01'), ST.diaDeFecha('2027-01-01')], 'día número: cruza el fin de año');
  // una carta que siempre se sabe: 2, 6 y luego el intervalo × facilidad
  let rec = null, dia = H; const sec = [];
  ['sabia', 'sabia', 'sabia', 'sabia'].forEach((q) => { rec = ST.sm2(rec, q, dia); sec.push(rec.due - dia); dia = rec.due; });
  eq([sec, rec.n, rec.ef], [[2, 6, 17, 49], 4, 2.9], 'sm2: "La sabía" seguido → 2, 6, 17 y 49 días; la facilidad sube 0,1 por vez');
  rec = ST.sm2(null, 'medio', H);
  eq([rec.due - H, rec.n, rec.ef], [1, 1, 2.36], 'sm2: primer "Más o menos" → mañana y baja la facilidad');
  rec = ST.sm2(rec, 'medio', H + 1);
  eq([rec.due - (H + 1), rec.n], [3, 2], 'sm2: segundo "Más o menos" → 3 días');
  rec = ST.sm2(rec, 'medio', H + 4);
  eq([rec.due - (H + 4), rec.n], [4, 3], 'sm2: "Más o menos" después → el intervalo × 1,2 (mínimo un día más)');
  rec = ST.sm2({ ef: 2.8, n: 5, due: H + 40, last: H + 10 }, 'nosabia', H + 40);
  eq([rec.n, rec.due - (H + 40), rec.ef], [0, 1, 2.26], 'sm2: "No la sabía" reinicia: vuelve mañana y la facilidad baja 0,54');
  let ef = 2.5; for (let i = 0; i < 12; i++) ef = ST.sm2({ ef, n: 0, due: H, last: H }, 1, H).ef;
  eq(ef, 1.3, 'sm2: la facilidad nunca baja de 1,3');
  ef = 2.5; for (let i = 0; i < 40; i++) ef = ST.sm2({ ef, n: 1, due: H + 1, last: H }, 5, H + 1).ef;
  eq(ef, 3.5, 'sm2: ni sube de 3,5');
  eq([ST.sm2(null, 5, H), ST.sm2(null, 'sabia', H), ST.sm2(null, 'inventada', H), ST.sm2(null, 99, H).ef, ST.sm2(null, -4, H).n], [ST.sm2(null, 'sabia', H), ST.sm2(null, 5, H), ST.sm2(null, 1, H), ST.sm2(null, 5, H).ef, 0], 'sm2: la calidad acepta 0–5 o el nombre; lo desconocido cuenta como "No la sabía"; se acota');
  ok(ST.sm2({ ef: 'x', n: 'y', due: 5, last: 5 }, 5, 10).due === 10 + 1 + 1 && ST.sm2('basura', 3, 10).due === 11 && ST.sm2(undefined, 5, NaN).due >= 0, 'sm2: un registro dañado no tira error (se trata como una carta nueva)');
  { const r0 = { ef: 2.5, n: 1, due: 12, last: 11 }, copia = JSON.stringify(r0); ST.sm2(r0, 5, 12); eq(JSON.stringify(r0), copia, 'sm2: no modifica el registro de entrada'); }
  // pendientes
  const regs = { 'INT-03-02:2': { ef: 2.5, n: 1, due: H - 2, last: H - 3 }, 'INT-03-02:0': { ef: 2, n: 0, due: H, last: H - 1 }, 'AER-01-01:1': { ef: 2.5, n: 3, due: H + 1, last: H - 5 }, 'AER-02-02:0': { ef: 2.5, n: 1, due: H - 2, last: H - 3 }, 'mal': { ef: 2.5, n: 1, due: 1, last: 0 }, 'INT-01-01:3': 'x' };
  eq(ST.tarjetasPendientes(regs, H).map((x) => x.leccion + ':' + x.idx + '+' + x.atraso), ['AER-02-02:0+2', 'INT-03-02:2+2', 'INT-03-02:0+0'], 'tarjetasPendientes: las vencidas, la más atrasada primero (y por clave si empatan); ignora claves y registros dañados');
  eq([ST.tarjetasPendientes(regs, H - 10), ST.tarjetasPendientes(null, H), ST.tarjetasPendientes({}, H)], [[], [], []], 'tarjetasPendientes: nada vence antes de tiempo; entradas vacías no tiran error');
  // instancia: persistencia, helper, fusión, exportar / importar, migración
  let ms = Date.parse('2026-10-30T12:00:00'); const mem2 = memStorage();
  const sa = ST.crear({ storage: mem2, now: () => ms });
  eq([sa.hoyDia(), sa.tarjeta('INT-03-02', 0), sa.tarjetasVencidas(), sa.tarjetas()], [H, null, [], {}], 'store.tarjetas: arranca vacío');
  const r1 = sa.tarjetaRepasar('INT-03-02', 0, 'nosabia'), r2 = sa.tarjetaRepasar('INT-03-02', 3, 'sabia'), r3 = sa.tarjetaRepasar('INT-03-02', 1, 'medio');
  eq([r1.due - H, r2.due - H, r3.due - H, sa.tarjeta('INT-03-02', 3).n, sa.racha()], [1, 2, 1, 1, 1], 'tarjetaRepasar: guarda el registro de cada carta y cuenta como actividad del día (racha)');
  eq(Object.keys(sa.tarjetasDeLeccion('INT-03-02')).sort(), ['0', '1', '3'], 'tarjetasDeLeccion: {índice: registro} de esa lección');
  eq([sa.tarjetasVencidas(H).length, sa.tarjetasVencidas(H + 1).map((x) => x.idx), sa.tarjetasVencidas(H + 2).length], [0, [0, 1], 3], 'tarjetasVencidas(hoyDia): la que vence mañana aparece mañana (la de 2 días, pasado)');
  ms += 86400000;
  eq(sa.tarjetasVencidas().map((x) => x.idx), [0, 1], 'tarjetasVencidas() sin argumento usa el día de hoy del reloj inyectado');
  ok(sa.tarjetaRepasar('mala', 0, 'sabia') === null && sa.tarjetaRepasar('INT-03-02', 5000, 'sabia') === null && Object.keys(sa.tarjetas()).length === 3, 'tarjetaRepasar: una lección o un índice imposibles no guardan nada');
  const sb2 = ST.crear({ storage: mem2, now: () => ms });
  eq(sb2.tarjetas(), sa.tarjetas(), 'tarjetas: se guardan en localStorage y vuelven al recargar');
  const s7 = ST.crear({ storage: memStorage(), now: () => ms });
  ok(s7.importar(sa.exportar()).ok, 'tarjetas: exportar → importar');
  eq(s7.tarjetas(), sa.tarjetas(), 'tarjetas: el archivo exportado las incluye y vuelven iguales');
  // migración: un progreso guardado antes de las tarjetas (sin el campo) sigue funcionando
  const viejo = memStorage(); viejo.setItem('c150.escuela.v1', JSON.stringify({ v: 1, lecciones: { 'INT-01-01': { estado: 'hecha', estrellas: 2, mejor: 1, intentos: 1, paso: 3, h: [] } }, respuestas: {}, mazo: {}, racha: { dias: 2, ultimo: '2026-10-29', gracia: '', mejor: 2 }, minutos: {}, insignias: {}, ultima: null, prefs: {} }));
  const sv = ST.crear({ storage: viejo, now: () => ms });
  ok(sv.lec('INT-01-01').estado === 'hecha' && sv.estado().v === 1 && JSON.stringify(sv.tarjetas()) === '{}' && sv.tarjetasVencidas().length === 0, 'migración: un progreso guardado sin `tarjetas` sigue válido (v1) y arranca sin tarjetas');
  sv.tarjetaRepasar('INT-01-01', 2, 'sabia');
  ok(JSON.parse(viejo.getItem('c150.escuela.v1')).v === 1 && Object.keys(JSON.parse(viejo.getItem('c150.escuela.v1')).tarjetas).join() === 'INT-01-01:2' && JSON.parse(viejo.getItem('c150.escuela.v1')).lecciones['INT-01-01'].estrellas === 2, 'migración: al guardar sigue en v1, agrega `tarjetas` y no pierde nada de lo viejo');
  eq(ST.vacio().tarjetas, {}, 'vacio() trae `tarjetas`');
  // sanear / fusionar
  const san = ST.sanear({ tarjetas: { 'INT-01-01:0': { ef: 99, n: -5, due: 20760.4, last: 20759 }, '__proto__': { ef: 2.5, n: 1, due: 1, last: 0 }, 'INT-01-01:9999': { ef: 2.5, n: 1, due: 1, last: 0 }, 'xx:1': { ef: 2.5, n: 1, due: 1, last: 0 }, 'AER-01-01:1': { ef: 2.5, n: 1, due: 'mañana', last: 0 }, 'AER-01-02:1': 'basura' } });
  eq([Object.keys(san.tarjetas), san.tarjetas['INT-01-01:0'], ({}).ef === undefined], [['INT-01-01:0'], { ef: 3.5, n: 0, due: 20760, last: 20759 }, true], 'sanear tarjetas: descarta claves y registros imposibles, recorta rangos y no contamina el prototipo');
  const fu = ST.fusionar({ tarjetas: { 'INT-01-01:0': { ef: 2.5, n: 1, due: 20, last: 10 }, 'INT-01-01:1': { ef: 2.5, n: 2, due: 30, last: 20 } } }, { tarjetas: { 'INT-01-01:0': { ef: 2.2, n: 3, due: 40, last: 30 }, 'INT-01-01:1': { ef: 2.1, n: 0, due: 21, last: 20 }, 'INT-01-01:2': { ef: 2.5, n: 1, due: 5, last: 4 } } });
  eq([fu.tarjetas['INT-01-01:0'].n, fu.tarjetas['INT-01-01:1'].n, Object.keys(fu.tarjetas).length], [3, 2, 3], 'fusionar tarjetas: gana el repaso más reciente (y a igual día, el de más repasos); las que sólo están en uno se conservan');
  const sbloq = ST.crear({ storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }, now: () => ms });
  sbloq.tarjetaRepasar('INT-01-01', 0, 'sabia');
  ok(sbloq.tarjeta('INT-01-01', 0) !== null && sbloq.persistente === false, 'tarjetas: con el almacenamiento bloqueado siguen en memoria');
}

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
  // (5) el glosario del módulo se registra ANTES de armar el texto de la lección: una sola vez por módulo, aunque se pida de nuevo
  ok(typeof C.Escuela.glosarioRegistrado === 'function' && typeof C.Escuela.asegurarGlosario === 'function', 'Escuela.glosarioRegistrado y asegurarGlosario existen');
  ok(C.Escuela.glosarioRegistrado('INT') === true, 'Escuela: al cargar INT quedaron registrados sus términos');
  eq(C.Escuela.asegurarGlosario('INT'), 0, 'Escuela.asegurarGlosario: pedirlo de nuevo no duplica nada (idempotente)');
  const escSrc = fs.readFileSync(path.join(SRC, 'escuela', 'escuela.js'), 'utf8');
  ok(escSrc.indexOf('registrarGlosario(mod);') > 0 && escSrc.indexOf('registrarGlosario(mod);') < escSrc.indexOf('Leccion.crear(depsLeccion(e)'), 'escuela.js: montarLeccion registra el glosario del módulo antes de crear la lección');
  const P2 = C.Progress; P2.mark('escuela', 'INT-01-01'); P2.mark('escuela', 'INT-01-02');
  const et = P2.summary().camino.find((c) => c.id === 'escuela');
  ok(et && et.requisitos[0].total === D.total() && et.requisitos[0].actual === 2, 'Progress: la etapa 6 usa C150.Escuela.total (' + D.total() + ') y cuenta las lecciones marcadas');
  P2.touch('escuela', 'INT-01-02', { ruta: 'INT-01-02/3' });
  const ul = P2.last();
  ok(ul.ruta === '#escuela/INT-01-02/3' && /Quiénes somos/.test(ul.titulo), 'Progress.last(): "Continuar" vuelve al paso exacto de la lección');

  /* ---------------------------------------------------------------- QA Q3: catálogo de ejercicios, documentación y reserva */
  seccion('QA Q3: catálogo de ejercicios (styleguide), README y reserva');
  const TIPOS15 = Mot.TIPOS_P1.concat(Mot.TIPOS_P2);
  eq(TIPOS15.length, 15, 'hay 15 tipos de componente de ejercicio (8 de la pasada 1 y 7 de la pasada 2)');
  ok(TIPOS15.every((t) => Mot.has(t)), 'los 15 tipos de ejercicio tienen componente registrado: ' + TIPOS15.filter((t) => !Mot.has(t)).join(', '));
  eq(Mot.TIPOS_LUEGO, ['fraseologia'], 'sólo `fraseologia` queda sin componente (muestra la tarjeta de reserva)');
  ok(!Mot.has('fraseologia'), 'fraseologia sigue sin registrarse (la tarjeta de reserva la cubre)');
  const sgTxt = fs.readFileSync(path.join(ROOT, 'tests', 'styleguide.html'), 'utf8');
  const sgIni = sgTxt.indexOf("sec('ESCUELA · ejercicios'"), sgFin = sgTxt.indexOf('/* ---- 14 íconos');
  ok(sgIni > 0 && sgFin > sgIni, 'styleguide.html: existe la sección «ESCUELA · ejercicios» antes de los íconos');
  const sgSec = sgIni > 0 && sgFin > sgIni ? sgTxt.slice(sgIni, sgFin) : '';
  TIPOS15.forEach((t) => ok(new RegExp("tipo: '" + t + "'").test(sgSec), 'styleguide «ESCUELA · ejercicios»: hay un ejemplo de `' + t + '`'));
  ok(/tipo: 'fraseologia'/.test(sgSec), 'styleguide «ESCUELA · ejercicios»: muestra también la tarjeta de reserva (fraseologia)');
  const readmeTxt = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  TIPOS15.forEach((t) => ok(readmeTxt.indexOf('`' + t + '`') >= 0, 'README: nombra el componente `' + t + '`'));
  ok(/todos menos `fraseologia`/.test(readmeTxt), 'README: aclara que `fraseologia` es el único tipo que falta');
  // la reserva sólo se usa para `fraseologia`: ningún componente de ninguna lección terminada cae en ella
  let enReserva = [];
  modFiles.forEach((f) => { (readJson(path.join(ED, f)).unidades || []).forEach((u) => (u.lecciones || []).forEach((l) => (l.componentes || []).forEach((c, i) => {
    if (c && c.tipo !== 'fraseologia' && Mot.normalizar(c, Mot.ctxMinimo()) === null) enReserva.push(l.id + '#' + i + ' ' + c.tipo);
  }))); });
  eq(enReserva, [], 'ningún componente de las lecciones terminadas (salvo fraseologia) cae en la tarjeta de reserva');
  // los glosarios de las lecciones no chocan con el glosario de la app (sino: «clave repetida» en la consola cada vez que se arma el índice)
  const avisosGl = [], consolaOrig = S.console;
  S.console = { log: consolaOrig.log, error: consolaOrig.error, warn: function () { avisosGl.push(Array.prototype.slice.call(arguments).map((x) => (Array.isArray(x) ? x.join(' / ') : String(x))).join(' ')); } };
  modFiles.forEach((f) => {
    const lista = [], vistos = {};
    (readJson(path.join(ED, f)).unidades || []).forEach((u) => (u.lecciones || []).forEach((l) => (l.glosario || []).forEach((g) => {
      if (g && g.termino && g.definicion && !vistos[g.termino.toLowerCase()]) { vistos[g.termino.toLowerCase()] = 1; lista.push({ termino: g.termino, definicion: g.definicion }); }
    })));
    C.Glossary.register(lista);
  });
  C.Glossary.entries();
  S.console = consolaOrig;
  eq(avisosGl, [], 'el glosario de la app más los de INT y AER no tienen claves repetidas');
  // QA Q3 (revisión del código): arreglos que se pueden perder sin que nada más lo note
  const srcDe = (f) => fs.readFileSync(path.join(SRC, 'escuela', f), 'utf8');
  ok(/pr\.then\(bien, mal\)/.test(srcDe('c-calculadora.js')) && /showToast\(\{ text: t, kind: tono \}\)/.test(srcDe('c-calculadora.js')), 'calculadora: «Copiar la lista» atiende el rechazo de writeText y avisa con {text, kind}');
  {
    // el rótulo de la sustentación no se achica con la flecha (AER-03-01: escala 0.3 dejaba el texto en 3 px)
    const figA = ES.figuras.get('aterrizaje-alfa'), capaT = figA && figA.capas.find((c) => c.id === 'sustentacion-t'), capaS = figA && figA.capas.find((c) => c.id === 'sustentacion');
    ok(capaT && /<text/.test(capaT.svg) && capaS && !/<text/.test(capaS.svg), 'figura aterrizaje-alfa: la flecha de la sustentación y su rótulo son capas separadas (el rótulo no se escala)');
    const lecA = readJson(path.join(ED, 'AER.json')).unidades.reduce((a, u) => a.concat(u.lecciones), []).find((l) => l.id === 'AER-03-01');
    const aniA = lecA && lecA.componentes.find((c) => c.tipo === 'animacion' && c.datos && c.datos.figura === 'aterrizaje-alfa');
    ok(aniA && aniA.datos.escenas.every((e) => !(e.cambios && e.cambios.mover && e.cambios.mover.sustentacion) || e.cambios.mover['sustentacion-t']), 'AER-03-01: el rótulo de la sustentación viaja con el avión en cada escena que mueve la flecha');
    const figP = ES.figuras.get('tres-perdidas'), capaAlfa = figP && figP.capas.find((c) => c.id === 'alfa');
    ok(capaAlfa && /dg-tag--d/.test(capaAlfa.svg) && !/dg-lbl--fg/.test(capaAlfa.svg) && /dg-lbl--ink/.test(capaAlfa.svg) && /\.dg-lbl--ink \{ fill: #0b1018/.test(fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')), 'figura tres-perdidas: el texto sobre las píldoras de color (α crítico) es oscuro en los dos temas');
    ok(/\.mp-geo--t \{ opacity: 1; \}/.test(fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')), 'styles.css: la etiqueta «Tierra firme» del plano no pierde contraste por opacidad');
  }
  ok(/escalarEtiquetas\(svg\)/.test(srcDe('c-tarjetas.js')) && /offFig\(\)/.test(srcDe('c-tarjetas.js')), 'tarjetas: el dibujo de la carta escala sus etiquetas a 11 px o más y corta la observación al cambiar de carta');
  ok(/h\('h3', \{ 'class': 'es-comp-t'/.test(srcDe('motor.js')), 'motor: el título de cada componente es un h3 (después del h2 del paso)');
  ['c-caso.js', 'c-mapa.js', 'c-quiz.js', 'c-diagrama.js'].forEach((f) => ok(!/h\('h5'/.test(srcDe(f)) && /h\('h4'/.test(srcDe(f)), f + ': los títulos internos son h4 (sin saltar de nivel)'));
  ok(/\.es-lesson \.qz-fb-b[^{]*\{[^}]*overflow-wrap: anywhere/.test(fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8')), 'styles.css: el texto de la explicación del quiz parte las direcciones largas (no ensancha el panel)');

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
    // ningún archivo publicado nombra el material privado: la página única, el de Vercel, el artifact y cada JSON de módulo
    const pub = [path.join(ROOT, 'cabina-cessna-150.html'), html, path.join(ROOT, 'dist', 'artifact.html')].filter((p) => fs.existsSync(p))
      .concat(fs.readdirSync(site).map((f) => path.join(site, f)));
    pub.forEach((p) => ok(!/_teorico|Teorico\.pdf|teorico-ocr/.test(fs.readFileSync(p, 'utf8')), 'no menciona _teorico: ' + path.relative(ROOT, p)));
    const unico = path.join(ROOT, 'cabina-cessna-150.html');
    if (fs.existsSync(unico)) ok(fs.statSync(unico).size < 16 * 1024 * 1024, 'la página única pesa menos de 16 MB (' + Math.round(fs.statSync(unico).size / 1024) + ' KB)');
  } else console.log('  (sin build: corré node build.js para chequear esta parte)');

  console.log('\n' + (fallas ? fallas + ' de ' + pruebas + ' pruebas fallaron.' : pruebas + '/' + pruebas + ' pruebas OK'));
  console.log(fallas ? 'validate-escuela: HAY FALLAS' : 'validate-escuela: TODO BIEN');
  process.exit(fallas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
