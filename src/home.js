var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * home.js — C150.Home: la pantalla de Inicio (contrato UI/UX v4 §4, ola U2). Es el "¿por dónde empiezo?" para alguien que no sabe nada de aviación.
 *
 *   Home.render(sectionEl, api)  lo llama ui.js cada vez que se entra a Inicio (api = helpers de ui.js: go, progress, kit, cc, sheetEnsure…).
 *                                Arma (lenguaje de AIRE, contrato v5): cabecera "00 · Inicio · saludo" (Kit.pageHeader) · "Continuar" como runner · secciones Kit.section:
 *                                01 Tu camino (línea de tiempo vertical: cada etapa es una tarjeta .card-h con código E1…, anillo de avance y requisitos)
 *                                · 02 Probá ahora (carrusel de tarjetas A1…) · 03 Tu avance (anillo y datos en mono) · 04 Para tener a mano · 05 Novedades · aviso.
 *                                Al volver a entrar arma todo de nuevo (el avance es lo que cambia); qué secciones estaban plegadas se recuerda.
 *   Home.exit()                  se sale de Inicio: apaga la órbita lenta de la cámara.
 *   Home.refresh()               rearma si Inicio se está viendo (se llama solo cuando cambia el progreso).
 *   Home.highlight()             hace latir "Tu camino" un momento y lo trae a la vista (lo usa el onboarding).
 *
 * Decisiones:
 *  - La cámara 3D de fondo hace una órbita cinematográfica lenta (Core.setIdleOrbit) sólo mientras se ve Inicio, sin movimiento reducido,
 *    y se apaga sola apenas el alumno toca la vista 3D (core.js).
 *  - "Tu camino" nunca bloquea: las etapas siguientes se ven más tenues ("Más adelante") pero cada una tiene su botón.
 *  - "Continuar" sale de Progress.last() (una lección, checklist, situación… empezada y sin terminar); si no hay nada a medias, propone la
 *    próxima etapa; en la primera visita propone el recorrido guiado.
 *  - Todo el DOM se arma con Kit (sin innerHTML con datos).
 */
