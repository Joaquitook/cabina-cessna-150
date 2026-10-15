/*
 * validate-controls-b.js — Valida src/data/controls-b.js contra el contrato técnico.
 * Uso: node tests/validate-controls-b.js [ruta opcional]   (sale con código 1 si algo falla)
 *
 * Igual que validate-controls-a.js: carga el archivo en un contexto vm aislado (un globalThis falso,
 * sin window), como lo haría el navegador con un script clásico, y comprueba:
 *  - que controls-b.js NO pise C150.DATA.categories ni C150.DATA.meta (los define controls-a.js) y que
 *    CONCATENE a C150.DATA.controls en vez de reemplazar lo que ya había;
 *  - que estén sus 25 ids exactamente una vez, con todos los campos obligatorios no vacíos;
 *  - categorías, relacionados y partesAvion válidos (listas del contrato §5 y §6);
 *  - probar con un tipo del §7 y claves de estado del §3a;
 *  - subitems de 'doors' (left, right, window) y de nadie más;
 *  - rangos de los instrumentos (arcos del velocímetro, tacómetro, aceite, succión) iguales al manual;
 *  - algunos datos clave que no pueden faltar.
 * Si existen src/data/controls-a.js o src/sim.js, hace además chequeos cruzados.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
// Se puede pasar otra ruta como argumento (útil para probar el validador con una copia modificada).
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'src', 'data', 'controls-b.js');
const FILE_A = path.join(ROOT, 'src', 'data', 'controls-a.js');

let failures = 0;
let checks = 0;
const warnings = [];

function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error('  FALLA: ' + msg);
  }
  return !!cond;
}
function warn(msg) { warnings.push(msg); }

/* ───────────── Listas del contrato ───────────── */

const CATEGORY_IDS = ['mandos', 'motor', 'combustible', 'electrico', 'vuelo', 'sistemas', 'radio', 'cabina'];

// §5: id → categoría (todas las fichas de la app; controls-b define las 25 últimas).
const CONTRACT_IDS = {
  'yoke': 'mandos', 'rudder-pedals': 'mandos', 'toe-brakes': 'mandos', 'parking-brake': 'mandos',
  'control-lock': 'mandos', 'trim-wheel': 'mandos', 'flap-switch': 'mandos', 'flap-indicator': 'mandos',
  'throttle': 'motor', 'mixture': 'motor', 'carb-heat': 'motor', 'primer': 'motor', 'ignition': 'motor',
  'fuel-shutoff': 'combustible', 'fuel-gauges': 'combustible',
  'master': 'electrico', 'light-switches': 'electrico', 'dimmers': 'electrico',
  'circuit-breakers': 'electrico', 'ammeter': 'electrico',
  'asi': 'vuelo', 'attitude': 'vuelo', 'altimeter': 'vuelo', 'turn-coordinator': 'vuelo',
  'heading-indicator': 'vuelo', 'vsi': 'vuelo', 'compass': 'vuelo', 'clock': 'vuelo', 'oat': 'vuelo',
  'tachometer': 'sistemas', 'oil-gauges': 'sistemas', 'suction': 'sistemas', 'stall-warning': 'sistemas',
  'navcom': 'radio', 'transponder': 'radio', 'vor-indicator': 'radio', 'audio-panel': 'radio',
  'microphone': 'radio',
  'cabin-heat': 'cabina', 'cabin-air': 'cabina', 'air-vents': 'cabina', 'seats': 'cabina',
  'seatbelts': 'cabina', 'doors': 'cabina', 'placards': 'cabina'
};

const B_IDS = ['asi', 'attitude', 'altimeter', 'turn-coordinator', 'heading-indicator', 'vsi', 'compass',
  'clock', 'oat', 'tachometer', 'oil-gauges', 'suction', 'stall-warning', 'navcom', 'transponder',
  'vor-indicator', 'audio-panel', 'microphone', 'cabin-heat', 'cabin-air', 'air-vents', 'seats',
  'seatbelts', 'doors', 'placards'];

