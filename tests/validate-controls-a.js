/*
 * validate-controls-a.js — Valida src/data/controls-a.js contra el contrato técnico.
 * Uso: node tests/validate-controls-a.js   (sale con código 1 si algo falla)
 *
 * Carga el archivo en un contexto vm aislado (un globalThis falso, sin window), igual que lo
 * haría el navegador con un script clásico, y comprueba:
 *  - meta y las 8 categorías (orden, campos, colores válidos y legibles en los dos temas);
 *  - que estén los 20 ids exactamente una vez, con todos los campos obligatorios no vacíos;
 *  - categorías, relacionados y partesAvion válidos (listas del contrato §5 y §6);
 *  - probar con un tipo del §7 y claves de estado del §3a;
 *  - subitems de 'master' y 'light-switches';
 *  - algunos datos clave (números del manual) que no pueden faltar.
 * Si existen src/data/controls-b.js o src/sim.js, hace además chequeos cruzados.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
// Se puede pasar otra ruta como argumento (útil para probar el validador con una copia modificada).
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'src', 'data', 'controls-a.js');

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

// §5: id → categoría (todas las fichas de la app; controls-a define las 20 primeras).
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

const A_IDS = ['yoke', 'rudder-pedals', 'toe-brakes', 'parking-brake', 'control-lock', 'trim-wheel',
  'flap-switch', 'flap-indicator', 'throttle', 'mixture', 'carb-heat', 'primer', 'ignition',
  'fuel-shutoff', 'fuel-gauges', 'master', 'light-switches', 'dimmers', 'circuit-breakers', 'ammeter'];

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

const SUBITEMS = {
  'master': ['alt', 'bat'],
  'light-switches': ['dome', 'pitot', 'nav', 'strobe', 'beacon', 'taxi', 'landing']
};

const STRING_FIELDS = ['nombre', 'ingles', 'categoria', 'ubicacion', 'resumen', 'queHace', 'enElAvion',
  'cuando', 'truco', 'dato', 'otrosModelos'];

// Colores con significado propio en la interfaz (arcos de instrumentos y acento).
const RESERVED_COLORS = { 'arc-green': '#2E9A4E', 'arc-yellow': '#D9A400', 'arc-red': '#C7362B', 'accent': '#C8641A', 'accent-dark': '#F08A3C' };
const BACKGROUNDS = { claro: '#F6F8F9', oscuro: '#151D24' };

/* ───────────── Utilidades ───────────── */

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(rgb) {
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function rgbDistance(a, b) {
  return Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) * (v - b[i]), 0));
}
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

