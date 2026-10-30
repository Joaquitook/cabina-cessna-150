var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/modelos.js — C150.ESCUELA.modelos: el registro de MODELOS del componente `simulador` (contrato v7 §5, pasada 1 · E2).
 * Un modelo es una función PURA (corre también en Node) que recibe los valores de los controles y devuelve las salidas. Nada de DOM acá.
 *
 *   Modelos.register(id, def) → bool       Modelos.get(id) → def|null     Modelos.ids() → [id…]     Modelos.has(id)
 *   Modelos.calc(id, valores, params?) → {salida: valor, …}   completa con el valor por defecto los controles que falten (nunca tira: {} si el modelo no existe)
 *   Modelos.inferir(texto, aceptar?) → id|null      busca, en el orden de registro, el primer modelo cuyo `reconoce` coincide con el texto (sin tildes, en minúscula);
 *                                         el normalizar del simulador lo usa para los esbozos libres del plan (texto = datos + título del componente)
 *   Modelos.util   utilidades puras compartidas con la calculadora (horas, fechas, ISA, viento, redondeos, formato)
 *
 * Definición de un modelo (todo en español, como el resto de la Escuela):
 *   { nombre, resumen,
 *     reconoce:   [RegExp…]                    cómo se lo reconoce en un esbozo libre del plan
 *     controles:  [{ id, etiqueta, tipo:'rango'|'opcion'|'hora', min, max, paso, valor, unidad, opciones?, fijo?, opcional?, claves?:[RegExp],
 *                    marcas?:[{v,t}], zonas?:[{desde,hasta,tono:'ok|info|warn|bad'}], rapidos?:[{v,t}], ayuda? }]
 *                  opcional:true → sólo se muestra si el esbozo lo nombra (claves) o el esquema canónico lo pide; si no, se usa su `valor`
 *     salidas:    [{ id, etiqueta, unidad, dec, tipo:'num'|'texto'|'hora', barra?:{min,max,marca}, destacada? }]
 *     fn(v, params) → { <salida>: valor, …, _estado?:{tono, texto} }     v ya trae todos los controles; claves que empiezan con _ no se muestran
 *     umbrales?:  [{ salida, igual|mayor|menor, tono:'ok|info|warn|bad', texto }]     semáforo: la primera regla que cumple (o {siempre:true})
 *     grafico?:   { tipo:'linea', x:<id de control>, y:[<salida numérica>…], etiquetaX, etiquetaY, lineas?:[{x:<número|clave de salida>, texto}] }
 *     escenarios?:[{ nombre, valores:{ <control>: valor } }]       consigna?: { texto, salida, igual|mayor|menor|entre:[a,b] }   consignaSi?: RegExp
 *     desdeDatos?(datos) → { params?, escenarios?, controles? }     adapta claves propias del esbozo (franjas, casos, base…)
 *   }
 * Los modelos de partida (útiles para AER e INT): sustentacion-alfa · isa · factor-carga · viento-cruzado · porcentaje-umbral · clase-recreos · franjas ·
 *   riesgo-mitigacion · sustentacion-formula · bernoulli · venturi · velocidad-perdida · fuerzas-acelerador ·
 *   (AER-01/02) ala-presion · descomposicion-fuerza · alfa-actitud · flujo-alfa · verano-invierno · (AER-03) aviso-perdida · recuperacion-perdida.
 * La sustentación reutiliza la curva del simulador (C150.Sim.clCurve / stallAoa, las mismas que el túnel de AIRE) si existe; si no, una copia aproximada.
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var M = ES.modelos = ES.modelos || {};
  var reg = {}, orden = [];

  /* ================================================================== utilidades puras */
  var U = M.util = M.util || {};
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  /** Número desde un valor libre: acepta "−10", "3,5", "12 kt" (toma el primero). d si no se puede. */
  U.num = function (v, d) {
    if (typeof v === 'number') return isFinite(v) ? v : d;
    if (typeof v !== 'string') return d;
    var m = v.replace(/−/g, '-').replace(/(\d),(\d)/g, '$1.$2').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : d;
  };
  /** Minúsculas y sin tildes (para comparar textos libres). */
  U.norm = function (s) {
    s = String(s === undefined || s === null ? '' : s);
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ }
    return s.toLowerCase();
  };
  U.pad2 = function (n) { n = Math.floor(Math.abs(n)); return (n < 10 ? '0' : '') + n; };
  /** Redondea a `dec` decimales (evita el -0). */
  U.redond = function (v, dec) { var f = Math.pow(10, dec || 0), r = Math.round(v * f) / f; return r === 0 ? 0 : r; };
  /** Formato rioplatense: coma decimal y espacio fino para los miles. */
  U.fmt = function (v, dec) {
    if (!U.isNum(v)) return String(v === undefined || v === null ? '' : v);
    dec = dec || 0;
    var s = U.redond(v, dec).toFixed(dec), neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var p = s.split('.'), ent = p[0];
    if (ent.length > 4) ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '−' : '') + ent + (p[1] ? ',' + p[1] : '');
  };
  /** "19:30" → 1170 (minutos desde la medianoche) o null. */
  U.horaAMin = function (s) {
    var m = /^\s*(\d{1,2})\s*[:.h]\s*(\d{2})\s*$/.exec(String(s || ''));
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    return (h > 23 || mi > 59) ? null : h * 60 + mi;
  };
  /** 1170 → "19:30" (da la vuelta a las 24 h). */
  U.minAHora = function (min) { min = ((Math.round(min) % 1440) + 1440) % 1440; return U.pad2(min / 60) + ':' + U.pad2(min % 60); };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  U.MESES = MESES; U.DIAS = DIAS;
  /** "2026-03-15" → Date UTC (o null). */
  U.parseFecha = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (d.getUTCMonth() === +m[2] - 1) ? d : null;
  };
  U.fechaISO = function (d) { return d.getUTCFullYear() + '-' + U.pad2(d.getUTCMonth() + 1) + '-' + U.pad2(d.getUTCDate()); };
  U.fechaTexto = function (d, conDia) { return (conDia ? DIAS[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()] + ' de ' + d.getUTCFullYear(); };
  U.sumarDias = function (d, n) { return new Date(d.getTime() + n * 86400000); };
  /** Suma meses calendario; si el día no existe en el mes de llegada, cae en el último día de ese mes. */
  U.sumarMeses = function (d, n) {
    var y = d.getUTCFullYear(), mo = d.getUTCMonth() + n, dd = d.getUTCDate();
    var t = new Date(Date.UTC(y, mo, 1)), ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(dd, ult)));
  };
  U.diasEntre = function (a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); };
  /** Generador pseudoaleatorio con semilla numérica o de texto (mulberry32). */
  U.rng = function (semilla) {
    var s = 2166136261, t = String(semilla === undefined ? 1 : semilla), i;
    for (i = 0; i < t.length; i++) { s ^= t.charCodeAt(i); s = Math.imul(s, 16777619); }
    s = s >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** Elemento SVG (sólo en el navegador, se llama desde render): svg(tag, {attrs}, ...hijos). */
  U.svg = function (tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag), i, k;
    if (attrs) for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    for (i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'object' ? x : document.createTextNode(String(x))); });
      else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  /* ---- etiquetas de las figuras que nunca bajan de 11 px en pantalla (v9). El dibujo se escala al ancho de su caja: una etiqueta de 11 unidades en un SVG de 480
   * que se ve a 360 px mide 8 px. --dg-s = píxeles de pantalla por unidad del dibujo; el CSS (.dg-lbl, .dg-tx, .an-l…) usa max(base · s, 11px) / s. */
  U.ETIQUETA_MIN = 11;
  /** Píxeles de pantalla por unidad del dibujo: el SVG cabe entero (meet) en ancho × alto. 1 si no se puede medir. */
  U.escalaDibujo = function (ancho, alto, vbW, vbH) {
    if (!(ancho > 0) || !(vbW > 0)) return 1;
    var s = ancho / vbW;
    if (alto > 0 && vbH > 0) s = Math.min(s, alto / vbH);
    return Math.round(s * 1000) / 1000 || 1;
  };
  /** Tamaño en pantalla (px) de una etiqueta de `base` unidades cuando el dibujo está a escala `s`. */
  U.etiquetaEfectiva = function (base, s, min) { return Math.max(base * (s > 0 ? s : 1), min === undefined ? U.ETIQUETA_MIN : min); };
  /** Mantiene --dg-s al día en un <svg> (ResizeObserver, zoom incluido). Devuelve una función que corta la observación. */
  U.escalarEtiquetas = function (svg) {
    if (!svg || !svg.getBoundingClientRect || !svg.style) return function () {};
    var ro = null, t1 = 0, t2 = 0, ultimo = 0;
    function medir() {
      var r = svg.getBoundingClientRect(), vb = svg.viewBox && svg.viewBox.baseVal;
      if (!r.width || !vb || !vb.width) return;
      var s = U.escalaDibujo(r.width, r.height, vb.width, vb.height);
      if (Math.abs(s - ultimo) < 0.004) return;
      ultimo = s; svg.style.setProperty('--dg-s', String(s));
    }
    medir();
    t1 = setTimeout(medir, 60); t2 = setTimeout(medir, 400);
    if (typeof ResizeObserver === 'function') { try { ro = new ResizeObserver(medir); ro.observe(svg); } catch (e) { ro = null; } }
    if (!ro && typeof window !== 'undefined') window.addEventListener('resize', medir);
    svg._dgMedir = medir;
    return function () { clearTimeout(t1); clearTimeout(t2); if (ro) { try { ro.disconnect(); } catch (e) { /* idem */ } } else if (typeof window !== 'undefined') window.removeEventListener('resize', medir); };
  };
  /** Colores por tono (los tokens del tema: valen en claro y en oscuro). */
  U.TONO = { ok: 'var(--ok)', info: 'var(--info)', warn: 'var(--warn)', bad: 'var(--bad)' };
  /** Tono desde una palabra libre del plan ("rojo", "verde", "amarillo"…). */
  U.tonoDe = function (s) {
    var t = U.norm(s);
    return /rojo|bad|peligro|grave/.test(t) ? 'bad' : /amarill|warn|cuidado|media|naranj/.test(t) ? 'warn' : /verde|ok|bien|leve/.test(t) ? 'ok' : /azul|info/.test(t) ? 'info' : null;
  };

  /* ---- atmósfera estándar y viento */
  U.isaTemp = function (ft) { return 15 - 1.98 * ft / 1000; };
  U.isaPresion = function (ft) { return 1013.25 * Math.pow(Math.max(0.05, 1 - 6.8756e-6 * ft), 5.2559); };
  U.sigma = function (ft) { return Math.pow(Math.max(0.05, 1 - 6.8756e-6 * ft), 4.2559); };
  /** Descompone el viento respecto de la pista. pista y dirección en grados (de dónde sopla). cruzado ≥ 0; frente > 0 de frente, < 0 de cola. */
  U.viento = function (pista, dir, vel) {
    var a = (dir - pista) * Math.PI / 180, cr = vel * Math.sin(a), fr = vel * Math.cos(a);
    return { cruzado: Math.abs(cr), frente: fr, lado: Math.abs(cr) < 0.05 ? 'ninguno' : (cr > 0 ? 'derecha' : 'izquierda') };
  };

  /* ================================================================== curva de sustentación (la del simulador si está) */
  var curvas = {};
  function simOk() { var S = C150.Sim; return !!(S && typeof S.clCurve === 'function' && typeof S.stallAoa === 'function'); }
  function s01(x) { return x <= 0 ? 0 : (x >= 1 ? 1 : x * x * (3 - 2 * x)); }
  M.alfaPerdida = function (flaps) {
    flaps = U.clamp(U.num(flaps, 0), 0, 40);
    return simOk() ? C150.Sim.stallAoa(flaps) : 16 - flaps / 40;
  };
  /** CL del ala a un ángulo de ataque (°) y flaps (°). Interpola la curva del simulador; si no está, una aproximación igual de simple. */
  M.cl = function (alfa, flaps) {
    flaps = U.clamp(U.num(flaps, 0), 0, 40);
    if (simOk()) {
      var k = String(flaps), c = curvas[k] || (curvas[k] = C150.Sim.clCurve(flaps)), a = U.clamp(alfa, c[0].aoa, c[c.length - 1].aoa);
      var i = Math.min(c.length - 2, Math.max(0, Math.floor((a - c[0].aoa) / 0.5))), p = c[i], q = c[i + 1];
      return p.cl + (q.cl - p.cl) * (a - p.aoa) / ((q.aoa - p.aoa) || 1);
    }
    var aS = M.alfaPerdida(flaps), d = 0.45 * flaps / 40, cmax = 0.085 * aS + d;
    return alfa > aS ? cmax + (0.72 * cmax - cmax) * s01((alfa - aS) / 2) : 0.085 * alfa + d;
  };

  /* ================================================================== registro */
  M.register = function (id, def) {
    if (!id || !def || typeof def.fn !== 'function' || !Array.isArray(def.controles)) return false;
    if (!reg[id]) orden.push(id);
    reg[id] = def; def.id = id;
    return true;
  };
  M.has = function (id) { return Object.prototype.hasOwnProperty.call(reg, id); };
  M.get = function (id) { return M.has(id) ? reg[id] : null; };
  M.ids = function () { return orden.slice(); };
  M.calc = function (id, valores, params) {
    var d = M.get(id), v = {};
    if (!d) return {};
    d.controles.forEach(function (c) { v[c.id] = (valores && valores[c.id] !== undefined) ? valores[c.id] : c.valor; });
    try { return d.fn(v, params || {}) || {}; } catch (e) { return {}; }
  };
  M.inferir = function (texto, aceptar) {
    var t = U.norm(texto);
    // los modelos más específicos primero (prioridad menor); a igual prioridad, el orden de registro
    var ids = orden.slice().sort(function (a, b) { return ((reg[a].prioridad || 50) - (reg[b].prioridad || 50)) || (orden.indexOf(a) - orden.indexOf(b)); });
    for (var i = 0; i < ids.length; i++) {
      var r = reg[ids[i]].reconoce || [];
      for (var k = 0; k < r.length; k++) if (r[k].test(t) && (typeof aceptar !== 'function' || aceptar(ids[i]))) return ids[i];
    }
    return null;
  };

  /* ================================================================== los modelos */
  var PESO_KG = 725.7, SUP = 14.86;

  /* ---- sustentación y pérdida según el ángulo de ataque (AER) */
  M.register('sustentacion-alfa', {
    nombre: 'Sustentación y pérdida', resumen: 'Cuánto sostiene el ala según el ángulo de ataque, y cuándo deja de hacerlo.',
    prioridad: 90, reconoce: [/α|alfa|angulo de ataque|\bcl\b|bocina|buffet|vibracion|velocidades/],
    controles: [
      { id: 'alfa', etiqueta: 'Ángulo de ataque', tipo: 'rango', min: -4, max: 20, paso: 0.5, valor: 4, unidad: '°', claves: [/alfa|α|angulo/],
        marcas: [{ v: 0, t: '0°' }, { v: 8, t: '8°' }, { v: 16, t: '16°' }], zonas: [{ desde: -4, hasta: 14, tono: 'ok' }, { desde: 14, hasta: 16, tono: 'warn' }, { desde: 16, hasta: 20, tono: 'bad' }] },
      { id: 'vel', etiqueta: 'Velocidad indicada', tipo: 'rango', min: 40, max: 120, paso: 1, valor: 70, unidad: 'kt', claves: [/vel|ias|\bv\b/], rapidos: [{ v: 60, t: '60 kt' }, { v: 80, t: '80 kt' }, { v: 100, t: '100 kt' }] },
      { id: 'flaps', etiqueta: 'Flaps', tipo: 'rango', min: 0, max: 40, paso: 10, valor: 0, unidad: '°', opcional: true, claves: [/flaps?/] }
    ],
    salidas: [
      { id: 'cl', etiqueta: 'CL', dec: 2, destacada: true }, { id: 'sust', etiqueta: 'Sustentación', unidad: 'kg', dec: 0, destacada: true },
      { id: 'peso', etiqueta: 'Peso', unidad: 'kg', dec: 0 }, { id: 'dif', etiqueta: 'Sobra o falta', unidad: 'kg', dec: 0, signo: true }
    ],
    fn: function (v) {
      var f = U.num(v.flaps, 0), aS = M.alfaPerdida(f), cl = M.cl(v.alfa, f), q = 0.5 * 1.225 * Math.pow(v.vel * 0.514444, 2), L = q * SUP * cl / 9.80665;
      return { cl: cl, sust: L, peso: PESO_KG, dif: L - PESO_KG, aS: aS, nivel: v.alfa >= aS ? 'perdida' : (v.alfa >= aS - 1.5 ? 'bocina' : 'normal') };
    },
    umbrales: [
      { salida: 'nivel', igual: 'perdida', tono: 'bad', texto: 'En pérdida: pasaste el ángulo crítico y el ala ya no sostiene.' },
      { salida: 'nivel', igual: 'bocina', tono: 'warn', texto: 'Suena la bocina: estás a un paso del ángulo crítico.' },
      { siempre: true, tono: 'ok', texto: 'El flujo va pegado al ala: sostiene con margen.' }
    ],
    grafico: { tipo: 'linea', x: 'alfa', y: ['cl'], etiquetaX: 'Ángulo de ataque (°)', etiquetaY: 'CL', lineas: [{ x: 'aS', texto: 'pérdida' }] },
    escenarios: [{ nombre: 'Crucero', valores: { alfa: 2, vel: 100 } }, { nombre: 'Aproximación', valores: { alfa: 7, vel: 60 } }, { nombre: 'Casi en pérdida', valores: { alfa: 15, vel: 50 } }, { nombre: 'En pérdida', valores: { alfa: 17.5, vel: 47 } }],
    consigna: { texto: 'Llevá el ángulo de ataque hasta que el ala entre en pérdida.', salida: 'nivel', igual: 'perdida' }, consignaSi: /perdida|bocina|buffet/
  });

  /* ---- atmósfera estándar (AER · INS) */
  M.register('isa', {
    nombre: 'Atmósfera estándar', resumen: 'Cómo bajan la temperatura, la presión y la densidad con la altura.',
    prioridad: 40, reconoce: [/\bisa\b|atmosfera|presion.*altitud|altitud.*(presion|temperatura)|altitud de presion|qnh/],
    controles: [
      { id: 'altitud', etiqueta: 'Altitud', tipo: 'rango', min: 0, max: 15000, paso: 500, valor: 0, unidad: 'ft', claves: [/altitud|altura|elevacion/],
        marcas: [{ v: 0, t: '0' }, { v: 5000, t: '5 000' }, { v: 10000, t: '10 000' }, { v: 15000, t: '15 000' }], rapidos: [{ v: 0, t: 'Nivel del mar' }, { v: 3000, t: '3 000 ft' }, { v: 8000, t: '8 000 ft' }] },
      { id: 'dtemp', etiqueta: 'Día más cálido o frío que el estándar', tipo: 'rango', min: -20, max: 20, paso: 5, valor: 0, unidad: '°C', opcional: true, claves: [/desviacion|\bdt\b|delta|mas calido|mas frio|calor/], marcas: [{ v: -20, t: '−20' }, { v: 0, t: 'ISA' }, { v: 20, t: '+20' }] }
    ],
    salidas: [
      { id: 'temp', etiqueta: 'Temperatura', unidad: '°C', dec: 1, destacada: true }, { id: 'presion', etiqueta: 'Presión', unidad: 'hPa', dec: 0, destacada: true },
      { id: 'inhg', etiqueta: 'Presión', unidad: 'inHg', dec: 2 }, { id: 'densidad', etiqueta: 'Densidad', unidad: '% del nivel del mar', dec: 0, barra: { min: 0, max: 100 } }
    ],
    fn: function (v) {
      var h = v.altitud, p = U.isaPresion(h), t = U.isaTemp(h) + U.num(v.dtemp, 0);
      return { temp: t, presion: p, inhg: p / 33.8639, densidad: 100 * (p / 1013.25) * (288.15 / (t + 273.15)) };
    },
    grafico: { tipo: 'linea', x: 'altitud', y: ['presion', 'temp', 'densidad'], etiquetaX: 'Altitud (ft)', etiquetaY: '' },
    escenarios: [{ nombre: 'Nivel del mar', valores: { altitud: 0 } }, { nombre: 'Crucero 5 500 ft', valores: { altitud: 5500 } }, { nombre: 'Día de calor a 3 000 ft', valores: { altitud: 3000, dtemp: 15 } }]
  });

  /* ---- factor de carga en un viraje (AER-08) */
  M.register('factor-carga', {
    nombre: 'Factor de carga en el viraje', resumen: 'Cuántas veces "pesás" en un viraje coordinado y cuánto sube la velocidad de pérdida.',
    prioridad: 60, reconoce: [/factor de carga|alabeo|1\s*\/\s*cos|inclinador|\bg\b/],
    controles: [{ id: 'alabeo', etiqueta: 'Alabeo', tipo: 'rango', min: 0, max: 80, paso: 1, valor: 30, unidad: '°', claves: [/alabeo|inclinacion|banqueo/],
      marcas: [{ v: 0, t: '0°' }, { v: 30, t: '30°' }, { v: 45, t: '45°' }, { v: 60, t: '60°' }, { v: 80, t: '80°' }],
      zonas: [{ desde: 0, hasta: 45, tono: 'ok' }, { desde: 45, hasta: 60, tono: 'warn' }, { desde: 60, hasta: 80, tono: 'bad' }], rapidos: [{ v: 30, t: '30°' }, { v: 45, t: '45°' }, { v: 60, t: '60°' }] }],
    salidas: [
      { id: 'n', etiqueta: 'Factor de carga', unidad: 'g', dec: 2, destacada: true, barra: { min: 1, max: 6, marca: 2 } }, { id: 'vs', etiqueta: 'Pérdida a', unidad: 'kt', dec: 0, destacada: true },
      { id: 'pesoApp', etiqueta: 'Peso aparente', unidad: 'kg', dec: 0 }
    ],
    fn: function (v) { var n = 1 / Math.cos(U.clamp(v.alabeo, 0, 85) * Math.PI / 180); return { n: n, vs: 47 * Math.sqrt(n), pesoApp: PESO_KG * n }; },
    umbrales: [
      { salida: 'n', mayor: 2, tono: 'bad', texto: 'Más de 2 g: el ala carga el doble de peso y pierde mucho margen.' },
      { salida: 'n', mayor: 1.4, tono: 'warn', texto: 'Viraje fuerte (más de 45°): la pérdida llega bastante antes.' },
      { siempre: true, tono: 'ok', texto: 'Viraje suave: casi no se nota en el peso.' }
    ],
    grafico: { tipo: 'linea', x: 'alabeo', y: ['n'], etiquetaX: 'Alabeo (°)', etiquetaY: 'g' }
  });

  /* ---- componente de viento cruzado (INT · AER · PER) */
  M.register('viento-cruzado', {
    nombre: 'Viento cruzado', resumen: 'Qué parte del viento te empuja de costado y qué parte te frena o te empuja de atrás.',
    reconoce: [/viento cruzado|crosswind|componente.*viento|viento de frente/],
    controles: [
      { id: 'pista', etiqueta: 'Pista', tipo: 'rango', min: 1, max: 36, paso: 1, valor: 36, unidad: '', pad: 2, claves: [/pista|rumbo/], marcas: [{ v: 9, t: '09' }, { v: 18, t: '18' }, { v: 27, t: '27' }, { v: 36, t: '36' }] },
      { id: 'dir', etiqueta: 'Viento desde', tipo: 'rango', min: 0, max: 350, paso: 10, valor: 30, unidad: '°', claves: [/direccion|desde/] },
      { id: 'vel', etiqueta: 'Intensidad del viento', tipo: 'rango', min: 0, max: 35, paso: 1, valor: 15, unidad: 'kt', claves: [/intensidad|velocidad|vel/] }
    ],
    salidas: [
      { id: 'cruzado', etiqueta: 'Viento cruzado', unidad: 'kt', dec: 0, destacada: true, barra: { min: 0, max: 35, marca: 13 } },
      { id: 'frente', etiqueta: 'De frente (+) o de cola (−)', unidad: 'kt', dec: 0, destacada: true, signo: true }, { id: 'lado', etiqueta: 'Te llega por la', tipo: 'texto' }
    ],
    fn: function (v) {
      var w = U.viento(v.pista * 10, v.dir, v.vel);
      return { cruzado: w.cruzado, frente: w.frente, lado: w.lado === 'ninguno' ? 'proa' : w.lado };
    },
    umbrales: [
      { salida: 'cruzado', mayor: 13, tono: 'bad', texto: 'Más que el máximo demostrado del 150M (13 kt): no es para vos hoy.' },
      { salida: 'cruzado', mayor: 9.5, tono: 'warn', texto: 'Cerca del máximo demostrado (13 kt): hablalo con tu instructor.' },
      { siempre: true, tono: 'ok', texto: 'Cruzado moderado: seguí con los pies hasta que el avión esté parado.' }
    ],
    grafico: { tipo: 'linea', x: 'dir', y: ['cruzado'], etiquetaX: 'Viento desde (°)', etiquetaY: 'kt' },
    escenarios: [{ nombre: 'De frente', valores: { pista: 36, dir: 0, vel: 15 } }, { nombre: 'Cruzado puro', valores: { pista: 36, dir: 90, vel: 12 } }, { nombre: 'De cola', valores: { pista: 36, dir: 180, vel: 10 } }]
  });

  /* ---- el semáforo del porcentaje de aprobación (INT-02) */
  M.register('porcentaje-umbral', {
    nombre: 'Porcentaje de aprobación', resumen: 'Aciertos de un test y la marca del 75 %.',
    reconoce: [/aciertos|umbral/],
    controles: [
      { id: 'aciertos', etiqueta: 'Preguntas acertadas', tipo: 'rango', min: 0, max: 20, paso: 1, valor: 15, unidad: '', claves: [/acert|aciert/], marcas: [{ v: 0, t: '0' }, { v: 15, t: '15' }, { v: 20, t: '20' }], zonas: [{ desde: 0, hasta: 15, tono: 'bad' }, { desde: 15, hasta: 20, tono: 'ok' }] },
      { id: 'total', etiqueta: 'Preguntas del test', tipo: 'rango', min: 20, max: 20, paso: 1, valor: 20, unidad: '', fijo: true, claves: [/total|preguntas del test/] },
      { id: 'umbral', etiqueta: 'Mínimo para aprobar', tipo: 'rango', min: 75, max: 75, paso: 1, valor: 75, unidad: '%', fijo: true, claves: [/umbral|minimo/] }
    ],
    salidas: [
      { id: 'pct', etiqueta: 'Porcentaje', unidad: '%', dec: 0, destacada: true, barra: { min: 0, max: 100, marca: 75 } }, { id: 'faltan', etiqueta: 'Te faltan', unidad: 'aciertos', dec: 0 },
      { id: 'resultado', etiqueta: 'Resultado', tipo: 'texto' }
    ],
    fn: function (v) {
      var t = Math.max(1, v.total), pct = 100 * v.aciertos / t, ok = pct >= v.umbral;
      return { pct: pct, faltan: Math.max(0, Math.ceil(v.umbral * t / 100 - 1e-9) - v.aciertos), resultado: ok ? 'Aprobado' : 'A repasar',
        _estado: ok ? { tono: 'ok', texto: 'Aprobás: llegás al ' + v.umbral + ' % o más.' } : { tono: 'bad', texto: 'Todavía no: repasá las erradas y rendí el re-take.' } };
    },
    escenarios: [{ nombre: 'Justo el 75 %', valores: { aciertos: 15 } }, { nombre: 'Un acierto menos', valores: { aciertos: 14 } }, { nombre: 'Perfecto', valores: { aciertos: 20 } }]
  });

  /* ---- tu clase: recreos y hora de fin (INT-01) */
  M.register('clase-recreos', {
    nombre: 'Armá tu clase', resumen: 'Una clase de 40 minutos de estudio y 5 de recreo: cuántos recreos tiene y cuándo termina.',
    reconoce: [/recreo/],
    controles: [
      { id: 'inicio', etiqueta: 'Hora de inicio', tipo: 'hora', valor: '19:00', claves: [/inicio|hora/] },
      { id: 'duracion', etiqueta: 'Duración de la clase', tipo: 'rango', min: 60, max: 120, paso: 10, valor: 120, unidad: 'min', claves: [/duracion/], marcas: [{ v: 60, t: '60' }, { v: 90, t: '90' }, { v: 120, t: '120' }] }
    ],
    salidas: [{ id: 'recreos', etiqueta: 'Cantidad de recreos', dec: 0, destacada: true }, { id: 'fin', etiqueta: 'Hora de fin', tipo: 'hora', destacada: true }, { id: 'esquema', etiqueta: 'La clase por bloques', tipo: 'texto' }],
    fn: function (v) {
      var dur = Math.round(v.duracion), rec = Math.floor((dur - 1) / 40), ini = U.horaAMin(v.inicio), partes = [], resto = dur, k;
      for (k = 0; k <= rec; k++) {
        var c = Math.min(40, resto); partes.push('clase ' + c + ' min'); resto -= c;
        if (k < rec) { partes.push('recreo 5 min'); resto -= 5; }
      }
      return { recreos: rec, fin: ini === null ? '—' : U.minAHora(ini + dur), esquema: partes.join(' · ') };
    }
  });

  /* ---- franjas (INT-03): un valor y la franja donde cae; las franjas vienen en los datos (params.franjas) */
  M.register('franjas', {
    nombre: 'Franjas', resumen: 'Mové el valor y mirá en qué franja cae.',
    reconoce: [/franjas?\b|cervez/], requiereDatos: true,
    controles: [{ id: 'cantidad', etiqueta: 'Cantidad', tipo: 'rango', min: 0, max: 24, paso: 1, valor: 2, unidad: '', claves: [/cervez|cantidad/] }],
    salidas: [{ id: 'franja', etiqueta: 'Franja', tipo: 'texto', destacada: true }, { id: 'nota', etiqueta: 'Ojo', tipo: 'texto' }],
    fn: function (v, p) {
      var fr = (p && p.franjas) || [], en = fr.filter(function (f) { return v.cantidad >= f.desde && v.cantidad <= f.hasta; }), nom = en.map(function (f) { return f.nombre; });
      var peor = en.length ? en[en.length - 1] : null;
      return { franja: nom.length ? nom.join(' y ') : 'Sin franja', nota: en.map(function (f) { return f.nota; }).filter(Boolean).join(' · ') || '—',
        _estado: peor ? { tono: peor.tono || 'warn', texto: nom.join(' y ') + (peor.nota ? ': ' + peor.nota : '') } : { tono: 'ok', texto: 'Todavía no entra en ninguna franja.' } };
    },
    desdeDatos: function (d) {
      var fr = Array.isArray(d && d.franjas) ? d.franjas.filter(function (f) { return f && f.nombre && U.isNum(U.num(f.desde)) && U.isNum(U.num(f.hasta)); }) : [];
      if (fr.length < 2) return null;
      var tonos = ['ok', 'warn', 'bad'], mx = 0;
      fr = fr.map(function (f, i) { mx = Math.max(mx, U.num(f.hasta, 0)); return { nombre: String(f.nombre), desde: U.num(f.desde, 0), hasta: U.num(f.hasta, 0), nota: f.nota ? String(f.nota) : '', tono: tonos[Math.min(i, 2)] }; });
      return { params: { franjas: fr }, controles: [{ id: 'cantidad', min: 0, max: mx, zonas: fr.map(function (f) { return { desde: f.desde, hasta: f.hasta, tono: f.tono }; }) }] };
    }
  });

  /* ---- riesgo y mitigación (INT-06) */
  M.register('riesgo-mitigacion', {
    nombre: 'Bajá el riesgo, mirá el costo', resumen: 'Cuánto baja el riesgo de un peligro al mitigarlo y cuánto cuesta hacerlo.',
    reconoce: [/mitigacion|riesgo/],
    controles: [
      { id: 'peligro', etiqueta: 'Peligro', tipo: 'opcion', opciones: ['Charco de aceite', 'Pájaros en la cabecera', 'Lámpara quemada'], valor: 'Charco de aceite', claves: [/peligro/] },
      { id: 'mitigacion', etiqueta: 'Mitigación aplicada', tipo: 'rango', min: 0, max: 100, paso: 5, valor: 0, unidad: '%', claves: [/mitigacion/], marcas: [{ v: 0, t: '0' }, { v: 50, t: '50' }, { v: 100, t: '100' }] }
    ],
    salidas: [
      { id: 'riesgo', etiqueta: 'Riesgo', unidad: '/100', dec: 0, destacada: true, barra: { min: 0, max: 100, marca: 66 } }, { id: 'costo', etiqueta: 'Costo', unidad: '/100', dec: 0, barra: { min: 0, max: 100 } },
      { id: 'region', etiqueta: 'Región', tipo: 'texto', destacada: true }
    ],
    fn: function (v, p) {
      var base = U.num(p && p.base && p.base[v.peligro], 60), m = v.mitigacion / 100, riesgo = base * (1 - 0.9 * m), costo = m * m * 100;
      var r = riesgo > 66 ? { n: 'No tolerable', tono: 'bad', t: 'Región no tolerable: hay que actuar sí o sí.' } : (riesgo >= 33 ? { n: 'ALARP', tono: 'warn', t: 'ALARP: tolerable si el costo de bajarlo más no se justifica.' } : { n: 'Aceptable', tono: 'ok', t: 'Región aceptable: el riesgo es chico.' });
      return { riesgo: riesgo, costo: costo, region: r.n, _estado: { tono: r.tono, texto: r.t } };
    },
    desdeDatos: function (d) {
      var base = d && d.base && typeof d.base === 'object' && !Array.isArray(d.base) ? d.base : null;
      if (!base || Object.keys(base).length < 1) return null;
      var ops = Object.keys(base);
      return { params: { base: base }, controles: [{ id: 'peligro', opciones: ops, valor: ops[0] }] };
    }
  });

  /* ---- la fórmula de la sustentación: L ∝ ρ · V² · S (AER-02) */
  M.register('sustentacion-formula', {
    nombre: 'La fórmula de la sustentación', resumen: 'La sustentación crece con la densidad del aire, con el cuadrado de la velocidad y con la superficie.',
    reconoce: [/∝|ρ|densidad|temperatura|superficie|curvatura|verano/], prioridad: 80,
    controles: [
      { id: 'temp', etiqueta: 'Temperatura del aire', tipo: 'rango', min: -10, max: 40, paso: 1, valor: 15, unidad: '°C', claves: [/temperatura|densidad|ρ|^t$/], marcas: [{ v: -10, t: '−10' }, { v: 15, t: '15' }, { v: 40, t: '40' }] },
      { id: 'vel', etiqueta: 'Velocidad', tipo: 'rango', min: 40, max: 120, paso: 1, valor: 80, unidad: 'kt', claves: [/^v\b|velocidad/], marcas: [{ v: 40, t: '40' }, { v: 80, t: '80' }, { v: 120, t: '120' }] },
      { id: 'sup', etiqueta: 'Superficie del ala', tipo: 'rango', min: 10, max: 20, paso: 0.5, valor: 15, unidad: 'm²', claves: [/^s\b|superficie/] },
      { id: 'curv', etiqueta: 'Curvatura del perfil', tipo: 'rango', min: 0, max: 4, paso: 0.5, valor: 2, unidad: '%', opcional: true, claves: [/curvatura/] },
      { id: 'alfa', etiqueta: 'Ángulo de ataque', tipo: 'rango', min: 0, max: 14, paso: 0.5, valor: 4, unidad: '°', opcional: true, claves: [/α|alfa|angulo/] }
    ],
    salidas: [{ id: 'L', etiqueta: 'Sustentación', unidad: '% de vuelo normal', dec: 0, destacada: true, barra: { min: 0, max: 350, marca: 100 } }, { id: 'rho', etiqueta: 'Densidad', unidad: '%', dec: 0 }, { id: 'kg', etiqueta: 'Sustentación', unidad: 'kg', dec: 0 }],
    fn: function (v) {
      function lift(t, vel, s, curv, alfa) { var rho = 1.225 * 288.15 / (t + 273.15); return 0.5 * rho * Math.pow(vel * 0.514444, 2) * s * 0.085 * (alfa + curv); }
      var L = lift(v.temp, v.vel, v.sup, U.num(v.curv, 2), U.num(v.alfa, 4)), ref = lift(15, 80, 15, 2, 4);
      return { L: 100 * L / ref, rho: 100 * 288.15 / (v.temp + 273.15), kg: L / 9.80665 };
    },
    escenarios: [{ nombre: 'Vuelo normal', valores: { temp: 15, vel: 80, sup: 15 } }, { nombre: 'Día de verano (35 °C)', valores: { temp: 35, vel: 80, sup: 15 } }, { nombre: 'Día de invierno (5 °C)', valores: { temp: 5, vel: 80, sup: 15 } }, { nombre: 'Mitad de velocidad', valores: { vel: 40 } }]
  });

  /* ---- la balanza de Bernoulli: velocidad + presión = constante (AER-02) */
  M.register('bernoulli', {
    nombre: 'Balanza de Bernoulli', resumen: 'Si el aire va más rápido, la presión baja: la suma siempre da lo mismo.',
    reconoce: [/bernoulli|suma/], prioridad: 30,
    controles: [{ id: 'v', etiqueta: 'Velocidad del aire', tipo: 'rango', min: 0, max: 15, paso: 0.5, valor: 5, unidad: '', claves: [/^v\b|velocidad/], marcas: [{ v: 0, t: '0' }, { v: 5, t: '5' }, { v: 10, t: '10' }, { v: 15, t: '15' }], rapidos: [{ v: 5, t: 'V 5' }, { v: 10, t: 'V 10' }, { v: 12, t: 'V 12' }] }],
    salidas: [{ id: 'v', etiqueta: 'Velocidad', dec: 1, destacada: true, barra: { min: 0, max: 15 } }, { id: 'p', etiqueta: 'Presión', dec: 1, destacada: true, barra: { min: 0, max: 15 } }, { id: 'suma', etiqueta: 'Suma', dec: 0 }],
    fn: function (v, p) { var s = U.num(p && p.suma, 15); return { v: v.v, p: s - v.v, suma: s, _estado: { tono: 'info', texto: 'Más velocidad, menos presión: la balanza siempre queda en ' + U.fmt(s, 0) + '.' } }; },
    desdeDatos: function (d) {
      var s = U.num(d && d.suma, 15), casos = Array.isArray(d && d.casos) ? d.casos.filter(function (c) { return Array.isArray(c) && c.length >= 2 && U.isNum(U.num(c[0])); }) : [];
      return { params: { suma: s }, escenarios: casos.map(function (c) { return { nombre: 'V ' + U.num(c[0]) + ' · P ' + U.num(c[1]), valores: { v: U.num(c[0]) } }; }) };
    }
  });

  /* ---- el tubo que se estrecha (efecto Venturi, AER-02) */
  M.register('venturi', {
    nombre: 'Apretá el tubo', resumen: 'Al estrechar el tubo el aire acelera en la garganta y su presión baja.',
    prioridad: 20, reconoce: [/estrechamiento|garganta|venturi|\btubo\b/],
    controles: [{ id: 'estrechamiento', etiqueta: 'Estrechamiento del tubo', tipo: 'rango', min: 0, max: 60, paso: 5, valor: 0, unidad: '%', claves: [/estrechamiento/], marcas: [{ v: 0, t: '0' }, { v: 30, t: '30' }, { v: 60, t: '60' }] }],
    salidas: [{ id: 'v', etiqueta: 'Velocidad en la garganta', dec: 1, destacada: true, barra: { min: 0, max: 15 } }, { id: 'p', etiqueta: 'Presión en la garganta', dec: 1, destacada: true, barra: { min: 0, max: 15 } }, { id: 'suma', etiqueta: 'Suma', dec: 0 }],
    fn: function (v, p) {
      var b = U.num(p && p.base, 5), vel = b / (1 - v.estrechamiento / 100);
      return { v: vel, p: 15 - vel, suma: 15, _estado: v.estrechamiento > 0 ? { tono: 'info', texto: 'Por el paso angosto el aire corre más y empuja menos: eso es el Venturi.' } : { tono: 'ok', texto: 'Tubo recto: el aire va tranquilo (velocidad ' + U.fmt(b, 0) + ', presión ' + U.fmt(15 - b, 0) + ').' } };
    },
    /** `base`: la velocidad del aire en el tubo recto (5 por defecto; 10 con los números del curso: V = 10, P = 5). */
    desdeDatos: function (d) { var b = U.num(d && d.base, null); return (b !== null && b > 0 && b < 14) ? { params: { base: b } } : null; }
  });

  /* ---- velocidad de pérdida según el peso y la altitud (AER-03) */
  M.register('velocidad-perdida', {
    nombre: 'Peso, altitud y velocidad de pérdida', resumen: 'El ángulo crítico no cambia; la velocidad a la que se llega a él sí.',
    reconoce: [/ias perdida|tas perdida|velocidad de perdida/],
    controles: [
      { id: 'peso', etiqueta: 'Peso', tipo: 'rango', min: 1100, max: 1600, paso: 50, valor: 1600, unidad: 'lb', claves: [/peso/], marcas: [{ v: 1100, t: '1 100' }, { v: 1350, t: '1 350' }, { v: 1600, t: '1 600' }] },
      { id: 'altitud', etiqueta: 'Altitud', tipo: 'rango', min: 0, max: 10000, paso: 1000, valor: 0, unidad: 'ft', claves: [/altitud/], marcas: [{ v: 0, t: '0' }, { v: 5000, t: '5 000' }, { v: 10000, t: '10 000' }] }
    ],
    salidas: [{ id: 'aCrit', etiqueta: 'Ángulo crítico', unidad: '°', dec: 0, destacada: true }, { id: 'ias', etiqueta: 'Pérdida (IAS)', unidad: 'kt', dec: 0, destacada: true }, { id: 'tas', etiqueta: 'Pérdida (TAS)', unidad: 'kt', dec: 0 }],
    fn: function (v) {
      var ias = 47 * Math.sqrt(v.peso / 1600);
      return { aCrit: M.alfaPerdida(0), ias: ias, tas: ias / Math.sqrt(U.sigma(v.altitud)), _estado: { tono: 'info', texto: 'El ángulo crítico es siempre el mismo. Con más peso la pérdida llega a mayor velocidad indicada; con más altura sube la velocidad verdadera, no la que marca el anemómetro.' } };
    }
  });

  /* ---- tracción, resistencia y velocidad de equilibrio (AER-01) */
  M.register('fuerzas-acelerador', {
    nombre: 'Balanza de fuerzas', resumen: 'La tracción empuja, la resistencia frena, y el avión acelera hasta que se igualan.',
    reconoce: [/traccion|resistencia|acelerador/], prioridad: 45,
    controles: [
      { id: 'acelerador', etiqueta: 'Acelerador', tipo: 'rango', min: 0, max: 100, paso: 5, valor: 50, unidad: '%', claves: [/acelerador/], marcas: [{ v: 0, t: '0' }, { v: 50, t: '50' }, { v: 100, t: '100' }] },
      { id: 'vel', etiqueta: 'Velocidad del avión', tipo: 'rango', min: 0, max: 120, paso: 5, valor: 60, unidad: 'kt', claves: [/velocidad|ias/], marcas: [{ v: 0, t: '0' }, { v: 60, t: '60' }, { v: 120, t: '120' }] }
    ],
    salidas: [
      { id: 'T', etiqueta: 'Tracción', unidad: 'N', dec: 0, destacada: true, barra: { min: 0, max: 1000 } }, { id: 'D', etiqueta: 'Resistencia', unidad: 'N', dec: 0, destacada: true, barra: { min: 0, max: 1440 } },
      { id: 'eq', etiqueta: 'Velocidad de equilibrio', unidad: 'kt', dec: 0 }
    ],
    fn: function (v) {
      var T = 10 * v.acelerador, D = 0.1 * v.vel * v.vel, neto = T - D;
      return { T: T, D: D, eq: 100 * Math.sqrt(v.acelerador / 100), neto: neto,
        _estado: Math.abs(neto) < 40 ? { tono: 'ok', texto: 'Tracción = resistencia: la velocidad ya no cambia.' } : (neto > 0 ? { tono: 'info', texto: 'Tracción mayor que resistencia: el avión acelera.' } : { tono: 'warn', texto: 'Resistencia mayor que tracción: el avión pierde velocidad.' }) };
    },
    grafico: { tipo: 'linea', x: 'vel', y: ['D'], etiquetaX: 'Velocidad (kt)', etiquetaY: 'N' },
    escenarios: [{ nombre: 'Crucero', valores: { acelerador: 75, vel: 87 } }, { nombre: 'Plena potencia', valores: { acelerador: 100, vel: 60 } }, { nombre: 'Motor al ralentí', valores: { acelerador: 0, vel: 80 } }]
  });

  /* ================================================================== AER-01 y AER-02 (contenido de Aerodinámica; prioridad baja: no le sacan el modelo a los esbozos de otros módulos) */
  var RAD = Math.PI / 180;
  function interp(tab, x) {
    if (x <= tab[0][0]) return tab[0][1];
    for (var i = 1; i < tab.length; i++) if (x <= tab[i][0]) return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
    return tab[tab.length - 1][1];
  }

  /* ---- la presión sobre el ala según la curvatura del extradós: dos partículas, la de arriba y la de abajo (AER-02-03) */
  M.register('ala-presion', {
    nombre: 'Dos partículas, una fuerza', resumen: 'Cuanto más curvo es el extradós, más acelera la partícula de arriba, más baja su presión y más empuja el ala hacia arriba.',
    prioridad: 95, reconoce: [/curvatura del extrados|particula \(a\)|particulas \(a\) y \(b\)/],
    controles: [{ id: 'curv', etiqueta: 'Curvatura del extradós', tipo: 'rango', min: 0, max: 100, paso: 10, valor: 0, unidad: '%', claves: [/curvatura/],
      marcas: [{ v: 0, t: 'plano' }, { v: 50, t: '50' }, { v: 100, t: 'perfil del curso' }], rapidos: [{ v: 0, t: 'Sin curvatura' }, { v: 100, t: 'Perfil del curso' }] }],
    salidas: [
      { id: 'Va', etiqueta: 'Velocidad de la partícula de arriba (a)', dec: 1, destacada: true, barra: { min: 0, max: 15 } }, { id: 'Pa', etiqueta: 'Presión de la partícula de arriba (a)', dec: 1, destacada: true, barra: { min: 0, max: 15 } },
      { id: 'Pb', etiqueta: 'Presión de la partícula de abajo (b)', dec: 1, barra: { min: 0, max: 15 } }, { id: 'dP', etiqueta: 'Diferencia de presión (abajo menos arriba)', dec: 1 },
      { id: 'F', etiqueta: 'Fuerza aerodinámica hacia arriba', unidad: '% de la del perfil del curso', dec: 0, destacada: true, barra: { min: 0, max: 100 } }
    ],
    fn: function (v) {
      var k = U.clamp(v.curv, 0, 100) / 100, Va = 10 + 2 * k, Pa = 15 - Va, dP = 5 - Pa;
      return { Va: Va, Pa: Pa, Vb: 10, Pb: 5, dP: dP, F: 100 * dP / 2,
        _estado: k <= 0 ? { tono: 'info', texto: 'Sin curvatura el aire de arriba no se acelera: las dos partículas quedan con V = 10 y P = 5 y no hay diferencia de presión.' }
          : { tono: 'ok', texto: 'La partícula de arriba corre más y empuja menos que la de abajo: esa diferencia de presión es la fuerza que sostiene al avión.' } };
    },
    consigna: { texto: 'Dale al extradós la curvatura del perfil del curso, hasta que la partícula de arriba llegue a V = 12 y P = 3.', salida: 'Va', igual: 12 },
    escenarios: [{ nombre: 'Sin curvatura', valores: { curv: 0 } }, { nombre: 'Curvatura media', valores: { curv: 50 } }, { nombre: 'Perfil del curso', valores: { curv: 100 } }]
  });

  /* ---- sustentación y resistencia inducida: las dos componentes de la fuerza aerodinámica F (AER-02-04) */
  M.register('descomposicion-fuerza', {
    nombre: 'Separá la flecha', resumen: 'F nace perpendicular a la cuerda; respecto del viento relativo se reparte en sustentación (L) y resistencia inducida (D).',
    prioridad: 95, reconoce: [/descompon|descomposicion de la fuerza|componentes de f\b/],
    controles: [{ id: 'alfa', etiqueta: 'Ángulo entre la cuerda y el viento relativo', tipo: 'rango', min: 0, max: 20, paso: 1, valor: 6, unidad: '°', claves: [/alfa|α|angulo/],
      marcas: [{ v: 0, t: '0°' }, { v: 10, t: '10°' }, { v: 20, t: '20°' }], rapidos: [{ v: 0, t: '0°' }, { v: 8, t: '8°' }, { v: 16, t: '16°' }] }],
    salidas: [
      { id: 'F', etiqueta: 'Fuerza aerodinámica F', unidad: '%', dec: 0 },
      { id: 'L', etiqueta: 'Sustentación L (⟂ al viento relativo)', unidad: '% de F', dec: 1, destacada: true, barra: { min: 0, max: 100 } },
      { id: 'D', etiqueta: 'Resistencia inducida D (paralela al viento)', unidad: '% de F', dec: 1, destacada: true, barra: { min: 0, max: 100 } }
    ],
    fn: function (v) {
      var a = U.clamp(v.alfa, 0, 90) * RAD, L = 100 * Math.cos(a), D = 100 * Math.sin(a);
      return { F: 100, L: L, D: D, _estado: v.alfa < 0.5 ? { tono: 'ok', texto: 'Con la cuerda alineada al viento, toda la fuerza es sustentación y no aparece resistencia inducida.' }
        : { tono: 'info', texto: 'A más inclinación, un poco menos de F queda como sustentación y un poco más se vuelve resistencia inducida.' } };
    },
    grafico: { tipo: 'linea', x: 'alfa', y: ['L', 'D'], etiquetaX: 'Ángulo (°)', etiquetaY: '% de F' },
    escenarios: [{ nombre: 'Cuerda alineada', valores: { alfa: 0 } }, { nombre: 'Crucero (unos 4°)', valores: { alfa: 4 } }, { nombre: 'Muy inclinado', valores: { alfa: 16 } }]
  });

  /* ---- actitud, trayectoria y ángulo de ataque: α = actitud − trayectoria (AER-02-07) */
  M.register('alfa-actitud', {
    nombre: 'Actitud no es ángulo de ataque', resumen: 'El ángulo de ataque es el que hay entre la cuerda y el viento relativo: sale de la actitud de la nariz menos el ángulo de la trayectoria.',
    prioridad: 95, reconoce: [/actitud.*trayectoria|trayectoria.*actitud/],
    controles: [
      { id: 'actitud', etiqueta: 'Actitud (nariz respecto del horizonte)', tipo: 'rango', min: -10, max: 20, paso: 1, valor: 8, unidad: '°', claves: [/actitud/], marcas: [{ v: -10, t: '−10°' }, { v: 0, t: '0°' }, { v: 10, t: '10°' }, { v: 20, t: '20°' }] },
      { id: 'trayectoria', etiqueta: 'Trayectoria de vuelo (respecto del horizonte)', tipo: 'rango', min: -15, max: 15, paso: 1, valor: 0, unidad: '°', claves: [/trayectoria/], marcas: [{ v: -15, t: 'baja' }, { v: 0, t: 'nivelado' }, { v: 15, t: 'sube' }] }
    ],
    salidas: [
      { id: 'alfa', etiqueta: 'Ángulo de ataque', unidad: '°', dec: 0, destacada: true, barra: { min: -10, max: 24, marca: 16 } }, { id: 'cl', etiqueta: 'CL (sustentación)', dec: 2, destacada: true },
      { id: 'estado', etiqueta: 'Qué pasa', tipo: 'texto' }
    ],
    fn: function (v) {
      var a = v.actitud - v.trayectoria, aS = M.alfaPerdida(0), nivel = a >= aS ? 'perdida' : (a >= aS - 1.5 ? 'bocina' : 'normal');
      return { alfa: a, cl: M.cl(a, 0), nivel: nivel, estado: nivel === 'perdida' ? 'Ángulo crítico superado' : (nivel === 'bocina' ? 'Cerca del ángulo crítico' : (a < 0 ? 'Ángulo de ataque negativo' : 'Ala con margen')), aS: aS };
    },
    umbrales: [
      { salida: 'nivel', igual: 'perdida', tono: 'bad', texto: 'Pasaste el ángulo crítico (unos 16°): el ala ya no sostiene, aunque la nariz no parezca tan alta.' },
      { salida: 'nivel', igual: 'bocina', tono: 'warn', texto: 'Estás pegado al ángulo crítico: sonaría la bocina de pérdida.' },
      { siempre: true, tono: 'ok', texto: 'Ángulo de ataque = actitud menos trayectoria. Misma nariz, otra trayectoria, otro ángulo.' }
    ],
    consigna: { texto: 'Con la nariz 8° arriba del horizonte, buscá la trayectoria con la que el ángulo de ataque queda en 3°.', salida: 'alfa', igual: 3 },
    escenarios: [{ nombre: 'Crucero nivelado', valores: { actitud: 8, trayectoria: 0 } }, { nombre: 'En ascenso', valores: { actitud: 8, trayectoria: 5 } }, { nombre: 'En descenso', valores: { actitud: 8, trayectoria: -6 } }]
  });

  /* ---- cómo avanza el flujo turbulento al subir el ángulo de ataque (AER-02-08) */
  var TURB = [[0, 0], [8, 12], [12, 35], [17, 70], [19, 92], [22, 100]];
  M.register('flujo-alfa', {
    nombre: 'El flujo se despega', resumen: 'Al subir el ángulo de ataque la capa turbulenta avanza desde el borde de fuga; cuando llega a todo el ala, ya no sustenta.',
    prioridad: 95, reconoce: [/capa turbulenta|punto de transicion|flujo turbulento/],
    controles: [{ id: 'alfa', etiqueta: 'Ángulo de ataque', tipo: 'rango', min: 0, max: 22, paso: 0.5, valor: 4, unidad: '°', claves: [/alfa|α|angulo/],
      marcas: [{ v: 0, t: '0°' }, { v: 8, t: '8°' }, { v: 12, t: '12°' }, { v: 16, t: '16°' }, { v: 20, t: '20°' }], zonas: [{ desde: 0, hasta: 12, tono: 'ok' }, { desde: 12, hasta: 16, tono: 'warn' }, { desde: 16, hasta: 22, tono: 'bad' }],
      rapidos: [{ v: 8, t: '8°' }, { v: 12, t: '12°' }, { v: 17, t: '16°–18°' }, { v: 19, t: '18°–20°' }] }],
    salidas: [
      { id: 'turb', etiqueta: 'Extradós con flujo turbulento', unidad: '%', dec: 0, destacada: true, barra: { min: 0, max: 100 } }, { id: 'cl', etiqueta: 'CL (sustentación)', dec: 2, destacada: true },
      { id: 'fase', etiqueta: 'Estado del flujo', tipo: 'texto' }
    ],
    fn: function (v) {
      var a = v.alfa, t = interp(TURB, a), cl = M.cl(a, 0), aS = M.alfaPerdida(0);
      var fase = a <= 8 ? 'pegado, con poca turbulencia' : (a <= 12 ? 'turbulencia que avanza' : (a <= 18 ? 'turbulencia muy extensa' : 'casi todo despegado'));
      return { turb: t, cl: cl, fase: fase, aS: aS, nivel: a <= 8 ? 'pegado' : (a <= 12 ? 'avanza' : (a <= 18 ? 'critico' : 'perdida')) };
    },
    umbrales: [
      { salida: 'nivel', igual: 'perdida', tono: 'bad', texto: 'Casi no queda capa pegada: la sustentación cae y el ala entra en pérdida.' },
      { salida: 'nivel', igual: 'critico', tono: 'warn', texto: 'Zona del ángulo crítico: la turbulencia es muy extensa y la sustentación llega a su máximo.' },
      { salida: 'nivel', igual: 'avanza', tono: 'info', texto: 'La capa turbulenta se extiende, pero el ala todavía produce más sustentación.' },
      { siempre: true, tono: 'ok', texto: 'Flujo ordenado y pegado al ala: sólo hay un poco de turbulencia cerca del borde de fuga.' }
    ],
    grafico: { tipo: 'linea', x: 'alfa', y: ['cl'], etiquetaX: 'Ángulo de ataque (°)', etiquetaY: 'CL', lineas: [{ x: 'aS', texto: 'crítico' }] },
    escenarios: [{ nombre: 'Hasta 8°', valores: { alfa: 8 } }, { nombre: '12°', valores: { alfa: 12 } }, { nombre: '16°–18°', valores: { alfa: 17 } }, { nombre: '18°–20°', valores: { alfa: 19 } }],
    consigna: { texto: 'Subí el ángulo hasta que casi todo el extradós quede con flujo turbulento y el ala entre en pérdida.', salida: 'turb', mayor: 90 }
  });

  /* ---- día de verano contra día de invierno: densidad relativa y velocidad extra (AER-02-05) */
  M.register('verano-invierno', {
    nombre: 'Verano contra invierno', resumen: 'Con calor el aire es menos denso: para sostener el mismo peso hace falta ir más rápido.',
    prioridad: 95, reconoce: [/verano.*invierno|invierno.*verano/],
    controles: [
      { id: 'tcalor', etiqueta: 'Día de calor', tipo: 'rango', min: 20, max: 45, paso: 1, valor: 35, unidad: '°C', claves: [/calor|verano/], marcas: [{ v: 20, t: '20' }, { v: 35, t: '35' }, { v: 45, t: '45' }] },
      { id: 'tfrio', etiqueta: 'Día de frío', tipo: 'rango', min: -5, max: 15, paso: 1, valor: 5, unidad: '°C', claves: [/frio|invierno/], marcas: [{ v: -5, t: '−5' }, { v: 5, t: '5' }, { v: 15, t: '15' }] }
    ],
    salidas: [
      { id: 'rho', etiqueta: 'Densidad del aire caluroso', unidad: '% de la del día frío', dec: 0, destacada: true, barra: { min: 70, max: 110, marca: 100 } },
      { id: 'masVel', etiqueta: 'Velocidad verdadera extra para igualar la sustentación', unidad: '%', dec: 1, destacada: true },
      { id: 'carrera', etiqueta: 'Carrera de despegue (sólo por la densidad)', unidad: '%', dec: 0, signo: true }
    ],
    fn: function (v) {
      var rho = (273.15 + v.tfrio) / (273.15 + v.tcalor), mas = 100 * (1 / Math.sqrt(rho) - 1), carrera = 100 * (1 / rho - 1);
      return { rho: 100 * rho, masVel: mas, carrera: carrera, _estado: rho < 1 ? { tono: 'warn', texto: 'Aire más caliente, menos partículas por metro cúbico: el ala sostiene menos y hay que correr más para despegar.' } : { tono: 'ok', texto: 'Los dos días tienen la misma densidad.' } };
    },
    escenarios: [{ nombre: 'Enero contra julio (35 °C y 5 °C)', valores: { tcalor: 35, tfrio: 5 } }, { nombre: 'Día templado', valores: { tcalor: 25, tfrio: 15 } }, { nombre: 'Calor extremo', valores: { tcalor: 45, tfrio: -5 } }]
  });

  /* ---- el aviso de pérdida: al frenar de a poco, el ángulo necesario sube y suenan la bocina, el buffet y por fin la pérdida (AER-03-03) */
  M.register('aviso-perdida', {
    nombre: 'La bocina suena antes', resumen: 'Frenando de a poco en vuelo nivelado el ángulo de ataque sube: primero suena la bocina, después vibra el comando y por último el ala entra en pérdida.',
    prioridad: 95, reconoce: [/bocina suena|aviso de perdida|buffet/],
    controles: [{ id: 'vel', etiqueta: 'Velocidad indicada', tipo: 'rango', min: 40, max: 80, paso: 1, valor: 70, unidad: 'kt', claves: [/vel|ias|\bv\b/],
      marcas: [{ v: 47, t: '47' }, { v: 55, t: '55' }, { v: 70, t: '70' }], zonas: [{ desde: 40, hasta: 48, tono: 'bad' }, { desde: 48, hasta: 55, tono: 'warn' }, { desde: 55, hasta: 80, tono: 'ok' }],
      rapidos: [{ v: 70, t: '70 kt' }, { v: 54, t: '54 kt' }, { v: 49, t: '49 kt' }, { v: 46, t: '46 kt' }] }],
    salidas: [
      { id: 'alfa', etiqueta: 'Ángulo de ataque para no bajar', unidad: '°', dec: 1, destacada: true, barra: { min: 0, max: 22, marca: 16 } },
      { id: 'aviso', etiqueta: 'Qué sentís', tipo: 'texto', destacada: true }
    ],
    fn: function (v) {
      var q = 0.5 * 1.225 * Math.pow(U.clamp(v.vel, 30, 200) * 0.514444, 2), cl = PESO_KG * 9.80665 / (q * SUP), a = U.clamp(cl / 0.085, 0, 22), aS = M.alfaPerdida(0);
      var nivel = a >= aS - 0.5 ? 'perdida' : (a >= aS - 1.6 ? 'buffet' : (a >= aS - 4.5 ? 'bocina' : 'normal'));
      var aviso = { perdida: 'La nariz cae: pérdida', buffet: 'Suena la bocina y vibra el comando', bocina: 'Suena la bocina', normal: 'Nada: vuelo normal' }[nivel];
      return { alfa: a, aviso: aviso, nivel: nivel, aS: aS };
    },
    umbrales: [
      { salida: 'nivel', igual: 'perdida', tono: 'bad', texto: 'Pasaste el ángulo crítico: el ala ya no sostiene y la nariz cae. Bajá la nariz.' },
      { salida: 'nivel', igual: 'buffet', tono: 'warn', texto: 'La estructura y el comando empiezan a vibrar: la pérdida está a segundos.' },
      { salida: 'nivel', igual: 'bocina', tono: 'warn', texto: 'La bocina suena unos nudos antes de la pérdida: es tu aviso para bajar la nariz.' },
      { siempre: true, tono: 'ok', texto: 'Sin avisos: hay margen de sobra para volar con seguridad.' }
    ],
    grafico: { tipo: 'linea', x: 'vel', y: ['alfa'], etiquetaX: 'Velocidad indicada (kt)', etiquetaY: 'Ángulo de ataque (°)', lineas: [{ x: 55, texto: 'bocina' }, { x: 47, texto: 'pérdida' }] },
    escenarios: [{ nombre: 'Crucero lento', valores: { vel: 70 } }, { nombre: 'Suena la bocina', valores: { vel: 54 } }, { nombre: 'Bocina y vibración', valores: { vel: 49 } }, { nombre: 'En pérdida', valores: { vel: 46 } }]
  });

  /* ---- recuperar la pérdida: nariz abajo, toda la potencia y tirar sólo con velocidad suficiente (AER-03-04) */
  M.register('recuperacion-perdida', {
    nombre: 'Recuperá la pérdida', resumen: 'Cuánta altura se pierde según lo que hagas, y por qué tirar antes de tener velocidad te devuelve al ángulo crítico.',
    prioridad: 95, reconoce: [/recuper(a|ar|acion).*perdida|perdida secundaria/],
    controles: [
      { id: 'nariz', etiqueta: 'La nariz', tipo: 'opcion', opciones: ['Dejarla arriba', 'Bajarla bajo el horizonte'], valor: 'Dejarla arriba', claves: [/nariz/] },
      { id: 'potencia', etiqueta: 'La potencia', tipo: 'opcion', opciones: ['Ralentí', 'Toda la potencia'], valor: 'Ralentí', claves: [/potencia/] },
      { id: 'tiro', etiqueta: 'Empezás a tirar a', tipo: 'rango', min: 40, max: 90, paso: 1, valor: 50, unidad: 'kt', claves: [/tir|vel|ias/],
        marcas: [{ v: 47, t: '47' }, { v: 58, t: '58' }, { v: 90, t: '90' }], zonas: [{ desde: 40, hasta: 58, tono: 'bad' }, { desde: 58, hasta: 68, tono: 'ok' }, { desde: 68, hasta: 90, tono: 'warn' }],
        rapidos: [{ v: 50, t: '50 kt' }, { v: 62, t: '62 kt' }, { v: 85, t: '85 kt' }] }
    ],
    salidas: [
      { id: 'altura', etiqueta: 'Altura perdida', unidad: 'ft', dec: 0, destacada: true, barra: { min: 0, max: 600 } },
      { id: 'vmin', etiqueta: 'Velocidad mínima para tirar', unidad: 'kt', dec: 0 },
      { id: 'estado', etiqueta: 'Resultado', tipo: 'texto', destacada: true }
    ],
    fn: function (v) {
      var vs = 47, vmin = vs * Math.sqrt(1.5), abajo = v.nariz === 'Bajarla bajo el horizonte', plena = v.potencia === 'Toda la potencia';
      if (!abajo) return { altura: 400, vmin: vmin, estado: 'Sigue en pérdida', nivel: 'perdida' };
      var acc = plena ? 3 : 1.5, t = Math.max(0, (v.tiro - vs) / acc), alt = 50 + 22 * t, sec = v.tiro < vmin;
      if (sec) return { altura: alt + 150, vmin: vmin, estado: 'Pérdida secundaria', nivel: 'secundaria' };
      return { altura: alt, vmin: vmin, estado: alt <= 200 ? 'Recuperada' : 'Recuperada, con mucha altura perdida', nivel: alt <= 200 ? 'ok' : 'mucha' };
    },
    umbrales: [
      { salida: 'nivel', igual: 'perdida', tono: 'bad', texto: 'Sin bajar la nariz el ángulo de ataque no baja del crítico: el ala sigue en pérdida.' },
      { salida: 'nivel', igual: 'secundaria', tono: 'bad', texto: 'Tiraste antes de tener velocidad: volviste al ángulo crítico y entraste en una segunda pérdida.' },
      { salida: 'nivel', igual: 'mucha', tono: 'warn', texto: 'Recuperaste, pero perdiste mucha altura: sin toda la potencia o con una picada muy larga el avión baja de más.' },
      { siempre: true, tono: 'ok', texto: 'Bien hecho: nariz abajo, toda la potencia y recién después tiraste, con velocidad suficiente.' }
    ],
    escenarios: [
      { nombre: 'Nariz arriba', valores: { nariz: 'Dejarla arriba', potencia: 'Ralentí', tiro: 50 } },
      { nombre: 'Tirás demasiado pronto', valores: { nariz: 'Bajarla bajo el horizonte', potencia: 'Toda la potencia', tiro: 50 } },
      { nombre: 'Sin potencia', valores: { nariz: 'Bajarla bajo el horizonte', potencia: 'Ralentí', tiro: 62 } },
      { nombre: 'Los tres pasos bien', valores: { nariz: 'Bajarla bajo el horizonte', potencia: 'Toda la potencia', tiro: 62 } }
    ]
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(root.C150);