// §6
const PART_IDS = ['aileronL', 'aileronR', 'elevator', 'trimTab', 'rudder', 'flapL', 'flapR', 'propeller',
  'spinner', 'noseWheel', 'mainWheels', 'brakes', 'wingL', 'wingR', 'stabilizer', 'fin', 'fuselage',
  'cowling', 'pitotTube', 'staticPort', 'stallWarningInlet', 'fuelCapL', 'fuelCapR', 'fuelVent',
  'navLightL', 'navLightR', 'navLightTail', 'beacon', 'landingLight', 'strobes', 'carbAirInlet',
  'exhaust', 'doorL', 'doorR', 'windowL', 'struts', 'oilDoor'];

// §3a: claves de entrada del estado (las anidadas con punto).
const STATE_KEYS = ['variant', 'yokeRoll', 'yokePitch', 'rudder', 'brakeL', 'brakeR', 'parkingBrake',
  'controlLock', 'throttle', 'mixture', 'carbHeat', 'primerOut', 'primerLocked', 'ignition',
  'masterBat', 'masterAlt', 'flapSwitch', 'trim', 'fuelValve', 'cabinHeat', 'cabinAir',
  'lights.dome', 'lights.nav', 'lights.strobe', 'lights.beacon', 'lights.taxi', 'lights.landing',
  'pitotHeat', 'panelLights',
  'radio.comOn', 'radio.comFreq', 'radio.comStby', 'radio.navFreq', 'radio.navStby', 'radio.obs',
  'radio.xpdrMode', 'radio.xpdrCode',
  'altimeterSetting', 'hiCorrection', 'doorLeftOpen', 'doorRightOpen', 'windowLeftOpen', 'paused'];

// §7
const PROBAR_TIPOS = ['yoke', 'pedales', 'slider', 'toggle', 'opciones', 'master', 'flaps', 'accion',
  'luces', 'radio', 'perilla', 'puertas'];
const SIM_ACTIONS = ['primeStroke', 'setIgnition', 'setFlapSwitch', 'setMaster'];
const RANGO_COLORS = ['blanco', 'verde', 'amarillo', 'rojo', 'azul'];
// Formatos de perilla que la UI sabe mostrar (controls-a usa además 'porcentaje').
const PERILLA_FORMATOS = ['inHg', 'grados', 'porcentaje'];

const SUBITEMS = {
  'doors': ['left', 'right', 'window']
};

const STRING_FIELDS = ['nombre', 'ingles', 'categoria', 'ubicacion', 'resumen', 'queHace', 'enElAvion',
  'cuando', 'truco', 'dato', 'otrosModelos'];

/* ───────────── Utilidades ───────────── */

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function allText(entry) {
  const parts = [];
  (function walk(v) {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k]));
  })(entry);
  return parts.join('\n');
}

/* ───────────── Carga en un global falso ───────────── */

function loadInContext(files, pre) {
  const sandbox = { console };
  vm.createContext(sandbox);
  if (pre) vm.runInContext(pre, sandbox);
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox;
}

const source = fs.readFileSync(FILE, 'utf8');
let ctx;
try {
  ctx = loadInContext([FILE]);
} catch (e) {
  console.error('No se pudo cargar controls-b.js: ' + e.stack);
  process.exit(1);
}

console.log('Validando ' + path.relative(ROOT, FILE).split(path.sep).join('/'));

/* ───────────── Archivo ───────────── */

ok(source.startsWith("var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};"),
  'la primera línea debe ser la cabecera de namespace del contrato §1');
ok(!/\b(import|export)\s/.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, "''")),
  'no debe usar import/export (scripts clásicos)');
ok(!/�|Ã[\u0080-¿]|Â[\u0080-¿]/.test(source), 'el archivo no debe tener caracteres mal codificados (mojibake)');
ok(!/\b(TODO|FIXME|XXX)\b/.test(source) && !/\b(lorem|ipsum)\b/i.test(source), 'no debe haber marcadores TODO/FIXME ni lorem ipsum');
ok(!/\b(document|localStorage|sessionStorage)\s*\.|\b(alert|confirm|prompt)\s*\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
  'el archivo de datos no debe tocar el DOM ni el almacenamiento');

const C150 = ctx.C150;
ok(C150 && C150.DATA, 'C150.DATA debe existir en el global');
const DATA = (C150 && C150.DATA) || {};

