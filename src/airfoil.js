var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * airfoil.js — C150.Airfoil: "El ala por dentro", the 2D wing-section lab (contract v2 §2).
 * No THREE, no DOM at load time (Node can load it for tests). Draws on a 2D canvas, devicePixelRatio aware.
 *
 *   var af = C150.Airfoil.create(canvas, { onDrag: function (aoa) {…}, aoa, flaps, ias, … });
 *   af.set({ aoa, flaps, ias, stallBlend, pressure, streamlines, labels, forces, timelines, caption,
 *            liftN, dragN, cl, cd });   // any subset, cheap to call every frame (e.g. from state.aero).
 *     liftN/dragN/cl/cd/stallBlend default to C150.Sim.aero()/stallAoa() for (ias, aoa, flaps); pass null to
 *     go back to the default. The flow is re-solved (≈ 10–30 ms) only when aoa moves ≥ 0.2°, flaps ≥ 0.25° or
 *     the stall blend ≥ 0.02, throttled to max(40 ms, 3 × solve time); ias only changes speed and arrows.
 *   af.frame(dt)   draw + animate (dt in s; 0 = redraw only). Resizes itself when the canvas css size changes.
 *   af.resize();  af.destroy();  af.get() → current params;  af.stats.solveMs / .lines
 *   opts.onDrag(aoa): when given, vertical drag on the canvas (and ↑/↓ keys when focused) changes the angle
 *     of attack in 0.5° / 1° steps (−6…22°); the canvas gets touch-action:none, tabindex 0 and a hint.
 *   Toggles (all default true): pressure (field + surface colours), streamlines (particles, ghost lines,
 *     eddies), timelines (pulses released together: the air over the top arrives first), forces (arrows),
 *     labels (text on the drawing), caption (one plain-Spanish sentence at the bottom, canvases ≥ 560 px).
 *   Respects prefers-reduced-motion (half-speed animation). aria-label describes the current state.
 *   C150.Airfoil.model → the pure flow model (buildSection, solveFlow, solveFlowBody, sectionCl; tests).
 *
 * Physics (potential flow, honest but simplified):
 *  - Section: Kármán–Trefftz mapping (TE angle 6°) of a circle, fitted to the NACA 2412 of the Cessna 150
 *    (t/c ≈ 0.12 at 30 %, camber 2 %). Circulation from the Kutta condition (smooth flow off the trailing edge).
 *    Streamlines are integrated in the circle plane (they can never enter the section) and mapped back; they are
 *    sampled at equal TIME steps, so particles riding them move at the true local speed (fast over the top, slow
 *    at the stagnation point) and the "timelines" show that the air over the top arrives first.
 *  - Flaps (aft 25 % of the chord, para-Fowler hinge slightly below the camber line): the flow is solved for a
 *    Kármán–Trefftz section with the flapped chord (LE → deflected TE) and extra camber — so circulation, upwash
 *    and downwash grow — and a smooth vertical shear (strongest at the surface, fading away from it) bends that
 *    section's camber line onto the real hinged one. The section outline is a streamline of the drawn flow.
 *  - Stall (stallBlend 0…1, from the simulator): the upper-surface flow separates at a point that moves from the
 *    trailing edge (0) to 28 % chord (1); streamlines above are lifted off the surface (separated shear layer),
 *    slowed, the suction plateau flattens and the bubble/wake fills with animated turbulent eddies.
 *  - Angle of attack: the chord is drawn at `aoa` to the horizontal relative wind (the number the student sets).
 *    The arrows use the simulator's wing numbers: lift ⟂ relative wind (straight up), drag ∥ wind (×4 so it is
 *    visible; the label carries the real kg). A tick on the lift line marks "= peso".
 *  - Colours: particles by local speed / free stream (deep blue slow → pale cyan free stream → amber fast);
 *    pressure field Cp = 1 − (V/V∞)² splatted from the streamlines (blue = baja presión, red = alta presión).
 */
