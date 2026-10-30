var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-quiz.js — componente `quiz` (QUZ): un bloque de preguntas tipo DINACIA dentro de la lección (contrato v7 §5, pasada 2 · ola Q2).
 * Una pregunta por pantalla, enunciado grande, opciones con letra, respuesta al instante con la explicación y «Ver en el curso: p. N», y al final el resultado
 * contra la nota mínima (si el bloque la tiene) y la lista de lo que hay que repasar. Usa la MISMA cara que el mini-quiz de la lección: la pregunta se dibuja con
 * ES.leccion.vistaPregunta (puntos de avance, enunciado, opciones, explicación) y el estilo es el de .es-quest / .es-opts / .qz-fb.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { preguntas:[{ pregunta, opciones:[2..6 textos], correcta:índice, explicacion?, pagina? }],
 *     n?:cuántas preguntas por intento (se sortean con semilla; por defecto todas hasta 15),    aprobacion?:0..1 (0,75)    aciertosMinimos?:entero (si no, sale de aprobacion)
 *     repetible?:bool (por defecto sí: «Repetir con otras preguntas»; las que fallaste vuelven primero)     titulo?:'texto'     nota?:'texto' }
 *   Las opciones se mezclan con semilla estable (nunca «la primera es la correcta»). Aceptan `correcta` como índice o como el texto de la opción. Sin preguntas válidas devuelve null.
 * Parte pura (también en Node): ES.quiz = { normalizar, elegir, mezclar, calificar, veredicto, minimos }
 *   elegir(total, n, semilla, falladas?) → índices de las preguntas del intento (las falladas del intento anterior primero, hasta la mitad)
 *   mezclar(q, semilla) → {opciones, correcta}     calificar(lista, resps) → {ok, total, falladas:[posiciones]}     veredicto(ok, total, minimos) → 'aprobado' | 'repasar' | 'sin-nota'
 * Puntaje: ctx.score(aciertos, total, {retry, fallos:[ref…]}) al terminar cada intento (los intentos siguientes cuentan como reintento: queda el mejor); ctx.done() al terminar el primero.
 * Handle: destroy · getState.
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes;
  if (!Mot) return;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(x) { return typeof x === 'string' ? x.trim() : (typeof x === 'number' && isFinite(x) ? String(x) : ''); }
  function fold(t) { t = String(t === undefined || t === null ? '' : t); try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ } return t.toLowerCase().replace(/\s+/g, ' ').trim(); }

  /* ================================================================== parte pura */
  function hash(t) { var s = 2166136261, i; t = String(t); for (i = 0; i < t.length; i++) { s ^= t.charCodeAt(i); s = Math.imul(s, 16777619); } return s >>> 0; }
  function rng(semilla) {
    var s = hash(semilla);
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function barajar(l, semilla) { var r = rng(semilla), a = l.slice(), i; for (i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /** Cuántas hay que acertar: aciertosMinimos, o aprobacion × n redondeado hacia arriba; 0 = el bloque no tiene nota mínima. */
  function minimos(n, aprobacion, aciertos) {
    if (typeof aciertos === 'number' && aciertos > 0) return Math.min(n, Math.round(aciertos));
    if (typeof aprobacion === 'number' && aprobacion > 0 && aprobacion <= 1) return Math.min(n, Math.ceil(aprobacion * n - 1e-9));
    return 0;
  }
  /** Los índices de las preguntas de un intento: sorteo con semilla; las falladas del intento anterior van primero (hasta la mitad). */
  function elegir(total, n, semilla, falladas) {
    var todos = [], i; for (i = 0; i < total; i++) todos.push(i);
    n = Math.max(1, Math.min(n || total, total));
    var mez = barajar(todos, semilla + '|sorteo'), fall = arr(falladas).filter(function (k) { return k >= 0 && k < total; });
    var primeras = barajar(fall, semilla + '|f').slice(0, Math.ceil(n / 2)), resto = mez.filter(function (k) { return primeras.indexOf(k) < 0; });
    return barajar(primeras.concat(resto.slice(0, n - primeras.length)), semilla + '|orden');
  }
  /** Las opciones de una pregunta mezcladas con semilla estable; devuelve dónde quedó la correcta. */
  function mezclar(q, semilla) {
    var idx = barajar(q.opciones.map(function (_, i) { return i; }), semilla);
    return { opciones: idx.map(function (i) { return q.opciones[i]; }), correcta: idx.indexOf(q.correcta) };
  }
  function calificar(lista, resps) {
    var ok = 0, falladas = [];
    arr(lista).forEach(function (q, k) { if (resps[k] === q.correcta) ok++; else falladas.push(k); });
    return { ok: ok, total: arr(lista).length, falladas: falladas };
  }
  function veredicto(ok, total, min) { if (!(min > 0)) return 'sin-nota'; return ok >= min ? 'aprobado' : 'repasar'; }

  function preguntaDe(o) {
    if (!esObj(o)) return null;
    var enun = str(o.pregunta) || str(o.enunciado) || str(o.texto);
    var ops = arr(o.opciones || o.respuestas || o.alternativas).map(str);
    if (!enun || ops.length < 2 || ops.length > 6 || ops.some(function (t) { return !t; })) return null;
    var c = o.correcta;
    if (typeof c === 'string') { var k = -1; ops.forEach(function (t, i) { if (fold(t) === fold(c)) k = i; }); c = k; }
    if (typeof c !== 'number' || c !== Math.floor(c) || c < 0 || c >= ops.length) return null;
    var pg = typeof o.pagina === 'number' ? o.pagina : (typeof o.pagina === 'string' && /^\d+$/.test(o.pagina.trim()) ? +o.pagina.trim() : null);
    return { pregunta: enun, opciones: ops, correcta: c, explicacion: str(o.explicacion) || str(o.porque), pagina: pg > 0 ? pg : null };
  }
  function normalizar(datos, ctx, comp) {
    var l = Array.isArray(datos) ? datos : (esObj(datos) ? (datos.preguntas || datos.items || datos.questions) : null);
    if (!Array.isArray(l)) return null;
    var qs = l.map(preguntaDe).filter(Boolean);
    if (!qs.length) return null;
    var d = esObj(datos) ? datos : {};
    var n = typeof d.n === 'number' && d.n >= 1 ? Math.min(Math.floor(d.n), qs.length) : Math.min(qs.length, 15);
    var apr = typeof d.aprobacion === 'number' && d.aprobacion > 0 && d.aprobacion <= 1 ? d.aprobacion : 0;
    return { preguntas: qs, n: n, aprobacion: apr, minimos: minimos(n, apr, d.aciertosMinimos), repetible: d.repetible !== false, titulo: str(d.titulo), nota: str(d.nota) };
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, K = ctx.Kit, reducido = !!ctx.reducedMotion, Le = ES.leccion, St = ES.store;
    var base = (ctx.leccion && ctx.leccion.id || '') + '|' + (ctx.key || '') + '|qz';
    var intento = 0, lista = [], resps = [], i = 0, fin = false, falladasPrev = [], hecho = !!ctx.hecho, fase = 'inicio', uid = (render._uid = (render._uid || 0) + 1);
    var raiz = h('div', { 'class': 'es-quiz' + (reducido ? ' is-rm' : '') });
    host.appendChild(raiz);
    function vaciar() { while (raiz.firstChild) raiz.removeChild(raiz.firstChild); }
    function ref(q) { return isFn(St && St.hashTexto) ? St.hashTexto(q.pregunta).slice(0, 6) : String(hash(q.pregunta)); }
    function nuevoIntento() {
      intento++; i = 0; fin = false; resps = [];
      var idx = elegir(datos.preguntas.length, datos.n, base + '|' + intento, falladasPrev);
      lista = idx.map(function (k) {
        var q = datos.preguntas[k], m = mezclar(q, base + '|' + k + '|' + intento);
        return { k: k, pregunta: q.pregunta, opciones: m.opciones, correcta: m.correcta, explicacion: q.explicacion, pagina: q.pagina };
      });
    }
    function enfocar(el) { if (el && isFn(el.focus)) { try { el.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } } }

    /* ---- pantalla de inicio: la cifra grande y las reglas */
    function pintarInicio() {
      fase = 'inicio'; vaciar();
      var n = datos.n, hid = 'es-qz-h-' + uid;
      raiz.appendChild(h('div', { 'class': 'es-qz-inicio' },
        h('p', { 'class': 'es-qz-big', 'aria-hidden': 'true' }, h('b', { text: String(n) }), h('span', { text: n === 1 ? 'pregunta' : 'preguntas' })),
        h('div', { 'class': 'es-qz-reglas' },
          h('h4', { 'class': 'es-qz-t', id: hid, tabindex: '-1', text: datos.titulo || (n === 1 ? 'Una pregunta para vos' : 'Un bloque de ' + n + ' preguntas') }),
          h('ul', { 'class': 'es-qz-lista', 'aria-labelledby': hid },
            h('li', { text: 'Una pregunta por pantalla, con cuatro opciones o menos.' }),
            h('li', { text: 'Después de cada respuesta ves por qué, y en qué página del curso está.' }),
            datos.minimos ? h('li', { text: 'Para aprobar hay que acertar ' + datos.minimos + ' de ' + n + (datos.aprobacion ? ' (' + Math.round(datos.aprobacion * 100) + ' %)' : '') + '.' }) : h('li', { text: 'No hay nota mínima: es para practicar.' }),
            datos.n < datos.preguntas.length ? h('li', { text: 'Las ' + n + ' se sortean de ' + datos.preguntas.length + ': cada intento trae otras.' }) : null),
          h('div', { 'class': 'btn-row' }, K.button({ label: 'Empezar', variant: 'primary', iconRight: 'arrow-right', onClick: function () { nuevoIntento(); pintarPregunta(true); } }))),
        datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null));
    }

    /* ---- una pregunta */
    function responder(k) {
      if (resps[i] !== undefined) return;
      resps[i] = k;
      pintarPregunta(false);
      var fb = raiz.querySelector('.qz-fb');
      if (fb) { fb.setAttribute('tabindex', '-1'); enfocar(fb); if (fb.scrollIntoView) { try { fb.scrollIntoView({ block: 'nearest', behavior: reducido ? 'auto' : 'smooth' }); } catch (e) { /* idem */ } } }
    }
    function pintarPregunta(foco) {
      fase = 'pregunta'; vaciar();
      var n = lista.length, q = lista[i], resp = resps[i], contesto = resp !== undefined;
      var vp = Le.vistaPregunta({ K: K, hid: 'es-qz-q-' + uid, q: q, i: i, n: n, resp: contesto ? resp : null, onPick: responder,
        estados: lista.map(function (qq, d) { return resps[d] === undefined ? null : (resps[d] === qq.correcta ? 'ok' : 'bad'); }) });
      var ok = resps.filter(function (r, d) { return r === lista[d].correcta; }).length;
      raiz.appendChild(h('div', { 'class': 'es-qz-q' },
        h('p', { 'class': 'es-qz-k' }, h('b', { text: 'PREGUNTA ' + (i + 1) + ' DE ' + n }), h('span', { text: ok + ' BIEN' })),
        vp.dots, vp.h2, vp.opts));
      if (contesto) {
        raiz.appendChild(vp.fb);
        raiz.appendChild(h('div', { 'class': 'btn-row es-qnext' }, K.button({ label: i + 1 >= n ? 'Ver el resultado' : 'Siguiente pregunta', variant: 'primary', iconRight: 'arrow-right', onClick: function () { if (i + 1 >= n) terminar(); else { i++; pintarPregunta(true); } } })));
      } else if (foco) enfocar(vp.h2);
    }

    /* ---- resultado */
    function terminar() {
      fase = 'fin'; fin = true; vaciar();
      var r = calificar(lista, resps), v = veredicto(r.ok, r.total, datos.minimos), hid = 'es-qz-r-' + uid;
      falladasPrev = r.falladas.map(function (p) { return lista[p].k; });
      if (isFn(ctx.score)) ctx.score(r.ok, r.total, { retry: intento > 1, fallos: r.falladas.map(function (p) { return ref(lista[p]); }) });
      if (!hecho) { hecho = true; ctx.done(); }
      var etiqueta = v === 'aprobado' ? 'Aprobado' : v === 'repasar' ? 'A repasar' : (r.ok === r.total ? 'Perfecto' : 'Terminaste');
      var frase = v === 'aprobado' ? '¡Aprobaste! Hiciste ' + r.ok + ' de ' + r.total + ' y el mínimo era ' + datos.minimos + '.'
        : v === 'repasar' ? 'Hiciste ' + r.ok + ' de ' + r.total + ' y el mínimo era ' + datos.minimos + '. Repasá lo que sigue y probá de nuevo.'
        : r.ok === r.total ? 'Todas bien. Así se hace.' : 'Sumaste ' + r.ok + ' de ' + r.total + '. Lo que erraste queda en tu repaso.';
      var res = h('div', { 'class': 'es-qz-res es-qz-res--' + v },
        h('p', { 'class': 'es-qz-big', 'aria-hidden': 'true' }, h('b', { text: String(r.ok) }), h('span', { text: '/ ' + r.total })),
        h('div', { 'class': 'es-qz-resb' },
          h('p', { 'class': 'es-pill es-qz-veredicto is-' + (v === 'aprobado' ? 'ok' : v === 'repasar' ? 'warn' : 'info'), role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }), h('span', { 'class': 'es-pill-t', text: etiqueta })),
          h('h4', { 'class': 'es-qz-t', id: hid, tabindex: '-1', text: frase }),
          h('div', { 'class': 'btn-row' },
            datos.repetible ? K.button({ label: r.falladas.length ? 'Repetir con otras preguntas' : 'Repetir con otro sorteo', variant: v === 'aprobado' ? 'secondary' : 'primary', icon: 'reset', onClick: function () { nuevoIntento(); pintarPregunta(true); } }) : null)));
      raiz.appendChild(res);
      if (r.falladas.length) {
        var ul = h('ol', { 'class': 'es-qz-rev', 'aria-label': 'Las que erraste' });
        r.falladas.forEach(function (p) {
          var q = lista[p];
          ul.appendChild(h('li', null,
            h('p', { 'class': 'es-qz-rev-q', text: q.pregunta }),
            h('p', { 'class': 'es-qz-rev-a' }, h('span', { 'class': 'es-qz-rev-x', text: 'Elegiste' }), h('s', { text: q.opciones[resps[p]] })),
            h('p', { 'class': 'es-qz-rev-a is-ok' }, icon('check'), h('span', { 'class': 'es-qz-rev-x', text: 'Era' }), h('b', { text: q.opciones[q.correcta] })),
            q.explicacion ? h('p', { 'class': 'es-qz-rev-e', text: q.explicacion }) : null,
            q.pagina ? h('p', { 'class': 'es-pg', text: 'Ver en el curso: p. ' + q.pagina }) : null));
        });
        raiz.appendChild(h('div', { 'class': 'es-qz-revbox' }, h('p', { 'class': 'es-meta', text: 'PARA REPASAR · ' + r.falladas.length + (r.falladas.length === 1 ? ' PREGUNTA' : ' PREGUNTAS') }), ul));
      }
      enfocar(raiz.querySelector('.es-qz-t'));
    }

    pintarInicio();
    return {
      destroy: function () { },
      getState: function () { return { fase: fase, intento: intento, pregunta: i, de: lista.length, respuestas: resps.length, terminado: fin }; }
    };
  }

  Mot.register('quiz', { normalizar: normalizar, render: render });
  ES.quiz = { normalizar: normalizar, elegir: elegir, mezclar: mezclar, calificar: calificar, veredicto: veredicto, minimos: minimos };
})(root.C150);