/* ───────────── No pisa lo de controls-a ───────────── */

ok(!('categories' in DATA), 'controls-b.js no debe definir C150.DATA.categories (lo hace controls-a.js)');
ok(!('meta' in DATA), 'controls-b.js no debe definir C150.DATA.meta (lo hace controls-a.js)');
try {
  const pre = 'var C150 = globalThis.C150 = { DATA: { controls: [{ id: "__previa__" }], categories: ["x"], meta: { m: 1 } } };';
  const c2 = loadInContext([FILE], pre);
  const ctl = c2.C150.DATA.controls;
  ok(ctl[0] && ctl[0].id === '__previa__' && ctl.length === B_IDS.length + 1,
    'controls-b.js debe concatenar a C150.DATA.controls (no reemplazar lo que ya cargó controls-a.js)');
  ok(c2.C150.DATA.categories.length === 1 && c2.C150.DATA.meta.m === 1, 'controls-b.js no debe tocar categories ni meta existentes');
} catch (e) {
  ok(false, 'no se pudo cargar controls-b.js sobre un C150.DATA existente: ' + e.message);
}

/* ───────────── fichas ───────────── */

const controls = Array.isArray(DATA.controls) ? DATA.controls : [];
ok(controls.length === B_IDS.length, 'controls-b.js debe agregar exactamente ' + B_IDS.length + ' fichas (agrega ' + controls.length + ')');
const counts = {};
controls.forEach((c) => { counts[c.id] = (counts[c.id] || 0) + 1; });
for (const id of B_IDS) ok(counts[id] === 1, 'el id ' + id + ' debe aparecer exactamente una vez (aparece ' + (counts[id] || 0) + ')');
for (const id of Object.keys(counts)) ok(B_IDS.includes(id), 'id inesperado en controls-b.js: ' + id);

