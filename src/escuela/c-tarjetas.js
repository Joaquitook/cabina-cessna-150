var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-tarjetas.js — componente `tarjetas` (TAR): un mazo de tarjetas de repaso con frente y dorso (contrato v7 pasada 2).
 * Leés el frente, pensás la respuesta, DAS VUELTA la tarjeta (con reducir movimiento: un fundido, sin giro) y contás con honestidad cuánto la sabías:
 * "La sabía" · "Más o menos" · "No la sabía". Al final hay un resumen de la sesión. Cada calificación se guarda en el dispositivo con un repaso espaciado
 * (Store.sm2, una versión simple de SM-2): las que cuestan vuelven mañana, las que sabés vuelven en 1, 6, ~15 días… Es lo que va a leer la pantalla "Repaso del día"
 * (store.tarjetasVencidas). Los botones de calificar dicen cuándo vuelve cada tarjeta. "No la sabía" también vuelve UNA vez al final de la misma sesión.
 * Sesión: primero las vencidas, después las nuevas, hasta 12; si el mazo tiene bloques se puede elegir uno; si todo está al día se puede repasar igual.
 * Teclado: Tab hasta "Dar vuelta" y Enter; con la tarjeta dada vuelta, 1 / 2 / 3 califican.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { consigna?:'texto', nota?:'texto',
 *     mazo:[{ idx, frente, dorso, pista?, figura?, bloque? }],     idx = lugar de la tarjeta en el mazo ORIGINAL (es la clave del repaso espaciado: 'INT-03-02:0'); no cambies el orden de un mazo publicado
 *     bloques?:[{ id, nombre, n }] }                                bloques = los grupos que usan las tarjetas (campo `bloque`), en orden de aparición
 *   frente / dorso aceptan el mini-marcado de las lecciones (**término**, ==clave==, {{75|%}}). figura = un nombre de src/icons.js o el id de una figura propia (ES.figuras).
 * normalizar entiende los esbozos del plan: mazo / tarjetas / cartas / items / preguntas con {frente, dorso | pregunta, respuesta | anverso, reverso | termino, definicion | a, b}
 * o [frente, dorso, pista], y dos listas paralelas (terminos / definiciones). Sin ninguna tarjeta con los dos lados → null. Un mazo por lección (la clave usa el índice de la tarjeta).
 * Handle: destroy · getState.
 *
 * Parte pura (ES.tarjetas, probada en Node): normalizar · armarSesion(cartas, registros, hoyDia, {max, bloque}) · crearSesion(idxs, {repaso}) · etiquetaIntervalo(dias) · cartaDe(lec, idx) · cartasDeLeccion(lec)
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
  function publica(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }
  function plano(t) { var T = ES.texto; return T && isFn(T.plano) ? T.plano(t) : String(t); }
  var MAX_SESION = 12;

  /* ================================================================== normalizar (puro) */
  var K_MAZO = ['mazo', 'tarjetas', 'cartas', 'cards', 'items', 'preguntas', 'pares'];
  var K_FRENTE = ['frente', 'pregunta', 'anverso', 'termino', 'concepto', 'front', 'a', 'texto'];
  var K_DORSO = ['dorso', 'respuesta', 'reverso', 'definicion', 'significado', 'back', 'b', 'explicacion'];
  var K_PISTA = ['pista', 'ayuda', 'hint', 'recordatorio'];

  function cartaDeCruda(x) {
    var f = '', d = '', p = '', fig = '', bl = '', i;
    if (Array.isArray(x)) { f = str(x[0]); d = str(x[1]); p = publica(x[2]); }
    else if (esObj(x)) {
      for (i = 0; i < K_FRENTE.length && !f; i++) f = str(x[K_FRENTE[i]]);
      for (i = 0; i < K_DORSO.length && !d; i++) d = str(x[K_DORSO[i]]);
      for (i = 0; i < K_PISTA.length && !p; i++) p = publica(x[K_PISTA[i]]);
      fig = str(x.figura || x.icono || x.icon);
      bl = x.bloque !== undefined && x.bloque !== null && x.bloque !== '' ? x.bloque : (x.grupo !== undefined ? x.grupo : (x.tema !== undefined ? x.tema : ''));
    }
    return f && d ? { frente: f, dorso: d, pista: p, figura: fig, bloque: bl, idx: esObj(x) && typeof x.idx === 'number' && x.idx >= 0 ? Math.floor(x.idx) : null } : null;
  }
  function normalizar(datos, ctx, comp) {
    try {
      if (!esObj(datos)) return null;
      var fuente = null, k, crudas = [];
      for (k = 0; k < K_MAZO.length && !fuente; k++) if (Array.isArray(datos[K_MAZO[k]]) && datos[K_MAZO[k]].length) fuente = datos[K_MAZO[k]];
      if (fuente) fuente.forEach(function (x, n) { var c = cartaDeCruda(x); if (c) { if (c.idx === null) c.idx = n; crudas.push(c); } });
      else if (Array.isArray(datos.terminos) && Array.isArray(datos.definiciones) && datos.terminos.length === datos.definiciones.length) {
        datos.terminos.forEach(function (t, n) { var c = cartaDeCruda([t, datos.definiciones[n]]); if (c) { c.idx = n; crudas.push(c); } });
      }
      if (!crudas.length || crudas.length > 200) return null;
      // idx únicos (si el esbozo trae repetidos, se vuelve al lugar de lectura)
      var vistos = {};
      crudas.forEach(function (c, n) { if (vistos[c.idx]) c.idx = n + 1000; vistos[c.idx] = 1; });
      // bloques, en orden de aparición
      var nombres = Array.isArray(datos.bloques) ? datos.bloques.map(str) : [], bl = [], mapa = {};
      crudas.forEach(function (c) {
        var b = c.bloque;
        if (b === '' || b === undefined) { c.bloque = ''; return; }
        var id = String(b);
        if (!mapa[id]) {
          var num = /^\d+$/.test(id) ? +id : null;
          mapa[id] = { id: id, nombre: (num !== null && nombres[num - 1]) ? nombres[num - 1] : (num !== null ? 'Bloque ' + num : id), n: 0 };
          bl.push(mapa[id]);
        }
        mapa[id].n++; c.bloque = id;
      });
      var mazo = crudas.map(function (c) { return { idx: c.idx, frente: c.frente, dorso: c.dorso, pista: c.pista, figura: c.figura, bloque: c.bloque }; });
      return { consigna: publica(datos.consigna) || publica(datos.instruccion), nota: publica(datos.nota) || publica(datos.aclaracion), mazo: mazo, bloques: bl.length > 1 ? bl : [] };
    } catch (e) { return null; }
  }
  /** Las cartas (normalizadas) de la ÚNICA tarjetas-componente de una lección, por si la pantalla "Repaso del día" necesita mostrar la carta {lección, idx}. */
  function cartasDeLeccion(lec) {
    var comps = arr(lec && lec.componentes).filter(function (c) { return c && c.tipo === 'tarjetas'; });
    var n = comps.length ? normalizar(JSON.parse(JSON.stringify(comps[0].datos === undefined ? null : comps[0].datos)), {}, comps[0]) : null;
    return n ? n.mazo : [];
  }
  function cartaDe(lec, idx) { var m = cartasDeLeccion(lec); for (var i = 0; i < m.length; i++) if (m[i].idx === idx) return m[i]; return null; }

  /* ================================================================== sesión (puro) */
  /**
   * Qué tarjetas toca ver: primero las VENCIDAS (las más atrasadas antes), después las NUEVAS (en el orden del mazo), hasta `max` (12). Las que tienen el repaso
   * para más adelante no entran. `registros` = { idx: {ef, n, due, last} } de esa lección; `hoy` = número de día (Store.diaDe).
   * → { cola:[idx], vencidas, nuevas, futuras, proxima: día del próximo repaso | null, resto: cuántas quedan sin entrar, alDia: bool }
   */
  function armarSesion(cartas, registros, hoy, o) {
    o = o || {};
    var max = o.max > 0 ? o.max : MAX_SESION, reg = registros || {};
    var lista = arr(cartas).filter(function (c) { return !o.bloque || c.bloque === o.bloque; });
    var venc = [], nuevas = [], fut = [];
    lista.forEach(function (c) {
      var r = reg[c.idx];
      if (!r) nuevas.push(c); else if (r.due <= hoy) venc.push({ c: c, due: r.due }); else fut.push({ c: c, due: r.due });
    });
    venc.sort(function (a, b) { return (a.due - b.due) || (a.c.idx - b.c.idx); });
    fut.sort(function (a, b) { return (a.due - b.due) || (a.c.idx - b.c.idx); });
    var todas = venc.map(function (x) { return x.c.idx; }).concat(nuevas.map(function (c) { return c.idx; }));
    return { cola: todas.slice(0, max), vencidas: venc.length, nuevas: nuevas.length, futuras: fut.length, proxima: fut.length ? fut[0].due : null, resto: Math.max(0, todas.length - max), alDia: todas.length === 0 && lista.length > 0 };
  }
  /**
   * La cola de una sesión. calificar('sabia'|'medio'|'nosabia') saca la tarjeta de adelante; "No la sabía" vuelve UNA vez al final. Sólo la PRIMERA calificación de cada
   * tarjeta cuenta para el repaso espaciado (`persistir`): volver a verla en la misma sesión no la castiga dos veces.
   */
  function crearSesion(idxs, opts) {
    var cola = arr(idxs).slice(), total = cola.length, primera = {}, repetida = {}, orden = cola.slice(), guardar = !(opts && opts.repaso);
    return {
      total: total,
      repaso: !guardar,
      orden: function () { return orden.slice(); },
      actual: function () { return cola.length ? cola[0] : null; },
      quedan: function () { return cola.length; },
      esRepeticion: function () { return cola.length > 0 && primera[cola[0]] !== undefined; },
      vistas: function () { return Object.keys(primera).length; },
      calificar: function (calidad) {
        if (!cola.length) return null;
        var idx = cola.shift(), primeraVez = primera[idx] === undefined, persistir = guardar && primeraVez, reencolada = false;
        if (primeraVez) primera[idx] = calidad;
        if (calidad === 'nosabia' && !repetida[idx]) { repetida[idx] = true; cola.push(idx); reencolada = true; }
        return { idx: idx, persistir: persistir, reencolada: reencolada };
      },
      resultados: function () { var o = {}; for (var k in primera) o[k] = primera[k]; return o; },
      cuenta: function () { var c = { sabia: 0, medio: 0, nosabia: 0 }; for (var k in primera) c[primera[k]]++; return c; },
      terminada: function () { return cola.length === 0; }
    };
  }
  /** "mañana" · "en 6 días" · "en 2 semanas" · "en 3 meses" para los botones de calificar. */
  function etiquetaIntervalo(d) {
    d = Math.round(+d || 0);
    if (d <= 1) return 'mañana';
    if (d < 14) return 'en ' + d + ' días';
    if (d < 60) return 'en ' + Math.round(d / 7) + ' semanas';
    return 'en ' + Math.round(d / 30) + ' meses';
  }

  /* ================================================================== render */
  var CAL = [
    { id: 'sabia', tecla: '1', label: 'La sabía', icono: 'check', clase: 'ok' },
    { id: 'medio', tecla: '2', label: 'Más o menos', icono: 'swap', clase: 'mid' },
    { id: 'nosabia', tecla: '3', label: 'No la sabía', icono: 'close', clase: 'no' }
  ];
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, K = ctx.Kit, B = ES.bloques, St = ES.store, reducido = !!ctx.reducedMotion;
    var S = ctx.store && isFn(ctx.store.tarjetaRepasar) ? ctx.store : null;
    var lecId = ctx.leccion && ctx.leccion.id || '';
    var ahora = isFn(ctx.ahora) ? ctx.ahora : function () { return Date.now(); };
    var cartas = datos.mazo, porIdx = {}; cartas.forEach(function (c) { porIdx[c.idx] = c; });
    var bdeps = { glosario: function (t, d) { if (isFn(ctx.glosario)) ctx.glosario(t, d); }, termino: function () { return null; } };
    var offFig = null;
    var sesion = null, info = null, bloque = '', volteada = false, pistaVista = false, hecha = !!ctx.hecho, primeraVez = true, sesiones = 0;
    var conLobby = cartas.length > 6 || datos.bloques.length > 1 || (S && Object.keys(S.tarjetasDeLeccion(lecId)).length > 0);

    var elTop = h('div', { 'class': 'es-tar-top' });
    var elStage = h('div', { 'class': 'es-tar-stage' });
    var elAcc = h('div', { 'class': 'es-tar-acc' });
    var elLive = h('p', { 'class': 'sr-only', 'aria-live': 'polite', role: 'status' });
    var box = h('div', { 'class': 'es-tar' + (reducido ? ' is-rm' : '') }, h('p', { 'class': 'es-note es-tar-hint', text: datos.consigna || 'Leé la pregunta y pensá la respuesta antes de dar vuelta la tarjeta. Después contá con honestidad cuánto la sabías: las que cuestan vuelven antes.' }), elTop, elStage, elAcc, elLive);
    host.appendChild(box);

    function hoy() { return St && isFn(St.diaDe) ? St.diaDe(ahora()) : 0; }
    function registros() { return S ? S.tarjetasDeLeccion(lecId) : {}; }
    function inline(t) { var f = document.createDocumentFragment(); if (B && isFn(B.inline)) f.appendChild(B.inline(K, t, bdeps)); else f.appendChild(document.createTextNode(plano(t))); return f; }
    function vaciar(e) { while (e.firstChild) e.removeChild(e.firstChild); }
    function anunciar(t) { elLive.textContent = ''; setTimeout(function () { elLive.textContent = t; }, 30); }

    /* ---------------------------------------------------------- figura de una carta */
    function figuraEl(id) {
      var Fig = ES.figuras;
      if (C150.Icons && isFn(C150.Icons.has) && C150.Icons.has(id)) return h('span', { 'class': 'es-tar-ico', 'aria-hidden': 'true' }, icon(id));
      var f = Fig && isFn(Fig.has) && Fig.has(id) ? Fig.get(id) : null;
      if (!f || !isFn(Fig.seguro)) return null;
      var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', f.viewBox); svg.setAttribute('class', 'dg-svg es-tar-fig'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      f.capas.filter(function (c) { return c.visible !== false; }).forEach(function (c) { svg.appendChild(Fig.seguro(c.svg)); });
      // las etiquetas del dibujo no bajan de 11 px en pantalla (el CSS usa --dg-s: píxeles de pantalla por unidad del dibujo); se corta la observación al cambiar de carta
      var U = ES.modelos && ES.modelos.util;
      if (offFig) { offFig(); offFig = null; }
      if (U && isFn(U.escalarEtiquetas)) offFig = U.escalarEtiquetas(svg);
      return svg;
    }

    /* ---------------------------------------------------------- portada de la sesión */
    function pintarLobby() {
      volteada = false; sesion = null;
      info = armarSesion(cartas, registros(), hoy(), { bloque: bloque, max: MAX_SESION });
      vaciar(elTop); vaciar(elStage); vaciar(elAcc);
      var panel = h('div', { 'class': 'es-tar-lobby' });
      var nSes = info.cola.length;
      panel.appendChild(h('p', { 'class': 'es-meta', text: nSes ? 'Tu sesión de hoy' : 'Mazo al día' }));
      panel.appendChild(h('p', { 'class': 'es-tar-big', 'aria-label': nSes + (nSes === 1 ? ' tarjeta' : ' tarjetas') }, h('b', { 'aria-hidden': 'true', text: String(nSes || cartas.filter(function (c) { return !bloque || c.bloque === bloque; }).length) }), h('span', { 'aria-hidden': 'true', text: nSes ? (nSes === 1 ? 'tarjeta' : 'tarjetas') : 'en el mazo' })));
      var partes = [];
      if (info.vencidas) partes.push(info.vencidas + (info.vencidas === 1 ? ' toca repasar' : ' tocan repasar'));
      if (info.nuevas) partes.push(info.nuevas + (info.nuevas === 1 ? ' nueva' : ' nuevas'));
      if (info.futuras) partes.push(info.futuras + ' para más adelante');
      if (partes.length) panel.appendChild(h('p', { 'class': 'es-tar-desg', text: partes.join(' · ') }));
      if (info.resto) panel.appendChild(h('p', { 'class': 'es-note', text: 'Hoy vemos ' + nSes + ' y quedan ' + info.resto + ' para la próxima sesión: así se aprende mejor que de un tirón.' }));
      if (info.alDia && info.proxima !== null) panel.appendChild(h('p', { 'class': 'es-note', text: 'Estás al día. La próxima tarjeta vuelve ' + etiquetaIntervalo(info.proxima - hoy()) + '. Si querés, podés repasar igual.' }));
      if (datos.bloques.length > 1) {
        var grp = h('div', { 'class': 'es-tar-bloques', role: 'group', 'aria-label': 'Elegí qué repasar' });
        [{ id: '', nombre: 'Todo el mazo', n: cartas.length }].concat(datos.bloques).forEach(function (b) {
          grp.appendChild(h('button', { type: 'button', 'class': 'es-tar-bl' + (bloque === b.id ? ' is-on' : ''), 'aria-pressed': bloque === b.id ? 'true' : 'false', onclick: function () { bloque = b.id; pintarLobby(); var e = elStage.querySelector('.es-tar-bl[aria-pressed="true"]'); if (e) e.focus({ preventScroll: true }); } },
            h('span', { text: b.nombre }), h('small', { text: String(b.n) })));
        });
        panel.appendChild(grp);
      }
      elStage.appendChild(panel);
      if (nSes) elAcc.appendChild(K.button({ label: 'Empezar', variant: 'primary', iconRight: 'arrow-right', onClick: function () { empezar(info.cola); } }));
      else elAcc.appendChild(K.button({ label: 'Repasar igual', variant: 'primary', iconRight: 'arrow-right', onClick: function () { empezar(cartas.filter(function (c) { return !bloque || c.bloque === bloque; }).slice(0, MAX_SESION).map(function (c) { return c.idx; })); } }));
    }
    function empezar(idxs) {
      sesion = crearSesion(idxs); sesiones++; volteada = false; pistaVista = false;
      pintarCarta();
    }

    /* ---------------------------------------------------------- la carta */
    function marcador() {
      vaciar(elTop);
      var n = sesion.total, vistas = sesion.vistas(), res = sesion.resultados(), cur = sesion.actual();
      var num = Math.min(n, vistas + (sesion.esRepeticion() ? 0 : 1));
      elTop.appendChild(h('p', { 'class': 'es-meta es-tar-count', 'aria-live': 'polite' }, document.createTextNode(('Tarjeta ' + num + ' de ' + n).toUpperCase()), sesion.esRepeticion() ? h('span', { 'class': 'es-tar-rep', text: 'otra vuelta' }) : null, sesion.repaso ? h('span', { 'class': 'es-tar-rep es-tar-rep--info', text: 'repaso: no cambia cuándo vuelven' }) : null));
      var bar = h('div', { 'class': 'es-tar-bar', role: 'img', 'aria-label': vistas + ' de ' + n + ' tarjetas calificadas' });
      sesion.orden().forEach(function (idx) {
        var r = res[idx];
        bar.appendChild(h('i', { 'class': 'es-tar-tick' + (r ? ' is-' + (r === 'sabia' ? 'ok' : r === 'medio' ? 'mid' : 'no') : '') + (idx === cur && !r ? ' is-cur' : '') }));
      });
      elTop.appendChild(bar);
    }
    function pintarCarta() {
      var idx = sesion.actual();
      if (idx === null) { pintarResumen(); return; }
      var c = porIdx[idx];
      marcador();
      vaciar(elStage); vaciar(elAcc);
      var fig = c.figura ? figuraEl(c.figura) : null;
      var corto = plano(c.dorso).length <= 38;
      var pistaBtn = c.pista ? h('button', { type: 'button', 'class': 'es-tar-pista', 'aria-expanded': pistaVista ? 'true' : 'false', onclick: function (ev) { ev.stopPropagation(); pistaVista = true; pintarCarta(); var b = elAcc.querySelector('.btn'); if (b) b.focus({ preventScroll: true }); } }, icon('bulb'), h('span', { text: 'Pista' })) : null;
      var frente = h('div', { 'class': 'es-tar-face es-tar-face--f', 'aria-hidden': volteada ? 'true' : null },
        h('p', { 'class': 'es-tar-k' }, h('span', { text: 'Pregunta' }), c.bloque && datos.bloques.length ? h('span', { 'class': 'es-tar-tag', text: nombreBloque(c.bloque) }) : null),
        fig,
        h('p', { 'class': 'es-tar-t' }, inline(c.frente)),
        pistaBtn && !pistaVista ? pistaBtn : null,
        c.pista && pistaVista ? h('p', { 'class': 'es-tar-pista-t' }, icon('bulb'), h('span', null, h('b', { text: 'Pista: ' }), inline(c.pista))) : null);
      var dorso = h('div', { 'class': 'es-tar-face es-tar-face--b', 'aria-hidden': volteada ? null : 'true' },
        h('p', { 'class': 'es-tar-k' }, h('span', { text: 'Respuesta' })),
        h('p', { 'class': 'es-tar-t es-tar-t--b' + (corto ? ' es-tar-t--short' : '') }, inline(c.dorso)));
      if (volteada) frente.setAttribute('inert', ''); else dorso.setAttribute('inert', '');
      var card = h('div', { 'class': 'es-tar-card' + (volteada ? ' is-flip' : ''), onclick: function (ev) { if (ev.target.closest && ev.target.closest('button')) return; if (!volteada) voltear(); } },
        h('div', { 'class': 'es-tar-in' }, frente, dorso));
      elStage.appendChild(card);
      pintarAcciones(c);
    }
    function nombreBloque(id) { for (var i = 0; i < datos.bloques.length; i++) if (datos.bloques[i].id === id) return datos.bloques[i].nombre; return id; }
    function pintarAcciones(c) {
      vaciar(elAcc);
      if (!volteada) {
        elAcc.appendChild(K.button({ label: 'Dar vuelta', variant: 'primary', icon: 'swap', onClick: voltear }));
        return;
      }
      var rec = S ? S.tarjeta(lecId, c.idx) : null, h0 = hoy();
      var grp = h('div', { 'class': 'es-tar-rates', role: 'group', 'aria-label': '¿Cuánto la sabías?' });
      CAL.forEach(function (q) {
        var cuando = St && isFn(St.sm2) ? etiquetaIntervalo(St.sm2(rec, q.id, h0).due - h0) : '';
        if (cuando && q.id === 'nosabia' && !sesion.esRepeticion()) cuando = 'hoy y ' + cuando;      // vuelve una vez al final de esta misma sesión
        grp.appendChild(h('button', { type: 'button', 'class': 'es-tar-r es-tar-r--' + q.clase, 'data-q': q.id, 'aria-keyshortcuts': q.tecla, onclick: function () { calificar(q.id); } },
          h('span', { 'class': 'es-tar-r-i', 'aria-hidden': 'true' }, icon(q.icono)),
          h('span', { 'class': 'es-tar-r-t' }, h('b', { text: q.label }), cuando ? h('small', { text: 'Vuelve ' + cuando }) : null),
          h('span', { 'class': 'es-tar-r-k', 'aria-hidden': 'true', text: q.tecla })));
      });
      elAcc.appendChild(h('p', { 'class': 'es-meta es-tar-ask', text: '¿Cuánto la sabías?' }));
      elAcc.appendChild(grp);
    }
    function voltear() {
      if (volteada || !sesion || sesion.actual() === null) return;
      volteada = true;
      var c = porIdx[sesion.actual()], card = elStage.querySelector('.es-tar-card');
      if (card) {
        card.classList.add('is-flip');
        var f = card.querySelector('.es-tar-face--f'), d = card.querySelector('.es-tar-face--b');
        if (f) { f.setAttribute('aria-hidden', 'true'); f.setAttribute('inert', ''); }
        if (d) { d.removeAttribute('aria-hidden'); d.removeAttribute('inert'); }
      }
      pintarAcciones(c);
      anunciar('Respuesta: ' + plano(c.dorso));
      var b = elAcc.querySelector('.es-tar-r'); if (b) b.focus({ preventScroll: true });
    }
    function calificar(q) {
      if (!volteada || !sesion) return;
      var r = sesion.calificar(q);
      if (!r) return;
      if (r.persistir && S) S.tarjetaRepasar(lecId, r.idx, q);
      volteada = false; pistaVista = false;
      if (sesion.terminada()) { pintarResumen(); return; }
      pintarCarta();
      var b = elAcc.querySelector('.btn'); if (b) b.focus({ preventScroll: true });
      anunciar(r.reencolada ? 'Esa tarjeta vuelve al final de la sesión.' : 'Siguiente tarjeta.');
    }

    /* ---------------------------------------------------------- resumen */
    function pintarResumen() {
      vaciar(elTop); vaciar(elStage); vaciar(elAcc);
      var cu = sesion.cuenta(), n = sesion.total, res = sesion.resultados();
      if (!hecha || primeraVez) { hecha = true; if (isFn(ctx.done)) ctx.done(); }
      primeraVez = false;
      var dueMin = null;
      if (S) Object.keys(res).forEach(function (k) { var r = S.tarjeta(lecId, +k); if (r && (dueMin === null || r.due < dueMin)) dueMin = r.due; });
      var otras = armarSesion(cartas, registros(), hoy(), { bloque: bloque, max: MAX_SESION + Object.keys(res).length });
      otras.cola = otras.cola.filter(function (i) { return res[i] === undefined; }).slice(0, MAX_SESION);      // las que ya viste hoy no vuelven a entrar (aunque el repaso no se guarde)
      var panel = h('div', { 'class': 'es-tar-sum', role: 'status' });
      panel.appendChild(h('p', { 'class': 'es-meta', text: 'Sesión terminada' }));
      panel.appendChild(h('p', { 'class': 'es-tar-sum-t', text: cu.nosabia === 0 && cu.medio === 0 ? '¡Las sabías todas!' : cu.sabia >= n * 0.7 ? '¡Muy bien!' : 'Buen repaso.' }));
      var stats = h('ul', { 'class': 'es-tar-stats' });
      CAL.forEach(function (q) { stats.appendChild(h('li', { 'class': 'es-tar-st es-tar-st--' + q.clase }, h('b', { text: String(cu[q.id]) }), h('span', null, icon(q.icono), document.createTextNode(q.label)))); });
      panel.appendChild(stats);
      if (S && dueMin !== null) panel.appendChild(h('p', { 'class': 'es-tar-desg', text: 'La primera vuelve ' + etiquetaIntervalo(dueMin - hoy()) + '. Las que costaron aparecen antes.' }));
      else if (!S) panel.appendChild(h('p', { 'class': 'es-note', text: 'Esto es una prueba: acá no se guarda tu repaso.' }));
      elStage.appendChild(panel);
      var malas = Object.keys(res).filter(function (k) { return res[k] === 'nosabia'; }).map(Number);
      if (malas.length) elAcc.appendChild(K.button({ label: malas.length === 1 ? 'Repasar la que no sabía' : 'Repasar las ' + malas.length + ' que no sabía', variant: 'primary', icon: 'reset', onClick: function () { volteada = false; sesion = crearSesion(malas, { repaso: true }); sesiones++; pintarCarta(); var b = elAcc.querySelector('.btn'); if (b) b.focus({ preventScroll: true }); } }));
      if (otras.cola.length) elAcc.appendChild(K.button({ label: 'Seguir con ' + otras.cola.length + (otras.cola.length === 1 ? ' tarjeta más' : ' tarjetas más'), variant: malas.length ? 'ghost' : 'primary', iconRight: 'arrow-right', onClick: function () { info = otras; empezar(otras.cola); var b = elAcc.querySelector('.btn'); if (b) b.focus({ preventScroll: true }); } }));
      elAcc.appendChild(K.button({ label: 'Volver al mazo', variant: 'ghost', icon: 'list', onClick: function () { pintarLobby(); var b = elAcc.querySelector('.btn'); if (b) b.focus({ preventScroll: true }); } }));
      panel.setAttribute('tabindex', '-1'); panel.focus({ preventScroll: true });
    }

    /* ---------------------------------------------------------- teclado: 1 / 2 / 3 */
    box.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || !volteada || !sesion) return;
      var t = ev.target;
      if (t && t.closest && t.closest('input, textarea, select')) return;
      var q = ev.key === '1' ? 'sabia' : ev.key === '2' ? 'medio' : ev.key === '3' ? 'nosabia' : null;
      if (q) { ev.preventDefault(); calificar(q); }
    });

    if (datos.nota) box.appendChild(h('p', { 'class': 'es-note', text: datos.nota }));
    if (conLobby) pintarLobby();
    else { info = armarSesion(cartas, registros(), hoy(), { max: MAX_SESION }); empezar(info.cola.length ? info.cola : cartas.map(function (c) { return c.idx; })); }
    return {
      destroy: function () { if (offFig) { offFig(); offFig = null; } },
      getState: function () { return { total: cartas.length, sesion: sesion ? { total: sesion.total, quedan: sesion.quedan(), resultados: sesion.resultados() } : null, volteada: volteada }; }
    };
  }

  Mot.register('tarjetas', { normalizar: normalizar, render: render });
  ES.tarjetas = { normalizar: normalizar, armarSesion: armarSesion, crearSesion: crearSesion, etiquetaIntervalo: etiquetaIntervalo, cartaDe: cartaDe, cartasDeLeccion: cartasDeLeccion, MAX_SESION: MAX_SESION };
})(root.C150);
