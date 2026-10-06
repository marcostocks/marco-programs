/* ════════════════════════ chain client — lazy, optional ════════════════════════

   Bridges the page to marco-vault on Solana. Everything here degrades to the
   simulated data the rest of the app already uses, because the page has to keep
   working in the three situations where there is no chain to talk to:

     - opened straight off disk, with no marco-chain.js beside it;
     - opened with ?demo=1, where the recorded tour drives the real UI and a
       live validator would make the numbers non-reproducible;
     - opened against a vault that only exists as marketing copy.

   A vault is chain-backed only if its VAULTS entry carries `chainId` AND that
   vault actually exists on the cluster. Everything else stays simulated, and
   the user is told which they are looking at rather than left to guess.
   ═══════════════════════════════════════════════════════════════════════════ */

const CHAIN_SRC = 'platform/marco-chain.js';   // beside the built bundle; DEMO_MODE is defined in p3-data.js

let chainPromise = null;

/** Load marco-chain.js once. Resolves to null when it is absent or blocked. */
function loadChain(){
  if(DEMO_MODE) return Promise.resolve(null);
  if(chainPromise) return chainPromise;
  chainPromise=new Promise(res=>{
    const s=document.createElement('script');
    s.src=CHAIN_SRC;
    s.onload=()=>{
      // A chain to trade on means the seeded demo book has no business on
      // screen: until a wallet connects, the book is empty, not someone's.
      if(window.MarcoChain&&!chainLive())emptyBook();
      res(window.MarcoChain||null);
    };
    // Absent bundle is an expected state, not an error: the page is designed
    // to be opened as a single file with nothing beside it.
    s.onerror=()=>res(null);
    document.head.appendChild(s);
  });
  return chainPromise;
}

/** The chain client if one is usable, else null. Never throws. */
async function chain(){
  try{ return await loadChain() }catch{ return null }
}

/** True once a wallet is connected and we are not in the recorded tour. */
const chainLive=()=>!DEMO_MODE&&!!window.MarcoChain?.connected;

/**
 * Live state for a vault card, or null to stay on simulated data.
 * Cached per vault id so re-rendering a card does not re-hit RPC.
 */
const chainCache=new Map();
async function chainVault(v,{fresh=false}={}){
  if(DEMO_MODE||!v||!v.chainId) return null;
  if(!fresh&&chainCache.has(v.chainId)) return chainCache.get(v.chainId);
  const c=await chain();
  if(!c) return null;
  let state=null;
  try{ state=await c.getVault(v.chainId) }catch{ state=null }
  chainCache.set(v.chainId,state);
  return state;
}

/** The connected wallet's on-chain position in a vault, or null. */
async function chainPosition(v,{fresh=false}={}){
  if(!chainLive()||!v?.chainId) return null;
  try{ return await window.MarcoChain.getPosition(v.chainId,{fresh}) }catch{ return null }
}

function invalidateChain(v){
  if(v?.chainId) chainCache.delete(v.chainId);
}

/* ---- live reads --------------------------------------------------------- */

/* The on-chain phase drives what the card offers. `open` accepts deposits and
   `live` opens redemption, so mapping the wrong phase to either would show a
   button the program will reject. */
const PHASE_STATUS={
  Scheduled:'soon',
  Funding:'open',
  Sealed:'locked', Sourcing:'locked', Sourced:'locked', Deployed:'locked',
  Live:'ipo', Realized:'ipo',
  Claimable:'live', Winding:'live',
  Concluded:'closed', Cancelled:'closed', Refunded:'closed',
};

/**
 * Copy live state onto the VAULTS entry.
 *
 * The card reads `raisedUsd`, `vaultSize` and `status` in twenty places.
 * Writing chain values onto the entry means every one of those reads becomes
 * live without touching them — and a vault with no `chainId` keeps its
 * illustrative figures untouched.
 *
 * Returns true when anything changed, so callers can skip a re-render.
 */
