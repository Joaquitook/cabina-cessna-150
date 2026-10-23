// Prueba de src/glossary.js (parte pura, sin DOM): armado del índice, reglas de coincidencia, sin superposiciones ni repetidos.
//   node tests/validate-glossary.js
'use strict';
const path = require('path');
global.window = global; global.C150 = {};
['controls-a', 'controls-b', 'learning', 'lab', 'situations'].forEach((f) => require(path.join('..', 'src', 'data', f + '.js')));
require('../src/glossary.js');
const G = C150.Glossary, D = C150.DATA;

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('  FALLA: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (esperado ' + JSON.stringify(b) + ', obtuve ' + JSON.stringify(a) + ')'); }

const controlIds = D.controls.map((c) => c.id);
const t0 = process.hrtime.bigint();
const ix = G.buildIndex({ glossary: D.glossary, controls: D.controls, extras: G.EXTRAS, controlIds });
const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
console.log('índice: ' + ix.entries.length + ' entradas, ' + ix.keyCount + ' claves, ' + buildMs.toFixed(1) + ' ms; avisos: ' + ix.warnings.length);

// ---- índice
ok(ix.entries.length >= 69 + 12, 'el índice trae el glosario (69) y la jerga extra (12)');
ok(ix.entries.every((e) => typeof e.definicion === 'string' && e.definicion.length > 10), 'todas las entradas tienen definición');
ok(ix.entries.filter((e) => e.tipo === 'glosario').length === D.glossary.length, 'una entrada por término del glosario');
ok(ix.entries.every((e) => !e.control || controlIds.indexOf(e.control) >= 0), 'todo "Verlo en 3D" apunta a un mando que existe');
const ids = ix.entries.map((e) => e.id);
ok(new Set(ids).size === ids.length, 'ids de entrada únicos');
ok(ix.warnings.length === 0, 'sin claves repetidas entre entradas distintas: ' + ix.warnings.slice(0, 4).join(' | '));
const seen = {};
let dupes = 0;
Object.keys(ix.map).forEach((k) => ix.map[k].forEach((c) => {
  const key = (c.cs ? 'cs:' : 'ci:') + c.words.join(' ');
  if (seen[key] && seen[key] !== c.entry.id) dupes++;
  seen[key] = c.entry.id;
}));
ok(dupes === 0, 'una clave apunta a una sola entrada (' + dupes + ' repetidas)');
ok(buildMs < 150, 'el índice se arma en menos de 150 ms (' + buildMs.toFixed(1) + ')');

// los mandos más comunes quedan unidos a su término
const ent = (t) => ix.byId['g:' + G.fold(t)] || ix.byId['x:' + G.fold(t)] || null;
eq(ent('Flaps').control, 'flap-switch', 'Flaps → interruptor de flaps');
eq(ent('Compensador').control, 'trim-wheel', 'Compensador → rueda de trim');
eq(ent('Mezcla').control, 'mixture', 'Mezcla → perilla de mezcla');
eq(ent('Master').control, 'master', 'Master → interruptor master');
eq(ent('Alerón').control, 'yoke', 'Alerón → volante');
eq(ent('IAS').control, 'asi', 'IAS → velocímetro');
ok(!ent('Checklist').control, 'Checklist no se une a los carteles');

