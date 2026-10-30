var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-ordenar.js — componente `ordenar` (ORD): poner pasos en orden (checklists, procedimientos, secuencias de una fase del vuelo). Contrato v7 pasada 2.
 * Se puede ARRASTRAR un paso (ratón, lápiz o dedo con una pulsación larga), TOCARLO y después tocar el lugar donde va, usar los botones ▲ ▼ de cada fila
 * o el teclado: Enter agarra el paso, ↑ ↓ lo mueven (Inicio / Fin lo llevan al extremo), Enter lo suelta, Esc cancela. Cada movimiento se anuncia para lectores de pantalla.
 * "Comprobar" marca cada paso (bien ubicado / fuera de lugar, con ícono y texto: nunca sólo con el color) y, desde el segundo intento, muestra la pista de los que
 * siguen mal. Siempre hay "Mezclar de nuevo" y, tras el primer fallo, "Ver la respuesta": nadie se queda trabado.
 * Nota (ctx.score): los pasos que ya estaban en su lugar relativo en la PRIMERA comprobación (crédito parcial); si después lo resolvés sin mirar la respuesta, los que
 * faltaban suman la mitad. Los pasos que quedaron fuera de lugar entran al mazo de repaso. Al resolver o ver la respuesta: ctx.done().
 *
 * ESQUEMA DE `datos` (canónico; `items` YA VIENEN en el orden correcto y el componente los baraja con semilla estable):
 *   { consigna?:'texto', items:[{id, texto, icono?, explicacion?}],      2 a 16 pasos; icono = nombre de src/icons.js
 *     inicio?:'Primero', fin?:'Último',                                  los rótulos de los dos extremos de la lista
 *     nota?:'texto' }
 * normalizar entiende los esbozos del plan: la lista puede llamarse items / pasos / elementos / secuencia / etapas / fases / acciones / cargos, con textos sueltos o
 * {id, texto|nombre|paso|titulo|etiqueta, icono, explicacion|porque|motivo}; el orden correcto sale de `orden` (ids, textos, o posiciones 0-based / 1-based), de una
 * `posicion` por paso, o —si no hay ninguna de las dos— del orden en que están escritos (como `pasos`, o un `orden` con los textos y nada más). `explicaciones` puede ser {id: texto} o una lista paralela.
 * Un `orden` que no resuelve (ids que no existen) → null: más vale la reserva que una clave equivocada. Handle: destroy · getState.
 *
 * Parte pura (ES.ordenar, probada en Node): normalizar · evaluar(actual, correcto) → {enSitio[], correctos, exactos, total, completo} · mover(orden, id, aIndice) · barajar(ids, correcto, semilla)
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
  function slug(t) { t = String(t === undefined || t === null ? '' : t); if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  /** Una nota "a confirmar" o de errata es del plan (para el instructor), no de la lección: no se publica. */
  function publica(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }
  var uid = 0;
  function icono(n) { n = str(n); return n && (!C150.Icons || !isFn(C150.Icons.has) || C150.Icons.has(n)) ? n : ''; }

  /* ================================================================== lógica pura */
  /**
   * Compara el orden actual con el correcto. Un paso está "en su lugar" si pertenece a la MAYOR cadena de pasos que ya están en el orden relativo correcto
   * (la subsucesión creciente más larga): así, si sólo movés un paso de lugar, el resto sigue en verde en vez de ponerse todo en rojo por haberse corrido un casillero.
   * Si hay varias cadenas igual de largas, gana la que tiene más pasos en su casillero exacto.
   */
  function evaluar(actual, correcto) {
    actual = arr(actual); correcto = arr(correcto);
    var n = actual.length, pos = {}, i, j;
    correcto.forEach(function (id, k) { pos[id] = k; });
    var seq = actual.map(function (id) { return pos[id] === undefined ? -1 : pos[id]; });
    var len = [], fijos = [], prev = [];
    for (i = 0; i < n; i++) {
      len[i] = seq[i] < 0 ? 0 : 1; fijos[i] = seq[i] === i ? 1 : 0; prev[i] = -1;
      if (seq[i] < 0) continue;
      for (j = 0; j < i; j++) {
        if (seq[j] < 0 || seq[j] >= seq[i]) continue;
        var l = len[j] + 1, f = fijos[j] + (seq[i] === i ? 1 : 0);
        if (l > len[i] || (l === len[i] && f > fijos[i])) { len[i] = l; fijos[i] = f; prev[i] = j; }
      }
    }
    var mejor = -1;
    for (i = 0; i < n; i++) if (len[i] > 0 && (mejor < 0 || len[i] > len[mejor] || (len[i] === len[mejor] && fijos[i] > fijos[mejor]))) mejor = i;
    var enSitio = actual.map(function () { return false; });
    for (i = mejor; i >= 0; i = prev[i]) enSitio[i] = true;
    var exactos = 0;
    seq.forEach(function (p, k) { if (p === k) exactos++; });
    var correctos = enSitio.filter(Boolean).length;
    return { enSitio: enSitio, correctos: correctos, exactos: exactos, total: correcto.length, completo: n === correcto.length && n > 0 && exactos === n };
  }
  /** Copia de `orden` con el paso `id` llevado al casillero `aIndice` (el resto se corre). Un índice fuera de rango se acota. */
  function mover(orden, id, aIndice) {
    var o = arr(orden).slice(), i = o.indexOf(id);
    if (i < 0) return o;
    o.splice(i, 1);
    var k = Math.max(0, Math.min(o.length, Math.floor(+aIndice || 0)));
    o.splice(k, 0, id);
    return o;
  }
  /** Una mezcla del orden correcto con semilla estable, que nunca queda igual al correcto (si hay 2 o más). */
  function barajar(ids, correcto, semilla) {
    var A = ES.arrastre, base = arr(ids).slice();
    function mez(s) { return A && isFn(A.mezclar) ? A.mezclar(base, s) : base.slice().reverse(); }
    var o = mez(semilla), k = 0, bien = JSON.stringify(arr(correcto)), al = JSON.stringify(arr(correcto).slice().reverse());
    // ni igual al orden correcto ni exactamente al revés (con 3 o más pasos darlo vuelta sería demasiado fácil)
    function malo(x) { var j = JSON.stringify(x); return j === bien || (base.length > 2 && j === al); }
    while (base.length > 1 && k < 8 && malo(o)) { k++; o = mez(semilla + '|' + k); }
    if (base.length > 1 && JSON.stringify(o) === bien) o = o.slice(1).concat(o.slice(0, 1));
    return o;
  }

  /* ================================================================== normalizar (puro) */
  var CLAVES_ITEM = ['items', 'pasos', 'elementos', 'secuencia', 'etapas', 'fases', 'acciones', 'cargos', 'lista', 'tarjetas'];
  var CLAVES_TEXTO = ['texto', 'nombre', 'paso', 'titulo', 'etiqueta', 'frase', 'descripcion', 'item', 'accion', 'cargo'];
  var CLAVES_EXPL = ['explicacion', 'porque', 'motivo', 'razon', 'detalle', 'pista'];
  var CLAVES_POS = ['posicion', 'pos', 'n', 'numero', 'lugar'];

  function crudoDe(x) {
    if (typeof x === 'string' || (typeof x === 'number' && isFinite(x))) { var t = str(x); return t ? { id: '', texto: t, icono: '', explicacion: '', pos: null } : null; }
    if (!esObj(x)) return null;
    var i, texto = '', ex = '', pos = null;
    for (i = 0; i < CLAVES_TEXTO.length && !texto; i++) texto = str(x[CLAVES_TEXTO[i]]);
    for (i = 0; i < CLAVES_EXPL.length && !ex; i++) ex = publica(x[CLAVES_EXPL[i]]);
    for (i = 0; i < CLAVES_POS.length && pos === null; i++) if (typeof x[CLAVES_POS[i]] === 'number' && isFinite(x[CLAVES_POS[i]])) pos = x[CLAVES_POS[i]];
    return texto ? { id: str(x.id), texto: texto, icono: icono(x.icono || x.icon || x.ico), explicacion: ex, pos: pos } : null;
  }
  /** Busca un paso por id, por texto o (si es número) por posición; devuelve su índice en la lista o -1. */
  function buscar(raw, crudos, base) {
    var k;
    if (typeof raw === 'number' && isFinite(raw)) { var i = base === 1 ? raw - 1 : raw; return crudos[i] ? i : -1; }
    var t = str(raw);
    if (!t) return -1;
    for (k = 0; k < crudos.length; k++) if (crudos[k].id === t) return k;
    var s = slug(t);
    for (k = 0; k < crudos.length; k++) if (slug(crudos[k].id) === s || slug(crudos[k].texto) === s) return k;
    return -1;
  }

  function normalizar(datos, ctx, comp) {
    try {
      if (!esObj(datos)) return null;
      var fuente = null, k, i;
      for (k = 0; k < CLAVES_ITEM.length && !fuente; k++) if (Array.isArray(datos[CLAVES_ITEM[k]]) && datos[CLAVES_ITEM[k]].length) fuente = datos[CLAVES_ITEM[k]];
      // esbozo del plan: sólo `orden`, con los pasos escritos en el orden correcto
      if (!fuente && Array.isArray(datos.orden) && datos.orden.length >= 2 && datos.orden.every(function (x) { return typeof x === 'string'; })) fuente = datos.orden;
      var crudos = arr(fuente).map(crudoDe).filter(Boolean);
      if (crudos.length < 2 || crudos.length > 16) return null;
      // ids únicos y estables
      var usados = {};
      crudos.forEach(function (c, n) {
        var id = c.id || ('p' + (n + 1));
        while (usados[id]) id += '_';
        usados[id] = 1; c.id = id;
      });
      // las explicaciones sueltas: {id: texto} o una lista paralela a los pasos tal como están escritos
      var ex = datos.explicaciones || datos.porques || datos.motivos;
      if (esObj(ex)) crudos.forEach(function (c) {
        if (c.explicacion) return;
        var kk = Object.keys(ex).filter(function (q) { return q === c.id || slug(q) === slug(c.id) || slug(q) === slug(c.texto); })[0];
        if (kk !== undefined) c.explicacion = publica(ex[kk]);
      });
      else if (Array.isArray(ex) && ex.length === crudos.length) crudos.forEach(function (c, n) { if (!c.explicacion) c.explicacion = publica(ex[n]); });
      // el orden correcto
      var orden = [];
      var rawOrden = (fuente === datos.orden) ? null : Array.isArray(datos.orden) ? datos.orden : (Array.isArray(datos.ordenCorrecto) ? datos.ordenCorrecto : (Array.isArray(datos.solucion) ? datos.solucion : null));
      if (rawOrden) {
        var nums = rawOrden.filter(function (v) { return typeof v === 'number'; });
        var base = nums.length && Math.min.apply(null, nums) >= 1 && Math.max.apply(null, nums) <= crudos.length ? 1 : 0;
        var vistos = {};
        rawOrden.forEach(function (r) { var j = buscar(r, crudos, base); if (j >= 0 && !vistos[j]) { vistos[j] = 1; orden.push(j); } });
        if (orden.length < 2) return null;
      } else if (crudos.every(function (c) { return c.pos !== null; }) && new Set(crudos.map(function (c) { return c.pos; })).size === crudos.length) {
        orden = crudos.map(function (c, n) { return n; }).sort(function (a, b) { return crudos[a].pos - crudos[b].pos; });
      } else orden = crudos.map(function (c, n) { return n; });
      var ext = Array.isArray(datos.extremos) ? datos.extremos : (Array.isArray(datos.etiquetas) && datos.etiquetas.length === 2 ? datos.etiquetas : []);
      var items = orden.map(function (j) { var c = crudos[j]; return { id: c.id, texto: c.texto, icono: c.icono, explicacion: c.explicacion }; });
      return {
        consigna: publica(datos.consigna) || publica(datos.pregunta) || publica(datos.instruccion),
        items: items,
        inicio: publica(datos.inicio) || publica(ext[0]), fin: publica(datos.fin) || publica(ext[1]),
        nota: publica(datos.nota) || publica(datos.aclaracion)
      };
    } catch (e) { return null; }
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, reducido = !!ctx.reducedMotion, Arr = ES.arrastre, K = ctx.Kit;
    var items = datos.items, n = items.length;
    var correcto = items.map(function (x) { return x.id; });
    var porId = {}; items.forEach(function (x, i) { porId[x.id] = x; x.k = i; });
    var semilla = (ctx.leccion && ctx.leccion.id || '') + '|' + (ctx.key || '') + '|ord';
    var ronda = 0, orden = barajar(correcto, correcto, semilla);
    var estado = 'jugando';            // jugando | resuelto | revelado
    var grabado = null, antes = null, marcas = null, intentos = 0, ok1 = null, puntuado = false, esRetry = !!ctx.hecho, revelo = false, arrastres = [], ultimaY = null;
    var ini = datos.inicio || 'Primero', fin = datos.fin || 'Último';

    var elHint = h('p', { 'class': 'es-note es-ord-hint', text: datos.consigna || 'Poné los pasos en el orden correcto.' });
    var elKeys = h('p', { 'class': 'es-note es-ord-keys', id: 'es-ord-k-' + (++uid),
      text: 'Arrastrá un paso, o tocalo y después tocá el lugar donde va. Con teclado: Enter para agarrarlo, ↑ ↓ para moverlo y Enter para soltarlo.' });
    var elCount = h('p', { 'class': 'es-meta es-ord-count' });
    var elList = h('ol', { 'class': 'es-ord-list', 'aria-label': 'Pasos para ordenar' });
    var elIni = h('p', { 'class': 'es-ord-end es-ord-end--ini', 'aria-hidden': 'true' }, icon('chevron-up'), h('span', { text: ini }));
    var elFin = h('p', { 'class': 'es-ord-end es-ord-end--fin', 'aria-hidden': 'true' }, icon('chevron-down'), h('span', { text: fin }));
    var elFb = h('div', { 'class': 'feedback qz-fb es-ord-fb', role: 'status', 'aria-live': 'polite', hidden: true });
    var elAnuncio = h('p', { 'class': 'sr-only', 'aria-live': 'polite', role: 'status' });
    var elAcc = h('div', { 'class': 'btn-row es-ord-acc' });
    var box = h('div', { 'class': 'es-ord' + (reducido ? ' is-rm' : '') }, elHint, elKeys, elCount, h('div', { 'class': 'es-ord-wrap' }, elIni, elList, elFin), elFb, elAcc, elAnuncio);
    host.appendChild(box);

    function anunciar(t) { elAnuncio.textContent = ''; setTimeout(function () { elAnuncio.textContent = t; }, 30); }
    function decir(tono, titulo, texto) {
      while (elFb.firstChild) elFb.removeChild(elFb.firstChild);
      elFb.className = 'feedback qz-fb es-ord-fb ' + (tono === 'ok' ? 'feedback--ok' : tono === 'bad' ? 'feedback--bad' : '');
      elFb.hidden = false;
      elFb.appendChild(h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(tono === 'ok' ? 'check' : tono === 'bad' ? 'bulb' : 'info')));
      elFb.appendChild(h('div', { 'class': 'qz-fb-b' }, h('strong', { text: titulo }), texto ? h('span', { text: texto }) : null));
    }
    function refDe(x) { var S = ES.store; return isFn(S && S.hashTexto) ? S.hashTexto(x.texto).slice(0, 6) : String(x.k); }

    /* ---------------------------------------------------------- movimientos */
    function filaDe(id) { for (var i = 0; i < elList.children.length; i++) if (elList.children[i].getAttribute('data-id') === id) return elList.children[i]; return null; }
    function foco(id, cual) {
      var f = filaDe(id); if (!f) return;
      var e = (cual && f.querySelector('.es-ord-b[data-mv="' + cual + '"]')) || f.querySelector('.es-ord-it');
      if (e && isFn(e.focus)) e.focus({ preventScroll: true });
    }
    function cambio(nuevo, id, cual) {
      if (JSON.stringify(nuevo) === JSON.stringify(orden)) return false;
      orden = nuevo; marcas = null; elFb.hidden = true;
      pintar(true);
      if (id) { foco(id, cual); anunciar('«' + porId[id].texto + '»: lugar ' + (orden.indexOf(id) + 1) + ' de ' + n + '.'); }
      return true;
    }
    function moverPaso(id, d, cual) {
      var i = orden.indexOf(id), j = i + d;
      if (i < 0 || j < 0 || j >= n) { foco(id, cual); return; }
      cambio(mover(orden, id, j), id, cual);
    }
    function agarrar(id) {
      grabado = id; antes = orden.slice();
      pintar(false); foco(id);
      anunciar('Agarraste «' + porId[id].texto + '». Está en el lugar ' + (orden.indexOf(id) + 1) + ' de ' + n + '. Usá ↑ ↓ para moverlo y Enter para soltarlo.');
    }
    function soltar(cancelar) {
      var id = grabado; grabado = null;
      if (cancelar && antes) { orden = antes.slice(); marcas = null; }
      antes = null;
      pintar(false); if (id) foco(id);
      if (id) anunciar(cancelar ? 'Cancelado: «' + porId[id].texto + '» volvió a su lugar.' : 'Soltaste «' + porId[id].texto + '» en el lugar ' + (orden.indexOf(id) + 1) + ' de ' + n + '.');
    }
    function alClic(id) {
      if (estado !== 'jugando') return;
      if (grabado === null) agarrar(id);
      else if (grabado === id) soltar(false);
      else { var g = grabado; grabado = null; antes = null; if (!cambio(mover(orden, g, orden.indexOf(id)), g, null)) { pintar(false); foco(g); } }
    }

    /* ---------------------------------------------------------- dibujo */
    function fila(id, i) {
      var it = porId[id], jug = estado === 'jugando';
      var ok = marcas ? marcas[id] : null;
      var clase = 'es-ord-row' + (grabado === id ? ' is-grab' : '') + (ok === true ? ' is-ok' : ok === false ? ' is-bad' : '') + (!jug ? ' is-done' : '') + (estado === 'revelado' ? ' is-reveal' : '');
      var pista = jug && ok === false && intentos >= 2 && it.explicacion ? it.explicacion : '';
      var cuerpo = [
        it.icono ? h('span', { 'class': 'es-ord-ico', 'aria-hidden': 'true' }, icon(it.icono)) : null,
        h('span', { 'class': 'es-ord-tx' },
          h('span', { 'class': 'es-ord-t', text: it.texto }),
          !jug && it.explicacion ? h('small', { 'class': 'es-ord-ex', text: it.explicacion }) : null,
          pista ? h('small', { 'class': 'es-ord-ex es-ord-pista' }, h('b', { text: 'Pista: ' }), document.createTextNode(pista)) : null,
          jug && ok !== null ? h('span', { 'class': 'es-ord-st' }, icon(ok ? 'check' : 'swap'), h('span', { text: ok ? 'Bien ubicado' : 'Fuera de lugar' })) : null)
      ];
      var num = h('span', { 'class': 'es-ord-n', 'aria-hidden': 'true', text: p2(i + 1) });
      if (!jug) return h('li', { 'class': clase, 'data-id': id },
        num, h('div', { 'class': 'es-ord-it es-ord-it--fin' }, cuerpo),
        h('span', { 'class': 'es-ord-ok', 'aria-hidden': 'true' }, icon(estado === 'revelado' ? 'eye' : 'check')));
      var btn = h('button', { type: 'button', 'class': 'es-ord-it', 'aria-pressed': grabado === id ? 'true' : 'false', 'aria-describedby': elKeys.id,
        'aria-roledescription': 'paso ordenable', 'aria-label': it.texto + '. Lugar ' + (i + 1) + ' de ' + n + (ok === true ? '. Bien ubicado.' : ok === false ? '. Fuera de lugar.' : '') + (grabado === id ? '. Agarrado.' : ''),
        onclick: function () { alClic(id); }, onkeydown: function (ev) { teclas(ev, id); } },
        h('span', { 'class': 'es-ord-grip', 'aria-hidden': 'true' }), cuerpo);
      var li = h('li', { 'class': clase, 'data-id': id, 'data-es-drop': id }, num, btn,
        h('span', { 'class': 'es-ord-mv' },
          h('button', { type: 'button', 'class': 'es-ord-b', 'data-mv': 'up', 'aria-label': 'Subir «' + it.texto + '»', 'aria-disabled': i === 0 ? 'true' : null, onclick: function () { moverPaso(id, -1, 'up'); } }, icon('chevron-up')),
          h('button', { type: 'button', 'class': 'es-ord-b', 'data-mv': 'down', 'aria-label': 'Bajar «' + it.texto + '»', 'aria-disabled': i === n - 1 ? 'true' : null, onclick: function () { moverPaso(id, 1, 'down'); } }, icon('chevron-down'))));
      if (Arr) arrastres.push(Arr.hacer(btn, {
        habilitado: function () { return estado === 'jugando'; },
        alEmpezar: function () { grabado = id; antes = orden.slice(); li.classList.add('is-grab'); },
        alSobre: function (d) { sobre(d, id); },
        alSoltar: function (d) {
          limpiarSobre();
          var dest = d && d.getAttribute('data-es-drop');
          grabado = null;
          antes = null;
          if (!(dest && dest !== id && cambio(mover(orden, id, orden.indexOf(dest)), id, null))) pintar(false);
        },
        alCancelar: function () { limpiarSobre(); grabado = null; antes = null; pintar(false); }
      }));
      return li;
    }
    function limpiarSobre() { var rs = elList.querySelectorAll('.es-ord-row'); for (var i = 0; i < rs.length; i++) rs[i].classList.remove('is-over', 'is-over-up', 'is-over-down'); }
    function sobre(d, id) {
      limpiarSobre();
      if (!d || d.getAttribute('data-es-drop') === id) return;
      var a = orden.indexOf(id), b = orden.indexOf(d.getAttribute('data-es-drop'));
      d.classList.add('is-over', b > a ? 'is-over-down' : 'is-over-up');
    }
    function medirY() { var o = {}, rs = elList.querySelectorAll('.es-ord-row'); for (var i = 0; i < rs.length; i++) o[rs[i].getAttribute('data-id')] = rs[i].getBoundingClientRect().top; return o; }
    function pintar(animar) {
      var antesY = animar && !reducido ? medirY() : null;
      arrastres.forEach(function (a) { a.destroy(); }); arrastres = [];
      while (elList.firstChild) elList.removeChild(elList.firstChild);
      orden.forEach(function (id, i) { elList.appendChild(fila(id, i)); });
      var jug = estado === 'jugando';
      elList.className = 'es-ord-list' + (jug ? '' : ' is-done') + (grabado ? ' is-grabbing' : '');
      elKeys.hidden = !jug;
      elCount.textContent = (n + ' pasos' + (jug && intentos ? ' · intento ' + (intentos + 1) : '') + (estado === 'resuelto' ? ' · en orden' : estado === 'revelado' ? ' · respuesta' : '')).toUpperCase();
      pintarAcciones();
      if (antesY) {
        var rs = elList.querySelectorAll('.es-ord-row'), mov = [];
        for (var i = 0; i < rs.length; i++) {
          var id = rs[i].getAttribute('data-id'), dy = antesY[id] - rs[i].getBoundingClientRect().top;
          if (dy && Math.abs(dy) > 1) { rs[i].style.transition = 'none'; rs[i].style.transform = 'translateY(' + Math.round(dy) + 'px)'; mov.push(rs[i]); }
        }
        if (mov.length) {
          void elList.offsetHeight;
          mov.forEach(function (r) { r.style.transition = 'transform 240ms cubic-bezier(.2,.7,.2,1)'; r.style.transform = ''; });
          setTimeout(function () { mov.forEach(function (r) { r.style.transition = ''; }); }, 300);
        }
      }
    }
    function pintarAcciones() {
      while (elAcc.firstChild) elAcc.removeChild(elAcc.firstChild);
      if (estado === 'jugando') {
        elAcc.appendChild(K.button({ label: 'Comprobar', variant: 'primary', icon: 'check', onClick: comprobar }));
        elAcc.appendChild(K.button({ label: 'Mezclar de nuevo', variant: 'ghost', icon: 'reset', onClick: reiniciar }));
        if (intentos >= 1) elAcc.appendChild(K.button({ label: 'Ver la respuesta', variant: 'ghost', icon: 'eye', onClick: revelar }));
      } else elAcc.appendChild(K.button({ label: 'Probar de nuevo', variant: 'ghost', icon: 'reset', onClick: reiniciar }));
    }

    /* ---------------------------------------------------------- teclado */
    function teclas(ev, id) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var i = orden.indexOf(id), k = ev.key;
      if (k === 'Escape' && grabado) { ev.preventDefault(); ev.stopPropagation(); soltar(true); return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        ev.preventDefault();
        var d = k === 'ArrowUp' ? -1 : 1;
        if (grabado === id) moverPaso(id, d, null);
        else { var j = Math.max(0, Math.min(n - 1, i + d)); foco(orden[j]); }
      } else if (k === 'Home' || k === 'End') {
        ev.preventDefault();
        if (grabado === id) cambio(mover(orden, id, k === 'Home' ? 0 : n - 1), id, null);
        else foco(orden[k === 'Home' ? 0 : n - 1]);
      }
    }

    /* ---------------------------------------------------------- comprobar, resolver, revelar */
    function puntuar(c, fallos) {
      if (puntuado) return;
      puntuado = true; ok1 = c;
      if (isFn(ctx.score)) ctx.score(c, n, { retry: esRetry, fallos: fallos.map(refDe) });
    }
    function comprobar() {
      if (estado !== 'jugando') return;
      grabado = null; antes = null; intentos++;
      var ev = evaluar(orden, correcto);
      marcas = {}; orden.forEach(function (id, i) { marcas[id] = ev.enSitio[i]; });
      if (ev.completo) { resolver(); return; }
      puntuar(ev.correctos, orden.filter(function (id, i) { return !ev.enSitio[i]; }).map(function (id) { return porId[id]; }));
      var fuera = n - ev.correctos;
      decir('bad', ev.correctos * 2 >= n ? 'Vas bien.' : 'Todavía no.',
        ev.correctos + ' de ' + n + ' pasos ya están en su lugar; ' + (fuera === 1 ? 'hay 1 fuera de lugar' : 'hay ' + fuera + ' fuera de lugar') + '. Movelos y comprobá de nuevo.' + (intentos >= 2 ? ' Los que siguen mal muestran una pista, y si querés podés ver la respuesta.' : ''));
      pintar(false);
      var b = elList.querySelector('.es-ord-row.is-bad .es-ord-it'); if (b) b.focus({ preventScroll: true });
    }
    function resolver() {
      estado = 'resuelto';
      if (!puntuado) { puntuado = true; ok1 = n; if (isFn(ctx.score)) ctx.score(n, n, { retry: esRetry }); }
      else if (!revelo && ok1 < n && isFn(ctx.score)) ctx.score(Math.min(n, ok1 + Math.ceil((n - ok1) / 2)), n, { retry: true });
      marcas = null;
      if (isFn(ctx.done)) ctx.done();
      decir('ok', intentos <= 1 && ok1 === n ? '¡Orden perfecto, a la primera!' : '¡Ese es el orden!', 'Leé cada paso con su porqué: así lo vas a recordar cuando lo necesites de verdad.');
      pintar(false);
      elFb.setAttribute('tabindex', '-1'); elFb.focus({ preventScroll: true });
    }
    function revelar() {
      if (estado !== 'jugando') return;
      revelo = true; grabado = null; antes = null;
      if (!puntuado) { puntuado = true; ok1 = 0; if (isFn(ctx.score)) ctx.score(0, n, { retry: esRetry, fallos: items.map(refDe) }); }
      orden = correcto.slice(); marcas = null; estado = 'revelado';
      if (isFn(ctx.done)) ctx.done();
      decir('info', 'Este es el orden correcto.', 'Leelo con calma. Cuando quieras, probá de nuevo con los pasos mezclados.');
      pintar(false);
      elFb.setAttribute('tabindex', '-1'); elFb.focus({ preventScroll: true });
    }
    function reiniciar() {
      ronda++; esRetry = true; revelo = false; puntuado = false; ok1 = null; intentos = 0; estado = 'jugando'; grabado = null; antes = null; marcas = null;
      orden = barajar(correcto, correcto, semilla + '|r' + ronda);
      elFb.hidden = true; pintar(false);
      var b = elList.querySelector('.es-ord-it'); if (b) b.focus({ preventScroll: true });
    }

    if (datos.nota) box.appendChild(h('p', { 'class': 'es-note', text: datos.nota }));
    pintar(false);
    return {
      destroy: function () { arrastres.forEach(function (a) { a.destroy(); }); arrastres = []; },
      getState: function () { return { total: n, estado: estado, intentos: intentos, orden: orden.slice(), correcto: correcto.slice() }; }
    };
  }

  Mot.register('ordenar', { normalizar: normalizar, render: render });
  ES.ordenar = { normalizar: normalizar, evaluar: evaluar, mover: mover, barajar: barajar };
})(root.C150);
