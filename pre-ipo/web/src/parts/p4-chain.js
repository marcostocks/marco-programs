
/* ════════════════════════ chain client — lazy, optional ════════════════════════

   Bridges the page to the marco-vault program on Solana. Adapted from the
   platform's src/parts/p3b-chain.js.

   The page has to hold up in four situations, and it says which one it is in
   rather than blurring them together:

     - the bundle is absent (opened straight off disk)  → simulated
     - the bundle is present but no wallet is connected → REAL, read-only.
       Vault state is public; getVault() builds a program with no signer.
     - the bundle is present and the vault is not on this cluster → illustrative
     - a wallet is connected → real position, real balance, holder-signed writes

   Nothing is ever written on a chain-backed vault without a wallet. If the
   bundle is there and no wallet is, the page asks for one instead of quietly
   simulating a subscription that never happened.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── inside the Marco platform ─────────────────────────────────────────────
   The platform (index.html) runs this page in a same-origin frame and exposes
   window.MarcoShell; the registration is at the end of p5-app.js. Wallet
   extensions do not reliably inject into frames, so the page borrows the
   shell's provider — the same Phantom, the same approval. */
const SHELL=(()=>{try{return window.parent!==window&&window.parent.MarcoShell||null}catch{return null}})();
let shellSaid=false;   // the wallet state last reported to the shell
if(SHELL){
  document.documentElement.classList.add('embedded');
  // Read through at call time rather than copied, so a wallet that injects
  // into the shell after this frame loaded is still found.
  for(const k of ['solana','phantom'])
    if(!(k in window))try{Object.defineProperty(window,k,{configurable:true,get:()=>window.parent[k]})}catch{}
}

const CHAIN_SRC='@CHAIN_SRC@';   // beside this page, or the platform's shared copy — set by the build

let chainPromise=null;

/** Load marco-chain.js once. Resolves to null when it is absent or blocked. */
function loadChain(){
  if(chainPromise)return chainPromise;
  chainPromise=new Promise(res=>{
    const s=document.createElement('script');
    s.src=CHAIN_SRC;
    s.onload=()=>res(window.MarcoChain||null);
    // An absent bundle is an expected state, not an error: this page is also
    // meant to survive being opened as a single file with nothing beside it.
    s.onerror=()=>res(null);
    document.head.appendChild(s);
  });
  return chainPromise;
}

/** The chain client if one is usable, else null. Never throws. */
async function chain(){
  try{ return await loadChain() }catch{ return null }
}

/** True once a wallet is connected. */
const chainLive=()=>!!window.MarcoChain?.connected;

/* The on-chain phase drives what the page offers. `Funding` accepts deposits
   and `Claimable` opens redemption, so mapping the wrong phase to either would
   show a button the program will reject. */
const PHASE_STATUS={
  Scheduled:'soon',
  Funding:'open',
  Sealed:'locked', Sourcing:'locked', Sourced:'locked', Deployed:'locked',
  Live:'ipo', Realized:'ipo',
  Claimable:'live', Winding:'live',
  Concluded:'closed', Cancelled:'closed', Refunded:'closed',
};



/** Fall back to this entry's illustrative figures. */
function applyIllustrative(v){
  v.vaultSize=v.illustrative.vaultSize;
  v.raisedUsd=v.illustrative.raisedUsd;
  v.acceptingDeposits=false;
  v.claimable=false;
  v.live=false;
}

/**
 * Copy live state onto one offering.
 *
 * `live` is the flag everything downstream reads: an entry is live only when it
 * carries a chainId AND that vault was found on this cluster. Anything else
 * keeps its illustrative figures and is labelled as such on its own card, so a
 * carousel of four never implies four real vaults.
 */
