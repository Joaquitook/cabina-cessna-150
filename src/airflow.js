var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * airflow.js: C150.Airflow, the air around the exterior airplane (contract v2 §3). Glowing streak trails coloured by
 * the local speed, the propeller slipstream spiral, wingtip vortices, pressure tint on the wing, live force arrows in
 * kgf, moment-tendency arcs, flight trails and focus regions with camera views.
 *
 *   var flow = C150.Airflow.create(THREE, ext, opts);   // ext = C150.Exterior.create(THREE) (needs ext.body / ext.geom)
 *   flow.update(state, dt, ctx?)                          // every frame while the exterior is visible
 *   flow.set({ enabled, streamlines, propwash, vortices, pressure, forces, moments, trails,
 *              density: 'alta'|'media'|'baja', slowmo: 0.2..1 })  → flow.get()
 *   flow.focus('flaps'|'ailerons'|'elevator'|'rudder'|'prop'|'wingtips'|'stall'|'tail'|'wing'|null)
 *   flow.views[region] = { pos:[x,y,z], target:[x,y,z] }  (ext scene coordinates; ext.setView(flow.views.flaps))
 *   flow.snapshot          the aero snapshot used on the last update (state.aero, or derived from the state)
 *   flow.dispose()
 *   Pure helpers (no THREE, Node tests): C150.Airflow.aeroFromState(state), C150.Airflow.Field (flow model),
 *   C150.Airflow.REGIONS, C150.Airflow.FOCUS.
 *
 * Interpretation notes:
 *  - ctx (optional, core.js): { inset: true } = the exterior is drawn in the small inset → density 'baja' and no
 *    labels; { quality: 'alta'|'media'|'baja' } caps the density. prefers-reduced-motion: one density step lower and
 *    the flow runs at half speed.
 *  - Air model (body frame of ext.body: CG at the origin, x right, y up, z aft, nose toward -Z; velocities normalised by
 *    the reference speed): free stream at the BODY angle of attack (displayed pitch - flight-path angle: in the tunnel
 *    the airplane is shown pitched by the AoA in a horizontal wind) and sideslip; lifting-line horseshoe vortices
 *    (Biot-Savart with a smoothed core): two spanwise panels per wing half whose strengths come from liftLN / liftRN
 *    (so the ailerons change the outer panel and the tip vortex of each side), an extra inboard horseshoe for the
 *    flaps (flapLiftN) and one for the horizontal tail (tailN); a Rankine source/sink pair for the fuselage; the
 *    propeller slipstream (axial propWashMs growing behind the disc, contraction, clockwise swirl seen from behind
 *    that hits the LEFT side of the fin); local turning of the flow behind deflected surfaces (flaps, ailerons,
 *    elevator, rudder: TE down → air down, rudder TE right → air right); stall: over the upper wing behind ≈ 30 %
 *    chord the flow slows, reverses near the skin and tumbles (curl-noise eddies, red), root first (washout).
 *    Particles cannot cross the wing, the tail surfaces, the fin or the fuselage (pushed back to the skin).
 *    The wingtip vortex swirl is drawn ×1.6 and the slipstream swirl is exaggerated so both are easy to see.
 *  - Visual time: air at V knots moves at ext.visWindSpeed(V) m/s in the scene (≈ 4.2 m/s at 80 kt) × slowmo, so the
 *    eye can follow it; the colours use the TRUE speed ratio |v|/V∞ (blue slow, cyan-white free stream, amber fast).
 *  - Look (contract v3 polish): the STRUCTURE is drawn by continuous streamlines (CPU-traced through the field, re-traced
 *    a few per frame when the flow changes) with bright comet pulses travelling at the LOCAL speed — chord-wise smoke
 *    rakes at a flap station and an aileron station of each wing (upwash ahead, fast amber air over the top, slow blue
 *    air under it, the downwash behind bending much more with flaps), lines through the wingtips, the tail and the fin,
 *    propeller slipstream spirals (orange, faster with throttle) and two analytic strands per tip vortex (violet
 *    helices). Free particles are only a quiet dust next to them, plus the slipstream sparks, the helix sparks and the
 *    red separation eddies over the stalled wing. Colour = true speed ratio |v|/V∞: deep blue < 0.92 < pale cyan (free
 *    stream) < amber from ≈ 1.1 < orange beyond 1.25. Far-side wing lines are dimmed. Every line and streak has a dark
 *    halo pass under it (same geometry, wider, normal blending) so it stays readable over the white airplane, the
 *    blue sky and the fields: on the dark tunnel the core glows additively; on light backdrops ('cielo', 'estudio') the
 *    same bright colours are drawn with normal blending over a lighter outline.
 *  - Streaks: one instanced quad per trail segment, screen-space width. Trail samples are taken at a fixed
 *    visual interval (all particles on the same tick, slot-major ring buffer → one contiguous upload per tick).
 *  - Force arrows: length ∝ √kgf (so drag and thrust stay visible next to lift and weight; the labels give the true
 *    numbers). With aileron the two half-wing lift arrows appear and their difference is drawn ×2.5.
 *  - Moment arcs (orange, animated chevrons) from rollMoment / pitchMoment / yawMoment; while they are on, the
 *    exterior's own yoke/pedal input arcs are hidden (ext.showInputArrows = false).
 *  - Flight trails ('trails', not in the tunnel): smoke from both wingtips in the scene frame, drifting back at the
 *    visual speed and curving with the turn rate / climb, so the flight path shows behind the airplane.
 */
