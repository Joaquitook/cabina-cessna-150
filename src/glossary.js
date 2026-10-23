var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * glossary.js — C150.Glossary: "tocá una palabra y te explico qué es" (contrato UI/UX v4 §4, ola U2).
 *
 *   Glossary.annotate(rootEl, opts?)  Envuelve la PRIMERA aparición, dentro de rootEl, de cada término conocido con un
 *                                     <button class="term"> (subrayado punteado) que abre un popover con la definición,
 *                                     el nombre en inglés y "Verlo en 3D" si el término es un mando. Barato (< 5 ms por panel):
 *                                     un recorrido de palabras con búsqueda en un mapa, sin regex gigantes. Es idempotente
 *                                     (si ya hay .term en rootEl, esos términos cuentan como usados). Devuelve cuántos envolvió.
 *                                     opts: {control: 'yoke'}  no envuelve los términos de ese control (no se auto-referencia).
 *                                           {skip: ['g:alabeo', …]} ids de entrada a saltear · {all: true} todas las apariciones.
 *                                     Se saltea: títulos (h1–h6), botones, links, inputs, kbd, code, summary, svg, aria-hidden,
 *                                     .no-gloss / [data-no-gloss], .term ya hecho y los textos en vivo (.data, .mono, [data-live]).
 *   Glossary.define(texto)            → {termino, definicion, ingles, control, id} o null (acepta plural, tildes y mayúsculas).
 *   Glossary.register(terms[])        → suma términos {termino, definicion, ingles?, aliases?, control?} (ESCUELA agrega los suyos).
 *   Glossary.entries()                → todas las entradas del índice (para el buscador): [{id, termino, definicion, ingles, control, tipo}]
 *   Glossary.show(texto)              → abre el diálogo con la definición (el buscador lo usa). true si existe.
 *   Glossary.pop(buttonEl)            → abre el popover de un .term (lo hace solo el clic delegado).
 *   Glossary.stats()                  → {entradas, claves, ms} del último armado del índice.
 *   Parte pura (sin DOM, se prueba en Node con tests/validate-glossary.js):
 *   Glossary.fold(s) / foldKeep(s)    → minúsculas y sin tildes (misma longitud) / sin tildes conservando mayúsculas
 *   Glossary.buildIndex({glossary, controls, extras, controlIds}) → índice {map, entries, byId, keyCount}
 *   Glossary.findMatches(text, index, opts) → [{start, end, id}] sin superposiciones, una por término (opts.used, opts.all, opts.skip)
 *
 * Reglas de coincidencia (decisiones):
 *  - Se compara palabra por palabra (letras y números), sin distinguir tildes ni mayúsculas, salvo las SIGLAS (IAS, QNH, RPM…)
 *    y las velocidades V (Vne, Vx…), que exigen la misma forma. Los términos de varias palabras ("Centro de gravedad")
 *    ganan sobre los de una ("Centro"); entre palabras sólo se admiten espacios, "/" y "-".
 *  - Los términos de una sola palabra aceptan el plural (alerón → alerones, flap → flaps, luz → luces).
 *  - Las fichas de mandos aportan su nombre (sin el paréntesis) y sus otros nombres, salvo los demasiado comunes
 *    (STOP: "potencia", "radio", "frenos"…) y los de menos de 3 letras. Si un nombre ya es un término del glosario,
 *    el glosario manda para la definición y la ficha aporta el "Verlo en 3D".
 *  - "Va" y "pie" (en singular) se descartan: se confunden con el verbo y con el pie derecho.
 */
