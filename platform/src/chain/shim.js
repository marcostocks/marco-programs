// Node globals that @solana/web3.js and Anchor expect but a browser does not
// provide. Injected by esbuild into the chain bundle only, so nothing else on
// the page is affected.
import { Buffer } from 'buffer';

export { Buffer };
export const process = { env: { NODE_ENV: 'production' }, browser: true, version: '' };
