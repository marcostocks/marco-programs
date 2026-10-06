<script>
(function(){
'use strict';

/* ════════════════════════════════════════════════════════════════════════
   The offering, the formatters and the three charts this page draws.

   Everything here is lifted from the platform page (src/parts/p3-data.js)
   and cut down to one vault. Where a rule was written against the dark
   theme only, it is noted and re-derived from a token instead — the
   platform runs dark by default, this page has to hold up in both.
   ═══════════════════════════════════════════════════════════════════════ */

/* Addresses are substituted at build time from shared/marco-artifacts/
   addresses.json — the same file marco-chain.js is built against, and the
   only place in this repo an address is allowed to come from. */
const CLUSTER='@CLUSTER@';
const VAULT_PROGRAM='@VAULT_PROGRAM@';
const USDC_MINT='@USDC_MINT@';
const explorer=a=>`https://explorer.solana.com/address/${a}`
  +(CLUSTER==='mainnet-beta'?'':`?cluster=${CLUSTER}`);
const explorerTx=sig=>`https://explorer.solana.com/tx/${sig}`
  +(CLUSTER==='mainnet-beta'?'':`?cluster=${CLUSTER}`);

/* ════════ the offering ════════ */
const VAULT_FEE_BPS=500;          // default until the program reports its own
const MIN_SUBSCRIPTION=100;

/* ════════ the offerings ════════
   Two of these are real vaults on the cluster; the rest are illustrative and
   say so on their own card. `chainId` is the whole distinction — an entry that
   carries one is read from the program and can be subscribed to, and an entry
   without one never pretends otherwise. */
const VAULTS=[
{id:'moon',ticker:'MOON',name:'Moonshot AI',nameCn:'月之暗面',
 sector:'AI / LLM research',hq:'Beijing, China',
 chainId:'moon-2026-s',logo:'moon',logoKind:'mask',
 ipoValuation:'$35B',entryPrice:1,status:'open',
 closesInDays:5.4,
 chains:'USDC on Solana',
 description:'Moonshot AI (月之暗面), founded in 2023 by Yang Zhilin and headquartered in Beijing, '
   +'builds the Kimi family of large language models — led by the open-weight Kimi K3, a roughly '
   +'2.8-trillion-parameter, ~1M-token-context model that approaches frontier Western systems on '
   +'coding and agentic benchmarks. Most revenue comes from a developer and enterprise API business '
   +'(over 70% of the total) alongside consumer Kimi subscriptions, and the company runs unusually '
   +'lean at around 300 people. Backed by Alibaba, Tencent, HongShan and Meituan, it is regarded as '
   +'one of the strongest of China’s frontier-model labs.',
 tagline:'Developer of the Kimi model family, preparing a Hong Kong listing.',
 illustrative:{vaultSize:9e5,raisedUsd:7.65e5},
 fin:[{y:'Jun 2026',rev:'~$300M',gp:'—',np:'—',m:'—'},
      {y:'Apr 2026',rev:'>$200M',gp:'—',np:'—',m:'—'},
      {y:'Mar 2026',rev:'~$100M',gp:'—',np:'—',m:'—'}],
 finFoot:'Moonshot AI is privately held and publishes no audited statements. The figures above are '
   +'annualised recurring revenue (ARR run-rate) — the metric its investors track — not audited '
   +'annual revenue: about $100M in March 2026, over $200M in April, and roughly $300M by June, with '
   +'the API more than 70% of the total. The company is understood to be loss-making, but no gross '
   +'margin or loss figure has been disclosed. Every figure here is a press- or analyst-sourced estimate.',
 finSource:'Bloomberg, TechCrunch, TechNode — press estimates; company is private',
 comparables:[
   {t:'MOON',i:'Moonshot AI',l:'Private (pre-IPO)',mc:'$35B',ev:'—',r:'CN',self:1},
   {t:'ZHIPU',i:'Zhipu AI',l:'HKEX',mc:'$112B',ev:'—',r:'CN'},
   {t:'DSEEK',i:'DeepSeek',l:'Private',mc:'$71B',ev:'—',r:'CN'},
   {t:'BABA',i:'Alibaba (Qwen)',l:'HKEX / NYSE',mc:'$300B',ev:'1.9×',r:'CN'},
   {t:'0700',i:'Tencent (Hunyuan)',l:'HKEX',mc:'$557B',ev:'4.9×',r:'CN'},
   {t:'OPENAI',i:'OpenAI',l:'Private',mc:'$852B',ev:'—',r:'US'},
   {t:'ANTH',i:'Anthropic',l:'Private',mc:'$965B',ev:'—',r:'US'}]},

{id:'byte',ticker:'BYTE',name:'ByteDance',logo:'byte',logoKind:'img',bg:'wave',
 chainId:'byte-2026-l',
 sector:'Consumer internet',hq:'Beijing, China',
 ipoValuation:'$550B',entryPrice:1,status:'open',
 closesInDays:6,
 chains:'USDC on Solana',
 description:'ByteDance operates TikTok internationally and Douyin in China, alongside the Toutiao '
   +'news app and a large advertising and e-commerce business. The recommendation engine is the '
   +'asset — the same ranking infrastructure runs across every property. Revenue reached an '
   +'estimated $155B in 2024 (up ~29%) and is tracking toward roughly $186B in 2025. In January 2026 '
   +'ByteDance moved TikTok’s U.S. business into a majority-American joint venture (Oracle, Silver '
   +'Lake, MGX), keeping about a 19.9% stake and clearing its largest regulatory overhang. It remains '
   +'privately held with no public listing — recent secondary sales mark it near $550B, making it the '
   +'world’s most valuable private company.',
 tagline:'Operator of TikTok, Douyin and Toutiao — privately held, no listing filed.',
 illustrative:{vaultSize:1e6,raisedUsd:0},
 fin:[{y:'2025e',rev:'~$186B',gp:'—',np:'—',m:'—'},
      {y:'2024',rev:'~$155B',gp:'—',np:'~$33B',m:'~21%'},
      {y:'2023',rev:'~$120B',gp:'—',np:'—',m:'—'}],
 finFoot:'ByteDance is privately held (Cayman-incorporated, Beijing operational HQ) and publishes no '
   +'audited statements. Revenue reached about $155B in 2024 (up ~29%) and is tracked near $186B for '
   +'2025; 2024 net profit was reported at roughly $33B (~21% margin). Gross profit is not disclosed, '
   +'and 2025 profitability is contested across sources, so it is shown as — rather than a single '
   +'figure. All numbers are press- and analyst-sourced, not company disclosures.',
 finSource:'Bloomberg, Reuters, SCMP — press estimates; company is private',
 comparables:[
   {t:'BYTE',i:'ByteDance',l:'Private (secondary)',mc:'$550B',ev:'3.5×',r:'CN',self:1},
   {t:'0700',i:'Tencent',l:'HKEX',mc:'$560B',ev:'7×',r:'CN'},
   {t:'PDD',i:'PDD Holdings',l:'NASDAQ',mc:'$129B',ev:'0.9×',r:'CN'},
   {t:'1024',i:'Kuaishou',l:'HKEX',mc:'$26B',ev:'1.0×',r:'CN'},
   {t:'META',i:'Meta Platforms',l:'NASDAQ',mc:'$1.51T',ev:'6.5×',r:'US'},
   {t:'GOOGL',i:'Alphabet',l:'NASDAQ',mc:'$4.3T',ev:'9.8×',r:'US'},
   {t:'SNAP',i:'Snap',l:'NYSE',mc:'$7.8B',ev:'1.3×',r:'US'}]},
];

/* Cap and commitments stay null on a chain-backed entry until the read lands,
   so the page never paints a figure it is about to replace. An entry with no
   chainId shows its illustrative figures from the start and is labelled. */
/* "August 3 2026" — month first, and no comma before the year. en-US puts the
   comma in, so the parts are assembled rather than formatted whole. */
const fmtLong=ms=>{const d=new Date(ms);
  return `${d.toLocaleDateString('en-US',{month:'long'})} ${d.getDate()} ${d.getFullYear()}`};
const fmtShortD=ms=>new Date(ms).toLocaleDateString('en-US',{month:'short',day:'numeric'});

VAULTS.forEach(v=>{
  v.deposits=[];                       // real DepositMade events, newest first
  /* A close date written as a literal goes stale the day after it is written.
     These are relative, and a chain-backed entry overwrites them anyway with
     the deadline the program will actually enforce. */
  if(v.closesInDays){
    const at=Date.now()+v.closesInDays*86400e3;
    v.close=new Date(at).toISOString();
    v.deadline=fmtLong(at);
    v.deadlineShort=fmtShortD(at);
  }
  if(v.opensInDays){
    const at=Date.now()+v.opensInDays*86400e3;
    v.opens=new Date(at).toISOString();
    v.openDate=fmtLong(at);
  }
  if(v.chainId){v.vaultSize=null;v.raisedUsd=null}
  else{v.vaultSize=v.illustrative.vaultSize;v.raisedUsd=v.illustrative.raisedUsd}
});
const V=id=>VAULTS.find(v=>v.id===id)||VAULTS[0];

/* Commentary for the ticker.
   These are NOT live. There is no social API behind this page, and the platform
   has none either — its "live" indicator tracks exchange price feeds, not posts.
   So they carry a source tag and never the live dot the chain items get, and
   the ticker's own label says which half is which. */
/* `v` names the offering a post is about; an untagged post is about the vault
   mechanism itself and belongs on every one of them. The landing ticker still
   carries the lot — it speaks for the whole page — but a detail page filters
   down to its own, or the Moonshot section would be reporting Unitree news. */
const SOCIAL=[
 {v:'moon',src:'Bloomberg',h:'@business',b:'Moonshot AI is in talks for a round valuing it near $30B — a third raise in six months.'},
 {src:'X',h:'@priyan',b:'Vault tokens redeem on net IPO proceeds, not spot. People keep marking these to the stock price.'},
 {v:'moon',src:'TechCrunch',h:'@techcrunch',b:'Kimi K3 released at 2.8 trillion parameters, narrowing the gap with frontier reasoning models.'},
 {v:'moon',src:'Reddit',h:'r/chinastocks',b:'Alibaba at ~36% of Moonshot is the part of this cap table nobody prices properly.'},
 {v:'moon',src:'X',h:'@ksato',b:'Open-weight distribution got Kimi into Western developer workflows that no domestic peer reaches.'},
 {v:'unitree',src:'Reuters',h:'@reuters',b:'Unitree has begun listing counselling for a STAR Market IPO, its adviser confirmed.'},
 {v:'unitree',src:'X',h:'@robotreport',b:'A sub-$20k general-purpose humanoid changes who can afford to experiment with one.'},
 {v:'moon',src:'The Information',h:'@theinformation',b:'ARR passed $200M in April on paid subscriptions and API usage, from near zero two years ago.'},
 {v:'red',src:'The Information',h:'@theinformation',b:'Xiaohongshu is testing checkout inside search results, which is where its commerce take rate has to come from.'},
 {v:'red',src:'X',h:'@linh_mkt',b:'RED is the only Chinese platform where Western brands buy discovery rather than performance.'},
 {v:'byte',src:'Reuters',h:'@reuters',b:'ByteDance revenue passed $155B for 2025, ahead of Meta on the same measure.'},
 {v:'byte',src:'X',h:'@stratechery_r',b:'TikTok divestiture risk is the whole discount here. Everything else about the business compounds.'},
 {v:'dseek',src:'Reuters',h:'@reuters',b:'DeepSeek has not confirmed a listing venue, and its adviser declined to comment on timing.'},
 {v:'dseek',src:'X',h:'@ml_infra',b:'The training-cost number is the entire story. Everything downstream of it reprices.'},
];

/* Product media per offering, built from art/media/<id>/. Stills arrive inlined;
   clips arrive as relative paths to moonshot/media/ and are fetched on demand. */
const MEDIA=@MEDIA@;

const STATUS={
  soon:{l:'Coming soon',cta:'Coming soon'},
  open:{l:'Open',cta:'Subscribe'},
  locked:{l:'Allocated',cta:'Allocated'},
  ipo:{l:'Listed',cta:'Awaiting redemption'},
  live:{l:'Redeeming',cta:'Redeem'},
  closed:{l:'Closed',cta:'Vault closed'}};
const LC=['Subscriptions open','Vault closed','IPO','Redemption period'];
const LCIDX={soon:0,open:0,locked:1,ipo:2,live:3,closed:1};

const RISKS=[
 {h:'You don’t own the stock — you own a vault token',d:'Vault tokens redeem for cash based on the vault’s net IPO proceeds, not the live stock price. You never directly hold the underlying shares unless you elect share delivery at listing.'},
 {h:'The IPO may be delayed, cancelled, or partly allocated',d:'The vault depends on the IPO listing on time, allocation actually being available, and the broker executing. Any of those can be delayed, reduced, or skipped. Undeployed capital is refunded at redemption, but timelines can move.'},
 {h:'Vault cap is the maximum, not a promise of allocation',d:'The vault cap is the maximum USDC the vault is sized to deploy. The broker or SPV may only receive a fraction of that allocation from the issuer. Only the deployed portion is exposed to the listing; the undeployed remainder is refunded pro-rata.'},
 {h:'Final redemption may be below what you paid',d:'Net redemption value is calculated after access costs, partner economics, FX, platform fees, and operational expenses. If the stock trades down on listing or if costs are high, redemption can be below your entry price.'},
 {h:'Settlement runs through brokers, banks, and FX',d:'IPO access, FX conversion, share sale, and fund return happen off-chain through partners. Misconduct, failure, or operational delays at any counterparty can affect allocation, settlement, or redemption.'},
 {h:'Smart contracts can fail',d:'Vault deposits, token issuance, and redemption all run through on-chain contracts. Audits reduce risk but don’t eliminate it.'},
 {h:'Regulatory posture varies by jurisdiction',d:'Vault tokens may be treated differently across countries. Access can be restricted based on your location, local securities laws, or evolving IPO and listing regulations.'}];

/* ════════ page state ════════ */
const S={
  /* 'loading' → 'chain' | 'illustrative' | 'simulated'. Drives what the page is
     allowed to claim about its own numbers. */
  source:'loading',
  wallet:null,walletKind:null,
  balance:null,          // real USDC once connected; null otherwise
  pos:null,              // {sub,tok,fee} once connected, or the simulated position
  view:'landing',        // 'landing' (the carousel) | 'vault' (the detail page)
  sel:'moon',            // which offering the detail view is showing
  slide:0,               // which card is at the front of the deck
  tab:'how',             // which detail sub-tab is showing
};

/* ════════ formatters ════════ */
const $=id=>document.getElementById(id);
const money=(n,d)=>'$'+Number(n||0).toLocaleString('en-US',
  {minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});
const qty=(n,d)=>Number(n||0).toLocaleString('en-US',
  {minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});
function compact(n){if(n===0)return '$0';if(n==null||!isFinite(n))return '—';
  return n>=1e12?'$'+(n/1e12).toFixed(2)+'T':n>=1e9?'$'+(n/1e9).toFixed(1)+'B'
    :n>=1e6?'$'+(n/1e6).toFixed(1)+'M':n>=1e3?'$'+(n/1e3).toFixed(1)+'K':money(n,0)}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/* A vault holding a real $12,000 against a $4M cap is 0.3% subscribed, and
   rounding that to a whole number prints "0%" beside "$12.0K committed" — which
   reads as a broken page rather than as an early one. Below 1%, keep a decimal. */
const pctS=p=>p==null?'—':(p>0&&p<1?p.toFixed(1):p.toFixed(0))+'%';
const cssv=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function rgba(c,a){if(c.startsWith('#')){const n=parseInt(c.slice(1),16);
  return`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`}return c}
function hash(s){let h=2166136261;for(const c of String(s))h=(h^c.charCodeAt(0))*16777619>>>0;return h}
const parseValB=s=>{const m=/([\d.]+)\s*([BTM])/i.exec(String(s||''));if(!m)return null;
  const n=parseFloat(m[1]),u=m[2].toUpperCase();return u==='T'?n*1000:u==='M'?n/1000:n};
/* parseValB works in units of $B, so a $240M figure is 0.24 — and a generic
   number formatter renders that axis tick as "0.2000". Anything measured in
   billions gets read back in the same currency notation the bar labels use. */
const valB=v=>!v?'0':v>=1000?'$'+(v%1000?(v/1000).toFixed(1):v/1000)+'T'
  :v>=1?'$'+(v%1?v.toFixed(1):v)+'B':'$'+Math.round(v*1000)+'M';
const short=a=>a?`${a.slice(0,4)}…${a.slice(-4)}`:'—';

/* USDC mark — Circle's blue disc with the broken ring and dollar glyph. */
const USDC_SVG=`<svg class="usdcMark" viewBox="0 0 32 32" aria-hidden="true">
  <circle cx="16" cy="16" r="16" fill="#2775CA"/>
  <path d="M19.4 6.6a10 10 0 0 1 0 18.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="butt"/>
  <path d="M12.6 25.4a10 10 0 0 1 0-18.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="butt"/>
  <path d="M16.9 15.1c-2-.5-2.6-.9-2.6-1.8 0-.9.8-1.5 2.1-1.5 1.2 0 2 .5 2.2 1.6h1.9c-.2-1.7-1.3-2.8-3-3.1V8.6h-2.1v1.7c-1.9.3-3.1 1.5-3.1 3.1 0 1.9 1.3 2.7 3.5 3.2 1.9.4 2.5.9 2.5 1.9 0 1-.9 1.6-2.3 1.6-1.5 0-2.4-.6-2.5-1.8h-2c.2 1.9 1.4 3 3.4 3.3v1.7h2.1v-1.7c2-.3 3.3-1.5 3.3-3.3 0-2-1.3-2.8-3.4-3.2z" fill="#fff"/>
</svg>`;
const usdc=label=>`<span class="usdc">${USDC_SVG}${label===undefined?'USDC':label}</span>`;

/* ════════ countdown ════════ */
function cdParts(iso){
  const ms=new Date(iso)-new Date();
  if(!(ms>0))return null;
  return{d:Math.floor(ms/864e5),h:Math.floor(ms/36e5)%24,m:Math.floor(ms/6e4)%60,s:Math.floor(ms/1e3)%60};
}
function cdShort(iso){const p=cdParts(iso);if(!p)return 'Closed';
  return p.d>0?`${p.d}d ${String(p.h).padStart(2,'0')}h`:`${String(p.h).padStart(2,'0')}h ${String(p.m).padStart(2,'0')}m`}
function tickCountdowns(){
  document.querySelectorAll('[data-cd]').forEach(e=>{e.textContent=cdShort(e.dataset.cd)});
  document.querySelectorAll('[data-cdfull]').forEach(e=>{
    const p=cdParts(e.dataset.cdfull);
    if(!p){e.textContent='Closed';return}
    e.innerHTML=[[p.d,'Days'],[p.h,'Hrs'],[p.m,'Min'],[p.s,'Sec']].map(u=>
      `<span class="cdu"><span class="cdv">${String(u[0]).padStart(2,'0')}</span><span class="cdl">${u[1]}</span></span>`).join('');
  });
}
const hasClock=v=>!!(v&&v.close&&cdParts(v.close));
/* A subscription countdown is only true while subscriptions are open. The
   program's funding deadline stays set after a vault seals, so without this a
   Claimable vault cheerfully counts down to a deadline that has already done
   its job. Scoped to chain-backed vaults: an illustrative one has no
   acceptingDeposits to speak of and keeps its seeded clock. */
const subsOpen=v=>hasClock(v)&&!(v.live&&v.acceptingDeposits===false);
// A vault that has not opened counts down to its opening, not to its close.
const hasOpensClock=v=>!!(v&&v.status==='soon'&&v.opens&&cdParts(v.opens));

/* ════════ toast ════════ */
let tT;
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');
  clearTimeout(tT);tT=setTimeout(()=>t.classList.remove('on'),4200)}

/* ════════ chart furniture ════════ */
function fitCanvas(cv){
  const w=cv.clientWidth,h=cv.clientHeight;
  if(!w||!h)return null;
  const r=cv.getBoundingClientRect();
  const css=(r.width/w)||1;
  const dpr=Math.min(4,css*(devicePixelRatio||1)*1.5);   // supersample so curves resolve
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  ctx.font='500 10px "Open Sauce Sans",sans-serif';
  return{ctx,w,h};
}
/* tick values plus the step, so labels carry enough precision to stay distinct */
function axisTicks(lo,hi,count){
  const rng=hi-lo;if(!(rng>0))return{v:[lo],step:1};
  const raw=rng/count,mag=Math.pow(10,Math.floor(Math.log10(raw))),n=raw/mag;
  const step=(n<1.5?1:n<3?2:n<7?5:10)*mag;
  const out=[];for(let v=Math.ceil(lo/step)*step;v<=hi+1e-9;v+=step)out.push(v);
  return{v:out.length?out:[lo,hi],step};
}
function axLabel(ctx,x,y,txt){
  ctx.strokeStyle=cssv('--line');ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+4,y);ctx.stroke();
  ctx.fillStyle=cssv('--mute');ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.font='500 10px "Open Sauce Sans",sans-serif';ctx.fillText(txt,x+8,y);
}
function barScale(ctx,x0,x1,y0,y1,lo,hi,fmt){
  ctx.strokeStyle=cssv('--line');ctx.fillStyle=cssv('--mute');ctx.lineWidth=1;
  ctx.textAlign='center';ctx.textBaseline='top';
  const T=axisTicks(lo,hi,4);
  T.v.forEach(v=>{
    const x=x0+(v-lo)/((hi-lo)||1)*(x1-x0);
    ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,y1);ctx.stroke();ctx.globalAlpha=1;
    ctx.fillText(fmt(v,T.step),x,y1+4)});
}
/* The platform fills its bars from a fixed silver ramp that starts at pure
   white — invisible against a white page. Here the two series are derived from
   the ink tokens instead, so the same chart reads in either theme: the primary
   series takes --ink, the secondary --mute. */
