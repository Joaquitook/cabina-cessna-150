var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/store.js — C150.ESCUELA.store: el progreso de la Escuela, guardado en el dispositivo (localStorage 'c150.escuela.v1',
 * todo dentro de try/catch; si el almacenamiento está bloqueado sigue en memoria). Sin cuentas ni datos personales. Contrato v7 §3/§7.
 * Sin DOM: la lógica pura (estrellas, cajas de Leitner, racha, fusión, exportar/importar) se prueba en Node (tests/validate-escuela.js).
 *
 * Forma guardada (v1):
 *   { v:1,
 *     lecciones: { 'INT-01-01': { estado:'en-curso'|'hecha', estrellas:0..3, mejor:0..1, intentos:n, paso:n (índice del paso donde quedó),
 *                                 q:{i, ok, resp:[…]}|null (mini-quiz a medias), t:ms (último movimiento), min:n (minutos acreditados),
 *                                 h:['p2.0', 'pr.1'] (componentes ya hechos: ctx.key de cada uno) } },
 *     respuestas:{ 'INT-01-01:ab12cd34': { ok:n, mal:n, t:ms } },            // por pregunta (id estable calculado con el texto)
 *     mazo:      { 'INT-01-01:clasificar:3': { tipo, ref, caja:1..5, prox:'YYYY-MM-DD', t:ms } },   // repaso espaciado (cajas de Leitner)
 *     racha:     { dias:n, ultimo:'YYYY-MM-DD'|'' , gracia:'YYYY-Www'|'' , mejor:n },
 *     minutos:   { 'YYYY-MM-DD': n },                                        // minutos estudiados por día (para "esta semana")
 *     tarjetas:  { 'INT-03-02:0': { ef:2.5, n:0, due:20000, last:19999 } },   // repaso espaciado de las TARJETAS (SM-2 simple): clave 'lección:índice de la carta';
 *                                                                              //   ef facilidad (1.3–3.5) · n repasos seguidos bien · due y last = NÚMERO DE DÍA (Store.diaDe) del próximo repaso y del último
 *     libre:     { 'INT-01-01|p2.0|0': 'texto' },                              // lo escrito en los huecos LIBRES del componente `completar` (bitácora): clave 'lección|componente|hueco', texto ≤ 160, máx. 200;
 *                                                                              //   antes vivía en la clave aparte 'c150.escuela.libre.v1' (se migra una vez y se borra); sale en exportar / importar y se borra con reset
 *     insignias: { primera: ms, … },
 *     ultima:    { leccion:'INT-01-01', paso:n, t:ms } | null,                // "Continuar donde dejaste"
 *     prefs:     { mapa:'tarjetas'|'camino' } }
 *
 * API pura (Store.*): estrellas(frac, primerIntento) · cajaSiguiente(caja, acierto) · INTERVALOS · fechaLocal(ms) · sumarDias(fecha, n) ·
 *   diasEntre(a, b) · semanaDe(fecha) · rachaActualizar(racha, hoy) · rachaVigente(racha, hoy) · hashTexto(s) · vacio() · fusionar(a, b) · sanear(obj)
 * Instancia: Store.crear({storage?, now?}) → s  (el singleton es Store.s, creado perezosamente por Store.get()):
 *   s.estado() copia del estado                   s.lec(id) registro o null          s.setPaso(id, paso) · s.setQuizParcial(id, q|null)
 *   s.quiz(id, correctas, total) → {estrellas, primero}      registra un intento del mini-quiz (mejor, intentos, estrellas)
 *   s.marcarLista(id, {minutos}) → {estrellas, nueva, insignias:[ids nuevos]}      estado 'hecha'; suma racha, minutos e insignias
 *   s.respuesta(qid, ok)   s.ultima()   s.tocar(id, paso)   (mueve "ultima" y pasa la lección a 'en-curso' si estaba sin ver)
 *   s.mazoAgregar({id, tipo, ref}) · s.mazo() · s.vencidas(hoy?) · s.repasar(id, ok)
 *   TARJETAS (repaso espaciado de cartas con frente y dorso; Store.sm2 es la parte pura, probada en Node con números de día):
 *     Store.diaDe(ms) → número de día local (entero) · Store.diaDeFecha('YYYY-MM-DD') · Store.fechaDeDia(n) · Store.tarjetaId(leccion, idx) → 'INT-03-02:0'
 *     Store.CALIDAD = {sabia:5, medio:3, nosabia:1} · Store.sm2(registro|null, calidad 0..5 | 'sabia'|'medio'|'nosabia', hoyDia) → {ef, n, due, last}
 *     Store.tarjetasPendientes(registros, hoyDia) → [{leccion, idx, …, atraso}] (la parte pura de s.tarjetasVencidas)
 *     s.tarjeta(leccion, idx) → registro|null · s.tarjetaRepasar(leccion, idx, calidad) → registro nuevo · s.tarjetas() → copia de todos
 *     s.tarjetasDeLeccion(leccion) → {idx: registro} · s.tarjetasVencidas(hoyDia?) → [{leccion, idx, ef, n, due, last, atraso}] (la más atrasada primero;
 *       es lo que va a usar la pantalla "Repaso del día") · s.hoyDia()
 *   s.libre(clave) → texto | '' · s.libreGuardar(clave, texto) → texto guardado ('' borra) · s.libres() → copia de todos
 *   s.racha(hoy?) → días de racha vigente    s.minutosSemana(hoy?)      s.insignias() · s.otorgar(id) → bool
 *   s.exportar() → texto JSON    s.importar(texto) → {ok, error?, lecciones}      s.reset()      s.onChange(fn) → desuscribir
 *   s.pref(k, v?)  s.persistente
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Store = ES.store = ES.store || {};

  var KEY = 'c150.escuela.v1';
  var INTERVALOS = [1, 3, 7, 14, 30];       // días de cada caja de Leitner
  var BAD_KEY = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };
  var ID_LEC = /^[A-Z]{3}-\d{2}-\d{2}$/;
  Store.INTERVALOS = INTERVALOS;
  Store.INSIGNIAS = {
    'primera': { titulo: 'Primera lección', texto: 'Terminaste tu primera lección de la Escuela.' },
    'racha7': { titulo: 'Racha de 7 días', texto: 'Estudiaste siete días seguidos.' },
    'sin-errores': { titulo: 'Sin errores', texto: 'Un mini-quiz perfecto.' }
  };

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function okKey(k) { return typeof k === 'string' && k.length > 0 && k.length <= 120 && !BAD_KEY[k]; }

  /* ------------------------------------------------------------------ lógica pura */
  /** 1 estrella al terminar · 2 con 70 % o más · 3 con 100 % al primer intento. */
  Store.estrellas = function (frac, primerIntento) {
    frac = num(frac, 0);
    if (frac >= 0.999 && primerIntento) return 3;
    return frac >= 0.7 ? 2 : 1;
  };
  Store.cajaSiguiente = function (caja, acierto) { return acierto ? clamp(Math.round(num(caja, 1)) + 1, 1, 5) : 1; };

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  Store.fechaLocal = function (ms) { var d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  function aUTC(f) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  Store.diasEntre = function (a, b) { return Math.round((aUTC(b) - aUTC(a)) / 86400000); };
  Store.sumarDias = function (f, n) { var t = aUTC(f); if (isNaN(t)) return f; var d = new Date(t + n * 86400000); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); };
  /** Semana ISO ("2026-W44") de una fecha 'YYYY-MM-DD'. */
  Store.semanaDe = function (f) {
    var t = aUTC(f);
    if (isNaN(t)) return '';
    var d = new Date(t);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);      // el jueves de esa semana fija el año ISO
    var jueves = d.getTime(), y = d.getUTCFullYear();
    d.setUTCMonth(0, 1);
    if (d.getUTCDay() !== 4) d.setUTCMonth(0, 1 + ((4 - d.getUTCDay()) + 7) % 7);
    return y + '-W' + p2(1 + Math.ceil((jueves - d.getTime()) / 604800000));
  };
  /** Hubo actividad el día `hoy`: suma a la racha (un día de gracia por semana cubre un día sin estudiar). */
  Store.rachaActualizar = function (r, hoy) {
    r = isObj(r) ? r : {};
    var dias = num(r.dias, 0), ultimo = typeof r.ultimo === 'string' ? r.ultimo : '', gracia = typeof r.gracia === 'string' ? r.gracia : '';
    if (ultimo === hoy) return { dias: Math.max(dias, 1), ultimo: hoy, gracia: gracia, mejor: Math.max(num(r.mejor, 0), dias, 1) };
    var d = ultimo ? Store.diasEntre(ultimo, hoy) : NaN;
    if (d === 1) dias += 1;
    else if (d === 2 && gracia !== Store.semanaDe(Store.sumarDias(ultimo, 1))) { gracia = Store.semanaDe(Store.sumarDias(ultimo, 1)); dias += 1; }
    else dias = 1;
    return { dias: dias, ultimo: hoy, gracia: gracia, mejor: Math.max(num(r.mejor, 0), dias) };
  };
  /** Días de racha que siguen vigentes hoy (0 si pasó demasiado tiempo desde la última actividad). */
  Store.rachaVigente = function (r, hoy) {
    if (!isObj(r) || !r.ultimo) return 0;
    var d = Store.diasEntre(r.ultimo, hoy);
    if (d <= 1) return num(r.dias, 0);
    if (d === 2 && r.gracia !== Store.semanaDe(Store.sumarDias(r.ultimo, 1))) return num(r.dias, 0);
    return 0;
  };
  /** Hash corto y estable (8 hex) de un texto: id de pregunta, semilla del mezclado. */
  Store.hashTexto = function (s) {
    s = String(s); var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  };

  /* ------------------------------------------------------------------ tarjetas: repaso espaciado (SM-2 simplificado, puro)
   * Un registro por carta: { ef, n, due, last }. ef = facilidad (empieza en 2.5, nunca baja de 1.3); n = veces seguidas que la supiste; due = día en que toca
   * volver a verla; last = día del último repaso. Los días son NÚMEROS DE DÍA enteros (no fechas ni milisegundos): así las pruebas no dependen del reloj
   * ni de la zona horaria. El intervalo previo es due − last.
   *   calidad 5 (La sabía) · 3 (Más o menos) · 1 (No la sabía)  →  <3 reinicia: vuelve mañana; 1.er acierto 2 días (1 si fue "más o menos"), 2.º 6 días (3 si fue "más o menos"),
   *   después el intervalo anterior × ef (× 1.2 si fue "más o menos"). Siempre avanza al menos un día y nunca más de 365 (Store.DIAS_MAX).
 *   Una carta que todavía no toca (hoy < due) y se califica bien NO cambia (n, intervalo ni fecha): repasar de más no la adelanta. */
  var EF0 = 2.5, EF_MIN = 1.3, EF_MAX = 3.5, DIAS_MAX = 365;      // ningún intervalo pasa de un año: una carta nunca desaparece del repaso por un número desbordado
  Store.DIAS_MAX = DIAS_MAX;
  Store.CALIDAD = { sabia: 5, medio: 3, nosabia: 1 };
  var ID_TARJETA = /^[A-Z]{3}-\d{2}-\d{2}:\d{1,3}$/;
  Store.tarjetaId = function (leccion, idx) { return String(leccion) + ':' + Math.max(0, Math.floor(num(idx, 0))); };
  /** Número de día (entero) de la fecha LOCAL de `ms`: 2026-10-30 → 20756. Es la unidad de `due` y `last`. */
  Store.diaDe = function (ms) { var d = new Date(ms); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
  Store.diaDeFecha = function (f) { var t = aUTC(f); return isNaN(t) ? NaN : Math.round(t / 86400000); };
  Store.fechaDeDia = function (n) { var d = new Date(Math.round(num(n, 0)) * 86400000); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); };
  function saneTarjeta(r) {
    if (!isObj(r)) return null;
    var due = Math.round(num(r.due, NaN)), last = Math.round(num(r.last, NaN));
    if (isNaN(due) || isNaN(last) || due < 0 || last < 0 || last > 400000) return null;
    if (due > last + DIAS_MAX) due = last + DIAS_MAX;      // un registro con un intervalo desbordado (de una versión anterior) se recorta en vez de perderse
    if (due > 400000) return null;
    return { ef: Math.round(clamp(num(r.ef, EF0), EF_MIN, EF_MAX) * 100) / 100, n: clamp(Math.round(num(r.n, 0)), 0, 999), due: due, last: last };
  }
  Store.sm2 = function (rec, calidad, hoy) {
    hoy = Math.round(num(hoy, 0));
    var vieja = saneTarjeta(rec), r = vieja || { ef: EF0, n: 0, due: hoy, last: hoy };
    var q = typeof calidad === 'string' ? (Store.CALIDAD[calidad] !== undefined ? Store.CALIDAD[calidad] : 1) : clamp(Math.round(num(calidad, 0)), 0, 5);
    // repasar de más no la deja más sabida: una carta que todavía no toca y que se vuelve a calificar bien (la misma tarde, o unos días antes) queda exactamente igual;
    // si falla, sí vuelve mañana (el olvido es real aunque no tocara)
    if (vieja && hoy < vieja.due && q >= 3) return { ef: vieja.ef, n: vieja.n, due: vieja.due, last: vieja.last };
    var ef = Math.round(clamp(r.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), EF_MIN, EF_MAX) * 100) / 100;
    var prev = Math.max(1, r.due - r.last), n, dias;
    if (q < 3) { n = 0; dias = 1; }
    else {
      n = Math.min(999, r.n + 1);
      if (n === 1) dias = q === 3 ? 1 : 2;
      else if (n === 2) dias = q === 3 ? 3 : 6;
      else dias = q === 3 ? Math.max(prev + 1, Math.round(prev * 1.2)) : Math.max(prev + 1, Math.round(prev * ef));
    }
    return { ef: ef, n: n, due: hoy + Math.min(dias, DIAS_MAX), last: hoy };
  };
  /** Los registros que ya vencieron el día `hoy`, de mayor a menor atraso (y por clave si empatan). La pantalla "Repaso del día" arranca de acá. */
  Store.tarjetasPendientes = function (registros, hoy) {
    var out = [];
    if (!isObj(registros)) return out;
    Object.keys(registros).forEach(function (k) {
      var r = saneTarjeta(registros[k]);
      if (!ID_TARJETA.test(k) || !r || r.due > hoy) return;
      out.push({ leccion: k.slice(0, k.indexOf(':')), idx: +k.slice(k.indexOf(':') + 1), ef: r.ef, n: r.n, due: r.due, last: r.last, atraso: hoy - r.due });
    });
    out.sort(function (a, b) { return (b.atraso - a.atraso) || (a.leccion < b.leccion ? -1 : a.leccion > b.leccion ? 1 : a.idx - b.idx); });
    return out;
  };

  Store.vacio = function () {
    return { v: 1, lecciones: {}, respuestas: {}, mazo: {}, tarjetas: {}, libre: {}, racha: { dias: 0, ultimo: '', gracia: '', mejor: 0 }, minutos: {}, insignias: {}, ultima: null, prefs: {} };
  };

  /** Lo escrito en un hueco libre (la bitácora de INT-01-01): texto corto, sin espacios de más; vacío o no-texto → ''. */
  var LIBRE_MAX = 200, KEY_LIBRE_VIEJA = 'c150.escuela.libre.v1';
  function libreTexto(v) { return typeof v === 'string' ? v.trim().slice(0, 160) : ''; }
  Store.LIBRE_MAX = LIBRE_MAX;

  function saneLec(r) {
    if (!isObj(r)) return null;
    var o = { estado: r.estado === 'hecha' ? 'hecha' : 'en-curso', estrellas: clamp(Math.round(num(r.estrellas, 0)), 0, 3), mejor: clamp(num(r.mejor, 0), 0, 1),
      intentos: Math.max(0, Math.round(num(r.intentos, 0))), paso: Math.max(0, Math.round(num(r.paso, 0))), q: null, t: Math.max(0, num(r.t, 0)), min: Math.max(0, Math.round(num(r.min, 0))), h: [] };
    if (Array.isArray(r.h)) r.h.slice(0, 40).forEach(function (k) { if (typeof k === 'string' && /^[a-z0-9.]{1,16}$/.test(k) && o.h.indexOf(k) < 0) o.h.push(k); });
    if (isObj(r.q) && Array.isArray(r.q.resp)) o.q = { i: Math.max(0, Math.round(num(r.q.i, 0))), ok: Math.max(0, Math.round(num(r.q.ok, 0))), resp: r.q.resp.slice(0, 12).map(function (x) { return Math.round(num(x, -1)); }) };
    return o;
  }
  /** Devuelve un estado v1 limpio a partir de cualquier objeto (descarta claves raras y valores fuera de rango). */
  Store.sanear = function (o) {
    var s = Store.vacio();
    if (!isObj(o)) return s;
    if (isObj(o.lecciones)) for (var k in o.lecciones) { if (ID_LEC.test(k)) { var l = saneLec(o.lecciones[k]); if (l) s.lecciones[k] = l; } }
    if (isObj(o.respuestas)) for (var q in o.respuestas) { if (okKey(q) && isObj(o.respuestas[q])) s.respuestas[q] = { ok: Math.max(0, Math.round(num(o.respuestas[q].ok, 0))), mal: Math.max(0, Math.round(num(o.respuestas[q].mal, 0))), t: Math.max(0, num(o.respuestas[q].t, 0)) }; }
    if (isObj(o.mazo)) for (var m in o.mazo) {
      var e = o.mazo[m];
      if (okKey(m) && isObj(e) && typeof e.tipo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.prox || '')) s.mazo[m] = { tipo: e.tipo.slice(0, 30), ref: String(e.ref === undefined ? '' : e.ref).slice(0, 60), caja: clamp(Math.round(num(e.caja, 1)), 1, 5), prox: e.prox, t: Math.max(0, num(e.t, 0)) };
    }
    if (isObj(o.tarjetas)) for (var tk in o.tarjetas) { if (ID_TARJETA.test(tk)) { var tr = saneTarjeta(o.tarjetas[tk]); if (tr) s.tarjetas[tk] = tr; } }
    if (isObj(o.libre)) { var nl = 0; for (var lk in o.libre) { if (nl >= LIBRE_MAX) break; var lv = libreTexto(o.libre[lk]); if (okKey(lk) && lv) { s.libre[lk] = lv; nl++; } } }
    if (isObj(o.racha)) s.racha = { dias: Math.max(0, Math.round(num(o.racha.dias, 0))), ultimo: /^\d{4}-\d{2}-\d{2}$/.test(o.racha.ultimo || '') ? o.racha.ultimo : '', gracia: /^\d{4}-W\d{2}$/.test(o.racha.gracia || '') ? o.racha.gracia : '', mejor: Math.max(0, Math.round(num(o.racha.mejor, 0))) };
    if (isObj(o.minutos)) for (var d in o.minutos) { if (/^\d{4}-\d{2}-\d{2}$/.test(d)) s.minutos[d] = Math.max(0, Math.round(num(o.minutos[d], 0))); }
    if (isObj(o.insignias)) for (var n in o.insignias) { if (okKey(n)) s.insignias[n] = Math.max(0, num(o.insignias[n], 0)); }
    if (isObj(o.ultima) && ID_LEC.test(o.ultima.leccion || '')) s.ultima = { leccion: o.ultima.leccion, paso: Math.max(0, Math.round(num(o.ultima.paso, 0))), t: Math.max(0, num(o.ultima.t, 0)) };
    if (isObj(o.prefs) && (o.prefs.mapa === 'tarjetas' || o.prefs.mapa === 'camino')) s.prefs.mapa = o.prefs.mapa;
    return s;
  };
  /** Fusiona dos estados quedándose con lo mejor de cada uno (importar sin perder lo que ya hay). */
  Store.fusionar = function (a, b) {
    a = Store.sanear(a); b = Store.sanear(b);
    var s = Store.sanear(a), k;
    for (k in b.lecciones) {
      var x = s.lecciones[k], y = b.lecciones[k];
      if (!x) { s.lecciones[k] = y; continue; }
      var m = (y.estado === 'hecha' && x.estado !== 'hecha') ? y : (x.estado === 'hecha' && y.estado !== 'hecha') ? x : (y.t > x.t ? y : x);
      s.lecciones[k] = { estado: (x.estado === 'hecha' || y.estado === 'hecha') ? 'hecha' : 'en-curso', estrellas: Math.max(x.estrellas, y.estrellas), mejor: Math.max(x.mejor, y.mejor),
        intentos: Math.max(x.intentos, y.intentos), paso: m.paso, q: m.q, t: Math.max(x.t, y.t), min: Math.max(x.min, y.min),
        h: x.h.concat(y.h.filter(function (k) { return x.h.indexOf(k) < 0; })) };
    }
    for (k in b.respuestas) { var r1 = s.respuestas[k], r2 = b.respuestas[k]; s.respuestas[k] = r1 ? { ok: Math.max(r1.ok, r2.ok), mal: Math.max(r1.mal, r2.mal), t: Math.max(r1.t, r2.t) } : r2; }
    for (k in b.mazo) { if (!s.mazo[k] || b.mazo[k].t > s.mazo[k].t) s.mazo[k] = b.mazo[k]; }
    for (k in b.tarjetas) { if (!s.tarjetas[k] || b.tarjetas[k].last > s.tarjetas[k].last || (b.tarjetas[k].last === s.tarjetas[k].last && b.tarjetas[k].n > s.tarjetas[k].n)) s.tarjetas[k] = b.tarjetas[k]; }
    for (k in b.libre) { if (!s.libre[k] && Object.keys(s.libre).length < LIBRE_MAX) s.libre[k] = b.libre[k]; }      // lo escrito en este dispositivo manda; del otro se suma lo que acá falta
    if (b.racha.ultimo > s.racha.ultimo) s.racha = b.racha; else s.racha.mejor = Math.max(s.racha.mejor, b.racha.mejor);
    for (k in b.minutos) s.minutos[k] = Math.max(s.minutos[k] || 0, b.minutos[k]);
    for (k in b.insignias) if (!s.insignias[k] || b.insignias[k] < s.insignias[k]) s.insignias[k] = b.insignias[k];
    if (b.ultima && (!s.ultima || b.ultima.t > s.ultima.t)) s.ultima = b.ultima;
    if (b.prefs.mapa && !s.prefs.mapa) s.prefs.mapa = b.prefs.mapa;
    return s;
  };

  /* ------------------------------------------------------------------ instancia */
  Store.crear = function (opts) {
    opts = opts || {};
    var storage = opts.storage !== undefined ? opts.storage : (function () { try { return root.localStorage || null; } catch (e) { return null; } })();
    var nowFn = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var st = null, listeners = [], persist = true, viejaLibre = false;

    function leer() {
      try {
        var raw = storage && storage.getItem(KEY), est = raw ? Store.sanear(JSON.parse(raw)) : Store.vacio();
        // migración única: lo escrito en los huecos libres (bitácora) vivía en otra clave de localStorage, fuera del progreso: pasa adentro y la clave vieja se borra
        try {
          var rv = storage && storage.getItem(KEY_LIBRE_VIEJA);
          if (rv) {
            viejaLibre = true;
            var vo = JSON.parse(rv), vl = Store.sanear({ libre: vo }).libre;
            for (var vk in vl) if (!est.libre[vk] && Object.keys(est.libre).length < LIBRE_MAX) est.libre[vk] = vl[vk];
          }
        } catch (e2) { /* clave vieja ilegible: se descarta */ }
        return est;
      } catch (e) { persist = false; return Store.vacio(); }
    }
    function S() {
      if (!st) {
        st = leer();
        if (viejaLibre) { viejaLibre = false; guardar(); if (persist) { try { storage.removeItem(KEY_LIBRE_VIEJA); } catch (e) { /* idem */ } } }
      }
      return st;
    }
    function guardar() {
      try { if (storage) { storage.setItem(KEY, JSON.stringify(st)); persist = true; } else persist = false; } catch (e) { persist = false; }
    }
    function avisar(que) { listeners.slice().forEach(function (fn) { try { fn(que); } catch (e) { if (root.console) console.error('[Escuela.store]', e); } }); }
    function hoy() { return Store.fechaLocal(nowFn()); }
    function cambio(que) { guardar(); avisar(que); }

    var s = {
      get persistente() { return persist; },
      estado: function () { return JSON.parse(JSON.stringify(S())); },
      lec: function (id) { var r = S().lecciones[id]; return r ? JSON.parse(JSON.stringify(r)) : null; },
      /** El alumno está en la lección `id`, en el paso `paso`: queda como "en curso" y como "ultima" para Continuar. */
      tocar: function (id, paso) {
        if (!ID_LEC.test(id)) return;
        var r = S().lecciones[id];
        if (!r) r = S().lecciones[id] = { estado: 'en-curso', estrellas: 0, mejor: 0, intentos: 0, paso: 0, q: null, t: 0, min: 0, h: [] };
        r.paso = Math.max(0, Math.round(num(paso, 0))); r.t = nowFn();
        S().ultima = { leccion: id, paso: r.paso, t: r.t };
        cambio('tocar');
      },
      setPaso: function (id, paso) { s.tocar(id, paso); },
      /** El componente `key` (ctx.key) de la lección quedó hecho. */
      hecho: function (id, key) {
        var r = S().lecciones[id];
        if (!r) { s.tocar(id, 0); r = S().lecciones[id]; }
        if (typeof key !== 'string' || !/^[a-z0-9.]{1,16}$/.test(key) || r.h.length >= 40) return false;
        if (r.h.indexOf(key) < 0) { r.h.push(key); guardar(); }
        return true;
      },
      setQuizParcial: function (id, q) {
        var r = S().lecciones[id];
        if (!r) return;
        r.q = q && Array.isArray(q.resp) ? { i: q.i | 0, ok: q.ok | 0, resp: q.resp.slice(0, 12) } : null;
        guardar();
      },
      /** Un mini-quiz terminado: guarda el mejor resultado (nunca se resta) y cuenta el intento. */
      quiz: function (id, correctas, total) {
        var r = S().lecciones[id];
        if (!r) { s.tocar(id, 0); r = S().lecciones[id]; }
        var primero = r.intentos === 0, frac = total > 0 ? correctas / total : 1;
        var est = Store.estrellas(frac, primero);
        r.intentos += 1; r.mejor = Math.max(r.mejor, frac); r.estrellas = Math.max(r.estrellas, est); r.q = null; r.t = nowFn();
        var nuevas = [];
        if (total >= 3 && correctas === total && s.otorgar('sin-errores', true)) nuevas.push('sin-errores');
        cambio('quiz');
        return { estrellas: est, primero: primero, insignias: nuevas };
      },
      /** "Marcar como lista": estado 'hecha', al menos 1 estrella, racha, minutos e insignias. */
      marcarLista: function (id, o) {
        o = o || {};
        var r = S().lecciones[id];
        if (!r) { s.tocar(id, 0); r = S().lecciones[id]; }
        var nueva = r.estado !== 'hecha', t = nowFn(), f = Store.fechaLocal(t);
        r.estado = 'hecha'; r.estrellas = Math.max(r.estrellas, 1); r.q = null; r.t = t;
        var nuevas = [];
        if (nueva) {
          var m = Math.max(0, Math.round(num(o.minutos, 0)));
          r.min = m; S().minutos[f] = (S().minutos[f] || 0) + m;
          if (s.otorgar('primera', true)) nuevas.push('primera');
        }
        S().racha = Store.rachaActualizar(S().racha, f);
        if (S().racha.dias >= 7 && s.otorgar('racha7', true)) nuevas.push('racha7');
        S().ultima = { leccion: id, paso: r.paso, t: t };
        cambio('lista');
        return { estrellas: r.estrellas, nueva: nueva, insignias: nuevas };
      },
      respuesta: function (qid, ok) {
        if (!okKey(qid)) return;
        var r = S().respuestas[qid] || (S().respuestas[qid] = { ok: 0, mal: 0, t: 0 });
        if (ok) r.ok++; else r.mal++;
        r.t = nowFn(); guardar();
      },
      ultima: function () { var u = S().ultima; return u ? { leccion: u.leccion, paso: u.paso, t: u.t } : null; },

      /* repaso espaciado */
      mazoAgregar: function (it) {
        if (!it || !okKey(it.id) || typeof it.tipo !== 'string') return false;
        var e = S().mazo[it.id], f = hoy();
        S().mazo[it.id] = { tipo: it.tipo.slice(0, 30), ref: String(it.ref === undefined ? '' : it.ref).slice(0, 60), caja: 1, prox: Store.sumarDias(f, INTERVALOS[0]), t: nowFn() };
        cambio(e ? 'mazo' : 'mazo');
        return true;
      },
      mazo: function () { return JSON.parse(JSON.stringify(S().mazo)); },
      vencidas: function (f) { f = f || hoy(); var out = []; for (var k in S().mazo) if (S().mazo[k].prox <= f) out.push({ id: k, tipo: S().mazo[k].tipo, ref: S().mazo[k].ref, caja: S().mazo[k].caja, prox: S().mazo[k].prox }); return out; },
      repasar: function (id, ok) {
        var e = S().mazo[id];
        if (!e) return null;
        e.caja = Store.cajaSiguiente(e.caja, ok); e.prox = Store.sumarDias(hoy(), INTERVALOS[e.caja - 1]); e.t = nowFn();
        S().racha = Store.rachaActualizar(S().racha, hoy());
        cambio('repaso');
        return { caja: e.caja, prox: e.prox };
      },

      /* tarjetas (repaso espaciado de cartas; la lógica está en Store.sm2) */
      hoyDia: function () { return Store.diaDe(nowFn()); },
      tarjeta: function (leccion, idx) { var r = S().tarjetas[Store.tarjetaId(leccion, idx)]; return r ? { ef: r.ef, n: r.n, due: r.due, last: r.last } : null; },
      tarjetas: function () { return JSON.parse(JSON.stringify(S().tarjetas)); },
      tarjetasDeLeccion: function (leccion) {
        var out = {}, pre = String(leccion) + ':';
        for (var k in S().tarjetas) if (k.indexOf(pre) === 0) out[+k.slice(pre.length)] = { ef: S().tarjetas[k].ef, n: S().tarjetas[k].n, due: S().tarjetas[k].due, last: S().tarjetas[k].last };
        return out;
      },
      /** Califica una carta (calidad 5 / 3 / 1 o 'sabia' / 'medio' / 'nosabia'): reprograma su próximo repaso y cuenta como actividad del día. Devuelve el registro nuevo o null. */
      tarjetaRepasar: function (leccion, idx, calidad) {
        var k = Store.tarjetaId(leccion, idx);
        if (!ID_TARJETA.test(k)) return null;
        var hoyN = Store.diaDe(nowFn()), r = Store.sm2(S().tarjetas[k] || null, calidad, hoyN);
        S().tarjetas[k] = r;
        S().racha = Store.rachaActualizar(S().racha, hoy());
        cambio('tarjeta');
        return { ef: r.ef, n: r.n, due: r.due, last: r.last };
      },
      /** Cartas que ya tocan repasar (el día `hoyDia`, por defecto hoy), la más atrasada primero. */
      tarjetasVencidas: function (hoyN) { return Store.tarjetasPendientes(S().tarjetas, typeof hoyN === 'number' ? hoyN : Store.diaDe(nowFn())); },

      /* huecos libres (la bitácora de INT-01-01 y las frases propias): lo escrito se guarda acá, con el resto del progreso, así sale en exportar / importar y se borra con reset */
      libre: function (clave) { return okKey(clave) && typeof S().libre[clave] === 'string' ? S().libre[clave] : ''; },
      libres: function () { return JSON.parse(JSON.stringify(S().libre)); },
      /** Guarda (o borra, si el texto queda vacío) lo escrito en el hueco `clave`. No avisa a los oyentes (se llama en cada tecla). Devuelve el texto guardado. */
      libreGuardar: function (clave, texto) {
        if (!okKey(clave)) return '';
        var t = libreTexto(texto), L = S().libre;
        if (!t) { if (L[clave] === undefined) return ''; delete L[clave]; guardar(); return ''; }
        if (L[clave] === undefined && Object.keys(L).length >= LIBRE_MAX) delete L[Object.keys(L)[0]];
        L[clave] = t; guardar();
        return t;
      },

      /* racha, minutos e insignias */
      racha: function (f) { return Store.rachaVigente(S().racha, f || hoy()); },
      mejorRacha: function () { return S().racha.mejor; },
      minutosSemana: function (f) {
        f = f || hoy();
        var w = Store.semanaDe(f), n = 0;
        for (var k in S().minutos) if (Store.semanaDe(k) === w) n += S().minutos[k];
        return n;
      },
      insignias: function () { return JSON.parse(JSON.stringify(S().insignias)); },
      otorgar: function (id, silencioso) {
        if (!okKey(id) || S().insignias[id]) return false;
        S().insignias[id] = nowFn();
        if (!silencioso) cambio('insignia');
        return true;
      },

      pref: function (k, v) {
        if (v === undefined) return S().prefs[k];
        S().prefs[k] = v; guardar(); return v;
      },

      /* exportar / importar */
      exportar: function () { return JSON.stringify({ app: 'cabina-c150-escuela', v: 1, exportado: new Date(nowFn()).toISOString(), datos: S() }); },
      importar: function (txt) {
        var o;
        try { o = JSON.parse(String(txt)); } catch (e) { return { ok: false, error: 'El archivo no es un JSON válido.' }; }
        if (!isObj(o) || o.app !== 'cabina-c150-escuela' || o.v !== 1 || !isObj(o.datos)) return { ok: false, error: 'Este archivo no es un progreso de la Escuela.' };
        st = Store.fusionar(S(), o.datos);
        cambio('importar');
        return { ok: true, lecciones: Object.keys(st.lecciones).length };
      },
      reset: function () {
        st = Store.vacio(); viejaLibre = false;
        try { if (storage) storage.removeItem(KEY_LIBRE_VIEJA); } catch (e) { /* idem */ }      // la clave vieja de los huecos libres tampoco puede volver a la vida
        cambio('reset');
      },
      onChange: function (fn) { if (typeof fn !== 'function') return function () {}; listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
    };
    return s;
  };

  /** El singleton de la app (se crea al primer uso, así el almacenamiento ya está disponible). */
  Store.get = function () { if (!Store.s) Store.s = Store.crear(); return Store.s; };
})(root.C150);
