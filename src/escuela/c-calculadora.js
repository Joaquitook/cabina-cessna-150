var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-calculadora.js — componente `calculadora` (CAL) + el REGISTRO DE HERRAMIENTAS C150.ESCUELA.herramientas (contrato v7, E2).
 * Una herramienta es una función pura con sus entradas y los PASOS del cálculo a la vista. El componente dibuja las entradas con unidades,
 * el resultado, "Cómo se calcula" paso a paso, "Probá con un ejemplo del curso" y el modo DESAFÍO (te da los datos y vos calculás antes de ver el resultado).
 *
 * ESQUEMA DE `datos` (canónico):
 *   { herramienta:'viento-cruzado',                         id de una herramienta registrada (ver abajo)
 *     entradas?:[{ id, etiqueta?, unidad?, valor?, min?, max?, paso?, opciones? }],     ajustan las entradas de la herramienta con ese id
 *     ejemplo?:{ <entrada>: valor, … }  |  ejemplos?:[{ nombre?, valores:{…}, nota? }],   "Probá con un ejemplo del curso"
 *     desafio?:false,                                       el modo desafío aparece solo si la herramienta lo tiene; false lo apaga
 *     pasos?:true, nota?:'texto' }
 *   Herramientas de partida: conversion · viento-cruzado · tvd (tiempo, velocidad, distancia) · combustible · altitud-isa · plazo (fecha límite) ·
 *   fecha-minima · hora-llegada · sesion-estudio · horario-reglas · costo-opcion · area-ala · anticipacion · lista-condicional (las últimas se arman con los datos de la lección) ·
 *   tramite-licencia (INT-07-06: la fecha del psicofísico → calendario, costo en UR y lo que se lleva a cada lugar).
 *   normalizar acepta también los esbozos libres del plan (reconoce la herramienta por palabras; las que necesitan datos propios los toman de ahí) y devuelve null si no entiende.
 *
 * API del registro (pura, corre en Node):  Herr.register(id, def) · Herr.get(id) · Herr.has(id) · Herr.ids() · Herr.calc(id, valores, params) → {salidas, pasos, error?} · Herr.inferir(texto)
 *   def = { nombre, resumen, reconoce:[RegExp], prioridad?, requiereDatos?, entradas:[{ id, etiqueta, tipo:'numero|opcion|fecha|hora|dia-hora', unidad, valor, min, max, paso,
 *           opciones:[…]|fn(valores), ocultaSi?(valores), claves?:[RegExp], ayuda? }], desdeDatos?(datos) → {entradas?, params?}|null,
 *           calcular(v, params) → { error?, salidas:[{ id, etiqueta, valor, unidad?, dec?, tipo?:'num|texto|hora|fecha|lista', destacada?, tono? }], pasos:[texto], aviso? },
 *           ejemplos?:[{ nombre?, valores, nota? }], desafio?:{ salida, tol:{abs?|rel?}, tipo?:'num|hora', pregunta?, generar(rnd) → valores } }
 *   v._hoy (ISO) lo agrega el componente: la fecha de hoy.
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes, Mod = ES.modelos, U = Mod && Mod.util;
  if (!Mot || !Mod) return;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  var F = U.fmt, N = U.num;

  /* ================================================================== registro de herramientas */
  var Herr = ES.herramientas = ES.herramientas || {};
  var reg = {}, orden = [];
  Herr.register = function (id, def) {
    if (!id || !def || !isFn(def.calcular) || !Array.isArray(def.entradas)) return false;
    if (!reg[id]) orden.push(id);
    reg[id] = def; def.id = id; return true;
  };
  Herr.has = function (id) { return Object.prototype.hasOwnProperty.call(reg, id); };
  Herr.get = function (id) { return Herr.has(id) ? reg[id] : null; };
  Herr.ids = function () { return orden.slice(); };
  Herr.calc = function (id, valores, params) {
    var d = Herr.get(id), v = {}, k;
    if (!d) return { error: 'Herramienta desconocida', salidas: [], pasos: [] };
    for (k in (valores || {})) if (Object.prototype.hasOwnProperty.call(valores, k)) v[k] = valores[k];   // también las entradas que arma la lección (lista-condicional)
    d.entradas.forEach(function (e) { v[e.id] = (valores && valores[e.id] !== undefined) ? valores[e.id] : e.valor; });
    try { return d.calcular(v, params || {}) || { salidas: [], pasos: [] }; } catch (e) { return { error: 'No se pudo calcular con esos datos', salidas: [], pasos: [] }; }
  };
  Herr.inferir = function (texto, aceptar) {
    var t = U.norm(texto);
    var ids = orden.slice().sort(function (a, b) { return ((reg[a].prioridad || 50) - (reg[b].prioridad || 50)) || (orden.indexOf(a) - orden.indexOf(b)); });
    for (var i = 0; i < ids.length; i++) { var r = reg[ids[i]].reconoce || []; for (var k = 0; k < r.length; k++) if (r[k].test(t) && (!isFn(aceptar) || aceptar(ids[i]))) return ids[i]; }
    return null;
  };

  /* ---- ayudas de las herramientas */
  function falta(v, ids, msg) { for (var i = 0; i < ids.length; i++) if (!U.isNum(v[ids[i]])) return { error: msg || 'Completá todos los datos.', salidas: [], pasos: [] }; return null; }
  function num(id, etiqueta, unidad, valor, min, max, paso, extra) { var e = { id: id, etiqueta: etiqueta, tipo: 'numero', unidad: unidad, valor: valor, min: min, max: max, paso: paso }; if (extra) for (var k in extra) e[k] = extra[k]; return e; }
  function opc(id, etiqueta, opciones, valor, extra) { var e = { id: id, etiqueta: etiqueta, tipo: 'opcion', opciones: opciones, valor: valor === undefined ? (isFn(opciones) ? undefined : opciones[0]) : valor }; if (extra) for (var k in extra) e[k] = extra[k]; return e; }
  function hm(min) { min = Math.round(min); var h = Math.floor(min / 60), m = min % 60; return (h ? h + ' h ' : '') + m + ' min'; }
  function dec(x) { return Math.abs(x) >= 100 ? 0 : (Math.abs(x) >= 10 ? 1 : 2); }
  function pick(rnd, a) { return a[Math.floor(rnd() * a.length) % a.length]; }

  /* ---- conversión de unidades */
  var UNID = {
    'Longitud': { m: 1, km: 1000, ft: 0.3048, NM: 1852, SM: 1609.344 },
    'Velocidad': { kt: 1852 / 3600, 'km/h': 1 / 3.6, mph: 0.44704, 'm/s': 1, 'ft/min': 0.00508 },
    'Volumen': { L: 1, 'gal US': 3.785411784 },
    'Peso': { kg: 1, lb: 0.45359237 },
    'Presión': { hPa: 1, inHg: 33.8639 },
    'Temperatura': { '°C': 1, '°F': 1, K: 1 }
  };
  function aC(x, u) { return u === '°F' ? (x - 32) * 5 / 9 : (u === 'K' ? x - 273.15 : x); }
  function deC(c, u) { return u === '°F' ? c * 9 / 5 + 32 : (u === 'K' ? c + 273.15 : c); }
  Herr.register('conversion', {
    nombre: 'Conversión de unidades', resumen: 'Pasá de pies a metros, de nudos a km/h, de galones a litros…', prioridad: 60,
    reconoce: [/conversion|convertir|unidades de/],
    entradas: [
      opc('magnitud', 'Qué querés convertir', Object.keys(UNID), 'Longitud', { claves: [/magnitud/] }),
      num('valor', 'Valor', '', 1000, -100000, 1000000, 'any', { claves: [/valor|cantidad/] }),
      opc('de', 'De', function (v) { return Object.keys(UNID[v.magnitud] || UNID.Longitud); }, 'ft', { claves: [/^de$|origen/] }),
      opc('a', 'A', function (v) { return Object.keys(UNID[v.magnitud] || UNID.Longitud); }, 'm', { claves: [/^a$|destino/] })
    ],
    calcular: function (v) {
      var f = falta(v, ['valor']); if (f) return f;
      var T = UNID[v.magnitud]; if (!T || T[v.de] === undefined || T[v.a] === undefined) return { error: 'Elegí dos unidades de la misma magnitud.', salidas: [], pasos: [] };
      var res, pasos;
      if (v.magnitud === 'Temperatura') {
        res = deC(aC(v.valor, v.de), v.a);
        pasos = ['Pasá primero a grados Celsius: ' + F(aC(v.valor, v.de), 1) + ' °C.', 'Después pasá de Celsius a ' + v.a + ': ' + F(res, 1) + ' ' + v.a + '.',
          '°F = °C × 9 ÷ 5 + 32 · °C = (°F − 32) × 5 ÷ 9 · K = °C + 273,15'];
      } else {
        var fac = T[v.de] / T[v.a]; res = v.valor * fac;
        pasos = ['Buscá el factor: 1 ' + v.de + ' = ' + F(fac, fac < 0.01 ? 5 : 4) + ' ' + v.a + '.', 'Multiplicá: ' + F(v.valor, 2) + ' × ' + F(fac, 4) + ' = ' + F(res, dec(res)) + ' ' + v.a + '.',
          'Atajos para tener en la cabeza: 1 NM = 1,852 km · 1 kt ≈ 1,85 km/h · 1 ft ≈ 0,3 m · 1 gal US ≈ 3,8 L · 1 kg ≈ 2,2 lb.'];
      }
      return { salidas: [{ id: 'resultado', etiqueta: v.valor + ' ' + v.de + ' equivalen a', valor: res, unidad: v.a, dec: dec(res), destacada: true }], pasos: pasos };
    },
    ejemplos: [{ nombre: '5 000 ft a metros', valores: { magnitud: 'Longitud', valor: 5000, de: 'ft', a: 'm' } }, { nombre: '65 kt a km/h', valores: { magnitud: 'Velocidad', valor: 65, de: 'kt', a: 'km/h' } },
      { nombre: '22 galones a litros', valores: { magnitud: 'Volumen', valor: 22, de: 'gal US', a: 'L' } }],
    desafio: { salida: 'resultado', tol: { rel: 0.03 }, pregunta: 'Hacé la conversión (con 3 % de tolerancia).', generar: function (rnd) {
      var P = [['Longitud', 'ft', 'm', [1000, 2500, 5000, 300]], ['Longitud', 'NM', 'km', [10, 25, 60, 120]], ['Longitud', 'm', 'ft', [300, 500, 1000]], ['Velocidad', 'kt', 'km/h', [55, 65, 90, 100]],
        ['Velocidad', 'km/h', 'kt', [90, 120, 200]], ['Volumen', 'gal US', 'L', [10, 22, 26]], ['Volumen', 'L', 'gal US', [40, 80, 100]], ['Peso', 'lb', 'kg', [1100, 1500, 1600]], ['Peso', 'kg', 'lb', [60, 80, 725]],
        ['Presión', 'inHg', 'hPa', [29.92, 30.1, 29.5]], ['Temperatura', '°C', '°F', [0, 15, 30, 35]], ['Temperatura', '°F', '°C', [32, 59, 86]]], p = pick(rnd, P);
      return { magnitud: p[0], de: p[1], a: p[2], valor: pick(rnd, p[3]) };
    } }
  });

  /* ---- viento cruzado y de frente */
  Herr.register('viento-cruzado', {
    nombre: 'Viento cruzado y de frente', resumen: 'Cuánto del viento te empuja de costado y cuánto de frente o de cola.', prioridad: 40,
    reconoce: [/viento cruzado|crosswind|componente.*viento|viento de frente/],
    entradas: [
      num('pista', 'Pista (el número pintado)', '', 36, 1, 36, 1, { claves: [/pista|rumbo/], ayuda: 'Pista 36 = rumbo 360°; pista 09 = rumbo 090°.' }),
      num('dir', 'Viento desde', '°', 30, 0, 360, 1, { claves: [/direccion|desde/] }), num('vel', 'Intensidad del viento', 'kt', 15, 0, 60, 1, { claves: [/intensidad|velocidad|vel/] })
    ],
    calcular: function (v) {
      var f = falta(v, ['pista', 'dir', 'vel']); if (f) return f;
      var rumbo = v.pista * 10, ang = ((v.dir - rumbo) % 360 + 540) % 360 - 180, w = U.viento(rumbo, v.dir, v.vel), a = Math.abs(ang);
      var lado = w.lado === 'ninguno' ? 'ninguno' : w.lado;
      return { salidas: [
        { id: 'cruzado', etiqueta: 'Viento cruzado', valor: w.cruzado, unidad: 'kt', dec: 0, destacada: true, tono: w.cruzado > 13 ? 'bad' : (w.cruzado >= 9.5 ? 'warn' : 'ok') },
        { id: 'frente', etiqueta: w.frente >= 0 ? 'Viento de frente' : 'Viento de cola', valor: Math.abs(w.frente), unidad: 'kt', dec: 0, destacada: true },
        { id: 'lado', etiqueta: 'Te llega por la', valor: lado === 'ninguno' ? 'proa' : lado, tipo: 'texto' }],
        pasos: ['Rumbo de la pista: ' + v.pista + ' × 10 = ' + rumbo + '°.', 'Ángulo entre el viento y la pista: ' + v.dir + '° − ' + rumbo + '° = ' + F(a, 0) + '°.',
          'Cruzado = viento × seno del ángulo = ' + v.vel + ' × ' + F(Math.sin(a * Math.PI / 180), 2) + ' = ' + F(w.cruzado, 1) + ' kt.',
          'De frente = viento × coseno del ángulo = ' + v.vel + ' × ' + F(Math.cos(a * Math.PI / 180), 2) + ' = ' + F(Math.abs(w.frente), 1) + ' kt' + (w.frente < 0 ? ' (de cola)' : '') + '.',
          'Regla rápida: a 30° llega la mitad del viento de costado, a 45° el 70 %, a 60° el 85 % y a 90° todo. El máximo demostrado del 150M es 13 kt.'],
        aviso: w.cruzado > 13 ? 'Pasa el máximo demostrado del 150M (13 kt): hoy no es día para esta pista.' : '' };
    },
    ejemplos: [{ nombre: 'Pista 36, viento 090° a 12 kt', valores: { pista: 36, dir: 90, vel: 12 } }, { nombre: 'Pista 24, viento 300° a 15 kt', valores: { pista: 24, dir: 300, vel: 15 } }],
    desafio: { salida: 'cruzado', tol: { abs: 1.5 }, pregunta: 'Calculá el viento cruzado en nudos (aceptamos 1,5 kt de diferencia).', generar: function (rnd) {
      return { pista: pick(rnd, [36, 18, 24, 6, 9, 27, 3, 21]), dir: pick(rnd, [0, 30, 60, 90, 120, 150, 210, 240, 270, 300, 330]), vel: pick(rnd, [8, 10, 12, 15, 18, 20, 24]) };
    } }
  });

  /* ---- tiempo, velocidad y distancia */
  Herr.register('tvd', {
    nombre: 'Tiempo, velocidad y distancia', resumen: 'Con dos datos sacás el tercero: la regla de los 60.', prioridad: 40,
    reconoce: [/tiempo.*velocidad.*distancia|velocidad.*tiempo.*distancia|\btvd\b|regla de los 60/],
    entradas: [
      opc('incognita', 'Qué querés calcular', ['Tiempo', 'Distancia', 'Velocidad'], 'Tiempo', { claves: [/incognita|calcular/] }),
      num('dist', 'Distancia', 'NM', 60, 0, 2000, 1, { claves: [/dist/], ocultaSi: function (v) { return v.incognita === 'Distancia'; } }),
      num('vel', 'Velocidad (sobre el suelo)', 'kt', 90, 1, 300, 1, { claves: [/vel/], ocultaSi: function (v) { return v.incognita === 'Velocidad'; } }),
      num('tiempo', 'Tiempo', 'min', 40, 1, 1000, 1, { claves: [/tiempo|minutos/], ocultaSi: function (v) { return v.incognita === 'Tiempo'; } })
    ],
    calcular: function (v) {
      var i = v.incognita;
      if (i === 'Tiempo') { var f = falta(v, ['dist', 'vel']); if (f) return f; var t = v.dist / v.vel * 60;
        return { salidas: [{ id: 'resultado', etiqueta: 'Tiempo', valor: t, unidad: 'min', dec: 0, destacada: true }, { id: 'hm', etiqueta: 'Son', valor: hm(t), tipo: 'texto' }],
          pasos: ['Tiempo = distancia ÷ velocidad: ' + F(v.dist, 1) + ' NM ÷ ' + F(v.vel, 0) + ' kt = ' + F(v.dist / v.vel, 3) + ' h.', 'En minutos: × 60 = ' + F(t, 1) + ' min.', 'A 60 kt se recorre 1 NM por minuto: con la velocidad en kt, la regla de los 60 ayuda.'] }; }
      if (i === 'Distancia') { var f2 = falta(v, ['vel', 'tiempo']); if (f2) return f2; var d = v.vel * v.tiempo / 60;
        return { salidas: [{ id: 'resultado', etiqueta: 'Distancia', valor: d, unidad: 'NM', dec: 1, destacada: true }],
          pasos: ['Distancia = velocidad × tiempo: ' + F(v.vel, 0) + ' kt × ' + F(v.tiempo, 0) + ' min ÷ 60 = ' + F(d, 1) + ' NM.'] }; }
      var f3 = falta(v, ['dist', 'tiempo']); if (f3) return f3; var s = v.dist / v.tiempo * 60;
      return { salidas: [{ id: 'resultado', etiqueta: 'Velocidad', valor: s, unidad: 'kt', dec: 0, destacada: true }],
        pasos: ['Velocidad = distancia ÷ tiempo: ' + F(v.dist, 1) + ' NM ÷ ' + F(v.tiempo, 0) + ' min = ' + F(v.dist / v.tiempo, 3) + ' NM por minuto.', 'En nudos (NM por hora): × 60 = ' + F(s, 0) + ' kt.'] };
    },
    ejemplos: [{ nombre: '45 NM a 90 kt', valores: { incognita: 'Tiempo', dist: 45, vel: 90 } }, { nombre: 'Distancia en 25 min a 100 kt', valores: { incognita: 'Distancia', vel: 100, tiempo: 25 } }],
    desafio: { salida: 'resultado', tol: { rel: 0.05 }, pregunta: 'Calculá lo que se pide (5 % de tolerancia).', generar: function (rnd) {
      var i = pick(rnd, ['Tiempo', 'Distancia', 'Velocidad']), vel = pick(rnd, [80, 90, 100, 110, 120]), t = pick(rnd, [15, 20, 30, 40, 45, 60]);
      return { incognita: i, vel: vel, tiempo: t, dist: Math.round(vel * t / 60) };
    } }
  });

  /* ---- combustible */
  Herr.register('combustible', {
    nombre: 'Combustible y autonomía', resumen: 'Cuánto vuelo tenés con lo que cargaste, o cuánto cargar para el vuelo que planeás.', prioridad: 40,
    reconoce: [/combustible|autonomia|consumo/],
    entradas: [
      opc('incognita', 'Qué querés calcular', ['Autonomía', 'Combustible necesario'], 'Autonomía', { claves: [/incognita|calcular/] }),
      num('comb', 'Combustible a bordo', 'gal', 20, 0, 40, 0.5, { claves: [/combustible a bordo|a bordo/], ocultaSi: function (v) { return v.incognita !== 'Autonomía'; }, ayuda: 'Sólo el combustible utilizable (mirá el POH).' }),
      num('cons', 'Consumo', 'gal/h', 5.5, 1, 20, 0.1, { claves: [/consumo/], ayuda: 'El valor de crucero está en el POH de tu avión.' }),
      num('tiempo', 'Duración del vuelo', 'min', 90, 10, 600, 5, { claves: [/duracion|tiempo/], ocultaSi: function (v) { return v.incognita !== 'Combustible necesario'; } }),
      num('reserva', 'Reserva', 'min', 30, 0, 120, 5, { claves: [/reserva/], ayuda: 'Valor típico para vuelo visual diurno: mirá lo que pide tu reglamento.' })
    ],
    calcular: function (v) {
      if (v.incognita === 'Combustible necesario') {
        var f = falta(v, ['cons', 'tiempo', 'reserva']); if (f) return f;
        var gal = v.cons * (v.tiempo + v.reserva) / 60;
        return { salidas: [{ id: 'resultado', etiqueta: 'Tenés que cargar', valor: gal, unidad: 'gal', dec: 1, destacada: true }, { id: 'litros', etiqueta: 'En litros', valor: gal * 3.785411784, unidad: 'L', dec: 0 }],
          pasos: ['Tiempo total a cubrir = vuelo + reserva = ' + v.tiempo + ' + ' + v.reserva + ' = ' + (v.tiempo + v.reserva) + ' min.', 'Combustible = consumo × tiempo = ' + F(v.cons, 1) + ' gal/h × ' + F((v.tiempo + v.reserva) / 60, 2) + ' h = ' + F(gal, 1) + ' gal.',
            'La reserva no es para usar: es lo que queda al aterrizar.'] };
      }
      var f2 = falta(v, ['comb', 'cons', 'reserva']); if (f2) return f2;
      var h = v.comb / v.cons * 60, util = h - v.reserva;
      return { salidas: [{ id: 'resultado', etiqueta: 'Podés volar (sin tocar la reserva)', valor: Math.max(0, util), unidad: 'min', dec: 0, destacada: true, tono: util < 30 ? 'warn' : 'ok' }, { id: 'total', etiqueta: 'Autonomía total', valor: hm(h), tipo: 'texto' }],
        pasos: ['Autonomía total = combustible ÷ consumo = ' + F(v.comb, 1) + ' ÷ ' + F(v.cons, 1) + ' = ' + F(v.comb / v.cons, 2) + ' h = ' + hm(h) + '.', 'Le restás la reserva: ' + F(h, 0) + ' − ' + v.reserva + ' = ' + F(util, 0) + ' min para planificar.'],
        aviso: util <= 0 ? 'Con esa carga no alcanza ni para cubrir la reserva.' : '' };
    },
    ejemplos: [{ nombre: '20 gal a 5,5 gal/h', valores: { incognita: 'Autonomía', comb: 20, cons: 5.5, reserva: 30 } }, { nombre: 'Un vuelo de 90 min', valores: { incognita: 'Combustible necesario', cons: 5.5, tiempo: 90, reserva: 30 } }],
    desafio: { salida: 'resultado', tol: { rel: 0.05 }, pregunta: 'Calculá lo que se pide (5 % de tolerancia).', generar: function (rnd) {
      return { incognita: pick(rnd, ['Autonomía', 'Combustible necesario']), comb: pick(rnd, [15, 18, 20, 22]), cons: pick(rnd, [5, 5.5, 6]), tiempo: pick(rnd, [60, 90, 120]), reserva: 30 };
    } }
  });

  /* ---- altitud de presión, ISA y altitud de densidad */
  Herr.register('altitud-isa', {
    nombre: 'Altitud de presión y de densidad', resumen: 'Cómo el QNH y la temperatura cambian la "altura" que siente el avión.', prioridad: 40,
    reconoce: [/altitud de (presion|densidad)|qnh|\bisa\b/],
    entradas: [num('elev', 'Elevación del aeródromo', 'ft', 100, 0, 10000, 10, { claves: [/elevacion|altitud|altura/] }), num('qnh', 'QNH', 'hPa', 1013, 950, 1050, 1, { claves: [/qnh|presion/] }), num('temp', 'Temperatura', '°C', 15, -20, 45, 1, { claves: [/temperatura|temp/] })],
    calcular: function (v) {
      var f = falta(v, ['elev', 'qnh', 'temp']); if (f) return f;
      var ap = v.elev + (1013.25 - v.qnh) * 27, tisa = 15 - 1.98 * ap / 1000, dt = v.temp - tisa, ad = ap + 120 * dt;
      return { salidas: [{ id: 'ap', etiqueta: 'Altitud de presión', valor: ap, unidad: 'ft', dec: 0, destacada: true }, { id: 'dt', etiqueta: 'Diferencia con la ISA', valor: dt, unidad: '°C', dec: 1, signo: true }, { id: 'ad', etiqueta: 'Altitud de densidad', valor: ad, unidad: 'ft', dec: 0, destacada: true }],
        pasos: ['Altitud de presión = elevación + (1013,25 − QNH) × 27 ft por hPa = ' + F(v.elev, 0) + ' + (' + F(1013.25 - v.qnh, 2) + ') × 27 = ' + F(ap, 0) + ' ft.',
          'Temperatura estándar (ISA) a esa altitud: 15 − 2 × ' + F(ap / 1000, 2) + ' = ' + F(tisa, 1) + ' °C.', 'Diferencia: ' + F(v.temp, 1) + ' − ' + F(tisa, 1) + ' = ' + F(dt, 1) + ' °C.',
          'Altitud de densidad ≈ altitud de presión + 120 × diferencia = ' + F(ap, 0) + ' + 120 × ' + F(dt, 1) + ' = ' + F(ad, 0) + ' ft.', 'Hay cursos que usan 30 ft por hPa en lugar de 27: seguí el de tu curso.'],
        aviso: ad > ap + 1000 ? 'Día caluroso o de presión baja: el avión se va a comportar como si estuviera mucho más alto.' : '' };
    },
    ejemplos: [{ nombre: 'Carrasco, día de verano', valores: { elev: 105, qnh: 1010, temp: 34 } }, { nombre: 'Día frío y de presión alta', valores: { elev: 105, qnh: 1028, temp: 2 } }],
    desafio: { salida: 'ap', tol: { abs: 60 }, pregunta: 'Calculá la altitud de presión (aceptamos 60 ft de diferencia).', generar: function (rnd) {
      return { elev: pick(rnd, [100, 300, 1000, 2000, 3000]), qnh: pick(rnd, [995, 1000, 1005, 1013, 1020, 1025]), temp: pick(rnd, [5, 15, 25, 35]) };
    } }
  });

  /* ---- plazo: fecha límite = inicio + N meses */
  Herr.register('plazo', {
    nombre: 'Plazo y fecha límite', resumen: 'Sumá meses a una fecha y mirá cuánto te queda.', prioridad: 40,
    reconoce: [/plazo|18 meses|fecha limite/],
    entradas: [
      { id: 'inicio', etiqueta: 'Fecha de inicio', tipo: 'fecha', valor: '', claves: [/inicio|fecha/] }, num('cantidad', 'Plazo', '', 18, 1, 120, 1, { claves: [/plazo|cantidad|meses/] }),
      opc('unidad', 'Unidad del plazo', ['meses', 'días'], 'meses', { claves: [/unidad/] })
    ],
    calcular: function (v) {
      var d0 = U.parseFecha(v.inicio); if (!d0 || !U.isNum(v.cantidad)) return { error: 'Elegí la fecha en que empezaste.', salidas: [], pasos: [] };
      var meses = v.unidad !== 'días', lim = meses ? U.sumarMeses(d0, v.cantidad) : U.sumarDias(d0, v.cantidad), hoy = U.parseFecha(v._hoy), tot = U.diasEntre(d0, lim);
      var sal = [{ id: 'limite', etiqueta: 'Fecha límite', valor: U.fechaTexto(lim, true), tipo: 'texto', destacada: true }], pasos = ['Fecha límite = inicio + ' + v.cantidad + ' ' + (meses ? 'meses' : 'días') + ': ' + U.fechaTexto(d0) + ' → ' + U.fechaTexto(lim) + '.',
        'Hay ' + tot + ' días en total. Terminá ANTES de esa fecha: el último día ya es tarde.'];
      if (hoy) {
        var pasaron = U.diasEntre(d0, hoy), quedan = U.diasEntre(hoy, lim), pct = Math.max(0, Math.min(100, 100 * pasaron / (tot || 1)));
        sal.push({ id: 'quedan', etiqueta: 'Te quedan', valor: quedan >= 0 ? (quedan >= 60 ? 'unos ' + Math.round(quedan / 30.44) + ' meses (' + quedan + ' días)' : quedan + ' días') : 'Pasó hace ' + (-quedan) + ' días', tipo: 'texto', tono: quedan < 0 ? 'bad' : (quedan < 60 ? 'warn' : 'ok') });
        sal.push({ id: 'consumido', etiqueta: 'Plazo consumido', valor: pct, unidad: '%', dec: 0, barra: { min: 0, max: 100 } });
        pasos.push('Desde el inicio pasaron ' + pasaron + ' días: ' + F(pct, 0) + ' % del plazo.');
      }
      return { salidas: sal, pasos: pasos };
    },
    ejemplos: [{ nombre: 'Empecé el 15 de marzo de 2026', valores: { inicio: '2026-03-15', cantidad: 18, unidad: 'meses' }, nota: 'Límite: 15 de septiembre de 2027.' }]
  });

  /* ---- fecha mínima: una fecha base + N días */
  Herr.register('fecha-minima', {
    nombre: 'Fecha mínima para agendar', resumen: 'Cuántos días después de un trámite podés pedir el siguiente.', prioridad: 30,
    reconoce: [/fecha minima/],
    entradas: [
      { id: 'base', etiqueta: 'Fecha del trámite', tipo: 'fecha', valor: '', claves: [/psicofisico|tramite|base|inicio/] }, num('dias', 'Días de espera', 'días', 3, 0, 60, 1, { claves: [/dias/] }),
      { id: 'prueba', etiqueta: 'Fecha que querés probar', tipo: 'fecha', valor: '', claves: [/cita|prueba/] }
    ],
    calcular: function (v) {
      var b = U.parseFecha(v.base); if (!b) return { error: 'Elegí la fecha del trámite.', salidas: [], pasos: [] };
      var min = U.sumarDias(b, v.dias), p = U.parseFecha(v.prueba), sal = [{ id: 'minima', etiqueta: 'Fecha mínima', valor: U.fechaTexto(min, true), tipo: 'texto', destacada: true }], pasos = ['Fecha mínima = ' + U.fechaTexto(b) + ' + ' + v.dias + ' días = ' + U.fechaTexto(min) + '.'];
      if (p) { var ok = p.getTime() >= min.getTime(); sal.push({ id: 'puede', etiqueta: '¿Podés agendar ese día?', valor: ok ? 'Sí, se puede' : 'No: es antes de la fecha mínima', tipo: 'texto', tono: ok ? 'ok' : 'bad' }); pasos.push(U.fechaTexto(p) + (ok ? ' es igual o posterior a la fecha mínima.' : ' es anterior a la fecha mínima: elegí un día más tarde.')); }
      return { salidas: sal, pasos: pasos };
    },
    ejemplos: [{ nombre: 'Psicofísico el 4 de agosto de 2026', valores: { base: '2026-08-04', dias: 3, prueba: '2026-08-05' }, nota: 'Mínima: 7 de agosto. El 5 no se puede.' }]
  });

  /* ---- hora de llegada = hora acordada − anticipación (según el tipo de actividad) */
  Herr.register('hora-llegada', {
    nombre: 'A qué hora llegar', resumen: 'La hora que acordás con el profe y cuánto antes tenés que estar.', prioridad: 30,
    reconoce: [/hora_acordada|hora acordada|hora de llegada/], requiereDatos: true,
    entradas: [opc('tipo', 'Tipo de actividad', ['Vuelo', 'Simulador', 'Teórico'], 'Vuelo', { claves: [/tipo/] }), { id: 'hora', etiqueta: 'Hora acordada con el profe', tipo: 'hora', valor: '10:30', claves: [/hora/] }],
    desdeDatos: function (d) {
      var r = esObj(d && d.regla) ? d.regla : null, ks = r ? Object.keys(r).filter(function (k) { return esObj(r[k]) && U.isNum(U.num(r[k].antes)); }) : [];
      if (ks.length < 2) return null;
      var rs = {}; ks.forEach(function (k) { rs[k] = { antes: U.num(r[k].antes, 0), es: typeof r[k].hora_acordada_es === 'string' ? r[k].hora_acordada_es : '', haces: typeof r[k].haces === 'string' ? r[k].haces : '' }; });
      return { params: { reglas: rs }, entradas: [{ id: 'tipo', opciones: ks, valor: ks[0] }] };
    },
    calcular: function (v, p) {
      var r = p && p.reglas && p.reglas[v.tipo], t = U.horaAMin(v.hora); if (!r || t === null) return { error: 'Elegí la actividad y la hora.', salidas: [], pasos: [] };
      var ll = t - r.antes;
      return { salidas: [{ id: 'llegada', etiqueta: 'Tenés que estar a las', valor: U.minAHora(ll), tipo: 'hora', destacada: true }, r.haces ? { id: 'haces', etiqueta: 'Qué hacés ese rato', valor: r.haces, tipo: 'texto' } : null].filter(Boolean),
        pasos: ['La hora acordada (' + v.hora + ') es ' + (r.es || 'la de la actividad') + '.', 'Para ' + v.tipo.toLowerCase() + ' llegás ' + (r.antes ? r.antes + ' minutos antes' : 'a la hora') + ': ' + v.hora + ' − ' + r.antes + ' min = ' + U.minAHora(ll) + '.'] };
    },
    desafio: { salida: 'llegada', tipo: 'hora', pregunta: 'A qué hora tenés que llegar a la escuela (formato HH:MM).', generar: function (rnd) { return { hora: U.minAHora(pick(rnd, [8, 9, 10, 11, 14, 15, 16, 17]) * 60 + pick(rnd, [0, 15, 30, 45])) }; } }
  });

  /* ---- tu sesión de estudio al ritmo del curso: bloques de 40 minutos con recreos de 5 */
  Herr.register('sesion-estudio', {
    nombre: 'Tu sesión de estudio', resumen: 'Bloques de 40 minutos con recreos de 5, al ritmo del curso: cuántos recreos tenés y a qué hora terminás.', prioridad: 40,
    reconoce: [/sesion de estudio|modo clase|estudiar al ritmo/],
    entradas: [{ id: 'hora', etiqueta: 'Hora en que empezás', tipo: 'hora', valor: '19:00', claves: [/hora|inicio/] }, num('bloques', 'Bloques de 40 min', 'bloques', 3, 1, 8, 1, { claves: [/bloques?|estudio/] })],
    calcular: function (v) {
      var t = U.horaAMin(v.hora); if (t === null || !U.isNum(v.bloques) || v.bloques < 1) return { error: 'Elegí la hora de inicio y cuántos bloques querés estudiar.', salidas: [], pasos: [] };
      var b = Math.round(v.bloques), rec = b - 1, estudio = b * 40, total = estudio + rec * 5, fin = t + total;
      return { salidas: [{ id: 'recreos', etiqueta: 'Recreos de 5 minutos', valor: rec, dec: 0 }, { id: 'total', etiqueta: 'Duración total', valor: hm(total), tipo: 'texto' }, { id: 'fin', etiqueta: 'Terminás a las', valor: U.minAHora(fin), tipo: 'hora', destacada: true }],
        pasos: [b + ' bloques de 40 minutos = ' + estudio + ' minutos de estudio.', 'Entre un bloque y el siguiente hay un recreo de 5 minutos: ' + rec + ' recreos = ' + (rec * 5) + ' minutos.', 'Total: ' + estudio + ' + ' + (rec * 5) + ' = ' + total + ' minutos (' + hm(total) + '). ' + v.hora + ' + ' + hm(total) + ' = ' + U.minAHora(fin) + '.'] };
    },
    ejemplos: [{ nombre: 'Una tarde de tres bloques', valores: { hora: '19:00', bloques: 3 }, nota: 'Tres bloques de 40 minutos y dos recreos: de 19:00 a 21:10.' }, { nombre: 'Dos bloques antes de cenar', valores: { hora: '18:00', bloques: 2 }, nota: 'Dos bloques y un recreo: de 18:00 a 19:25.' }],
    desafio: { salida: 'fin', tipo: 'hora', pregunta: 'A qué hora terminás (formato HH:MM).', generar: function (rnd) { return { hora: U.minAHora(pick(rnd, [8, 9, 14, 15, 18, 19]) * 60 + pick(rnd, [0, 30])), bloques: pick(rnd, [2, 3, 4, 5]) }; } }
  });

  /* ---- reglas por día y hora (qué portón corresponde) */
  var DIAS7 = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  function diasDe(t) {
    var s = U.norm(t), idx = DIAS7.map(U.norm), r = /(\w+)\s+a\s+(\w+)/.exec(s), out = [], i;
    if (r && idx.indexOf(r[1]) >= 0 && idx.indexOf(r[2]) >= 0) { for (i = idx.indexOf(r[1]); i <= idx.indexOf(r[2]); i++) out.push(i); return out; }
    idx.forEach(function (d, k) { if (s.indexOf(d) >= 0) out.push(k); });
    return out;
  }
  Herr.register('horario-reglas', {
    nombre: 'Qué corresponde según el día y la hora', resumen: 'Elegí el día y la hora y mirá qué regla se aplica.', prioridad: 30,
    reconoce: [/porton|desde.*hasta/], requiereDatos: true,
    entradas: [opc('dia', 'Día', DIAS7, 'lunes', { claves: [/dia/] }), { id: 'hora', etiqueta: 'Hora', tipo: 'hora', valor: '10:00', claves: [/hora/] }],
    desdeDatos: function (d) {
      var rs = arr(d && d.reglas).filter(esObj).map(function (r) {
        var res = ['porton', 'resultado', 'texto', 'puerta'].map(function (k) { return r[k]; }).filter(function (x) { return typeof x === 'string'; })[0];
        return { dias: r.fuera ? [] : diasDe(r.dias), diasTxt: String(r.dias || ''), desde: U.horaAMin(r.desde), hasta: U.horaAMin(r.hasta), fuera: !!r.fuera, res: res || '' };
      }).filter(function (r) { return r.res && (r.fuera || (r.dias.length && r.desde !== null && r.hasta !== null)); });
      return rs.length >= 2 ? { params: { reglas: rs } } : null;
    },
    calcular: function (v, p) {
      var t = U.horaAMin(v.hora), di = DIAS7.indexOf(v.dia); if (t === null || di < 0) return { error: 'Elegí el día y la hora.', salidas: [], pasos: [] };
      var rs = arr(p && p.reglas), hit = null, fuera = null;
      rs.forEach(function (r) { if (r.fuera) fuera = r; else if (!hit && r.dias.indexOf(di) >= 0 && t >= r.desde && t <= r.hasta) hit = r; });
      var r = hit || fuera; if (!r) return { error: 'Ninguna regla se aplica.', salidas: [], pasos: [] };
      return { salidas: [{ id: 'resultado', etiqueta: 'Te corresponde', valor: r.res, tipo: 'texto', destacada: true, tono: hit ? 'ok' : 'warn' }],
        pasos: [v.dia.charAt(0).toUpperCase() + v.dia.slice(1) + ' a las ' + v.hora + '.', hit ? 'Entra en «' + hit.diasTxt + ', de ' + U.minAHora(hit.desde) + ' a ' + U.minAHora(hit.hasta) + '»: ' + hit.res + '.' : 'Queda fuera de los horarios normales: ' + r.res + '.'] };
    }
  });

  /* ---- costo según una opción (p. ej. en UR) por el valor de la unidad */
  Herr.register('costo-opcion', {
    nombre: 'Cuánto cuesta', resumen: 'El costo en unidades y lo que da en pesos con el valor de hoy.', prioridad: 30,
    reconoce: [/\bur\b|valorur|costo/], requiereDatos: true,
    entradas: [opc('donde', 'Opción', ['—'], '—', { claves: [/donde|opcion/] }), num('valor', 'Valor de la unidad hoy', '$', undefined, 0, 1000000, 'any', { claves: [/valor/] })],
    desdeDatos: function (d) {
      var r = esObj(d && d.reglas) ? d.reglas : null, ks = r ? Object.keys(r).filter(function (k) { return U.isNum(r[k]); }) : [];
      if (ks.length < 2) return null;
      var un = typeof d.unidad === 'string' && d.unidad ? d.unidad : 'u.';
      return { params: { costos: r, unidad: un }, entradas: [{ id: 'donde', opciones: ks, valor: ks[0] }, { id: 'valor', unidad: '$' }] };
    },
    calcular: function (v, p) {
      var c = p && p.costos && p.costos[v.donde]; if (!U.isNum(c)) return { error: 'Elegí una opción.', salidas: [], pasos: [] };
      var un = (p && p.unidad) || 'u.', sal = [{ id: 'costo', etiqueta: 'Costo', valor: c, unidad: un, dec: 0, destacada: true }], pasos = ['Esa opción cuesta ' + c + ' ' + un + '.'];
      if (U.isNum(v.valor) && v.valor > 0) { sal.push({ id: 'pesos', etiqueta: 'En pesos', valor: c * v.valor, unidad: '$', dec: 0, destacada: true }); pasos.push('En pesos: ' + c + ' × ' + F(v.valor, 2) + ' = ' + F(c * v.valor, 0) + ' $.'); }
      else pasos.push('Escribí el valor vigente de la unidad para ver el total en pesos (cambia con el tiempo: buscalo el día que lo necesites).');
      return { salidas: sal, pasos: pasos };
    }
  });

  /* ---- superficie del ala */
  Herr.register('area-ala', {
    nombre: 'Superficie del ala', resumen: 'Envergadura por cuerda media: el área del ala en m² y en ft².', prioridad: 40,
    reconoce: [/superficie alar|envergadura.*cuerda|cuerda media/],
    entradas: [num('envergadura', 'Envergadura', 'm', 10, 5, 20, 0.1, { claves: [/envergadura/] }), num('cuerda', 'Cuerda media', 'm', 1.5, 0.5, 3, 0.05, { claves: [/cuerda/] })],
    calcular: function (v) {
      var f = falta(v, ['envergadura', 'cuerda']); if (f) return f;
      var s = v.envergadura * v.cuerda;
      return { salidas: [{ id: 'm2', etiqueta: 'Superficie', valor: s, unidad: 'm²', dec: 1, destacada: true }, { id: 'ft2', etiqueta: 'Superficie', valor: s * 10.7639, unidad: 'ft²', dec: 0, destacada: true }, { id: 'alarg', etiqueta: 'Alargamiento', valor: v.envergadura / v.cuerda, dec: 1 }],
        pasos: ['Superficie = envergadura × cuerda media = ' + F(v.envergadura, 1) + ' × ' + F(v.cuerda, 2) + ' = ' + F(s, 1) + ' m².', 'Para pasar a pies cuadrados: × 10,76 = ' + F(s * 10.7639, 0) + ' ft².', 'Alargamiento = envergadura ÷ cuerda = ' + F(v.envergadura / v.cuerda, 1) + ': cuanto más largo y angosto el ala, más grande.'] };
    },
    ejemplos: [{ nombre: 'Valores aproximados del C150', valores: { envergadura: 10, cuerda: 1.5 }, nota: 'Aproximados: confirmá con el POH.' }],
    desafio: { salida: 'm2', tol: { rel: 0.03 }, pregunta: 'Calculá la superficie en m² (3 % de tolerancia).', generar: function (rnd) { return { envergadura: pick(rnd, [8, 9, 10, 11, 12]), cuerda: pick(rnd, [1, 1.2, 1.5, 1.8]) }; } }
  });

  /* ---- anticipación de un trámite de visita (días y horas de la semana) */
  function diaHora(s) { var m = /^(\S+)\s+(\d{1,2}:\d{2})$/.exec(String(s || '')), d = m ? DIAS7.indexOf(m[1]) : -1, t = m ? U.horaAMin(m[2]) : null; return d >= 0 && t !== null ? { d: d, t: t } : null; }
  Herr.register('anticipacion', {
    nombre: '¿Llegás a tiempo?', resumen: 'Cuántas horas antes de la visita hiciste el trámite y si alcanza.', prioridad: 30,
    reconoce: [/dia-hora|anticipacion/],
    entradas: [{ id: 'visita', etiqueta: 'Día y hora de la visita', tipo: 'dia-hora', valor: 'miércoles 10:00', claves: [/visita/] }, { id: 'tramite', etiqueta: 'Día y hora del trámite', tipo: 'dia-hora', valor: 'lunes 10:00', claves: [/tramite/] }],
    desdeDatos: function (d) { var e = arr(d && d.entradas).map(function (x) { return esObj(x) ? x.id : ''; }); return e.indexOf('visita') >= 0 && e.indexOf('tramite') >= 0 ? { params: {} } : null; },
    calcular: function (v) {
      var a = diaHora(v.visita), b = diaHora(v.tramite); if (!a || !b) return { error: 'Elegí día y hora en los dos.', salidas: [], pasos: [] };
      var horas = ((a.d * 1440 + a.t) - (b.d * 1440 + b.t)) / 60, fin = a.d >= 5, ok = fin ? b.d <= 3 : horas >= 48;
      return { salidas: [{ id: 'horas', etiqueta: 'Horas de anticipación', valor: horas, unidad: 'h', dec: 0, destacada: true }, { id: 'alcanza', etiqueta: '¿Alcanza?', valor: ok ? 'Sí, alcanza' : 'No alcanza', tipo: 'texto', tono: ok ? 'ok' : 'bad', destacada: true }],
        pasos: ['Del trámite a la visita pasan ' + F(horas, 0) + ' horas.', fin ? 'Para una visita de sábado o domingo el trámite tiene que estar hecho a más tardar el jueves: ' + (ok ? 'cumple.' : 'no cumple.') : 'Para una visita de lunes a viernes hacen falta al menos 48 horas: ' + (ok ? 'cumple.' : 'no cumple.')] };
    },
    ejemplos: [{ nombre: 'Visita el miércoles 10:00, trámite el lunes 10:00', valores: { visita: 'miércoles 10:00', tramite: 'lunes 10:00' }, nota: '48 horas justas: alcanza.' }, { nombre: 'Trámite el martes 12:00', valores: { visita: 'miércoles 10:00', tramite: 'martes 12:00' }, nota: 'Sólo 22 horas: no alcanza.' }]
  });

  /* ---- lista que cambia según las respuestas (p. ej. qué llevar) */
  Herr.register('lista-condicional', {
    nombre: 'Tu lista', resumen: 'Respondé unas preguntas y armá la lista de lo que tenés que llevar.', prioridad: 30,
    reconoce: [/siempre/], requiereDatos: true, entradas: [],
    desdeDatos: function (d) {
      var es = arr(d && d.entradas).filter(function (e) { return esObj(e) && e.id && arr(e.opciones).length >= 2; }), siempre = arr(d && d.siempre).filter(function (x) { return typeof x === 'string'; }), si = {};
      if (!es.length || !(siempre.length || Object.keys(d || {}).some(function (k) { return /^si[A-Z]/.test(k); }))) return null;
      es.forEach(function (e) { var k = 'si' + e.id.charAt(0).toUpperCase() + e.id.slice(1); if (esObj(d[k])) si[e.id] = d[k]; });
      return { params: { siempre: siempre, si: si }, entradas: es.map(function (e) { return { id: String(e.id), etiqueta: String(e.etiqueta || e.id), tipo: 'opcion', opciones: e.opciones.map(String), valor: String(e.opciones[0]) }; }) };
    },
    calcular: function (v, p) {
      var lista = arr(p && p.siempre).slice(), pasos = [], k;
      for (k in (p && p.si) || {}) { var extra = arr(p.si[k][v[k]]); lista = lista.concat(extra); if (extra.length) pasos.push('Por «' + v[k] + '»: ' + extra.join(', ') + '.'); }
      return { salidas: [{ id: 'lista', etiqueta: 'Tu lista (' + lista.length + ')', valor: lista, tipo: 'lista', destacada: true }], pasos: ['Siempre: ' + arr(p && p.siempre).join(', ') + '.'].concat(pasos) };
    }
  });

  /* ---- el calendario del trámite de la licencia de alumno piloto (INT-07-06): la cita en DINACIA va por lo menos 3 días después del psicofísico */
  var LUGAR_MED = 'en Medicina Aeronáutica', LUGAR_MUT = 'en mi mutualista';
  Herr.register('tramite-licencia', {
    nombre: 'Mi calendario del trámite', resumen: 'Con la fecha del psicofísico armás tu calendario, el costo y lo que llevás a cada lugar.', prioridad: 30,
    reconoce: [/calendario del tramite|tramite de la licencia/],
    entradas: [
      { id: 'fecha', etiqueta: 'Fecha de tu psicofísico', tipo: 'fecha', valor: '', claves: [/fecha|psicofisico/] },
      opc('lugar', 'Dónde hacés los análisis de sangre y orina', [LUGAR_MED, LUGAR_MUT], LUGAR_MED, { claves: [/lugar|analisis/] }),
      opc('edad', '¿Tenés 50 años o más?', ['no', 'sí'], 'no', { claves: [/edad|50/] })
    ],
    calcular: function (v) {
      var b = U.parseFecha(v.fecha); if (!b) return { error: 'Elegí la fecha de tu psicofísico.', salidas: [], pasos: [] };
      var med = v.lugar !== LUGAR_MUT, mayor = v.edad === 'sí', previo = U.sumarDias(b, -1), cita = U.sumarDias(b, 3), ur = med ? 4 : 2;
      var hitos = [
        U.fechaTexto(previo, true) + ': la víspera. Privación de sueño de 24 horas para el electroencefalograma (preguntale al gabinete cómo hacerla)' + (med ? '; última comida a las 20:00 o antes, para llegar con 12 horas de ayuno a las 8:00.' : '.'),
        U.fechaTexto(b, true) + ': psicofísico, a las 8:00 en Medicina Aeronáutica. Costo: ' + ur + ' UR.' + (med ? ' Llevá algo para comer y tomar después de la extracción de sangre.' : ''),
        U.fechaTexto(cita, true) + ': primera fecha posible para tu cita en Personal Aeronáutico de DINACIA (3 días después del psicofísico).'
      ];
      var medicina = ['Electroencefalograma completo con privación de sueño de 24 horas', 'Certificado de vacuna antitetánica vigente', 'Una foto carné']
        .concat(med ? ['Ayuno de 12 horas', 'Primera orina de la mañana'] : ['Todos los resultados de sangre y orina', 'Electrocardiograma informado por cardiólogo (llevá la tira)'])
        .concat(mayor ? ['Ergometría (prueba de esfuerzo), por tener 50 años o más'] : []);
      var dinacia = ['Una carta de la escuela que acredite que ya estás en el curso teórico', 'Una foto carné'];
      return { salidas: [
        { id: 'cita', etiqueta: 'Tu cita en DINACIA, desde el', valor: U.fechaTexto(cita, true), tipo: 'texto', destacada: true },
        { id: 'costo', etiqueta: 'Costo del psicofísico', valor: ur, unidad: 'UR', dec: 0, destacada: true },
        { id: 'hitos', etiqueta: 'Tu calendario', valor: hitos, tipo: 'lista' },
        { id: 'medicina', etiqueta: 'Llevás a Medicina Aeronáutica', valor: medicina, tipo: 'lista' },
        { id: 'dinacia', etiqueta: 'Llevás a DINACIA', valor: dinacia, tipo: 'lista' }
      ], pasos: [
        'La cita en DINACIA va por lo menos 3 días después del psicofísico: ' + U.fechaTexto(b) + ' + 3 días = ' + U.fechaTexto(cita) + '.',
        med ? 'Si hacés los análisis en Medicina Aeronáutica: ayuno de 12 horas (desde las 8:00 hacia atrás, la última comida es a las 20:00), primera orina de la mañana y 4 UR.'
          : 'Si llevás los estudios hechos desde tu mutualista: llevás todos los resultados y la tira del electrocardiograma, sin el ayuno de 12 horas, y son 2 UR.',
        mayor ? 'Tenés 50 años o más: se suma la ergometría.' : 'Con menos de 50 años no se pide ergometría.'
      ], aviso: 'Teléfonos, costos y requisitos pueden cambiar: confirmalos con el gabinete y con DINACIA.' };
    },
    ejemplos: [
      { nombre: 'Psicofísico el 4 de agosto de 2026, análisis en Medicina Aeronáutica', valores: { fecha: '2026-08-04', lugar: LUGAR_MED, edad: 'no' }, nota: 'Cita en DINACIA desde el viernes 7 de agosto; 4 UR.' },
      { nombre: 'Psicofísico el 11 de agosto de 2026, análisis en la mutualista, 50 años o más', valores: { fecha: '2026-08-11', lugar: LUGAR_MUT, edad: 'sí' }, nota: 'Cita desde el viernes 14 de agosto; 2 UR y se suma la ergometría.' }
    ]
  });

  /* ================================================================== normalizar (puro) */
  function claveCoincide(e, texto) { var t = U.norm(texto); return arr(e.claves).some(function (r) { return r.test(t); }); }
  function buscar(es, o) {
    var i, id = esObj(o) ? String(o.id || '') : String(o), t = id + ' ' + (esObj(o) ? String(o.etiqueta || '') : '');
    for (i = 0; i < es.length; i++) if (es[i].id === id) return es[i];
    for (i = 0; i < es.length; i++) if ((es[i].id.length >= 3 && id.indexOf(es[i].id) === 0) || claveCoincide(es[i], t)) return es[i];
    return null;
  }
  function normalizar(datos, ctx, comp) {
    if (!esObj(datos)) return null;
    var blob = U.norm(JSON.stringify(datos)) + ' ' + U.norm(comp && comp.titulo);
    function acepta(i) { var d = Herr.get(i); return !d.requiereDatos || (isFn(d.desdeDatos) && !!d.desdeDatos(datos)); }
    var id = (typeof datos.herramienta === 'string' && Herr.has(datos.herramienta)) ? datos.herramienta : Herr.inferir(blob, acepta);
    if (!id) return null;
    var def = Herr.get(id), extra = isFn(def.desdeDatos) ? def.desdeDatos(datos) : null;
    if (def.requiereDatos && !extra) return null;
    extra = extra || {};
    var es = def.entradas.map(function (e) { var k = clone(e); k.claves = e.claves; k.opciones = e.opciones; k.ocultaSi = e.ocultaSi; return k; });
    (extra.entradas || []).forEach(function (o) {
      var e = buscar(es, o);
      if (!e) { if (!def.entradas.length && o.tipo) es.push(o); return; }
      ['etiqueta', 'unidad', 'ayuda'].forEach(function (k) { if (typeof o[k] === 'string' && o[k]) e[k] = o[k]; });
      if (arr(o.opciones).length >= 2 && e.tipo === 'opcion') { e.opciones = o.opciones.map(String); e.valor = o.valor !== undefined ? String(o.valor) : e.opciones[0]; }
    });
    arr(datos.entradas).filter(esObj).forEach(function (o) {
      var e = buscar(es, o); if (!e) return;
      ['etiqueta', 'unidad', 'ayuda'].forEach(function (k) { if (typeof o[k] === 'string' && o[k]) e[k] = o[k]; });
      if (e.tipo === 'numero') { ['min', 'max', 'paso'].forEach(function (k) { var n = U.num(o[k], null); if (n !== null) e[k] = n; }); var v = U.num(o.valor, null); if (v !== null) e.valor = v; }
      else if (e.tipo === 'opcion' && !isFn(e.opciones) && arr(o.opciones).length >= 2 && !extra.entradas) { e.opciones = o.opciones.map(String); e.valor = e.opciones[0]; }
      else if ((e.tipo === 'fecha' && U.parseFecha(o.valor)) || (e.tipo === 'hora' && U.horaAMin(o.valor) !== null)) e.valor = o.valor;
    });
    es.forEach(function (e) { if (e.tipo === 'numero' && U.isNum(e.valor)) { if (e.valor < e.min) e.min = e.valor; if (e.valor > e.max) e.max = e.valor; } });
    /* ejemplos: de la herramienta o de los datos (claves por id o prefijo) */
    var ejs = [], exD = [];
    if (esObj(datos.ejemplo)) exD.push({ valores: datos.ejemplo }); if (esObj(datos.valoresC150)) exD.push({ nombre: 'Valores del C150', valores: datos.valoresC150, nota: typeof datos.valoresC150.nota === 'string' ? datos.valoresC150.nota : '' });
    arr(datos.ejemplos).filter(function (e) { return esObj(e) && esObj(e.valores); }).forEach(function (e) { exD.push(e); });
    exD.forEach(function (e) {
      var vals = {};
      Object.keys(e.valores).forEach(function (k) {
        var x = buscar(es, k), val = e.valores[k];
        if (!x) return;
        if (x.tipo === 'numero') { var n = U.num(val, null); if (n !== null) vals[x.id] = n; } else if (typeof val === 'string') vals[x.id] = val;
      });
      if (Object.keys(vals).length) ejs.push({ nombre: String(e.nombre || 'Ejemplo del curso'), valores: vals, nota: typeof e.nota === 'string' ? e.nota : '' });
    });
    if (!ejs.length) ejs = clone(arr(def.ejemplos));
    var nota = [datos.nota, datos.aclaracion].filter(function (t) { return typeof t === 'string' && t.trim(); })[0] || '';
    return { herramienta: id, nombre: def.nombre, resumen: def.resumen || '', entradas: es.map(function (e) { var k = {}; for (var x in e) if (x !== 'claves' && x !== 'ocultaSi' && (x !== 'opciones' || !isFn(e.opciones))) k[x] = e[x]; return k; }),
      params: extra.params || {}, ejemplos: ejs, desafio: !!def.desafio && datos.desafio !== false, pasos: datos.pasos !== false, nota: nota };
  }

  /* ================================================================== render */
  var ICON_ENTRADA = null;
  function render(host, datos, ctx) {
    var K = ctx.Kit, h = ctx.h, icon = ctx.icon, def = Herr.get(datos.herramienta), vals = {}, campos = {}, uid = 'es-cal-' + String(ctx.key || 'x').replace(/\W/g, '') + '-';
    var modo = 'calc', interacciones = 0, hecho = !!ctx.hecho, aciertos = 0, total = 0, probl = null, nProb = 0;
    function hoyISO() { var d = new Date(ctx.ahora ? ctx.ahora() : Date.now()); return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate()); }
    datos.entradas.forEach(function (e) { vals[e.id] = e.valor; });
    function opcionesDe(e) {
      var d0 = def.entradas.filter(function (x) { return x.id === e.id; })[0];
      return isFn(d0 && d0.opciones) ? d0.opciones(vals) : arr(e.opciones);
    }
    function ocultaDe(e) { var d0 = def.entradas.filter(function (x) { return x.id === e.id; })[0]; return !!(d0 && isFn(d0.ocultaSi) && d0.ocultaSi(vals)); }
    function calcular(v) { var vv = {}; for (var k in v) vv[k] = v[k]; vv._hoy = hoyISO(); return Herr.calc(datos.herramienta, vv, datos.params); }

    var raiz = h('div', { 'class': 'es-cal' });
    /* ---- entradas */
    var panel = h('div', { 'class': 'es-cal-in' });
    function campo(e) {
      var id = uid + e.id, ctl, wrap = h('div', { 'class': 'es-field' });
      var lbl = h('label', { 'class': 'es-field-l', 'for': id, text: e.etiqueta });
      var cambia = function (v) { vals[e.id] = v; interacciones++; refrescar(); };
      if (e.tipo === 'numero') {
        ctl = h('input', { type: 'number', 'class': 'es-num', id: id, inputmode: 'decimal', step: e.paso && e.paso !== 'any' ? e.paso : 'any', min: e.min, max: e.max, value: U.isNum(e.valor) ? e.valor : '' });
        ctl.addEventListener('input', function () { cambia(ctl.value === '' ? undefined : parseFloat(ctl.value)); });
        wrap.appendChild(lbl); wrap.appendChild(h('div', { 'class': 'es-field-r' }, ctl, e.unidad ? h('span', { 'class': 'es-field-u', text: e.unidad }) : null));
        return { wrap: wrap, set: function (v) { ctl.value = U.isNum(v) ? v : ''; } };
      }
      if (e.tipo === 'opcion') {
        ctl = h('select', { 'class': 'es-sel', id: id });
        var llenar = function () {
          var ops = opcionesDe(e), cur = vals[e.id];
          while (ctl.firstChild) ctl.removeChild(ctl.firstChild);
          ops.forEach(function (o) { ctl.appendChild(h('option', { value: o, text: o })); });
          if (ops.indexOf(cur) < 0) { cur = ops[0]; vals[e.id] = cur; }
          ctl.value = cur;
        };
        ctl.addEventListener('change', function () { vals[e.id] = ctl.value; interacciones++; refrescar(); });
        wrap.appendChild(lbl); wrap.appendChild(ctl);
        return { wrap: wrap, set: function (v) { vals[e.id] = v; llenar(); }, llenar: llenar };
      }
      if (e.tipo === 'fecha' || e.tipo === 'hora') {
        ctl = h('input', { type: e.tipo === 'fecha' ? 'date' : 'time', 'class': 'es-num', id: id, value: e.valor || '' });
        ctl.addEventListener('input', function () { cambia(ctl.value); });
        wrap.appendChild(lbl); wrap.appendChild(ctl);
        return { wrap: wrap, set: function (v) { ctl.value = v || ''; } };
      }
      /* dia-hora: dos controles, un solo valor "miércoles 10:00" */
      var sel = h('select', { 'class': 'es-sel', id: id }, DIAS7.map(function (d) { return h('option', { value: d, text: d }); })), tm = h('input', { type: 'time', 'class': 'es-num', 'aria-label': e.etiqueta + ': hora' });
      function leer() { return sel.value + ' ' + (tm.value || '00:00'); }
      function poner(v) { var p = diaHora(v); if (p) { sel.value = DIAS7[p.d]; tm.value = U.minAHora(p.t); } }
      sel.addEventListener('change', function () { cambia(leer()); }); tm.addEventListener('input', function () { cambia(leer()); });
      poner(e.valor);
      wrap.appendChild(lbl); wrap.appendChild(h('div', { 'class': 'es-field-r' }, sel, tm));
      return { wrap: wrap, set: poner };
    }
    datos.entradas.forEach(function (e) {
      var c = campo(e); campos[e.id] = c; if (c.llenar) c.llenar();
      if (e.ayuda) c.wrap.appendChild(h('p', { 'class': 'es-field-h', text: e.ayuda }));
      panel.appendChild(c.wrap);
    });
    /* ---- ejemplos y modo */
    var ejBox = null;
    if (datos.ejemplos.length) {
      ejBox = h('div', { 'class': 'es-esc', role: 'group', 'aria-label': 'Ejemplos del curso' }, h('span', { 'class': 'es-meta', text: 'Probá con un ejemplo del curso' }));
      datos.ejemplos.forEach(function (ej) {
        ejBox.appendChild(h('button', { type: 'button', 'class': 'es-chip', title: ej.nota || null, onclick: function () {
          Object.keys(ej.valores).forEach(function (k) { vals[k] = ej.valores[k]; if (campos[k]) campos[k].set(ej.valores[k]); });
          datos.entradas.forEach(function (e) { if (campos[e.id] && campos[e.id].llenar) { campos[e.id].llenar(); } });
          interacciones += 2; refrescar(); if (ej.nota) avisoEj.textContent = ej.nota; else avisoEj.textContent = '';
        } }, ej.nombre));
      });
    }
    var avisoEj = h('p', { 'class': 'es-note', 'aria-live': 'polite' });
    var modos = null;
    if (datos.desafio) modos = K.segmented({ items: [{ value: 'calc', label: 'Calculadora' }, { value: 'desafio', label: 'Desafío' }], value: 'calc', label: 'Modo', onChange: function (v) { cambiarModo(v); } });

    /* ---- resultados */
    var resBox = h('div', { 'class': 'es-cal-out', 'aria-live': 'polite' });
    var avisoBox = h('p', { 'class': 'es-pill is-warn', role: 'status' }); avisoBox.hidden = true;
    var pasosBox = h('div', { 'class': 'es-steps-box' });
    function dibujarResultado(r, dest, conPasos) {
      while (dest.firstChild) dest.removeChild(dest.firstChild);
      if (r.error) { dest.appendChild(h('p', { 'class': 'es-note es-cal-err' }, icon('info'), h('span', { text: r.error }))); return; }
      var grid = h('div', { 'class': 'es-outs' }), tonoAviso = null;
      arr(r.salidas).forEach(function (s) {
        var t = s.tipo || (typeof s.valor === 'number' ? 'num' : 'texto');
        if (t === 'lista') {
          var ul = h('ul', { 'class': 'es-list' }); arr(s.valor).forEach(function (x) { ul.appendChild(h('li', { text: x })); });
          var cp = (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) ? K.button({ label: 'Copiar la lista', icon: 'list', size: 'small', variant: 'secondary', onClick: function () {
            // writeText devuelve una promesa que puede rechazarse (sin permiso, ventana sin foco): se atiende y el aviso dice la verdad
            var avisar = function (t, tono) { if (ctx.api && isFn(ctx.api.showToast)) ctx.api.showToast({ text: t, kind: tono }); };      // showToast recibe {text, kind}
            var bien = function () { avisar('Lista copiada', 'good'); }, mal = function () { avisar('No se pudo copiar: seleccioná la lista y copiala a mano', 'warn'); };
            try { var pr = navigator.clipboard.writeText(arr(s.valor).map(function (x) { return '• ' + x; }).join('\n')); if (pr && isFn(pr.then)) pr.then(bien, mal); else bien(); } catch (er) { mal(); } } }) : null;
          grid.appendChild(h('div', { 'class': 'es-out-list' }, h('span', { 'class': 'stat-label', text: s.etiqueta }), ul, cp)); return;
        }
        var st = K.stat({ label: s.etiqueta, value: t === 'num' ? ((s.signo && s.valor > 0 ? '+' : '') + F(s.valor, s.dec || 0)) : String(s.valor), unit: s.unidad || '', small: !s.destacada });
        if (t !== 'num') st.classList.add('es-out-text');
        if (s.tono) st.setAttribute('data-tono', s.tono);
        grid.appendChild(st);
        if (s.barra) { var b = K.bars({ rows: [{ key: s.id, label: s.etiqueta }] }); b.set(s.id, (s.valor - s.barra.min) / ((s.barra.max - s.barra.min) || 1), F(s.valor, 0) + ' %'); grid.appendChild(b); }
      });
      dest.appendChild(grid);
      if (r.aviso) { dest.appendChild(h('p', { 'class': 'es-pill is-warn', role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }), h('span', { 'class': 'es-pill-t', text: r.aviso }))); }
      if (conPasos && datos.pasos && arr(r.pasos).length) {
        var ol = h('ol', { 'class': 'es-steps' });
        r.pasos.forEach(function (p) { ol.appendChild(h('li', null, h('span', { text: p }))); });
        dest.appendChild(h('div', { 'class': 'es-steps-box' }, h('p', { 'class': 'es-meta', text: 'Cómo se calcula, paso a paso' }), ol));
      }
    }
    function refrescar() {
      datos.entradas.forEach(function (e) { var c = campos[e.id]; if (c && c.llenar && isFn((def.entradas.filter(function (x) { return x.id === e.id; })[0] || {}).opciones)) c.llenar(); if (c) c.wrap.hidden = ocultaDe(e); });
      var r = calcular(vals);
      dibujarResultado(r, resBox, true);
      if (!hecho && !r.error && interacciones >= 1) { hecho = true; ctx.done(); }
    }

    /* ---- desafío */
    var desBox = h('div', { 'class': 'es-challenge' });
    desBox.hidden = true;
    function nuevoProblema() {
      nProb++;
      var rnd = U.rng((ctx.leccion && ctx.leccion.id) + '|' + datos.herramienta + '|' + nProb + '|' + (ctx.ahora ? ctx.ahora() : 0));
      var v = def.desafio.generar ? def.desafio.generar(rnd) : {}, base = {};
      datos.entradas.forEach(function (e) { base[e.id] = e.valor; });
      for (var k in v) base[k] = v[k];
      probl = { valores: base, esperado: Herr.calc(datos.herramienta, base, datos.params), resuelto: false };
      dibujarDesafio();
    }
    function dibujarDesafio() {
      while (desBox.firstChild) desBox.removeChild(desBox.firstChild);
      if (!probl) return;
      var D = def.desafio, sal = arr(probl.esperado.salidas).filter(function (s) { return s.id === D.salida; })[0];
      if (!sal) { desBox.appendChild(h('p', { 'class': 'es-note', text: 'Este desafío no se pudo armar.' })); return; }
      desBox.appendChild(h('p', { 'class': 'es-meta', text: 'Problema ' + nProb + ' · ' + aciertos + ' de ' + total + ' bien' }));
      var rows = h('div', { 'class': 'es-given' });
      datos.entradas.forEach(function (e) {
        var d0 = def.entradas.filter(function (x) { return x.id === e.id; })[0];
        if (d0 && isFn(d0.ocultaSi) && d0.ocultaSi(probl.valores)) return;
        var val = probl.valores[e.id]; if (val === undefined || val === '') return;
        rows.appendChild(h('p', { 'class': 'es-fixed' }, h('span', { text: e.etiqueta }), h('b', { text: String(typeof val === 'number' ? F(val, 2) : val) + (e.unidad ? ' ' + e.unidad : '') })));
      });
      desBox.appendChild(rows);
      desBox.appendChild(h('p', { 'class': 'es-q es-q--sm', text: D.pregunta || ('¿Cuánto da «' + sal.etiqueta + '»?') }));
      var esHora = D.tipo === 'hora', id = uid + 'resp';
      var inp = h('input', { type: esHora ? 'time' : 'number', 'class': 'es-num', id: id, inputmode: 'decimal', step: 'any', 'aria-label': 'Tu respuesta' + (sal.unidad ? ' en ' + sal.unidad : '') });
      var fb = h('div', { 'class': 'es-fb-out', 'aria-live': 'polite' });
      var btn = K.button({ label: 'Comprobar', variant: 'primary', icon: 'check', onClick: function () { comprobar(); } });
      function comprobar() {
        if (probl.resuelto || inp.value === '') return;
        var ok, esp = sal.valor, resp;
        if (esHora) { ok = U.horaAMin(inp.value) === U.horaAMin(esp); }
        else { resp = parseFloat(inp.value); var tol = D.tol || { rel: 0.02 }; ok = U.isNum(resp) && Math.abs(resp - esp) <= Math.max(tol.abs || 0, (tol.rel || 0) * Math.abs(esp)); }
        probl.resuelto = true; total++; if (ok) aciertos++;
        if (isFn(ctx.score)) ctx.score(aciertos, total, { retry: total > 1, fallos: ok ? [] : [datos.herramienta] });
        if (ok && !hecho) { hecho = true; ctx.done(); }
        inp.disabled = true; btn.disabled = true;
        fb.appendChild(h('p', { 'class': 'es-pill is-' + (ok ? 'ok' : 'bad'), role: 'status' }, h('span', { 'class': 'es-pill-dot', 'aria-hidden': 'true' }),
          h('span', { 'class': 'es-pill-t', text: ok ? '¡Bien! Da ' + (esHora ? esp : F(esp, sal.dec || 0) + ' ' + (sal.unidad || '')) + '.' : 'Casi: la respuesta es ' + (esHora ? esp : F(esp, sal.dec || 1) + ' ' + (sal.unidad || '')) + '. Mirá los pasos y probá otro.' })));
        var tmp = h('div'); dibujarResultado(probl.esperado, tmp, true); fb.appendChild(tmp);
        fb.appendChild(K.button({ label: 'Otro problema', variant: 'secondary', iconRight: 'arrow-right', onClick: function () { nuevoProblema(); } }));
        desBox.querySelector('.es-meta').textContent = 'Problema ' + nProb + ' · ' + aciertos + ' de ' + total + ' bien';
      }
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') comprobar(); });
      desBox.appendChild(h('div', { 'class': 'es-answer' }, inp, sal.unidad && !esHora ? h('span', { 'class': 'es-field-u', text: sal.unidad }) : null, btn));
      desBox.appendChild(fb);
    }
    function cambiarModo(m) {
      modo = m;
      var des = m === 'desafio';
      panel.hidden = des; if (ejBox) ejBox.hidden = des; avisoEj.hidden = des; resBox.hidden = des; desBox.hidden = !des;
      if (des && !probl) nuevoProblema();
    }

    K.add(raiz, [modos, panel, ejBox, avisoEj, resBox, desBox, datos.nota ? h('p', { 'class': 'es-note', text: datos.nota }) : null]);
    host.appendChild(raiz);
    refrescar();
    return { destroy: function () {}, getState: function () { return { herramienta: datos.herramienta, valores: JSON.parse(JSON.stringify(vals)), modo: modo, aciertos: aciertos, total: total }; } };
  }

  Mot.register('calculadora', { normalizar: normalizar, render: render });
})(root.C150);
