var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * sim.js: C150.Sim, a simple and stable TEACHING simulation of a Cessna 150M 1976
 * (engine, electrical system, vacuum and gyros, flaps, ground handling and a point-mass flight
 * model with simple attitude dynamics). It is not a certified flight model: numbers come from the
 * POH (research/numbers.md, critique.md) and the constants below are tuned so that the classic
 * POH figures come out (static RPM, Vmax, climb, glide, stall speeds, takeoff roll).
 * Pure JS: no DOM, no THREE. Runs in the browser and in Node (tests/sim.test.js).
 *
 * Interpretation notes (where the contract leaves room):
 *  - air.aoa is the WING angle of attack measured from its zero-lift line (CL = 0.085·aoa + flap ΔCL,
 *    CLmax clean ≈ 1.36 at 16°). The fuselage reference sits 3° below that line (rigging), so
 *    pitch = γ + aoa − 3°: level cruise shows ≈ +1° on the attitude indicator, the ground attitude is
 *    0° and a 10° rotation gives aoa 13°.
 *  - Elevator: full aft yoke always commands aoa ≈ 18.5° (elevator authority beats trim, so a full pull
 *    stalls whatever the trim). At the TAKE OFF trim that is ≈ +11.4° per unit of pull, as specified.
 *  - fuel.leftGal / rightGal = fuel in each standard 13-gal tank, INCLUDING 1.75 gal unusable.
 *  - Weight stays 1600 lb (burning fuel does not change the mass). Bank is limited to ±75°.
 *  - Extra fields beyond the contract: INPUT state.carbIceEnabled (default false, carb ice only forms
 *    when true); OUTPUTS engine.roughness (0..1), air.rollRate (deg/s), air.oatC (°C).
 *    Private integrator state lives in state._sim (do not read it from other modules).
 *  - Several time constants are ACCELERATED for teaching (oil temperature, gyro spin-up/down,
 *    battery drain, heading-indicator drift); each is marked "accelerated" below.
 */
