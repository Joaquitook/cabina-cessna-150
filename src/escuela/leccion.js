var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/leccion.js — C150.ESCUELA.leccion: el ejecutor de lecciones (contrato v7 §3/§4/§5):
 *   intro → pasos (un punto clave + su componente) → práctica → mini-quiz → resumen. Mismo look que el ejecutor de AIRE (.runner).
 *
 * Parte pura (Node, tests/validate-escuela.js):
 *   Leccion.armar(lec)                   → pasos [{k:'intro'} · {k:'paso', n, texto|null, titulo?, comps:[{c, i}]} · {k:'practica', comps} · {k:'quiz', preguntas} · {k:'resumen'}]
 *                                          los componentes que califican (Motor.esPractica) van a la práctica; el resto acompaña a los puntos clave en orden;
 *                                          si hay más puntos que componentes, los pasos sin componente son sólo texto; si sobran componentes, cada uno es un paso.
 *   Leccion.elegirPreguntas(lec)         → hasta 5 preguntas {pregunta, opciones (mezcladas con semilla estable), correcta, explicacion, pagina, qid}
 *   Leccion.mezclar(opciones, correcta, semilla) → {opciones, correcta}     Leccion.rng(semilla) → () => [0,1)
 *   Leccion.claveDe(pasos, idx) · Leccion.idxDe(pasos, clave)   clave de ruta: '' (intro) · '3' (punto clave 3) · 'practica' · 'quiz' · 'resumen'
 * Parte de pantalla:
 *   Leccion.crear(deps, entrada, datos, idx) → controlador R:
 *     R.el (el <div> de la lección) · R.idx · R.pasos · R.mostrar(idx, {foco}) (sin tocar el historial) · R.ir(idx) (usa deps.navPaso: Nav.replace)
 *     R.clave() · R.capturar() → {idx} · R.activa() (hay una lección empezada y sin terminar) · R.destruir() · R.pausar() · R.reanudar() · R.slow(s)
 *   deps = { api, store, progress, modulo (entrada del índice), navPaso(clave, fn), volver(), irLeccion(id), siguiente(id), enlace(l), mirar(fn, label), abrir(ruta, o),
 *            glosario(termino, def), annotate(el), toast(texto, tono), reducedMotion(), onDark(), anchoCorto() }
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
  Leccion.armar = function (lec) {
    lec = lec || {};
    var expl = [], prac = [];
    arr(lec.componentes).forEach(function (c, i) { if (c && typeof c === 'object') (Mot().esPractica(c.tipo) ? prac : expl).push({ c: c, i: i }); });
    var cont = arr(lec.contenido).filter(function (t) { return typeof t === 'string' && t.trim(); });
    var pasos = [{ k: 'intro' }], n = 0, i;
    for (i = 0; i < cont.length; i++) { n++; pasos.push({ k: 'paso', n: n, texto: cont[i], comps: expl[i] ? [expl[i]] : [] }); }
    for (i = cont.length; i < expl.length; i++) { n++; pasos.push({ k: 'paso', n: n, texto: null, titulo: expl[i].c.titulo || Mot().nombre(expl[i].c.tipo), comps: [expl[i]] }); }
    if (prac.length) pasos.push({ k: 'practica', comps: prac });
    var qs = Leccion.elegirPreguntas(lec);
    if (qs.length) pasos.push({ k: 'quiz', preguntas: qs });
    pasos.push({ k: 'resumen' });
    return pasos;
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

  Leccion.crear = function (deps, entrada, datos, idx0) {
    var K = C150.Kit, h = K.el, icon = K.icon, store = deps.store, prog = deps.progress;
    var lecId = entrada.id, lec = datos || {};
    var pasos = Leccion.armar(lec);
    var hue = entrada.mod && entrada.mod.color;
    var rec0 = store.lec(lecId) || {};
    var R = {
      el: h('div', { 'class': 'es-lesson', style: hue ? { '--es-hue': hue } : null }), idx: 0, pasos: pasos, lecId: lecId,
      hechos: {}, scores: {}, handles: [], visto: {}, q: null, res: null, pausada: false
    };
    arr(rec0.h).forEach(function (k) { R.hechos[k] = true; });
    if (rec0.q && arr(rec0.q.resp).length) R.q = { i: rec0.q.i, ok: rec0.q.ok, resp: rec0.q.resp.slice(), fin: false };
    var iQuiz = -1, iResumen = pasos.length - 1, iPractica = -1;
    pasos.forEach(function (p, i) { if (p.k === 'quiz') iQuiz = i; if (p.k === 'practica') iPractica = i; });
    var rec = function () { return store.lec(lecId) || {}; };

    function destruirHandles() { R.handles.forEach(function (hd) { try { if (hd && isFn(hd.destroy)) hd.destroy(); } catch (e) { if (root.console) console.error('[Escuela] destroy', e); } }); R.handles = []; }
    R.destruir = function () { destruirHandles(); };
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
        host.appendChild(box);
        var hd = Mot().render(box, e.c, crearCtx(e.c, p, key));
        R.handles.push(hd);
        if (R.pausada && hd && isFn(hd.pause)) { try { hd.pause(); } catch (er) { /* idem */ } }
      });
    }

    /* ---- piezas comunes */
    function marco(p) {
      var n = pasos.length, i = R.idx;
      var dots = h('div', { 'class': 'runner-dots', role: 'group', 'aria-label': 'Etapas de la lección' });
      pasos.forEach(function (q, k) {
        dots.appendChild(h('button', { type: 'button', 'class': 'runner-dot' + (R.visto[k] || k < i ? ' is-seen' : ''), 'aria-current': k === i ? 'step' : null,
          'aria-label': pasoEtiqueta(q), title: pasoEtiqueta(q), onclick: function () { R.ir(k); } }));
      });
      var titulo = h('h3', { 'class': 'runner-title es-run-title', tabindex: '-1', text: p.k === 'intro' ? R.titulo() : pasoEtiqueta(p) });
      var top = h('div', { 'class': 'runner-top' },
        h('p', { 'class': 'runner-kicker' }, h('span', { text: entrada.mod.id + ' · ' + lecId }), h('span', { 'class': 'runner-count', text: (i + 1) + ' / ' + n })),
        h('button', { type: 'button', 'class': 'icon-btn icon-btn--small runner-close', 'aria-label': 'Volver al módulo', title: 'Volver al módulo', onclick: function () { deps.volver(); } }, icon('close')));
      var prog_ = h('div', { 'class': 'runner-prog', 'aria-hidden': 'true' }, h('span', { style: { width: ((i + 1) / n * 100).toFixed(1) + '%' } }));
      return { dots: dots, titulo: titulo, top: top, prog: prog_ };
    }
    function botonNav(label, ico, fn, o) {
      o = o || {};
      return h('button', { type: 'button', 'class': 'btn' + (o.primary ? ' btn--primary' : '') + (o.ghost ? ' btn--ghost' : '') + ' btn--small es-nav-btn', disabled: o.disabled ? true : null, onclick: fn },
        o.right ? [label, icon(ico)] : [icon(ico), label]);
    }
    function navBasica(i) {
      var ult = i >= pasos.length - 1;
      return h('div', { 'class': 'runner-nav es-nav' },
        botonNav('Anterior', 'back', function () { R.ir(i - 1); }, { disabled: i === 0 }),
        ult ? h('span') : botonNav(pasos[i + 1].k === 'resumen' ? 'Ir al resumen' : (i === 0 ? 'Empezar' : 'Siguiente'), 'arrow-right', function () { R.ir(i + 1); }, { primary: true, right: true }));
    }
    function lista(clase, items) { var ul = h('ul', { 'class': clase }); items.forEach(function (t) { ul.appendChild(h('li', null, t)); }); return ul; }
    function meta(txt) { return h('p', { 'class': 'es-meta', text: txt }); }

    /* ---- las etapas */
    function vistaIntro(p) {
      var e = entrada.lec, nAct = arr(lec.componentes).length, rec_ = rec();
      var cuerpo = h('div', { 'class': 'es-body' });
      var datosMeta = [(e.minutos || 0) + ' min'];
      if (e.paginas) datosMeta.push('pp. ' + e.paginas + ' del curso');
      if (nAct) datosMeta.push(nAct + (nAct === 1 ? ' actividad' : ' actividades'));
      cuerpo.appendChild(meta(datosMeta.join(' · ').toUpperCase()));
      if (arr(lec.objetivos).length) {
        cuerpo.appendChild(h('p', { 'class': 'es-lead', text: 'Al terminar esta lección vas a poder:' }));
        cuerpo.appendChild(lista('es-obj', lec.objetivos));
      }
      var comps = arr(lec.componentes);
      if (comps.length) {
        var chips = h('ul', { 'class': 'es-chips', 'aria-label': 'Actividades de la lección' });
        comps.forEach(function (c) { chips.appendChild(h('li', null, h('span', { 'class': 'es-code', text: Mot().codigo(c.tipo) }), h('span', { text: c.titulo || Mot().nombre(c.tipo) }))); });
        cuerpo.appendChild(chips);
      }
      if (rec_.estado === 'hecha') cuerpo.appendChild(K.callout({ variant: 'ok', title: 'Ya la hiciste', text: 'Podés repasarla cuando quieras: tu mejor resultado queda guardado.' }));
      else if (rec_.paso > 0 && rec_.paso < pasos.length) cuerpo.appendChild(h('div', { 'class': 'es-resume' },
        h('span', { text: 'La dejaste en «' + pasoEtiqueta(pasos[Math.min(rec_.paso, pasos.length - 1)]) + '».' }),
        K.button({ label: 'Seguir ahí', size: 'small', variant: 'secondary', iconRight: 'arrow-right', onClick: function () { R.ir(Math.min(rec_.paso, pasos.length - 1)); } })));
      return cuerpo;
    }
    function vistaPaso(p) {
      var cuerpo = h('div', { 'class': 'es-body' });
      if (p.texto) cuerpo.appendChild(h('p', { 'class': 'runner-text es-point', text: p.texto }));
      var host = h('div', { 'class': 'es-comps' });
      cuerpo.appendChild(host);
      dibujarComps(host, p, 'p');
      return cuerpo;
    }
    function vistaPractica(p) {
      var cuerpo = h('div', { 'class': 'es-body' });
      cuerpo.appendChild(h('p', { 'class': 'runner-text', text: 'Ahora lo hacés vos. No hay penalización: lo que falles entra a tu repaso y lo volvés a ver.' }));
      chipEstado = h('p', { 'class': 'es-meta es-status', 'aria-live': 'polite' });
      cuerpo.appendChild(chipEstado);
      var host = h('div', { 'class': 'es-comps' });
      cuerpo.appendChild(host);
      dibujarComps(host, p, 'pr');
      estadoPractica();
      return cuerpo;
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
      var n = p.preguntas.length;
      if (!R.q || (!R.q.fin && R.q.i >= n)) nuevoQuiz();
      var cuerpo = h('div', { 'class': 'es-body' });
      if (R.q.fin) {
        cuerpo.appendChild(h('p', { 'class': 'runner-text', text: 'Terminaste el mini-quiz: ' + R.q.ok + ' de ' + n + '.' }));
        cuerpo.appendChild(h('div', { 'class': 'btn-row' },
          K.button({ label: 'Ver el resumen', variant: 'primary', iconRight: 'arrow-right', onClick: function () { R.ir(iResumen); } }),
          K.button({ label: 'Repetir el mini-quiz', variant: 'ghost', icon: 'reset', onClick: function () { nuevoQuiz(); R.mostrar(R.idx, { foco: true, quedarse: true }); } })));
        return cuerpo;
      }
      var i = R.q.i, q = p.preguntas[i], resp = R.q.resp[i], contesto = resp !== undefined && resp !== null;
      cuerpo.appendChild(h('p', { 'class': 'es-meta', text: ('Pregunta ' + (i + 1) + ' de ' + n + ' · ' + R.q.ok + ' bien').toUpperCase() }));
      cuerpo.appendChild(h('p', { 'class': 'es-q', id: 'es-q-' + lecId, text: q.pregunta }));
      var opts = h('div', { 'class': 'opts', role: 'group', 'aria-labelledby': 'es-q-' + lecId });
      q.opciones.forEach(function (o, k) {
        var c = 'opt';
        if (contesto && k === q.correcta) c += ' is-correct'; else if (contesto && k === resp) c += ' is-wrong';
        opts.appendChild(h('button', { type: 'button', 'class': c, disabled: contesto ? true : null, onclick: function () { responder(p, k); } },
          h('span', { 'class': 'opt-letter', 'aria-hidden': 'true', text: 'ABCDEFGH'.charAt(k) }), h('span', { 'class': 'opt-t', text: o }),
          contesto && k === q.correcta ? h('span', { 'class': 'opt-flag', 'aria-hidden': 'true' }, icon('check')) : null,
          contesto && k === q.correcta ? h('span', { 'class': 'sr-only', text: ' (correcta)' }) : null,
          contesto && k === resp && k !== q.correcta ? h('span', { 'class': 'sr-only', text: ' (tu respuesta)' }) : null));
      });
      cuerpo.appendChild(opts);
      if (contesto) {
        var bien = resp === q.correcta;
        cuerpo.appendChild(h('div', { 'class': 'feedback qz-fb ' + (bien ? 'feedback--ok' : 'feedback--bad'), role: 'status' },
          h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(bien ? 'check' : 'bulb')),
          h('div', { 'class': 'qz-fb-b' }, h('strong', { text: bien ? '¡Bien!' : 'No es esa, pero así se aprende.' }),
            !bien ? h('span', { 'class': 'qz-fb-a' }, 'La correcta: ', h('b', { text: q.opciones[q.correcta] })) : null,
            q.explicacion ? h('span', { text: q.explicacion }) : null,
            q.pagina ? h('span', { 'class': 'es-pg', text: 'Ver en el curso: p. ' + q.pagina }) : null)));
        cuerpo.appendChild(h('div', { 'class': 'btn-row' },
          K.button({ label: i + 1 >= n ? 'Ver el resumen' : 'Siguiente pregunta', variant: 'primary', iconRight: 'arrow-right', onClick: function () { siguientePregunta(p); } })));
      }
      return cuerpo;
    }

    /* ---- resumen */
    function estrellasEl(n) {
      var ul = h('ul', { 'class': 'es-stars', role: 'img', 'aria-label': n + (n === 1 ? ' estrella' : ' estrellas') + ' de 3' });
      for (var k = 1; k <= 3; k++) ul.appendChild(h('li', { 'class': 'es-star' + (k <= n ? ' is-on' : ''), 'aria-hidden': 'true' }, icon('star')));
      return ul;
    }
    function avisoInsignia(id) { var b = St().INSIGNIAS[id]; if (b && isFn(deps.toast)) deps.toast('Insignia: ' + b.titulo, 'good'); }
    function vistaResumen() {
      var r = rec(), hecha = r.estado === 'hecha', cuerpo = h('div', { 'class': 'es-body' });
      var est = hecha ? r.estrellas : (R.res ? R.res.estrellas : 0);
      var linea = R.res ? 'Mini-quiz: ' + R.res.ok + ' de ' + R.res.total : (r.intentos ? 'Mejor mini-quiz: ' + Math.round(r.mejor * 100) + ' %' : (iQuiz < 0 ? 'Esta lección no tiene mini-quiz.' : 'Todavía no hiciste el mini-quiz.'));
      cuerpo.appendChild(h('div', { 'class': 'es-sum-head' }, estrellasEl(est), h('div', null, h('p', { 'class': 'es-sum-q', text: linea }),
        h('p', { 'class': 'es-meta', text: (hecha ? 'Lección lista' : 'Falta marcarla como lista').toUpperCase() }))));
      if (arr(lec.contenido).length) {
        cuerpo.appendChild(h('p', { 'class': 'es-lead', text: 'Lo que te tenés que llevar' }));
        cuerpo.appendChild(lista('es-points', lec.contenido));
      }
      if (arr(lec.glosario).length) {
        var terms = h('ul', { 'class': 'es-terms', 'aria-label': 'Palabras de la lección' });
        lec.glosario.forEach(function (g) {
          if (g && g.termino) terms.appendChild(h('li', null, h('button', { type: 'button', 'class': 'es-term', onclick: function () { deps.glosario(g.termino, g.definicion); } }, g.termino)));
        });
        cuerpo.appendChild(h('p', { 'class': 'es-lead', text: 'Palabras nuevas (tocá una para ver qué es)' }));
        cuerpo.appendChild(terms);
      }
      var enl = arr(lec.enlaces).filter(function (l) { return l && l.tipo && l.id; });
      if (enl.length) {
        var ul = h('ul', { 'class': 'es-links', 'aria-label': 'Seguí por acá' });
        enl.slice(0, 8).forEach(function (l) {
          ul.appendChild(h('li', null, h('button', { type: 'button', 'class': 'es-link', onclick: function () { deps.enlace(l); } },
            icon(ICONO_ENLACE[l.tipo] || 'external'), h('span', { 'class': 'es-link-t' }, h('b', { text: nombreEnlace(l) }), h('span', { text: VERBO_ENLACE[l.tipo] || 'Abrir' })), icon('chevron-right'))));
        });
        cuerpo.appendChild(h('p', { 'class': 'es-lead', text: 'Seguí por acá' }));
        cuerpo.appendChild(ul);
        if (enl.length > 8) cuerpo.appendChild(meta('Y ' + (enl.length - 8) + ' más en la cabina: buscalos en la pestaña Cabina.'));
      }
      var sig = deps.siguiente(lecId), acciones = h('div', { 'class': 'btn-row es-actions' });
      if (!hecha) acciones.appendChild(K.button({ label: 'Marcar como lista', variant: 'primary', icon: 'check', onClick: marcarLista }));
      else if (sig) acciones.appendChild(K.button({ label: 'Siguiente lección', variant: 'primary', iconRight: 'arrow-right', onClick: function () { deps.irLeccion(sig.id); } }));
      acciones.appendChild(K.button({ label: 'Volver al módulo', variant: hecha && !sig ? 'primary' : 'secondary', icon: 'list', onClick: function () { deps.volver(); } }));
      if (iQuiz >= 0) acciones.appendChild(K.button({ label: 'Repetir el mini-quiz', variant: 'ghost', icon: 'reset', onClick: function () { nuevoQuiz(); R.ir(iQuiz); } }));
      cuerpo.appendChild(acciones);
      if (hecha && !sig) cuerpo.appendChild(meta('Es la última lección disponible por ahora. Las que siguen llegan pronto.'));
      return cuerpo;
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
      var p = pasos[idx];
      if (p.k === 'quiz' && !R.q) { var r0 = rec(); if (r0.q && arr(r0.q.resp).length) R.q = { i: r0.q.i, ok: r0.q.ok, resp: r0.q.resp.slice(), fin: false }; }
      if (idx > 0 || rec().estado) {
        if (!o.quedarse || cambia) {
          store.tocar(lecId, idx);
          if (prog && isFn(prog.touch)) prog.touch('escuela', lecId, { ruta: lecId + (R.clave() ? '/' + R.clave() : '') });
        }
      }
      var m = marco(p), cuerpo = p.k === 'intro' ? vistaIntro(p) : p.k === 'paso' ? vistaPaso(p) : p.k === 'practica' ? vistaPractica(p) : p.k === 'quiz' ? vistaQuiz(p) : vistaResumen();
      var nav = p.k === 'quiz' ? h('div', { 'class': 'runner-nav es-nav' }, botonNav('Anterior', 'back', function () { R.ir(idx - 1); }, { disabled: idx === 0 }), h('span')) : navBasica(idx);
      var card = h('article', { 'class': 'runner es-run', 'data-etapa': p.k, 'aria-label': 'Lección ' + R.titulo() }, m.top, m.prog, m.titulo, cuerpo, nav, m.dots);
      while (R.el.firstChild) R.el.removeChild(R.el.firstChild);
      R.el.appendChild(card);
      if (isFn(deps.annotate)) deps.annotate(card.querySelectorAll('.es-point, .es-points, .es-obj'));
      if (o.foco !== false && cambia) { try { m.titulo.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }
      if (isFn(deps.alMostrar)) deps.alMostrar(R, cambia);
    };
    R.mostrar(clamp(idx0 | 0, 0, pasos.length - 1), { foco: false });
    return R;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Leccion;
})(root.C150);
