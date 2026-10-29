#!/usr/bin/env node
/*
 * tools/escuela-indice.js — herramienta de desarrollo (no forma parte del build de la app).
 *
 * Regenera src/data/escuela/indice.json (el índice liviano de la Escuela: módulos > unidades > lecciones) a partir de
 * _teorico/mapa/escuela-estructura.json (+ el número de preguntas del examen de cada módulo en _teorico/mapa/plan/<ID>.json).
 * _teorico/ está en .gitignore: esta herramienta LEE ese material, pero nada de él se publica; lo que se commitea es el indice.json
 * (sólo títulos, páginas, minutos, tipos de componente y estados) y los src/data/escuela/<ID>.json con el texto adaptado.
 *
 * "detalle" de cada lección:
 *   "completo"      la lección está en src/data/escuela/<ID>.json (se puede estudiar en la app)
 *   "proximamente"  el plan la tiene detallada pero todavía no se adaptó su contenido a la app
 *   "pendiente"     el plan todavía no la detalla
 *
 * Re-ejecutable después de cada tanda de contenido:   node tools/escuela-indice.js
 * Si no existe _teorico/ (otra máquina) y ya hay un indice.json, sólo recalcula "detalle" con los archivos de módulo presentes.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'escuela');
const OUT = path.join(OUT_DIR, 'indice.json');
const ESTRUCTURA = path.join(ROOT, '_teorico', 'mapa', 'escuela-estructura.json');
const PLAN_DIR = path.join(ROOT, '_teorico', 'mapa', 'plan');

// Resúmenes de una línea, con palabras propias (no se copian del curso).
const RESUMEN = {
  INT: 'Cómo funciona la escuela, el aeropuerto, la plataforma y los trámites de alumno piloto.',
  AER: 'Las cuatro fuerzas, el ala y la pérdida: por qué vuela un avión y cómo lo controlás.',
  INS: 'Los instrumentos del tablero: qué miden, cómo se leen y cuándo te pueden engañar.',
  AYM: 'El avión y su motor: estructura, mandos, hélice y los sistemas de a bordo.',
  COM: 'Las ondas de radio, el espacio aéreo y los servicios de tránsito aéreo.',
  ATM: 'El Anexo 4 y el Doc 4444: cómo se separa y se controla el tránsito aéreo.',
  RTF: 'El Doc 9432: cómo hablar por radio con claridad y con las frases normalizadas.',
  MET: 'La atmósfera, el viento, las nubes y cómo leer un METAR y un TAF.',
  NAV: 'Coordenadas, cartas, rumbo, viento y estima para llegar de un punto a otro.',
  REG: 'Licencias, reglas del aire y espacio aéreo: lo que te exige la norma.',
  PER: 'Cuánta pista, cuánta carga y cuánto combustible: performance y peso y balance.',
  FHU: 'El piloto como parte del sistema: salud, atención, fatiga y decisiones.'
};

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/** ids de lección presentes en src/data/escuela/<ID>.json */
function leccionesConContenido() {
  const set = new Set();
  if (!fs.existsSync(OUT_DIR)) return set;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!/^[A-Z]{3}\.json$/.test(f)) continue;
    try {
      const m = readJson(path.join(OUT_DIR, f));
      for (const u of m.unidades || []) for (const l of u.lecciones || []) set.add(l.id);
    } catch (e) { console.error('AVISO: no se pudo leer ' + f + ': ' + e.message); }
  }
  return set;
}

function detalleDe(id, estructuraDetalle, conContenido) {
  if (conContenido.has(id)) return 'completo';
  return estructuraDetalle === 'pendiente' ? 'pendiente' : 'proximamente';
}

function build() {
  const conContenido = leccionesConContenido();
  let modulos;
  if (fs.existsSync(ESTRUCTURA)) {
    const est = readJson(ESTRUCTURA);
    modulos = est.modulos.map((m, i) => {
      let num = null;
      try { const p = readJson(path.join(PLAN_DIR, m.id + '.json')); num = p.examenModulo && p.examenModulo.numPreguntas || null; } catch (e) { /* sin plan */ }
      return {
        id: m.id, orden: i + 1, titulo: m.titulo, fuente: m.fuente === 'aerosur' ? 'aerosur' : 'complementario',
        paginas: m.paginas || '', color: m.color, icono: m.iconoApp || 'cap', resumen: RESUMEN[m.id] || '',
        examen: { numPreguntas: num },
        unidades: m.unidades.map((u) => ({
          id: u.id, titulo: u.titulo, paginas: u.paginas || '',
          lecciones: u.lecciones.map((l) => ({
            id: l.id, titulo: l.titulo, paginas: l.paginas || '', minutos: l.minutos || 0,
            componentes: l.componentes || [], enlaces: l.enlaces || 0, detalle: detalleDe(l.id, l.detalle, conContenido)
          }))
        }))
      };
    });
  } else if (fs.existsSync(OUT)) {
    modulos = readJson(OUT).modulos;
    for (const m of modulos) for (const u of m.unidades) for (const l of u.lecciones) {
      l.detalle = detalleDe(l.id, l.detalle === 'pendiente' ? 'pendiente' : 'completo', conContenido);
    }
  } else {
    console.error('No hay _teorico/mapa/escuela-estructura.json ni un indice.json previo.');
    process.exit(1);
  }
  return { v: 1, modulos };
}

/** JSON legible pero compacto: una línea por lección. */
function formatear(ix) {
  const q = (o) => JSON.stringify(o);
  const NL = String.fromCharCode(10);
  const mods = ix.modulos.map((m) => {
    const uns = m.unidades.map((u) => {
      const ls = u.lecciones.map((l) => '      ' + q(l)).join(',' + NL);
      return '    {"id":' + q(u.id) + ',"titulo":' + q(u.titulo) + ',"paginas":' + q(u.paginas) + ',"lecciones":[' + NL + ls + NL + '    ]}';
    }).join(',' + NL);
    const cab = ['id', 'orden', 'titulo', 'fuente', 'paginas', 'color', 'icono', 'resumen', 'examen'].map((k) => q(k) + ':' + q(m[k])).join(',');
    return '  {' + cab + ',"unidades":[' + NL + uns + NL + '  ]}';
  });
  return '{"v":1,"modulos":[' + NL + mods.join(',' + NL) + NL + ']}' + NL;
}

const ix = build();
let n = 0, comp = 0, prox = 0, pend = 0;
for (const m of ix.modulos) for (const u of m.unidades) for (const l of u.lecciones) {
  n++; if (l.detalle === 'completo') comp++; else if (l.detalle === 'proximamente') prox++; else pend++;
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = formatear(ix);
JSON.parse(out);   // se asegura de que quedó JSON válido
fs.writeFileSync(OUT, out);
console.log('OK  ' + path.relative(ROOT, OUT) + '  ' + (Buffer.byteLength(out) / 1024).toFixed(0) + ' KB  ·  ' + ix.modulos.length + ' módulos · ' + n + ' lecciones (completo ' + comp + ' · próximamente ' + prox + ' · pendiente ' + pend + ')');