async function syncVault(v,{fresh=false}={}){
  /* This gained its `v` parameter when the page went from one vault to a list,
     and several callers kept passing the options object as the first argument.
     `{fresh:true}` has no chainId, so it fell straight into the illustrative
     branch and died on `v.illustrative.vaultSize` — an error about vault size
     from a function that had been handed no vault at all. Fail by name. */
  if(!v||!('id' in v))throw new Error(
    `syncVault needs a vault, got ${JSON.stringify(v)} — pass the vault first, options second.`);
  if(!v.chainId){applyIllustrative(v);return false}

  const c=await chain();
  if(!c){S.source='simulated';applyIllustrative(v);return false}
  S.source='chain';

  if(fresh||!v._state){
    try{ v._state=await c.getVault(v.chainId) }catch{ v._state=null }
  }
  const st=v._state;
  if(!st){applyIllustrative(v);return false}

  const before=[v.raisedUsd,v.vaultSize,v.status,v.nrv].join('|');
  /* While the book is open, the vault's size is its cap and the percentage is
     progress toward it. Once it seals, the deal is whatever it raised — the cap
     was a ceiling that stopped mattering the moment subscriptions closed, and
     showing a sealed deal as "71% subscribed" describes a book that no longer
     exists. The cap stays on `chainCap` for the Terms table. */
  v.chainCap=st.cap;
  v.vaultSize=st.acceptingDeposits?st.cap:st.totalDeposits;
  v.raisedUsd=st.totalDeposits;
  v.status=PHASE_STATUS[st.phase]??v.status;
  v.chainPhase=st.phase;
  // The fee the vault was created with, and when it is charged — so the quote
  // matches what the program will mint rather than a hard-coded default.
  v.chainFeeBps=st.feeBps;
  v.chainFeeAtExit=st.feeAtExit===true;
  v.chainMinDeposit=st.minDeposit;
  v.acceptingDeposits=st.acceptingDeposits;
  v.claimable=st.claimable;
  v.vaultAddress=st.address;
  v.live=true;

  // Redemption value per token, straight from the program.
  if(st.totalShares>0&&st.redeemable>0)v.nrv=st.redeemable/st.totalShares;

  // The deadline the program will actually enforce, not the one in the copy.
  if(st.fundingDeadline>0){
    v.close=new Date(st.fundingDeadline).toISOString();
    v.deadline=fmtLong(st.fundingDeadline);
    v.deadlineShort=fmtShortD(st.fundingDeadline);
  }
  return before!==[v.raisedUsd,v.vaultSize,v.status,v.nrv].join('|');
}

/** Every chain-backed offering at once — what the carousel needs. */
async function syncAll(opts){
  const backed=VAULTS.filter(v=>v.chainId);
  VAULTS.filter(v=>!v.chainId).forEach(applyIllustrative);
  if(!backed.length){S.source='simulated';return false}
  const changed=await Promise.all(backed.map(v=>syncVault(v,opts).catch(()=>false)));
  return changed.some(Boolean);
}

const invalidateVault=v=>{if(v)v._state=null};

/** The connected wallet's position in one offering. */
/* `pos` has three states, and they are not the same thing: an object is a known
   position, `null` is a known-empty one, and `undefined` is "the read failed and
   we do not know". Collapsing the third into the second is how a rate-limited
   RPC came to tell a holder they owned nothing. */
async function refreshPosition(v,{balance=true}={}){
  if(!chainLive()||!v?.chainId){if(v)v.pos=null;return}
  try{
    const p=await window.MarcoChain.getPosition(v.chainId);
    v.pos=p?{sub:p.deposited,tok:p.shares,redeemed:p.redeemed,
             fee:feeFromChain(v,p.deposited,p.shares)}:null;
  }catch{ v.pos=undefined }
  // The balance is one number for the whole wallet, so a bulk refresh reads it
  // once rather than re-fetching it alongside every vault.
  if(balance){try{ S.balance=await window.MarcoChain.getUsdcBalance() }catch{ S.balance=null }}
}

/* Every chain-backed vault's position for the connected wallet. Sequential
   rather than parallel: the public RPC throttles a burst of BuyerState reads
   hard, and a 429 here would leave the portfolio claiming positions the holder
   does not have — or worse, missing ones they do. Each failure is left as
   `undefined` so the page can say "unknown" for that row alone rather than
   dropping it. */
async function refreshAllPositions(onProgress){
  if(!chainLive())return;
  // The wallet balance once, not once per vault.
  try{ S.balance=await window.MarcoChain.getUsdcBalance() }catch{ S.balance=null }
  /* In parallel, each with its own patient retry, and re-rendering as each
     lands. Serial-with-three-tries was why only Moonshot showed on the first
     open: it resolved, then the rapid follow-up reads got 429'd, exhausted
     their retries, stayed `undefined`, and dropped out — so the rest appeared
     only after a manual refresh, once the RPC had cooled off. Now a slow vault
     no longer blocks the others, none is abandoned after three tries, and each
     position renders the moment it arrives. */
  await Promise.all(VAULTS.filter(v=>v.chainId).map(async v=>{
    for(let attempt=0;attempt<6;attempt++){
      await refreshPosition(v,{balance:false});
      if(v.pos!==undefined)break;
      await new Promise(r=>setTimeout(r,300*(attempt+1)));
    }
    if(onProgress)onProgress();
  }));
}

