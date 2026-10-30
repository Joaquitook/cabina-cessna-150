var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/mapas.js — C150.ESCUELA.mapas: los PLANOS de fondo del componente `mapa` (contrato v7 §5, pasada 2 · ola Q2). Todos son dibujos ESQUEMÁTICOS propios, hechos con
 * formas simples (nunca el plano ni la imagen del curso ni coordenadas reales): sirven para ubicar «qué está al lado de qué», no para medir nada. Sin DOM al cargar
 * (Node puede cargarlo); los dibujos son cadenas SVG con clases mp-* que pinta src/styles.css con los colores del tema (claro y oscuro).
 *
 * Sistema de coordenadas: los datos de las lecciones usan x de 0 a 100 e y de 0 a 66,7 (el plano mide 100 × 66,7 «unidades de plano»); el dibujo vive en un viewBox de
 * 600 × 400 (1 unidad de plano = 6 unidades de dibujo).
 *
 *   Mp.register(id, { nombre, nota, alias?:[ids], lugares?:{ idDePunto:[x,y] }, capas:[{ id, nombre, svg, visible? }] }) → bool
 *   Mp.get(id) → copia del plano | null (acepta alias y nombres con tildes)      Mp.has(id)      Mp.ids()      Mp.resolver(id) → id canónico | 'generico'
 *   Mp.lugar(fondo, idDePunto) → [x, y] | null     la posición por defecto de un punto conocido de ese plano (para los esbozos del plan sin coordenadas)
 *   Mp.px(unidades) → unidades del dibujo     Mp.poligono(pol) → 'x,y x,y …' (ya en unidades de dibujo)     Mp.centro(pol) → [x, y] (centroide, en unidades de plano)
 *   Mp.caja(pol) → {x0, y0, x1, y1}     Mp.dentro(pol, x, y) → bool (el punto está dentro del polígono)     Mp.LIM → {w: 100, h: 66.7}
 * Planos: 'plano-hangares-sur' · 'plano-carrasco-zonas' · 'costa-sur-uruguay' · 'esquema-tramites' · 'generico' (una grilla vacía).
 */
