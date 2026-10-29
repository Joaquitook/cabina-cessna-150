/*
 * check-consistency.js — Chequeo cruzado de ids y APIs entre TODOS los módulos de la app.
 * Uso: node tests/check-consistency.js      (sale con código 1 si algo falla)
 *
 * Carga data (controls-a, controls-b, learning) + sim + gauges en un contexto vm con un global falso
 * (sin DOM), y lee como TEXTO cockpit.js, exterior.js, core.js, ui.js e index.html para sacar los ids
 * que registran o usan. Comprueba que:
 *  - las 45 fichas, las 37 partes y las 16 animaciones del contrato (§5, §6) son exactamente las que hay;
 *  - todo id usado en relacionados, partesAvion, lecciones, recorrido, checklists, quiz y misiones existe;
 *  - las claves de probar existen en el estado del sim y las acciones en C150.Sim.actions;
 *  - gauges.js dibuja todos los ids de §5 (y draw/signature andan con cada escenario del sim);
 *  - cockpit.js registra un objeto clickeable + ancla para cada ficha, los subIds del contrato, las
 *    vistas de cámara que usan core.js y ui.js, y sólo pide a gauges.js ids que existen;
 *  - exterior.js registra cada parte y cada animación;
 *  - core.js y ui.js usan ids, claves y tipos de probar que existen;
 *  - index.html carga los scripts en el orden del contrato §1.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

let failures = 0, checks = 0;
const warnings = [];
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error('  FALLA: ' + msg); }
  return !!cond;
}
function warn(msg) { warnings.push(msg); }
function section(t) { console.log('\n== ' + t); }
const uniq = (a) => Array.from(new Set(a));
function getPath(obj, dotted) { return String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function sameSet(a, b) { const A = new Set(a), B = new Set(b); return A.size === B.size && [...A].every((x) => B.has(x)); }
function diff(a, b) { const B = new Set(b); return a.filter((x) => !B.has(x)); }
function matchAll(re, s, group) { const out = []; let m; const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); while ((m = r.exec(s))) out.push(m[group || 1]); return out; }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1'); }

/* ───────────── Contrato ───────────── */

const CONTROL_IDS = ['yoke', 'rudder-pedals', 'toe-brakes', 'parking-brake', 'control-lock', 'trim-wheel',
  'flap-switch', 'flap-indicator', 'throttle', 'mixture', 'carb-heat', 'primer', 'ignition', 'fuel-shutoff',
  'fuel-gauges', 'master', 'light-switches', 'dimmers', 'circuit-breakers', 'ammeter',
  'asi', 'attitude', 'altimeter', 'turn-coordinator', 'heading-indicator', 'vsi', 'compass', 'clock', 'oat',
  'tachometer', 'oil-gauges', 'suction', 'stall-warning', 'navcom', 'transponder', 'vor-indicator',
  'audio-panel', 'microphone', 'cabin-heat', 'cabin-air', 'air-vents', 'seats', 'seatbelts', 'doors', 'placards'];
// §5: ficha → gauge que dibuja gauges.js
const GAUGE_OF = {
  'trim-wheel': 'trim-indicator', 'flap-indicator': 'flap-indicator', 'fuel-gauges': 'fuel-gauges', 'ammeter': 'ammeter',
  'asi': 'asi', 'attitude': 'attitude', 'altimeter': 'altimeter', 'turn-coordinator': 'turn-coordinator',
  'heading-indicator': 'heading-indicator', 'vsi': 'vsi', 'compass': 'compass', 'clock': 'clock', 'oat': 'oat',
  'tachometer': 'tachometer', 'oil-gauges': 'oil-gauges', 'suction': 'suction', 'navcom': 'navcom',
  'transponder': 'transponder', 'vor-indicator': 'vor-indicator'
};
const SUBIDS = { master: ['alt', 'bat'], 'light-switches': ['dome', 'pitot', 'nav', 'strobe', 'beacon', 'taxi', 'landing'], doors: ['left', 'right', 'window'] };
const PART_IDS = ['aileronL', 'aileronR', 'elevator', 'trimTab', 'rudder', 'flapL', 'flapR', 'propeller', 'spinner',
  'noseWheel', 'mainWheels', 'brakes', 'wingL', 'wingR', 'stabilizer', 'fin', 'fuselage', 'cowling', 'pitotTube',
  'staticPort', 'stallWarningInlet', 'fuelCapL', 'fuelCapR', 'fuelVent', 'navLightL', 'navLightR', 'navLightTail',
  'beacon', 'landingLight', 'strobes', 'carbAirInlet', 'exhaust', 'doorL', 'doorR', 'windowL', 'struts', 'oilDoor'];
