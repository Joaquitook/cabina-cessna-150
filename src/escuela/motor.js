var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/motor.js — C150.ESCUELA.componentes: el motor de componentes de las lecciones (contrato v7 §5).
 * Cada lección declara sus componentes como { tipo, titulo, descripcion, datos }; este motor los dibuja. Lo que todavía no existe
 * (o cuyos `datos` no se pueden normalizar) se dibuja con el COMPONENTE DE RESERVA: el título + la consigna + "Marcar como hecho".
 * Nada de la lección se bloquea nunca.
 *
 * ============================================================  CÓMO SE REGISTRA UN COMPONENTE (E2 / E3 / pasadas siguientes)
 *
 *   C150.ESCUELA.componentes.register('clasificar', {
 *     normalizar: function (datos, ctx, comp) { … return datosNormalizados | null; },
 *     render:     function (host, datos, ctx)  { … return { destroy: fn, getState: fn?, pause: fn?, resume: fn?, slow: fn? }; }
 *   });
 *
 *   tipo        uno de Mot.TODOS: simulador diagrama animacion clasificar emparejar enlace3d calculadora situacion   (pasada 1)
 *                                  ordenar completar tarjetas diapositiva quiz caso mapa    (pasada 2)    fraseologia    (más adelante)
 *   normalizar  FUNCIÓN PURA (también corre en Node: tests/validate-escuela.js la ejecuta sobre los datos de src/data/escuela/*.json y
 *               exige que devuelva un valor o null SIN tirar error). Recibe el `datos` libre del plan (los esbozos varían: pares como
 *               [a,b] o {a,b}, "texto" con [[hueco]], etc.) y devuelve el esquema propio del componente, o null si no puede armar
 *               algo sensato: entonces el motor muestra la reserva. `ctx` en Node puede ser {} (no uses DOM acá); `comp` es el objeto
 *               completo {tipo, titulo, descripcion, datos} (útil para el título o la consigna).
 *   render      construye el DOM dentro de `host` (un <div class="es-comp-host"> vacío; el título del componente lo pone el motor
 *               arriba, no lo repitas) y devuelve un manejador. Todo con Kit.el / ctx.h (nunca innerHTML con datos) y clases es-* o
 *               las del Kit. Si render tira un error, el motor limpia el host y muestra la reserva.
 *               destroy()  libera timers / listeners / loops (se llama al cambiar de paso, al salir de la lección y al re-dibujar).
 *               pause() / resume()   opcionales: se llaman al salir de la pestaña Escuela / al volver (animaciones, loops).
 *               slow(estado)         opcional: ≈ 15 Hz mientras la pestaña está abierta (el estado del Sim, igual que Lab.slow).
 *               getState()           opcional: JSON simple para depurar.
 *
 *   ctx (lo arma src/escuela/leccion.js; todo lo que sigue existe siempre salvo `api` y `store` en pruebas):
 *     leccion {id, titulo, modulo, paginas, minutos}    paso {n, clave, titulo}     key  id estable de la instancia dentro de la lección ('p2.0', 'pr.1')
 *     api      el api de ui.js (labApi): h, icon, cc/has/core, applyPreset, setMode, showToast, reducedMotion, viewport…
 *     h(tag, props, ...hijos)  = Kit.el        icon(nombre, tamaño?) = Kit.icon         Kit = C150.Kit        store = C150.ESCUELA.store.get()
 *     hecho          true si el componente ya estaba hecho (el alumno vuelve a la lección)
 *     done()         el componente se completó: cuenta para la lección y se recuerda (idempotente). Llamalo UNA vez que el alumno "lo logró"
 *                    (clasificó todo, movió el deslizador a la zona, vio todas las escenas…).
 *     score(correctas, total, {retry, fallos, id})   componentes con nota: suma a la práctica de la lección (feeds estrellas / temas flojos).
 *                    retry:true = reintento (no cuenta como intento nuevo del puntaje; el mejor queda). fallos:[ref, …] = ítems errados:
 *                    cada uno entra al mazo de repaso espaciado como {id:'<lección>:<tipo>:<ref>', tipo, ref} (caja 1, vence mañana).
 *                    No resta nunca. Para un componente sin nota usá sólo done().
 *     glosario(termino, definicion?)    abre la definición de un término (Glossary.show si existe; si no, un diálogo con `definicion`)
 *     mirar(fn, {label})                MIRAR: corre fn (mueve la cámara / vista 3D) SIN cambiar de pestaña; aparece el chip "Volver a la vista anterior" (Nav.look)
 *     visor(target, {caption, label, returnLabel, onClose}) → bool   VISOR 3D (contrato v8): abre el visor a pedido (cabina / pose / avión) con la lección al lado; false = no hay 3D (usá mirar)
 *                    target: {control:id} | {pose:id} | {vista:'exterior'|'cabina', foco?} | function (ver src/escuela/visor.js)
 *     abrir(ruta, {returnLabel})        ABRIR: 'cabina/yoke', 'aire/fuerzas', 'basico/<id>', 'volar/<id>', 'escuela/AER-03-02'… con la barra "← Volver a la lección … · paso N"
 *     enlace({tipo, id})                atajo según el tipo del plan: control · aire/experimento · leccion · situacion · escuela (id de lección) · pose (mirar)
 *     reducedMotion  true si el alumno pidió "reducir movimiento" (no animes: cambiá de estado directo)        onDark  true si el tema es oscuro
 *     ahora()        Date.now()    (inyectable en pruebas)
 *
 *   Reglas de diseño: lenguaje AIRE (Kit.slider / Kit.chain / Kit.callout, tokens del styleguide), botones de 44 px en celular, nada horizontal que desborde,
 *   foco visible, teclado completo, voseo, términos explicados, sin emoji como icono (src/icons.js). Colores: el naranja sólo para la acción principal.
 *
 * ============================================================  ESQUEMAS DE `datos` (los fija cada componente al implementarse; se documentan en su archivo)
 *   simulador     { controles:[{id,etiqueta,min,max,paso,valor,unidad}], modelo, salidas:[{id,etiqueta,formato}], grafico?, umbrales?, escenarios? }
 *   diagrama      { viewBox, capas:[{id,nombre,svg}], hotspots:[{id,x,y,titulo,texto,capa?}], modoPrueba? }
 *   animacion     { duracion, escenas:[{t,texto,cambios}], motor:'svg|canvas|3d', etiquetas? }
 *   clasificar    { categorias:[{id,nombre}], items:[{texto,cat,explicacion?}] }          emparejar  { pares:[{a,b}], distractoresB? }
 *   enlace3d      { destino:'cabina|aire|exterior|vuelo', control?, pose?, aire?:{vista,foco}, estado?, resaltar?, consigna? }
 *   calculadora   { herramienta, entradas:[{id,etiqueta,unidad,valor}], ejemplo?, pasos:true }       situacion  { escena, opciones:[{texto,resultado,correcta,siguiente?}], leccionFinal }
 *   ordenar       { consigna?, items:[{id, texto, icono?, explicacion?}] (YA en el orden correcto), inicio?, fin?, nota? }                       (c-ordenar.js; acepta items+orden, pasos, sólo orden…)
 *   completar     { consigna?, frases:[{texto con ___, huecos:[{respuesta, alternativas?, tipo?:'ficha'|'escribir'|'libre', unidad?, explicacion?, pista?, sugerencias?}], explicacion?}], distractores?, nota? }   (c-completar.js)
 *   tarjetas      { consigna?, mazo:[{idx, frente, dorso, pista?, figura?, bloque?}], bloques?:[{id, nombre, n}], nota? }                        (c-tarjetas.js; el repaso espaciado va en store.js)
 *   diapositiva   { pasos:[{titulo?, texto, escena?|figura?+capas?/mostrar?/ocultar?/resalta?, icono?, dato?}], figura?, autoplay?, nota? }                  (c-diapositiva.js; escena = icono · dato · lista · comparar · flujo · formula)
 *   mapa          { fondo:'plano-hangares-sur'|…, capas?, puntos:[{id,x,y,nombre,texto?,rol?,capa?}], zonas:[{id,poligono|rect,nombre,texto?,capa?,tono?}], rutas?, vistas?|carnets?, encontra?, nota? }   (c-mapa.js + mapas.js; x 0–100, y 0–66,7)
 *   caso          { titulo, contexto, ficticio?, pasos:[{titulo?, cuando?, texto, decision?:{pregunta, opciones, correcta, explicacion, resultado?}}], aprendizajes:[…], fuente?, nota? }   (c-caso.js)
 *   quiz          { preguntas:[{pregunta, opciones, correcta, explicacion?, pagina?}], n?, aprobacion?, aciertosMinimos?, repetible?, titulo? }                 (c-quiz.js; comparte la cara del mini-quiz: ES.leccion.vistaPregunta)
 *
 * ============================================================  API DEL MOTOR (Mot = C150.ESCUELA.componentes)
 *   Mot.register(tipo, def) → bool      Mot.get(tipo) → def|null     Mot.has(tipo)     Mot.tipos() → tipos registrados     Mot.unregister(tipo)
 *   Mot.TIPOS_P1 · Mot.TIPOS_P2 · Mot.TIPOS_LUEGO · Mot.TODOS · Mot.META[tipo] = {codigo, nombre}      Mot.conocido(tipo) → bool
 *   Mot.codigo(tipo) → 'SIM'    Mot.nombre(tipo) → 'Simulador'    Mot.esPractica(tipo) → bool (los que califican y van en la "Práctica")
 *   Mot.normalizar(comp, ctx) → datos | null   (nunca tira)
 *   Mot.render(host, comp, ctx) → manejador {destroy, fallback:bool, …}   (nunca tira: ante cualquier error cae a la reserva)
 *   Mot.reserva(host, comp, ctx, motivo) → manejador     'pronto' (tipo todavía sin implementar) | 'datos' (no se pudo normalizar) | 'error'
 *   Mot.ctxMinimo(extra?) → un ctx sin lección para probar un componente suelto (styleguide, Node)
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes = ES.componentes || {};

  var reg = {};
  function isFn(f) { return typeof f === 'function'; }
  function log(msg, e) { if (root.console && console.error) console.error('[Escuela] ' + msg, e || ''); }

  Mot.TIPOS_P1 = ['simulador', 'diagrama', 'animacion', 'clasificar', 'emparejar', 'enlace3d', 'calculadora', 'situacion'];
  Mot.TIPOS_P2 = ['ordenar', 'completar', 'tarjetas', 'diapositiva', 'quiz', 'caso', 'mapa'];
  Mot.TIPOS_LUEGO = ['fraseologia'];
  Mot.TODOS = Mot.TIPOS_P1.concat(Mot.TIPOS_P2, Mot.TIPOS_LUEGO);
  Mot.META = {
    simulador: { codigo: 'SIM', nombre: 'Simulador' }, diagrama: { codigo: 'DGR', nombre: 'Diagrama interactivo' }, animacion: { codigo: 'ANI', nombre: 'Animación paso a paso' },
    clasificar: { codigo: 'CLA', nombre: 'Clasificá' }, emparejar: { codigo: 'EMP', nombre: 'Unir pares' }, enlace3d: { codigo: '3D', nombre: 'Mirá en 3D' },
    calculadora: { codigo: 'CAL', nombre: 'Calculadora guiada' }, situacion: { codigo: 'SIT', nombre: 'Situación para decidir' },
    ordenar: { codigo: 'ORD', nombre: 'Poné en orden' }, completar: { codigo: 'CMP', nombre: 'Completá' }, tarjetas: { codigo: 'TAR', nombre: 'Tarjetas de repaso' },
    diapositiva: { codigo: 'DIA', nombre: 'Diapositiva animada' }, quiz: { codigo: 'QUZ', nombre: 'Quiz tipo DINACIA' }, caso: { codigo: 'CAS', nombre: 'Caso real' },
    mapa: { codigo: 'MAP', nombre: 'Mapa interactivo' }, fraseologia: { codigo: 'FRA', nombre: 'Fraseología y radio' }
  };
  // Los que se resuelven "haciendo" y califican: van en la etapa de Práctica de la lección. El resto acompaña a los puntos clave (los pasos).
  var PRACTICA = { clasificar: 1, emparejar: 1, ordenar: 1, completar: 1, situacion: 1, fraseologia: 1, caso: 1, quiz: 1, tarjetas: 1 };

  Mot.conocido = function (t) { return Object.prototype.hasOwnProperty.call(Mot.META, t); };
  Mot.codigo = function (t) { return Mot.conocido(t) ? Mot.META[t].codigo : String(t || '?').slice(0, 3).toUpperCase(); };
  Mot.nombre = function (t) { return Mot.conocido(t) ? Mot.META[t].nombre : String(t || 'Actividad'); };
  Mot.esPractica = function (t) { return Object.prototype.hasOwnProperty.call(PRACTICA, t); };

  /* ------------------------------------------------------------------ registro */
  Mot.register = function (tipo, def) {
    if (!Mot.conocido(tipo) || !def || !isFn(def.render)) { log('register: tipo desconocido o sin render: ' + tipo); return false; }
    reg[tipo] = { normalizar: isFn(def.normalizar) ? def.normalizar : function (d) { return d === undefined ? null : d; }, render: def.render };
    return true;
  };
  Mot.unregister = function (tipo) { delete reg[tipo]; };
  Mot.has = function (tipo) { return Object.prototype.hasOwnProperty.call(reg, tipo); };
  Mot.get = function (tipo) { return Mot.has(tipo) ? reg[tipo] : null; };
  Mot.tipos = function () { return Object.keys(reg); };

  /** Datos normalizados de un componente, o null si no hay componente registrado o no pudo armar nada. Nunca tira. */
  Mot.normalizar = function (comp, ctx) {
    comp = comp || {};
    var def = Mot.get(comp.tipo);
    if (!def) return null;
    try {
      var d = def.normalizar(comp.datos, ctx || {}, comp);
      return (d === undefined) ? null : d;
    } catch (e) { log('normalizar ' + comp.tipo, e); return null; }
  };

  /* ------------------------------------------------------------------ ctx mínimo (pruebas, styleguide) */
  Mot.ctxMinimo = function (extra) {
    var K = C150.Kit || {}, done = false;
    var ctx = {
      leccion: { id: 'XXX-00-00', titulo: 'Prueba', modulo: 'XXX', paginas: '', minutos: 0 }, paso: { n: 1, clave: 'p1', titulo: 'Prueba' }, key: 'p1.0',
      api: null, h: K.el, icon: K.icon, Kit: K, store: null, hecho: false,
      done: function () { done = true; ctx.hecho = true; }, score: function () {}, glosario: function () {}, mirar: function (fn) { if (isFn(fn)) fn(); }, visor: function () { return false; },
      abrir: function () {}, enlace: function () {}, reducedMotion: false, onDark: true, ahora: function () { return Date.now(); }, _done: function () { return done; }
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) ctx[k] = extra[k];
    return ctx;
  };

  /* ------------------------------------------------------------------ la reserva */
  /** Título + consigna + "Marcar como hecho". motivo: 'pronto' | 'datos' | 'error'. */
  Mot.reserva = function (host, comp, ctx, motivo) {
    comp = comp || {}; ctx = ctx || Mot.ctxMinimo();
    var K = C150.Kit, h = ctx.h || (K && K.el), icon = ctx.icon || (K && K.icon);
    var nota = motivo === 'pronto' ? 'Esta actividad interactiva llega pronto. Mientras tanto, leé la consigna y marcala cuando la hayas hecho por tu cuenta.'
      : 'No pudimos armar esta actividad. Leé la consigna y marcala cuando la hayas hecho por tu cuenta.';
    var btn = h('button', { type: 'button', 'class': 'btn btn--small es-fb-btn' });
    function pintar(hecho) {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      btn.disabled = !!hecho;
      btn.setAttribute('aria-pressed', hecho ? 'true' : 'false');
      btn.appendChild(icon('check')); btn.appendChild(document.createTextNode(hecho ? 'Hecho' : 'Marcar como hecho'));
      btn.className = 'btn btn--small es-fb-btn' + (hecho ? ' is-done' : '');
    }
    btn.addEventListener('click', function () { if (isFn(ctx.done)) ctx.done(); pintar(true); });
    pintar(!!ctx.hecho);
    host.appendChild(h('div', { 'class': 'es-fb' },
      comp.descripcion ? h('p', { 'class': 'es-fb-d', text: comp.descripcion }) : null,
      h('p', { 'class': 'es-fb-n' }, icon('info'), h('span', { text: nota })),
      btn));
    return { destroy: function () {}, fallback: true, motivo: motivo };
  };

  /* ------------------------------------------------------------------ el dibujo de un componente (con su marco) */
  /** Dibuja el componente `comp` en `host`: marco (código + nombre + título) y adentro el componente o la reserva. Nunca tira. */
  Mot.render = function (host, comp, ctx) {
    comp = comp || {}; ctx = ctx || Mot.ctxMinimo();
    var K = C150.Kit, h = ctx.h || (K && K.el);
    var inner = h('div', { 'class': 'es-comp-host' });
    host.appendChild(h('section', { 'class': 'es-comp es-comp--' + (Mot.conocido(comp.tipo) ? comp.tipo : 'x'), 'data-tipo': comp.tipo || '' },
      h('p', { 'class': 'es-comp-k' }, h('span', { 'class': 'es-code', text: Mot.codigo(comp.tipo) }), h('span', { text: Mot.nombre(comp.tipo) })),
      comp.titulo ? h('h3', { 'class': 'es-comp-t', text: comp.titulo }) : null,
      inner));
    var def = Mot.get(comp.tipo), motivo = def ? 'datos' : 'pronto';
    if (def) {
      var datos = Mot.normalizar(comp, ctx);
      if (datos !== null) {
        try {
          var hd = def.render(inner, datos, ctx) || {};
          if (!isFn(hd.destroy)) hd.destroy = function () {};
          hd.fallback = false;
          return hd;
        } catch (e) {
          log('render ' + comp.tipo, e); motivo = 'error';
          while (inner.firstChild) inner.removeChild(inner.firstChild);
        }
      }
    }
    return Mot.reserva(inner, comp, ctx, motivo);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Mot;
})(root.C150);