function barGrad(ctx,x0,y0,x1,y1,token){
  const c=cssv(token);
  const g=ctx.createLinearGradient(x0,y0,x1,y1);
  g.addColorStop(0,rgba(c,.95));
  g.addColorStop(1,rgba(c,.62));
  return g;
}

/* ── how the vault filled: cumulative commitments against the cap ────────
   Front-loaded with quiet stretches, seeded off the vault id so the shape is
   stable across re-renders. It is a shape, not a record — the endpoint is the
   only figure on it that is real. */
function subSeries(v){
  const days=42,end=v.raisedUsd||0,out=[];let acc=0;const wts=[];
  for(let d=0;d<days;d++){
    const r=(hash(v.id+'d'+d)%1000)/1000;
    wts.push(Math.pow(1-d/days,1.4)*(.25+r)+(r>.93?1.6*r:0));
  }
  const tot=wts.reduce((a,b)=>a+b,0)||1;
  for(let d=0;d<days;d++){acc+=end*wts[d]/tot;out.push(acc)}
  return out;
}
/* ── illustrative activity ─────────────────────────────────────────────────
   Deposits for an offering that has no vault on chain. Deterministic — seeded
   off the vault id, so the same rows come back on every render rather than
   reshuffling under the reader.

   These carry no signature, and the renderer gives them no explorer link: a
   link is a claim that the transaction exists, and there is nothing at the far
   end of this one. The section says they are illustrative, and they get the
   neutral dot rather than the live one the chain rows use. */
