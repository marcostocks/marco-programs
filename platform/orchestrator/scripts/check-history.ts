/** Mirror the browser myHistory() — serial getTransaction + retry — for a real wallet. */
import { readFileSync } from 'node:fs';
import { AnchorProvider, EventParser, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';

const HOLDER = new PublicKey(process.env.HOLDER ?? 'FzmTPA3AcsWMBxpc3ujP3J5opETignkXEYaCavskuUyL');
const IDS = ['moon-2026-s', 'red-2026', 'byte-2026-r'];
const k = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace('~', process.env.HOME!), 'utf8'))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
  let e; for (let i = 0; i < 5; i += 1) { try { return await fn(); } catch (err) { e = err; await sleep(400 * (i + 1)); } } throw e;
};

async function main() {
  const a = loadArtifacts();
  const admin = k('~/.config/solana/id.json');
  const conn = new Connection(a.addresses.rpcUrl, 'confirmed');
  const program = new Program(a.vaultIdl as never, new AnchorProvider(conn, new Wallet(admin), {}));
  const parser = new EventParser(a.vaultProgramId, (program as any).coder);

  for (const id of IDS) {
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), admin.publicKey.toBuffer(), Buffer.from(id)], a.vaultProgramId);
    const [buyer] = PublicKey.findProgramAddressSync([Buffer.from('buyer'), vault.toBuffer(), HOLDER.toBuffer()], a.vaultProgramId);
    const sigs = await retry(() => conn.getSignaturesForAddress(buyer, { limit: 20 }));
    const confirmed = sigs.filter((s) => !s.err).map((s) => s.signature);
    console.log(`\n${id}  ${confirmed.length} sigs`);
    for (const sig of confirmed) {
      let tx; try { tx = await retry(() => conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })); } catch { console.log(`  ${sig.slice(0,8)} unreadable`); continue; }
      const logs = tx?.meta?.logMessages; if (!logs) continue;
      for (const ev of parser.parseLogs(logs)) {
        if (ev.name === 'depositMade') console.log(`  ${sig.slice(0,8)} Subscribed  accepted=${ev.data.accepted}`);
        else if (ev.name === 'claimMade') console.log(`  ${sig.slice(0,8)} Redeemed    usdc_paid=${ev.data.usdcPaid ?? ev.data.usdc_paid}  shares_burned=${ev.data.sharesBurned ?? ev.data.shares_burned}`);
      }
      await sleep(80);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
