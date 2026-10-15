var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * data/lab.js — Contenido del "Laboratorio del aire" (pestaña AIRE, contrato v2 §4).
 * Sin DOM: se carga también en Node (tests/validate-lab.js).
 *
 *   C150.DATA.labExperiments  experimentos guiados, paso a paso
 *   C150.DATA.labNarration    reglas de la narración en vivo ("Qué está pasando")
 *
 * EXPERIMENTO
 *   { id, titulo, resumen, foco (región del flujo), modo: 'tunel' | 'vuelo',
 *     controles: [ids de fichas de Explorar que muestran el botón "Ver el aire"],
 *     pasos: [ PASO … ] (4 a 7) }
 * PASO
 *   { titulo, texto (2–3 frases simples), mira ("Mirá: …", qué observar en el 3D),
 *     modo?: 'tunel' | 'vuelo'   (si cambia el modo, la UI aplica el preset del modo; reiniciar:true lo re-aplica),
 *     set: { tunnel:{ias, aoa, beta}, throttle, yokeRoll, yokePitch, rudder, trim, mixture, carbHeat, flaps },
 *          (los números van suaves en ≈ 1 s; flaps se mueven con el motor real, ≈ 9 s de 0° a 40°;
 *           tunnel se ignora en modo vuelo)
 *     luego?: [ { tras: s, set: {…} } ]   cambios programados dentro del paso (p. ej. centrar el volante)
 *     vista: 'lado' | 'frente' | 'arriba' | 'tres-cuartos' | 'persecucion',
 *     foco?: región ('flaps','ailerons','elevator','rudder','prop','wingtips','stall','tail','wing') o null,
 *     acercar?: true → la cámara va a la vista de esa región (si el 3D la tiene; si no, queda `vista`),
 *     capas?: { streamlines, propwash, vortices, pressure, forces, moments, trails, slowmo },
 *     cadena: [causa, …, efecto]  (la cadena causa → efecto que se resalta en "Qué está pasando") }
 *
 * REGLA DE NARRACIÓN
 *   { id, tema, tipo: 'evento' | 'estado', tono: 'info' | 'warn' | 'good', prioridad 1..5 (5 = la más importante),
 *     espera: segundos mínimos entre dos disparos, solo?: 'tunel' | 'vuelo',
 *     cuando(c, p, d) → bool,  cadena(c, p, d) → [causa, …, efecto] (2 a 5 textos cortos) }
 *   c = foto actual, p = foto anterior (≈ 0,25 s antes; null en la primera), d = memoria propia de la regla
 *   (objeto que la UI vacía al cambiar de modo o de experimento). Las reglas 'estado' sólo se evalúan cuando
 *   pasaron unos segundos sin ningún 'evento'. Las reglas NO escriben en el estado del simulador.
 *   FOTO (C150.Lab.snap(state)): { t, tunel, ias, aoa, beta, flaps, throttle, rpm, yokeRoll, yokePitch, rudder, trim,
 *     bank, pitch, vs, rollRate, onGround, stallAoa, hornAoa, horn, stalled, stallBlend, cl, cd, lOverD,
 *     liftKg, weightKg, thrustKg, dragKg, liftLKg, liftRKg, flapLiftKg, tailKg, n (sustentación / peso),
 *     rollM, pitchM, yawM (−1..1: + = ala derecha abajo / nariz arriba / nariz a la derecha),
 *     propWash (m/s), propSwirl (0..1), sf: { aileronL, aileronR, elevator, rudder, trimTab } }
 *
 * Física simplificada pero nunca equivocada: la sustentación es perpendicular al viento relativo; los flaps dan más
 * sustentación Y más resistencia (y en el 150 la nariz tiende a subir); el ala con el alerón ABAJO levanta más y
 * SUBE; la guiñada adversa lleva la nariz hacia el ala que sube; el chorro de la hélice y el factor P llevan la nariz
 * a la izquierda con mucha potencia y poca velocidad (pedal derecho); la pérdida es un ÁNGULO, no una velocidad.
 * Decimales con coma (Uruguay).
 */
