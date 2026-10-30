var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/bloques.js — C150.ESCUELA.bloques: el DOM de los puntos clave (contrato v8 §3). La parte pura (tipos, lead, marcado) está en texto.js.
 *
 *   B.inline(K, texto, deps) → DocumentFragment      el mini-marcado: **término** (énfasis + glosario), ==clave== (resaltador), {{valor|unidad}} (cifra en mono)
 *   B.bloque(K, item, {deps, reglaN}) → <div class="es-blocks">   el punto clave según su `tipo`, más los extras dato / ejemplo / ojo
 *   B.resumenLinea(K, texto, deps) → <aside class="es-resumen">   "RESUMEN EN UNA LÍNEA"
 *   deps (opcional) = { glosario(termino, def), termino(termino) → definición de la lección | null }
 * Todo se arma con Kit.el (nunca innerHTML). Las clases es-* viven en el bloque "v8 · L2" de styles.css.
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var B = ES.bloques = ES.bloques || {};
  function T() { return ES.texto; }
  function isFn(f) { return typeof f === 'function'; }

  function termino(K, v, deps) {
    var h = K.el, G = C150.Glossary, def = null, d = null;
    try { def = G && isFn(G.define) ? G.define(v) : null; } catch (e) { def = null; }
    if (def && def.id) return h('button', { type: 'button', 'class': 'term es-mk-term', 'data-gl': def.id, 'aria-haspopup': 'dialog', text: v });
    d = deps && isFn(deps.termino) ? deps.termino(v) : null;
    if (d && isFn(deps.glosario)) return h('button', { type: 'button', 'class': 'es-mk-term es-mk-btn', onclick: function () { deps.glosario(v, d); }, text: v });
    return h('strong', { 'class': 'es-mk-term', text: v });
  }
  B.inline = function (K, s, deps) {
    var h = K.el, frag = document.createDocumentFragment();
    T().markup(s).forEach(function (x) {
      if (x.t === 'txt') frag.appendChild(document.createTextNode(x.v));
      else if (x.t === 'clave') frag.appendChild(h('mark', { 'class': 'es-mk-clave', text: x.v }));
      else if (x.t === 'dato') frag.appendChild(h('span', { 'class': 'es-mk-dato' }, h('b', { text: x.v }), x.u ? h('i', { text: x.u }) : null));
      else frag.appendChild(termino(K, x.v, deps));
    });
    return frag;
  };

  function p(K, s, clase, deps) { return K.el('p', { 'class': clase }, B.inline(K, s, deps)); }
  /** Primera oración grande (lead) y el resto en párrafos de lectura. */
  function leadYResto(K, s, deps) {
    var r = T().partir(s), f = document.createDocumentFragment();
    if (r.lead) f.appendChild(p(K, r.lead, 'es-lead-p', deps));
    if (r.resto) { var d = K.el('div', { 'class': 'es-prose' }); T().parrafos(r.resto).forEach(function (t) { d.appendChild(p(K, t, 'es-p', deps)); }); f.appendChild(d); }
    return f;
  }
  function prosa(K, s, deps) { var d = K.el('div', { 'class': 'es-prose' }); T().parrafos(s).forEach(function (t) { d.appendChild(p(K, t, 'es-p', deps)); }); return d; }

  function datoFig(K, d) {
    var h = K.el, lbl = d.valor + (d.unidad ? ' ' + d.unidad : '') + (d.etiqueta ? ': ' + d.etiqueta : '');
    return h('figure', { 'class': 'es-datofig' },
      h('p', { 'class': 'es-dato', 'aria-label': lbl }, h('span', { 'class': 'es-dato-v', 'aria-hidden': 'true', text: d.valor }), d.unidad ? h('span', { 'class': 'es-dato-u', 'aria-hidden': 'true', text: d.unidad }) : null),
      d.etiqueta ? h('figcaption', { 'class': 'es-dato-l', 'aria-hidden': 'true', text: d.etiqueta }) : null);
  }
  function ojo(K, s, deps) {
    var h = K.el;
    return h('aside', { 'class': 'es-ojo', role: 'note' }, h('p', { 'class': 'es-ojo-k' }, K.icon('warning'), h('span', { text: 'OJO' })), p(K, s, 'es-ojo-t', deps));
  }
  function ejemplo(K, s, deps) {
    var h = K.el, b = h('div', { 'class': 'es-ej-b' });
    T().parrafos(s).forEach(function (t) { b.appendChild(p(K, t, 'es-ej-t', deps)); });
    return h('div', { 'class': 'es-ej' }, h('span', { 'class': 'es-ej-tab', text: 'EJEMPLO' }), b);
  }

  B.bloque = function (K, item, o) {
    o = o || {};
    var h = K.el, deps = o.deps || null, t = T(), tipo = item.tipo || 'texto', root = h('div', { 'class': 'es-blocks es-blocks--' + tipo });
    if (tipo === 'definicion') {
      var d = h('div', { 'class': 'es-def-card' }), r = t.parrafos(item.texto);
      r.forEach(function (x, i) { d.appendChild(p(K, x, i ? 'es-p' : 'es-def-t', deps)); });
      root.appendChild(h('div', { 'class': 'es-def' }, h('p', { 'class': 'es-def-k', text: 'DEFINICIÓN' }), d));
    } else if (tipo === 'regla') {
      var num = item.n || o.reglaN || '';
      root.appendChild(h('div', { 'class': 'es-rule' },
        h('span', { 'class': 'es-rule-n', 'aria-hidden': 'true', text: /^\d+$/.test(String(num)) ? t.p2(num) : String(num) }),
        h('div', { 'class': 'es-rule-b' }, h('span', { 'class': 'sr-only', text: 'Regla ' + num + '. ' }), leadYResto(K, item.texto, deps))));
    } else if (tipo === 'dato') {
      if (item.dato) root.appendChild(datoFig(K, item.dato));
      if (item.texto) root.appendChild(leadYResto(K, item.texto, deps));
    } else if (tipo === 'idea') {
      root.appendChild(h('blockquote', { 'class': 'es-idea' }, h('span', { 'class': 'es-idea-q', 'aria-hidden': 'true', text: '“' }), p(K, item.texto.replace(/\n+/g, ' '), 'es-idea-t', deps)));
    } else if (tipo === 'ojo') {
      root.appendChild(ojo(K, item.texto, deps));
    } else if (tipo === 'ejemplo') {
      root.appendChild(ejemplo(K, item.texto, deps));
    } else if (tipo === 'lista') {
      var l = t.listaLineas(item.texto), ol = h('ol', { 'class': 'es-lista' });
      if (l.intro) root.appendChild(p(K, l.intro, 'es-lead-p', deps));
      l.items.forEach(function (x, i) { ol.appendChild(h('li', null, h('span', { 'class': 'es-lista-n', 'aria-hidden': 'true', text: t.p2(i + 1) }), p(K, x, 'es-lista-t', deps))); });
      root.appendChild(ol);
    } else {
      if (item.texto) root.appendChild(leadYResto(K, item.texto, deps));
    }
    // extras: dato · ejemplo · ojo (después del bloque principal)
    if (tipo !== 'dato' && item.dato) root.appendChild(datoFig(K, item.dato));
    if (tipo !== 'ejemplo' && item.ejemplo) root.appendChild(ejemplo(K, item.ejemplo, deps));
    if (tipo !== 'ojo' && item.ojo) root.appendChild(ojo(K, item.ojo, deps));
    return root;
  };
  B.prosa = prosa;

  /* ---- foco y avisos (F2). Los componentes vuelven a armar su interior al avanzar: el control que tenía el foco desaparece (o queda deshabilitado) y el foco cae a <body>.
   * El lector de pantalla se queda mudo y el teclado vuelve al principio de la página. Estos helpers (más aria-disabled en vez de disabled en los controles que pueden tener el foco
   * en un límite) lo evitan. Todo dentro de try: un foco que no se puede mover nunca rompe un componente. */
  /** Lleva el foco a `el`: si por sí solo no lo recibe le pone tabindex="-1" y, con `etiqueta`, un aria-label. → true si el foco quedó ahí. */
  B.enfocar = function (el, etiqueta) {
    if (!el || !isFn(el.focus)) return false;
    try {
      if (etiqueta) el.setAttribute('aria-label', etiqueta);
      if (!/^(a|button|input|select|textarea|summary)$/i.test(el.nodeName || '') && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    } catch (e) { return false; }
    return typeof document !== 'undefined' && document.activeElement === el;
  };
  /** ¿El foco cayó a <body> (o a un nodo que ya no está en la página)? */
  B.focoPerdido = function () {
    if (typeof document === 'undefined') return false;
    var a = document.activeElement;
    return !a || a === document.body || a === document.documentElement || !document.body.contains(a);
  };
  /** Tras una acción que rearma el componente: si el foco se perdió, lo lleva al primer candidato que exista (selectores dentro de `raiz`, o elementos) y, si no hay ninguno, a `raiz` misma. → el elemento enfocado o null. */
  B.rescatarFoco = function (raiz, candidatos) {
    if (!B.focoPerdido()) return null;
    var lista = candidatos || [], i, el;
    for (i = 0; i < lista.length; i++) {
      el = typeof lista[i] === 'string' ? (raiz && raiz.querySelector ? raiz.querySelector(lista[i]) : null) : lista[i];
      if (el && !el.disabled && B.enfocar(el)) return el;
    }
    return raiz && B.enfocar(raiz) ? raiz : null;
  };
  /** Red de seguridad para todos los componentes: si un clic o una tecla destruye (o deshabilita) el control que tenía el foco y éste cae a <body>, lo lleva al primer control de `raiz`
   *  (o a `raiz` misma). Los componentes mueven el foco con intención (a la pregunta, al aviso): esto sólo actúa cuando no lo hicieron. */
  B.vigilarFoco = function (raiz, candidatos) {
    if (!raiz || !isFn(raiz.addEventListener)) return;
    var cand = candidatos || ['button:not([disabled]):not([aria-disabled="true"])', 'input:not([readonly]):not([disabled])', '[tabindex="0"]'];
    function revisar(ev) {
      var t = ev && ev.target;
      setTimeout(function () {
        if (!B.focoPerdido()) return;
        if (t && t.isConnected && !t.disabled) return;          // el control sigue ahí: el foco se fue por otra razón (un clic en un espacio vacío)
        B.rescatarFoco(raiz, cand);
      }, 60);
    }
    raiz.addEventListener('click', revisar); raiz.addEventListener('keydown', revisar);
  };
  /** La etiqueta que se lee al llegar a la tarjeta, la pregunta o el paso: "Tarjeta 2 de 7: ¿Qué es…?". */
  B.etiquetaPaso = function (rotulo, n, total, texto) { return rotulo + ' ' + n + ' de ' + total + (texto ? ': ' + String(texto).replace(/\s+/g, ' ').trim() : ''); };
  /** Una región aria-live persistente (se crea una sola vez, nunca se vuelve a crear): decir(texto) la vacía y la reescribe un instante después, así se lee aunque el texto se repita. */
  B.regionVoz = function (K, host) {
    var el = K.el('p', { 'class': 'sr-only', 'aria-live': 'polite', role: 'status' }), t = 0;
    if (host) host.appendChild(el);
    return { el: el, decir: function (txt) { clearTimeout(t); el.textContent = ''; t = setTimeout(function () { el.textContent = txt; }, 30); } };
  };
  B.resumenLinea = function (K, s, deps) {
    var h = K.el;
    return h('aside', { 'class': 'es-resumen', 'aria-label': 'Resumen en una línea' }, h('p', { 'class': 'es-resumen-k', text: 'RESUMEN EN UNA LÍNEA' }), p(K, s, 'es-resumen-t', deps));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})(root.C150);
