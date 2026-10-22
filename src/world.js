var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * world.js: C150.World, the scenery seen through the windshield (sky, Uruguayan countryside, practice airfield).
 *
 *   var world = C150.World.create(THREE);  scene.add(world.group);
 *   world.update(state, dt);               // every frame, after C150.Sim.step
 *   world.setQuality('low' | 'medium' | 'high')   (also 0 | 1 | 2)
 *
 * The cockpit stays fixed at the origin (floor y = 0, nose toward -Z). update() sets
 *   world.group.matrix = inverse( T(pos.x, hAGL + 0.65, pos.z) · R_y(-heading) · R_x(pitch) · R_z(-bank) )
 * so the cabin floor sits 0.65 m above the ground when on the ground (eye at y 0.88 ≈ 1.53 m AGL).
 * World frame (contract §9): north = -Z, east = +X, y up, ground y = 0 at field elevation.
 *
 * Design decisions (where the contract leaves room):
 *  - Everything here is UNLIT (MeshBasicMaterial / ShaderMaterial; lighting is baked into vertex colours and
 *    textures from world.sunDirection), so the world never depends on the lights the cockpit/core put in the scene.
 *  - Colour pipeline (core.js RENDERING NOTES): sRGB output, ColorManagement.legacyMode = false (hex colours are
 *    sRGB, stored linear), colour canvas textures tagged sRGBEncoding (the detail multiplier texture stays linear),
 *    baked vertex colours are computed in sRGB and stored linear (lin()), every material has toneMapped = false.
 *  - Look (2nd rendering pass, "modern illustrative realism"): an analytic sky (Rayleigh-like zenith → horizon
 *    gradient, warm circumsolar glow, soft sun disc, dithered against banding) and an AERIAL-PERSPECTIVE haze that
 *    every world material shares (exponential height fog, scale height ≈ 1.8 km, tinted warmer toward the sun).
 *    The haze colour in a direction is exactly the sky colour at the horizon in that direction, so the far ground
 *    melts into the sky with no seam. It is applied in each world shader (MeshBasic materials get it through one
 *    shared onBeforeCompile) in LINEAR space before the sRGB encoding; THREE's own fog is not used.
 *  - Ground: two rotated copies of the field patchwork blended by large-scale noise (no visible tiling from
 *    altitude), colour drift, near-eye grain, and water (river, ponds, estuary) detected in the regional map and
 *    shaded with a Fresnel sky reflection and a rippled sun glint. Airport surfaces use their own shader: matte,
 *    grainy asphalt with paving lanes, cracks, sealed joints, tyre streaks and stains (no shine), mown grass with
 *    stripes, worn paint. Soft ground shadows (trees near the field, buildings, the airplane's own wing/fuselage
 *    shadow while on or near the ground, cumulus shadows) are flat decals blended in the opaque pass.
 *  - Depth precision: the camera spans 0.03 m (cockpit) to tens of km, so coplanar ground layers would z-fight.
 *    Sky dome, ground, airport grass, pavement, markings and shadow decals therefore use depthWrite:false and
 *    renderOrder 100 … 131: they paint AFTER every normal opaque object (cockpit, hangar, trees: renderOrder < 100) in
 *    their own order, WITH the depth test, so the pixels hidden by the cabin are rejected early (big GPU saving: the
 *    cockpit covers most of the screen). Core/cockpit must keep opaque parts below renderOrder 100. Shadow decals
 *    use CustomBlending so they blend while staying in that opaque sequence; tree shadows fade out beyond ~1.6 km
 *    (depth precision). Clouds are one instanced, back-to-front sorted draw in the transparent pass.
 *  - Recommended camera for core: near 0.03, far 60000 (C150.World.NEAR / C150.World.FAR). The sky dome rescales
 *    itself to fit any camera.far. world.fog (THREE.Fog) is kept for compatibility (colour = horizon haze, range ≈
 *    the haze) but is no longer put on the scene unless world.autoFog is set to true before the first render.
 *  - The windsock streams toward 240° (light breeze from 060°, straight down runway 06): the sim has no wind.
 *  - world.createExteriorView() → {group, update(o), dispose()}: a second view of this scenery for exterior.js's 'cielo'
 *    backdrop (shared geometry/textures, own haze uniforms, its own root transform; see the function). C150.World.current
 *    = the last world created (exterior.js finds it there: core creates the world before the exterior).
 *  - Extra read-only fields: world.fog, world.sunDirection (world frame), world.getSunDirectionLocal(out)
 *    (sun direction in cockpit coordinates, handy for aiming the cockpit's directional light), world.airport.
 *  - world.setHaze(scale, instant?) → scale (0.2…2, eased ≈ 0.5 s) · world.getHaze(): density of the aerial haze. core.js
 *    asks for 0.45 (a clear, crisp day: the far fields keep their colour, so the horizon is a sharp line) while a lesson
 *    demonstration is mirrored into the cockpit, and gives 1 back afterwards. The exterior 'cielo' view shares it.
 */
(function (C150) {
  'use strict';

  var FT = 0.3048;
  var DEG = Math.PI / 180;
  var FLOOR_AGL = 0.65;           // m: cabin floor above the ground when on the wheels
  var GROUND_HALF = 45000;        // m: half size of the ground plane that follows the airplane
  var TILE = 2400;                // m: repeat of the field patchwork texture
  var REGION = 32000;             // m: side of the non-repeating regional map (rivers, coast, towns, roads)
  var COAST_Z = 9000;             // m: mean position of the coast to the south (+Z)
  var FIELD_ROT = 0.41;           // rad: the field grid is not aligned with north
  var FIELD_ROT2 = -0.23;         // rad: second patchwork copy (another cadastral district)
  var HAZE_A = 1 / 13000;         // 1/m: haze extinction at ground level
  var HAZE_B = 1 / 1800;          // 1/m: haze density falls off with height (scale height 1.8 km)
  var HAZE_FAR = 40000;           // m: beyond this everything is pure haze (ground plane edge)
  var TREE_SHADOW_FAR = 1600;     // m: tree / building shadow decals fade out by this camera distance

  var FALLBACK_AIRPORT = {
    name: 'Aeródromo de práctica', elevationFt: 100,
    runway: { heading: 60, length: 1100, width: 30, center: { x: 0, z: 0 }, numbers: ['06', '24'] },
    threshold06: { x: -476.3, z: 275.0 },
    taxiwayOffset: 90,
    apron: { x: -75.0, z: -129.9, w: 120, h: 70 },
    spots: {
      parked: { x: -75.0, z: -129.9, heading: 150 },
      runup: { x: -480.3, z: 208.0, heading: 60 },
      runway: { x: -450.3, z: 260.0, heading: 60 }
    },
    windsock: { x: 40, z: -60 }
  };

  var PAL = {
    zenith: 0x2b61ab, skyMid: 0x7ba5d3, horizon: 0xc7d4de, hazeSun: 0xeee5d3,
    sunDisc: 0xfffcf3, sunGlow: 0xffe6bf,
    water: 0x3e687e, waterDeep: 0x2f5870, shallow: 0x5c878e, sand: 0xd8caa0,
    grassAirport: 0x7c9a52, paint: 0xefefea, yellow: 0xe0b22c, shadow: 0x1a2433
  };

  /* ------------------------------------------------------------ GLSL: shared aerial-perspective haze */
  // vHazeRay = camera → fragment vector in SCENE space (cockpit frame); uSunS / uUpS = sun and ground "up" in that
  // frame (updated every frame from the airplane attitude). hazeTint() is also used by the sky at the horizon.
  var HAZE_FRAG = [
    'uniform vec3 uHazeColor; uniform vec3 uHazeSun; uniform vec3 uSunS; uniform vec3 uUpS;',
    'uniform float uHazeA; uniform float uHazeB; uniform float uEyeH; uniform float uHazeFar;',
    'varying vec3 vHazeRay;',
    'vec3 hazeTint(float s) {',
    '  s = max(s, 0.0);',
    '  return mix(uHazeColor, uHazeSun, clamp(pow(s, 5.0) * 0.72 + pow(s, 32.0) * 0.28, 0.0, 1.0));',
    '}',
    'float hazeAmount(vec3 ray, out vec3 dir) {',
    '  float d = length(ray);',
    '  dir = ray / max(d, 1e-3);',
    '  float k = dot(dir, uUpS) * uHazeB;',
    '  float t = abs(k * d) < 1e-4 ? d : (1.0 - exp(-d * k)) / k;',
    '  float f = 1.0 - exp(-uHazeA * exp(-uEyeH * uHazeB) * t);',
    '  return max(f, smoothstep(uHazeFar * 0.62, uHazeFar, d));',
    '}',
    'vec3 applyHaze(vec3 col) { vec3 dir; float f = hazeAmount(vHazeRay, dir); return mix(col, hazeTint(dot(dir, uSunS)), f); }'
  ].join('\n');
  var HAZE_VERT_PARS = 'varying vec3 vHazeRay;';
  var HAZE_VERT = 'vHazeRay = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;';

  /* ------------------------------------------------------------ small helpers */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function hash1(i, seed) {
    var x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  /** Smooth 1D value noise in [-1, 1]. */
  function noise1(x, seed) {
    var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return (hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u) * 2 - 1;
  }
  function fbm1(x, seed) {
    return noise1(x, seed) * 0.6 + noise1(x * 2.13, seed + 7) * 0.28 + noise1(x * 4.7, seed + 13) * 0.12;
  }
  function hex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }
  function smoothstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function rgba(r, g, b, a) { return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + a + ')'; }
  /** Draws fn(dx, dy) at the 9 wrap offsets so a repeating tile stays seamless. */
  function wrap9(size, fn) { for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) fn(i * size, j * size); }
  /** Per-pixel grain: luminance noise + sparse light / dark specks (aggregate). */
  function grain(g, w, h, r, amp, light, dark, tint) {
    var img = g.getImageData(0, 0, w, h), d = img.data;
    tint = tint || [1, 1, 1];
    for (var i = 0; i < d.length; i += 4) {
      var n = (r() - 0.5) * amp;
      var q = r();
      if (q < light) n += 26 + r() * 18; else if (q < light + dark) n -= 20 + r() * 14;
      d[i] += n * tint[0]; d[i + 1] += n * tint[1]; d[i + 2] += n * tint[2];
    }
    g.putImageData(img, 0, 0);
  }
  /** Soft blob drawn through a far-offset shadow (blurred edges in every browser). */
  function softFill(g, blur, color, draw) {
    g.save();
    g.shadowColor = color; g.shadowBlur = blur; g.shadowOffsetX = 10000; g.shadowOffsetY = 0;
    g.translate(-10000, 0);
    g.fillStyle = '#000';
    draw(g);
    g.restore();
  }

  /* ======================================================================== */
  function create(THREE) {
    var A = (C150.Sim && C150.Sim.AIRPORT) || FALLBACK_AIRPORT;
    var rwHead = A.runway.heading * DEG;
    var rwC = A.runway.center;
    var halfLen = A.runway.length / 2, halfW = A.runway.width / 2;
    var twyOff = A.taxiwayOffset || 90;

    var group = new THREE.Group();
    group.name = 'world';
    group.matrixAutoUpdate = false;

    // mid-morning sun (Uruguay, summer): low enough to shine in under the high wing through the windshield, so the
    // cabin shows soft sun patches and shadows (from the parked spot it comes from ahead-left, on runway 06 ahead-right)
    var sunAz = 105 * DEG, sunEl = 32 * DEG;
    var SUN = new THREE.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl)).normalize();
    var SHADOW_DIR = new THREE.Vector2(-SUN.x / SUN.y, -SUN.z / SUN.y);   // ground offset of a shadow per metre of height

    var fog = new THREE.Fog(PAL.horizon, 3000, 30000);   // compatibility only (see header)
    var rnd = mulberry32(150);
    var maxAniso = 8;

    /* -------------------------------------------- shared haze uniforms + material helpers */
    var hazeU = {
      uHazeColor: { value: new THREE.Color(PAL.horizon) },
      uHazeSun: { value: new THREE.Color(PAL.hazeSun) },
      uSunS: { value: SUN.clone() },
      uUpS: { value: new THREE.Vector3(0, 1, 0) },
      uHazeA: { value: HAZE_A }, uHazeB: { value: HAZE_B }, uEyeH: { value: 1.5 }, uHazeFar: { value: HAZE_FAR }
    };
    function withHaze(u) { for (var k in hazeU) u[k] = hazeU[k]; return u; }
    function injectVert(src) {
      return src.replace('#include <common>', '#include <common>\n' + HAZE_VERT_PARS)
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + HAZE_VERT);
    }
    /** MeshBasicMaterial → aerial perspective mixed into the colour (linear, before encoding). */
    function hazeCompile(shader) {
      withHaze(shader.uniforms);
      shader.vertexShader = injectVert(shader.vertexShader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + HAZE_FRAG)
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = applyHaze(gl_FragColor.rgb);\n#include <tonemapping_fragment>');
    }
    /** Shadow decals: the haze (and distance, for depth-precision reasons) fades their opacity instead. */
    function hazeDecalCompile(shader) {
      withHaze(shader.uniforms);
      shader.uniforms.uDecalFar = decalFarU;
      shader.vertexShader = injectVert(shader.vertexShader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDecalFar;\n' + HAZE_FRAG)
        .replace('#include <tonemapping_fragment>', '{ vec3 hd; float hf = hazeAmount(vHazeRay, hd);\n' +
          '  gl_FragColor.a *= (1.0 - hf) * (1.0 - smoothstep(uDecalFar * 0.7, uDecalFar, length(vHazeRay))); }\n#include <tonemapping_fragment>');
    }
    var decalFarU = { value: TREE_SHADOW_FAR };
    function basic(params) {
      var m = new THREE.MeshBasicMaterial(params);
      m.fog = false;
      m.onBeforeCompile = hazeCompile;
      return m;
    }
    /** Flat dark decal blended inside the opaque pass (see header). */
    function decalMat(params, far) {
      params = params || {};
      params.color = params.color != null ? params.color : PAL.shadow;
      var m = new THREE.MeshBasicMaterial(params);
      m.fog = false; m.depthWrite = false; m.transparent = false;
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
      if (far) {   // a decal with its own fade distance gets its own uniform (and program variant)
        var fu = { value: far };
        m.onBeforeCompile = function (s) { hazeDecalCompile(s); s.uniforms.uDecalFar = fu; };
        m.customProgramCacheKey = function () { return 'decal-far'; };
      } else m.onBeforeCompile = hazeDecalCompile;
      return m;
    }

    /* -------------------------------------------- baked-lighting utilities */
    /** sRGB display value (0..1, clamped) → linear, for raw vertex-colour arrays. */
    function lin(v) { v = v < 0 ? 0 : (v > 1 ? 1 : v); return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    /** Display (sRGB) components of a hex colour, without colour management. */
    function srgbOf(hex) { return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 }; }
    /**
     * Vertex colours: base colour × (cool sky ambient, brighter on up-facing faces + warm sun diffuse) × a soft
     * ambient-occlusion darkening near the ground (y below opts.aoHeight). Flat normals unless opts.keepNormals.
     */
    function bake(geo, color, sun, opts) {
      opts = opts || {};
      var g = geo.index ? geo.toNonIndexed() : geo;
      if (!opts.keepNormals) g.computeVertexNormals();
      var n = g.attributes.normal, p = g.attributes.position, cnt = n.count;
      var col = new Float32Array(cnt * 3), base = srgbOf(color);
      var amb = opts.ambient != null ? opts.ambient : 0.58, dif = opts.diffuse != null ? opts.diffuse : 0.5;
      var aoH = opts.aoHeight != null ? opts.aoHeight : 1.4, aoK = opts.ao != null ? opts.ao : 0.25;
      for (var i = 0; i < cnt; i++) {
        var nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
        var d = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
        var sky = amb * (0.84 + 0.16 * ny);
        var ao = 1 - aoK * (1 - smoothstep(0, aoH, p.getY(i)));
        col[i * 3] = lin(base.r * (sky * 0.94 + dif * d * 1.05) * ao);
        col[i * 3 + 1] = lin(base.g * (sky * 0.98 + dif * d * 1.0) * ao);
        col[i * 3 + 2] = lin(base.b * (sky * 1.07 + dif * d * 0.88) * ao);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    }
    var bakedMat = basic({ vertexColors: true });
    function bakedMesh(geo, color, sun, opts) {
      return new THREE.Mesh(bake(geo, color, sun, opts), (opts && opts.material) || bakedMat);
    }
    function layerMesh(geo, mat, order) {
      var m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      m.frustumCulled = false;
      return m;
    }
    /** Flat quads on y = 0 from rectangles [x0, z0, x1, z1] (local frame), UV = position / uvScale. */
    function rectsGeometry(rects, uvScale, y) {
      var pos = [], uv = [], idx = [];
      y = y || 0;
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i], b = i * 4;
        var x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]), z0 = Math.min(r[1], r[3]), z1 = Math.max(r[1], r[3]);
        pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
        var s = uvScale || 1;
        uv.push(x0 / s, -z0 / s, x1 / s, -z0 / s, x1 / s, -z1 / s, x0 / s, -z1 / s);
        idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    }
    function canvasTexture(c, repeat, linearData) {
      var t = new THREE.CanvasTexture(c);
      if (!linearData) t.encoding = THREE.sRGBEncoding;   // colour texture (RENDERING NOTES in core.js)
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      t.anisotropy = maxAniso;
      return t;
    }

    /* =================================================== textures (canvas) */
    /** Repeating field patchwork: natural pasture, crops with rows / contour furrows, stubble, ploughed soil,
     *  hedges and tree rows (with their shadows), ponds (tajamares), farmsteads and dirt roads. */
    function drawFieldsTile(size) {
      var c = makeCanvas(size, size), g = c.getContext('2d');
      var r = mulberry32(7);
      var NAT = 0, PAST = 1, STUB = 2, PLOW = 3, CROP = 4, DRY = 5;
      var palette = [
        ['#7a9452', 5, NAT], ['#6d8849', 4, NAT], ['#83985a', 3, NAT], ['#738f4f', 3, NAT],
        ['#8ea962', 2, PAST], ['#7da34f', 1.6, CROP], ['#6b9645', 1.2, CROP], ['#5e8a40', 0.8, CROP],
        ['#a39f66', 1.8, DRY], ['#b0a76d', 1.3, DRY],
        ['#c4b36e', 1.5, STUB], ['#bca862', 1.1, STUB], ['#cdbd83', 0.8, STUB],
        ['#8a7254', 0.9, PLOW], ['#957b5c', 0.8, PLOW], ['#7a634a', 0.5, PLOW]
      ];
      var wsum = 0; palette.forEach(function (p) { wsum += p[1]; });
      function pick() {
        var x = r() * wsum;
        for (var i = 0; i < palette.length; i++) { x -= palette[i][1]; if (x <= 0) return palette[i]; }
        return palette[0];
      }
      g.fillStyle = '#7a9452'; g.fillRect(0, 0, size, size);
      var rects = [];
      function split(x, y, w, h, depth) {
        var min = size * 0.055;
        if (depth > 4 || (w < min * 2 && h < min * 2) || (depth > 1 && r() < 0.2)) { rects.push([x, y, w, h]); return; }
        var vertical = w > h * 1.3 ? r() < 0.85 : (h > w * 1.3 ? r() < 0.15 : r() < 0.5);
        var s;
        if (vertical && w >= min * 2) {
          s = Math.round(w * (0.3 + r() * 0.4)); split(x, y, s, h, depth + 1); split(x + s, y, w - s, h, depth + 1);
        } else if (h >= min * 2) {
          s = Math.round(h * (0.3 + r() * 0.4)); split(x, y, w, s, depth + 1); split(x, y + s, w, h - s, depth + 1);
        } else rects.push([x, y, w, h]);
      }
      var n = 3, b = size / n;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) split(i * b, j * b, b, b, 0);

      rects.forEach(function (f) {
        var p = pick(), col = p[0], kind = p[2];
        var x0 = f[0], y0 = f[1], w = f[2], h = f[3];
        g.save();
        g.beginPath(); g.rect(x0, y0, w, h); g.clip();
        g.fillStyle = col; g.fillRect(x0, y0, w, h);
        // soil / moisture drift across the field
        var ang = r() * 6.283, cx = x0 + w / 2, cy = y0 + h / 2, R = Math.max(w, h) / 2;
        var lg = g.createLinearGradient(cx - Math.cos(ang) * R, cy - Math.sin(ang) * R, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
        lg.addColorStop(0, 'rgba(255,248,212,' + (0.03 + r() * 0.06).toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(32,44,18,' + (0.04 + r() * 0.07).toFixed(3) + ')');
        g.fillStyle = lg; g.fillRect(x0, y0, w, h);
        // soft internal variation (wet hollows, grazing, thinner crop)
        for (var k = 0; k < 9; k++) {
          var rr = 6 + r() * 34;
          var dark = r() < 0.55;
          var gx = x0 + r() * w, gy = y0 + r() * h;
          var rg = g.createRadialGradient(gx, gy, 0, gx, gy, rr);
          rg.addColorStop(0, dark ? 'rgba(38,58,22,0.10)' : 'rgba(250,244,200,0.09)');
          rg.addColorStop(1, dark ? 'rgba(38,58,22,0)' : 'rgba(250,244,200,0)');
          g.fillStyle = rg; g.fillRect(gx - rr, gy - rr, rr * 2, rr * 2);
        }
        if (kind === NAT || kind === DRY) {          // campo natural: tussocks and scattered shrubs (chirca)
          var nd = Math.round(w * h / (kind === NAT ? 70 : 120));
          for (var q = 0; q < nd; q++) {
            g.fillStyle = r() < 0.7 ? 'rgba(52,70,32,0.22)' : 'rgba(236,230,190,0.16)';
            g.fillRect(x0 + r() * w, y0 + r() * h, 1, 1);
          }
          if (r() < 0.4) {
            for (var q2 = 0; q2 < w * h / 900; q2++) {
              g.fillStyle = 'rgba(46,64,34,0.55)';
              g.beginPath(); g.arc(x0 + r() * w, y0 + r() * h, 0.7 + r() * 0.8, 0, 7); g.fill();
            }
          }
        } else {                                      // rows: straight, or contour furrows (curvas de nivel)
          var horiz = w > h, step = kind === CROP ? 2.1 : (kind === PLOW ? 2.4 : 3.0) + r() * 0.8;
          var contour = (kind === PLOW || kind === CROP) && r() < 0.4;
          var amp = contour ? 3 + r() * 7 : 0, wl = 50 + r() * 90, ph = r() * 6;
          var len = horiz ? w : h, across = horiz ? h : w;
          var dA = kind === PLOW ? 0.16 : 0.10, lA = kind === STUB ? 0.13 : 0.08;
          g.lineWidth = 1;
          for (var s2 = -amp; s2 < across + amp; s2 += step) {
            g.strokeStyle = ((s2 / step) | 0) % 2 ? 'rgba(30,26,14,' + dA + ')' : 'rgba(255,250,225,' + lA + ')';
            g.beginPath();
            for (var t = 0; t <= len; t += 6) {
              var o = s2 + amp * Math.sin(t / wl * 6.283 + ph + s2 * 0.004);
              if (horiz) g.lineTo(x0 + t, y0 + o); else g.lineTo(x0 + o, y0 + t);
            }
            g.stroke();
          }
          if (kind === STUB && r() < 0.5) {           // straw windrows
            g.strokeStyle = 'rgba(244,232,180,0.18)'; g.lineWidth = 1.4;
            for (var s3 = 4; s3 < across; s3 += 9) {
              g.beginPath();
              if (horiz) { g.moveTo(x0, y0 + s3); g.lineTo(x0 + w, y0 + s3); } else { g.moveTo(x0 + s3, y0); g.lineTo(x0 + s3, y0 + h); }
              g.stroke();
            }
          }
        }
        g.restore();
      });
      // borders: wire fences, hedges and tree rows (each row casts a short shadow toward the west-north-west)
      rects.forEach(function (f) {
        g.strokeStyle = 'rgba(64,74,44,0.32)'; g.lineWidth = 1;
        g.strokeRect(f[0] + 0.5, f[1] + 0.5, f[2] - 1, f[3] - 1);
        if (r() < 0.28) {
          var alongX = r() < 0.5, len = alongX ? f[2] : f[3], side = r() < 0.5 ? 0 : 1;
          var pts = [];
          for (var t = 0; t < len; t += 2.4 + r() * 2.2) {
            pts.push([alongX ? f[0] + t : f[0] + side * f[3] * 0 + (side ? f[2] : 0), alongX ? f[1] + (side ? f[3] : 0) : f[1] + t, 1.3 + r() * 1.2]);
          }
          g.fillStyle = 'rgba(20,30,24,0.28)';
          pts.forEach(function (q) { g.beginPath(); g.arc(q[0] - 1.6, q[1] - 0.6, q[2] * 1.1, 0, 7); g.fill(); });
          pts.forEach(function (q) {
            g.fillStyle = 'rgba(40,60,34,0.95)'; g.beginPath(); g.arc(q[0], q[1], q[2], 0, 7); g.fill();
            g.fillStyle = 'rgba(96,122,70,0.5)'; g.beginPath(); g.arc(q[0] + 0.4, q[1] + 0.3, q[2] * 0.45, 0, 7); g.fill();
          });
        }
      });
      // ponds (tajamares) with a green rim, farmsteads with their tree clumps
      for (var pnd = 0; pnd < 7; pnd++) {
        var px2 = 30 + r() * (size - 60), py2 = 30 + r() * (size - 60), ra = r() * 3;
        g.fillStyle = 'rgba(58,82,44,0.55)'; g.beginPath(); g.ellipse(px2, py2, 9, 6.5, ra, 0, Math.PI * 2); g.fill();
        g.fillStyle = hex(PAL.water); g.beginPath(); g.ellipse(px2, py2, 6, 4.2, ra, 0, Math.PI * 2); g.fill();
      }
      for (var fm = 0; fm < 6; fm++) {
        var fx = 30 + r() * (size - 60), fy = 30 + r() * (size - 60);
        for (var e = 0; e < 16; e++) {
          var ex = fx + (r() - 0.5) * 28, ey = fy + (r() - 0.5) * 24, er = 1.8 + r() * 2.4;
          g.fillStyle = 'rgba(18,28,20,0.3)'; g.beginPath(); g.arc(ex - 1.5, ey - 0.5, er, 0, 7); g.fill();
          g.fillStyle = 'rgba(38,58,32,0.92)'; g.beginPath(); g.arc(ex, ey, er, 0, 7); g.fill();
        }
        g.fillStyle = '#ece8dc'; g.fillRect(fx - 2, fy - 1.5, 4.5, 3);
        g.fillStyle = '#a5503a'; g.fillRect(fx - 2, fy - 1.5, 4.5, 1.2);
        g.fillStyle = '#a7aba8'; g.fillRect(fx + 4, fy + 2, 4, 2.6);
      }
      // dirt roads on the block grid (drawn on both edges so the tile wraps cleanly)
      g.strokeStyle = 'rgba(150,128,96,0.55)'; g.lineWidth = 3.2;
      g.beginPath();
      [0, size].forEach(function (v) { g.moveTo(v, 0); g.lineTo(v, size); g.moveTo(0, v); g.lineTo(size, v); });
      g.moveTo(b * 2, 0); g.lineTo(b * 2, size);
      g.stroke();
      g.strokeStyle = 'rgba(206,186,148,0.95)'; g.lineWidth = 2;
      g.stroke();
      grain(g, size, size, r, 9, 0, 0, [1, 1, 0.75]);
      return c;
    }

    /** Detail noise: R = fine grain (near the eye), G = soft blotches (large-scale colour variation). */
    function drawDetail(size) {
      var c = makeCanvas(size, size), g = c.getContext('2d');
      var r = mulberry32(31);
      var img = g.createImageData(size, size), d = img.data;
      var coarse = new Float32Array(16 * 16);
      for (var i = 0; i < coarse.length; i++) coarse[i] = r();
      function smooth(x, y) {
        var gx = x / size * 16, gy = y / size * 16, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        function at(a, b2) { return coarse[((b2 & 15) * 16) + (a & 15)]; }
        return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
      }
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var o = (y * size + x) * 4;
          var fine = 0.5 + (r() - 0.5) * 0.55 + (smooth(x * 4 % size, y * 4 % size) - 0.5) * 0.35;
          d[o] = Math.max(0, Math.min(255, fine * 255));
          d[o + 1] = smooth(x, y) * 255;
          d[o + 2] = 128; d[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      return c;
    }

    // Shared random features (used by the regional map AND by the 3D trees / farms).
    function coastZ(x) {
      var w = Math.cos(Math.min(1, Math.abs(x) / (REGION / 2)) * Math.PI / 2);
      return COAST_Z + (1300 * Math.sin(x / 3100 + 0.7) + 600 * fbm1(x / 1500, 3)) * w;
    }
    function riverX(z) { return 3300 + 900 * Math.sin(z / 2300) + 380 * Math.sin(z / 650 + 1.3) + 200 * fbm1(z / 400, 9); }
    function inAirportZone(x, z, margin) {
      var dx = x - rwC.x, dz = z - rwC.z;
      var a = dx * Math.sin(rwHead) - dz * Math.cos(rwHead);         // along runway
      var o = dx * (-Math.cos(rwHead)) + dz * (-Math.sin(rwHead));  // left offset (n = d(h-90))
      if (Math.abs(a) < halfLen + 500 + margin && o > -250 - margin && o < 420 + margin) return true;
      // approach corridors (5 km each way, ±300 m)
      if (Math.abs(a) < halfLen + 5000 && Math.abs(o) < 300 + margin) return true;
      return false;
    }
    var groves = [];
    (function makeGroves() {
      var r = mulberry32(99);
      for (var tries = 0; groves.length < 170 && tries < 2000; tries++) {
        var x = (r() - 0.5) * (REGION - 1500), z = (r() - 0.5) * (REGION - 1500);
        var w = 120 + r() * 480, h = 90 + r() * 300;
        if (z > coastZ(x) - 500) continue;
        if (inAirportZone(x, z, Math.max(w, h) * 0.6)) continue;
        if (Math.abs(x - riverX(z)) < 250) continue;
        if (Math.hypot(x - 6900, z + 4300) < 1300 || Math.hypot(x + 6200, z - 8300) < 1300) continue;
        groves.push({ x: x, z: z, w: w, h: h, a: FIELD_ROT + (r() - 0.5) * 0.3 });
      }
    })();
    var farms = [];
    (function makeFarms() {
      var r = mulberry32(1234);
      for (var tries = 0; farms.length < 60 && tries < 1500; tries++) {
        var x = (r() - 0.5) * 22000, z = (r() - 0.5) * 22000;
        if (z > coastZ(x) - 300 || inAirportZone(x, z, 150) || Math.abs(x - riverX(z)) < 300) continue;
        if (Math.hypot(x - 6900, z + 4300) < 1300 || Math.hypot(x + 6200, z - 8300) < 1300) continue;
        farms.push({ x: x, z: z, a: FIELD_ROT + (r() - 0.5) * 0.4, seed: r() });
      }
    })();

    /** Non-repeating regional map: coast/estuary to the south, river with gallery forest, roads, towns, groves. */
    function drawRegion(size) {
      var c = makeCanvas(size, size), g = c.getContext('2d');
      var r = mulberry32(4242);
      var k = size / REGION;
      function X(x) { return (x / REGION + 0.5) * size; }
      function Y(z) { return (z / REGION + 0.5) * size; }
      var shX = SHADOW_DIR.x * 22 * k, shY = SHADOW_DIR.y * 22 * k;   // a 22 m canopy's shadow, in pixels
      g.lineJoin = 'round'; g.lineCap = 'round';

      // groves (eucalyptus plantations): shadow, canopy, lit crowns
      groves.forEach(function (gv) {
        var hw = gv.w * k / 2, hh = gv.h * k / 2;
        g.save(); g.translate(X(gv.x) + shX, Y(gv.z) + shY); g.rotate(-gv.a);
        g.fillStyle = 'rgba(16,26,22,0.45)'; g.fillRect(-hw, -hh, hw * 2, hh * 2);
        g.restore();
        g.save(); g.translate(X(gv.x), Y(gv.z)); g.rotate(-gv.a);
        g.fillStyle = 'rgba(46,66,48,0.97)'; g.fillRect(-hw, -hh, hw * 2, hh * 2);
        for (var i = 0; i < gv.w * gv.h / 2400; i++) {
          g.fillStyle = r() < 0.5 ? 'rgba(98,122,92,0.55)' : 'rgba(26,40,30,0.5)';
          g.fillRect(-hw + r() * hw * 2, -hh + r() * hh * 2, 1, 1);
        }
        g.restore();
      });
      // farmsteads: trees + roofs
      farms.forEach(function (f) {
        for (var i = 0; i < 6; i++) {
          var tx = X(f.x) + (r() - 0.5) * 4, ty = Y(f.z) + (r() - 0.5) * 4, tr = 1.2 + r();
          g.fillStyle = 'rgba(16,26,20,0.35)'; g.beginPath(); g.arc(tx + shX * 0.6, ty + shY * 0.6, tr, 0, 7); g.fill();
          g.fillStyle = 'rgba(38,58,34,0.92)'; g.beginPath(); g.arc(tx, ty, tr, 0, 7); g.fill();
        }
        g.fillStyle = '#ece8de'; g.fillRect(X(f.x) - 0.8, Y(f.z) - 0.6, 1.8, 1.2);
      });
      // ponds
      for (var p = 0; p < 60; p++) {
        var px = (r() - 0.5) * REGION * 0.9, pz = (r() - 0.5) * REGION * 0.9;
        if (pz > coastZ(px) - 400 || inAirportZone(px, pz, 100)) continue;
        g.fillStyle = 'rgba(60,85,50,0.7)'; g.beginPath(); g.arc(X(px), Y(pz), 3, 0, 7); g.fill();
        g.fillStyle = hex(PAL.water); g.beginPath(); g.arc(X(px), Y(pz), 1.8, 0, 7); g.fill();
      }
      // dirt roads (caminos vecinales): loose grid
      g.strokeStyle = 'rgba(184,162,124,0.85)'; g.lineWidth = 1.2;
      for (var gx = -15000; gx <= 15000; gx += 2600 + r() * 900) {
        g.beginPath();
        for (var z = -16000; z <= 16000; z += 400) {
          var xx = gx + 160 * fbm1(z / 2000, gx);
          if (z > coastZ(xx) - 150) break;
          if (inAirportZone(xx, z, 0)) { g.stroke(); g.beginPath(); continue; }
          g.lineTo(X(xx), Y(z));
        }
        g.stroke();
      }
      for (var gz = -15000; gz <= COAST_Z; gz += 2400 + r() * 1000) {
        g.beginPath();
        for (var x = -16000; x <= 16000; x += 400) {
          var zz = gz + 160 * fbm1(x / 2000, gz);
          if (zz > coastZ(x) - 150 || inAirportZone(x, zz, 0)) { g.stroke(); g.beginPath(); continue; }
          g.lineTo(X(x), Y(zz));
        }
        g.stroke();
      }
      // river with gallery forest (monte ribereño) + tributary creek
      function riverPath(z0) {
        g.beginPath();
        for (var z = z0; z <= COAST_Z + 2500; z += 100) {
          var xr = riverX(z);
          g.lineTo(X(xr), Y(z));
          if (z > coastZ(xr) + 200) break;
        }
      }
      function creekPath() {
        g.beginPath();
        for (var x = -16000; x <= 0; x += 100) {
          var t = (x + 16000) / 16000;
          var zc = -7000 + 4600 * t * t + 420 * fbm1(x / 900, 21);
          g.lineTo(X(x), Y(zc));
        }
        var zj = -2400;
        g.quadraticCurveTo(X(1600), Y(-2600), X(riverX(zj)), Y(zj));
      }
      g.save(); g.translate(shX, shY);
      g.strokeStyle = 'rgba(14,24,18,0.35)'; g.lineWidth = 16; riverPath(-16500); g.stroke();
      g.lineWidth = 10; creekPath(); g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(40,62,38,0.95)'; g.lineWidth = 15; riverPath(-16500); g.stroke();
      g.lineWidth = 9; creekPath(); g.stroke();
      g.strokeStyle = 'rgba(70,96,60,0.6)'; g.lineWidth = 6; riverPath(-16500); g.stroke();
      g.strokeStyle = hex(PAL.water); g.lineWidth = 3.6; riverPath(-16500); g.stroke();
      g.lineWidth = 1.8; creekPath(); g.stroke();

      // coast: estuary water to the south (shallow → deep), beach strip, surf line
      g.beginPath();
      g.moveTo(X(-16000), Y(16000));
      for (var cx = -16000; cx <= 16000; cx += 100) g.lineTo(X(cx), Y(coastZ(cx)));
      g.lineTo(X(16000), Y(16000)); g.closePath();
      var grad = g.createLinearGradient(0, Y(COAST_Z - 1500), 0, size);
      grad.addColorStop(0, hex(PAL.shallow)); grad.addColorStop(0.22, hex(PAL.water)); grad.addColorStop(1, hex(PAL.waterDeep));
      g.fillStyle = grad; g.fill();
      g.strokeStyle = hex(PAL.sand); g.lineWidth = 5;
      g.beginPath();
      for (var cx2 = -16000; cx2 <= 16000; cx2 += 100) g.lineTo(X(cx2), Y(coastZ(cx2)) - 1.5);
      g.stroke();
      g.strokeStyle = 'rgba(226,234,232,0.5)'; g.lineWidth = 1.2;  // surf line
      g.beginPath();
      for (var cx3 = -16000; cx3 <= 16000; cx3 += 100) g.lineTo(X(cx3), Y(coastZ(cx3)) + 2.5);
      g.stroke();

      // towns: grid of blocks (roofs, yards, street trees) clipped to a ragged ellipse
      function town(cx, cz, rx, rz, rot) {
        g.save(); g.translate(X(cx), Y(cz)); g.rotate(rot);
        var bs = 110 * k, nx = Math.ceil(rx * k / bs), nz = Math.ceil(rz * k / bs);
        for (var i = -nx; i <= nx; i++) {
          for (var j = -nz; j <= nz; j++) {
            var e = (i * bs / (rx * k)) * (i * bs / (rx * k)) + (j * bs / (rz * k)) * (j * bs / (rz * k));
            if (e > 1 - r() * 0.3) continue;
            g.fillStyle = r() < 0.15 ? 'rgba(70,100,60,0.9)' : ['#a7826c', '#b5634a', '#9d9a92', '#c2bdb2', '#8c6a58', '#b9a48e'][Math.floor(r() * 6)];
            g.fillRect(i * bs + 0.7, j * bs + 0.7, bs - 1.4, bs - 1.4);
            if (r() < 0.6) { g.fillStyle = 'rgba(56,84,48,0.7)'; g.fillRect(i * bs + bs * 0.3, j * bs + bs * 0.3, bs * 0.35, bs * 0.35); }
          }
        }
        g.restore();
      }
      town(6900, -4300, 900, 650, 0.35);
      town(-6200, 8300, 1500, 450, -0.08);
      // paved routes (drawn last: bridges cross the river)
      function route(points) {
        g.strokeStyle = 'rgba(160,156,138,0.9)'; g.lineWidth = 3.4;
        g.beginPath(); points.forEach(function (pt) { g.lineTo(X(pt[0]), Y(pt[1])); }); g.stroke();
        g.strokeStyle = '#5c5b57'; g.lineWidth = 2;
        g.beginPath(); points.forEach(function (pt) { g.lineTo(X(pt[0]), Y(pt[1])); }); g.stroke();
      }
      var rA = [], rB = [], rC = [];
      for (var ax = -16500; ax <= 16500; ax += 250) rA.push([ax, -2700 + 350 * Math.sin(ax / 3300) + 120 * fbm1(ax / 1500, 41)]);
      for (var bz = -16500; bz <= 8300; bz += 250) rB.push([-6200 + 500 * Math.sin(bz / 4100) + 120 * fbm1(bz / 1200, 43), bz]);
      for (var cx4 = -16500; cx4 <= 16500; cx4 += 250) rC.push([cx4, coastZ(cx4) - 650]);
      route(rA); route(rB); route(rC);
      route([[6900, -4300], [7600, -9000], [9800, -16500]]);
      // airfield access road from route A
      route([[-120, -240], [-260, -900], [-300, -2650]]);
      return c;
    }

    /** Runway asphalt, one 30 m × 60 m tile (u across, v along): paving lanes, aggregate grain, tyre wear,
     *  sealed cracks ("tar snakes"), transverse joints, dusty edges. Seamless along v. */
    function drawRunwayTex(W, H) {
      var c = makeCanvas(W, H), g = c.getContext('2d'), r = mulberry32(9);
      var pm = W / 30;
      g.fillStyle = '#545350'; g.fillRect(0, 0, W, H);
      for (var i = 0; i < 8; i++) {                        // paving lanes, 3.75 m
        var t = (r() - 0.5) * 0.10;
        g.fillStyle = t > 0 ? 'rgba(255,250,236,' + t.toFixed(3) + ')' : 'rgba(10,10,8,' + (-t).toFixed(3) + ')';
        g.fillRect(i * 3.75 * pm, 0, 3.75 * pm, H);
      }
      function wrapV(fn) { fn(0); fn(-H); fn(H); }
      for (var k = 0; k < 70; k++) {                       // mottling
        var x = r() * W, y = r() * H, rad = (0.8 + r() * 3) * pm, a = 0.035 + r() * 0.05, dark = r() < 0.55;
        wrapV(function (oy) {
          var rg = g.createRadialGradient(x, y + oy, 0, x, y + oy, rad);
          rg.addColorStop(0, dark ? rgba(20, 19, 17, a) : rgba(220, 214, 196, a)); rg.addColorStop(1, dark ? 'rgba(20,19,17,0)' : 'rgba(220,214,196,0)');
          g.fillStyle = rg; g.fillRect(x - rad, y + oy - rad, rad * 2, rad * 2);
        });
      }
      var cb = g.createLinearGradient(0, 0, W, 0);         // tyre-worn centre (darker, rubber)
      cb.addColorStop(0, 'rgba(18,17,15,0)'); cb.addColorStop(0.3, 'rgba(18,17,15,0.06)'); cb.addColorStop(0.5, 'rgba(18,17,15,0.13)');
      cb.addColorStop(0.7, 'rgba(18,17,15,0.06)'); cb.addColorStop(1, 'rgba(18,17,15,0)');
      g.fillStyle = cb; g.fillRect(0, 0, W, H);
      g.lineCap = 'round';
      for (var s = 0; s < 160; s++) {                      // tyre streaks along the runway
        var sx = W / 2 + ((r() + r() + r()) / 3 - 0.5) * 16 * pm, sy = r() * H, sl = (2 + r() * 16) * pm;
        var sw = 0.6 + r() * 2.2, sa = 0.04 + r() * 0.09, drift = (r() - 0.5) * 0.3 * pm;
        wrapV(function (oy) {
          g.strokeStyle = rgba(14, 13, 12, sa); g.lineWidth = sw;
          g.beginPath(); g.moveTo(sx, sy + oy); g.quadraticCurveTo(sx + drift, sy + oy + sl / 2, sx + drift * 0.4, sy + oy + sl); g.stroke();
        });
      }
      function crack(pts, w, col) {
        wrapV(function (oy) {
          g.strokeStyle = col; g.lineWidth = w;
          g.beginPath(); pts.forEach(function (q) { g.lineTo(q[0], q[1] + oy); }); g.stroke();
        });
      }
      function walk(x, y, dx, dy, n, jit) {
        var pts = [[x, y]];
        for (var q = 0; q < n; q++) { x += dx + (r() - 0.5) * jit; y += dy + (r() - 0.5) * jit; pts.push([x, y]); }
        return pts;
      }
      for (var tc = 0; tc < 5; tc++) {                     // transverse cracks, some sealed
        var ty = r() * H, x0 = r() * W * 0.5, n = 8 + Math.floor(r() * 14);
        var pts = walk(x0, ty, (W - x0) / n * (0.6 + r() * 0.4), 0, n, 6);
        if (r() < 0.6) crack(pts, 3 + r() * 2.5, 'rgba(16,16,15,0.72)');
        crack(pts, 1.1, 'rgba(10,10,9,0.8)');
      }
      for (var lc = 1; lc < 8; lc++) {                     // longitudinal cracks on the lane seams
        if (r() < 0.35) continue;
        var lx = lc * 3.75 * pm + (r() - 0.5) * 3, ly = r() * H, ln = 6 + Math.floor(r() * 18);
        var lp = walk(lx, ly, 0, (4 + r() * 6) * pm / 6, ln, 3);
        crack(lp, r() < 0.5 ? 3.2 : 1.2, r() < 0.5 ? 'rgba(16,16,15,0.7)' : 'rgba(12,12,11,0.75)');
      }
      g.fillStyle = 'rgba(16,16,15,0.35)'; g.fillRect(0, 0, W, 1.5);   // paving joint every 60 m
      var eg = g.createLinearGradient(0, 0, W, 0);         // dusty, lighter edges
      eg.addColorStop(0, 'rgba(160,150,124,0.32)'); eg.addColorStop(1.2 / 30, 'rgba(160,150,124,0)');
      eg.addColorStop(1 - 1.2 / 30, 'rgba(160,150,124,0)'); eg.addColorStop(1, 'rgba(160,150,124,0.32)');
      g.fillStyle = eg; g.fillRect(0, 0, W, H);
      grain(g, W, H, r, 22, 0.035, 0.02, [1, 0.99, 0.95]);
      return c;
    }
    /** Taxiway / apron asphalt (18 m tile): older, lighter, with repair patches, oil stains, cracks and joints. */
    function drawTaxiTex(S) {
      var c = makeCanvas(S, S), g = c.getContext('2d'), r = mulberry32(5);
      var pm = S / 18;
      g.fillStyle = '#5b5955'; g.fillRect(0, 0, S, S);
      for (var k = 0; k < 40; k++) {
        var x = r() * S, y = r() * S, rad = (0.8 + r() * 3) * pm, a = 0.04 + r() * 0.05, dark = r() < 0.5;
        wrap9(S, function (ox, oy) {
          var rg = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          rg.addColorStop(0, dark ? rgba(20, 19, 17, a) : rgba(214, 208, 190, a)); rg.addColorStop(1, dark ? 'rgba(20,19,17,0)' : 'rgba(214,208,190,0)');
          g.fillStyle = rg; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        });
      }
      for (var p = 0; p < 4; p++) {                        // repair patches
        var pw = (2 + r() * 4) * pm, ph = (1.5 + r() * 3) * pm, pxx = r() * S, pyy = r() * S, pa = 0.18 + r() * 0.15;
        wrap9(S, function (ox, oy) {
          g.fillStyle = rgba(34, 33, 31, pa); g.fillRect(pxx + ox, pyy + oy, pw, ph);
          g.strokeStyle = 'rgba(18,18,16,0.45)'; g.lineWidth = 1.5; g.strokeRect(pxx + ox, pyy + oy, pw, ph);
        });
      }
      for (var o = 0; o < 9; o++) {                        // oil / fuel stains
        var sx = r() * S, sy = r() * S, sr = (0.3 + r() * 1.1) * pm, sa = 0.12 + r() * 0.16;
        wrap9(S, function (ox, oy) {
          var rg = g.createRadialGradient(sx + ox, sy + oy, 0, sx + ox, sy + oy, sr);
          rg.addColorStop(0, rgba(22, 20, 16, sa)); rg.addColorStop(0.7, rgba(22, 20, 16, sa * 0.6)); rg.addColorStop(1, 'rgba(22,20,16,0)');
          g.fillStyle = rg; g.fillRect(sx + ox - sr, sy + oy - sr, sr * 2, sr * 2);
        });
      }
      for (var cc = 0; cc < 12; cc++) {                    // cracks
        var cx = r() * S, cy = r() * S, pts = [[cx, cy]], ang = r() * 6.283;
        for (var q = 0; q < 8; q++) { ang += (r() - 0.5) * 1.2; cx += Math.cos(ang) * 14; cy += Math.sin(ang) * 14; pts.push([cx, cy]); }
        var cw = r() < 0.3 ? 2.6 : 1.1;
        wrap9(S, function (ox, oy) {
          g.strokeStyle = cw > 2 ? 'rgba(16,16,15,0.6)' : 'rgba(14,14,13,0.65)'; g.lineWidth = cw;
          g.beginPath(); pts.forEach(function (q2) { g.lineTo(q2[0] + ox, q2[1] + oy); }); g.stroke();
        });
      }
      g.fillStyle = 'rgba(20,20,18,0.4)'; g.fillRect(0, 0, S, 1.6); g.fillRect(0, 0, 1.6, S);   // slab joints
      grain(g, S, S, r, 22, 0.04, 0.02, [1, 0.99, 0.95]);
      return c;
    }
    /** Mown grass (10 m tile): blades, clover and dry patches. */
    function drawGrassTex(S) {
      var c = makeCanvas(S, S), g = c.getContext('2d'), r = mulberry32(77);
      g.fillStyle = hex(PAL.grassAirport); g.fillRect(0, 0, S, S);
      for (var k = 0; k < 46; k++) {
        var x = r() * S, y = r() * S, rad = 6 + r() * 26, t = r();
        var colr = t < 0.45 ? [52, 84, 34, 0.16] : (t < 0.75 ? [196, 186, 116, 0.12] : [110, 140, 60, 0.14]);
        wrap9(S, function (ox, oy) {
          var rg = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          rg.addColorStop(0, rgba(colr[0], colr[1], colr[2], colr[3])); rg.addColorStop(1, rgba(colr[0], colr[1], colr[2], 0));
          g.fillStyle = rg; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        });
      }
      g.lineWidth = 1;
      for (var b = 0; b < 7000; b++) {                     // blades
        var bx = r() * S, by = r() * S, bl = 2 + r() * 4, ba = -1.57 + (r() - 0.5) * 1.2;
        g.strokeStyle = r() < 0.5 ? 'rgba(40,64,24,0.22)' : 'rgba(176,196,120,0.2)';
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl); g.stroke();
      }
      grain(g, S, S, r, 18, 0, 0, [0.8, 1, 0.5]);
      return c;
    }
    /** Worn paint (3 m tile, tinted per marking): asphalt showing through in specks and scuffs. */
    function drawPaintTex(S) {
      var c = makeCanvas(S, S), g = c.getContext('2d'), r = mulberry32(13);
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      for (var k = 0; k < 26; k++) {
        var x = r() * S, y = r() * S, rad = 4 + r() * 18, a = 0.08 + r() * 0.12;
        wrap9(S, function (ox, oy) {
          var rg = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          rg.addColorStop(0, rgba(120, 120, 116, a)); rg.addColorStop(1, 'rgba(120,120,116,0)');
          g.fillStyle = rg; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        });
      }
      var img = g.getImageData(0, 0, S, S), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var q = r();
        var v = q < 0.05 ? 0.42 + r() * 0.25 : 0.93 + r() * 0.07;
        d[i] *= v; d[i + 1] *= v; d[i + 2] *= v;
      }
      g.putImageData(img, 0, 0);
      return c;
    }
    /** Rubber deposits for one touchdown zone (u across 14 m, v along; alpha only, heavier at the touchdown end). */
    function drawRubberTex(W, H) {
      var c = makeCanvas(W, H), g = c.getContext('2d'), r = mulberry32(21);
      g.lineCap = 'round';
      for (var s = 0; s < 420; s++) {
        var v = Math.pow(r(), 1.7);                         // more marks near v = 0 (touchdown)
        var x = W / 2 + ((r() + r()) / 2 - 0.5) * W * 0.95, y = v * H, len = (0.02 + r() * 0.08) * H;
        var a = (0.05 + r() * 0.16) * (1 - v * 0.75);
        g.strokeStyle = rgba(10, 10, 9, a); g.lineWidth = 0.8 + r() * 3.2;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 6, y + len / 2, x + (r() - 0.5) * 4, y + len); g.stroke();
      }
      var fade = g.createLinearGradient(0, 0, 0, H);         // soft ends
      fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.04, 'rgba(0,0,0,0)');
      fade.addColorStop(0.92, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      return c;
    }
    /** Runway designator ("06" / "24") on a transparent canvas. */
    function drawNumber(c, text) {
      var g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = '#efefea';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 ' + Math.round(c.height * 1.02) + "px 'Barlow Condensed', 'Arial Narrow', sans-serif";
      var w = g.measureText(text).width;
      g.save();
      g.translate(c.width / 2, c.height / 2);
      g.scale(Math.min(1, (c.width * 0.96) / w), 1);
      g.fillText(text, 0, c.height * 0.04);
      g.restore();
    }
    /** Cumulus sprite (w × h at ox, oy): puffs → density → light marched down from the top (lit crowns, soft grey
     *  flat base, brighter thin edges). */
    function drawCloud(g, ox, oy, w, h, seed) {
      var tmp = makeCanvas(w, h), t = tmp.getContext('2d'), r = mulberry32(seed);
      var n = 30 + Math.floor(r() * 14), baseY = h * 0.74;
      for (var i = 0; i < n; i++) {
        var u = r(), dome = 1 - Math.pow(Math.abs(u - 0.5) * 2, 1.5);
        var x = w * (0.12 + 0.76 * u), rad = h * (0.09 + 0.17 * dome * (0.55 + 0.45 * r()));
        var y = baseY - rad * (0.25 + 1.25 * dome * r());
        var rg = t.createRadialGradient(x, y, 0, x, y, rad);
        rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.55, 'rgba(255,255,255,0.75)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        t.fillStyle = rg; t.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      var cut = t.createLinearGradient(0, baseY - h * 0.05, 0, baseY + h * 0.06);   // flat base
      cut.addColorStop(0, 'rgba(0,0,0,0)'); cut.addColorStop(1, 'rgba(0,0,0,1)');
      t.globalCompositeOperation = 'destination-out'; t.fillStyle = cut; t.fillRect(0, 0, w, h);
      var img = t.getImageData(0, 0, w, h), d = img.data;
      for (var xx = 0; xx < w; xx++) {
        var acc = 0;
        for (var yy = 0; yy < h; yy++) {
          var o = (yy * w + xx) * 4, a = d[o + 3] / 255;
          acc = acc * 0.982 + a * 0.055;
          var L = Math.exp(-acc * 1.5);
          var base = smoothstep(0.5, 0.74, yy / h);
          L = L * (1 - 0.28 * base) + (a < 0.6 ? (0.6 - a) * 0.45 : 0);
          L = Math.max(0, Math.min(1, L));
          d[o] = 158 + (255 - 158) * L; d[o + 1] = 170 + (254 - 170) * L; d[o + 2] = 190 + (250 - 190) * L;
          d[o + 3] = 255 * smoothstep(0.02, 0.55, a);
        }
      }
      t.putImageData(img, 0, 0);
      g.drawImage(tmp, ox, oy);
    }
    /** Soft shadow of a tree for the ground decal (x = along the shadow, 0 = trunk; L metres long). */
    function drawTreeShadow(W, H, L, x0, trunkEnd, crownC, crownA, crownB, halfWidth) {
      var c = makeCanvas(W, H), g = c.getContext('2d');
      function X(m) { return (m - x0) / L * W; }
      function Y(m) { return H / 2 + m / halfWidth * (H / 2); }
      softFill(g, 6, 'rgba(0,0,0,1)', function (q) {
        q.fillRect(X(0), Y(-0.28), X(trunkEnd) - X(0), Y(0.28) - Y(-0.28));
        q.beginPath(); q.ellipse(X(crownC), Y(0), X(crownC + crownA) - X(crownC), Y(crownB) - Y(0), 0, 0, Math.PI * 2); q.fill();
      });
      return c;
    }
    /** Soft blob (contact shadow / cloud shadow). */
    function drawBlob(S, inner) {
      var c = makeCanvas(S, S), g = c.getContext('2d');
      var rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(inner, 'rgba(0,0,0,0.85)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(0, 0, S, S);
      return c;
    }
    /** Corrugated sheet (ribs along u) for hangar walls / roof. */
    function drawRibs(vertical) {
      var c = makeCanvas(vertical ? 32 : 4, vertical ? 4 : 32), g = c.getContext('2d');
      var gr = vertical ? g.createLinearGradient(0, 0, 32, 0) : g.createLinearGradient(0, 0, 0, 32);
      gr.addColorStop(0, '#d9d9d9'); gr.addColorStop(0.35, '#ffffff'); gr.addColorStop(0.6, '#e6e6e6'); gr.addColorStop(0.85, '#bdbdbd'); gr.addColorStop(1, '#d9d9d9');
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
      return c;
    }

    /* ================================================================ SKY */
    var skyU = withHaze({
      uZenith: { value: new THREE.Color(PAL.zenith) },
      uSkyMid: { value: new THREE.Color(PAL.skyMid) },
      uSunDisc: { value: new THREE.Color(PAL.sunDisc) },
      uSunGlow: { value: new THREE.Color(PAL.sunGlow) },
      uSunDir: { value: SUN.clone() }
    });
    var skyMat = new THREE.ShaderMaterial({
      uniforms: skyU,
      vertexShader: [
        'varying vec3 vDir;',
        HAZE_VERT_PARS,   // declared by HAZE_FRAG (unused by the sky, but the link needs a matching varying)
        'void main() {',
        '  vDir = position;',
        '  vHazeRay = vec3(0.0);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uZenith; uniform vec3 uSkyMid; uniform vec3 uSunDisc; uniform vec3 uSunGlow; uniform vec3 uSunDir;',
        HAZE_FRAG,
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float e = d.y, s = dot(d, uSunDir), sp = max(s, 0.0), eu = max(e, 0.0);',
        '  vec3 hz = hazeTint(s);',
        // Rayleigh-like: deep blue overhead, paler toward the horizon, paler and warmer around the sun
        '  vec3 sky = mix(uSkyMid, uZenith, pow(eu, 0.55));',
        '  sky = mix(sky, uHazeSun, pow(sp, 3.0) * 0.20 * (1.0 - 0.6 * eu));',
        '  sky *= 1.0 - 0.05 * max(-s, 0.0) * eu;',
        '  vec3 col = mix(sky, hz, exp(-eu * 10.0));',
        '  float above = smoothstep(0.0, 0.03, e);',
        '  col += uSunGlow * (pow(sp, 10.0) * 0.10 + pow(sp, 90.0) * 0.20 + pow(sp, 1400.0) * 0.55) * above;',
        '  col = mix(col, uSunDisc, smoothstep(0.999955, 0.99997, s) * above);',
        '  col = mix(hz, col, smoothstep(-0.004, 0.0, e));',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <encodings_fragment>',
        '  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
        '}'
      ].join('\n'),
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false
    });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), skyMat);
    sky.name = 'sky';
    sky.renderOrder = 100;
    sky.frustumCulled = false;
    var api = { autoFog: false };
    sky.onBeforeRender = function (renderer, scene, camera) {
      // Fit inside the camera far plane (the haze's far end follows it).
      var far = (camera && camera.far) || 60000;
      var r = Math.min(30000, far * 0.8);
      if (sky.scale.x !== r) { sky.scale.setScalar(r); sky.updateMatrixWorld(true); }
      hazeU.uHazeFar.value = Math.min(HAZE_FAR, far * 0.9);
      if (renderer && renderer.capabilities && maxAniso < 16 && !anisoSet) {
        anisoSet = true;
        var mx = Math.min(16, renderer.capabilities.getMaxAnisotropy());
        anisoTextures.forEach(function (t) { if (t.anisotropy < mx) { t.anisotropy = mx; t.needsUpdate = true; } });
      }
      if (api.autoFog && scene && scene.isScene && !scene.fog) scene.fog = fog;
    };
    var anisoSet = false, anisoTextures = [];
    sky.scale.setScalar(30000);
    group.add(sky);

    /* ============================================================= GROUND */
    var fieldsTex = canvasTexture(drawFieldsTile(1024), true);
    var detailTex = canvasTexture(drawDetail(256), true, true);
    var regionTex = canvasTexture(drawRegion(2048), false);
    regionTex.premultiplyAlpha = true;
    regionTex.wrapS = regionTex.wrapT = THREE.ClampToEdgeWrapping;
    anisoTextures.push(fieldsTex, regionTex);

    var groundUniforms = withHaze({
      tFields: { value: fieldsTex }, tDetail: { value: detailTex }, tRegion: { value: regionTex },
      uOffset: { value: new THREE.Vector2() },
      uTile: { value: TILE }, uRegion: { value: REGION }, uCoast: { value: COAST_Z },
      uRot: { value: new THREE.Vector2(Math.cos(FIELD_ROT), Math.sin(FIELD_ROT)) },
      uRot2: { value: new THREE.Vector2(Math.cos(FIELD_ROT2), Math.sin(FIELD_ROT2)) },
      uWater: { value: new THREE.Color(PAL.waterDeep) },
      uSkyRefl: { value: new THREE.Color(PAL.skyMid) },
      uSunGlowG: { value: new THREE.Color(PAL.sunGlow) },
      uTime: { value: 0 },
      uDetailAmt: { value: 1 }
    });
    var groundMat = new THREE.ShaderMaterial({
      uniforms: groundUniforms,
      vertexShader: [
        'uniform vec2 uOffset;',
        'varying vec2 vXZ;',
        HAZE_VERT_PARS,
        'void main() {',
        '  vXZ = position.xz + uOffset;',
        '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        '  ' + HAZE_VERT,
        '  gl_Position = projectionMatrix * mvPosition;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tFields; uniform sampler2D tDetail; uniform sampler2D tRegion;',
        'uniform float uTile; uniform float uRegion; uniform float uCoast; uniform vec2 uRot; uniform vec2 uRot2;',
        'uniform vec3 uWater; uniform vec3 uSkyRefl; uniform vec3 uSunGlowG; uniform float uTime; uniform float uDetailAmt;',
        'varying vec2 vXZ;',
        HAZE_FRAG,
        'void main() {',
        '  vec2 rp = vec2(uRot.x * vXZ.x - uRot.y * vXZ.y, uRot.y * vXZ.x + uRot.x * vXZ.y);',
        '  vec2 q = vXZ + vec2(913.0, -377.0);',
        '  vec2 rp2 = vec2(uRot2.x * q.x - uRot2.y * q.y, uRot2.y * q.x + uRot2.x * q.y);',
        '  vec3 colA = texture2D(tFields, rp / uTile).rgb;',
        '  vec3 colB = texture2D(tFields, rp2 / (uTile * 1.37) + 0.37).rgb;',
        '  float m1 = texture2D(tDetail, vXZ / 9100.0 + 0.21).g;',
        '  vec3 col = mix(colA, colB, smoothstep(0.47, 0.53, m1));',
        '  float macro = texture2D(tDetail, vXZ / 2300.0).g, macro2 = texture2D(tDetail, vXZ / 640.0 + 0.5).g;',
        '  col *= (0.86 + 0.28 * macro) * (0.94 + 0.12 * macro2);',
        '  col = mix(col, col * vec3(1.07, 1.03, 0.84), smoothstep(0.55, 0.85, macro) * 0.55);',   // drier patches
        '  float water = 0.0;',
        '  vec2 ruv = vec2(vXZ.x / uRegion + 0.5, 0.5 - vXZ.y / uRegion);',
        '  if (ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0) {',
        '    vec4 rg = texture2D(tRegion, ruv);',
        '    col = col * (1.0 - rg.a) + rg.rgb;',
        '    vec3 un = rg.rgb / max(rg.a, 0.02);',
        '    water = smoothstep(0.018, 0.04, un.b - un.g) * smoothstep(0.5, 0.9, rg.a);',
        '  } else if (vXZ.y > uCoast) {',
        '    col = uWater; water = 1.0;',
        '  }',
        '  vec3 dir; float f = hazeAmount(vHazeRay, dir);',
        '  if (water > 0.0) {',
        // Fresnel sky reflection (horizon haze at grazing angles, blue sky looking down) + rippled sun glint
        '    float ry = clamp(-dot(dir, uUpS), 0.0, 1.0);',
        '    vec3 rdir = dir + 2.0 * ry * uUpS;',
        '    float fres = 0.03 + 0.97 * pow(1.0 - ry, 5.0);',
        '    vec3 refl = mix(hazeTint(dot(rdir, uSunS)), uSkyRefl, smoothstep(0.05, 0.5, ry));',
        '    float rip = texture2D(tDetail, vXZ / 37.0 + vec2(uTime * 0.004, uTime * 0.0027)).r;',
        '    float rs = max(dot(rdir, uSunS), 0.0);',
        '    vec3 glint = uSunGlowG * (pow(rs, 60.0) * 0.18 + pow(rs, 700.0) * 1.4) * (0.4 + 1.2 * smoothstep(0.45, 0.8, rip));',
        '    col = mix(col, mix(col, refl, fres) + glint, water);',
        '  }',
        '  float dist = length(vHazeRay);',
        '  float fine = texture2D(tDetail, vXZ / 23.0).r, fine2 = texture2D(tDetail, vXZ / 4.7).r;',
        '  float fade = (1.0 - smoothstep(40.0, 700.0, dist)) * uDetailAmt * (1.0 - water);',
        '  col *= mix(1.0, (0.80 + 0.40 * fine) * (0.90 + 0.20 * fine2), fade);',
        '  col = mix(col, hazeTint(dot(dir, uSunS)), f);',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n'),
      depthWrite: false,
      fog: false
    });
    var groundGeo = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, 48, 48);
    groundGeo.rotateX(-Math.PI / 2);
    var ground = layerMesh(groundGeo, groundMat, 110);
    ground.name = 'ground';
    group.add(ground);

    /* ======================================================= SURFACE SHADER */
    /**
     * Airport surfaces: colour map (UV · uMapScale + uMapOff) × tint, large-scale blotches, mowing stripes (grass),
     * near-eye grain, haze. Matte by construction (no reflection term at all).
     */
    function surfaceMat(o) {
      var u = withHaze({
        tMap: { value: o.map }, tDetail: { value: detailTex },
        uTint: { value: new THREE.Color(o.tint != null ? o.tint : 0xffffff) },
        uMapScale: { value: new THREE.Vector2(o.mapScale ? o.mapScale[0] : 1, o.mapScale ? o.mapScale[1] : 1) },
        uMapOff: { value: new THREE.Vector2(o.mapOff ? o.mapOff[0] : 0, o.mapOff ? o.mapOff[1] : 0) },
        uMacroScale: { value: o.macroScale || 90 }, uMacroAmt: { value: o.macroAmt != null ? o.macroAmt : 0.22 },
        uFineScale: { value: o.fineScale || 2.3 }, uFineAmt: { value: o.fineAmt != null ? o.fineAmt : 0.8 },
        uStripe: { value: o.stripe || 0 }
      });
      if (o.map) anisoTextures.push(o.map);
      return new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: [
          'varying vec2 vUv; varying vec2 vP;',
          HAZE_VERT_PARS,
          'void main() {',
          '  vUv = uv; vP = position.xz;',
          '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
          '  ' + HAZE_VERT,
          '  gl_Position = projectionMatrix * mvPosition;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D tMap; uniform sampler2D tDetail; uniform vec3 uTint; uniform vec2 uMapScale; uniform vec2 uMapOff;',
          'uniform float uMacroScale; uniform float uMacroAmt; uniform float uFineScale; uniform float uFineAmt; uniform float uStripe;',
          'varying vec2 vUv; varying vec2 vP;',
          HAZE_FRAG,
          'void main() {',
          '  vec3 col = texture2D(tMap, vUv * uMapScale + uMapOff).rgb * uTint;',
          '  float macro = texture2D(tDetail, vP / uMacroScale).g;',
          '  col *= 1.0 + (macro - 0.5) * uMacroAmt;',
          '  float d = length(vHazeRay);',
          '  if (uStripe > 0.0) col *= 1.0 + uStripe * clamp(sin(vP.x * 0.5236) * 3.0, -1.0, 1.0) * (1.0 - smoothstep(150.0, 900.0, d));',
          '  float fine = texture2D(tDetail, vP / uFineScale).r;',
          '  col *= mix(1.0, 0.80 + 0.40 * fine, (1.0 - smoothstep(25.0, 300.0, d)) * uFineAmt);',
          '  gl_FragColor = vec4(applyHaze(col), 1.0);',
          '  #include <encodings_fragment>',
          '}'
        ].join('\n'),
        depthWrite: false,
        fog: false
      });
    }

    /* ============================================================ AIRPORT */
    // Local airport frame: origin at runway centre, local -Z = runway heading direction (toward 06 takeoff),
    // local -X = left normal n (north-west side: taxiway, apron, hangar).
    var apt = new THREE.Group();
    apt.name = 'airport';
    apt.position.set(rwC.x, 0, rwC.z);
    apt.rotation.y = -rwHead;
    group.add(apt);
    var sunApt = SUN.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rwHead);  // sun in airport-local frame
    var shApt = new THREE.Vector2(-sunApt.x / sunApt.y, -sunApt.z / sunApt.y);     // shadow offset per metre, local
    function toLocal(p) {   // world {x,z} → airport local {x,z}
      var dx = p.x - rwC.x, dz = p.z - rwC.z;
      var a = dx * Math.sin(rwHead) - dz * Math.cos(rwHead);
      var o = -dx * Math.cos(rwHead) - dz * Math.sin(rwHead);
      return { x: -o, z: -a };
    }

    // mown grass strip around the runway and buildings (stripes run along the runway)
    var grassTex = canvasTexture(drawGrassTex(512), true);
    var grass = layerMesh(rectsGeometry([[-280, -760, 90, 760]], 10),
      surfaceMat({ map: grassTex, macroScale: 160, macroAmt: 0.34, fineScale: 1.3, fineAmt: 0.6, stripe: 0.035 }), 114);
    apt.add(grass);

    // pavement: taxiway, connectors, apron, run-up pad
    var apronL = toLocal(A.apron);
    var apW = A.apron.w || 120, apH = A.apron.h || 70;
    var twX = -twyOff;
    var paved = [
      [twX - 5, -560, twX + 5, 560],                                   // parallel taxiway
      [-halfW, halfLen - 17.5, twX, halfLen + 2.5],                     // connector at threshold 06
      [-halfW, -halfLen - 2.5, twX, -halfLen + 17.5],                   // connector at threshold 24
      [-halfW, -7.5, apronL.x + apH / 2, 7.5],                          // central connector to the apron
      [apronL.x - apH / 2, apronL.z - apW / 2, apronL.x + apH / 2, apronL.z + apW / 2],  // apron
      [apronL.x + apH / 2, apronL.z - apW / 2, twX - 5, apronL.z + apW / 2],            // apron to taxiway
      [-88, halfLen - 65, -44, halfLen - 2]                             // run-up pad near threshold 06
    ];
    var twyTex = canvasTexture(drawTaxiTex(512), true);
    apt.add(layerMesh(rectsGeometry(paved, 18), surfaceMat({ map: twyTex, macroScale: 70, macroAmt: 0.2, fineScale: 1.9, fineAmt: 0.55 }), 118));
    // runway: its own 30 m × 60 m tile (u across, v along) so lanes and cracks follow the runway
    var rwyTex = canvasTexture(drawRunwayTex(512, 1024), true);
    apt.add(layerMesh(rectsGeometry([[-halfW, -halfLen, halfW, halfLen]], 1),
      surfaceMat({ map: rwyTex, mapScale: [1 / (2 * halfW), 1 / 60], mapOff: [0.5, 0], macroScale: 110, macroAmt: 0.18, fineScale: 1.7, fineAmt: 0.55 }), 120));

    // markings (worn paint, tinted)
    var paintTex = canvasTexture(drawPaintTex(256), true);
    var white = [];
    [1, -1].forEach(function (s) {
      var zEnd = s * halfLen;
      for (var b = 0; b < 8; b++) {            // threshold bars: 8 × 1.8 m, 30 m long, 6 m from the end
        var xb = -13.5 + b * 3.6 + (b >= 4 ? 1.8 : 0);
        white.push([xb, zEnd - s * 6, xb + 1.8, zEnd - s * 36]);
      }
      white.push([-4.5 - 4, zEnd - s * 250, -4.5, zEnd - s * 295]);   // aiming point markings
      white.push([4.5, zEnd - s * 250, 4.5 + 4, zEnd - s * 295]);
      white.push([-halfW, zEnd - s * 0.5, halfW, zEnd - s * 1.5]);      // runway end line
    });
    for (var cz = halfLen - 66; cz > -halfLen + 66 + 30; cz -= 50) white.push([-0.3, cz, 0.3, cz - 30]);   // centreline
    white.push([-halfW + 0.3, -halfLen, -halfW + 1.2, halfLen]);       // side stripes
    white.push([halfW - 1.2, -halfLen, halfW - 0.3, halfLen]);
    apt.add(layerMesh(rectsGeometry(white, 3), surfaceMat({ map: paintTex, tint: PAL.paint, macroScale: 60, macroAmt: 0.12, fineScale: 1.1, fineAmt: 0.3 }), 126));

    // runway designators
    var numCanvases = [];
    (A.runway.numbers || ['06', '24']).forEach(function (txt, i) {
      var c = makeCanvas(256, 320);
      drawNumber(c, txt);
      numCanvases.push({ c: c, t: txt });
      var tex = canvasTexture(c, false);
      numCanvases[i].tex = tex;
      var mat = basic({ map: tex, alphaTest: 0.4, depthWrite: false });
      var m = layerMesh(new THREE.PlaneGeometry(9.5, 12), mat, 127);
      m.rotation.x = -Math.PI / 2;
      var s = i === 0 ? 1 : -1;
      if (i === 1) m.rotation.z = Math.PI;
      m.position.set(0, 0, s * (halfLen - 36 - 12 - 6));
      apt.add(m);
    });

    // yellow taxi markings: centrelines, holding positions, apron stand lines
    var yellow = [];
    yellow.push([twX - 0.2, -555, twX + 0.2, 555]);
    yellow.push([-halfW - 3, halfLen - 7.7, twX, halfLen - 7.3]);
    yellow.push([-halfW - 3, -halfLen + 7.3, twX, -halfLen + 7.7]);
    yellow.push([-halfW - 3, -0.2, apronL.x, 0.2]);
    [halfLen - 17.5, -halfLen - 2.5, -7.5].forEach(function (z0) {   // holding position: 2 solid + 2 dashed
      var z1 = z0 + 20;
      var hx = -40;
      yellow.push([hx - 1.5, z0, hx - 1.2, z1], [hx - 0.9, z0, hx - 0.6, z1]);
      for (var z = z0; z < z1 - 0.5; z += 2) yellow.push([hx - 0.3, z, hx, z + 1], [hx + 0.3, z, hx + 0.6, z + 1]);
    });
    for (var st = -45; st <= 45; st += 15) {                          // parking stands across the apron
      yellow.push([apronL.x - apH / 2 + 6, apronL.z + st - 0.15, apronL.x + apH / 2 - 4, apronL.z + st + 0.15]);
    }
    apt.add(layerMesh(rectsGeometry(yellow, 3), surfaceMat({ map: paintTex, tint: PAL.yellow, macroScale: 60, macroAmt: 0.12, fineScale: 1.1, fineAmt: 0.3 }), 126));
    // tie-down rings (dark dots) by each stand
    var ties = [];
    for (var st2 = -45; st2 <= 45; st2 += 15) {
      [-3.5, 3.5].forEach(function (dz) { var x = apronL.x - 8, z = apronL.z + st2 + dz; ties.push([x - 0.25, z - 0.25, x + 0.25, z + 0.25]); });
      ties.push([apronL.x - 14.25, apronL.z + st2 - 0.25, apronL.x - 13.75, apronL.z + st2 + 0.25]);
    }
    apt.add(layerMesh(rectsGeometry(ties, 1), basic({ color: 0x2a2a2a, depthWrite: false }), 127));
    // rubber deposits in both touchdown zones (blended over paint: the centreline gets dirty too)
    var rubberTex = canvasTexture(drawRubberTex(128, 1024), false);
    var rubberMat = decalMat({ color: 0x101010, map: rubberTex, opacity: 0.95 }, 4000);
    [1, -1].forEach(function (s) {
      var len = 330, wdt = 15;
      var m = layerMesh(new THREE.PlaneGeometry(wdt, len), rubberMat, 128);
      m.rotation.x = -Math.PI / 2;
      if (s < 0) m.rotation.z = Math.PI;
      m.position.set(0, 0, s * (halfLen - 105 - len / 2));
      apt.add(m);
    });

    /* ------------------------------------------- airport 3D objects (baked) */
    var hangarSign = makeCanvas(512, 96);
    function drawHangarSign() {
      var g = hangarSign.getContext('2d');
      g.fillStyle = '#f3f1ea'; g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#1d2a36';
      g.font = "700 64px 'Barlow Condensed', 'Arial Narrow', sans-serif";
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ESCUELA DE VUELO', 256, 52);
    }
    drawHangarSign();
    var signTex = canvasTexture(hangarSign, false);
    var ribsV = canvasTexture(drawRibs(true), true), ribsH = canvasTexture(drawRibs(false), true);
    ribsV.repeat.set(36, 1); ribsH.repeat.set(1, 40);
    var wallMat = basic({ vertexColors: true, map: ribsV });
    var roofMat = basic({ vertexColors: true, map: ribsH });

    var buildings = new THREE.Group();
    buildings.name = 'buildings';
    apt.add(buildings);
    var footprints = [];   // [ [x,z]... ], height  → ground shadows (airport frame)
    (function buildHangar() {
      var hx = apronL.x - apH / 2 - 16, hz = apronL.z;   // behind the apron
      var W = 36, D = 26, H = 6.5;
      // walls (long side along local z, door facing +x = toward the runway)
      var walls = new THREE.BoxGeometry(D, H, W, 1, 4, 1);
      walls.translate(hx, H / 2, hz);
      buildings.add(bakedMesh(walls, 0xdcded9, sunApt, { material: wallMat, aoHeight: 2.2, ao: 0.3 }));
      // curved roof: cylinder arc (radius RR, half angle TH) whose axis runs along local x (hangar depth)
      var RR = 30, TH = 0.64;
      var roof = new THREE.CylinderGeometry(RR, RR, D + 0.6, 28, 1, true, -TH, 2 * TH);
      roof.applyMatrix4(new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1));  // (x,y,z) → (y,z,x)
      roof.translate(hx, H - Math.cos(TH) * RR, hz);
      buildings.add(bakedMesh(roof, 0x8a988c, sunApt, { material: roofMat, ao: 0 }));
      // big door (sliding panels, half open) and sign
      var door = new THREE.BoxGeometry(0.3, H - 0.6, W - 6, 1, 3, 6);
      door.translate(hx + D / 2 + 0.1, (H - 0.6) / 2, hz);
      buildings.add(bakedMesh(door, 0x66727a, sunApt, { material: wallMat, aoHeight: 2, ao: 0.3 }));
      var gap = new THREE.BoxGeometry(0.32, H - 1.2, 11, 1, 3, 1);
      gap.translate(hx + D / 2 + 0.12, (H - 1.2) / 2, hz - 3);
      buildings.add(bakedMesh(gap, 0x1a1e22, sunApt, { ambient: 1, diffuse: 0, aoHeight: 3, ao: 0.35 }));
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), basic({ map: signTex }));
      sign.position.set(hx + D / 2 + 0.35, H + 1.2, hz);
      sign.rotation.y = Math.PI / 2;
      buildings.add(sign);
      // gable wall above the door (fills the curved roof profile)
      var shape = new THREE.Shape();
      shape.moveTo(-W / 2, 0);
      for (var i = 0; i <= 16; i++) {
        var a = -TH + 2 * TH * i / 16;
        shape.lineTo(Math.sin(a) * RR, Math.cos(a) * RR - Math.cos(TH) * RR);
      }
      shape.lineTo(W / 2, 0);
      var gable = new THREE.ShapeGeometry(shape);
      [1, -1].forEach(function (s) {
        var gg = gable.clone();
        gg.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
        gg.translate(hx + s * (D / 2 + 0.02), H, hz);
        buildings.add(bakedMesh(gg, 0xd2d5cf, sunApt, { ao: 0 }));
      });
      footprints.push({ pts: [[hx - D / 2, hz - W / 2], [hx + D / 2, hz - W / 2], [hx + D / 2, hz + W / 2], [hx - D / 2, hz + W / 2]], h: H + 3.6, a: 0.55 });
    })();
    (function buildClubhouse() {
      var bx = apronL.x - 6, bz = apronL.z - apW / 2 - 18;
      var body = new THREE.BoxGeometry(10, 3.4, 18, 1, 3, 1); body.translate(bx, 1.7, bz);
      buildings.add(bakedMesh(body, 0xeeeae0, sunApt, { aoHeight: 1.6, ao: 0.28 }));
      var roof = new THREE.BoxGeometry(11, 0.4, 19); roof.translate(bx, 3.6, bz);
      buildings.add(bakedMesh(roof, 0x94503a, sunApt, { ao: 0 }));
      var cab = new THREE.BoxGeometry(4.2, 2.6, 4.2, 1, 2, 1); cab.translate(bx + 1, 5.1, bz + 4);
      // control cab glass: darker below, sky reflection toward the top
      var cabG = bake(cab, 0x2d4250, sunApt, { ambient: 0.8, diffuse: 0.25, ao: 0 });
      (function () {
        var p = cabG.attributes.position, cl = cabG.attributes.color;
        for (var i = 0; i < p.count; i++) {
          var t = smoothstep(3.8, 6.4, p.getY(i));
          cl.setXYZ(i, cl.getX(i) * (1 + 1.6 * t), cl.getY(i) * (1 + 1.8 * t), cl.getZ(i) * (1 + 1.9 * t));
        }
      })();
      buildings.add(new THREE.Mesh(cabG, bakedMat));
      var cabBase = new THREE.BoxGeometry(4.6, 0.25, 4.6); cabBase.translate(bx + 1, 3.9, bz + 4);
      buildings.add(bakedMesh(cabBase, 0xeeeae0, sunApt, { ao: 0 }));
      var cabRoof = new THREE.BoxGeometry(5, 0.3, 5); cabRoof.translate(bx + 1, 6.55, bz + 4);
      buildings.add(bakedMesh(cabRoof, 0xeeeae0, sunApt, { ao: 0 }));
      for (var i = 0; i < 4; i++) {   // windows facing the apron
        var w = new THREE.BoxGeometry(0.1, 1.2, 2.2); w.translate(bx + 5.05, 1.9, bz - 6 + i * 4);
        buildings.add(bakedMesh(w, 0x34505e, sunApt, { ambient: 0.95, diffuse: 0.2, ao: 0 }));
      }
      // fuel tank / pump island beside the apron
      var tank = new THREE.CylinderGeometry(1.2, 1.2, 4.5, 20); tank.rotateX(Math.PI / 2); tank.translate(apronL.x - 20, 1.3, apronL.z + apW / 2 + 10);
      var tankG = bake(tank, 0xe8e6e0, sunApt, { keepNormals: true, ao: 0.2, aoHeight: 1.2 });
      buildings.add(new THREE.Mesh(tankG, bakedMat));
      var pump = new THREE.BoxGeometry(0.8, 1.6, 0.6); pump.translate(apronL.x - 14, 0.8, apronL.z + apW / 2 + 6);
      buildings.add(bakedMesh(pump, 0xc53a2c, sunApt));
      footprints.push({ pts: [[bx - 5.5, bz - 9.5], [bx + 5.5, bz - 9.5], [bx + 5.5, bz + 9.5], [bx - 5.5, bz + 9.5]], h: 3.8, a: 0.5 });
      footprints.push({ pts: [[bx - 1.5, bz + 1.5], [bx + 3.5, bz + 1.5], [bx + 3.5, bz + 6.5], [bx - 1.5, bz + 6.5]], h: 6.7, a: 0.5, from: 3.8 });
      var tx = apronL.x - 20, tz = apronL.z + apW / 2 + 10;
      footprints.push({ pts: [[tx - 1.2, tz - 2.25], [tx + 1.2, tz - 2.25], [tx + 1.2, tz + 2.25], [tx - 1.2, tz + 2.25]], h: 2.4, a: 0.45 });
    })();

    // runway edge and threshold lights (small posts)
    (function buildLights() {
      var post = bake(new THREE.CylinderGeometry(0.12, 0.16, 0.45, 6), 0xf3f3ee, sunApt, { ao: 0 });
      var posts = [];
      for (var z = -halfLen; z <= halfLen + 0.1; z += 60) { posts.push([-halfW - 1.5, z], [halfW + 1.5, z]); }
      var im = new THREE.InstancedMesh(post, bakedMat, posts.length);
      var m = new THREE.Matrix4();
      posts.forEach(function (p, i) { m.makeTranslation(p[0], 0.22, p[1]); im.setMatrixAt(i, m); });
      apt.add(im);
      var thr = bake(new THREE.CylinderGeometry(0.14, 0.18, 0.4, 6), 0xffffff, sunApt, { ao: 0 });
      var cols = [];
      for (var x = -halfW; x <= halfW + 0.1; x += 5) { cols.push([x, halfLen + 3, 0x3cbf5a]); cols.push([x, -halfLen - 3, 0xd8392b]); }
      var im2 = new THREE.InstancedMesh(thr, bakedMat, cols.length);
      var col = new THREE.Color();
      cols.forEach(function (p, i) { m.makeTranslation(p[0], 0.2, p[1]); im2.setMatrixAt(i, m); im2.setColorAt(i, col.setHex(p[2])); });
      apt.add(im2);
    })();

    /* ----------------------------------------------- building ground shadows */
    function hull(points) {   // convex hull (monotone chain) of [x, z] points
      var p = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
      var lo = [], up = [], i;
      for (i = 0; i < p.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop(); lo.push(p[i]); }
      for (i = p.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p[i]) <= 0) up.pop(); up.push(p[i]); }
      up.pop(); lo.pop();
      return lo.concat(up);
    }
    /** Shadow polygon with a soft rim: inner hull (alpha a) + outer ring (alpha 0) as vertex RGBA. */
    function shadowPolyGeometry(list, offset) {
      var pos = [], col = [], idx = [];
      list.forEach(function (fp) {
        var pts = [], h0 = fp.from || 0;
        fp.pts.forEach(function (q) {
          pts.push([q[0] + offset.x * h0, q[1] + offset.y * h0]);
          pts.push([q[0] + offset.x * fp.h, q[1] + offset.y * fp.h]);
        });
        var hp = hull(pts), n = hp.length, cx = 0, cz = 0;
        hp.forEach(function (q) { cx += q[0] / n; cz += q[1] / n; });
        var b = pos.length / 3, soft = 0.9 + fp.h * 0.06;
        pos.push(cx, 0, cz); col.push(1, 1, 1, fp.a);
        hp.forEach(function (q) {
          var dx = q[0] - cx, dz = q[1] - cz, l = Math.hypot(dx, dz) || 1;
          pos.push(q[0] - dx / l * soft * 0.5, 0, q[1] - dz / l * soft * 0.5); col.push(1, 1, 1, fp.a);
          pos.push(q[0] + dx / l * soft * 0.5, 0, q[1] + dz / l * soft * 0.5); col.push(1, 1, 1, 0);
        });
        for (var i = 0; i < n; i++) {
          var i0 = b + 1 + i * 2, i1 = b + 1 + ((i + 1) % n) * 2;
          idx.push(b, i1, i0);                       // fan (inner)
          idx.push(i0, i1, i1 + 1, i0, i1 + 1, i0 + 1);   // rim
        }
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      g.setIndex(idx);
      return g;
    }
    var buildingShadow = layerMesh(shadowPolyGeometry(footprints, shApt), decalMat({ vertexColors: true }), 131);
    buildingShadow.material.side = THREE.DoubleSide;
    apt.add(buildingShadow);

    /* ----------------------------------------------------------- windsock */
    var sockPivot = new THREE.Group();
    (function buildWindsock() {
      var ws = A.windsock || { x: 40, z: -60 };
      var base = new THREE.Group();
      base.position.set(ws.x, 0, ws.z);
      group.add(base);
      var pole = new THREE.CylinderGeometry(0.06, 0.09, 6, 8); pole.translate(0, 3, 0);
      base.add(bakedMesh(pole, 0xe9e9e4, SUN, { keepNormals: true, ao: 0.2 }));
      var ring = new THREE.TorusGeometry(0.42, 0.035, 6, 20); ring.rotateY(Math.PI / 2);
      sockPivot.position.set(0, 5.9, 0);
      base.add(sockPivot);
      var ringMesh = bakedMesh(ring, 0x9a9a9a, SUN, { ao: 0 });
      sockPivot.add(ringMesh);
      // cone: 5 alternating orange/white bands, wide end at the ring (local +x = downwind)
      var cone = new THREE.CylinderGeometry(0.42, 0.16, 3.6, 16, 5, true);
      cone.rotateZ(Math.PI / 2);
      cone.translate(1.8, 0, 0);
      var g = cone.toNonIndexed();
      var p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
      var orange = srgbOf(0xf0782a), whiteC = srgbOf(0xf5f5f0);
      for (var i = 0; i < p.count; i += 3) {   // colour per triangle by its band
        var cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
        var band = Math.min(4, Math.floor(cx / 0.72));
        var bc = band % 2 === 0 ? orange : whiteC;
        for (var j = 0; j < 3; j++) {
          var d = Math.abs(n.getX(i + j) * SUN.x + n.getY(i + j) * SUN.y + n.getZ(i + j) * SUN.z);
          var k = 0.62 + 0.45 * d + 0.08 * n.getY(i + j);
          c[(i + j) * 3] = lin(bc.r * k); c[(i + j) * 3 + 1] = lin(bc.g * k); c[(i + j) * 3 + 2] = lin(bc.b * k);
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      var coneMesh = new THREE.Mesh(g, basic({ vertexColors: true, side: THREE.DoubleSide }));
      sockPivot.add(coneMesh);
    })();
    var sockYaw = (90 - 240) * DEG;   // streams toward 240°: R_y(90° - h) maps local +x onto d(h)

    /* -------------------------------------------- countryside 3D: trees, farms */
    var treesGroup = new THREE.Group();
    treesGroup.name = 'trees';
    group.add(treesGroup);
    var treeShadowGroup = new THREE.Group();
    treeShadowGroup.name = 'tree-shadows';
    group.add(treeShadowGroup);
    // two tree types (unit scale): native / park tree with a round crown, tall eucalyptus
    var TREE_TYPES = [
      { trunk: 3.0, tr: 0.26, cy: 6.4, rx: 4.2, ry: 3.8, euca: false },
      { trunk: 7.0, tr: 0.30, cy: 13.0, rx: 3.3, ry: 7.2, euca: true }
    ];
    /** Crown + trunk, soft-shaded vertex colours (white × light; the instance colour gives the species tint). */
    function treeGeometry(T, detail, seed) {
      var crown = new THREE.IcosahedronGeometry(1, detail);
      var p = crown.attributes.position, r = mulberry32(seed), nrm = [];
      var cache = {};
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        var key = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000);
        if (cache[key] == null) cache[key] = 0.86 + r() * 0.24;
        var k = cache[key];
        nrm.push(x, y, z);
        p.setXYZ(i, x * T.rx * k, T.cy + y * T.ry * k * (y < 0 ? 0.8 : 1), z * T.rx * k);
      }
      crown.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      var trunk = new THREE.CylinderGeometry(T.tr * 0.7, T.tr, T.trunk + 1.2, 5, 1, true).toNonIndexed();
      trunk.translate(0, (T.trunk + 1.2) / 2, 0);
      var pos = [], nor = [], col = [];
      function light(nx, ny, nz, y, isTrunk) {
        var d = nx * SUN.x + ny * SUN.y + nz * SUN.z;
        var wrapD = Math.max(0, (d + 0.35) / 1.35);
        var sky = 0.46 + 0.22 * ny;
        var ao = isTrunk ? 0.55 : 0.62 + 0.38 * smoothstep(T.cy - T.ry, T.cy + T.ry * 0.6, y);
        var k = (sky + 0.78 * Math.pow(wrapD, 1.3)) * ao;
        if (isTrunk) return [lin(0.42 * k), lin(0.36 * k), lin(0.30 * k)];
        return [lin(Math.min(1, 0.92 * k)), lin(Math.min(1, 0.97 * k)), lin(Math.min(1, 0.86 * k))];
      }
      function addGeo(gg, isTrunk) {
        var pp = gg.attributes.position, nn = gg.attributes.normal;
        for (var i = 0; i < pp.count; i++) {
          pos.push(pp.getX(i), pp.getY(i), pp.getZ(i));
          nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
          var c = light(nn.getX(i), nn.getY(i), nn.getZ(i), pp.getY(i), isTrunk);
          col.push(c[0], c[1], c[2]);
        }
      }
      addGeo(trunk, true);
      addGeo(crown, false);
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return g;
    }
    var treeMat = basic({ vertexColors: true });
    (function buildTrees() {
      var r = mulberry32(555);
      var pts = [];   // [x, z, scale, type]
      groves.forEach(function (gv) {
        if (Math.hypot(gv.x, gv.z) > 6500) return;
        var ca = Math.cos(gv.a), sa = Math.sin(gv.a);
        function add(u, v) {   // grove-local → world; canvas rotation of -a equals world rotation about +Y by a
          var x = gv.x + u * ca + v * sa, z = gv.z - u * sa + v * ca;
          pts.push([x, z, 0.8 + r() * 0.5, 1]);
        }
        var hw = gv.w / 2, hh = gv.h / 2, step = 15;
        for (var u = -hw; u <= hw; u += step) { add(u, -hh + r() * 3); add(u, hh - r() * 3); }
        for (var v = -hh + step; v < hh; v += step) { add(-hw + r() * 3, v); add(hw - r() * 3, v); }
        for (var i = 0; i < gv.w * gv.h / 1600; i++) add((r() - 0.5) * gv.w * 0.9, (r() - 0.5) * gv.h * 0.9);
      });
      farms.forEach(function (f) {
        if (Math.hypot(f.x, f.z) > 9000) return;
        for (var i = 0; i < 9; i++) pts.push([f.x + (r() - 0.5) * 60, f.z + (r() - 0.5) * 50, 0.7 + r() * 0.5, r() < 0.5 ? 1 : 0]);
      });
      // lone trees and a line of trees along the access road / airfield fence
      for (var i = 0; i < 40; i++) {
        var x = (r() - 0.5) * 4000, z = (r() - 0.5) * 4000;
        if (inAirportZone(x, z, 60)) continue;
        pts.push([x, z, 0.75 + r() * 0.6, 0]);
      }
      for (var t = 0; t < 1; t += 0.025) pts.push([-140 - 160 * t, -320 - 2300 * t, 0.7 + r() * 0.35, t < 0.3 ? 0 : 1]);

      // near trees (close to the field) get the detailed crown and a ground shadow; far ones the light version
      var NEAR = 1900;
      var buckets = [[[], []], [[], []]];   // [near|far][type]
      pts.forEach(function (p) { buckets[Math.hypot(p[0] - rwC.x, p[1] - rwC.z) < NEAR ? 0 : 1][p[3]].push(p); });
      var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
      var yAxis = new THREE.Vector3(0, 1, 0);
      var TINTS = [[0x557a3a, 0x4a6c34, 0x5f8240, 0x41602f], [0x5d7658, 0x50694f, 0x67805e, 0x4b6248]];
      var shadowTex = [
        canvasTexture(drawTreeShadow(64, 256, 21, -1, (3.0) / Math.tan(sunEl), 6.4 / Math.tan(sunEl), Math.hypot(3.8 / Math.tan(sunEl), 4.2), 4.2, 5), false),
        canvasTexture(drawTreeShadow(64, 256, 36, -1, (7.0) / Math.tan(sunEl), 13.0 / Math.tan(sunEl), Math.hypot(7.2 / Math.tan(sunEl), 3.3), 3.3, 4.5), false)
      ];
      var shadowLen = [21, 36], shadowHalf = [5, 4.5];
      var shAz = Math.atan2(SHADOW_DIR.y, SHADOW_DIR.x);   // angle of the shadow direction in the xz plane
      [0, 1].forEach(function (nf) {
        [0, 1].forEach(function (type) {
          var list = buckets[nf][type];
          if (!list.length) return;
          var T = TREE_TYPES[type];
          var geo = treeGeometry(T, nf === 0 ? 1 : 0, 31 + type);
          var im = new THREE.InstancedMesh(geo, treeMat, list.length);
          var sh = null;
          if (nf === 0) {
            // decal quad: x from -1 m (behind the trunk) to L-1 along the shadow, ±halfWidth across
            var sg = new THREE.PlaneGeometry(1, 1);
            sg.rotateX(-Math.PI / 2);
            sg.translate(0.5, 0, 0);
            var L = shadowLen[type];
            sg.scale(L, 1, shadowHalf[type] * 2);
            sg.translate(-1, 0, 0);
            var uv = sg.attributes.uv;   // u along the shadow, v across
            for (var k = 0; k < uv.count; k++) { var u0 = uv.getX(k), v0 = uv.getY(k); uv.setXY(k, v0, u0); }
            sh = new THREE.InstancedMesh(sg, decalMat({ map: shadowTex[type], opacity: 0.42 }), list.length);
            sh.renderOrder = 131; sh.frustumCulled = false;
            treeShadowGroup.add(sh);
          }
          list.forEach(function (p, i) {
            q.setFromAxisAngle(yAxis, r() * 6.28);
            var sx = p[2] * (0.85 + r() * 0.3);
            s.set(sx, p[2], p[2] * (0.85 + r() * 0.3));
            m.compose(pv.set(p[0], 0, p[1]), q, s);
            im.setMatrixAt(i, m);
            var tints = TINTS[type], tc = tints[Math.floor(r() * tints.length)];
            col.setHex(tc);
            col.multiplyScalar(0.92 + r() * 0.16);
            im.setColorAt(i, col);
            if (sh) {
              q.setFromAxisAngle(yAxis, -shAz);
              s.set(p[2], 1, sx);
              m.compose(pv.set(p[0], 0.05, p[1]), q, s);
              sh.setMatrixAt(i, m);
            }
          });
          im.frustumCulled = false;
          treesGroup.add(im);
        });
      });

      // farm buildings: house + shed + silo per farmstead
      var near = farms.filter(function (f) { return Math.hypot(f.x, f.z) < 12000; });
      var house = bake(new THREE.BoxGeometry(11, 3.4, 7, 1, 2, 1).translate(0, 1.7, 0), 0xeeeae0, SUN);
      var roofShape = new THREE.Shape(); roofShape.moveTo(-4, 0); roofShape.lineTo(0, 2.2); roofShape.lineTo(4, 0); roofShape.lineTo(-4, 0);
      var roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 12, bevelEnabled: false });
      roofGeo.translate(0, 3.4, -6); roofGeo.rotateY(Math.PI / 2);
      var roof = bake(roofGeo, 0xa3462e, SUN, { ao: 0 });
      var shed = bake(new THREE.BoxGeometry(16, 5.5, 11, 1, 2, 1).translate(0, 2.75, 0), 0xa9adaa, SUN);
      var silo = bake(new THREE.CylinderGeometry(2.6, 2.6, 11, 14, 2).translate(0, 5.5, 0), 0xd0d3d0, SUN, { keepNormals: true });
      var mHouse = new THREE.InstancedMesh(house, bakedMat, near.length);
      var mRoof = new THREE.InstancedMesh(roof, bakedMat, near.length);
      var mShed = new THREE.InstancedMesh(shed, bakedMat, near.length);
      var mSilo = new THREE.InstancedMesh(silo, bakedMat, near.length);
      near.forEach(function (f, i) {
        q.setFromAxisAngle(yAxis, f.a);
        s.set(1, 1, 1);
        m.compose(pv.set(f.x, 0, f.z), q, s); mHouse.setMatrixAt(i, m); mRoof.setMatrixAt(i, m);
        m.compose(pv.set(f.x + 24 * Math.cos(f.a), 0, f.z - 24 * Math.sin(f.a) + 10), q, s); mShed.setMatrixAt(i, m);
        var siloS = f.seed < 0.5 ? 1 : 0.0001;
        s.set(siloS, siloS, siloS);
        m.compose(pv.set(f.x + 36 * Math.cos(f.a), 0, f.z - 36 * Math.sin(f.a) + 22), q, s); mSilo.setMatrixAt(i, m);
      });
      [mHouse, mRoof, mShed, mSilo].forEach(function (im2) { im2.frustumCulled = false; treesGroup.add(im2); });
    })();

    /* --------------------------------------------- the airplane's own ground shadow */
    // Parts in cockpit coordinates (x right, z aft, metres) with their height above the ground when on the wheels.
    var planeShadow = new THREE.Group();
    planeShadow.name = 'airplane-shadow';
    group.add(planeShadow);
    var planeParts = [];
    (function buildPlaneShadow() {
      function tex(w, h, draw) {
        var c = makeCanvas(w, h), g = c.getContext('2d');
        softFill(g, Math.max(3, h * 0.05), 'rgba(0,0,0,1)', draw);
        return canvasTexture(c, false);
      }
      // wing: 10.16 m × 1.6 m, rounded tips
      var wingT = tex(512, 96, function (g) {
        g.beginPath(); g.moveTo(20, 18); g.lineTo(492, 18); g.quadraticCurveTo(504, 48, 492, 78); g.lineTo(20, 78); g.quadraticCurveTo(8, 48, 20, 18); g.fill();
      });
      // fuselage + tail cone (nose at the top of the canvas)
      var bodyT = tex(64, 512, function (g) {
        g.beginPath(); g.moveTo(32, 12);
        g.bezierCurveTo(56, 20, 58, 120, 54, 200); g.bezierCurveTo(48, 320, 38, 440, 35, 500);
        g.lineTo(29, 500); g.bezierCurveTo(26, 440, 16, 320, 10, 200); g.bezierCurveTo(6, 120, 8, 20, 32, 12); g.fill();
      });
      var htT = tex(256, 96, function (g) {
        g.beginPath(); g.moveTo(16, 30); g.lineTo(240, 30); g.lineTo(236, 78); g.lineTo(20, 78); g.closePath(); g.fill();
      });
      var blobT = canvasTexture(drawBlob(64, 0.35), false);
      function add(texture, w, l, x, z, h, opacity) {
        var g = new THREE.PlaneGeometry(w, l);
        g.rotateX(-Math.PI / 2);
        var m = layerMesh(g, decalMat({ map: texture, opacity: opacity }, 400), 131);
        planeShadow.add(m);
        planeParts.push({ mesh: m, x: x, z: z, h: h, opacity: opacity });
      }
      add(wingT, 10.6, 1.9, 0, 1.3, 1.85, 0.5);
      add(bodyT, 1.3, 7.8, 0, 2.3, 0.95, 0.45);
      add(htT, 3.3, 1.2, 0, 4.85, 1.32, 0.48);
      add(blobT, 0.9, 1.1, -1.16, 1.2, 0.0, 0.55);     // tyre contact shadows
      add(blobT, 0.9, 1.1, 1.16, 1.2, 0.0, 0.55);
      add(blobT, 0.7, 0.9, 0, -0.27, 0.0, 0.5);
    })();

    /* --------------------------------------------------------------- clouds */
    // One instanced draw (2 × 2 texture atlas), sorted back-to-front every frame; each cumulus = a main sprite plus a
    // smaller one slightly in front for depth. Shadows: soft blobs on the ground below them along the sun direction.
    var cloudAtlas = makeCanvas(1024, 512);
    (function () {
      var g = cloudAtlas.getContext('2d');
      [11, 12, 13, 14].forEach(function (seed, i) { drawCloud(g, (i % 2) * 512, Math.floor(i / 2) * 256, 512, 256, seed); });
    })();
    var cloudTex = canvasTexture(cloudAtlas, false);
    var cloudData = [];
    (function buildClouds() {
      var r = mulberry32(2026);
      for (var i = 0; i < 38; i++) {
        var ang = r() * Math.PI * 2, dist = 2500 + Math.sqrt(r()) * 20000;
        var altFt = 3600 + r() * 1600;
        var w = 520 + r() * 1300;
        var x = Math.cos(ang) * dist, z = Math.sin(ang) * dist, y = (altFt - A.elevationFt) * FT;
        var atlas = Math.floor(r() * 4);
        cloudData.push({ x: x, y: y, z: z, w: w, h: w * 0.5, atlas: atlas, rank: i, main: true });
        var off = (r() - 0.5) * w * 0.7;
        cloudData.push({ x: x + Math.cos(ang + 1.57) * off, y: y - w * 0.04, z: z + Math.sin(ang + 1.57) * off, w: w * (0.45 + r() * 0.2),
          h: w * 0.24, atlas: (atlas + 1 + Math.floor(r() * 3)) % 4, rank: i, main: false, front: 120 + r() * 220 });
      }
    })();
    var cloudGeo = new THREE.PlaneGeometry(1, 1);
    cloudGeo.translate(0, 0.5, 0);   // base at y = 0 of each sprite: bases share one level
    var cloudAtlasAttr = new THREE.InstancedBufferAttribute(new Float32Array(cloudData.length * 2), 2);
    cloudAtlasAttr.setUsage(THREE.DynamicDrawUsage);
    cloudGeo.setAttribute('aAtlas', cloudAtlasAttr);
    var cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false });
    cloudMat.onBeforeCompile = function (shader) {
      hazeCompile(shader);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aAtlas;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_UV\n  vUv = uv * 0.5 + aAtlas;\n#endif');
    };
    cloudMat.customProgramCacheKey = function () { return 'c150-cloud'; };
    var clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudData.length);
    clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    clouds.frustumCulled = false;
    clouds.name = 'clouds';
    group.add(clouds);
    var cloudShadowGeo = new THREE.PlaneGeometry(1, 1);
    cloudShadowGeo.rotateX(-Math.PI / 2);
    var cloudShadows = new THREE.InstancedMesh(cloudShadowGeo, decalMat({ map: canvasTexture(drawBlob(128, 0.25), false), opacity: 0.2 }, 60000), 38);
    cloudShadows.renderOrder = 112;
    cloudShadows.frustumCulled = false;
    (function () {
      var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), n = 0;
      cloudData.forEach(function (c) {
        if (!c.main) return;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rank);
        s.set(c.w * 0.85, 1, c.w * 0.55);
        m.compose(p.set(c.x + SHADOW_DIR.x * (c.y + c.h * 0.3), 0.1, c.z + SHADOW_DIR.y * (c.y + c.h * 0.3)), q, s);
        cloudShadows.setMatrixAt(n++, m);
      });
    })();
    group.add(cloudShadows);

    /* ---------------------------------------------- redraw text when fonts load */
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        numCanvases.forEach(function (n) { drawNumber(n.c, n.t); n.tex.needsUpdate = true; });
        drawHangarSign(); signTex.needsUpdate = true;
      });
    }

    /* =============================================================== update */
    var mAir = new THREE.Matrix4();
    var euler = new THREE.Euler(0, 0, 0, 'YXZ');
    var time = 0;
    var hazeScale = 1, hazeTarget = 1;   // setHaze(): 1 = the usual hazy afternoon, < 1 = clearer air (eased)
    var mCloud = new THREE.Matrix4(), qCloud = new THREE.Quaternion(), vS = new THREE.Vector3(), vP = new THREE.Vector3();
    var cloudOrder = cloudData.map(function (c, i) { return i; });
    var cloudDist = new Float32Array(cloudData.length);
    var cloudVisible = cloudData.length;

    function updateClouds(px, py, pz) {
      var i;
      for (i = 0; i < cloudData.length; i++) {
        var c = cloudData[i];
        cloudDist[i] = (c.x - px) * (c.x - px) + (c.z - pz) * (c.z - pz) + (c.y - py) * (c.y - py);
      }
      cloudOrder.sort(function (a, b) { return cloudDist[b] - cloudDist[a]; });
      var n = 0, arr = cloudAtlasAttr.array;
      for (i = 0; i < cloudOrder.length; i++) {
        var cd = cloudData[cloudOrder[i]];
        if (api.quality < 1 && cd.rank % 2 === 1) continue;
        if (api.quality < 2 && !cd.main) continue;
        // billboard about the vertical axis toward the eye (bases stay level in the WORLD frame)
        var dx = px - cd.x, dz = pz - cd.z, l = Math.hypot(dx, dz) || 1;
        var ux = dx / l, uz = dz / l;
        qCloud.setFromAxisAngle(UP, Math.atan2(ux, uz));
        vS.set(cd.w, cd.h, 1);
        mCloud.compose(vP.set(cd.x + (cd.front ? ux * cd.front : 0), cd.y, cd.z + (cd.front ? uz * cd.front : 0)), qCloud, vS);
        clouds.setMatrixAt(n, mCloud);
        arr[n * 2] = (cd.atlas % 2) * 0.5; arr[n * 2 + 1] = 0.5 - Math.floor(cd.atlas / 2) * 0.5;
        n++;
      }
      clouds.count = n;
      cloudVisible = n;
      clouds.instanceMatrix.needsUpdate = true;
      cloudAtlasAttr.needsUpdate = true;
    }
    var UP = new THREE.Vector3(0, 1, 0);

    function updatePlaneShadow(px, pz, h, agl) {
      var fade = 1 - smoothstep(8, 45, agl);
      planeShadow.visible = fade > 0.01;
      if (!planeShadow.visible) return;
      var ch = Math.cos(h), sh = Math.sin(h);
      for (var i = 0; i < planeParts.length; i++) {
        var pp = planeParts[i], hh = pp.h + agl;
        var gx = px + pp.x * ch - pp.z * sh + SHADOW_DIR.x * hh;
        var gz = pz + pp.x * sh + pp.z * ch + SHADOW_DIR.y * hh;
        pp.mesh.position.set(gx, 0.03, gz);
        pp.mesh.rotation.y = -h;
        // contact shadows only on the ground; part shadows soften and fade as the airplane climbs
        pp.mesh.material.opacity = pp.opacity * (pp.h === 0 ? (agl < 0.3 ? 1 : 0) : fade);
        pp.mesh.visible = pp.mesh.material.opacity > 0.01;
      }
    }

    function update(state, dt) {
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      time += dt;
      var air = (state && state.air) || {};
      var pos = (state && state.pos) || { x: 0, z: 0 };
      var elev = (state && isFinite(state.fieldElevation)) ? state.fieldElevation : A.elevationFt;
      var alt = isFinite(air.altitude) ? air.altitude : elev;
      var agl = air.onGround ? 0 : Math.max(0, (alt - elev) * FT);
      var px = isFinite(pos.x) ? pos.x : 0, pz = isFinite(pos.z) ? pos.z : 0, py = agl + FLOOR_AGL;
      var h = (isFinite(air.heading) ? air.heading : 0) * DEG;
      var p = (isFinite(air.pitch) ? air.pitch : 0) * DEG;
      var b = (isFinite(air.bank) ? air.bank : 0) * DEG;

      // airplane pose in the world: T · R_y(-h) · R_x(pitch) · R_z(-bank)  →  world = its inverse
      euler.set(p, -h, -b, 'YXZ');
      mAir.makeRotationFromEuler(euler);
      mAir.setPosition(px, py, pz);
      group.matrix.copy(mAir).invert();
      group.matrixWorldNeedsUpdate = true;

      // things that travel with the airplane
      sky.position.set(px, py, pz);
      ground.position.set(px, 0, pz);
      groundUniforms.uOffset.value.set(px, pz);
      groundUniforms.uTime.value = time;

      // aerial perspective: sun / ground-up in scene space, eye height
      hazeU.uSunS.value.copy(SUN).transformDirection(group.matrix);
      hazeU.uUpS.value.set(0, 1, 0).transformDirection(group.matrix);
      hazeU.uEyeH.value = agl + 1.5;
      if (hazeScale !== hazeTarget) {
        hazeScale += (hazeTarget - hazeScale) * Math.min(1, dt / 0.45);
        if (Math.abs(hazeTarget - hazeScale) < 0.004) hazeScale = hazeTarget;
        hazeU.uHazeA.value = HAZE_A * hazeScale;
      }
      fog.near = 3000 + agl * 3;
      fog.far = Math.min(HAZE_FAR, 30000 + agl * 12);

      updateClouds(px, py, pz);
      updatePlaneShadow(px, pz, h, agl);
      treeShadowGroup.visible = api.quality >= 1 && agl < 900;
      buildingShadow.visible = agl < 2500;

      // windsock: gentle flapping around 240°
      sockPivot.rotation.set(0, sockYaw + Math.sin(time * 0.9) * 0.08 + Math.sin(time * 2.3) * 0.03,
        -0.12 + Math.sin(time * 1.7) * 0.04);
    }

    /** Visibility of the day: scale of the aerial-haze density (1 = default; 0.45 = a clear, crisp winter day with the
     *  horizon sharp against the sky). Eased over ≈ 0.5 s in update(); the exterior 'cielo' view shares it. */
    function setHaze(scale, instant) {
      hazeTarget = Math.min(2, Math.max(0.2, isFinite(scale) ? +scale : 1));
      if (instant) { hazeScale = hazeTarget; hazeU.uHazeA.value = HAZE_A * hazeScale; }
      return hazeTarget;
    }

    function setQuality(level) {
      var q = typeof level === 'number' ? level : ({ low: 0, medium: 1, high: 2 }[level]);
      if (q == null) q = 2;
      api.quality = q;
      treesGroup.visible = q >= 1;
      treeShadowGroup.visible = q >= 1;
      cloudShadows.visible = q >= 1;
      groundUniforms.uDetailAmt.value = q >= 1 ? 1 : 0.6;
    }

    function getSunDirectionLocal(out) {
      out = out || new THREE.Vector3();
      return out.copy(SUN).transformDirection(group.matrix);
    }

    // unlit scenery: never tone mapped (RENDERING NOTES in core.js)
    group.traverse(function (o) { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.toneMapped = false; }); });

    /* ============================================== a second view of this scenery (exterior 'cielo' backdrop) */
    /**
     * world.createExteriorView() → { group, update(o), dispose() }: the same sky, haze, countryside, airfield and clouds
     * for ANOTHER scene (exterior.js), sharing every geometry and texture (no extra GPU memory except the copied scene
     * graph and a few materials). Its materials get their own haze uniforms (that scene's frame: up = +Y, sun turned
     * by the heading); the airplane's own ground-shadow decals are left out (the exterior has a real shadow).
     * update(o) once per frame AFTER world.update(): o = { x, z (world m), heading (°), agl (m: ground below the
     * airplane's CG), groundY (scene y of the ground when agl = 0), eyeH (camera height above the ground, m),
     * far (camera far) }. The view's root: scene = T(0, groundY − agl, 0) · R_y(heading) · T(−x, 0, −z) · world.
     */
    function createExteriorView() {
      var hz = {
        uHazeColor: hazeU.uHazeColor, uHazeSun: hazeU.uHazeSun, uHazeA: hazeU.uHazeA, uHazeB: hazeU.uHazeB,
        uSunS: { value: SUN.clone() }, uUpS: { value: new THREE.Vector3(0, 1, 0) },
        uEyeH: { value: 1.5 }, uHazeFar: { value: HAZE_FAR }
      };
      var FLAGS = ['side', 'transparent', 'depthWrite', 'depthTest', 'blending', 'blendSrc', 'blendDst', 'blendEquation', 'toneMapped',
        'opacity', 'vertexColors', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'premultipliedAlpha', 'alphaTest',
        'colorWrite', 'visible'];
      var mats = [], matMap = [];
      function viewMat(m) {
        for (var i = 0; i < matMap.length; i++) if (matMap[i][0] === m) return matMap[i][1];
        var c;
        if (m.isShaderMaterial) {
          var u = {};
          for (var key in m.uniforms) u[key] = hz[key] || m.uniforms[key];   // textures and the rest: shared objects
          c = new THREE.ShaderMaterial({ uniforms: u, vertexShader: m.vertexShader, fragmentShader: m.fragmentShader });
          c.defines = Object.assign({}, m.defines);
          c.fog = false;
          FLAGS.forEach(function (f) { c[f] = m[f]; });
        } else {
          c = m.clone();   // keeps the texture references (no texture copies)
          var inner = m.onBeforeCompile, innerKey = m.customProgramCacheKey();
          c.onBeforeCompile = function (shader, renderer) {
            inner.call(this, shader, renderer);
            for (var key2 in hz) if (shader.uniforms[key2]) shader.uniforms[key2] = hz[key2];
          };
          c.customProgramCacheKey = function () { return 'c150-xview:' + innerKey; };
        }
        mats.push(c); matMap.push([m, c]);
        return c;
      }
      var pairs = [];
      function copyNode(o) {
        if (o === planeShadow) return null;
        var c;
        if (o.isInstancedMesh) {
          c = new THREE.InstancedMesh(o.geometry, viewMat(o.material), o.count);
          c.instanceMatrix = o.instanceMatrix;          // shared attribute: one GPU buffer, updated by world.update
          if (o.instanceColor) c.instanceColor = o.instanceColor;
        } else if (o.isMesh) c = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? o.material.map(viewMat) : viewMat(o.material));
        else if (o.isLineSegments) c = new THREE.LineSegments(o.geometry, viewMat(o.material));
        else if (o.isLine) c = new THREE.Line(o.geometry, viewMat(o.material));
        else if (o.isPoints) c = new THREE.Points(o.geometry, viewMat(o.material));
        else if (o.isSprite) c = new THREE.Sprite(viewMat(o.material));
        else c = new THREE.Group();
        c.name = o.name; c.renderOrder = o.renderOrder; c.frustumCulled = o.frustumCulled;
        c.matrixAutoUpdate = o.matrixAutoUpdate;
        c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale); c.visible = o.visible;
        if (!o.matrixAutoUpdate) c.matrix.copy(o.matrix);
        pairs.push([o, c]);
        for (var i = 0; i < o.children.length; i++) { var cc = copyNode(o.children[i]); if (cc) c.add(cc); }
        return c;
      }
      var vg = new THREE.Group();
      vg.name = 'world-view';
      vg.matrixAutoUpdate = false;
      for (var i = 0; i < group.children.length; i++) { var cn = copyNode(group.children[i]); if (cn) vg.add(cn); }
      var mR = new THREE.Matrix4(), mT = new THREE.Matrix4(), UPV = new THREE.Vector3(0, 1, 0);
      function updateView(o) {
        o = o || {};
        // follow the moving parts of the original (sky / ground re-centred on the airplane, windsock, clouds, LOD)
        for (var p = 0; p < pairs.length; p++) {
          var a = pairs[p][0], b = pairs[p][1];
          b.visible = a.visible;
          if (a.matrixAutoUpdate) { b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); }
          if (a.isInstancedMesh) b.count = a.count;
        }
        var h = (isFinite(o.heading) ? o.heading : 0) * DEG, agl = isFinite(o.agl) ? Math.max(0, o.agl) : 0;
        var gy = isFinite(o.groundY) ? o.groundY : 0;
        mT.makeTranslation(-(o.x || 0), 0, -(o.z || 0));
        mR.makeRotationY(h);
        mR.setPosition(0, gy - agl, 0);
        vg.matrix.multiplyMatrices(mR, mT);
        vg.matrixWorldNeedsUpdate = true;
        hz.uSunS.value.copy(SUN).applyAxisAngle(UPV, h);
        hz.uUpS.value.set(0, 1, 0);
        hz.uEyeH.value = Math.max(0.5, isFinite(o.eyeH) ? o.eyeH : agl + 1.5);
        hz.uHazeFar.value = Math.min(HAZE_FAR, (o.far || 60000) * 0.9);
      }
      function dispose() {
        if (vg.parent) vg.parent.remove(vg);
        mats.forEach(function (m) { m.dispose(); });
      }
      return { group: vg, update: updateView, dispose: dispose, haze: hz };
    }

    api.createExteriorView = createExteriorView;
    api.group = group;
    api.update = update;
    api.setQuality = setQuality;
    api.setHaze = setHaze;
    api.getHaze = function () { return hazeTarget; };
    api.fog = fog;
    api.sunDirection = SUN;
    api.getSunDirectionLocal = getSunDirectionLocal;
    api.airport = A;
    api.quality = 2;
    api.cloudCount = function () { return cloudVisible; };
    void rnd;
    C150.World.current = api;   // the last world created (exterior.js reuses its scenery for the 'cielo' backdrop)
    return api;
  }

  C150.World = { create: create, NEAR: 0.03, FAR: 60000, FLOOR_AGL: FLOOR_AGL };
})(root.C150);
