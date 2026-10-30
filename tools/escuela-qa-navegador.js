/* tools/escuela-qa-navegador.js — controles de la Escuela que sólo se pueden hacer en un navegador (con layout real). No es parte de la app: se pega en la consola
 * (o se inyecta con el panel de vista previa) con la página abierta, la pestaña ESCUELA a la vista y el ancho de ventana que se quiere probar.
 *
 *   await EscuelaQA.etiquetas()   recorre TODAS las lecciones (portada, puntos clave, práctica, quiz, resumen) y, en cada una, los estados de cada diapositiva, animación,
 *                                 diagrama (capas), plano (vistas y capas) y tarjetas; devuelve las etiquetas de los dibujos SVG que quedan recortadas por el borde de su <svg>
 *                                 (campo cl) y las que se pisan entre sí (campo ov). Aceptación: cl vacío con 360, 390, 768 y 1100 px de ancho; ov es informativo.
 *   await EscuelaQA.teclado()     activa con el teclado (Enter / clic de botón) cada control de cada componente de cada lección y verifica que document.activeElement NUNCA
 *                                 queda en <body> (campo fin) y cuenta los que lo perdieron antes de que actúe la red de seguridad de bloques.vigilarFoco (campo raw).
 *                                 Aceptación: fin vacío. Se omite enlace3d (abre el visor 3D y otras pestañas).
 *   Los dos aceptan ({ desde, hasta, espera }) para recorrer un tramo: los pasos van numerados en EscuelaQA.pasos. Mientras corren, mantené el panel visible
 *   (un navegador en segundo plano no entrega ResizeObserver ni cuadros de animación y las medidas salen viejas).
 * Los tests puros de estas funciones viven en tests/validate-escuela.js (sección F2). */
