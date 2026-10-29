var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-emparejar.js — componente `emparejar` (EMP): unir cada concepto con su definición, cifra o instrumento (contrato v7, E3).
 * Dos columnas: tocá uno de cada lado (en cualquier orden) o arrastrá uno sobre el otro. El par correcto se funde y queda fijo arriba;
 * el error vibra y se puede intentar otra vez SIN penalización (no hay reloj). Cada par cuenta una sola vez: acierta "a la primera" si nunca
 * lo equivocaste. Teclado: Tab / Enter, y las flechas mueven entre las tarjetas (arriba y abajo en la columna, izquierda y derecha entre columnas).
 * Al terminar: ctx.score(pares sin error, total, {fallos}) y ctx.done(); los pares con error entran al mazo de repaso.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { pares:[{id, a, b, extra?}],          2 a 24 pares; a = columna izquierda, b = columna derecha, extra = dato que se muestra al unirlos
 *     distractoresB?:['texto', …],         tarjetas de la derecha que no corresponden a nadie (se desechan sin penalizar)
 *     nota?:'texto' }                      más de 10 pares se reparten en rondas de 6 como máximo
 * normalizar entiende los esbozos del plan: pares como [a, b] o [a, b, c] (lo que sobra pasa a `extra`), {a,b}, {izquierda,derecha},
 * {termino,definicion}, {concepto,significado}…, un objeto {"CIAC":"…"}, o dos listas paralelas (terminos / definiciones…).
 * Sin al menos 2 pares con los dos lados → null (el motor muestra la reserva).  Handle: destroy · getState.
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
  function publica(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para|instructor/i.test(t) ? t : ''; }
  function mezclar(l, semilla) { return ES.arrastre && isFn(ES.arrastre.mezclar) ? ES.arrastre.mezclar(l, semilla) : arr(l).slice(); }

  /* ================================================================== normalizar (puro) */
  var KA = ['a', 'izquierda', 'izq', 'termino', 'concepto', 'sigla', 'clave', 'nombre', 'item', 'left', 'frase', 'texto'];
  var KB = ['b', 'derecha', 'der', 'definicion', 'significado', 'valor', 'par', 'descripcion', 'right', 'explicacion', 'respuesta', 'dato'];
  var KEXTRA = ['c', 'extra', 'origen', 'detalle', 'nota'];
  var PARALELAS = [['terminos', 'definiciones'], ['conceptos', 'definiciones'], ['izquierda', 'derecha'], ['a', 'b'], ['columnaA', 'columnaB'], ['conceptos', 'significados'], ['siglas', 'significados'], ['elementos', 'funciones']];

  function parDe(p) {
    if (Array.isArray(p)) {
      var t = p.map(str);
      if (t.length < 2 || !t[0] || !t[1]) return null;
      return { a: t[0], b: t[1], extra: t.slice(2).filter(Boolean).join(' · ') };
    }
    if (!esObj(p)) return null;
    var a = '', b = '', ex = '', i;
    for (i = 0; i < KA.length && !a; i++) a = str(p[KA[i]]);
    for (i = 0; i < KB.length && !b; i++) b = str(p[KB[i]]);
    for (i = 0; i < KEXTRA.length && !ex; i++) ex = publica(p[KEXTRA[i]]);
    if (!a || !b) {      // un objeto sin claves conocidas: sus dos primeros textos
      var vs = Object.keys(p).map(function (k) { return str(p[k]); }).filter(Boolean);
      if (vs.length < 2) return null;
      a = vs[0]; b = vs[1]; ex = vs.slice(2).join(' · ');
    }
    return { a: a, b: b, extra: ex };
  }

  function normalizar(datos, ctx, comp) {
    try {
      if (!esObj(datos)) return null;
      var crudos = [], i;
      if (Array.isArray(datos.pares)) crudos = datos.pares.map(parDe);
      else if (esObj(datos.pares)) crudos = Object.keys(datos.pares).map(function (k) { return parDe([k, datos.pares[k]]); });
      else {
        for (i = 0; i < PARALELAS.length && !crudos.length; i++) {
          var l1 = datos[PARALELAS[i][0]], l2 = datos[PARALELAS[i][1]];
          if (Array.isArray(l1) && Array.isArray(l2) && l1.length >= 2 && l1.length === l2.length) crudos = l1.map(function (x, j) { return parDe([x, l2[j]]); });
        }
      }
      var pares = [], vistos = {};
      crudos.forEach(function (p) { if (p && !vistos[p.a + '\u0001' + p.b]) { vistos[p.a + '\u0001' + p.b] = 1; pares.push({ id: pares.length, a: p.a, b: p.b, extra: p.extra }); } });
      if (pares.length < 2 || pares.length > 24) return null;
      var dist = arr(datos.distractoresB || datos.distractores).map(str).filter(function (t) { return t && !pares.some(function (p) { return p.b === t; }); });
      return { pares: pares, distractoresB: dist.slice(0, 4), nota: publica(datos.nota) || publica(datos.etiqueta) };
    } catch (e) { return null; }
  }

  /** Reparte los pares en rondas (≤ 10 va todo junto; si no, rondas parejas de hasta 6). */
  function rondas(pares) {
    if (pares.length <= 10) return [pares];
    var n = Math.ceil(pares.length / 6), out = [], k = Math.ceil(pares.length / n);
    for (var i = 0; i < pares.length; i += k) out.push(pares.slice(i, i + k));
    return out;
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, reducido = !!ctx.reducedMotion, Arr = ES.arrastre;
    var semilla = (ctx.leccion && ctx.leccion.id || '') + '|' + (ctx.key || '') + '|emp';
    var todos = datos.pares.map(function (p) { return { id: p.id, a: p.a, b: p.b, extra: p.extra, error: false, hecho: false }; });
    var tandas = rondas(todos), nRonda = 0, ronda = null;       // ronda = { pares, izq:[card], der:[card] }
    var selA = null, selB = null, terminado = false, esRetry = !!ctx.hecho, sinError = 0, errores = 0, arrastres = [], intento = 0;

    var elCount = h('p', { 'class': 'es-meta es-emp-count', 'aria-live': 'polite' });
    var elFused = h('ul', { 'class': 'es-emp-fused', 'aria-label': 'Pares unidos' });
    var elIzq = h('ul', { 'class': 'es-emp-col', 'aria-label': 'Columna de la izquierda' });
    var elDer = h('ul', { 'class': 'es-emp-col', 'aria-label': 'Columna de la derecha' });
    var elCols = h('div', { 'class': 'es-emp-cols' }, elIzq, elDer);
    var elFb = h('div', { 'class': 'feedback qz-fb es-emp-fb', role: 'status', 'aria-live': 'polite', hidden: true });
    var elEnd = h('div', { 'class': 'es-emp-end', hidden: true });
    var box = h('div', { 'class': 'es-emp' },
      h('p', { 'class': 'es-note es-emp-hint', text: 'Tocá un elemento de cada columna para unirlos, en el orden que quieras. También podés arrastrar uno sobre el otro. Si te equivocás, no pasa nada: probá de nuevo.' }),
      elCount, elFused, elCols, elFb, elEnd,
      datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null);
    host.appendChild(box);

    function armarRonda() {
      var pares = tandas[nRonda];
      var izq = pares.map(function (p) { return { lado: 'a', texto: p.a, par: p, hecho: false }; });
      var der = pares.map(function (p) { return { lado: 'b', texto: p.b, par: p, hecho: false }; })
        .concat(datos.distractoresB.map(function (t) { return { lado: 'b', texto: t, par: null, hecho: false, sobra: true }; }));
      var d2 = mezclar(der, semilla + '|' + nRonda + '|' + intento);
      if (pares.length >= 3 && d2.filter(function (c) { return !c.sobra; }).every(function (c, i) { return c.par === pares[i]; })) d2 = d2.slice().reverse();
      ronda = { pares: pares, izq: izq, der: d2 };
      selA = selB = null;
    }
    function quedan() { return ronda.izq.filter(function (c) { return !c.hecho; }); }
    function decir(tono, titulo, texto) {
      while (elFb.firstChild) elFb.removeChild(elFb.firstChild);
      elFb.className = 'feedback qz-fb es-emp-fb ' + (tono === 'ok' ? 'feedback--ok' : tono === 'bad' ? 'feedback--bad' : '');
      elFb.hidden = false;
      elFb.appendChild(h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(tono === 'ok' ? 'check' : tono === 'bad' ? 'bulb' : 'info')));
      elFb.appendChild(h('div', { 'class': 'qz-fb-b' }, h('strong', { text: titulo }), texto ? h('span', { text: texto }) : null));
    }

    function tarjeta(c) {
      var sel = (c.lado === 'a' ? selA : selB) === c;
      var b = h('button', { type: 'button', 'class': 'es-emp-card' + (sel ? ' is-sel' : '') + (c.sobra && terminado ? ' is-sobra' : ''), 'data-lado': c.lado, 'data-es-drop': c.lado,
        'aria-pressed': sel ? 'true' : 'false', disabled: terminado ? true : null, onclick: function () { tocar(c); } },
        h('span', { text: c.texto }));
      b._card = c;
      if (Arr && !terminado) arrastres.push(Arr.hacer(b, {
        habilitado: function () { return !terminado; },
        alEmpezar: function () { if (c.lado === 'a') selA = c; else selB = c; marcarSel(); },
        alSobre: function (d) { var cs = box.querySelectorAll('.es-emp-card'); for (var i = 0; i < cs.length; i++) cs[i].classList.toggle('is-over', cs[i] === d && d.getAttribute('data-lado') !== c.lado); },
        alSoltar: function (d) {
          var otra = d && d._card;
          if (!otra || otra.lado === c.lado || otra.hecho) { selA = selB = null; marcarSel(); return; }
          if (c.lado === 'a') { selA = c; selB = otra; } else { selA = otra; selB = c; }
          intentar();
        },
        alCancelar: function () { selA = selB = null; marcarSel(); }
      }));
      return h('li', { 'class': 'es-emp-li' }, b);
    }
    function marcarSel() {
      var cs = box.querySelectorAll('.es-emp-card');
      for (var i = 0; i < cs.length; i++) {
        var on = !!cs[i]._card && (cs[i]._card === selA || cs[i]._card === selB);
        cs[i].classList.toggle('is-sel', on); cs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    function pintar() {
      arrastres.forEach(function (a) { a.destroy(); }); arrastres = [];
      [elIzq, elDer, elFused].forEach(function (e) { while (e.firstChild) e.removeChild(e.firstChild); });
      ronda.izq.filter(function (c) { return !c.hecho; }).forEach(function (c) { elIzq.appendChild(tarjeta(c)); });
      ronda.der.filter(function (c) { return !c.hecho; }).forEach(function (c) { elDer.appendChild(tarjeta(c)); });
      // todos los pares unidos hasta ahora (de todas las rondas), en el orden en que se unieron
      todos.filter(function (p) { return p.hecho; }).sort(function (x, y) { return x.orden - y.orden; }).forEach(function (p) {
        elFused.appendChild(h('li', { 'class': 'es-emp-fuse' + (p.nuevo && !reducido ? ' is-in' : '') },
          h('span', { 'class': 'es-emp-fuse-i', 'aria-hidden': 'true' }, icon('check')),
          h('span', { 'class': 'es-emp-fuse-t' }, h('b', { text: p.a }), h('span', { 'class': 'es-emp-fuse-s', 'aria-hidden': 'true', text: ' ↔ ' }), h('span', { text: p.b }), p.extra ? h('small', { text: p.extra }) : null)));
        p.nuevo = false;
      });
      elFused.hidden = !elFused.firstChild;
      var hechos = todos.filter(function (p) { return p.hecho; }).length;
      elCount.textContent = (hechos + ' de ' + todos.length + ' pares unidos' + (tandas.length > 1 ? ' · ronda ' + (nRonda + 1) + ' de ' + tandas.length : '')).toUpperCase();
    }
    function tocar(c) {
      if (terminado) return;
      if (c.lado === 'a') selA = selA === c ? null : c; else selB = selB === c ? null : c;
      marcarSel();
      if (selA && selB) intentar();
    }
    function sacudir(cards) {
      if (reducido) return;
      cards.forEach(function (c) { if (c) { c.classList.add('is-shake'); setTimeout(function () { c.classList.remove('is-shake'); }, 450); } });
    }
    function elDe(card) {
      var cs = box.querySelectorAll('.es-emp-card');
      for (var i = 0; i < cs.length; i++) if (cs[i]._card === card) return cs[i];
      return null;
    }
    function intentar() {
      var a = selA, b = selB; selA = selB = null;
      if (!a || !b) return;
      var bien = !b.sobra && a.par.b === b.texto && !b.hecho;
      if (bien) {
        a.hecho = true; b.hecho = true; a.par.hecho = true; a.par.nuevo = true; a.par.orden = todos.filter(function (p) { return p.hecho; }).length;
        if (!a.par.error) sinError++;
        decir('ok', '¡Bien!', '«' + a.par.a + '» va con «' + a.par.b + '».');
        var idx = Array.prototype.indexOf.call(elIzq.querySelectorAll('.es-emp-card'), elDe(a));
        pintar();
        if (!quedan().length) { cerrarRonda(); return; }
        var cs = elIzq.querySelectorAll('.es-emp-card'), f = cs[Math.min(Math.max(idx, 0), cs.length - 1)];
        if (f) f.focus({ preventScroll: true });
      } else {
        a.par.error = true; errores++;
        decir('bad', 'Esos dos no van juntos.', 'Probá otra combinación: no hay penalización.');
        var ca = elDe(a), cb = elDe(b);
        marcarSel(); sacudir([ca, cb]);
        if (ca) ca.focus({ preventScroll: true });
      }
    }
    function refDe(p) { var S = ES.store; return isFn(S && S.hashTexto) ? S.hashTexto(p.a).slice(0, 6) : String(p.id); }
    function cerrarRonda() {
      if (nRonda + 1 < tandas.length) {
        pintar();
        elEnd.hidden = false;
        while (elEnd.firstChild) elEnd.removeChild(elEnd.firstChild);
        elEnd.appendChild(h('div', { 'class': 'btn-row' }, ctx.Kit.button({ label: 'Seguir con la ronda ' + (nRonda + 2), variant: 'primary', size: 'small', iconRight: 'arrow-right', onClick: function () { nRonda++; elEnd.hidden = true; elFb.hidden = true; armarRonda(); pintar(); var c = elIzq.querySelector('.es-emp-card'); if (c) c.focus({ preventScroll: true }); } })));
        return;
      }
      terminado = true;
      var total = todos.length, malos = todos.filter(function (p) { return p.error; });
      var ok = total - malos.length;
      if (isFn(ctx.score)) ctx.score(ok, total, { retry: esRetry, fallos: malos.map(refDe) });
      if (isFn(ctx.done)) ctx.done();
      pintar();
      var perfecto = !malos.length;
      elEnd.hidden = false;
      while (elEnd.firstChild) elEnd.removeChild(elEnd.firstChild);
      elEnd.appendChild(h('div', { 'class': 'feedback es-emp-sum ' + (perfecto ? 'feedback--ok' : ''), role: 'status' },
        h('strong', { text: perfecto ? '¡Todos los pares a la primera!' : 'Uniste los ' + total + ' pares. ' + ok + ' a la primera.' }),
        !perfecto ? h('span', { text: 'Los que costaron van a tu repaso para que los veas de nuevo en unos días.' }) : null,
        datos.distractoresB.length ? h('span', { 'class': 'es-note', text: 'Las tarjetas que quedaron sin pareja eran de relleno: no correspondían a ninguno.' }) : null));
      elEnd.appendChild(h('div', { 'class': 'btn-row' }, ctx.Kit.button({ label: 'Probar de nuevo', variant: 'ghost', size: 'small', icon: 'reset', onClick: reiniciar })));
    }
    function reiniciar() {
      todos.forEach(function (p) { p.hecho = false; p.error = false; p.nuevo = false; });
      terminado = false; esRetry = true; nRonda = 0; sinError = 0; errores = 0; intento++;
      elEnd.hidden = true; elFb.hidden = true;
      armarRonda(); pintar();
      var c = elIzq.querySelector('.es-emp-card'); if (c) c.focus({ preventScroll: true });
    }

    box.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (ev.key === 'Escape' && (selA || selB)) { selA = selB = null; marcarSel(); ev.stopPropagation(); return; }
      if (!t || !t.classList || !t.classList.contains('es-emp-card') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var lado = t.getAttribute('data-lado'), propia = (lado === 'a' ? elIzq : elDer).querySelectorAll('.es-emp-card'), otra = (lado === 'a' ? elDer : elIzq).querySelectorAll('.es-emp-card');
      var i = Array.prototype.indexOf.call(propia, t), dest = null;
      if (ev.key === 'ArrowDown') dest = propia[Math.min(i + 1, propia.length - 1)];
      else if (ev.key === 'ArrowUp') dest = propia[Math.max(i - 1, 0)];
      else if ((ev.key === 'ArrowRight' && lado === 'a') || (ev.key === 'ArrowLeft' && lado === 'b')) dest = otra[Math.min(i, otra.length - 1)];
      if (dest) { ev.preventDefault(); dest.focus(); }
    });

    armarRonda(); pintar();
    return {
      destroy: function () { arrastres.forEach(function (a) { a.destroy(); }); arrastres = []; },
      getState: function () { return { total: todos.length, unidos: todos.filter(function (p) { return p.hecho; }).length, errores: errores, terminado: terminado, ronda: nRonda + 1 }; }
    };
  }

  Mot.register('emparejar', { normalizar: normalizar, render: render });
  ES.emparejar = { normalizar: normalizar, rondas: rondas };
})(root.C150);
