var root = (typeof window !== 'undefined') ? window : globalThis; root.C150 = root.C150 || {};
/*
 * kit.js — C150.Kit: constructores de DOM para los componentes del sistema de diseño v2 (contrato UI/UX v4 §3).
 * Todo con createElement / textContent: NUNCA innerHTML con datos. Los estilos viven en styles.css (bloque "v4").
 *
 *   Kit.el(tag, props, ...hijos)            → helper h(): props {class, text, style:{--x:1}, onclick, 'aria-x', hidden, disabled}
 *   Kit.icon(name, size?)                   → <svg class="icon"><use href="#i-name"/></svg> (sprite de icons.js)
 *   Kit.button({label, icon, iconRight, variant:'primary|secondary|ghost', size:'small|large', block, loading,
 *               disabled, onClick, ariaLabel, title, type, href})            → <button class="btn …"> · .setLoading(bool)
 *   Kit.iconButton({icon, label, onClick, small, title})                    → <button class="icon-btn">
 *   Kit.chip({label, icon, selected, onClick, color})                       → <button class="chip"> (aria-pressed si selected≠undefined) · .setSelected(bool)
 *   Kit.badge(text, variant?, iconName?)    variant: ok|warn|bad|info|accent|solid
 *   Kit.segmented({items:[{value,label,icon}], value, onChange, label, auto})→ <div class="seg"> · .setValue(v) · .value
 *   Kit.tabs({items:[{id,label,icon,badge}], value, onChange, variant:'line|pill', label, idPrefix, panelPrefix})
 *                                                                           → tablist con flechas/Home/End · .select(id, silent) · .value
 *   Kit.card({variant:'flat|raised|interactive', title, sub, icon, onClick, children, tag})
 *   Kit.sectionHeader(num, title, meta?, level?)   → "01 ── TÍTULO ───────" con línea fina
 *   Kit.callout({variant:'tip|dato|cuidado|error|ok', title, text, children})
 *   Kit.progressBar(frac, {size:'lg', ok, label})  → .set(frac)
 *   Kit.progressRing(frac, {size, label, text, ok}) → .set(frac, text?)
 *   Kit.progressSteps({steps:[{label, state:'done|current|todo'}]})
 *   Kit.stat({label, value, unit, small})          → .set(value, unit?)
 *   Kit.keyValue([[clave, valor], …])
 *   Kit.accordion({title, content, open, icon, onToggle})   → <details class="acc"> animado · .setOpen(bool)
 *   Kit.tooltip(el, text)                          → desengancha con la función devuelta (hover o foco de teclado)
 *   Kit.popover(anchor, {title, content, onClose, label}) → {el, close()}  (uno a la vez, se cierra con Esc / clic afuera)
 *   Kit.dialog({title, kicker, body, actions:[{label, variant, onClick, close:true}], onClose, label}) → {el, close()}
 *                                                  focus atrapado, Esc, clic afuera; en teléfonos es una hoja inferior
 *   Kit.emptyState({icon, title, text, action:{label,onClick}})
 *   Kit.skeleton(kind?, n?)  kind: 'text'|'title'|'block'
 *   Kit.kbd(text)
 *   Kit.toast(text, kind)                          → puente a C150.UI.toast (kind: info|warn|good)
 *   Kit.reducedMotion()
 *
 * v5 · lenguaje de AIRE (contrato v5): los mismos componentes en TODAS las pestañas (mismo DOM que lab.js; las clases .lab-* y las compartidas valen igual):
 *   Kit.enName("Throttle (THROTTLE) with friction lock", corto?)   → "Throttle with friction lock" (el inglés de un mando en una línea, sin paréntesis; corto = sin el sinónimo)
 *   Kit.pageHeader({kicker, title, sub, children})                  → <header class="pg-head">: kicker mono "NN · SECCIÓN · SUB", título enorme, párrafo
 *   Kit.hud({label, kicker, bigs:[{label, unit, title, onClick}]})  → .hud de vidrio · .set({kicker, live, bigs:[{v,u,l,warn}], row:[{text,onClick}]|texto,
 *                                                                      pill:{text, tone:"is-ok|is-air|is-warn|is-demo|is-pause|is-stall"},
 *                                                                      extra:{k, t, v, bar:0..1, nums:[{v,u,l}]}|null})
 *   Kit.dockGroup({label, aria, kind:"seg"|"chips", items:[{value,label,title,aria,data}], value, onChange|onToggle}) → .dock-group · .setValue(v) · .btn(v) · .setPressed(v,on)
 *   Kit.dock([grupos], {label})                                     → .dock: fila de cristal con grupos; en vistas angostas se desliza de costado
 *   Kit.tchip({label, pressed, onClick, title})                     → ficha con punto que se prende (.seg-btn.tchip)
 *   Kit.chain(items, {tone:"info|warn|good", compact})              → .chain: [causa naranja] → [paso] → [efecto con borde]; items: texto o {text, onClick, keep} (keep: se queda en la versión compacta)
 *   Kit.chainBar()                                                  → .chain-bar: barra de vidrio sobre el 3D (vacía = oculta) · .set(items, {tone, key, dismiss, dismissLabel}) · .clear()
 *   Kit.modes({items:[{value,label,sub}], value, onChange, label})  → .modes de 2 o 3 opciones (.mode-btn con .mode-t y .mode-s) · .setValue(v)
 *                                                                      (el botón es .mode-btn y no .mode porque .mode ya es el <section> de cada panel)
 *   Kit.section({num, title, meta, open, body, id, onToggle})       → <section class="sec sec--num"> plegable "01 TÍTULO … meta ⌄" · .setOpen(b) · .setMeta(t) · .body
 *   Kit.cardCarousel({items:[{code,title,sum,meta,current,tag,onClick}], label, list})
 *                                                                   → <ul class="cards-h"> de .card-h con código (E1, L2…), título, 2 líneas y meta mono; list:true = en columna
 *   Kit.slider({label,min,max,step,value,format,big,center,zones:[{from,to,color}],ticks:[{v,t,cls}],ends,detents,quick:[{v,t}],sub,onInput}) → .ctl · .set(v) · .setSub(t)
 *   Kit.bars({rows:[{key,label,color,caption}]})                    → .bars de .bar-row con valor mono · .set(key, 0..1, texto)
 */