for (const c of controls) {
  const where = 'ficha ' + c.id + ': ';

  for (const f of STRING_FIELDS) ok(isStr(c[f]), where + 'el campo ' + f + ' debe ser un texto no vacío');
  ok(CONTRACT_IDS[c.id] === c.categoria, where + 'categoria debe ser ' + CONTRACT_IDS[c.id] + ' (es ' + c.categoria + ')');
  ok(CATEGORY_IDS.includes(c.categoria), where + 'categoria inválida ' + c.categoria);
  ok([1, 2, 3].includes(c.prioridad), where + 'prioridad debe ser 1, 2 o 3');

  ok(Array.isArray(c.otrosNombres) && c.otrosNombres.length > 0 && c.otrosNombres.every(isStr),
    where + 'otrosNombres debe ser una lista no vacía de textos');
  ok(Array.isArray(c.comoSeUsa) && c.comoSeUsa.length >= 3 && c.comoSeUsa.length <= 6 && c.comoSeUsa.every(isStr),
    where + 'comoSeUsa debe tener de 3 a 6 pasos (tiene ' + (c.comoSeUsa || []).length + ')');
  ok(Array.isArray(c.errores) && c.errores.length >= 2 && c.errores.length <= 4 && c.errores.every(isStr),
    where + 'errores debe tener de 2 a 4 ítems (tiene ' + (c.errores || []).length + ')');
  if (isStr(c.resumen)) ok(words(c.resumen) <= 20, where + 'resumen debe tener 20 palabras o menos (tiene ' + words(c.resumen) + ')');
  if (isStr(c.queHace)) {
    const sentences = c.queHace.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
    ok(sentences >= 2 && sentences <= 5, where + 'queHace debe tener de 2 a 5 oraciones (tiene ' + sentences + ')');
    if (sentences > 4) warn(where + 'queHace tiene ' + sentences + ' oraciones (el contrato pide 2–4)');
  }

  // relacionados
  ok(Array.isArray(c.relacionados) && c.relacionados.length > 0, where + 'relacionados debe ser una lista no vacía');
  (c.relacionados || []).forEach((r) => {
    ok(Object.prototype.hasOwnProperty.call(CONTRACT_IDS, r), where + 'relacionado inválido ' + r);
    ok(r !== c.id, where + 'no puede relacionarse consigo misma');
  });
  ok(new Set(c.relacionados || []).size === (c.relacionados || []).length, where + 'relacionados repetidos');

  // partesAvion
  ok(Array.isArray(c.partesAvion), where + 'partesAvion debe ser una lista (puede ser vacía)');
  (c.partesAvion || []).forEach((p) => ok(PART_IDS.includes(p), where + 'parte del avión inválida ' + p));
  ok(new Set(c.partesAvion || []).size === (c.partesAvion || []).length, where + 'partesAvion repetidas');

  // rangos
  ok(Array.isArray(c.rangos), where + 'rangos debe ser una lista (vacía si no hay marcas)');
  (c.rangos || []).forEach((r, i) => {
    const w = where + 'rangos[' + i + ']: ';
    ok(RANGO_COLORS.includes(r.color), w + 'color inválido ' + r.color);
    ok(typeof r.desde === 'number' && typeof r.hasta === 'number' && r.desde <= r.hasta, w + 'desde/hasta numéricos con desde ≤ hasta');
    ok(isStr(r.unidad) && isStr(r.texto), w + 'unidad y texto no vacíos');
  });

  // probar
  const p = c.probar;
  if (p !== null) {
    if (ok(p && typeof p === 'object' && PROBAR_TIPOS.includes(p.tipo), where + 'probar.tipo inválido ' + (p && p.tipo))) {
      if ('clave' in p) {
        ok(STATE_KEYS.includes(p.clave), where + 'probar.clave no es una clave de estado del §3a: ' + p.clave);
      }
      switch (p.tipo) {
        case 'slider':
          ok('clave' in p && typeof p.min === 'number' && typeof p.max === 'number' && p.min < p.max &&
            typeof p.paso === 'number' && p.paso > 0 && isStr(p.etiquetaMin) && isStr(p.etiquetaMax),
          where + 'slider necesita clave, min < max, paso > 0, etiquetaMin y etiquetaMax');
          break;
        case 'toggle':
          ok('clave' in p && isStr(p.on) && isStr(p.off), where + 'toggle necesita clave, on y off');
          break;
        case 'opciones':
          ok('clave' in p && Array.isArray(p.valores) && p.valores.length > 1 && p.valores.every(isStr), where + 'opciones necesita clave y valores');
          break;
        case 'perilla':
          ok('clave' in p && typeof p.min === 'number' && typeof p.max === 'number' && p.min < p.max &&
            typeof p.paso === 'number' && p.paso > 0 && isStr(p.formato), where + 'perilla necesita clave, min < max, paso > 0 y formato');
          ok(PERILLA_FORMATOS.includes(p.formato), where + 'perilla.formato debe ser uno de ' + PERILLA_FORMATOS.join(', '));
          break;
        case 'accion':
          ok(SIM_ACTIONS.includes(p.accion) && isStr(p.etiqueta), where + 'accion necesita una acción de C150.Sim.actions y etiqueta');
          break;
        default:
          break;
      }
    }
  }

  // subitems
  if (SUBITEMS[c.id]) {
    const subs = Array.isArray(c.subitems) ? c.subitems : [];
    ok(JSON.stringify(subs.map((s) => s.subId).sort()) === JSON.stringify(SUBITEMS[c.id].slice().sort()),
      where + 'subitems deben ser exactamente ' + SUBITEMS[c.id].join(', '));
    subs.forEach((s) => ok(isStr(s.subId) && isStr(s.nombre) && isStr(s.ingles) && isStr(s.texto),
      where + 'subitem ' + s.subId + ' necesita subId, nombre, ingles y texto'));
  } else {
    ok(!('subitems' in c), where + 'no debería tener subitems (en controls-b sólo doors)');
  }

  // Voseo rioplatense: nada de tuteo peninsular/neutro en los textos.
  const text = allText(c);
  const tuteo = text.match(/(?<!\p{L})(puedes|debes|tienes|quieres|sabes|necesitas|asegúrate|fíjate|acuérdate|tú)(?!\p{L})/iu);
  ok(!tuteo, where + 'usar voseo (encontré “' + (tuteo && tuteo[0]) + '”)');
}

/* ───────────── Probalo esperados por tipo de control ───────────── */

