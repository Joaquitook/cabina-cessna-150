var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * controls-b.js — Fichas de los controles de las categorías vuelo, sistemas, radio y cabina
 * (Cessna 150M 1976). Agrega entradas a C150.DATA.controls; las categorías y C150.DATA.meta
 * las define controls-a.js.
 *
 * Convenciones de este archivo (interpretación del contrato §4 y §7):
 *  - Todas las entradas traen las mismas claves. `rangos` es [] cuando el ítem no tiene marcas
 *    de color; `subitems` sólo existe en 'doors' (subIds 'left', 'right', 'window').
 *  - En `rangos`, una RAYA (por ejemplo la raya roja de 141 kt) se escribe con desde === hasta.
 *    Unidades usadas: 'kt', 'RPM', 'psi', '°F', 'inHg'. Los números siguen la variante 150M;
 *    las marcas del A150M Aerobat están descritas en `otrosModelos` (C150.Sim.limits las dibuja).
 *  - `probar` de tipo 'perilla' usa `formato`: 'inHg' (ajuste del altímetro en pulgadas de
 *    mercurio; la UI puede mostrar también hPa = inHg × 33,8639) o 'grados' (0–359°).
 *  - En el texto los decimales van con coma, como se escribe en Uruguay (29,92 inHg; 4,6 inHg).
 */