const ANIMS = ['axes-roll', 'axes-pitch', 'axes-yaw', 'four-forces', 'aoa-stall', 'flaps-extend', 'trim-tab',
  'adverse-yaw', 'left-turning', 'coordinated-turn', 'ground-steering', 'propeller-throttle', 'lights-demo',
  'controls-check', 'carb-ice', 'pitot-static'];
const SIM_PRESETS = ['parked', 'runup', 'runway', 'cruise', 'approach'];
const CAM_PRESETS = ['pilot', 'panel', 'left', 'center', 'right', 'floor', 'overhead', 'copilot', 'door'];
const PROBAR_TIPOS = ['yoke', 'pedales', 'slider', 'toggle', 'opciones', 'master', 'flaps', 'accion', 'luces', 'radio', 'perilla', 'puertas'];
// contrato §1 + contrato v2 §4 (laboratorio del aire: data/lab.js, airfoil.js, airflow.js, lab.js)
const SCRIPT_ORDER = ['data/controls-a.js', 'data/controls-b.js', 'data/learning.js', 'data/lab.js', 'data/situations.js', 'sim.js', 'gauges.js',
  'airfoil.js', 'world.js', 'cockpit.js', 'exterior.js', 'airflow.js', 'core.js', 'lab.js', 'situations.js', 'icons.js', 'kit.js', 'progress.js', 'ui.js'];
// contrato UI/UX v4 §4: módulos de las próximas olas (opcionales hasta que existan); si están, van antes de ui.js y después de progress.js
const SCRIPT_OPTIONAL = ['nav.js', 'glossary.js', 'search.js', 'home.js', 'onboarding.js'];   // nav.js (contrato v6): después de progress.js, antes de ui.js

/* ───────────── Carga (global falso, sin DOM) ───────────── */

const sandbox = { console, Math, Date, JSON };
vm.createContext(sandbox);
for (const f of ['data/controls-a.js', 'data/controls-b.js', 'data/learning.js', 'sim.js', 'gauges.js']) {
  try { vm.runInContext(read(f), sandbox, { filename: f }); }
  catch (e) { ok(false, 'no se pudo cargar ' + f + ' sin DOM: ' + e.message); }
}
const C150 = sandbox.C150 || {};
const DATA = C150.DATA || {};
const Sim = C150.Sim;
const Gauges = C150.Gauges;
const controls = DATA.controls || [];
const CTRL = {};
controls.forEach((c) => { CTRL[c.id] = c; });
const isCtrl = (id) => Object.prototype.hasOwnProperty.call(CTRL, id);

/* ───────────── Fichas ───────────── */
section('Fichas (data/controls-*.js)');
ok(sameSet(controls.map((c) => c.id), CONTROL_IDS) && controls.length === CONTROL_IDS.length,
  'las fichas deben ser exactamente las 45 del contrato §5 (faltan: ' + diff(CONTROL_IDS, controls.map((c) => c.id)).join(', ') +
  '; sobran: ' + diff(controls.map((c) => c.id), CONTROL_IDS).join(', ') + ')');
