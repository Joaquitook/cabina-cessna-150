var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * escuela/texto.js — C150.ESCUELA.texto: la parte PURA de la lectura editorial (contrato v8 §3). Sin DOM: la corre Node (tests/validate-escuela.js).
 *
 *   Un punto clave de `contenido` es un texto (formato viejo) o un objeto { titulo, texto, tipo, dato:{valor,unidad,etiqueta}, ejemplo, ojo, resumen, n }:
 *     tipo  texto (por defecto) · definicion (titulo = el término) · regla (n = número de la regla; si falta se cuenta solo) · dato (necesita `dato`) ·
 *           idea (cita grande) · ojo (aviso) · ejemplo (tarjeta con pestaña) · lista (el texto se parte por "\n": pasos con numeral grande)
 *     dato / ejemplo / ojo también se aceptan como EXTRAS de cualquier tipo (van después del bloque principal, en ese orden).
 *   Mini-marcado dentro de cualquier texto:   **término** (énfasis + glosario)  ·  ==clave== (resaltador)  ·  {{valor|unidad}} (cifra en mono)
 *   Campo opcional de la lección `resumen`: un texto (la frase de la portada y del cierre) o una lista con una línea por punto clave (RESUMEN EN UNA LÍNEA).
 *
 *   T.markup(s) → [{t:'txt'|'term'|'clave'|'dato', v, u?, a, b}]      T.plano(s) → texto sin marcado      T.balanceado(s) → bool
 *   T.partir(s) → {lead, resto}  primera oración (con las abreviaturas y el marcado a salvo) y el resto      T.parrafos(s) → [párrafos]
 *   T.item(x) → ítem normalizado | null      T.validarItem(x) → [problemas]      T.tituloPaso(item, comp, n)      T.etiquetaTipo(item, comp)
 *   T.listaLineas(s) → {intro, items}      T.layoutPaso(item, comps) → 'texto' | 'solo' | 'dos' | 'centro'      T.recorte(s, max)
 *   T.nbsp(s) (espacio duro entre cifra y unidad: 75 %, 3 min)
 *   T.resumenPaso(lec, item, i) · T.resumenLeccion(lec) · T.promesa(lec, minutos) · T.minutosFalta(minutos, idx, n) · T.p2(n)
 */