(function () {
  'use strict';
  var Q = window.EscuelaQA = window.EscuelaQA || {};
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function visible(t, svg) {
    var r = t.getBoundingClientRect(); if (!r.width || !r.height) return null;
    var cs = getComputedStyle(t); if (cs.visibility === 'hidden' || cs.display === 'none') return null;
    for (var a = t; a && a !== svg; a = a.parentNode) { var ca = getComputedStyle(a); if (ca.display === 'none' || ca.visibility === 'hidden' || ca.opacity === '0') return null; }
    return { r: r, fs: parseFloat(cs.fontSize) || 11 };
  }
  function recortadas() {
    var out = [];
    document.querySelectorAll('svg').forEach(function (svg) {
      var sr = svg.getBoundingClientRect(); if (!sr.width || !sr.height || getComputedStyle(svg).display === 'none') return;
      svg.querySelectorAll('text').forEach(function (t) {
        var v = visible(t, svg); if (!v) return;
        var r = v.r, l = sr.left - r.left, rr = r.right - sr.right, u = sr.top - r.top, d = r.bottom - sr.bottom, tol = v.fs * 0.28;       // el cuadro de línea es más alto que la tinta
        if (l > 0.75 || rr > 0.75 || u > tol || d > tol) out.push({ t: t.textContent.slice(0, 34), izq: Math.round(l), der: Math.round(rr), arriba: Math.round(u), abajo: Math.round(d), ancho: Math.round(sr.width) });
      });
    });
    return out;
  }
  function pisadas() {
    var out = [];
    document.querySelectorAll('svg').forEach(function (svg) {
      if (!svg.getBoundingClientRect().width || getComputedStyle(svg).display === 'none') return;
      var ts = [];
      svg.querySelectorAll('text').forEach(function (t) {
        var v = visible(t, svg); if (!v || /(^| )(dg-num|mp-num|an-n)( |$)/.test(t.getAttribute('class') || '')) return;
        var sh = v.r.height * 0.18; ts.push({ s: t.textContent.slice(0, 26), l: v.r.left, r: v.r.right, u: v.r.top + sh, d: v.r.bottom - sh });
      });
      for (var i = 0; i < ts.length; i++) for (var j = i + 1; j < ts.length; j++) {
        var a = ts[i], b = ts[j], ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.d, b.d) - Math.max(a.u, b.u);
        if (ox > 2 && oy > 2) out.push([a.s, b.s, Math.round(ox), Math.round(oy)]);
      }
    });
    return out;
  }
  Q.recortadas = recortadas; Q.pisadas = pisadas;
  Q.preparar = async function () {
    var ES = window.C150.ESCUELA, D = ES.datos, lista = D.lista().filter(function (e) { return D.disponible(e); });
    await Promise.all(['INT', 'AER'].map(function (m) { return D.cargar(m); }));
    Q.pasos = [];
    lista.forEach(function (e) {
      var pasos = ES.leccion.armar(D.leccionDatos(e.id) || e.lec);
      pasos.forEach(function (p, i) { Q.pasos.push([e.id, ES.leccion.claveDe(pasos, i)]); });
    });
    return Q.pasos.length;
  };
  function ir(id, c) { location.hash = '#escuela/' + id + (c ? '/' + c : ''); }
  async function estados(k, acc, esp) {
    function foto(tag) { var cl = recortadas(), ov = pisadas(); if (cl.length || ov.length) acc.push({ k: k + ' ' + tag, cl: cl, ov: ov }); }
    var i, dots = [].slice.call(document.querySelectorAll('.es-dia-dot'));
    for (i = 1; i < dots.length; i++) { dots[i].click(); await esperar(esp); foto('diapositiva ' + (i + 1)); }
    for (i = 0; i < 24; i++) { var nb = document.querySelector('button[aria-label="Paso siguiente"]'); if (!nb) break; nb.click(); await esperar(esp); foto('animación ' + (i + 1)); if (document.querySelector('.es-ani .es-pill:not([hidden])')) break; }
    var chips = [].slice.call(document.querySelectorAll('.es-dgr .es-chip--layer[aria-pressed="false"], .es-plano .es-chip--layer[aria-pressed="false"]'));
    if (chips.length) { chips.forEach(function (x) { x.click(); }); await esperar(esp); foto('todas las capas'); }
    var vs = [].slice.call(document.querySelectorAll('.es-plano-vistas button'));
    for (i = 0; i < vs.length; i++) { vs[i].click(); await esperar(esp); foto('vista ' + (i + 1)); }
    var em = document.querySelector('.es-tar-acc .btn');
    if (em && /Empezar|Repasar igual/.test(em.textContent)) { em.click(); await esperar(esp); }
    for (i = 0; i < 60; i++) {
      if (!document.querySelector('.es-tar-card')) break;
      var dv = document.querySelector('.es-tar-acc .btn'); if (dv && /Dar vuelta/.test(dv.textContent)) dv.click();
      await esperar(esp); foto('tarjeta ' + (i + 1) + ' dorso');
      var rt = document.querySelector('.es-tar-r--ok'); if (rt) rt.click();
      await esperar(esp); foto('tarjeta ' + (i + 1));
    }
  }
  Q.etiquetas = async function (o) {
    o = o || {}; var esp = o.espera || 260; if (!Q.pasos) await Q.preparar();
    var acc = [];
    for (var n = o.desde || 0; n < Math.min(o.hasta || Q.pasos.length, Q.pasos.length); n++) {
      ir(Q.pasos[n][0], Q.pasos[n][1]); await esperar(esp + 90);
      var k = Q.pasos[n].join('/'), cl = recortadas(), ov = pisadas(), ovw = document.documentElement.scrollWidth - innerWidth;
      if (cl.length || ov.length || ovw > 0) acc.push({ k: k, desborde: ovw > 0 ? ovw : undefined, cl: cl, ov: ov });
      await estados(k, acc, esp);
    }
    return acc;
  };
  function perdido() { var a = document.activeElement; return !a || a === document.body || a === document.documentElement || !document.body.contains(a); }
  function firma(e) { return e.nodeName + '|' + (e.getAttribute('aria-label') || '').slice(0, 30) + '|' + (e.textContent || '').trim().slice(0, 24) + '|' + (e.getAttribute('data-id') || e.getAttribute('data-gi') || e.getAttribute('data-q') || ''); }
  function visibleEl(e) { if (e.closest('[hidden]') || e.closest('[inert]')) return false; var r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; var cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none'; }
  Q.teclado = async function (o) {
    o = o || {}; var maxAcciones = o.acciones || 30; if (!Q.pasos) await Q.preparar();
    var acc = [], total = 0;
    for (var n = o.desde || 0; n < Math.min(o.hasta || Q.pasos.length, Q.pasos.length); n++) {
      var c = Q.pasos[n][1]; if (c === '' || c === 'resumen') continue;
      ir(Q.pasos[n][0], c); await esperar(o.espera || 350);
      var hosts = document.querySelectorAll('.es-comp').length;
      for (var hi = 0; hi < hosts; hi++) {
        var vistos = {}, pasoN = 0;
        while (pasoN++ < maxAcciones) {
          var host = document.querySelectorAll('.es-comp')[hi]; if (!host || host.getAttribute('data-tipo') === 'enlace3d') break;
          var cand = [].slice.call(host.querySelectorAll('button:not([disabled]), [role="button"], input[type="text"]:not([readonly]):not([disabled]), input[type="number"]:not([readonly]):not([disabled])'))
            .filter(function (e) { return visibleEl(e) && !/Abrir|Mirar|ficha completa|Volver a la lecci/.test(e.textContent || '') && !vistos[firma(e)]; })[0];
          if (!cand) break;
          var f = firma(cand); vistos[f] = 1; total++;
          try { cand.focus({ preventScroll: true }); } catch (e) { /* idem */ }
          if (cand.nodeName === 'INPUT') { cand.value = '3'; cand.dispatchEvent(new Event('input', { bubbles: true })); cand.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
          else if (cand.nodeName === 'BUTTON') cand.click();
          else cand.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          await esperar(40); var raw = perdido();
          await esperar(130); var fin = perdido();
          if (raw || fin) acc.push({ k: Q.pasos[n].join('/'), tipo: host.getAttribute('data-tipo'), el: f, raw: raw, fin: fin });
        }
      }
    }
    return { acciones: total, fallas: acc };
  };
})();
