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
 *     'viewchange'('cockpit'|'exterior')    'pick'(id)          'layout'(payload, see v3) 'error'(message)
 *     *'preset'(name|null) camera preset (null: the camera left it — user orbit or fly to a control)
 *     *'scenario'(name) sim preset applied (applyPreset)  *'pause'(bool)
 *     *'animend'(animName)  (an exterior animation finished on its own)
 *   select(id|null, {focus}) · focusPreset(name, {keepView}*) · setMainView(name) · getMainView() · getInsetRect()
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
 *   Contract v3:
 *   *setLayout('cabina'|'dos'|'afuera') → bool · *getLayout(). 'cabina' = cockpit big + exterior inset, 'afuera' = exterior
 *     big + cockpit inset, 'dos' = both at the SAME size, side by side when the view is at least as wide as tall (cockpit
 *     left, exterior right) or stacked (cockpit on top), 2 px divider, no inset; picking, hover and drags work in the
 *     cockpit half, orbit/zoom in the half under the pointer. setMainView(name) (public) leaves 'dos'; select/focus,
 *     playExterior({enlarge}) and the C key do not. The 'layout' payload keeps the inset fields (x, y, w, h — absent
 *     when there is no inset, so old listeners see "no inset") and adds { mode, main, split, rects: { cockpit, exterior,
 *     inset } } (css px in the container, null when hidden). The UI persists the choice.
 *   *isInteracting() → true while the student is still moving a control (pointer pressed on a draggable control, a
 *     press-and-hold from the 3D view or hold(), keyboard flying, a held throttle/trim/flap key, or a UI interaction
 *     registered with *setInteracting(tag, bool)). Event *'interactionend' when the last one finishes. Camera fly-to
 *     (select(id,{focus}), focusPreset) never starts while interacting or while a pointer is down on the 3D view: it
 *     waits and starts 0.25 s after the release (a newer select without focus cancels it).
 *   *poseExterior(name) → Spanish caption | false (ext.pose: a held movement) · *clearPose() · *getPoses() (ext.POSES)
 *   *getAnimState() → ext.animState | null · *isMirroring() · event *'mirror'(bool).
 *     MIRROR: whenever ext.animState.active (a lesson animation or a pose), core snapshots the sim state once, turns on
 *     state.puppet (sim.js) and every frame copies the animation's bank/pitch/yaw/ias/vs/turnRate/slip into the puppet
 *     and its yokeRoll/yokePitch/rudder/brakes/throttle/flaps/engineOn into the inputs (engine via Sim.actions.setEngine,
 *     flaps: the switch shows the direction of travel and the indicator follows exactly), with the master on, the
 *     gyros spun and, for a flight movement started on the ground, the airplane lifted to 1500 ft AGL (a practice-area
 *     height) under a clear sky (world.setHaze(0.45): a crisp horizon line through the windshield). So the cockpit,
 *     the world through the windshield and every instrument show the movement from inside. When it ends the snapshot is
 *     restored in place (events and time are not rolled back). The sim keeps stepping during a mirror even if paused.
 *     applyPreset during a mirror drops the snapshot (the new preset is the base of the next one).
 *   *setAirPeek(bool | 'vuelo') · *getAirPeek() → {region, key, caption, virtual, mode}|null · event *'airpeek'(info|null):
 *     true (Explorar, Recorrido, Checklists): moving a flight control in the cockpit briefly shows the air around that
 *     part in the exterior view with a caption (see "el aire en toda la app" below). 'vuelo' (VOLAR): the flow is always
 *     drawn while flying and a calm caption explains only deliberate inputs, with a cooldown per control (see "el aire
 *     en VOLAR"). getCaption() returns the peek caption while it runs and no animation or pose does.
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
 *   bias SHADOW_BIAS, normalBias SHADOW_NBIAS (metres). sun.shadow.autoUpdate = false: the map is re-rendered (sun-only changes at most every 0.12 s) only
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
  var SHADOW_SUN_INTERVAL = 0.12;   // s, slowest refresh of the cabin shadow map while only the sun moves (turns)
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
  var SPLIT_GAP = 2;               // px between the two halves of the 'dos' layout (a dark divider)
  var FOCUS_AFTER_RELEASE = 0.25;  // s: a camera move asked for during an interaction starts this long after it ends
  var LAYOUTS = { cabina: 1, dos: 1, afuera: 1 };
  var HELD_KEYS = { PageUp: 1, PageDown: 1, '+': 1, '=': 1, '-': 1, '_': 1, t: 1, g: 1, f: 1, r: 1 };
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
  var lastOperateAt = -1e9;   // ms of the last operate() (a click on a control): the air peek knows it was the student
  var hemi = null, sun = null, bounce = null;
  var shadowSun = null, shadowMotion = -1, shadowAge = 0;
  var envCabin = null, envOutdoor = null, envAge = 1e9, envSun = null, envUp = null, envUpNow = null;
  var quality = 'alta', qualitySetting = 'auto', slowTime = 0, slowFrames = 0, autoSteps = 0;
  var size = { w: 1, h: 1 }, insetRect = null, insetVisible = true, mainView = 'cockpit', enlargeRestore = null;
  var layout = 'cabina', cockRect = null, extRect = null;   // contract v3: 'cabina' | 'dos' | 'afuera' and the view rects
  var interactTags = {}, heldKeys = {}, interactingPrev = false, pendingFocus = null;   // isInteracting / deferred fly-to
  var mirror = null;          // exterior animation / pose mirrored in the cockpit: { snap, simRef, airborne }
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
    lastOperateAt = nowMs();
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
        if (!onOff) checkInteraction(0);
        return true;
    }
    return false;
  }
  function holdAndCheck(id, subId, onOff) {
    var r = hold(id, subId, onOff);
    checkInteraction(0);
    return r;
  }

  /* ------------------------------------------------------------------ interaction state (contract v3) */
  /**
   * True while the student is still moving a control: a pointer pressed on a draggable control (dragging or about to),
   * a press-and-hold (yoke, pedals, toe brakes, flap switch, ignition START — from the 3D view or from hold()), keyboard
   * flying (arrows, Z/X, B), a held control key (throttle ±, trim T/G, flaps F/R) or an interaction the UI registered
   * with setInteracting(tag, true). Checklists must not complete / advance while this is true.
   */
  /** A pointer gesture in progress (a lost pointerup never blocks for good: 60 s without movement = stale). */
  function ptrLive() { return !!ptr && nowMs() - (ptr.tMove || ptr.t0) < 60000; }
  function isInteracting() {
    if (ptrLive() && (ptr.mode === 'pending' || ptr.mode === 'drag' || ptr.mode === 'blocked')) return true;
    var hy = holdState.yoke;
    if (hy.left || hy.right || hy.pull || hy.push || holdState.rudder.left || holdState.rudder.right) return true;
    if (holdState.brakeL || holdState.brakeR || dragBrake.L || dragBrake.R || keyBrake) return true;
    if (flapHolders.key || flapHolders.ui || ignHeld) return true;
    if (keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown || keys.z || keys.x) return true;
    var t = nowMs(), k;
    for (k in heldKeys) {
      if (t - heldKeys[k] < 1200) return true;      // auto-repeat refreshes it; a lost keyup expires on its own
      delete heldKeys[k];
    }
    for (k in interactTags) if (interactTags[k]) return true;
    return false;
  }
  /** The camera must not move by itself: an interaction is running or a pointer is down on the 3D view (orbit). */
  function userBusy() { return ptrLive() || isInteracting(); }
  /** UI widgets (DOM sliders, pads, hold buttons) register their own interactions: setInteracting('pad', true/false). */
  function setInteracting(tag, onOff) {
    tag = String(tag || 'ui');
    if (onOff) interactTags[tag] = true; else delete interactTags[tag];
    checkInteraction(0);
    return isInteracting();
  }
  /** Emits 'interactionend' when the last interaction finishes and runs a deferred camera move a moment later. */
  function checkInteraction(dt) {
    var now = isInteracting();
    if (interactingPrev && !now) { interactingPrev = false; emit('interactionend'); }
    interactingPrev = now;
    if (pendingFocus && dt > 0) {
      if (userBusy()) pendingFocus.wait = FOCUS_AFTER_RELEASE;
      else if ((pendingFocus.wait -= dt) <= 0) {
        var pf = pendingFocus;
        pendingFocus = null;
        if (pf.kind === 'control') focusControl(pf.id); else focusPreset(pf.name, { keepView: pf.keepView });
      }
    }
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
    // never move the camera under the student's hand: wait until the drag / hold / orbit ends
    if (userBusy()) { pendingFocus = { kind: 'control', id: id, wait: FOCUS_AFTER_RELEASE }; return true; }
    if (layout !== 'dos' && mainView !== 'cockpit') setMainView('cockpit');
    flyTo(v.position, v.target, false);
    emit('preset', null);
    return true;
  }
  /** opts.keepView: do not bring the cockpit to the main view (a lesson framing the cockpit inset / pane). */
  function focusPreset(name, opts) {
    var p = presetSpec(name);
    if (!p || !camera) return false;
    var keep = !!(opts && opts.keepView);
    if (userBusy()) { pendingFocus = { kind: 'preset', name: name, keepView: keep, wait: FOCUS_AFTER_RELEASE }; return true; }
    if (layout !== 'dos' && mainView !== 'cockpit' && !keep) setMainView('cockpit');
    flyTo(p.position, p.target, false);
    emit('preset', name);
    return true;
  }
  function updateCameras(dt) {
    var split = layout === 'dos';
    if (fly) {
      fly.k = Math.min(1, fly.k + dt / FLY_TIME);
      var e = easeInOut(fly.k), tgt = controls ? controls.target : camTarget;
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      tgt.lerpVectors(fly.t0, fly.t1, e);
      camera.lookAt(tgt);
      if (fly.k >= 1) { fly = null; if (controls) controls.update(); hoverPos.dirty = true; }
    } else if (controls && (mainView === 'cockpit' || split)) {
      controls.update();
    }
    if (controls) clampBox(controls.target, PIVOT);
    clampBox(camera.position, CABIN);

    if (ext && extControls) {
      var busy = !!ext.cameraBusy;
      if ((mainView === 'exterior' || split) && !busy) {
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
  /** The split view is active: layout 'dos', the exterior exists and the view is big enough for two halves. */
  function isSplit() { return layout === 'dos' && !!ext && size.w >= 200 && size.h >= 150; }
  /**
   * View rectangles (css px, container space). 'dos': two equal halves, side by side when the view is at least as wide
   * as tall (cockpit left, exterior right), stacked otherwise (cockpit on top), SPLIT_GAP divider, no inset.
   * 'cabina' / 'afuera': the main view fills the container and the other one is the inset (when visible).
   */
  function computeRects() {
    var W = size.w, H = size.h, full = { x: 0, y: 0, w: W, h: H };
    if (isSplit()) {
      insetRect = null;
      if (W >= H) {
        var w1 = Math.floor((W - SPLIT_GAP) / 2);
        cockRect = { x: 0, y: 0, w: w1, h: H };
        extRect = { x: w1 + SPLIT_GAP, y: 0, w: W - w1 - SPLIT_GAP, h: H };
      } else {
        var h1 = Math.floor((H - SPLIT_GAP) / 2);
        cockRect = { x: 0, y: 0, w: W, h: h1 };
        extRect = { x: 0, y: h1 + SPLIT_GAP, w: W, h: H - h1 - SPLIT_GAP };
      }
      return;
    }
    insetRect = computeInset();
    if (mainView === 'exterior' && ext) { extRect = full; cockRect = insetRect; }
    else { cockRect = full; extRect = insetRect; }
  }
  function rectCopy(r) { return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }
  /** 'layout' payload: the inset rect fields as before (x, y, w, h — absent without an inset) + main, mode and rects. */
  function layoutPayload() {
    var p = getInsetRect() || {};
    p.mode = layout; p.main = mainView; p.split = isSplit();
    p.rects = { cockpit: rectCopy(cockRect), exterior: rectCopy(extRect), inset: rectCopy(insetRect) };
    return p;
  }
  function layoutViews() {
    var W = size.w, H = size.h;
    computeRects();
    var split = isSplit();
    var portraitPhone = isMobile() && H > W;
    if (camera && cockRect) {
      var casp = cockRect.w / Math.max(1, cockRect.h);
      camera.aspect = casp;
      // the full cockpit view as before; a tall half gets a wider vertical field of view so the panel still fits
      if (!split && cockRect === insetRect) camera.fov = 62;
      else if (split) camera.fov = casp < 1 ? 72 : 62;
      else camera.fov = portraitPhone ? 70 : 62;
      camera.updateProjectionMatrix();
    }
    if (ext && ext.camera) {
      var ew = extRect ? extRect.w : 4, eh = extRect ? extRect.h : 3;
      // exterior views are framed for 4:3: on narrower viewports widen the vertical fov to keep the 4:3 horizontal view
      var asp = ew / Math.max(1, eh), half = Math.tan(extBaseFov * Math.PI / 360);
      var margin = 1 + 0.15 * clamp((4 / 3 - asp) / (4 / 3 - 0.75), 0, 1);   // a little extra room on tall screens
      ext.camera.fov = asp < 4 / 3 ? Math.min(75, 2 * Math.atan(half * margin * (4 / 3) / asp) * 180 / Math.PI) : extBaseFov;
      try {
        if (ext.setSize) ext.setSize(ew, eh);
        else { ext.camera.aspect = asp; }
        // floating labels/panels of the exterior keep clear of the cockpit inset drawn over it
        if (ext.setOccluder) {
          ext.setOccluder(!split && mainView === 'exterior' && insetRect
            ? { x: insetRect.x, y: insetRect.y, w: insetRect.w, h: insetRect.h, vw: W, vh: H } : null);
        }
      } catch (e) { reportOnce('exterior.setSize', e); }
      ext.camera.updateProjectionMatrix();
    }
    if (!ptr) syncControlsEnabled(null);
    emit('layout', layoutPayload());
  }
  /** Which OrbitControls listen: the main view's, or in 'dos' the one under the pointer (where = 'cockpit'|'exterior'). */
  function syncControlsEnabled(where) {
    if (isSplit()) {
      var w = where || 'both';
      if (controls) controls.enabled = w === 'both' || w === 'cockpit';
      if (extControls) extControls.enabled = w === 'both' || w === 'exterior';
      return;
    }
    if (controls) controls.enabled = mainView === 'cockpit';
    if (extControls) extControls.enabled = mainView === 'exterior';
  }
  /** The cockpit view rect where controls can be picked (null: the cockpit is only the inset, which swaps on click). */
  function pickRect() {
    if (isSplit()) return cockRect;
    return mainView === 'cockpit' ? cockRect : null;
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
    if (!internal) {
      enlargeRestore = null;
      // an explicit main view leaves the split layout ('dos' -> 'cabina' / 'afuera')
      if (layout === 'dos') {
        layout = name === 'cockpit' ? 'cabina' : 'afuera';
        if (name === mainView) { setHover(null, null); layoutViews(); return true; }
      }
    }
    if (name === mainView) return true;
    mainView = name;
    if (layout !== 'dos') {
      layout = name === 'cockpit' ? 'cabina' : 'afuera';
      endDrag(true);
    }
    if ((name === 'exterior' || layout === 'dos') && extControls && ext && !ext.cameraBusy && ext.target && extControls.target !== ext.target) {
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
    if (!insetVisible && mainView === 'exterior' && layout !== 'dos') setMainView('cockpit');
    layoutViews();
  }
  /**
   * Contract v3: 'cabina' (cockpit big + exterior inset), 'dos' (both at the same size: side by side in landscape,
   * stacked in portrait, no inset) or 'afuera' (exterior big + cockpit inset). Emits 'layout' {mode, rects, ...}.
   */
  function setLayout(mode) {
    if (!LAYOUTS[mode]) return false;
    if (mode !== 'cabina' && !ext) return false;
    enlargeRestore = null;
    if (mode === 'dos') {
      if (layout === 'dos') return true;
      layout = 'dos';
      endDrag(true);
      if (extControls && ext && !ext.cameraBusy && ext.target && extControls.target !== ext.target) extControls.target.copy(ext.target);
      setHover(null, null);
      layoutViews();
      return true;
    }
    var want = mode === 'cabina' ? 'cockpit' : 'exterior';
    var wasSplit = layout === 'dos';
    layout = mode;
    if (want !== mainView) return setMainView(want, true);
    if (wasSplit) { setHover(null, null); layoutViews(); }
    return true;
  }
  function getLayout() { return layout; }

  /* ------------------------------------------------------------------ picking */
  function raycastAt(x, y, out) {
    var r = pickRect();
    if (!cockpit || !cockpit.pickables || !camera || !r || !inRect(x, y, r)) return null;
    ndc.set(((x - r.x) / r.w) * 2 - 1, -((y - r.y) / r.h) * 2 + 1);
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
      else if (isSplit() && !inRect(hoverPos.x, hoverPos.y, cockRect)) cursor = '';
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
    var r = cockRect;
    if (!r) return null;
    var x = r.x + (vA.x + 1) / 2 * r.w, y = r.y + (1 - vA.y) / 2 * r.h;
    return { x: x, y: y, visible: vB.z < 0 && Math.abs(vA.x) <= 1 && Math.abs(vA.y) <= 1 };
  }
  /** Screen (css px) of a world point, written into out {x, y}. */
  function toScreen(v, out) {
    var r = cockRect || { x: 0, y: 0, w: size.w, h: size.h };
    vB.copy(v).project(camera);
    out.x = r.x + (vB.x + 1) / 2 * r.w; out.y = r.y + (1 - vB.y) / 2 * r.h;
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
    if (isSplit()) {
      // two views: only the OrbitControls of the half under the pointer take this gesture
      ptr.view = inRect(pxy.x, pxy.y, extRect) ? 'exterior' : 'cockpit';
      syncControlsEnabled(ptr.view);
    }
    if (pickRect() && ev.button === 0) {
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
      ptr.tMove = nowMs();
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
    syncControlsEnabled(null);
    hoverPos.dirty = true;
    checkInteraction(0);
    if (isClick) handleClick(p);
  }

  function handleClick(p) {
    if (p.mode === 'inset') { setMainView(mainView === 'cockpit' ? 'exterior' : 'cockpit'); return; }
    if (!pickRect() || !p.hit) return;
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
    if (inRect(pxy.x, pxy.y, insetRect)) { ev.stopPropagation(); ev.preventDefault(); return; }
    if (isSplit() && !ptr) syncControlsEnabled(inRect(pxy.x, pxy.y, extRect) ? 'exterior' : 'cockpit');
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
    if (controls) controls.enabled = isSplit() ? ptr.view !== 'exterior' : mainView === 'cockpit';
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
      case 'c': if (!e.repeat && layout !== 'dos') setMainView(mainView === 'cockpit' ? 'exterior' : 'cockpit'); break;
      case 'p': if (!e.repeat) setPaused(!state.paused); break;
      case 'Escape': select(null); handled = false; break;
      default:
        if (k >= '1' && k <= '8' && k.length === 1) { if (!e.repeat) focusPreset(PRESET_KEYS[+k - 1]); }
        else handled = false;
    }
    if (handled && HELD_KEYS[k]) heldKeys[k] = nowMs();
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
    // Shift may be released first ('+' pressed, '=' released): clear both spellings
    if (k === '+' || k === '=') { delete heldKeys['+']; delete heldKeys['=']; }
    else if (k === '-' || k === '_') { delete heldKeys['-']; delete heldKeys['_']; }
    else delete heldKeys[k];
    checkInteraction(0);
  }
  function releaseAllKeys() {
    keys = {};
    heldKeys = {};
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
    else if (prev !== id) pendingFocus = null;               // a camera move still waiting for the old selection
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
    if (opts.enlarge && mainView !== 'exterior' && layout !== 'dos') {
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
    if (mirror) { mirror = null; mirrorHaze(false); emit('mirror', false); }   // the next frame starts a fresh mirror if a pose still runs
    if (peek.mode === 'vuelo') { endFlightCaption(); peek.trk = {}; }         // a new airplane: nothing the student did
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
    // shadow map refresh: when a shadow-casting cockpit part moved, or the sun direction moved (> ~0.06°). In a turn the
    // sun sweeps around the cabin every frame: then refresh at most every SHADOW_SUN_INTERVAL s (or after 1.5°), which
    // keeps turns (and mirrored demonstrations) as cheap as straight flight with no visible stepping.
    var motion = cockpit ? cockpit.motion : 0, sd = shadowSun.dot(vSun);
    shadowAge += dt;
    if (motion !== shadowMotion || typeof motion !== 'number' ||
        (sd < 0.9999995 && (shadowAge >= SHADOW_SUN_INTERVAL || sd < 0.99966))) {
      shadowSun.copy(vSun); shadowMotion = motion; sun.shadow.needsUpdate = true; shadowAge = 0;
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
    if (isSplit() && cockRect && extRect) {
      // 'dos': both views at the same size + a dark divider between them
      var c = cockRect, x = extRect;
      renderer.setViewport(c.x, H - c.y - c.h, c.w, c.h); renderer.setScissor(c.x, H - c.y - c.h, c.w, c.h);
      renderCabin();
      renderer.setViewport(x.x, H - x.y - x.h, x.w, x.h); renderer.setScissor(x.x, H - x.y - x.h, x.w, x.h);
      renderExterior();
      renderer.getClearColor(tmpColor);
      var ca = renderer.getClearAlpha();
      if (W >= H) fillRect(c.w, 0, SPLIT_GAP, H, colDark); else fillRect(0, H - c.h - SPLIT_GAP, W, SPLIT_GAP, colDark);
      renderer.setClearColor(tmpColor, ca);
      renderer.setScissorTest(false);
      return;
    }
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
    updateMirror(dt);
    if (Sim && Sim.step && (!state.paused || mirror)) {
      // a demonstration keeps moving the instruments even while the simulation is paused
      var wasPaused = !!state.paused;
      if (wasPaused) state.paused = false;
      try { Sim.step(state, dt); } catch (e) { reportOnce('Sim.step', e); }
      if (wasPaused) state.paused = true;
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
      var extShown = mainView === 'exterior' || !!insetRect || isSplit();
      try { updateAirPeek(dt, extShown); } catch (e) { reportOnce('airpeek', e); }
      if (flow && extShown) {
        try { flow.update(peek.on && peek.virtual && peek.vstate ? peek.vstate : state, dt, { inset: !(mainView === 'exterior' || isSplit()), quality: quality }); } catch (e) { reportOnce('airflow.update', e); }
      }
    }
    updateLights(dt);
    checkInteraction(dt);
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
    layout = 'cabina'; cockRect = extRect = null; interactTags = {}; heldKeys = {}; interactingPrev = false;
    pendingFocus = null; mirror = null;
    cancelMomentary(); keys = {};
    Core.cockpit = Core.world = Core.exterior = Core.renderer = Core.camera = Core.controls = Core.airflow = null;
  }

  /* ------------------------------------------------------------------ "el aire" en toda la app (contract v3, integration)
   * Moving a flight control in the cockpit (yoke, pedals, throttle, flaps, trim, carb heat) briefly shows the air
   * around the matching part of the airplane in the exterior view (inset, the 'dos' pane or the main view): the flow
   * focused on that region, the exterior camera framing it, and a short Spanish caption (getCaption / 'airpeek').
   * On the ground or slow (< 40 kt) the air is drawn as in flight at 75 kt (a proxy state for the flow only: the sim
   * is not touched) and the caption says so. It runs only when the UI enabled it (setAirPeek(true)), only for changes
   * the student made (pointer drag / hold / key / operate click), never during a mirror, in the tunnel, or while the
   * flow belongs to someone else (the AIRE lab, a lesson). The camera and the flow settings are given back after
   * PEEK_TIME s without changes. */
  var PEEK_TIME = 4.5, PEEK_VIRT_KT = 75;
  var PEEK_INPUTS = [
    { key: 'yokeRoll', eps: 0.08, region: 'ailerons' },
    { key: 'yokePitch', eps: 0.08, region: 'elevator' },
    { key: 'rudder', eps: 0.1, region: 'rudder' },
    { key: 'throttle', eps: 0.05, region: 'prop' },
    { key: 'flaps', eps: 0.8, region: 'flaps' },
    { key: 'trim', eps: 0.06, region: 'tail' },
    { key: 'carbHeat', eps: 0.2, region: 'prop' }
  ];
  var peek = { enabled: false, mode: null, on: null, key: null, t: 0, ref: {}, cam: null, flowWas: null, caption: '', virtual: false,
    vstate: null, vbase: null, vaero: null,
    // 'vuelo' (VOLAR): live flow + calm captions
    live: false, liveWas: null, trk: {}, shown: 0, idle: 0, v0: 0 };
  /** The UI turns the peek on in the modes where the student explores the cockpit (Explorar, Recorrido, Checklists):
   *  setAirPeek(true). VOLAR uses setAirPeek('vuelo') (see "El aire en VOLAR" below). false turns it off. */
  function setAirPeek(on) {
    var m = on === 'vuelo' ? 'vuelo' : (on ? 'explorar' : null);
    if (m !== peek.mode) {
      if (peek.mode === 'vuelo') endFlightFlow(); else endAirPeek();
      peek.ref = {}; peek.trk = {};
    }
    peek.mode = m;
    peek.enabled = !!m;
    return peek.enabled;
  }
  function getAirPeek() {
    return peek.on ? { region: peek.on, key: peek.key, caption: peek.caption, virtual: peek.virtual, mode: peek.mode } : null;
  }
  function peekCaption(key, s, dir) {
    var run = !!(s.engine && s.engine.running), v;
    switch (key) {
      case 'yokeRoll':
        v = num(s.yokeRoll, 0);
        if (v > 0.05) return 'Volante a la derecha: el alerón derecho sube y el izquierdo baja. El ala izquierda sustenta más y sube: el avión se inclina a la derecha.';
        if (v < -0.05) return 'Volante a la izquierda: el alerón izquierdo sube y el derecho baja. El ala derecha sustenta más y sube: el avión se inclina a la izquierda.';
        return 'Volante al centro: los alerones quedan parejos y las dos alas sustentan igual.';
      case 'yokePitch':
        v = num(s.yokePitch, 0);
        if (v > 0.05) return 'Volante hacia vos: el timón de profundidad sube, el aire empuja la cola hacia abajo y la nariz sube (más ángulo de ataque).';
        if (v < -0.05) return 'Volante hacia adelante: el timón de profundidad baja, el aire empuja la cola hacia arriba y la nariz baja.';
        return 'Volante al medio: el timón de profundidad queda alineado con el estabilizador.';
      case 'rudder':
        v = num(s.rudder, 0);
        if (v > 0.05) return 'Pedal derecho: el timón de dirección va a la derecha, el aire empuja la cola a la izquierda y la nariz va a la derecha.';
        if (v < -0.05) return 'Pedal izquierdo: el timón de dirección va a la izquierda, el aire empuja la cola a la derecha y la nariz va a la izquierda.';
        return 'Pedales parejos: el timón de dirección queda derecho.';
      case 'throttle':
        if (!run) return 'Con el motor apagado la hélice no gira y no tira aire: el acelerador cambia el empuje sólo con el motor en marcha.';
        return dir >= 0 ? 'Más acelerador: la hélice gira más rápido y tira más aire hacia atrás (más empuje). Ese chorro gira en espiral y pega en el lado izquierdo de la deriva: por eso va pie derecho.'
          : 'Menos acelerador: la hélice gira más lento y tira menos aire hacia atrás: menos empuje.';
      case 'flaps':
        v = num(s.flaps, 0);
        if (v > 1) return 'Flaps a ' + Math.round(v) + '°: el ala se curva más y tira más aire hacia abajo: más sustentación y mucha más resistencia.';
        return 'Flaps arriba: el ala vuelve a su forma limpia: menos sustentación y menos resistencia.';
      case 'trim':
        v = num(s.trim, 0);
        if (v > 0.05) return 'Compensador nariz arriba: la aletita del timón de profundidad baja; el aire la empuja y sostiene el timón arriba por vos.';
        if (v < -0.05) return 'Compensador nariz abajo: la aletita sube; el aire la empuja y sostiene el timón de profundidad abajo por vos.';
        return 'Compensador en TAKE OFF: la aletita queda casi alineada con el timón de profundidad.';
      case 'carbHeat':
        if (num(s.carbHeat, 0) > 0.5) return 'Calefacción al carburador: el motor toma aire caliente de al lado del escape. Es menos denso: bajan unas RPM y la hélice empuja un poco menos.' + (run ? '' : ' (Con el motor en marcha.)');
        return 'Calefacción fría: el motor vuelve a tomar aire frío y filtrado y recupera esas RPM.';
    }
    return '';
  }
  /** The flow's view of the airplane "as in flight at 75 kt" (prototype = the real state: controls, flaps, engine). */
  function peekVirtualState(s) {
    if (!peek.vstate || peek.vbase !== s) {
      peek.vstate = Object.create(s); peek.vbase = s;
      peek.vstate.air = {}; peek.vstate.tunnel = { on: false };
    }
    var v = peek.vstate, a = s.air || {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) v.air[k] = a[k];
    var yp = num(s.yokePitch, 0);
    var aoa = clamp(3 + (yp >= 0 ? 7 : 4) * yp, -2, 12);
    v.air.ias = PEEK_VIRT_KT; v.air.tas = PEEK_VIRT_KT * 1.02; v.air.aoa = aoa; v.air.vs = 0; v.air.onGround = false;
    if (Sim && Sim.aero) {
      peek.vaero = Sim.aero({ ias: PEEK_VIRT_KT, aoa: aoa, beta: 0, flaps: num(s.flaps, 0), rpm: num(s.propRpm, 0),
        yokeRoll: num(s.yokeRoll, 0), yokePitch: yp, rudder: num(s.rudder, 0), trim: num(s.trim, 0),
        altitude: 1500, throttle: num(s.throttle, 0) }, peek.vaero || undefined);
      v.aero = peek.vaero;
    }
    return v;
  }
  function startAirPeek(it, s, dir) {
    if (!flow || !ext) return;
    if (!peek.on) {
      var cur = null;
      try { cur = flow.get ? flow.get() : null; } catch (e) { cur = null; }
      if (cur && cur.enabled) return;                       // the lab or a lesson owns the flow
      peek.flowWas = cur ? { enabled: !!cur.enabled, streamlines: cur.streamlines, propwash: cur.propwash, vortices: cur.vortices,
        pressure: cur.pressure, forces: cur.forces, moments: cur.moments, trails: cur.trails } : { enabled: false };
      peek.cam = ext.camera && ext.target ? { pos: ext.camera.position.toArray(), target: ext.target.toArray(), up: ext.camera.up.toArray() } : null;
      setAirflow({ enabled: true, streamlines: true, propwash: true, vortices: true, pressure: false, forces: false, moments: true, trails: false });
    }
    if (peek.on !== it.region) {
      try { if (flow.focus) flow.focus(it.region); } catch (e) { reportOnce('airflow.focus', e); }
      setExteriorView(it.region);
    }
    peek.on = it.region; peek.key = it.key; peek.t = PEEK_TIME;
    peek.virtual = !(s.air && !s.air.onGround && num(s.air.ias, 0) >= 40);
    if (peek.virtual) peekVirtualState(s);
    var cap = peekCaption(it.key, s, dir);
    if (peek.virtual && cap && !(it.key === 'throttle' && !(s.engine && s.engine.running))) cap += ' (Así sería volando a ' + PEEK_VIRT_KT + ' nudos.)';
    if (cap !== peek.caption) { peek.caption = cap; emit('airpeek', getAirPeek()); }
  }
  function endAirPeek() {
    if (!peek.on) return;
    peek.on = null; peek.key = null; peek.caption = ''; peek.virtual = false;
    try { if (flow && flow.focus) flow.focus(null); } catch (e) { reportOnce('airflow.focus', e); }
    if (peek.flowWas) setAirflow(peek.flowWas);
    peek.flowWas = null;
    if (peek.cam && ext && ext.setView) { try { ext.setView(peek.cam); } catch (e) { reportOnce('exterior.setView', e); } }
    peek.cam = null;
    emit('airpeek', null);
  }
  function updateAirPeek(dt, extShown) {
    var s = state;
    if (!s) return;
    if (peek.mode === 'vuelo') { updateFlightPeek(dt, extShown); return; }
    var blocked = !peek.enabled || !flow || !ext || !!mirror || !!(s.tunnel && s.tunnel.on) || !extShown ||
      ext.backdrop === 'tunel' || !!ext.playing || !!ext.posing;
    var student = isInteracting() || nowMs() - lastOperateAt < 2500;
    for (var i = 0; i < PEEK_INPUTS.length; i++) {
      var it = PEEK_INPUTS[i], v = num(s[it.key], 0), r = peek.ref[it.key];
      if (r === undefined) { peek.ref[it.key] = v; continue; }
      var d = v - r;
      if (Math.abs(d) < it.eps) continue;
      peek.ref[it.key] = v;
      // a change the student made (or the one being shown, still moving: the flap motor) starts / extends the peek
      if (!blocked && (student || peek.key === it.key)) startAirPeek(it, s, d);
    }
    if (!peek.on) return;
    if (blocked) { endAirPeek(); return; }
    if (peek.virtual) peekVirtualState(s);
    if (isInteracting()) peek.t = Math.max(peek.t, 1.5);
    if ((peek.t -= dt) <= 0) endAirPeek();
  }

  /* ------------------------------------------------------------------ "el aire" en VOLAR (setAirPeek('vuelo'))
   * In VOLAR the controls move all the time, so the explore-style peek (camera fly-to + caption on every change) would
   * never stop. Instead: while flying (airborne, or rolling at ≥ 30 kt) and the exterior is on screen, the flow is ALWAYS
   * drawn around the airplane (streamlines, slipstream, tip vortices; the camera is never moved). A caption only comes
   * for a DELIBERATE input made by the student: a change of at least FLY_BIG[key] from where that control rested (small
   * corrections never count; a yoke / pedal coming back to the centre is not explained). The flow then emphasises that
   * region (flow.focus) and shows the moment arcs; the caption stays while the student keeps moving or holding that
   * control and FLY_LINGER s more (at least FLY_SHOW_MIN s on screen, to be read), then FLY_COOL s must pass before the
   * same control is explained again. Only one caption at a time; never during a mirror or in the tunnel. */
  var FLY_SHOW_MIN = 3, FLY_LINGER = 1.5, FLY_COOL = 6;
  var FLY_BIG = { yokeRoll: 0.3, yokePitch: 0.3, rudder: 0.35, throttle: 0.15, flaps: 4, trim: 0.2, carbHeat: 0.5 };
  var FLY_CENTERED = { yokeRoll: 0.12, yokePitch: 0.12, rudder: 0.12 };   // back near the centre: nothing to explain
  function startFlightFlow() {
    var cur = null;
    try { cur = flow.get ? flow.get() : null; } catch (e) { cur = null; }
    if (cur && cur.enabled) return false;                  // a lesson / the AIRE lab owns the flow
    peek.liveWas = cur ? { enabled: !!cur.enabled, streamlines: cur.streamlines, propwash: cur.propwash, vortices: cur.vortices,
      pressure: cur.pressure, forces: cur.forces, moments: cur.moments, trails: cur.trails } : { enabled: false };
    setAirflow({ enabled: true, streamlines: true, propwash: true, vortices: true, pressure: false, forces: false, moments: false, trails: false });
    peek.live = true;
    return true;
  }
  function endFlightCaption() {
    if (!peek.on) return;
    var tr = peek.trk[peek.key];
    if (tr) { tr.ref = num(state && state[peek.key], tr.ref); tr.cool = FLY_COOL; }
    peek.on = null; peek.key = null; peek.caption = '';
    try { if (flow && flow.focus) flow.focus(null); } catch (e) { reportOnce('airflow.focus', e); }
    if (peek.live) setAirflow({ moments: false });
    emit('airpeek', null);
  }
  function endFlightFlow() {
    endFlightCaption();
    if (!peek.live) return;
    peek.live = false;
    if (peek.liveWas) setAirflow(peek.liveWas);
    peek.liveWas = null;
  }
  function updateFlightPeek(dt, extShown) {
    var s = state, air = s.air || {};
    var blocked = !peek.enabled || !flow || !ext || !!mirror || !!(s.tunnel && s.tunnel.on) || !extShown ||
      ext.backdrop === 'tunel' || !!ext.playing || !!ext.posing;
    var flying = !air.onGround || num(air.ias, 0) >= (peek.live ? 20 : 30);
    if (!blocked && flying && !peek.live) startFlightFlow();
    else if ((blocked || !flying) && peek.live) endFlightFlow();
    var student = isInteracting() || nowMs() - lastOperateAt < 2500;
    for (var i = 0; i < PEEK_INPUTS.length; i++) {
      var it = PEEK_INPUTS[i], v = num(s[it.key], 0), tr = peek.trk[it.key];
      if (!tr) { peek.trk[it.key] = { ref: v, anchor: v, still: 0, cool: 0 }; continue; }
      tr.cool = Math.max(0, tr.cool - dt);
      if (Math.abs(v - tr.anchor) > it.eps * 0.5) { tr.anchor = v; tr.still = 0; } else tr.still += dt;
      if (peek.on && peek.key === it.key) continue;        // the one being explained (below)
      if (!peek.live) { tr.ref = v; continue; }
      if (Math.abs(v - tr.ref) < FLY_BIG[it.key]) continue;
      var centred = FLY_CENTERED[it.key] !== undefined && Math.abs(v) < FLY_CENTERED[it.key];
      // a change nobody will hear about: not the student's, back to the centre, another caption on, or cooling down
      if (!student || centred || peek.on || tr.cool > 0) { if (tr.still > 0.3 || !student) tr.ref = v; continue; }
      peek.on = it.region; peek.key = it.key; peek.virtual = false; peek.shown = 0; peek.idle = 0; peek.v0 = tr.ref;
      try { if (flow.focus) flow.focus(it.region); } catch (e) { reportOnce('airflow.focus', e); }
      setAirflow({ moments: true });
    }
    if (!peek.on) return;
    var k = peek.key, cur = num(s[k], 0), t = peek.trk[k];
    peek.shown += dt;
    var holding = FLY_CENTERED[k] !== undefined && Math.abs(cur) >= FLY_CENTERED[k] && isInteracting();
    if ((t && t.still === 0) || holding) peek.idle = 0; else peek.idle += dt;
    // back near the centre (yoke / pedals released): the explanation of what was done stays while it lingers
    if (!(FLY_CENTERED[k] !== undefined && Math.abs(cur) < FLY_CENTERED[k] && peek.caption)) {
      var cap = peekCaption(k, s, cur - peek.v0);
      if (cap !== peek.caption) { peek.caption = cap; emit('airpeek', getAirPeek()); }
    }
    if (peek.shown >= FLY_SHOW_MIN && peek.idle >= FLY_LINGER) endFlightCaption();
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

  /* ------------------------------------------------------------------ "así se ve desde adentro" (contract v3 mirror) */
  // While the exterior plays an animation or holds a pose (ext.animState.active), the sim is put in puppet mode and
  // every frame gets the animation's attitude/speed + control inputs, so the cockpit (yoke, pedals, throttle, flap
  // switch and indicator, propeller), the world through the windshield and every gauge show the same movement from
  // inside. The state is snapshotted once when it starts and restored (in place) when it ends.
  var SNAP_SKIP = { events: 1, time: 1, paused: 1 };
  function snapCopy(src, top) {
    var o = {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k) || (top && SNAP_SKIP[k])) continue;
      var v = src[k];
      if (typeof v === 'function') continue;
      if (v && typeof v === 'object') o[k] = Array.isArray(v) ? v.slice() : snapCopy(v, false);
      else o[k] = v;
    }
    return o;
  }
  function snapRestore(dst, src) {
    for (var k in src) {
      var v = src[k], d = dst[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d)) snapRestore(d, v);
      else dst[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  function getAnimState() {
    var a = ext && ext.animState;
    return (a && typeof a === 'object') ? a : null;
  }
  function animAirborne(a) {
    if (a.ground === true || a.onGround === true) return false;
    if (a.ground === false || a.onGround === false) return true;
    return num(a.ias, 0) > 30 || Math.abs(num(a.bank, 0)) > 2 || Math.abs(num(a.vs, 0)) > 50 || Math.abs(num(a.pitch, 0)) > 4;
  }
  var DEMO_AGL = 1500;     // ft above the field for a flight demonstration started on the ground (practice-area height)
  var DEMO_HAZE = 0.45;    // aerial-haze density during a demonstration (world.setHaze: 1 = the usual hazy afternoon)
  /** A clear, crisp day for a demonstration: the far fields keep their colour, so the horizon is a sharp line through
   *  the windshield and the bank / pitch read at a glance (world.setHaze, eased); the usual haze comes back after. */
  function mirrorHaze(on) {
    if (world && world.setHaze) { try { world.setHaze(on ? DEMO_HAZE : 1); } catch (e) { reportOnce('world.setHaze', e); } }
  }
  function startMirror(a) {
    var air = state.air;
    mirror = { snap: snapCopy(state, true), simRef: state._sim, airborne: null, thr: null };
    cancelMomentary();
    endDrag(true);
    // a demonstration needs a live cockpit: unlocked controls, power on, gyros spinning, out of the wind tunnel
    state.controlLock = false;
    if (state.tunnel) state.tunnel.on = false;
    setMaster('bat', true); setMaster('alt', true);
    if (state.gyro) { state.gyro.aiSpin = 1; state.gyro.hiSpin = 1; }
    if (state.vacuum) state.vacuum.suctionInHg = Math.max(num(state.vacuum.suctionInHg, 0), 5);
    if (state.elec && num(state.elec.batteryPct, 100) < 60) state.elec.batteryPct = 80;
    if (air) air.hiHeading = air.heading;
    mirrorHaze(true);
    emit('mirror', true);
  }
  function endMirror() {
    var m = mirror;
    mirror = null;
    if (!m || !state) return;
    snapRestore(state, m.snap);
    if (state.puppet) state.puppet.on = false;
    cancelMomentary();
    mirrorHaze(false);
    emit('mirror', false);
    emit('frame', state, 0);
  }
  function applyMirror(a, dt) {
    var pp = state.puppet, air = state.air, act = actions();
    var airborne = animAirborne(a);
    if (airborne && mirror.airborne !== true) {
      // seen from inside a flight demonstration needs air under the wings: a practice-area height (DEMO_AGL ft), low
      // enough that the fields, the roads and the horizon line stay crisp through the windshield
      if (air.onGround || num(air.altitude, 0) < num(state.fieldElevation, 0) + 300) {
        air.altitude = num(state.fieldElevation, 0) + DEMO_AGL;
        air.onGround = false;
      }
    }
    mirror.airborne = airborne;
    var ias = num(a.ias, 0);
    if (airborne && ias < 40) ias = num(a.vs, 0) > 200 ? 68 : 85;      // a flight pose without a speed: Vy / cruise
    pp.on = true;
    pp.tau = 0.08;                            // the exterior already eases its movements: stay in step with it
    pp.onGround = !airborne;
    pp.bank = num(a.bank, 0); pp.pitch = num(a.pitch, 0);
    pp.ias = ias; pp.vs = num(a.vs, 0);
    // exterior.js gives the turn rate INCLUDING the nose swinging on screen (yaw rate): then the yaw is not added again
    var hasTurn = typeof a.turnRate === 'number' && isFinite(a.turnRate);
    pp.turnRate = hasTurn ? a.turnRate : null;
    pp.yaw = hasTurn ? 0 : num(a.yaw, 0);
    pp.slip = (typeof a.slip === 'number' && isFinite(a.slip)) ? a.slip : null;
    pp.aoa = (airborne && typeof a.aoa === 'number' && isFinite(a.aoa)) ? a.aoa : null;
    if (typeof a.trim === 'number' && isFinite(a.trim)) state.trim = clamp(a.trim, -1, 1);
    if (typeof a.carbHeat === 'number' && isFinite(a.carbHeat)) state.carbHeat = clamp(a.carbHeat, 0, 1);
    // the hands and feet of the demonstration
    state.yokeRoll = clamp(num(a.yokeRoll, 0), -1, 1);
    state.yokePitch = clamp(num(a.yokePitch, 0), -1, 1);
    state.rudder = clamp(num(a.rudder, 0), -1, 1);
    state.brakeL = clamp(num(a.brakeL, 0), 0, 1);
    state.brakeR = clamp(num(a.brakeR, 0), 0, 1);
    if (airborne || ias > 1) state.parkingBrake = false;
    var engineOn = typeof a.engineOn === 'boolean' ? a.engineOn : (num(a.rpm, 0) > 300 || airborne ? true : null);
    var thrA = (typeof a.throttle === 'number' && isFinite(a.throttle)) ? clamp(a.throttle, 0, 1) : null;
    // In flight, the throttle is the one that really holds this speed and climb in the simulator (Sim.steadyThrottle):
    // the tachometer agrees with the movement and the force arrows balance (thrust = drag in level flight). Idle and
    // full power demonstrations keep their throttle. The knob moves at a hand's pace.
    var thrT = thrA;
    if (airborne && engineOn !== false && thrA !== null && thrA > 0.05 && thrA < 0.95 && Sim.steadyThrottle &&
        state.engine && state.engine.running) {
      var ts = Sim.steadyThrottle(state, pp.ias, pp.vs, pp.bank);
      if (ts !== null) thrT = clamp(ts, 0.06, 0.94);
    }
    if (thrT !== null) {
      if (mirror.thr === null || mirror.thr === undefined || !(dt > 0)) mirror.thr = thrT;
      else mirror.thr += clamp(thrT - mirror.thr, -0.8 * dt, 0.8 * dt);
      state.throttle = mirror.thr;
    }
    if (engineOn !== null && act && act.setEngine && !!(state.engine && state.engine.running) !== engineOn) act.setEngine(state, engineOn);
    if (typeof a.flaps === 'number' && isFinite(a.flaps)) {
      var f = clamp(a.flaps, 0, 40), cur = num(state.flaps, 0);
      // the flap switch shows the direction of travel, the indicator follows the exterior exactly
      setFlapSwitch(f > cur + 0.3 ? 'DOWN' : (f < cur - 0.3 ? 'UP' : 'OFF'));
      state.flaps = f;
    }
  }
  function updateMirror(dt) {
    if (!state || !Sim || !Sim.step) return;
    var a = getAnimState();
    var active = !!(a && a.active) && !!state.puppet;
    if (mirror && mirror.simRef !== state._sim) { mirror = null; if (!active) mirrorHaze(false); }   // a preset was applied behind our back: start over
    if (active && !mirror) startMirror(a);
    else if (!active && mirror) endMirror();
    if (mirror) { try { applyMirror(a, dt); } catch (e) { reportOnce('mirror', e); } }
  }
  /** Contract v3: a held exterior movement (ext.POSES ids) → its Spanish caption, or false. */
  function poseExterior(name) {
    if (!ext || typeof ext.pose !== 'function') return false;
    var cap = false;
    try { cap = ext.pose(name); } catch (e) { reportOnce('exterior.pose', e); return false; }
    optOutToneMapping();                      // poses may add unlit overlay materials
    return cap === false ? false : (typeof cap === 'string' ? cap : '');
  }
  function clearPose() {
    if (!ext || typeof ext.clearPose !== 'function') return false;
    try { ext.clearPose(); } catch (e) { reportOnce('exterior.clearPose', e); return false; }
    return true;
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
    setAirPeek: setAirPeek,
    getAirPeek: getAirPeek,
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
    poseExterior: poseExterior,
    clearPose: clearPose,
    getAnimState: getAnimState,
    getPoses: function () { return ext && Array.isArray(ext.POSES) ? ext.POSES : []; },
    isMirroring: function () { return !!mirror; },
    setLayout: setLayout,
    getLayout: getLayout,
    isInteracting: function () { return isInteracting(); },
    setInteracting: setInteracting,
    operate: operate,
    setInput: setInput,
    hold: holdAndCheck,
    pickMode: pickMode,
    applyPreset: applyPreset,
    setPaused: setPaused,
    isMobile: isMobile,
    getSelected: function () { return selected; },
    isDraggable: function (id) { return !!DRAG_KIND[id]; },
    pickAt: pickAt,
    projectControl: projectControl,
    setInsetVisible: setInsetVisible,
    // an animation / pose has its own caption; otherwise the air peek explains the control the student is moving
    // (better than the exterior's generic "what the surfaces do" line)
    getCaption: function () {
      var busy = !!(ext && (ext.playing || ext.posing));
      if (peek.on && peek.caption && !busy) return peek.caption;
      return (ext && ext.caption) || '';
    },
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
