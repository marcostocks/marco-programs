/**
 * Build the products the platform embeds into apps/ beside index.html.
 *
 *   node src/build-apps.mjs        (run by `npm run build`, after the platform)
 *
 *   apps/preipo/   the pre-IPO vault app — built from launch/src, loading the
 *                  platform's own marco-chain.js rather than a second copy
 *   apps/futures/  the valuation-futures terminal — valuationfutures/, pointed at the same bundle
 *
 * Each still ships standalone from its own folder; the pages notice when they
 * are framed by the platform (window.MarcoShell) and hand it the rail, the
 * theme and the wallet. See embedFrame() in src/parts/p6-preipo.js.
 */
import { execFileSync } from 'child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + 'KB';

execFileSync(process.execPath,
  [join(ROOT, 'launch', 'src', 'build.mjs'), '--out', 'apps/preipo', '--chain', '../../marco-chain.js'],
  { stdio: 'inherit' });

const FUT = join(ROOT, 'apps', 'futures');
mkdirSync(FUT, { recursive: true });
// The terminal goes live on the platform's shared bundle; the source keeps the
// placeholder, so opened on its own it runs the simulation.
const fut = readFileSync(join(ROOT, 'valuationfutures', 'index.html'), 'utf8');
if (!fut.includes("'@CHAIN_SRC@'")) throw new Error('futures: chain placeholder not found');
writeFileSync(join(FUT, 'index.html'), fut.replace("'@CHAIN_SRC@'", "'../../marco-chain.js'"));
copyFileSync(join(ROOT, 'valuationfutures', 'how-it-works.html'), join(FUT, 'how-it-works.html'));

console.log('wrote apps/futures/');
console.log('  index.html:', kb(join(FUT, 'index.html')));
console.log('  how-it-works.html:', kb(join(FUT, 'how-it-works.html')));
