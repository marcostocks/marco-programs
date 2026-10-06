/**
 * Build the Marco launch page (Moonshot AI + ByteDance).
 *
 *   node launch/src/build.mjs
 *
 * Concatenates parts/, inlines the four Open Sauce Sans weights as base64
 * @font-face data URIs, substitutes the cluster addresses, and writes
 * ../index.html. The chain bundle is copied in beside it so moonshot/ is a
 * folder you can deploy on its own.
 *
 *   node launch/src/build.mjs --out apps/preipo --chain ../../marco-chain.js
 *
 * builds the same page into the platform instead (see src/build-apps.mjs):
 * --out is relative to the repo root, and --chain is the bundle's path relative
 * to the page — given one, the bundle is shared rather than copied in.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync,
  readdirSync, mkdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');    // repo root
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SITE = arg('--out') ? join(ROOT, arg('--out')) : join(HERE, '..');   // launch/ by default
const CHAIN_SRC = arg('--chain') || 'marco-chain.js';
mkdirSync(SITE, { recursive: true });

const PARTS = [
  'p1-head.html',
  'p2-body.html',
  'p3-data.js',
  'p4-chain.js',
  'p5-app.js',
  'p6-boot.html',
];

// Fonts are read from the platform's src/fonts rather than duplicated here —
// they end up base64'd inside the output either way, so the built page stays a
// single self-contained file regardless of where the sources live.
const WEIGHTS = [300, 500, 600, 700];
const FONT_DIR = join(ROOT, 'src', 'fonts');

// The only place an address is allowed to come from. Everything downstream —
// this page and marco-chain.js both — is built against this one file.
const ADDRESSES = join(ROOT, 'shared', 'marco-artifacts', 'addresses.json');

if (!existsSync(ADDRESSES)) {
  console.error(`missing ${ADDRESSES}\nrun 'sh scripts/localnet.sh' or the devnet setup first`);
  process.exit(1);
}
const addresses = JSON.parse(readFileSync(ADDRESSES, 'utf8'));

let fonts = '';
for (const w of WEIGHTS) {
  const f = join(FONT_DIR, `open-sauce-sans-${w}.woff2`);
  if (!existsSync(f)) throw new Error('missing font: ' + f);
  const b = readFileSync(f);
  if (b.slice(0, 4).toString() !== 'wOF2') throw new Error('not a woff2: ' + f);
  fonts +=
    `@font-face{font-family:'Open Sauce Sans';font-style:normal;font-weight:${w};` +
    `font-display:swap;src:url(data:font/woff2;base64,${b.toString('base64')}) format('woff2')}\n`;
}

let html = PARTS.map((p) => readFileSync(join(HERE, 'parts', p), 'utf8')).join('');

if (!html.includes('/*__FONTS__*/')) throw new Error('font placeholder not found');
html = html.replace('/*__FONTS__*/', fonts);

// Artwork is embedded so the page stays one file. Each asset is looked up by
// stem across a preference order of formats, so dropping a `landing.webp` or a
// `moon-logo.svg` into art/ replaces what is there without touching any code.
const MIME = {
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};
const ORDER = ['.svg', '.webp', '.png', '.jpg', '.jpeg'];

function inlineArt(stem, { prefer = ORDER } = {}) {
  for (const ext of prefer) {
    const p = join(HERE, 'art', stem + ext);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    const uri = `data:${MIME[ext]};base64,${buf.toString('base64')}`;
    return { uri, note: `${stem}${ext} · ${(buf.length / 1024).toFixed(0)}KB → ${(uri.length / 1024).toFixed(0)}KB inlined` };
  }
  return { uri: '', note: `no ${stem}.* in moonshot/src/art/` };
}

// The landing background prefers a raster if one is present — a real render
// beats the generated vector. The logo prefers vector for the opposite reason.
const bg = inlineArt('landing', { prefer: ['.webp', '.jpg', '.jpeg', '.png', '.svg'] });

// One per offering. A missing file just leaves the token empty and the card
// falls back to its ticker letter, so adding an offering never breaks the build.
const LOGOS = ['moon', 'unitree', 'red', 'byte', 'dseek'];
const logos = Object.fromEntries(LOGOS.map((k) => [k, inlineArt(`${k}-logo`)]));

// Alternate backdrops, keyed by name rather than by offering — several cards
// can share one, which is the point: the strip fades to a different scene part
// way along rather than once per card.
const SCENES = ['wave'];
const scenes = Object.fromEntries(
  SCENES.map((k) => [k, inlineArt(`${k}-bg`, { prefer: ['.webp', '.jpg', '.jpeg', '.png'] })]),
);

/* Product media for the Social section, discovered rather than declared: every
 * file under art/media/<vault id>/ becomes a tile, in filename order. Adding a
 * photo is dropping a photo in — no code, no list to keep in sync.
 *
 * Stills are inlined like the rest of the artwork. Video is NOT: the page is one
 * self-contained file, and base64 turns even a short clip into several megabytes
 * of HTML that has to arrive before anything renders. Clips are copied to
 * moonshot/media/ and referenced by relative path instead — the same arrangement
 * marco-chain.js already uses, and the folder stays deployable on its own.
 *
 * A clip can carry a poster frame: name it the same with a .jpg extension and it
 * is inlined as the poster, so the tile shows something before the video loads.
 */
/* Intrinsic dimensions, read from the file header. The gallery sizes tiles by
 * height and lets width follow the picture, which needs the ratio to be known
 * before the image decodes — otherwise every tile lays out 2px wide and the
 * strip collapses on first paint. Header parsing rather than a dependency: it
 * is a dozen lines for the two formats that actually appear here. */
