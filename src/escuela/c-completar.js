var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/c-completar.js — componente `completar` (CMP): frases con huecos que se llenan con fichas (contrato v7 pasada 2).
 * Tocá una ficha y después el hueco (o el hueco y después la ficha), o arrastrá la ficha al hueco; con teclado: Tab, Enter en la ficha y Enter en el hueco.
 * Cada ficha se corrige AL INSTANTE y con suavidad: si va, el hueco se cierra en verde con su porqué; si no, la ficha vuelve al banco (sin castigo) con una pista, y
 * después de dos intentos el banco te marca cuál era. Los huecos que se ESCRIBEN (números con su unidad, o palabras) se verifican con "Comprobar" o con Enter.
 * Hay huecos "libres" (una bitácora: sin respuesta correcta): se guardan solos en este dispositivo. Siempre hay "Ver la respuesta" y "Probar de nuevo".
 * Más de 6 huecos se reparten en rondas (el banco de cada ronda es corto y sólo trae sus fichas + algunas de relleno).
 * Al terminar: ctx.score(huecos bien a la primera, total, {fallos}) y ctx.done(); los que costaron entran al mazo de repaso. Los huecos libres no califican.
 *
 * ESQUEMA DE `datos` (canónico):
 *   { consigna?:'texto', nota?:'texto',
 *     frases:[{ texto:'Todo piloto pide un ___ de sus cervezas.',       cada ___ es un hueco, en orden; **término**, ==clave== y {{75|%}} se muestran con el formato de la lección
 *               huecos:[{ respuesta:'recuento', alternativas?:['recuentos'],       otras respuestas válidas (también para lo que se escribe)
 *                         tipo?:'ficha' | 'escribir' | 'libre',                    ficha (por defecto): se llena con una ficha · escribir: se teclea · libre: se teclea y no tiene respuesta correcta
 *                         unidad?:'%', explicacion?:'texto', pista?:'texto', sugerencias?:['idea', …]  (sugerencias: sólo para huecos libres) }],
 *               explicacion?:'texto' }],
 *     distractores?:['aseguradora', …] }                                  fichas de relleno que no son respuesta de ningún hueco
 * normalizar entiende los esbozos del plan:  frases:[[texto, respuesta]] (con `fichas` = los distractores) · frases:[{texto, respuesta|correcta, alternativas, unidad}] ·
 * un párrafo `texto` con [[id]] (o {{id}}) y `huecos:[{id, correcta|respuesta|valor, alternativas, fichas, libre, tipo, unidad, explicacion}]` (+ `distractores`). Una respuesta numérica
 * se compara como NÚMERO ("6" = "6,0"; "75 %" = "75"); la hora "6:00" = "06:00"; el resto sin mayúsculas, tildes ni espacios de más.
 * Handle: destroy · getState.
 *
 * Parte pura (ES.completar, probada en Node): normalizar · igual(entrada, hueco) · comparable(texto) · numero(texto) · partes(texto) → [{t:'txt'|'hueco'}] · rondas(frases) · banco(frases, ronda, distractores, semilla)
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var Mot = ES.componentes;
  if (!Mot) return;

  function isFn(f) { return typeof f === 'function'; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function esObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(x) { return typeof x === 'string' ? x.trim() : (typeof x === 'number' && isFinite(x) ? String(x) : ''); }
  function slug(t) { t = String(t === undefined || t === null ? '' : t); if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function publica(t) { t = str(t); return t && !/a confirmar|errata|dudas? para|nota para/i.test(t) ? t : ''; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  /* ================================================================== comparar respuestas (puro) */
  function sinTildes(s) { s = String(s); return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s; }
  /** El texto en su forma comparable: sin tildes, en minúscula, sin puntuación de los bordes ni espacios de más. */
  function comparable(s) { return sinTildes(str(s)).toLowerCase().replace(/[«»"“”'‘’]/g, '').replace(/\s+/g, ' ').replace(/^[\s.,;:!?¡¿()]+|[\s.,;:!?¡¿()]+$/g, ''); }
  /** El número de un texto ("75", "6,5", "75 %", "-3 kt") o null. */
  function numero(s) {
    var m = /^([-+]?\d+(?:[.,]\d+)?)\s*(?:%|[a-zA-Zºº°/]{1,8})?$/.exec(str(s));
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }
  /** Una hora "6:00" / "06:00" → minutos; si no es una hora, null. */
  function hora(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(str(s)); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function sinUnidad(entrada, unidad) {
    var e = str(entrada), u = str(unidad);
    if (!u) return e;
    var re = new RegExp('\\s*' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
    return e.replace(re, '').trim() || e;
  }
  /** ¿`entrada` es una respuesta válida del hueco? (la respuesta o sus alternativas; los números como números; las horas como horas). */
  function igual(entrada, hueco) {
    var e0 = sinUnidad(entrada, hueco && hueco.unidad), e = comparable(e0);
    if (!e) return false;
    var resp = [hueco.respuesta].concat(arr(hueco.alternativas)), i;
    for (i = 0; i < resp.length; i++) {
      var r = str(resp[i]);
      if (!r) continue;
      if (comparable(r) === e) return true;
      var nr = numero(r), ne = numero(e0);
      if (nr !== null && ne !== null && Math.abs(nr - ne) < 1e-9) return true;
      var hr = hora(r), he = hora(e0);
      if (hr !== null && he !== null && hr === he) return true;
    }
    return false;
  }

  /* ================================================================== partes de una frase, rondas y banco (puro) */
  /** Parte `texto` en trozos de texto y huecos (cada ___ de tres o más guiones bajos es un hueco). */
  function partes(texto) {
    var out = [], re = /_{3,}/g, ult = 0, m, k = 0;
    texto = String(texto === undefined || texto === null ? '' : texto);
    while ((m = re.exec(texto))) {
      if (m.index > ult) out.push({ t: 'txt', v: texto.slice(ult, m.index) });
      out.push({ t: 'hueco', k: k++ }); ult = m.index + m[0].length;
    }
    if (ult < texto.length) out.push({ t: 'txt', v: texto.slice(ult) });
    return out;
  }
  function nHuecos(f) { return arr(f.huecos).length; }
  /** Reparte las frases en rondas de a lo sumo 5 frases y unos 6 huecos (parejas entre sí). Devuelve una lista de listas de índices de frase. */
  function rondas(frases) {
    frases = arr(frases);
    var total = frases.reduce(function (s, f) { return s + nHuecos(f); }, 0);
    if (frases.length <= 5 && total <= 8) return [frases.map(function (f, i) { return i; })];
    var n = Math.max(Math.ceil(total / 6), Math.ceil(frases.length / 5)), meta = Math.ceil(total / n), out = [], cur = [], g = 0;
    frases.forEach(function (f, i) {
      cur.push(i); g += nHuecos(f);
      if ((g >= meta || cur.length >= 5) && out.length < n - 1) { out.push(cur); cur = []; g = 0; }
    });
    if (cur.length) out.push(cur);
    return out;
  }
  /**
   * El banco de fichas de una ronda: la respuesta de cada hueco que se llena con ficha + algunas de relleno (las que no sirven para ningún hueco de la ronda).
   * Devuelve [{id, texto, relleno}] barajado con semilla estable. `idxFrases` = los índices de frase de la ronda.
   */
  function banco(frases, idxFrases, distractores, semilla) {
    var A = ES.arrastre, chips = [], n = 0, huecos = [];
    arr(idxFrases).forEach(function (fi) {
      arr(arr(frases)[fi] && frases[fi].huecos).forEach(function (hu) { huecos.push(hu); if ((hu.tipo || 'ficha') === 'ficha') chips.push({ id: 'c' + (n++), texto: str(hu.respuesta), relleno: false, uso: null }); });
    });
    if (!chips.length) return [];
    var otros = [];
    arr(distractores).forEach(function (d) {
      var t = str(d);
      if (!t || huecos.some(function (hu) { return igual(t, hu); }) || otros.some(function (o) { return comparable(o) === comparable(t); })) return;
      otros.push(t);
    });
    var quiero = Math.min(otros.length, Math.max(2, Math.ceil(chips.length * 0.7)));
    var sel = A && isFn(A.mezclar) ? A.mezclar(otros, semilla + '|d').slice(0, quiero) : otros.slice(0, quiero);
    sel.forEach(function (t) { chips.push({ id: 'c' + (n++), texto: t, relleno: true, uso: null }); });
    return A && isFn(A.mezclar) ? A.mezclar(chips, semilla + '|b') : chips;
  }

  /* ================================================================== normalizar (puro) */
  var K_TEXTO = ['texto', 'frase', 'enunciado', 'oracion'];
  var K_RESP = ['respuesta', 'correcta', 'valor', 'solucion', 'ficha', 'palabra'];
  var K_ALT = ['alternativas', 'aceptadas', 'sinonimos', 'tambien', 'otras'];
  var K_DIST = ['distractores', 'fichas', 'extra', 'extras', 'senuelos', 'fichasExtra', 'relleno'];

  function lista(x) { return arr(x).map(str).filter(Boolean); }
  /** Un hueco crudo ({respuesta, alternativas, …} o un texto suelto) → hueco canónico, o null si no tiene respuesta y no es libre. */
  function huecoDe(x, ctx0) {
    var h = esObj(x) ? x : { respuesta: x }, i, resp = '';
    for (i = 0; i < K_RESP.length && !resp; i++) resp = str(h[K_RESP[i]]);
    var alt = [];
    K_ALT.forEach(function (k) { alt = alt.concat(lista(h[k])); });
    var tipo = str(h.tipo).toLowerCase(), libre = h.libre === true || /libre/.test(tipo);
    var escribir = h.escribir === true || /^(texto|escribir|entrada|numero|numerico|input)$/.test(tipo);
    var fichas = lista(h.fichas || h.sugerencias || h.ideas);
    if (libre) return { respuesta: '', alternativas: [], tipo: 'libre', unidad: str(h.unidad), explicacion: publica(h.explicacion), pista: publica(h.pista), sugerencias: fichas.slice(0, 6) };
    if (!resp) return null;
    alt = alt.filter(function (a, k) { return comparable(a) !== comparable(resp) && alt.indexOf(a) === k; });
    return { respuesta: resp, alternativas: alt, tipo: escribir ? 'escribir' : 'ficha', unidad: str(h.unidad), explicacion: publica(h.explicacion) || publica(h.porque), pista: publica(h.pista), sugerencias: [], _fichas: libre ? [] : fichas };
  }
  /** Una frase cruda → {texto, huecos[], explicacion} (el texto ya con ___), o null. */
  function fraseDe(raw) {
    var texto = '', resp = null, extra = {}, i;
    if (typeof raw === 'string') texto = str(raw);
    else if (Array.isArray(raw)) { texto = str(raw[0]); resp = raw.length > 1 ? raw[1] : null; extra = esObj(raw[2]) ? raw[2] : {}; }
    else if (esObj(raw)) {
      for (i = 0; i < K_TEXTO.length && !texto; i++) texto = str(raw[K_TEXTO[i]]);
      extra = raw;
      if (Array.isArray(raw.huecos)) resp = raw.huecos;
      else if (Array.isArray(raw.respuestas)) resp = raw.respuestas;
      else for (i = 0; i < K_RESP.length && resp === null; i++) if (raw[K_RESP[i]] !== undefined && raw[K_RESP[i]] !== '') resp = raw[K_RESP[i]];
    }
    if (!texto) return null;
    // esbozo del plan: la respuesta va dentro de la propia frase, como [[12]]
    if (!/_{3,}/.test(texto) && /\[\[[^\]]+\]\]/.test(texto)) {
      var dentro = [];
      texto = texto.replace(/\[\[\s*([^\]]+?)\s*\]\]/g, function (m, a) { dentro.push(a); return '___'; });
      if (resp === null) resp = dentro.length === 1 ? dentro[0] : dentro;
    }
    var np = partes(texto).filter(function (p) { return p.t === 'hueco'; }).length;
    if (!np) return null;
    var crudos = Array.isArray(resp) ? resp : (resp === null ? [] : [resp]);
    if (crudos.length !== np) return null;
    var huecos = crudos.map(function (c) {
      var base = esObj(c) ? c : { respuesta: c };
      if (!esObj(c) && np === 1) base = Object.assign({}, { respuesta: c }, { alternativas: extra.alternativas, unidad: extra.unidad, tipo: extra.tipo, libre: extra.libre, explicacion: extra.explicacion, pista: extra.pista, escribir: extra.escribir });
      return huecoDe(base);
    });
    if (huecos.some(function (hh) { return !hh; })) return null;
    return { texto: texto, huecos: huecos, explicacion: publica(extra.explicacion), _fichas: lista(extra.fichas) };
  }
  /** Un párrafo con [[id]] / {{id}} y su lista de huecos declarados → frase canónica con ___, o null. */
  function parrafoDe(texto, declarados) {
    var salida = [], ok = true, k = 0;
    var s = String(texto).replace(/\[\[\s*([^\]]+?)\s*\]\]|\{\{\s*([^}|]+?)\s*\}\}/g, function (m, a, b) {
      var id = (a || b || '').trim(), hu = declarados[id] !== undefined ? declarados[id] : (declarados[slug(id)] !== undefined ? declarados[slug(id)] : null);
      if (hu === null) { if (a) ok = false; return m; }           // [[x]] sin declarar: la frase no sirve; {{x}} sin declarar es el marcado de cifra de la lección
      salida.push(hu); k++; return '___';
    });
    if (!ok || !salida.length || partes(s).filter(function (p) { return p.t === 'hueco'; }).length !== salida.length) return null;
    var huecos = salida.map(function (hu) { return JSON.parse(JSON.stringify(hu)); });
    return { texto: s, huecos: huecos, explicacion: '' };
  }

  function normalizar(datos, ctx, comp) {
    try {
      if (!esObj(datos)) return null;
      var frases = [], i, dist = [];
      var declarados = null;
      if (Array.isArray(datos.huecos) && datos.huecos.length && (datos.texto || Array.isArray(datos.textos))) {
        declarados = {};
        datos.huecos.forEach(function (hu, n) {
          var c = huecoDe(hu);
          if (!c) return;
          var id = esObj(hu) ? str(hu.id) : '';
          if (id) { declarados[id] = c; declarados[slug(id)] = c; }
          declarados[String(n + 1)] = declarados[String(n + 1)] || c;
        });
      }
      if (declarados) {
        arr(Array.isArray(datos.texto) ? datos.texto : (Array.isArray(datos.textos) ? datos.textos : [datos.texto])).forEach(function (t) { var f = parrafoDe(str(t), declarados); if (f) frases.push(f); });
      } else {
        var fuente = Array.isArray(datos.frases) ? datos.frases : (Array.isArray(datos.oraciones) ? datos.oraciones : (Array.isArray(datos.items) ? datos.items : null));
        arr(fuente).forEach(function (r) { var f = fraseDe(r); if (f) frases.push(f); });
      }
      if (!frases.length || frases.length > 14) return null;
      var total = frases.reduce(function (s, f) { return s + f.huecos.length; }, 0);
      if (total < 1 || total > 30) return null;
      // fichas de relleno: las de la lista + las de cada hueco, sin repetir y sin ninguna que sea respuesta de un hueco
      var crudas = [];
      K_DIST.forEach(function (k) { if (Array.isArray(datos[k])) crudas = crudas.concat(lista(datos[k])); });
      frases.forEach(function (f) { crudas = crudas.concat(f._fichas || []); delete f._fichas; f.huecos.forEach(function (hu) { crudas = crudas.concat(hu._fichas || []); delete hu._fichas; }); });
      var todos = [];
      frases.forEach(function (f) { f.huecos.forEach(function (hu) { todos.push(hu); }); });
      crudas.forEach(function (t) {
        if (!t || todos.some(function (hu) { return hu.tipo !== 'libre' && igual(t, hu); }) || dist.some(function (d) { return comparable(d) === comparable(t); })) return;
        dist.push(t);
      });
      return { consigna: publica(datos.consigna) || publica(datos.pregunta) || publica(datos.instruccion), nota: publica(datos.nota) || publica(datos.aclaracion), frases: frases, distractores: dist.slice(0, 16) };
    } catch (e) { return null; }
  }

  /* ================================================================== guardado de lo escrito en los huecos libres (sólo en este dispositivo) */
  var LS = 'c150.escuela.libre.v1';
  function leerLibres() { try { var o = JSON.parse(root.localStorage.getItem(LS) || '{}'); return esObj(o) ? o : {}; } catch (e) { return {}; } }
  function guardarLibre(k, v) {
    try {
      var o = leerLibres(), ks = Object.keys(o);
      if (ks.length > 120 && o[k] === undefined) delete o[ks[0]];
      if (v) o[k] = String(v).slice(0, 160); else delete o[k];
      root.localStorage.setItem(LS, JSON.stringify(o));
    } catch (e) { /* sin almacenamiento: queda en la pantalla */ }
  }

  /* ================================================================== render */
  function render(host, datos, ctx) {
    var h = ctx.h, icon = ctx.icon, reducido = !!ctx.reducedMotion, Arr = ES.arrastre, K = ctx.Kit, B = ES.bloques;
    var base = (ctx.leccion && ctx.leccion.id || '') + '|' + (ctx.key || '');
    var semilla = base + '|cmp';
    var frases = datos.frases.map(function (f, fi) { return { texto: f.texto, partes: partes(f.texto), explicacion: f.explicacion, huecos: f.huecos, fi: fi }; });
    // huecos globales, en orden de lectura
    var G = [];
    frases.forEach(function (f) { f.gaps = f.huecos.map(function (hu, k) { var g = { gi: G.length, f: f, k: k, def: hu, estado: 'vacio', valor: '', intentos: 0, fallo: false, revelado: false }; G.push(g); return g; }); });
    var libres = G.filter(function (g) { return g.def.tipo === 'libre'; }), calificados = G.filter(function (g) { return g.def.tipo !== 'libre'; });
    var soloLibre = !calificados.length;
    var guardado = leerLibres();
    libres.forEach(function (g) { var v = guardado[base + '|' + g.gi]; if (typeof v === 'string' && v) { g.valor = v; g.estado = 'escrito'; } });
    var tandas = rondas(frases), nRonda = 0, intento = 0, chips = [], sel = null, esRetry = !!ctx.hecho, puntuado = false, terminado = false, arrastres = [];
    var bdeps = { glosario: function (t, d) { if (isFn(ctx.glosario)) ctx.glosario(t, d); }, termino: function () { return null; } };

    var elHint = h('p', { 'class': 'es-note es-cmp-hint', text: datos.consigna || (soloLibre ? 'Completá las frases con tus palabras. Se guardan solas en este dispositivo.' : 'Tocá una ficha y después el hueco donde va. También podés arrastrarla, o tocar primero el hueco.') });
    var elCount = h('p', { 'class': 'es-meta es-cmp-count', 'aria-live': 'polite' });
    var elBankK = h('p', { 'class': 'es-meta es-cmp-bankk', text: 'Fichas' });
    var elBank = h('div', { 'class': 'es-cmp-chips', role: 'group', 'aria-label': 'Fichas para completar' });
    var elBankBox = h('div', { 'class': 'es-cmp-bank' }, elBankK, elBank);
    var elLive = h('p', { 'class': 'sr-only', 'aria-live': 'polite', role: 'status' });
    var elFr = h('ol', { 'class': 'es-cmp-frs' });
    var elFb = h('div', { 'class': 'feedback qz-fb es-cmp-fb', role: 'status', 'aria-live': 'polite', hidden: true });
    var elAcc = h('div', { 'class': 'btn-row es-cmp-acc' });
    var box = h('div', { 'class': 'es-cmp' + (reducido ? ' is-rm' : '') }, elHint, elCount, elBankBox, elFr, elFb, elAcc, elLive);
    host.appendChild(box);

    function etiq(g) { return enRonda().indexOf(g) + 1; }
    function enRonda() { return tandas[nRonda].reduce(function (a, fi) { return a.concat(frases[fi].gaps); }, []); }
    function resuelto(g) { return g.def.tipo === 'libre' ? !!str(g.valor) : (g.estado === 'ok' || g.estado === 'revelado'); }
    function pendientes() { return enRonda().filter(function (g) { return !resuelto(g); }); }
    function anunciar(t) { elLive.textContent = ''; setTimeout(function () { elLive.textContent = t; }, 30); }
    /** El rótulo del banco: cuántas fichas quedan, o qué elegiste (no cambia el alto: nada se corre cuando elegís). */
    function rotulo() {
      var libres0 = chips.filter(function (c) { return c.uso === null; }).length;
      elBankK.textContent = sel ? (sel.chip ? 'Elegiste «' + sel.chip.texto + '» · tocá el hueco donde va' : 'Elegiste el hueco ' + etiq(sel.gap) + ' · tocá la ficha que va ahí') : (chips.length ? 'Fichas · ' + libres0 + ' sin usar' : '');
      elBankK.classList.toggle('is-sel', !!sel);
    }
    /** El aviso de lo último que probaste, justo debajo de esa frase (la ficha y el hueco están ahí: no hay que ir a buscar el resultado). */
    var ultimo = null;
    function nota(g, tono, titulo, texto) { ultimo = { gi: g.gi, tono: tono, titulo: titulo, texto: texto }; anunciar(titulo + ' ' + (texto || '')); }
    function decir(tono, titulo, texto) {
      while (elFb.firstChild) elFb.removeChild(elFb.firstChild);
      elFb.className = 'feedback qz-fb es-cmp-fb ' + (tono === 'ok' ? 'feedback--ok' : tono === 'bad' ? 'feedback--bad' : '');
      elFb.hidden = false;
      elFb.appendChild(h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(tono === 'ok' ? 'check' : tono === 'bad' ? 'bulb' : 'info')));
      elFb.appendChild(h('div', { 'class': 'qz-fb-b' }, h('strong', { text: titulo }), texto ? h('span', { text: texto }) : null));
    }
    function inline(t) {
      var f = document.createDocumentFragment();
      if (B && isFn(B.inline)) f.appendChild(B.inline(K, t, bdeps)); else f.appendChild(document.createTextNode(t));
      return f;
    }
    function refDe(g) { var S = ES.store; return isFn(S && S.hashTexto) ? S.hashTexto(g.f.texto + '#' + g.k).slice(0, 6) : String(g.gi); }
    function chipEl(chip) { var cs = elBank.querySelectorAll('.es-cmp-chip'); for (var i = 0; i < cs.length; i++) if (cs[i].getAttribute('data-id') === chip.id) return cs[i]; return null; }
    function gapEl(g) { return elFr.querySelector('[data-gi="' + g.gi + '"]'); }

    /* ---------------------------------------------------------- selección */
    function seleccionar(x) {
      sel = x;
      var cs = elBank.querySelectorAll('.es-cmp-chip');
      for (var i = 0; i < cs.length; i++) cs[i].setAttribute('aria-pressed', x && x.chip && x.chip.id === cs[i].getAttribute('data-id') ? 'true' : 'false');
      var gs = elFr.querySelectorAll('.es-cmp-gap');
      for (var j = 0; j < gs.length; j++) gs[j].classList.toggle('is-sel', !!(x && x.gap && String(x.gap.gi) === gs[j].getAttribute('data-gi')));
      rotulo();
      if (x) anunciar(x.chip ? 'Elegiste «' + x.chip.texto + '». Ahora tocá el hueco donde va.' : 'Elegiste el hueco ' + etiq(x.gap) + '. Ahora tocá la ficha que va ahí.');
    }
    function alChip(chip, ev) {
      if (terminado || chip.uso !== null) return;
      if (sel && sel.gap) { colocar(chip, sel.gap); return; }
      if (sel && sel.chip === chip) { seleccionar(null); return; }
      seleccionar({ chip: chip });
      if (ev && ev.detail === 0) { var v = pendientes().filter(function (g) { return g.def.tipo === 'ficha'; })[0]; var e = v && gapEl(v); if (e) e.focus({ preventScroll: true }); }      // con teclado: el foco salta al primer hueco vacío
    }
    function alHueco(g) {
      if (terminado || g.estado === 'ok' || g.estado === 'revelado') return;
      if (sel && sel.chip) { colocar(sel.chip, g); return; }
      if (sel && sel.gap === g) { seleccionar(null); return; }
      seleccionar({ gap: g });
    }

    /* ---------------------------------------------------------- corregir */
    function sacudir(el) { if (el && !reducido) { el.classList.add('is-shake'); setTimeout(function () { el.classList.remove('is-shake'); }, 450); } }
    function pista(g) { return g.def.pista ? ' Pista: ' + g.def.pista : ''; }
    function colocar(chip, g) {
      if (terminado || g.def.tipo !== 'ficha' || g.estado === 'ok' || chip.uso !== null) return;
      seleccionar(null);
      if (igual(chip.texto, g.def)) {
        g.estado = 'ok'; g.valor = chip.texto; chip.uso = g.gi;
        nota(g, 'ok', '¡Eso es!', '«' + chip.texto + '» va ahí.' + (g.def.explicacion ? ' ' + g.def.explicacion : '') + (g.f.explicacion && g.f.huecos.length === 1 && !g.def.explicacion ? ' ' + g.f.explicacion : ''));
        pintar();
        if (!pendientes().length) { cerrarRonda(); return; }
        var c = elBank.querySelector('.es-cmp-chip:not([disabled])'); if (c) c.focus({ preventScroll: true });      // el foco vuelve al banco para elegir la próxima ficha
      } else {
        g.intentos++; g.fallo = true;
        nota(g, 'bad', 'Esa ficha no va ahí.', '«' + chip.texto + '» no encaja en el hueco ' + etiq(g) + '. Probá con otra: no hay penalización.' + pista(g));
        pintar();
        var ge = gapEl(g); sacudir(ge);
        if (g.intentos >= 2) {            // dos intentos: el banco marca la ficha que era (sin dejar a nadie trabado)
          var acierto = chips.filter(function (c2) { return c2.uso === null && !c2.relleno && igual(c2.texto, g.def); })[0], ce = acierto && chipEl(acierto);
          if (ce) { ce.classList.add('is-hint'); setTimeout(function () { ce.classList.remove('is-hint'); }, 2800); }
        }
        if (ge) ge.focus({ preventScroll: true });
      }
    }
    function escribirOk(g) {
      g.estado = 'ok'; g.revelado = false;
      nota(g, 'ok', '¡Eso es!', '«' + g.valor + '» va ahí.' + (g.def.explicacion ? ' ' + g.def.explicacion : ''));
    }
    /** Verifica lo escrito en los huecos "escribir" no vacíos (Enter en uno, o el botón Comprobar en todos). */
    function comprobarEscritos(soloEste) {
      if (terminado) return;
      var lista = (soloEste ? [soloEste] : enRonda()).filter(function (g) { return g.def.tipo === 'escribir' && g.estado !== 'ok' && g.estado !== 'revelado'; });
      var vacios = lista.filter(function (g) { return !str(g.valor); }), mal = [], bien = 0;
      lista.forEach(function (g) {
        if (!str(g.valor)) return;
        if (igual(g.valor, g.def)) { escribirOk(g); bien++; }
        else { g.intentos++; g.fallo = true; mal.push(g); }
      });
      var hayLibresVacios = enRonda().filter(function (g) { return g.def.tipo === 'libre' && !str(g.valor); });
      if (mal.length) {
        nota(mal[0], 'bad', mal.length === 1 ? 'Ese no es.' : 'Todavía no.', (mal.length === 1 ? 'La respuesta del hueco ' + etiq(mal[0]) + ' no es esa.' : 'Hay ' + mal.length + ' huecos que no coinciden (el primero es el ' + etiq(mal[0]) + ').') + ' Revisá y probá de nuevo: no hay penalización.' + pista(mal[0]));
        pintar(); mal.forEach(function (g) { var e = gapEl(g); sacudir(e && e.parentNode); });
        var e0 = gapEl(mal[0]); if (e0) e0.focus({ preventScroll: true });
        return;
      }
      if (!soloEste && (vacios.length || hayLibresVacios.length)) { decir('info', 'Faltan huecos', 'Completá todos los huecos y después comprobá.'); pintar(); var v0 = gapEl((vacios.concat(hayLibresVacios))[0]); if (v0) v0.focus({ preventScroll: true }); return; }
      pintar();
      if (!pendientes().length) cerrarRonda();
      else if (bien) { var sig = gapEl(pendientes()[0]); if (sig && sig.tagName === 'INPUT') sig.focus({ preventScroll: true }); }
    }

    /* ---------------------------------------------------------- dibujo */
    function huecoBtn(g) {
      var ok = g.estado === 'ok' || g.estado === 'revelado', n = etiq(g), nTot = enRonda().length;
      var cls = 'es-cmp-gap' + (ok ? (g.estado === 'revelado' ? ' is-reveal' : ' is-ok') : '') + (sel && sel.gap === g ? ' is-sel' : '') + (g.fallo && !ok ? ' is-miss' : '');
      var b = h('button', { type: 'button', 'class': cls, 'data-gi': g.gi, 'data-es-drop': ok ? null : g.gi, disabled: ok ? true : null,
        'aria-label': 'Hueco ' + n + ' de ' + nTot + (ok ? ': ' + g.valor + (g.estado === 'revelado' ? ' (respuesta)' : ', correcto') : ', vacío'), onclick: function () { alHueco(g); } },
        ok ? [h('span', { 'class': 'es-cmp-gv', text: g.valor }), h('span', { 'class': 'es-cmp-gi', 'aria-hidden': 'true' }, icon(g.estado === 'revelado' ? 'eye' : 'check'))]
          : [h('span', { 'class': 'es-cmp-gn', 'aria-hidden': 'true', text: n })]);
      return b;
    }
    function entrada(g) {
      var n = etiq(g), nTot = enRonda().length, libre = g.def.tipo === 'libre', ok = g.estado === 'ok' || g.estado === 'revelado', rev = g.estado === 'revelado';
      var largo = Math.min(34, Math.max(libre ? 16 : 7, str(g.def.respuesta).length + 3));
      var inp = h('input', { type: 'text', 'class': 'es-cmp-in' + (g.fallo && !ok ? ' is-miss' : '') + (ok ? (rev ? ' is-reveal' : ' is-ok') : ''), 'data-gi': g.gi, size: largo, maxlength: 120, value: g.valor || null,
        autocomplete: 'off', autocapitalize: 'off', spellcheck: libre ? 'true' : 'false', inputmode: !libre && numero(g.def.respuesta) !== null ? 'decimal' : 'text',
        'aria-label': 'Hueco ' + n + ' de ' + nTot + (libre ? ' (escribí con tus palabras)' : '') + (ok ? ': ' + g.valor + (rev ? ' (respuesta)' : ', correcto') : ''), readonly: ok ? true : null,
        oninput: function () {
          g.valor = inp.value;
          if (libre) { g.estado = str(g.valor) ? 'escrito' : 'vacio'; guardarLibre(base + '|' + g.gi, str(g.valor)); }
          else if (g.fallo && inp.classList.contains('is-miss')) inp.classList.remove('is-miss');
        },
        onkeydown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); if (libre) { var nx = G.filter(function (x) { return x.gi > g.gi && x.def.tipo !== 'ficha'; })[0], ne = nx && gapEl(nx); if (ne) ne.focus({ preventScroll: true }); else guardar(); } else comprobarEscritos(g); } } });
      return h('span', { 'class': 'es-cmp-inw' + (ok ? (rev ? ' is-reveal' : ' is-ok') : '') }, h('span', { 'class': 'es-cmp-gn es-cmp-gn--in', 'aria-hidden': 'true', text: n }), inp,
        ok ? h('span', { 'class': 'es-cmp-gi', 'aria-hidden': 'true' }, icon(rev ? 'eye' : 'check')) : null);
    }
    function pintarFrase(f, i) {
      var p = h('p', { 'class': 'es-cmp-p' });
      f.partes.forEach(function (x) {
        if (x.t === 'txt') p.appendChild(inline(x.v));
        else {
          var g = f.gaps[x.k];
          p.appendChild(g.def.tipo === 'ficha' ? huecoBtn(g) : entrada(g));
          if (g.def.unidad) p.appendChild(h('span', { 'class': 'es-cmp-u', text: g.def.unidad }));
        }
      });
      var ideas = f.gaps.filter(function (g) { return g.def.tipo === 'libre' && g.def.sugerencias.length; });
      var aviso = ultimo && f.gaps.some(function (g) { return g.gi === ultimo.gi; }) ? ultimo : null;
      return h('li', { 'class': 'es-cmp-fr' }, h('span', { 'class': 'es-cmp-n', 'aria-hidden': 'true', text: p2(i + 1) }),
        h('div', { 'class': 'es-cmp-fb2' }, p, aviso ? h('div', { 'class': 'es-cmp-note es-cmp-note--' + aviso.tono, 'aria-hidden': 'true' }, icon(aviso.tono === 'ok' ? 'check' : aviso.tono === 'bad' ? 'bulb' : 'info'), h('div', null, h('strong', { text: aviso.titulo }), h('span', { text: aviso.texto }))) : null, ideas.map(function (g) {
          return h('div', { 'class': 'es-cmp-ideas', role: 'group', 'aria-label': 'Ideas para el hueco ' + etiq(g) }, h('span', { 'class': 'es-meta', text: 'Ideas · hueco ' + etiq(g) }),
            g.def.sugerencias.map(function (t) {
              return h('button', { type: 'button', 'class': 'es-cmp-chip es-cmp-chip--idea', onclick: function () {
                g.valor = t; g.estado = 'escrito'; guardarLibre(base + '|' + g.gi, t);
                var e = gapEl(g); if (e) { e.value = t; e.focus({ preventScroll: true }); }
              }, text: t });
            }));
        })));
    }
    function pintar() {
      arrastres.forEach(function (a) { a.destroy(); }); arrastres = [];
      var vals = {}, act = document.activeElement;
      var enfocado = act && act.classList && act.classList.contains('es-cmp-in') ? { gi: act.getAttribute('data-gi'), ini: act.selectionStart, fin: act.selectionEnd } : null;
      // el banco (sólo si hay huecos con ficha en esta ronda)
      while (elBank.firstChild) elBank.removeChild(elBank.firstChild);
      chips.forEach(function (c) {
        var usado = c.uso !== null;
        var b = h('button', { type: 'button', 'class': 'es-cmp-chip' + (usado ? ' is-used' : ''), 'data-id': c.id, 'aria-pressed': sel && sel.chip === c ? 'true' : 'false', disabled: usado || terminado ? true : null,
          onclick: function (ev) { alChip(c, ev); } }, h('span', { text: c.texto }), usado ? h('span', { 'class': 'sr-only', text: ' (ya usada)' }) : null);
        elBank.appendChild(b);
        if (Arr && !usado && !terminado) arrastres.push(Arr.hacer(b, {
          habilitado: function () { return !terminado; },
          alEmpezar: function () { seleccionar({ chip: c }); },
          alSobre: function (d) { var gs = elFr.querySelectorAll('.es-cmp-gap'); for (var i = 0; i < gs.length; i++) gs[i].classList.toggle('is-over', gs[i] === d); },
          alSoltar: function (d) { if (d) colocar(c, G[+d.getAttribute('data-gi')]); else seleccionar(null); },
          alCancelar: function () { seleccionar(null); }
        }));
      });
      elBankBox.hidden = !chips.length;
      rotulo();
      while (elFr.firstChild) elFr.removeChild(elFr.firstChild);
      elFr.className = 'es-cmp-frs' + (frases.length > 1 ? '' : ' es-cmp-frs--single');
      tandas[nRonda].forEach(function (fi) { elFr.appendChild(pintarFrase(frases[fi], fi)); });
      var enR = enRonda(), hechos = enR.filter(function (g) { return g.estado === 'ok' || g.estado === 'revelado' || (g.def.tipo === 'libre' && str(g.valor)); }).length;
      elCount.textContent = (hechos + ' de ' + enR.length + ' huecos completos' + (tandas.length > 1 ? ' · ronda ' + (nRonda + 1) + ' de ' + tandas.length : '')).toUpperCase();
      pintarAcciones();
      if (enfocado) { var ie = elFr.querySelector('.es-cmp-in[data-gi="' + enfocado.gi + '"]'); if (ie && !ie.readOnly) { ie.focus({ preventScroll: true }); try { ie.setSelectionRange(enfocado.ini, enfocado.fin); } catch (e) { /* idem */ } } }
    }
    function pintarAcciones() {
      while (elAcc.firstChild) elAcc.removeChild(elAcc.firstChild);
      if (terminado) { elAcc.appendChild(K.button({ label: 'Probar de nuevo', variant: 'ghost', icon: 'reset', onClick: reiniciar })); return; }
      var enR = enRonda(), escritos = enR.filter(function (g) { return g.def.tipo !== 'ficha'; });
      if (escritos.length) elAcc.appendChild(K.button({ label: soloLibre ? 'Guardar' : 'Comprobar', variant: 'primary', icon: 'check', onClick: function () { if (soloLibre) guardar(); else comprobarEscritos(null); } }));
      if (!soloLibre) elAcc.appendChild(K.button({ label: 'Ver la respuesta', variant: 'ghost', icon: 'eye', onClick: revelar }));
      if (!soloLibre && (G.some(function (g) { return g.estado === 'ok' || g.fallo; }))) elAcc.appendChild(K.button({ label: 'Empezar de nuevo', variant: 'ghost', icon: 'reset', onClick: reiniciar }));
    }

    /* ---------------------------------------------------------- rondas y final */
    function armarRonda() {
      chips = banco(frases, tandas[nRonda], datos.distractores, semilla + '|' + nRonda + '|' + intento);
      sel = null;
    }
    function cerrarRonda(revelada) {
      if (nRonda + 1 < tandas.length) {
        pintar();
        decir(revelada ? 'info' : 'ok', revelada ? 'Esta es la respuesta de la ronda.' : '¡Ronda completa!', 'Quedan ' + (tandas.length - nRonda - 1) + (tandas.length - nRonda - 1 === 1 ? ' ronda más.' : ' rondas más.'));
        while (elAcc.firstChild) elAcc.removeChild(elAcc.firstChild);
        elAcc.appendChild(K.button({ label: 'Seguir con la ronda ' + (nRonda + 2), variant: 'primary', iconRight: 'arrow-right', onClick: function () {
          nRonda++; elFb.hidden = true; armarRonda(); pintar();
          var c = elBank.querySelector('.es-cmp-chip:not([disabled])') || elFr.querySelector('.es-cmp-in'); if (c) c.focus({ preventScroll: true });
        } }));
        return;
      }
      terminar();
    }
    function guardar() {
      var vacios = G.filter(function (g) { return g.def.tipo === 'libre' && !str(g.valor); });
      if (vacios.length) { decir('info', 'Faltan huecos', 'Completá todos los huecos para guardar. Lo que escribiste hasta ahora ya quedó guardado en este dispositivo.'); var e = gapEl(vacios[0]); if (e) e.focus({ preventScroll: true }); return; }
      if (isFn(ctx.done)) ctx.done();
      decir('ok', 'Guardado en este dispositivo', 'Podés volver cuando quieras y cambiar lo que escribiste: se guarda solo.');
    }
    function terminar() {
      terminado = true; seleccionar(null);
      var total = calificados.length, fallos = calificados.filter(function (g) { return g.fallo || g.revelado; });
      if (total && !puntuado) { puntuado = true; if (isFn(ctx.score)) ctx.score(total - fallos.length, total, { retry: esRetry, fallos: fallos.map(refDe) }); }
      if (isFn(ctx.done)) ctx.done();
      pintar();
      var perfecto = !fallos.length;
      while (elFb.firstChild) elFb.removeChild(elFb.firstChild);
      elFb.className = 'feedback qz-fb es-cmp-fb ' + (perfecto ? 'feedback--ok' : '');
      elFb.hidden = false;
      elFb.appendChild(h('span', { 'class': 'qz-fb-ico', 'aria-hidden': 'true' }, icon(perfecto ? 'check' : 'info')));
      elFb.appendChild(h('div', { 'class': 'qz-fb-b' },
        h('strong', { text: perfecto ? (total ? '¡Todos los huecos a la primera!' : 'Listo') : 'Completaste los ' + total + ' huecos. ' + (total - fallos.length) + ' a la primera.' }),
        !perfecto ? h('span', { text: 'Los que costaron van a tu repaso para que los veas de nuevo en unos días.' }) : null));
      elFb.setAttribute('tabindex', '-1'); elFb.focus({ preventScroll: true });
    }
    function revelar() {
      if (terminado) return;
      seleccionar(null);
      enRonda().forEach(function (g) {
        if (g.def.tipo === 'libre' || g.estado === 'ok' || g.estado === 'revelado') return;
        g.estado = 'revelado'; g.revelado = true; g.fallo = true; g.valor = g.def.respuesta;
        if (g.def.tipo === 'ficha') { var c = chips.filter(function (x) { return x.uso === null && !x.relleno && igual(x.texto, g.def); })[0]; if (c) c.uso = g.gi; }
      });
      pintar();
      if (!pendientes().length) cerrarRonda(true);
    }
    function reiniciar() {
      intento++; esRetry = true; puntuado = false; terminado = false; nRonda = 0;
      G.forEach(function (g) { if (g.def.tipo === 'libre') return; g.estado = 'vacio'; g.valor = ''; g.intentos = 0; g.fallo = false; g.revelado = false; });
      ultimo = null; elFb.hidden = true; armarRonda(); pintar();
      var c = elBank.querySelector('.es-cmp-chip:not([disabled])') || elFr.querySelector('.es-cmp-in'); if (c) c.focus({ preventScroll: true });
    }

    box.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && sel) { seleccionar(null); ev.stopPropagation(); } });
    armarRonda(); pintar();
    if (soloLibre && libres.length && libres.every(function (g) { return str(g.valor); }) && ctx.hecho) decir('ok', 'Guardado en este dispositivo', 'Podés volver cuando quieras y cambiar lo que escribiste: se guarda solo.');
    return {
      destroy: function () { arrastres.forEach(function (a) { a.destroy(); }); arrastres = []; },
      getState: function () { return { total: G.length, completos: G.filter(function (g) { return g.estado === 'ok' || g.estado === 'revelado'; }).length, ronda: nRonda + 1, terminado: terminado }; }
    };
  }

  Mot.register('completar', { normalizar: normalizar, render: render });
  ES.completar = { normalizar: normalizar, igual: igual, comparable: comparable, numero: numero, partes: partes, rondas: rondas, banco: banco };
})(root.C150);