function simDeposits(v,n=6){
  const total=v.raisedUsd||0;
  if(!(total>0))return [];
  const B='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  const out=[];let acc=0;
  const wts=[];for(let i=0;i<n;i++)wts.push(.35+(hash(v.id+'w'+i)%1000)/1000);
  const tot=wts.reduce((a,b)=>a+b,0);
  for(let i=0;i<n;i++){
    // Round to whole hundreds so the figures read like subscriptions rather
    // than like generated noise, and give the last row the remainder so the
    // rows still sum to the raise on the card above them.
    const raw=total*wts[i]/tot;
    const amt=i===n-1?Math.max(0,total-acc):Math.round(raw/100)*100;
    acc+=amt;
    let w='';for(let k=0;k<44;k++)w+=B[hash(v.id+'a'+i+'k'+k)%B.length];
    // Spread back across the window, newest first, with uneven gaps.
    const hrs=1.5+i*7+(hash(v.id+'t'+i)%600)/100;
    out.push({wallet:w,amount:amt,at:Date.now()-hrs*3600e3,sim:true});
  }
  return out.filter(d=>d.amount>0);
}

function drawFill(cv,v){
  const cap=v.vaultSize;
  if(!(cap>0)||v.raisedUsd==null)return;
  const F=fitCanvas(cv);if(!F)return;const{ctx,w,h}=F;
  const s=subSeries(v);
  const padT=12,padB=6,padL=2,padR=8,pw=w-padL-padR,ph=h-padT-padB;
  if(pw<40||ph<24)return;
  const top=Math.max(cap,v.raisedUsd)/.72;
  const X=i=>padL+i*pw/(s.length-1),Y=val=>padT+ph-(val/top)*ph;
  const col=cssv('--up');
  ctx.font='500 10px "Open Sauce Sans",sans-serif';
  /* the cap is a rule the curve grows into: the label sits inline at the left
     and the dashed line picks up after it, so nothing is stacked or crowded */
  const capY=Y(cap),lab='Cap '+compact(cap);
  const lw=ctx.measureText(lab).width;
  ctx.fillStyle=cssv('--mute');ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.fillText(lab,padL,capY);
  ctx.save();ctx.setLineDash([2,5]);ctx.lineCap='round';
  ctx.strokeStyle=cssv('--line-2');ctx.lineWidth=1;   // token, not a dark-only literal
  ctx.beginPath();ctx.moveTo(padL+lw+10,capY);ctx.lineTo(padL+pw,capY);ctx.stroke();ctx.restore();

  const g=ctx.createLinearGradient(0,padT,0,padT+ph);
  g.addColorStop(0,rgba(col,.26));g.addColorStop(.72,rgba(col,.05));g.addColorStop(1,rgba(col,0));
  ctx.beginPath();ctx.moveTo(X(0),Y(s[0]));s.forEach((val,i)=>ctx.lineTo(X(i),Y(val)));
  ctx.lineTo(X(s.length-1),padT+ph);ctx.lineTo(X(0),padT+ph);ctx.closePath();
  ctx.fillStyle=g;ctx.fill();

  const ly=Y(s[s.length-1]),lx=X(s.length-1);
  ctx.beginPath();s.forEach((val,i)=>i?ctx.lineTo(X(i),Y(val)):ctx.moveTo(X(i),Y(val)));
  ctx.save();ctx.shadowColor=rgba(col,.5);ctx.shadowBlur=8;
  ctx.strokeStyle=col;ctx.lineWidth=1.9;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
  ctx.restore();

  const full=v.raisedUsd>=cap-.005;
  ctx.fillStyle=rgba(col,.16);ctx.beginPath();ctx.arc(lx,ly,6.5,0,7);ctx.fill();
  ctx.fillStyle=col;ctx.beginPath();ctx.arc(lx,ly,3,0,7);ctx.fill();
  ctx.fillStyle=cssv('--bg');ctx.beginPath();ctx.arc(lx,ly,1.2,0,7);ctx.fill();
  /* the committed figure rides the end of the curve rather than sitting in a corner */
  ctx.font='600 11px "Open Sauce Sans",sans-serif';
  ctx.fillStyle=full?cssv('--acc'):col;
  ctx.textAlign='right';ctx.textBaseline='bottom';
  ctx.fillText(compact(v.raisedUsd)+' · '+pctS(Math.min(100,v.raisedUsd/cap*100))
    +(full?' Fully subscribed':''),lx-11,Math.max(ly-9,padT+11));
}


