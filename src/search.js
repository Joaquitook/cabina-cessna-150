var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * search.js — C150.Search: el buscador de toda la aplicación (Ctrl+K, "/" o la lupa), contrato UI/UX v4 §2 y §4, ola U2.
 *
 *   Search.open(opts?)     abre la paleta (opts.query: texto inicial). Search.close() · Search.isOpen()
 *   Search.register(p)     suma un proveedor: { id, label, icon?, order?, max?, items(query) → [{titulo, detalle, icono, accion(), color?, score?}] }
 *                          (ESCUELA registra el suyo). items('') puede devolver atajos para la pantalla vacía; si no hay `score`,
 *                          cuenta el orden en que vienen. Un proveedor que falla no rompe a los demás.
 *   Search.unregister(id)
 *   Search.query(q)        → [{id, label, icon, items:[…con score y html de resaltado]}] ya ordenados (los grupos con mejor resultado primero)
 *   Search.rank(q, lista, camposDe, limite?) → helper para proveedores: camposDe(x) → [[texto, peso], …]; devuelve [{x, score}] (sin tildes ni mayúsculas)
 *   Search.tokens(q)       → palabras de la consulta sin tildes ni palabras vacías ("ir a", "qué es"…)
 *   Search.fold(s)
 *
 * Proveedores de fábrica: atajos (ir a una sección, ver el tutorial, cambiar el tema…), mandos de la cabina, glosario, lecciones y
 * recorrido, practicar (checklists, misiones, situaciones, quiz) y aire (experimentos). Las acciones salen de C150.UI
 * (showControl, openLesson, openChecklist, openMission, openSituation, startQuiz, openLab, go) y de C150.Glossary.show.
 *
 * Teclado: ↑ ↓ (y RePág/AvPág) mueven la selección, Enter abre, Esc cierra, Tab queda dentro. En teléfonos ocupa toda la pantalla.
 * Los resultados se arman en cada tecla pero el índice de textos plegados se calcula una sola vez por proveedor.
 */
