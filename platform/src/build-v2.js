// Injects self-hosted Open Sauce Sans (base64 woff2) into src/index.src.html
// and writes the finished single-file site to index.html in the repo root.
//
//   node src/build-v2.js
//
// Fonts come from @fontsource/open-sauce-sans. NOTE: that package's latin-400
// file is corrupt on both jsDelivr and unpkg (it's a Type 1 font, not woff2),
// so we ship 300/500/600/700 — browsers resolve a 400 request to the 500 face.
const fs = require('fs');
const path = require('path');

// Sources live beside this script in platform/src/; the built page is the one
// file at the repo root, so OUT climbs out of platform/.
const DIR = __dirname;
const ROOT = path.join(DIR, '..', '..');
const SRC = path.join(DIR, 'index.src.html');
const OUT = path.join(ROOT, 'index.html');
const FONT_DIR = path.join(DIR, 'fonts');

const WEIGHTS = [300, 500, 600, 700];

let css = '';
for (const w of WEIGHTS) {
  const f = path.join(FONT_DIR, `open-sauce-sans-${w}.woff2`);
  if (!fs.existsSync(f)) throw new Error('missing font: ' + f);
  const b = fs.readFileSync(f);
  if (b.slice(0, 4).toString() !== 'wOF2') throw new Error('not a woff2: ' + f);
  css +=
    `@font-face{font-family:'Open Sauce Sans';font-style:normal;font-weight:${w};` +
    `font-display:swap;src:url(data:font/woff2;base64,${b.toString('base64')}) format('woff2')}\n`;
}

let html = fs.readFileSync(SRC, 'utf8');
if (!html.includes('/*__FONTS__*/')) throw new Error('font placeholder not found in source');
html = html.replace('/*__FONTS__*/', css);
fs.writeFileSync(OUT, html);

console.log('wrote index.html');
console.log('  fonts embedded:', WEIGHTS.join(', '));
console.log('  size:', (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
console.log('  external refs:', (html.match(/https?:\/\/(?!api\.)[^"')\s]+/g) || []).length);
