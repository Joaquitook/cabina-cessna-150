// Construye la app en un solo archivo HTML a partir de src/.
//   node build.js
// Salidas:
//   cabina-cessna-150.html  -> documento completo, se abre con doble clic
//   cabina-cessna-150/index.html -> el mismo documento, carpeta que se publica en Vercel
//   dist/artifact.html      -> mismo contenido sin <!doctype>/<html>/<head>/<body> (para publicar como Artifact)
// Publicar en Vercel:  npx vercel deploy cabina-cessna-150 --prod
//
// En src/index.html:
//   <style data-inline="styles.css"></style>            se reemplaza por el CSS del archivo
//   <script data-inline="sim.js"></script>              se reemplaza por el JS del archivo
//   <!--ESCUELA-JSON-->                                 se reemplaza por los bloques <script type="application/json"> de la Escuela:
//                                                       id="escuela-indice" (src/data/escuela/indice.json) y uno por módulo,
//                                                       id="escuela-<ID>" (src/data/escuela/<ID>.json); este último se parsea recién
//                                                       cuando el alumno abre ese módulo (src/escuela/datos.js). Sin módulos sigue andando.
//   La carpeta que se publica en Vercel recibe además cabina-cessna-150/escuela/<ID>.json (minificados) para la carga por fetch.
//   _teorico/ (material del curso, fuera de git) NUNCA se lee desde acá.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const template = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

const read = (rel) => {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) throw new Error('Falta el archivo: src/' + rel);
  return fs.readFileSync(p, 'utf8');
};

// Evita que un "</script>" dentro del JS cierre la etiqueta antes de tiempo.
const safeJs = (code) => code.replace(/<\/script/gi, '<\\/script');

// ---- ESCUELA: datos en JSON (índice + un archivo por módulo)
const ESC_DIR = path.join(SRC, 'data', 'escuela');
const escFiles = fs.existsSync(ESC_DIR) ? fs.readdirSync(ESC_DIR).filter((f) => /^[A-Za-z0-9_-]+\.json$/.test(f)).sort() : [];
const escData = {};
escFiles.forEach((f) => {
  const id = f.replace(/\.json$/, '');
  try { escData[id] = JSON.parse(fs.readFileSync(path.join(ESC_DIR, f), 'utf8')); }
  catch (e) { throw new Error('src/data/escuela/' + f + ' no es JSON válido: ' + e.message); }
});
// Un bloque de datos dentro del HTML: nada de "</script" ni "<!--" que lo corten antes de tiempo (los escapes son JSON válido).
const jsonBlock = (id, obj) => '<script type="application/json" id="escuela-' + id + '">' +
  JSON.stringify(obj).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\u0021--') + '</script>';
const escBlocks = Object.keys(escData).sort((a, b) => (a === 'indice' ? -1 : b === 'indice' ? 1 : a.localeCompare(b))).map((id) => jsonBlock(id, escData[id])).join('\n');

let body = template
  .replace('<!--ESCUELA-JSON-->', () => escBlocks)
  .replace(/<style\s+data-inline="([^"]+)"\s*><\/style>/g, (_, rel) => `<style>\n${read(rel)}\n</style>`)
  .replace(/<script\s+data-inline="([^"]+)"\s*><\/script>/g, (_, rel) => `<script>\n/* ---- ${rel} ---- */\n${safeJs(read(rel))}\n</script>`);

if (/data-inline=/.test(body)) throw new Error('Quedó una etiqueta data-inline sin reemplazar');

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), body);

// Para el documento completo, lo que va antes de la app (title, meta, link, style) pasa al <head>.
const appStart = body.indexOf('<div id="app"');
const headPart = appStart > 0 ? body.slice(0, appStart).trim() : '';
const bodyPart = appStart > 0 ? body.slice(appStart) : body;

// Ícono (el avioncito de la barra superior) y datos para cuando se comparte el enlace.
const ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0D1318"/>' +
  '<path d="M16 3c1.2 0 1.8 1.3 1.8 3.4V12l11 3.2v2.6l-11-1.4v6.2l3.6 2.6v2.1L16 26l-5.4 1.3v-2.1l3.6-2.6v-6.2l-11 1.4v-2.6l11-3.2V6.4C14.2 4.3 14.8 3 16 3z" fill="#F08A3C"/></svg>');
const SHARE = `<meta property="og:title" content="Cabina Cessna 150">
<meta property="og:description" content="Aprendé la cabina del Cessna 150 en 3D: cada mando e instrumento, qué hace y cómo se usa.">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_UY">
<meta name="theme-color" content="#0D1318">
<link rel="icon" href="${ICON}">`;

const full = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${SHARE}
${headPart}
</head>
<body>
${bodyPart}
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'cabina-cessna-150.html'), full);

// Carpeta lista para publicar en Vercel (sitio estático): cabina-cessna-150/index.html
const SITE = path.join(__dirname, 'cabina-cessna-150');
fs.mkdirSync(SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'index.html'), full);

// Datos de la Escuela para la carga perezosa por fetch (escuela/<ID>.json, minificados). Los que ya no existen en src/ se borran.
const SITE_ESC = path.join(SITE, 'escuela');
fs.mkdirSync(SITE_ESC, { recursive: true });
fs.readdirSync(SITE_ESC).forEach((f) => { if (/\.json$/.test(f) && !(f.replace(/\.json$/, '') in escData)) fs.unlinkSync(path.join(SITE_ESC, f)); });
Object.keys(escData).forEach((id) => fs.writeFileSync(path.join(SITE_ESC, id + '.json'), JSON.stringify(escData[id])));

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('OK  cabina-cessna-150.html', kb(full));
console.log('OK  cabina-cessna-150/index.html (Vercel)', kb(full));
console.log('OK  dist/artifact.html', kb(body));
console.log('OK  cabina-cessna-150/escuela/ (' + Object.keys(escData).length + ' archivos JSON: ' + Object.keys(escData).join(', ') + ')');
