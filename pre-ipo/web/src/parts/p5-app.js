
/* ════════════════════════════ render ════════════════════════════ */

/** The offering the detail view is showing. */
const cur=()=>V(S.sel);

/* Spendable USDC. Real when a wallet is connected; the simulation's own float
   when there is no chain bundle at all; unknown otherwise — and "unknown" is
   rendered as unknown rather than as zero. */
let simCash=250000;
const spendable=()=>S.source==='simulated'?simCash:(chainLive()?S.balance:null);

const tick=()=>'m'+cur().ticker;
const isTestnet=()=>CLUSTER!=='mainnet-beta';
const addrLink=a=>`<a class="lnk addr num" href="${explorer(a)}" target="_blank"
  rel="noopener noreferrer" title="${esc(a)}">${esc(short(a))}</a>`;

/** An offering's mark. Falls back to the ticker letter when no logo is set, so
    adding an offering never leaves a hole. */
function logoHTML(v,cls){
  if(!v.logo)return `<span class="mark fMark2">${esc(v.ticker[0])}</span>`;
  return `<span class="${cls} ${v.logoKind==='img'?'img':'mask'}" aria-hidden="true"
    style="--logo:var(--logo-${esc(v.logo)})"></span>`;
}

/* ── the carousel ──────────────────────────────────────────────────────────
   The offerings side by side, one card per vault, scroll-snapped. A card is
   the way into its own detail page — the click-through the page had before —
   and the arrows and dots are for people not on a trackpad. */
function cardHTML(v){
  const st=STATUS[v.status]||STATUS.open;
  const open=v.status==='open'&&v.live;
  const pct=subPct(v),room=roomLeft(v);
  return `<article class="card hero vfeat lift snapCard${v.status==='soon'?' soon':''}"
       data-v="${esc(v.id)}"
       role="link" tabindex="0" aria-label="Open ${esc(v.name)}">
    <div class="fhead">
      <span class="badgeRow">
        <span class="badge${v.status==='open'||v.status==='live'?' live':''}">${esc(st.l)}</span>
      </span>
      <span class="fmark">
        ${logoHTML(v,'fLogo')}
        <span class="fname">${esc(v.name)}</span>
      </span>
      <div class="vdesc">${esc(v.tagline)}</div>
    </div>
    ${hasOpensClock(v)?`<div class="fhClock">
      <div class="fhClockK">Subscription opens in</div>
      <div class="cdn fhCd" data-cdfull="${esc(v.opens)}"></div>
      <div class="fhClockD">${esc(v.openDate||'')}</div>
    </div>`:subsOpen(v)?`<div class="fhClock">
      <div class="fhClockK">Subscription closes in</div>
      <div class="cdn fhCd" data-cdfull="${esc(v.close)}"></div>
      <div class="fhClockD">${esc(v.deadline||'')}</div>
    </div>`:`<div class="fhClock">
      <div class="fhClockK">Status</div>
      <div class="fhClosed">${esc(st.l)}</div>
      <div class="fhClockD">${esc(v.deadline||'—')}</div>
    </div>`}
    ${/* data-roll marks the two figures that move as money arrives, and holds
          the target text — the element's own contents get replaced by reels
          once it rolls, so the value has to survive somewhere else. */''}
    <div class="fstats">${[
      ['Valuation',v.ipoValuation,'','pre-money',''],
      ['Vault size',compact(v.vaultSize),'',room==null?'':compact(room)+' remaining','room'],
      ['Subscribed',pctS(pct),'pct',v.raisedUsd==null?'':compact(v.raisedUsd)+' committed','']
    ].map(x=>`<div class="hstat"><div class="hk">${esc(x[0])}</div>
      <div class="hv num"${x[2]?` data-roll="${esc(x[1])}"`:''}>${x[1]}</div>
      <div class="hsub num"${x[4]&&x[3]?` data-roll="${esc(x[3])}"`:''}>${x[3]}</div></div>`)
    .join('')}</div>
    <button class="btn p featCta" data-cta="${esc(v.id)}" type="button">${
      open?'Subscribe':'View the offering'}</button>
  </article>`;
}

/* One layer per distinct scene, not per offering — cards naming the same scene
   share a layer. Built once; only opacity moves after that. */
function renderScenes(){
  const el=$('landBg');
  if(el.dataset.built)return;
  const names=[...new Set(VAULTS.map(v=>v.bg).filter(Boolean))];
  el.innerHTML=names.map(n=>
    `<div class="bgScene" data-scene="${esc(n)}" style="background-image:var(--bg-${esc(n)})"></div>`
  ).join('');
  el.dataset.built='1';
}

/* The run of consecutive cards a scene covers, in card indices. A scene is a
   stretch of the strip rather than a property of one card: it has to stay at
   full strength between two cards that share it, and distance-to-the-nearest-
   card cannot express that — halfway between them neither card is centred, so
   the backdrop would dip on every pass. Measuring against the whole span gives
   a distance of zero anywhere inside it, and a ramp only at its two ends. */
let SCENE_RUNS=[];
function sceneRuns(){
  SCENE_RUNS=[];
  VAULTS.forEach((v,i)=>{
    if(!v.bg)return;
    const last=SCENE_RUNS[SCENE_RUNS.length-1];
    if(last&&last.scene===v.bg&&last.hi===i-1)last.hi=i;
    else SCENE_RUNS.push({scene:v.bg,lo:i,hi:i});
  });
}

function renderCarousel(){
  renderScenes();
  sceneRuns();
  $('track').innerHTML=VAULTS.map(cardHTML).join('');
  $('dots').innerHTML=VAULTS.map((v,i)=>
    `<button class="dot${i===S.slide?' on':''}" data-i="${i}" type="button"
       aria-label="Show ${esc(v.name)}"></button>`).join('');

  $('track').querySelectorAll('.snapCard').forEach((card,i)=>{
    const id=card.dataset.v;
    // A card tucked behind comes forward; the centred one opens.
    card.onclick=e=>{
      if(i!==S.slide)return slideTo(i);
      if(!e.target.closest('[data-cta]'))openVault(id);
    };
    card.onkeydown=e=>{
      if(e.target!==card)return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();i===S.slide?openVault(id):slideTo(i)}};
  });
  $('track').querySelectorAll('[data-cta]').forEach(b=>{
    b.onclick=e=>{e.stopPropagation();openVault(b.dataset.cta)}});
  $('dots').querySelectorAll('.dot').forEach(d=>{d.onclick=()=>slideTo(+d.dataset.i)});

  markCentred();
}

/* Which card the scroll has settled nearest to. Driven by the scroll position
   rather than tracked separately, so a swipe, the arrows and the dots all end
   up agreeing. */
function centredIndex(){
  const t=$('track'),cards=[...t.querySelectorAll('.snapCard')];
  if(!cards.length)return S.slide;
  /* On the detail view the strip is display:none, so every offsetLeft, every
     offsetWidth and clientWidth read back 0 — every card is then equidistant
     from the centre and the loop below confidently answers "the first one".
     That is how a ByteDance subscription became a Moonshot one: the answer
     looks valid and silently reselects the first offering. A strip with no
     width knows nothing; say so. */
  if(!t.clientWidth)return S.slide;
  const mid=t.scrollLeft+t.clientWidth/2;
  let best=0,bestD=Infinity;
  cards.forEach((c,i)=>{
    const d=Math.abs(c.offsetLeft+c.offsetWidth/2-mid);
    if(d<bestD){bestD=d;best=i}
  });
  return best;
}
function markCentred(){
  const cards=$('track').querySelectorAll('.snapCard');
  cards.forEach((c,i)=>{
    c.classList.toggle('on',i===S.slide);
    // Only the centred card is in the tab order; the rest are reachable by the
    // arrows and dots, which is less noise for a keyboard user.
    c.tabIndex=i===S.slide?0:-1;
  });
  // Only the card you are looking at rolls, and only when it arrives — this
  // runs on a change of centre, not on every frame of the scroll.
  rollCard(cards[S.slide]);
  paintCards();
}

/* ── slot-machine rollup ──────────────────────────────────────────────────
   The strip is three 0–9 cycles deep and the digit lands in the last one, so
   it spins past two full turns on the way. Nothing but digits becomes a reel:
   currency marks, separators and words stay fixed, which is what stops the
   figure from reflowing while it moves. */
