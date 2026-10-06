/**
 * Build the two products the platform embeds, each into its own folder.
 *
 *   node src/build-apps.mjs        (run by `npm run build` in platform/, after the platform)
 *
 *   pre-ipo/web/index.html            the pre-IPO vault app, built from pre-ipo/web/src
 *   valuation-futures/web/index.html  the valuation-futures terminal, from valuation-futures/web/src
 *
 * Both load the platform's one chain bundle, platform/marco-chain.js, rather
 * than a copy each. The pages notice when they are framed by the platform
 * (window.MarcoShell) and hand it the rail, the theme and the wallet — see
 * embedFrame() in platform/src/parts/p6-preipo.js.
 */
import { execFileSync } from 'child_process';
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHAIN = '../../platform/marco-chain.js';   // from either web/ folder
const kb = (p) => (statSync(p).size / 1024).toFixed(0) + 'KB';

execFileSync(process.execPath,
  [join(REPO, 'pre-ipo', 'web', 'src', 'build.mjs'), '--out', 'pre-ipo/web', '--chain', CHAIN],
  { stdio: 'inherit' });

// The terminal goes live on the platform's bundle; the source keeps the
// placeholder, so opened on its own it runs the simulation.
const FUT = join(REPO, 'valuation-futures', 'web');
const fut = readFileSync(join(FUT, 'src', 'index.html'), 'utf8');
if (!fut.includes("'@CHAIN_SRC@'")) throw new Error('futures: chain placeholder not found');
writeFileSync(join(FUT, 'index.html'), fut.replace("'@CHAIN_SRC@'", `'${CHAIN}'`));
copyFileSync(join(FUT, 'src', 'how-it-works.html'), join(FUT, 'how-it-works.html'));

console.log('wrote valuation-futures/web/');
console.log('  index.html:', kb(join(FUT, 'index.html')));
console.log('  how-it-works.html:', kb(join(FUT, 'how-it-works.html')));
