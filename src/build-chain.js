// Bundles src/chain/ into marco-chain.js beside index.html.
//
//   node src/build-chain.js
//
// Kept out of index.html on purpose. The page is a single self-contained file
// so it can be opened from anywhere, and loading a megabyte of Solana
// libraries on every visit to make a wallet button work would trade that away
// for a feature most visitors never touch. The page loads this lazily, on the
// first connect, and falls back to simulated data when it is absent.
const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.join(DIR, '..');
const ADDRESSES = path.join(ROOT, 'shared', 'marco-artifacts', 'addresses.json');
const OUT = path.join(ROOT, 'marco-chain.js');

if (!fs.existsSync(ADDRESSES)) {
  console.error(`missing ${ADDRESSES}\nrun 'sh scripts/localnet.sh' first`);
  process.exit(1);
}

build({
  entryPoints: [path.join(DIR, 'chain', 'index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'MarcoChainModule',
  outfile: OUT,
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  // Anchor and web3.js reach for Node globals that a browser does not define.
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  inject: [path.join(DIR, 'chain', 'shim.js')],
  legalComments: 'none',
})
  .then(() => {
    const { cluster } = JSON.parse(fs.readFileSync(ADDRESSES, 'utf8'));
    console.log('wrote marco-chain.js');
    console.log('  size:', (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
    console.log('  cluster:', cluster);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