// ---- reglas de coincidencia
function find(text, opts) { return G.findMatches(text, ix, opts).map((m) => text.slice(m.start, m.end)); }
eq(find('Mové los flaps y mirá los flaps otra vez'), ['flaps'], 'sólo la primera aparición por término');
eq(find('Mové los flaps y mirá los flaps otra vez', { all: true }), ['flaps', 'flaps'], 'all: todas las apariciones');
eq(find('El ALERÓN sube y el aleron baja', { all: true }), ['ALERÓN', 'aleron'], 'sin importar mayúsculas ni tildes');
eq(find('Los alerones se mueven'), ['alerones'], 'plural: alerón → alerones');
eq(find('Los magnetos y el nudo'), ['magnetos', 'nudo'], 'plural en -s y singular');
eq(find('Velocidad máxima 100 nudos'), ['nudos'], 'plural en -os');
eq(find('Con la calefacción del carburador afuera'), ['calefacción del carburador'], 'varias palabras');
eq(find('Calefacción del carburador y centro de gravedad'), ['Calefacción del carburador', 'centro de gravedad'], 'dos términos de varias palabras');
eq(find('Ángulo de ataque alto y borde de ataque'), ['Ángulo de ataque', 'borde de ataque'], '"ataque" suelto no pisa a "Ángulo de ataque" ni a "Borde de ataque"');
eq(find('el viraje coordinado es lo que hacés'), ['viraje coordinado'], 'el término más largo gana sobre "viraje"');
eq(find('en un viraje cualquiera'), ['viraje'], '"Viraje" suelto');
// siglas: exigen la misma forma
eq(find('La IAS marca 65 y la ias no es sigla'), ['IAS'], 'IAS exige mayúsculas');
eq(find('Mirá el QNH y el qnh'), ['QNH'], 'QNH exige mayúsculas');
eq(find('Vne en rojo y vne en minúsculas'), ['Vne'], 'Vne exige la misma forma');
// palabras que se confunden: no se envuelven
eq(find('El avión va rápido y va bien'), [], '"va" no es la velocidad Va');
eq(find('Poné el pie derecho en el pedal'), [], '"pie" (singular) no se envuelve');
eq(find('Altura 3000 pies'), ['pies'], '"pies" sí');
eq(find('Hay mucha potencia y la radio anda'), [], 'palabras comunes de los mandos no se envuelven (potencia, radio)');
// bordes de palabra
eq(find('antialerón y reflaps'), [], 'sin coincidencias dentro de otra palabra');
eq(find('Alerón.'), ['Alerón'], 'puntuación al lado');
eq(find('(flaps)'), ['flaps'], 'entre paréntesis');
eq(find('en el nav y en el com'), [], 'NAV y COM sueltos no se envuelven');
eq(find('el vacío del espacio'), [], '"vacío" suelto no se envuelve');
// espacios entre palabras: sólo blancos, "/" y "-"
eq(find('centro. de gravedad'), [], 'un punto corta un término de varias palabras');
eq(find('centro  de   gravedad'), ['centro  de   gravedad'], 'espacios de más');
// alias del glosario y de los mandos
eq(find('Barrena y rodaje'), ['Barrena', 'rodaje'], 'alias: barrena = tirabuzón, rodaje = carreteo');
eq(find('Mirá la bolita al centro'), ['la bolita'], 'otros nombres de los mandos: la bolita');
// sin superposiciones y en orden
(function () {
  const text = 'Con flaps y alerones en el viraje coordinado, el centro de gravedad y los flaps y el IAS del Cessna.';
  const ms = G.findMatches(text, ix, { all: true });
  let prev = -1, good = true;
  ms.forEach((m) => { if (m.start < prev || m.end <= m.start) good = false; prev = m.end; });
  ok(good && ms.length >= 5, 'coincidencias ordenadas y sin superposición (' + ms.length + ')');
})();
// used y skip
(function () {
  const used = {};
  const a = G.findMatches('flaps y alerón', ix, { used }).length;
  const b = G.findMatches('otra vez flaps y alerón y mezcla', ix, { used }).map((m) => m.id);
  eq(a, 2, 'primera pasada: dos términos');
  eq(b.length, 1, 'segunda pasada con used: sólo el nuevo (mezcla)');
  const sk = G.findMatches('flaps y alerón', ix, { skip: ['g:flaps'] }).length;
  eq(sk, 1, 'skip saltea una entrada');
})();
eq(G.findMatches('', ix).length, 0, 'texto vacío');
eq(G.findMatches(null, ix).length, 0, 'texto nulo');

// define() con el índice perezoso (usa C150.DATA)
(function () {
  const d = G.define('Alerones');
  ok(d && d.termino === 'Alerón', 'define("Alerones") → Alerón');
  ok(G.define('qnh') && G.define('qnh').termino === 'QNH', 'define("qnh") → QNH');
  ok(G.define('xyzzy') === null, 'define de algo desconocido → null');
  G.register([{ termino: 'Cuaderno de ruta', definicion: 'Prueba de register: un término agregado desde afuera.' }]);
  ok(G.define('cuaderno de ruta') !== null, 'register() suma términos');
  ok(G.entries().length >= ix.entries.length, 'entries() devuelve todo el índice');
  G._reset();
})();

// ---- recorrido por todo el contenido real: nada raro y rápido
(function () {
  const texts = [];
  (D.lessons || []).forEach((L) => (L.pasos || []).forEach((p) => texts.push(p.texto)));
  (D.tour || []).forEach((t) => texts.push(t.texto));
  (D.checklists || []).forEach((c) => (c.items || []).forEach((i) => texts.push(i.detalle)));
  (D.controls || []).forEach((c) => { texts.push(c.queHace); texts.push(c.enElAvion); texts.push(c.ubicacion); });
  (D.situations || []).forEach((s) => { texts.push(s.contexto); (s.pistas || []).forEach((p) => texts.push(p)); });
  const real = texts.filter((t) => typeof t === 'string' && t.length > 20);
  let total = 0, hits = 0, maxMs = 0;
  const freq = {};
  real.forEach((t) => {
    const s = process.hrtime.bigint();
    const ms = G.findMatches(t, ix, {});
    const e = Number(process.hrtime.bigint() - s) / 1e6;
    if (e > maxMs) maxMs = e;
    total += t.length; hits += ms.length;
    ms.forEach((m) => { freq[m.id] = (freq[m.id] || 0) + 1; });
    ms.forEach((m) => {                                  // ninguna coincidencia empieza o termina a mitad de palabra
      const before = t[m.start - 1], after = t[m.end];
      if (before && /[\p{L}\p{N}]/u.test(before)) ok(false, 'coincidencia a mitad de palabra: ' + t.slice(Math.max(0, m.start - 8), m.end + 8));
      if (after && /[\p{L}\p{N}]/u.test(after)) ok(false, 'coincidencia a mitad de palabra (fin): ' + t.slice(Math.max(0, m.start - 8), m.end + 8));
    });
  });
  const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 12).map((k) => k + 'x' + freq[k]).join(', ');
  console.log('contenido real: ' + real.length + ' textos, ' + total + ' caracteres, ' + hits + ' términos; el más lento ' + maxMs.toFixed(2) + ' ms');
  console.log('  más frecuentes: ' + top);
  ok(hits > 100, 'el contenido real tiene términos marcados');
  ok(maxMs < 15, 'un texto se recorre en menos de 15 ms (' + maxMs.toFixed(2) + ')');
})();

console.log(fails ? '\n' + fails + ' falla(s) de ' + checks : '\nOK: ' + checks + ' comprobaciones');
process.exit(fails ? 1 : 0);
