var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * data/situations.js — "Situaciones prácticas" (pestaña VOLAR → Situaciones, contrato v3).
 * Cosas que pueden pasar en un vuelo de instrucción y QUÉ HACÉS: el alumno las vive en el simulador y actúa con los
 * mandos (pad, teclado o la cabina 3D); src/situations.js las corre y las corrige solas.
 * Fuente de los procedimientos: POH Cessna 150M (research/numbers.md §4–5, critique.md). Sin DOM: corre en Node.
 *
 *   C150.DATA.situations = [ {
 *     id, titulo, tipo ('emergencia' | 'anormal' | 'en tierra'), contexto (dónde estás y qué venías haciendo),
 *     preset (C150.Sim preset), setup(state) → pone fallas (C150.Sim.actions.fail) y posiciones,
 *     durante(state, ctx) (opcional) → perturbaciones del escenario (ráfaga…), la llama el runner antes de check,
 *     'señales': [...] (lo que notás: ruido, instrumento, sensación), objetivo, pistas: [...] (se muestran de a una),
 *     mandos: [ids de fichas] (mandos extra para tener a mano además del pad de vuelo),
 *     check(state, ctx) → { progress 0..1, ok, fail, mensaje } (ctx = { t, dt, hold, data:{} } nuevo en cada intento),
 *     debrief (qué hace un piloto, corto, según el POH), errores: [...] } ]
 *   check NO escribe el estado (sólo lee y guarda memoria en ctx.data). setup y durante sí pueden escribirlo.
 *   Las fallas se limpian al salir de la situación (el runner llama Sim.actions.fail(state, nombre, false)).
 *   C150.DATA.situationFailures = nombres de falla que el runner limpia.
 */