function loadInContext(files) {
  const sandbox = { console };
  vm.createContext(sandbox);
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
  console.error('No se pudo cargar controls-a.js: ' + e.stack);
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

/* ───────────── meta ───────────── */

const meta = DATA.meta || {};
ok(meta.avion === 'Cessna 150M 1976', "meta.avion debe ser 'Cessna 150M 1976'");
ok(isStr(meta.aviso) && meta.aviso.includes('Basado en un Cessna 150M 1976') && meta.aviso.includes('POH') && /instructor/.test(meta.aviso),
  'meta.aviso debe tener el texto del contrato (150M 1976, POH e instructor)');

/* ───────────── categorías ───────────── */

const cats = Array.isArray(DATA.categories) ? DATA.categories : [];
ok(cats.length === 8, 'debe haber exactamente 8 categorías (hay ' + cats.length + ')');
ok(JSON.stringify(cats.map((c) => c.id)) === JSON.stringify(CATEGORY_IDS),
  'las categorías deben ser ' + CATEGORY_IDS.join(', ') + ' en ese orden');
const seenColors = new Set();
for (const c of cats) {
  ok(isStr(c.nombre) && isStr(c.descripcion), 'categoría ' + c.id + ': nombre y descripcion no vacíos');
  const rgb = hexToRgb(c.color || '');
  if (!ok(rgb, 'categoría ' + c.id + ': color debe ser #RRGGBB (es ' + c.color + ')')) continue;
  ok(!seenColors.has(c.color.toUpperCase()), 'categoría ' + c.id + ': color repetido ' + c.color);
  seenColors.add(c.color.toUpperCase());
  for (const name of Object.keys(RESERVED_COLORS)) {
    const d = rgbDistance(rgb, hexToRgb(RESERVED_COLORS[name]));
    ok(d >= 60, 'categoría ' + c.id + ': color ' + c.color + ' demasiado parecido a ' + name + ' ' + RESERVED_COLORS[name] + ' (distancia ' + d.toFixed(0) + ')');
  }
  for (const bg of Object.keys(BACKGROUNDS)) {
    const k = contrast(rgb, hexToRgb(BACKGROUNDS[bg]));
    ok(k >= 3, 'categoría ' + c.id + ': color ' + c.color + ' con poco contraste sobre fondo ' + bg + ' (' + k.toFixed(2) + ':1, mínimo 3:1)');
  }
}
// Que los colores se distingan entre sí.
for (let i = 0; i < cats.length; i++) {
  for (let j = i + 1; j < cats.length; j++) {
    const a = hexToRgb(cats[i].color || ''), b = hexToRgb(cats[j].color || '');
    if (a && b) ok(rgbDistance(a, b) >= 45, 'categorías ' + cats[i].id + ' y ' + cats[j].id + ': colores demasiado parecidos');
  }
}

/* ───────────── fichas ───────────── */

const controls = Array.isArray(DATA.controls) ? DATA.controls : [];
ok(controls.length === A_IDS.length, 'controls-a.js debe agregar exactamente ' + A_IDS.length + ' fichas (agrega ' + controls.length + ')');
const counts = {};
controls.forEach((c) => { counts[c.id] = (counts[c.id] || 0) + 1; });
for (const id of A_IDS) ok(counts[id] === 1, 'el id ' + id + ' debe aparecer exactamente una vez (aparece ' + (counts[id] || 0) + ')');
for (const id of Object.keys(counts)) ok(A_IDS.includes(id), 'id inesperado en controls-a.js: ' + id);

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
    ok(sentences >= 2 && sentences <= 4, where + 'queHace debe tener de 2 a 4 oraciones (tiene ' + sentences + ')');
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
    ok(!('subitems' in c), where + 'no debería tener subitems (sólo master y light-switches)');
  }

  // Voseo rioplatense: nada de tuteo peninsular/neutro en los textos.
  const text = allText(c);
  // Sólo formas que no pueden ser tercera persona (“empuja” o “mira” sí pueden serlo).
  const tuteo = text.match(/(?<!\p{L})(puedes|debes|tienes|quieres|sabes|necesitas|asegúrate|fíjate|acuérdate|tú)(?!\p{L})/iu);
  ok(!tuteo, where + 'usar voseo (encontré “' + (tuteo && tuteo[0]) + '”)');
}

/* ───────────── Probalo esperados por tipo de control ───────────── */

