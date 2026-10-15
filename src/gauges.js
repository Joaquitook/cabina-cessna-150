var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * gauges.js — C150.Gauges (contrato §4): dibuja con canvas 2D la cara completa de cada instrumento
 * del Cessna 150M 1976 (bisel, cara negra mate, marcas, agujas con sombra y reflejo del vidrio).
 * No usa THREE ni toca el DOM al cargar: recibe un CanvasRenderingContext2D ya creado.
 *
 * API:
 *   C150.Gauges.IDS                          ids que sabe dibujar (columna "gauge" del contrato §5)
 *   C150.Gauges.size(id)    → { w, h, round }  tamaño de canvas recomendado (round = cara redonda)
 *   C150.Gauges.draw(id, ctx, w, h, state)   dibuja todo (reinicia la transformación del contexto)
 *   C150.Gauges.signature(id, state) → string  valores MOSTRADOS redondeados; si no cambia, no redibujar
 *   C150.Gauges.VOR                          estación VOR ficticia que usa el indicador VOR
 *
 * Decisiones donde el contrato no es explícito:
 *  - Los instrumentos redondos dejan las esquinas TRANSPARENTES (usar CircleGeometry o alphaTest).
 *    Los rectangulares (clusters, radios, brújula, escalas de trim y flaps) llenan todo el canvas.
 *  - Marcas de velocidad, RPM, aceite y succión: C150.Sim.limits(state) si existe; si no, los valores
 *    del 150M (o del A150M si state.variant === 'A150M') escritos abajo.
 *  - Combustible: como en sim.js, state.fuel.leftGal/rightGal es el combustible de cada tanque
 *    estándar de 13 gal INCLUIDOS 1,75 gal no utilizables: la aguja marca "E" con 1,75 gal y "F" con
 *    13 gal. Termómetro de aceite y combustible son eléctricos: sin barra energizada
 *    (busVolts <= 8) las agujas caen al tope izquierdo / E.
 *  - Horizonte: con aiSpin < 1 muestra una mezcla entre una actitud "volteada" fija (25° de alabeo,
 *    -10° de cabeceo) y la real; queda exacto desde aiSpin ≈ 0,95.
 *  - Direccional: muestra state.air.hiHeading. C150.Sim ya congela ese valor con hiSpin < 0,7; si el
 *    simulador NO está cargado (vistas de prueba), lo congela este módulo (memoria por objeto state)
 *    y la perilla (hiCorrection) igual gira la tarjeta.
 *  - Brújula: tira ancha centrada en state.air.heading. Como en la brújula real, los números aparecen
 *    "al revés" (a la derecha de N se ve 33, a la izquierda 3): es lo que ve el piloto.
 *  - OAT: usa state.air.oatC (°C, salida extra de sim.js) o state.air.oat; si no hay ninguno,
 *    atmósfera estándar ISA según la altitud.
 *  - Horómetro: usa state.engine.tachHours si existe; si no, lo acumula aquí con state.time
 *    (tiempo de tacómetro = tiempo × RPM / 2500) desde una lectura inicial ilustrativa.
 *  - VOR: estación ficticia "VOR de práctica" en 113,90 MHz, 40 km al norte del aeródromo.
 *    La aguja funciona con la radio encendida, barra energizada y NAV activa sintonizada en 113,90.
 *  - Transpondedor: la luz de respuesta parpadea con state.time cuando el modo es ON o ALT.
 */
