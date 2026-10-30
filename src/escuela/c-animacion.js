var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-animacion.js — componente `animacion` (ANI): una secuencia que se reproduce, se pausa y se recorre paso a paso, con subtítulos que siguen la escena
 * (contrato v7, E2). Motor SVG. Con "reducir movimiento" no se reproduce sola: muestra los pasos estáticos con Anterior / Siguiente y la lista completa.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { duracion?:segundos,                                  por defecto, hasta el final de la última escena
 *     motor:'svg',                                         (canvas y 3d quedan para más adelante)
 *     escenas:[{ t, texto, etiqueta?, hora?, min?, tipo?, cambios? }],      t = segundo en que empieza; texto = el subtítulo; etiqueta = rótulo corto del paso
 *     forma?:'camino'|'bloques'|'figura',                  camino: pasos numerados unidos por una línea con una ficha que avanza (por defecto);
 *                                                          bloques: barra de tiempo con tramos proporcionales a `min` y un cursor (tipo: 'clase' | 'recreo' | …);
 *                                                          figura: dibujo SVG propio al que las escenas le aplican `cambios`
 *     figura?:'perfil-ala'|'ala-planta',  svg?:'<formas SVG con id>',  viewBox?:'0 0 400 220',   para forma 'figura' (la cadena se limpia: sólo formas y textos)
 *     nota?:'texto' }
 *   cambios (acumulativos hacia adelante; al retroceder se recalcula todo): { mostrar:[id…], ocultar:[id…], resaltar:[id…] (sólo en esa escena), atenuar:[id…] (sólo en esa escena),
 *           mover:{ id:[dx,dy] }, rotar:{ id:grados }, escala:{ id:k }, opacidad:{ id:0..1 }, texto:{ id:'nuevo texto' } }   id = una capa de la figura o un elemento con ese id
 *   normalizar entiende los esbozos del plan: pasos / hitos / bloques / nodos / fases / eventos / escenas / casos (lista de textos u objetos), {accion, resultado},
 *   o `pasos: N` (cuenta) con los pasos numerados "1) … 2) …" de la descripción del componente. Si no encuentra una secuencia sensata devuelve null.
 * Handle: destroy · pause · resume · getState.  Completa la lección (ctx.done()) cuando se vieron todas las escenas.
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
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function corto(t, n) { t = String(t); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; }

  /* ================================================================== normalizar (puro) */
  var FUENTES = ['escenas', 'pasos', 'hitos', 'bloques', 'nodos', 'fases', 'eventos', 'casos'];
  function cap(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  /** "1) uno; 2) dos; 3) tres" → ['uno','dos','tres'] (sólo si la numeración es 1, 2, 3… seguida). */
  function numerados(t) {
    t = String(t || '');
    var re = /(?:^|[\s;:.])(\d{1,2})\)\s+/g, m, marcas = [];
    while ((m = re.exec(t))) marcas.push({ n: +m[1], ini: m.index + m[0].length, fin: m.index });
    var ok = marcas.length >= 2 && marcas.every(function (x, i) { return x.n === i + 1; });
    if (!ok) return [];
    return marcas.map(function (x, i) { return t.slice(x.ini, i + 1 < marcas.length ? marcas[i + 1].fin : t.length).replace(/[;.\s]+$/, '').trim(); }).filter(Boolean);
  }
  function escenaDe(o, i, fuente) {
    if (typeof o === 'string' || typeof o === 'number') { var t = str(o); return t ? { texto: cap(t), etiqueta: t.length <= 26 ? t : '' } : null; }
    if (!esObj(o)) return null;
    var e = { texto: '', etiqueta: '' };
    if (fuente === 'bloques' || U.isNum(U.num(o.min, null)) && str(o.tipo)) {
      var mn = U.num(o.min, null); if (mn === null || mn <= 0) return null;
      var tipo = str(o.tipo) || 'bloque';
      return { texto: cap(tipo) + ' · ' + mn + ' min', etiqueta: cap(tipo), min: mn, tipo: tipo };
    }
    var cuerpo = str(o.texto) || str(o.descripcion) || str(o.paso) || str(o.accion) || str(o.resultado);
    var rot = str(o.control) || str(o.etiqueta) || str(o.titulo) || str(o.nombre) || str(o.hora);
    if (!cuerpo && !rot) {   // objetos de pares clave/valor (casos): "Peso: liviano · Alt: 0"
      var ps = [];
      Object.keys(o).forEach(function (k) { var v = o[k]; if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) ps.push(cap(k.replace(/_/g, ' ')) + ': ' + v); });
      if (!ps.length) return null;
      cuerpo = ps.join(' · '); rot = '';
    }
    var hora = str(o.hora);
    e.texto = (hora && cuerpo ? hora + ' · ' : '') + (cuerpo || rot);
    e.etiqueta = rot && rot.length <= 26 ? rot : (hora || '');
    if (hora) e.hora = hora;
    if (esObj(o.cambios)) e.cambios = o.cambios;
    if (U.isNum(U.num(o.t, null))) e.t = U.num(o.t, 0);
    return e;
  }

  function normalizar(datos, ctx, comp) {
    if (!esObj(datos)) return null;
    var nota = [datos.nota, datos.aclaracion].filter(function (t) { return typeof t === 'string' && t.trim(); })[0] || '';
    var fuente = null, lista = null, i;
    for (i = 0; i < FUENTES.length; i++) { if (Array.isArray(datos[FUENTES[i]]) && datos[FUENTES[i]].length >= 2) { fuente = FUENTES[i]; lista = datos[FUENTES[i]]; break; } }
    if (!lista && U.isNum(datos.pasos) && datos.pasos >= 2) { var nn = numerados(comp && comp.descripcion); if (nn.length >= 2) { fuente = 'pasos'; lista = nn; } }
    if (!lista && str(datos.accion) && str(datos.resultado)) { fuente = 'pasos'; lista = [datos.accion, datos.resultado]; }
    if (!lista) return null;
    var esc = lista.map(function (o, k) { return escenaDe(o, k, fuente); }).filter(Boolean);
    if (esc.length < 2) return null;

    /* tiempos: t explícito, o repartido según el largo del texto (o de los minutos en los bloques) */
    var forma = (typeof datos.forma === 'string' && /^(camino|bloques|figura)$/.test(datos.forma)) ? datos.forma : (esc.every(function (e) { return e.min; }) ? 'bloques' : 'camino');
    var fig = typeof datos.figura === 'string' ? datos.figura : '', svg = typeof datos.svg === 'string' ? datos.svg : '';
    if ((fig || svg) && esc.some(function (e) { return e.cambios; })) forma = 'figura'; else if (forma === 'figura') forma = 'camino';
    var t = 0, conT = esc.every(function (e) { return U.isNum(e.t); });
    esc.forEach(function (e) {
      if (!conT) { e.t = Math.round(t * 10) / 10; t += e.min ? Math.max(2.5, Math.min(7, e.min * 0.15)) : clamp(2.6 + e.texto.length / 20, 3, 6.5); }
    });
    var dur = U.isNum(U.num(datos.duracion, null)) ? U.num(datos.duracion, 0) : (conT ? esc[esc.length - 1].t + 4 : Math.round(t * 10) / 10);
    if (dur <= esc[esc.length - 1].t) dur = esc[esc.length - 1].t + 3;
    var vb = (typeof datos.viewBox === 'string' && /^\s*-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?){3}\s*$/.test(datos.viewBox)) ? datos.viewBox.trim() : '';
    return { duracion: dur, motor: 'svg', forma: forma, escenas: esc, figura: forma === 'figura' ? fig : '', svg: forma === 'figura' ? svg : '', viewBox: vb, nota: nota };
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var K = ctx.Kit, h = ctx.h, icon = ctx.icon, Fig = ES.figuras, esc = datos.escenas, n = esc.length, dur = datos.duracion, reducido = !!ctx.reducedMotion;
    var t = 0, vel = 1, idx = 0, jugando = false, timer = null, ultimoMs = 0, vistas = {}, hecho = !!ctx.hecho, fin = false;
    vistas[0] = true;

    /* ---- el lienzo SVG según la forma */
    var svg, lienzo = {}, W = 360, H = 120;
    function escenaEn(tt) { var k = 0; for (var j = 0; j < n; j++) if (esc[j].t <= tt + 1e-6) k = j; return k; }
    function nodoPos() {
      var cols = n <= 5 ? n : Math.ceil(n / Math.ceil(n / 5)), rows = Math.ceil(n / cols), pos = [];
      for (var k = 0; k < n; k++) { var r = Math.floor(k / cols), c = k % cols; if (r % 2 === 1) c = cols - 1 - c; pos.push([18 + (W - 36) * (c + 0.5) / cols, 34 + r * 92]); }
      H = 34 + (rows - 1) * 92 + 62;
      return pos;
    }
    function dibujarCamino() {
      var pos = nodoPos(), segs = [], nodos = [];
      svg = U.svg('svg', { 'class': 'dg-svg es-ani-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Secuencia de ' + n + ' pasos' });
      var gS = U.svg('g', { 'class': 'an-segs' }), gN = U.svg('g');
      for (var k = 0; k < n - 1; k++) { var s = U.svg('line', { 'class': 'an-seg', x1: pos[k][0], y1: pos[k][1], x2: pos[k + 1][0], y2: pos[k + 1][1] }); segs.push(s); gS.appendChild(s); }
      var colW = n <= 5 ? (W - 36) / n : (W - 36) / Math.ceil(n / Math.ceil(n / 5)), max = Math.max(8, Math.floor(colW / 5.6));
      esc.forEach(function (e, j) {
        var dec = /^¿|\?$/.test(e.etiqueta || e.texto), g = U.svg('g', { 'class': 'an-nd' });
        g.appendChild(dec ? U.svg('polygon', { 'class': 'an-sh', points: pos[j][0] + ',' + (pos[j][1] - 19) + ' ' + (pos[j][0] + 19) + ',' + pos[j][1] + ' ' + pos[j][0] + ',' + (pos[j][1] + 19) + ' ' + (pos[j][0] - 19) + ',' + pos[j][1] }) : U.svg('circle', { 'class': 'an-sh', cx: pos[j][0], cy: pos[j][1], r: 16 }));
        g.appendChild(U.svg('text', { 'class': 'an-n', x: pos[j][0], y: pos[j][1] + 4.5, 'text-anchor': 'middle' }, String(j + 1)));
        if (e.etiqueta) {
          var words = e.etiqueta.split(/\s+/), lin = [], cur = '';
          words.forEach(function (w) { if ((cur + ' ' + w).trim().length <= max) cur = (cur + ' ' + w).trim(); else { if (cur) lin.push(cur); cur = w; } }); if (cur) lin.push(cur);
          if (lin.length > 2) { lin = lin.slice(0, 2); lin[1] = corto(lin[1] + '…', max); }
          var tx = U.svg('text', { 'class': 'an-l', x: pos[j][0], y: pos[j][1] + 32, 'text-anchor': 'middle', 'data-slot': Math.round(colW - 4) });
          lin.forEach(function (l, m) { tx.appendChild(U.svg('tspan', { x: pos[j][0], dy: m ? 12 : 0 }, l)); });
          g.appendChild(tx);
        }
        nodos.push(g); gN.appendChild(g);
      });
      var tok = U.svg('g', { 'class': 'an-tok' }, U.svg('circle', { r: 8 }), U.svg('circle', { r: 3, 'class': 'an-tok-c' }));
      tok.style.transform = 'translate(' + pos[0][0] + 'px,' + pos[0][1] + 'px)';
      svg.appendChild(gS); svg.appendChild(gN); svg.appendChild(tok);
      lienzo = { pos: pos, segs: segs, nodos: nodos, tok: tok };
    }
    function dibujarBloques() {
      var tot = 0, x0 = 10, ancho = W - 20, acc = 0, rects = [], cum = [];
      esc.forEach(function (e) { cum.push(tot); tot += e.min; });
      H = 118;
      svg = U.svg('svg', { 'class': 'dg-svg es-ani-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Línea de tiempo de ' + tot + ' minutos' });
      esc.forEach(function (e, j) {
        var w = ancho * e.min / tot, rc = U.svg('g', { 'class': 'an-bl' + (/recreo|descanso|pausa/i.test(e.tipo) ? ' is-rec' : '') });
        rc.appendChild(U.svg('rect', { 'class': 'an-sh', x: x0 + acc + 1, y: 38, width: Math.max(2, w - 2), height: 36, rx: 6 }));
        if (w >= 38) rc.appendChild(U.svg('text', { 'class': 'an-l', x: x0 + acc + w / 2, y: 60, 'text-anchor': 'middle' }, e.min + ' min'));
        rects.push(rc); svg.appendChild(rc); acc += w;
      });
      var ph = U.svg('g', { 'class': 'an-ph' }, U.svg('line', { x1: 0, y1: 28, x2: 0, y2: 86 }), U.svg('polygon', { points: '-6,22 6,22 0,31' }));
      ph.style.transform = 'translate(' + x0 + 'px,0)';
      var rel = U.svg('text', { 'class': 'an-l an-clock', x: x0, y: 104 }, '0 min'), tmax = U.svg('text', { 'class': 'an-l', x: W - 10, y: 104, 'text-anchor': 'end' }, tot + ' min');
      svg.appendChild(ph); svg.appendChild(rel); svg.appendChild(tmax);
      lienzo = { rects: rects, ph: ph, x0: x0, ancho: ancho, tot: tot, cum: cum, reloj: rel };
    }
    function dibujarFigura() {
      var f = (datos.figura && Fig && Fig.has(datos.figura)) ? Fig.get(datos.figura) : null, vb = datos.viewBox || (f ? f.viewBox : '0 0 400 220'), p = vb.split(/\s+/).map(Number);
      svg = U.svg('svg', { 'class': 'dg-svg es-ani-svg', viewBox: vb, role: 'img', 'aria-label': 'Animación de ' + n + ' escenas' });
      var cont = U.svg('g'), ids = {}, base = {};
      if (f) f.capas.forEach(function (c) { var g = U.svg('g', { 'class': 'an-el', id: 'es-an-' + c.id }); g.appendChild(Fig.seguro(c.svg)); g.setAttribute('data-id', c.id); if (c.visible === false) g.classList.add('is-hidden'); base[c.id] = c.visible !== false; ids[c.id] = g; cont.appendChild(g); });
      if (datos.svg && Fig) { var g2 = Fig.seguro(datos.svg); cont.appendChild(g2); Array.prototype.forEach.call(g2.querySelectorAll('[id]'), function (el) { ids[el.getAttribute('id')] = el; el.classList.add('an-el'); }); }
      svg.appendChild(cont);
      lienzo = { ids: ids, base: base, vb: p };
      W = p[2]; H = p[3];
    }
    if (datos.forma === 'bloques') dibujarBloques(); else if (datos.forma === 'figura') dibujarFigura(); else dibujarCamino();

    /* ---- poner el lienzo en la escena k (estado calculado desde cero: sirve para avanzar y retroceder) */
    function pintar(k, frac) {
      if (datos.forma === 'camino') {
        lienzo.nodos.forEach(function (g, j) { g.classList.toggle('is-done', j < k); g.classList.toggle('is-now', j === k); });
        lienzo.segs.forEach(function (s, j) { s.classList.toggle('is-done', j < k); });
        lienzo.tok.style.transform = 'translate(' + lienzo.pos[k][0] + 'px,' + lienzo.pos[k][1] + 'px)';
      } else if (datos.forma === 'bloques') {
        lienzo.rects.forEach(function (g, j) { g.classList.toggle('is-done', j < k); g.classList.toggle('is-now', j === k); });
        var mins = lienzo.cum[k] + (frac === undefined ? 0 : clamp(frac, 0, 1)) * esc[k].min;
        lienzo.ph.style.transform = 'translate(' + (lienzo.x0 + lienzo.ancho * mins / lienzo.tot) + 'px,0)';
        lienzo.reloj.textContent = Math.round(mins) + ' min';
      } else {
        var st = {}, tr = {}, solo = { resaltar: [], atenuar: [] }, j;
        for (var id in lienzo.ids) st[id] = lienzo.base[id] !== undefined ? lienzo.base[id] : true;
        for (j = 0; j <= k; j++) {
          var c = esc[j].cambios || {};
          arr(c.mostrar).forEach(function (x) { st[x] = true; }); arr(c.ocultar).forEach(function (x) { st[x] = false; });
          ['mover', 'rotar', 'escala', 'opacidad', 'texto'].forEach(function (q) { if (esObj(c[q])) Object.keys(c[q]).forEach(function (x) { (tr[x] = tr[x] || {})[q] = c[q][x]; }); });
          if (j === k) { solo.resaltar = arr(c.resaltar); solo.atenuar = arr(c.atenuar); }
        }
        Object.keys(lienzo.ids).forEach(function (id) {
          var el = lienzo.ids[id], t2 = tr[id] || {}, tf = '';
          el.classList.toggle('is-hidden', st[id] === false); el.classList.toggle('is-hl', solo.resaltar.indexOf(id) >= 0); el.classList.toggle('is-dim', solo.atenuar.indexOf(id) >= 0);
          if (Array.isArray(t2.mover)) tf += 'translate(' + (+t2.mover[0] || 0) + 'px,' + (+t2.mover[1] || 0) + 'px) ';
          if (U.isNum(t2.rotar)) tf += 'rotate(' + t2.rotar + 'deg) ';
          if (U.isNum(t2.escala)) tf += 'scale(' + t2.escala + ') ';
          el.style.transform = tf; if (U.isNum(t2.opacidad)) el.style.opacity = String(t2.opacidad); else el.style.opacity = '';
          if (typeof t2.texto === 'string') { var te = el.querySelector('text') || (el.nodeName === 'text' ? el : null); if (te) te.textContent = t2.texto; }
        });
      }
    }

    /* ---- controles y subtítulos */
    var sub = h('p', { 'class': 'es-ani-sub', 'aria-live': 'polite' }), subMeta = h('span', { 'class': 'es-meta' }), subTxt = h('span', { 'class': 'es-ani-st' });
    sub.appendChild(subMeta); sub.appendChild(subTxt);
    function textoEscena(k) { subMeta.textContent = 'Paso ' + (k + 1) + ' de ' + n; subTxt.textContent = esc[k].texto; }
    var bPlay = K.button({ label: 'Reproducir', icon: 'play', variant: 'primary', onClick: function () { alternar(); } });
    var bPrev = K.iconButton({ icon: 'chevron-left', label: 'Paso anterior', onClick: function () { saltar(-1); } }), bNext = K.iconButton({ icon: 'chevron-right', label: 'Paso siguiente', onClick: function () { saltar(1); } });
    var bReset = K.iconButton({ icon: 'reset', label: 'Volver al principio', onClick: function () { pausar(); ir(0); marcarBoton(); } });
    [bPrev, bNext, bReset].forEach(function (b) { b.classList.add('es-ani-b'); });
    var segVel = reducido ? null : K.segmented({ items: [{ value: '0.5', label: '0,5×' }, { value: '1', label: '1×' }, { value: '1.5', label: '1,5×' }, { value: '2', label: '2×' }], value: '1', label: 'Velocidad', onChange: function (v) { vel = parseFloat(v); } });
    var ticks = esc.map(function (e, j) { return { v: e.t, t: String(j + 1) }; });
    var scrub = reducido ? null : K.slider({ label: 'Tiempo', min: 0, max: dur, step: 0.1, value: 0, format: function (v) { return (Math.round(v * 10) / 10 + '').replace('.', ',') + ' s'; }, ticks: ticks, onInput: function (v) { pausar(); ir(v, true); } });
    var estado = h('p', { 'class': 'es-pill is-ok', role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }), h('span', { 'class': 'es-pill-t', text: 'Listo: ya viste toda la secuencia. Podés repetirla o seguir con la lección.' })); estado.hidden = true;

    function ir(tt, desdeBarra) {
      t = clamp(tt, 0, dur); var k = escenaEn(t), cambia = k !== idx;
      var frac = k + 1 < n ? (t - esc[k].t) / ((esc[k + 1].t - esc[k].t) || 1) : (t - esc[k].t) / (((dur - esc[k].t)) || 1);
      fin = t >= dur - 1e-6; idx = k; vistas[k] = true; pintar(k, frac); if (cambia || !subTxt.textContent) textoEscena(k);
      if (scrub && !desdeBarra) scrub.set(t);
      verificarFin();
    }
    function verificarFin() {
      var todas = true; for (var j = 0; j < n; j++) if (!vistas[j]) { todas = false; break; }
      if (todas && !hecho) { hecho = true; ctx.done(); }
      estado.hidden = !(todas && (fin || reducido));
    }
    function saltar(d) {
      pausar(); var k = clamp(idx + d, 0, n - 1);
      if (d > 0 && idx === n - 1) { ir(dur); marcarBoton(); return; }
      ir(esc[k].t);
    }
    function marcarBoton() { while (bPlay.firstChild) bPlay.removeChild(bPlay.firstChild); bPlay.appendChild(icon(jugando ? 'pause' : 'play')); bPlay.appendChild(document.createTextNode(jugando ? 'Pausar' : (fin ? 'Repetir' : 'Reproducir'))); }
    function tic() {
      var ahora = Date.now(), dt = Math.min(0.25, (ahora - ultimoMs) / 1000) * vel; ultimoMs = ahora;
      var tt = t + dt;
      if (tt >= dur) { ir(dur); pausar(); return; }
      ir(tt);
    }
    function reproducir() {
      if (jugando) return;
      if (t >= dur - 1e-6) ir(0);
      jugando = true; ultimoMs = Date.now(); timer = setInterval(tic, 50); marcarBoton();
    }
    function pausar() { if (timer) { clearInterval(timer); timer = null; } jugando = false; marcarBoton(); }
    function alternar() { if (jugando) pausar(); else reproducir(); }

    var fila = h('div', { 'class': 'es-ani-ctl' }, bReset, bPrev, bPlay, bNext);
    if (reducido) { bPlay.hidden = true; bReset.hidden = true; }
    var lista = null;
    if (reducido) {
      lista = h('ol', { 'class': 'es-steps es-ani-lista', 'aria-label': 'Todos los pasos' });
      esc.forEach(function (e) { lista.appendChild(h('li', null, h('span', { text: e.texto }))); });
    }
    var stage = h('div', { 'class': 'es-ani-stage', tabindex: '0', role: 'group', 'aria-label': 'Animación. Flechas izquierda y derecha para cambiar de paso, espacio para reproducir o pausar.' }, svg);
    stage.addEventListener('keydown', function (ev) {
      if (ev.target !== stage) return;
      if (ev.key === 'ArrowRight') { saltar(1); ev.preventDefault(); } else if (ev.key === 'ArrowLeft') { saltar(-1); ev.preventDefault(); }
      else if ((ev.key === ' ' || ev.key === 'Enter') && !reducido) { alternar(); ev.preventDefault(); }
    });
    var raiz = h('div', { 'class': 'es-ani' + (reducido ? ' is-reducido' : '') });
    K.add(raiz, [h('div', { 'class': 'es-dgr-view es-ani-view' }, stage), sub, fila, scrub, segVel ? h('div', { 'class': 'es-ani-vel' }, h('span', { 'class': 'es-meta', text: 'Velocidad' }), segVel) : null, estado, lista,
      reducido ? h('p', { 'class': 'es-note', text: 'Tenés activado "reducir movimiento": la animación no se reproduce sola. Pasá de a un paso con los botones.' }) : null,
      datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null]);
    host.appendChild(raiz);
    marcarBoton(); ir(0); estado.hidden = true;
    var offEt = U.escalarEtiquetas(svg);       // etiquetas de 11 px o más en pantalla (v9)

    return {
      destroy: function () { if (timer) { clearInterval(timer); timer = null; } jugando = false; offEt(); },
      pause: function () { if (jugando) pausar(); },
      resume: function () { /* queda en pausa: lo reanuda el alumno */ },
      getState: function () { return { t: t, escena: idx, jugando: jugando, vel: vel, vistas: Object.keys(vistas).length }; }
    };
  }

  Mot.register('animacion', { normalizar: normalizar, render: render });
})(root.C150);
