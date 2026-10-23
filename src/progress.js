var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * progress.js — C150.Progress: qué hizo el alumno y cuál es su próximo paso (contrato UI/UX v4 §4).
 * Sin DOM (se prueba en Node con tests/validate-progress.js). Guarda en localStorage 'c150.progress.v1'
 * (todo dentro de try/catch; si el almacenamiento está bloqueado sigue en memoria durante la sesión).
 *
 *   Progress.mark(kind, id, data?, {silent}?)  → marca algo como hecho (idempotente; silent = no cuenta como última actividad ni avisa: para importar lo viejo). Devuelve la entrada {kind,id,t,d,n}.
 *        kinds: recorrido · leccion · checklist · mision · situacion · quiz (id 'best', data {score,total}: se guarda el MEJOR)
 *               cabina (control abierto) · aire (experimento) · onboarding · escuela (id de lección, reservado)
 *   Progress.touch(kind, id, data?) → "estuve acá" sin marcar como hecho (alimenta Continuar: p. ej. paso de una lección).
 *   Progress.get(kind, id)          → entrada o null.   Progress.list(kind) → entradas de ese tipo (más nuevas primero).
 *   Progress.last()                 → {kind, id, t, d, hecho, ruta, titulo} de la última actividad (o null).
 *   Progress.summary()              → { camino:[etapa…], porcentaje (0–100), siguiente (etapa|null), completas }
 *        etapa = { id, n, titulo, descripcion, hecho, total, fraccion, completa, ruta, requisitos:[{texto, hecho, actual, total, ruta}] }
 *        "Tu camino": 1 cabina · 2 vuelo (cómo vuela) · 3 procedimientos · 4 practica · 5 quiz (≥ 70 %) · 6 escuela (sólo si existe C150.Escuela)
 *   Progress.onChange(fn)           → fn({kind, id, entry, summary}) en cada cambio; devuelve la función para desuscribirse.
 *   Progress.reset()                → borra todo y avisa. Progress.persistent → true si usa localStorage.
 */
