var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * controls-a.js — Datos generales de la app (C150.DATA.meta, C150.DATA.categories) y fichas de los
 * controles de las categorías mandos, motor, combustible y eléctrico (Cessna 150M 1976).
 * controls-b.js agrega las fichas de vuelo, sistemas, radio y cabina.
 *
 * Convenciones (interpretación del contrato §4 y §7, iguales a las de controls-b.js):
 *  - Todas las fichas traen las mismas claves. `rangos` es [] cuando el ítem no tiene marcas;
 *    `subitems` sólo existe en 'master' (alt, bat) y 'light-switches' (dome, pitot, nav, strobe,
 *    beacon, taxi, landing).
 *  - En `rangos`, una RAYA se escribe con desde === hasta. Unidades: 'gal', 'A', 'V'.
 *    El amperímetro real NO tiene arcos de color: sus `rangos` son una guía de lectura
 *    (verde = carga, amarillo = descarga, rojo = luz HIGH VOLTAGE); ±60 A es la capacidad del
 *    alternador de 60 A, sólo como referencia de escala.
 *  - `probar` de tipo 'perilla' para los reóstatos usa formato 'porcentaje' (0..1 → 0–100 %).
 *  - 'fuel-gauges', 'ammeter' y 'circuit-breakers' son sólo informativos (probar: null), para que
 *    operar un instrumento no cambie el master sin querer.
 *  - En el texto los decimales van con coma, como se escribe en Uruguay (1,75 galones; 8,5°);
 *    los carteles se citan tal como están impresos en el avión ("FUEL – 22.5 GALS").
 */
