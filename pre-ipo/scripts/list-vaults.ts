import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs"; import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";
const ui=(n:anchor.BN)=>Number(n.toString())/1e6;
async function main(){
  const kp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`,"utf8"))));
  const c=new anchor.web3.Connection("https://api.devnet.solana.com","confirmed");
  const p=new anchor.AnchorProvider(c,new anchor.Wallet(kp),{commitment:"confirmed"});
  anchor.setProvider(p);
  const prog=new Program<MarcoVault>(idl as MarcoVault,p);
  const all=await prog.account.vault.all();
  console.log(`${all.length} vaults exist on devnet under this program\n`);
  for(const {account:v} of all.sort((a,b)=>a.account.vaultId.localeCompare(b.account.vaultId))){
    console.log(`${v.vaultId.padEnd(18)} ${Object.keys(v.phase)[0].padEnd(10)} exitFee=${String(v.feeAtExit).padEnd(5)} deposits ${String(ui(v.totalDeposits)).padStart(7)}  claims ${String(ui(v.totalRedeemedUsdc)).padStart(7)}  feesCollected ${ui(v.feesCollected)}`);
  }
}
main().then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)});