(function (C150) {
  'use strict';

  C150.DATA = C150.DATA || {};

  var FALLAS = ['engine', 'engineRough', 'alternator', 'vacuum', 'oilPress', 'magLeft', 'magRight', 'door', 'pitotBlocked', 'carbIce'];

  /** Pone (o saca) una falla: Sim.actions.fail cuando existe; si no, el campo de entrada directo (plan B). */
  function falla(s, nombre, on) {
    on = on !== false;
    var A = C150.Sim && C150.Sim.actions;
    if (A && typeof A.fail === 'function') { A.fail(s, nombre, on); return; }
    if (!s.failures || typeof s.failures !== 'object') s.failures = {};
    s.failures[nombre] = on;
    if (nombre === 'door') s.doorRightOpen = on;
    if (nombre === 'carbIce') s.carbIceEnabled = on;
  }

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function lim01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function entre(v, a, b) { return typeof v === 'number' && v >= a && v <= b; }
  function ias(s) { return num(s.air && s.air.ias, 0); }
  function alt(s) { return num(s.air && s.air.indicatedAlt, num(s.air && s.air.altitude, 0)); }
  function agl(s) { return num(s.air && s.air.altitude, 0) - num(s.fieldElevation, 100); }
  function banco(s) { return Math.abs(num(s.air && s.air.bank, 0)); }
  function enPerdida(s) { return !!(s.air && s.air.stalled); }
  function dt(ctx) { return num(ctx && ctx.dt, 0); }
  /** Memoria de cada intento: valores al empezar. */
  function inicio(s, ctx) {
    var d = ctx.data;
    if (!d.init) { d.init = true; d.alt0 = alt(s); d.rpm0 = num(s.engine && s.engine.rpm, 0); }
    return d;
  }
  function res(progress, mensaje, extra) {
    var r = { progress: lim01(progress), ok: false, fail: false, mensaje: mensaje || '' };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
    return r;
  }
  function falla_(mensaje) { return { progress: 0, ok: false, fail: true, mensaje: mensaje }; }
  function listo(mensaje) { return { progress: 1, ok: true, fail: false, mensaje: mensaje }; }

  C150.DATA.situationFailures = FALLAS.slice();

  C150.DATA.situations = [

    // ─────────────────────────────────────────── 1. hielo en el carburador
    {
      id: 'hielo-carburador',
      titulo: 'Hielo en el carburador en crucero',
      tipo: 'anormal',
      contexto: 'Vas en crucero a 3000 pies, un día húmedo y fresco de otoño en Uruguay. Todo tranquilo… hasta que el motor empieza a cambiar.',
      preset: 'cruise',
      setup: function (s) { falla(s, 'carbIce', true); },
      'señales': [
        'Las RPM bajan solas, de a poco, sin que toques el acelerador.',
        'Después el motor empieza a andar áspero: tiembla.',
        'Para mantener la altura tenés que tirar un poco más: el avión pierde velocidad o altura.'
      ],
      objetivo: 'Sacá la calefacción del carburador a fondo y dejala hasta que el motor ande liso. Después volvela a FRÍO.',
      pistas: [
        'Mirá el tacómetro: si las RPM bajan solas con humedad alta, pensá primero en hielo.',
        'La perilla CARB HEAT está abajo, al lado del acelerador. Tirala hacia vos hasta el fondo (en el pad: botón “Calef. carb.”).',
        'Al principio el motor tose un poco más: es el hielo derritiéndose y pasando por el motor. No la saques: aguantá.',
        'Cuando las RPM suben y el motor anda liso, empujá la calefacción adentro (FRÍO) y ajustá el acelerador.'
      ],
      mandos: ['carb-heat', 'throttle'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        var e = s.engine || {};
        if (!e.running) return falla_('El motor se paró. Con hielo, si esperás demasiado se puede ahogar: la calefacción va apenas notás la caída de RPM.');
        if (enPerdida(s)) return falla_('Entraste en pérdida por tirar para no perder altura. Primero el avión: bajá un poco la nariz.');
        if (alt(s) < d.alt0 - 1000) return falla_('Perdiste más de 1000 pies. Con el motor débil, mantené la velocidad y usá la calefacción enseguida.');
        var heat = num(s.carbHeat, 0), ice = num(e.carbIce, -1);
        if (num(e.rpm, 0) < d.rpm0 - 80 || ice > 0.25) d.sintomas = true;
        if (heat >= 0.9) d.heatT = num(d.heatT, 0) + dt(ctx);
        var derretido = num(d.heatT, 0) >= (ice >= 0 ? 6 : 15) && (ice < 0 || ice < 0.05);
        if (derretido) d.derretido = true;
        if (d.derretido) {
          if (heat <= 0.1) return listo('¡Bien! Motor liso, calefacción en frío. Así se resuelve el hielo en el carburador.');
          return res(0.85, 'El hielo se fue: las RPM subieron. Ahora volvé la calefacción a FRÍO (adentro) y ajustá el acelerador.');
        }
        if (heat >= 0.9) return res(0.35 + 0.45 * lim01(num(d.heatT, 0) / 10), 'Bien: calefacción a fondo. El motor puede toser unos segundos mientras se derrite el hielo. Aguantá…');
        if (heat > 0.1) return res(0.25, 'A medias no sirve: sacá la calefacción del carburador hasta el fondo.');
        if (d.sintomas) return res(0.15, 'Las RPM bajaron solas y el motor tiembla. ¿Qué puede ser con este tiempo húmedo?');
        return res(0.05, 'Volá tranquilo y prestá atención al motor: escuchalo y mirá el tacómetro.');
      },
      debrief: 'Con humedad alta el carburador se enfría y se forma hielo aunque haga 15–20 °C. El POH dice: calefacción del carburador a fondo (y acelerador a fondo) hasta que el motor ande liso; después sacá la calefacción y reajustá. Es normal que tosa un poco al derretirse. Con potencia baja (descensos, aproximación) el riesgo es mayor: por eso se usa la calefacción antes de reducir.',
      errores: [
        'Sacar la calefacción a medias: no alcanza para derretir el hielo.',
        'Asustarse cuando tose y volver a FRÍO antes de tiempo.',
        'Tocar la mezcla o el acelerador primero y perder tiempo: con humedad, pensá hielo.'
      ]
    },

    // ─────────────────────────────────────────── 2. bocina de pérdida en la aproximación
    {
      id: 'bocina-aproximacion',
      titulo: 'Suena la bocina de pérdida en la aproximación',
      tipo: 'emergencia',
      contexto: 'Final a la pista, 700 pies sobre el campo, flaps 20°. Te distrajiste mirando la pista, fuiste tirando del volante y redujiste de más. De golpe: ¡la bocina!',
      preset: 'approach',
      setup: function (s) {
        s.trim = 0.6;            // compensado muy nariz arriba
        s.throttle = 0.05;       // casi ralentí
        s.yokePitch = 0.45;      // venías tirando sin darte cuenta
      },
      'señales': [
        'Un pitido agudo y continuo: la bocina de pérdida (es neumática, suena aunque no haya electricidad).',
        'El velocímetro baja de 55 nudos y el avión se siente blando en los comandos.',
        'La nariz está alta para lo lento que vas.'
      ],
      objetivo: 'Bajá un poco la nariz, meté toda la potencia y calefacción en FRÍO hasta que se calle la bocina y tengas 55 nudos o más, subiendo.',
      pistas: [
        'Primero la nariz: soltá o empujá un poco el volante. Lo que causa la pérdida es el ángulo, no la velocidad.',
        'Acelerador adentro, a fondo, y calefacción del carburador en frío.',
        'Alas niveladas con el volante y la bolita al medio con los pies: nada de virajes cerca de la pérdida.',
        'Si el compensador quedó muy nariz arriba, bajalo un poco (T).'
      ],
      mandos: ['throttle', 'carb-heat', 'trim-wheel'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        var a = s.air || {};
        if (a.onGround) return falla_('Tocaste el suelo antes de recuperarte. Cerca del suelo, la recuperación tiene que ser inmediata: nariz un poco abajo y potencia.');
        if (enPerdida(s)) return falla_('Entraste en pérdida: seguiste tirando con la bocina sonando. Con la bocina, primero bajá un poco la nariz.');
        if (agl(s) < 150) return falla_('Quedaste a menos de 150 pies del suelo. En la aproximación, la bocina se atiende al instante.');
        if (a.stallWarning) d.bocina = true;
        var potencia = num(s.throttle, 0) >= 0.9, frio = num(s.carbHeat, 0) <= 0.2;
        var bien = !a.stallWarning && ias(s) >= 54 && potencia && frio && banco(s) < 15;
        d.okT = bien ? num(d.okT, 0) + dt(ctx) : 0;
        if (d.okT >= 4) return listo('¡Recuperado! Sin bocina, potencia máxima y velocidad segura. Ahora podés hacer motor y al aire o seguir una aproximación estabilizada.');
        var hechos = (potencia ? 1 : 0) + (frio ? 1 : 0) + (!a.stallWarning ? 1 : 0) + (ias(s) >= 54 ? 1 : 0);
        var p = 0.1 + 0.15 * hechos + 0.3 * lim01(num(d.okT, 0) / 4);
        if (a.stallWarning) return res(p, '¡Bocina! Bajá un poco la nariz y meté potencia.');
        if (!potencia) return res(p, 'Acelerador a fondo: necesitás toda la potencia.');
        if (!frio) return res(p, 'Calefacción del carburador en FRÍO: con calor el motor da menos potencia.');
        if (ias(s) < 54) return res(p, 'Todavía vas lento: no subas la nariz hasta tener 55 nudos.');
        if (banco(s) >= 15) return res(p, 'Nivelá las alas: cerca de la pérdida no se vira.');
        return res(p, 'Muy bien: mantené así unos segundos…');
      },
      debrief: 'La pérdida es por ángulo de ataque: con la bocina, primero bajás un poco la nariz (menos ángulo), después potencia máxima con calefacción en frío y alas niveladas con el pie coordinado. En la aproximación, a 55–65 nudos, nunca dejes que la velocidad se caiga por debajo de 55 con flaps. Si no queda estable, motor y al aire.',
      errores: [
        'Tirar más del volante para “no bajar”: eso empeora la pérdida.',
        'Meter potencia sin bajar la nariz.',
        'Virar con el volante cerca de la pérdida (un ala puede caer).'
      ]
    },

    // ─────────────────────────────────────────── 3. falla de motor en crucero
    {
      id: 'falla-motor-crucero',
      titulo: 'Se para el motor en crucero',
      tipo: 'emergencia',
      contexto: 'Crucero a 3000 pies sobre el campo uruguayo: chacras, praderas y algún monte. De repente, silencio. La hélice gira sola, por el viento.',
      preset: 'cruise',
      setup: function (s) { falla(s, 'engine', true); },
      'señales': [
        'Silencio: el ruido del motor desaparece de golpe.',
        'El tacómetro cae a unas 500 RPM: la hélice gira sólo por el viento.',
        'Si mantenés la nariz, la velocidad se cae. El variómetro marca descenso.'
      ],
      objetivo: 'Planeá a 60 nudos (mejor planeo), elegí un campo, probá rearrancar (calefacción, mezcla rica, combustible ON, magnetos BOTH, cebador trabado) y, si no arranca, prepará el aterrizaje forzoso.',
      pistas: [
        'Lo primero: volá el avión. Bajá la nariz hasta 60 nudos y compensá (trim) para que se quede ahí solo.',
        'Elegí un campo largo, sin cables, cerca y con el viento de frente. No cambies de idea.',
        'Rearranque: calefacción del carburador a fondo, mezcla rica, combustible ON, magnetos en BOTH, cebador adentro y trabado.',
        'Si no arranca: mezcla cortada (afuera), combustible OFF y magnetos OFF. El master, después de bajar los flaps.'
      ],
      mandos: ['carb-heat', 'mixture', 'fuel-shutoff', 'ignition', 'primer', 'trim-wheel'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        if (enPerdida(s)) return falla_('Entraste en pérdida: sin motor, la velocidad se mantiene con la nariz abajo. 60 nudos siempre.');
        if (ias(s) > 100) return falla_('Bajaste demasiado la nariz: a más de 100 nudos gastás la altura en un ratito.');
        if (agl(s) < 600 && !d.fase2ok) return falla_('Te quedaste muy bajo antes de terminar. En la vida real, a esta altura ya tenés que estar aterrizando en el campo que elegiste.');
        var v = ias(s), planeo = entre(v, 55, 66);
        if (planeo) d.planeoT = num(d.planeoT, 0) + dt(ctx);
        var e = s.engine || {};
        if (e.running && !d.fase2) return listo('¡Arrancó! Con el motor andando, volvé a cruzar los datos y aterrizá en el aeródromo más cercano.');
        var re = {
          planeo: num(d.planeoT, 0) >= 8,
          calef: num(s.carbHeat, 0) >= 0.9,
          mezcla: num(s.mixture, 0) >= 0.9,
          comb: s.fuelValve === true,
          mags: s.ignition === 'BOTH' || s.ignition === 'START',
          cebador: s.primerLocked === true
        };
        if (!d.fase2) {
          var n = 0, k;
          for (k in re) if (re[k]) n++;
          if (n === 6) { d.fase2 = true; d.fase2T = ctx.t; }
          else {
            var falta = !re.planeo ? (planeo ? 'Bien, 60 nudos: mantenelos…' : (v > 66 ? 'Vas rápido: subí un poco la nariz hasta 60 nudos.' : 'Vas lento: bajá la nariz hasta 60 nudos.'))
              : !re.calef ? 'Rearranque: calefacción del carburador a fondo.'
              : !re.mezcla ? 'Mezcla rica (adentro, a fondo).'
              : !re.comb ? 'Combustible: la válvula en ON.'
              : !re.mags ? 'Magnetos en BOTH.'
              : 'Cebador adentro y trabado.';
            return res(0.05 + 0.5 * n / 6, falta);
          }
        }
        // fase 2: no arranca → aterrizaje forzoso
        var cortes = { mezcla: num(s.mixture, 1) <= 0.05, comb: s.fuelValve === false, mags: s.ignition === 'OFF' };
        var velOk = entre(v, 55, 72);
        var m = (cortes.mezcla ? 1 : 0) + (cortes.comb ? 1 : 0) + (cortes.mags ? 1 : 0);
        if (m === 3 && velOk) { d.fase2ok = true; return listo('Muy bien: planeo controlado y el motor asegurado para el aterrizaje forzoso. Ahora: flaps cuando tengas el campo asegurado, master OFF, puertas destrabadas y aterrizar con la cola un poco baja.'); }
        var msg = !velOk ? 'Mantené 60–65 nudos: la velocidad es tu vida.'
          : !cortes.mezcla ? 'No arranca: preparate para aterrizar. Mezcla cortada (afuera del todo).'
          : !cortes.comb ? 'Combustible OFF.'
          : 'Magnetos OFF.';
        return res(0.6 + 0.12 * m, msg);
      },
      debrief: 'Sin motor, lo primero es VOLAR: 60 nudos de planeo (POH) y compensado. Después elegís un campo y recién ahí probás rearrancar: calefacción del carburador, cebador trabado, combustible ON, mezcla rica, magnetos BOTH. Si no arranca: mezcla cortada, combustible OFF, magnetos OFF, flaps según necesites (40° recomendado al final), master OFF, puertas destrabadas antes de tocar, aterrizá con la cola un poco baja y frená fuerte. Desde 3000 pies tenés unos pocos minutos de planeo: alcanzan si no los desperdiciás.',
      errores: [
        'Querer “estirar” el planeo tirando del volante: perdés velocidad y caés más rápido (o entrás en pérdida).',
        'Cambiar de campo a último momento.',
        'Quedarse intentando arrancar y olvidarse de volar el avión.'
      ]
    },

    // ─────────────────────────────────────────── 4. falla del alternador
    {
      id: 'falla-alternador',
      titulo: 'Falla del alternador',
      tipo: 'anormal',
      contexto: 'Crucero a 3000 pies, con la luz de aterrizaje y la de carreteo prendidas para que te vean, y el calefactor del pitot encendido. El amperímetro hace algo raro.',
      preset: 'cruise',
      setup: function (s) {
        falla(s, 'alternator', true);
        s.lights.landing = true; s.lights.taxi = true; s.pitotHeat = true;
      },
      'señales': [
        'La aguja del amperímetro se va a la izquierda (descarga): la batería está dando la electricidad.',
        'Si no hacés nada, en un rato baja el voltaje: radio, luces y flaps (eléctricos) dejan de andar.',
        'El motor sigue andando normal: los magnetos no usan la batería.'
      ],
      objetivo: 'Confirmá la descarga, apagá la mitad ALT del master y lo que no hace falta (luz de aterrizaje, de carreteo y calefactor del pitot), sin dejar de volar nivelado.',
      pistas: [
        'Mirá el amperímetro: a la izquierda del cero es descarga.',
        'El master es rojo y tiene dos mitades: apagá sólo ALT (la batería queda prendida para la radio).',
        'Apagá las luces de aterrizaje y de carreteo y el calefactor del pitot: gastan mucho.',
        'Planeá aterrizar apenas puedas: la batería dura poco. Los flaps son eléctricos.'
      ],
      mandos: ['master', 'light-switches', 'ammeter'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        if (enPerdida(s)) return falla_('Entraste en pérdida mirando los interruptores. Primero el avión: mirá afuera entre cada cosa que hacés.');
        if (Math.abs(alt(s) - d.alt0) > 600) return falla_('Te fuiste más de 600 pies de la altura. Hacé las cosas de a una y volvé a mirar afuera.');
        var altOff = !s.masterAlt, batOn = !!s.masterBat;
        var cargas = (!s.lights.landing ? 1 : 0) + (!s.lights.taxi ? 1 : 0) + (!s.pitotHeat ? 1 : 0);
        var todo = altOff && batOn && cargas === 3;
        d.okT = todo ? num(d.okT, 0) + dt(ctx) : 0;
        if (d.okT >= 2) return listo('Bien: ALT apagado, sin consumos grandes y volando. Ahora, aterrizá en el aeródromo más cercano y avisá por radio mientras tengas batería.');
        if (!batOn) return res(0.2, 'Apagaste la batería también: te quedás sin radio ni flaps. Prendé BAT y dejá apagado sólo ALT.');
        var p = 0.1 + (altOff ? 0.4 : 0) + 0.15 * cargas;
        if (!altOff) return res(p, 'El amperímetro marca descarga. Apagá la mitad ALT del master.');
        return res(p, 'Ahora apagá lo que más gasta: ' + [!s.lights.landing ? 'luz de aterrizaje' : '', s.lights.taxi ? 'luz de carreteo' : '', s.pitotHeat ? 'calefactor del pitot' : ''].filter(Boolean).join(', ') + '.');
      },
      debrief: 'El amperímetro en descarga quiere decir que el alternador no carga y la batería se está gastando. POH: ALT del master en OFF, apagá todo lo que no sea esencial y aterrizá apenas sea práctico. El motor sigue andando (magnetos propios) y los instrumentos de presión y los giróscopos de vacío siguen bien; perdés radio, transpondedor, luces, flaps, indicadores de combustible y el coordinador de giro cuando la batería se agota.',
      errores: [
        'Apagar el master completo (BAT también) y quedarse sin radio de entrada.',
        'Seguir el vuelo como si nada: la batería dura poco.',
        'Mirar sólo los interruptores y dejar de volar el avión.'
      ]
    },

    // ─────────────────────────────────────────── 5. puerta abierta en vuelo
    {
      id: 'puerta-abierta',
      titulo: 'Se abre la puerta en vuelo',
      tipo: 'anormal',
      contexto: 'Recién nivelaste a 3000 pies. ¡PUM! La puerta del acompañante se entreabre: mucho ruido y viento. Asusta, pero no es una emergencia.',
      preset: 'cruise',
      setup: function (s) { falla(s, 'door', true); },
      'señales': [
        'Un golpe y mucho ruido de viento.',
        'La puerta derecha queda entreabierta: el aire no la deja abrirse más.',
        'Un poco más de resistencia: el avión pierde algo de velocidad.'
      ],
      objetivo: 'Primero volá el avión: alas niveladas y altura. Bajá a unos 65 nudos (compensá) y recién ahí cerrá la puerta firme.',
      pistas: [
        'No es una emergencia: el avión vuela perfecto con la puerta entreabierta. No te apures.',
        'Reducí el acelerador y subí un poco la nariz hasta 65 nudos; compensá con el trim.',
        'A 65 nudos el aire aprieta menos la puerta: empujala un poco hacia afuera y cerrala de un tirón.',
        'Para cerrarla: botones de las puertas en “Mandos”, o tocá la manija de la puerta en la cabina 3D.'
      ],
      mandos: ['doors', 'throttle', 'trim-wheel'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        if (enPerdida(s)) return falla_('Entraste en pérdida al bajar la velocidad. 65 nudos, no menos: mirá el velocímetro.');
        if (banco(s) > 45) return falla_('Te distrajiste con la puerta y el avión se inclinó de más. La regla es: primero volar el avión.');
        if (Math.abs(alt(s) - d.alt0) > 500) return falla_('Te fuiste más de 500 pies de la altura. La puerta puede esperar: volá el avión.');
        var v = ias(s);
        if (entre(v, 58, 72)) d.lentoT = num(d.lentoT, 0) + dt(ctx);
        var cerrada = !s.doorLeftOpen && !s.doorRightOpen;
        var lento = num(d.lentoT, 0) >= 3;
        if (cerrada && !lento && !d.cerroRapido) d.cerroRapido = true;
        if (cerrada && lento) return listo('¡Bien! Puerta cerrada y el avión siempre bajo control. Volvé a la velocidad de crucero.');
        if (cerrada) return res(0.6, 'Ya está cerrada. Igual practicá lo del manual: bajá a unos 65 nudos (así cuesta mucho menos cerrarla).');
        if (lento) return res(0.7, 'Bien, 65 nudos. Ahora cerrá la puerta derecha.');
        if (v > 72) return res(0.15 + 0.3 * lim01(num(d.lentoT, 0) / 3), 'Alas niveladas, y ahora reducí un poco la potencia y subí la nariz hasta unos 65 nudos.');
        return res(0.3, 'Un poco lento: no bajes de 60 nudos.');
      },
      debrief: 'Una puerta que se abre en vuelo no es motivo para aterrizar ya (POH): el 150 vuela bien así. Lo importante es no distraerse: alas niveladas y altura primero. Después reducí a unos 65 nudos, compensá, empujá la puerta apenas hacia afuera y cerrala firme. Si no se puede, aterrizá normal y cerrala en tierra.',
      errores: [
        'Soltar el volante para cerrar la puerta y dejar que el avión se incline.',
        'Intentar cerrarla a velocidad de crucero: el aire la aprieta y no podés.',
        'Hacer un aterrizaje apurado por algo que no es emergencia.'
      ]
    },

    // ─────────────────────────────────────────── 6. presión de aceite baja
    {
      id: 'presion-aceite',
      titulo: 'Presión de aceite baja',
      tipo: 'emergencia',
      contexto: 'Crucero a 3000 pies. En el barrido de instrumentos ves algo en los relojes del motor, abajo a la izquierda del tablero.',
      preset: 'cruise',
      setup: function (s) { falla(s, 'oilPress', true); },
      'señales': [
        'La aguja de presión de aceite baja del arco verde (30–60 psi) hacia el rojo.',
        'La temperatura de aceite sube.',
        'Todavía no se siente nada raro en el motor… por ahora.'
      ],
      objetivo: 'Presión baja con temperatura que sube = el motor puede fallar. Reducí la potencia, mantené una velocidad segura y buscá dónde aterrizar ya.',
      pistas: [
        'Si la presión baja pero la temperatura está normal, puede ser el instrumento. Si además la temperatura sube, es de verdad.',
        'Reducí el acelerador (menos de 2100 RPM): menos esfuerzo para el motor.',
        'Mantené entre 60 y 85 nudos y elegí un campo o el aeródromo más cercano, por si se para.'
      ],
      mandos: ['oil-gauges', 'throttle', 'trim-wheel'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        var e = s.engine || {};
        if (enPerdida(s)) return falla_('Entraste en pérdida. Aunque el motor preocupe, primero se vuela el avión.');
        if (num(e.oilPressPsi, 50) < 30) d.notada = true;
        var reducido = num(e.rpm, 2400) <= 2100 || num(s.throttle, 1) <= 0.6;
        var vel = entre(ias(s), 58, 90);
        var bien = reducido && vel && banco(s) < 35;
        d.okT = bien ? num(d.okT, 0) + dt(ctx) : 0;
        if (d.okT >= 8) return listo('Bien: potencia reducida y velocidad segura. Ahora a aterrizar en el aeródromo más cercano (o en un campo si el motor falla).');
        if (!d.notada && !reducido) return res(0.1, 'Hacé un barrido de los instrumentos del motor: presión y temperatura de aceite.');
        if (!reducido) return res(0.3, 'La presión sigue bajando y la temperatura sube: reducí el acelerador (menos de 2100 RPM).');
        if (!vel) return res(0.45, ias(s) < 58 ? 'Bajá un poco la nariz: mantené por lo menos 60 nudos.' : 'Vas rápido: entre 60 y 85 nudos.');
        return res(0.5 + 0.5 * lim01(num(d.okT, 0) / 8), 'Bien. Mientras tanto, elegí un campo por si el motor se para…');
      },
      debrief: 'POH: presión de aceite baja con temperatura NORMAL puede ser una falla del instrumento o de la válvula: aterrizá en el aeródromo más cercano. Presión baja con temperatura que SUBE: el motor puede pararse pronto; reducí potencia y elegí un campo para un posible aterrizaje forzoso. Con tiempo, avisá por radio.',
      errores: [
        'No mirar nunca los instrumentos del motor (el barrido incluye presión y temperatura).',
        'Seguir con la misma potencia “para llegar más rápido”.',
        'Volar lejos de campos aptos mientras el motor puede fallar.'
      ]
    },

    // ─────────────────────────────────────────── 7. falla del sistema de vacío
    {
      id: 'falla-vacio',
      titulo: 'Falla del sistema de vacío',
      tipo: 'anormal',
      contexto: 'Crucero a 3000 pies con algo de bruma: el horizonte de afuera se ve medio borroso. La bomba de vacío deja de andar.',
      preset: 'cruise',
      setup: function (s) { falla(s, 'vacuum', true); },
      durante: function (s, ctx) {
        // ráfagas: inclinan el avión (el horizonte artificial ya no lo muestra; el coordinador de giro sí)
        var d = ctx.data;
        if (!d.r1 && ctx.t > 14) { d.r1 = true; s.air.bank = num(s.air.bank, 0) + 14; }
        if (!d.r2 && ctx.t > 34) { d.r2 = true; var b = num(s.air.bank, 0); s.air.bank = b + (Math.abs(b) > 5 ? (b > 0 ? 10 : -10) : -16); }
      },
      'señales': [
        'El indicador de succión cae por debajo del verde (4,6–5,4).',
        'El horizonte artificial se va inclinando despacio y el direccional gira solo: MIENTEN.',
        'El coordinador de giro (eléctrico), el velocímetro, el altímetro y la brújula siguen bien.'
      ],
      objetivo: 'No le creas al horizonte artificial ni al direccional. Mantené las alas niveladas mirando afuera y el coordinador de giro (avioncito nivelado) durante 25 segundos, sin perder altura.',
      pistas: [
        'Mirá el indicador de succión: si está en cero, los giróscopos de vacío ya no sirven.',
        'Usá el coordinador de giro: si el avioncito está inclinado, el avión está virando. Nivelalo con el volante.',
        'Mirá afuera, al horizonte real (aunque haya bruma) y usá el altímetro para la altura.',
        'Si hay ráfagas, corregí suave con el volante: alas niveladas en el coordinador de giro.'
      ],
      mandos: ['suction', 'turn-coordinator', 'attitude'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        var a = s.air || {};
        if (enPerdida(s)) return falla_('Entraste en pérdida. Sin horizonte artificial, usá el velocímetro y el altímetro para la nariz.');
        if (banco(s) > 35) d.inclT = num(d.inclT, 0) + dt(ctx); else d.inclT = 0;
        if (num(d.inclT, 0) > 3) return falla_('El avión se fue a más de 35° de inclinación: seguiste al horizonte artificial, que miente. Mirá el coordinador de giro.');
        if (Math.abs(alt(s) - d.alt0) > 500) return falla_('Te fuiste más de 500 pies. Usá el altímetro (no necesita vacío) para la altura.');
        var vacioMuerto = num(s.vacuum && s.vacuum.suctionInHg, 5) < 4.6;
        if (vacioMuerto) d.empezo = true;
        if (!d.empezo) return res(0.05, 'Barré los instrumentos: ¿la succión está en el verde?');
        var nivel = banco(s) < 6 && Math.abs(num(a.turnRate, 0)) < 1.5 && Math.abs(alt(s) - d.alt0) < 250;
        if (nivel) d.nivelT = num(d.nivelT, 0) + dt(ctx);
        var p = 0.1 + 0.9 * lim01(num(d.nivelT, 0) / 25);
        if (num(d.nivelT, 0) >= 25 && ctx.t > 40) return listo('¡Muy bien! Volaste sin creerle a los giróscopos muertos: coordinador de giro, altímetro y afuera.');
        if (!nivel) return res(p, Math.abs(num(a.turnRate, 0)) >= 1.5 ? 'El coordinador de giro muestra que estás virando: nivelá las alas con el volante.' : 'Mantené la altura con el altímetro.');
        return res(p, 'Bien: alas niveladas según el coordinador de giro. Seguí así…');
      },
      debrief: 'Sin vacío, el horizonte artificial y el indicador de rumbo dejan de funcionar despacio y pueden engañarte. Te quedan el coordinador de giro (eléctrico), velocímetro, altímetro, variómetro y la brújula. Lo primero es reconocerlo (succión fuera del verde) y tapar mentalmente esos dos instrumentos. En VFR, mirá afuera; si entrás en nubes por accidente, el POH propone un viraje de 180° a régimen estándar con el coordinador de giro y el reloj.',
      errores: [
        'Seguir “corrigiendo” lo que muestra un horizonte artificial que ya no funciona.',
        'No mirar nunca el indicador de succión en el barrido.',
        'Entrar a nubes sin horizonte artificial.'
      ]
    },

    // ─────────────────────────────────────────── 8. magneto con caída excesiva
    {
      id: 'magneto-prueba',
      titulo: 'Un magneto cae de más en la prueba de motor',
      tipo: 'en tierra',
      contexto: 'Estás en la cabecera haciendo la prueba de motor (run-up), con el freno de estacionamiento puesto. Te toca probar los magnetos.',
      preset: 'runup',
      setup: function (s) { falla(s, 'magLeft', true); },
      'señales': [
        'A 1700 RPM, en R (sólo el magneto derecho) las RPM bajan poco: normal.',
        'En L (sólo el izquierdo) caen mucho más de 150 RPM y el motor tiembla.',
        'Al volver a BOTH, el motor se normaliza.'
      ],
      objetivo: 'Hacé la prueba a 1700 RPM: R, BOTH, L, BOTH. Si un magneto cae más de 150 RPM (o hay más de 75 de diferencia entre los dos), NO se vuela: volvé a BOTH y reducí a ralentí.',
      pistas: [
        'Acelerador hasta 1700 RPM con los frenos puestos.',
        'Llave a R, mirá cuánto bajan las RPM, y volvé a BOTH. Después a L y volvé a BOTH.',
        'Máximo 150 RPM de caída en cada uno y 75 de diferencia entre los dos (POH).',
        'Con una caída excesiva no se despega: BOTH, ralentí y a la plataforma a avisarle al instructor o al mecánico.'
      ],
      mandos: ['ignition', 'throttle', 'tachometer'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        var e = s.engine || {}, rpm = num(e.rpm, 0), ign = s.ignition;
        if (!e.running) return falla_('Se paró el motor: pasaste por OFF o cortaste la mezcla. La llave va de BOTH a R o a L, sin pasar por OFF.');
        if (num(s.air && s.air.groundSpeed, 0) > 8) return falla_('¡El avión se movió! En la prueba de motor, frenos y freno de estacionamiento puestos. Y con un magneto malo no se despega.');
        if (ign === 'BOTH' && entre(rpm, 1600, 1800)) { d.base = rpm; d.baseT = num(d.baseT, 0) + dt(ctx); }
        var listoBase = num(d.baseT, 0) >= 1;
        if ((ign === 'R' || ign === 'L') && listoBase) {
          var k = ign === 'R' ? 'minR' : 'minL';
          d[k] = Math.min(num(d[k], 99999), rpm);
          d[ign + 'T'] = num(d[ign + 'T'], 0) + dt(ctx);
        }
        var probR = num(d.RT, 0) >= 2.5, probL = num(d.LT, 0) >= 2.5;
        var caidaR = probR ? Math.max(0, num(d.base, 1700) - d.minR) : 0;
        var caidaL = probL ? Math.max(0, num(d.base, 1700) - d.minL) : 0;
        if (probR && probL) {
          var malo = caidaR > 150 || caidaL > 150 || Math.abs(caidaR - caidaL) > 75;
          if (ign === 'BOTH' && rpm < 1150 && num(s.throttle, 1) < 0.25) {
            return malo ? listo('Correcto: L cayó ' + Math.round(caidaL) + ' RPM (más de 150). Con un magneto así no se vuela: BOTH, ralentí y avisás.')
              : listo('Prueba terminada.');
          }
          if (ign !== 'BOTH') return res(0.8, 'Volvé la llave a BOTH.');
          return res(0.85, 'R cayó ' + Math.round(caidaR) + ' y L cayó ' + Math.round(caidaL) + ' RPM. ¿Se puede volar así? Decidí: reducí a ralentí.');
        }
        if (!listoBase) return res(0.05 + 0.15 * lim01((rpm - 1000) / 700), 'Acelerador hasta 1700 RPM, en BOTH (mirá el tacómetro).');
        if (ign === 'R') return res(0.35, probR ? 'R cayó ' + Math.round(caidaR) + ' RPM. Volvé a BOTH.' : 'Mirá cuánto bajan las RPM en R…');
        if (ign === 'L') return res(0.6, probL ? 'L cayó ' + Math.round(caidaL) + ' RPM y el motor tiembla. Volvé a BOTH.' : 'Mirá cuánto bajan las RPM en L…');
        if (!probR) return res(0.3, 'A 1700 RPM: pasá la llave a R.');
        return res(0.5, 'Ahora pasá la llave a L.');
      },
      debrief: 'La prueba de magnetos (POH, a 1700 RPM): R, BOTH, L, BOTH. Cada uno puede bajar hasta 150 RPM y la diferencia entre los dos no puede pasar de 75. Una caída grande con temblor indica bujías sucias o un magneto con problemas: no se vuela, y lo que se hace después lo deciden el instructor o el mecánico. Si NO cae nada, también es raro: puede ser un magneto “caliente” (peligroso al mover la hélice a mano).',
      errores: [
        'Pasar la llave por OFF y parar el motor.',
        'Mirar sólo si “anda” y no cuántas RPM cae.',
        'Despegar igual “porque en BOTH anda bien”.'
      ]
    },

    // ─────────────────────────────────────────── 9. motor y al aire
    {
      id: 'motor-y-al-aire',
      titulo: 'Aterrizaje abortado: motor y al aire',
      tipo: 'anormal',
      contexto: 'Corta final con flaps 40°, motor casi en ralentí y calefacción al carburador. ¡Un avión entra a la pista! No podés aterrizar.',
      preset: 'approach',
      setup: function (s) {
        s.flaps = 40; s.flapSwitch = 'OFF';
        s.throttle = 0.2; s.carbHeat = 1;
      },
      'señales': [
        'La pista está ocupada (o el aterrizaje no viene bien: alto, rápido o desalineado).',
        'Con flaps 40° el avión tiene mucha resistencia: con toda la potencia apenas sube.',
        'Al meter potencia la nariz quiere subir y va a la izquierda: pie derecho.'
      ],
      objetivo: 'POH: acelerador a fondo, calefacción en FRÍO, flaps a 20° enseguida, 55 nudos y subiendo. Después, con altura, el resto de los flaps de a poco.',
      pistas: [
        'Acelerador adentro a fondo y pie derecho para la guiñada.',
        'Calefacción del carburador en FRÍO: con calor perdés potencia.',
        'Flaps: subilos (UP) y pará (OFF) en 20°. Mirá el indicador del poste izquierdo.',
        'Nariz para 55 nudos y el variómetro positivo: estás subiendo.'
      ],
      mandos: ['throttle', 'carb-heat', 'flap-switch', 'flap-indicator'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        var a = s.air || {};
        if (a.onGround) return falla_('Tocaste la pista con un avión en ella. El “motor y al aire” se decide temprano y se hace con decisión.');
        if (enPerdida(s)) return falla_('Entraste en pérdida: con flaps y poca velocidad, no levantes la nariz de más. 55 nudos.');
        if (ias(s) < 46) { d.lentoT = num(d.lentoT, 0) + dt(ctx); if (d.lentoT > 2) return falla_('Muy lento: con flaps abajo, menos de 50 nudos es estar al borde de la pérdida.'); }
        else d.lentoT = 0;
        var potencia = num(s.throttle, 0) >= 0.95, frio = num(s.carbHeat, 1) <= 0.1;
        var flaps20 = num(s.flaps, 40) <= 23, sube = num(a.vs, 0) > 100 && entre(ias(s), 50, 68);
        if (potencia && frio && flaps20 && sube) d.subeT = num(d.subeT, 0) + dt(ctx); else d.subeT = 0;
        if (num(d.subeT, 0) >= 4) return listo('¡Motor y al aire bien hecho! Ahora seguí subiendo a 55–65 nudos y retraé los flaps de a poco cuando tengas altura.');
        var n = (potencia ? 1 : 0) + (frio ? 1 : 0) + (flaps20 ? 1 : 0) + (sube ? 1 : 0);
        var p = 0.08 + 0.18 * n + 0.2 * lim01(num(d.subeT, 0) / 4);
        if (!potencia) return res(p, '¡Acelerador a fondo! Y pie derecho.');
        if (!frio) return res(p, 'Calefacción del carburador en FRÍO.');
        if (!flaps20) return res(p, 'Flaps a 20°: subilos (UP) y pará en 20° (OFF).');
        if (num(s.flaps, 0) < 8 && agl(s) < 400) return res(p, 'Ojo: subiste todos los flaps muy bajo. El POH dice 20° primero y el resto con altura.');
        if (!sube) return res(p, ias(s) < 50 ? 'Bajá un poco la nariz: 55 nudos.' : (ias(s) > 68 ? 'Subí un poco la nariz: 55 nudos para subir.' : 'Esperá a que el variómetro marque subida…'));
        return res(p, 'Subiendo. Mantené 55 nudos…');
      },
      debrief: 'Motor y al aire (POH 150M): acelerador a fondo, calefacción del carburador en frío, flaps a 20° inmediatamente, 55 nudos, y con altura y velocidad seguras retraés el resto de a poco. Con 40° de flaps el 150 sube muy poco: por eso lo primero son los flaps a 20°. Siempre se puede abortar: decidilo temprano y con decisión.',
      errores: [
        'Subir todos los flaps de golpe a baja altura: el avión se hunde.',
        'Olvidarse de la calefacción del carburador (menos potencia).',
        'Levantar mucho la nariz con flaps abajo y quedar lento.'
      ]
    },

    // ─────────────────────────────────────────── 10. traba de comandos puesta
    {
      id: 'traba-comandos',
      titulo: 'La traba de comandos sigue puesta',
      tipo: 'en tierra',
      contexto: 'Llegaste a la cabecera con el motor en marcha. Vas a hacer el control de comandos “libres y correctos”… y el volante no se mueve.',
      preset: 'runup',
      setup: function (s) { s.controlLock = true; s.yokeRoll = 0; s.yokePitch = 0; },
      'señales': [
        'El volante no gira ni va adelante o atrás: está trabado.',
        'En el tablero se ve la traba metida en la columna del volante (con su bandera roja).',
        'Despegar así es un accidente clásico: no podés levantar la nariz ni inclinar.'
      ],
      objetivo: 'Sin acelerar, sacá la traba de comandos y hacé el control completo: volante a fondo a la izquierda, a la derecha, todo atrás y todo adelante.',
      pistas: [
        'Nunca más potencia con la traba puesta: frenos y freno de estacionamiento.',
        'La traba es una varilla con bandera roja que entra en la columna del volante. Sacala (en Mandos o tocándola en la cabina 3D).',
        'Control de comandos: volante a la izquierda y a la derecha a fondo, después todo atrás y todo adelante (en el pad o con las flechas).',
        'Mirá afuera mientras lo hacés: los alerones y el timón de profundidad tienen que moverse para el lado correcto.'
      ],
      mandos: ['control-lock', 'yoke'],
      check: function (s, ctx) {
        var d = inicio(s, ctx);
        if (s.controlLock && (num(s.throttle, 0) > 0.6 || num(s.air && s.air.groundSpeed, 0) > 5)) return falla_('¡Ibas a despegar con la traba puesta! Primero la traba, después el control de comandos, y recién ahí potencia.');
        if (!s.controlLock) d.sinTraba = true;
        if (!d.sinTraba) return res(0.1, 'El volante no se mueve: sacá la traba de comandos.');
        var r = num(s.yokeRoll, 0), p = num(s.yokePitch, 0);
        if (r <= -0.8) d.izq = true;
        if (r >= 0.8) d.der = true;
        if (p >= 0.8) d.atras = true;
        if (p <= -0.8) d.adelante = true;
        var n = (d.izq ? 1 : 0) + (d.der ? 1 : 0) + (d.atras ? 1 : 0) + (d.adelante ? 1 : 0);
        if (n === 4) return listo('¡Comandos libres y correctos! Ahora sí, a seguir con la prueba de motor.');
        var falta = !d.izq ? 'volante a fondo a la izquierda' : !d.der ? 'a fondo a la derecha' : !d.atras ? 'todo atrás (tirá)' : 'todo adelante (empujá)';
        return res(0.3 + 0.17 * n, 'Traba afuera. Control de comandos: ' + falta + '.');
      },
      debrief: 'La traba de comandos se saca en la inspección y se verifica en la checklist “Antes de arrancar”. En la cabecera, el control “comandos libres y correctos” (volante a fondo en las cuatro direcciones, mirando que los alerones y el timón de profundidad se muevan bien) es la última oportunidad de descubrirla. Nunca agregues potencia con un comando trabado.',
      errores: [
        'Saltear el control de comandos “porque siempre está bien”.',
        'Mover el volante sólo un poquito y no a fondo.',
        'No mirar afuera para ver si las superficies se mueven para el lado correcto.'
      ]
    }
  ];
})(root.C150);