const ROLL_SPINS=2;
const ROLL_STRIP='0123456789'.repeat(ROLL_SPINS+1);
function reelHTML(text){
  let d=0;
  // Zero-width, purely to give the flex row a text baseline — see .roll.
  return '<span class="rb">​</span>'+[...text].map(ch=>{
    if(ch<'0'||ch>'9')return `<span class="rf">${esc(ch)}</span>`;
    return `<span class="rc"><span class="rs" data-d="${ch}" style="--i:${d++}">`+
      [...ROLL_STRIP].map(n=>`<span class="rd">${n}</span>`).join('')+
      '</span></span>';
  }).join('');
}
function roll(el){
  const text=el.dataset.roll;
  if(!text)return;
  if(reduceMotion()){el.textContent=text;return}
  /* The reels are decoration: the strip holds thirty digits per column and only
     one is ever visible, so read aloud it is thirty digits of noise. Assistive
     tech gets the figure itself and nothing else. */
  el.innerHTML=`<span class="vh">${esc(text)}</span>`
    +`<span class="roll" aria-hidden="true">${reelHTML(text)}</span>`;
  /* Force the start position to be committed before the target is set —
     otherwise both land in the same style recalculation and there is nothing
     to transition from. A layout read does it synchronously, which rAF would
     not: a background tab suspends rAF, and the reels would sit at zero. */
  void el.offsetHeight;
  el.querySelectorAll('.rs').forEach(s=>{
    s.style.transform=`translateY(-${ROLL_SPINS*10+ +s.dataset.d}em)`;
  });
}
function rollCard(card){
  if(card)card.querySelectorAll('[data-roll]').forEach(roll);
}

/* ── the scroll painter ────────────────────────────────────────────────────
   Each card's scale comes from how far its centre is from the track's, so the
   cards grow and recede continuously under the finger rather than snapping to
   a new size once scrolling stops.

   It sets a custom property rather than `transform` itself: an inline transform
   would outrank every rule in the sheet, including the hover lift, and the two
   have to compose. One rAF per frame at most, and only a transform is touched,
   so it stays on the compositor. */
let paintRaf=0;
function paintCards(){
  paintRaf=0;
  const t=$('track'),cards=t.querySelectorAll('.snapCard');
  if(!cards.length)return;
  const mid=t.scrollLeft+t.clientWidth/2;
  const centres=[];
  cards.forEach((c,i)=>{
    const cx=c.offsetLeft+c.offsetWidth/2;
    centres.push(cx);
    // 0 when centred, 1 when a full card away — clamped so distant cards stop
    // shrinking rather than collapsing.
    const d=Math.min(1,Math.abs(cx-mid)/(c.offsetWidth||1));
    c.style.setProperty('--cardScale',(1-.055*d).toFixed(4));
  });
  paintScenes(centres,mid);
}

/* Where the strip is, as a fractional card index — 2.5 meaning halfway between
   the third card and the fourth. Interpolated across the real centres rather
   than assuming a uniform pitch, since the cards resize with the viewport. */
function stripPos(centres,mid){
  if(mid<=centres[0])return 0;
  const last=centres.length-1;
  if(mid>=centres[last])return last;
  for(let i=0;i<last;i++)
    if(mid<=centres[i+1])return i+(mid-centres[i])/(centres[i+1]-centres[i]);
  return last;
}

/* Each scene's presence is its distance from its whole run, not from any one
   card: zero anywhere inside the run — so a backdrop shared by two neighbours
   stays at full strength while you cross between them — and rising only past
   either end. Squared, so it commits rather than sitting half-lit across the
   approach. */
function paintScenes(centres,mid){
  const p=stripPos(centres,mid),by={};
  for(const r of SCENE_RUNS){
    const d=Math.min(1,Math.max(0,r.lo-p,p-r.hi));
    by[r.scene]=Math.max(by[r.scene]??0,(1-d)*(1-d));
  }
  $('landBg').querySelectorAll('.bgScene').forEach(l=>{
    l.style.opacity=(by[l.dataset.scene]??0).toFixed(3);
  });
}
const schedulePaint=()=>{if(!paintRaf)paintRaf=requestAnimationFrame(paintCards)};
function slideTo(i){
  const cards=$('track').querySelectorAll('.snapCard');
  const n=Math.max(0,Math.min(cards.length-1,i));
  const card=cards[n];
  if(!card)return;
  $('track').scrollTo({
    left:card.offsetLeft-($('track').clientWidth-card.offsetWidth)/2,
    behavior:reduceMotion()?'auto':'smooth'});
  setSlide(n);
}
function setSlide(n){
  if(n===S.slide)return;
  S.slide=n;S.sel=VAULTS[n].id;
  markCentred();syncSlide();
}
function syncSlide(){
  $('dots').querySelectorAll('.dot').forEach((d,j)=>d.classList.toggle('on',j===S.slide));
  $('prev').disabled=S.slide<=0;
  $('next').disabled=S.slide>=VAULTS.length-1;
}

/* ── ticker ───────────────────────────────────────────────────────────────
   Two kinds of item on one line. Subscriptions are real: DepositMade events
   read off the vault PDA, with the depositor's own address and the amount the
   program accepted. Commentary is not, and never wears the live dot.

   Signature history on a public RPC is a window rather than an archive, so
   this shows a recent slice and says nothing about totals. */
const ago=ms=>{
  if(!ms)return '';
  const s=Math.max(0,(Date.now()-ms)/1000);
  if(s<90)return 'just now';
  if(s<3600)return `${Math.round(s/60)}m ago`;
  if(s<86400)return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
};

function tickerItems(){
  /* On the carousel the ticker speaks for the whole page, so it carries every
     offering's subscriptions and names each one. Inside a vault it is that
     vault's own activity. */
  const from=S.view==='vault'?[cur()]:VAULTS;
  const subs=from.flatMap(v=>v.deposits.map(d=>Object.assign({v},d))).
    sort((a,b)=>(b.at??0)-(a.at??0)).slice(0,8).map(d=>`<span class="tkItem">
    <span class="tkDot"></span>
    <span class="tkWho num">${esc(short(d.wallet))}</span>
    <span>subscribed</span>
    <span class="tkAmt num">${money(d.amount,0)}</span>
    ${S.view==='vault'?'':`<span class="tkWho">into ${esc(d.v.ticker)}</span>`}
    <span class="tkAgo num">${ago(d.at)}</span>
  </span>`);

  const social=SOCIAL.map(p=>`<span class="tkItem">
    <span class="tkSrc">${esc(p.src)}</span>
    <span class="tkWho">${esc(p.h)}</span>
    <span class="tkBody">${esc(p.b)}</span>
  </span>`);

  /* An empty event list has two very different causes: nothing has been
     subscribed, or the read failed — a public RPC rate-limits these hard, and
     the client returns [] either way. Only claim the first when the vault's own
     `total_deposits` agrees, otherwise say nothing. Announcing "nothing
     committed yet" over a vault holding $12,000 would be a lie the page has no
     way to notice. */
  if(!subs.length&&S.source==='chain'){
    const committed=VAULTS.some(v=>v.live&&(v.raisedUsd||0)>0);
    if(!committed&&VAULTS.some(v=>v.live&&v.status==='open'))
      subs.push(`<span class="tkItem">
        <span class="tkDot"></span><span>Open for subscription · nothing committed yet</span>
        </span>`);
  }

  // Interleave so neither kind clumps, whichever list is shorter.
  const out=[],n=Math.max(subs.length,social.length);
  for(let i=0;i<n;i++){
    if(i<subs.length)out.push(subs[i]);
    if(i<social.length)out.push(social[i]);
  }
  return out;
}

function renderTicker(){
  const items=tickerItems();
  if(!items.length){$('ticker').style.display='none';return}
  $('ticker').style.display='';
  // Rendered twice: the keyframe translates exactly -50%, so the loop closes on
  // itself. Both halves must be identical or the seam jumps.
  const run=items.join('');
  $('tickerRun').innerHTML=run+run;
  // Pace it by content width so a long run does not crawl and a short one does
  // not race — roughly 90 pixels a second either way.
  const w=$('tickerRun').scrollWidth/2;
  $('tickerRun').style.animationDuration=`${Math.max(28,Math.round(w/90))}s`;
}

/** Every live offering's subscriptions, one after another.
    The public devnet RPC rate-limits a concurrent burst hard enough that the
    client spends its first seconds backing off, so these go in sequence. */
async function refreshAllDeposits(){
  let changed=false;
  for(const v of VAULTS.filter(x=>x.live)) changed=await refreshDeposits(v)||changed;
  return changed;
}