/* ── radar ─────────────────────────────────────────────────────────────────
   Ported from the platform's vault detail (src/parts/p3-data.js). The frame
   shrinks its own radius until every label fits the canvas, which is what lets
   the same chart survive a narrow column without clipping its axis names. */
function radarFrame(ctx,w,h,labels,opt){
  opt=opt||{};
  const n=labels.length;if(n<3)return null;
  const cx=w/2,cy=h/2+(opt.dy==null?2:opt.dy),pad=opt.pad==null?12:opt.pad;
  const ang=i=>-Math.PI/2+i*2*Math.PI/n;
  ctx.font='600 10px "Open Sauce Sans",sans-serif';
  const lw=labels.map(l=>ctx.measureText(l).width);
  const fits=rad=>labels.every((l,i)=>{
    const a=ang(i),c=Math.cos(a),sn=Math.sin(a);
    const x=cx+c*(rad+pad),y=cy+sn*(rad+pad);
    const lx=c>.25?x:c<-.25?x-lw[i]:x-lw[i]/2;
    const t=sn>.4?y:sn<-.4?y-11:y-5.5;
    return lx>=2&&lx+lw[i]<=w-2&&t>=2&&t+11<=h-2;
  });
  let r=Math.max(26,Math.min(w/2,h/2)-pad);
  while(r>28&&!fits(r))r-=2;
  const pt=(i,f)=>[cx+Math.cos(ang(i))*r*f,cy+Math.sin(ang(i))*r*f];
  ctx.strokeStyle=cssv('--line');ctx.lineWidth=1;
  [.25,.5,.75,1].forEach(f=>{
    ctx.globalAlpha=f===1?.85:.42;ctx.beginPath();
    for(let i=0;i<n;i++){const p=pt(i,f);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])}
    ctx.closePath();ctx.stroke();ctx.globalAlpha=1;
  });
  ctx.globalAlpha=.42;
  for(let i=0;i<n;i++){const p=pt(i,1);
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(p[0],p[1]);ctx.stroke()}
  ctx.globalAlpha=1;
  return{cx,cy,r,pad,ang,pt};
}
function radarLabels(ctx,F,labels,style){
  labels.forEach((l,i)=>{
    const a=F.ang(i),c=Math.cos(a);
    const x=F.cx+c*(F.r+F.pad),y=F.cy+Math.sin(a)*(F.r+F.pad);
    ctx.textAlign=c>.25?'left':c<-.25?'right':'center';
    ctx.textBaseline=Math.sin(a)>.4?'top':Math.sin(a)<-.4?'bottom':'middle';
    const st=style?style(i):null;
    ctx.font=((st&&st.bold)?'600 ':'500 ')+'10px "Open Sauce Sans",sans-serif';
    ctx.fillStyle=(st&&st.col)||cssv('--mute');
    ctx.fillText(l,x,y);
  });
}
function radarPoly(ctx,F,fracs,stroke,fill,lw){
  ctx.beginPath();
  fracs.forEach((f,i)=>{const p=F.pt(i,Math.max(.04,f));i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])});
  ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill()}
  ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.lineJoin='round';ctx.stroke();
}

