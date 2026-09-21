import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";
import { getAccount } from "@solana/spl-token";

const T: [string,string][] = [
  ["flat  4gDCNH", "4gDCNHPb4n8PxPRztgCRrjc67zuKhvEgDb5WnRKE8xz6"],
  ["gain  9scqYn", "9scqYnGfYGDS7CUm4LxFV4EScBMLntjAzSK8fUMEiZA"],
  ["open  D6ZqeD", "D6ZqeDEjy18dgqYXttCTQyGispeHE3p8L2LEk3RSAqGh"],
];
async function main(){
  const kp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`,"utf8"))));
  const c=new anchor.web3.Connection("https://api.devnet.solana.com","confirmed");
  const p=new anchor.AnchorProvider(c,new anchor.Wallet(kp),{commitment:"confirmed"});
  anchor.setProvider(p);
  const prog=new Program<MarcoVault>(idl as MarcoVault,p);
  for(const [label,addr] of T){
    const v=await prog.account.vault.fetch(new PublicKey(addr));
    let bal="?"; try{ bal=(Number((await getAccount(c,v.vaultUsdc)).amount)/1e6).toString() }catch{}
    console.log(`${label}\n  vault_usdc        ${v.vaultUsdc.toBase58()}  (balance ${bal})\n  broker dest       ${v.depositDestination.toBase58()}`);
  }
}
main().then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)});