(function (C150) {
  'use strict';

  C150.DATA = C150.DATA || {};

  /* ------------------------------------------------------------------ helpers de texto */
  function r0(x) { x = Math.round(+x || 0); return (x < 0 ? '−' : '') + Math.abs(x); }
  function r1(x) {
    var s = (Math.round((+x || 0) * 10) / 10).toFixed(1);
    if (s === '-0.0') s = '0.0';
    return s.replace('.', ',').replace('-', '−');
  }
  function r2(x) { return (Math.round((+x || 0) * 100) / 100).toFixed(2).replace('.', ',').replace('-', '−'); }
  function kg(x) { return (Math.round(Math.abs(+x || 0) / 5) * 5) + ' kg'; }
  function lado(v) { return v > 0 ? 'derecha' : 'izquierda'; }
  function otro(v) { return v > 0 ? 'izquierda' : 'derecha'; }
  function ladoM(v) { return v > 0 ? 'derecho' : 'izquierdo'; }
  function otroM(v) { return v > 0 ? 'izquierdo' : 'derecho'; }
  function abs(x) { return Math.abs(+x || 0); }
  /** true once the value stopped moving between two photos */
  function quieto(c, p, k, tol) { return !!p && abs(c[k] - p[k]) <= (tol || 0.05); }

  /* ================================================================== EXPERIMENTOS */

  // (el compensador queda como lo deja el preset del túnel: tocarlo acá sólo haría ruido en la narración)
  var BASE = { tunnel: { ias: 80, aoa: 5, beta: 0 }, throttle: 0.55, yokeRoll: 0, yokePitch: 0, rudder: 0, flaps: 0 };
  function base(extra) {
    var o = JSON.parse(JSON.stringify(BASE));
    for (var k in extra) {
      if (k === 'tunnel') { for (var j in extra.tunnel) o.tunnel[j] = extra.tunnel[j]; }
      else o[k] = extra[k];
    }
    return o;
  }

  C150.DATA.labExperiments = [
    {
      id: 'fuerzas', titulo: 'Las cuatro fuerzas', modo: 'vuelo', foco: 'wing',
      resumen: 'Sustentación, peso, empuje y resistencia: cuándo se equilibran y qué pasa cuando una gana.',
      controles: ['throttle', 'asi', 'vsi'],
      pasos: [
        {
          titulo: 'Vuelo nivelado', modo: 'vuelo', reiniciar: true, vista: 'lado', foco: 'wing',
          set: { throttle: 0.85, yokeRoll: 0, yokePitch: 0, rudder: 0 },
          capas: { forces: true, streamlines: true, trails: true },
          texto: 'El avión vuela recto a 3000 pies. Sobre él trabajan cuatro fuerzas: la sustentación (para arriba), el peso (para abajo), el empuje de la hélice (para adelante) y la resistencia del aire (para atrás).',
          mira: 'Mirá las cuatro flechas: arriba y abajo miden casi lo mismo, adelante y atrás también.',
          cadena: ['Sustentación ≈ peso', 'empuje ≈ resistencia', 'fuerzas en equilibrio', 'vuelo recto a velocidad constante']
        },
        {
          titulo: 'Más potencia', vista: 'lado', foco: 'prop',
          set: { throttle: 1 },
          texto: 'Acelerador a fondo. La hélice tira más aire hacia atrás y el empuje pasa a ser mayor que la resistencia. El avión gana velocidad, el ala levanta más y el avión empieza a subir.',
          mira: 'Mirá cómo la flecha de empuje crece y el variómetro marca subida.',
          cadena: ['Acelerador a fondo', 'más empuje que resistencia', 'sobra fuerza', 'el avión sube']
        },
        {
          titulo: 'Menos potencia', vista: 'lado', foco: 'prop',
          set: { throttle: 0.35 },
          texto: 'Ahora sacamos potencia. El empuje queda chico frente a la resistencia. El avión empieza a bajar: usa una parte del peso para mantener la velocidad, como una bici en bajada.',
          mira: 'La flecha de empuje se achica y el avión baja la nariz y desciende.',
          cadena: ['Menos acelerador', 'empuje menor que resistencia', 'falta fuerza para seguir nivelado', 'el avión desciende']
        },
        {
          titulo: 'De vuelta al equilibrio', vista: 'tres-cuartos', foco: 'wing',
          set: { throttle: 0.85 },
          texto: 'Volvemos a la potencia de crucero. En unos segundos las fuerzas se vuelven a equilibrar. Así se vuela: la potencia decide si subís o bajás, y la nariz decide la velocidad.',
          mira: 'Esperá a que el variómetro vuelva cerca de cero.',
          cadena: ['Potencia de crucero', 'empuje ≈ resistencia otra vez', 'las fuerzas se equilibran', 'vuelo nivelado']
        }
      ]
    },
    {
      id: 'flaps', titulo: 'Los flaps', modo: 'tunel', foco: 'flaps',
      resumen: 'Qué cambia en el aire y en las fuerzas cuando bajás 10°, 20° o 40° de flaps.',
      controles: ['flap-switch', 'flap-indicator'],
      pasos: [
        {
          titulo: 'Ala limpia', modo: 'tunel', vista: 'lado', foco: 'flaps',
          set: base({ tunnel: { ias: 65, aoa: 8 }, flaps: 0 }),
          capas: { streamlines: true, pressure: true, forces: true },
          texto: 'El avión está quieto en el túnel y el viento sopla a 65 nudos, la velocidad típica de una aproximación. Con los flaps arriba el ala levanta justo lo que pesa el avión.',
          mira: 'Mirá las líneas de aire: se separan en el borde de adelante y se juntan atrás del ala, un poco más abajo.',
          cadena: ['Flaps arriba', 'ala limpia', 'sustentación ≈ peso', 'poca resistencia']
        },
        {
          titulo: 'Flaps 10°', vista: 'tres-cuartos', foco: 'flaps', acercar: true,
          set: { flaps: 10 },
          texto: 'Bajamos 10° con el motor eléctrico, a la velocidad real. La parte de atrás del ala se curva hacia abajo y empuja más aire para abajo. Por eso el ala levanta más.',
          mira: 'Mirá cómo el aire sale del ala más inclinado hacia abajo detrás de los flaps.',
          cadena: ['Flaps 10°', 'el ala se curva más', 'desvía más aire hacia abajo', '+ sustentación']
        },
        {
          titulo: 'Flaps 20°', vista: 'tres-cuartos', foco: 'flaps',
          set: { flaps: 20 },
          texto: 'Con 20° la sustentación sigue subiendo, pero también la resistencia. En el Cessna 150 la nariz tiende a subir (se "globea"): el piloto baja un poco la nariz para no perder velocidad.',
          mira: 'Compará las flechas: sustentación más larga y resistencia también más larga.',
          cadena: ['Flaps 20°', '+ sustentación y + resistencia', 'la nariz tiende a subir', 'bajá un poco la nariz']
        },
        {
          titulo: 'Flaps 40°: el freno de aire', vista: 'lado', foco: 'flaps',
          set: { flaps: 40 },
          texto: 'De 20° a 40° casi no se gana sustentación: lo que crece es la resistencia. Los flaps grandes sirven para bajar empinado sin acelerar, por ejemplo para aterrizar en una pista corta.',
          mira: 'Mirá la estela turbulenta detrás de los flaps y la flecha de resistencia, mucho más grande.',
          cadena: ['Flaps 40°', 'poca sustentación extra', 'muchísima resistencia', 'bajada empinada sin acelerar']
        },
        {
          titulo: 'Menos velocidad para volar', vista: 'lado', foco: 'flaps',
          set: { tunnel: { ias: 50 } },
          texto: 'Con flaps el ala puede sostener el avión con menos velocidad. Por eso la velocidad de pérdida baja: 47 nudos limpio, 42 con flaps 40° (el comienzo del arco blanco).',
          mira: 'Con 50 nudos, la sustentación todavía alcanza para el peso.',
          cadena: ['Flaps abajo', 'más sustentación a la misma velocidad', 'se puede volar más despacio', 'aterrizaje más lento y corto']
        },
        {
          titulo: 'Subir los flaps', vista: 'tres-cuartos', foco: 'flaps',
          set: { flaps: 0, tunnel: { ias: 65 } },
          texto: 'Subimos los flaps. El ala pierde curvatura: pierde sustentación y resistencia. En vuelo el avión se "hunde" un poco: por eso se suben de a poco, con velocidad y nunca cerca del suelo de golpe.',
          mira: 'Mirá cómo la sustentación se achica mientras los flaps suben (unos 6 segundos).',
          cadena: ['Flaps arriba', '− sustentación y − resistencia', 'el avión se hunde y acelera', 'subilos de a poco']
        }
      ]
    },
    {
      id: 'alerones', titulo: 'Alerones e inclinación', modo: 'tunel', foco: 'ailerons',
      resumen: 'Por qué al girar el volante un ala sube y la otra baja, y cómo se inclina el avión.',
      controles: ['yoke'],
      pasos: [
        {
          titulo: 'Alas parejas', modo: 'tunel', vista: 'frente', foco: 'wingtips',
          set: base({ tunnel: { ias: 80, aoa: 5 } }),
          capas: { vortices: true, forces: true, moments: true },
          texto: 'Con el volante al centro, las dos alas levantan lo mismo. En cada punta del ala el aire de abajo (alta presión) se escapa hacia arriba y forma un remolino: el vórtice de punta de ala.',
          mira: 'Mirá los dos remolinos de las puntas: tienen el mismo tamaño.',
          cadena: ['Volante al centro', 'alerones parejos', 'las dos alas levantan igual', 'el avión no se inclina']
        },
        {
          titulo: 'Volante a la derecha', vista: 'frente', foco: 'ailerons', acercar: true,
          set: { yokeRoll: 0.6 },
          texto: 'Giramos el volante a la derecha. El alerón izquierdo BAJA y el derecho SUBE. El ala izquierda, con el alerón abajo, levanta más; la derecha levanta menos.',
          mira: 'Mirá las dos flechas de sustentación: la izquierda es más larga. El vórtice izquierdo se hace más fuerte.',
          cadena: ['Volante a la derecha', 'alerón izquierdo baja, derecho sube', 'ala izquierda levanta más', 'el avión se inclina a la derecha']
        },
        {
          titulo: 'Guiñada adversa', vista: 'arriba', foco: 'ailerons',
          set: { yokeRoll: 0.6, rudder: 0 },
          capas: { moments: true },
          texto: 'El ala que levanta más también tiene más resistencia. Esa resistencia tira hacia atrás del ala izquierda y la nariz se va un poco a la IZQUIERDA, al revés del giro. Se llama guiñada adversa.',
          mira: 'Mirá la flecha curva de la nariz: apunta a la izquierda aunque el volante está a la derecha.',
          cadena: ['Alerón izquierdo abajo', 'más resistencia en el ala izquierda', 'la nariz se va a la izquierda', 'se corrige con pedal derecho']
        },
        {
          titulo: 'Volante + pedal: coordinado', vista: 'arriba', foco: 'rudder',
          set: { yokeRoll: 0.6, rudder: 0.35 },
          texto: 'Ahora acompañamos el volante con pedal derecho. El timón de dirección empuja la cola y la nariz deja de irse al revés. Volante y pedal del mismo lado: eso es un viraje coordinado.',
          mira: 'La flecha de guiñada se achica: la nariz queda alineada con el viento.',
          cadena: ['Pedal derecho', 'el timón empuja la cola a la izquierda', 'cancela la guiñada adversa', 'viraje coordinado']
        },
        {
          titulo: 'En vuelo: se inclina', modo: 'vuelo', reiniciar: true, vista: 'persecucion', foco: 'ailerons',
          set: { yokeRoll: 0.45, rudder: 0.2, yokePitch: 0 },
          luego: [{ tras: 1.4, set: { yokeRoll: 0, rudder: 0, yokePitch: 0.12 } }],
          capas: { trails: true, forces: true },
          texto: 'Ahora el avión vuela de verdad. Mientras el volante está girado, el avión sigue inclinándose. Cuando llegás a la inclinación que querés, volvés el volante al centro y la inclinación se mantiene.',
          mira: 'Mirá el horizonte: el avión se inclina y empieza a virar a la derecha.',
          cadena: ['Volante a la derecha', 'el avión se inclina', 'volante al centro', 'la inclinación se mantiene y el avión vira']
        },
        {
          titulo: 'Por qué vira', vista: 'frente', foco: 'wing',
          set: { yokeRoll: 0, rudder: 0, yokePitch: 0.12 },
          texto: 'Con el avión inclinado, la sustentación también se inclina. Una parte tira hacia el costado y es la que hace girar al avión. Como la parte que sostiene el peso es menor, hay que tirar un poquito del volante.',
          mira: 'Mirá la flecha de sustentación inclinada hacia adentro del viraje.',
          cadena: ['Avión inclinado', 'la sustentación se inclina', 'una parte tira hacia el costado', 'el avión vira']
        },
        {
          titulo: 'Nivelar las alas', vista: 'persecucion', foco: 'ailerons',
          set: { yokeRoll: -0.4, rudder: -0.2, yokePitch: 0 },
          luego: [{ tras: 1.4, set: { yokeRoll: 0, rudder: 0, yokePitch: 0 } }],
          texto: 'Para salir del viraje giramos el volante al otro lado (con pedal izquierdo) hasta nivelar y lo centramos. La sustentación vuelve a apuntar para arriba y el avión sigue derecho.',
          mira: 'El horizonte vuelve a quedar derecho.',
          cadena: ['Volante a la izquierda', 'alas niveladas', 'la sustentación apunta para arriba', 'el avión deja de virar']
        }
      ]
    },
    {
      id: 'acelerador', titulo: 'El acelerador y la hélice', modo: 'tunel', foco: 'prop',
      resumen: 'Cómo la hélice empuja el aire, el chorro en espiral y por qué con mucha potencia hace falta pedal derecho.',
      controles: ['throttle', 'tachometer', 'carb-heat', 'mixture'],
      pasos: [
        {
          titulo: 'Motor en ralentí', modo: 'tunel', vista: 'tres-cuartos', foco: 'prop',
          set: base({ tunnel: { ias: 55, aoa: 8 }, throttle: 0 }),
          capas: { propwash: true, forces: true, moments: true },
          texto: 'Con el acelerador atrás el motor gira despacio y la hélice casi no empuja. El aire pasa por la hélice sin acelerarse.',
          mira: 'Mirá el chorro detrás de la hélice: casi no se nota.',
          cadena: ['Acelerador en ralentí', 'hélice lenta', 'casi sin empuje']
        },
        {
          titulo: 'Media potencia', vista: 'tres-cuartos', foco: 'prop',
          set: { throttle: 0.5 },
          texto: 'Empujamos el acelerador hasta la mitad. El motor sube de vueltas y cada pala de la hélice, que es un alita, tira aire hacia atrás. Empujar aire hacia atrás empuja al avión hacia adelante.',
          mira: 'Mirá el chorro naranja que sale de la hélice hacia la cabina y la cola.',
          cadena: ['Más acelerador', 'más RPM', 'la hélice tira más aire hacia atrás', '+ empuje']
        },
        {
          titulo: 'A fondo: el chorro en espiral', vista: 'arriba', foco: 'prop', acercar: true,
          set: { throttle: 1 },
          capas: { slowmo: true },
          texto: 'A fondo, el chorro de la hélice sale girando en espiral alrededor del fuselaje (la hélice gira a la derecha, vista desde la cabina). Esa espiral le pega a la deriva por el lado IZQUIERDO y empuja la cola a la derecha.',
          mira: 'En cámara lenta, seguí la espiral hasta la cola.',
          cadena: ['Acelerador a fondo', 'el chorro gira en espiral', 'le pega a la deriva por la izquierda', 'la nariz se va a la izquierda']
        },
        {
          titulo: 'Factor P', vista: 'arriba', foco: 'prop',
          set: { tunnel: { ias: 50, aoa: 11 }, throttle: 1 },
          texto: 'Con poca velocidad y la nariz alta (como en el despegue y el ascenso), la pala que baja muerde más aire que la que sube. La hélice tira más del lado derecho y la nariz también se va a la izquierda. Es el factor P.',
          mira: 'Mirá la flecha curva de guiñada: la nariz quiere ir a la izquierda.',
          cadena: ['Mucha potencia + poca velocidad', 'factor P y chorro en espiral', 'la nariz se va a la izquierda', 'pisá pedal derecho']
        },
        {
          titulo: 'Pedal derecho', vista: 'arriba', foco: 'rudder',
          set: { rudder: 0.35 },
          texto: 'Por eso en el despegue y en el ascenso se pisa pedal derecho: el timón de dirección compensa el tirón a la izquierda y la nariz queda derecha.',
          mira: 'La flecha de guiñada se achica casi a cero.',
          cadena: ['Pedal derecho', 'el timón empuja la cola', 'compensa el tirón a la izquierda', 'nariz derecha']
        },
        {
          titulo: 'Crucero: casi no hace falta', vista: 'tres-cuartos', foco: 'prop',
          set: { tunnel: { ias: 95, aoa: 4 }, throttle: 0.8, rudder: 0 },
          capas: { slowmo: false },
          texto: 'Con más velocidad el chorro se estira, la espiral pierde fuerza y el factor P casi desaparece. En crucero los pies quedan casi quietos.',
          mira: 'El chorro queda más recto y la flecha de guiñada casi no aparece.',
          cadena: ['Más velocidad', 'espiral más estirada', 'casi sin tirón', 'pedales al centro']
        }
      ]
    },
    {
      id: 'perdida', titulo: 'La pérdida', modo: 'tunel', foco: 'stall',
      resumen: 'Qué le pasa al aire sobre el ala cuando el ángulo de ataque es demasiado grande, y cómo se sale.',
      controles: ['stall-warning', 'asi'],
      pasos: [
        {
          titulo: 'Ángulo chico', modo: 'tunel', vista: 'lado', foco: 'wing',
          set: base({ tunnel: { ias: 60, aoa: 4 }, throttle: 0.4 }),
          capas: { streamlines: true, pressure: true, forces: true },
          texto: 'El ángulo de ataque es el ángulo entre el ala y el viento que le llega. Con 4° el aire sigue la forma del ala, pegadito arriba y abajo.',
          mira: 'Mirá las líneas de aire: siguen la curva de arriba del ala hasta el borde de atrás.',
          cadena: ['Ángulo de ataque 4°', 'el aire sigue la forma del ala', 'flujo ordenado']
        },
        {
          titulo: 'Más ángulo, más sustentación', vista: 'lado', foco: 'wing',
          set: { tunnel: { aoa: 10 } },
          texto: 'Subimos la nariz a 10°. El ala desvía más aire hacia abajo; arriba el aire va más rápido y la presión baja más. La sustentación crece.',
          mira: 'En la curva de sustentación (panel 05) el punto sube por la recta.',
          cadena: ['Ángulo 10°', 'más aire desviado hacia abajo', 'baja más la presión arriba', '+ sustentación']
        },
        {
          titulo: 'Suena la bocina', vista: 'lado', foco: 'stall', acercar: true,
          set: { tunnel: { aoa: 13.5 } },
          texto: 'Cerca de los 13° al aire le cuesta seguir la curva de arriba. La bocina de pérdida suena unos grados antes del límite: es el aviso para bajar la nariz.',
          mira: 'Mirá cómo las líneas de arriba, cerca del borde de atrás, empiezan a temblar.',
          cadena: ['Ángulo 13,5°', 'el aire casi no sigue la curva de arriba', 'suena la bocina', 'bajá un poco la nariz']
        },
        {
          titulo: '¡Pérdida!', vista: 'lado', foco: 'stall',
          set: { tunnel: { aoa: 18 } },
          capas: { slowmo: true },
          texto: 'Pasamos el ángulo crítico (unos 16°). El aire se despega de la parte de arriba del ala y forma remolinos. La sustentación cae de golpe y la resistencia sube mucho: el ala entró en pérdida.',
          mira: 'Mirá los remolinos rojos sobre el ala y la flecha de sustentación más corta.',
          cadena: ['Más de 16°', 'el aire se despega del ala', 'remolinos: cae la sustentación', 'PÉRDIDA']
        },
        {
          titulo: 'No es la velocidad', vista: 'lado', foco: 'stall',
          set: { tunnel: { ias: 100, aoa: 18 } },
          texto: 'Con 100 nudos y el mismo ángulo, el ala sigue en pérdida. La pérdida pasa siempre al mismo ángulo de ataque, a cualquier velocidad. Por eso se vigila el ángulo (la bocina), no sólo el velocímetro.',
          mira: 'Los remolinos siguen ahí aunque el viento sea mucho más rápido.',
          cadena: ['100 nudos y 18°', 'el ángulo sigue pasado', 'sigue la pérdida', 'la pérdida es un ángulo, no una velocidad']
        },
        {
          titulo: 'La salida', vista: 'lado', foco: 'wing',
          set: { tunnel: { ias: 60, aoa: 6 }, throttle: 1 },
          capas: { slowmo: false },
          texto: 'Para salir: bajar la nariz (menos ángulo de ataque) y dar potencia. El aire vuelve a pegarse al ala y la sustentación vuelve enseguida. Después se nivela con suavidad.',
          mira: 'Las líneas de aire vuelven a seguir la curva del ala.',
          cadena: ['Nariz abajo + potencia', 'menos ángulo de ataque', 'el aire vuelve a pegarse', 'vuelve la sustentación']
        }
      ]
    },
    {
      id: 'timon', titulo: 'Timón de dirección y guiñada', modo: 'tunel', foco: 'rudder',
      resumen: 'Qué hacen los pedales, la guiñada adversa y cómo se coordinan pies y manos.',
      controles: ['rudder-pedals', 'turn-coordinator'],
      pasos: [
        {
          titulo: 'Pedales al centro', modo: 'tunel', vista: 'arriba', foco: 'tail',
          set: base({ tunnel: { ias: 75, aoa: 5 } }),
          capas: { moments: true, streamlines: true },
          texto: 'Los pedales mueven el timón de dirección, la parte de atrás de la deriva (la aleta vertical de la cola). Con los pies al centro el aire pasa parejo por los dos lados.',
          mira: 'Mirá desde arriba cómo el aire pasa derecho por la cola.',
          cadena: ['Pedales al centro', 'timón derecho', 'el aire pasa parejo', 'la nariz no se mueve']
        },
        {
          titulo: 'Pedal derecho', vista: 'arriba', foco: 'rudder', acercar: true,
          set: { rudder: 0.6 },
          texto: 'Pisamos el pedal derecho: el timón se mueve a la derecha. El aire lo empuja y la cola se va a la IZQUIERDA, así que la nariz gira a la DERECHA. Ese giro sobre el eje vertical se llama guiñada.',
          mira: 'Mirá cómo se desvía el aire en la cola y la flecha curva de la nariz hacia la derecha.',
          cadena: ['Pedal derecho', 'timón a la derecha', 'la cola va a la izquierda', 'la nariz va a la derecha']
        },
        {
          titulo: 'Pedal izquierdo', vista: 'arriba', foco: 'rudder',
          set: { rudder: -0.6 },
          texto: 'Con el pedal izquierdo pasa lo contrario: la nariz va a la izquierda. Como en un karting: pie izquierdo, nariz a la izquierda.',
          mira: 'La flecha de guiñada cambia de lado.',
          cadena: ['Pedal izquierdo', 'timón a la izquierda', 'la cola va a la derecha', 'la nariz va a la izquierda']
        },
        {
          titulo: 'Sólo volante: guiñada adversa', vista: 'arriba', foco: 'ailerons',
          set: { rudder: 0, yokeRoll: -0.6 },
          texto: 'Pies quietos y volante a la izquierda. El ala derecha (alerón abajo) levanta más pero también frena más, y la nariz se va a la DERECHA, al revés del giro.',
          mira: 'Mirá la flecha de guiñada: va hacia el lado contrario del volante.',
          cadena: ['Volante a la izquierda, sin pedal', 'ala derecha con más resistencia', 'la nariz va a la derecha', 'guiñada adversa']
        },
        {
          titulo: 'Coordinado', vista: 'arriba', foco: 'rudder',
          set: { yokeRoll: -0.6, rudder: -0.35 },
          texto: 'Volante y pedal del mismo lado. El pedal izquierdo cancela la guiñada adversa y la nariz sigue el giro. En el coordinador de giro, la bolita queda al centro.',
          mira: 'La flecha de guiñada queda casi en cero.',
          cadena: ['Volante + pedal izquierdo', 'el timón cancela la guiñada adversa', 'la nariz sigue el giro', 'bolita al centro']
        }
      ]
    },
    {
      id: 'profundidad', titulo: 'Profundidad y compensador', modo: 'tunel', foco: 'elevator',
      resumen: 'Cómo el volante sube o baja la nariz con la cola, y cómo el compensador te saca la fuerza de las manos.',
      controles: ['yoke', 'trim-wheel'],
      pasos: [
        {
          titulo: 'La cola empuja para abajo', modo: 'tunel', vista: 'lado', foco: 'tail',
          set: base({ tunnel: { ias: 80, aoa: 5 } }),
          capas: { forces: true, moments: true, streamlines: true },
          texto: 'El motor adelante hace que la nariz sea pesada. Para equilibrarla, el estabilizador de la cola empuja un poco hacia abajo, como el otro lado de un subibaja.',
          mira: 'Mirá detrás del ala: el aire baja (estela descendente) y le llega a la cola desde arriba.',
          cadena: ['Nariz pesada (motor)', 'la cola empuja hacia abajo', 'el avión queda equilibrado']
        },
        {
          titulo: 'Tirar del volante', vista: 'lado', foco: 'elevator', acercar: true,
          set: { yokePitch: 0.5 },
          texto: 'Tiramos del volante: el borde de atrás del timón de profundidad SUBE. El aire empuja la cola hacia abajo con más fuerza y la nariz sube. Más nariz arriba = más ángulo de ataque.',
          mira: 'Mirá el timón de profundidad levantado y la flecha curva "sube la nariz".',
          cadena: ['Tirás del volante', 'el timón de profundidad sube', 'la cola baja', 'la nariz sube']
        },
        {
          titulo: 'Empujar el volante', vista: 'lado', foco: 'elevator',
          set: { yokePitch: -0.5 },
          texto: 'Empujamos el volante: el timón de profundidad baja, la cola sube y la nariz baja. En vuelo, nariz abajo significa más velocidad.',
          mira: 'La flecha curva cambia: ahora "baja la nariz".',
          cadena: ['Empujás el volante', 'el timón de profundidad baja', 'la cola sube', 'la nariz baja']
        },
        {
          titulo: 'El compensador', vista: 'lado', foco: 'elevator',
          set: { yokePitch: 0, trim: 0.6 },
          texto: 'El compensador mueve una aletita en el timón de profundidad. Con "nariz arriba", la aleta baja, el aire la empuja y sostiene el timón de profundidad hacia arriba. Así la nariz se queda arriba sin que hagas fuerza.',
          mira: 'Mirá la aletita del compensador, en el borde de atrás del timón de profundidad.',
          cadena: ['Compensador nariz arriba', 'la aleta baja', 'el aire sostiene el timón arriba', 'manos libres']
        },
        {
          titulo: 'En vuelo: compensar', modo: 'vuelo', reiniciar: true, vista: 'lado', foco: 'elevator',
          set: { trim: 0.3, yokePitch: 0, yokeRoll: 0 },
          capas: { trails: true },
          texto: 'En vuelo, compensamos un poco nariz arriba. El avión levanta la nariz, pierde algo de velocidad y empieza a subir despacio. Para volver, se compensa hacia abajo.',
          mira: 'Mirá la estela: el avión sube suavemente.',
          cadena: ['Compensás nariz arriba', 'la nariz sube sola', 'menos velocidad', 'el avión sube despacio']
        },
        {
          titulo: 'Volver al crucero', vista: 'lado', foco: 'elevator',
          set: { trim: 0 },
          texto: 'Compensador a la marca de despegue (que es casi la de crucero en este avión de práctica). La nariz baja, la velocidad vuelve y el avión se nivela.',
          mira: 'El variómetro vuelve hacia cero.',
          cadena: ['Compensador al centro', 'la nariz baja', 'vuelve la velocidad', 'vuelo nivelado']
        }
      ]
    },
    {
      id: 'velocidad', titulo: 'Velocidad y sustentación', modo: 'tunel', foco: 'wing',
      resumen: 'El doble de velocidad da cuatro veces la sustentación. Por qué a baja velocidad hace falta tanto ángulo.',
      controles: ['asi'],
      pasos: [
        {
          titulo: 'Poco viento', modo: 'tunel', vista: 'lado', foco: 'wing',
          set: base({ tunnel: { ias: 50, aoa: 6 }, throttle: 0.5 }),
          capas: { forces: true, pressure: true, streamlines: true },
          texto: 'Viento de 50 nudos y ángulo de ataque de 6°. El ala levanta bastante menos que el peso del avión: así no podría volar.',
          mira: 'Compará la flecha de sustentación con la del peso.',
          cadena: ['50 nudos y 6°', 'poca presión de aire', 'sustentación menor que el peso']
        },
        {
          titulo: 'Más viento', vista: 'lado', foco: 'wing',
          set: { tunnel: { ias: 75 } },
          texto: 'Con 75 nudos la sustentación crece mucho más que la velocidad. Depende del cuadrado de la velocidad: 1,5 veces más rápido da unas 2,25 veces más sustentación.',
          mira: 'La flecha de sustentación ya casi iguala al peso.',
          cadena: ['75 nudos', 'más aire por segundo', 'sustentación × 2,25']
        },
        {
          titulo: 'El doble', vista: 'lado', foco: 'wing',
          set: { tunnel: { ias: 100 } },
          texto: 'Con el doble de velocidad (100 nudos) y el mismo ángulo, la sustentación es CUATRO veces la del principio. Sobra sustentación: en vuelo el avión subiría.',
          mira: 'En el panel 03 la sustentación pasa largo al peso.',
          cadena: ['El doble de velocidad', 'cuatro veces la sustentación', 'sobra fuerza']
        },
        {
          titulo: 'Rápido: poco ángulo', vista: 'lado', foco: 'wing',
          set: { tunnel: { ias: 100, aoa: 3.3 } },
          texto: 'Por eso en crucero, rápido, el avión vuela con poco ángulo de ataque: alcanza con inclinar el ala un poquito para sostener el peso.',
          mira: 'Sustentación ≈ peso otra vez, con el ala casi alineada con el viento.',
          cadena: ['Mucha velocidad', 'alcanza poco ángulo', 'sustentación = peso']
        },
        {
          titulo: 'Lento: mucho ángulo', vista: 'lado', foco: 'stall',
          set: { tunnel: { ias: 50, aoa: 13.5 } },
          texto: 'A 50 nudos, para sostener el peso hace falta casi 14° de ángulo: muy cerca de la pérdida, y suena la bocina. Volar lento es volar con mucho ángulo de ataque.',
          mira: 'En el panel 05 el punto está casi en la zona roja.',
          cadena: ['Poca velocidad', 'hace falta mucho ángulo', 'cerca de la pérdida', 'cuidado con tirar más']
        }
      ]
    }
  ];

  /* ================================================================== NARRACIÓN EN VIVO */

  C150.DATA.labNarration = [
    /* ---------------------------------------------------------------- flaps */
    {
      id: 'flaps-moviendo', tema: 'flaps', tipo: 'evento', tono: 'info', prioridad: 3, espera: 8,
      cuando: function (c, p, d) {
        if (!p) return false;
        var mov = c.flaps - p.flaps;
        var was = d.mov || 0;
        d.mov = mov > 0.02 ? 1 : (mov < -0.02 ? -1 : 0);
        return d.mov !== 0 && was === 0;
      },
      cadena: function (c, p, d) {
        return d.mov > 0
          ? ['Los flaps están bajando', 'el borde de atrás del ala se curva hacia abajo', 'el ala desvía más aire hacia abajo']
          : ['Los flaps están subiendo', 'el ala recupera su forma limpia', 'desvía menos aire hacia abajo'];
      }
    },
    {
      id: 'flaps-cambio', tema: 'flaps', tipo: 'evento', tono: 'info', prioridad: 4, espera: 1,
      cuando: function (c, p, d) {
        if (d.ref === undefined) { d.ref = c.flaps; return false; }
        if (!quieto(c, p, 'flaps', 0.02) || abs(c.flaps - d.ref) < 4) return false;
        d.dir = c.flaps > d.ref ? 1 : -1; d.ref = c.flaps;
        return true;
      },
      cadena: function (c, p, d) {
        var f = r0(c.flaps);
        if (d.dir < 0) {
          return [c.flaps < 1 ? 'Subiste los flaps del todo' : 'Subiste los flaps a ' + f + '°',
            'el ala pierde curvatura', '− sustentación y − resistencia',
            c.tunel ? 'si lo soltáramos, se hundiría un poco y aceleraría' : 'el avión se hunde un poco y acelera'];
        }
        if (c.flaps >= 25) {
          return ['Bajaste los flaps a ' + f + '°', 'poca sustentación extra', 'muchísima más resistencia',
            'sirven para bajar empinado sin acelerar'];
        }
        return ['Bajaste los flaps a ' + f + '°', 'el ala empuja más aire hacia abajo', '+ sustentación y + resistencia',
          c.tunel ? 'la nariz tiende a subir y, suelto, frenaría' : 'el avión levanta la nariz y frena'];
      }
    },
    {
      id: 'flaps-vfe', tema: 'flaps', tipo: 'evento', tono: 'warn', prioridad: 5, espera: 15,
      cuando: function (c) { return c.flaps > 2 && c.ias > 86; },
      cadena: function (c) {
        return ['Flaps abajo a ' + r0(c.ias) + ' nudos', 'más de 85 nudos: fin del arco blanco (Vfe)',
          'el aire empuja demasiado fuerte los flaps', 'subí los flaps o bajá la velocidad'];
      }
    },

    /* ---------------------------------------------------------------- alerones e inclinación */
    {
      id: 'alerones', tema: 'alerones', tipo: 'evento', tono: 'info', prioridad: 4, espera: 1,
      cuando: function (c, p, d) {
        var side = c.yokeRoll > 0.15 ? 1 : (c.yokeRoll < -0.15 ? -1 : 0);
        var was = d.side || 0;
        d.side = side;
        return side !== 0 && side !== was;
      },
      cadena: function (c, p, d) {
        var s = d.side;
        return ['Giraste el volante a la ' + lado(s),
          'alerón ' + otroM(s) + ' BAJA y el ' + ladoM(s) + ' SUBE',
          'el ala ' + otro(s) + ' levanta más que la ' + lado(s),
          c.tunel ? 'el avión quiere inclinarse a la ' + lado(s) : 'el avión se inclina a la ' + lado(s)];
      }
    },
    {
      id: 'guinada-adversa', tema: 'alerones', tipo: 'evento', tono: 'info', prioridad: 3, espera: 20,
      cuando: function (c, p, d) {
        var on = abs(c.yokeRoll) > 0.3 && abs(c.rudder) < 0.12 && c.ias > 35;
        d.t0 = on ? (d.t0 === undefined ? c.t : d.t0) : undefined;
        return on && c.t - d.t0 > 1.5;
      },
      cadena: function (c) {
        var s = c.yokeRoll > 0 ? 1 : -1;
        return ['Volante a la ' + lado(s) + ' sin pedal',
          'el ala que sube (alerón abajo) también frena más',
          'la nariz se va a la ' + otro(s) + ': guiñada adversa',
          'acompañá el volante con pedal ' + ladoM(s)];
      }
    },
    {
      id: 'inclinacion-sigue', tema: 'alerones', tipo: 'evento', tono: 'info', prioridad: 3, espera: 18, solo: 'vuelo',
      cuando: function (c) { return abs(c.yokeRoll) > 0.25 && abs(c.bank) > 25 && c.yokeRoll * c.bank > 0; },
      cadena: function (c) {
        return ['Seguís con el volante girado', 'los alerones siguen trabajando',
          'el avión se sigue inclinando (' + r0(abs(c.bank)) + '°)', 'para mantener la inclinación, volvé el volante al centro'];
      }
    },
    {
      id: 'viraje', tema: 'alerones', tipo: 'evento', tono: 'info', prioridad: 2, espera: 25, solo: 'vuelo',
      cuando: function (c) { return abs(c.bank) > 12 && abs(c.bank) < 45 && abs(c.yokeRoll) < 0.15 && !c.onGround; },
      cadena: function (c) {
        return ['Avión inclinado ' + r0(abs(c.bank)) + '° a la ' + lado(c.bank),
          'la sustentación también se inclina',
          'una parte tira hacia el costado: el avión vira',
          'la que sostiene el peso es menor: tirá un poquito del volante'];
      }
    },
    {
      id: 'viraje-fuerte', tema: 'alerones', tipo: 'evento', tono: 'warn', prioridad: 4, espera: 20, solo: 'vuelo',
      cuando: function (c) { return abs(c.bank) > 45 && !c.onGround; },
      cadena: function (c) {
        return ['Inclinación de ' + r0(abs(c.bank)) + '°', 'para no bajar, el ala tiene que levantar mucho más',
          'más carga (G) y la pérdida llega antes', 'los virajes normales son de 15° a 30°'];
      }
    },
    {
      id: 'alas-niveladas', tema: 'alerones', tipo: 'evento', tono: 'good', prioridad: 3, espera: 10, solo: 'vuelo',
      cuando: function (c, p, d) {
        if (abs(c.bank) > 12) d.armed = true;
        if (d.armed && abs(c.bank) < 3) { d.armed = false; return true; }
        return false;
      },
      cadena: function () {
        return ['Nivelaste las alas', 'toda la sustentación vuelve a apuntar para arriba', 'el avión deja de virar'];
      }
    },

    /* ---------------------------------------------------------------- profundidad y compensador */
    {
      id: 'profundidad', tema: 'profundidad', tipo: 'evento', tono: 'info', prioridad: 4, espera: 1,
      cuando: function (c, p, d) {
        var side = c.yokePitch > 0.15 ? 1 : (c.yokePitch < -0.15 ? -1 : 0);
        var was = d.side || 0;
        d.side = side;
        return side !== 0 && side !== was;
      },
      cadena: function (c, p, d) {
        if (d.side > 0) {
          return ['Tiraste del volante', 'el timón de profundidad SUBE', 'el aire empuja la cola hacia abajo',
            c.tunel ? 'la nariz quiere subir (más ángulo de ataque)' : 'la nariz sube: más ángulo, menos velocidad'];
        }
        return ['Empujaste el volante', 'el timón de profundidad BAJA', 'la cola sube',
          c.tunel ? 'la nariz quiere bajar (menos ángulo de ataque)' : 'la nariz baja y el avión acelera'];
      }
    },
    {
      id: 'compensador', tema: 'profundidad', tipo: 'evento', tono: 'info', prioridad: 3, espera: 1,
      cuando: function (c, p, d) {
        if (d.ref === undefined) { d.ref = c.trim; return false; }
        if (!quieto(c, p, 'trim', 0.01) || abs(c.trim - d.ref) < 0.15) return false;
        d.dir = c.trim > d.ref ? 1 : -1; d.ref = c.trim;
        return true;
      },
      cadena: function (c, p, d) {
        return d.dir > 0
          ? ['Compensaste nariz arriba', 'la aletita del compensador baja', 'el aire sostiene el timón de profundidad arriba', 'la nariz se queda arriba sin hacer fuerza']
          : ['Compensaste nariz abajo', 'la aletita del compensador sube', 'el aire sostiene el timón de profundidad abajo', 'la nariz se queda abajo sin hacer fuerza'];
      }
    },
    {
      id: 'cola-abajo', tema: 'profundidad', tipo: 'estado', tono: 'info', prioridad: 1, espera: 60,
      cuando: function (c) { return c.tailKg < -8 && c.ias > 45 && c.stallBlend < 0.2; },
      cadena: function (c) {
        return ['La cola empuja hacia abajo unos ' + kg(c.tailKg), 'equilibra la nariz pesada (el motor)',
          'por eso el ala levanta un poco más que el peso'];
      }
    },

    /* ---------------------------------------------------------------- timón de dirección */
    {
      id: 'pedal', tema: 'timon', tipo: 'evento', tono: 'info', prioridad: 4, espera: 1,
      cuando: function (c, p, d) {
        var side = c.rudder > 0.15 ? 1 : (c.rudder < -0.15 ? -1 : 0);
        var was = d.side || 0;
        d.side = side;
        return side !== 0 && side !== was;
      },
      cadena: function (c, p, d) {
        var s = d.side;
        return ['Pisaste el pedal ' + ladoM(s), 'el timón de dirección va a la ' + lado(s),
          'el aire empuja la cola a la ' + otro(s), 'la nariz va a la ' + lado(s) + ' (guiñada)'];
      }
    },
    {
      id: 'derrape', tema: 'timon', tipo: 'evento', tono: 'warn', prioridad: 3, espera: 25, solo: 'vuelo',
      cuando: function (c, p, d) {
        var on = abs(c.rudder) > 0.4 && abs(c.yokeRoll) < 0.1 && c.ias > 40 && !c.onGround;
        d.t0 = on ? (d.t0 === undefined ? c.t : d.t0) : undefined;
        return on && c.t - d.t0 > 2;
      },
      cadena: function () {
        return ['Pedal sin volante', 'el avión derrapa: el aire le pega de costado',
          'la bolita se va al costado (vuelo descoordinado)', 'usá pedal y volante juntos'];
      }
    },

    /* ---------------------------------------------------------------- acelerador, hélice, factor P */
    {
      id: 'potencia', tema: 'acelerador', tipo: 'evento', tono: 'info', prioridad: 4, espera: 1,
      cuando: function (c, p, d) {
        if (d.ref === undefined) { d.ref = c.throttle; return false; }
        if (!quieto(c, p, 'throttle', 0.01) || abs(c.throttle - d.ref) < 0.15) return false;
        d.dir = c.throttle > d.ref ? 1 : -1; d.ref = c.throttle;
        return true;
      },
      cadena: function (c, p, d) {
        if (d.dir > 0) {
          return ['Más acelerador: ' + r0(Math.round(c.rpm / 10) * 10) + ' RPM', 'la hélice tira más aire hacia atrás',
            'empuje de ' + kg(c.thrustKg),
            c.tunel ? 'suelto, aceleraría o subiría' : 'el avión acelera y la nariz tiende a subir'];
        }
        return ['Menos acelerador: ' + r0(Math.round(c.rpm / 10) * 10) + ' RPM', 'la hélice empuja menos aire',
          'menos empuje que resistencia',
          c.tunel ? 'suelto, frenaría o bajaría' : 'el avión frena o baja: bajá la nariz para mantener la velocidad'];
      }
    },
    {
      id: 'factor-p', tema: 'acelerador', tipo: 'evento', tono: 'warn', prioridad: 3, espera: 30,
      cuando: function (c) { return c.throttle > 0.75 && c.ias > 25 && c.ias < 75 && c.rudder < 0.15; },
      cadena: function () {
        return ['Mucha potencia y poca velocidad', 'el chorro de la hélice gira en espiral y le pega a la deriva',
          'factor P: la pala que baja tira más', 'la nariz se va a la izquierda: pisá pedal derecho'];
      }
    },
    {
      id: 'pedal-derecho-bien', tema: 'acelerador', tipo: 'evento', tono: 'good', prioridad: 3, espera: 30,
      cuando: function (c) { return c.throttle > 0.75 && c.ias < 75 && c.rudder > 0.2 && abs(c.yawM) < 0.12; },
      cadena: function () {
        return ['Pedal derecho con mucha potencia', 'el timón compensa el tirón de la hélice', 'la nariz queda derecha'];
      }
    },
    {
      id: 'ralenti', tema: 'acelerador', tipo: 'estado', tono: 'info', prioridad: 2, espera: 40, solo: 'vuelo',
      cuando: function (c) { return c.throttle < 0.08 && !c.onGround && c.ias > 40; },
      cadena: function () {
        return ['Motor en ralentí', 'casi sin empuje', 'el avión planea: cambia altura por velocidad', 'el mejor planeo es a unos 60 nudos'];
      }
    },

    /* ---------------------------------------------------------------- velocidad y ángulo de ataque */
    {
      id: 'velocidad', tema: 'velocidad', tipo: 'evento', tono: 'info', prioridad: 3, espera: 1, solo: 'tunel',
      cuando: function (c, p, d) {
        if (d.ref === undefined) { d.ref = c.ias; return false; }
        if (!quieto(c, p, 'ias', 0.4) || abs(c.ias - d.ref) < 12) return false;
        d.ratio = d.ref > 5 ? c.ias / d.ref : 0;
        d.dir = c.ias > d.ref ? 1 : -1; d.ref = c.ias;
        return true;
      },
      cadena: function (c, p, d) {
        var x = d.ratio > 0 ? r1(d.ratio * d.ratio) : null;
        if (d.dir > 0) {
          return ['Más viento: ' + r0(c.ias) + ' nudos', 'la sustentación crece con el cuadrado de la velocidad',
            x ? 'sustentación × ' + x : 'el ala empieza a levantar', 'a más velocidad alcanza menos ángulo de ataque'];
        }
        return ['Menos viento: ' + r0(c.ias) + ' nudos', 'la sustentación cae muy rápido',
          x ? 'sustentación × ' + x : 'casi sin sustentación', 'para sostener el peso hace falta más ángulo'];
      }
    },
    {
      id: 'angulo', tema: 'angulo', tipo: 'evento', tono: 'info', prioridad: 3, espera: 1, solo: 'tunel',
      cuando: function (c, p, d) {
        if (d.ref === undefined) { d.ref = c.aoa; return false; }
        if (!quieto(c, p, 'aoa', 0.08) || abs(c.aoa - d.ref) < 2.5 || c.horn) return false;
        d.dir = c.aoa > d.ref ? 1 : -1; d.ref = c.aoa;
        return true;
      },
      cadena: function (c, p, d) {
        if (d.dir > 0) {
          return ['Ángulo de ataque ' + r1(c.aoa) + '°', 'el ala desvía más aire hacia abajo',
            'arriba el aire va más rápido y baja la presión', '+ sustentación (cl ' + r2(c.cl) + ')'];
        }
        return ['Ángulo de ataque ' + r1(c.aoa) + '°', 'el ala desvía menos aire',
          c.aoa < 0 ? 'con ángulo negativo el ala empuja para abajo' : 'menos diferencia de presión',
          '− sustentación (cl ' + r2(c.cl) + ')'];
      }
    },
    {
      id: 'eficiencia', tema: 'angulo', tipo: 'estado', tono: 'good', prioridad: 2, espera: 45,
      cuando: function (c) { return c.flaps < 3 && c.cl > 0.55 && c.cl < 0.8 && c.stallBlend < 0.1 && c.lOverD > 6; },
      cadena: function (c) {
        return ['Sustentación / resistencia ≈ ' + r1(c.lOverD), 'por cada kilo de resistencia el ala levanta ' + r0(c.lOverD) + ' kilos',
          'es el ángulo más eficiente', 'el del mejor planeo (≈ 60 nudos)'];
      }
    },

    /* ---------------------------------------------------------------- pérdida */
    {
      id: 'bocina', tema: 'perdida', tipo: 'evento', tono: 'warn', prioridad: 5, espera: 6,
      cuando: function (c, p, d) {
        var on = !!c.horn && !c.stalled;
        var was = !!d.on;
        d.on = on;
        return on && !was;
      },
      cadena: function (c) {
        return ['Ángulo de ataque ' + r1(c.aoa) + '° (pérdida a ' + r0(c.stallAoa) + '°)',
          'al aire le cuesta seguir la curva de arriba', 'suena la bocina de pérdida', 'bajá un poco la nariz'];
      }
    },
    {
      id: 'perdida', tema: 'perdida', tipo: 'evento', tono: 'warn', prioridad: 5, espera: 5,
      cuando: function (c, p, d) {
        var on = !!c.stalled;
        var was = !!d.on;
        d.on = on;
        return on && !was;
      },
      cadena: function (c) {
        return ['Pasaste el ángulo crítico (' + r0(c.stallAoa) + '°)', 'el aire se despega de la parte de arriba del ala',
          'remolinos: cae la sustentación y sube la resistencia', '¡PÉRDIDA! Nariz abajo y potencia'];
      }
    },
    {
      id: 'perdida-rapido', tema: 'perdida', tipo: 'evento', tono: 'info', prioridad: 4, espera: 30, solo: 'tunel',
      cuando: function (c) { return !!c.stalled && c.ias > 75; },
      cadena: function (c) {
        return ['Pérdida a ' + r0(c.ias) + ' nudos', 'no importa la velocidad',
          'la pérdida pasa siempre al mismo ángulo (≈ ' + r0(c.stallAoa) + '°)', 'mirá el ángulo, no sólo el velocímetro'];
      }
    },
    {
      id: 'recuperacion', tema: 'perdida', tipo: 'evento', tono: 'good', prioridad: 5, espera: 5,
      cuando: function (c, p, d) {
        if (c.stalled) d.armed = true;
        if (d.armed && !c.stalled && c.stallBlend < 0.3) { d.armed = false; return true; }
        return false;
      },
      cadena: function () {
        return ['Bajaste el ángulo de ataque', 'el aire vuelve a pegarse al ala', 'vuelve la sustentación',
          'saliste de la pérdida: nivelá con suavidad'];
      }
    },

    /* ---------------------------------------------------------------- fuerzas */
    {
      id: 'equilibrio', tema: 'fuerzas', tipo: 'estado', tono: 'good', prioridad: 2, espera: 40, solo: 'vuelo',
      cuando: function (c) {
        return !c.onGround && abs(c.vs) < 150 && abs(c.n - 1) < 0.08 && abs(c.thrustKg - c.dragKg) < Math.max(12, 0.15 * c.dragKg) && abs(c.bank) < 5;
      },
      cadena: function (c) {
        return ['Sustentación ≈ peso (' + kg(c.liftKg) + ')', 'empuje ≈ resistencia (' + kg(c.dragKg) + ')',
          'las cuatro fuerzas se equilibran', 'vuelo nivelado a velocidad constante'];
      }
    },
    {
      id: 'sube', tema: 'fuerzas', tipo: 'estado', tono: 'info', prioridad: 2, espera: 35, solo: 'vuelo',
      cuando: function (c) { return !c.onGround && c.vs > 300; },
      cadena: function (c) {
        return ['Subiendo a ' + r0(Math.round(c.vs / 10) * 10) + ' pies por minuto', 'el empuje le gana a la resistencia',
          'esa fuerza de más es la que levanta el avión'];
      }
    },
    {
      id: 'baja', tema: 'fuerzas', tipo: 'estado', tono: 'info', prioridad: 2, espera: 35, solo: 'vuelo',
      cuando: function (c) { return !c.onGround && c.vs < -300 && c.stallBlend < 0.3; },
      cadena: function (c) {
        return ['Bajando a ' + r0(Math.round(abs(c.vs) / 10) * 10) + ' pies por minuto', 'el empuje no alcanza para la resistencia',
          'el avión usa la bajada para no perder velocidad'];
      }
    },
    {
      id: 'tunel-sustentacion', tema: 'fuerzas', tipo: 'estado', tono: 'info', prioridad: 1, espera: 45, solo: 'tunel',
      cuando: function (c) { return c.ias > 20 && c.stallBlend < 0.2; },
      cadena: function (c) {
        var n = c.n;
        if (n > 1.08) return ['Sustentación ' + kg(c.liftKg) + ', peso ' + kg(c.weightKg), 'el ala levanta más que el peso', 'suelto, el avión subiría'];
        if (n < 0.92) return ['Sustentación ' + kg(c.liftKg) + ', peso ' + kg(c.weightKg), 'el ala levanta menos que el peso', 'suelto, el avión bajaría'];
        return ['Sustentación ≈ peso', 'el ala sostiene justo el avión', 'suelto, volaría nivelado'];
      }
    },
    {
      id: 'tunel-relativo', tema: 'fuerzas', tipo: 'estado', tono: 'info', prioridad: 1, espera: 90, solo: 'tunel',
      cuando: function (c) { return c.ias > 20; },
      cadena: function () {
        return ['Túnel de viento', 'el avión está quieto y el aire se mueve', 'para el ala es lo mismo que volar',
          'lo que importa es la velocidad del aire'];
      }
    }
  ];
})(root.C150);
