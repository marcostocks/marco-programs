/**
 * Generate the landing background.
 *
 *   node moonshot/src/art/make-landing.mjs
 *
 * A cascade of thin upright plates stepping up to the right across a green
 * gradient. Written as a generator rather than as hand-authored SVG because the
 * whole image is one repeated element — the numbers below are the artwork, and
 * hand-editing 26 near-identical <rect> runs is how it stops being editable.
 *
 * Output is vector, so the whole background costs a few KB inside the page
 * instead of the few hundred a render of the same thing would.
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const W = 1600, H = 900;

/* Tuned so the run reaches the bottom-left corner and leaves the frame at the
   top right, which is what puts the open field of colour in the upper left —
   the quiet corner the header sits in. */
const P = {
  n: 32,          // plates, several of which start below the frame
  x0: -170,       // where the cascade starts, off-frame bottom-left
  y0: 1140,       // top of the first plate, below the frame
  dx: 59,         // horizontal step between plates
  dy: 38,         // how far each plate's top rises — shallower than it is deep
  face: 41,       // width of the shaded face
  edge: 8,        // the plate's thickness, catching the light
  lip: 6,         // how much of the top surface is visible
};

/* Green, from the light haze at top-left to the shadowed depth behind the
   cascade. The plates read as glass: the face darkens down its length, the
   thickness edge stays bright. */
const defs = `
  <linearGradient id="sky" x1="0" y1="0" x2="0.85" y2="1">
    <stop offset="0" stop-color="#cbe1ae"/>
    <stop offset=".38" stop-color="#aecd8f"/>
    <stop offset=".72" stop-color="#87ac6b"/>
    <stop offset="1" stop-color="#6a8c57"/>
  </linearGradient>
  <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#a4c189"/>
    <stop offset=".22" stop-color="#789868"/>
    <stop offset=".55" stop-color="#3f593c"/>
    <stop offset=".82" stop-color="#2b3d2b"/>
    <stop offset="1" stop-color="#22331f"/>
  </linearGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e7efdd"/>
    <stop offset=".18" stop-color="#b8cca4"/>
    <stop offset=".55" stop-color="#789868"/>
    <stop offset="1" stop-color="#4a6045"/>
  </linearGradient>
  <linearGradient id="lip" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#f1f6ec"/>
    <stop offset="1" stop-color="#c1d6af"/>
  </linearGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="9"/>
  </filter>`;

const plates = [];
for (let i = 0; i < P.n; i++) {
  const x = P.x0 + i * P.dx;
  const top = P.y0 - i * P.dy;
  if (top > H) continue;                       // still below the frame
  const h = H - top + 4;
  const depth = i / (P.n - 1);                 // 0 near, 1 far

  // Each plate throws a soft shadow onto the gap behind it, which is what
  // separates the run into distinct sheets rather than one striped block.
  plates.push(
    `<rect x="${(x + P.face + P.edge).toFixed(1)}" y="${(top - P.lip).toFixed(1)}" ` +
    `width="${(P.dx - P.face - P.edge + 6).toFixed(1)}" height="${(h + P.lip).toFixed(1)}" ` +
    `fill="#32462f" opacity="${(0.30 - depth * 0.13).toFixed(3)}" filter="url(#soft)"/>`,
  );
  // the visible top surface, a shallow parallelogram
  plates.push(
    `<path d="M${x.toFixed(1)} ${top.toFixed(1)} ` +
    `L${(x + P.face).toFixed(1)} ${top.toFixed(1)} ` +
    `L${(x + P.face + P.edge).toFixed(1)} ${(top - P.lip).toFixed(1)} ` +
    `L${(x + P.edge).toFixed(1)} ${(top - P.lip).toFixed(1)}Z" fill="url(#lip)" ` +
    `opacity="${(0.95 - depth * 0.25).toFixed(3)}"/>`,
  );
  plates.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${P.face}" height="${h.toFixed(1)}" fill="url(#face)"/>`);
  plates.push(
    `<rect x="${(x + P.face).toFixed(1)}" y="${(top - P.lip).toFixed(1)}" ` +
    `width="${P.edge}" height="${(h + P.lip).toFixed(1)}" fill="url(#edge)" ` +
    `opacity="${(0.92 - depth * 0.18).toFixed(3)}"/>`,
  );
  // the rim where the top surface meets the face — the brightest line on the plate
  plates.push(
    `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${P.face}" height="1.6" ` +
    `fill="#eef4e2" opacity="${(0.8 - depth * 0.3).toFixed(3)}"/>`,
  );
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
  `preserveAspectRatio="xMidYMid slice">` +
  `<defs>${defs}</defs>` +
  `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
  `<g>${plates.join('')}</g>` +
  `</svg>`;

const out = join(dirname(fileURLToPath(import.meta.url)), 'landing.svg');
writeFileSync(out, svg);
console.log(`wrote ${out} · ${(svg.length / 1024).toFixed(1)}KB · ${P.n} plates`);