function dimensions(buf, ext) {
  if (ext === '.png' && buf.length > 24)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (ext === '.jpg' || ext === '.jpeg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      // SOFn carries the frame size. C4/C8/CC are tables, not frames.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;   // unknown: the tile falls back to a default ratio
}

const MEDIA_DIR = join(HERE, 'art', 'media');
const STILL = ['.webp', '.jpg', '.jpeg', '.png'];
const CLIP = ['.mp4', '.webm'];

function readMedia() {
  if (!existsSync(MEDIA_DIR)) return { media: {}, clips: [], notes: ['no art/media/'] };
  const media = {}, clips = [], notes = [];
  for (const id of readdirSync(MEDIA_DIR).sort()) {
    const dir = join(MEDIA_DIR, id);
    if (!statSync(dir).isDirectory()) continue;

    const capFile = join(dir, 'captions.json');
    const captions = existsSync(capFile) ? JSON.parse(readFileSync(capFile, 'utf8')) : {};

    const tiles = [];
    for (const name of readdirSync(dir).sort()) {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      const buf = () => readFileSync(join(dir, name));

      if (STILL.includes(ext)) {
        // Skip a still that is only there as a clip's poster frame.
        const stem = name.slice(0, -ext.length);
        if (CLIP.some((c) => existsSync(join(dir, stem + c)))) continue;
        const b = buf();
        const d = dimensions(b, ext);
        tiles.push({ t: 'img', src: `data:${MIME[ext]};base64,${b.toString('base64')}`,
                     cap: captions[name] ?? '', ...(d ?? {}) });
        notes.push(`${id}/${name} · ${(b.length / 1024).toFixed(0)}KB inlined`
          + (d ? ` · ${d.w}×${d.h}` : ' · SIZE UNKNOWN — tile falls back to 16:9'));
      } else if (CLIP.includes(ext)) {
        const stem = name.slice(0, -ext.length);
        const poster = STILL.map((e) => join(dir, stem + e)).find(existsSync);
        const p = poster ? readFileSync(poster) : null;
        clips.push({ from: join(dir, name), to: `${id}/${name}` });
        tiles.push({ t: 'vid', src: `media/${id}/${name}`,
                     poster: p ? `data:image/jpeg;base64,${p.toString('base64')}` : '',
                     cap: captions[name] ?? '' });
        notes.push(`${id}/${name} · ${(statSync(join(dir, name)).size / 1024).toFixed(0)}KB copied`
          + (poster ? ' + poster' : ' · NO POSTER — the tile is blank until it loads'));
      }
    }
    if (tiles.length) media[id] = tiles;
  }
  return { media, clips, notes };
}
const { media, clips, notes: mediaNotes } = readMedia();

const subs = {
  '@CLUSTER@': addresses.cluster,
  '@CHAIN_SRC@': CHAIN_SRC,
  '@VAULT_PROGRAM@': addresses.programs.marcoVault,
  '@USDC_MINT@': addresses.usdc.mint,
  '@LANDING_BG@': bg.uri,
  ...Object.fromEntries(LOGOS.map((k) => [`@${k.toUpperCase()}_LOGO@`, logos[k].uri])),
  // A whole CSS value: an absent scene has to become `none`, since `url("")`
  // resolves to the page itself and paints a broken layer.
  ...Object.fromEntries(
    SCENES.map((k) => [`@${k.toUpperCase()}_BG@`, scenes[k].uri ? `url("${scenes[k].uri}")` : 'none']),
  ),
  // A JSON literal the page reads directly — {vaultId: [{t,src,poster,cap}]}.
  '@MEDIA@': JSON.stringify(media),
};
for (const [token, value] of Object.entries(subs)) {
  if (!html.includes(token)) throw new Error(`placeholder ${token} not found`);
  html = html.replaceAll(token, value);
}

const out = join(SITE, 'index.html');
writeFileSync(out, html);

// The page loads the bundle by relative path, so it has to sit in this folder.
// Its absence is not fatal: the page falls back to the labelled simulation, and
// that is exactly the state a build without `npm run build:chain` should produce.
const chainSrc = join(ROOT, 'marco-chain.js');
const chainOut = join(SITE, 'marco-chain.js');
let chainNote = 'absent — run `npm run build:chain` (page falls back to the simulation)';
if (CHAIN_SRC !== 'marco-chain.js') {
  chainNote = `shared — loaded from ${CHAIN_SRC}`;
} else if (existsSync(chainSrc)) {
  copyFileSync(chainSrc, chainOut);
  chainNote = `${(statSync(chainOut).size / 1024).toFixed(0)}KB`;
}

// Clips live beside the page rather than inside it. The folder is rebuilt each
// time so a removed source file does not leave a stale copy behind.
const clipDir = join(SITE, 'media');
rmSync(clipDir, { recursive: true, force: true });
for (const c of clips) {
  const dest = join(clipDir, c.to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(c.from, dest);
}

console.log(`wrote ${out}`);
console.log('  size:', (statSync(out).size / 1024).toFixed(0) + 'KB');
console.log('  fonts embedded:', WEIGHTS.join(', '));
console.log('  cluster:', addresses.cluster);
console.log('  vault program:', addresses.programs.marcoVault);
console.log('  marco-chain.js:', chainNote);
console.log('  landing artwork:', bg.note);
for (const k of LOGOS) console.log(`  logo ${k}:`, logos[k].note);
for (const k of SCENES) console.log(`  scene ${k}:`, scenes[k].note);
console.log('  media:', mediaNotes.length ? '' : 'none in art/media/');
for (const n of mediaNotes) console.log(`    ${n}`);
if (clips.length) console.log(`  clips copied to moonshot/media/: ${clips.length}`);
console.log('  external refs:', (html.match(/https?:\/\/[^"')\s]+/g) || []).length);
