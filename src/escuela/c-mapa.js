var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-mapa.js — componente `mapa` (MAP): un plano esquemático dibujado en SVG (aeródromo, hangares, trámites, la costa…) con zoom y desplazamiento, capas que se prenden y
 * apagan, puntos y zonas que abren una ficha al costado, y un modo «Encontrá» que pide tocar el lugar nombrado (contrato v7 §5, pasada 2 · ola Q2).
 * Los planos de fondo son propios y esquemáticos (src/escuela/mapas.js): nunca el plano del curso ni coordenadas reales.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { fondo:'plano-hangares-sur',                 uno de ES.mapas.ids() (también 'costa-sur-uruguay', 'plano-carrasco-zonas', 'esquema-tramites'); desconocido → una grilla vacía
 *     capas?:['horarios', {id, nombre, visible?}],  rótulos de capa: los elementos con `capa:'horarios'` sólo se ven con esa capa prendida (los que no traen capa se ven siempre)
 *     puntos:[{ id, x, y, nombre, texto?, rol?:'principal'|'satélite'…, posicionAprox?, capa?, tono?:'ok|info|warn|bad' }],        x 0–100, y 0–66,7 (unidades de plano)
 *     zonas:[{ id, poligono:[[x,y]…] | rect:[x,y,w,h], nombre, texto?, capa?, tono?, datos?:{texto?, capa?, color?, habilitan?, soloConInstructor?} }],
 *     rutas?:[{ id, puntos:[[x,y]…], nombre?, texto?, capa?, tono?:'bad' }],               una línea con flecha (sin nombre es sólo un dibujo)
 *     vistas?:[{ id, nombre?, texto?, zonas:[{id, permitido, soloConInstructor?}] | estados:{ idZona:'ok'|'no'|'instructor' } }],   un selector que pinta cada zona según el caso («carnets» es un alias)
 *     encontra?:[{ id, pregunta? }] | false,   los lugares del modo «Encontrá» (por defecto, todos los puntos y zonas con nombre; hace falta más de uno)
 *     nota?:'texto' }
 *   normalizar entiende los esbozos del plan: puntos sin x e y se ubican donde el plano de fondo conoce ese id (o en fila), `datos` dentro de cada zona, `carnets`, `consulta`.
 *   Sin ningún punto ni zona devuelve null.
 * Teclado: Tab recorre los números (puntos y zonas), Enter o espacio abre la ficha; en el plano + − 0 y las flechas hacen zoom y desplazamiento. Rueda con Ctrl o ⌘ (o con el plano
 * enfocado), pellizco y arrastre cuando hay zoom. Todo lo que se ve en el plano también está en la lista numerada de abajo (blancos de 44 px).
 * Parte pura (también en Node): ES.mapa = { normalizar, estadoZona, preguntaDe, evaluar }
 * Puntaje del modo «Encontrá»: ctx.score(bien, total, {fallos:[id…]}) al terminar; ctx.done() al abrir varias fichas o al terminar el modo. Handle: destroy · getState.
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes, Mod = ES.modelos, U = Mod && Mod.util;
  if (!Mot || !Mod) return;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(x) { return typeof x === 'string' ? x.trim() : (typeof x === 'number' && isFinite(x) ? String(x) : ''); }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function slug(t) { t = String(t === undefined || t === null ? '' : t); try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ } return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function publico(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }
  function primeraOracion(t) { var m = /^.*?[.!?](?=\s|$)/.exec(String(t)); return m ? m[0] : String(t); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function MP() { return ES.mapas; }
  function LIM() { var M = MP(); return M && M.LIM ? M.LIM : { w: 100, h: 66.7 }; }
  function tonoDe(t) { var s = str(t); if (/^(ok|info|warn|bad)$/.test(s)) return s; return U && isFn(U.tonoDe) ? (U.tonoDe(s) || '') : ''; }

  /* ================================================================== normalizar (puro) */
  function parPunto(p) { return Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]) ? [clamp(p[0], 0, LIM().w), clamp(p[1], 0, LIM().h)] : null; }
  function poligonoDe(o) {
    var pol = arr(o.poligono || o.polygon || o.puntosPoligono).map(parPunto).filter(Boolean);
    if (pol.length >= 3) return pol;
    var r = arr(o.rect || o.caja);
    if (r.length === 4 && r.every(num) && r[2] > 0 && r[3] > 0) { var x = clamp(r[0], 0, LIM().w), y = clamp(r[1], 0, LIM().h), w = Math.min(r[2], LIM().w - x), h = Math.min(r[3], LIM().h - y); return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
    return null;
  }
  function puntoDe(o, i, fondo) {
    if (!esObj(o)) return null;
    var nombre = str(o.nombre) || str(o.titulo) || str(o.etiqueta);
    if (!nombre) return null;
    var id = str(o.id) || slug(nombre) || 'p' + (i + 1), x = num(o.x) ? o.x : null, y = num(o.y) ? o.y : null;
    if (x === null || y === null) { var l = MP() && MP().lugar(fondo, id); if (l) { x = l[0]; y = l[1]; } }
    var extra = str(o.posicionAprox) ? 'Ubicación aproximada: ' + str(o.posicionAprox) + '.' : '';
    return { tipo: 'punto', id: id, nombre: nombre, texto: publico(o.texto) || publico(o.descripcion), rol: str(o.rol), extra: extra, capa: str(o.capa), tono: tonoDe(o.tono || o.color),
      x: x === null ? null : clamp(x, 0, LIM().w), y: y === null ? null : clamp(y, 0, LIM().h), grande: /principal/i.test(str(o.rol)) || o.grande === true };
  }
  function zonaDe(o, i, fondo) {
    if (!esObj(o)) return null;
    var nombre = str(o.nombre) || str(o.titulo) || str(o.etiqueta);
    if (!nombre) return null;
    var id = str(o.id) || slug(nombre) || 'z' + (i + 1), d = esObj(o.datos) ? o.datos : {}, pol = poligonoDe(o);
    if (!pol) { var l = MP() && MP().lugar(fondo, id); if (l) pol = [[l[0] - 9, l[1] - 7], [l[0] + 9, l[1] - 7], [l[0] + 9, l[1] + 7], [l[0] - 9, l[1] + 7]].map(function (p) { return [clamp(p[0], 0, LIM().w), clamp(p[1], 0, LIM().h)]; }); }
    if (!pol) return null;
    var trozos = [publico(o.texto) || publico(d.texto) || publico(o.descripcion)];
    if (arr(d.habilitan).length) trozos.push('La habilitan los carnets: ' + arr(d.habilitan).map(str).filter(Boolean).join(' y ') + '.');
    if (d.soloConInstructor === true) trozos.push('Sólo se entra con un instructor.');
    return { tipo: 'zona', id: id, nombre: nombre, texto: trozos.filter(Boolean).join(' '), rol: '', extra: '', capa: str(o.capa) || str(d.capa), tono: tonoDe(o.tono || o.color || d.color || d.tono), poligono: pol };
  }
  function rutaDe(o, i) {
    if (!esObj(o)) return null;
    var pts = arr(o.puntos || o.camino || o.linea).map(parPunto).filter(Boolean);
    if (pts.length < 2) return null;
    var nombre = str(o.nombre) || str(o.titulo);
    return { tipo: 'ruta', id: str(o.id) || (nombre ? slug(nombre) : 'r' + (i + 1)), nombre: nombre, texto: publico(o.texto) || publico(o.descripcion), rol: '', extra: '', capa: str(o.capa), tono: tonoDe(o.tono || o.color), puntos: pts };
  }
  function estadoDe(v) {
    if (v === true || /^(ok|si|sí|permitido|entra)$/i.test(str(v))) return 'ok';
    if (v === false || /^(no|prohibido|bloqueado)$/i.test(str(v))) return 'no';
    if (/^(inst|instructor|solo-con-instructor)/i.test(str(v))) return 'inst';
    return '';
  }
  function vistaDe(o, ids) {
    if (!esObj(o) || !str(o.id)) return null;
    var est = {}, id = str(o.id);
    arr(o.zonas).forEach(function (z) { if (esObj(z) && ids[str(z.id)]) { var e = z.soloConInstructor === true && z.permitido !== false ? 'inst' : estadoDe(z.permitido !== undefined ? z.permitido : z.estado); if (e) est[str(z.id)] = e; } });
    if (esObj(o.estados)) Object.keys(o.estados).forEach(function (k) { var e = estadoDe(o.estados[k]); if (e && ids[k]) est[k] = e; });
    if (!Object.keys(est).length) return null;
    return { id: id, nombre: str(o.nombre) || (id.length <= 4 ? 'Carnet ' + id : id), texto: publico(o.texto), estados: est };
  }
  /** Qué dice una zona en una vista: 'ok' | 'inst' | 'no' | '' (sin dato). */
  function estadoZona(vista, zonaId) { return vista && vista.estados && vista.estados[zonaId] ? vista.estados[zonaId] : ''; }
  var TXT_ESTADO = { ok: 'Se puede entrar', inst: 'Sólo con un instructor', no: 'No se puede entrar' };
  /** La pregunta del modo «Encontrá» para un elemento. */
  function preguntaDe(it) { return it.tipo === 'zona' ? 'Tocá la zona «' + it.nombre + '» en el plano.' : '¿Dónde está «' + it.nombre + '»? Tocalo en el plano.'; }

  function normalizar(datos, ctx, comp) {
    if (!esObj(datos) || !MP()) return null;
    // ya normalizado (items con tipo e id): se devuelve igual
    if (typeof datos.fondo === 'string' && Array.isArray(datos.items) && datos.items.length && datos.items.every(function (it) { return esObj(it) && /^(punto|zona|ruta)$/.test(it.tipo) && it.id; })) return JSON.parse(JSON.stringify(datos));
    var fondo = MP().resolver(str(datos.fondo) || str(datos.plano)), M = MP();
    var puntos = arr(datos.puntos || datos.pines || datos.lugares || datos.marcadores).map(function (o, i) { return puntoDe(o, i, fondo); }).filter(Boolean);
    var zonas = arr(datos.zonas || datos.regiones).map(function (o, i) { return zonaDe(o, i, fondo); }).filter(Boolean);
    var rutas = arr(datos.rutas || datos.recorridos).map(rutaDe).filter(Boolean);
    if (!puntos.length && !zonas.length) return null;
    // los puntos que quedaron sin coordenadas van en fila, parejos, en el medio del plano
    var sinXY = puntos.filter(function (p) { return p.x === null || p.y === null; });
    sinXY.forEach(function (p, k) { p.x = Math.round((14 + 72 * (sinXY.length === 1 ? 0.5 : k / (sinXY.length - 1))) * 10) / 10; p.y = 33; });
    // ids únicos
    var vistos = {};
    puntos.concat(zonas, rutas).forEach(function (it) { var b = it.id, k = 2; while (vistos[it.id]) it.id = b + '-' + (k++); vistos[it.id] = 1; });
    // capas
    var capas = [], porId = {};
    function capa(nombre, visible) { var id = slug(nombre); if (!id) return ''; if (!porId[id]) { porId[id] = { id: id, nombre: str(nombre), visible: visible !== false }; capas.push(porId[id]); } return id; }
    arr(datos.capas).forEach(function (c) { if (esObj(c)) capa(str(c.nombre) || str(c.id), c.visible); else if (str(c)) capa(str(c), true); });
    var items = puntos.concat(zonas, rutas);
    items.forEach(function (it) { it.capa = it.capa ? capa(it.capa, true) : ''; });
    // numeración: los puntos y zonas (y las rutas con nombre) se numeran en ese orden
    var n = 0;
    items.forEach(function (it) { it.n = (it.tipo === 'ruta' && !it.nombre) ? 0 : ++n; });
    var zids = {}; zonas.forEach(function (z) { zids[z.id] = 1; });
    var vistas = arr(datos.vistas || datos.carnets).map(function (o) { return vistaDe(o, zids); }).filter(Boolean);
    // el modo «Encontrá»
    var cand = {}; puntos.concat(zonas).forEach(function (it) { cand[it.id] = it; });
    var enc = [];
    if (datos.encontra !== false) {
      if (Array.isArray(datos.encontra)) arr(datos.encontra).forEach(function (e) { var id = typeof e === 'string' ? e : (esObj(e) ? str(e.id) : ''); if (cand[id] && !enc.some(function (x) { return x.id === id; })) enc.push({ id: id, pregunta: esObj(e) && str(e.pregunta) ? str(e.pregunta) : preguntaDe(cand[id]) }); });
      if (!enc.length) puntos.concat(zonas).slice(0, 10).forEach(function (it) { enc.push({ id: it.id, pregunta: preguntaDe(it) }); });
    }
    return { fondo: fondo, nota: publico(datos.nota) || publico(datos.aclaracion) || (M.get(fondo) || {}).nota || '', items: items, capas: capas, vistas: vistas,
      vistaTitulo: str(datos.vistaTitulo) || (Array.isArray(datos.carnets) && !Array.isArray(datos.vistas) ? 'Carnet' : 'Caso'), encontra: enc.length >= 2 ? enc : [] };
  }
  /** Dónde va el nombre de cada punto para que no se pise con otro nombre ni con otro punto: de las cuatro posiciones (derecha, izquierda, abajo, arriba) elige la de menos
   *  superficie encima de lo ya ubicado y dentro del plano. pines = [{x, y, r, largo}] en unidades de dibujo; escala = píxeles por unidad (las etiquetas nunca miden menos
   *  de 11 px: si la escala es chica, el texto crece en unidades). Devuelve [{pos:'der'|'izq'|'aba'|'arr', dx, dy, anchor}] (dx, dy desde el centro del punto). */
  function ubicarEtiquetas(pines, escala) {
    var s = escala > 0 ? escala : 1, fs = Math.max(15, 11 / s), cw = fs * 0.58, alto = fs * 1.15, cajas = [], out = [], VW = 600, VH = 400;
    function inter(a, b) { var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > 0 && h > 0 ? w * h : 0; }
    function fuera(b) { return Math.max(0, -b[0]) * alto + Math.max(0, b[2] - VW) * alto + Math.max(0, -b[1]) * (b[2] - b[0]) + Math.max(0, b[3] - VH) * (b[2] - b[0]); }
    pines.forEach(function (p) { cajas.push([p.x - p.r - 3, p.y - p.r - 3, p.x + p.r + 3, p.y + p.r + 3]); });
    pines.forEach(function (p, i) {
      var w = p.largo * cw + 8, cand = [
        { pos: 'der', dx: p.r + 8, dy: 5, anchor: 'start' }, { pos: 'izq', dx: -(p.r + 8), dy: 5, anchor: 'end' },
        { pos: 'aba', dx: 0, dy: p.r + fs + 2, anchor: 'middle' }, { pos: 'arr', dx: 0, dy: -(p.r + 8), anchor: 'middle' }], mejor = null, k;
      cand.forEach(function (c, ix) {
        var tx = p.x + c.dx, ty = p.y + c.dy, x0 = c.anchor === 'start' ? tx - 2 : c.anchor === 'end' ? tx - w : tx - w / 2, x1 = c.anchor === 'start' ? tx + w : c.anchor === 'end' ? tx + 2 : tx + w / 2;
        var caja = [x0, ty - alto * 0.78, x1, ty + alto * 0.3], sc = ix * 40 + fuera(caja) * 4;
        for (k = 0; k < cajas.length; k++) if (k !== i) sc += inter(caja, cajas[k]);
        c.caja = caja; c.sc = sc; if (!mejor || sc < mejor.sc) mejor = c;
      });
      cajas.push(mejor.caja); out.push({ pos: mejor.pos, dx: mejor.dx, dy: mejor.dy, anchor: mejor.anchor });
    });
    return out;
  }
  /** ¿Tocó el lugar pedido? (puro: lo usan el modo «Encontrá» y los tests) */
  function evaluar(d, pedidoId, tocadoId) { return pedidoId === tocadoId && d.items.some(function (it) { return it.id === pedidoId; }); }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var K = ctx.Kit, h = ctx.h, icon = ctx.icon, reducido = !!ctx.reducedMotion, Fig = ES.figuras, M = MP();
    var fondoDef = M.get(datos.fondo) || M.get('generico');
    var VW = M.W, VH = M.H, vista = { s: 1, cx: VW / 2, cy: VH / 2 }, visibles = {}, sel = null, prueba = false, abiertos = {}, hecho = !!ctx.hecho, intento = 0, vistaSel = '', P = null, arrastro = false, ptrs = {}, ultimo = null, dist0 = 0;
    var porId = {}, els = {}, legBtn = {}, items = datos.items, tocables = items.filter(function (it) { return it.n > 0; }), nTocables = tocables.filter(function (it) { return it.tipo !== 'ruta'; }).length;
    datos.capas.forEach(function (c) { visibles[c.id] = c.visible !== false; });
    items.forEach(function (it) { porId[it.id] = it; });
    var UMBRAL = Math.min(nTocables, Math.min(4, Math.max(2, Math.ceil(nTocables / 2)))), uid = (render._uid = (render._uid || 0) + 1);
    var T = U.svg, px = M.px;

    /* ---- el dibujo */
    var svg = T('svg', { 'class': 'dg-svg mp-svg', viewBox: '0 0 ' + VW + ' ' + VH, preserveAspectRatio: 'xMidYMid meet', role: 'group', 'aria-label': (fondoDef.nombre || 'Plano') + '. ' + (datos.nota || '') });
    var gArte = T('g', { 'class': 'mp-arte', 'aria-hidden': 'true' }), gZ = T('g'), gR = T('g'), gP = T('g');
    fondoDef.capas.forEach(function (c) { if (c.svg && Fig) gArte.appendChild(Fig.seguro(c.svg)); });
    function etiqueta(t, max, lineas) {
      var pal = String(t).split(/\s+/), out = [], cur = '';
      pal.forEach(function (p) { if (!cur || (cur + ' ' + p).length <= max) cur = (cur + ' ' + p).trim(); else { out.push(cur); cur = p; } });
      if (cur) out.push(cur);
      return out.slice(0, lineas);
    }
    function aria(it) { var t = it.n + '. ' + it.nombre; if (it.tipo === 'zona' && vistaSel) { var e = estadoZona(vistaPorId(vistaSel), it.id); if (e) t += '. ' + TXT_ESTADO[e]; } return t; }
    function ariaPrueba(it) { return (it.tipo === 'zona' ? 'Zona ' : it.tipo === 'ruta' ? 'Recorrido ' : 'Punto ') + it.n; }
    function engancharTocar(g, it) {
      g.addEventListener('click', function () { if (arrastro) return; tocar(it.id); });
      g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tocar(it.id); } });
      els[it.id] = g;
    }
    items.forEach(function (it) {
      if (it.tipo === 'zona') {
        var g = T('g', { 'class': 'mp-zona', tabindex: '0', role: 'button', 'data-id': it.id, 'data-tono': it.tono || null, 'aria-label': aria(it) });
        g.appendChild(T('polygon', { 'class': 'mp-zona-p', points: M.poligono(it.poligono) }));
        var c = M.centro(it.poligono), bx = M.caja(it.poligono), ancho = bx.x1 - bx.x0;
        var tx = T('text', { 'class': 'mp-lbl mp-lbl--z', x: px(c[0]), y: px(c[1]) - 2, 'text-anchor': 'middle' });
        if (ancho >= 17) etiqueta(it.nombre, Math.max(8, Math.floor(ancho * 0.9)), 2).forEach(function (l, k) { tx.appendChild(T('tspan', { x: px(c[0]), dy: k ? 18 : 0 }, l)); });
        g.appendChild(tx);
        var st = T('text', { 'class': 'mp-lbl mp-zst', x: px(c[0]), y: px(c[1]) + 30, 'text-anchor': 'middle' }); g.appendChild(st); it._st = st; it._tx = ancho >= 17;
        g.appendChild(T('circle', { 'class': 'mp-num-bg', cx: px(bx.x0) + 14, cy: px(bx.y0) + 14, r: 13 }));
        g.appendChild(T('text', { 'class': 'mp-num', x: px(bx.x0) + 14, y: px(bx.y0) + 14 + 4.5, 'text-anchor': 'middle' }, String(it.n)));
        engancharTocar(g, it); gZ.appendChild(g);
      } else if (it.tipo === 'ruta') {
        var gr = T('g', { 'class': 'mp-ruta' + (it.n ? ' is-tocable' : ''), 'data-tono': it.tono || null, 'data-id': it.id });
        var pts = it.puntos.map(function (p) { return px(p[0]) + ',' + px(p[1]); }).join(' ');
        gr.appendChild(T('polyline', { 'class': 'mp-ruta-l', points: pts }));
        var a = it.puntos[it.puntos.length - 2], b = it.puntos[it.puntos.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 22, W2 = 9;
        var bxp = px(b[0]), byp = px(b[1]), cx = Math.cos(ang), cy = Math.sin(ang);
        gr.appendChild(T('polygon', { 'class': 'mp-ruta-h', points: bxp + ',' + byp + ' ' + (bxp - cx * L - cy * W2) + ',' + (byp - cy * L + cx * W2) + ' ' + (bxp - cx * L + cy * W2) + ',' + (byp - cy * L - cx * W2) }));
        if (it.n) {
          var m = it.puntos[Math.floor(it.puntos.length / 2)];
          gr.setAttribute('tabindex', '0'); gr.setAttribute('role', 'button'); gr.setAttribute('aria-label', aria(it));
          gr.appendChild(T('circle', { 'class': 'mp-num-bg', cx: px(m[0]), cy: px(m[1]), r: 13 }));
          gr.appendChild(T('text', { 'class': 'mp-num', x: px(m[0]), y: px(m[1]) + 4.5, 'text-anchor': 'middle' }, String(it.n)));
          engancharTocar(gr, it);
        } else gr.setAttribute('aria-hidden', 'true');
        gR.appendChild(gr);
      } else {
        var r = it.grande ? 22 : 17, izq = it.x > 68;
        var gp = T('g', { 'class': 'mp-pin', tabindex: '0', role: 'button', 'data-id': it.id, 'data-tono': it.tono || null, 'aria-label': aria(it), transform: 'translate(' + px(it.x) + ' ' + px(it.y) + ')' });
        gp.appendChild(T('circle', { 'class': 'mp-pin-hit', r: 30 }));
        gp.appendChild(T('circle', { 'class': 'mp-pin-halo', r: r + 7 }));
        gp.appendChild(T('circle', { 'class': 'mp-pin-b', r: r }));
        gp.appendChild(T('text', { 'class': 'mp-num mp-num--p', x: 0, y: 5, 'text-anchor': 'middle' }, String(it.n)));
        var rot = it.nombre.length > 30 ? it.nombre.slice(0, 28).replace(/\s+\S*$/, '') + '…' : it.nombre;
        it._lbl = T('text', { 'class': 'mp-lbl mp-lbl--p', x: izq ? -(r + 8) : r + 8, y: 5, 'text-anchor': izq ? 'end' : 'start' }, rot); it._r = r; it._largo = rot.length;
        gp.appendChild(it._lbl);
        engancharTocar(gp, it); gP.appendChild(gp);
      }
    });
    svg.appendChild(gArte); svg.appendChild(gZ); svg.appendChild(gR); svg.appendChild(gP);

    /* ---- zoom y desplazamiento (igual que el diagrama; la rueda zoomea con Ctrl o ⌘, o con el plano enfocado) */
    function aplicarVista() {
      var w = VW / vista.s, hg = VH / vista.s;
      vista.cx = clamp(vista.cx, w / 2, VW - w / 2); vista.cy = clamp(vista.cy, hg / 2, VH - hg / 2);
      svg.setAttribute('viewBox', (vista.cx - w / 2) + ' ' + (vista.cy - hg / 2) + ' ' + w + ' ' + hg);
      view.classList.toggle('is-zoom', vista.s > 1.001);
      zIn.disabled = vista.s >= 4; zOut.disabled = vista.s <= 1.001; zRe.disabled = vista.s <= 1.001 && Math.abs(vista.cx - VW / 2) < 1;
      if (svg._dgMedir) svg._dgMedir();
      colocar();
    }
    function zoom(f, fx, fy) {
      var s2 = clamp(vista.s * f, 1, 4); if (s2 === vista.s) return;
      var w = VW / vista.s, hg = VH / vista.s; fx = fx === undefined ? 0.5 : fx; fy = fy === undefined ? 0.5 : fy;
      var ax = vista.cx - w / 2 + fx * w, ay = vista.cy - hg / 2 + fy * hg, w2 = VW / s2, h2 = VH / s2;
      vista.s = s2; vista.cx = ax - fx * w2 + w2 / 2; vista.cy = ay - fy * h2 + h2 / 2; aplicarVista();
    }
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
    svg.addEventListener('wheel', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey || (document.activeElement && view.contains(document.activeElement)))) return;
      ev.preventDefault(); var p = relativo(ev); zoom(ev.deltaY < 0 ? 1.2 : 1 / 1.2, p[0], p[1]);
    }, { passive: false });
    var view = h('div', { 'class': 'es-dgr-view es-plano-view', tabindex: '0', role: 'group', 'aria-label': 'Plano. Con el teclado: más y menos para el zoom, flechas para moverte y Tab para recorrer los números.' }, svg);
    view.addEventListener('keydown', function (ev) {
      var k = ev.key, paso = 0.12 * VW / vista.s;
      if (k === '+' || k === '=') { zoom(1.25); ev.preventDefault(); } else if (k === '-' || k === '_') { zoom(0.8); ev.preventDefault(); } else if (k === '0') { vista.s = 1; vista.cx = VW / 2; vista.cy = VH / 2; aplicarVista(); ev.preventDefault(); }
      else if (ev.target === view && vista.s > 1.001 && /^Arrow/.test(k)) { vista.cx += (k === 'ArrowRight' ? paso : k === 'ArrowLeft' ? -paso : 0); vista.cy += (k === 'ArrowDown' ? paso : k === 'ArrowUp' ? -paso : 0); aplicarVista(); ev.preventDefault(); }
    });
    var zIn = K.iconButton({ icon: 'plus', label: 'Acercar el plano', small: true, onClick: function () { zoom(1.3); } }), zOut = K.iconButton({ icon: 'minus', label: 'Alejar el plano', small: true, onClick: function () { zoom(1 / 1.3); } }),
      zRe = K.iconButton({ icon: 'reset', label: 'Ver todo el plano', small: true, onClick: function () { vista.s = 1; vista.cx = VW / 2; vista.cy = VH / 2; aplicarVista(); } });
    [zIn, zOut, zRe].forEach(function (b) { b.classList.add('es-dgr-z'); });

    /* ---- barra: modos, vistas, capas, leyenda */
    var modos = datos.encontra.length >= 2 ? K.segmented({ items: [{ value: 'explorar', label: 'Explorar' }, { value: 'prueba', label: 'Encontrá' }], value: 'explorar', label: 'Qué querés hacer', onChange: function (v) { entrarModo(v === 'prueba'); } }) : null;
    var barra = h('div', { 'class': 'es-dgr-bar es-plano-bar' }, modos, h('div', { 'class': 'es-dgr-zoom' }, zIn, zOut, zRe));
    function vistaPorId(id) { for (var i = 0; i < datos.vistas.length; i++) if (datos.vistas[i].id === id) return datos.vistas[i]; return null; }
    var vistasBox = null;
    if (datos.vistas.length) {
      var segV = K.segmented({ items: [{ value: '', label: 'Todas' }].concat(datos.vistas.map(function (v) { return { value: v.id, label: v.nombre }; })), value: '', label: datos.vistaTitulo, onChange: function (v) { vistaSel = v; pintarVista(); pintarFicha(); } });
      vistasBox = h('div', { 'class': 'es-esc es-plano-vistas' }, h('span', { 'class': 'es-meta', text: datos.vistaTitulo === 'Carnet' ? '¿Qué carnet tenés?' : 'Mirá según el caso' }), segV);
    }
    var capasBox = null;
    if (datos.capas.length >= 1) {
      capasBox = h('div', { 'class': 'es-esc es-dgr-capas', role: 'group', 'aria-label': 'Capas del plano' }, h('span', { 'class': 'es-meta', text: 'Capas' }));
      datos.capas.forEach(function (c) {
        var b = h('button', { type: 'button', 'class': 'es-chip es-chip--layer', 'aria-pressed': visibles[c.id] ? 'true' : 'false', onclick: function () { visibles[c.id] = !visibles[c.id]; b.setAttribute('aria-pressed', visibles[c.id] ? 'true' : 'false'); pintarCapas(); } }, c.nombre);
        capasBox.appendChild(b);
      });
    }
    var leyenda = h('ol', { 'class': 'es-dgr-leg es-plano-leg', 'aria-label': 'Lugares del plano' });
    tocables.forEach(function (it) {
      var b = h('button', { type: 'button', 'class': 'es-dgr-leg-b', onclick: function () { tocar(it.id); } }, h('span', { 'class': 'es-dgr-leg-n', 'aria-hidden': 'true', text: String(it.n) }), h('span', { text: it.nombre }));
      legBtn[it.id] = b; leyenda.appendChild(h('li', null, b));
    });

    /* ---- pintar capas / vistas */
    function visibleIt(it) { return !it.capa || visibles[it.capa] !== false; }
    /** Reubica los nombres de los puntos que se ven (con la escala actual) para que no se pisen. */
    function colocar() {
      var vis = items.filter(function (it) { return it.tipo === 'punto' && it._lbl && visibleIt(it); });
      var e = parseFloat(svg.style.getPropertyValue('--dg-s')) || 1;
      var pos = ubicarEtiquetas(vis.map(function (it) { return { x: px(it.x), y: px(it.y), r: it._r, largo: it._largo }; }), e);
      vis.forEach(function (it, k) { it._lbl.setAttribute('x', pos[k].dx); it._lbl.setAttribute('y', pos[k].dy); it._lbl.setAttribute('text-anchor', pos[k].anchor); });
    }
    function pintarCapas() {
      items.forEach(function (it) {
        var g = els[it.id], v = visibleIt(it);
        if (g) g.style.display = v ? '' : 'none';
        else if (it.tipo === 'ruta') { var gr = gR.querySelector('[data-id="' + it.id + '"]'); if (gr) gr.style.display = v ? '' : 'none'; }
        if (legBtn[it.id]) legBtn[it.id].parentNode.hidden = !v;
      });
      if (sel && !visibleIt(porId[sel])) { sel = null; pintarFicha(); }
      colocar();
    }
    function pintarVista() {
      var v = vistaPorId(vistaSel);
      items.forEach(function (it) {
        if (it.tipo !== 'zona') return;
        var g = els[it.id], e = estadoZona(v, it.id);
        g.classList.remove('is-ok', 'is-no', 'is-inst'); if (e) g.classList.add('is-' + e);
        it._st.textContent = e ? (e === 'ok' ? 'SÍ ENTRÁS' : e === 'inst' ? 'CON INSTRUCTOR' : 'NO ENTRÁS') : '';
        g.setAttribute('aria-label', prueba ? ariaPrueba(it) : aria(it));
      });
      raiz.classList.toggle('has-vista', !!v);
    }

    /* ---- ficha / modo «Encontrá» */
    var ficha = h('div', { 'class': 'es-dgr-card es-plano-card', 'aria-live': 'polite' });
    function vaciar(e) { while (e.firstChild) e.removeChild(e.firstChild); }
    function pintarFicha() {
      vaciar(ficha); ficha.classList.toggle('is-vacia', !sel);
      Object.keys(els).forEach(function (id) { els[id].classList.toggle('is-sel', id === sel); if (legBtn[id]) legBtn[id].classList.toggle('is-sel', id === sel); });
      if (!sel) { ficha.appendChild(h('p', { 'class': 'es-note' }, icon('hand'), h('span', { text: 'Tocá un número del plano (o de la lista) para ver qué es.' }))); return; }
      var it = porId[sel], capa = it.capa ? datos.capas.filter(function (c) { return c.id === it.capa; })[0] : null;
      ficha.appendChild(h('p', { 'class': 'es-meta', text: (it.tipo === 'zona' ? 'ZONA' : it.tipo === 'ruta' ? 'RECORRIDO' : 'PUNTO') + ' ' + it.n + ' DE ' + tocables.length + (capa ? ' · ' + capa.nombre.toUpperCase() : '') + ' · ABIERTOS ' + Object.keys(abiertos).length + ' DE ' + nTocables }));
      ficha.appendChild(h('h4', { 'class': 'es-dgr-t', text: it.nombre }));
      if (it.rol) ficha.appendChild(h('p', null, h('span', { 'class': 'es-tag' + (it.grande ? ' es-tag--ok' : ''), text: it.rol.toUpperCase() })));
      if (it.texto) ficha.appendChild(h('p', { 'class': 'es-dgr-p', text: it.texto }));
      if (it.tipo === 'zona' && vistaSel) {
        var v = vistaPorId(vistaSel), e = estadoZona(v, it.id);
        if (e) ficha.appendChild(h('p', { 'class': 'es-pill is-' + (e === 'ok' ? 'ok' : e === 'inst' ? 'warn' : 'bad'), role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }), h('span', { 'class': 'es-pill-t', text: v.nombre + ': ' + TXT_ESTADO[e] + '.' })));
      }
      if (it.extra) ficha.appendChild(h('p', { 'class': 'es-note', text: it.extra }));
      if (!it.texto && !it.extra) ficha.appendChild(h('p', { 'class': 'es-note', text: 'Probá «Encontrá» para ver si lo ubicás sin ayuda.' }));
    }
    function tocar(id) {
      if (prueba) { responder(id); return; }
      sel = id; abiertos[id] = 1; pintarFicha();
      if (!hecho && Object.keys(abiertos).length >= UMBRAL) { hecho = true; ctx.done(); }
    }
    function marcas() { Object.keys(els).forEach(function (id) { els[id].classList.remove('is-ok-r', 'is-bad-r', 'is-pulse', 'is-sel'); }); }
    function entrarModo(on) {
      prueba = on; raiz.classList.toggle('is-prueba', on); marcas(); sel = null;
      if (capasBox) capasBox.hidden = on; leyenda.hidden = on; if (vistasBox) vistasBox.hidden = on;
      if (on) { datos.capas.forEach(function (c) { visibles[c.id] = true; }); if (capasBox) Array.prototype.forEach.call(capasBox.querySelectorAll('.es-chip'), function (b) { b.setAttribute('aria-pressed', 'true'); }); pintarCapas(); vistaSel = ''; pintarVista(); empezar(); }
      else { pintarVista(); pintarFicha(); }
      items.forEach(function (it) { if (els[it.id]) els[it.id].setAttribute('aria-label', on ? ariaPrueba(it) : aria(it)); });
    }
    function mezclar(l, sem) { var a = l.slice(), r = U.rng(sem), i; for (i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function empezar() {
      intento++;
      P = { orden: mezclar(datos.encontra, (ctx.leccion && ctx.leccion.id) + '|map|' + intento), i: 0, ok: 0, malas: [], respondida: false };
      marcas(); pintarPregunta();
    }
    function pintarPregunta() {
      vaciar(ficha); ficha.classList.remove('is-vacia'); marcas();
      var q = P.orden[P.i];
      ficha.appendChild(h('p', { 'class': 'es-meta', text: 'ENCONTRÁ · PREGUNTA ' + (P.i + 1) + ' DE ' + P.orden.length + ' · ' + P.ok + ' BIEN' }));
      ficha.appendChild(h('p', { 'class': 'es-q es-q--sm es-plano-q', id: 'es-plano-q-' + uid, text: q.pregunta }));
      ficha.appendChild(h('p', { 'class': 'es-note', text: 'Tocá el lugar en el plano. Con teclado: Tab para recorrer los números y Enter para elegir.' }));
    }
    function responder(id) {
      if (!P || P.respondida || !porId[id] || porId[id].n === 0) return;
      P.respondida = true;
      var q = P.orden[P.i], bien = evaluar(datos, q.id, id), pedido = porId[q.id];
      if (bien) { P.ok++; els[id].classList.add('is-ok-r'); } else { P.malas.push(q.id); els[id].classList.add('is-bad-r'); els[q.id].classList.add('is-pulse'); }
      ficha.appendChild(h('p', { 'class': 'es-pill is-' + (bien ? 'ok' : 'bad'), role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }),
        h('span', { 'class': 'es-pill-t', text: bien ? '¡Ahí está! ' + pedido.nombre + (pedido.texto ? '. ' + primeraOracion(pedido.texto) : '') : 'Ese era «' + porId[id].nombre + '». «' + pedido.nombre + '» es el que parpadea.' })));
      var ult = P.i + 1 >= P.orden.length;
      ficha.appendChild(K.button({ label: ult ? 'Ver el resultado' : 'Siguiente', variant: 'primary', iconRight: 'arrow-right', onClick: function () { if (ult) terminar(); else { P.i++; P.respondida = false; pintarPregunta(); } } }));
    }
    function terminar() {
      marcas(); vaciar(ficha);
      var tot = P.orden.length;
      ficha.appendChild(h('p', { 'class': 'es-meta', text: 'ENCONTRÁ · RESULTADO' }));
      ficha.appendChild(h('p', { 'class': 'es-q es-q--sm', text: 'Ubicaste ' + P.ok + ' de ' + tot + (P.ok === tot ? '. ¡Perfecto!' : '. Lo que falló entra a tu repaso.') }));
      if (isFn(ctx.score)) ctx.score(P.ok, tot, { retry: intento > 1, fallos: P.malas });
      if (!hecho) { hecho = true; ctx.done(); }
      ficha.appendChild(h('div', { 'class': 'btn-row' }, K.button({ label: 'Repetir', variant: 'secondary', icon: 'reset', onClick: function () { empezar(); } }),
        K.button({ label: 'Volver a explorar', variant: 'ghost', onClick: function () { if (modos) modos.setValue('explorar', true); } })));
    }

    var raiz = h('div', { 'class': 'es-plano' + (reducido ? ' is-rm' : '') });
    K.add(raiz, [barra, vistasBox, capasBox, h('div', { 'class': 'es-plano-main' }, h('div', { 'class': 'es-plano-stage' }, view, leyenda), ficha), datos.nota ? h('p', { 'class': 'es-note es-plano-nota', text: datos.nota }) : null]);
    host.appendChild(raiz);
    pintarCapas(); pintarVista(); pintarFicha(); aplicarVista();
    var offEt = U.escalarEtiquetas(svg), tCol = 0, roCol = null;
    function colocarLuego() { clearTimeout(tCol); tCol = setTimeout(colocar, 90); }
    colocarLuego(); setTimeout(colocar, 500);
    if (typeof ResizeObserver === 'function') { try { roCol = new ResizeObserver(colocarLuego); roCol.observe(view); } catch (e) { roCol = null; } }
    return {
      destroy: function () { ptrs = {}; offEt(); clearTimeout(tCol); if (roCol) { try { roCol.disconnect(); } catch (e) { /* idem */ } } },
      getState: function () { return { abiertos: Object.keys(abiertos), prueba: prueba, zoom: vista.s, vista: vistaSel, ok: P ? P.ok : null }; }
    };
  }

  Mot.register('mapa', { normalizar: normalizar, render: render });
  ES.mapa = { normalizar: normalizar, estadoZona: estadoZona, preguntaDe: preguntaDe, evaluar: evaluar, ubicarEtiquetas: ubicarEtiquetas };
})(root.C150);
