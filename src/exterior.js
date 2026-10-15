var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * exterior.js: C150.Exterior, a procedural Cessna 150M (1976) seen from outside, with moving control surfaces,
 * lights, doors, teaching overlays (arrows, axes, forces, airflow) and scripted animations with Spanish captions.
 *
 *   var ext = C150.Exterior.create(THREE);
 *   renderer.render(ext.scene, ext.camera);  ext.update(state, dt) every frame.
 *
 * Interpretation notes (where the contract leaves room):
 *  - Model frame = R/visual3d.md §0 (x right, y up, z aft, firewall z = 0, cabin floor y = 0). ext.root holds the
 *    airplane with its centre of gravity (0, 0.55, 1.0) at the scene origin; the ground sits at y = -1.206.
 *    On the wheels the airplane shows a 2° nose-high stance (both tyres touch the ground).
 *  - ext.followAttitude defaults to true: bank/pitch from state.air rotate the airplane (heading fixed); when
 *    airborne a faint level horizon ring replaces the ground disk.
 *  - ext.playing is the running animation name (string) or null. play() with an unknown name returns false.
 *  - Camera: setView() eases the camera (instant with prefers-reduced-motion). ext.target is the look-at point
 *    and ext.cameraBusy is true while a transition runs; if core drives ext.camera with OrbitControls, copy
 *    ext.target into controls.target when cameraBusy turns false (and do not call controls.update while busy).
 *  - Extras beyond the contract: ext.setSize(w, h) (camera aspect + label size in CSS px; call it when the
 *    exterior viewport changes), ext.VIEWS, ext.ANIMATIONS, ext.PARTS, ext.view (current view name),
 *    ext.labelsVisible, showLabels(true | false | [partIds]).
 *  - Surfaces come from state.surfaces (degrees, + = trailing edge down / rudder TE right); if missing they are
 *    derived from the inputs. Lights need bus power (state.elec.busVolts > 8) except during animations.
 *  - Paint: white with 1970s orange/brown stripes, registration "CX-APR" (fictitious) on both sides of the tail cone.
 *  - Rendering (core.js RENDERING NOTES): sRGB output + ACES tone mapping + physically correct lights. Colour canvas
 *    textures go through ctex() (sRGB-tagged); raw vertex colours are linear; light intensities are in physical
 *    units (LIGHTS). core.js gives ext.scene its 'studio' PMREM environment when ext.scene.environment is null, and
 *    opts the unlit helpers (MeshBasic/Sprite/Line) out of tone mapping.
 *  - "Configurator" look: clearcoated white enamel (paintMat, MeshPhysicalMaterial), tinted acrylic glass with a
 *    clearcoat Fresnel reflection, metal spinner/prop/hardware, matte rubber. Studio rig: key light = the WORLD sun
 *    (ext.setSun(world.sunDirection), turned by state.air.heading because the airplane's nose stays toward -Z here)
 *    casting a PCF-soft shadow map onto the airplane and onto a ShadowMaterial catcher; soft camera-side fill and a
 *    rim light opposite the camera (the fill backs off when the sun is already behind the camera); low hemisphere.
 *    Floor: light concrete slabs fading into the backdrop gradient (seamless cyclorama) + painted ambient-contact
 *    blobs under the tyres/fuselage; with shadow maps off ('baja') a painted planform shadow is pushed along the sun.
 *    The lights demo (dusk) dims lights, backdrop, floor, shadows and the environment reflections (setEnvDim).
 *  - Labels: rounded pills (dark with an accent dot / accent / light), white text with a dark halo. Every frame
 *    (Scene.onBeforeRender, per viewport) they are clamped inside the view, de-overlapped and kept clear of
 *    ext.setOccluder(rect) (core: the cockpit inset over the exterior main view); small viewports show only the
 *    most important part labels. ext.keyLight is the key DirectionalLight (read-only use).
 */
(function (C150) {
  'use strict';

  var DEG = Math.PI / 180;
  var ACCENT = 0xF08A3C;
  var CG = { x: 0, y: 0.55, z: 1.0 };
  var GROUND_Y = -1.206;
  var STANCE = 2;
  var REG = 'CX-APR';

  var VIEWS = {
    rear34: { pos: [-6.6, 3.5, 9.0], target: [0, 0.15, 0.4] },
    side: { pos: [-11.6, 0.7, 0.75], target: [0, 0.05, 0.75] },
    top: { pos: [0, 14.2, 0.95], target: [0, 0, 0.95], up: [0, 0, -1] },
    front: { pos: [2.2, 1.3, -10.6], target: [0, 0.15, 0] },
    rear: { pos: [0, 2.0, 12.2], target: [0, 0.45, 0] },
    pitot: { pos: [-1.55, -0.45, -2.25], target: [-2.45, 0.42, -0.35] },
    // internal views used by the animations
    tail: { pos: [2.6, 1.6, 7.6], target: [0.55, 0.05, 4.1] },
    nose: { pos: [-3.7, 0.75, -5.4], target: [0.15, -0.75, -0.4] },
    engine: { pos: [-4.4, 0.9, -3.4], target: [-0.9, 0.05, -1.4] },
    flaps: { pos: [-4.4, 3.2, 5.0], target: [-1.6, 0.45, 1.05] },
    aoa: { pos: [-11.0, 0.75, -0.3], target: [-5.0, 0.55, -0.15] },
    front34: { pos: [-5.2, 1.7, -7.6], target: [0, 0.1, -0.6] },
    rearHigh: { pos: [0, 5.2, 11.0], target: [0, 0.2, -1.2] },
    forces: { pos: [-12.8, 1.3, 0.3], target: [0, 0.2, 0.2] }
  };
  var PUBLIC_VIEWS = ['rear34', 'side', 'top', 'front', 'rear', 'pitot'];
  var ANIM_NAMES = ['axes-roll', 'axes-pitch', 'axes-yaw', 'four-forces', 'aoa-stall', 'flaps-extend', 'trim-tab',
    'adverse-yaw', 'left-turning', 'coordinated-turn', 'ground-steering', 'propeller-throttle', 'lights-demo',
    'controls-check', 'carb-ice', 'pitot-static'];
  var PART_IDS = ['aileronL', 'aileronR', 'elevator', 'trimTab', 'rudder', 'flapL', 'flapR', 'propeller', 'spinner',
    'noseWheel', 'mainWheels', 'brakes', 'wingL', 'wingR', 'stabilizer', 'fin', 'fuselage', 'cowling', 'pitotTube',
    'staticPort', 'stallWarningInlet', 'fuelCapL', 'fuelCapR', 'fuelVent', 'navLightL', 'navLightR', 'navLightTail',
    'beacon', 'landingLight', 'strobes', 'carbAirInlet', 'exhaust', 'doorL', 'doorR', 'windowL', 'struts', 'oilDoor'];

  /* ------------------------------------------------------------------ math helpers */
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  /** Smoothly interpolated keyframes [[t, v], ...]. */
  function kf(t, keys) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i];
        var u = (t - a[0]) / (b[0] - a[0]);
        return lerp(a[1], b[1], (1 - Math.cos(Math.PI * u)) / 2);
      }
    }
    return keys[keys.length - 1][1];
  }
  /** Step keys [[t, value], ...]: value of the last key with time <= t. */
  function stepKeys(t, keys) {
    var v = keys[0][1];
    for (var i = 0; i < keys.length; i++) if (t >= keys[i][0]) v = keys[i][1];
    return v;
  }
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  var FONT_DISPLAY = "'Barlow Condensed', 'Arial Narrow', sans-serif";

  /* ---------------------------------------------------------------- airfoils */
  /** NACA 4-digit: returns {u, l} y/c for upper and lower surfaces at x/c. */
  function naca(m, p, t, x) {
    x = clamp(x, 0, 1);
    var yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
    var yc = 0;
    if (m > 0) yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) * (1 - p)) * ((1 - 2 * p) + 2 * p * x - x * x);
    return { u: yc + yt, l: yc - yt };
  }
  function foil2412(x) { return naca(0.02, 0.4, 0.12, x); }
  function foil0009(x) { return naca(0, 0.4, 0.09, x); }
  function foilBlade(x) { return naca(0.03, 0.4, 0.09, x); }
  /**
   * Closed 2D loop [xc, yc] for the chord slice [f0, f1]: lower surface from f1 forward to f0, a rounded
   * nose when f0 > 0, then the upper surface back to f1. Same point count for any f0/f1 (n per surface, k nose).
   */
  function foilLoop(foil, f0, f1, n, k) {
    var pts = [], i, x, y;
    for (i = 0; i <= n; i++) {          // lower, aft → fore (cosine spacing, dense at the nose)
      var s = i / n;
      x = f0 + (f1 - f0) * (1 - Math.cos((1 - s) * Math.PI / 2));
      if (f0 > 0) x = f1 - (f1 - f0) * s;
      pts.push([x, foil(x).l]);
    }
    var fl = foil(f0);
    var mid = (fl.u + fl.l) / 2, r = (fl.u - fl.l) / 2;
    for (i = 1; i < k; i++) {            // nose (round when cut, otherwise the true leading edge)
      var a = -Math.PI / 2 + Math.PI * i / k;
      if (f0 > 0) pts.push([f0 - r * Math.cos(a) * 0.9, mid + r * Math.sin(a)]);
      else { x = 0.0025 * (1 - Math.cos(a)); pts.push([x * 0.5, mid + r * Math.sin(a) * 0.4]); }
    }
    for (i = 0; i <= n; i++) {          // upper, fore → aft
      var s2 = i / n;
      x = f0 + (f1 - f0) * (1 - Math.cos(s2 * Math.PI / 2));
      if (f0 > 0) x = f0 + (f1 - f0) * s2;
      pts.push([x, foil(x).u]);
    }
    return pts;
  }

  /* ======================================================================== */
  function create(THREE) {
    var V3 = THREE.Vector3;
    /** Canvas texture holding colour: sRGB-tagged (core.js RENDERING NOTES). */
    function ctex(c) { var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; }
    var ext = {};
    var scene = new THREE.Scene();
    scene.name = 'exterior';
    var camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 500);
    camera.position.set(-6.6, 3.5, 9.0);
    var target = new V3(0, 0.15, 0.4);
    camera.lookAt(target);

    /* ------------------------------------------------------------- lights */
    // Studio rig in physical units (renderer.physicallyCorrectLights; π lights a white Lambert surface to 1.0):
    //  key  = the world sun (ext.setSun: world.sunDirection, turned by the heading), casts the only shadow map;
    //  fill = soft cool light from the camera side (keeps the visible side readable when the sun is behind);
    //  rim  = cool light from behind the airplane relative to the camera (edge highlights on wing and fuselage);
    //  hemi = low sky/ground fill (core's studio environment map adds the rest of the ambient + reflections).
    var LIGHTS = { hemi: 0.4, key: 2.6, fill: 0.45, rim: 1.1 };
    var hemi = new THREE.HemisphereLight(0xe2edff, 0x8f897d, LIGHTS.hemi);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff1de, LIGHTS.key);
    sun.name = 'key';
    scene.add(sun, sun.target);
    var fill = new THREE.DirectionalLight(0xdce7ff, LIGHTS.fill);
    fill.name = 'fill';
    scene.add(fill, fill.target);
    var rim = new THREE.DirectionalLight(0xeef3ff, LIGHTS.rim);
    rim.name = 'rim';
    scene.add(rim, rim.target);
    // world sun: the world.js default (azimuth 105°, elevation 32°) until core calls ext.setSun()
    var sunWorld = new V3(Math.sin(105 * DEG) * Math.cos(32 * DEG), Math.sin(32 * DEG), -Math.cos(105 * DEG) * Math.cos(32 * DEG));
    var sunScene = sunWorld.clone();       // in the exterior scene (the airplane's nose stays toward -Z)
    var SHADOW_HALF = 6.6;
    (function setupShadow() {
      var sc = sun.shadow.camera;
      sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
      sc.near = 2; sc.far = 40; sc.updateProjectionMatrix();
      sun.shadow.mapSize.set(1536, 1536);
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
      sun.shadow.autoUpdate = false;       // re-rendered only when the airplane, a surface or the sun moved
      sun.shadow.needsUpdate = true;
      sun.castShadow = true;
    })();
    var lastHeading = null;
    function aimKey(heading) {
      heading = num(heading, 0);
      if (heading === lastHeading) return;
      lastHeading = heading;
      var h = heading * DEG, c = Math.cos(h), s = Math.sin(h);
      // world → exterior scene = rotation about +Y by the heading (the nose, world R_y(-h)·(-Z), maps to -Z)
      sunScene.set(sunWorld.x * c - sunWorld.z * s, Math.max(0.12, sunWorld.y), sunWorld.x * s + sunWorld.z * c).normalize();
      sun.position.copy(sunScene).multiplyScalar(20);
      sun.shadow.needsUpdate = true;
    }
    aimKey(0);
    var _camDir = new V3();
    /**
     * Fill from the camera side, rim from the opposite side (both above the horizon). When the sun is already behind
     * the camera (flat front light) the fill backs off and the rim grows, so the shape still reads.
     */
    function aimCameraLights(dusk) {
      _camDir.copy(camera.position).sub(target);
      _camDir.y = 0;
      if (_camDir.lengthSq() < 1e-4) _camDir.set(0, 0, 1);
      _camDir.normalize();
      fill.position.set(_camDir.x * 10 - _camDir.z * 4, 6, _camDir.z * 10 + _camDir.x * 4);
      rim.position.set(-_camDir.x * 10 + _camDir.z * 3, 7, -_camDir.z * 10 - _camDir.x * 3);
      var sh = Math.hypot(sunScene.x, sunScene.z) || 1;
      var front = Math.max(0, (sunScene.x * _camDir.x + sunScene.z * _camDir.z) / sh);
      fill.intensity = (1 - 0.55 * dusk) * LIGHTS.fill * (1 - 0.6 * front);
      rim.intensity = (1 - 0.7 * dusk) * LIGHTS.rim * (1 + 0.5 * front);
    }

    /* ----------------------------------------------------------- sky dome */
    // subtle studio backdrop: clean blue overhead → pale haze at the horizon, a faint warm glow toward the sun,
    // and below the horizon the colour the floor fades into (seamless cyclorama)
    var skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x7eaedb) }, uMid: { value: new THREE.Color(0xdde7ee) },
        uBottom: { value: new THREE.Color(0xd0d4d1) }, uSun: { value: sunScene }, uGlow: { value: new THREE.Color(0xffe2bd) },
        uGlowAmt: { value: 1 }
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uSun; uniform vec3 uGlow; uniform float uGlowAmt; varying vec3 vP;',
        'void main(){ vec3 d = normalize(vP); float e = d.y;',
        '  vec3 c = e > 0.0 ? mix(uMid, uTop, pow(clamp(e, 0.0, 1.0), 0.55)) : mix(uMid, uBottom, smoothstep(0.0, 0.12, -e));',
        '  float s = max(dot(d, uSun), 0.0);',
        '  c += uGlow * (pow(s, 6.0) * 0.10 + pow(s, 40.0) * 0.10) * uGlowAmt * smoothstep(-0.05, 0.1, e);',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <encodings_fragment>',
        '  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
        '}'
      ].join('\n'),
      side: THREE.BackSide, depthWrite: false
    });
    var skyDome = new THREE.Mesh(new THREE.SphereGeometry(200, 48, 24), skyMat);
    skyDome.renderOrder = -10;
    scene.add(skyDome);
    var SKY_DAY = [new THREE.Color(0x7eaedb), new THREE.Color(0xdde7ee), new THREE.Color(0xd0d4d1)];
    var SKY_DUSK = [new THREE.Color(0x14203a), new THREE.Color(0x5b4f6b), new THREE.Color(0x2b2a33)];

    /* --------------------------------------------------- floor, contact shadow, sun shadow */
    var groundGroup = new THREE.Group();
    scene.add(groundGroup);
    var FLOOR_R = 34;
    // light concrete apron: soft slab joints every 5 m, per-slab tone drift and fine grain, fading into the backdrop
    function drawFloor(size) {
      var c = makeCanvas(size, size), g = c.getContext('2d'), S = size / (FLOOR_R * 2), cx = size / 2;
      var seed = 76;
      function rnd() {
        seed = (seed + 0x6D2B79F5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }
      g.fillStyle = '#c8cbc7'; g.fillRect(0, 0, size, size);
      var slab = 5 * S, off = cx % slab;
      for (var y = -slab + off; y < size; y += slab) {
        for (var x = -slab + off; x < size; x += slab) {
          var v = (rnd() - 0.5) * 7;
          g.fillStyle = v > 0 ? 'rgba(255,253,246,' + (v / 60) + ')' : 'rgba(120,124,122,' + (-v / 60) + ')';
          g.fillRect(x, y, slab, slab);
        }
      }
      for (var i = 0; i < 2600; i++) {   // fine grain + a few darker specks
        var px = rnd() * size, py = rnd() * size, r = 0.6 + rnd() * 1.4;
        g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,250,0.10)' : 'rgba(90,94,92,0.08)';
        g.fillRect(px, py, r, r);
      }
      g.strokeStyle = 'rgba(98,104,104,0.12)'; g.lineWidth = Math.max(1, S * 0.02);
      for (var k = off; k < size; k += slab) {
        g.beginPath(); g.moveTo(k, 0); g.lineTo(k, size); g.stroke();
        g.beginPath(); g.moveTo(0, k); g.lineTo(size, k); g.stroke();
      }
      // radial fade into the backdrop colour (alpha), so the floor has no visible edge
      g.globalCompositeOperation = 'destination-in';
      var gr = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.42, 'rgba(0,0,0,1)'); gr.addColorStop(0.78, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, size, size);
      var t = ctex(c);
      t.anisotropy = 8;
      return t;
    }
    var diskMat = new THREE.MeshBasicMaterial({ map: drawFloor(1024), transparent: true, depthWrite: false });
    var disk = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_R, 96), diskMat);
    disk.rotation.x = -Math.PI / 2;
    disk.position.y = GROUND_Y;
    disk.renderOrder = -5;
    groundGroup.add(disk);
    // ambient contact shadow (straight down, all qualities): soft under the airplane, darker right under the tyres
    var aoCanvas = makeCanvas(512, 512);
    (function drawAO() {
      var g = aoCanvas.getContext('2d'), S = 512 / 12;   // 12 m across
      function X(x) { return 256 + x * S; }
      function Z(z) { return 256 + (z - CG.z) * S; }
      function blob(x, z, rx, rz, a) {
        var gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, 'rgba(14,20,24,' + a + ')'); gr.addColorStop(0.5, 'rgba(14,20,24,' + (a * 0.45) + ')'); gr.addColorStop(1, 'rgba(14,20,24,0)');
        g.save(); g.translate(X(x), Z(z)); g.scale(rx * S, rz * S);
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
      }
      blob(0, 1.2, 2.6, 3.6, 0.16);            // whole airplane (sky occlusion under the wing and fuselage)
      blob(0, 0.6, 1.0, 2.0, 0.16);            // fuselage belly
      blob(-1.159, 1.196, 0.32, 0.42, 0.55);   // main tyres
      blob(1.159, 1.196, 0.32, 0.42, 0.55);
      blob(0, -0.27, 0.22, 0.32, 0.5);         // nose tyre
    })();
    var aoMat = new THREE.MeshBasicMaterial({ map: ctex(aoCanvas), transparent: true, depthWrite: false });
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), aoMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = GROUND_Y + 0.003;
    shadow.renderOrder = -4;
    groundGroup.add(shadow);
    // the sun's shadow: a transparent shadow catcher fed by the key light's PCF-soft shadow map (alta/media)
    var catcherMat = new THREE.ShadowMaterial({ color: 0x18222c, opacity: 0.5, depthWrite: false });
    catcherMat.toneMapped = false;
    var catcher = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_R * 1.4, FLOOR_R * 1.4), catcherMat);
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = GROUND_Y + 0.006;
    catcher.renderOrder = -3;
    catcher.receiveShadow = true;
    groundGroup.add(catcher);
    // without shadow maps ('baja'): a soft painted planform shadow, pushed along the sun direction
    var planCanvas = makeCanvas(512, 512);
    (function drawPlanform() {
      var g = planCanvas.getContext('2d'), S = 512 / 12;
      function X(x) { return 256 + x * S; }
      function Z(z) { return 256 + (z - CG.z) * S; }
      g.shadowColor = 'rgba(20,28,32,0.42)'; g.shadowBlur = 16; g.shadowOffsetX = 2000;
      g.fillStyle = '#000';
      g.translate(-2000, 0);
      g.beginPath();   // wing
      g.moveTo(X(-5.08), Z(0.67)); g.lineTo(X(-2.38), Z(0.52)); g.lineTo(X(2.38), Z(0.52)); g.lineTo(X(5.08), Z(0.67));
      g.lineTo(X(5.08), Z(1.8)); g.lineTo(X(2.38), Z(2.13)); g.lineTo(X(-2.38), Z(2.13)); g.lineTo(X(-5.08), Z(1.8)); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(X(0), Z(1.6), 0.55 * S, 2.6 * S, 0, 0, Math.PI * 2); g.fill();   // fuselage
      g.beginPath(); g.ellipse(X(0), Z(4.0), 0.25 * S, 1.6 * S, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(X(-1.52), Z(4.6)); g.lineTo(X(1.52), Z(4.6)); g.lineTo(X(1.52), Z(5.25)); g.lineTo(X(-1.52), Z(5.25)); g.closePath(); g.fill();
    })();
    var planShadow = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
      new THREE.MeshBasicMaterial({ map: ctex(planCanvas), transparent: true, depthWrite: false }));
    planShadow.rotation.x = -Math.PI / 2;
    planShadow.position.y = GROUND_Y + 0.005;
    planShadow.renderOrder = -4;
    planShadow.visible = false;
    groundGroup.add(planShadow);
    // the renderer decides (core quality): shadow maps on → real shadow; off → painted planform
    var shadowsOn = true, shadowType = -1;
    disk.onBeforeRender = function (renderer) {
      var on = !!(renderer && renderer.shadowMap && renderer.shadowMap.enabled);
      if (on !== shadowsOn) { shadowsOn = on; sun.shadow.needsUpdate = true; }
      var type = renderer && renderer.shadowMap ? renderer.shadowMap.type : 0;
      if (on && type !== shadowType) {   // PCF-soft = 'alta' (1536²), plain PCF = 'media' (1024²)
        shadowType = type;
        var sz = type === THREE.PCFSoftShadowMap ? 1536 : 1024;
        if (sun.shadow.mapSize.x !== sz) {
          sun.shadow.mapSize.set(sz, sz);
          if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
        }
        sun.shadow.needsUpdate = true;
      }
    };
    // faint level horizon ring shown when airborne
    var horizonRing = new THREE.Group();
    (function () {
      var pts = [];
      for (var i = 0; i <= 128; i++) { var a = i / 128 * Math.PI * 2; pts.push(new V3(Math.cos(a) * 8, 0, Math.sin(a) * 8)); }
      var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x5f7f99, transparent: true, opacity: 0.55, depthWrite: false }));
      horizonRing.add(line);
      var disc = new THREE.Mesh(new THREE.RingGeometry(5.5, 8, 96),
        new THREE.MeshBasicMaterial({ color: 0x7d97ab, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      horizonRing.add(disc);
    })();
    horizonRing.visible = false;
    scene.add(horizonRing);

    /* ------------------------------------------------------- airplane groups */
    var rootGroup = new THREE.Group();     // ext.root
    rootGroup.name = 'cessna150';
    scene.add(rootGroup);
    var attitude = new THREE.Group();      // rotates about the CG
    rootGroup.add(attitude);
    var model = new THREE.Group();         // model frame (visual3d coordinates)
    model.position.set(-CG.x, -CG.y, -CG.z);
    attitude.add(model);
    var overlays = new THREE.Group();      // teaching overlays in the airplane frame (CG at origin)
    attitude.add(overlays);
    var windOverlays = new THREE.Group();  // overlays in the scene (wind) frame
    scene.add(windOverlays);

    /* ------------------------------------------------------------ materials */
    /**
     * 1976 white enamel, "configurator" finish: a slightly rough base under a glossy clearcoat (environment
     * reflections + a crisp sun highlight), never pure white so the curvature shading stays readable.
     */
    function paintMat(color, rough, extra) {
      var m = new THREE.MeshPhysicalMaterial({ color: color, roughness: rough != null ? rough : 0.42, metalness: 0,
        clearcoat: 0.55, clearcoatRoughness: 0.16, envMapIntensity: 0.85 });
      if (extra) for (var k2 in extra) m[k2] = extra[k2];
      return m;
    }
    var M = {
      paint: paintMat(0xffffff, 0.4),   // colour comes from the paint map (base #f4f3ef)
      white: paintMat(0xebeae6, 0.42),
      surf: paintMat(0xe9e8e4, 0.45),
      // tinted acrylic: almost no diffuse, strong Fresnel reflection of the sky/studio through the clearcoat layer
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0f1c27, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
        transparent: true, opacity: 0.86, envMapIntensity: 1.5 }),
      interior: new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.4 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.86, envMapIntensity: 0.55 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xb9bdc1, roughness: 0.32, metalness: 0.85 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.12, metalness: 1.0 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.62, metalness: 0.25 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0f1113, roughness: 0.75 }),
      exhaust: new THREE.MeshStandardMaterial({ color: 0x6b5a4c, roughness: 0.55, metalness: 0.7 }),
      blade: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.6 }),
      lensRed: new THREE.MeshStandardMaterial({ color: 0x8a1a14, emissive: 0x000000, roughness: 0.2, transparent: true, opacity: 0.95 }),
      lensGreen: new THREE.MeshStandardMaterial({ color: 0x1a6a2c, emissive: 0x000000, roughness: 0.2, transparent: true, opacity: 0.95 }),
      lensWhite: new THREE.MeshStandardMaterial({ color: 0xdfe4e8, emissive: 0x000000, roughness: 0.15, transparent: true, opacity: 0.95 }),
      fin: paintMat(0xffffff, 0.4)
    };

    /* ----------------------------------------------- part registry (highlight) */
    var parts = {};          // id → [meshes]
    var partMatCache = {};   // id → Map(original material uuid → clone)
    var matOwners = {};      // material uuid → part id that owns it
    function part(id, obj) {
      if (!parts[id]) { parts[id] = []; partMatCache[id] = {}; }
      obj.traverse(function (o) {
        if (!o.isMesh) return;
        var mat = o.material;
        if (!mat || mat.isShaderMaterial || mat.isSpriteMaterial) return;
        var owner = matOwners[mat.uuid];
        if (owner && owner !== id) {
          var cache = partMatCache[id];
          if (!cache[mat.uuid]) { cache[mat.uuid] = mat.clone(); matOwners[cache[mat.uuid].uuid] = id; }
          o.material = cache[mat.uuid];
        } else matOwners[mat.uuid] = id;
        o.userData.partId = id;
        parts[id].push(o);
      });
      return obj;
    }

    /* =========================================================== FUSELAGE */
    // stations: z, half width, top y, bottom y, superellipse exponent
    var FUS = [
      [-0.88, 0.335, 0.675, 0.17, 2.5], [-0.80, 0.40, 0.70, 0.05, 2.8], [-0.60, 0.44, 0.715, -0.03, 3.2],
      [-0.30, 0.46, 0.73, -0.07, 3.5], [0.00, 0.48, 0.745, -0.08, 3.6], [0.10, 0.50, 0.78, -0.08, 3.8],
      [0.22, 0.52, 0.875, -0.08, 3.9], [0.34, 0.535, 0.955, -0.08, 4.0], [0.46, 0.545, 1.025, -0.075, 4.0],
      [0.62, 0.555, 1.06, -0.07, 4.2], [1.00, 0.56, 1.06, -0.06, 4.2], [1.42, 0.55, 1.06, -0.04, 4.0],
      [1.80, 0.52, 1.06, 0.00, 3.8], [2.10, 0.47, 1.00, 0.07, 3.4], [2.45, 0.40, 0.915, 0.14, 3.0],
      [2.90, 0.32, 0.868, 0.22, 2.7], [3.50, 0.245, 0.848, 0.32, 2.5], [4.20, 0.175, 0.838, 0.43, 2.4],
      [4.90, 0.12, 0.832, 0.52, 2.3], [5.35, 0.085, 0.826, 0.575, 2.2], [5.62, 0.045, 0.81, 0.615, 2.2]
    ];
    var Z_NOSE = FUS[0][0], Z_TAIL = FUS[FUS.length - 1][0];
    var secTmp = { hw: 0, top: 0, bot: 0, n: 0 };
    /** Cross-section parameters at z (cubic Hermite through the stations). */
    function section(z, out) {
      out = out || secTmp;
      z = clamp(z, Z_NOSE, Z_TAIL);
      var i = 0;
      while (i < FUS.length - 2 && z > FUS[i + 1][0]) i++;
      var a = FUS[i], b = FUS[i + 1], h = b[0] - a[0], t = (z - a[0]) / h;
      var pa = FUS[Math.max(0, i - 1)], pb = FUS[Math.min(FUS.length - 1, i + 2)];
      var h00 = 2 * t * t * t - 3 * t * t + 1, h10 = t * t * t - 2 * t * t + t, h01 = -2 * t * t * t + 3 * t * t, h11 = t * t * t - t * t;
      function comp(k) {
        var ma = (b[k] - pa[k]) / (b[0] - pa[0] || 1) * h, mb = (pb[k] - a[k]) / (pb[0] - a[0] || 1) * h;
        if ((b[k] - a[k]) * ma < 0) ma = 0;
        if ((b[k] - a[k]) * mb < 0) mb = 0;
        return h00 * a[k] + h10 * ma + h01 * b[k] + h11 * mb;
      }
      out.hw = comp(1); out.top = comp(2); out.bot = comp(3); out.n = comp(4);
      return out;
    }
    /** Surface point at (z, p); p ∈ [0, 2]: 0 bottom centre, 0.5 right side, 1 top, 1.5 left side. */
    function fusPoint(z, p, out) {
      var s = section(z);
      var t = -Math.PI / 2 + p * Math.PI, c = Math.cos(t), sn = Math.sin(t), e = 2 / s.n;
      var yc = (s.top + s.bot) / 2, hh = (s.top - s.bot) / 2;
      out.set((c < 0 ? -1 : 1) * s.hw * Math.pow(Math.abs(c), e),
        yc + (sn < 0 ? -1 : 1) * hh * Math.pow(Math.abs(sn), e), z);
      return out;
    }
    var _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();
    function fusNormal(z, p, out) {
      var ep = 0.004, ez = 0.01;
      fusPoint(z, p + ep, _a); fusPoint(z, p - ep, _b); _a.sub(_b);
      fusPoint(Math.min(z + ez, Z_TAIL), p, _c); fusPoint(Math.max(z - ez, Z_NOSE), p, _d); _c.sub(_d);
      out.crossVectors(_a, _c).normalize();
      var s = section(z);
      fusPoint(z, p, _b);
      if (out.x * _b.x + out.y * (_b.y - (s.top + s.bot) / 2) < 0) out.negate();
      if (!isFinite(out.x)) out.set(0, p > 0.5 && p < 1.5 ? 1 : -1, 0);
      return out;
    }
    /** p on a given side for a height y (inverse of the superellipse). */
    function pOfY(z, y, side) {
      var s = section(z), yc = (s.top + s.bot) / 2, hh = (s.top - s.bot) / 2;
      var u = clamp((y - yc) / hh, -1, 1);
      var sn = (u < 0 ? -1 : 1) * Math.pow(Math.abs(u), s.n / 2);
      var t = Math.asin(clamp(sn, -1, 1));
      if (side < 0) t = Math.PI - t;
      return (t + Math.PI / 2) / Math.PI;
    }
    // texture projection (side view per half)
    var ZU0 = -0.92, ZU1 = 5.70, YU0 = -0.12, YU1 = 1.12;
    function sideUV(x, y, z, out) {
      out[0] = (z - ZU0) / (ZU1 - ZU0);
      out[1] = (x >= 0 ? 0.5 : 0) + 0.5 * clamp((y - YU0) / (YU1 - YU0), 0, 1);
      return out;
    }
    /** Grid over the fuselage surface between z0..z1 (both halves, analytic normals, side-projected UVs). */
    function fuselageGeometry(z0, z1, nz, np, offset) {
      var pos = [], nor = [], uv = [], idx = [], P = new V3(), N = new V3(), uvt = [0, 0];
      var cols = np + 1, base = 0;
      [[0, 1, 1], [1, 2, -1]].forEach(function (half) {
        for (var i = 0; i <= nz; i++) {
          var z = z0 + (z1 - z0) * i / nz;
          for (var j = 0; j <= np; j++) {
            var p = half[0] + (half[1] - half[0]) * j / np;
            p = clamp(p, 0.0005, 1.9995);
            fusPoint(z, p, P); fusNormal(z, p, N);
            if (offset) P.addScaledVector(N, offset);
            pos.push(P.x, P.y, P.z); nor.push(N.x, N.y, N.z);
            sideUV(half[2], P.y, P.z, uvt);
            uv.push(uvt[0], uvt[1]);
          }
        }
        for (var i2 = 0; i2 < nz; i2++) {
          for (var j2 = 0; j2 < np; j2++) {
            var a = base + i2 * cols + j2, b = a + 1, c = a + cols, d = c + 1;
            idx.push(a, b, c, b, d, c);
          }
        }
        base += (nz + 1) * cols;
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      fixWinding(g);
      return g;
    }
    /** Makes triangle winding agree with the stored normals (so FrontSide culling works). */
    function fixWinding(g) {
      var idx = g.index.array, p = g.attributes.position, n = g.attributes.normal;
      for (var t = 0; t < idx.length; t += 3) {
        var a = idx[t], b = idx[t + 1], c = idx[t + 2];
        _a.fromBufferAttribute(p, a); _b.fromBufferAttribute(p, b); _c.fromBufferAttribute(p, c);
        _b.sub(_a); _c.sub(_a); _d.crossVectors(_b, _c);
        _a.fromBufferAttribute(n, a);
        if (_d.dot(_a) < 0) { idx[t + 1] = c; idx[t + 2] = b; }
      }
      g.index.needsUpdate = true;
    }
    /**
     * Patch on the fuselage from a closed outline in (z, y) on one side (side = -1 left, +1 right) or in (z, p)
     * when usePerimeter. The outline is triangulated, subdivided and projected onto the surface (+offset).
     */
    function surfacePatch(outline, side, offset, usePerimeter, maxEdge) {
      var shape = new THREE.Shape(outline.map(function (q) { return new THREE.Vector2(q[0], q[1]); }));
      var sg = new THREE.ShapeGeometry(shape);
      var src = sg.attributes.position, sidx = sg.index ? sg.index.array : null;
      var tris = [];
      var count = sidx ? sidx.length : src.count;
      for (var i = 0; i < count; i += 3) {
        var ia = sidx ? sidx[i] : i, ib = sidx ? sidx[i + 1] : i + 1, ic = sidx ? sidx[i + 2] : i + 2;
        tris.push([[src.getX(ia), src.getY(ia)], [src.getX(ib), src.getY(ib)], [src.getX(ic), src.getY(ic)]]);
      }
      maxEdge = maxEdge || 0.06;
      var out = [];
      function len(a, b) { return Math.hypot(a[0] - b[0], (a[1] - b[1]) * (usePerimeter ? 1.2 : 1)); }
      function sub(t, depth) {
        var l0 = len(t[0], t[1]), l1 = len(t[1], t[2]), l2 = len(t[2], t[0]);
        var m = Math.max(l0, l1, l2);
        if (m < maxEdge || depth > 9) { out.push(t); return; }
        function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
        if (m === l0) { var m0 = mid(t[0], t[1]); sub([t[0], m0, t[2]], depth + 1); sub([m0, t[1], t[2]], depth + 1); }
        else if (m === l1) { var m1 = mid(t[1], t[2]); sub([t[0], t[1], m1], depth + 1); sub([t[0], m1, t[2]], depth + 1); }
        else { var m2 = mid(t[2], t[0]); sub([t[0], t[1], m2], depth + 1); sub([m2, t[1], t[2]], depth + 1); }
      }
      tris.forEach(function (t) { sub(t, 0); });
      var pos = [], nor = [], uv = [], P = new V3(), N = new V3(), uvt = [0, 0];
      out.forEach(function (t) {
        for (var k = 0; k < 3; k++) {
          var z = t[k][0], p = usePerimeter ? t[k][1] : pOfY(t[k][0], t[k][1], side);
          fusPoint(z, p, P); fusNormal(z, p, N);
          P.addScaledVector(N, offset);
          pos.push(P.x, P.y, P.z); nor.push(N.x, N.y, N.z);
          sideUV(P.x, P.y, P.z, uvt); uv.push(uvt[0], uvt[1]);
        }
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      var ii = []; for (var q = 0; q < pos.length / 3; q++) ii.push(q);
      g.setIndex(ii);
      fixWinding(g);
      return g;
    }
    function roundedRect(z0, y0, z1, y1, r, n) {
      var pts = [];
      n = n || 5;
      var corners = [[z1 - r, y1 - r, 0], [z0 + r, y1 - r, 90], [z0 + r, y0 + r, 180], [z1 - r, y0 + r, 270]];
      corners.forEach(function (c) {
        for (var i = 0; i <= n; i++) {
          var a = (c[2] + 90 * i / n) * DEG;
          pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
        }
      });
      return pts;
    }

    /* ---------------------------------------------- fuselage paint texture */
    var paintCanvas = makeCanvas(2048, 1024);
    function stripeY(z) {   // lower / upper edge of the orange stripe at z
      var t = smooth((z - 1.9) / (Z_TAIL - 1.9));
      return [lerp(0.235, 0.655, t), lerp(0.37, 0.745, t)];
    }
    function drawPaint() {
      var g = paintCanvas.getContext('2d'), W = 2048, H = 1024, HH = H / 2;
      g.clearRect(0, 0, W, H);
      function X(z) { return (z - ZU0) / (ZU1 - ZU0) * W; }
      function Y(y, half) { return half * HH + (1 - (y - YU0) / (YU1 - YU0)) * HH; }
      [0, 1].forEach(function (half) {   // half 0 = right side (top of canvas), 1 = left side
        g.save();
        g.beginPath(); g.rect(0, half * HH, W, HH); g.clip();
        g.fillStyle = '#f4f3ef'; g.fillRect(0, half * HH, W, HH);
        // belly shading and subtle exhaust stain
        var gb = g.createLinearGradient(0, Y(0.1, half), 0, Y(-0.12, half));
        gb.addColorStop(0, 'rgba(180,182,178,0)'); gb.addColorStop(1, 'rgba(150,152,148,0.35)');
        g.fillStyle = gb; g.fillRect(0, Y(0.1, half), W, Y(-0.12, half) - Y(0.1, half));
        function band(off0, off1, color) {
          g.fillStyle = color;
          g.beginPath();
          for (var z = ZU0; z <= Z_TAIL + 0.05; z += 0.05) { var s = stripeY(z); g.lineTo(X(z), Y(s[1] + off1, half)); }
          for (var z2 = Z_TAIL + 0.05; z2 >= ZU0; z2 -= 0.05) { var s2 = stripeY(z2); g.lineTo(X(z2), Y(s2[0] + off0, half)); }
          g.closePath(); g.fill();
        }
        band(-0.045, -0.12, '#6b3a1f');   // brown pinstripe below (offsets from the stripe edges)
        g.fillStyle = '#f4f3ef';
        band(-0.03, -0.12 - 0.0001, '#f4f3ef');
        band(0, 0, '#d9661c');             // orange stripe
        band(0.15, 0.04, '#f4f3ef');
        // brown line just above the orange stripe
        g.fillStyle = '#6b3a1f';
        g.beginPath();
        for (var z3 = ZU0; z3 <= Z_TAIL + 0.05; z3 += 0.05) { var s3 = stripeY(z3); g.lineTo(X(z3), Y(s3[1] + 0.035, half)); }
        for (var z4 = Z_TAIL + 0.05; z4 >= ZU0; z4 -= 0.05) { var s4 = stripeY(z4); g.lineTo(X(z4), Y(s4[1] + 0.017, half)); }
        g.closePath(); g.fill();
        // panel seams
        g.strokeStyle = 'rgba(120,124,126,0.55)'; g.lineWidth = 2;
        [0, 2.62, 3.42, 4.22, 5.02].forEach(function (z) { g.beginPath(); g.moveTo(X(z), Y(1.1, half)); g.lineTo(X(z), Y(-0.1, half)); g.stroke(); });
        g.beginPath(); g.moveTo(X(-0.88), Y(0.47, half)); g.lineTo(X(0), Y(0.47, half)); g.stroke();
        g.lineWidth = 1.2; g.strokeStyle = 'rgba(120,124,126,0.35)';
        for (var r = -0.8; r < 0; r += 0.2) { g.beginPath(); g.moveTo(X(r), Y(0.66, half)); g.lineTo(X(r + 0.12), Y(0.66, half)); g.stroke(); }
        // door outline and handle
        g.strokeStyle = 'rgba(70,74,78,0.8)'; g.lineWidth = 2.5;
        g.strokeRect(X(0.625), Y(0.995, half), X(1.395) - X(0.625), Y(0.03, half) - Y(0.995, half));
        g.fillStyle = '#9aa0a5';
        g.fillRect(X(1.24), Y(0.555, half), X(1.36) - X(1.24), Y(0.53, half) - Y(0.555, half));
        // step plate + "NO STEP" style marks are left out; registration on the tail cone
        g.fillStyle = '#1b2733';
        g.font = '700 ' + Math.round((Y(0.62, half) - Y(0.80, half)) * 1.15) + 'px ' + FONT_DISPLAY;
        g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        var cxz = X(3.22), base = Y(0.62, half);
        g.save();
        g.translate(cxz, base);
        if (half === 0) g.scale(-1, 1);    // right side: mirrored so it reads normally from that side
        var tw = g.measureText(REG).width, target = X(3.95) - X(2.5);
        g.scale(Math.min(1.25, target / tw), 1);
        g.fillText(REG, 0, 0);
        g.restore();
        g.restore();
      });
    }
    drawPaint();
    var paintTex = ctex(paintCanvas);
    paintTex.anisotropy = 4;
    M.paint.map = paintTex;

    // fin/rudder paint (side projection z 4.3..6.4, y 0.5..2.2)
    var finCanvas = makeCanvas(512, 512);
    var FZ0 = 4.3, FZ1 = 6.4, FY0 = 0.5, FY1 = 2.2;
    function drawFin() {
      var g = finCanvas.getContext('2d');
      function X(z) { return (z - FZ0) / (FZ1 - FZ0) * 512; }
      function Y(y) { return (1 - (y - FY0) / (FY1 - FY0)) * 512; }
      g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, 512, 512);
      function slant(y0, y1, color) {   // band parallel to the swept leading edge
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(X(4.2 + (y0 - 0.82) * 0.733), Y(y0)); g.lineTo(X(6.6), Y(y0 + 0.18));
        g.lineTo(X(6.6), Y(y1 + 0.18)); g.lineTo(X(4.2 + (y1 - 0.82) * 0.733), Y(y1));
        g.closePath(); g.fill();
      }
      slant(1.28, 1.52, '#d9661c');
      slant(1.53, 1.57, '#f4f3ef');
      slant(1.57, 1.63, '#6b3a1f');
      slant(1.22, 1.26, '#6b3a1f');
    }
    drawFin();
    var finTex = ctex(finCanvas);
    M.fin.map = finTex;
    function finUV(g) {
      var p = g.attributes.position, uv = [];
      for (var i = 0; i < p.count; i++) uv.push((p.getZ(i) - FZ0) / (FZ1 - FZ0), (p.getY(i) - FY0) / (FY1 - FY0));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    }

    // corrugated skin for flaps / ailerons: chordwise ribs every ~4 cm (u = span metres / 0.6)
    (function () {
      var c = makeCanvas(64, 8), g = c.getContext('2d');
      g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 8);
      for (var i = 0; i < 16; i++) {
        var gr = g.createLinearGradient(i * 4, 0, i * 4 + 4, 0);
        gr.addColorStop(0, '#5a5a5a'); gr.addColorStop(0.5, '#d0d0d0'); gr.addColorStop(1, '#5a5a5a');
        g.fillStyle = gr; g.fillRect(i * 4, 0, 4, 8);
      }
      var t = ctex(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      M.surf.bumpMap = t;
      M.surf.bumpScale = 0.004;
    })();

    // build the fuselage and cowling
    var cowl = new THREE.Mesh(fuselageGeometry(Z_NOSE, 0, 18, 36), M.paint);
    model.add(part('cowling', cowl));
    var fuselage = new THREE.Mesh(fuselageGeometry(0, Z_TAIL, 110, 40), M.paint);
    model.add(part('fuselage', fuselage));
    // tail-end cap
    (function () {
      var pts = [], P = new V3();
      for (var i = 0; i <= 24; i++) { fusPoint(Z_TAIL, i / 12, P); pts.push(P.clone()); }
      var g = new THREE.BufferGeometry(), pos = [];
      var cy = (section(Z_TAIL).top + section(Z_TAIL).bot) / 2;
      for (var k = 0; k < 24; k++) pos.push(0, cy, Z_TAIL + 0.03, pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      var m = new THREE.Mesh(g, M.white); m.material.side = THREE.FrontSide;
      var cap = new THREE.Mesh(g, paintMat(0xeae9e5, 0.42, { side: THREE.DoubleSide }));
      model.add(part('fuselage', cap));
    })();

    // nose bowl: flat ring from the cowl front outline to the spinner base, inlets, landing light, carb intake
    (function buildNose() {
      var zf = Z_NOSE, cyS = 0.49, rS = 0.172, P = new V3();
      var pos = [], N = 64;
      for (var i = 0; i < N; i++) {
        var p0 = i / N * 2, p1 = (i + 1) / N * 2;
        fusPoint(zf, p0, _a); fusPoint(zf, p1, _b);
        var a0 = Math.atan2(_a.y - cyS, _a.x), a1 = Math.atan2(_b.y - cyS, _b.x);
        var c0x = Math.cos(a0) * rS, c0y = cyS + Math.sin(a0) * rS, c1x = Math.cos(a1) * rS, c1y = cyS + Math.sin(a1) * rS;
        pos.push(_a.x, _a.y, zf, c0x, c0y, zf - 0.015, _b.x, _b.y, zf);
        pos.push(_b.x, _b.y, zf, c0x, c0y, zf - 0.015, c1x, c1y, zf - 0.015);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      var bowl = new THREE.Mesh(g, paintMat(0xe8e7e3, 0.45, { side: THREE.DoubleSide }));
      model.add(part('cowling', bowl));
      // cooling-air inlets (one each side of the spinner)
      [-1, 1].forEach(function (s) {
        var inlet = new THREE.Mesh(new THREE.CircleGeometry(1, 28), M.black);
        inlet.scale.set(0.085, 0.07, 1);
        inlet.position.set(s * 0.225, 0.505, zf - 0.006);
        inlet.rotation.y = Math.PI;
        model.add(part('cowling', inlet));
      });
      // induction air intake with filter (lower front)
      var intake = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.065, 0.02), M.dark);
      intake.position.set(0, 0.235, zf - 0.008);
      model.add(part('carbAirInlet', intake));
      var grill = new THREE.Group();
      for (var k = 0; k < 6; k++) {
        var bar = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.06, 0.012), M.metal);
        bar.position.set(-0.07 + k * 0.028, 0.235, zf - 0.02);
        grill.add(bar);
      }
      model.add(part('carbAirInlet', grill));
      // landing light in the nose cap (lower left)
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.008, 8, 24), M.chrome);
      ring.position.set(-0.16, 0.29, zf - 0.01);
      var lens = new THREE.Mesh(new THREE.CircleGeometry(0.046, 24), M.lensWhite.clone());
      lens.position.set(-0.16, 0.29, zf - 0.012);
      lens.rotation.y = Math.PI;
      var ll = new THREE.Group(); ll.add(ring); ll.add(lens);
      model.add(part('landingLight', ll));
      lights.landingLens = lens;
      // exhaust tailpipes under each side of the cowl
      [-1, 1].forEach(function (s) {
        var pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10, 1, true), M.exhaust);
        pipe.position.set(s * 0.2, -0.13, -0.16);
        pipe.rotation.x = -0.6;
        model.add(part('exhaust', pipe));
      });
      // oil access door (top right of the cowl)
      var door = new THREE.Mesh(surfacePatch(roundedRect(-0.42, 0.0, -0.17, 0.0, 0.01), 1, 0.003, true), M.white);
      door.geometry.dispose();
      var outline = roundedRect(-0.40, 0.62, -0.20, 0.72, 0.02);
      door = new THREE.Mesh(surfacePatch(outline.map(function (q) { return [q[0], pOfY(q[0], q[1], 1)]; }), 1, 0.003, true, 0.03),
        paintMat(0xe6e5e0, 0.45));
      model.add(part('oilDoor', door));
      var seam = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outline.map(function (q) {
        var p = pOfY(q[0], q[1], 1); var v = new V3(); fusPoint(q[0], p, v); fusNormal(q[0], p, _a); return v.addScaledVector(_a, 0.004);
      })), new THREE.LineBasicMaterial({ color: 0x7c8186 }));
      model.add(seam);
    })();

    /* ----------------------------------------------------------- glass */
    var glassMat = M.glass;
    (function buildGlass() {
      // windshield: from the base (z 0.10, y 0.745) up to the wing (z 0.53, y 1.05), wrapping across the top
      var outline = [], k;
      function pillarY(z) { return 0.745 + (z - 0.095) / (0.53 - 0.095) * (1.05 - 0.745); }
      for (k = 0; k <= 12; k++) { var z = 0.095 + (0.53 - 0.095) * k / 12; outline.push([z, pOfY(z, pillarY(z) + 0.012, 1)]); }
      for (k = 12; k >= 0; k--) { var z2 = 0.095 + (0.53 - 0.095) * k / 12; outline.push([z2, pOfY(z2, pillarY(z2) + 0.012, -1)]); }
      model.add(new THREE.Mesh(surfacePatch(outline, 1, 0.004, true, 0.05), glassMat));
      // rear "Omni-Vision" window wrapping over the cut-down rear fuselage
      outline = [];
      for (k = 0; k <= 12; k++) { var z3 = 1.84 + 0.62 * k / 12; outline.push([z3, pOfY(z3, lerp(0.86, 0.80, k / 12), 1)]); }
      for (k = 12; k >= 0; k--) { var z4 = 1.84 + 0.62 * k / 12; outline.push([z4, pOfY(z4, lerp(0.86, 0.80, k / 12), -1)]); }
      model.add(new THREE.Mesh(surfacePatch(outline, 1, 0.004, true, 0.05), glassMat));
      // rear side windows (behind the doors)
      [-1, 1].forEach(function (s) {
        var o = [[1.47, 0.6], [2.12, 0.62], [2.30, 0.80], [2.18, 0.97], [1.47, 0.99]];
        model.add(new THREE.Mesh(surfacePatch(o, s, 0.004, false, 0.05), glassMat));
      });
    })();

    /* ------------------------------------------------------------- doors */
    var doors = {};
    (function buildDoors() {
      [-1, 1].forEach(function (s) {
        var id = s < 0 ? 'doorL' : 'doorR';
        var hingeZ = 0.62;
        var pivot = new THREE.Group();
        fusPoint(hingeZ, pOfY(hingeZ, 0.5, s), _a);
        pivot.position.set(_a.x, 0, hingeZ);
        model.add(pivot);
        var outline = roundedRect(0.63, 0.035, 1.39, 0.99, 0.03);
        var g = surfacePatch(outline, s, 0.005, false, 0.05);
        g.translate(-pivot.position.x, 0, -hingeZ);
        var door = new THREE.Mesh(g, M.paint);
        pivot.add(part(id, door));
        // the dark opening behind the door (shown only while open)
        var hole = new THREE.Mesh(surfacePatch(outline, s, 0.002, false, 0.06), M.interior);
        hole.visible = false;
        model.add(hole);
        // door window
        var winOutline = roundedRect(0.70, 0.575, 1.33, 0.955, 0.07);
        var wg = surfacePatch(winOutline, s, 0.009, false, 0.04);
        var winPivot = new THREE.Group();
        var topY = 0.955;
        fusPoint(1.0, pOfY(1.0, topY, s), _b);
        winPivot.position.set(_b.x - pivot.position.x, topY, 0);
        wg.translate(-pivot.position.x - winPivot.position.x, -topY, -hingeZ);
        var win = new THREE.Mesh(wg, glassMat);
        winPivot.add(win);
        pivot.add(winPivot);
        if (s < 0) part('windowL', win);
        var winHole = new THREE.Mesh(surfacePatch(winOutline, s, 0.007, false, 0.06), M.interior);
        winHole.geometry.translate(-pivot.position.x, 0, -hingeZ);
        winHole.visible = false;
        pivot.add(winHole);
        // simple seats visible through an open door
        var seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.45), M.dark);
        seat.position.set(s * 0.24, 0.18, 0.98);
        model.add(seat);
        var back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.08), M.dark);
        back.position.set(s * 0.24, 0.5, 1.27); back.rotation.x = -0.15;
        model.add(back);
        doors[id] = { pivot: pivot, hole: hole, side: s, winPivot: winPivot, winHole: winHole };
      });
    })();

    /* ------------------------------------------------------- loft helper */
    /** Lofts closed 3D loops (same length) into an indexed geometry with caps. uvU[i] gives u per loop. */
    function loft(loops, opts) {
      opts = opts || {};
      var n = loops.length, L = loops[0].length, cols = L + 1;
      var pos = [], uv = [], idx = [];
      for (var i = 0; i < n; i++) {
        for (var j = 0; j <= L; j++) {
          var p = loops[i][j % L];
          pos.push(p.x, p.y, p.z);
          uv.push(opts.uvU ? opts.uvU[i] : i / (n - 1), j / L);
        }
      }
      for (var i2 = 0; i2 < n - 1; i2++) {
        for (var j2 = 0; j2 < L; j2++) {
          var a = i2 * cols + j2, b = a + 1, c = a + cols, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      // winding check against the loop centroid of a middle station
      var mi = Math.floor((n - 1) / 2), cen = new V3();
      loops[mi].forEach(function (p) { cen.add(p); }); cen.multiplyScalar(1 / L);
      var t0 = (mi * L + Math.floor(L / 4)) * 6;
      var A = new V3().fromArray(pos, idx[t0] * 3), B = new V3().fromArray(pos, idx[t0 + 1] * 3), C = new V3().fromArray(pos, idx[t0 + 2] * 3);
      var nrm = new V3().crossVectors(B.clone().sub(A), C.clone().sub(A));
      var flip = nrm.dot(A.clone().sub(cen)) < 0;
      if (flip) for (var f = 0; f < idx.length; f += 3) { var tmp = idx[f + 1]; idx[f + 1] = idx[f + 2]; idx[f + 2] = tmp; }
      // caps (separate vertices so they shade flat)
      [0, n - 1].forEach(function (li, which) {
        if (opts.caps === false || (opts.caps && !opts.caps[which])) return;
        var loop = loops[li], c0 = new V3();
        loop.forEach(function (p) { c0.add(p); }); c0.multiplyScalar(1 / L);
        var base = pos.length / 3;
        pos.push(c0.x, c0.y, c0.z); uv.push(0, 0);
        loop.forEach(function (p) { pos.push(p.x, p.y, p.z); uv.push(0, 0); });
        var other = loops[li === 0 ? 1 : n - 2], oc = new V3();
        other.forEach(function (p) { oc.add(p); }); oc.multiplyScalar(1 / L);
        var outward = c0.clone().sub(oc);
        for (var k = 0; k < L; k++) {
          var ia = base + 1 + k, ib = base + 1 + ((k + 1) % L);
          var PA = new V3().fromArray(pos, ia * 3).sub(c0), PB = new V3().fromArray(pos, ib * 3).sub(c0);
          if (new V3().crossVectors(PA, PB).dot(outward) >= 0) idx.push(base, ia, ib); else idx.push(base, ib, ia);
        }
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    /* ============================================================== WING */
    var WING_HALF = 5.08, FLAP_IN = 0.60, BREAK = 2.38, AIL_OUT = 4.75;
    var FLAP_F = 0.76, AIL_F = 0.77;
    function wingPlan(s) {
      if (s <= BREAK) return { le: 0.52, c: 1.61 };
      var t = (s - BREAK) / (WING_HALF - BREAK);
      return { le: 0.52 + 0.15 * t, c: 1.61 - 0.48 * t };
    }
    function wingChordY(s) { return 1.105 + s * Math.tan(1 * DEG); }
    function wingInc(s) { return (1 - s / WING_HALF) * DEG; }
    /** Wing point at span s (≥0), side sx (±1), chord fraction xc, airfoil ordinate yc (in chords). */
    function wingPoint(sx, s, xc, yc, out, extra) {
      var pl = wingPlan(s), c = pl.c * (extra ? extra.cScale : 1), inc = wingInc(s);
      var xi = (xc - 0.25) * c, eta = yc * c * (extra ? extra.tScale : 1);
      var y = wingChordY(s) + eta * Math.cos(inc) - xi * Math.sin(inc) + (extra ? extra.dy : 0);
      var z = pl.le + (extra ? extra.dz : 0) + 0.25 * c + eta * Math.sin(inc) + xi * Math.cos(inc);
      return (out || new V3()).set(sx * s, y, z);
    }
    function wingLoft(sx, s0, s1, nS, f0, f1, extraFn) {
      var loops = [], uvU = [];
      for (var i = 0; i <= nS; i++) {
        var s = s0 + (s1 - s0) * i / nS;
        var lp = foilLoop(foil2412, f0, f1, 14, f0 > 0 ? 6 : 6);
        var ex = extraFn ? extraFn(s) : null;
        loops.push(lp.map(function (q) { return wingPoint(sx, s, q[0], q[1], null, ex); }));
        uvU.push(s / 0.6);
      }
      return loft(loops, { uvU: uvU });
    }
    var surfaces = {};
    function hingeGroup(parent, p0, p1) {
      var g = new THREE.Group();
      g.position.copy(p0);
      parent.add(g);
      g.userData.axis = p1.clone().sub(p0).normalize();
      if (g.userData.axis.x < 0) g.userData.axis.negate();
      return g;
    }
    (function buildWings() {
      [-1, 1].forEach(function (sx) {
        var wid = sx < 0 ? 'wingL' : 'wingR';
        var tipEx = function (s) {
          var t = clamp((s - 4.98) / (WING_HALF - 4.98), 0, 1);
          return { cScale: 1 - 0.25 * t * t, tScale: 1 - 0.8 * t * t, dy: -0.07 * t * t, dz: 0.06 * t * t };
        };
        model.add(part(wid, new THREE.Mesh(wingLoft(sx, 0, FLAP_IN - 0.01, 2, 0, 1), M.white)));
        model.add(part(wid, new THREE.Mesh(wingLoft(sx, FLAP_IN - 0.01, BREAK, 6, 0, FLAP_F), M.white)));
        model.add(part(wid, new THREE.Mesh(wingLoft(sx, BREAK, AIL_OUT, 8, 0, AIL_F), M.white)));
        model.add(part(wid, new THREE.Mesh(wingLoft(sx, AIL_OUT, 4.98, 2, 0, 1), M.white)));
        model.add(part(wid, new THREE.Mesh(wingLoft(sx, 4.98, WING_HALF, 4, 0, 1, tipEx), M.white)));

        // flap: single-slotted, hinge below the wing so it travels down and aft
        var fid = sx < 0 ? 'flapL' : 'flapR';
        var h0 = wingPoint(sx, FLAP_IN + 0.02, 0.70, -0.10), h1 = wingPoint(sx, BREAK - 0.02, 0.70, -0.10);
        var fp = hingeGroup(model, h0, h1);
        var fg = wingLoft(sx, FLAP_IN + 0.02, BREAK - 0.02, 6, FLAP_F - 0.035, 1);
        fg.translate(-h0.x, -h0.y, -h0.z);
        fp.add(part(fid, new THREE.Mesh(fg, M.surf)));
        surfaces[fid] = fp;

        // aileron: hinge on the chord line at AIL_F
        var aid = sx < 0 ? 'aileronL' : 'aileronR';
        var a0 = wingPoint(sx, BREAK + 0.02, AIL_F, 0.012), a1 = wingPoint(sx, AIL_OUT - 0.02, AIL_F, 0.012);
        var ap = hingeGroup(model, a0, a1);
        var ag = wingLoft(sx, BREAK + 0.02, AIL_OUT - 0.02, 8, AIL_F - 0.02, 1);
        ag.translate(-a0.x, -a0.y, -a0.z);
        ap.add(part(aid, new THREE.Mesh(ag, M.surf)));
        surfaces[aid] = ap;

        // strut (streamlined) from the forward door post to the wing
        var lo = new V3(sx * 0.565, -0.02, 0.60), hi = wingPoint(sx, 2.10, 0.12, -0.03);
        var strut = streamRod(lo, hi, 0.05, 0.017, M.white);
        model.add(part('struts', strut));
        var fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), M.white);
        fairing.scale.set(0.05, 0.03, 0.09); fairing.position.copy(hi).add(new V3(0, 0.015, 0));
        model.add(part('struts', fairing));
        var foot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), M.white);
        foot.scale.set(0.05, 0.05, 0.1); foot.position.copy(lo);
        model.add(part('struts', foot));

        // lights in the wingtip: nav (red left / green right) + strobe
        var navPos = wingPoint(sx, WING_HALF + 0.005, 0.06, 0, null, tipEx(WING_HALF));
        var nav = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), sx < 0 ? M.lensRed.clone() : M.lensGreen.clone());
        nav.position.copy(navPos);
        model.add(part(sx < 0 ? 'navLightL' : 'navLightR', nav));
        lights[sx < 0 ? 'navL' : 'navR'] = { mesh: nav, pos: navPos.clone() };
        var strobePos = navPos.clone().add(new V3(0, 0.0, 0.09));
        var strobe = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 10), M.lensWhite.clone());
        strobe.position.copy(strobePos); strobe.rotation.x = Math.PI / 2;
        model.add(part('strobes', strobe));
        lights[sx < 0 ? 'strobeL' : 'strobeR'] = { mesh: strobe, pos: strobePos.clone() };

        // fuel cap on top of each wing near the root
        var capPos = wingPoint(sx, 0.86, 0.33, foil2412(0.33).u);
        var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.02, 20), M.chrome);
        cap.position.copy(capPos);
        var tab = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.014), M.metal);
        tab.position.copy(capPos).add(new V3(0, 0.014, 0));
        var capG = new THREE.Group(); capG.add(cap); capG.add(tab);
        model.add(part(sx < 0 ? 'fuelCapL' : 'fuelCapR', capG));
      });

      // pitot tube under the LEFT wing (mast + tube pointing forward)
      var mountP = wingPoint(-1, 2.45, 0.22, foil2412(0.22).l);
      var pitot = new THREE.Group();
      var mast = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.13, 0.05), M.metal);
      mast.position.copy(mountP).add(new V3(0, -0.065, 0));
      var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.3, 12), M.chrome);
      tube.rotation.x = Math.PI / 2;
      tube.position.copy(mountP).add(new V3(0, -0.13, -0.12));
      pitot.add(mast); pitot.add(tube);
      model.add(part('pitotTube', pitot));
      geoRefs.pitotTip = mountP.clone().add(new V3(0, -0.13, -0.27));

      // stall-warning inlet: slot in the LEFT wing leading edge
      var slotP = wingPoint(-1, 2.62, 0.004, 0.0);
      var slot = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.02, 0.012), M.black);
      slot.position.copy(slotP).add(new V3(0, 0, -0.004));
      var slotRim = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.032, 0.008), M.metal);
      slotRim.position.copy(slotP).add(new V3(0, 0, 0.002));
      var swi = new THREE.Group(); swi.add(slotRim); swi.add(slot);
      model.add(part('stallWarningInlet', swi));
      geoRefs.stallInlet = slotP.clone();

      // fuel vent tube under the left wing near the strut attach
      var ventP = wingPoint(-1, 1.98, 0.2, foil2412(0.2).l);
      var vent = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8), M.metal);
      vent.position.copy(ventP).add(new V3(0, -0.06, -0.04));
      vent.rotation.x = -0.6;
      model.add(part('fuelVent', vent));
    })();
    function streamRod(a, b, chord, thick, mat) {
      var dir = b.clone().sub(a), L = dir.length();
      var g = new THREE.CylinderGeometry(1, 1, L, 14);
      g.scale(thick, 1, chord);
      var m = new THREE.Mesh(g, mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
      return m;
    }
    function rod(a, b, r1, r2, mat, seg) {
      var dir = b.clone().sub(a), L = dir.length();
      var m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, L, seg || 10), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
      return m;
    }

    /* ======================================================= TAIL SURFACES */
    var HT_Y = 0.655, HINGE_Z = 4.95, HT_HALF = 1.525, STAB_TIP = 1.30;
    function htLE(s) { return lerp(4.39, 4.59, s / HT_HALF); }
    function htTE(s) { return lerp(5.41, 5.23, s / HT_HALF); }
    function htPoint(sx, s, z, yc, chord) { return new V3(sx * s, HT_Y + yc * chord, z); }
    /** Horizontal-tail loft between absolute z limits zf(s)..za(s) of a NACA 0009 of chord LE..TE. */
    function htLoft(sx, s0, s1, nS, zfFn, zaFn, roundNose) {
      var loops = [], uvU = [];
      for (var i = 0; i <= nS; i++) {
        var s = s0 + (s1 - s0) * i / nS, le = htLE(s), te = htTE(s), c = te - le;
        var f0 = (zfFn(s) - le) / c, f1 = (zaFn(s) - le) / c;
        var lp = foilLoop(foil0009, Math.max(0, f0), Math.min(1, f1), 10, 5);
        if (!roundNose && f0 <= 0.001) lp = foilLoop(foil0009, 0, Math.min(1, f1), 10, 5);
        loops.push(lp.map(function (q) { return htPoint(sx, s, le + q[0] * c, q[1], c); }));
        uvU.push(s / 0.6);
      }
      return loft(loops, { uvU: uvU });
    }
    var TAB_IN = 0.14, TAB_OUT = 1.20, TAB_C = 0.09;
    (function buildHTail() {
      var stab = new THREE.Group();
      [-1, 1].forEach(function (sx) {
        stab.add(new THREE.Mesh(htLoft(sx, 0, STAB_TIP, 6, function (s) { return htLE(s); }, function () { return HINGE_Z - 0.01; }), M.white));
      });
      model.add(part('stabilizer', stab));
      // elevator (both halves move together) with horn balances at the tips
      var e0 = new V3(-1, HT_Y, HINGE_Z), e1 = new V3(1, HT_Y, HINGE_Z);
      var ep = hingeGroup(model, e0, e1);
      ep.position.set(0, HT_Y, HINGE_Z);
      var elevParts = new THREE.Group();
      function addE(g) { g.translate(0, -HT_Y, -HINGE_Z); elevParts.add(new THREE.Mesh(g, M.surf)); }
      function hingeF() { return HINGE_Z - 0.015; }
      function teF(s) { return htTE(s); }
      function tabCut(s) { return htTE(s) - TAB_C; }
      // left half
      addE(htLoft(-1, 0.07, STAB_TIP, 7, hingeF, teF, true));
      // right half: cut out the trim tab span
      addE(htLoft(1, 0.07, TAB_IN, 1, hingeF, teF, true));
      addE(htLoft(1, TAB_IN, TAB_OUT, 6, hingeF, tabCut, true));
      addE(htLoft(1, TAB_OUT, STAB_TIP, 1, hingeF, teF, true));
      // horn balances (full chord) at both tips
      [-1, 1].forEach(function (sx) { addE(htLoft(sx, STAB_TIP + 0.005, HT_HALF, 3, function (s) { return htLE(s) + 0.03; }, teF, false)); });
      // torque tube between halves (inside the tail cone)
      var tt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), M.metal);
      tt.rotation.z = Math.PI / 2; tt.position.set(0, 0, 0.02);
      elevParts.add(tt);
      ep.add(part('elevator', elevParts));
      surfaces.elevator = ep;
      // trim tab on the RIGHT elevator trailing edge (child of the elevator)
      var tz = htTE((TAB_IN + TAB_OUT) / 2) - TAB_C;
      var tp = new THREE.Group();
      tp.position.set(0, 0, tz - HINGE_Z);
      ep.add(tp);
      var loops = [], uvU = [];
      for (var i = 0; i <= 4; i++) {
        var s = TAB_IN + 0.01 + (TAB_OUT - TAB_IN - 0.02) * i / 4, le = htLE(s), te = htTE(s), c = te - le;
        var f0 = (te - TAB_C - le) / c;
        var lp = foilLoop(foil0009, f0, 1, 6, 4);
        loops.push(lp.map(function (q) { return new V3(s, q[1] * c, le + q[0] * c - tz); }));
        uvU.push(s / 0.6);
      }
      tp.add(part('trimTab', new THREE.Mesh(loft(loops, { uvU: uvU }), M.surf)));
      tp.userData.axis = new V3(1, 0, 0);
      surfaces.trimTab = tp;
      geoRefs.trimTab = new V3(0.7, HT_Y, htTE(0.7));
    })();

    // vertical fin and rudder
    var FIN_ROOT = 0.80, FIN_TIP = 1.98, RUD_BOT = 0.60, RUD_TOP = 2.05;
    function finLE(y) { return 4.55 + (y - 0.82) * 0.733; }
    function rudHinge(y) { return 5.50 + (y - 0.62) * 0.293; }
    function rudTE(y) { return 6.00 + (y - 0.58) * 0.17; }
    function verticalLoft(y0, y1, nY, zfFn, zaFn, fullFoil, extra) {
      var loops = [];
      for (var i = 0; i <= nY; i++) {
        var y = y0 + (y1 - y0) * i / nY, zf = zfFn(y), za = zaFn(y);
        var ex = extra ? extra(y) : null;
        var lp = fullFoil ? foilLoop(foil0009, 0, 1, 10, 5) : foilLoop(foil0009, 0.62, 1, 10, 5);
        var cl = fullFoil ? (za - zf) : (za - zf) / 0.38;
        var leZ = fullFoil ? zf : za - cl;
        loops.push(lp.map(function (q) {
          var t = (ex ? ex.t : 1);
          return new V3(q[1] * cl * 1.15 * t, y + (ex ? ex.dy : 0), leZ + q[0] * cl);
        }));
      }
      return loft(loops);
    }
    (function buildFin() {
      var finG = verticalLoft(FIN_ROOT, FIN_TIP - 0.04, 7, finLE, function (y) { return rudHinge(y) - 0.012; }, true);
      var fin = new THREE.Mesh(finUV(finG), M.fin);
      var tipG = verticalLoft(FIN_TIP - 0.04, FIN_TIP + 0.02, 3, finLE, function (y) { return rudHinge(y) - 0.012; }, true,
        function (y) { var t = (y - FIN_TIP + 0.04) / 0.06; return { t: 1 - 0.75 * t * t, dy: 0 }; });
      var finTip = new THREE.Mesh(finUV(tipG), M.fin);
      var finGroup = new THREE.Group(); finGroup.add(fin); finGroup.add(finTip);
      // dorsal fin fillet
      var dShape = new THREE.Shape([new THREE.Vector2(3.85, 0.80), new THREE.Vector2(finLE(1.05) + 0.05, 1.05), new THREE.Vector2(4.75, 0.80)]);
      var dg = new THREE.ExtrudeGeometry(dShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
      dg.translate(0, 0, -0.025);
      dg.rotateY(-Math.PI / 2);
      finGroup.add(new THREE.Mesh(finUV(dg), M.fin));
      model.add(part('fin', finGroup));
      // rudder on a swept hinge line
      var r0 = new V3(0, RUD_BOT, rudHinge(RUD_BOT)), r1 = new V3(0, RUD_TOP, rudHinge(RUD_TOP));
      var rp = new THREE.Group();
      rp.position.copy(r0);
      rp.userData.axis = r1.clone().sub(r0).normalize();
      model.add(rp);
      var rg = verticalLoft(RUD_BOT, RUD_TOP, 9, rudHinge, rudTE, false, function (y) {
        var tb = clamp((y - RUD_BOT) / 0.08, 0, 1), tt = clamp((RUD_TOP - y) / 0.06, 0, 1);
        return { t: 0.35 + 0.65 * Math.sqrt(Math.min(tb, tt)), dy: 0 };
      });
      finUV(rg);
      rg.translate(-r0.x, -r0.y, -r0.z);
      var rudder = new THREE.Mesh(rg, M.fin);
      var rgroup = new THREE.Group(); rgroup.add(rudder);
      // ground-adjustable tab at the base
      var tab = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.08, 0.07), M.white);
      tab.position.set(0, 0.71 - RUD_BOT, rudTE(0.71) + 0.02 - r0.z);
      rgroup.add(tab);
      // white tail nav light at the top of the rudder trailing edge
      var tlPos = new V3(0, RUD_TOP - 0.06, rudTE(RUD_TOP - 0.06) + 0.01);
      var tl = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), M.lensWhite.clone());
      tl.position.copy(tlPos).sub(r0);
      rgroup.add(part('navLightTail', tl));
      lights.tail = { mesh: tl, pos: tlPos };
      rp.add(part('rudder', rudder));
      rp.add(rgroup);
      surfaces.rudder = rp;
      // red beacon on top of the fin, at the front of the tip
      var bPos = new V3(0, FIN_TIP + 0.05, finLE(FIN_TIP) + 0.12);
      var bBase = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 16), M.metal);
      bBase.position.copy(bPos).add(new V3(0, -0.015, 0));
      var bDome = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.lensRed.clone());
      bDome.position.copy(bPos);
      var bg = new THREE.Group(); bg.add(bBase); bg.add(bDome);
      model.add(part('beacon', bg));
      lights.beacon = { mesh: bDome, pos: bPos.clone().add(new V3(0, 0.02, 0)) };
      geoRefs.rudder = new V3(0, 1.3, rudTE(1.3) - 0.15);
    })();

    // static port: lower left side of the forward fuselage
    (function () {
      var z = 0.42, y = 0.33, p = pOfY(z, y, -1), P = fusPoint(z, p, new V3()), N = fusNormal(z, p, new V3());
      var g = new THREE.Group();
      var ring = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20), M.chrome);
      var hole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.008, 10), M.black);
      [ring, hole].forEach(function (m) { m.position.copy(P).addScaledVector(N, 0.003); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), N); g.add(m); });
      model.add(part('staticPort', g));
      geoRefs.staticPort = P.clone().addScaledVector(N, 0.01);
      geoRefs.staticNormal = N.clone();
    })();
    // antennas: VHF whip on the tail cone top, small blade under the belly
    (function () {
      var p = new V3(0, 0.86, 2.85);
      var whip = rod(p, new V3(0, 1.38, 3.25), 0.008, 0.003, M.dark, 6);
      model.add(whip);
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.02, 10), M.dark);
      base.position.copy(p); model.add(base);
      var blade = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.08), M.dark);
      blade.position.set(0, 0.03, 3.2); blade.rotation.x = 0.4;
      model.add(blade);
    })();

    /* ======================================================= LANDING GEAR */
    var wheels = { main: [], nose: null };
    function tyreGeometry(radius, width, rim) {
      var pts = [], n = 10, i;
      for (i = 0; i <= n; i++) {
        var a = -Math.PI / 2 + Math.PI * i / n;
        pts.push(new THREE.Vector2(radius - width * 0.32 + Math.cos(a) * width * 0.32, Math.sin(a) * width / 2));
      }
      pts.unshift(new THREE.Vector2(rim, -width * 0.42));
      pts.push(new THREE.Vector2(rim, width * 0.42));
      var g = new THREE.LatheGeometry(pts, 28);
      g.rotateZ(Math.PI / 2);
      return g;
    }
    (function buildMainGear() {
      [-1, 1].forEach(function (sx) {
        var axle = new V3(sx * 1.159, -0.43, 1.196);
        var top = new V3(sx * 0.42, -0.06, 1.30);
        var leg = rod(top, axle.clone().add(new V3(-sx * 0.09, 0.05, 0)), 0.034, 0.024, M.white, 12);
        model.add(part('mainWheels', leg));
        var step = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.09), M.dark);
        step.position.copy(top).lerp(axle, 0.38).add(new V3(sx * 0.02, 0.0, -0.08));
        model.add(step);
        var wg = new THREE.Group();
        wg.position.copy(axle);
        model.add(wg);
        var spin = new THREE.Group();
        wg.add(spin);
        var tyre = new THREE.Mesh(tyreGeometry(0.2225, 0.16, 0.11), M.tyre);
        spin.add(part('mainWheels', tyre));
        var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.13, 20), M.metal);
        hub.rotation.z = Math.PI / 2;
        spin.add(part('mainWheels', hub));
        for (var k = 0; k < 5; k++) {   // lug nuts make rotation visible
          var nut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6), M.dark);
          var a = k / 5 * Math.PI * 2;
          nut.rotation.z = Math.PI / 2;
          nut.position.set(sx * 0.07, Math.cos(a) * 0.05, Math.sin(a) * 0.05);
          spin.add(nut);
        }
        // disc brake on the inboard side
        var disc = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.012, 24), M.chrome);
        disc.rotation.z = Math.PI / 2;
        disc.position.set(-sx * 0.085, 0, 0);
        spin.add(part('brakes', disc));
        var caliper = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.06), M.red);
        caliper.position.set(-sx * 0.09, 0.0, 0.085);
        wg.add(part('brakes', caliper));
        wheels.main.push({ spin: spin, caliper: caliper, side: sx });
      });
    })();
    (function buildNoseGear() {
      var top = new V3(0, -0.05, -0.30);
      var axleY = -0.52, axleZ = -0.274, R = 0.18;
      var upper = rod(top, new V3(0, -0.29, -0.29), 0.042, 0.042, M.white, 14);
      model.add(part('noseWheel', upper));
      var steer = new THREE.Group();
      steer.position.set(0, 0, -0.29);
      model.add(steer);
      var piston = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 14), M.chrome);
      piston.position.set(0, -0.35, 0);
      steer.add(part('noseWheel', piston));
      var crown = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.07), M.white);
      crown.position.set(0, -0.415, 0.015);
      steer.add(part('noseWheel', crown));
      [-1, 1].forEach(function (s) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.13, 0.05), M.white);
        leg.position.set(s * 0.085, -0.47, 0.016);
        steer.add(part('noseWheel', leg));
      });
      // torque links (scissors) in front of the strut
      var l1 = rod(new V3(0, -0.30, -0.035), new V3(0, -0.36, -0.075), 0.01, 0.01, M.metal, 6);
      var l2 = rod(new V3(0, -0.36, -0.075), new V3(0, -0.41, -0.03), 0.01, 0.01, M.metal, 6);
      steer.add(l1); steer.add(l2);
      var spin = new THREE.Group();
      spin.position.set(0, axleY, axleZ + 0.29);
      steer.add(spin);
      spin.add(part('noseWheel', new THREE.Mesh(tyreGeometry(R, 0.13, 0.08), M.tyre)));
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.11, 18), M.metal);
      hub.rotation.z = Math.PI / 2;
      spin.add(part('noseWheel', hub));
      for (var k = 0; k < 4; k++) {
        var nut = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 6), M.dark);
        var a = k / 4 * Math.PI * 2;
        nut.rotation.z = Math.PI / 2; nut.position.set(0, Math.cos(a) * 0.04, Math.sin(a) * 0.04);
        spin.add(nut);
      }
      wheels.nose = { steer: steer, spin: spin };
    })();

    /* =================================================== SPINNER + PROPELLER */
    var prop = { group: new THREE.Group(), blades: null, disc: null, angle: 0 };
    (function buildProp() {
      var hub = new V3(0, 0.49, -0.905);
      prop.group.position.copy(hub);
      model.add(prop.group);
      var prof = [];
      for (var i = 0; i <= 14; i++) {
        var h = i / 14;
        prof.push(new THREE.Vector2(Math.max(0.0005, 0.172 * Math.pow(1 - h, 0.55) * (1 - 0.15 * h)), h * 0.165));
      }
      var sg = new THREE.LatheGeometry(prof, 32);
      sg.rotateX(-Math.PI / 2);
      sg.translate(0, 0, 0.03);
      var spinner = new THREE.Mesh(sg, paintMat(0xf0efeb, 0.3, { clearcoat: 0.8, clearcoatRoughness: 0.08 }));
      prop.group.add(part('spinner', spinner));
      var backplate = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.03, 32), M.white);
      backplate.rotation.x = Math.PI / 2; backplate.position.z = 0.045;
      prop.group.add(part('spinner', backplate));
      // two blades: twisted, tapered; dark aft face, aluminium front face, white tips
      var bladeG = (function () {
        var loops = [], cols = [], nR = 14, R0 = 0.11, R1 = 0.876, P = 1.22;
        var colArr = [];
        for (var i2 = 0; i2 <= nR; i2++) {
          var r = R0 + (R1 - R0) * i2 / nR;
          var t = (r - R0) / (R1 - R0);
          var chord = 0.12 * (1 - 0.3 * t) * (t > 0.92 ? Math.sqrt(Math.max(0.05, (1 - t) / 0.08)) : 1) + 0.01;
          var beta = Math.atan(P / (2 * Math.PI * Math.max(r, 0.15)));
          var lp = foilLoop(foilBlade, 0, 1, 8, 4);
          var loop = lp.map(function (q) {
            var u = (0.5 - q[0]) * chord;           // + toward the leading edge
            var th = q[1] * chord * (1.4 - 0.6 * t);  // thickness (aft face +)
            return new V3(u * Math.cos(beta) + th * Math.sin(beta), r, -u * Math.sin(beta) + th * Math.cos(beta));
          });
          loops.push(loop);
          colArr.push(lp.map(function (q) { return { aft: q[1] < 0.004, tip: t > 0.9 }; }));
        }
        var g = loft(loops, { caps: [false, true] });
        var cnt = g.attributes.position.count, c = new Float32Array(cnt * 3), L = loops[0].length;
        for (var v = 0; v < cnt; v++) {
          var li = Math.floor(v / (L + 1)), lj = v % (L + 1);
          var info = li < loops.length ? colArr[li][lj % L] : { aft: false, tip: true };
          var col = info.tip ? [0.95, 0.95, 0.93] : (info.aft ? [0.1, 0.1, 0.11] : [0.72, 0.74, 0.76]);
          c[v * 3] = Math.pow(col[0], 2.2); c[v * 3 + 1] = Math.pow(col[1], 2.2); c[v * 3 + 2] = Math.pow(col[2], 2.2);   // linear
        }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        return g;
      })();
      var bladesGroup = new THREE.Group();
      [0, Math.PI].forEach(function (a) {
        var b = new THREE.Mesh(bladeG, M.blade);
        b.rotation.z = a;
        bladesGroup.add(b);
      });
      prop.group.add(part('propeller', bladesGroup));
      prop.blades = bladesGroup;
      // blur disc
      var dc = makeCanvas(256, 256), g2 = dc.getContext('2d');
      var gr = g2.createRadialGradient(128, 128, 20, 128, 128, 128);
      gr.addColorStop(0, 'rgba(60,62,66,0.0)'); gr.addColorStop(0.2, 'rgba(60,62,66,0.35)');
      gr.addColorStop(0.86, 'rgba(70,72,76,0.28)'); gr.addColorStop(0.9, 'rgba(240,240,236,0.55)');
      gr.addColorStop(0.97, 'rgba(240,240,236,0.4)'); gr.addColorStop(1, 'rgba(240,240,236,0)');
      g2.fillStyle = gr; g2.fillRect(0, 0, 256, 256);
      var disc = new THREE.Mesh(new THREE.CircleGeometry(0.88, 48),
        new THREE.MeshBasicMaterial({ map: ctex(dc), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      disc.position.z = 0.005;
      prop.group.add(disc);
      prop.disc = disc;
    })();

    /* ========================================================== LIGHT GLOWS */
    var glowTex = (function () {
      var c = makeCanvas(128, 128), g = c.getContext('2d');
      var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return ctex(c);
    })();
    function glow(color, size, pos) {
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false }));
      s.scale.set(size, size, 1);
      s.position.copy(pos);
      s.renderOrder = 5;
      model.add(s);
      return s;
    }
    var glows = {
      navL: glow(0xff3020, 0.55, lights.navL.pos), navR: glow(0x30ff60, 0.55, lights.navR.pos),
      tail: glow(0xffffff, 0.45, lights.tail.pos),
      beacon: glow(0xff2a10, 0.8, lights.beacon.pos),
      strobeL: glow(0xffffff, 1.4, lights.strobeL.pos), strobeR: glow(0xffffff, 1.4, lights.strobeR.pos),
      landing: glow(0xfff6dd, 0.9, new V3(-0.16, 0.29, Z_NOSE - 0.04))
    };
    // tail light rides on the rudder: re-parent its glow
    surfaces.rudder.add(glows.tail);
    glows.tail.position.copy(lights.tail.pos).sub(surfaces.rudder.position);
    var beam = (function () {
      var g = new THREE.ConeGeometry(1.6, 9, 24, 1, true);
      g.translate(0, -4.5, 0);
      g.rotateX(-Math.PI / 2);
      var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(-0.16, 0.29, Z_NOSE - 0.02);
      m.rotation.x = -0.06;
      m.renderOrder = 4;
      model.add(m);
      return m;
    })();

    /* =============================================================== LABELS */
    var labelPx = 15;           // CSS px height of a label
    var viewH = 300;            // CSS px height of the viewport (setSize)
    var allLabels = [];
    function roundRect(g, x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
      g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
    }
    /** Screen-sized text label (sprite). style: 'dark' (default), 'accent', 'light'. scaleK multiplies size. */
    function makeLabel(text, style, scaleK) {
      var c = makeCanvas(16, 16);
      var mat = new THREE.SpriteMaterial({ map: ctex(c), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
      var sp = new THREE.Sprite(mat);
      sp.renderOrder = 30;
      sp.userData = { text: null, style: style || 'dark', k: scaleK || 1, canvas: c, aspect: 1 };
      setLabelText(sp, text);
      allLabels.push(sp);
      return sp;
    }
    function setLabelText(sp, text) {
      if (sp.userData.text === text) return;
      sp.userData.text = text;
      var c = sp.userData.canvas, g = c.getContext('2d'), fs = 44;
      g.font = '600 ' + fs + 'px ' + FONT_DISPLAY;
      var lines = String(text).split('\n'), w = 0;
      lines.forEach(function (l) { w = Math.max(w, g.measureText(l).width); });
      // modern pill: rounded, translucent dark (or accent / light), hairline border, soft drop shadow, white text
      // with a dark halo; 'dark' labels carry a small accent dot. M = transparent margin for the drop shadow.
      var st = sp.userData.style, pad = 16, lh = fs * 1.12, M = 10, dot = st === 'dark' ? 24 : 0;
      var ph = Math.ceil(lh * lines.length + pad * 1.2);
      c.width = Math.ceil(w + pad * 2 + 8 + dot + 2 * M); c.height = ph + 2 * M;
      g = c.getContext('2d');
      var pw = c.width - 2 * M, rr = Math.min(ph / 2, 30);
      g.save();
      g.shadowColor = 'rgba(6,12,18,0.34)'; g.shadowBlur = 10; g.shadowOffsetY = 3;
      g.fillStyle = st === 'accent' ? 'rgba(236,130,52,0.96)' : (st === 'light' ? 'rgba(250,251,252,0.95)' : 'rgba(15,24,33,0.82)');
      roundRect(g, M, M, pw, ph, rr); g.fill();
      g.restore();
      g.strokeStyle = st === 'light' ? 'rgba(19,32,43,0.14)' : 'rgba(255,255,255,0.24)'; g.lineWidth = 2;
      roundRect(g, M + 1, M + 1, pw - 2, ph - 2, rr - 1); g.stroke();
      if (dot) {
        g.fillStyle = '#F08A3C';
        g.beginPath(); g.arc(M + pad + 8, M + pad * 0.6 + lh * 0.5, 7, 0, Math.PI * 2); g.fill();
      }
      g.font = '600 ' + fs + 'px ' + FONT_DISPLAY;
      g.textBaseline = 'middle';
      if (st !== 'light') { g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 6; }
      g.fillStyle = st === 'light' ? '#13202B' : '#FFFFFF';
      lines.forEach(function (l, i) { g.fillText(l, M + pad + 4 + dot, M + pad * 0.6 + lh * (i + 0.5)); });
      sp.material.map.dispose();
      sp.material.map = ctex(sp.userData.canvas);
      sp.material.map.anisotropy = 4;
      sp.material.needsUpdate = true;
      sp.userData.aspect = c.width / c.height;
      sp.userData.lines = lines.length;
      sp.userData.marginK = c.height / ph;
      scaleLabel(sp);
    }
    function scaleLabel(sp) {
      var h = (labelPx * sp.userData.k * (0.7 + 0.42 * sp.userData.lines)) * (sp.userData.marginK || 1) / viewH * 2 * Math.tan(camera.fov * DEG / 2);
      sp.scale.set(h * sp.userData.aspect, h, 1);
    }
    function leaderLine(a, b, color) {
      var g = new THREE.BufferGeometry().setFromPoints([a, b]);
      var l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color || 0x13202b, transparent: true, opacity: 0.75, depthTest: false }));
      l.renderOrder = 29;
      return l;
    }

    // part labels (model coordinates): anchor + label offset
    var LABEL_DEFS = [
      ['aileronL', 'Alerón', [-3.6, 1.16, 1.5], [-0.4, 0.9, 0.5]],
      ['aileronR', 'Alerón', [3.6, 1.20, 1.5], [0.4, 0.9, 0.5]],
      ['flapL', 'Flap', [-1.5, 1.08, 1.95], [-0.3, 0.75, 0.9]],
      ['elevator', 'Timón de profundidad', [-0.8, HT_Y, 5.2], [-0.9, 0.55, 0.7]],
      ['trimTab', 'Compensador', [0.8, HT_Y, 5.28], [0.9, -0.15, 0.8]],
      ['stabilizer', 'Estabilizador', [1.0, HT_Y + 0.03, 4.75], [1.0, 0.55, 0.0]],
      ['rudder', 'Timón de dirección', [0, 1.45, 5.95], [0.05, 0.55, 0.9]],
      ['fin', 'Deriva', [0, 1.35, 5.1], [-0.2, 0.9, -0.3]],
      ['propeller', 'Hélice', [0.45, 0.85, -0.92], [0.55, 0.45, -0.3]],
      ['pitotTube', 'Tubo pitot', [-2.45, 0.93, 0.35], [-0.35, -0.55, -0.5]],
      ['staticPort', 'Toma estática', [-0.5, 0.33, 0.42], [-0.65, -0.55, -0.2]],
      ['stallWarningInlet', 'Entrada del aviso de pérdida', [-2.62, 1.09, 0.53], [-0.6, 0.55, -0.6]],
      ['fuelCapL', 'Tapa de combustible', [-0.86, 1.25, 1.08], [-0.5, 0.65, -0.1]],
      ['struts', 'Montante', [-1.4, 0.55, 0.65], [-0.6, -0.35, -0.5]],
      ['noseWheel', 'Rueda de nariz', [0, -0.6, -0.27], [0.5, -0.35, -0.5]],
      ['mainWheels', 'Tren principal', [1.16, -0.43, 1.2], [0.6, -0.3, 0.3]],
      ['cowling', 'Capó (motor)', [0.3, 0.7, -0.5], [0.55, 0.5, -0.2]],
      ['doorL', 'Puerta', [-0.57, 0.45, 1.0], [-0.6, -0.15, 0.4]]
    ];
    var labelGroup = new THREE.Group();
    labelGroup.visible = false;
    model.add(labelGroup);
    var partLabels = {};
    LABEL_DEFS.forEach(function (d) {
      var a = new V3().fromArray(d[2]), b = a.clone().add(new V3().fromArray(d[3]));
      var sp = makeLabel(d[1]);
      sp.position.copy(b);
      sp.center.set(d[3][0] < 0 ? 1 : (d[3][0] > 0 ? 0 : 0.5), 0.5);
      var line = leaderLine(a, b);
      sp.userData.leader = line;
      var g = new THREE.Group(); g.add(line); g.add(sp);
      labelGroup.add(g);
      partLabels[d[0]] = g;
    });

    /* ----------------------------------------------------- highlight halos */
    var haloTex = (function () {
      var c = makeCanvas(128, 128), g = c.getContext('2d');
      g.strokeStyle = 'rgba(240,138,60,1)'; g.lineWidth = 9;
      g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(240,138,60,0.35)'; g.lineWidth = 18;
      g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
      return ctex(c);
    })();
    var SMALL_PARTS = { pitotTube: 1, staticPort: 1, stallWarningInlet: 1, fuelCapL: 1, fuelCapR: 1, fuelVent: 1, navLightL: 1,
      navLightR: 1, navLightTail: 1, beacon: 1, landingLight: 1, strobes: 1, carbAirInlet: 1, exhaust: 1, oilDoor: 1, trimTab: 1, brakes: 1, windowL: 1 };
    var halos = [];
    var highlightSet = {};
    var userHighlight = [];

    /* ========================================================== ARROWS */
    var arrowMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    /** Curved arrow along f(angle) from a0 to a1, head at a1. */
    /**
     * Dark translucent outline (inverted hull, vertices pushed along the normal) so the accent arrows stay readable
     * over the white paint and the light floor. Added as a child of each mesh (follows its transform).
     */
    function outlineMat(width) {
      var om = new THREE.MeshBasicMaterial({ color: 0x0b131b, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false,
        side: THREE.BackSide });
      om.onBeforeCompile = function (sh) {
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * ' + width.toFixed(4) + ';');
      };
      om.customProgramCacheKey = function () { return 'c150-outline-' + width.toFixed(4); };
      return om;
    }
    function addOutline(meshes, om) {
      meshes.forEach(function (mesh) {
        var o = new THREE.Mesh(mesh.geometry, om);
        o.renderOrder = mesh.renderOrder - 0.5;
        o.userData.outline = true;
        mesh.add(o);
      });
      return om;
    }
    function arcArrow(f, a0, a1, tube, mat) {
      var curve = new THREE.Curve();
      curve.getPoint = function (t, out) { return f(a0 + (a1 - a0) * t, out || new V3()); };
      var g = new THREE.Group();
      var m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, tube, 8, false), mat);
      m.renderOrder = 25;
      g.add(m);
      var end = f(a1, new V3()), prev = f(a1 - (a1 - a0) * 0.02, new V3());
      var dir = end.clone().sub(prev).normalize();
      var head = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.2, tube * 9, 14), mat);
      head.position.copy(end).addScaledVector(dir, tube * 3);
      head.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
      head.renderOrder = 25;
      g.add(head);
      g.userData.outlineMat = addOutline([m, head], outlineMat(tube * 0.4));
      return g;
    }
    var arrows = {
      roll: arcArrow(function (a, o) { return o.set(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 5.3); }, 40 * DEG, 140 * DEG, 0.045, arrowMat.clone()),
      pitch: arcArrow(function (a, o) { return o.set(-5.8, Math.sin(a) * 1.25, Math.cos(a) * 1.25); }, 235 * DEG, 125 * DEG, 0.04, arrowMat.clone()),
      yaw: arcArrow(function (a, o) { return o.set(Math.sin(a) * 2.7, 0.35, -Math.cos(a) * 2.7); }, -40 * DEG, 40 * DEG, 0.045, arrowMat.clone())
    };
    Object.keys(arrows).forEach(function (k) { arrows[k].visible = false; overlays.add(arrows[k]); });
    function setArrow(name, v) {   // v: signed magnitude (roll + = right, pitch + = nose up, yaw + = right)
      var a = arrows[name], mag = Math.abs(v);
      a.visible = mag > 0.1;
      if (!a.visible) return;
      var op = clamp(0.35 + mag * 0.65, 0, 1);
      a.children.forEach(function (m) { m.material.opacity = op; });
      if (a.userData.outlineMat) a.userData.outlineMat.opacity = 0.4 * op;
      if (name === 'roll') a.scale.x = v > 0 ? -1 : 1;    // base arrow = roll LEFT (counter-clockwise from behind)
      if (name === 'pitch') a.scale.y = v > 0 ? 1 : -1;   // base arrow = nose UP
      if (name === 'yaw') a.scale.x = v > 0 ? 1 : -1;     // base arrow = yaw RIGHT
    }

    /* ======================================================== ANIM OVERLAYS */
    var ov = {};   // lazily built overlay objects per animation
    function dashedLine(a, b, color, dash) {
      var g = new THREE.BufferGeometry().setFromPoints([a, b]);
      var l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: color || ACCENT, dashSize: dash || 0.25, gapSize: (dash || 0.25) * 0.7,
        transparent: true, opacity: 0.95, depthTest: false }));
      l.computeLineDistances();
      l.renderOrder = 24;
      return l;
    }
    function straightArrow(len, color, radius) {
      var g = new THREE.Group();
      var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false });
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 12), mat);
      var head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, radius * 6, 16), mat);
      shaft.renderOrder = head.renderOrder = 26;
      g.add(shaft); g.add(head);
      g.userData = { shaft: shaft, head: head, mat: mat, radius: radius, outlineMat: addOutline([shaft, head], outlineMat(radius * 0.3)) };
      shaft.children[0].geometry = new THREE.CylinderGeometry(radius, radius, 1, 12, 1, true);   // no caps: the shaft is scaled in y
      setArrowLength(g, len);
      return g;
    }
    function setArrowLength(g, len) {   // arrow along local +Y
      var r = g.userData.radius, hl = r * 6, sl = Math.max(0.001, len - hl);
      g.userData.shaft.scale.y = sl; g.userData.shaft.position.y = sl / 2;
      g.userData.head.position.y = sl + hl / 2;
    }
    function axisOverlay(a, b, text, labelPos) {
      var g = new THREE.Group();
      g.add(dashedLine(a, b, ACCENT, 0.22));
      var lab = makeLabel(text, 'accent', 1.1);
      lab.position.copy(labelPos);
      g.add(lab);
      g.visible = false;
      overlays.add(g);
      return g;
    }
    function getOverlay(name) {
      if (ov[name]) return ov[name];
      var o = null;
      if (name === 'axisLong') o = axisOverlay(new V3(0, 0, -4.2), new V3(0, 0, 6.6), 'Eje longitudinal — ALABEO', new V3(0, -0.55, 6.2));
      else if (name === 'axisLat') o = axisOverlay(new V3(-6.6, 0, 0), new V3(6.6, 0, 0), 'Eje transversal — CABECEO', new V3(-4.6, -0.75, 0));
      else if (name === 'axisVert') o = axisOverlay(new V3(0, -2.4, 0), new V3(0, 3.2, 0), 'Eje vertical — GUIÑADA', new V3(1.2, 1.6, 0.6));
      else if (name === 'forces') o = buildForces();
      else if (name === 'aoa') o = buildAoa();
      else if (name === 'refLine') {
        o = new THREE.Group();
        o.add(dashedLine(new V3(0, 0.25, -1.5), new V3(0, 0.25, -12), 0x2f6fa8, 0.3));
        var lab = makeLabel('Rumbo inicial', 'light', 0.9); lab.position.set(0, 0.6, -8.5); o.add(lab);
        windOverlays.add(o);
      } else if (name === 'flapLabel') {
        o = makeLabel('Flaps 0°', 'accent', 1.2); o.position.set(-2.6, 1.9, 1.9); overlays.add(o);
      } else if (name === 'rpmLabel') {
        o = makeLabel('RPM 0', 'accent', 1.2); o.position.set(1.2, 1.3, -2.2); overlays.add(o);
      } else if (name === 'trimLabel') {
        o = new THREE.Group();
        var l1 = makeLabel('Compensador (trim tab)', 'accent', 1.0); l1.position.set(1.15, -0.65, 4.55); o.add(l1);
        o.add(leaderLine(new V3(0.75, HT_Y - CG.y, htTE(0.75) - 0.04 - CG.z), new V3(1.05, -0.58, 4.5), ACCENT));
        overlays.add(o);
      } else if (name === 'lightLabel') {
        o = makeLabel('Luces', 'accent', 1.1); o.position.set(0, 2.2, 0); overlays.add(o);
      } else if (name === 'carb') o = buildCarb();
      else if (name === 'pitot') o = buildPitotFlow();
      else if (name === 'brakeLabel') {
        o = makeLabel('Freno', 'accent', 1.0); o.position.set(0, -0.4, 0.4); overlays.add(o);
      } else if (name === 'checkLabel') {
        o = makeLabel('Libres y correctos', 'accent', 1.1); o.position.set(0, 2.6, 2.0); overlays.add(o);
      }
      if (o) { o.visible = false; ov[name] = o; }
      return o;
    }

    // four forces
    function buildForces() {
      var g = new THREE.Group();
      var defs = [
        ['lift', 0x2F6FA8, new V3(0, 0.62, 0.15), new V3(0, 1, 0), 2.3, 'Sustentación'],
        ['weight', 0x55606a, new V3(0, -0.1, 0), new V3(0, -1, 0), 2.3, 'Peso'],
        ['thrust', ACCENT, new V3(0, -0.06, -2.1), new V3(0, 0, -1), 1.7, 'Empuje'],
        ['drag', 0xB5476B, new V3(0, 0.15, 4.9), new V3(0, 0, 1), 1.7, 'Resistencia']
      ];
      g.userData.items = {};
      defs.forEach(function (d) {
        var a = straightArrow(d[4], d[1], 0.07);
        a.position.copy(d[2]);
        a.quaternion.setFromUnitVectors(new V3(0, 1, 0), d[3]);
        g.add(a);
        var lab = makeLabel(d[5], 'dark', 1.15);
        lab.position.copy(d[2]).addScaledVector(d[3], d[4] + 0.35);
        g.add(lab);
        g.userData.items[d[0]] = { arrow: a, label: lab, len: d[4] };
      });
      overlays.add(g);
      return g;
    }

    // angle of attack: airfoil section at the left tip, chord line, relative wind, streamlines (wind frame)
    function buildAoa() {
      var g = new THREE.Group();
      var tipS = 4.2, pl = wingPlan(tipS), chord = pl.c;
      var X = -5.45;
      var outline = foilLoop(foil2412, 0, 1, 30, 8);
      var shape = new THREE.Shape(outline.map(function (q) { return new THREE.Vector2(q[0] * chord, q[1] * chord); }));
      var foilMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0xdfe3e6, side: THREE.DoubleSide, transparent: true, opacity: 0.96, depthTest: false }));
      foilMesh.renderOrder = 22;
      var foilEdge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outline.map(function (q) { return new V3(q[0] * chord, q[1] * chord, 0); })),
        new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false }));
      foilEdge.renderOrder = 23;
      var chordLine = dashedLine(new V3(-0.9, 0, 0), new V3(chord + 0.3, 0, 0), 0x13202b, 0.08);
      var foilG = new THREE.Group();
      foilG.add(foilMesh); foilG.add(foilEdge); foilG.add(chordLine);
      var cLab = makeLabel('Cuerda', 'light', 0.85); cLab.position.set(-0.95, 0.12, 0); foilG.add(cLab);
      // section plane: local x = chord (aft = +z), local y = up; facing -x (toward the side camera)
      foilG.rotation.y = -Math.PI / 2;
      var le = wingPoint(-1, tipS, 0, 0);
      foilG.position.set(X - CG.x, le.y - CG.y, le.z - CG.z);
      g.add(foilG);
      g.userData.foil = { group: foilG, chord: chord, outline: outline, X: X };
      overlays.add(g);
      // wind-frame parts
      var w = new THREE.Group();
      windOverlays.add(w);
      var windArrows = [];
      for (var i = 0; i < 3; i++) {
        var a = straightArrow(1.0, 0x2F6FA8, 0.025);
        a.quaternion.setFromUnitVectors(new V3(0, 1, 0), new V3(0, 0, 1));
        a.position.set(X - 0.05, 0.1 + (i - 1) * 0.42, -3.6);
        w.add(a); windArrows.push(a);
      }
      var wLab = makeLabel('Viento relativo', 'light', 0.95); wLab.position.set(X, 0.75, -3.1); w.add(wLab);
      var aLab = makeLabel('Ángulo de ataque', 'accent', 1.05); aLab.position.set(X, -0.75, -1.2); w.add(aLab);
      // angle arc
      var arcGeo = new THREE.BufferGeometry();
      arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(33 * 3), 3));
      var arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false }));
      arc.renderOrder = 27;
      w.add(arc);
      var windRef = dashedLine(new V3(X, 0, -2.2), new V3(X, 0, 0.5), 0x2F6FA8, 0.08);
      w.add(windRef);
      // streamlines + particles
      var NL = 6, NP = 70, lines = [], dots = [];
      for (var k = 0; k < NL; k++) {
        var lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
        var ln = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x2F6FA8, transparent: true, opacity: 0.45, depthTest: false }));
        ln.renderOrder = 21;
        w.add(ln); lines.push(ln);
      }
      var NDOT = 12 * NL;
      var dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NDOT * 3), 3));
      var dotTex = (function () {
        var c = makeCanvas(32, 32), gg = c.getContext('2d');
        var gr = gg.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        gg.fillStyle = gr; gg.fillRect(0, 0, 32, 32);
        return ctex(c);
      })();
      var dots3 = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x1f5f9a, size: 0.09, map: dotTex, transparent: true, depthTest: false, depthWrite: false }));
      dots3.renderOrder = 28;
      w.add(dots3);
      var swirl = [];
      for (var q = 0; q < 3; q++) {
        var pts = [];
        for (var t = 0; t <= 24; t++) { var an = t / 24 * Math.PI * 1.7; pts.push(new V3(0, Math.sin(an) * 0.09 * (1 + t / 24), Math.cos(an) * 0.09 * (1 + t / 24))); }
        var sl = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xB5476B, transparent: true, opacity: 0, depthTest: false }));
        sl.renderOrder = 27;
        w.add(sl); swirl.push(sl);
      }
      var stallLab = makeLabel('¡PÉRDIDA! El aire se despega del ala', 'accent', 1.0);
      stallLab.position.set(X, 1.25, 1.2);
      w.add(stallLab);
      g.userData.wind = { group: w, arrows: windArrows, aLab: aLab, arc: arc, lines: lines, dots: dots3, swirl: swirl, stallLab: stallLab, NP: NP, NL: NL };
      w.visible = false;
      return g;
    }

    // carburettor ice diagram (billboard)
    var carbCanvas = makeCanvas(560, 440);
    function buildCarb() {
      var g = new THREE.Group();
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex(carbCanvas), depthTest: false, depthWrite: false, transparent: true }));
      sp.scale.set(1.6, 1.6 * 440 / 560, 1);
      sp.position.set(-1.84, 0.55, -2.18);
      sp.renderOrder = 31;
      g.add(sp);
      g.add(leaderLine(new V3(-0.95, 0.15, -2.2), new V3(-0.12, -0.6, -1.4), ACCENT));
      g.userData.sprite = sp;
      sp.userData = {};
      floatPanels.push(sp);
      overlays.add(g);
      return g;
    }
    function drawCarb(ice, heat, rpm, t) {
      var g = carbCanvas.getContext('2d'), W = 560, H = 440;
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(246,248,249,0.96)'; roundRect(g, 2, 2, W - 4, H - 4, 18); g.fill();
      g.strokeStyle = '#C3CCD3'; g.lineWidth = 2; roundRect(g, 2, 2, W - 4, H - 4, 18); g.stroke();
      g.font = '700 30px ' + FONT_DISPLAY; g.fillStyle = '#13202B'; g.textBaseline = 'top';
      g.fillText('CARBURADOR (corte simple)', 22, 16, W - 44);
      // throat walls: up-draft, air enters from the bottom
      var cx = 190, top = 70, bot = 410, vy = 250;
      function wallX(y, side) {
        var d = Math.abs(y - vy) / 150, w = 34 + 46 * Math.min(1, d * d);
        return cx + side * w;
      }
      g.fillStyle = '#9aa3aa';
      [-1, 1].forEach(function (s) {
        g.beginPath(); g.moveTo(cx + s * 120, top);
        for (var y = top; y <= bot; y += 6) g.lineTo(wallX(y, s), y);
        g.lineTo(cx + s * 120, bot); g.closePath(); g.fill();
      });
      // ice on the venturi walls and around the throttle valve
      if (ice > 0.01) {
        g.fillStyle = 'rgba(225,244,255,0.95)'; g.strokeStyle = '#7fb6d9'; g.lineWidth = 1.5;
        [-1, 1].forEach(function (s) {
          g.beginPath();
          for (var y = vy - 90; y <= vy + 60; y += 5) g.lineTo(wallX(y, s) - s * ice * 26 * Math.sin((y - vy + 90) / 150 * Math.PI), y);
          for (var y2 = vy + 60; y2 >= vy - 90; y2 -= 5) g.lineTo(wallX(y2, s), y2);
          g.closePath(); g.fill(); g.stroke();
        });
      }
      // throttle butterfly
      g.save(); g.translate(cx, 150); g.rotate(-0.5);
      g.fillStyle = '#4A5966'; g.fillRect(-36, -3, 72, 6);
      if (ice > 0.3) { g.fillStyle = 'rgba(225,244,255,0.95)'; g.fillRect(-36, -3 - ice * 8, 72, ice * 8); }
      g.restore();
      // fuel nozzle
      g.fillStyle = '#C8641A'; g.fillRect(cx - 4, vy - 2, 30, 6);
      // airflow dots
      var gap = 1 - ice * 0.75, flow = (rpm / 2500);
      for (var k = 0; k < 18; k++) {
        var ph = ((t * (0.5 + flow) + k / 18) % 1);
        var y3 = bot - ph * (bot - top);
        var wx = (wallX(y3, 1) - cx - 8) * gap;
        var x3 = cx + ((k * 37) % 23 - 11) / 11 * wx;
        g.fillStyle = heat > 0.5 ? 'rgba(217,102,28,0.9)' : 'rgba(47,111,168,0.9)';
        g.beginPath(); g.arc(x3, y3, 4.5, 0, Math.PI * 2); g.fill();
      }
      g.font = '600 22px ' + FONT_DISPLAY; g.fillStyle = '#13202B'; g.textBaseline = 'middle';
      g.fillText('al motor ↑', cx - 40, top - 10 + 2);
      g.fillText(heat > 0.5 ? 'aire CALIENTE (carb heat)' : 'aire de afuera (filtro)', cx - 95, bot + 18 - 4);
      // side annotations
      var x0 = 330;
      g.textBaseline = 'top';
      g.font = '600 24px ' + FONT_DISPLAY;
      var maxW = W - x0 - 14;
      g.fillStyle = '#13202B'; g.fillText('Venturi: el aire se acelera', x0, 80, maxW);
      g.fillText('y se enfría', x0, 106, maxW);
      g.fillStyle = ice > 0.05 ? '#2F6FA8' : '#4A5966';
      g.fillText(ice > 0.05 ? 'HIELO: tapa el paso del aire' : 'Mariposa del acelerador', x0, 150, maxW);
      // RPM box
      g.fillStyle = '#13202B'; roundRect(g, x0, 210, maxW, 86, 10); g.fill();
      g.font = '700 22px ' + FONT_DISPLAY; g.fillStyle = '#9AA9B5'; g.fillText('TACÓMETRO', x0 + 14, 220);
      g.font = "700 34px 'B612 Mono', ui-monospace, monospace"; g.fillStyle = rpm < 2200 ? '#F08A3C' : '#FFFFFF';
      g.fillText(String(Math.round(rpm / 10) * 10) + ' RPM', x0 + 14, 250, maxW - 28);
      g.font = '600 22px ' + FONT_DISPLAY; g.fillStyle = heat > 0.5 ? '#C8641A' : '#4A5966';
      g.fillText(heat > 0.5 ? 'CARB HEAT: CALIENTE (afuera)' : 'CARB HEAT: FRÍO (adentro)', x0, 316, maxW);
      g.fillStyle = '#4A5966';
      g.fillText('Aire húmedo: hielo posible', x0, 352, maxW);
      g.fillText('aun con 15–25 °C afuera', x0, 378, maxW);
    }

    // pitot-static airflow particles (airplane frame)
    function buildPitotFlow() {
      var g = new THREE.Group();
      var N = 40;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x2F6FA8, size: 0.035, transparent: true, opacity: 0.9, depthWrite: false }));
      g.add(pts);
      var lp = makeLabel('Tubo pitot: presión de impacto\n(aire de frente) → velocímetro', 'dark', 0.95);
      var tip = geoRefs.pitotTip.clone().sub(new V3(CG.x, CG.y, CG.z));
      lp.position.copy(tip).add(new V3(-0.25, -0.45, -0.25));
      lp.center.set(1, 0.5);
      g.add(lp); g.add(lp.userData.leader = leaderLine(tip, lp.position.clone(), ACCENT));
      var sp = geoRefs.staticPort.clone().sub(new V3(CG.x, CG.y, CG.z));
      var ls = makeLabel('Toma estática: presión del aire quieto\n→ altímetro, variómetro y velocímetro', 'dark', 0.95);
      ls.position.copy(sp).add(new V3(-0.6, -0.55, -0.55));
      ls.center.set(1, 0.5);
      g.add(ls); g.add(ls.userData.leader = leaderLine(sp, ls.position.clone(), ACCENT));
      g.userData = { pts: pts, N: N, tip: tip, sp: sp, lp: lp, ls: ls };
      overlays.add(g);
      return g;
    }

    /* =========================================================== CAMERA */
    var cam = { from: { pos: new V3(), target: new V3(), up: new V3(0, 1, 0) }, to: { pos: new V3(), target: new V3(), up: new V3(0, 1, 0) }, t: 1, dur: 0.9, view: 'rear34' };
    function setView(name, instant) {
      var v = VIEWS[name];
      if (!v) return false;
      cam.from.pos.copy(camera.position); cam.from.target.copy(target); cam.from.up.copy(camera.up);
      cam.to.pos.fromArray(v.pos); cam.to.target.fromArray(v.target); cam.to.up.fromArray(v.up || [0, 1, 0]);
      cam.view = name;
      ext.view = name;
      cam.t = (instant || reducedMotion()) ? 1 : 0;
      if (cam.t >= 1) applyCam(1);
      ext.cameraBusy = cam.t < 1;
      return true;
    }
    var _up = new V3();
    function applyCam(u) {
      var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      camera.position.lerpVectors(cam.from.pos, cam.to.pos, e);
      // arc slightly outward so the camera does not cut through the airplane
      var lift = Math.sin(Math.PI * e) * 0.25 * cam.from.pos.distanceTo(cam.to.pos);
      camera.position.y += lift * 0.4;
      target.lerpVectors(cam.from.target, cam.to.target, e);
      _up.lerpVectors(cam.from.up, cam.to.up, e);
      if (_up.lengthSq() < 1e-4) _up.set(0, 1, 0);
      camera.up.copy(_up.normalize());
      camera.lookAt(target);
    }

    /* ========================================================= ANIMATIONS */
    function P0() {
      return { ail: 0, elevCmd: 0, rudCmd: 0, tab: 0, flaps: 0, pitch: 0, bank: 0, yaw: 0, rpm: 0, nose: 0,
        ground: true, lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false },
        arrows: { roll: 0, pitch: 0, yaw: 0 }, caption: '', doorL: 0, doorR: 0, windowL: 0, emph: [], dusk: 0,
        brakeL: 0, brakeR: 0, roll: 0, rawElev: null, rawTab: null };
    }
    var ANIMS = {
      'axes-roll': {
        dur: 10, view: 'rear', overlays: ['axisLong'],
        frame: function (t, P) {
          P.ground = false;
          P.ail = kf(t, [[0, 0], [1.2, 0], [1.8, 0.8], [3.4, 0.8], [3.9, 0], [5.2, 0], [5.8, -0.8], [7.9, -0.8], [8.4, 0], [10, 0]]);
          P.bank = kf(t, [[0, 0], [1.6, 0], [3.9, 30], [5.4, 30], [8.4, -30], [9.2, -30], [10, 0]]);
          P.arrows.roll = P.ail;
          P.caption = stepKeys(t, [[0, 'Eje longitudinal: va de la nariz a la cola. Girar alrededor de él es ALABEAR.'],
            [1.5, 'Volante a la derecha: alerón derecho ARRIBA, izquierdo ABAJO → el avión se inclina a la derecha'],
            [3.9, 'Volante al centro: la inclinación se mantiene'],
            [5.5, 'Volante a la izquierda: alerón izquierdo ARRIBA, derecho ABAJO → se inclina a la izquierda'],
            [8.4, 'Los alerones controlan el ALABEO (roll)']]);
        }
      },
      'axes-pitch': {
        dur: 10, view: 'side', overlays: ['axisLat'],
        frame: function (t, P) {
          P.ground = false;
          P.elevCmd = kf(t, [[0, 0], [1.2, 0], [1.8, 0.7], [3.3, 0.7], [3.8, 0], [5.2, 0], [5.8, -0.7], [7.6, -0.7], [8.1, 0], [10, 0]]);
          P.pitch = kf(t, [[0, 0], [1.5, 0], [3.8, 14], [5.4, 14], [8.1, -8], [9.0, -8], [10, 0]]);
          P.arrows.pitch = P.elevCmd;
          P.caption = stepKeys(t, [[0, 'Eje transversal: de punta a punta de ala. Girar alrededor de él es CABECEAR.'],
            [1.5, 'Volante hacia atrás (tirás): el timón de profundidad SUBE → la nariz sube'],
            [3.8, 'Volante al centro: la actitud se mantiene'],
            [5.5, 'Volante hacia adelante (empujás): el timón de profundidad BAJA → la nariz baja'],
            [8.1, 'El timón de profundidad controla el CABECEO (pitch)']]);
        }
      },
      'axes-yaw': {
        dur: 10, view: 'top', overlays: ['axisVert'],
        frame: function (t, P) {
          P.ground = false;
          P.rudCmd = kf(t, [[0, 0], [1.2, 0], [1.8, 0.8], [3.4, 0.8], [3.9, 0], [5.2, 0], [5.8, -0.8], [7.6, -0.8], [8.1, 0], [10, 0]]);
          P.yaw = kf(t, [[0, 0], [1.5, 0], [3.9, 20], [5.4, 20], [8.1, -20], [9.0, -20], [10, 0]]);
          P.arrows.yaw = P.rudCmd;
          P.caption = stepKeys(t, [[0, 'Eje vertical: atraviesa el avión de arriba abajo. Girar alrededor de él es GUIÑAR.'],
            [1.5, 'Pedal derecho: el timón de dirección va a la derecha → la nariz gira a la derecha'],
            [3.9, 'Pies al centro: el timón vuelve al medio'],
            [5.5, 'Pedal izquierdo: el timón va a la izquierda → la nariz gira a la izquierda'],
            [8.1, 'El timón de dirección (pedales) controla la GUIÑADA (yaw)']]);
        }
      },
      'four-forces': {
        dur: 11, view: 'forces', overlays: ['forces'],
        frame: function (t, P) {
          P.ground = false; P.rpm = 2350; P.pitch = 1;
          var focus = stepKeys(t, [[0, 'all'], [1.2, 'lift'], [3.2, 'weight'], [5.2, 'thrust'], [7.2, 'drag'], [9.2, 'all']]);
          P.forceFocus = focus;
          P.caption = stepKeys(t, [[0, 'Las cuatro fuerzas que actúan sobre el avión en vuelo'],
            [1.2, 'SUSTENTACIÓN: el ala empuja el avión hacia arriba'],
            [3.2, 'PESO: la gravedad lo tira hacia abajo'],
            [5.2, 'EMPUJE (tracción): la hélice lo tira hacia adelante'],
            [7.2, 'RESISTENCIA: el aire lo frena, hacia atrás'],
            [9.2, 'En vuelo recto y nivelado a velocidad constante: sustentación = peso y empuje = resistencia']]);
        }
      },
      'aoa-stall': {
        dur: 12, view: 'aoa', overlays: ['aoa'],
        frame: function (t, P) {
          P.ground = false; P.rpm = 1500;
          P.pitch = kf(t, [[0, 2], [1, 2], [6.2, 18.5], [8.4, 18.5], [9.4, 3], [12, 2]]);
          P.elevCmd = kf(t, [[0, 0], [1, 0], [2, 0.6], [6.2, 0.95], [8.4, 0.95], [8.8, -0.6], [9.6, 0], [12, 0]]);
          P.aoa = P.pitch;
          P.caption = stepKeys(t, [[0, 'Ángulo de ataque: el ángulo entre la cuerda del ala y el viento relativo'],
            [1.5, 'Tirás del volante: sube la nariz y aumenta el ángulo de ataque → más sustentación…'],
            [4.2, '…hasta un límite. Cerca de ese límite suena la bocina de aviso de pérdida'],
            [6.2, 'Unos 16°: el aire se despega de la parte de arriba del ala → PÉRDIDA (stall)'],
            [8.5, 'Para salir: empujá el volante y bajá la nariz. El aire vuelve a pegarse al ala'],
            [10.2, 'La pérdida depende del ángulo de ataque, no de la velocidad']]);
        }
      },
      'flaps-extend': {
        dur: 12, view: 'flaps', overlays: ['flapLabel'],
        frame: function (t, P) {
          P.flaps = kf(t, [[0, 0], [1, 0], [2, 10], [3.6, 10], [4.6, 20], [6.2, 20], [7.6, 40], [9.6, 40], [11, 0], [12, 0]]);
          P.caption = stepKeys(t, [[0, 'Flaps arriba (UP): el ala está "limpia"'],
            [1, 'Flaps 10°: un poco más de sustentación (el máximo aprobado para despegar)'],
            [4.4, 'Flaps 20°: más sustentación y bastante más resistencia'],
            [6.4, 'Flaps 40°: máxima resistencia. Bajás más empinado y más lento (aterrizaje)'],
            [9.8, 'Flaps arriba: el motor eléctrico los sube del todo']]);
        }
      },
      'trim-tab': {
        dur: 12, view: 'tail', overlays: ['trimLabel'],
        frame: function (t, P) {
          P.ground = false;
          P.rawTab = kf(t, [[0, 0], [1, 0], [2.4, 16], [5.6, 16], [7, -9], [10, -9], [11.4, 0], [12, 0]]);
          P.rawElev = kf(t, [[0, 0], [1.6, 0], [3.2, -9], [5.6, -9], [7.6, 5], [10, 5], [11.6, 0], [12, 0]]);
          P.caption = stepKeys(t, [[0, 'El compensador es la aleta en el borde de fuga del timón de profundidad DERECHO'],
            [1, 'Rueda de trim hacia atrás (nariz arriba): la aleta compensadora BAJA…'],
            [3, '…el aire la empuja y el timón de profundidad SUBE solo → la nariz sube sin que tires'],
            [6, 'Rueda hacia adelante (nariz abajo): la aleta SUBE y el timón de profundidad BAJA'],
            [10.2, 'El trim saca la fuerza del volante: no lo uses para maniobrar, solo para aliviar']]);
        }
      },
      'adverse-yaw': {
        dur: 12, view: 'rearHigh', overlays: ['refLine'],
        frame: function (t, P) {
          P.ground = false;
          var phase2 = t >= 6;
          var tt = phase2 ? t - 6 : t;
          P.ail = kf(tt, [[0, 0], [0.8, 0], [1.3, 0.9], [3.2, 0.9], [3.7, 0], [6, 0]]);
          P.bank = kf(tt, [[0, 0], [1, 0], [3.7, 28], [5.2, 28], [6, 0]]);
          P.yaw = phase2 ? kf(tt, [[0, 0], [1, 0], [3.7, 6], [5.2, 9], [6, 0]]) : kf(tt, [[0, 0], [1, 0], [2.6, -8], [4, -6], [5.2, -5], [6, 0]]);
          P.rudCmd = phase2 ? kf(tt, [[0, 0], [0.8, 0], [1.3, 0.55], [3.2, 0.55], [3.7, 0.1], [6, 0]]) : 0;
          P.arrows.roll = P.ail;
          P.arrows.yaw = phase2 ? (tt > 1 && tt < 4 ? 0.7 : 0) : (tt > 1.2 && tt < 3.5 ? -0.8 : 0);
          P.caption = phase2
            ? stepKeys(tt, [[0, 'Ahora con pedal derecho al mismo tiempo…'], [1.2, 'Volante y pedal DERECHOS juntos: la nariz acompaña el giro'], [3.8, 'Eso es un viraje coordinado (la bolita queda centrada)']])
            : stepKeys(tt, [[0, 'Guiñada adversa: alabeo a la derecha SIN usar los pedales'], [1.2, 'El alerón que BAJA (izquierdo) da más sustentación y más resistencia…'], [2.6, '…y frena el ala izquierda: la nariz se va a la IZQUIERDA, al revés del giro'], [4.4, 'Se corrige con pedal hacia el lado del giro']]);
        }
      },
      'left-turning': {
        dur: 11, view: 'rearHigh', overlays: ['refLine'],
        frame: function (t, P) {
          P.ground = false;
          P.rpm = kf(t, [[0, 1700], [1, 1700], [2, 2500], [11, 2500]]);
          P.pitch = kf(t, [[0, 0], [1, 0], [2.5, 10], [11, 10]]);
          P.elevCmd = kf(t, [[0, 0], [1, 0], [2, 0.35], [11, 0.35]]);
          P.yaw = kf(t, [[0, 0], [2, 0], [4.2, -10], [5.4, -10], [7.4, 0], [11, 0]]);
          P.rudCmd = kf(t, [[0, 0], [5.4, 0], [6.2, 0.5], [11, 0.5]]);
          P.arrows.yaw = t > 2.2 && t < 4.6 ? -0.8 : (t > 5.6 && t < 7.4 ? 0.6 : 0);
          P.caption = stepKeys(t, [[0, 'Subida a plena potencia y poca velocidad (despegue, ascenso)'],
            [2.2, 'La hélice gira a la derecha (visto desde la cabina) y la nariz tiende a irse a la IZQUIERDA'],
            [5.4, 'Pedal DERECHO: el timón va a la derecha y la nariz vuelve al rumbo'],
            [7.6, 'Regla: más potencia y menos velocidad → más pie derecho (bolita centrada)']]);
        }
      },
      'coordinated-turn': {
        dur: 13, view: 'rear', overlays: ['refLine'],
        frame: function (t, P) {
          P.ground = false; P.rpm = 2300;
          P.ail = kf(t, [[0, 0], [1, 0], [1.5, 0.7], [3.2, 0.7], [3.7, 0], [8.6, 0], [9.1, -0.7], [10.8, -0.7], [11.3, 0], [13, 0]]);
          P.bank = kf(t, [[0, 0], [1.2, 0], [3.7, 30], [8.8, 30], [11.3, 0], [13, 0]]);
          P.rudCmd = kf(t, [[0, 0], [1, 0], [1.5, 0.35], [3.5, 0.35], [4, 0.08], [8.6, 0.08], [9.1, -0.35], [10.8, -0.35], [11.3, 0], [13, 0]]);
          P.elevCmd = kf(t, [[0, 0], [3, 0], [4, 0.25], [8.8, 0.25], [10.5, 0], [13, 0]]);
          P.yaw = kf(t, [[0, 0], [1.5, 0], [11.3, 55], [13, 55]]);
          P.arrows.roll = P.ail; P.arrows.yaw = Math.abs(P.rudCmd) > 0.2 ? P.rudCmd * 1.5 : 0;
          P.arrows.pitch = P.elevCmd > 0.2 ? 0.5 : 0;
          P.caption = stepKeys(t, [[0, 'Viraje coordinado a la derecha'],
            [1.2, '1) Volante a la derecha: el avión se inclina'],
            [2.4, '2) A la vez, un poco de pedal derecho: la nariz acompaña (bolita centrada)'],
            [4, '3) Volante casi al centro y un poco de presión atrás: mantiene la altura'],
            [8.8, '4) Para salir: volante y pedal a la izquierda juntos, y aflojás la presión'],
            [11.4, 'Nivelado en el rumbo nuevo']]);
        }
      },
      'ground-steering': {
        dur: 13, view: 'nose',
        frame: function (t, P) {
          P.ground = true; P.rpm = 900;
          P.rudCmd = kf(t, [[0, 0], [1, 0], [1.8, -1], [4.6, -1], [5.4, 0], [6.6, 0], [7.4, 1], [10.6, 1], [11.4, 0], [13, 0]]);
          P.nose = kf(t, [[0, 0], [1, 0], [1.8, -8.5], [3.0, -8.5], [3.6, -26], [4.6, -26], [5.4, 0], [6.6, 0], [7.4, 8.5], [8.6, 8.5], [9.2, 26], [10.6, 26], [11.4, 0], [13, 0]]);
          P.brakeL = t > 3.2 && t < 4.8 ? 1 : 0;
          P.brakeR = t > 8.8 && t < 10.8 ? 1 : 0;
          P.yawRate = P.nose * 0.9;
          P.roll = 1;
          P.emph = P.brakeL ? ['brakes'] : (P.brakeR ? ['brakes'] : []);
          P.brakeSide = P.brakeL ? -1 : (P.brakeR ? 1 : 0);
          P.caption = stepKeys(t, [[0, 'En tierra se dobla con los PEDALES (no con el volante)'],
            [1, 'Pedal izquierdo: la rueda de nariz dobla a la izquierda (hasta unos 8,5°)'],
            [3.2, 'Para doblar más cerrado: freno izquierdo (punta del pedal) → hasta unos 30°'],
            [5.4, 'Pies al centro: la rueda vuelve al medio'],
            [6.6, 'Pedal derecho: la rueda de nariz dobla a la derecha'],
            [8.8, 'Con freno derecho, el giro es más cerrado. Rodá despacio, a paso de hombre'],
            [11.4, 'El timón de dirección también se mueve, pero a baja velocidad casi no hace efecto']]);
        }
      },
      'propeller-throttle': {
        dur: 12, view: 'front34', overlays: ['rpmLabel'],
        frame: function (t, P) {
          P.ground = true;
          P.rpm = kf(t, [[0, 0], [0.6, 0], [1.6, 700], [3, 700], [4.2, 1700], [6, 1700], [7.4, 2500], [9.2, 2500], [10.6, 700], [12, 700]]);
          P.caption = stepKeys(t, [[0, 'Hélice bipala de paso fijo, movida directamente por el motor'],
            [1.4, 'Ralentí: unas 700 RPM (acelerador afuera)'],
            [3.2, 'Acelerador hacia adentro (empujás): más RPM, la hélice gira más rápido y tira más'],
            [6.2, 'A fondo: unas 2500 RPM en tierra (ver el POH)'],
            [9.2, 'Acelerador hacia afuera (tirás): menos RPM. Nunca pases la línea roja de 2750']]);
        }
      },
      'lights-demo': {
        dur: 14, view: 'front34', overlays: ['lightLabel'],
        frame: function (t, P) {
          P.ground = true; P.dusk = kf(t, [[0, 0], [1, 1], [13, 1], [14, 0]]);
          P.lights.nav = t > 1.4;
          P.lights.beacon = t > 4.4;
          P.lights.strobe = t > 7.4;
          P.lights.landing = t > 10.2 && t < 13.6;
          P.rpm = t > 4.6 ? 800 : 0;
          P.lightText = stepKeys(t, [[0, ''], [1.4, 'Luces de navegación'], [4.4, 'Baliza (beacon)'], [7.4, 'Strobes'], [10.2, 'Luz de aterrizaje'], [13, '']]);
          P.caption = stepKeys(t, [[0, 'Las luces exteriores del Cessna 150'],
            [1.4, 'NAV: roja en el ala IZQUIERDA, verde en la DERECHA y blanca en la cola'],
            [4.4, 'BEACON: luz roja intermitente arriba de la deriva. Se prende antes de arrancar: "motor en marcha"'],
            [7.4, 'STROBES: destellos blancos en las puntas de ala, para que te vean en vuelo'],
            [10.2, 'LANDING: la luz de aterrizaje está en la nariz, en el capó'],
            [13.2, 'Recordá: sin master no hay luces']]);
        }
      },
      'controls-check': {
        dur: 14, view: 'rear34', overlays: ['checkLabel'],
        frame: function (t, P) {
          P.ail = kf(t, [[0, 0], [0.8, 0], [1.4, -1], [2.4, -1], [3.0, 1], [4.0, 1], [4.6, 0], [14, 0]]);
          P.elevCmd = kf(t, [[0, 0], [4.8, 0], [5.4, 1], [6.4, 1], [7.0, -1], [8.0, -1], [8.6, 0], [14, 0]]);
          P.rudCmd = kf(t, [[0, 0], [8.8, 0], [9.4, -1], [10.4, -1], [11.0, 1], [12.0, 1], [12.6, 0], [14, 0]]);
          P.emph = t < 4.6 ? ['aileronL', 'aileronR'] : (t < 8.6 ? ['elevator'] : (t < 12.6 ? ['rudder'] : []));
          P.caption = stepKeys(t, [[0, 'Prevuelo: comandos "libres y correctos" (sacá la traba primero)'],
            [1.2, 'Volante a la IZQUIERDA: alerón izquierdo ARRIBA, derecho ABAJO'],
            [2.8, 'Volante a la DERECHA: alerón derecho ARRIBA, izquierdo ABAJO'],
            [5.2, 'Volante ATRÁS: el timón de profundidad SUBE'],
            [6.8, 'Volante ADELANTE: el timón de profundidad BAJA'],
            [9.2, 'Pedal IZQUIERDO: el timón de dirección va a la IZQUIERDA'],
            [10.8, 'Pedal DERECHO: el timón de dirección va a la DERECHA'],
            [12.6, 'Todo se mueve hasta el tope, sin trabas y para el lado correcto']]);
        }
      },
      'carb-ice': {
        dur: 16, view: 'engine', overlays: ['carb'],
        frame: function (t, P) {
          P.ground = false; P.highlightCarb = true;
          P.ice = kf(t, [[0, 0], [2, 0], [7, 0.85], [9, 0.9], [11.5, 0.15], [13, 0], [16, 0]]);
          P.heat = t > 8.5 && t < 14.5 ? 1 : 0;
          var r = kf(t, [[0, 2350], [2, 2350], [7, 1950], [8.5, 1900], [9.4, 1750], [11.5, 2050], [13, 2200], [14.5, 2200], [15.2, 2350], [16, 2350]]);
          P.rpm = r; P.carbRpm = r;
          P.caption = stepKeys(t, [[0, 'Dentro del carburador, el aire se acelera en el venturi y se enfría mucho'],
            [2.2, 'Con aire húmedo (muy común en Uruguay) se forma HIELO, aunque afuera haga calor'],
            [4.6, 'El hielo tapa el paso del aire: la RPM baja de a poco y el motor puede andar áspero'],
            [8.5, 'CARB HEAT afuera (caliente): entra aire calentado en el escape'],
            [9.6, 'Al principio puede andar peor: es el hielo que se derrite. Dejá el calor puesto'],
            [12, 'Sin hielo, la RPM se recupera. Después volvé el carb heat a FRÍO (adentro)'],
            [14.6, 'Regla: carb heat ANTES de reducir potencia (descenso y aproximación)']]);
        }
      },
      'pitot-static': {
        dur: 12, view: 'pitot', overlays: ['pitot'],
        frame: function (t, P) {
          P.ground = false;
          P.viewKeys = [[0, 'pitot'], [6, 'side']];
          P.emph = t < 6 ? ['pitotTube'] : ['staticPort'];
          P.pitotFlow = t < 6 ? 1 : 0;
          P.staticFlow = t >= 6 ? 1 : 0;
          P.caption = stepKeys(t, [[0, 'El tubo pitot está debajo del ala IZQUIERDA y mira hacia adelante'],
            [2, 'Recibe el aire de frente (presión de impacto) → la usa el velocímetro'],
            [4, 'En la prevuelo: sacá la funda y fijate que no esté tapado (insectos, nidos)'],
            [6, 'La toma estática está en el costado izquierdo del fuselaje, adelante'],
            [8, 'Mide la presión del aire quieto → altímetro, variómetro y velocímetro'],
            [10, 'Si se tapan, los instrumentos marcan mal. Revisalos siempre antes de volar']]);
        }
      }
    };

    /* ========================================================= STATE */
    var disp = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, trimTab: 0, flaps: 0, pitch: 0, bank: 0, yaw: 0, nose: 0,
      doorL: 0, doorR: 0, windowL: 0, dusk: 0, stance: STANCE };
    var anim = { name: null, t: 0, loop: false, prevView: null, lastViewKey: null };
    var clock = 0;
    var track = { trim: null, trimT: -10, trimDir: 0, flaps: null, flapsT: -10, flapsDir: 0, rpm: null, rpmT: -10, rpmDir: 0 };
    var poseTmp = P0();

    function surfacesFromInputs(state, out) {
      var yr = num(state.yokeRoll, 0), yp = num(state.yokePitch, 0), rd = num(state.rudder, 0), tr = num(state.trim, 0);
      if (state.controlLock) { yr = 0; yp = 0; }
      out.aileronL = yr < 0 ? 20 * yr : 14 * yr;
      out.aileronR = yr < 0 ? -14 * yr : -20 * yr;
      out.elevator = yp > 0 ? -25 * yp : -15 * yp;
      out.rudder = 23 * rd;
      out.trimTab = tr > 0 ? 20 * tr : 10 * tr;
      out.flaps = num(state.flaps, 0);
      return out;
    }
    var surfTmp = {};

    function stateCaption(state) {
      var yr = num(state.yokeRoll, 0), yp = num(state.yokePitch, 0), rd = num(state.rudder, 0);
      var onGround = !state.air || state.air.onGround !== false;
      var out = [];
      if (state.controlLock && (Math.abs(yr) > 0.1 || Math.abs(yp) > 0.1)) {
        return 'Traba de comandos puesta: el volante no se mueve. Sacala antes de volar';
      }
      if (Math.abs(yr) > 0.1) out.push(yr < 0
        ? 'Volante a la izquierda: alerón izquierdo ARRIBA, derecho ABAJO → el avión se inclina a la izquierda'
        : 'Volante a la derecha: alerón derecho ARRIBA, izquierdo ABAJO → el avión se inclina a la derecha');
      if (Math.abs(yp) > 0.1) out.push(yp > 0
        ? 'Volante hacia atrás: el timón de profundidad SUBE → la nariz sube'
        : 'Volante hacia adelante: el timón de profundidad BAJA → la nariz baja');
      if (Math.abs(rd) > 0.1) out.push(rd < 0
        ? 'Pedal izquierdo: el timón se mueve a la izquierda → la nariz gira a la izquierda' + (onGround ? ' (y la rueda de nariz dobla)' : '')
        : 'Pedal derecho: el timón se mueve a la derecha → la nariz gira a la derecha' + (onGround ? ' (y la rueda de nariz dobla)' : ''));
      if (out.length) return out.slice(0, 2).join(' · ');
      if (clock - track.flapsT < 0.4) return (track.flapsDir > 0 ? 'Flaps bajando: ' : 'Flaps subiendo: ') + Math.round(num(state.flaps, 0)) + '°';
      if (clock - track.trimT < 2.5) return track.trimDir > 0
        ? 'Compensador nariz arriba: la aleta BAJA y el timón de profundidad tiende a SUBIR'
        : 'Compensador nariz abajo: la aleta SUBE y el timón de profundidad tiende a BAJAR';
      var bl = num(state.brakeL, 0), br = num(state.brakeR, 0);
      if (onGround && (bl > 0.2 || br > 0.2)) return bl > 0.2 && br > 0.2 ? 'Frenos aplicados (las dos puntas de pedal)' : (bl > 0.2 ? 'Freno izquierdo: el avión tiende a doblar a la izquierda' : 'Freno derecho: el avión tiende a doblar a la derecha');
      if (clock - track.rpmT < 1.5) return 'Hélice a ' + Math.round(num(state.propRpm, 0) / 10) * 10 + ' RPM (acelerador ' + (track.rpmDir > 0 ? 'hacia adentro)' : 'hacia afuera)');
      if (num(state.flaps, 0) > 0.5) return 'Flaps a ' + Math.round(num(state.flaps, 0)) + '°';
      return '';
    }

    function updateTracking(state) {
      var tr = num(state.trim, 0), fl = num(state.flaps, 0), rpm = num(state.propRpm, 0);
      if (track.trim !== null && Math.abs(tr - track.trim) > 0.002) { track.trimDir = tr > track.trim ? 1 : -1; track.trimT = clock; }
      if (track.flaps !== null && Math.abs(fl - track.flaps) > 0.01) { track.flapsDir = fl > track.flaps ? 1 : -1; track.flapsT = clock; }
      if (track.rpm !== null && Math.abs(rpm - track.rpm) > 6 && rpm > 300) { track.rpmDir = rpm > track.rpm ? 1 : -1; track.rpmT = clock; }
      track.trim = tr; track.flaps = fl; track.rpm = rpm;
    }

    /* ================================================ shadows + reflections */
    // every lit airplane mesh casts and receives the key light's shadow (wing → fuselage, struts, tail on the floor);
    // glass, lenses and the unlit helpers (prop disc, glows, beam, halos, overlays) do not cast
    (function setupShadowCasters() {
      model.traverse(function (o) {
        if (!o.isMesh) return;
        var m = o.material;
        if (!m || m.isMeshBasicMaterial || m.isShaderMaterial || m.isSpriteMaterial) return;
        var glassy = m === glassMat || (m.transparent && m.opacity < 0.97 && !m.vertexColors);
        o.castShadow = !glassy;
        o.receiveShadow = true;
      });
    })();
    var envDim = 1;
    /** Scales every lit material's environment reflections (dusk in the lights demo). */
    function setEnvDim(f) {
      if (Math.abs(f - envDim) < 0.004) return;
      envDim = f;
      model.traverse(function (o) {
        var m = o.material;
        if (!m || !m.isMeshStandardMaterial) return;
        if (m.userData.envBase == null) m.userData.envBase = m.envMapIntensity;
        m.envMapIntensity = m.userData.envBase * f;
      });
    }
    var shadowSig = NaN;
    /** Re-render the key light's shadow map only when something that casts moved. */
    function refreshShadow(blur) {
      var castBlades = blur < 0.5;   // a spinning (blurred) propeller casts no hard blade shadow
      for (var i = 0; i < prop.blades.children.length; i++) prop.blades.children[i].castShadow = castBlades;
      var q = attitude.quaternion;
      var sig = disp.aileronL * 1.1 + disp.aileronR * 1.3 + disp.elevator * 1.7 + disp.rudder * 1.9 + disp.trimTab * 2.3 +
        disp.flaps * 2.9 + disp.nose * 3.1 + disp.doorL * 5.3 + disp.doorR * 5.9 + disp.windowL * 6.1 +
        q.x * 37 + q.y * 41 + q.z * 43 + (castBlades ? 0.5 + prop.angle * 7 : 0);
      if (!(Math.abs(sig - shadowSig) < 1e-4)) { shadowSig = sig; sun.shadow.needsUpdate = true; }
    }

    /* ------------------------------------------- keep floating labels inside the viewport */
    var _lp = new V3(), _lv = new V3();
    var floatPanels = [];          // world-sized overlay sprites (carb panel) that must also stay visible
    var occluder = null;           // the cockpit inset over the exterior main view (core: ext.setOccluder)
    var vpCss = { w: 0, h: 0 };    // CSS size of the viewport being rendered
    var LABEL_MARGIN = 0.025;   // NDC units
    function shownInScene(o) {
      for (var p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    }
    /**
     * Called by the renderer right before each render of ext.scene (main view or inset), with that camera and
     * viewport: a label sprite whose box would cross the edge slides back inside (its leader line follows).
     */
    function clampLabels(cam) {
      if (!cam || !cam.isPerspectiveCamera) return;
      var tanH = Math.tan(cam.fov * DEG / 2) / (cam.zoom || 1), asp = cam.aspect || 1, m = LABEL_MARGIN;
      var items = [], i, j, it, list = floatPanels.length ? allLabels.concat(floatPanels) : allLabels;
      for (i = 0; i < list.length; i++) {
        var sp = list[i], ud = sp.userData;
        if (!sp.parent || !shownInScene(sp)) continue;
        if (!ud.home) ud.home = sp.position.clone();
        else if (!ud.shifted || sp.position.distanceToSquared(ud.setPos) > 1e-10) {
          ud.home.copy(sp.position); ud.shifted = false;    // overlays may move their labels: follow the authored spot
        }
        _lp.copy(ud.home);
        sp.parent.localToWorld(_lp);
        _lp.project(cam);
        if (!(_lp.z > -1 && _lp.z < 1)) { items.push({ sp: sp, skip: true }); continue; }
        var w = sp.scale.x / (tanH * asp), h = sp.scale.y / tanH;   // sizeAttenuation:false → constant NDC size
        if (sp.material.sizeAttenuation !== false) {   // world-sized panel: divide by its view depth
          _lv.copy(ud.home); sp.parent.localToWorld(_lv); _lv.applyMatrix4(cam.matrixWorldInverse);
          var dist = Math.max(0.05, -_lv.z); w /= dist; h /= dist;
        }
        items.push({ sp: sp, x: _lp.x, y: _lp.y, z: _lp.z, w: w, h: h, l: _lp.x - sp.center.x * w, b: _lp.y - sp.center.y * h });
      }
      function fit(o) {   // slide a box back inside the viewport
        if (o.w < 2 - 2 * m) { if (o.l < -1 + m) o.l = -1 + m; else if (o.l + o.w > 1 - m) o.l = 1 - m - o.w; }
        if (o.h < 2 - 2 * m) { if (o.b < -1 + m) o.b = -1 + m; else if (o.b + o.h > 1 - m) o.b = 1 - m - o.h; }
      }
      var placed = [];
      if (occluder && Math.abs(vpCss.w - occluder.vw) < 2 && Math.abs(vpCss.h - occluder.vh) < 2) placed.push(occluder.ndc);
      function overlap(l, b, w, h, gap) {   // total overlap area with the labels already placed
        var a = 0;
        for (var q = 0; q < placed.length; q++) {
          var p = placed[q];
          var ox = Math.min(l + w, p.l + p.w) - Math.max(l, p.l), oy = Math.min(b + h + gap, p.b + p.h + gap) - Math.max(b, p.b);
          if (ox > 0 && oy > 0) a += ox * oy;
        }
        return a;
      }
      items.sort(function (a, b) { return a.skip ? 1 : (b.skip ? -1 : (b.b + b.h) - (a.b + a.h)); });   // top first
      for (i = 0; i < items.length; i++) {
        it = items[i];
        if (it.skip) continue;
        fit(it);
        // nearest free slot: try vertical steps of one label height (alternating down/up), then half-width side
        // shifts; if every slot is taken keep the one with the least overlap
        var l0 = it.l, b0 = it.b, gap = it.h * 0.14, best = null, bestA = Infinity;
        for (var c = 0; c < 39 && bestA > 0; c++) {
          var k = c % 13, sx = c < 13 ? 0 : (c < 26 ? 1 : -1) * Math.min(0.55 * it.w, 0.3);
          var stepY = k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * Math.min(it.h + gap, 0.16);
          var cand = { l: l0 + sx, b: b0 + stepY, w: it.w, h: it.h };
          fit(cand);
          var area = overlap(cand.l, cand.b, cand.w, cand.h, gap) + Math.abs(stepY) * 1e-4 + Math.abs(sx) * 1e-4;
          if (area < bestA) { bestA = area; best = cand; }
        }
        it.l = best.l; it.b = best.b;
        placed.push(it);
      }
      for (i = 0; i < items.length; i++) {
        it = items[i];
        var s = it.sp, u = s.userData;
        var dx = it.skip ? 0 : it.l - (it.x - s.center.x * it.w), dy = it.skip ? 0 : it.b - (it.y - s.center.y * it.h);
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
          if (u.shifted) { u.shifted = false; s.position.copy(u.home); s.updateMatrixWorld(); moveLeader(s); }
          continue;
        }
        _lp.set(it.x + dx, it.y + dy, it.z);
        _lp.unproject(cam);
        s.parent.worldToLocal(_lp);
        s.position.copy(_lp);
        u.shifted = true;
        u.setPos = (u.setPos || new V3()).copy(_lp);
        s.updateMatrixWorld();
        moveLeader(s);
      }
    }
    function moveLeader(sp) {
      var line = sp.userData.leader;
      if (!line) return;
      var a = line.geometry.attributes.position;
      a.setXYZ(1, sp.position.x, sp.position.y, sp.position.z);
      a.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
    // small viewports (the inset, phones) show only the most important part labels, so they stay readable
    var LABEL_PRIORITY = ['aileronL', 'aileronR', 'elevator', 'rudder', 'flapL', 'propeller', 'stabilizer', 'fin', 'trimTab',
      'noseWheel', 'mainWheels', 'pitotTube', 'cowling', 'struts', 'doorL', 'fuelCapL', 'staticPort', 'stallWarningInlet'];
    var _vp = new THREE.Vector4(), _camL = new V3();
    // Labels drawn on top (no depth test) would show a part on the FAR side of the airplane "through" it. These are
    // hidden when the camera is clearly on the other side and roughly abeam (from ahead or behind both wings are in
    // view): wing parts (1) only while the camera is not above the wing (from above, the far wing's top is really in
    // view); fuselage-side parts (2) whatever the height.
    var FAR_SIDE = { aileronL: 1, aileronR: 1, flapL: 1, pitotTube: 1, stallWarningInlet: 1, fuelCapL: 1, struts: 2,
      staticPort: 2, doorL: 2 };
    var labelAnchor = {};
    LABEL_DEFS.forEach(function (d) { labelAnchor[d[0]] = d[2]; });
    function farSide(id, cam) {
      var kind = FAR_SIDE[id];
      if (!kind || !cam) return false;
      var a = labelAnchor[id], side = a[0] < 0 ? -1 : 1;
      if (side * _camL.x > -0.9 || Math.abs(_camL.x) < 0.8 * Math.abs(_camL.z - a[2])) return false;
      return kind === 2 || _camL.y < 1.6;
    }
    function labelBudget(renderer, cam) {
      if (!renderer || !renderer.getCurrentViewport) return;
      renderer.getCurrentViewport(_vp);
      var pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      vpCss.w = _vp.z / pr; vpCss.h = _vp.w / pr;
      if (!labelGroup.visible) return;
      if (cam) { _camL.setFromMatrixPosition(cam.matrixWorld); model.worldToLocal(_camL); }
      var area = vpCss.w * vpCss.h;
      var budget = clamp(Math.floor(area / 9000), 4, LABEL_PRIORITY.length), n = 0;
      LABEL_PRIORITY.forEach(function (id) {
        var g = partLabels[id];
        if (!g) return;
        var want = g.userData.want !== false && !farSide(id, cam);
        g.visible = want && n < budget;
        if (want) n++;
      });
    }
    scene.onBeforeRender = function (renderer, sc, cam) {
      try { labelBudget(renderer, cam); clampLabels(cam); } catch (e) { /* never break a frame for a label */ }
    };

    /* ================================================== per-frame update */
    var tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
    var hlPulse = 0;
    var curLights = { nav: false, beacon: false, strobe: false, landing: false, taxi: false };
    var noseRollAngle = 0, mainRollAngle = 0;
    function k(dt, tau) { return 1 - Math.exp(-dt / tau); }

    function update(state, dt) {
      dt = clamp(num(dt, 0), 0, 0.1);
      clock += dt;
      state = state || {};
      var P = poseTmp;
      var playing = !!anim.name;
      var caption = '';
      var air = state.air || {};

      // ----- choose the pose: animation or state
      var target = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, trimTab: 0, flaps: 0, pitch: 0, bank: 0, yaw: 0, nose: 0, rpm: 0 };
      var lightsOn = curLights, ground = true, arrowsV = { roll: 0, pitch: 0, yaw: 0 }, emph = null, dusk = 0;
      var doorTargets = { doorL: 0, doorR: 0, windowL: 0 };
      if (playing) {
        var A = ANIMS[anim.name];
        anim.t += dt;
        if (anim.t >= A.dur) {
          if (anim.loop) anim.t %= A.dur;
          else { stop(); return update(state, 0); }
        }
        var fresh = P0();
        for (var key in fresh) P[key] = fresh[key];
        P.forceFocus = null; P.aoa = null; P.viewKeys = null; P.ice = 0; P.heat = 0; P.carbRpm = 0; P.lightText = null;
        P.pitotFlow = 0; P.staticFlow = 0; P.yawRate = 0; P.brakeSide = 0; P.highlightCarb = false;
        A.frame(anim.t, P);
        var ail = clamp(P.ail, -1, 1), ec = clamp(P.elevCmd, -1, 1);
        target.aileronL = ail < 0 ? 20 * ail : 14 * ail;
        target.aileronR = ail < 0 ? -14 * ail : -20 * ail;
        target.elevator = P.rawElev !== null ? P.rawElev : (ec > 0 ? -25 * ec : -15 * ec);
        target.rudder = 23 * clamp(P.rudCmd, -1, 1);
        target.trimTab = P.rawTab !== null ? P.rawTab : 0;
        target.flaps = P.flaps; target.pitch = P.pitch; target.bank = P.bank; target.yaw = P.yaw;
        target.nose = P.nose || 8.5 * clamp(P.rudCmd, -1, 1) * (P.ground ? 1 : 0);
        if (P.nose) target.nose = P.nose;
        target.rpm = P.rpm;
        lightsOn = P.lights; ground = P.ground; arrowsV = P.arrows; emph = P.emph; dusk = P.dusk;
        caption = P.caption;
        if (P.viewKeys) {
          var vk = stepKeys(anim.t, P.viewKeys);
          if (vk !== anim.lastViewKey) { anim.lastViewKey = vk; setView(vk); }
        }
      } else {
        var sf = state.surfaces;
        if (!sf || !isFinite(sf.aileronL)) sf = surfacesFromInputs(state, surfTmp);
        target.aileronL = num(sf.aileronL, 0); target.aileronR = num(sf.aileronR, 0);
        target.elevator = num(sf.elevator, 0); target.rudder = num(sf.rudder, 0);
        target.trimTab = num(sf.trimTab, 0); target.flaps = num(sf.flaps, num(state.flaps, 0));
        ground = air.onGround !== false;
        if (ext.followAttitude && !ground) { target.pitch = num(air.pitch, 0); target.bank = num(air.bank, 0); }
        target.nose = num(state.noseWheelAngle, 0);
        target.rpm = num(state.propRpm, 0);
        var powered = !state.elec || num(state.elec.busVolts, 12) > 8;
        var L = state.lights || {};
        curLights.nav = powered && !!L.nav; curLights.beacon = powered && !!L.beacon; curLights.strobe = powered && !!L.strobe;
        curLights.landing = powered && !!L.landing; curLights.taxi = powered && !!L.taxi;
        lightsOn = curLights;
        doorTargets.doorL = state.doorLeftOpen ? 1 : 0; doorTargets.doorR = state.doorRightOpen ? 1 : 0;
        doorTargets.windowL = state.windowLeftOpen ? 1 : 0;
        arrowsV = {
          roll: Math.abs(num(state.yokeRoll, 0)) > 0.1 && !state.controlLock ? num(state.yokeRoll, 0) : 0,
          pitch: Math.abs(num(state.yokePitch, 0)) > 0.1 && !state.controlLock ? num(state.yokePitch, 0) : 0,
          yaw: Math.abs(num(state.rudder, 0)) > 0.1 ? num(state.rudder, 0) : 0
        };
        updateTracking(state);
        caption = stateCaption(state);
      }
      ext.caption = caption;

      // ----- smoothing
      var ks = k(dt, 0.07), ka = k(dt, 0.18), kd = k(dt, 0.35);
      disp.aileronL += (target.aileronL - disp.aileronL) * ks;
      disp.aileronR += (target.aileronR - disp.aileronR) * ks;
      disp.elevator += (target.elevator - disp.elevator) * ks;
      disp.rudder += (target.rudder - disp.rudder) * ks;
      disp.trimTab += (target.trimTab - disp.trimTab) * ks;
      disp.flaps += (target.flaps - disp.flaps) * k(dt, 0.12);
      disp.nose += (target.nose - disp.nose) * ks;
      disp.pitch += (target.pitch - disp.pitch) * ka;
      disp.bank += (target.bank - disp.bank) * ka;
      disp.yaw += (target.yaw - disp.yaw) * ka;
      disp.stance += ((ground ? STANCE : 0) - disp.stance) * ka;
      disp.doorL += (doorTargets.doorL - disp.doorL) * kd;
      disp.doorR += (doorTargets.doorR - disp.doorR) * kd;
      disp.windowL += (doorTargets.windowL - disp.windowL) * kd;
      disp.dusk += (dusk - disp.dusk) * k(dt, 0.4);
      if (dt === 0) {   // first frame / after stop: snap
        disp.stance = ground ? STANCE : 0;
      }

      // ----- apply surfaces
      surfaces.aileronL.quaternion.setFromAxisAngle(surfaces.aileronL.userData.axis, disp.aileronL * DEG);
      surfaces.aileronR.quaternion.setFromAxisAngle(surfaces.aileronR.userData.axis, disp.aileronR * DEG);
      surfaces.elevator.quaternion.setFromAxisAngle(surfaces.elevator.userData.axis, disp.elevator * DEG);
      surfaces.trimTab.quaternion.setFromAxisAngle(surfaces.trimTab.userData.axis, disp.trimTab * DEG);
      surfaces.rudder.quaternion.setFromAxisAngle(surfaces.rudder.userData.axis, disp.rudder * DEG);
      ['flapL', 'flapR'].forEach(function (id) {
        var fp = surfaces[id];
        if (!fp.userData.base) fp.userData.base = fp.position.clone();
        fp.quaternion.setFromAxisAngle(fp.userData.axis, disp.flaps * DEG);
        fp.position.copy(fp.userData.base);
        fp.position.z += 0.05 * disp.flaps / 40;
        fp.position.y -= 0.01 * disp.flaps / 40;
      });
      wheels.nose.steer.rotation.y = -disp.nose * DEG;

      // ----- wheels roll with ground speed (or animation)
      var gsMs = playing ? (P.roll ? 1.2 : 0) : num(air.groundSpeed, 0) * 0.514444 * (ground ? 1 : 0);
      mainRollAngle -= gsMs / 0.2225 * dt;
      noseRollAngle -= gsMs / 0.18 * dt;
      wheels.main.forEach(function (w) { w.spin.rotation.x = mainRollAngle; });
      wheels.nose.spin.rotation.x = noseRollAngle;

      // ----- propeller
      var rpm = target.rpm;
      var visRpm = Math.min(rpm, 380);
      prop.angle -= visRpm / 60 * Math.PI * 2 * dt;
      prop.blades.rotation.z = prop.angle;
      var blur = clamp((rpm - 250) / 700, 0, 1);
      prop.disc.material.opacity = blur * 0.85;
      prop.disc.rotation.z = prop.angle * 0.3;
      prop.blades.children.forEach(function (b) {
        b.material.transparent = blur > 0.01;
        b.material.opacity = 1 - blur * 0.85;
        b.material.depthWrite = blur < 0.5;
      });

      // ----- doors
      doors.doorL.pivot.rotation.y = -disp.doorL * 62 * DEG;
      doors.doorR.pivot.rotation.y = disp.doorR * 62 * DEG;
      doors.doorL.hole.visible = disp.doorL > 0.01;
      doors.doorR.hole.visible = disp.doorR > 0.01;
      doors.doorL.winPivot.rotation.z = -disp.windowL * 28 * DEG;
      doors.doorL.winHole.visible = disp.windowL > 0.01;

      // ----- attitude
      tmpE.set((disp.pitch + disp.stance) * DEG, -disp.yaw * DEG, -disp.bank * DEG, 'YXZ');
      attitude.quaternion.setFromEuler(tmpE);
      var airborneVis = 1 - clamp(disp.stance / STANCE, 0, 1);
      var groundVis = 1 - airborneVis;
      disk.material.opacity = groundVis;
      shadow.material.opacity = groundVis * (1 - 0.5 * disp.dusk);
      catcher.visible = shadowsOn;
      catcherMat.opacity = 0.5 * groundVis * (1 - 0.8 * disp.dusk);
      planShadow.visible = !shadowsOn;
      planShadow.material.opacity = groundVis * (1 - 0.8 * disp.dusk);
      planShadow.position.x = -sunScene.x / sunScene.y * 1.3;
      planShadow.position.z = -sunScene.z / sunScene.y * 1.3;
      groundGroup.visible = airborneVis < 0.99;
      horizonRing.visible = airborneVis > 0.02;
      horizonRing.children.forEach(function (c) { c.material.opacity = (c.isLine ? 0.55 : 0.12) * airborneVis; });

      // ----- lights
      var blink = clock % 1.0;
      var beaconOn = lightsOn.beacon && (blink < 0.12 || (blink > 0.5 && blink < 0.58));
      var sp = clock % 1.3;
      var strobeOn = lightsOn.strobe && (sp < 0.05 || (sp > 0.12 && sp < 0.16));
      setLight(lights.navL.mesh, glows.navL, lightsOn.nav, 0xff2a1a, 1);
      setLight(lights.navR.mesh, glows.navR, lightsOn.nav, 0x22ff55, 1);
      setLight(lights.tail.mesh, glows.tail, lightsOn.nav, 0xffffff, 1);
      setLight(lights.beacon.mesh, glows.beacon, beaconOn, 0xff2210, 1);
      setLight(lights.strobeL.mesh, glows.strobeL, strobeOn, 0xffffff, 1);
      setLight(lights.strobeR.mesh, glows.strobeR, strobeOn, 0xffffff, 1);
      var landOn = lightsOn.landing || lightsOn.taxi;
      setLight(lights.landingLens, glows.landing, landOn, 0xfff2cc, 1);
      beam.material.opacity += ((landOn ? 0.08 + 0.1 * disp.dusk : 0) - beam.material.opacity) * k(dt, 0.15);
      beam.visible = beam.material.opacity > 0.003;

      // ----- dusk (lights demo)
      var dk = disp.dusk;
      ['uTop', 'uMid', 'uBottom'].forEach(function (u, i) { skyMat.uniforms[u].value.copy(SKY_DAY[i]).lerp(SKY_DUSK[i], dk); });
      hemi.intensity = (1 - 0.6 * dk) * LIGHTS.hemi; sun.intensity = (1 - 0.85 * dk) * LIGHTS.key;
      skyMat.uniforms.uGlowAmt.value = 1 - dk;
      diskMat.color.setScalar(1 - 0.65 * dk);
      setEnvDim(1 - 0.78 * dk);   // the studio reflections dim with the light (paint, glass, metal)

      // ----- key light = world sun (turns with the heading), camera-relative fill/rim, shadow map refresh
      aimKey(air.heading);
      aimCameraLights(dk);
      refreshShadow(blur);

      // ----- arrows
      setArrow('roll', arrowsV.roll); setArrow('pitch', arrowsV.pitch); setArrow('yaw', arrowsV.yaw);

      // ----- highlights (user + animation emphasis)
      hlPulse += dt;
      var want = {};
      userHighlight.forEach(function (id) { want[id] = 1; });
      if (emph) emph.forEach(function (id) { want[id] = 1; });
      if (playing && P.highlightCarb) { want.carbAirInlet = 1; want.cowling = 1; }
      applyHighlight(want, playing ? P : null);

      // ----- animation overlays
      if (playing) animOverlays(P, dt);

      // ----- camera transition
      if (cam.t < 1) {
        cam.t = Math.min(1, cam.t + dt / cam.dur);
        applyCam(cam.t);
        ext.cameraBusy = cam.t < 1;
      }
    }

    function setLight(mesh, glowSprite, on, color, strength) {
      if (mesh && mesh.material) {
        mesh.material.emissive.setHex(on ? color : 0x000000);
        mesh.material.emissiveIntensity = on ? 1.4 * strength : 0;
      }
      if (glowSprite) {
        var target = on ? (0.75 + 0.25 * disp.dusk) * strength : 0;
        glowSprite.material.opacity += (target - glowSprite.material.opacity) * 0.6;
        glowSprite.visible = glowSprite.material.opacity > 0.01;
      }
    }

    var accentColor = new THREE.Color(ACCENT);
    var lastHL = {};
    function applyHighlight(want, P) {
      var pulse = 0.45 + 0.3 * Math.sin(hlPulse * 5);
      var id, i;
      for (id in lastHL) {
        if (!want[id] && parts[id]) {
          parts[id].forEach(function (m) { if (m.material.emissive) { m.material.emissive.setHex(0x000000); m.material.emissiveIntensity = 1; } });
        }
      }
      var brakeSide = P && P.brakeSide;
      for (id in want) {
        if (!parts[id]) continue;
        for (i = 0; i < parts[id].length; i++) {
          var m = parts[id][i];
          if (!m.material.emissive) continue;
          if (id === 'brakes' && brakeSide) {
            var wx = new V3(); m.getWorldPosition(wx);
            var on = (brakeSide < 0) === (m.position.x + m.parent.position.x < 0);
            if (!on) { m.material.emissive.setHex(0); continue; }
          }
          m.material.emissive.copy(accentColor);
          m.material.emissiveIntensity = pulse;
        }
      }
      // halos for small parts
      var n = 0;
      for (id in want) {
        if (!SMALL_PARTS[id] || !parts[id] || !parts[id].length) continue;
        var h = halos[n];
        var box = new THREE.Box3();
        parts[id].forEach(function (m) {
          if (id === 'brakes' && brakeSide && (brakeSide < 0) !== (m.position.x + m.parent.position.x < 0)) return;
          box.expandByObject(m);
        });
        if (box.isEmpty()) continue;
        var len = box.getSize(new V3()).length();
        // parts split in two far-apart pieces (both brakes, both wheels) would get one giant ring centred on the
        // fuselage: the emissive glow alone marks them
        if (len > 1.2) continue;
        if (!h) {
          h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthTest: false, depthWrite: false }));
          h.renderOrder = 28; scene.add(h); halos.push(h);
        }
        box.getCenter(h.position);
        var sz = clamp(len * 1.2, 0.22, 0.7);
        var sc = sz * (1 + 0.12 * Math.sin(hlPulse * 5));
        h.scale.set(sc, sc, 1);
        h.visible = true;
        n++;
      }
      for (; n < halos.length; n++) halos[n].visible = false;
      lastHL = want;
    }

    /* --------------------------------------------- animation overlay logic */
    var activeOverlays = [];
    function showOverlays(names) {
      activeOverlays.forEach(function (o) {
        o.visible = false;
        if (o.userData && o.userData.wind) o.userData.wind.group.visible = false;
      });
      activeOverlays = [];
      (names || []).forEach(function (nm) {
        var o = getOverlay(nm);
        if (!o) return;
        o.visible = true;
        if (o.userData && o.userData.wind) o.userData.wind.group.visible = true;
        activeOverlays.push(o);
      });
    }
    var _w = new V3(), _m4 = new THREE.Matrix4();
    function animOverlays(P, dt) {
      var t = anim.t;
      if (P.forceFocus && ov.forces) {
        var items = ov.forces.userData.items;
        Object.keys(items).forEach(function (kk) {
          var it = items[kk], on = P.forceFocus === 'all' || P.forceFocus === kk;
          var pulse = P.forceFocus === kk ? 1 + 0.12 * Math.sin(t * 7) : 1;
          setArrowLength(it.arrow, it.len * pulse);
          it.arrow.userData.mat.opacity = on ? 0.95 : 0.18;
          it.arrow.userData.outlineMat.opacity = on ? 0.38 : 0.06;
          it.label.material.opacity = on ? 1 : 0.25;
        });
      }
      if (ov.flapLabel && ov.flapLabel.visible) setLabelText(ov.flapLabel, 'Flaps ' + Math.round(disp.flaps / 5) * 5 + '°');
      if (ov.rpmLabel && ov.rpmLabel.visible) setLabelText(ov.rpmLabel, 'RPM ' + Math.round(P.rpm / 50) * 50);
      if (ov.lightLabel && ov.lightLabel.visible) {
        ov.lightLabel.material.opacity = P.lightText ? 1 : 0;
        if (P.lightText) {
          setLabelText(ov.lightLabel, P.lightText);
          // single lights get the label next to them (overlay frame = model frame − CG); the wingtip pairs keep
          // the title spot above the airplane
          var llp = ov.lightLabel.position;
          if (/Baliza/.test(P.lightText) && lights.beacon) llp.set(lights.beacon.pos.x - CG.x, lights.beacon.pos.y - CG.y + 0.45, lights.beacon.pos.z - CG.z);
          else if (/aterrizaje/.test(P.lightText)) llp.set(-0.6 - CG.x, 0.15 - CG.y, Z_NOSE - 0.3 - CG.z);
          else llp.set(0, 2.2, 0);
        }
      }
      if (ov.carb && ov.carb.visible) {
        drawCarb(P.ice, P.heat, P.carbRpm, t);
        ov.carb.userData.sprite.material.map.needsUpdate = true;
      }
      if (ov.aoa && ov.aoa.visible) aoaFrame(P, t);
      if (ov.pitot && ov.pitot.visible) pitotFrame(P, t);
      if (ov.brakeLabel) ov.brakeLabel.visible = false;
    }

    function aoaFrame(P, t) {
      var o = ov.aoa, f = o.userData.foil, W = o.userData.wind;
      var alpha = num(P.aoa, disp.pitch);
      var a = disp.pitch;   // displayed pitch = angle between the wing chord (pitch) and the horizontal wind
      setLabelText(W.aLab, 'Ángulo de ataque: ' + Math.round(a) + '°');
      var stall = clamp((a - 15.5) / 2.5, 0, 1);
      W.stallLab.material.opacity = stall;
      W.stallLab.visible = stall > 0.02;
      // airfoil outline in the wind (scene) frame
      attitude.updateMatrixWorld(true);
      f.group.updateMatrixWorld(true);
      var pts = f.outline, c = f.chord, n = pts.length;
      var upper = [], lower = [];
      for (var i = 0; i < n; i++) {
        _w.set(pts[i][0] * c, pts[i][1] * c, 0).applyMatrix4(f.group.matrixWorld);
        var rec = [_w.z, _w.y];
        if (i <= (n - 1) / 2) lower.push(rec); else upper.push(rec);
      }
      lower.reverse();   // both from LE to TE
      var le = upper[0], te = upper[upper.length - 1];
      var X = f.X - 0.06;
      // angle arc between chord direction and wind (horizontal) at the LE
      var arcPos = W.arc.geometry.attributes.position;
      var R = 0.75;
      for (var q = 0; q <= 32; q++) {
        var ang = -(a * DEG) * q / 32;
        arcPos.setXYZ(q, X, le[1] + Math.sin(-ang) * R * 0 + Math.sin(a * DEG * q / 32) * -R, le[0] - Math.cos(a * DEG * q / 32) * R);
      }
      arcPos.needsUpdate = true;
      W.aLab.position.set(X, le[1] - R - 0.25, le[0] - 0.6);
      // streamlines
      var offs = [0.07, 0.2, 0.4, -0.07, -0.2, -0.4];
      var NP = W.NP;
      W.paths = W.paths || [];
      for (var L = 0; L < W.NL; L++) {
        var h = offs[L], surfLine = h > 0 ? upper : lower;
        var path = W.paths[L] || (W.paths[L] = new Float32Array(NP * 2));
        var nUp = 22, nOver = 26, nDown = NP - nUp - nOver;
        var yLE = le[1] + h * (h > 0 ? 1 : 1.1);
        var upwash = (a * DEG) * 0.55 * (h > 0 ? 1 : 0.8);
        for (var u = 0; u < nUp; u++) {
          var s = u / nUp;
          var z = le[0] - 2.4 + 2.4 * s;
          path[u * 2] = z; path[u * 2 + 1] = yLE - upwash * (1 - smooth(s)) * 1.2;
        }
        var sepIdx = Math.floor(surfLine.length * 0.28);
        var sepPoint = surfLine[sepIdx];
        for (var v = 0; v < nOver; v++) {
          var sv = v / (nOver - 1);
          var idx = Math.min(surfLine.length - 1, Math.round(sv * (surfLine.length - 1)));
          var pz = surfLine[idx][0], py = surfLine[idx][1] + h * (1 - 0.25 * sv);
          if (h > 0 && h < 0.3 && stall > 0 && idx > sepIdx) {
            // separated: keeps going straight from the separation point, with turbulence below
            var dz = pz - sepPoint[0];
            var straight = sepPoint[1] + h + dz * Math.tan(Math.min(a, 20) * DEG) * 0.55;
            py = lerp(py, straight + Math.sin(t * 9 + v) * 0.03 * stall, stall);
          }
          path[(nUp + v) * 2] = pz; path[(nUp + v) * 2 + 1] = py;
        }
        var lastZ = path[(nUp + nOver - 1) * 2], lastY = path[(nUp + nOver - 1) * 2 + 1];
        var down = (a * DEG) * 0.6;
        for (var w = 0; w < nDown; w++) {
          var sw = (w + 1) / nDown;
          path[(nUp + nOver + w) * 2] = lastZ + 2.2 * sw;
          path[(nUp + nOver + w) * 2 + 1] = lastY - down * Math.sin(sw * Math.PI / 2) * 0.8 + (h > 0 && h < 0.3 ? Math.sin(t * 7 + w) * 0.05 * stall : 0);
        }
        var lp = W.lines[L].geometry.attributes.position;
        for (var pnt = 0; pnt < NP; pnt++) lp.setXYZ(pnt, X, path[pnt * 2 + 1], path[pnt * 2]);
        lp.needsUpdate = true;
        W.lines[L].material.color.setHex(h > 0 && h < 0.3 && stall > 0.3 ? 0xB5476B : 0x2F6FA8);
      }
      // particles flowing along the paths
      var dp = W.dots.geometry.attributes.position, perLine = 12;
      for (var L2 = 0; L2 < W.NL; L2++) {
        var pth = W.paths[L2];
        for (var d = 0; d < perLine; d++) {
          var ph = (t * 0.32 + d / perLine) % 1;
          var fi = ph * (NP - 1), i0 = Math.floor(fi), fr = fi - i0, i1 = Math.min(NP - 1, i0 + 1);
          var yy = lerp(pth[i0 * 2 + 1], pth[i1 * 2 + 1], fr), zz = lerp(pth[i0 * 2], pth[i1 * 2], fr);
          if (offs[L2] > 0 && offs[L2] < 0.3 && stall > 0 && i0 > 30) { yy += (Math.sin(t * 13 + d * 2.1) * 0.06) * stall; }
          dp.setXYZ(L2 * perLine + d, X - 0.01, yy, zz);
        }
      }
      dp.needsUpdate = true;
      // swirls in the separated zone
      W.swirl.forEach(function (sw2, si) {
        sw2.material.opacity = 0.85 * stall;
        sw2.visible = stall > 0.02;
        var fr2 = 0.45 + si * 0.2;
        var id2 = Math.min(upper.length - 1, Math.floor(upper.length * fr2));
        sw2.position.set(X - 0.02, upper[id2][1] + 0.1 + si * 0.02, upper[id2][0] + 0.1);
        sw2.rotation.x = t * (3 + si);
      });
      // wind arrows ahead of the wing
      W.arrows.forEach(function (ar, ai) { ar.position.set(X, le[1] + (ai - 1) * 0.4 - 0.1, le[0] - 3.0 + ((t * 0.8 + ai * 0.3) % 1) * 0.3); });
    }

    function pitotFrame(P, t) {
      var o = ov.pitot.userData, pos = o.pts.geometry.attributes.position;
      for (var i = 0; i < o.N; i++) {
        var ph = (t * 0.6 + i / o.N) % 1;
        if (P.pitotFlow && i < o.N / 2) {
          var lane = (i % 5 - 2) * 0.012;
          pos.setXYZ(i, o.tip.x + lane, o.tip.y + ((i * 7) % 5 - 2) * 0.012, o.tip.z - 1.2 + ph * 1.2);
        } else if (P.staticFlow && i >= o.N / 2) {
          var j = i - o.N / 2, lz = ((j * 13) % 7 - 3) * 0.05;
          pos.setXYZ(i, o.sp.x - 0.035 - (j % 3) * 0.02, o.sp.y + lz, o.sp.z - 1.0 + ph * 2.0);
        } else pos.setXYZ(i, 0, -50, 0);
      }
      pos.needsUpdate = true;
      o.lp.visible = !!P.pitotFlow; o.ls.visible = !!P.staticFlow;
      ov.pitot.children.forEach(function (c) { if (c.isLine) c.visible = true; });
      ov.pitot.children[2].visible = !!P.pitotFlow;
      ov.pitot.children[4].visible = !!P.staticFlow;
    }

    /* ============================================================ PUBLIC */
    function play(name, opts) {
      if (!ANIMS[name]) return false;
      if (!anim.name) anim.prevView = cam.view;
      anim.name = name; anim.t = 0; anim.loop = !!(opts && opts.loop); anim.lastViewKey = null;
      ext.playing = name;
      showOverlays(ANIMS[name].overlays);
      setView(ANIMS[name].view);
      return true;
    }
    function stop() {
      if (!anim.name) return;
      anim.name = null;
      ext.playing = null;
      showOverlays([]);
      if (anim.prevView) setView(anim.prevView);
    }
    function setHighlight(ids) {
      userHighlight = (ids || []).filter(function (id) { return !!parts[id]; });
    }
    function showLabels(v) {
      var list = Array.isArray(v) ? v : null;
      labelGroup.visible = !!v;
      Object.keys(partLabels).forEach(function (id) {
        var want = !list || list.indexOf(id) >= 0;
        partLabels[id].userData.want = want;   // labelBudget() may still hide it on a small viewport
        partLabels[id].visible = want;
      });
      ext.labelsVisible = !!v;
    }
    function setSize(w, h) {
      if (!(w > 0 && h > 0)) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      viewH = h;
      labelPx = clamp(h * 0.05, 13, 19);
      allLabels.forEach(scaleLabel);
    }
    function redrawText() {
      drawPaint(); paintTex.needsUpdate = true;
      allLabels.forEach(function (sp) { var tx = sp.userData.text; sp.userData.text = null; setLabelText(sp, tx); });
    }
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(redrawText);

    ext.scene = scene;
    ext.camera = camera;
    ext.root = rootGroup;
    ext.target = target;
    ext.cameraBusy = false;
    ext.followAttitude = true;
    ext.playing = null;
    ext.caption = '';
    ext.view = 'rear34';
    ext.labelsVisible = false;
    ext.update = update;
    ext.play = play;
    ext.stop = stop;
    ext.setHighlight = setHighlight;
    ext.setView = function (name) { return setView(name, false); };
    ext.showLabels = showLabels;
    ext.setSize = setSize;
    /** World sun direction (world frame, e.g. world.sunDirection): the key light follows it, turned by the heading. */
    ext.setSun = function (dirWorld) {
      if (!dirWorld || !(dirWorld.lengthSq && dirWorld.lengthSq() > 0.01)) return false;
      sunWorld.copy(dirWorld).normalize();
      lastHeading = null;
      return true;
    };
    ext.keyLight = sun;
    /**
     * A screen rectangle drawn over the exterior main view (core's cockpit inset), in CSS px of a vw × vh viewport,
     * or null. Floating labels and the carb panel keep clear of it.
     */
    ext.setOccluder = function (r) {
      if (!r || !(r.vw > 0 && r.vh > 0)) { occluder = null; return; }
      var pad = 6;
      occluder = { vw: r.vw, vh: r.vh, ndc: {
        l: (r.x - pad) / r.vw * 2 - 1, b: 1 - (r.y + r.h + pad) / r.vh * 2,
        w: (r.w + 2 * pad) / r.vw * 2, h: (r.h + 2 * pad) / r.vh * 2 } };
    };
    ext.VIEWS = PUBLIC_VIEWS.slice();
    ext.ANIMATIONS = ANIM_NAMES.slice();
    ext.PARTS = PART_IDS.slice();
    ext._parts = parts;
    setView('rear34', true);
    update({}, 0);
    return ext;
  }

  var lights = {};
  var geoRefs = {};
  C150.Exterior = { create: create, VIEWS: PUBLIC_VIEWS, ANIMATIONS: ANIM_NAMES, PARTS: PART_IDS };
})(root.C150);