(function (C150) {
  'use strict';

  var KEY = 'c150.progress.v1';
  var ROUTE = {
    recorrido: '#recorrido', leccion: '#basico', checklist: '#checklists', mision: '#volar', situacion: '#volar',
    quiz: '#quiz', cabina: '#cabina', aire: '#aire', escuela: '#escuela', onboarding: '#inicio'
  };
  var NO_LAST = { onboarding: 1 };
  var QUIZ_PASS = 0.7;

  var state = null;                    // { v: 1, items: { kind: { id: {t, d, n} } }, last: {kind, id, t, d} | null }
  var listeners = [];
  var persistent = true;

  function blank() { return { v: 1, items: {}, last: null }; }
  var lastT = 0;
  /** Marca de tiempo estrictamente creciente (dos marcas en el mismo milisegundo igual quedan ordenadas). */
  function now() { var t = Date.now(); if (t <= lastT) t = lastT + 1; lastT = t; return t; }

  function read() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) return blank();
      var o = JSON.parse(raw);
      if (!o || o.v !== 1 || typeof o.items !== 'object' || !o.items) return blank();
      return o;
    } catch (e) { persistent = false; return blank(); }
  }
  function write() {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); persistent = true; }
    catch (e) { persistent = false; /* almacenamiento bloqueado: sigue en memoria */ }
  }
  function st() { if (!state) state = read(); return state; }

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function ratio(d) { return (d && num(d.total, 0) > 0) ? num(d.score, 0) / d.total : 0; }

  function entryOf(kind, id) {
    var k = st().items[kind];
    var e = k && Object.prototype.hasOwnProperty.call(k, id) ? k[id] : null;
    return e ? { kind: kind, id: id, t: e.t, d: e.d === undefined ? null : e.d, n: e.n || 1 } : null;
  }

  function fire(kind, id, entry) {
    var sum = null;
    for (var i = 0; i < listeners.length; i++) {
      try {
        if (sum === null) sum = Progress.summary();
        listeners[i]({ kind: kind, id: id, entry: entry, summary: sum });
      } catch (e) { if (root.console) console.error('[Progress] onChange', e); }
    }
  }

  function setLast(kind, id, d) {
    if (NO_LAST[kind]) return false;
    var l = st().last;
    var changed = !l || l.kind !== kind || l.id !== id;
    st().last = { kind: kind, id: id, t: now(), d: d === undefined ? null : d };
    return changed;
  }

  var Progress = {
    KEY: KEY,
    get persistent() { st(); return persistent; },

    mark: function (kind, id, data, opts) {
      kind = String(kind || ''); id = String(id === undefined || id === null ? '' : id);
      if (!kind || !id) return null;
      var s = st();
      var bucket = s.items[kind] || (s.items[kind] = {});
      var prev = Object.prototype.hasOwnProperty.call(bucket, id) ? bucket[id] : null;
      var changed = false;
      if (!prev) {
        bucket[id] = { t: now(), d: data === undefined ? null : data, n: 1 };
        changed = true;
      } else {
        prev.n = (prev.n || 1) + 1;
        if (kind === 'quiz') {
          if (ratio(data) > ratio(prev.d)) { prev.d = data; prev.t = now(); changed = true; }
        } else if (data !== undefined && JSON.stringify(data) !== JSON.stringify(prev.d)) { prev.d = data; changed = true; }
      }
      var silent = !!(opts && opts.silent);
      var lastChanged = silent ? false : setLast(kind, id, bucket[id].d);
      write();
      var entry = entryOf(kind, id);
      if (!silent && (changed || lastChanged)) fire(kind, id, entry);
      return entry;
    },

    touch: function (kind, id, data) {
      kind = String(kind || ''); id = String(id === undefined || id === null ? '' : id);
      if (!kind || !id) return null;
      var changed = setLast(kind, id, data);
      write();
      if (changed) fire(kind, id, entryOf(kind, id));
      return { kind: kind, id: id, t: st().last.t, d: st().last.d };
    },

    get: function (kind, id) { return entryOf(String(kind), String(id)); },

    list: function (kind) {
      var b = st().items[kind] || {};
      return Object.keys(b).map(function (id) { return entryOf(kind, id); }).sort(function (a, c) { return c.t - a.t; });
    },

    last: function () {
      var l = st().last;
      if (!l) return null;
      return {
        kind: l.kind, id: l.id, t: l.t, d: l.d, hecho: !!entryOf(l.kind, l.id),
        ruta: ROUTE[l.kind] || '#inicio', titulo: titleOf(l.kind, l.id)
      };
    },

    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },

    reset: function () {
      state = blank();
      write();
      fire('reset', '', null);
    },

    summary: function () { return buildSummary(); },

    /** Sólo para pruebas: vuelve a leer del almacenamiento. */
    _reload: function () { state = null; st(); }
  };

  /* ------------------------------------------------------------------ datos (C150.DATA) para totales y títulos */
  function D() { return (C150.DATA) || {}; }
  function idsOf(list) { return arr(list).filter(function (x) { return x && x.id; }).map(function (x) { return String(x.id); }); }

  /** Cuántos marcados de ese tipo cuentan: sólo los que existen hoy en los datos (si los datos están cargados). */
  function countKind(kind, known) {
    var items = Progress.list(kind);
    if (!known || !known.length) return items.length;
    var n = 0;
    items.forEach(function (e) { if (known.indexOf(e.id) >= 0) n++; });
    return n;
  }
  function titleOf(kind, id) {
    var data = D(), i, L;
    function find(list) { L = arr(list); for (i = 0; i < L.length; i++) if (L[i] && String(L[i].id) === id) return L[i]; return null; }
    var x = null;
    if (kind === 'leccion') { x = find(data.lessons); return x ? 'Lección: ' + x.titulo : 'Lecciones'; }
    if (kind === 'checklist') { x = find(data.checklists); return x ? 'Checklist: ' + x.titulo : 'Checklists'; }
    if (kind === 'mision') { x = find(data.missions); return x ? 'Misión: ' + x.titulo : 'Misiones'; }
    if (kind === 'situacion') { x = find(data.situations); return x ? 'Situación: ' + (x.titulo || x.nombre) : 'Situaciones'; }
    if (kind === 'aire') { x = find(data.labExperiments); return x ? 'Aire: ' + x.titulo : 'Laboratorio del aire'; }
    if (kind === 'cabina') { x = find(data.controls); return x ? x.nombre : 'La cabina'; }
    if (kind === 'recorrido') return 'Recorrido guiado';
    if (kind === 'quiz') return 'Quiz';
    if (kind === 'escuela') return 'Escuela';
    return '';
  }

  function req(texto, actual, total, ruta) {
    actual = Math.min(actual, total);
    return { texto: texto, hecho: actual >= total, actual: actual, total: total, ruta: ruta };
  }

  function buildSummary() {
    var data = D();
    var controls = idsOf(data.controls), lessons = idsOf(data.lessons), checklists = idsOf(data.checklists);
    var missions = idsOf(data.missions), situations = idsOf(data.situations), exps = idsOf(data.labExperiments);
    var nCtl = 10;
    var nLes = lessons.length || 12, nExp = Math.min(3, exps.length || 3), nCl = checklists.length || 5;
    var nMis = Math.min(3, missions.length || 3), nSit = Math.min(2, situations.length || 2);

    var opened = countKind('cabina', controls);
    var tour = Progress.get('recorrido', 'tour') ? 1 : 0;
    var lessonsDone = countKind('leccion', lessons), expsDone = countKind('aire', exps), clDone = countKind('checklist', checklists);
    var misDone = countKind('mision', missions), sitDone = countKind('situacion', situations);
    var qb = Progress.get('quiz', 'best');
    var qRatio = qb ? ratio(qb.d) : 0;

    var stages = [];
    function stage(id, titulo, descripcion, reqs, extra) {
      var tot = 0, acc = 0, hechos = 0;
      reqs.forEach(function (r) { tot++; acc += r.total ? r.actual / r.total : 0; if (r.hecho) hechos++; });
      var pend = null;
      for (var i = 0; i < reqs.length; i++) if (!reqs[i].hecho) { pend = reqs[i]; break; }
      var s = {
        id: id, n: stages.length + 1, titulo: titulo, descripcion: descripcion, hecho: hechos, total: tot,
        fraccion: tot ? acc / tot : 0, completa: hechos === tot, requisitos: reqs,
        ruta: pend ? pend.ruta : reqs[0].ruta
      };
      if (extra) for (var k in extra) s[k] = extra[k];
      stages.push(s);
    }
    stage('cabina', 'Conocé la cabina', 'Tocá los mandos y los instrumentos para saber qué es cada uno, y hacé el recorrido guiado.', [
      req('Abrí ' + nCtl + ' mandos o instrumentos', opened, nCtl, '#cabina'),
      req('Hacé el recorrido guiado', tour, 1, '#recorrido')
    ]);
    stage('vuelo', 'Entendé cómo vuela', 'Las lecciones y el laboratorio del aire te muestran por qué un avión se sostiene en el aire.', [
      req('Hacé las ' + nLes + ' lecciones', lessonsDone, nLes, '#basico'),
      req('Probá ' + nExp + ' experimentos del aire', expsDone, nExp, '#aire')
    ]);
    stage('procedimientos', 'Practicá los procedimientos', 'Las checklists son la lista de pasos que se sigue antes de cada maniobra. Se aprenden haciéndolas.', [
      req('Completá las ' + nCl + ' checklists', clDone, nCl, '#checklists')
    ]);
    stage('practica', 'Volá y resolvé situaciones', 'Pasá de mirar a hacer: misiones sencillas y situaciones reales con el simulador.', [
      req('Cumplí ' + nMis + ' misiones', misDone, nMis, '#volar'),
      req('Resolvé ' + nSit + ' situaciones', sitDone, nSit, '#volar')
    ]);
    stage('quiz', 'Probá lo que sabés', 'Un quiz corto. Con 70 % o más, esta etapa queda completa.', [
      req('Sacá 70 % o más en el quiz', qRatio >= QUIZ_PASS ? 1 : 0, 1, '#quiz')
    ], { mejor: qb ? { score: num(qb.d && qb.d.score, 0), total: num(qb.d && qb.d.total, 0) } : null });
    if (C150.Escuela) {
      var esTotal = num(C150.Escuela.total, 0) || 1;
      var esDone = Progress.list('escuela').length;
      stage('escuela', 'Estudiá el teórico', 'Escuela: las lecciones de teoría para el examen de piloto.', [
        req('Estudiá las lecciones de la Escuela', esDone, esTotal, '#escuela')
      ]);
    }

    var sum = 0, completas = 0, siguiente = null;
    stages.forEach(function (s) { sum += s.fraccion; if (s.completa) completas++; else if (!siguiente) siguiente = s; });
    return {
      camino: stages,
      porcentaje: stages.length ? Math.round(100 * sum / stages.length) : 0,
      completas: completas,
      siguiente: siguiente
    };
  }

  C150.Progress = Progress;
})(root.C150);