const byId = {};
controls.forEach((c) => { byId[c.id] = c; });
const EXPECTED_PROBAR = {
  'yoke': { tipo: 'yoke' }, 'rudder-pedals': { tipo: 'pedales' }, 'toe-brakes': { tipo: 'pedales' },
  'parking-brake': { tipo: 'toggle', clave: 'parkingBrake' }, 'control-lock': { tipo: 'toggle', clave: 'controlLock' },
  'trim-wheel': { tipo: 'slider', clave: 'trim' }, 'flap-switch': { tipo: 'flaps' },
  'throttle': { tipo: 'slider', clave: 'throttle' }, 'mixture': { tipo: 'slider', clave: 'mixture' },
  'carb-heat': { tipo: 'slider', clave: 'carbHeat' }, 'primer': { tipo: 'accion', accion: 'primeStroke' },
  'ignition': { tipo: 'opciones', clave: 'ignition' }, 'fuel-shutoff': { tipo: 'toggle', clave: 'fuelValve' },
  'master': { tipo: 'master' }, 'light-switches': { tipo: 'luces' }, 'dimmers': { tipo: 'perilla', clave: 'panelLights' }
};
for (const id of Object.keys(EXPECTED_PROBAR)) {
  const p = byId[id] && byId[id].probar;
  const exp = EXPECTED_PROBAR[id];
  ok(p && Object.keys(exp).every((k) => p[k] === exp[k]), 'ficha ' + id + ': probar debería ser ' + JSON.stringify(exp));
}
const tw = byId['trim-wheel'] && byId['trim-wheel'].probar;
ok(tw && tw.min === -1 && tw.max === 1, 'trim-wheel: el slider de trim va de -1 (NOSE DN) a +1 (NOSE UP)');
['throttle', 'mixture', 'carb-heat'].forEach((id) => {
  const p = byId[id] && byId[id].probar;
  ok(p && p.min === 0 && p.max === 1, id + ': el slider va de 0 a 1');
});
const ign = byId.ignition && byId.ignition.probar;
ok(ign && JSON.stringify(ign.valores) === JSON.stringify(['OFF', 'R', 'L', 'BOTH', 'START']), 'ignition: valores OFF, R, L, BOTH, START en ese orden');

/* ───────────── Datos clave del manual ───────────── */

const FACTS = [
  ['yoke', /alerón izquierdo ARRIBA/, 'volante a la izquierda = alerón izquierdo arriba'],
  ['yoke', /20° arriba y 14° abajo/, 'recorrido de alerones 20/14'],
  ['rudder-pedals', /8,5°/, 'dirección de rueda de nariz 8,5°'],
  ['rudder-pedals', /30°/, 'hasta 30° con freno diferencial'],
  ['rudder-pedals', /23°/, 'timón ±23°'],
  ['toe-brakes', /talones/i, 'talones en el piso'],
  ['parking-brake', /PARK BRAKE/, 'cartel PARK BRAKE'],
  ['control-lock', /ha matado/, 'despegar con la traba puesta ha matado gente'],
  ['control-lock', /llave de encendido/, 'la bandera cuelga sobre la llave'],
  ['trim-wheel', /TAKE OFF/, 'marca TAKE OFF'],
  ['trim-wheel', /DERECHA del timón de profundidad/, 'aleta en la mitad derecha del timón'],
  ['trim-wheel', /volá con el volante y después compensá/i, 'frase del método de compensación'],
  ['flap-switch', /85 nudos/, 'Vfe 85 nudos'],
  ['flap-switch', /más de 10° no está aprobado/, 'más de 10° no aprobado para despegar'],
  ['flap-switch', /20°/, 'arremetida a 20°'],
  ['flap-switch', /9 segundos/, '≈ 9 s para bajar del todo'],
  ['flap-switch', /1977/, 'diferencia del 1977'],
  ['flap-indicator', /10°/, 'error de hasta ±10°'],
  ['throttle', /2460 y 2560/, 'RPM estáticas 2460–2560'],
  ['throttle', /1\/4 de pulgada/, 'acelerador 1/4 pulgada para arrancar'],
  ['mixture', /IDLE CUT-OFF/, 'corte de mezcla'],
  ['mixture', /RPM lleguen al máximo y empiecen a bajar/, 'método para empobrecer'],
  ['carb-heat', /200 a 250 RPM/, 'pérdida de 200–250 RPM'],
  ['carb-heat', /20 °C/, 'hielo con 20 °C y humedad'],
  ['carb-heat', /sin filtrar|NO pasa por el filtro/, 'aire sin filtrar'],
  ['primer', /hasta 6/, 'hasta 6 bombeos en frío'],
  ['primer', /ADENTRO y TRABADO/, 'cebador adentro y trabado'],
  ['ignition', /1700 RPM/, 'prueba a 1700 RPM'],
  ['ignition', /150 RPM/, 'caída máxima 150'],
  ['ignition', /75 RPM/, 'diferencia máxima 75'],
  ['ignition', /de arriba/, 'magneto derecha = bujías de arriba'],
  ['ignition', /hélice siempre está viva|como si estuviera viva/, 'hélice siempre viva'],
  ['fuel-shutoff', /FUEL – 22\.5 GALS – ON \/ OFF/, 'cartel de la válvula'],
  ['fuel-shutoff', /NO hay selector/, 'no hay selector izquierdo/derecho'],
  ['fuel-gauges', /1,75 galones/, '1,75 galones no usables por tanque'],
  ['fuel-gauges', /22,5/, '22,5 galones usables'],
  ['master', /NO apaga el motor/, 'el master no apaga el motor'],
  ['master', /izquierda = ALT, mitad derecha = BAT/, 'ALT izquierda, BAT derecha'],
  ['light-switches', /ANTES de arrancar/, 'baliza antes de arrancar'],
  ['light-switches', /no está aprobado para volar/, 'no aprobado para engelamiento'],
  ['dimmers', /PANEL LT/, 'PANEL LT'],
  ['circuit-breakers', /UNA sola vez/, 'reponer una sola vez'],
  ['ammeter', /dos anchos de aguja/, 'menos de 2 anchos de aguja a los 30 min'],
  ['ammeter', /HIGH VOLTAGE/, 'luz HIGH VOLTAGE']
];
for (const [id, re, what] of FACTS) {
  ok(byId[id] && re.test(allText(byId[id])), 'ficha ' + id + ': falta el dato “' + what + '”');
}
const fg = byId['fuel-gauges'];
ok(fg && fg.rangos.some((r) => r.color === 'rojo' && r.desde === 0 && r.hasta === 0), 'fuel-gauges: raya roja en E (0)');
const am = byId.ammeter;
ok(am && am.rangos.length >= 2, 'ammeter: rangos con explicación de + y −');