const byId = {};
controls.forEach((c) => { byId[c.id] = c; });
const EXPECTED_PROBAR = {
  'altimeter': { tipo: 'perilla', clave: 'altimeterSetting' },
  'heading-indicator': { tipo: 'perilla', clave: 'hiCorrection' },
  'vor-indicator': { tipo: 'perilla', clave: 'radio.obs' },
  'navcom': { tipo: 'radio' }, 'transponder': { tipo: 'radio' },
  'cabin-heat': { tipo: 'slider', clave: 'cabinHeat' }, 'cabin-air': { tipo: 'slider', clave: 'cabinAir' },
  'doors': { tipo: 'puertas' }
};
for (const id of Object.keys(EXPECTED_PROBAR)) {
  const p = byId[id] && byId[id].probar;
  const exp = EXPECTED_PROBAR[id];
  ok(p && Object.keys(exp).every((k) => p[k] === exp[k]), 'ficha ' + id + ': probar debería ser ' + JSON.stringify(exp));
}
const alt = byId.altimeter && byId.altimeter.probar;
ok(alt && alt.min <= 28.5 && alt.max >= 30.9 && alt.min < 29.92 && alt.max > 29.92 && alt.paso <= 0.01,
  'altimeter: la perilla de Kollsman cubre 29,92 con paso de 0,01 inHg');
['cabin-heat', 'cabin-air'].forEach((id) => {
  const p = byId[id] && byId[id].probar;
  ok(p && p.min === 0 && p.max === 1, id + ': el slider va de 0 a 1');
});
// Los instrumentos que sólo informan no deben tener Probalo (operarlos no cambiaría nada).
['asi', 'attitude', 'vsi', 'compass', 'tachometer', 'oil-gauges', 'suction'].forEach((id) => {
  ok(byId[id] && byId[id].probar === null, 'ficha ' + id + ': instrumento informativo, probar debería ser null');
});

/* ───────────── Rangos del manual ───────────── */

function hasRange(id, color, desde, hasta, unidad) {
  const c = byId[id];
  return !!(c && c.rangos.some((r) => r.color === color && r.desde === desde && r.hasta === hasta && (!unidad || r.unidad === unidad)));
}
const RANGES = [
  ['asi', 'blanco', 42, 85, 'kt', 'arco blanco 42–85 kt'],
  ['asi', 'verde', 47, 107, 'kt', 'arco verde 47–107 kt'],
  ['asi', 'amarillo', 107, 141, 'kt', 'arco amarillo 107–141 kt'],
  ['asi', 'rojo', 141, 141, 'kt', 'raya roja 141 kt'],
  ['tachometer', 'verde', 2000, 2750, 'RPM', 'arco verde 2000–2750 RPM'],
  ['tachometer', 'rojo', 2750, 2750, 'RPM', 'raya roja 2750 RPM'],
  ['oil-gauges', 'verde', 30, 60, 'psi', 'presión de aceite verde 30–60 psi'],
  ['oil-gauges', 'rojo', 10, 10, 'psi', 'presión mínima 10 psi'],
  ['oil-gauges', 'rojo', 100, 100, 'psi', 'presión máxima 100 psi'],
  ['oil-gauges', 'verde', 100, 240, '°F', 'temperatura de aceite verde 100–240 °F'],
  ['oil-gauges', 'rojo', 240, 240, '°F', 'temperatura máxima 240 °F'],
  ['suction', 'verde', 4.6, 5.4, 'inHg', 'succión verde 4,6–5,4 inHg']
];
for (const [id, color, d, h, u, what] of RANGES) {
  ok(hasRange(id, color, d, h, u), 'ficha ' + id + ': falta el rango “' + what + '”');
}

/* ───────────── Datos clave del manual ───────────── */

