# Cabina Cessna 150

Una cabina 3D interactiva del **Cessna 150M (1976)** para aprender, antes de la primera clase de vuelo, qué es cada mando y cada instrumento y qué le pasa al avión cuando lo usás. Todo en español rioplatense.

**Probala:** https://cabina-cessna-150.vercel.app

## Qué tiene

- **Explorar:** los 45 mandos e instrumentos de la cabina, cada uno con su ficha: dónde está, qué hace, qué se mueve en el avión, cómo se usa, errores comunes y rangos de los instrumentos. Se pueden tocar y mover en 3D.
- **Lo básico:** 12 lecciones (las 4 fuerzas, los 3 ejes, la pérdida, los flaps, el compensador, el motor…) con animaciones del avión visto desde afuera.
- **Recorrido:** un paseo guiado por la cabina, control por control, como el primer día con el instructor.
- **Checklists:** antes de arrancar, arranque, prueba de motor, antes de aterrizar y apagado. Se tildan solas cuando ponés cada mando en la posición correcta.
- **Volar:** un simulador sencillo con 8 misiones (arrancar, carretear, despegar, vuelo recto y nivelado, viraje coordinado, ascenso, pérdida y aproximación).
- **Quiz:** preguntas de "¿dónde está?" (se contestan tocando la cabina) y de opción múltiple.

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
tests/                     pruebas (Node) y páginas de prueba (styleguide.html = guía de estilo viva)
build.js                   arma todo en un solo HTML
```

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
```

## Publicar en Vercel

```bash
node build.js
npx vercel deploy cabina-cessna-150 --prod
```