/* Market cap against the immediate comparable set, Chinese and US peers on the
   same web.

   LOG scale, and the caption says so. The set spans roughly $2B to $2T — two
   and a half orders of magnitude — and on a linear radar every peer but the
   largest collapses onto the centre point, which makes the chart a picture of
   one company rather than a comparison. */
const capRows=v=>(v.comparables||[])
  .map(c=>({t:c.t,name:c.i,own:!!c.self,val:parseValB(c.mc),label:c.mc}))
  .filter(r=>r.val>0);

function drawCapRadar(cv,v){
  const rows=capRows(v);
  if(rows.length<3)return;
  const G=fitCanvas(cv);if(!G)return;const{ctx,w,h}=G;
  const F=radarFrame(ctx,w,h,rows.map(r=>r.t));if(!F)return;

  const lo=Math.min(...rows.map(r=>r.val)),hi=Math.max(...rows.map(r=>r.val));
  // A little headroom either end so the smallest is not on the centre and the
  // largest is not welded to the outer ring.
  const a=Math.log10(lo*0.55),b=Math.log10(hi*1.6);
  const frac=x=>(Math.log10(x)-a)/((b-a)||1);

  /* Two tones, and the chart asks one question: where does this offering sit
     among the companies it is measured against. The peers are the same neutral
     the web is drawn in, so they read as the scale rather than as competing
     series; only the offering carries colour. */
  const own=cssv('--ser-1'),ink=cssv('--ink-2');
  radarPoly(ctx,F,rows.map(r=>frac(r.val)),rgba(ink,.62),rgba(ink,.10),1.5);

  rows.forEach((r,i)=>{
    const p=F.pt(i,Math.max(.04,frac(r.val)));
    ctx.fillStyle=r.own?own:ink;
    ctx.beginPath();ctx.arc(p[0],p[1],r.own?4.4:2.8,0,7);ctx.fill();
    // Punched through, so the offering is the one ring on the web — legible
    // even where a peer happens to land on the same spoke.
    if(r.own){ctx.fillStyle=cssv('--bg');ctx.beginPath();ctx.arc(p[0],p[1],1.7,0,7);ctx.fill()}
  });

  radarLabels(ctx,F,rows.map(r=>r.t),i=>({
    col:rows[i].own?own:cssv('--mute'),bold:rows[i].own}));
}

