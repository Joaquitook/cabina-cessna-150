var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/leccion.js — C150.ESCUELA.leccion: el ejecutor de lecciones (contrato v7 §3/§4/§5, lectura editorial v8 §3):
 *   portada → pasos (un punto clave + su componente) → práctica → mini-quiz → resumen. Cada etapa es una pantalla: barra pegajosa (módulo › unidad › lección,
 *   minutos que faltan, Salir, línea de avance), índice "En esta lección" (riel pegajoso a la izquierda desde 980 px de columna; en columnas angostas, botón
 *   "Índice" con un panel), cuerpo en columna de lectura, pie con tarjetas Anterior / Siguiente y "Ya viste N de M". El texto y los tipos de punto clave
 *   (definicion, regla, dato, idea, ojo, ejemplo, lista, texto; **término**, ==clave==, {{valor|unidad}}) viven en texto.js (puro) y bloques.js (DOM).
 *
 * Parte pura (Node, tests/validate-escuela.js):
 *   Leccion.armar(lec)                   → etapas [{k:'intro', titulo} · {k:'paso', n, texto|null, item|null, tipo, titulo, reglaN, comps:[{c, i}]} · {k:'practica', comps} · {k:'quiz', preguntas} · {k:'resumen'}]
 *                                          `contenido` acepta textos (formato viejo) u objetos {titulo, texto, tipo, dato, ejemplo, ojo, resumen}; el título del paso es
 *                                          el del punto, si no el del componente, si no «Punto clave N». Los componentes que califican (Motor.esPractica) van a la práctica;
 *                                          el resto acompaña a los puntos clave en orden; si hay más puntos que componentes, los pasos sin componente son sólo texto;
 *                                          si sobran componentes, cada uno es un paso.
 *   Leccion.indice(pasos) → [{idx, k, clave, num, titulo}] (índice de la lección)     Leccion.llevas(pasos, lec) → [{n, titulo, texto, tipo}] ("Lo que te llevás")
 *   Leccion.elegirPreguntas(lec)         → hasta 5 preguntas {pregunta, opciones (mezcladas con semilla estable), correcta, explicacion, pagina, qid}
 *   Leccion.mezclar(opciones, correcta, semilla) → {opciones, correcta}     Leccion.rng(semilla) → () => [0,1)
 *   Leccion.claveDe(pasos, idx) · Leccion.idxDe(pasos, clave)   clave de ruta: '' (intro) · '3' (punto clave 3) · 'practica' · 'quiz' · 'resumen'
 * Parte de pantalla:
 *   Leccion.crear(deps, entrada, datos, idx) → controlador R:
 *     R.el (el <div class="es-lesson">) · R.idx · R.pasos · R.mostrar(idx, {foco}) (sin tocar el historial) · R.ir(idx) (usa deps.navPaso: Nav.replace)
 *     R.clave() · R.capturar() → {idx} · R.activa() (hay una lección empezada y sin terminar) · R.destruir() · R.pausar() · R.reanudar() · R.slow(s)
 *   Teclado: ← / → cambian de etapa (no en campos ni dentro de un componente, ni con un diálogo a la vista, ni con el visor abierto: ahí las flechas son del vuelo);
 *   Esc cierra el panel del índice. Al cambiar de etapa el foco va al título (h2, tabindex -1); el índice marca aria-current="step".
 *   deps = { api, store, progress, modulo (entrada del índice), navPaso(clave, fn), volver(), irLeccion(id), siguiente(id), anterior(id), visorAbierto(), enlace(l), mirar(fn, label),
 *            visor(target, o), abrir(ruta, o), glosario(termino, def), annotate(lista), toast(texto, tono), reducedMotion(), onDark(), alMostrar(R, cambia) }
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Leccion = ES.leccion = ES.leccion || {};
  var Mot = function () { return ES.componentes; };
  var St = function () { return ES.store; };

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ================================================================== parte pura */
  /** Generador pseudoaleatorio con semilla (mulberry32 sobre un hash del texto). */
  Leccion.rng = function (semilla) {
    var s = parseInt(St().hashTexto(semilla), 16) >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  function barajar(lista, rnd) {
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /** Mezcla las opciones con una semilla estable y devuelve dónde quedó la correcta. */
  Leccion.mezclar = function (opciones, correcta, semilla) {
    var idx = barajar(opciones.map(function (_, i) { return i; }), Leccion.rng(semilla));
    return { opciones: idx.map(function (i) { return opciones[i]; }), correcta: idx.indexOf(correcta) };
  };
  function preguntaValida(p) {
    return !!p && typeof p.pregunta === 'string' && p.pregunta.trim() && Array.isArray(p.opciones) && p.opciones.length >= 2 &&
      p.opciones.every(function (o) { return typeof o === 'string' && o.trim(); }) && typeof p.correcta === 'number' && p.correcta >= 0 && p.correcta < p.opciones.length;
  }
  Leccion.elegirPreguntas = function (lec) {
    var validas = arr(lec && lec.preguntas).filter(preguntaValida);
    var elegidas = validas;
    if (validas.length > 5) {
      var keep = barajar(validas.map(function (_, i) { return i; }), Leccion.rng(String(lec.id) + '|elegir')).slice(0, 5).sort(function (a, b) { return a - b; });
      elegidas = keep.map(function (i) { return validas[i]; });
    }
    return elegidas.map(function (p) {
      var m = Leccion.mezclar(p.opciones, p.correcta, String(lec.id) + '|' + p.pregunta);
      return { pregunta: p.pregunta, opciones: m.opciones, correcta: m.correcta, explicacion: p.explicacion || '', pagina: p.pagina || null, qid: String(lec.id) + ':' + St().hashTexto(p.pregunta) };
    });
  };
  /** Una pregunta de opción múltiple con la cara del mini-quiz de la lección (la comparten el mini-quiz y el componente `quiz`):
   *  puntos de avance, enunciado grande, opciones con letra, y —ya contestada— la explicación con «Ver en el curso: p. N».
   *  o = { K, hid (id del enunciado), q:{pregunta, opciones, correcta, explicacion?, pagina?}, i, n, resp (índice elegido | null), estados:[null|'ok'|'bad' por pregunta], onPick(k), titulo? }
   *  → { h2, dots, opts, fb (null si no contestó) }. Sin estado propio: quien llama guarda las respuestas y vuelve a dibujar. */
  Leccion.vistaPregunta = function (o) {
    var K = o.K, h = K.el, icon = K.icon, q = o.q, i = o.i, n = o.n, resp = o.resp, contesto = resp !== undefined && resp !== null;
    var h2 = h('h2', { 'class': 'es-quest', id: o.hid, tabindex: '-1', text: q.pregunta });
    var dots = h('ol', { 'class': 'es-qdots' + (n > 8 ? ' es-qdots--many' : ''), 'aria-label': 'Pregunta ' + (i + 1) + ' de ' + n });
    for (var d = 0; d < n; d++) {
      var e = arr(o.estados)[d];
      dots.appendChild(h('li', { 'class': (d === i ? 'is-cur ' : '') + (e === 'ok' ? 'is-ok' : e === 'bad' ? 'is-bad' : ''), 'aria-current': d === i ? 'step' : null }));
    }
    var opts = h('div', { 'class': 'opts es-opts', role: 'group', 'aria-labelledby': o.hid });
    q.opciones.forEach(function (op, k) {
      var c = 'opt';
      if (contesto && k === q.correcta) c += ' is-correct'; else if (contesto && k === resp) c += ' is-wrong';
      opts.appendChild(h('button', { type: 'button', 'class': c, disabled: contesto ? true : null, onclick: function () { if (isFn(o.onPick)) o.onPick(k); } },
        h('span', { 'class': 'opt-letter', 'aria-hidden': 'true', text: 'ABCDEFGH'.charAt(k) }), h('span', { 'class': 'opt-t', text: op }),
        contesto && k === q.correcta ? h('span', { 'class': 'opt-flag', 'aria-hidden': 'true' }, icon('check')) : null,
        contesto && k === q.correcta ? h('span', { 'class': 'sr-only', text: ' (correcta)' }) : null,
        contesto && k === resp && k !== q.correcta ? h('span', { 'class': 'sr-only', text: ' (tu respuesta)' }) : null));
    });
    var fb = null;
    if (contesto) {
      var bien = resp === q.correcta;
      fb = h('div', { 'class': 'feedback qz-fb ' + (bien ? 'feedback--ok' : 'feedback--bad'), role: 'status' },
        h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(bien ? 'check' : 'bulb')),
        h('div', { 'class': 'qz-fb-b' }, h('strong', { text: bien ? '¡Bien!' : 'No es esa, pero así se aprende.' }),
          !bien ? h('span', { 'class': 'qz-fb-a' }, 'La correcta: ', h('b', { text: q.opciones[q.correcta] })) : null,
          q.explicacion ? h('span', { 'class': 'qz-fb-e', text: q.explicacion }) : null,
          q.pagina ? h('span', { 'class': 'es-pg', text: 'Ver en el curso: p. ' + q.pagina }) : null));
    }
    return { h2: h2, dots: dots, opts: opts, fb: fb };
  };
  Leccion.armar = function (lec) {
    lec = lec || {};
    var Tx = ES.texto, expl = [], prac = [];
    arr(lec.componentes).forEach(function (c, i) { if (c && typeof c === 'object') (Mot().esPractica(c.tipo) ? prac : expl).push({ c: c, i: i }); });
    var cont = arr(lec.contenido).map(Tx.item).filter(Boolean);      // texto (formato viejo) u objeto {titulo, texto, tipo, dato, ejemplo, ojo}
    var pasos = [{ k: 'intro', titulo: PASO_TITULO.intro }], n = 0, rn = 0, i;
    for (i = 0; i < cont.length; i++) {
      n++;
      pasos.push({ k: 'paso', n: n, texto: cont[i].texto, item: cont[i], tipo: cont[i].tipo, titulo: Tx.tituloPaso(cont[i], expl[i] && expl[i].c, n),
        reglaN: cont[i].tipo === 'regla' ? ++rn : 0, comps: expl[i] ? [expl[i]] : [] });
    }
    for (i = cont.length; i < expl.length; i++) {
      n++;
      pasos.push({ k: 'paso', n: n, texto: null, item: null, tipo: 'texto', titulo: expl[i].c.titulo || Mot().nombre(expl[i].c.tipo), reglaN: 0, comps: [expl[i]] });
    }
    if (prac.length) pasos.push({ k: 'practica', titulo: PASO_TITULO.practica, comps: prac });
    var qs = Leccion.elegirPreguntas(lec);
    if (qs.length) pasos.push({ k: 'quiz', titulo: PASO_TITULO.quiz, preguntas: qs });
    pasos.push({ k: 'resumen', titulo: PASO_TITULO.resumen });
    return pasos;
  };
  /** El índice de la lección (riel de la izquierda y botón "Índice"): [{idx, k, clave, num, titulo}]. */
  Leccion.indice = function (pasos) {
    return pasos.map(function (p, i) { return { idx: i, k: p.k, clave: Leccion.claveDe(pasos, i), num: p.k === 'paso' ? ES.texto.p2(p.n) : '', titulo: p.titulo || PASO_TITULO[p.k] || '' }; });
  };
  /** "Lo que te llevás": una tarjeta por punto clave con su línea de resumen o, si no hay, su primera oración. */
  Leccion.llevas = function (pasos, lec) {
    var Tx = ES.texto, out = [];
    pasos.forEach(function (p) {
      if (p.k !== 'paso' || !p.item) return;
      var t = Tx.resumenPaso(lec, p.item, p.n - 1);
      if (!t && p.item.tipo === 'lista') { var li = Tx.listaLineas(p.item.texto); t = li.items.length ? (li.intro ? li.intro.replace(/\s*:\s*$/, ': ') : '') + li.items[0] : ''; }   // una lista sin resumen propio: su introducción (sin los dos puntos colgando) y el primer paso
      if (!t) { t = Tx.partir(p.item.texto).lead; if (!t && p.item.dato) t = [p.item.dato.valor + (p.item.dato.unidad ? ' ' + p.item.dato.unidad : ''), p.item.dato.etiqueta].filter(Boolean).join(': '); }
      t = Tx.recorte(Tx.plano(t), 170);
      if (t) out.push({ n: p.n, titulo: p.titulo, texto: t, tipo: p.item.tipo });
    });
    return out;
  };
  Leccion.claveDe = function (pasos, idx) {
    var p = pasos[idx];
    if (!p || p.k === 'intro') return '';
    return p.k === 'paso' ? String(p.n) : p.k;
  };
  Leccion.idxDe = function (pasos, clave) {
    clave = String(clave === undefined || clave === null ? '' : clave).toLowerCase();
    if (clave === '') return 0;
    for (var i = 0; i < pasos.length; i++) if (Leccion.claveDe(pasos, i) === clave) return i;
    return -1;
  };

  /* ================================================================== pantalla */
  var ICONO_ENLACE = { control: 'cabin', aire: 'wind', experimento: 'wind', leccion: 'book', situacion: 'flag', pose: 'plane', escuela: 'cap' };
  var VERBO_ENLACE = { control: 'Ficha en la cabina', aire: 'Laboratorio del aire', experimento: 'Experimento en el aire', leccion: 'Lección de la app', situacion: 'Situación para practicar', pose: 'Mirar en el avión', escuela: 'Otra lección de la Escuela' };

  function nombreEnlace(l) {
    var D = C150.DATA || {}, id = l && l.id, lista = null, x = null;
    if (l.tipo === 'control') lista = D.controls; else if (l.tipo === 'aire' || l.tipo === 'experimento') lista = D.labExperiments;
    else if (l.tipo === 'leccion') lista = D.lessons; else if (l.tipo === 'situacion') lista = D.situations;
    if (lista) for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].id === id) { x = lista[i]; break; }
    if (l.tipo === 'escuela' && C150.ESCUELA.datos) { var e = C150.ESCUELA.datos.leccion(id); if (e) return e.lec.titulo; }
    return x ? (x.nombre || x.titulo) : String(id);
  }
  Leccion.nombreEnlace = nombreEnlace;

  var PASO_TITULO = { intro: 'Antes de empezar', practica: 'Practicá', quiz: 'Mini-quiz', resumen: 'Resumen' };
  function pasoEtiqueta(p) { return p.k === 'paso' ? 'Punto clave ' + p.n : PASO_TITULO[p.k]; }
  function plegar(s) { s = String(s || '').toLowerCase(); try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ } return s.trim(); }

  Leccion.crear = function (deps, entrada, datos, idx0) {
    var K = C150.Kit, h = K.el, icon = K.icon, store = deps.store, prog = deps.progress, Tx = ES.texto, B = ES.bloques;
    var lecId = entrada.id, lec = datos || {};
    var pasos = Leccion.armar(lec);
    var hue = entrada.mod && entrada.mod.color;
    var rec0 = store.lec(lecId) || {};
    var nPasos = pasos.filter(function (p) { return p.k === 'paso'; }).length;
    var railId = 'es-rail-' + lecId, p2 = Tx.p2;
    var R = {
      el: null, idx: 0, pasos: pasos, lecId: lecId, hechos: {}, scores: {}, handles: [], visto: {}, q: null, res: null, pausada: false, ui: {}
    };
    var ui = R.ui;
    arr(rec0.h).forEach(function (k) { R.hechos[k] = true; });
    if (rec0.q && arr(rec0.q.resp).length) R.q = { i: rec0.q.i, ok: rec0.q.ok, resp: rec0.q.resp.slice(), fin: false };
    var iQuiz = -1, iResumen = pasos.length - 1, iPractica = -1;
    pasos.forEach(function (p, i) { if (p.k === 'quiz') iQuiz = i; if (p.k === 'practica') iPractica = i; });
    var rec = function () { return store.lec(lecId) || {}; };
    var bdeps = {
      glosario: function (t, d) { deps.glosario(t, d); },
      termino: function (t) { var g = arr(lec.glosario), k = plegar(t); for (var i = 0; i < g.length; i++) if (g[i] && plegar(g[i].termino) === k) return g[i].definicion || null; return null; }
    };

    /* ---- ciclo de vida */
    var ro = null, teclas = false, fuera = false, visorEv = false;
    function destruirHandles() { R.handles.forEach(function (hd) { try { if (hd && isFn(hd.destroy)) hd.destroy(); } catch (e) { if (root.console) console.error('[Escuela] destroy', e); } }); R.handles = []; }
    R.destruir = function () {
      destruirHandles();
      if (teclas) { root.removeEventListener('keydown', onKey, true); teclas = false; }
      if (fuera) { document.removeEventListener('click', alFuera, true); fuera = false; }
      if (visorEv) { document.removeEventListener('c150-visor-abierto', alVisor); visorEv = false; }
      if (ro) { try { ro.disconnect(); } catch (e) { /* idem */ } ro = null; }
    };
    R.pausar = function () { R.pausada = true; R.handles.forEach(function (hd) { try { if (hd && isFn(hd.pause)) hd.pause(); } catch (e) { /* un componente no rompe a los demás */ } }); };
    R.reanudar = function () { R.pausada = false; R.handles.forEach(function (hd) { try { if (hd && isFn(hd.resume)) hd.resume(); } catch (e) { /* idem */ } }); };
    R.slow = function (s) { R.handles.forEach(function (hd) { try { if (hd && isFn(hd.slow)) hd.slow(s); } catch (e) { /* idem */ } }); };
    R.clave = function () { return Leccion.claveDe(pasos, R.idx); };
    R.capturar = function () { return { idx: R.idx }; };
    R.activa = function () { return R.idx > 0 && rec().estado !== 'hecha'; };
    R.pasoActual = function () { return pasos[R.idx]; };
    R.etiqueta = function () { return pasoEtiqueta(pasos[R.idx]); };
    R.titulo = function () { return lec.titulo || entrada.lec.titulo; };

    /* ---- ctx de cada componente */
    function crearCtx(comp, p, key) {
      var ctx = {
        leccion: { id: lecId, titulo: R.titulo(), modulo: entrada.mod.id, paginas: entrada.lec.paginas || '', minutos: entrada.lec.minutos || 0 },
        paso: { n: p.k === 'paso' ? p.n : 0, clave: Leccion.claveDe(pasos, pasos.indexOf(p)), titulo: pasoEtiqueta(p) },
        key: key, api: deps.api, h: h, icon: icon, Kit: K, store: store, hecho: !!R.hechos[key],
        done: function () {
          if (R.hechos[key]) { ctx.hecho = true; return; }
          R.hechos[key] = true; ctx.hecho = true;
          store.hecho(lecId, key);
          if (prog && isFn(prog.touch)) prog.touch('escuela', lecId, { ruta: lecId + (R.clave() ? '/' + R.clave() : '') });
          estadoPractica();
        },
        score: function (c, t, o) {
          o = o || {}; c = num(c, 0); t = num(t, 0);
          var prev = R.scores[key];
          if (!prev || !o.retry || c / Math.max(t, 1) > prev.c / Math.max(prev.t, 1)) R.scores[key] = { c: c, t: t };
          arr(o.fallos).forEach(function (ref) { store.mazoAgregar({ id: lecId + ':' + comp.tipo + ':' + (o.id ? o.id + ':' : '') + ref, tipo: comp.tipo, ref: String(ref) }); });
          estadoPractica();
        },
        glosario: function (termino, def) { deps.glosario(termino, def); },
        mirar: function (fn, o) { deps.mirar(fn, o && o.label); },
        visor: function (target, o) { return !!(isFn(deps.visor) && deps.visor(target, o)); },
        abrir: function (ruta, o) { deps.abrir(ruta, o); },
        enlace: function (l) { deps.enlace(l); },
        reducedMotion: !!deps.reducedMotion(), onDark: !!deps.onDark(), ahora: function () { return Date.now(); }
      };
      return ctx;
    }
    var chipEstado = null;
    function estadoPractica() {
      if (!chipEstado) return;
      var prac = pasos[iPractica], total = prac ? prac.comps.length : 0, hechas = 0, c = 0, t = 0, k;
      for (k = 0; k < total; k++) if (R.hechos['pr.' + k]) hechas++;
      for (k in R.scores) { c += R.scores[k].c; t += R.scores[k].t; }
      chipEstado.textContent = hechas + ' de ' + total + ' hechas' + (t ? ' · ' + c + ' de ' + t + ' aciertos' : '');
    }
    function dibujarComps(host, p, prefijo) {
      p.comps.forEach(function (e, k) {
        var key = prefijo === 'pr' ? 'pr.' + k : 'p' + p.n + '.' + k;
        var box = h('div', { 'class': 'es-comp-wrap' });
        if (prefijo === 'pr' && p.comps.length > 1) host.appendChild(h('p', { 'class': 'es-sec-n', 'aria-hidden': 'true', text: p2(k + 1) + ' —' }));
        host.appendChild(box);
        var hd = Mot().render(box, e.c, crearCtx(e.c, p, key));
        R.handles.push(hd);
        if (R.pausada && hd && isFn(hd.pause)) { try { hd.pause(); } catch (er) { /* idem */ } }
      });
    }

    /* ---- la barra de arriba, el índice y el cuerpo (se arman una vez; cada etapa sólo cambia el cuerpo) */
    function idDe(x) { return 'es-' + x + '-' + lecId; }
    ui.idxBtn = h('button', { type: 'button', 'class': 'es-lbar-idx', 'aria-expanded': 'false', 'aria-controls': railId, onclick: function () { toggleIndice(); } }, icon('list'), h('span', { text: 'Índice' }));
    ui.min = h('span', { 'class': 'es-lbar-min' });
    ui.prog = h('span');
    ui.progWrap = h('div', { 'class': 'es-lbar-prog', role: 'progressbar', 'aria-label': 'Avance de la lección', 'aria-valuemin': '0', 'aria-valuemax': '100' }, ui.prog);
    var unidadT = entrada.unidad && entrada.unidad.titulo ? entrada.unidad.titulo : '';
    ui.bar = h('header', { 'class': 'es-lbar' },
      h('div', { 'class': 'es-lbar-in' }, ui.idxBtn,
        h('div', { 'class': 'es-lbar-trail' },
          h('span', { 'class': 'es-lbar-mod', title: entrada.mod.titulo || entrada.mod.id }, h('i', { 'class': 'es-lbar-dot', 'aria-hidden': 'true' }), h('b', { text: entrada.mod.id })),
          unidadT ? h('span', { 'class': 'es-lbar-sep es-lbar-sep--u', 'aria-hidden': 'true', text: '›' }) : null,
          unidadT ? h('span', { 'class': 'es-lbar-unit', text: unidadT }) : null,
          h('span', { 'class': 'es-lbar-sep', 'aria-hidden': 'true', text: '›' }),
          h('span', { 'class': 'es-lbar-les', text: R.titulo(), title: R.titulo() })),
        ui.min,
        h('button', { type: 'button', 'class': 'es-lbar-exit', 'aria-label': 'Salir de la lección y volver al módulo', onclick: function () { deps.volver(); } }, icon('close'), h('span', { text: 'Salir' }))),
      ui.progWrap);
    ui.ringBox = h('span', { 'class': 'es-rail-ring' });
    ui.railSub = h('p', { 'class': 'es-rail-sub' });
    ui.list = h('ol', { 'class': 'es-rail-list' });
    ui.rail = h('nav', { 'class': 'es-rail', id: railId, 'aria-label': 'Índice de la lección' }, h('div', { 'class': 'es-rail-in' },
      h('div', { 'class': 'es-rail-head' }, ui.ringBox, h('div', { 'class': 'es-rail-hb' }, h('p', { 'class': 'es-rail-k', text: 'EN ESTA LECCIÓN' }), ui.railSub)), ui.list));
    ui.main = h('div', { 'class': 'es-l-main' });
    R.el = h('div', { 'class': 'es-lesson', style: hue ? { '--es-hue': hue } : null }, ui.bar, h('div', { 'class': 'es-l-grid' }, ui.rail, ui.main));

    function minFalta() { var m = entrada.lec.minutos || 0; return m ? Tx.minutosFalta(m, R.idx, pasos.length) : 0; }
    function pintarBarra() {
      var i = R.idx, n = pasos.length, pct = Math.round((i + 1) / n * 100), m = minFalta();
      ui.min.textContent = !(entrada.lec.minutos || 0) ? '' : (i >= n - 1 ? 'Última etapa' : '~' + m + ' min');
      ui.prog.style.width = pct + '%';
      ui.progWrap.setAttribute('aria-valuenow', String(pct));
      ui.progWrap.setAttribute('aria-valuetext', 'Etapa ' + (i + 1) + ' de ' + n);
    }
    function pintarRail() {
      var i = R.idx, n = pasos.length, frac = n > 1 ? i / (n - 1) : 0, m = minFalta();
      while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);
      Leccion.indice(pasos).forEach(function (e) {
        var visto = !!R.visto[e.idx] || e.idx < i, cur = e.idx === i;
        ui.list.appendChild(h('li', { 'class': 'es-rail-li es-rail-li--' + e.k },
          h('button', { type: 'button', 'class': 'es-rail-it' + (cur ? ' is-cur' : '') + (visto && !cur ? ' is-seen' : ''), 'aria-current': cur ? 'step' : null, onclick: function () { cerrarIndice(); R.ir(e.idx); } },
            h('span', { 'class': 'es-rail-dot', 'aria-hidden': 'true' }, visto && !cur ? icon('check') : null),
            h('span', { 'class': 'es-rail-tx' }, e.num ? h('span', { 'class': 'es-rail-n', 'aria-hidden': 'true', text: e.num }) : null, h('span', { 'class': 'es-rail-t', text: e.titulo })))));
      });
      var ring = K.progressRing(frac, { size: 44, stroke: 10, ok: i >= n - 1, ariaLabel: 'Avance de la lección', text: Math.round(frac * 100) + '' });
      ring.classList.add('es-ring');
      while (ui.ringBox.firstChild) ui.ringBox.removeChild(ui.ringBox.firstChild);
      ui.ringBox.appendChild(ring);
      ui.railSub.textContent = 'Etapa ' + (i + 1) + ' de ' + n + (entrada.lec.minutos && i < n - 1 ? ' · ~' + m + ' min' : '');
    }
    function abrirIndice() {
      ui.rail.classList.add('is-open'); ui.idxBtn.setAttribute('aria-expanded', 'true');
      if (!fuera) { document.addEventListener('click', alFuera, true); fuera = true; }
    }
    function cerrarIndice() {
      ui.rail.classList.remove('is-open'); ui.idxBtn.setAttribute('aria-expanded', 'false');
      if (fuera) { document.removeEventListener('click', alFuera, true); fuera = false; }
    }
    function toggleIndice() { if (ui.rail.classList.contains('is-open')) cerrarIndice(); else abrirIndice(); }
    /** El visor 3D se abrió en una pantalla angosta: el cajón del índice (si estaba abierto) se cierra para que se vea el visor. */
    function alVisor() { if (ui.rail.classList.contains('is-open')) cerrarIndice(); }
    function alFuera(ev) { if (!ui.rail.contains(ev.target) && !ui.idxBtn.contains(ev.target)) cerrarIndice(); }
    /** La barra pegajosa baja lo que mida la barra de Nav (si hay una "← Volver a …" a la vista). */
    function medirCabecera() {
      var head = document.getElementById('panel-head'), hh = 0;
      if (head && head.offsetParent !== null) hh = head.offsetHeight || 0;
      R.el.style.setProperty('--es-head-h', hh + 'px');
    }

    /** Hay un diálogo a la vista (los de ayuda y buscador viven ocultos en el DOM con aria-modal: sólo cuentan los que se ven). */
    function hayDialogo() {
      var l = document.querySelectorAll('[aria-modal="true"], dialog[open]');
      for (var i = 0; i < l.length; i++) if (l[i].getClientRects().length) return true;
      return false;
    }
    /* ---- teclado: ← / → cambian de etapa (no en campos, ni dentro de un componente, ni con el visor abierto: ahí las flechas son del vuelo) */
    function onKey(ev) {
      if (ev.defaultPrevented || !R.el.isConnected || R.pausada) return;
      if (ev.key === 'Escape') { if (ui.rail.classList.contains('is-open')) { cerrarIndice(); try { ui.idxBtn.focus(); } catch (e) { /* idem */ } ev.preventDefault(); } return; }
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
      if (isFn(deps.visorAbierto) && deps.visorAbierto()) return;
      var t = ev.target;
      if (t && t.nodeType === 1 && t.closest && t.closest('input, select, textarea, [contenteditable], [role="slider"], [role="listbox"], [role="tablist"], [role="radiogroup"], [role="menu"], .es-comp')) return;
      if (hayDialogo()) return;
      var i = R.idx, der = ev.key === 'ArrowRight', ir = der ? i + 1 : i - 1;
      if (ir < 0 || ir >= pasos.length) return;
      if (der && pasos[i].k === 'quiz') return;                // del mini-quiz se sale contestando
      ev.preventDefault();
      R.ir(ir);
    }

    /* ---- piezas comunes de cada etapa */
    function kickerEl(partes) {
      var p = h('p', { 'class': 'es-kicker' });
      partes.forEach(function (t, k) { if (k) p.appendChild(h('span', { 'class': 'es-kicker-sep', 'aria-hidden': 'true', text: '·' })); p.appendChild(h('span', { 'class': k === 0 ? 'es-kicker-n' : 'es-kicker-t', text: String(t).toUpperCase() })); });
      return p;
    }
    function cabeza(kicker, h2) { return h('header', { 'class': 'es-step-head' }, kickerEl(kicker), h2); }
    function etapaCorta(p) { return p.k === 'paso' ? p.titulo : (PASO_TITULO[p.k] || ''); }
    function tarjetaNav(clase, k, titulo, ico, fn, right) {
      return h('button', { type: 'button', 'class': 'es-pn ' + clase, onclick: fn },
        right ? null : icon(ico), h('span', { 'class': 'es-pn-t' }, h('span', { 'class': 'es-pn-k', text: k }), h('span', { 'class': 'es-pn-n', text: titulo })), right ? icon(ico) : null);
    }
    /** Pie de cada etapa: anterior / siguiente en tarjetas grandes y la mini línea de tiempo "Ya viste". */
    function pie(i, o) {
      o = o || {};
      var ant = i > 0 ? pasos[i - 1] : null, sig = !o.sinSiguiente && i < pasos.length - 1 ? pasos[i + 1] : null;
      var nav = h('div', { 'class': 'es-pn-row' },
        ant ? tarjetaNav('es-pn--prev', 'ANTERIOR', etapaCorta(ant), 'back', function () { R.ir(i - 1); }, false) : h('span'),
        sig ? tarjetaNav('es-pn--next', sig.k === 'resumen' ? 'AL RESUMEN' : 'SIGUIENTE', etapaCorta(sig), 'arrow-right', function () { R.ir(i + 1); }, true) : h('span'));
      var vistos = 0, ticks = h('span', { 'class': 'es-seen-ticks', 'aria-hidden': 'true' });
      pasos.forEach(function (q, k) { var v = !!R.visto[k] || k <= i; if (v) vistos++; ticks.appendChild(h('i', { 'class': v ? 'is-seen' : '' })); });
      return h('footer', { 'class': 'es-step-foot' }, nav, h('p', { 'class': 'es-seen' }, h('span', { 'class': 'es-seen-k', text: 'YA VISTE ' + vistos + ' DE ' + pasos.length }), ticks));
    }
    function articulo(p, clase, h2, cabezaEl, inner, pieEl) {
      return { el: h('article', { 'class': 'es-step es-step--' + clase, 'data-etapa': p.k, 'aria-labelledby': h2.id }, cabezaEl, inner, pieEl), h2: h2 };
    }

    /* ---- las etapas */
    function vistaIntro(p) {
      var e = entrada.lec, nAct = arr(lec.componentes).length, rec_ = rec(), partes = lecId.split('-'), hid = idDe('h');
      var h2 = h('h2', { 'class': 'es-display', id: hid, tabindex: '-1', text: Tx.nbsp(R.titulo()) });
      var objs = arr(lec.objetivos), hecha = rec_.estado === 'hecha';
      var kicker = kickerEl([entrada.mod.titulo || entrada.mod.id, 'Unidad ' + (partes[1] || ''), 'Lección ' + (partes[2] || '')]);
      var meta = h('ul', { 'class': 'es-metastrip', 'aria-label': 'La lección en números' });
      meta.appendChild(h('li', null, h('b', { text: String(e.minutos || 0) }), h('span', { text: 'minutos' })));
      if (e.paginas) meta.appendChild(h('li', null, h('b', { text: String(e.paginas) }), h('span', { text: 'páginas del curso' })));
      if (nAct) meta.appendChild(h('li', null, h('b', { text: String(nAct) }), h('span', { text: nAct === 1 ? 'actividad' : 'actividades' })));
      var cards = null;
      if (objs.length) {
        cards = h('ol', { 'class': 'es-obj-cards', 'data-n': String(objs.length), 'aria-label': 'Al terminar vas a poder' });
        objs.forEach(function (o, k) { cards.appendChild(h('li', null, h('span', { 'class': 'es-obj-n', 'aria-hidden': 'true', text: p2(k + 1) }), h('p', { 'class': 'es-obj-t', text: o }))); });
      }
      var ant = isFn(deps.anterior) ? deps.anterior(lecId) : null;
      var antHecha = ant && (store.lec(ant.id) || {}).estado === 'hecha';
      var prereq = ant ? h('button', { type: 'button', 'class': 'es-prereq' + (antHecha ? ' is-done' : ''), onclick: function () { deps.irLeccion(ant.id); } },
        h('span', { 'class': 'es-prereq-k', text: 'ANTES' }), h('span', { 'class': 'es-prereq-t', text: ant.lec.titulo }), antHecha ? h('span', { 'class': 'sr-only', text: ' (ya la hiciste)' }) : null, icon(antHecha ? 'check' : 'chevron-right')) : null;
      var comps = arr(lec.componentes), chips = null;
      if (comps.length) {
        chips = h('ul', { 'class': 'es-chips', 'aria-label': 'Actividades de la lección' });
        comps.forEach(function (c) { chips.appendChild(h('li', null, h('span', { 'class': 'es-code', text: Mot().codigo(c.tipo) }), h('span', { text: c.titulo || Mot().nombre(c.tipo) }))); });
      }
      var seguir = (!hecha && rec_.paso > 0 && rec_.paso < pasos.length) ? h('div', { 'class': 'es-resume' },
        h('span', { text: 'La dejaste en «' + etapaCorta(pasos[Math.min(rec_.paso, pasos.length - 1)]) + '».' }),
        K.button({ label: 'Seguir ahí', size: 'small', variant: 'secondary', iconRight: 'arrow-right', onClick: function () { R.ir(Math.min(rec_.paso, pasos.length - 1)); } })) : null;
      var cta = h('div', { 'class': 'es-cta-row' },
        K.button({ label: hecha ? 'Repasar desde el principio' : 'Empezar', variant: 'primary', iconRight: 'arrow-right', onClick: function () { R.ir(1); } }), prereq);
      var body = h('div', { 'class': 'es-poster' },
        h('p', { 'class': 'es-poster-code', 'aria-hidden': 'true', text: lecId }),
        h2,
        h('p', { 'class': 'es-promesa', text: Tx.promesa(lec, e.minutos) }),
        cards, meta, chips,
        hecha ? K.callout({ variant: 'ok', title: 'Ya la hiciste', text: 'Podés repasarla cuando quieras: tu mejor resultado queda guardado.' }) : null,
        seguir, cta);
      return { el: h('article', { 'class': 'es-step es-step--portada', 'data-etapa': 'intro', 'aria-labelledby': hid }, kicker, body), h2: h2 };
    }
    function vistaPaso(p) {
      var it = p.item, comps = p.comps, lay = Tx.layoutPaso(it, comps.map(function (e) { return e.c; })), hid = idDe('h');
      var nombre = comps[0] ? Mot().nombre(comps[0].c.tipo) : '';
      var term = !!(it && it.tipo === 'definicion' && it.titulo);
      var h2 = h('h2', { 'class': 'es-h2' + (term ? ' es-h2--term' : ''), id: hid, tabindex: '-1', text: Tx.nbsp(p.titulo) });
      var texto = it ? h('div', { 'class': 'es-step-text' }, B.bloque(K, it, { deps: bdeps, reglaN: p.reglaN })) : null;
      var fig = null;
      if (comps.length) { fig = h('div', { 'class': 'es-step-fig es-comps' }); dibujarComps(fig, p, 'p'); }
      var grid = h('div', { 'class': 'es-step-grid' }, texto, fig);
      var res = Tx.resumenPaso(lec, it, p.n - 1);
      var inner = h('div', { 'class': 'es-step-body' }, grid, res ? B.resumenLinea(K, res, bdeps) : null);
      var a = articulo(p, lay, h2, cabeza(['Paso ' + p2(p.n) + ' / ' + p2(nPasos), Tx.etiquetaTipo(it, nombre)], h2), inner, pie(R.idx));
      a.el.setAttribute('data-layout', lay);
      return a;
    }
    function vistaPractica(p) {
      var hid = idDe('h'), h2 = h('h2', { 'class': 'es-h2', id: hid, tabindex: '-1', text: 'Ahora lo hacés vos' });
      chipEstado = h('p', { 'class': 'es-status', 'aria-live': 'polite' });
      var host = h('div', { 'class': 'es-comps es-prac' });
      dibujarComps(host, p, 'pr');
      estadoPractica();
      var inner = h('div', { 'class': 'es-step-body' },
        h('p', { 'class': 'es-lead-p', text: 'No hay penalización: lo que falles entra a tu repaso y lo volvés a ver más adelante.' }), chipEstado, host);
      return articulo(p, 'practica', h2, cabeza(['Práctica', p.comps.length + (p.comps.length === 1 ? ' actividad' : ' actividades')], h2), inner, pie(R.idx));
    }

    /* ---- mini-quiz */
    function nuevoQuiz() { R.q = { i: 0, ok: 0, resp: [], fin: false }; }
    function qSync() { if (R.q && !R.q.fin) store.setQuizParcial(lecId, { i: R.q.i, ok: R.q.ok, resp: R.q.resp }); }
    function responder(p, k) {
      var q = p.preguntas[R.q.i];
      if (R.q.resp[R.q.i] !== undefined && R.q.resp[R.q.i] !== null) return;
      var bien = k === q.correcta;
      R.q.resp[R.q.i] = k; if (bien) R.q.ok++;
      store.respuesta(q.qid, bien);
      if (!bien) store.mazoAgregar({ id: q.qid, tipo: 'quiz', ref: q.qid });
      qSync();
      R.mostrar(R.idx, { foco: false, quedarse: true });
      var fb = R.el.querySelector('.qz-fb');
      if (fb) { fb.setAttribute('tabindex', '-1'); try { fb.focus({ preventScroll: true }); } catch (e) { /* idem */ } if (fb.scrollIntoView) fb.scrollIntoView({ block: 'nearest' }); }
    }
    function siguientePregunta(p) {
      var n = p.preguntas.length;
      if (R.q.i + 1 < n) { R.q.i++; qSync(); R.mostrar(R.idx, { foco: true, quedarse: true }); return; }
      R.q.fin = true;
      var r = store.quiz(lecId, R.q.ok, n);
      R.res = { ok: R.q.ok, total: n, estrellas: r.estrellas, primero: r.primero };
      r.insignias.forEach(function (id) { avisoInsignia(id); });
      R.ir(iResumen);
    }
    function vistaQuiz(p) {
      var n = p.preguntas.length, hid = idDe('h');
      if (!R.q || (!R.q.fin && R.q.i >= n)) nuevoQuiz();
      if (R.q.fin) {
        var h2f = h('h2', { 'class': 'es-h2', id: hid, tabindex: '-1', text: 'Terminaste el mini-quiz' });
        var fin = h('div', { 'class': 'es-step-body es-qfin' },
          h('p', { 'class': 'es-score-n' }, h('b', { text: String(R.q.ok) }), h('span', { text: '/ ' + n })),
          h('p', { 'class': 'es-lead-p', text: R.q.ok === n ? 'Todas bien. Así se hace.' : 'Sumaste ' + R.q.ok + ' de ' + n + '. Lo que erraste queda en tu repaso.' }),
          h('div', { 'class': 'btn-row' },
            K.button({ label: 'Ver el resumen', variant: 'primary', iconRight: 'arrow-right', onClick: function () { R.ir(iResumen); } }),
            K.button({ label: 'Repetir el mini-quiz', variant: 'ghost', icon: 'reset', onClick: function () { nuevoQuiz(); R.mostrar(R.idx, { foco: true, quedarse: true }); } })));
        return articulo(p, 'quiz', h2f, cabeza(['Mini-quiz', 'Resultado'], h2f), fin, pie(R.idx, { sinSiguiente: true }));
      }
      var i = R.q.i, q = p.preguntas[i], resp = R.q.resp[i], contesto = resp !== undefined && resp !== null;
      var vp = Leccion.vistaPregunta({ K: K, hid: hid, q: q, i: i, n: n, resp: resp, onPick: function (k) { responder(p, k); },
        estados: p.preguntas.map(function (qq, d) { var r_ = R.q.resp[d]; return r_ === undefined || r_ === null ? null : (r_ === qq.correcta ? 'ok' : 'bad'); }) });
      var h2 = vp.h2, dots = vp.dots;
      var cuerpo = h('div', { 'class': 'es-step-body' }, vp.opts);
      if (contesto) {
        cuerpo.appendChild(vp.fb);
        cuerpo.appendChild(h('div', { 'class': 'btn-row es-qnext' },
          K.button({ label: i + 1 >= n ? 'Ver el resumen' : 'Siguiente pregunta', variant: 'primary', iconRight: 'arrow-right', onClick: function () { siguientePregunta(p); } })));
      }
      return articulo(p, 'quiz', h2, h('header', { 'class': 'es-step-head' }, kickerEl(['Mini-quiz', 'Pregunta ' + (i + 1) + ' de ' + n, R.q.ok + ' bien']), dots, h2), cuerpo, pie(R.idx, { sinSiguiente: true }));
    }

    /* ---- resumen */
    function estrellasEl(n) {
      var ul = h('ul', { 'class': 'es-stars es-stars--big', role: 'img', 'aria-label': n + (n === 1 ? ' estrella' : ' estrellas') + ' de 3' });
      for (var k = 1; k <= 3; k++) ul.appendChild(h('li', { 'class': 'es-star' + (k <= n ? ' is-on' : ''), 'aria-hidden': 'true', style: { '--i': String(k - 1) } }, icon('star')));
      return ul;
    }
    function avisoInsignia(id) { var b = St().INSIGNIAS[id]; if (b && isFn(deps.toast)) deps.toast('Insignia: ' + b.titulo, 'good'); }
    function vistaResumen(p) {
      var r = rec(), hecha = r.estado === 'hecha', hid = idDe('h');
      var est = hecha ? r.estrellas : (R.res ? R.res.estrellas : 0);
      var h2 = h('h2', { 'class': 'es-h2', id: hid, tabindex: '-1', text: hecha ? 'Lección lista' : 'Cerramos la lección' });
      var score;
      if (R.res) score = h('p', { 'class': 'es-score-n' }, h('b', { text: String(R.res.ok) }), h('span', { text: '/ ' + R.res.total }), h('em', { text: 'respuestas bien en el mini-quiz' }));
      else if (r.intentos) score = h('p', { 'class': 'es-score-n' }, h('b', { text: Math.round(r.mejor * 100) + '' }), h('span', { text: '%' }), h('em', { text: 'tu mejor mini-quiz' }));
      else score = h('p', { 'class': 'es-score-l', text: iQuiz < 0 ? 'Esta lección no tiene mini-quiz.' : 'Todavía no hiciste el mini-quiz.' });
      var cuerpo = h('div', { 'class': 'es-step-body es-res' });
      cuerpo.appendChild(h('div', { 'class': 'es-score' }, estrellasEl(est), score));
      var una = Tx.resumenLeccion(lec);
      if (una) cuerpo.appendChild(B.resumenLinea(K, una, bdeps));
      var llevas = Leccion.llevas(pasos, lec);
      if (llevas.length) {
        var ul = h('ul', { 'class': 'es-llevas', 'aria-label': 'Lo que te llevás' });
        llevas.forEach(function (x) { ul.appendChild(h('li', null, h('span', { 'class': 'es-llevas-n', 'aria-hidden': 'true', text: p2(x.n) }), h('h3', { 'class': 'es-llevas-t', text: x.titulo }), h('p', { 'class': 'es-llevas-p', text: x.texto }))); });
        cuerpo.appendChild(h('section', { 'class': 'es-sec' }, h('h3', { 'class': 'es-sec-t' }, h('span', { text: 'Lo que te llevás' })), ul));
      }
      if (arr(lec.glosario).length) {
        var terms = h('ul', { 'class': 'es-terms', 'aria-label': 'Palabras de la lección' });
        lec.glosario.forEach(function (g) {
          if (g && g.termino) terms.appendChild(h('li', null, h('button', { type: 'button', 'class': 'es-term', onclick: function () { deps.glosario(g.termino, g.definicion); } }, g.termino)));
        });
        cuerpo.appendChild(h('section', { 'class': 'es-sec' }, h('h3', { 'class': 'es-sec-t' }, h('span', { text: 'Palabras nuevas' }), h('small', { text: 'Tocá una para ver qué es' })), terms));
      }
      var enl = arr(lec.enlaces).filter(function (l) { return l && l.tipo && l.id; });
      if (enl.length) {
        var lk = h('ul', { 'class': 'es-links', 'aria-label': 'Seguí por acá' });
        enl.slice(0, 8).forEach(function (l) {
          lk.appendChild(h('li', null, h('button', { type: 'button', 'class': 'es-link', onclick: function () { deps.enlace(l); } },
            icon(ICONO_ENLACE[l.tipo] || 'external'), h('span', { 'class': 'es-link-t' }, h('b', { text: nombreEnlace(l) }), h('span', { text: VERBO_ENLACE[l.tipo] || 'Abrir' })), icon('chevron-right'))));
        });
        var sec = h('section', { 'class': 'es-sec' }, h('h3', { 'class': 'es-sec-t' }, h('span', { text: 'Seguí por acá' })), lk);
        if (enl.length > 8) sec.appendChild(h('p', { 'class': 'es-meta', text: 'Y ' + (enl.length - 8) + ' más en la cabina: buscalos en la pestaña Cabina.' }));
        cuerpo.appendChild(sec);
      }
      var sig = deps.siguiente(lecId), acciones = h('div', { 'class': 'btn-row es-actions' });
      if (!hecha) acciones.appendChild(K.button({ label: 'Marcar como lista', variant: 'primary', icon: 'check', onClick: marcarLista }));
      if (sig) acciones.appendChild(K.button({ label: 'Próxima lección', variant: hecha ? 'primary' : 'secondary', iconRight: 'arrow-right', onClick: function () { deps.irLeccion(sig.id); } }));
      acciones.appendChild(K.button({ label: 'Volver al módulo', variant: hecha && !sig ? 'primary' : 'secondary', icon: 'list', onClick: function () { deps.volver(); } }));
      if (iQuiz >= 0) acciones.appendChild(K.button({ label: 'Repetir el mini-quiz', variant: 'ghost', icon: 'reset', onClick: function () { nuevoQuiz(); R.ir(iQuiz); } }));
      cuerpo.appendChild(acciones);
      if (hecha && !sig) cuerpo.appendChild(h('p', { 'class': 'es-meta', text: 'Es la última lección disponible por ahora. Las que siguen llegan pronto.' }));
      return articulo(p, 'resumen', h2, cabeza(['Resumen', hecha ? 'Lección lista' : 'Falta marcarla como lista'], h2), cuerpo, pie(R.idx, { sinSiguiente: true }));
    }
    function marcarLista() {
      var r = store.marcarLista(lecId, { minutos: entrada.lec.minutos || 0 });
      if (prog && isFn(prog.mark)) prog.mark('escuela', lecId, { estrellas: r.estrellas });
      r.insignias.forEach(function (id) { avisoInsignia(id); });
      if (isFn(deps.toast)) deps.toast(r.nueva ? 'Lección lista: ' + R.titulo() : 'Ya estaba lista', 'good');
      R.mostrar(R.idx, { foco: false, quedarse: true });
    }

    /* ---- ir a una etapa */
    R.ir = function (idx) {
      idx = clamp(idx | 0, 0, pasos.length - 1);
      if (idx === R.idx && R._pintado) return;
      var clave = Leccion.claveDe(pasos, idx);
      if (isFn(deps.navPaso)) deps.navPaso(lecId, clave, function () { R.mostrar(idx, { foco: true }); });
      else R.mostrar(idx, { foco: true });
    };
    /** Dibuja la etapa `idx` (sin tocar el historial). */
    R.mostrar = function (idx, o) {
      o = o || {};
      idx = clamp(idx | 0, 0, pasos.length - 1);
      var cambia = idx !== R.idx || !R._pintado;
      destruirHandles();
      R.idx = idx; R.visto[idx] = true; R._pintado = true; chipEstado = null;
      cerrarIndice();
      var p = pasos[idx];
      if (p.k === 'quiz' && !R.q) { var r0 = rec(); if (r0.q && arr(r0.q.resp).length) R.q = { i: r0.q.i, ok: r0.q.ok, resp: r0.q.resp.slice(), fin: false }; }
      if (idx > 0 || rec().estado) {
        if (!o.quedarse || cambia) {
          store.tocar(lecId, idx);
          if (prog && isFn(prog.touch)) prog.touch('escuela', lecId, { ruta: lecId + (R.clave() ? '/' + R.clave() : '') });
        }
      }
      var v = p.k === 'intro' ? vistaIntro(p) : p.k === 'paso' ? vistaPaso(p) : p.k === 'practica' ? vistaPractica(p) : p.k === 'quiz' ? vistaQuiz(p) : vistaResumen(p);
      while (ui.main.firstChild) ui.main.removeChild(ui.main.firstChild);
      ui.main.appendChild(v.el);
      R._h2 = v.h2;
      R.el.setAttribute('data-etapa', p.k);
      pintarBarra(); pintarRail();
      if (!teclas) { root.addEventListener('keydown', onKey, true); teclas = true; }
      if (!visorEv) { document.addEventListener('c150-visor-abierto', alVisor); visorEv = true; }
      if (!ro && typeof root.ResizeObserver === 'function') { var hd_ = document.getElementById('panel-head'); if (hd_) { try { ro = new root.ResizeObserver(medirCabecera); ro.observe(hd_); } catch (e) { ro = null; } } }
      medirCabecera();
      if (isFn(deps.annotate)) deps.annotate(v.el.querySelectorAll('.es-blocks'));
      if (o.foco !== false && cambia) { try { v.h2.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }
      if (isFn(deps.alMostrar)) deps.alMostrar(R, cambia);
    };
    R.mostrar(clamp(idx0 | 0, 0, pasos.length - 1), { foco: false });
    return R;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Leccion;
})(root.C150);
