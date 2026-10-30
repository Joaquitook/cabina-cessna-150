var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/pantallas.js — C150.ESCUELA.pantallas: las pantallas de la Escuela fuera de la lección (contrato v7 §3/§4, rediseño v8 §4 "a pantalla completa"):
 * el mapa de la escuela, el módulo, la lección que todavía no está ("Próximamente"), las rutas reservadas (repaso, examen, glosario, dudas: una tarjeta
 * tranquila "llega pronto"), el cargando y el error con reintento. Todo con el Kit y clases es-* (styles.css, bloque "v8 · L3").
 *
 * Cada función recibe `E`, el controlador que arma escuela.js: { K, h, icon, datos, store, irModulo(id), irLeccion(id, clave?, idx?), irMapa(), irReservada(k),
 * secOpen:{}, exportar(), importar(archivo), reintentar() } y devuelve un elemento.
 *   P.mapa(E) · P.modulo(E, idMod) · P.proximamente(E, entradaLeccion) · P.reservada(E, nombre) · P.cargando(E, texto) · P.error(E, texto, reintentar)
 *   P.estadoLec(store, id) → {estado:'nueva'|'en-curso'|'hecha', estrellas, paso}       P.fmtMin(n) → '45 min' · '1 h 05 min'       P.saludo(hora) → 'Buen día'…
 *   P.resumenMod(E, m) → {total, disponibles, hechas, minutos, falta, frac, enPrep}     P.geometriaCamino(n, xs) → {d, dHasta(k), ys}   (puro, para tests)
 * Mapa: cabecera con saludo en tipo display · tarjeta "Continuar" (el progreso del paso se completa al cargar el módulo) · tira de constancia · "Repaso del día" (llega pronto)
 *       · vista "Módulos" (dos secciones numeradas, tarjetas con el código del módulo como marca de agua) o "Camino" (ruta SVG con estaciones; la próxima resaltada).
 * Módulo: banda con marca de agua y anillo · índice de unidades pegajoso (escritorio) · unidades como secciones grandes numeradas · lecciones como tarjetas
 *       (las "Próximamente" van atenuadas y no se tocan; las unidades sin nada listo se pliegan).
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var P = ES.pantallas = ES.pantallas || {};

  function arr(x) { return Array.isArray(x) ? x : []; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function isFn(f) { return typeof f === 'function'; }
  /** El número que se ve en pantalla es el del propio id (unidad 'MET-04' → '04', lección 'MET-04-02' → '02'), no la posición en la lista: así lo que se lee
   *  coincide con el código de la lección. nivel 1 = unidad, 2 = lección; si el id no trae número se usa la posición. */
  P.numId = function (id, pos, nivel) { var v = parseInt(String(id || '').split('-')[nivel], 10); return p2(v > 0 ? v : pos); };
  P.fmtMin = function (n) { n = Math.max(0, Math.round(n || 0)); return n < 60 ? n + ' min' : Math.floor(n / 60) + ' h ' + p2(n % 60) + ' min'; };
  P.saludo = function (hora) { hora = typeof hora === 'number' ? hora : new Date().getHours(); return hora < 6 ? 'Buenas noches' : hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches'; };
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
  var ICO_COMP = { simulador: 'gauge', diagrama: 'layers', animacion: 'play', clasificar: 'list', emparejar: 'swap', enlace3d: 'cabin', calculadora: 'keyboard', situacion: 'target',
    ordenar: 'list', completar: 'checklist', tarjetas: 'layers', diapositiva: 'play', quiz: 'quiz', caso: 'book', mapa: 'map', fraseologia: 'sound' };

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

  /** Geometría del camino (pura): n estaciones, una por fila de 100 unidades de alto; xs = [x izquierda, x derecha] en % del ancho.
   *  → {ys:[y de cada estación], x:[x de cada estación], d: trazo completo (con tramo de entrada y de salida), dHasta(k): el trazo de la estación 0 a la k} */
  P.geometriaCamino = function (n, xs) {
    var X = [], Y = [], i;
    for (i = 0; i < n; i++) { X.push(xs[i % 2]); Y.push(i * 100 + 50); }
    function seg(i) { return ' C ' + X[i - 1] + ' ' + (Y[i - 1] + 48) + ', ' + X[i] + ' ' + (Y[i] - 48) + ', ' + X[i] + ' ' + Y[i]; }
    function dHasta(k) { var d = 'M ' + X[0] + ' ' + Y[0]; for (var j = 1; j <= k && j < n; j++) d += seg(j); return d; }
    var d = n ? 'M ' + X[0] + ' 0 L ' + X[0] + ' ' + Y[0] : '';
    for (i = 1; i < n; i++) d += seg(i);
    if (n) d += ' L ' + X[n - 1] + ' ' + (n * 100);
    return { x: X, ys: Y, d: d, dHasta: dHasta };
  };

  /* ------------------------------------------------------------------ piezas chicas (con DOM) */
  function sv(tag, attrs, kids) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in (attrs || {})) el.setAttribute(k, attrs[k]);
    arr(kids).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function anillo(E, r, size) {
    var el = E.K.progressRing(r.frac, { size: size || 46, stroke: 10, ok: r.disponibles > 0 && r.hechas === r.disponibles, ariaLabel: 'Avance del módulo', text: r.disponibles ? Math.round(r.frac * 100) + '' : '–' });
    el.classList.add('es-ring');
    return el;
  }
  function icono(E, m, grande) {
    return E.h('span', { 'class': 'es-ico' + (grande ? ' es-ico--lg' : ''), 'aria-hidden': 'true' }, E.icon(m.icono || 'cap', grande ? 26 : 22));
  }
  function marca(E, texto, clase) { return E.h('span', { 'class': clase, 'aria-hidden': 'true', text: texto }); }
  function estadoModulo(r) { return r.disponibles > 0 && r.hechas === r.disponibles ? ['Completo', 'es-tag--done'] : r.enPrep ? ['En preparación', ''] : ['Disponible', 'es-tag--ok']; }
  function etiqueta(E, r) { var t = estadoModulo(r); return E.h('span', { 'class': 'es-tag ' + t[1], text: t[0] }); }
  function chipsComp(E, l, max) {
    var h = E.h, cods = h('span', { 'class': 'es-codes', 'aria-hidden': 'true' }), seen = {}, n = 0;
    arr(l.componentes).forEach(function (t) {
      var c = ES.componentes.codigo(t);
      if (seen[c] || n >= (max || 4)) return;
      seen[c] = 1; n++;
      cods.appendChild(h('span', { 'class': 'es-lchip', title: ES.componentes.nombre(t) }, E.icon(ICO_COMP[t] || 'dot', 13), h('span', { text: c })));
    });
    return cods;
  }
  function estrellas(E, n) {
    return E.h('span', { 'class': 'es-rowstars', 'aria-hidden': 'true' }, [1, 2, 3].map(function (k) { return E.h('span', { 'class': 'es-star' + (k <= n ? ' is-on' : '') }, E.icon('star')); }));
  }
  function seccionNum(E, num, titulo, meta, cuerpo, extra) {
    var h = E.h;
    return h('section', { 'class': 'es-sx' + (extra ? ' ' + extra : ''), 'aria-label': titulo },
      h('header', { 'class': 'es-sx-h' }, h('span', { 'class': 'es-sx-n', 'aria-hidden': 'true', text: num }), h('h3', { 'class': 'es-sx-t', text: titulo }), meta ? h('span', { 'class': 'es-sx-m', text: meta }) : null), cuerpo);
  }

  /* ------------------------------------------------------------------ mapa */
  function tarjetaModulo(E, m) {
    var r = resumenMod(E, m), h = E.h;
    var lecs = r.disponibles ? r.hechas + ' de ' + r.disponibles + (r.disponibles === 1 ? ' lección' : ' lecciones') : (r.total ? r.total + ' lecciones en preparación' : 'Sin lecciones todavía');
    return h('button', { type: 'button', 'class': 'es-mod' + (r.enPrep ? ' is-prep' : ''), style: { '--es-hue': m.color }, 'data-mod': m.id, onclick: function () { E.irModulo(m.id); },
      'aria-label': m.titulo + '. ' + lecs + (r.enPrep ? '. Contenido en preparación.' : '.') },
      marca(E, m.id, 'es-wm'),
      h('span', { 'class': 'es-mod-top' }, icono(E, m), etiqueta(E, r), anillo(E, r)),
      h('span', { 'class': 'es-mod-title', text: m.titulo }),
      h('span', { 'class': 'es-mod-pp', text: (m.id + (m.paginas ? ' · pp. ' + m.paginas + ' del curso' : '')) }),
      h('span', { 'class': 'es-mod-sum', text: m.resumen || '' }),
      h('span', { 'class': 'es-mod-foot' },
        h('span', { 'class': 'es-bar', 'aria-hidden': 'true' }, h('span', { style: { width: Math.round(r.frac * 100) + '%' } })),
        h('span', { 'class': 'es-mod-meta' }, h('span', { text: lecs }), r.disponibles ? h('span', { text: P.fmtMin(r.falta) + (r.falta ? ' para terminar' : '') }) : null)));
  }
  function estacion(E, m, i, nextId, nTotal) {
    var h = E.h, r = resumenMod(E, m);
    var lecs = r.disponibles ? r.hechas + ' de ' + r.disponibles + ' lecciones' : (r.total + ' lecciones · en preparación');
    var hecha = r.disponibles > 0 && r.hechas === r.disponibles;
    var lado = i % 2 === 0 ? 'is-l' : 'is-r';
    return h('li', { 'class': 'es-st ' + lado + (hecha ? ' is-done' : '') + (m.id === nextId ? ' is-next' : ''), style: { '--es-hue': m.color } },
      h('button', { type: 'button', 'class': 'es-st-btn', 'data-mod': m.id, onclick: function () { E.irModulo(m.id); },
        'aria-label': 'Estación ' + (i + 1) + ' de ' + nTotal + ': ' + m.titulo + '. ' + lecs + (m.id === nextId ? '. Es la que sigue.' : '') },
        h('span', { 'class': 'es-st-node', 'aria-hidden': 'true' }, hecha ? E.icon('check', 26) : E.icon(m.icono || 'cap', 26)),
        h('span', { 'class': 'es-st-body' },
          h('span', { 'class': 'es-st-k', text: 'Estación ' + p2(i + 1) + ' · ' + m.id + (m.paginas ? ' · pp. ' + m.paginas : '') }),
          h('span', { 'class': 'es-st-t', text: m.titulo }),
          h('span', { 'class': 'es-st-m', text: lecs + (r.disponibles && r.enPrep ? ' · en preparación' : '') }),
          m.id === nextId ? h('span', { 'class': 'es-tag es-tag--now', text: 'Estás acá' }) : null)));
  }
  function camino(E, mods, nextId) {
    var h = E.h, n = mods.length, next = -1;
    mods.forEach(function (m, k) { if (m.id === nextId) next = k; });
    var ol = h('ol', { 'class': 'es-path', 'aria-label': 'Camino de la escuela, en el orden del curso' });
    var wrap = h('div', { 'class': 'es-road-wrap' });
    // dos trazados (ancho y angosto): el CSS muestra uno según el ancho de la columna
    [['es-road es-road--w', [36, 64]], ['es-road es-road--n', [14, 26]]].forEach(function (v) {
      var g = P.geometriaCamino(n, v[1]);
      var kids = [sv('path', { 'class': 'rd-edge', d: g.d }), sv('path', { 'class': 'rd-bed', d: g.d })];
      if (next > 0) kids.push(sv('path', { 'class': 'rd-done', d: g.dHasta(next) }));
      kids.push(sv('path', { 'class': 'rd-dash', d: g.d }));
      wrap.appendChild(sv('svg', { 'class': v[0], viewBox: '0 0 100 ' + (n * 100), preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' }, kids));
    });
    mods.forEach(function (m, k) { ol.appendChild(estacion(E, m, k, nextId, n)); });
    wrap.appendChild(ol);
    return wrap;
  }

  P.mapa = function (E) {
    var K = E.K, h = E.h, st = E.store, mods = E.datos.modulos(), vistas = E.datos.lista();
    var el = h('div', { 'class': 'es-map' });
    el.appendChild(h('header', { 'class': 'es-mhead' },
      h('p', { 'class': 'pg-kicker' }, h('span', { 'class': 'pg-kicker-dot', 'aria-hidden': 'true' }), h('span', { text: '05 · Escuela · Mapa' })),
      h('h2', { 'class': 'es-disp' }, h('span', { text: P.saludo() + '.' }), h('span', { 'class': 'es-disp-2', text: 'Teoría para el examen' })),
      h('p', { 'class': 'es-lede', text: 'Los módulos del Curso Piloto Privado de AeroSur, en su orden, y los demás que completan tu preparación. Cada lección es corta, se hace y se practica: no se lee de corrido.' })));

    // Continuar
    var u = st.ultima(), eu = u ? E.datos.leccion(u.leccion) : null, hero = null, sig = null;
    for (var i = 0; i < vistas.length; i++) if (E.datos.disponible(vistas[i]) && P.estadoLec(st, vistas[i].id).estado !== 'hecha') { sig = vistas[i]; break; }
    var hechas = vistas.filter(function (e) { return E.datos.disponible(e) && P.estadoLec(st, e.id).estado === 'hecha'; }).length, disp = E.datos.total ? E.datos.total() : 0;
    if (eu && E.datos.disponible(eu) && P.estadoLec(st, eu.id).estado !== 'hecha') {
      hero = { k: 'Continuar donde dejaste', e: eu, paso: u.paso, b: u.paso > 0 ? 'Seguí en el paso ' + u.paso : 'Seguí con esta lección', fn: function () { E.irLeccion(eu.id, null, u.paso); } };
    } else if (sig) {
      hero = { k: Object.keys(st.estado().lecciones).length ? 'Seguí con' : 'Empezá por acá', e: sig, paso: 0, b: 'Empezar', fn: function () { E.irLeccion(sig.id); } };
    }
    var top = h('div', { 'class': 'es-top' });
    if (hero) {
      var he = hero.e, barra = K.progressBar(0, { label: 'Avance de la lección' }), pasoTxt = h('span', { 'class': 'es-cont-paso', text: hero.paso > 0 ? 'Paso ' + hero.paso : 'Sin empezar' });
      var info = h('p', { 'class': 'es-cont-m' }, h('span', { text: he.mod.id + ' · ' + he.id }), h('span', { text: P.fmtMin(he.lec.minutos) }), pasoTxt);
      var tarjeta = h('section', { 'class': 'es-cont', style: { '--es-hue': he.mod.color }, 'aria-label': 'Continuar' },
        marca(E, he.mod.id, 'es-wm'),
        h('p', { 'class': 'es-cont-k', text: hero.k }),
        h('h3', { 'class': 'es-cont-t', text: he.lec.titulo }),
        info, hero.paso > 0 ? barra : null,
        h('div', { 'class': 'es-cont-btn' }, K.button({ label: hero.b, variant: 'primary', iconRight: 'arrow-right', onClick: hero.fn })));
      top.appendChild(tarjeta);
      if (hero.paso > 0 && isFn(E.datos.cargar) && ES.leccion && isFn(ES.leccion.armar)) {     // el total de pasos sale del módulo (se pide ya: así abre más rápido)
        E.datos.cargar(he.mod.id).then(function (mod) {
          var ld = mod && mod.lecs && mod.lecs[he.id]; if (!ld) return;
          var tot = ES.leccion.armar(ld).length;
          if (tot > 1) { barra.set(Math.min(1, hero.paso / (tot - 1))); pasoTxt.textContent = 'Paso ' + hero.paso + ' de ' + (tot - 1); }
        }, function () {});
      }
    } else {
      top.appendChild(h('section', { 'class': 'es-cont es-cont--done', 'aria-label': 'Estás al día' },
        h('p', { 'class': 'es-cont-k', text: 'Estás al día' }), h('h3', { 'class': 'es-cont-t', text: 'Hiciste todas las lecciones disponibles' }),
        h('p', { 'class': 'es-cont-m' }, h('span', { text: 'Pronto llegan más módulos' }))));
    }
    var racha = st.racha(), ins = Object.keys(st.insignias()).length;
    function stat(n, l) { return h('li', { 'class': 'es-stat' }, h('span', { 'class': 'es-stat-n', text: String(n) }), h('span', { 'class': 'es-stat-l', text: l })); }
    top.appendChild(h('div', { 'class': 'es-aside' },
      h('ul', { 'class': 'es-stats', 'aria-label': 'Tu constancia' }, stat(racha, racha === 1 ? 'día de racha' : 'días de racha'), stat(st.minutosSemana(), 'min esta semana'), stat(hechas + (disp ? '/' + disp : ''), hechas === 1 ? 'lección hecha' : 'lecciones hechas')),
      h('div', { 'class': 'es-repaso', 'aria-disabled': 'true' },
        h('span', { 'class': 'es-repaso-ico', 'aria-hidden': 'true' }, E.icon('reset', 22)),
        h('span', { 'class': 'es-repaso-b' }, h('span', { 'class': 'es-repaso-t', text: 'Repaso del día' }), h('span', { 'class': 'es-repaso-s', text: ins ? ins + (ins === 1 ? ' insignia ganada' : ' insignias ganadas') : 'Tarjetas para repasar un poquito cada día' })),
        h('span', { 'class': 'es-tag', text: 'Llega pronto' }))));
    el.appendChild(top);

    // vista: tarjetas / camino
    var vista = st.pref('mapa') === 'camino' ? 'camino' : 'tarjetas';
    var cont = h('div', { 'class': 'es-map-body' });
    var switcher = K.modes({ label: 'Cómo ver los módulos', value: vista, items: [{ value: 'tarjetas', label: 'Módulos', sub: 'por tema' }, { value: 'camino', label: 'Camino', sub: 'en orden del curso' }],
      onChange: function (v) { st.pref('mapa', v); pintar(v); } });
    el.appendChild(h('div', { 'class': 'es-vbar' }, switcher));
    el.appendChild(cont);
    function grupo(lista, num, titulo) {
      var grid = h('div', { 'class': 'es-mods' });
      lista.forEach(function (m) { grid.appendChild(tarjetaModulo(E, m)); });
      return seccionNum(E, num, titulo, lista.length + (lista.length === 1 ? ' módulo' : ' módulos'), grid);
    }
    function pintar(v) {
      while (cont.firstChild) cont.removeChild(cont.firstChild);
      var curso = mods.filter(function (m) { return m.fuente === 'aerosur'; }), mas = mods.filter(function (m) { return m.fuente !== 'aerosur'; });
      if (v === 'camino') cont.appendChild(camino(E, mods, sig ? sig.mod.id : ''));
      else {
        if (curso.length) cont.appendChild(grupo(curso, '01', 'El curso de AeroSur'));
        if (mas.length) cont.appendChild(grupo(mas, '02', 'Más módulos de la escuela'));
      }
    }
    pintar(vista);

    // lo que viene (rutas reservadas) + guardar progreso
    var res = h('ul', { 'class': 'es-soon-list' });
    ['repaso', 'examen', 'glosario', 'dudas'].forEach(function (k) {
      res.appendChild(h('li', null, h('button', { type: 'button', 'class': 'es-soon-btn', onclick: function () { if (isFn(E.irReservada)) E.irReservada(k); } },
        h('span', { 'class': 'es-soon-t', text: NOMBRE_RESERVADA[k][0] }), h('span', { 'class': 'es-tag', text: 'Llega pronto' }))));
    });
    el.appendChild(h('section', { 'class': 'es-later', 'aria-label': 'Lo que viene' }, h('p', { 'class': 'es-meta', text: 'Lo que viene' }), res));
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
  function tarjetaLeccion(E, l, n) {
    var num = P.numId(l.id, n, 2);
    var h = E.h, disp = l.detalle === 'completo', es = P.estadoLec(E.store, l.id);
    var estadoTxt = es.estado === 'hecha' ? 'hecha' : es.estado === 'en-curso' ? 'en curso' : (disp ? 'sin ver' : 'próximamente');
    var pie;
    if (!disp) pie = h('span', { 'class': 'es-tag', text: 'Próximamente' });
    else if (es.estado === 'hecha') pie = h('span', { 'class': 'es-lcard-st is-hecha' }, E.icon('check', 16), h('span', { text: 'Hecha' }), estrellas(E, es.estrellas));
    else if (es.estado === 'en-curso') pie = h('span', { 'class': 'es-lcard-st is-en-curso' }, h('span', { 'class': 'es-dot is-en-curso', 'aria-hidden': 'true' }), h('span', { text: 'En curso · paso ' + es.paso }));
    else pie = h('span', { 'class': 'es-lcard-st' }, h('span', { 'class': 'es-dot is-nueva', 'aria-hidden': 'true' }), h('span', { text: 'Sin ver' }));
    var kids = [
      h('span', { 'class': 'es-lcard-top' }, h('span', { 'class': 'es-lcard-n', 'aria-hidden': 'true', text: num }), h('span', { 'class': 'es-lcard-id', text: l.id })),
      h('span', { 'class': 'es-lcard-t', text: l.titulo }),
      h('span', { 'class': 'es-lcard-m' }, (l.paginas ? 'pp. ' + l.paginas + ' · ' : '') + (l.minutos || 0) + ' min'),
      chipsComp(E, l, 4), h('span', { 'class': 'es-lcard-pie' }, pie)];
    var aria = l.id + ' ' + l.titulo + '. ' + estadoTxt + '. ' + (l.minutos || 0) + ' minutos.';
    if (!disp) return h('div', { 'class': 'es-lcard is-soon', 'data-lec': l.id, 'aria-label': aria, role: 'group' }, kids);
    return h('button', { type: 'button', 'class': 'es-lcard is-' + es.estado, 'data-lec': l.id, 'aria-label': aria, onclick: function () { E.irLeccion(l.id); } }, kids);
  }
  var headObs = null, scrollObs = null;
  /** El índice pegajoso baja lo que mida la barra de Nav ("← Volver a …"), si está a la vista: --es-head-h en la pantalla. */
  function medirCabecera(el) {
    function medir() { var hd = document.getElementById('panel-head'), hh = (hd && hd.offsetParent !== null) ? (hd.offsetHeight || 0) : 0; el.style.setProperty('--es-head-h', hh + 'px'); }
    if (headObs) { try { headObs.disconnect(); } catch (e) { /* nada */ } headObs = null; }
    var hd0 = document.getElementById('panel-head');
    if (hd0 && typeof ResizeObserver === 'function') { headObs = new ResizeObserver(function () { if (!el.isConnected) { headObs.disconnect(); return; } medir(); }); headObs.observe(hd0); }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(medir); else medir();
  }

  function marcarUnidad(el, secs, botones) {
    function actualizar() {
      var pn = el.closest ? el.closest('.panel') : null, top = pn ? pn.getBoundingClientRect().top : 0;
      var linea = top + (parseFloat(el.style.getPropertyValue('--es-head-h')) || 0) + 150, cur = 0;
      secs.forEach(function (sc, k) { if (sc.getBoundingClientRect().top <= linea) cur = k; });
      botones.forEach(function (bt, k) { if (k === cur) bt.setAttribute('aria-current', 'true'); else bt.removeAttribute('aria-current'); });
    }
    if (scrollObs) { scrollObs.pn.removeEventListener('scroll', scrollObs.fn); scrollObs = null; }
    function conectar() {
      var pn = el.closest ? el.closest('.panel') : null; if (!pn) return;
      var fn = function () { if (!el.isConnected) { pn.removeEventListener('scroll', fn); return; } actualizar(); };
      pn.addEventListener('scroll', fn, { passive: true }); scrollObs = { pn: pn, fn: fn }; actualizar();
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(conectar); else conectar();
  }

  P.modulo = function (E, id) {
    var K = E.K, h = E.h, m = E.datos.modulo(id);
    if (!m) return P.reservada(E, 'modulo-desconocido', 'No encontramos ese módulo');
    var r = resumenMod(E, m), el = h('div', { 'class': 'es-mod-screen', style: { '--es-hue': m.color } });
    var enCurso = null, sig = null;
    E.datos.lista().forEach(function (e) {
      if (e.mod.id !== m.id || !E.datos.disponible(e)) return;
      var es = P.estadoLec(E.store, e.id);
      if (!enCurso && es.estado === 'en-curso') enCurso = e;
      if (!sig && es.estado !== 'hecha') sig = e;
    });
    var objetivo = enCurso || sig;
    var lecsTxt = r.disponibles ? r.hechas + ' de ' + r.disponibles + (r.disponibles === 1 ? ' lección' : ' lecciones') : 'Todavía sin lecciones';

    // banda
    var acc = h('div', { 'class': 'es-mh-actions' });
    if (objetivo) acc.appendChild(K.button({ label: enCurso ? 'Continuar' : (r.hechas ? 'Seguir' : 'Empezar'), variant: 'primary', iconRight: 'arrow-right', onClick: function () { E.irLeccion(objetivo.id, null, enCurso ? P.estadoLec(E.store, objetivo.id).paso : 0); } }));
    acc.appendChild(h('span', { 'class': 'es-soon-wrap' }, K.button({ label: 'Repaso', variant: 'secondary', size: 'small', disabled: true }), h('span', { 'class': 'es-tag', text: 'Llega pronto' })));
    acc.appendChild(h('span', { 'class': 'es-soon-wrap' }, K.button({ label: 'Examen del módulo', variant: 'secondary', size: 'small', disabled: true }), h('span', { 'class': 'es-tag', text: 'Llega pronto' })));
    var ring = anillo(E, r, 120); ring.classList.add('es-ring--xl');
    el.appendChild(h('header', { 'class': 'es-mh' },
      marca(E, m.id, 'es-wm es-wm--xl'),
      h('div', { 'class': 'es-mh-main' },
        h('p', { 'class': 'pg-kicker' }, h('span', { 'class': 'pg-kicker-dot', 'aria-hidden': 'true' }), h('span', { text: '05 · Escuela · ' + m.id })),
        h('h2', { 'class': 'es-disp' }, h('span', { text: m.titulo })),
        m.resumen ? h('p', { 'class': 'es-lede', text: m.resumen }) : null,
        h('ul', { 'class': 'es-mh-meta', 'aria-label': 'Datos del módulo' },
          m.paginas ? h('li', { text: 'pp. ' + m.paginas + ' del curso' }) : null,
          h('li', { text: r.total + ' lecciones' }),
          h('li', { text: r.disponibles ? 'Faltan ' + P.fmtMin(r.falta) : P.fmtMin(r.minutos) + ' planificados' }),
          r.enPrep ? h('li', null, h('span', { 'class': 'es-tag', text: 'Contenido en preparación' })) : null),
        acc),
      h('div', { 'class': 'es-mh-ring' }, ring, h('p', { 'class': 'es-mod-big', text: lecsTxt }))));

    // índice de unidades + unidades
    var unidades = arr(m.unidades), idx = h('ol', { 'class': 'es-uidx-l' }), cuerpo = h('div', { 'class': 'es-units' }), secs = [], botones = [];
    unidades.forEach(function (u, k) {
      var disp = arr(u.lecciones).filter(function (l) { return l.detalle === 'completo'; });
      var hechas = disp.filter(function (l) { return P.estadoLec(E.store, l.id).estado === 'hecha'; }).length;
      var plegada = disp.length === 0, abierta = E.secOpen[u.id] !== undefined ? !!E.secOpen[u.id] : !plegada;
      var nUni = P.numId(u.id, k + 1, 1), parte = nUni !== p2(k + 1) ? 'Parte ' + (k + 1) + ' de ' + unidades.length + ' · ' : '';
      var meta = parte + (u.paginas ? 'pp. ' + u.paginas + ' · ' : '') + (disp.length ? hechas + ' de ' + disp.length + ' hechas' : arr(u.lecciones).length + ' lecciones · próximamente');
      var grid = h('ul', { 'class': 'es-lgrid' });
      arr(u.lecciones).forEach(function (l, j) { grid.appendChild(h('li', null, tarjetaLeccion(E, l, j + 1))); });
      var bodyId = 'es-ub-' + u.id;
      grid.id = bodyId; grid.hidden = !abierta;
      var tog = null;
      if (plegada) {
        tog = h('button', { type: 'button', 'class': 'es-unit-tog', 'aria-expanded': abierta ? 'true' : 'false', 'aria-controls': bodyId },
          h('span', { text: abierta ? 'Ocultar las lecciones' : 'Ver las ' + arr(u.lecciones).length + ' lecciones' }), E.icon('chevron-down', 18));
        tog.addEventListener('click', function () { abre(!(tog.getAttribute('aria-expanded') === 'true')); });
      }
      var sec = h('section', { 'class': 'es-unit' + (plegada ? ' is-soon' : ''), 'data-sec': 'es-u-' + u.id, 'aria-labelledby': 'es-uh-' + u.id },
        h('header', { 'class': 'es-unit-h' },
          h('span', { 'class': 'es-unit-n', 'aria-hidden': 'true', text: nUni }),
          h('div', { 'class': 'es-unit-b' }, h('h3', { 'class': 'es-unit-t', id: 'es-uh-' + u.id, text: u.titulo }), h('p', { 'class': 'es-unit-m', text: meta })), tog),
        grid);
      function abre(v) {
        grid.hidden = !v; E.secOpen[u.id] = v;
        if (tog) { tog.setAttribute('aria-expanded', v ? 'true' : 'false'); tog.firstChild.textContent = v ? 'Ocultar las lecciones' : 'Ver las ' + arr(u.lecciones).length + ' lecciones'; }
      }
      sec.abre = abre;
      secs.push(sec);
      var b = h('button', { type: 'button', 'class': 'es-uidx-b' + (plegada ? ' is-soon' : ''), 'data-u': u.id },
        h('span', { 'class': 'es-uidx-n', text: nUni }), h('span', { 'class': 'es-uidx-t', text: u.titulo }), h('span', { 'class': 'es-uidx-c', text: disp.length ? hechas + '/' + disp.length : '–' }));
      b.addEventListener('click', function () {
        if (plegada && grid.hidden) abre(true);
        var rm = K.reducedMotion && K.reducedMotion();
        if (sec.scrollIntoView) sec.scrollIntoView({ block: 'start', behavior: rm ? 'auto' : 'smooth' });
      });
      botones.push(b);
      idx.appendChild(h('li', null, b));
      cuerpo.appendChild(sec);
    });
    el.appendChild(h('div', { 'class': 'es-mb' },
      unidades.length > 1 ? h('nav', { 'class': 'es-uidx', 'aria-label': 'Unidades del módulo' }, h('p', { 'class': 'es-meta', text: 'Unidades' }), idx) : null, cuerpo));
    el.appendChild(h('p', { 'class': 'aviso', text: 'Las lecciones con «Próximamente» ya están planificadas y llegan en las próximas actualizaciones.' }));
    medirCabecera(el);

    // el índice marca la unidad que se está leyendo: la última cuyo borde de arriba ya pasó una línea cerca del tope del panel
    if (unidades.length > 1) marcarUnidad(el, secs, botones);
    return el;
  };

  /* ------------------------------------------------------------------ lección que todavía no está */
  P.proximamente = function (E, e) {
    var K = E.K, h = E.h, l = e.lec;
    var cods = h('ul', { 'class': 'es-chips', 'aria-label': 'Actividades planificadas' });
    arr(l.componentes).forEach(function (t) { cods.appendChild(h('li', null, h('span', { 'class': 'es-code', text: ES.componentes.codigo(t) }), h('span', { text: ES.componentes.nombre(t) }))); });
    return h('div', { 'class': 'es-soon', style: { '--es-hue': e.mod.color } },
      h('header', { 'class': 'es-mhead' },
        h('p', { 'class': 'pg-kicker' }, h('span', { 'class': 'pg-kicker-dot', 'aria-hidden': 'true' }), h('span', { text: '05 · Escuela · ' + e.mod.id + ' · ' + e.id })),
        h('h2', { 'class': 'es-disp' }, h('span', { text: l.titulo })),
        h('p', { 'class': 'es-lede', text: 'Esta lección ya está planificada, pero todavía no está lista para estudiar.' })),
      h('p', { 'class': 'es-meta', text: ((l.paginas ? 'pp. ' + l.paginas + ' del curso · ' : '') + (l.minutos || 0) + ' min').toUpperCase() }),
      arr(l.componentes).length ? h('p', { 'class': 'es-lead', text: 'Va a tener:' }) : null, arr(l.componentes).length ? cods : null,
      h('div', { 'class': 'btn-row' }, K.button({ label: 'Volver al módulo', variant: 'primary', icon: 'list', onClick: function () { E.irModulo(e.mod.id); } })));
  };

  /* ------------------------------------------------------------------ rutas reservadas, cargando, error */
  function ilustracion() {      // un avioncito con su ruta punteada, dos nubes y el sol: sólo tokens del tema (currentColor / --accent)
    var nube = function (x, y, s) { return sv('path', { 'class': 'il-cloud', d: 'M' + x + ' ' + y + 'h' + (46 * s) + 'a' + (9 * s) + ' ' + (9 * s) + ' 0 0 0 0 ' + (-18 * s) + 'a' + (13 * s) + ' ' + (13 * s) + ' 0 0 0 ' + (-25 * s) + ' ' + (-6 * s) + 'a' + (10 * s) + ' ' + (10 * s) + ' 0 0 0 ' + (-21 * s) + ' ' + (24 * s) + 'z' }); };
    return sv('svg', { 'class': 'es-calm-il', viewBox: '0 0 320 170', 'aria-hidden': 'true', focusable: 'false' }, [
      sv('circle', { 'class': 'il-sun', cx: '250', cy: '52', r: '26' }), nube(40, 70, 1), nube(196, 128, .8),
      sv('path', { 'class': 'il-trail', d: 'M18 150 C 90 150, 120 60, 200 62 S 270 98, 300 84' }),
      sv('g', { 'class': 'il-plane' }, [sv('path', { d: 'M284 84H316' }), sv('path', { d: 'M302 84L292 62M302 84L292 106' }), sv('path', { d: 'M289 84L284 74M289 84L284 94' })])]);
  }
  P.reservada = function (E, nombre, titulo) {
    var K = E.K, h = E.h, n = NOMBRE_RESERVADA[nombre] || [titulo || 'Esta pantalla', 'Llega en una de las próximas actualizaciones.'];
    return h('div', { 'class': 'es-soon es-soon--full' },
      h('header', { 'class': 'es-mhead' },
        h('p', { 'class': 'pg-kicker' }, h('span', { 'class': 'pg-kicker-dot', 'aria-hidden': 'true' }), h('span', { text: '05 · Escuela · ' + n[0] })),
        h('h2', { 'class': 'es-disp' }, h('span', { text: n[0] })),
        h('p', { 'class': 'es-lede', text: n[1] })),
      h('div', { 'class': 'es-calm' }, ilustracion(),
        h('div', { 'class': 'es-calm-b' }, h('span', { 'class': 'es-tag es-tag--now', text: 'Llega pronto' }), h('p', { 'class': 'es-calm-t', text: 'Todavía la estamos armando.' }),
          h('p', { 'class': 'es-calm-s', text: 'Mientras tanto podés seguir con las lecciones.' }),
          h('div', { 'class': 'btn-row' }, K.button({ label: 'Volver al mapa de la escuela', variant: 'primary', icon: 'map', onClick: function () { E.irMapa(); } })))));
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