(function (C150) {
  'use strict';

  var Airfoil = {};
  var PI = Math.PI, DEG = PI / 180;

  /* ------------------------------------------------------------- section */
  var KT_N = 2 - 6 / 180;       // trailing-edge angle 6°
  var KT_EPS = 0.0825;          // thickness parameter → t/c ≈ 0.119 at 30 %
  var KT_MU = 0.044;            // camber parameter → f/c ≈ 0.020
  var X_HINGE = 0.75;           // the flap is the aft 25 % of the chord
  var HINGE_DROP = 0.03;        // hinge below the camber line (the flap moves a little aft as it extends)
  var FLAP_DMU = 0.022;         // extra camber of the flow section at 40° of flap
  var FLAP_MAX = 40;
  var N_SURF = 300;             // contour samples
  var NXT = 161;                // x tables over the chord
  var DC_X0 = -1.5, DC_X1 = 3.5, DC_N = 1001;   // flap shear table
  var SHEAR_W = 0.32;           // chord: the flap shear fades away from the surface with this width

  /* -------------------------------------------------------------- flow */
  var DT_REC = 0.008;           // body time between recorded streamline points (chord / free-stream speed)
  var T_MAX = 7;                // longest streamline (and the particle cycle)
  var TRAIL = 0.16;             // particle trail, body time
  var PART_GAP = 0.3;           // average body time between particles on a line
  var TL_EVERY = 1.6;           // timelines released every … body time
  var RATE_80 = 0.5;            // chord per second at 80 kt (slow motion: the real air is ~50× faster)

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === 'number' && v === v) ? v : d; }
  function smooth01(x) { return x <= 0 ? 0 : (x >= 1 ? 1 : x * x * (3 - 2 * x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ------------------------------------------------- Kármán–Trefftz map */
  // z = n (1 + r)/(1 − r), r = q^n, q = (ζ − 1)/(ζ + 1);  dz/dζ = 4 n² r / ((ζ² − 1)(1 − r)²)
  var ZX = 0, ZY = 0, DX = 0, DY = 0;
  function kt(x, y, deriv) {
    var ax = x - 1, bx = x + 1, bd = bx * bx + y * y;
    var qx = (ax * bx + y * y) / bd, qy = (y * bx - ax * y) / bd;
    var rq = Math.sqrt(qx * qx + qy * qy), tq = Math.atan2(qy, qx);
    var rn = Math.pow(rq, KT_N), rx = rn * Math.cos(KT_N * tq), ry = rn * Math.sin(KT_N * tq);
    var vx = 1 - rx, vy = -ry, vd = vx * vx + vy * vy;
    var ux = 1 + rx, uy = ry;
    ZX = KT_N * (ux * vx + uy * vy) / vd; ZY = KT_N * (uy * vx - ux * vy) / vd;
    if (deriv) {
      var sx = x * x - y * y - 1, sy = 2 * x * y;
      var wx = vx * vx - vy * vy, wy = 2 * vx * vy;
      var px = sx * wx - sy * wy, py = sx * wy + sy * wx;
      var pd = px * px + py * py, k = 4 * KT_N * KT_N;
      if (pd < 1e-300) { DX = 1e-12; DY = 0; return; }
      DX = k * (rx * px + ry * py) / pd; DY = k * (ry * px - rx * py) / pd;
    }
  }
  /** Inverse map (seeds far from the section): z → ζ outside the circle, refined by Newton. */
  var IX = 0, IY = 0;
  function ktInverse(zx, zy) {
    var Zx = zx / KT_N, Zy = zy / KT_N;
    var ax = Zx - 1, bx = Zx + 1, bd = bx * bx + Zy * Zy;
    var rx = (ax * bx + Zy * Zy) / bd, ry = (Zy * bx - ax * Zy) / bd;
    var rr = Math.pow(Math.sqrt(rx * rx + ry * ry), 1 / KT_N), tr = Math.atan2(ry, rx) / KT_N;
    var qx = rr * Math.cos(tr), qy = rr * Math.sin(tr);
    var nx = 1 + qx, ny = qy, dx = 1 - qx, dy = -qy, dd = dx * dx + dy * dy;
    var x = (nx * dx + ny * dy) / dd, y = (ny * dx - nx * dy) / dd;
    if (!isFinite(x) || !isFinite(y)) { x = zx; y = zy; }
    for (var it = 0; it < 6; it++) {
      kt(x, y, true);
      var ex = ZX - zx, ey = ZY - zy, d2 = DX * DX + DY * DY;
      if (d2 < 1e-20) break;
      x -= (ex * DX + ey * DY) / d2; y -= (ey * DX - ex * DY) / d2;
      if (ex * ex + ey * ey < 1e-18) break;
    }
    IX = x; IY = y;
  }

  /* ------------------------------------------------------ section build */

  function interpTable(tab, x0, x1, n, x) {
    var f = (x - x0) / (x1 - x0) * (n - 1);
    if (f <= 0) return tab[0];
    if (f >= n - 1) return tab[n - 1];
    var i = f | 0, t = f - i;
    return tab[i] + (tab[i + 1] - tab[i]) * t;
  }
  /** Resample a polyline y(x) (x monotonic, either direction) on a uniform grid. */
  function resample(xs, ys, x0, x1, n, out) {
    var m = xs.length, j = 0;
    if (xs[m - 1] < xs[0]) { xs = xs.slice().reverse(); ys = ys.slice().reverse(); }
    for (var i = 0; i < n; i++) {
      var x = x0 + (x1 - x0) * i / (n - 1);
      while (j < m - 2 && xs[j + 1] < x) j++;
      var a = j, b = j + 1;
      var den = xs[b] - xs[a];
      var t = den !== 0 ? clamp((x - xs[a]) / den, 0, 1) : 0;
      out[i] = ys[a] + (ys[b] - ys[a]) * t;
    }
    return out;
  }

  var BASE = null;              // unflapped section (target geometry for the flap shear)

  /**
   * Build the flow section for a flap angle: circle, similarity to the body frame (base chord: LE (0,0),
   * TE (1,0)), contour, x tables and the flap shear. Body frame: x aft along the base chord, y up.
   */
  function buildSection(flapDeg) {
    var fr = clamp(flapDeg, 0, FLAP_MAX) / FLAP_MAX, d = clamp(flapDeg, 0, FLAP_MAX) * DEG;
    var S = { flaps: clamp(flapDeg, 0, FLAP_MAX), fr: fr };
    var mu = KT_MU + FLAP_DMU * fr;
    S.cx = -KT_EPS; S.cy = mu; S.a = Math.sqrt((1 + KT_EPS) * (1 + KT_EPS) + mu * mu);
    S.beta = Math.atan2(mu, 1 + KT_EPS);
    var th0 = -S.beta;
    // leading edge: farthest contour point from the TE (z = n, 0)
    var bestD = -1, bestTh = 0, k, th;
    for (k = 1; k < 720; k++) {
      th = th0 + 2 * PI * k / 720;
      kt(S.cx + S.a * Math.cos(th), S.cy + S.a * Math.sin(th), false);
      var dd = (ZX - KT_N) * (ZX - KT_N) + ZY * ZY;
      if (dd > bestD) { bestD = dd; bestTh = th; }
    }
    var lo = bestTh - 2 * PI / 720, hi = bestTh + 2 * PI / 720;
    for (k = 0; k < 40; k++) {
      var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      kt(S.cx + S.a * Math.cos(m1), S.cy + S.a * Math.sin(m1), false);
      var d1 = (ZX - KT_N) * (ZX - KT_N) + ZY * ZY;
      kt(S.cx + S.a * Math.cos(m2), S.cy + S.a * Math.sin(m2), false);
      var d2 = (ZX - KT_N) * (ZX - KT_N) + ZY * ZY;
      if (d1 > d2) hi = m2; else lo = m1;
    }
    S.thLE = 0.5 * (lo + hi);
    kt(S.cx + S.a * Math.cos(S.thLE), S.cy + S.a * Math.sin(S.thLE), false);
    S.lx = ZX; S.ly = ZY;
    // deflected trailing edge (rotation of the base TE about the hinge)
    var hx = X_HINGE, hy = (BASE ? interpTable(BASE.camber, 0, 1, NXT, X_HINGE) : 0.017) - HINGE_DROP;
    var tex = 1, tey = 0;
    if (d > 0) {
      var ox = 1 - hx, oy = 0 - hy;
      tex = hx + ox * Math.cos(d) + oy * Math.sin(d);
      tey = hy - ox * Math.sin(d) + oy * Math.cos(d);
    }
    S.hx = hx; S.hy = hy; S.tex = tex; S.tey = tey;
    // K = TE'_body / (TE_KT − LE_KT)
    var cxr = KT_N - S.lx, cyr = -S.ly, cd2 = cxr * cxr + cyr * cyr;
    S.Kx = (tex * cxr + tey * cyr) / cd2; S.Ky = (tey * cxr - tex * cyr) / cd2;
    S.Kabs = Math.sqrt(S.Kx * S.Kx + S.Ky * S.Ky); S.Karg = Math.atan2(S.Ky, S.Kx);

    // contour (body frame), from the TE over the top to the LE and back along the bottom
    var cx = new Float64Array(N_SURF), cy = new Float64Array(N_SURF), cth = new Float64Array(N_SURF);
    var iLE = 0, minX = 1e9;
    for (k = 0; k < N_SURF; k++) {
      th = th0 + 2 * PI * (k + 0.5) / N_SURF;
      kt(S.cx + S.a * Math.cos(th), S.cy + S.a * Math.sin(th), false);
      var bx = (ZX - S.lx) * S.Kx - (ZY - S.ly) * S.Ky, by = (ZX - S.lx) * S.Ky + (ZY - S.ly) * S.Kx;
      cx[k] = bx; cy[k] = by; cth[k] = th;
      if (bx < minX) { minX = bx; iLE = k; }
    }
    S.iLE = iLE;
    // x tables of the flow section (upper, lower, camber) over [0, tex]
    var ux = [], uy = [], lx2 = [], ly2 = [];
    ux.push(tex); uy.push(tey);
    for (k = 0; k <= iLE; k++) { ux.push(cx[k]); uy.push(cy[k]); }
    ux.push(0); uy.push(0);
    lx2.push(0); ly2.push(0);
    for (k = iLE; k < N_SURF; k++) { lx2.push(cx[k]); ly2.push(cy[k]); }
    lx2.push(tex); ly2.push(tey);
    S.x1 = tex;
    S.up = resample(ux, uy, 0, tex, NXT, new Float64Array(NXT));
    S.lo = resample(lx2, ly2, 0, tex, NXT, new Float64Array(NXT));
    S.camber = new Float64Array(NXT);
    for (k = 0; k < NXT; k++) S.camber[k] = 0.5 * (S.up[k] + S.lo[k]);

    // flap shear: target camber (base camber, flap part rotated about the hinge) − flow-section camber
    S.dc = new Float64Array(DC_N);
    if (d > 0 && BASE) {
      var txs = [], tys = [];
      for (k = 0; k < NXT; k++) {
        var x = k / (NXT - 1), yc = BASE.camber[k];
        if (x <= hx - 0.02) { txs.push(x); tys.push(yc); }
        else if (x >= hx) {
          var px = x - hx, py = yc - hy;
          txs.push(hx + px * Math.cos(d) + py * Math.sin(d));
          tys.push(hy - px * Math.sin(d) + py * Math.cos(d));
        }
      }
      var tgt = resample(txs, tys, 0, tex, NXT, new Float64Array(NXT));
      var diff = new Float64Array(NXT);
      for (k = 0; k < NXT; k++) diff[k] = tgt[k] - S.camber[k];
      var hstep = tex / (NXT - 1);
      var sLE = (diff[2] - diff[0]) / (2 * hstep), sTE = (diff[NXT - 1] - diff[NXT - 3]) / (2 * hstep);
      for (k = 0; k < DC_N; k++) {
        var xx = DC_X0 + (DC_X1 - DC_X0) * k / (DC_N - 1), v;
        if (xx < 0) v = sLE * xx * Math.exp(xx / 0.12);
        else if (xx > tex) { var u = xx - tex; v = sTE * u * Math.exp(-u / 0.2); }
        else v = interpTable(diff, 0, tex, NXT, xx);
        S.dc[k] = v;
      }
    }
    S.hasShear = d > 0 && !!BASE;

    // deformed contour (what is drawn) and its upper surface table
    S.sx = new Float64Array(N_SURF); S.sy = new Float64Array(N_SURF); S.sth = cth;
    for (k = 0; k < N_SURF; k++) {
      S.sx[k] = cx[k];
      S.sy[k] = cy[k] + shearAt(S, cx[k], cy[k]);
    }
    var dux = [], duy = [];
    dux.push(tex); duy.push(tey);
    for (k = 0; k <= iLE; k++) { dux.push(S.sx[k]); duy.push(S.sy[k]); }
    dux.push(0); duy.push(0);
    S.upDef = resample(dux, duy, 0, tex, NXT, new Float64Array(NXT));
    var dlx = [0], dly = [0];
    for (k = iLE; k < N_SURF; k++) { dlx.push(S.sx[k]); dly.push(S.sy[k]); }
    dlx.push(tex); dly.push(tey);
    S.loDef = resample(dlx, dly, 0, tex, NXT, new Float64Array(NXT));
    return S;
  }

  function shearAt(S, x, y) {
    if (!S.hasShear) return 0;
    var dc = interpTable(S.dc, DC_X0, DC_X1, DC_N, x);
    if (dc === 0) return 0;
    var yc = interpTable(S.camber, 0, S.x1, NXT, x);
    var e = (y - yc) / SHEAR_W;
    return dc * Math.exp(-e * e);
  }

  BASE = buildSection(0);

  /* ------------------------------------------------------------ flow solve */

  /** Complex velocity factor in the circle plane: sets WX, WY = W'(ζ) (conjugate velocity, U = 1). */
  var WX = 0, WY = 0;
  function wprime(F, x, y) {
    var dx = x - F.S.cx, dy = y - F.S.cy, d2 = dx * dx + dy * dy;
    var ix = dx / d2, iy = -dy / d2;
    var i2x = ix * ix - iy * iy, i2y = 2 * ix * iy;
    var a2 = F.S.a * F.S.a, ca = F.ca, sa = F.sa, g = F.G / (2 * PI);
    WX = ca - a2 * (ca * i2x - sa * i2y) - g * iy;
    WY = -sa - a2 * (ca * i2y + sa * i2x) + g * ix;
  }
  function psiAt(F, x, y) {
    var dx = x - F.S.cx, dy = y - F.S.cy, d2 = dx * dx + dy * dy;
    var a2 = F.S.a * F.S.a;
    return dy * F.ca - dx * F.sa + a2 * (F.sa * dx - F.ca * dy) / d2 + F.G / (2 * PI) * 0.5 * Math.log(d2);
  }
  /** dζ/dτ (τ = body time, free stream = 1 chord per unit): sets VX, VY. */
  var VX = 0, VY = 0;
  function zetaVel(F, x, y) {
    wprime(F, x, y);
    kt(x, y, true);
    var den = (DX * DX + DY * DY) * F.S.Kabs;
    if (den < 1e-12) den = 1e-12;
    VX = WX / den; VY = -WY / den;
  }
  /** Local speed ratio |V|/V∞ at ζ. */
  function speedAt(F, x, y) {
    wprime(F, x, y);
    kt(x, y, true);
    var dm = Math.sqrt(DX * DX + DY * DY);
    return dm > 1e-9 ? Math.sqrt(WX * WX + WY * WY) / dm : 0;
  }

  /**
   * Solve the flow for a section, angle of attack (deg) and stall blend.
   * view: { toBody(sx, sy) → sets BXo/BYo, toScreen(bx, by) → sets SXo/SYo, w, h, seeds: number }
   * Returns { lines: [{sx, sy, sp, n, upper}], surfCp, sep, … }.
   */
  function solveFlow(S, aoaDeg, sb, view) {
    var F = { S: S };
    var aZ = aoaDeg * DEG - S.Karg;
    F.ca = Math.cos(aZ); F.sa = Math.sin(aZ);
    F.G = 4 * PI * S.a * Math.sin(aZ + S.beta);
    F.psiBody = F.G / (2 * PI) * Math.log(S.a);
    F.aoa = aoaDeg; F.sb = sb;
    // separation (stall): from the TE (sb 0) to 28 % chord (sb 1)
    F.xSep = lerp(S.x1 * 0.98, 0.28, smooth01(sb));
    F.bubble = sb;
    F.wakeSlope = Math.tan(aoaDeg * DEG * 0.7);

    // surface speed / Cp (on the drawn contour)
    var n = N_SURF, cp = new Float64Array(n);
    for (var k = 0; k < n; k++) {
      var th = S.sth[k];
      var s = speedAt(F, S.cx + S.a * Math.cos(th), S.cy + S.a * Math.sin(th));
      cp[k] = 1 - s * s;
    }
    if (sb > 0.01) {
      // separated: the upper-surface suction flattens to a plateau behind the separation point
      var cpSep = 0, best = 1e9;
      for (k = 0; k <= S.iLE; k++) { var dxs = Math.abs(S.sx[k] - F.xSep); if (dxs < best) { best = dxs; cpSep = cp[k]; } }
      var plateau = Math.min(-0.05, cpSep * 0.75);
      for (k = 0; k <= S.iLE; k++) {
        var w = smooth01((S.sx[k] - F.xSep) / 0.12) * smooth01(sb * 1.6);
        cp[k] = lerp(cp[k], plateau, w);
      }
    }
    // a real trailing edge recovers to Cp ≈ +0.2, not to the stagnation value of the ideal finite-angle edge
    for (k = 0; k < n; k++) {
      var wt = smooth01((S.sx[k] - (S.x1 - 0.06)) / 0.06);
      if (wt > 0) cp[k] = lerp(cp[k], Math.min(cp[k], 0.2), wt);
    }
    F.surfCp = cp;
    F.plateau = sb > 0.01 ? plateau : 0;
    if (!view) return F;

    // seeds: equal spacing at the left edge (equal flux far upstream), the dividing streamline between two
    var nSeeds = view.seeds, top = -view.h * 0.12, bot = view.h * 1.12;
    var gap = (bot - top) / (nSeeds - 1);
    var seedX = -6;
    var psis = new Float64Array(nSeeds), zs = new Float64Array(nSeeds * 2);
    function seedAt(i, off) {
      view.toBody(seedX, top + gap * i + off);
      // body → KT plane: z = body / K + LE
      var kd = S.Kx * S.Kx + S.Ky * S.Ky;
      var zx = (BXo * S.Kx + BYo * S.Ky) / kd + S.lx;
      var zy = (BYo * S.Kx - BXo * S.Ky) / kd + S.ly;
      ktInverse(zx, zy);
      zs[i * 2] = IX; zs[i * 2 + 1] = IY;
      psis[i] = psiAt(F, IX, IY);
    }
    var i;
    for (i = 0; i < nSeeds; i++) seedAt(i, 0);
    // psi decreases downwards on the screen; find the bracket of psiBody and center it
    var off = 0;
    for (i = 0; i < nSeeds - 1; i++) {
      var p0 = psis[i], p1 = psis[i + 1];
      if ((p0 - F.psiBody) * (p1 - F.psiBody) <= 0 && p0 !== p1) {
        var f = (F.psiBody - p0) / (p1 - p0);
        off = (f - 0.5) * gap;
        break;
      }
    }
    if (off !== 0) for (i = 0; i < nSeeds; i++) seedAt(i, off);

    var lines = [];
    var maxRec = Math.ceil(T_MAX / DT_REC) + 1;
    var bufX = new Float64Array(maxRec), bufY = new Float64Array(maxRec), bufS = new Float64Array(maxRec);
    var a = S.a, aMin = a * 1.0006;
    for (i = 0; i < nSeeds; i++) {
      var x = zs[i * 2], y = zs[i * 2 + 1];
      var upper = psis[i] > F.psiBody;
      var cnt = 0, tau = 0;
      while (cnt < maxRec) {
        // one evaluation gives the position, the local speed and the first RK2 slope
        kt(x, y, true);
        var bx = (ZX - S.lx) * S.Kx - (ZY - S.ly) * S.Ky, by = (ZX - S.lx) * S.Ky + (ZY - S.ly) * S.Kx;
        wprime(F, x, y);
        var d2 = DX * DX + DY * DY, dm = Math.sqrt(d2);
        bufX[cnt] = bx; bufY[cnt] = by;
        bufS[cnt] = dm > 1e-9 ? Math.sqrt(WX * WX + WY * WY) / dm : 0;
        cnt++;
        view.toScreen(bx, by);
        if (cnt > 3 && (SXo > view.w + 24 || SYo < -view.h * 0.3 || SYo > view.h * 1.3 || SXo < -40)) break;
        var den = Math.max(1e-12, d2 * S.Kabs);
        var v1x = WX / den, v1y = -WY / den;
        var vm = Math.sqrt(v1x * v1x + v1y * v1y) * DT_REC;
        var sub = clamp(Math.ceil(vm / (0.012 * a)), 1, 32), hh = DT_REC / sub;
        for (var j = 0; j < sub; j++) {
          if (j > 0) { zetaVel(F, x, y); v1x = VX; v1y = VY; }
          zetaVel(F, x + 0.5 * hh * v1x, y + 0.5 * hh * v1y);
          x += hh * VX; y += hh * VY;
          var rx = x - S.cx, ry = y - S.cy, rr = Math.sqrt(rx * rx + ry * ry);
          if (rr < aMin) { x = S.cx + rx * aMin / rr; y = S.cy + ry * aMin / rr; }
        }
        tau += DT_REC;
      }
      if (cnt < 4) continue;
      // deformations (flap shear, separated flow) and screen coordinates
      var L = { n: cnt, upper: upper, order: i,
        bx: new Float32Array(cnt), by: new Float32Array(cnt),
        sx: new Float32Array(cnt), sy: new Float32Array(cnt), sp: new Float32Array(cnt) };
      for (j = 0; j < cnt; j++) {
        var px = bufX[j], py = bufY[j], sp = bufS[j];
        py += shearAt(S, px, py);
        if (upper && sb > 0.01) {
          var res = separate(F, S, px, py, sp);
          py = res; sp = SEP_SP;
        }
        L.bx[j] = px; L.by[j] = py; L.sp[j] = sp;
        view.toScreen(px, py);
        L.sx[j] = SXo; L.sy[j] = SYo;
      }
      lines.push(L);
    }
    F.lines = lines;
    return F;
  }

  /** Upper-surface reference line: deformed upper surface over the chord, then the wake direction. */
  function upperRef(F, S, x) {
    if (x <= 0) return 0;
    if (x <= S.x1) return interpTable(S.upDef, 0, S.x1, NXT, x);
    return S.tey + (x - S.x1) * F.wakeSlope;
  }
  /** Bubble thickness (chord) of the separated region at x. */
  function bubbleAt(F, S, x) {
    if (F.sb <= 0.01 || x <= F.xSep) return 0;
    var u = x - F.xSep;
    var grow = smooth01(u / 0.35) * (1 + 0.45 * clamp(x - S.x1, 0, 1.6));
    var fade = x > S.x1 + 1.6 ? Math.exp(-(x - S.x1 - 1.6) / 0.8) : 1;
    return Math.min(0.26, smooth01(F.sb * 1.25) * 0.15 * grow * fade);
  }
  var SEP_SP = 1;
  function separate(F, S, x, y, sp) {
    var B = bubbleAt(F, S, x);
    SEP_SP = sp;
    if (B <= 0) return y;
    var d = Math.max(0, y - upperRef(F, S, x));
    var e = Math.exp(-d / 0.3);
    var slow = smooth01((x - F.xSep) / 0.2) * Math.exp(-d / 0.28) * smooth01(F.sb * 1.4);
    SEP_SP = sp * (1 - 0.5 * slow);
    return y + B * e;
  }

  /* -------------------------------------------------------- colours */
  var SPEED_STOPS = [
    [0.0, [24, 52, 170]], [0.45, [40, 92, 235]], [0.75, [86, 160, 255]], [0.92, [170, 220, 255]],
    [1.0, [228, 246, 255]], [1.12, [255, 240, 200]], [1.3, [255, 210, 120]], [1.55, [255, 176, 64]],
    [1.9, [255, 138, 40]], [2.6, [255, 96, 40]]
  ];
  function speedRGB(s) {
    var st = SPEED_STOPS;
    if (s <= st[0][0]) return st[0][1];
    for (var i = 1; i < st.length; i++) {
      if (s <= st[i][0]) {
        var t = (s - st[i - 1][0]) / (st[i][0] - st[i - 1][0]), a = st[i - 1][1], b = st[i][1];
        return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
      }
    }
    return st[st.length - 1][1];
  }
  var BIN_EDGES = [0.45, 0.7, 0.86, 0.95, 1.04, 1.13, 1.26, 1.42, 1.62, 1.9];
  var BIN_SPEED = [0.32, 0.6, 0.79, 0.91, 1.0, 1.08, 1.2, 1.34, 1.52, 1.75, 2.2];
  var NB = BIN_SPEED.length;
  var BIN_RGB = BIN_SPEED.map(speedRGB);
  // free-stream air is drawn softer so the places where the air speeds up or slows down stand out
  var BIN_ALPHA = BIN_SPEED.map(function (s) { return 0.45 + 0.55 * smooth01(Math.abs(s - 1) / 0.3); });
  function binOf(s) {
    for (var i = 0; i < BIN_EDGES.length; i++) if (s < BIN_EDGES[i]) return i;
    return NB - 1;
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  var COL = {
    bg0: '#060c16', bg1: '#0b1626', grid: 'rgba(120,170,255,0.055)', gridStrong: 'rgba(120,170,255,0.11)',
    ink: '#e8f1f8', soft: '#9fb2c4', faint: 'rgba(200,220,240,0.45)',
    accent: '#F08A3C', lift: '#72e3a0', drag: '#ff6f5e', wind: '#e8f4ff',
    suction: [70, 140, 255], press: [255, 86, 74], stall: '#ff4d3d', warn: '#ffb020'
  };
  var FONT_D = "'Barlow Condensed', 'Arial Narrow', sans-serif";
  var FONT_B = "'Atkinson Hyperlegible', system-ui, sans-serif";
  var FONT_M = "'B612 Mono', ui-monospace, monospace";

  function fmt(v, dec) {
    var s = (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec);
    return s.replace('.', ',').replace(/^-/, '−');
  }

  /* ------------------------------------------------------------ renderer */

  function makeCanvas(w, h) {
    if (typeof document === 'undefined') return null;
    var c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    return c;
  }

  Airfoil.create = function (canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var P = {
      aoa: num(opts.aoa, 4), flaps: num(opts.flaps, 0), ias: num(opts.ias, 80), stallBlend: null,
      pressure: opts.pressure !== false, streamlines: opts.streamlines !== false, labels: opts.labels !== false,
      forces: opts.forces !== false, timelines: opts.timelines !== false, caption: opts.caption !== false,
      liftN: null, dragN: null, cl: null, cd: null
    };
    var W = 0, H = 0, dpr = 1, C = 140, PX = 0, PY = 0;
    var layer = null, lctx = null, flowL = null, flctx = null, foil = null, fctx = null, field = null;
    var sec = null, secFlaps = -1, flow = null;
    var dirty = true, layersDirty = true, lastSolve = -1e9, solveMs = 0;
    var clock = 0, visAlpha = 0, destroyed = false;
    var phases = [];               // per line order: particle phases (body time)
    var eddies = [];
    var dragState = null, hintAlpha = opts.onDrag ? 1 : 0, usedDrag = false;
    var reduced = false;
    try { reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { reduced = false; }
    var ca = 1, sa = 0;            // cos/sin of the drawn aoa
    var seedRand = 12345;
    function rand() { seedRand = (Math.imul(seedRand, 1664525) + 1013904223) >>> 0; return seedRand / 4294967296; }

    /* ---------- transforms (body ↔ screen) ---------- */
    var view = {
      w: 0, h: 0, seeds: 24,
      toScreen: function (bx, by) {
        var x = bx - 0.25;
        var rx = x * ca + by * sa, ry = -x * sa + by * ca;
        SXo = PX + rx * C; SYo = PY - ry * C;
      },
      toBody: function (sx, sy) {
        var rx = (sx - PX) / C, ry = (PY - sy) / C;
        BXo = rx * ca - ry * sa + 0.25; BYo = rx * sa + ry * ca;
      }
    };

    function effStall() {
      if (P.stallBlend !== null && P.stallBlend !== undefined) return clamp(P.stallBlend, 0, 1);
      var aS = (C150.Sim && C150.Sim.stallAoa) ? C150.Sim.stallAoa(P.flaps) : 16 - P.flaps / 40;
      return P.ias > 15 ? smooth01((P.aoa - (aS - 3)) / 4.5) : 0;
    }
    function forcesNow() {
      var L = P.liftN, D = P.dragN, cl = P.cl, cd = P.cd;
      if (L === null || D === null || cl === null || cd === null) {
        var a = null;
        if (C150.Sim && C150.Sim.aero) a = C150.Sim.aero({ ias: P.ias, aoa: P.aoa, flaps: P.flaps });
        if (a) {
          if (L === null) L = a.liftN; if (D === null) D = a.dragN;
          if (cl === null) cl = a.cl; if (cd === null) cd = a.cd;
        } else {
          var aS = 16 - P.flaps / 40, c0 = 0.085 * Math.min(P.aoa, aS) + 0.45 * P.flaps / 40;
          if (P.aoa > aS) c0 *= 0.72;
          var q = 0.5 * 1.225 * Math.pow(P.ias * 0.514444, 2);
          if (cl === null) cl = c0;
          if (cd === null) cd = 0.027 + 0.055 * P.flaps / 40 + 0.06 * c0 * c0;
          if (L === null) L = q * 14.86 * cl; if (D === null) D = q * 14.86 * cd;
        }
      }
      return { L: L, D: D, cl: cl, cd: cd, W: 725.7 * 9.80665 };
    }

    /* ---------- layout & solve ---------- */
    function layout() {
      C = Math.min(W * 0.44, H * 1.05);
      PX = W * 0.40; PY = H * 0.56;
      view.w = W; view.h = H;
      view.seeds = clamp(Math.round(H / 12.5), 14, 36);
    }
    function solve() {
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      var fq = Math.round(P.flaps * 4) / 4;
      if (!sec || secFlaps !== fq) { sec = buildSection(fq); secFlaps = fq; }
      var sb = Math.round(effStall() * 50) / 50;
      ca = Math.cos(P.aoa * DEG); sa = Math.sin(P.aoa * DEG);
      flow = solveFlow(sec, P.aoa, sb, view);
      // persistent particle phases per seed slot (stable while the student drags)
      var per = Math.round(T_MAX / PART_GAP);
      for (var i = 0; i < flow.lines.length; i++) {
        var o = flow.lines[i].order;
        if (!phases[o]) {
          var ph = new Float32Array(per);
          for (var k = 0; k < per; k++) ph[k] = (k + rand() * 0.9) * T_MAX / per;
          phases[o] = ph;
        }
      }
      renderLayers();
      dirty = false;
      var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      solveMs = t1 - t0;
      lastSolve = t1;
    }

    /* ---------- static layers (background + pressure + ghost lines; section) ---------- */
    function renderLayers() {
      if (!layer || !W) return;
      var g = lctx;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // background: deep technical blue with a soft spotlight and a fine grid
      var bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, COL.bg1); bg.addColorStop(1, COL.bg0);
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      var spot = g.createRadialGradient(PX + C * 0.2, PY - C * 0.1, C * 0.05, PX + C * 0.2, PY, Math.max(W, H) * 0.75);
      spot.addColorStop(0, 'rgba(60,110,190,0.20)'); spot.addColorStop(1, 'rgba(60,110,190,0)');
      g.fillStyle = spot; g.fillRect(0, 0, W, H);
      var step = Math.max(10, Math.round(C / 10));
      g.lineWidth = 1;
      for (var gx = (PX % step); gx < W; gx += step) {
        g.strokeStyle = Math.round((gx - PX) / step) % 5 === 0 ? COL.gridStrong : COL.grid;
        g.beginPath(); g.moveTo(Math.round(gx) + 0.5, 0); g.lineTo(Math.round(gx) + 0.5, H); g.stroke();
      }
      for (var gy = (PY % step); gy < H; gy += step) {
        g.strokeStyle = Math.round((gy - PY) / step) % 5 === 0 ? COL.gridStrong : COL.grid;
        g.beginPath(); g.moveTo(0, Math.round(gy) + 0.5); g.lineTo(W, Math.round(gy) + 0.5); g.stroke();
      }
      // flow layer (fades out with the wind): pressure field, ghost streamlines, surface pressure
      g = flctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, flowL.width, flowL.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (flow && P.pressure) drawPressureField(g);
      if (flow && P.pressure) drawSurfaceCp(g);
      if (flow && P.streamlines) {
        // ghost streamlines: the whole pattern, faint (readable even when paused)
        g.lineWidth = 1;
        g.globalCompositeOperation = 'lighter';
        for (var b = 0; b < NB; b++) {
          g.beginPath();
          var any = false;
          for (var i = 0; i < flow.lines.length; i++) {
            var L = flow.lines[i], open = false;
            for (var j = 0; j < L.n; j += 2) {
              var inb = binOf(L.sp[j]) === b;
              if (inb) {
                if (!open) { g.moveTo(L.sx[j], L.sy[j]); open = true; }
                else g.lineTo(L.sx[j], L.sy[j]);
                any = true;
              } else if (open) { g.lineTo(L.sx[j], L.sy[j]); open = false; }
            }
          }
          if (any) { g.strokeStyle = rgba(BIN_RGB[b], 0.05 + 0.08 * BIN_ALPHA[b]); g.stroke(); }
        }
        g.globalCompositeOperation = 'source-over';
      }
      renderFoil();
      layersDirty = false;
    }

    function drawPressureField(g) {
      var cell = Math.max(5, Math.round(W / 90));
      var gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1, N = gw * gh;
      var sum = new Float32Array(N), cnt = new Float32Array(N);
      function splat(x, y, v, wgt) {
        var ix = Math.round(x / cell), iy = Math.round(y / cell);
        if (ix < 0 || iy < 0 || ix >= gw || iy >= gh) return;
        var id = iy * gw + ix; sum[id] += v * wgt; cnt[id] += wgt;
      }
      var i, j, L;
      for (i = 0; i < flow.lines.length; i++) {
        L = flow.lines[i];
        for (j = 0; j < L.n; j += 2) splat(L.sx[j], L.sy[j], 1 - L.sp[j] * L.sp[j], 1);
      }
      if (flow.sb > 0.02) {
        // the separated bubble / wake: low, flat pressure (no recovery)
        for (var bx = flow.xSep; bx < sec.x1 + 1.6; bx += 0.02) {
          var bb = bubbleAt(flow, sec, bx), by0 = upperRef(flow, sec, bx);
          if (bb <= 0.004) continue;
          for (var bv = 0.05; bv < 1; bv += 0.15) {
            view.toScreen(bx, by0 + bb * bv);
            splat(SXo, SYo, flow.plateau * 0.35, 2.5);
          }
        }
      }
      var S = sec, cp = flow.surfCp;
      for (j = 0; j < N_SURF; j++) {
        view.toScreen(S.sx[j], S.sy[j]);
        splat(SXo, SYo, cp[j], 3);
      }
      var val = new Float32Array(N), has = new Uint8Array(N);
      for (i = 0; i < N; i++) if (cnt[i] > 0) { val[i] = sum[i] / cnt[i]; has[i] = 1; }
      // fill gaps (inside the section, the separated bubble) by diffusion, then blur
      for (var pass = 0; pass < 8; pass++) {
        var changed = false;
        for (var y = 0; y < gh; y++) for (var x = 0; x < gw; x++) {
          var id = y * gw + x;
          if (has[id]) continue;
          var s = 0, c = 0;
          if (x > 0 && has[id - 1] === 1) { s += val[id - 1]; c++; }
          if (x < gw - 1 && has[id + 1] === 1) { s += val[id + 1]; c++; }
          if (y > 0 && has[id - gw] === 1) { s += val[id - gw]; c++; }
          if (y < gh - 1 && has[id + gw] === 1) { s += val[id + gw]; c++; }
          if (c) { val[id] = s / c; has[id] = 2; changed = true; }
        }
        for (i = 0; i < N; i++) if (has[i] === 2) has[i] = 1;
        if (!changed) break;
      }
      var tmp = new Float32Array(N);
      for (pass = 0; pass < 2; pass++) {
        for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) {
          var s2 = 0, c2 = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            var xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
            s2 += val[yy * gw + xx]; c2++;
          }
          tmp[y * gw + x] = s2 / c2;
        }
        val.set(tmp);
      }
      if (!field) field = makeCanvas(gw, gh);
      if (!field) return;
      field.width = gw; field.height = gh;
      var fx = field.getContext('2d'), img = fx.createImageData(gw, gh), d = img.data;
      for (i = 0; i < N; i++) {
        var v = val[i], o = i * 4;
        if (v < 0) {
          var a = Math.min(0.5, -v * 0.36);
          d[o] = COL.suction[0]; d[o + 1] = COL.suction[1]; d[o + 2] = COL.suction[2]; d[o + 3] = Math.round(a * 255);
        } else {
          var a2 = Math.min(0.5, v * 0.85);
          d[o] = COL.press[0]; d[o + 1] = COL.press[1]; d[o + 2] = COL.press[2]; d[o + 3] = Math.round(a2 * 255);
        }
      }
      fx.putImageData(img, 0, 0);
      g.save();
      g.imageSmoothingEnabled = true;
      try { g.imageSmoothingQuality = 'high'; } catch (e) { /* older browsers */ }
      g.drawImage(field, 0, 0, gw, gh, -cell / 2, -cell / 2, gw * cell, gh * cell);
      g.restore();
    }

    function drawSurfaceCp(g) {
      var S = sec, cp = flow.surfCp, lw = Math.max(3, C * 0.03);
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.shadowBlur = Math.max(4, C * 0.03);
      for (var k = 0; k < N_SURF; k++) {
        var k2 = (k + 1) % N_SURF;
        view.toScreen(S.sx[k], S.sy[k]); var ax = SXo, ay = SYo;
        view.toScreen(S.sx[k2], S.sy[k2]);
        var v = 0.5 * (cp[k] + cp[k2]), col;
        if (v < 0) { var u = clamp(-v / 2.2, 0, 1); col = 'rgb(' + Math.round(lerp(190, 70, u)) + ',' + Math.round(lerp(205, 150, u)) + ',255)'; }
        else { var u2 = clamp(v, 0, 1); col = 'rgb(255,' + Math.round(lerp(205, 90, u2)) + ',' + Math.round(lerp(200, 80, u2)) + ')'; }
        g.strokeStyle = col; g.shadowColor = col; g.lineWidth = lw;
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(SXo, SYo); g.stroke();
      }
      g.restore();
    }

    function foilPath(g) {
      var S = sec;
      g.beginPath();
      view.toScreen(S.tex, S.tey); g.moveTo(SXo, SYo);
      for (var k = 0; k < N_SURF; k++) { view.toScreen(S.sx[k], S.sy[k]); g.lineTo(SXo, SYo); }
      g.closePath();
    }

    function renderFoil() {
      var g = fctx, S = sec;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      if (!S) return;
      // drop shadow / glow under the section
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = Math.max(6, C * 0.05); g.shadowOffsetY = C * 0.015;
      foilPath(g);
      var grad = g.createLinearGradient(PX, PY - C * 0.1, PX, PY + C * 0.08);
      grad.addColorStop(0, '#5b6b7c'); grad.addColorStop(0.45, '#3a4757'); grad.addColorStop(1, '#232c37');
      g.fillStyle = grad; g.fill();
      g.restore();
      // cut-section hatch, spars and the flap (clipped to the section)
      g.save();
      foilPath(g); g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
      var hs = Math.max(4, C / 34);
      g.beginPath();
      for (var t = -H; t < W + H; t += hs) { g.moveTo(t, 0); g.lineTo(t - H, H); }
      g.stroke();
      [0.25, 0.66].forEach(function (xs) {
        view.toScreen(xs, 0.2); var x0 = SXo, y0 = SYo; view.toScreen(xs, -0.2);
        g.strokeStyle = 'rgba(10,16,24,0.55)'; g.lineWidth = Math.max(2, C * 0.014);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(SXo, SYo); g.stroke();
      });
      if (S.flaps > 0.2) {
        // the flap: lighter skin with an orange cast, and the slot at the hinge
        g.beginPath();
        view.toScreen(S.hx - 0.01, 0.3); g.moveTo(SXo, SYo);
        view.toScreen(1.6, 0.3); g.lineTo(SXo, SYo);
        view.toScreen(1.6, -0.6); g.lineTo(SXo, SYo);
        view.toScreen(S.hx - 0.01, -0.6); g.lineTo(SXo, SYo);
        g.closePath();
        g.fillStyle = 'rgba(240,138,60,' + (0.16 + 0.14 * S.fr) + ')'; g.fill();
        view.toScreen(S.hx - 0.012, 0.15); var sx0 = SXo, sy0 = SYo; view.toScreen(S.hx + 0.012, -0.15);
        g.strokeStyle = 'rgba(6,10,16,0.9)'; g.lineWidth = Math.max(1.5, C * 0.01);
        g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(SXo, SYo); g.stroke();
      }
      g.restore();
      // thin rim (the surface pressure colours are drawn in the flow layer, under the section)
      g.lineJoin = 'round';
      foilPath(g); g.strokeStyle = 'rgba(220,235,250,0.55)'; g.lineWidth = 1; g.stroke();
      // chord line (base chord) dashed
      g.save();
      g.setLineDash([Math.max(3, C * 0.025), Math.max(3, C * 0.02)]);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
      view.toScreen(0, 0); var cx0 = SXo, cy0 = SYo; view.toScreen(S.flaps > 0.2 ? X_HINGE : 1, 0);
      g.beginPath(); g.moveTo(cx0, cy0); g.lineTo(SXo, SYo); g.stroke();
      g.restore();
    }

    /* ---------- per-frame drawing ---------- */
    var bucket = [];
    function drawParticles() {
      if (!flow || !P.streamlines || visAlpha < 0.01) return;
      var g = ctx, lines = flow.lines, per = Math.round(T_MAX / PART_GAP);
      var i, b;
      // bucket index: ((bin · 2 + head) · 2 + far); one stroke per bucket keeps the frame cheap
      for (b = 0; b < NB * 4; b++) bucket[b] = null;
      var heads = [];
      for (i = 0; i < NB * 2; i++) heads.push(null);
      var trailN = Math.round(TRAIL / DT_REC);
      for (i = 0; i < lines.length; i++) {
        var L = lines[i], ph = phases[L.order];
        if (!ph) continue;
        // lines that pass far from the wing are drawn softer: the eye goes to the air the wing moves
        var far = Math.abs(L.sy[0] - PY) > C * 0.62 ? 1 : 0;
        var dur = (L.n - 1) * DT_REC;
        for (var k = 0; k < per; k++) {
          var tau = (ph[k] + clock) % T_MAX;
          if (tau > dur + TRAIL) continue;
          var i1 = Math.min(L.n - 1, Math.floor(tau / DT_REC));
          var i0 = Math.max(0, i1 - Math.round(trailN * (0.6 + ((k * 0.618034) % 1) * 0.8)));
          if (i1 - i0 < 2) continue;
          var bin = binOf(L.sp[i1]);
          var mid = (i0 + i1) >> 1;
          var bt = (bin * 2) * 2 + far, bh = (bin * 2 + 1) * 2 + far;
          var pt = bucket[bt] || (bucket[bt] = new Path2D());
          pt.moveTo(L.sx[i0], L.sy[i0]);
          for (var j = i0 + 2; j <= mid; j += 2) pt.lineTo(L.sx[j], L.sy[j]);
          pt.lineTo(L.sx[mid], L.sy[mid]);
          var ph2 = bucket[bh] || (bucket[bh] = new Path2D());
          ph2.moveTo(L.sx[mid], L.sy[mid]);
          for (j = mid + 1; j <= i1; j++) ph2.lineTo(L.sx[j], L.sy[j]);
          if (tau <= dur) {
            var hi = bin * 2 + far;
            var hp = heads[hi] || (heads[hi] = new Path2D());
            hp.rect(L.sx[i1] - 1, L.sy[i1] - 1, 2, 2);
          }
        }
      }
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round'; g.lineJoin = 'round';
      var gw = Math.max(2.4, C * 0.024), cw = Math.max(1, C * 0.0085);
      for (b = 0; b < NB; b++) {
        var c = BIN_RGB[b];
        for (var f = 0; f < 2; f++) {
          var ba = BIN_ALPHA[b] * visAlpha * (f ? 0.42 : 1);
          var tl = bucket[(b * 2) * 2 + f], hd = bucket[(b * 2 + 1) * 2 + f];
          if (hd) {
            if (!f) { g.strokeStyle = rgba(c, 0.16 * ba); g.lineWidth = gw; g.stroke(hd); }
            g.strokeStyle = rgba(c, 0.9 * ba); g.lineWidth = cw; g.stroke(hd);
          }
          if (tl) { g.strokeStyle = rgba(c, 0.3 * ba); g.lineWidth = cw; g.stroke(tl); }
          if (heads[b * 2 + f]) { g.fillStyle = rgba(c, ba); g.fill(heads[b * 2 + f]); }
        }
      }
      g.restore();
    }

    function drawTimelines() {
      if (!flow || !P.streamlines || !P.timelines || visAlpha < 0.01) return;
      var g = ctx, lines = flow.lines;
      var ups = [], lows = [];
      for (var i = 0; i < lines.length; i++) (lines[i].upper ? ups : lows).push(lines[i]);
      ups.sort(function (a, b) { return a.order - b.order; });
      lows.sort(function (a, b) { return a.order - b.order; });
      g.save();
      g.globalCompositeOperation = 'lighter';
      var first = Math.floor(clock / TL_EVERY);
      for (var r = 0; r < 4; r++) {
        var rel = (first - r) * TL_EVERY, age = clock - rel;
        if (age < 0 || age > T_MAX * 0.75) continue;
        var fade = smooth01(age / 0.25) * (1 - smooth01((age - 2.6) / 1.2));
        if (fade <= 0.01) continue;
        var tg = g.createLinearGradient(0, PY - C * 0.95, 0, PY + C * 0.95), ta = 0.5 * fade * visAlpha;
        tg.addColorStop(0, 'rgba(255,255,255,0)'); tg.addColorStop(0.35, 'rgba(255,255,255,' + ta + ')');
        tg.addColorStop(0.65, 'rgba(255,255,255,' + ta + ')'); tg.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = tg;
        g.lineWidth = Math.max(1, C * 0.006);
        var dotR = Math.max(1.3, C * 0.009);
        [ups, lows].forEach(function (grp) {
          g.beginPath();
          var open = false, px = 0, py = 0;
          for (var k = 0; k < grp.length; k++) {
            var L = grp[k], idx = Math.round(age / DT_REC);
            if (idx >= L.n) { open = false; continue; }
            var x = L.sx[idx], y = L.sy[idx];
            if (open && Math.abs(y - py) + Math.abs(x - px) > C * 0.45) open = false;
            if (!open) { g.moveTo(x, y); open = true; } else g.lineTo(x, y);
            px = x; py = y;
          }
          g.stroke();
          // the particles released together: small bright beads on the line
          g.fillStyle = tg;
          g.beginPath();
          for (k = 0; k < grp.length; k++) {
            var Lb = grp[k], ib = Math.round(age / DT_REC);
            if (ib >= Lb.n) continue;
            g.moveTo(Lb.sx[ib] + dotR, Lb.sy[ib]); g.arc(Lb.sx[ib], Lb.sy[ib], dotR, 0, 2 * PI);
          }
          g.fill();
        });
      }
      g.restore();
    }

    function drawEddies(dt) {
      var sb = flow ? flow.sb : 0;
      if (!flow || sb < 0.02 || !P.streamlines) return;
      var S = sec, F = flow, g = ctx;
      var want = clamp(Math.round(W / 11), 24, 70);
      while (eddies.length < want) eddies.push({ u: rand(), v: 0.08 + 0.84 * rand(), r: 0.35 + rand(), ph: rand() * 6.28, sp: 0.6 + 0.8 * rand() });
      var x0 = F.xSep, x1 = S.x1 + 1.6, span = x1 - x0;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      var lw = Math.max(1, C * 0.007);
      for (var i = 0; i < want; i++) {
        var e = eddies[i];
        e.u += dt * RATE_80 * Math.max(0.3, P.ias / 80) * 0.32 * e.sp / span * (reduced ? 0.5 : 1);
        if (e.u > 1) { e.u -= 1; e.v = 0.08 + 0.84 * rand(); e.r = 0.35 + rand(); }
        e.ph += dt * (4 + 3 * e.sp) * (reduced ? 0.5 : 1);
        var x = x0 + e.u * span;
        var base = upperRef(F, S, x), B = bubbleAt(F, S, x);
        if (B <= 0.003) continue;
        var y = base + B * e.v + 0.01 * Math.sin(e.ph * 0.6 + i);
        var rad = B * 0.2 * e.r * (0.6 + 0.4 * smooth01(e.u * 3));
        view.toScreen(x, y);
        var cxs = SXo, cys = SYo, rpx = Math.max(2, rad * C);
        var fade = smooth01(e.u / 0.08) * (1 - smooth01((e.u - 0.75) / 0.25)) * smooth01(sb * 1.3);
        var col = e.u < 0.3 ? '255,150,70' : (e.r > 0.9 ? '255,96,64' : '255,120,60');
        g.strokeStyle = 'rgba(' + col + ',' + (0.7 * fade) + ')';
        g.lineWidth = lw;
        g.beginPath();
        // a curl: clockwise on screen (top moves downstream, bottom moves back), spinning
        for (var s = 0; s <= 10; s++) {
          var a = e.ph + s * 0.5, rr = rpx * (0.3 + 0.7 * s / 10);
          var px = cxs + Math.cos(a) * rr, py = cys + Math.sin(a) * rr;
          if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
        g.fillStyle = 'rgba(255,214,170,' + (0.85 * fade) + ')';
        g.fillRect(cxs + Math.cos(e.ph + 5) * rpx - 1, cys + Math.sin(e.ph + 5) * rpx - 1, 2, 2);
      }
      g.restore();
    }

    function arrow(g, x0, y0, x1, y1, col, width, head) {
      var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;
      var ux = dx / len, uy = dy / len, hl = Math.min(head, len * 0.6), hw = hl * 0.55;
      g.save();
      g.shadowColor = col; g.shadowBlur = width * 2.2;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = width; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - ux * hl * 0.8, y1 - uy * hl * 0.8); g.stroke();
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x1 - ux * hl - uy * hw, y1 - uy * hl + ux * hw);
      g.lineTo(x1 - ux * hl + uy * hw, y1 - uy * hl - ux * hw);
      g.closePath(); g.fill();
      g.restore();
    }
    function label(g, text, x, y, opt) {
      opt = opt || {};
      g.save();
      g.font = (opt.weight || 600) + ' ' + Math.round(opt.size) + 'px ' + (opt.font || FONT_D);
      g.textAlign = opt.align || 'left'; g.textBaseline = opt.base || 'middle';
      if (opt.letter) { try { g.letterSpacing = opt.letter; } catch (e) { /* not supported */ } }
      var m = g.measureText(text), tw = m.width;
      if (opt.pill) {
        var padX = opt.size * 0.5, hgt = opt.size * 1.45;
        var bx = opt.align === 'center' ? x - tw / 2 - padX : (opt.align === 'right' ? x - tw - padX : x - padX);
        g.fillStyle = opt.pill;
        roundRect(g, bx, y - hgt / 2, tw + padX * 2, hgt, hgt / 2); g.fill();
      } else if (opt.halo !== false) {
        g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = opt.size * 0.6;
      }
      g.fillStyle = opt.color || COL.ink;
      g.fillText(text, x, y);
      g.restore();
      return tw;
    }
    function roundRect(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
      g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
      g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
      g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
    }

    function drawOverlay() {
      var g = ctx, S = sec, fs = clamp(W / 38, 10.5, 15), small = W < 420;
      var fo = forcesNow(), sb = flow ? flow.sb : 0;
      var aS = (C150.Sim && C150.Sim.stallAoa) ? C150.Sim.stallAoa(P.flaps) : 16 - P.flaps / 40;
      var stalled = sb > 0.55, near = !stalled && sb > 0.12;
      // relative wind arrow into the leading edge + AoA arc
      view.toScreen(0, 0); var lex = SXo, ley = SYo;
      var windCol = P.ias < 1 ? 'rgba(232,244,255,0.35)' : COL.wind;
      var wx0 = Math.max(6, lex - C * 0.95), wx1 = lex - Math.max(8, C * 0.06);
      if (wx1 - wx0 > 20) arrow(g, wx0, ley, wx1, ley, windCol, Math.max(1.6, C * 0.012), Math.max(7, C * 0.055));
      if (P.labels) {
        // below the arrow (above it when the nose points down, so the angle label has room)
        var wy = P.aoa >= 0 ? ley + fs * 1.15 : ley - fs * 2.25;
        label(g, 'VIENTO RELATIVO', wx0, wy, { size: fs * 0.92, color: windCol, letter: '0.06em', weight: 700 });
        label(g, P.ias < 1 ? 'sin viento' : Math.round(P.ias) + ' kt', wx0, wy + fs * 1.1, { size: fs * 0.9, font: FONT_M, weight: 400, color: COL.soft });
      }
      // AoA arc between the wind (horizontal) and the chord (forward extension)
      var ar = C * 0.36, aRad = P.aoa * DEG;
      var arcCol = stalled ? COL.stall : (near ? COL.warn : COL.accent);
      g.save();
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(lex, ley); g.lineTo(lex - Math.cos(aRad) * (ar + 10), ley - Math.sin(aRad) * (ar + 10)); g.stroke();
      g.restore();
      if (Math.abs(P.aoa) > 0.05) {
        g.save();
        g.strokeStyle = arcCol; g.lineWidth = Math.max(1.6, C * 0.012);
        g.shadowColor = arcCol; g.shadowBlur = 6;
        g.beginPath(); g.arc(lex, ley, ar, PI, PI + aRad, aRad < 0); g.stroke();
        g.restore();
      }
      var alx = lex - ar * 0.62, aly = P.aoa >= 0 ? ley - ar * 0.62 * Math.tan(aRad) - fs * 1.0 : ley - ar * 0.62 * Math.tan(aRad) + fs * 1.0;
      label(g, 'α ' + fmt(P.aoa, Math.abs(P.aoa) < 10 ? 1 : 0) + '°', alx, aly,
        { size: fs * 1.3, color: arcCol, weight: 700, align: 'center' });
      if (P.labels && !small) {
        label(g, 'ángulo de ataque', alx, aly + (P.aoa >= 0 ? -fs * 1.1 : fs * 1.1),
          { size: fs * 0.78, color: COL.soft, font: FONT_B, weight: 400, align: 'center' });
      }

      // forces from the center of pressure (quarter chord, a little aft with flaps / stall)
      if (P.forces) {
        var cpx = 0.27 + 0.08 * (S ? S.fr : 0) + 0.12 * sb;
        var ycp = interpTable(sec.camber, 0, sec.x1, NXT, cpx);
        view.toScreen(cpx, ycp + 0.04); var fx = SXo, fy = SYo;
        var Lref = Math.min(H * 0.30, C * 0.62);          // lift = weight → this length
        var maxUp = fy - fs * 1.4;
        var Llen = fo.L / fo.W * Lref, capped = false;
        if (Llen > maxUp) { Llen = maxUp; capped = true; }
        if (Llen < -(H - fy - fs)) Llen = -(H - fy - fs);
        var lcol = stalled ? '#9ad7b2' : COL.lift;
        // weight reference tick on the lift line
        g.save();
        g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(fx - C * 0.07, fy - Lref); g.lineTo(fx + C * 0.07, fy - Lref); g.stroke();
        g.restore();
        if (P.labels && !small) label(g, '= peso del avión', fx + C * 0.08, fy - Lref, { size: fs * 0.8, color: COL.soft, font: FONT_B, weight: 400 });
        if (Math.abs(Llen) > 2) arrow(g, fx, fy, fx, fy - Llen, lcol, Math.max(2.2, C * 0.02), Math.max(9, C * 0.07));
        var Dlen = fo.D / fo.W * Lref * 4;
        Dlen = Math.min(Dlen, W - fx - fs * 2);
        if (Dlen > 2) arrow(g, fx, fy, fx + Dlen, fy, COL.drag, Math.max(1.8, C * 0.015), Math.max(8, C * 0.06));
        if (P.labels) {
          // lift label to the LEFT of the arrow tip (the right side is the low-pressure region)
          var tipY = fy - Llen;
          var lt = 'SUSTENTACIÓN', lv = Math.round(fo.L / 9.80665) + ' kg' + (capped ? ' ↑' : '');
          var lly = Llen >= 0 ? Math.max(tipY + fs * 0.5, fs * 2.2) : tipY - fs * 1.6;
          // near the top-left title, the label goes to the right of the arrow instead
          var rightSide = lly < fs * 4.2;
          var llx = rightSide ? fx + fs * 0.9 : fx - fs * 0.7, lal = rightSide ? 'left' : 'right';
          label(g, lt, llx, lly, { size: fs * 0.95, color: lcol, letter: '0.05em', weight: 700, align: lal });
          label(g, lv, llx, lly + fs * 1.1, { size: fs * 0.95, color: COL.ink, font: FONT_M, weight: 400, align: lal });
          // drag label past the trailing edge, at the arrow's height
          view.toScreen(S.tex, S.tey);
          var dlx = Math.max(fx + Math.max(Dlen, 0), SXo) + fs * 0.8, dly = Math.min(fy, SYo) - fs * 0.6;
          if (dlx + fs * 6 > W) dlx = W - fs * 6.2;
          label(g, 'RESISTENCIA', dlx, dly, { size: fs * 0.85, color: COL.drag, letter: '0.05em', weight: 700 });
          label(g, Math.round(fo.D / 9.80665) + ' kg' + (small ? '' : ' (×4)'), dlx, dly + fs * 1.05, { size: fs * 0.85, color: COL.ink, font: FONT_M, weight: 400 });
        }
      }
      // region labels
      if (P.labels && P.pressure && flow && !small) {
        // with negative lift (nose well down) the high pressure is on top
        var inv = fo.cl < -0.02;
        view.toScreen(0.62, inv ? -0.2 : 0.2);
        label(g, 'BAJA PRESIÓN', SXo, SYo, { size: fs * 0.9, color: '#9cc3ff', align: 'center', letter: '0.08em' });
        view.toScreen(0.42, inv ? 0.24 : -0.24);
        label(g, 'ALTA PRESIÓN', SXo, SYo, { size: fs * 0.9, color: '#ff9b90', align: 'center', letter: '0.08em' });
      }
      if (P.labels && S && S.flaps > 0.5) {
        view.toScreen(S.tex, S.tey);
        label(g, 'FLAP ' + Math.round(S.flaps) + '°', SXo + fs * 0.4, SYo + fs * 1.2, { size: fs * 0.9, color: COL.accent, weight: 700, letter: '0.05em' });
      }
      // title & readouts (HUD chrome)
      var pad = Math.max(8, fs * 0.8);
      g.save();
      g.fillStyle = COL.accent; g.fillRect(pad, pad + 1, 3, fs * (small ? 1.2 : 2.3));
      g.restore();
      label(g, 'PERFIL DEL ALA', pad + 8, pad + fs * 0.62, { size: fs * 1.15, weight: 700, letter: '0.08em' });
      if (!small) label(g, 'NACA 2412 · corte del ala', pad + 8, pad + fs * 1.8, { size: fs * 0.82, color: COL.soft, font: FONT_M, weight: 400 });
      var ro = [['CL', fmt(fo.cl, 2)], ['CD', fmt(fo.cd, 3)], ['L/D', fo.D > 1 ? fmt(fo.L / fo.D, 1) : '—']];
      if (small) ro = ro.slice(0, 1);
      var rx = W - pad;
      for (var i = ro.length - 1; i >= 0; i--) {
        var tw = label(g, ro[i][1], rx, pad + fs * 0.62, { size: fs * 0.95, font: FONT_M, weight: 700, align: 'right' });
        var tw2 = label(g, ro[i][0], rx - tw - fs * 0.35, pad + fs * 0.62, { size: fs * 0.85, color: COL.soft, align: 'right', letter: '0.06em' });
        rx -= tw + tw2 + fs * 1.3;
      }
      // stall state badge
      if (stalled || near) {
        var txt = stalled ? 'PÉRDIDA · EL AIRE SE DESPEGA' : 'CERCA DE LA PÉRDIDA';
        if (small && stalled) txt = 'PÉRDIDA';
        label(g, txt, W - pad - fs * 0.5, pad + fs * (small ? 2.2 : 2.5), { size: fs * 0.95, weight: 700, letter: '0.06em', align: 'right',
          color: stalled ? '#fff' : '#1a1205', pill: stalled ? 'rgba(220,50,40,0.92)' : 'rgba(255,176,32,0.92)' });
        if (!small && P.labels) label(g, 'ángulo crítico ≈ ' + fmt(aS, 0) + '°', W - pad, pad + fs * 4.0, { size: fs * 0.8, color: COL.soft, align: 'right', font: FONT_B, weight: 400 });
      }
      // legend: speed colour bar
      if (P.streamlines && !small) {
        var lw = Math.min(150, W * 0.2), lh = 5, lx0 = pad, ly0 = H - pad - fs * 0.9;
        var grd = g.createLinearGradient(lx0, 0, lx0 + lw, 0);
        [0.32, 0.6, 0.85, 1.0, 1.25, 1.5, 1.9].forEach(function (s, k, arr) { grd.addColorStop(k / (arr.length - 1), rgba(speedRGB(s), 1)); });
        g.fillStyle = grd; roundRect(g, lx0, ly0, lw, lh, 2.5); g.fill();
        label(g, 'VELOCIDAD DEL AIRE', lx0, ly0 - fs * 1.75, { size: fs * 0.8, color: COL.soft, letter: '0.06em' });
        label(g, 'lento', lx0, ly0 - fs * 0.7, { size: fs * 0.78, color: COL.soft, font: FONT_B, weight: 400 });
        label(g, 'rápido', lx0 + lw, ly0 - fs * 0.7, { size: fs * 0.78, color: COL.soft, font: FONT_B, weight: 400, align: 'right' });
      }
      if (P.pressure && !small) {
        var px2 = W - pad, py2 = H - pad - fs * 0.6;
        var t1 = label(g, 'alta presión', px2, py2, { size: fs * 0.8, color: COL.soft, font: FONT_B, weight: 400, align: 'right' });
        g.fillStyle = rgba(COL.press, 0.9); g.beginPath(); g.arc(px2 - t1 - fs * 0.55, py2, fs * 0.33, 0, 2 * PI); g.fill();
        var px3 = px2 - t1 - fs * 1.4;
        var t2 = label(g, 'baja presión', px3, py2, { size: fs * 0.8, color: COL.soft, font: FONT_B, weight: 400, align: 'right' });
        g.fillStyle = rgba(COL.suction, 0.95); g.beginPath(); g.arc(px3 - t2 - fs * 0.55, py2, fs * 0.33, 0, 2 * PI); g.fill();
      }
      // one-line explanation of what the student is seeing (wide canvases)
      var capY = H - pad - fs * 0.6;
      if (P.caption && W >= 560) {
        var cap = captionText(fo, sb, stalled, near);
        var maxW = W - 2 * (pad + (P.pressure ? fs * 15 : Math.min(150, W * 0.2) + fs));
        var lines = wrapText(g, cap, Math.max(240, maxW), fs * 0.88, 3);
        g.save();
        g.font = '400 ' + Math.round(fs * 0.88) + 'px ' + FONT_B;
        var bw = 0;
        for (var lj = 0; lj < lines.length; lj++) bw = Math.max(bw, g.measureText(lines[lj]).width);
        var bh = lines.length * fs * 1.2 + fs * 0.5;
        g.fillStyle = 'rgba(6,12,22,0.62)';
        roundRect(g, W * 0.5 - bw / 2 - fs * 0.7, capY - bh + fs * 0.85, bw + fs * 1.4, bh, fs * 0.5); g.fill();
        g.restore();
        for (var li = 0; li < lines.length; li++) {
          label(g, lines[li], W * 0.5, capY - (lines.length - 1 - li) * fs * 1.2,
            { size: fs * 0.88, color: 'rgba(232,244,255,0.92)', align: 'center', font: FONT_B, weight: 400 });
        }
        capY -= lines.length * fs * 1.2 + fs * 0.3;
      }
      if (hintAlpha > 0.01) {
        label(g, '↕ arrastrá para cambiar el ángulo', W * 0.5, small ? H - pad - fs * 0.5 : capY - fs * 0.2,
          { size: fs * 0.85, color: 'rgba(255,190,140,' + (0.9 * hintAlpha) + ')', align: 'center', font: FONT_B, weight: 700 });
      }
    }

    function captionText(fo, sb, stalled, near) {
      if (P.ias < 1) return 'Sin viento no hay sustentación: el ala necesita aire que pase por arriba y por abajo.';
      if (stalled) return 'Pérdida: el ángulo es demasiado grande y el aire se despega del ala. Cae la sustentación y sube la resistencia.';
      if (near) return 'Cerca del ángulo crítico: el aire empieza a despegarse por la parte de atrás del ala.';
      if (fo.cl < -0.02) return 'Con la nariz abajo el ala empuja el aire hacia arriba: la fuerza va hacia abajo.';
      if (P.flaps > 4) return 'Los flaps curvan el ala y desvían más aire hacia abajo: más sustentación y más resistencia.';
      return 'Arriba el aire va más rápido (baja presión) y abajo más lento (alta presión): esa diferencia sostiene el avión.';
    }
    function wrapText(g, text, maxW, size, maxLines) {
      g.save();
      g.font = '400 ' + Math.round(size) + 'px ' + FONT_B;
      var words = text.split(' '), lines = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var t = cur ? cur + ' ' + words[i] : words[i];
        if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
      }
      if (cur) lines.push(cur);
      g.restore();
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '…'; }
      return lines;
    }

    /* ---------- public API ---------- */
    function resize() {
      if (destroyed) return;
      var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
      var w = Math.round(r.width || canvas.clientWidth || 0), h = Math.round(r.height || canvas.clientHeight || 0);
      dpr = Math.min(3, root.devicePixelRatio || 1);
      if (w < 2 || h < 2) { W = 0; H = 0; return; }
      W = w; H = h;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      if (!layer) { layer = makeCanvas(1, 1); flowL = makeCanvas(1, 1); foil = makeCanvas(1, 1); }
      layer.width = canvas.width; layer.height = canvas.height;
      flowL.width = canvas.width; flowL.height = canvas.height;
      flctx = flowL.getContext('2d');
      foil.width = canvas.width; foil.height = canvas.height;
      lctx = layer.getContext('2d'); fctx = foil.getContext('2d');
      layout();
      dirty = true;
    }

    var af = {
      set: function (o) {
        if (!o) return af;
        var geo = false;
        if (o.aoa !== undefined) {
          // re-solve only for changes ≥ 0.2° (the arrows/labels use the exact value): keeps the cost low in flight
          var a = clamp(num(o.aoa, P.aoa), -20, 30);
          P.aoa = a;
          if (!flow || Math.abs(a - flow.aoa) >= 0.2 || (Math.abs(a - flow.aoa) > 0.01 && dragState)) geo = true;
        }
        if (o.flaps !== undefined) { var f = clamp(num(o.flaps, P.flaps), 0, FLAP_MAX); if (Math.abs(f - P.flaps) > 0.1) { P.flaps = f; geo = true; } }
        if (o.ias !== undefined) {
          var oldAuto = (P.stallBlend === null) ? effStall() : null;
          P.ias = clamp(num(o.ias, P.ias), 0, 250);
          if (oldAuto !== null && Math.abs(effStall() - oldAuto) > 0.02) geo = true;
        }
        if (o.stallBlend !== undefined) {
          var sbNew = (o.stallBlend === null) ? null : clamp(num(o.stallBlend, 0), 0, 1);
          var prev = flow ? flow.sb : -1;
          P.stallBlend = sbNew;
          if (Math.abs(Math.round(effStall() * 50) / 50 - prev) > 0.001) geo = true;
        }
        ['liftN', 'dragN', 'cl', 'cd'].forEach(function (k) { if (o[k] !== undefined) P[k] = (o[k] === null) ? null : num(o[k], null); });
        ['pressure', 'streamlines', 'labels', 'forces', 'timelines', 'caption'].forEach(function (k) {
          if (o[k] !== undefined && !!o[k] !== P[k]) { P[k] = !!o[k]; layersDirty = true; }
        });
        if (geo) dirty = true;
        return af;
      },
      get: function () {
        return { aoa: P.aoa, flaps: P.flaps, ias: P.ias, stallBlend: flow ? flow.sb : effStall(), pressure: P.pressure,
          streamlines: P.streamlines, labels: P.labels, forces: P.forces, timelines: P.timelines };
      },
      frame: function (dt) {
        if (destroyed) return;
        dt = clamp(num(dt, 0), 0, 0.1);
        var cw = canvas.clientWidth, ch = canvas.clientHeight;
        if (!W || (cw && ch && (Math.abs(cw - W) > 1 || Math.abs(ch - H) > 1))) { resize(); if (!W) return; }
        var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (dirty && (now - lastSolve > Math.max(40, 3 * solveMs) || !flow)) solve();
        else if (layersDirty) renderLayers();
        var target = clamp(P.ias / 12, 0, 1);
        visAlpha += (target - visAlpha) * Math.min(1, dt / 0.35 + (flow && clock === 0 ? 1 : 0));
        clock += dt * RATE_80 * (P.ias / 80) * (reduced ? 0.5 : 1);
        if (clock > 1e6) clock = 0;
        if (usedDrag && hintAlpha > 0) hintAlpha = Math.max(0, hintAlpha - dt * 1.5);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (layer) ctx.drawImage(layer, 0, 0);
        if (flowL && visAlpha > 0.01) { ctx.globalAlpha = Math.min(1, visAlpha); ctx.drawImage(flowL, 0, 0); ctx.globalAlpha = 1; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawParticles();
        drawTimelines();
        drawEddies(dt);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (foil) ctx.drawImage(foil, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawOverlay();
        updateAria();
      },
      resize: function () { resize(); return af; },
      destroy: function () {
        destroyed = true;
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('keydown', onKey);
        layer = flowL = foil = field = null; flow = null; sec = null;
      },
      stats: {}
    };
    Object.defineProperty(af.stats, 'solveMs', { get: function () { return solveMs; } });
    Object.defineProperty(af.stats, 'lines', { get: function () { return flow && flow.lines ? flow.lines.length : 0; } });

    var ariaLast = '';
    function updateAria() {
      var fo = forcesNow(), sb = flow ? flow.sb : 0;
      var t = 'Perfil del ala: ángulo de ataque ' + fmt(P.aoa, 0) + ' grados, viento ' + Math.round(P.ias) + ' nudos' +
        (P.flaps > 0.5 ? ', flaps ' + Math.round(P.flaps) + ' grados' : '') +
        ', sustentación ' + Math.round(fo.L / 9.80665) + ' kilos' + (sb > 0.55 ? ', ala en pérdida' : '');
      if (t !== ariaLast) { ariaLast = t; try { canvas.setAttribute('aria-label', t); } catch (e) { /* ignore */ } }
    }

    /* ---------- dragging (optional) ---------- */
    function onDown(e) {
      if (!opts.onDrag) return;
      dragState = { y: e.clientY, aoa: P.aoa, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragState || e.pointerId !== dragState.id) return;
      var dy = dragState.y - e.clientY;
      var a = clamp(dragState.aoa + dy * 28 / Math.max(120, H), -6, 22);
      a = Math.round(a * 2) / 2;
      if (a !== P.aoa) { af.set({ aoa: a }); usedDrag = true; try { opts.onDrag(a); } catch (err) { /* host error */ } }
    }
    function onUp(e) {
      if (dragState && e.pointerId === dragState.id) { dragState = null; try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    }
    function onKey(e) {
      if (!opts.onDrag) return;
      var d = (e.key === 'ArrowUp' || e.key === 'ArrowRight') ? 1 : (e.key === 'ArrowDown' || e.key === 'ArrowLeft') ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var a = clamp(Math.round(P.aoa) + d, -6, 22);
      af.set({ aoa: a }); usedDrag = true;
      try { opts.onDrag(a); } catch (err) { /* host error */ }
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('keydown', onKey);
    if (opts.onDrag) {
      canvas.style.touchAction = 'none';
      canvas.style.cursor = 'ns-resize';
      if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
    }
    if (!canvas.hasAttribute('role')) canvas.setAttribute('role', 'img');
    try {
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { layersDirty = true; });
      }
    } catch (e) { /* ignore */ }

    af.set(opts);
    resize();
    return af;
  };

  // shared transform registers (written by view.toScreen / toBody)
  var SXo = 0, SYo = 0, BXo = 0, BYo = 0;

  /* ------------------------------------------------- pure model (tests) */
  Airfoil.model = {
    buildSection: buildSection,
    solveFlow: solveFlow,
    /** 2D section lift coefficient of the flow solution (Kutta–Joukowski, per body chord). */
    sectionCl: function (F) { return 2 * F.G * F.S.Kabs; },
    /** Solve with the renderer's default 750×422 framing (tests): lines carry body coords bx/by. */
    solveFlowBody: function (S, aoa, sb, seeds) {
      var W = 750, H = 422, Cc = Math.min(W * 0.44, H * 1.05), PX = W * 0.4, PY = H * 0.56;
      var ca = Math.cos(aoa * DEG), sa = Math.sin(aoa * DEG);
      return solveFlow(S, aoa, sb || 0, { w: W, h: H, seeds: seeds || 30,
        toScreen: function (bx, by) { var x = bx - 0.25; SXo = PX + (x * ca + by * sa) * Cc; SYo = PY - (-x * sa + by * ca) * Cc; },
        toBody: function (sx, sy) { var rx = (sx - PX) / Cc, ry = (PY - sy) / Cc; BXo = rx * ca - ry * sa + 0.25; BYo = rx * sa + ry * ca; }
      });
    },
    speedAt: function (F, x, y) { return speedAt(F, x, y); },
    params: { KT_N: KT_N, KT_EPS: KT_EPS, KT_MU: KT_MU, X_HINGE: X_HINGE, FLAP_MAX: FLAP_MAX }
  };

  C150.Airfoil = Airfoil;
  if (typeof module !== 'undefined' && module.exports) module.exports = Airfoil;
})(root.C150);