/** Real subscriptions for one offering, newest first. */
async function refreshDeposits(v){
  if(!v?.chainId||!v.live)return false;
  const c=await chain();
  if(!c?.recentDeposits)return false;
  const next=await c.recentDeposits(v.chainId,{limit:10});
  const changed=next.map(d=>d.signature).join()!==v.deposits.map(d=>d.signature).join();
  v.deposits=next;
  return changed;
}

/* ── hero ── */
function heroStats(){
  const v=cur(),pct=subPct(v),room=roomLeft(v);
  if(v.status==='live'||v.status==='ipo')return[
    ['Par value',money(v.entryPrice),'at entry'],
    ['Redemption value',v.nrv?money(v.nrv):'Pending','per vault token'],
    ['Total raised',compact(v.raisedUsd),'in USDC'],
    ['Vault size',compact(v.vaultSize),'cap']];
  return[
    ['Valuation',v.ipoValuation,'pre-money'],
    ['Vault size',compact(v.vaultSize),v.raisedUsd==null?'':compact(v.raisedUsd)+' committed'],
    ['Subscribed',pctS(pct),room==null?'':compact(room)+' remaining'],
    // A vault that has not opened counts down to its opening, like its card.
    hasOpensClock(v)
      ? ['Opens in',cdShort(v.opens),esc(v.openDate||'')]
      : ['Closes in',subsOpen(v)?cdShort(v.close):'Closed',esc(v.deadlineShort||'')]];
}
/* What this offering's figures are, in its own words. A page-wide flag cannot
   answer this: two of the four are read from the chain and two are not. */
function provenance(v){
  if(S.source==='loading')return['Reading the chain…',''];
  if(S.source==='simulated')return['Simulated',
    'marco-chain.js is not beside this page, so nothing here touches a chain.'];
  if(v.live)return null;                    // real, and the figures speak for themselves
  return v.chainId
    ? ['Illustrative',`No vault named ${v.chainId} on ${CLUSTER} — these figures are illustrative.`]
    : ['Illustrative','This offering has no vault on chain yet. The figures are illustrative '
        +'and it cannot be subscribed to.'];
}

function renderHero(){
  const v=cur(),st=STATUS[v.status]||STATUS.open;
  const live=v.status==='open'||v.status==='live';
  const src=provenance(v);
  $('hero').innerHTML=`
    <div class="vtop">
      <span class="vBadge${live?' live':''}">${esc(st.l)}</span>
      ${src?`<span class="badge" title="${esc(src[1])}">${esc(src[0])}</span>`:''}
      ${SHELL&&v.id==='moon'?`<a class="lnk futLink" href="#" id="futLink">Trade the MOON valuation future →</a>`:''}
    </div>
    <div class="vhead">
      ${logoHTML(v,'vLogo')}
      <h1 class="vTick">${esc(v.name)}</h1>
    </div>
    <div class="hstats">${heroStats().map(x=>`<div class="hstat">
      <div class="hk">${esc(x[0])}</div>
      <div class="hv num">${x[1]}</div>
      ${x[2]?`<div class="hsub num">${x[2]}</div>`:''}</div>`).join('')}</div>
    ${showFill()?`<div class="heroCh"><canvas id="heroCh"></canvas></div>`:''}`;
  const fl=$('futLink');if(fl)fl.onclick=e=>{e.preventDefault();SHELL.open('futures')};
}
/* The fill curve is a shape, and under about a percent there is no shape to
   draw — a flat line at the axis with a floating cap label takes 130px of the
   hero to say what "0.3% · $4.0M remaining" already said. It appears once the
   vault has filled enough for the curve to carry information. */
function showFill(){const p=subPct(cur());return p!=null&&p>=1}