/* This wallet's own deposits and redemptions across every chain-backed vault,
   newest first. Sequential and best-effort for the same reason as above; a
   vault that will not answer is left out of the list rather than failing it. */
/* History cache, keyed by wallet+vault. Cleared wholesale on disconnect and
   per vault after a subscribe or redeem, so a fresh transaction always shows. */
const _histCache=new Map();
function invalidateHistory(v){ if(v)_histCache.delete(`${S.wallet||''}|${v.chainId}`); else _histCache.clear(); }

/* A decoded transaction never changes — devnet history is immutable — so once a
   signature is parsed it is cached in localStorage for good, keyed by signature.
   The signature LIST is still re-read every load (it grows with each new
   subscription), but the expensive getTransaction+decode behind each one is paid
   only once, ever: repeat opens cost only the light signature calls, and a page
   reload no longer refetches a thing. The value is the raw parsed rows, without
   the vault tag, since that is added per-call from the signature's own vault. */
const _SIGV='mh1';                       // bump to invalidate the stored format
function sigGet(sig){
  try{ const s=localStorage.getItem(_SIGV+':'+sig); return s?JSON.parse(s):null; }
  catch{ return null; }
}
function sigPut(sig,rows){
  try{ localStorage.setItem(_SIGV+':'+sig, JSON.stringify(rows)); }
  catch{ /* private mode or quota — the in-memory cache still covers the session */ }
}

/* Only one history load renders at a time. Opening the portfolio can kick off
   two (an immediate one, then another once positions settle); a generation
   token lets the later one supersede the earlier so they do not both paint. */
let _histGen=0;

async function loadHistory(onRow){
  if(!chainLive()||!S.wallet)return [];
  const gen=++_histGen, stale=()=>gen!==_histGen;
  /* Only the vaults this wallet has actually touched. Positions were read
     first, so we already know which those are — querying a vault with no
     BuyerState is a wasted round trip on the RPC that is the whole bottleneck
     here. A position we could not read (undefined) is kept in, since we cannot
     rule it out; its buyer PDA simply returns no signatures. */
  const mine=VAULTS.filter(v=>v.chainId&&(v.pos===undefined
    ||(v.pos&&((v.pos.sub||0)>0||(v.pos.tok||0)>0||(v.pos.redeemed||0)>0))));
  const all=[], seen=new Set();
  const add=(r,v)=>{const k=r.signature+r.kind; if(seen.has(k))return; seen.add(k); all.push({...r,v});};
  const sorted=()=>all.slice().sort((a,b)=>(b.at??0)-(a.at??0));
  const emit=()=>{ if(!stale()&&onRow)onRow(sorted()); };

  /* Cached vaults render instantly; the rest are cold and get streamed. Cached
     per wallet+vault, so re-opening the portfolio is instant; a new subscription
     or redemption clears the entry (see invalidateHistory). */
  const cold=[];
  for(const v of mine){
    const c=_histCache.get(`${S.wallet||''}|${v.chainId}`);
    if(c)c.forEach(r=>add(r,v)); else cold.push(v);
  }
  emit();

  /* The cheap half: one getSignaturesForAddress per cold vault, in parallel —
     each is a single light call and already carries blockTime. Merge them into
     one list so the heavy fetches below run newest-first across every vault. */
  const sigs=[], bucket=new Map();
  await Promise.all(cold.map(async v=>{
    try{
      const list=await window.MarcoChain.mySignatures(v.chainId);
      bucket.set(v,[]);            // reachable ⇒ cacheable once fully read
      list.forEach(s=>sigs.push({...s,v}));
    }catch{ /* leave this vault out rather than fail the whole history */ }
  }));
  if(stale())return sorted();
  sigs.sort((a,b)=>(b.at??0)-(a.at??0));

  /* The heavy half, newest first: for each signature use the cached decode if we
     have one (instant), else fetch and decode it, rate-gated. A small pool
     overlaps the fetches; the render re-sorts on every row, so the list stays
     newest-first whatever order they land in. On a warm cache every signature
     hits localStorage and the whole history paints without a single round trip. */
  let idx=0;
  const worker=async()=>{
    while(idx<sigs.length){
      if(stale())return;
      const s=sigs[idx++];
      let rows=sigGet(s.signature);
      if(!rows){
        if(stale())return;
        /* parseTx paces itself against the shared client rate limit, so the pool
           can stay wide without a second gate here doubling the wait. */
        try{ rows=await window.MarcoChain.parseTx(s.signature); sigPut(s.signature,rows); }
        catch{ continue; /* skip a tx that will not load rather than stall the rest */ }
      }
      rows.forEach(r=>{add(r,s.v); bucket.get(s.v)?.push(r);});
      if(rows.length)emit();
    }
  };
  await Promise.all(Array.from({length:Math.min(8,sigs.length)},worker));
  /* Cache each cold vault now that it is fully read (only vaults whose signatures
     came back are in the bucket, so a throttled-out vault is not cached empty). */
  if(!stale())for(const v of cold){
    const b=bucket.get(v); if(b)_histCache.set(`${S.wallet||''}|${v.chainId}`,b);
  }
  return sorted();
}