for (const c of controls) {
  (c.relacionados || []).forEach((r) => ok(isCtrl(r), c.id + ': relacionado inexistente ' + r));
  (c.partesAvion || []).forEach((p) => ok(PART_IDS.includes(p), c.id + ': parte del avión inexistente ' + p));
  ok(DATA.categories.some((k) => k.id === c.categoria), c.id + ': categoría inexistente ' + c.categoria);
  if (SUBIDS[c.id] && c.subitems) ok(sameSet(c.subitems.map((s) => s.subId), SUBIDS[c.id]), c.id + ': subitems distintos de ' + SUBIDS[c.id]);
}

/* ───────────── Sim ───────────── */
section('Sim (sim.js)');
ok(Sim && typeof Sim.createState === 'function' && typeof Sim.step === 'function' && typeof Sim.applyPreset === 'function', 'C150.Sim con createState/step/applyPreset');
ok(Sim && sameSet(Object.keys(Sim.PRESETS || {}), SIM_PRESETS), 'C150.Sim.PRESETS = ' + SIM_PRESETS.join(', '));
const states = {};
SIM_PRESETS.forEach((p) => {
  try { states[p] = Sim.createState(p); for (let i = 0; i < 20; i++) Sim.step(states[p], 0.05); }
  catch (e) { ok(false, 'createState/step(' + p + ') lanzó: ' + e.message); }
});
const st0 = states.parked || {};
['primeStroke', 'setIgnition', 'setFlapSwitch', 'setMaster'].forEach((a) => ok(Sim && Sim.actions && typeof Sim.actions[a] === 'function', 'C150.Sim.actions.' + a));
ok(Sim && Sim.AIRPORT && Sim.AIRPORT.spots && Sim.AIRPORT.spots.runway && Sim.AIRPORT.spots.runway.heading === 60, 'C150.Sim.AIRPORT (§9) con spots.runway rumbo 060');

/* ───────────── Probalo ───────────── */
section('Probalo (probar) contra el estado del sim');
for (const c of controls) {
  const p = c.probar;
  if (!p) continue;
  ok(PROBAR_TIPOS.includes(p.tipo), c.id + ': probar.tipo desconocido ' + p.tipo);
  if (p.clave) ok(getPath(st0, p.clave) !== undefined, c.id + ': probar.clave ' + p.clave + ' no existe en Sim.createState()');
  if (p.tipo === 'accion') ok(Sim.actions && typeof Sim.actions[p.accion] === 'function', c.id + ': acción ' + p.accion + ' no existe en Sim.actions');
  if (p.tipo === 'opciones') (p.valores || []).forEach((v) => ok(['OFF', 'R', 'L', 'BOTH', 'START'].includes(v) || p.clave !== 'ignition', c.id + ': valor de encendido inválido ' + v));
}
['lights', 'radio', 'engine', 'elec', 'air', 'surfaces', 'fuel', 'gyro', 'vacuum'].forEach((k) => ok(st0[k] && typeof st0[k] === 'object', 'estado.' + k + ' existe'));
['dome', 'nav', 'strobe', 'beacon', 'taxi', 'landing'].forEach((k) => ok(typeof getPath(st0, 'lights.' + k) === 'boolean', 'estado.lights.' + k));
['doorLeftOpen', 'doorRightOpen', 'windowLeftOpen', 'pitotHeat', 'primerLocked'].forEach((k) => ok(typeof st0[k] === 'boolean', 'estado.' + k));

