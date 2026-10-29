var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/datos.js — C150.ESCUELA.datos: el índice liviano de la Escuela (siempre en memoria) y la carga perezosa de cada módulo.
 * Contrato v7 §3. Sin DOM obligatorio (la parte pura se prueba en Node: tests/validate-escuela.js).
 *
 * El índice (src/data/escuela/indice.json, lo genera tools/escuela-indice.js) trae módulos > unidades > lecciones con
 *   { id, titulo, paginas, minutos, componentes:[tipos], enlaces:n, detalle:"completo"|"proximamente"|"pendiente" }.
 * Sólo las lecciones "completo" se pueden estudiar (tienen su texto en src/data/escuela/<ID>.json); las otras muestran "Próximamente".
 *
 *   D.iniciar()               lee el índice del bloque <script type="application/json" id="escuela-indice"> (síncrono). Se llama solo al cargar.
 *   D.cargarIndice()          Promise: si no hubo bloque inline, lo pide por fetch (base + 'indice.json'). Resuelve true/false.
 *   D.setIndice(obj)          arma los mapas internos (lo usan los tests). Devuelve true si el objeto es un índice válido.
 *   D.indice() · D.modulos()  el índice crudo · lista de módulos     D.modulo(id) · D.unidad(id) · D.leccion(id)   entradas del índice
 *   D.lista()                 todas las lecciones en el orden del curso, cada una {id, mod, unidad, i, lec}
 *   D.total()                 lecciones disponibles ("completo"): alimenta C150.Escuela.total (etapa 6 de "Tu camino")
 *   D.totalesModulo(id)       {lecciones, disponibles, minutos, minutosDisp}
 *   D.siguiente(id) · D.anterior(id)   la lección disponible que sigue / precede en el orden del curso (o null)
 *   D.tipoId(s)               'modulo' | 'unidad' | 'leccion' | null según la forma del id (AER · AER-03 · AER-03-02)
 *   D.paginas(rango) → [a, b] | null      '1–4' · '5' · '7-8'      D.rangos('524–525, 527') → [[524, 525], [527, 527]] | null
 *   D.porPagina(n) → [entradas del índice que cubren la página n]
 *
 *   D.cargarSync(id)          módulo ya cargado o leído del bloque inline (síncrono) → módulo | null
 *   D.cargar(id)              Promise → módulo (bloque inline si hay; si no fetch(base + id + '.json')); con caché. Rechaza con Error si falla.
 *   D.cargado(id)             módulo si ya está en memoria, si no null
 *   D.leccionDatos(id)        contenido de una lección ya cargada (objetivos, contenido, componentes, preguntas…) o null
 *   D.onCargado(fn)           fn(modulo) cada vez que un módulo se carga por primera vez (la Escuela registra ahí el glosario)
 *   D.base                    carpeta de los JSON por fetch (por defecto 'escuela/'; tests/ui-harness.html la cambia a '../src/data/escuela/')
 *
 * Un módulo cargado: { id, v, unidades:[{id, lecciones:[…]}], errata?, lecs:{ idLección → lección } } (lecs se arma al cargar).
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var D = ES.datos = ES.datos || {};

  var ix = null;            // { v, modulos:[…] }
  var mapMod = {}, mapUni = {}, mapLec = {}, flat = [], pageIdx = null;
  var cache = {};           // id → módulo cargado
  var pend = {};            // id → Promise en curso
  var listeners = [];
  var idxPromise = null;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  var BAD_KEY = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  D.base = (root.C150_ESCUELA_BASE && String(root.C150_ESCUELA_BASE)) || 'escuela/';

  /* ------------------------------------------------------------------ ids y páginas (puro) */
  D.tipoId = function (s) {
    s = String(s || '');
    if (/^[A-Z]{3}$/.test(s)) return 'modulo';
    if (/^[A-Z]{3}-\d{2}$/.test(s)) return 'unidad';
    if (/^[A-Z]{3}-\d{2}-\d{2}$/.test(s)) return 'leccion';
    return null;
  };
  D.paginas = function (r) {
    var m = String(r || '').match(/^\s*(\d{1,4})\s*(?:[–—-]\s*(\d{1,4}))?\s*$/);
    if (!m) return null;
    var a = +m[1], b = m[2] ? +m[2] : a;
    return b >= a ? [a, b] : [b, a];
  };
  /** Varios tramos: '524–525, 527' → [[524, 525], [527, 527]] (o null si algún tramo no se entiende). */
  D.rangos = function (r) {
    var out = [], parts = String(r || '').split(',');
    for (var i = 0; i < parts.length; i++) { var x = D.paginas(parts[i]); if (!x) return null; out.push(x); }
    return out.length ? out : null;
  };

  /* ------------------------------------------------------------------ índice */
  D.setIndice = function (obj) {
    if (!obj || !Array.isArray(obj.modulos)) return false;
    ix = obj; mapMod = {}; mapUni = {}; mapLec = {}; flat = []; pageIdx = null;
    obj.modulos.forEach(function (m) {
      mapMod[m.id] = m;
      arr(m.unidades).forEach(function (u) {
        mapUni[u.id] = { mod: m, unidad: u };
        arr(u.lecciones).forEach(function (l) {
          var e = { id: l.id, mod: m, unidad: u, i: flat.length, lec: l };
          mapLec[l.id] = e; flat.push(e);
        });
      });
    });
    return true;
  };
  D.iniciar = function () {
    if (ix) return true;
    var raw = readInline('indice');
    return raw ? D.setIndice(raw) : false;
  };
  D.cargarIndice = function () {
    if (ix) return Promise.resolve(true);
    if (D.iniciar()) return Promise.resolve(true);
    if (!idxPromise) {
      idxPromise = fetchJson('indice').then(function (o) { return D.setIndice(o); }).catch(function () { idxPromise = null; return false; });
    }
    return idxPromise;
  };
  D.indice = function () { return ix; };
  D.modulos = function () { return ix ? ix.modulos : []; };
  D.modulo = function (id) { return Object.prototype.hasOwnProperty.call(mapMod, id) ? mapMod[id] : null; };
  D.unidad = function (id) { return Object.prototype.hasOwnProperty.call(mapUni, id) ? mapUni[id] : null; };
  D.leccion = function (id) { return Object.prototype.hasOwnProperty.call(mapLec, id) ? mapLec[id] : null; };
  D.lista = function () { return flat; };
  function disponible(e) { return !!e && e.lec.detalle === 'completo'; }
  D.disponible = disponible;
  D.total = function () { var n = 0; for (var i = 0; i < flat.length; i++) if (disponible(flat[i])) n++; return n; };
  D.totalesModulo = function (id) {
    var m = D.modulo(id), r = { lecciones: 0, disponibles: 0, minutos: 0, minutosDisp: 0 };
    if (!m) return r;
    arr(m.unidades).forEach(function (u) {
      arr(u.lecciones).forEach(function (l) {
        r.lecciones++; r.minutos += l.minutos || 0;
        if (l.detalle === 'completo') { r.disponibles++; r.minutosDisp += l.minutos || 0; }
      });
    });
    return r;
  };
  D.siguiente = function (id) {
    var e = D.leccion(id);
    if (!e) return null;
    for (var i = e.i + 1; i < flat.length; i++) if (disponible(flat[i])) return flat[i];
    return null;
  };
  D.anterior = function (id) {
    var e = D.leccion(id);
    if (!e) return null;
    for (var i = e.i - 1; i >= 0; i--) if (disponible(flat[i])) return flat[i];
    return null;
  };
  D.porPagina = function (n) {
    n = +n;
    if (!(n > 0)) return [];
    if (!pageIdx) {
      pageIdx = [];
      flat.forEach(function (e) { var rs = D.rangos(e.lec.paginas); if (rs) rs.forEach(function (r) { pageIdx.push({ e: e, a: r[0], b: r[1] }); }); });
    }
    var out = [];
    for (var i = 0; i < pageIdx.length; i++) if (n >= pageIdx[i].a && n <= pageIdx[i].b && out.indexOf(pageIdx[i].e) < 0) out.push(pageIdx[i].e);
    return out;
  };

  /* ------------------------------------------------------------------ módulos (carga perezosa) */
  function readInline(id) {
    if (typeof document === 'undefined' || !document.getElementById) return null;
    var el = document.getElementById('escuela-' + id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { if (root.console) console.error('[Escuela] bloque escuela-' + id + ' inválido', e); return null; }
  }
  function fetchJson(id) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('Este navegador no puede pedir el archivo.'));
    return fetch(D.base + id + '.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('No se encontró escuela/' + id + '.json (' + r.status + ').');
      return r.json();
    });
  }
  /** Valida lo mínimo y arma lecs. Devuelve el módulo o null. */
  D.normalizarModulo = function (raw, id) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.unidades)) return null;
    var m = { id: raw.id || id, v: raw.v || 1, unidades: raw.unidades, errata: arr(raw.errata), lecs: {} };
    m.unidades.forEach(function (u) {
      arr(u && u.lecciones).forEach(function (l) { if (l && typeof l.id === 'string' && !BAD_KEY[l.id]) m.lecs[l.id] = l; });
    });
    return m;
  };
  function guardar(id, raw) {
    var m = D.normalizarModulo(raw, id);
    if (!m) return null;
    cache[id] = m;
    listeners.slice().forEach(function (fn) { try { fn(m); } catch (e) { if (root.console) console.error('[Escuela] onCargado', e); } });
    return m;
  }
  D.cargado = function (id) { return Object.prototype.hasOwnProperty.call(cache, id) ? cache[id] : null; };
  D.cargarSync = function (id) {
    if (!/^[A-Z]{3}$/.test(String(id))) return null;
    if (D.cargado(id)) return cache[id];
    var raw = readInline(id);
    return raw ? guardar(id, raw) : null;
  };
  D.cargar = function (id) {
    if (!/^[A-Z]{3}$/.test(String(id))) return Promise.reject(new Error('Módulo desconocido.'));
    var m = D.cargarSync(id);
    if (m) return Promise.resolve(m);
    if (pend[id]) return pend[id];
    pend[id] = fetchJson(id).then(function (raw) {
      delete pend[id];
      var mm = guardar(id, raw);
      if (!mm) throw new Error('El archivo del módulo ' + id + ' no tiene el formato esperado.');
      return mm;
    }, function (e) { delete pend[id]; throw e; });
    return pend[id];
  };
  D.leccionDatos = function (id) {
    var e = D.leccion(id);
    var m = e ? D.cargado(e.mod.id) : null;
    return m && m.lecs[id] ? m.lecs[id] : null;
  };
  D.onCargado = function (fn) { if (isFn(fn)) listeners.push(fn); };

  D.iniciar();
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(root.C150);
