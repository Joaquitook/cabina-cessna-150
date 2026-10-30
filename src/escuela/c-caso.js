var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-caso.js — componente `caso` (CAS): un caso corto contado en pasos, con línea de tiempo, una o dos decisiones «¿qué hubieras hecho?» cuyo resultado
 * real se muestra después, y una tarjeta de «lección aprendida» (contrato v7 §5, pasada 2 · ola Q2). En pantallas anchas el relato va a la izquierda y el dibujo del
 * momento (con la cadena de pasos) queda fijo a la derecha; en las angostas el dibujo va arriba y el relato abajo.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { titulo, contexto, ficticio?:bool,                      ficticio:true → cartel «EJEMPLO INVENTADO PARA PRACTICAR» (si no, «CASO REAL»)
 *     pasos:[{ titulo?, cuando?, texto, decision?:{ pregunta, opciones:[2..4], correcta:índice, explicacion, resultado? }, escena?, figura?, icono?, dato? }],     3 a 8 pasos
 *     aprendizajes:['…'] (1 a 4)      fuente?:'texto'      nota?:'texto' }
 *   Cómo se cuenta: cada paso se muestra al apretar «Seguir»; un paso con `decision` frena el relato y pregunta antes de seguir (las opciones se mezclan con semilla estable);
 *   al contestar se ve si estuvo bien, el porqué y «Lo que pasó de verdad» (`resultado`, o el paso que sigue; «Lo que pasa en el ejemplo» si es ficticio). `escena`, `figura`, `icono` y `dato` son los de la diapositiva
 *   (ES.diapositiva): sin ninguno se dibuja el ícono del paso con su número. Al terminar: la tarjeta de lección aprendida, el puntaje de las decisiones y «Volver a contarlo».
 *   normalizar entiende los esbozos del plan: { titulo, texto, hechos[], etapas[], preguntas[{pregunta, opciones, correcta, explicacion}], leccion, personas[] }:
 *   el texto es el contexto, cada hecho un paso (con su etapa de título), las preguntas se reparten en los últimos pasos y `leccion` es el aprendizaje.
 * En un caso `ficticio` lo que se muestra tras decidir se rotula «LO QUE PASA EN EL EJEMPLO» (no pasó de verdad); en uno real, «LO QUE PASÓ DE VERDAD».
 * Parte pura (también en Node): ES.caso = { normalizar, decisiones, puntaje, rotuloResultado }
 * Puntaje: ctx.score(bien a la primera, decisiones, {fallos:[ref…]}) al terminar (si hay decisiones); ctx.done() al llegar a la tarjeta final. Handle: destroy · getState.
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
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function plano(t) { return String(t || '').replace(/\*\*|==|\{\{([^|}]*)(?:\|[^}]*)?\}\}/g, function (m, a) { return a === undefined ? '' : a; }); }
  function cap(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  function publico(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }

  /* ================================================================== normalizar (puro) */
  function decisionDe(o) {
    if (!esObj(o)) return null;
    var preg = str(o.pregunta) || str(o.consigna);
    var ops = arr(o.opciones).map(function (x) { return str(esObj(x) ? (x.texto || x.opcion) : x); });
    if (!preg || ops.length < 2 || ops.length > 4 || ops.some(function (t) { return !t; })) return null;
    var c = o.correcta;
    if (typeof c === 'string') { var k = -1; ops.forEach(function (t, i) { if (fold(t) === fold(c)) k = i; }); c = k; }
    if (typeof c !== 'number' || c !== Math.floor(c) || c < 0 || c >= ops.length) return null;
    return { pregunta: preg, opciones: ops, correcta: c, explicacion: publico(o.explicacion) || ('La mejor decisión era: ' + ops[c].replace(/[.\s]+$/, '') + '.'), resultado: publico(o.resultado) };
  }
  function pasoDe(o) {
    if (typeof o === 'string') { var t = publico(o); return t ? { titulo: '', cuando: '', texto: t, decision: null } : null; }
    if (!esObj(o)) return null;
    var texto = publico(o.texto) || publico(o.descripcion) || publico(o.hecho);
    if (!texto) return null;
    var p = { titulo: str(o.titulo) || str(o.etapa), cuando: str(o.cuando) || str(o.hora) || str(o.momento), texto: texto, decision: decisionDe(o.decision) };
    ['escena', 'figura', 'icono', 'dato', 'ilustracion'].forEach(function (k) { if (o[k] !== undefined) p[k] = o[k]; });
    return p;
  }
  function pasosDePersonas(personas) {
    return arr(personas).map(function (p) {
      if (!esObj(p) || !str(p.nombre)) return null;
      var datos = [str(p.edad) ? p.edad + ' años' : '', str(p.lugar) ? 'estudios en ' + p.lugar : ''].filter(Boolean).join(', ');
      var lleva = arr(p.lleva).map(str).filter(Boolean);
      var t = p.nombre + (datos ? ' (' + datos + ')' : '') + (lleva.length ? ' lleva: ' + lleva.join('; ') + '.' : '.');
      return { titulo: p.nombre, cuando: '', texto: t, decision: null };
    }).filter(Boolean);
  }
  /** Reparte las preguntas sueltas del esbozo en los últimos pasos (una por paso). */
  function repartir(pasos, preguntas) {
    var qs = arr(preguntas).map(decisionDe).filter(Boolean), n = pasos.length, k;
    if (!qs.length) return;
    qs = qs.slice(0, Math.min(qs.length, n));
    for (k = 0; k < qs.length; k++) { var dst = pasos[n - qs.length + k]; if (!dst.decision) dst.decision = qs[k]; }
  }
  function normalizar(datos, ctx, comp) {
    if (!esObj(datos)) return null;
    var pasos = arr(datos.pasos).map(pasoDe).filter(Boolean);
    if (!pasos.length) {
      var hechos = arr(datos.hechos).map(str).filter(Boolean), etapas = arr(datos.etapas).map(str).filter(Boolean);
      pasos = hechos.map(function (t, k) { return { titulo: etapas.length === hechos.length ? etapas[k] : '', cuando: '', texto: publico(t), decision: null }; }).filter(function (p) { return p.texto; });
      if (!pasos.length) pasos = pasosDePersonas(datos.personas);
      if (pasos.length) repartir(pasos, datos.preguntas);
    }
    if (pasos.length < 2 || pasos.length > 10) return null;
    var D = ES.diapositiva;
    pasos.forEach(function (p, k) {
      var base = { titulo: p.titulo, texto: p.texto, figura: '', escena: p.escena, dato: null, icono: str(p.icono), ilustracion: str(p.ilustracion) };
      if (str(p.figura) && ES.figuras && ES.figuras.has(str(p.figura))) base.figura = str(p.figura);
      if (esObj(p.dato) && str(p.dato.valor)) base.dato = { valor: str(p.dato.valor), unidad: str(p.dato.unidad), etiqueta: str(p.dato.etiqueta) };
      p.escena = D && isFn(D.escenaDe) ? D.escenaDe(base, k, pasos.length) : { tipo: 'icono', icono: 'info' };
      delete p.figura; delete p.icono; delete p.dato; delete p.ilustracion;
    });
    var aprend = arr(datos.aprendizajes).map(publico).filter(Boolean);
    [datos.aprendizaje, datos.leccion, datos.leccionAprendida, datos.leccionFinal].forEach(function (t) { t = publico(t); if (t && aprend.indexOf(t) < 0) aprend.push(t); });
    var contexto = publico(datos.contexto) || publico(datos.texto) || publico(datos.descripcion);
    var titulo = str(datos.titulo) || (comp && str(comp.titulo)) || 'Un caso para pensar';
    if (!contexto && !aprend.length) return null;
    return { titulo: titulo, contexto: contexto, ficticio: datos.ficticio === true, pasos: pasos, aprendizajes: aprend.slice(0, 4), fuente: publico(datos.fuente), nota: publico(datos.nota) };
  }
  /** Los pasos con decisión, en orden: [{paso, decision}]. */
  function decisiones(d) { var out = []; d.pasos.forEach(function (p, k) { if (p.decision) out.push({ paso: k, decision: p.decision }); }); return out; }
  /** {ok, total, falladas:[paso]} de las decisiones: resps[paso] = índice elegido la PRIMERA vez (en el orden mezclado ya traducido al original). */
  function puntaje(d, resps) {
    var ok = 0, fall = [], ds = decisiones(d);
    ds.forEach(function (x) { if (resps[x.paso] === x.decision.correcta) ok++; else fall.push(x.paso); });
    return { ok: ok, total: ds.length, falladas: fall };
  }

  /** El rótulo de lo que se muestra después de decidir: en un caso real «LO QUE PASÓ DE VERDAD»; en un ejemplo inventado (ficticio:true) no pasó de verdad: «LO QUE PASA EN EL EJEMPLO». */
  function rotuloResultado(ficticio) { return ficticio ? 'LO QUE PASA EN EL EJEMPLO' : 'LO QUE PASÓ DE VERDAD'; }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, K = ctx.Kit, reducido = !!ctx.reducedMotion, D = ES.diapositiva, Q = ES.quiz, St = ES.store, pasos = datos.pasos, n = pasos.length;
    var base = (ctx.leccion && ctx.leccion.id || '') + '|' + (ctx.key || '') + '|caso', uid = (render._uid = (render._uid || 0) + 1);
    var vistos = 1, resp = {}, orden = {}, fin = false, hecho = !!ctx.hecho, vez = 0, escena = null;
    function mezcla(k) { return orden[k] || (orden[k] = (Q && isFn(Q.mezclar) ? Q.mezclar(pasos[k].decision, base + '|' + k + '|' + vez) : { opciones: pasos[k].decision.opciones, correcta: pasos[k].decision.correcta })); }
    function refDe(k) { return isFn(St && St.hashTexto) ? St.hashTexto(pasos[k].decision.pregunta).slice(0, 6) : String(k); }

    var aviso = h('p', { 'class': 'es-caso-rot' + (datos.ficticio ? ' is-ficticio' : '') }, icon(datos.ficticio ? 'info' : 'flag'),
      h('span', { text: datos.ficticio ? 'EJEMPLO INVENTADO PARA PRACTICAR · NO ES UN HECHO REAL' : 'CASO REAL' }));
    var cabeza = h('header', { 'class': 'es-caso-head' }, aviso, h('h4', { 'class': 'es-caso-t', text: datos.titulo }),
      datos.contexto ? h('p', { 'class': 'es-caso-ctx' }, D ? D.fraseEl(ctx, datos.contexto) : document.createTextNode(plano(datos.contexto))) : null);
    var lista = h('ol', { 'class': 'es-caso-hist', 'aria-label': 'La historia, paso a paso' });
    var accion = h('div', { 'class': 'es-caso-acc' });
    var fila = h('div', { 'class': 'es-caso-ctl' }, accion);
    var relato = h('div', { 'class': 'es-caso-relato' }, cabeza, lista, fila);
    var esc = D && isFn(D.crearEscena) ? D.crearEscena({ reducido: reducido }) : null;
    var kickEsc = h('p', { 'class': 'es-caso-ek', 'aria-hidden': 'true' });
    var panel = esc ? h('aside', { 'class': 'es-caso-fig', 'aria-label': 'Dibujo del momento' }, esc.svg, kickEsc) : null;
    var raiz = h('div', { 'class': 'es-caso' + (reducido ? ' is-rm' : '') + (panel ? '' : ' es-caso--sin-fig') }, h('div', { 'class': 'es-caso-grid' }, relato, panel));
    host.appendChild(raiz);

    function pintarEscena() {
      if (!esc) return;
      var k = Math.min(vistos, n) - 1, p = pasos[k];
      var fg = p.escena && p.escena.tipo === 'figura' && ES.figuras ? ES.figuras.get(p.escena.figura) : null;
      var st = fg && D ? D.estadoFigura([], -1, fg.capas) : null;           // la figura con sus capas de siempre
      esc.mostrar(p.escena, k, n, st);
      kickEsc.textContent = 'MOMENTO ' + p2(k + 1) + ' / ' + p2(n) + (p.cuando ? ' · ' + p.cuando : '');
    }
    function enfocar(el) { if (el && isFn(el.focus)) { try { el.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } } }

    function bloqueDecision(k, vivo) {
      var d = pasos[k].decision, m = mezcla(k), r = resp[k], contesto = r !== undefined, hid = 'es-caso-q-' + uid + '-' + k;
      var opts = h('div', { 'class': 'opts es-opts es-caso-opts', role: 'group', 'aria-labelledby': hid });
      m.opciones.forEach(function (t, j) {
        var c = 'opt', mia = contesto && r === j;
        if (contesto && j === m.correcta) c += ' is-correct'; else if (mia) c += ' is-wrong';
        opts.appendChild(h('button', { type: 'button', 'class': c, disabled: contesto ? true : null, onclick: function () { elegir(k, j); } },
          h('span', { 'class': 'opt-letter', 'aria-hidden': 'true', text: 'ABCD'.charAt(j) }), h('span', { 'class': 'opt-t', text: t }),
          contesto && j === m.correcta ? h('span', { 'class': 'opt-flag', 'aria-hidden': 'true' }, icon('check')) : null,
          contesto && j === m.correcta ? h('span', { 'class': 'sr-only', text: ' (la mejor decisión)' }) : null,
          mia && j !== m.correcta ? h('span', { 'class': 'sr-only', text: ' (tu elección)' }) : null));
      });
      var bloque = h('div', { 'class': 'es-caso-dec' + (contesto ? ' is-hecha' : '') },
        h('p', { 'class': 'es-caso-dk' }, icon('help'), h('span', { text: '¿QUÉ HUBIERAS HECHO?' })),
        h('p', { 'class': 'es-caso-dq', id: hid, text: d.pregunta }), opts);
      if (contesto) {
        var bien = r === m.correcta;
        bloque.appendChild(h('div', { 'class': 'feedback qz-fb ' + (bien ? 'feedback--ok' : 'feedback--bad'), role: 'status', tabindex: vivo ? '-1' : null },
          h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(bien ? 'check' : 'bulb')),
          h('div', { 'class': 'qz-fb-b' }, h('strong', { text: bien ? '¡Bien decidido!' : 'No era esa, pero así se aprende.' }),
            !bien ? h('span', { 'class': 'qz-fb-a' }, 'La mejor: ', h('b', { text: m.opciones[m.correcta] })) : null,
            h('span', { 'class': 'qz-fb-e', text: d.explicacion }),
            d.resultado ? h('span', { 'class': 'es-caso-real' }, h('b', { text: rotuloResultado(datos.ficticio) }), h('span', { text: d.resultado })) : null)));
      }
      return bloque;
    }
    function pintar(foco) {
      while (lista.firstChild) lista.removeChild(lista.firstChild);
      for (var k = 0; k < vistos; k++) {
        var p = pasos[k], now = k === vistos - 1 && !fin, abierta = !!p.decision;
        var li = h('li', { 'class': 'es-caso-beat' + (now ? ' is-now' : ' is-past'), 'aria-current': now ? 'step' : null },
          h('span', { 'class': 'es-caso-node', 'aria-hidden': 'true', text: String(k + 1) }),
          h('div', { 'class': 'es-caso-bb' },
            h('p', { 'class': 'es-caso-bk' }, h('b', { text: 'PASO ' + p2(k + 1) }), p.cuando ? h('span', { text: p.cuando }) : null, p.titulo ? h('span', { text: p.titulo }) : null),
            h('p', { 'class': 'es-caso-bt', tabindex: '-1' }, D ? D.fraseEl(ctx, p.texto) : document.createTextNode(plano(p.texto))),      // tabindex -1: recibe el foco al llegar a este paso (F2)
            abierta ? bloqueDecision(k, foco && now) : null));
        lista.appendChild(li);
      }
      // la acción de abajo: seguir, o (con una decisión sin contestar) nada hasta que conteste, o el cierre
      while (accion.firstChild) accion.removeChild(accion.firstChild);
      var ult = pasos[vistos - 1], pend = ult.decision && resp[vistos - 1] === undefined;
      if (fin) { accion.appendChild(K.button({ label: 'Volver a contarlo', variant: 'ghost', icon: 'reset', onClick: reiniciar })); }
      else if (pend) { accion.appendChild(h('p', { 'class': 'es-note es-caso-espera' }, icon('hand'), h('span', { text: 'Elegí una opción para seguir con la historia.' }))); }
      else if (vistos < n) accion.appendChild(K.button({ label: ult.decision ? 'Ver qué pasó' : 'Seguir', variant: 'primary', iconRight: 'arrow-right', onClick: function () { vistos++; pintar(true); pintarEscena(); var b = lista.querySelector('.es-caso-beat.is-now'); if (b) { enfocar(b.querySelector('.es-caso-bt')); if (b.scrollIntoView) { try { b.scrollIntoView({ block: 'nearest', behavior: reducido ? 'auto' : 'smooth' }); } catch (e) { /* idem */ } } } } }));
      else accion.appendChild(K.button({ label: 'Ver la lección aprendida', variant: 'primary', iconRight: 'arrow-right', onClick: terminar }));
      var tarj = raiz.querySelector('.es-caso-fin');
      if (tarj && !fin) tarj.parentNode.removeChild(tarj);
      if (fin && !tarj) relato.appendChild(tarjetaFinal());
    }
    function elegir(k, j) {
      if (resp[k] !== undefined) return;
      resp[k] = j; pintar(false);
      var fb = lista.querySelector('.qz-fb');
      if (fb) { fb.setAttribute('tabindex', '-1'); enfocar(fb); if (fb.scrollIntoView) { try { fb.scrollIntoView({ block: 'nearest', behavior: reducido ? 'auto' : 'smooth' }); } catch (e) { /* idem */ } } }
    }
    /** Lo elegido, traducido al índice original de la opción (-1 = no era la correcta): lo que espera ES.caso.puntaje. */
    function enOriginal() { var a = {}; Object.keys(resp).forEach(function (k) { a[k] = resp[k] === mezcla(+k).correcta ? pasos[k].decision.correcta : -1; }); return a; }
    function tarjetaFinal() {
      var s = puntaje(datos, enOriginal());
      var ul = h('ol', { 'class': 'es-caso-lec', 'aria-label': 'Lo que aprendimos' });
      datos.aprendizajes.forEach(function (t, k) { ul.appendChild(h('li', null, h('span', { 'class': 'es-caso-lec-n', 'aria-hidden': 'true', text: p2(k + 1) }), h('p', { text: t }))); });
      return h('section', { 'class': 'es-caso-fin', 'aria-labelledby': 'es-caso-f-' + uid },
        h('p', { 'class': 'es-caso-fk' }, icon('bulb'), h('span', { text: 'LECCIÓN APRENDIDA' })),
        h('h4', { 'class': 'es-caso-ft', id: 'es-caso-f-' + uid, tabindex: '-1', text: datos.aprendizajes.length > 1 ? 'Esto es lo que te llevás' : 'Esto es lo que te llevás del caso' }),
        datos.aprendizajes.length ? ul : null,
        s.total ? h('p', { 'class': 'es-pill is-' + (s.ok === s.total ? 'ok' : 'info'), role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }),
          h('span', { 'class': 'es-pill-t', text: s.ok === s.total ? 'Decidiste bien todas las veces a la primera.' : 'Decidiste bien ' + s.ok + ' de ' + s.total + ' a la primera. Lo que costó queda en tu repaso.' })) : null,
        datos.fuente ? h('p', { 'class': 'es-meta', text: 'FUENTE · ' + datos.fuente }) : null,
        datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null);
    }
    function terminar() {
      fin = true;
      var s = puntaje(datos, enOriginal());
      if (s.total && isFn(ctx.score)) ctx.score(s.ok, s.total, { retry: vez > 0, fallos: s.falladas.map(refDe) });
      if (!hecho) { hecho = true; ctx.done(); }
      pintar(false);
      var f = raiz.querySelector('.es-caso-ft'); enfocar(f);
      var t = raiz.querySelector('.es-caso-fin'); if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: 'nearest', behavior: reducido ? 'auto' : 'smooth' }); } catch (e) { /* idem */ } }
    }
    function reiniciar() { vistos = 1; resp = {}; orden = {}; fin = false; vez++; pintar(false); pintarEscena(); enfocar(lista.querySelector('.es-caso-bt')); }

    pintar(false); pintarEscena();
    return {
      destroy: function () { if (esc) esc.destroy(); },
      getState: function () { return { vistos: vistos, de: n, decisiones: Object.keys(resp).length, terminado: fin }; }
    };
  }

  Mot.register('caso', { normalizar: normalizar, render: render });
  ES.caso = { normalizar: normalizar, decisiones: decisiones, puntaje: puntaje, rotuloResultado: rotuloResultado };
})(root.C150);
