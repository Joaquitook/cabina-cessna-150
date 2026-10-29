# Navegación coherente (contrato v6)

Un solo "volver atrás" para toda la app, implementado en `src/nav.js` (`C150.Nav`) y conectado en `src/ui.js`.
Parte de la queja del alumno: *"estoy en Lecciones, en Mezcla, pongo «ver en 3D» y me manda a la cabina y no puedo volver"*.

## 1. Lo que estaba mal (causas)

1. `setMode()` sólo hacía `history.replaceState`: el botón Atrás del navegador o del celular salía de la app o no hacía nada.
2. No había pila: los enlaces entre secciones (`showControl`, `openLab`, glosario, buscador, Home, "Siguiente paso") cambiaban de pestaña y
   olvidaban de dónde venían.
3. Al salir de una pestaña se perdía su estado interno (se restauraba el scroll, nada más).
4. "Mostrámelo en 3D" / "Ver en el avión" movían la cámara **y** la vista principal sin recordar la anterior.
5. Mirar algo en 3D y abrir un detalle eran la misma acción.
6. Al entrar a una pestaña se aplicaba su contexto 3D pero al salir no se devolvía (el túnel de AIRE se filtraba al resto).

## 2. El modelo: tres clases de acciones (siempre las mismas, en toda la app)

| Clase | API | Qué hace | Cómo se vuelve |
|---|---|---|---|
| **MIRAR** | `Nav.look(fn, {label})` / `UI.lookAt(id)` | Sólo se mueve el 3D (cámara, vista principal, diseño). **Nunca cambia de pestaña ni de panel.** | Chip **"Volver a la vista anterior"** (primer grupo del dock, mismo vidrio que VISTA · DISEÑO · ESCENARIO). Un toque (o Esc) devuelve cámara, vista principal, diseño y resaltados con vuelo suave. Se apaga al usarlo, al cambiar de pestaña / paso, o 12 s después de mover la cámara a mano. |
| **ABRIR** | `Nav.push(ruta, {returnLabel, run})` / `UI.open(ruta)` | Un detalle en otro lugar. La ubicación actual (ruta + estado del panel + scroll + 3D) queda en la pila. | Barra pegajosa **"← Volver a Lección «Los 3 ejes» · paso 3"** arriba del panel (y el mismo texto en el encabezado de la hoja del celular). Vuelve **exacto**: misma lección y paso, mismo scroll, misma cámara. La ✕ descarta el atajo. |
| **IR** | `Nav.go(ruta)` / `UI.go(ruta)` | Barra superior, sub-pestañas, marca, anillo de avance. | Entrada normal del historial (Atrás / Adelante del navegador); sin barra. Cada pestaña recuerda su estado. Volver a tocar la pestaña activa **sube** a su lista; otro toque va al principio. |
| (detalle) | `Nav.detail(ruta, {run})` / `Nav.replace(ruta, {run})` | Abrir una ficha, lección o checklist **dentro** de la misma pestaña (lista → detalle) o cambiarla en el lugar (anterior / siguiente, toque en el 3D). | **SUBIR (UP) = Atrás** hasta la lista de la que se vino. |

**Atrás vs. Subir.** *Atrás* deshace la última navegación (botón del navegador / celular, `Alt+←`, `Nav.back()`). *Subir* (`‹` en la
cabecera + miga de pan `Lecciones › Los 3 ejes › Paso 3`, tecla `Esc`, volver a tocar la pestaña activa) va a la lista de la pestaña. No se
pisan: dentro de un detalle abierto desde la lista, Subir es un Atrás de varios pasos; si el detalle se abrió de otro modo, usa el
proveedor del panel (`up()`).

**Esc** cierra primero lo abierto (popover, diálogo, buscador, ayuda: ya lo hacían ellos), después deshace un "mirar" pendiente y por último sube.
Con `history` real, `Alt+←/→` los resuelve el navegador; sin historial (sandbox) los resuelve `Nav`.

## 3. Historial real

