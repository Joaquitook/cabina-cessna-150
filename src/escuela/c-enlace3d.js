var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-enlace3d.js — componente `enlace3d` (3D): salta a la cabina, al laboratorio AIRE, al exterior o al simulador de vuelo en un estado dado
 * y vuelve a la lección en el mismo paso (contrato v7, E3; modelo de navegación del contrato v6, C150.Nav).
 *
 *   MIRAR  (visor 3D)   «mirá el altímetro / ese mando / el avión en esa pose»: se abre el VISOR 3D (src/escuela/visor.js, contrato v8) al costado o arriba de la
 *                      lección, con la cámara en ese mando / pose y una barra con la consigna y «Volver a la lección». Lo usan «Mirarlo» (controles) y «Ver en el
 *                      avión» (poses). Sin visor (harness viejo) cae al MIRAR de antes (ctx.mirar → Nav.look: sólo se mueve la cámara y aparece el chip).
 *   ABRIR  (Nav.push)  abre otra pantalla (ficha de un mando, experimento del laboratorio AIRE, checklist, situación, lección de la app) con la barra
 *                      "← Volver a Lección «…» · paso N" (ctx.abrir / ctx.enlace: la etiqueta la arma el proveedor de Nav de la Escuela).
 *   CONSIGNA           si el dato trae `consigna.cumple`, el componente mira el estado del simulador (handle.slow) y, cuando se cumple, se da por hecho solo
 *                      (ctx.done()). Sin `cumple` hay un botón «Ya lo hice»; sin consigna se da por hecho al usar cualquiera de los botones.
 *
 * ESQUEMA DE `datos` (canónico; los ids son los de la app: src/data/controls-*.js, exterior.js POSES, data/lab.js, situations, learning.js):
 *   { destino:'cabina'|'aire'|'exterior'|'vuelo',
 *     controles?:[id], poses?:[id], checklist?:id, situacion?:id, leccionApp?:id,
 *     aire?:{ experimento?:id, modo?:'tunel'|'vuelo', vista?:'lado'|'frente'|'arriba'|'tres-cuartos'|'persecucion', foco?:'wing'|'flaps'|'ailerons'|'elevator'|'rudder'|'tail'|'prop'|'wingtips'|'stall',
 *             capas?:['streamlines'|'propwash'|'vortices'|'pressure'|'forces'|'moments'|'trails'|'slowmo'], ias?:kt, aoa?:grados, flaps?:grados, seccion?:'ala' },
 *     preset?:'parked'|'runup'|'runway'|'cruise'|'approach',            escenario del avión al preparar (botón «Preparar el avión»)
 *     estado?:{ 'flaps':0, 'throttle':0.5, 'lights.beacon':true … },    ajustes del simulador al preparar (rutas del estado del Sim)
 *     consigna?:{ texto, cumple?:[{campo:'flaps', eq|ne|min|max|entre:[a,b], tol?}], aviso? },   cumple también puede ser {flaps:20, 'air.ias':{min:60}}
 *     nota?:'texto' }
 * Aliases que entiende normalizar (los esbozos del plan): control / resaltar (→ controles), pose (→ poses), situacionRelacionada (→ situacion), leccion (→ leccionApp),
 * experimento / modo / ias / aoa / vista / foco / capas sueltos (→ aire), destino 'cabina-y-exterior' o 'tunel', aire:'perfil' | 'wing' | 'stall' | 'prop' (una región o la
 * sección «El ala por dentro»), capas en español ('partículas', 'presión', 'fuerzas'…). Los ids que no existen en la app se descartan; si lo pedido no existía → null.
 * ES.enlace3d.referencias(datos) devuelve lo que el dato PIDE (sin descartar nada): tests/validate-escuela.js lo contrasta con los ids reales de la app.
 * Handle: destroy · pause · resume · slow(estado) · getState.
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes;
  if (!Mot) return;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(x) { return typeof x === 'string' ? x.trim() : (typeof x === 'number' && isFinite(x) ? String(x) : ''); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function num(x) { if (fin(x)) return x; var t = str(x).replace(',', '.'); return t !== '' && isFinite(+t) ? +t : null; }
  function slug(t) { t = String(t === undefined || t === null ? '' : t); if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function publica(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }
  function unicos(l) { var v = {}, o = []; l.forEach(function (x) { if (x && !v[x]) { v[x] = 1; o.push(x); } }); return o; }
  function lista(x) { return Array.isArray(x) ? x.map(str).filter(Boolean) : (str(x) ? [str(x)] : []); }

  /* ---- los ids reales de la app (los datos y exterior.js ya están cargados cuando esto corre, en el navegador y en Node) */
  function datosApp() { return C150.DATA || {}; }
  function ids(l) { return arr(l).map(function (x) { return x && x.id; }).filter(Boolean); }
  var REG = {
    controles: function () { return ids(datosApp().controls); },
    experimentos: function () { return ids(datosApp().labExperiments); },
    checklists: function () { return ids(datosApp().checklists); },
    situaciones: function () { return ids(datosApp().situations); },
    lecciones: function () { return ids(datosApp().lessons); },
    poses: function () { return ids(C150.Exterior && C150.Exterior.POSES); },
    presets: function () { var P = C150.Sim && C150.Sim.PRESETS; return P ? ['parked', 'runup', 'runway', 'cruise', 'approach', 'tunnel'].filter(function (k) { return !!P[k]; }) : ['parked', 'runup', 'runway', 'cruise', 'approach']; }
  };
  var VISTAS = ['lado', 'frente', 'arriba', 'tres-cuartos', 'persecucion'];
  var FOCOS = ['flaps', 'ailerons', 'elevator', 'rudder', 'tail', 'prop', 'wingtips', 'stall', 'wing'];
  var CAPAS = ['streamlines', 'propwash', 'vortices', 'pressure', 'forces', 'moments', 'trails', 'slowmo'];
  var CAPA_ES = { particulas: 'streamlines', flujo: 'streamlines', lineas: 'streamlines', corriente: 'streamlines', helice: 'propwash', chorro: 'propwash', vortices: 'vortices', remolinos: 'vortices',
    presion: 'pressure', fuerzas: 'forces', giros: 'moments', momentos: 'moments', estelas: 'trails', 'camara-lenta': 'slowmo' };
  var DESTINOS = { cabina: 'cabina', 'cabina-y-exterior': 'cabina', 'cabina-exterior': 'cabina', aire: 'aire', tunel: 'aire', laboratorio: 'aire', exterior: 'exterior', afuera: 'exterior', vuelo: 'vuelo', volar: 'vuelo' };
  var ESCENARIOS = { parked: 'Estacionado', runup: 'Listo en cabecera', runway: 'En pista', cruise: 'En vuelo', approach: 'En aproximación', tunnel: 'Túnel de viento' };
  function rutaOk(p) { return typeof p === 'string' && /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*){0,3}$/.test(p) && p.split('.').every(function (k) { return k !== 'constructor' && k !== 'prototype'; }); }
  function leer(s, ruta) {
    if (!s || !rutaOk(ruta)) return undefined;
    var o = s, k = ruta.split('.');
    for (var i = 0; i < k.length; i++) { if (o === null || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, k[i])) return undefined; o = o[k[i]]; }
    return o;
  }
  function estadoBase() { try { return C150.Sim && isFn(C150.Sim.createState) ? C150.Sim.createState() : null; } catch (e) { return null; } }

  /* ================================================================== lo que el dato pide (sin descartar nada) */
  function capasDe(l) { return unicos(lista(l).map(function (c) { var s = slug(c); return CAPAS.indexOf(c) >= 0 ? c : (CAPA_ES[s] || s); })); }
  function pedir(datos) {
    var d = esObj(datos) ? datos : {}, aireRaw = d.aire, a = esObj(aireRaw) ? aireRaw : {}, p = {};
    p.destino = DESTINOS[slug(d.destino)] || '';
    p.controles = unicos(lista(d.controles).concat(lista(d.control), lista(d.resaltar)));
    p.poses = unicos(lista(d.poses).concat(lista(d.pose)));
    p.checklist = str(d.checklist);
    p.situacion = str(d.situacion) || str(d.situacionRelacionada);
    p.leccionApp = str(d.leccionApp) || str(d.leccion);
    p.experimento = str(d.experimento) || str(a.experimento);
    p.aire = { modo: '', vista: '', foco: '', seccion: '', capas: capasDe(a.capas !== undefined ? a.capas : d.capas), ias: num(a.ias !== undefined ? a.ias : d.ias), aoa: num(a.aoa !== undefined ? a.aoa : d.aoa), flaps: num(a.flaps) };
    var m = str(a.modo) || str(d.modo), v = str(a.vista) || str(d.vista), f = str(a.foco) || str(d.foco);
    if (typeof aireRaw === 'string') {
      var r = str(aireRaw), rs = slug(r);
      if (rs === 'perfil' || rs === 'ala') { p.aire.seccion = 'ala'; f = f || 'wing'; }
      else if (VISTAS.indexOf(r) >= 0) v = v || r;
      else if (r === 'tunel' || r === 'vuelo') m = m || r;
      else f = f || r;
    }
    p.aire.modo = m; p.aire.vista = v; p.aire.foco = f; if (str(a.seccion)) p.aire.seccion = str(a.seccion);
    p.hayAire = !!(p.experimento || m || v || f || p.aire.seccion || p.aire.capas.length || p.aire.ias !== null || p.aire.aoa !== null || p.aire.flaps !== null);
    p.preset = str(d.preset);
    p.estado = esObj(d.estado) ? d.estado : null;
    var c = d.consigna;
    p.consigna = typeof c === 'string' ? { texto: str(c), cumple: [], aviso: '' } : (esObj(c) ? { texto: str(c.texto) || str(c.consigna), cumple: condiciones(c.cumple), aviso: publica(c.aviso) } : null);
    return p;
  }
  /** {campo, eq|ne|min|max|entre, tol?} o {flaps: 20, 'air.ias': {min: 60}} → [{campo, …}] */
  function condiciones(c) {
    var out = [];
    function una(campo, v, extra) {
      var o = { campo: campo };
      if (esObj(v)) { ['eq', 'ne', 'min', 'max', 'tol'].forEach(function (k) { if (v[k] !== undefined) o[k] = v[k]; }); if (Array.isArray(v.entre)) o.entre = v.entre; }
      else if (v !== undefined && !extra) o.eq = v;
      if (extra) { ['eq', 'ne', 'min', 'max', 'tol'].forEach(function (k) { if (extra[k] !== undefined) o[k] = extra[k]; }); if (Array.isArray(extra.entre)) o.entre = extra.entre; }
      out.push(o);
    }
    if (Array.isArray(c)) c.forEach(function (x) { if (esObj(x) && str(x.campo)) una(str(x.campo), undefined, x); });
    else if (esObj(c)) Object.keys(c).forEach(function (k) { una(k, c[k]); });
    return out;
  }
  function referencias(datos) { return pedir(datos); }

  /* ================================================================== normalizar (puro) */
  function normalizar(datos, ctx, comp) {
    try {
      if (!esObj(datos)) return null;
      var p = pedir(datos);
      var sabeControles = REG.controles(), sabePoses = REG.poses();
      var out = { destino: p.destino, controles: [], poses: [], checklist: '', situacion: '', leccionApp: '', aire: null, preset: '', estado: null, consigna: null, nota: publica(datos.nota) };
      var pidio = false;
      if (p.controles.length) { pidio = true; out.controles = p.controles.filter(function (x) { return sabeControles.indexOf(x) >= 0; }).slice(0, 8); }
      if (p.poses.length) { pidio = true; out.poses = p.poses.filter(function (x) { return sabePoses.indexOf(x) >= 0; }).slice(0, 6); }
      if (p.checklist) { pidio = true; if (REG.checklists().indexOf(p.checklist) >= 0) out.checklist = p.checklist; }
      if (p.situacion) { pidio = true; if (REG.situaciones().indexOf(p.situacion) >= 0) out.situacion = p.situacion; }
      if (p.leccionApp) { pidio = true; if (REG.lecciones().indexOf(p.leccionApp) >= 0) out.leccionApp = p.leccionApp; }
      if (p.hayAire) {
        pidio = true;
        var a = {}, ok = false;
        if (p.experimento && REG.experimentos().indexOf(p.experimento) >= 0) { a.experimento = p.experimento; ok = true; }
        if (p.aire.modo === 'tunel' || p.aire.modo === 'vuelo') { a.modo = p.aire.modo; ok = true; }
        if (VISTAS.indexOf(p.aire.vista) >= 0) { a.vista = p.aire.vista; ok = true; }
        if (FOCOS.indexOf(p.aire.foco) >= 0) { a.foco = p.aire.foco; ok = true; }
        if (p.aire.seccion === 'ala') { a.seccion = 'ala'; ok = true; }
        var cp = p.aire.capas.filter(function (x) { return CAPAS.indexOf(x) >= 0; });
        if (cp.length) { a.capas = cp; ok = true; }
        if (p.aire.ias !== null) { a.ias = p.aire.ias; ok = true; }
        if (p.aire.aoa !== null) { a.aoa = p.aire.aoa; ok = true; }
        if (p.aire.flaps !== null) { a.flaps = p.aire.flaps; ok = true; }
        if (ok) out.aire = a;
      }
      if (p.preset && REG.presets().indexOf(p.preset) >= 0) out.preset = p.preset;
      if (p.estado) {
        var base = estadoBase(), est = {};
        Object.keys(p.estado).forEach(function (k) { var v = p.estado[k]; if (rutaOk(k) && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') && (!base || leer(base, k) !== undefined)) est[k] = v; });
        if (Object.keys(est).length) out.estado = est;
      }
      if (p.consigna && p.consigna.texto) {
        var base2 = estadoBase();
        var cum = p.consigna.cumple.filter(function (c) { return rutaOk(c.campo) && (!base2 || leer(base2, c.campo) !== undefined); });
        out.consigna = { texto: p.consigna.texto, cumple: cum, aviso: p.consigna.aviso };
      }
      var hayAlgo = out.controles.length || out.poses.length || out.checklist || out.situacion || out.leccionApp || out.aire;
      if (!hayAlgo) {
        if (pidio) return null;                                                      // pidió cosas que la app no tiene
        if (!p.destino) return null;                                                 // ni destino ni nada reconocible
      }
      if (!out.destino) out.destino = out.aire && !out.controles.length ? 'aire' : (!out.controles.length && out.poses.length ? 'exterior' : 'cabina');
      return out;
    } catch (e) { return null; }
  }

  /** Evalúa las condiciones de una consigna contra el estado del simulador. */
  function cumple(cond, s) {
    if (!cond || !cond.length) return false;
    return cond.every(function (c) {
      var v = leer(s, c.campo);
      if (v === undefined) return false;
      if (c.eq !== undefined) {
        if (typeof c.eq === 'number' && typeof v === 'number') { var tol = fin(c.tol) ? c.tol : Math.max(0.01, Math.abs(c.eq) * 0.03); return Math.abs(v - c.eq) <= tol; }
        if (v !== c.eq) return false;
      }
      if (c.ne !== undefined && v === c.ne) return false;
      if (c.min !== undefined && !(typeof v === 'number' && v >= c.min)) return false;
      if (c.max !== undefined && !(typeof v === 'number' && v <= c.max)) return false;
      if (Array.isArray(c.entre) && c.entre.length === 2 && !(typeof v === 'number' && v >= c.entre[0] && v <= c.entre[1])) return false;
      return true;
    });
  }

  /* ================================================================== render */
  function nombreControl(id) { var l = arr(datosApp().controls); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].nombre || id; return id; }
  function tituloDe(lista, id, campo) { var l = arr(lista); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i][campo || 'titulo'] || l[i].nombre || id; return id; }
  function etiquetaPose(id) { var l = arr(C150.Exterior && C150.Exterior.POSES); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].etiqueta || id; return id; }

  function render(host, datos, ctx) {
    var h = ctx.h, K = ctx.Kit, A = ctx.api || null, UI = C150.UI || null;
    var armado = !!ctx.hecho, logrado = !!ctx.hecho, usado = !!ctx.hecho, racha = 0, poseActiva = false, pausado = false, vistoFalso = false, elYa = null, offLook = null, vistaAntes = null;
    var cons = datos.consigna;
    var elTask = null, elTaskT = null, elTaskBtn = null, visorMio = false, leyendaBase = '';

    function aviso(texto) { if (A && isFn(A.showToast)) A.showToast({ text: texto, kind: 'info' }); }
    function seguro(fn, nombre) { try { return fn(); } catch (e) { if (root.console) console.error('[Escuela] enlace3d ' + nombre, e); aviso('No pudimos abrir eso ahora. Probá desde la pestaña correspondiente.'); } return undefined; }
    function usar() { usado = true; if (!cons && isFn(ctx.done)) ctx.done(); }
    function armar() { armado = true; racha = 0; usar(); }

    function logro() {
      if (logrado) return;
      logrado = true; pintarTarea(); if (elYa) elYa.hidden = true;
      if (isFn(ctx.done)) ctx.done();
    }
    /** La leyenda del visor: la consigna mientras no se cumple (la lección puede quedar fuera de pantalla en el teléfono). */
    function leyenda(base) { return cons && !logrado ? 'Consigna: ' + cons.texto : (cons && logrado ? '¡Lo lograste! ' + (cons.aviso || '') : base); }
    function visorVivo() { var VS = C150.Escuela && C150.Escuela.visor; return visorMio && VS && isFn(VS.isOpen) && VS.isOpen() ? VS : null; }
    function pintarTarea() {
      var VS0 = visorVivo(); if (VS0) VS0.setCaption(leyenda(leyendaBase));
      if (!elTask) return;
      elTask.classList.toggle('is-ok', logrado);
      elTaskT.textContent = logrado ? '¡Lo lograste! ' + (cons.aviso || '') : cons.texto;
      if (elTaskBtn) elTaskBtn.hidden = logrado || !!(cons.cumple && cons.cumple.length);
    }
    function revisar(s) {
      if (!cons || !cons.cumple.length || logrado || !armado || pausado) return;
      if (!cumple(cons.cumple, s)) { vistoFalso = true; racha = 0; if (elYa) elYa.hidden = true; return; }
      if (!vistoFalso) { if (elYa) elYa.hidden = false; return; }       // ya estaba así antes de empezar: hay que cambiarlo y volver a dejarlo
      racha++;
      if (racha >= 3) logro();
    }

    /* ---- MIRAR / ABRIR */
    /** Abre el visor 3D con ese dato; false = no hay visor / 3D (entonces se usa el MIRAR de antes). */
    function abrirVisor(target, label, base, ev) {
      if (!isFn(ctx.visor)) return false;
      leyendaBase = base; visorMio = true;
      var ok = ctx.visor(target, { label: label, caption: leyenda(base), returnLabel: 'Volver a la lección', opener: ev && ev.currentTarget ? ev.currentTarget : null,
        onClose: function () { visorMio = false; soltarPose(); } });
      if (!ok) visorMio = false;
      return ok;
    }
    function resumenControl(id) { var l = arr(datosApp().controls); for (var i = 0; i < l.length; i++) if (l[i].id === id) return str(l[i].resumen); return ''; }
    function mirarControl(id, ev) {
      armar(); soltarPose();
      seguro(function () {
        var nom = nombreControl(id), r = resumenControl(id);
        if (abrirVisor({ control: id }, nom, r ? nom + ': ' + r : 'Mirá «' + nom + '» en la cabina. Arrastrá para girar la vista.', ev)) return;
        if (UI && isFn(UI.lookAt)) UI.lookAt(id);
        else if (isFn(ctx.mirar)) ctx.mirar(function () { if (A && isFn(A.cc)) A.cc('select', id, { focus: true }); }, { label: nombreControl(id) });
      }, 'mirar');
    }
    /** Una pose sostenida pone al simulador en "espejo" (la cabina se mueve igual que el avión): se suelta al volver a la vista anterior, al mirar otra cosa y al salir del paso. */
    function soltarPose() {
      if (!poseActiva) return;
      poseActiva = false;
      if (A && isFn(A.has) && A.has('clearPose')) { try { A.cc('clearPose'); } catch (e) { /* el avión ya no está */ } }
    }
    /** La vista principal de antes de mirar (pose / avión / cabina): si la vista se descarta sola (otro paso de la lección) no se deja la cámara afuera. */
    function recordarVista() {
      var N = C150.Nav, Co = C150.Core;
      if (!offLook && N && isFn(N.on)) offLook = N.on('look', function (e) {
        if (!e || e.active !== false) return;
        soltarPose();                                    // al volver a la vista anterior, y también si la vista se descarta sola (cambio de pestaña, otro paso, cámara movida a mano)
        var v = vistaAntes; vistaAntes = null;
        if (e.restored || !v || !A || !isFn(A.cc) || !Co || !isFn(Co.getMainView)) return;
        try {
          if (Co.getMainView() !== v && /^escuela/.test(N.currentRoute())) { A.cc('setMainView', v); if (isFn(A.syncMainView)) A.syncMainView(); }
        } catch (err) { /* sin 3D: nada que devolver */ }
      });
      if (vistaAntes === null && N && isFn(N.hasLook) && !N.hasLook() && Co && isFn(Co.getMainView)) { try { vistaAntes = Co.getMainView(); } catch (err) { vistaAntes = null; } }
    }
    function verPose(id, ev) {
      armar(); poseActiva = true;
      seguro(function () {
        if (abrirVisor({ pose: id }, etiquetaPose(id), 'Así se ve el avión: «' + etiquetaPose(id) + '». Arrastrá para girar alrededor.', ev)) return;
        recordarVista();
        ctx.mirar(function () {
          if (!A || !isFn(A.cc)) return;
          A.cc('setMainView', 'exterior'); if (isFn(A.syncMainView)) A.syncMainView();
          A.cc('poseExterior', id);
        }, { label: etiquetaPose(id) });
      }, 'pose');
    }
    function verAvion(ev) {
      armar();
      seguro(function () {
        if (abrirVisor({ vista: 'exterior' }, 'El avión', 'Mirá el avión desde afuera. Arrastrá para girar alrededor.', ev)) return;
        recordarVista();
        ctx.mirar(function () { if (A && isFn(A.cc)) { A.cc('setMainView', 'exterior'); if (isFn(A.syncMainView)) A.syncMainView(); } }, { label: 'el avión' });
      }, 'exterior');
    }
    function verCabina(ev) {
      armar();
      seguro(function () {
        if (abrirVisor({ vista: 'cabina', foco: 'panel' }, 'La cabina', 'Mirá el tablero de la cabina. Arrastrá para girar la vista.', ev)) return;
        recordarVista();
        ctx.mirar(function () { if (A && isFn(A.cc)) { A.cc('setMainView', 'cockpit'); if (isFn(A.syncMainView)) A.syncMainView(); A.cc('focusPreset', 'panel'); } }, { label: 'la cabina' }); }, 'cabina');
    }
    function abrir(ruta, extra) { armar(); seguro(function () { ctx.abrir(ruta, extra || {}); }, 'abrir'); }
    function prepararAvion() {
      armar();
      seguro(function () {
        if (datos.preset && A && isFn(A.applyPreset)) A.applyPreset(datos.preset);
        if (datos.estado && A && isFn(A.setInput)) Object.keys(datos.estado).forEach(function (k) { A.setInput(k, datos.estado[k]); });
      }, 'preparar');
      if (!cons) return;
      aviso('Listo: el avión quedó preparado. Ahora hacelo vos.');
    }
    function abrirAire(a) {
      armar();
      if (a.experimento) { abrir('aire/' + a.experimento); return; }
      abrir('aire', { run: function () {
        var L = C150.Lab;
        if (!L) return;
        try {
          if (a.modo && isFn(L.setLabMode)) L.setLabMode(a.modo);
          if ((a.ias !== undefined || a.aoa !== undefined || a.flaps !== undefined) && isFn(L.setTunel)) L.setTunel({ ias: a.ias, aoa: a.aoa, flaps: a.flaps });
          if (a.capas && isFn(L.setCapas)) { var m = {}; CAPAS.forEach(function (c) { m[c] = a.capas.indexOf(c) >= 0; }); L.setCapas(m); }
          if (a.foco && isFn(L.setFoco)) L.setFoco(a.foco); else if (a.vista && isFn(L.setView)) L.setView(a.vista);
          if (a.seccion && isFn(L.irA)) L.irA(a.seccion === 'ala' ? 'ala' : a.seccion);
        } catch (e) { if (root.console) console.error('[Escuela] enlace3d aire', e); }
      } });
    }

    /* ---- dibujo */
    var boton = function (o) { return K.button(o); };
    var primero = true;
    function variante() { if (primero) { primero = false; return 'primary'; } return 'secondary'; }
    var partes = [];
    var lead = datos.destino === 'aire' ? 'Esto se ve mejor en el laboratorio del aire. Se abre en otra pantalla y, cuando termines, volvés a este mismo paso de la lección.'
      : datos.destino === 'exterior' ? 'Mirá el avión desde afuera: la cámara se mueve, pero seguís en la lección.'
      : datos.destino === 'vuelo' ? 'Esto se practica volando. Se abre en otra pantalla y, cuando termines, volvés a este mismo paso.'
      : 'Mirarlo abre el visor 3D al lado de la lección: no te saca de acá y lo cerrás cuando quieras. La ficha completa te lleva a otra pantalla, pero volvés con un toque.';
    partes.push(h('p', { 'class': 'es-note es-3d-lead', text: lead }));

    if (datos.controles.length) {
      partes.push(h('ul', { 'class': 'es-3d-list', 'aria-label': 'Mandos para mirar' }, datos.controles.map(function (id) {
        return h('li', { 'class': 'es-3d-row' },
          h('span', { 'class': 'es-3d-n' }, h('span', { 'class': 'es-3d-ico', 'aria-hidden': 'true' }, ctx.icon('cabin')), h('span', { text: nombreControl(id) })),
          h('span', { 'class': 'es-3d-b' },
            boton({ label: 'Mirarlo', icon: 'target', size: 'small', variant: variante(), ariaLabel: 'Mirar en la cabina: ' + nombreControl(id), onClick: function (ev) { mirarControl(id, ev); } }),
            boton({ label: 'Ver la ficha completa', icon: 'list', size: 'small', variant: 'ghost', ariaLabel: 'Ver la ficha completa de ' + nombreControl(id), onClick: function () { abrir('cabina/' + id); } })));
      })));
    }
    if (datos.poses.length) {
      partes.push(h('div', { 'class': 'es-3d-grp' }, h('p', { 'class': 'es-meta', text: 'VER EN EL AVIÓN, DESDE AFUERA' }),
        h('div', { 'class': 'es-3d-poses' }, datos.poses.map(function (id) { return boton({ label: etiquetaPose(id), icon: 'plane', size: 'small', variant: variante(), onClick: function (ev) { verPose(id, ev); } }); }))));
    }
    var acciones = [];
    if (datos.preset || datos.estado) acciones.push(boton({ label: 'Preparar el avión' + (datos.preset ? ': ' + (ESCENARIOS[datos.preset] || datos.preset).toLowerCase() : ''), icon: 'reset', size: 'small', variant: cons ? 'primary' : 'secondary', onClick: prepararAvion }));
    if (datos.aire) {
      var a = datos.aire;
      acciones.push(boton({ label: a.experimento ? 'Abrir el experimento «' + tituloDe(datosApp().labExperiments, a.experimento) + '»' : 'Abrir el laboratorio del aire', icon: 'wind', size: 'small', variant: variante(), onClick: function () { abrirAire(a); } }));
    }
    if (datos.checklist) acciones.push(boton({ label: 'Abrir la checklist «' + tituloDe(datosApp().checklists, datos.checklist) + '»', icon: 'checklist', size: 'small', variant: variante(), onClick: function () { abrir('checklists/' + datos.checklist); } }));
    if (datos.situacion) acciones.push(boton({ label: 'Practicar la situación «' + tituloDe(datosApp().situations, datos.situacion) + '»', icon: 'flag', size: 'small', variant: variante(), onClick: function () { armar(); seguro(function () { ctx.enlace({ tipo: 'situacion', id: datos.situacion }); }, 'situacion'); } }));
    if (datos.leccionApp) acciones.push(boton({ label: 'Ver la lección «' + tituloDe(datosApp().lessons, datos.leccionApp) + '»', icon: 'book', size: 'small', variant: variante(), onClick: function () { armar(); seguro(function () { ctx.enlace({ tipo: 'leccion', id: datos.leccionApp }); }, 'leccion'); } }));
    if (datos.destino === 'vuelo' && !datos.situacion) acciones.push(boton({ label: 'Ir a volar', icon: 'plane', size: 'small', variant: variante(), onClick: function () { abrir('volar'); } }));
    if (!datos.controles.length && !datos.poses.length && !datos.aire && !datos.checklist && !datos.situacion && !datos.leccionApp) {
      if (datos.destino === 'exterior') acciones.push(boton({ label: 'Ver el avión desde afuera', icon: 'plane', size: 'small', variant: variante(), onClick: function (ev) { verAvion(ev); } }));
      else if (datos.destino === 'cabina') acciones.push(boton({ label: 'Mirar la cabina', icon: 'cabin', size: 'small', variant: variante(), onClick: function (ev) { verCabina(ev); } }));
    }
    if (acciones.length) partes.push(h('div', { 'class': 'es-3d-acts' }, acciones));

    if (cons) {
      elTaskT = h('span', { 'class': 'es-task-t' });
      elTaskBtn = !cons.cumple.length ? K.button({ label: 'Ya lo hice', variant: 'ghost', size: 'small', icon: 'check', onClick: function () { armado = true; logro(); } }) : null;
      elTask = h('div', { 'class': 'es-task', role: 'status', 'aria-live': 'polite' }, ctx.icon('target'), elTaskT, elTaskBtn);
      pintarTarea();
      partes.push(elTask);
      if (cons.cumple.length) {
        partes.push(h('p', { 'class': 'es-note', text: 'Se comprueba sola: movelo directo en la cabina 3D o desde la ficha del mando.' }));
        elYa = h('p', { 'class': 'es-note', role: 'status', hidden: true, text: 'Ya está así. Cambialo y volvelo a dejar como pide la consigna para que lo compruebe.' });
        partes.push(elYa);
      }
    }
    if (datos.nota) partes.push(h('p', { 'class': 'es-note', text: datos.nota }));
    host.appendChild(h('div', { 'class': 'es-3d' }, partes));

    return {
      destroy: function () { var VS = visorVivo(); if (VS) VS.close({ focus: false }); soltarPose(); if (isFn(offLook)) { offLook(); offLook = null; } },
      pause: function () { pausado = true; soltarPose(); },
      resume: function () { pausado = false; racha = 0; var s = A && isFn(A.S) ? A.S() : null; if (s) revisar(s); },
      slow: function (s) { revisar(s); },
      getState: function () { return { armado: armado, logrado: logrado, usado: usado }; }
    };
  }

  Mot.register('enlace3d', { normalizar: normalizar, render: render });
  ES.enlace3d = { normalizar: normalizar, referencias: referencias, cumple: cumple, VISTAS: VISTAS, FOCOS: FOCOS, CAPAS: CAPAS, rutaOk: rutaOk };
})(root.C150);