/* ── how the vault works ── */
function renderHow(){
  const v=cur(),idx=LCIDX[v.status]??0;
  $('aboutCo').textContent=v.description||v.tagline||'';
  /* Under the lifecycle: what the company makes, after how the vault runs.
     The heading is rendered with the strip rather than sitting in the markup,
     so an offering with no media gets no empty "Gallery" and no stray rule. */
  const gallery=mediaHTML(v);
  $('ovMedia').innerHTML=gallery?`<div class="vsub">Gallery</div>${gallery}`:'';
  // One entry per stage, and there are four of them.
  const dts=v.status==='live'?['Done','Done','Listed','Now']
    :v.status==='ipo'?['Done','Done','Listed','Pending']
    :v.status==='locked'?['Done','Done','TBD','']
    :v.status==='soon'?['Opens '+(v.openDate||'soon'),'','Expected 2027','']
    :['Open',v.deadlineShort||'','Expected 2027',''];
  $('lcStrip').innerHTML=LC.map((k,i)=>{
    const cl=i<idx?'done':i===idx?'active':'future';
    return `<div class="lcn ${cl}"><div class="lck">${esc(k)}</div>
      <div class="lcd">${esc(dts[i]||'')}</div></div>`}).join('');


  const pct=subPct(v);
  const rows=[
    ['Issuer','Marco Labs · Pre-IPO vault'],
    ['Instrument',`${tick()}-pre vault token`],
    ['Redemption basis','Vault tokens redeem on net IPO proceeds, not raw stock price performance.'],
    ['Vault entry price',money(v.entryPrice)],
    ['IPO valuation',v.ipoValuation],
    ['Vault cap',(v.chainCap??v.vaultSize)==null?'—'
      :money(v.chainCap??v.vaultSize,0)
        +(v.acceptingDeposits===false&&v.live
          ? ' — the ceiling this vault was created with; it closed below it'
          : ' — a hard limit; subscription closes there')],
    ['Committed',v.raisedUsd==null?'—':`${compact(v.raisedUsd)} (${pctS(pct)})`],
    ['Minimum subscription',money(minSub(v),0)],
    ['Protocol fee',(feeBpsOf(v)/100).toFixed(2)
      +(feeAtExitOf(v)?'%, taken from redemption proceeds':'% of subscription, settled at settlement')],
    ['Allocation','Every accepted subscription is allocated in full. A deposit that would exceed '
      +'the cap is partially filled, and the unfilled portion never leaves your wallet.'],
    ['Vault status',esc(STATUS[v.status].l)+(v.chainPhase?` · ${esc(v.chainPhase)} on-chain`:'')],
    ['Deposit deadline',esc(v.deadline||'—')],
    ['Settlement',esc(v.chains)],
    ['Cluster',esc(CLUSTER)],
    ['Vault program',addrLink(VAULT_PROGRAM)],
    ['Vault account',v.vaultAddress?addrLink(v.vaultAddress):'Not read yet'],
    ['USDC mint',addrLink(USDC_MINT)],
    // The programs have not been audited. Saying otherwise on the page that
    // takes the subscription would be the worst possible place to round up.
    ['Audit',isTestnet()?'Unaudited · test deployment':'Unaudited'],
  ];
  $('termsCap').innerHTML=rows.map(r=>
    `<div class="trow"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
}

/* ── financials and comparables ── */
function renderNumbers(){
  const v=cur();
  $('finRows').innerHTML=v.fin.map(f=>`<tr>
    <td class="nm num">${esc(f.y)}</td><td class="r num">${esc(f.rev)}</td>
    <td class="r num">${esc(f.gp)}</td><td class="r num">${esc(f.np)}</td>
    <td class="r num">${esc(f.m)}</td></tr>`).join('');
  $('cmpRows').innerHTML=v.comparables.map(c=>`<tr${c.self?' style="background:var(--surface)"':''}>
    <td class="nm num">${esc(c.t)}</td><td>${esc(c.i)}</td><td>${esc(c.l)}</td>
    <td class="r num">${esc(c.mc)}</td><td class="r num">${esc(c.ev)}</td></tr>`).join('');
  $('finFoot').textContent=v.finFoot;
  $('finSource').textContent='Source · '+v.finSource;
}

function renderRisk(){
  $('riskList').innerHTML=RISKS.map((r,i)=>`<div class="numitem">
    <div class="numi num">${i+1}</div>
    <div><div class="numh">${esc(r.h)}</div><div class="numd">${esc(r.d)}</div></div>
  </div>`).join('');
}

/* ── activity: this vault's deposits, as the program recorded them ─────────
   Telling the empty cases apart matters more here than the list does. An
   offering with no vault on chain has nothing to show; a vault that has taken
   nothing should say so; and a read that failed — which a public RPC does
   often, and which returns [] exactly like an empty vault — must be reported
   as neither. The vault's own total_deposits is the arbiter: only when it
   agrees the vault is empty may the page say the vault is empty. */
function renderActivity(){
  const v=cur(),el=$('actList');
  const note=t=>`<p class="mini" style="line-height:1.55">${t}</p>`;

  if(S.source==='loading'&&v.chainId)
    return void(el.innerHTML=note(`Reading ${esc(v.chainId)} from ${esc(CLUSTER)}…`));

  const real=(v.deposits||[]).slice().sort((a,b)=>(b.at??0)-(a.at??0));

  /* Real rows whenever there are real rows. Otherwise illustrative ones, with
     the reason stated — an offering with no vault on chain has nothing to read,
     and a vault that does but returned nothing was almost certainly throttled
     rather than empty. Neither case is allowed to pass invented rows off as
     records, so the note above them says which it is. */
  if(real.length)
    return void(el.innerHTML=rowsHTML(real));

  // A live, chain-backed vault that really is empty says so, rather than
  // inventing a history for a vault that has taken nothing.
  if(v.live&&!(v.raisedUsd>0))
    return void(el.innerHTML=note('Open for subscription. Nothing has been committed yet.'));

  const sim=simDeposits(v);
  if(!sim.length)return void(el.innerHTML=note(v.status==='soon'
    ? 'This offering has not opened yet.' : 'Nothing has been committed yet.'));

  /* Sample rows, shown without a caption — by request. What marks them as not
     read from the chain is carried by the rows themselves: the neutral dot
     rather than the live one, and a dash where the transaction link goes. */
  el.innerHTML=rowsHTML(sim);
}

/* Chain rows link to their transaction and carry the live dot; illustrative
   ones do neither, because a link is a claim that the transaction exists. */
function rowsHTML(rows){
  return `<div class="actRows">${rows.map(d=>`<div class="actRow${d.sim?' sim':''}">
    <span class="actDot"></span>
    <span class="actWho num">${esc(short(d.wallet))}</span>
    <span class="actWhat">subscribed</span>
    <span class="actAmt num">${money(d.amount,0)}</span>
    <span class="actAgo num">${esc(ago(d.at))}</span>
    ${d.sim?'<span class="actTx num">—</span>'
      :`<a class="lnk actTx num" href="${explorerTx(d.signature)}" target="_blank"
         rel="noopener noreferrer" title="${esc(d.signature)}">tx</a>`}
  </div>`).join('')}</div>`;
}

/* ── the portfolio ────────────────────────────────────────────────────────
   Every position this wallet holds, across all the offerings, with what each
   is worth now. "Worth now" is the program's own redemption value once a vault
   settles; before that it is the subscription price, which is the honest answer
   — an unsettled vault has no mark, and inventing one would be the single most
   misleading number this page could show. */
function pfValue(v,p){
  const settled=v.claimable&&v.nrv;
  return {per:settled?v.nrv:(v.entryPrice||1),marked:!!settled};
}

function renderPortfolio(){
  const el=$('pfBody');

  /* No wallet, no positions — but the page shows its shape rather than a prompt:
     the same summary card with everything at zero, no rows, and (via
     renderHistory) no transactions. Gated on being connected rather than on
     what `pos` happens to hold, so a just-disconnected wallet's figures do not
     linger. The header's wallet icon is the affordance to connect. */
  const held=(chainLive()&&S.wallet)
    ? VAULTS.filter(v=>v.chainId&&v.pos&&(v.pos.tok>0||v.pos.redeemed>0)) : [];

  let tSub=0,tNow=0,tOut=0;
  held.forEach(v=>{const p=v.pos,{per}=pfValue(v,p);
    tSub+=p.sub||0; tNow+=(p.tok||0)*per; tOut+=p.redeemed||0;});
  /* Net profit = cash already taken out + value still held − total put in.
     An unsettled vault marks held tokens at their subscription price, so it
     contributes zero here rather than a made-up gain — the number only moves
     once a vault settles or a position is redeemed. */
  const tPL=tNow+tOut-tSub, plZero=Math.round(tPL)===0;
  /* Subscribed = still holding a claim (tokens left); Redeemed = closed, cashed
     out. A partly-redeemed position keeps its tokens, so it stays under
     Subscribed with its redeemed amount noted on the row. */
  /* Grouped by portion rather than by vault. A vault with tokens still held
     shows under Subscribed; one that has paid anything out shows under
     Redeemed — and a partly-redeemed position satisfies both, so it appears as
     two rows, the held part above and the cashed-out part below. */
  const active=held.filter(v=>(v.pos.tok||0)>0);
  const cashed=held.filter(v=>(v.pos.redeemed||0)>0);
  const group=(label,kind,list)=>`<div class="pfGroup">${label}</div>${
    list.length?`<div class="pfRows">${list.map(v=>pfRowHTML(v,kind)).join('')}</div>`
    :`<p class="pfNone num">—</p>`}`;

  el.innerHTML=`<div class="pfTot">
      <div class="pfTotItem"><span class="pfK">Subscribed</span>
        <span class="pfTotV num">${money(tSub,0)}</span></div>
      <div class="pfTotItem"><span class="pfK">Held now</span>
        <span class="pfTotV num">${money(tNow,0)}</span></div>
      ${tOut?`<div class="pfTotItem"><span class="pfK">Redeemed</span>
        <span class="pfTotV num">${money(tOut,0)}</span></div>`:''}
      <div class="pfTotItem"><span class="pfK">Net profit</span>
        <span class="pfTotV num ${plZero?'':tPL>=0?'up':'dn'}">${
          plZero?'':tPL>=0?'+':'−'}${money(Math.abs(tPL),0)}</span></div>
      <div class="pfTotItem"><span class="pfK">Offerings</span>
        <span class="pfTotV num">${held.length}</span></div>
    </div>
    ${group('Subscribed','held',active)}
    ${group('Redeemed','redeemed',cashed)}`;

  el.querySelectorAll('.pfRow[data-v]').forEach(b=>{b.onclick=()=>openVault(b.dataset.v)});
}

/* One holdings row, in one of two modes. `held` renders the tokens still held
   (the Subscribed group); `redeemed` renders what has been cashed out (the
   Redeemed group). A partly-redeemed position is rendered once in each — the
   two modes carve the position along the token count.

   Tokens mint 1:1 with the subscription on these vaults, so the split is exact:
   held tokens cost `tok`, and the redeemed tokens are the rest of what was
   minted, `sub − tok`, at the same entry price. */
function pfRowHTML(v,kind){
  const p=v.pos,{per,marked}=pfValue(v,p);
  const st=STATUS[v.status]||STATUS.open;
  const partly=(p.tok||0)>0&&(p.redeemed||0)>0;
  const plTag=pl=>pl==null||Math.round(pl)===0?''
    :` <span class="${pl>=0?'up':'dn'}">${pl>=0?'+':'\u2212'}${money(Math.abs(pl),0)}</span>`;

  if(kind==='redeemed'){
    const redTok=Math.max(0,(p.sub||0)-(p.tok||0));   // minted less still-held
    const sub=redTok*(v.entryPrice||1);
    const pl=(p.redeemed||0)-sub;
    return `<button class="pfRow" data-v="${esc(v.id)}" type="button">
      <span class="pfMark">${logoHTML(v,'pfLogo')}</span>
      <span class="pfName">
        <span class="pfCo">${esc(v.name)}</span>
        <span class="pfSt">${partly?'Redeemed in part':'Closed · fully redeemed'}</span>
      </span>
      <span class="pfCell"><span class="pfK">Tokens</span>
        <span class="pfV num">—</span></span>
      <span class="pfCell"><span class="pfK">Subscribed</span>
        <span class="pfV num">${money(sub,0)}</span></span>
      <span class="pfCell"><span class="pfK">Redeemed</span>
        <span class="pfV num">${money(p.redeemed||0,0)}${plTag(pl)}</span></span>
    </button>`;
  }

  const tok=p.tok||0,sub=tok*(v.entryPrice||1),now=tok*per;
  const pl=marked?now-sub:null;
  return `<button class="pfRow" data-v="${esc(v.id)}" type="button">
    <span class="pfMark">${logoHTML(v,'pfLogo')}</span>
    <span class="pfName">
      <span class="pfCo">${esc(v.name)}</span>
      <span class="pfSt">${partly?`${esc(st.l)} · partially redeemed`
        :esc(st.l)+(v.claimable?' · redeemable now':'')}</span>
    </span>
    <span class="pfCell"><span class="pfK">Tokens</span>
      <span class="pfV num">${qty(tok,0)} m${esc(v.ticker)}</span></span>
    <span class="pfCell"><span class="pfK">Subscribed</span>
      <span class="pfV num">${money(sub,0)}</span></span>
    <span class="pfCell"><span class="pfK">${marked?'Redemption value':'At subscription'}</span>
      <span class="pfV num">${money(now,0)}${plTag(pl)}</span></span>
  </button>`;
}

/* Every transaction this wallet has signed against any of these vaults. Read
   from each holder's own BuyerState PDA, so it is the holder's record rather
   than a filtered view of the vault's — and every row links to the signed
   transaction, which is the point of putting it here at all. */
function renderHistory(rows){
  const el=$('pfHistory');
  const head=`<h2 class="pfH2">Transactions</h2>`;
  // The section header shows in every state, so the layout reads the same
  // whether or not a wallet is connected — only what sits under it changes.
  if(!chainLive()||!S.wallet)
    return void(el.innerHTML=head+`<p class="pfNone num">—</p>`);
  if(rows===undefined)
    return void(el.innerHTML=head+`<p class="mini">Reading your history from ${esc(CLUSTER)}…</p>`);
  if(!rows.length)
    return void(el.innerHTML=head+`<p class="pfNone num">—</p>`);

  el.innerHTML=head+`
    <div class="txRows">${rows.map(r=>`<div class="txRow">
      <span class="txKind ${r.kind==='Redeemed'?'out':'in'}">${esc(r.kind)}</span>
      <span class="txCo">${esc(r.v.name)}</span>
      <span class="txAmt num">${r.kind==='Redeemed'?'+':'−'}${money(r.amount||0,0)}</span>
      <span class="txTok num">${qty(r.tokens||0,0)} ${'m'+esc(r.v.ticker)}</span>
      <span class="txWhen num">${esc(ago(r.at))}</span>
      <a class="lnk txLink num" href="${explorerTx(r.signature)}" target="_blank"
         rel="noopener noreferrer" title="${esc(r.signature)}">${esc(short(r.signature))} \u2197</a>
    </div>`).join('')}</div>`;
}

/* ── social: what the company makes, then what is being said about it ─────
   The media comes first because it is the fastest read on the page — a wall of
   commentary about a robotics company tells you less in three seconds than one
   photograph of the robots does.

   Clips are not preloaded: a detail page can carry several, only one of which
   anyone will play, and `preload="none"` means the tile costs its poster frame
   and nothing else until it is clicked. */
function mediaHTML(v){
  const items=MEDIA[v.id]||[];
  if(!items.length)return '';
  return `<div class="mediaStrip">${items.map(m=>`<figure class="mTile">
    ${m.t==='vid'
      ? `<video class="mFill" src="${esc(m.src)}" ${m.poster?`poster="${esc(m.poster)}"`:''}
           controls preload="none" playsinline
           aria-label="${esc(m.cap||v.name)}"></video>`
      /* aspect-ratio from the file's own header, so the tile is the right shape
         before the image decodes — width follows height here, and an undecoded
         image has no width to follow. Not lazy: the bytes are already in this
         document as a data URI, so there is nothing left to defer. */
      : `<img class="mFill" src="${esc(m.src)}" alt="${esc(m.cap||v.name)}"
           style="aspect-ratio:${m.w&&m.h?`${m.w}/${m.h}`:'16/9'}" decoding="async">`}
    ${m.cap?`<figcaption class="mCap">${esc(m.cap)}</figcaption>`:''}
  </figure>`).join('')}</div>`;
}

function renderSocial(){
  const v=cur();
  // Untagged posts are about how these vaults work, so they belong everywhere.
  const posts=SOCIAL.filter(p=>!p.v||p.v===v.id);
  $('socList').innerHTML=posts.length
    ? `<div class="socRows">${posts.map(p=>`<div class="socRow">
        <div class="socHead"><span class="socSrc">${esc(p.src)}</span>
          <span class="socWho">${esc(p.h)}</span></div>
        <div class="socBody">${esc(p.b)}</div>
      </div>`).join('')}</div>`
    : `<p class="mini">Nothing collected for ${esc(v.name)} yet.</p>`;
}

/* ── the rail: countdown, then whatever this phase actually offers ── */
function railClock(){
  const v=cur(),pct=subPct(v);
  if(!subsOpen(v)&&!hasOpensClock(v)&&v.status!=='open'&&!v.claimable)return '';
  return `<div class="vrsec hl">
    <div class="cdHead"><span class="cdName">${esc(v.name)}</span>
      <span class="badge${v.status==='open'?' live':''}">${esc(STATUS[v.status].l)}</span></div>
    <div class="mini">${hasOpensClock(v)?'Subscription opens in'
      :subsOpen(v)?'Subscription closes in':'Subscription window'}</div>
    ${hasOpensClock(v)?`<div class="cdn" data-cdfull="${esc(v.opens)}"></div>`
      :subsOpen(v)?`<div class="cdn" data-cdfull="${esc(v.close)}"></div>`
      :`<div class="cdn"><span class="cdu" style="min-width:auto"><span class="cdv">Closed</span></span></div>`}
    <div class="cdSub num${pct==null?' mute':''}">${pct==null?'Reading the chain…'
      :`${compact(v.raisedUsd)} of ${compact(v.vaultSize)} committed (${pctS(pct)})`}</div>
    ${pct==null?'':`<span class="bar" style="margin-top:10px">
      <span class="barF acc" style="width:${pct}%"></span></span>`}
  </div>`;
}
/* The receipt for whatever was just signed. Shown against the vault it belongs
   to only — switching offerings should not carry another vault's transaction
   along with it — and it is a real explorer link rather than a toast, so it
   survives a re-render and can still be opened a minute later. */
function lastTxLine(v){
  const t=S.lastTx;
  if(!t||t.vaultId!==v.chainId)return '';
  return `<div class="txLine">
    <span class="txDot"></span>
    <span>${esc(t.kind)} confirmed</span>
    <a class="lnk txLink num" href="${explorerTx(t.sig)}" target="_blank"
       rel="noopener noreferrer" title="${esc(t.sig)}">${esc(short(t.sig))} \u2197</a>
  </div>`;
}

function railPosition(){
  const p=cur().pos;
  /* Shown whenever a wallet is attached and the position is known — including a
     zero one, which is a real answer to "what do I hold here" and the state a
     first-time subscriber is in. Hidden with no wallet (there is no position to
     speak of) and hidden when `pos` is undefined, which means the read failed
     and we do not know rather than that it is empty. */
  if(!chainLive()||!S.wallet||p===undefined||p===null)return '';
  const v=cur(),nav=v.nrv||v.entryPrice||1;
  const rows=[['Subscribed',money(p.sub||0)],
    ...(p.fee?[['Entry fee',money(p.fee)]]:[]),
    ['Vault tokens',qty(p.tok||0,0)+' '+tick()],
    ['Indicative value',money((p.tok||0)*nav)],
    ...(p.redeemed?[['Redeemed',money(p.redeemed)]]:[])];
  return `<div class="vrsec">
    <div class="ct" style="margin-bottom:10px">Your position</div>
    ${rows.map(r=>`<div class="row"><span>${r[0]}</span><b class="num">${r[1]}</b></div>`).join('')}
  </div>`;
}

/* What the holder is actually getting. The fee has its own row directly above
   this and a line in the Terms table, so restating it here spent the one piece
   of prose next to the amount field on the least surprising fact. What a first
   reader needs is that a token is a slice of a pool rather than a fixed claim —
   and that the shares never reach their wallet. */
const shareNote=v=>`Your tokens are a pro-rata share of the vault, not a fixed claim on any `
  +`amount. Redemption pays that share of whatever the vault's net proceeds come to \u2014 you `
  +`hold a slice of the pool, and the shares themselves stay with the broker.`;

/* A link to the vault account on the explorer, as a row that matches the
   others in the capsule. Only once the address has been read from chain —
   there is nothing to point at before that. */
const vaultLinkRow=v=>v.vaultAddress?`<div class="row"><span>Vault</span>
  <a class="lnk addr num" href="${explorer(v.vaultAddress)}" target="_blank"
     rel="noopener noreferrer" title="${esc(v.vaultAddress)}">${esc(short(v.vaultAddress))} \u2197</a></div>`:'';

function renderRail(){
  const v=cur(),st=STATUS[v.status]||STATUS.open;
  const bal=spendable(),room=roomLeft(v);
  let body;

  if(S.source==='loading'){
    body=`<div class="vrsec"><div class="ct" style="margin-bottom:10px">Subscribe</div>
      <div class="mini">Reading the vault from ${esc(CLUSTER)}…</div></div>`;
  }else if(!v.live&&S.source==='chain'){
    /* No vault on chain means no deposit instruction to send. Offering the box
       anyway would take an amount and have nowhere to put it.
       The heading names the actual reason. It used to read "Not yet open",
       which contradicted the Open badge directly above it on every offering
       whose vault simply has not been created — the blocker is the missing
       vault, not the calendar. */
    body=`<div class="vrsec">
      <div class="ct" style="margin-bottom:12px">${
        v.status==='soon'?'Not yet open':'No vault on chain'}</div>
      <div class="row" style="padding-top:0"><span>Status</span>
        <b>${esc(STATUS[v.status].l)}</b></div>
      <div class="row"><span>Vault size</span><b class="num">${compact(v.vaultSize)}</b></div>
      <div class="row"><span>Valuation</span><b class="num">${esc(v.ipoValuation)}</b></div>
      <button class="cta" disabled>Not subscribable</button>
      <div class="mini" style="margin-top:12px;line-height:1.5">${esc((provenance(v)||['',''])[1])}</div>
    </div>`;
  }else if(v.status==='open'){
    const balLbl=S.source==='simulated'?`Simulated ${money(simCash,0)}`
      :chainLive()?`<button class="wlink" id="wToggle" type="button"
           title="Disconnect ${esc(S.wallet||'')}">Balance ${bal==null?'—':money(bal,0)}</button>`
      :`<button class="wlink" id="wToggle" type="button">Connect wallet</button>`;
    body=`<div class="vrsec">
      <div class="ct" style="margin-bottom:12px">Subscribe</div>
      <div class="depbox">
        <div class="depTop"><span class="depL">Amount</span>
          <span class="depL num">${balLbl}</span></div>
        <input id="bAmt" type="number" class="num depAmt" min="${minSub(v)}" value="1000"
               inputmode="decimal" aria-label="Subscription amount">
        <div class="depBot"><span class="depSub num" id="bAmtUsd"></span>
          <span class="depUnit">${usdc()}<button id="bMax" type="button">MAX</button></span></div>
      </div>
      <button class="cta" id="bCta">Subscribe</button>
      ${lastTxLine(v)}
      <div class="row" style="margin-top:16px">
        <span>Fee (${(feeBpsOf(v)/100).toFixed(2)}%) · at ${feeAtExitOf(v)?'redemption':'settlement'}</span>
        <b class="num" id="bFee">—</b></div>
      <div class="row"><span>${feeAtExitOf(v)?'Subscription':'Net subscription'}</span>
        <b class="num" id="bNet">—</b></div>
      <div class="row"><span>You receive</span><b class="num" id="bGtd">—</b></div>
      <div class="row"><span>Indicative NAV</span><b class="num">${money(v.entryPrice)}</b></div>
      <div class="row"><span>Remaining</span><b class="num">${compact(room)}</b></div>
      ${vaultLinkRow(v)}
      <div class="mini" id="bNote" style="margin-top:14px;line-height:1.5">${esc(shareNote(v))}</div>
    </div>`;
  }else if(v.status==='live'){
    // undefined means the read failed, which is not the same as holding none.
    const unknown=cur().pos===undefined;
    const held=cur().pos?.tok||0;
    body=`<div class="vrsec">
      <div class="ct" style="margin-bottom:14px">Redeem</div>
      <div class="row" style="padding-top:0"><span>Order type</span>
        <b>Burn ${tick()} → USDC</b></div>
      <div class="row"><span>Your balance</span>
        <b class="num">${unknown?'—':qty(Math.round(held),0)+' '+tick()}</b></div>
      <div class="fld"><div class="fldL"><span>Redeem</span>
          <span class="num">NAV ${money(v.nrv||v.entryPrice)}</span></div>
        <div class="inp"><input id="bAmt" type="number" class="num" min="0"
               value="${unknown?'':Math.round(held)}" inputmode="decimal"
               aria-label="Tokens to redeem"${unknown?' disabled':''}>
          <span>${tick()}</span><button id="bMax" type="button">Max</button></div></div>
      <div class="row"><span>Settlement NAV</span>
        <b class="num">${money(v.nrv||v.entryPrice)} · final</b></div>
      <div class="row"><span>Protocol fee</span><b class="num" id="bXFee">${feeAtExitOf(v)
        ?`${(feeBpsOf(v)/100).toFixed(2)}% · taken here`:'Taken at deposit · none here'}</b></div>
      <div class="row"><span>You receive</span><b class="num" id="bRecv">—</b></div>
      ${vaultLinkRow(v)}
      <button class="cta" id="bCta"${unknown?' disabled':''}>${
        unknown?'Balance unavailable':'Redeem'}</button>
      ${lastTxLine(v)}
      ${unknown?`<div class="mini" style="margin-top:12px;line-height:1.5">Could not read your
        position from ${esc(CLUSTER)} just now — the public RPC rate-limits hard. Your tokens are
        unaffected; reload to try again.</div>`:''}
      <div class="mini" style="margin-top:12px;line-height:1.5">${esc(feeAtExitOf(v)
        ? `Nothing was charged when you subscribed, so the ${(feeBpsOf(v)/100).toFixed(2)}% fee is `
          +`taken here — on what you withdraw.`
        : `Burn your tokens and receive USDC at the final settlement value. The subscription fee `
          +`was settled at settlement and nothing further is charged here.`)}</div>
    </div>`;
  }else{
    body=`<div class="vrsec">
      <div class="ct" style="margin-bottom:14px">Your position</div>
      <div class="row" style="padding-top:0"><span>Status</span><b>${esc(st.cta)}</b></div>
      <div class="row"><span>Your tokens</span>
        <b class="num">${qty(Math.round(cur().pos?.tok||0),0)} ${tick()}</b></div>
      <div class="row"><span>You subscribed</span>
        <b class="num">${money(cur().pos?.sub||0,0)}</b></div>
      <div class="row tot"><span>Settlement</span><b style="font-size:13px">${esc(cur().chains)}</b></div>
      <button class="cta" disabled>${esc(st.cta)}</button>
      <div class="mini" style="margin-top:12px;line-height:1.5">${
        v.status==='soon'?'Subscription opens closer to the deposit deadline.'
        :v.status==='ipo'?'The security has listed. Redemption opens once the sale settles.'
        :'Capital is committed and illiquid during this phase.'}</div>
    </div>`;
  }

  // Countdown, then the action, then what you already hold under it.
  $('rail').innerHTML=railClock()+body+railPosition();
  wireRail();
}

/* ── rail wiring ── */
function wireRail(){
  const v=cur();
  if($('wToggle'))$('wToggle').onclick=toggleWallet;
  if(v.status==='open'&&$('bAmt')){
    const accept=n=>{const r=roomLeft(v),b=spendable();
      return Math.max(0,Math.min(n,r==null?n:r,b==null?n:b))};
    const upd=()=>{
      const n=parseFloat($('bAmt').value)||0,acc=accept(n);
      const {fee,net}=entrySplit(v,acc);
      $('bAmtUsd').textContent=n>0?money(n,0):'';
      // The quote has to be what the program will mint: tokens are minted
      // against the NET subscription, so quoting the gross would promise more
      // than the deposit delivers.
      $('bGtd').textContent=qty(Math.round(net),0)+' '+tick();
      $('bFee').textContent=fee>0?money(fee,0):'—';
      $('bNet').textContent=net>0?money(net,0):'—';
      $('bCta').textContent=acc>0?`Subscribe ${money(acc,0)}`:'Subscribe';
      const note=$('bNote'),b=spendable(),r=roomLeft(v);
      if(n>acc+.005)
        note.innerHTML=`<b style="color:var(--ink)">Capped at ${money(acc,0)}</b> — limited by `
          +`${r!=null&&acc>=r-.005?'the room left in the vault':'your USDC balance'}.`;
      else note.textContent=shareNote(v);
    };
    $('bAmt').oninput=upd;
    $('bMax').onclick=()=>{
      const r=roomLeft(v),b=spendable();
      const mx=Math.min(r==null?Infinity:r,b==null?Infinity:b);
      $('bAmt').value=isFinite(mx)?Math.floor(mx):'';
      upd();
    };
    upd();
    $('bCta').onclick=doSubscribe;
  }
  if(v.status==='live'&&$('bAmt')){
    const nav=v.nrv||v.entryPrice||1;
    const net=t=>{const g=t*nav;return g-exitFeeOn(v,g)};
    const upd=()=>{
      const n=parseFloat($('bAmt').value)||0;
      $('bRecv').textContent=money(net(n));
      const xf=$('bXFee');
      if(xf&&feeAtExitOf(v))xf.textContent=n>0
        ?`−${money(exitFeeOn(v,n*nav))} · ${(feeBpsOf(v)/100).toFixed(2)}% of proceeds`
        :`${(feeBpsOf(v)/100).toFixed(2)}% · taken here`;
      $('bCta').textContent=n>0?`Redeem for ${money(net(n),0)}`:'Redeem';
    };
    $('bAmt').oninput=upd;
    $('bMax').onclick=()=>{$('bAmt').value=Math.round(cur().pos?.tok||0);upd()};
    upd();
    $('bCta').onclick=doRedeem;
  }
}

/* ════════════════════════════ actions ════════════════════════════ */

/**
 * A chain-backed vault must never simulate silently. When the bundle is present
 * but no wallet is connected, ask for the wallet — otherwise a visitor would
 * "subscribe" to a real vault and nothing would happen on-chain. An absent
 * bundle still falls back to the simulation, which is that mode's honest
 * behaviour.
 *
 * Returns true when the caller should stop.
 */
async function needsWallet(){
  const c=await chain();
  if(!c||chainLive())return false;
  try{ await connectWallet() }catch(e){ toast(e.message);return true }
  await afterConnect();
  return !chainLive();
}

async function doSubscribe(){
  const v=cur(),want=parseFloat($('bAmt').value)||0,mn=minSub(v);
  if(!(want>=mn))return toast(`Minimum subscription is ${money(mn,0)}.`);
  if(await needsWallet())return;

  if(chainLive()){
    await syncVault(v,{fresh:true});
    if(!cur().acceptingDeposits){
      render();
      return toast(`Vault is ${cur().chainPhase} on-chain — deposits are closed.`);
    }
    const cta=$('bCta'),label=cta.textContent;
    cta.disabled=true;cta.textContent='Confirm in your wallet…';
    try{
      // Nothing is predicted here — the resulting position is read back from
      // the BuyerState PDA by the client and returned.
      const {signature,position}=await window.MarcoChain.deposit(v.chainId,want);
      // Kept on S rather than written straight into the DOM: render() runs
      // immediately after this and would wipe anything not part of the state.
      S.lastTx={sig:signature,kind:'Subscription',vaultId:v.chainId};
      invalidateVault(v);invalidateHistory(v);
      await syncVault(v,{fresh:true});
      cur().pos={sub:position.deposited,tok:position.shares,redeemed:position.redeemed,
             fee:feeFromChain(v,position.deposited,position.shares)};
      try{ S.balance=await window.MarcoChain.getUsdcBalance() }catch{}
      await refreshDeposits(v);   // the subscription just made should be in the ticker
      toast(`Subscribed ${money(position.deposited,0)} · ${qty(Math.round(position.shares),0)} ${tick()}`);
      render();
    }catch(e){
      toast(`Deposit failed · ${e.message}`);
      cta.disabled=false;cta.textContent=label;
    }
    return;
  }

  // Simulation. Mirrors the program: accept up to the cap, mint against the net.
  const room=roomLeft(v),acc=Math.min(want,room,simCash);
  if(acc<=0)return toast(room<=0?'Vault is fully subscribed.':'Not enough USDC.');
  const {fee,net}=entrySplit(v,acc);
  simCash-=acc;v.raisedUsd+=acc;v.illustrative.raisedUsd=v.raisedUsd;
  const p=v.pos||(v.pos={sub:0,tok:0,redeemed:0,fee:0});
  p.sub+=acc;p.tok+=net;p.fee=(p.fee||0)+fee;
  if(v.raisedUsd>=v.vaultSize-.005)v.status='locked';
  toast(`Simulated · subscribed ${money(acc,0)} for ${qty(Math.round(net),0)} ${tick()}`);
  render();
}

async function doRedeem(){
  const v=cur(),n=parseFloat($('bAmt').value)||0;
  if(!(n>0))return toast('Enter an amount above zero.');
  if(await needsWallet())return;

  if(chainLive()){
    await syncVault(v,{fresh:true});
    if(!cur().claimable){
      render();
      return toast(`Vault is ${cur().chainPhase} on-chain — redemption is not open.`);
    }
    const cta=$('bCta'),label=cta.textContent;
    cta.disabled=true;cta.textContent='Confirm in your wallet…';
    try{
      const before=cur().pos?.redeemed??0;
      const {signature,position}=await window.MarcoChain.claim(v.chainId,n);
      S.lastTx={sig:signature,kind:'Redemption',vaultId:v.chainId};
      invalidateVault(v);invalidateHistory(v);
      await syncVault(v,{fresh:true});
      cur().pos={sub:position.deposited,tok:position.shares,redeemed:position.redeemed,
             fee:feeFromChain(v,position.deposited,position.shares)};
      try{ S.balance=await window.MarcoChain.getUsdcBalance() }catch{}
      toast(`Redeemed ${qty(Math.round(n),0)} ${tick()} for ${money(position.redeemed-before)}`);
      render();
    }catch(e){
      toast(`Redemption failed · ${e.message}`);
      cta.disabled=false;cta.textContent=label;
    }
    return;
  }

  const p=cur().pos;
  if(!p||p.tok<=0)return toast('You don’t hold tokens in this vault.');
  if(n>p.tok+1e-6)return toast('You don’t hold that many tokens.');
  const nav=v.nrv||v.entryPrice||1,g=n*nav,out=g-exitFeeOn(v,g);
  p.tok-=n;p.redeemed=(p.redeemed||0)+out;simCash+=out;
  toast(`Simulated · redeemed ${qty(Math.round(n),0)} ${tick()} for ${money(out)}`);
  render();
}

/* ════════════════════════════ wallet ════════════════════════════ */

async function afterConnect(){
  /* On the portfolio, connecting has to load the whole thing — every position
     and the history — not just the selected vault. Refreshing only cur() is why
     connecting there ever showed only Moonshot: it is the default selection, so
     it was the one vault that got read. */
  if(S.view==='portfolio'){loadPortfolio();return;}
  await refreshPosition(cur());
  await syncVault(cur(),{fresh:true});
  // Warm the Portfolio in the background so opening it later is instant.
  warmPortfolio();
}

/* Two ways in, one action: the header icon, and the balance line in the
   subscribe rail — which is where the state actually changes what you can do. */
function renderWallet(){
  if(SHELL&&!!S.wallet!==shellSaid){shellSaid=!!S.wallet;SHELL.walletChanged(shellSaid)}
  const b=$('walletBtn');if(!b)return;
  b.classList.toggle('on',!!S.wallet);
  const label=S.wallet
    ? `Wallet ${S.wallet}${S.walletKind==='dev'?' · burner key':''} — click to disconnect`
    : `Connect a Solana wallet${S.source==='chain'?` · ${CLUSTER}`:''}`;
  b.setAttribute('aria-label',label);
  b.title=label;
}

async function toggleWallet(){
  if(S.wallet){
    await disconnectWallet();
    S.wallet=null;S.walletKind=null;invalidateHistory();_warmed=false;
    VAULTS.forEach(v=>{v.pos=undefined});   // no wallet, no positions
    render();
    return toast('Wallet disconnected');
  }
  let w;
  try{
    w=await connectWallet();
  }catch(e){
    render();
    return toast(e.message);
  }

  S.wallet=w.short;S.walletKind=w.kind;
  render();
  // Naming the burner explicitly matters: a key in localStorage must never be
  // mistaken for the user's real wallet.
  toast(w.kind==='dev'
    ?`Dev wallet · ${w.short} — burner key, local cluster only`
    :`Wallet connected · ${w.short}`);

  /* The reads that follow are best-effort, and their failure is reported as
     what it is. They used to sit inside the connect try, so a rate-limited
     balance read — which a public devnet RPC does constantly, and more so with
     five vaults on the page than with three — surfaced as an error toast on a
     wallet that had in fact connected, and read as "the wallet won't connect". */
  try{
    await afterConnect();
    render();
  }catch(e){
    render();
    toast(`Connected, but reading ${CLUSTER} failed — ${e.message}`);
  }
}

/* ════════════════════════════ paint ════════════════════════════ */

/* fitCanvas returns null for a zero-size element, so the hidden view's canvases
   simply skip — no need to know which view is up. */
function drawCharts(){
  if($('featCh'))drawFill($('featCh'),cur());
  if($('heroCh'))drawFill($('heroCh'),cur());
  if($('finCh'))drawFinBars($('finCh'),cur().fin);
  if($('capCh'))drawCapRadar($('capCh'),cur());
  if($('mulCh'))drawMultiples($('mulCh'),cur().comparables);
}

function render(){
  renderCarousel();syncSlide();renderTicker();
  renderHero();renderHow();renderNumbers();renderRisk();renderRail();renderWallet();
  renderActivity();renderSocial();renderPortfolio();
  tickCountdowns();drawCharts();
}

/* ── one page: the poster, then the offering under it ──────────────────────
   There is no router any more. Everything the old detail view held now lives
   below the fold in the same document, so "open the offering" is a scroll. */
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const navH=()=>parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue('--nav-h'))||62;

/* ── router: the carousel, and the offering a card opens ──────────────────
   Two views again. The detail page is a click away rather than a scroll, so
   the poster stays a poster. */
function go(view,push){
  S.view=view==='vault'?'vault':view==='portfolio'?'portfolio':'landing';
  document.body.dataset.view=S.view;      // the artwork layer keys off this
  $('landing').style.display=S.view==='landing'?'flex':'none';
  $('offering').style.display=S.view==='vault'?'block':'none';
  $('portfolio').style.display=S.view==='portfolio'?'block':'none';
  // Off the landing, show the base artwork rather than whichever scene the
  // strip happened to have faded up — paintCards restores it on return.
  if(S.view!=='landing')
    $('landBg').querySelectorAll('.bgScene').forEach(l=>{l.style.opacity=0});
  // Nothing scheduled by the strip may survive leaving it.
  clearTimeout(window.__slideT);
  const hash=S.view==='vault'?'#/'+S.sel:S.view==='portfolio'?'#/portfolio':'#/';
  if(location.hash!==hash)history[push?'pushState':'replaceState'](null,'',hash);
  if(push)scrollTo(0,0);
  syncNav();
  SHELL?.routeChanged('preipo',S.view==='vault'?S.sel:S.view==='portfolio'?'portfolio':'');
  render();
}

/* The detail header leaves once you are past it, and comes back at the top —
   which is also where the way out of the offering is.
   Thresholded on position rather than on scroll direction: "gone once you
   scroll down" is the whole behaviour, and a reveal-on-scroll-up would put the
   plate back over the text on every small upward nudge. The threshold clears
   the bar itself, so the header is already off-screen by the time it hides and
   nothing appears to jump. */
const NAV_HIDE=110;
let navGone=false;
function syncNav(){
  const gone=(S.view==='vault'||S.view==='portfolio')&&scrollY>NAV_HIDE;
  if(gone===navGone)return;
  navGone=gone;
  document.querySelector('nav.top').classList.toggle('gone',gone);
}
addEventListener('scroll',syncNav,{passive:true});
$('portBtn').onclick=openPortfolio;
$('backLink').onclick=e=>{e.preventDefault();go('landing',true)};
$('pfBackLink').onclick=e=>{e.preventDefault();go('landing',true)};
function openVault(id){
  if(!VAULTS.some(v=>v.id===id))return;
  S.sel=id;S.tab='how';
  go('vault',true);
  // The position belongs to the offering just opened, not the last one.
  refreshPosition(cur()).then(()=>{renderRail();renderWallet()});
  refreshDeposits(cur()).then(ch=>{if(ch)renderTicker()});
}
function fromHash(){
  const seg=(location.hash||'#/').replace('#/','');
  if(seg==='portfolio')return 'portfolio';
  if(seg&&VAULTS.some(v=>v.id===seg)){S.sel=seg;return 'vault'}
  return 'landing';
}

/* The portfolio needs every vault's position, not just the one on screen, so it
   reads them all on the way in rather than on every render. */
/* Load the whole portfolio: every position, then the history. Split out from
   openPortfolio so it can also run when a wallet connects while the portfolio is
   already on screen — see afterConnect. */
function loadPortfolio(){
  renderPortfolio();                   // instant from whatever positions we hold
  /* On a warm open (preloaded when the wallet connected) positions are already
     in hand, so history is cached and its vault filter is correct — show it at
     once. On a cold open, defer it: firing it now, before positions are known,
     both draws the wrong vault set AND double-loads it against a rate-limited
     RPC (the once-early, once-after pair was exactly what left it empty). */
  const warm=VAULTS.some(v=>v.chainId&&v.pos&&((v.pos.sub||0)>0||(v.pos.tok||0)>0||(v.pos.redeemed||0)>0));
  renderHistory(undefined);            // "Reading…" until the first row lands
  if(warm)loadHistory(renderHistory);  // stream rows in, newest first
  refreshAllPositions(renderPortfolio).then(()=>{
    renderPortfolio();renderWallet();
    loadHistory(renderHistory);        // (re)stream once positions are settled
  });
}

/* Read positions and history in the background the moment a wallet connects, so
   the Portfolio is already warm by the time it is opened — the slow devnet RPC
   work happens while the reader is elsewhere rather than on the click. Both
   cache, so this is the one that pays the latency; the open just reads it. */
let _warmed=false;
function warmPortfolio(){
  if(_warmed||!chainLive())return;
  _warmed=true;
  refreshAllPositions().then(()=>loadHistory()).catch(()=>{});
}
function openPortfolio(){
  go('portfolio',true);
  loadPortfolio();
}
addEventListener('hashchange',()=>{
  const want=fromHash();
  if(want!==S.view)go(want);
});

/* ── sub-tabs ──────────────────────────────────────────────────────────────
   Same shape as the platform's vault detail: one panel visible at a time.
   Charts have to be redrawn on show — a canvas in a display:none panel has no
   measurable size, so fitCanvas skips it and it would come back blank. */
function showTab(key){
  document.querySelectorAll('#offering .vsec').forEach(x=>x.classList.toggle('on',x.id==='s-'+key));
  $('vnav').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.s===key));
  S.tab=key;
  drawCharts();
}
$('vnav').querySelectorAll('button').forEach(b=>{b.onclick=()=>showTab(b.dataset.s)});