* Cada cambio de ruta hace `history.pushState({nav: id}, '', '#ruta')`; las redirecciones y el cambio de ruta por deriva del estado hacen
  `replaceState`. `popstate` busca la entrada por id y **restaura su instantánea** (`ruta`, estado del proveedor, scroll del panel, vista 3D).
  Adelante funciona igual. Las rutas viejas siguen valiendo (`#explorar`, `#basico`, `#lecciones/basico`, `#cabina/<id>`, `#aire/<exp>`,
  `#escuela/<id>`) y se agregaron `#basico/<leccion>`, `#checklists/<id>`, `#volar/<situacion>`.
* Una dirección escrita a mano (o una página recargada) se **adopta** como entrada nueva; `hashchange` no duplica.
* **Overlays** (buscador, ayuda, tutorial, todos los `Kit.dialog`): al abrirse empujan una entrada falsa (`Nav.overlayOpen`); el botón Atrás del
  celular los cierra primero y no navega. Si se cierran con Esc / clic, la entrada falsa se descarta (`overlayClosed`).
* Un recorrido a la vez: mientras un `history.go()` iniciado por `Nav` no llegó, lo nuevo espera en cola (Esc llega a `Nav` y a `Core`; sin esto
  salía dos veces). Si el navegador no dispara `popstate` (iframes, sandbox), un watchdog de 450 ms recorre la pila interna a mano.
* `Nav.sync()` (≈ 15 Hz) alinea la ruta de la entrada con el estado real (una ficha abierta con un toque en el 3D, un detalle cerrado…) con
  `replaceState`, sin entradas nuevas.

## 4. Proveedores (uno por panel; `Nav.registerProvider(modo, {...})`, registrados en `registerNavProviders()` de ui.js)

`label()` · `crumbs()` · `route()` · `capture()` · `restore(obj)` · `up()` · `inDetail()` · `active()` · `pause()` / `resume()`

| Modo | Qué guarda / restaura | Subir | "EN CURSO" |
|---|---|---|---|
| inicio | nada | – | – |
| explorar (Cabina) | control abierto | cierra la ficha | – |
| basico (Lecciones) | lección, paso, pasos vistos, terminada | vuelve a la lista **sin perder la lección** | lección empezada y no terminada |
| recorrido | paso, terminado | – | paso > 1 y no terminado |
| checklists | checklist abierta | vuelve a la lista **sin perder el avance** | checklist con ítems sin terminar |
| volar | pestaña (Misiones / Situaciones), situación abierta | situación → lista (con confirmación si estaba volando) | misión sin cumplir o situación en vuelo |
| quiz | fase y pregunta | vuelve al inicio del quiz (con confirmación si había respuestas) | quiz con respuestas |
| aire | experimento y paso | detiene el experimento | – |

* **Actividades que sobreviven.** La pestaña (y la sub-pestaña) con algo a medias muestra un punto naranja "EN CURSO" (`data-live`) y la lista
  muestra arriba una fila **Continuar** (`continueRow`) con una ✕ para dejarla (pide confirmación sólo si se pierde avance).
  La evaluación de una checklist que quedó de lado espera: no se tilda mientras se está en otra pestaña.
* **Pausa.** Una misión / situación en curso que se deja de lado **pausa el simulador** (`state.paused`); al volver a *Misiones y situaciones* un
  aviso "Pausado: … [Continuar]" (`#nav-pause`) devuelve los mandos. Si el alumno ya apretó "Seguir", el aviso no aparece.

## 5. Contexto 3D por pestaña (`Core.getViewState()` / `Core.setViewState(s, {smooth})`)

Instantánea: `{main, layout, cam:{pos,target}, ext:{pos,target,up}, preset, selected, targets, exteriorView, backdrop, scenario, air}`.
`setViewState` vuela de vuelta (suave; con *reducir movimiento* salta; `smooth:false` salta). No reaplica el escenario del simulador (eso
reiniciaría el avión): sólo lo que se **ve**.

