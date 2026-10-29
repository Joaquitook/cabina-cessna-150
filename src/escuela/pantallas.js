var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/pantallas.js — C150.ESCUELA.pantallas: las pantallas de la Escuela fuera de la lección (contrato v7 §3/§4):
 * el mapa de la escuela, el módulo, la lección que todavía no está ("Próximamente"), las rutas reservadas (repaso, examen, glosario,
 * dudas: una tarjeta tranquila "llega pronto"), el cargando y el error con reintento. Todo con el Kit y clases es-* (styles.css, bloque ESCUELA).
 *
 * Cada función recibe `E`, el controlador que arma escuela.js: { K, h, icon, datos, store, irModulo(id), irLeccion(id, clave?), irMapa(),
 * continuar(), secOpen:{}, exportar(), importar(archivo), reintentar() } y devuelve un elemento.
 *   P.mapa(E) · P.modulo(E, idMod) · P.proximamente(E, entradaLeccion) · P.reservada(E, nombre) · P.cargando(E, texto) · P.error(E, texto, reintentar)
 *   P.estadoLec(store, id) → {estado:'nueva'|'en-curso'|'hecha', estrellas}       P.fmtMin(n) → '45 min' · '1 h 05 min'
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var P = ES.pantallas = ES.pantallas || {};

  function arr(x) { return Array.isArray(x) ? x : []; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  P.fmtMin = function (n) { n = Math.max(0, Math.round(n || 0)); return n < 60 ? n + ' min' : Math.floor(n / 60) + ' h ' + p2(n % 60) + ' min'; };
  P.estadoLec = function (store, id) {
    var r = store.lec(id);
    if (!r) return { estado: 'nueva', estrellas: 0, paso: 0 };
    if (r.estado === 'hecha') return { estado: 'hecha', estrellas: r.estrellas || 1, paso: r.paso };
    return { estado: r.paso > 0 ? 'en-curso' : 'nueva', estrellas: 0, paso: r.paso };
  };
  var NOMBRE_RESERVADA = {
    repaso: ['Repaso del día', 'Tarjetas que se dan vuelta, preguntas que fallaste y ejercicios para repasar un poquito cada día.'],
    examen: ['Simulador de examen', 'Un examen tipo DINACIA con temporizador, para medirte antes del día D.'],
    glosario: ['Glosario de la Escuela', 'Todas las palabras de las lecciones juntas, con su definición y la lección donde aparecen.'],
    dudas: ['Dudas para el instructor', 'Las cosas del curso que conviene confirmar con tu instructor.']
  };

  /** Resumen de un módulo para sus tarjetas: lecciones disponibles, hechas, minutos que faltan. */
  function resumenMod(E, m) {
    var t = E.datos.totalesModulo(m.id), hechas = 0, falta = 0;
    arr(m.unidades).forEach(function (u) { arr(u.lecciones).forEach(function (l) {
      if (l.detalle !== 'completo') return;
      if (P.estadoLec(E.store, l.id).estado === 'hecha') hechas++; else falta += l.minutos || 0;
    }); });
    return { total: t.lecciones, disponibles: t.disponibles, hechas: hechas, minutos: t.minutos, falta: falta,
      frac: t.disponibles ? hechas / t.disponibles : 0, enPrep: t.lecciones > 0 && t.disponibles / t.lecciones < 0.5 };
  }
  P.resumenMod = resumenMod;

  function anillo(E, r, size) {
    var K = E.K, el = K.progressRing(r.frac, { size: size || 46, stroke: 10, ok: r.disponibles > 0 && r.hechas === r.disponibles, ariaLabel: 'Avance del módulo', text: r.disponibles ? Math.round(r.frac * 100) + '' : '–' });
    el.classList.add('es-ring');
    return el;
  }
  function icono(E, m, grande) {
    var nombre = E.K.icon ? m.icono : 'cap';
    return E.h('span', { 'class': 'es-ico' + (grande ? ' es-ico--lg' : ''), 'aria-hidden': 'true' }, E.icon(nombre, grande ? 26 : 22));
  }

  /* ------------------------------------------------------------------ mapa */
  function tarjetaModulo(E, m) {
    var r = resumenMod(E, m), h = E.h;
    var lecs = r.disponibles ? r.hechas + ' de ' + r.disponibles + (r.disponibles === 1 ? ' lección' : ' lecciones') : 'Sin lecciones todavía';
    return h('button', { type: 'button', 'class': 'es-mod', style: { '--es-hue': m.color }, 'data-mod': m.id, onclick: function () { E.irModulo(m.id); },
      'aria-label': m.titulo + '. ' + lecs + (r.enPrep ? '. Contenido en preparación.' : '.') },
      h('span', { 'class': 'es-mod-top' }, icono(E, m), h('span', { 'class': 'es-mod-code', text: m.id }), anillo(E, r)),
      h('span', { 'class': 'es-mod-title', text: m.titulo }),
      m.paginas ? h('span', { 'class': 'es-mod-pp', text: 'pp. ' + m.paginas + ' del curso' }) : null,
      h('span', { 'class': 'es-mod-sum', text: m.resumen || '' }),
      h('span', { 'class': 'es-mod-meta' }, h('span', { text: lecs }), r.disponibles ? h('span', { text: P.fmtMin(r.falta) + (r.falta ? ' para terminar' : '') }) : null),
      r.enPrep ? h('span', { 'class': 'es-tag', text: 'Contenido en preparación' }) : null);
  }
  function estacion(E, m, i, nextId) {
    var h = E.h, r = resumenMod(E, m);
    var lecs = r.disponibles ? r.hechas + ' de ' + r.disponibles + ' lecciones' : (r.total + ' lecciones en preparación');
    return h('li', { 'class': 'es-st' + (r.disponibles && r.hechas === r.disponibles ? ' is-done' : '') + (m.id === nextId ? ' is-next' : ''), style: { '--es-hue': m.color } },
      h('button', { type: 'button', 'class': 'es-st-btn', 'data-mod': m.id, onclick: function () { E.irModulo(m.id); }, 'aria-label': 'Estación ' + (i + 1) + ': ' + m.titulo + '. ' + lecs },
        h('span', { 'class': 'es-st-node', 'aria-hidden': 'true' }, icono(E, m)),
        h('span', { 'class': 'es-st-body' },
          h('span', { 'class': 'es-st-k', text: 'Estación ' + (i + 1) + ' · ' + m.id + (m.paginas ? ' · pp. ' + m.paginas : '') }),
          h('span', { 'class': 'es-st-t', text: m.titulo }),
          h('span', { 'class': 'es-st-m', text: lecs + (r.enPrep ? ' · en preparación' : '') })),
        anillo(E, r, 40)));
  }

  P.mapa = function (E) {
    var K = E.K, h = E.h, st = E.store, mods = E.datos.modulos();
    var el = h('div', { 'class': 'es-map' });
    el.appendChild(K.pageHeader({ kicker: '05 · Escuela · Mapa', title: 'Teoría para el examen',
      sub: 'Los módulos del Curso Piloto Privado de AeroSur, en su orden, y los demás que completan tu preparación. Cada lección es corta, se hace y se practica: no se lee de corrido.' }));

    // Continuar + racha
    var u = st.ultima(), eu = u ? E.datos.leccion(u.leccion) : null, hero;
    var sig = null, vistas = E.datos.lista();
    for (var i = 0; i < vistas.length; i++) if (E.datos.disponible(vistas[i]) && P.estadoLec(st, vistas[i].id).estado !== 'hecha') { sig = vistas[i]; break; }
    if (eu && E.datos.disponible(eu) && P.estadoLec(st, eu.id).estado !== 'hecha') {
      var lab = (u.paso > 0 ? 'Seguí en el paso ' + u.paso : 'Seguí con esta lección');
      hero = { k: 'Continuar donde dejaste', t: eu.lec.titulo, m: eu.mod.id + ' · ' + eu.id, b: lab, fn: function () { E.irLeccion(eu.id, null, u.paso); }, e: eu };
    } else if (sig) {
      hero = { k: st.estado && Object.keys(st.estado().lecciones).length ? 'Seguí con' : 'Empezá por acá', t: sig.lec.titulo, m: sig.mod.id + ' · ' + sig.id, b: 'Empezar', fn: function () { E.irLeccion(sig.id); }, e: sig };
    }
    if (hero) {
      el.appendChild(h('section', { 'class': 'es-hero', style: { '--es-hue': hero.e.mod.color }, 'aria-label': 'Continuar' },
        h('p', { 'class': 'es-hero-k', text: hero.k }),
        h('p', { 'class': 'es-hero-t', text: hero.t }),
        h('p', { 'class': 'es-hero-m', text: hero.m + ' · ' + P.fmtMin(hero.e.lec.minutos) }),
        K.button({ label: hero.b, variant: 'primary', iconRight: 'arrow-right', onClick: hero.fn })));
    }
    var racha = st.racha(), ins = Object.keys(st.insignias()).length;
    el.appendChild(h('p', { 'class': 'es-streak', 'aria-label': 'Tu constancia' },
      h('span', { text: 'Racha ' + racha + (racha === 1 ? ' día' : ' días') }), h('span', { text: st.minutosSemana() + ' min esta semana' }), h('span', { text: ins + (ins === 1 ? ' insignia' : ' insignias') })));

    // vista: tarjetas / camino
    var vista = st.pref('mapa') === 'camino' ? 'camino' : 'tarjetas';
    var cont = h('div', { 'class': 'es-map-body' });
    var switcher = K.modes({ label: 'Cómo ver los módulos', value: vista, items: [{ value: 'tarjetas', label: 'Módulos', sub: 'por tema' }, { value: 'camino', label: 'Camino', sub: 'en orden del curso' }],
      onChange: function (v) { st.pref('mapa', v); pintar(v); } });
    el.appendChild(switcher);
    el.appendChild(cont);
    function grupo(lista, num, titulo) {
      var grid = h('div', { 'class': 'es-mods' });
      lista.forEach(function (m) { grid.appendChild(tarjetaModulo(E, m)); });
      return K.section({ num: num, title: titulo, meta: lista.length + ' módulos', open: true, body: grid, key: 'es-g' + num });
    }
    function pintar(v) {
      while (cont.firstChild) cont.removeChild(cont.firstChild);
      var curso = mods.filter(function (m) { return m.fuente === 'aerosur'; }), mas = mods.filter(function (m) { return m.fuente !== 'aerosur'; });
      if (v === 'camino') {
        var ol = h('ol', { 'class': 'es-path', 'aria-label': 'Camino de la escuela, en el orden del curso' }), next = sig ? sig.mod.id : '';
        mods.forEach(function (m, k) { ol.appendChild(estacion(E, m, k, next)); });
        cont.appendChild(ol);
      } else {
        if (curso.length) cont.appendChild(grupo(curso, '01', 'El curso de AeroSur'));
        if (mas.length) cont.appendChild(grupo(mas, '02', 'Más módulos de la escuela'));
      }
    }
    pintar(vista);

    // reservadas + guardar progreso
    var res = h('ul', { 'class': 'es-soon-list' });
    ['repaso', 'examen', 'glosario'].forEach(function (k) {
      res.appendChild(h('li', null, h('button', { type: 'button', 'class': 'es-soon-btn', onclick: function () { E.irReservada(k); } },
        h('span', { 'class': 'es-soon-t', text: NOMBRE_RESERVADA[k][0] }), h('span', { 'class': 'es-tag', text: 'Llega pronto' }))));
    });
    el.appendChild(res);
    var file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': 'Elegir un archivo de progreso' });
    file.addEventListener('change', function () { if (file.files && file.files[0]) E.importar(file.files[0]); file.value = ''; });
    el.appendChild(h('div', { 'class': 'es-save' },
      h('p', { 'class': 'es-meta', text: 'Tu progreso se guarda en este dispositivo, sin cuentas. Si cambiás de teléfono, exportalo y cargalo en el nuevo.' }),
      h('div', { 'class': 'btn-row' },
        K.button({ label: 'Exportar mi progreso', size: 'small', variant: 'secondary', icon: 'external', onClick: function () { E.exportar(); } }),
        K.button({ label: 'Importar', size: 'small', variant: 'ghost', icon: 'plus', onClick: function () { file.click(); } }), file)));
    el.appendChild(h('p', { 'class': 'aviso', text: 'Material de estudio adaptado del curso para practicar: no reemplaza al curso, al manual del avión ni a tu instructor. Los datos del Cessna 150 salen del manual (POH) del modelo 1977; en el avión de tu escuela manda su propio manual.' }));
    return el;
  };

  /* ------------------------------------------------------------------ módulo */
  function filaLeccion(E, l, m) {
    var h = E.h, disp = l.detalle === 'completo', es = P.estadoLec(E.store, l.id);
    var estadoTxt = es.estado === 'hecha' ? 'hecha' : es.estado === 'en-curso' ? 'en curso' : (disp ? 'sin ver' : 'próximamente');
    var dot = h('span', { 'class': 'es-dot is-' + (disp ? es.estado : 'soon'), 'aria-hidden': 'true' }, es.estado === 'hecha' ? E.icon('check') : null);
    var comps = arr(l.componentes), cods = h('span', { 'class': 'es-codes', 'aria-hidden': 'true' });
    var seen = {};
    comps.forEach(function (t) { var c = ES.componentes.codigo(t); if (!seen[c] && Object.keys(seen).length < 4) { seen[c] = 1; cods.appendChild(h('span', { 'class': 'es-code', text: c })); } });
    var stars = es.estado === 'hecha' ? h('span', { 'class': 'es-rowstars', 'aria-hidden': 'true' }, [1, 2, 3].map(function (k) { return h('span', { 'class': 'es-star' + (k <= es.estrellas ? ' is-on' : '') }, E.icon('star')); })) : null;
    var kids = [dot,
      h('span', { 'class': 'es-les-body' },
        h('span', { 'class': 'es-les-t' }, h('span', { 'class': 'es-les-id', text: l.id.slice(4) }), ' ' + l.titulo, stars),
        h('span', { 'class': 'es-les-m' }, (l.paginas ? 'pp. ' + l.paginas + ' · ' : '') + (l.minutos || 0) + ' min', cods)),
      disp ? E.icon('chevron-right') : h('span', { 'class': 'es-tag', text: 'Próximamente' })];
    var aria = l.id + ' ' + l.titulo + '. ' + estadoTxt + '. ' + (l.minutos || 0) + ' minutos.';
    if (!disp) return h('button', { type: 'button', 'class': 'es-les is-soon', 'aria-label': aria, onclick: function () { E.irLeccion(l.id); } }, kids);
    return h('button', { type: 'button', 'class': 'es-les', 'aria-label': aria, onclick: function () { E.irLeccion(l.id); } }, kids);
  }
  P.modulo = function (E, id) {
    var K = E.K, h = E.h, m = E.datos.modulo(id);
    if (!m) return P.reservada(E, 'modulo-desconocido', 'No encontramos ese módulo');
    var r = resumenMod(E, m), el = h('div', { 'class': 'es-mod-screen', style: { '--es-hue': m.color } });
    el.appendChild(K.pageHeader({ kicker: '05 · Escuela · ' + m.id, title: m.titulo, sub: m.resumen }));
    var enCurso = null, sig = null;
    E.datos.lista().forEach(function (e) {
      if (e.mod.id !== m.id || !E.datos.disponible(e)) return;
      var es = P.estadoLec(E.store, e.id);
      if (!enCurso && es.estado === 'en-curso') enCurso = e;
      if (!sig && es.estado !== 'hecha') sig = e;
    });
    var objetivo = enCurso || sig;
    el.appendChild(h('div', { 'class': 'es-mod-head' }, anillo(E, r, 64),
      h('div', { 'class': 'es-mod-stats' },
        h('p', { 'class': 'es-mod-big', text: r.disponibles ? r.hechas + ' de ' + r.disponibles + (r.disponibles === 1 ? ' lección' : ' lecciones') : 'Todavía sin lecciones' }),
        h('p', { 'class': 'es-meta', text: ((m.paginas ? 'pp. ' + m.paginas + ' del curso · ' : '') + (r.disponibles ? 'faltan ' + P.fmtMin(r.falta) : P.fmtMin(r.minutos) + ' planificados')).toUpperCase() }),
        r.enPrep ? h('p', { 'class': 'es-tag es-tag--inline', text: 'Contenido en preparación' }) : null)));
    var acc = h('div', { 'class': 'btn-row es-mod-actions' });
    if (objetivo) acc.appendChild(K.button({ label: enCurso ? 'Continuar' : (r.hechas ? 'Seguir' : 'Empezar'), variant: 'primary', iconRight: 'arrow-right', onClick: function () { E.irLeccion(objetivo.id, null, enCurso ? P.estadoLec(E.store, objetivo.id).paso : 0); } }));
    acc.appendChild(h('span', { 'class': 'es-soon-wrap' }, K.button({ label: 'Repaso', variant: 'secondary', size: 'small', disabled: true }), h('span', { 'class': 'es-tag', text: 'Llega pronto' })));
    acc.appendChild(h('span', { 'class': 'es-soon-wrap' }, K.button({ label: 'Examen del módulo', variant: 'secondary', size: 'small', disabled: true }), h('span', { 'class': 'es-tag', text: 'Llega pronto' })));
    el.appendChild(acc);
    arr(m.unidades).forEach(function (u, k) {
      var disp = arr(u.lecciones).filter(function (l) { return l.detalle === 'completo'; });
      var hechas = disp.filter(function (l) { return P.estadoLec(E.store, l.id).estado === 'hecha'; }).length;
      var ul = h('div', { 'class': 'es-lessons' });
      arr(u.lecciones).forEach(function (l) { ul.appendChild(filaLeccion(E, l, m)); });
      var abierta = E.secOpen[u.id] !== undefined ? E.secOpen[u.id] : (disp.length > 0 || k === 0);
      var meta = (u.paginas ? 'pp. ' + u.paginas + ' · ' : '') + (disp.length ? hechas + ' de ' + disp.length + ' hechas' : 'próximamente');
      el.appendChild(K.section({ num: p2(k + 1), title: u.titulo, meta: meta, open: abierta, body: ul, key: 'es-u-' + u.id, onToggle: function (o) { E.secOpen[u.id] = o; } }));
    });
    el.appendChild(h('p', { 'class': 'aviso', text: 'Las lecciones con «Próximamente» ya están planificadas y llegan en las próximas actualizaciones.' }));
    return el;
  };

  /* ------------------------------------------------------------------ lección que todavía no está */
  P.proximamente = function (E, e) {
    var K = E.K, h = E.h, l = e.lec;
    var cods = h('ul', { 'class': 'es-chips', 'aria-label': 'Actividades planificadas' });
    arr(l.componentes).forEach(function (t) { cods.appendChild(h('li', null, h('span', { 'class': 'es-code', text: ES.componentes.codigo(t) }), h('span', { text: ES.componentes.nombre(t) }))); });
    return h('div', { 'class': 'es-soon', style: { '--es-hue': e.mod.color } },
      K.pageHeader({ kicker: '05 · Escuela · ' + e.mod.id + ' · ' + e.id, title: l.titulo, sub: 'Esta lección ya está planificada, pero todavía no está lista para estudiar.' }),
      h('p', { 'class': 'es-meta', text: ((l.paginas ? 'pp. ' + l.paginas + ' del curso · ' : '') + (l.minutos || 0) + ' min').toUpperCase() }),
      arr(l.componentes).length ? h('p', { 'class': 'es-lead', text: 'Va a tener:' }) : null, arr(l.componentes).length ? cods : null,
      h('div', { 'class': 'btn-row' }, K.button({ label: 'Volver al módulo', variant: 'primary', icon: 'list', onClick: function () { E.irModulo(e.mod.id); } })));
  };

  /* ------------------------------------------------------------------ rutas reservadas, cargando, error */
  P.reservada = function (E, nombre, titulo) {
    var K = E.K, h = E.h, n = NOMBRE_RESERVADA[nombre] || [titulo || 'Esta pantalla', 'Llega en una de las próximas actualizaciones.'];
    return h('div', { 'class': 'es-soon' },
      K.pageHeader({ kicker: '05 · Escuela · ' + n[0], title: n[0], sub: n[1] }),
      h('div', { 'class': 'es-calm' }, h('span', { 'class': 'es-tag', text: 'Llega pronto' }), h('p', { text: 'Todavía la estamos armando. Mientras tanto podés seguir con las lecciones.' })),
      h('div', { 'class': 'btn-row' }, K.button({ label: 'Volver al mapa de la escuela', variant: 'primary', icon: 'map', onClick: function () { E.irMapa(); } })));
  };
  P.cargando = function (E, texto) {
    var h = E.h;
    return h('div', { 'class': 'es-loading', role: 'status', 'aria-live': 'polite' }, h('p', { 'class': 'es-meta', text: (texto || 'Cargando la lección…').toUpperCase() }), E.K.skeleton('title'), E.K.skeleton('text', 3));
  };
  P.error = function (E, texto, reintentar) {
    var K = E.K, h = E.h;
    return h('div', { 'class': 'es-soon' },
      K.callout({ variant: 'cuidado', title: 'No pudimos cargar esto', text: texto || 'Revisá tu conexión y probá de nuevo.' }),
      h('div', { 'class': 'btn-row' }, K.button({ label: 'Reintentar', variant: 'primary', icon: 'reset', onClick: reintentar }), K.button({ label: 'Volver al mapa', variant: 'ghost', icon: 'map', onClick: function () { E.irMapa(); } })));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(root.C150);