(function (C150) {
  'use strict';

  C150.DATA = C150.DATA || {};

  C150.DATA.meta = {
    avion: 'Cessna 150M 1976',
    aviso: 'Basado en un Cessna 150M 1976. El avión de tu escuela puede tener diferencias: siempre manda el manual (POH) y el instructor.'
  };

  // Colores de categoría: tonos medios que se leen como puntitos tanto sobre #F6F8F9 como sobre
  // #151D24 (contraste ≥ 3:1 en los dos fondos). Evitan el verde, amarillo y rojo de los arcos de
  // los instrumentos y el naranja de acento, que tienen significado propio.
  C150.DATA.categories = [
    { id: 'mandos', nombre: 'Mandos de vuelo', color: '#4A6FD8',
      descripcion: 'Lo que movés con las manos y los pies para dirigir el avión: volante, pedales, frenos, compensador y flaps.' },
    { id: 'motor', nombre: 'Motor', color: '#C4428E',
      descripcion: 'Los controles del motor: acelerador, mezcla, calefacción del carburador, cebador y llave de magnetos.' },
    { id: 'combustible', nombre: 'Combustible', color: '#A44FC4',
      descripcion: 'Cómo llega la nafta de aviación desde las alas hasta el motor, y cómo saber cuánta te queda.' },
    { id: 'electrico', nombre: 'Eléctrico y luces', color: '#169C8C',
      descripcion: 'Batería, alternador, master, luces, disyuntores y el amperímetro que te dice si todo carga bien.' },
    { id: 'vuelo', nombre: 'Instrumentos de vuelo', color: '#2196C4',
      descripcion: 'Velocidad, actitud, altura, rumbo y giro: los relojes que te dicen cómo está volando el avión.' },
    { id: 'sistemas', nombre: 'Instrumentos del motor y sistemas', color: '#8C6A55',
      descripcion: 'Cómo está el motor por dentro (vueltas, aceite), el vacío que mueve los giróscopos y la bocina de pérdida.' },
    { id: 'radio', nombre: 'Radio y navegación', color: '#7B5AD6',
      descripcion: 'Para hablar con la torre, que el control te vea en el radar y navegar con radioayudas.' },
    { id: 'cabina', nombre: 'Cabina y seguridad', color: '#687C90',
      descripcion: 'Asientos, cinturones, puertas, ventilación, calefacción y los carteles con los límites del avión.' }
  ];

  C150.DATA.controls = (C150.DATA.controls || []).concat([

    // ─────────────────────────────── MANDOS DE VUELO ───────────────────────────────

    {
      id: 'yoke',
      nombre: 'Volante de mando',
      otrosNombres: ['Volante', 'Comando', 'Columna de mando', 'Los mandos', 'Bastón (coloquial)'],
      ingles: 'Control wheel (yoke)',
      categoria: 'mandos',
      prioridad: 1,
      ubicacion: 'Frente a tu asiento (el izquierdo): la columna sale recta del tablero, a la altura del pecho, y termina en un volante negro con dos “cuernos”. El acompañante tiene otro igual y los dos se mueven juntos.',
      resumen: 'Tirás o empujás para subir o bajar la nariz; girás para inclinar las alas.',
      queHace: 'Hace dos cosas. Si lo tirás hacia vos, la nariz sube; si lo empujás, la nariz baja (eso se llama cabeceo). Si lo girás a la izquierda, el avión se inclina a la izquierda (alabeo), y es esa inclinación la que lo hace doblar: el volante no dobla como el de un auto, inclina.',
      enElAvion: 'Tirar o empujar mueve el timón de profundidad (la parte móvil de atrás de la cola horizontal): tirás → sube → la cola baja y la nariz sube. Girar mueve los alerones (las aletas de atrás de cada ala, cerca de la punta), siempre al revés uno del otro: volante a la izquierda → alerón izquierdo ARRIBA y derecho ABAJO → el ala derecha sostiene más y el avión se inclina a la izquierda. Recorridos: alerones 20° arriba y 14° abajo; profundidad 25° arriba y 15° abajo.',
      comoSeUsa: [
        'Agarralo suave, con la punta de los dedos, como si tuvieras un huevo en la mano.',
        'Para inclinar: girá hacia el lado al que querés virar y, cuando llegás a la inclinación que buscás, volvé el volante casi al centro. La inclinación se mantiene sola.',
        'Mientras girás, pisá el pedal del mismo lado, suave y al mismo tiempo, para que la nariz no se vaya para el lado contrario.',
        'Durante el viraje, tirá un poquito hacia vos para no perder altura.',
        'Para cambiar la velocidad: nariz un poco abajo = más rápido; nariz arriba = más lento. Después compensá con el trim para sacar la fuerza.',
        'Antes de despegar, movelo a fondo para todos lados mirando alerones y cola: “mandos libres y correctos”.'
      ],
      cuando: 'Todo el vuelo, desde la carrera de despegue hasta que el avión frena en la pista. En el rodaje con viento también: con viento de frente desde un costado, el volante va girado hacia ese lado; con viento de cola, al revés y con el volante adelante. Así el viento no te levanta un ala.',
      errores: [
        'Girarlo como el de un auto y dejarlo girado: la inclinación sigue aumentando y el avión se va de lado y baja la nariz.',
        'Tirar para “subir” sin agregar motor: el avión pierde velocidad y se acerca a la pérdida (cuando el ala deja de sostenerlo).',
        'Apretarlo con fuerza: sobrecontrolás y el avión va a los saltos.',
        'Girar sin pedal: la nariz se va primero para el otro lado (guiñada adversa) y el viraje sale “sucio”, con la bolita del coordinador corrida.'
      ],
      truco: 'Sacá la mano por la ventanilla del auto: si la inclinás un poquito, sube o baja. El volante hace eso con la cola y las alas. Y el chiste de los instructores: “tirás y las casas se achican; empujás y se agrandan… y si tirás demasiado, se vuelven a agrandar”.',
      dato: 'Los dos volantes están unidos con cables y varillas: si el instructor mueve el suyo, el tuyo se mueve igual. Por eso el mando se pasa en tres pasos y en voz alta: “Tenés los comandos” – “Tengo los comandos” – “Tenés los comandos”.',
      otrosModelos: 'Funciona igual en todos los 150. Desde 1973 los volantes son de nylon con acolchado. El volante derecho viene con el equipo de doble comando: estándar en el Commuter y opcional en el 150 Standard y en el Aerobat. El Aerobat A150M tiene un poco menos de recorrido de profundidad hacia arriba (23° en vez de 25°).',
      rangos: [],
      relacionados: ['rudder-pedals', 'trim-wheel', 'control-lock', 'attitude', 'turn-coordinator', 'asi'],
      partesAvion: ['aileronL', 'aileronR', 'elevator', 'wingL', 'wingR', 'stabilizer'],
      probar: { tipo: 'yoke' }
    },

    {
      id: 'rudder-pedals',
      nombre: 'Pedales (timón de dirección y rueda de nariz)',
      otrosNombres: ['Pedales', 'Pedalera', 'Timón de dirección', 'Timón'],
      ingles: 'Rudder pedals',
      categoria: 'mandos',
      prioridad: 1,
      ubicacion: 'En el piso, frente a cada asiento: un pedal para cada pie. La parte de arriba de cada pedal es el freno. Los pedales no se ajustan: para alcanzarlos se corre el asiento.',
      resumen: 'Con los pies movés el timón de dirección en vuelo y doblás la rueda de nariz en tierra.',
      queHace: 'Empujás el pedal izquierdo y la nariz se va a la izquierda (eso se llama guiñada); empujás el derecho y se va a la derecha. En tierra doblan la rueda de nariz, como un manubrio que se maneja con los pies. En vuelo NO sirven para virar: sirven para que la cola siga a la nariz y el avión vuele coordinado, con la bolita al centro.',
      enElAvion: 'Mueven el timón de dirección, la parte móvil de atrás de la deriva (la aleta vertical de la cola), hasta 23° a cada lado. En tierra, un resorte une los pedales con la rueda de nariz: sólo con los pedales la doblás unos 8,5° a cada lado; si además frenás la rueda de ese lado, el avión gira hasta 30°.',
      comoSeUsa: [
        'Apoyá los talones en el piso y la planta de los pies en la parte de abajo de los pedales: así no frenás sin querer.',
        'En el rodaje doblá con los pedales, nunca con el volante. Para un giro más cerrado, sumá un toque de freno de ese lado.',
        'En la carrera de despegue y en la subida, pisá pedal derecho para mantener la nariz derecha: el motor y la hélice tiran la nariz a la izquierda.',
        'En vuelo, cuando girás el volante, pisá el pedal del mismo lado, suave y al mismo tiempo.',
        'Mirá la bolita del coordinador de giro: si se va para un lado, “pisá la bolita” (pedal de ese mismo lado).'
      ],
      cuando: 'Siempre: en el rodaje para doblar, en la carrera de despegue y en el aterrizaje para seguir la línea central de la pista, en la subida (pedal derecho) y en cada viraje para coordinar.',
      errores: [
        '“Pies dormidos”: no usar los pedales en los virajes ni en la subida, y la bolita queda corrida.',
        'Querer doblar en tierra girando el volante como en un auto: en tierra el volante no dobla la rueda.',
        'Pedalazos grandes y bruscos a velocidad en la pista: el avión zigzaguea.',
        'Poco pedal derecho en el despegue: el avión se va hacia la izquierda de la pista.'
      ],
      truco: '“Pisá la bolita”: si la bolita del coordinador se va a la derecha, pedal derecho; si se va a la izquierda, pedal izquierdo. Pensá en el timón de un bote o en una veleta: alinea el avión con el aire, no lo inclina.',
      dato: 'El 150 no tiene compensador de timón de dirección en la cabina: sólo una aletita fija en el timón que el mecánico ajusta en tierra. El radio de giro mínimo en tierra es de unos 7,5 metros (24 pies y 8 pulgadas).',
      otrosModelos: 'Igual en todos los 150. Los pedales del lado derecho vienen con el equipo de doble comando: estándar en el Commuter, opcional en el Standard y en el Aerobat. Casi todos los aviones de escuela los tienen, pero fijate en el tuyo.',
      rangos: [],
      relacionados: ['toe-brakes', 'yoke', 'turn-coordinator', 'parking-brake', 'throttle', 'seats'],
      partesAvion: ['rudder', 'fin', 'noseWheel'],
      probar: { tipo: 'pedales' }
    },

    {
      id: 'toe-brakes',
      nombre: 'Frenos (puntas de los pedales)',
      otrosNombres: ['Frenos de pie', 'Frenos', 'Frenos diferenciales'],
      ingles: 'Toe brakes',
      categoria: 'mandos',
      prioridad: 1,
      ubicacion: 'En la parte de arriba de cada pedal. Se aprietan empujando con la punta del pie, sin mover el pedal entero.',
      resumen: 'Apretando la punta de cada pedal frenás la rueda principal de ese lado, por separado.',
      queHace: 'Son frenos hidráulicos (funcionan con líquido a presión, como los del auto) en las dos ruedas principales (las de atrás, una de cada lado). Cada pie frena su rueda: punta izquierda = rueda izquierda, punta derecha = rueda derecha. La rueda de nariz no tiene freno.',
      enElAvion: 'Al apretar la punta del pedal, un cilindro manda líquido de frenos a un disco en la rueda principal de ese lado. Si frenás una sola rueda, el avión pivotea hacia ese lado: así se hacen los giros cerrados en tierra.',
      comoSeUsa: [
        'Al rodar, talones en el piso: los frenos se tocan sólo cuando querés frenar.',
        'Apenas empezás a moverte, probá los frenos con un toque suave (prueba de frenos).',
        'Para frenar derecho, apretá las dos puntas por igual y con suavidad.',
        'Para un giro cerrado, un toque de freno del lado hacia el que doblás, junto con el pedal.',
        'Antes de frenar, sacá motor: no frenes contra el acelerador.',
        'En la prueba de motor (1700 RPM) el avión se sostiene con los frenos o con el freno de estacionamiento.'
      ],
      cuando: 'En tierra: al empezar a rodar (prueba de frenos), en el rodaje, en la prueba de motor y después de aterrizar, con las tres ruedas en el suelo. En un aterrizaje normal el manual pide frenar lo mínimo necesario.',
      errores: [
        'Rodar con las puntas de los pies apoyadas: frenás sin darte cuenta, recalentás y gastás los frenos.',
        'Frenar fuerte con la rueda de nariz todavía en el aire o clavar una rueda: podés reventar la goma o perder el control.',
        'Usar el freno en lugar de reducir motor en el rodaje.',
        'Tocar el freno sin querer al pisar el pedal antes de aterrizar: al apoyar, el avión tira para ese lado.'
      ],
      truco: 'Talones al piso, como un pianista: los dedos sólo bajan cuando querés “tocar la nota” (frenar).',
      dato: 'Si se te rompe un freno, el manual dice usar el otro con cuidado y compensar con pedal del lado contrario. Los cilindros de freno están delante de los pedales del piloto; los pedales del acompañante los accionan con varillas.',
      otrosModelos: 'Los frenos del lado derecho vienen sólo con el equipo de doble comando (estándar en el Commuter, opcional en el Standard y en el Aerobat). Preguntá si tu instructor tiene frenos de su lado.',
      rangos: [],
      relacionados: ['rudder-pedals', 'parking-brake', 'throttle'],
      partesAvion: ['brakes', 'mainWheels', 'noseWheel'],
      probar: { tipo: 'pedales' }
    },

    {
      id: 'parking-brake',
      nombre: 'Freno de estacionamiento',
      otrosNombres: ['Freno de mano', 'Park brake'],
      ingles: 'Parking brake (PARK BRAKE)',
      categoria: 'mandos',
      prioridad: 2,
      ubicacion: 'Abajo a la izquierda del tablero: la perilla cromada de más a la izquierda en la fila de arriba, con el cartel PARK BRAKE. Justo debajo está el cebador (PRIMER).',
      resumen: 'Deja los frenos apretados con el avión quieto, para que no se mueva solo.',
      queHace: 'Traba la presión de los frenos de pie para que sigan apretados aunque saques los pies. Es como el freno de mano del auto, pero se pone en dos pasos: primero apretás los pedales y después tirás la perilla.',
      enElAvion: 'Un mecanismo encierra la presión en los cilindros de freno, así los discos de las dos ruedas principales siguen apretados. La rueda de nariz no frena.',
      comoSeUsa: [
        'Para ponerlo: apretá fuerte las dos puntas de los pedales.',
        'Con los frenos apretados, tirá la perilla PARK BRAKE hacia vos.',
        'Soltá los pedales: el freno queda puesto.',
        'Para sacarlo: apretá los frenos de pie y empujá la perilla hasta el fondo.',
        'Antes de rodar, confirmá que está suelto: si el avión no avanza con un poco de motor, revisá esto primero.'
      ],
      cuando: 'Antes de arrancar el motor, durante la prueba de motor y al estacionar. Se saca justo antes de empezar a rodar.',
      errores: [
        'Tirar la perilla sin apretar antes los pedales: el freno no queda puesto.',
        'Olvidarlo puesto y querer rodar dando más motor: gastás y recalentás los frenos.',
        'Ponerlo con los frenos muy calientes o con humedad que se puede congelar: el manual no lo recomienda.',
        'Dejar el avión sólo con el freno puesto: al estacionarlo también van calzas en las ruedas, la traba de comandos y las amarras.'
      ],
      truco: 'Tres tiempos: “pisar, tirar, soltar”. Y para sacarlo: “pisar, empujar”.',
      dato: 'En el 150 no hay una palanca grande como en el auto: la perilla sólo traba la presión que vos ya hiciste con los pies. Por eso, si no apretás los pedales primero, no frena nada.',
      otrosModelos: 'Desde 1976 la perilla está abajo a la izquierda, en la fila de arriba del subpanel. En el 150M 1975 también está a la izquierda, junto al cebador, pero el resto del tablero está ordenado distinto.',
      rangos: [],
      relacionados: ['toe-brakes', 'rudder-pedals', 'primer'],
      partesAvion: ['brakes', 'mainWheels'],
      probar: { tipo: 'toggle', clave: 'parkingBrake', on: 'Puesto (perilla afuera)', off: 'Suelto (perilla adentro)' }
    },

    {
      id: 'control-lock',
      nombre: 'Traba de comandos',
      otrosNombres: ['Traba del volante', 'Seguro de comandos', 'Control lock'],
      ingles: 'Control lock',
      categoria: 'mandos',
      prioridad: 1,
      ubicacion: 'Cuando está puesta, atraviesa la columna del volante del piloto justo donde sale del tablero, y su bandera roja cuelga tapando la llave de encendido.',
      resumen: 'Una varilla con bandera roja que traba el volante en tierra; se saca antes que nada.',
      queHace: 'Inmoviliza el volante para que el viento no sacuda los alerones y el timón de profundidad contra sus topes cuando el avión está estacionado. Es una varilla de acero que se mete en un agujero de la columna del volante. Su bandera roja dice “CONTROL LOCK – REMOVE BEFORE STARTING ENGINE”: sacala antes de arrancar el motor.',
      enElAvion: 'Con la traba puesta, los alerones y el timón de profundidad quedan fijos: el volante no gira ni va hacia adelante o atrás. La bandera cuelga sobre la llave para que no puedas arrancar sin verla.',
      comoSeUsa: [
        'Primer paso del chequeo de cabina: sacá la traba.',
        'Guardala siempre en el mismo lugar, donde no se pueda mover ni trabar nada.',
        'Mové el volante a fondo para todos lados: tiene que ir libre.',
        'Antes de despegar, verificá otra vez “mandos libres y correctos” mirando los alerones y la cola.',
        'Al terminar el vuelo, con el motor apagado, volvé a ponerla.'
      ],
      cuando: 'Se saca al empezar el chequeo de cabina (es lo primero) y se pone al final, cuando dejás el avión estacionado.',
      errores: [
        'Olvidarla puesta: despegar con la traba puesta ha matado gente, porque el avión no se puede controlar.',
        'Sacarla y dejarla suelta en la cabina: se puede meter debajo de un pedal o trabar el volante.',
        'Saltear la prueba de “mandos libres y correctos” antes de despegar.'
      ],
      truco: 'La bandera roja tapa la llave a propósito: si ves rojo, no hay arranque. “Primero la traba, después todo lo demás”.',
      dato: 'La traba de cabina sólo inmoviliza el volante. Con viento fuerte, el manual recomienda además poner una traba exterior en el timón de dirección.',
      otrosModelos: 'Es igual en todos los 150 modernos. En un avión viejo la traba puede no ser la original: preguntale al instructor cómo es la de tu avión y dónde se guarda.',
      rangos: [],
      relacionados: ['yoke', 'ignition', 'placards'],
      partesAvion: ['aileronL', 'aileronR', 'elevator'],
      probar: { tipo: 'toggle', clave: 'controlLock', on: 'Puesta (volante trabado)', off: 'Sacada (volante libre)' }
    },

    {
      id: 'trim-wheel',
      nombre: 'Compensador (rueda de trim)',
      otrosNombres: ['Trim', 'Compensador de profundidad', 'Rueda del compensador'],
      ingles: 'Elevator trim wheel (ELEVATOR TRIM)',
      categoria: 'mandos',
      prioridad: 1,
      ubicacion: 'Abajo en el centro del tablero, en el pedestal: una rueda negra parada (vertical) que asoma por una ranura, un poco a la izquierda y por debajo del acelerador. A su izquierda está el indicador con las marcas NOSE DN (arriba), TAKE OFF (al medio) y NOSE UP (abajo).',
      resumen: 'Saca la fuerza que hacés en el volante, para que el avión mantenga la velocidad sin sostenerlo.',
      queHace: 'Mueve una aletita en la cola, la aleta compensadora, que sostiene el timón de profundidad donde vos lo dejaste. Así no tenés que hacer fuerza con el brazo todo el tiempo. El compensador no elige hacia dónde apunta la nariz: eso lo hacés vos con el volante; el trim sólo te saca el esfuerzo.',
      enElAvion: 'Rueda hacia adelante (el borde de arriba se aleja de vos) = nariz abajo; rueda hacia atrás = nariz arriba. La aleta compensadora es todo el borde de atrás de la mitad DERECHA del timón de profundidad, y se mueve al revés que el timón: para nariz abajo la aleta sube, y el aire empuja al timón hacia abajo. Recorrido: 10° arriba y 20° abajo.',
      comoSeUsa: [
        'Antes de despegar, poné el indicador en TAKE OFF (despegue).',
        'En vuelo, primero poné la nariz donde querés con el volante y esperá que la velocidad se estabilice.',
        'Si tenés que tirar, girá la rueda hacia atrás (nariz arriba); si tenés que empujar, hacia adelante (nariz abajo).',
        'Andá de a poquito, hasta que no sientas fuerza en el volante.',
        'Aflojá la mano y mirá: si la nariz se queda quieta, está compensado.',
        'Cada vez que cambiás potencia, velocidad o flaps, volvé a compensar.'
      ],
      cuando: 'Antes del despegue (en TAKE OFF), al estabilizar la subida, al nivelar en crucero, en el descenso y en la aproximación. En una emergencia, para planear a 60 nudos sin esfuerzo.',
      errores: [
        'Volar con el trim en vez de con el volante: “volá con el volante y después compensá para sacar la fuerza”.',
        'Girarlo para el lado equivocado: la fuerza en el volante aumenta en vez de desaparecer.',
        'No compensar nunca: el brazo se cansa y empezás a sobrecontrolar.',
        'Despegar sin ponerlo en TAKE OFF: en la rotación la fuerza en el volante es rara o muy grande.'
      ],
      truco: '“Volá con el volante y después compensá para sacar la fuerza.” Es como ajustar el resorte de una puerta para que se quede donde la dejás.',
      dato: 'Parece al revés, pero para “nariz abajo” la aletita sube: es la fuerza del aire sobre esa aletita la que empuja todo el timón. Un avión bien compensado “recuerda” una velocidad: si lo soltás, vuelve a ella solo. Funciona con cables, sin electricidad.',
      otrosModelos: 'En los 150 modernos la rueda está vertical, abajo en el centro. En 1966 cambió de lugar respecto de los primeros 150. El 150 no tiene compensador de timón de dirección ni de alerones en la cabina.',
      rangos: [],
      relacionados: ['yoke', 'asi', 'flap-switch', 'throttle'],
      partesAvion: ['trimTab', 'elevator', 'stabilizer'],
      probar: { tipo: 'slider', clave: 'trim', min: -1, max: 1, paso: 0.05, etiquetaMin: 'NOSE DN (nariz abajo)', etiquetaMax: 'NOSE UP (nariz arriba)' }
    },

    {
      id: 'flap-switch',
      nombre: 'Interruptor de flaps',
      otrosNombres: ['Flaps', 'Llave de flaps', 'Hipersustentadores'],
      ingles: 'Wing flap switch (WING FLAPS)',
      categoria: 'mandos',
      prioridad: 1,
      ubicacion: 'En el centro del subpanel, fila de arriba, a la derecha de la perilla roja de mezcla: un interruptor con la manija en forma de flap, con UP arriba, OFF al medio y DOWN abajo.',
      resumen: 'Baja y sube los flaps: más sustentación y mucha más resistencia para volar lento y bajar empinado.',
      queHace: 'Los flaps son la parte de atrás del ala más cercana al fuselaje (el cuerpo del avión), y bajan con un motor eléctrico. Al bajarlos, el ala se curva más: sostiene a menor velocidad y frena mucho más. Eso te deja aproximar más lento y más empinado, viendo mejor la pista.',
      enElAvion: 'Un motor eléctrico mueve los flaps de las dos alas juntos, de 0° a 40°. Tarda unos 9 segundos en bajarlos del todo y unos 6 en subirlos. Al bajarlos, la nariz tiende a subir y el avión “globea” (se eleva un poco): hay que empujar y compensar. Al subirlos, el avión se hunde un poco.',
      comoSeUsa: [
        'Fijate que la velocidad esté en el arco blanco del velocímetro: 85 nudos o menos.',
        'Para bajar: mantené el interruptor apretado en DOWN. Al soltarlo vuelve solo a OFF y los flaps se quedan donde estaban.',
        'Mirá el indicador del poste izquierdo y el flap por la ventanilla para saber cuánto bajaron.',
        'Empujá un poco el volante para que la nariz no suba y después compensá.',
        'Para subir: poné UP. Queda trabado ahí y los flaps suben del todo solos; si lo pasás a OFF, se detienen donde estén.',
        'En una arremetida (ida al aire): motor a fondo y flaps a 20° enseguida; el resto, de a poco, con velocidad y altura.'
      ],
      cuando: 'Para despegar, normalmente 0° (hasta 10° sólo en pista corta o blanda; más de 10° no está aprobado para despegar). En la aproximación, de a poco y por debajo de 85 nudos. Después de aterrizar, UP.',
      errores: [
        'Bajarlos por encima de 85 nudos: podés dañar los flaps.',
        'No esperar el “globo” (la nariz que sube al bajarlos) y no compensar.',
        'En una arremetida, subir los 40° de golpe cerca del suelo: el avión se hunde. Primero a 20°.',
        'No mirar cuánto bajaron: el interruptor no te dice el ángulo.'
      ],
      truco: 'Bajar cuesta (tenés que mantenerlo apretado); subir es fácil (se queda solo). Y antes de bajar: “blanco antes de flaps”, la aguja del velocímetro en el arco blanco.',
      dato: 'Como son eléctricos, si te quedás sin electricidad no hay flaps: se aterriza sin flaps, un poco más rápido. Los protege un disyuntor de 15 amperes rotulado FLAP. Con flaps a 40° la velocidad de pérdida baja de 47 a 42 nudos.',
      otrosModelos: 'En el 150M 1977 es una palanca de preselección: la ponés en el ángulo que querés (con topes en 10° y 20°; para pasarlos la movés hacia la derecha) y los flaps van solos hasta ahí; la escala está junto a la palanca. De 1968 a 1976 es este interruptor de tres posiciones. De 1959 a 1965 los flaps eran manuales, con una palanca. En muchos aviones el interruptor fue reemplazado y puede comportarse distinto.',
      rangos: [],
      relacionados: ['flap-indicator', 'asi', 'trim-wheel', 'yoke', 'circuit-breakers', 'master'],
      partesAvion: ['flapL', 'flapR'],
      probar: { tipo: 'flaps' }
    },

    {
      id: 'flap-indicator',
      nombre: 'Indicador de posición de flaps',
      otrosNombres: ['Indicador de flaps', 'Escala de flaps'],
      ingles: 'Wing flap position indicator',
      categoria: 'mandos',
      prioridad: 2,
      ubicacion: 'En el parante (poste) delantero izquierdo de la cabina, al costado del parabrisas, arriba a tu izquierda: una escala vertical de 0° a 40° con una aguja. No está en el tablero.',
      resumen: 'Te muestra cuántos grados están bajados los flaps, de 0° a 40°.',
      queHace: 'Es una escala con marcas cada 10° (0, 10, 20, 30 y 40) y una aguja movida por un cable unido a los flaps. Sólo informa, no mueve nada. Como el interruptor no te dice el ángulo, ésta es la forma de saber dónde quedaron.',
      enElAvion: 'No mueve nada. La aguja sigue al flap de verdad por medio de un cable, y en algunos aviones puede errar hasta unos 10°.',
      comoSeUsa: [
        'Mientras mantenés el interruptor en DOWN, mirá la aguja y soltá cuando llegue al ángulo que querés.',
        'Confirmá mirando el flap por la ventanilla: el indicador puede equivocarse hasta unos 10°.',
        'Antes de despegar, verificá que marque 0° (o 10° si vas a usar ese ajuste).',
        'Después de aterrizar, al subir los flaps, verificá que vuelva a 0°.'
      ],
      cuando: 'Cada vez que movés los flaps: en la aproximación, en una arremetida (para parar en 20°) y antes del despegue.',
      errores: [
        'Creerle a ciegas: algunos marcan con bastante error. Mirá también el ala.',
        'No mirarlo y despegar con más flaps de la cuenta (más de 10° no está aprobado para despegar).',
        'Buscarlo en el tablero: en este avión está en el parante izquierdo.'
      ],
      truco: 'Escala + ventanilla: un vistazo a la aguja y otro al flap. Si los dos coinciden, perfecto.',
      dato: 'En 1977 este indicador desapareció del parante: la escala pasó a estar al lado de la palanca de flaps, en el tablero.',
      otrosModelos: '1966–1967: arriba de la puerta izquierda. 1968–1976: en el parante izquierdo, como en este avión. 1977: la escala está junto a la palanca de flaps, en el tablero.',
      rangos: [],
      relacionados: ['flap-switch', 'asi'],
      partesAvion: ['flapL', 'flapR'],
      probar: { tipo: 'flaps' }
    },

    // ─────────────────────────────────── MOTOR ───────────────────────────────────

    {
      id: 'throttle',
      nombre: 'Acelerador',
      otrosNombres: ['Potencia', 'Palanca de potencia', 'Manija de potencia', 'Gases', 'Traba de fricción'],
      ingles: 'Throttle (THROTTLE) with friction lock',
      categoria: 'motor',
      prioridad: 1,
      ubicacion: 'En el centro del subpanel, fila de arriba, casi en la mitad del tablero: la perilla más grande, negra con el centro claro, con un disco moleteado (la traba de fricción) en la base. A su izquierda está la calefacción del carburador y a su derecha la perilla roja de mezcla.',
      resumen: 'Empujás para más potencia y tirás para menos: es el “pedal del acelerador” del avión.',
      queHace: 'Controla cuánta potencia da el motor. Empujado a fondo es potencia máxima; tirado del todo es ralentí, el motor al mínimo. Como la hélice es de paso fijo (sus palas no cambian de ángulo), el tacómetro (RPM, vueltas por minuto) es tu indicador de potencia.',
      enElAvion: 'Abre una mariposa (una válvula en forma de disco) en el carburador, que está debajo del motor: entra más mezcla de aire y nafta, el motor sube de vueltas y la hélice gira más rápido. Con más potencia, la nariz tiende a subir y a irse a la izquierda; con menos, a bajar.',
      comoSeUsa: [
        'Movelo siempre suave, en 2 o 3 segundos, nunca de golpe.',
        'Para arrancar el motor, abrilo apenas 1/4 de pulgada (unos 6 mm).',
        'En el despegue: a fondo y dejá la mano sobre la perilla. Al empezar la carrera, el tacómetro tiene que marcar entre 2460 y 2560 RPM.',
        'Ajustá la traba de fricción (el disco de la base): en sentido horario se endurece, en antihorario se afloja.',
        'Al dar potencia, pisá pedal derecho y empujá un poquito el volante; al sacar potencia, al revés.',
        'Antes de reducir para descender o aterrizar, tirá primero la calefacción del carburador: calor ANTES de reducir.'
      ],
      cuando: 'Todo el vuelo: a fondo para despegar y subir; entre 2000 y 2750 RPM en crucero (lo habitual es 2400–2500); reducido para descender; ralentí en el redondeo, justo antes de tocar la pista. En el despegue y el aterrizaje la mano no se suelta del acelerador.',
      errores: [
        'Moverlo de golpe: el motor sufre y el avión cabecea y se desvía bruscamente.',
        'Soltarlo en el despegue: con la fricción floja puede irse hacia atrás solo.',
        'Confundirlo con la mezcla (la roja): si tirás la mezcla en vez del acelerador, apagás el motor.',
        'Reducir para bajar sin poner antes la calefacción del carburador.'
      ],
      truco: 'Negro y grande = potencia; rojo = mezcla. Y en el avión “más motor” no quiere decir “más rápido”: quiere decir “subir”, salvo que también bajes la nariz.',
      dato: 'Las RPM también cambian con la velocidad: si bajás la nariz, suben solas aunque no toques el acelerador. En picada, ojo con la raya roja de 2750 RPM. El motor es un Continental O-200-A de 100 caballos y 4 cilindros.',
      otrosModelos: 'Funciona igual en todos los 150. Las perillas de repuesto pueden ser de otro color: reconocelas por la forma, el tamaño y el cartel, no sólo por el color.',
      rangos: [],
      relacionados: ['tachometer', 'mixture', 'carb-heat', 'rudder-pedals', 'trim-wheel', 'primer'],
      partesAvion: ['propeller', 'spinner', 'cowling', 'carbAirInlet'],
      probar: { tipo: 'slider', clave: 'throttle', min: 0, max: 1, paso: 0.01, etiquetaMin: 'Ralentí (perilla afuera)', etiquetaMax: 'A fondo (perilla adentro)' }
    },

    {
      id: 'mixture',
      nombre: 'Mezcla',
      otrosNombres: ['Perilla roja', 'Corte de mezcla', 'Mixture'],
      ingles: 'Mixture control (MIXTURE)',
      categoria: 'motor',
      prioridad: 1,
      ubicacion: 'En el centro del subpanel, fila de arriba, a la derecha del acelerador: la perilla ROJA con puntitas en el borde y un botón en la punta.',
      resumen: 'Ajusta cuánta nafta se mezcla con el aire, y es la perilla que apaga el motor.',
      queHace: 'El motor quema una mezcla de aire y nafta. Más arriba el aire es más liviano (menos denso) y, si la nafta sigue igual, la mezcla queda demasiado rica: sobra nafta. Con esta perilla sacás nafta para equilibrarla, y tirada del todo corta la nafta y apaga el motor.',
      enElAvion: 'Regula el paso de nafta dentro del carburador. Adentro a fondo = FULL RICH (rica, toda la nafta). Afuera del todo = IDLE CUT-OFF (corte): no pasa más nafta y el motor se para en unos segundos.',
      comoSeUsa: [
        'Para moverla, apretá el botón de la punta y mantenelo apretado mientras empujás o tirás.',
        'Para arrancar, despegar, subir y aterrizar: adentro a fondo (RICH).',
        'En crucero, para empobrecer: tirá de a poco hasta que las RPM lleguen al máximo y empiecen a bajar; después empujala un poquito para volver al máximo.',
        'Antes de descender, enriquecé de a poco; para aterrizar, rica a fondo.',
        'Para apagar el motor: tirala del todo (IDLE CUT-OFF) y, cuando la hélice se para, llave en OFF.'
      ],
      cuando: 'Rica para arrancar, despegar, subir y aterrizar: en Uruguay casi siempre volás por debajo de 5000 pies, así que en el circuito va rica. Empobrecida en crucero. Afuera del todo para apagar el motor y en algunas emergencias, como fuego en el motor.',
      errores: [
        'Agarrar la roja en vez del acelerador: apagás el motor sin querer.',
        'Empobrecer demasiado: el motor tiembla y se recalienta.',
        'Olvidar enriquecer antes de descender y aterrizar: si necesitás potencia para arremeter, el motor puede no responder bien.',
        'Apagar el motor con la llave en vez de con la mezcla: lo correcto es mezcla en corte primero, así el motor se queda sin nafta y para limpio.'
      ],
      truco: 'Rojo = la que corta. Pensá en la hornalla de la cocina: con demasiado gas la llama es amarilla y tizna; con muy poco se apaga. Vos buscás la llama justa.',
      dato: 'En un fuego en vuelo, lo primero del checklist es “mezcla: corte”, para que no le llegue más nafta al fuego. En crucero, con la mezcla bien ajustada, el 150 gasta unos 5 a 6 galones por hora (unos 20 litros).',
      otrosModelos: '1975–1976: perilla roja con botón de traba; apretás el botón para moverla (es la de este avión). 1977: además es “vernier”: girándola en sentido horario se enriquece de a poquito y en antihorario se empobrece; el botón sirve para moverla rápido. Antes de 1975, perilla roja común de tirar y empujar.',
      rangos: [],
      relacionados: ['throttle', 'tachometer', 'carb-heat', 'ignition', 'primer', 'oil-gauges'],
      partesAvion: ['cowling', 'propeller'],
      probar: { tipo: 'slider', clave: 'mixture', min: 0, max: 1, paso: 0.01, etiquetaMin: 'IDLE CUT-OFF (corte, afuera)', etiquetaMax: 'FULL RICH (rica, adentro)' }
    },

    {
      id: 'carb-heat',
      nombre: 'Calefacción del carburador',
      otrosNombres: ['Aire caliente al carburador', 'Calefacción al carburador', 'Carb heat'],
      ingles: 'Carburetor heat (CARB HEAT)',
      categoria: 'motor',
      prioridad: 1,
      ubicacion: 'En el centro del subpanel, fila de arriba, inmediatamente a la izquierda del acelerador: una perilla cromada más chica.',
      resumen: 'Manda aire caliente al carburador para derretir o evitar el hielo que puede ahogar el motor.',
      queHace: 'Adentro del carburador el aire se enfría mucho (al acelerarse y al evaporarse la nafta), y su humedad puede congelarse aunque afuera haga calor. Ese hielo tapa el paso del aire y el motor pierde potencia. Tirando esta perilla, el motor respira aire caliente y el hielo se derrite o no llega a formarse.',
      enElAvion: 'Mueve una compuerta en la caja de aire del motor: en vez del aire filtrado de la toma de adelante, entra aire caliente tomado alrededor del silenciador derecho (el caño de escape). Ese aire NO pasa por el filtro. Como el aire caliente es más liviano, con calefacción a fondo y motor a fondo se pierden unas 200 a 250 RPM.',
      comoSeUsa: [
        'Tirala hacia vos = calor (HOT); empujala adentro = frío (COLD).',
        'En la prueba de motor (1700 RPM): tirala, fijate que las RPM bajen y volvela a COLD.',
        'Antes de reducir para descender o aterrizar: calor a fondo PRIMERO, después reducí el acelerador.',
        'Para despegar y en una arremetida: siempre COLD (adentro), porque necesitás toda la potencia.',
        'Si en vuelo las RPM bajan sin motivo: calor a fondo y dejalo puesto, aunque el motor ande áspero un rato, hasta que las RPM se recuperen. Después sacalo y reajustá el acelerador.'
      ],
      cuando: 'En la prueba de motor, antes de reducir potencia para descender y aterrizar, y apenas notes una caída de RPM sin explicación. COLD para despegar, en la arremetida y después de aterrizar. Con lluvia muy fuerte, calor a fondo.',
      errores: [
        'Creer que es sólo para el frío: con la humedad de Uruguay puede haber hielo en el carburador con 20 °C o más.',
        'Sacarla cuando el motor tose: esa aspereza es el hielo derritiéndose y pasando por el motor. Dejala puesta.',
        'Despegar o arremeter con la calefacción puesta: perdés potencia justo cuando más la necesitás.',
        'Usarla en tierra sin necesidad: entra aire sin filtrar, con polvo y tierra.'
      ],
      truco: '“Calor antes de cortar”: primero la perilla de calor, después el acelerador. Y si el motor tose cuando la ponés, es buena señal: el hielo se está yendo.',
      dato: 'Cuando aplicás calor con hielo, las RPM bajan todavía un poco más (y el motor puede andar áspero) antes de subir: eso confirma que había hielo. El riesgo es mayor por debajo de 21 °C con humedad de más del 80 %, pero puede pasar hasta con 38 °C. El momento más peligroso es con poca potencia: descenso y aproximación.',
      otrosModelos: 'Funciona igual en todos los 150. En el 150M de fábrica es una perilla cromada más chica que el acelerador, justo a su izquierda; algunos aviones tienen perillas de repuesto distintas.',
      rangos: [],
      relacionados: ['throttle', 'tachometer', 'oat', 'mixture', 'cabin-heat'],
      partesAvion: ['exhaust', 'carbAirInlet', 'cowling'],
      probar: { tipo: 'slider', clave: 'carbHeat', min: 0, max: 1, paso: 0.05, etiquetaMin: 'COLD (frío, adentro)', etiquetaMax: 'HOT (calor, afuera)' }
    },

    {
      id: 'primer',
      nombre: 'Cebador',
      otrosNombres: ['Primer', 'Bomba de cebado'],
      ingles: 'Primer (PRIMER)',
      categoria: 'motor',
      prioridad: 2,
      ubicacion: 'Abajo a la izquierda del tablero: la perilla cromada de más a la izquierda en la fila de abajo, justo debajo del freno de estacionamiento (PARK BRAKE).',
      resumen: 'Una bombita de mano que tira un chorrito de nafta al motor para ayudarlo a arrancar.',
      queHace: 'Es una pequeña bomba manual. Al tirar del émbolo (la perilla) se llena de nafta; al empujarlo, rocía esa nafta en la entrada de aire del motor. Así el motor frío arranca más fácil.',
      enElAvion: 'Toma nafta del filtro de combustible y la inyecta en el múltiple de admisión, los caños que llevan la mezcla a los cilindros. Después del arranque tiene que quedar adentro y trabado.',
      comoSeUsa: [
        'Destrabalo: girá la perilla hasta que salga.',
        'Tirala hacia afuera despacio (se llena de nafta) y empujala hasta adentro (inyecta). Eso es un bombeo.',
        'Con el motor tibio o un día caluroso, 1 o 2 bombeos; con frío, hasta 6.',
        'Al terminar, empujala hasta el fondo y girala para trabarla; tirá suave para confirmar que no sale.',
        'En el checklist: “Cebador: ADENTRO y TRABADO”.'
      ],
      cuando: 'Sólo en el arranque, antes de girar la llave. También aparece en la emergencia de falla de motor en vuelo, para confirmar que está adentro y trabado.',
      errores: [
        'Cebar de más: el motor se “ahoga” (le sobra nafta) y no arranca.',
        'Dejarlo destrabado: puede chupar nafta de más y hacer andar el motor áspero.',
        'Cebar con el motor ya caliente: casi nunca hace falta.'
      ],
      truco: 'Como el cebador de una cortadora de pasto: un par de bombeos para que arranque, y después se guarda trabado.',
      dato: 'Si el motor se ahogó (arranca débil y larga humo negro): mezcla en corte (IDLE CUT-OFF), acelerador a fondo y hacé girar el motor con la llave unas cuantas vueltas; después repetí el arranque SIN cebar.',
      otrosModelos: 'Igual en todos los 150 modernos. En el 150M 1975 también está a la izquierda, junto al freno de estacionamiento.',
      rangos: [],
      relacionados: ['ignition', 'mixture', 'throttle', 'parking-brake', 'fuel-shutoff'],
      partesAvion: ['cowling'],
      probar: { tipo: 'accion', accion: 'primeStroke', etiqueta: 'Dar un bombeo' }
    },

    {
      id: 'ignition',
      nombre: 'Llave de encendido (magnetos)',
      otrosNombres: ['Llave de magnetos', 'Magnetos', 'Encendido', 'Arranque'],
      ingles: 'Ignition / starter switch (magnetos)',
      categoria: 'motor',
      prioridad: 1,
      ubicacion: 'Abajo a la izquierda del subpanel, fila de abajo: la cerradura con llave, a la derecha del master rojo. Cuando la traba de comandos está puesta, su bandera roja la tapa.',
      resumen: 'Elige qué magnetos hacen saltar la chispa y, en START, hace girar el motor para arrancar.',
      queHace: 'Los magnetos son dos pequeños generadores movidos por el propio motor que producen la chispa de las bujías. Cada cilindro tiene 2 bujías: el magneto derecho alimenta las de arriba y el izquierdo las de abajo. Como fabrican su propia electricidad, el motor sigue andando aunque apagues el master o se acabe la batería.',
      enElAvion: 'Posiciones, en sentido horario: OFF – R (sólo el magneto derecho) – L (sólo el izquierdo) – BOTH (los dos) – START. En START el motor de arranque, que es eléctrico, hace girar la hélice; al soltar la llave vuelve sola a BOTH.',
      comoSeUsa: [
        'Para arrancar: master ON, gritá “¡Libre la hélice!” y mirá que no haya nadie cerca.',
        'Girá la llave a START y soltala apenas el motor arranca: vuelve sola a BOTH.',
        'En los 30 segundos siguientes tiene que subir la presión de aceite; si no sube, apagá.',
        'En la prueba de motor (1700 RPM): R, de vuelta a BOTH, L, de vuelta a BOTH. Caída máxima 150 RPM en cada una y no más de 75 RPM de diferencia entre las dos.',
        'Volá siempre en BOTH.',
        'Para apagar: primero mezcla en corte; cuando la hélice se para, llave en OFF y sacala.'
      ],
      cuando: 'En el arranque, en la prueba de motor y al apagar. R y L se usan sólo para la prueba y en emergencias, por ejemplo para encontrar el magneto que falla si el motor tiembla.',
      errores: [
        'Creer que el master apaga el motor: el motor sigue, porque los magnetos no necesitan batería.',
        'Tocar la hélice “porque la llave está en OFF”: si se cortó un cable de masa, un magneto queda “vivo” y la hélice puede arrancar el motor. Tratá SIEMPRE la hélice como si estuviera viva.',
        'Seguir en START con el motor ya andando: dañás el motor de arranque.',
        'Quedarte en R o en L por olvido después de la prueba.'
      ],
      truco: 'Dos magnetos son dos sistemas independientes, como usar cinturón y tiradores a la vez. Y la regla de oro: “la hélice siempre está viva”.',
      dato: 'En la prueba de magnetos, que NO baje nada de RPM también es sospechoso: puede ser un magneto “caliente” (sin masa), peligrosa si alguien mueve la hélice con la mano. Avisale al instructor. La misma llave abre la puerta izquierda.',
      otrosModelos: 'Desde 1969 el arranque se hace con la llave (START). En los 150 anteriores, en general, la llave era sólo de magnetos y el motor de arranque se accionaba aparte, tirando de una manija.',
      rangos: [],
      relacionados: ['master', 'tachometer', 'oil-gauges', 'mixture', 'primer', 'control-lock'],
      partesAvion: ['propeller', 'spinner', 'cowling'],
      probar: { tipo: 'opciones', clave: 'ignition', valores: ['OFF', 'R', 'L', 'BOTH', 'START'] }
    },

    // ──────────────────────────────── COMBUSTIBLE ────────────────────────────────

    {
      id: 'fuel-shutoff',
      nombre: 'Válvula de corte de combustible',
      otrosNombres: ['Llave de combustible', 'Llave de nafta', 'Robinete (Argentina)'],
      ingles: 'Fuel shutoff valve (ON/OFF)',
      categoria: 'combustible',
      prioridad: 1,
      ubicacion: 'En el piso de la cabina, entre los dos asientos: una manija sobre una placa con el cartel “FUEL – 22.5 GALS – ON / OFF”.',
      resumen: 'Abre o cierra el paso de nafta de los dos tanques al motor; normalmente va siempre en ON.',
      queHace: 'El 150 tiene un tanque en cada ala y la nafta baja al motor por gravedad, sin bomba. Los dos tanques alimentan juntos: NO hay selector de izquierdo o derecho, sólo esta llave de abrir (ON) o cerrar (OFF).',
      enElAvion: 'Abre o cierra la cañería que va de los tanques al carburador. Con OFF, el motor puede seguir andando un rato con la nafta que queda en los caños y en el carburador, y después se para (a veces, justo en el despegue).',
      comoSeUsa: [
        'En el chequeo de cabina, antes de arrancar y antes de despegar: verificá que esté en ON.',
        'Mirá la manija contra las marcas ON y OFF de la placa: su forma y orientación cambian de un avión a otro, así que pedile al instructor que te la muestre en el tuyo.',
        'Normalmente queda asegurada en ON con un alambre fino que se rompe si de verdad necesitás cerrarla.',
        'Sólo se cierra (OFF) en emergencias, como un fuego en el motor o antes de un aterrizaje forzoso.'
      ],
      cuando: 'ON en los chequeos de cabina, antes del arranque y antes del despegue. OFF sólo en emergencias: fuego en el motor, falla del motor justo después de despegar o aterrizaje forzoso.',
      errores: [
        'Buscar un selector de tanque izquierdo o derecho como en otros aviones: en el 150 no existe.',
        'Suponer la posición de la manija sin mirar el cartel.',
        'Dejar cosas sueltas en el piso entre los asientos que puedan engancharla.'
      ],
      truco: 'Es la canilla de la nafta: abierta (ON) siempre, salvo que haya fuego.',
      dato: 'El cartel dice 22.5 galones porque es la nafta USABLE de los tanques estándar (26 en total); con tanques de largo alcance dice 35.0. El tanque izquierdo respira por un caño de ventilación debajo del ala izquierda, que se revisa en la inspección prevuelo.',
      otrosModelos: 'En los 150 es una llave de sólo ON/OFF, sin selector de tanques; en los más viejos la forma y el lugar exacto pueden variar. Desde 1973 sale de fábrica asegurada en ON con alambre. La forma y la orientación de la manija varían: guiate siempre por el cartel.',
      rangos: [],
      relacionados: ['fuel-gauges', 'primer', 'mixture', 'placards'],
      partesAvion: ['fuelCapL', 'fuelCapR', 'fuelVent', 'wingL', 'wingR'],
      probar: { tipo: 'toggle', clave: 'fuelValve', on: 'ON (abierta)', off: 'OFF (cerrada)' }
    },

    {
      id: 'fuel-gauges',
      nombre: 'Indicadores de combustible',
      otrosNombres: ['Medidores de nafta', 'Indicadores de cantidad de combustible', 'L FUEL / R FUEL'],
      ingles: 'Fuel quantity indicators (L FUEL / R FUEL)',
      categoria: 'combustible',
      prioridad: 1,
      ubicacion: 'Abajo a la izquierda, en la fila de arriba del subpanel, debajo de tu volante: un recuadro con dos relojitos, L FUEL (tanque izquierdo) y R FUEL (tanque derecho).',
      resumen: 'Dos agujas eléctricas que muestran cuánta nafta hay en cada tanque, de E (vacío) a F (lleno).',
      queHace: 'Cada tanque tiene un flotante, como el del depósito del inodoro, que sube y baja con la nafta y manda una señal eléctrica a su aguja. Necesitan electricidad: con el master apagado las dos agujas quedan en E aunque los tanques estén llenos. Sirven de referencia, pero no son precisas.',
      enElAvion: 'No mueven nada: sólo informan. Los flotantes están adentro de los tanques, en las alas.',
      comoSeUsa: [
        'Antes de volar, mirá SIEMPRE adentro de los tanques, sacando las tapas de arriba de las alas: es la única forma segura de saber cuánta nafta tenés.',
        'Con el master en ON, fijate que las agujas coincidan más o menos con lo que viste.',
        'En vuelo, miralas cada tanto con las alas niveladas y la bolita al centro.',
        'Planificá con el reloj y el consumo (unos 5 a 6 galones por hora), no sólo con las agujas.'
      ],
      cuando: 'En el chequeo de cabina (master ON y verificar), antes de despegar y de vez en cuando en crucero.',
      errores: [
        'Confiar sólo en las agujas: pueden marcar mal. Mirá siempre adentro de los tanques.',
        'Leerlas en vuelo descoordinado (con resbale o derrape): la nafta se va para un costado del tanque y la aguja miente.',
        'Pensar que en E queda algo para seguir volando: en E ya no hay nafta usable.',
        'Asustarse porque marcan E con el master apagado: sin electricidad no funcionan.'
      ],
      truco: 'Las agujas te dan una idea; la verdad está adentro del tanque. Y el reloj también es un medidor de nafta: horas de vuelo × consumo.',
      dato: 'En la raya roja de E todavía quedan 1,75 galones en cada tanque, pero no se pueden usar porque no llegan al motor. Tanques estándar: 26 galones en total y 22,5 usables. Largo alcance: 38 en total y 35 usables. Un galón son unos 3,8 litros.',
      otrosModelos: 'Desde 1976 están abajo a la izquierda, debajo del volante. En el 150M 1975 y anteriores estaban en el lado derecho del tablero, arriba de la guantera.',
      rangos: [
        { color: 'rojo', desde: 0, hasta: 0, unidad: 'gal', texto: 'Raya roja en E: no queda nafta usable. Igual quedan 1,75 galones en cada tanque que no llegan al motor.' }
      ],
      relacionados: ['fuel-shutoff', 'master', 'circuit-breakers', 'turn-coordinator', 'clock'],
      partesAvion: ['fuelCapL', 'fuelCapR', 'wingL', 'wingR'],
      probar: null
    },

    // ───────────────────────────── ELÉCTRICO Y LUCES ─────────────────────────────

    {
      id: 'master',
      nombre: 'Interruptor master (ALT/BAT)',
      otrosNombres: ['Master', 'Llave maestra', 'Interruptor general'],
      ingles: 'Master switch (ALT / BAT)',
      categoria: 'electrico',
      prioridad: 1,
      ubicacion: 'Abajo a la izquierda del subpanel, fila de abajo: el interruptor ROJO partido en dos, a la derecha del cebador. Mitad izquierda = ALT, mitad derecha = BAT.',
      resumen: 'Prende y apaga toda la electricidad del avión; ojo: NO apaga el motor.',
      queHace: 'La mitad BAT conecta la batería con todo el sistema eléctrico. La mitad ALT conecta el alternador, un generador movido por el motor que recarga la batería. Normalmente se mueven juntas, y están enganchadas entre sí: no podés tener ALT prendido con BAT apagado.',
      enElAvion: 'Con BAT en ON se energizan las luces, la radio, los flaps, el motor de arranque, los indicadores de combustible y de temperatura de aceite y el coordinador de giro. Con ALT en ON y el motor andando, el alternador alimenta todo y carga la batería. Arriba = ON, abajo = OFF.',
      comoSeUsa: [
        'Antes de prenderlo, verificá que la radio y todo lo eléctrico estén apagados.',
        'Para revisar algo en tierra sin motor (nafta, luces), alcanza con BAT.',
        'Para arrancar: master ON (las dos mitades) y después la llave.',
        'Si el amperímetro marca descarga en vuelo: ALT en OFF, apagá todo lo que no necesites y aterrizá apenas puedas.',
        'Si se prende la luz HIGH VOLTAGE: apagá las dos mitades y volvé a prenderlas; si vuelve, aterrizá lo antes posible.',
        'Al terminar: con el motor ya apagado, master OFF (si queda prendido, la batería se descarga).'
      ],
      cuando: 'En el chequeo de cabina (ON para mirar la nafta, después OFF), en el arranque, durante todo el vuelo y al apagar. En una emergencia eléctrica (humo u olor a quemado), OFF.',
      errores: [
        'Creer que apaga el motor: el motor sigue andando con el master en OFF, porque los magnetos hacen su propia electricidad.',
        'Prender el master o arrancar con la radio prendida: los picos de tensión pueden dañarla.',
        'Olvidarlo prendido al bajar del avión: el próximo vuelo empieza con la batería descargada.',
        'Volar mucho rato con ALT apagado: la batería se agota y después el alternador ya no se puede volver a conectar.'
      ],
      truco: 'Es como la llave general de la luz de tu casa: corta toda la electricidad. Pero el motor del avión tiene su propio “generador de chispa” (los magnetos) y sigue andando.',
      dato: 'Apagando sólo ALT con BAT prendido se prueba la luz HIGH VOLTAGE. El reloj y el horómetro de vuelo tienen cables propios: siguen andando aunque el master esté en OFF.',
      otrosModelos: 'El master partido ALT/BAT existe desde 1970; en 1969 era una sola tecla. Los 150 hasta 1966 tenían generador en vez de alternador. Muchos aviones tienen además un “avionics master” (interruptor de las radios) agregado después, que no venía de fábrica.',
      rangos: [],
      relacionados: ['ammeter', 'ignition', 'circuit-breakers', 'light-switches', 'fuel-gauges', 'navcom'],
      partesAvion: [],
      probar: { tipo: 'master' },
      subitems: [
        { subId: 'alt', nombre: 'ALT (alternador)', ingles: 'Alternator half (ALT)', texto: 'Mitad izquierda. Conecta el alternador, que con el motor andando genera la electricidad y recarga la batería. Si la apagás, la batería sostiene todo sola, por un tiempo limitado.' },
        { subId: 'bat', nombre: 'BAT (batería)', ingles: 'Battery half (BAT)', texto: 'Mitad derecha. Conecta la batería de 12 voltios con todo el sistema eléctrico. Sola alcanza para revisar cosas en tierra. Si la apagás, ALT también se apaga, porque están enganchadas.' }
      ]
    },

    {
      id: 'light-switches',
      nombre: 'Interruptores de luces y pitot',
      otrosNombres: ['Teclas de luces', 'Llaves de luces', 'Rockers'],
      ingles: 'Rocker switches (DOME LT, PITOT HT, NAV, STROBE, BCN, TAXI, LDG)',
      categoria: 'electrico',
      prioridad: 2,
      ubicacion: 'Abajo a la izquierda del subpanel, fila de abajo: una fila de 7 teclas blancas, a la derecha de las perillas de luces del panel. Las últimas cuatro están agrupadas bajo el cartel LIGHTS. Arriba = ON.',
      resumen: 'Siete teclas blancas: luz de cabina, calefacción del pitot y las luces de afuera del avión.',
      queHace: 'Prenden la luz del techo, calientan el tubo pitot y encienden las luces de afuera: navegación, destellos (strobes), baliza (beacon), rodaje y aterrizaje. Las luces de afuera sirven sobre todo para que OTROS te vean. Todas necesitan el master en ON.',
      enElAvion: 'Encienden luces en las puntas de las alas, en la cola, arriba de la deriva y en la nariz, y una resistencia que calienta el tubo pitot debajo del ala izquierda.',
      comoSeUsa: [
        'Arriba = ON, abajo = OFF.',
        'Antes de arrancar: BCN (baliza) ON, para avisarle a la gente que el motor va a arrancar.',
        'Al entrar a la pista: STROBE y LDG ON, para que te vean.',
        'De noche: NAV prendidas, y TAXI para ver la calle de rodaje.',
        'PITOT HT sólo con humedad visible (lluvia, nubes) y temperaturas bajas.',
        'Al terminar, apagá todo antes del master.'
      ],
      cuando: 'BCN desde antes de arrancar hasta el apagado. STROBE al entrar a la pista y en todo el vuelo. LDG para despegar y aterrizar. NAV y TAXI de noche. DOME para ver adentro de la cabina. PITOT HT con humedad visible y frío.',
      errores: [
        'Arrancar sin la baliza (BCN): la gente cerca no se entera de que la hélice va a girar.',
        'Dejar luces prendidas al bajar del avión: batería descargada.',
        'Creer que la calefacción del pitot permite volar con hielo: el 150 NO está aprobado para volar en condiciones de engelamiento.'
      ],
      truco: 'Como en los barcos: ROJA en la punta del ala izquierda (del lado del corazón), VERDE en la derecha y BLANCA en la cola.',
      dato: 'Cada grupo de luces tiene su disyuntor: BCN/PITOT, STROBE LTS, LDG LTS y NAV/DOME. La luz de mapa opcional que va debajo del volante del piloto sólo funciona con NAV encendida.',
      otrosModelos: 'Las strobes y las luces dobles de aterrizaje y rodaje eran opcionales en todas las versiones; la baliza, la luz de aterrizaje del capot y la calefacción del pitot eran estándar en el Commuter y opcionales en el Standard y el Aerobat. Hasta 1975, debajo de las teclas había fusibles en vez de disyuntores. Fijate qué tiene tu avión.',
      rangos: [],
      relacionados: ['master', 'circuit-breakers', 'dimmers', 'asi', 'ammeter'],
      partesAvion: ['navLightL', 'navLightR', 'navLightTail', 'beacon', 'strobes', 'landingLight', 'pitotTube'],
      probar: { tipo: 'luces' },
      subitems: [
        { subId: 'dome', nombre: 'DOME LT (luz de techo)', ingles: 'Dome light', texto: 'Luz blanca en la parte de atrás de la consola del techo, para ver adentro de la cabina: subir, ordenar cosas, buscar un mapa. De noche en vuelo casi no se usa, porque encandila.' },
        { subId: 'pitot', nombre: 'PITOT HT (calefacción del pitot)', ingles: 'Pitot heat', texto: 'Calienta el tubo pitot (debajo del ala izquierda) para que el hielo no lo tape y el velocímetro siga funcionando. Se usa con humedad visible (lluvia, nubes) y frío. Es sólo una protección: el 150 no está aprobado para volar con hielo.' },
        { subId: 'nav', nombre: 'NAV (luces de navegación)', ingles: 'Navigation (position) lights', texto: 'Luces fijas: roja en la punta del ala izquierda, verde en la derecha y blanca en la cola. De noche le muestran a los demás hacia dónde vas.' },
        { subId: 'strobe', nombre: 'STROBE (destellos)', ingles: 'Strobe lights', texto: 'Flashes blancos muy fuertes en las puntas de las alas. Se prenden al entrar a la pista y quedan prendidos en vuelo, para que te vean de lejos.' },
        { subId: 'beacon', nombre: 'BCN (baliza)', ingles: 'Rotating beacon', texto: 'Luz roja intermitente arriba de la deriva. Se prende ANTES de arrancar para avisar “ojo, motor en marcha” y queda prendida mientras el motor anda; al terminar se apaga con las demás luces, justo antes de cortar el motor.' },
        { subId: 'taxi', nombre: 'TAXI (luz de rodaje)', ingles: 'Taxi light', texto: 'Ilumina adelante para rodar de noche o con poca luz. Va en la nariz, junto a la de aterrizaje (las luces dobles eran opcionales: fijate si tu avión las tiene).' },
        { subId: 'landing', nombre: 'LDG (luz de aterrizaje)', ingles: 'Landing light', texto: 'Faro potente en la nariz (en el capot). Se usa para despegar y aterrizar; de día también te hace más visible para otros aviones.' }
      ]
    },

    {
      id: 'dimmers',
      nombre: 'Reóstatos de luces (PANEL LT / RADIO LT)',
      otrosNombres: ['Dimmer', 'Perillas de brillo', 'Reguladores de luz'],
      ingles: 'Panel and radio light dimmers (PANEL LT / RADIO LT)',
      categoria: 'electrico',
      prioridad: 3,
      ubicacion: 'Abajo a la izquierda del subpanel, fila de abajo: dos perillas en el mismo eje (una más chica delante de la otra), a la derecha de la llave de encendido y antes de las teclas blancas. Tienen una flecha BRT (más brillo).',
      resumen: 'Regulan el brillo de la luz roja que ilumina los instrumentos y de la luz de las radios.',
      queHace: 'PANEL LT regula una luz roja que está adelante en la consola del techo y alumbra todo el tablero desde arriba. RADIO LT regula la luz propia de las radios y de la brújula. Girando hacia BRT dan más luz; para el otro lado, menos, hasta apagarse.',
      enElAvion: 'No mueven nada afuera: sólo cambian la luz dentro de la cabina.',
      comoSeUsa: [
        'De día dejalas apagadas o al mínimo.',
        'Al atardecer o de noche, subí PANEL LT hasta leer bien los instrumentos sin encandilarte.',
        'Ajustá RADIO LT para leer las frecuencias y la brújula.',
        'Usá el brillo mínimo que te deje leer: tus ojos se acostumbran a la oscuridad y ves mejor afuera.'
      ],
      cuando: 'Al atardecer, de noche o en días muy oscuros. De día, casi nunca.',
      errores: [
        'Ponerlas a fondo de noche: el brillo te encandila y te cuesta ver afuera.',
        'Buscar de dónde sale la luz del panel en el tablero: viene del techo, de la consola.'
      ],
      truco: 'Como el dimmer de la luz del living: girás y regulás. Y la luz es roja para no arruinarte la vista nocturna.',
      dato: 'La luz del tablero es roja porque el rojo es el color que menos afecta la adaptación de los ojos a la oscuridad: cuando volvés a mirar afuera, seguís viendo bien.',
      otrosModelos: 'Igual en los 150M; en los de 1975 y antes el subpanel está ordenado distinto. Muchos aviones tienen radios modernas con su propio ajuste de brillo.',
      rangos: [],
      relacionados: ['light-switches', 'master', 'compass', 'navcom'],
      partesAvion: [],
      probar: { tipo: 'perilla', clave: 'panelLights', paso: 0.1, min: 0, max: 1, formato: 'porcentaje' }
    },

    {
      id: 'circuit-breakers',
      nombre: 'Disyuntores (circuit breakers)',
      otrosNombres: ['Breakers', 'Disyuntores', 'Llaves térmicas'],
      ingles: 'Circuit breakers',
      categoria: 'electrico',
      prioridad: 2,
      ubicacion: 'En la fila de abajo del subpanel, a la derecha de la rueda del compensador, debajo de los controles del motor: una fila de botones negros redondos con números blancos (los amperes).',
      resumen: 'Botones que cortan solos un circuito eléctrico cuando hay una falla, para que no se queme.',
      queHace: 'Son como las llaves térmicas de tu casa: si un circuito consume de más (por ejemplo, por un cortocircuito), el botón “salta” hacia afuera y corta ese circuito. Cada uno tiene escrito qué protege y cuántos amperes aguanta: ALT, FUEL IND, BCN/PITOT, STROBE LTS, LDG LTS, FLAP, INST LTS, NAV/DOME y las radios. Cuando uno saltó, asoma más que los otros y se ve una franja blanca.',
      enElAvion: 'Cuando uno salta, deja de funcionar lo que protege: si salta FLAP, los flaps no se mueven; si salta FUEL IND, los indicadores de combustible no marcan.',
      comoSeUsa: [
        'Antes de arrancar: mirá que estén todos adentro.',
        'Si algo eléctrico deja de andar en vuelo, buscá si su disyuntor saltó.',
        'Esperá un momento a que se enfríe y empujalo para reponerlo UNA sola vez.',
        'Si vuelve a saltar, dejalo afuera: hay una falla. Avisale al mecánico al aterrizar.',
        'Si hay olor a quemado o humo, no repongas nada.'
      ],
      cuando: 'En el chequeo antes de arrancar (“disyuntores: verificar adentro”) y cada vez que algo eléctrico deja de funcionar.',
      errores: [
        'Reponerlo una y otra vez: si salta de nuevo hay un problema real, y forzarlo puede provocar un incendio eléctrico.',
        'No mirarlos en el chequeo: arrancás con un circuito cortado sin darte cuenta.',
        'Reponer un disyuntor cuando hay olor a quemado o humo.'
      ],
      truco: 'Es la llave térmica de tu casa. Regla: se repone una vez; si salta dos veces, se queda afuera.',
      dato: 'El reloj, el horómetro de vuelo y el enchufe para corriente externa tienen fusibles aparte, cerca de la batería. Y detrás del panel hay un disyuntor que se repone solo y protege al alternador.',
      otrosModelos: 'Los disyuntores llegaron en 1976. Hasta 1975 el 150 tenía fusibles: tapitas negras que se desenroscan para cambiar el fusible. En 1977 los disyuntores están en dos grupos, separados por la ranura de la palanca de flaps.',
      rangos: [],
      relacionados: ['master', 'ammeter', 'light-switches', 'flap-switch', 'fuel-gauges', 'navcom'],
      partesAvion: [],
      probar: null
    },

    {
      id: 'ammeter',
      nombre: 'Amperímetro y luz HIGH VOLTAGE',
      otrosNombres: ['Amperímetro', 'Luz de sobretensión', 'HIGH VOLTAGE'],
      ingles: 'Ammeter and over-voltage light (HIGH VOLTAGE)',
      categoria: 'electrico',
      prioridad: 2,
      ubicacion: 'Arriba a la derecha del tablero, casi en el borde: un relojito chico con el cero en el medio. Justo debajo está la lucecita roja HIGH VOLTAGE.',
      resumen: 'Te muestra si el alternador está cargando la batería (+) o si la batería se está gastando (−).',
      queHace: 'Mide la corriente (los amperes) que entra o sale de la batería. Aguja a la derecha (+): el alternador carga la batería, todo bien. Aguja a la izquierda (−): la batería está entregando electricidad porque el alternador no alcanza o no funciona. La luz roja HIGH VOLTAGE avisa que la tensión subió demasiado y que el sistema desconectó el alternador.',
      enElAvion: 'No mueve nada: te cuenta cómo está el sistema eléctrico, que tiene un alternador de 60 amperes movido por el motor y una batería de 12 voltios. El dial no tiene arcos de colores: sólo + a la derecha, 0 al medio y − a la izquierda.',
      comoSeUsa: [
        'Recién arrancado, es normal ver mucha carga (+): el alternador repone lo que gastó el arranque.',
        'Después de unos 30 minutos de crucero, la carga tiene que ser chica: menos de dos anchos de aguja.',
        'En la prueba de motor, verificá que no marque descarga.',
        'Descarga continua en vuelo: falló el alternador. ALT en OFF, apagá lo que no sea necesario y aterrizá lo antes posible.',
        'Si se prende HIGH VOLTAGE: master OFF (las dos mitades) y otra vez ON. Si vuelve, aterrizá lo antes posible: la batería dura poco.'
      ],
      cuando: 'Después de arrancar, en la prueba de motor y con miradas de rutina en vuelo. Enseguida, si se prende la luz HIGH VOLTAGE.',
      errores: [
        'Asustarse por la carga alta justo después de arrancar: es normal.',
        'No mirarlo nunca: una descarga lenta pasa desapercibida hasta que se apagan la radio y los flaps.',
        'Seguir el vuelo como si nada con descarga continua: la batería se agota y perdés radio, flaps e indicadores eléctricos.'
      ],
      truco: 'Pensalo como la cuenta del banco de la batería: + es depositar (carga), − es sacar (descarga). Un ratito en negativo se aguanta; todo el vuelo, no.',
      dato: 'Cuando la luz HIGH VOLTAGE se prende, un sensor detectó unos 16 voltios y apagó el alternador para proteger los equipos: desde ese momento todo funciona con la batería. Se prueba en tierra apagando sólo ALT con BAT prendido. El motor sigue andando igual, porque no depende de la batería.',
      otrosModelos: 'La luz HIGH VOLTAGE existe desde 1972. En el 150M 1975 el amperímetro también está a la derecha, cerca del tacómetro. Muchos aviones tienen hoy un voltímetro o un monitor eléctrico agregado.',
      rangos: [
        { color: 'verde', desde: 0, hasta: 60, unidad: 'A', texto: 'Lado + (aguja a la derecha del cero): el alternador carga la batería. Mucha carga justo después de arrancar es normal; después de 30 minutos de crucero, menos de dos anchos de aguja.' },
        { color: 'amarillo', desde: -60, hasta: 0, unidad: 'A', texto: 'Lado − (aguja a la izquierda del cero): la batería se descarga. Un instante al prender algo grande es normal; continuo en vuelo quiere decir que el alternador no está cargando.' },
        { color: 'rojo', desde: 16, hasta: 16, unidad: 'V', texto: 'Luz roja HIGH VOLTAGE: la tensión llegó a unos 16 voltios y el sistema desconectó el alternador. Master OFF y ON; si vuelve, aterrizá lo antes posible.' }
      ],
      relacionados: ['master', 'circuit-breakers', 'light-switches', 'ignition', 'flap-switch'],
      partesAvion: [],
      probar: null
    }

  ]);
})(root.C150);