const FACTS = [
  ['asi', /A150M|Aerobat/, 'diferencias del A150M Aerobat'],
  ['asi', /MPH|millas/, 'escala interior en MPH / modelos viejos'],
  ['asi', /pitot/, 'tubo pitot'],
  ['attitude', /vacío/, 'el horizonte funciona con vacío'],
  ['altimeter', /29,92/, 'ajuste estándar 29,92 inHg'],
  ['altimeter', /1013 hPa/, '1013 hPa'],
  ['altimeter', /QNH/, 'QNH'],
  ['turn-coordinator', /bolita/, 'la bolita'],
  ['turn-coordinator', /eléctric/, 'el coordinador es eléctrico'],
  ['heading-indicator', /brújula/, 'alinear el direccional con la brújula'],
  ['compass', /12°|variación/, 'variación magnética'],
  ['tachometer', /horómetro|horas/, 'horómetro'],
  ['suction', /4,6/, 'succión 4,6'],
  ['stall-warning', /5 a 10 nudos|5 y 10 nudos/, 'suena 5 a 10 nudos antes de la pérdida'],
  ['stall-warning', /borde de ataque/, 'toma en el borde de ataque'],
  ['transponder', /asign/, 'el código lo asigna el control / el instructor'],
  ['transponder', /7700/, 'código de emergencia 7700'],
  ['navcom', /frecuencia/, 'frecuencias'],
  ['vor-indicator', /TO|FROM/, 'bandera TO/FROM'],
  ['cabin-heat', /monóxido/, 'riesgo de monóxido de carbono'],
  ['doors', /141/, 'ventanilla abierta hasta 141 nudos'],
  ['placards', /maniobras|MANEUVERS/, 'placa de maniobras'],
  ['microphone', /auricular/, 'auriculares'],
  ['air-vents', /parabrisas/, 'ventiletes en las esquinas del parabrisas']
];
for (const [id, re, what] of FACTS) {
  ok(byId[id] && re.test(allText(byId[id])), 'ficha ' + id + ': falta el dato “' + what + '”');
}

/* ───────────── Chequeos cruzados opcionales ───────────── */

if (fs.existsSync(FILE_A)) {
  try {
    const both = loadInContext([FILE_A, FILE]);
    const all = both.C150.DATA.controls;
    const ids = all.map((c) => c.id);
    ok(new Set(ids).size === ids.length, 'controls-a + controls-b: no debe haber ids repetidos');
    const missing = Object.keys(CONTRACT_IDS).filter((id) => !ids.includes(id));
    ok(missing.length === 0, 'controls-a + controls-b: faltan ids del contrato: ' + missing.join(', '));
    ok(ids.length === Object.keys(CONTRACT_IDS).length, 'controls-a + controls-b: deben ser exactamente 45 fichas');
    ok(both.C150.DATA.categories.length === 8, 'controls-b no debe pisar las categorías');
    ok(both.C150.DATA.meta && both.C150.DATA.meta.avion === 'Cessna 150M 1976', 'controls-b no debe pisar meta');
    console.log('  (chequeo cruzado con controls-a.js: ' + all.length + ' fichas en total)');
  } catch (e) {
    warn('no se pudo cargar controls-a.js junto con controls-b.js: ' + e.message);
  }
}

const FILE_SIM = path.join(ROOT, 'src', 'sim.js');
if (fs.existsSync(FILE_SIM)) {
  try {
    const withSim = loadInContext([FILE, FILE_SIM]);
    const state = withSim.C150.Sim.createState('parked');
    controls.forEach((c) => {
      if (c.probar && 'clave' in c.probar) {
        ok(getPath(state, c.probar.clave) !== undefined, 'sim.js: createState() no tiene la clave ' + c.probar.clave + ' (usada por ' + c.id + ')');
      }
    });
    const lim = withSim.C150.Sim.limits(state);
    ok(lim && lim.redLine === 141 && lim.greenArc[0] === 47 && lim.greenArc[1] === 107, 'sim.js: limits() coincide con los arcos del velocímetro de la ficha asi');
    console.log('  (chequeo cruzado con sim.js: claves de estado y límites verificados)');
  } catch (e) {
    warn('no se pudo cargar sim.js para el chequeo cruzado: ' + e.message);
  }
}

/* ───────────── Resultado ───────────── */

warnings.forEach((w) => console.warn('  AVISO: ' + w));
if (failures) {
  console.error('\n' + failures + ' de ' + checks + ' comprobaciones fallaron.');
  process.exit(1);
}
console.log('OK: ' + checks + ' comprobaciones pasaron (' + controls.length + ' fichas).');
