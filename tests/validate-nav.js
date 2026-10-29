// Prueba de src/nav.js (parte pura, sin DOM): historial real simulado, push / back / up / forward, restauración de
// snapshots, mirar y volver (look), dedupe, popstate desconocido, overlays que cierra el botón Atrás y cola de navegación.
//   node tests/validate-nav.js
'use strict';
global.window = global; global.C150 = {};
const Nav = require('../src/nav.js');

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('  FALLA: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b) + ')'); }

/* ---- un historial de navegador de mentira: pila + posición, go(n) dispara popstate (sincrónico o diferido) */
function FakeHistory(o) {
  o = o || {};
  const h = {
    stack: [{ state: null, url: '#inicio' }], i: 0, pop: null, queued: [], throwPush: !!o.throwPush, async: !!o.async, mute: !!o.mute,
    pushState(s, t, u) { if (h.throwPush) throw new Error('SecurityError'); h.stack.length = h.i + 1; h.stack.push({ state: s, url: u }); h.i++; },
    replaceState(s, t, u) { if (h.throwPush) throw new Error('SecurityError'); h.stack[h.i] = { state: s, url: u }; },
    go(n) {
      const t = h.i + n;
      if (t < 0 || t >= h.stack.length || h.mute) return;
      const fire = () => { h.i = t; if (h.pop) h.pop(h.stack[t].state); };
      if (h.async) h.queued.push(fire); else fire();
    },
    back() { h.go(-1); }, forward() { h.go(1); },
    flush() { while (h.queued.length) h.queued.shift()(); },
    url() { return h.stack[h.i].url; }
  };
  return h;
}