/* strip controls */
$('prev').onclick=()=>slideTo(S.slide-1);
$('next').onclick=()=>slideTo(S.slide+1);
$('track').addEventListener('scroll',()=>{
  schedulePaint();                       // every frame: the sizes track the scroll
  clearTimeout(window.__slideT);         // on settle: the dots and selection follow
  /* Guarded on the view, because this fires 90ms after the last scroll event —
     long enough to land after a click has already opened an offering. It then
     reselects from a hidden strip and changes which vault a subscription would
     go to, with nothing on screen changing to say so. */
  window.__slideT=setTimeout(()=>{if(S.view==='landing')setSlide(centredIndex())},90);
},{passive:true});
addEventListener('resize',()=>{if(S.view==='landing')schedulePaint()});
$('track').addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'){e.preventDefault();slideTo(S.slide+1)}
  if(e.key==='ArrowLeft'){e.preventDefault();slideTo(S.slide-1)}
});

$('walletBtn').onclick=toggleWallet;

/* The platform drives theme, wallet and route from its own rail and links. */
if(SHELL)SHELL.register('preipo',{
  theme(t){document.documentElement.setAttribute('data-theme',t);drawCharts()},
  wallet(on){if(on!==!!S.wallet)toggleWallet()},
  route(path){
    if(path==='portfolio')return openPortfolio();
    if(VAULTS.some(v=>v.id===path))return openVault(path);
    go('landing',true);
  },
});

