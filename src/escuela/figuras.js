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
 * Aerodinámica (AER-01/02): 'cuatro-fuerzas' · 'venturi-tubo' · 'carburador-venturi' · 'perfil-presiones' · 'fuerza-descompuesta' · 'angulo-ataque' · 'actitud-alfa' ·
 *   'flujo-aoa' · 'perfiles-comparados' · 'ala-rodajas' · 'formula-sustentacion'. Se dibujan con ayudantes (flecha, txt, lin, cuna) y clases dg-f / dg-lbl--* de styles.css.
 * La pérdida (AER-03): 'curva-sustentacion' · 'aterrizaje-alfa' · 'tres-perdidas' · 'bocina-ala' · 'recuperacion-perdida' (el C150 de perfil con aviEn(), desde arriba con aviArriba()).
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

  /* ================================================================== AER-01 y AER-02: figuras de Aerodinámica (cada una con sus capas y sus puntos) */
  function r1(x) { return Math.round(x * 10) / 10; }
  /** Flecha de fuerza (línea + punta). k: l sustentación · w peso · t tracción · d resistencia · a fuerza aerodinámica · s viento · v velocidad de una partícula. */
  function flecha(x1, y1, x2, y2, k) {
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, hx = x2 - ux * 13, hy = y2 - uy * 13, px = -uy * 7, py = ux * 7;
    return '<line class="dg-f dg-f--' + k + '" x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(hx) + '" y2="' + r1(hy) + '"/>' +
      '<polygon class="dg-fh dg-fh--' + k + '" points="' + r1(x2) + ',' + r1(y2) + ' ' + r1(hx + px) + ',' + r1(hy + py) + ' ' + r1(hx - px) + ',' + r1(hy - py) + '"/>';
  }
  function txt(x, y, s, cls, ancla) { return '<text class="dg-lbl' + (cls ? ' ' + cls : '') + '" x="' + r1(x) + '" y="' + r1(y) + '" text-anchor="' + (ancla || 'middle') + '">' + s + '</text>'; }
  function lin(x1, y1, x2, y2, cls) { return '<line class="' + (cls || 'dg-ln') + '" x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '"/>'; }
  var RAD = Math.PI / 180;
  /** Punto a la distancia r de (cx, cy) con elevación fi (en grados) hacia la IZQUIERDA y arriba: el avión mira a la izquierda. */
  function pto(cx, cy, r, fi) { return [cx - r * Math.cos(fi * RAD), cy - r * Math.sin(fi * RAD)]; }
  /** Cuña (sector) entre dos elevaciones fi1 < fi2, de radio r. */
  function cuna(cx, cy, r, fi1, fi2, cls) {
    var a = pto(cx, cy, r, fi1), b = pto(cx, cy, r, fi2);
    return '<path class="' + cls + '" d="M' + cx + ' ' + cy + ' L' + r1(a[0]) + ' ' + r1(a[1]) + ' A' + r + ' ' + r + ' 0 0 1 ' + r1(b[0]) + ' ' + r1(b[1]) + ' Z"/>';
  }

  /* ---- las cuatro fuerzas sobre el avión en vuelo recto y nivelado */
  Fig.register('cuatro-fuerzas', {
    viewBox: '0 0 480 260',
    capas: [
      { id: 'avion', nombre: 'Avión', visible: true, svg: '<path class="dg-body" d="M138 134 L148 98 L164 98 L172 130 L284 126 C312 126 332 138 336 152 C332 166 312 172 286 172 L178 158 Z"/>' +
        '<rect class="dg-body" x="124" y="132" width="54" height="7" rx="3.5"/><path class="dg-wing" d="M206 108 L292 108 L296 115 L202 115 Z"/>' +
        '<line class="dg-ln" x1="232" y1="160" x2="220" y2="115"/><line class="dg-ln" x1="268" y1="164" x2="280" y2="115"/>' +
        '<line class="dg-ln" x1="244" y1="170" x2="240" y2="190"/><circle class="dg-body" cx="240" cy="197" r="9"/><line class="dg-ln" x1="306" y1="168" x2="308" y2="186"/><circle class="dg-body" cx="308" cy="192" r="7"/>' +
        '<ellipse class="dg-prop" cx="343" cy="150" rx="4" ry="34"/>' },
      { id: 'sustentacion', nombre: 'Sustentación', visible: true, svg: flecha(252, 106, 252, 36, 'l') + txt(252, 24, 'Sustentación', 'dg-lbl--lg dg-lbl--l') },
      { id: 'peso', nombre: 'Peso', visible: true, svg: flecha(264, 152, 264, 222, 'w') + txt(264, 242, 'Peso', 'dg-lbl--lg dg-lbl--w') },
      { id: 'traccion', nombre: 'Tracción', visible: true, svg: flecha(352, 150, 422, 150, 't') + txt(388, 134, 'Tracción', 'dg-lbl--lg dg-lbl--t') },
      { id: 'resistencia', nombre: 'Resistencia', visible: true, svg: flecha(134, 148, 64, 148, 'd') + txt(96, 132, 'Resistencia', 'dg-lbl--lg dg-lbl--d') },
      { id: 'equilibrio', nombre: 'Las dos igualdades', visible: false, svg: txt(24, 56, 'sustentación = peso', 'dg-lbl--lg', 'start') + txt(24, 78, 'tracción = resistencia', 'dg-lbl--lg', 'start') },
      { id: 'peso-menos', nombre: 'Peso menor', visible: false, svg: flecha(264, 152, 264, 186, 'w') + txt(264, 206, 'Peso (menor)', 'dg-lbl--lg dg-lbl--w') },
      { id: 'sust-menos', nombre: 'Sustentación menor', visible: false, svg: flecha(252, 106, 252, 72, 'l') + txt(252, 60, 'Sustentación', 'dg-lbl--lg dg-lbl--l') },
      { id: 'asciende', nombre: 'Asciende', visible: false, svg: flecha(372, 96, 412, 56, 'a') + txt(414, 50, 'asciende', 'dg-lbl--lg dg-lbl--a', 'start') }
    ],
    hotspots: [
      { id: 'sustentacion', x: 252, y: 70, titulo: 'Sustentación', texto: 'La fuerza que genera el ala, hacia arriba. En vuelo recto y nivelado es igual y contraria al peso.', capa: 'sustentacion' },
      { id: 'peso', x: 264, y: 190, titulo: 'Peso', texto: 'La atracción de la gravedad: apunta siempre hacia abajo, perpendicular a la superficie de la Tierra.', capa: 'peso' },
      { id: 'traccion', x: 392, y: 150, titulo: 'Tracción', texto: 'La fuerza hacia adelante que produce la hélice. En los aviones a turbina se llama empuje.', capa: 'traccion' },
      { id: 'resistencia', x: 98, y: 148, titulo: 'Resistencia', texto: 'La fuerza que frena el avance: es contraria a la tracción y es la suma de la resistencia inducida y la parásita.', capa: 'resistencia' }
    ]
  });

  /* ---- el tubo que se estrecha: Venturi con sus manómetros */
  Fig.register('venturi-tubo', {
    viewBox: '0 0 480 300',
    capas: [
      { id: 'tubo', nombre: 'Tubo', visible: true, svg: '<path class="dg-fluid" d="M10 136 L108 136 C148 136 180 176 240 176 C300 176 332 136 372 136 L470 136 L470 266 L372 266 C332 266 300 226 240 226 C180 226 148 266 108 266 L10 266 Z"/>' +
        '<path class="dg-wall" d="M10 96 L470 96 L470 136 L372 136 C332 136 300 176 240 176 C180 176 148 136 108 136 L10 136 Z"/>' +
        '<path class="dg-wall" d="M10 296 L470 296 L470 266 L372 266 C332 266 300 226 240 226 C180 226 148 266 108 266 L10 266 Z"/>' },
      { id: 'flujo', nombre: 'Líneas de aire', visible: true, svg: '<path class="dg-sl" d="M10 158 L108 158 C150 158 190 188 240 188 C290 188 330 158 372 158 L470 158"/>' +
        '<path class="dg-sl" d="M10 201 L470 201"/><path class="dg-sl" d="M10 244 L108 244 C150 244 190 214 240 214 C290 214 330 244 372 244 L470 244"/>' +
        '<polygon class="dg-fh dg-fh--s" points="28,153 42,158 28,163"/><polygon class="dg-fh dg-fh--s" points="28,196 42,201 28,206"/><polygon class="dg-fh dg-fh--s" points="28,239 42,244 28,249"/>' },
      { id: 'particulas', nombre: 'Partícula (a)', visible: true, svg: '<circle class="dg-part--a" cx="70" cy="201" r="9"/><text class="dg-part-t" x="70" y="205">a</text>' + flecha(84, 201, 112, 201, 'v') +
        '<circle class="dg-part--a" cx="208" cy="201" r="9"/><text class="dg-part-t" x="208" y="205">a</text>' + flecha(222, 201, 262, 201, 'v') },
      { id: 'manometros', nombre: 'Manómetros', visible: true, svg: '<rect class="dg-glass" x="52" y="30" width="16" height="106" rx="3"/><rect class="dg-liq" x="54" y="76" width="12" height="60"/>' + txt(60, 22, 'P = 5', 'dg-lbl--lg') +
        '<rect class="dg-glass" x="232" y="30" width="16" height="146" rx="3"/><rect class="dg-liq" x="234" y="140" width="12" height="36"/>' + txt(240, 22, 'P = 3', 'dg-lbl--lg') },
      { id: 'numeros', nombre: 'Velocidad y presión', visible: true, svg: txt(60, 288, '(1)  V = 10 · P = 5', 'dg-lbl--fg') + txt(240, 288, '(2)  V = 12 · P = 3', 'dg-lbl--fg') }
    ],
    hotspots: [
      { id: 'pos1', x: 30, y: 64, titulo: 'Posición (1): antes del estrechamiento', texto: 'El tubo es ancho y el aire va tranquilo: la partícula tiene velocidad 10 y presión 5. El manómetro está alto.', capa: 'manometros' },
      { id: 'pos2', x: 272, y: 64, titulo: 'Posición (2): en la garganta', texto: 'Por el paso angosto el aire corre más: velocidad 12 y presión 3. El manómetro baja, porque empuja menos.', capa: 'manometros' },
      { id: 'garganta', x: 332, y: 116, titulo: 'El estrechamiento', texto: 'Es la zona donde se reduce la sección por la que pasa el aire. Lo que se acelera ahí es todo el fluido.', capa: 'tubo' },
      { id: 'particula', x: 150, y: 201, titulo: 'La partícula (a)', texto: 'Seguila de izquierda a derecha: al entrar en la garganta acelera de 10 a 12 y su presión baja de 5 a 3. La suma siempre da 15.', capa: 'particulas' }
    ]
  });

  /* ---- el carburador del C150: un Venturi dentro del motor */
  Fig.register('carburador-venturi', {
    viewBox: '0 0 480 320',
    capas: [
      { id: 'conducto', nombre: 'Conducto del carburador', visible: true, svg: '<path class="dg-fluid" d="M190 20 L290 20 L290 96 C290 120 262 128 262 150 C262 172 290 180 290 204 L290 290 L190 290 L190 204 C190 180 218 172 218 150 C218 128 190 120 190 96 Z"/>' +
        '<path class="dg-wall" d="M140 20 L190 20 L190 96 C190 120 218 128 218 150 C218 172 190 180 190 204 L190 290 L140 290 Z"/><path class="dg-wall" d="M340 20 L290 20 L290 96 C290 120 262 128 262 150 C262 172 290 180 290 204 L290 290 L340 290 Z"/>' +
        txt(240, 12, 'aire de afuera', 'dg-lbl--lg') + txt(240, 308, 'hacia los cilindros', 'dg-lbl--lg') },
      { id: 'aire', nombre: 'Aire que pasa', visible: true, svg: flecha(214, 36, 214, 82, 's') + flecha(240, 36, 240, 82, 's') + flecha(266, 36, 266, 82, 's') + flecha(240, 128, 240, 176, 'a') +
        txt(350, 124, 'el aire corre', 'dg-lbl--a', 'start') + txt(350, 138, 'más rápido…', 'dg-lbl--a', 'start') },
      { id: 'nafta', nombre: 'Nafta', visible: true, svg: '<rect class="dg-wall" x="20" y="190" width="100" height="80" rx="6"/><rect class="dg-fuel" x="22" y="224" width="96" height="44" rx="4"/>' +
        '<path class="dg-pipe" d="M96 224 L96 206 L168 206 L168 152 L216 152"/><circle class="dg-fuel" cx="206" cy="160" r="3.4"/><circle class="dg-fuel" cx="199" cy="168" r="3"/>' + txt(70, 182, 'nafta', 'dg-lbl--lg') },
      { id: 'mariposa', nombre: 'Mariposa', visible: true, svg: '<line class="dg-ln" x1="194" y1="248" x2="286" y2="228" stroke-width="7"/><circle class="dg-pt" cx="240" cy="238" r="5"/>' + txt(350, 240, 'mariposa', 'dg-lbl--lg', 'start') },
      { id: 'hielo', nombre: 'Hielo', visible: false, svg: '<ellipse class="dg-ice" cx="222" cy="150" rx="6" ry="17"/><ellipse class="dg-ice" cx="258" cy="150" rx="6" ry="17"/>' + txt(350, 168, '…y más frío: se', 'dg-lbl--lg', 'start') + txt(350, 184, 'puede formar hielo', 'dg-lbl--lg', 'start') },
      { id: 'calefaccion', nombre: 'Calefacción del carburador', visible: true, svg: flecha(452, 66, 296, 66, 'w') + txt(374, 50, 'aire caliente (carb heat)', 'dg-lbl--w') }
    ],
    hotspots: [
      { id: 'venturi', x: 240, y: 112, titulo: 'El venturi del carburador', texto: 'Un estrechamiento del conducto: el aire acelera, baja su presión y esa succión absorbe la nafta que entra en la mezcla.', capa: 'conducto' },
      { id: 'nafta', x: 68, y: 244, titulo: 'La nafta', texto: 'Está en una cubeta aparte. Como en la garganta la presión es menor, la nafta sube por el surtidor y se mezcla con el aire.', capa: 'nafta' },
      { id: 'mariposa', x: 240, y: 266, titulo: 'La mariposa', texto: 'Es la válvula que abrís con el acelerador: deja pasar más o menos mezcla hacia los cilindros.', capa: 'mariposa' },
      { id: 'calefaccion', x: 380, y: 94, titulo: 'Calefacción del carburador', texto: 'Deja entrar aire calentado por el escape. Se usa contra el hielo, que se forma justo en la zona más fría y de menor presión.', capa: 'calefaccion' },
      { id: 'hielo', x: 240, y: 192, titulo: 'Hielo en el carburador', texto: 'Con el aire frío y húmedo, la garganta se enfría tanto que se puede congelar el vapor y cerrar el paso: motor que pierde potencia.', capa: 'hielo' }
    ]
  });

  /* ---- el perfil en la corriente: dos partículas, una zona no perturbada y una fuerza hacia arriba */
  var PERFIL_C = 'M100 170 C100 150 128 124 200 118 C270 112 340 140 380 170 Z';
  Fig.register('perfil-presiones', {
    viewBox: '0 0 480 270',
    capas: [
      { id: 'perfil', nombre: 'Perfil', visible: true, svg: '<path class="dg-wing" d="' + PERFIL_C + '"/>' + txt(240, 160, 'perfil', 'dg-lbl--fg') },
      { id: 'viento', nombre: 'Viento', visible: true, svg: '<g class="dg-wind"><line x1="8" y1="132" x2="40" y2="132"/><line x1="8" y1="170" x2="40" y2="170"/><line x1="8" y1="208" x2="40" y2="208"/></g>' +
        '<polygon class="dg-head" points="40,127 50,132 40,137"/><polygon class="dg-head" points="40,165 50,170 40,175"/><polygon class="dg-head" points="40,203 50,208 40,213"/>' },
      { id: 'zona', nombre: 'Zona no perturbada', visible: true, svg: lin(40, 62, 456, 62, 'dg-ln dg-ln--dash') + txt(44, 50, 'zona no perturbada', '', 'start') +
        '<g class="dg-dim"><line x1="162" y1="66" x2="162" y2="120"/><line x1="156" y1="66" x2="168" y2="66"/><line x1="156" y1="120" x2="168" y2="120"/></g>' + txt(144, 96, 'estrechamiento', '', 'end') },
      { id: 'particulas0', nombre: 'Partículas antes del perfil', visible: false, svg: '<circle class="dg-part--a" cx="70" cy="104" r="9"/><text class="dg-part-t" x="70" y="108">a</text>' + txt(70, 128, 'V 10 · P 5', 'dg-lbl--sm') +
        '<circle class="dg-part--b" cx="70" cy="214" r="9"/><text class="dg-part-t dg-part-t--b" x="70" y="218">b</text>' + txt(70, 238, 'V 10 · P 5', 'dg-lbl--sm') },
      { id: 'particulas1', nombre: 'Partículas junto al perfil', visible: true, svg: '<circle class="dg-part--a" cx="300" cy="96" r="9"/><text class="dg-part-t" x="300" y="100">a</text>' +
        '<circle class="dg-part--b" cx="300" cy="208" r="9"/><text class="dg-part-t dg-part-t--b" x="300" y="212">b</text>' },
      { id: 'numeros1', nombre: 'Velocidad y presión', visible: true, svg: txt(316, 80, 'V = 12 · P = 3', 'dg-lbl--lg', 'start') + txt(316, 230, 'V = 10 · P = 5', 'dg-lbl--lg', 'start') },
      { id: 'presion', nombre: 'Presión', visible: false, svg: '<ellipse class="dg-low" cx="236" cy="100" rx="118" ry="13"/><ellipse class="dg-high" cx="236" cy="192" rx="118" ry="13"/>' +
        txt(466, 108, 'menos presión', 'dg-lbl--low', 'end') + txt(466, 200, 'más presión', 'dg-lbl--high', 'end') },
      { id: 'fuerza', nombre: 'Fuerza aerodinámica', visible: false, svg: flecha(220, 150, 220, 34, 'a') + txt(232, 40, 'F', 'dg-lbl--lg dg-lbl--a', 'start') + txt(246, 56, 'fuerza aerodinámica', 'dg-lbl--a', 'start') }
    ],
    hotspots: [
      { id: 'zona', x: 440, y: 62, titulo: 'Zona no perturbada', texto: 'El aire que está lejos del perfil, que sigue con su velocidad y su presión de siempre.', capa: 'zona' },
      { id: 'estrecha', x: 162, y: 93, titulo: 'El estrechamiento', texto: 'Al meter el perfil, su parte curva de arriba deja un paso más angosto entre el perfil y la zona no perturbada. Es un Venturi.', capa: 'zona' },
      { id: 'a', x: 274, y: 96, titulo: 'Partícula (a), arriba', texto: 'Pasa por el estrechamiento: acelera a V = 12 (efecto Venturi) y su presión baja a 3 (efecto Bernoulli).', capa: 'particulas1' },
      { id: 'b', x: 274, y: 208, titulo: 'Partícula (b), abajo', texto: 'Abajo el perfil es recto y no estrecha nada: la partícula conserva V = 10 y P = 5.', capa: 'particulas1' },
      { id: 'baja', x: 340, y: 104, titulo: 'Zona de menos presión', texto: 'Arriba del perfil la presión es menor que abajo: el aire empuja menos sobre el ala.', capa: 'presion' },
      { id: 'alta', x: 340, y: 194, titulo: 'Zona de más presión', texto: 'Abajo del perfil el aire sigue empujando como siempre, más que arriba.', capa: 'presion' },
      { id: 'fuerza', x: 220, y: 92, titulo: 'La fuerza aerodinámica', texto: 'La diferencia de presión entre abajo y arriba empuja el perfil hacia arriba. Esa es la fuerza que hace volar al avión.', capa: 'fuerza' }
    ]
  });

  /* ---- la fuerza aerodinámica F (perpendicular a la cuerda) separada en sustentación y resistencia inducida */
  (function () {
    var AL = 18, O = [240, 150], c = Math.cos(AL * RAD), s = Math.sin(AL * RAD), LF = 120, Fx = O[0] + LF * s, Fy = O[1] - LF * c, Lh = LF * c, Dl = LF * s;
    var pc2 = pto(O[0], O[1], 88, AL / 2);
    Fig.register('fuerza-descompuesta', {
      viewBox: '0 0 480 270',
      capas: [
        { id: 'perfil', nombre: 'Perfil y cuerda', visible: true, svg: '<g transform="rotate(' + AL + ' ' + O[0] + ' ' + O[1] + ')"><path class="dg-wing" d="M130 150 C130 140 156 130 200 129 C250 128 310 140 350 150 C310 154 250 158 200 158 C156 158 130 156 130 150 Z"/>' +
          lin(116, 150, 364, 150, 'dg-chord') + '</g>' + txt(332, 206, 'cuerda', '', 'start') },
        { id: 'viento', nombre: 'Viento relativo', visible: true, svg: lin(16, 150, 464, 150, 'dg-ln dg-ln--dash') + flecha(18, 124, 78, 124, 's') + flecha(18, 176, 78, 176, 's') + txt(48, 112, 'viento relativo', '', 'middle') },
        { id: 'angulo', nombre: 'Ángulo α', visible: true, svg: cuna(O[0], O[1], 70, 0, AL, 'dg-arc') + txt(pc2[0] - 6, pc2[1] + 4, 'α', 'dg-lbl--lg dg-lbl--a', 'end') },
        { id: 'F', nombre: 'Fuerza aerodinámica F', visible: true, svg: flecha(O[0], O[1], Fx, Fy, 'a') + txt(Fx + 12, Fy + 6, 'F', 'dg-lbl--lg dg-lbl--a', 'start') +
          '<path class="dg-ln" d="M' + r1(O[0] + 12 * c) + ' ' + r1(O[1] + 12 * s) + ' L' + r1(O[0] + 12 * c + 12 * s) + ' ' + r1(O[1] + 12 * s - 12 * c) + ' L' + r1(O[0] + 12 * s) + ' ' + r1(O[1] - 12 * c) + '"/>' },
        { id: 'L', nombre: 'Sustentación L', visible: true, svg: lin(Fx, Fy, O[0], Fy, 'dg-ln dg-ln--dash') + flecha(O[0], O[1], O[0], O[1] - Lh, 'l') + txt(O[0] - 12, O[1] - Lh + 10, 'L', 'dg-lbl--lg dg-lbl--l', 'end') },
        { id: 'D', nombre: 'Resistencia inducida D', visible: true, svg: lin(Fx, Fy, Fx, O[1], 'dg-ln dg-ln--dash') + flecha(O[0], O[1], O[0] + Dl, O[1], 'd') + txt(O[0] + Dl + 10, O[1] - 8, 'D', 'dg-lbl--lg dg-lbl--d', 'start') }
      ],
      hotspots: [
        { id: 'F', x: r1(O[0] + LF * s * 0.3), y: r1(O[1] - LF * c * 0.3), titulo: 'La fuerza aerodinámica F', texto: 'Según el curso nace perpendicular a la cuerda. Al mismo tiempo que sostiene, crea resistencias que le restan efectividad.', capa: 'F' },
        { id: 'L', x: O[0], y: 62, titulo: 'Sustentación L', texto: 'La componente vertical, perpendicular al viento relativo: es la parte aprovechable de F.', capa: 'L' },
        { id: 'D', x: r1(O[0] + Dl + 18), y: r1(O[1] + 20), titulo: 'Resistencia inducida D', texto: 'La componente paralela al viento relativo y contraria a la trayectoria. Se crea a la vez que la sustentación y crece cuando el perfil se inclina más.', capa: 'D' },
        { id: 'alfa', x: 200, y: 142, titulo: 'El ángulo entre cuerda y viento', texto: 'Es el ángulo de ataque. El mismo ángulo aparece entre F y L: cuanto más grande, más de F se va a la resistencia.', capa: 'angulo' },
        { id: 'cuerda', x: 326, y: 178, titulo: 'La cuerda', texto: 'La línea imaginaria del borde de ataque al borde de fuga. F nace perpendicular a ella.', capa: 'perfil' },
        { id: 'viento', x: 48, y: 150, titulo: 'El viento relativo', texto: 'La referencia para medir L y D: la sustentación es perpendicular a él y la resistencia es paralela.', capa: 'viento' }
      ]
    });
  })();

  /* ---- ángulo de ataque, actitud, viento relativo y trayectoria (dos figuras con la misma geometría: una sola situación, y tres escenas con la misma actitud) */
  var AC = [290, 125];
  function aviAngulo(th) {
    var cx = AC[0], cy = AC[1];
    return '<g transform="rotate(' + th + ' ' + cx + ' ' + cy + ')"><ellipse class="dg-wing" cx="' + cx + '" cy="' + cy + '" rx="100" ry="11"/>' +
      '<path class="dg-wing" d="M' + (cx + 86) + ' ' + (cy - 4) + ' L' + (cx + 104) + ' ' + (cy - 34) + ' L' + (cx + 118) + ' ' + (cy - 34) + ' L' + (cx + 112) + ' ' + (cy + 2) + ' Z"/>' +
      '<rect class="dg-wing" x="' + (cx - 34) + '" y="' + (cy - 18) + '" width="64" height="6" rx="3"/><ellipse class="dg-prop" cx="' + (cx - 103) + '" cy="' + cy + '" rx="3" ry="24"/></g>';
  }
  /** Escena: la trayectoria sube o baja `gm` grados; viento relativo (arriba) y trayectoria (abajo) paralelos, y el ángulo entre el eje del avión y el viento. */
  function escenaAngulo(th, gm, nombre) {
    var cx = AC[0], cy = AC[1], gc = Math.cos(gm * RAD), gs = Math.sin(gm * RAD), nx = -gs, ny = -gc;   // normal hacia arriba de la trayectoria
    var wx = cx + 78 * nx, wy = cy + 78 * ny, px = cx - 78 * nx, py = cy - 78 * ny;                        // centros de las flechas
    var fm = (gm + th) / 2, lab = pto(cx, cy, 128, fm);
    return lin(cx - 270 * gc, cy - 270 * gs, cx + 170 * gc, cy + 170 * gs, 'dg-ln dg-ln--ok') +
      cuna(cx, cy, 104, gm, th, 'dg-arc') + flecha(wx - 74 * gc, wy - 74 * gs, wx + 74 * gc, wy + 74 * gs, 's') + txt(wx, wy - 14, 'viento relativo', '', 'middle') +
      flecha(px + 74 * gc, py + 74 * gs, px - 74 * gc, py - 74 * gs, 'd') + txt(px, py + 26, 'trayectoria de vuelo', '', 'middle') +
      txt(lab[0] - 4, lab[1] + 4, nombre, 'dg-lbl--lg dg-lbl--a', 'end');
  }
  var A_TH = 16, A_GM = 6;
  Fig.register('angulo-ataque', {
    viewBox: '0 0 480 250',
    capas: [
      { id: 'avion', nombre: 'Avión', visible: true, svg: aviAngulo(A_TH) },
      { id: 'horizonte', nombre: 'Horizonte', visible: true, svg: lin(20, AC[1], 460, AC[1], 'dg-ln dg-ln--dash') + txt(24, AC[1] + 16, 'horizonte', '', 'start') },
      { id: 'cuerda', nombre: 'Eje del avión (cuerda)', visible: true, svg: '<g transform="rotate(' + A_TH + ' ' + AC[0] + ' ' + AC[1] + ')">' + lin(AC[0] - 150, AC[1], AC[0] + 150, AC[1], 'dg-chord') + '</g>' },
      { id: 'actitud', nombre: 'Actitud', visible: true, svg: cuna(AC[0], AC[1], 62, 0, A_TH, 'dg-arc--i') + txt(AC[0] - 66, AC[1] + 34, 'actitud', 'dg-lbl--l', 'end') },
      { id: 'alfa', nombre: 'Ángulo de ataque α', visible: true, svg: escenaAngulo(A_TH, A_GM, 'α') }
    ],
    hotspots: (function () {
      var v = pto(AC[0], AC[1], 94, (A_TH + A_GM) / 2), a = pto(AC[0], AC[1], 48, 3), t = [AC[0] + 78 * Math.sin(A_GM * RAD) , AC[1] + 78 * Math.cos(A_GM * RAD)], w = [AC[0] - 78 * Math.sin(A_GM * RAD), AC[1] - 78 * Math.cos(A_GM * RAD)];
      return [
        { id: 'alfa', x: r1(v[0]), y: r1(v[1]) - 6, titulo: 'Ángulo de ataque', texto: 'El ángulo entre la cuerda y el viento relativo. Es siempre agudo (menor de 90°) y es el que más manejás con el volante.', capa: 'alfa' },
        { id: 'actitud', x: r1(a[0]), y: r1(a[1]), titulo: 'Actitud', texto: 'El ángulo entre el eje del avión y el horizonte: lo que ves de la nariz. No es lo mismo que el ángulo de ataque.', capa: 'actitud' },
        { id: 'viento', x: r1(w[0] + 56), y: r1(w[1] + 6), titulo: 'Viento relativo', texto: 'El aire que le llega al ala, de frente. Siempre es opuesto a la trayectoria de vuelo.', capa: 'alfa' },
        { id: 'trayectoria', x: r1(t[0] + 40), y: r1(t[1] + 4), titulo: 'Trayectoria de vuelo', texto: 'La dirección que sigue el avión en el aire: hacia dónde se mueve de verdad.', capa: 'alfa' },
        { id: 'horizonte', x: 70, y: AC[1] - 14, titulo: 'Horizonte', texto: 'La línea de referencia horizontal, con la que se mide la actitud.', capa: 'horizonte' },
        { id: 'cuerda', x: r1(AC[0] + 118 * Math.cos(A_TH * RAD)), y: r1(AC[1] + 118 * Math.sin(A_TH * RAD)) + 18, titulo: 'Cuerda', texto: 'La línea del borde de ataque al borde de fuga. Acá la dibujamos a lo largo del avión.', capa: 'cuerda' }
      ];
    })()
  });
  Fig.register('actitud-alfa', {
    viewBox: '0 0 480 250',
    capas: [
      { id: 'avion', nombre: 'Avión (8° de nariz arriba)', visible: true, svg: aviAngulo(8) + '<g transform="rotate(8 ' + AC[0] + ' ' + AC[1] + ')">' + lin(AC[0] - 150, AC[1], AC[0] + 150, AC[1], 'dg-chord') + '</g>' },
      { id: 'horizonte', nombre: 'Horizonte', visible: true, svg: lin(20, AC[1], 460, AC[1], 'dg-ln dg-ln--dash') + txt(24, AC[1] + 16, 'horizonte', '', 'start') },
      { id: 'actitud', nombre: 'Actitud 8°', visible: true, svg: cuna(AC[0], AC[1], 56, 0, 8, 'dg-arc--i') + txt(AC[0] - 62, AC[1] + 50, 'actitud 8°', 'dg-lbl--l', 'end') },
      { id: 'nivelado', nombre: 'Vuelo nivelado: α = 8°', visible: false, svg: escenaAngulo(8, 0, 'α = 8°') },
      { id: 'ascenso', nombre: 'Ascenso: α = 3°', visible: false, svg: escenaAngulo(8, 5, 'α = 3°') },
      { id: 'descenso', nombre: 'Descenso: α = 14°', visible: false, svg: escenaAngulo(8, -6, 'α = 14°') }
    ],
    hotspots: [
      { id: 'actitud', x: 236, y: 144, titulo: 'La actitud: 8° en las tres escenas', texto: 'La nariz está 8° arriba del horizonte en los tres casos. Lo que cambia es hacia dónde se mueve el avión.', capa: 'actitud' },
      { id: 'nivelado', x: 258, y: 118, titulo: 'Vuelo nivelado', texto: 'La trayectoria es horizontal: el ángulo de ataque coincide con la actitud, 8°.', capa: 'nivelado' },
      { id: 'ascenso', x: 258, y: 118, titulo: 'Ascenso', texto: 'La trayectoria sube 5°: el viento relativo llega más de frente y el ángulo de ataque es sólo 3°.', capa: 'ascenso' },
      { id: 'descenso', x: 258, y: 118, titulo: 'Descenso', texto: 'La trayectoria baja 6°: el viento le llega al ala desde más abajo y el ángulo de ataque sube a 14°.', capa: 'descenso' }
    ]
  });

  /* ---- el flujo al aumentar el ángulo de ataque: la capa turbulenta avanza desde el borde de fuga */
  (function () {
    var S1 = [[70, 115], [76, 99], [118, 85], [175, 84]], S2 = [[175, 84], [240, 83], [296, 98], [332, 110]], top = [], i, A = 12, G = 'translate(40 28) rotate(' + A + ' 200 112)';
    function bz(p, t) { var u = 1 - t; return [u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0], u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1]]; }
    for (i = 0; i <= 40; i++) top.push(bz(S1, i / 40));
    for (i = 1; i <= 40; i++) top.push(bz(S2, i / 40));
    function yEn(x) { for (var k = 1; k < top.length; k++) if (top[k][0] >= x) { var a = top[k - 1], b = top[k]; return a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1); } return top[top.length - 1][1]; }
    function tr(x, y) { var dx = x - 200, dy = y - 112, c = Math.cos(A * RAD), s = Math.sin(A * RAD); return [r1(240 + dx * c - dy * s), r1(140 + dx * s + dy * c)]; }
    function zona(pct, H) {
      var x0 = 332 - pct * 262 / 100, pts = [], x;
      for (x = x0; x < 332; x += 8) pts.push(r1(x) + ',' + r1(yEn(x)));
      pts.push('332,110');
      for (x = 332; x > x0; x -= 8) pts.push(r1(x) + ',' + r1(yEn(x) - H * Math.pow((x - x0) / (332 - x0), 0.8)));
      return '<g transform="' + G + '"><polygon class="dg-turb" points="' + pts.join(' ') + '"/></g>';
    }
    function corriente(off) { var pts = [], x; for (x = 70; x <= 340; x += 10) pts.push(r1(x) + ',' + r1(yEn(Math.min(x, 332)) - off - (x > 332 ? (x - 332) * 0.1 : 0))); return '<polyline class="dg-sl" points="' + pts.join(' ') + '"/>'; }
    Fig.register('flujo-aoa', {
      viewBox: '0 0 480 250',
      capas: [
        { id: 'perfil', nombre: 'Perfil', visible: true, svg: '<g transform="' + G + '"><path class="dg-wing" d="' + PERFIL + '"/></g>' },
        { id: 'viento', nombre: 'Viento', visible: true, svg: '<g class="dg-wind"><line x1="8" y1="104" x2="52" y2="104"/><line x1="8" y1="134" x2="52" y2="134"/><line x1="8" y1="164" x2="52" y2="164"/></g>' +
          '<polygon class="dg-head" points="52,99 62,104 52,109"/><polygon class="dg-head" points="52,129 62,134 52,139"/><polygon class="dg-head" points="52,159 62,164 52,169"/>' },
        { id: 'laminar', nombre: 'Flujo pegado', visible: true, svg: '<g transform="' + G + '">' + corriente(12) + corriente(26) + corriente(42) + '</g>' },
        { id: 't8', nombre: 'Hasta 8°', visible: true, svg: zona(12, 14) + txt(472, 22, 'Hasta 8°: poca turbulencia', 'dg-lbl--lg', 'end') },
        { id: 't12', nombre: '12°', visible: false, svg: zona(35, 26) + txt(472, 40, '12°: la turbulencia avanza', 'dg-lbl--lg', 'end') },
        { id: 't17', nombre: '16°–18°', visible: false, svg: zona(70, 44) + txt(472, 58, '16°–18°: muy extensa (crítico)', 'dg-lbl--lg', 'end') },
        { id: 't19', nombre: '18°–20°', visible: false, svg: zona(92, 60) + txt(472, 76, '18°–20°: casi toda el ala (pérdida)', 'dg-lbl--lg', 'end') }
      ],
      hotspots: (function () {
        function sobre(pct, dy) { var x0 = 332 - pct * 262 / 100, p = tr(x0, yEn(x0) - dy); return { x: p[0], y: p[1] }; }
        var l = sobre(0, 0), a = tr(120, yEn(120) - 28), h8 = sobre(12, 8), h12 = sobre(35, 8), h17 = sobre(70, 8), h19 = sobre(92, 8);
        return [
          { id: 'laminar', x: a[0], y: a[1], titulo: 'Flujo laminar', texto: 'El aire va ordenado y pegado al ala: así produce sustentación.', capa: 'laminar' },
          { id: 'a8', x: h8.x, y: h8.y, titulo: 'Hasta 8°', texto: 'Apenas hay capa turbulenta, y sólo cerca del borde de salida.', capa: 't8' },
          { id: 'a12', x: h12.x, y: h12.y, titulo: '12°', texto: 'La capa turbulenta se extiende, pero todavía se produce más sustentación.', capa: 't12' },
          { id: 'a17', x: h17.x, y: h17.y, titulo: '16°–18°', texto: 'La capa turbulenta es muy extensa. Es el ángulo de ataque crítico: la sustentación llega a su máximo y empieza a decaer.', capa: 't17' },
          { id: 'a19', x: h19.x, y: h19.y, titulo: '18°–20°', texto: 'Casi no queda capa pegada: la sustentación disminuye y el ala entra en pérdida.', capa: 't19' }
        ];
      })()
    });
  })();

  /* ---- tres perfiles con el mismo ángulo de ataque: curvo, simétrico y placa plana */
  Fig.register('perfiles-comparados', {
    viewBox: '0 0 480 320',
    capas: [
      { id: 'curvo', nombre: 'Curvo (asimétrico)', visible: true, svg: '<g transform="translate(-20 -42) rotate(8 200 104)"><path class="dg-wing" d="' + PERFIL + '"/></g>' + txt(24, 22, 'Curvo (asimétrico)', 'dg-lbl--lg', 'start') +
        flecha(400, 86, 400, 14, 'l') + txt(414, 46, 'mucha', '', 'start') },
      { id: 'simetrico', nombre: 'Simétrico', visible: true, svg: '<g transform="translate(-20 56) rotate(8 200 104)"><path class="dg-wing" d="M70 104 C100 82 280 82 332 104 C280 126 100 126 70 104 Z"/></g>' + txt(24, 120, 'Simétrico', 'dg-lbl--lg', 'start') +
        flecha(400, 184, 400, 140, 'l') + txt(414, 168, 'media', '', 'start') },
      { id: 'placa', nombre: 'Placa plana', visible: true, svg: '<g transform="translate(-20 154) rotate(8 200 104)"><rect class="dg-wing" x="70" y="102" width="262" height="4" rx="2"/></g>' + txt(24, 218, 'Placa plana', 'dg-lbl--lg', 'start') +
        flecha(400, 284, 400, 266, 'l') + txt(414, 278, 'poca', '', 'start') },
      { id: 'viento', nombre: 'Viento', visible: true, svg: flecha(6, 62, 40, 62, 's') + flecha(6, 160, 40, 160, 's') + flecha(6, 258, 40, 258, 's') }
    ],
    hotspots: [
      { id: 'curvo', x: 180, y: 38, titulo: 'Perfil curvo', texto: 'Curvo arriba y casi plano abajo: hasta cierto límite, a más curvatura hay más diferencia de presión y más sustentación.', capa: 'curvo' },
      { id: 'simetrico', x: 180, y: 138, titulo: 'Perfil simétrico', texto: 'Igual de curvo arriba y abajo: con ángulo de ataque también sustenta, sólo que menos que el curvo.', capa: 'simetrico' },
      { id: 'placa', x: 180, y: 236, titulo: 'Placa plana', texto: 'Sin espesor ni curvatura: sustenta poco y el aire se despega enseguida de la cara de arriba.', capa: 'placa' },
      { id: 'viento', x: 56, y: 160, titulo: 'Mismo ángulo para los tres', texto: 'Los tres perfiles están inclinados lo mismo respecto del viento: la diferencia de sustentación viene sólo de su forma.', capa: 'viento' }
    ]
  });

  /* ---- cortar el ala: la rodaja que queda es el perfil */
  (function () {
    function rod(y0) { return '<g transform="translate(305.6 ' + r1(y0 - 43.7) + ') scale(.42)"><path class="dg-wing" d="' + PERFIL + '"/></g>'; }
    function corte(x, y0, letra) { return lin(x, 100, x, 178, 'dg-ln dg-ln--dash dg-ln--bad') + txt(x, 92, letra, 'dg-lbl--lg') + lin(x, 100, 330, y0, 'dg-ln dg-ln--dash'); }
    Fig.register('ala-rodajas', {
      viewBox: '0 0 480 270',
      capas: [
        { id: 'ala', nombre: 'Ala vista desde arriba', visible: true, svg: '<rect class="dg-body" x="20" y="30" width="44" height="220" rx="22"/><rect class="dg-wing" x="64" y="118" width="244" height="44" rx="3"/>' + txt(186, 190, 'ala vista desde arriba', '', 'middle') },
        { id: 'corteA', nombre: 'Corte A', visible: true, svg: corte(110, 60, 'A') },
        { id: 'rodajaA', nombre: 'Rodaja A', visible: true, svg: rod(60) + txt(390, 90, 'rodaja A', '', 'middle') },
        { id: 'corteB', nombre: 'Corte B', visible: true, svg: corte(190, 140, 'B') },
        { id: 'rodajaB', nombre: 'Rodaja B', visible: true, svg: rod(140) + txt(390, 170, 'rodaja B', '', 'middle') },
        { id: 'corteC', nombre: 'Corte C', visible: true, svg: corte(268, 220, 'C') },
        { id: 'rodajaC', nombre: 'Rodaja C', visible: true, svg: rod(220) + txt(390, 250, 'rodaja C', '', 'middle') }
      ],
      hotspots: [
        { id: 'ala', x: 150, y: 150, titulo: 'El ala', texto: 'Parte del avión diseñada para producir la sustentación que iguala el peso total. Se puede pensar como muchos perfiles pegados uno junto al otro.', capa: 'ala' },
        { id: 'corte', x: 110, y: 108, titulo: 'Un corte transversal', texto: 'Si cortás el ala de adelante hacia atrás, como una feta de pan, queda a la vista la forma de su sección.', capa: 'corteA' },
        { id: 'rodaja', x: 392, y: 60, titulo: 'La rodaja es el perfil', texto: 'Lo que se ve en el corte es el perfil aerodinámico: su forma es la que importa para el aire.', capa: 'rodajaA' },
        { id: 'igual', x: 392, y: 140, titulo: 'En todo el ala, el mismo perfil', texto: 'En el C150 cada rodaja tiene la misma forma: por eso el ala se estudia como una serie de perfiles iguales.', capa: 'rodajaB' }
      ]
    });
  })();

  /* ---- la fórmula de la sustentación con quién controla cada factor */
  Fig.register('formula-sustentacion', {
    viewBox: '0 0 480 170',
    capas: [
      { id: 'formula', nombre: 'Fórmula', visible: true, svg: '<text class="dg-sym" x="22" y="62" text-anchor="middle">L</text><text class="dg-sym dg-sym--dim" x="54" y="62" text-anchor="middle">=</text><text class="dg-sym" x="88" y="62" text-anchor="middle">ρ</text>' +
        '<text class="dg-sym dg-sym--dim" x="116" y="62" text-anchor="middle">·</text><text class="dg-sym" x="144" y="62" text-anchor="middle">V²</text><text class="dg-sym dg-sym--dim" x="174" y="62" text-anchor="middle">·</text>' +
        '<text class="dg-sym" x="202" y="62" text-anchor="middle">S</text><text class="dg-sym dg-sym--dim" x="228" y="62" text-anchor="middle">·</text><text class="dg-sym" x="256" y="62" text-anchor="middle">Cf</text>' +
        '<text class="dg-sym dg-sym--dim" x="290" y="62" text-anchor="middle">·</text><text class="dg-sym" x="346" y="62" text-anchor="middle">cos α</text><text class="dg-sym dg-sym--dim" x="430" y="62" text-anchor="middle">/ 2</text>' },
      { id: 'quien', nombre: 'Quién lo controla', visible: true, svg: '<rect class="dg-tag--c" x="72" y="76" width="32" height="5" rx="2.5"/><rect class="dg-tag--p" x="124" y="76" width="40" height="5" rx="2.5"/><rect class="dg-tag--d" x="190" y="76" width="24" height="5" rx="2.5"/>' +
        '<rect class="dg-tag--d" x="236" y="76" width="40" height="5" rx="2.5"/><rect class="dg-tag--p" x="304" y="76" width="84" height="5" rx="2.5"/>' +
        txt(88, 148, 'clima', 'dg-lbl--lg') + txt(144, 148, 'piloto', 'dg-lbl--lg') + txt(202, 148, 'diseño', 'dg-lbl--lg') + txt(256, 148, 'diseño', 'dg-lbl--lg') + txt(346, 148, 'piloto', 'dg-lbl--lg') }
    ],
    hotspots: [
      { id: 'L', x: 22, y: 108, titulo: 'L: la sustentación', texto: 'La fuerza hacia arriba que sostiene al avión. Es lo que se obtiene al combinar todo lo demás.', capa: 'formula' },
      { id: 'ro', x: 88, y: 108, titulo: 'ρ: la densidad del aire', texto: 'Cuántas partículas de aire hay en cada metro cúbico. La pone el clima: con calor el aire es menos denso y el ala sustenta menos.', capa: 'formula' },
      { id: 'v2', x: 144, y: 108, titulo: 'V²: la velocidad al cuadrado', texto: 'Es el factor que más rinde: al duplicar la velocidad, la sustentación se multiplica por cuatro. La manejás vos con el acelerador y el volante.', capa: 'formula' },
      { id: 'S', x: 202, y: 108, titulo: 'S: la superficie alar', texto: 'El área de las alas: más ala, más sustentación. La fija el diseño del avión y casi no podés cambiarla.', capa: 'formula' },
      { id: 'Cf', x: 256, y: 108, titulo: 'Cf: el coeficiente aerodinámico', texto: 'Depende de la forma del perfil, sobre todo de su curvatura, que viene del diseño. Los flaps la cambian en vuelo.', capa: 'formula' },
      { id: 'alfa', x: 346, y: 108, titulo: 'cos α: el ángulo de ataque', texto: 'Lo manejás con el volante. En el curso entra como cos α; en otros libros va dentro del coeficiente CL. Lo que importa es que, hasta el ángulo crítico, más ángulo da más sustentación.', capa: 'formula' }
    ]
  });

  /* ================================================================== AER-03: la pérdida */
  /** El C150 de perfil (mira a la derecha, centrado en 240,150). rojo = alas en pérdida. */
  function aviSvg(rojo) {
    return '<path class="dg-body" d="M138 134 L148 98 L164 98 L172 130 L284 126 C312 126 332 138 336 152 C332 166 312 172 286 172 L178 158 Z"/>' +
      '<rect class="dg-body" x="124" y="132" width="54" height="7" rx="3.5"/><path class="' + (rojo ? 'dg-zbad' : 'dg-wing') + '" d="M206 108 L292 108 L296 115 L202 115 Z"/>' +
      '<line class="dg-ln" x1="232" y1="160" x2="220" y2="115"/><line class="dg-ln" x1="268" y1="164" x2="280" y2="115"/>' +
      '<line class="dg-ln" x1="244" y1="170" x2="240" y2="190"/><circle class="dg-body" cx="240" cy="197" r="9"/><line class="dg-ln" x1="306" y1="168" x2="308" y2="186"/><circle class="dg-body" cx="308" cy="192" r="7"/>' +
      '<ellipse class="dg-prop" cx="343" cy="150" rx="4" ry="34"/>';
  }
  /** El C150 con su centro en (cx, cy) y escala k. */
  function aviEn(cx, cy, k, rojo) { return '<g transform="translate(' + r1(cx) + ' ' + r1(cy) + ') scale(' + k + ') translate(-240 -150)">' + aviSvg(rojo) + '</g>'; }
  /** El C150 visto desde arriba (la nariz mira hacia arriba): alas verdes o rojas. */
  function aviArriba(cx, cy, rojo) {
    return '<rect class="dg-body" x="' + (cx - 5) + '" y="' + (cy - 34) + '" width="10" height="64" rx="5"/><rect class="' + (rojo ? 'dg-zbad' : 'dg-zok') + '" x="' + (cx - 40) + '" y="' + (cy - 14) + '" width="80" height="15" rx="3"/>' +
      '<rect class="dg-body" x="' + (cx - 16) + '" y="' + (cy + 20) + '" width="32" height="7" rx="2"/><line class="dg-ln" x1="' + (cx - 11) + '" y1="' + (cy - 36) + '" x2="' + (cx + 11) + '" y2="' + (cy - 36) + '"/>';
  }

  /* ---- la curva de sustentación contra el ángulo de ataque: el pico, la caída y las alas en rojo */
  (function () {
    var X0 = 60, PX = 16.25, Y0 = 220, PY = 112.5;
    function X(a) { return X0 + PX * a; }
    function Y(c) { return Y0 - PY * c; }
    var P = [[0, 0.12], [4, 0.46], [8, 0.80], [12, 1.12], [15, 1.30], [17, 1.36], [18, 1.34], [20, 1.10], [22, 0.92], [24, 0.84]];
    function f(a) {
      var i = 0; while (i < P.length - 2 && a > P[i + 1][0]) i++;
      var p0 = P[Math.max(0, i - 1)][1], p1 = P[i][1], p2 = P[i + 1][1], p3 = P[Math.min(P.length - 1, i + 2)][1], t = (a - P[i][0]) / (P[i + 1][0] - P[i][0]), t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
    function trazo(a, b, cls) { var pts = [], x; for (x = a; x <= b + 1e-9; x += 0.5) pts.push(r1(X(x)) + ',' + r1(Y(f(x)))); return '<polyline class="' + cls + '" points="' + pts.join(' ') + '"/>'; }
    var pico = [X(17), Y(f(17))];
    Fig.register('curva-sustentacion', {
      viewBox: '0 0 480 262',
      capas: [
        { id: 'ejes', nombre: 'Ejes', visible: true, svg: lin(X0, Y0, 462, Y0) + '<polygon class="dg-fillfg" points="466,220 456,215 456,225"/>' + lin(X0, Y0, X0, 26) + '<polygon class="dg-fillfg" points="60,22 55,32 65,32"/>' +
          txt(262, 252, 'Ángulo de ataque α (grados)', 'dg-lbl--lg') + '<text class="dg-lbl dg-lbl--lg" transform="rotate(-90 20 128)" x="20" y="128" text-anchor="middle">Sustentación (CL)</text>' +
          txt(X(0), Y0 + 16, '0°', 'dg-lbl--sm') + txt(X(4), Y0 + 16, '4°', 'dg-lbl--sm') + txt(X(8), Y0 + 16, '8°', 'dg-lbl--sm') + txt(X(24), Y0 + 16, '24°', 'dg-lbl--sm') },
        { id: 'curva', nombre: 'Curva de sustentación', visible: true, svg: trazo(0, 17, 'dg-curve') + trazo(17, 24, 'dg-curve dg-curve--bad') },
        { id: 'marcas', nombre: 'Marcas 12°, 18° y 20°', visible: true, svg: [12, 18, 20].map(function (a) {
          return lin(X(a), Y0, X(a), Y(f(a)), 'dg-ln dg-ln--dash') + '<circle class="dg-pt" cx="' + r1(X(a)) + '" cy="' + r1(Y(f(a))) + '" r="4.5"/>' + txt(X(a), Y0 + 16, a + '°', 'dg-lbl--lg dg-lbl--fg');
        }).join('') },
        { id: 'pico', nombre: 'El pico', visible: true, svg: lin(X0, pico[1], pico[0], pico[1], 'dg-ln dg-ln--dash') + '<circle class="dg-pico" cx="' + r1(pico[0]) + '" cy="' + r1(pico[1]) + '" r="7"/>' +
          lin(pico[0] - 6, pico[1] - 8, pico[0] - 38, 38, 'dg-ln') + txt(pico[0] - 40, 32, 'pico: sustentación máxima', 'dg-lbl--lg dg-lbl--a', 'end') + txt(X0 + 6, pico[1] - 6, 'CL máx', 'dg-lbl--lg', 'start') },
        { id: 'avion', nombre: 'El C150 desde arriba', visible: true, svg: aviArriba(424, 70, false) + txt(424, 118, 'alas bien', 'dg-lbl--sm') },
        { id: 'perdida', nombre: 'Pérdida', visible: false, svg: '<rect class="dg-zona-perdida" x="' + r1(X(18)) + '" y="30" width="' + r1(462 - X(18)) + '" height="190"/>' +
          aviArriba(424, 70, true) + txt(424, 118, 'alas en pérdida', 'dg-lbl--sm dg-lbl--w') + txt(X(21.3), 168, 'ala en pérdida', 'dg-lbl--lg dg-lbl--w') }
      ],
      hotspots: [
        { id: 'a12', x: r1(X(12)), y: r1(Y(f(12))) - 14, titulo: '12°: todavía sube', texto: 'A 12° el ala sigue produciendo más sustentación a medida que subís el ángulo: el aire va casi todo pegado.', capa: 'marcas' },
        { id: 'pico', x: r1(pico[0]), y: r1(pico[1]) - 20, titulo: 'El pico: sustentación máxima', texto: 'Acá la curva deja de subir: es la sustentación máxima (CL máx) y el ángulo de ataque crítico. Más allá del pico, la sustentación empieza a caer.', capa: 'pico' },
        { id: 'a18', x: r1(X(18)) + 14, y: r1(Y(f(18))) + 16, titulo: '18°: ya pasaste el pico', texto: 'Apenas pasado el pico la sustentación empieza a decaer, aunque todavía parezca mucha.', capa: 'marcas' },
        { id: 'a20', x: r1(X(20)) + 16, y: r1(Y(f(20))) + 18, titulo: '20°: en pérdida', texto: 'Con unos 20° la sustentación se pierde rápido: el ala está en pérdida. En el avioncito de arriba, las alas se ponen rojas.', capa: 'marcas' },
        { id: 'avion', x: 424, y: 52, titulo: 'El C150 visto desde arriba', texto: 'Con las alas verdes, el ala sustenta con normalidad. Prendé la capa "Pérdida" para verlas rojas, como en la figura del curso.', capa: 'avion' },
        { id: 'eje', x: 96, y: 150, titulo: 'Cuánto más alto el punto, más sustentación', texto: 'El eje vertical es el coeficiente de sustentación (CL): cuánta sustentación produce el ala con cada ángulo de ataque.', capa: 'ejes' }
      ]
    });
  })();

  /* ---- el aterrizaje como pérdida controlada: en el redondeo sube el ángulo de ataque y la sustentación baja justo al tocar */
  Fig.register('aterrizaje-alfa', {
    viewBox: '0 0 480 250',
    capas: [
      { id: 'suelo', nombre: 'Pista', visible: true, svg: '<rect class="dg-ground" x="0" y="206" width="480" height="44"/>' + lin(0, 206, 480, 206) + '<g class="dg-fillfg"><rect x="40" y="226" width="34" height="5"/><rect x="110" y="226" width="34" height="5"/><rect x="180" y="226" width="34" height="5"/><rect x="250" y="226" width="34" height="5"/><rect x="320" y="226" width="34" height="5"/><rect x="390" y="226" width="34" height="5"/></g>' + txt(466, 244, 'pista', 'dg-lbl--sm', 'end') },
      { id: 'trayectoria', nombre: 'Trayectoria', visible: true, svg: '<path class="dg-ln dg-ln--dash" d="M90 94 L170 128 C215 148 260 166 300 174 C325 179 345 180 375 180"/>' },
      { id: 'avion', nombre: 'Avión', visible: true, svg: aviEn(90, 94, 0.5, false) },
      { id: 'sustentacion', nombre: 'Sustentación', visible: true, svg: flecha(90, 68, 90, 40, 'l') },
      { id: 'sustentacion-t', nombre: 'Rótulo de la sustentación', visible: true, svg: txt(90, 32, 'sustentación', 'dg-lbl--sm dg-lbl--l') },      // el rótulo va aparte: al achicar la flecha (escala 0.3 en la animación) no se achica el texto
      { id: 'peso', nombre: 'Peso', visible: true, svg: flecha(90, 98, 90, 126, 'w') + txt(90, 138, 'peso', 'dg-lbl--sm dg-lbl--w') },
      { id: 'lectura', nombre: 'Ángulo de ataque', visible: true, svg: txt(470, 40, 'α moderado', 'dg-lbl--lg dg-lbl--a', 'end') }
    ],
    hotspots: [
      { id: 'final', x: 90, y: 74, titulo: 'Final', texto: 'En la aproximación volás con un ángulo de ataque moderado: la sustentación sostiene el peso y bajás por la trayectoria.', capa: 'avion' },
      { id: 'redondeo', x: 236, y: 162, titulo: 'El redondeo', texto: 'Cerca de la pista subís la nariz: el ángulo de ataque sube y, con la velocidad cayendo, la sustentación disminuye.', capa: 'trayectoria' },
      { id: 'contacto', x: 360, y: 168, titulo: 'El contacto', texto: 'Las ruedas tocan con el ala cerca del ángulo crítico: un aterrizaje es una pérdida provocada que coincide con el contacto.', capa: 'trayectoria' },
      { id: 'sust', x: 90, y: 54, titulo: 'La sustentación', texto: 'Mientras sostiene al avión es del tamaño del peso; al tocar, ya casi no hace falta.', capa: 'sustentacion' },
      { id: 'peso', x: 90, y: 112, titulo: 'El peso', texto: 'Siempre el mismo: la gravedad no cambia. Cuando la sustentación baja, el avión se apoya en las ruedas.', capa: 'peso' },
      { id: 'pista', x: 240, y: 216, titulo: 'La pista', texto: 'El contacto ocurre cuando el ala ya está en el borde de la pérdida y el avión está a un palmo del suelo.', capa: 'suelo' }
    ]
  });

  /* ---- tres C150 en el túnel: liviano, pesado y a 8 000 ft; el mismo ángulo crítico en los tres */
  Fig.register('tres-perdidas', {
    viewBox: '0 0 480 262',
    capas: [
      { id: 'aviones', nombre: 'Los tres aviones', visible: true, svg: aviEn(80, 96, 0.42, false) + aviEn(240, 96, 0.42, false) + aviEn(400, 96, 0.42, false) +
        txt(80, 168, 'Liviano', 'dg-lbl--lg dg-lbl--fg') + txt(240, 168, 'Pesado', 'dg-lbl--lg dg-lbl--fg') + txt(400, 168, 'Liviano', 'dg-lbl--lg dg-lbl--fg') +
        txt(80, 184, 'nivel del mar', 'dg-lbl--sm') + txt(240, 184, 'nivel del mar', 'dg-lbl--sm') + txt(400, 184, '8 000 ft', 'dg-lbl--lg dg-lbl--a') },
      { id: 'pesos', nombre: 'Pesos', visible: true, svg: flecha(80, 120, 80, 142, 'w') + flecha(240, 120, 240, 156, 'w') + flecha(400, 120, 400, 142, 'w') +
        txt(80, 204, '1 100 lb', 'dg-lbl--sm') + txt(240, 204, '1 600 lb', 'dg-lbl--sm') + txt(400, 204, '1 100 lb', 'dg-lbl--sm') },
      { id: 'alfa', nombre: 'Ángulo crítico', visible: false, svg: '<rect class="dg-tag--d" x="30" y="34" width="100" height="22" rx="11"/><rect class="dg-tag--d" x="190" y="34" width="100" height="22" rx="11"/><rect class="dg-tag--d" x="350" y="34" width="100" height="22" rx="11"/>' +
        '<text class="dg-lbl dg-lbl--ink" x="80" y="49" text-anchor="middle">α crítico</text><text class="dg-lbl dg-lbl--ink" x="240" y="49" text-anchor="middle">α crítico</text><text class="dg-lbl dg-lbl--ink" x="400" y="49" text-anchor="middle">α crítico</text>' +
        '<text class="dg-sym" x="160" y="52" text-anchor="middle">=</text><text class="dg-sym" x="320" y="52" text-anchor="middle">=</text>' },
      { id: 'ias', nombre: 'Velocidad indicada de pérdida (IAS)', visible: false, svg: '<text class="dg-lbl dg-lbl--lg dg-lbl--l" x="80" y="228" text-anchor="middle">IAS 39 kt</text><text class="dg-lbl dg-lbl--lg dg-lbl--l" x="240" y="228" text-anchor="middle">IAS 47 kt</text><text class="dg-lbl dg-lbl--lg dg-lbl--l" x="400" y="228" text-anchor="middle">IAS 39 kt</text>' },
      { id: 'tas', nombre: 'Velocidad verdadera de pérdida (TAS)', visible: false, svg: '<text class="dg-lbl dg-lbl--lg dg-lbl--a" x="80" y="248" text-anchor="middle">TAS 39 kt</text><text class="dg-lbl dg-lbl--lg dg-lbl--a" x="240" y="248" text-anchor="middle">TAS 47 kt</text><text class="dg-lbl dg-lbl--lg dg-lbl--a" x="400" y="248" text-anchor="middle">TAS 44 kt</text>' }
    ],
    hotspots: [
      { id: 'liviano', x: 80, y: 96, titulo: 'C150 liviano', texto: 'Con poco peso (1 100 lb) el ala necesita menos sustentación y llega al ángulo crítico a menor velocidad.', capa: 'aviones' },
      { id: 'pesado', x: 240, y: 96, titulo: 'C150 pesado', texto: 'Con más peso (1 600 lb) hay que volar más rápido para sostenerlo: la pérdida llega a mayor velocidad.', capa: 'aviones' },
      { id: 'altura', x: 400, y: 96, titulo: 'C150 liviano a 8 000 ft', texto: 'El aire es menos denso: su velocidad verdadera de pérdida es mayor, pero la que marca el anemómetro es la misma que abajo.', capa: 'aviones' },
      { id: 'alfa', x: 160, y: 66, titulo: 'El mismo ángulo en los tres', texto: 'El ángulo de ataque crítico no depende del peso ni de la altitud: es el ángulo al que el ala se despega.', capa: 'alfa' },
      { id: 'ias', x: 240, y: 214, titulo: 'Velocidad indicada (IAS)', texto: 'La que marca el anemómetro. Sube con el peso, pero no cambia con la altitud.', capa: 'ias' },
      { id: 'tas', x: 400, y: 234, titulo: 'Velocidad verdadera (TAS)', texto: 'La velocidad real a través del aire. Con la altitud sube, aunque el anemómetro siga marcando lo mismo. Los números son aproximados.', capa: 'tas' }
    ]
  });

  /* ---- el aviso de pérdida del C150: toma en el borde de ataque, tubo y bocina neumática */
  (function () {
    var G = 'translate(-30 20) scale(1.25)';
    Fig.register('bocina-ala', {
      viewBox: '0 0 480 250',
      capas: [
        { id: 'perfil', nombre: 'Ala (corte)', visible: true, svg: '<g transform="' + G + '"><path class="dg-wing" d="' + PERFIL + '"/></g>' + txt(250, 194, 'ala izquierda, vista de costado', 'dg-lbl--sm') },
        { id: 'toma', nombre: 'Toma del borde de ataque', visible: true, svg: '<circle class="dg-toma" cx="59" cy="163" r="5"/>' + txt(30, 204, 'toma en el borde de ataque', 'dg-lbl--lg dg-lbl--fg', 'start') },
        { id: 'conducto', nombre: 'Tubito', visible: true, svg: '<path class="dg-pipe" d="M63 163 C110 168 150 158 214 156"/>' },
        { id: 'bocina', nombre: 'Bocina neumática', visible: true, svg: '<polygon class="dg-glass" points="214,150 262,138 262,168 214,162"/>' + txt(262, 122, 'bocina neumática', 'dg-lbl--lg dg-lbl--fg', 'middle') },
        { id: 'aspirar', nombre: 'Aspirar en la toma', visible: false, svg: flecha(6, 163, 48, 163, 'a') + txt(26, 148, 'aspirá', 'dg-lbl--lg dg-lbl--a') },
        { id: 'sonido', nombre: 'Suena', visible: false, svg: '<g class="dg-sonido"><path d="M276 144 Q290 153 276 162"/><path d="M290 134 Q312 153 290 172"/><path d="M304 124 Q334 153 304 182"/></g>' + txt(350, 156, '¡piiiii!', 'dg-lbl--lg dg-lbl--a', 'start') }
      ],
      hotspots: [
        { id: 'toma', x: 59, y: 163, titulo: 'La toma de aire', texto: 'Una abertura chica en el borde de ataque del ala izquierda. Cuando el ala se acerca al ángulo crítico, el aire que pasa por ahí hace sonar la bocina.', capa: 'toma' },
        { id: 'tubo', x: 140, y: 168, titulo: 'El tubito', texto: 'Une la toma con la bocina. Por eso funciona sin electricidad: lo mueve el propio aire.', capa: 'conducto' },
        { id: 'bocina', x: 238, y: 158, titulo: 'La bocina neumática', texto: 'Suena entre 5 y 10 nudos antes de la pérdida: te da tiempo para bajar la nariz. En el prevuelo se prueba aspirando en la toma.', capa: 'bocina' },
        { id: 'aspirar', x: 28, y: 163, titulo: 'La prueba del prevuelo', texto: 'Aspirás con suavidad en la toma, con el avión apagado: si la bocina suena, el aviso funciona.', capa: 'aspirar' },
        { id: 'sonido', x: 330, y: 154, titulo: 'El pitido', texto: 'Un sonido agudo y continuo. Si lo escuchás en vuelo, es el aviso de que estás cerca de la pérdida.', capa: 'sonido' }
      ]
    });
  })();

  /* ---- la recuperación de la pérdida: nariz abajo, toda la potencia y, con velocidad, recuperar la altura */
  Fig.register('recuperacion-perdida', {
    viewBox: '0 0 480 260',
    capas: [
      { id: 'horizonte', nombre: 'Horizonte', visible: true, svg: lin(10, 120, 470, 120, 'dg-ln dg-ln--dash') + txt(14, 112, 'horizonte', 'dg-lbl--sm', 'start') },
      { id: 'trayectoria', nombre: 'Trayectoria', visible: true, svg: '<path class="dg-ln dg-ln--dash" d="M80 80 C120 90 170 130 200 150 C230 172 255 186 285 192 C340 198 390 170 430 140"/>' },
      { id: 'avion', nombre: 'Avión', visible: true, svg: aviEn(80, 80, 0.5, false) },
      { id: 'paso1', nombre: 'Paso 1: nariz abajo', visible: false, svg: '<circle class="dg-num-bg" cx="196" cy="112" r="12"/><text class="dg-num" x="196" y="116" text-anchor="middle">1</text>' + txt(212, 116, 'nariz abajo del horizonte', 'dg-lbl--lg dg-lbl--fg', 'start') },
      { id: 'paso2', nombre: 'Paso 2: toda la potencia', visible: false, svg: '<circle class="dg-num-bg" cx="268" cy="232" r="12"/><text class="dg-num" x="268" y="236" text-anchor="middle">2</text>' + txt(284, 236, 'toda la potencia', 'dg-lbl--lg dg-lbl--fg', 'start') },
      { id: 'paso3', nombre: 'Paso 3: recuperar altura', visible: false, svg: '<circle class="dg-num-bg" cx="318" cy="66" r="12"/><text class="dg-num" x="318" y="70" text-anchor="middle">3</text>' + txt(334, 70, 'recuperá la altura', 'dg-lbl--lg dg-lbl--fg', 'start') + txt(334, 86, 'con velocidad suficiente', 'dg-lbl--sm', 'start') },
      { id: 'potencia', nombre: 'Potencia', visible: false, svg: flecha(150, 80, 196, 80, 't') },
      { id: 'estado', nombre: 'Estado', visible: true, svg: txt(80, 30, 'en pérdida', 'dg-lbl--lg dg-lbl--w') }
    ],
    hotspots: [
      { id: 'perdida', x: 80, y: 62, titulo: 'En pérdida', texto: 'Sentís el aviso y el avión se pone blando: el ala pasó el ángulo crítico y la nariz tiende a caer.', capa: 'avion' },
      { id: 'p1', x: 196, y: 134, titulo: 'Primero, la nariz', texto: 'Bajás la nariz por debajo del horizonte: así baja el ángulo de ataque, y con menos ángulo el ala vuelve a sustentar.', capa: 'trayectoria' },
      { id: 'p2', x: 268, y: 214, titulo: 'Segundo, la potencia', texto: 'Toda la potencia: el avión gana velocidad más rápido y se pierde menos altura.', capa: 'trayectoria' },
      { id: 'p3', x: 318, y: 108, titulo: 'Tercero, la altura', texto: 'Cuando el avión ya tiene velocidad suficiente, tirás con suavidad para recuperar la altura que perdiste. Si tirás antes, volvés al ángulo crítico.', capa: 'trayectoria' },
      { id: 'hor', x: 440, y: 112, titulo: 'El horizonte', texto: 'La referencia para bajar la nariz: la dejás por debajo de esta línea.', capa: 'horizonte' }
    ]
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = Fig;
})(root.C150);