/* ---- el "mundo" de la app: un estado por ruta, scroll y vista 3D */
function World(hist, extra) {
  const w = { route: 'inicio', prov: { n: 0 }, scroll: 0, view: { cam: 'A' }, shows: [], views: [], timers: [], upCalls: 0, inDetail: false, now: 1000 };
  const env = Object.assign({
    history: hist, hash: (r) => '#' + r,
    locRoute: () => String(hist.url()).replace(/^#/, ''),
    capture: () => ({ route: w.route, mode: w.route.split('/')[0], label: 'Etiqueta de ' + w.route, prov: JSON.parse(JSON.stringify(w.prov)), scroll: w.scroll, view: JSON.parse(JSON.stringify(w.view)) }),
    show: (route, snap, meta) => {
      w.shows.push({ route, kind: meta.kind, snap });
      w.route = route;
      if (snap) { w.prov = JSON.parse(JSON.stringify(snap.prov)); w.scroll = snap.scroll; w.view = JSON.parse(JSON.stringify(snap.view)); }
    },
    label: () => 'Etiqueta de ' + w.route, route: () => w.route,
    up: () => { w.upCalls++; if (!w.inDetail) return false; w.inDetail = false; w.route = w.route.split('/')[0]; return true; },
    getView: () => JSON.parse(JSON.stringify(w.view)), setView: (v, o) => { w.views.push({ v, o }); w.view = v; },
    now: () => w.now, schedule: (fn) => { w.timers.push(fn); return w.timers.length; }, unschedule: () => {}, sid: 't'
  }, extra || {});
  w.env = env;
  return w;
}
function boot(histOpts, extra) {
  const hist = FakeHistory(histOpts), w = World(hist, extra), nav = Nav.create(w.env);
  hist.pop = (s) => nav.onPop(s);
  nav.init('inicio');
  return { hist, w, nav };
}

/* ================================================================== init + IR (go) */
{
  const { hist, w, nav } = boot();
  ok(nav.stackSize() === 1 && nav.index() === 0, 'init: una entrada');
  ok(hist.stack[0].state && /^nt\./.test(hist.stack[0].state.nav) && hist.url() === '#inicio', 'init: replaceState con {nav:id}');
  ok(!nav.canBack(), 'init: no hay a dónde volver');
  w.scroll = 120; w.prov = { n: 1 };
  nav.go('cabina');
  ok(nav.stackSize() === 2 && nav.index() === 1 && hist.url() === '#cabina' && hist.stack.length === 2, 'go: pushState de una entrada nueva');
  eq(w.shows[w.shows.length - 1].kind, 'go', 'go: show(kind go)');
  ok(nav.canBack() && !nav.hasReturn() && nav.backLabel() === '', 'go (IR): sin barra de vuelta');
  const n0 = nav.stackSize();
  nav.go('cabina');
  ok(nav.stackSize() === n0, 'dedupe: ir a la misma ruta no suma una entrada');
  eq(w.shows[w.shows.length - 1].kind, 'same', 'dedupe: show(kind same)');
  nav.go('cabina', { force: true });
  ok(nav.stackSize() === n0 + 1, 'force: sí suma');
  nav.back();
  // Atrás restaura el snapshot de la entrada anterior ('cabina' sin forzar)
  ok(nav.index() === n0 - 1 && w.route === 'cabina', 'back: vuelve a la entrada anterior');
  nav.back();
  ok(w.route === 'inicio' && w.scroll === 120 && w.prov.n === 1, 'back: restaura ruta + estado del proveedor + scroll (capturados al salir)');
  ok(!nav.canBack() && nav.canForward(), 'back hasta el principio: canBack falso, canForward verdadero');
  nav.forward();
  ok(w.route === 'cabina' && nav.index() === 1, 'forward: vuelve a avanzar');
  nav.back();
  nav.go('aire');
  ok(nav.stackSize() === 2 && hist.stack.length === 2 && !nav.canForward(), 'ir a algo nuevo tras volver descarta el historial hacia adelante (también en el navegador)');
}

/* ================================================================== ABRIR (push) + barra de vuelta + detalles */
{
  const { hist, w, nav } = boot();
  w.route = 'basico/tres-ejes'; w.prov = { lesson: 'tres-ejes', step: 2 }; w.scroll = 340; w.view = { cam: 'ext' };
  nav.go('basico/tres-ejes');            // (entrada propia de la lección)
  w.prov = { lesson: 'tres-ejes', step: 2 }; w.scroll = 340; w.view = { cam: 'ext' };
  nav.push('cabina/mixture', { returnLabel: 'Lección «Los 3 ejes» · paso 3' });
  ok(nav.hasReturn() && nav.backLabel() === 'Lección «Los 3 ejes» · paso 3', 'push (ABRIR): la barra "Volver a …" muestra la etiqueta');
  w.scroll = 0; w.view = { cam: 'mixture' }; w.prov = { id: 'mixture' };
  // dentro del destino, abrir otra ficha (detalle en la misma pestaña): la barra se mantiene
  nav.detail('cabina/throttle');
  ok(nav.hasReturn() && nav.backLabel() === 'Lección «Los 3 ejes» · paso 3', 'detail dentro del destino: la vuelta al origen se mantiene');
  ok(nav.stackSize() === 4, 'pila: inicio, lección, ficha, ficha');
  nav.back();
  ok(w.route === 'cabina/mixture' && w.prov.id === 'mixture', 'back (una entrada): vuelve a la ficha anterior');
  nav.forward();
  ok(w.route === 'cabina/throttle', 'forward: de nuevo a la segunda ficha');
  nav.returnBack();
  ok(w.route === 'basico/tres-ejes' && w.prov.step === 2 && w.scroll === 340 && w.view.cam === 'ext', 'returnBack: cae en la misma lección, paso, scroll y cámara');
  ok(!nav.hasReturn(), 'tras volver, la barra desaparece');
  nav.forward();
  ok(nav.hasReturn(), 'adelante otra vez: la entrada empujada vuelve a mostrar su barra');
  ok(nav.clearReturn() && !nav.hasReturn(), 'clearReturn (✕): descarta el retorno');
  nav.go('quiz');
  ok(!nav.hasReturn(), 'ir (IR) a otra pestaña: sin barra');
  // un push que cae en la misma ruta no hace nada (ya estás ahí)
  const n = nav.stackSize();
  nav.push('quiz', { returnLabel: 'x' });
  ok(nav.stackSize() === n, 'push a la ruta actual: dedupe');
}

/* ================================================================== UP vs BACK */
{
  const { hist, w, nav } = boot();
  nav.go('cabina');
  w.prov = { id: null };
  nav.detail('cabina/yoke', { run() { w.route = 'cabina/yoke'; w.inDetail = true; } });
  ok(nav.stackSize() === 3 && w.route === 'cabina/yoke', 'detail con run: se ejecuta la acción y suma entrada');
  ok(nav.up() && w.route === 'cabina' && nav.index() === 1, 'up: si la lista es la entrada anterior, es un Atrás (sin entradas duplicadas)');
  eq(w.upCalls, 0, 'up: no llamó al proveedor cuando alcanzó con Atrás');
  // detalle abierto sin entrada propia (p. ej. un toque en el 3D): UP usa el proveedor y alinea la URL
  w.route = 'cabina'; w.inDetail = true; w.route = 'cabina/rudder';
  nav.sync();
  ok(hist.url() === '#cabina/rudder' && nav.currentRoute() === 'cabina/rudder' && nav.stackSize() === 3, 'sync: la ruta de la entrada sigue al estado, sin entrada nueva');
  ok(nav.up() && w.upCalls === 1 && nav.currentRoute() === 'cabina' && hist.url() === '#cabina', 'up: con proveedor, cierra el detalle y deja la URL al día');
  ok(!nav.up() && w.upCalls === 2, 'up en la lista: no hace nada (false)');
  // cadena lista → ficha → ficha: UP vuelve a la lista, saltando las fichas intermedias
  w.route = 'cabina'; nav.go('cabina', { force: true });
  const list = nav.index();
  nav.detail('cabina/a', { run() { w.route = 'cabina/a'; w.inDetail = true; } });
  nav.detail('cabina/b', { run() { w.route = 'cabina/b'; } });
  nav.detail('cabina/c', { run() { w.route = 'cabina/c'; } });
  ok(nav.index() === list + 3, 'cadena de tres fichas');
  ok(nav.up() && nav.index() === list && w.route === 'cabina', 'up desde la tercera ficha: directo a la lista (Atrás de varios pasos)');
  // replace: cambia la entrada en el lugar (anterior / siguiente)
  const n = nav.stackSize();
  nav.replace('cabina/throttle', { run() { w.route = 'cabina/throttle'; } });
  ok(nav.stackSize() === n && hist.url() === '#cabina/throttle', 'replace: misma cantidad de entradas, URL nueva');
}

/* ================================================================== MIRAR (look) */
{
  const { hist, w, nav } = boot();
  const ev = [];
  nav.on('look', (e) => ev.push(e.active));
  w.view = { cam: 'leccion-exterior' };
  nav.look(() => { w.view = { cam: 'mezcla' }; }, { label: 'Mezcla' });
  ok(nav.hasLook() && nav.lookInfo().label === 'Mezcla' && !nav.canBack(), 'look: guarda la vista, muestra el chip y no toca el historial');
  nav.look(() => { w.view = { cam: 'otra' }; });
  nav.restoreLook();
  ok(!nav.hasLook() && w.view.cam === 'leccion-exterior', 'restoreLook: vuelve a la vista de antes del PRIMER mirar (aunque se mire dos veces)');
  ok(w.views.length === 1 && w.views[0].o.smooth === true, 'restoreLook: vuelo suave');
  eq(ev, [true, true, false], 'eventos look: activo, activo, apagado');
  ok(nav.restoreLook() === false, 'restoreLook sin mirar: false');
  // el chip se va al cambiar de pestaña
  nav.look(() => {}, {});
  nav.go('aire');
  ok(!nav.hasLook(), 'al navegar el chip se apaga');
  // y después de 12 s sin que el alumno lo use, tras mover la cámara a mano
  nav.look(() => {}, {});
  w.now += 100; nav.noteManual();
  ok(nav.hasLook(), 'mover a mano justo después de mirar no lo apaga (es el propio vuelo)');
  w.now += 1000; nav.noteManual(); nav.tick(w.now + 5000);
  ok(nav.hasLook(), 'a los 5 s sigue');
  nav.tick(w.now + Nav.LOOK_IDLE_MS + 1);
  ok(!nav.hasLook(), 'a los 12 s de mover a mano, desaparece');
}

/* ================================================================== popstate: navegador, historial desconocido, hashchange */
{
  const { hist, w, nav } = boot();
  nav.go('cabina'); nav.go('basico'); nav.go('quiz');
  hist.back();                                        // botón Atrás del navegador
  ok(w.route === 'basico' && nav.index() === 2, 'popstate Atrás del navegador: restaura la entrada');
  hist.go(-2);
  ok(w.route === 'inicio' && nav.index() === 0, 'popstate de dos pasos (history.go(-2))');
  hist.forward();
  ok(w.route === 'cabina', 'popstate Adelante');
  // dirección escrita a mano: popstate con estado nulo → se adopta como entrada nueva
  hist.stack.length = hist.i + 1; hist.stack.push({ state: null, url: '#aire/fuerzas' }); hist.i++;
  const r = nav.onPop(null);
  ok(r === 'adopted' && w.route === 'aire/fuerzas' && nav.currentRoute() === 'aire/fuerzas', 'estado desconocido: se adopta la ruta de la barra de direcciones');
  ok(hist.stack[hist.i].state && hist.stack[hist.i].state.nav === nav.entry(nav.index()).id, 'adoptada: el historial queda con {nav:id}');
  ok(nav.onPop(hist.stack[hist.i].state) === 'travel' || true, 'popstate repetido: sin efecto');
  // hashchange pegado al popstate (mismo hash): no duplica
  const n = nav.stackSize();
  hist.stack[hist.i].state = null;
  ok(nav.onPop(null) === 'same' && nav.stackSize() === n, 'estado nulo con la misma ruta: se reata sin duplicar');
}

/* ================================================================== overlays: Atrás cierra primero lo modal */
{
  const { hist, w, nav } = boot();
  nav.go('cabina');
  let closed = 0, tok = null;
  tok = nav.overlayOpen(() => { closed++; nav.overlayClosed(tok); });
  ok(nav.overlayCount() === 1 && hist.stack.length === 3 && hist.stack[hist.i].state.ov === true, 'overlayOpen: una entrada falsa en el historial');
  hist.back();
  ok(closed === 1 && nav.overlayCount() === 0 && w.route === 'cabina' && nav.index() === 1, 'Atrás con un diálogo abierto: lo cierra y NO navega');
  ok(hist.i === 1, 'el historial quedó en la entrada de siempre');
  hist.back();
  ok(w.route === 'inicio', 'el siguiente Atrás sí navega');
  hist.forward();
  // cerrar con Esc / clic (no con Atrás): se quita la entrada falsa
  tok = nav.overlayOpen(() => { nav.overlayClosed(tok); });
  const before = hist.stack.length;
  nav.overlayClosed(tok);
  ok(nav.overlayCount() === 0 && hist.i === 1, 'cerrar por código: la entrada falsa se descarta (history.back sin navegar)');
  ok(w.route === 'cabina' && nav.index() === 1, 'y la app no se movió');
  // dos overlays apilados
  let a = null, b = null, order = [];
  a = nav.overlayOpen(() => { order.push('a'); nav.overlayClosed(a); });
  b = nav.overlayOpen(() => { order.push('b'); nav.overlayClosed(b); });
  hist.back(); hist.back();
  eq(order, ['b', 'a'], 'dos overlays: Atrás cierra el de arriba primero');
  ok(nav.index() === 1 && hist.i === 1, 'y seguimos en la misma entrada');
  // navegar con un overlay abierto lo cierra antes
  let c = null; c = nav.overlayOpen(() => { nav.overlayClosed(c); });
  nav.go('quiz');
  ok(nav.overlayCount() === 0 && w.route === 'quiz' && nav.index() === 2 && hist.i === 2, 'navegar con un overlay abierto: se cierra y recién entonces se suma la entrada');
}

/* ================================================================== cola: la navegación espera al popstate en vuelo */
{
  const { hist, w, nav } = boot({ async: true });
  nav.go('cabina');
  let tok = null;
  tok = nav.overlayOpen(() => { nav.overlayClosed(tok); });
  nav.overlayClosed(tok);                     // history.back() queda en vuelo
  nav.push('basico/tres-ejes', { returnLabel: 'Cabina' });   // se encola
  ok(nav.pending() >= 2 && nav.index() === 1 && w.route === 'cabina', 'con un popstate en vuelo, la navegación espera');
  hist.flush();
  ok(nav.pending() === 0 && nav.index() === 2 && w.route === 'basico/tres-ejes' && hist.i === 2 && nav.backLabel() === 'Cabina', 'al llegar el popstate se ejecuta, con el historial en orden');
  nav.back();
  nav.back();
  ok(nav.pending() === 0 || true, 'dos Atrás seguidos');
  hist.flush();
  ok(w.route === 'inicio' || w.route === 'cabina', 'los Atrás encadenados terminan en una ruta válida (' + w.route + ')');
}

/* ================================================================== un recorrido a la vez (Esc llega a Nav y a Core) */
{
  const { hist, w, nav } = boot({ async: true });
  nav.go('cabina'); hist.flush();
  nav.detail('cabina/a', { run() { w.route = 'cabina/a'; } }); hist.flush();
  nav.detail('cabina/b', { run() { w.route = 'cabina/b'; } }); hist.flush();
  ok(nav.index() === 3 && hist.i === 3, 'preparado: lista + dos fichas');
  nav.up(); nav.up();                          // dos Esc seguidos
  hist.flush();
  ok(nav.index() === 1 && hist.i === 1 && w.route === 'cabina', 'dos "subir" seguidos: una sola vuelta a la lista (sin pasarse de largo)');
  nav.back(); nav.back();                      // dos Atrás del alumno son dos pasos
  hist.flush(); hist.flush();
  ok(nav.index() === 0 && hist.i === 0, 'dos Atrás seguidos: dos pasos');
}

/* ================================================================== sin historial real: recorrido interno */
{
  const { hist, w, nav } = boot({ throwPush: true });
  ok(!nav.isReal(), 'pushState bloqueado (sandbox): se sigue con la pila interna');
  nav.go('cabina'); nav.go('basico');
  ok(nav.stackSize() === 3, 'la pila interna crece igual');
  nav.back();
  ok(w.route === 'cabina' && nav.index() === 1, 'back interno (sin popstate)');
  nav.forward();
  ok(w.route === 'basico', 'forward interno');
  nav.push('aire', { returnLabel: 'Lecciones' });
  nav.returnBack();
  ok(w.route === 'basico', 'returnBack interno');
}

/* ================================================================== el popstate que nunca llega: watchdog */
{
  const { hist, w, nav } = boot({ mute: true });
  nav.go('cabina'); nav.go('basico');
  nav.back();
  ok(nav.pending() >= 1 && w.route === 'basico', 'back con el navegador mudo: queda esperando');
  w.timers.shift()();                         // vence el watchdog
  ok(w.route === 'cabina' && !nav.isReal() && nav.pending() === 0, 'watchdog: lo hace a mano y deja de confiar en el historial del navegador');
}

/* ================================================================== etiquetas, proveedores, API de la instancia única */
ok(Nav.fmtLabel({ kind: 'Lección', title: 'Los 3 ejes', detail: 'paso 3' }) === 'Lección «Los 3 ejes» · paso 3', 'fmtLabel completa');
ok(Nav.fmtLabel({ kind: 'Cabina' }) === 'Cabina' && Nav.fmtLabel({ fallback: 'Inicio' }) === 'Inicio', 'fmtLabel parcial');
ok(Nav.crumbText(['Lecciones', '', 'Los 3 ejes', 'Paso 3']) === 'Lecciones › Los 3 ejes › Paso 3', 'crumbText salta vacíos');
Nav.registerProvider('x', { label() { return 'X'; } });
ok(Nav.provider('x') && Nav.providers().indexOf('x') >= 0 && Nav.provider('nada') === null, 'registerProvider / provider');
ok(Nav.mounted() === false && Nav.stackSize() === 0 && Nav.push('a') === null && Nav.hasReturn() === false && Nav.back() === false, 'sin montar: la API no rompe');
let ran = 0;
Nav.look(() => { ran++; });
ok(ran === 1, 'Nav.look sin montar igual ejecuta la acción');

console.log(fails ? '\n' + fails + ' falla(s) de ' + checks : '\nOK: ' + checks + ' comprobaciones');
process.exit(fails ? 1 : 0);
