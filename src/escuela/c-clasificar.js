var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-clasificar.js — componente `clasificar` (CLA): fichas que se llevan a la caja de su categoría (contrato v7, E3).
 * Se puede ARRASTRAR (ratón, lápiz o dedo con una pulsación larga) o TOCAR la ficha y después la caja; con teclado: Tab a la ficha, Enter,
 * Tab a la caja, Enter (o el número de la caja, 1 a 6, con la ficha elegida). Cada ubicación se corrige al instante con su explicación;
 * lo que se falla vuelve a la bandeja y se puede intentar otra vez (sin penalización: sólo cuenta el primer intento de cada ficha).
 * Al terminar: nota por ficha (ctx.score), las falladas entran al mazo de repaso y se ofrece "Repetir las que fallé".
 *
 * ESQUEMA DE `datos` (canónico; es el §4 del plan con ids y textos garantizados):
 *   { categorias:[{id, nombre}],                 2 a 6 cajas
 *     items:[{id, texto, cat, explicacion?}],    cat = id de una caja; 2 a 20 fichas (se muestran mezcladas, con semilla estable)
 *     consigna?:'texto', nota?:'texto' }
 * normalizar entiende los esbozos del plan: categorias / columnas / cajas / grupos como [{id,nombre}] o ['texto']; items / fichas / tarjetas / acciones
 * como [{texto, cat | categoria | clase | grupo | respuesta | correcta, explicacion | porque | motivo}]; la caja se busca por id, por nombre o por posición;
 * y dos listas paralelas de textos (factores[i] ↔ acciones[i]). Sin categorías o sin respuestas utilizables → null (el motor muestra la reserva).
 *
 * También deja listo `C150.ESCUELA.arrastre` (lo usa c-emparejar.js): { hacer(el, {alEmpezar, alSobre, alSoltar, habilitado}) → {destroy}, mezclar(lista, semilla), rng, hash }.
 * Un destino de arrastre es cualquier elemento con el atributo data-es-drop. Handle: destroy · getState.
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
  /** Una nota "a confirmar" o de errata es del plan (para el instructor), no de la lección: no se publica. */
  function publica(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }

  /* ================================================================== arrastre (compartido con c-emparejar.js) */
  var Arr = ES.arrastre = ES.arrastre || {};
  Arr.hash = function (s) { s = String(s); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  Arr.rng = function (seed) {
    var a = (typeof seed === 'number' ? seed : Arr.hash(seed)) >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  /** Copia barajada (Fisher–Yates con semilla: la misma semilla da siempre el mismo orden). */
  Arr.mezclar = function (lista, semilla) {
    var r = Arr.rng(semilla), a = arr(lista).slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  /**
   * Hace arrastrable `el` con eventos de puntero (anda con ratón, lápiz y dedo). El ratón y el lápiz empiezan al mover 6 px; el dedo, con una pulsación
   * larga (así el panel sigue deslizándose con normalidad). Mientras se arrastra, una copia flota bajo el dedo; el destino es el elemento con
   * [data-es-drop] bajo el puntero. o: { habilitado() → bool, alEmpezar(), alSobre(destinoEl|null), alSoltar(destinoEl|null), alCancelar() }.
   * Un arrastre que termina NO dispara el clic del elemento. Devuelve { destroy() }.
   */
  Arr.hacer = function (el, o) {
    o = o || {};
    var doc = el.ownerDocument, st = null;
    function destinoEn(x, y) { var e = doc.elementFromPoint(x, y); return e && e.closest ? e.closest('[data-es-drop]') : null; }
    function bloquear(ev) { if (ev.cancelable) ev.preventDefault(); }
    function sinMenu(ev) { ev.preventDefault(); }
    /** El panel con scroll que contiene a `el` (para desplazarlo solo cuando la ficha se arrastra cerca del borde). */
    function padreScroll() {
      var w = doc.defaultView;
      for (var p = el.parentElement; p; p = p.parentElement) {
        var oy = w.getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p;
      }
      return null;
    }
    function limpiar() {
      if (!st) return;
      var s = st; st = null;
      if (s.timer) clearTimeout(s.timer);
      if (s.auto) clearInterval(s.auto);
      if (s.sp) s.sp.style.scrollBehavior = s.sb || '';
      doc.removeEventListener('pointermove', mueve, true); doc.removeEventListener('pointerup', suelta, true); doc.removeEventListener('pointercancel', cancela, true);
      doc.removeEventListener('touchmove', bloquear, { passive: false });
      if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
      if (s.activo) { el.classList.remove('is-arrastrando'); if (s.over && isFn(o.alSobre)) o.alSobre(null); }
      return s;
    }
    function empezar(x, y) {
      var r = el.getBoundingClientRect(), g = el.cloneNode(true);
      st.activo = true; st.dx = x - r.left; st.dy = y - r.top;
      g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1; g.classList.add('es-ghost');
      g.style.width = r.width + 'px'; g.style.left = '0'; g.style.top = '0';
      doc.body.appendChild(g); st.ghost = g;
      el.classList.add('is-arrastrando');
      doc.addEventListener('touchmove', bloquear, { passive: false });
      if (isFn(o.alEmpezar)) o.alEmpezar();
      posicionar(x, y);
      var sp = padreScroll();
      if (sp) { st.sp = sp; st.sb = sp.style.scrollBehavior; sp.style.scrollBehavior = 'auto'; }     // sin scroll suave: cada paso del auto-desplazamiento es directo
      if (sp) st.auto = setInterval(function () {       // cerca del borde de arriba o de abajo, el panel se desplaza solo (así se llega a la caja aunque esté fuera de pantalla)
        if (!st) return;
        var r = sp.getBoundingClientRect(), d = 0;
        if (st.y < r.top + 56) d = -(r.top + 56 - st.y);
        else if (st.y > r.bottom - 56) d = st.y - (r.bottom - 56);
        d = Math.max(-22, Math.min(22, Math.round(d / 4)));
        if (d) { sp.scrollTop += d; posicionar(st.x, st.y); }
      }, 16);
    }
    function posicionar(x, y) {
      st.x = x; st.y = y;
      st.ghost.style.transform = 'translate(' + Math.round(x - st.dx) + 'px,' + Math.round(y - st.dy) + 'px)';
      var d = destinoEn(x, y);
      if (d !== st.over) { st.over = d; if (isFn(o.alSobre)) o.alSobre(d); }
    }
    function mueve(ev) {
      if (!st || ev.pointerId !== st.id) return;
      var dx = ev.clientX - st.x0, dy = ev.clientY - st.y0, d2 = dx * dx + dy * dy;
      if (!st.activo) {
        if (st.tipo === 'touch') { if (d2 > 100) limpiar(); return; }   // el dedo se movió antes de la pulsación larga: es un desplazamiento, no un arrastre
        if (d2 < 36) return;
        empezar(ev.clientX, ev.clientY);
      } else posicionar(ev.clientX, ev.clientY);
      bloquear(ev);
    }
    function suelta(ev) {
      if (!st || ev.pointerId !== st.id) return;
      var activo = st.activo, d = activo ? destinoEn(ev.clientX, ev.clientY) : null;
      limpiar();
      if (!activo) return;
      bloquear(ev);
      var tragar = function (e) { e.stopPropagation(); e.preventDefault(); };
      el.addEventListener('click', tragar, true);
      setTimeout(function () { el.removeEventListener('click', tragar, true); }, 60);
      if (isFn(o.alSoltar)) o.alSoltar(d);
    }
    function cancela(ev) { if (!st || ev.pointerId !== st.id) return; var act = st.activo; limpiar(); if (act && isFn(o.alCancelar)) o.alCancelar(); }
    function baja(ev) {
      if ((ev.pointerType === 'mouse' && ev.button !== 0) || st || (isFn(o.habilitado) && !o.habilitado())) return;
      st = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, tipo: ev.pointerType || 'mouse', activo: false, ghost: null, over: null, timer: null };
      if (st.tipo === 'touch') st.timer = setTimeout(function () { if (st && !st.activo) empezar(st.x0, st.y0); }, 300);
      doc.addEventListener('pointermove', mueve, true); doc.addEventListener('pointerup', suelta, true); doc.addEventListener('pointercancel', cancela, true);
    }
    el.addEventListener('pointerdown', baja);
    el.addEventListener('contextmenu', sinMenu);
    return {
      destroy: function () { limpiar(); el.removeEventListener('pointerdown', baja); el.removeEventListener('contextmenu', sinMenu); }
    };
  };

  /* ================================================================== normalizar (puro) */
  var CLAVES_CAT = ['categorias', 'columnas', 'cajas', 'grupos', 'clases', 'zonas', 'tipos'];
  var CLAVES_ITEM = ['items', 'fichas', 'tarjetas', 'elementos', 'acciones', 'casos', 'ejemplos', 'frases', 'flechas'];
  var PARALELAS_CAT = ['factores', 'categorias', 'columnas', 'tipos', 'grupos', 'cajas', 'clases', 'zonas', 'regiones', 'capas', 'etapas', 'fases'];
  var PARALELAS_ITEM = ['acciones', 'items', 'fichas', 'elementos', 'casos', 'ejemplos', 'frases', 'situaciones', 'tarjetas', 'objetos'];

  function primeraLista(d, claves) { for (var i = 0; i < claves.length; i++) if (Array.isArray(d[claves[i]]) && d[claves[i]].length) return d[claves[i]]; return null; }
  function catsDe(lista) {
    var out = [], usados = {};
    arr(lista).forEach(function (c, i) {
      var nombre = esObj(c) ? (str(c.nombre) || str(c.titulo) || str(c.texto) || str(c.etiqueta) || str(c.id)) : str(c);
      if (!nombre) return;
      var id = (esObj(c) && str(c.id)) || slug(nombre) || ('c' + i);
      while (usados[id]) id += '_';
      usados[id] = 1; out.push({ id: id, nombre: nombre });
    });
    return out;
  }
  /** Encuentra la caja de una ficha por id, por nombre o por posición; devuelve el id o ''. */
  function resolverCat(raw, cats, indice) {
    if (typeof raw === 'number' && isFinite(raw)) {
      var i = indice === 1 ? raw - 1 : raw;
      return cats[i] ? cats[i].id : '';
    }
    var t = str(raw);
    if (!t) return '';
    var s = slug(t), k;
    for (k = 0; k < cats.length; k++) if (cats[k].id === t) return cats[k].id;
    for (k = 0; k < cats.length; k++) if (slug(cats[k].id) === s || slug(cats[k].nombre) === s) return cats[k].id;
    return '';
  }
  function indiceNumerico(items, n) {      // 0 si los números van de 0 a n-1; 1 si van de 1 a n
    var nums = items.map(function (it) { return it.catRaw; }).filter(function (v) { return typeof v === 'number'; });
    if (!nums.length) return 0;
    var mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums);
    return mn >= 1 && mx <= n ? 1 : 0;
  }

  function normalizar(datos, ctx, comp) {
    try {
      if (!esObj(datos)) return null;
      var cats = catsDe(primeraLista(datos, CLAVES_CAT)), crudos = [], i;
      var fuente = primeraLista(datos, CLAVES_ITEM);
      // dos listas paralelas de textos: factores[i] ↔ acciones[i]
      if (!cats.length) {
        var kc = null, ki = null;
        PARALELAS_CAT.forEach(function (k) { if (!kc && Array.isArray(datos[k]) && datos[k].length >= 2 && datos[k].every(function (x) { return typeof x === 'string'; })) kc = k; });
        PARALELAS_ITEM.forEach(function (k) { if (!ki && Array.isArray(datos[k]) && datos[k].length >= 2 && datos[k].every(function (x) { return typeof x === 'string'; })) ki = k; });
        if (kc && ki && datos[kc].length === datos[ki].length) {
          cats = catsDe(datos[kc]);
          datos[ki].forEach(function (t, j) { crudos.push({ texto: str(t), catRaw: j, explicacion: '' }); });
          fuente = null;
        }
      }
      arr(fuente).forEach(function (it) {
        if (typeof it === 'string') { if (str(it)) crudos.push({ texto: str(it), catRaw: null, explicacion: '' }); return; }
        if (!esObj(it)) return;
        var texto = str(it.texto) || str(it.nombre) || str(it.frase) || str(it.item) || str(it.caso) || str(it.escenario) || str(it.accion) || str(it.etiqueta);
        var raw = null, ks = ['cat', 'categoria', 'categ', 'clase', 'grupo', 'columna', 'caja', 'respuesta', 'correcta', 'va', 'sentido', 'tipo', 'lado', 'zona'];
        for (var q = 0; q < ks.length; q++) if (it[ks[q]] !== undefined && it[ks[q]] !== null && it[ks[q]] !== '') { raw = it[ks[q]]; break; }
        if (texto) crudos.push({ texto: texto, catRaw: raw, explicacion: publica(it.explicacion) || publica(it.porque) || publica(it.motivo) || publica(it.razon) });
      });
      if (!crudos.length) return null;
      // sin cajas declaradas: salen de los valores distintos de las fichas
      if (!cats.length) {
        var vistos = {};
        crudos.forEach(function (c) { var t = str(c.catRaw); if (t && !vistos[slug(t)]) { vistos[slug(t)] = 1; cats.push({ id: slug(t) || ('c' + cats.length), nombre: cap(t) }); } });
      }
      if (cats.length < 2 || cats.length > 6) return null;
      var base = indiceNumerico(crudos, cats.length), items = [];
      crudos.forEach(function (c) {
        var id = resolverCat(c.catRaw, cats, base);
        if (id) items.push({ id: items.length, texto: c.texto, cat: id, explicacion: c.explicacion });
      });
      if (items.length < 2 || items.length > 20) return null;
      var usadas = {}; items.forEach(function (x) { usadas[x.cat] = 1; });
      if (Object.keys(usadas).length < 2) return null;
      return { categorias: cats, items: items, consigna: publica(datos.consigna) || publica(datos.pregunta), nota: publica(datos.nota) };
    } catch (e) { return null; }
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, reducido = !!ctx.reducedMotion;
    var semilla = (ctx.leccion && ctx.leccion.id || '') + '|' + (ctx.key || '') + '|cla';
    var items = datos.items.map(function (x) { return { id: x.id, texto: x.texto, cat: x.cat, explicacion: x.explicacion, hecho: false, fallo: false, falloRonda: false, intentos: 0 }; });
    var cats = datos.categorias, orden = Arr.mezclar(items, semilla);
    var sel = null, terminado = false, esRetry = !!ctx.hecho, ok1 = null, ronda = 1, arrastres = [];
    function porId(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }
    function catNombre(id) { for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].nombre; return ''; }

    var elCount = h('p', { 'class': 'es-meta es-cla-count', 'aria-live': 'polite' });
    var elPool = h('div', { 'class': 'es-cla-pool', role: 'group', 'aria-label': 'Fichas para clasificar' });
    var elSel = h('p', { 'class': 'es-cla-sel', 'aria-live': 'polite', hidden: true });
    var elFb = h('div', { 'class': 'feedback qz-fb es-cla-fb', role: 'status', 'aria-live': 'polite', hidden: true });
    var elCats = h('div', { 'class': 'es-cla-cats' });
    var elEnd = h('div', { 'class': 'es-cla-end', hidden: true });
    var box = h('div', { 'class': 'es-cla' },
      h('p', { 'class': 'es-note es-cla-hint', text: datos.consigna || 'Tocá una ficha y después la caja donde va. También podés arrastrarla, o elegirla con el teclado y apretar el número de la caja.' }),
      elCount, elPool, elSel, elFb, elCats, elEnd,
      datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null);
    host.appendChild(box);

    function pendientes() { return items.filter(function (x) { return !x.hecho; }); }
    function decir(tono, titulo, texto) {
      while (elFb.firstChild) elFb.removeChild(elFb.firstChild);
      elFb.className = 'feedback qz-fb es-cla-fb ' + (tono === 'ok' ? 'feedback--ok' : tono === 'bad' ? 'feedback--bad' : '');
      elFb.hidden = false;
      elFb.appendChild(h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(tono === 'ok' ? 'check' : tono === 'bad' ? 'bulb' : 'info')));
      elFb.appendChild(h('div', { 'class': 'qz-fb-b' }, h('strong', { text: titulo }), texto ? h('span', { text: texto }) : null));
    }
    function seleccionar(it, enSilencio) {
      sel = it;
      elSel.hidden = !it || !!enSilencio;       // al arrastrar no aparece el cartel (empujaría las cajas hacia abajo mientras se mueve la ficha)
      elSel.textContent = it && !enSilencio ? 'Elegiste: «' + it.texto + '». Ahora tocá la caja donde va.' : '';
      var cs = elPool.querySelectorAll('.es-cla-chip');
      for (var i = 0; i < cs.length; i++) cs[i].setAttribute('aria-pressed', it && String(it.id) === cs[i].getAttribute('data-id') ? 'true' : 'false');
    }
    function chipEl(it) { return elPool.querySelector('.es-cla-chip[data-id="' + it.id + '"]'); }

    function pintar() {
      arrastres.forEach(function (a) { a.destroy(); }); arrastres = [];
      while (elPool.firstChild) elPool.removeChild(elPool.firstChild);
      var pend = orden.filter(function (x) { return !x.hecho; });
      pend.forEach(function (it) {
        var b = h('button', { type: 'button', 'class': 'es-cla-chip' + (it.fallo ? ' is-miss' : ''), 'data-id': it.id, 'aria-pressed': sel === it ? 'true' : 'false', onclick: function () { if (terminado) return; seleccionar(sel === it ? null : it); } },
          h('span', { text: it.texto }), it.fallo ? h('span', { 'class': 'sr-only', text: ' (la fallaste antes: probá de nuevo)' }) : null);
        elPool.appendChild(b);
        arrastres.push(Arr.hacer(b, {
          habilitado: function () { return !terminado; },
          alEmpezar: function () { seleccionar(it, true); },
          alSobre: function (d) { var cs = elCats.querySelectorAll('.es-cla-cat'); for (var i = 0; i < cs.length; i++) cs[i].classList.toggle('is-over', cs[i] === d); },
          alSoltar: function (d) { if (d) colocar(it, d.getAttribute('data-es-drop')); else seleccionar(null); },
          alCancelar: function () { seleccionar(null); }
        }));
      });
      elPool.hidden = !pend.length;
      var hechas = items.length - pend.length;
      elCount.textContent = (hechas + ' de ' + items.length + ' fichas ubicadas').toUpperCase();
      // cajas
      while (elCats.firstChild) elCats.removeChild(elCats.firstChild);
      cats.forEach(function (c, n) {
        var ul = h('ul', { 'class': 'es-cla-placed' });
        orden.filter(function (x) { return x.hecho && x.cat === c.id; }).forEach(function (x) {
          ul.appendChild(h('li', { 'class': 'es-cla-done' }, h('span', { 'class': 'es-cla-done-i', 'aria-hidden': 'true' }, icon('check')), h('span', { 'class': 'es-cla-done-t' }, h('span', { text: x.texto }), x.explicacion ? h('small', { text: x.explicacion }) : null)));
        });
        elCats.appendChild(h('section', { 'class': 'es-cla-cat', 'data-es-drop': c.id, 'aria-label': 'Caja: ' + c.nombre },
          h('button', { type: 'button', 'class': 'es-cla-catb', 'data-cat': c.id, disabled: terminado ? true : null, 'aria-keyshortcuts': String(n + 1), onclick: function () { alCaja(c.id); } },
            h('span', { 'class': 'es-cla-num', 'aria-hidden': 'true', text: n + 1 }), h('span', { 'class': 'es-cla-catn', text: c.nombre }),
            h('span', { 'class': 'es-cla-cant', 'aria-hidden': 'true', text: ul.childNodes.length ? String(ul.childNodes.length) : '' })),
          ul));
      });
    }
    function alCaja(catId) {
      if (terminado) return;
      if (!sel) { decir('info', 'Elegí primero una ficha', 'Tocá una de las fichas de arriba y después la caja donde va.'); return; }
      colocar(sel, catId);
    }
    function colocar(it, catId) {
      if (terminado || it.hecho || !catId) return;
      var bien = it.cat === catId;
      seleccionar(null);
      if (bien) {
        it.hecho = true;
        decir('ok', '¡Eso es!', '«' + it.texto + '» va en «' + catNombre(it.cat) + '».' + (it.explicacion ? ' ' + it.explicacion : ''));
        pintar();
        if (!pendientes().length) { terminar(); return; }
        var sig = elPool.querySelector('.es-cla-chip'); if (sig) sig.focus({ preventScroll: true });
      } else {
        it.fallo = true; it.falloRonda = true; it.intentos++;
        decir('bad', 'Ahí no va.', '«' + it.texto + '» no va en «' + catNombre(catId) + '».' + (it.explicacion ? ' Pista: ' + it.explicacion : ' Probá con otra caja.'));
        pintar();
        var c = chipEl(it);
        if (c) { c.focus({ preventScroll: true }); if (!reducido) { c.classList.add('is-shake'); setTimeout(function () { c.classList.remove('is-shake'); }, 450); } }
        if (it.intentos >= 2) {     // dos fallos seguidos: se marca la caja correcta para que nadie se trabe
          var cb = elCats.querySelector('.es-cla-catb[data-cat="' + it.cat + '"]');
          if (cb) { cb.classList.add('is-hint'); setTimeout(function () { if (cb.classList) cb.classList.remove('is-hint'); }, 2600); }
        }
      }
    }
    function refDe(it) { var S = ES.store; return isFn(S && S.hashTexto) ? S.hashTexto(it.texto).slice(0, 6) : String(it.id); }
    function terminar() {
      terminado = true;
      var total = items.length, fallos = items.filter(function (x) { return x.fallo; });
      if (ok1 === null) {
        ok1 = total - fallos.length;
        if (isFn(ctx.score)) ctx.score(ok1, total, { retry: esRetry, fallos: fallos.map(refDe) });
      } else {
        items.forEach(function (x) { if (x.repaso && !x.falloRonda) x.rescatada = true; });
        var rescatadas = items.filter(function (x) { return x.rescatada; }).length;
        if (isFn(ctx.score)) ctx.score(Math.min(total, ok1 + rescatadas), total, { retry: true });
      }
      if (isFn(ctx.done)) ctx.done();
      pintar();
      var quedan = items.filter(function (x) { return x.fallo && !x.rescatada; });
      var perfecto = ok1 === total;
      elEnd.hidden = false;
      while (elEnd.firstChild) elEnd.removeChild(elEnd.firstChild);
      elEnd.appendChild(h('div', { 'class': 'feedback es-cla-sum ' + (perfecto ? 'feedback--ok' : ''), role: 'status' },
        h('strong', { text: perfecto ? '¡Todas a la primera!' : (!quedan.length && ronda > 1 ? 'Repasaste las que costaron: ¡ahora están todas bien!' : 'Ubicaste las ' + total + ' fichas. Acertaste ' + ok1 + ' a la primera.') }),
        !perfecto ? h('span', { text: 'Las que costaron van a tu repaso para que las veas de nuevo en unos días.' }) : null,
        quedan.length ? h('ul', { 'class': 'es-list' }, quedan.map(function (x) { return h('li', { text: x.texto + ' → ' + catNombre(x.cat) }); })) : null));
      var fila = h('div', { 'class': 'btn-row' });
      if (quedan.length) fila.appendChild(ctx.Kit.button({ label: 'Repetir las que fallé', variant: 'primary', size: 'small', icon: 'reset', onClick: repetirFalladas }));
      fila.appendChild(ctx.Kit.button({ label: 'Empezar de nuevo', variant: 'ghost', size: 'small', onClick: reiniciar }));
      elEnd.appendChild(fila);
    }
    function reabrir() { terminado = false; elEnd.hidden = true; elFb.hidden = true; ronda++; }
    function repetirFalladas() {
      reabrir();
      items.forEach(function (x) { x.falloRonda = false; x.intentos = 0; if (x.fallo && !x.rescatada) { x.hecho = false; x.repaso = true; } });
      orden = Arr.mezclar(items, semilla + '|r' + ronda);
      decir('info', 'Ronda de repaso', 'Volvieron las fichas que fallaste. Ubicalas de nuevo.');
      pintar();
      var c = elPool.querySelector('.es-cla-chip'); if (c) c.focus({ preventScroll: true });
    }
    function reiniciar() {
      reabrir(); esRetry = true; ok1 = null;
      items.forEach(function (x) { x.hecho = false; x.fallo = false; x.falloRonda = false; x.intentos = 0; x.repaso = false; x.rescatada = false; });
      orden = Arr.mezclar(items, semilla + '|n' + ronda);
      elFb.hidden = true; seleccionar(null);
      pintar();
    }

    box.addEventListener('keydown', function (ev) {
      if (terminado) return;
      if (ev.key === 'Escape' && sel) { seleccionar(null); ev.stopPropagation(); return; }
      if (!/^[1-9]$/.test(ev.key) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var n = +ev.key - 1, a = box.ownerDocument.activeElement, it = sel;
      if (!it && a && a.classList && a.classList.contains('es-cla-chip')) it = porId(+a.getAttribute('data-id'));
      if (it && cats[n]) { ev.preventDefault(); colocar(it, cats[n].id); }
    });

    pintar();
    return {
      destroy: function () { arrastres.forEach(function (a) { a.destroy(); }); arrastres = []; },
      getState: function () { return { total: items.length, ubicadas: items.length - pendientes().length, falladas: items.filter(function (x) { return x.fallo; }).length, terminado: terminado, ronda: ronda }; }
    };
  }

  Mot.register('clasificar', { normalizar: normalizar, render: render });
  ES.clasificar = { normalizar: normalizar };
})(root.C150);