(function (C150) {
  'use strict';

  var Search = C150.Search = C150.Search || {};

  /* ================================================================== parte pura */

  function fold(s) { return String(s === null || s === undefined ? '' : s).replace(/[À-ɏ]/g, function (c) { return c.normalize('NFD').charAt(0); }).toLowerCase(); }
  var STOPW = {};
  ('ir a al la el los las de del en un una y o que es son qué donde dónde esta está como cómo quiero ver abrir abri abrí empezar empeza empezá ' +
    'iniciar inicia iniciá mostrar mostrame mostrá muestrame hacer hace haceme buscar busca buscá para por con se me mi mis lo le').split(' ').forEach(function (w) { STOPW[fold(w)] = 1; });

  function tokens(q) {
    var all = fold(q).split(/[^a-z0-9ñ]+/).filter(Boolean);
    var keep = all.filter(function (w) { return !STOPW[w]; });
    var out = keep.length ? keep : all;
    return out.filter(function (w, i) { return w.length > 1 || out.length === 1; });
  }

  /** Puntaje de un campo (ya plegado) contra una palabra. 0 = no aparece. */
  function fieldScore(text, tok) {
    if (!text) return 0;
    if (text === tok) return 100;
    if (text.indexOf(tok) === 0) return 82;
    var i = text.indexOf(' ' + tok);
    if (i >= 0) return 64;
    i = text.indexOf(tok);
    if (i >= 0) return tok.length >= 3 ? 36 : 12;
    return 0;
  }
  /** campos: [[textoPlegado, peso], …]. Todas las palabras tienen que aparecer (en algún campo). */
  function scoreFields(toks, campos) {
    if (!toks.length) return 0;
    var total = 0;
    for (var t = 0; t < toks.length; t++) {
      var best = 0;
      for (var c = 0; c < campos.length; c++) {
        var s = fieldScore(campos[c][0], toks[t]) * campos[c][1];
        if (s > best) best = s;
      }
      if (best <= 0) return 0;
      total += best;
    }
    var avg = total / toks.length;
    var joined = toks.join(' ');
    if (campos[0] && campos[0][0].indexOf(joined) === 0) avg += 12;       // el título empieza con lo que escribió
    return avg;
  }
  /** Helper para proveedores: lista de cualquier cosa + función que da sus campos [[texto, peso], …]; se pliega una sola vez (cache en la lista). */
  function rank(q, lista, camposDe, limite) {
    var toks = tokens(q), out = [];
    if (!toks.length) return out;
    if (!lista._fold) lista._fold = lista.map(function (x) { return camposDe(x).map(function (c) { return [fold(c[0]), c[1]]; }); });
    for (var i = 0; i < lista.length; i++) {
      var s = scoreFields(toks, lista._fold[i]);
      if (s > 0) out.push({ x: lista[i], score: s });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    // coincidencias sólo en el texto largo (definición, resumen) valen poco: si hay algo mejor, no ensucian la lista
    if (out.length && out[0].score >= 30) out = out.filter(function (r) { return r.score >= 15; });
    return limite ? out.slice(0, limite) : out;
  }

  var providers = [];
  function register(p) {
    if (!p || !p.id || typeof p.items !== 'function') return false;
    for (var i = 0; i < providers.length; i++) if (providers[i].id === p.id) { providers[i] = p; return true; }
    providers.push(p);
    return true;
  }
  function unregister(id) { providers = providers.filter(function (p) { return p.id !== id; }); }

  function query(q) {
    var groups = [];
    providers.forEach(function (p, order) {
      var items = [];
      try { items = p.items(String(q || '')) || []; } catch (e) { if (root.console) console.error('[Search] proveedor ' + p.id, e); items = []; }
      items = items.filter(function (it) { return it && it.titulo && typeof it.accion === 'function'; }).map(function (it, i) {
        return { titulo: it.titulo, detalle: it.detalle || '', icono: it.icono || p.icon || 'search', color: it.color || null, accion: it.accion,
          score: typeof it.score === 'number' ? it.score : (1000 - i), grupo: p.id };
      });
      items.sort(function (a, b) { return b.score - a.score; });
      var max = p.max || 5;
      if (items.length) groups.push({ id: p.id, label: p.label || p.id, icon: p.icon || 'search', top: items[0].score, order: p.order !== undefined ? p.order : order, items: items.slice(0, max), total: items.length });
    });
    groups.sort(function (a, b) { return (b.top - a.top) || (a.order - b.order); });
    return groups;
  }

  Search.fold = fold; Search.tokens = tokens; Search.rank = rank; Search.register = register; Search.unregister = unregister; Search.query = query;
  Search.providers = function () { return providers.map(function (p) { return p.id; }); };

  /* ================================================================== proveedores de fábrica */

  function D() { return C150.DATA || {}; }
  function UI() { return C150.UI || {}; }
  function call(name) { var u = UI(); if (typeof u[name] === 'function') return u[name].apply(u, Array.prototype.slice.call(arguments, 1)); return undefined; }
  function trunc(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function firstSentence(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); var m = /^(.+?[.!?])(\s|$)/.exec(s); return trunc(m && m[1].length <= n ? m[1] : s, n); }
  function click(id) { var el = typeof document !== 'undefined' ? document.getElementById(id) : null; if (el) el.click(); }

  function actionList() {
    function go(path) { return function () { if (call('go', path) === undefined) call('setMode', path); call('sheet', 'half'); }; }
    return [
      { titulo: 'Ir al Inicio', detalle: 'Tu camino, tu avance y qué hacer ahora', icono: 'home', keys: ['inicio', 'home', 'camino', 'avance', 'progreso', 'empezar'], top: 1, accion: go('inicio') },
      { titulo: 'Ir a la Cabina', detalle: 'Tocá cada mando e instrumento para conocerlo', icono: 'cabin', keys: ['cabina', 'explorar', 'mandos', 'controles', 'instrumentos'], top: 1, accion: go('cabina') },
      { titulo: 'Recorrido guiado', detalle: 'Un paseo por la cabina, control por control', icono: 'route', keys: ['recorrido', 'tour', 'paseo', 'guiado', 'primer dia'], top: 1, accion: go('lecciones/recorrido') },
      { titulo: 'Lecciones: cómo vuela un avión', detalle: 'Las cuatro fuerzas, el ala, los mandos…', icono: 'book', keys: ['lecciones', 'lo basico', 'aprender', 'teoria', 'como vuela'], top: 1, accion: go('lecciones/basico') },
      { titulo: 'Checklists', detalle: 'Los pasos antes de cada maniobra', icono: 'checklist', keys: ['checklists', 'listas', 'procedimientos', 'chequeo'], top: 1, accion: go('practicar/checklists') },
      { titulo: 'Misiones y situaciones', detalle: 'Pasá de mirar a volar', icono: 'plane', keys: ['misiones', 'situaciones', 'volar', 'practicar', 'emergencia', 'vuelo'], top: 1, accion: go('practicar/volar') },
      { titulo: 'Quiz', detalle: 'Probá lo que sabés', icono: 'quiz', keys: ['quiz', 'preguntas', 'examen', 'test', 'evaluar'], top: 1, accion: function () { call('startQuiz'); } },
      { titulo: 'Aire: el laboratorio', detalle: 'Mirá cómo se mueve el aire alrededor del avión', icono: 'wind', keys: ['aire', 'laboratorio', 'tunel de viento', 'flujo', 'viento'], top: 1, accion: go('aire') },
      { titulo: 'Ver el tutorial de bienvenida', detalle: 'Un recorrido de 5 pasos por la aplicación', icono: 'play', keys: ['tutorial', 'bienvenida', 'intro', 'introduccion', 'como se usa', 'ayuda'], top: 1,
        accion: function () { var o = C150.Onboarding; if (o && typeof o.start === 'function') o.start({ force: true }); } },
      { titulo: 'Ayuda: cómo se usa', detalle: 'Mirar, tocar, atajos de teclado y calidad gráfica', icono: 'help', keys: ['ayuda', 'atajos', 'teclado', 'calidad', 'grafica', 'como se usa'], top: 0, accion: function () { call('openHelp'); } },
      { titulo: 'Cambiar el tema (claro / oscuro)', detalle: 'Automático, claro u oscuro', icono: 'sun', keys: ['tema', 'oscuro', 'claro', 'modo oscuro', 'modo claro', 'noche'], top: 0, accion: function () { click('btn-theme'); } },
      { titulo: 'Sonido de la bocina de pérdida', detalle: 'Prender o apagar el sonido', icono: 'sound', keys: ['sonido', 'bocina', 'silencio', 'audio', 'mute'], top: 0, accion: function () { click('btn-sound'); } }
    ];
  }
  var ACT = null;
  register({
    id: 'atajos', label: 'Ir a…', icon: 'arrow-right', order: 0, max: 5,
    items: function (q) {
      if (!ACT) ACT = actionList();
      if (!tokens(q).length) return ACT.filter(function (a) { return a.top; }).slice(0, 6).map(function (a, i) { return { titulo: a.titulo, detalle: a.detalle, icono: a.icono, accion: a.accion, score: 1000 - i }; });
      return rank(q, ACT, function (a) { return [[a.titulo, 1], [a.keys.join(' '), 0.9], [a.detalle, 0.2]]; }).map(function (r) {
        return { titulo: r.x.titulo, detalle: r.x.detalle, icono: r.x.icono, accion: r.x.accion, score: r.score * 0.9 };
      });
    }
  });

  var CTRLS = null;
  register({
    id: 'mandos', label: 'Mandos de la cabina', icon: 'cabin', order: 1, max: 5,
    items: function (q) {
      var d = D();
      if (!CTRLS) CTRLS = (d.controls || []).filter(function (c) { return c && c.id && c.nombre; });
      var cats = {}; (d.categories || []).forEach(function (c) { cats[c.id] = c; });
      return rank(q, CTRLS, function (c) {
        return [[c.nombre, 1], [(c.otrosNombres || []).join(' '), 0.92], [c.ingles || '', 0.85], [(cats[c.categoria] || {}).nombre || '', 0.35], [c.resumen || '', 0.22]];
      }).map(function (r) {
        var c = r.x;
        return { titulo: c.nombre, detalle: trunc(c.resumen, 110), icono: 'target', color: (cats[c.categoria] || {}).color, score: r.score + (c.prioridad === 1 ? 4 : 0),
          accion: function () { call('showControl', c.id); } };
      });
    }
  });

  var GLOS = null;
  register({
    id: 'glosario', label: 'Glosario: qué significa', icon: 'bulb', order: 2, max: 5,
    items: function (q) {
      var G = C150.Glossary;
      if (!GLOS) { if (!G || typeof G.entries !== 'function') return []; GLOS = G.entries().filter(function (e) { return e.tipo !== 'mando'; }); }
      return rank(q, GLOS, function (e) { return [[e.termino, 1], [e.ingles || '', 0.85], [e.definicion || '', 0.18]]; }).map(function (r) {
        var e = r.x;
        return { titulo: e.termino, detalle: firstSentence(e.definicion, 110), icono: 'bulb', score: r.score,
          accion: function () { if (!(G && G.show(e.termino)) && e.control) call('showControl', e.control); } };
      });
    }
  });
  Search.resetCaches = function () { CTRLS = null; GLOS = null; LECC = null; PRAC = null; AIRE = null; ACT = null; };

  var LECC = null;
  register({
    id: 'lecciones', label: 'Lecciones y recorrido', icon: 'book', order: 3, max: 5,
    items: function (q) {
      var d = D();
      if (!LECC) {
        LECC = [];
        (d.lessons || []).forEach(function (L) {
          if (!L || !L.id) return;
          LECC.push({ titulo: L.titulo, detalle: L.resumen, extra: (L.pasos || []).map(function (p) { return p.titulo; }).join(' '), icono: 'book', accion: function () { call('openLesson', L.id); } });
        });
        var ctl = {}; (d.controls || []).forEach(function (c) { ctl[c.id] = c.nombre; });
        (d.tour || []).forEach(function (t, i) {
          if (!t || !t.titulo) return;
          LECC.push({ titulo: 'Recorrido: ' + t.titulo, detalle: trunc(t.texto, 110), extra: ctl[t.control] || '', icono: 'route', accion: function () { call('go', 'lecciones/recorrido'); call('sheet', 'half'); } });
        });
      }
      return rank(q, LECC, function (x) { return [[x.titulo, 1], [x.extra || '', 0.4], [x.detalle || '', 0.25]]; }).map(function (r) {
        return { titulo: r.x.titulo, detalle: trunc(r.x.detalle, 110), icono: r.x.icono, score: r.score, accion: r.x.accion };
      });
    }
  });

  var PRAC = null;
  register({
    id: 'practicar', label: 'Practicar', icon: 'checklist', order: 4, max: 5,
    items: function (q) {
      var d = D();
      if (!PRAC) {
        PRAC = [];
        (d.checklists || []).forEach(function (c) {
          if (!c || !c.id) return;
          PRAC.push({ titulo: 'Checklist: ' + c.titulo, detalle: c.descripcion, extra: (c.items || []).map(function (i) { return i.texto; }).join(' '), icono: 'checklist', accion: function () { call('openChecklist', c.id); } });
        });
        (d.missions || []).forEach(function (m) {
          if (!m || !m.id) return;
          PRAC.push({ titulo: 'Misión: ' + m.titulo, detalle: m.objetivo, extra: '', icono: 'flag', accion: function () { call('openMission', m.id); } });
        });
        (d.situations || []).forEach(function (s) {
          if (!s || !s.id) return;
          PRAC.push({ titulo: 'Situación: ' + s.titulo, detalle: s.contexto, extra: (s.tipo || ''), icono: 'warning', accion: function () { call('openSituation', s.id); } });
        });
        PRAC.push({ titulo: 'Quiz rápido', detalle: 'Preguntas para probar lo que sabés', extra: 'quiz preguntas examen test evaluar', icono: 'quiz', accion: function () { call('startQuiz'); } });
        PRAC.push({ titulo: 'Quiz: ¿dónde está cada mando?', detalle: 'Tocá el control en la cabina 3D', extra: 'quiz donde esta ubicacion', icono: 'quiz', accion: function () { call('startQuiz'); } });
      }
      return rank(q, PRAC, function (x) { return [[x.titulo, 1], [x.extra || '', 0.35], [x.detalle || '', 0.22]]; }).map(function (r) {
        return { titulo: r.x.titulo, detalle: trunc(r.x.detalle, 110), icono: r.x.icono, score: r.score, accion: r.x.accion };
      });
    }
  });

  var AIRE = null;
  register({
    id: 'aire', label: 'Aire: experimentos', icon: 'wind', order: 5, max: 4,
    items: function (q) {
      var d = D();
      if (!AIRE) AIRE = (d.labExperiments || []).filter(function (e) { return e && e.id; });
      return rank(q, AIRE, function (e) { return [[e.titulo, 1], [e.resumen || '', 0.3]]; }).map(function (r) {
        var e = r.x;
        return { titulo: 'Experimento: ' + e.titulo, detalle: trunc(e.resumen, 110), icono: 'wind', score: r.score, accion: function () { call('openLab', e.id); } };
      });
    }
  });

  /* ================================================================== paleta (DOM) */

  if (typeof document === 'undefined') return;
  var doc = document;
  var cur = null;                 // paleta abierta
  var SUGGEST = ['acelerador', 'flaps', 'QNH', 'pérdida', 'checklist de arranque', 'cómo vuela'];

  function reduced() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function K() { return C150.Kit; }

  /** Título con las palabras buscadas resaltadas (con <mark>); nunca innerHTML. */
  function highlighted(text, toks, h) {
    var f = fold(text);
    if (!toks.length || f.length !== text.length) return [document.createTextNode(text)];
    var mark = [];
    toks.forEach(function (t) {
      var i = f.indexOf(t);
      if (i >= 0 && t.length > 1) mark.push([i, i + t.length]);
    });
    if (!mark.length) return [document.createTextNode(text)];
    mark.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [mark[0]];
    for (var m = 1; m < mark.length; m++) {
      var last = merged[merged.length - 1];
      if (mark[m][0] <= last[1]) last[1] = Math.max(last[1], mark[m][1]); else merged.push(mark[m]);
    }
    var out = [], pos = 0;
    merged.forEach(function (r) {
      if (r[0] > pos) out.push(document.createTextNode(text.slice(pos, r[0])));
      out.push(h('mark', { text: text.slice(r[0], r[1]) }));
      pos = r[1];
    });
    if (pos < text.length) out.push(document.createTextNode(text.slice(pos)));
    return out;
  }

  function open(opts) {
    opts = opts || {};
    var Kit = K();
    if (cur) { cur.input.focus(); if (opts.query !== undefined) { cur.input.value = opts.query; cur.render(); } return; }
    if (!Kit || typeof Kit.el !== 'function') return;
    var h = Kit.el;
    if (Kit.closePopover) Kit.closePopover();
    var prev = doc.activeElement;
    var input = h('input', {
      type: 'search', 'class': 'pal-input', id: 'pal-input', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-autocomplete': 'list',
      'aria-label': 'Buscar en la aplicación', placeholder: 'Buscá un mando o una palabra', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go', autocapitalize: 'off'
    });
    var list = h('div', { 'class': 'pal-list', id: 'pal-list', role: 'listbox', 'aria-label': 'Resultados' });
    var live = h('p', { 'class': 'sr-only', 'aria-live': 'polite' });
    var closeBtn = h('button', { type: 'button', 'class': 'pal-close', 'aria-label': 'Cerrar el buscador', onclick: function () { close(); } }, Kit.icon('close'), h('span', { text: 'Cerrar' }));
    var foot = h('div', { 'class': 'pal-foot', 'aria-hidden': 'true' },
      h('span', null, Kit.kbd('↑'), Kit.kbd('↓'), ' moverte'), h('span', null, Kit.kbd('↵'), ' abrir'), h('span', null, Kit.kbd('Esc'), ' cerrar'));
    var card = h('div', { 'class': 'pal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Buscador' },
      h('div', { 'class': 'pal-field' }, Kit.icon('search'), input, closeBtn), list, foot, live);
    var el = h('div', { 'class': 'pal' }, h('div', { 'class': 'pal-backdrop', onclick: function () { close(); } }), card);

    var st = { flat: [], active: -1 };

    function setActive(i, scroll) {
      var opts2 = list.querySelectorAll('.pal-item');
      if (!opts2.length) { st.active = -1; input.removeAttribute('aria-activedescendant'); return; }
      if (i < 0) i = opts2.length - 1;
      if (i >= opts2.length) i = 0;
      st.active = i;
      for (var k = 0; k < opts2.length; k++) {
        var on = k === i;
        opts2[k].classList.toggle('is-active', on);
        opts2[k].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      input.setAttribute('aria-activedescendant', opts2[i].id);
      if (scroll && opts2[i].scrollIntoView) { try { opts2[i].scrollIntoView({ block: 'nearest' }); } catch (e) { /* sin scroll */ } }
    }
    function run(item) {
      close();
      setTimeout(function () {
        try { item.accion(); } catch (e) { if (root.console) console.error('[Search] acción', e); }
      }, 30);
    }
    function chips() {
      var row = h('div', { 'class': 'pal-chips', role: 'group', 'aria-label': 'Ideas para buscar' });
      SUGGEST.forEach(function (s) {
        row.appendChild(h('button', { type: 'button', 'class': 'chip', onclick: function () { input.value = s; input.focus(); render(); } }, h('span', { text: s })));
      });
      return row;
    }
    function render() {
      var q = input.value, toks = tokens(q), groups = query(q);
      while (list.firstChild) list.removeChild(list.firstChild);
      st.flat = [];
      var n = 0;
      if (!toks.length) list.appendChild(h('p', { 'class': 'pal-hint', text: 'Probá con una palabra, por ejemplo:' }));
      if (!toks.length) list.appendChild(chips());
      groups.forEach(function (g) {
        var gid = 'pal-g-' + g.id;
        list.appendChild(h('div', { 'class': 'pal-gh', id: gid, role: 'presentation' }, Kit.icon(g.icon), h('span', { text: toks.length ? g.label : 'Atajos' })));
        g.items.forEach(function (it) {
          var idx = st.flat.length;
          st.flat.push(it);
          var ico = h('span', { 'class': 'pal-ico', 'aria-hidden': 'true' }, Kit.icon(it.icono));
          if (it.color) ico.style.setProperty('--pal-c', it.color);
          var row = h('div', {
            'class': 'pal-item' + (it.color ? ' has-color' : ''), id: 'pal-o-' + (n++), role: 'option', 'aria-selected': 'false', 'aria-describedby': null,
            onclick: function () { run(it); },
            onmousemove: function () { if (st.active !== idx) setActive(idx, false); }
          }, ico,
            h('span', { 'class': 'pal-txt' }, h('span', { 'class': 'pal-t' }, highlighted(it.titulo, toks, h)), it.detalle ? h('span', { 'class': 'pal-d', text: it.detalle }) : null),
            h('span', { 'class': 'pal-go', 'aria-hidden': 'true' }, Kit.icon('arrow-right')));
          list.appendChild(row);
        });
      });
      if (toks.length && !groups.length) {
        list.appendChild(Kit.emptyState({ icon: 'search', title: 'No encontré “' + q.trim() + '”', text: 'Probá con otra palabra o con menos letras. Podés buscar mandos (“nafta”, “luces”), términos (“QNH”, “pérdida”) o lecciones.' }));
        list.appendChild(chips());
      }
      live.textContent = toks.length ? (st.flat.length ? st.flat.length + (st.flat.length === 1 ? ' resultado' : ' resultados') : 'Sin resultados') : '';
      setActive(st.flat.length ? 0 : -1, false);
      list.scrollTop = 0;
    }
    input.addEventListener('input', render);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        var f = [input, closeBtn].filter(function (n) { return n.offsetParent !== null; });
        if (f.length < 2) { e.preventDefault(); return; }
        var i = f.indexOf(doc.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        return;
      }
      var tgt = e.target;
      if (!card.contains(tgt)) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActive(st.active + 1, true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive(st.active - 1, true); }
      else if (e.key === 'PageDown') { e.preventDefault(); setActive(Math.min(st.flat.length - 1, st.active + 5), true); }
      else if (e.key === 'PageUp') { e.preventDefault(); setActive(Math.max(0, st.active - 5), true); }
      else if (e.key === 'Enter' && tgt === input) { e.preventDefault(); e.stopPropagation(); if (st.flat[st.active]) run(st.flat[st.active]); }
      else if (e.key !== 'Tab' && tgt === input) e.stopPropagation();
    }
    doc.addEventListener('keydown', onKey, true);
    function close() {
      if (cur !== api) return;
      cur = null;
      doc.removeEventListener('keydown', onKey, true);
      el.classList.remove('is-on');
      var gone = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      if (reduced()) gone(); else setTimeout(gone, 170);
      if (prev && prev.focus && doc.contains(prev)) { try { prev.focus({ preventScroll: true }); } catch (e2) { /* sin foco */ } }
    }
    var api = { el: el, input: input, render: render, close: close };
    cur = api;
    doc.body.appendChild(el);
    if (opts.query) input.value = opts.query;
    render();
    void el.offsetWidth;
    el.classList.add('is-on');
    try { input.focus({ preventScroll: true }); if (input.value) input.select(); } catch (e3) { /* sin foco */ }
  }
  function close() { if (cur) cur.close(); }

  Search.open = open;
  Search.close = close;
  Search.isOpen = function () { return !!cur; };
})(root.C150);
