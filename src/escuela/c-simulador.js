var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-simulador.js — componente `simulador` (SIM): mové deslizadores y mirá cómo cambian las cifras y el gráfico en vivo (contrato v7, E2).
 * Los cálculos son los modelos de src/escuela/modelos.js (funciones puras). El look es el de los controles de AIRE: .ctl con marcas, zonas de color,
 * atajos y lectura grande; barras vivas; un semáforo con punto; escenarios como fichas.
 *
 * ESQUEMA DE `datos` (canónico; lo que devuelve normalizar y lo que van a escribir las lecciones nuevas):
 *   { modelo:'sustentacion-alfa',                                  id registrado en C150.ESCUELA.modelos (ver su cabecera)
 *     controles:[{ id, etiqueta?, min?, max?, paso?, valor?, unidad?, opciones?, fijo?, marcas?, zonas?, rapidos? }],   cada uno ajusta el control del modelo con ese id
 *     salidas:[{ id, etiqueta?, unidad?, dec?, formato? }],         subconjunto/orden de las salidas del modelo (formato: "0.0" · "%" · "hora" · "texto")
 *     grafico?:{ tipo:'linea', x:<control>, y:[<salida>…], etiquetaX?, etiquetaY?, lineas?:[{x, texto}] },
 *     umbrales?:[{ salida, igual|mayor|menor|limite, tono:'ok|info|warn|bad', texto }],     semáforo (la primera que cumple)
 *     escenarios?:[{ nombre, valores:{ <control>: valor } }],  consigna?:{ texto, salida, igual|mayor|menor|entre:[a,b] },  nota?:'texto' }
 *   Sólo `modelo` es obligatorio: el resto sale del modelo. normalizar también entiende los esbozos libres del plan (entradas como textos
 *   "V 40–120 kt", salidas como textos, claves propias de cada modelo) buscando el modelo por palabras: si no encuentra ninguno devuelve null.
 * Completa la lección (ctx.done()) cuando se cumple la consigna o, sin consigna, después de mover los controles varias veces; con consigna cumplida suma ctx.score(1,1).
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes, Mod = ES.modelos, U = Mod && Mod.util;
  if (!Mot || !Mod) return;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  var TONOS = { ok: 1, info: 1, warn: 1, bad: 1 };

  /* ================================================================== normalizar (puro) */
  /** "temperatura −10 a 40 °C" → { texto:'temperatura', min:-10, max:40, unidad:'°C' }; sin rango → { texto }. */
  function parseEntrada(s) {
    var t = String(s).replace(/−/g, '-').replace(/(\d),(\d)/g, '$1.$2').trim();
    var m = /^(.*?)\s*(-?\d+(?:\.\d+)?)\s*(?:a|–|—|-|hasta)\s*(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(t);
    if (!m) return { texto: t };
    return { texto: m[1].trim(), min: parseFloat(m[2]), max: parseFloat(m[3]), unidad: m[4] ? m[4].trim() : undefined };
  }
  function coincide(c, texto) {
    var t = U.norm(texto);
    return arr(c.claves).some(function (r) { return r.test(t); });
  }
  function ajustar(c, o) {
    ['etiqueta', 'unidad', 'ayuda'].forEach(function (k) { if (typeof o[k] === 'string' && o[k]) c[k] = o[k]; });
    ['min', 'max', 'paso'].forEach(function (k) { var n = U.num(o[k], null); if (n !== null && c.tipo === 'rango') c[k] = n; });
    if (c.tipo === 'rango') { var v = U.num(o.valor, null); if (v !== null) c.valor = v; }
    else if (c.tipo === 'hora' && typeof o.valor === 'string' && U.horaAMin(o.valor) !== null) c.valor = o.valor;
    else if (c.tipo === 'opcion') { if (arr(o.opciones).length >= 2) c.opciones = o.opciones.map(String); if (typeof o.valor === 'string') c.valor = o.valor; }
    if (o.fijo === true) c.fijo = true;
    ['marcas', 'zonas', 'rapidos'].forEach(function (k) { if (Array.isArray(o[k]) && o[k].length) c[k] = o[k]; });
    delete c.claves;
  }
  function limpiarControl(c) {
    if (c.tipo === 'rango') {
      if (!(c.max > c.min)) { if (c.fijo) c.max = c.min; else c.max = c.min + 1; }
      if (!(c.paso > 0)) c.paso = (c.max - c.min) / 100 || 1;
      c.valor = U.clamp(U.num(c.valor, c.min), c.min, c.max);
    } else if (c.tipo === 'opcion') {
      if (c.opciones.indexOf(c.valor) < 0) c.valor = c.opciones[0];
    }
    delete c.claves;
    return c;
  }
  function formatoSalida(s, f) {
    if (typeof f !== 'string') return;
    var t = U.norm(f).trim();
    if (t === '%') s.unidad = s.unidad || '%';
    else if (/^0(\.0+)?$/.test(t)) s.dec = t.length > 1 ? t.length - 2 : 0;
    else if (t === 'hora') s.tipo = 'hora';
    else if (t === 'texto') s.tipo = 'texto';
  }
  function umbralValido(u, salidas) {
    if (!esObj(u) || !TONOS[u.tono]) return false;
    if (u.siempre === true) return typeof u.texto === 'string';
    return typeof u.salida === 'string' && typeof u.texto === 'string' && (u.igual !== undefined || U.isNum(u.mayor) || U.isNum(u.menor));
  }

  function normalizar(datos, ctx, comp) {
    if (!esObj(datos) || !Mod) return null;
    var blobDatos = U.norm(JSON.stringify(datos)), blob = blobDatos + ' ' + U.norm(comp && comp.titulo);
    function acepta(i) { var d = Mod.get(i); return !d.requiereDatos || (isFn(d.desdeDatos) && !!d.desdeDatos(datos)); }
    var id = (typeof datos.modelo === 'string' && Mod.has(datos.modelo)) ? datos.modelo : Mod.inferir(blob, acepta);
    if (!id) return null;
    var def = Mod.get(id), extra = isFn(def.desdeDatos) ? def.desdeDatos(datos) : null;
    if (def.requiereDatos && !extra) return null;
    extra = extra || {};

    /* controles: los del modelo (los opcionales sólo si el esbozo los nombra) + los ajustes del esbozo */
    var over = Array.isArray(datos.controles) ? datos.controles : (Array.isArray(datos.entradas) ? datos.entradas : []);
    var listados = {};
    over.forEach(function (o) { if (esObj(o) && typeof o.id === 'string') listados[o.id] = true; });
    var canon = Object.keys(listados).length > 0;   // esquema canónico: los controles opcionales son los que la lista nombra; en un esbozo libre se buscan por palabras
    var ctrls = def.controles.filter(function (c) { return !c.opcional || listados[c.id] || (!canon && coincide(c, blobDatos)); }).map(function (c) {
      var k = clone(c); k.claves = c.claves; return k;
    });
    function buscar(o) {
      var i, t = esObj(o) ? (String(o.id || '') + ' ' + String(o.etiqueta || '')) : String(o);
      if (esObj(o) && o.id) for (i = 0; i < ctrls.length; i++) if (ctrls[i].id === o.id) return ctrls[i];
      for (i = 0; i < ctrls.length; i++) if (coincide(ctrls[i], t)) return ctrls[i];
      return null;
    }
    over.forEach(function (o) {
      if (typeof o === 'string') {
        var p = parseEntrada(o), c = buscar(p.texto);
        if (c && p.min !== undefined && c.tipo === 'rango') { c.min = p.min; c.max = p.max; if (p.unidad) c.unidad = p.unidad; c.marcas = null; c.zonas = null; c.rapidos = null; if (!(c.valor >= p.min && c.valor <= p.max)) c.valor = (p.min + p.max) / 2; }
      } else if (esObj(o)) { var c2 = buscar(o); if (c2) ajustar(c2, o); }
    });
    (extra.controles || []).forEach(function (o) { var c = buscar(o); if (c) ajustar(c, o); });
    ctrls = ctrls.map(function (c) { var r = limpiarControl(c); ['marcas', 'zonas', 'rapidos'].forEach(function (k) { if (!r[k]) delete r[k]; }); return r; });
    var ids = {}; ctrls.forEach(function (c) { ids[c.id] = c; });

    /* salidas */
    var sal = def.salidas.map(clone), listadas = arr(datos.salidas).filter(esObj);
    if (listadas.length && listadas.length === arr(datos.salidas).length && listadas.every(function (o) { return sal.some(function (s) { return s.id === o.id; }); })) {
      sal = listadas.map(function (o) {
        var s = clone(sal.filter(function (x) { return x.id === o.id; })[0]);
        ['etiqueta', 'unidad'].forEach(function (k) { if (typeof o[k] === 'string' && o[k]) s[k] = o[k]; });
        if (U.isNum(o.dec)) s.dec = o.dec;
        formatoSalida(s, o.formato);
        return s;
      });
    }
    var sIds = {}; sal.forEach(function (s) { sIds[s.id] = s; });

    /* gráfico, umbrales, escenarios, consigna, nota */
    var g = esObj(datos.grafico) && ids[datos.grafico.x] && arr(datos.grafico.y).length ? datos.grafico : def.grafico;
    var grafico = null;
    if (esObj(g) && ids[g.x] && ids[g.x].tipo === 'rango' && !ids[g.x].fijo) {
      var ys = arr(g.y).filter(function (y) { return typeof y === 'string'; });
      if (ys.length) grafico = { tipo: 'linea', x: g.x, y: ys, etiquetaX: g.etiquetaX || '', etiquetaY: g.etiquetaY || '', lineas: arr(g.lineas) };
    }
    var umb = arr(datos.umbrales).map(function (u) {
      if (!esObj(u)) return u;
      var k = clone(u);
      if (U.isNum(k.limite) && k.mayor === undefined && k.menor === undefined) { if (k.sentido === 'menor') k.menor = k.limite; else k.mayor = k.limite; }
      if (!TONOS[k.tono] && typeof k.color === 'string') k.tono = U.tonoDe(k.color) || 'warn';
      if (typeof k.texto !== 'string' && typeof k.salida === 'string') k.texto = 'Atención con ' + k.salida;
      return k;
    }).filter(umbralValido);
    if (!umb.length) umb = clone(arr(def.umbrales));
    var esc = arr(datos.escenarios).filter(function (e) { return esObj(e) && esObj(e.valores); });
    if (!esc.length) esc = arr(extra.escenarios).length ? extra.escenarios : arr(def.escenarios);
    esc = clone(esc).map(function (e) {
      var v = {}; Object.keys(e.valores).forEach(function (k) { if (ids[k]) v[k] = e.valores[k]; });
      return { nombre: String(e.nombre || e.id || 'Escenario'), valores: v };
    }).filter(function (e) { return Object.keys(e.valores).length; });
    var cons = esObj(datos.consigna) && typeof datos.consigna.texto === 'string' && typeof datos.consigna.salida === 'string' ? clone(datos.consigna)
      : (def.consigna && def.consignaSi && def.consignaSi.test(blob) ? clone(def.consigna) : null);
    var nota = [datos.nota, datos.aclaracion, typeof datos.etiqueta === 'string' ? datos.etiqueta : null].filter(function (t) { return typeof t === 'string' && t.trim(); })[0] || '';

    return { modelo: id, nombre: def.nombre, resumen: def.resumen || '', controles: ctrls, salidas: sal, grafico: grafico, umbrales: umb, escenarios: esc, consigna: cons, nota: nota, params: extra.params || {} };
  }

  /* ================================================================== render */
  function evaluarUmbral(u, out) {
    if (u.siempre) return true;
    var v = out[u.salida];
    if (u.igual !== undefined) return v === u.igual;
    if (!U.isNum(v)) return false;
    return (U.isNum(u.mayor) && v > u.mayor) || (U.isNum(u.menor) && v < u.menor);
  }
  function cumple(c, out) {
    var v = out[c.salida];
    if (c.igual !== undefined) return v === c.igual;
    if (!U.isNum(v)) return false;
    if (Array.isArray(c.entre)) return v >= c.entre[0] && v <= c.entre[1];
    return (U.isNum(c.mayor) && v > c.mayor) || (U.isNum(c.menor) && v < c.menor);
  }
  function textoSalida(s, v) {
    if (s.tipo === 'texto' || s.tipo === 'hora' || typeof v === 'string') return String(v === undefined ? '—' : v);
    return (s.signo && v > 0.0000001 ? '+' : '') + U.fmt(v, s.dec || 0);
  }
  function textoControl(c, v) {
    if (c.tipo === 'opcion' || c.tipo === 'hora') return String(v);
    var t = c.pad ? U.pad2(v) : U.fmt(v, (String(c.paso).split('.')[1] || '').length);
    return t + (c.unidad ? (/^[°%]/.test(c.unidad) ? '' : ' ') + c.unidad : '');
  }

  function render(host, datos, ctx) {
    var K = ctx.Kit, h = ctx.h, icon = ctx.icon;
    var vals = {}, ctls = {}, outs = {}, barras = {}, ultimoCtl = null, movimientos = 0, logrado = false, ySel = datos.grafico ? datos.grafico.y[0] : null;
    datos.controles.forEach(function (c) { vals[c.id] = c.valor; });
    var porId = {}; datos.controles.forEach(function (c) { porId[c.id] = c; });
    var salId = {}; datos.salidas.forEach(function (s) { salId[s.id] = s; });

    var root_ = h('div', { 'class': 'es-sim' });
    /* ---- semáforo */
    var pillTxt = h('span', { 'class': 'es-pill-t' }), pill = h('p', { 'class': 'es-pill is-info', role: 'status', 'aria-live': 'polite' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }), pillTxt);
    pill.hidden = true;
    /* ---- salidas: cifras grandes + barras */
    var grid = h('div', { 'class': 'es-outs' }), filasBarra = [];
    datos.salidas.forEach(function (s) {
      var st = K.stat({ label: s.etiqueta, value: '—', unit: s.unidad || '', small: s.tipo === 'texto' || s.tipo === 'hora' ? false : !s.destacada });
      if (s.tipo === 'texto') st.classList.add('es-out-text');
      outs[s.id] = st; grid.appendChild(st);
      if (s.barra) filasBarra.push({ key: s.id, label: s.etiqueta + (s.unidad ? ' (' + s.unidad + ')' : '') });
    });
    var barEl = null;
    if (filasBarra.length) {
      barEl = K.bars({ rows: filasBarra });
      var tracks = barEl.querySelectorAll('.bar-track'), rows = barEl.querySelectorAll('.bar-row');
      filasBarra.forEach(function (f, i) {
        var b = salId[f.key].barra; barras[f.key] = { row: rows[i], b: b };
        if (U.isNum(b.marca)) {
          var m = h('span', { 'class': 'es-barmark', 'aria-hidden': 'true', title: 'Marca: ' + U.fmt(b.marca, 0) });
          m.style.left = (100 * (b.marca - b.min) / ((b.max - b.min) || 1)) + '%'; tracks[i].appendChild(m);
        }
      });
    }

    /* ---- gráfico */
    var grafico = datos.grafico ? crearGrafico() : null;
    function crearGrafico() {
      var g = datos.grafico, xc = porId[g.x], W = 320, H = 176, L = 42, R = 12, T = 14, B = 32;
      var svg = U.svg('svg', { 'class': 'es-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', preserveAspectRatio: 'xMidYMid meet' });
      var capa = U.svg('g'), yTxt = h('p', { 'class': 'es-meta es-chart-y' });
      svg.appendChild(capa);
      var fig = h('figure', { 'class': 'es-fig' }, svg);
      var sel = null;
      if (g.y.length > 1) {
        sel = K.segmented({ items: g.y.map(function (y) { return { value: y, label: (salId[y] ? salId[y].etiqueta : y) }; }), value: ySel, label: 'Qué mostrar en el gráfico', onChange: function (v) { ySel = v; refrescar(); } });
        sel.classList.add('es-fig-seg');
      }
      function sx(x) { return L + (W - L - R) * (x - xc.min) / ((xc.max - xc.min) || 1); }
      function mover(ev) {
        var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
        var x = xc.min + (px - L) / (W - L - R) * (xc.max - xc.min);
        x = U.clamp(Math.round(x / xc.paso) * xc.paso, xc.min, xc.max);
        ponerValor(xc.id, x, true);
      }
      var arrastrando = false;
      svg.addEventListener('pointerdown', function (ev) { arrastrando = true; try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ } mover(ev); });
      svg.addEventListener('pointermove', function (ev) { if (arrastrando) mover(ev); });
      svg.addEventListener('pointerup', function () { arrastrando = false; });
      svg.addEventListener('pointercancel', function () { arrastrando = false; });
      return {
        svg: svg,
        el: h('div', { 'class': 'es-chartbox' }, sel, fig, h('p', { 'class': 'es-meta es-chart-h', text: 'Tocá o arrastrá el gráfico para mover «' + xc.etiqueta + '»' })),
        update: function (out) {
          var ys = ySel || g.y[0], N = 70, pts = [], i, mn = Infinity, mx = -Infinity, copia = {};
          for (var k in vals) copia[k] = vals[k];
          for (i = 0; i <= N; i++) {
            var x = xc.min + (xc.max - xc.min) * i / N; copia[xc.id] = x;
            var y = Mod.calc(datos.modelo, copia, datos.params)[ys];
            if (U.isNum(y)) { pts.push([x, y]); mn = Math.min(mn, y); mx = Math.max(mx, y); }
          }
          if (!pts.length) return;
          if (mn >= 0 && mn < mx * 0.4) mn = 0;
          if (mx === mn) { mx += 1; mn -= 1; }
          var pad = (mx - mn) * 0.06; mx += pad; if (mn !== 0) mn -= pad;
          function sy(y) { return T + (H - T - B) * (1 - (y - mn) / ((mx - mn) || 1)); }
          while (capa.firstChild) capa.removeChild(capa.firstChild);
          arr(xc.zonas).forEach(function (z) {
            capa.appendChild(U.svg('rect', { x: sx(Math.max(z.desde, xc.min)), y: T, width: Math.max(0, sx(Math.min(z.hasta, xc.max)) - sx(Math.max(z.desde, xc.min))), height: H - T - B, fill: U.TONO[z.tono] || 'var(--ok)', opacity: 0.13 }));
          });
          for (i = 0; i <= 4; i++) {
            var yv = mn + (mx - mn) * i / 4;
            capa.appendChild(U.svg('line', { x1: L, x2: W - R, y1: sy(yv), y2: sy(yv), 'class': 'es-chart-grid' }));
            capa.appendChild(U.svg('text', { x: L - 5, y: sy(yv) + 3.5, 'text-anchor': 'end', 'class': 'es-chart-tx' }, U.fmt(yv, Math.abs(mx - mn) < 5 ? 1 : 0)));
          }
          var marcas = arr(xc.marcas).length ? xc.marcas : [0, 1, 2, 3, 4].map(function (j) { var v = xc.min + (xc.max - xc.min) * j / 4; return { v: v, t: U.fmt(v, 0) }; });
          marcas.forEach(function (m) {
            capa.appendChild(U.svg('text', { x: sx(m.v), y: H - B + 13, 'text-anchor': 'middle', 'class': 'es-chart-tx' }, m.t));
          });
          capa.appendChild(U.svg('text', { x: (L + W - R) / 2, y: H - 4, 'text-anchor': 'middle', 'class': 'es-chart-ax' }, g.etiquetaX || xc.etiqueta));
          var yEt = (g.y.length > 1 || !g.etiquetaY) ? (salId[ys] ? salId[ys].etiqueta + (salId[ys].unidad ? ' (' + salId[ys].unidad + ')' : '') : ys) : g.etiquetaY;
          capa.appendChild(U.svg('text', { x: L, y: 9, 'class': 'es-chart-ax' }, yEt));
          arr(g.lineas).forEach(function (ln) {
            var xv = typeof ln.x === 'string' ? out[ln.x] : ln.x;
            if (!U.isNum(xv) || xv < xc.min || xv > xc.max) return;
            capa.appendChild(U.svg('line', { x1: sx(xv), x2: sx(xv), y1: T, y2: H - B, 'class': 'es-chart-ref' }));
            capa.appendChild(U.svg('text', { x: sx(xv) - 3, y: T + 10, 'text-anchor': 'end', 'class': 'es-chart-tx' }, ln.texto || ''));
          });
          capa.appendChild(U.svg('path', { d: pts.map(function (p, j) { return (j ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join(' '), 'class': 'es-chart-line', fill: 'none' }));
          var cy = out[ys];
          if (U.isNum(cy)) {
            capa.appendChild(U.svg('line', { x1: sx(vals[xc.id]), x2: sx(vals[xc.id]), y1: sy(Math.max(mn, Math.min(mx, cy))), y2: H - B, 'class': 'es-chart-drop' }));
            capa.appendChild(U.svg('circle', { cx: sx(vals[xc.id]), cy: sy(Math.max(mn, Math.min(mx, cy))), r: 5.5, 'class': 'es-chart-dot' }));
          }
          svg.setAttribute('aria-label', 'Gráfico de ' + (salId[ys] ? salId[ys].etiqueta : ys) + ' según ' + xc.etiqueta + '. Ahora: ' + textoControl(xc, vals[xc.id]) + ', ' + (U.isNum(cy) ? U.fmt(cy, 2) : '') + '.');
        }
      };
    }

    /* ---- controles */
    var cBox = h('div', { 'class': 'es-sim-ctls' });
    function colorZona(z) { return U.TONO[z.tono] || 'var(--ok)'; }
    datos.controles.forEach(function (c) {
      if (c.fijo) { cBox.appendChild(h('p', { 'class': 'es-fixed' }, h('span', { text: c.etiqueta }), h('b', { text: textoControl(c, c.valor) }))); return; }
      if (c.tipo === 'rango') {
        var o = { label: c.etiqueta, min: c.min, max: c.max, step: c.paso, value: c.valor, format: function (v) { return textoControl(c, v); }, big: false,
          onInput: function (v) { ponerValor(c.id, v, true); } };
        if (c.zonas) o.zones = c.zonas.map(function (z) { return { from: z.desde, to: z.hasta, color: colorZona(z) }; });
        if (c.marcas) o.ticks = c.marcas.map(function (m) { return { v: m.v, t: m.t }; });
        if (c.rapidos) o.quick = c.rapidos.map(function (q) { return { v: q.v, t: q.t }; });
        ctls[c.id] = K.slider(o); cBox.appendChild(ctls[c.id]);
      } else if (c.tipo === 'opcion') {
        var seg = K.segmented({ items: c.opciones.map(function (x) { return { value: x, label: x }; }), value: c.valor, label: c.etiqueta, onChange: function (v) { ponerValor(c.id, v, true); } });
        ctls[c.id] = seg;
        cBox.appendChild(h('div', { 'class': 'ctl es-ctl-opt' }, h('div', { 'class': 'ctl-top' }, h('span', { 'class': 'ctl-lbl', text: c.etiqueta })), seg));
      } else if (c.tipo === 'hora') {
        var inp = h('input', { type: 'time', 'class': 'es-time', value: c.valor, id: 'es-sim-' + c.id + '-' + ctx.key, 'aria-label': c.etiqueta });
        inp.addEventListener('input', function () { if (U.horaAMin(inp.value) !== null) ponerValor(c.id, inp.value, true); });
        ctls[c.id] = inp;
        cBox.appendChild(h('div', { 'class': 'ctl es-ctl-hora' }, h('div', { 'class': 'ctl-top' }, h('label', { 'class': 'ctl-lbl', 'for': inp.id, text: c.etiqueta })), inp));
      }
    });

    /* ---- escenarios y consigna */
    var escBox = null;
    if (datos.escenarios.length) {
      escBox = h('div', { 'class': 'es-esc', role: 'group', 'aria-label': 'Escenarios para probar' }, h('span', { 'class': 'es-meta', text: 'Probá un caso' }));
      datos.escenarios.forEach(function (e) {
        escBox.appendChild(h('button', { type: 'button', 'class': 'es-chip', onclick: function () {
          Object.keys(e.valores).forEach(function (k) { ponerValor(k, e.valores[k], true, true); });
          movimientos++; refrescar();
        } }, e.nombre));
      });
    }
    var consEl = null, consEstado = null;
    if (datos.consigna) {
      consEstado = h('span', { 'class': 'es-task-s' });
      consEl = h('p', { 'class': 'es-task', 'aria-live': 'polite' }, icon('target'), h('span', { 'class': 'es-task-t', text: datos.consigna.texto }), consEstado);
    }
    var nota = datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null;

    K.add(root_, [consEl, pill, grid, barEl, grafico && grafico.el, cBox, escBox, nota]);
    host.appendChild(root_);
    var offEt = grafico && grafico.svg ? U.escalarEtiquetas(grafico.svg, { sinEscala: true }) : null;       // los rótulos del gráfico no se recortan en el borde (F2)

    /* ---- lógica */
    function ponerValor(id, v, manual, silencioso) {
      var c = porId[id]; if (!c || c.fijo) return;
      if (c.tipo === 'rango') v = U.clamp(U.num(v, c.valor), c.min, c.max);
      if (vals[id] === v && silencioso !== true) { return; }
      vals[id] = v; ultimoCtl = c;
      var w = ctls[id];
      if (w) { if (c.tipo === 'rango' && isFn(w.set)) w.set(v); else if (c.tipo === 'opcion' && isFn(w.setValue)) w.setValue(v); else if (c.tipo === 'hora') w.value = v; }
      if (manual && !silencioso) { movimientos++; }
      if (!silencioso) refrescar();
    }
    function refrescar() {
      var out = Mod.calc(datos.modelo, vals, datos.params);
      datos.salidas.forEach(function (s) {
        var v = out[s.id];
        outs[s.id].set(textoSalida(s, v), s.unidad || '');
        if (barras[s.id]) {
          var b = barras[s.id].b, f = U.isNum(v) ? (v - b.min) / ((b.max - b.min) || 1) : 0;
          barEl.set(s.id, f, textoSalida(s, v));
          var tono = null;
          datos.umbrales.some(function (u) { if (u.salida === s.id && evaluarUmbral(u, out)) { tono = u.tono; return true; } return false; });
          if (barras[s.id].row) barras[s.id].row.style.setProperty('--c', tono ? U.TONO[tono] : 'var(--accent)');
        }
      });
      var est = out._estado || null;
      if (!est) datos.umbrales.some(function (u) { if (evaluarUmbral(u, out)) { est = { tono: u.tono, texto: u.texto }; return true; } return false; });
      if (est) { pill.hidden = false; pill.className = 'es-pill is-' + (TONOS[est.tono] ? est.tono : 'info'); if (pillTxt.textContent !== est.texto) pillTxt.textContent = est.texto; } else pill.hidden = true;
      if (grafico) grafico.update(out);
      if (datos.consigna) {
        var ok = cumple(datos.consigna, out);
        consEl.classList.toggle('is-ok', ok || logrado); consEstado.textContent = (ok || logrado) ? ' ¡Lo lograste!' : '';
        if (ok && !logrado) { logrado = true; if (isFn(ctx.score)) ctx.score(1, 1, { id: 'consigna' }); ctx.done(); }
      } else if (!logrado && movimientos >= 4) { logrado = true; ctx.done(); }
      return out;
    }
    if (ctx.hecho) logrado = true;
    refrescar();
    if (datos.consigna && ctx.hecho) { consEl.classList.add('is-ok'); consEstado.textContent = ' ¡Lo lograste!'; }

    return {
      destroy: function () { if (offEt) offEt(); },
      getState: function () { return { modelo: datos.modelo, valores: JSON.parse(JSON.stringify(vals)), movimientos: movimientos, logrado: logrado }; },
      set: function (id, v) { ponerValor(id, v, true); }
    };
  }

  Mot.register('simulador', { normalizar: normalizar, render: render });
  Mot.simuladorNormalizar = normalizar;
})(root.C150);