/* ── grouped bars: revenue against gross profit, by reported year ── */
function drawFinBars(cv,fin){
  const F=fitCanvas(cv);if(!F)return;const{ctx,w,h}=F;
  const rows=(fin||[]).slice().reverse().map(r=>({y:r.y,rev:parseValB(r.rev),gp:parseValB(r.gp),
    revL:r.rev,gpL:r.gp})).filter(r=>r.rev!=null);
  if(rows.length<2)return;
  const padT=24,padB=24,padL=6,padR=58,pw=w-padL-padR,ph=h-padT-padB;
  if(pw<60||ph<40)return;
  const top=Math.max(...rows.map(r=>r.rev)),n=rows.length,slot=pw/n;
  const T=axisTicks(0,top,3),mx=Math.max(top*1.06,T.v[T.v.length-1]);
  const Y=v=>padT+ph-v/mx*ph;
  T.v.forEach(v=>axLabel(ctx,padL+pw,Y(v),valB(v)));
  const bw=Math.min(44,slot*.24),gap=5;
  rows.forEach((r,i)=>{
    const cx=padL+slot*(i+.5);
    /* Two series, two hues, assigned in fixed order — revenue is always
       --ser-1 and gross profit always --ser-2, whichever is taller in a given
       year. The value labels stay on ink tokens: the bar beneath carries the
       identity, and colouring the number as well only costs legibility. */
    [[r.rev,r.revL,-1,'--ser-1'],[r.gp,r.gpL,1,'--ser-2']].forEach(([v,lab,side,token])=>{
      if(v==null)return;
      const y=Y(v),bh=Math.max(2,padT+ph-y),x=cx+(side<0?-bw-gap/2:gap/2);
      ctx.fillStyle=barGrad(ctx,x,y,x+bw,padT+ph,token);
      ctx.beginPath();ctx.roundRect(x,y,bw,bh,2);ctx.fill();
      ctx.font=(side<0?'600 ':'500 ')+'10px "Open Sauce Sans",sans-serif';
      ctx.textAlign='center';ctx.textBaseline='bottom';
      ctx.fillStyle=side<0?cssv('--ink'):cssv('--ink-2');ctx.fillText(lab,x+bw/2,y-5);
    });
    ctx.font='500 10px "Open Sauce Sans",sans-serif';ctx.textAlign='center';
    ctx.fillStyle=cssv('--mute');ctx.textBaseline='top';ctx.fillText(r.y,cx,padT+ph+7);
  });
  ctx.strokeStyle=cssv('--line');ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(padL,padT+ph+.5);ctx.lineTo(padL+pw,padT+ph+.5);ctx.stroke();
}