$('themeBtn').onclick=()=>{
  const next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  try{ localStorage.setItem('moonshot.theme',next) }catch{}
  drawCharts();               // canvas colours are resolved from the tokens
};
/* Until someone touches the toggle the page follows the system; after that their
   choice is stored and the system stops overriding it. */
matchMedia('(prefers-color-scheme: light)').addEventListener('change',e=>{
  if(SHELL)return;      // the platform's theme, not the system's
  let chosen=null;
  try{ chosen=localStorage.getItem('moonshot.theme') }catch{}
  if(chosen)return;
  document.documentElement.setAttribute('data-theme',e.matches?'light':'dark');
  drawCharts();
});

let rT;
addEventListener('resize',()=>{clearTimeout(rT);rT=setTimeout(drawCharts,120)});
setInterval(tickCountdowns,1000);
/* The vault is public and other people are depositing into it; a page left open
   should not keep quoting a cap that filled ten minutes ago. */
setInterval(async()=>{
  if(S.source!=='chain'||document.hidden)return;
  const vaultChanged=await syncAll({fresh:true});
  const depositsChanged=await refreshAllDeposits();
  if(vaultChanged||depositsChanged)render();
},60000);
/* Only the relative times move between polls, and re-rendering the whole run
   would restart the marquee. Patch the text in place instead. */
setInterval(()=>{if(!document.hidden)renderTicker()},60000);