(function (C150) {
  'use strict';

  C150.DATA = C150.DATA || {};

  C150.DATA.controls = (C150.DATA.controls || []).concat([

    // ───────────────────────────── INSTRUMENTOS DE VUELO ─────────────────────────────

    {
      id: 'asi',
      nombre: 'Velocímetro (anemómetro)',
      otrosNombres: ['Anemómetro', 'Indicador de velocidad', 'Velocímetro', 'ASI'],
      ingles: 'Airspeed indicator (ASI)',
      categoria: 'vuelo',
      prioridad: 1,
      ubicacion: 'Panel principal, fila de arriba, el primero de la izquierda, al lado del horizonte artificial.',
      resumen: 'Te dice a qué velocidad se mueve el avión a través del aire, en nudos.',
      queHace: 'Mide la velocidad respecto del aire, no del suelo. Compara el aire que choca de frente en el tubo pitot (un tubito debajo del ala izquierda que mira hacia adelante) con el aire quieto de la toma estática (un agujerito en el costado izquierdo del fuselaje, el cuerpo del avión). Más rápido = más diferencia = más gira la aguja. No usa electricidad ni vacío.',
      enElAvion: 'No mueve nada: sólo informa. Lo importante afuera es que el tubo pitot (debajo del ala izquierda) y la toma estática (costado izquierdo, cerca de la nariz) estén destapados. Si dejás puesta la funda del pitot, la aguja se queda en cero aunque el avión corra por la pista.',
      comoSeUsa: [
        'Leé la escala de afuera, que está en nudos (KNOTS). La de adentro está en millas por hora (MPH): no las mezcles.',
        'Mirá en qué color está la aguja: blanco = podés usar flaps, verde = normal, amarillo = sólo con aire calmo, raya roja = nunca.',
        'En el despegue, al llegar a 50 nudos levantás suave la rueda de nariz (rotación) y después subís a 60–70 nudos.',
        'En vuelo, la velocidad se maneja sobre todo con la actitud (la posición de la nariz): nariz un poco abajo = más velocidad; nariz arriba = menos.',
        'Para aproximar: 60–70 nudos sin flaps y 50–60 con flaps. Si te desviás, corregí actitud y potencia con calma; no persigas la aguja.',
        'Con turbulencia la aguja salta con cada ráfaga: mirá el promedio, no cada salto.'
      ],
      cuando: 'Todo el vuelo, con miradas rápidas: rotación (50), subida (60–70; Vy 68 para subir más rápido, Vx 56 para subir más empinado), crucero, planeo si falla el motor (60) y aproximación (60–70 sin flaps, 50–60 con flaps, 52 en pista corta). Antes de bajar flaps, confirmá que la aguja está en el arco blanco (85 o menos). El viento cruzado máximo demostrado del 150M es 13 nudos.',
      errores: [
        'Leer la escala de MPH como si fueran nudos: es un error grande (60 mph son apenas unos 52 nudos).',
        'Olvidar la funda del pitot puesta: en la carrera de despegue la aguja no se mueve. Si no ves la velocidad subiendo, abortá el despegue.',
        'Confundir velocidad en el aire con velocidad sobre el suelo: con viento de frente el suelo pasa despacio, pero el ala vuela con lo que marca el velocímetro.',
        'Creer que la pérdida pasa siempre a 47 nudos: inclinado, la velocidad de pérdida sube (sin flaps, a 60° de inclinación es 66 nudos).'
      ],
      truco: 'Pensalo como un semáforo: blanco = flaps, verde = andá tranquilo, amarillo = cuidado (sólo aire calmo), rojo = nunca.',
      dato: 'Marca la velocidad indicada (IAS). La velocidad verdadera (TAS) es mayor cuanto más alto volás, porque el aire es más fino; pero al ala le importa la indicada, por eso el manual da todo en IAS. La velocidad de maniobra (Va, 97 nudos a 1600 lb) no está pintada en el dial, y baja si el avión va más liviano: 93 nudos a 1450 lb y 88 a 1300 lb.',
      otrosModelos: 'Hasta 1975 el velocímetro del 150 marcaba principalmente en millas por hora, con otros números (por ejemplo, raya roja en 162 mph). Desde 1976 marca en nudos. El Aerobat A150M 1976–77, que también vuela en Uruguay, tiene otros límites: nunca exceder 164 nudos, arco verde hasta 123 y Va 105 (el resto, en su manual). Muchos instrumentos se cambiaron con los años: leé el dial de TU avión.',
      rangos: [
        { color: 'blanco', desde: 42, hasta: 85, unidad: 'kt', texto: 'Arco blanco: zona para usar flaps. Abajo (42) es la pérdida con flaps a fondo (Vso); arriba (85) es la velocidad máxima con flaps (Vfe).' },
        { color: 'verde', desde: 47, hasta: 107, unidad: 'kt', texto: 'Arco verde: operación normal. Abajo (47) es la pérdida sin flaps (Vs1); arriba (107) es la máxima para aire con turbulencia (Vno).' },
        { color: 'amarillo', desde: 107, hasta: 141, unidad: 'kt', texto: 'Arco amarillo: precaución. Sólo con aire calmo y con mandos suaves.' },
        { color: 'rojo', desde: 141, hasta: 141, unidad: 'kt', texto: 'Raya roja: nunca exceder (Vne). Pasarla puede dañar el avión.' }
      ],
      relacionados: ['attitude', 'altimeter', 'vsi', 'stall-warning', 'flap-switch', 'yoke', 'throttle', 'light-switches'],
      partesAvion: ['pitotTube', 'staticPort', 'wingL'],
      probar: null
    },

    {
      id: 'attitude',
      nombre: 'Horizonte artificial',
      otrosNombres: ['Indicador de actitud', 'Horizonte', 'AI'],
      ingles: 'Attitude indicator (artificial horizon)',
      categoria: 'vuelo',
      prioridad: 1,
      ubicacion: 'Panel principal, fila de arriba, segundo desde la izquierda: justo arriba del direccional y un poco a la izquierda de la columna de tu volante.',
      resumen: 'Una ventanita al horizonte: te muestra si la nariz está arriba o abajo y cuánto estás inclinado.',
      queHace: 'Muestra la actitud del avión: hacia dónde apunta la nariz y cuánto están inclinadas las alas. Adentro tiene un giróscopo: un trompo que gira muy rápido y por eso se queda firme aunque el avión se mueva. Lo hace girar el aire que chupa la bomba de vacío, que va adelante en el motor. El avioncito está fijo a la caja; el fondo (cielo celeste, tierra marrón) lo sostiene el giróscopo.',
      enElAvion: 'No mueve nada. Depende de la bomba de vacío del motor: con el motor parado no hay vacío y el horizonte se va cayendo de a poco. Por eso fijate siempre que el indicador de succión esté en verde (4,6 a 5,4).',
      comoSeUsa: [
        'Mirá el avioncito del centro contra la línea del horizonte: si está arriba de la línea, la nariz está arriba; si está abajo, la nariz está abajo.',
        'Para la inclinación, mirá el índice de arriba contra las marcas de 10, 20, 30, 60 y 90 grados.',
        'Con la perilla de abajo subís o bajás el avioncito, para que quede justo sobre la línea cuando vas nivelado.',
        'Después de arrancar, dale unos minutos al giróscopo para tomar vueltas: hasta entonces puede estar torcido o tambalearse.',
        'Usalo para confirmar. Tus ojos tienen que estar casi siempre afuera, mirando el horizonte de verdad.'
      ],
      cuando: 'Para confirmar actitud e inclinación de un vistazo, sobre todo en los virajes. Es el instrumento principal cuando no se ve el horizonte (vuelo por instrumentos), pero vos, de alumno, vas a volar mirando afuera: unos 4 o 5 segundos afuera por cada segundo adentro.',
      errores: [
        'Quedarte mirándolo y no mirar afuera: el horizonte real es más grande y no falla.',
        'Creerle con la succión baja: si falla el vacío, se inclina despacito y de forma muy creíble. Cruzalo con el indicador de succión y con el coordinador de giro.',
        'Leerlo apenas arrancaste, antes de que el giróscopo tome vueltas.',
        'Después de virajes largos o aceleraciones fuertes puede quedar con un pequeño error un rato (precesión: el trompo se desvía un poquito).'
      ],
      truco: '“Es una ventanita al horizonte de verdad.” Si podés ver el horizonte real, mirá afuera; el instrumento sólo confirma.',
      dato: 'El avioncito está fijo a la caja: el que se mueve es el fondo. Por eso, cuando inclinás a la derecha, ves la línea del horizonte inclinarse para el otro lado, igual que el horizonte real a través del parabrisas.',
      otrosModelos: 'En el 150 los giróscopos de vacío eran opcionales: el paquete Commuter los traía, pero un 150 básico (Standard) puede no tener horizonte ni direccional. En el Aerobat A150M también eran opcionales. Fijate qué tiene tu avión.',
      rangos: [],
      relacionados: ['suction', 'heading-indicator', 'turn-coordinator', 'yoke', 'vsi'],
      partesAvion: ['wingL', 'wingR', 'cowling'],
      probar: null
    },

    {
      id: 'altimeter',
      nombre: 'Altímetro',
      otrosNombres: ['Altímetro barométrico', 'ALT'],
      ingles: 'Altimeter',
      categoria: 'vuelo',
      prioridad: 1,
      ubicacion: 'Panel principal, fila de arriba, a la derecha del reloj chico y del horizonte artificial, un poco a la derecha de la columna de tu volante.',
      resumen: 'Te dice tu altura en pies sobre el nivel del mar, si le cargaste la presión correcta (QNH).',
      queHace: 'Es un barómetro que muestra altura en vez de presión. Adentro tiene cápsulas de metal selladas que se inflan cuando subís, porque afuera hay menos presión, como un globo que se agranda en la montaña. Toma el aire quieto de la toma estática, un agujerito en el costado izquierdo del fuselaje. Como la presión del aire cambia con el clima, con la perilla le decís la presión del día: eso es el QNH.',
      enElAvion: 'No mueve nada en el avión. Depende de la toma estática, en el costado izquierdo cerca de la nariz, que tiene que estar destapada. No usa electricidad ni vacío.',
      comoSeUsa: [
        'Mirá las tres agujas: la larga marca cientos de pies (una vuelta = 1000 pies), la corta marca miles y la finita con triángulo marca decenas de miles.',
        'Ejemplo: aguja corta pasando el 2 y larga en el 5 = 2500 pies.',
        'Pedí el QNH a la torre: en Uruguay te lo dan en hectopascales (hPa), por ejemplo “QNH 1013”. Cargalo con la perilla de abajo a la izquierda, mirando la ventanilla de Kollsman (la ventanita con números de presión).',
        'Si tu ventanilla está sólo en pulgadas de mercurio (inHg), convertí: 1013 hPa = 29,92 inHg; 1023 hPa = 30,21; 1006 hPa = 29,71.',
        'Chequeo en tierra: con el QNH puesto, el altímetro tiene que mostrar la elevación del aeródromo (en esta app, 100 pies).'
      ],
      cuando: 'Antes de despegar (cargar el QNH y comprobar la elevación del aeródromo), durante todo el vuelo para mantener la altura del circuito o de la zona de práctica, y cada vez que la torre te da un QNH nuevo.',
      errores: [
        'Leer mal la aguja corta y equivocarte por 1000 pies: es el error clásico.',
        'Mezclar hectopascales con pulgadas de mercurio al cargar la ventanilla.',
        'Olvidarte de cargar el QNH antes de despegar.',
        'No actualizarlo: si la presión baja y no lo corregís, el altímetro te muestra más alto de lo que estás (con QNH 1006 y el altímetro en 29,92 marca unos 200 pies de más).'
      ],
      truco: '“De alta a baja, cuidado abajo”: si pasás de presión alta a presión baja (o a aire más frío) sin corregir, estás más bajo de lo que dice el altímetro.',
      dato: 'Reglas rápidas: 1 hPa son unos 27 a 30 pies, 0,01 inHg son unos 10 pies y 1 inHg son unos 1000 pies. Preguntale a tu instructor si el altímetro de tu avión muestra también hPa (milibares) o sólo inHg.',
      otrosModelos: 'En los 150 fabricados en Estados Unidos lo normal es una ventanilla sólo en inHg; el altímetro con escala en milibares (hPa) era opcional. En 1975 el 150M básico traía un altímetro menos sensible y el Commuter uno sensible. Algunos aviones tienen además un altímetro codificador, que le pasa la altura al transpondedor. En esta app la ventanilla muestra inHg y hPa.',
      rangos: [],
      relacionados: ['vsi', 'asi', 'attitude', 'transponder'],
      partesAvion: ['staticPort'],
      probar: { tipo: 'perilla', clave: 'altimeterSetting', paso: 0.01, min: 28.1, max: 31.0, formato: 'inHg' }
    },

    {
      id: 'turn-coordinator',
      nombre: 'Coordinador de giro (y la bolita)',
      otrosNombres: ['Coordinador de virajes', 'La bolita', 'Inclinómetro', 'TC'],
      ingles: 'Turn coordinator (with inclinometer / ball)',
      categoria: 'vuelo',
      prioridad: 1,
      ubicacion: 'Panel principal, fila de abajo, el primero de la izquierda, justo debajo del velocímetro.',
      resumen: 'Te muestra si estás virando y hacia dónde; la bolita te dice si usás bien los pedales.',
      queHace: 'El avioncito se inclina cuando el avión vira y muestra qué tan rápido virás, no cuánto estás inclinado. Adentro tiene un giróscopo eléctrico: sigue andando si falla el vacío, pero necesita el master prendido. Abajo hay una bolita en un tubo curvo con líquido, como un nivel de albañil: centrada = vuelo coordinado. No muestra si la nariz está arriba o abajo, y lo dice en su cara: “NO PITCH INFORMATION”.',
      enElAvion: 'No mueve nada. La bolita refleja lo que hacés con los pedales y el timón de dirección (la parte móvil de la cola vertical): si se va a un costado, la cola no está alineada con el aire y el avión vuela un poco de costado.',
      comoSeUsa: [
        'Mirá el ala del avioncito: si toca la marca L o R, estás haciendo un viraje estándar de 3 grados por segundo, una vuelta completa en 2 minutos.',
        'Mirá la bolita: tiene que estar en el centro, entre las dos rayitas.',
        'Si la bolita se va a un lado, pisala: apretá el pedal de ese lado (bolita a la derecha = pie derecho) hasta que vuelva al centro.',
        'Al empezar un viraje, mové volante y pedal juntos, hacia el mismo lado.',
        'En el rodaje, la bolita se mueve en las curvas: en tierra no le hagas caso.'
      ],
      cuando: 'En cada viraje, para chequear que vas coordinado, y al subir con mucha potencia, donde normalmente hace falta pie derecho. Si fallara el vacío, o si entrás sin querer en una nube, es el giróscopo que te queda.',
      errores: [
        'Creer que el avioncito muestra la inclinación: muestra la velocidad de giro. Para la inclinación mirá afuera o el horizonte artificial.',
        'Corregir la bolita con el volante: se corrige con los pies.',
        '“Pies perezosos”: no usar pedal en los virajes, y la bolita queda descentrada.',
        'Buscar en él si la nariz está arriba o abajo: no lo muestra.'
      ],
      truco: '“Pisá la bolita”: el pie que tenés que apretar es el del lado donde está la bolita.',
      dato: 'El manual trae un procedimiento por si entrás sin querer en una nube: un viraje estándar durante 60 segundos, usando el coordinador de giro, el reloj y la brújula, para dar media vuelta (180°). Se practica sólo con instructor.',
      otrosModelos: 'Algunos 150, sobre todo los más viejos, tienen un indicador de viraje y deslizamiento (“palo y bola”): una aguja vertical en lugar del avioncito, con la misma bolita abajo. En el 150 básico de 1975 era opcional; en el Commuter venía de serie.',
      rangos: [],
      relacionados: ['rudder-pedals', 'yoke', 'attitude', 'clock', 'compass', 'master', 'circuit-breakers'],
      partesAvion: ['rudder', 'fin', 'aileronL', 'aileronR'],
      probar: null
    },

    {
      id: 'heading-indicator',
      nombre: 'Indicador de rumbo (direccional)',
      otrosNombres: ['Direccional', 'Giro direccional', 'DG', 'HI'],
      ingles: 'Heading indicator (directional gyro)',
      categoria: 'vuelo',
      prioridad: 2,
      ubicacion: 'Panel principal, fila de abajo, debajo del horizonte artificial. Tu volante lo tapa en parte.',
      resumen: 'Una brújula que no baila: te muestra el rumbo estable, pero tenés que alinearla con la brújula.',
      queHace: 'Muestra hacia dónde apunta la nariz (el rumbo), en grados, con una rosa de los vientos que gira detrás de un avioncito fijo. Adentro tiene un giróscopo movido por la bomba de vacío del motor, que se mantiene quieto mientras el avión gira. No sabe dónde está el norte: se lo decís vos, copiando la brújula. Con el tiempo se va corriendo solo (precesión), así que hay que realinearlo.',
      enElAvion: 'No mueve nada. Depende de la bomba de vacío del motor: si la succión no está en verde (4,6 a 5,4), no le creas.',
      comoSeUsa: [
        'Leé el rumbo bajo la marca de arriba. Los números van sin el último cero: 6 = 060°, 33 = 330°.',
        'Antes de despegar, mirá la brújula y girá la perilla de abajo a la izquierda hasta que el direccional diga lo mismo.',
        'En vuelo, realinealo cada tanto (muchos instructores dicen cada 15 minutos), siempre en vuelo recto, nivelado y a velocidad constante.',
        'Para virar a un rumbo, guiate por el direccional y no por la brújula: en los virajes el direccional no se atrasa ni se adelanta.'
      ],
      cuando: 'Antes del despegue (para alinearlo), en vuelo para mantener o buscar un rumbo, y en el circuito para orientarte con la pista: por ejemplo, la pista 06 apunta a 060°.',
      errores: [
        'Olvidarte de alinearlo antes de despegar.',
        'Alinearlo mientras virás o mientras la brújula está bailando: copiás un número equivocado.',
        'Usarlo con la succión baja: si falla el vacío, se queda quieto o se corre sin avisar.',
        'Usarlo apenas arrancaste: el giróscopo necesita unos minutos para tomar vueltas.'
      ],
      truco: '“La brújula dice la verdad, pero sólo cuando está quieta; el direccional es tranquilo, pero olvidadizo.” Por eso se usan juntos.',
      dato: 'En Uruguay la variación magnética es de unos 12° Oeste (en Carrasco; cambia un poco con el lugar y los años): el norte de la brújula y el norte de los mapas no coinciden. Rumbo magnético = rumbo verdadero + 12°. El direccional, igual que la brújula, trabaja con rumbos magnéticos.',
      otrosModelos: 'Igual que el horizonte, era opcional en el 150: un 150 básico puede no tener direccional. Algunos aviones modernizados tienen uno eléctrico o una pantalla digital.',
      rangos: [],
      relacionados: ['compass', 'suction', 'attitude', 'vor-indicator'],
      partesAvion: ['cowling'],
      probar: { tipo: 'perilla', clave: 'hiCorrection', paso: 1, min: -180, max: 180, formato: 'grados' }
    },

    {
      id: 'vsi',
      nombre: 'Variómetro',
      otrosNombres: ['Indicador de velocidad vertical', 'Indicador de régimen de ascenso', 'VSI'],
      ingles: 'Vertical speed indicator (VSI)',
      categoria: 'vuelo',
      prioridad: 2,
      ubicacion: 'Panel principal, fila de abajo, debajo del altímetro.',
      resumen: 'Te dice si estás subiendo o bajando, y cuántos pies por minuto.',
      queHace: 'Muestra a qué ritmo subís o bajás, en cientos de pies por minuto. Adentro hay una cápsula que recibe el aire de la toma estática directo, y una caja alrededor que recibe el mismo aire pero por un agujerito muy fino (una fuga calibrada). Cuando cambiás de altura, la caja se queda atrás un momento y esa diferencia de presión mueve la aguja.',
      enElAvion: 'No mueve nada. Usa sólo la toma estática (costado izquierdo, cerca de la nariz); no necesita electricidad ni vacío.',
      comoSeUsa: [
        'Con la aguja en el 0 (a la izquierda, como las 9 en un reloj) no subís ni bajás.',
        'Aguja hacia arriba = subís; hacia abajo = bajás. Cada número son cientos de pies por minuto: 5 = 500 pies por minuto.',
        'Mirá primero hacia dónde arranca la aguja: la tendencia aparece enseguida, pero el número exacto tarda unos 6 a 9 segundos en asentarse.',
        'No la persigas: elegí una actitud y una potencia, esperá, y recién después hacé una corrección chica.'
      ],
      cuando: 'Para nivelar (cuando la aguja vuelve a 0), para subir o bajar a un ritmo parejo, y en la aproximación para ver si vas bajando suave.',
      errores: [
        'Perseguir la aguja con el volante: el avión empieza a subir y bajar como un sube y baja.',
        'Creer que el número es exacto en el momento: tiene atraso.',
        'Con turbulencia salta mucho: mirá el promedio y el altímetro.'
      ],
      truco: '“El variómetro te dice la tendencia enseguida, y la verdad un rato después.”',
      dato: 'En el manual del 150M se llama “rate-of-climb indicator” (indicador de régimen de ascenso). A nivel del mar y con motor a fondo, el manual da unos 670 pies por minuto de subida.',
      otrosModelos: 'En el 150 básico de 1975 era opcional; en el Commuter venía de serie. Si tu avión no lo tiene, mirás cómo cambia el altímetro.',
      rangos: [],
      relacionados: ['altimeter', 'attitude', 'asi', 'throttle'],
      partesAvion: ['staticPort'],
      probar: null
    },

    {
      id: 'compass',
      nombre: 'Brújula magnética',
      otrosNombres: ['Compás magnético', 'Brújula'],
      ingles: 'Magnetic compass',
      categoria: 'vuelo',
      prioridad: 2,
      ubicacion: 'Arriba, en el centro del parabrisas, sujeta a la estructura de la cabina. Al lado lleva pegada la tarjeta de desvíos.',
      resumen: 'La referencia de rumbo que nunca se apaga: no necesita electricidad ni vacío.',
      queHace: 'Es un imán pegado a una tarjeta con números, que flota en líquido dentro de una cajita: el imán siempre trata de apuntar al norte magnético. Como no necesita energía, anda aunque falle todo lo demás. El líquido frena el bamboleo, pero en virajes y aceleraciones igual marca mal.',
      enElAvion: 'No mueve nada. Las cosas metálicas o eléctricas cerca (radios, auriculares, un celular apoyado en el panel) la pueden desviar.',
      comoSeUsa: [
        'Leé el número detrás de la rayita del medio. Van sin el último cero: 3 = 030°, 24 = 240°; N = 360°, E = 090°, S = 180°, W = 270°.',
        'Leela sólo en vuelo recto, nivelado y a velocidad constante, y esperá a que se quede quieta.',
        'Corregí con la tarjeta de desvíos: dice cuántos grados sumar o restar en cada rumbo, para ESE avión.',
        'Con ese número alineá el direccional, y volá con el direccional.'
      ],
      cuando: 'Antes del despegue y cada tanto en vuelo, para alinear el direccional; y como respaldo si falla el vacío.',
      errores: [
        'Leerla durante un viraje o una aceleración: marca cualquier cosa.',
        'Usar las reglas de los libros de Estados Unidos: en Uruguay, que está en el hemisferio sur, los errores son al revés.',
        'Confundirte porque la tarjeta parece moverse al revés del viraje: en este tipo de brújula es normal.'
      ],
      truco: 'Errores del hemisferio sur, en castellano: SAND = “Sur al Acelerar, Norte al Desacelerar” (se nota en rumbos este u oeste). ONUS = virando hacia el Norte, pasate un poco de lo que marca; virando hacia el Sur, cortá antes.',
      dato: 'En Uruguay la variación magnética es de unos 12° Oeste (en Carrasco; cambia un poco con el lugar y los años): rumbo magnético = rumbo verdadero + 12°. En un viraje estándar, cerca del norte y del sur, el error de la brújula puede llegar a unos 30°.',
      otrosModelos: 'Todos los 150 tienen brújula magnética con líquido y luz interna (se regula con el reóstato RADIO LT). La tarjeta de desvíos es propia de cada avión: no sirve la de otro.',
      rangos: [],
      relacionados: ['heading-indicator', 'turn-coordinator', 'vor-indicator', 'dimmers'],
      partesAvion: [],
      probar: null
    },

    {
      id: 'clock',
      nombre: 'Reloj',
      otrosNombres: ['Reloj de a bordo'],
      ingles: 'Clock',
      categoria: 'vuelo',
      prioridad: 3,
      ubicacion: 'Reloj chico entre el horizonte artificial y el altímetro, más abajo que ellos y debajo de la plaquita con la matrícula.',
      resumen: 'Un reloj chico que anda siempre, para medir tiempos de vuelo, de combustible y de virajes.',
      queHace: 'Es un reloj de agujas chico, con una perilla para ponerlo en hora. Es eléctrico, pero tiene su propio fusible junto a la batería: anda aunque el master esté apagado, mientras haya batería. Sirve para cronometrar cosas del vuelo, como cuánto hace que despegaste o cuánto dura un viraje.',
      enElAvion: 'No mueve nada en el avión.',
      comoSeUsa: [
        'Ponelo en hora con la perilla antes de volar, o anotá la hora de despegue.',
        'Usalo para controlar el combustible: el 150M gasta más o menos 5 a 6 galones por hora.',
        'Para un viraje estándar (3° por segundo): 1 minuto = media vuelta (180°) y 2 minutos = vuelta completa.',
        'Miralo cada tanto para saber cuánto tiempo llevás en la zona de práctica.'
      ],
      cuando: 'Al despegar (anotar la hora), para controlar el combustible, en los virajes cronometrados y en algunos procedimientos de emergencia.',
      errores: [
        'No anotar la hora de despegue y después no saber cuánto llevás volando.',
        'Confundir el reloj con el horómetro del tacómetro: el horómetro cuenta horas de motor, no la hora del día.'
      ],
      truco: 'Anotá la hora de despegue en tu rodillera o en un papel: después todo se calcula desde ahí.',
      dato: 'El procedimiento del manual para salir de una nube en la que entraste sin querer usa el reloj: viraje estándar con el coordinador de giro durante 60 segundos, para dar media vuelta.',
      otrosModelos: 'En el 150 básico de 1975 el reloj era opcional; en el Commuter venía de serie. Muchos aviones tienen hoy un reloj digital con cronómetro.',
      rangos: [],
      relacionados: ['turn-coordinator', 'fuel-gauges', 'tachometer'],
      partesAvion: [],
      probar: null
    },

    {
      id: 'oat',
      nombre: 'Termómetro de aire exterior (OAT)',
      otrosNombres: ['Termómetro exterior', 'OAT'],
      ingles: 'Outside air temperature gauge (OAT)',
      categoria: 'vuelo',
      prioridad: 3,
      ubicacion: 'Varía según el avión. Lo más común: un relojito redondo en la parte de arriba del parabrisas, con una varilla (la sonda) que atraviesa el vidrio y queda afuera.',
      resumen: 'Te dice la temperatura del aire de afuera, clave para pensar en hielo en el carburador.',
      queHace: 'Es un termómetro de aguja, como el de un horno, cuya punta sensible (la sonda) está afuera, en el aire que pasa. No necesita electricidad. Te sirve para saber si hay riesgo de hielo en el carburador y cómo va a rendir el avión.',
      enElAvion: 'No mueve nada. Lo que te dice influye en dos cosas: el hielo en el carburador y la altitud de densidad (con calor el aire es más fino y el avión rinde como si estuviera más alto).',
      comoSeUsa: [
        'Fijate en qué escala estás leyendo: muchos marcan grados Celsius (°C) y Fahrenheit (°F).',
        'Antes de volar, comparalo con la temperatura del informe del aeródromo.',
        'Si marca menos de 21 °C y el aire está húmedo, el riesgo de hielo en el carburador es alto (y puede haber hasta con 38 °C).',
        'En días de calor, esperá un despegue más largo y una subida más floja.'
      ],
      cuando: 'Al preparar el vuelo y en vuelo, sobre todo en días húmedos (muy comunes en Uruguay) y al bajar con poca potencia.',
      errores: [
        'Pensar que el hielo en el carburador sólo pasa con frío: puede pasar con 20 °C o más si hay humedad.',
        'Leer °F como si fueran °C.',
        'Creerle en tierra con sol fuerte: la sonda se calienta y puede marcar de más.'
      ],
      truco: 'Uruguay es húmedo: si el termómetro marca menos de 21 °C, pensá “hielo en el carburador” antes de reducir potencia.',
      dato: 'El hielo en el carburador se forma aunque afuera no haga frío: al pasar por el carburador el aire se enfría de golpe y la humedad se congela. Es más probable con poca potencia, como en el descenso y la aproximación.',
      otrosModelos: 'En el 150 básico de 1975 era opcional; en el Commuter venía de serie. Su ubicación no figura en el manual y cambia de un avión a otro.',
      rangos: [],
      relacionados: ['carb-heat', 'tachometer'],
      partesAvion: [],
      probar: null
    },

    // ───────────────────────── INSTRUMENTOS DEL MOTOR Y SISTEMAS ─────────────────────────

    {
      id: 'tachometer',
      nombre: 'Tacómetro (RPM) y horómetro',
      otrosNombres: ['Cuentarrevoluciones', 'Cuentavueltas', 'RPM', 'Horómetro'],
      ingles: 'Tachometer (RPM) with hour meter',
      categoria: 'sistemas',
      prioridad: 1,
      ubicacion: 'Lado derecho del panel principal, fila de arriba, a la derecha de las radios (más o menos frente al acompañante).',
      resumen: 'Te dice cuántas vueltas por minuto da el motor: en el 150 es tu indicador de potencia.',
      queHace: 'Muestra las RPM (revoluciones por minuto) del motor, que son las mismas de la hélice porque van unidos. Lo mueve un cable que gira, conectado al motor, como el velocímetro de un auto viejo: no usa electricidad. Como la hélice es de paso fijo (sus palas no cambian de ángulo), las RPM son tu medida de potencia. Abajo tiene un horómetro (HOURS) que cuenta horas de motor.',
      enElAvion: 'Lo que ves afuera es la hélice: a más RPM, gira más rápido. Las RPM las cambiás con el acelerador, pero también cambian con la velocidad: si bajás la nariz y el avión acelera, suben solas; si subís, bajan.',
      comoSeUsa: [
        'Leé la aguja y multiplicá por 100: la escala dice “RPM × 100”. 24 = 2400 RPM.',
        'Prueba de motor: 1700 RPM. Al probar cada magneto la caída máxima es de 150 RPM, con no más de 75 de diferencia entre los dos.',
        'Al dar motor a fondo para despegar, al principio tiene que marcar entre 2460 y 2560 RPM. Si da menos, algo anda mal.',
        'Crucero: 2400 a 2500 RPM (más o menos 57 a 65 % de potencia).',
        'Nunca pases la raya roja de 2750. Ojo en los descensos: las RPM suben solas.'
      ],
      cuando: 'Después de arrancar (calentamiento a 1000 RPM), en la prueba de motor (1700), en el despegue, en crucero y cada vez que cambiás la potencia.',
      errores: [
        'Olvidar que la velocidad cambia las RPM: en un descenso rápido podés pasar la raya roja sin tocar el acelerador.',
        'No darte cuenta de una caída lenta e inexplicable de RPM en crucero: es el síntoma típico de hielo en el carburador. Calefacción del carburador a fondo.',
        'Confundir el horómetro con la hora del día.'
      ],
      truco: 'En el 150 no hay otro indicador de potencia: el tacómetro ES tu indicador de potencia. Movés el acelerador y mirás las RPM.',
      dato: 'Con la calefacción del carburador a fondo y motor a fondo perdés unas 200 a 250 RPM, porque el aire caliente es más liviano. En la prueba de motor, si al probar un magneto no hay NINGUNA caída, también es sospechoso: avisale al instructor, porque la hélice podría quedar “viva” aunque la llave esté en OFF.',
      otrosModelos: 'El 150L de 1974 tenía tres arcos verdes según la altura (2000–2550 a nivel del mar, 2000–2650 a 5000 pies y 2000–2750 a 10 000 pies). El horómetro del tacómetro cuenta horas de motor; algunos aviones tienen además un horómetro de vuelo aparte, que corre con la presión de aceite. Preguntá con cuál te cobra la escuela.',
      rangos: [
        { color: 'verde', desde: 2000, hasta: 2750, unidad: 'RPM', texto: 'Arco verde: rango normal de uso del motor.' },
        { color: 'rojo', desde: 2750, hasta: 2750, unidad: 'RPM', texto: 'Raya roja: máximo, 2750 RPM. A esas vueltas el motor da sus 100 HP.' }
      ],
      relacionados: ['throttle', 'carb-heat', 'ignition', 'mixture', 'oil-gauges'],
      partesAvion: ['propeller', 'spinner', 'cowling'],
      probar: null
    },

    {
      id: 'oil-gauges',
      nombre: 'Temperatura y presión de aceite',
      otrosNombres: ['Indicadores de aceite', 'OIL TEMP / OIL PRESS'],
      ingles: 'Oil temperature and oil pressure gauges',
      categoria: 'sistemas',
      prioridad: 1,
      ubicacion: 'Subpanel de abajo, a la izquierda, debajo de tu volante: un rectángulo con dos relojitos (OIL TEMP y OIL PRESS), a la derecha de los indicadores de combustible.',
      resumen: 'Los signos vitales del motor: la presión y la temperatura del aceite.',
      queHace: 'El aceite lubrica y enfría el motor, como la sangre en el cuerpo. La presión (OIL PRESS) llega por un caño de aceite directo desde el motor, así que no necesita electricidad. La temperatura (OIL TEMP) en el 150M 1976 es eléctrica: usa un sensor en el motor y necesita el master prendido. Si la presión cae y la temperatura sube, el motor está en problemas.',
      enElAvion: 'Miran el aceite del motor, que se revisa y se carga por una tapita del lado derecho del capó, atrás. Nunca se vuela con menos de 4 cuartos de galón (unos 3,8 litros); para vuelos de menos de 3 horas, cargá hasta 5, y para vuelos largos, 6.',
      comoSeUsa: [
        'Apenas arranca el motor, mirá la presión: tiene que subir dentro de 30 segundos (unos 60 si hace mucho frío). Si no sube, apagá el motor.',
        'En marcha, las dos agujas deben estar en el verde: presión 30 a 60 psi (libras por pulgada cuadrada) y temperatura 100 a 240 °F (38 a 116 °C).',
        'La temperatura reacciona despacio; la presión, enseguida.',
        'En la prueba de motor, chequealas junto con el amperímetro y la succión: todo en verde.'
      ],
      cuando: 'Justo después de arrancar (la presión), en la prueba de motor y cada tanto en vuelo, sobre todo en las subidas largas.',
      errores: [
        'No mirar la presión después de arrancar: es lo primero.',
        'Pensar que la temperatura está rota porque no marca con el master apagado: es eléctrica y sin energía no marca.',
        'Ignorar presión baja con temperatura normal: puede ser el instrumento, pero igual hay que aterrizar en el aeródromo más cercano.',
        'Seguir como si nada con presión baja y temperatura subiendo: el motor puede fallar pronto. Reducí potencia y elegí dónde aterrizar.'
      ],
      truco: '“Arrancó: presión.” Antes de hacer cualquier otra cosa después de arrancar, mirá que suba la presión de aceite.',
      dato: 'En las subidas largas y lentas el motor se calienta: por eso, para subir en ruta, el manual recomienda 65–75 nudos y no ir más lento. Con más velocidad entra más aire a enfriar el motor.',
      otrosModelos: 'En el 150M 1975 y anteriores, los indicadores de aceite y de combustible estaban del lado derecho del panel, arriba de la guantera, y en los modelos más viejos la temperatura probablemente era de lectura directa, no eléctrica. Desde 1976 están abajo a la izquierda.',
      rangos: [
        { color: 'rojo', desde: 10, hasta: 10, unidad: 'psi', texto: 'Presión: raya roja inferior, 10 psi. Es el mínimo, sólo aceptable en ralentí.' },
        { color: 'verde', desde: 30, hasta: 60, unidad: 'psi', texto: 'Presión: arco verde, funcionamiento normal.' },
        { color: 'rojo', desde: 100, hasta: 100, unidad: 'psi', texto: 'Presión: raya roja superior, 100 psi. Máximo.' },
        { color: 'verde', desde: 100, hasta: 240, unidad: '°F', texto: 'Temperatura: arco verde, normal (38 a 116 °C).' },
        { color: 'rojo', desde: 240, hasta: 240, unidad: '°F', texto: 'Temperatura: raya roja, máximo 240 °F (116 °C).' }
      ],
      relacionados: ['tachometer', 'ignition', 'master', 'ammeter', 'fuel-gauges'],
      partesAvion: ['oilDoor', 'cowling'],
      probar: null
    },

    {
      id: 'suction',
      nombre: 'Indicador de succión (vacío)',
      otrosNombres: ['Vacuómetro', 'Succión'],
      ingles: 'Suction gauge (vacuum gauge)',
      categoria: 'sistemas',
      prioridad: 2,
      ubicacion: 'Relojito chico a la izquierda del panel, a media altura entre las dos filas: entre el velocímetro y el coordinador de giro (a su izquierda) y los giróscopos (a su derecha).',
      resumen: 'Te dice si la bomba de vacío está moviendo bien al horizonte artificial y al direccional.',
      queHace: 'El horizonte artificial y el direccional giran gracias al aire que chupa una bomba de vacío que va adelante en el motor (vacío = presión más baja que la de afuera). Este relojito mide cuánta succión hay, en pulgadas de mercurio (inHg). Entre 4,6 y 5,4 los giróscopos andan bien; si está bajo, no les creas.',
      enElAvion: 'Depende de la bomba de vacío del motor: con el motor parado marca cero, y los giróscopos se frenan de a poco.',
      comoSeUsa: [
        'Con el motor en marcha, mirá que la aguja esté en el verde: 4,6 a 5,4 inHg.',
        'Chequealo en la prueba de motor, a 1700 RPM.',
        'En vuelo, miralo cada tanto, sobre todo si el horizonte o el direccional hacen algo raro.',
        'Si está bajo, dejá de usar el horizonte y el direccional y volá con lo que sigue andando: la vista afuera, el coordinador de giro, la brújula, el velocímetro, el altímetro y el variómetro.'
      ],
      cuando: 'En la prueba de motor y cada tanto en vuelo, como parte de la recorrida con la vista por los instrumentos.',
      errores: [
        'No mirarlo nunca: una falla de vacío es silenciosa y el horizonte se inclina despacito, de forma creíble.',
        'Creer que el coordinador de giro también falla: es eléctrico y sigue andando.'
      ],
      truco: '“Succión baja, giróscopos mentirosos.”',
      dato: 'Si falla el vacío te quedan: la vista afuera, el coordinador de giro (eléctrico), la brújula, y el velocímetro, el altímetro y el variómetro, que usan el aire del pitot y de la toma estática.',
      otrosModelos: 'Sólo existe si el avión tiene giróscopos de vacío, que en el 150 eran opcionales (venían con el paquete Commuter). Algunos aviones modernizados tienen giróscopos eléctricos.',
      rangos: [
        { color: 'verde', desde: 4.6, hasta: 5.4, unidad: 'inHg', texto: 'Arco verde: succión correcta para que los giróscopos funcionen bien.' }
      ],
      relacionados: ['attitude', 'heading-indicator', 'turn-coordinator'],
      partesAvion: ['cowling'],
      probar: null
    },

    {
      id: 'stall-warning',
      nombre: 'Bocina de pérdida',
      otrosNombres: ['Aviso de pérdida', 'Alarma de pérdida', 'Bocina'],
      ingles: 'Stall warning horn',
      categoria: 'sistemas',
      prioridad: 1,
      ubicacion: 'No tiene botón ni reloj: es una bocina que oís desde la esquina de arriba a la izquierda del parabrisas, junto al parante izquierdo. Su entrada de aire está afuera, en el borde de ataque (el borde de adelante) del ala izquierda.',
      resumen: 'Una bocina que suena de 5 a 10 nudos antes de que el ala entre en pérdida.',
      queHace: 'Te avisa que el ala está por entrar en pérdida: el aire está por despegarse de arriba del ala y la sustentación (la fuerza que te sostiene) se cae. Funciona sólo con aire: cuando el ala va muy levantada contra el viento, por un agujerito del borde del ala se chupa aire que hace sonar una lengüeta, como una armónica. Suena aunque el master esté apagado, y no se puede apagar.',
      enElAvion: 'Lo que cambia afuera es el ángulo de ataque, el ángulo entre el ala y el aire que le llega. Cuando es muy grande, la bocina suena; si lo seguís aumentando, el ala entra en pérdida y la nariz cae.',
      comoSeUsa: [
        'En la inspección prevuelo, probala: chupá suave por la entrada del ala izquierda a través de un pañuelo limpio. Si suena, está bien.',
        'En vuelo, si suena: aflojá el tirón del volante y bajá un poco la nariz para reducir el ángulo de ataque.',
        'Si el avión ya entró en pérdida: nariz abajo primero, después motor a fondo, alas niveladas y pedal para que no gire.',
        'En el aterrizaje es normal que suene justo antes de tocar la pista: quiere decir que estás volando lento, como corresponde.'
      ],
      cuando: 'En el prevuelo (la prueba), en los ejercicios de pérdida con instructor, en el redondeo del aterrizaje y siempre que vueles lento o tirando mucho del volante.',
      errores: [
        'Creer que la pérdida es sólo ir lento: es un tema de ángulo de ataque. Podés entrar en pérdida a cualquier velocidad si tirás fuerte del volante.',
        'Tirar más del volante cuando suena, para “subir”: es lo contrario de lo que hay que hacer.',
        'Olvidar que en los virajes la pérdida llega antes: sin flaps, a 60° de inclinación es a 66 nudos y no a 47.',
        'Chupar sin pañuelo en la prueba: podés tragar suciedad.'
      ],
      truco: '“Bocina = aflojá.” Cuando la escuches, lo primero es aflojar el tirón y bajar un poco la nariz.',
      dato: 'La velocidad de pérdida sube al inclinar (manual, 1600 lb, centro de gravedad adelante): sin flaps, 47 nudos nivelado, 51 a 30°, 56 a 45° y 66 a 60°. Con flaps a 40°: 42, 45, 50 y 59.',
      otrosModelos: 'Es neumática (de aire) desde el 150F de 1966; los 150 anteriores tenían un aviso de pérdida eléctrico.',
      rangos: [],
      relacionados: ['asi', 'yoke', 'flap-switch', 'rudder-pedals', 'throttle'],
      partesAvion: ['stallWarningInlet', 'wingL'],
      probar: null
    },

    // ───────────────────────────── RADIO Y NAVEGACIÓN ─────────────────────────────

    {
      id: 'navcom',
      nombre: 'Radio NAV/COM',
      otrosNombres: ['Radio', 'Nav/Com', 'COM', 'NAV'],
      ingles: 'NAV/COM radio',
      categoria: 'radio',
      prioridad: 2,
      ubicacion: 'En la pila de radios del centro del panel, un poco a la derecha. En la configuración original es el equipo de más arriba.',
      resumen: 'La radio para hablar con la torre (COM) y para recibir radioayudas de navegación (NAV).',
      queHace: 'Son dos radios en una misma caja. La parte COM sirve para hablar y escuchar a la torre y a otros aviones: elegís la frecuencia (el “canal”) y hablás apretando el botón del micrófono. La parte NAV sólo escucha estaciones VOR en tierra y mueve la aguja del indicador VOR. Es eléctrica: necesita el master prendido.',
      enElAvion: 'No mueve nada. Usa antenas afuera del avión y la electricidad del avión (protegida por los disyuntores de las radios).',
      comoSeUsa: [
        'Antes de arrancar el motor, dejá la radio apagada; prendela después de la puesta en marcha.',
        'Prendela con la perilla de encendido y volumen.',
        'Cargá la frecuencia en la ventanita de reserva (STBY) con las perillas: la grande cambia los números enteros y la chica los decimales.',
        'Apretá el botón de intercambio (⇆) para pasarla a activa: la activa es la que estás usando.',
        'Escuchá antes de hablar, y hablá apretando el botón del micrófono (PTT).'
      ],
      cuando: 'Desde antes del rodaje (para pedir autorización a la torre) hasta después de aterrizar. La parte NAV, cuando aprendas a navegar con VOR.',
      errores: [
        'Prender las radios antes de arrancar: el manual pide radios apagadas al arrancar, para cuidarlas.',
        'Hablar sin escuchar antes y “pisar” a otro que está hablando.',
        'Tener la frecuencia correcta en reserva y olvidarte de pasarla a activa.',
        'Tener el volumen muy bajo y creer que nadie habla.'
      ],
      truco: '“Pensá, apretá, hablá”: armá la frase en la cabeza antes de apretar el botón.',
      dato: 'Las radios varían muchísimo de un avión a otro: la de fábrica era una Cessna 300 Nav/Com, y hoy muchas escuelas tienen equipos más modernos (Garmin, King) con intercomunicador. Pedile a tu instructor que te muestre la de TU avión.',
      otrosModelos: 'En el 150M todas las radios eran opcionales: el paquete Commuter traía una Nav/Com y el Commuter II agregaba el transpondedor. Hoy cada avión tiene una combinación distinta.',
      rangos: [],
      relacionados: ['audio-panel', 'microphone', 'vor-indicator', 'transponder', 'master', 'circuit-breakers', 'dimmers'],
      partesAvion: [],
      probar: { tipo: 'radio' }
    },

    {
      id: 'transponder',
      nombre: 'Transpondedor',
      otrosNombres: ['Transponder', 'XPDR'],
      ingles: 'Transponder',
      categoria: 'radio',
      prioridad: 2,
      ubicacion: 'En la pila de radios del centro, debajo de la NAV/COM. En la configuración original es el último equipo de la pila.',
      resumen: 'Le responde al radar con un código de cuatro cifras para que el control te identifique.',
      queHace: 'Cuando el radar de tierra lo “interroga”, el transpondedor contesta con tu código de cuatro cifras. Así el controlador ve tu avión en la pantalla con ese número y, en el modo ALT, también tu altura. Es eléctrico: necesita el master prendido.',
      enElAvion: 'No mueve nada. Transmite por su propia antena, afuera del avión.',
      comoSeUsa: [
        'Poné el código que te asigne el control o te indique el instructor: cada cifra va del 0 al 7.',
        'Elegí el modo: OFF (apagado), SBY (prendido pero sin contestar), ON (contesta con el código) o ALT (contesta con código y altura).',
        'Seguí lo que te indiquen el instructor o la torre sobre cuándo pasar a ALT; en vuelo normalmente va en ALT.',
        'Apretá IDENT sólo cuando el controlador te lo pida: hace resaltar tu avión en su pantalla.'
      ],
      cuando: 'Antes de despegar (ponerlo en el modo que te indiquen) y durante todo el vuelo. Cuando te pidan un código nuevo, cambialo con cuidado.',
      errores: [
        'Inventar un código: el código lo asigna el control (o te lo dice el instructor).',
        'Pasar sin querer por 7500, 7600 o 7700 al cambiar el código: son códigos de emergencia.',
        'Dejarlo en SBY u OFF en vuelo: así no contesta al radar.'
      ],
      truco: 'Los tres de emergencia empiezan con 77, 76 y 75: 7700 = emergencia, 7600 = me quedé sin radio, 7500 = interferencia ilícita (secuestro).',
      dato: 'Los códigos 7700, 7600 y 7500 son iguales en todo el mundo. El código para vuelos visuales comunes cambia según el país: en Uruguay, preguntale a tu instructor o mirá la publicación oficial (AIP).',
      otrosModelos: 'Era opcional: el paquete Commuter II de fábrica lo traía (una Cessna 300). Para el modo ALT hace falta un altímetro codificador o un codificador aparte. Muchos aviones tienen hoy transpondedores modernos.',
      rangos: [],
      relacionados: ['navcom', 'altimeter', 'master'],
      partesAvion: [],
      probar: { tipo: 'radio' }
    },

    {
      id: 'vor-indicator',
      nombre: 'Indicador VOR (OBS/CDI)',
      otrosNombres: ['VOR', 'OBS', 'CDI', 'Indicador de curso'],
      ingles: 'VOR indicator (OBS / CDI)',
      categoria: 'radio',
      prioridad: 3,
      ubicacion: 'Panel principal, fila de arriba, a la derecha del altímetro, justo a la izquierda de las radios.',
      resumen: 'Te muestra si estás a la izquierda o a la derecha de una ruta hacia o desde una estación VOR.',
      queHace: 'Un VOR es una estación de radio en tierra que emite en todas las direcciones, como los rayos de una rueda de bicicleta. Con la perilla OBS elegís uno de esos rayos (un curso, en grados), y la aguja vertical (CDI) te dice si estás a la izquierda o a la derecha de él. La banderita TO/FROM indica si ese curso te lleva hacia la estación o te aleja de ella. La señal la recibe la parte NAV de la radio.',
      enElAvion: 'No mueve nada. Usa la parte NAV de la radio NAV/COM.',
      comoSeUsa: [
        'Sintonizá la frecuencia del VOR en la parte NAV de la radio y escuchá su identificación en código Morse.',
        'Girá la perilla OBS hasta el curso que querés.',
        'Mirá la aguja: si está a la derecha, el curso está a tu derecha. Volá hacia la aguja.',
        'Mirá la bandera: TO = el curso te lleva a la estación; FROM = te aleja. Si aparece OFF, no hay señal útil: no le creas.'
      ],
      cuando: 'Más adelante en el curso, en las navegaciones. En las primeras clases alcanza con saber dónde está y para qué sirve.',
      errores: [
        'Usarlo sin verificar la identificación de la estación.',
        'Pensar que la aguja muestra hacia dónde apunta la nariz: muestra dónde está el curso, sin importar tu rumbo.',
        'No mirar la bandera TO/FROM y volar al revés.'
      ],
      truco: '“Volá hacia la aguja.” Con el curso bien puesto y la bandera en TO, si la aguja se va a la derecha, corregí a la derecha.',
      dato: 'Cada rayo del VOR se llama radial y se cuenta desde la estación hacia afuera, en grados magnéticos.',
      otrosModelos: 'El 150M de fábrica podía traer uno o dos indicadores VOR y un ADF (otro indicador, que apunta a una radiobaliza), todo opcional. Hoy muchos aviones tienen además un GPS.',
      rangos: [],
      relacionados: ['navcom', 'heading-indicator', 'compass'],
      partesAvion: [],
      probar: { tipo: 'perilla', clave: 'radio.obs', paso: 5, min: 0, max: 355, formato: 'grados' }
    },

    {
      id: 'audio-panel',
      nombre: 'Panel de audio',
      otrosNombres: ['Selector de audio'],
      ingles: 'Audio control panel',
      categoria: 'radio',
      prioridad: 3,
      ubicacion: 'Arriba del panel, en la cubierta del guardasol (la parte acolchada de arriba), a la derecha del espejo retrovisor.',
      resumen: 'Elige por qué radio transmitís y si cada radio se escucha por parlante o por auriculares.',
      queHace: 'Es una fila de llavecitas que deciden adónde va el sonido de cada radio. La llave TRANS 1/2 elige por qué radio sale tu voz cuando apretás el micrófono (arriba = la radio de arriba). Las otras (COM 1, COM 2 y ADF) tienen tres posiciones: arriba parlante (SPEAKER), al medio apagado (OFF) y abajo auriculares (PHONE).',
      enElAvion: 'No mueve nada. El parlante está en el techo de la cabina.',
      comoSeUsa: [
        'Con auriculares, poné la llave de la radio que usás en PHONE (abajo).',
        'Si volás sin auriculares, ponela en SPEAKER (arriba) y se escucha por el parlante del techo.',
        'Fijate que TRANS esté en la radio por la que querés hablar.',
        'Si no escuchás nada, revisá en orden: radio prendida, volumen, llave de audio y ficha de los auriculares.'
      ],
      cuando: 'Antes del rodaje, al preparar las radios, y cada vez que cambiás de radio.',
      errores: [
        'Hablar por una radio y escuchar otra: TRANS quedó en la equivocada.',
        'Tener la llave en OFF y pensar que la radio no anda.'
      ],
      truco: 'Arriba = parlante, abajo = auriculares (PHONE), al medio = nada.',
      dato: 'Muchos aviones de escuela tienen hoy un panel de audio moderno o un intercomunicador, para que instructor y alumno se hablen por los auriculares a pesar del ruido.',
      otrosModelos: 'Era opcional en el 150M. Su forma y sus llaves dependen totalmente de lo que tenga instalado tu avión.',
      rangos: [],
      relacionados: ['navcom', 'microphone'],
      partesAvion: [],
      probar: null
    },

    {
      id: 'microphone',
      nombre: 'Micrófono y auriculares',
      otrosNombres: ['Micrófono de mano', 'Auriculares', 'Headset', 'PTT'],
      ingles: 'Microphone, headset and push-to-talk (PTT)',
      categoria: 'radio',
      prioridad: 2,
      ubicacion: 'El micrófono de mano cuelga de un ganchito abajo del panel, cerca del pedestal central (en algunos aviones, debajo de tu volante). Los auriculares se enchufan en fichas debajo del panel, en el techo o en las paredes, según el avión.',
      resumen: 'Con esto hablás por radio y con tu instructor: se aprieta para hablar y se suelta para escuchar.',
      queHace: 'El micrófono convierte tu voz en señal para la radio. Mientras apretás el botón PTT (del inglés push to talk, “apretar para hablar”) la radio transmite y no podés escuchar a nadie. Los auriculares con micrófono y el intercomunicador te dejan hablar con el instructor a pesar del ruido del motor.',
      enElAvion: 'No mueve nada. Ojo: si el botón queda trabado apretado, tu radio tapa la frecuencia y nadie más puede hablar.',
      comoSeUsa: [
        'Ponete los auriculares antes de arrancar y acomodá el micrófono cerca de la boca, casi tocando los labios.',
        'Escuchá que la frecuencia esté libre.',
        'Apretá el botón, esperá medio segundo y hablá claro y corto.',
        'Soltá el botón al terminar y escuchá la respuesta.'
      ],
      cuando: 'Todo el vuelo: con la torre para pedir autorizaciones, y con tu instructor por el intercomunicador.',
      errores: [
        'Empezar a hablar antes de apretar el botón: se corta la primera palabra.',
        'Quedarse con el botón apretado (micrófono trabado).',
        'Volar sin auriculares: el 150 es muy ruidoso, cansa y daña el oído.'
      ],
      truco: '“Pensá, apretá, hablá, soltá.”',
      dato: 'Las radios originales no tenían botón para hablar en el volante: se usaba sólo el micrófono de mano. Muchos aviones tienen hoy un botón PTT agregado en el volante.',
      otrosModelos: 'Fichas, intercomunicador y botón PTT cambian mucho de un avión a otro: pedí que te los muestren en el tuyo.',
      rangos: [],
      relacionados: ['navcom', 'audio-panel', 'yoke'],
      partesAvion: [],
      probar: null
    },

    // ───────────────────────────── CABINA Y SEGURIDAD ─────────────────────────────

    {
      id: 'cabin-heat',
      nombre: 'Calefacción de cabina (CABIN HT)',
      otrosNombres: ['Calefacción', 'Calefactor', 'CABIN HT'],
      ingles: 'Cabin heat (CABIN HT)',
      categoria: 'cabina',
      prioridad: 2,
      ubicacion: 'Subpanel, lado derecho, fila de arriba: perilla cromada CABIN HT, a la derecha de CABIN AIR y a la izquierda de la guantera.',
      resumen: 'Tirás y entra aire caliente a la cabina, calentado alrededor del escape del motor.',
      queHace: 'Al tirar de la perilla se abre una válvula y entra a la cabina aire calentado dentro de una camisa de metal que envuelve el silenciador del escape. Sale cerca de los pies y una parte va al desempañador del parabrisas. Cuanto más la tirás, más calor entra; empujada a fondo, está cerrada.',
      enElAvion: 'Mueve una válvula en el parallamas (la pared que separa el motor de la cabina). El calor viene del escape: si el silenciador tiene una fisura, puede entrar monóxido de carbono, un gas venenoso sin olor ni color.',
      comoSeUsa: [
        'Para calentar, tirá de la perilla de a poco hasta estar cómodo.',
        'Para desempañar el parabrisas, abrila: parte del aire va al desempañador.',
        'Para ventilar a fondo, empujala toda adentro (cerrada) y usá el aire de cabina y los ventiletes.',
        'Si sentís olor a escape, dolor de cabeza o un sueño raro: calefacción ADENTRO (cerrada), aire fresco ABIERTO, y aterrizá.'
      ],
      cuando: 'En días fríos y para desempañar. Cerrala si hay fuego en el motor: el manual pide calefacción y aire de cabina cerrados (salvo los ventiletes de las alas).',
      errores: [
        'No sospechar del monóxido de carbono: los primeros síntomas son dolor de cabeza y sueño.',
        'Confundirla con la calefacción del carburador: esa es para el motor (también usa aire caliente del escape, pero lo manda al carburador).',
        'Dejarla abierta en un incendio de motor.'
      ],
      truco: '“¿Olor a escape? Calefacción cerrada, aire fresco abierto, y a tierra.” Llevá un detector de monóxido de carbono.',
      dato: 'La calefacción de cabina y la del carburador toman el aire de las camisas que rodean el escape. El manual de servicio llama a los gases de escape un “peligro extremo”: muchos pilotos llevan un detector de CO (monóxido de carbono) pegado en el panel.',
      otrosModelos: 'En el 150M 1975 las perillas de aire y de calefacción estaban una arriba de la otra (AIR arriba, HT abajo), a la izquierda de la guantera.',
      rangos: [],
      relacionados: ['cabin-air', 'air-vents', 'carb-heat'],
      partesAvion: ['exhaust', 'cowling'],
      probar: { tipo: 'slider', clave: 'cabinHeat', min: 0, max: 1, paso: 0.05, etiquetaMin: 'Cerrada (adentro)', etiquetaMax: 'Abierta (afuera)' }
    },

    {
      id: 'cabin-air',
      nombre: 'Aire de cabina (CABIN AIR)',
      otrosNombres: ['Aire fresco', 'Ventilación', 'CABIN AIR'],
      ingles: 'Cabin air (CABIN AIR)',
      categoria: 'cabina',
      prioridad: 3,
      ubicacion: 'Subpanel, lado derecho, fila de arriba: perilla cromada CABIN AIR, entre los flaps y la perilla CABIN HT.',
      resumen: 'Tirás y entra aire fresco de afuera a la cabina, a la altura de los pies.',
      queHace: 'Al tirar de la perilla se abre una tapita en el costado derecho del fuselaje (el cuerpo del avión), delante del asiento del acompañante. El aire fresco entra, se mezcla con el de la calefacción detrás del parallamas y sale cerca de los pies. Combinando las dos perillas regulás la temperatura.',
      enElAvion: 'Se abre una tapita de entrada de aire en el costado derecho del fuselaje, delante del asiento del acompañante.',
      comoSeUsa: [
        'Para más fresco, tirá de la perilla.',
        'Para templar, combinala con CABIN HT.',
        'Para ventilación máxima: CABIN HT toda adentro, CABIN AIR afuera y ventiletes abiertos.',
        'Si sospechás monóxido de carbono: abrila y cerrá la calefacción.'
      ],
      cuando: 'En días de calor, para templar la calefacción, y si hay olor a escape. Cerrala en un incendio, sea de motor o eléctrico.',
      errores: [
        'Confundir CABIN AIR con CABIN HT: están una al lado de la otra.',
        'Olvidar cerrarla en caso de incendio.'
      ],
      truco: 'AIR = aire (fresco); HT = heat (calor). Las dos se tiran para abrir.',
      dato: 'En un incendio de motor el manual pide cerrar la calefacción y el aire de cabina, pero deja abiertos los ventiletes de las alas: el aire que traen viene de las alas, no del motor.',
      otrosModelos: 'En el 150M 1975 estaba arriba de la perilla de calefacción, a la izquierda de la guantera.',
      rangos: [],
      relacionados: ['cabin-heat', 'air-vents'],
      partesAvion: ['fuselage'],
      probar: { tipo: 'slider', clave: 'cabinAir', min: 0, max: 1, paso: 0.05, etiquetaMin: 'Cerrada (adentro)', etiquetaMax: 'Abierta (afuera)' }
    },

    {
      id: 'air-vents',
      nombre: 'Ventiletes',
      otrosNombres: ['Tomas de aire del parabrisas', 'Ventilación de las alas'],
      ingles: 'Fresh-air ventilators (wing-root vents)',
      categoria: 'cabina',
      prioridad: 3,
      ubicacion: 'En las dos esquinas de arriba del parabrisas, una de tu lado y otra del acompañante, donde el ala se une a la cabina.',
      resumen: 'Dos tubos ajustables que soplan aire fresco desde las alas, cerca de tu cabeza.',
      queHace: 'Cada ventilete es un tubo que toma aire de una entrada en el borde de adelante del ala, cerca de la cabina (la raíz del ala). Tirás para abrir y girás para dirigir el chorro de aire. Son la mejor ventilación en días de calor.',
      enElAvion: 'El aire entra por unas tomas en la raíz de cada ala, en el borde de ataque. No pasa por el motor.',
      comoSeUsa: [
        'Tirá del ventilete hacia vos para abrirlo.',
        'Giralo para dirigir el aire hacia donde quieras.',
        'Empujalo para cerrarlo.'
      ],
      cuando: 'Para ventilar en días de calor y para sacar olores de la cabina. En un incendio eléctrico, en cambio, el manual pide cerrar todas las entradas de aire.',
      errores: [
        'Dejarlos abiertos en un incendio eléctrico: el aire aviva el fuego.',
        'Abrirlos de golpe en vuelo y que se vuelen los papeles.'
      ],
      truco: 'Calor en vuelo: ventiletes abiertos y CABIN HT cerrada a fondo.',
      dato: 'En un incendio de motor el manual deja abiertos justamente estos ventiletes, porque traen aire de las alas y no del compartimento del motor.',
      otrosModelos: 'Están en los 150 de esta época; su forma exacta puede variar de un avión a otro.',
      rangos: [],
      relacionados: ['cabin-air', 'cabin-heat'],
      partesAvion: ['wingL', 'wingR'],
      probar: null
    },

    {
      id: 'seats',
      nombre: 'Asientos',
      otrosNombres: ['Butacas', 'Asiento del piloto'],
      ingles: 'Seats (adjustment and lock)',
      categoria: 'cabina',
      prioridad: 1,
      ubicacion: 'Las palancas están debajo del asiento: la de deslizar, en la esquina delantera del lado de adentro (hacia el centro de la cabina); la del respaldo, debajo del medio del asiento.',
      resumen: 'Ajustá el asiento para llegar a todo, y comprobá siempre que quede trabado.',
      queHace: 'El asiento corre hacia adelante y hacia atrás sobre rieles, y se traba con un perno que entra en agujeros del riel. Una palanca de abajo libera la traba para moverlo, y otra perilla ajusta el respaldo. Bien ajustado, llegás a los pedales a fondo (frenos incluidos) y ves por encima del panel.',
      enElAvion: 'Afuera no cambia nada, pero si el asiento no está trabado se puede correr para atrás en el despegue y alejarte de los pedales y del acelerador.',
      comoSeUsa: [
        'Levantá la palanca de abajo (esquina delantera, lado de adentro), deslizá el asiento y soltala.',
        'Empujá y tirá del asiento con el cuerpo: tiene que quedar trabado, sin moverse.',
        'Comprobá que llegás a fondo con los dos pedales, frenos incluidos, y que ves bien por encima del panel.',
        'Para el respaldo, tirá hacia adelante la perilla de abajo del medio del asiento y reclinate.',
        'Si te queda bajo, usá un almohadón firme en lugar de sentarte en la punta.'
      ],
      cuando: 'Antes de arrancar (“asientos, cinturones y arneses: ajustar y trabar”) y otra vez antes de aterrizar.',
      errores: [
        'No comprobar la traba: un asiento que se corre en la rotación es peligroso.',
        'Sentarse muy atrás y no llegar a fondo con el pedal o el freno.',
        'Sentarse muy bajo y no ver por encima de la nariz.'
      ],
      truco: 'Después de trabarlo, sacudilo: empujá con la espalda y tirá con las manos. Si no se mueve, listo.',
      dato: 'Hay una directiva de aeronavegabilidad (una inspección obligatoria), la AD 2011-10-09, sobre los rieles y las trabas de los asientos de todos los 150, porque un asiento que se va para atrás al despegar puede hacerte perder el control.',
      otrosModelos: 'Desde 1976 había asientos opcionales “de 6 posiciones”: además de correr y reclinarse, suben 2 pulgadas (unos 5 cm) en dos pasos con una manija en T. El Aerobat trae respaldos y almohadones que se sacan rápido, para volar con paracaídas.',
      rangos: [],
      relacionados: ['seatbelts', 'rudder-pedals', 'toe-brakes', 'throttle'],
      partesAvion: [],
      probar: null
    },

    {
      id: 'seatbelts',
      nombre: 'Cinturones y arneses',
      otrosNombres: ['Cinturón de seguridad', 'Arnés de hombro', 'Cinturón de falda'],
      ingles: 'Seat belts and shoulder harnesses',
      categoria: 'cabina',
      prioridad: 1,
      ubicacion: 'El cinturón de falda tiene la hebilla fija del lado de adentro (hacia el centro de la cabina) y la parte ajustable del lado de la puerta. El arnés de hombro está guardado arriba de cada puerta y anclado al parante de atrás de la puerta.',
      resumen: 'Cinturón de falda y arnés de hombro: te mantienen en tu lugar con turbulencia y en un aterrizaje duro.',
      queHace: 'El cinturón de falda te sujeta la cadera y el arnés de hombro te sujeta el torso, para que no te golpees contra el panel. Con turbulencia, además, te mantienen firme para que manejes los mandos con suavidad. En el 150M el arnés es una pieza aparte que se engancha al cinturón.',
      enElAvion: 'Afuera no cambia nada.',
      comoSeUsa: [
        'Pasá el cinturón por la cadera y enganchá la parte del lado de la puerta en la hebilla de adentro.',
        'Ajustalo tirando de la punta libre: firme y bajo, sobre los huesos de la cadera.',
        'Bajá el arnés desde arriba de la puerta y enganchalo en el perno del cinturón.',
        'Para soltar, levantá la tapa de la hebilla.',
        'Si el asiento de al lado va vacío, abrochá igual su cinturón para que no quede suelto.'
      ],
      cuando: 'Antes de arrancar y antes de aterrizar (“asientos, cinturones y arneses: ajustar y trabar”). Se dejan puestos todo el vuelo.',
      errores: [
        'Usar sólo el cinturón de falda y dejar el arnés guardado.',
        'Dejar un cinturón suelto colgando afuera de la puerta o enredado con los mandos.',
        'No saber cómo se suelta: practicalo en tierra, sin mirar.'
      ],
      truco: 'Practicá soltarlo con los ojos cerrados: en una emergencia vas a tener que hacerlo sin mirar.',
      dato: 'Como opción había un cinturón y arnés integrados con carrete inercial, como el de un auto, montado en la pared arriba y atrás de cada puerta.',
      otrosModelos: 'El Aerobat A150M trae un sistema de cinturones especial para acrobacia. En muchos aviones los cinturones originales se cambiaron por otros: mirá cómo son los tuyos.',
      rangos: [],
      relacionados: ['seats', 'doors'],
      partesAvion: [],
      probar: null
    },

    {
      id: 'doors',
      nombre: 'Puertas y ventanillas',
      otrosNombres: ['Puerta', 'Ventanilla'],
      ingles: 'Cabin doors and opening windows',
      categoria: 'cabina',
      prioridad: 1,
      ubicacion: 'Una puerta de cada lado de la cabina. Cada una tiene una ventanilla que se abre, con bisagra arriba y traba en el borde de abajo.',
      resumen: 'Dos puertas con ventanilla que se abre; antes de despegar, cerradas y trabadas.',
      queHace: 'Cada puerta tiene una manija de afuera (metida cerca del borde de atrás), una manija de adentro con apoyabrazos y un tope. La izquierda se cierra con llave (la misma del encendido); la derecha se traba desde adentro levantando una palanca cerca de su borde de atrás. Cada ventanilla se abre hacia afuera apretando el botón de la traba de abajo, y un brazo con resorte la sostiene abierta.',
      enElAvion: 'Con una puerta o una ventanilla abierta entra mucho viento y ruido, pero el avión sigue volando. La ventanilla se puede abrir en vuelo hasta 141 nudos.',
      comoSeUsa: [
        'Antes de despegar: puertas cerradas y trabadas (está en el checklist).',
        'Para abrir la ventanilla: apretá el botón de la traba de abajo, girá la traba hacia arriba y empujá; el resorte la mantiene abierta.',
        'Si una puerta se abre en vuelo: primero volá el avión. Después compensá a unos 65 nudos, empujá la puerta un poco hacia afuera y cerrala firme.',
        'En un aterrizaje de emergencia: destrabá las puertas antes de tocar el suelo, para que no queden trabadas si el fuselaje se deforma.'
      ],
      cuando: 'Al subir y bajar, en el checklist antes del despegue (“puertas cerradas y trabadas”) y para ventilar en tierra con la ventanilla abierta.',
      errores: [
        'Asustarse si la puerta se abre en vuelo y dejar de volar el avión: no es una emergencia.',
        'Olvidar trabar la puerta derecha (se traba desde adentro).',
        'Despegar con papeles sueltos y la ventanilla abierta: se vuelan.'
      ],
      truco: '“Primero volá el avión.” Una puerta abierta hace ruido y asusta, pero no te tira abajo.',
      dato: 'El manual del 150M dice que una puerta abierta en vuelo, por sí sola, no es motivo para aterrizar.',
      otrosModelos: 'Desde 1967 las puertas del 150 son abombadas hacia afuera, para ganar espacio. El Aerobat A150M trae puertas de liberación rápida (para poder saltar en paracaídas) y ventanas en el techo.',
      rangos: [],
      relacionados: ['seatbelts', 'placards', 'trim-wheel'],
      partesAvion: ['doorL', 'doorR', 'windowL'],
      probar: { tipo: 'puertas' },
      subitems: [
        { subId: 'left', nombre: 'Puerta izquierda (piloto)', ingles: 'Left door', texto: 'Tu puerta. Es la única que se cierra con llave desde afuera, con la misma llave del encendido.' },
        { subId: 'right', nombre: 'Puerta derecha (acompañante)', ingles: 'Right door', texto: 'Se traba desde adentro, levantando una palanca cerca de su borde de atrás.' },
        { subId: 'window', nombre: 'Ventanilla izquierda', ingles: 'Left door window', texto: 'Bisagra arriba y traba abajo con botón. Se abre hacia afuera y un resorte la sostiene. Se puede tener abierta hasta 141 nudos.' }
      ]
    },

    {
      id: 'placards',
      nombre: 'Carteles y checklist',
      otrosNombres: ['Placas', 'Placa de maniobras', 'Placa de límites', 'Lista de chequeo', 'Checklist'],
      ingles: 'Placards and checklist',
      categoria: 'cabina',
      prioridad: 2,
      ubicacion: 'La placa de límites y maniobras está en el panel, a la vista del piloto (el lugar exacto varía). El checklist del piloto está fijado en el parante derecho de la puerta (desde 1975). Hay más carteles junto a la llave de combustible, en el compartimento de equipaje y junto a las tapas de los tanques.',
      resumen: 'Los límites del avión escritos a la vista: son obligatorios y resumen lo que dice el manual.',
      queHace: 'Los carteles (placas) resumen los límites más importantes del manual, para tenerlos siempre a la vista. La placa principal dice que el avión es de categoría utilitaria, cuál es la velocidad de maniobra, el peso máximo, cuántas “g” aguanta y qué maniobras están permitidas. El checklist es la lista de pasos que se lee en cada etapa del vuelo, para no olvidarse de nada.',
      enElAvion: 'No mueve nada, pero te dice qué NO podés hacerle al avión.',
      comoSeUsa: [
        'Leé la placa principal en tu primer vuelo: categoría utilitaria, Va 97 nudos, peso máximo 1600 lb, +4,4 / −1,76 g con flaps arriba y +3,5 g con flaps abajo.',
        'Mirá las maniobras aprobadas: virajes escarpados, ochos perezosos y chandelles con entrada a 95 nudos como máximo, y pérdidas y tirabuzones con desaceleración lenta. Tirabuzones, sólo con flaps arriba.',
        'Tené presente lo prohibido: volar en condiciones de engelamiento conocidas y usar los mandos bruscamente arriba de 97 nudos.',
        'Usá el checklist del parante derecho (o el de tu escuela) en cada etapa: leé, hacé, verificá.',
        'Mirá también los otros carteles: combustible (“FUEL – 22.5 GALS – ON / OFF”), equipaje (máximo 120 lb en total) y tipo de combustible en las tapas de los tanques.'
      ],
      cuando: 'Siempre que tengas una duda sobre un límite, y el checklist en cada etapa del vuelo, desde la inspección hasta que dejás el avión atado.',
      errores: [
        'Volar de memoria, sin checklist.',
        'Creer que un número de internet vale para tu avión: mandan el manual y las placas de TU avión.',
        'Mezclar datos del Cessna 152, que es otro avión (1670 lb de peso máximo y flaps hasta 30°).',
        'Cargar equipaje sin mirar el límite de 120 lb.'
      ],
      truco: '“Leer, hacer, verificar”: el checklist no se recita de memoria, se lee.',
      dato: 'Ojo con el peso: dos adultos de 80 kg con los tanques llenos pueden pasar las 1600 lb, y a veces hay que volar con menos combustible. La placa también trae la recuperación de tirabuzón: pedal contrario, volante adelante y neutralizar.',
      otrosModelos: 'El Aerobat A150M es de categoría acrobática: +6 / −3 g con flaps arriba, Va 105 nudos y mandos bruscos prohibidos arriba de 105, con su propia lista de maniobras (loops, toneles y otras). Los 150 de 1959 a 1963 tenían un peso máximo de 1500 lb.',
      rangos: [],
      relacionados: ['asi', 'fuel-shutoff', 'control-lock', 'turn-coordinator', 'compass', 'ammeter', 'doors'],
      partesAvion: ['fuelCapL', 'fuelCapR'],
      probar: null
    }

  ]);
})(root.C150);