/* ───────────── Chequeos cruzados opcionales ───────────── */

const FILE_B = path.join(ROOT, 'src', 'data', 'controls-b.js');
if (fs.existsSync(FILE_B)) {
  try {
    const both = loadInContext([FILE, FILE_B]);
    const all = both.C150.DATA.controls;
    const ids = all.map((c) => c.id);
    ok(new Set(ids).size === ids.length, 'controls-a + controls-b: no debe haber ids repetidos');
    const missing = Object.keys(CONTRACT_IDS).filter((id) => !ids.includes(id));
    ok(missing.length === 0, 'controls-a + controls-b: faltan ids del contrato: ' + missing.join(', '));
    ok(both.C150.DATA.categories.length === 8, 'controls-b no debe pisar las categorías');
    all.forEach((c) => ok(CATEGORY_IDS.includes(c.categoria), 'ficha ' + c.id + ' (controls-b): categoría inválida'));
    console.log('  (chequeo cruzado con controls-b.js: ' + all.length + ' fichas en total)');
  } catch (e) {
    warn('no se pudo cargar controls-b.js junto con controls-a.js: ' + e.message);
  }
}

const FILE_SIM = path.join(ROOT, 'src', 'sim.js');
if (fs.existsSync(FILE_SIM)) {
  try {
    const withSim = loadInContext([FILE, FILE_SIM]);
    const state = withSim.C150.Sim.createState('parked');
    controls.forEach((c) => {
      if (c.probar && 'clave' in c.probar && getPath(state, c.probar.clave) === undefined) {
        warn('sim.js: createState() no tiene la clave ' + c.probar.clave + ' (usada por ' + c.id + ')');
      }
      if (c.probar && c.probar.tipo === 'accion' && typeof withSim.C150.Sim.actions[c.probar.accion] !== 'function') {
        warn('sim.js: falta C150.Sim.actions.' + c.probar.accion + ' (usada por ' + c.id + ')');
      }
    });
    console.log('  (chequeo cruzado con sim.js: claves de estado verificadas)');
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
console.log('OK: ' + checks + ' comprobaciones pasaron (' + controls.length + ' fichas, ' + cats.length + ' categorías).');