(function (C150) {
  'use strict';
  if (typeof document === 'undefined') return;

  var Home = C150.Home = C150.Home || {};
  var doc = document;
  var S = { view: null, api: null, entered: false, off: null, timer: 0 };

  function isFn(f) { return typeof f === 'function'; }
  function K() { return C150.Kit; }
  function UI() { return C150.UI || {}; }
  function safe(fn) { try { return fn(); } catch (e) { if (root.console) console.error('[Home]', e); return undefined; } }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  /** Home cards that jump into another section are ABRIR: the destination shows "← Volver a Inicio". */
  function go(path) { var u = UI(); if (isFn(u.open)) u.open(path, { returnLabel: 'Inicio' }); else if (isFn(u.go)) u.go(path); if (isFn(u.sheet)) u.sheet('half'); }
  function call(name) { var u = UI(); if (isFn(u[name])) return u[name].apply(u, Array.prototype.slice.call(arguments, 1)); return undefined; }

  function greeting() {
    var hr = new Date().getHours();
    return hr < 6 ? 'Buenas noches' : hr < 13 ? 'Buen día' : hr < 20 ? 'Buenas tardes' : 'Buenas noches';
  }
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'hace un momento';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) { var hh = Math.round(s / 3600); return 'hace ' + hh + (hh === 1 ? ' hora' : ' horas'); }
    var d = Math.round(s / 86400);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }

  /** Abre lo último que estaba haciendo (la lección, la checklist…); si no se puede, la sección. */
  function resume(last) {
    var id = last.id, k = last.kind;
    if (k === 'leccion') { if (call('openLesson', id) !== false) return; }
    else if (k === 'checklist') { call('openChecklist', id); return; }
    else if (k === 'situacion') { call('openSituation', id); return; }
    else if (k === 'cabina') { call('showControl', id); return; }
    else if (k === 'aire') { call('openLab', id); return; }
    go(last.ruta || '#inicio');
  }

  /* ------------------------------------------------------------------ piezas (v5 · V3: el lenguaje de AIRE) */
  var OPEN = {};
  /** A numbered AIRE section (Kit.section) that remembers whether the student folded it. */
  function section(num, title, meta, body, key, open) {
    return K().section({ num: num, title: title, meta: meta || '', body: body, key: key,
      open: OPEN[key] !== undefined ? OPEN[key] : open !== false, onToggle: function (o) { OPEN[key] = o; } });
  }

  function hero(sum, last, first) {
    var el = K().pageHeader({
      kicker: '00 · Inicio · ' + greeting(),
      title: first ? 'Conocé tu avión' : 'Bienvenido de vuelta',
      sub: first
        ? 'Esta es la cabina de un Cessna 150 en 3D. Acá aprendés qué es cada mando, cómo hace un avión para volar y practicás sin ningún riesgo. No hace falta saber nada de aviación: empezamos de cero.'
        : 'Seguís por el ' + sum.porcentaje + ' % de tu camino. Podés retomar donde dejaste o elegir cualquier parte: nada está bloqueado.' });
    el.classList.add('hm-hero');
    return el;
  }

  /** "Continuar": the next thing to do, as the AIRE runner (orange outline, kicker, big title, progress line, one primary button). */
  function nextCard(sum, last, first) {
    var Kit = K(), h = Kit.el;
    var kicker, count = '', frac = null, title, text, label, action;
    if (last && !last.hecho) {
      kicker = 'Continuar'; count = ago(last.t); title = last.titulo; text = 'Seguí donde lo dejaste.'; label = 'Seguir';
      action = function () { resume(last); };
    } else if (first) {
      kicker = 'Empezá por acá'; count = '5 min'; title = 'Recorrido guiado de la cabina';
      text = 'Te llevo por los controles más importantes, uno por uno, y te cuento para qué sirve cada uno.'; label = 'Empezar el recorrido';
      action = function () { go('lecciones/recorrido'); };
    } else if (sum.siguiente) {
      var st = sum.siguiente, pend = null;
      for (var i = 0; i < st.requisitos.length; i++) if (!st.requisitos[i].hecho) { pend = st.requisitos[i]; break; }
      kicker = 'Tu próximo paso'; count = 'Etapa ' + st.n; frac = st.fraccion; title = st.titulo; text = pend ? pend.texto + '.' : st.descripcion; label = st.fraccion > 0 ? 'Continuar' : 'Empezar';
      action = function () { go(st.ruta); };
    } else {
      kicker = 'Camino completo'; title = '¡Terminaste todas las etapas!'; text = 'Repasá cuando quieras: un quiz, una situación o un experimento del aire.'; label = 'Hacer un quiz';
      action = function () { call('startQuiz'); };
    }
    return h('article', { 'class': 'runner hm-next', 'aria-label': 'Siguiente paso' },
      h('p', { 'class': 'runner-kicker' }, h('span', { text: kicker }), count ? h('span', { 'class': 'runner-count', text: count }) : null),
      frac !== null ? h('div', { 'class': 'runner-prog', 'aria-hidden': 'true' }, h('span', { style: { width: (Math.max(0, Math.min(1, frac)) * 100).toFixed(0) + '%' } })) : null,
      h('h3', { 'class': 'runner-title hm-next-t', text: title }),
      h('p', { 'class': 'runner-text hm-next-d', text: text }),
      Kit.button({ label: label, iconRight: 'arrow-right', variant: 'primary', size: 'large', onClick: action }));
  }

  function reqList(st) {
    var Kit = K(), h = Kit.el;
    var ul = h('ul', { 'class': 'hm-reqs', 'aria-label': 'Qué incluye la etapa ' + st.n });
    st.requisitos.forEach(function (r) {
      ul.appendChild(h('li', { 'class': 'hm-req' + (r.hecho ? ' is-done' : '') },
        h('span', { 'class': 'hm-req-ico', 'aria-hidden': 'true' }, r.hecho ? Kit.icon('check') : null),
        h('span', { 'class': 'hm-req-t' }, r.texto, r.hecho ? h('span', { 'class': 'sr-only', text: ' (hecho)' }) : null),
        h('span', { 'class': 'hm-req-n data', text: r.actual + '/' + r.total }),
        r.hecho ? null : h('button', { type: 'button', 'class': 'hm-req-go', 'aria-label': 'Ir a: ' + r.texto, onclick: function () { go(r.ruta); } }, Kit.icon('arrow-right'))));
    });
    return ul;
  }

  /** "Tu camino": a vertical timeline. Each stage is an AIRE card (code E1…, title, two lines, mono meta, progress line) hung from a ring with its number. */
  function path(sum) {
    var Kit = K(), h = Kit.el, next = sum.siguiente;
    var ol = h('ol', { 'class': 'hm-stages', 'aria-label': 'Etapas de tu camino' });
    var seenNext = false;
    sum.camino.forEach(function (st) {
      var isNext = !!(next && next.id === st.id);
      if (isNext) seenNext = true;
      var later = seenNext && !isNext && !st.completa && st.fraccion === 0;
      var started = st.fraccion > 0;
      var ring = Kit.progressRing(st.fraccion, { size: 46, stroke: 11, text: String(st.n), ok: st.completa, ariaLabel: 'Avance de la etapa ' + st.n });
      var tag = st.completa ? 'Completa' : (isNext ? 'Ahora' : (later ? 'Más adelante' : null));
      var cta = Kit.button({
        label: st.completa ? 'Repasar' : (started ? 'Continuar' : 'Empezar'), size: 'small', variant: isNext ? 'primary' : 'secondary', iconRight: 'arrow-right',
        ariaLabel: (st.completa ? 'Repasar: ' : (started ? 'Continuar: ' : 'Empezar: ')) + st.titulo, onClick: function () { go(st.ruta); }
      });
      var card = h('div', { 'class': 'card-h hm-card' + (isNext ? ' is-current' : '') + (st.completa ? ' is-done' : '') },
        h('span', { 'class': 'card-h-top' }, h('span', { 'class': 'card-h-code', text: 'E' + st.n }), tag ? h('span', { 'class': 'card-h-tag' + (st.completa ? ' is-ok' : ''), text: tag }) : null),
        h('h3', { 'class': 'card-h-title hm-stage-t' }, st.titulo, st.completa ? h('span', { 'class': 'sr-only', text: ' (completa)' }) : null),
        h('p', { 'class': 'card-h-sum hm-stage-d', text: st.descripcion }),
        h('p', { 'class': 'card-h-meta hm-count', text: st.hecho + ' de ' + st.total + ' hechos' }),
        Kit.progressBar(st.fraccion, { ok: st.completa, label: st.titulo }),
        isNext ? reqList(st) : Kit.accordion({ title: 'Qué incluye', content: reqList(st) }),
        h('div', { 'class': 'hm-stage-a' }, cta));
      ol.appendChild(h('li', { 'class': 'hm-stage' + (st.completa ? ' is-done' : '') + (isNext ? ' is-next' : '') + (later ? ' is-later' : ''), 'aria-current': isNext ? 'step' : null },
        h('span', { 'class': 'hm-stage-n' }, ring), card));
    });
    var body = h('div', null,
      h('p', { 'class': 'hm-intro', text: 'Cinco etapas para pasar de “no sé nada” a conocer tu cabina, entender cómo vuela un avión y practicar. Seguilas en orden o saltá a lo que ya sabés.' }), ol);
    var sec = section(1, 'Tu camino', sum.camino.length + ' etapas', body, 'hm-camino', true);
    sec.id = 'hm-path';
    sec.classList.add('hm-sec', 'hm-path-sec');
    return sec;
  }

  function quick() {
    var Kit = K();
    var D = C150.DATA || {};
    function has(list, id) { return (D[list] || []).some(function (x) { return x && x.id === id; }); }
    var items = [
      { code: 'A1', title: 'Arrancá el motor', sum: 'Una misión guiada, paso por paso', meta: 'Misión · 3 min',
        onClick: function () { if (!(has('missions', 'arrancar') && call('openMission', 'arrancar'))) go('practicar/volar'); } },
      { code: 'A2', title: 'Mirá cómo vuela', sum: 'Las cuatro fuerzas en el laboratorio del aire', meta: 'Aire · experimento',
        onClick: function () { call('openLab', has('labExperiments', 'fuerzas') ? 'fuerzas' : undefined); call('sheet', 'half'); } },
      { code: 'A3', title: 'Resolvé una situación', sum: 'Por ejemplo, hielo en el carburador', meta: 'Situación · 5 min',
        onClick: function () { if (has('situations', 'hielo-carburador')) call('openSituation', 'hielo-carburador'); else go('practicar/volar'); } },
      { code: 'A4', title: 'Quiz rápido', sum: 'Preguntas para probar lo que sabés', meta: 'Quiz · 12 preguntas', onClick: function () { call('startQuiz'); } }
    ];
    return section(2, 'Probá ahora', 'sin riesgo', Kit.cardCarousel({ items: items, label: 'Cosas para probar ahora' }), 'hm-quick', true);
  }

  function req(sum, stageId, i) {
    for (var k = 0; k < sum.camino.length; k++) if (sum.camino[k].id === stageId) return sum.camino[k].requisitos[i] || null;
    return null;
  }
  function stats(sum) {
    var Kit = K(), h = Kit.el;
    var ring = Kit.progressRing(sum.porcentaje / 100, { size: 92, label: 'Avance total', text: sum.porcentaje + '%', ok: sum.porcentaje >= 100 });
    var tiles = h('div', { 'class': 'hm-stats' });
    [['Mandos vistos', req(sum, 'cabina', 0)], ['Lecciones', req(sum, 'vuelo', 0)], ['Checklists', req(sum, 'procedimientos', 0)], ['Misiones', req(sum, 'practica', 0)]].forEach(function (p) {
      if (p[1]) tiles.appendChild(Kit.stat({ label: p[0], value: p[1].actual + '/' + p[1].total, small: true }));
    });
    var quizSt = null;
    for (var i = 0; i < sum.camino.length; i++) if (sum.camino[i].id === 'quiz') quizSt = sum.camino[i];
    var best = quizSt && quizSt.mejor && quizSt.mejor.total ? quizSt.mejor : null;
    tiles.appendChild(Kit.stat({ label: 'Mejor quiz', value: best ? best.score + '/' + best.total : '—', small: true }));
    return section(3, 'Tu avance', sum.completas + ' de ' + sum.camino.length + ' etapas', h('div', { 'class': 'hm-avance' }, ring, tiles), 'hm-stats', true);
  }

  function tips() {
    var Kit = K(), h = Kit.el;
    var items = [
      ['bulb', 'Tocá las palabras subrayadas, como flaps, para ver qué significan.'],
      ['hand', 'Arrastrá la vista 3D para mirar alrededor. Con la rueda del mouse o dos dedos hacés zoom.'],
      ['search', 'Apretá Ctrl K (o la tecla /) para buscar un mando, un término o una lección.'],
      ['layers', 'En el celular, deslizá el panel hacia arriba para leer más o hacia abajo para ver más cabina.'],
      ['check', 'No pasa nada si te equivocás: es un simulador. Probá todo lo que quieras.']
    ];
    var ul = h('ul', { 'class': 'hm-tips' });
    items.forEach(function (t) { ul.appendChild(h('li', null, h('span', { 'class': 'hm-tip-ico', 'aria-hidden': 'true' }, Kit.icon(t[0])), h('span', { text: t[1] }))); });
    return section(4, 'Para tener a mano', items.length + ' consejos', ul, 'hm-tips', false);
  }

  function news() {
    var Kit = K(), h = Kit.el;
    var ul = h('ul', { 'class': 'hm-news' });
    [['Nuevo', 'Todas las pestañas con el mismo estilo del laboratorio del aire.'], ['Nuevo', 'Volver atrás funciona en todos lados: te lleva a donde estabas.'],
      ['Nuevo', 'Inicio y Tu camino: ves qué hiciste y qué sigue.'], ['Mejora', 'Menú más claro: Cabina, Lecciones, Practicar y Aire.']].forEach(function (n) {
      ul.appendChild(h('li', null, Kit.badge(n[0], n[0] === 'Nuevo' ? 'accent' : 'info'), h('span', { text: n[1] })));
    });
    return section(5, 'Novedades', 'lo último', ul, 'hm-news', false);
  }

  function footer(P) {
    var Kit = K(), h = Kit.el;
    var meta = (C150.DATA && C150.DATA.meta) || {};
    var row = h('div', { 'class': 'hm-foot-actions' },
      Kit.button({ label: 'Ver el tutorial', icon: 'play', variant: 'ghost', size: 'small', onClick: function () { var o = C150.Onboarding; if (o && isFn(o.start)) o.start({ force: true }); } }),
      Kit.button({ label: 'Borrar mi avance', icon: 'reset', variant: 'ghost', size: 'small', onClick: function () { confirmReset(P); } }));
    return h('footer', { 'class': 'hm-foot' }, row, h('p', { 'class': 'aviso', text: meta.aviso || 'Basado en un Cessna 150M 1976. El avión de tu escuela puede tener diferencias: siempre manda el manual (POH) y el instructor.' }));
  }
  function confirmReset(P) {
    var Kit = K();
    Kit.dialog({
      kicker: 'Tu avance', title: '¿Borrar tu avance?', body: 'Se borra lo que hiciste hasta ahora (lecciones, checklists, quiz y demás). No se puede deshacer. Tu tema y tus preferencias se quedan.',
      actions: [{ label: 'Cancelar', variant: 'ghost' }, { label: 'Borrar todo', variant: 'primary', onClick: function () { if (P && isFn(P.reset)) P.reset(); Kit.toast('Listo: empezás de cero.', 'info'); } }]
    });
  }

  /* ------------------------------------------------------------------ armado */
  function build() {
    var v = S.view, api = S.api;
    if (!v) return;
    var Kit = K(), P = (api && api.progress) || C150.Progress;
    clear(v);
    v.className = 'home';
    if (!Kit || !P) {
      v.appendChild(Kit ? Kit.emptyState({ icon: 'info', title: 'Tu avance no está disponible', text: 'Recargá la página para volver a intentarlo.' }) : doc.createTextNode('Tu avance no está disponible.'));
      return;
    }
    var sum = P.summary(), last = P.last();
    var first = !last && sum.porcentaje === 0 && !sum.completas;
    v.appendChild(hero(sum, last, first));
    v.appendChild(nextCard(sum, last, first));
    v.appendChild(path(sum));
    v.appendChild(quick());
    v.appendChild(stats(sum));
    v.appendChild(tips());
    v.appendChild(news());
    v.appendChild(footer(P));
    var Gl = C150.Glossary;
    if (Gl && isFn(Gl.annotate)) safe(function () { Gl.annotate(v.querySelector('.hm-tips')); });
  }

  function visible() {
    var v = S.view;
    if (!v || !doc.contains(v)) return false;
    var sec = v.closest ? v.closest('.mode') : null;
    return !(sec && sec.hidden);
  }
  function orbit(on) {
    var api = S.api;
    if (!api || !isFn(api.cc)) return;
    safe(function () {
      if (on && Kit_reduced()) return;
      api.cc('setIdleOrbit', !!on);
    });
  }
  function Kit_reduced() { var k = K(); return !!(k && isFn(k.reducedMotion) && k.reducedMotion()); }

  Home.render = function (view, api) {
    S.view = view; S.api = api || S.api || {};
    build();
    if (!S.off) {
      var P = S.api.progress || C150.Progress;
      if (P && isFn(P.onChange)) S.off = P.onChange(function () { Home.refresh(); });
    }
    if (!S.entered) { S.entered = true; orbit(true); }
  };
  Home.exit = function () {
    if (!S.entered) return;
    S.entered = false;
    orbit(false);
  };
  Home.refresh = function () {
    if (!visible()) return;
    clearTimeout(S.timer);
    S.timer = setTimeout(function () { if (visible()) build(); }, 120);
  };
  Home.highlight = function () {
    var el = doc.getElementById('hm-path');
    if (!el) return false;
    if (isFn(el.setOpen)) el.setOpen(true);
    el.classList.remove('is-pulse');
    void el.offsetWidth;
    el.classList.add('is-pulse');
    try { el.scrollIntoView({ block: 'start', behavior: Kit_reduced() ? 'auto' : 'smooth' }); } catch (e) { /* sin scroll */ }
    setTimeout(function () { el.classList.remove('is-pulse'); }, 4200);
    return true;
  };
})(root.C150);
