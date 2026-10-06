/**
 * Generate the landing background — isometric stacked tiles.
 *
 *   node moonshot/src/art/make-landing-tiles.mjs
 *
 * A calmer reading of the reference: same idea of square plates on an isometric
 * lattice, each sitting on a stack of thin coloured layers, lit from the upper
 * left. The reference itself is unusable behind type — near-black against pure
 * white at full saturation, edge to edge, with no rest anywhere. Three things
 * are dialled back here and they are the whole difference:
 *
 *   DENSITY   about half the cells are empty, so the eye has somewhere to land.
 *   CONTRAST  no pure white and no pure black; the range is squeezed toward the
 *             middle, where type can sit on top of it.
 *   CHROMA    the orange and red are desaturated well below the source. They
 *             still read as orange, but they stop shouting.
 *
 * Alternate to make-landing.mjs (the green plates). Both write landing.svg, and
 * whichever ran last is what the build inlines.
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const W = 1600, H = 900;

const P = {
  tw: 132,        // half-width of a tile's diamond
  th: 76,         // half-height — the isometric squash
  density: 0.52,  // fraction of lattice cells that carry a tile
  minStack: 2,    // thin layer count, low end
  maxStack: 7,    // and high end — the variation is what reads as depth
  layer: 5,       // thickness of one stacked layer
};

/* Muted against the source, which runs to pure white and full-chroma orange.
   Each face has a matching darker side used for the stack edge beneath it. */
const FACES = [
  { face: '#C98A4B', edge: '#8E5A2B', w: 3 },   // amber
  { face: '#B4633A', edge: '#7C3D22', w: 2 },   // burnt orange
  { face: '#414449', edge: '#2A2C30', w: 3 },   // charcoal
  { face: '#565A60', edge: '#35383D', w: 2 },   // lighter charcoal
  { face: '#9C4630', edge: '#68291B', w: 1 },   // deep red, sparingly
  { face: '#D8CFC2', edge: '#9A9186', w: 1 },   // bone, standing in for the white
];
const PICK = FACES.flatMap((f) => Array(f.w).fill(f));

/* Deterministic, so the artwork is identical on every build. */
let seed = 20260728;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const rhombus = (cx, cy) =>
  `${cx},${(cy - P.th).toFixed(1)} ${(cx + P.tw).toFixed(1)},${cy} ` +
  `${cx},${(cy + P.th).toFixed(1)} ${(cx - P.tw).toFixed(1)},${cy}`;

const cells = [];
// Range covers the canvas plus a margin, since the lattice runs diagonally.
for (let i = -4; i <= 14; i++) {
  for (let j = -8; j <= 12; j++) {
    const cx = W / 2 + (i - j) * P.tw;
    const cy = -60 + (i + j) * P.th;
    if (cx < -P.tw * 2 || cx > W + P.tw * 2 || cy < -P.th * 4 || cy > H + P.th * 4) continue;
    if (rnd() > P.density) continue;
    const stack = P.minStack + Math.floor(rnd() * (P.maxStack - P.minStack + 1));
    cells.push({ cx, cy, stack, c: PICK[Math.floor(rnd() * PICK.length)] });
  }
}
// Painter's order: further back first, so nearer tiles overlap correctly.
cells.sort((a, b) => a.cy - b.cy || a.cx - b.cx);

const parts = cells.map(({ cx, cy, stack, c }) => {
  const lift = stack * P.layer;
  let out = '';
  // The stack, drawn downward from the face — these edges are what give the
  // reference its striped look, so they are kept, just quieter.
  for (let k = stack; k >= 1; k--) {
    out += `<polygon points="${rhombus(cx, cy - lift + k * P.layer)}" fill="${c.edge}" ` +
           `opacity="${(0.55 + 0.05 * (stack - k)).toFixed(2)}"/>`;
  }
  out += `<polygon points="${rhombus(cx, cy - lift)}" fill="${c.face}"/>`;
  // A single lit edge along the upper-left, which is where the light is.
  out += `<polyline points="${(cx - P.tw).toFixed(1)},${(cy - lift).toFixed(1)} ` +
         `${cx},${(cy - lift - P.th).toFixed(1)} ${(cx + P.tw).toFixed(1)},${(cy - lift).toFixed(1)}" ` +
         `fill="none" stroke="#EFE6D8" stroke-width="1.4" opacity=".18"/>`;
  return out;
});

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
  `preserveAspectRatio="xMidYMid slice">` +
  `<defs>` +
  `<linearGradient id="bed" x1="0" y1="0" x2=".8" y2="1">` +
  `<stop offset="0" stop-color="#2C2A29"/><stop offset=".55" stop-color="#231F1E"/>` +
  `<stop offset="1" stop-color="#191615"/></linearGradient>` +
  // A soft vignette pulls the corners down so the middle stays the calmest part
  // of the frame, which is where the card sits.
  `<radialGradient id="calm" cx=".5" cy=".46" r=".78">` +
  `<stop offset="0" stop-color="#000" stop-opacity=".34"/>` +
  `<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
  `</defs>` +
  `<rect width="${W}" height="${H}" fill="url(#bed)"/>` +
  `<g>${parts.join('')}</g>` +
  `<rect width="${W}" height="${H}" fill="url(#calm)"/>` +
  `</svg>`;

const out = join(dirname(fileURLToPath(import.meta.url)), 'landing.svg');
writeFileSync(out, svg);
console.log(`wrote ${out} · ${(svg.length / 1024).toFixed(1)}KB · ${cells.length} tiles`);