(function (C150) {
  'use strict';

  var ES = C150.ESCUELA = C150.ESCUELA || {};
  var T = ES.texto = ES.texto || {};

  function isStr(x) { return typeof x === 'string'; }
  function trim(x) { return isStr(x) ? x.trim() : ''; }
  /** Espacio duro entre una cifra y su unidad (75 %, 3 min): que un título no parta "75" de "%". */
  T.nbsp = function (s) { return String(s === undefined || s === null ? '' : s).replace(/(\d) (%|°|min|kt|ft|NM|km|hs|h)(?![\p{L}\d])/gu, '$1 $2').replace(/ %/g, ' %'); };
  T.p2 = function (n) { n = Math.max(0, Math.floor(+n || 0)); return (n < 10 ? '0' : '') + n; };

  T.TIPOS = ['texto', 'definicion', 'regla', 'dato', 'idea', 'ojo', 'ejemplo', 'lista'];
  T.ROTULO = { texto: 'Punto clave', definicion: 'Definición', regla: 'Regla', dato: 'Dato', idea: 'Idea clave', ojo: 'Ojo', ejemplo: 'Ejemplo', lista: 'Paso a paso' };
  var CAMPOS = { titulo: 1, texto: 1, tipo: 1, dato: 1, ejemplo: 1, ojo: 1, resumen: 1, n: 1 };
  // componentes que piden dos columnas (texto a la izquierda, figura a la derecha); el resto va en una tarjeta centrada
  var DOS = { simulador: 1, diagrama: 1, animacion: 1, calculadora: 1, enlace3d: 1, diapositiva: 1 };      // el mapa necesita ancho: va en una tarjeta centrada (layout 'centro')

  /* ------------------------------------------------------------------ mini-marcado */
  T.markup = function (s) {
    s = String(s === undefined || s === null ? '' : s);
    var out = [], buf = '', bufA = 0, i = 0, n = s.length, two, j, inner, k, val;
    function flush(end) { if (buf) { out.push({ t: 'txt', v: buf, a: bufA, b: end }); buf = ''; } }
    while (i < n) {
      two = s.substr(i, 2);
      if (two === '**' || two === '==') {
        j = s.indexOf(two, i + 2);
        inner = j > i + 2 ? s.slice(i + 2, j) : '';
        if (inner && inner.trim() && inner.indexOf('\n') < 0) {
          flush(i); out.push({ t: two === '**' ? 'term' : 'clave', v: inner, a: i, b: j + 2 }); i = j + 2; bufA = i; continue;
        }
      } else if (two === '{{') {
        j = s.indexOf('}}', i + 2);
        if (j > i + 2) {
          inner = s.slice(i + 2, j); k = inner.indexOf('|');
          val = (k >= 0 ? inner.slice(0, k) : inner).trim();
          if (val && inner.indexOf('\n') < 0) { flush(i); out.push({ t: 'dato', v: val, u: k >= 0 ? inner.slice(k + 1).trim() : '', a: i, b: j + 2 }); i = j + 2; bufA = i; continue; }
        }
      }
      if (!buf) bufA = i;
      buf += s.charAt(i); i++;
    }
    flush(n);
    return out;
  };
  T.plano = function (s) {
    return T.markup(s).map(function (x) { return x.t === 'dato' ? x.v + (x.u ? ' ' + x.u : '') : x.v; }).join('');
  };
  /** true si no quedó ningún marcador suelto (**, ==, {{ o }} sin pareja). */
  T.balanceado = function (s) {
    return !T.markup(s).some(function (x) { return x.t === 'txt' && /\*\*|==|\{\{|\}\}/.test(x.v); });
  };

  /* ------------------------------------------------------------------ primera oración (auto-lead) */
  var ABREV = /(?:^|[\s(«“"])(?:sr|sra|srta|dr|dra|ing|lic|etc|ej|vs|aprox|núm|pág|págs|pp|p|nº|n°|fig|cap|art|tel|av|km|ft|kt|mín|máx|min|seg|hs|obs|aprox|c\/u|ca)\.$/i;
  function partirParrafo(s) {
    var spans = T.markup(s).filter(function (x) { return x.t !== 'txt'; });
    function dentro(p) { for (var i = 0; i < spans.length; i++) if (p >= spans[i].a && p < spans[i].b) return true; return false; }
    var re = /[.!?…]+["»”')\]]*(\s+)(?=[A-ZÁÉÍÓÚÑÜ¿¡«“"(0-9])/g, m, fin;
    while ((m = re.exec(s))) {
      if (dentro(m.index)) continue;
      if (ABREV.test(s.slice(0, m.index + 1))) continue;
      fin = m.index + m[0].length - m[1].length;
      if (fin < 28) continue;                                 // una oración cortita se une con la que sigue
      return { lead: s.slice(0, fin).trim(), resto: s.slice(fin).trim() };
    }
    return { lead: s.trim(), resto: '' };
  }
  /** Primera oración (lead) y el resto. El primer párrafo manda: si tiene una sola oración, el lead es el párrafo entero. */
  T.partir = function (texto) {
    var s = String(texto === undefined || texto === null ? '' : texto).replace(/\r/g, '').trim();
    if (!s) return { lead: '', resto: '' };
    var nl = s.indexOf('\n'), p1 = nl < 0 ? s : s.slice(0, nl), mas = nl < 0 ? '' : s.slice(nl + 1).trim();
    var r = partirParrafo(p1);
    return { lead: r.lead, resto: [r.resto, mas].filter(Boolean).join('\n') };
  };
  T.parrafos = function (s) { return String(s || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean); };
  /** Texto de una lista: líneas; si la primera termina en ":" y hay más, es la introducción. */
  T.listaLineas = function (s) {
    var l = String(s || '').replace(/\r/g, '').split('\n').map(function (x) { return x.trim().replace(/^(?:\d+[.)]|[-*•–])\s+/, ''); }).filter(Boolean), intro = '';
    if (l.length > 2 && /:$/.test(l[0])) intro = l.shift();
    return { intro: intro, items: l };
  };
  T.recorte = function (s, max) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    var c = s.slice(0, max), k = c.lastIndexOf(' ');
    return (k > max * 0.6 ? c.slice(0, k) : c).replace(/[\s,;:.]+$/, '') + '…';
  };

  /* ------------------------------------------------------------------ puntos clave */
  function dato(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    var v = (typeof d.valor === 'number' && isFinite(d.valor)) ? String(d.valor) : trim(d.valor);
    return v ? { valor: v, unidad: trim(d.unidad), etiqueta: trim(d.etiqueta) } : null;
  }
  /** Normaliza un punto clave (texto u objeto) → {titulo, texto, tipo, dato, ejemplo, ojo, resumen, n, obj} | null si no tiene nada que mostrar. */
  T.item = function (x) {
    if (isStr(x)) { var t = x.trim(); return t ? { titulo: '', texto: t, tipo: 'texto', dato: null, ejemplo: '', ojo: '', resumen: '', n: null, obj: false } : null; }
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    var it = {
      titulo: trim(x.titulo), texto: trim(x.texto), tipo: T.TIPOS.indexOf(x.tipo) >= 0 ? x.tipo : 'texto', dato: dato(x.dato),
      ejemplo: trim(x.ejemplo), ojo: trim(x.ojo), resumen: trim(x.resumen), n: (typeof x.n === 'number' || isStr(x.n)) && String(x.n).trim() ? String(x.n).trim() : null, obj: true
    };
    return (it.texto || it.dato || it.ejemplo || it.ojo) ? it : null;
  };
  /** Problemas de un punto clave (para tests/validate-escuela.js). Un texto vacío o con el marcado roto también cuenta. */
  T.validarItem = function (x) {
    var e = [];
    function marca(s, w) { if (!T.balanceado(s)) e.push(w + ': marcado sin cerrar (**término**, ==clave==, {{valor|unidad}})'); }
    if (isStr(x)) { if (!x.trim()) e.push('texto vacío'); else marca(x, 'texto'); return e; }
    if (!x || typeof x !== 'object' || Array.isArray(x)) return ['un punto clave es un texto o un objeto'];
    Object.keys(x).forEach(function (k) { if (!CAMPOS[k]) e.push('campo desconocido «' + k + '»'); });
    ['titulo', 'texto', 'ejemplo', 'ojo', 'resumen'].forEach(function (k) {
      if (x[k] === undefined) return;
      if (!isStr(x[k])) e.push(k + ' debe ser un texto'); else if (x[k].trim()) marca(x[k], k);
    });
    if (x.tipo !== undefined && T.TIPOS.indexOf(x.tipo) < 0) e.push('tipo «' + x.tipo + '» no existe (' + T.TIPOS.join(', ') + ')');
    if (x.dato !== undefined && !dato(x.dato)) e.push('dato debe ser {valor, unidad?, etiqueta?} con valor');
    if (x.dato && typeof x.dato === 'object') ['unidad', 'etiqueta'].forEach(function (k) { if (x.dato[k] !== undefined && !isStr(x.dato[k])) e.push('dato.' + k + ' debe ser un texto'); });
    if (x.n !== undefined && !(typeof x.n === 'number' || (isStr(x.n) && x.n.trim()))) e.push('n debe ser un número o un texto');
    var tipo = T.TIPOS.indexOf(x.tipo) >= 0 ? x.tipo : 'texto', txt = trim(x.texto);
    if (tipo === 'dato') { if (!dato(x.dato)) e.push('tipo dato necesita dato {valor, unidad?, etiqueta?}'); }
    else if (!txt) e.push('tipo ' + tipo + ' necesita texto');
    if (tipo === 'definicion' && !trim(x.titulo)) e.push('tipo definicion necesita titulo (el término)');
    if (tipo === 'lista' && txt && T.listaLineas(txt).items.length < 2) e.push('tipo lista necesita al menos 2 líneas separadas por \\n');
    if (tipo === 'ejemplo' && x.ejemplo) e.push('tipo ejemplo ya es el ejemplo: usá texto');
    if (tipo === 'ojo' && x.ojo) e.push('tipo ojo ya es el aviso: usá texto');
    if (tipo === 'dato' && x.dato === undefined) e.push('tipo dato sin dato');
    return e;
  };
  /** Título del paso: el del punto clave, si no el del componente, si no «Punto clave N». */
  T.tituloPaso = function (item, comp, n) {
    var t = item && item.titulo ? T.plano(item.titulo).trim() : '';
    if (!t && comp && isStr(comp.titulo) && comp.titulo.trim()) t = comp.titulo.trim();
    return t || 'Punto clave ' + n;
  };
  /** Rótulo del kicker: PASO 02 / 08 · <esto>. El tipo del punto clave si no es texto; si no el del componente; si no PUNTO CLAVE. */
  T.etiquetaTipo = function (item, compNombre) {
    if (item && item.tipo && item.tipo !== 'texto') return T.ROTULO[item.tipo];
    return compNombre || T.ROTULO.texto;
  };
  /** Cómo se acomoda un paso: sin nada · sólo la figura · dos columnas (texto + figura) · figura centrada en una tarjeta (clasificar, emparejar, situación…). */
  T.layoutPaso = function (item, comps) {
    comps = comps || [];
    if (!comps.length) return 'texto';
    if (!item) return 'solo';
    for (var i = 0; i < comps.length; i++) if (DOS[comps[i].tipo || (comps[i].c && comps[i].c.tipo)]) return 'dos';
    return 'centro';
  };

  /* ------------------------------------------------------------------ resumen, promesa y tiempo */
  T.resumenPaso = function (lec, item, i) {
    if (item && item.resumen) return item.resumen;
    var r = lec && lec.resumen;
    return Array.isArray(r) && isStr(r[i]) ? r[i].trim() : '';
  };
  T.resumenLeccion = function (lec) { return lec && isStr(lec.resumen) ? lec.resumen.trim() : ''; };
  function minuscula(s) { return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  /** La frase de la portada: el `resumen` de la lección o, si no hay, "En unos N minutos vas a poder <primer objetivo>". */
  T.promesa = function (lec, minutos) {
    var r = T.resumenLeccion(lec);
    if (r) return r;
    var o = Array.isArray(lec && lec.objetivos) ? trim(lec.objetivos[0]) : '';
    if (o) return (minutos ? 'En unos ' + minutos + ' minutos' : 'En esta lección') + ' vas a poder ' + minuscula(o).replace(/[.\s]+$/, '') + '.';
    return trim(lec && lec.titulo);
  };
  /** Minutos que faltan al estar en la etapa idx de n (la portada es 0, el resumen n-1). */
  T.minutosFalta = function (minutos, idx, n) {
    minutos = +minutos || 0; n = Math.max(1, n | 0);
    if (n <= 1) return minutos;
    return Math.max(0, Math.round(minutos * (n - 1 - Math.max(0, Math.min(n - 1, idx))) / (n - 1)));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(root.C150);
