var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-situacion.js — componente `situacion` (SIT): un mini-escenario para decidir, con consecuencia y porqué (contrato v7, E3).
 * Mismo formato que las "Situaciones" de VOLAR (src/situations.js): contexto → lo que ves → qué hacés → qué pasa y por qué. Las opciones se
 * muestran mezcladas (con semilla estable: nunca "la primera es la correcta"). Elegir mal muestra la consecuencia y deja probar otra opción;
 * elegir bien muestra el porqué y sigue. Puede RAMIFICAR: una opción con `siguiente` lleva a otra escena (sin reintento: la rama es la consecuencia).
 * Nota: sólo cuenta la PRIMERA elección de cada escena puntuable; las falladas entran al mazo de repaso. Al terminar: ctx.score + ctx.done().
 * Una escena sin ninguna opción correcta es exploratoria (muestra qué pasa con cada opción, sin nota). Una escena con varias correctas es de "elegí todas".
 *
 * ESQUEMA DE `datos` (canónico):
 *   { escenas:[{ id, contexto, senales?:['lo que ves'…], pregunta?, multiple?:bool,
 *                opciones:[{ texto, resultado?, correcta:bool, siguiente?:'id de escena' | 'fin' }] }],     1 a 12 escenas, 2 a 6 opciones
 *     leccionFinal?:'texto',            el cierre: lo que hay que llevarse (se muestra al terminar)
 *     situacionApp?:'id',               alternativa: una situación viva de la app (C150.DATA.situations): ficha + botón para practicarla en el simulador
 *     nota?:'texto' }
 * El orden de las escenas es el del arreglo; sin `siguiente` se sigue con la que viene. El plan (§4) la llama {escena, opciones, leccionFinal}: se acepta tal cual.
 * normalizar entiende los esbozos del plan: {escenario, opciones:[{texto, correcta, resultado}]}, {escenas:[…]}, {escenario, motivos:[{texto, valido}]} (elegí todas),
 * {casos:[{escenario, respuesta | correcta, explicacion}]} (las opciones salen de las respuestas distintas de todos los casos; si son siglas o hay una sola → null),
 * {situacion:'id de la app'}, con `mensajeFinal` como cierre. Sin opciones utilizables → null (el motor muestra la reserva).  Handle: destroy · getState.
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
  function cap(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  function slug(t) { t = String(t === undefined || t === null ? '' : t); if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function publica(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }
  function mezclar(l, semilla) { return ES.arrastre && isFn(ES.arrastre.mezclar) ? ES.arrastre.mezclar(l, semilla) : arr(l).slice(); }
  function appSituacion(id) {
    var D = C150.DATA, l = D && Array.isArray(D.situations) ? D.situations : [];
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i];
    return null;
  }

  /* ================================================================== normalizar (puro) */
  var KOPC = ['opciones', 'motivos', 'respuestas', 'alternativas', 'decisiones'];

  function opcionDe(o) {
    if (typeof o === 'string' || typeof o === 'number') { var t = str(o); return t ? { texto: t, correcta: false, resultado: '', siguiente: '' } : null; }
    if (!esObj(o)) return null;
    var texto = str(o.texto) || str(o.opcion) || str(o.respuesta) || str(o.accion) || str(o.decision) || str(o.nombre);
    if (!texto) return null;
    return { texto: texto, correcta: o.correcta === true || o.valido === true || o.correcto === true || o.ok === true || o.acierto === true,
      resultado: publica(o.resultado) || publica(o.consecuencia) || publica(o.explicacion) || publica(o.porque) || publica(o.feedback), siguiente: str(o.siguiente) || str(o.next) };
  }
  function escenaDe(o, i) {
    if (!esObj(o)) return null;
    var contexto = str(o.contexto) || str(o.escenario) || str(o.escena) || str(o.situacion) || str(o.pregunta) || str(o.texto);
    var clave = null, k;
    for (k = 0; k < KOPC.length && !clave; k++) if (Array.isArray(o[KOPC[k]]) && o[KOPC[k]].length) clave = KOPC[k];
    if (!contexto || !clave) return null;
    var ops = o[clave].map(opcionDe).filter(Boolean);
    // la correcta a nivel de escena: un índice o el texto de una opción
    if (!ops.some(function (x) { return x.correcta; }) && o.correcta !== undefined) {
      var c = o.correcta;
      if (typeof c === 'number' && ops[c]) ops[c].correcta = true;
      else if (typeof c === 'string') ops.forEach(function (x) { if (slug(x.texto) === slug(c)) x.correcta = true; });
    }
    if (ops.length < 2 || ops.length > 6) return null;
    var nOk = ops.filter(function (x) { return x.correcta; }).length;
    if (nOk === ops.length) return null;      // todas "correctas": no hay nada para decidir
    var senales = arr(o.senales || o['señales']).map(str).filter(Boolean).slice(0, 5);
    return { id: str(o.id) || ('s' + (i + 1)), contexto: contexto, senales: senales, pregunta: publica(o.pregunta) !== contexto ? publica(o.pregunta) : '',
      multiple: o.multiple === true || o.elegir === 'varias' || clave === 'motivos' || nOk >= 2, opciones: ops };
  }
  /** {casos:[{escenario, respuesta|correcta, explicacion}]} → una escena por caso; las opciones salen de las respuestas distintas de todos los casos. */
  function escenasDeCasos(casos) {
    // {casos:[{escenario, validas:['a','b']}]}: "elegí todas las que valen"; el universo de opciones es la unión de las válidas de todos los casos
    if (casos.some(function (c) { return esObj(c) && Array.isArray(c.validas); })) {
      var univ = [], vu = {};
      casos.forEach(function (c) { if (esObj(c)) arr(c.validas).map(str).filter(Boolean).forEach(function (t) { if (!vu[slug(t)]) { vu[slug(t)] = 1; univ.push(t); } }); });
      if (univ.length < 3 || univ.length > 6) return [];
      var porV = [];
      casos.forEach(function (c) {
        var esc = esObj(c) && (str(c.escenario) || str(c.escena) || str(c.contexto) || str(c.texto));
        if (!esc) return;
        var ok = {}; arr(c.validas).forEach(function (t) { ok[slug(str(t))] = 1; });
        var nv = univ.filter(function (t) { return ok[slug(t)]; }).length;
        if (nv < 1 || nv === univ.length) return;      // todas valen (o ninguna): no hay nada para decidir
        porV.push({ id: 's' + (porV.length + 1), contexto: esc, senales: [], pregunta: 'Elegí todas las que sirven.', multiple: true,
          opciones: univ.map(function (t) { return { texto: cap(t), correcta: !!ok[slug(t)], resultado: publica(c.explicacion), siguiente: '' }; }) });
      });
      return porV;
    }
    var crudos = casos.map(function (c) {
      if (!esObj(c)) return null;
      var esc = str(c.escenario) || str(c.escena) || str(c.contexto) || str(c.texto);
      var resp = str(c.respuesta) || (typeof c.correcta === 'string' ? str(c.correcta) : '');
      return esc && resp ? { esc: esc, resp: resp, why: publica(c.explicacion) || publica(c.resultado) || publica(c.porque) } : null;
    }).filter(Boolean);
    if (crudos.length < 1) return [];
    var distintas = [], vistas = {};
    crudos.forEach(function (c) { var s = slug(c.resp); if (!vistas[s]) { vistas[s] = 1; distintas.push(c.resp); } });
    if (distintas.length < 2) return [];
    var siglas = distintas.filter(function (t) { return !/\s/.test(t) && t.length <= 4; }).length;
    if (siglas * 2 >= distintas.length) return [];          // 'jso', 'jit'… ids sin texto legible: no hay con qué armar opciones
    return crudos.map(function (c, i) {
      var otras = distintas.filter(function (t) { return slug(t) !== slug(c.resp); }).slice(0, 3);
      var ops = [{ texto: cap(c.resp), correcta: true, resultado: c.why, siguiente: '' }].concat(otras.map(function (t) { return { texto: cap(t), correcta: false, resultado: '', siguiente: '' }; }));
      return { id: 's' + (i + 1), contexto: c.esc, senales: [], pregunta: '', multiple: false, opciones: ops };
    });
  }

  function normalizar(datos, ctx, comp) {
    try {
      if (!esObj(datos)) return null;
      var cierre = publica(datos.leccionFinal) || publica(datos.mensajeFinal) || publica(datos.leccion);
      if (typeof datos.situacion === 'string' && appSituacion(datos.situacion) && !Array.isArray(datos.opciones)) return { escenas: [], situacionApp: datos.situacion, leccionFinal: cierre, nota: publica(datos.nota) };
      if (typeof datos.situacionApp === 'string' && appSituacion(datos.situacionApp)) return { escenas: [], situacionApp: datos.situacionApp, leccionFinal: cierre, nota: publica(datos.nota) };
      var escenas = [];
      if (Array.isArray(datos.escenas)) escenas = datos.escenas.map(escenaDe);
      else if (Array.isArray(datos.casos)) escenas = escenasDeCasos(datos.casos);
      else escenas = [escenaDe(datos, 0)];
      escenas = escenas.filter(Boolean);
      if (!escenas.length || escenas.length > 12) return null;
      // ids únicos y ramas válidas
      var ids = {};
      escenas.forEach(function (e, i) { if (ids[e.id]) e.id = e.id + '_' + (i + 1); ids[e.id] = 1; });
      escenas.forEach(function (e) {
        e.opciones.forEach(function (o) {
          if (!o.siguiente) return;
          var s = o.siguiente, n = /^\d+$/.test(s) ? 's' + s : s;
          o.siguiente = /^(fin|final)$/i.test(s) ? 'fin' : ids[s] ? s : ids[n] ? n : '';
        });
      });
      return { escenas: escenas, leccionFinal: cierre, nota: publica(datos.nota) };
    } catch (e) { return null; }
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, K = ctx.Kit;
    var semilla = (ctx.leccion && ctx.leccion.id || '') + '|' + (ctx.key || '') + '|sit';
    var cuerpo = h('div', { 'class': 'es-sit' });
    host.appendChild(cuerpo);
    function vaciar(e) { while (e.firstChild) e.removeChild(e.firstChild); }

    /* ---- una situación viva de la app: ficha + botón */
    if (datos.situacionApp) {
      var sa = appSituacion(datos.situacionApp) || {};
      var señales = arr(sa['señales'] || sa.senales);
      cuerpo.appendChild(h('div', { 'class': 'es-sit-card' },
        h('p', { 'class': 'es-meta', text: 'SITUACIÓN PARA PRACTICAR EN EL SIMULADOR' }),
        h('p', { 'class': 'es-sit-ctx', text: sa.contexto || sa.titulo || '' }),
        señales.length ? h('ul', { 'class': 'es-sit-sig', 'aria-label': 'Lo que notás' }, señales.map(function (t) { return h('li', { text: t }); })) : null,
        sa.objetivo ? h('p', { 'class': 'es-note', text: 'Tu objetivo: ' + sa.objetivo }) : null,
        h('div', { 'class': 'btn-row' }, K.button({ label: 'Practicala en el simulador', variant: 'primary', icon: 'plane', onClick: function () { if (isFn(ctx.enlace)) ctx.enlace({ tipo: 'situacion', id: datos.situacionApp }); if (isFn(ctx.done)) ctx.done(); } }))));
      if (datos.leccionFinal) cuerpo.appendChild(h('p', { 'class': 'es-note', text: datos.leccionFinal }));
      return { destroy: function () {}, getState: function () { return { situacionApp: datos.situacionApp }; } };
    }

    var porId = {}; datos.escenas.forEach(function (e, i) { e.n = i; porId[e.id] = e; });
    var esRetry = !!ctx.hecho, res = {}, camino = [], actual = null, fin = false, reinicios = 0;
    // res[id] = { primera: true|false|null (null = exploratoria), fallos: n, elegidas:[idx], bloqueada: bool, sig: id|'fin'|'' }

    function puntuable(e) { return e.opciones.some(function (o) { return o.correcta; }); }
    function orden(e) { return mezclar(e.opciones.map(function (o, i) { return i; }), semilla + '|' + e.id + '|' + reinicios); }
    function siguienteDe(e, opcion) {
      if (opcion && opcion.siguiente) return opcion.siguiente;
      return datos.escenas[e.n + 1] ? datos.escenas[e.n + 1].id : 'fin';
    }
    function refDe(e) { var S = ES.store; return isFn(S && S.hashTexto) ? S.hashTexto(e.contexto).slice(0, 6) : e.id; }

    function ir(id, conFoco) {
      actual = porId[id] || datos.escenas[0];
      if (camino.indexOf(actual.id) < 0) camino.push(actual.id);
      if (!res[actual.id]) res[actual.id] = { primera: null, fallos: 0, elegidas: [], bloqueada: false, sig: '', orden: orden(actual) };
      pintar(conFoco === true);
    }
    function aviso(tono, titulo, textos) {
      return h('div', { 'class': 'feedback qz-fb ' + (tono === 'ok' ? 'feedback--ok' : tono === 'bad' ? 'feedback--bad' : ''), role: 'status' },
        h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(tono === 'ok' ? 'check' : tono === 'bad' ? 'bulb' : 'info')),
        h('div', { 'class': 'qz-fb-b' }, h('strong', { text: titulo }), arr(textos).filter(Boolean).map(function (t) { return h('span', { text: t }); })));
    }

    function pintar(foco) {
      // el botón que tenía el foco se destruye con el cuerpo: se recuerda su lugar para devolverle el foco al nuevo (F2)
      var act = typeof document !== 'undefined' ? document.activeElement : null, opAct = act && act.closest ? act.closest('.es-sit-opts .opt') : null, posAct = opAct && cuerpo.contains(opAct) ? Array.prototype.indexOf.call(cuerpo.querySelectorAll('.es-sit-opts .opt'), opAct) : -1;
      vaciar(cuerpo);
      var e = actual, r = res[e.id], graded = puntuable(e), n = datos.escenas.length;
      var lista = h('div', { 'class': 'opts es-sit-opts', role: 'group', 'aria-labelledby': 'es-sit-q-' + ctx.key });
      r.orden.forEach(function (oi, pos) {
        var o = e.opciones[oi], elegida = r.elegidas.indexOf(oi) >= 0, cl = 'opt';
        if (e.multiple) {
          if (r.bloqueada) cl += o.correcta ? (elegida ? ' is-correct' : ' is-miss') : (elegida ? ' is-wrong' : '');
          else if (elegida) cl += ' is-picked';
        } else if (elegida) cl += (graded ? (o.correcta ? ' is-correct' : ' is-wrong') : ' is-picked');
        else if (r.bloqueada && o.correcta) cl += ' is-correct';
        var bloquea = r.bloqueada || (!e.multiple && elegida);
        lista.appendChild(h('button', Object.assign({ type: 'button', 'class': cl, 'aria-disabled': bloquea ? 'true' : null, onclick: function () { elegir(oi); } },
          e.multiple ? { role: 'checkbox', 'aria-checked': elegida ? 'true' : 'false' } : {}),
          h('span', { 'class': 'opt-letter', 'aria-hidden': 'true', text: e.multiple ? (elegida ? '✓' : '·') : 'ABCDEF'.charAt(pos) }), h('span', { 'class': 'opt-t', text: o.texto }),
          r.bloqueada && o.correcta ? h('span', { 'class': 'opt-flag', 'aria-hidden': 'true' }, icon('check')) : null,
          r.bloqueada && o.correcta ? h('span', { 'class': 'sr-only', text: ' (correcta)' }) : null,
          elegida && !o.correcta && graded ? h('span', { 'class': 'sr-only', text: ' (tu elección: no es la correcta)' }) : null));
      });
      var prog = n > 1 ? h('p', { 'class': 'es-meta es-sit-prog', text: ('Escena ' + (camino.indexOf(e.id) + 1) + (datos.escenas.some(function (x) { return x.opciones.some(function (o) { return o.siguiente; }); }) ? '' : ' de ' + n)).toUpperCase() }) : null;
      var rotuloEsc = (n > 1 ? 'Escena ' + (camino.indexOf(e.id) + 1) : 'Situación') + ': ' + e.contexto + ' ' + (e.pregunta || (e.multiple ? '¿Qué te parece? Marcá todas las que correspondan.' : '¿Qué hacés?'));
      var tarjeta = h('div', { 'class': 'es-sit-card', role: 'group', tabindex: '-1', 'aria-label': rotuloEsc },
        prog,
        h('p', { 'class': 'es-sit-ctx', text: e.contexto }),
        e.senales.length ? h('ul', { 'class': 'es-sit-sig', 'aria-label': 'Lo que ves' }, e.senales.map(function (t) { return h('li', { text: t }); })) : null,
        h('p', { 'class': 'es-q es-q--sm', id: 'es-sit-q-' + ctx.key, text: e.pregunta || (e.multiple ? '¿Qué te parece? Marcá todas las que correspondan.' : '¿Qué hacés?') }),
        lista);
      cuerpo.appendChild(tarjeta);
      if (e.multiple && !r.bloqueada) {
        cuerpo.appendChild(h('div', { 'class': 'btn-row' }, K.button({ label: 'Comprobar', variant: 'primary', size: 'small', icon: 'check', disabled: r.elegidas.length ? null : true, onClick: comprobar })));
      }
      // consecuencia
      if (r.msg) cuerpo.appendChild(aviso(r.msg.tono, r.msg.titulo, r.msg.textos));
      if (r.bloqueada) {
        if (r.sig && r.sig !== 'fin' && porId[r.sig]) cuerpo.appendChild(h('div', { 'class': 'btn-row' }, K.button({ label: 'Seguir', variant: 'primary', iconRight: 'arrow-right', onClick: function () { ir(r.sig, true); } })));
        else terminar();
      }
      var Bq = ES.bloques;
      if (foco === true) { if (Bq && isFn(Bq.enfocar)) Bq.enfocar(tarjeta); else tarjeta.focus({ preventScroll: true }); }      // escena nueva (a pedido del alumno): el foco lee el contexto y la pregunta
      else if (posAct >= 0) { var nb = cuerpo.querySelectorAll('.es-sit-opts .opt')[posAct]; if (nb) nb.focus({ preventScroll: true }); }
    }

    function elegir(oi) {
      var e = actual, r = res[e.id], o = e.opciones[oi];
      if (r.bloqueada) return;
      if (e.multiple) {
        var k = r.elegidas.indexOf(oi); if (k >= 0) r.elegidas.splice(k, 1); else r.elegidas.push(oi);
        pintar(); var b = cuerpo.querySelectorAll('.es-sit-opts .opt'); var pos = r.orden.indexOf(oi); if (b[pos]) b[pos].focus({ preventScroll: true });
        return;
      }
      if (r.elegidas.indexOf(oi) >= 0) return;
      r.elegidas.push(oi);
      var graded = puntuable(e);
      if (graded && r.primera === null) r.primera = !!o.correcta;
      if (graded && !o.correcta) r.fallos++;
      if (!graded) {                                      // exploratoria: cualquier opción muestra qué pasa
        r.bloqueada = true; r.sig = siguienteDe(e, o);
        r.msg = { tono: 'info', titulo: 'Esto es lo que pasa', textos: [o.resultado || 'Cada decisión tiene sus consecuencias.'] };
      } else if (o.correcta) {
        r.bloqueada = true; r.sig = siguienteDe(e, o);
        r.msg = { tono: 'ok', titulo: '¡Bien decidido!', textos: [o.resultado] };
      } else if (o.siguiente) {                           // una rama: la consecuencia es la próxima escena (sin reintento)
        r.bloqueada = true; r.sig = o.siguiente;
        r.msg = { tono: 'bad', titulo: 'Eso tiene consecuencias.', textos: [o.resultado || 'Mirá cómo sigue la situación.'] };
      } else {
        r.msg = { tono: 'bad', titulo: 'Esa no es la mejor.', textos: [o.resultado || 'No es la decisión correcta. Probá con otra opción.', o.resultado ? 'Probá con otra opción.' : ''] };
      }
      pintar();
      enfocar(r);
    }
    function enfocar(r) {
      var sig = cuerpo.querySelector('.btn-row .btn');
      if (r.bloqueada && sig) sig.focus({ preventScroll: true });
    }
    function comprobar() {
      var e = actual, r = res[e.id];
      if (r.bloqueada || !r.elegidas.length) return;
      var bien = e.opciones.every(function (o, i) { return !!o.correcta === (r.elegidas.indexOf(i) >= 0); });
      r.primera = bien; if (!bien) r.fallos++;
      r.bloqueada = true; r.sig = siguienteDe(e, null);
      var porque = [];
      e.opciones.forEach(function (o) { if (o.resultado) porque.push((o.correcta ? 'Sí: ' : 'No: ') + o.texto + '. ' + o.resultado); });
      r.msg = bien ? { tono: 'ok', titulo: '¡Bien! Elegiste justo las correctas.', textos: porque } : { tono: 'bad', titulo: 'Casi. Mirá cuáles eran.', textos: porque.length ? porque : ['Las marcadas en verde eran las correctas.'] };
      pintar();
      enfocar(r);
    }

    function terminar() {
      if (!fin) {
        fin = true;
        var vistas = camino.map(function (id) { return porId[id]; }).filter(puntuable);
        var ok = vistas.filter(function (e) { return res[e.id].primera === true; }).length, total = vistas.length;
        var fallos = vistas.filter(function (e) { return res[e.id].primera === false; });
        if (total && isFn(ctx.score)) ctx.score(ok, total, { retry: esRetry, fallos: fallos.map(refDe) });
        if (isFn(ctx.done)) ctx.done();
        resumen = { ok: ok, total: total };
      }
      var uno = datos.escenas.length === 1 || resumen.total <= 1;
      var cajita = h('div', { 'class': 'es-sit-end' },
        !uno ? h('div', { 'class': 'feedback ' + (resumen.ok === resumen.total ? 'feedback--ok' : ''), role: 'status' },
          h('strong', { text: resumen.ok === resumen.total ? '¡Resolviste todas a la primera!' : 'Resolviste ' + resumen.ok + ' de ' + resumen.total + ' a la primera.' }),
          resumen.ok !== resumen.total ? h('span', { text: 'Las que costaron van a tu repaso para que las veas de nuevo en unos días.' }) : null) : null,
        datos.leccionFinal ? h('div', { 'class': 'callout callout--dato' }, h('p', { 'class': 'placard', text: 'Para llevarte' }), h('p', { text: datos.leccionFinal })) : null,
        h('div', { 'class': 'btn-row' }, K.button({ label: 'Volver a empezar', variant: 'ghost', size: 'small', icon: 'reset', onClick: reiniciar })));
      cuerpo.appendChild(cajita);
    }
    var resumen = { ok: 0, total: 0 };
    function reiniciar() {
      res = {}; camino = []; fin = false; esRetry = true; reinicios++;
      ir(datos.escenas[0].id, true);
    }

    ir(datos.escenas[0].id);
    return {
      destroy: function () {},
      getState: function () { return { escena: actual && actual.id, vistas: camino.length, terminado: fin, ok: resumen.ok, total: resumen.total }; }
    };
  }

  Mot.register('situacion', { normalizar: normalizar, render: render });
  ES.situacion = { normalizar: normalizar };
})(root.C150);