* Cada instantánea de historial lleva la vista 3D: Atrás / Adelante / "Volver a …" la devuelven.
* Al salir de una pestaña se guarda su contexto y al volver a **Cabina / Misiones / Quiz** se devuelve (las demás encuadran la cámara solas).
* **AIRE no se filtra:** al entrar se guarda lo que el alumno tenía (vista principal, diseño, cámaras, fondo, capas de aire) y al salir se
  devuelve entero (además de lo que ya hacía `Lab.exit`: escenario, fondo, flujo apagado).

## 6. Auditoría de enlaces (cada botón que cambia de pestaña o mueve la vista)

| Dónde | Control | Clase | Antes | Ahora |
|---|---|---|---|---|
| Barra superior / sub-pestañas / marca / anillo | pestañas | IR | `replaceState`, sin historial | entrada de historial; re-toque = subir; la pestaña conserva su estado |
| Cabina | fila de la lista, "Empezá por acá" | detalle | abría la ficha | entrada con padre = lista (Subir = Atrás) |
| Cabina | Anterior / Siguiente | reemplazo | (los botones no se dibujaban: error de `appendChild`) | se dibujan; cambian la entrada en el lugar |
| Cabina | chips Relacionados | detalle | – | entrada nueva |
| Cabina | toque en el 3D | reemplazo / detalle | abría la ficha | igual, con entrada; un "mirar" programático ya no abre otra ficha |
| Cabina | Mostrámelo en 3D | **MIRAR** | movía la cámara y la vista | idem + chip "Volver a la vista anterior" |
| Cabina | Ver en el avión | **MIRAR** | cambiaba la vista principal | idem + chip (Volver a la cabina = el propio botón) |
| Cabina | Ver el aire | **ABRIR** `aire/<exp>` | `openLab` cambiaba de pestaña | barra "← Volver a Ficha «Mezcla»" |
| Cabina | "Todos los controles" / ‹ / Esc | subir | cerraba la ficha | Atrás si vino de la lista |
| Lecciones | tarjeta → lección | detalle | `lbOpen` | entrada `basico/<id>` |
| Lecciones | **Mostrámelo en 3D** (nuevo) | **MIRAR** | no existía (el paso encuadraba solo) | no cambia de pestaña; chip para volver a la vista del paso |
| Lecciones | **Ver la ficha: X** | **ABRIR** | `showControl`: cambiaba a Cabina sin vuelta | "← Volver a Lección «…» · paso N" → mismo paso, scroll y cámara |
| Lecciones | cambiar de paso | – | – | restablece la vista propia del paso y apaga el chip |
| Lecciones | final: Probalo en el Aire · Checklist · Quiz · siguiente lección | ABRIR / detalle | cambiaba de pestaña | barra de vuelta (siguiente lección = detalle) |
| Lecciones | ‹ Lecciones / Esc | subir | reseteaba la lección | vuelve a la lista; la lección queda "EN CURSO" + Continuar |
| Recorrido | Mostrámelo de nuevo | MIRAR | `trFocus` | idem + chip |
| Recorrido | Más detalles · fin → lección / checklist | ABRIR | cambiaba de pestaña | barra de vuelta |
| Checklists | tarjeta → run | detalle | `clOpen` | entrada `checklists/<id>` |
| Checklists | Mostrámelo en 3D | **MIRAR** | movía la cámara | idem + chip |
| Checklists | **Ver la ficha** (nuevo) | **ABRIR** | no existía | barra de vuelta al ítem |
| Checklists | fin → siguiente · misión · quiz | detalle / ABRIR | cambiaba de pestaña | barra de vuelta |
| Checklists | ‹ Checklists | subir | descartaba el avance | conserva el avance (EN CURSO + Continuar) |
| Misiones | iniciar desde otra pestaña (Home, buscador, checklist) | ABRIR | `setMode` | barra de vuelta; al dejarla de lado pausa el simulador |
| Situaciones | tarjeta → informe | detalle `volar/<id>` | sin historial | entrada propia; ‹ / Esc / Atrás vuelven a la lista |
| Situaciones | chips de mandos | **MIRAR** + botón de ficha **ABRIR** | sólo cámara | cámara con chip; ficha con barra de vuelta |
| Situaciones | "Quiz rápido" | ABRIR | `go('quiz')` | barra de vuelta |
| Quiz | Repasar lección · Ver control · Seguí con… | ABRIR | cambiaba de pestaña | barra de vuelta |
| Glosario | popover **Verlo en 3D** | **MIRAR** | `showControl`: cambiaba de pestaña | sólo la cámara + chip |
| HUD | popovers de estado "Ver en 3D" / "Ver el avión desde afuera" | MIRAR | idem | idem + chip |
| Buscador | resultados (mandos, términos, lecciones, prácticas, aire) | **ABRIR** | cambiaba de pestaña | "← Volver a" donde estabas; la consulta se recuerda al reabrir; Atrás cierra la paleta |
| Buscador | atajos "Ir a …" | IR | – | entrada de historial |
| Home | Continuar · Tu camino · tarjetas de acción | **ABRIR** | `go` | "← Volver a Inicio" |
| Siguiente paso (barra) | botón | ABRIR | `UI.go` | barra de vuelta |
| Consejos del instructor | Mostrámelo · Verlo · Ir a volar · Abrir la checklist | MIRAR / detalle / ABRIR / ABRIR | cambiaban de pestaña | según la clase |
| Barra "Tocaste X" (otra pestaña) | Ver ficha | ABRIR | `showControl` | barra de vuelta |
| Tutorial | pantalla de bienvenida (Kit.dialog) y recorrido con foco | overlay | – | Atrás los cierra; al terminar → IR |
| Ayuda | diálogo | overlay | – | Atrás lo cierra |
| Hoja del celular | puntos de anclaje | – | – | el encabezado muestra la miga o "Volver a …" |
| Vista "Las dos" / intercambio del inset | diseño | parte del contexto 3D | se perdía | se restaura con Atrás / "Volver a la vista anterior" |
| AIRE ↔ otras pestañas | entrar / salir | IR | el túnel / fondo / capas se filtraban | contexto guardado y devuelto |