(function (C150) {
  'use strict';
  if (typeof document === 'undefined') { C150.Kit = C150.Kit || {}; return; }

  var Kit = C150.Kit = C150.Kit || {};
  var doc = document;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var uid = 0;

  function isFn(f) { return typeof f === 'function'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function nid(p) { uid++; return 'k-' + (p || 'x') + '-' + uid; }
  function reducedMotion() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  /* ------------------------------------------------------------------ DOM helper */
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) add(el, c[i]); return; }
    el.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
  }
  function h(tag, props) {
    var el = doc.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = String(v);
        else if (k === 'style') { for (var s in v) el.style.setProperty(s, v[s]); }
        else if (k.slice(0, 2) === 'on' && isFn(v)) el.addEventListener(k.slice(2), v);
        else if (k === 'hidden' || k === 'disabled') el[k] = true;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function cls() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function svgEl(tag, attrs) {
    var e = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* ------------------------------------------------------------------ iconos */
  function icon(name, size) {
    var s = svgEl('svg', { 'class': 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    if (size) { s.setAttribute('width', size); s.setAttribute('height', size); s.style.width = size + 'px'; s.style.height = size + 'px'; }
    var u = svgEl('use', { href: '#i-' + name });
    s.appendChild(u);
    return s;
  }

  /* ------------------------------------------------------------------ botones y chips */
  function button(o) {
    o = o || {};
    var variant = o.variant && o.variant !== 'default' ? 'btn--' + o.variant : '';
    var el = h(o.href ? 'a' : 'button', {
      type: o.href ? null : (o.type || 'button'), href: o.href || null,
      'class': cls('btn', variant, o.size ? 'btn--' + o.size : '', o.block ? 'btn--block' : '', o.loading ? 'is-loading' : ''),
      'aria-label': o.ariaLabel, title: o.title, disabled: o.disabled, onclick: o.onClick, id: o.id
    });
    if (o.icon) el.appendChild(icon(o.icon));
    if (o.label !== undefined && o.label !== null) el.appendChild(h('span', { text: o.label }));
    if (o.iconRight) el.appendChild(icon(o.iconRight));
    if (o.loading) el.setAttribute('aria-busy', 'true');
    el.setLoading = function (on) {
      el.classList.toggle('is-loading', !!on);
      if (on) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
    };
    return el;
  }
  function iconButton(o) {
    o = o || {};
    var el = h('button', {
      type: 'button', 'class': cls('icon-btn', o.small ? 'icon-btn--small' : ''), 'aria-label': o.label, title: o.title || o.label, onclick: o.onClick
    }, icon(o.icon));
    return el;
  }
  function chip(o) {
    o = o || {};
    var el = h('button', { type: 'button', 'class': 'chip', onclick: o.onClick, title: o.title });
    if (o.selected !== undefined) el.setAttribute('aria-pressed', o.selected ? 'true' : 'false');
    if (o.color) el.appendChild(h('span', { 'class': 'dot', 'aria-hidden': 'true', style: { '--cat': o.color } }));
    if (o.icon) el.appendChild(icon(o.icon));
    el.appendChild(h('span', { text: o.label }));
    el.setSelected = function (on) { el.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    return el;
  }
  function badge(text, variant, iconName) {
    return h('span', { 'class': cls('badge', variant ? 'badge--' + variant : '') }, iconName ? icon(iconName) : null, text);
  }

  /* ------------------------------------------------------------------ segmentado y pestañas */
  function segmented(o) {
    o = o || {};
    var items = o.items || [];
    var wrap = h('div', { 'class': cls('seg', o.auto ? 'seg--auto' : ''), role: 'group', 'aria-label': o.label });
    var btns = {};
    items.forEach(function (it) {
      var b = h('button', {
        type: 'button', 'aria-pressed': 'false',
        onclick: function () { api.setValue(it.value, true); }
      }, it.icon ? icon(it.icon) : null, it.label);
      btns[it.value] = b;
      wrap.appendChild(b);
    });
    var api = wrap;
    wrap.value = o.value;
    wrap.setValue = function (v, fire) {
      var changed = v !== wrap.value;
      wrap.value = v;
      for (var k in btns) btns[k].setAttribute('aria-pressed', String(k) === String(v) ? 'true' : 'false');
      if (fire && changed && isFn(o.onChange)) o.onChange(v);
    };
    wrap.setValue(o.value, false);
    return wrap;
  }

  function tabs(o) {
    o = o || {};
    var items = o.items || [];
    var pill = o.variant === 'pill';
    var pfx = o.idPrefix || nid('tab');
    var wrap = h('div', { 'class': pill ? 'subtabs' : 'ktabs', role: 'tablist', 'aria-label': o.label });
    var btns = [];
    items.forEach(function (it, i) {
      var b = h('button', {
        type: 'button', 'class': pill ? 'subtab' : 'ktab', role: 'tab', id: pfx + '-' + it.id, 'data-tab': it.id,
        'aria-selected': 'false', tabindex: '-1',
        'aria-controls': o.panelPrefix ? o.panelPrefix + it.id : null,
        onclick: function () { wrap.select(it.id); },
        onkeydown: function (e) {
          var j = -1;
          if (e.key === 'ArrowRight') j = (i + 1) % items.length;
          else if (e.key === 'ArrowLeft') j = (i - 1 + items.length) % items.length;
          else if (e.key === 'Home') j = 0;
          else if (e.key === 'End') j = items.length - 1;
          if (j < 0) return;
          e.preventDefault();
          wrap.select(items[j].id);
          btns[j].focus();
        }
      }, it.icon ? icon(it.icon) : null, h('span', { text: it.label }), it.badge ? badge(it.badge, 'accent') : null);
      btns.push(b);
      wrap.appendChild(b);
    });
    wrap.value = null;
    wrap.select = function (id, silent) {
      var changed = id !== wrap.value;
      wrap.value = id;
      btns.forEach(function (b) {
        var on = b.getAttribute('data-tab') === String(id);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      if (!silent && changed && isFn(o.onChange)) o.onChange(id);
    };
    wrap.select(o.value !== undefined ? o.value : (items[0] && items[0].id), true);
    return wrap;
  }

  /* ------------------------------------------------------------------ tarjetas, encabezados, avisos */
  function card(o) {
    o = o || {};
    var interactive = o.variant === 'interactive' || isFn(o.onClick);
    var el = h(o.tag || (interactive ? 'button' : 'div'), {
      type: (interactive && !o.tag) ? 'button' : null,
      'class': cls('card', o.variant && o.variant !== 'interactive' ? 'card--' + o.variant : '', interactive ? 'card--interactive' : ''),
      onclick: o.onClick
    });
    var head = null;
    if (o.icon || o.title || o.sub) {
      var txt = h('div', { style: { 'min-width': '0' } },
        o.title ? h('h3', { 'class': 'card-title', text: o.title }) : null,
        o.sub ? h('p', { 'class': 'card-sub', text: o.sub }) : null);
      head = o.icon ? h('div', { 'class': 'card-row' }, h('span', { 'class': 'card-ico' }, icon(o.icon)), txt) : txt;
      el.appendChild(head);
    }
    add(el, o.children);
    return el;
  }

  function sectionHeader(num, title, meta, level) {
    var n = (typeof num === 'number') ? (num < 10 ? '0' + num : String(num)) : num;
    return h('div', { 'class': 'sect-head' },
      n ? h('span', { 'class': 'sect-num', 'aria-hidden': 'true', text: n }) : null,
      h('h' + (level || 2), { 'class': 'sect-title', text: title }),
      meta ? h('span', { 'class': 'sect-meta', text: meta }) : null);
  }

  var CALLOUT_ICON = { tip: 'bulb', dato: 'info', cuidado: 'warning', error: 'warning', ok: 'check' };
  var CALLOUT_TITLE = { tip: 'Truco', dato: 'Dato', cuidado: 'Cuidado', error: 'Ojo', ok: 'Bien' };
  function callout(o) {
    o = o || {};
    var v = CALLOUT_ICON[o.variant] ? o.variant : 'tip';
    var title = o.title === undefined ? CALLOUT_TITLE[v] : o.title;
    var role = (v === 'error' || v === 'cuidado') ? 'note' : null;
    var body = h('div', { 'class': 'callout-body' },
      title ? h('p', { 'class': 'callout-title', text: title }) : null,
      o.text ? h('p', { text: o.text }) : null);
    add(body, o.children);
    return h('aside', { 'class': 'callout callout--icon callout--' + v, role: role }, icon(CALLOUT_ICON[v]), body);
  }

  /* ------------------------------------------------------------------ progreso */
  function progressBar(frac, o) {
    o = o || {};
    var fill = h('span');
    var el = h('div', {
      'class': cls('progress', o.size === 'lg' ? 'progress--lg' : '', o.ok ? 'progress--ok' : ''),
      role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': o.label
    }, fill);
    el.set = function (f) {
      f = clamp(+f || 0, 0, 1);
      fill.style.width = (f * 100).toFixed(1) + '%';
      el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    };
    el.set(frac);
    return el;
  }
  function progressRing(frac, o) {
    o = o || {};
    var size = o.size || 84;
    var R = 44, C = 2 * Math.PI * R;
    var sw = o.stroke || 9;
    var svg = svgEl('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgEl('circle', { 'class': 'r-track', cx: '50', cy: '50', r: String(R), 'stroke-width': String(sw) }));
    var fill = svgEl('circle', { 'class': 'r-fill', cx: '50', cy: '50', r: String(R), 'stroke-width': String(sw), 'stroke-dasharray': C.toFixed(2) });
    svg.appendChild(fill);
    var val = h('span', { 'class': 'pring-v' });
    var lab = o.label ? h('span', { 'class': 'pring-l', text: o.label }) : null;
    var el = h('span', { 'class': cls('pring', o.ok ? 'pring--ok' : ''), style: { '--ring': size + 'px' }, role: 'img' },
      svg, h('span', { 'class': 'pring-c' }, val, lab));
    el.set = function (f, text) {
      f = clamp(+f || 0, 0, 1);
      fill.setAttribute('stroke-dashoffset', (C * (1 - f)).toFixed(2));
      val.textContent = text !== undefined ? text : Math.round(f * 100) + '%';
      el.setAttribute('aria-label', (o.ariaLabel || 'Avance') + ': ' + Math.round(f * 100) + ' %');
    };
    el.set(frac, o.text);
    return el;
  }
  function progressSteps(o) {
    o = o || {};
    var ul = h('ol', { 'class': 'psteps', 'aria-label': o.label });
    (o.steps || []).forEach(function (s, i) {
      var st = s.state === 'done' ? 'is-done' : (s.state === 'current' ? 'is-current' : '');
      var dot = h('span', { 'class': 'pstep' }, s.state === 'done' ? icon('check') : String(i + 1));
      ul.appendChild(h('li', { 'class': st, 'aria-current': s.state === 'current' ? 'step' : null, title: s.label },
        dot, h('span', { 'class': 'sr-only', text: s.label + (s.state === 'done' ? ' (hecho)' : '') })));
    });
    return ul;
  }

  /* ------------------------------------------------------------------ datos */
  function stat(o) {
    o = o || {};
    var v = h('span', { 'class': 'stat-value', text: o.value === undefined ? '' : o.value });
    var u = h('span', { 'class': 'stat-unit', text: o.unit || '' });
    var el = h('div', { 'class': cls('stat', o.small ? 'stat--sm' : '') },
      h('span', { 'class': 'stat-label', text: o.label }), h('span', { 'class': 'stat-line' }, v, u));
    el.set = function (val, unit) {
      var s = String(val);
      if (v.textContent !== s) v.textContent = s;
      if (unit !== undefined && u.textContent !== unit) u.textContent = unit;
    };
    return el;
  }
  function keyValue(rows) {
    var dl = h('dl', { 'class': 'kv' });
    (rows || []).forEach(function (r) {
      dl.appendChild(h('div', { 'class': 'kv-row' }, h('dt', { 'class': 'kv-k', text: r[0] }), h('dd', { 'class': 'kv-v', text: r[1] })));
    });
    return dl;
  }

  /* ------------------------------------------------------------------ acordeón */
  function accordion(o) {
    o = o || {};
    var body = h('div', { 'class': 'acc-body' });
    add(body, o.content);
    var sum = h('summary', { 'class': 'acc-sum' }, o.icon ? icon(o.icon) : null, h('span', { text: o.title }), icon('chevron-down'));
    sum.lastChild.setAttribute('class', 'acc-chev');
    var det = h('details', { 'class': 'acc' }, sum, body);
    if (o.open) det.open = true;
    var anim = null, isOpen = !!o.open;
    function run(open) {
      isOpen = !!open;
      if (anim) { anim.cancel(); anim = null; }
      var noAnim = reducedMotion() || !body.animate;
      function settle(a, closing) {
        a.onfinish = function () { if (anim === a) { anim = null; if (closing) det.open = false; } };
        setTimeout(function () { if (anim === a) { try { a.cancel(); } catch (e) { /* ya terminó */ } anim = null; if (closing) det.open = false; } }, 300);   // por si las animaciones no avanzan (pestaña en segundo plano)
      }
      if (open) {
        det.open = true;
        if (!noAnim) {
          var hh = body.scrollHeight;
          anim = body.animate([{ height: '0px', opacity: 0 }, { height: hh + 'px', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
          settle(anim, false);
        }
      } else if (noAnim) {
        det.open = false;
      } else {
        var h0 = body.offsetHeight;
        anim = body.animate([{ height: h0 + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: 'ease-out' });
        settle(anim, true);
      }
      if (isFn(o.onToggle)) o.onToggle(open);
    }
    sum.addEventListener('click', function (e) { e.preventDefault(); run(!isOpen); });
    det.setOpen = function (open) { run(open === undefined ? !isOpen : !!open); };
    return det;
  }

  /* ------------------------------------------------------------------ tooltip */
  var tipEl = null, tipTimer = 0, tipFor = null;
  function ensureTip() {
    if (!tipEl) { tipEl = h('div', { 'class': 'tip', role: 'tooltip', id: 'k-tooltip' }); doc.body.appendChild(tipEl); }
    return tipEl;
  }
  function place(el, anchor, prefer) {
    var r = anchor.getBoundingClientRect();
    var vw = root.innerWidth, vh = root.innerHeight;
    el.style.left = '0px'; el.style.top = '0px';
    var w = el.offsetWidth, hh = el.offsetHeight, gap = 8;
    var below = r.bottom + gap + hh <= vh - 8;
    var above = r.top - gap - hh >= 8;
    var useBelow = prefer === 'above' ? !above : (below || !above);
    var top = useBelow ? r.bottom + gap : r.top - gap - hh;
    var left = r.left + r.width / 2 - w / 2;
    el.style.left = Math.round(clamp(left, 8, Math.max(8, vw - w - 8))) + 'px';
    el.style.top = Math.round(clamp(top, 8, Math.max(8, vh - hh - 8))) + 'px';
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (tipEl) tipEl.classList.remove('is-on');
    if (tipFor) { tipFor.removeAttribute('aria-describedby'); tipFor = null; }
  }
  function showTip(el, text) {
    var t = ensureTip();
    t.textContent = text;
    t.classList.remove('is-on');
    place(t, el, 'below');
    tipFor = el;
    el.setAttribute('aria-describedby', 'k-tooltip');
    void t.offsetWidth;                  // fuerza el primer estilo: la transición arranca sin depender de requestAnimationFrame
    t.classList.add('is-on');
  }
  function tooltip(el, text) {
    function enter(e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () { showTip(el, isFn(text) ? text() : text); }, 380);
    }
    function focus() { if (el.matches && el.matches(':focus-visible')) showTip(el, isFn(text) ? text() : text); }
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('pointerdown', hideTip);
    el.addEventListener('focus', focus);
    el.addEventListener('blur', hideTip);
    return function () {
      el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', hideTip);
      el.removeEventListener('pointerdown', hideTip); el.removeEventListener('focus', focus); el.removeEventListener('blur', hideTip);
    };
  }
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });

  /* ------------------------------------------------------------------ popover */
  var popCur = null;
  function closePopover(returnFocus) {
    var p = popCur;
    if (!p) return;
    popCur = null;
    doc.removeEventListener('pointerdown', p.onOut, true);
    doc.removeEventListener('keydown', p.onKey, true);
    root.removeEventListener('resize', p.onResize);
    p.el.classList.remove('is-on');
    var el = p.el;
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, reducedMotion() ? 0 : 160);
    if (p.anchor.removeAttribute) p.anchor.removeAttribute('aria-expanded');
    if (returnFocus !== false && p.prev && p.prev.focus) { try { p.prev.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }
    if (isFn(p.onClose)) p.onClose();
  }
  function popover(anchor, o) {
    o = o || {};
    closePopover(false);
    hideTip();
    var el = h('div', { 'class': 'pop', role: 'dialog', 'aria-label': o.label || o.title || 'Información', tabindex: '-1' },
      o.title ? h('p', { 'class': 'pop-title', text: o.title }) : null);
    if (typeof o.content === 'string') el.appendChild(h('p', { text: o.content })); else add(el, o.content);
    doc.body.appendChild(el);
    place(el, anchor, 'below');
    var p = {
      el: el, anchor: anchor, prev: doc.activeElement, onClose: o.onClose,
      onOut: function (e) { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(false); },
      onKey: function (e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePopover(true); } },
      onResize: function () { place(el, anchor, 'below'); }
    };
    popCur = p;
    doc.addEventListener('pointerdown', p.onOut, true);
    doc.addEventListener('keydown', p.onKey, true);
    root.addEventListener('resize', p.onResize);
    if (anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
    void el.offsetWidth;
    el.classList.add('is-on');
    try { el.focus({ preventScroll: true }); } catch (e) { /* sin foco */ }
    return { el: el, close: function () { if (popCur === p) closePopover(true); } };
  }

  /* ------------------------------------------------------------------ diálogo / hoja inferior */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function dialog(o) {
    o = o || {};
    var titleId = nid('dlg');
    var prev = doc.activeElement;
    var closed = false;
    var card = h('div', { 'class': 'dlg-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': o.title ? titleId : null, 'aria-label': o.title ? null : (o.label || 'Diálogo'), tabindex: '-1' },
      h('span', { 'class': 'dlg-grip', 'aria-hidden': 'true' }),
      h('div', { 'class': 'dlg-head' },
        h('div', null,
          o.kicker ? h('p', { 'class': 'mode-kicker' }, h('span', { 'class': 'mode-kicker-dot', 'aria-hidden': 'true' }), o.kicker) : null,
          o.title ? h('h2', { 'class': 'dlg-title', id: titleId, text: o.title }) : null),
        iconButton({ icon: 'close', label: 'Cerrar', onClick: function () { api.close(); } })));
    var body = h('div', { 'class': 'dlg-body' });
    if (typeof o.body === 'string') body.appendChild(h('p', { text: o.body })); else add(body, o.body);
    card.appendChild(body);
    if (o.actions && o.actions.length) {
      var bar = h('div', { 'class': 'dlg-actions' });
      o.actions.forEach(function (a) {
        bar.appendChild(button({
          label: a.label, icon: a.icon, variant: a.variant,
          onClick: function (e) { if (isFn(a.onClick)) a.onClick(e); if (a.close !== false) api.close(); }
        }));
      });
      card.appendChild(bar);
    }
    var backdrop = h('div', { 'class': 'dlg-backdrop', onclick: function () { api.close(); } });
    var el = h('div', { 'class': 'dlg' }, backdrop, card);
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); api.close(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(card.querySelectorAll(FOCUSABLE), function (n) { return n.offsetParent !== null; });
      if (!f.length) { e.preventDefault(); card.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    var api = {
      el: el, body: body,
      close: function () {
        if (closed) return;
        closed = true;
        doc.removeEventListener('keydown', onKey, true);
        el.classList.remove('is-on');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, reducedMotion() ? 0 : 260);
        if (prev && prev.focus) { try { prev.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }
        if (isFn(o.onClose)) o.onClose();
      }
    };
    doc.body.appendChild(el);
    doc.addEventListener('keydown', onKey, true);
    void el.offsetWidth;
    el.classList.add('is-on');
    var firstFocus = card.querySelector('[data-autofocus]') || card.querySelector('.dlg-actions .btn--primary') || card;
    try { firstFocus.focus({ preventScroll: true }); } catch (e) { /* sin foco */ }
    return api;
  }

  /* ------------------------------------------------------------------ vacío, esqueleto, teclas, toast */
  function emptyState(o) {
    o = o || {};
    return h('div', { 'class': 'empty-state' },
      o.icon ? h('span', { 'class': 'es-ico' }, icon(o.icon)) : null,
      o.title ? h('h3', { text: o.title }) : null,
      o.text ? h('p', { text: o.text }) : null,
      o.action ? button({ label: o.action.label, icon: o.action.icon, variant: o.action.variant || 'primary', onClick: o.action.onClick }) : null);
  }
  function skeleton(kind, n) {
    var wrap = h('div', { 'aria-hidden': 'true' });
    for (var i = 0; i < (n || 1); i++) wrap.appendChild(h('span', { 'class': 'skel' + (kind === 'title' ? ' skel--title' : (kind === 'block' ? ' skel--block' : '')), style: kind === 'text' || !kind ? { width: (i === (n || 1) - 1 && n > 1 ? '62%' : '100%') } : null }));
    return wrap;
  }
  function kbd(text) { return h('kbd', { text: text }); }
  function toast(text, kind) {
    var UI = C150.UI;
    if (UI && isFn(UI.toast)) { UI.toast({ text: text, kind: kind || 'info' }); return; }
    var live = doc.getElementById('toasts');
    if (live) { var d = h('div', { 'class': 'toast toast--' + (kind || 'info') }, h('span', { text: text })); live.appendChild(d); setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 4000); }
  }

  /* ------------------------------------------------------------------ v5 · lenguaje de AIRE (contrato v5 §2)
   * HUD de vidrio, dock inferior, cadena causa → efecto, interruptor de modos, secciones numeradas, tarjetas con código,
   * deslizadores con marcas y barras vivas. Mismo DOM que arma lab.js (clases .lab-*): los estilos valen para los dos nombres. */
  var tick_ = function (node, text) { if (node && node.textContent !== text) node.textContent = text; };
  function fmtCode(n) { return typeof n === 'number' ? (n < 10 ? '0' + n : String(n)) : n; }

  /** Nombre en inglés de un mando, legible en una línea mono: "Throttle (THROTTLE) with friction lock" → "Throttle with friction lock";
   *  "Control wheel (yoke)" → "Control wheel · yoke"; "Airspeed indicator (ASI)" → "Airspeed indicator · ASI". Sin paréntesis ni corchetes:
   *  lo que va entre paréntesis (el cartel del tablero o un sinónimo) pasa al final después de un punto medio, y se omite si repite el nombre. */
  function enName(s, short) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    var m = /^(.*?)\s*\(([^)]*)\)\s*(.*)$/.exec(s);
    if (!m) return s;
    var main = (m[1] + ' ' + m[3]).replace(/\s+/g, ' ').trim(), aka = m[2].trim();
    if (!main) return aka;
    if (short || !aka || main.toLowerCase().indexOf(aka.toLowerCase()) >= 0) return main;
    return main + ' · ' + aka;
  }

  /** Cabecera de página: kicker mono con punto, título enorme y un párrafo. */
  function pageHeader(o) {
    o = o || {};
    var el = h('header', { 'class': 'pg-head' },
      o.kicker ? h('p', { 'class': 'pg-kicker' }, h('span', { 'class': 'pg-kicker-dot', 'aria-hidden': 'true' }), h('span', { text: o.kicker })) : null,
      o.title ? h('h2', { 'class': 'pg-title', text: o.title }) : null,
      o.sub ? h('p', { 'class': 'pg-sub', text: o.sub }) : null);
    add(el, o.children);
    return el;
  }

  /** HUD de vidrio sobre el 3D. o = {label, kicker, bigs:[{label, unit, title, onClick}]}.
   *  el.set({kicker, live:bool, bigs:[{v, u, l, warn}], row:[{text, onClick, title}] | string, pill:{text, tone}, extra:{k, t, v, bar:0..1, nums:[{v,u,l}]} | null}) */
  function hud(o) {
    o = o || {};
    var kick = h('span', { 'class': 'hud-mode', text: o.kicker || '' });
    var dot = h('span', { 'class': 'live-dot', 'aria-hidden': 'true' });
    var bigWrap = h('div', { 'class': 'hud-big' });
    var cells = [];
    (o.bigs || []).forEach(function (b) {
      var v = h('span', { 'class': 'big-v' }), u = h('span', { 'class': 'big-u', text: b.unit || '' }), l = h('span', { 'class': 'big-l', text: b.label || '' });
      var kids = [h('span', { 'class': 'big-num' }, v, u), l];
      var el = isFn(b.onClick)
        ? h('button', { type: 'button', 'class': 'big big--btn', title: b.title, 'aria-haspopup': 'dialog', onclick: b.onClick }, kids)
        : h('div', { 'class': 'big', title: b.title }, kids);
      bigWrap.appendChild(el);
      cells.push({ el: el, v: v, u: u, l: l });
    });
    var row = h('p', { 'class': 'hud-row' });
    var pill = h('p', { 'class': 'hud-pill' });
    var exK = h('span', { 'class': 'hud-ex-k' }), exT = h('span', { 'class': 'hud-ex-t' }), exV = h('span', { 'class': 'hud-ex-v' });
    var exBar = h('span', { 'class': 'hud-ex-bar', hidden: true }, h('span')), exNums = h('div', { 'class': 'hud-ex-nums', hidden: true });
    var extra = h('div', { 'class': 'hud-extra', hidden: true }, exK, exT, exV, exBar, exNums);
    var el = h('div', { 'class': 'hud', role: 'group', 'aria-label': o.label }, h('p', { 'class': 'hud-kicker' }, dot, kick), bigWrap, row, pill, extra);
    var rowSig = '', exSig = '';
    el.set = function (d) {
      d = d || {};
      if (d.kicker !== undefined) tick_(kick, d.kicker);
      if (d.live !== undefined) dot.classList.toggle('is-off', !d.live);
      (d.bigs || []).forEach(function (b, i) {
        var c = cells[i];
        if (!c) return;
        tick_(c.v, b.v === undefined ? '' : String(b.v));
        if (b.u !== undefined) tick_(c.u, b.u);
        if (b.l !== undefined) tick_(c.l, b.l);
        c.el.classList.toggle('is-warn', !!b.warn);
        c.el.classList.toggle('is-dim', !!b.dim);
      });
      if (d.row !== undefined) {
        var segs = typeof d.row === 'string' ? [{ text: d.row }] : (d.row || []);
        var sig = segs.map(function (s) { return s.text; }).join('·');
        if (sig !== rowSig) {
          rowSig = sig;
          while (row.firstChild) row.removeChild(row.firstChild);
          segs.forEach(function (s, i) {
            if (i) row.appendChild(doc.createTextNode(' · '));
            row.appendChild(isFn(s.onClick) ? h('button', { type: 'button', 'class': 'hud-link', title: s.title, onclick: s.onClick, text: s.text }) : h('span', { text: s.text }));
          });
        }
        row.hidden = !segs.length;
      }
      if (d.pill !== undefined) {
        var cn = 'hud-pill' + (d.pill && d.pill.tone ? ' ' + d.pill.tone : '');
        if (pill.className !== cn) pill.className = cn;
        tick_(pill, d.pill ? d.pill.text : '');
        pill.hidden = !d.pill;
      }
      if (d.extra !== undefined) {
        var x = d.extra;
        var xs = x ? [x.k, x.t, x.v, x.bar, (x.nums || []).map(function (n) { return n.v + n.u + n.l; }).join('|')].join('~') : '';
        if (xs !== exSig) {
          exSig = xs;
          extra.hidden = !x;
          if (x) {
            tick_(exK, x.k || ''); tick_(exT, x.t || ''); tick_(exV, x.v || '');
            exT.hidden = !x.t; exV.hidden = !x.v; exK.hidden = !x.k;
            exBar.hidden = x.bar === undefined || x.bar === null;
            if (!exBar.hidden) exBar.firstChild.style.width = (clamp(+x.bar || 0, 0, 1) * 100).toFixed(1) + '%';
            var nn = x.nums || [];
            exNums.hidden = !nn.length;
            while (exNums.firstChild) exNums.removeChild(exNums.firstChild);
            nn.forEach(function (n) {
              exNums.appendChild(h('div', { 'class': 'big big--sm' }, h('span', { 'class': 'big-num' }, h('span', { 'class': 'big-v', text: n.v }), h('span', { 'class': 'big-u', text: n.u || '' })), h('span', { 'class': 'big-l', text: n.l || '' })));
            });
          }
        }
      }
    };
    el.cells = cells; el.pill = pill;
    return el;
  }

  /** Grupo del dock: rótulo mono en versalitas + botones segmentados (kind 'seg') o fichas con punto que se prenden (kind 'chips').
   *  o = {label, aria, kind, items:[{value, label, title, aria, data:{x:1}}], value, onChange(value) | onToggle(value, on)} → .setValue(v) · .btn(v) · .setPressed(v, on) */
  function dockGroup(o) {
    o = o || {};
    var chips = o.kind === 'chips';
    var g = h('div', { 'class': 'dock-group', role: 'group', 'aria-label': o.aria || o.label }, o.label ? h('span', { 'class': 'dock-label', text: o.label }) : null);
    var btns = {};
    (o.items || []).forEach(function (it) {
      var b = h('button', {
        type: 'button', 'class': 'seg-btn' + (chips ? ' tchip' : ''), 'aria-pressed': 'false', title: it.title, 'aria-label': it.aria,
        onclick: function () {
          if (chips) { var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (isFn(o.onToggle)) o.onToggle(it.value, on); }
          else g.setValue(it.value, true);
        }
      }, chips ? h('span', { 'class': 'tchip-dot', 'aria-hidden': 'true' }) : null, it.label);
      if (it.data) for (var k in it.data) b.setAttribute('data-' + k, it.data[k]);
      btns[it.value] = b;
      g.appendChild(b);
    });
    g.value = o.value;
    g.setValue = function (v, fire) {
      g.value = v;
      for (var k in btns) btns[k].setAttribute('aria-pressed', String(k) === String(v) ? 'true' : 'false');
      if (fire && isFn(o.onChange)) o.onChange(v);
    };
    g.setPressed = function (v, on) { if (btns[v]) btns[v].setAttribute('aria-pressed', on ? 'true' : 'false'); };
    g.btn = function (v) { return btns[v] || null; };
    if (!chips && o.value !== undefined) g.setValue(o.value, false);
    return g;
  }

  /** El dock inferior: una fila de grupos de cristal. Cuando no entra, se desliza de costado y muestra una sombra en el borde que corta. */
  function dock(groups, o) {
    o = o || {};
    var el = h('div', { 'class': 'dock', role: 'toolbar', 'aria-label': o.label || 'Controles de la vista 3D' });
    add(el, groups);
    function more() {
      var max = el.scrollWidth - el.clientWidth;
      el.classList.toggle('has-more-r', max > 3 && el.scrollLeft < max - 3);
      el.classList.toggle('has-more-l', max > 3 && el.scrollLeft > 3);
    }
    el.addEventListener('scroll', more, { passive: true });
    if (root.ResizeObserver) new ResizeObserver(more).observe(el); else root.addEventListener('resize', more);
    el.refresh = more;
    return el;
  }
  function tchip(o) {
    o = o || {};
    return h('button', { type: 'button', 'class': 'seg-btn tchip', 'aria-pressed': o.pressed ? 'true' : 'false', title: o.title, onclick: o.onClick },
      h('span', { 'class': 'tchip-dot', 'aria-hidden': 'true' }), o.label);
  }

  /** Cadena causa → efecto. items: textos o {text, onClick} (un botón). tone: 'info' | 'warn' | 'good'. compact: sólo el primero y el último. */
  function chain(items, o) {
    o = o || {};
    var list = (items || []).filter(Boolean);
    var shown = o.compact && list.length > 2 ? list.filter(function (it, i) { return i === 0 || i === list.length - 1 || (typeof it === 'object' && it.keep); }) : list;
    var el = h('div', { 'class': 'chain' + (o.compact ? ' chain--compact' : '') + ' is-' + (o.tone || 'info'), role: 'group' });
    function txt(it) { return typeof it === 'string' ? it : it.text; }
    el.setAttribute('aria-label', list.map(txt).join(', entonces '));
    shown.forEach(function (it, i) {
      if (i > 0) el.appendChild(h('span', { 'class': 'chain-arrow', 'aria-hidden': 'true' }));
      var cl = 'chain-item ' + (i === 0 ? 'chain-cause' : (i === shown.length - 1 ? 'chain-effect' : 'chain-step'));
      if (typeof it === 'object' && isFn(it.onClick)) el.appendChild(h('button', { type: 'button', 'class': cl + ' chain-act', onclick: it.onClick, title: it.text, text: it.text }));
      else el.appendChild(h('span', { 'class': cl, title: txt(it), text: txt(it) }));
    });
    return el;
  }
  /** La barra de vidrio que lleva la cadena sobre el 3D (vacía = oculta). .set(items, {tone, key}) · .clear() */
  function chainBar() {
    var el = h('div', { 'class': 'chain-bar', hidden: true });
    var sig = '';
    el.set = function (items, o) {
      o = o || {};
      var list = (items || []).filter(Boolean);
      if (!list.length) { el.clear(); return; }
      var s = (o.tone || '') + (o.dismiss ? 'x' : '') + '|' + list.map(function (i) { return typeof i === 'string' ? i : i.text; }).join('→');
      if (s === sig && !el.hidden) return;
      var fresh = o.key === undefined || o.key !== el._key;
      sig = s; el._key = o.key;
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(chain(list, { tone: o.tone }));
      el.appendChild(chain(list, { tone: o.tone, compact: true }));
      if (isFn(o.dismiss)) el.appendChild(h('button', { type: 'button', 'class': 'chain-x', 'aria-label': o.dismissLabel || 'Cerrar', title: o.dismissLabel || 'Cerrar', onclick: o.dismiss }, icon('close')));
      el.hidden = false;
      if (fresh && !reducedMotion()) { el.classList.remove('is-new'); void el.offsetWidth; el.classList.add('is-new'); }
    };
    el.clear = function () { if (sig || !el.hidden) { sig = ''; el._key = undefined; while (el.firstChild) el.removeChild(el.firstChild); el.hidden = true; } };
    return el;
  }

  /** Interruptor de 2 o 3 modos con rótulo grande y sub-rótulo mono. o = {items:[{value,label,sub}], value, onChange, label} → .setValue(v) */
  function modes(o) {
    o = o || {};
    var items = o.items || [];
    var el = h('div', { 'class': 'modes' + (items.length > 2 ? ' modes--' + items.length : ''), role: 'group', 'aria-label': o.label, style: { 'grid-template-columns': 'repeat(' + items.length + ', minmax(0, 1fr))' } });
    var btns = {};
    items.forEach(function (it) {
      var b = h('button', { type: 'button', 'class': 'mode-btn', 'aria-pressed': 'false', 'data-value': it.value, onclick: function () { el.setValue(it.value, true); } },
        h('span', { 'class': 'mode-t', text: it.label }), it.sub ? h('span', { 'class': 'mode-s', text: it.sub }) : null);
      btns[it.value] = b; el.appendChild(b);
    });
    el.value = o.value;
    el.setValue = function (v, fire) {
      var changed = v !== el.value;
      el.value = v;
      for (var k in btns) btns[k].setAttribute('aria-pressed', String(k) === String(v) ? 'true' : 'false');
      if (fire && changed && isFn(o.onChange)) o.onChange(v);
    };
    el.setValue(o.value, false);
    return el;
  }

  /** Sección numerada que se pliega ("01 MANDOS ... meta ⌄"). o = {num, title, meta, open, body, id, onToggle} → .setOpen(b) · .setMeta(text) · .body */
  function section(o) {
    o = o || {};
    var id = o.id || nid('sec');
    var open = o.open !== false;
    var meta = h('span', { 'class': 'sec-meta', text: o.meta || '' });
    var body = h('div', { 'class': 'sec-body', id: id + '-body' });
    add(body, o.body);
    body.hidden = !open;
    var head = h('button', { type: 'button', 'class': 'sec-head', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': id + '-body' },
      (o.num !== undefined && o.num !== null && o.num !== '') ? h('span', { 'class': 'sec-num', text: fmtCode(o.num) }) : null,
      h('span', { 'class': 'sec-title', text: o.title }), meta, h('span', { 'class': 'sec-chev', 'aria-hidden': 'true' }));
    var el = h('section', { 'class': 'sec sec--num', 'data-sec': o.key || null }, head, body);
    el.setOpen = function (v) {
      v = v === undefined ? head.getAttribute('aria-expanded') !== 'true' : !!v;
      head.setAttribute('aria-expanded', v ? 'true' : 'false'); body.hidden = !v;
      if (isFn(o.onToggle)) o.onToggle(v);
    };
    head.addEventListener('click', function () { el.setOpen(); });
    el.setMeta = function (t) { tick_(meta, t || ''); };
    el.body = body; el.head = head;
    return el;
  }

  /** Carrusel horizontal de tarjetas con código (E1, L2, C3…), título en versalitas, dos líneas y meta mono.
   *  o = {items:[{code, title, sum, meta, current, tag, onClick}], label, list:true (en columna)} */
  function cardCarousel(o) {
    o = o || {};
    var ul = h('ul', { 'class': 'cards-h' + (o.list ? ' cards-h--list' : ''), 'aria-label': o.label });
    (o.items || []).forEach(function (it) {
      var act = isFn(it.onClick);
      var b = h(act ? 'button' : 'div', { type: act ? 'button' : null, 'class': 'card-h' + (it.current ? ' is-current' : ''), 'aria-current': it.current ? 'true' : null, onclick: act ? it.onClick : null },
        h('span', { 'class': 'card-h-top' }, it.code ? h('span', { 'class': 'card-h-code', text: it.code }) : null, it.tag ? h('span', { 'class': 'card-h-tag', text: it.tag }) : null),
        h('span', { 'class': 'card-h-title', text: it.title }),
        it.sum ? h('span', { 'class': 'card-h-sum', text: it.sum }) : null,
        it.meta ? h('span', { 'class': 'card-h-meta', text: it.meta }) : null);
      ul.appendChild(h('li', null, b));
    });
    return ul;
  }

  /** Deslizador con lectura grande, marcas, zonas de color, detents y valores rápidos.
   *  o = {label, min, max, step, value, format(v), big, center, zones:[{from,to,color}], ticks:[{v,t,cls}], ends:[a,b], detents:[v…] | [{v,t}], quick:[{v,t}], sub, onInput(v), id}
   *  → .set(v) · .value · .input · .setSub(text) */
  function slider(o) {
    o = o || {};
    var id = o.id || nid('rng');
    var fmt = isFn(o.format) ? o.format : function (v) { return String(v); };
    var inp = h('input', { type: 'range', 'class': 'range', min: o.min, max: o.max, step: o.step || 1, 'aria-label': o.label, id: id });
    var val = h('output', { 'class': 'ctl-val', 'for': id });
    var sub = o.sub !== undefined ? h('p', { 'class': 'ctl-sub', text: o.sub }) : null;
    var span = (+o.max) - (+o.min) || 1;
    var track = h('div', { 'class': 'ctl-track' }, inp);
    if (o.zones && o.zones.length) {
      track.style.setProperty('--trk', 'linear-gradient(90deg,' + o.zones.map(function (z) {
        return z.color + ' ' + ((z.from - o.min) / span * 100).toFixed(1) + '% ' + ((z.to - o.min) / span * 100).toFixed(1) + '%';
      }).join(',') + ')');
    }
    if (o.center) track.appendChild(h('span', { 'class': 'ctl-center', 'aria-hidden': 'true' }));
    var ticks = null;
    if (o.ticks) {
      ticks = h('div', { 'class': 'ticks', 'aria-hidden': 'true' });
      o.ticks.forEach(function (tk, i) {
        var sp = h('span', { 'class': 'tick' + (i % 2 ? ' is-alt' : '') + (tk.cls ? ' ' + tk.cls : '') + (tk.v <= o.min ? ' is-first' : '') + (tk.v >= o.max ? ' is-last' : ''), text: tk.t });
        sp.style.left = ((tk.v - o.min) / span * 100) + '%';
        ticks.appendChild(sp);
      });
    }
    var ends = o.ends ? h('div', { 'class': 'ctl-ends', 'aria-hidden': 'true' }, h('span', { text: o.ends[0] }), h('span', { text: o.ends[1] })) : null;
    var api = null, detents = null, dBtns = [];
    if (o.detents) {
      detents = h('div', { 'class': 'detents', role: 'group', 'aria-label': o.label + ': posiciones', style: { 'grid-template-columns': 'repeat(' + o.detents.length + ', 1fr)' } });
      o.detents.forEach(function (d) {
        var dv = typeof d === 'object' ? d.v : d, dt = typeof d === 'object' && d.t ? d.t : fmt(dv);
        var b = h('button', { type: 'button', 'class': 'detent', 'aria-pressed': 'false', onclick: function () { api.set(dv); if (isFn(o.onInput)) o.onInput(dv); } }, h('span', { 'class': 'detent-n', text: dt }));
        b._v = dv; dBtns.push(b); detents.appendChild(b);
      });
    }
    var quick = null;
    if (o.quick) {
      quick = h('div', { 'class': 'quick', role: 'group', 'aria-label': o.label + ': valores rápidos' });
      o.quick.forEach(function (q) { quick.appendChild(h('button', { type: 'button', 'class': 'qbtn', onclick: function () { api.set(q.v); if (isFn(o.onInput)) o.onInput(q.v); }, text: q.t })); });
    }
    api = h('div', { 'class': 'ctl' + (o.big ? ' ctl--big' : '') },
      h('div', { 'class': 'ctl-top' }, h('label', { 'class': 'ctl-lbl', 'for': id, text: o.label }), val), track, ticks, ends, detents, sub, quick);
    api.input = inp;
    api.set = function (v) {
      v = clamp(+v, +o.min, +o.max);
      if (+inp.value !== v) inp.value = v;
      var t = fmt(v);
      tick_(val, t);
      inp.setAttribute('aria-valuetext', t);
      dBtns.forEach(function (b) { b.setAttribute('aria-pressed', Math.abs(b._v - v) < (+o.step || 1) / 2 ? 'true' : 'false'); });
      api.value = v;
    };
    api.setSub = function (t) { if (sub) tick_(sub, t); };
    inp.addEventListener('input', function () { var v = parseFloat(inp.value); api.set(v); if (isFn(o.onInput)) o.onInput(v); });
    api.set(o.value !== undefined ? o.value : o.min);
    return api;
  }

  /** Barras vivas con valor mono. o = {rows:[{key, label, color, caption}]} → .set(key, frac 0..1, text) */
  function bars(o) {
    o = o || {};
    var el = h('div', { 'class': 'bars' });
    var rows = {};
    (o.rows || []).forEach(function (r) {
      if (r.caption) el.appendChild(h('p', { 'class': 'bars-cap', text: r.caption }));
      var fill = h('span', { 'class': 'bar-fill' }), v = h('span', { 'class': 'bar-val' });
      var row = h('div', { 'class': 'bar-row', style: r.color ? { '--c': r.color } : null }, h('span', { 'class': 'bar-name', text: r.label }), h('span', { 'class': 'bar-track', 'aria-hidden': 'true' }, fill), v);
      rows[r.key] = { fill: fill, v: v };
      el.appendChild(row);
    });
    el.set = function (key, frac, text) {
      var r = rows[key];
      if (!r) return;
      r.fill.style.transform = 'scaleX(' + clamp(+frac || 0, 0, 1).toFixed(3) + ')';
      if (text !== undefined) tick_(r.v, text);
    };
    return el;
  }

  /* ------------------------------------------------------------------ API pública */
  Kit.el = h; Kit.add = add; Kit.cls = cls;
  Kit.icon = icon; Kit.button = button; Kit.iconButton = iconButton; Kit.chip = chip; Kit.badge = badge;
  Kit.segmented = segmented; Kit.tabs = tabs; Kit.card = card; Kit.sectionHeader = sectionHeader; Kit.callout = callout;
  Kit.progressBar = progressBar; Kit.progressRing = progressRing; Kit.progressSteps = progressSteps;
  Kit.stat = stat; Kit.keyValue = keyValue; Kit.accordion = accordion;
  Kit.tooltip = tooltip; Kit.popover = popover; Kit.closePopover = function () { closePopover(true); };
  Kit.dialog = dialog; Kit.emptyState = emptyState; Kit.skeleton = skeleton; Kit.kbd = kbd; Kit.toast = toast;
  Kit.reducedMotion = reducedMotion; Kit.place = place;
  Kit.enName = enName; Kit.pageHeader = pageHeader; Kit.hud = hud; Kit.dockGroup = dockGroup; Kit.dock = dock; Kit.tchip = tchip; Kit.chain = chain; Kit.chainBar = chainBar;
  Kit.modes = modes; Kit.section = section; Kit.cardCarousel = cardCarousel; Kit.slider = slider; Kit.bars = bars;
})(root.C150);
