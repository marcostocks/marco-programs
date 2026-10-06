/**
 * Build the products the platform embeds into apps/ beside index.html.
 *
 *   node src/build-apps.mjs        (run by `npm run build`, after the platform)
 *
 *   apps/preipo/   the pre-IPO vault app — built from launch/src, loading the
 *                  platform's own marco-chain.js rather than a second copy
 *   apps/futures/  the valuation-futures terminal — valuationfutures/, as is
 *
 * Each still ships standalone from its own folder; the pages notice when they
 * are framed by the platform (window.MarcoShell) and hand it the rail, the
 * theme and the wallet. See embedFrame() in src/parts/p6-preipo.js.
 */
import { execFileSync } from 'child_process';
import { copyFileSync, mkdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + 'KB';

execFileSync(process.execPath,
  [join(ROOT, 'launch', 'src', 'build.mjs'), '--out', 'apps/preipo', '--chain', '../../marco-chain.js'],
  { stdio: 'inherit' });

const FUT = join(ROOT, 'apps', 'futures');
mkdirSync(FUT, { recursive: true });
for (const f of ['index.html', 'how-it-works.html'])
  copyFileSync(join(ROOT, 'valuationfutures', f), join(FUT, f));

console.log('wrote apps/futures/');
console.log('  index.html:', kb(join(FUT, 'index.html')));
console.log('  how-it-works.html:', kb(join(FUT, 'how-it-works.html')));
