var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/escuela.js — C150.Escuela: la pestaña ESCUELA (teoría para el examen, contrato v7). Pega las piezas de src/escuela/:
 * datos.js (índice + carga perezosa) · store.js (progreso) · motor.js (componentes) · leccion.js (ejecutor) · pantallas.js (mapa, módulo…).
 *
 * API que usa ui.js (ya estaba prevista en modeImpl.escuela, UI.go('escuela/…') y syncNav):
 *   Escuela.mount(sec, api)   arma el panel (api = labApi() de ui.js)      Escuela.enter() / exit()   3D tranquilo (cabina, estacionado) y vuelta atrás
 *   Escuela.slow(s)           ≈ 15 Hz mientras la pestaña está abierta     Escuela.go(rest)           ruta cruda sin historial (Nav la usa para mostrar una ruta)
 *   Escuela.total             lecciones disponibles (alimenta la etapa 6 de "Tu camino")        Escuela.cargar(id) → Promise del módulo
 *   Escuela.state() → {vista, mod, lec, clave}      Escuela.navProvider() → el proveedor de C150.Nav (ui.js lo registra para 'escuela')
 *   Escuela.tituloLeccion(id) · Escuela.rutaLeccion(id) → para Progress (Continuar en Inicio)          Escuela.store() · Escuela.datos
 *
 * Rutas (#escuela/…): '' mapa · 'AER' módulo · 'AER-03' módulo con esa unidad abierta · 'AER-03-02' lección (intro) · 'AER-03-02/3' punto clave 3 ·
 * 'AER-03-02/practica' · '/quiz' · '/resumen' · reservadas: 'repaso' · 'examen[/AER]' · 'glosario' · 'dudas' (tarjeta "llega pronto"). Sin datos personales.
 *
 * Navegación (contrato v6): mapa → módulo = Nav.detail; módulo → lección = Nav.detail con {nest:true} (UP vuelve al módulo, UP otra vez al mapa);
 * paso → paso = Nav.replace (la URL sigue al paso, sin entradas nuevas); "Volver al módulo" = UP si se llegó desde el módulo, si no replace.
 * El proveedor guarda {vista, mod, lec, clave}; la lección en curso sobrevive a salir de la pestaña ("EN CURSO") y se retoma en el mismo paso.
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var D = ES.datos, Mot = ES.componentes, Leccion = ES.leccion, Pan = ES.pantallas;
  var Visor = (C150.Escuela && C150.Escuela.visor) || null;      // src/escuela/visor.js (visor 3D a pedido, contrato v8); sin él, MIRAR sigue siendo Nav.look
  var Escuela = C150.Escuela = C150.Escuela || {};

  var RESERVADAS = ['repaso', 'examen', 'glosario', 'dudas'];
  var A = null, K = null, h = null, sec = null, body = null, mounted = false, active = false;
  var V = { v: 'mapa', mod: null, lec: null, clave: '', res: null, unidad: null, via: false };   // dónde está el alumno
  var R = null, runners = {}, tok = 0, prev3d = null;
  var E = { secOpen: {}, datos: D };

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function S() { return ES.store.get(); }
  function Nv() { return C150.Nav || null; }

  Object.defineProperty(Escuela, 'total', { get: function () { return D.total(); }, enumerable: true });
  Escuela.datos = D;
  Escuela.store = S;
  Escuela.cargar = function (id) { return D.cargar(id); };
  Escuela.state = function () { return { vista: V.v, mod: V.mod, lec: V.lec, clave: V.clave }; };
  Escuela.tituloLeccion = function (id) { var e = D.leccion(id); return e ? e.lec.titulo : ''; };

  /* ------------------------------------------------------------------ rutas */
  function parseRuta(rest) {
    rest = String(rest || '').replace(/^\/+|\/+$/g, '');
    if (!rest) return { v: 'mapa' };
    var p = rest.split('/'), a = p[0], b = p[1] || '';
    if (RESERVADAS.indexOf(a.toLowerCase()) >= 0) return { v: 'reservada', res: a.toLowerCase() };
    a = a.toUpperCase();
    var t = D.tipoId(a);
    if (t === 'modulo') return D.modulo(a) ? { v: 'modulo', mod: a } : { v: 'mapa' };
    if (t === 'unidad') { var u = D.unidad(a); return u ? { v: 'modulo', mod: u.mod.id, unidad: a } : { v: 'mapa' }; }
    if (t === 'leccion') return D.leccion(a) ? { v: 'leccion', lec: a, clave: b.toLowerCase() } : { v: 'mapa' };
    return { v: 'mapa' };
  }
  function rutaDe(v) {
    if (v.v === 'modulo') return 'escuela/' + v.mod;
    if (v.v === 'leccion') return 'escuela/' + v.lec + (v.clave ? '/' + v.clave : '');
    if (v.v === 'reservada') return 'escuela/' + v.res;
    return 'escuela';
  }
  Escuela.rutaLeccion = function (id) { return 'escuela/' + id; };

  /* ------------------------------------------------------------------ servicios para las lecciones y los componentes */
  function onDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function reduced() { return A && isFn(A.reducedMotion) ? !!A.reducedMotion() : !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function toast(text, tono) { if (A && isFn(A.showToast)) A.showToast({ text: text, kind: tono || 'info' }); }
  function ui() { return C150.UI || {}; }
  function glosario(termino, def) {
    var G = C150.Glossary;
    if (G && isFn(G.show) && G.show(termino)) return;
    if (K && isFn(K.dialog)) K.dialog({ title: termino, body: h('p', { text: def || 'Todavía no tenemos la definición de este término.' }), actions: [{ label: 'Entendido', variant: 'primary', close: true }] });
  }
  function annotate(list) {
    var G = C150.Glossary;
    if (!G || !isFn(G.annotate) || !list) return;
    for (var i = 0; i < list.length; i++) { try { G.annotate(list[i]); } catch (e) { /* un término raro no rompe la lección */ } }
  }
  function mirar(fn, label) { var n = Nv(); if (n && isFn(n.look)) n.look(fn, { label: label || '' }); else if (isFn(fn)) fn(); }
  function abrir(ruta, o) { if (isFn(ui().open)) ui().open(ruta, { returnLabel: o && o.returnLabel, run: o && o.run }); }
  function enlace(l) {
    if (!l || !l.tipo) return;
    var U = ui(), id = l.id;
    if (l.tipo === 'control' && isFn(U.showControl)) U.showControl(id);
    else if ((l.tipo === 'aire' || l.tipo === 'experimento') && isFn(U.openLab)) U.openLab(id);
    else if (l.tipo === 'leccion' && isFn(U.openLesson)) U.openLesson(id);
    else if (l.tipo === 'situacion' && isFn(U.openSituation)) U.openSituation(id);
    else if (l.tipo === 'escuela' || D.tipoId(id) === 'leccion') irLeccion(id);
    else if (l.tipo === 'pose' && A) mirar(function () { A.cc('setMainView', 'exterior'); A.syncMainView(); A.cc('poseExterior', id); }, 'Pose: ' + id);
  }

  /* ------------------------------------------------------------------ navegación (Nav) */
  function navTo(kind, route, fn, extra) { if (A && isFn(A.navTo)) A.navTo(kind, route, fn, extra); else fn(); }
  function refrescarNav() { var n = Nv(); if (n && isFn(n.refresh)) n.refresh(true); }
  function sheet() { if (isFn(ui().sheet)) ui().sheet('half'); }

  E.irModulo = function (id) { navTo('detail', 'escuela/' + id, function () { mostrar({ v: 'modulo', mod: id }); }); sheet(); };
  E.irMapa = function () { navTo('replace', 'escuela', function () { mostrar({ v: 'mapa' }); }); };
  E.irReservada = function (k) { navTo('detail', 'escuela/' + k, function () { mostrar({ v: 'reservada', res: k }); }); };
  /** clave: la etapa ('3', 'quiz'…) · idx: índice de etapa guardado (para "Continuar"). */
  function irLeccion(id, clave, idx) {
    var desde = V.v;
    var run = function () { mostrar({ v: 'leccion', lec: id, clave: clave || '', idx: idx, via: desde === 'modulo' || (desde === 'leccion' && V.via) }); };
    var ruta = 'escuela/' + id + (clave ? '/' + clave : '');
    if (desde === 'modulo') navTo('detail', ruta, run, { nest: true });
    else navTo('detail', ruta, run);
    sheet();
  }
  E.irLeccion = irLeccion;
  E.volverAlModulo = function () {
    var e = V.lec ? D.leccion(V.lec) : null, id = e ? e.mod.id : V.mod;
    if (!id) { E.irMapa(); return; }
    if (V.via && A && isFn(A.navUp) && A.navUp()) return;
    navTo('replace', 'escuela/' + id, function () { mostrar({ v: 'modulo', mod: id }); });
  };

  /* ------------------------------------------------------------------ dibujo */
  function limpiar() {
    if (R) { R.destruir(); R = null; }
    while (body.firstChild) body.removeChild(body.firstChild);
  }
  /** .app[data-es-view="mapa|modulo|leccion|reservada"]: gancho de CSS para cada pantalla de la Escuela (contrato v8). */
  function vistaAttr(off) { var ap = A && A.app; if (!ap || !ap.setAttribute || (!off && !active)) return; if (off) ap.removeAttribute('data-es-view'); else ap.setAttribute('data-es-view', V.v); }
  function alTope() { var p = A && A.panel; if (p) p.scrollTop = 0; }
  function depsLeccion(e) {
    return {
      api: A, store: S(), progress: C150.Progress, modulo: e.mod,
      navPaso: function (lecId, clave, fn) { navTo('replace', 'escuela/' + lecId + (clave ? '/' + clave : ''), fn); },
      volver: E.volverAlModulo,
      irLeccion: function (id) { irLeccion(id); },
      siguiente: function (id) { return D.siguiente(id); },
      anterior: function (id) { return D.anterior(id); },
      visorAbierto: function () { return !!(Visor && Visor.isOpen()); },
      visor: function (t, o) { return !!(Visor && Visor.open(t, o)); },
      enlace: enlace, mirar: mirar, abrir: abrir, glosario: glosario, annotate: annotate, toast: toast, reducedMotion: reduced, onDark: onDark,
      alMostrar: function (r, cambia) { V.clave = r.clave(); if (cambia) { alTope(); } refrescarNav(); }
    };
  }
  function montarLeccion(e, mod, claveOIdx) {
    var datos = mod && mod.lecs[e.id];
    if (!datos) { body.appendChild(Pan.error(E, 'La lección ' + e.id + ' no está en el archivo del módulo.', function () { mostrar(V, { forzar: true }); })); return; }
    registrarGlosario(mod);                  // los términos del módulo (y los de esta lección) ya están en el glosario ANTES de armar y marcar el texto
    var r = runners[e.id];
    var idx = 0;
    if (!r) r = runners[e.id] = Leccion.crear(depsLeccion(e), e, datos, 0);
    if (typeof claveOIdx === 'number') idx = Math.min(claveOIdx, r.pasos.length - 1);
    else { idx = Leccion.idxDe(r.pasos, claveOIdx || ''); if (idx < 0) idx = 0; }
    R = r;
    body.appendChild(r.el);
    r.mostrar(idx, { foco: false });
    if (active) r.reanudar(); else r.pausar();
    V.clave = r.clave();
  }
  function pintarLeccion(o) {
    var e = D.leccion(V.lec);
    if (!e) { body.appendChild(Pan.error(E, 'No encontramos esa lección.', E.irMapa)); return; }
    if (!D.disponible(e)) { body.appendChild(Pan.proximamente(E, e)); return; }
    var claveOIdx = typeof o.idx === 'number' ? o.idx : V.clave;
    var mod = D.cargarSync(e.mod.id);
    if (mod) { montarLeccion(e, mod, claveOIdx); return; }
    var mio = ++tok;
    body.appendChild(Pan.cargando(E, 'Cargando ' + e.mod.titulo + '…'));
    D.cargar(e.mod.id).then(function (m) {
      if (mio !== tok) return;
      limpiar(); montarLeccion(e, m, claveOIdx); refrescarNav();
    }, function (err) {
      if (mio !== tok) return;
      limpiar();
      body.appendChild(Pan.error(E, 'No pudimos cargar el módulo ' + e.mod.titulo + '. ' + (err && err.message ? err.message : ''), function () { mostrar(V, { forzar: true }); }));
    });
  }
  /** Muestra un estado sin tocar el historial. v: {v, mod, lec, clave, res, unidad, idx, via} */
  function mostrar(v, o) {
    o = o || {};
    if (!body) return;
    tok++;
    if (Visor && Visor.isOpen() && !o.keepVisor) Visor.close({ focus: false });      // otra pantalla: el visor no sobrevive
    var antes = V.v + '|' + V.mod + '|' + V.lec;
    V = { v: v.v || 'mapa', mod: v.mod || null, lec: v.lec || null, clave: v.clave || '', res: v.res || null, unidad: v.unidad || null, via: !!v.via };
    vistaAttr();
    limpiar();
    if (!D.indice()) {                       // sin índice inline (archivo suelto): se pide por fetch
      var mio = tok;
      body.appendChild(Pan.cargando(E, 'Cargando la escuela…'));
      D.cargarIndice().then(function (ok) {
        if (mio !== tok) return;
        if (ok) { mostrar(v, { forzar: true }); return; }
        limpiar(); body.appendChild(Pan.error(E, 'No pudimos cargar el índice de la Escuela.', function () { mostrar(v, { forzar: true }); }));
      });
      return;
    }
    if (V.v === 'modulo') { if (V.unidad) E.secOpen[V.unidad] = true; body.appendChild(Pan.modulo(E, V.mod)); }
    else if (V.v === 'leccion') pintarLeccion(v);
    else if (V.v === 'reservada') body.appendChild(Pan.reservada(E, V.res));
    else body.appendChild(Pan.mapa(E));
    if (V.v === 'modulo' && V.unidad) {
      var u = V.unidad;
      setTimeout(function () { var s = body.querySelector('[data-sec="es-u-' + u + '"]'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start' }); }, 30);
    } else if (antes !== V.v + '|' + V.mod + '|' + V.lec || o.forzar) alTope();
    if (A && isFn(A.kick)) A.kick();
    refrescarNav();
    if (Visor && V.v === 'leccion' && !o.keepVisor && active) Visor.resume(rutaDe(V));      // recarga a mitad de un MIRAR: vuelve a abrir el visor
  }
  E.repintar = function () { mostrar(V, { forzar: true }); };

  /* ------------------------------------------------------------------ exportar / importar */
  E.exportar = function () {
    try {
      var blob = new Blob([S().exportar()], { type: 'application/json' }), url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: 'progreso-escuela-cessna150.json', hidden: true });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Listo: guardamos tu progreso en un archivo.', 'good');
    } catch (e) { toast('No pudimos armar el archivo en este navegador.', 'warn'); }
  };
  E.importar = function (file) {
    if (!file || file.size > 1500000) { toast('Ese archivo es demasiado grande para ser un progreso.', 'warn'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var r = S().importar(String(fr.result || ''));
      if (!r.ok) { toast(r.error || 'No pudimos leer ese archivo.', 'warn'); return; }
      var P = C150.Progress, est = S().estado().lecciones;
      if (P && isFn(P.mark)) Object.keys(est).forEach(function (id) { if (est[id].estado === 'hecha') P.mark('escuela', id, null, { silent: true }); });
      toast('Progreso cargado: ' + r.lecciones + (r.lecciones === 1 ? ' lección' : ' lecciones') + '.', 'good');
      E.repintar();
    };
    fr.onerror = function () { toast('No pudimos leer ese archivo.', 'warn'); };
    fr.readAsText(file);
  };

  /* ------------------------------------------------------------------ API para ui.js */
  Escuela.mount = function (section, api) {
    if (mounted) return;
    mounted = true; A = api; K = C150.Kit; h = K.el; sec = section;
    E.K = K; E.h = h; E.icon = K.icon; E.store = S();
    sec.classList.add('es');
    if (Visor) { Visor.init(A); Visor.setRoute(function () { return rutaDe(V); }); }
    body = h('div', { 'class': 'es-view' });
    sec.appendChild(h('div', { 'class': 'es-root' }, body));
    mostrar({ v: 'mapa' });
  };
  Escuela.go = function (rest) {
    if (!mounted) return;
    var v = parseRuta(rest);
    if (v.v === 'leccion' && V.v === 'leccion' && V.lec === v.lec && R) { R.mostrar(Math.max(0, Leccion.idxDe(R.pasos, v.clave)), { foco: false }); V.clave = R.clave(); refrescarNav(); return; }
    mostrar(v);
  };
  Escuela.enter = function () {
    active = true;
    vistaAttr();
    if (A && !prev3d) {
      prev3d = { preset: isFn(A.currentPreset) ? A.currentPreset() : null, view: isFn(A.getMainView) ? A.getMainView() : null };
      try {
        if (prev3d.preset && prev3d.preset !== 'parked') A.applyPreset('parked');
        if (prev3d.view && prev3d.view !== 'cockpit') { A.cc('setMainView', 'cockpit'); A.syncMainView(); }
      } catch (e) { if (root.console) console.error('[Escuela] enter 3D', e); }
    }
    if (A && isFn(A.stageSuspend) && !(Visor && Visor.isOpen())) A.stageSuspend(true);      // la cabina 3D no está a la vista: Core deja de dibujar
    if (R) R.reanudar();
    if (A && isFn(A.kick)) A.kick();
  };
  Escuela.exit = function () {
    active = false;
    vistaAttr(true);
    if (R) R.pausar();
    if (Visor && Visor.isOpen()) Visor.close({ focus: false, keepRunning: true });
    if (A && isFn(A.stageSuspend)) A.stageSuspend(false);                                   // el escenario vuelve a la vista de la pestaña que sigue
    if (A && prev3d) {
      var p = prev3d; prev3d = null;
      try {
        if (p.preset && p.preset !== 'parked' && isFn(A.currentPreset) && A.currentPreset() === 'parked') A.applyPreset(p.preset);
        if (p.view && isFn(A.getMainView) && A.getMainView() !== p.view) { A.cc('setMainView', p.view === 'exterior' ? 'exterior' : 'cockpit'); A.syncMainView(); }
      } catch (e) { if (root.console) console.error('[Escuela] exit 3D', e); }
      if (isFn(A.kick)) A.kick();
    }
  };
  Escuela.slow = function (s) { if (active && R) R.slow(s); };

  /* ------------------------------------------------------------------ proveedor de Nav */
  function etiquetaPaso() {
    var p = R && R.pasoActual();
    if (!p) return '';
    return p.k === 'paso' ? 'paso ' + p.n : p.k === 'intro' ? 'introducción' : p.k === 'practica' ? 'práctica' : p.k === 'quiz' ? 'mini-quiz' : 'resumen';
  }
  function tituloVista() {
    var e = V.lec ? D.leccion(V.lec) : null, m = D.modulo(e ? e.mod.id : V.mod);
    return { e: e, m: m };
  }
  Escuela.navProvider = function () {
    return {
      label: function () {
        var F = C150.Nav && C150.Nav.fmtLabel, t = tituloVista();
        if (V.v === 'leccion' && t.e) return F ? F({ kind: 'Lección', title: t.e.lec.titulo, detail: etiquetaPaso() }) : t.e.lec.titulo;
        if (V.v === 'modulo' && t.m) return F ? F({ kind: 'Módulo', title: t.m.titulo }) : t.m.titulo;
        return 'Escuela';
      },
      crumbs: function () {
        var t = tituloVista(), c = ['Escuela'];
        if (V.v === 'reservada') return c.concat([V.res.charAt(0).toUpperCase() + V.res.slice(1)]);
        if (t.m) c.push(t.m.titulo);
        if (V.v === 'leccion' && t.e) { c.push(t.e.id.slice(4) + ' · ' + t.e.lec.titulo); var ep = etiquetaPaso(); if (ep) c.push(ep.charAt(0).toUpperCase() + ep.slice(1)); }
        return c;
      },
      route: function () { return rutaDe(V); },
      capture: function () { return { v: V.v, mod: V.mod, lec: V.lec, clave: R && V.v === 'leccion' ? R.clave() : V.clave, res: V.res, via: V.via, visor: Visor ? Visor.capture() : null }; },
      restore: function (o) {
        if (o && o.v) mostrar({ v: o.v, mod: o.mod, lec: o.lec, clave: o.clave, res: o.res, via: o.via });
        if (Visor && o && o.v === 'leccion') Visor.restore(o.visor || { open: false });
      },
      up: function () {
        if (V.v === 'mapa') return false;
        if (V.v === 'leccion') { var e = D.leccion(V.lec); mostrar({ v: 'modulo', mod: e ? e.mod.id : V.mod }); return true; }
        mostrar({ v: 'mapa' });
        return true;
      },
      inDetail: function () { return V.v !== 'mapa'; },
      active: function () { return !!(R && R.activa()); }
    };
  };

  /* ------------------------------------------------------------------ glosario y buscador */
  var glosRegistrado = {};
  /** Suma al glosario de la app los términos de TODAS las lecciones del módulo (una sola vez por módulo: es idempotente). Devuelve cuántos términos sumó.
   *  Se llama al cargarse el módulo y, otra vez por las dudas, justo antes de armar la lección (así el texto se marca con el glosario completo). */
  function registrarGlosario(m) {
    var G = C150.Glossary;
    if (!G || !isFn(G.register) || !m || !m.lecs || glosRegistrado[m.id]) return 0;
    var vistos = {}, lista = [];
    Object.keys(m.lecs).forEach(function (id) {
      arr(m.lecs[id].glosario).forEach(function (g) {
        if (g && g.termino && g.definicion && !vistos[g.termino.toLowerCase()]) { vistos[g.termino.toLowerCase()] = 1; lista.push({ termino: g.termino, definicion: g.definicion }); }
      });
    });
    if (lista.length) { try { G.register(lista); glosRegistrado[m.id] = true; } catch (e) { if (root.console) console.error('[Escuela] Glossary.register', e); return 0; } }
    else glosRegistrado[m.id] = true;
    return lista.length;
  }
  /** Para pantallas y pruebas: ¿ya se registraron los términos de ese módulo? · y registrarlos ahora si el módulo está a mano (inline o ya cargado). */
  Escuela.glosarioRegistrado = function (id) { return !!glosRegistrado[id]; };
  Escuela.asegurarGlosario = function (id) { var m = D.cargarSync(id); return m ? registrarGlosario(m) : 0; };
  D.onCargado(registrarGlosario);
  D.modulos().forEach(function (m) { var c = D.cargado(m.id); if (c) registrarGlosario(c); });

  var BUSCA = null;
  function listaBusqueda() {
    if (BUSCA) return BUSCA;
    BUSCA = { mods: D.modulos().slice(), unis: [], lecs: [] };
    D.modulos().forEach(function (m) { m.unidades.forEach(function (u) { BUSCA.unis.push({ u: u, m: m }); }); });
    BUSCA.lecs = D.lista();
    return BUSCA;
  }
  function abrirEscuela(ruta) { return function () { if (isFn(ui().open)) ui().open(ruta); if (isFn(ui().sheet)) ui().sheet('half'); }; }
  function buscar(q) {
    var Sr = C150.Search;
    if (!Sr || !D.indice()) return [];
    var L = listaBusqueda(), out = [], pag = /^\s*(?:p|pag|pág|pagina|página)\.?\s*(\d{1,4})\s*$/i.exec(String(q || ''));
    if (pag) {
      D.porPagina(+pag[1]).slice(0, 6).forEach(function (e) {
        out.push({ titulo: 'p. ' + pag[1] + ' · ' + e.lec.titulo, detalle: e.mod.titulo + ' · ' + e.id + ' · pp. ' + e.lec.paginas + (D.disponible(e) ? '' : ' · próximamente'), icono: 'cap', score: 160 - (D.disponible(e) ? 0 : 8), accion: abrirEscuela('escuela/' + e.id) });
      });
      return out;
    }
    Sr.rank(q, L.mods, function (m) { return [[m.titulo, 1], [m.id, 0.9], [m.resumen || '', 0.2]]; }).slice(0, 3).forEach(function (r) {
      out.push({ titulo: 'Escuela: ' + r.x.titulo, detalle: r.x.resumen, icono: r.x.icono || 'cap', score: r.score, accion: abrirEscuela('escuela/' + r.x.id) });
    });
    Sr.rank(q, L.unis, function (x) { return [[x.u.titulo, 1], [x.u.id, 0.7]]; }).slice(0, 3).forEach(function (r) {
      out.push({ titulo: 'Unidad: ' + r.x.u.titulo, detalle: r.x.m.titulo + ' · ' + r.x.u.id + (r.x.u.paginas ? ' · pp. ' + r.x.u.paginas : ''), icono: 'cap', score: r.score * 0.95, accion: abrirEscuela('escuela/' + r.x.u.id) });
    });
    Sr.rank(q, L.lecs, function (e) { return [[e.lec.titulo, 1], [e.id, 0.7]]; }).slice(0, 6).forEach(function (r) {
      var e = r.x, disp = D.disponible(e);
      out.push({ titulo: 'Lección: ' + e.lec.titulo, detalle: e.mod.titulo + ' · ' + e.id + (e.lec.paginas ? ' · pp. ' + e.lec.paginas : '') + (disp ? '' : ' · próximamente'), icono: 'cap', score: r.score * (disp ? 1 : 0.8), accion: abrirEscuela('escuela/' + e.id) });
    });
    return out;
  }
  if (C150.Search && isFn(C150.Search.register)) {
    C150.Search.register({ id: 'escuela', label: 'Escuela: teoría para el examen', icon: 'cap', order: 6, max: 8, items: function (q) { try { return buscar(q); } catch (e) { return []; } } });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = Escuela;
})(root.C150);
