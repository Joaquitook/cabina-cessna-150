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

let body = template
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

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('OK  cabina-cessna-150.html', kb(full));
console.log('OK  cabina-cessna-150/index.html (Vercel)', kb(full));
console.log('OK  dist/artifact.html', kb(body));
