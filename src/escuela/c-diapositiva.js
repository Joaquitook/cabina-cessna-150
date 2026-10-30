var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-diapositiva.js — componente `diapositiva` (DIA): una explicación corta, paso a paso, con un dibujo que cambia con cada paso y una frase grande
 * abajo (contrato v7 §5, pasada 2 · ola Q2). Anterior / Siguiente, puntitos de avance, reproducción automática opcional con pausa, teclado (← → Inicio Fin, espacio) y,
 * con "reducir movimiento", sin reproducción automática y con cambios instantáneos.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { pasos:[{ titulo?, texto, escena?, figura?, capas?, mostrar?, ocultar?, resalta?, atenua?, icono?, dato?, termino? }],
 *     figura?:'id de ES.figuras'   una figura para todos los pasos (cada paso elige qué capas se ven)        autoplay?:true | segundos por paso      nota?:'texto' }
 *   texto      la frase grande de abajo (acepta el mini-marcado **término** · ==clave== · {{valor|unidad}}); titulo = el rótulo corto del paso (mono, arriba de la frase)
 *   figura     un dibujo propio de C150.ESCUELA.figuras (cuatro-fuerzas, venturi-tubo…): cada paso muestra / oculta capas.
 *              capas:[ids]  las capas visibles en ese paso (el resto se apaga) · mostrar:[ids] / ocultar:[ids]  cambios que se acumulan hacia adelante · resalta:[ids] / atenua:[ids] sólo en ese paso
 *   escena     sin figura, se genera un dibujo limpio con ícono, numeral grande y la cadena de pasos. Tipos:
 *                { tipo:'icono', icono:'cap' }                                     ícono grande + el número del paso (por defecto; el ícono sale de las palabras del paso)
 *                { tipo:'dato', valor:'75', unidad:'%', etiqueta?, icono? }       una cifra enorme
 *                { tipo:'lista', items:[…], hecho?:[índices tachados], actual?:i } una agenda / lista con marcas
 *                { tipo:'comparar', a:{titulo, icono?}, b:{titulo, icono?}, foco?:'a'|'b' }   dos tarjetas lado a lado
 *                { tipo:'flujo', nodos:[…], actual?:i }                            cajas unidas por flechas (ya pasó · ahora · falta)
 *                { tipo:'formula', texto:'L = ½ · ρ · V² · S · CL', nota? }        una fórmula grande
 *              `icono` y `dato:{valor, unidad?, etiqueta?}` sueltos en el paso son atajos de esas escenas. `ilustracion` (esbozos viejos del plan) sólo ayuda a elegir el ícono.
 *   normalizar entiende también `diapositivas` / `slides` / `escenas` o una lista pelada de pasos (textos u objetos). Sin ningún texto devuelve null.
 * Parte pura (también en Node): ES.diapositiva = { normalizar, escenaDe, iconoPara, estadoFigura, duracionPaso, ESCENAS }
 * Para otros componentes (caso): ES.diapositiva.crearEscena({reducido}) → { svg, mostrar(spec, i, n, estado), destroy() } y ES.diapositiva.fraseEl(ctx, texto).
 * Handle: destroy · pause · resume · getState.   Completa la lección (ctx.done()) cuando se vieron todos los pasos.
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
  function lista(x) { return (Array.isArray(x) ? x : (x === undefined || x === null ? [] : [x])).map(str).filter(Boolean); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function plano(t) { return String(t || '').replace(/\*\*|==|\{\{([^|}]*)(?:\|[^}]*)?\}\}/g, function (m, a) { return a === undefined ? '' : a; }); }

  /* ================================================================== parte pura */
  var ESCENAS = ['icono', 'dato', 'lista', 'comparar', 'flujo', 'formula'];
  var ICONOS = [
    [/escuela|curso|alumn|clase|aprend|estudi|portada|bienvenid/, 'cap'], [/port[oó]n|acceso|entrad|puerta|candado|restring|estéril|esteril/, 'lock'],
    [/formulario|agenda|cartilla|checklist|tr[aá]mite|document|papel|anot|cerves/, 'checklist'], [/libro|carta|manual|licencia|reglamento/, 'book'],
    [/\bhoras?\b|\bd[ií]as?\b|minut|plazo|turno|tiempo|cada tanto/, 'clock'], [/peligro|grave|ojo|cuidado|riesgo|falta|error|equivoc/, 'warning'],
    [/pregunta|duda|hielo|conocer|\?/, 'help'], [/objetivo|meta\b|apunt/, 'target'], [/avi[oó]n|vuelo|vola|hangar|plataforma|pista|calza/, 'plane'],
    [/aire|viento|\bala\b|alas\b|sustent/, 'wind'], [/velocidad|f[oó]rmula|coeficiente|n[uú]mero/, 'gauge'], [/motor|h[eé]lice/, 'engine'],
    [/idea|explic|entend|por qu[eé]/, 'bulb'], [/listo|correct|aprob|tachad|\b75\b/, 'check'], [/mapa|base\b|ubic|direcci[oó]n|lugar|queda/, 'map'],
    [/\bver\b|mirar|ojos|se[ñn]al|test|simulacro/, 'eye'], [/mano|pedal|pies|calzado|freno/, 'hand'], [/premio|trofeo|nota/, 'trophy'], [/estrella|favorit/, 'star']
  ];
  var ICONOS_BASE = ['bulb', 'flag', 'target', 'book', 'compass'];
  function iconoValido(n) { var I = C150.Icons; return typeof n === 'string' && !!n && (!I || !isFn(I.has) || I.has(n)); }
  /** El ícono de un paso: el que pide, o el primero cuyo patrón aparece en sus palabras; si no, uno de la serie base según el número de paso. */
  function iconoPara(texto, i) {
    var t = String(texto || '').toLowerCase();
    for (var k = 0; k < ICONOS.length; k++) if (ICONOS[k][0].test(t) && iconoValido(ICONOS[k][1])) return ICONOS[k][1];
    var b = ICONOS_BASE[(i || 0) % ICONOS_BASE.length];
    return iconoValido(b) ? b : 'info';
  }
  /** Segundos que se queda un paso cuando se reproduce solo: según el largo de la frase (≈ 3 palabras por segundo). */
  function duracionPaso(texto, titulo, fijo) {
    if (fijo > 0) return fijo;
    var n = String(texto || '').length + String(titulo || '').length / 2;
    return Math.round(clamp(3.6 + n / 16, 4, 11) * 10) / 10;
  }

  function lado(o) {
    if (typeof o === 'string') { var t = str(o); return t ? { titulo: t, icono: '' } : null; }
    if (!esObj(o)) return null;
    var tt = str(o.titulo) || str(o.nombre) || str(o.texto);
    return tt ? { titulo: tt, icono: iconoValido(str(o.icono)) ? str(o.icono) : '' } : null;
  }
  /** Valida un dibujo pedido por el paso; devuelve un spec limpio o null. */
  function limpiarEscena(e, texto, titulo, i) {
    if (!esObj(e)) return null;
    var tipo = str(e.tipo).toLowerCase();
    if (ESCENAS.indexOf(tipo) < 0) return null;
    var ico = iconoValido(str(e.icono)) ? str(e.icono) : '';
    if (tipo === 'icono') return { tipo: 'icono', icono: ico || iconoPara(titulo + ' ' + texto, i) };
    if (tipo === 'dato') {
      var v = str(e.valor);
      return v ? { tipo: 'dato', valor: v, unidad: str(e.unidad), etiqueta: str(e.etiqueta), icono: ico } : null;
    }
    if (tipo === 'lista') {
      var it = lista(e.items).slice(0, 6);
      if (it.length < 2) return null;
      var hecho = arr(e.hecho).filter(function (k) { return typeof k === 'number' && k >= 0 && k < it.length; });
      var act = typeof e.actual === 'number' && e.actual >= 0 && e.actual < it.length ? e.actual : -1;
      return { tipo: 'lista', items: it, hecho: hecho, actual: act };
    }
    if (tipo === 'comparar') {
      var a = lado(e.a), b = lado(e.b);
      return a && b ? { tipo: 'comparar', a: a, b: b, foco: e.foco === 'a' || e.foco === 'b' ? e.foco : '' } : null;
    }
    if (tipo === 'flujo') {
      var nd = lista(e.nodos).slice(0, 8);
      if (nd.length < 2) return null;
      return { tipo: 'flujo', nodos: nd, actual: typeof e.actual === 'number' && e.actual >= 0 && e.actual < nd.length ? e.actual : -1 };
    }
    if (tipo === 'formula') { var f = str(e.texto) || str(e.formula); return f ? { tipo: 'formula', texto: f, nota: str(e.nota) } : null; }
    return null;
  }
  /** El dibujo de un paso (siempre devuelve algo): la figura, la escena pedida, un dato suelto o el ícono con el número. */
  function escenaDe(p, i, n) {
    if (p.figura) return { tipo: 'figura', figura: p.figura };
    var e = limpiarEscena(p.escena, p.texto, p.titulo, i);
    if (e) return e;
    if (p.dato) return { tipo: 'dato', valor: p.dato.valor, unidad: p.dato.unidad, etiqueta: p.dato.etiqueta, icono: '' };
    return { tipo: 'icono', icono: iconoValido(p.icono) ? p.icono : iconoPara(p.titulo + ' ' + p.texto + ' ' + (p.ilustracion || ''), i) };
  }
  /** Qué capas se ven en el paso k de una figura: { visibles:{id:bool}, resalta:[ids], atenua:[ids] }. Se calcula desde cero (sirve para ir y volver). */
  function estadoFigura(pasos, k, capasFig) {
    var vis = {}, resalta = [], atenua = [], j;
    arr(capasFig).forEach(function (c) { vis[c.id] = c.visible !== false; });
    for (j = 0; j <= k && j < pasos.length; j++) {
      var p = pasos[j];
      if (p.capas && p.capas.length) { Object.keys(vis).forEach(function (id) { vis[id] = false; }); p.capas.forEach(function (id) { if (id in vis) vis[id] = true; }); }
      arr(p.mostrar).forEach(function (id) { if (id in vis) vis[id] = true; });
      arr(p.ocultar).forEach(function (id) { if (id in vis) vis[id] = false; });
      if (j === k) { resalta = arr(p.resalta).filter(function (id) { return id in vis; }); atenua = arr(p.atenua).filter(function (id) { return id in vis; }); }
    }
    return { visibles: vis, resalta: resalta, atenua: atenua };
  }

  var FUENTES = ['pasos', 'diapositivas', 'slides', 'escenas'];
  function pasoDe(o, figGlobal) {
    if (typeof o === 'string') { var t0 = str(o); return t0 ? { titulo: '', texto: t0, figura: figGlobal || '', termino: [] } : null; }
    if (!esObj(o)) return null;
    var titulo = str(o.titulo) || str(o.etiqueta) || str(o.nombre);
    var texto = str(o.texto) || str(o.descripcion) || str(o.caption) || str(o.frase);
    if (!texto && !titulo) return null;
    if (!texto) { texto = titulo; titulo = ''; }
    var Fig = ES.figuras, fid = str(o.figura) || figGlobal || '';
    if (fid && !(Fig && Fig.has(fid))) fid = '';
    var p = { titulo: titulo, texto: texto, termino: lista(o.termino).concat(lista(o.terminos)) };
    if (fid) {
      p.figura = fid;
      if (Array.isArray(o.capas)) p.capas = lista(o.capas);
      ['mostrar', 'ocultar', 'resalta', 'atenua'].forEach(function (k) { if (o[k] !== undefined) p[k] = lista(o[k]); });
      if (o.resaltar !== undefined && !p.resalta) p.resalta = lista(o.resaltar);
    } else p.figura = '';
    if (esObj(o.escena)) p.escena = o.escena;
    if (esObj(o.dato) && str(o.dato.valor)) p.dato = { valor: str(o.dato.valor), unidad: str(o.dato.unidad), etiqueta: str(o.dato.etiqueta) };
    else if (typeof o.dato === 'number' || (typeof o.dato === 'string' && str(o.dato))) p.dato = { valor: str(o.dato), unidad: str(o.unidad), etiqueta: '' };
    if (str(o.icono)) p.icono = str(o.icono);
    if (str(o.ilustracion)) p.ilustracion = str(o.ilustracion).replace(/[-_]+/g, ' ');
    return p;
  }
  function normalizar(datos, ctx, comp) {
    var l = null, i;
    if (Array.isArray(datos)) l = datos;
    else if (esObj(datos)) { for (i = 0; i < FUENTES.length && !l; i++) if (Array.isArray(datos[FUENTES[i]]) && datos[FUENTES[i]].length) l = datos[FUENTES[i]]; }
    if (!l) return null;
    var Fig = ES.figuras, figG = esObj(datos) && str(datos.figura) && Fig && Fig.has(str(datos.figura)) ? str(datos.figura) : '';
    var pasos = l.map(function (o) { return pasoDe(o, figG); }).filter(Boolean).slice(0, 12);
    if (!pasos.length) return null;
    // la forma canónica (mismo orden de claves siempre): la escena ya trae el ícono o el dato, así normalizar de nuevo da lo mismo
    pasos = pasos.map(function (p, k) {
      var o = { titulo: p.titulo, texto: p.texto, figura: p.figura || '', termino: p.termino };
      ['capas', 'mostrar', 'ocultar', 'resalta', 'atenua'].forEach(function (c) { if (p[c] !== undefined) o[c] = p[c]; });
      o.escena = escenaDe(p, k, l.length);
      return o;
    });
    var ap = esObj(datos) ? datos.autoplay : false;
    return { pasos: pasos, autoplay: ap === true || (typeof ap === 'number' && ap > 0), segundos: typeof ap === 'number' && ap > 0 ? ap : 0,
      nota: esObj(datos) ? (str(datos.nota) || str(datos.aclaracion)) : '' };
  }

  /* ================================================================== el dibujo (SVG) */
  var W = 480, H = 270;
  function envolver(t, max, lineas) {
    var pal = String(t).split(/\s+/), out = [], cur = '';
    pal.forEach(function (p) {
      if ((cur + ' ' + p).trim().length <= max || !cur) cur = (cur + ' ' + p).trim();
      else { out.push(cur); cur = p; }
    });
    if (cur) out.push(cur);
    if (out.length > lineas) { out = out.slice(0, lineas); out[lineas - 1] = out[lineas - 1].replace(/\s*\S{0,3}$/, '') + '…'; }
    return out;
  }
  function T(tag, attrs) { return U.svg.apply(null, arguments); }
  function icoSvg(nombre, x, y, size, clase) {
    var s = T('svg', { x: x, y: y, width: size, height: size, viewBox: '0 0 24 24', 'class': 'dp-ico' + (clase ? ' ' + clase : ''), 'aria-hidden': 'true' });
    s.appendChild(T('use', { href: '#i-' + nombre }));
    return s;
  }
  function texto(x, y, t, clase, anchor) { return T('text', { x: x, y: y, 'class': clase, 'text-anchor': anchor || 'start' }, t); }
  function lineas(x, y, ls, clase, paso, anchor) {
    var tx = T('text', { x: x, y: y, 'class': clase, 'text-anchor': anchor || 'middle' });
    ls.forEach(function (l, k) { tx.appendChild(T('tspan', { x: x, dy: k ? paso : 0 }, l)); });
    return tx;
  }
  /** Tamaño real (en unidades de dibujo) de un rótulo de 15: nunca menos de 11 px en pantalla, así que a escala chica el texto crece y el dibujo se acomoda a eso. */
  function fuente(sc) { return Math.max(15, 11 / (sc > 0 ? sc : 1)); }
  function fondo(HH) {
    var g = T('g', { 'class': 'dp-fondo', 'aria-hidden': 'true' });
    g.appendChild(T('rect', { 'class': 'dp-bg', x: 0, y: 0, width: W, height: HH, rx: 16 }));
    for (var x = 30; x < W; x += 30) g.appendChild(T('line', { 'class': 'dp-grid', x1: x, y1: 0, x2: x, y2: HH }));
    for (var y = 30; y < HH; y += 30) g.appendChild(T('line', { 'class': 'dp-grid', x1: 0, y1: y, x2: W, y2: y }));
    return g;
  }
  /** La cadena de pasos de abajo: hecho · ahora · falta (≤ 10 pasos con número; más, sólo puntos). */
  function cadena(i, n, HH) {
    var g = T('g', { 'class': 'dp-cad' }), x0 = 44, x1 = W - 44, y = HH - 22, k, xs = [];
    if (n < 2) return g;
    for (k = 0; k < n; k++) xs.push(x0 + (x1 - x0) * k / (n - 1));
    for (k = 0; k < n - 1; k++) g.appendChild(T('line', { 'class': 'dp-cad-l' + (k < i ? ' is-done' : ''), x1: xs[k], y1: y, x2: xs[k + 1], y2: y }));
    for (k = 0; k < n; k++) {
      var c = T('g', { 'class': 'dp-cad-n' + (k < i ? ' is-done' : k === i ? ' is-now' : '') });
      c.appendChild(T('circle', { cx: xs[k], cy: y, r: k === i ? 11 : 9 }));
      if (n <= 10) c.appendChild(T('text', { x: xs[k], y: y + 4, 'class': 'dp-cad-t', 'text-anchor': 'middle' }, String(k + 1)));
      g.appendChild(c);
    }
    return g;
  }
  function escenaIcono(sp, i, n) {
    var g = T('g', { 'class': 'dp-in' });
    g.appendChild(T('circle', { 'class': 'dp-halo', cx: 140, cy: 122, r: 82 }));
    g.appendChild(T('circle', { 'class': 'dp-ring', cx: 140, cy: 122, r: 66 }));
    g.appendChild(icoSvg(sp.icono, 140 - 34, 122 - 34, 68));
    g.appendChild(texto(252, 156, p2(i + 1), 'dp-big'));
    g.appendChild(texto(256, 186, 'DE ' + p2(n), 'dp-sub'));
    return g;
  }
  function escenaDato(sp, sc) {
    var g = T('g', { 'class': 'dp-in' }), v = sp.valor, grande = v.length > 5 ? 70 : v.length > 3 ? 96 : 124;
    if (sp.icono) g.appendChild(icoSvg(sp.icono, 28, 24, 38));
    var tx = T('text', { x: 240, y: 156, 'class': 'dp-big dp-big--dato', 'text-anchor': 'middle', 'style': 'font-size:' + grande + 'px' }, v);
    if (sp.unidad) tx.appendChild(T('tspan', { 'class': 'dp-unit', dx: 8 }, sp.unidad));
    g.appendChild(tx);
    if (sp.etiqueta) g.appendChild(lineas(240, 196, envolver(sp.etiqueta, Math.max(16, Math.floor(420 / (fuente(sc) * 0.58))), 2), 'dp-sub dp-sub--c', fuente(sc) * 1.2));
    return g;
  }
  function escenaLista(sp, sc) {
    var g = T('g', { 'class': 'dp-in' }), fs = fuente(sc), lh = fs * 1.18, maxc = Math.max(14, Math.floor((W - 82 - 26) / (fs * 0.58))), y = 22, total = 0;
    sp.items.forEach(function (t, k) {
      var ls = envolver(t, maxc, 2), hh = Math.max(34, ls.length * lh + 14), cy = y + hh / 2 - 2, hecho = sp.hecho.indexOf(k) >= 0, now = k === sp.actual;
      var f = T('g', { 'class': 'dp-fila' + (hecho ? ' is-hecho' : '') + (now ? ' is-now' : '') });
      if (now) f.appendChild(T('rect', { 'class': 'dp-fila-bg', x: 28, y: y - 2, width: W - 56, height: hh - 4, rx: 8 }));
      f.appendChild(T('circle', { 'class': 'dp-fila-c', cx: 58, cy: cy, r: 11 }));
      if (hecho) f.appendChild(T('path', { 'class': 'dp-fila-ok', d: 'M52 ' + cy + ' l4 4 l8 -8' }));
      else f.appendChild(T('text', { x: 58, y: cy + 4, 'class': 'dp-cad-t', 'text-anchor': 'middle' }, String(k + 1)));
      f.appendChild(lineas(82, cy - (ls.length - 1) * lh / 2 + fs * 0.34, ls, 'dp-t', lh, 'start'));
      g.appendChild(f); y += hh; total += hh;
    });
    return { g: g, H: Math.max(H, 22 + total + 56) };
  }
  function escenaComparar(sp, sc) {
    var g = T('g', { 'class': 'dp-in' }), fs = fuente(sc), maxc = Math.max(8, Math.floor(188 / (fs * 0.58)));
    [['a', 24, sp.a], ['b', 252, sp.b]].forEach(function (c) {
      var x = c[1], ld = c[2], dim = sp.foco && sp.foco !== c[0];
      var f = T('g', { 'class': 'dp-card' + (dim ? ' is-dim' : '') + (sp.foco === c[0] ? ' is-foco' : '') });
      f.appendChild(T('rect', { 'class': 'dp-card-bg', x: x, y: 30, width: 204, height: 184, rx: 14 }));
      f.appendChild(T('circle', { 'class': 'dp-ring dp-ring--s', cx: x + 102, cy: 84, r: 33 }));
      f.appendChild(icoSvg(ld.icono || iconoPara(ld.titulo, c[0] === 'a' ? 0 : 1), x + 102 - 18, 84 - 18, 36));
      f.appendChild(lineas(x + 102, 150, envolver(ld.titulo, maxc, 3), 'dp-t dp-t--c', fs * 1.2));
      g.appendChild(f);
    });
    g.appendChild(T('circle', { 'class': 'dp-vs', cx: 240, cy: 122, r: 17 }));
    g.appendChild(T('text', { x: 240, y: 127, 'class': 'dp-cad-t', 'text-anchor': 'middle' }, 'VS'));
    return g;
  }
  function escenaFlujo(sp, sc) {
    var g = T('g', { 'class': 'dp-in' }), fs = fuente(sc), lh = fs * 1.18, n = sp.nodos.length, porFila = n <= 4 ? n : Math.ceil(n / 2), filas = Math.ceil(n / porFila), nw = Math.min(104, (W - 60 - (porFila - 1) * 26) / porFila);
    var maxc = Math.max(6, Math.floor((nw - 14) / (fs * 0.6))), lsN = sp.nodos.map(function (t) { return envolver(t, maxc, 3); }), maxL = lsN.reduce(function (a, l) { return Math.max(a, l.length); }, 1), nh = Math.max(62, maxL * lh + 18);
    var gap = porFila > 1 ? (W - 60 - porFila * nw) / (porFila - 1) : 0, HH = Math.max(H, 28 + filas * (nh + 44) + 36), y0 = filas === 1 ? Math.max(40, (HH - 40 - nh) / 2) : 40, pos = [];
    sp.nodos.forEach(function (t, k) {
      var r = Math.floor(k / porFila), c = k % porFila; if (r % 2 === 1) c = porFila - 1 - c;
      pos.push([30 + c * (nw + gap), y0 + r * (nh + 44)]);
    });
    sp.nodos.forEach(function (t, k) {
      if (k) {
        var a = pos[k - 1], b = pos[k], misma = Math.abs(a[1] - b[1]) < 1;
        if (misma) {
          var dir = b[0] > a[0] ? 1 : -1, xa = a[0] + (dir > 0 ? nw : 0), xb = b[0] + (dir > 0 ? 0 : nw);
          g.appendChild(T('line', { 'class': 'dp-fl-l' + (k <= sp.actual ? ' is-done' : ''), x1: xa, y1: a[1] + nh / 2, x2: xb - dir * 6, y2: b[1] + nh / 2 }));
          g.appendChild(T('polygon', { 'class': 'dp-fl-h' + (k <= sp.actual ? ' is-done' : ''), points: xb + ',' + (b[1] + nh / 2) + ' ' + (xb - dir * 9) + ',' + (b[1] + nh / 2 - 5) + ' ' + (xb - dir * 9) + ',' + (b[1] + nh / 2 + 5) }));
        } else {
          var cx = a[0] + nw / 2;
          g.appendChild(T('line', { 'class': 'dp-fl-l' + (k <= sp.actual ? ' is-done' : ''), x1: cx, y1: a[1] + nh, x2: cx, y2: b[1] - 6 }));
          g.appendChild(T('polygon', { 'class': 'dp-fl-h' + (k <= sp.actual ? ' is-done' : ''), points: cx + ',' + b[1] + ' ' + (cx - 5) + ',' + (b[1] - 9) + ' ' + (cx + 5) + ',' + (b[1] - 9) }));
        }
      }
    });
    sp.nodos.forEach(function (t, k) {
      var x = pos[k][0], y = pos[k][1], ls = lsN[k], f = T('g', { 'class': 'dp-nodo' + (k < sp.actual ? ' is-done' : k === sp.actual ? ' is-now' : '') });
      f.appendChild(T('rect', { 'class': 'dp-nodo-bg', x: x, y: y, width: nw, height: nh, rx: 10 }));
      f.appendChild(lineas(x + nw / 2, y + nh / 2 - (ls.length - 1) * lh / 2 + fs * 0.34, ls, 'dp-t dp-t--n', lh));
      g.appendChild(f);
    });
    return { g: g, H: HH };
  }
  function escenaFormula(sp, sc) {
    var g = T('g', { 'class': 'dp-in' }), t = sp.texto, ls = [t];
    if (t.length > 22) { var m = t.length / 2, cut = -1, k; for (k = 0; k < t.length; k++) if (/[=\s]/.test(t.charAt(k)) && (cut < 0 || Math.abs(k - m) < Math.abs(cut - m))) cut = k; if (cut > 3 && cut < t.length - 3) ls = [t.slice(0, cut + (t.charAt(cut) === '=' ? 1 : 0)).trim(), t.slice(cut + (t.charAt(cut) === '=' ? 1 : 0)).trim()]; }
    var tam = ls.reduce(function (a, l) { return Math.max(a, l.length); }, 0) > 20 ? 26 : 34;
    g.appendChild(T('rect', { 'class': 'dp-formula-bg', x: 24, y: 52, width: W - 48, height: 40 + ls.length * 46, rx: 14 }));
    ls.forEach(function (l, k) { g.appendChild(T('text', { x: 240, y: 112 + k * 46, 'class': 'dp-formula', 'text-anchor': 'middle', 'style': 'font-size:' + tam + 'px' }, l)); });
    if (sp.nota) g.appendChild(lineas(240, 52 + 40 + ls.length * 46 + 36, envolver(sp.nota, Math.max(18, Math.floor(430 / (fuente(sc) * 0.58))), 2), 'dp-sub dp-sub--c', fuente(sc) * 1.2));
    return g;
  }
  /** El dibujo generado de un paso (con su fondo y la cadena de pasos): devuelve { g, H } (H = alto del dibujo en unidades; crece si el texto necesita lugar). */
  function escenaGenerica(sp, i, n, sc) {
    var r = sp.tipo === 'lista' ? escenaLista(sp, sc) : sp.tipo === 'flujo' ? escenaFlujo(sp, sc)
      : { g: sp.tipo === 'dato' ? escenaDato(sp, sc) : sp.tipo === 'comparar' ? escenaComparar(sp, sc) : sp.tipo === 'formula' ? escenaFormula(sp, sc) : escenaIcono(sp, i, n), H: H };
    var g = T('g', { 'class': 'dp-esc' });
    g.appendChild(fondo(r.H)); g.appendChild(r.g); g.appendChild(cadena(i, n, r.H));
    return { g: g, H: r.H };
  }

  /** Un lienzo que muestra un paso: o una figura con capas, o el dibujo generado. mostrar(spec, i, n, estadoFigura) vuelve a pintar sin parpadear si sigue siendo la misma figura. */
  function crearEscena(o) {
    o = o || {};
    var svg = T('svg', { 'class': 'dg-svg es-dia-svg', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true', focusable: 'false' });
    var cur = { figura: '', ids: {} }, off = U.escalarEtiquetas(svg), ultimo = null, sUsada = 1, ro = null, tRe = 0, rehechos = 0;
    function limpiar() { while (svg.firstChild) svg.removeChild(svg.firstChild); cur = { figura: '', ids: {} }; }
    function pintarFigura(st) {
      Object.keys(cur.ids).forEach(function (id) {
        var el = cur.ids[id];
        el.classList.toggle('is-hidden', st.visibles[id] === false); el.classList.toggle('is-hl', st.resalta.indexOf(id) >= 0); el.classList.toggle('is-dim', st.atenua.indexOf(id) >= 0);
      });
    }
    var api = {
      svg: svg,
      mostrar: function (sp, i, n, estado) {
        var Fig = ES.figuras;
        ultimo = [sp, i, n, estado];
        if (sp.tipo === 'figura' && Fig && Fig.has(sp.figura)) {
          if (cur.figura !== sp.figura) {
            limpiar();
            var f = Fig.get(sp.figura);
            svg.setAttribute('viewBox', f.viewBox); svg.setAttribute('role', 'img'); svg.removeAttribute('aria-hidden');
            svg.setAttribute('aria-label', 'Dibujo de la explicación: ' + f.capas.map(function (c) { return c.nombre; }).join(', '));
            var gF = T('g', { 'class': 'dp-fig' });
            f.capas.forEach(function (c) { var el = T('g', { 'class': 'an-el', 'data-id': c.id }); el.appendChild(Fig.seguro(c.svg)); cur.ids[c.id] = el; gF.appendChild(el); });
            svg.appendChild(gF); cur.figura = sp.figura;
          }
          if (estado) pintarFigura(estado);
        } else {
          limpiar();
          sUsada = parseFloat(svg.style.getPropertyValue('--dg-s')) || 1;
          var r = escenaGenerica(sp, i, n, sUsada);
          svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r.H); svg.setAttribute('aria-hidden', 'true'); svg.removeAttribute('role'); svg.removeAttribute('aria-label');
          svg.appendChild(r.g);
        }
        if (svg._dgMedir) svg._dgMedir();
      },
      destroy: function () { off(); clearTimeout(tRe); if (ro) { try { ro.disconnect(); } catch (e) { /* idem */ } } }
    };
    // cuando el dibujo cambia mucho de escala (rotar el teléfono, abrir el visor) los textos se acomodan de nuevo: nunca menos de 11 px y sin salirse de la caja
    function reajustar() {
      if (!ultimo || ultimo[0].tipo === 'figura' || rehechos > 40) return;
      var s2 = parseFloat(svg.style.getPropertyValue('--dg-s')) || 1;
      if (Math.abs(s2 - sUsada) / sUsada < 0.12) return;
      rehechos++; api.mostrar(ultimo[0], ultimo[1], ultimo[2], ultimo[3]);
    }
    if (typeof ResizeObserver === 'function') { try { ro = new ResizeObserver(function () { clearTimeout(tRe); tRe = setTimeout(reajustar, 140); }); ro.observe(svg); } catch (e) { ro = null; } }
    return api;
  }

  /** La frase de un paso con el mini-marcado (**término**, ==clave==, {{valor|unidad}}) y el glosario; si no se puede, texto plano. */
  function fraseEl(ctx, t) {
    var B = ES.bloques, K = ctx.Kit, frag = null;
    if (B && isFn(B.inline) && K) { try { frag = B.inline(K, t, { glosario: ctx.glosario, termino: function () { return null; } }); } catch (e) { frag = null; } }
    return frag || document.createTextNode(plano(t));
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, K = ctx.Kit, reducido = !!ctx.reducedMotion, pasos = datos.pasos, n = pasos.length;
    var Fig = ES.figuras, capasFig = null, idx = 0, vistos = {}, hecho = !!ctx.hecho, jugando = false, timer = null, t0 = 0, dur = 0, enPantalla = true, io = null, iniciada = false, uid = (render._uid = (render._uid || 0) + 1);
    var tieneFig = pasos.some(function (p) { return !!p.figura; });
    if (tieneFig && Fig) { var f0 = pasos.filter(function (p) { return p.figura; })[0]; var ff = Fig.get(f0.figura); capasFig = ff ? ff.capas : null; }
    vistos[0] = true;

    var esc = crearEscena({ reducido: reducido });
    var barra = h('i'), tm = h('div', { 'class': 'es-dia-tm', 'aria-hidden': 'true' }, barra);
    var stage = h('div', { 'class': 'es-dia-stage', tabindex: '0', role: 'group', 'aria-roledescription': 'diapositiva',
      'aria-label': 'Diapositiva animada de ' + n + (n === 1 ? ' paso' : ' pasos') + '. Flechas izquierda y derecha para cambiar de paso, espacio para reproducir o pausar.' }, esc.svg, tm);
    var kick = h('p', { 'class': 'es-dia-kick' });
    var cap = h('p', { 'class': 'es-dia-cap', id: 'es-dia-c-' + uid, 'aria-live': 'polite', 'aria-atomic': 'true' });
    var dots = h('ol', { 'class': 'es-dia-dots', 'aria-label': 'Pasos de la diapositiva' });
    var dotB = pasos.map(function (p, k) {
      var b = h('button', { type: 'button', 'class': 'es-dia-dot', 'aria-label': 'Ir al paso ' + (k + 1) + (p.titulo ? ': ' + plano(p.titulo) : ''), onclick: function () { pararAuto(); ir(k); } });
      dots.appendChild(h('li', null, b)); return b;
    });
    var bPrev = K.button({ label: 'Anterior', icon: 'chevron-left', variant: 'secondary', onClick: function () { pararAuto(); ir(idx - 1); } });
    var bNext = K.button({ label: 'Siguiente', iconRight: 'chevron-right', variant: 'primary', onClick: function () { pararAuto(); ir(idx + 1); } });
    var bPlay = K.button({ label: 'Reproducir', icon: 'play', variant: 'ghost', onClick: function () { if (jugando) pararAuto(); else reproducir(); } });
    if (reducido || n < 2) bPlay.hidden = true;
    var ctl = h('div', { 'class': 'es-dia-ctl' }, bPrev, bPlay, bNext);
    var ok = h('p', { 'class': 'es-pill is-ok es-dia-ok', role: 'status', hidden: true }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }), h('span', { 'class': 'es-pill-t', text: 'Listo: viste todos los pasos. Podés repasarlos con Anterior o seguir con la lección.' }));
    var raiz = h('div', { 'class': 'es-dia' + (reducido ? ' is-rm' : '') }, stage, kick, cap, n > 1 ? dots : null, n > 1 ? ctl : null, ok,
      reducido && n > 1 ? h('p', { 'class': 'es-note', text: 'Tenés activado «reducir movimiento»: la diapositiva no se reproduce sola. Pasá de a un paso con los botones o las flechas.' }) : null,
      datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null);
    host.appendChild(raiz);

    function marcarPlay() {
      while (bPlay.firstChild) bPlay.removeChild(bPlay.firstChild);
      bPlay.appendChild(icon(jugando ? 'pause' : 'play'));
      bPlay.appendChild(document.createTextNode(jugando ? 'Pausar' : (idx >= n - 1 ? 'Repetir' : 'Reproducir')));
      bPlay.setAttribute('aria-pressed', jugando ? 'true' : 'false');
    }
    function pintar() {
      var p = pasos[idx];
      esc.mostrar(p.escena, idx, n, p.figura && capasFig ? estadoFigura(pasos, idx, capasFig) : null);
      kick.textContent = ('Paso ' + p2(idx + 1) + ' / ' + p2(n) + (p.titulo ? ' · ' + plano(p.titulo) : '')).toUpperCase();
      while (cap.firstChild) cap.removeChild(cap.firstChild);
      cap.appendChild(fraseEl(ctx, p.texto));
      cap.classList.remove('is-in'); if (!reducido) { void cap.offsetWidth; cap.classList.add('is-in'); }
      dotB.forEach(function (b, k) { b.classList.toggle('is-done', k < idx || !!vistos[k]); if (k === idx) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      bPrev.disabled = idx <= 0; bNext.disabled = idx >= n - 1;
      bPrev.setAttribute('aria-disabled', idx <= 0 ? 'true' : 'false'); bNext.setAttribute('aria-disabled', idx >= n - 1 ? 'true' : 'false');
      marcarPlay();
    }
    function verFin() {
      var todos = true, k; for (k = 0; k < n; k++) if (!vistos[k]) { todos = false; break; }
      if (todos && !hecho) { hecho = true; ctx.done(); }
      ok.hidden = !(todos && n > 1);
    }
    function ir(k) { idx = clamp(k, 0, n - 1); vistos[idx] = true; pintar(); verFin(); }
    /* ---- reproducción automática */
    function pararAuto() { if (timer) { clearInterval(timer); timer = null; } jugando = false; barra.style.width = '0%'; if (tm) tm.classList.remove('is-on'); marcarPlay(); }
    function tic() {
      if (!enPantalla || (typeof document !== 'undefined' && document.hidden)) { t0 += 0.1; return; }
      var f = (ctx.ahora() - t0) / 1000 / dur;
      barra.style.width = Math.round(clamp(f, 0, 1) * 100) + '%';
      if (f >= 1) { if (idx >= n - 1) { pararAuto(); return; } ir(idx + 1); armar(); }
    }
    function armar() { t0 = ctx.ahora(); dur = duracionPaso(pasos[idx].texto, pasos[idx].titulo, datos.segundos); barra.style.width = '0%'; }
    function reproducir() {
      if (reducido || n < 2 || jugando) return;
      if (idx >= n - 1) { idx = 0; vistos[0] = true; pintar(); }
      jugando = true; tm.classList.add('is-on'); armar(); marcarPlay();
      timer = setInterval(tic, 100);
    }
    stage.addEventListener('keydown', function (ev) {
      if (ev.target !== stage || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var k = ev.key;
      if (k === 'ArrowRight') { pararAuto(); ir(idx + 1); ev.preventDefault(); }
      else if (k === 'ArrowLeft') { pararAuto(); ir(idx - 1); ev.preventDefault(); }
      else if (k === 'Home') { pararAuto(); ir(0); ev.preventDefault(); }
      else if (k === 'End') { pararAuto(); ir(n - 1); ev.preventDefault(); }
      else if ((k === ' ' || k === 'Enter') && !reducido && n > 1) { if (jugando) pararAuto(); else reproducir(); ev.preventDefault(); }
    });

    pintar(); verFin();
    // se reproduce sola sólo cuando se la ve (y nunca con «reducir movimiento»)
    if (datos.autoplay && !reducido && n > 1) {
      if (typeof IntersectionObserver === 'function') {
        try { io = new IntersectionObserver(function (es) { var v = es[0] && es[0].isIntersecting; enPantalla = !!v; if (v && !jugando && !iniciada) { iniciada = true; reproducir(); } }, { threshold: 0.45 }); io.observe(raiz); } catch (e) { io = null; }
      }
      if (!io) { iniciada = true; setTimeout(reproducir, 300); }
    }

    return {
      destroy: function () { pararAuto(); if (io) { try { io.disconnect(); } catch (e) { /* idem */ } io = null; } esc.destroy(); },
      pause: function () { pararAuto(); },
      resume: function () { /* queda en pausa: la reanuda el alumno */ },
      getState: function () { return { paso: idx, de: n, jugando: jugando, vistos: Object.keys(vistos).length, figura: !!tieneFig }; }
    };
  }

  Mot.register('diapositiva', { normalizar: normalizar, render: render });
  ES.diapositiva = { normalizar: normalizar, escenaDe: escenaDe, iconoPara: iconoPara, estadoFigura: estadoFigura, duracionPaso: duracionPaso, ESCENAS: ESCENAS, crearEscena: crearEscena, fraseEl: fraseEl, limpiarEscena: limpiarEscena };
})(root.C150);