async function syncChainVault(v,opts){
  const st=await chainVault(v,opts);
  if(!st) return false;

  const before=[v.raisedUsd,v.vaultSize,v.status,v.nrv,v.close].join('|');
  v.vaultSize=st.cap;
  v.raisedUsd=st.totalDeposits;
  v.status=PHASE_STATUS[st.phase]??v.status;
  v.chainPhase=st.phase;
  // The deadline the program enforces, so the tape and pipeline count down to
  // the same moment the Pre-IPO app does.
  if(st.fundingDeadline>0)v.close=new Date(st.fundingDeadline).toISOString();
  // The subscription fee the vault was created with, so the subscribe quote
  // matches what the program will mint rather than a hard-coded default.
  v.chainFeeBps=st.feeBps;
  // Fee timing: false = taken at deposit (tokens are net), true = taken at
  // redemption (deposit mints 1:1 gross). Drives the quote and the copy.
  v.chainFeeAtExit=st.feeAtExit===true;

  // Redemption value per token, straight from the program: the redeemable
  // pool divided by the tokens entitled to it. The card would otherwise show
  // the illustrative NAV and quote a payout the chain will not honour.
  if(st.totalShares>0&&st.redeemable>0) v.nrv=st.redeemable/st.totalShares;

  const pos=await chainPosition(v,opts);
  if(pos) S.vpos[v.id]={sub:pos.deposited,tok:pos.shares,sh:0};

  return before!==[v.raisedUsd,v.vaultSize,v.status,v.nrv,v.close].join('|');
}

/** Sync every chain-backed vault. Called before the pre-IPO page renders. */
async function syncChainVaults(opts){
  const backed=VAULTS.filter(v=>v.chainId);
  if(!backed.length) return false;
  const changed=await Promise.all(backed.map(v=>syncChainVault(v,opts).catch(()=>false)));
  return changed.some(Boolean);
}

/* ---- the book -----------------------------------------------------------

   With a real wallet connected, the platform's book IS the wallet: cash is
   its USDC, spot positions are its position tokens across every market, and
   vault positions are its claim tokens. Swapping the book rather than teaching
   each view about the chain means the portfolio, the hero, the watchlist and
   the ticket all read real balances unchanged. With no wallet the book is
   empty — the seeded demo book only survives where there is no chain at all
   (opened off disk) or in the recorded tour (?demo=1). */
function emptyBook(){
  S.cash=0;S.pos={};S.vpos={};S.chainPos={};S.chainUsdc=null;S.pending=[];
  if(typeof go==='function'&&S.page)go(S.page);
}
async function loadChainBook(){
  if(!chainLive())return false;
  const c=window.MarcoChain;
  const [usdc,spot]=await Promise.all([
    c.getUsdcBalance().catch(()=>null),c.getSpotPortfolio().catch(()=>null)]);
  if(usdc==null||spot==null)return false;
  S.cash=usdc;S.chainUsdc=usdc;
  S.pos={};
  MARKETS.forEach(m=>{const h=m.chainTicker&&spot[m.chainTicker];
    if(h&&h.tokens>0)S.pos[m.id]={sz:h.tokens,avg:h.avgCost||m.px}});
  /* Trades shown as executed whose custodian leg has not landed yet. Chain
     already reflects what left the wallet (the buy's USDC, the sell's tokens);
     add what is coming back, until the order stops being pending. */
  const still=[];
  for(const t of new Set((S.pending||[]).map(p=>p.ticker))){
    const mine=S.pending.filter(p=>p.ticker===t);
    const os=await c.getMyOrders(t).catch(()=>null);
    if(!os){still.push(...mine);continue}
    mine.forEach(p=>{const o=os.find(x=>x.orderId===p.orderId);
      if(!o||o.status==='pending'||o.status==='deployed')still.push(p)});
  }
  S.pending=still;
  still.forEach(p=>{
    if(p.side==='buy'){const q=S.pos[p.mktId]||(S.pos[p.mktId]={sz:0,avg:0});
      q.avg=(q.avg*q.sz+p.usdc)/(q.sz+p.sz);q.sz+=p.sz}
    else S.cash+=p.proceeds;
  });
  S.vpos={};
  await syncChainVaults({fresh:true}).catch(()=>{});
  return true;
}

/* ---- wallet ------------------------------------------------------------- */

async function connectWallet(){
  const c=await chain();
  if(!c) throw new Error(
    DEMO_MODE
      ? 'Wallet connection is disabled during the tour.'
      : 'Chain support is not loaded. Run `npm run build:chain` and serve the site over HTTP.');
  return c.connect();
}

async function disconnectWallet(){
  const c=await chain();
  await c?.disconnect();
  chainCache.clear();
}
