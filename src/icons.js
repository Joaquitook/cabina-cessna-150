var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * icons.js — C150.Icons: un solo sprite SVG inline con íconos de línea de 24×24 (contrato UI/UX v4 §3).
 *
 *   C150.Icons.names          → ['home', 'cabin', …]
 *   C150.Icons.has(name)      → boolean
 *   C150.Icons.paths[name]    → marcado interno del <symbol> (sólo texto estático, nunca datos)
 *   C150.Icons.inject()       → inserta el sprite una sola vez (se llama solo al cargar)
 *   C150.Kit.icon(name, size) → (kit.js) <svg class="icon"><use href="#i-name"/></svg>
 *
 * Todos los trazos usan stroke="currentColor" por herencia desde la clase .icon (styles.css):
 * el color lo da el texto que los rodea. Sin emoji, sin imágenes externas.
 */
(function (C150) {
  'use strict';

  var P = {
    home: '<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
    cabin: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="8.5" cy="12" r="2.6"/><circle cx="15.5" cy="12" r="2.6"/><path d="M8.5 10.6v1.4h1.1M15.5 10.6v1.4h1.1"/>',
    book: '<path d="M4 5.5c2.5-1 5-1 8 .8 3-1.8 5.5-1.8 8-.8v13c-2.5-1-5-1-8 .8-3-1.8-5.5-1.8-8-.8z"/><path d="M12 6.3v13"/>',
    route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/>',
    checklist: '<path d="m4 6.5 1.8 1.8L9 5M4 12.5l1.8 1.8L9 11M4 18.5l1.8 1.8L9 17"/><path d="M13 7h7M13 13h7M13 19h7"/>',
    plane: '<path d="M12 3c.9 0 1.4 1 1.4 2.6V10l8 2.4v2l-8-1v4.6l2.6 2v1.6L12 20.6l-4 1v-1.6l2.6-2v-4.6l-8 1v-2l8-2.4V5.6C10.6 4 11.1 3 12 3z"/>',
    wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h16a3 3 0 1 1-3 3M3 16.5h7"/>',
    quiz: '<path d="M4 5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3.5V16.5H6a2 2 0 0 1-2-2z"/><path d="M10 8.5a2 2 0 1 1 2.9 1.8c-.6.3-.9.7-.9 1.4M12 13.7v.1"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2.9-1.2 1.8M12 16.8v.1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    auto: '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5v15"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor"/>',
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    pause: '<path d="M8.5 5v14M15.5 5v14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    lock: '<rect x="5.5" y="11" width="13" height="9.5" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
    flag: '<path d="M5.5 21V4"/><path d="M5.5 5h11l-2 3.5 2 3.5h-11"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5V4.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v6.5a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.6 14a1.5 1.5 0 0 1 2.4-1.8L9 15"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>',
    warning: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.4v.1"/>',
    'chevron-right': '<path d="m9 5 7 7-7 7"/>',
    'chevron-left': '<path d="m15 5-7 7 7 7"/>',
    'chevron-down': '<path d="m5 9 7 7 7-7"/>',
    'chevron-up': '<path d="m5 15 7-7 7 7"/>',
    'arrow-right': '<path d="M4 12h16M14 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><path d="M15 4.5v5M9 14.5v5"/>',
    cap: '<path d="m2.5 9.5 9.5-4.5 9.5 4.5L12 14z"/><path d="M6.5 11.7V16c1.5 1.5 3.4 2.2 5.5 2.2s4-.7 5.5-2.2v-4.3M21.5 9.5V15"/>',
    map: '<path d="m3.5 6.5 5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 14 4-4.5"/><path d="M12 14v.1"/>',
    engine: '<path d="M5 9.5h14v8H5z"/><path d="M8 9.5v-3h8v3"/><path d="M2.5 12v3M21.5 12v3"/><path d="M9 12.5v2.5M12 12.5v2.5M15 12.5v2.5"/>',
    flaps: '<path d="M3 9.5c4-2.5 10-3 15-1.3l3.5 1.2-14 .8z"/><path d="m10 10.7 4 7.8"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    'sound-off': '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>',
    layers: '<path d="m12 3.5 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5"/>',
    back: '<path d="M10 6 4 12l6 6M4 12h16"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/>',
    trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6h-3v1.5a3 3 0 0 0 3 3M16.5 6h3v1.5a3 3 0 0 1-3 3"/><path d="M12 13.5V17M10 17h4v3h-4zM8.5 20h7"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    camera: '<path d="M3 8.5h4l1.5-2.5h7L17 8.5h4V19H3z"/><circle cx="12" cy="13.5" r="3.4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.1M4.5 12h.1M4.5 18h.1"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2v.6h5v-.6c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    bolt: '<path d="M13 3 5.5 13.5H11L10 21l8.5-11H13z"/>',
    drop: '<path d="M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    external: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V9a1.5 1.5 0 0 1 1.5-1.5H10"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.1M9 10h.1M12 10h.1M15 10h.1M18 10h.1M7 14h10"/>',
    dot: '<circle cx="12" cy="12" r="3"/>'
  };

  var names = Object.keys(P);
  var injected = false;

  function symbolMarkup() {
    var out = '';
    for (var i = 0; i < names.length; i++) out += '<symbol id="i-' + names[i] + '" viewBox="0 0 24 24">' + P[names[i]] + '</symbol>';
    return out;
  }

  /** Inserta el sprite una sola vez (marcado estático de este archivo, sin datos de usuario). */
  function inject() {
    if (injected || typeof document === 'undefined' || !document.body) return false;
    if (document.getElementById('c150-sprite')) { injected = true; return true; }
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('id', 'c150-sprite');
    svg.setAttribute('class', 'kit-sprite');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.innerHTML = symbolMarkup();
    document.body.insertBefore(svg, document.body.firstChild);
    injected = true;
    return true;
  }

  C150.Icons = {
    names: names,
    paths: P,
    has: function (n) { return Object.prototype.hasOwnProperty.call(P, n); },
    symbols: symbolMarkup,
    inject: inject
  };

  if (typeof document !== 'undefined') {
    if (document.body) inject();
    else document.addEventListener('DOMContentLoaded', inject);
  }
})(root.C150);