(function (C150) {
  'use strict';
  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mp = ES.mapas = ES.mapas || {};
  var reg = {}, alias = {};
  var K = 6;
  Mp.K = K; Mp.W = 600; Mp.H = 400; Mp.LIM = { w: 100, h: 66.7 }; Mp.VIEWBOX = '0 0 600 400';

  function norm(s) { s = String(s === undefined || s === null ? '' : s); try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ } return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  Mp.register = function (id, def) {
    if (!id || !def || !Array.isArray(def.capas)) return false;
    reg[id] = def; alias[norm(id)] = id;
    (def.alias || []).forEach(function (a) { alias[norm(a)] = id; });
    return true;
  };
  Mp.ids = function () { return Object.keys(reg); };
  Mp.resolver = function (id) { var k = alias[norm(id)]; return k && Object.prototype.hasOwnProperty.call(reg, k) ? k : 'generico'; };
  Mp.has = function (id) { var k = alias[norm(id)]; return !!k && Object.prototype.hasOwnProperty.call(reg, k); };
  Mp.get = function (id) { return Mp.has(id) ? JSON.parse(JSON.stringify(reg[alias[norm(id)]])) : null; };
  Mp.lugar = function (fondo, idPunto) {
    var d = Mp.get(fondo), l = d && d.lugares && d.lugares[idPunto];
    return Array.isArray(l) ? l.slice() : null;
  };
  Mp.px = function (u) { return Math.round(u * K * 100) / 100; };
  Mp.poligono = function (pol) { return (pol || []).map(function (p) { return Mp.px(p[0]) + ',' + Mp.px(p[1]); }).join(' '); };
  Mp.caja = function (pol) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (pol || []).forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  };
  /** Centroide del polígono (por área); si el área es 0 (puntos en línea), el centro de su caja. */
  Mp.centro = function (pol) {
    var a = 0, cx = 0, cy = 0, n = (pol || []).length, i;
    for (i = 0; i < n; i++) {
      var p = pol[i], q = pol[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
      a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
    }
    if (Math.abs(a) < 1e-9) { var b = Mp.caja(pol); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
    return [Math.round(cx / (3 * a) * 100) / 100, Math.round(cy / (3 * a) * 100) / 100];
  };
  /** Punto dentro de un polígono (rayo hacia la derecha). */
  Mp.dentro = function (pol, x, y) {
    var dentro = false, n = (pol || []).length, i, j = n - 1;
    for (i = 0; i < n; i++) {
      var xi = pol[i][0], yi = pol[i][1], xj = pol[j][0], yj = pol[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi)) dentro = !dentro;
      j = i;
    }
    return dentro;
  };

  /* ---- ayudantes de dibujo (cadenas SVG en unidades de plano → dibujo) */
  function n6(v) { return Math.round(v * K * 100) / 100; }
  function rect(cl, x, y, w, h, rx) { return '<rect class="' + cl + '" x="' + n6(x) + '" y="' + n6(y) + '" width="' + n6(w) + '" height="' + n6(h) + '"' + (rx ? ' rx="' + n6(rx) + '"' : '') + '/>'; }
  function lin(cl, x1, y1, x2, y2) { return '<line class="' + cl + '" x1="' + n6(x1) + '" y1="' + n6(y1) + '" x2="' + n6(x2) + '" y2="' + n6(y2) + '"/>'; }
  function txt(cl, x, y, t, anchor) { return '<text class="' + cl + '" x="' + n6(x) + '" y="' + n6(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + t + '</text>'; }
  function norte(x, y) {      // la flecha del norte, arriba a la derecha
    return '<g class="mp-norte"><line x1="' + n6(x) + '" y1="' + n6(y + 7) + '" x2="' + n6(x) + '" y2="' + n6(y) + '"/><polygon points="' + n6(x) + ',' + n6(y - 2) + ' ' + n6(x - 1.4) + ',' + n6(y + 1.6) + ' ' + n6(x + 1.4) + ',' + n6(y + 1.6) + '"/>' + txt('mp-geo', x, y + 11.2, 'N', 'middle') + '</g>';
  }
  function grilla() {
    var s = '', x, y;
    for (x = 10; x < 100; x += 10) s += lin('mp-grid', x, 0, x, 66.7);
    for (y = 10; y < 66; y += 10) s += lin('mp-grid', 0, y, 100, y);
    return s;
  }
  function pasto() { return rect('mp-pasto', 0, 0, 100, 66.7) + grilla(); }

  /* ---- 1. Hangares Sur (visto desde arriba): la calle y el Starbucks a la izquierda, la cerca con el portón 6A, la calle de rodaje, los hangares, la plataforma y el portón de Bomberos */
  var hangares = pasto() +
    rect('mp-calle', 0, 34, 29, 9) + lin('mp-calle-ln', 0, 38.5, 29, 38.5) + rect('mp-calle', 8, 8, 6, 54) +
    rect('mp-edif', 16, 25, 11, 9, 1.2) + rect('mp-edif mp-edif--b', 16, 14, 11, 8, 1.2) + rect('mp-edif mp-edif--b', 17, 46, 10, 9, 1.2) +
    lin('mp-cerca', 30, 8, 30, 21) + lin('mp-cerca', 30, 27, 30, 62) + lin('mp-cerca', 48, 14, 84, 14) + lin('mp-cerca', 92, 14, 98, 14) +
    rect('mp-rodaje', 40, 16, 6, 44) + lin('mp-rodaje-ln', 43, 17, 43, 59) +
    rect('mp-hangar', 50, 23, 9, 14, 1) + rect('mp-hangar', 62, 23, 9, 14, 1) + rect('mp-hangar', 74, 23, 9, 14, 1) + rect('mp-hangar', 86, 23, 3, 14, 1) +
    rect('mp-plat', 48, 44, 42, 12, 1.5) + lin('mp-plat-ln', 52, 50, 86, 50) +
    rect('mp-pista', 40, 60, 60, 5) + lin('mp-pista-ln', 43, 62.5, 97, 62.5) + norte(95, 3);
  Mp.register('plano-hangares-sur', {
    nombre: 'Plano esquemático de los Hangares Sur', nota: 'Plano esquemático, no está a escala.', alias: ['hangares-sur', 'plano-hangares'],
    lugares: { starbucks: [22, 30], 'porton-6a': [30, 24], 'puesto-control': [38, 24], 'porton-bomberos': [88, 12], 'cartel-pare': [38, 34], 'pegado-hangares': [52, 41], camioneta: [80, 36], 'hangar-escuela': [60, 30] },
    capas: [{ id: 'base', nombre: 'Plano', visible: true, svg: hangares }]
  });

  /* ---- 2. Carrasco con las zonas habilitadas: la terminal arriba, los Hangares Sur a la izquierda, la plataforma a la derecha y la pista al pie */
  var carrasco = pasto() +
    rect('mp-edif', 8, 6, 38, 14, 2) + txt('mp-geo', 27, 14.6, 'Terminal', 'middle') + rect('mp-calle', 0, 22, 100, 4) + lin('mp-calle-ln', 0, 24, 100, 24) +
    rect('mp-hangar', 12, 34, 9, 12, 1) + rect('mp-hangar', 25, 34, 9, 12, 1) + rect('mp-hangar', 38, 34, 6, 12, 1) +
    rect('mp-plat', 54, 22, 36, 30, 2) + lin('mp-plat-ln', 58, 32, 86, 32) + lin('mp-plat-ln', 58, 42, 86, 42) +
    rect('mp-rodaje', 44, 52, 40, 4) + rect('mp-pista', 6, 59, 90, 5) + lin('mp-pista-ln', 10, 61.5, 92, 61.5) + norte(95, 3);
  Mp.register('plano-carrasco-zonas', {
    nombre: 'Plano esquemático de Carrasco', nota: 'Plano esquemático, no está a escala.', alias: ['plano-carrasco', 'carrasco-zonas'],
    lugares: { 'hangares-sur': [27, 42], plataformas: [72, 36] },
    capas: [{ id: 'base', nombre: 'Plano', visible: true, svg: carrasco }]
  });

  /* ---- 3. La costa sur: el mar abajo, la tierra arriba y una orilla suave; los pines van de oeste a este. Sólo el ORDEN importa, no las distancias. */
  var COSTA = 'M0 46 C18 44 30 43 42 41 C56 39 70 36 84 40 C92 42.5 96 44 100 43';
  function pathU(d) { return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, function (m, a, b) { return n6(+a) + ' ' + n6(+b); }); }
  var costa = '<path class="mp-mar" d="' + pathU(COSTA + ' L100 66.7 L0 66.7 Z') + '"/><path class="mp-tierra" d="' + pathU(COSTA + ' L100 0 L0 0 Z') + '"/>' + grilla() +
    '<path class="mp-orilla" d="' + pathU(COSTA) + '"/>' +
    txt('mp-geo', 24, 58, 'Río de la Plata', 'middle') + txt('mp-geo', 80, 58, 'Océano Atlántico', 'middle') + txt('mp-geo mp-geo--t', 50, 12, 'Tierra firme', 'middle') + norte(95, 3);
  Mp.register('costa-sur-uruguay', {
    nombre: 'La costa sur, en esquema', nota: 'Esquema de la costa sur: las posiciones son ilustrativas, sin escala. Sólo muestran el orden de oeste a este.', alias: ['costa-sur', 'mapa-uruguay'],
    lugares: { melilla: [16, 37], carrasco: [34, 36], green: [62, 30], guazuvira: [62, 30], jaguel: [86, 36] },
    capas: [{ id: 'base', nombre: 'Costa', visible: true, svg: costa }]
  });

  /* ---- 4. Los dos destinos del trámite: dos paradas unidas por una flecha curva y una ciudad de manzanas de fondo */
  var tramites = '';
  (function () {
    var x, y;
    for (x = 4; x < 100; x += 14) for (y = 6; y < 62; y += 12) if (!((x > 18 && x < 34 || x > 66 && x < 82) && y > 38 && y < 58)) tramites += rect('mp-manzana', x, y, 10, 8, 1);
    tramites += '<path class="mp-flecha" d="M' + n6(29) + ' ' + n6(44) + ' Q' + n6(50) + ' ' + n6(22) + ' ' + n6(71) + ' ' + n6(44) + '"/>' +
      '<polygon class="mp-flecha-h" points="' + n6(71.6) + ',' + n6(44.6) + ' ' + n6(66.6) + ',' + n6(44.2) + ' ' + n6(69.2) + ',' + n6(39.8) + '"/>' +
      '<circle class="mp-paso" cx="' + n6(50) + '" cy="' + n6(30) + '" r="' + n6(3) + '"/>' + txt('mp-paso-t', 50, 31.4, '1 → 2', 'middle');
  })();
  Mp.register('esquema-tramites', {
    nombre: 'Los dos destinos de tu trámite', nota: 'Esquema de las dos paradas: no es un mapa con calles.', alias: ['tramites', 'esquema-de-tramites'],
    lugares: { 'boiso-lanza': [25, 50], dinacia: [75, 50] },
    capas: [{ id: 'base', nombre: 'Esquema', visible: true, svg: pasto().replace(/<line[^>]*mp-grid[^>]*\/>/g, '') + tramites }]
  });

  /* ---- 5. Un plano vacío: sólo la grilla */
  Mp.register('generico', { nombre: 'Plano esquemático', nota: 'Esquema sin escala.', alias: ['plano', 'esquema'], lugares: {}, capas: [{ id: 'base', nombre: 'Plano', visible: true, svg: pasto() + norte(95, 3) }] });

  if (typeof module !== 'undefined' && module.exports) module.exports = Mp;
})(root.C150);