/* ───────────── Aprendizaje ───────────── */
section('Aprendizaje (data/learning.js)');
(DATA.lessons || []).forEach((l) => (l.pasos || []).forEach((p, i) => {
  const w = 'lección ' + l.id + ' paso ' + (i + 1) + ': ';
  ok(p.anim == null || ANIMS.includes(p.anim), w + 'animación inexistente ' + p.anim);
  ok(p.foco == null || isCtrl(p.foco), w + 'foco inexistente ' + p.foco);
  ok(['exterior', 'cockpit'].includes(p.vista), w + 'vista inválida ' + p.vista);
}));
(DATA.tour || []).forEach((t, i) => ok(isCtrl(t.control), 'recorrido paso ' + (i + 1) + ': control inexistente ' + t.control));
const clIds = (DATA.checklists || []).map((c) => c.id);
(DATA.checklists || []).forEach((cl) => {
  ok(SIM_PRESETS.includes(cl.preset), 'checklist ' + cl.id + ': escenario inexistente ' + cl.preset);
  if (cl.continuaDe) ok(clIds.includes(cl.continuaDe), 'checklist ' + cl.id + ': continuaDe inexistente ' + cl.continuaDe);
  (cl.items || []).forEach((it, i) => {
    ok(isCtrl(it.control), 'checklist ' + cl.id + ' ítem ' + (i + 1) + ': control inexistente ' + it.control);
    if (typeof it.check === 'function') {
      try { const r = it.check(states[cl.preset] || st0); ok(typeof r === 'boolean' || r === 0 || r === 1, 'checklist ' + cl.id + ' ítem ' + (i + 1) + ': check debe devolver boolean'); }
      catch (e) { ok(false, 'checklist ' + cl.id + ' ítem ' + (i + 1) + ': check lanzó ' + e.message); }
    }
  });
});
(DATA.quiz || []).forEach((q, i) => {
  if (q.tipo === 'donde') ok(isCtrl(q.control), 'quiz ' + (i + 1) + ': control inexistente ' + q.control);
  else ok(q.tipo === 'opciones' && Array.isArray(q.opciones) && q.correcta >= 0 && q.correcta < q.opciones.length, 'quiz ' + (i + 1) + ': opciones/correcta inválidas');
});
(DATA.missions || []).forEach((m) => {
  ok(SIM_PRESETS.includes(m.preset), 'misión ' + m.id + ': escenario inexistente ' + m.preset);
  try {
    const s = Sim.createState(m.preset); const ctx = { t: 0, dt: 0.1, hold: 0, data: {} };
    let v = 0; for (let i = 0; i < 30; i++) { Sim.step(s, 0.1); ctx.t += 0.1; v = m.check(s, ctx); }
    ok(typeof v === 'number' && v >= 0 && v <= 1, 'misión ' + m.id + ': check devuelve 0..1 (devolvió ' + v + ')');
  } catch (e) { ok(false, 'misión ' + m.id + ': check lanzó ' + e.message); }
});

/* ───────────── Gauges ───────────── */
section('Instrumentos (gauges.js)');
const gIds = (Gauges && Gauges.IDS) || [];
ok(sameSet(gIds, uniq(Object.values(GAUGE_OF))), 'Gauges.IDS = los 19 ids de §5 (faltan: ' + diff(uniq(Object.values(GAUGE_OF)), gIds).join(', ') + ')');
function mockCtx() {
  const grad = { addColorStop() {} };
  const target = { canvas: { width: 512, height: 512 } };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (/^create(Linear|Radial|Conic)Gradient$/.test(k)) return () => grad;
      if (k === 'createPattern') return () => ({});
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * (w || 1) * (h || 1)), width: w, height: h });
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === 'isPointInPath') return () => false;
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
for (const id of gIds) {
  const sz = Gauges.size(id);
  ok(sz && sz.w > 0 && sz.h > 0, 'Gauges.size(' + id + ')');
  for (const p of SIM_PRESETS) {
    try {
      const sig = Gauges.signature(id, states[p]);
      ok(typeof sig === 'string' && sig.length > 0 && !/NaN|undefined/.test(sig), 'Gauges.signature(' + id + ', ' + p + ') = "' + sig + '"');
      Gauges.draw(id, mockCtx(), sz.w, sz.h, states[p]);
    } catch (e) { ok(false, 'Gauges.draw/signature(' + id + ', ' + p + ') lanzó ' + e.message); }
  }
}