(function (C150) {
  'use strict';

  var Sim = {};

  /* ------------------------------------------------------------------ units */
  var KT = 0.514444;            // m/s per knot
  var FT = 0.3048;              // m per foot
  var G = 9.80665;              // m/s²
  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;
  var FPM = 196.850394;         // ft/min per m/s

  /* --------------------------------------------------------------- airframe */
  var MASS = 725.7;             // kg (1600 lb gross)
  var WEIGHT = MASS * G;        // N
  var S_WING = 14.86;           // m² (160 ft²)
  var RHO0 = 1.225;             // kg/m³ sea level
  var CLA = 0.085;              // lift slope per degree of aoa
  var INCIDENCE = 3;            // deg between the wing zero-lift line and the fuselage reference
  var CD0 = 0.027;              // parasite drag coefficient (clean, fixed gear)
  var K_IND = 0.06;             // induced drag factor (AR ≈ 7)
  var FLAP_MAX = 40;            // deg
  var FLAP_DCL = 0.45;          // extra CL at 40° of flap
  var FLAP_DCD = 0.055;         // extra CD at 40° of flap
  var ALPHA_STALL_CLEAN = 16;   // deg → stall ≈ 47 KIAS clean
  var ALPHA_STALL_F40 = 15;     // deg → stall ≈ 42 KIAS flaps 40
  var STALL_LIFT = 0.72;        // fraction of CLmax left after the stall break
  var STALL_DRAG = 0.08;        // extra CD while stalled
  var HORN_MARGIN = 3.5;        // deg below the stall where the pneumatic horn sounds (5–10 kt early)
  var ALPHA_FULL_AFT = 18.5;    // aoa commanded by the yoke fully aft
  var ALPHA_PUSH = 6;           // aoa removed by the yoke fully forward
  var ALPHA_POWER = 1.5;        // power pitches the nose up: deg per unit of throttle above 0.55
  var BALLOON = 0.025;          // deg of extra aoa command per degree of flap (flap "ballooning")
  var ALPHA_TAU = 0.45;         // s, aoa follows the command
  var ROLL_TAU = 0.25;          // s, roll rate follows the wheel
  var MAX_ROLL_RATE = 50;       // deg/s, full wheel at 80 KIAS
  var MAX_BANK = 75;            // deg
  var PHUGOID_DAMP = 0.03;      // rad per (m/s) of speed change: artificial phugoid damping
  var MU_ROLL = 0.02;           // rolling friction on pavement
  var MU_BRAKE = 0.5;           // braking friction per side at full pedal
  var C_TAXI = 36;            // N/kt: tyre and strut losses at taxi speeds, saturating (see taxiDrag)
  var V_TAXI = 6;               // kt
  var WHEELBASE = 1.5;          // m (nose wheel to main wheels)
  var MAX_LAT_ACCEL = 0.3 * G;  // tyre grip limit when steering on the ground
  var ROTATE_PITCH = 10;        // deg, full rotation attitude

  /* ------------------------------------------------------ propeller / engine */
  var T0 = 1980;                // N: thrust scale at 2550 rpm (tuned: climb ≈ 650 fpm, Vmax ≈ 107 KIAS)
  var C_J = 0.00625;            // thrust loss per knot of TAS per unit of rpm/2550 (advance ratio)
  var A_WINDMILL = 0.22;        // m²: drag area of an idling or windmilling propeller
  var IDLE_RPM = 650;           // throttle closed, on the ground
  var STATIC_RPM = 2500;        // full throttle, no wind (POH 2460–2560)
  var RPM_PER_KT = 2.2;         // the fixed-pitch propeller unloads with airspeed
  var REDLINE_RPM = 2750;
  var CRANK_RPM = 180;          // starter speed
  var CATCH_TIME = 1.1;         // s of good cranking before the engine fires
  var UNUSABLE_GAL = 1.75;      // per standard tank

  /* -------------------------------------------------------------- electrical */
  var BAT_DRAIN = 0.0056;       // % per ampere-second: ≈ 5× faster than a real 25 Ah battery (accelerated)
  var BAT_CHARGE = 0.003125;    // % per ampere-second of charging current above the float current
  var STARTER_AMPS = 120;
  var BUS_POWERED_V = 8;        // below this the bus is considered dead

  var IGNITIONS = { OFF: 1, R: 1, L: 1, BOTH: 1, START: 1 };
  var FLAP_SWITCH = { UP: 1, OFF: 1, DOWN: 1 };
  var MAX_EVENTS = 40;

  /* ------------------------------------------------------- shared constants */
  Sim.AIRPORT = {
    name: 'Aeródromo de práctica', elevationFt: 100,
    runway: { heading: 60, length: 1100, width: 30, center: { x: 0, z: 0 }, numbers: ['06', '24'] },
    // d = (0.8660, 0, -0.5000) ; left normal n = d(330) = (-0.5000, 0, -0.8660)
    threshold06: { x: -476.3, z: 275.0 },            // center - 550·d
    taxiwayOffset: 90,                                // parallel taxiway 90 m to the LEFT (north-west)
    apron: { x: -75.0, z: -129.9, w: 120, h: 70 },    // center + 150·n ; hangar behind it
    spots: {
      parked: { x: -75.0, z: -129.9, heading: 150 },  // on the apron facing the runway
      runup:  { x: -480.3, z: 208.0, heading: 60 },   // holding point near threshold 06
      runway: { x: -450.3, z: 260.0, heading: 60 }    // lined up on runway 06, 30 m past the threshold
    },
    windsock: { x: 40, z: -60 }
  };

  Sim.PRESETS = {
    parked: {
      label: 'Estacionado (frío y apagado)',
      description: 'En la plataforma, motor frío y todo apagado, con la traba de comandos y el freno de estacionamiento puestos. Ideal para recorrer la cabina y practicar la puesta en marcha.'
    },
    runup: {
      label: 'Prueba de motor (run-up)',
      description: 'Motor en marcha a unas 1000 RPM en el punto de espera de la pista 06, con el freno de estacionamiento puesto. Para practicar la prueba de magnetos y de calefacción al carburador.'
    },
    runway: {
      label: 'En la pista, listo para despegar',
      description: 'Alineado en la cabecera 06 con el motor en ralentí y las luces y el transpondedor listos. Acelerador a fondo y a volar.'
    },
    cruise: {
      label: 'Crucero a 3000 pies',
      description: 'Vuelo nivelado y compensado a 3000 ft, rumbo 060, unas 2400 RPM. Si no tocás nada, el avión sigue derecho y a la misma altura.'
    },
    approach: {
      label: 'Aproximación final',
      description: 'En final de la pista 06 a 700 ft sobre el terreno, 65 nudos, flaps 20° y calefacción al carburador puesta, bajando unos 450 ft/min.'
    }
  };

  function freezeDeep(o) {
    for (var k in o) { if (o[k] && typeof o[k] === 'object') freezeDeep(o[k]); }
    return Object.freeze(o);
  }

  var LIMITS_150M = freezeDeep({
    variant: '150M',
    vso: 42, vs1: 47, vfe: 85, vno: 107, vne: 141, va: 97, vx: 56, vy: 68, glide: 60, rotate: 50,
    whiteArc: [42, 85], greenArc: [47, 107], yellowArc: [107, 141], redLine: 141,
    rpmGreen: [2000, 2750], rpmRed: 2750, oilTempGreen: [100, 240], oilTempRed: 240,
    oilPressGreen: [30, 60], oilPressMin: 10, oilPressMax: 100, suctionGreen: [4.6, 5.4],
    gMax: 4.4, gMin: -1.76, gMaxFlaps: 3.5, staticRpm: [2460, 2560],
    runupRpm: 1700, magDropMax: 150, magDiffMax: 75, maxCrosswind: 13
  });
  // A150M Aerobat 1976–77 (critique.md §4A): Vne 164, Vno 123, Va 105, +6/−3 g. Lower arcs as the 150M.
  var LIMITS_A150M = freezeDeep({
    variant: 'A150M',
    vso: 42, vs1: 47, vfe: 85, vno: 123, vne: 164, va: 105, vx: 56, vy: 68, glide: 60, rotate: 50,
    whiteArc: [42, 85], greenArc: [47, 123], yellowArc: [123, 164], redLine: 164,
    rpmGreen: [2000, 2750], rpmRed: 2750, oilTempGreen: [100, 240], oilTempRed: 240,
    oilPressGreen: [30, 60], oilPressMin: 10, oilPressMax: 100, suctionGreen: [4.6, 5.4],
    gMax: 6.0, gMin: -3.0, gMaxFlaps: 3.5, staticRpm: [2460, 2560],
    runupRpm: 1700, magDropMax: 150, magDiffMax: 75, maxCrosswind: 13
  });

  /** Speeds and gauge markings for the current variant (cached frozen object, no allocation). */
  Sim.limits = function (state) {
    return (state && state.variant === 'A150M') ? LIMITS_A150M : LIMITS_150M;
  };

  /* ---------------------------------------------------------------- helpers */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap360(h) { h = h % 360; return h < 0 ? h + 360 : h; }
  function wrap180(h) { h = wrap360(h); return h > 180 ? h - 360 : h; }
  function num(v, d) { return (typeof v === 'number' && v === v) ? v : d; }

  /** Density ratio chosen so that TAS = IAS·(1 + 0.02·altitude/1000). */
  function sigmaAt(altFt) {
    var f = 1 + 0.02 * Math.max(0, altFt) / 1000;
    return 1 / (f * f);
  }

  /** Deterministic pseudo-random 0..1 (engine roughness), no allocation. */
  function rnd(sim) {
    sim.seed = (Math.imul(sim.seed, 1664525) + 1013904223) >>> 0;
    return sim.seed / 4294967296;
  }

  function pushEvent(s, text, kind) {
    if (!Array.isArray(s.events)) s.events = [];
    var ev = s.events;
    if (ev.length >= MAX_EVENTS) ev.shift();
    ev.push({ t: Math.round(s.time * 10) / 10, text: text, kind: kind || 'info' });
  }

  /* ------------------------------------------------------- engine & propeller */

  /** Steady RPM the running engine settles at for the current inputs (spool lag applied in step). */
  function engineTargetRpm(s, ias, altFt) {
    var thr = clamp(num(s.throttle, 0), 0, 1);
    var altK = Math.max(0, altFt) / 1000;
    // Fixed-pitch prop: throttle sets the static RPM, airspeed unloads the prop; thinner air costs power.
    var rpm = IDLE_RPM + (STATIC_RPM - IDLE_RPM) * thr * (1 - 0.012 * altK) + RPM_PER_KT * Math.max(0, ias);
    // Mixture: full rich = baseline; leaning gains RPM up to a peak near 0.75, then the engine starves.
    var m = clamp(num(s.mixture, 1), 0, 1);
    var peak = 20 + 40 * clamp(altK / 5, 0, 1);
    if (m >= 0.75) {
      var u = (m - 0.75) / 0.25;
      rpm += peak * (1 - u * u);
    } else {
      var x = (0.75 - m) / 0.63;
      rpm = (rpm + peak) * (1 - 0.45 * x * x);
    }
    // Carb heat: hot unfiltered air is less dense (≈ −75 RPM at 1700, ≈ −225 at full throttle).
    rpm -= 225 * clamp(num(s.carbHeat, 0), 0, 1) * thr * thr;
    // Carburetor ice blocks the venturi; melting ice goes through the engine as water.
    rpm -= 300 * s.engine.carbIce + 250 * s._sim.meltWater;
    // Running on one magneto: only one plug per cylinder fires (POH max drop 150, max difference 75).
    var magScale = clamp(rpm / 1700, 0.4, 1.5);
    if (s.ignition === 'L') rpm -= 90 * magScale;
    else if (s.ignition === 'R') rpm -= 70 * magScale;
    // Fuel starvation: the carburetor bowl is running dry.
    if (s._sim.starveTimer > 11) rpm *= 0.8;
    return rpm < 300 ? 300 : rpm;
  }

  /** Propeller thrust in newtons (negative = windmilling drag). */
  function thrustN(rpm, tasKt, sigma) {
    var r = rpm / 2550;
    // Thrust falls with density; the sqrt keeps the climb at altitude close to the POH (≈ 440 fpm at 5000 ft).
    var t = T0 * Math.sqrt(sigma) * r * (r - C_J * tasKt);
    return t < -600 ? -600 : t;
  }

  /** Extra drag of a propeller that is idling or windmilling (no power to drive it). */
  function windmillDrag(q, thrEff) {
    return q * A_WINDMILL * clamp(1 - thrEff / 0.3, 0, 1);
  }

  /** Tyre and strut losses that make a ~1000 RPM taxi settle near 8 kt (saturates at speed). */
  function taxiDrag(gsKt) {
    return C_TAXI * gsKt / (1 + gsKt / V_TAXI);
  }

  function oilPressTarget(e, rpm) {
    // Cold oil is thick: ≈ 50–60 psi after a cold start, ≈ 20–25 warm idle, ≈ 40–55 cruise.
    return clamp(15 + 32 * (rpm / 2400) + 25 * clamp((180 - e.oilTempF) / 110, 0, 1), 0, 100);
  }

  function suctionFor(rpm) {
    if (rpm >= 1700) return 5.0;
    if (rpm >= 650) return 3.8 + 1.2 * (rpm - 650) / 1050;
    if (rpm > 200) return 3.8 * (rpm - 200) / 450;
    return 0;
  }

  /* -------------------------------------------------------- pitch command */

  /** Trimmed aoa for a trim position: TAKE OFF mark (0) ≈ 70 KIAS, full range ≈ 110…55 KIAS. */
  function alphaTrim(trim) {
    var v = (trim >= 0 ? 70 - 15 * trim : 70 - 40 * trim) * KT;
    return 2 * WEIGHT / (RHO0 * S_WING * v * v) / CLA;
  }

  function alphaCommand(s, thrEff, flaps) {
    var at = alphaTrim(clamp(num(s.trim, 0), -1, 1));
    var yp = s.controlLock ? 0 : clamp(num(s.yokePitch, 0), -1, 1);
    var a = yp >= 0 ? at + (ALPHA_FULL_AFT - at) * yp : at + ALPHA_PUSH * yp;
    return a + ALPHA_POWER * (thrEff - 0.55) + BALLOON * flaps;
  }

  function alphaStall(flaps) {
    return ALPHA_STALL_CLEAN - (ALPHA_STALL_CLEAN - ALPHA_STALL_F40) * flaps / FLAP_MAX;
  }

  /* ------------------------------------------------------------ electrical */

  function electricLoads(s, sim) {
    var L = s.lights, a = 0;
    if (L) {
      if (L.nav) a += 4;
      if (L.beacon) a += 3;
      if (L.strobe) a += 3;
      if (L.taxi) a += 6;
      if (L.landing) a += 8;
      if (L.dome) a += 1;
    }
    if (s.pitotHeat) a += 9;
    a += clamp(num(s.panelLights, 0), 0, 1);
    if (s.radio) {
      if (s.radio.comOn) a += 2;
      if (s.radio.xpdrMode && s.radio.xpdrMode !== 'OFF') a += 2;
    }
    a += 0.5 + 0.5;                        // turn coordinator + fuel/oil-temperature gauges
    if (sim.flapMoving) a += 10;
    return a;
  }

  /** Bus voltage, ammeter, battery charge. h = 0 only recomputes the outputs. */
  function stepElectrical(s, sim, h) {
    var el = s.elec, e = s.engine;
    if (!s.masterBat) s.masterAlt = false;                 // split-rocker interlock
    var pct = el.batteryPct;
    // Open-circuit voltage: 12.4 V full, ≈ 12.0 V at 20 %, collapsing when nearly flat.
    var vOC = pct >= 15 ? 11.9 + 0.5 * pct / 100 : 11.975 * pct / 15;
    if (!s.masterBat) {
      el.busVolts = 0; el.ammeterAmps = 0; el.highVoltageLight = false;
      s.gyro.tcPowered = false;
      return;
    }
    var loads = electricLoads(s, sim);
    var altCap = s.masterAlt ? 60 * clamp((e.rpm - 650) / 250, 0, 1) : 0;   // gear-driven 60 A alternator
    var deficit = 100 - pct;
    // Charge current the battery accepts: ≈ +15 A right after a start, back to ≈ +2 A within a minute.
    var demand = Math.min(30, 1.5 + 16 * deficit);
    var batAmps, volts;
    if (altCap > 0) {
      var out = Math.min(altCap, loads + demand);
      batAmps = out - loads;
      volts = out >= loads ? 13.2 + 0.9 * clamp((altCap - loads) / 10, 0, 1) : vOC - 0.015 * (loads - out);
    } else {
      batAmps = -loads;
      volts = vOC - 0.015 * loads;
    }
    if (e.cranking) volts -= 1.9;                          // the starter pulls the battery down to ≈ 10.5 V
    if (h > 0) {
      if (batAmps > 1.5) pct += (batAmps - 1.5) * BAT_CHARGE * h;
      else if (batAmps < 0) pct += batAmps * BAT_DRAIN * h;
      if (e.cranking) pct -= STARTER_AMPS * BAT_DRAIN * h;
      pct = clamp(pct, 0, 100);
      el.batteryPct = pct;
      if (pct < 25 && !sim.batLowWarned) {
        sim.batLowWarned = true;
        pushEvent(s, 'Batería baja: el alternador no está cargando. Revisá el master ALT y el amperímetro.', 'warn');
      } else if (pct > 35) sim.batLowWarned = false;
    }
    el.busVolts = Math.max(0, volts);
    el.ammeterAmps = batAmps;
    el.highVoltageLight = !s.masterAlt && el.busVolts > BUS_POWERED_V;   // POH light test: ALT off, BAT on
    s.gyro.tcPowered = el.busVolts > BUS_POWERED_V;
  }

  /* ----------------------------------------------------------------- engine */

  function startEngine(s, sim, inFlight) {
    var e = s.engine;
    e.running = true; e.cranking = false;
    e.primeCharges = 0;
    sim.catchTimer = 0; sim.cutTimer = 0;
    pushEvent(s, inFlight ? '¡El motor volvió a arrancar!'
      : '¡Motor en marcha! Soltá la llave y fijate que suba la presión de aceite.', 'good');
  }

  function stopEngine(s, sim, cause) {
    var e = s.engine;
    e.running = false;
    sim.cutTimer = 0; sim.catchTimer = 0;
    var ground = s.air.onGround;
    if (cause === 'mixture') pushEvent(s, 'Motor detenido: mezcla en corte (IDLE CUT-OFF).', ground ? 'info' : 'warn');
    else if (cause === 'mags') pushEvent(s, 'Motor detenido: llave de magnetos en OFF.', ground ? 'info' : 'warn');
    else if (cause === 'valve') pushEvent(s, 'Motor detenido: sin combustible (válvula de corte en OFF).', 'warn');
    else pushEvent(s, 'Motor detenido: sin combustible (tanques vacíos).', 'warn');
  }

  function startHint(s, fuelInTanks, cold) {
    var e = s.engine;
    if (e.flooded) return 'No arranca: el motor está ahogado. Mezcla en corte y acelerador a fondo mientras das arranque unos segundos.';
    if (!s.fuelValve) return 'No arranca: la válvula de combustible está en OFF.';
    if (!fuelInTanks) return 'No arranca: los tanques están vacíos.';
    if (s.mixture <= 0.6) return 'No arranca: la mezcla está en corte. Empujala a RICA (toda adentro).';
    if (cold && e.primeCharges < 2) return 'No arranca: el motor está frío. Dale 2 o 3 bombeos de cebador.';
    if (s.throttle < 0.03) return 'No arranca: abrí el acelerador apenas (medio centímetro, un cuarto de pulgada).';
    if (s.throttle > 0.35) return 'No arranca: el acelerador está demasiado abierto. Dejalo apenas abierto.';
    return 'No arranca: revisá la secuencia de puesta en marcha.';
  }

  /** Key moved: reset the start attempt when leaving START, give feedback when entering it. */
  function ignitionChanged(s, sim, ign) {
    var e = s.engine;
    if (sim.prevIgnition === 'START') {
      e.startAttemptTime = 0; sim.hintGiven = false; sim.lockWarned = false;
      sim.startRunHeld = 0; sim.startRunWarned = false; sim.clearTimer = 0;
    }
    if (ign === 'START') {
      if (e.running) {
        sim.startRunWarned = true;
        pushEvent(s, '¡El motor ya está en marcha! Soltá la llave', 'warn');
      } else if (!s.masterBat) {
        pushEvent(s, 'El arranque no gira: prendé el master (BAT).', 'warn');
      } else if (s.elec.batteryPct <= 12) {
        pushEvent(s, 'Batería descargada: el arranque no gira.', 'warn');
      }
    }
    sim.prevIgnition = ign;
  }

  function stepEngine(s, sim, h) {
    var e = s.engine, air = s.air;
    var ign = IGNITIONS[s.ignition] ? s.ignition : 'OFF';
    var onGround = air.onGround;
    var ias = air.ias, altFt = air.altitude;
    var fuelInTanks = s.fuel.leftGal > UNUSABLE_GAL + 0.005 || s.fuel.rightGal > UNUSABLE_GAL + 0.005;
    var fuelFlowOK = !!s.fuelValve && fuelInTanks;
    var magsOn = ign !== 'OFF';

    if (ign !== sim.prevIgnition) ignitionChanged(s, sim, ign);

    // Starter
    e.cranking = ign === 'START' && !e.running && !!s.masterBat && s.elec.batteryPct > 12;
    var cold = e.oilTempF < 90;

    if (e.cranking) {
      e.startAttemptTime += h;
      if (s.controlLock && !sim.lockWarned) {
        sim.lockWarned = true;
        pushEvent(s, '¡Ojo! La traba de comandos sigue puesta. Sacala antes de arrancar.', 'warn');
      }
      // Clearing a flooded engine: mixture cut-off, throttle full, crank ≥ 3 s.
      if (e.flooded && s.mixture < 0.12 && s.throttle > 0.9) {
        sim.clearTimer += h;
        if (sim.clearTimer >= 3) {
          e.flooded = false; e.primeCharges = 2;      // the fuel left in the cylinders counts as priming
          sim.clearTimer = 0;
          pushEvent(s, 'Motor despejado. Ahora mezcla rica, acelerador apenas abierto y arrancá sin cebar.', 'info');
        }
      }
      var ok = !e.flooded && fuelFlowOK && sim.starveTimer < 15 && s.mixture > 0.6 &&
        s.throttle >= 0.03 && s.throttle <= 0.35 && (!cold || e.primeCharges >= 2);
      var fastEnough = sim.rpmS > CRANK_RPM * 0.6;           // a weak battery turns the engine too slowly
      if (ok && fastEnough) {
        sim.catchTimer += h;
        if (sim.catchTimer >= CATCH_TIME) startEngine(s, sim, false);
      } else {
        sim.catchTimer = 0;
        if (e.startAttemptTime >= 4 && !sim.hintGiven) {
          sim.hintGiven = true;
          pushEvent(s, ok ? 'El arranque gira lento: la batería está débil.' : startHint(s, fuelInTanks, cold), 'warn');
        }
      }
    } else if (!e.running && !onGround && magsOn && fuelFlowOK && sim.starveTimer < 15 &&
               s.mixture > 0.6 && !e.flooded && sim.rpmS > 300) {
      // In flight a windmilling propeller restarts the engine once fuel and spark are back.
      sim.catchTimer += h;
      if (sim.catchTimer >= 1.0) startEngine(s, sim, true);
    } else if (!e.running) {
      sim.catchTimer = 0;
    }

    // START held while the engine runs
    if (ign === 'START' && e.running) {
      sim.startRunHeld += h;
      if (sim.startRunHeld > 0.8 && !sim.startRunWarned) {
        sim.startRunWarned = true;
        pushEvent(s, '¡El motor ya está en marcha! Soltá la llave', 'warn');
      }
    }

    // Fuel reaching the carburetor (the bowl keeps the engine running ≈ 15 s after the valve closes)
    if (fuelFlowOK) sim.starveTimer = Math.max(0, sim.starveTimer - 3 * h);
    else if (e.running) sim.starveTimer += h;

    // Reasons for a running engine to quit
    if (e.running) {
      var cause = '';
      if (!magsOn) cause = 'mags';
      if (s.mixture < 0.12) {
        sim.cutTimer += h;
        if (sim.cutTimer >= 2 && !cause) cause = 'mixture';
      } else sim.cutTimer = 0;
      if (!cause && sim.starveTimer >= 15) cause = s.fuelValve ? 'empty' : 'valve';
      if (cause) stopEngine(s, sim, cause);
    }

    // Carburetor ice (only when the lesson/mission enables it)
    var heat = clamp(num(s.carbHeat, 0), 0, 1);
    var melt = 0;
    if (e.carbIce > 0) {
      if (heat >= 0.8) melt = Math.min(e.carbIce, h / 8);
      else if (heat >= 0.5 || !e.running) melt = Math.min(e.carbIce, h / 40);
      if (melt > 0) {
        e.carbIce -= melt;
        if (heat >= 0.8 && !sim.meltWarned && e.carbIce > 0.15) {
          sim.meltWarned = true;
          pushEvent(s, 'El calor al carburador está derritiendo el hielo: el motor puede sacudirse unos segundos.', 'info');
        }
      }
    }
    if (s.carbIceEnabled && e.running && heat < 0.5 && s.throttle < 0.85) {
      e.carbIce = Math.min(1, e.carbIce + h / 90);
      if (e.carbIce > 0.35 && !sim.iceWarned) {
        sim.iceWarned = true;
        pushEvent(s, 'Las RPM bajan solas y el motor tiembla: ¿hielo en el carburador? Probá CARB HEAT.', 'warn');
      }
    }
    if (e.carbIce < 0.05) { sim.iceWarned = false; sim.meltWarned = false; }
    sim.meltWater += melt * 1.5 - sim.meltWater * Math.min(1, h / 3);

    // RPM (engine and propeller are one: direct drive)
    var target, tau;
    if (e.running) { target = engineTargetRpm(s, ias, altFt); tau = 0.4; }
    else if (e.cranking) { target = CRANK_RPM * clamp((s.elec.batteryPct - 12) / 20, 0.3, 1); tau = 0.3; }
    else { target = onGround ? 0 : 8 * Math.max(0, ias); tau = 0.7; }   // windmilling in flight
    sim.rpmS += (target - sim.rpmS) * Math.min(1, h / tau);

    var rough = 0;
    if (e.running) {
      rough += clamp((0.55 - s.mixture) / 0.4, 0, 1);
      if (ign === 'L' || ign === 'R') rough += 0.12;
      rough += 0.6 * e.carbIce + 1.5 * sim.meltWater;
      if (!s.primerLocked) rough += 0.1;
      if (sim.starveTimer > 11) rough += 0.5;
      if (!s.primerLocked && !sim.primerWarned) {
        sim.primerWarned = true;
        pushEvent(s, 'El cebador quedó destrabado: empujalo y trabalo (si no, enriquece la mezcla y el motor anda mal).', 'warn');
      }
    }
    if (s.primerLocked) sim.primerWarned = false;
    e.roughness = clamp(rough, 0, 1);
    e.rpm = Math.max(0, sim.rpmS + (e.running ? e.roughness * 35 * (rnd(sim) - 0.5) : 0));
    s.propRpm = e.rpm;
    if (e.rpm > REDLINE_RPM && !sim.revOn) {
      sim.revOn = true;
      pushEvent(s, '¡RPM sobre la línea roja (2750)! Reducí el acelerador.', 'warn');
    } else if (e.rpm < REDLINE_RPM - 50) sim.revOn = false;

    // Oil temperature: time constant ≈ 60 s while running (accelerated: a real engine takes minutes).
    var altK = Math.max(0, altFt) / 1000;
    var ambientF = 68 - 3.6 * altK;
    var tgtT = ambientF, tauT = 150;
    if (e.running) {
      tgtT = ambientF + 30 + 95 * Math.pow(sim.rpmS / 2400, 1.5) - 0.15 * Math.max(0, ias);
      tauT = 60;
    }
    e.oilTempF += (tgtT - e.oilTempF) * h / tauT;

    // Oil pressure (direct line, no electricity)
    var tgtP = 0, tauP = 1.0;
    if (e.running) { tgtP = oilPressTarget(e, sim.rpmS); tauP = 1.5; }
    else if (e.cranking) { tgtP = 4; tauP = 1.5; }
    else if (sim.rpmS > 300) { tgtP = 8 * sim.rpmS / 1000; }
    e.oilPressPsi += (tgtP - e.oilPressPsi) * Math.min(1, h / tauP);

    // Fuel burn ≈ 5.5 gal/h at full power, ≈ 0.9 gal/h at idle; both tanks feed together.
    if (e.running) {
      var r = sim.rpmS / 2550;
      var gph = (0.8 + 4.7 * r * r * r) * (0.85 + 0.15 * clamp(s.mixture, 0, 1));
      var burn = gph / 3600 * h;
      var lAvail = s.fuel.leftGal > UNUSABLE_GAL, rAvail = s.fuel.rightGal > UNUSABLE_GAL;
      if (lAvail && rAvail) { s.fuel.leftGal -= burn / 2; s.fuel.rightGal -= burn / 2; }
      else if (lAvail) s.fuel.leftGal -= burn;
      else if (rAvail) s.fuel.rightGal -= burn;
      if (s.fuel.leftGal < 0) s.fuel.leftGal = 0;
      if (s.fuel.rightGal < 0) s.fuel.rightGal = 0;
    }
  }

  /* -------------------------------------------------------- vacuum & gyros */

  function stepVacuum(s, sim, h) {
    var v = s.vacuum, g = s.gyro;
    v.suctionInHg += (suctionFor(s.engine.rpm) - v.suctionInHg) * Math.min(1, h / 0.5);
    var tgt = Math.min(1, v.suctionInHg / 4.6);
    // Spin-up τ ≈ 12 s and spin-down τ ≈ 40 s (accelerated: real gyros take minutes).
    g.aiSpin += (tgt - g.aiSpin) * Math.min(1, h / (tgt > g.aiSpin ? 12 : 40));
    g.hiSpin += (tgt - g.hiSpin) * Math.min(1, h / (tgt > g.hiSpin ? 12 : 40));
  }

  function updateHeadingIndicator(s, sim, h) {
    var air = s.air, corr = num(s.hiCorrection, 0);
    if (s.gyro.hiSpin >= 0.7) {
      // Gyro drift ≈ 1°/min (accelerated from ≈ 3° per 15 min so the student can see it).
      sim.hiDrift = wrap180(sim.hiDrift + h / 60);
      air.hiHeading = wrap360(air.heading + corr + sim.hiDrift);
    } else {
      // Not spun up: the card stays put and only the knob turns it.
      air.hiHeading = wrap360(air.hiHeading + (corr - sim.prevHiCorr));
      sim.hiDrift = wrap180(air.hiHeading - air.heading - corr);
    }
    sim.prevHiCorr = corr;
  }

  /* ------------------------------------------------------------------ flaps */

  function stepFlaps(s, sim, h) {
    var moving = false;
    if (s.masterBat && s.elec.busVolts > 11) {
      if (s.flapSwitch === 'DOWN' && s.flaps < FLAP_MAX) {
        s.flaps = Math.min(FLAP_MAX, s.flaps + FLAP_MAX / 9 * h);     // ≈ 9 s to full
        moving = true;
      } else if (s.flapSwitch === 'UP' && s.flaps > 0) {
        s.flaps = Math.max(0, s.flaps - FLAP_MAX / 6 * h);            // ≈ 6 s to retract
        moving = true;
      }
    }
    sim.flapMoving = moving;
  }

  /* ----------------------------------------------------------------- flight */

  function stepFlight(s, sim, h) {
    var air = s.air, e = s.engine;
    var field = s.fieldElevation;
    var alt = air.altitude;
    var sig = sigmaAt(alt), sq = Math.sqrt(sig);
    var V = sim.V;
    var tasKt = V / KT, iasKt = tasKt * sq;
    var q = 0.5 * RHO0 * sig * V * V;
    var flaps = s.flaps, fr = flaps / FLAP_MAX;
    var thrEff = e.running ? clamp(num(s.throttle, 0), 0, 1) : 0;
    var T = thrustN(sim.rpmS, tasKt, sig);
    var Dwm = windmillDrag(q, thrEff);
    var yr = s.controlLock ? 0 : clamp(num(s.yokeRoll, 0), -1, 1);
    var rud = clamp(num(s.rudder, 0), -1, 1);
    var spd = clamp(iasKt / 60, 0, 1);                      // rudder/aileron aerodynamic authority
    // Left-turning tendency (P-factor, slipstream): only at high power and low speed (takeoff, climb).
    var pFactor = 0.3 * clamp((thrEff - 0.6) / 0.4, 0, 1) * clamp((85 - iasKt) / 35, 0, 1);
    var rudderNeeded = 0.35 * (sim.p / MAX_ROLL_RATE) + pFactor;
    var aStall = alphaStall(flaps);
    var dCLf = FLAP_DCL * fr;
    var CL, L, D, psiDot, slipT, gLoad;

    if (air.onGround) {
      // Rotation: the nose lifts only with enough elevator authority (> 40 KIAS).
      var yp = s.controlLock ? 0 : clamp(num(s.yokePitch, 0), -1, 1);
      var thT = 0;
      if (yp > 0.3 && iasKt > 40) thT = ROTATE_PITCH * clamp((yp - 0.3) / 0.5, 0, 1) * clamp((iasKt - 40) / 10, 0, 1);
      sim.thetaG += (thT - sim.thetaG) * Math.min(1, h / 0.6);
      sim.alpha = sim.thetaG + INCIDENCE;
      sim.gamma = 0; sim.p = 0; sim.stalled = false;
      CL = CLA * sim.alpha + dCLf;
      L = q * S_WING * CL;
      D = q * S_WING * (CD0 + FLAP_DCD * fr + K_IND * CL * CL) + Dwm;
      var N = Math.max(0, WEIGHT - L);
      var bL = s.parkingBrake ? 1 : clamp(num(s.brakeL, 0), 0, 1);
      var bR = s.parkingBrake ? 1 : clamp(num(s.brakeR, 0), 0, 1);
      var resist = MU_ROLL * N + taxiDrag(tasKt) + MU_BRAKE * N * (bL + bR) / 2;
      var net = T - D;
      if (V < 0.05 && net <= resist) V = 0;
      else {
        V += (net - resist) / MASS * h;
        if (V < 0) V = 0;
      }
      // Steering: 8.5° from the pedals, up to 30° with differential braking.
      var steer = clamp(8.5 * rud + 21.5 * (bR - bL), -30, 30);
      s.noseWheelAngle = steer;
      if (sim.thetaG < 2) {
        var rate = V * Math.tan(steer * DEG) / WHEELBASE;
        var lim = MAX_LAT_ACCEL / Math.max(V, 0.5);
        psiDot = clamp(rate, -lim, lim) * RAD - 2 * pFactor * spd;
      } else {
        psiDot = 4 * (rud - rudderNeeded) * spd;           // nose wheel in the air: rudder only
      }
      slipT = clamp(-V * psiDot * DEG / G * 3, -1, 1);     // the ball swings to the outside of a turn
      air.bank += (0 - air.bank) * Math.min(1, h / 0.3);
      alt = field;
      gLoad = 1;
      // Lift-off
      if (L >= WEIGHT && iasKt > 35) {
        air.onGround = false;
        sim.gamma = 0.01;
        alt = field + 0.6;
        if (sim.cdAir <= 0) pushEvent(s, '¡Despegaste! Mantené entre 60 y 70 nudos para subir.', 'good');
        sim.cdAir = 5;
      }
      air.pitch = sim.thetaG;
    } else {
      // Angle of attack follows the elevator/trim/power command; the stall break forces the nose down.
      var aCmd = alphaCommand(s, thrEff, flaps);
      if (sim.stalled) aCmd = Math.min(aCmd, aStall) - 6;
      sim.alpha = clamp(sim.alpha + (aCmd - sim.alpha) * Math.min(1, h / ALPHA_TAU), -15, 30);
      if (!sim.stalled && sim.alpha > aStall && iasKt > 15) {
        sim.stalled = true; sim.stallTimer = 0;
        if (sim.cdStall <= 0) pushEvent(s, '¡Pérdida! Bajá la nariz y dale potencia', 'warn');
        sim.cdStall = 4;
      } else if (sim.stalled) {
        sim.stallTimer += h;
        if (sim.stallTimer > 1.0 && sim.alpha < aStall - 2) {
          sim.stalled = false;
          if (sim.cdStallRec <= 0) pushEvent(s, 'Saliste de la pérdida. Volvé a vuelo nivelado con suavidad.', 'info');
          sim.cdStallRec = 4;
        }
      }
      CL = sim.stalled ? STALL_LIFT * (CLA * aStall + dCLf) : CLA * sim.alpha + dCLf;
      L = q * S_WING * CL;
      D = q * S_WING * (CD0 + FLAP_DCD * fr + K_IND * CL * CL + (sim.stalled ? STALL_DRAG : 0)) + Dwm;
      var bankR = air.bank * DEG;
      var Vs = Math.max(V, 8);
      var sinG = Math.sin(sim.gamma), cosG = Math.cos(sim.gamma);
      var Vdot = (T - D) / MASS - G * sinG;
      var gdot = (L * Math.cos(bankR) - WEIGHT * cosG) / (MASS * Vs) + (sim.stalled ? 0 : PHUGOID_DAMP * Vdot);
      V = clamp(V + Vdot * h, 0, 120);
      sim.gamma = clamp(sim.gamma + gdot * h, -1.45, 1.45);

      // Roll: neutral spiral stability (bank holds), slow return to level only below 3°.
      var pCmd = MAX_ROLL_RATE * yr * clamp(iasKt / 80, 0, 1.2);
      if (Math.abs(yr) < 0.05 && Math.abs(air.bank) < 3) pCmd -= 0.3 * air.bank;
      pCmd += 1.5 * (rud - rudderNeeded) * spd;              // yaw → roll (dihedral)
      if (sim.stalled) pCmd -= 20 * air.slip;                 // the wing on the slipping side drops
      sim.p += (pCmd - sim.p) * Math.min(1, h / ROLL_TAU);
      var bank = air.bank + sim.p * h;
      if (bank > MAX_BANK) { bank = MAX_BANK; if (sim.p > 0) sim.p = 0; }
      if (bank < -MAX_BANK) { bank = -MAX_BANK; if (sim.p < 0) sim.p = 0; }
      air.bank = bank;

      // Turn from the horizontal lift component, plus yaw from uncoordinated rudder.
      var turn = L * Math.sin(bank * DEG) / (MASS * Vs * Math.max(0.2, Math.cos(sim.gamma)));
      psiDot = turn * RAD + 4 * (rud - rudderNeeded) * spd;
      slipT = clamp(rudderNeeded - rud, -1, 1);
      s.noseWheelAngle = 8.5 * rud;
      gLoad = L / WEIGHT;
      alt += V * Math.sin(sim.gamma) * h / FT;
      air.pitch = sim.gamma * RAD + sim.alpha - INCIDENCE;

      // Touchdown (no crash model: a hard landing is only reported)
      if (alt <= field + 0.5 && sim.gamma <= 0) {
        var vsTd = V * Math.sin(sim.gamma) * FPM;
        var bankAbs = Math.abs(air.bank);
        var pitchTd = air.pitch;
        air.onGround = true;
        alt = field;
        sim.thetaG = clamp(pitchTd, 0, 12);
        V = V * Math.cos(sim.gamma);
        sim.gamma = 0; sim.p = 0; sim.stalled = false;
        if (sim.cdAir <= 0) {
          if (vsTd > -900 && bankAbs < 15) {
            if (pitchTd < -3) pushEvent(s, 'Tocaste la pista con la rueda de nariz primero. La próxima, levantá un poco la nariz antes de tocar.', 'warn');
            else pushEvent(s, '¡Tocaste la pista! Buen aterrizaje.', 'good');
          } else if (bankAbs >= 15) {
            pushEvent(s, 'Aterrizaje duro: tocaste con el avión inclinado ' + Math.round(bankAbs) + '°. Nivelá las alas antes de tocar.', 'warn');
          } else {
            pushEvent(s, 'Aterrizaje duro: tocaste bajando a ' + Math.round(-vsTd) + ' ft/min. La próxima, nivelá (flare) antes de tocar.', 'warn');
          }
        }
        sim.cdAir = 5;
        air.pitch = sim.thetaG;
      }
    }

    // Heading and position (world: north = −Z, east = +X; magnetic variation ignored)
    sim.V = V;
    air.heading = wrap360(air.heading + psiDot * h);
    var vh = V * Math.cos(sim.gamma);
    var hr = air.heading * DEG;
    s.pos.x += vh * Math.sin(hr) * h;
    s.pos.z -= vh * Math.cos(hr) * h;
    air.altitude = alt;
    air.turnRate = psiDot;
    air.slip += (slipT - air.slip) * Math.min(1, h / 0.3);
    air.gLoad = gLoad;
    writeAirOutputs(s, sim);

    // Stall horn (pneumatic: works without electricity), on transitions only
    var horn = !air.onGround && air.ias > 20 && sim.alpha > aStall - HORN_MARGIN;
    if (horn && !air.stallWarning && sim.cdHorn <= 0 && !sim.stalled) {
      pushEvent(s, 'Bocina de pérdida: estás cerca de la pérdida. Bajá un poco la nariz.', 'warn');
      sim.cdHorn = 4;
    }
    air.stallWarning = horn;
    air.stalled = sim.stalled;
  }

  /** Derived air-data outputs from the integrator state (also used by applyPreset). */
  function writeAirOutputs(s, sim) {
    var air = s.air;
    var sig = sigmaAt(air.altitude);
    air.tas = sim.V / KT;
    air.ias = air.tas * Math.sqrt(sig);
    air.vs = air.onGround ? 0 : sim.V * Math.sin(sim.gamma) * FPM;
    air.groundSpeed = sim.V * Math.cos(sim.gamma) / KT;
    air.aoa = sim.alpha;
    air.rollRate = air.onGround ? 0 : sim.p;
    air.indicatedAlt = air.altitude + (num(s.altimeterSetting, 29.92) - 29.92) * 1000;
    air.oatC = 20 - 2 * Math.max(0, air.altitude) / 1000;
    if (!air.onGround) air.pitch = sim.gamma * RAD + sim.alpha - INCIDENCE;
  }

  /* --------------------------------------------------------- warnings/outputs */

  function stepWarnings(s, sim, h) {
    var air = s.air, lim = Sim.limits(s);
    if (sim.cdStall > 0) sim.cdStall -= h;
    if (sim.cdStallRec > 0) sim.cdStallRec -= h;
    if (sim.cdHorn > 0) sim.cdHorn -= h;
    if (sim.cdAir > 0) sim.cdAir -= h;
    if (sim.cdLock > 0) sim.cdLock -= h;
    if (sim.cdG > 0) sim.cdG -= h;

    if (air.ias > lim.vne && !sim.vneOn) {
      sim.vneOn = true;
      pushEvent(s, '¡Superaste la VNE (' + lim.vne + ' nudos)! Reducí potencia y levantá la nariz con suavidad.', 'warn');
    } else if (air.ias < lim.vne - 5) sim.vneOn = false;

    var flapOver = s.flaps > 1 && air.ias > lim.vfe;
    if (flapOver && !sim.flapsOver) {
      sim.flapsOver = true;
      pushEvent(s, '¡Flaps abajo a más de ' + lim.vfe + ' nudos! Reducí la velocidad o subí los flaps.', 'warn');
    } else if (!flapOver && (s.flaps <= 1 || air.ias < lim.vfe - 3)) sim.flapsOver = false;

    var gMax = s.flaps > 1 ? lim.gMaxFlaps : lim.gMax;
    if (!air.onGround && (air.gLoad > gMax || air.gLoad < lim.gMin) && sim.cdG <= 0) {
      sim.cdG = 5;
      pushEvent(s, '¡Demasiada carga (' + air.gLoad.toFixed(1) + ' g)! Aflojá los comandos con suavidad.', 'warn');
    }

    if (s.controlLock && (Math.abs(num(s.yokeRoll, 0)) > 0.2 || Math.abs(num(s.yokePitch, 0)) > 0.2) && sim.cdLock <= 0) {
      sim.cdLock = 6;
      pushEvent(s, 'La traba de comandos está puesta: el volante no se mueve.', 'warn');
    }
  }

  function updateSurfaces(s) {
    var sf = s.surfaces;
    var yr = s.controlLock ? 0 : clamp(num(s.yokeRoll, 0), -1, 1);
    var yp = s.controlLock ? 0 : clamp(num(s.yokePitch, 0), -1, 1);
    var trim = clamp(num(s.trim, 0), -1, 1);
    var elevUp = s.variant === 'A150M' ? 23 : 25;
    sf.aileronL = yr < 0 ? 20 * yr : 14 * yr;               // wheel left: left aileron UP 20°
    sf.aileronR = yr > 0 ? -20 * yr : -14 * yr;             //             right aileron DOWN 14°
    sf.elevator = yp > 0 ? -elevUp * yp : -15 * yp;         // pull: trailing edge UP
    sf.trimTab = trim > 0 ? 20 * trim : 10 * trim;          // nose-up trim: tab DOWN
    sf.rudder = 23 * clamp(num(s.rudder, 0), -1, 1);        // right pedal: trailing edge RIGHT
    sf.flaps = s.flaps;
  }

  /* ------------------------------------------------------------------ step */

  function substep(s, sim, h) {
    if (!s.masterBat) s.masterAlt = false;
    stepEngine(s, sim, h);
    stepElectrical(s, sim, h);
    stepVacuum(s, sim, h);
    stepFlaps(s, sim, h);
    stepFlight(s, sim, h);
    updateHeadingIndicator(s, sim, h);
    stepWarnings(s, sim, h);
    s.time += h;
    // Never let a bad input poison the state.
    if (!(isFinite(sim.V) && isFinite(sim.gamma) && isFinite(sim.alpha) && isFinite(s.air.altitude) &&
          isFinite(s.air.heading) && isFinite(s.air.bank) && isFinite(sim.rpmS))) {
      sim.V = isFinite(sim.V) ? sim.V : 0; sim.gamma = 0; sim.alpha = INCIDENCE; sim.p = 0;
      if (!isFinite(s.air.altitude)) s.air.altitude = s.fieldElevation;
      if (!isFinite(s.air.heading)) s.air.heading = 0;
      if (!isFinite(s.air.bank)) s.air.bank = 0;
      if (!isFinite(sim.rpmS)) sim.rpmS = 0;
    }
  }

  /** Advance the simulation by dt seconds (clamped to 0.1 s, integrated in sub-steps ≤ 0.02 s). */
  Sim.step = function (s, dt) {
    if (!s || s.paused) return;
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    if (!s._sim) s._sim = makeInternal();
    var sim = s._sim;
    var n = Math.ceil(dt / 0.02 - 1e-9);
    var h = dt / n;
    for (var i = 0; i < n; i++) substep(s, sim, h);
    updateSurfaces(s);
  };

  /* --------------------------------------------------------------- actions */

  Sim.actions = {
    /** One stroke of the primer plunger (unlocks it if it was locked). Returns the charges so far. */
    primeStroke: function (s) {
      var e = s.engine;
      if (e.running) {
        pushEvent(s, 'Con el motor en marcha no hace falta cebar.', 'info');
        return e.primeCharges;
      }
      s.primerLocked = false;
      e.primeCharges += 1;
      if (e.primeCharges > 6 && !e.flooded) {
        e.flooded = true;
        pushEvent(s, 'Motor ahogado: demasiado cebador. Para despejarlo: mezcla en corte, acelerador a fondo y arranque unos segundos.', 'warn');
      }
      return e.primeCharges;
    },
    setIgnition: function (s, pos) {
      if (IGNITIONS[pos]) {
        s.ignition = pos;
        if (s._sim && pos !== s._sim.prevIgnition) ignitionChanged(s, s._sim, pos);
      }
      return s.ignition;
    },
    setFlapSwitch: function (s, pos) {
      if (FLAP_SWITCH[pos]) s.flapSwitch = pos;
      return s.flapSwitch;
    },
    /** Split master: ALT on also pushes BAT on; BAT off also takes ALT off. */
    setMaster: function (s, which, on) {
      on = !!on;
      if (which === 'alt') {
        s.masterAlt = on;
        if (on) s.masterBat = true;
      } else if (which === 'bat') {
        s.masterBat = on;
        if (!on) s.masterAlt = false;
      }
      return { bat: s.masterBat, alt: s.masterAlt };
    }
  };

  /* ---------------------------------------------------------------- state */

  function makeInternal() {
    return {
      V: 0, gamma: 0, alpha: INCIDENCE, p: 0, thetaG: 0,
      stalled: false, stallTimer: 0,
      rpmS: 0, catchTimer: 0, cutTimer: 0, starveTimer: 0, clearTimer: 0,
      hintGiven: false, lockWarned: false, startRunHeld: 0, startRunWarned: false, prevIgnition: 'OFF',
      meltWater: 0, meltWarned: false, iceWarned: false, primerWarned: false,
      flapMoving: false, batLowWarned: false,
      hiDrift: 0, prevHiCorr: 0,
      cdStall: 0, cdStallRec: 0, cdHorn: 0, cdAir: 0, cdLock: 0, cdG: 0,
      vneOn: false, flapsOver: false, revOn: false,
      seed: 20260614
    };
  }

  function resetInputs(s) {
    s.yokeRoll = 0; s.yokePitch = 0; s.rudder = 0;
    s.brakeL = 0; s.brakeR = 0; s.parkingBrake = false; s.controlLock = false;
    s.throttle = 0; s.mixture = 1; s.carbHeat = 0;
    s.primerOut = 0; s.primerLocked = true;
    s.ignition = 'OFF'; s.masterBat = false; s.masterAlt = false;
    s.flapSwitch = 'OFF'; s.trim = 0; s.fuelValve = true;
    s.cabinHeat = 0; s.cabinAir = 0;
    var L = s.lights;
    L.dome = false; L.nav = false; L.strobe = false; L.beacon = false; L.taxi = false; L.landing = false;
    s.pitotHeat = false; s.panelLights = 0;
    var r = s.radio;
    r.comOn = false; r.comFreq = 118.10; r.comStby = 121.90; r.navFreq = 113.90; r.navStby = 116.30;
    r.obs = 0; r.xpdrMode = 'OFF'; r.xpdrCode = '7000';
    s.altimeterSetting = 29.92; s.hiCorrection = 0;
    s.doorLeftOpen = false; s.doorRightOpen = false; s.windowLeftOpen = false;
    s.carbIceEnabled = false;          // scenario switch: missions set it AFTER applyPreset
  }

  function resetOutputs(s) {
    var e = s.engine;
    e.running = false; e.cranking = false; e.rpm = 0; e.oilTempF = 68; e.oilPressPsi = 0;
    e.primeCharges = 0; e.flooded = false; e.carbIce = 0; e.startAttemptTime = 0; e.roughness = 0;
    var el = s.elec;
    el.busVolts = 0; el.ammeterAmps = 0; el.batteryPct = 100; el.highVoltageLight = false;
    s.vacuum.suctionInHg = 0;
    s.gyro.aiSpin = 0; s.gyro.hiSpin = 0; s.gyro.tcPowered = false;
    s.fuel.leftGal = 11; s.fuel.rightGal = 11;
    s.flaps = 0;
    var a = s.air;
    a.ias = 0; a.tas = 0; a.altitude = s.fieldElevation; a.indicatedAlt = s.fieldElevation; a.vs = 0;
    a.pitch = 0; a.bank = 0; a.heading = 0; a.hiHeading = 0; a.turnRate = 0; a.slip = 0;
    a.aoa = INCIDENCE; a.gLoad = 1; a.onGround = true; a.stallWarning = false; a.stalled = false;
    a.groundSpeed = 0; a.rollRate = 0; a.oatC = 20;
    s.pos.x = 0; s.pos.z = 0;
    s.propRpm = 0; s.noseWheelAngle = 0;
    if (Array.isArray(s.events)) s.events.length = 0; else s.events = [];
    s.time = 0;
  }

  /* -------------------------------------------------------------- solvers */

  function bisect(f, lo, hi, iters) {
    var flo = f(lo);
    for (var i = 0; i < (iters || 50); i++) {
      var mid = 0.5 * (lo + hi), fm = f(mid);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Throttle that gives `rpm` at this airspeed/altitude with the current mixture, carb heat, mags. */
  function throttleForRpm(s, rpm, ias, alt) {
    s.throttle = 0;
    if (engineTargetRpm(s, ias, alt) >= rpm) return 0;
    s.throttle = 1;
    if (engineTargetRpm(s, ias, alt) <= rpm) return 1;
    var t = bisect(function (x) { s.throttle = x; return engineTargetRpm(s, ias, alt) - rpm; }, 0, 1, 40);
    s.throttle = t;
    return t;
  }

  /** Steady flight (wings level) at iasKt and vsFpm: solves throttle and trim, sets the integrator. */
  function solveSteady(s, iasKt, vsFpm) {
    var sim = s._sim, alt = s.air.altitude;
    var sig = sigmaAt(alt), sq = Math.sqrt(sig);
    var V = iasKt * KT / sq, tasKt = V / KT;
    var gamma = Math.asin(clamp(vsFpm / FPM / V, -0.4, 0.4));
    var q = 0.5 * RHO0 * sig * V * V;
    var fr = s.flaps / FLAP_MAX;
    var CL = WEIGHT * Math.cos(gamma) / (q * S_WING);
    var alpha = (CL - FLAP_DCL * fr) / CLA;
    var Daero = q * S_WING * (CD0 + FLAP_DCD * fr + K_IND * CL * CL);
    var thr = 0.5;
    var rpmMin = Math.max(300, C_J * tasKt / 2 * 2550 + 1);   // thrust grows with rpm above this
    for (var it = 0; it < 8; it++) {
      var Treq = Daero + windmillDrag(q, thr) + WEIGHT * Math.sin(gamma);
      var rpm = thrustN(rpmMin, tasKt, sig) >= Treq ? rpmMin
        : bisect(function (r) { return thrustN(r, tasKt, sig) - Treq; }, rpmMin, 3400, 50);
      thr = throttleForRpm(s, rpm, iasKt, alt);
    }
    s.throttle = thr;
    s.trim = bisect(function (t) { s.trim = t; return alphaCommand(s, thr, s.flaps) - alpha; }, -1, 1, 50);
    sim.V = V; sim.gamma = gamma; sim.alpha = alpha; sim.p = 0; sim.thetaG = 0;
    sim.rpmS = engineTargetRpm(s, iasKt, alt);
    s.air.onGround = false;
    s.air.vs = vsFpm;
  }

  /** IAS where the given RPM holds level flight (clean) at the current altitude. */
  function levelSpeedForRpm(s, rpm) {
    var sig = sigmaAt(s.air.altitude), sq = Math.sqrt(sig);
    return bisect(function (ias) {
      var V = ias * KT / sq, q = 0.5 * RHO0 * sig * V * V;
      var CL = WEIGHT / (q * S_WING);
      return thrustN(rpm, V / KT, sig) - q * S_WING * (CD0 + K_IND * CL * CL);
    }, 62, 135, 50);
  }

  /* --------------------------------------------------------------- presets */

  function placeAt(s, spot) {
    s.pos.x = spot.x; s.pos.z = spot.z;
    s.air.heading = spot.heading; s.air.hiHeading = spot.heading;
  }

  function engineRunningSetup(s, oilF) {
    var e = s.engine;
    e.running = true; e.cranking = false; e.oilTempF = oilF;
    s.ignition = 'BOTH'; s.masterBat = true; s.masterAlt = true; s.mixture = 1; s.primerLocked = true;
    s.controlLock = false;
    s.lights.beacon = true; s.lights.nav = true; s.radio.comOn = true;
    s.gyro.aiSpin = 1; s.gyro.hiSpin = 1;
    s._sim.prevIgnition = 'BOTH';
  }

  /** Make gauges consistent with the engine state just set (rpm, oil pressure, suction, electrics). */
  function settleEngine(s) {
    var e = s.engine, sim = s._sim;
    if (e.running) {
      if (!sim.rpmS) sim.rpmS = engineTargetRpm(s, s.air.ias, s.air.altitude);
      e.rpm = sim.rpmS;
      e.oilPressPsi = oilPressTarget(e, e.rpm);
    }
    s.propRpm = e.rpm;
    s.vacuum.suctionInHg = suctionFor(e.rpm);
    stepElectrical(s, sim, 0);
  }

  /** Reset `s` in place to a preset (same object and sub-object references). */
  Sim.applyPreset = function (s, name) {
    if (!Sim.PRESETS[name]) name = 'parked';
    if (s.variant !== 'A150M') s.variant = '150M';
    s.fieldElevation = Sim.AIRPORT.elevationFt;
    s._sim = makeInternal();
    var sim = s._sim;
    resetInputs(s);
    resetOutputs(s);
    var A = Sim.AIRPORT, e = s.engine, air = s.air;

    if (name === 'parked') {
      placeAt(s, A.spots.parked);
      s.controlLock = true; s.parkingBrake = true;
      s.mixture = 0; s.throttle = 0; s.ignition = 'OFF';
    } else if (name === 'runup') {
      placeAt(s, A.spots.runup);
      engineRunningSetup(s, 150);
      s.parkingBrake = true; s.radio.xpdrMode = 'SBY';
      throttleForRpm(s, 1000, 0, s.fieldElevation);
    } else if (name === 'runway') {
      placeAt(s, A.spots.runway);
      engineRunningSetup(s, 165);
      s.throttle = 0;
      s.lights.landing = true; s.lights.strobe = true;
      s.radio.xpdrMode = 'ALT';
    } else if (name === 'cruise') {
      // ≈ 8 km north-east of the field on heading 060
      var hc = 60 * DEG;
      s.pos.x = 8000 * Math.sin(hc); s.pos.z = -8000 * Math.cos(hc);
      air.heading = 60; air.hiHeading = 60;
      air.altitude = 3000;
      engineRunningSetup(s, 175);
      s.lights.strobe = true; s.radio.xpdrMode = 'ALT';
      s.throttle = 0.85;
      solveSteady(s, levelSpeedForRpm(s, 2400), 0);
    } else if (name === 'approach') {
      // Extended centreline of runway 06, 3.7 km before the threshold, 700 ft AGL.
      var ha = 60 * DEG;
      s.pos.x = A.threshold06.x - 3700 * Math.sin(ha);
      s.pos.z = A.threshold06.z + 3700 * Math.cos(ha);
      air.heading = 60; air.hiHeading = 60;
      air.altitude = s.fieldElevation + 700;
      engineRunningSetup(s, 170);
      s.flaps = 20; s.carbHeat = 1;
      s.lights.landing = true; s.lights.strobe = true; s.radio.xpdrMode = 'ALT';
      solveSteady(s, 65, -450);
    }
    if (air.onGround) { sim.alpha = INCIDENCE; air.altitude = s.fieldElevation; }
    sim.prevHiCorr = s.hiCorrection;
    settleEngine(s);
    writeAirOutputs(s, sim);
    if (!air.onGround) air.vs = sim.V * Math.sin(sim.gamma) * FPM;
    air.hiHeading = air.heading;
    updateSurfaces(s);
    return s;
  };

  /** New state object for a preset ('parked' | 'runup' | 'runway' | 'cruise' | 'approach'). */
  Sim.createState = function (preset) {
    var s = {
      variant: '150M',
      yokeRoll: 0, yokePitch: 0, rudder: 0, brakeL: 0, brakeR: 0, parkingBrake: false, controlLock: false,
      throttle: 0, mixture: 1, carbHeat: 0, primerOut: 0, primerLocked: true, ignition: 'OFF',
      masterBat: false, masterAlt: false, flapSwitch: 'OFF', trim: 0, fuelValve: true,
      cabinHeat: 0, cabinAir: 0,
      lights: { dome: false, nav: false, strobe: false, beacon: false, taxi: false, landing: false },
      pitotHeat: false, panelLights: 0,
      radio: { comOn: false, comFreq: 118.10, comStby: 121.90, navFreq: 113.90, navStby: 116.30,
               obs: 0, xpdrMode: 'OFF', xpdrCode: '7000' },
      altimeterSetting: 29.92, hiCorrection: 0,
      doorLeftOpen: false, doorRightOpen: false, windowLeftOpen: false,
      paused: false, carbIceEnabled: false,
      engine: { running: false, cranking: false, rpm: 0, oilTempF: 68, oilPressPsi: 0, primeCharges: 0,
                flooded: false, carbIce: 0, startAttemptTime: 0, roughness: 0 },
      elec: { busVolts: 0, ammeterAmps: 0, batteryPct: 100, highVoltageLight: false },
      vacuum: { suctionInHg: 0 },
      gyro: { aiSpin: 0, hiSpin: 0, tcPowered: false },
      fuel: { leftGal: 11, rightGal: 11 },
      flaps: 0,
      air: { ias: 0, tas: 0, altitude: 100, indicatedAlt: 100, vs: 0, pitch: 0, bank: 0, heading: 0,
             hiHeading: 0, turnRate: 0, slip: 0, aoa: INCIDENCE, gLoad: 1, onGround: true,
             stallWarning: false, stalled: false, groundSpeed: 0, rollRate: 0, oatC: 20 },
      pos: { x: 0, z: 0 },
      surfaces: { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, trimTab: 0, flaps: 0 },
      propRpm: 0, noseWheelAngle: 0,
      events: [],
      time: 0, fieldElevation: 100,
      _sim: null
    };
    Sim.applyPreset(s, preset || 'parked');
    return s;
  };

  // Internal helpers exposed for tests and tuning only (not part of the public contract).
  Sim._internal = {
    engineTargetRpm: engineTargetRpm, thrustN: thrustN, sigmaAt: sigmaAt, alphaTrim: alphaTrim,
    alphaStall: alphaStall, constants: { MASS: MASS, S_WING: S_WING, CLA: CLA, INCIDENCE: INCIDENCE,
      CD0: CD0, K_IND: K_IND, T0: T0, C_J: C_J }
  };

  C150.Sim = Sim;
  if (typeof module !== 'undefined' && module.exports) module.exports = C150.Sim;
})(root.C150);
