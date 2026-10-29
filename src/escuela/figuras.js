var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/figuras.js — C150.ESCUELA.figuras: dibujos PROPIOS (SVG) que usan los componentes `diagrama` y `animacion` (contrato v7, E2).
 * Nunca son imágenes del curso: son dibujos esquemáticos hechos acá. Sin DOM al cargar (Node puede cargarlo); los dibujos son cadenas SVG con clases dg-* que
 * pinta src/styles.css con los colores del tema (claro y oscuro).
 *
 *   Fig.register(id, { viewBox:'0 0 400 220', capas:[{ id, nombre, svg, visible? }], hotspots:[{ id, x, y, titulo, texto, capa? }] }) → bool
 *   Fig.get(id) → copia de la figura | null · Fig.has(id) · Fig.ids()
 *   Fig.paraNombres(['contorno','cuerda','presión'…]) → id de la figura que tiene esas capas (o null)   (para los esbozos del plan: capas = lista de nombres)
 *   Fig.seguro(cadenaSvg) → <g> con la cadena importada y LIMPIA (sólo formas y textos; sin scripts, enlaces ni estilos en línea). Sólo en el navegador.
 * Figuras de partida: 'perfil-ala' (capas contorno, cuerda, viento, presion, particulas) · 'ala-planta' (capas planta y perfil).
 */
