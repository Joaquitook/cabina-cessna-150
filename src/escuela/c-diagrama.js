var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-diagrama.js — componente `diagrama` (DGR): un dibujo SVG con capas que se prenden y apagan, puntos que abren una ficha, zoom y
 * desplazamiento, y un MODO PRUEBA que esconde los nombres y te pide ubicarlos (contrato v7, E2). Los dibujos son propios (nunca la imagen del curso).
 *
 * ESQUEMA DE `datos` (canónico):
 *   { viewBox:'0 0 400 220',
 *     capas:[{ id, nombre, svg?, visible? }],                  svg: formas SVG (g, path, line, rect, circle, ellipse, polygon, polyline, text) con las clases dg-* de styles.css;
 *                                                              se limpian (sin scripts, enlaces ni estilos en línea)
 *     hotspots:[{ id, x, y, titulo, texto, capa?, r?, w?, h?, tono? }],    x,y en coordenadas del viewBox; con w y h es una CAJA (centro x,y) y el nombre va adentro
 *     conectores?:[[idA, idB]],                                líneas entre cajas
 *     figura?:'perfil-ala'|'ala-planta',                       una figura propia de C150.ESCUELA.figuras (trae viewBox, capas y hotspots; `capas:[ids]` elige cuáles)
 *     modoPrueba?:bool,                                        ofrece el modo prueba (por defecto sí con 3 o más puntos)
 *     nota?:'texto' }
 *   Los esbozos del plan (sin coordenadas) se ACOMODAN SOLOS: normalizar toma la lista que encuentre (hotspots, estaciones, escalones, nodos, regiones, puntos,
 *   tramos, fichas, pantallas, alertas, perfiles…), arma una caja por elemento (título + ficha con el resto de los datos) y las dispone como camino, escalera,
 *   niveles (si traen `nivel`), columna (regiones de color) o rejilla; si traen `capa` arma una capa por grupo. Una lista de capas por nombre
 *   (["contorno","cuerda","presión"…]) elige la figura propia que las tenga. Si no encuentra nada sensato devuelve null.
 * Teclado: los puntos se enfocan con Tab y se abren con Enter o espacio; en el recuadro, + − 0 y las flechas hacen zoom y desplazamiento. Rueda con Ctrl o ⌘, pellizco y arrastre cuando hay zoom.
 * Completa la lección (ctx.done()) al abrir varios puntos o al terminar el modo prueba; el modo prueba suma ctx.score(bien, total, {fallos:[ids]}).
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes, Mod = ES.modelos, U = Mod && Mod.util;
  if (!Mot || !Mod) return;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(x) { return typeof x === 'string' ? x.trim() : (typeof x === 'number' ? String(x) : ''); }

  /* ================================================================== normalizar (puro) */
  var CLAVES = [['hotspots', 'rejilla'], ['estaciones', 'camino'], ['escalones', 'escalera'], ['nodos', 'niveles'], ['regiones', 'columna'], ['puntos', 'rejilla'], ['tramos', 'camino'],
    ['fichas', 'rejilla'], ['pantallas', 'camino'], ['alertas', 'rejilla'], ['perfiles', 'rejilla'], ['controles', 'rejilla'], ['items', 'rejilla']];
  var TITULOS = ['titulo', 'etiqueta', 'nombre', 'cargo', 'materia', 'zona', 'escalon', 'estacion', 'tramo', 'region', 'label'];
  var EXCL = { id: 1, nivel: 1, capa: 1, color: 1, n: 1, fuente: 1, complemento: 1, solo: 1, x: 1, y: 1, r: 1, forma: 1, w: 1, h: 1, orden: 1, tono: 1, resaltar: 1, nota: 1, notas: 1 };
  var PLANOS = { texto: 1, linea: 1, descripcion: 1, explicacion: 1 };
  var ROTULOS = { pagina: 'Página', paginas: 'Páginas', modulo: 'Módulo', unidad: 'Unidad', unidades: 'Unidades', claves: 'Lo clave', puntos: 'Puntos', items: 'Incluye', opciones: 'Opciones', estudio: 'Estudio', lugar: 'Lugar', descripcion: 'Descripción', seccion: 'Sección' };
  function etiquetaClave(k) { if (ROTULOS[k]) return ROTULOS[k]; var t = String(k).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); }
  function privado(t) { return /a confirmar|confirmar con|instructor/i.test(t); }

  /** Un elemento libre (texto u objeto) → { id, titulo, texto, tono, capa, nivel }. */
  function elemento(o, i) {
    if (typeof o === 'string' || typeof o === 'number') { var t0 = str(o); return t0 ? { id: 'h' + (i + 1), titulo: t0, texto: '', tono: null, capa: '', nivel: null } : null; }
    if (!esObj(o)) return null;
    var tk = null, k;
    for (var j = 0; j < TITULOS.length; j++) if (str(o[TITULOS[j]])) { tk = TITULOS[j]; break; }
    if (!tk && str(o.texto)) tk = 'texto';
    if (!tk && str(o.id) && Array.isArray(o.opciones)) tk = 'id';
    if (!tk) return null;
    var titulo = str(o[tk]);
    if (U.isNum(o.n) && !/^\d+[.)]/.test(titulo)) titulo = o.n + '. ' + titulo;
    var lineas = [], vistos = {};
    vistos[tk] = 1;
    for (k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k) || EXCL[k] || vistos[k]) continue;
      var v = o[k], t = '';
      if (typeof v === 'string' || typeof v === 'number') t = String(v).trim();
      else if (Array.isArray(v) && v.length && v.every(function (x) { return typeof x === 'string' || typeof x === 'number'; })) t = v.join(' · ');
      if (!t || privado(t)) continue;
      lineas.push(PLANOS[k] ? t : etiquetaClave(k) + ': ' + t);
    }
    return { id: str(o.id) || 'h' + (i + 1), titulo: titulo, texto: lineas.join('\n'), tono: U.tonoDe(o.color || o.tono), capa: str(o.capa), nivel: U.isNum(o.nivel) ? o.nivel : null };
  }

  /** Dispone los elementos en un viewBox de ancho 360. Devuelve { viewBox, hotspots, conectores }. */
  function disponer(els, modo) {
    var W = 360, P = 14, n = els.length, hs = [], con = [], i, H;
    function caja(e, x, y, w, h) { return { id: e.id, x: Math.round(x + w / 2), y: Math.round(y + h / 2), w: Math.round(w), h: Math.round(h), forma: 'caja', titulo: e.titulo, texto: e.texto, tono: e.tono || undefined, capa: e.capa || undefined }; }
    if (modo === 'escalera') {
      var bw = 168, bh = 40, gap = 8, dx = n > 1 ? Math.min(40, (W - 2 * P - bw) / (n - 1)) : 0;
      H = P * 2 + n * (bh + gap);
      els.forEach(function (e, k) { hs.push(caja(e, P + k * dx, H - P - bh - k * (bh + gap), bw, bh)); });
    } else if (modo === 'columna') {
      bh = 60; gap = 8; H = P * 2 + n * (bh + gap) - gap;
      els.forEach(function (e, k) { hs.push(caja(e, P, P + k * (bh + gap), W - 2 * P, bh)); });
    } else if (modo === 'niveles') {
      var niv = {}, ks = [];
      els.forEach(function (e) { var l = e.nivel === null ? 0 : e.nivel; if (!niv[l]) { niv[l] = []; ks.push(l); } niv[l].push(e); });
      ks.sort(function (a, b) { return a - b; });
      bh = 46; gap = 8; var rg = 26; H = P * 2 + ks.length * bh + (ks.length - 1) * rg;
      ks.forEach(function (l, r) {
        var fila = niv[l], c = fila.length, w = (W - 2 * P - (c - 1) * gap) / c;
        fila.forEach(function (e, k) { hs.push(caja(e, P + k * (w + gap), P + r * (bh + rg), w, bh)); });
      });
    } else {
      var cols = modo === 'camino' ? Math.min(3, n) : (n <= 2 ? n : (n <= 4 ? 2 : 3)), rows = Math.ceil(n / cols);
      bh = 56; gap = 14; var w2 = (W - 2 * P - (cols - 1) * gap) / cols; H = P * 2 + rows * bh + (rows - 1) * (modo === 'camino' ? 26 : gap);
      els.forEach(function (e, k) {
        var r = Math.floor(k / cols), c = k % cols;
        if (modo === 'camino' && r % 2 === 1) c = cols - 1 - c;
        hs.push(caja(e, P + c * (w2 + gap), P + r * (bh + (modo === 'camino' ? 26 : gap)), w2, bh));
      });
      if (modo === 'camino') for (i = 0; i < n - 1; i++) con.push([els[i].id, els[i + 1].id]);
    }
    return { viewBox: '0 0 ' + W + ' ' + Math.round(H), hotspots: hs, conectores: con };
  }

  function normalizar(datos, ctx, comp) {
    var Fig = ES.figuras;
    if (!esObj(datos) || !Fig) return null;
    var nota = [datos.nota, datos.aclaracion, datos.mensajeFijo].filter(function (t) { return typeof t === 'string' && t.trim(); })[0] || '';
    var prueba = datos.modoPrueba;

    /* 1) figura propia: por id, o por los nombres de sus capas / vistas */
    var nombres = arr(datos.capas).concat(arr(datos.vistas)).map(function (c) { return esObj(c) ? (str(c.nombre) || str(c.id)) : str(c); }).filter(Boolean);
    var figId = (typeof datos.figura === 'string' && Fig.has(datos.figura)) ? datos.figura : ((!arr(datos.hotspots).some(function (x) { return esObj(x) && U.isNum(x.x); }) && nombres.length >= 2) ? Fig.paraNombres(nombres) : null);
    if (figId) {
      var f = Fig.get(figId), ns = nombres.map(U.norm), usar = f.capas.filter(function (c) { return !ns.length || ns.some(function (x) { return x.length >= 3 && (U.norm(c.id).indexOf(x) >= 0 || U.norm(c.nombre).indexOf(x) >= 0 || x.indexOf(U.norm(c.id)) >= 0); }); });
      if (!usar.length) usar = f.capas;
      var ids = {}; usar.forEach(function (c) { ids[c.id] = 1; });
      var hs = f.hotspots.filter(function (x) { return !x.capa || ids[x.capa]; });
      return { viewBox: f.viewBox, capas: usar.map(function (c) { return { id: c.id, nombre: c.nombre, svg: c.svg, visible: c.visible !== false }; }), hotspots: hs, conectores: [], modoPrueba: prueba === undefined ? hs.length >= 3 : (prueba !== false && hs.length >= 2), nota: nota, figura: figId };
    }

    /* 2) canónico con coordenadas */
    var hc = arr(datos.hotspots).filter(function (x) { return esObj(x) && U.isNum(x.x) && U.isNum(x.y) && (str(x.titulo) || str(x.etiqueta) || str(x.nombre)); });
    if (hc.length >= 2 && hc.length === arr(datos.hotspots).length && typeof datos.viewBox === 'string' && /^\s*-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?){3}\s*$/.test(datos.viewBox)) {
      var capas = arr(datos.capas).filter(function (c) { return esObj(c) && str(c.id); }).map(function (c) { return { id: str(c.id), nombre: str(c.nombre) || str(c.id), svg: typeof c.svg === 'string' ? c.svg : '', visible: c.visible !== false }; });
      var hh = hc.map(function (x, i) {
        return { id: str(x.id) || 'h' + (i + 1), x: x.x, y: x.y, r: U.isNum(x.r) ? x.r : undefined, w: U.isNum(x.w) ? x.w : undefined, h: U.isNum(x.h) ? x.h : undefined, forma: U.isNum(x.w) && U.isNum(x.h) ? 'caja' : 'punto',
          titulo: str(x.titulo) || str(x.etiqueta) || str(x.nombre), texto: str(x.texto), tono: x.tono, capa: str(x.capa) || undefined };
      });
      return { viewBox: datos.viewBox.trim(), capas: capas, hotspots: hh, conectores: arr(datos.conectores).filter(function (c) { return Array.isArray(c) && c.length === 2; }), modoPrueba: prueba === undefined ? hh.length >= 3 : (prueba !== false && hh.length >= 2), nota: nota };
    }

    /* 3) un esbozo del plan: la lista que haya, acomodada sola */
    var modo = null, lista = null;
    for (var i = 0; i < CLAVES.length; i++) { var l = datos[CLAVES[i][0]]; if (Array.isArray(l) && l.length >= 2) { modo = CLAVES[i][1]; lista = l; break; } }
    if (!lista) return null;
    var els = lista.map(elemento).filter(Boolean), vistos = {};
    if (els.length < 2) return null;
    els.forEach(function (e) { while (vistos[e.id]) e.id += '_'; vistos[e.id] = 1; });
    if (modo === 'niveles' && !els.some(function (e) { return e.nivel !== null; })) modo = 'rejilla';
    if (modo === 'columna' && els.length > 5) modo = 'rejilla';
    var lay = disponer(els, modo), grupos = [];
    els.forEach(function (e) { if (e.capa && grupos.indexOf(e.capa) < 0) grupos.push(e.capa); });
    var capas2 = grupos.length >= 2 ? grupos.map(function (g, k) { return { id: 'c' + k, nombre: g, svg: '', visible: true }; }) : [];
    if (capas2.length) lay.hotspots.forEach(function (x) { var k = grupos.indexOf(x.capa); x.capa = k >= 0 ? 'c' + k : undefined; });
    else lay.hotspots.forEach(function (x) { delete x.capa; });
    return { viewBox: lay.viewBox, capas: capas2, hotspots: lay.hotspots, conectores: lay.conectores, modoPrueba: prueba === undefined ? els.length >= 3 : (prueba !== false), nota: nota, auto: modo };
  }

  /* ================================================================== render */
  function envolver(t, max, lineas) {
    var pal = String(t).split(/\s+/), out = [], cur = '';
    pal.forEach(function (p) {
      if ((cur + ' ' + p).trim().length <= max) cur = (cur + ' ' + p).trim();
      else { if (cur) out.push(cur); cur = p; }
    });
    if (cur) out.push(cur);
    if (out.length > lineas) { out = out.slice(0, lineas); out[lineas - 1] = out[lineas - 1].replace(/\s*\S{0,3}$/, '') + '…'; }
    return out;
  }

  function render(host, datos, ctx) {
    var Fig = ES.figuras, K = ctx.Kit, h = ctx.h, icon = ctx.icon, vb = datos.viewBox.split(/\s+/).map(Number), VW = vb[2], VH = vb[3], VX = vb[0], VY = vb[1];
    var vista = { s: 1, cx: VX + VW / 2, cy: VY + VH / 2 }, visibles = {}, sel = null, prueba = false, abiertos = {}, hecho = !!ctx.hecho, intento = 0;
    var porId = {}, els = {}, n = datos.hotspots.length;
    datos.hotspots.forEach(function (x, i) { x._n = i + 1; porId[x.id] = x; });
    datos.capas.forEach(function (c) { visibles[c.id] = c.visible !== false; });
    var UMBRAL = Math.min(n, Math.min(4, Math.max(2, Math.ceil(n / 2))));

    var svg = U.svg('svg', { 'class': 'dg-svg', viewBox: datos.viewBox, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': null });
    var gCapas = U.svg('g'), gCon = U.svg('g', { 'class': 'dg-con' }), gHot = U.svg('g');
    var capaEl = {};
    datos.capas.forEach(function (c) {
      var g = U.svg('g', { 'class': 'dg-capa', 'data-capa': c.id });
      if (c.svg && Fig) g.appendChild(Fig.seguro(c.svg));
      capaEl[c.id] = g; gCapas.appendChild(g);
    });
    arr(datos.conectores).forEach(function (c) {
      var a = porId[c[0]], b = porId[c[1]]; if (!a || !b) return;
      gCon.appendChild(U.svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    });
    datos.hotspots.forEach(function (x) {
      var g = U.svg('g', { 'class': 'dg-hot dg-hot--' + (x.forma === 'caja' ? 'caja' : 'punto'), tabindex: '0', role: 'button', 'data-id': x.id, 'aria-label': x._n + '. ' + x.titulo });
      if (x.forma === 'caja') {
        var w = x.w, hh = x.h, max = Math.max(6, Math.floor(w / 6.5)), lin = envolver(x.titulo, max, hh >= 50 ? 3 : 2);
        g.appendChild(U.svg('rect', { 'class': 'dg-box', x: x.x - w / 2, y: x.y - hh / 2, width: w, height: hh, rx: 8, 'data-tono': x.tono || null }));
        var tx = U.svg('text', { 'class': 'dg-tx', x: x.x, y: x.y - (lin.length - 1) * 7 + 4, 'text-anchor': 'middle' });
        lin.forEach(function (l, k) { tx.appendChild(U.svg('tspan', { x: x.x, dy: k ? 14 : 0 }, l)); });
        g.appendChild(tx);
        g.appendChild(U.svg('circle', { 'class': 'dg-num-bg', cx: x.x - w / 2 + 3, cy: x.y - hh / 2 + 3, r: 9 }));
        g.appendChild(U.svg('text', { 'class': 'dg-num', x: x.x - w / 2 + 3, y: x.y - hh / 2 + 6.4, 'text-anchor': 'middle' }, String(x._n)));
      } else {
        var r = x.r || 11;
        g.appendChild(U.svg('circle', { 'class': 'dg-dot', cx: x.x, cy: x.y, r: r + 5 }));
        g.appendChild(U.svg('circle', { 'class': 'dg-num-bg', cx: x.x, cy: x.y, r: r }));
        g.appendChild(U.svg('text', { 'class': 'dg-num', x: x.x, y: x.y + 4, 'text-anchor': 'middle' }, String(x._n)));
      }
      g.addEventListener('click', function () { if (arrastro) return; tocar(x.id); });
      g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tocar(x.id); } });
      els[x.id] = g; gHot.appendChild(g);
    });
    svg.appendChild(gCapas); svg.appendChild(gCon); svg.appendChild(gHot);

    /* ---- zoom y desplazamiento */
    var arrastro = false;
    function aplicarVista() {
      var w = VW / vista.s, hgt = VH / vista.s;
      vista.cx = Math.max(VX + w / 2, Math.min(VX + VW - w / 2, vista.cx)); vista.cy = Math.max(VY + hgt / 2, Math.min(VY + VH - hgt / 2, vista.cy));
      svg.setAttribute('viewBox', (vista.cx - w / 2) + ' ' + (vista.cy - hgt / 2) + ' ' + w + ' ' + hgt);
      view.classList.toggle('is-zoom', vista.s > 1.001);
      if (zIn) { zIn.disabled = vista.s >= 4; zOut.disabled = vista.s <= 1.001; zRe.disabled = vista.s <= 1.001 && Math.abs(vista.cx - (VX + VW / 2)) < 1; }
    }
    function zoom(f, px, py) {
      var s2 = Math.max(1, Math.min(4, vista.s * f)); if (s2 === vista.s) return;
      var w = VW / vista.s, hgt = VH / vista.s, fx = px === undefined ? 0.5 : px, fy = py === undefined ? 0.5 : py;
      var ax = vista.cx - w / 2 + fx * w, ay = vista.cy - hgt / 2 + fy * hgt;      // el punto bajo el dedo queda quieto
      var w2 = VW / s2, h2 = VH / s2;
      vista.s = s2; vista.cx = ax - fx * w2 + w2 / 2; vista.cy = ay - fy * h2 + h2 / 2; aplicarVista();
    }
    var ptrs = {}, ultimo = null, dist0 = 0;
    function relativo(ev) { var r = svg.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]; }
    svg.addEventListener('pointerdown', function (ev) {
      ptrs[ev.pointerId] = [ev.clientX, ev.clientY]; arrastro = false; ultimo = [ev.clientX, ev.clientY];
      var ks = Object.keys(ptrs); if (ks.length === 2) dist0 = Math.hypot(ptrs[ks[0]][0] - ptrs[ks[1]][0], ptrs[ks[0]][1] - ptrs[ks[1]][1]);
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!ptrs[ev.pointerId]) return;
      var ks = Object.keys(ptrs);
      if (ks.length === 2) {
        ptrs[ev.pointerId] = [ev.clientX, ev.clientY];
        var d = Math.hypot(ptrs[ks[0]][0] - ptrs[ks[1]][0], ptrs[ks[0]][1] - ptrs[ks[1]][1]);
        if (dist0 > 0 && Math.abs(d - dist0) > 4) { var r = svg.getBoundingClientRect(), mx = (ptrs[ks[0]][0] + ptrs[ks[1]][0]) / 2, my = (ptrs[ks[0]][1] + ptrs[ks[1]][1]) / 2; zoom(d / dist0, (mx - r.left) / r.width, (my - r.top) / r.height); dist0 = d; arrastro = true; }
        return;
      }
      if (vista.s <= 1.001) return;
      var dx = ev.clientX - ultimo[0], dy = ev.clientY - ultimo[1];
      if (!arrastro && Math.hypot(dx, dy) < 5) return;
      arrastro = true; var rr = svg.getBoundingClientRect();
      vista.cx -= dx / rr.width * (VW / vista.s); vista.cy -= dy / rr.height * (VH / vista.s); ultimo = [ev.clientX, ev.clientY]; aplicarVista();
    });
    function suelta(ev) { delete ptrs[ev.pointerId]; dist0 = 0; setTimeout(function () { arrastro = false; }, 0); }
    svg.addEventListener('pointerup', suelta); svg.addEventListener('pointercancel', suelta);
    svg.addEventListener('wheel', function (ev) { if (!(ev.ctrlKey || ev.metaKey)) return; ev.preventDefault(); var p = relativo(ev); zoom(ev.deltaY < 0 ? 1.2 : 1 / 1.2, p[0], p[1]); }, { passive: false });
    var view = h('div', { 'class': 'es-dgr-view', tabindex: '0', role: 'group', 'aria-label': 'Dibujo. Con el teclado: más y menos para el zoom, flechas para moverte, Tab para recorrer los puntos.' }, svg);
    view.addEventListener('keydown', function (ev) {
      var k = ev.key, paso = 0.12 * VW / vista.s;
      if (k === '+' || k === '=') { zoom(1.25); ev.preventDefault(); } else if (k === '-' || k === '_') { zoom(0.8); ev.preventDefault(); } else if (k === '0') { vista.s = 1; vista.cx = VX + VW / 2; vista.cy = VY + VH / 2; aplicarVista(); ev.preventDefault(); }
      else if (ev.target === view && vista.s > 1.001 && /^Arrow/.test(k)) { vista.cx += (k === 'ArrowRight' ? paso : k === 'ArrowLeft' ? -paso : 0); vista.cy += (k === 'ArrowDown' ? paso : k === 'ArrowUp' ? -paso : 0); aplicarVista(); ev.preventDefault(); }
    });
    var zIn = K.iconButton({ icon: 'plus', label: 'Acercar', small: true, onClick: function () { zoom(1.3); } }), zOut = K.iconButton({ icon: 'minus', label: 'Alejar', small: true, onClick: function () { zoom(1 / 1.3); } }),
      zRe = K.iconButton({ icon: 'reset', label: 'Ver todo el dibujo', small: true, onClick: function () { vista.s = 1; vista.cx = VX + VW / 2; vista.cy = VY + VH / 2; aplicarVista(); } });
    [zIn, zOut, zRe].forEach(function (b) { b.classList.add('es-dgr-z'); });

    /* ---- barra: modos, capas, zoom */
    var modos = n >= 2 && datos.modoPrueba ? K.segmented({ items: [{ value: 'explorar', label: 'Explorar' }, { value: 'prueba', label: 'Modo prueba' }], value: 'explorar', label: 'Qué querés hacer', onChange: function (v) { entrarModo(v === 'prueba'); } }) : null;
    var capasBox = null;
    var capasUsadas = datos.capas.filter(function (c) { return c.svg || datos.hotspots.some(function (x) { return x.capa === c.id; }); });
    if (capasUsadas.length >= 2 || (capasUsadas.length === 1 && capasUsadas[0].svg)) {
      capasBox = h('div', { 'class': 'es-esc es-dgr-capas', role: 'group', 'aria-label': 'Capas del dibujo' }, h('span', { 'class': 'es-meta', text: 'Capas' }));
      capasUsadas.forEach(function (c) {
        var b = h('button', { type: 'button', 'class': 'es-chip es-chip--layer', 'aria-pressed': visibles[c.id] ? 'true' : 'false', onclick: function () {
          visibles[c.id] = !visibles[c.id]; b.setAttribute('aria-pressed', visibles[c.id] ? 'true' : 'false'); pintarCapas();
        } }, c.nombre);
        capasBox.appendChild(b);
      });
    }
    function pintarCapas() {
      datos.capas.forEach(function (c) { capaEl[c.id].style.display = visibles[c.id] ? '' : 'none'; });
      datos.hotspots.forEach(function (x) { var v = (!x.capa || visibles[x.capa] !== false); els[x.id].style.display = v ? '' : 'none'; if (leyBtn[x.id]) leyBtn[x.id].parentNode.hidden = !v; });
      if (sel && porId[sel].capa && visibles[porId[sel].capa] === false) { sel = null; pintarFicha(); }
    }
    /* ---- leyenda: los puntos sueltos no llevan el nombre al lado (se pisarían); lo lleva esta lista, que además sirve para el dedo y el teclado */
    var hayPuntos = datos.hotspots.some(function (x) { return x.forma !== 'caja'; }), leyenda = null, leyBtn = {};
    if (hayPuntos) {
      leyenda = h('ul', { 'class': 'es-dgr-leg', 'aria-label': 'Puntos del dibujo' });
      datos.hotspots.forEach(function (x) {
        if (x.forma === 'caja') return;
        var b = h('button', { type: 'button', 'class': 'es-dgr-leg-b', onclick: function () { tocar(x.id); } }, h('span', { 'class': 'es-dgr-leg-n', 'aria-hidden': 'true', text: String(x._n) }), h('span', { text: x.titulo }));
        leyBtn[x.id] = b; leyenda.appendChild(h('li', null, b));
      });
    }
    var barra = h('div', { 'class': 'es-dgr-bar' }, modos, h('div', { 'class': 'es-dgr-zoom' }, zIn, zOut, zRe));

    /* ---- ficha / modo prueba */
    var ficha = h('div', { 'class': 'es-dgr-card', 'aria-live': 'polite' });
    function pintarFicha() {
      while (ficha.firstChild) ficha.removeChild(ficha.firstChild);
      ficha.classList.toggle('is-vacia', !sel);
      Object.keys(els).forEach(function (id) { els[id].classList.toggle('is-sel', id === sel); if (leyBtn[id]) leyBtn[id].classList.toggle('is-sel', id === sel); });
      if (!sel) { ficha.appendChild(h('p', { 'class': 'es-note' }, icon('hand'), h('span', { text: 'Tocá un punto del dibujo para ver qué es.' }))); return; }
      var x = porId[sel], capa = x.capa ? datos.capas.filter(function (c) { return c.id === x.capa; })[0] : null;
      ficha.appendChild(h('p', { 'class': 'es-meta', text: 'Punto ' + x._n + ' de ' + n + (capa ? ' · ' + capa.nombre : '') + ' · abiertos ' + Object.keys(abiertos).length + ' de ' + n }));
      ficha.appendChild(h('h5', { 'class': 'es-dgr-t', text: x.titulo }));
      String(x.texto || '').split('\n').filter(Boolean).forEach(function (t) { ficha.appendChild(h('p', { 'class': 'es-dgr-p', text: t })); });
      if (!x.texto) ficha.appendChild(h('p', { 'class': 'es-note', text: 'Probá el modo prueba para ver si lo ubicás sin ayuda.' }));
      if (ctx.glosario) { /* los términos del texto los marca la lección con el glosario; acá sólo se muestra el texto */ }
    }
    function tocar(id) {
      if (prueba) { responder(id); return; }
      sel = id; abiertos[id] = 1; pintarFicha();
      if (!hecho && Object.keys(abiertos).length >= UMBRAL) { hecho = true; ctx.done(); }
    }

    var P = null;   // estado del modo prueba
    function marcar(id, clase) { if (els[id]) els[id].classList.add(clase); }
    function limpiarMarcas() { Object.keys(els).forEach(function (id) { els[id].classList.remove('is-ok', 'is-bad', 'is-pulse', 'is-sel'); }); }
    function entrarModo(on) {
      prueba = on; raiz.classList.toggle('is-prueba', on); limpiarMarcas(); sel = null;
      if (capasBox) capasBox.hidden = on;
      if (on) { datos.capas.forEach(function (c) { visibles[c.id] = true; }); Array.prototype.forEach.call(capasBox ? capasBox.querySelectorAll('.es-chip') : [], function (b) { b.setAttribute('aria-pressed', 'true'); }); pintarCapas(); empezar(); }
      else pintarFicha();
    }
    function empezar() {
      intento++;
      var rnd = U.rng((ctx.leccion && ctx.leccion.id) + '|dgr|' + intento), ids = datos.hotspots.map(function (x) { return x.id; }), i;
      for (i = ids.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
      P = { orden: ids, i: 0, ok: 0, malas: [], respondida: false };
      limpiarMarcas(); pintarPregunta();
    }
    function pintarPregunta() {
      while (ficha.firstChild) ficha.removeChild(ficha.firstChild);
      ficha.classList.remove('is-vacia'); limpiarMarcas();
      var x = porId[P.orden[P.i]];
      ficha.appendChild(h('p', { 'class': 'es-meta', text: 'Modo prueba · pregunta ' + (P.i + 1) + ' de ' + P.orden.length + ' · ' + P.ok + ' bien' }));
      ficha.appendChild(h('p', { 'class': 'es-q es-q--sm', text: '¿Dónde está «' + x.titulo + '»? Tocalo en el dibujo.' }));
    }
    function responder(id) {
      if (!P || P.respondida) return;
      P.respondida = true;
      var q = porId[P.orden[P.i]], bien = id === q.id;
      if (bien) { P.ok++; marcar(id, 'is-ok'); } else { P.malas.push(q.id); marcar(id, 'is-bad'); marcar(q.id, 'is-pulse'); }
      ficha.appendChild(h('p', { 'class': 'es-pill is-' + (bien ? 'ok' : 'bad'), role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }),
        h('span', { 'class': 'es-pill-t', text: bien ? '¡Ahí está! ' + (q.texto ? q.texto.split('\n')[0] : '') : 'Ese era «' + porId[id].titulo + '». «' + q.titulo + '» es el que parpadea.' })));
      var ult = P.i + 1 >= P.orden.length;
      ficha.appendChild(K.button({ label: ult ? 'Ver el resultado' : 'Siguiente', variant: 'primary', iconRight: 'arrow-right', onClick: function () { if (ult) terminar(); else { P.i++; P.respondida = false; pintarPregunta(); } } }));
    }
    function terminar() {
      limpiarMarcas();
      while (ficha.firstChild) ficha.removeChild(ficha.firstChild);
      var tot = P.orden.length;
      ficha.appendChild(h('p', { 'class': 'es-meta', text: 'Modo prueba · resultado' }));
      ficha.appendChild(h('p', { 'class': 'es-q es-q--sm', text: 'Ubicaste ' + P.ok + ' de ' + tot + (P.ok === tot ? '. ¡Perfecto!' : '. Lo que falló entra a tu repaso.') }));
      if (isFn(ctx.score)) ctx.score(P.ok, tot, { retry: intento > 1, fallos: P.malas });
      if (!hecho) { hecho = true; ctx.done(); }
      ficha.appendChild(h('div', { 'class': 'btn-row' }, K.button({ label: 'Repetir la prueba', variant: 'secondary', icon: 'reset', onClick: function () { empezar(); } }),
        K.button({ label: 'Volver a explorar', variant: 'ghost', onClick: function () { if (modos) modos.setValue('explorar', true); } })));
    }

    var raiz = h('div', { 'class': 'es-dgr' });   // lleva .is-prueba mientras dura el modo prueba (esconde los nombres)
    K.add(raiz, [barra, capasBox, h('div', { 'class': 'es-dgr-stage' }, view), leyenda, ficha, datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null]);
    host.appendChild(raiz);
    pintarCapas(); pintarFicha(); aplicarVista();
    return {
      destroy: function () { ptrs = {}; },
      getState: function () { return { abiertos: Object.keys(abiertos), prueba: prueba, zoom: vista.s, ok: P ? P.ok : null }; }
    };
  }

  Mot.register('diagrama', { normalizar: normalizar, render: render });
})(root.C150);