(function (C150) {
  'use strict';

  var DEG = Math.PI / 180, KT = 0.514444, G = 9.80665, RHO0 = 1.225;
  var MASS = 725.7, WEIGHT = MASS * G, S_WING = 14.86;
  var CLA = 0.085, FLAP_DCL = 0.45, FLAP_DCD = 0.055, CD0 = 0.027, K_IND = 0.06;
  var T0 = 1980, C_J = 0.00625, PROP_R = 0.876, PROP_AREA = Math.PI * PROP_R * PROP_R;
  var K_AIL = 0.009;   // half-wing ΔCL per degree of aileron (fallback snapshot only)

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function sigmaAt(altFt) { var f = 1 + 0.02 * Math.max(0, altFt) / 1000; return 1 / (f * f); }
  function stallAoa(flaps) { return 16 - flaps / 40; }
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  /* ================================================================ aero snapshot */
  var AERO_KEYS = ['ias', 'tas', 'aoa', 'beta', 'q', 'cl', 'cd', 'lOverD', 'liftN', 'dragN', 'thrustN', 'weightN',
    'liftLN', 'liftRN', 'flapLiftN', 'tailN', 'rollMoment', 'pitchMoment', 'yawMoment', 'downwashDeg', 'propWashMs',
    'propSwirl', 'stallBlend', 'groundEffect'];
  function surfacesOf(state) {
    var sf = state.surfaces;
    if (sf && isFinite(sf.aileronL)) return sf;
    var yr = num(state.yokeRoll, 0), yp = num(state.yokePitch, 0);
    if (state.controlLock) { yr = 0; yp = 0; }
    return { aileronL: yr < 0 ? 20 * yr : 14 * yr, aileronR: yr < 0 ? -14 * yr : -20 * yr,
      elevator: yp > 0 ? -25 * yp : -15 * yp, rudder: 23 * num(state.rudder, 0), trimTab: 0, flaps: num(state.flaps, 0) };
  }
  /**
   * The contract v2 §1 snapshot computed from the older state fields (air, flaps, surfaces, propRpm, tunnel) with the
   * same simple formulas as sim.js. Used when sim.js does not provide state.aero.
   */
  function aeroFromState(state, out) {
    out = out || {};
    state = state || {};
    var air = state.air || {}, tun = state.tunnel && state.tunnel.on ? state.tunnel : null;
    var sig = sigmaAt(num(air.altitude, 100));
    var ias = Math.max(0, tun ? num(tun.ias, 0) : num(air.ias, 0));
    var tas = ias / Math.sqrt(sig);
    var aoa = tun ? num(tun.aoa, 0) : num(air.aoa, 3);
    var beta = tun ? num(tun.beta, 0) : 0;
    var V = tas * KT, q = 0.5 * RHO0 * sig * V * V;
    var sf = surfacesOf(state);
    var flaps = num(state.flaps, num(sf.flaps, 0)), fr = clamp(flaps / 40, 0, 1);
    var aS = stallAoa(flaps);
    var clMax = CLA * aS + FLAP_DCL * fr;
    var sb = smooth(aS - 3, aS + 1, aoa);
    var cl = aoa <= aS ? CLA * aoa + FLAP_DCL * fr : clMax * (1 - 0.28 * smooth(aS, aS + 2.5, aoa));
    var post = smooth(aS, aS + 2, aoa);
    var cd = CD0 + FLAP_DCD * fr + K_IND * cl * cl + 0.08 * post;
    var liftN = q * S_WING * cl, dragN = q * S_WING * cd;
    var halfQ = q * S_WING / 2;
    var liftLN = halfQ * (cl + K_AIL * num(sf.aileronL, 0) * (1 - 0.5 * post));
    var liftRN = halfQ * (cl + K_AIL * num(sf.aileronR, 0) * (1 - 0.5 * post));
    var rpm = Math.max(0, num(state.propRpm, 0)), r = rpm / 2550;
    var thrustN = T0 * Math.sqrt(sig) * r * (r - C_J * tas);
    if (thrustN < -600) thrustN = -600;
    var Tp = Math.max(0, thrustN);
    var w = Tp > 0 ? Math.sqrt(V * V + 2 * Tp / (RHO0 * sig * PROP_AREA)) - V : 0;
    var downwash = cl * 5.2;
    var elev = num(sf.elevator, 0), rud = num(sf.rudder, 0);
    var tailN = q * 2.0 * (0.06 * (aoa - 3 - downwash - 1.0) + 0.025 * elev);
    var spd = clamp(ias / 60, 0, 1);
    var thr = clamp(num(state.throttle, 0), 0, 1);
    var running = !state.engine || state.engine.running !== false;
    var pF = running ? 0.35 * clamp((thr - 0.5) / 0.5, 0, 1) * clamp((90 - ias) / 40, 0, 1) : 0;
    out.ias = ias; out.tas = tas; out.aoa = aoa; out.beta = beta; out.q = q;
    out.cl = cl; out.cd = cd; out.lOverD = dragN > 1 ? liftN / dragN : 0;
    out.liftN = liftN; out.dragN = dragN; out.thrustN = thrustN; out.weightN = WEIGHT;
    out.liftLN = liftLN; out.liftRN = liftRN;
    out.flapLiftN = q * S_WING * FLAP_DCL * fr * (1 - 0.3 * post);
    out.tailN = tailN;
    out.rollMoment = clamp((liftLN - liftRN) / (0.25 * Math.max(liftN, 2000)), -1, 1);
    out.pitchMoment = clamp(spd * (-elev / 22 + 0.3 * fr) + (q > 50 ? -0.4 * post : 0), -1, 1);
    out.yawMoment = clamp(spd * (rud / 23 * 0.9 - 0.2 * (num(sf.aileronL, 0) - num(sf.aileronR, 0)) / 34) - pF, -1, 1);
    out.downwashDeg = downwash;
    out.propWashMs = w;
    out.propSwirl = clamp(rpm / 2600, 0, 1) * (0.35 + 0.65 * clamp(1 - tas / 130, 0, 1));
    out.stallBlend = sb;
    out.groundEffect = 0;
    return out;
  }
  /** state.aero when sim.js provides it (every field checked), otherwise aeroFromState(). */
  function snapshot(state, out) {
    var a = state && state.aero;
    if (a && isFinite(a.liftN) && isFinite(a.liftLN)) {
      for (var i = 0; i < AERO_KEYS.length; i++) out[AERO_KEYS[i]] = num(a[AERO_KEYS[i]], 0);
      out.weightN = num(a.weightN, WEIGHT);
      out.fromSim = true;
      return out;
    }
    aeroFromState(state, out);
    out.fromSim = false;
    return out;
  }

  /* ================================================================ geometry (body frame) */
  // Same numbers as exterior.js (model frame minus the CG (0, 0.55, 1.0)); ext.geom overrides them when present.
  var CGY = 0.55, CGZ = 1.0;
  var WB = 5.08, FLAP_IN = 0.60, BREAK = 2.38, AIL_OUT = 4.75, FLAP_F = 0.76, AIL_F = 0.77;
  var HT_Y = 0.655 - CGY, HT_B = 1.525, ELEV_HINGE = 4.95 - CGZ;
  var FIN_Y0 = 0.80 - CGY, FIN_Y1 = 1.98 - CGY;
  var HUB = [0, 0.49 - CGY, -0.905 - CGZ];
  function wingLE(s) { return (s <= BREAK ? 0.52 : 0.52 + 0.15 * (s - BREAK) / (WB - BREAK)) - CGZ; }
  function wingC(s) { return s <= BREAK ? 1.61 : 1.61 - 0.48 * (s - BREAK) / (WB - BREAK); }
  function wingY(s) { return 1.105 + s * 0.017455 - CGY; }
  function wingInc(s) { return (1 - s / WB) * DEG; }
  function naca(m, p, t, x) {
    x = clamp(x, 0, 1);
    var yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
    var yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * x - x * x);
    return { c: yc, t: yt };
  }
  function htLE(s) { return lerp(4.39, 4.59, s / HT_B) - CGZ; }
  function htTE(s) { return lerp(5.41, 5.23, s / HT_B) - CGZ; }
  function finLE(yb) { return 4.55 + (yb + CGY - 0.82) * 0.733 - CGZ; }
  function rudHinge(yb) { return 5.50 + (yb + CGY - 0.62) * 0.293 - CGZ; }
  function rudTE(yb) { return 6.00 + (yb + CGY - 0.58) * 0.17 - CGZ; }
  // fuselage cross-sections (model z, half width, top y, bottom y) incl. the spinner; body = model - CG
  var FUS = [[-1.10, 0.02, 0.50, 0.48], [-1.00, 0.12, 0.58, 0.40], [-0.90, 0.20, 0.66, 0.32], [-0.80, 0.40, 0.70, 0.05],
    [-0.30, 0.46, 0.73, -0.07], [0.10, 0.50, 0.78, -0.08], [0.34, 0.535, 0.955, -0.08], [0.62, 0.555, 1.06, -0.07],
    [1.42, 0.55, 1.06, -0.04], [2.10, 0.47, 1.00, 0.07], [2.90, 0.32, 0.868, 0.22], [3.50, 0.245, 0.848, 0.32],
    [4.20, 0.175, 0.838, 0.43], [4.90, 0.12, 0.832, 0.52], [5.62, 0.045, 0.81, 0.615]];
  var FUS_Z0 = FUS[0][0] - CGZ, FUS_Z1 = FUS[FUS.length - 1][0] - CGZ;
  /** Fuselage section at body z → [half width, centre y, half height] (or null outside). */
  function fusAt(zb, out) {
    var zm = zb + CGZ;
    if (zm < FUS[0][0] || zm > FUS[FUS.length - 1][0]) return null;
    for (var i = 1; i < FUS.length; i++) {
      if (zm <= FUS[i][0]) {
        var a = FUS[i - 1], b = FUS[i], t = (zm - a[0]) / (b[0] - a[0]);
        var hw = lerp(a[1], b[1], t), top = lerp(a[2], b[2], t), bot = lerp(a[3], b[3], t);
        out[0] = hw; out[1] = (top + bot) / 2 - CGY; out[2] = (top - bot) / 2;
        return out;
      }
    }
    return null;
  }

  /* ================================================================ the flow model */
  var MAXSEG = 32;
  var SWIRL_GAIN = 1.1, TIP_GAIN = 1.6;
  /**
   * Field: velocity of the air around the airplane in the body frame, normalised by the reference speed Vref
   * (Vref = V∞, or 0.75 × the slipstream speed when there is no wind: a ground run-up).
   */
  function Field() {
    this.seg = new Float64Array(MAXSEG * 9);
    this.nSeg = 0;
    this.U = [0, 0, 1];          // free stream (normalised)
    this.U0 = 1;                 // |free stream| (1 in flight; < 1 or 0 when only the slipstream blows)
    this.Vref = 1;               // m/s
    this.active = false;
    this.alpha = 0; this.beta = 0;   // body-frame angles (rad)
    this.dW = [0, 0, 1];         // wake direction
    this.src = 0;                // fuselage source strength
    this.w = 0; this.swirl = 0; this.Rf = 0.8;   // slipstream (normalised)
    this.s1 = 0; this.s2 = 0;    // slipstream axis slopes before / after the wing
    this.df = 0; this.daL = 0; this.daR = 0; this.de = 0; this.dr = 0;   // surface deflections (rad, TE down / right +)
    this.stall = 0; this.time = 0;
    this.gIn = 0; this.gOutL = 0; this.gOutR = 0; this.gFlap = 0; this.gTail = 0;   // circulations (for visuals)
    this.downwash = 0;
  }
  Field.prototype.addSeg = function (ax, ay, az, bx, by, bz, g, rc) {
    if (this.nSeg >= MAXSEG || !g) return;
    var o = this.nSeg++ * 9, s = this.seg;
    s[o] = ax; s[o + 1] = ay; s[o + 2] = az; s[o + 3] = bx; s[o + 4] = by; s[o + 5] = bz;
    s[o + 6] = g / (4 * Math.PI); s[o + 7] = rc * rc;
    s[o + 8] = 0;
  };
  /** Horseshoe: trailing leg from far downstream to A, bound A → B, trailing leg B → far (+Γ = lift, +x bound). */
  Field.prototype.horseshoe = function (ax, ay, az, bx, by, bz, g, rc, gainA, gainB) {
    var d = this.dW, L = 40;
    this.addSeg(ax + d[0] * L, ay + d[1] * L, az + d[2] * L, ax, ay, az, g * (gainA || 1), rc);
    this.addSeg(ax, ay, az, bx, by, bz, g, rc);
    this.addSeg(bx, by, bz, bx + d[0] * L, by + d[1] * L, bz + d[2] * L, g * (gainB || 1), rc);
  };
  /**
   * ae: aero snapshot; sf: surfaces in degrees ({aileronL, aileronR, elevator, rudder, flaps}); o: { alphaDeg, betaDeg }
   * (body-frame angles of the free stream; default ae.aoa / ae.beta), time (s, for the stall turbulence).
   */
  Field.prototype.configure = function (ae, sf, o) {
    o = o || {};
    var V = Math.max(0, num(ae.tas, 0)) * KT, w = Math.max(0, num(ae.propWashMs, 0));
    var Vref = Math.max(V, 0.75 * w, 0.001);
    this.Vref = Vref;
    this.active = V > 1.2 || w > 1.5;
    var U0 = V / Vref;
    this.U0 = U0;
    var a = num(o.alphaDeg, num(ae.aoa, 0)) * DEG, b = num(o.betaDeg, num(ae.beta, 0)) * DEG;
    this.alpha = a; this.beta = b;
    this.U[0] = -U0 * Math.sin(b); this.U[1] = U0 * Math.sin(a) * Math.cos(b); this.U[2] = U0 * Math.cos(a) * Math.cos(b);
    var eps = clamp(num(ae.downwashDeg, 0), -10, 14) * DEG;
    this.downwash = eps;
    var dy = Math.sin(a) - 0.5 * Math.sin(eps), dz = Math.cos(a), dl = Math.hypot(dy, dz) || 1;
    this.dW[0] = -Math.sin(b) * 0.5; this.dW[1] = dy / dl; this.dW[2] = dz / dl;
    this.nSeg = 0;
    var q = num(ae.q, 0);
    if (q > 2 && V > 1.2) {
      var k = U0 / (2 * q);
      var flapHalf = Math.max(0, num(ae.flapLiftN, 0)) / 2;
      var wl = num(ae.liftLN, 0) - flapHalf, wr = num(ae.liftRN, 0) - flapHalf;
      var gIn = (wl + wr) / 2 * k / (2.6 + 0.7 * 2.48);
      var gOutL = (wl * k - gIn * 2.6) / 2.48, gOutR = (wr * k - gIn * 2.6) / 2.48;
      var gMax = 2.5;
      gIn = clamp(gIn, -gMax, gMax); gOutL = clamp(gOutL, -gMax, gMax); gOutR = clamp(gOutR, -gMax, gMax);
      this.gIn = gIn; this.gOutL = gOutL; this.gOutR = gOutR;
      var zq = -0.07, rc = 0.3;
      // left half: tip (-WB) → -2.6 (outer), -2.6 → 0 (inner); right half mirrored. Tip legs drawn ×TIP_GAIN.
      this.horseshoe(-WB, wingY(WB), zq + 0.03, -2.6, wingY(2.6), zq, gOutL, rc, TIP_GAIN, 1);
      this.horseshoe(-2.6, wingY(2.6), zq, 0, wingY(0) + 0.05, zq, gIn, rc, 1, 1);
      this.horseshoe(0, wingY(0) + 0.05, zq, 2.6, wingY(2.6), zq, gIn, rc, 1, 1);
      this.horseshoe(2.6, wingY(2.6), zq, WB, wingY(WB), zq + 0.03, gOutR, rc, 1, TIP_GAIN);
      var gF = flapHalf * k / (BREAK - FLAP_IN);
      this.gFlap = gF = clamp(gF, 0, gMax);
      if (gF > 1e-4) {
        var df = num(sf.flaps, 0) * DEG, zf = wingLE(1.4) + 0.88 * wingC(1.4), yf = wingY(1.4) - 0.06 - 0.32 * Math.sin(df);
        this.horseshoe(-BREAK, yf, zf, -FLAP_IN, yf, zf, gF, 0.22, 1, 1);
        this.horseshoe(FLAP_IN, yf, zf, BREAK, yf, zf, gF, 0.22, 1, 1);
      }
      var gT = clamp(num(ae.tailN, 0) * k / (2 * HT_B), -gMax, gMax);
      this.gTail = gT;
      if (Math.abs(gT) > 1e-4) this.horseshoe(-HT_B, HT_Y, htLE(0.7) + 0.25, HT_B, HT_Y, htLE(0.7) + 0.25, gT, 0.16, 1, 1);
    } else { this.gIn = this.gOutL = this.gOutR = this.gFlap = this.gTail = 0; }
    // fuselage: Rankine source at the spinner, sink in the tail cone (body radius ≈ 0.5 m in a unit free stream)
    this.src = U0 * Math.PI * 0.27;
    // slipstream (momentum theory: half the extra speed at the disc, contraction to Rf·R)
    var wn = w / Vref;
    this.w = wn;
    this.Rf = Math.sqrt((U0 + wn / 2) / Math.max(1e-3, U0 + wn));
    this.swirl = SWIRL_GAIN * clamp(num(ae.propSwirl, 0), 0, 1);
    this.s1 = 0.45 * Math.tan(a);
    this.s2 = this.s1 - Math.tan(eps) * 0.9;
    // control surfaces
    this.df = num(sf.flaps, 0) * DEG;
    this.daL = num(sf.aileronL, 0) * DEG; this.daR = num(sf.aileronR, 0) * DEG;
    this.de = num(sf.elevator, 0) * DEG; this.dr = num(sf.rudder, 0) * DEG;
    this.stall = clamp(num(ae.stallBlend, 0), 0, 1) * (V > 1.2 ? 1 : 0);
    this.time = num(o.time, 0);
    return this;
  };
  /** Slipstream axis height at body z. */
  Field.prototype.slipAxisY = function (z) {
    var t = z - HUB[2], tw = 3.0;
    return t <= tw ? HUB[1] + this.s1 * t : HUB[1] + this.s1 * tw + this.s2 * (t - tw);
  };
  var _fs = [0, 0, 0];
  /** out[0..2] = velocity (normalised), out[3] = separation "heat" 0..1. */
  Field.prototype.velocity = function (x, y, z, out) {
    var vx = this.U[0], vy = this.U[1], vz = this.U[2];
    // horseshoe vortices (Biot-Savart, smoothed core: |r1×r2|² + rc²|r0|²)
    var s = this.seg, n = this.nSeg;
    for (var i = 0; i < n; i++) {
      var o = i * 9;
      var ax = s[o], ay = s[o + 1], az = s[o + 2], bx = s[o + 3], by = s[o + 4], bz = s[o + 5];
      var r1x = x - ax, r1y = y - ay, r1z = z - az, r2x = x - bx, r2y = y - by, r2z = z - bz;
      var cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x;
      var r0x = bx - ax, r0y = by - ay, r0z = bz - az;
      var r02 = r0x * r0x + r0y * r0y + r0z * r0z;
      var den = cx * cx + cy * cy + cz * cz + s[o + 7] * r02;
      if (den < 1e-12) continue;
      var n1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z), n2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
      if (n1 < 1e-6 || n2 < 1e-6) continue;
      var dot = r0x * (r1x / n1 - r2x / n2) + r0y * (r1y / n1 - r2y / n2) + r0z * (r1z / n1 - r2z / n2);
      var kk = s[o + 6] * dot / den;
      vx += kk * cx; vy += kk * cy; vz += kk * cz;
    }
    // fuselage source (spinner) / sink (tail cone)
    if (this.src > 0) {
      var m = this.src / (4 * Math.PI);
      var dx = x, dy = y + 0.04, dz = z + 2.05, d2 = dx * dx + dy * dy + dz * dz + 0.04, f = m / (d2 * Math.sqrt(d2));
      vx += f * dx; vy += f * dy; vz += f * dz;
      dy = y - 0.12; dz = z - 3.3; d2 = dx * dx + dy * dy + dz * dz + 0.09; f = -m / (d2 * Math.sqrt(d2));
      vx += f * dx; vy += f * dy; vz += f * dz;
    }
    // propeller slipstream
    if (this.w > 0.01) {
      var t = z - HUB[2];
      if (t > -1.6 && t < 10) {
        var ayc = this.slipAxisY(z), px = x - HUB[0], py = y - ayc, r = Math.sqrt(px * px + py * py);
        var R = t < 0 ? PROP_R * (1 + 0.25 * Math.min(1, -t)) : PROP_R * (this.Rf + (1 - this.Rf) * Math.exp(-t / 0.5)) * (1 + 0.035 * Math.max(0, t - 3));
        var prof = 1 - smooth(0.72, 1.1, r / R);
        if (prof > 0) {
          var wa = t < 0 ? 0.5 * this.w * Math.exp(t / 0.45) : this.w * (1 - 0.5 * Math.exp(-t / 0.45)) * Math.exp(-Math.max(0, t - 6) / 5);
          wa *= prof;
          vz += wa; vy += wa * (t < 3 ? this.s1 : this.s2);
          if (t > 0) {
            var sw = this.swirl * wa / R * Math.min(1, t / 0.15);   // clockwise seen from behind: (y, -x)
            vx += sw * py; vy -= sw * px;
          } else if (r > 1e-3) {   // contraction ahead of the disc: air drawn in toward the axis
            var cin = 0.18 * wa / R; vx -= cin * px; vy -= cin * py;
          }
        }
      }
    }
    var sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    // flow turned by the deflected surfaces (scaled by the local speed)
    var ax2 = Math.abs(x);
    if (ax2 < WB && z > -0.4 && z < 3.6) {
      var sx = ax2, le = wingLE(sx), c = wingC(sx), yw = wingY(sx);
      var d = 0, hz = 0;
      if (sx > FLAP_IN && sx < BREAK && this.df > 0.005) { d = this.df; hz = le + 0.72 * c; }
      else if (sx > BREAK && sx < AIL_OUT) { d = x < 0 ? this.daL : this.daR; hz = le + AIL_F * c; }
      if (d !== 0) {
        var te = le + c, u = (z - hz) / (te - hz);
        if (u > 0) {
          var yref = yw - Math.sin(d) * (Math.min(z, te) - hz) * 0.9 - (z > te ? Math.tan(d) * 0.5 * (z - te) : 0);
          var wz = (u < 1 ? u : Math.exp(-(z - te) / 1.8)), wy = Math.exp(-((y - yref) * (y - yref)) / 0.3);
          var edge = smooth(0, 0.15, sx - (d === this.df ? FLAP_IN : BREAK)) * smooth(0, 0.15, (d === this.df ? BREAK : AIL_OUT) - sx);
          var turn = Math.sin(d) * 1.1 * wz * wy * edge * sp;
          vy -= turn; vz -= Math.abs(turn) * 0.12;
        }
      }
    }
    if (ax2 < HT_B + 0.3 && z > ELEV_HINGE - 0.3 && z < ELEV_HINGE + 1.8 && Math.abs(this.de) > 0.005) {
      var ue = (z - ELEV_HINGE) / 0.45, we = (ue < 1 ? Math.max(0, ue) : Math.exp(-(z - ELEV_HINGE - 0.45) / 0.9));
      var yre = HT_Y - Math.sin(this.de) * Math.max(0, z - ELEV_HINGE) * 0.8;
      we *= Math.exp(-((y - yre) * (y - yre)) / 0.1) * smooth(0, 0.3, HT_B + 0.2 - ax2);
      vy -= Math.sin(this.de) * 0.9 * we * sp;
    }
    if (y > FIN_Y0 - 0.15 && y < FIN_Y1 + 0.1 && Math.abs(this.dr) > 0.005) {
      var hr = rudHinge(y), ur = (z - hr) / 0.45;
      if (ur > 0 && z < hr + 2.2) {
        var wr2 = (ur < 1 ? ur : Math.exp(-(z - hr - 0.45) / 0.9)) * Math.exp(-(x * x) / 0.12);
        vx += Math.sin(this.dr) * 0.9 * wr2 * sp;
      }
    }
    // stall: separated, slow, reversing, tumbling flow over the upper wing behind ≈ 30 % chord (root first)
    var heat = 0;
    if (this.stall > 0.01 && ax2 < WB - 0.3) {
      var le2 = wingLE(ax2), c2 = wingC(ax2), z30 = le2 + 0.28 * c2, te2 = le2 + c2;
      if (z > z30 && z < te2 + 2.2) {
        var yu = wingY(ax2) + 0.07 * c2 - (Math.min(z, te2) - le2 - 0.3 * c2) * 0.04 + (z > te2 ? (z - te2) * this.U[1] : 0);
        var hgt = y - yu, thick = 0.1 + 0.42 * Math.min(1.6, (z - z30) / (0.75 * c2));
        if (hgt > -0.05 && hgt < thick) {
          var local = this.stall * (1 - 0.55 * (ax2 / WB) * (ax2 / WB));
          var wsep = local * (1 - smooth(0.55 * thick, thick, hgt)) * smooth(z30, z30 + 0.25, z) * (z > te2 + 1.4 ? Math.exp(-(z - te2 - 1.4) / 0.5) : 1);
          if (wsep > 0.001) {
            var tt = this.time, near = 1 - clamp(hgt / thick, 0, 1);
            var nx = Math.sin(2.1 * y + 3.3 * tt + 1.7 * z) * Math.cos(1.3 * z - 2.9 * tt + x);
            var ny = Math.sin(2.7 * z - 4.1 * tt + 0.7 * x) + 0.5 * Math.sin(5.3 * y + 2.3 * tt);
            var nz = Math.cos(3.1 * y + 3.7 * tt - 1.1 * x);
            var turb = 0.55 * sp;
            vx = lerp(vx, 0.25 * turb * nx, wsep);
            vy = lerp(vy, turb * ny * 0.8 + 0.1 * sp, wsep);
            vz = lerp(vz, 0.2 * this.U0 - 0.45 * near * sp + turb * nz * 0.6, wsep);
            heat = wsep;
          }
        }
      }
    }
    out[0] = vx; out[1] = vy; out[2] = vz; out[3] = heat;
    return out;
  };
  var _fa = [0, 0, 0];
  /** Camber-line height of the wing at span s, chord fraction xc, with a flap / aileron deflected d (rad) behind hx. */
  Field.prototype.wingMid = function (s, xc, c, d, hx) {
    var yc = wingY(s) - (xc - 0.25) * c * Math.sin(wingInc(s)), mid = yc + naca(0.02, 0.4, 0.12, Math.min(Math.max(xc, 0), 1)).c * c;
    if (d !== 0 && xc > hx) mid -= Math.sin(d) * (xc - hx) * c;
    return mid;
  };
  /**
   * Keep a moved particle out of the wing, horizontal tail, fin and fuselage: p = [x, y, z] (modified in place),
   * prev = its position before the move (which side it came from). Returns true if it was pushed.
   */
  Field.prototype.constrain = function (p, prev) {
    var x = p[0], y = p[1], z = p[2], ax = Math.abs(x), pushed = false;
    // wing (with the deflected flap / aileron behind their hinges)
    if (ax < WB && y > 0.0 && y < 1.0) {
      var le = wingLE(ax), c = wingC(ax);
      var xc = (z - le) / c;
      if (xc > -0.01 && xc < 1.12) {
        var d = 0, hx = 1;
        if (ax > FLAP_IN && ax < BREAK) { d = this.df; hx = 0.7; } else if (ax > BREAK && ax < AIL_OUT) { d = x < 0 ? this.daL : this.daR; hx = AIL_F; }
        var mid = this.wingMid(ax, xc, c, d, hx), half = xc > 1 ? 0.012 : naca(0.02, 0.4, 0.12, Math.min(xc, 1)).t * c + 0.012;
        if (Math.abs(y - mid) < half) {
          // which side it came from: compare the previous point with the surface at ITS chord station
          var xcp = clamp((prev[2] - le) / c, 0, 1.12);
          var above = prev[1] > this.wingMid(ax, xcp, c, d, hx);
          p[1] = above ? mid + half + 0.004 : mid - half - 0.004;
          pushed = true;
        }
      }
    }
    // horizontal tail + elevator
    if (ax < HT_B && Math.abs(y - HT_Y) < 0.25) {
      var l2 = htLE(ax), t2 = htTE(ax), xc2 = (z - l2) / (t2 - l2);
      if (xc2 > 0 && xc2 < 1) {
        var m2 = HT_Y - (z > ELEV_HINGE ? Math.sin(this.de) * (z - ELEV_HINGE) : 0);
        var h2 = naca(0, 0.4, 0.09, xc2).t * (t2 - l2) + 0.01;
        if (Math.abs(y - m2) < h2) { p[1] = prev[1] > m2 ? m2 + h2 + 0.004 : m2 - h2 - 0.004; pushed = true; }
      }
    }
    // fin + rudder (a thin plate in x = 0, the rudder turned about its hinge)
    if (y > FIN_Y0 - 0.25 && y < FIN_Y1 && z > finLE(Math.max(y, FIN_Y0)) && z < rudTE(y)) {
      var hr = rudHinge(y), mx = z > hr ? Math.sin(this.dr) * (z - hr) : 0, hw = 0.03;
      if (Math.abs(x - mx) < hw || (prev[0] - mx) * (x - mx) < 0) { p[0] = (prev[0] >= mx ? mx + hw + 0.004 : mx - hw - 0.004); pushed = true; }
    }
    // fuselage (elliptic sections)
    if (z > FUS_Z0 && z < FUS_Z1 && ax < 0.6) {
      var fs = fusAt(z, _fa);
      if (fs) {
        var ex = x / (fs[0] + 0.015), ey = (y - fs[1]) / (fs[2] + 0.015), e2 = ex * ex + ey * ey;
        if (e2 < 1) {
          var e = Math.sqrt(e2);
          if (e < 1e-4) { ex = 0; ey = 1; e = 1; }
          p[0] = ex / e * (fs[0] + 0.02); p[1] = fs[1] + ey / e * (fs[2] + 0.02);
          pushed = true;
        }
      }
    }
    return pushed;
  };

  /* ================================================================ regions, focus, views */
  var REG = { body: 0, wing: 1, flaps: 2, ailerons: 3, wingtips: 4, tail: 5, rudder: 6, prop: 7, stall: 8 };
  var REGIONS = ['flaps', 'ailerons', 'elevator', 'rudder', 'prop', 'wingtips', 'stall', 'tail', 'wing'];
  /** focus region → particle regions emphasised */
  var FOCUS = {
    flaps: [REG.flaps, REG.wing], ailerons: [REG.ailerons, REG.wingtips], elevator: [REG.tail], rudder: [REG.rudder, REG.prop],
    prop: [REG.prop, REG.rudder], wingtips: [REG.wingtips], stall: [REG.stall, REG.wing, REG.flaps, REG.ailerons], tail: [REG.tail, REG.rudder],
    wing: [REG.wing, REG.flaps, REG.ailerons]
  };
  var VIEWS = {
    flaps: { pos: [-12.4, -0.15, 2.6], target: [-1.2, 0.25, 1.5] },
    ailerons: { pos: [0, 2.9, 13.0], target: [0, 0.35, 0.6] },
    elevator: { pos: [-7.4, 1.0, 5.6], target: [0, 0.1, 3.4] },
    rudder: { pos: [4.6, 6.4, 9.6], target: [0, 0.4, 3.0] },
    prop: { pos: [-7.9, 1.9, -5.9], target: [0, 0.1, 1.4] },
    wingtips: { pos: [10.4, 2.6, 9.8], target: [4.2, 0.3, 3.0] },
    stall: { pos: [-11.6, 1.2, 1.4], target: [-1.4, 0.55, 1.4] },
    tail: { pos: [-8.6, 3.4, 9.8], target: [0, 0.3, 3.4] },
    wing: { pos: [-9.0, 4.4, -6.4], target: [-1.4, 0.3, 0.9] }
  };

  /* ================================================================ particles: emitters */
  // n = [alta, media, baja]; kind 0 = air, 1 = slipstream, 2 = stall eddy, 3 = wingtip vortex helix
  var EMITTERS = [
    { id: 'wing', region: REG.wing, kind: 0, n: [10, 6, 0] },
    { id: 'flaps', region: REG.flaps, kind: 0, n: [10, 6, 2] },
    { id: 'ailerons', region: REG.ailerons, kind: 0, n: [8, 5, 2] },
    { id: 'wingtips', region: REG.wingtips, kind: 0, n: [18, 10, 4] },
    { id: 'tail', region: REG.tail, kind: 0, n: [6, 4, 0] },
    { id: 'rudder', region: REG.rudder, kind: 0, n: [6, 4, 0] },
    { id: 'body', region: REG.body, kind: 0, n: [0, 0, 0] },
    { id: 'prop', region: REG.prop, kind: 1, n: [96, 56, 26] },
    { id: 'stall', region: REG.stall, kind: 2, n: [110, 60, 28] },
    { id: 'helix', region: REG.wingtips, kind: 3, n: [26, 16, 8] }
  ];
  var LEVEL = { alta: 0, media: 1, baja: 2 };
  var Z0 = -6.4, Z_END = 8.6;
  var TRAIL_N = 13, TICK = 0.034;   // samples per trail, visual seconds between samples
  var STRIDE = 15;                  // pA(3) pB(3) dA(3) dB(3) meta(3)

  /* ================================================================ shaders */
  var STREAK_VS = [
    'attribute vec3 pA; attribute vec3 pB; attribute vec3 dA; attribute vec3 dB; attribute vec3 meta;',
    'uniform float uTime; uniform float uTrail; uniform float uWidth; uniform vec2 uView; uniform float uGlobal;',
    'uniform vec4 uFade; uniform float uFrame;',
    'uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;',
    'uniform vec3 uProp; uniform vec3 uHeat; uniform vec3 uTip; uniform vec3 uSmoke;',
    'varying vec4 vCol; varying float vSide;',
    'vec3 ramp(float s) {',
    '  if (s < 0.92) return mix(uC0, uC1, smoothstep(0.7, 0.92, s));',
    '  if (s < 1.0) return mix(uC1, uC2, smoothstep(0.92, 1.0, s));',
    '  if (s < 1.12) return mix(uC2, uC3, smoothstep(1.02, 1.12, s));',
    '  return mix(uC3, uC4, smoothstep(1.14, 1.3, s));',
    '}',
    'void main() {',
    '  float e = position.x; float side = position.y;',
    '  vec4 va = modelViewMatrix * vec4(pA, 1.0); vec4 vb = modelViewMatrix * vec4(pB, 1.0);',
    '  vec4 ca = projectionMatrix * va; vec4 cb = projectionMatrix * vb;',
    '  float birth = mix(dA.x, dB.x, e);',
    '  if (ca.w <= 0.01 || cb.w <= 0.01 || dA.x < -1.0e5 || dB.x < -1.0e5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vSide = 0.0; return; }',
    '  float age = max(0.0, uTime - birth);',
    '  float life = clamp(1.0 - age / uTrail, 0.0, 1.0);',
    '  float kind = meta.x; float emph = meta.y;',
    '  vec2 sa = ca.xy / ca.w * uView * 0.5; vec2 sb = cb.xy / cb.w * uView * 0.5;',
    '  vec2 dir = sb - sa; float len = length(dir);',
    '  dir = len > 1.0e-4 ? dir / len : vec2(1.0, 0.0);',
    '  vec2 nrm = vec2(-dir.y, dir.x);',
    '  float wk = kind > 3.5 ? 3.0 : (kind > 2.5 ? 1.35 : (kind > 0.5 && kind < 1.5 ? 1.35 : 1.0));',
    '  float w = uWidth * wk * (0.3 + 0.7 * life) * (emph > 1.05 ? 1.35 : (emph < 0.5 ? 0.8 : 1.0));',
    '#ifdef HALO',
    '  w = w * 2.3 + 2.0;',
    '#endif',
    '  vec4 c = e < 0.5 ? ca : cb;',
    '  vec2 off = nrm * side * w * 0.5 + dir * (e < 0.5 ? -0.5 : 0.5) * w * 0.6;',
    '  c.xy += off / (uView * 0.5) * c.w;',
    '  gl_Position = c;',
    '  float spd = mix(dA.y, dB.y, e); float heat = mix(dA.z, dB.z, e);',
    '  vec3 col; float a = 1.0;',
    '  if (kind < 0.5) { col = ramp(spd); a = 0.6; }',
    '  else if (kind < 1.5) { col = mix(ramp(spd), uProp, 0.8); a = 1.15; }',
    '  else if (kind < 2.5) col = uHeat;',
    '  else if (kind < 3.5) { col = uTip; a = clamp(spd, 0.0, 1.0); }',
    '  else { col = uSmoke; a = 0.9; }',
    '  col = mix(col, uHeat, clamp(heat, 0.0, 1.0));',
    '  vec3 pw = e < 0.5 ? pA : pB;',
    '  float fz = kind < 3.5 ? smoothstep(uFade.x, uFade.y, pw.z) * (1.0 - smoothstep(uFade.z, uFade.w, pw.z)) : 1.0;',
    '  if (kind > 0.5) fz = kind < 3.5 ? 1.0 - smoothstep(uFade.z, uFade.w, pw.z) : 1.0;',
    '  float born = clamp((uTime - meta.z) / 0.35, 0.0, 1.0);',
    '  a *= life * sqrt(life) * fz * born * emph * uGlobal;',
    '  vCol = vec4(col, a); vSide = side;',
    '}'
  ].join('\n');
  var STREAK_FS = [
    'uniform float uLight; varying vec4 vCol; varying float vSide;',
    'void main() {',
    '  float d = abs(vSide);',
    '  float glow = 1.0 - smoothstep(0.0, 1.0, d);',
    '  glow = uLight > 0.5 ? (1.0 - smoothstep(0.55, 1.0, d)) : glow * glow;',
    '  float hot = pow(max(0.0, 1.0 - d * 1.7), 3.0) * (1.0 - uLight);',
    '  vec3 col = vCol.rgb * (1.0 + 0.15 * (1.0 - uLight)) + vec3(hot * 0.22);',
    '  gl_FragColor = vec4(col, vCol.a * glow);',
    '#ifdef HALO',
    '  gl_FragColor = vec4(0.008, 0.02, 0.05, min(1.0, vCol.a) * (1.0 - smoothstep(0.25, 1.0, d)) * (0.42 + 0.2 * uLight));',
    '#endif',
    '  #include <encodings_fragment>',
    '}'
  ].join('\n');
  // streamlines: continuous faint lines with bright comet pulses travelling at the LOCAL flow speed (vTau = visual
  // travel time from the seed: the pulses bunch where the air is slow and stretch where it is fast)
  var LINE_VS = [
    'attribute vec3 pA; attribute vec3 pB; attribute vec3 dA; attribute vec3 dB; attribute vec3 meta;',
    'uniform float uWidth; uniform vec2 uView; uniform float uGlobal; uniform vec4 uFade; uniform float uTime; uniform float uPeriod; uniform float uLight;',
    'uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4; uniform vec3 uProp; uniform vec3 uHeat; uniform vec3 uTip;',
    'varying vec4 vCol; varying float vSide; varying float vTau; varying float vPh;',
    'vec3 ramp(float s) {',
    '  if (s < 0.92) return mix(uC0, uC1, smoothstep(0.7, 0.92, s));',
    '  if (s < 1.0) return mix(uC1, uC2, smoothstep(0.92, 1.0, s));',
    '  if (s < 1.12) return mix(uC2, uC3, smoothstep(1.02, 1.12, s));',
    '  return mix(uC3, uC4, smoothstep(1.14, 1.3, s));',
    '}',
    'void main() {',
    '  float e = position.x; float side = position.y;',
    '  vec4 ca = projectionMatrix * modelViewMatrix * vec4(pA, 1.0); vec4 cb = projectionMatrix * modelViewMatrix * vec4(pB, 1.0);',
    '  if (meta.x < -0.5 || ca.w <= 0.01 || cb.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vSide = 0.0; vTau = 0.0; vPh = 0.0; return; }',
    '  vec2 sa = ca.xy / ca.w * uView * 0.5; vec2 sb = cb.xy / cb.w * uView * 0.5;',
    '  vec2 dir = sb - sa; float len = length(dir); dir = len > 1.0e-4 ? dir / len : vec2(1.0, 0.0);',
    '  vec2 nrm = vec2(-dir.y, dir.x);',
    '  float emph = meta.y;',
    '  float tv = mix(dA.x, dB.x, e); float phv = fract((uTime - tv) / uPeriod + meta.z);',
    '  float pv = exp(-phv * 5.0);',
    '  float w = uWidth * (emph > 1.05 ? 1.3 : (emph < 0.5 ? 0.75 : 1.0)) * (meta.x > 0.5 ? 1.1 : 1.0) * (0.8 + 1.15 * pv);',
    '#ifdef HALO',
    '  w = w * (2.0 - 0.4 * uLight) + 2.5 - uLight;',
    '#endif',
    '  vec4 c = e < 0.5 ? ca : cb;',
    '  c.xy += (nrm * side * w * 0.5 + dir * (e < 0.5 ? -0.5 : 0.5) * w * 0.5) / (uView * 0.5) * c.w;',
    '  gl_Position = c;',
    '  float spd = mix(dA.y, dB.y, e); float heat = mix(dA.z, dB.z, e);',
    '  vec3 col = meta.x > 2.5 ? uTip : (meta.x > 0.5 ? mix(ramp(spd), uProp, 0.78) : ramp(spd));',
    '  col = mix(col, uHeat, clamp(heat, 0.0, 1.0));',
    '  vec3 pw = e < 0.5 ? pA : pB;',
    '  float fz = smoothstep(uFade.x, uFade.y, pw.z) * (1.0 - smoothstep(uFade.z, uFade.w, pw.z));',
    '  if (meta.x > 0.5) fz = 1.0 - smoothstep(4.2, 6.6, pw.z);',
    '  if (meta.x > 2.5) fz = (1.0 - smoothstep(uFade.z, uFade.w, pw.z)) * clamp(spd, 0.0, 1.0);',
    '  vCol = vec4(col, fz * emph * uGlobal); vSide = side; vTau = mix(dA.x, dB.x, e); vPh = meta.z;',
    '}'
  ].join('\n');
  var LINE_FS = [
    'uniform float uTime; uniform float uPeriod; uniform float uLight; uniform float uBase; uniform float uPulse;',
    'varying vec4 vCol; varying float vSide; varying float vTau; varying float vPh;',
    'void main() {',
    '  float ph = fract((uTime - vTau) / uPeriod + vPh);',
    '  float pulse = exp(-ph * 5.0) * smoothstep(0.0, 0.025, ph) * uPulse;',
    '  float d = abs(vSide);',
    '  float glow = uLight > 0.5 ? 1.0 - smoothstep(0.5, 1.0, d) : (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - smoothstep(0.0, 1.0, d));',
    '  float hot = pow(max(0.0, 1.0 - d * 1.8), 3.0) * pulse;',
    '  vec3 col = vCol.rgb * (0.75 + 0.75 * pulse) + vec3(hot * (0.6 - 0.35 * uLight));',
    '  gl_FragColor = vec4(col, vCol.a * glow * (uBase + (1.0 - uBase) * pulse));',
    '#ifdef HALO',
    '  gl_FragColor = vec4(0.008, 0.02, 0.05, min(1.0, vCol.a) * (1.0 - smoothstep(0.25, 1.0, d)) * (0.75 * uBase + 0.45 * pulse) * (0.75 - 0.2 * uLight));',
    '#endif',
    '  #include <encodings_fragment>',
    '}'
  ].join('\n');
  var PALETTE = {
    dark: { c0: 0x3341ff, c1: 0x2c86ff, c2: 0x38c6ff, c3: 0xffb43a, c4: 0xff5f24, prop: 0xff8a26, heat: 0xff3b2f, tip: 0xb48cff, smoke: 0xe6eeff },
    light: { c0: 0x3352ff, c1: 0x2f96ff, c2: 0x9be9ff, c3: 0xffb02e, c4: 0xff5a1e, prop: 0xff8a26, heat: 0xff3b2f, tip: 0xcaa6ff, smoke: 0xffffff }
  };
  // pressure tint on the wing skins: upper = blue (baja presión), lower = red (alta presión)
  var TINT_VS = [
    'attribute vec4 aInfo; varying vec4 vInfo;',
    'void main() { vInfo = aInfo; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');
  var TINT_FS = [
    'uniform vec2 uCl; uniform float uFlap; uniform float uStall; uniform float uTime; uniform float uOp;',
    'uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uSep; varying vec4 vInfo;',
    'void main() {',
    '  float xc = clamp(vInfo.x, 0.0, 1.0); float up = vInfo.y; float sb = vInfo.z; float side = vInfo.w;',
    '  float cl = side < 0.0 ? uCl.x : uCl.y;',
    '  float span = pow(max(0.0, 1.0 - sb * sb * 0.94), 0.35);',
    '  float fz = uFlap * smoothstep(0.1, 0.13, sb) * (1.0 - smoothstep(0.455, 0.475, sb));',
    '  float load;',
    '  if (up > 0.0) load = cl * (0.34 + 1.15 * exp(-xc * 9.0)) * pow(1.0 - xc, 0.55) + fz * (0.22 + 0.55 * xc);',
    '  else load = cl * (0.12 + 0.8 * exp(-xc * 5.0)) * pow(1.0 - xc, 0.5) + fz * (0.3 + 0.45 * xc);',
    '  load *= span;',
    '  float sep = up > 0.0 ? uStall * smoothstep(0.14, 0.34, xc) * (1.0 - 0.55 * sb * sb) : 0.0;',
    '  load *= 1.0 - 0.92 * sep;',
    '  float a = clamp(abs(load) * 0.95, 0.0, 0.78);',
    '  vec3 col = (up > 0.0) == (load >= 0.0) ? uLow : uHigh;',

    '  float n = sin(xc * 13.0 + uTime * 5.0 + sb * 9.0) * sin(sb * 17.0 - uTime * 3.7 + xc * 7.0);',
    '  col = mix(col, uSep, clamp(sep * 1.2, 0.0, 1.0));',
    '  a = max(a, sep * (0.5 + 0.3 * n));',
    '  gl_FragColor = vec4(col, a * uOp);',
    '  #include <encodings_fragment>',
    '}'
  ].join('\n');
  // animated chevrons along a tube (moment arcs): uv.x runs along the arc
  var ARC_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var ARC_FS = [
    'uniform vec3 uCol; uniform float uOp; uniform float uPhase; varying vec2 vUv;',
    'void main() {',
    '  float f = fract(vUv.x * 7.0 - uPhase);',
    '  float chev = smoothstep(0.0, 0.18, f) * (1.0 - smoothstep(0.42, 0.62, f));',
    '  float ends = smoothstep(0.0, 0.08, vUv.x);',
    '  gl_FragColor = vec4(uCol * (0.75 + 0.6 * chev), uOp * ends * (0.5 + 0.5 * chev));',
    '  #include <encodings_fragment>',
    '}'
  ].join('\n');

  /* ================================================================ create */
  function create(THREE, ext, opts) {
    opts = opts || {};
    var V3 = THREE.Vector3;
    var flow = {};
    var settings = { enabled: false, streamlines: true, propwash: true, vortices: true, pressure: true, forces: true,
      moments: true, trails: true, density: 'alta', slowmo: 1 };
    var focusName = null;
    var body = (ext && (ext.body || ext.root)) || new THREE.Group();
    var scene = (ext && ext.scene) || new THREE.Scene();
    var geom = ext && ext.geom;
    var group = new THREE.Group();          // body-frame visuals
    group.name = 'airflow';
    group.visible = false;
    body.add(group);
    var sceneGroup = new THREE.Group();     // scene-frame visuals (weight arrow, flight trails)
    sceneGroup.name = 'airflow-scene';
    sceneGroup.visible = false;
    scene.add(sceneGroup);
    var field = new Field();
    var ae = {};                            // aero snapshot
    var sfDisp = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flaps: 0 };
    var vclock = 0, nextTick = 0, tickCount = 0;
    var globalA = 0, labelsOn = true, lastLight = -1;

    /* ------------------------------------------------ particles */
    var NMAX = 0, ranges = [];
    EMITTERS.forEach(function (em) { ranges.push({ em: em, start: NMAX, n: em.n }); NMAX += em.n[0]; });
    var P = new Float32Array(NMAX * 3), PREV = new Float32Array(NMAX * 3);
    var KIND = new Uint8Array(NMAX), REGN = new Uint8Array(NMAX), EMI = new Uint8Array(NMAX), ACT = new Uint8Array(NMAX);
    var AGE = new Float32Array(NMAX), LIFE = new Float32Array(NMAX), SPAWN = new Float32Array(NMAX);
    var SPD = new Float32Array(NMAX), HEAT = new Float32Array(NMAX), RND = new Float32Array(NMAX);
    var LAST = new Float32Array(NMAX * 6), HAS = new Uint8Array(NMAX), EMPH = new Float32Array(NMAX);
    var AUX = new Float32Array(NMAX * 4);
    ranges.forEach(function (r, ei) {
      for (var i = r.start; i < r.start + r.n[0]; i++) { KIND[i] = r.em.kind; REGN[i] = r.em.region; EMI[i] = ei; EMPH[i] = 1; }
    });
    var seed = 12345;
    function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    for (var ri = 0; ri < NMAX; ri++) RND[ri] = rand();

    // instanced streak geometry: history (slot-major: instance = slot × NMAX + i) and heads (one per particle)
    function quadGeometry(count) {
      var g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
      g.setIndex([0, 2, 1, 2, 3, 1]);
      var arr = new Float32Array(count * STRIDE);
      for (var i = 0; i < count; i++) { arr[i * STRIDE + 6] = -1e9; arr[i * STRIDE + 9] = -1e9; }
      var ib = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1);
      ib.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('pA', new THREE.InterleavedBufferAttribute(ib, 3, 0));
      g.setAttribute('pB', new THREE.InterleavedBufferAttribute(ib, 3, 3));
      g.setAttribute('dA', new THREE.InterleavedBufferAttribute(ib, 3, 6));
      g.setAttribute('dB', new THREE.InterleavedBufferAttribute(ib, 3, 9));
      g.setAttribute('meta', new THREE.InterleavedBufferAttribute(ib, 3, 12));
      g.instanceCount = count;
      g.userData.ib = ib;
      return g;
    }
    function col(h) { return new THREE.Color(h); }
    var uniforms = {
      uTime: { value: 0 }, uTrail: { value: TRAIL_N * TICK }, uWidth: { value: 3 }, uView: { value: new THREE.Vector2(800, 600) },
      uGlobal: { value: 0 }, uFade: { value: new THREE.Vector4(Z0, Z0 + 1.6, Z_END - 2.6, Z_END) }, uFrame: { value: 0 },
      uC0: { value: col(0) }, uC1: { value: col(0) }, uC2: { value: col(0) }, uC3: { value: col(0) }, uC4: { value: col(0) },
      uProp: { value: col(0) }, uHeat: { value: col(0) }, uTip: { value: col(0) }, uSmoke: { value: col(0) }, uLight: { value: 0 }
    };
    var streakMat = new THREE.ShaderMaterial({ uniforms: uniforms, vertexShader: STREAK_VS, fragmentShader: STREAK_FS,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });
    streakMat.toneMapped = false;
    var histGeo = quadGeometry(NMAX * TRAIL_N), headGeo = quadGeometry(NMAX);
    var histMesh = new THREE.Mesh(histGeo, streakMat), headMesh = new THREE.Mesh(headGeo, streakMat);
    [histMesh, headMesh].forEach(function (m) { m.frustumCulled = false; m.renderOrder = 12; group.add(m); });
    // dark halo pass under the glow (same geometry): keeps the additive lines readable over the white airplane
    var streakHaloMat = new THREE.ShaderMaterial({ uniforms: uniforms, vertexShader: STREAK_VS, fragmentShader: STREAK_FS,
      defines: { HALO: 1 }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending });
    streakHaloMat.toneMapped = false;
    var haloMeshes = [new THREE.Mesh(histGeo, streakHaloMat), new THREE.Mesh(headGeo, streakHaloMat)];
    haloMeshes.forEach(function (m) { m.frustumCulled = false; m.renderOrder = 9; group.add(m); });
    var _vp = new THREE.Vector4(), _sz = new THREE.Vector2();
    histMesh.onBeforeRender = function (renderer) {
      renderer.getCurrentViewport(_vp);
      uniforms.uView.value.set(Math.max(1, _vp.z), Math.max(1, _vp.w));
      var pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      var hCss = _vp.w / pr;
      uniforms.uWidth.value = (uniforms.uLight.value > 0.5 ? 2.4 : 2.6) * pr * clamp(hCss / 820, 0.62, 1.35);
    };
    var histArr = histGeo.userData.ib.array, headArr = headGeo.userData.ib.array;

    function setPalette(light) {
      var p = light ? PALETTE.light : PALETTE.dark;
      uniforms.uC0.value.setHex(p.c0); uniforms.uC1.value.setHex(p.c1); uniforms.uC2.value.setHex(p.c2);
      uniforms.uC3.value.setHex(p.c3); uniforms.uC4.value.setHex(p.c4); uniforms.uProp.value.setHex(p.prop);
      uniforms.uHeat.value.setHex(p.heat); uniforms.uTip.value.setHex(p.tip); uniforms.uSmoke.value.setHex(p.smoke);
      uniforms.uLight.value = light ? 1 : 0;
      streakMat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      trailMat.blending = streakMat.blending;
      lineMat.blending = streakMat.blending;
      haloMeshes.forEach(function (m) { m.userData.allowed = true; });
      lineUniforms.uBase.value = light ? 0.44 : 0.34;
      tintMat.uniforms.uLow.value.setHex(light ? 0x1f63e8 : 0x2f86ff);
      tintMat.uniforms.uHigh.value.setHex(light ? 0xe0332a : 0xff4a3a);
      arrowSet.forEach(function (a) { a.userData.glow.visible = !light; a.userData.outline.visible = light; });
    }

    /* ------------------------------------------------ spawning */
    var _v = [0, 0, 0, 0], _p = [0, 0, 0], _q = [0, 0, 0];
    /** Starting point upstream that reaches (x, y) at body z = zT following the free stream. */
    function upstream(i, x, y, zT, z0) {
      var U = field.U, uz = Math.max(0.3, U[2] / Math.max(1e-3, field.U0));
      var d = (zT - z0) / uz;
      P[i * 3] = x - U[0] / Math.max(1e-3, field.U0) * d * 0.6;
      P[i * 3 + 1] = y - U[1] / Math.max(1e-3, field.U0) * d;
      P[i * 3 + 2] = z0;
    }
    function spawn(i) {
      var em = EMITTERS[EMI[i]], r = rand(), r2 = rand(), sx = rand() < 0.5 ? -1 : 1, k = i * 3, x, y;
      AGE[i] = 0; HAS[i] = 0; HEAT[i] = 0; SPAWN[i] = vclock;
      LIFE[i] = 9;
      switch (em.id) {
        case 'wing':
          x = sx * ([1.25, 2.85, 4.0][Math.floor(r * 3)] + (rand() - 0.5) * 0.18);
          y = wingY(Math.abs(x)) + [-0.62, -0.4, -0.22, -0.09, 0.04, 0.15, 0.29, 0.47, 0.72, 1.02][Math.floor(r2 * 10)] + (rand() - 0.5) * 0.02;
          upstream(i, x, y, wingLE(Math.abs(x)) - 0.4, Z0);
          break;
        case 'flaps':
          x = sx * (0.75 + r * 1.5); y = wingY(Math.abs(x)) - 0.13 + r2 * 0.36;
          upstream(i, x, y, wingLE(Math.abs(x)) - 0.4, Z0 + rand() * 0.5);
          break;
        case 'ailerons':
          x = sx * (2.55 + r * 2.05); y = wingY(Math.abs(x)) - 0.13 + r2 * 0.36;
          upstream(i, x, y, wingLE(Math.abs(x)) - 0.4, Z0 + rand() * 0.5);
          break;
        case 'wingtips':
          x = sx * (4.75 + r * 0.8); y = wingY(WB) - 0.26 + r2 * 0.44;
          upstream(i, x, y, wingLE(WB) - 0.3, Z0 + rand() * 0.5);
          break;
        case 'tail':
          x = sx * (0.55 + r * 0.95); y = HT_Y - 0.12 + r2 * 0.42;
          upstream(i, x, y + field.downwash * 2.6, htLE(0.7), Z0);
          break;
        case 'rudder':
          x = (r - 0.5) * 0.55; y = FIN_Y0 + 0.05 + r2 * 1.05;
          upstream(i, x, y + field.downwash * 1.6, finLE(0.6), Z0);
          break;
        case 'body':
          x = (r - 0.5) * 13.5; y = -1.9 + r2 * 4.4;
          upstream(i, x, y, 0, Z0 + rand() * 1.5);
          break;
        case 'prop': {
          var ang = rand() * Math.PI * 2, rr = PROP_R * (0.25 + 0.68 * Math.sqrt(r));
          var zt = r2 < 0.3 ? HUB[2] - 1.1 : HUB[2] + 0.06;
          var rs = r2 < 0.3 ? rr * 1.15 : rr;
          P[k] = Math.cos(ang) * rs; P[k + 1] = field.slipAxisY(zt) + Math.sin(ang) * rs; P[k + 2] = zt;
          break;
        }
        case 'stall': {
          var s = 0.35 + 3.9 * r * r, xs = (sx < 0 ? -1 : 1) * s, c = wingC(s), le = wingLE(s), xc = 0.3 + r2 * 0.4;
          var f = naca(0.02, 0.4, 0.12, xc);
          var ys = wingY(s) + (f.c + f.t) * c + 0.03;
          var rad = 0.04 + rand() * 0.07;
          AUX[i * 4] = xs; AUX[i * 4 + 1] = ys + rad; AUX[i * 4 + 2] = le + xc * c; AUX[i * 4 + 3] = rand() * 6.283;
          P[k] = xs; P[k + 1] = ys; P[k + 2] = le + xc * c;
          RND[i] = rad;
          LIFE[i] = 1.4 + rand() * 1.2;
          break;
        }
        case 'helix': {
          var slot = i - ranges[EMI[i]].start, side = slot % 2 ? 1 : -1;
          AUX[i * 4] = 0;                                   // distance travelled behind the tip
          AUX[i * 4 + 1] = 0;                               // phase (one strand per tip)
          AUX[i * 4 + 2] = side;
          helixPos(i);
          LIFE[i] = 99;
          break;
        }
      }
      PREV[k] = P[k]; PREV[k + 1] = P[k + 1]; PREV[k + 2] = P[k + 2];
      writeMeta(i);
    }
    var tipStart = [0, 0, 0];
    function helixPos(i) {
      var d = AUX[i * 4], ph = AUX[i * 4 + 1], side = AUX[i * 4 + 2], k = i * 3;
      var W = field.dW;
      var rad = 0.05 + 0.3 * (1 - Math.exp(-d / 1.7));
      var cx = side * (WB - 0.06) - side * 0.085 * d + W[0] * d, cy = wingY(WB) - 0.02 + W[1] * d - 0.03 * d * Math.max(0, field.downwash * 3);
      var cz = wingLE(WB) + 0.35 + W[2] * d;
      P[k] = cx + Math.cos(ph) * rad; P[k + 1] = cy + Math.sin(ph) * rad; P[k + 2] = cz;
    }
    function writeMeta(i) {
      // head instance meta: kind, emphasis, spawn time
      var o = i * STRIDE;
      headArr[o + 12] = KIND[i]; headArr[o + 13] = EMPH[i]; headArr[o + 14] = SPAWN[i];
    }
    function deactivate(i) {
      ACT[i] = 0;
      var o = i * STRIDE;
      headArr[o + 6] = -1e9; headArr[o + 9] = -1e9;
    }

    /* ------------------------------------------------ density / activity */
    var level = 0, levelKey = 'alta', needPrewarm = true;
    function wantActive(ei, slot) {
      var em = EMITTERS[ei];
      if (slot >= em.n[level]) return false;
      if (!field.active) return false;
      if (em.kind === 0) return settings.streamlines && field.U0 > 0.15;
      if (em.kind === 1) return settings.propwash && field.w > 0.04;
      if (em.kind === 2) return settings.streamlines && slot < Math.round(em.n[level] * smooth(0.04, 0.55, field.stall));
      if (em.kind === 3) return settings.vortices && field.U0 > 0.15;
      return true;
    }
    function refreshActivity() {
      for (var e = 0; e < ranges.length; e++) {
        var r = ranges[e];
        for (var s = 0; s < r.n[0]; s++) {
          var i = r.start + s, w = wantActive(e, s);
          if (w && !ACT[i]) {
            ACT[i] = 1; spawn(i);
            if (EMITTERS[e].kind === 3) {   // spread the helix particles along the vortex (phase follows the twist)
              AUX[i * 4] = ((s >> 1) / Math.max(1, r.n[level] >> 1)) * 8.5;
              AUX[i * 4 + 1] = -AUX[i * 4] * 2.2 * AUX[i * 4 + 2];
              helixPos(i); syncPrev(i);
            }
          }
          else if (!w && ACT[i]) deactivate(i);
        }
      }
    }
    function syncPrev(i) { var k = i * 3; PREV[k] = P[k]; PREV[k + 1] = P[k + 1]; PREV[k + 2] = P[k + 2]; }

    /* ------------------------------------------------ stepping */
    var visK = 1;   // scene metres per normalised velocity unit per visual second
    function stepParticles(dtv) {
      if (dtv <= 0) return;
      field.time = vclock;
      var U0 = Math.max(field.U0, 1e-3), inv = 1 / Math.max(U0, field.w * 0.75 + (U0 < 0.15 ? 1 : 0), 1e-3);
      for (var i = 0; i < NMAX; i++) {
        if (!ACT[i]) continue;
        var k = i * 3, kind = KIND[i];
        PREV[k] = P[k]; PREV[k + 1] = P[k + 1]; PREV[k + 2] = P[k + 2];
        AGE[i] += dtv;
        if (kind === 3) {
          var gt = AUX[i * 4 + 2] < 0 ? field.gOutL : field.gOutR;
          var str = clamp(Math.abs(gt) / 0.22, 0, 1);
          AUX[i * 4] += visK * field.U0 * 0.95 * dtv;
          AUX[i * 4 + 1] += AUX[i * 4 + 2] * (gt >= 0 ? 1 : -1) * (4.2 + 7 * str) * dtv;
          helixPos(i);
          SPD[i] = str * smooth(0, 0.6, AUX[i * 4]);
          HEAT[i] = 0;
          if (AUX[i * 4] > 8.5) { AUX[i * 4] = 0; helixPos(i); syncPrev(i); HAS[i] = 0; SPAWN[i] = vclock; writeMeta(i); }
          continue;
        }
        if (kind === 2) {
          // stall eddy: a small vortex rolling over the upper wing, its centre carried slowly downstream
          var a4 = i * 4;
          field.velocity(AUX[a4], AUX[a4 + 1], AUX[a4 + 2], _v);
          AUX[a4] += _v[0] * 0.3 * visK * dtv; AUX[a4 + 1] += (_v[1] * 0.35 + 0.05) * visK * dtv; AUX[a4 + 2] += (_v[2] * 0.5 + 0.12 * field.U0) * visK * dtv;
          AUX[a4 + 3] -= (9 + 5 * RND[i] * 10) * dtv * 0.6;
          var rad = RND[i] * (1 + 1.4 * AGE[i]);
          P[k] = AUX[a4] + Math.sin(AUX[a4 + 3] * 0.7) * 0.03;
          P[k + 1] = AUX[a4 + 1] + Math.sin(AUX[a4 + 3]) * rad;
          P[k + 2] = AUX[a4 + 2] + Math.cos(AUX[a4 + 3]) * rad;
          SPD[i] = 0.4; HEAT[i] = 1;
          if (AGE[i] > LIFE[i] || field.stall < 0.02) { if (wantActive(EMI[i], i - ranges[EMI[i]].start)) spawn(i); else deactivate(i); }
          continue;
        }
        field.velocity(P[k], P[k + 1], P[k + 2], _v);
        // midpoint step (stable around the vortex cores)
        var h = visK * dtv;
        field.velocity(P[k] + _v[0] * h * 0.5, P[k + 1] + _v[1] * h * 0.5, P[k + 2] + _v[2] * h * 0.5, _q.length === 3 ? _vq : _vq);
        _p[0] = P[k] + _vq[0] * h; _p[1] = P[k + 1] + _vq[1] * h; _p[2] = P[k + 2] + _vq[2] * h;
        _q[0] = P[k]; _q[1] = P[k + 1]; _q[2] = P[k + 2];
        field.constrain(_p, _q);
        P[k] = _p[0]; P[k + 1] = _p[1]; P[k + 2] = _p[2];
        var sp = Math.sqrt(_vq[0] * _vq[0] + _vq[1] * _vq[1] + _vq[2] * _vq[2]) * inv;
        SPD[i] += (sp - SPD[i]) * Math.min(1, dtv * 14);
        HEAT[i] += (_vq[3] - HEAT[i]) * Math.min(1, dtv * 8);
        var z = P[k + 2];
        if (z > Z_END || z < Z0 - 3 || Math.abs(P[k]) > 11 || P[k + 1] < -4.5 || P[k + 1] > 6 || AGE[i] > LIFE[i]) {
          if (wantActive(EMI[i], i - ranges[EMI[i]].start)) spawn(i); else deactivate(i);
        }
      }
    }
    var _vq = [0, 0, 0, 0];
    function tick() {
      // push one trail sample for every active particle into ring slot s (slot-major: one contiguous upload)
      var s = tickCount % TRAIL_N, base = s * NMAX;
      tickCount++;
      for (var i = 0; i < NMAX; i++) {
        var o = (base + i) * STRIDE;
        if (!ACT[i]) { histArr[o + 6] = -1e9; continue; }
        var k = i * 3, l = i * 6;
        histArr[o] = P[k]; histArr[o + 1] = P[k + 1]; histArr[o + 2] = P[k + 2];
        if (HAS[i]) { histArr[o + 3] = LAST[l]; histArr[o + 4] = LAST[l + 1]; histArr[o + 5] = LAST[l + 2]; histArr[o + 9] = LAST[l + 3]; histArr[o + 10] = LAST[l + 4]; histArr[o + 11] = LAST[l + 5]; }
        else { histArr[o + 3] = P[k]; histArr[o + 4] = P[k + 1]; histArr[o + 5] = P[k + 2]; histArr[o + 9] = vclock; histArr[o + 10] = SPD[i]; histArr[o + 11] = HEAT[i]; }
        histArr[o + 6] = vclock; histArr[o + 7] = SPD[i]; histArr[o + 8] = HEAT[i];
        histArr[o + 12] = KIND[i]; histArr[o + 13] = EMPH[i]; histArr[o + 14] = SPAWN[i];
        LAST[l] = P[k]; LAST[l + 1] = P[k + 1]; LAST[l + 2] = P[k + 2]; LAST[l + 3] = vclock; LAST[l + 4] = SPD[i]; LAST[l + 5] = HEAT[i];
        HAS[i] = 1;
      }
      var ib = histGeo.userData.ib;
      ib.updateRange.offset = base * STRIDE; ib.updateRange.count = NMAX * STRIDE;
      ib.needsUpdate = true;
    }
    function writeHeads() {
      for (var i = 0; i < NMAX; i++) {
        if (!ACT[i]) continue;
        var o = i * STRIDE, k = i * 3, l = i * 6;
        headArr[o] = P[k]; headArr[o + 1] = P[k + 1]; headArr[o + 2] = P[k + 2];
        if (HAS[i]) { headArr[o + 3] = LAST[l]; headArr[o + 4] = LAST[l + 1]; headArr[o + 5] = LAST[l + 2]; headArr[o + 9] = LAST[l + 3]; headArr[o + 10] = LAST[l + 4]; headArr[o + 11] = LAST[l + 5]; }
        else { headArr[o + 3] = P[k]; headArr[o + 4] = P[k + 1]; headArr[o + 5] = P[k + 2]; headArr[o + 9] = vclock; headArr[o + 10] = SPD[i]; headArr[o + 11] = HEAT[i]; }
        headArr[o + 6] = vclock; headArr[o + 7] = SPD[i]; headArr[o + 8] = HEAT[i];
        headArr[o + 12] = KIND[i]; headArr[o + 13] = EMPH[i]; headArr[o + 14] = SPAWN[i];
      }
      headGeo.userData.ib.updateRange.count = -1;
      headGeo.userData.ib.needsUpdate = true;
    }
    function clearHistory() {
      for (var o = 0; o < histArr.length; o += STRIDE) { histArr[o + 6] = -1e9; histArr[o + 9] = -1e9; }
      histGeo.userData.ib.updateRange.offset = 0; histGeo.userData.ib.updateRange.count = -1;
      histGeo.userData.ib.needsUpdate = true;
      for (var i = 0; i < NMAX; i++) HAS[i] = 0;
    }
    function advance(dtv) {
      // sub-steps keep the integration accurate on slow frames
      var n = Math.max(1, Math.ceil(dtv / 0.05)), h = dtv / n;
      for (var s = 0; s < n; s++) {
        vclock += h;
        stepParticles(h);
        if (vclock >= nextTick) { tick(); nextTick = vclock + TICK; }
      }
    }
    function prewarm() {
      for (var s = 0; s < 48; s++) advance(0.06);
      needPrewarm = false;
    }

    /* ------------------------------------------------ streamlines (smoke-rake lines with travelling pulses) */
    // seeds: [x, y at the reference plane, reference z, region, kind, level (0 = every density, 1 = alta/media, 2 = alta)]
    var SEEDS = [];
    (function buildSeeds() {
      // left and right planes use interleaved heights, so a side view shows distinct lines instead of doubled ones
      var DYS = [-0.8, -0.46, -0.24, -0.1, 0.03, 0.15, 0.3, 0.52, 0.86], LVS = [2, 1, 0, 0, 0, 0, 0, 1, 2];
      [1.7, 3.6].forEach(function (ax) {
        [-1, 1].forEach(function (sx) {
          DYS.forEach(function (dy, j) {
            SEEDS.push({ x: sx * ax, y: dy, ref: 'wing', reg: ax < BREAK ? REG.flaps : REG.ailerons, kind: 0, lv: LVS[j] });
          });
        });
      });
      [-1, 1].forEach(function (sx) {
        [-0.2, -0.05, 0.1].forEach(function (dy, j) { SEEDS.push({ x: sx * (WB - 0.12), y: dy, ref: 'tip', reg: REG.wingtips, kind: 0, lv: j === 1 ? 0 : 1 }); });
      });
      [0.75, 1.3].forEach(function (ax, ia) {
        [-1, 1].forEach(function (sx) {
          [-0.12, 0.16].forEach(function (dy, j) { SEEDS.push({ x: sx * ax, y: dy + (sx > 0 ? 0.06 : 0), ref: 'tail', reg: REG.tail, kind: 0, lv: (ia + j) % 2 ? 1 : 0 }); });
        });
      });
      [-0.22, 0.22].forEach(function (x, ia) {
        [0.7, 1.12].forEach(function (y, j) { SEEDS.push({ x: x, y: y + ia * 0.12, ref: 'fin', reg: REG.rudder, kind: 0, lv: (ia + j) % 2 ? 1 : 0 }); });
      });
      [-1, 1].forEach(function (sx) {
        [0, Math.PI].forEach(function (ph0, j) { SEEDS.push({ x: sx, y: ph0, ref: 'helix', reg: REG.wingtips, kind: 3, lv: j }); });
      });
      for (var a = 0; a < 4; a++) {
        [0.5, 0.86].forEach(function (rr, j) {
          var an = a / 4 * Math.PI * 2 + j * 0.8;
          SEEDS.push({ x: Math.cos(an) * rr, y: Math.sin(an) * rr, ref: 'prop', reg: REG.prop, kind: 1, lv: (a + j) % 2 ? 1 : 0 });
        });
      }
    })();
    var NL = SEEDS.length, LK = 110;
    var lineGeo = quadGeometry(NL * (LK - 1));
    var lineArr = lineGeo.userData.ib.array;
    for (var li0 = 0; li0 < lineArr.length; li0 += STRIDE) lineArr[li0 + 12] = -1;
    var lineUniforms = {
      uTime: { value: 0 }, uPeriod: { value: 0.85 }, uBase: { value: 0.34 }, uPulse: { value: 1 },
      uWidth: uniforms.uWidth, uView: uniforms.uView, uGlobal: { value: 0 }, uFade: uniforms.uFade, uLight: uniforms.uLight,
      uC0: uniforms.uC0, uC1: uniforms.uC1, uC2: uniforms.uC2, uC3: uniforms.uC3, uC4: uniforms.uC4, uProp: uniforms.uProp, uHeat: uniforms.uHeat, uTip: uniforms.uTip
    };
    var lineMat = new THREE.ShaderMaterial({ uniforms: lineUniforms, vertexShader: LINE_VS, fragmentShader: LINE_FS,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });
    lineMat.toneMapped = false;
    var lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.frustumCulled = false; lineMesh.renderOrder = 11;
    lineMesh.onBeforeRender = histMesh.onBeforeRender;
    group.add(lineMesh);
    var lineHaloMat = new THREE.ShaderMaterial({ uniforms: lineUniforms, vertexShader: LINE_VS, fragmentShader: LINE_FS,
      defines: { HALO: 1 }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending });
    lineHaloMat.toneMapped = false;
    var lineHalo = new THREE.Mesh(lineGeo, lineHaloMat);
    lineHalo.frustumCulled = false; lineHalo.renderOrder = 8;
    lineHalo.onBeforeRender = histMesh.onBeforeRender;
    group.add(lineHalo);
    haloMeshes.push(lineHalo);
    var lineDirty = new Uint8Array(NL), lineRnd = new Float32Array(NL), lineOn = new Uint8Array(NL), lineCursor = 0;
    for (var ln = 0; ln < NL; ln++) { lineDirty[ln] = 1; lineRnd[ln] = rand(); }
    var lastSig = new Float64Array(18), sigNow = new Float64Array(18);
    var _lp = [0, 0, 0], _lq = [0, 0, 0], _lv = [0, 0, 0, 0], _lm = [0, 0, 0, 0];
    function lineStart(sd, out) {
      var U0 = Math.max(1e-3, field.U0), ux = field.U[0] / U0, uy = field.U[1] / U0, uz = Math.max(0.3, field.U[2] / U0);
      var x = sd.x, y, zT;
      if (sd.ref === 'prop') {
        out[0] = x * PROP_R * 1.12; out[1] = field.slipAxisY(HUB[2] - 1.6) + sd.y * PROP_R * 1.12; out[2] = HUB[2] - 1.6;
        return out;
      }
      if (sd.ref === 'wing') { y = wingY(Math.abs(x)) + sd.y; zT = wingLE(Math.abs(x)) - 0.35; }
      else if (sd.ref === 'tip') { y = wingY(WB) + sd.y; zT = wingLE(WB) - 0.3; }
      else if (sd.ref === 'tail') { y = HT_Y + sd.y + field.downwash * 2.4; zT = htLE(Math.abs(x)) - 0.3; }
      else if (sd.ref === 'fin') { y = sd.y + field.downwash * 1.5; zT = finLE(sd.y) - 0.3; }
      else { y = sd.y; zT = 0; }
      var d = (zT - Z0) / uz;
      out[0] = x - ux * d * 0.6; out[1] = y - uy * d; out[2] = Z0;
      return out;
    }
    /**
     * Tip vortex strand: the path of the air leaving the wingtip as it winds around the vortex core (same twist as the
     * helix particles: the pulses travel along it at the visual speed, so the spiral seems to turn and drift back).
     */
    function traceHelix(li) {
      var sd = SEEDS[li], base = li * (LK - 1), side = sd.x, gt = side < 0 ? field.gOutL : field.gOutR;
      var str = clamp(Math.abs(gt) / 0.22, 0, 1), dir = gt >= 0 ? 1 : -1, adv = Math.max(0.2, visK * field.U0 * 0.95);
      var twist = (4.2 + 7 * str) / adv, W = field.dW, L = 8.5, emph = lineEmph(li), rnd = lineRnd[li];
      var dwn = 0.03 * Math.max(0, field.downwash * 3);
      var px = 0, py = 0, pz = 0, pt = 0, ps = 0;
      for (var j = 0; j < LK; j++) {
        var d = L * j / (LK - 1), rad = 0.05 + 0.3 * (1 - Math.exp(-d / 1.7)), ph = sd.y + side * dir * twist * d;
        var x = side * (WB - 0.06) - side * 0.085 * d + W[0] * d + Math.cos(ph) * rad;
        var y = wingY(WB) - 0.02 + W[1] * d - dwn * d + Math.sin(ph) * rad;
        var z = wingLE(WB) + 0.35 + W[2] * d, tau = d / adv, sp = str * smooth(0, 0.6, d);
        if (j > 0) {
          var o = (base + j - 1) * STRIDE;
          lineArr[o] = px; lineArr[o + 1] = py; lineArr[o + 2] = pz; lineArr[o + 3] = x; lineArr[o + 4] = y; lineArr[o + 5] = z;
          lineArr[o + 6] = pt; lineArr[o + 7] = ps; lineArr[o + 8] = 0; lineArr[o + 9] = tau; lineArr[o + 10] = sp; lineArr[o + 11] = 0;
          lineArr[o + 12] = 3; lineArr[o + 13] = emph; lineArr[o + 14] = rnd;
        }
        px = x; py = y; pz = z; pt = tau; ps = sp;
      }
    }
    function traceLine(li) {
      if (SEEDS[li].ref === 'helix') { traceHelix(li); return; }
      var sd = SEEDS[li], base = li * (LK - 1);
      var p = lineStart(sd, _lp), tau = 0, n = 0, inv = 1 / Math.max(field.U0, 0.75 * field.w, 1e-3);
      var px = p[0], py = p[1], pz = p[2], prevX = 0, prevY = 0, prevZ = 0, prevT = 0, prevS = 0, prevH = 0;
      var emph = lineEmph(li), kind = sd.kind, rnd = lineRnd[li];
      for (var j = 0; j < LK; j++) {
        field.velocity(px, py, pz, _lv);
        var sp = Math.sqrt(_lv[0] * _lv[0] + _lv[1] * _lv[1] + _lv[2] * _lv[2]);
        var spd = sp * inv, heat = _lv[3];
        if (j > 0) {
          var o = (base + j - 1) * STRIDE;
          lineArr[o] = prevX; lineArr[o + 1] = prevY; lineArr[o + 2] = prevZ;
          lineArr[o + 3] = px; lineArr[o + 4] = py; lineArr[o + 5] = pz;
          lineArr[o + 6] = prevT; lineArr[o + 7] = prevS; lineArr[o + 8] = prevH;
          lineArr[o + 9] = tau; lineArr[o + 10] = spd; lineArr[o + 11] = heat;
          lineArr[o + 12] = kind; lineArr[o + 13] = emph; lineArr[o + 14] = rnd;
          n = j;
        }
        if (pz > Z_END || sp < 1e-3 || Math.abs(px) > 12 || py < -5 || py > 7) break;
        prevX = px; prevY = py; prevZ = pz; prevT = tau; prevS = spd; prevH = heat;
        var near = Math.abs(px) < 6.2 && pz > -2.6 && pz < 6.2 && py > -1.6 && py < 2.4;
        var ds = near ? (kind === 1 ? 0.09 : 0.13) : 0.34, h = ds / sp;
        field.velocity(px + _lv[0] * h * 0.5, py + _lv[1] * h * 0.5, pz + _lv[2] * h * 0.5, _lm);
        _lq[0] = px; _lq[1] = py; _lq[2] = pz;
        _lp[0] = px + _lm[0] * h; _lp[1] = py + _lm[1] * h; _lp[2] = pz + _lm[2] * h;
        field.constrain(_lp, _lq);
        px = _lp[0]; py = _lp[1]; pz = _lp[2];
        tau += h / Math.max(0.2, visK);
      }
      for (var k = n; k < LK - 1; k++) lineArr[(base + k) * STRIDE + 12] = -1;
    }
    function hideLine(li) {
      var base = li * (LK - 1);
      for (var k = 0; k < LK - 1; k++) lineArr[(base + k) * STRIDE + 12] = -1;
    }
    var camSide = -1;   // side of the airplane the camera is on (body x sign): the far-side wing lines are dimmer
    function lineEmph(li) {
      var set = focusName ? FOCUS[focusName] : null, sd = SEEDS[li];
      if (set) return set.indexOf(sd.reg) >= 0 ? 1.25 : 0.14;
      if (sd.ref === 'helix') return sd.x * camSide < 0 ? 0.6 : 1;
      return (sd.ref === 'wing' || sd.ref === 'tip') && sd.x * camSide < 0 ? 0.42 : 1;
    }
    function lineWanted(li) {
      var sd = SEEDS[li];
      if (!field.active || sd.lv > (2 - level)) return false;
      if (sd.kind === 1) return settings.propwash && field.w > 0.04;
      if (sd.kind === 3) return settings.vortices && field.U0 > 0.15;
      return settings.streamlines && field.U0 > 0.15;
    }
    var _cs = new V3();
    function updateCamSide() {
      if (!ext || !ext.camera) return;
      body.updateMatrixWorld();
      _cs.setFromMatrixPosition(ext.camera.matrixWorld); body.worldToLocal(_cs);
      var side = _cs.x > 0.6 ? 1 : (_cs.x < -0.6 ? -1 : camSide);
      if (side !== camSide) { camSide = side; lineFocus(); }
    }
    function updateLines() {
      updateCamSide();
      // signature of everything the lines depend on: recompute (a few lines per frame) when it changes
      var f = field;
      sigNow[0] = f.alpha; sigNow[1] = f.beta; sigNow[2] = f.U0; sigNow[3] = f.gIn; sigNow[4] = f.gOutL; sigNow[5] = f.gOutR;
      sigNow[6] = f.gFlap; sigNow[7] = f.gTail; sigNow[8] = f.w; sigNow[9] = f.swirl; sigNow[10] = f.df; sigNow[11] = f.daL;
      sigNow[12] = f.daR; sigNow[13] = f.de; sigNow[14] = f.dr; sigNow[15] = f.stall; sigNow[16] = visK; sigNow[17] = level;
      var changed = false;
      for (var i = 0; i < 18; i++) if (Math.abs(sigNow[i] - lastSig[i]) > 2e-4 * (1 + Math.abs(lastSig[i]))) { changed = true; break; }
      if (changed) { lastSig.set(sigNow); for (var a = 0; a < NL; a++) lineDirty[a] = 1; }
      var stallLive = f.stall > 0.04;
      var budget = [24, 16, 10][level], done = 0, any = false;
      for (var c = 0; c < NL && done < budget; c++) {
        var li = (lineCursor + c) % NL, want = lineWanted(li);
        if (!want) { if (lineOn[li]) { hideLine(li); lineOn[li] = 0; any = true; } lineDirty[li] = 0; continue; }
        var live = stallLive && (SEEDS[li].reg === REG.flaps || SEEDS[li].reg === REG.ailerons);
        if (lineDirty[li] || !lineOn[li] || live) { traceLine(li); lineDirty[li] = 0; lineOn[li] = 1; done++; any = true; }
      }
      lineCursor = (lineCursor + Math.max(1, done)) % NL;
      if (any) { lineGeo.userData.ib.updateRange.offset = 0; lineGeo.userData.ib.updateRange.count = -1; lineGeo.userData.ib.needsUpdate = true; }
    }
    function lineFocus() {
      for (var li = 0; li < NL; li++) {
        var e = lineEmph(li), base = li * (LK - 1);
        for (var k = 0; k < LK - 1; k++) lineArr[(base + k) * STRIDE + 13] = e;
      }
      lineGeo.userData.ib.updateRange.offset = 0; lineGeo.userData.ib.updateRange.count = -1; lineGeo.userData.ib.needsUpdate = true;
    }

    /* ------------------------------------------------ pressure tint */
    var tintMat = new THREE.ShaderMaterial({
      uniforms: { uCl: { value: new THREE.Vector2() }, uFlap: { value: 0 }, uStall: { value: 0 }, uTime: { value: 0 }, uOp: { value: 0 },
        uLow: { value: col(0x2f86ff) }, uHigh: { value: col(0xff4a3a) }, uSep: { value: col(0xff6a1f) } },
      vertexShader: TINT_VS, fragmentShader: TINT_FS, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
    });
    tintMat.toneMapped = false;
    var tintMeshes = [];
    function wingPt(sx, s, xc, yc) {
      if (geom && geom.wingPoint) return geom.wingPoint(sx, s, xc, yc);
      var c = wingC(s), inc = wingInc(s), xi = (xc - 0.25) * c, eta = yc * c;
      return new V3(sx * s, wingY(s) + eta * Math.cos(inc) - xi * Math.sin(inc), wingLE(s) + 0.25 * c + eta * Math.sin(inc) + xi * Math.cos(inc));
    }
    function tintGrid(sx, s0, s1, x0, x1, upper, origin) {
      var nS = 22, nC = 16, pos = [], info = [], idx = [];
      for (var i = 0; i <= nS; i++) {
        var s = s0 + (s1 - s0) * i / nS;
        for (var j = 0; j <= nC; j++) {
          var t = j / nC, xc = x0 + (x1 - x0) * (1 - Math.cos(t * Math.PI / 2));
          if (x0 > 0.5) xc = x0 + (x1 - x0) * t;
          var f = naca(0.02, 0.4, 0.12, xc), yc = upper ? f.c + f.t + 0.004 : f.c - f.t - 0.004;
          var p = wingPt(sx, s, xc, yc);
          if (origin) p.sub(origin);
          pos.push(p.x, p.y, p.z);
          info.push(xc, upper ? 1 : -1, s / WB, sx);
        }
      }
      for (i = 0; i < nS; i++) for (var j2 = 0; j2 < nC; j2++) {
        var a = i * (nC + 1) + j2, b = a + nC + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
      g.setIndex(idx);
      return g;
    }
    (function buildTint() {
      var surf = ext && ext.surfaces;
      var cgv = new V3(0, CGY, CGZ);
      [-1, 1].forEach(function (sx) {
        [true, false].forEach(function (up) {
          var m = new THREE.Mesh(tintGrid(sx, 0.12, WB - 0.04, 0, 0.735, up, null), tintMat);
          m.renderOrder = 3; group.add(m); tintMeshes.push(m);
          // aft part of the root and tip (no movable surface there)
          [[0.12, FLAP_IN - 0.01], [AIL_OUT + 0.01, WB - 0.04]].forEach(function (r) {
            var m2 = new THREE.Mesh(tintGrid(sx, r[0], r[1], 0.735, 1, up, null), tintMat);
            m2.renderOrder = 3; group.add(m2); tintMeshes.push(m2);
          });
          // flap and aileron: built in their hinge-group frames so they follow the deflection
          [['flap', FLAP_IN + 0.02, BREAK - 0.02, 0.73], ['aileron', BREAK + 0.02, AIL_OUT - 0.02, 0.76]].forEach(function (d) {
            var hg = surf && surf[d[0] + (sx < 0 ? 'L' : 'R')];
            var origin = null, parent = group;
            if (hg) {
              origin = (hg.userData.base || hg.position).clone().sub(cgv);
              parent = hg;
            }
            var m3 = new THREE.Mesh(tintGrid(sx, d[1], d[2], d[3], 1, up, origin), tintMat);
            m3.renderOrder = 3; parent.add(m3); tintMeshes.push(m3);
          });
        });
      });
    })();
    function setTintVisible(v) { tintMeshes.forEach(function (m) { m.visible = v; }); }

    /* ------------------------------------------------ force arrows */
    var arrowSet = [];
    function makeArrow(color, radius) {
      var g = new THREE.Group();
      var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false });
      var gmat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
      var omat = new THREE.MeshBasicMaterial({ color: 0x0b131b, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, side: THREE.BackSide });
      [mat, gmat, omat].forEach(function (m) { m.toneMapped = false; });
      function parts(r, m, ro) {
        var shaftG = new THREE.CylinderGeometry(r, r, 1, 16, 1, true); shaftG.translate(0, 0.5, 0);
        var headG = new THREE.ConeGeometry(r * 2.6, radius * 7.5 + (r - radius) * 2, 20); headG.translate(0, 0, 0);
        var sh = new THREE.Mesh(shaftG, m), hd = new THREE.Mesh(headG, m);
        sh.renderOrder = hd.renderOrder = ro;
        var gg = new THREE.Group(); gg.add(sh); gg.add(hd);
        gg.userData = { shaft: sh, head: hd, hl: radius * 7.5 };
        return gg;
      }
      var core = parts(radius, mat, 27), glowP = parts(radius * 2.3, gmat, 26), outl = parts(radius * 1.35, omat, 25);
      g.add(outl); g.add(glowP); g.add(core);
      g.userData = { core: core, glow: glowP, outline: outl, mat: mat, gmat: gmat, omat: omat, len: 1 };
      arrowSet.push(g);
      return g;
    }
    function setArrowLen(g, len) {
      g.userData.len = len;
      [g.userData.core, g.userData.glow, g.userData.outline].forEach(function (p) {
        var hl = p.userData.hl, sl = Math.max(0.001, len - hl);
        p.userData.shaft.scale.y = sl;
        p.userData.head.position.y = sl + hl / 2;
      });
    }
    function setArrowOpacity(g, a) {
      g.userData.mat.opacity = 0.96 * a; g.userData.gmat.opacity = 0.22 * a; g.userData.omat.opacity = 0.45 * a;
      g.visible = a > 0.01;
    }
    var FORCE_COL = { lift: 0x4db8ff, weight: 0xffd24d, thrust: 0x5cf2a2, drag: 0xff6464, tail: 0xc792ff };
    var FORCE_CSS = { lift: '#4DB8FF', weight: '#FFD24D', thrust: '#5CF2A2', drag: '#FF6464', tail: '#C792FF' };
    var forces = {
      lift: makeArrow(FORCE_COL.lift, 0.055), liftL: makeArrow(FORCE_COL.lift, 0.045), liftR: makeArrow(FORCE_COL.lift, 0.045),
      weight: makeArrow(FORCE_COL.weight, 0.055), thrust: makeArrow(FORCE_COL.thrust, 0.05), drag: makeArrow(FORCE_COL.drag, 0.05),
      tail: makeArrow(FORCE_COL.tail, 0.035)
    };
    var forceGroup = new THREE.Group(); group.add(forceGroup);
    ['lift', 'liftL', 'liftR', 'thrust', 'drag', 'tail'].forEach(function (k) { forceGroup.add(forces[k]); });
    var weightGroup = new THREE.Group(); sceneGroup.add(weightGroup); weightGroup.add(forces.weight);
    function label(text, style, k, dot) {
      if (ext && ext.makeLabel) return ext.makeLabel(text, style, k, dot);
      var sp = new THREE.Object3D(); sp.userData = { text: text }; return sp;
    }
    function setLabel(sp, text) { if (sp.userData.text === text) return; if (ext && ext.setLabelText) ext.setLabelText(sp, text); else sp.userData.text = text; }
    var labels = {
      lift: label('Sustentación', 'dark', 1.05, FORCE_CSS.lift), liftL: label('Sust. izq.', 'dark', 0.95, FORCE_CSS.lift),
      liftR: label('Sust. der.', 'dark', 0.95, FORCE_CSS.lift), weight: label('Peso', 'dark', 1.05, FORCE_CSS.weight),
      thrust: label('Empuje', 'dark', 1.0, FORCE_CSS.thrust), drag: label('Resistencia', 'dark', 1.0, FORCE_CSS.drag),
      tail: label('Cola', 'dark', 0.9, FORCE_CSS.tail),
      roll: label('', 'accent', 1.0), pitch: label('', 'accent', 1.0), yaw: label('', 'accent', 1.0),
      low: label('Baja presión', 'dark', 0.9, '#3F8CFF'), high: label('Alta presión', 'dark', 0.9, '#FF4A3A')
    };
    ['lift', 'liftL', 'liftR', 'thrust', 'drag', 'tail', 'roll', 'pitch', 'yaw', 'low', 'high'].forEach(function (k) { group.add(labels[k]); labels[k].visible = false; });
    weightGroup.add(labels.weight); labels.weight.visible = false;
    var labelTimer = 0;

    /* ------------------------------------------------ moment arcs */
    function arcMesh(f, a0, a1, tube) {
      var curve = new THREE.Curve();
      curve.getPoint = function (t, out) { return f(a0 + (a1 - a0) * t, out || new V3()); };
      var mat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: col(0xf08a3c) }, uOp: { value: 0 }, uPhase: { value: 0 } },
        vertexShader: ARC_VS, fragmentShader: ARC_FS, transparent: true, depthTest: false, depthWrite: false });
      var g = new THREE.Group();
      var m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, tube, 8, false), mat);
      m.renderOrder = 28;
      g.add(m);
      var end = f(a1, new V3()), prev = f(a1 - (a1 - a0) * 0.02, new V3());
      var dir = end.clone().sub(prev).normalize();
      var hm = new THREE.MeshBasicMaterial({ color: 0xf08a3c, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      hm.toneMapped = false;
      var head = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.4, tube * 9, 16), hm);
      head.position.copy(end).addScaledVector(dir, tube * 3);
      head.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
      head.renderOrder = 28;
      g.add(head);
      g.userData = { mat: mat, hm: hm, end: end, phase: 0 };
      g.visible = false;
      group.add(g);
      return g;
    }
    var arcs = {
      // base arcs: roll LEFT (counter-clockwise seen from behind), nose UP, nose RIGHT; mirrored for the other sign
      roll: arcMesh(function (a, o) { return o.set(Math.cos(a) * 1.7, 0.35 + Math.sin(a) * 1.7, 6.1); }, 50 * DEG, 130 * DEG, 0.038),
      pitch: arcMesh(function (a, o) { return o.set(0, Math.sin(a) * 2.75, -Math.cos(a) * 2.75); }, -19 * DEG, 19 * DEG, 0.034),
      yaw: arcMesh(function (a, o) { return o.set(Math.sin(a) * 3.1, -0.9, -Math.cos(a) * 3.1); }, -21 * DEG, 21 * DEG, 0.034)
    };
    var ARC_TEXT = {
      roll: ['se inclina a la izquierda', 'se inclina a la derecha'], pitch: ['baja la nariz', 'sube la nariz'],
      yaw: ['la nariz va a la izquierda', 'la nariz va a la derecha']
    };
    var arcLabelPos = { roll: new V3(0, 2.4, 6.1), pitch: new V3(0, 1.35, -3.0), yaw: new V3(0, -1.35, -3.3) };

    /* ------------------------------------------------ angle of attack: chord line, relative wind, arc + label */
    // drawn just outboard of the wingtip on the camera side (the tip chord has no washout: parallel to the body axis)
    var aoaGroup = new THREE.Group();
    aoaGroup.visible = false;
    group.add(aoaGroup);
    var aoaMatW = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    var aoaMatA = new THREE.MeshBasicMaterial({ color: 0xf08a3c, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    var aoaMatC = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false });
    [aoaMatW, aoaMatA, aoaMatC].forEach(function (m) { m.toneMapped = false; });
    function rodBetween(mesh, a, b) {
      var d = _tmpV.copy(b).sub(a), len = d.length();
      mesh.position.copy(a).addScaledVector(d, 0.5);
      mesh.scale.set(1, Math.max(1e-3, len), 1);
      mesh.quaternion.setFromUnitVectors(_up, d.normalize());
    }
    var AOA_R = 1.35;
    var chordRod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 8, 1, true), aoaMatC);
    var windRod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 10, 1, true), aoaMatW);
    var windHead = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 16), aoaMatW);
    var arcTube = new THREE.Mesh(new THREE.BufferGeometry(), aoaMatA);
    [chordRod, windRod, windHead, arcTube].forEach(function (m) { m.renderOrder = 29; aoaGroup.add(m); });
    var aoaLabel = label('Ángulo de ataque', 'accent', 1.0);
    var windTag = label('Viento relativo', 'light', 0.85);
    aoaGroup.add(aoaLabel); aoaGroup.add(windTag);
    var aoaShown = NaN, aoaSide = 0;
    var _a0 = new V3(), _a1 = new V3(), _cam = new V3();
    function updateAoa(show) {
      aoaGroup.visible = show;
      aoaLabel.visible = windTag.visible = show && labelsOn;
      if (!show) return;
      // camera side (body frame)
      body.updateMatrixWorld();
      if (ext && ext.camera) { _cam.setFromMatrixPosition(ext.camera.matrixWorld); body.worldToLocal(_cam); }
      var side = _cam.x > 0 ? 1 : -1;
      // only from (roughly) the side: seen end-on the chord / wind lines would just cross the airplane
      var sideK = smooth(0.83, 0.95, Math.abs(_cam.x) / (Math.hypot(_cam.x, _cam.z - 0.5) || 1));
      aoaMatW.opacity = 0.9 * sideK; aoaMatA.opacity = 0.95 * sideK; aoaMatC.opacity = 0.45 * sideK;
      aoaGroup.visible = sideK > 0.02;
      aoaLabel.visible = sideK > 0.4 && labelsOn;
      windTag.visible = aoaLabel.visible && !(ext && ext.backdrop === 'tunel');   // the tunnel stage has its own wind label
      if (!aoaGroup.visible) return;
      var aDeg = field.alpha / DEG;
      var le = wingLE(WB - 0.1), te = le + wingC(WB - 0.1), x = side * (WB + 0.35), y = wingY(WB);
      if (Math.abs(aDeg - aoaShown) < 0.05 && side === aoaSide) return;
      aoaShown = aDeg; aoaSide = side;
      var a = field.alpha, P0v = _a0.set(x, y, le);
      // chord line (extended ahead of the leading edge) and the incoming relative wind
      rodBetween(chordRod, _a1.set(x, y, le - AOA_R - 0.5), _tmpV.set(x, y, te + 0.35));
      var wx = 0, wy = -Math.sin(a), wz = -Math.cos(a);   // pointing upstream (where the wind comes from)
      var far = new V3(x, y + wy * 2.1, le + wz * 2.1), tip = new V3(x, y + wy * 0.2, le + wz * 0.2);
      rodBetween(windRod, far, tip);
      windHead.position.copy(tip).addScaledVector(_tmpV.set(0, -wy, -wz), -0.03);
      windHead.quaternion.setFromUnitVectors(_up, _tmpV.set(0, -wy, -wz));
      // arc from the chord direction (-z) to the wind direction
      var pts = [], n = 24;
      for (var i = 0; i <= n; i++) {
        var t = a * i / n;
        pts.push(new V3(x, y - Math.sin(t) * AOA_R, le - Math.cos(t) * AOA_R));
      }
      if (Math.abs(a) > 0.004) {
        arcTube.geometry.dispose();
        arcTube.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 8, false);
        arcTube.visible = true;
      } else arcTube.visible = false;
      setLabel(aoaLabel, 'Ángulo de ataque ' + (Math.round(aDeg * 10) / 10).toFixed(Math.abs(aDeg) < 10 ? 1 : 0).replace('.', ',') + '°');
      aoaLabel.position.set(x + side * 0.1, y - Math.sin(a / 2) * AOA_R - 0.32, le - Math.cos(a / 2) * AOA_R - 0.5);
      windTag.position.set(x, y + wy * 2.1 - 0.25, le + wz * 2.1);
      void P0v; void wx;
    }

    /* ------------------------------------------------ propeller disc glow (thrust) */
    var propRing = (function () {
      var c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      var mat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide });
      if (c) {
        c.width = c.height = 256;
        var g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.83, 'rgba(255,255,255,0.55)');
        gr.addColorStop(0.9, 'rgba(255,255,255,1)'); gr.addColorStop(0.97, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
        mat.map = new THREE.CanvasTexture(c);
        mat.map.encoding = THREE.sRGBEncoding;
      }
      mat.toneMapped = false;
      var m = new THREE.Mesh(new THREE.PlaneGeometry(PROP_R * 2.15, PROP_R * 2.15), mat);
      m.position.set(HUB[0], HUB[1], HUB[2] + 0.05);
      m.renderOrder = 13;
      group.add(m);
      return m;
    })();
    var propPulse = 0;
    function updatePropRing(dt) {
      var tKg = Math.max(0, num(ae.thrustN, 0)) / G, k = smooth(4, 160, tKg);
      var on = settings.propwash && k > 0.01 && globalA > 0.01;
      propRing.visible = on;
      if (!on) return;
      propPulse += dt * (2 + 6 * k);
      propRing.material.opacity = globalA * k * (0.55 + 0.12 * Math.sin(propPulse)) * (lastLight ? 0.6 : 1);
      var sc = 1 + 0.04 * Math.sin(propPulse * 0.5);
      propRing.scale.set(sc, sc, 1);
    }

    /* ------------------------------------------------ flight trails (scene frame) */
    var TRAIL_PTS = 110, TRAIL_DT = 0.05;
    var trailUniforms = {};
    for (var key in uniforms) trailUniforms[key] = uniforms[key];
    trailUniforms.uTrail = { value: TRAIL_PTS * TRAIL_DT };
    trailUniforms.uFade = { value: new THREE.Vector4(-1e4, -1e4 + 1, 1e4, 1e4 + 1) };
    var trailMat = new THREE.ShaderMaterial({ uniforms: trailUniforms, vertexShader: STREAK_VS, fragmentShader: STREAK_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    trailMat.toneMapped = false;
    var trailGeo = quadGeometry(2 * TRAIL_PTS);
    var trailMesh = new THREE.Mesh(trailGeo, trailMat);
    trailMesh.frustumCulled = false; trailMesh.renderOrder = 11;
    sceneGroup.add(trailMesh);
    var trail = { pts: [new Float32Array(TRAIL_PTS * 4), new Float32Array(TRAIL_PTS * 4)], n: 0, head: 0, next: 0, on: false };
    var _tip = new V3();
    function updateTrails(dt, dtv, on) {
      var arr = trailGeo.userData.ib.array;
      if (!on) {
        if (trail.on) { for (var o = 0; o < arr.length; o += STRIDE) { arr[o + 6] = -1e9; arr[o + 9] = -1e9; } trailGeo.userData.ib.needsUpdate = true; trail.n = 0; }
        trail.on = false;
        trailMesh.visible = false;
        return;
      }
      trail.on = true; trailMesh.visible = true;
      var air = (lastState && lastState.air) || {};
      var V = Math.max(1, num(ae.tas, 0) * KT), kv = visK * field.U0 / V;   // scene metres per real metre of flight
      var turn = num(air.turnRate, 0) * DEG * kv / Math.max(1e-6, kv) * dtv;  // the visual path keeps the real turn radius
      turn = num(air.turnRate, 0) * DEG * dtv * (visK * field.U0) / V;
      var climb = num(air.vs, 0) / 196.85 * kv * dtv, back = visK * field.U0 * dtv;
      var c = Math.cos(turn), s = Math.sin(turn);
      for (var t = 0; t < 2; t++) {
        var pts = trail.pts[t];
        for (var j = 0; j < trail.n; j++) {
          var q = j * 4, x = pts[q], z = pts[q + 2];
          // a right turn swings the old path toward the inside of the turn (dp/dt = -v + r ŷ×p)
          pts[q] = x * c + z * s; pts[q + 2] = -x * s + z * c + back; pts[q + 1] -= climb;
        }
      }
      if (vclock >= trail.next) {
        trail.next = vclock + TRAIL_DT;
        for (var t2 = 0; t2 < 2; t2++) {
          var p2 = trail.pts[t2];
          p2.copyWithin(4, 0, (TRAIL_PTS - 1) * 4);
          _tip.set(t2 ? WB - 0.05 : -WB + 0.05, wingY(WB), wingLE(WB) + 0.8);
          body.updateMatrixWorld();
          _tip.applyMatrix4(body.matrixWorld);
          scene.worldToLocal ? scene.worldToLocal(_tip) : null;
          p2[0] = _tip.x; p2[1] = _tip.y; p2[2] = _tip.z; p2[3] = vclock;
        }
        trail.n = Math.min(TRAIL_PTS, trail.n + 1);
      }
      for (var t3 = 0; t3 < 2; t3++) {
        var p3 = trail.pts[t3];
        for (var j2 = 0; j2 < TRAIL_PTS; j2++) {
          var o2 = (t3 * TRAIL_PTS + j2) * STRIDE;
          if (j2 >= trail.n - 1 || j2 === 0 && trail.n < 2) { arr[o2 + 6] = -1e9; arr[o2 + 9] = -1e9; continue; }
          var a = j2 * 4, b = (j2 + 1) * 4;
          arr[o2] = p3[a]; arr[o2 + 1] = p3[a + 1]; arr[o2 + 2] = p3[a + 2];
          arr[o2 + 3] = p3[b]; arr[o2 + 4] = p3[b + 1]; arr[o2 + 5] = p3[b + 2];
          arr[o2 + 6] = p3[a + 3]; arr[o2 + 7] = 1; arr[o2 + 8] = 0;
          arr[o2 + 9] = p3[b + 3]; arr[o2 + 10] = 1; arr[o2 + 11] = 0;
          arr[o2 + 12] = 4; arr[o2 + 13] = 1; arr[o2 + 14] = -1e3;
        }
        // the newest segment joins the current wingtip
      }
      trailGeo.userData.ib.updateRange.count = -1;
      trailGeo.userData.ib.needsUpdate = true;
    }

    /* ------------------------------------------------ focus */
    function applyEmphasis() {
      var set = focusName ? FOCUS[focusName] : null;
      for (var i = 0; i < NMAX; i++) {
        EMPH[i] = !set ? 1 : (set.indexOf(REGN[i]) >= 0 ? 1.25 : 0.14);
        if (focusName === 'stall' && KIND[i] === 2) EMPH[i] = 1.25;
      }
      for (var o = 0, n = histArr.length / STRIDE; o < n; o++) histArr[o * STRIDE + 13] = EMPH[o % NMAX];
      lineFocus();
      histGeo.userData.ib.updateRange.offset = 0; histGeo.userData.ib.updateRange.count = -1;
      histGeo.userData.ib.needsUpdate = true;
    }

    /* ------------------------------------------------ per-frame update */
    var lastState = null, lastCtx = {};
    var _tmpV = new V3(), _up = new V3(0, 1, 0);
    function effLevel(ctx) {
      var lv = LEVEL[settings.density] != null ? LEVEL[settings.density] : 0;
      if (ctx && ctx.quality && LEVEL[ctx.quality] != null) lv = Math.max(lv, LEVEL[ctx.quality]);
      if (ctx && ctx.inset) lv = 2;
      if (reducedMotion()) lv = Math.min(2, lv + 1);
      return lv;
    }
    function update(state, dt, ctx) {
      state = state || {};
      ctx = ctx || {};
      dt = clamp(num(dt, 0), 0, 0.1);
      lastState = state; lastCtx = ctx;
      var target = settings.enabled ? 1 : 0;
      globalA += (target - globalA) * (dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1);
      if (!settings.enabled && globalA < 0.01) {
        group.visible = false; sceneGroup.visible = false;
        if (ext) ext.flowTimeScale = 1;
        return;
      }
      group.visible = true; sceneGroup.visible = true;
      // light / dark backdrop
      var light = !(ext && ext.backdrop === 'tunel');
      if ((light ? 1 : 0) !== lastLight) { lastLight = light ? 1 : 0; setPalette(light); }

      // aero snapshot + the displayed surfaces (match what the student sees)
      snapshot(state, ae);
      var d = ext && ext.disp;
      var sf = state.surfaces || surfacesOf(state);
      sfDisp.aileronL = d ? d.aileronL : num(sf.aileronL, 0); sfDisp.aileronR = d ? d.aileronR : num(sf.aileronR, 0);
      sfDisp.elevator = d ? d.elevator : num(sf.elevator, 0); sfDisp.rudder = d ? d.rudder : num(sf.rudder, 0);
      sfDisp.flaps = d ? d.flaps : num(state.flaps, 0);
      var air = state.air || {}, tun = !!(state.tunnel && state.tunnel.on);
      var Vms = Math.max(0.1, num(ae.tas, 0) * KT);
      var gamma = tun ? 0 : Math.asin(clamp(num(air.vs, 0) / 196.85 / Vms, -0.5, 0.5)) / DEG;
      var pitchShown = d ? d.pitch + d.stance : num(air.pitch, 0);
      var alphaB = tun ? pitchShown : (air.onGround === false ? pitchShown - gamma : pitchShown);
      if (num(ae.tas, 0) < 3) alphaB = pitchShown;
      field.configure(ae, sfDisp, { alphaDeg: alphaB, betaDeg: tun ? num(ae.beta, 0) : 0, time: vclock });

      // visual time scale
      var refKt = field.Vref / KT;
      var uvis = ext && ext.visWindSpeed ? ext.visWindSpeed(refKt) : (refKt > 0.5 ? 1.6 + 0.032 * Math.min(refKt, 160) : 0);
      visK = Math.max(0.6, uvis);
      var slow = clamp(num(settings.slowmo, 1), 0.2, 1) * (reducedMotion() ? 0.5 : 1);
      if (ext) ext.flowTimeScale = slow;
      var dtv = dt * slow;

      // density
      var lv = effLevel(ctx);
      if (lv !== level) { level = lv; }
      refreshActivity();
      if (needPrewarm && field.active) { clearHistory(); prewarm(); }
      advance(dtv);
      writeHeads();
      uniforms.uTime.value = vclock;
      uniforms.uGlobal.value = globalA * (field.active ? 1 : 0.0);
      histMesh.visible = headMesh.visible = settings.streamlines || settings.propwash || settings.vortices;
      updateLines();
      lineUniforms.uTime.value = vclock % (lineUniforms.uPeriod.value * 1000);
      lineUniforms.uGlobal.value = globalA * (field.active ? 1 : 0);
      lineMesh.visible = settings.streamlines || settings.propwash || settings.vortices;
      haloMeshes[0].visible = haloMeshes[1].visible = histMesh.visible && haloMeshes[0].userData.allowed !== false;
      haloMeshes[2].visible = lineMesh.visible && haloMeshes[2].userData.allowed !== false;

      // pressure tint
      var showTint = settings.pressure && field.active && field.U0 > 0.15;
      setTintVisible(showTint);
      if (showTint) {
        var q = Math.max(1, num(ae.q, 0)), halfQ = q * S_WING / 2, fl = Math.max(0, num(ae.flapLiftN, 0)) / 2;
        tintMat.uniforms.uCl.value.set((num(ae.liftLN, 0) - fl) / halfQ, (num(ae.liftRN, 0) - fl) / halfQ);
        tintMat.uniforms.uFlap.value = fl / halfQ * 1.1;
        tintMat.uniforms.uStall.value = num(ae.stallBlend, 0);
        tintMat.uniforms.uTime.value = vclock;
        tintMat.uniforms.uOp.value = globalA * (light ? 0.85 : 1);
      }
      // forces + moments + labels
      labelsOn = !ctx.inset;
      updateForces(dt, light);
      updateMoments(dt);
      var pressLab = showTint && labelsOn;
      labels.low.visible = pressLab; labels.high.visible = pressLab;
      updateAoa(settings.forces && field.U0 > 0.15 && globalA > 0.01);
      updatePropRing(dt);
      if (pressLab) {
        var ps = camSide;   // on the wing nearer to the camera
        labels.low.position.set(ps * 3.0, wingY(3.0) + 0.5, 0.15); labels.high.position.set(ps * 3.0, wingY(3.0) - 0.6, 0.35);
      }
      // flight trails: only when really flying (not in the tunnel, not on the ground)
      updateTrails(dt, dtv, settings.trails && !tun && air.onGround === false && field.U0 > 0.15);
    }

    var _L = new V3();
    function kg(n) { return Math.round(n / G); }
    function arrowLen(kgf) { return clamp(0.11 * Math.sqrt(Math.max(0, kgf)), 0.22, 3.4); }
    function updateForces(dt, light) {
      var show = settings.forces && globalA > 0.01;
      Object.keys(forces).forEach(function (k) { if (!show) forces[k].visible = false; });
      ['lift', 'liftL', 'liftR', 'weight', 'thrust', 'drag', 'tail'].forEach(function (k) { if (!show) labels[k].visible = false; });
      if (!show) return;
      var a = field.alpha, ga = globalA;
      var lift = Math.max(0, num(ae.liftN, 0)), lL = num(ae.liftLN, 0), lR = num(ae.liftRN, 0);
      var lKg = lift / G, wKg = num(ae.weightN, WEIGHT) / G, tKg = Math.max(0, num(ae.thrustN, 0)) / G, dKg = Math.max(0, num(ae.dragN, 0)) / G;
      var tailKg = num(ae.tailN, 0) / G;
      // lift ⟂ relative wind (in the symmetry plane): (0, cos α, -sin α) in the body frame
      _L.set(0, Math.cos(a), -Math.sin(a));
      var split = lift > 50 ? smooth(0.02, 0.05, Math.abs(lL - lR) / Math.max(lift, 1)) : 0;
      var lenL = arrowLen(lKg);
      forces.lift.position.set(0, wingY(0) + 0.14, -0.05);
      forces.lift.quaternion.setFromUnitVectors(_up, _L);
      setArrowLen(forces.lift, lenL);
      setArrowOpacity(forces.lift, ga * smooth(5, 40, lKg) * (1 - split));
      var mean = (lL + lR) / 2;
      ['liftL', 'liftR'].forEach(function (k, i) {
        var lv = i ? lR : lL, sx = i ? 1 : -1;
        var exag = mean > 1 ? 1 + 2.5 * (lv - mean) / mean : 1;
        var len = arrowLen(Math.max(0, mean) / G) * 0.85 * clamp(exag, 0.15, 2.2);
        forces[k].position.set(sx * 2.4, wingY(2.4) + 0.12, -0.05);
        forces[k].quaternion.setFromUnitVectors(_up, _L);
        setArrowLen(forces[k], len);
        setArrowOpacity(forces[k], ga * split * smooth(5, 40, lKg));
        labels[k].visible = forces[k].visible && labelsOn;
        labels[k].position.copy(forces[k].position).addScaledVector(_L, len + 0.32);
      });
      labels.lift.visible = forces.lift.visible && labelsOn;
      labels.lift.position.copy(forces.lift.position).addScaledVector(_L, lenL + 0.35);
      // weight: straight down in the scene (world), from the CG
      var lenW = arrowLen(wKg);
      forces.weight.position.set(0, -0.05, 0);
      forces.weight.quaternion.setFromUnitVectors(_up, _tmpV.set(0, -1, 0));
      setArrowLen(forces.weight, lenW);
      setArrowOpacity(forces.weight, ga);
      labels.weight.visible = labelsOn;
      labels.weight.position.set(0, -0.05 - lenW - 0.3, 0);
      // thrust along the propeller axis, forward from the spinner
      var lenT = arrowLen(tKg);
      forces.thrust.position.set(0, HUB[1], HUB[2] - 0.26);
      forces.thrust.quaternion.setFromUnitVectors(_up, _tmpV.set(0, 0, -1));
      setArrowLen(forces.thrust, lenT);
      setArrowOpacity(forces.thrust, ga * smooth(2, 12, tKg));
      labels.thrust.visible = forces.thrust.visible && labelsOn;
      labels.thrust.position.set(0, HUB[1] + 0.3, HUB[2] - 0.26 - lenT - 0.25);
      // drag along the relative wind, behind the tail
      var lenD = arrowLen(dKg), U = field.U, un = Math.hypot(U[0], U[1], U[2]) || 1;
      _tmpV.set(U[0] / un, U[1] / un, U[2] / un);
      if (field.U0 < 0.05) _tmpV.set(0, 0, 1);
      forces.drag.position.set(0, 0.22, 5.35);
      forces.drag.quaternion.setFromUnitVectors(_up, _tmpV);
      setArrowLen(forces.drag, lenD);
      setArrowOpacity(forces.drag, ga * smooth(2, 10, dKg));
      labels.drag.visible = forces.drag.visible && labelsOn;
      labels.drag.position.set(0, 0.6, 5.35).addScaledVector(_tmpV, lenD + 0.2);
      // horizontal tail force (usually a small down force)
      var lenTl = arrowLen(Math.abs(tailKg)) * 0.8, tdir = tailKg >= 0 ? 1 : -1;
      forces.tail.position.set(0, HT_Y + (tdir > 0 ? 0.06 : -0.06), 4.0);
      forces.tail.quaternion.setFromUnitVectors(_up, _tmpV.set(0, tdir * Math.cos(a), -tdir * Math.sin(a)));
      setArrowLen(forces.tail, lenTl);
      setArrowOpacity(forces.tail, ga * smooth(4, 15, Math.abs(tailKg)));
      labels.tail.visible = forces.tail.visible && labelsOn;
      labels.tail.position.set(0.9, HT_Y + tdir * (lenTl + 0.25), 4.0);
      // texts (≤ 5 Hz)
      labelTimer -= dt;
      if (labelTimer <= 0) {
        labelTimer = 0.2;
        setLabel(labels.lift, 'Sustentación ' + Math.round(lKg) + ' kg');
        setLabel(labels.liftL, 'Ala izq. ' + Math.round(lL / G) + ' kg');
        setLabel(labels.liftR, 'Ala der. ' + Math.round(lR / G) + ' kg');
        setLabel(labels.weight, 'Peso ' + Math.round(wKg) + ' kg');
        setLabel(labels.thrust, 'Empuje ' + Math.round(tKg) + ' kg');
        setLabel(labels.drag, 'Resistencia ' + Math.round(dKg) + ' kg');
        setLabel(labels.tail, 'Cola ' + (tailKg < 0 ? 'hacia abajo ' : 'hacia arriba ') + Math.abs(Math.round(tailKg)) + ' kg');
      }
    }
    function updateMoments(dt) {
      var show = settings.moments && globalA > 0.01 && field.active;
      if (ext) ext.showInputArrows = !(settings.enabled && settings.moments);
      var M = { roll: num(ae.rollMoment, 0), pitch: num(ae.pitchMoment, 0), yaw: num(ae.yawMoment, 0) };
      Object.keys(arcs).forEach(function (k) {
        var g = arcs[k], m = M[k], mag = Math.abs(m);
        var op = show ? smooth(0.05, 0.22, mag) * globalA : 0;
        g.visible = op > 0.01;
        labels[k].visible = g.visible && labelsOn;
        if (!g.visible) return;
        var sgn = m >= 0 ? 1 : 0;
        // base = roll LEFT / nose UP / nose RIGHT
        if (k === 'roll') g.scale.x = m > 0 ? -1 : 1;
        if (k === 'pitch') g.scale.y = m > 0 ? 1 : -1;
        if (k === 'yaw') g.scale.x = m > 0 ? 1 : -1;
        g.userData.phase += dt * (0.6 + 2.2 * mag);
        g.userData.mat.uniforms.uPhase.value = g.userData.phase;
        g.userData.mat.uniforms.uOp.value = op;
        g.userData.hm.opacity = op;
        var s = 0.75 + 0.25 * clamp(mag * 2, 0, 1);
        if (k === 'roll') { g.scale.y = s; g.scale.z = 1; g.scale.x = (m > 0 ? -1 : 1) * s; }
        setLabel(labels[k], ARC_TEXT[k][sgn]);
        labels[k].position.copy(arcLabelPos[k]);
        if (k === 'pitch') labels[k].position.y = m > 0 ? 1.35 : -1.25;
      });
    }

    /* ------------------------------------------------ public */
    function set(o) {
      if (!o) return get();
      ['enabled', 'streamlines', 'propwash', 'vortices', 'pressure', 'forces', 'moments', 'trails'].forEach(function (k) {
        if (k in o) settings[k] = !!o[k];
      });
      if (o.density && LEVEL[o.density] != null) settings.density = o.density;
      if ('slowmo' in o) settings.slowmo = clamp(num(+o.slowmo, 1), 0.2, 1);
      if ('enabled' in o && o.enabled && globalA < 0.01) needPrewarm = true;
      if (!settings.enabled && ext) { ext.showInputArrows = true; }
      return get();
    }
    function get() {
      var o = {};
      for (var k in settings) o[k] = settings[k];
      o.focus = focusName;
      return o;
    }
    function focus(region) {
      focusName = region && FOCUS[region] ? region : null;
      applyEmphasis();
      return focusName;
    }
    function dispose() {
      body.remove(group); scene.remove(sceneGroup);
      [histGeo, headGeo, trailGeo, lineGeo].forEach(function (g) { g.dispose(); });
      streakMat.dispose(); trailMat.dispose(); tintMat.dispose(); lineMat.dispose(); streakHaloMat.dispose(); lineHaloMat.dispose();
    }

    flow.update = update;
    flow.set = set;
    flow.get = get;
    flow.focus = focus;
    flow.views = {};
    Object.keys(VIEWS).forEach(function (k) { flow.views[k] = { pos: VIEWS[k].pos.slice(), target: VIEWS[k].target.slice(), name: k }; });
    flow.REGIONS = REGIONS.slice();
    flow.snapshot = ae;
    flow.field = field;
    flow.group = group;
    flow.dispose = dispose;
    flow.stats = function () {
      var n = 0, l = 0; for (var i = 0; i < NMAX; i++) n += ACT[i];
      for (var j = 0; j < NL; j++) l += lineOn[j];
      return { particles: n, max: NMAX, lines: l, maxLines: NL, level: ['alta', 'media', 'baja'][level], segments: field.nSeg, active: field.active };
    };
    setPalette(false); lastLight = 0;
    if (opts.settings) set(opts.settings);
    return flow;
  }

  C150.Airflow = { create: create, aeroFromState: aeroFromState, snapshot: snapshot, Field: Field, REGIONS: REGIONS, FOCUS: FOCUS,
    VIEWS: VIEWS, stallAoa: stallAoa };
})(root.C150);