(function (C150) {
  'use strict';
  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Fig = ES.figuras = ES.figuras || {};
  var reg = {};

  Fig.register = function (id, def) {
    if (!id || !def || !def.viewBox || !Array.isArray(def.capas)) return false;
    reg[id] = def; return true;
  };
  Fig.has = function (id) { return Object.prototype.hasOwnProperty.call(reg, id); };
  Fig.ids = function () { return Object.keys(reg); };
  Fig.get = function (id) { return Fig.has(id) ? JSON.parse(JSON.stringify(reg[id])) : null; };
  function norm(s) { s = String(s === undefined || s === null ? '' : s); try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ } return s.toLowerCase().trim(); }
  Fig.paraNombres = function (nombres) {
    var ns = (nombres || []).map(norm), mejor = null, mx = 0;
    Fig.ids().forEach(function (id) {
      var cs = reg[id].capas.map(function (c) { return norm(c.id) + '|' + norm(c.nombre); }), n = 0;
      ns.forEach(function (x) { if (cs.some(function (c) { return c.indexOf(x) >= 0 && x.length >= 3; })) n++; });
      if (n > mx) { mx = n; mejor = id; }
    });
    return mx >= 2 ? mejor : null;
  };

  /* ---- limpieza de SVG (navegador) */
  var OK_TAGS = { g: 1, path: 1, line: 1, rect: 1, circle: 1, ellipse: 1, polygon: 1, polyline: 1, text: 1, tspan: 1, title: 1 };
  var OK_ATTR = /^(class|id|d|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|width|height|points|transform|fill|stroke|stroke-width|stroke-dasharray|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|text-anchor|font-size|font-weight|dominant-baseline|data-[a-z-]+|aria-[a-z]+|role)$/;
  Fig.seguro = function (str) {
    var NS = 'http://www.w3.org/2000/svg', g = document.createElementNS(NS, 'g');
    if (typeof str !== 'string' || !str.trim() || typeof DOMParser === 'undefined') return g;
    var doc;
    try { doc = new DOMParser().parseFromString('<svg xmlns="' + NS + '">' + str + '</svg>', 'image/svg+xml'); } catch (e) { return g; }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return g;
    function copiar(src, dst) {
      for (var n = src.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { if (dst.nodeName === 'text' || dst.nodeName === 'tspan' || dst.nodeName === 'title') dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.localName;
        if (!OK_TAGS[tag]) continue;
        var el = document.createElementNS(NS, tag);
        for (var i = 0; i < n.attributes.length; i++) {
          var a = n.attributes[i];
          if (OK_ATTR.test(a.name) && !/url\(|javascript:|expression/i.test(a.value)) el.setAttribute(a.name, a.value);
        }
        copiar(n, el); dst.appendChild(el);
      }
    }
    copiar(doc.documentElement, g);
    return g;
  };

  /* ---- figura 1: el perfil del ala (un corte), con capas */
  var PERFIL = 'M70 115 C76 99 118 85 175 84 C240 83 296 98 332 110 C296 113 240 116 175 116 C118 117 80 124 70 115 Z';
  Fig.register('perfil-ala', {
    viewBox: '0 0 400 220',
    capas: [
      { id: 'contorno', nombre: 'Contorno', visible: true, svg: '<path class="dg-wing" d="' + PERFIL + '"/>' +
        '<text class="dg-lbl" x="175" y="104" text-anchor="middle">perfil del ala</text>' },
      { id: 'cuerda', nombre: 'Línea de cuerda', visible: true, svg: '<line class="dg-chord" x1="70" y1="115" x2="332" y2="110"/><circle class="dg-pt" cx="70" cy="115" r="3.5"/><circle class="dg-pt" cx="332" cy="110" r="3.5"/>' +
        '<text class="dg-lbl" x="250" y="132" text-anchor="middle">cuerda</text>' },
      { id: 'viento', nombre: 'Viento relativo', visible: true, svg: '<g class="dg-wind"><line x1="8" y1="78" x2="50" y2="78"/><line x1="8" y1="115" x2="50" y2="115"/><line x1="8" y1="152" x2="50" y2="152"/></g>' +
        '<polygon class="dg-head" points="50,73 60,78 50,83"/><polygon class="dg-head" points="50,110 60,115 50,120"/><polygon class="dg-head" points="50,147 60,152 50,157"/>' +
        '<text class="dg-lbl" x="30" y="66" text-anchor="middle">viento</text>' },
      { id: 'presion', nombre: 'Presión', visible: false, svg: '<path class="dg-low" d="M96 80 C130 52 230 50 304 92 C252 72 160 68 96 80 Z"/><path class="dg-high" d="M96 124 C130 150 230 152 304 118 C252 138 160 140 96 124 Z"/>' +
        '<text class="dg-lbl dg-lbl--low" x="200" y="50" text-anchor="middle">baja presión (−)</text><text class="dg-lbl dg-lbl--high" x="200" y="168" text-anchor="middle">alta presión (+)</text>' },
      { id: 'particulas', nombre: 'Partículas de aire', visible: false, svg: '<g class="dg-air">' +
        '<circle cx="24" cy="48" r="2.6"/><circle cx="72" cy="50" r="2.6"/><circle cx="118" cy="56" r="2.6"/><circle cx="172" cy="58" r="2.6"/><circle cx="230" cy="64" r="2.6"/><circle cx="292" cy="82" r="2.6"/><circle cx="352" cy="104" r="2.6"/>' +
        '<circle cx="24" cy="182" r="2.6"/><circle cx="76" cy="176" r="2.6"/><circle cx="128" cy="160" r="2.6"/><circle cx="184" cy="152" r="2.6"/><circle cx="240" cy="148" r="2.6"/><circle cx="300" cy="140" r="2.6"/><circle cx="356" cy="128" r="2.6"/></g>' }
    ],
    hotspots: [
      { id: 'ataque', x: 70, y: 115, titulo: 'Borde de ataque', texto: 'La parte redondeada de adelante: es lo primero que toca el aire.', capa: 'contorno' },
      { id: 'fuga', x: 332, y: 110, titulo: 'Borde de fuga', texto: 'El filo de atrás: por ahí se juntan otra vez el aire de arriba y el de abajo.', capa: 'contorno' },
      { id: 'extrados', x: 215, y: 84, titulo: 'Extradós', texto: 'La cara de arriba del ala, la más curva. El aire corre más rápido y la presión baja.', capa: 'contorno' },
      { id: 'intrados', x: 150, y: 119, titulo: 'Intradós', texto: 'La cara de abajo del ala, casi plana. Ahí la presión es mayor que arriba.', capa: 'contorno' },
      { id: 'cuerda', x: 268, y: 111, titulo: 'Cuerda', texto: 'La línea recta imaginaria del borde de ataque al borde de fuga. Con ella se mide el ángulo de ataque.', capa: 'cuerda' },
      { id: 'viento', x: 30, y: 115, titulo: 'Viento relativo', texto: 'El aire que le llega al ala, de frente. Va en sentido contrario a la trayectoria del avión.', capa: 'viento' },
      { id: 'baja', x: 200, y: 62, titulo: 'Zona de baja presión', texto: 'Arriba del ala el aire se acelera y empuja menos: la presión baja y el ala "se aspira" hacia arriba.', capa: 'presion' },
      { id: 'alta', x: 200, y: 150, titulo: 'Zona de alta presión', texto: 'Abajo del ala el aire empuja más que arriba: esa diferencia de presiones es la sustentación.', capa: 'presion' }
    ]
  });

  /* ---- figura 2: el ala vista de arriba (planta) y de costado (perfil), con sus medidas */
  Fig.register('ala-planta', {
    viewBox: '0 0 480 230',
    capas: [
      { id: 'planta', nombre: 'Vista en planta', visible: true, svg: '<rect class="dg-body" x="106" y="26" width="28" height="176" rx="14"/><rect class="dg-wing" x="18" y="96" width="204" height="40"/>' +
        '<g class="dg-dim"><line x1="18" y1="64" x2="222" y2="64"/><line x1="18" y1="58" x2="18" y2="70"/><line x1="222" y1="58" x2="222" y2="70"/><line x1="238" y1="96" x2="238" y2="136"/><line x1="232" y1="96" x2="244" y2="96"/><line x1="232" y1="136" x2="244" y2="136"/></g>' +
        '<text class="dg-lbl" x="120" y="54" text-anchor="middle">envergadura</text><text class="dg-lbl" x="226" y="152" text-anchor="end">cuerda</text>' },
      { id: 'perfil', nombre: 'Vista de perfil', visible: true, svg: '<g transform="translate(213 35) scale(.7)"><path class="dg-wing" d="' + PERFIL + '"/><line class="dg-chord" x1="70" y1="115" x2="332" y2="110"/></g>' +
        '<text class="dg-lbl" x="262" y="146" text-anchor="middle">borde de ataque</text><text class="dg-lbl" x="446" y="140" text-anchor="end">borde de fuga</text>' +
        '<text class="dg-lbl" x="350" y="84" text-anchor="middle">extradós</text><text class="dg-lbl" x="350" y="132" text-anchor="middle">intradós</text>' }
    ],
    hotspots: [
      { id: 'envergadura', x: 120, y: 64, titulo: 'Envergadura', texto: 'La distancia de una punta del ala a la otra, medida de lado a lado.', capa: 'planta' },
      { id: 'cuerda-planta', x: 238, y: 100, titulo: 'Cuerda media', texto: 'El ancho del ala de adelante hacia atrás. Si cambia a lo largo del ala, se usa el promedio.', capa: 'planta' },
      { id: 'punta', x: 22, y: 116, titulo: 'Punta del ala', texto: 'El extremo del ala: ahí el aire de abajo se escapa hacia arriba y arma un remolino.', capa: 'planta' },
      { id: 'raiz', x: 106, y: 116, titulo: 'Raíz del ala', texto: 'Donde el ala se une al fuselaje.', capa: 'planta' },
      { id: 'ataque-p', x: 266, y: 138, titulo: 'Borde de ataque', texto: 'El borde de adelante del perfil: el primero en tocar el aire.', capa: 'perfil' },
      { id: 'fuga-p', x: 446, y: 112, titulo: 'Borde de fuga', texto: 'El borde de atrás del perfil.', capa: 'perfil' },
      { id: 'extrados-p', x: 350, y: 92, titulo: 'Extradós', texto: 'La cara de arriba del perfil.', capa: 'perfil' },
      { id: 'intrados-p', x: 350, y: 118, titulo: 'Intradós', texto: 'La cara de abajo del perfil.', capa: 'perfil' }
    ]
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = Fig;
})(root.C150);
