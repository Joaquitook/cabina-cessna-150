var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * core.js — C150.Core (contract §4): owns the ONE WebGL renderer/canvas, the main scene (world + cockpit + lights),
 * the main camera with OrbitControls, the exterior inset (scissor viewport) and the swap, picking, direct drag
 * manipulation, press-and-hold inputs, keyboard flying and the render loop.
 *
 * API (contract §4 + extras marked *)
 *   C150.Core.init({ container, state, toneMapping* })  → true | false (false = no WebGL / no THREE: an 'error' event
 *                                                        carries a Spanish message; it is replayed to late listeners)
 *   C150.Core.on(event, fn) → unsubscribe fn            C150.Core.off(event, fn)*
 *     'hover'(id|null, subId|null, {x,y})   'select'(id|null)   'operate'(id, subId|null)   'frame'(state, dt) ~15 Hz
 *     'viewchange'('cockpit'|'exterior')    'pick'(id)          'layout'(rect|null)  'error'(message)
 *     *'preset'(name|null) camera preset (null: the camera left it — user orbit or fly to a control)
 *     *'scenario'(name) sim preset applied (applyPreset)  *'pause'(bool)
 *     *'animend'(animName)  (an exterior animation finished on its own)
 *   select(id|null, {focus}) · focusPreset(name) · setMainView(name) · getMainView() · getInsetRect()
 *   setTargetHighlight(id|ids[]|null) · setExteriorHighlight(parts[]) · playExterior(anim|null, {enlarge, loop})
 *   operate(id, subId, value?) · setInput(path, value) · hold(id, subId, bool) · pickMode(fn|null)
 *   applyPreset(name) · state · setPaused(bool) · isMobile()
 *   *getSelected() · *pickAt(x, y) → {id, subId}|null · *projectControl(id) → {x, y, visible}|null (css px, container)
 *   *isDraggable(id) → bool (the control can be dragged in the 3D view)
 *   *setInsetVisible(bool) · *getCaption() (exterior caption) · *setToneMapping('none'|'aces') · *dispose()
 *   *setQuality('auto'|'alta'|'media'|'baja') · *getQuality() → 'alta'|'media'|'baja' · *getQualitySetting() → incl. 'auto'
 *     (event *'quality'(level, setting)). Static helpers usable without init (preview pages):
 *   *C150.Core.configureRenderer(renderer, level) · *C150.Core.createEnvironment(renderer, {cabin, studio, size}) → env
 *     (env.texture = PMREM texture for scene.environment; env.update(sunLocal, upLocal); env.dispose())
 *   *tick(dt) — run one frame by hand (tests, or hosts whose requestAnimationFrame is paused)
 *   Air lab (contract v2 §3): *airflow (C150.Airflow on the exterior, created after it when airflow.js is loaded; null
 *     otherwise) · *setAirflow(opts) → settings|null (flow.set: enabled, streamlines, propwash, vortices, pressure,
 *     forces, moments, trails, density, slowmo) · *getAirflow() · *setBackdrop('estudio'|'cielo'|'tunel') → bool ·
 *     *getBackdrop() · *setExteriorView(name | airflow region | {pos, target}) → bool. The flow is updated every frame
 *     while the exterior is on screen (main view, or the inset at density 'baja'), capped by the render quality.
 *   *cockpit, *world, *exterior, *renderer, *camera, *controls (read-only references, for the UI and debugging)
 *
 * Decisions where the contract leaves room (other agents: please read):
 *  - Colour pipeline: physically based (see RENDERING NOTES below). setToneMapping('none') is kept for debugging.
 *  - The inset border is drawn by core itself in WebGL (scissor clears: 1 px dark outline + 2 px light frame), so the
 *    UI does not need a DOM border; 'layout' still gives the rect ({x,y,w,h, main}) for labels/buttons.
 *    'layout'(null) / getInsetRect() → null when there is no inset (exterior module missing, hidden, tiny canvas).
 *  - Inset size: desktop width = clamp(170, 30 % W, 360); phones (isMobile) width = clamp(120, 42 % W, 360);
 *    4:3, and never taller than 45 % of the canvas height (landscape phones).
 *  - A click (no drag) inside the inset swaps the main view; drags and wheel over the inset are swallowed.
 *  - Canvas is absolutely positioned to fill the container (container gets position:relative if it was static).
 *    Only events whose target is the canvas are handled: UI overlays inside the container keep their own events.
 *  - 'select' is emitted only when the selection changes. select(id, {focus:true}) while the exterior is the main view
 *    swaps back to the cockpit. Highlight priority per control: selected > target > hover.
 *  - pickMode(fn) is ONE-SHOT: the next click on a control calls fn(id), emits 'pick'(id) and clears the mode.
 *  - operate() defaults (§7) with these interpretations: ignition cycles OFF→R→L→BOTH→START (START returns to BOTH
 *    after 1.2 s); from BOTH the next click is START if the engine is stopped, OFF if it is running. Flaps: if
 *    flaps > 0 → UP (latched) else DOWN for 2 s then OFF; clicking again while that DOWN is running adds 2 s. Perilla:
 *    +1 step, wrapping to min after max. Radio: navcom → COM power on/off, transponder → OFF→SBY→ON→ALT. Puertas:
 *    subId left/right/window (default left). Yoke/pedals/toe-brakes → short demo wiggle. Instruments (probar null) →
 *    nothing, returns false. Sliders (throttle, mixture, carb heat, cabin heat/air, trim): +/-25 % of the travel per
 *    click, keeping its direction and bouncing at the ends, plus a hint event (state.events). With a value:
 *    sets it directly (ignition 'START' and flaps 'DOWN' stay momentary).
 *  - setInput(path, value) is RAW (no momentary behaviour) but routes ignition/flapSwitch/masterBat/masterAlt through
 *    C150.Sim.actions and clamps known ranges; it cancels any core spring/ramp on yokeRoll/yokePitch/rudder, so a UI
 *    drag pad can hold a value. Use operate()/hold() for momentary semantics.
 *  - hold(id, subId, bool): 'rudder-pedals' left|right · 'toe-brakes' left|right|null(both) · 'flap-switch' or
 *    'flap-indicator' down (default) | up · 'ignition' start · extra: 'yoke' left|right|pull|push.
 *  - Drag: yoke 120 px = full; rudder 120 px; trim wheel 120 px per unit (up = nose down); knobs follow the screen
 *    projection of cockpit.dragAxes[id].axis (value-increasing direction) with at least 90 px for the full travel;
 *    when the axis points almost at the camera the drag falls back to screen-vertical (push in = up). The primer can be
 *    dragged too: a full out-and-in cycle counts one stroke (C150.Sim.actions.primeStroke).
 *  - Control lock installed: yoke drags/keys/holds/demos do nothing and push the event "Primero sacá la traba de
 *    comandos." (state.events, at most once every 4 s). Pedals and brakes still work (the real lock is yoke-only).
 *  - Camera: OrbitControls (rotate left-drag/one finger, pan right-drag/two fingers, wheel/pinch zoom, damping),
 *    distance 0.12–1.4 m, position clamped every frame to the cabin box, orbit pivot clamped to a slightly larger box.
 *    Views whose target is farther than the max distance (preset 'flight') keep their direction with the pivot
 *    0.9 m ahead. Fly-to is ease-in-out 0.8 s (instant with prefers-reduced-motion); grabbing the view cancels it.
 *  - Exterior as main view: its own OrbitControls (target shared with ext.target, not updated while ext.cameraBusy);
 *    grabbing it resets a non-vertical camera.up (top view) to +Y. Exterior views are framed for 4:3, so on narrower
 *    viewports (portrait phones) core widens ext.camera.fov to keep the 4:3 horizontal coverage (max 75°).
 *  - Paused: the sim does not advance but the cockpit/world/exterior keep animating the inputs. Rendering stops while
 *    document.hidden. If requestAnimationFrame stops arriving on a VISIBLE page for > 250 ms (some embedded preview
 *    panes/iframes do that), a ~30 Hz timer drives tick() until animation frames come back.
 *
 * ================================ RENDERING NOTES (pipeline conventions — world.js / exterior.js / cockpit.js follow) ==
 *  Colour management (three r147):
 *   - THREE.ColorManagement.legacyMode = false (set when core.js loads and again in init/configureRenderer, BEFORE any
 *     module creates materials). So Color.setHex / setStyle / hex material colours are read as sRGB and stored LINEAR.
 *     Color.setRGB(r,g,b) is NOT converted (it takes linear values): for display values use
 *     color.setRGB(r,g,b).convertSRGBToLinear(). Raw vertex-colour arrays must be linear too (sRGB → linear).
 *   - renderer.outputEncoding = sRGBEncoding. Every canvas texture holding COLOUR (map, emissiveMap, sprite maps,
 *     colour lookups inside ShaderMaterials) must be tagged texture.encoding = THREE.sRGBEncoding. Data textures
 *     (bump/normal/roughness/detail, multipliers sampled as numbers) stay LinearEncoding.
 *   - Custom ShaderMaterials: end with '#include <encodings_fragment>' and feed them LINEAR colours (THREE.Color
 *     uniforms built from hex are already linear). They are never tone mapped (they lack <tonemapping_fragment>).
 *   - renderer.setClearColor / fills write raw values: core builds those colours with setRGB (no conversion).
 *  Tone mapping: renderer.toneMapping = ACESFilmicToneMapping; exposure is set per scene right before each render()
 *   (renderCabin: EXPOSURE 1.12, a bright airy cabin; renderExterior: EXPOSURE_EXT 1.0, the studio lights are tuned
 *   for it; three r147 divides it by 0.6 inside ACES). Opted OUT (material.toneMapped = false): everything in world.group (unlit scenery: authored
 *   colours shown 1:1, a bright view through the windshield), the exterior's unlit helpers (MeshBasic/Sprite/Line:
 *   ground disk, overlays, labels — core does this after Exterior.create) and the cockpit gauge faces (cockpit.js:
 *   crisp dials). Lit PBR materials (cockpit, exterior airplane) ARE tone mapped.
 *  Lights: renderer.physicallyCorrectLights = true. A DirectionalLight of intensity π lights a white Lambert surface
 *   facing it to 1.0 (legacy three multiplied every light by π: legacy value × π ≈ same look). Main scene: sun
 *   DirectionalLight (LIGHT.sun, warm white, aimed with world.getSunDirectionLocal, target = cabin centre) +
 *   HemisphereLight (LIGHT.hemi, low fill) + warm 'bounce' DirectionalLight from the floor (LIGHT.bounce, no shadow).
 *   Point lights (cockpit dome/flood) use decay 2 and candela-like intensities (matched to the legacy look at the
 *   panel / seat distance: with 1/d² they are brighter than legacy right next to the fixture, so higher values tint
 *   the whole sunlit cabin). The exterior scene keeps its own studio rig (exterior.js, same units): key light =
 *   world.sunDirection (ext.setSun at init, turned by the heading every frame) with its own soft shadow map,
 *   camera-relative fill and rim, low hemisphere fill.
 *  Shadows: PCFSoftShadowMap ('alta') / PCFShadowMap ('media') / off ('baja'). Only the main sun casts: orthographic
 *   shadow camera ±SHADOW_HALF m around SHADOW_CENTER (the cabin), map 2048² ('alta') / 1024² ('media'),
 *   bias SHADOW_BIAS, normalBias SHADOW_NBIAS (metres). sun.shadow.autoUpdate = false: the map is re-rendered only
 *   when the sun direction moves or cockpit.motion changes (a door, yoke, pedal… moved). cockpit.js sets
 *   castShadow/receiveShadow on its meshes (glass, decals, gauge faces and the cowling do not cast). world/exterior
 *   meshes do not cast into this map. The exterior key light has its own map (1536² alta / 1024² media, ±6.6 m,
 *   autoUpdate off: refreshed only when a surface, the attitude, the doors or the sun moved) received by the airplane
 *   itself and by a ShadowMaterial catcher on the floor; with shadows off ('baja') a painted planform replaces it. The world sun (world.js) is a mid-morning sun (az 105°, el 32°) so it shines in
 *   under the high wing through the windshield: sun patches and window/post shadows on seats, floor and side panels.
 *  Image-based lighting: PMREM environment maps from a procedural HDR sky scene (gradient sky, soft sun glow, horizon
 *   haze, ground) rendered into a HalfFloat cube target (256/128/64 by quality) and filtered with PMREMGenerator.
 *   - main scene.environment = 'cabin' env: that sky seen through window-shaped openings in cockpit space
 *     (windshield, door windows, rear window) with the interior around them (headliner, tan walls, carpet, dark panel
 *     area, the pilot/seat backs behind the instruments, so gauge glass reflects a dark cabin, not the sky). Re-baked
 *     when the sun / horizon move more than ENV_STEP degrees in cockpit space (turns, banks), at most every ~0.5 s.
 *   - ext.scene.environment = 'studio' env (opts.studio: soft blue-grey dome, light floor, horizon glow and white
 *     softboxes — an overhead strip, two side panels, a low front panel — for clean highlights on the clearcoat
 *     paint and glass), only if exterior.js did not set one itself. The lights demo (dusk) dims it per material
 *     (exterior setEnvDim → envMapIntensity).
 *   Materials with their own envMap keep it; envMapIntensity tunes per material. The env maps hold NO sun disc (the
 *   DirectionalLight gives the sun's specular, and shadowed areas must not pick it up from the env).
 *  Quality ('alta' desktop, 'media' phones/low-end, 'baja' fallback): pixel ratio ≤ 2 / 1.5 / 1, shadows, env size,
 *   cockpit.setQuality (detail-normal texturing), world.setQuality('high'|'medium'|'low'). 'auto' picks by device and
 *   steps down once if frames stay slow (> 40 ms for ~4 s of real animation frames).
 *  Colour grade / vignette: a CSS overlay div (.c150-grade, inline styles set by core) right above the canvas —
 *   never WebGL post-processing.
 *  Draw order: world.js sky/ground layers use renderOrder 100…130 (after every opaque object, depth-tested), so the
 *   cabin hides them early on the GPU; keep opaque cockpit/exterior parts below renderOrder 100.
 *  Cockpit materials (cockpit.js): MeshStandardMaterial + one shared onBeforeCompile (triplanar procedural relief via
 *   userData.detail, a cabin 'sky visibility' term that darkens indirect light in the footwell / panel recess,
 *   a fresnel highlight rim, reflective premultiplied glass via userData.glass). Measured on a Radeon 740M at
 *   1440×900 ('alta', 1008×844 canvas): ≈ 5.6 ms GPU + 2.5 ms CPU per frame. Pass 2 (timer queries, same GPU in a
 *   background preview pane, probably at low clocks): 'flight' view on the runway ≈ 10 ms GPU (world ≈ 0.8 ms,
 *   exterior inset ≈ 0.5 ms) + 3.5 ms CPU; exterior main view ≈ 8–9.5 ms GPU + 3.8 ms CPU.
 *  Exterior overlays: label pills are clamped inside the viewport, de-overlapped and kept clear of the cockpit inset
 *   (ext.setOccluder, set in layoutViews) in Scene.onBeforeRender; small viewports show only the main part labels.
 *  Any further pass: follow the rules above (sRGB-tag colour canvases, linear vertex colours, physical light units,
 *   toneMapped=false only for unlit helpers).
 */
(function (C150) {
  'use strict';

  // RENDERING NOTES: hex colours are sRGB and stored linear. Must run before any module builds materials.
  function modernColorManagement(THREE) {
    try { if (THREE && THREE.ColorManagement && 'legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false; } catch (e) { /* old three */ }
  }
  modernColorManagement(root.THREE);

  /* ------------------------------------------------------------------ rendering constants (RENDERING NOTES) */
  var EXPOSURE = 1.12;       // cabin: a bright, airy afternoon on the apron (the unlit world is not tone mapped)
  var EXPOSURE_EXT = 1.0;    // exterior studio (its lights are tuned for 1.0)
  var LIGHT = {
    sun: 3.3, sunColor: [1.0, 0.955, 0.89],          // linear rgb, warm noon sun
    hemi: 0.58, hemiSky: [0.70, 0.80, 1.0], hemiGround: [0.42, 0.33, 0.24],
    bounce: 0.46, bounceColor: [1.0, 0.80, 0.62]      // warm light reflected by the sunlit floor / seats
  };
  var SHADOW_CENTER = [0, 0.56, 0.42], SHADOW_HALF = 1.3, SHADOW_DIST = 5;
  var SHADOW_BIAS = -0.00025, SHADOW_NBIAS = 0.0035;
  var ENV_STEP = 6, ENV_MIN_INTERVAL = 0.45;
  var QUALITY = {
    alta: { pr: 2, shadow: 2048, soft: true, env: 256, world: 'high', detail: 2 },
    media: { pr: 1.5, shadow: 1024, soft: false, env: 128, world: 'medium', detail: 1 },
    baja: { pr: 1, shadow: 0, soft: false, env: 64, world: 'low', detail: 0 }
  };
  var QUALITY_ORDER = ['alta', 'media', 'baja'];

  /* ------------------------------------------------------------------ constants */
  var CABIN ={ x0: -0.47, x1: 0.47, y0: 0.12, y1: 1.0, z0: -0.30, z1: 1.6 };
  var PIVOT = { x0: -0.62, x1: 0.62, y0: -0.05, y1: 1.15, z0: -1.2, z1: 1.75 };
  var MIN_DIST = 0.12, MAX_DIST = 1.4;
  var FLY_TIME = 0.8;
  var CLICK_PX = 6, CLICK_MS = 400;
  var YOKE_PX = 120, PEDAL_PX = 120, TRIM_PX = 120, KNOB_MIN_PX = 90;
  var SPRING_TIME = 0.3, KEY_RATE = 1.5, HOLD_RATE = 4;
  var START_MOMENTARY = 1.2, FLAP_MOMENTARY = 2.0;
  var THROTTLE_STEP = 0.05, TRIM_STEP = 0.03;
  var FRAME_EVENT_DT = 1 / 15;
  var INSET_MARGIN = 12;
  var LOCK_MSG = 'Primero sacá la traba de comandos.';
  var LOCK_MSG_INTERVAL = 4;
  var SLIDER_NUDGE = 0.25;   // click on a selected slider control: 25 % of its travel
  var SLIDER_HINT = 'Arrastrá la perilla o usá la ficha para un ajuste fino.';
  var EYE = [-0.235, 0.88, 0.70];
  var PRESET_KEYS = ['pilot', 'flight', 'panel', 'left', 'center', 'right', 'floor', 'overhead'];
  var AXES = ['yokeRoll', 'yokePitch', 'rudder'];
  var DRAG_KIND = {
    yoke: 'yoke', 'rudder-pedals': 'pedals', 'toe-brakes': 'brakes', 'trim-wheel': 'trim',
    throttle: 'knob', mixture: 'knob', 'carb-heat': 'knob', 'cabin-heat': 'knob', 'cabin-air': 'knob', primer: 'knob'
  };
  var KNOB_KEY = {
    throttle: 'throttle', mixture: 'mixture', 'carb-heat': 'carbHeat', 'cabin-heat': 'cabinHeat',
    'cabin-air': 'cabinAir', primer: 'primerOut'
  };
  // Value-increasing direction along Z when cockpit.dragAxes is missing (−1 = into the panel, +1 = out toward you).
  var KNOB_AXIS_Z = { throttle: -1, mixture: -1, 'carb-heat': 1, 'cabin-heat': 1, 'cabin-air': 1, primer: 1 };
  var INPUT_RANGE = {
    yokeRoll: [-1, 1], yokePitch: [-1, 1], rudder: [-1, 1], trim: [-1, 1], brakeL: [0, 1], brakeR: [0, 1],
    throttle: [0, 1], mixture: [0, 1], carbHeat: [0, 1], primerOut: [0, 1], cabinHeat: [0, 1], cabinAir: [0, 1],
    panelLights: [0, 1]
  };
  var XPDR_MODES = ['OFF', 'SBY', 'ON', 'ALT'];
  var LIGHT_SUBS = { dome: 1, nav: 1, strobe: 1, beacon: 1, taxi: 1, landing: 1 };
  var IGNITION_NEXT = { OFF: 'R', R: 'L', L: 'BOTH', START: 'BOTH' };
  // Built-in copy of the "probar" specs (used only when C150.DATA.controls is not loaded).
  var FALLBACK_PROBAR = {
    yoke: { tipo: 'yoke' }, 'rudder-pedals': { tipo: 'pedales' }, 'toe-brakes': { tipo: 'pedales' },
    'parking-brake': { tipo: 'toggle', clave: 'parkingBrake' }, 'control-lock': { tipo: 'toggle', clave: 'controlLock' },
    'fuel-shutoff': { tipo: 'toggle', clave: 'fuelValve' },
    'trim-wheel': { tipo: 'slider', clave: 'trim', min: -1, max: 1, paso: 0.05 },
    throttle: { tipo: 'slider', clave: 'throttle', min: 0, max: 1, paso: 0.01 },
    mixture: { tipo: 'slider', clave: 'mixture', min: 0, max: 1, paso: 0.01 },
    'carb-heat': { tipo: 'slider', clave: 'carbHeat', min: 0, max: 1, paso: 0.05 },
    'cabin-heat': { tipo: 'slider', clave: 'cabinHeat', min: 0, max: 1, paso: 0.05 },
    'cabin-air': { tipo: 'slider', clave: 'cabinAir', min: 0, max: 1, paso: 0.05 },
    'flap-switch': { tipo: 'flaps' }, 'flap-indicator': { tipo: 'flaps' },
    primer: { tipo: 'accion', accion: 'primeStroke' },
    ignition: { tipo: 'opciones', clave: 'ignition', valores: ['OFF', 'R', 'L', 'BOTH', 'START'] },
    master: { tipo: 'master' }, 'light-switches': { tipo: 'luces' },
    dimmers: { tipo: 'perilla', clave: 'panelLights', paso: 0.1, min: 0, max: 1 },
    altimeter: { tipo: 'perilla', clave: 'altimeterSetting', paso: 0.01, min: 28.1, max: 31 },
    'heading-indicator': { tipo: 'perilla', clave: 'hiCorrection', paso: 1, min: -180, max: 180 },
    'vor-indicator': { tipo: 'perilla', clave: 'radio.obs', paso: 5, min: 0, max: 355 },
    navcom: { tipo: 'radio' }, transponder: { tipo: 'radio' }, doors: { tipo: 'puertas' }
  };

  /* ------------------------------------------------------------------ small helpers */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function moveToward(v, target, step) { return v < target ? Math.min(target, v + step) : Math.max(target, v - step); }
  function nowMs() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function inRect(x, y, r) { return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }
  function getPath(obj, path) {
    var parts = String(path).split('.'), o = obj;
    for (var i = 0; i < parts.length; i++) { if (o == null) return undefined; o = o[parts[i]]; }
    return o;
  }
  function setPathRaw(obj, path, value) {
    var parts = String(path).split('.'), o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
  }
  function roundStep(v) { return Math.round(v * 1e6) / 1e6; }

  /* ------------------------------------------------------------------ module state (single instance) */
  var T = null, Sim = null;
  var inited = false, rafId = 0, lastNow = 0, clock = 0;
  var lastRafAt = 0, wdId = 0, wdLast = 0;   // timer fallback when requestAnimationFrame stalls on a visible page
  var grade = null;
  var container = null, canvas = null, renderer = null, ro = null, toneMode = 'none';
  var state = null;
  var scene = null, camera = null, controls = null, world = null, cockpit = null, ext = null, extControls = null;
  var flow = null;   // C150.Airflow on the exterior (airflow.js, optional)
  var hemi = null, sun = null, bounce = null;
  var shadowSun = null, shadowMotion = -1;
  var envCabin = null, envOutdoor = null, envAge = 1e9, envSun = null, envUp = null, envUpNow = null;
  var quality = 'alta', qualitySetting = 'auto', slowTime = 0, slowFrames = 0, autoSteps = 0;
  var size = { w: 1, h: 1 }, insetRect = null, insetVisible = true, mainView = 'cockpit', enlargeRestore = null;
  var reducedMotion = false, mqReduced = null, mqCoarse = null;
  var listeners = {}, lastError = null, reported = {};
  var selected = null, hovered = { id: null, sub: null }, targets = {}, pickFn = null;
  var fly = null;
  var ptr = null, pointersDown = {}, pointerCount = 0;
  var hoverPos = { x: 0, y: 0, inside: false, dirty: false };
  var axes = {};
  var keys = {};
  var holdState = { yoke: { left: false, right: false, pull: false, push: false }, rudder: { left: false, right: false }, brakeL: false, brakeR: false };
  var brakeOwned = { L: false, R: false }, dragBrake = { L: false, R: false }, keyBrake = false;
  var flapHolders = { key: false, ui: false }, flapTimer = null;
  var ignHeld = false, ignTimer = null;
  var demo = null, primerAnim = null, primerArmed = false;
  var extBaseFov = 35, lockWarnAt = -1e9, frameAcc = 0, sizeCheck = 0, prevPlaying = null, extBusyPrev = false;
  var probarIndex = null, probarCount = -1, sliderDir = {};
  var domHandlers = [];
  // scratch objects (no per-frame allocation)
  var raycaster = null, ndc = null, hits = [], hoverHit = { id: null, sub: null };
  var vA = null, vB = null, vC = null, vSun = null, camTarget = null, tmpColor = null, colDark = null, colLight = null;

  function resetAxes() {
    for (var i = 0; i < AXES.length; i++) axes[AXES[i]] = { driver: null, spring: null };
  }
  resetAxes();

  /* ------------------------------------------------------------------ events */
  function on(ev, fn) {
    if (typeof fn !== 'function') return function () {};
    (listeners[ev] = listeners[ev] || []).push(fn);
    if (ev === 'error' && lastError) { try { fn(lastError); } catch (e) { console.error(e); } }
    return function () { off(ev, fn); };
  }
  function off(ev, fn) {
    var l = listeners[ev]; if (!l) return;
    var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  }
  function emit(ev, a, b, c) {
    var l = listeners[ev];
    if (!l || !l.length) return;
    l = l.slice();
    for (var i = 0; i < l.length; i++) {
      try { l[i](a, b, c); } catch (e) { console.error('[C150.Core] listener for "' + ev + '" failed:', e); }
    }
  }
  function fail(message, err) {
    lastError = message;
    console.error('[C150.Core] ' + message, err || '');
    emit('error', message);
  }
  function reportOnce(where, err) {
    if (reported[where]) return;
    reported[where] = true;
    console.error('[C150.Core] ' + where + ' failed (further errors from it are silenced):', err);
  }

  /* ------------------------------------------------------------------ state helpers */
  function pushEvent(text, kind) {
    if (!state) return;
    if (!Array.isArray(state.events)) state.events = [];
    if (state.events.length >= 40) state.events.shift();
    state.events.push({ t: Math.round(num(state.time, 0) * 10) / 10, text: text, kind: kind || 'info' });
  }
  function lockWarning() {
    if (clock - lockWarnAt < LOCK_MSG_INTERVAL) return;
    lockWarnAt = clock;
    pushEvent(LOCK_MSG, 'warn');
  }
  function locked() { return !!(state && state.controlLock); }
  function engineRunning() { return !!(state && state.engine && state.engine.running); }
  function actions() { return (Sim && Sim.actions) || null; }

  function setIgnition(pos) {
    var a = actions();
    if (a && a.setIgnition) a.setIgnition(state, pos); else state.ignition = pos;
  }
  function setFlapSwitch(pos) {
    var a = actions();
    if (a && a.setFlapSwitch) a.setFlapSwitch(state, pos); else state.flapSwitch = pos;
  }
  function setMaster(which, onOff) {
    var a = actions();
    if (a && a.setMaster) { a.setMaster(state, which, !!onOff); return; }
    if (which === 'alt') { state.masterAlt = !!onOff; if (onOff) state.masterBat = true; }
    else { state.masterBat = !!onOff; if (!onOff) state.masterAlt = false; }
  }
  function primeStroke() {
    var a = actions();
    if (a && a.primeStroke) a.primeStroke(state);
    else { state.primerLocked = false; if (state.engine) state.engine.primeCharges = num(state.engine.primeCharges, 0) + 1; }
  }

  /** Minimal state with the contract input fields (only when neither a state nor C150.Sim is available). */
  function fallbackState() {
    return {
      variant: '150M', yokeRoll: 0, yokePitch: 0, rudder: 0, brakeL: 0, brakeR: 0, parkingBrake: false, controlLock: false,
      throttle: 0, mixture: 1, carbHeat: 0, primerOut: 0, primerLocked: true, ignition: 'OFF', masterBat: false,
      masterAlt: false, flapSwitch: 'OFF', trim: 0, fuelValve: true, cabinHeat: 0, cabinAir: 0,
      lights: { dome: false, nav: false, strobe: false, beacon: false, taxi: false, landing: false }, pitotHeat: false,
      panelLights: 0, radio: { comOn: false, comFreq: 118.1, comStby: 121.9, navFreq: 113.9, navStby: 116.3, obs: 0, xpdrMode: 'OFF', xpdrCode: '7000' },
      altimeterSetting: 29.92, hiCorrection: 0, doorLeftOpen: false, doorRightOpen: false, windowLeftOpen: false, paused: false,
      engine: { running: false, rpm: 0, primeCharges: 0 }, elec: { busVolts: 0, highVoltageLight: false },
      air: { onGround: true, pitch: 0, bank: 0, heading: 150, altitude: 100 }, pos: { x: 0, z: 0 }, flaps: 0, propRpm: 0,
      events: [], time: 0
    };
  }

  /* ------------------------------------------------------------------ probar specs */
  function probarFor(id) {
    var list = C150.DATA && C150.DATA.controls;
    if (Array.isArray(list)) {
      if (!probarIndex || probarCount !== list.length) {
        probarIndex = {};
        probarCount = list.length;
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) probarIndex[list[i].id] = list[i].probar || null;
      }
      if (Object.prototype.hasOwnProperty.call(probarIndex, id)) return probarIndex[id];
    }
    return FALLBACK_PROBAR[id] || null;
  }

  /* ------------------------------------------------------------------ highlights */
  function kindFor(id) {
    if (!id) return null;
    if (id === selected) return 'selected';
    if (targets[id]) return 'target';
    if (hovered.id === id) return 'hover';
    return null;
  }
  function refreshHighlight(id) {
    if (!id || !cockpit || !cockpit.setHighlight) return;
    try { cockpit.setHighlight(id, kindFor(id)); } catch (e) { reportOnce('cockpit.setHighlight', e); }
  }

  /* ------------------------------------------------------------------ input axes: drivers, springs, ramps */
  // driver: null | 'drag' | 'ramp' (keys/holds) | 'demo'. A released axis eases back to 0 in SPRING_TIME.
  function takeAxis(name, who) {
    var a = axes[name];
    if (demo && a.driver === 'demo' && who !== 'demo') demo = null;
    a.driver = who; a.spring = null;
  }
  function releaseAxis(name, who) {
    var a = axes[name];
    if (who && a.driver !== who) return;
    a.driver = null;
    var v = num(state[name], 0);
    a.spring = Math.abs(v) > 1e-4 ? { from: v, t: 0 } : null;
    if (!a.spring) state[name] = 0;
  }
  function freeAxis(name) {           // external writer (setInput): stop every core motion on that axis
    var a = axes[name];
    if (a.driver === 'demo') demo = null;
    a.driver = null; a.spring = null;
  }

  function updateBrakes() {
    var wantL = keyBrake || holdState.brakeL || dragBrake.L;
    var wantR = keyBrake || holdState.brakeR || dragBrake.R;
    if (demo && demo.kind === 'brakes') return;
    if (wantL) { state.brakeL = 1; brakeOwned.L = true; } else if (brakeOwned.L) { state.brakeL = 0; brakeOwned.L = false; }
    if (wantR) { state.brakeR = 1; brakeOwned.R = true; } else if (brakeOwned.R) { state.brakeR = 0; brakeOwned.R = false; }
  }

  function startDemo(kind, side) {
    if (kind === 'yoke') {
      if (locked()) { lockWarning(); return false; }
      takeAxis('yokeRoll', 'demo'); takeAxis('yokePitch', 'demo');
      demo = { kind: 'yoke', t: 0, dur: 2.4 };
    } else if (kind === 'rudder') {
      takeAxis('rudder', 'demo');
      demo = { kind: 'rudder', t: 0, dur: 1.6 };
    } else {
      demo = { kind: 'brakes', t: 0, dur: 1.0, side: side || null };
    }
    return true;
  }
  function runDemo(dt) {
    if (!demo) return;
    demo.t += dt;
    var u = demo.t, done = u >= demo.dur, TWO_PI = Math.PI * 2;
    if (demo.kind === 'yoke') {
      if (axes.yokeRoll.driver !== 'demo' && axes.yokePitch.driver !== 'demo') { demo = null; return; }
      if (locked()) done = true;
      if (axes.yokeRoll.driver === 'demo') state.yokeRoll = u < 1.2 ? -Math.sin(TWO_PI * u / 1.2) * 0.9 : 0;
      if (axes.yokePitch.driver === 'demo') state.yokePitch = (u >= 1.2 && u < 2.4) ? Math.sin(TWO_PI * (u - 1.2) / 1.2) * 0.9 : 0;
      if (done) { demo = null; releaseAxis('yokeRoll', 'demo'); releaseAxis('yokePitch', 'demo'); }
    } else if (demo.kind === 'rudder') {
      if (axes.rudder.driver !== 'demo') { demo = null; return; }
      state.rudder = done ? 0 : -Math.sin(TWO_PI * u / demo.dur) * 0.9;
      if (done) { demo = null; releaseAxis('rudder', 'demo'); }
    } else {
      var b = done ? 0 : Math.sin(Math.PI * u / demo.dur);
      if (demo.side !== 'right') { state.brakeL = b; brakeOwned.L = true; }
      if (demo.side !== 'left') { state.brakeR = b; brakeOwned.R = true; }
      if (done) demo = null;
    }
  }

  function updateInputs(dt) {
    if (!state) return;
    runDemo(dt);
    var lock = locked();
    var hy = holdState.yoke, hr = holdState.rudder;
    for (var i = 0; i < AXES.length; i++) {
      var name = AXES[i], a = axes[name], tgt = 0, active = false, rate = KEY_RATE;
      if (name === 'yokeRoll') {
        if (keys.ArrowLeft) { tgt -= 1; active = true; }
        if (keys.ArrowRight) { tgt += 1; active = true; }
        if (hy.left) { tgt -= 1; active = true; rate = HOLD_RATE; }
        if (hy.right) { tgt += 1; active = true; rate = HOLD_RATE; }
      } else if (name === 'yokePitch') {
        if (keys.ArrowUp) { tgt -= 1; active = true; }          // ↑ = push
        if (keys.ArrowDown) { tgt += 1; active = true; }        // ↓ = pull
        if (hy.push) { tgt -= 1; active = true; rate = HOLD_RATE; }
        if (hy.pull) { tgt += 1; active = true; rate = HOLD_RATE; }
      } else {
        if (keys.z) { tgt -= 1; active = true; }
        if (keys.x) { tgt += 1; active = true; }
        if (hr.left) { tgt -= 1; active = true; rate = HOLD_RATE; }
        if (hr.right) { tgt += 1; active = true; rate = HOLD_RATE; }
      }
      if (lock && name !== 'rudder') {
        if (active) lockWarning();
        active = false;
        if (a.driver === 'drag' || a.driver === 'ramp') a.driver = null;
      }
      if (active && a.driver !== 'drag') {
        if (a.driver !== 'ramp') takeAxis(name, 'ramp');
        state[name] = moveToward(num(state[name], 0), clamp(tgt, -1, 1), rate * dt);
      } else if (!active && a.driver === 'ramp') {
        releaseAxis(name, 'ramp');
      }
      if (!a.driver && a.spring) {
        a.spring.t += dt / SPRING_TIME;
        if (a.spring.t >= 1) { state[name] = 0; a.spring = null; }
        else { var k = 1 - a.spring.t; state[name] = a.spring.from * k * k * k; }
      }
    }
    updateBrakes();

    // momentary switches
    if (ignTimer !== null) {
      ignTimer -= dt;
      if (ignTimer <= 0) { ignTimer = null; if (!ignHeld && state.ignition === 'START') setIgnition('BOTH'); }
    }
    if (flapTimer !== null) {
      flapTimer -= dt;
      if (flapTimer <= 0) {
        flapTimer = null;
        if (!flapHolders.key && !flapHolders.ui && state.flapSwitch === 'DOWN') setFlapSwitch('OFF');
      }
    }
    // primer plunger animation for a clicked stroke (out and back in)
    if (primerAnim) {
      primerAnim.t += dt;
      var pt = primerAnim.t;
      state.primerOut = pt < 0.35 ? pt / 0.35 : (pt < 0.7 ? 1 - (pt - 0.35) / 0.35 : 0);
      if (pt >= 0.7) { state.primerOut = 0; primerAnim = null; }
    }
  }

  function holdFlap(who, onOff) {
    flapHolders[who] = !!onOff;
    if (onOff) { flapTimer = null; setFlapSwitch('DOWN'); }
    else if (!flapHolders.key && !flapHolders.ui && flapTimer === null && state.flapSwitch === 'DOWN') setFlapSwitch('OFF');
  }
  function cancelMomentary() {
    ignTimer = null; flapTimer = null; ignHeld = false;
    flapHolders.key = false; flapHolders.ui = false;
    holdState.yoke.left = holdState.yoke.right = holdState.yoke.pull = holdState.yoke.push = false;
    holdState.rudder.left = holdState.rudder.right = false;
    holdState.brakeL = holdState.brakeR = false;
    dragBrake.L = dragBrake.R = false; keyBrake = false;
    brakeOwned.L = brakeOwned.R = false;
    demo = null; primerAnim = null; primerArmed = false;
    resetAxes();
  }

  /* ------------------------------------------------------------------ operate / setInput / hold */
  function setInput(path, value) {
    if (!state || typeof path !== 'string' || !path) return false;
    switch (path) {
      case 'ignition':
        if (value !== 'START') ignTimer = null;
        setIgnition(value);
        return true;
      case 'flapSwitch':
        flapTimer = null;
        setFlapSwitch(value);
        return true;
      case 'masterBat': setMaster('bat', !!value); return true;
      case 'masterAlt': setMaster('alt', !!value); return true;
    }
    if (axes[path]) freeAxis(path);
    if (path === 'brakeL') brakeOwned.L = false;
    if (path === 'brakeR') brakeOwned.R = false;
    if (path === 'primerOut') primerAnim = null;
    var r = INPUT_RANGE[path];
    if (r) value = clamp(num(Number(value), num(getPath(state, path), r[0])), r[0], r[1]);
    setPathRaw(state, path, value);
    return true;
  }

  function nextIgnition(cur) {
    if (cur === 'BOTH') return engineRunning() ? 'OFF' : 'START';
    return IGNITION_NEXT[cur] || 'OFF';
  }
  function operateIgnition(pos) {
    if (['OFF', 'R', 'L', 'BOTH', 'START'].indexOf(pos) < 0) return false;
    setIgnition(pos);
    ignTimer = (pos === 'START' && !ignHeld) ? START_MOMENTARY : null;
    return true;
  }
  function flapDownMomentary() {
    setFlapSwitch('DOWN');
    flapTimer = FLAP_MOMENTARY;
  }

  function operate(id, subId, value) {
    if (!state || !id) return false;
    var spec = probarFor(id);
    if (!spec) return false;
    var hasVal = value !== undefined && value !== null;
    var sub = subId ? String(subId) : null;
    var done = false, cur, v;
    switch (spec.tipo) {
      case 'toggle':
        setInput(spec.clave, hasVal ? !!value : !getPath(state, spec.clave));
        done = true; break;
      case 'opciones':
        if (spec.clave === 'ignition') {
          done = operateIgnition(hasVal ? String(value) : nextIgnition(state.ignition));
        } else if (Array.isArray(spec.valores) && spec.valores.length) {
          cur = spec.valores.indexOf(getPath(state, spec.clave));
          setInput(spec.clave, hasVal ? value : spec.valores[(cur + 1) % spec.valores.length]);
          done = true;
        }
        break;
      case 'slider': {
        var mn = num(spec.min, 0), mx = num(spec.max, 1);
        cur = num(getPath(state, spec.clave), mn);
        if (hasVal) v = clamp(num(Number(value), cur), mn, mx);
        else {
          // A click nudges 25 % of the travel, always in the same direction until it reaches an end (then it
          // bounces back). Never a surprise jump to the other extreme (e.g. mixture to cut-off in flight).
          var span = mx - mn, eps = span * 1e-3, dir = sliderDir[id];
          if (cur >= mx - eps) dir = -1;
          else if (cur <= mn + eps) dir = 1;
          else if (dir !== 1 && dir !== -1) dir = cur > (mn + mx) / 2 ? -1 : 1;
          sliderDir[id] = dir;
          v = roundStep(clamp(cur + dir * SLIDER_NUDGE * span, mn, mx));
          pushEvent(SLIDER_HINT, 'info');
        }
        setInput(spec.clave, v);
        done = true; break;
      }
      case 'perilla': {
        var pmn = num(spec.min, 0), pmx = num(spec.max, 1), step = num(spec.paso, 1);
        cur = num(getPath(state, spec.clave), pmn);
        if (hasVal) v = clamp(num(Number(value), cur), pmn, pmx);
        else { v = roundStep(cur + step); if (v > pmx + 1e-9) v = pmn; }
        setInput(spec.clave, v);
        done = true; break;
      }
      case 'master':
        if (sub === 'alt' || sub === 'bat') {
          setMaster(sub, hasVal ? !!value : !(sub === 'alt' ? state.masterAlt : state.masterBat));
        } else {
          var onBoth = hasVal ? !!value : !(state.masterBat && state.masterAlt);
          if (onBoth) { setMaster('bat', true); setMaster('alt', true); } else { setMaster('alt', false); setMaster('bat', false); }
        }
        done = true; break;
      case 'flaps':
        if (hasVal) {
          if (value === 'DOWN') flapDownMomentary();
          else if (value === 'UP' || value === 'OFF') { flapTimer = null; setFlapSwitch(value); }
          else break;
        } else if (flapTimer !== null && state.flapSwitch === 'DOWN') {
          flapTimer += FLAP_MOMENTARY;
        } else if (num(state.flaps, 0) > 0.5) {
          flapTimer = null; setFlapSwitch('UP');
        } else {
          flapDownMomentary();
        }
        done = true; break;
      case 'accion':
        if (spec.accion === 'primeStroke') {
          primeStroke();
          primerAnim = { t: 0 };
          done = true;
        } else if (actions() && typeof actions()[spec.accion] === 'function') {
          actions()[spec.accion](state);
          done = true;
        }
        break;
      case 'luces':
        if (sub === 'pitot') { state.pitotHeat = hasVal ? !!value : !state.pitotHeat; done = true; }
        else if (sub && LIGHT_SUBS[sub]) {
          if (!state.lights) state.lights = {};
          state.lights[sub] = hasVal ? !!value : !state.lights[sub];
          done = true;
        }
        break;
      case 'puertas': {
        var key = sub === 'right' ? 'doorRightOpen' : (sub === 'window' ? 'windowLeftOpen' : 'doorLeftOpen');
        state[key] = hasVal ? !!value : !state[key];
        done = true; break;
      }
      case 'radio':
        if (!state.radio) state.radio = {};
        if (id === 'transponder') {
          cur = XPDR_MODES.indexOf(state.radio.xpdrMode);
          state.radio.xpdrMode = hasVal && XPDR_MODES.indexOf(value) >= 0 ? value : XPDR_MODES[(cur + 1) % XPDR_MODES.length];
        } else {
          state.radio.comOn = hasVal ? !!value : !state.radio.comOn;
        }
        done = true; break;
      case 'yoke':
        if (hasVal && typeof value === 'object') {
          if (locked()) { lockWarning(); break; }
          if (value.roll !== undefined) setInput('yokeRoll', value.roll);
          if (value.pitch !== undefined) setInput('yokePitch', value.pitch);
          done = true;
        } else {
          done = startDemo('yoke');
        }
        break;
      case 'pedales':
        if (hasVal && typeof value === 'number') {
          setInput(id === 'toe-brakes' ? (sub === 'right' ? 'brakeR' : 'brakeL') : 'rudder', value);
          done = true;
        } else {
          done = startDemo(id === 'toe-brakes' ? 'brakes' : 'rudder', sub);
        }
        break;
    }
    if (done) emit('operate', id, sub);
    return done;
  }

  function hold(id, subId, onOff) {
    if (!state) return false;
    onOff = !!onOff;
    var sub = subId ? String(subId).toLowerCase() : null;
    switch (id) {
      case 'rudder-pedals':
        if (sub !== 'left' && sub !== 'right') return false;
        holdState.rudder[sub] = onOff;
        return true;
      case 'toe-brakes':
        if (!sub || sub === 'left') holdState.brakeL = onOff;
        if (!sub || sub === 'right') holdState.brakeR = onOff;
        if (demo && demo.kind === 'brakes') demo = null;
        updateBrakes();
        return true;
      case 'yoke':
        if (!holdState.yoke.hasOwnProperty(sub)) return false;
        if (onOff && locked()) { lockWarning(); return false; }
        holdState.yoke[sub] = onOff;
        return true;
      case 'flap-switch':
      case 'flap-indicator':
        if (sub === 'up') { if (onOff) { flapTimer = null; setFlapSwitch('UP'); } return true; }
        holdFlap('ui', onOff);
        return true;
      case 'ignition':
        if (sub && sub !== 'start') return false;
        if (onOff) { ignHeld = true; ignTimer = null; setIgnition('START'); }
        else { ignHeld = false; if (state.ignition === 'START') setIgnition('BOTH'); }
        return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ camera: presets, fly-to, constraints */
  function clampBox(v, b) {
    v.x = clamp(v.x, b.x0, b.x1); v.y = clamp(v.y, b.y0, b.y1); v.z = clamp(v.z, b.z0, b.z1);
    return v;
  }
  /** Copies a view into (pos, tgt): position inside the cabin, pivot at a distance OrbitControls accepts. */
  function normalizeView(position, target, pos, tgt) {
    pos.copy(position); clampBox(pos, CABIN);
    tgt.copy(target);
    var d = tgt.distanceTo(pos);
    if (d < 1e-6) { tgt.set(pos.x, pos.y, pos.z - 0.3); return; }
    if (d > MAX_DIST - 0.1) tgt.sub(pos).multiplyScalar(0.9 / d).add(pos);
    else if (d < MIN_DIST + 0.03) tgt.sub(pos).multiplyScalar(0.3 / d).add(pos);
  }
  function flyTo(position, target, instant) {
    if (!camera) return;
    var p = new T.Vector3(), t = new T.Vector3();
    normalizeView(position, target, p, t);
    var tgtNow = controls ? controls.target : camTarget;
    if (instant || reducedMotion) {
      fly = null;
      camera.position.copy(p); tgtNow.copy(t); camera.lookAt(t);
      if (controls) controls.update();
      hoverPos.dirty = true;
      return;
    }
    fly = { p0: camera.position.clone(), t0: tgtNow.clone(), p1: p, t1: t, k: 0 };
  }
  function presetSpec(name) {
    if (cockpit && cockpit.presets && cockpit.presets[name]) return cockpit.presets[name];
    if (name === 'pilot') return { position: new T.Vector3(EYE[0], EYE[1], EYE[2]), target: new T.Vector3(-0.10, 0.50, 0), label: 'Asiento del piloto' };
    return null;
  }
  function viewFor(id) {
    if (!cockpit) return null;
    if (cockpit.views && cockpit.views[id]) return cockpit.views[id];
    var a = cockpit.anchors && cockpit.anchors[id];
    if (!a) return null;
    var tgt = a.getWorldPosition(new T.Vector3());
    return { position: tgt.clone().add(new T.Vector3(0.05, 0.14, 0.42)), target: tgt };
  }
  function focusControl(id) {
    var v = viewFor(id);
    if (!v) return false;
    if (mainView !== 'cockpit') setMainView('cockpit');
    flyTo(v.position, v.target, false);
    emit('preset', null);
    return true;
  }
  function focusPreset(name) {
    var p = presetSpec(name);
    if (!p || !camera) return false;
    if (mainView !== 'cockpit') setMainView('cockpit');
    flyTo(p.position, p.target, false);
    emit('preset', name);
    return true;
  }
  function updateCameras(dt) {
    if (fly) {
      fly.k = Math.min(1, fly.k + dt / FLY_TIME);
      var e = easeInOut(fly.k), tgt = controls ? controls.target : camTarget;
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      tgt.lerpVectors(fly.t0, fly.t1, e);
      camera.lookAt(tgt);
      if (fly.k >= 1) { fly = null; if (controls) controls.update(); hoverPos.dirty = true; }
    } else if (controls && mainView === 'cockpit') {
      controls.update();
    }
    if (controls) clampBox(controls.target, PIVOT);
    clampBox(camera.position, CABIN);

    if (ext && extControls) {
      var busy = !!ext.cameraBusy;
      if (mainView === 'exterior' && !busy) {
        if (extBusyPrev && extControls.target !== ext.target && ext.target) extControls.target.copy(ext.target);
        extControls.update();
      }
      extBusyPrev = busy;
    }
  }

  /* ------------------------------------------------------------------ main view, layout */
  function isMobile() {
    var coarse = false;
    try { coarse = !!(mqCoarse && mqCoarse.matches); } catch (e) { coarse = false; }
    var w = container ? container.clientWidth : (root.innerWidth || 1024);
    return coarse || w < 640;
  }
  function computeInset() {
    var W = size.w, H = size.h;
    if (!ext || !insetVisible || W < 200 || H < 150) return null;
    var w = isMobile() ? clamp(W * 0.42, 120, 360) : clamp(W * 0.30, 170, 360);
    var h = w * 3 / 4;
    if (h > H * 0.45) { h = H * 0.45; w = h * 4 / 3; }
    w = Math.round(w); h = Math.round(h);
    return { x: W - INSET_MARGIN - w, y: INSET_MARGIN, w: w, h: h };
  }
  function layoutViews() {
    var W = size.w, H = size.h;
    insetRect = computeInset();
    var portraitPhone = isMobile() && H > W;
    if (camera) {
      if (mainView === 'cockpit') { camera.aspect = W / Math.max(1, H); camera.fov = portraitPhone ? 70 : 62; }
      else if (insetRect) { camera.aspect = insetRect.w / insetRect.h; camera.fov = 62; }
      camera.updateProjectionMatrix();
    }
    if (ext && ext.camera) {
      var ew = mainView === 'exterior' ? W : (insetRect ? insetRect.w : 4), eh = mainView === 'exterior' ? H : (insetRect ? insetRect.h : 3);
      // exterior views are framed for 4:3: on narrower viewports widen the vertical fov to keep the 4:3 horizontal view
      var asp = ew / Math.max(1, eh), half = Math.tan(extBaseFov * Math.PI / 360);
      var margin = 1 + 0.15 * clamp((4 / 3 - asp) / (4 / 3 - 0.75), 0, 1);   // a little extra room on tall screens
      ext.camera.fov = asp < 4 / 3 ? Math.min(75, 2 * Math.atan(half * margin * (4 / 3) / asp) * 180 / Math.PI) : extBaseFov;
      try {
        if (ext.setSize) ext.setSize(ew, eh);
        else { ext.camera.aspect = asp; }
        // floating labels/panels of the exterior keep clear of the cockpit inset drawn over it
        if (ext.setOccluder) {
          ext.setOccluder(mainView === 'exterior' && insetRect
            ? { x: insetRect.x, y: insetRect.y, w: insetRect.w, h: insetRect.h, vw: W, vh: H } : null);
        }
      } catch (e) { reportOnce('exterior.setSize', e); }
      ext.camera.updateProjectionMatrix();
    }
    emit('layout', getInsetRect());
  }
  function resize() {
    if (!renderer || !container) return;
    var W = Math.max(1, Math.round(container.clientWidth)), H = Math.max(1, Math.round(container.clientHeight));
    var pr = Math.min((QUALITY[quality] || QUALITY.alta).pr, root.devicePixelRatio || 1);
    if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
    size.w = W; size.h = H;
    renderer.setSize(W, H, false);
    layoutViews();
  }
  function getInsetRect() {
    return insetRect ? { x: insetRect.x, y: insetRect.y, w: insetRect.w, h: insetRect.h, main: mainView } : null;
  }
  function setMainView(name, internal) {
    if (name !== 'cockpit' && name !== 'exterior') return false;
    if (name === 'exterior' && !ext) return false;
    if (!internal) enlargeRestore = null;
    if (name === mainView) return true;
    mainView = name;
    endDrag(true);
    if (controls) controls.enabled = name === 'cockpit';
    if (extControls) extControls.enabled = name === 'exterior';
    if (name === 'exterior' && extControls && ext && !ext.cameraBusy && ext.target && extControls.target !== ext.target) {
      extControls.target.copy(ext.target);
    }
    setHover(null, null);
    layoutViews();
    emit('viewchange', name);
    return true;
  }
  function getMainView() { return mainView; }
  function setInsetVisible(v) {
    insetVisible = !!v;
    if (!insetVisible && mainView === 'exterior') setMainView('cockpit');
    layoutViews();
  }

  /* ------------------------------------------------------------------ picking */
  function raycastAt(x, y, out) {
    if (!cockpit || !cockpit.pickables || !camera || mainView !== 'cockpit') return null;
    ndc.set((x / size.w) * 2 - 1, -(y / size.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    hits.length = 0;
    raycaster.intersectObjects(cockpit.pickables, false, hits);
    for (var i = 0; i < hits.length; i++) {
      var ud = hits[i].object.userData;
      if (ud && ud.controlId) {
        out = out || { id: null, sub: null, point: new T.Vector3() };
        out.id = ud.controlId; out.sub = ud.subId || null;
        if (out.point) out.point.copy(hits[i].point);
        hits.length = 0;
        return out;
      }
    }
    hits.length = 0;
    return null;
  }
  function pickAt(x, y) {
    var h = raycastAt(x, y, null);
    return h ? { id: h.id, subId: h.sub } : null;
  }
  function setHover(id, sub) {
    if (id === hovered.id && sub === hovered.sub) return;
    var prev = hovered.id;
    hovered.id = id; hovered.sub = sub;
    if (prev && prev !== id) refreshHighlight(prev);
    refreshHighlight(id);
    emit('hover', id, sub, { x: hoverPos.x, y: hoverPos.y });
  }
  function setCursor(c) { if (canvas && canvas.style.cursor !== c) canvas.style.cursor = c; }
  function updateHover() {
    if (!hoverPos.dirty || ptr) return;
    hoverPos.dirty = false;
    var id = null, sub = null, cursor = '';
    if (hoverPos.inside) {
      if (inRect(hoverPos.x, hoverPos.y, insetRect)) cursor = 'pointer';
      else {
        var h = raycastAt(hoverPos.x, hoverPos.y, hoverHit);
        if (h) { id = h.id; sub = h.sub; cursor = DRAG_KIND[id] ? 'grab' : 'pointer'; }
      }
    }
    setCursor(cursor);
    setHover(id, sub);
  }
  function projectControl(id) {
    if (!cockpit || !cockpit.anchors || !cockpit.anchors[id] || !camera) return null;
    cockpit.anchors[id].getWorldPosition(vA);
    vB.copy(vA).applyMatrix4(camera.matrixWorldInverse);
    vA.project(camera);
    var r = mainView === 'cockpit' ? { x: 0, y: 0, w: size.w, h: size.h } : insetRect;
    if (!r) return null;
    var x = r.x + (vA.x + 1) / 2 * r.w, y = r.y + (1 - vA.y) / 2 * r.h;
    return { x: x, y: y, visible: vB.z < 0 && Math.abs(vA.x) <= 1 && Math.abs(vA.y) <= 1 };
  }
  /** Screen (css px) of a world point, written into out {x, y}. */
  function toScreen(v, out) {
    vB.copy(v).project(camera);
    out.x = (vB.x + 1) / 2 * size.w; out.y = (1 - vB.y) / 2 * size.h;
    return out;
  }

  /* ------------------------------------------------------------------ pointer interaction */
  function localXY(ev, out) {
    var r = canvas.getBoundingClientRect();
    out.x = ev.clientX - r.left; out.y = ev.clientY - r.top;
    return out;
  }
  var pxy = { x: 0, y: 0 };

  function onPointerDown(ev) {
    if (!inited || ev.target !== canvas) return;
    if (!pointersDown[ev.pointerId]) { pointersDown[ev.pointerId] = true; pointerCount++; }
    localXY(ev, pxy);
    if (ptr) {                                   // a second finger / button during a gesture
      ptr.multi = true;
      if (ptr.mode === 'pending' || ptr.mode === 'drag' || ptr.mode === 'blocked' || ptr.mode === 'inset') ev.stopPropagation();
      return;
    }
    ptr = { id: ev.pointerId, x0: pxy.x, y0: pxy.y, xs: pxy.x, ys: pxy.y, t0: nowMs(), mode: 'orbit', hit: null,
      moved: false, multi: pointerCount > 1, button: ev.button, type: ev.pointerType };
    if (inRect(pxy.x, pxy.y, insetRect)) {
      ptr.mode = 'inset';
      ev.stopPropagation();
      return;
    }
    if (mainView === 'cockpit' && ev.button === 0) {
      ptr.hit = raycastAt(pxy.x, pxy.y, null);
      if (ptr.hit && DRAG_KIND[ptr.hit.id]) {
        ptr.mode = 'pending';
        ev.stopPropagation();                    // OrbitControls never sees this pointer
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic or already released pointer */ }
        if (ptr.hit.id === 'toe-brakes') pressDragBrake(ptr.hit.sub, true);   // press-and-hold = brake
      }
    }
  }

  function onPointerMove(ev) {
    if (!inited) return;
    if (ptr && ev.pointerId === ptr.id) {
      localXY(ev, pxy);
      if (ev.pointerType !== 'touch') { hoverPos.x = pxy.x; hoverPos.y = pxy.y; }
      var dx = pxy.x - ptr.x0, dy = pxy.y - ptr.y0;
      if (!ptr.moved && dx * dx + dy * dy >= CLICK_PX * CLICK_PX) {
        ptr.moved = true;
        if (ptr.mode === 'pending') beginDrag(pxy.x, pxy.y);
      }
      if (ptr && ptr.mode === 'drag') applyDrag(pxy.x - ptr.xs, pxy.y - ptr.ys);
      return;
    }
    if (ptr) return;
    if (ev.target === canvas && ev.pointerType !== 'touch') {
      localXY(ev, pxy);
      hoverPos.x = pxy.x; hoverPos.y = pxy.y; hoverPos.inside = true; hoverPos.dirty = true;
    } else if (hoverPos.inside) {
      hoverPos.inside = false; hoverPos.dirty = true;
    }
  }

  function onPointerUp(ev) {
    if (pointersDown[ev.pointerId]) { delete pointersDown[ev.pointerId]; pointerCount = Math.max(0, pointerCount - 1); }
    if (!inited || !ptr || ev.pointerId !== ptr.id) return;
    var p = ptr, wasDrag = p.mode === 'drag';
    var isClick = ev.type === 'pointerup' && !p.moved && !p.multi && p.button === 0 && (nowMs() - p.t0) < CLICK_MS;
    if (p.hit && p.hit.id === 'toe-brakes') pressDragBrake(p.hit.sub, false);
    if (wasDrag) endDrag(false);
    else if (p.mode === 'pending' || p.mode === 'blocked') { try { canvas.releasePointerCapture(p.id); } catch (e) { /* not captured */ } }
    ptr = null;
    if (controls) controls.enabled = mainView === 'cockpit';
    hoverPos.dirty = true;
    if (isClick) handleClick(p);
  }

  function handleClick(p) {
    if (p.mode === 'inset') { setMainView(mainView === 'cockpit' ? 'exterior' : 'cockpit'); return; }
    if (mainView !== 'cockpit' || !p.hit) return;
    var id = p.hit.id, sub = p.hit.sub;
    if (pickFn) {
      var fn = pickFn;
      pickFn = null;
      try { fn(id); } catch (e) { console.error('[C150.Core] pickMode callback failed:', e); }
      emit('pick', id);
      return;
    }
    if (id === selected) operate(id, sub);
    else select(id, { focus: true });
  }

  function onPointerLeave() {
    if (ptr) return;
    hoverPos.inside = false; hoverPos.dirty = true;
  }
  function onWheel(ev) {
    if (ev.target !== canvas || !inited) return;
    localXY(ev, pxy);
    if (inRect(pxy.x, pxy.y, insetRect)) { ev.stopPropagation(); ev.preventDefault(); }
  }

  function pressDragBrake(sub, onOff) {
    if (sub !== 'right') dragBrake.L = onOff;
    if (sub !== 'left') dragBrake.R = onOff;
    if (onOff && demo && demo.kind === 'brakes') demo = null;
    updateBrakes();
  }

  function beginDrag(x, y) {
    var id = ptr.hit.id, kind = DRAG_KIND[id];
    if (kind === 'yoke' && locked()) { lockWarning(); ptr.mode = 'blocked'; return; }
    ptr.mode = 'drag'; ptr.kind = kind; ptr.xs = x; ptr.ys = y;
    if (controls) controls.enabled = false;
    setCursor('grabbing');
    if (kind === 'yoke') {
      takeAxis('yokeRoll', 'drag'); takeAxis('yokePitch', 'drag');
      ptr.v0 = num(state.yokeRoll, 0); ptr.v1 = num(state.yokePitch, 0);
    } else if (kind === 'pedals') {
      takeAxis('rudder', 'drag');
      ptr.v0 = num(state.rudder, 0);
    } else if (kind === 'trim') {
      ptr.v0 = num(state.trim, 0);
    } else if (kind === 'knob') {
      var key = KNOB_KEY[id], ax = cockpit && cockpit.dragAxes && cockpit.dragAxes[id];
      if (id === 'primer') { primerAnim = null; primerArmed = false; if (state.primerLocked) state.primerLocked = false; }
      ptr.key = key;
      ptr.v0 = num(state[key], 0);
      // screen projection of the value-increasing axis over the knob travel
      if (ax && ax.axis) vA.copy(ax.axis); else vA.set(0, 0, KNOB_AXIS_Z[id] || 1);
      if (cockpit && cockpit.group) vA.transformDirection(cockpit.group.matrixWorld);
      var len = ax && ax.length > 0 ? ax.length : 0.06;
      var s0 = toScreen(ptr.hit.point, { x: 0, y: 0 });
      vC.copy(ptr.hit.point).addScaledVector(vA, len);
      var s1 = toScreen(vC, { x: 0, y: 0 });
      var sx = s1.x - s0.x, sy = s1.y - s0.y, L = Math.sqrt(sx * sx + sy * sy);
      if (L >= 20) { ptr.ux = sx / L; ptr.uy = sy / L; }
      else { ptr.ux = 0; ptr.uy = vA.z < 0 ? -1 : 1; }  // axis points at the camera: push in = screen up
      ptr.L = Math.max(L, KNOB_MIN_PX);
    }
  }

  function applyDrag(dx, dy) {
    var k = ptr.kind;
    if (k === 'yoke') {
      if (locked()) { lockWarning(); return; }
      if (axes.yokeRoll.driver === 'drag') state.yokeRoll = clamp(ptr.v0 + dx / YOKE_PX, -1, 1);
      if (axes.yokePitch.driver === 'drag') state.yokePitch = clamp(ptr.v1 + dy / YOKE_PX, -1, 1);   // drag down = pull
    } else if (k === 'pedals') {
      if (axes.rudder.driver === 'drag') state.rudder = clamp(ptr.v0 + dx / PEDAL_PX, -1, 1);
    } else if (k === 'trim') {
      state.trim = clamp(ptr.v0 + dy / TRIM_PX, -1, 1);                                             // drag up = nose down
    } else if (k === 'knob') {
      var v = clamp(ptr.v0 + (dx * ptr.ux + dy * ptr.uy) / ptr.L, 0, 1);
      state[ptr.key] = v;
      if (ptr.key === 'primerOut') {
        if (v > 0.85) primerArmed = true;
        else if (v < 0.15 && primerArmed) { primerArmed = false; primeStroke(); }
      }
    }
  }

  function endDrag(cancelled) {
    if (!ptr || ptr.mode !== 'drag') return;
    var k = ptr.kind;
    if (k === 'yoke') { releaseAxis('yokeRoll', 'drag'); releaseAxis('yokePitch', 'drag'); }
    else if (k === 'pedals') releaseAxis('rudder', 'drag');
    else if (k === 'knob' && ptr.key === 'primerOut' && num(state.primerOut, 0) < 0.15) state.primerOut = 0;
    if (ptr.hit && ptr.hit.id === 'toe-brakes') pressDragBrake(ptr.hit.sub, false);
    try { canvas.releasePointerCapture(ptr.id); } catch (e) { /* not captured */ }
    if (controls) controls.enabled = mainView === 'cockpit';
    setCursor('');
    if (cancelled) ptr = null;
  }

  /* ------------------------------------------------------------------ keyboard */
  function isTypingTarget(t) {
    if (!t || t === root || t === document || t === document.body) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }
  function inArrowWidget(t) {
    return !!(t && t.closest && t.closest('[role="tablist"],[role="listbox"],[role="menu"],[role="menubar"],[role="radiogroup"],[role="slider"],[role="tree"],[role="grid"],[role="spinbutton"]'));
  }
  function onKeyDown(e) {
    if (!inited || !state || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var handled = true;
    switch (k) {
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
        if (inArrowWidget(e.target)) return;
        keys[k] = true;
        if (locked()) lockWarning();
        break;
      case 'z': case 'x': keys[k] = true; break;
      case 'b': if (!keyBrake) { keyBrake = true; if (demo && demo.kind === 'brakes') demo = null; updateBrakes(); } break;
      case 'PageUp': case '+': case '=':
        setInput('throttle', roundStep(num(state.throttle, 0) + THROTTLE_STEP)); break;
      case 'PageDown': case '-': case '_':
        setInput('throttle', roundStep(num(state.throttle, 0) - THROTTLE_STEP)); break;
      case 'f': if (!e.repeat && !flapHolders.key) holdFlap('key', true); break;
      case 'r': if (!e.repeat) { flapTimer = null; setFlapSwitch('UP'); } break;
      case 't': setInput('trim', roundStep(num(state.trim, 0) - TRIM_STEP)); break;    // nose down
      case 'g': setInput('trim', roundStep(num(state.trim, 0) + TRIM_STEP)); break;    // nose up
      case 'm':
        if (!e.repeat) operate('master', null, !(state.masterBat && state.masterAlt));
        break;
      case 'c': if (!e.repeat) setMainView(mainView === 'cockpit' ? 'exterior' : 'cockpit'); break;
      case 'p': if (!e.repeat) setPaused(!state.paused); break;
      case 'Escape': select(null); handled = false; break;
      default:
        if (k >= '1' && k <= '8' && k.length === 1) { if (!e.repeat) focusPreset(PRESET_KEYS[+k - 1]); }
        else handled = false;
    }
    if (handled) e.preventDefault();
  }
  function onKeyUp(e) {
    if (!inited || !state) return;
    var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    switch (k) {
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': case 'z': case 'x':
        keys[k] = false; break;
      case 'b': if (keyBrake) { keyBrake = false; updateBrakes(); } break;
      case 'f': if (flapHolders.key) holdFlap('key', false); break;
    }
  }
  function releaseAllKeys() {
    keys = {};
    if (keyBrake) { keyBrake = false; if (state) updateBrakes(); }
    if (flapHolders.key && state) holdFlap('key', false);
  }

  /* ------------------------------------------------------------------ selection, highlights, exterior */
  function select(id, opts) {
    id = id || null;
    var prev = selected;
    selected = id;
    if (prev && prev !== id) refreshHighlight(prev);
    if (id) refreshHighlight(id);
    if (id && opts && opts.focus) focusControl(id);
    if (prev !== id) emit('select', id);
    return id;
  }
  function setTargetHighlight(ids) {
    var list = ids ? (Array.isArray(ids) ? ids : [ids]) : [];
    var old = targets, k;
    targets = {};
    for (var i = 0; i < list.length; i++) if (list[i]) targets[list[i]] = true;
    for (k in old) if (!targets[k]) refreshHighlight(k);
    for (k in targets) refreshHighlight(k);
  }
  function setExteriorHighlight(parts) {
    if (!ext || !ext.setHighlight) return;
    try { ext.setHighlight(Array.isArray(parts) ? parts : (parts ? [parts] : [])); } catch (e) { reportOnce('exterior.setHighlight', e); }
  }
  function playExterior(anim, opts) {
    if (!ext) return false;
    opts = opts || {};
    if (!anim) {
      prevPlaying = null;                       // stopped on purpose: no 'animend'
      try { ext.stop(); } catch (e) { reportOnce('exterior.stop', e); }
      var back = enlargeRestore;
      enlargeRestore = null;
      if (back && mainView === 'exterior') setMainView(back, true);
      return true;
    }
    var ok = false;
    try { ok = ext.play(anim, { loop: !!opts.loop }) !== false; } catch (e) { reportOnce('exterior.play', e); ok = false; }
    if (!ok) return false;
    prevPlaying = ext.playing || anim;
    optOutToneMapping();                      // animations may add unlit overlay materials
    if (opts.enlarge && mainView !== 'exterior') {
      var prev = mainView;
      setMainView('exterior', true);
      enlargeRestore = prev;
    }
    return true;
  }
  function pickMode(fn) { pickFn = typeof fn === 'function' ? fn : null; }
  function setPaused(b) {
    if (!state) return;
    var v = !!b;
    if (!!state.paused === v) return;
    state.paused = v;
    emit('pause', v);
  }
  function applyPreset(name) {
    if (!state) return null;
    if (Sim && Sim.applyPreset) Sim.applyPreset(state, name);
    cancelMomentary();
    releaseAllKeys();
    frameAcc = 0;
    emit('scenario', name);
    emit('frame', state, 0);
    return state;
  }

  /* ------------------------------------------------------------------ rendering pipeline (RENDERING NOTES) */
  var ENV_VERT = 'varying vec3 vDir;\nvoid main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  // Procedural HDR radiance (linear). Directions are in cockpit space (nose −Z, Y up). uUp = world up seen from the
  // cabin (banks/pitch tilt the horizon), uSun = sun direction in the same space. uCabin = 1 adds the cabin around the
  // window openings so interior surfaces get believable, directional ambient light and reflections. uStudio = 1 is the
  // exterior 'configurator' sky: soft blue-grey dome, light floor, a horizon glow and large white softboxes (a long
  // overhead strip along the fuselage, two side panels, a low front panel) that draw clean highlights on the paint.
  var ENV_FRAG = [
    'uniform vec3 uSun; uniform vec3 uUp; uniform float uCabin; uniform float uStudio;',
    'varying vec3 vDir;',
    'float band(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }',
    'vec3 outdoor(vec3 d) {',
    '  float e = dot(d, uUp);',
    '  vec3 c;',
    '  if (e >= 0.0) c = mix(vec3(0.84, 0.91, 1.02), vec3(0.15, 0.30, 0.72), pow(e, 0.42)) * 1.9;',
    '  else c = mix(vec3(0.42, 0.44, 0.38), vec3(0.12, 0.14, 0.08), smoothstep(0.0, 0.3, -e)) * 1.5;',
    '  float sd = max(dot(d, uSun), 0.0);',
    '  float up = smoothstep(-0.1, 0.05, dot(uSun, uUp));',
    '  c += vec3(1.0, 0.92, 0.78) * (pow(sd, 40.0) * 1.4 + pow(sd, 5.0) * 0.3) * up;',
    '  return c;',
    '}',
    'vec3 studio(vec3 d) {',
    '  float e = d.y;',
    '  vec3 c = e >= 0.0 ? mix(vec3(0.80, 0.86, 0.94), vec3(0.30, 0.44, 0.72), pow(e, 0.5)) * 0.8',
    '                    : mix(vec3(0.46, 0.47, 0.45), vec3(0.26, 0.27, 0.26), smoothstep(0.0, 0.5, -e));',
    '  c += vec3(0.92, 0.94, 0.97) * 0.26 * exp(-abs(e) * 12.0);',
    '  float strip = smoothstep(0.70, 0.78, e) * (1.0 - smoothstep(0.15, 0.22, abs(d.x)));',
    '  float side = band(e, 0.10, 0.42, 0.04) * smoothstep(0.62, 0.74, abs(d.x)) * (1.0 - smoothstep(0.45, 0.62, abs(d.z)));',
    '  float front = band(e, 0.04, 0.24, 0.04) * smoothstep(0.80, 0.90, -d.z) * (1.0 - smoothstep(0.30, 0.42, abs(d.x)));',
    '  return c + vec3(1.0, 0.99, 0.97) * (strip * 2.4 + side * 1.5 + front * 1.1);',
    '}',
    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  vec3 sky = uStudio > 0.5 ? studio(d) : outdoor(d);',
    '  vec3 col = sky;',
    '  if (uCabin > 0.5) {',
    '    float fwd = smoothstep(0.2, 0.55, -d.z), back = smoothstep(0.35, 0.7, d.z), side = smoothstep(0.5, 0.8, abs(d.x));',
    '    float win = fwd * band(d.y, -0.17, 0.30, 0.05) + side * band(d.y, -0.50, 0.12, 0.05) + back * band(d.y, 0.22, 0.58, 0.07);',
    '    win = clamp(win, 0.0, 1.0);',
    '    vec3 headliner = vec3(0.60, 0.56, 0.48) * 0.36;',
    '    vec3 wall = vec3(0.50, 0.42, 0.30) * 0.26;',
    '    vec3 carpet = vec3(0.28, 0.12, 0.07) * 0.30;',
    '    vec3 dash = vec3(0.022, 0.023, 0.026);',
    '    vec3 seat = vec3(0.10, 0.15, 0.23) * 0.40;',
    '    vec3 c = mix(wall, headliner, smoothstep(0.2, 0.65, d.y));',
    '    c = mix(c, carpet, 1.0 - smoothstep(-0.72, -0.38, d.y));',
    '    c = mix(c, dash, fwd * (1.0 - smoothstep(-0.25, -0.08, d.y)) * smoothstep(-0.95, -0.72, d.y));',
    '    c = mix(c, seat, back * (1.0 - smoothstep(0.04, 0.24, d.y)) * smoothstep(-0.8, -0.45, d.y));',
    '    col = mix(c, sky * vec3(0.90, 0.94, 0.93), win);',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function srgbColor(TT, rgb) { return new TT.Color().setRGB(rgb[0], rgb[1], rgb[2]); }   // already linear values

  /** Static: physically based renderer settings for a quality level. */
  function configureRenderer(r, level, THREEref) {
    var TT = THREEref || T || root.THREE, q = QUALITY[level] || QUALITY.alta;
    modernColorManagement(TT);
    r.outputEncoding = TT.sRGBEncoding;
    r.toneMapping = TT.ACESFilmicToneMapping;
    r.toneMappingExposure = EXPOSURE;
    r.physicallyCorrectLights = true;
    r.shadowMap.enabled = q.shadow > 0;
    r.shadowMap.type = q.soft ? TT.PCFSoftShadowMap : TT.PCFShadowMap;
    return r;
  }

  /** Static: a PMREM environment from the procedural sky ({cabin: bool, size: cube face px}). */
  function createEnvironment(r, opts, THREEref) {
    var TT = THREEref || T || root.THREE;
    opts = opts || {};
    var size = opts.size || 128;
    var uni = {
      uSun: { value: new TT.Vector3(0.35, 0.8, -0.45).normalize() },
      uUp: { value: new TT.Vector3(0, 1, 0) },
      uCabin: { value: opts.cabin ? 1 : 0 },
      uStudio: { value: opts.studio && !opts.cabin ? 1 : 0 }
    };
    var envScene = new TT.Scene();
    var mat = new TT.ShaderMaterial({ uniforms: uni, vertexShader: ENV_VERT, fragmentShader: ENV_FRAG, side: TT.BackSide, depthWrite: false, depthTest: false });
    var geo = new TT.SphereGeometry(10, 48, 24);
    envScene.add(new TT.Mesh(geo, mat));
    var cubeRT = new TT.WebGLCubeRenderTarget(size, { type: TT.HalfFloatType, generateMipmaps: false, minFilter: TT.LinearFilter, magFilter: TT.LinearFilter });
    var cubeCam = new TT.CubeCamera(0.1, 50, cubeRT);
    var pmrem = new TT.PMREMGenerator(r);
    var target = null;
    var env = { texture: null, size: size, cabin: !!opts.cabin };
    env.update = function (sunLocal, upLocal) {
      if (sunLocal) uni.uSun.value.copy(sunLocal).normalize();
      if (upLocal) uni.uUp.value.copy(upLocal).normalize();
      var sm = r.shadowMap.autoUpdate;
      cubeCam.update(r, envScene);
      target = pmrem.fromCubemap(cubeRT.texture, target);
      r.shadowMap.autoUpdate = sm;
      env.texture = target.texture;
      return env.texture;
    };
    env.dispose = function () {
      if (target) target.dispose();
      cubeRT.dispose(); pmrem.dispose(); geo.dispose(); mat.dispose();
      target = null; env.texture = null;
    };
    env.update();
    return env;
  }

  function eachMaterial(obj, fn) {
    if (!obj) return;
    obj.traverse(function (o) {
      var m = o.material; if (!m) return;
      if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) if (m[i]) fn(m[i], o); } else fn(m, o);
    });
  }
  function markAllMaterials() {
    var f = function (m) { m.needsUpdate = true; };
    eachMaterial(scene, f);
    if (ext && ext.scene) eachMaterial(ext.scene, f);
  }
  // world: unlit scenery, never tone mapped. exterior: only its unlit helpers opt out (lit paint is tone mapped).
  function optOutToneMapping() {
    eachMaterial(world && world.group, function (m) { if (m.toneMapped !== false) { m.toneMapped = false; m.needsUpdate = true; } });
    eachMaterial(ext && ext.scene, function (m) {
      if ((m.isMeshBasicMaterial || m.isSpriteMaterial || m.isLineBasicMaterial || m.isPointsMaterial) && m.toneMapped !== false) {
        m.toneMapped = false; m.needsUpdate = true;
      }
    });
  }
  function setToneMapping(mode) {
    if (!renderer) return;
    toneMode = mode === 'none' ? 'none' : 'aces';
    renderer.toneMapping = toneMode === 'aces' ? T.ACESFilmicToneMapping : T.NoToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    optOutToneMapping();
    markAllMaterials();
  }

  function buildLights() {
    hemi = new T.HemisphereLight(srgbColor(T, LIGHT.hemiSky), srgbColor(T, LIGHT.hemiGround), LIGHT.hemi);
    sun = new T.DirectionalLight(srgbColor(T, LIGHT.sunColor), LIGHT.sun);
    sun.name = 'sun';
    sun.target.position.set(SHADOW_CENTER[0], SHADOW_CENTER[1], SHADOW_CENTER[2]);
    sun.position.set(SHADOW_CENTER[0] - 2, SHADOW_CENTER[1] + 4, SHADOW_CENTER[2] - 2.5);
    var sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 0.5; sc.far = SHADOW_DIST + 3; sc.updateProjectionMatrix();
    sun.shadow.bias = SHADOW_BIAS; sun.shadow.normalBias = SHADOW_NBIAS;
    sun.shadow.autoUpdate = false;                   // re-rendered only when the sun or a cockpit part moves
    sun.shadow.needsUpdate = true;
    bounce = new T.DirectionalLight(srgbColor(T, LIGHT.bounceColor), LIGHT.bounce);
    bounce.name = 'bounce';
    bounce.position.set(0.05, -1.0, 0.75);           // light travels up and forward from the sunlit floor and seats
    scene.add(hemi, sun, sun.target, bounce);
  }

  function pickAutoQuality() {
    var nav = root.navigator || {};
    var cores = nav.hardwareConcurrency || 8, mem = nav.deviceMemory || 8;
    if (isMobile() || cores <= 2 || mem <= 2) return 'media';
    return 'alta';
  }
  function rebuildEnvironments() {
    var q = QUALITY[quality] || QUALITY.alta;
    try {
      if (!envCabin || envCabin.size !== q.env) {
        if (envCabin) envCabin.dispose();
        envCabin = createEnvironment(renderer, { cabin: true, size: q.env });
        envAge = 1e9;                            // re-aim it at the current sun/horizon on the next frame
      }
      if (ext && ext.scene && (!envOutdoor || envOutdoor.size !== q.env)) {
        var own = ext.scene.environment && (!envOutdoor || ext.scene.environment !== envOutdoor.texture);
        if (envOutdoor) envOutdoor.dispose();
        envOutdoor = createEnvironment(renderer, { cabin: false, studio: true, size: q.env });
        if (!own) ext.scene.environment = envOutdoor.texture;
      }
      if (scene) scene.environment = envCabin ? envCabin.texture : null;
    } catch (e) { reportOnce('environment', e); }
  }
  function applyQuality(level) {
    if (!renderer || !QUALITY[level]) return;
    var q = QUALITY[level], prev = quality;
    quality = level;
    var shadowOn = q.shadow > 0, type = q.soft ? T.PCFSoftShadowMap : T.PCFShadowMap;
    var changed = renderer.shadowMap.enabled !== shadowOn || renderer.shadowMap.type !== type;
    renderer.shadowMap.enabled = shadowOn;
    renderer.shadowMap.type = type;
    if (sun) {
      sun.castShadow = shadowOn;
      if (shadowOn && sun.shadow.mapSize.x !== q.shadow) {
        sun.shadow.mapSize.set(q.shadow, q.shadow);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      sun.shadow.needsUpdate = true;
    }
    rebuildEnvironments();
    if (world && world.setQuality) { try { world.setQuality(q.world); } catch (e) { reportOnce('world.setQuality', e); } }
    if (cockpit && cockpit.setQuality) { try { cockpit.setQuality(level); } catch (e) { reportOnce('cockpit.setQuality', e); } }
    if (changed || prev !== level) markAllMaterials();
    slowTime = 0; slowFrames = 0;
    resize();
    emit('quality', level, qualitySetting);
  }
  function setQuality(setting) {
    if (setting !== 'auto' && !QUALITY[setting]) return false;
    qualitySetting = setting;
    autoSteps = 0;
    if (!inited) { quality = setting === 'auto' ? quality : setting; return true; }
    applyQuality(setting === 'auto' ? pickAutoQuality() : setting);
    return true;
  }
  // 'auto' only: real animation frames that stay slow (> 40 ms for ~4 s) step the quality down once.
  function watchFrameTime(dt) {
    if (qualitySetting !== 'auto' || autoSteps >= 1 || clock < 4) return;
    if (dt > 0.040 && dt < 0.5) { slowTime += dt; slowFrames++; } else slowTime = Math.max(0, slowTime - dt * 0.5);
    if (slowTime > 4 && slowFrames > 60) {
      var i = QUALITY_ORDER.indexOf(quality);
      if (i >= 0 && i < QUALITY_ORDER.length - 1) {
        autoSteps++;
        console.info('[C150.Core] Slow frames: graphics quality lowered to "' + QUALITY_ORDER[i + 1] + '".');
        applyQuality(QUALITY_ORDER[i + 1]);
      } else autoSteps = 1;
    }
  }

  function updateLights(dt) {
    if (!sun) return;
    var haveSun = false;
    if (world && world.getSunDirectionLocal) {
      try { world.getSunDirectionLocal(vSun); haveSun = vSun.lengthSq() > 0.5; }
      catch (e) { reportOnce('world.getSunDirectionLocal', e); }
    }
    if (!haveSun) vSun.set(-0.35, 0.8, -0.5).normalize();
    sun.position.copy(sun.target.position).addScaledVector(vSun, SHADOW_DIST);
    // shadow map refresh: only when the sun direction moved (> ~0.06°) or a shadow-casting cockpit part moved
    var motion = cockpit ? cockpit.motion : 0;
    if (shadowSun.dot(vSun) < 0.9999995 || motion !== shadowMotion || typeof motion !== 'number') {
      shadowSun.copy(vSun); shadowMotion = motion; sun.shadow.needsUpdate = true;
    }
    // keep the shadow camera's 'up' away from the light direction
    sun.shadow.camera.up.set(Math.abs(vSun.y) > 0.95 ? 1 : 0, Math.abs(vSun.y) > 0.95 ? 0 : 1, 0);

    // IBL: re-bake the cabin environment when the sun or the horizon moved enough in cockpit space
    envAge += dt;
    if (envCabin) {
      envUpNow.set(0, 1, 0);
      if (world && world.group) envUpNow.transformDirection(world.group.matrix);
      var lim = Math.cos(ENV_STEP * Math.PI / 180);
      var moved = envSun.dot(vSun) < lim || envUp.dot(envUpNow) < lim;
      if ((moved && envAge >= ENV_MIN_INTERVAL) || envAge > 1e8) {
        envAge = 0; envSun.copy(vSun); envUp.copy(envUpNow);
        try { envCabin.update(vSun, envUpNow); } catch (e) { reportOnce('environment.update', e); }
      }
    }
  }

  /* ------------------------------------------------------------------ render loop */
  function fillRect(x, y, w, h, color) {
    renderer.setScissor(x, y, w, h);
    renderer.setClearColor(color, 1);
    renderer.clear(true, false, false);
  }
  // per-scene exposure (uniform refreshed per material on every render() call)
  function renderCabin() { renderer.toneMappingExposure = EXPOSURE; renderer.render(scene, camera); }
  function renderExterior() { renderer.toneMappingExposure = EXPOSURE_EXT; renderer.render(ext.scene, ext.camera); }
  function render() {
    var W = size.w, H = size.h;
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
    if (mainView === 'exterior' && ext) renderExterior();
    else renderCabin();
    if (insetRect) {
      var r = insetRect, y = H - r.y - r.h;
      renderer.setViewport(r.x, y, r.w, r.h); renderer.setScissor(r.x, y, r.w, r.h);
      if (mainView === 'exterior') renderCabin();
      else renderExterior();
      // thin frame: 1 px dark outline outside, 2 px light frame inside
      renderer.getClearColor(tmpColor);
      var a = renderer.getClearAlpha();
      fillRect(r.x - 1, y - 1, r.w + 2, 1, colDark); fillRect(r.x - 1, y + r.h, r.w + 2, 1, colDark);
      fillRect(r.x - 1, y, 1, r.h, colDark); fillRect(r.x + r.w, y, 1, r.h, colDark);
      fillRect(r.x, y, r.w, 2, colLight); fillRect(r.x, y + r.h - 2, r.w, 2, colLight);
      fillRect(r.x, y, 2, r.h, colLight); fillRect(r.x + r.w - 2, y, 2, r.h, colLight);
      renderer.setClearColor(tmpColor, a);
    }
    renderer.setScissorTest(false);
  }

  function frame(now) {
    rafId = root.requestAnimationFrame(frame);
    lastRafAt = nowMs(); wdLast = 0;
    if (typeof document !== 'undefined' && document.hidden) { lastNow = 0; return; }
    var dt = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    watchFrameTime(dt);
    tick(dt);
  }

  /** One frame of work: inputs → sim → modules → cameras → hover → render → 'frame' event. dt in seconds. */
  function tick(dt) {
    if (!inited || !state) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    // safety net for missed ResizeObserver notifications (e.g. container shown after display:none)
    sizeCheck += dt;
    if (sizeCheck >= 0.25) {
      sizeCheck = 0;
      if (container && (Math.round(container.clientWidth) !== size.w || Math.round(container.clientHeight) !== size.h) &&
        container.clientWidth > 0 && container.clientHeight > 0) resize();
    }

    updateInputs(dt);
    if (Sim && Sim.step && !state.paused) {
      try { Sim.step(state, dt); } catch (e) { reportOnce('Sim.step', e); }
    }
    if (world) { try { world.update(state, dt); } catch (e) { reportOnce('world.update', e); } }
    if (cockpit) { try { cockpit.update(state, dt); } catch (e) { reportOnce('cockpit.update', e); } }
    if (ext) {
      try {
        ext.followAttitude = !(state.air && state.air.onGround);
        ext.update(state, dt);
      } catch (e) { reportOnce('exterior.update', e); }
      var playing = ext.playing || null;
      if (prevPlaying && !playing) emit('animend', prevPlaying);
      prevPlaying = playing;
      // the air around the airplane: only while the exterior is on screen (main view or inset; the inset is 'baja')
      if (flow && (mainView === 'exterior' || insetRect)) {
        try { flow.update(state, dt, { inset: mainView !== 'exterior', quality: quality }); } catch (e) { reportOnce('airflow.update', e); }
      }
    }
    updateLights(dt);
    updateCameras(dt);
    updateHover();
    try { render(); } catch (e) { reportOnce('render', e); }

    frameAcc += dt;
    if (frameAcc >= FRAME_EVENT_DT) { var fdt = frameAcc; frameAcc = 0; emit('frame', state, fdt); }
  }

  // Some embedded hosts (preview panes, throttled iframes) stop calling requestAnimationFrame although the page is
  // visible: then a ~30 Hz timer keeps the simulation and the picture alive until animation frames come back.
  function watchdog() {
    if (!inited || (typeof document !== 'undefined' && document.hidden)) { wdLast = 0; return; }
    var t = nowMs();
    if (t - lastRafAt < 250) { wdLast = 0; return; }
    var dt = wdLast ? (t - wdLast) / 1000 : 1 / 30;
    wdLast = t; lastNow = 0;
    tick(dt);
  }

  function onVisibility() { lastNow = 0; if (typeof document !== 'undefined' && document.hidden) releaseAllKeys(); }

  /* ------------------------------------------------------------------ init / dispose */
  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    domHandlers.push([target, type, fn, opts]);
  }

  function init(opts) {
    opts = opts || {};
    if (inited) { console.warn('[C150.Core] init() called twice: ignored.'); return true; }
    T = opts.THREE || root.THREE || null;
    Sim = C150.Sim || null;
    container = opts.container || (typeof document !== 'undefined' ? document.body : null);
    state = opts.state || (Sim && Sim.createState ? Sim.createState('parked') : fallbackState());
    Core.state = state;
    if (!container) { fail('No hay contenedor para la vista 3D.'); return false; }
    if (!T) { fail('No se pudo cargar el motor 3D (Three.js). Revisá la conexión a Internet y recargá la página.'); return false; }

    // renderer (WebGL may be missing or blocked)
    try {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      fail('Tu navegador o dispositivo no puede mostrar gráficos 3D (WebGL no disponible o desactivado). ' +
        'Probá con otro navegador o activá la aceleración por hardware.', e);
      return false;
    }
    modernColorManagement(T);
    quality = qualitySetting === 'auto' ? 'alta' : quality;
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    configureRenderer(renderer, quality, T);
    canvas = renderer.domElement;
    canvas.className = 'c150-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Vista 3D de la cabina del Cessna 150. Arrastrá para mirar alrededor; tocá un control para ver qué hace.');
    var cs = canvas.style;
    cs.position = 'absolute'; cs.left = '0'; cs.top = '0'; cs.width = '100%'; cs.height = '100%';
    cs.display = 'block'; cs.touchAction = 'none'; cs.outline = 'none';
    try { if (root.getComputedStyle && root.getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch (e) { /* ignore */ }
    container.insertBefore(canvas, container.firstChild);
    // soft vignette over the 3D view (CSS, costs nothing per frame); heavier at the bottom, clear at the top corners
    // where the exterior inset sits
    try {
      grade = document.createElement('div');
      grade.className = 'c150-grade'; grade.setAttribute('aria-hidden', 'true');
      var gs = grade.style;
      gs.position = 'absolute'; gs.left = '0'; gs.top = '0'; gs.right = '0'; gs.bottom = '0'; gs.pointerEvents = 'none';
      gs.background = 'radial-gradient(125% 100% at 50% 28%, rgba(0,0,0,0) 60%, rgba(4,7,11,0.24) 100%)';
      container.insertBefore(grade, canvas.nextSibling);
    } catch (e) { grade = null; }
    listen(canvas, 'webglcontextlost', function () { console.warn('[C150.Core] WebGL context lost; waiting for the browser to restore it.'); }, false);

    // scratch objects
    raycaster = new T.Raycaster(); ndc = new T.Vector2();
    vA = new T.Vector3(); vB = new T.Vector3(); vC = new T.Vector3(); vSun = new T.Vector3(); camTarget = new T.Vector3();
    tmpColor = new T.Color(); colDark = new T.Color().setRGB(0.051, 0.075, 0.094); colLight = new T.Color().setRGB(0.91, 0.925, 0.937);
    envSun = new T.Vector3(0, 1, 0); envUp = new T.Vector3(0, 1, 0); envUpNow = new T.Vector3(0, 1, 0); shadowSun = new T.Vector3(0, 0, 0);

    try { mqReduced = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { mqReduced = null; }
    reducedMotion = !!(mqReduced && mqReduced.matches);
    if (mqReduced) {
      var onRM = function () { reducedMotion = !!mqReduced.matches; };
      if (mqReduced.addEventListener) mqReduced.addEventListener('change', onRM); else if (mqReduced.addListener) mqReduced.addListener(onRM);
    }
    try { mqCoarse = root.matchMedia ? root.matchMedia('(pointer: coarse)') : null; } catch (e) { mqCoarse = null; }

    // main scene: world + lights + cockpit
    scene = new T.Scene();
    scene.name = 'C150-main';
    var W0 = Math.max(1, container.clientWidth), H0 = Math.max(1, container.clientHeight);
    camera = new T.PerspectiveCamera(62, W0 / H0, (C150.World && C150.World.NEAR) || 0.03, (C150.World && C150.World.FAR) || 60000);
    try {
      if (!C150.World || !C150.World.create) throw new Error('C150.World no está cargado');
      world = C150.World.create(T);
      scene.add(world.group);
    } catch (e) {
      console.error('[C150.Core] World module unavailable, continuing without scenery:', e);
      world = null;
      scene.background = new T.Color().setRGB(0.61, 0.76, 0.89);
    }
    buildLights();
    try {
      if (!C150.Cockpit || !C150.Cockpit.create) throw new Error('C150.Cockpit no está cargado');
      cockpit = C150.Cockpit.create(T, { gauges: C150.Gauges });
      scene.add(cockpit.group);
    } catch (e) {
      console.error('[C150.Core] Cockpit module unavailable, continuing without the cabin:', e);
      cockpit = null;
    }
    try {
      if (!C150.Exterior || !C150.Exterior.create) throw new Error('C150.Exterior no está cargado');
      ext = C150.Exterior.create(T);
      extBaseFov = num(ext.camera && ext.camera.fov, 35);
      // the exterior's key light follows the same sun as the world (turned by the heading inside ext.update)
      if (ext.setSun && world && world.sunDirection) ext.setSun(world.sunDirection);
    } catch (e) {
      console.error('[C150.Core] Exterior module unavailable, continuing without the exterior view:', e);
      ext = null;
    }
    flow = null;
    if (ext && C150.Airflow && C150.Airflow.create) {
      try { flow = C150.Airflow.create(T, ext, {}); } catch (e) {
        console.error('[C150.Core] Airflow module unavailable, continuing without the air visualisation:', e);
        flow = null;
      }
    }
    // quality (pixel ratio, shadows, environment maps, module detail) — see RENDERING NOTES
    quality = qualitySetting === 'auto' ? pickAutoQuality() : (QUALITY[qualitySetting] ? qualitySetting : 'alta');

    // DOM listeners first (capture on the container runs before OrbitControls' listeners on the canvas)
    listen(container, 'pointerdown', onPointerDown, true);
    listen(container, 'pointermove', onPointerMove, true);
    listen(container, 'pointerup', onPointerUp, true);
    listen(container, 'pointercancel', onPointerUp, true);
    listen(container, 'wheel', onWheel, { capture: true, passive: false });
    listen(canvas, 'pointerleave', onPointerLeave, false);
    listen(root, 'keydown', onKeyDown, false);
    listen(root, 'keyup', onKeyUp, false);
    listen(root, 'blur', releaseAllKeys, false);
    if (typeof document !== 'undefined') listen(document, 'visibilitychange', onVisibility, false);

    // camera controls
    if (T.OrbitControls) {
      controls = new T.OrbitControls(camera, canvas);
      controls.enableDamping = true; controls.dampingFactor = 0.12;
      controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.8; controls.panSpeed = 0.6;
      controls.minDistance = MIN_DIST; controls.maxDistance = MAX_DIST;
      controls.enablePan = true; controls.screenSpacePanning = true;
      controls.addEventListener('start', function () { fly = null; emit('preset', null); });
      if (ext) {
        extControls = new T.OrbitControls(ext.camera, canvas);
        if (ext.target && ext.target.isVector3) extControls.target = ext.target;
        extControls.enableDamping = true; extControls.dampingFactor = 0.1;
        extControls.rotateSpeed = 0.7; extControls.panSpeed = 0.7;
        extControls.minDistance = 2.5; extControls.maxDistance = 40;
        extControls.maxPolarAngle = Math.PI * 0.92;
        extControls.enabled = false;
        extControls.addEventListener('start', function () {
          if (Math.abs(ext.camera.up.y - 1) > 1e-3) ext.camera.up.set(0, 1, 0);
        });
      }
    } else {
      console.error('[C150.Core] THREE.OrbitControls is missing: the camera can only move through presets.');
    }

    // size, default view, loop
    inited = true;
    if (opts.quality) qualitySetting = (opts.quality === 'auto' || QUALITY[opts.quality]) ? opts.quality : qualitySetting;
    applyQuality(qualitySetting === 'auto' ? pickAutoQuality() : qualitySetting);
    setToneMapping(opts.toneMapping === 'none' ? 'none' : 'aces');
    resize();
    if (root.ResizeObserver) {
      ro = new root.ResizeObserver(function () { resize(); });
      ro.observe(container);
    } else {
      listen(root, 'resize', resize, false);
    }
    var pilot = presetSpec('pilot');
    flyTo(pilot.position, pilot.target, true);
    if (extControls) extControls.update();
    lastNow = 0;
    lastRafAt = nowMs();
    rafId = root.requestAnimationFrame(frame);
    if (root.setInterval) wdId = root.setInterval(watchdog, 33);
    return true;
  }

  function dispose() {
    if (!inited) return;
    if (rafId) root.cancelAnimationFrame(rafId);
    rafId = 0;
    if (wdId) root.clearInterval(wdId);
    wdId = 0;
    if (ro) { ro.disconnect(); ro = null; }
    domHandlers.forEach(function (h) { h[0].removeEventListener(h[1], h[2], h[3]); });
    domHandlers = [];
    if (controls) controls.dispose();
    if (extControls) extControls.dispose();
    if (flow) { try { flow.dispose(); } catch (e) { /* ignore */ } }
    flow = null;
    if (envCabin) envCabin.dispose();
    if (envOutdoor) envOutdoor.dispose();
    envCabin = envOutdoor = null;
    if (renderer) { renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); }
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (grade && grade.parentNode) grade.parentNode.removeChild(grade);
    grade = null;
    inited = false; renderer = null; canvas = null; controls = null; extControls = null;
    scene = null; camera = null; world = null; cockpit = null; ext = null; container = null;
    selected = null; hovered = { id: null, sub: null }; targets = {}; pickFn = null; fly = null; ptr = null;
    pointersDown = {}; pointerCount = 0; mainView = 'cockpit'; enlargeRestore = null; insetRect = null;
    cancelMomentary(); keys = {};
    Core.cockpit = Core.world = Core.exterior = Core.renderer = Core.camera = Core.controls = Core.airflow = null;
  }

  /* ------------------------------------------------------------------ air lab hooks (airflow.js, exterior backdrops) */
  /** flow.set(opts) on the exterior airflow → its settings, or null without the module. */
  function setAirflow(o) {
    if (!flow) return null;
    try { return flow.set(o || {}); } catch (e) { reportOnce('airflow.set', e); return null; }
  }
  /** 'estudio' | 'cielo' | 'tunel' → true if applied. */
  function setBackdrop(name) {
    if (!ext || !ext.setBackdrop) return false;
    try { return ext.setBackdrop(name) !== false; } catch (e) { reportOnce('exterior.setBackdrop', e); return false; }
  }
  /**
   * Exterior camera view: an exterior view name ('lado', 'frente', 'arriba', 'tres-cuartos', 'persecucion', 'rear34'…),
   * an airflow focus region ('flaps', 'ailerons', 'elevator', 'rudder', 'prop', 'wingtips', 'stall', 'tail', 'wing')
   * or {pos, target}. Eases there (instant with prefers-reduced-motion); the orbit pivot follows when it ends.
   */
  function setExteriorView(name) {
    if (!ext || !ext.setView) return false;
    var v = name;
    if (typeof name === 'string' && flow && flow.views && flow.views[name] && (!ext.VIEWS || ext.VIEWS.indexOf(name) < 0)) v = flow.views[name];
    try { return ext.setView(v) !== false; } catch (e) { reportOnce('exterior.setView', e); return false; }
  }

  /* ------------------------------------------------------------------ public object */
  var Core = {
    init: function (opts) {
      var ok = init(opts);
      Core.cockpit = cockpit; Core.world = world; Core.exterior = ext;
      Core.renderer = renderer; Core.camera = camera; Core.controls = controls;
      Core.airflow = flow;
      return ok;
    },
    setAirflow: setAirflow,
    getAirflow: function () { return flow ? flow.get() : null; },
    setBackdrop: setBackdrop,
    getBackdrop: function () { return ext ? (ext.backdrop || 'estudio') : null; },
    setExteriorView: setExteriorView,
    on: on,
    off: off,
    select: select,
    focusPreset: focusPreset,
    setMainView: function (name) { return setMainView(name, false); },
    getMainView: getMainView,
    getInsetRect: getInsetRect,
    setTargetHighlight: setTargetHighlight,
    setExteriorHighlight: setExteriorHighlight,
    playExterior: playExterior,
    operate: operate,
    setInput: setInput,
    hold: hold,
    pickMode: pickMode,
    applyPreset: applyPreset,
    setPaused: setPaused,
    isMobile: isMobile,
    getSelected: function () { return selected; },
    isDraggable: function (id) { return !!DRAG_KIND[id]; },
    pickAt: pickAt,
    projectControl: projectControl,
    setInsetVisible: setInsetVisible,
    getCaption: function () { return ext ? (ext.caption || '') : ''; },
    setToneMapping: setToneMapping,
    setQuality: setQuality,
    getQuality: function () { return quality; },
    getQualitySetting: function () { return qualitySetting; },
    configureRenderer: function (r, level) { return configureRenderer(r, level || 'alta', root.THREE); },
    createEnvironment: function (r, o) { return createEnvironment(r, o, root.THREE); },
    tick: function (dt) { tick(num(dt, 1 / 60)); },
    dispose: dispose,
    state: null,
    cockpit: null, world: null, exterior: null, renderer: null, camera: null, controls: null, airflow: null
  };

  C150.Core = Core;
})(root.C150);
