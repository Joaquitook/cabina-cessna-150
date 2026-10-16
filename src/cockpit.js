var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * cockpit.js — C150.Cockpit (contract §4): procedural 3D interior of a 1976 Cessna 150M built only from
 * THREE primitives + canvas textures. Coordinates follow contract §2 (metres, Y up, nose toward −Z,
 * panel face at z = 0, pilot on −X, floor y = 0, panel fraction f → x = −0.46 + 0.92·f).
 *
 * API
 *   var ck = C150.Cockpit.create(THREE, { gauges: C150.Gauges });
 *   ck.group                 THREE.Group to add to the scene (stays at the origin; views/presets/anchors are in its space)
 *   ck.pickables             meshes with userData.controlId (+ userData.subId for master 'alt'/'bat', light rockers
 *                            dome/pitot/nav/strobe/beacon/taxi/landing, doors 'left'/'right'/'window', pedals 'left'/'right')
 *   ck.anchors[id]           Object3D at the centre of each control (follows moving parts such as doors)
 *   ck.views[id]             { position, target } close-up camera (0.30–0.60 m away, from the pilot's side)
 *   ck.presets[name]         { position, target, label } — pilot, flight, inside, panel, left, center, right, floor, overhead,
 *                            copilot, door
 *   ck.dragAxes[id]          { axis, length, out } for throttle, mixture, carb-heat, cabin-heat, cabin-air, primer, trim-wheel
 *   ck.update(state, dt)     animates every moving part, redraws gauge textures whose C150.Gauges.signature changed
 *   ck.setHighlight(id, kind) 'hover' | 'selected' | 'target' | null ;  ck.clearHighlights() ;  ck.eye (Vector3)
 *   ck.setQuality('alta'|'media'|'baja')   (core calls it; 'baja' drops the procedural surface detail)
 *   ck.motion                counter, +1 on every update() in which a shadow-casting part moved
 *
 * Look (see RENDERING NOTES in core.js): PBR MeshStandardMaterials, procedural triplanar surface relief shared by
 * all parts (wrinkle paint, vinyl grain, fabric weave, carpet pile, stipple, brushed steel), reflections from the
 * scene environment (core sets scene.environment), soft sun shadows (meshes cast/receive; glass, decals and gauge
 * faces do not cast), reflective glass that never washes out the dials, gauge faces not tone mapped.
 *
 * Decisions where the contract leaves room (other modules: please read):
 *  - dragAxes[id].axis = world direction in which the VALUE INCREASES (contract §4). For throttle and mixture that is
 *    INTO the panel (−Z) because pushing in = more power / richer. dragAxes[id].out is always the direction in which the
 *    knob comes OUT toward the pilot (+Z). length = knob travel in metres. trim-wheel: axis (0,−1,0) = the visible
 *    rim of the wheel moving DOWN is nose-up trim (rolling the top edge back toward you).
 *  - setHighlight keeps ONE kind per control id: the last call wins and null restores the original look.
 *  - Hidden objects (control lock when removed, propeller blades while the disc shows) leave raycast layer 0, so a
 *    default Raycaster neither renders nor hits them. The control-lock collar on the panel stays pickable as
 *    'control-lock' so the item can be found even when the lock is not installed.
 *  - The overhead red flood light is pickable as 'dimmers' (PANEL LT dims it); the dome light as 'light-switches'/'dome'.
 *    Floor heat outlets are pickable as 'cabin-heat'. The copilot pedals map to the same ids as the pilot pedals.
 *  - Circuit-breaker amp ratings: only the FLAP breaker (15 A, POH) shows a number; the research does not give the
 *    others, so their faces stay blank instead of inventing values.
 *  - Fuel shutoff handle: ON = pointing forward, OFF = turned 90° to the left (research marks this LOW confidence).
 *  - Ignition key angles (clockwise as seen by the pilot): OFF −60°, R −30°, L 0°, BOTH +30°, START +60°.
 */
(function (C150) {
  'use strict';

  var DEG = Math.PI / 180;
  var FONT_LABEL = "'Barlow Condensed', 'Arial Narrow', sans-serif";
  var FONT_MONO = "'B612 Mono', ui-monospace, monospace";
  var INK = '#ECEAE1';                       // engraved placard white

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function fx(f) { return -0.46 + 0.92 * f; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ------------------------------------------------------------------ layout constants (contract §2, layout.md) */
  var UP_Y0 = 0.43, UP_Y1 = 0.69;             // instrument panel
  var SUB_Y0 = 0.27, SUB_Y1 = 0.428;           // subpanel (two rows of knobs and switches)
  var ROW_U = 0.384, ROW_L = 0.312;            // upper / lower subpanel row centres
  var KNOB_TRAVEL = 0.06;

  var GAUGE_LAYOUT = [
    { gid: 'asi', id: 'asi', x: fx(0.05), y: 0.613, r: 0.040 },
    { gid: 'attitude', id: 'attitude', x: fx(0.15), y: 0.613, r: 0.040 },
    { gid: 'clock', id: 'clock', x: fx(0.24), y: 0.596, r: 0.029 },
    { gid: 'altimeter', id: 'altimeter', x: fx(0.32), y: 0.613, r: 0.040 },
    { gid: 'vor-indicator', id: 'vor-indicator', x: fx(0.42), y: 0.613, r: 0.040 },
    { gid: 'turn-coordinator', id: 'turn-coordinator', x: fx(0.05), y: 0.499, r: 0.040 },
    { gid: 'heading-indicator', id: 'heading-indicator', x: fx(0.15), y: 0.483, r: 0.040 },
    { gid: 'vsi', id: 'vsi', x: fx(0.32), y: 0.499, r: 0.040 },
    { gid: 'suction', id: 'suction', x: fx(0.10), y: 0.556, r: 0.024 },
    { gid: 'tachometer', id: 'tachometer', x: fx(0.75), y: 0.613, r: 0.040 },
    { gid: 'ammeter', id: 'ammeter', x: fx(0.95), y: 0.613, r: 0.029 }
  ];
  var ADF_BLANK = { x: fx(0.43), y: 0.499, r: 0.040 };
  var RADIO = { x0: -0.008, x1: 0.174, y0: 0.436, y1: 0.686 };
  var CLUSTERS = [
    { gid: 'fuel-gauges', id: 'fuel-gauges', x: fx(0.135), y: ROW_U, w: 0.084, h: 0.042 },
    { gid: 'oil-gauges', id: 'oil-gauges', x: fx(0.335), y: ROW_U, w: 0.084, h: 0.042 }
  ];
  var KN = {   // subpanel control x positions (fractions from layout.md §2–4, 1976 arrangement)
    park: -0.410, primer: -0.410, master: -0.355, ignition: -0.300, dimmer: -0.248,
    carb: fx(0.45), throttle: fx(0.51), mixture: fx(0.58), flaps: fx(0.64), cabinAir: fx(0.71), cabinHt: fx(0.77),
    lighter: 0.252
  };
  var ROCKERS = [
    { sub: 'dome', label: 'DOME LT' }, { sub: 'pitot', label: 'PITOT HT' }, { sub: 'nav', label: 'NAV' },
    { sub: 'strobe', label: 'STROBE' }, { sub: 'beacon', label: 'BCN' }, { sub: 'taxi', label: 'TAXI' },
    { sub: 'landing', label: 'LDG' }
  ];
  var ROCKER_X0 = -0.205, ROCKER_DX = 0.020;
  var BREAKERS = [['ALT'], ['FUEL', 'IND'], ['BCN', 'PITOT'], ['STROBE'], ['LDG', 'LT'], ['FLAP'], ['INST', 'LT'],
    ['NAV', 'DOME'], ['RADIO', '1'], ['RADIO', '2'], ['RADIO', '3'], ['RADIO', '4']];
  var BREAKER_X0 = -0.030, BREAKER_DX = 0.021;
  var YOKE_PILOT_X = fx(0.21), YOKE_COPILOT_X = fx(0.79), YOKE_Y = 0.476, YOKE_Z = 0.16;
  var IGN_ANGLE = { OFF: -60, R: -30, L: 0, BOTH: 30, START: 60 };

  /* ------------------------------------------------------------------ procedural surface detail (shared, cached)
   * Two tileable 256² height maps (linear data, RGB channels), generated once per page:
   *   A: R = wrinkle ("crinkle") paint · G = pebbled vinyl / ABS grain · B = woven fabric
   *   B: R = carpet loop pile        · G = plastic stipple ("orange peel") · B = brushed metal streaks
   * Materials opt in with userData.detail = { tex: 'A'|'B', ch: 0|1|2, tile: metres per repeat, bump: height (m),
   * rough: roughness variation (0..1), cavity: darkening of the low spots (0..1) }. The patched shader samples the
   * map triplanar in OBJECT space (no UVs needed, constant texel size on merged/extruded/lathed meshes) and perturbs
   * the normal with screen-space derivatives of the height (Mikkelsen's surface gradient), so no tangents are needed. */
  var DETAIL_SIZE = 256;
  var detailImages = null;
  function hashI(x, y, s) {
    var n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  // periodic value noise (period px × py lattice cells)
  function vnoise(x, y, px, py, s) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hashI(x0, y0, s), b = hashI(x1, y0, s), c = hashI(x0, y1, s), d = hashI(x1, y1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, p, oct, s, ridged) {
    var sum = 0, amp = 0.5, tot = 0;
    for (var o = 0; o < oct; o++) {
      var n = vnoise(x * p, y * p, p, p, s + o * 17);
      if (ridged) n = 1 - Math.abs(2 * n - 1);
      sum += n * amp; tot += amp; amp *= 0.5; p *= 2;
    }
    return sum / tot;
  }
  // distances to the nearest / second nearest feature point of a jittered periodic n×n grid
  function worley(x, y, n, s, out) {
    var gx = x * n, gy = y * n, ix = Math.floor(gx), iy = Math.floor(gy), f1 = 9, f2 = 9;
    for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
      var cx = ix + i, cy = iy + j, wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
      var dx = cx + hashI(wx, wy, s) - gx, dy = cy + hashI(wx, wy, s + 7) - gy, d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2);
    return out;
  }
  function sat(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function buildDetailImages() {
    if (detailImages) return detailImages;
    var N = DETAIL_SIZE, A = new Uint8ClampedArray(N * N * 4), B = new Uint8ClampedArray(N * N * 4), w = [0, 0];
    for (var py = 0; py < N; py++) {
      for (var px = 0; px < N; px++) {
        var x = px / N, y = py / N, k = (py * N + px) * 4;
        // A.R wrinkle finish: ridged network of fine creases
        var cr = fbm(x, y, 9, 3, 11, true);
        cr = Math.pow(cr, 2.2) * 0.85 + fbm(x, y, 40, 2, 5, false) * 0.15;
        // A.G pebbled grain: rounded cells with soft valleys
        worley(x, y, 26, 3, w);
        var gr = Math.sqrt(sat((w[1] - w[0]) * 2.4)) * 0.85 + fbm(x, y, 16, 2, 9, false) * 0.15;
        // A.B plain weave, 32 threads per repeat each way
        var u = x * 32, v = y * 32, cu = Math.floor(u), cv = Math.floor(v), fu = u - cu, fv = v - cv;
        var over = (cu + cv) % 2 === 0;
        var th = over ? Math.pow(Math.sin(Math.PI * fv), 0.6) * (0.75 + 0.25 * Math.sin(Math.PI * fu))
          : Math.pow(Math.sin(Math.PI * fu), 0.6) * (0.75 + 0.25 * Math.sin(Math.PI * fv));
        var wv = th * 0.82 + fbm(x, y, 64, 2, 21, false) * 0.18;
        // B.R carpet loop pile: dense blobs + fibre noise
        worley(x, y, 52, 31, w);
        var cp = sat(1 - w[0] * 1.5) * 0.65 + fbm(x, y, 32, 3, 33, false) * 0.35;
        // B.G orange-peel stipple
        var st = fbm(x, y, 20, 3, 41, false);
        // B.B brushed metal: long streaks along x
        var br = vnoise(x * 3, y * 170, 3, 170, 51) * 0.6 + vnoise(x * 6, y * 61, 6, 61, 53) * 0.4;
        A[k] = cr * 255; A[k + 1] = gr * 255; A[k + 2] = wv * 255; A[k + 3] = 255;
        B[k] = cp * 255; B[k + 1] = st * 255; B[k + 2] = br * 255; B[k + 3] = 255;
      }
    }
    detailImages = { A: A, B: B, size: N };
    return detailImages;
  }
  function detailTexture(THREE, which) {
    var im = buildDetailImages(), N = im.size;
    var c = document.createElement('canvas'); c.width = N; c.height = N;
    var ctx = c.getContext('2d'), id = ctx.createImageData(N, N);
    id.data.set(im[which]); ctx.putImageData(id, 0, 0);
    var t = new THREE.CanvasTexture(c);      // linear data (no sRGB tag)
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }

  // GLSL injected into MeshStandardMaterial (see patchMaterial inside create)
  var GLSL_VERT_PARS = 'varying vec3 vDPos;\nvarying vec3 vDNrm;\n';
  // Cabin 'sky visibility' (cheap stand-in for ambient occlusion, in cockpit space): indirect light (environment +
  // hemisphere) fades toward the floor, the footwell under the panel, the panel recess and the lower side walls;
  // everything outside the cabin box (cowling, wings) and the glareshield top under the windshield gets the full sky.
  var GLSL_AO = [
    'varying vec3 vC150W;',
    'float c150AoField(vec3 p) {',
    '  if (abs(p.x) > 0.52 || p.y > 1.06 || p.z < -0.56 || p.z > 1.95) return 1.0;',
    '  if (p.y > 0.715 && p.z < 0.06) return 1.0;',
    '  float h = smoothstep(0.0, 0.95, p.y);',
    '  float aft = smoothstep(-0.1, 0.9, p.z);',
    '  float a = mix(0.5, 1.0, clamp(0.6 * h + 0.55 * aft, 0.0, 1.0));',
    '  a *= 1.0 - 0.45 * (1.0 - smoothstep(-0.14, 0.01, p.z)) * (1.0 - smoothstep(0.18, 0.30, p.y));',
    '  a *= 1.0 - 0.25 * smoothstep(0.38, 0.49, abs(p.x)) * (1.0 - smoothstep(0.25, 0.6, p.y));',
    '  a *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 0.08, p.y));',
    '  return a;',
    '}'
  ].join('\n');
  var GLSL_FRAG_PARS = [
    'uniform vec3 uRim;',
    'uniform float uGlassRefl;',
    GLSL_AO,
    '#ifdef C150_DETAIL',
    'uniform sampler2D tDetail; uniform vec4 uDetail; uniform vec3 uDetailMask;',
    'varying vec3 vDPos; varying vec3 vDNrm;',
    'float c150DetailH() {',
    '  vec3 n = abs(normalize(vDNrm)); n = n * n; n = n * n; n /= (n.x + n.y + n.z);',
    '  vec3 p = vDPos * uDetail.x;',
    '  return n.x * dot(texture2D(tDetail, p.zy).rgb, uDetailMask) + n.y * dot(texture2D(tDetail, p.xz).rgb, uDetailMask)',
    '    + n.z * dot(texture2D(tDetail, p.xy).rgb, uDetailMask);',
    '}',
    'vec3 c150Bump(vec3 surfPos, vec3 surfNorm, float H, float amp, float faceDir) {',
    '  vec2 dHdxy = vec2(dFdx(H), dFdy(H)) * amp;',
    '  vec3 sx = dFdx(surfPos); vec3 sy = dFdy(surfPos);',
    '  vec3 R1 = cross(sy, surfNorm); vec3 R2 = cross(surfNorm, sx);',
    '  float det = dot(sx, R1) * faceDir;',
    '  vec3 grad = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);',
    '  return normalize(abs(det) * surfNorm - grad);',
    '}',
    '#endif'
  ].join('\n');

  function create(THREE, opts) {
    opts = opts || {};
    var Gauges = opts.gauges || C150.Gauges || null;
    var V3 = THREE.Vector3;
    function V(x, y, z) { return new V3(x, y, z); }
    var EYE = V(-0.235, 0.88, 0.70);
    var reducedMotion = false;
    try { reducedMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { reducedMotion = false; }

    var group = new THREE.Group(); group.name = 'C150-cockpit';
    var staticRoot = new THREE.Group(); staticRoot.name = 'cockpit-static'; group.add(staticRoot);

    var pickables = [], anchors = {}, views = {}, viewSpecs = {}, dragAxes = {};
    var matUniforms = new Map(), detailOn = true;
    var controlParts = {}, painters = [], gauges = [], A = {};

    /* ================================================================== canvas & texture helpers */
    function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    var allTextures = [];
    function canvasTex(c, repeat) {
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
      allTextures.push(t);
      if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
      return t;
    }
    // A canvas texture whose content is produced by paint(ctx, w, h); repainted when web fonts arrive.
    function painted(w, h, paint, repeat) {
      var c = makeCanvas(w, h), p = { canvas: c, ctx: c.getContext('2d'), tex: canvasTex(c, repeat), paint: paint };
      p.redraw = function () {
        p.ctx.setTransform(1, 0, 0, 1, 0, 0); p.ctx.clearRect(0, 0, w, h);
        paint(p.ctx, w, h); p.tex.needsUpdate = true;
      };
      p.redraw(); painters.push(p);
      return p;
    }
    // canvas holding DATA (alpha, masks): linear, never re-tagged by the colour mode
    function dataTex(w, h, paint) { var c = makeCanvas(w, h); paint(c.getContext('2d'), w, h); return new THREE.CanvasTexture(c); }
    function text(ctx, s, x, y, px, o) {
      o = o || {};
      ctx.font = (o.weight || 600) + ' ' + px.toFixed(1) + 'px ' + (o.font || FONT_LABEL);
      ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
      if (o.shadow !== false) {
        ctx.fillStyle = o.shadowColor || 'rgba(0,0,0,0.55)';
        ctx.fillText(s, x + px * 0.035, y + px * 0.05, o.max);
      }
      ctx.fillStyle = o.color || INK;
      ctx.fillText(s, x, y, o.max);
    }
    function noise(ctx, w, h, n, alpha, light) {
      for (var i = 0; i < n; i++) {
        var v = light ? 255 : 0;
        ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (Math.random() * alpha).toFixed(3) + ')';
        ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
    }
    function roundRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
    function screwHead(ctx, x, y, r) {
      var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, '#9a9ea3'); g.addColorStop(1, '#3a3d41');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = Math.max(1, r * 0.25);
      ctx.beginPath(); ctx.moveTo(x - r * 0.65, y); ctx.lineTo(x + r * 0.65, y); ctx.stroke();
    }

    /* ================================================================== shared textures */
    // colour maps (sRGB) — the fine surface relief comes from the shared detail maps (userData.detail), not from here
    var carpetTex = painted(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#5e3326'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 70; i++) {              // soft mottling (wear, pile direction)
        var x = Math.random() * w, y = Math.random() * h, r = 12 + Math.random() * 40;
        var g = ctx.createRadialGradient(x, y, 0, x, y, r), a = (Math.random() * 0.08).toFixed(3);
        g.addColorStop(0, Math.random() < 0.5 ? 'rgba(0,0,0,' + a + ')' : 'rgba(255,220,200,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      noise(ctx, w, h, 1500, 0.10, false);
    }, true).tex;
    carpetTex.repeat.set(3, 8);
    // light-blue tuck-and-roll fabric (1976 interior: light-blue fabric, dark-blue vinyl trim), stitched channels
    var fabricTex = painted(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#6185ad'; ctx.fillRect(0, 0, w, h);
      var cw = 32;
      for (var x = 0; x < w; x += cw) {
        var g = ctx.createLinearGradient(x, 0, x + cw, 0);
        g.addColorStop(0, 'rgba(10,20,40,0.42)'); g.addColorStop(0.12, 'rgba(255,255,255,0.05)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.13)'); g.addColorStop(0.88, 'rgba(255,255,255,0.02)'); g.addColorStop(1, 'rgba(10,20,40,0.42)');
        ctx.fillStyle = g; ctx.fillRect(x, 0, cw, h);
        ctx.fillStyle = 'rgba(225,235,248,0.55)';            // stitching each side of the seam
        for (var y = 2; y < h; y += 6) { ctx.fillRect(x + 2, y, 1, 3); ctx.fillRect(x + cw - 3, y, 1, 3); }
      }
      noise(ctx, w, h, 1200, 0.06, false);
    }, true).tex;
    fabricTex.repeat.set(1, 1);
    var knurlCanvas = painted(64, 16, function (ctx, w, h) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#5c5f63'; ctx.lineWidth = 1.4;      // diamond knurl
      for (var x = -h; x < w + h; x += 4) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    }, true);
    var knurlTex = knurlCanvas.tex;
    knurlTex.repeat.set(8, 1);
    var knurlBump = new THREE.CanvasTexture(knurlCanvas.canvas);           // same pattern as relief (linear data)
    knurlBump.wrapS = knurlBump.wrapT = THREE.RepeatWrapping; knurlBump.repeat.set(8, 1);
    var ribTex = painted(64, 8, function (ctx, w, h) {
      ctx.fillStyle = '#262626'; ctx.fillRect(0, 0, w, h);
      for (var x = 0; x < w; x += 8) { ctx.fillStyle = '#070707'; ctx.fillRect(x, 0, 3, h); ctx.fillStyle = '#6a6a6a'; ctx.fillRect(x + 3, 0, 1, h); }
    }, true).tex;
    ribTex.repeat.set(10, 1);
    var grilleTex = painted(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#2b2d30'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0b0b0c';
      for (var y = 6; y < h; y += 9) for (var x = 6 + ((y / 9) % 2) * 4; x < w; x += 9) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); }
    }).tex;

    /* ================================================================== materials: PBR + procedural detail
     * std(params, detail, glass): MeshStandardMaterial; 'detail' = a D.* surface relief, 'glass' = {refl} reflective
     * glass (premultiplied blend: full-strength reflections, only 'opacity' of tint). All cockpit standard materials
     * go through patchMaterial() at the end of create() (detail, highlight rim, glass). */
    var DETAIL_TEX = { A: detailTexture(THREE, 'A'), B: detailTexture(THREE, 'B') };
    function dspec(tex, ch, tile, bump, rough, cavity) { return { tex: tex, ch: ch, tile: tile, bump: bump, rough: rough, cavity: cavity }; }
    var D = {
      crinkle: dspec('A', 0, 0.022, 0.00010, 0.28, 0.14),     // wrinkle-finish panel paint
      grain: dspec('A', 1, 0.07, 0.00022, 0.22, 0.12),        // moulded ABS / vinyl panels
      vinyl: dspec('A', 1, 0.05, 0.00025, 0.25, 0.16),        // padded glareshield vinyl
      weave: dspec('A', 2, 0.022, 0.00022, 0.10, 0.32),       // seat fabric, belts
      carpet: dspec('B', 0, 0.035, 0.00090, 0.05, 0.42),      // loop-pile carpet
      stipple: dspec('B', 1, 0.035, 0.00006, 0.18, 0.05),     // satin plastics, rubber
      brushed: dspec('B', 2, 0.10, 0.00002, 0.35, 0.04)       // steel
    };
    function std(p, detail, glass) {
      var m = new THREE.MeshStandardMaterial(p);
      if (detail) m.userData.detail = detail;
      if (glass) m.userData.glass = glass;
      return m;
    }
    var DS = THREE.DoubleSide;
    var MAT = {
      edge: std({ color: 0x383b40, roughness: 0.6, metalness: 0.1 }, D.crinkle),
      black: std({ color: 0x141414, roughness: 0.5 }, D.stipple),
      blackGloss: std({ color: 0x0e0e0f, roughness: 0.28 }),
      satin: std({ color: 0x121315, roughness: 0.4 }, D.stipple),
      vinyl: std({ color: 0x19191b, roughness: 0.62 }, D.vinyl),
      deck: std({ color: 0x1b1b1d, roughness: 0.7, side: DS }, D.vinyl),
      // metals see mostly the dim cabin in the environment map: a stronger envMapIntensity keeps chrome reading as chrome
      chrome: std({ color: 0xf4f5f7, roughness: 0.16, metalness: 1.0, envMapIntensity: 1.9 }),
      knurl: std({ color: 0xeef0f2, map: knurlTex, bumpMap: knurlBump, bumpScale: 0.0004, roughness: 0.24, metalness: 1.0, envMapIntensity: 1.8 }),
      steel: std({ color: 0xbfc4ca, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.5 }, D.brushed),
      darkSteel: std({ color: 0x575b60, roughness: 0.45, metalness: 0.7, envMapIntensity: 1.3 }, D.brushed),
      red: std({ color: 0x9c0e0a, roughness: 0.3 }, D.stipple),
      white: std({ color: 0xeceae2, roughness: 0.32 }),
      beige: std({ color: 0xc9b996, roughness: 0.6 }, D.grain),
      tan: std({ color: 0xc8b79a, roughness: 0.62, side: DS }, D.grain),
      tanDark: std({ color: 0xa08d6c, roughness: 0.6, side: DS }, D.grain),
      trim: std({ color: 0x6b4c33, roughness: 0.55 }, D.grain),
      headliner: std({ color: 0xe7e1d3, roughness: 0.85, side: DS }, D.stipple),
      carpet: std({ color: 0xffffff, map: carpetTex, roughness: 1.0, side: DS }, D.carpet),
      seat: std({ color: 0xffffff, map: fabricTex, roughness: 0.92 }, D.weave),
      seatTrim: std({ color: 0x2e4a6b, roughness: 0.5 }, D.vinyl),
      webbing: std({ color: 0x2b2e33, roughness: 0.82, side: DS }, D.weave),
      rubber: std({ color: 0x1a1a1a, roughness: 0.88 }, D.stipple),
      paint: std({ color: 0xf3f3ef, roughness: 0.3, metalness: 0.0, side: DS }),
      glass: std({ color: 0xc4dcd4, transparent: true, opacity: 0.07, roughness: 0.03, metalness: 0, depthWrite: false, side: DS }, null, { refl: 1.6 }),
      // windshield: same glass with darker edges (sealant / tint band) through an alpha map on its 0..1 UVs
      windshield: std({ color: 0xb9d4cb, transparent: true, opacity: 1, alphaMap: dataTex(512, 256, function (ctx, w, h) {
        ctx.fillStyle = 'rgb(18,18,18)'; ctx.fillRect(0, 0, w, h);                 // ≈ 7 % tint in the middle
        var g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, 'rgba(150,150,150,1)'); g.addColorStop(0.05, 'rgba(18,18,18,0)'); g.addColorStop(0.95, 'rgba(18,18,18,0)'); g.addColorStop(1, 'rgba(150,150,150,1)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(120,120,120,1)'); g.addColorStop(0.07, 'rgba(18,18,18,0)'); g.addColorStop(0.93, 'rgba(18,18,18,0)'); g.addColorStop(1, 'rgba(170,170,170,1)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        for (var i = 0; i < 900; i++) {          // fine dust and a few wiper-free smudges: the glass catches the light
          ctx.fillStyle = 'rgba(255,255,255,' + (0.04 + Math.random() * 0.12).toFixed(3) + ')';
          ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
        }
        for (var k = 0; k < 14; k++) {
          var sx = Math.random() * w, sy = h * (0.15 + Math.random() * 0.7), sr = 20 + Math.random() * 50, sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
          sg.addColorStop(0, 'rgba(255,255,255,0.05)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = sg; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
        }
      }), roughness: 0.03, metalness: 0, depthWrite: false, side: DS }, null, { refl: 1.8 }),
      gaugeGlass: std({ color: 0x9aa6ad, transparent: true, opacity: 0.035, roughness: 0.04, metalness: 0, depthWrite: false }, null, { refl: 0.85 }),
      mirror: std({ color: 0xffffff, roughness: 0.03, metalness: 1.0 }),
      radioPlate: std({ color: 0x232527, roughness: 0.45, metalness: 0.2 }, D.stipple),
      proxy: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
    };

    /* ================================================================== geometry helpers */
    function rbox(w, h, d, r, seg) {
      if (THREE.RoundedBoxGeometry && r > 0) {
        var rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
        return new THREE.RoundedBoxGeometry(w, h, d, seg || 2, rr);
      }
      return new THREE.BoxGeometry(w, h, d);
    }
    function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
    // Cylinder whose axis runs along +Z (top cap faces the pilot).
    function cylZ(r1, r2, len, seg) { var g = new THREE.CylinderGeometry(r2, r1, len, seg || 20); g.rotateX(Math.PI / 2); return g; }
    function latheZ(points, seg) {
      var g = new THREE.LatheGeometry(points.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 24);
      g.rotateX(Math.PI / 2);
      return g;
    }
    function mesh(geo, mat, parent, x, y, z) {
      var m = new THREE.Mesh(geo, mat);
      if (x !== undefined) m.position.set(x, y, z);
      (parent || staticRoot).add(m);
      return m;
    }
    function deco(m) { m.userData.decor = true; return m; }
    function sdeco(geo, mat, x, y, z) { return deco(mesh(geo, mat, staticRoot, x, y, z)); }
    function range(a, b, n) { var r = []; for (var i = 0; i <= n; i++) r.push(a + (b - a) * i / n); return r; }

    // Sweep: profileAt(z) returns [[x,y]...] (same count for every z); quads join consecutive stations.
    function sweepGeo(profileAt, zs) {
      var first = profileAt(zs[0]), n = first.length, m = zs.length, i, j;
      var pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), index = [];
      for (j = 0; j < m; j++) {
        var pts = j === 0 ? first : profileAt(zs[j]), acc = 0;
        for (i = 0; i < n; i++) {
          if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          var k = j * n + i;
          pos[k * 3] = pts[i][0]; pos[k * 3 + 1] = pts[i][1]; pos[k * 3 + 2] = zs[j];
          uv[k * 2] = acc; uv[k * 2 + 1] = zs[j];
        }
      }
      for (j = 0; j < m - 1; j++) for (i = 0; i < n - 1; i++) {
        var a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(index); g.computeVertexNormals();
      return g;
    }
    // Parametric grid: fn(u, v, target) with u, v in [0, 1].
    function gridGeo(fn, nu, nv) {
      var pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2), index = [];
      var p = new V3(), i, j;
      for (j = 0; j <= nv; j++) for (i = 0; i <= nu; i++) {
        var k = j * (nu + 1) + i;
        fn(i / nu, j / nv, p);
        pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
        uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv;
      }
      for (j = 0; j < nv; j++) for (i = 0; i < nu; i++) {
        var a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(index); g.computeVertexNormals();
      return g;
    }
    // Flat strap (belts, harness) following a smooth curve; 'up' is the strap's face normal hint.
    function ribbonGeo(points, width, segs, up) {
      var curve = new THREE.CatmullRomCurve3(points), n = segs || 24;
      var pos = new Float32Array((n + 1) * 6), uv = new Float32Array((n + 1) * 4), index = [];
      var p = new V3(), t = new V3(), s = new V3(), upv = up || V(0, 1, 0);
      for (var i = 0; i <= n; i++) {
        curve.getPointAt(i / n, p); curve.getTangentAt(i / n, t);
        s.crossVectors(t, upv); if (s.lengthSq() < 1e-8) s.set(1, 0, 0);
        s.normalize().multiplyScalar(width / 2);
        pos.set([p.x - s.x, p.y - s.y, p.z - s.z, p.x + s.x, p.y + s.y, p.z + s.z], i * 6);
        uv.set([0, i / n, 1, i / n], i * 4);
        if (i < n) { var a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(index); g.computeVertexNormals();
      return g;
    }
    function tubeGeo(points, radius, segs, radial) {
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segs || 24, radius, radial || 8, false);
    }
    // Decal plane with its own painted canvas (pxPerM controls sharpness).
    function decal(w, h, pxPerM, paint, opts) {
      opts = opts || {};
      var p = painted(Math.max(8, Math.round(w * pxPerM)), Math.max(8, Math.round(h * pxPerM)), paint);
      var m = std({ map: p.tex, roughness: opts.rough !== undefined ? opts.rough : 0.55, metalness: opts.metal || 0,
        transparent: !!opts.transparent, alphaTest: opts.transparent ? 0.02 : 0, side: opts.side || THREE.FrontSide });
      if (opts.envMap) m.envMapIntensity = opts.envMap;
      var me = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      me.userData.painter = p; me.userData.noCast = true;
      return me;
    }

    /* ================================================================== control registry */
    function bind(obj, id, subId) {
      obj.traverse(function (o) {
        if (!o.isMesh) return;
        o.userData.controlId = id;
        if (subId) o.userData.subId = subId;
        if (o.userData.proxy) return;
        pickables.push(o);
        (controlParts[id] = controlParts[id] || []).push(o);
      });
      return obj;
    }
    function proxy(id, parent, w, h, d, x, y, z, subId) {
      var m = mesh(box(w, h, d), MAT.proxy, parent, x, y, z);
      m.userData.proxy = true; m.userData.controlId = id;
      if (subId) m.userData.subId = subId;
      m.renderOrder = -1;
      pickables.push(m);
      return m;
    }
    function anchor(id, parent, x, y, z, spec) {
      var a = new THREE.Object3D(); a.name = 'anchor:' + id;
      a.position.set(x, y, z);
      (parent || group).add(a);
      anchors[id] = a;
      viewSpecs[id] = spec || { kind: 'panel', d: 0.32 };
      return a;
    }
    function setVisibleAndPickable(obj, on) {
      obj.visible = on;
      obj.traverse(function (o) { if (on) o.layers.enable(0); else o.layers.disable(0); });
    }

    /* ================================================================== CABIN SHELL */
    function ceilY(z) { return z <= 0.93 ? 1.04 - (z - 0.03) * 0.111 : 0.94 - (z - 0.93) * (0.38 / 0.97); }
    function buildShell() {
      // carpeted floor, toe board and under-panel area
      var floor = sdeco(new THREE.PlaneGeometry(0.80, 2.35), MAT.carpet, 0, 0.001, 0.725);
      floor.rotation.x = -Math.PI / 2;
      var toe = sdeco(new THREE.PlaneGeometry(0.80, Math.hypot(0.24, 0.10)), MAT.carpet, 0, 0.12, -0.47);
      toe.rotation.x = -Math.PI / 2 + Math.atan2(0.24, 0.10);
      sdeco(new THREE.PlaneGeometry(0.98, 0.50), MAT.deck, 0, 0.49, -0.52);                 // firewall
      var under = sdeco(new THREE.PlaneGeometry(0.92, 0.52), MAT.deck, 0, 0.262, -0.26);    // under the dash
      under.rotation.x = Math.PI / 2;

      [-1, 1].forEach(function (s) {
        // lower side wall in front of the door (kick panel), under the panel
        sdeco(sweepGeo(function () { return [[0.38 * s, 0], [0.44 * s, 0.10], [0.47 * s, 0.30], [0.49 * s, 0.55], [0.49 * s, 0.745]]; },
          range(-0.52, 0.10, 2)), MAT.tan);
        // door sill under the door
        sdeco(sweepGeo(function () { return [[0.38 * s, 0], [0.44 * s, 0.10], [0.455 * s, 0.10]]; }, range(0.10, 0.93, 1)), MAT.tanDark);
        // rear wall behind the door, narrowing toward the baggage wall
        sdeco(sweepGeo(function (z) {
          var t = (z - 0.93) / 0.97, k = 1 - 0.24 * t, yw = 0.55 - 0.05 * t;
          return [[0.38 * k * s, 0], [0.44 * k * s, 0.10], [0.47 * k * s, 0.30], [0.49 * k * s, yw]];
        }, range(0.93, 1.90, 4)), MAT.tan);
        // rear side glass and Omni-Vision sides
        sdeco(sweepGeo(function (z) {
          var t = (z - 0.93) / 0.97, k = 1 - 0.24 * t, yw = 0.55 - 0.05 * t, yt = ceilY(z) - 0.03;
          return [[0.49 * k * s, yw], [0.485 * k * s, lerp(yw, yt, 0.6)], [0.44 * k * s, yt]];
        }, range(0.98, 1.90, 6)), MAT.glass);
        // strip above the door up to the roof edge
        sdeco(sweepGeo(function (z) { return [[0.497 * s, 0.90], [0.485 * s, 0.94], [0.44 * s, ceilY(z) - 0.03]]; },
          range(0.03, 0.98, 4)), MAT.headliner);
        // front door post (A-pillar trim, angled toward the pilot) and rear door post
        var post = sdeco(box(0.03, 0.31, 0.075), MAT.tan, 0.482 * s, 0.89, 0.07);
        post.rotation.y = 40 * DEG * s;
        sdeco(box(0.03, 0.75, 0.05), MAT.tan, 0.48 * s, 0.375, 0.07);
        sdeco(box(0.035, 0.93, 0.05), MAT.tan, 0.485 * s, 0.465, 0.955);
        // panel end caps (close the gap between the panel edge and the wall)
        sdeco(box(0.04, 0.48, 0.07), MAT.tanDark, 0.48 * s, 0.505, -0.03);
        // windshield-corner vent housings at the wing roots
        sdeco(rbox(0.09, 0.055, 0.09, 0.02), MAT.tan, 0.445 * s, 1.0, 0.065);
      });

      // headliner (moulded plastic) and the transparent rear roof (Omni-Vision)
      sdeco(sweepGeo(function (z) {
        var c = ceilY(z);
        return [[-0.44, c - 0.03], [-0.36, c - 0.01], [-0.18, c - 0.002], [0.18, c - 0.002], [0.36, c - 0.01], [0.44, c - 0.03]];
      }, range(0.03, 1.28, 6)), MAT.headliner);
      sdeco(sweepGeo(function (z) {
        var c = ceilY(z), k = 1 - 0.24 * (z - 0.93) / 0.97;
        return [[-0.44 * k, c - 0.03], [-0.25 * k, c - 0.008], [0.25 * k, c - 0.008], [0.44 * k, c - 0.03]];
      }, range(1.28, 1.90, 4)), MAT.glass);
      // baggage wall
      sdeco(new THREE.PlaneGeometry(0.66, 0.52), MAT.tan, 0, 0.26, 1.90);
      sdeco(box(0.94, 0.022, 0.035), MAT.tanDark, 0, 1.025, 0.035);        // windshield top trim
      // tie-down rings in the baggage area
      [[-0.2, 1.45], [0.2, 1.45], [-0.2, 1.80], [0.2, 1.80]].forEach(function (p) {
        var ring = sdeco(new THREE.TorusGeometry(0.018, 0.003, 6, 16), MAT.steel, p[0], 0.006, p[1]);
        ring.rotation.x = Math.PI / 2;
      });
    }

    /* ================================================================== WINDSHIELD, GLARESHIELD, OVERHEAD */
    function wsBaseZ(U) { return -0.40 + 0.45 * Math.pow(Math.abs(U), 3); }
    function wsPoint(U, v, out) {
      return (out || new V3()).set(lerp(0.50 * U, 0.465 * U, v), lerp(0.74, 1.035, v),
        lerp(wsBaseZ(U), 0.03, v) - 0.035 * Math.sin(Math.PI * v) * (1 - U * U));
    }
    // windshield point at cockpit (x, y) and its normal pointing into the cabin
    function wsSurface(x, y) {
      var v = clamp((y - 0.74) / 0.295, 0, 1), U = clamp(x / lerp(0.50, 0.465, v), -1, 1), e = 1e-3;
      var p = wsPoint(U, v), du = wsPoint(U + e, v).sub(wsPoint(U - e, v)), dv = wsPoint(U, v + e).sub(wsPoint(U, v - e));
      var n = new V3().crossVectors(du, dv).normalize();
      if (n.z < 0) n.negate();
      return { p: p, n: n };
    }
    function buildWindshield() {
      sdeco(gridGeo(function (u, v, p) {
        var U = 2 * u - 1;
        p.set(lerp(0.50 * U, 0.465 * U, v), lerp(0.74, 1.035, v),
          lerp(wsBaseZ(U), 0.03, v) - 0.035 * Math.sin(Math.PI * v) * (1 - U * U));
      }, 24, 8), MAT.windshield);
      // magnetic compass hanging from the windshield top centre
      var cg = new THREE.Group(); cg.position.set(0, 0.985, 0.012); group.add(cg);
      mesh(box(0.012, 0.035, 0.012), MAT.black, cg, 0, 0.042, -0.006);
      mesh(rbox(0.074, 0.058, 0.06, 0.012), MAT.black, cg, 0, 0, 0);
      var cw = addGauge('compass', 'compass', cg, 0, 0.004, 0.0305, 0.056, 0.014, false);
      cw.renderOrder = 1;
      var lens = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.062, 20, 1, true, -Math.PI / 2, Math.PI), MAT.gaugeGlass, cg, 0, 0.004, 0.026);
      lens.rotation.z = Math.PI / 2; lens.scale.set(1, 1, 0.55);
      var dev = decal(0.068, 0.026, 6000, paintDeviationCard);
      dev.position.set(0, -0.045, 0.031); cg.add(dev);
      mesh(box(0.006, 0.02, 0.004), MAT.chrome, cg, 0, -0.028, 0.031);
      bind(cg, 'compass');
      proxy('compass', cg, 0.09, 0.11, 0.08, 0, -0.012, 0.01);
      anchor('compass', cg, 0, -0.01, 0.035, { kind: 'eye', d: 0.32 });

      // outside-air thermometer dial pushed through the windshield (upper left), turned toward the pilot
      // the stem goes through the windshield along the glass normal (rubber grommet + nut on the inside, the probe
      // tip outside); the dial on its end is turned toward the pilot so it can be read
      var gl = wsSurface(-0.24, 0.948), gn = gl.n, gp = gl.p;
      var oat = new THREE.Group(); oat.position.copy(gp).addScaledVector(gn, 0.034); group.add(oat);
      oat.lookAt(EYE);
      addGauge('oat', 'oat', oat, 0, 0, 0.004, 0.026, 0.026, true);
      mesh(new THREE.TorusGeometry(0.026, 0.002, 6, 32), MAT.chrome, oat, 0, 0, 0.004);
      mesh(cylZ(0.0275, 0.024, 0.012, 32), MAT.satin, oat, 0, 0, -0.004);              // dial housing (cup)
      var om = new THREE.Group(); group.add(om);
      var sA = gp.clone().addScaledVector(gn, -0.03), sB = oat.position.clone(), sd = sB.clone().sub(sA);
      var stem = mesh(new THREE.CylinderGeometry(0.0032, 0.0032, sd.length(), 10), MAT.steel, om, (sA.x + sB.x) / 2, (sA.y + sB.y) / 2, (sA.z + sB.z) / 2);
      stem.quaternion.setFromUnitVectors(V(0, 1, 0), sd.clone().normalize());
      var gq = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), gn);
      var grom = mesh(new THREE.TorusGeometry(0.0085, 0.0032, 8, 24), MAT.rubber, om, gp.x, gp.y, gp.z); grom.quaternion.copy(gq);
      var wsh = mesh(new THREE.CircleGeometry(0.0125, 24), MAT.satin, om); wsh.position.copy(gp).addScaledVector(gn, 0.0012); wsh.quaternion.copy(gq);   // washer on the glass
      var nut = mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.005, 6), MAT.chrome, om);
      nut.position.copy(gp).addScaledVector(gn, 0.005); nut.quaternion.setFromUnitVectors(V(0, 1, 0), gn);
      var tip = mesh(new THREE.SphereGeometry(0.0045, 10, 8), MAT.steel, om); tip.position.copy(sA);
      bind(oat, 'oat'); bind(om, 'oat');
      proxy('oat', oat, 0.065, 0.065, 0.03, 0, 0, 0);
      // close-up from the right and below: the dial is readable and its stem/grommet on the glass can be seen
      anchor('oat', oat, 0, 0, 0.005, { kind: 'custom', position: oat.position.clone().add(V(0.15, -0.085, 0.22)), target: oat.position.clone().addScaledVector(gn, -0.012) });

      // fresh-air vents (pull-out tubes) in the upper windshield corners
      [-1, 1].forEach(function (s) {
        var vg = new THREE.Group(); vg.position.set(0.425 * s, 0.976, 0.09); group.add(vg);
        vg.lookAt(-0.05 * s, 0.80, 0.55);
        mesh(cylZ(0.03, 0.03, 0.006, 24), MAT.tanDark, vg, 0, 0, 0);
        mesh(cylZ(0.019, 0.019, 0.045, 20), MAT.steel, vg, 0, 0, 0.024);
        var lip = mesh(new THREE.TorusGeometry(0.019, 0.0035, 8, 24), MAT.black, vg, 0, 0, 0.047);
        mesh(new THREE.CircleGeometry(0.017, 20), MAT.black, vg, 0, 0, 0.0465);
        bind(vg, 'air-vents');
        proxy('air-vents', vg, 0.055, 0.055, 0.06, 0, 0, 0.02);
        if (s < 0) anchor('air-vents', vg, 0, 0, 0.03, { kind: 'eye', d: 0.32 });
      });

      // stall-warning horn grille on the upper left door post, just aft of the fresh-air vent (kept apart so both
      // can be clicked)
      var hg = new THREE.Group(); hg.position.set(-0.462, 0.95, 0.15); group.add(hg);
      hg.lookAt(EYE);
      mesh(cylZ(0.018, 0.016, 0.01, 24), MAT.black, hg, 0, 0, 0);
      mesh(new THREE.CircleGeometry(0.014, 24), std({ map: grilleTex, roughness: 0.8 }), hg, 0, 0, 0.0055);
      bind(hg, 'stall-warning');
      proxy('stall-warning', hg, 0.05, 0.05, 0.03, 0, 0, 0);
      anchor('stall-warning', hg, 0, 0, 0.006, { kind: 'eye', d: 0.30 });

      // flap position scale on the LEFT forward door post (1968–76 models)
      var fp = new THREE.Group(); fp.position.set(-0.482, 0.865, 0.07); fp.rotation.y = 50 * DEG; group.add(fp);
      mesh(box(0.034, 0.112, 0.004), MAT.black, fp, 0, 0, 0.016);
      addGauge('flap-indicator', 'flap-indicator', fp, 0, 0, 0.0185, 0.025, 0.10, false);
      bind(fp, 'flap-indicator');
      proxy('flap-indicator', fp, 0.05, 0.13, 0.03, 0, 0, 0.02);
      anchor('flap-indicator', fp, 0, 0, 0.02, { kind: 'eye', d: 0.30 });

      // pilot's checklist on the RIGHT door post
      var ck = decal(0.07, 0.125, 7000, paintChecklist, { rough: 0.5 });
      ck.position.set(0.482 - 0.02 * Math.sin(50 * DEG), 0.80, 0.07 + 0.02 * Math.cos(50 * DEG));
      ck.rotation.y = -50 * DEG; group.add(ck);
      bind(ck, 'placards');

      // sun visors (decoration)
      [-1, 1].forEach(function (s) {
        var v = sdeco(rbox(0.29, 0.12, 0.008, 0.004), MAT.tanDark, 0.255 * s, 1.017, 0.105);
        v.rotation.x = Math.PI / 2 - 0.12;
        var rod = sdeco(new THREE.CylinderGeometry(0.003, 0.003, 0.30, 8), MAT.chrome, 0.255 * s, 1.026, 0.045);
        rod.rotation.z = Math.PI / 2;
      });
    }

    function buildGlareshield() {
      sdeco(rbox(0.93, 0.034, 0.075, 0.014), MAT.vinyl, 0, 0.705, 0.012);           // padded lip over the panel
      sdeco(gridGeo(function (u, v, p) {
        var U = 2 * u - 1, zEnd = Math.min(wsBaseZ(U), -0.02);
        p.set(0.468 * U, 0.722 + 0.016 * v, lerp(-0.02, zEnd, v));
      }, 24, 4), MAT.deck);
      sdeco(box(0.18, 0.003, 0.012), MAT.blackGloss, -0.22, 0.737, -0.33);           // defroster outlet slot
      // beige centre housing: marker beacon (left), rear-view mirror, audio panel (right)
      sdeco(rbox(0.47, 0.062, 0.15, 0.012), MAT.beige, 0, 0.72, -0.02);
      sdeco(rbox(0.48, 0.018, 0.165, 0.008), MAT.vinyl, 0, 0.753, -0.022);
      sdeco(rbox(0.136, 0.042, 0.006, 0.004), MAT.black, 0, 0.721, 0.053);
      var mirTex = painted(512, 140, paintMirror).tex;
      var mir = mesh(new THREE.PlaneGeometry(0.128, 0.035), std({ color: 0x0c0c0c, roughness: 0.04, metalness: 0, emissive: 0xffffff, emissiveMap: mirTex, emissiveIntensity: 0.62 }), staticRoot, 0, 0.721, 0.0565);
      mir.userData.noCast = true;
      var mkr = decal(0.112, 0.038, 6000, paintMarkerBeacon);
      mkr.position.set(-0.158, 0.721, 0.0555); staticRoot.add(mkr);
      [[-0.196, 0x3a5fd0], [-0.179, 0xd9a400], [-0.162, 0xf0f0e8]].forEach(function (l) {
        sdeco(cylZ(0.0045, 0.0045, 0.006, 16), std({ color: l[1], roughness: 0.25, emissive: l[1], emissiveIntensity: 0.06 }), l[0], 0.722, 0.057);
      });
      sdeco(cylZ(0.0055, 0.0055, 0.01, 16), MAT.black, -0.118, 0.722, 0.058);       // marker volume knob
      // audio panel with four toggles (pickable)
      var ap = new THREE.Group(); group.add(ap);
      var apFace = decal(0.13, 0.038, 6000, paintAudioPanel);
      apFace.position.set(0.158, 0.721, 0.0555); ap.add(apFace);
      [0.117, 0.147, 0.172, 0.197].forEach(function (x) {
        mesh(cylZ(0.003, 0.003, 0.004, 10), MAT.chrome, ap, x, 0.719, 0.0575);
        var bat = mesh(cylZ(0.0012, 0.0018, 0.011, 8), MAT.chrome, ap, x, 0.721, 0.063);
        bat.rotation.x = -0.35;
      });
      bind(ap, 'audio-panel');
      proxy('audio-panel', ap, 0.135, 0.045, 0.03, 0.158, 0.721, 0.06);
      anchor('audio-panel', ap, 0.158, 0.721, 0.056, { kind: 'panel', d: 0.32 });
    }

    function buildOverhead() {
      var oc = new THREE.Group(); oc.position.set(0, ceilY(0.31) - 0.018, 0.31); oc.rotation.x = 0.11; group.add(oc);
      mesh(rbox(0.15, 0.03, 0.40, 0.012), MAT.tan, oc, 0, 0, 0);
      // speaker grille (decoration)
      var spk = mesh(new THREE.CircleGeometry(0.045, 32), std({ map: grilleTex, roughness: 0.8 }), oc, 0, -0.0155, 0.0);
      spk.rotation.x = Math.PI / 2;
      // red flood light (front) → dimmers
      var flood = new THREE.Group(); flood.position.set(0, -0.016, -0.15); oc.add(flood);
      mesh(cylZ(0.022, 0.024, 0.012, 20), MAT.black, flood, 0, 0, 0).rotation.x = Math.PI / 2;
      A.floodLens = mesh(new THREE.CircleGeometry(0.014, 20), std({ color: 0x4a0d0a, roughness: 0.3, emissive: 0x000000 }), flood, 0, -0.0065, 0);
      A.floodLens.rotation.x = Math.PI / 2;
      bind(flood, 'dimmers');
      // dome light (rear) → light-switches / dome
      var dome = new THREE.Group(); dome.position.set(0, -0.016, 0.13); oc.add(dome);
      mesh(cylZ(0.03, 0.03, 0.01, 24), MAT.tanDark, dome, 0, 0, 0).rotation.x = Math.PI / 2;
      A.domeLens = mesh(new THREE.SphereGeometry(0.026, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0xe9e5da, roughness: 0.4, emissive: 0x000000 }), dome, 0, -0.004, 0);
      A.domeLens.rotation.x = Math.PI; A.domeLens.scale.y = 0.35;
      bind(dome, 'light-switches', 'dome');
      // interior lights (intensity animated, never removed, so shader light counts stay constant)
      A.floodLight = new THREE.PointLight(0xff3020, 0, 1.6, 2); A.floodLight.position.set(0, 0.95, 0.15); group.add(A.floodLight);
      A.domeLight = new THREE.PointLight(0xfff0d8, 0, 2.4, 2); A.domeLight.position.set(0, 0.93, 0.45); group.add(A.domeLight);
    }

    /* ================================================================== INSTRUMENT PANEL */
    function panelShape(x0, x1, y0, y1, r) {
      var s = new THREE.Shape();
      s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
      s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1); s.lineTo(x0 + r, y1);
      s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
      return s;
    }
    function rectHole(x0, y0, x1, y1) {
      var p = new THREE.Path(); p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0);
      return p;
    }
    function circleHole(x, y, r) { var p = new THREE.Path(); p.absarc(x, y, r, 0, Math.PI * 2, true); return p; }
    // Extruded panel plate: the front face sits on z = 0, UVs map the painted canvas across x0..x1, y0..y1.
    function panelPlate(shape, painter, x0, x1, y0, y1, depth) {
      var geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: 36 });
      var t = painter.tex;
      t.repeat.set(1 / (x1 - x0), 1 / (y1 - y0)); t.offset.set(-x0 / (x1 - x0), -y0 / (y1 - y0));
      var face = std({ map: t, roughness: 0.78, metalness: 0.12, emissive: 0x000000 });
      var m = mesh(geo, [face, MAT.edge], staticRoot, 0, 0, -depth);
      A.panelFaces = A.panelFaces || []; A.panelFaces.push(face);
      return m;
    }

    function paintUpperPanel(ctx, W, H) {
      var k = W / 0.92;
      function X(x) { return (x + 0.46) * k; }
      function Y(y) { return (UP_Y1 - y) * k; }
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#42464c'); g.addColorStop(1, '#34373c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      noise(ctx, W, H, 4000, 0.03, true); noise(ctx, W, H, 4000, 0.04, false);
      // recess shadows around instrument holes
      GAUGE_LAYOUT.concat([{ x: ADF_BLANK.x, y: ADF_BLANK.y, r: ADF_BLANK.r }]).forEach(function (q) {
        var rg = ctx.createRadialGradient(X(q.x), Y(q.y), q.r * k * 0.9, X(q.x), Y(q.y), (q.r + 0.006) * k);
        rg.addColorStop(0, 'rgba(0,0,0,0.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), (q.r + 0.006) * k, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(X(RADIO.x0 - 0.004), Y(RADIO.y1 + 0.004), (RADIO.x1 - RADIO.x0 + 0.008) * k, (RADIO.y1 - RADIO.y0 + 0.008) * k);
      // panel screws
      [[-0.452, 0.682], [-0.452, 0.438], [0.452, 0.682], [0.452, 0.438], [-0.03, 0.682], [0.20, 0.682], [0.20, 0.438], [-0.12, 0.438]].forEach(function (p) {
        screwHead(ctx, X(p[0]), Y(p[1]), 0.0028 * k);
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, H - 2);
    }

    function paintSubPanel(ctx, W, H) {
      var k = W / 0.92;
      function X(x) { return (x + 0.46) * k; }
      function Y(y) { return (SUB_Y1 - y) * k; }
      function L(s, x, y, mm, o) { text(ctx, s, X(x), Y(y), mm * k / 1000, o); }
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#41454b'); g.addColorStop(1, '#373a3f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      noise(ctx, W, H, 6000, 0.03, true); noise(ctx, W, H, 6000, 0.04, false);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, 0.0025 * k);
      // upper row labels (above the knobs)
      var yU = 0.4155;
      L('PARK BRAKE', KN.park, yU, 3.8);
      L('CARB HEAT', KN.carb, yU, 3.8);
      L('THROTTLE', KN.throttle, yU, 3.8);
      L('MIXTURE', KN.mixture, yU, 3.8);
      L('WING FLAPS', KN.flaps, yU, 3.8);
      L('CABIN AIR', KN.cabinAir, yU, 3.8);
      L('CABIN HT', KN.cabinHt, yU, 3.8);
      L('UP', KN.flaps + 0.019, ROW_U + 0.011, 3.0, { align: 'left' });
      L('DOWN', KN.flaps + 0.019, ROW_U - 0.012, 3.0, { align: 'left' });
      L('PULL ON', KN.carb, ROW_U - 0.0215, 2.6);
      L('PUSH OPEN', KN.throttle, ROW_U - 0.0262, 2.6);
      L('PUSH RICH', KN.mixture, ROW_U - 0.0235, 2.6);
      // lower row
      L('PRIMER', KN.primer, 0.2925, 3.4);
      L('MASTER', KN.master, 0.3435, 3.4);
      L('PANEL LT', KN.dimmer, 0.3435, 3.0);
      L('RADIO LT', KN.dimmer, 0.2925, 3.0);
      L('BRT', KN.dimmer + 0.021, ROW_L + 0.009, 2.4);
      ctx.strokeStyle = INK; ctx.lineWidth = 0.0005 * k;
      ctx.beginPath(); ctx.arc(X(KN.dimmer), Y(ROW_L), 0.0175 * k, -Math.PI * 0.55, -Math.PI * 0.05); ctx.stroke();
      ROCKERS.forEach(function (r, i) {
        var x = ROCKER_X0 + i * ROCKER_DX;
        L(r.label, x, 0.3405, 2.7, { max: 0.0195 * k });
        L('ON', x, 0.3285, 2.2);
        L('OFF', x, 0.2945, 2.2);
      });
      var lx0 = ROCKER_X0 + 3 * ROCKER_DX - 0.009, lx1 = ROCKER_X0 + 6 * ROCKER_DX + 0.009, ly = 0.3515;
      L('LIGHTS', (lx0 + lx1) / 2, ly, 2.7);
      ctx.beginPath();
      ctx.moveTo(X(lx0), Y(ly - 0.002)); ctx.lineTo(X(lx0), Y(ly)); ctx.lineTo(X((lx0 + lx1) / 2 - 0.009), Y(ly));
      ctx.moveTo(X((lx0 + lx1) / 2 + 0.009), Y(ly)); ctx.lineTo(X(lx1), Y(ly)); ctx.lineTo(X(lx1), Y(ly - 0.002));
      ctx.stroke();
      BREAKERS.forEach(function (b, i) {
        var x = BREAKER_X0 + i * BREAKER_DX;
        if (b.length === 1) L(b[0], x, 0.3335, 2.5, { max: 0.0195 * k });
        else { L(b[0], x, 0.3375, 2.4, { max: 0.0195 * k }); L(b[1], x, 0.3305, 2.4, { max: 0.0195 * k }); }
      });
      L('CIRCUIT BREAKERS — PUSH TO RESET', BREAKER_X0 + 5.5 * BREAKER_DX, 0.2895, 2.6);
      L('LIGHTER', KN.lighter, 0.3305, 2.6);
      [[-0.452, 0.42], [-0.452, 0.278], [0.268, 0.42], [0.268, 0.278], [-0.07, 0.278]].forEach(function (p) {
        screwHead(ctx, X(p[0]), Y(p[1]), 0.0026 * k);
      });
    }

    function buildPanel() {
      // upper instrument panel with round holes for every instrument and a rectangular radio-stack opening
      var upperPainter = painted(2048, 579, paintUpperPanel);
      var sh = panelShape(-0.46, 0.46, UP_Y0, UP_Y1, 0.008);
      GAUGE_LAYOUT.forEach(function (q) { sh.holes.push(circleHole(q.x, q.y, q.r * 0.985)); });
      sh.holes.push(circleHole(ADF_BLANK.x, ADF_BLANK.y, ADF_BLANK.r * 0.985));
      sh.holes.push(rectHole(RADIO.x0, RADIO.y0, RADIO.x1, RADIO.y1));
      [YOKE_PILOT_X, YOKE_COPILOT_X].forEach(function (x) { sh.holes.push(circleHole(x, YOKE_Y, 0.0145)); });
      panelPlate(sh, upperPainter, -0.46, 0.46, UP_Y0, UP_Y1, 0.012);
      sdeco(box(0.93, 0.27, 0.01), MAT.blackGloss, 0, 0.56, -0.07);            // dark backing behind the panel
      sdeco(box(0.93, 0.005, 0.014), MAT.blackGloss, 0, 0.4290, -0.004);       // seam between panel and subpanel

      // subpanel (knobs, switches, breakers) with holes for the two gauge clusters
      var subPainter = painted(4096, 704, paintSubPanel);
      var ss = panelShape(-0.46, 0.46, SUB_Y0, SUB_Y1, 0.006);
      CLUSTERS.forEach(function (c) { ss.holes.push(rectHole(c.x - c.w / 2 + 0.001, c.y - c.h / 2 + 0.001, c.x + c.w / 2 - 0.001, c.y + c.h / 2 - 0.001)); });
      panelPlate(ss, subPainter, -0.46, 0.46, SUB_Y0, SUB_Y1, 0.010);
      sdeco(rbox(0.93, 0.012, 0.03, 0.005), MAT.vinyl, 0, 0.266, -0.008);      // padded lower lip

      // round instruments
      GAUGE_LAYOUT.forEach(function (q) {
        var gG = new THREE.Group(); gG.position.set(q.x, q.y, 0); group.add(gG);
        addGauge(q.gid, q.id, gG, 0, 0, -0.0065, q.r, q.r, true);
        mesh(new THREE.TorusGeometry(q.r * 0.985, 0.0016, 6, 48), MAT.blackGloss, gG, 0, 0, 0.0002);
        mesh(new THREE.CircleGeometry(q.r * 0.94, 40), MAT.gaugeGlass, gG, 0, 0, -0.0018).renderOrder = 2;
        bind(gG, q.id);
        if (q.r < 0.035) proxy(q.id, gG, q.r * 2.3, q.r * 2.3, 0.02, 0, 0, 0);
        anchor(q.id, gG, 0, 0, 0, { kind: 'panel', d: q.r < 0.035 ? 0.26 : 0.30 });
      });
      // ADF position: blanking plate (no ADF fitted in this airplane)
      var blank = decal(ADF_BLANK.r * 2, ADF_BLANK.r * 2, 3000, function (ctx, w, h) {
        var r = w / 2, gr = ctx.createRadialGradient(r * 0.7, r * 0.6, r * 0.1, r, r, r);
        gr.addColorStop(0, '#2c2e31'); gr.addColorStop(1, '#141516');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(r, r, r * 0.99, 0, Math.PI * 2); ctx.fill();
        [45, 135, 225, 315].forEach(function (a) { screwHead(ctx, r + Math.cos(a * DEG) * r * 0.84, r + Math.sin(a * DEG) * r * 0.84, r * 0.06); });
      }, { transparent: true });
      blank.position.set(ADF_BLANK.x, ADF_BLANK.y, -0.004); staticRoot.add(blank);

      // N-number / model plate above the clock
      var plate = decal(0.066, 0.021, 7000, function (ctx, w, h) {
        var g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#d9dcdf'); g.addColorStop(0.5, '#b8bcc0'); g.addColorStop(1, '#cfd2d5');
        ctx.fillStyle = g; roundRectPath(ctx, 1, 1, w - 2, h - 2, h * 0.12); ctx.fill();
        for (var i = 0; i < 60; i++) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, Math.random() * h, w, 1); }
        text(ctx, 'CESSNA 150M', w / 2, h * 0.24, h * 0.2, { color: '#2a2d31', shadow: false, weight: 700 });
        text(ctx, 'CX-APR', w / 2, h * 0.64, h * 0.5, { color: '#15171a', shadow: false, weight: 700, font: FONT_MONO });
      }, { metal: 0.4, envMap: 0.3, rough: 0.35 });
      plate.position.set(fx(0.24), 0.648, 0.0015); staticRoot.add(plate);

      // HIGH VOLTAGE light (red lens) under the ammeter, with its placard
      var amX = fx(0.95);
      var hv = new THREE.Group(); hv.position.set(amX, 0.566, 0); group.add(hv);
      mesh(cylZ(0.0075, 0.0075, 0.004, 16), MAT.chrome, hv, 0, 0, 0.002);
      A.hvLens = mesh(new THREE.SphereGeometry(0.0058, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0x5a0e0b, roughness: 0.25, emissive: 0x000000 }), hv, 0, 0, 0.004);
      A.hvLens.rotation.x = Math.PI / 2;
      bind(hv, 'ammeter');
      proxy('ammeter', hv, 0.02, 0.02, 0.02, 0, 0, 0.005);
      var hvl = decal(0.04, 0.0075, 12000, function (ctx, w, h) {
        ctx.fillStyle = '#34373b'; ctx.fillRect(0, 0, w, h);
        text(ctx, 'HIGH VOLTAGE', w / 2, h / 2, h * 0.78, { weight: 700 });
      });
      hvl.position.set(amX, 0.5525, 0.0006); staticRoot.add(hvl);

      // maneuvers / limitations placard in the free space right of the tachometer
      A.placard = decal(0.104, 0.052, 9000, paintManeuverPlacard, { rough: 0.4 });
      A.placard.position.set(0.328, 0.615, 0.0008); group.add(A.placard);
      A.placardVariant = '150M';
      bind(A.placard, 'placards');
      anchor('placards', A.placard, 0, 0, 0.001, { kind: 'panel', d: 0.26 });

      buildRadioStack();
      buildClusters();
    }

    function paintManeuverPlacard(ctx, w, h) {
      var aero = A.placardVariant === 'A150M';
      ctx.fillStyle = '#121314'; roundRectPath(ctx, 0, 0, w, h, h * 0.04); ctx.fill();
      ctx.strokeStyle = '#8d9196'; ctx.lineWidth = h * 0.012; roundRectPath(ctx, h * 0.02, h * 0.02, w - h * 0.04, h - h * 0.04, h * 0.035); ctx.stroke();
      var lines = aero ? [
        ['THIS AIRPLANE MUST BE OPERATED AS AN ACROBATIC OR UTILITY', 1],
        ['CATEGORY AIRPLANE IN COMPLIANCE WITH THE OPERATING LIMITATIONS', 1],
        ['MANEUVERING SPEED 105 KIAS · GROSS WEIGHT 1600 LBS', 0],
        ['FLIGHT LOAD FACTOR (ACROBATIC) FLAPS UP +6.0 −3.0 · FLAPS DOWN +3.5', 0],
        ['ENTRY SPEEDS: CHANDELLES, LAZY EIGHTS 105 · STEEP TURNS 100', 0],
        ['BARREL ROLLS, AILERON ROLLS, LOOPS 115 · IMMELMANNS 130', 0],
        ['SNAP ROLLS 80 · SPINS AND STALLS: SLOW DECELERATION', 0],
        ['ABRUPT USE OF CONTROLS PROHIBITED ABOVE 105 KNOTS', 2],
        ['INVERTED FLIGHT PROHIBITED · NO ACROBATICS WITH FLAPS EXTENDED', 0],
        ['DAY · NIGHT · VFR · IFR (AS EQUIPPED)', 0]
      ] : [
        ['THIS AIRPLANE MUST BE OPERATED IN THE UTILITY CATEGORY', 1],
        ['IN COMPLIANCE WITH THE OPERATING LIMITATIONS IN THE POH', 1],
        ['MANEUVERING SPEED 97 KIAS · GROSS WEIGHT 1600 LBS', 0],
        ['FLIGHT LOAD FACTOR FLAPS UP +4.4 −1.76 · FLAPS DOWN +3.5', 0],
        ['MANEUVERS: CHANDELLES, LAZY EIGHTS, STEEP TURNS 95 KIAS', 0],
        ['SPINS AND STALLS (EXCEPT WHIP STALLS): SLOW DECELERATION', 0],
        ['ABRUPT USE OF CONTROLS PROHIBITED ABOVE 97 KNOTS', 2],
        ['SPIN RECOVERY: OPPOSITE RUDDER · FORWARD ELEVATOR · NEUTRALIZE', 0],
        ['NO SPINS WITH FLAPS DOWN · FLIGHT INTO KNOWN ICING PROHIBITED', 0],
        ['DAY · NIGHT · VFR · IFR (AS EQUIPPED)', 0]
      ];
      var y = h * 0.11, lh = h * 0.083;
      lines.forEach(function (l) {
        text(ctx, l[0], w / 2, y, lh * 0.82, { weight: l[1] ? 700 : 600, color: l[1] === 2 ? '#F2C14E' : INK, shadow: false, max: w * 0.93 });
        y += lh;
      });
    }

    function paintChecklist(ctx, w, h) {
      ctx.fillStyle = '#f1ede2'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c8641a'; ctx.fillRect(0, 0, w, h * 0.055);
      text(ctx, 'C150M PILOT CHECKLIST', w / 2, h * 0.029, h * 0.034, { color: '#fff', weight: 700, shadow: false, max: w * 0.92 });
      var y = h * 0.085, lh = h * 0.0275;
      function head(s) { y += lh * 0.35; text(ctx, s, w * 0.05, y, lh * 0.95, { align: 'left', color: '#13202b', weight: 700, shadow: false, max: w * 0.9 }); y += lh * 1.05; }
      function item(a, b) {
        text(ctx, a, w * 0.06, y, lh * 0.82, { align: 'left', color: '#22313d', weight: 600, shadow: false, max: w * 0.6 });
        text(ctx, b, w * 0.95, y, lh * 0.82, { align: 'right', color: '#22313d', weight: 700, shadow: false, max: w * 0.4 });
        y += lh;
      }
      head('BEFORE STARTING ENGINE');
      item('Preflight inspection', 'COMPLETE'); item('Seats, belts, harnesses', 'ADJUST, LOCK');
      item('Fuel shutoff valve', 'ON'); item('Radios, electrical', 'OFF'); item('Brakes', 'TEST, SET');
      item('Circuit breakers', 'CHECK IN');
      head('STARTING ENGINE');
      item('Mixture', 'RICH'); item('Carburetor heat', 'COLD'); item('Master switch', 'ON');
      item('Prime', 'AS REQUIRED'); item('Throttle', 'OPEN 1/4 IN'); item('Propeller area', 'CLEAR');
      item('Ignition switch', 'START'); item('Oil pressure', 'CHECK');
      head('BEFORE TAKEOFF');
      item('Cabin doors', 'CLOSED, LATCHED'); item('Parking brake', 'SET'); item('Flight controls', 'FREE, CORRECT');
      item('Flight instruments', 'SET'); item('Fuel shutoff valve', 'ON'); item('Mixture', 'RICH');
      item('Elevator trim', 'TAKEOFF'); item('Throttle', '1700 RPM');
      item('  Magnetos', 'MAX DROP 150'); item('  Carburetor heat', 'CHECK'); item('  Engine instruments', 'GREEN');
      item('  Suction', '4.6 – 5.4'); item('Radios', 'SET'); item('Throttle friction', 'ADJUST');
    }
    function paintDeviationCard(ctx, w, h) {
      ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(1, h * 0.02); ctx.strokeRect(1, 1, w - 2, h - 2);
      var heads = ['N', '30', '60', 'E', '120', '150', 'S', '210', '240', 'W', '300', '330'];
      var steer = ['0', '31', '61', '89', '119', '149', '180', '211', '241', '271', '300', '329'];
      var cw = (w * 0.86) / 12;
      text(ctx, 'FOR', w * 0.07, h * 0.36, h * 0.22, { color: '#111', shadow: false, weight: 700 });
      text(ctx, 'STEER', w * 0.07, h * 0.74, h * 0.2, { color: '#111', shadow: false, weight: 700, max: w * 0.12 });
      for (var i = 0; i < 12; i++) {
        text(ctx, heads[i], w * 0.14 + cw * (i + 0.5), h * 0.36, h * 0.24, { color: '#111', shadow: false, weight: 700, max: cw * 0.95 });
        text(ctx, steer[i], w * 0.14 + cw * (i + 0.5), h * 0.74, h * 0.24, { color: '#1d3f8c', shadow: false, weight: 600, max: cw * 0.95 });
      }
      ctx.fillStyle = '#222'; ctx.fillRect(w * 0.02, h * 0.55, w * 0.96, Math.max(1, h * 0.02));
    }
    // what the pilot sees in the mirror: headliner, the rear window with sky and a far tree line, the seat backs
    function paintMirror(ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8f8778'); g.addColorStop(0.24, '#b9b09c'); g.addColorStop(0.30, '#cfe0ee'); g.addColorStop(0.55, '#e4edf2');
      g.addColorStop(0.60, '#6e7a5e'); g.addColorStop(0.64, '#8c9a77'); g.addColorStop(0.70, '#6b6253'); g.addColorStop(1, '#3e3a33');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(160,150,132,0.9)'; ctx.fillRect(0, h * 0.27, w * 0.12, h * 0.4); ctx.fillRect(w * 0.88, h * 0.27, w * 0.12, h * 0.4);   // rear posts
      ['#3f5f86', '#3b5a80'].forEach(function (c, i) {                    // seat backs (light-blue fabric, dark trim)
        var x = i ? w * 0.53 : w * 0.07;
        ctx.fillStyle = '#25384f'; roundRectPath(ctx, x, h * 0.62, w * 0.40, h * 0.5, h * 0.12); ctx.fill();
        ctx.fillStyle = c; roundRectPath(ctx, x + w * 0.012, h * 0.68, w * 0.376, h * 0.5, h * 0.1); ctx.fill();
      });
      var v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.6);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(0, 0, w, h * 0.08);
      try { ctx.filter = 'blur(3px)'; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none'; } catch (e) { /* no canvas filters: stays sharp */ }
    }
    function paintMarkerBeacon(ctx, w, h) {
      ctx.fillStyle = '#1d1e20'; roundRectPath(ctx, 0, 0, w, h, h * 0.1); ctx.fill();
      text(ctx, 'MKR BCN', w * 0.5, h * 0.17, h * 0.17, { weight: 700 });
      ['O', 'M', 'I'].forEach(function (s, i) { text(ctx, s, w * (0.18 + i * 0.152), h * 0.86, h * 0.15); });
      text(ctx, 'HI', w * 0.67, h * 0.3, h * 0.14); text(ctx, 'LO', w * 0.67, h * 0.5, h * 0.14); text(ctx, 'TEST', w * 0.67, h * 0.72, h * 0.14);
      text(ctx, 'VOL', w * 0.87, h * 0.86, h * 0.14);
      ctx.fillStyle = '#8f9399'; ctx.fillRect(w * 0.735, h * 0.42, w * 0.02, h * 0.18);
    }
    function paintAudioPanel(ctx, w, h) {
      ctx.fillStyle = '#1d1e20'; roundRectPath(ctx, 0, 0, w, h, h * 0.1); ctx.fill();
      text(ctx, 'AUDIO', w * 0.5, h * 0.15, h * 0.15, { weight: 700 });
      [['TRANS', 0.135], ['COM 1', 0.365], ['COM 2', 0.56], ['ADF', 0.75]].forEach(function (l) { text(ctx, l[0], w * l[1], h * 0.86, h * 0.15); });
      text(ctx, '1', w * 0.2, h * 0.36, h * 0.13); text(ctx, '2', w * 0.2, h * 0.64, h * 0.13);
      text(ctx, 'SPKR', w * 0.92, h * 0.3, h * 0.12); text(ctx, 'OFF', w * 0.92, h * 0.5, h * 0.12); text(ctx, 'PHONE', w * 0.92, h * 0.7, h * 0.12, { max: w * 0.14 });
    }

    function buildRadioStack() {
      var cx = (RADIO.x0 + RADIO.x1) / 2;
      sdeco(box(RADIO.x1 - RADIO.x0, RADIO.y1 - RADIO.y0, 0.004), MAT.blackGloss, cx, (RADIO.y0 + RADIO.y1) / 2, -0.09);
      [[RADIO.x0 + 0.001, 0], [RADIO.x1 - 0.001, 0]].forEach(function (p) {
        sdeco(box(0.002, RADIO.y1 - RADIO.y0, 0.09), MAT.edge, p[0], (RADIO.y0 + RADIO.y1) / 2, -0.045);
      });
      // Nav/Com (top) and transponder
      [['navcom', 0.657], ['transponder', 0.598]].forEach(function (r) {
        var rg = new THREE.Group(); rg.position.set(cx, r[1], 0); group.add(rg);
        mesh(rbox(0.166, 0.055, 0.03, 0.003), MAT.radioPlate, rg, 0, 0, -0.016);
        addGauge(r[0], r[0], rg, 0, 0, -0.0005, 0.16, 0.05, false);
        mesh(box(0.164, 0.053, 0.08), MAT.blackGloss, rg, 0, 0, -0.07);
        bind(rg, r[0]);
        anchor(r[0], rg, 0, 0, 0, { kind: 'panel', d: 0.30 });
      });
      // blank radio covers below (space for ADF / extra radios)
      [[0.530, 0.062], [0.467, 0.056]].forEach(function (b) {
        var d = decal(0.164, b[1], 3000, function (ctx, w, h) {
          ctx.fillStyle = '#2f3134'; ctx.fillRect(0, 0, w, h);
          noise(ctx, w, h, 600, 0.06, true);
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
          [[0.04, 0.2], [0.96, 0.2], [0.04, 0.8], [0.96, 0.8]].forEach(function (p) { screwHead(ctx, w * p[0], h * p[1], h * 0.06); });
        });
        d.position.set(cx, b[0], -0.002); staticRoot.add(d);
      });
    }

    function buildClusters() {
      CLUSTERS.forEach(function (c) {
        var cg = new THREE.Group(); cg.position.set(c.x, c.y, 0); group.add(cg);
        addGauge(c.gid, c.id, cg, 0, 0, -0.004, c.w, c.h, false);
        var fr = 0.0025;
        mesh(box(c.w + 2 * fr, fr, 0.003), MAT.chrome, cg, 0, c.h / 2 + fr / 2, 0.0005);
        mesh(box(c.w + 2 * fr, fr, 0.003), MAT.chrome, cg, 0, -c.h / 2 - fr / 2, 0.0005);
        mesh(box(fr, c.h, 0.003), MAT.chrome, cg, c.w / 2 + fr / 2, 0, 0.0005);
        mesh(box(fr, c.h, 0.003), MAT.chrome, cg, -c.w / 2 - fr / 2, 0, 0.0005);
        mesh(new THREE.PlaneGeometry(c.w, c.h), MAT.gaugeGlass, cg, 0, 0, -0.001).renderOrder = 2;
        bind(cg, c.id);
        anchor(c.id, cg, 0, 0, 0, c.id === 'fuel-gauges' ? { kind: 'custom', position: V(c.x - 0.065, 0.42, 0.26), target: V(c.x, c.y, 0) }
          : { kind: 'sub', d: 0.27 });
      });
    }

    /* ================================================================== GAUGE TEXTURES */
    function addGauge(gid, controlId, parent, x, y, z, w, h, round) {
      var sz = (Gauges && Gauges.size) ? Gauges.size(gid) : { w: 256, h: round ? 256 : 128 };
      var cv = makeCanvas(sz.w, sz.h);
      var tex = canvasTex(cv);
      var mat = std({ map: tex, emissiveMap: tex, emissive: 0x555555, roughness: 0.55, metalness: 0, alphaTest: round ? 0.5 : 0 });
      mat.toneMapped = false;               // dials stay crisp and true to colour under ACES (RENDERING NOTES, core.js)
      mat.userData.noAo = true;             // and keep their full ambient light (readability)
      var geo = round ? new THREE.CircleGeometry(w, 48) : new THREE.PlaneGeometry(w, h);
      var face = mesh(geo, mat, parent, x, y, z);
      face.userData.noCast = true;
      var rec = { gid: gid, canvas: cv, ctx: cv.getContext('2d'), tex: tex, mesh: face, sig: null, dirty: true, w: sz.w, h: sz.h };
      gauges.push(rec);
      drawGauge(rec, null);
      return face;
    }
    function drawGauge(rec, state) {
      var ok = false;
      if (Gauges && Gauges.draw) {
        try { Gauges.draw(rec.gid, rec.ctx, rec.w, rec.h, state || undefined); ok = true; } catch (e) { ok = false; }
      }
      if (!ok) {
        var c = rec.ctx; c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = '#111'; c.fillRect(0, 0, rec.w, rec.h);
        text(c, rec.gid.toUpperCase(), rec.w / 2, rec.h / 2, Math.min(rec.w, rec.h) * 0.1);
      }
      rec.tex.needsUpdate = true;
    }

    /* ================================================================== SUBPANEL CONTROLS */
    function knurled(r, len, faceMat, parent, z) {
      var g = new THREE.CylinderGeometry(r, r, len, 28, 1);
      g.rotateX(Math.PI / 2);
      return mesh(g, [MAT.knurl, faceMat || MAT.chrome, MAT.chrome], parent, 0, 0, z + len / 2);
    }
    // Push-pull knob: base on the panel, 'slide' moves out along +Z.
    function pushPull(id, x, y, kind) {
      var base = new THREE.Group(); base.position.set(x, y, 0); group.add(base);
      mesh(cylZ(0.0085, 0.0085, 0.004, 20), MAT.chrome, base, 0, 0, 0.002);       // panel bushing nut
      var slide = new THREE.Group(); base.add(slide);
      mesh(cylZ(0.0035, 0.0035, 0.09, 10), MAT.chrome, slide, 0, 0, -0.04);       // shaft
      var knob = new THREE.Group(); knob.position.z = 0.004; slide.add(knob);
      if (kind === 'throttle') {
        mesh(latheZ([[0, 0], [0.012, 0], [0.019, 0.004], [0.0195, 0.016], [0.017, 0.022], [0.0, 0.023]], 32), MAT.blackGloss, knob, 0, 0, 0);
        mesh(new THREE.CircleGeometry(0.0115, 28), MAT.white, knob, 0, 0, 0.0232);
      } else if (kind === 'mixture') {
        var st = new THREE.Shape(), n = 14, i;
        for (i = 0; i <= n * 2; i++) {
          var a = i / (n * 2) * Math.PI * 2, rr = (i % 2) ? 0.0148 : 0.0168;
          if (i === 0) st.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else st.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        mesh(new THREE.ExtrudeGeometry(st, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0012, bevelSegments: 2 }), MAT.red, knob, 0, 0, 0.002);
        mesh(cylZ(0.0055, 0.0055, 0.006, 16), MAT.chrome, knob, 0, 0, 0.019);    // lock button
      } else if (kind === 'carb') {
        knurled(0.0125, 0.016, MAT.chrome, knob, 0);
        mesh(new THREE.CircleGeometry(0.007, 20), MAT.blackGloss, knob, 0, 0, 0.0162);
      } else if (kind === 'primer') {
        knurled(0.011, 0.02, MAT.chrome, knob, 0);
        mesh(box(0.012, 0.0016, 0.0006), MAT.black, knob, 0, 0, 0.0204);        // index mark (shows the lock twist)
      } else {
        knurled(0.0125, 0.017, MAT.chrome, knob, 0);
      }
      bind(knob, id);
      proxy(id, slide, 0.036, 0.036, 0.03, 0, 0, 0.014);
      anchor(id, slide, 0, 0, 0.012, { kind: 'sub', d: 0.27 });
      return { base: base, slide: slide, knob: knob };
    }
    function rockerSwitch(id, subId, x, y, w, h, mat, parent, labelTex) {
      var g = new THREE.Group(); g.position.set(x, y, 0); (parent || group).add(g);
      mesh(box(w + 0.004, h + 0.004, 0.003), MAT.blackGloss, g, 0, 0, 0.0015);
      var piv = new THREE.Group(); piv.position.z = 0.003; g.add(piv);
      mesh(rbox(w, h, 0.008, 0.0015), mat, piv, 0, 0, 0.002);
      if (labelTex) {
        var lm = mesh(new THREE.PlaneGeometry(w * 0.9, w * 0.62), std({ map: labelTex, transparent: true, roughness: 0.5 }), piv, 0, h * 0.18, 0.0062);
        lm.renderOrder = 1;
      }
      bind(g, id, subId);
      proxy(id, g, w + 0.006, h + 0.008, 0.02, 0, 0, 0.006, subId);
      return piv;
    }
    function textTex(s, color, w, h) {
      return painted(w || 128, h || 88, function (ctx, cw, ch) { text(ctx, s, cw / 2, ch / 2, ch * 0.7, { color: color, weight: 700, shadow: false, max: cw * 0.9 }); }).tex;
    }

    function buildSubpanelControls() {
      A.park = pushPull('parking-brake', KN.park, ROW_U, 'chrome');
      A.primer = pushPull('primer', KN.primer, ROW_L, 'primer');
      A.carb = pushPull('carb-heat', KN.carb, ROW_U, 'carb');
      A.throttle = pushPull('throttle', KN.throttle, ROW_U, 'throttle');
      A.mixture = pushPull('mixture', KN.mixture, ROW_U, 'mixture');
      A.cabinAir = pushPull('cabin-air', KN.cabinAir, ROW_U, 'chrome');
      A.cabinHt = pushPull('cabin-heat', KN.cabinHt, ROW_U, 'chrome');
      // throttle friction-lock disk (knurled, fixed on the panel)
      var fr = new THREE.CylinderGeometry(0.0225, 0.0225, 0.005, 36); fr.rotateX(Math.PI / 2);
      bind(mesh(fr, [MAT.knurl, MAT.darkSteel, MAT.darkSteel], group, KN.throttle, ROW_U, 0.0035), 'throttle');
      dragAxes.throttle = { axis: V(0, 0, -1), length: KNOB_TRAVEL, out: V(0, 0, 1) };
      dragAxes.mixture = { axis: V(0, 0, -1), length: KNOB_TRAVEL, out: V(0, 0, 1) };
      dragAxes['carb-heat'] = { axis: V(0, 0, 1), length: KNOB_TRAVEL, out: V(0, 0, 1) };
      dragAxes['cabin-heat'] = { axis: V(0, 0, 1), length: KNOB_TRAVEL, out: V(0, 0, 1) };
      dragAxes['cabin-air'] = { axis: V(0, 0, 1), length: KNOB_TRAVEL, out: V(0, 0, 1) };
      dragAxes.primer = { axis: V(0, 0, 1), length: 0.05, out: V(0, 0, 1) };

      // MASTER: red split rocker, ALT (left half) | BAT (right half)
      var mg = new THREE.Group(); mg.position.set(KN.master, ROW_L, 0); group.add(mg);
      mesh(box(0.034, 0.032, 0.003), MAT.blackGloss, mg, 0, 0, 0.0015);
      A.masterAlt = rockerSwitch('master', 'alt', -0.0075, 0, 0.0135, 0.027, MAT.red, mg, textTex('ALT', '#ffffff'));
      A.masterBat = rockerSwitch('master', 'bat', 0.0075, 0, 0.0135, 0.027, MAT.red, mg, textTex('BAT', '#ffffff'));
      anchor('master', mg, 0, 0, 0.008, { kind: 'sub', d: 0.24 });

      // IGNITION key switch: OFF – R – L – BOTH – START (clockwise)
      var ig = new THREE.Group(); ig.position.set(KN.ignition, ROW_L, 0); group.add(ig);
      mesh(new THREE.TorusGeometry(0.0175, 0.0025, 8, 32), MAT.chrome, ig, 0, 0, 0.002);
      var face = decal(0.036, 0.036, 9000, function (ctx, w, h) {
        var r = w / 2;
        ctx.fillStyle = '#121212'; ctx.beginPath(); ctx.arc(r, r, r * 0.97, 0, Math.PI * 2); ctx.fill();
        [['OFF', -60], ['R', -30], ['L', 0], ['BOTH', 30], ['START', 60]].forEach(function (p) {
          var a = (p[1] - 90) * DEG, rr = r * 0.72;
          ctx.save(); ctx.translate(r + Math.cos(a) * rr, r + Math.sin(a) * rr); ctx.rotate(p[1] * DEG);
          text(ctx, p[0], 0, 0, r * (p[0].length > 3 ? 0.2 : 0.24), { weight: 700 });
          ctx.restore();
        });
      }, { transparent: true });
      face.position.z = 0.0035; ig.add(face);
      mesh(cylZ(0.0085, 0.0085, 0.006, 20), MAT.chrome, ig, 0, 0, 0.005);
      A.key = new THREE.Group(); A.key.position.z = 0.008; ig.add(A.key);
      mesh(box(0.0035, 0.012, 0.012), MAT.steel, A.key, 0, 0.0, 0.006);
      mesh(rbox(0.018, 0.024, 0.0045, 0.004), MAT.black, A.key, 0, 0.004, 0.0155);
      mesh(box(0.004, 0.006, 0.0047), MAT.steel, A.key, 0, 0.012, 0.0155);
      bind(ig, 'ignition');
      proxy('ignition', ig, 0.04, 0.04, 0.035, 0, 0, 0.012);
      // seen from the left: the control-lock flag hangs right in front of the key when it is installed (as in the real
      // airplane, so nobody starts the engine with the lock in)
      anchor('ignition', ig, 0, 0, 0.01, { kind: 'custom', position: V(KN.ignition - 0.16, 0.34, 0.17), target: V(KN.ignition, ROW_L, 0.01) });

      // PANEL LT / RADIO LT concentric dimmer
      var dg = new THREE.Group(); dg.position.set(KN.dimmer, ROW_L, 0); group.add(dg);
      mesh(cylZ(0.007, 0.007, 0.004, 16), MAT.chrome, dg, 0, 0, 0.002);
      A.dimmerOuter = new THREE.Group(); dg.add(A.dimmerOuter);
      knurled(0.0125, 0.011, MAT.blackGloss, A.dimmerOuter, 0.004).material = [MAT.black, MAT.blackGloss, MAT.black];
      mesh(box(0.0016, 0.007, 0.0008), MAT.white, A.dimmerOuter, 0, 0.0085, 0.0154);
      knurled(0.0072, 0.012, MAT.blackGloss, dg, 0.015).material = [MAT.black, MAT.blackGloss, MAT.black];
      bind(dg, 'dimmers');
      proxy('dimmers', dg, 0.032, 0.032, 0.035, 0, 0, 0.012);
      anchor('dimmers', dg, 0, 0, 0.012, { kind: 'sub', d: 0.24 });

      // seven white rockers (DOME LT, PITOT HT, NAV, STROBE, BCN, TAXI, LDG)
      A.rockers = {};
      ROCKERS.forEach(function (r, i) {
        A.rockers[r.sub] = rockerSwitch('light-switches', r.sub, ROCKER_X0 + i * ROCKER_DX, ROW_L, 0.012, 0.022, MAT.white);
      });
      anchor('light-switches', group, ROCKER_X0 + 3 * ROCKER_DX, ROW_L, 0.01, { kind: 'sub', d: 0.28 });

      // WING FLAPS toggle (1976): flap-shaped white handle, UP / OFF / DOWN (DOWN spring-loaded)
      var fg = new THREE.Group(); fg.position.set(KN.flaps, ROW_U, 0); group.add(fg);
      mesh(cylZ(0.0085, 0.0085, 0.004, 6), MAT.chrome, fg, 0, 0, 0.002);
      A.flapLever = new THREE.Group(); A.flapLever.position.z = 0.004; fg.add(A.flapLever);
      mesh(cylZ(0.0022, 0.0022, 0.014, 8), MAT.chrome, A.flapLever, 0, 0, 0.007);
      var fs = new THREE.Shape();
      fs.moveTo(-0.0115, 0); fs.lineTo(0.0115, 0); fs.lineTo(0.009, 0.016); fs.quadraticCurveTo(0, 0.019, -0.009, 0.016); fs.lineTo(-0.0115, 0);
      var fh = mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.0008, bevelSegments: 1 }), MAT.white, A.flapLever, 0, 0.0025, 0.012);
      fh.rotation.x = Math.PI / 2;
      bind(fg, 'flap-switch');
      proxy('flap-switch', fg, 0.032, 0.04, 0.04, 0, 0, 0.015);
      anchor('flap-switch', fg, 0, 0, 0.012, { kind: 'sub', d: 0.25 });

      // circuit breakers (one row in 1976): black push-to-reset buttons
      var flapFace = painted(64, 64, function (ctx, w, h) {
        ctx.fillStyle = '#101010'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); ctx.fill();
        text(ctx, '15', w / 2, h / 2 + 2, h * 0.5, { weight: 700, shadow: false });
      }).tex;
      var cbg = new THREE.Group(); group.add(cbg);
      BREAKERS.forEach(function (b, i) {
        var x = BREAKER_X0 + i * BREAKER_DX;
        mesh(cylZ(0.0072, 0.0072, 0.003, 6), MAT.chrome, cbg, x, ROW_L, 0.0015);
        var btn = mesh(cylZ(0.0052, 0.0052, 0.007, 16), MAT.blackGloss, cbg, x, ROW_L, 0.0065);
        mesh(new THREE.CircleGeometry(0.0046, 16), b[0] === 'FLAP' ? std({ map: flapFace, roughness: 0.4 }) : MAT.blackGloss, cbg, x, ROW_L, 0.0101);
      });
      bind(cbg, 'circuit-breakers');
      proxy('circuit-breakers', cbg, BREAKER_DX * 12, 0.02, 0.025, BREAKER_X0 + 5.5 * BREAKER_DX, ROW_L, 0.008);
      anchor('circuit-breakers', cbg, BREAKER_X0 + 5.5 * BREAKER_DX, ROW_L, 0.008, { kind: 'sub', d: 0.32 });

      // cigar lighter and map compartment (decoration)
      sdeco(cylZ(0.009, 0.009, 0.006, 20), MAT.chrome, KN.lighter, ROW_L, 0.003);
      sdeco(new THREE.CircleGeometry(0.0062, 20), MAT.blackGloss, KN.lighter, ROW_L, 0.0062);
      sdeco(rbox(0.172, 0.142, 0.008, 0.004), std({ color: 0x3e4146, roughness: 0.7, metalness: 0.1 }), 0.3635, 0.349, 0.003);
      sdeco(rbox(0.05, 0.008, 0.004, 0.002), MAT.blackGloss, 0.3635, 0.405, 0.0085);
      sdeco(cylZ(0.004, 0.004, 0.004, 12), MAT.chrome, 0.3635, 0.405, 0.0105);

      // floor heat outlets under the panel
      [-0.27, 0.27].forEach(function (x) {
        var hg = new THREE.Group(); hg.position.set(x, 0.252, -0.06); group.add(hg);
        mesh(box(0.08, 0.02, 0.045), MAT.black, hg, 0, 0, 0);
        var gr = mesh(new THREE.PlaneGeometry(0.07, 0.035), std({ map: grilleTex, roughness: 0.8 }), hg, 0, -0.0105, 0);
        gr.rotation.x = Math.PI / 2;
        bind(hg, 'cabin-heat');
      });
    }

    /* ================================================================== PEDESTAL, TRIM WHEEL, MICROPHONE */
    // Narrow tapered console under the centre of the subpanel (research: ≈ 0.15 m wide at the top, ≈ 0.11 m at the
    // floor, a few cm proud of the panel): painted like the panel, rounded vertical edges, the trim wheel's ribbed rim
    // standing out of a slot in its face, the NOSE DN / TAKE OFF / NOSE UP indicator on its left, the mic hook on its right.
    var PED = { cx: -0.032, wTop: 0.140, wBot: 0.104, face: 0.032, back: -0.11, wheelX: -0.020, wheelY: 0.148, wheelR: 0.068 };
    function buildPedestal() {
      var hTop = SUB_Y0 - 0.004;
      var sh = new THREE.Shape();
      sh.moveTo(-PED.wBot / 2, 0); sh.lineTo(PED.wBot / 2, 0); sh.lineTo(PED.wTop / 2, hTop); sh.lineTo(-PED.wTop / 2, hTop); sh.closePath();
      var bev = 0.007, depth = PED.face - PED.back - 2 * bev;
      var body = new THREE.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 3, curveSegments: 4 });
      var pm = mesh(body, [MAT.edge, MAT.edge], staticRoot, PED.cx, 0, PED.back + bev);
      pm.userData.decor = true;
      // slot for the wheel rim (dark recess) and its lips
      var slotW = 0.024, slotH = 0.118;
      sdeco(box(slotW, slotH, 0.004), MAT.black, PED.cx + PED.wheelX, PED.wheelY, PED.face + 0.0005);
      sdeco(box(slotW + 0.006, 0.004, 0.006), MAT.blackGloss, PED.cx + PED.wheelX, PED.wheelY + slotH / 2 + 0.002, PED.face + 0.001);
      sdeco(box(slotW + 0.006, 0.004, 0.006), MAT.blackGloss, PED.cx + PED.wheelX, PED.wheelY - slotH / 2 - 0.002, PED.face + 0.001);
      var lab = decal(0.074, 0.012, 9000, function (ctx, w, h) {
        ctx.fillStyle = '#2b2e32'; ctx.fillRect(0, 0, w, h);
        text(ctx, 'ELEVATOR TRIM', w / 2, h / 2, h * 0.7, { weight: 700 });
      });
      lab.position.set(PED.cx - 0.006, 0.236, PED.face + 0.0035); staticRoot.add(lab);
      var nose = decal(0.030, 0.012, 9000, function (ctx, w, h) {
        ctx.fillStyle = '#2b2e32'; ctx.fillRect(0, 0, w, h);
        text(ctx, 'NOSE DN ▲', w / 2, h / 2, h * 0.55, { weight: 700 });
      });
      nose.position.set(PED.cx + PED.wheelX + 0.0, PED.wheelY + slotH / 2 + 0.012, PED.face + 0.0035); staticRoot.add(nose);

      // trim wheel: vertical, rotates about X; its ribbed rim stands ≈ 12 mm out of the face
      var tw = new THREE.Group(); tw.position.set(PED.cx + PED.wheelX, PED.wheelY, PED.face + 0.012 - PED.wheelR); group.add(tw);
      A.trimWheel = new THREE.Group(); tw.add(A.trimWheel);
      var wg = new THREE.CylinderGeometry(PED.wheelR, PED.wheelR, 0.016, 64, 1); wg.rotateZ(Math.PI / 2);
      mesh(wg, [std({ map: ribTex, roughness: 0.55 }, D.stipple), MAT.satin, MAT.satin], A.trimWheel, 0, 0, 0);
      mesh(box(0.0175, 0.004, 0.012), MAT.white, A.trimWheel, 0, PED.wheelR - 0.002, 0);   // index mark on the rim
      bind(tw, 'trim-wheel');
      proxy('trim-wheel', group, 0.03, 0.14, 0.04, PED.cx + PED.wheelX, PED.wheelY, PED.face + 0.01);
      // NOSE DN / TAKE OFF / NOSE UP indicator to the LEFT of the wheel, in a bezel
      var ti = new THREE.Group(); ti.position.set(PED.cx + PED.wheelX - 0.036, PED.wheelY, PED.face); group.add(ti);
      mesh(rbox(0.030, 0.084, 0.004, 0.0015), MAT.blackGloss, ti, 0, 0, 0.0012);
      addGauge('trim-indicator', 'trim-wheel', ti, 0, 0, 0.0034, 0.024, 0.077, false);
      bind(ti, 'trim-wheel');
      anchor('trim-wheel', group, PED.cx + PED.wheelX - 0.012, PED.wheelY, PED.face + 0.01, { kind: 'pedestal', d: 0.30 });
      dragAxes['trim-wheel'] = { axis: V(0, -1, 0), length: 0.12, out: V(0, 0, 1) };

      // hand microphone hung on its hook on the right side of the pedestal, coiled cord down to the floor
      var X1 = PED.cx + PED.wTop / 2 - 0.004;
      var mic = new THREE.Group(); group.add(mic);
      mesh(box(0.004, 0.006, 0.026), MAT.chrome, mic, X1 + 0.002, 0.236, PED.face - 0.006);
      mesh(box(0.004, 0.016, 0.004), MAT.chrome, mic, X1 + 0.002, 0.243, PED.face + 0.006);
      var body = new THREE.Group(); body.position.set(X1 + 0.022, 0.196, PED.face - 0.006); body.rotation.z = 0.08; mic.add(body);
      mesh(rbox(0.042, 0.066, 0.026, 0.011), MAT.satin, body, 0, 0, 0);
      mesh(new THREE.CircleGeometry(0.0135, 24), std({ map: grilleTex, roughness: 0.8 }), body, 0, 0.012, 0.0132);
      mesh(box(0.004, 0.022, 0.012), MAT.darkSteel, body, -0.022, 0.002, 0);                // press-to-talk bar
      var A0 = V(X1 + 0.024, 0.162, PED.face - 0.006), B0 = V(X1 + 0.006, 0.02, -0.07);
      var coil = new THREE.Curve();
      coil.getPoint = function (t, target) {
        var p = target || new V3(), turns = 16, rr = 0.0065, a = t * turns * Math.PI * 2;
        p.copy(A0).lerp(B0, t);
        p.x += Math.cos(a) * rr; p.z += Math.sin(a) * rr; p.y += Math.sin(t * Math.PI) * -0.03;
        return p;
      };
      mesh(new THREE.TubeGeometry(coil, 360, 0.0017, 5, false), MAT.satin, mic, 0, 0, 0);
      bind(mic, 'microphone');
      proxy('microphone', mic, 0.06, 0.09, 0.05, X1 + 0.022, 0.196, PED.face - 0.006);
      anchor('microphone', mic, X1 + 0.022, 0.196, PED.face + 0.008, { kind: 'pedestal', d: 0.32 });
    }

    /* ================================================================== CONTROL WHEELS AND LOCK */
    function buildYoke(x, pilot) {
      var base = new THREE.Group(); base.position.set(x, YOKE_Y, 0); group.add(base);
      var collar = new THREE.Group(); base.add(collar);
      mesh(new THREE.TorusGeometry(0.0165, 0.0042, 10, 28), MAT.chrome, collar, 0, 0, 0.003);
      mesh(cylZ(0.019, 0.019, 0.003, 24), MAT.blackGloss, collar, 0, 0, 0.0005);
      if (pilot) {
        mesh(cylZ(0.0035, 0.0035, 0.006, 8), MAT.blackGloss, collar, 0, 0.0165, 0.004);      // lock hole boss
        bind(collar, 'control-lock');
        proxy('control-lock', collar, 0.046, 0.046, 0.016, 0, 0, 0.005);
      }
      var slide = new THREE.Group(); base.add(slide);
      var shaft = mesh(cylZ(0.0125, 0.0125, 0.46, 18), MAT.steel, slide, 0, 0, YOKE_Z - 0.035 - 0.23);
      var wheel = new THREE.Group(); wheel.position.z = YOKE_Z; slide.add(wheel);
      mesh(rbox(0.15, 0.072, 0.06, 0.022, 3), MAT.satin, wheel, 0, 0, 0);
      mesh(rbox(0.11, 0.04, 0.008, 0.004), MAT.black, wheel, 0, 0.004, 0.03);
      var em = mesh(new THREE.CircleGeometry(0.012, 24), MAT.chrome, wheel, 0, 0.004, 0.0345);
      em.scale.set(1.7, 1, 1);
      [-1, 1].forEach(function (s) {
        var pts = [V(0.055 * s, -0.004, 0), V(0.098 * s, -0.012, 0.004), V(0.127 * s, 0.006, 0.006), V(0.139 * s, 0.045, 0.006), V(0.135 * s, 0.086, 0)];
        mesh(tubeGeo(pts, 0.0138, 28, 12), MAT.satin, wheel, 0, 0, 0);
        mesh(new THREE.SphereGeometry(0.0138, 12, 8), MAT.satin, wheel, 0.135 * s, 0.086, 0);
      });
      bind(wheel, 'yoke'); bind(shaft, 'yoke');
      return { base: base, slide: slide, wheel: wheel };
    }
    function buildControlLock() {
      var lg = new THREE.Group(); lg.position.set(YOKE_PILOT_X, YOKE_Y, 0); group.add(lg);
      mesh(tubeGeo([V(0, 0.002, -0.01), V(0, 0.026, 0.012), V(0, 0.03, 0.03), V(-0.014, 0.012, 0.05), V(-0.024, -0.012, 0.058)], 0.0032, 24, 8), MAT.steel, lg, 0, 0, 0);
      var flag = decal(0.072, 0.16, 4000, function (ctx, w, h) {
        ctx.fillStyle = '#c21f17'; roundRectPath(ctx, 0, 0, w, h, w * 0.06); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w * 0.03; roundRectPath(ctx, w * 0.05, w * 0.05, w * 0.9, h - w * 0.1, w * 0.05); ctx.stroke();
        var lines = ['CONTROL', 'LOCK', '', 'REMOVE', 'BEFORE', 'STARTING', 'ENGINE'];
        lines.forEach(function (l, i) { if (l) text(ctx, l, w / 2, h * (0.14 + i * 0.12), w * (i < 2 ? 0.2 : 0.16), { weight: 700, color: '#ffffff', shadow: false, max: w * 0.85 }); });
      }, { side: THREE.DoubleSide });
      flag.position.set(-0.026, -0.094, 0.06); lg.add(flag);
      mesh(cylZ(0.004, 0.004, 0.004, 10), MAT.steel, lg, -0.024, -0.014, 0.06);
      bind(lg, 'control-lock');
      proxy('control-lock', lg, 0.08, 0.17, 0.02, -0.026, -0.094, 0.06);
      A.controlLock = lg;
      anchor('control-lock', group, YOKE_PILOT_X, YOKE_Y - 0.03, 0.03, { kind: 'custom', position: V(YOKE_PILOT_X - 0.16, 0.40, 0.30), target: V(YOKE_PILOT_X, YOKE_Y - 0.04, 0.03) });
    }

    /* ================================================================== RUDDER PEDALS */
    var PAD_TILT = 16 * DEG;
    function buildPedals() {
      A.pedals = [];
      [[-0.33, -1], [-0.15, 1], [0.15, -1], [0.33, 1]].forEach(function (p) {
        var side = p[1] < 0 ? 'left' : 'right';
        var g = new THREE.Group(); g.position.set(p[0], 0.04, -0.37); group.add(g);
        mesh(box(0.012, 0.05, 0.012), MAT.darkSteel, g, 0, -0.012, -0.004);
        var pad = new THREE.Group(); pad.rotation.x = PAD_TILT; g.add(pad);
        var lower = new THREE.Group(); pad.add(lower);
        mesh(rbox(0.085, 0.105, 0.012, 0.004), MAT.darkSteel, lower, 0, 0.0725, 0);
        [0.045, 0.065, 0.085, 0.105].forEach(function (y) { mesh(box(0.075, 0.006, 0.004), MAT.rubber, lower, 0, y, 0.007); });
        mesh(box(0.02, 0.03, 0.03), MAT.darkSteel, lower, 0, 0.03, -0.018);
        var upper = new THREE.Group(); pad.add(upper);
        mesh(rbox(0.085, 0.07, 0.012, 0.004), MAT.darkSteel, upper, 0, 0.165, 0.001);
        [0.15, 0.17, 0.19].forEach(function (y) { mesh(box(0.075, 0.006, 0.004), MAT.rubber, upper, 0, y, 0.008); });
        bind(lower, 'rudder-pedals', side);
        bind(upper, 'toe-brakes', side);
        proxy('rudder-pedals', pad, 0.095, 0.11, 0.03, 0, 0.072, 0.01, side);
        proxy('toe-brakes', pad, 0.095, 0.075, 0.03, 0, 0.166, 0.01, side);
        A.pedals.push({ group: g, pad: pad, side: p[1], z0: -0.37 });
      });
      // rudder-bar torque tubes and brake master cylinders ahead of the pilot pedals
      [-0.24, 0.24].forEach(function (x) { var t = sdeco(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 12), MAT.darkSteel, x, 0.022, -0.40); t.rotation.z = Math.PI / 2; });
      [-0.33, -0.15].forEach(function (x) { var c = sdeco(new THREE.CylinderGeometry(0.011, 0.011, 0.09, 12), MAT.steel, x, 0.14, -0.46); c.rotation.x = 0.6; });
      // the pedals sit UNDER the panel: look at them from the cabin side, below the panel's lower edge (y 0.266)
      anchor('rudder-pedals', group, -0.24, 0.10, -0.33, { kind: 'custom', position: V(-0.16, 0.33, 0.30), target: V(-0.24, 0.12, -0.33) });
      anchor('toe-brakes', group, -0.24, 0.20, -0.31, { kind: 'custom', position: V(-0.16, 0.28, 0.27), target: V(-0.24, 0.16, -0.30) });
    }

    /* ================================================================== SEATS, BELTS, FUEL VALVE */
    function buildSeat(cx, inb) {
      var s = new THREE.Group(); s.position.set(cx, 0, 0.49); group.add(s);
      // inb = +1 if the inboard side (cabin centre) is +X for this seat
      var cushion = mesh(rbox(0.40, 0.085, 0.46, 0.03, 3), MAT.seat, s, 0, 0.1075, 0); cushion.rotation.x = -0.04;
      mesh(rbox(0.405, 0.03, 0.05, 0.012), MAT.seatTrim, s, 0, 0.142, -0.215);
      var back = new THREE.Group(); back.position.set(0, 0.15, 0.26); back.rotation.x = 15 * DEG; s.add(back);
      mesh(rbox(0.40, 0.72, 0.09, 0.035, 3), MAT.seat, back, 0, 0.36, 0.045);
      mesh(rbox(0.41, 0.70, 0.02, 0.008), MAT.tanDark, back, 0, 0.355, 0.1);
      mesh(rbox(0.405, 0.04, 0.095, 0.015), MAT.seatTrim, back, 0, 0.70, 0.045);
      mesh(box(0.38, 0.03, 0.40), MAT.darkSteel, s, 0, 0.05, 0.0);
      [-0.14, 0.14].forEach(function (x) {
        mesh(box(0.025, 0.018, 0.85), MAT.darkSteel, s, x, 0.009, 0.05);
        mesh(box(0.02, 0.035, 0.02), MAT.darkSteel, s, x, 0.03, -0.17);
        mesh(box(0.02, 0.035, 0.02), MAT.darkSteel, s, x, 0.03, 0.17);
      });
      // fore/aft adjust lever under the inboard front corner
      mesh(tubeGeo([V(0.15 * inb, 0.05, -0.17), V(0.17 * inb, 0.045, -0.23), V(0.13 * inb, 0.04, -0.26), V(0.08 * inb, 0.04, -0.255)], 0.005, 16, 8), MAT.chrome, s, 0, 0, 0);
      bind(s, 'seats');
      if (cx < 0) anchor('seats', s, 0, 0.18, 0.0, { kind: 'custom', position: V(cx + 0.30, 0.62, 0.10), target: V(cx, 0.26, 0.56) });

      // lap belt halves lying on the cushion, buckle in the middle, and the shoulder harness from the rear post
      var belts = new THREE.Group(); group.add(belts);
      var out = -inb;
      mesh(ribbonGeo([V(cx + 0.205 * out, 0.10, 0.73), V(cx + 0.19 * out, 0.156, 0.64), V(cx + 0.10 * out, 0.158, 0.56), V(cx + 0.018 * out, 0.158, 0.535)], 0.045, 20), MAT.webbing, belts, 0, 0, 0);
      mesh(ribbonGeo([V(cx + 0.205 * inb, 0.10, 0.73), V(cx + 0.17 * inb, 0.156, 0.63), V(cx + 0.06 * inb, 0.158, 0.55), V(cx - 0.012 * inb, 0.158, 0.535)], 0.045, 20), MAT.webbing, belts, 0, 0, 0);
      mesh(rbox(0.05, 0.008, 0.04, 0.003), MAT.chrome, belts, cx, 0.161, 0.535);
      var px = 0.47 * out;
      mesh(ribbonGeo([V(px, 0.86, 0.94), V(cx + 0.19 * out, 0.82, 0.885), V(cx + 0.10 * out, 0.60, 0.815), V(cx + 0.0, 0.36, 0.745), V(cx + 0.06 * inb, 0.22, 0.715)], 0.045, 28, V(0, 0, 1)), MAT.webbing, belts, 0, 0, 0);
      mesh(box(0.03, 0.03, 0.012), MAT.darkSteel, belts, px, 0.865, 0.948);
      bind(belts, 'seatbelts');
      if (cx < 0) anchor('seatbelts', belts, cx, 0.2, 0.56, { kind: 'custom', position: V(cx + 0.28, 0.64, 0.30), target: V(cx, 0.26, 0.60) });
    }
    function buildFuelValve() {
      var fv = new THREE.Group(); fv.position.set(0.004, 0, 0.31); group.add(fv);
      sdeco(rbox(0.095, 0.04, 0.095, 0.008), MAT.carpet, 0.004, 0.02, 0.31);
      var plate = decal(0.078, 0.078, 6000, function (ctx, w, h) {
        ctx.fillStyle = '#1a1b1d'; roundRectPath(ctx, 0, 0, w, h, w * 0.06); ctx.fill();
        ctx.strokeStyle = '#d8d6cf'; ctx.lineWidth = w * 0.015; roundRectPath(ctx, w * 0.04, w * 0.04, w * 0.92, h * 0.92, w * 0.05); ctx.stroke();
        text(ctx, 'ON', w * 0.5, h * 0.13, h * 0.13, { weight: 700 });
        ctx.save(); ctx.translate(w * 0.13, h * 0.5); ctx.rotate(-Math.PI / 2); text(ctx, 'OFF', 0, 0, h * 0.13, { weight: 700 }); ctx.restore();
        text(ctx, 'FUEL', w * 0.6, h * 0.62, h * 0.12, { weight: 700 });
        text(ctx, '22.5 GALS', w * 0.6, h * 0.78, h * 0.105, { weight: 600 });
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.22); ctx.lineTo(w * 0.46, h * 0.29); ctx.lineTo(w * 0.54, h * 0.29); ctx.fill();
        ctx.beginPath(); ctx.moveTo(w * 0.22, h * 0.5); ctx.lineTo(w * 0.29, h * 0.46); ctx.lineTo(w * 0.29, h * 0.54); ctx.fill();
      });
      plate.rotation.x = -Math.PI / 2; plate.position.y = 0.0405; fv.add(plate);
      mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.012, 16), MAT.steel, fv, 0, 0.046, 0);
      A.fuelHandle = new THREE.Group(); A.fuelHandle.position.y = 0.052; fv.add(A.fuelHandle);
      mesh(rbox(0.014, 0.008, 0.07, 0.003), MAT.red, A.fuelHandle, 0, 0, -0.026);
      mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.01, 16), MAT.red, A.fuelHandle, 0, 0, 0);
      bind(fv, 'fuel-shutoff');
      proxy('fuel-shutoff', fv, 0.09, 0.05, 0.09, 0, 0.04, 0);
      anchor('fuel-shutoff', fv, 0, 0.05, 0, { kind: 'floor', d: 0.36 });
    }

    /* ================================================================== DOORS AND WINDOWS */
    function buildDoor(s) {
      var name = s < 0 ? 'left' : 'right';
      var pivot = new THREE.Group(); pivot.position.set(0.50 * s, 0, 0.10); group.add(pivot);
      var shp = new THREE.Shape();
      // cross-section (local x' = x − pivot.x, y) of the bowed lower door: inner trim face then outer skin
      shp.moveTo(-0.06 * s, 0.10); shp.lineTo(-0.03 * s, 0.30); shp.lineTo(-0.01 * s, 0.55);
      shp.lineTo(0.025 * s, 0.55); shp.lineTo(0.005 * s, 0.30); shp.lineTo(-0.025 * s, 0.10); shp.lineTo(-0.06 * s, 0.10);
      var door = new THREE.Group(); pivot.add(door);
      mesh(new THREE.ExtrudeGeometry(shp, { depth: 0.83, bevelEnabled: false }), [MAT.tan, MAT.tan], door, 0, 0, 0);
      mesh(box(0.012, 0.012, 0.83), MAT.trim, door, -0.012 * s, 0.548, 0.415);                  // sill trim
      mesh(rbox(0.05, 0.04, 0.36, 0.012), MAT.trim, door, -0.045 * s, 0.42, 0.44);              // armrest
      mesh(box(0.006, 0.05, 0.03), MAT.trim, door, -0.019 * s, 0.485, 0.72);                    // inside handle escutcheon
      mesh(rbox(0.012, 0.012, 0.07, 0.004), MAT.chrome, door, -0.028 * s, 0.49, 0.715);
      // window frame: front, rear and top members
      mesh(box(0.03, 0.34, 0.045), MAT.tan, door, 0.005 * s, 0.72, 0.0225);
      mesh(box(0.03, 0.34, 0.045), MAT.tan, door, 0.005 * s, 0.72, 0.8075);
      mesh(box(0.03, 0.04, 0.83), MAT.tan, door, 0.005 * s, 0.88, 0.415);
      bind(door, 'doors', name);
      // window: left one opens (hinged at the top); right one stays shut
      var winPivot = new THREE.Group(); winPivot.position.set(0.006 * s, 0.86, 0); pivot.add(winPivot);
      var ws = panelShape(0.045, 0.785, -0.305, 0, 0.03);
      var pane = mesh(new THREE.ShapeGeometry(ws, 6), MAT.glass, winPivot, 0, 0, 0);
      pane.rotation.y = -Math.PI / 2;
      var wf = new THREE.Group(); winPivot.add(wf);
      mesh(box(0.008, 0.01, 0.72), MAT.black, wf, 0, -0.302, 0.415);
      mesh(box(0.008, 0.012, 0.72), MAT.black, wf, 0, -0.004, 0.415);
      if (s < 0) {
        mesh(box(0.012, 0.012, 0.05), MAT.black, wf, -0.008 * s, -0.296, 0.43);               // latch on the lower edge
        mesh(cylZ(0.004, 0.004, 0.006, 10), MAT.red, wf, -0.012 * s, -0.296, 0.46);
        bind(wf, 'doors', 'window');
        proxy('doors', winPivot, 0.03, 0.30, 0.72, 0, -0.15, 0.415, 'window');
        A.windowLeft = winPivot;
      } else {
        bind(wf, 'doors', name);
      }
      proxy('doors', door, 0.06, 0.42, 0.80, -0.03 * s, 0.33, 0.415, name);
      if (s < 0) anchor('doors', door, -0.03 * s, 0.45, 0.42, { kind: 'custom', position: V(0.06, 0.80, 0.56), target: V(-0.47, 0.50, 0.50) });
      return pivot;
    }

    /* ================================================================== AIRFRAME SEEN FROM THE CABIN */
    function loftGeo(sections, th0, th1, nTh, expo) {
      var e = 2 / (expo || 2.6);
      function sp(v) { return Math.sign(v) * Math.pow(Math.abs(v), e); }
      return sweepLike(sections.length, nTh, function (j, i, p) {
        var s = sections[j], th = th0 + (th1 - th0) * i / nTh, c = Math.cos(th), sn = Math.sin(th);
        var x = s.hw * sp(c);
        // 'follow' section: the rear edge hugs the curved windshield base so no skin pokes into the cabin
        p.set(x, s.yc + (sn >= 0 ? s.ht : s.hb) * sp(sn), s.follow ? Math.min(wsBaseZ(clamp(x / 0.50, -1, 1)) - 0.004, 0.045) : s.z);
      });
    }
    function sweepLike(m, n, fn) {
      var pos = new Float32Array(m * (n + 1) * 3), uv = new Float32Array(m * (n + 1) * 2), index = [], p = new V3(), i, j;
      for (j = 0; j < m; j++) for (i = 0; i <= n; i++) {
        var k = j * (n + 1) + i; fn(j, i, p);
        pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
        uv[k * 2] = i / n; uv[k * 2 + 1] = j / (m - 1);
      }
      for (j = 0; j < m - 1; j++) for (i = 0; i < n; i++) {
        var a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(index); g.computeVertexNormals();
      return g;
    }
    function airfoil(n) {   // NACA 2412, loop TE → upper → LE → lower → TE
      var m = 0.02, p = 0.4, t = 0.12, up = [], lo = [], pts = [], i;
      for (i = 0; i <= n; i++) {
        var x = (1 - Math.cos(Math.PI * i / n)) / 2;
        var yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
        var yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * x - x * x);
        var dy = x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) * (1 - p)) * (p - x), th = Math.atan(dy);
        up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
        lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
      }
      for (i = n; i >= 0; i--) pts.push(up[i]);
      for (i = 1; i <= n; i++) pts.push(lo[i]);
      return pts;
    }
    function buildAirframe() {
      // cowling: white with the accent stripe, from the windshield base forward to the nose bowl
      var stripe = painted(512, 4, function (ctx, w, h) {
        ctx.fillStyle = '#f3f3ef'; ctx.fillRect(0, 0, w, h);
        function band(t0, t1, col) { ctx.fillStyle = col; ctx.fillRect(w * t0, 0, w * (t1 - t0), h); }
        var T0 = -0.25, T1 = Math.PI + 0.25;
        function u(th) { return (th - T0) / (T1 - T0); }
        // accent stripe on each cowl shoulder (visible from the seats) plus a thin pinstripe
        band(u(0.50), u(0.62), '#c8641a'); band(u(0.645), u(0.665), '#7a3410');
        band(u(Math.PI - 0.62), u(Math.PI - 0.50), '#c8641a'); band(u(Math.PI - 0.665), u(Math.PI - 0.645), '#7a3410');
      }).tex;
      var cowlMat = std({ map: stripe, roughness: 0.3, metalness: 0.0, side: DS });
      var sections = [
        // the top stays nearly level until the nose bowl so it shows above the glareshield from the seat
        { follow: true, yc: 0.40, ht: 0.336, hb: 0.47, hw: 0.505 },
        { z: -0.46, yc: 0.40, ht: 0.342, hb: 0.47, hw: 0.49 },
        { z: -0.82, yc: 0.40, ht: 0.343, hb: 0.46, hw: 0.465 },
        { z: -1.06, yc: 0.41, ht: 0.315, hb: 0.42, hw: 0.42 },
        { z: -1.22, yc: 0.43, ht: 0.260, hb: 0.36, hw: 0.35 },
        { z: -1.30, yc: 0.46, ht: 0.185, hb: 0.28, hw: 0.28 },
        { z: -1.338, yc: 0.48, ht: 0.125, hb: 0.20, hw: 0.21 }
      ];
      sdeco(loftGeo(sections, -0.25, Math.PI + 0.25, 48), cowlMat).userData.noCast = true;
      // oil-door outline and fasteners on the cowl top (small dark details)
      [[-0.17, -0.55], [0.17, -0.55], [-0.17, -0.95], [0.17, -0.95]].forEach(function (p) {
        sdeco(new THREE.SphereGeometry(0.008, 8, 6), MAT.steel, p[0], p[1] > -0.7 ? 0.741 : 0.732, p[1]);
      });
      // spinner and propeller
      var spin = new THREE.LatheGeometry([[0, 0.24], [0.04, 0.215], [0.075, 0.16], [0.097, 0.08], [0.105, 0.0]].map(function (q) { return new THREE.Vector2(q[0], q[1]); }), 28);
      spin.rotateX(-Math.PI / 2);
      sdeco(spin, MAT.paint, 0, 0.49, -1.355);
      A.prop = new THREE.Group(); A.prop.position.set(0, 0.49, -1.365); group.add(A.prop);
      A.blades = new THREE.Group(); A.prop.add(A.blades);
      var bg = new THREE.BoxGeometry(0.11, 0.80, 0.022, 1, 32, 1);
      var pos = bg.attributes.position, colors = new Float32Array(pos.count * 3), i;
      for (i = 0; i < pos.count; i++) {
        var y = pos.getY(i) + 0.48, t = (y - 0.08) / 0.80, x = pos.getX(i), z = pos.getZ(i);
        var ch = 1 - 0.42 * t - (t > 0.93 ? (t - 0.93) * 5 : 0), tw = (24 - 14 * t) * DEG;
        x *= ch;
        pos.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y, x * Math.sin(tw) + z * Math.cos(tw));
        var tip = y > 0.79;
        colors[i * 3] = tip ? 0.93 : 0.06; colors[i * 3 + 1] = tip ? 0.76 : 0.06; colors[i * 3 + 2] = tip ? 0.10 : 0.065;
      }
      bg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      bg.computeVertexNormals();
      var bladeMat = std({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
      mesh(bg, bladeMat, A.blades, 0, 0, 0);
      mesh(bg, bladeMat, A.blades, 0, 0, 0).rotation.z = Math.PI;
      var disc = painted(256, 256, function (ctx, w, h) {
        var g = ctx.createRadialGradient(w / 2, h / 2, w * 0.05, w / 2, h / 2, w / 2);
        // a spinning prop is almost invisible from the seat: faint dark blur, thin muted arc at the yellow tips
        g.addColorStop(0, 'rgba(30,30,30,0)'); g.addColorStop(0.15, 'rgba(25,25,25,0.30)'); g.addColorStop(0.6, 'rgba(35,35,35,0.10)');
        g.addColorStop(0.9, 'rgba(45,45,45,0.06)'); g.addColorStop(0.94, 'rgba(200,170,70,0.16)'); g.addColorStop(0.985, 'rgba(200,170,70,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }).tex;
      A.propDisc = mesh(new THREE.CircleGeometry(0.88, 64), new THREE.MeshBasicMaterial({ map: disc, transparent: true, opacity: 0.5, depthWrite: false, side: DS }), A.prop, 0, 0, -0.005);
      A.propAngle = 0.4;

      // wings (NACA 2412) above the cabin: root chord 1.60 m, taper outboard of the flap/aileron break
      var af = airfoil(14);
      var stations = [{ x: 0.50, le: 0.03, c: 1.60 }, { x: 2.38, le: 0.03, c: 1.60 }, { x: 5.08, le: 0.18, c: 1.13 }];
      [-1, 1].forEach(function (s) {
        sdeco(sweepLike(stations.length, af.length - 1, function (j, i, p) {
          var st = stations[j], y0 = 1.065 + (st.x - 0.5) * Math.tan(1 * DEG);
          p.set(st.x * s, y0 + af[i][1] * st.c, st.le + af[i][0] * st.c);
        }), MAT.paint);
        // wing strut (streamlined) from the lower fuselage to the wing
        var a = V(0.55 * s, -0.05, 0.075), b = V(2.10 * s, 1.05, 0.205), d = b.clone().sub(a), len = d.length();
        var st2 = sdeco(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), MAT.paint, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        st2.scale.set(0.022, len, 0.05);
        st2.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
      });
    }

    /* ================================================================== BUILD EVERYTHING */
    buildShell();
    buildWindshield();
    buildGlareshield();
    buildOverhead();
    buildPanel();
    buildSubpanelControls();
    buildPedestal();
    A.yokes = [buildYoke(YOKE_PILOT_X, true), buildYoke(YOKE_COPILOT_X, false)];
    anchor('yoke', A.yokes[0].wheel, 0, 0, 0, { kind: 'custom', position: V(YOKE_PILOT_X + 0.12, 0.70, 0.62), target: V(YOKE_PILOT_X, 0.49, 0.16) });
    buildControlLock();
    buildPedals();
    buildSeat(-0.235, 1);
    buildSeat(0.245, -1);
    buildFuelValve();
    A.doorL = buildDoor(-1); A.doorR = buildDoor(1);
    A.doorAngle = { left: 0, right: 0, window: 0 };
    buildAirframe();

    /* ---- merge static decorative meshes that share a material (fewer draw calls) */
    // one non-indexed geometry (position/normal/uv) from meshes, in group space (group is still at the origin here)
    function bakeGeometry(list) {
      var nm = new THREE.Matrix3(), v = new V3();
      var geos = list.map(function (o) { return o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; });
      var total = 0; geos.forEach(function (g) { total += g.attributes.position.count; });
      var P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2), off = 0;
      list.forEach(function (o, idx) {
        var g = geos[idx], pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, m4 = o.matrixWorld;
        nm.getNormalMatrix(m4);
        var flip = m4.determinant() < 0;
        for (var i = 0; i < pa.count; i++) {
          var src = i;
          if (flip) { var r = i % 3; src = r === 1 ? i + 1 : (r === 2 ? i - 1 : i); }
          v.fromBufferAttribute(pa, src).applyMatrix4(m4); P.set([v.x, v.y, v.z], (off + i) * 3);
          v.fromBufferAttribute(na, src).applyMatrix3(nm).normalize(); N.set([v.x, v.y, v.z], (off + i) * 3);
          U[(off + i) * 2] = ua.getX(src); U[(off + i) * 2 + 1] = ua.getY(src);
        }
        off += pa.count;
        if (g !== o.geometry) g.dispose();
        o.geometry.dispose();
        o.parent.remove(o);
      });
      var mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(P, 3));
      mg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      mg.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      return mg;
    }
    function mergeDecor() {
      staticRoot.updateMatrixWorld(true);
      var buckets = new Map();
      staticRoot.traverse(function (o) {
        if (!o.isMesh || !o.userData.decor || Array.isArray(o.material) || o.userData.controlId) return;
        if (!o.geometry.attributes.uv || !o.geometry.attributes.normal || o.geometry.attributes.color) return;
        var list = buckets.get(o.material); if (!list) { list = []; buckets.set(o.material, list); }
        list.push(o);
      });
      buckets.forEach(function (list, mat) {
        if (list.length < 2) return;
        var merged = new THREE.Mesh(bakeGeometry(list), mat); merged.name = 'merged-decor';
        staticRoot.add(merged);
      });
    }
    mergeDecor();

    /* ---- merge the STATIC meshes of each control that share a material (fewer draw calls: breakers, bezels, seats…).
     * Parts under an animated node (knob slides, yokes, pedals, rockers, doors, key, lock, prop…) stay separate. */
    function mergeControlStatics() {
      var moving = new Set();
      [A.park, A.primer, A.carb, A.throttle, A.mixture, A.cabinAir, A.cabinHt].forEach(function (k) { moving.add(k.slide); });
      A.yokes.forEach(function (y) { moving.add(y.slide); moving.add(y.wheel); });
      A.pedals.forEach(function (p) { moving.add(p.group); moving.add(p.pad); });
      Object.keys(A.rockers).forEach(function (k) { moving.add(A.rockers[k]); });
      [A.key, A.masterAlt, A.masterBat, A.flapLever, A.dimmerOuter, A.trimWheel, A.fuelHandle, A.doorL, A.doorR, A.windowLeft,
        A.controlLock, A.prop, A.blades, A.propDisc, A.placard].forEach(function (n) { if (n) moving.add(n); });
      group.updateMatrixWorld(true);
      var pickSet = new Set(pickables), removed = new Set();
      Object.keys(controlParts).forEach(function (id) {
        var buckets = new Map();
        controlParts[id].forEach(function (m) {
          var g = m.geometry, mat = m.material;
          if (Array.isArray(mat) || m.userData.proxy || m.userData.painter || !g.attributes.normal || !g.attributes.uv || g.attributes.color) return;
          if (m.renderOrder !== 0 || mat.transparent || mat.alphaTest || mat.map) return;
          var q = m.parent;
          for (; q && q !== group; q = q.parent) if (moving.has(q)) return;
          if (!q) return;
          var key = mat.uuid + '|' + (m.userData.subId || '') + '|' + (m.userData.noCast ? 1 : 0);
          var list = buckets.get(key); if (!list) { list = []; buckets.set(key, list); }
          list.push(m);
        });
        buckets.forEach(function (list) {
          if (list.length < 2) return;
          var mat = list[0].material, ud = list[0].userData;
          list.forEach(function (o) { removed.add(o); });
          var merged = new THREE.Mesh(bakeGeometry(list), mat);
          merged.name = 'merged:' + id;
          merged.userData.controlId = id;
          if (ud.subId) merged.userData.subId = ud.subId;
          if (ud.noCast) merged.userData.noCast = true;
          group.add(merged);
          controlParts[id].push(merged);
          pickSet.add(merged);
        });
        controlParts[id] = controlParts[id].filter(function (o) { return !removed.has(o); });
      });
      var keep = []; pickSet.forEach(function (o) { if (!removed.has(o)) keep.push(o); });
      pickables.length = 0; Array.prototype.push.apply(pickables, keep);
      // proxies are pick volumes only: hidden from rendering (the raycaster ignores 'visible', it tests layers)
      pickables.forEach(function (o) { if (o.userData.proxy) o.visible = false; });
    }
    mergeControlStatics();

    /* ---- per-control material clones so highlighting touches only that control */
    var hlRecords = {}, hlState = {};
    Object.keys(controlParts).forEach(function (id) {
      var cache = new Map(), recs = [];
      function cl(orig) {
        if (!orig || !orig.emissive) return orig;
        var c = cache.get(orig);
        if (!c) { c = orig.clone(); cache.set(orig, c); recs.push({ mat: c, base: c.emissive.clone(), baseI: c.emissiveIntensity }); }
        return c;
      }
      controlParts[id].forEach(function (m) { m.material = Array.isArray(m.material) ? m.material.map(cl) : cl(m.material); });
      hlRecords[id] = recs;
    });
    // Highlight look (linear radiance): a faint accent glow over the whole part plus a fresnel rim that outlines it
    // (uRim, see patchMaterial). hover = soft warm white, selected = accent orange, target = pulsing orange.
    var HL = {
      hover: { e: new THREE.Color(1.0, 0.82, 0.62), eg: 0.04, rim: new THREE.Color(1.0, 0.86, 0.70), rg: 0.7 },
      selected: { e: new THREE.Color(1.0, 0.48, 0.14), eg: 0.095, rim: new THREE.Color(1.0, 0.56, 0.20), rg: 1.6 },
      target: { e: new THREE.Color(1.0, 0.55, 0.12), eg: 0.09, rim: new THREE.Color(1.0, 0.62, 0.18), rg: 1.4 }
    };
    var hlTime = 0, hlTmp = new THREE.Color();
    function applyHighlight(id) {
      var recs = hlRecords[id]; if (!recs) return;
      var kind = hlState[id], h = kind ? HL[kind] : null, pulse = 1;
      if (kind === 'target' && !reducedMotion) pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(hlTime * 4.2));
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i], u = matUniforms.get(r.mat);
        if (!h) { r.mat.emissive.copy(r.base); r.mat.emissiveIntensity = r.baseI; if (u) u.uRim.value.setRGB(0, 0, 0); continue; }
        r.mat.emissive.copy(r.base).multiplyScalar(r.baseI).add(hlTmp.copy(h.e).multiplyScalar(h.eg * pulse));
        r.mat.emissiveIntensity = 1;
        if (u) u.uRim.value.copy(h.rim).multiplyScalar(h.rg * pulse);
      }
    }
    function setHighlight(id, kind) {
      if (!id) return;
      if (kind === 'hover' || kind === 'selected' || kind === 'target') hlState[id] = kind;
      else delete hlState[id];
      applyHighlight(id);
    }
    function clearHighlights() {
      var ids = Object.keys(hlState); hlState = {};
      ids.forEach(applyHighlight);
    }

    /* ---- close-up camera views for every anchored control */
    var tmpA = new V3(), tmpB = new V3();
    group.updateMatrixWorld(true);
    Object.keys(anchors).forEach(function (id) {
      var spec = viewSpecs[id], t = new V3();
      anchors[id].getWorldPosition(t);
      if (spec.kind === 'custom') { views[id] = { position: spec.position.clone(), target: spec.target.clone() }; return; }
      var d = spec.d || 0.3, dir;
      // subpanel: look almost straight in, from BELOW the yoke hubs/columns (y ≈ 0.45–0.50, z ≈ 0.16), which
      // would otherwise hide the knobs next to them
      if (spec.kind === 'sub') dir = tmpA.set(clamp((EYE.x - t.x) * 0.35, -0.12, 0.12), 0.14, 1);
      else if (spec.kind === 'pedestal') dir = tmpA.set(clamp((EYE.x - t.x) * 0.3, -0.15, 0.15) + 0.08, 0.75, 1);
      else if (spec.kind === 'floor') dir = tmpA.set(clamp((EYE.x - t.x) * 0.3, -0.1, 0.1) + 0.04, 1.0, 0.72);
      else if (spec.kind === 'eye') dir = tmpA.copy(EYE).sub(t);
      else dir = tmpA.copy(EYE).sub(t).normalize().lerp(tmpB.set(0, 0.12, 1).normalize(), 0.5);
      dir.normalize();
      views[id] = { position: t.clone().addScaledVector(dir, d), target: t };
      // the turn coordinator sits right behind the pilot yoke's left horn: look over the horn
      if (id === 'turn-coordinator') views[id].position.set(-0.44, 0.66, 0.24);
    });

    var presets = {
      pilot: { position: EYE.clone(), target: V(-0.10, 0.50, 0.0), label: 'Asiento del piloto' },
      flight: { position: EYE.clone(), target: V(-0.235, 0.74, -1.0), label: 'En vuelo: mirar afuera' },
      // "así se ve desde adentro" (lessons mirroring an exterior movement): the horizon through the windshield, the
      // six flight instruments and the yoke in one picture, also in a tall half of 'Las dos'
      inside: { position: EYE.clone(), target: V(-0.22, 0.655, -0.2), label: 'Desde adentro: horizonte, tablero y volante' },
      // panel/left/center/right are framed so the control wheels do not hide what each view is about (ray-cast
      // checked: every instrument ≥ 78 % visible in 'panel', 100 % in 'left'; 'center'/'right' show their knobs)
      panel: { position: V(0, 0.84, 0.70), target: V(0, 0.47, 0), label: 'Tablero completo' },
      left: { position: V(-0.24, 0.60, 0.34), target: V(-0.26, 0.545, 0), label: 'Instrumentos de vuelo' },
      center: { position: V(0.02, 0.50, 0.35), target: V(0.03, 0.46, 0), label: 'Centro: motor y radio' },
      right: { position: V(0.26, 0.43, 0.43), target: V(0.29, 0.49, 0), label: 'Lado derecho' },
      floor: { position: V(-0.06, 0.66, 0.55), target: V(-0.06, 0.06, -0.12), label: 'Piso: pedales y combustible' },
      overhead: { position: V(-0.14, 0.78, 0.55), target: V(-0.04, 1.0, -0.02), label: 'Techo y parabrisas' },
      copilot: { position: V(0.245, 0.88, 0.70), target: V(0.10, 0.50, 0.0), label: 'Asiento del copiloto' },
      door: { position: V(0.05, 0.80, 0.58), target: V(-0.47, 0.62, 0.30), label: 'Puerta izquierda' }
    };

    /* ================================================================== COLOUR MODE
     * Colours and canvases are authored as display (sRGB) values. If the renderer outputs LinearEncoding (three.js
     * default, assumed by world.js) textures are tagged Linear and colours used as-is; if it outputs sRGBEncoding,
     * textures are tagged sRGB (contract) and material colours are converted to linear so the cabin looks the same.
     * Detected automatically on the first render (opts.outputEncoding overrides). */
    var colorMode = null;
    function E(v) { return colorMode === 'srgb' ? Math.pow(Math.max(0, v), 2.2) : v; }
    function applyColorMode(mode) {
      if (colorMode === mode) return;
      colorMode = mode;
      var enc = mode === 'srgb' ? THREE.sRGBEncoding : THREE.LinearEncoding;
      var convert = mode === 'srgb' && !(THREE.ColorManagement && THREE.ColorManagement.legacyMode === false);
      var convertVC = mode === 'srgb';      // raw vertex-colour arrays are display values in any colour-management mode
      allTextures.forEach(function (t) { if (t.encoding !== enc) { t.encoding = enc; t.needsUpdate = true; } });
      var seen = new Set();
      group.traverse(function (o) {
        if (!o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
          if (!m || seen.has(m)) return;
          seen.add(m);
          if (m.color) { if (!m.userData.c0) m.userData.c0 = m.color.clone(); m.color.copy(m.userData.c0); if (convert) m.color.convertSRGBToLinear(); }
          if (m.emissive) { if (!m.userData.e0) m.userData.e0 = m.emissive.clone(); m.emissive.copy(m.userData.e0); if (convert) m.emissive.convertSRGBToLinear(); }
          m.needsUpdate = true;
        });
        var vc = o.geometry && o.geometry.attributes && o.geometry.attributes.color;
        if (vc && !vc.userData) {
          vc.userData = { c0: vc.array.slice() };
        }
        if (vc && vc.userData) {
          for (var i = 0; i < vc.array.length; i++) vc.array[i] = convertVC ? Math.pow(vc.userData.c0[i], 2.2) : vc.userData.c0[i];
          vc.needsUpdate = true;
        }
      });
      Object.keys(hlRecords).forEach(function (id) {
        hlRecords[id].forEach(function (r) { r.base.copy(r.mat.userData.e0 || r.base); if (convert) r.base.convertSRGBToLinear(); });
        applyHighlight(id);
      });
    }
    if (opts.outputEncoding !== undefined) applyColorMode(opts.outputEncoding === THREE.sRGBEncoding ? 'srgb' : 'linear');
    // invisible one-triangle probe: its onBeforeRender reads the renderer's output encoding every frame (cheap)
    var probeGeo = new THREE.BufferGeometry();
    probeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0.5, 0.2, 0.001, 0.5, 0.2, 0, 0.501, 0.2]), 3));
    var probe = new THREE.Mesh(probeGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    probe.frustumCulled = false; probe.name = 'colour-mode-probe'; probe.renderOrder = -1000;   // runs before any texture upload
    probe.onBeforeRender = function (renderer) {
      if (opts.outputEncoding !== undefined || !renderer) return;
      applyColorMode(renderer.outputEncoding === THREE.sRGBEncoding ? 'srgb' : 'linear');
    };
    group.add(probe);

    /* ================================================================== UPDATE */
    var gaugeCursor = 0, gaugeBudget = gauges.length, lastState = null, GAUGE_RATE = 90, GAUGE_BURST = 8;
    // Flight instruments first: during a manoeuvre (or a mirrored demonstration) several of them change every frame and
    // must move smoothly; the rest (clock, fuel, radios…) share what is left of the budget round-robin.
    var GAUGE_RATES = { alta: 90, media: 60, baja: 36 };
    var PRIORITY_IDS = ['attitude', 'turn-coordinator', 'heading-indicator', 'asi', 'vsi', 'altimeter', 'tachometer', 'flap-indicator'];
    var priorityGauges = [], prioCursor = 0;
    gauges.forEach(function (g) { if (PRIORITY_IDS.indexOf(g.gid) >= 0) priorityGauges.push(g); });
    priorityGauges.sort(function (a, b) { return PRIORITY_IDS.indexOf(a.gid) - PRIORITY_IDS.indexOf(b.gid); });
    var BASE_EMISSIVE = 0.33;
    var api = null, lastMotionSig = NaN;
    function rockerAngle(on) { return on ? -0.22 : 0.22; }
    function easeTo(cur, target, dt, rate) { return cur + (target - cur) * Math.min(1, dt * rate); }

    function update(state, dt) {
      var s = state || {};
      dt = clamp(num(dt, 1 / 60), 0, 0.1);
      lastState = s; hlTime += dt;
      var i;

      // control wheels: roll (wheel rotation) and pitch (column slides)
      var roll = clamp(num(s.yokeRoll, 0), -1, 1), pitch = clamp(num(s.yokePitch, 0), -1, 1);
      var slideZ = pitch >= 0 ? pitch * 0.09 : pitch * 0.06;
      for (i = 0; i < A.yokes.length; i++) { A.yokes[i].slide.position.z = slideZ; A.yokes[i].wheel.rotation.z = -roll * 90 * DEG; }

      // rudder pedals and toe brakes (copilot pair linked)
      var rud = clamp(num(s.rudder, 0), -1, 1), bL = clamp(num(s.brakeL, 0), 0, 1), bR = clamp(num(s.brakeR, 0), 0, 1);
      for (i = 0; i < A.pedals.length; i++) {
        var p = A.pedals[i];
        p.group.position.z = p.z0 + (p.side < 0 ? 0.06 * rud : -0.06 * rud);
        p.pad.rotation.x = PAD_TILT - (p.side < 0 ? bL : bR) * 0.26;
      }

      // push-pull knobs
      A.park.slide.position.z = s.parkingBrake ? 0.04 : 0;
      A.throttle.slide.position.z = (1 - clamp(num(s.throttle, 0), 0, 1)) * KNOB_TRAVEL;
      A.mixture.slide.position.z = (1 - clamp(num(s.mixture, 1), 0, 1)) * KNOB_TRAVEL;
      A.carb.slide.position.z = clamp(num(s.carbHeat, 0), 0, 1) * KNOB_TRAVEL;
      A.cabinHt.slide.position.z = clamp(num(s.cabinHeat, 0), 0, 1) * KNOB_TRAVEL;
      A.cabinAir.slide.position.z = clamp(num(s.cabinAir, 0), 0, 1) * KNOB_TRAVEL;
      A.primer.slide.position.z = clamp(num(s.primerOut, 0), 0, 1) * 0.05;
      A.primer.knob.rotation.z = s.primerLocked === false ? 0 : Math.PI / 2;

      // ignition key, master halves, light rockers, flap toggle, dimmer
      var ign = IGN_ANGLE[s.ignition] !== undefined ? IGN_ANGLE[s.ignition] : IGN_ANGLE.OFF;
      A.key.rotation.z = -ign * DEG;
      A.masterAlt.rotation.x = rockerAngle(!!s.masterAlt);
      A.masterBat.rotation.x = rockerAngle(!!s.masterBat);
      var lights = s.lights || {};
      A.rockers.dome.rotation.x = rockerAngle(!!lights.dome);
      A.rockers.pitot.rotation.x = rockerAngle(!!s.pitotHeat);
      A.rockers.nav.rotation.x = rockerAngle(!!lights.nav);
      A.rockers.strobe.rotation.x = rockerAngle(!!lights.strobe);
      A.rockers.beacon.rotation.x = rockerAngle(!!lights.beacon);
      A.rockers.taxi.rotation.x = rockerAngle(!!lights.taxi);
      A.rockers.landing.rotation.x = rockerAngle(!!lights.landing);
      A.flapLever.rotation.x = s.flapSwitch === 'UP' ? -0.5 : (s.flapSwitch === 'DOWN' ? 0.5 : 0);
      var panelLt = clamp(num(s.panelLights, 0), 0, 1);
      A.dimmerOuter.rotation.z = -panelLt * 4.4;

      // elevator trim wheel and fuel shutoff valve
      A.trimWheel.rotation.x = clamp(num(s.trim, 0), -1, 1) * 4.2;
      A.fuelHandle.rotation.y = s.fuelValve === false ? Math.PI / 2 : 0;

      // doors (open outward on the front hinge) and the left window (top hinge)
      var rate = reducedMotion ? 30 : 5;
      A.doorAngle.left = easeTo(A.doorAngle.left, s.doorLeftOpen ? 1 : 0, dt, rate);
      // a door that popped open in flight (failure 'door') only trails a few centimetres ajar in the slipstream
      var ajar = !!(s.failures && s.failures.door && s.air && s.air.onGround === false);
      A.doorAngle.right = easeTo(A.doorAngle.right, s.doorRightOpen ? (ajar ? 0.14 : 1) : 0, dt, rate);
      A.doorAngle.window = easeTo(A.doorAngle.window, s.windowLeftOpen ? 1 : 0, dt, rate);
      A.doorL.rotation.y = -A.doorAngle.left * 55 * DEG;
      A.doorR.rotation.y = A.doorAngle.right * 55 * DEG;
      A.windowLeft.rotation.z = -A.doorAngle.window * 30 * DEG;

      // control lock
      var locked = !!s.controlLock;
      if (locked !== A.controlLock.visible) setVisibleAndPickable(A.controlLock, locked);

      // propeller: two blades when slow, translucent disc above 300 RPM (clockwise seen from the cabin)
      var rpm = Math.max(0, num(s.propRpm, s.engine ? num(s.engine.rpm, 0) : 0));
      A.propAngle -= rpm / 60 * Math.PI * 2 * dt;
      A.propAngle %= Math.PI * 2;
      var fast = rpm > 300;
      if (A.blades.visible === fast) setVisibleAndPickable(A.blades, !fast);
      if (A.propDisc.visible !== fast) setVisibleAndPickable(A.propDisc, fast);
      A.blades.rotation.z = A.propAngle;
      if (fast) { A.propDisc.material.opacity = clamp(0.55 - (rpm - 300) / 6000, 0.3, 0.55); A.propDisc.rotation.z = A.propAngle * 0.02; }

      // lights: HIGH VOLTAGE, red flood (PANEL LT), dome; instrument faces glow red at night
      var elec = s.elec || {}, bus = num(elec.busVolts, 0) > 8;
      var hvOn = !!elec.highVoltageLight;
      A.hvLens.material.emissive.setRGB(hvOn ? 1.0 : 0, hvOn ? E(0.12) : 0, hvOn ? E(0.06) : 0);
      var flood = bus ? panelLt : 0, domeOn = bus && !!lights.dome;
      A.floodLens.material.emissive.setRGB(E(flood), E(flood * 0.12), E(flood * 0.08));
      // candela-like (physicallyCorrectLights, decay 2): matched to the legacy look at the panel (~0.6 m from the
      // flood) and the seats (~0.8 m from the dome); higher values tint the whole sunlit cabin
      A.floodLight.intensity = flood * 0.42;
      A.domeLens.material.emissive.setRGB(domeOn ? E(0.95) : 0, domeOn ? E(0.9) : 0, domeOn ? E(0.78) : 0);
      A.domeLight.intensity = domeOn ? 0.8 : 0;
      var gr = E(BASE_EMISSIVE + flood * 0.45), gg = E(BASE_EMISSIVE + flood * 0.04), gb = E(BASE_EMISSIVE + flood * 0.03);
      for (i = 0; i < gauges.length; i++) gauges[i].mesh.material.emissive.setRGB(gr, gg, gb);
      for (i = 0; i < A.panelFaces.length; i++) A.panelFaces[i].emissive.setRGB(E(flood * 0.10), E(flood * 0.012), E(flood * 0.008));

      // limitation placard follows the variant (150M / A150M Aerobat)
      var variant = s.variant === 'A150M' ? 'A150M' : '150M';
      if (variant !== A.placardVariant) { A.placardVariant = variant; A.placard.userData.painter.redraw(); }

      // gauges: redraw only when the displayed values change, at most ~30 redraws per second in total
      gaugeBudget = Math.min(gaugeBudget + dt * GAUGE_RATE, Math.max(GAUGE_BURST, gaugeBudget));
      var checked = 0, n = gauges.length, np = priorityGauges.length;
      // the attitude indicator and the turn coordinator always get the first redraws (rotating start for the others)
      for (var pi = 0; pi < np && gaugeBudget >= 1; pi++) {
        var pg = priorityGauges[pi < 2 ? pi : 2 + (prioCursor + pi - 2) % Math.max(1, np - 2)];
        var psig = (Gauges && Gauges.signature) ? Gauges.signature(pg.gid, s) : 'static';
        if (pg.dirty || psig !== pg.sig) { pg.sig = psig; pg.dirty = false; drawGauge(pg, s); gaugeBudget -= 1; }
      }
      prioCursor = (prioCursor + 1) % Math.max(1, np - 2);
      while (checked < n && gaugeBudget >= 1) {
        var g = gauges[gaugeCursor];
        gaugeCursor = (gaugeCursor + 1) % n; checked++;
        var sig = (Gauges && Gauges.signature) ? Gauges.signature(g.gid, s) : 'static';
        if (g.dirty || sig !== g.sig) { g.sig = sig; g.dirty = false; drawGauge(g, s); gaugeBudget -= 1; }
      }

      // shadow casters moved? (core re-renders the sun's shadow map only then: ck.motion changes)
      var y0 = A.yokes[0], p0 = A.pedals[0], p1 = A.pedals[1];
      var msig = y0.slide.position.z * 7.1 + y0.wheel.rotation.z * 3.3 + p0.group.position.z * 11.3 + p0.pad.rotation.x * 13.7 +
        p1.group.position.z * 5.9 + p1.pad.rotation.x * 17.3 + A.doorL.rotation.y * 19.1 + A.doorR.rotation.y * 23.3 +
        A.windowLeft.rotation.z * 29.9 + (A.blades.visible ? A.propAngle * 31.7 + 0.5 : 0) + (locked ? 37.1 : 0) +
        A.throttle.slide.position.z * 41.3 + A.mixture.slide.position.z * 43.7 + A.carb.slide.position.z * 47.3 +
        A.park.slide.position.z * 53.9 + A.trimWheel.rotation.x * 2.9 + A.fuelHandle.rotation.y * 59.3 + A.key.rotation.z * 61.7 +
        A.cabinHt.slide.position.z * 67.1 + A.cabinAir.slide.position.z * 71.3 + A.primer.slide.position.z * 73.9;
      if (Math.abs(msig - lastMotionSig) > 1e-6) { lastMotionSig = msig; if (api) api.motion++; }

      // highlights last, so they sit on top of the dynamic emissive values above
      for (var hid in hlState) applyHighlight(hid);
    }

    // web fonts arrive late: repaint every label texture and force a full gauge redraw
    try {
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          painters.forEach(function (p) { p.redraw(); });
          gauges.forEach(function (g) { g.dirty = true; if (lastState) drawGauge(g, lastState); });
        });
      }
    } catch (e) { /* no font loading API: canvas fallbacks stay */ }

    /* ================================================================== MATERIAL PATCH, SHADOWS, QUALITY
     * Every MeshStandardMaterial of the cabin gets one shared onBeforeCompile: the triplanar detail relief
     * (userData.detail), the highlight rim (uRim) and the reflective-glass output (userData.glass). Uniforms live in
     * matUniforms (not userData, which three JSON-clones). setQuality('baja') drops the detail (cheaper shader). */
    function onBeforeCompileC150(shader) {
      var u = matUniforms.get(this); if (!u) return;
      var detail = !!(this.userData.detail && detailOn), glass = !!this.userData.glass;
      shader.uniforms.uRim = u.uRim; shader.uniforms.uGlassRefl = u.uGlassRefl;
      if (detail) { shader.uniforms.tDetail = u.tDetail; shader.uniforms.uDetail = u.uDetail; shader.uniforms.uDetailMask = u.uDetailMask; }
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vC150W;\n' + (detail ? GLSL_VERT_PARS : ''))
        .replace('#include <project_vertex>', '#include <project_vertex>\nvC150W = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      if (detail) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDPos = position; vDNrm = objectNormal;');
      var fs = (detail ? '#define C150_DETAIL\n' : '') + shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_FRAG_PARS);
      if (detail) {
        fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\nfloat c150H = c150DetailH();\ndiffuseColor.rgb *= 1.0 - uDetail.w * (1.0 - c150H);')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.0 + uDetail.z * (c150H - 0.5) * 2.0), 0.03, 1.0);')
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = c150Bump(-vViewPosition, normal, c150H, uDetail.y, faceDirection);');
      }
      if (!this.userData.noAo) {
        fs = fs.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' +
          '{ float c150A = c150AoField(vC150W); reflectedLight.indirectDiffuse *= c150A; reflectedLight.indirectSpecular *= c150A; }');
      }
      fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' +
        '{ float c150Ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += uRim * pow(1.0 - c150Ndv, 3.0); }');
      if (glass) {
        // + forward scattering of the sun by dust on the glass (alpha map = dust/edge density): looking toward the sun
        // the windshield glows softly, so the glass reads as a surface while staying clear
        fs = fs.replace('#include <output_fragment>', [
          'vec3 c150Glass = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) * diffuseColor.a + (reflectedLight.directSpecular + reflectedLight.indirectSpecular) * uGlassRefl;',
          '#if NUM_DIR_LIGHTS > 0',
          '{ float dust = 0.05;',
          '#ifdef USE_ALPHAMAP',
          '  dust = texture2D(alphaMap, vUv).g;',
          '#endif',
          '  float sc = max(dot(normalize(-vViewPosition), directionalLights[0].direction), 0.0);',
          '  c150Glass += directionalLights[0].color * dust * (pow(sc, 24.0) * 0.08 + pow(sc, 4.0) * 0.008); }',
          '#endif',
          'gl_FragColor = vec4(c150Glass, diffuseColor.a);'].join('\n'));
      }
      shader.fragmentShader = fs;
    }
    function cacheKeyC150() { return 'c150:' + (this.userData.detail && detailOn ? 'd' : '') + (this.userData.glass ? 'g' : '') + (this.userData.noAo ? 'n' : ''); }
    function patchMaterial(m) {
      if (!m || !m.isMeshStandardMaterial || matUniforms.has(m)) return;
      var d = m.userData.detail, g = m.userData.glass;
      matUniforms.set(m, {
        uRim: { value: new THREE.Color(0, 0, 0) },
        uGlassRefl: { value: g ? g.refl : 1 },
        tDetail: { value: d ? DETAIL_TEX[d.tex] : null },
        uDetail: { value: d ? new THREE.Vector4(1 / d.tile, d.bump, d.rough, d.cavity) : new THREE.Vector4() },
        uDetailMask: { value: new THREE.Vector3(d && d.ch === 0 ? 1 : 0, d && d.ch === 1 ? 1 : 0, d && d.ch === 2 ? 1 : 0) }
      });
      m.onBeforeCompile = onBeforeCompileC150;
      m.customProgramCacheKey = cacheKeyC150;
      if (g) {   // premultiplied: rgb = tint·alpha + full reflections, dst × (1 − alpha)
        m.transparent = true; m.depthWrite = false;
        m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
        m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
      }
    }
    group.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(patchMaterial);
      var m0 = ms[0];
      var hidden = !!o.userData.proxy || !m0 || m0.colorWrite === false || m0.isMeshBasicMaterial;
      var seeThrough = ms.some(function (x) { return x && (x.userData.glass || (x.transparent && !x.alphaTest)); });
      o.receiveShadow = !hidden && !seeThrough;
      o.castShadow = !hidden && !seeThrough && !o.userData.noCast;
    });
    function setQuality(level) {
      GAUGE_RATE = GAUGE_RATES[level] || GAUGE_RATE;
      var on = level !== 'baja';
      if (on === detailOn) return;
      detailOn = on;
      matUniforms.forEach(function (u, m) { if (m.userData.detail) m.needsUpdate = true; });
    }

    // initial pose: everything neutral, lock hidden until a state says otherwise
    setVisibleAndPickable(A.controlLock, false);
    setVisibleAndPickable(A.propDisc, false);

    api = {
      motion: 0,                // increments whenever a shadow-casting part moved (core: shadow map refresh)
      group: group,
      pickables: pickables,
      anchors: anchors,
      views: views,
      presets: presets,
      dragAxes: dragAxes,
      eye: EYE.clone(),
      update: update,
      setHighlight: setHighlight,
      clearHighlights: clearHighlights,
      setQuality: setQuality
    };
    return api;
  }

  C150.Cockpit = { create: create };
})(root.C150);