/* ---- wallet ------------------------------------------------------------- */

/**
 * Why no wallet was found.
 *
 * The client's own message is "install Phantom, Solflare or Backpack", which is
 * the wrong advice in the most common case: a wallet IS installed and simply
 * cannot inject. Chrome does not run extensions on file:// pages unless the
 * user has ticked "Allow access to file URLs", so a page opened straight off
 * disk sees no provider however many wallets are installed.
 */
function noWalletReason(){
  if(location.protocol==='file:')
    return 'This page was opened from disk, and browser extensions cannot inject into '
      +'file:// pages — so your wallet is invisible to it even when installed. Serve it '
      +'over HTTP (npm run serve) and open it at localhost instead.';
  return 'No Solana wallet is injected on this page. If one is installed, reload the tab — '
    +'extensions only inject at load — and check the extension is enabled for this site.';
}

async function connectWallet(){
  const c=await chain();
  if(!c)throw new Error(
    'Chain support is not loaded — serve this page over HTTP with marco-chain.js beside it.');
  // Ask before connecting, so the diagnosis is ours rather than the generic one.
  if(!c.available().length)throw new Error(noWalletReason());
  return c.connect();
}

async function disconnectWallet(){
  const c=await chain();
  await c?.disconnect();
  VAULTS.forEach(v=>{v._state=null;v.pos=null});
  S.balance=null;
}

/* ════════ fee arithmetic ════════
   The protocol fee is either a front-end load on the subscription or a skim on
   the redemption, and which one it is comes from the program. Both branches are
   here because the same page has to quote either configuration correctly. */

const feeBpsOf=v=>v.chainFeeBps??VAULT_FEE_BPS;
/* Where the fee lands. An exit-fee vault mints claim tokens 1:1 against the
   GROSS deposit and takes the fee out of the redemption; an entry-fee vault
   takes it off the top and mints the net. Exit-fee until the program says
   otherwise — that is how the deployed vaults are configured. */
const feeAtExitOf=v=>v.chainFeeAtExit??true;

/* What a subscription mints. Exit-fee: the full gross, no fee now. Entry-fee:
   gross less the fee. `fee` is what is charged NOW (0 for exit-fee). */
function entrySplit(v,gross){
  if(feeAtExitOf(v))return{fee:0,net:gross};
  const fee=gross*feeBpsOf(v)/10000;
  return{fee,net:gross-fee};
}
/* The fee deducted at redemption (0 for an entry-fee vault, which already
   charged it). The base is the redemption value — what you actually withdraw —
   so it scales with the outcome: on a 1,000 subscription at 5%, a flat deal
   pays 950, a +20% deal pays 1,140 and a −20% deal pays 760. */
const exitFeeOn=(v,grossPayout)=>feeAtExitOf(v)?grossPayout*feeBpsOf(v)/10000:0;
/* Chain reads give gross deposited and net shares; on an entry-fee vault the
   difference is the fee already paid. An exit-fee vault mints 1:1, so nothing
   has been paid yet — the fee is owed at redemption. */
const feeFromChain=(v,deposited,shares)=>
  feeAtExitOf(v)?0:Math.max(0,deposited-shares*(v.entryPrice||1));


/* Subscription stops at the vault cap, which is what marco-vault does:
   `deposit` accepts min(intent, cap remaining, per-address remaining) and mints
   claim tokens against the net. There is no oversubscription tier on-chain, so
   there is none here — a subscriber who gets in gets the allocation. */
const roomLeft=v=>v.vaultSize==null?null:Math.max(0,v.vaultSize-(v.raisedUsd||0));
const subPct=v=>v.vaultSize?Math.min(100,(v.raisedUsd||0)/v.vaultSize*100):null;
const minSub=v=>v.chainMinDeposit>0?v.chainMinDeposit:MIN_SUBSCRIPTION;
