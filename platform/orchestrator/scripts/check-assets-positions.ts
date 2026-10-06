/**
 * Exercise the distribution reads — `listMarkets`, `listVaults`, `getHolding`
 * and `getVaultPosition` — against a live cluster.
 *
 * Deliberately constructs the adapter on its own rather than booting the whole
 * orchestrator. Starting the full service against devnet also starts the
 * watcher and the saga runner, which would read real chain events and could
 * begin submitting operator transactions. These four calls are reads; nothing
 * here can sign.
 *
 *   npx tsx scripts/check-assets-positions.ts [wallet]
 */
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as os from 'os';
import { SolanaChain } from '../src/adapters/solana/chain.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { systemClock } from '../src/domain/clock.js';
import { ConsoleLogger } from '../src/support/logger.js';

const WALLET = process.argv[2] ?? 'FzmTPA3AcsWMBxpc3ujP3J5opETignkXEYaCavskuUyL';

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, 'utf8'))),
);
const artifacts = loadArtifacts();
const chain = new SolanaChain({
  clock: systemClock,
  logger: new ConsoleLogger('warn'),
  rpcUrl: artifacts.addresses.rpcUrl,
  operator: kp,
  admin: kp,
  artifacts,
});

async function main(): Promise<void> {
  console.log(`cluster ${artifacts.addresses.cluster}\n`);

  const [markets, vaults] = await Promise.all([chain.listMarkets(), chain.listVaults()]);
  console.log(`listMarkets → ${markets.length}`);
  for (const market of markets) {
    console.log(
      `  ${market.ticker.padEnd(10)} ${market.status.padEnd(7)} fee ${String(market.feeBps).padStart(3)}bps  ` +
        `supply ${market.positionSupply.units}  escrow ${market.escrowBalance.amount}`,
    );
  }

  console.log(`\nlistVaults → ${vaults.length}`);
  for (const vault of vaults) {
    console.log(
      `  ${vault.vaultId.padEnd(18)} ${vault.phase.padEnd(10)} fee ${String(vault.feeBps).padStart(3)}bps  ` +
        `exit=${String(vault.feeAtExit).padEnd(5)} deposits ${vault.totalDeposits.amount}`,
    );
  }

  console.log(`\npositions for ${WALLET}`);
  let found = 0;
  for (const market of markets) {
    const holding = await chain.getHolding(market.ticker, WALLET);
    if (!holding) continue;
    found++;
    console.log(
      `  SPOT  ${holding.ticker.padEnd(10)} open ${holding.openQuantity.units}  ` +
        `avgCost ${holding.averageCost?.amount ?? '-'}  spent ${holding.usdcSpent.amount}  ` +
        `received ${holding.usdcReceived.amount}  pnl ${holding.realisedPnl.amount}`,
    );
  }
  for (const vault of vaults) {
    const position = await chain.getVaultPosition(vault.vaultId, WALLET);
    if (!position) continue;
    found++;
    console.log(
      `  VAULT ${position.vaultId.padEnd(18)} open ${position.openShares}  ` +
        `subscribed ${position.depositAmount.amount}  redeemed ${position.usdcRedeemed.amount}  ` +
        `fee ${position.entryFeePaid.amount}`,
    );
  }
  if (found === 0) console.log('  (none — this wallet has no Holding or BuyerState accounts)');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
