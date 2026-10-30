# Cabina Cessna 150

Una cabina 3D interactiva del **Cessna 150M (1976)** para aprender, antes de la primera clase de vuelo, qué es cada mando y cada instrumento y qué le pasa al avión cuando lo usás. Todo en español rioplatense.

**Probala:** https://cabina-cessna-150.vercel.app

## Qué tiene

Cinco secciones (arriba en la compu, abajo en el celular) pensadas para alguien que no sabe casi nada de aviación:

- **Inicio:** de dónde arrancar. "Continuar" donde dejaste, "Tu camino" en 5 etapas (conocé la cabina, entendé cómo vuela, practicá los procedimientos, volá y resolvé situaciones, probá lo que sabés), acciones rápidas y tu avance. Mientras mirás Inicio, la cámara 3D muestra toda la cabina con un movimiento lento.
- **Cabina:** los 45 mandos e instrumentos, cada uno con su ficha en lenguaje simple (dónde está, qué hace, cómo se usa, errores comunes) y un "Probalo" para moverlo. Se tocan y se mueven en 3D.
- **Lecciones:** el *Recorrido guiado* (un paseo control por control, como el primer día con el instructor) y 12 *Lecciones* (las 4 fuerzas, los 3 ejes, la pérdida, los flaps, el compensador, el motor…) con el avión visto desde afuera.
- **Practicar:** *Checklists* (se tildan solas cuando ponés cada mando bien), *Misiones y situaciones* (un simulador sencillo con 8 misiones y situaciones anormales para resolver) y un *Quiz* (tocando la cabina y de opción múltiple).
- **Aire:** el laboratorio del aire en 3D: flujo alrededor del ala, las cuatro fuerzas, la pérdida y un túnel de viento.

Todas las pestañas comparten el mismo lenguaje visual que **Aire**: panel con cuadrícula de papel, encabezado con rótulo mono y título grande, secciones numeradas y plegables, tarjetas con código (L1, C2, M3…), deslizadores con marcas, y sobre el 3D un HUD de vidrio (motor, velocidad, altura), una barra de causa y efecto y una sola barra inferior (Vista · Diseño · Escenario); todo sale de `C150.Kit` (ver `tests/styleguide.html`). El "volver atrás" también es único (`src/nav.js`, `docs/NAVEGACION.md`).

Ayudas en todas partes:

- **Buscador** (Ctrl K, `/` o la lupa): controles, palabras, lecciones, checklists, situaciones y experimentos.
- **Palabras explicadas:** los términos técnicos aparecen subrayados; tocalos y te los explica (con el nombre en inglés y "Verlo en 3D").
- **Tu avance** se guarda en el navegador (nada sale de tu dispositivo) y la barra "Siguiente paso" propone qué hacer después.
- **Tutorial** de bienvenida la primera vez (Ayuda, "Ver el tutorial" para repetirlo), tema claro y oscuro, movimiento reducido, teclado completo ("Saltar al contenido", Esc, flechas) y, en el celular, un panel deslizable (mínimo, medio, completo) sobre el 3D.

> Basado en un Cessna 150M 1976. El avión de tu escuela puede tener diferencias: siempre manda el manual (POH) de ese avión y tu instructor. Esta app es para aprender, no reemplaza la instrucción de vuelo.

## Cómo está hecha