(function (C150) {
  'use strict';

  /* ------------------------------------------------------------------ constantes */
  var TAU = Math.PI * 2;
  var E = {};                                     // objeto vacío para accesos seguros
  var FONT_DISP = "'Barlow Condensed', 'Arial Narrow', sans-serif";
  var FONT_DATA = "'B612 Mono', ui-monospace, monospace";
  var FACE_R = 89;                                // radio de la cara; el instrumento mide 200 unidades
  var COL = {
    ink: '#EFEEE7', inkDim: '#A7AAAC', print: '#C9CDD0',
    arcWhite: '#F2F2F2', arcGreen: '#2E9A4E', arcYellow: '#D9A400', arcRed: '#C7362B',
    orange: '#F28C2F', orangeEdge: '#8A4511',
    amber: '#FFB547', amberOff: 'rgba(255,181,71,0.07)',
    green: '#86F29C', greenOff: 'rgba(134,242,156,0.06)'
  };
  var KT_TO_MPH = 1.150779;
  var INHG_TO_HPA = 33.8639;
  var UNUSABLE_PER_TANK = 1.75;                   // gal no utilizables por tanque estándar (POH)
  var USABLE_PER_TANK = 11.25;                    // gal utilizables por tanque estándar (22,5 / 2)
  var TACH_BASE_HOURS = 2861.4;                   // lectura inicial ilustrativa del horómetro
  var TUMBLE_BANK = 25, TUMBLE_PITCH = -10;       // actitud del horizonte sin girar
  var AI_PPD = 2.2;                               // unidades por grado de cabeceo en el horizonte
  var COMPASS_PPD = 5;                            // unidades por grado en la tira de la brújula
  var VOR = { name: 'VOR de práctica', freq: 113.90, x: 0, z: -40000, rangeM: 150000 };

  var LIMITS_150M = {
    vso: 42, vs1: 47, vfe: 85, vno: 107, vne: 141, va: 97, vx: 56, vy: 68, glide: 60, rotate: 50,
    whiteArc: [42, 85], greenArc: [47, 107], yellowArc: [107, 141], redLine: 141,
    rpmGreen: [2000, 2750], rpmRed: 2750, oilTempGreen: [100, 240], oilTempRed: 240,
    oilPressGreen: [30, 60], oilPressMin: 10, oilPressMax: 100, suctionGreen: [4.6, 5.4]
  };
  var LIMITS_A150M = {
    vso: 42, vs1: 47, vfe: 85, vno: 123, vne: 164, va: 105, vx: 56, vy: 68, glide: 60, rotate: 50,
    whiteArc: [42, 85], greenArc: [47, 123], yellowArc: [123, 164], redLine: 164,
    rpmGreen: [2000, 2750], rpmRed: 2750, oilTempGreen: [100, 240], oilTempRed: 240,
    oilPressGreen: [30, 60], oilPressMin: 10, oilPressMax: 100, suctionGreen: [4.6, 5.4]
  };

  /* ------------------------------------------------------------------ utilidades */
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rad(d) { return d * Math.PI / 180; }
  function wrap360(a) { a = a % 360; return a < 0 ? a + 360 : a; }
  function wrap180(a) { a = wrap360(a); return a > 180 ? a - 360 : a; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lin(v, v0, v1, a0, a1) { return a0 + (v - v0) / (v1 - v0) * (a1 - a0); }
  function px(r, a) { return r * Math.sin(rad(a)); }      // a = grados horarios desde las 12
  function py(r, a) { return -r * Math.cos(rad(a)); }
  function busOn(st) { return num((st.elec || E).busVolts, 0) > 8; }
  function q(v, step) { return Math.round(v / step); }   // cuantiza para las firmas

  // Interpolación lineal sobre una tabla plana [x0, y0, x1, y1, ...] ordenada por x.
  function interp(tab, x) {
    if (x <= tab[0]) return tab[1];
    for (var i = 2; i < tab.length; i += 2) {
      if (x <= tab[i]) return lin(x, tab[i - 2], tab[i], tab[i - 1], tab[i + 1]);
    }
    return tab[tab.length - 1];
  }

  function limitsFor(st) {
    var S = C150.Sim;
    if (S && typeof S.limits === 'function') {
      try {
        var L = S.limits(st);
        if (L && L.whiteArc && L.greenArc && L.yellowArc) return L;
      } catch (e) { /* si el simulador falla, usamos los valores fijos */ }
    }
    return (st && st.variant === 'A150M') ? LIMITS_A150M : LIMITS_150M;
  }

  // Memoria por objeto state (direccional congelado, horómetro). Sin WeakMap: un solo registro.
  var MEM = (typeof WeakMap === 'function') ? new WeakMap() : null;
  var MEM_FALLBACK = {};
  function mem(st) {
    if (!MEM || !st || typeof st !== 'object') return MEM_FALLBACK;
    var m = MEM.get(st);
    if (!m) { m = {}; MEM.set(st, m); }
    return m;
  }

  // Fuentes web: cuando terminan de cargar sube fontEpoch, que entra en todas las firmas → redibujo.
  var fontEpoch = 0, fontHooked = false;
  function hookFonts() {
    if (fontHooked) return;
    fontHooked = true;
    try {
      if (typeof document === 'undefined' || !document.fonts) return;
      var bump = function () { fontEpoch++; };
      var fonts = document.fonts;
      if (fonts.load) {
        fonts.load("600 16px 'Barlow Condensed'").then(bump, function () {});
        fonts.load("700 16px 'Barlow Condensed'").then(bump, function () {});
        fonts.load("700 16px 'B612 Mono'").then(bump, function () {});
      }
      if (fonts.ready && fonts.ready.then) fonts.ready.then(bump, function () {});
      if (fonts.addEventListener) fonts.addEventListener('loadingdone', bump);
    } catch (e) { /* sin API de fuentes: quedan las de respaldo */ }
  }

  /* ------------------------------------------------------------------ valores mostrados */
  function asiAngle(v) {
    v = clamp(v, 0, 175);
    return v <= 40 ? v / 40 * 25 : 25 + (v - 40) * (320 / 130);
  }

  var _att = { bank: 0, pitch: 0 };
  function aiShown(st) {
    var air = st.air || E, gyro = st.gyro || E;
    var bank = wrap180(num(air.bank, 0)), pitch = clamp(num(air.pitch, 0), -60, 60);
    var k = smoothstep(0.35, 0.95, num(gyro.aiSpin, 1));
    _att.bank = TUMBLE_BANK + (bank - TUMBLE_BANK) * k;
    _att.pitch = clamp(TUMBLE_PITCH + (pitch - TUMBLE_PITCH) * k, -40, 40);
    return _att;
  }

  function hiShown(st) {
    var air = st.air || E;
    var hdg = num(air.hiHeading, num(air.heading, 0));
    var corr = num(st.hiCorrection, 0);
    var S = C150.Sim;
    if (S && typeof S.step === 'function') return wrap360(hdg);     // el simulador ya lo congela
    var m = mem(st);
    if (num((st.gyro || E).hiSpin, 1) >= 0.7) { m.hiFrozen = null; return wrap360(hdg); }
    if (!m.hiFrozen) m.hiFrozen = { hdg: hdg, corr: corr };
    return wrap360(m.hiFrozen.hdg + (corr - m.hiFrozen.corr));
  }

  function tcPowered(st) {
    var g = st.gyro || E;
    return (g.tcPowered === undefined) ? busOn(st) : !!g.tcPowered;
  }
  function tcAngle(st) {
    return tcPowered(st) ? clamp(num((st.air || E).turnRate, 0) / 3 * 20, -32, 32) : 0;
  }

  var VSI_TAB = [0, 0, 500, 50, 1000, 95, 1500, 131, 2000, 162];
  function vsiAngle(vs) {
    var a = Math.abs(vs), d = a > 2000 ? 166 : interp(VSI_TAB, a);
    return 270 + (vs >= 0 ? d : -d);
  }

  function altShown(st) { var air = st.air || E; return num(air.indicatedAlt, num(air.altitude, 0)); }
  function tachAngle(rpm) { return 225 + clamp(rpm, 0, 3560) / 3500 * 270; }
  function suctionAngle(v) { return 240 + clamp(v, 0, 10.4) / 10 * 240; }
  function ammeterAngle(a) { return clamp(a, -66, 66) / 60 * 50; }
  function oatAngle(f) { return 225 + (clamp(f, -66, 126) + 60) / 180 * 270; }
  function oilTempAngle(st) {
    if (!busOn(st)) return -53;
    return lin(clamp(num((st.engine || E).oilTempF, 60), 50, 262), 50, 250, -48, 48);
  }
  function oilPressAngle(st) {
    return lin(clamp(num((st.engine || E).oilPressPsi, 0), 0, 122), 0, 115, -48, 48);
  }
  function fuelAngle(st, gal) {
    if (!busOn(st)) return -47;
    return lin(clamp((gal - UNUSABLE_PER_TANK) / USABLE_PER_TANK, 0, 1.06), 0, 1, -45, 45);
  }

  function oatC(st) {
    var air = st.air || E;
    if (typeof air.oatC === 'number') return air.oatC;
    if (typeof air.oat === 'number') return air.oat;
    return 15 - 1.98 * num(air.altitude, 0) / 1000;
  }

  function tachHours(st) {
    var eng = st.engine || E;
    if (typeof eng.tachHours === 'number') return eng.tachHours;
    var m = mem(st), t = num(st.time, 0);
    if (m.tachT === undefined) { m.tachT = t; m.tach = TACH_BASE_HOURS; }
    var dt = t - m.tachT;
    if (dt > 0 && dt < 5) m.tach += dt / 3600 * Math.max(0, num(eng.rpm, 0)) / 2500;
    m.tachT = t;
    return m.tach;
  }

  var _vor = { valid: false, to: true, dev: 0 };
  function vorSolve(st) {
    var rd = st.radio || E, pos = st.pos || E;
    var dx = num(pos.x, 0) - VOR.x, dz = num(pos.z, 0) - VOR.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var radial = wrap360(Math.atan2(dx, -dz) * 180 / Math.PI);   // norte = -Z, este = +X
    var obs = num(rd.obs, 0);
    var d = wrap180(radial - obs);
    _vor.valid = busOn(st) && !!rd.comOn && Math.abs(num(rd.navFreq, 0) - VOR.freq) < 0.005 &&
      dist < VOR.rangeM && dist > 300;
    _vor.to = Math.abs(d) > 90;
    // FROM: si el avión está a la derecha del radial elegido, la aguja va a la izquierda (y al revés).
    var dev = _vor.to ? wrap180(radial - obs - 180) : -d;
    _vor.dev = _vor.valid ? clamp(dev / 10, -1, 1) : 0;
    return _vor;
  }

  function xpdrMode(st) { return String((st.radio || E).xpdrMode || 'OFF'); }
  function xpdrPowered(st) { return busOn(st) && xpdrMode(st) !== 'OFF'; }
  function xpdrReply(st) {
    var m = xpdrMode(st);
    return xpdrPowered(st) && (m === 'ON' || m === 'ALT') && Math.floor(num(st.time, 0) * 1.25) % 4 === 0;
  }
  function radioOn(st) { return busOn(st) && !!(st.radio || E).comOn; }

  /* ------------------------------------------------------------------ primitivas de dibujo */
  var K = 1;   // píxeles por unidad del instrumento que se está dibujando (para sombras)

  function shadowOn(ctx, s) {
    s = s || 1;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2.6 * K * s;
    ctx.shadowOffsetX = 1.3 * K * s;
    ctx.shadowOffsetY = 2.1 * K * s;
  }
  function shadowOff(ctx) {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }
  function glowOn(ctx, color, s) {
    ctx.shadowColor = color; ctx.shadowBlur = 3.2 * K * (s || 1); ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }

  function text(ctx, s, x, y, size, color, weight, family, align) {
    ctx.font = (weight || 600) + ' ' + size + 'px ' + (family || FONT_DISP);
    ctx.fillStyle = color || COL.ink;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }

  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Banda de color entre radios r0 y r1, de a0 a a1 (grados horarios desde las 12, a1 > a0).
  function band(ctx, a0, a1, r0, r1, color) {
    if (!(a1 > a0)) return;
    ctx.beginPath();
    ctx.arc(0, 0, r1, rad(a0 - 90), rad(a1 - 90), false);
    ctx.arc(0, 0, r0, rad(a1 - 90), rad(a0 - 90), true);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  // Raya radial (marca de escala) en el ángulo a, de r0 a r1.
  function radial(ctx, a, r0, r1, width, color) {
    var s = Math.sin(rad(a)), c = Math.cos(rad(a));
    ctx.beginPath();
    ctx.moveTo(s * r0, -c * r0); ctx.lineTo(s * r1, -c * r1);
    ctx.lineWidth = width; ctx.strokeStyle = color || COL.ink; ctx.stroke();
  }

  function screw(ctx, x, y, r, slot) {
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#9A9C9F'); g.addColorStop(0.55, '#4A4C4F'); g.addColorStop(1, '#151617');
    circle(ctx, x, y, r); ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(rad(slot));
    ctx.fillStyle = 'rgba(8,8,8,0.85)';
    ctx.fillRect(-r * 0.78, -r * 0.13, r * 1.56, r * 0.26);
    ctx.restore();
  }

  // Perilla moleteada; mark = ángulo de la raya indicadora (opcional); label = texto en la tapa.
  function knob(ctx, x, y, r, mark, label) {
    shadowOn(ctx, 0.9);
    var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#4E5053'); g.addColorStop(0.7, '#1A1B1C'); g.addColorStop(1, '#070707');
    circle(ctx, x, y, r); ctx.fillStyle = g; ctx.fill();
    shadowOff(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = Math.max(0.3, r * 0.06);
    ctx.beginPath();
    for (var i = 0; i < 28; i++) {
      var a = rad(i * 360 / 28), s = Math.sin(a), c = Math.cos(a);
      ctx.moveTo(x + s * r * 0.8, y - c * r * 0.8); ctx.lineTo(x + s * r * 0.97, y - c * r * 0.97);
    }
    ctx.stroke();
    var g2 = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r * 0.66);
    g2.addColorStop(0, '#3C3E41'); g2.addColorStop(1, '#141516');
    circle(ctx, x, y, r * 0.64); ctx.fillStyle = g2; ctx.fill();
    if (typeof mark === 'number') {
      ctx.beginPath();
      ctx.moveTo(x + px(r * 0.2, mark), y + py(r * 0.2, mark));
      ctx.lineTo(x + px(r * 0.92, mark), y + py(r * 0.92, mark));
      ctx.lineWidth = Math.max(0.5, r * 0.12); ctx.strokeStyle = COL.ink; ctx.stroke();
    }
    if (label) text(ctx, label, x, y, r * 0.42, COL.inkDim, 700);
  }

  function needle(ctx, ang, len, tail, width, color) {
    var hw = width / 2;
    ctx.save(); ctx.rotate(rad(ang)); shadowOn(ctx);
    ctx.beginPath();
    ctx.moveTo(-hw * 1.2, tail);
    ctx.lineTo(-hw, 0);
    ctx.lineTo(-hw * 0.55, -len + width * 2.4);
    ctx.lineTo(0, -len);
    ctx.lineTo(hw * 0.55, -len + width * 2.4);
    ctx.lineTo(hw, 0);
    ctx.lineTo(hw * 1.2, tail);
    ctx.closePath();
    ctx.fillStyle = color || COL.ink; ctx.fill();
    shadowOff(ctx); ctx.restore();
  }

  // Manecilla tipo lanza (altímetro, reloj): ancho máximo wMax en la fracción mid de su largo.
  function spear(ctx, ang, len, tail, wBase, wMax, mid, color) {
    ctx.save(); ctx.rotate(rad(ang)); shadowOn(ctx);
    ctx.beginPath();
    ctx.moveTo(-wBase / 2, tail);
    ctx.lineTo(-wBase / 2, 0);
    ctx.lineTo(-wMax / 2, -len * mid);
    ctx.lineTo(0, -len);
    ctx.lineTo(wMax / 2, -len * mid);
    ctx.lineTo(wBase / 2, 0);
    ctx.lineTo(wBase / 2, tail);
    ctx.closePath();
    ctx.fillStyle = color || COL.ink; ctx.fill();
    shadowOff(ctx); ctx.restore();
  }

  function hub(ctx, r) {
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#5E6063'); g.addColorStop(1, '#0B0B0B');
    shadowOn(ctx, 0.6); circle(ctx, 0, 0, r); ctx.fillStyle = g; ctx.fill(); shadowOff(ctx);
  }

  // Bisel redondo oscuro con 4 tornillos y la cara negra mate.
  function bezelRound(ctx) {
    var g = ctx.createLinearGradient(-80, -80, 80, 80);
    g.addColorStop(0, '#4A4C50'); g.addColorStop(0.45, '#1C1D1F'); g.addColorStop(1, '#050505');
    circle(ctx, 0, 0, 99.5); ctx.fillStyle = g; ctx.fill();
    circle(ctx, 0, 0, 98.9); ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
    var g2 = ctx.createLinearGradient(-70, -70, 70, 70);
    g2.addColorStop(0, '#050505'); g2.addColorStop(1, '#2C2D30');
    circle(ctx, 0, 0, 92.4); ctx.fillStyle = g2; ctx.fill();
    screw(ctx, px(95.9, 45), py(95.9, 45), 3.1, 20);
    screw(ctx, px(95.9, 135), py(95.9, 135), 3.1, 75);
    screw(ctx, px(95.9, 225), py(95.9, 225), 3.1, 140);
    screw(ctx, px(95.9, 315), py(95.9, 315), 3.1, 105);
    var f = ctx.createRadialGradient(-18, -24, 4, 0, 0, FACE_R);
    f.addColorStop(0, '#1F2123'); f.addColorStop(1, '#0D0E0F');
    circle(ctx, 0, 0, FACE_R); ctx.fillStyle = f; ctx.fill();
  }

  // Vidrio: sombra del bisel sobre la cara + reflejo suave arriba a la izquierda.
  function glassRound(ctx) {
    ctx.save();
    circle(ctx, 0, 0, FACE_R); ctx.clip();
    var v = ctx.createRadialGradient(4, 6, FACE_R * 0.68, 4, 6, FACE_R * 1.04);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v; ctx.fillRect(-FACE_R, -FACE_R, FACE_R * 2, FACE_R * 2);
    var g = ctx.createLinearGradient(-48, -74, 6, 8);
    g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.ellipse(-26, -36, 72, 46, rad(-35), 0, TAU);
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, FACE_R - 2.4, rad(192), rad(282));
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
    ctx.restore();
  }

  // Reflejo para caras rectangulares (clusters, radios).
  function glassRect(ctx, x, y, w, h, r) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r); ctx.clip();
    var g = ctx.createLinearGradient(x, y, x + w * 0.45, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.11)'); g.addColorStop(0.5, 'rgba(255,255,255,0.025)');
    g.addColorStop(0.51, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    var s = ctx.createLinearGradient(0, y, 0, y + h * 0.25);
    s.addColorStop(0, 'rgba(0,0,0,0.45)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, w, h * 0.25);
    ctx.restore();
  }

  function flagOff(ctx, x, y, w, h, label) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 1.2); ctx.clip();
    ctx.fillStyle = '#C7362B'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = h * 0.16;
    ctx.beginPath();
    for (var i = -h; i < w + h; i += h * 0.75) { ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); }
    ctx.stroke();
    ctx.fillStyle = '#C7362B'; ctx.fillRect(x + w * 0.16, y + h * 0.18, w * 0.68, h * 0.64);
    text(ctx, label || 'OFF', x + w / 2, y + h / 2 + h * 0.03, h * 0.58, '#FFFFFF', 700);
    ctx.restore();
  }

  /* ---------- dígitos de 7 segmentos (radios) ---------- */
  var SEG = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg',
    '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
  var SEG_ALL = 'abcdefg';

  function hseg(ctx, x0, x1, y, ht) {
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x0 + ht, y - ht); ctx.lineTo(x1 - ht, y - ht);
    ctx.lineTo(x1, y); ctx.lineTo(x1 - ht, y + ht); ctx.lineTo(x0 + ht, y + ht); ctx.closePath();
  }
  function vseg(ctx, x, y0, y1, ht) {
    ctx.beginPath();
    ctx.moveTo(x, y0); ctx.lineTo(x + ht, y0 + ht); ctx.lineTo(x + ht, y1 - ht);
    ctx.lineTo(x, y1); ctx.lineTo(x - ht, y1 - ht); ctx.lineTo(x - ht, y0 + ht); ctx.closePath();
  }
  function segPath(ctx, s, w, h, ht, g) {
    switch (s) {
      case 'a': hseg(ctx, ht + g, w - ht - g, ht, ht); break;
      case 'g': hseg(ctx, ht + g, w - ht - g, h / 2, ht); break;
      case 'd': hseg(ctx, ht + g, w - ht - g, h - ht, ht); break;
      case 'f': vseg(ctx, ht, ht + g, h / 2 - g, ht); break;
      case 'b': vseg(ctx, w - ht, ht + g, h / 2 - g, ht); break;
      case 'e': vseg(ctx, ht, h / 2 + g, h - ht - g, ht); break;
      default: vseg(ctx, w - ht, h / 2 + g, h - ht - g, ht); break;   // 'c'
    }
  }
  function segDigit(ctx, ch, x, y, w, h, on, off) {
    var lit = SEG[ch] !== undefined ? SEG[ch] : '';
    var ht = w * 0.095, g = ht * 0.35, i, s;
    ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, -0.07, 1, 0, 0);
    if (off) {
      ctx.fillStyle = off;
      for (i = 0; i < 7; i++) { s = SEG_ALL.charAt(i); if (lit.indexOf(s) < 0) { segPath(ctx, s, w, h, ht, g); ctx.fill(); } }
    }
    ctx.fillStyle = on; glowOn(ctx, on);
    for (i = 0; i < lit.length; i++) { segPath(ctx, lit.charAt(i), w, h, ht, g); ctx.fill(); }
    shadowOff(ctx);
    ctx.restore();
  }
  function segWidth(str, w, gap) {
    var t = 0;
    for (var i = 0; i < str.length; i++) t += (str.charAt(i) === '.' ? w * 0.32 : w) + gap;
    return t - gap;
  }
  // Escribe str centrado en cx, con la parte superior en y; se achica para entrar en maxW.
  function segText(ctx, str, cx, y, w, h, gap, maxW, on, off) {
    var tw = segWidth(str, w, gap);
    if (tw > maxW) { var f = maxW / tw; w *= f; h *= f; gap *= f; tw = maxW; }
    var x = cx - tw / 2;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === '.') {
        ctx.fillStyle = on; glowOn(ctx, on);
        ctx.fillRect(x + w * 0.02 - h * 0.07, y + h - w * 0.19, w * 0.19, w * 0.19);
        shadowOff(ctx);
        x += w * 0.32 + gap;
      } else {
        segDigit(ctx, ch, x, y, w, h, on, off);
        x += w + gap;
      }
    }
  }
  function freqStr(f) {
    f = num(f, 0);
    var k = Math.round(f * 1000);
    return (k % 10 === 0) ? (k / 1000).toFixed(2) : (k / 1000).toFixed(3);
  }

  /* ------------------------------------------------------------------ instrumentos */

  // Velocímetro: nudos afuera (40–160) y MPH adentro; arcos según la variante.
  function drawASI(ctx, st, L) {
    var v, a;
    bezelRound(ctx);
    band(ctx, asiAngle(L.whiteArc[0]), asiAngle(L.whiteArc[1]), 74.5, 80, COL.arcWhite);
    band(ctx, asiAngle(L.greenArc[0]), asiAngle(L.greenArc[1]), 80.6, 87.2, COL.arcGreen);
    band(ctx, asiAngle(L.yellowArc[0]), asiAngle(L.yellowArc[1]), 80.6, 87.2, COL.arcYellow);
    for (v = 40; v <= 170; v += 5) {
      var major = v % 10 === 0;
      radial(ctx, asiAngle(v), major ? 62.5 : 68.5, 74.5, major ? 2.1 : 1.3, COL.ink);
    }
    radial(ctx, asiAngle(L.redLine), 68, 87.6, 2.8, COL.arcRed);
    for (v = 40; v <= 160; v += 20) {
      a = asiAngle(v);
      text(ctx, String(v), px(52, a), py(52, a), 15.5, COL.ink, 600);
    }
    // escala interior en millas por hora
    ctx.beginPath();
    ctx.arc(0, 0, 40.5, rad(asiAngle(50 / KT_TO_MPH) - 90), rad(asiAngle(190 / KT_TO_MPH) - 90));
    ctx.lineWidth = 0.9; ctx.strokeStyle = COL.inkDim; ctx.stroke();
    for (v = 50; v <= 190; v += 10) {
      a = asiAngle(v / KT_TO_MPH);
      radial(ctx, a, 40.5, v % 20 === 0 ? 46 : 44, 0.9, COL.inkDim);
      if (v % 20 === 0 && v >= 60 && v <= 180) text(ctx, String(v), px(33, a), py(33, a), 8, COL.inkDim, 600);
    }
    text(ctx, 'AIRSPEED', 0, -14, 10, COL.ink, 600);
    text(ctx, 'KNOTS', 0, 11, 8.5, COL.ink, 600);
    text(ctx, 'MPH', 0, 21.5, 6.5, COL.inkDim, 600);
    needle(ctx, asiAngle(num((st.air || E).ias, 0)), 82, 16, 4, COL.ink);
    hub(ctx, 6);
    glassRound(ctx);
  }

  // Horizonte artificial: bola cielo/tierra, aro de alabeo con puntero, avioncito naranja fijo.
  function drawAttitude(ctx, st) {
    var att = aiShown(st), p, y, half;
    bezelRound(ctx);
    ctx.save();
    circle(ctx, 0, 0, FACE_R); ctx.clip();
    ctx.rotate(rad(-att.bank));
    // aro exterior: gira con el alabeo, no con el cabeceo
    ctx.fillStyle = '#336FAD'; ctx.fillRect(-100, -100, 200, 100);
    ctx.fillStyle = '#5A3B21'; ctx.fillRect(-100, 0, 200, 100);
    ctx.fillStyle = COL.ink; ctx.fillRect(-100, -0.6, 200, 1.2);
    // bola interior: se mueve con el cabeceo
    ctx.save();
    circle(ctx, 0, 0, 64); ctx.clip();
    ctx.translate(0, att.pitch * AI_PPD);
    var sky = ctx.createLinearGradient(0, -150, 0, 0);
    sky.addColorStop(0, '#24609F'); sky.addColorStop(1, '#6FA7DB');
    ctx.fillStyle = sky; ctx.fillRect(-120, -200, 240, 200);
    var gnd = ctx.createLinearGradient(0, 0, 0, 150);
    gnd.addColorStop(0, '#85572F'); gnd.addColorStop(1, '#3E2614');
    ctx.fillStyle = gnd; ctx.fillRect(-120, 0, 240, 200);
    ctx.fillStyle = COL.ink; ctx.fillRect(-120, -0.9, 240, 1.8);
    ctx.lineWidth = 1.4; ctx.strokeStyle = COL.ink;
    for (p = -20; p <= 20; p += 5) {
      if (p === 0) continue;
      y = -p * AI_PPD; half = (p % 10 === 0) ? 15 : 7.5;
      ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y); ctx.stroke();
      if (p % 10 === 0) {
        text(ctx, String(Math.abs(p)), -half - 6.5, y, 7, COL.ink, 600);
        text(ctx, String(Math.abs(p)), half + 6.5, y, 7, COL.ink, 600);
      }
    }
    ctx.restore();
    circle(ctx, 0, 0, 64); ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    // puntero de alabeo ("sky pointer"), gira con el cielo
    shadowOn(ctx, 0.6);
    ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(-5, -68.5); ctx.lineTo(5, -68.5); ctx.closePath();
    ctx.fillStyle = COL.orange; ctx.fill();
    shadowOff(ctx);
    ctx.restore();
    // escala fija de alabeo: 10, 20, 30, 60, 90 grados
    var marks = [10, 20, 30, 60, 90];
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], long = m >= 30;
      radial(ctx, m, long ? 77 : 80.5, 88.5, long ? 2.4 : 1.6, COL.ink);
      radial(ctx, -m, long ? 77 : 80.5, 88.5, long ? 2.4 : 1.6, COL.ink);
    }
    ctx.beginPath(); ctx.moveTo(0, -79.5); ctx.lineTo(-5.2, -88.8); ctx.lineTo(5.2, -88.8); ctx.closePath();
    ctx.fillStyle = COL.ink; ctx.fill();
    // pedestal y avioncito fijo
    ctx.save();
    circle(ctx, 0, 0, FACE_R); ctx.clip();
    var ped = ctx.createLinearGradient(-16, 0, 16, 0);
    ped.addColorStop(0, '#2A2C2E'); ped.addColorStop(0.5, '#1A1B1D'); ped.addColorStop(1, '#0C0C0D');
    shadowOn(ctx, 0.8);
    ctx.beginPath(); ctx.moveTo(-3.2, 6); ctx.lineTo(3.2, 6); ctx.lineTo(17, 90); ctx.lineTo(-17, 90); ctx.closePath();
    ctx.fillStyle = ped; ctx.fill();
    ctx.restore();
    shadowOn(ctx, 0.9);
    ctx.fillStyle = COL.orange;
    ctx.beginPath();
    ctx.moveTo(-45, -1.8); ctx.lineTo(-12.5, -1.8); ctx.lineTo(-12.5, 5.5); ctx.lineTo(-16.2, 5.5);
    ctx.lineTo(-16.2, 1.8); ctx.lineTo(-45, 1.8); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(45, -1.8); ctx.lineTo(12.5, -1.8); ctx.lineTo(12.5, 5.5); ctx.lineTo(16.2, 5.5);
    ctx.lineTo(16.2, 1.8); ctx.lineTo(45, 1.8); ctx.closePath(); ctx.fill();
    circle(ctx, 0, 0, 2.8); ctx.fill();
    shadowOff(ctx);
    glassRound(ctx);
    knob(ctx, 0, 92.5, 8, undefined, null);
  }

  // Ventanilla de Kollsman (ajuste altimétrico).
  function kollsman(ctx, cx, value) {
    var w = 30, h = 13;
    roundRect(ctx, cx - w / 2, -h / 2, w, h, 1.6);
    ctx.fillStyle = '#050505'; ctx.fill();
    ctx.lineWidth = 0.9; ctx.strokeStyle = '#3A3C3F'; ctx.stroke();
    text(ctx, value, cx, 0.4, 8.6, COL.ink, 700, FONT_DATA);
    ctx.fillStyle = COL.orange;
    ctx.fillRect(cx - 0.5, -h / 2, 1, 1.6); ctx.fillRect(cx - 0.5, h / 2 - 1.6, 1, 1.6);
  }

  // Altímetro de 3 agujas con ventanillas en inHg y hPa.
  function drawAltimeter(ctx, st) {
    var alt = altShown(st), set = num(st.altimeterSetting, 29.92), i;
    bezelRound(ctx);
    for (i = 0; i < 50; i++) {
      var major = i % 5 === 0;
      radial(ctx, i * 7.2, major ? 73.5 : 80, 87.5, major ? 2.4 : 1.2, COL.ink);
    }
    for (i = 0; i < 10; i++) text(ctx, String(i), px(63, i * 36), py(63, i * 36), 19, COL.ink, 600);
    kollsman(ctx, 52, set.toFixed(2));
    kollsman(ctx, -52, String(Math.round(set * INHG_TO_HPA)));
    text(ctx, 'inHg', 35, 0, 5.8, COL.inkDim, 600, null, 'right');
    text(ctx, 'hPa', -35, 0, 5.8, COL.inkDim, 600, null, 'left');
    text(ctx, 'ALT', 0, -31, 10, COL.ink, 600);
    text(ctx, '100 FEET', 0, 29, 7.5, COL.ink, 600);
    text(ctx, 'CALIBRATED TO 20,000 FEET', 0, 40, 4.6, COL.inkDim, 600);
    // aguja de 10.000 ft: fina con triángulo en la punta
    var a10k = wrap360(alt / 100000 * 360);
    ctx.save(); ctx.rotate(rad(a10k)); shadowOn(ctx);
    ctx.fillStyle = COL.ink; ctx.fillRect(-0.7, -78, 1.4, 78);
    ctx.beginPath(); ctx.moveTo(0, -88); ctx.lineTo(-4.6, -77); ctx.lineTo(4.6, -77); ctx.closePath(); ctx.fill();
    shadowOff(ctx); ctx.restore();
    // aguja de 1000 ft (corta y ancha) y de 100 ft (larga y fina)
    spear(ctx, wrap360(alt / 10000 * 360), 47, 9, 4.5, 10.5, 0.62, COL.ink);
    spear(ctx, wrap360(alt / 1000 * 360), 81, 16, 3.4, 4.6, 0.55, COL.ink);
    hub(ctx, 6);
    glassRound(ctx);
    knob(ctx, px(92.5, 225), py(92.5, 225), 9, undefined, null);
  }

  // Coordinador de giro con bolita.
  function drawTurnCoordinator(ctx, st) {
    var slip = clamp(num((st.air || E).slip, 0), -1, 1);
    bezelRound(ctx);
    radial(ctx, 270, 63, 85, 3.2, COL.ink); radial(ctx, 90, 63, 85, 3.2, COL.ink);
    radial(ctx, 250, 63, 85, 3.2, COL.ink); radial(ctx, 110, 63, 85, 3.2, COL.ink);
    text(ctx, 'L', px(71, 234), py(71, 234), 12, COL.ink, 700);
    text(ctx, 'R', px(71, 126), py(71, 126), 12, COL.ink, 700);
    text(ctx, 'TURN COORDINATOR', 0, -58, 9, COL.ink, 600);
    text(ctx, 'D.C. ELEC.', 0, -47, 5.8, COL.inkDim, 600);
    text(ctx, '2 MIN', 0, 21, 8.5, COL.ink, 600);
    text(ctx, 'NO PITCH', 0, 62.5, 6.2, COL.ink, 600);
    text(ctx, 'INFORMATION', 0, 70, 6.2, COL.ink, 600);
    // inclinómetro: tubo curvo con bolita negra (+ = bolita a la derecha)
    var cyT = -36, R = 84, half = 26;
    ctx.beginPath();
    ctx.arc(0, cyT, R + 6.6, rad(90 - half), rad(90 + half), false);
    ctx.arc(0, cyT, R - 6.6, rad(90 + half), rad(90 - half), true);
    ctx.closePath();
    var tube = ctx.createLinearGradient(0, cyT + R - 7, 0, cyT + R + 7);
    tube.addColorStop(0, '#F3F0E6'); tube.addColorStop(0.5, '#D9D4C4'); tube.addColorStop(1, '#A8A394');
    ctx.fillStyle = tube; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#050505'; ctx.stroke();
    ctx.fillStyle = '#111111';
    ctx.fillRect(-7.6, cyT + R - 7, 1.1, 14); ctx.fillRect(6.5, cyT + R - 7, 1.1, 14);
    var ba = rad(90 - slip * 20), bx = Math.cos(ba) * R, by = cyT + Math.sin(ba) * R;
    var bg = ctx.createRadialGradient(bx - 2, by - 2.2, 0.5, bx, by, 6.1);
    bg.addColorStop(0, '#6A6C6F'); bg.addColorStop(0.5, '#1A1A1A'); bg.addColorStop(1, '#000000');
    circle(ctx, bx, by, 6.1); ctx.fillStyle = bg; ctx.fill();
    // brillo del tubo de vidrio
    ctx.beginPath(); ctx.arc(0, cyT, R - 3.6, rad(90 - half + 3), rad(90 + half - 3));
    ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
    // avioncito (vista de frente) que se inclina con el régimen de giro
    ctx.save(); ctx.rotate(rad(tcAngle(st))); shadowOn(ctx);
    ctx.fillStyle = COL.ink;
    roundRect(ctx, -56, -2.3, 112, 4.6, 2.2); ctx.fill();
    circle(ctx, 0, 0, 7.4); ctx.fill();
    ctx.fillRect(-1.7, -17, 3.4, 12);
    roundRect(ctx, -14, -11.5, 28, 3, 1.4); ctx.fill();
    shadowOff(ctx);
    circle(ctx, 0, 0, 3.2); ctx.fillStyle = '#2A2B2D'; ctx.fill();
    ctx.restore();
    if (!tcPowered(st)) flagOff(ctx, -60, 11, 24, 12, 'OFF');
    glassRound(ctx);
  }

  // Direccional: tarjeta giratoria de 360° y avioncito naranja fijo.
  function drawHeadingIndicator(ctx, st) {
    var hdg = hiShown(st), d;
    bezelRound(ctx);
    ctx.save(); ctx.rotate(rad(-hdg));
    for (d = 0; d < 360; d += 5) {
      var major = d % 10 === 0;
      radial(ctx, d, major ? 73 : 79.5, 87.5, major ? 1.9 : 1.2, COL.ink);
    }
    var LBL = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];
    for (d = 0; d < 12; d++) {
      var letter = d % 3 === 0;
      ctx.save(); ctx.rotate(rad(d * 30));
      text(ctx, LBL[d], 0, -61, letter ? 17 : 13.5, COL.ink, letter ? 700 : 600);
      ctx.restore();
    }
    ctx.restore();
    // marcas fijas cada 45° y línea de fe arriba
    var fixed = [45, 90, 135, 180, 270, 315];
    for (d = 0; d < fixed.length; d++) {
      ctx.save(); ctx.rotate(rad(fixed[d]));
      ctx.beginPath(); ctx.moveTo(0, -84.5); ctx.lineTo(-2.6, -89.5); ctx.lineTo(2.6, -89.5); ctx.closePath();
      ctx.fillStyle = COL.ink; ctx.fill();
      ctx.restore();
    }
    shadowOn(ctx, 0.6);
    ctx.beginPath(); ctx.moveTo(0, -75); ctx.lineTo(-4.8, -89.5); ctx.lineTo(4.8, -89.5); ctx.closePath();
    ctx.fillStyle = COL.orange; ctx.fill();
    // avioncito visto desde arriba
    ctx.fillStyle = COL.orange;
    roundRect(ctx, -2.8, -32, 5.6, 56, 2.6); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2.5, -13); ctx.lineTo(-25, -9); ctx.lineTo(-25, -3.5); ctx.lineTo(-2.5, -4.5);
    ctx.lineTo(2.5, -4.5); ctx.lineTo(25, -3.5); ctx.lineTo(25, -9); ctx.lineTo(2.5, -13); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2.5, 16); ctx.lineTo(-11, 19); ctx.lineTo(-11, 22.5); ctx.lineTo(11, 22.5); ctx.lineTo(11, 19);
    ctx.lineTo(2.5, 16); ctx.closePath(); ctx.fill();
    shadowOff(ctx);
    glassRound(ctx);
    knob(ctx, px(92.5, 225), py(92.5, 225), 9, undefined, null);
  }

  // Variómetro: ±2000 ft/min, cero a las 9.
  function drawVSI(ctx, st) {
    var v, s, a;
    bezelRound(ctx);
    radial(ctx, 270, 69, 87.5, 2.8, COL.ink);
    for (s = -1; s <= 1; s += 2) {
      for (v = 100; v <= 2000; v += (v < 1000 ? 100 : 250)) {
        var major = v % 500 === 0;
        radial(ctx, vsiAngle(s * v), major ? 72 : 79, 87.5, major ? 2.2 : 1.2, COL.ink);
      }
      for (v = 500; v <= 2000; v += 500) {
        a = vsiAngle(s * v);
        text(ctx, String(v / 100), px(59, a), py(59, a), 15.5, COL.ink, 600);
      }
    }
    text(ctx, '0', px(59, 270), py(59, 270), 15.5, COL.ink, 600);
    text(ctx, 'UP', px(36, 302), py(36, 302), 8.5, COL.ink, 700);
    text(ctx, 'DOWN', px(36, 238), py(36, 238), 8.5, COL.ink, 700);
    text(ctx, 'VERTICAL SPEED', 12, -26, 7.6, COL.ink, 600);
    text(ctx, '100 FEET PER MIN', 12, 26, 6.4, COL.ink, 600);
    needle(ctx, vsiAngle(num((st.air || E).vs, 0)), 80, 15, 4, COL.ink);
    hub(ctx, 6);
    glassRound(ctx);
  }

  // Brújula magnética: tira ancha (400 × 100 unidades) centrada en el rumbo magnético.
  function drawCompass(ctx, st) {
    var hdg = wrap360(num((st.air || E).heading, 0));
    var bg = ctx.createLinearGradient(0, 0, 0, 100);
    bg.addColorStop(0, '#0B0A08'); bg.addColorStop(0.5, '#1E1A14'); bg.addColorStop(1, '#090807');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 400, 100);
    // banda de la tarjeta
    var cg = ctx.createLinearGradient(0, 12, 0, 88);
    cg.addColorStop(0, '#16130F'); cg.addColorStop(0.5, '#0E0C0A'); cg.addColorStop(1, '#16130F');
    ctx.fillStyle = cg; ctx.fillRect(0, 12, 400, 76);
    ctx.fillStyle = 'rgba(239,238,231,0.35)'; ctx.fillRect(0, 12, 400, 0.8); ctx.fillRect(0, 87.2, 400, 0.8);
    var LBL = { 0: 'N', 30: '3', 60: '6', 90: 'E', 120: '12', 150: '15', 180: 'S', 210: '21', 240: '24',
      270: 'W', 300: '30', 330: '33' };
    var start = Math.floor((hdg - 44) / 5) * 5;
    for (var d = start; d <= hdg + 44; d += 5) {
      // rumbo d visto a la derecha cuando es MENOR que el actual (tarjeta vista desde atrás)
      var x = 200 - (d - hdg) * COMPASS_PPD, card = wrap360(d);
      var major = card % 10 === 0, big = card % 30 === 0;
      ctx.fillStyle = COL.ink;
      ctx.fillRect(x - (big ? 0.9 : 0.6), 13, big ? 1.8 : 1.2, big ? 20 : (major ? 15 : 9));
      if (big) {
        var lbl = LBL[card], letter = card % 90 === 0;
        text(ctx, lbl, x, 59, letter ? 36 : 30, COL.ink, letter ? 700 : 600);
      }
    }
    // líquido ámbar, curvatura del tambor y línea de fe
    ctx.fillStyle = 'rgba(92,60,14,0.16)'; ctx.fillRect(0, 0, 400, 100);
    var vg = ctx.createLinearGradient(0, 0, 400, 0);
    vg.addColorStop(0, 'rgba(0,0,0,0.72)'); vg.addColorStop(0.2, 'rgba(0,0,0,0.12)');
    vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(0.8, 'rgba(0,0,0,0.12)'); vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, 400, 100);
    shadowOn(ctx, 0.7);
    ctx.fillStyle = '#F4F3EE'; ctx.fillRect(198.9, 4, 2.2, 92);
    shadowOff(ctx);
    var gl = ctx.createLinearGradient(0, 0, 0, 30);
    gl.addColorStop(0, 'rgba(255,255,255,0.14)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, 400, 30);
  }

  // Reloj analógico con la hora local real.
  function drawClock(ctx) {
    var now = new Date(), h = now.getHours(), m = now.getMinutes(), s = now.getSeconds(), i;
    bezelRound(ctx);
    for (i = 0; i < 60; i++) {
      var five = i % 5 === 0;
      radial(ctx, i * 6, five ? 76 : 81.5, 87.5, five ? 2.6 : 1.1, COL.ink);
    }
    for (i = 1; i <= 12; i++) text(ctx, String(i), px(63, i * 30), py(63, i * 30), i % 3 === 0 ? 19 : 15, COL.ink, 600);
    spear(ctx, (h % 12 + m / 60) * 30, 46, 10, 4.6, 9, 0.6, COL.ink);
    spear(ctx, (m + s / 60) * 6, 74, 12, 3.8, 6.4, 0.6, COL.ink);
    needle(ctx, s * 6, 82, 20, 1.6, COL.orange);
    hub(ctx, 5.2);
    glassRound(ctx);
    knob(ctx, px(92, 225), py(92, 225), 10, undefined, null);
  }

  // Termómetro de aire exterior: °F afuera, °C adentro.
  function drawOAT(ctx, st) {
    var f, c, a;
    bezelRound(ctx);
    for (f = -60; f <= 120; f += 10) radial(ctx, oatAngle(f), f % 20 === 0 ? 74 : 80, 87.5, f % 20 === 0 ? 2.2 : 1.2, COL.ink);
    for (f = -40; f <= 120; f += 40) { a = oatAngle(f); text(ctx, String(f), px(60, a), py(60, a), 15, COL.ink, 600); }
    for (c = -50; c <= 50; c += 10) {
      a = oatAngle(c * 9 / 5 + 32);
      radial(ctx, a, 40, c % 20 === 0 ? 46 : 44, 1, COL.inkDim);
      if (c % 20 === 0) text(ctx, String(c), px(31, a), py(31, a), 8.5, COL.inkDim, 600);
    }
    text(ctx, '°F', 0, -16, 12, COL.ink, 700);
    text(ctx, '°C', 0, 13, 9, COL.inkDim, 700);
    text(ctx, 'AIR TEMP', 0, 58, 9, COL.ink, 600);
    needle(ctx, oatAngle(oatC(st) * 9 / 5 + 32), 80, 14, 4, COL.ink);
    hub(ctx, 6);
    glassRound(ctx);
  }

  // Tambores del horómetro: 4 dígitos + décimas (el de décimas rueda suave).
  function odometer(ctx, cx, cy, hours) {
    var cw = 9.2, ch = 13, n = 5, x0 = cx - cw * n / 2, i;
    var t = Math.max(0, hours) * 10, whole = Math.floor(t), frac = t - whole;
    roundRect(ctx, x0 - 1.6, cy - ch / 2 - 1.6, cw * n + 3.2, ch + 3.2, 1.8);
    ctx.fillStyle = '#050505'; ctx.fill();
    ctx.lineWidth = 0.8; ctx.strokeStyle = '#3A3C3F'; ctx.stroke();
    var digits = String(Math.floor(whole / 10) % 10000);
    while (digits.length < 4) digits = '0' + digits;
    for (i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#141414' : '#101010'; ctx.fillRect(x0 + i * cw + 0.3, cy - ch / 2, cw - 0.6, ch);
      text(ctx, digits.charAt(i), x0 + i * cw + cw / 2, cy + 0.5, 10.5, COL.ink, 700, FONT_DATA);
    }
    var tx = x0 + 4 * cw;
    ctx.save();
    ctx.beginPath(); ctx.rect(tx + 0.3, cy - ch / 2, cw - 0.6, ch); ctx.clip();
    ctx.fillStyle = '#EDEBE3'; ctx.fillRect(tx + 0.3, cy - ch / 2, cw - 0.6, ch);
    var off = frac * ch;
    text(ctx, String(whole % 10), tx + cw / 2, cy + 0.5 - off, 10.5, '#111111', 700, FONT_DATA);
    text(ctx, String((whole + 1) % 10), tx + cw / 2, cy + 0.5 - off + ch, 10.5, '#111111', 700, FONT_DATA);
    var sh = ctx.createLinearGradient(0, cy - ch / 2, 0, cy + ch / 2);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)');
    sh.addColorStop(0.7, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = sh; ctx.fillRect(tx, cy - ch / 2, cw, ch);
    ctx.restore();
  }

  // Tacómetro 0–35 (RPM × 100) con arco verde, raya roja y horómetro.
  function drawTachometer(ctx, st, L) {
    var r, a;
    bezelRound(ctx);
    band(ctx, tachAngle(L.rpmGreen[0]), tachAngle(L.rpmGreen[1]), 80.6, 87.2, COL.arcGreen);
    for (r = 0; r <= 3500; r += 100) {
      var major = r % 500 === 0;
      radial(ctx, tachAngle(r), major ? 69 : 75, 80.4, major ? 2.3 : 1.2, COL.ink);
    }
    radial(ctx, tachAngle(L.rpmRed), 68, 87.6, 2.8, COL.arcRed);
    for (r = 0; r <= 3500; r += 500) {
      a = tachAngle(r);
      text(ctx, String(r / 100), px(57, a), py(57, a), 16, COL.ink, 600);
    }
    text(ctx, 'RPM', 0, -31, 11, COL.ink, 700);
    text(ctx, '×100', 0, -20, 7.5, COL.ink, 600);
    odometer(ctx, 0, 34, tachHours(st));
    text(ctx, 'HOURS', 0, 48.5, 6.2, COL.inkDim, 600);
    needle(ctx, tachAngle(num((st.engine || E).rpm, 0)), 81, 15, 4, COL.ink);
    hub(ctx, 6);
    glassRound(ctx);
  }

  // Cuadro rectangular de dos indicadores (200 × 100 unidades).
  function clusterFrame(ctx) {
    roundRect(ctx, 0.5, 0.5, 199, 99, 7);
    var g = ctx.createLinearGradient(0, 0, 0, 100);
    g.addColorStop(0, '#45474B'); g.addColorStop(0.5, '#1E1F21'); g.addColorStop(1, '#09090A');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
    roundRect(ctx, 6.5, 6.5, 187, 87, 4);
    var f = ctx.createLinearGradient(0, 6, 0, 94);
    f.addColorStop(0, '#1C1E20'); f.addColorStop(1, '#0D0E0F');
    ctx.fillStyle = f; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#030303'; ctx.stroke();
    ctx.fillStyle = '#050505'; ctx.fillRect(99.3, 6.5, 1.4, 87);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(100.7, 6.5, 0.5, 87);
    screw(ctx, 3.4, 50, 2.2, 30); screw(ctx, 196.6, 50, 2.2, 110);
  }
  function clusterGlass(ctx) {
    glassRect(ctx, 6.5, 6.5, 187, 87, 4);
  }

  // Mini indicador de abanico: pivote en (cx, 76), escala de -48° a +48°.
  function miniBand(ctx, a0, a1, color) { band(ctx, a0, a1, 48.5, 54.5, color); }
  function miniNeedle(ctx, ang) { needle(ctx, ang, 53, 7, 2.8, COL.ink); hub(ctx, 4.4); }

  function drawOilGauges(ctx, st, L) {
    var t, p, a;
    clusterFrame(ctx);
    // OIL TEMP (°F)
    ctx.save(); ctx.translate(50, 76);
    var ta = function (v) { return lin(v, 50, 250, -48, 48); };
    miniBand(ctx, ta(L.oilTempGreen[0]), ta(L.oilTempGreen[1]), COL.arcGreen);
    for (t = 50; t <= 250; t += 25) radial(ctx, ta(t), t % 50 === 0 ? 42.5 : 45.2, 48.3, t % 50 === 0 ? 1.7 : 1, COL.ink);
    radial(ctx, ta(L.oilTempRed), 41, 55, 2.6, COL.arcRed);
    for (t = 100; t <= 250; t += 50) { a = ta(t); text(ctx, String(t), px(33.5, a), py(33.5, a), 6.8, COL.ink, 600); }
    text(ctx, '°F', -24, -3, 6.5, COL.inkDim, 700);
    miniNeedle(ctx, oilTempAngle(st));
    ctx.restore();
    text(ctx, 'OIL TEMP', 50, 88.5, 8.2, COL.ink, 700);
    // OIL PRESS (psi)
    ctx.save(); ctx.translate(150, 76);
    var pa = function (v) { return lin(v, 0, 115, -48, 48); };
    miniBand(ctx, pa(L.oilPressGreen[0]), pa(L.oilPressGreen[1]), COL.arcGreen);
    for (p = 0; p <= 110; p += 10) radial(ctx, pa(p), p % 50 === 0 ? 42.5 : 45.2, 48.3, p % 50 === 0 ? 1.7 : 1, COL.ink);
    radial(ctx, pa(L.oilPressMin), 41, 55, 2.6, COL.arcRed);
    radial(ctx, pa(L.oilPressMax), 41, 55, 2.6, COL.arcRed);
    for (p = 0; p <= 100; p += 50) { a = pa(p); text(ctx, String(p), px(33.5, a), py(33.5, a), 6.8, COL.ink, 600); }
    text(ctx, 'PSI', -24, -3, 6.5, COL.inkDim, 700);
    miniNeedle(ctx, oilPressAngle(st));
    ctx.restore();
    text(ctx, 'OIL PRESS', 150, 88.5, 8.2, COL.ink, 700);
    clusterGlass(ctx);
  }

  function drawFuelGauges(ctx, st) {
    var fuel = st.fuel || E;
    clusterFrame(ctx);
    var sides = [[50, 'L FUEL', num(fuel.leftGal, 0)], [150, 'R FUEL', num(fuel.rightGal, 0)]];
    for (var i = 0; i < 2; i++) {
      var cx = sides[i][0];
      ctx.save(); ctx.translate(cx, 76);
      for (var k = 0; k <= 4; k++) {
        var a = -45 + k * 22.5, major = k % 2 === 0;
        radial(ctx, a, major ? 42.5 : 45.5, 52, major ? 1.8 : 1.1, COL.ink);
      }
      radial(ctx, -45, 40, 55, 3.2, COL.arcRed);
      text(ctx, 'E', px(33, -45), py(33, -45), 10, COL.ink, 700);
      text(ctx, '½', px(33, 0), py(33, 0), 10, COL.ink, 700);
      text(ctx, 'F', px(33, 45), py(33, 45), 10, COL.ink, 700);
      text(ctx, 'U.S. GAL', -24, -3, 5.2, COL.inkDim, 600);
      miniNeedle(ctx, fuelAngle(st, sides[i][2]));
      ctx.restore();
      text(ctx, sides[i][1], cx, 88.5, 8.2, COL.ink, 700);
    }
    clusterGlass(ctx);
  }

  // Amperímetro con cero al centro (descarga − / carga +).
  function drawAmmeter(ctx, st) {
    var a, v;
    bezelRound(ctx);
    ctx.save(); ctx.translate(0, 24);
    for (v = -60; v <= 60; v += 10) {
      var major = v % 30 === 0;
      radial(ctx, ammeterAngle(v), major ? 55 : 60.5, 67, major ? 2.4 : 1.3, COL.ink);
    }
    for (v = -60; v <= 60; v += 30) { a = ammeterAngle(v); text(ctx, String(Math.abs(v)), px(46, a), py(46, a), 12, COL.ink, 600); }
    text(ctx, '−', px(70, -63), py(70, -63), 17, COL.ink, 700);
    text(ctx, '+', px(70, 63), py(70, 63), 17, COL.ink, 700);
    needle(ctx, ammeterAngle(num((st.elec || E).ammeterAmps, 0)), 64, 11, 3.6, COL.ink);
    hub(ctx, 5.6);
    ctx.restore();
    text(ctx, 'AMPERES', 0, 48, 10, COL.ink, 600);
    glassRound(ctx);
  }

  // Succión 0–10 inHg con arco verde 4,6–5,4.
  function drawSuction(ctx, st, L) {
    var v, a;
    bezelRound(ctx);
    band(ctx, suctionAngle(L.suctionGreen[0]), suctionAngle(L.suctionGreen[1]), 80.6, 87.4, COL.arcGreen);
    for (v = 0; v <= 10; v += 0.5) {
      var major = v % 2 === 0, mid = v % 1 === 0;
      radial(ctx, suctionAngle(v), major ? 68 : (mid ? 73 : 76.5), 80.4, major ? 2.4 : 1.2, COL.ink);
    }
    for (v = 0; v <= 10; v += 2) { a = suctionAngle(v); text(ctx, String(v), px(55, a), py(55, a), 17, COL.ink, 600); }
    text(ctx, 'SUCTION', 0, 38, 11, COL.ink, 700);
    text(ctx, 'INCHES OF MERCURY', 0, 50, 6.4, COL.inkDim, 600);
    needle(ctx, suctionAngle(num((st.vacuum || E).suctionInHg, 0)), 79, 14, 4, COL.ink);
    hub(ctx, 6);
    glassRound(ctx);
  }

  // Placa frontal de radio (320 × 100 unidades).
  function radioPlate(ctx) {
    roundRect(ctx, 0.5, 0.5, 319, 99, 4);
    var g = ctx.createLinearGradient(0, 0, 0, 100);
    g.addColorStop(0, '#3F4246'); g.addColorStop(0.08, '#303336'); g.addColorStop(1, '#1D1F21');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke();
    screw(ctx, 6, 6, 2.5, 30); screw(ctx, 314, 6, 2.5, 120); screw(ctx, 6, 94, 2.5, 75); screw(ctx, 314, 94, 2.5, 10);
  }
  function radioWindow(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 2.4);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#020202'); g.addColorStop(1, '#0B0B0C');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#000000'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 2, y + h + 0.6); ctx.lineTo(x + w - 2, y + h + 0.6);
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
  }
  function flipButton(ctx, x, y) {
    shadowOn(ctx, 0.6);
    roundRect(ctx, x, y, 28, 13, 2.2);
    var g = ctx.createLinearGradient(0, y, 0, y + 13);
    g.addColorStop(0, '#5A5D61'); g.addColorStop(1, '#2A2C2F');
    ctx.fillStyle = g; ctx.fill();
    shadowOff(ctx);
    ctx.strokeStyle = COL.ink; ctx.fillStyle = COL.ink; ctx.lineWidth = 1.1;
    var cx = x + 14, cy = y + 6.5;
    ctx.beginPath(); ctx.moveTo(cx - 7, cy - 2); ctx.lineTo(cx + 6, cy - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 8, cy - 2); ctx.lineTo(cx + 5, cy - 4.2); ctx.lineTo(cx + 5, cy + 0.2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 7, cy + 2); ctx.lineTo(cx - 6, cy + 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 8, cy + 2); ctx.lineTo(cx - 5, cy - 0.2); ctx.lineTo(cx - 5, cy + 4.2); ctx.closePath(); ctx.fill();
  }

  function drawNavcom(ctx, st) {
    var rd = st.radio || E, on = radioOn(st);
    radioPlate(ctx);
    // rótulos impresos
    text(ctx, 'COM', 16, 9.5, 6.6, COL.print, 700, null, 'left');
    text(ctx, 'USE', 52, 9.5, 5.6, COL.inkDim, 600);
    text(ctx, 'STBY', 121, 9.5, 5.6, COL.inkDim, 600);
    text(ctx, 'NAV', 166, 9.5, 6.6, COL.print, 700, null, 'left');
    text(ctx, 'USE', 202, 9.5, 5.6, COL.inkDim, 600);
    text(ctx, 'STBY', 271, 9.5, 5.6, COL.inkDim, 600);
    radioWindow(ctx, 14, 14, 142, 36);
    radioWindow(ctx, 164, 14, 142, 36);
    if (on) {
      segText(ctx, freqStr(rd.comFreq), 52, 22, 9.6, 20, 2, 66, COL.amber, COL.amberOff);
      segText(ctx, freqStr(rd.comStby), 121, 25, 7.6, 16, 1.6, 54, COL.amber, COL.amberOff);
      segText(ctx, freqStr(rd.navFreq), 202, 22, 9.6, 20, 2, 66, COL.green, COL.greenOff);
      segText(ctx, freqStr(rd.navStby), 271, 25, 7.6, 16, 1.6, 54, COL.green, COL.greenOff);
      ctx.fillStyle = 'rgba(255,181,71,0.5)'; ctx.fillRect(88, 20, 0.6, 24);
      ctx.fillStyle = 'rgba(134,242,156,0.45)'; ctx.fillRect(238, 20, 0.6, 24);
    }
    glassRect(ctx, 14, 14, 142, 36, 2.4);
    glassRect(ctx, 164, 14, 142, 36, 2.4);
    // perillas y botones
    text(ctx, 'OFF · VOL', 28, 59, 5.4, COL.print, 600);
    knob(ctx, 28, 76, 10, on ? 40 : -40, null);
    text(ctx, 'COM', 74, 59, 5.4, COL.print, 600);
    flipButton(ctx, 60, 69.5);
    text(ctx, 'MHz · kHz', 126, 59, 5.4, COL.print, 600);
    knob(ctx, 126, 78, 15.5, undefined, null);
    knob(ctx, 126, 78, 9.2, undefined, null);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(159.6, 56, 0.8, 38);
    text(ctx, 'NAV', 186, 59, 5.4, COL.print, 600);
    flipButton(ctx, 172, 69.5);
    text(ctx, 'VOL · IDENT', 228, 59, 5.4, COL.print, 600);
    knob(ctx, 228, 76, 10, 20, null);
    text(ctx, 'MHz · kHz', 284, 59, 5.4, COL.print, 600);
    knob(ctx, 284, 78, 15.5, undefined, null);
    knob(ctx, 284, 78, 9.2, undefined, null);
  }

  function drawTransponder(ctx, st) {
    var rd = st.radio || E, on = xpdrPowered(st), mode = xpdrMode(st), i;
    radioPlate(ctx);
    text(ctx, 'TRANSPONDER', 14, 9.5, 6.6, COL.print, 700, null, 'left');
    text(ctx, 'ATC', 186, 9.5, 5.6, COL.inkDim, 600, null, 'right');
    radioWindow(ctx, 14, 15, 172, 42);
    if (on) {
      var code = String(rd.xpdrCode || '0000');
      while (code.length < 4) code = '0' + code;
      segText(ctx, code.slice(0, 4), 64, 22, 14, 28, 3.4, 92, COL.amber, COL.amberOff);
      text(ctx, mode, 148, 28, 11, COL.amber, 700, FONT_DATA);
      text(ctx, mode === 'ALT' ? 'MODE C' : (mode === 'ON' ? 'MODE A' : 'STANDBY'), 148, 43, 5.6, 'rgba(255,181,71,0.65)', 700, FONT_DATA);
    }
    glassRect(ctx, 14, 15, 172, 42, 2.4);
    // luz de respuesta
    var lit = xpdrReply(st);
    circle(ctx, 203, 24, 4.4);
    ctx.fillStyle = '#0A0A0A'; ctx.fill();
    circle(ctx, 203, 24, 3.2);
    if (lit) { glowOn(ctx, COL.amber, 1.6); ctx.fillStyle = COL.amber; } else { ctx.fillStyle = '#3A2A12'; }
    ctx.fill(); shadowOff(ctx);
    text(ctx, 'REPLY', 203, 34, 5, COL.print, 600);
    // botón IDT
    shadowOn(ctx, 0.6);
    circle(ctx, 226, 24, 7);
    var g = ctx.createRadialGradient(224, 22, 0.5, 226, 24, 7);
    g.addColorStop(0, '#6A6D71'); g.addColorStop(1, '#26282A');
    ctx.fillStyle = g; ctx.fill();
    shadowOff(ctx);
    text(ctx, 'IDT', 226, 24.3, 5.2, COL.ink, 700);
    // perillas del código (una por dígito)
    for (i = 0; i < 4; i++) knob(ctx, 64 - 26.1 + i * 17.4, 75, 6.6, undefined, null);
    text(ctx, 'CODE', 64, 91.5, 5.4, COL.print, 600);
    // selector de modo
    var modes = ['OFF', 'SBY', 'ON', 'ALT', 'TST'], cx = 276, cy = 58, idx = Math.max(0, modes.indexOf(mode));
    for (i = 0; i < modes.length; i++) {
      var a = -60 + i * 30;
      text(ctx, modes[i], cx + px(27, a), cy + py(27, a), 5.6, i === idx ? COL.ink : COL.print, i === idx ? 700 : 600);
    }
    knob(ctx, cx, cy, 17, -60 + idx * 30, null);
  }

  // Indicador VOR: tarjeta OBS giratoria, aguja vertical (CDI) y bandera TO/FROM/OFF.
  function drawVOR(ctx, st) {
    var rd = st.radio || E, obs = wrap360(num(rd.obs, 0)), d, i;
    var v = vorSolve(st);
    bezelRound(ctx);
    ctx.save(); ctx.rotate(rad(-obs));
    for (d = 0; d < 360; d += 5) {
      var major = d % 10 === 0;
      radial(ctx, d, major ? 80 : 84, 88.5, major ? 1.8 : 1.1, COL.ink);
    }
    for (d = 0; d < 360; d += 30) {
      ctx.save(); ctx.rotate(rad(d));
      text(ctx, String(d / 10), 0, -72.5, 10.5, COL.ink, 600);
      ctx.restore();
    }
    ctx.restore();
    circle(ctx, 0, 0, 65.5); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    // índices fijos de curso (arriba) y recíproco (abajo)
    ctx.fillStyle = COL.orange;
    ctx.beginPath(); ctx.moveTo(0, -66); ctx.lineTo(-5, -57); ctx.lineTo(5, -57); ctx.closePath(); ctx.fill();
    ctx.fillStyle = COL.ink;
    ctx.beginPath(); ctx.moveTo(0, 66); ctx.lineTo(-3.6, 59); ctx.lineTo(3.6, 59); ctx.closePath(); ctx.fill();
    // puntos de desviación (2° cada uno)
    ctx.lineWidth = 1.2; ctx.strokeStyle = COL.ink;
    for (i = 1; i <= 5; i++) {
      circle(ctx, i * 9, 0, 2.1); ctx.stroke();
      circle(ctx, -i * 9, 0, 2.1); ctx.stroke();
    }
    circle(ctx, 0, 0, 5); ctx.stroke();
    // bandera TO / FR / OFF
    if (v.valid) {
      roundRect(ctx, 20, -42, 26, 13, 1.4); ctx.fillStyle = '#050505'; ctx.fill();
      ctx.lineWidth = 0.8; ctx.strokeStyle = '#3A3C3F'; ctx.stroke();
      text(ctx, v.to ? 'TO' : 'FR', 33, -35.3, 9, COL.ink, 700);
    } else {
      flagOff(ctx, 20, -42, 26, 13, 'OFF');
    }
    text(ctx, 'NAV', -33, -35.5, 7, COL.inkDim, 700);
    // aguja de desvío de curso
    ctx.save();
    circle(ctx, 0, 0, 64); ctx.clip();
    shadowOn(ctx);
    ctx.fillStyle = COL.ink; ctx.fillRect(v.dev * 45 - 1.4, -58, 2.8, 116);
    shadowOff(ctx);
    ctx.restore();
    glassRound(ctx);
    knob(ctx, px(92.5, 225), py(92.5, 225), 10, undefined, 'OBS');
  }

  // Indicador del compensador (escala vertical angosta, 31,25 × 100 unidades).
  function plate(ctx, w, h) {
    roundRect(ctx, 0.4, 0.4, w - 0.8, h - 0.8, 2.2);
    var g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#2B2D30'); g.addColorStop(1, '#17181A');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke();
  }
  function slotPointer(ctx, x, y, color) {
    shadowOn(ctx, 0.5);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6.5, y - 3.3); ctx.lineTo(x + 8.5, y - 3.3);
    ctx.lineTo(x + 8.5, y + 3.3); ctx.lineTo(x + 6.5, y + 3.3); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    shadowOff(ctx);
  }

  function drawTrimIndicator(ctx, st) {
    var trim = clamp(num(st.trim, 0), -1, 1), t;
    plate(ctx, 31.25, 100);
    roundRect(ctx, 21.5, 9, 4, 82, 1.6); ctx.fillStyle = '#050505'; ctx.fill();
    for (t = -1; t <= 1.001; t += 0.25) {
      var y = 50 + t * 38, major = Math.abs(t) < 0.01 || Math.abs(Math.abs(t) - 1) < 0.01;
      ctx.fillStyle = COL.ink; ctx.fillRect(major ? 16.5 : 18.5, y - 0.4, major ? 4.4 : 2.4, 0.8);
    }
    text(ctx, 'NOSE', 15.5, 8.5, 5.6, COL.ink, 700, null, 'right');
    text(ctx, 'DN', 15.5, 14.5, 5.6, COL.ink, 700, null, 'right');
    text(ctx, 'TAKE', 15.5, 46.8, 5.6, COL.orange, 700, null, 'right');
    text(ctx, 'OFF', 15.5, 53.2, 5.6, COL.orange, 700, null, 'right');
    text(ctx, 'NOSE', 15.5, 85.5, 5.6, COL.ink, 700, null, 'right');
    text(ctx, 'UP', 15.5, 91.5, 5.6, COL.ink, 700, null, 'right');
    slotPointer(ctx, 20.6, 50 + trim * 38, COL.ink);
  }

  // Indicador de flaps del parante izquierdo (25 × 100 unidades).
  function drawFlapIndicator(ctx, st) {
    var flaps = clamp(num(st.flaps, 0), 0, 40), f;
    plate(ctx, 25, 100);
    text(ctx, 'FLAPS', 12.5, 5.6, 5, COL.inkDim, 700);
    roundRect(ctx, 17.4, 11, 4, 78, 1.6); ctx.fillStyle = '#050505'; ctx.fill();
    for (f = 0; f <= 40; f += 5) {
      var y = 14 + f * 1.8, major = f % 10 === 0;
      ctx.fillStyle = COL.ink; ctx.fillRect(major ? 13.6 : 15, y - 0.4, major ? 3.6 : 2.2, 0.8);
      if (major) text(ctx, f + '°', 12.6, y, 6, COL.ink, 700, null, 'right');
    }
    slotPointer(ctx, 16.6, 14 + flaps * 1.8, COL.orange);
  }

  /* ------------------------------------------------------------------ firmas */
  function sigASI(st, L) { return L.redLine + ',' + L.greenArc[1] + ',' + L.whiteArc[0] + ',' + q(asiAngle(num((st.air || E).ias, 0)), 0.5); }
  function sigAttitude(st) { var a = aiShown(st); return q(a.bank, 0.5) + ',' + q(a.pitch, 0.25); }
  function sigAltimeter(st) { return q(altShown(st), 1.4) + ',' + q(num(st.altimeterSetting, 29.92), 0.01); }
  function sigTC(st) { return (tcPowered(st) ? 1 : 0) + ',' + q(tcAngle(st), 0.5) + ',' + q(clamp(num((st.air || E).slip, 0), -1, 1), 0.015); }
  function sigHI(st) { return q(hiShown(st), 0.5); }
  function sigVSI(st) { return q(vsiAngle(num((st.air || E).vs, 0)), 0.5); }
  function sigCompass(st) { return q(wrap360(num((st.air || E).heading, 0)), 0.1); }
  function sigClock() { var d = new Date(); return d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds(); }
  function sigOAT(st) { return q(oatAngle(oatC(st) * 9 / 5 + 32), 0.5); }
  function sigTach(st, L) {
    return L.rpmRed + ',' + q(tachAngle(num((st.engine || E).rpm, 0)), 0.5) + ',' + q(tachHours(st) * 10, 0.2);
  }
  function sigOil(st, L) { return L.oilTempRed + ',' + q(oilTempAngle(st), 0.5) + ',' + q(oilPressAngle(st), 0.5); }
  function sigFuel(st) { var f = st.fuel || E; return q(fuelAngle(st, num(f.leftGal, 0)), 0.5) + ',' + q(fuelAngle(st, num(f.rightGal, 0)), 0.5); }
  function sigAmmeter(st) { return q(ammeterAngle(num((st.elec || E).ammeterAmps, 0)), 0.5); }
  function sigSuction(st, L) { return L.suctionGreen[0] + ',' + q(suctionAngle(num((st.vacuum || E).suctionInHg, 0)), 0.5); }
  function sigNavcom(st) {
    var rd = st.radio || E;
    if (!radioOn(st)) return 'off';
    return freqStr(rd.comFreq) + ',' + freqStr(rd.comStby) + ',' + freqStr(rd.navFreq) + ',' + freqStr(rd.navStby);
  }
  function sigTransponder(st) {
    var rd = st.radio || E;
    return xpdrMode(st) + ',' + (xpdrPowered(st) ? 1 : 0) + ',' + String(rd.xpdrCode || '') + ',' + (xpdrReply(st) ? 1 : 0);
  }
  function sigVOR(st) {
    var v = vorSolve(st);
    return q(wrap360(num((st.radio || E).obs, 0)), 0.5) + ',' + (v.valid ? 1 : 0) + ',' + (v.to ? 1 : 0) + ',' + q(v.dev, 0.02);
  }
  function sigTrim(st) { return q(clamp(num(st.trim, 0), -1, 1), 0.005); }
  function sigFlaps(st) { return q(clamp(num(st.flaps, 0), 0, 40), 0.25); }

  /* ------------------------------------------------------------------ tabla de instrumentos */
  // w, h: canvas en píxeles; vw, vh: unidades de dibujo; round: cara redonda centrada (200 × 200).
  var GAUGES = {
    'asi':               { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawASI, sig: sigASI },
    'attitude':          { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawAttitude, sig: sigAttitude },
    'altimeter':         { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawAltimeter, sig: sigAltimeter },
    'turn-coordinator':  { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawTurnCoordinator, sig: sigTC },
    'heading-indicator': { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawHeadingIndicator, sig: sigHI },
    'vsi':               { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawVSI, sig: sigVSI },
    'compass':           { w: 1024, h: 256, vw: 400, vh: 100, round: false, bg: '#0B0A08', draw: drawCompass, sig: sigCompass },
    'clock':             { w: 384, h: 384, vw: 200, vh: 200, round: true, draw: drawClock, sig: sigClock },
    'oat':               { w: 384, h: 384, vw: 200, vh: 200, round: true, draw: drawOAT, sig: sigOAT },
    'tachometer':        { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawTachometer, sig: sigTach },
    'oil-gauges':        { w: 768, h: 384, vw: 200, vh: 100, round: false, bg: '#1E1F21', draw: drawOilGauges, sig: sigOil },
    'suction':           { w: 384, h: 384, vw: 200, vh: 200, round: true, draw: drawSuction, sig: sigSuction },
    'fuel-gauges':       { w: 768, h: 384, vw: 200, vh: 100, round: false, bg: '#1E1F21', draw: drawFuelGauges, sig: sigFuel },
    'ammeter':           { w: 384, h: 384, vw: 200, vh: 200, round: true, draw: drawAmmeter, sig: sigAmmeter },
    'navcom':            { w: 1024, h: 320, vw: 320, vh: 100, round: false, bg: '#26282B', draw: drawNavcom, sig: sigNavcom },
    'transponder':       { w: 1024, h: 320, vw: 320, vh: 100, round: false, bg: '#26282B', draw: drawTransponder, sig: sigTransponder },
    'vor-indicator':     { w: 512, h: 512, vw: 200, vh: 200, round: true, draw: drawVOR, sig: sigVOR },
    'trim-indicator':    { w: 160, h: 512, vw: 31.25, vh: 100, round: false, bg: '#222427', draw: drawTrimIndicator, sig: sigTrim },
    'flap-indicator':    { w: 128, h: 512, vw: 25, vh: 100, round: false, bg: '#222427', draw: drawFlapIndicator, sig: sigFlaps }
  };

  var IDS = ['asi', 'attitude', 'altimeter', 'turn-coordinator', 'heading-indicator', 'vsi', 'compass', 'clock',
    'oat', 'tachometer', 'oil-gauges', 'suction', 'fuel-gauges', 'ammeter', 'navcom', 'transponder',
    'vor-indicator', 'trim-indicator', 'flap-indicator'];

  function size(id) {
    var g = GAUGES[id];
    return g ? { w: g.w, h: g.h, round: g.round } : { w: 256, h: 256, round: false };
  }

  function draw(id, ctx, w, h, state) {
    var g = GAUGES[id];
    if (!g || !ctx) return;
    hookFonts();
    var st = state || E, L = limitsFor(st);
    w = w || g.w; h = h || g.h;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    shadowOff(ctx);
    if (!g.round && g.bg) { ctx.fillStyle = g.bg; ctx.fillRect(0, 0, w, h); }
    var k = Math.min(w / g.vw, h / g.vh);
    K = k;
    ctx.translate((w - g.vw * k) / 2, (h - g.vh * k) / 2);
    ctx.scale(k, k);
    if (g.round) ctx.translate(100, 100);
    g.draw(ctx, st, L);
    ctx.restore();
  }

  function signature(id, state) {
    var g = GAUGES[id];
    if (!g) return '';
    hookFonts();
    var st = state || E;
    return fontEpoch + '|' + g.sig(st, limitsFor(st));
  }

  C150.Gauges = { IDS: IDS, size: size, draw: draw, signature: signature, VOR: VOR };

  if (typeof module !== 'undefined' && module.exports) module.exports = C150.Gauges;
})(root.C150);