(function (C150) {
  'use strict';

  var Glossary = C150.Glossary = C150.Glossary || {};

  /* ================================================================== parte pura */

  function stripChar(c) { return c.normalize('NFD').charAt(0); }
  function foldKeep(s) { return String(s).replace(/[À-ɏ]/g, stripChar); }
  function fold(s) { return foldKeep(s).toLowerCase(); }

  var WORD = /[\p{L}\p{N}]+/gu;
  var GAP = /^[\s \/\-]+$/;
  var STOP = ('comando|los mandos|mandos|potencia|gases|encendido|arranque|radio|puerta|puertas|reloj|frenos|calefaccion|ventilacion|' +
    'aire fresco|bocina|timon|columna de mando|asiento|asientos|clock|indicador|reguladores de luz|aviso de perdida|alarma de perdida|' +
    'selector de audio|com|nav|llave|manija|palanca|escala|rockers|limitador|vacio|perilla roja').split('|');
  var NO_ATTACH = { 'checklist': 1 };                // términos del glosario que NO se unen a un mando por coincidir con un nombre
  var DROP = ['va', 'pie'];                          // se confunden con el verbo "va" y con "pie derecho"
  var STOP_SET = {}, DROP_SET = {};
  STOP.forEach(function (k) { STOP_SET[k] = 1; });
  DROP.forEach(function (k) { DROP_SET[k] = 1; });

  /** Términos del glosario ↔ mando que se puede ver en 3D (sólo cuando el nombre de la ficha no coincide). */
  var CONTROL_OF = {
    'alerón': 'yoke', 'timón de profundidad': 'yoke', 'cabeceo': 'yoke', 'alabeo': 'yoke', 'pitot': 'light-switches', 'succión': 'suction',
    'disyuntor': 'circuit-breakers', 'rpm': 'tachometer', 'qnh': 'altimeter', 'ralentí': 'throttle', 'velocímetro': 'asi',
    'vne': 'asi', 'vno': 'asi', 'vs0 / vs1': 'asi', 'vfe': 'flap-indicator', 'guiñada': 'rudder-pedals', 'cebador': 'primer',
    'coordinador de giro': 'turn-coordinator', 'viraje coordinado': 'turn-coordinator', 'ias': 'asi', 'rumbo': 'heading-indicator',
    'variómetro': 'vsi', 'giróscopo': 'attitude', 'direccional': 'heading-indicator', 'hielo en el carburador': 'carb-heat',
    'magneto': 'ignition', 'master': 'master', 'mezcla': 'mixture', 'desviación': 'compass'
  };
  /** Otras formas de decir lo mismo (se suman a las del glosario). */
  var MORE_ALIASES = {
    'carreteo': ['rodaje'], 'pérdida': ['stall'], 'tirabuzón': ['barrena'], 'ángulo de ataque': ['AOA'],
    'arremetida': ['motor y al aire'], 'horizonte artificial': ['horizonte'], 'toma estática': ['puerto estático']
  };
  /** Jerga que el glosario no trae. */
  var EXTRAS = [
    { termino: 'IAS', aliases: ['KIAS'], ingles: 'Indicated airspeed', control: 'asi',
      definicion: 'Velocidad indicada: la que marca el velocímetro. Se mide con la presión del aire que entra por el tubo de Pitot y es la que usás para volar, en nudos.' },
    { termino: 'ATC', aliases: ['Torre de control', 'Control de tránsito aéreo'], ingles: 'Air traffic control',
      definicion: 'Control de tránsito aéreo: las personas de la torre que te dan instrucciones por radio para despegar, aterrizar y moverte sin chocar con otros aviones.' },
    { termino: 'Rumbo', ingles: 'Heading', control: 'heading-indicator',
      definicion: 'Hacia dónde apunta la nariz del avión, en grados desde el norte: 360 es norte, 090 este, 180 sur y 270 oeste.' },
    { termino: 'Crucero', ingles: 'Cruise',
      definicion: 'La parte tranquila del vuelo: ya subiste, vas nivelado y con potencia y velocidad constantes.' },
    { termino: 'Fuselaje', ingles: 'Fuselage',
      definicion: 'El cuerpo del avión: la parte central con la cabina, los asientos y el equipaje, donde se unen las alas y la cola.' },
    { termino: 'Viraje', ingles: 'Turn',
      definicion: 'Cambiar de rumbo. El avión se inclina hacia el lado al que querés ir (alabeo) y gira. Se hace con volante y pedales juntos.' },
    { termino: 'Aproximación', ingles: 'Approach',
      definicion: 'La parte del vuelo en la que te alineás con la pista y bajás de a poco, con flaps y a velocidad controlada, para aterrizar.' },
    { termino: 'Planeo', ingles: 'Glide',
      definicion: 'Volar sin potencia, bajando de forma controlada. Un Cessna 150 con el motor al ralentí avanza unas 8 o 9 veces lo que desciende.' },
    { termino: 'Prevuelo', aliases: ['Inspección prevuelo', 'Pre-vuelo'], ingles: 'Preflight inspection',
      definicion: 'La vuelta de inspección alrededor del avión antes de volar: mirás alas, cola, nafta, aceite, hélice y ruedas siguiendo una lista.' },
    { termino: 'Vórtice', ingles: 'Vortex',
      definicion: 'Un remolino de aire. En la punta de cada ala se forma uno porque el aire de abajo (más presión) se escapa hacia arriba (menos presión).' },
    { termino: 'Bujía', ingles: 'Spark plug',
      definicion: 'La pieza que hace la chispa que enciende la mezcla de nafta y aire en cada cilindro. Cada cilindro del 150 tiene dos, alimentadas por los magnetos.' },
    { termino: 'Circuito de tránsito', ingles: 'Traffic pattern',
      definicion: 'El recorrido rectangular que hacen los aviones alrededor de la pista para despegar y aterrizar ordenados: con el viento, base y final.' }
  ];

  function stripParens(s) { return String(s).replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); }
  function parenOf(s) { var m = /\(([^)]*)\)/.exec(String(s)); return m ? m[1].trim() : ''; }
  function wordsOf(s) { var w = String(s).match(WORD); return w || []; }
  function isAcronym(display) {
    var d = String(display);
    return (/^[A-ZÁÉÍÓÚÑ0-9]{2,}$/.test(d)) || (/^V[a-z]{1,3}\d?$/.test(d));
  }
  function variants(words, cs) {
    // plural sólo para términos de una palabra (y no para siglas)
    if (words.length !== 1 || cs) return [words];
    var w = words[0], out = [[w]];
    if (/s$/.test(w) || w.length < 3) return out;
    if (/z$/.test(w)) out.push([w.slice(0, -1) + 'ces']);
    else if (/[aeiou]$/.test(w)) out.push([w + 's']);
    else { out.push([w + 's']); out.push([w + 'es']); }
    return out;
  }
  function keyFolded(display) { return wordsOf(display).map(fold).join(' '); }

  /**
   * Arma el índice. src = { glossary: [{termino, ingles, definicion}], controls: [{id, nombre, otrosNombres, ingles, resumen}],
   * extras: [{termino, aliases, ingles, definicion, control}], controlIds: ['yoke', …] (opcional: valida los "Verlo en 3D") }.
   * Devuelve { map: {palabra: [candidatos]}, entries, byId, keyCount, warnings }.
   */
  function buildIndex(src) {
    src = src || {};
    var entries = [], byId = {}, reg = {};            // reg: clave plegada → id de entrada
    var warnings = [];
    var ids = null;
    if (Array.isArray(src.controlIds)) { ids = {}; src.controlIds.forEach(function (c) { ids[c] = 1; }); }
    var cands = [];                                   // {words, cs, entry}

    function addEntry(e) { entries.push(e); byId[e.id] = e; return e; }
    function addKey(entry, display) {
      display = String(display || '').trim();
      if (!display) return;
      var base = keyFolded(display);
      if (!base || base.length < 3 && !isAcronym(display)) return;
      var cs = isAcronym(display);
      var vs = variants(wordsOf(display).map(cs ? foldKeep : fold), cs);
      vs.forEach(function (ws) {
        var k = ws.map(fold).join(' ');
        if (DROP_SET[k]) return;
        var rk = (cs ? 'cs:' : 'ci:') + k;
        if (reg[rk] && reg[rk] !== entry.id) { warnings.push('clave repetida "' + display + '": ' + reg[rk] + ' y ' + entry.id); return; }
        if (reg[rk]) return;
        reg[rk] = entry.id;
        cands.push({ words: ws, cs: cs, entry: entry });
        entry.keys.push(display);
      });
    }
    function findByKey(display) {
      var cs = isAcronym(display), k = keyFolded(display);
      return reg[(cs ? 'cs:' : 'ci:') + k] ? byId[reg[(cs ? 'cs:' : 'ci:') + k]] : null;
    }
    function controlFor(term) { var c = CONTROL_OF[String(term).toLowerCase()]; return c && (!ids || ids[c]) ? c : null; }

    // 1) glosario
    (src.glossary || []).forEach(function (g) {
      if (!g || !g.termino) return;
      var nm = stripParens(g.termino);
      var e = addEntry({ id: 'g:' + fold(g.termino), tipo: 'glosario', termino: g.termino, nombre: nm, definicion: g.definicion || '', ingles: g.ingles || '', control: g.control || controlFor(g.termino) || null, keys: [] });
      String(g.termino).split(/\s+\/\s+/).forEach(function (part) { addKey(e, stripParens(part)); });
      var p = parenOf(g.termino);
      if (p && p.indexOf('/') < 0 && wordsOf(p).length <= 3) addKey(e, p);
      (MORE_ALIASES[String(g.termino).toLowerCase()] || []).concat(g.aliases || []).forEach(function (a) { addKey(e, a); });
    });
    // 2) jerga extra
    (src.extras || EXTRAS).forEach(function (g) {
      if (!g || !g.termino) return;
      var e = addEntry({ id: 'x:' + fold(g.termino), tipo: 'extra', termino: g.termino, nombre: g.termino, definicion: g.definicion || '', ingles: g.ingles || '', control: g.control || null, keys: [] });
      if (e.control && ids && !ids[e.control]) e.control = null;
      addKey(e, g.termino);
      (g.aliases || []).forEach(function (a) { addKey(e, a); });
    });
    // 3) mandos: su nombre y sus otros nombres (si ya es un término del glosario, ese término suma el "Verlo en 3D")
    (src.controls || []).forEach(function (c) {
      if (!c || !c.id || !c.nombre) return;
      var names = [stripParens(c.nombre)];
      var p = parenOf(c.nombre);
      if (p && p.indexOf('/') < 0 && wordsOf(p).length <= 3) names.push(p);
      (c.otrosNombres || []).forEach(function (n) { names.push(stripParens(n)); });
      names = names.filter(function (n) { return n && !STOP_SET[keyFolded(n)] && (wordsOf(n).join('').length >= 3); });
      if (!names.length) return;
      var target = findByKey(names[0]);
      if (target) { if (!target.control) target.control = c.id; }
      else target = addEntry({ id: 'c:' + c.id, tipo: 'mando', termino: stripParens(c.nombre), nombre: stripParens(c.nombre), definicion: c.resumen || '', ingles: c.ingles || '', control: c.id, keys: [] });
      names.forEach(function (n, i) {
        var other = i ? findByKey(n) : null;
        if (other && other !== target) { if (!other.control && !NO_ATTACH[fold(other.termino)]) other.control = c.id; }      // otro nombre que ya es un término del glosario
        else addKey(target, n);
      });
    });

    // índice por primera palabra
    var map = {}, keyCount = 0;
    cands.forEach(function (c) {
      var k = fold(c.words[0]);
      (map[k] = map[k] || []).push(c);
      keyCount++;
    });
    Object.keys(map).forEach(function (k) { map[k].sort(function (a, b) { return b.words.length - a.words.length; }); });
    return { map: map, entries: entries, byId: byId, keyCount: keyCount, warnings: warnings, reg: reg };
  }

  /**
   * Busca términos en un texto. opts: {used: {id:1} (se completa), all, skip: [ids]}. Devuelve [{start, end, id}] en orden,
   * sin superposiciones; por defecto una sola vez por entrada.
   */
  function findMatches(text, index, opts) {
    opts = opts || {};
    var out = [], used = opts.used || {}, skip = {};
    (opts.skip || []).forEach(function (s) { skip[s] = 1; });
    if (!text || !index) return out;
    var toks = [], m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(text)) !== null) toks.push({ s: m.index, e: m.index + m[0].length, w: m[0] });
    for (var i = 0; i < toks.length; i++) {
      var cs0 = index.map[fold(toks[i].w)];
      if (!cs0) continue;
      var hit = null;
      for (var a = 0; a < cs0.length && !hit; a++) {
        var c = cs0[a];
        if (skip[c.entry.id] || (!opts.all && used[c.entry.id])) continue;
        var n = c.words.length, ok = true;
        for (var j = 0; j < n && ok; j++) {
          var t = toks[i + j];
          if (!t) { ok = false; break; }
          if (j > 0 && !GAP.test(text.slice(toks[i + j - 1].e, t.s))) { ok = false; break; }
          ok = c.cs ? foldKeep(t.w) === c.words[j] : fold(t.w) === c.words[j];
        }
        if (ok) hit = { c: c, n: n };
      }
      if (hit) {
        out.push({ start: toks[i].s, end: toks[i + hit.n - 1].e, id: hit.c.entry.id });
        used[hit.c.entry.id] = 1;
        i += hit.n - 1;
      }
    }
    return out;
  }

  Glossary.fold = fold; Glossary.foldKeep = foldKeep; Glossary.buildIndex = buildIndex; Glossary.findMatches = findMatches;
  Glossary.EXTRAS = EXTRAS;

  /* ================================================================== datos e índice perezoso */

  var extra = [];                          // términos registrados desde afuera
  var IDX = null, lastStats = { entradas: 0, claves: 0, ms: 0 };

  function nowMs() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function sources() {
    var D = C150.DATA || {};
    return { glossary: (D.glossary || []).concat(extra), controls: D.controls || [], extras: EXTRAS, controlIds: (D.controls || []).map(function (c) { return c.id; }) };
  }
  function index() {
    if (!IDX) {
      var t = nowMs();
      IDX = buildIndex(sources());
      lastStats = { entradas: IDX.entries.length, claves: IDX.keyCount, ms: Math.round((nowMs() - t) * 10) / 10 };
      if (IDX.warnings.length && root.console && root.console.warn) root.console.warn('[Glossary] ' + IDX.warnings.length + ' claves repetidas (la primera manda):', IDX.warnings.slice(0, 6));
    }
    return IDX;
  }
  function pub(e) { return e ? { id: e.id, termino: e.termino, definicion: e.definicion, ingles: e.ingles, control: e.control, tipo: e.tipo } : null; }

  Glossary.register = function (terms) {
    (Array.isArray(terms) ? terms : []).forEach(function (t) { if (t && t.termino) extra.push(t); });
    IDX = null;
  };
  Glossary.define = function (text) {
    var ix = index(), k = keyFolded(text);
    if (!k) return null;
    var id = ix.reg['ci:' + k] || ix.reg['cs:' + keyFolded(text)] || null;
    if (!id) { var ms = findMatches(String(text), ix, { all: true }); if (ms.length && ms[0].start === 0) id = ms[0].id; }
    return pub(id ? ix.byId[id] : null);
  };
  Glossary.entries = function () { return index().entries.map(pub); };
  Glossary.stats = function () { index(); return lastStats; };
  Glossary._reset = function () { IDX = null; extra = []; };

  /* ================================================================== DOM */

  if (typeof document === 'undefined') return;
  var doc = document;
  var SKIP_TAG = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, OPTION: 1, SCRIPT: 1, STYLE: 1,
    NOSCRIPT: 1, KBD: 1, CODE: 1, SUMMARY: 1, LABEL: 1, SVG: 1, svg: 1, MARK: 1 };
  var SKIP_SEL = '.no-gloss,[data-no-gloss],.term,.data,.mono,[data-live],.placard,.card-title,.sect-title,.row-name,.chip,.badge,[aria-hidden="true"],[contenteditable],.pop,.tip';

  function matchesSkip(el) { try { return el.matches(SKIP_SEL); } catch (e) { return false; } }

  function annotate(rootEl, opts) {
    opts = opts || {};
    if (!rootEl || rootEl.nodeType !== 1) return 0;
    var ix = index();
    if (!ix.keyCount) return 0;
    var used = {}, skip = (opts.skip || []).slice();
    if (opts.control) ix.entries.forEach(function (e) { if (e.control === opts.control || e.id === 'c:' + opts.control) skip.push(e.id); });
    var ex = rootEl.querySelectorAll('.term[data-gl]');
    for (var q = 0; q < ex.length; q++) used[ex[q].getAttribute('data-gl')] = 1;

    var walker = doc.createTreeWalker(rootEl, 1 | 4, {
      acceptNode: function (n) {
        if (n.nodeType === 3) return n.nodeValue.length >= 3 && /\S/.test(n.nodeValue) ? 1 : 3;
        if (SKIP_TAG[n.tagName] || matchesSkip(n)) return n === rootEl ? 3 : 2;
        return 3;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) { if (n.nodeType === 3) nodes.push(n); }
    var count = 0;
    for (var i = 0; i < nodes.length; i++) {
      var tn = nodes[i], text = tn.nodeValue;
      var ms = findMatches(text, ix, { used: used, skip: skip, all: !!opts.all });
      if (!ms.length) continue;
      var frag = doc.createDocumentFragment(), pos = 0;
      ms.forEach(function (m) {
        if (m.start > pos) frag.appendChild(doc.createTextNode(text.slice(pos, m.start)));
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'term'; b.setAttribute('data-gl', m.id); b.setAttribute('aria-haspopup', 'dialog');
        b.textContent = text.slice(m.start, m.end);
        frag.appendChild(b);
        pos = m.end; count++;
      });
      if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
      tn.parentNode.replaceChild(frag, tn);
    }
    return count;
  }
  Glossary.annotate = annotate;

  function body(e, K) {
    var h = K.el, nodes = [];
    nodes.push(h('p', { text: e.definicion || 'Sin descripción todavía.' }));
    if (e.ingles) nodes.push(h('p', { class: 'pop-en' }, h('span', { class: 'pop-en-k', text: 'En inglés' }), ' ', h('span', { lang: 'en', text: e.ingles })));
    return nodes;
  }
  function see3d(e, K, close) {
    var UI = C150.UI;
    if (!e.control || !UI || typeof UI.showControl !== 'function') return null;
    return K.button({ label: 'Verlo en 3D', icon: 'target', variant: 'primary', size: 'small', onClick: function () { if (close) close(); UI.showControl(e.control); } });
  }
  Glossary.pop = function (btn) {
    var K = C150.Kit;
    if (!btn || !K || typeof K.popover !== 'function') return null;
    var e = index().byId[btn.getAttribute('data-gl')];
    if (!e) return null;
    var pop = null;
    var content = body(e, K);
    var b3 = see3d(e, K, function () { if (pop) pop.close(); });
    if (b3) content.push(K.el('div', { class: 'pop-actions' }, b3));
    pop = K.popover(btn, { title: e.nombre || e.termino, content: content, label: 'Qué significa ' + (e.nombre || e.termino) });
    return pop;
  };
  Glossary.show = function (text) {
    var K = C150.Kit, e = Glossary.define(text);
    if (!e || !K || typeof K.dialog !== 'function') return false;
    var d = null;
    var content = body(e, K);
    var b3 = see3d(e, K, function () { if (d) d.close(); });
    if (b3) content.push(K.el('div', { class: 'pop-actions' }, b3));
    d = K.dialog({ kicker: e.tipo === 'mando' ? 'Mando de la cabina' : 'Glosario', title: e.nombre || e.termino, body: content,
      actions: [{ label: 'Entendido', variant: b3 ? 'secondary' : 'primary' }], label: 'Qué significa ' + e.termino });
    return true;
  };

  // un solo manejador de clic para todos los .term (sin escuchar nodo por nodo)
  doc.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('.term[data-gl]') : null;
    if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    var K = C150.Kit;
    if (t.getAttribute('aria-expanded') === 'true' && K && K.closePopover) { K.closePopover(); return; }
    Glossary.pop(t);
  }, true);
})(root.C150);
