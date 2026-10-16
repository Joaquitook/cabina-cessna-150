var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * learning.js — Contenido didáctico: lecciones ("Lo básico"), recorrido de la cabina, checklists
 * interactivas, quiz, glosario y misiones de práctica ("Volar"). Referencia: Cessna 150M 1976
 * (POH 150M 1977 para números y procedimientos). Sin DOM: se puede cargar en Node para los tests.
 *
 * Interpretaciones del contrato (§4) que la UI tiene que conocer:
 *  - checklists[].items[].check(state) mira SOLO el estado actual (no recuerda nada). La UI debe
 *    tildar los ítems EN ORDEN y dejarlos tildados una vez cumplidos (por ejemplo, "Acelerador —
 *    abierto 1/4 de pulgada" deja de cumplirse cuando después ponés 1000 RPM, y eso está bien).
 *    check === null → ítem que el alumno confirma a mano (no se puede verificar en el simulador).
 *  - checklists[].continuaDe (opcional): id de la checklist que normalmente se hace justo antes.
 *    Si el alumno viene de completarla, la UI puede NO volver a aplicar el preset y seguir con el
 *    mismo estado (caso 'arranque' después de 'antes-arrancar').
 *  - missions[].pasos es un array de strings (pistas en orden). missions[].check(state, ctx) usa
 *    ctx.data como memoria propia (temporizadores, hitos); la UI debe dar un ctx.data = {} nuevo en
 *    cada intento. Devuelve un progreso 0..1 (1 = misión cumplida). No escribe en state.
 *  - quiz 'donde' trae además un campo opcional `explicacion` (dónde está, para mostrar al final).
 *  - En los textos los decimales van con coma, como se escribe en Uruguay (29,92 inHg).
 */
(function (C150) {
  'use strict';

  C150.DATA = C150.DATA || {};

  // ─────────────────────────────── utilidades para los check() ───────────────────────────────

  // Límites de respaldo (POH 150M) por si C150.Sim todavía no está cargado al evaluar.
  var LIMITES = {
    oilTempGreen: [100, 240], oilPressGreen: [30, 60], suctionGreen: [4.6, 5.4], oilPressMin: 10
  };

  function limites(s) {
    var Sim = C150.Sim;
    if (Sim && typeof Sim.limits === 'function') {
      try { return Sim.limits(s) || LIMITES; } catch (e) { return LIMITES; }
    }
    return LIMITES;
  }

  function entre(v, a, b) { return typeof v === 'number' && v >= a && v <= b; }
  function limitar01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  // Diferencia angular absoluta en grados (0..180), sirve para rumbos que cruzan 360/000.
  function difAngulo(a, b) {
    var d = ((a - b) % 360 + 540) % 360 - 180;
    return Math.abs(d);
  }

  function radiosApagadas(s) { return !s.radio.comOn && s.radio.xpdrMode === 'OFF'; }

  function lucesApagadas(s) {
    var l = s.lights;
    return !l.dome && !l.nav && !l.strobe && !l.beacon && !l.taxi && !l.landing && !s.pitotHeat;
  }

  function motorEnVerde(s) {
    var L = limites(s), e = s.engine;
    return e.running &&
      entre(e.oilTempF, L.oilTempGreen[0], L.oilTempGreen[1]) &&
      entre(e.oilPressPsi, L.oilPressGreen[0], L.oilPressGreen[1]);
  }

  function succionOk(s) {
    var L = limites(s);
    return entre(s.vacuum.suctionInHg, L.suctionGreen[0], L.suctionGreen[1]);
  }

  // Memoria de la misión (la UI la reinicia en cada intento).
  function memoria(ctx) {
    if (!ctx.data) ctx.data = {};
    return ctx.data;
  }

  // Acumula d[clave] mientras se cumple la condición. Si se deja de cumplir durante más de
  // `gracia` segundos seguidos, vuelve a cero (un temblor de un instante no arruina el intento).
  function sostener(d, clave, cumple, dt, gracia) {
    var malo = clave + 'Fuera';
    if (cumple) {
      d[clave] = (d[clave] || 0) + dt;
      d[malo] = 0;
    } else {
      d[malo] = (d[malo] || 0) + dt;
      if (d[malo] > gracia) d[clave] = 0;
    }
    return d[clave] || 0;
  }

  // ═══════════════════════════════════════ LECCIONES ═══════════════════════════════════════

  C150.DATA.lessons = [
    {
      id: 'cuatro-fuerzas',
      titulo: 'Cómo vuela un avión: las 4 fuerzas',
      resumen: 'Sustentación, peso, empuje y resistencia: cuatro fuerzas que, cuando están empatadas, dejan al avión volando tranquilo.',
      pasos: [
        {
          titulo: 'Cuatro fuerzas, siempre',
          texto: 'En vuelo, sobre el avión empujan cuatro fuerzas. La sustentación (lift) la hace el ala y empuja hacia arriba. El peso (weight) tira hacia abajo. El empuje o tracción (thrust) lo da la hélice hacia adelante, y la resistencia (drag) es el aire que te frena.',
          anim: 'four-forces', foco: null, vista: 'exterior',
          aire: { flujo: true, fuerzas: true },
          acciones: [{ etiqueta: 'Vuelo nivelado', pose: 'nivelado' }, { etiqueta: 'Subiendo', pose: 'ascenso' },
            { etiqueta: 'Bajando', pose: 'descenso' }]
        },
        {
          titulo: 'Empatadas = vuelo tranquilo',
          texto: 'En vuelo recto, nivelado y a velocidad constante, las cuatro están en equilibrio: la sustentación iguala al peso y el empuje iguala a la resistencia. Pensalo como una cinchada (tirar de la soga) donde los dos equipos tiran igual: la soga no se mueve, pero nadie está flojo.',
          anim: 'four-forces', foco: null, vista: 'exterior',
          aire: { flujo: true, fuerzas: true },
          acciones: [{ etiqueta: 'Empatadas: nivelado', pose: 'nivelado' },
            { etiqueta: 'Más potencia', pose: 'potencia-max' },
            { etiqueta: 'Potencia al mínimo', pose: 'potencia-ralenti' }]
        },
        {
          titulo: '¿Quién hace subir al avión?',
          texto: 'Mucha gente cree que para subir el ala le "gana" al peso. En un ascenso estable, lo que realmente sube al avión es el empuje de más que pone el motor. Por eso, para subir y quedarte subiendo necesitás potencia: el acelerador.',
          anim: 'propeller-throttle', foco: 'throttle', vista: 'exterior',
          aire: { flujo: true, fuerzas: true, foco: 'prop' },
          acciones: [{ etiqueta: 'Acelerador a fondo', pose: 'potencia-max' },
            { etiqueta: 'Ascenso estable', pose: 'ascenso' },
            { etiqueta: 'Acelerador al mínimo', pose: 'potencia-ralenti' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'La mano por la ventanilla',
          texto: 'Sacá la mano por la ventanilla del auto, plana. Si la inclinás un poquito con la punta hacia arriba, vas a sentir que sube (eso es sustentación) y que también la empuja hacia atrás (eso es resistencia). Un ala hace exactamente lo mismo, pero mucho mejor.',
          anim: 'aoa-stall', foco: null, vista: 'exterior',
          aire: { flujo: true, fuerzas: true, foco: 'wing' },
          acciones: [{ etiqueta: 'Ángulo chico', pose: 'nivelado' },
            { etiqueta: 'Más ángulo', pose: 'cabeceo-arriba' },
            { etiqueta: 'Demasiado ángulo: pérdida', pose: 'perdida' }]
        }
      ]
    },

    {
      id: 'tres-ejes',
      titulo: 'Los 3 ejes: alabeo, cabeceo y guiñada',
      resumen: 'El avión gira alrededor de tres ejes. El volante maneja dos (alabeo y cabeceo) y los pedales el tercero (guiñada).',
      pasos: [
        {
          titulo: 'Tres palitos imaginarios',
          texto: 'Imaginá tres palitos que se cruzan en el centro de gravedad del avión (el punto donde quedaría en equilibrio si lo colgaras de un hilo). El avión puede girar alrededor de cada uno. Cada comando de la cabina mueve una superficie y te da el control de uno de esos giros.',
          anim: 'controls-check', foco: null, vista: 'exterior',
          acciones: [{ etiqueta: 'Alabeo izquierda', pose: 'alabeo-izq' },
            { etiqueta: 'Alabeo derecha', pose: 'alabeo-der' }, { etiqueta: 'Nariz arriba', pose: 'cabeceo-arriba' },
            { etiqueta: 'Nariz abajo', pose: 'cabeceo-abajo' },
            { etiqueta: 'Guiñada izquierda', pose: 'guinada-izq' },
            { etiqueta: 'Guiñada derecha', pose: 'guinada-der' }]
        },
        {
          titulo: 'Alabeo (roll): girar el volante',
          texto: 'El alabeo es inclinar las alas, alrededor del eje que va de la nariz a la cola. Si girás el volante a la izquierda, el alerón izquierdo sube y el derecho baja: el ala derecha sustenta más, la izquierda menos, y el avión se inclina a la izquierda. Los alerones están en el borde de atrás de cada ala, cerca de la punta.',
          anim: 'axes-roll', foco: 'yoke', vista: 'exterior',
          aire: { flujo: true, giros: true, foco: 'ailerons' },
          acciones: [{ etiqueta: 'Inclinar a la izquierda', pose: 'alabeo-izq' },
            { etiqueta: 'Inclinar a la derecha', pose: 'alabeo-der' },
            { etiqueta: 'Alas niveladas', pose: 'nivelado' }]
        },
        {
          titulo: 'El volante no es el de un auto',
          texto: 'Con el volante elegís cuánto se inclina el avión, no "doblás" como en un auto. Cuando llegás a la inclinación que querés, volvés el volante casi al centro y la inclinación se queda. Es el ala inclinada la que hace virar al avión: su sustentación ahora también tira un poco hacia el costado.',
          anim: 'coordinated-turn', foco: 'yoke', vista: 'exterior',
          aire: { flujo: true, giros: true },
          acciones: [{ etiqueta: 'Motor encendido', pose: 'motor-on' },
            { etiqueta: 'Motor apagado', pose: 'motor-off' },
            { etiqueta: 'Inclinar a la izquierda', pose: 'alabeo-izq' },
            { etiqueta: 'Inclinar a la derecha', pose: 'alabeo-der' },
            { etiqueta: 'Viraje a la izquierda', pose: 'viraje-izq' },
            { etiqueta: 'Viraje a la derecha', pose: 'viraje-der' }]
        },
        {
          titulo: 'Cabeceo (pitch): tirar y empujar',
          texto: 'El cabeceo es subir o bajar la nariz, alrededor del eje que va de punta a punta de las alas. Si tirás del volante hacia vos, el timón de profundidad (elevator, la parte móvil de la cola horizontal) sube, la cola baja y la nariz sube. Si empujás, pasa al revés. Es como un subibaja.',
          anim: 'axes-pitch', foco: 'yoke', vista: 'exterior',
          aire: { flujo: true, giros: true, foco: 'elevator' },
          acciones: [{ etiqueta: 'Tirar: nariz arriba', pose: 'cabeceo-arriba' },
            { etiqueta: 'Empujar: nariz abajo', pose: 'cabeceo-abajo' },
            { etiqueta: 'Volante al centro', pose: 'nivelado' }]
        },
        {
          titulo: 'Guiñada (yaw): los pedales',
          texto: 'La guiñada es mover la nariz a la izquierda o a la derecha, alrededor de un eje vertical. Si empujás el pedal izquierdo, el timón de dirección (rudder, la parte móvil de la cola vertical) se va a la izquierda y la nariz lo sigue. En vuelo los pedales no sirven para doblar: sirven para que el avión vaya "derechito", alineado con el aire.',
          anim: 'axes-yaw', foco: 'rudder-pedals', vista: 'exterior',
          aire: { flujo: true, giros: true, foco: 'rudder' },
          acciones: [{ etiqueta: 'Pedal izquierdo', pose: 'guinada-izq' },
            { etiqueta: 'Pedal derecho', pose: 'guinada-der' }, { etiqueta: 'Pedales parejos', pose: 'nivelado' }]
        }
      ]
    },

    {
      id: 'ala-angulo-ataque',
      titulo: 'El ala y el ángulo de ataque',
      resumen: 'El ala sustenta según el ángulo con que "muerde" el aire y según la velocidad. Ese ángulo lo manejás con el volante.',
      pasos: [
        {
          titulo: 'Cómo es un ala',
          texto: 'El ala tiene adelante un borde redondeado (borde de ataque) y atrás un borde finito (borde de fuga). La cuerda es una línea recta imaginaria que une los dos bordes. Esa línea es la que vamos a usar para medir ángulos.',
          anim: 'aoa-stall', foco: null, vista: 'exterior',
          aire: { flujo: true, foco: 'wing' },
          acciones: [{ etiqueta: 'Ala en crucero', pose: 'nivelado' },
            { etiqueta: 'Más ángulo de ataque', pose: 'cabeceo-arriba' },
            { etiqueta: 'Ala en pérdida', pose: 'perdida' }]
        },
        {
          titulo: 'El viento relativo',
          texto: 'El viento relativo es el aire que el ala siente de frente por moverse, siempre en sentido contrario a hacia dónde va el avión. No tiene nada que ver con el viento del pronóstico. Si el avión va bajando, el viento relativo le llega un poquito desde abajo.',
          anim: 'aoa-stall', foco: null, vista: 'exterior',
          aire: { flujo: true, fuerzas: true },
          acciones: [{ etiqueta: 'Nivelado', pose: 'nivelado' }, { etiqueta: 'Subiendo', pose: 'ascenso' },
            { etiqueta: 'Bajando', pose: 'descenso' }]
        },
        {
          titulo: 'El ángulo de ataque',
          texto: 'El ángulo de ataque (angle of attack) es el ángulo entre la cuerda del ala y el viento relativo. Más ángulo, más sustentación... hasta un límite. Cuando tirás del volante, en realidad estás aumentando el ángulo de ataque; cuando empujás, lo bajás.',
          anim: 'axes-pitch', foco: 'yoke', vista: 'exterior',
          aire: { flujo: true, fuerzas: true, foco: 'wing' },
          acciones: [{ etiqueta: 'Poco ángulo', pose: 'cabeceo-abajo' },
            { etiqueta: 'Ángulo de crucero', pose: 'nivelado' },
            { etiqueta: 'Mucho ángulo', pose: 'cabeceo-arriba' }, { etiqueta: 'Hasta la pérdida', pose: 'perdida' }]
        },
        {
          titulo: 'La velocidad cuenta al cuadrado',
          texto: 'La sustentación crece con el cuadrado de la velocidad: al doble de velocidad, el ala da cuatro veces más sustentación. Por eso, cuando vas lento, necesitás más ángulo de ataque (nariz más arriba) para sostener el mismo peso. Ángulo y velocidad son las dos perillas del ala.',
          anim: 'four-forces', foco: 'asi', vista: 'cockpit',
          aire: { flujo: true, fuerzas: true },
          acciones: [{ etiqueta: 'Más velocidad', pose: 'potencia-max' },
            { etiqueta: 'Velocidad de crucero', pose: 'nivelado' },
            { etiqueta: 'Menos velocidad', pose: 'potencia-ralenti' }]
        }
      ]
    },

    {
      id: 'perdida',
      titulo: 'La pérdida (stall)',
      resumen: 'Una pérdida pasa cuando el ala supera su ángulo de ataque crítico. Es cuestión de ángulo, no de velocidad, y se sale bajando la nariz.',
      pasos: [
        {
          titulo: 'Qué es una pérdida',
          texto: 'Si el ángulo de ataque pasa el ángulo crítico (alrededor de 16 a 18 grados), el aire ya no puede seguir la curva de arriba del ala: se despega y hace remolinos. La sustentación cae de golpe y la nariz tiende a caer. Ojo: el motor sigue andando perfecto; "pérdida" se refiere al ala, no al motor.',
          anim: 'aoa-stall', foco: null, vista: 'exterior',
          aire: { flujo: true, foco: 'stall' },
          acciones: [{ etiqueta: 'Ala volando', pose: 'nivelado' }, { etiqueta: 'Ala en pérdida', pose: 'perdida' }]
        },
        {
          titulo: 'Es el ángulo, no la velocidad',
          texto: 'Podés entrar en pérdida a cualquier velocidad, con cualquier actitud y con cualquier potencia, si tirás demasiado. Según el manual (POH), con 1600 lb y sin flaps entra en pérdida a 47 nudos con alas niveladas, pero a 66 nudos en un viraje con 60 grados de inclinación. En un viraje cerrado tirás más, y el ala trabaja con más ángulo.',
          anim: 'coordinated-turn', foco: 'asi', vista: 'cockpit',
          aire: { flujo: true, foco: 'stall' },
          acciones: [{ etiqueta: 'Viraje', pose: 'viraje-izq' }, { etiqueta: 'Pérdida', pose: 'perdida' },
            { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'La bocina de pérdida',
          texto: 'El 150 tiene una bocina que suena entre 5 y 10 nudos antes de la pérdida. Es neumática: la hace sonar el aire que chupa una tomita en el borde de ataque del ala izquierda, así que funciona aunque no haya electricidad. Si la escuchás sin querer, empujá un poco y dale potencia.',
          anim: null, foco: 'stall-warning', vista: 'cockpit',
          acciones: [{ etiqueta: 'Acercarse a la pérdida', pose: 'perdida' },
            { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Cómo salir',
          texto: 'Lo primero: empujá el volante para bajar la nariz y reducir el ángulo de ataque. Después: potencia máxima (y la calefacción del carburador adentro, si estaba puesta), alas niveladas con el volante y pedal para que la nariz no se vaya de costado. Cuando la velocidad vuelve, subí la nariz suave hasta el horizonte.',
          anim: 'aoa-stall', foco: 'yoke', vista: 'cockpit',
          aire: { flujo: true, fuerzas: true },
          acciones: [{ etiqueta: 'En pérdida', pose: 'perdida' },
            { etiqueta: 'Bajar la nariz', pose: 'cabeceo-abajo' }, { etiqueta: 'Potencia', pose: 'potencia-max' },
            { etiqueta: 'Recuperado: nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Pies despiertos',
          texto: 'Si llegás a la pérdida sin coordinación (la bolita del coordinador de giro corrida), un ala puede entrar en pérdida antes que la otra y caer: así empieza un tirabuzón (spin). Por eso, cerca de la pérdida, mantené la bolita al centro con los pedales.',
          anim: null, foco: 'turn-coordinator', vista: 'cockpit',
          acciones: [{ etiqueta: 'Pie izquierdo', pose: 'guinada-izq' },
            { etiqueta: 'Pie derecho', pose: 'guinada-der' }, { etiqueta: 'Pies parejos', pose: 'nivelado' }]
        }
      ]
    },

    {
      id: 'coordinacion',
      titulo: 'Coordinación y la bolita',
      resumen: 'Volante y pedal se usan juntos. La bolita del coordinador de giro te dice si vas coordinado: "pisá la bolita".',
      pasos: [
        {
          titulo: 'La guiñada adversa',
          texto: 'Cuando girás el volante a la izquierda, el alerón que baja (el derecho) da más sustentación, pero también más resistencia. Esa resistencia frena el ala derecha y la nariz, al principio, se va para el lado contrario al viraje. Eso se llama guiñada adversa (adverse yaw) y es más fuerte cuando vas lento.',
          anim: 'adverse-yaw', foco: 'yoke', vista: 'exterior',
          aire: { flujo: true, giros: true, foco: 'ailerons' },
          acciones: [{ etiqueta: 'Sólo volante a la izquierda', pose: 'alabeo-izq' },
            { etiqueta: 'Sólo volante a la derecha', pose: 'alabeo-der' },
            { etiqueta: 'Volante y pie juntos', pose: 'viraje-izq' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Volante y pie, juntos',
          texto: 'El remedio es pisar el pedal del mismo lado que girás el volante, al mismo tiempo: volante a la izquierda, pie izquierdo. Así la nariz acompaña el viraje y el avión no "derrapa". A esto le decimos viraje coordinado.',
          anim: 'coordinated-turn', foco: 'rudder-pedals', vista: 'exterior',
          aire: { flujo: true, giros: true },
          acciones: [{ etiqueta: 'Viraje coordinado izq.', pose: 'viraje-izq' },
            { etiqueta: 'Viraje coordinado der.', pose: 'viraje-der' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'La bolita',
          texto: 'Abajo del coordinador de giro hay una bolita dentro de un tubo curvo con líquido, como el nivel de un albañil. Si está al centro, vas coordinado. Si se corre a un costado, "pisá la bolita": apretá el pedal de ese lado hasta que vuelva al medio.',
          anim: null, foco: 'turn-coordinator', vista: 'cockpit',
          acciones: [{ etiqueta: 'Viraje coordinado', pose: 'viraje-izq' },
            { etiqueta: 'Pie izquierdo de más', pose: 'guinada-izq' },
            { etiqueta: 'Pie derecho de más', pose: 'guinada-der' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Por qué en ascenso va pie derecho',
          texto: 'La hélice gira en sentido horario vista desde tu asiento. Con mucha potencia y poca velocidad (despegue, ascenso, arremetida) eso tira la nariz a la izquierda: el factor P (la pala que baja muerde más aire), la estela de la hélice que golpea la cola de costado y el torque. La solución es simple: pie derecho.',
          anim: 'left-turning', foco: 'rudder-pedals', vista: 'exterior',
          aire: { flujo: true, giros: true, foco: 'prop' },
          acciones: [{ etiqueta: 'Ascenso a toda potencia', pose: 'ascenso' },
            { etiqueta: 'Potencia máxima', pose: 'potencia-max' }, { etiqueta: 'Pie derecho', pose: 'guinada-der' },
            { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'El viraje estándar',
          texto: 'En el coordinador de giro, si el ala del avioncito queda sobre la marca L o R, estás virando a 3 grados por segundo: una vuelta completa en 2 minutos. Eso se llama viraje estándar. Ojo: este instrumento no te dice nada de la nariz arriba o abajo.',
          anim: 'coordinated-turn', foco: 'turn-coordinator', vista: 'cockpit',
          acciones: [{ etiqueta: 'Viraje estándar izq.', pose: 'viraje-izq' },
            { etiqueta: 'Viraje estándar der.', pose: 'viraje-der' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        }
      ]
    },

    {
      id: 'flaps',
      titulo: 'Los flaps',
      resumen: 'Los flaps curvan más el ala: más sustentación y mucha más resistencia, para aproximar lento y empinado. Nunca arriba de 85 nudos.',
      pasos: [
        {
          titulo: 'Qué hacen',
          texto: 'Los flaps son las superficies grandes en la parte de atrás del ala, cerca del fuselaje. Al bajarlos, el ala se curva más: da más sustentación y mucha más resistencia. Eso te deja bajar más lento y más empinado, con la nariz más baja, así ves mejor la pista.',
          anim: 'flaps-extend', foco: null, vista: 'exterior',
          aire: { flujo: true, fuerzas: true, foco: 'flaps' },
          acciones: [{ etiqueta: 'Flaps 0°', pose: 'flaps-0' }, { etiqueta: 'Flaps 10°', pose: 'flaps-10' },
            { etiqueta: 'Flaps 20°', pose: 'flaps-20' }, { etiqueta: 'Flaps 40°', pose: 'flaps-40' }]
        },
        {
          titulo: 'El interruptor del 150M 1976',
          texto: 'Es una palanquita de tres posiciones. Para bajarlos, la mantenés apretada hacia abajo (DOWN) y, cuando la soltás, vuelve sola al centro (OFF) y los flaps se quedan donde estaban; de 0 a 40 grados tardan unos 9 segundos. Arriba (UP) queda trabada y los sube del todo en unos 6 segundos. En el 1977 hay en cambio una palanca que preselecciona el ángulo, con topes en 10 y 20 grados.',
          anim: null, foco: 'flap-switch', vista: 'cockpit',
          acciones: [{ etiqueta: 'Flaps arriba (UP)', pose: 'flaps-0' }, { etiqueta: 'Bajar a 20°', pose: 'flaps-20' }]
        },
        {
          titulo: 'Cómo sabés cuánto bajaron',
          texto: 'En el parante izquierdo del parabrisas (el marco de adelante de tu puerta) hay una escala de 0 a 40 grados con una aguja. Mirala cada vez que muevas los flaps. Son eléctricos: con el master apagado no se mueven.',
          anim: null, foco: 'flap-indicator', vista: 'cockpit',
          acciones: [{ etiqueta: 'Flaps 0°', pose: 'flaps-0' }, { etiqueta: 'Flaps 10°', pose: 'flaps-10' },
            { etiqueta: 'Flaps 20°', pose: 'flaps-20' }, { etiqueta: 'Flaps 40°', pose: 'flaps-40' }]
        },
        {
          titulo: 'El límite: 85 nudos',
          texto: 'Nunca bajes flaps por encima de 85 nudos (Vfe), que es la punta de arriba del arco blanco del velocímetro. El arco blanco va de 42 a 85 nudos: 42 es la velocidad de pérdida con flaps abajo y avión cargado.',
          anim: null, foco: 'asi', vista: 'cockpit'
        },
        {
          titulo: 'Lo que vas a sentir',
          texto: 'Al bajar flaps, el 150 levanta la nariz y quiere subir un poco ("globea"): sostené con un poquito de empuje y recompensá. Para despegar se usan 0 grados (10 sólo en pista blanda o corta; más de 10 no está aprobado). En una arremetida: potencia máxima y enseguida flaps a 20 grados; después los subís de a poco.',
          anim: 'flaps-extend', foco: 'yoke', vista: 'exterior',
          aire: { flujo: true, fuerzas: true, foco: 'flaps' },
          acciones: [{ etiqueta: 'Sin flaps', pose: 'flaps-0' }, { etiqueta: 'Flaps 20°', pose: 'flaps-20' },
            { etiqueta: 'Flaps 40°', pose: 'flaps-40' }, { etiqueta: 'Aproximación', pose: 'descenso' }]
        }
      ]
    },

    {
      id: 'compensador',
      titulo: 'El compensador (trim)',
      resumen: 'El compensador saca la fuerza que hacés en el volante. Primero ponés la actitud, después compensás.',
      pasos: [
        {
          titulo: 'Para qué sirve',
          texto: 'Si querés volar más lento o más rápido que antes, tenés que sostener el volante tirando o empujando todo el tiempo. El compensador (trim) borra esa fuerza para que el avión se quede solo. Es como ajustar el resorte de una puerta para que quede donde la dejás.',
          anim: 'trim-tab', foco: null, vista: 'exterior',
          aire: { flujo: true, foco: 'tail' },
          acciones: [{ etiqueta: 'Trim nariz arriba', pose: 'compensador-arriba' },
            { etiqueta: 'Trim nariz abajo', pose: 'compensador-abajo' }, { etiqueta: 'Compensado', pose: 'nivelado' }]
        },
        {
          titulo: 'La rueda y su indicador',
          texto: 'Es la rueda negra vertical abajo en el centro del panel, debajo de los comandos del motor. A su izquierda hay un indicador con NOSE DN (nariz abajo), TAKE OFF (despegue) y NOSE UP (nariz arriba). Rueda hacia adelante = nariz abajo; rueda hacia atrás = nariz arriba. En el teclado: T y G.',
          anim: null, foco: 'trim-wheel', vista: 'cockpit',
          acciones: [{ etiqueta: 'Rueda hacia atrás', pose: 'compensador-arriba' },
            { etiqueta: 'Rueda hacia adelante', pose: 'compensador-abajo' },
            { etiqueta: 'Compensado', pose: 'nivelado' }]
        },
        {
          titulo: 'La aleta compensadora',
          texto: 'Todo el borde de atrás de la mitad derecha del timón de profundidad es una aleta compensadora (trim tab). Se mueve al revés que el timón: para sostener la nariz arriba, la aleta baja, el aire la empuja hacia arriba y ella mantiene el timón levantado.',
          anim: 'trim-tab', foco: null, vista: 'exterior',
          aire: { flujo: true, foco: 'tail' },
          acciones: [{ etiqueta: 'Trim nariz arriba', pose: 'compensador-arriba' },
            { etiqueta: 'Trim nariz abajo', pose: 'compensador-abajo' }, { etiqueta: 'Compensado', pose: 'nivelado' }]
        },
        {
          titulo: 'El método',
          texto: 'Uno: poné la actitud que querés con el volante. Dos: esperá a que la velocidad se estabilice. Tres: girá la rueda hasta que no tengas que hacer fuerza. Cuatro: aflojá la mano un instante y fijate que el avión se quede. El trim no elige la actitud: vos la elegís, el trim la sostiene.',
          anim: null, foco: 'trim-wheel', vista: 'cockpit'
        },
        {
          titulo: 'Antes de despegar: TAKE OFF',
          texto: 'En la prueba de motor dejás el compensador en la marca TAKE OFF. Si te lo olvidás muy nariz abajo, vas a tener que tirar mucho para rotar; si está muy nariz arriba, el avión puede levantar la nariz de golpe.',
          anim: null, foco: 'trim-wheel', vista: 'cockpit'
        }
      ]
    },

    {
      id: 'motor',
      titulo: 'El motor: potencia, mezcla y calefacción del carburador',
      resumen: 'Acelerador negro, mezcla roja y calefacción del carburador: qué hace cada perilla y por qué el hielo en el carburador importa tanto en Uruguay.',
      pasos: [
        {
          titulo: 'El motor y la hélice',
          texto: 'El 150M tiene un Continental O-200-A: 4 cilindros, enfriado por aire, con carburador, 100 caballos a 2750 RPM. La hélice es de paso fijo (no cambia su ángulo), así que el tacómetro, que marca las RPM (vueltas por minuto), es tu medidor de potencia. Ojo: si bajás la nariz las RPM suben solas; no pases la raya roja de 2750.',
          anim: 'propeller-throttle', foco: 'tachometer', vista: 'cockpit',
          aire: { flujo: true, foco: 'prop' },
          acciones: [{ etiqueta: 'Motor apagado', pose: 'motor-off' },
            { etiqueta: 'Motor encendido', pose: 'motor-on' }, { etiqueta: 'Potencia máxima', pose: 'potencia-max' }]
        },
        {
          titulo: 'El acelerador (THROTTLE)',
          texto: 'Es la perilla negra grande del centro. Adentro = más potencia; afuera = ralentí (el mínimo). Movelo suave, en 2 o 3 segundos. Al dar potencia la nariz sube y se va a la izquierda (pie derecho); al sacar potencia baja. Tiene un disco de fricción en la base: girándolo, la perilla queda más dura y no se mueve sola.',
          anim: 'propeller-throttle', foco: 'throttle', vista: 'cockpit',
          acciones: [{ etiqueta: 'Acelerador afuera: ralentí', pose: 'potencia-ralenti' },
            { etiqueta: 'Acelerador adentro: a fondo', pose: 'potencia-max' },
            { etiqueta: 'Crucero', pose: 'nivelado' }]
        },
        {
          titulo: 'La mezcla (MIXTURE)',
          texto: 'Es la perilla roja. Ajusta cuánta nafta va con el aire. Adentro = RICA (con más nafta); toda afuera = CORTE (idle cut-off): se corta la nafta y el motor se para. Así se apaga el motor. Para despegar y subir por debajo de 5000 pies (en Uruguay, casi siempre) va toda rica; en crucero se empobrece un poco. Nunca la confundas con el acelerador.',
          anim: null, foco: 'mixture', vista: 'cockpit'
        },
        {
          titulo: 'El hielo en el carburador',
          texto: 'Dentro del carburador el aire se acelera por un angostamiento y la nafta se evapora: eso lo enfría mucho, aunque afuera haga calor. Si hay humedad, se forma hielo y tapa el paso del aire. Es probable con menos de 21 °C y humedad de más del 80 %, y posible hasta con 38 °C. Es peor con poca potencia, por ejemplo al bajar. Con la humedad de Uruguay, esto pasa de verdad.',
          anim: 'carb-ice', foco: null, vista: 'exterior',
          acciones: [{ etiqueta: 'Motor en marcha', pose: 'motor-on' },
            { etiqueta: 'Poca potencia: más riesgo', pose: 'potencia-ralenti' },
            { etiqueta: 'Descenso con poca potencia', pose: 'descenso' }]
        },
        {
          titulo: 'La calefacción del carburador (CARB HEAT)',
          texto: 'Si tirás esta perilla, el motor toma aire caliente de alrededor del escape en lugar de aire frío. Síntoma de hielo: las RPM bajan sin explicación y después el motor anda áspero. Remedio: calefacción toda afuera; si el motor tose un poco, es el hielo derritiéndose: dejala puesta. Regla de oro: calefacción afuera ANTES de sacar potencia para aterrizar. En tierra, evitala: ese aire no pasa por el filtro.',
          anim: 'carb-ice', foco: 'carb-heat', vista: 'cockpit',
          acciones: [{ etiqueta: 'Poca potencia', pose: 'potencia-ralenti' },
            { etiqueta: 'Descenso', pose: 'descenso' }, { etiqueta: 'Potencia máxima', pose: 'potencia-max' }]
        },
        {
          titulo: 'Los magnetos',
          texto: 'Las bujías las alimentan dos magnetos, que son generadores propios del motor: no necesitan la batería. Por eso el motor sigue andando aunque apagues el master. Y por eso mismo, si un cable de masa está roto, la hélice puede arrancar con la llave en OFF: tratala siempre como si estuviera viva.',
          anim: null, foco: 'ignition', vista: 'cockpit',
          acciones: [{ etiqueta: 'Motor en marcha', pose: 'motor-on' },
            { etiqueta: 'Motor apagado', pose: 'motor-off' }]
        }
      ]
    },

    {
      id: 'instrumentos',
      titulo: 'Instrumentos: pitot-estático, vacío y electricidad',
      resumen: 'Cada instrumento funciona con algo: aire (pitot y estática), vacío (giróscopos) o electricidad. Saberlo te dice qué creerle cuando algo falla.',
      pasos: [
        {
          titulo: 'Pitot y toma estática',
          texto: 'El tubo pitot, debajo del ala izquierda, recibe el aire de frente. La toma estática, un agujerito en el costado izquierdo del fuselaje, cerca de la nariz, siente el aire quieto. El velocímetro usa los dos; el altímetro y el variómetro usan sólo la estática. Ninguno de los tres necesita electricidad.',
          anim: 'pitot-static', foco: 'asi', vista: 'exterior',
          acciones: [{ etiqueta: 'Subir', pose: 'ascenso' }, { etiqueta: 'Bajar', pose: 'descenso' },
            { etiqueta: 'Acelerar', pose: 'potencia-max' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Qué falla con qué',
          texto: 'Si se tapa el pitot (una funda olvidada, un insecto), falla sólo el velocímetro. Si se tapa la estática, fallan los tres: velocímetro, altímetro y variómetro. Por eso en la inspección de afuera sacás la funda del pitot y mirás que la toma estática esté limpia.',
          anim: 'pitot-static', foco: 'altimeter', vista: 'exterior',
          acciones: [{ etiqueta: 'Subir', pose: 'ascenso' }, { etiqueta: 'Bajar', pose: 'descenso' },
            { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Los giróscopos de vacío',
          texto: 'Una bomba de vacío movida por el motor hace girar los trompos (giróscopos) del horizonte artificial y del direccional. El indicador de succión tiene que marcar entre 4,6 y 5,4 inHg; fuera de eso, no les creas. Si el motor se para, esos dos se van perdiendo de a poco y sin avisar.',
          anim: null, foco: 'suction', vista: 'cockpit',
          acciones: [{ etiqueta: 'Viraje', pose: 'viraje-izq' },
            { etiqueta: 'Nariz arriba', pose: 'cabeceo-arriba' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Lo eléctrico',
          texto: 'El coordinador de giro es eléctrico, a propósito: si falla el vacío, te queda un giróscopo. También dependen de la electricidad los indicadores de combustible, la temperatura de aceite (en el 150M), los flaps, el arranque, las radios y las luces. Con el master apagado, todo eso queda muerto.',
          anim: null, foco: 'turn-coordinator', vista: 'cockpit',
          acciones: [{ etiqueta: 'Viraje izquierda', pose: 'viraje-izq' },
            { etiqueta: 'Viraje derecha', pose: 'viraje-der' }, { etiqueta: 'Nivelado', pose: 'nivelado' }]
        },
        {
          titulo: 'Lo que no necesita nada',
          texto: 'Funcionan solos: los magnetos y el encendido, el tacómetro (va con un cable desde el motor), la presión de aceite (va con un caño de aceite), la brújula y la bocina de pérdida (neumática). El reloj tiene alimentación directa de la batería. Si se apaga todo lo eléctrico, el motor sigue andando.',
          anim: null, foco: 'compass', vista: 'cockpit'
        },
        {
          titulo: 'El altímetro y el QNH en Uruguay',
          texto: 'El altímetro es un barómetro que muestra pies. Con la perilla le ponés el QNH, la presión que te da la torre o el METAR (el informe del tiempo del aeródromo). En Uruguay viene en hectopascales (hPa), pero muchos 150 tienen la ventanilla en pulgadas de mercurio: 1013 hPa = 29,92 inHg, y 1 hPa son unos 30 pies. En tierra, bien ajustado, marca la elevación del aeródromo.',
          anim: null, foco: 'altimeter', vista: 'cockpit',
          acciones: [{ etiqueta: 'Subir', pose: 'ascenso' }, { etiqueta: 'Bajar', pose: 'descenso' }]
        }
      ]
    },

    {
      id: 'actitud-potencia',
      titulo: 'Actitud + potencia = performance',
      resumen: 'Elegís dónde va la nariz y cuánta potencia: el avión te da una velocidad y un ascenso o descenso. Y la mayor parte del tiempo, mirás afuera.',
      pasos: [
        {
          titulo: 'La fórmula',
          texto: 'Actitud es dónde está la nariz respecto del horizonte. Si elegís una actitud y una potencia, el avión te da una velocidad y un ascenso o descenso predecibles. En el auto, el pedal y la pendiente de la calle deciden la velocidad; en el avión, vos elegís la pendiente (actitud) y el pedal (potencia).',
          anim: 'axes-pitch', foco: null, vista: 'exterior',
          acciones: [{ etiqueta: 'Crucero', pose: 'nivelado' }, { etiqueta: 'Ascenso', pose: 'ascenso' },
            { etiqueta: 'Descenso', pose: 'descenso' }]
        },
        {
          titulo: 'Números típicos',
          texto: 'Para ascender: potencia máxima y la nariz más o menos un puño arriba del horizonte da unos 65 a 75 nudos. Crucero: unas 2400 a 2500 RPM con la nariz en el horizonte. Planeo: ralentí y la nariz un poco abajo para 60 nudos. Son valores de referencia: tu instructor te va a mostrar la imagen exacta.',
          anim: null, foco: 'tachometer', vista: 'cockpit',
          acciones: [{ etiqueta: 'Crucero', pose: 'nivelado' }, { etiqueta: 'Ascenso', pose: 'ascenso' },
            { etiqueta: 'Descenso', pose: 'descenso' }]
        },
        {
          titulo: 'Quién controla qué',
          texto: 'A grandes rasgos: la potencia decide si subís o bajás, y la actitud (el volante) decide la velocidad. Si querés subir, primero potencia. Tirar sin potencia no te sube: te frena y te acerca a la pérdida.',
          anim: 'propeller-throttle', foco: 'throttle', vista: 'cockpit',
          acciones: [{ etiqueta: 'Más potencia', pose: 'potencia-max' },
            { etiqueta: 'Menos potencia', pose: 'potencia-ralenti' },
            { etiqueta: 'Nariz arriba', pose: 'cabeceo-arriba' }, { etiqueta: 'Nariz abajo', pose: 'cabeceo-abajo' }]
        },
        {
          titulo: 'Mirá afuera',
          texto: 'Tu referencia principal es el horizonte de verdad: dónde corta el capó del motor. Los instrumentos sólo confirman. Una mirada corta adentro (un segundo) y varios segundos afuera, revisando el cielo por partes en busca de otros aviones. El horizonte artificial es una ventanita al horizonte real: si ves el real, usá el real.',
          anim: null, foco: 'attitude', vista: 'cockpit',
          acciones: [{ etiqueta: 'Nivelado', pose: 'nivelado' }, { etiqueta: 'Ascenso', pose: 'ascenso' },
            { etiqueta: 'Viraje', pose: 'viraje-izq' }]
        },
        {
          titulo: 'El barrido de instrumentos',
          texto: 'Cuando mirás adentro, empezá por el horizonte artificial y de ahí andá al velocímetro, volvé, andá al altímetro, volvé, y así. No te quedes clavado en uno. El variómetro tarda unos segundos en estabilizarse: te da la tendencia, no la verdad; no lo persigas.',
          anim: null, foco: 'vsi', vista: 'cockpit'
        }
      ]
    },

    {
      id: 'en-tierra',
      titulo: 'En tierra: carreteo, frenos y viento',
      resumen: 'En tierra se dobla con los pies, se frena con la punta de los pies y el volante se usa contra el viento.',
      pasos: [
        {
          titulo: 'Se dobla con los pies',
          texto: 'Los pedales mueven la rueda de nariz unos 8,5 grados para cada lado. Si además frenás de ese lado, girás hasta 30 grados. El volante NO dobla en tierra: el error clásico del primer día es querer doblar con las manos.',
          anim: 'ground-steering', foco: 'rudder-pedals', vista: 'exterior',
          acciones: [{ etiqueta: 'Doblar a la izquierda', pose: 'carreteo-izq' },
            { etiqueta: 'Doblar a la derecha', pose: 'carreteo-der' }]
        },
        {
          titulo: 'Los frenos',
          texto: 'Se frena apretando la parte de arriba de cada pedal: el izquierdo frena la rueda principal izquierda y el derecho la derecha. La rueda de nariz no tiene freno. Carreteá con los talones en el piso, así no frenás sin querer, y probá los frenos apenas empezás a moverte. En el teclado, B frena.',
          anim: 'ground-steering', foco: 'toe-brakes', vista: 'cockpit',
          acciones: [{ etiqueta: 'Doblar a la izquierda', pose: 'carreteo-izq' },
            { etiqueta: 'Doblar a la derecha', pose: 'carreteo-der' }]
        },
        {
          titulo: 'Velocidad y freno de estacionamiento',
          texto: 'La velocidad de carreteo se controla con el acelerador, no con los frenos: más o menos la de una persona caminando rápido. El freno de estacionamiento es la perilla de abajo a la izquierda. Para sacarlo, apretás los frenos y empujás la perilla toda adentro. No te olvides de sacarlo antes de carretear.',
          anim: null, foco: 'parking-brake', vista: 'cockpit'
        },
        {
          titulo: 'El volante contra el viento',
          texto: 'Con viento de frente desde un costado, girá el volante hacia el lado del viento (ese alerón sube) y dejá la profundidad neutra. Con viento de cola desde un costado, girá el volante hacia el lado contrario (el alerón del lado del viento baja) y empujá. Así el viento no te levanta un ala ni la cola.',
          anim: null, foco: 'yoke', vista: 'cockpit'
        },
        {
          titulo: 'Conocé los límites',
          texto: 'La componente de viento cruzado máxima demostrada del 150 es 13 nudos. En Laguna del Sauce, un alumno que volaba solo un A150M perdió el control al aterrizar con 10,3 nudos de viento cruzado, y después dijo que no conocía bien ese límite. Moraleja: sabé tus números y seguí trabajando con los pies hasta que el avión esté parado.',
          anim: null, foco: 'rudder-pedals', vista: 'cockpit'
        }
      ]
    },

    {
      id: 'primera-clase',
      titulo: 'Tu primera clase',
      resumen: 'Lo que un instructor te muestra el primer día: entrega de comandos, inspección, la cabina, el arranque, la prueba de motor y el vuelo.',
      pasos: [
        {
          titulo: 'La charla y los comandos',
          texto: 'Antes de subir, el instructor te explica qué van a hacer. Lo más importante es la entrega de comandos en tres pasos: él dice "Tenés los comandos", vos respondés "Tengo los comandos" y él confirma "Tenés los comandos". Hasta que te lo digan, pies en el piso y manos quietas.',
          anim: null, foco: 'yoke', vista: 'cockpit'
        },
        {
          titulo: 'La inspección de afuera',
          texto: 'Recorren el avión con la checklist: superficies que se mueven libres, purga de combustible (buscar agua o suciedad), aceite (nunca menos de 4 cuartos; 5 para vuelos cortos), prueba de la bocina de pérdida, funda del pitot afuera, toma estática limpia y hélice sin golpes.',
          anim: 'controls-check', foco: null, vista: 'exterior',
          acciones: [{ etiqueta: 'Alerones: izquierda', pose: 'alabeo-izq' },
            { etiqueta: 'Alerones: derecha', pose: 'alabeo-der' },
            { etiqueta: 'Profundidad arriba', pose: 'cabeceo-arriba' },
            { etiqueta: 'Profundidad abajo', pose: 'cabeceo-abajo' },
            { etiqueta: 'Timón izquierda', pose: 'guinada-izq' }, { etiqueta: 'Timón derecha', pose: 'guinada-der' }]
        },
        {
          titulo: 'En el asiento',
          texto: 'Asiento trabado (empujá atrás y adelante para probar la traba), cinturón puesto y que llegues a fondo con los pedales. Mirá dónde corta el horizonte sobre el capó. Después, el ejercicio de tocar: tocá cada comando y decí su nombre, primero mirando y después con los ojos cerrados. Sobre todo: acelerador (negro), mezcla (roja) y calefacción del carburador.',
          anim: null, foco: 'seats', vista: 'cockpit'
        },
        {
          titulo: 'Arranque y carreteo',
          texto: 'Con la checklist en la mano: combustible abierto, mezcla rica, calefacción fría, master, cebador, acelerador apenas abierto, "¡Libre la hélice!" y llave a START. Presión de aceite en menos de 30 segundos. Muchas veces el primer día el carreteo lo hacés vos, con los pies.',
          anim: null, foco: 'ignition', vista: 'cockpit'
        },
        {
          titulo: 'Prueba de motor y despegue',
          texto: 'En el punto de espera, cerca de la cabecera: prueba de motor a 1700 RPM, magnetos (caída máxima 150 RPM y 75 de diferencia), calefacción del carburador, succión y compensador en TAKE OFF. Normalmente despega el instructor y vos acompañás suave en los comandos: se levanta la nariz a 50 nudos y se sube a 60 o 70.',
          anim: null, foco: 'tachometer', vista: 'cockpit'
        },
        {
          titulo: 'En la zona y de vuelta',
          texto: 'En la zona de práctica vas a probar el efecto de cada comando, vuelo recto y nivelado, virajes suaves, ascensos, descensos y compensar, siempre mirando si hay otros aviones. A la vuelta suele aterrizar el instructor. Apagado: mezcla corte, llave OFF, master OFF y traba de comandos. Al final, charla y anotación en tu libro de vuelo.',
          anim: 'coordinated-turn', foco: null, vista: 'exterior',
          acciones: [{ etiqueta: 'Viraje izquierda', pose: 'viraje-izq' },
            { etiqueta: 'Viraje derecha', pose: 'viraje-der' }, { etiqueta: 'Ascenso', pose: 'ascenso' },
            { etiqueta: 'Descenso', pose: 'descenso' }]
        }
      ]
    }
  ];

  // ═══════════════════════════════════════ RECORRIDO ═══════════════════════════════════════
  // Orden en que un instructor muestra la cabina el primer día: sentarse, comandos de vuelo,
  // motor, combustible, flaps y trim, y por último los instrumentos.

  C150.DATA.tour = [
    {
      control: 'seats',
      titulo: 'Sentate bien',
      texto: 'Ajustá el asiento para llegar a fondo con los pedales y empujá atrás y adelante para comprobar que la traba entró. Después abrochá el cinturón y el arnés. Un asiento que se corre en el despegue te aleja de los pedales y del acelerador.'
    },
    {
      control: 'control-lock',
      titulo: 'La traba de comandos',
      texto: 'Es la varilla de metal con bandera roja que atraviesa el eje del volante. Su bandera cuelga sobre la llave de encendido, justamente para que no puedas arrancar sin verla. Es lo primero que sacás y lo último que ponés.'
    },
    {
      control: 'yoke',
      titulo: 'El volante',
      texto: 'Girarlo inclina el avión (alerones); tirarlo y empujarlo sube y baja la nariz (timón de profundidad). Agarralo suave, con la punta de los dedos: no es un volante de camión. El del instructor se mueve igual que el tuyo.'
    },
    {
      control: 'rudder-pedals',
      titulo: 'Los pedales',
      texto: 'Mueven el timón de dirección y, en tierra, la rueda de nariz. En el aire sirven para ir coordinado: volante y pie del mismo lado. En los ascensos vas a necesitar pie derecho.'
    },
    {
      control: 'toe-brakes',
      titulo: 'Los frenos',
      texto: 'Están en la parte de arriba de cada pedal: apretás con la punta del pie. Cada uno frena su rueda principal, así que también te ayudan a doblar cerrado en tierra. Al carretear, talones en el piso.'
    },
    {
      control: 'parking-brake',
      titulo: 'El freno de estacionamiento',
      texto: 'Es la perilla cromada abajo a la izquierda (PARK BRAKE). Se pone apretando los frenos y tirando de la perilla; se saca apretando los frenos y empujándola toda adentro. Se usa para arrancar y para la prueba de motor.'
    },
    {
      control: 'throttle',
      titulo: 'El acelerador',
      texto: 'La perilla negra grande del centro. Adentro es más potencia, afuera es ralentí. Movelo siempre suave y con la mano apoyada: es el comando que más vas a tocar.'
    },
    {
      control: 'mixture',
      titulo: 'La mezcla',
      texto: 'La perilla roja, a la derecha del acelerador. Adentro es rica y toda afuera corta la nafta y apaga el motor. Tiene un botón de traba que tenés que apretar para moverla, justamente para que no la saques por error.'
    },
    {
      control: 'carb-heat',
      titulo: 'La calefacción del carburador',
      texto: 'La perilla cromada a la izquierda del acelerador (CARB HEAT). Tirándola, el motor toma aire caliente para derretir o evitar el hielo en el carburador. Se pone antes de sacar potencia para bajar y se saca para despegar o arremeter.'
    },
    {
      control: 'primer',
      titulo: 'El cebador',
      texto: 'El émbolo cromado abajo a la izquierda (PRIMER). Lo destrabás, lo sacás y lo empujás: cada bombeo tira un chorrito de nafta en la admisión para facilitar el arranque. Al terminar, adentro y trabado.'
    },
    {
      control: 'master',
      titulo: 'El master',
      texto: 'El interruptor rojo partido en dos: BAT (batería, la mitad derecha) y ALT (alternador, la izquierda). Prende toda la electricidad del avión. Lo normal es mover las dos mitades juntas.'
    },
    {
      control: 'ignition',
      titulo: 'La llave de encendido',
      texto: 'Tiene OFF, R, L, BOTH (ambos) y START. En START arranca el motor y al soltar vuelve sola a BOTH. R y L se usan para probar cada magneto; en vuelo siempre va en BOTH.'
    },
    {
      control: 'fuel-shutoff',
      titulo: 'La válvula de combustible',
      texto: 'Está en el piso, entre los dos asientos: "FUEL – 22.5 GALS – ON / OFF". No hay selector de tanque izquierdo o derecho: los dos alimentan juntos por gravedad. Va siempre en ON; OFF es para un incendio o una emergencia.'
    },
    {
      control: 'fuel-gauges',
      titulo: 'Los indicadores de combustible',
      texto: 'Abajo a la izquierda, uno por tanque (L y R). Son eléctricos y poco confiables: antes de volar, siempre mirás los tanques con tus propios ojos. En la E todavía queda nafta, pero no se puede usar.'
    },
    {
      control: 'oil-gauges',
      titulo: 'Aceite: presión y temperatura',
      texto: 'Al lado de los de combustible. La presión de aceite tiene que subir en menos de 30 segundos después de arrancar; si no, apagás. En vuelo, las dos agujas en el verde.'
    },
    {
      control: 'tachometer',
      titulo: 'El tacómetro',
      texto: 'Marca las RPM del motor: es tu medidor de potencia. Verde de 2000 a 2750 y raya roja en 2750. Abajo tiene el horómetro, que cuenta las horas del motor.'
    },
    {
      control: 'trim-wheel',
      titulo: 'El compensador',
      texto: 'La rueda vertical abajo en el centro, con su indicador a la izquierda. Saca la fuerza del volante: hacia adelante es nariz abajo, hacia atrás nariz arriba. Para despegar va en TAKE OFF.'
    },
    {
      control: 'flap-switch',
      titulo: 'Los flaps',
      texto: 'La palanquita WING FLAPS: DOWN se mantiene apretado para bajarlos, UP queda trabado y los sube del todo. Cuánto bajaron lo ves en la escala del parante izquierdo del parabrisas. Nunca arriba de 85 nudos.'
    },
    {
      control: 'asi',
      titulo: 'El velocímetro',
      texto: 'Arriba a la izquierda. Te dice la velocidad respecto del aire, en nudos. Aprendé los colores: blanco para flaps, verde normal, amarillo sólo con aire calmo y raya roja para no pasarla nunca (141 nudos).'
    },
    {
      control: 'attitude',
      titulo: 'El horizonte artificial',
      texto: 'Arriba, frente a vos, un poco a la izquierda de la columna del volante. El avioncito contra la línea del horizonte te muestra la nariz y la inclinación de las alas. Es una ventanita al horizonte real: cuando hay visibilidad, mirá el de afuera.'
    },
    {
      control: 'altimeter',
      titulo: 'El altímetro',
      texto: 'Arriba, a la derecha del horizonte. La aguja larga marca centenas de pies y la corta miles; el error clásico es leer mal la corta. Con la perilla le ponés el QNH.'
    },
    {
      control: 'vsi',
      titulo: 'El variómetro',
      texto: 'Debajo del altímetro. Te dice si subís o bajás y a cuántos pies por minuto. Tarda unos segundos en estabilizarse, así que no lo persigas: primero la actitud, después mirás qué dice.'
    },
    {
      control: 'turn-coordinator',
      titulo: 'El coordinador de giro',
      texto: 'Abajo a la izquierda del horizonte. El avioncito te dice cuánto estás virando y la bolita si vas coordinado. Si la bolita se corre, pisá el pedal de ese lado.'
    },
    {
      control: 'heading-indicator',
      titulo: 'El direccional',
      texto: 'Debajo del horizonte. Muestra el rumbo sin bambolearse como la brújula, pero no sabe dónde está el norte. Antes de despegar lo alineás con la brújula usando su perilla, y lo revisás cada tanto en vuelo.'
    },
    {
      control: 'compass',
      titulo: 'La brújula',
      texto: 'Arriba, en el centro del parabrisas. No necesita electricidad ni vacío. Sólo se lee bien con el avión derecho y sin acelerar; en virajes y cambios de velocidad se equivoca.'
    },
    {
      control: 'stall-warning',
      titulo: 'La bocina de pérdida',
      texto: 'Cerca de la esquina de arriba a la izquierda del parabrisas. Suena 5 a 10 nudos antes de la pérdida y no necesita electricidad. Si la escuchás sin buscarla: nariz un poco abajo y potencia.'
    }
  ];

  // ═══════════════════════════════════════ CHECKLISTS ═══════════════════════════════════════
  // Basadas en el POH del 150M (1977, igual que el 1976 en estos puntos). Textos en estilo
  // checklist ("Ítem — ACCIÓN"); detalle = el porqué, para un alumno que empieza.

  C150.DATA.checklists = [
    {
      id: 'antes-arrancar',
      titulo: 'Antes de arrancar',
      descripcion: 'Lo que hacés sentado en la cabina, con la inspección de afuera ya terminada, antes de tocar la llave.',
      preset: 'parked',
      items: [
        {
          control: 'control-lock',
          texto: 'Traba de comandos — SACAR',
          detalle: 'Es la varilla con bandera roja que traba el volante. Si queda puesta no podés mover los comandos: intentar despegar así termina en accidente.',
          check: function (s) { return s.controlLock === false; }
        },
        {
          control: 'seats',
          texto: 'Asientos — AJUSTADOS y TRABADOS',
          detalle: 'Tenés que llegar a fondo con los pedales. Empujá atrás y adelante para comprobar la traba: si el asiento se corre al rotar, te alejás de los pedales y del acelerador.',
          check: null
        },
        {
          control: 'seatbelts',
          texto: 'Cinturones y arneses — PUESTOS y AJUSTADOS',
          detalle: 'Firmes pero cómodos, también los del acompañante. En turbulencia o en una frenada fuerte te mantienen en tu lugar y al alcance de los comandos.',
          check: null
        },
        {
          control: 'fuel-shutoff',
          texto: 'Válvula de combustible — ON',
          detalle: 'Los dos tanques alimentan juntos por gravedad a través de esta única válvula. En OFF, el motor puede arrancar con la nafta que queda en los caños y pararse un rato después, quizás en el despegue.',
          check: function (s) { return s.fuelValve === true; }
        },
        {
          control: 'navcom',
          texto: 'Radios y transpondedor — APAGADOS',
          detalle: 'Al arrancar, el motor de arranque produce picos de voltaje que pueden dañar la electrónica. Las radios se prenden con el motor ya andando.',
          check: radiosApagadas
        },
        {
          control: 'light-switches',
          texto: 'Luces y equipos eléctricos — APAGADOS',
          detalle: 'Así la batería entera queda para el arranque. La luz anticolisión (BCN) se prende en el paso siguiente, justo antes de arrancar.',
          check: lucesApagadas
        },
        {
          control: 'parking-brake',
          texto: 'Frenos — PROBAR y PONER el de estacionamiento',
          detalle: 'Apretá las puntas de los pedales y sentí que frenan firme. Dejá puesto el freno de estacionamiento para que el avión no se mueva cuando arranque el motor.',
          check: function (s) { return s.parkingBrake === true; }
        },
        {
          control: 'circuit-breakers',
          texto: 'Disyuntores — VERIFICAR (todos adentro)',
          detalle: 'Cada disyuntor protege un circuito. Si uno está salido (botón afuera), ese equipo no tiene corriente y conviene saber por qué antes de volar.',
          check: null
        }
      ]
    },

    {
      id: 'arranque',
      titulo: 'Arranque',
      descripcion: 'La secuencia para poner el motor en marcha. Seguí cada ítem en orden y mirá la presión de aceite apenas arranca.',
      preset: 'parked',
      continuaDe: 'antes-arrancar',
      items: [
        {
          control: 'mixture',
          texto: 'Mezcla — RICA (toda adentro)',
          detalle: 'Para arrancar el motor necesita nafta: con la mezcla en corte no arranca nunca. Apretá el botón de la perilla roja y empujala a fondo.',
          check: function (s) { return s.mixture > 0.9; }
        },
        {
          control: 'carb-heat',
          texto: 'Calefacción del carburador — FRÍA (adentro)',
          detalle: 'En tierra el aire caliente entra sin filtro y puede meter tierra en el motor. Además, con aire frío el motor rinde más.',
          check: function (s) { return s.carbHeat < 0.1; }
        },
        {
          control: 'master',
          texto: 'Master — ON (ALT y BAT)',
          detalle: 'Da electricidad al motor de arranque y a los instrumentos eléctricos. Los magnetos no la necesitan, pero el arranque sí.',
          check: function (s) { return s.masterBat === true && s.masterAlt === true; }
        },
        {
          control: 'light-switches',
          texto: 'Luz anticolisión (BCN) — ON',
          detalle: 'La luz roja que destella arriba de la cola avisa a la gente de afuera que el motor está por arrancar o ya está en marcha.',
          check: function (s) { return s.lights.beacon === true; }
        },
        {
          control: 'primer',
          texto: 'Cebador — SEGÚN NECESIDAD (2 bombeos)',
          detalle: 'Cada bombeo tira un chorrito de nafta en la admisión. Con calor alcanzan 1 o 2; con frío, hasta 6. De más, ahogás el motor.',
          check: function (s) { return s.engine.primeCharges >= 2 || s.engine.running; }
        },
        {
          control: 'primer',
          texto: 'Cebador — ADENTRO y TRABADO',
          detalle: 'Empujalo a fondo y giralo hasta que no salga. Un cebador destrabado puede chupar nafta de más y hacer que el motor ande áspero.',
          check: function (s) { return s.primerLocked === true; }
        },
        {
          control: 'throttle',
          texto: 'Acelerador — ABIERTO 1/4 de pulgada (unos 6 mm)',
          detalle: 'Apenas un poquito abierto desde el ralentí, para que el motor respire al arrancar sin subir de golpe a muchas RPM.',
          check: function (s) { return entre(s.throttle, 0.05, 0.25); }
        },
        {
          control: 'doors',
          texto: 'Área de la hélice — LIBRE («¡Libre la hélice!»)',
          detalle: 'Abrí la ventanilla, mirá bien alrededor y gritá «¡Libre la hélice!». Esperá un segundo por si alguien responde. Una hélice girando no se ve y puede matar.',
          check: null
        },
        {
          control: 'ignition',
          texto: 'Llave de encendido — START (soltar cuando arranca)',
          detalle: 'Girá la llave a START y soltala apenas el motor arranca: vuelve sola a BOTH. No mantengas el arranque más de unos segundos seguidos.',
          check: function (s) { return s.engine.running === true; }
        },
        {
          control: 'oil-gauges',
          texto: 'Presión de aceite — VERIFICAR (en menos de 30 s)',
          detalle: 'Si la presión no sube en 30 segundos (60 con mucho frío), apagá el motor: está girando sin lubricación.',
          check: function (s) { return s.engine.running && s.engine.oilPressPsi >= limites(s).oilPressMin; }
        },
        {
          control: 'throttle',
          texto: 'Acelerador — 1000 RPM',
          detalle: 'A unas 1000 RPM el motor se calienta parejo y la batería se empieza a cargar. Mirá el tacómetro mientras ajustás.',
          check: function (s) { return s.engine.running && entre(s.engine.rpm, 900, 1200); }
        },
        {
          control: 'navcom',
          texto: 'Radios — ON',
          detalle: 'Ahora que el motor anda y pasaron los picos del arranque, prendé la radio para escuchar la torre o la frecuencia del aeródromo.',
          check: function (s) { return s.radio.comOn === true; }
        }
      ]
    },

    {
      id: 'prueba-motor',
      titulo: 'Prueba de motor (antes de despegar)',
      descripcion: 'En el punto de espera, con el avión frenado y apuntando al viento: revisás comandos, instrumentos y que el motor esté sano antes de despegar.',
      preset: 'runup',
      items: [
        {
          control: 'doors',
          texto: 'Puertas — CERRADAS y TRABADAS',
          detalle: 'Una puerta que se abre en vuelo hace mucho ruido pero no es grave; igual, es mejor que no pase en el despegue.',
          check: function (s) { return !s.doorLeftOpen && !s.doorRightOpen; }
        },
        {
          control: 'parking-brake',
          texto: 'Freno de estacionamiento — PUESTO',
          detalle: 'Vas a acelerar a 1700 RPM: el avión tiene que quedarse quieto. Igual, apoyá los pies en los frenos.',
          check: function (s) { return s.parkingBrake === true; }
        },
        {
          control: 'yoke',
          texto: 'Comandos de vuelo — LIBRES y CORRECTOS',
          detalle: 'Llevá el volante a fondo para todos lados mirando afuera: volante a la izquierda, alerón izquierdo arriba; tirar, profundidad arriba. Libres y para el lado correcto.',
          check: null
        },
        {
          control: 'altimeter',
          texto: 'Instrumentos de vuelo — AJUSTADOS',
          detalle: 'Altímetro con el QNH, la presión del día que te da la torre (en tierra tiene que marcar la elevación del aeródromo), y direccional alineado con la brújula.',
          check: null
        },
        {
          control: 'fuel-shutoff',
          texto: 'Válvula de combustible — ON',
          detalle: 'Se revisa otra vez: un motor que arranca con la válvula cerrada puede andar un rato y pararse justo en el despegue.',
          check: function (s) { return s.fuelValve === true; }
        },
        {
          control: 'mixture',
          texto: 'Mezcla — RICA',
          detalle: 'Debajo de 5000 pies, que en Uruguay es siempre, se despega con la mezcla toda adentro.',
          check: function (s) { return s.mixture > 0.9; }
        },
        {
          control: 'trim-wheel',
          texto: 'Compensador — TAKE OFF',
          detalle: 'Con el trim en la marca de despegue, la fuerza para rotar es la normal y el avión no levanta la nariz de golpe.',
          check: function (s) { return Math.abs(s.trim) < 0.15; }
        },
        {
          control: 'throttle',
          texto: 'Acelerador — 1700 RPM',
          detalle: 'Es la potencia a la que el POH (el manual del avión) pide hacer las pruebas. Mirá el tacómetro y sostené los frenos.',
          check: function (s) { return s.engine.running && entre(s.engine.rpm, 1600, 1800); }
        },
        {
          control: 'ignition',
          texto: 'Magnetos — R (caída máx. 150 RPM)',
          detalle: 'En R anda sólo con el magneto derecho: las RPM bajan un poco. Más de 150 de caída es un problema; que no bajen nada también es sospechoso.',
          check: function (s) { return s.ignition === 'R' && s.engine.running; }
        },
        {
          control: 'ignition',
          texto: 'Magnetos — BOTH',
          detalle: 'De vuelta en ambos, las RPM vuelven a 1700. Esperá que se estabilicen antes de probar el otro.',
          check: function (s) { return s.ignition === 'BOTH' && s.engine.running && s.engine.rpm >= 1550; }
        },
        {
          control: 'ignition',
          texto: 'Magnetos — L (caída máx. 150, diferencia máx. 75)',
          detalle: 'Ahora sólo el izquierdo. Además de no caer más de 150 RPM, la diferencia con la caída del derecho no puede pasar de 75.',
          check: function (s) { return s.ignition === 'L' && s.engine.running; }
        },
        {
          control: 'ignition',
          texto: 'Magnetos — BOTH',
          detalle: 'Se vuela siempre en BOTH: dos bujías por cilindro queman mejor y, si un magneto falla, el otro sigue.',
          check: function (s) { return s.ignition === 'BOTH' && s.engine.running && s.engine.rpm >= 1550; }
        },
        {
          control: 'carb-heat',
          texto: 'Calefacción del carburador — TIRAR (verificar caída de RPM)',
          detalle: 'Con aire caliente el motor pierde un poco de potencia: si las RPM bajan, el sistema funciona. Si bajan y después suben, había hielo.',
          check: function (s) { return s.carbHeat > 0.9 && s.engine.running; }
        },
        {
          control: 'carb-heat',
          texto: 'Calefacción del carburador — FRÍA (adentro)',
          detalle: 'Para despegar necesitás toda la potencia: la calefacción va adentro.',
          check: function (s) { return s.carbHeat < 0.1; }
        },
        {
          control: 'oil-gauges',
          texto: 'Instrumentos del motor y amperímetro — VERIFICAR (en verde)',
          detalle: 'Presión y temperatura de aceite en el arco verde, y el amperímetro sin descargar (el alternador está cargando).',
          check: motorEnVerde
        },
        {
          control: 'suction',
          texto: 'Succión — 4,6 a 5,4 inHg',
          detalle: 'Si la succión está fuera de ese rango, el horizonte artificial y el direccional no son confiables.',
          check: succionOk
        },
        {
          control: 'throttle',
          texto: 'Acelerador — RALENTÍ (verificar que no se pare)',
          detalle: 'Llevalo todo afuera: el motor tiene que seguir andando parejo. Si se para en ralentí, mejor descubrirlo acá que aterrizando.',
          check: function (s) { return s.throttle <= 0.05 && s.engine.running; }
        },
        {
          control: 'flap-switch',
          texto: 'Flaps — 0° (ARRIBA)',
          detalle: 'Para un despegue normal, flaps arriba. Mirá el indicador en el parante izquierdo del parabrisas.',
          check: function (s) { return s.flaps < 1; }
        },
        {
          control: 'navcom',
          texto: 'Radios y transpondedor — AJUSTADOS',
          detalle: 'Frecuencia de la torre o del aeródromo y el transpondedor en el código que te den el control o tu instructor.',
          check: null
        }
      ]
    },

    {
      id: 'antes-aterrizar',
      titulo: 'Antes de aterrizar',
      descripcion: 'En la aproximación, antes de sacar potencia: preparás el motor y el avión para bajar despacio y con margen.',
      preset: 'approach',
      items: [
        {
          control: 'seatbelts',
          texto: 'Asientos y cinturones — AJUSTADOS y TRABADOS',
          detalle: 'Una última revisión: en el aterrizaje no querés que nada se mueva.',
          check: null
        },
        {
          control: 'mixture',
          texto: 'Mezcla — RICA',
          detalle: 'Por si tenés que arremeter (motor y al aire): con mezcla rica el motor da toda la potencia sin dudar.',
          check: function (s) { return s.mixture > 0.9; }
        },
        {
          control: 'carb-heat',
          texto: 'Calefacción del carburador — ON (antes de sacar potencia)',
          detalle: 'Con poca potencia es cuando más hielo se forma. Se tira toda la calefacción ANTES de reducir, no después.',
          check: function (s) { return s.carbHeat > 0.9; }
        },
        {
          control: 'flap-switch',
          texto: 'Flaps — SEGÚN NECESIDAD (debajo de 85 kt)',
          detalle: 'Bajalos de a poco (por ejemplo, 10° y después 20°) siempre por debajo de 85 nudos. Vas a sentir que la nariz quiere subir: sostené y recompensá.',
          check: function (s) { return s.flaps >= 10; }
        },
        {
          control: 'asi',
          texto: 'Velocidad — 50 a 60 kt con flaps',
          detalle: 'Es la velocidad de aproximación del POH con flaps abajo (sin flaps, 60 a 70). Más lento te acercás a la pérdida; más rápido, flotás y te comés la pista.',
          check: function (s) { return s.flaps >= 10 && entre(s.air.ias, 50, 60); }
        }
      ]
    },

    {
      id: 'apagado',
      titulo: 'Apagado y asegurar el avión',
      descripcion: 'Después de carretear hasta la plataforma: apagás el motor en orden y dejás el avión seguro. (En el simulador arrancás con el motor en marcha en el punto de espera; hacé de cuenta que ya llegaste a la plataforma.)',
      preset: 'runup',
      items: [
        {
          control: 'parking-brake',
          texto: 'Freno de estacionamiento — PUESTO',
          detalle: 'Que el avión no se mueva mientras apagás y bajás.',
          check: function (s) { return s.parkingBrake === true; }
        },
        {
          control: 'navcom',
          texto: 'Radios y transpondedor — APAGADOS',
          detalle: 'Se apagan antes de cortar el motor para que no reciban picos de voltaje.',
          check: radiosApagadas
        },
        {
          control: 'light-switches',
          texto: 'Luces y equipos eléctricos — APAGADOS',
          detalle: 'Todo lo que quede prendido sigue gastando batería después de que paraste el motor.',
          check: lucesApagadas
        },
        {
          control: 'mixture',
          texto: 'Mezcla — CORTE (toda afuera) → el motor se para',
          detalle: 'Así se apaga el 150: se corta la nafta y el motor se para solo, sin dejar nafta en los cilindros. Esperá a que la hélice se detenga.',
          check: function (s) { return s.mixture < 0.05 && !s.engine.running; }
        },
        {
          control: 'ignition',
          texto: 'Llave de encendido — OFF',
          detalle: 'Desconecta los magnetos. Aun así, tratá siempre a la hélice como si pudiera arrancar.',
          check: function (s) { return s.ignition === 'OFF'; }
        },
        {
          control: 'master',
          texto: 'Master — OFF',
          detalle: 'Si queda prendido, la batería se descarga y el próximo alumno no va a poder arrancar.',
          check: function (s) { return !s.masterBat && !s.masterAlt; }
        },
        {
          control: 'control-lock',
          texto: 'Traba de comandos — PUESTA',
          detalle: 'Evita que el viento golpee los alerones y el timón de profundidad contra sus topes mientras el avión está estacionado.',
          check: function (s) { return s.controlLock === true; }
        }
      ]
    }
  ];

  // ═══════════════════════════════════════ QUIZ ═══════════════════════════════════════

  C150.DATA.quiz = [
    // ── ¿Dónde está? (el alumno lo toca en la cabina 3D) ──
    { tipo: 'donde', control: 'mixture', pregunta: '¿Dónde está la mezcla (MIXTURE)?', explicacion: 'Es la perilla roja del centro, a la derecha del acelerador.' },
    { tipo: 'donde', control: 'throttle', pregunta: '¿Dónde está el acelerador (THROTTLE)?', explicacion: 'Es la perilla negra grande, abajo en el centro del panel.' },
    { tipo: 'donde', control: 'carb-heat', pregunta: '¿Dónde está la calefacción del carburador (CARB HEAT)?', explicacion: 'Es la perilla a la izquierda del acelerador.' },
    { tipo: 'donde', control: 'yoke', pregunta: '¿Dónde está el volante de mando?', explicacion: 'Frente a tu asiento: girarlo inclina el avión y tirarlo sube la nariz.' },
    { tipo: 'donde', control: 'rudder-pedals', pregunta: '¿Dónde están los pedales que mueven el timón de dirección?', explicacion: 'En el piso, adelante de tus pies.' },
    { tipo: 'donde', control: 'primer', pregunta: '¿Dónde está el cebador (PRIMER)?', explicacion: 'Es el émbolo cromado en la parte de abajo a la izquierda del panel.' },
    { tipo: 'donde', control: 'ignition', pregunta: '¿Dónde está la llave de encendido?', explicacion: 'Abajo a la izquierda, al lado del master.' },
    { tipo: 'donde', control: 'master', pregunta: '¿Dónde está el master (ALT/BAT)?', explicacion: 'Es el interruptor rojo partido, abajo a la izquierda.' },
    { tipo: 'donde', control: 'fuel-shutoff', pregunta: '¿Dónde está la válvula de corte de combustible?', explicacion: 'En el piso, entre los dos asientos.' },
    { tipo: 'donde', control: 'parking-brake', pregunta: '¿Dónde está el freno de estacionamiento (PARK BRAKE)?', explicacion: 'Es la perilla cromada abajo, a la izquierda de todo.' },
    { tipo: 'donde', control: 'trim-wheel', pregunta: '¿Dónde está la rueda del compensador?', explicacion: 'Es la rueda vertical abajo en el centro del panel, con su indicador a la izquierda.' },
    { tipo: 'donde', control: 'flap-switch', pregunta: '¿Dónde está el interruptor de flaps?', explicacion: 'Es la palanquita WING FLAPS a la derecha de los comandos del motor.' },
    { tipo: 'donde', control: 'flap-indicator', pregunta: '¿Dónde ves cuántos grados de flaps tenés?', explicacion: 'En la escala del parante izquierdo del parabrisas, junto a tu puerta.' },
    { tipo: 'donde', control: 'asi', pregunta: '¿Dónde está el velocímetro?', explicacion: 'Arriba a la izquierda del panel, el primero de la fila.' },
    { tipo: 'donde', control: 'attitude', pregunta: '¿Dónde está el horizonte artificial?', explicacion: 'Arriba en el centro de tu lado del panel, frente a vos.' },
    { tipo: 'donde', control: 'altimeter', pregunta: '¿Dónde está el altímetro?', explicacion: 'Arriba, a la derecha del horizonte artificial.' },
    { tipo: 'donde', control: 'turn-coordinator', pregunta: '¿Dónde está el coordinador de giro con la bolita?', explicacion: 'Abajo a la izquierda del horizonte, debajo del velocímetro.' },
    { tipo: 'donde', control: 'heading-indicator', pregunta: '¿Dónde está el direccional (indicador de rumbo)?', explicacion: 'Justo debajo del horizonte artificial.' },
    { tipo: 'donde', control: 'tachometer', pregunta: '¿Dónde está el tacómetro (RPM)?', explicacion: 'En el panel, a la derecha de la radio.' },
    { tipo: 'donde', control: 'oil-gauges', pregunta: '¿Dónde ves la presión de aceite?', explicacion: 'Abajo a la izquierda del panel, al lado de los indicadores de combustible.' },

    // ── Opciones múltiples ──
    {
      tipo: 'opciones',
      pregunta: 'Girás el volante a la izquierda. ¿Qué hacen los alerones?',
      opciones: ['El izquierdo sube y el derecho baja', 'Los dos suben', 'El izquierdo baja y el derecho sube', 'No se mueven: se mueve el timón de dirección'],
      correcta: 0,
      explicacion: 'El alerón izquierdo sube (esa ala pierde sustentación) y el derecho baja (esa ala gana): el avión se inclina a la izquierda.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Tirás del volante hacia vos. ¿Qué pasa?',
      opciones: ['La nariz baja', 'El timón de profundidad sube y la nariz sube', 'El avión vira a la derecha', 'Aumenta la potencia del motor'],
      correcta: 1,
      explicacion: 'Al tirar, el timón de profundidad sube, la cola baja y la nariz sube: aumentás el ángulo de ataque.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Estás carreteando. ¿Con qué doblás el avión?',
      opciones: ['Con el volante, como un auto', 'Con el compensador', 'Con los pedales y, para doblar cerrado, el freno de ese lado', 'Con el acelerador'],
      correcta: 2,
      explicacion: 'Los pedales mueven la rueda de nariz (unos 8,5°); sumando el freno de ese lado llegás hasta 30°. El volante no dobla en tierra.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Qué es una pérdida (stall)?',
      opciones: ['Cuando el motor se para en vuelo', 'Cuando el ala pasa su ángulo de ataque crítico y la sustentación cae', 'Cuando te quedás sin combustible', 'Cuando volás más lento de 60 nudos'],
      correcta: 1,
      explicacion: 'La pérdida es del ala, no del motor: pasa cuando el ángulo de ataque supera el crítico, a cualquier velocidad.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Suena la bocina y el avión entra en pérdida. ¿Qué es lo PRIMERO que hacés?',
      opciones: ['Tirar más fuerte del volante', 'Bajar los flaps', 'Empujar el volante para bajar la nariz', 'Poner la mezcla en corte'],
      correcta: 2,
      explicacion: 'Primero bajás la nariz para reducir el ángulo de ataque; después potencia máxima, alas niveladas y pedal para que no guiñe.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Cuál es la velocidad máxima con flaps abajo (Vfe) del 150M?',
      opciones: ['68 nudos', '85 nudos', '107 nudos', '141 nudos'],
      correcta: 1,
      explicacion: 'Vfe = 85 nudos, la punta de arriba del arco blanco. Con más velocidad podés dañar los flaps.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Dónde está la raya roja (Vne, nunca exceder) del velocímetro del 150M?',
      opciones: ['107 nudos', '120 nudos', '141 nudos', '97 nudos'],
      correcta: 2,
      explicacion: 'Vne = 141 nudos. En el A150M Aerobat es distinta (164): siempre manda el manual de tu avión.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿A qué velocidad subís más rápido (Vy, mejor régimen de ascenso) a nivel del mar?',
      opciones: ['56 nudos', '85 nudos', '47 nudos', '68 nudos'],
      correcta: 3,
      explicacion: 'Vy = 68 nudos a nivel del mar. Vx (mejor ángulo, para pasar un obstáculo) es 56.'
    },
    {
      tipo: 'opciones',
      pregunta: 'En la prueba de motor, ¿a cuántas RPM probás los magnetos y cuál es la caída máxima?',
      opciones: ['1000 RPM, caída máx. 300', '1700 RPM, caída máx. 150 y 75 de diferencia entre ellos', '2500 RPM, caída máx. 50', '1700 RPM, no tiene que bajar nada'],
      correcta: 1,
      explicacion: 'A 1700 RPM: cada magneto puede bajar hasta 150 RPM y la diferencia entre los dos no puede pasar de 75. Que no baje nada también es sospechoso.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Arrancaste el motor y la presión de aceite no sube. ¿Cuánto esperás?',
      opciones: ['Hasta 30 segundos; si no sube, apagás', '5 minutos, hasta que caliente', 'No importa mientras ande', 'Acelerás a 2000 RPM para que suba'],
      correcta: 0,
      explicacion: 'El POH dice: si no hay presión en 30 segundos (60 con mucho frío), apagá el motor.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Cómo se apaga normalmente el motor del Cessna 150?',
      opciones: ['Con el master en OFF', 'Sacando el acelerador todo afuera', 'Con la mezcla en corte (toda afuera) y después la llave en OFF', 'Cerrando la válvula de combustible'],
      correcta: 2,
      explicacion: 'La mezcla en corte deja al motor sin nafta y se para limpio; después llave OFF y master OFF.'
    },
    {
      tipo: 'opciones',
      pregunta: 'En vuelo apagás el master. ¿Qué pasa con el motor?',
      opciones: ['Se para al instante', 'Sigue andando: los magnetos no dependen de la batería', 'Se apaga uno de los magnetos', 'Pierde la mitad de la potencia'],
      correcta: 1,
      explicacion: 'Los magnetos son generadores propios del motor. Sin master perdés radios, flaps, luces y algunos instrumentos, pero el motor sigue.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Qué instrumentos funcionan con el sistema de vacío?',
      opciones: ['El horizonte artificial y el direccional', 'El velocímetro y el altímetro', 'El coordinador de giro', 'El tacómetro y la presión de aceite'],
      correcta: 0,
      explicacion: 'La bomba de vacío hace girar los giróscopos del horizonte y del direccional. Controlalo con el indicador de succión (4,6 a 5,4 inHg).'
    },
    {
      tipo: 'opciones',
      pregunta: 'Se tapa la toma estática. ¿Qué instrumentos te pueden mentir?',
      opciones: ['Sólo el velocímetro', 'El horizonte artificial y el direccional', 'El velocímetro, el altímetro y el variómetro', 'Ninguno'],
      correcta: 2,
      explicacion: 'Los tres usan la presión estática. Si se tapa sólo el pitot, falla sólo el velocímetro.'
    },
    {
      tipo: 'opciones',
      pregunta: 'En un viraje la bolita del coordinador está corrida a la derecha. ¿Qué hacés?',
      opciones: ['Más pedal izquierdo', 'Más pedal derecho («pisá la bolita»)', 'Más volante a la derecha', 'Sacar potencia'],
      correcta: 1,
      explicacion: 'Se pisa el pedal del lado hacia donde está la bolita, hasta que vuelva al centro.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Por qué en el despegue y el ascenso necesitás pie derecho?',
      opciones: ['Porque el viento siempre viene de la izquierda', 'Porque el avión está mal compensado', 'Por las tendencias a la izquierda de la hélice: factor P, estela y torque', 'Por la guiñada adversa de los flaps'],
      correcta: 2,
      explicacion: 'Con mucha potencia y poca velocidad, la hélice tira la nariz a la izquierda. Se corrige con pedal derecho.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Volás en crucero, sin tocar nada, y las RPM bajan de a poco. ¿Qué es lo más probable?',
      opciones: ['Hielo en el carburador: calefacción toda afuera', 'Que el altímetro está mal ajustado', 'Que la batería se está descargando', 'Que los flaps bajaron solos'],
      correcta: 0,
      explicacion: 'Una baja de RPM sin explicación es el síntoma típico. Calefacción toda afuera; si el motor tose, es el hielo derritiéndose: dejala.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Cuándo tirás la calefacción del carburador para aterrizar?',
      opciones: ['Después de aterrizar', 'Sólo si afuera hace menos de 0 °C', 'Antes de sacar potencia', 'Nunca, porque hace perder potencia'],
      correcta: 2,
      explicacion: 'Con poca potencia se forma más hielo y el motor genera menos calor: por eso va ANTES de reducir.'
    },
    {
      tipo: 'opciones',
      pregunta: 'La torre te da QNH 1013. ¿Qué ponés en una ventanilla de pulgadas de mercurio?',
      opciones: ['30,13 inHg', '28,92 inHg', '31,00 inHg', '29,92 inHg'],
      correcta: 3,
      explicacion: '1013 hPa = 29,92 inHg, la presión estándar. Cada hPa son unos 30 pies.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Girás la rueda del compensador hacia adelante. ¿Qué pasa?',
      opciones: ['La nariz tiende a bajar', 'La nariz tiende a subir', 'El avión se inclina a la derecha', 'Bajan los flaps'],
      correcta: 0,
      explicacion: 'Rueda hacia adelante = nariz abajo; hacia atrás = nariz arriba. En el simulador: T y G.'
    },
    {
      tipo: 'opciones',
      pregunta: 'En Uruguay (hemisferio sur), volando con rumbo este, acelerás. ¿Qué hace la brújula por un momento?',
      opciones: ['Parece virar hacia el sur', 'Parece virar hacia el norte', 'No se mueve', 'Gira 180°'],
      correcta: 0,
      explicacion: 'En el hemisferio sur: acelerando parece virar al Sur, desacelerando al Norte (SAND). Las reglas de los libros de EE.UU. son al revés.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Con cuántos grados de flaps se hace un despegue normal en el 150M?',
      opciones: ['20°', '30°', '40°', '0°'],
      correcta: 3,
      explicacion: 'Despegue normal con 0°. 10° sólo en pista blanda o corta; más de 10° no está aprobado para despegar.'
    },
    {
      tipo: 'opciones',
      pregunta: '¿Qué significa el arco verde del velocímetro (47 a 107 nudos)?',
      opciones: ['Velocidades para usar flaps', 'Operación normal', 'Sólo con aire calmo', 'Velocidades prohibidas'],
      correcta: 1,
      explicacion: 'Verde = normal. Abajo empieza en la pérdida sin flaps (47) y arriba termina en Vno (107); de ahí al rojo es el arco amarillo.'
    },
    {
      tipo: 'opciones',
      pregunta: 'El avioncito del coordinador de giro está sobre la marca L. ¿Qué te dice?',
      opciones: ['Que estás inclinado 30° exactos', 'Que estás virando a 3° por segundo (viraje estándar)', 'Que la nariz está arriba', 'Que el motor anda en el magneto izquierdo'],
      correcta: 1,
      explicacion: 'Muestra el ritmo de viraje: en la marca, 3° por segundo, una vuelta en 2 minutos. No muestra la nariz arriba o abajo.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Se te para el motor en vuelo. ¿A qué velocidad planeás para llegar más lejos?',
      opciones: ['47 nudos', '85 nudos', '107 nudos', '60 nudos'],
      correcta: 3,
      explicacion: 'Mejor planeo: 60 nudos con flaps arriba. Más lento o más rápido, llegás menos lejos.'
    },
    {
      tipo: 'opciones',
      pregunta: 'La variación magnética en Uruguay es de unos 12° W. Si el rumbo verdadero es 090, ¿qué rumbo magnético volás?',
      opciones: ['078', '090', '102', '012'],
      correcta: 2,
      explicacion: 'Con variación oeste se suma: magnético = verdadero + 12° → 102.'
    },
    {
      tipo: 'opciones',
      pregunta: 'Arremetés (motor y al aire) con 40° de flaps. ¿Qué hacés con los flaps?',
      opciones: ['Los dejás en 40° hasta llegar a 1000 pies', 'Los subís todos de golpe', 'Los subís a 20° enseguida y después de a poco', 'Los bajás más'],
      correcta: 2,
      explicacion: 'POH: potencia máxima, calefacción fría, flaps a 20° de inmediato y 55 nudos; el resto, de a poco y con margen.'
    }
  ];

  // ═══════════════════════════════════════ GLOSARIO ═══════════════════════════════════════

  C150.DATA.glossary = [
    { termino: 'Actitud', ingles: 'Attitude', definicion: 'Dónde está la nariz respecto del horizonte y cuánto están inclinadas las alas. Actitud más potencia te dan la performance.' },
    { termino: 'Alabeo', ingles: 'Roll', definicion: 'Inclinar las alas, girando alrededor del eje que va de la nariz a la cola. Se hace girando el volante (alerones).' },
    { termino: 'Alerón', ingles: 'Aileron', definicion: 'Superficie móvil cerca de la punta de cada ala, en el borde de atrás. Uno sube y el otro baja para inclinar el avión.' },
    { termino: 'Altímetro', ingles: 'Altimeter', definicion: 'Barómetro que muestra la altura en pies. Hay que ajustarle el QNH para que marque bien.' },
    { termino: 'Ángulo de ataque', ingles: 'Angle of attack (AOA)', definicion: 'Ángulo entre la cuerda del ala y el viento relativo. Lo manejás con el volante: tirar lo aumenta, empujar lo baja.' },
    { termino: 'Arremetida', ingles: 'Go-around', definicion: 'Abandonar el aterrizaje y volver a subir: potencia máxima, calefacción fría, flaps a 20° y 55 nudos. También "motor y al aire".' },
    { termino: 'Borde de ataque', ingles: 'Leading edge', definicion: 'El borde de adelante del ala, redondeado, que es el primero en tocar el aire.' },
    { termino: 'Borde de fuga', ingles: 'Trailing edge', definicion: 'El borde de atrás del ala, finito. Ahí están los alerones y los flaps.' },
    { termino: 'Cabeceo', ingles: 'Pitch', definicion: 'Subir o bajar la nariz, girando alrededor del eje que va de punta a punta de las alas. Se hace tirando o empujando el volante.' },
    { termino: 'Cabecera', ingles: 'Runway threshold', definicion: 'El comienzo de la pista, donde están pintados los números (por ejemplo 06 o 24).' },
    { termino: 'Calefacción del carburador', ingles: 'Carburetor heat (carb heat)', definicion: 'Perilla que le da al motor aire caliente (de alrededor del escape) para evitar o derretir el hielo en el carburador.' },
    { termino: 'Carburador', ingles: 'Carburetor', definicion: 'Pieza debajo del motor que mezcla la nafta con el aire antes de que entre a los cilindros.' },
    { termino: 'Carreteo', ingles: 'Taxi', definicion: 'Mover el avión por tierra con su propio motor. En Uruguay también se dice rodaje o rodar.' },
    { termino: 'Cebador', ingles: 'Primer', definicion: 'Bombita manual que tira un poco de nafta en la admisión para facilitar el arranque. Al terminar va adentro y trabado.' },
    { termino: 'Centro de gravedad', ingles: 'Center of gravity (CG)', definicion: 'Punto donde el avión quedaría en equilibrio si lo colgaras. Tiene que estar dentro de los límites del POH: depende de cuánto pesan ustedes, la nafta y el equipaje.' },
    { termino: 'Checklist', ingles: 'Checklist', definicion: 'Lista de control que se sigue paso a paso para no olvidarse de nada. Se usa siempre, aunque te la sepas de memoria.' },
    { termino: 'Compensador', ingles: 'Trim', definicion: 'Rueda que mueve una aleta en el timón de profundidad para sacarte la fuerza del volante. El avión compensado mantiene una velocidad.' },
    { termino: 'Coordinador de giro', ingles: 'Turn coordinator', definicion: 'Instrumento eléctrico que muestra el ritmo de viraje, con una bolita abajo que te dice si vas coordinado.' },
    { termino: 'Cuerda', ingles: 'Chord', definicion: 'Línea recta imaginaria que une el borde de ataque con el borde de fuga del ala.' },
    { termino: 'Derrape', ingles: 'Skid', definicion: 'Viraje con demasiado pedal: la cola se va hacia afuera y la bolita también se corre hacia afuera del viraje.' },
    { termino: 'Desviación', ingles: 'Compass deviation', definicion: 'Error de la brújula causado por los metales y la electricidad del propio avión. La corrección está en una tarjetita junto a la brújula.' },
    { termino: 'Direccional', ingles: 'Heading indicator (directional gyro)', definicion: 'Instrumento con giróscopo que muestra el rumbo sin bambolearse. Se alinea con la brújula antes de despegar y cada tanto en vuelo.' },
    { termino: 'Disyuntor', ingles: 'Circuit breaker', definicion: 'Botón que corta la corriente de un circuito si hay una falla. Cuando salta, queda afuera; se repone empujándolo (también le dicen breaker).' },
    { termino: 'Empuje (tracción)', ingles: 'Thrust', definicion: 'La fuerza hacia adelante que da la hélice. Lo controlás con el acelerador.' },
    { termino: 'Factor de carga', ingles: 'Load factor', definicion: 'Cuántas veces tu peso sentís en el asiento (las "g"). En un viraje de 60° es 2: el ala tiene que sostener el doble.' },
    { termino: 'Factor P', ingles: 'P-factor', definicion: 'Con la nariz alta, la pala de la hélice que baja muerde más aire que la que sube, y la nariz se va a la izquierda. Se corrige con pie derecho.' },
    { termino: 'Flaps', ingles: 'Flaps', definicion: 'Superficies del borde de fuga del ala, cerca del fuselaje, que se bajan para tener más sustentación y resistencia y volar más lento. Formalmente, hipersustentadores.' },
    { termino: 'Giróscopo', ingles: 'Gyroscope', definicion: 'Un trompo que gira muy rápido y se queda firme en el espacio. Lo usan el horizonte artificial, el direccional y el coordinador de giro.' },
    { termino: 'Guiñada', ingles: 'Yaw', definicion: 'Mover la nariz a la izquierda o a la derecha, alrededor de un eje vertical. Se hace con los pedales.' },
    { termino: 'Guiñada adversa', ingles: 'Adverse yaw', definicion: 'Al girar el volante, la nariz se va primero para el lado contrario, por la resistencia extra del alerón que baja. Se corrige con pedal del mismo lado que el volante.' },
    { termino: 'Hielo en el carburador', ingles: 'Carburetor ice', definicion: 'Hielo que se forma dentro del carburador por el enfriamiento del aire y la nafta, aun con calor si hay humedad. Primer síntoma: bajan las RPM.' },
    { termino: 'Horizonte artificial', ingles: 'Attitude indicator', definicion: 'Instrumento con giróscopo que muestra la nariz y la inclinación del avión contra un horizonte dibujado.' },
    { termino: 'Magneto', ingles: 'Magneto', definicion: 'Generador del propio motor que hace saltar la chispa en las bujías. Hay dos (R y L) y no necesitan la batería.' },
    { termino: 'Master', ingles: 'Master switch', definicion: 'Interruptor general de la electricidad, partido en BAT (batería) y ALT (alternador). No apaga el motor.' },
    { termino: 'Mezcla', ingles: 'Mixture', definicion: 'Perilla roja que regula cuánta nafta va con el aire. Toda adentro es rica; toda afuera es corte y apaga el motor.' },
    { termino: 'Nudo', ingles: 'Knot (kt)', definicion: 'Unidad de velocidad en aviación: una milla náutica por hora, unos 1,85 km/h.' },
    { termino: 'Pérdida', ingles: 'Stall', definicion: 'Cuando el ala pasa su ángulo de ataque crítico, el aire se despega de arriba del ala y la sustentación cae. Se sale bajando la nariz.' },
    { termino: 'Peso', ingles: 'Weight', definicion: 'La fuerza que tira el avión hacia abajo. El 150M puede pesar como máximo 1600 libras (unos 726 kg) cargado.' },
    { termino: 'Pie', ingles: 'Foot (ft)', definicion: 'Unidad de altura en aviación: unos 30 cm. 1000 pies son unos 300 metros.' },
    { termino: 'Pitot', ingles: 'Pitot tube', definicion: 'Tubito debajo del ala izquierda que mira hacia adelante y recibe el aire de frente. Lo usa el velocímetro.' },
    { termino: 'POH', ingles: 'Pilot’s Operating Handbook', definicion: 'El manual del avión, con sus límites, velocidades y procedimientos. Siempre manda el POH de tu avión.' },
    { termino: 'Precesión', ingles: 'Precession (gyro drift)', definicion: 'El corrimiento lento de un giróscopo con el tiempo. Por eso el direccional se va desalineando y hay que corregirlo con la brújula.' },
    { termino: 'Prueba de motor', ingles: 'Run-up', definicion: 'Revisión del motor antes de despegar, a 1700 RPM y con el avión frenado: magnetos, calefacción del carburador, succión e instrumentos.' },
    { termino: 'QNH', ingles: 'Altimeter setting (QNH)', definicion: 'La presión que le ponés al altímetro para que marque la altura sobre el nivel del mar. En Uruguay se da en hPa: 1013 hPa = 29,92 inHg.' },
    { termino: 'Ralentí', ingles: 'Idle', definicion: 'La mínima potencia del motor, con el acelerador todo afuera.' },
    { termino: 'Redondeo', ingles: 'Flare', definicion: 'La maniobra justo antes de tocar la pista: vas levantando la nariz para que toquen primero las ruedas principales.' },
    { termino: 'Resbale', ingles: 'Slip', definicion: 'Viraje con poco pedal: el avión se cae hacia adentro del viraje y la bolita se corre hacia adentro.' },
    { termino: 'Resistencia', ingles: 'Drag', definicion: 'La fuerza del aire que frena al avión. Los flaps y la velocidad la aumentan.' },
    { termino: 'RPM', ingles: 'Revolutions per minute', definicion: 'Vueltas por minuto del motor y de la hélice. En el 150 es tu medida de potencia: verde de 2000 a 2750.' },
    { termino: 'Succión', ingles: 'Suction (vacuum)', definicion: 'El vacío que hace la bomba del motor para mover los giróscopos. Normal: 4,6 a 5,4 inHg.' },
    { termino: 'Sustentación', ingles: 'Lift', definicion: 'La fuerza hacia arriba que hace el ala al moverse por el aire. Crece con el ángulo de ataque y con el cuadrado de la velocidad.' },
    { termino: 'Timón de dirección', ingles: 'Rudder', definicion: 'La parte móvil de la cola vertical. La movés con los pedales y hace guiñar la nariz.' },
    { termino: 'Timón de profundidad', ingles: 'Elevator', definicion: 'La parte móvil de la cola horizontal. La movés tirando o empujando el volante y sube o baja la nariz.' },
    { termino: 'Tirabuzón', ingles: 'Spin', definicion: 'Pérdida en la que un ala cae antes que la otra y el avión baja girando. Empieza por una pérdida sin coordinación.' },
    { termino: 'Toma estática', ingles: 'Static port', definicion: 'Agujerito en el costado izquierdo del fuselaje, cerca de la nariz, que siente la presión del aire quieto. La usan velocímetro, altímetro y variómetro.' },
    { termino: 'Va', ingles: 'Maneuvering speed', definicion: 'Velocidad de maniobra: por debajo de ella, un movimiento brusco y a fondo de UN comando no debería dañar la estructura, porque el ala entra en pérdida antes. En el 150M, 97 nudos con 1600 lb (menos si el avión pesa menos).' },
    { termino: 'Variación magnética', ingles: 'Magnetic variation', definicion: 'Diferencia entre el norte de los mapas y el norte de la brújula. En Uruguay es de unos 12° W: rumbo magnético = verdadero + 12°.' },
    { termino: 'Variómetro', ingles: 'Vertical speed indicator (VSI)', definicion: 'Instrumento que muestra cuántos pies por minuto subís o bajás. Reacciona con unos segundos de atraso.' },
    { termino: 'Velocímetro', ingles: 'Airspeed indicator (ASI)', definicion: 'Instrumento que muestra la velocidad respecto del aire, en nudos. También se le dice anemómetro.' },
    { termino: 'Vfe', ingles: 'Maximum flap extended speed', definicion: 'Velocidad máxima con flaps abajo: 85 nudos, la punta de arriba del arco blanco.' },
    { termino: 'VFR', ingles: 'Visual Flight Rules', definicion: 'Reglas de vuelo visual: volás mirando afuera, con buena visibilidad y lejos de las nubes. Así vas a aprender.' },
    { termino: 'Viento relativo', ingles: 'Relative wind', definicion: 'El aire que el ala siente de frente por moverse, opuesto a la trayectoria del avión. No es el viento del pronóstico.' },
    { termino: 'Viraje coordinado', ingles: 'Coordinated turn', definicion: 'Viraje con volante y pedal del mismo lado y en la medida justa: la bolita queda al centro.' },
    { termino: 'Viraje estándar', ingles: 'Standard-rate turn', definicion: 'Viraje de 3° por segundo: una vuelta completa en 2 minutos. El avioncito del coordinador queda sobre la marca L o R.' },
    { termino: 'Vne', ingles: 'Never-exceed speed', definicion: 'Velocidad que nunca hay que pasar: 141 nudos, la raya roja del velocímetro (164 en el A150M Aerobat).' },
    { termino: 'Vno', ingles: 'Maximum structural cruising speed', definicion: 'Límite del arco verde: 107 nudos. Por encima, en el arco amarillo, sólo con aire calmo.' },
    { termino: 'Vs0 / Vs1', ingles: 'Stall speeds', definicion: 'Velocidades de pérdida con 1600 lb: Vs0 = 42 nudos con flaps abajo (empieza el arco blanco) y Vs1 = 47 nudos sin flaps (empieza el arco verde).' },
    { termino: 'Vx', ingles: 'Best angle of climb speed', definicion: 'Velocidad de mejor ángulo de ascenso: subís más alto en menos distancia, para pasar obstáculos. En el 150M, 56 nudos.' },
    { termino: 'Vy', ingles: 'Best rate of climb speed', definicion: 'Velocidad de mejor régimen de ascenso: subís más pies por minuto. En el 150M, 68 nudos a nivel del mar.' }
  ];

  // ═══════════════════════════════════════ MISIONES ("Volar") ═══════════════════════════════════════
  // Teclas (contrato §4, core): ←/→ volante, ↑ empujar / ↓ tirar, Z/X pedales, B frenos,
  // + / − (o PageUp/PageDown) acelerador, F mantener flaps abajo, R flaps arriba, T/G compensador
  // nariz abajo / nariz arriba, M master, 1–8 cámaras, C cambiar vista, P pausa.

  C150.DATA.missions = [
    {
      id: 'arrancar',
      titulo: 'Arrancá el motor',
      objetivo: 'Poné en marcha el motor siguiendo la secuencia del POH, desde el avión estacionado y trabado.',
      preset: 'parked',
      consejo: 'Hacelo con calma y en orden: el mismo orden de la checklist de arranque. Apenas arranca, mirá la presión de aceite.',
      pasos: [
        'Sacá la traba de comandos: la varilla con bandera roja del volante.',
        'Válvula de combustible en ON, mezcla RICA (toda adentro) y calefacción del carburador FRÍA. Master ON con la tecla M.',
        'Dale 2 bombeos al cebador y dejalo adentro y trabado. Abrí apenas el acelerador (una vez la tecla +).',
        '«¡Libre la hélice!» y llave a START hasta que el motor arranque. Después llevalo a unas 1000 RPM.'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx);
        if (!s.controlLock) d.traba = true;
        if (s.masterBat) d.master = true;
        if (s.engine.primeCharges >= 1) d.cebado = true;
        if (s.engine.running) return 1;
        var hitos = (d.traba ? 1 : 0) + (d.master ? 1 : 0) + (d.cebado ? 1 : 0);
        return hitos / 4;
      }
    },

    {
      id: 'carreteo',
      titulo: 'Carreteá hasta 10 nudos y frená',
      objetivo: 'Soltá el freno de estacionamiento, acelerá por tierra hasta 10 nudos y frená hasta parar con los frenos de pie. (En un carreteo normal se va más despacio, como una persona caminando rápido.)',
      preset: 'runup',
      consejo: 'El avión arranca frenado: primero sacá el freno de estacionamiento. En tierra se dobla con los pies (Z/X), no con el volante.',
      pasos: [
        'Sacá el freno de estacionamiento (PARK BRAKE, abajo a la izquierda): apretá los frenos y empujá la perilla adentro.',
        'Dale un poco de acelerador con + hasta que el avión empiece a moverse; mantenelo derecho con los pedales (Z/X).',
        'Mirá la velocidad sobre el suelo hasta 10 nudos. Después sacá todo el acelerador con −.',
        'Frená con B (los frenos de pie) hasta que el avión quede quieto.'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx), a = s.air;
        if (!s.parkingBrake) d.suelto = true;
        if (!d.suelto) return 0;
        d.max = Math.max(d.max || 0, a.groundSpeed);
        if (d.max >= 10) d.llego = true;
        if (!d.llego) return 0.15 + 0.55 * limitar01(d.max / 10);
        if (s.brakeL + s.brakeR > 0.5 || s.parkingBrake) d.freno = true;
        if (d.freno && a.onGround && a.groundSpeed < 0.5) return 1;
        return Math.min(0.95, 0.7 + 0.25 * limitar01(1 - a.groundSpeed / 10));
      }
    },

    {
      id: 'despegue',
      titulo: 'Despegá',
      objetivo: 'Despegá de la pista 06 con potencia máxima, rotá a 50 nudos y subí hasta 500 pies sobre el aeródromo (600 ft en el altímetro).',
      preset: 'runway',
      consejo: 'Pie derecho durante la carrera: la hélice tira la nariz a la izquierda. Rotá suave a 50 nudos y subí a 60–70.',
      pasos: [
        'Revisá flaps 0° y calefacción del carburador adentro. Potencia máxima con + (de a poco, en 2 o 3 segundos).',
        'Mantené el eje de la pista con los pedales (más que nada X, pie derecho).',
        'A 50 nudos tirá suave con ↓ hasta que la rueda de nariz se levante y el avión se vaya al aire.',
        'Subí a 60–70 nudos con la nariz un puño arriba del horizonte hasta 600 pies en el altímetro. Compensá con G si hace falta.'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx), a = s.air;
        var elev = (typeof s.fieldElevation === 'number') ? s.fieldElevation : 100;
        if (s.throttle > 0.95) d.pleno = true;
        d.maxIas = Math.max(d.maxIas || 0, a.ias);
        if (!a.onGround && d.maxIas >= 45) d.enAire = true;
        if (d.enAire && a.altitude - elev >= 500) return 1;
        if (d.enAire) return 0.5 + 0.5 * limitar01((a.altitude - elev) / 500) * 0.98;
        if (!d.pleno) return 0.15 * limitar01(s.throttle);
        return 0.15 + 0.3 * limitar01(d.maxIas / 50);
      }
    },

    {
      id: 'recto-nivelado',
      titulo: 'Vuelo recto y nivelado',
      objetivo: 'Mantené la altitud inicial (±100 ft) y el rumbo inicial (±10°) durante 20 segundos seguidos.',
      preset: 'cruise',
      consejo: 'Mirá afuera: la nariz quieta sobre el horizonte y las alas parejas. Correcciones chiquitas; si tenés que hacer fuerza, compensá.',
      pasos: [
        'Fijate dónde corta el horizonte sobre el capó y mantenelo ahí.',
        'Alas niveladas: correcciones suaves con ← y →.',
        'Si la nariz quiere subir o bajar, corregí con ↑/↓ y después compensá con T o G para no hacer fuerza.',
        'Cada tanto, mirá el altímetro y el direccional: si se mueven, corregí de a poco.'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx), a = s.air;
        if (d.alt0 === undefined) { d.alt0 = a.altitude; d.rumbo0 = a.heading; }
        var ok = Math.abs(a.altitude - d.alt0) <= 100 && difAngulo(a.heading, d.rumbo0) <= 10 && !a.onGround;
        return limitar01(sostener(d, 'ok', ok, ctx.dt || 0, 1) / 20);
      }
    },

    {
      id: 'viraje',
      titulo: 'Viraje coordinado de 30° a la izquierda',
      objetivo: 'Virá a la izquierda con 25 a 35° de inclinación, la bolita al centro y sin cambiar más de 150 ft de altitud, durante 10 segundos.',
      preset: 'cruise',
      consejo: 'Volante y pie izquierdo juntos. Cuando llegás a 30°, volante casi al centro y un poquito de tirar para no bajar.',
      pasos: [
        'Girá el volante a la izquierda (←) y al mismo tiempo pie izquierdo (Z).',
        'Al llegar a unos 30° en el horizonte artificial, volvé el volante casi al centro: la inclinación se queda.',
        'Tirá apenas (↓) para no perder altura: en el viraje el ala tiene que sostener más.',
        'Mantené la bolita al centro con los pedales («pisá la bolita»).'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx), a = s.air;
        if (d.alt0 === undefined) d.alt0 = a.altitude;
        var ok = entre(a.bank, -35, -25) && Math.abs(a.slip) < 0.25 && Math.abs(a.altitude - d.alt0) <= 150;
        var t = sostener(d, 'ok', ok, ctx.dt || 0, 1);
        if (t > 0) return limitar01(0.3 + 0.7 * t / 10);
        return 0.3 * limitar01(-a.bank / 25);
      }
    },

    {
      id: 'ascenso',
      titulo: 'Subí 500 pies a 68 nudos',
      objetivo: 'Con potencia máxima, subí 500 pies manteniendo entre 63 y 73 nudos (Vy, la velocidad de mejor ascenso, es 68). Sólo cuenta lo que subas dentro de esa velocidad.',
      preset: 'cruise',
      consejo: 'Primero potencia, después la nariz. La velocidad se maneja con la actitud: si vas rápido, subí un poco la nariz; si vas lento, bajala.',
      pasos: [
        'Potencia máxima con + y pie derecho (X) para la bolita.',
        'Subí la nariz (↓) más o menos un puño arriba del horizonte.',
        'Ajustá la nariz hasta que el velocímetro quede en 68 nudos, y compensá con G.',
        'Seguí así hasta subir 500 pies. Mirá la temperatura de aceite en ascensos largos.'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx), a = s.air;
        if (d.alt0 === undefined) { d.alt0 = a.altitude; d.ultima = a.altitude; d.subido = 0; }
        var cumple = s.throttle >= 0.9 && entre(a.ias, 63, 73);
        if (cumple && a.altitude > d.ultima) d.subido += a.altitude - d.ultima;
        d.ultima = a.altitude;
        if (d.subido >= 500 && a.altitude >= d.alt0 + 490) return 1;
        return Math.min(0.99, d.subido / 500);
      }
    },

    {
      id: 'perdida',
      titulo: 'Reconocé y recuperá una pérdida',
      objetivo: 'Sacá potencia, frená el avión manteniendo la altura hasta que suene la bocina, y recuperá: más de 60 nudos, nariz debajo de 5° y sin perder 300 pies.',
      preset: 'cruise',
      consejo: 'La salida empieza por empujar: bajá la nariz para que el ala vuelva a trabajar. Recién después, potencia.',
      pasos: [
        'Calefacción del carburador afuera y sacá toda la potencia con −.',
        'Tirá de a poco (↓) para mantener la altura mientras la velocidad baja. Pies activos para la bolita.',
        'Cuando suene la bocina: empujá (↑) para bajar la nariz y dale potencia máxima con +.',
        'Alas niveladas, calefacción adentro y, al pasar 60 nudos, llevá la nariz suave al horizonte.'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx), a = s.air;
        if (d.fase === undefined) { d.fase = 0; d.ias0 = a.ias; }
        if (d.fase === 3) return 1;
        if (d.fase === 0) {
          if (s.throttle <= 0.2) d.fase = 1;
          else return 0.1 * limitar01(1 - s.throttle);
        }
        if (d.fase === 1) {
          if (s.throttle > 0.4 && !a.stallWarning) { d.fase = 0; return 0.05; }
          if (a.stallWarning || a.stalled) {
            d.fase = 2; d.altRef = a.altitude; d.altMin = a.altitude;
          } else {
            var rango = Math.max(5, d.ias0 - 55);
            return 0.15 + 0.35 * limitar01((d.ias0 - a.ias) / rango);
          }
        }
        // Fase 2: recuperación. Se mide la altura perdida desde que sonó la bocina.
        d.altMin = Math.min(d.altMin, a.altitude);
        if (d.altRef - d.altMin >= 300) {
          d.fase = 1; d.ias0 = Math.max(a.ias, 60); d.intentos = (d.intentos || 0) + 1;
          return 0.15;
        }
        if (a.ias > 60 && a.pitch < 5 && !a.stallWarning && !a.stalled) { d.fase = 3; return 1; }
        return 0.6 + 0.35 * limitar01((a.ias - 50) / 10);
      }
    },

    {
      id: 'aproximacion',
      titulo: 'Aproximación con flaps',
      objetivo: 'Con al menos 20° de flaps, mantené 50 a 60 nudos (la velocidad del POH con flaps) descendiendo entre 300 y 800 pies por minuto durante 15 segundos.',
      preset: 'approach',
      consejo: 'Calefacción del carburador afuera antes de sacar potencia. Con la nariz manejás la velocidad; con el acelerador, cuánto bajás.',
      pasos: [
        'Calefacción del carburador afuera, y verificá que vas por debajo de 85 nudos.',
        'Mirá en el indicador del parante que los flaps estén en 20° (si faltan, mantené F apretada). Al bajarlos la nariz quiere subir: sostené con ↑.',
        'Subí un poco la nariz para bajar a unos 55 nudos (entre 50 y 60) y compensá con T o G.',
        'Con el acelerador (+/−) ajustá el descenso: el variómetro entre −300 y −800 pies por minuto.'
      ],
      check: function (s, ctx) {
        var d = memoria(ctx), a = s.air;
        if (s.flaps < 20) {
          sostener(d, 'ok', false, ctx.dt || 0, 0);
          return 0.25 * limitar01(s.flaps / 20);
        }
        var ok = entre(a.ias, 50, 60) && entre(a.vs, -800, -300) && !a.onGround;
        var t = sostener(d, 'ok', ok, ctx.dt || 0, 1.5);
        return limitar01(0.25 + 0.75 * t / 15);
      }
    }
  ];

})(root.C150);