## 7. Archivos

* `src/nav.js` — núcleo puro (`Nav.create(env)`), registro de proveedores, etiquetas (`fmtLabel`, `crumbText`) y pegamento DOM (`Nav.mount`: barra de
  vuelta, fila Subir + migas, chip, "EN CURSO", Esc / Alt+←).
* `src/ui.js` — `setMode` / `go` crudos; `navGo` · `navOpen` · `navDetail` · `navLook`; `registerNavProviders`; `continueRow`; `confirmLeave`;
  pausa por navegación; overlays (`Kit.dialog`, ayuda); `UI.open`, `UI.lookAt`, `UI.up`, `UI.back`.
* `src/core.js` — `Core.getViewState` / `Core.setViewState`.
* `src/index.html`, `src/styles.css` — `#navbar` (`#nav-return`, `#nav-up` + `#nav-crumbs`, `#nav-pause`), `#nav-live`, bloque "v6 · navegación".
* `src/search.js` (consulta recordada, overlay), `src/glossary.js` (Verlo en 3D = mirar), `src/home.js` (ABRIR), `src/onboarding.js` (overlay),
  `src/lab.js` / `src/situations.js` (entradas de historial de experimentos y situaciones, `Situations.toList`).
* `tests/validate-nav.js` — lógica pura con un historial de mentira: push / back / up / forward, instantáneas, mirar / volver, dedupe, popstate
  desconocido, overlays, cola, sin historial real, watchdog.

## 8. Límites conocidos

* Atrás durante una situación en vuelo la termina (como Subir, pero sin pedir confirmación: `popstate` no se puede frenar).
* Los popovers (glosario, estado, escenario) no empujan entradas: un Atrás con un popover abierto navega (y el popover se cierra con la navegación).
* `Nav.look` no guarda los resaltados del exterior (`setExteriorHighlight`), sólo selección y blancos.