/* ───────────── Cockpit (texto de cockpit.js) ───────────── */
section('Cabina (cockpit.js)');
const ck = stripComments(read('cockpit.js'));
const layoutIds = matchAll(/\{\s*gid:\s*'([a-z-]+)',\s*id:\s*'([a-z-]+)'/g, ck, 2);
const layoutGids = matchAll(/\{\s*gid:\s*'([a-z-]+)',\s*id:\s*'([a-z-]+)'/g, ck, 1);
const radioIds = matchAll(/\[\s*'([a-z-]+)',\s*0\.\d+\s*\]/g, ck);
const pushPullIds = matchAll(/pushPull\('([a-z-]+)'/g, ck);
const pickIds = uniq([].concat(
  matchAll(/\bbind\([^,()]+(?:\([^()]*\))?[^,()]*,\s*'([a-z-]+)'/g, ck),
  matchAll(/\bbind\(mesh\([\s\S]*?\),\s*'([a-z-]+)'\)/g, ck),
  matchAll(/\bproxy\('([a-z-]+)'/g, ck),
  matchAll(/\brockerSwitch\('([a-z-]+)'/g, ck),
  pushPullIds, layoutIds, radioIds));
const anchorIds = uniq([].concat(matchAll(/\banchor\('([a-z-]+)'/g, ck), pushPullIds, layoutIds, radioIds));
const gaugeReq = uniq([].concat(matchAll(/\baddGauge\('([a-z-]+)'/g, ck), layoutGids, radioIds));
for (const id of CONTROL_IDS) {
  ok(pickIds.includes(id), 'cockpit.js: no registra un objeto clickeable para ' + id);
  ok(anchorIds.includes(id), 'cockpit.js: no crea cockpit.anchors[' + id + '] (lo usan las vistas y los globos de la UI)');
}
diff(pickIds, CONTROL_IDS).forEach((id) => ok(false, 'cockpit.js: registra un id que no es ficha: ' + id));
gaugeReq.forEach((g) => ok(gIds.includes(g), 'cockpit.js: pide a gauges.js un id que no existe: ' + g));
diff(gIds, gaugeReq).forEach((g) => ok(false, 'cockpit.js: no muestra el instrumento ' + g + ' que dibuja gauges.js'));
const rockerSubs = matchAll(/\{\s*sub:\s*'([a-z]+)'/g, ck);
ok(sameSet(rockerSubs, SUBIDS['light-switches'].filter((s) => s !== 'dome')) || sameSet(rockerSubs, SUBIDS['light-switches']), 'cockpit.js: interruptores de luces con los subIds del contrato (' + rockerSubs.join(',') + ')');
ok(/rockerSwitch\('master',\s*'alt'/.test(ck) && /rockerSwitch\('master',\s*'bat'/.test(ck), "cockpit.js: master con subIds 'alt' y 'bat'");
ok(/bind\([^)]*'light-switches',\s*'dome'\)/.test(ck), "cockpit.js: luz de techo como 'light-switches'/'dome'");
ok(/'doors',\s*'window'/.test(ck) && /\bbind\(door,\s*'doors',\s*name\)/.test(ck), "cockpit.js: puertas con subIds left/right/window");
const presetBlock = (ck.match(/var presets = \{([\s\S]*?)\n\s*\};/) || [])[1] || '';
const camPresets = matchAll(/^\s*([a-z]+):\s*\{\s*position/mg, presetBlock);
CAM_PRESETS.forEach((p) => ok(camPresets.includes(p), 'cockpit.js: falta la vista de cámara ' + p));
const dragIds = uniq(matchAll(/dragAxes(?:\.([a-z]+)|\['([a-z-]+)'\])\s*=/g, ck).concat(matchAll(/dragAxes\['([a-z-]+)'\]\s*=/g, ck))).filter(Boolean);
dragIds.forEach((d) => ok(isCtrl(d), 'cockpit.js: dragAxes con id inexistente ' + d));

/* ───────────── Exterior (texto de exterior.js) ───────────── */
section('Exterior (exterior.js)');
const exSrc = read('exterior.js');
const ex = stripComments(exSrc);
const exParts = JSON.parse((ex.match(/var PART_IDS = (\[[\s\S]*?\]);/) || [, '[]'])[1].replace(/'/g, '"'));
const exAnims = JSON.parse((ex.match(/var ANIM_NAMES = (\[[\s\S]*?\]);/) || [, '[]'])[1].replace(/'/g, '"'));
ok(sameSet(exParts, PART_IDS), 'exterior.js: PART_IDS = las 37 partes de §6 (faltan: ' + diff(PART_IDS, exParts).join(', ') + ')');
ok(sameSet(exAnims, ANIMS), 'exterior.js: ANIM_NAMES = las 16 animaciones de §6 (faltan: ' + diff(ANIMS, exAnims).join(', ') + ')');
const exBody = ex.replace(/var PART_IDS = \[[\s\S]*?\];/, '').replace(/var ANIM_NAMES = \[[\s\S]*?\];/, '');
const partCalls = matchAll(/\bpart\('([A-Za-z]+)'/g, exBody);
for (const p of PART_IDS) {
  ok(partCalls.includes(p) || new RegExp("'" + p + "'\\s*:\\s*'|\\?\\s*'[A-Za-z]+'\\s*:\\s*'" + p + "'|'" + p + "'\\s*:").test(exBody) || new RegExp("var \\w+ = [^;]*'" + p + "'").test(exBody),
    'exterior.js: la parte ' + p + ' no se registra con part()');
}
const animBlock = (ex.match(/var ANIMS = \{([\s\S]*?)\n    \};/) || [])[1] || '';
const animKeys = matchAll(/^ {6}'([a-z-]+)':\s*\{/mg, animBlock);
ANIMS.forEach((a) => ok(animKeys.includes(a), 'exterior.js: la animación ' + a + ' no está implementada en ANIMS'));
const exViews = matchAll(/^\s{4}([a-zA-Z0-9]+):\s*\{\s*pos:/mg, (ex.match(/var VIEWS = \{([\s\S]*?)\n  \};/) || [])[1] || '');
matchAll(/view:\s*'([a-zA-Z0-9]+)'/g, animBlock).forEach((v) => ok(exViews.includes(v), 'exterior.js: animación usa una vista inexistente ' + v));
['scene', 'camera', 'root', 'update', 'setHighlight', 'play', 'stop', 'setView', 'showLabels', 'caption', 'followAttitude', 'playing']
  .forEach((k) => ok(new RegExp('ext\\.' + k + '\\s*=|' + k + ':\\s|get ' + k + '\\b|\\b' + k + "'\\s*,\\s*\\{|defineProperty\\(ext,\\s*'" + k + "'").test(ex), 'exterior.js: ext.' + k + ' (API del contrato §4)'));

/* ───────────── Core (texto de core.js) ───────────── */
section('Core (core.js)');
const core = stripComments(read('core.js'));
const coreObj = (name) => { const m = core.match(new RegExp('var ' + name + ' = \\{([\\s\\S]*?)\\n  \\};')); return m ? m[1] : ''; };
const keysOf = (body) => matchAll(/(?:^|[,{]\s*|\n\s*)'?([a-z][a-zA-Z-]*)'?\s*:/g, body);
keysOf(coreObj('DRAG_KIND')).forEach((id) => ok(isCtrl(id), 'core.js DRAG_KIND: id inexistente ' + id));
const knobKeys = coreObj('KNOB_KEY');
matchAll(/'?([a-z][a-z-]*)'?\s*:\s*'([a-zA-Z]+)'/g, knobKeys, 1).forEach((id) => ok(isCtrl(id), 'core.js KNOB_KEY: id inexistente ' + id));
matchAll(/:\s*'([a-zA-Z]+)'/g, knobKeys).forEach((k) => ok(getPath(st0, k) !== undefined, 'core.js KNOB_KEY: clave de estado inexistente ' + k));
const presetKeys = JSON.parse((core.match(/var PRESET_KEYS = (\[[^\]]*\]);/) || [, '[]'])[1].replace(/'/g, '"'));
presetKeys.forEach((p) => ok(camPresets.includes(p), 'core.js PRESET_KEYS: la cabina no tiene la vista ' + p));
const fb = coreObj('FALLBACK_PROBAR');
for (const c of controls) {
  if (!c.probar) continue;
  const re = new RegExp("(?:'" + c.id + "'|\\b" + c.id.replace(/-/g, '_') + ")\\s*:\\s*\\{\\s*tipo:\\s*'" + c.probar.tipo + "'" + (c.probar.clave ? "\\s*,\\s*clave:\\s*'" + c.probar.clave.replace('.', '\\.') + "'" : ''));
  ok(re.test(fb), 'core.js FALLBACK_PROBAR: ' + c.id + ' debería ser ' + c.probar.tipo + (c.probar.clave ? '/' + c.probar.clave : ''));
}
const ckApi = ['group', 'pickables', 'anchors', 'views', 'presets', 'dragAxes', 'update', 'setHighlight', 'clearHighlights', 'eye'];
ckApi.forEach((k) => {
  const used = new RegExp('cockpit\\.' + k + '\\b').test(core);
  if (['clearHighlights', 'eye'].includes(k)) { if (!used) warn('core.js no usa cockpit.' + k + ' (opcional)'); }
  else ok(used, 'core.js usa cockpit.' + k);
});
ok(/C150\.Cockpit\.create\(\s*\w+\s*,\s*\{\s*gauges:/.test(core), 'core.js crea la cabina con C150.Cockpit.create(THREE, {gauges})');
ok(/C150\.World\.create\(\s*\w+\s*\)/.test(core), 'core.js crea el mundo con C150.World.create(THREE)');
ok(/C150\.Exterior\.create\(\s*\w+\s*\)/.test(core), 'core.js crea el exterior con C150.Exterior.create(THREE)');

/* ───────────── UI (texto de ui.js + index.html) ───────────── */
section('UI (ui.js, index.html)');
const ui = stripComments(read('ui.js'));
const uiCam = matchAll(/\[\s*'([a-z]+)',\s*'[^']+'\s*\]/g, (ui.match(/\['pilot',[\s\S]*?\]\s*\]/) || [''])[0]);
ok(uiCam.length >= 6, 'ui.js: lista de vistas de cámara encontrada (' + uiCam.join(',') + ')');
uiCam.forEach((p) => ok(camPresets.includes(p), 'ui.js: botón de vista ' + p + ' que la cabina no tiene'));
PROBAR_TIPOS.forEach((t) => ok(new RegExp("case '" + t + "':").test(ui), 'ui.js: no arma el widget Probalo de tipo ' + t));
uniq(controls.filter((c) => c.probar && c.probar.formato).map((c) => c.probar.formato))
  .forEach((f) => ok(new RegExp("case '" + f + "':").test(ui), 'ui.js: no sabe mostrar el formato de perilla ' + f));
const coreFns = matchAll(/\bcc\('([a-zA-Z]+)'/g, ui).concat(matchAll(/\bhas\('([a-zA-Z]+)'\)/g, ui));
const coreApi = matchAll(/^\s{2}Core\.([a-zA-Z]+)\s*=|^\s{4}([a-zA-Z]+):\s*[a-zA-Z]+,?$/mg, core).filter(Boolean);
const coreHas = (fn) => new RegExp('(?:Core|api|C)\\.' + fn + '\\s*=|\\b' + fn + ':\\s*' + '|function ' + fn + '\\b').test(core);
uniq(coreFns).forEach((fn) => {
  if (coreHas(fn)) ok(true, '');
  else warn('ui.js llama Core.' + fn + ' que core.js no tiene (debe tener plan B)');
});
// Literal ids de fichas usados en ui.js (entre comillas) que parezcan ids: deben existir.
// Mapas ficha → animación en ui.js: { 'yoke': 'axes-roll', ... }
const uiAnimMap = (ui.match(/'yoke':\s*'axes-roll'[\s\S]*?\}/) || [''])[0];
ok(uiAnimMap.length > 0, 'ui.js: mapa ficha → animación encontrado');
matchAll(/'([a-z-]+)':\s*'([a-z-]+)'/g, uiAnimMap, 1).forEach((id) => ok(isCtrl(id), 'ui.js mapa ficha→animación: id inexistente ' + id));
matchAll(/'([a-z-]+)':\s*'([a-z-]+)'/g, uiAnimMap, 2).forEach((a) => ok(ANIMS.includes(a), 'ui.js mapa ficha→animación: animación inexistente ' + a));
const uiQuoted = uniq(matchAll(/'([a-z]+(?:-[a-z]+)+)'/g, ui)).filter((s) => /^(?:yoke|rudder|toe|parking|control|trim|flap|throttle|mixture|carb|primer|ignition|fuel|master|light|dimmers|circuit|ammeter|asi|attitude|altimeter|turn|heading|vsi|compass|clock|oat|tachometer|oil|suction|stall|navcom|transponder|vor|audio|microphone|cabin|air|seats|seatbelts|doors|placards)\b/.test(s));
uiQuoted.forEach((s) => { if (!isCtrl(s) && !ANIMS.includes(s) && !GAUGE_OF[s] && !Object.values(GAUGE_OF).includes(s)) warn('ui.js menciona "' + s + '", que no es un id de ficha'); });
const html = read('index.html');
const order = matchAll(/<script\s+data-inline="([^"]+)"/g, html);
const orderCore = order.filter((f) => !SCRIPT_OPTIONAL.includes(f));
ok(JSON.stringify(orderCore) === JSON.stringify(SCRIPT_ORDER), 'index.html: orden de scripts del contrato §1 + v4 (' + order.join(' → ') + ')');
order.filter((f) => SCRIPT_OPTIONAL.includes(f)).forEach((f) => ok(order.indexOf(f) > order.indexOf('progress.js') && order.indexOf(f) < order.indexOf('ui.js'), 'index.html: ' + f + ' entre progress.js y ui.js'));
const three = html.indexOf('three@0.147.0/build/three.min.js'), orbit = html.indexOf('OrbitControls.js'), rbox = html.indexOf('RoundedBoxGeometry.js'), first = html.indexOf('data-inline="data/controls-a.js"');
ok(three > 0 && three < orbit && orbit < rbox && rbox < first, 'index.html: three → OrbitControls → RoundedBoxGeometry antes de los módulos');
ok(/^<title>[^<]+<\/title>/.test(html.trim()), 'index.html empieza con <title>');
ok(!/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(html), 'index.html sin doctype/html/head/body (los agrega build.js)');
['inicio', 'explorar', 'basico', 'recorrido', 'checklists', 'volar', 'quiz', 'aire'].forEach((m) => {
  ok(new RegExp('data-mode="' + m + '"').test(html), 'index.html: botón de navegación o sub-pestaña ' + m);
  ok(new RegExp('id="panel-' + m + '"').test(html), 'index.html: panel ' + m);
});
['inicio', 'cabina', 'lecciones', 'practicar', 'aire'].forEach((g) => ok(new RegExp('class="nav-item[^"]*" id="nav-' + g + '" data-group="' + g + '"').test(html), 'index.html: grupo de navegación ' + g));
ok(/id="nav-escuela"[^>]*hidden/.test(html) && /id="panel-escuela"/.test(html), 'index.html: Escuela reservada (oculta hasta que exista C150.Escuela)');
ok(/id="sheet-grip"/.test(html) && /id="btn-search"/.test(html) && /id="btn-progress"/.test(html), 'index.html: asa de la hoja inferior, buscar y anillo de avance');

/* ───────────── Resultado ───────────── */
warnings.forEach((w) => console.warn('  AVISO: ' + w));
if (failures) { console.error('\n' + failures + ' de ' + checks + ' comprobaciones fallaron.'); process.exit(1); }
console.log('\nOK: ' + checks + ' comprobaciones de consistencia pasaron.');