/* ── EV/revenue across the comparable set, the offering highlighted ── */
function drawMultiples(cv,comps){
  const F=fitCanvas(cv);if(!F)return;const{ctx,w,h}=F;
  const rows=(comps||[]).map(c=>({t:c.t,self:!!c.self,
    v:parseFloat(String(c.ev).replace(/[^\d.]/g,'')),lab:c.ev}))
    .filter(r=>isFinite(r.v)&&r.v>0);
  if(rows.length<2)return;
  const padL=68,padR=62,padB=20,x0=padL,x1=w-padR;
  if(x1-x0<60)return;
  const mx=Math.max(...rows.map(r=>r.v));
  // Multiples are whole numbers on this scale; "20.00×" is just noise.
  barScale(ctx,x0,x1,2,h-padB,0,mx,(v,st)=>(st>=1?v.toFixed(0):v.toFixed(1))+'×');
  const rowH=Math.min(30,(h-padB-4)/rows.length),bh=Math.min(14,rowH-9);
  /* One measure, not two series — so no categorical palette here: the offering
     is picked out and the peers stay neutral. Green rather than the radar's
     blue, by request; note that --up is otherwise the page's "state is good"
     colour, so a low multiple in green reads as favourable whether or not it
     is. The label beside each bar carries the number regardless. */
  const acc=cssv('--up'),peer=cssv('--mute');
  rows.forEach((r,i)=>{
    const y=4+i*rowH+(rowH-bh)/2-1,bw=Math.max(1,r.v/mx*(x1-x0));
    const g=ctx.createLinearGradient(x0,0,x0+bw,0);
    if(r.self){g.addColorStop(0,rgba(acc,.55));g.addColorStop(1,rgba(acc,1))}
    else{g.addColorStop(0,rgba(peer,.24));g.addColorStop(1,rgba(peer,.6))}
    ctx.fillStyle=g;ctx.fillRect(x0,y,bw,bh);
    ctx.font=(r.self?'600 ':'500 ')+'11px "Open Sauce Sans",sans-serif';
    ctx.textBaseline='middle';ctx.textAlign='right';
    ctx.fillStyle=r.self?cssv('--ink'):cssv('--ink-2');ctx.fillText(r.t,padL-10,y+bh/2);
    ctx.textAlign='left';ctx.fillStyle=r.self?acc:cssv('--mute');
    ctx.fillText(r.lab,x0+bw+8,y+bh/2);
  });
  ctx.strokeStyle=cssv('--line-2');ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(x0,2);ctx.lineTo(x0,h-padB);ctx.stroke();
}