Página estática en HTML y JavaScript, sin frameworks. El 3D usa [Three.js](https://threejs.org) r147 desde un CDN; todos los modelos y texturas se generan por código, sin archivos externos.

```
src/
  index.html, styles.css   estructura y estilos de la app
  ui.js                    interfaz: modos, fichas, checklists, misiones, quiz
  icons.js, kit.js         íconos (sprite SVG) y componentes del sistema de diseño v2 (C150.Kit)
  progress.js              avance del alumno: "Tu camino" (C150.Progress, localStorage)
  home.js                  pantalla de Inicio: continuar, "Tu camino", acciones rápidas, consejos
  onboarding.js            bienvenida de la primera vez y tutorial de 5 pasos con foco
  search.js                buscador (Ctrl K o /) con proveedores registrables (C150.Search.register)
  glossary.js              palabras subrayadas con su definición (C150.Glossary.annotate)
  core.js                  motor 3D: render, luces, cámara, selección y arrastre de mandos
  cockpit.js               la cabina 3D
  exterior.js              el avión visto desde afuera y sus animaciones
  world.js                 el paisaje y el aeródromo
  gauges.js                los instrumentos dibujados
  sim.js                   simulador de motor, sistemas y vuelo
  data/                    contenido: fichas, lecciones, recorrido, checklists, misiones, quiz y glosario
  escuela/                 pestaña ESCUELA (C150.Escuela): datos.js (índice + carga perezosa), store.js (progreso, repaso espaciado), motor.js (componentes), texto.js + bloques.js (lectura editorial), leccion.js, pantallas.js (mapa, módulo, rutas reservadas), visor.js (visor 3D a pedido), escuela.js
    modelos.js · figuras.js · c-simulador.js · c-calculadora.js · c-diagrama.js · c-animacion.js · c-clasificar.js · c-emparejar.js · c-situacion.js · c-enlace3d.js
                           componentes de las lecciones (pasada 1, parte A): C150.ESCUELA.modelos (funciones puras del simulador: sustentación y pérdida, atmósfera estándar,
                           factor de carga, viento cruzado, porcentaje, recreos, franjas, riesgo, Bernoulli, Venturi…), C150.ESCUELA.herramientas (la calculadora: conversión,
                           viento cruzado, tiempo-velocidad-distancia, combustible, altitud de presión y densidad, plazos y fechas…), C150.ESCUELA.figuras (dibujos SVG propios con
                           capas y puntos) y los cuatro componentes. El esquema de `datos` de cada uno está documentado al principio de su archivo.
                           Parte B: clasificar (fichas a cajas, con ES.arrastre compartido), emparejar (dos columnas que se funden), situación (decisiones con consecuencia, con ramas) y enlace 3D (MIRAR / ABRIR con el modelo de navegación).
  data/escuela/            indice.json (módulos, unidades y lecciones; lo genera tools/escuela-indice.js) y un <ID>.json por módulo con el texto adaptado (se carga a pedido)
tests/                     pruebas (Node) y páginas de prueba (styleguide.html = guía de estilo viva)
build.js                   arma todo en un solo HTML
```

## La pestaña ESCUELA y cómo se agrega contenido

ESCUELA es la teoría del curso para el examen, adaptada con palabras propias (nunca copiada de las diapositivas): un mapa de 12 módulos, cada módulo con unidades y lecciones, y cada lección con un recorrido de pasos, práctica, mini-quiz y resumen. Hoy están completos los módulos INT y AER-01 a AER-03 (54 lecciones); el resto del curso figura en el índice como «próximamente» y se suma módulo a módulo. Los textos viven en `src/data/escuela/<ID>.json` (un archivo por módulo, JSON puro: unidades → lecciones con `objetivos`, `contenido`, `componentes[{tipo, titulo, descripcion, datos}]`, `preguntas`, `glosario` y `enlaces`). El índice liviano (`src/data/escuela/indice.json`: todos los módulos y lecciones, con `detalle` completo / pendiente / próximamente) lo genera `node tools/escuela-indice.js` a partir del plan de contenidos de `_teorico/` y marca como `completo` sólo las lecciones que existen en `src/data/escuela/<ID>.json`; hay que volver a correrlo cada vez que se suma o se completa un módulo (`tests/check-consistency.js` falla si un `<ID>.json` tiene lecciones que el índice no da por completas). `_teorico/` no se publica: está en `.gitignore`, `build.js` nunca lo lee y las pruebas verifican que ningún archivo publicado lo nombre. Los módulos se emiten a pedido: `node build.js` mete el índice en el HTML (`<script type="application/json" id="escuela-indice">`), deja cada módulo como un bloque `id="escuela-<ID>"` que sólo se interpreta cuando el alumno abre ese módulo, y escribe además `cabina-cessna-150/escuela/<ID>.json` minificado para que, publicado, el módulo se baje con `fetch` la primera vez; el motor de componentes (`C150.ESCUELA.componentes`) tolera los esbozos libres del plan y, si un `datos` no sirve, muestra una tarjeta de reserva que no bloquea nada. `node tests/validate-escuela.js` revisa el índice, cada lección (4 opciones, `correcta` válida, enlaces contra los ids reales de la app), el `normalizar` de cada componente la lógica del progreso y la calidad editorial del contenido terminado (tipos de punto clave, títulos, reparto de la respuesta correcta, ningún componente implementado en la reserva).

La pestaña es **pantalla completa**: mientras estás en ESCUELA el escenario 3D se colapsa (y el dibujo se pausa, así el teléfono no gasta batería) y el panel pasa a ser el área principal, con su propio scroll. El **mapa** abre con un saludo en tipografía grande, la tarjeta «Continuar donde dejaste», la constancia (racha, minutos de la semana, lecciones hechas) y los módulos como tarjetas con el código del módulo de marca de agua, o en la vista **Camino**, una ruta que serpentea con una estación por módulo; el **módulo** tiene una banda con su anillo de avance, un índice de unidades que acompaña al leer (desde 1000 px) y las lecciones como tarjetas (las «Próximamente» van atenuadas y no se tocan). Cada **lección** se lee como una página editorial: barra pegajosa con el avance, índice «En esta lección», una portada tipo afiche y un punto clave por pantalla con texto y figura lado a lado; todo se acomoda al ancho real de la columna (`@container es`, tokens fluidos `--es-fs-*` en `src/styles.css`). Un `contenido` puede ser un texto (el formato viejo) o un objeto `{titulo, texto, tipo, dato, ejemplo, ojo, resumen}` con `tipo` = `texto`, `definicion`, `regla`, `dato`, `idea`, `ojo`, `ejemplo` o `lista`, y el texto admite `**término**` (glosario), `==clave==` (resaltado) y `{{valor|unidad}}` (cifra en mono); la lección puede traer `resumen` (una línea por punto clave). Los componentes que piden mirar la cabina (`enlace3d`) abren el **visor 3D** al lado de la lección (arriba en tablet y teléfono): Esc, «Volver a la lección» o el botón Atrás lo cierran primero y la vista vuelve a como estaba. La guía `tests/styleguide.html` (sección «Escuela · lectura») muestra la escala tipográfica, los tipos de punto clave, un paso, el mapa, el módulo y una maqueta del visor.

## Uso local

Necesitás [Node.js](https://nodejs.org).

```bash
node build.js
```

Eso genera `cabina-cessna-150.html` (se abre con doble clic; necesita internet para cargar Three.js) y `cabina-cessna-150/index.html` (la carpeta que se publica).

Pruebas:

```bash
node tests/sim.test.js
node tests/validate-controls-a.js
node tests/validate-controls-b.js
node tests/validate-learning.js
node tests/check-consistency.js
node tests/playthrough.js
node tests/validate-glossary.js
node tests/validate-search.js
node tests/validate-progress.js
node tests/validate-lab.js
node tests/validate-situations.js
node tests/validate-escuela.js
node tests/airflow.test.js
node tests/exterior.test.js
```

Páginas de prueba en el navegador (servilas con `python -m http.server`): `tests/ui-harness.html` (la interfaz con un Core de mentira), `tests/styleguide.html` (guía de estilo viva, claro/oscuro) y las `*-preview.html` de cada módulo 3D.

## Publicar en Vercel

```bash
node build.js
npx vercel deploy cabina-cessna-150 --prod
```
