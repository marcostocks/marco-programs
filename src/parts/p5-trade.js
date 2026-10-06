
/* ════════ trade ════════ */
function fillPx(){const m=S.mkt,h=m.px*SPREAD_BPS/2/1e4;return S.side==='buy'?m.px+h:m.px-h}
function maxAmt(){
  const m=S.mkt,live=!DEMO_MODE&&m.chainTicker&&chainLive();
  if(S.side==='buy')return live?(S.chainUsdc??0):S.cash;
  // Sells against a chain-backed market size from the REAL token balance —
  // the simulated book may hold a stale position the program knows nothing of.
  if(live){const cp=(S.chainPos||{})[m.id];return cp?cp.tokens*fillPx():0}
  const p=S.pos[m.id];return p?p.sz*fillPx():0}
function openMarket(id){const m=M(id);if(!m)return;S.mkt=m;S.prev=0;go('trade')}
function setMode(mode){
  S.mode=mode;
  $('tradeStd').style.display=mode==='std'?'':'none';
  $('tradeAdv').style.display=mode==='adv'?'':'none';

  renderTape();
  renderTrade();
  if(mode==='adv')loadTV();
}
function renderTrade(){
  const m=S.mkt,d=S.series&&S.series.length?S.series:series(m.id,m.px,S.tf);S.series=d;
  const half=m.px*SPREAD_BPS/2/1e4;
  if(S.mode==='std')renderStd(m,d,half); else renderAdv(m,d,half);
  renderPositions();
  if(S.wlOpen)renderWatch();
}
function renderStd(m,d,half){
  $('hMark').textContent=m.n[0];
  $('hName').textContent=m.sym;                // the selector is named by the pair
  $('hSym').textContent=m.n;
  const el=$('px');
  el.innerHTML=money(m.px,dp(m.px)).replace('$','')+`<small>USDC</small>`;
  if(S.prev&&m.px!==S.prev){el.classList.remove('f-up','f-dn');void el.offsetWidth;
    el.classList.add(m.px>S.prev?'f-up':'f-dn');setTimeout(()=>el.classList.remove('f-up','f-dn'),620)}
  S.prev=m.px;
  const p=$('dPill');p.className='pill '+dir(m.chg);p.textContent=pctS(m.chg);
  $('dAbs').textContent=m.chg==null?'—':smoney(m.px*m.chg/100,dp(m.px));
  $('kVol').textContent=volTxt(m);$('kCap').textContent=compact(m.capN);
  $('kRange').textContent=m.lo?money(m.lo,dp(m.px))+' – '+money(m.hi,dp(m.px)):'—';
  $('bookCcy').textContent='USDC';
  $('amtCcy').innerHTML=usdc()+'<button id="amtMax">MAX</button>';
  $('amtMax').onclick=()=>{$('amt').value=maxAmt().toFixed(2);ticket()};
  $('tfs').innerHTML=TFS.map(t=>`<button class="tf ${t===S.tf?'on':''}" data-tf="${t}">${t}</button>`).join('');
  $('tfs').querySelectorAll('.tf').forEach(b=>b.onclick=()=>{S.tf=b.dataset.tf;
    S.series=series(m.id,m.px,S.tf);renderTrade()});
  S.geo=area($('chart'),d,{pad:16});
  renderBook(m,half);renderDetails(m,d,half);ticket();
}
const BOOK_IDS={a:'asks2',b:'bids2',px:'midPx2',spr:'midSpr2',n:20};
function renderBook(m,half,ids){
  ids=ids||{a:'asks',b:'bids',px:'midPx',spr:'midSpr'};
  if(!$(ids.a))return;
  const N=ids.n||8;
  const mid=m.px;let sd=hash(m.id),a='',b='',cA=0,cB=0;
  const rnd=()=>{sd=(sd*1664525+1013904223)>>>0;return sd/4294967296};
  // base depth is stable per market; a slow wave makes the book breathe like a live one
  const t=S.bookTick||0,sz=[];
  for(let i=0;i<N*2;i++){const base=rnd()*9+.6;
    sz.push(Math.max(.05,base*(1+.28*Math.sin(t*0.6+i*1.1))))}
  const mx=Math.max(...sz)*N*.62;
  for(let i=N-1;i>=0;i--){const px=mid+half+(i+1)*mid*4e-4;cA+=sz[i];
    a=`<div class="lvl a num"><span>${px.toFixed(dp(px))}</span><span>${qty(sz[i])}</span><span>${qty(cA)}</span><div class="dbar" style="width:${Math.min(100,cA/mx*100)}%"></div></div>`+a}
  for(let i=0;i<N;i++){const px=mid-half-(i+1)*mid*4e-4;cB+=sz[N+i];
    b+=`<div class="lvl b num"><span>${px.toFixed(dp(px))}</span><span>${qty(sz[N+i])}</span><span>${qty(cB)}</span><div class="dbar" style="width:${Math.min(100,cB/mx*100)}%"></div></div>`}
  $(ids.a).innerHTML=a;$(ids.b).innerHTML=b;
  $(ids.px).textContent=money(mid,dp(mid));
  $(ids.spr).textContent='Spread '+(half*2).toFixed(dp(mid))+' · '+SPREAD_BPS+' bps';
}
// keep whichever book is on screen ticking
function tickBook(){
  if(S.page!=='trade')return;
  S.bookTick=(S.bookTick||0)+1;
  const m=S.mkt,half=m.px*SPREAD_BPS/2/1e4;
  if(S.mode==='adv')renderBook(m,half,BOOK_IDS);
  else renderBook(m,half);
}
// feed items naming this market first, then the rest
function marketNews(m,n){
  const key='$'+m.sym.split('-')[0].toLowerCase(), nm=m.n.toLowerCase();
  const hit=[],rest=[];
  S.feed.forEach(p=>{const t=p.b.toLowerCase();
    (t.includes(key)||t.includes(nm)?hit:rest).push(p)});
  return hit.concat(rest).slice(0,n||3);
}
function renderDetails(m,d,half){
  const ab=$('dAbout');
  if(ab){
    const long=m.about.length>240;
    ab.innerHTML=`<div class="dsubh">About ${esc(m.n)}</div>
      <div class="r2p" style="margin-top:6px">${esc(S.dAboutOpen||!long?m.about:m.about.slice(0,240)+'… ')}${
        long?`<span class="r2more" id="dMore">${S.dAboutOpen?'Show less':'Show more'}</span>`:''}</div>`;
    const mo=$('dMore');
    if(mo)mo.onclick=()=>{S.dAboutOpen=!S.dAboutOpen;renderDetails(m,d,half)};
  }
  const nw=$('dNews');
  if(nw){
    nw.innerHTML=`<div class="dsubh" style="margin-top:18px">Latest news</div>`
      +marketNews(m,3).map((p,i)=>`<div class="r2news2" data-dn="${i}">
        <div class="r2nm">${esc(p.src)} · ${esc(p.t)} ago</div>
        <div class="r2nh">${esc(p.b.slice(0,150))}${p.b.length>150?'…':''}</div></div>`).join('');
    nw.querySelectorAll('[data-dn]').forEach(x=>x.onclick=()=>go('markets'));
  }
  const rows=[['Bid',money(m.px-half,dp(m.px))],['Ask',money(m.px+half,dp(m.px))],
    ['Last',money(m.px,dp(m.px))],['24h volume',volTxt(m)],
    ['24h high',m.hi?money(m.hi,dp(m.px)):'—'],['24h low',m.lo?money(m.lo,dp(m.px)):'—'],
    ['Market cap',compact(m.capN)],['P/E ratio',m.fin.pe],
    ['Shares out.',m.fin.shares],['Listing',m.fin.exch],
    ['Settlement','USDC'],['Class',m.k]];
  $('detailGrid').innerHTML=rows.map(r=>`<div class="cell"><div class="cellK">${r[0]}</div>
    <div class="cellV num">${r[1]}</div></div>`).join('');
}
function renderPositions(){
  // this card is scoped to whichever market is selected; the full book lives on Portfolio
  const m=S.mkt,p=S.pos[m.id];
  if(p&&p.sz>0){
    const val=p.sz*m.px,pl=(m.px-p.avg)*p.sz,pc=p.avg?(m.px-p.avg)/p.avg*100:0,u=pl>=0;
    $('tPos').innerHTML=`<tr>
      <td><span class="nm">${esc(m.n)}</span> <span class="mini num">${m.sym}</span></td>
      <td class="r num">${qty(p.sz,sizeDp(m))}</td><td class="r num">${money(p.avg,dp(m.px))}</td>
      <td class="r num">${money(m.px,dp(m.px))}</td><td class="r num">${money(val)}</td>
      <td class="r num ${u?'up':'dn'}">${smoney(pl)} <span style="opacity:.7">(${u?'+':''}${pc.toFixed(2)}%)</span></td></tr>`;
    $('tEq').textContent='Value '+money(val);
  }else{
    $('tPos').innerHTML=`<tr><td colspan="6" style="text-align:center;color:var(--mute);padding:32px">
      No open position in ${esc(m.sym)}</td></tr>`;
    $('tEq').textContent='No position';
  }
}

/* ── inline ticket (standard mode) ── */
function setSide(s){
  S.side=s;
  $('sBuy').classList.toggle('on',s==='buy');$('sSell').classList.toggle('on',s==='sell');
  const c=$('cta');c.classList.toggle('buy',s==='buy');c.classList.toggle('sell',s==='sell');
  ticket();
}
function ticket(){
  const m=S.mkt,amt=parseFloat($('amt').value)||0,f=fillPx(),fee=amt*FEE_BPS/1e4;
  const sh=f>0?(S.side==='buy'?amt-fee:amt)/f:0;
  const live=!DEMO_MODE&&m.chainTicker&&chainLive(),cp=live?(S.chainPos||{})[m.id]:null;
  $('avail').textContent=(S.side==='buy'?'Balance ':'Holding ')+
    (S.side==='buy'
      ?money(live?(S.chainUsdc??0):S.cash,0)
      :qty(live?(cp?.tokens??0):(S.pos[m.id]?S.pos[m.id].sz:0),sizeDp(m))+' '+m.sym);
  $('amtSub').textContent=(amt>0&&sh)?'\u2248 '+qty(sh,sizeDp(m))+' '+m.sym:'';
  $('sFill').textContent=money(f,dp(m.px));
  $('sSpread').textContent=amt?money(Math.abs(f-m.px)*sh):'—';
  $('sFee').textContent=amt?money(fee):'—';
  $('sTotal').textContent=amt?money(amt):'—';
  const ok=amt>0&&amt<=maxAmt()+1e-9;
  $('cta').disabled=!ok;
  $('cta').textContent=ok?`${S.side==='buy'?'Buy':'Sell'} ${money(amt,0)}`:(S.side==='buy'?'Buy':'Sell');
  const mx=maxAmt();$('rng').value=mx>0?Math.min(100,Math.round(amt/mx*100)):0;
}
function refCode(){return 'MX-'+String(hash(String(S.orders.length)+S.mkt.id)%100000).padStart(5,'0')}

/* ── live order status for the chain-backed market ─────────────────────────
   A trade reads as executed the moment its escrow confirms: the custodian's
   fill (deploy_buy + confirm_buy, or settle_sell) follows within seconds from
   the operator, and the screen does not make you wait for it. Until it lands
   the row shows the quoted fill; the poll below then swaps in the program's
   own execution price and size. Orders from earlier sessions are surfaced. */
const CHAIN_ORDER_LABELS={pending:'Filled',deployed:'Filled',
  filled:'Filled',settled:'Filled',cancelled:'Cancelled'};
async function syncChainOrders(){
  const m=S.mkt;
  if(DEMO_MODE||!m?.chainTicker||!chainLive())return;

  // Position and spendable USDC come from chain, not the page's simulated
  // books — the ticket's caps and the holdings table read these.
  try{
    (S.chainPos||(S.chainPos={}))[m.id]=await window.MarcoChain.getSpotPosition(m.chainTicker);
    S.chainUsdc=await window.MarcoChain.getUsdcBalance();
  }catch{}

  let orders=[];
  try{orders=await window.MarcoChain.getMyOrders(m.chainTicker)}catch{return}
  let changed=false;
  for(const o of orders){
    const label=CHAIN_ORDER_LABELS[o.status]||o.status;
    const row=S.orders.find(r=>r.ref==='#'+o.orderId&&r.name===m.n);
    if(!row){
      S.orders.push({time:'—',name:m.n,side:o.side,
        sz:o.shares?qty(o.shares,sizeDp(m)):'—',
        px:o.executionPrice||o.limitPrice,val:o.usdc,status:label,ref:'#'+o.orderId});
      changed=true;continue;
    }
    // The executed figures replace the quoted ones once the program has them.
    if((o.status==='filled'||o.status==='settled')&&o.executionPrice&&row.px!==o.executionPrice){
      if(o.shares)row.sz=qty(o.shares,sizeDp(m));
      row.px=o.executionPrice;changed=true;
    }
    if(row.status!==label){row.status=label;changed=true}
  }
  if(changed&&$('tpane'))renderPane();
}
setInterval(()=>{
  syncChainOrders().catch(()=>{});
  // fills land asynchronously (the operator confirms custody), so keep the
  // book current while the wallet is connected
  if(S.page==='portfolio'||S.page==='markets'||S.pending.length)loadChainBook().then(ok=>{
    if(!ok)return;
    if(S.page==='portfolio')renderPortfolio();
    if(S.page==='trade')renderTrade();
  }).catch(()=>{});
},15000);
async function exec(amtEl){
  const m=S.mkt,amt=parseFloat(amtEl.value)||0,f=fillPx(),fee=amt*FEE_BPS/1e4;
  if(!(amt>0)||amt>maxAmt()+1e-9)return;

  /* Chain-backed market: place a REAL order on marco-spot, holder-signed.
     Same rule as the vaults — never simulate silently when the chain bundle
     is present. The indicative price on screen is illustrative; what is real
     is the escrow, and the two protections the program enforces: a limit
     price (+2% over indicative) and a minimum fill (−2%). Fills arrive later
     when the operator confirms custody — nothing is predicted here. */
  if(!DEMO_MODE&&m.chainTicker){
    const c=await chain();
    if(c){
      if(!chainLive()){
        await setWallet(true);     // the shell's connect: rail, frames and book follow
        if(!chainLive())return;
      }
      const st=await window.MarcoChain.getSpotMarket(m.chainTicker).catch(()=>null);
      if(!st)return toast('Market not found on-chain.');
      if(!st.active)return toast(`Market is ${st.status} on-chain — no new orders.`);
      const t=await window.MarcoChain.getTraderStatus();
      if(!t.eligible)return toast('This wallet is not registered as an eligible trader.');

      const cta=$('cta')||amtEl,label=cta.textContent;
      if(cta.disabled!==undefined){cta.disabled=true;cta.textContent='Confirm in your wallet…'}
      try{
        if(S.side==='buy'){
          const limit=f*1.02,minOut=(amt*(1-st.feeBps/1e4))/limit*0.98;
          const {orderId}=await window.MarcoChain.spotBuy(m.chainTicker,amt,limit,minOut);
          // Executed as of now, at the quoted fill; the operator's confirm_buy
          // mints the tokens a few seconds later and the book re-reads them.
          const est=amt*(1-st.feeBps/1e4)/f;
          S.pending.push({ticker:m.chainTicker,mktId:m.id,orderId,side:'buy',sz:est,usdc:amt});
          const p=S.pos[m.id]||(S.pos[m.id]={sz:0,avg:0});
          p.avg=(p.avg*p.sz+amt)/(p.sz+est);p.sz+=est;
          S.cash=Math.max(0,S.cash-amt);S.chainUsdc=S.cash;
          S.orders.push({time:new Date().toTimeString().slice(0,5),name:m.n,side:'buy',
            sz:qty(est,sizeDp(m)),px:f,val:amt,status:'Filled',ref:'#'+orderId});
          toast(`Bought ${qty(est,sizeDp(m))} ${m.sym} at ${money(f,dp(m.px))} · order #${orderId}`);
        }else{
          const pos=await window.MarcoChain.getSpotPosition(m.chainTicker);
          const cp0=(S.chainPos||{})[m.id];
          const sh=Math.min(amt/f,pos.tokens);
          if(!(sh>0))return toast('No on-chain position to sell in this market.');
          const {orderId}=await window.MarcoChain.spotSell(m.chainTicker,sh,f*0.98);
          // Executed as of now; settle_sell pays the proceeds a few seconds later.
          const proceeds=sh*f*(1-st.feeBps/1e4);
          S.pending.push({ticker:m.chainTicker,mktId:m.id,orderId,side:'sell',proceeds});
          const p=S.pos[m.id];if(p){p.sz-=sh;if(p.sz<1e-8)delete S.pos[m.id]}
          S.cash+=proceeds;
          if(cp0)cp0.tokens=Math.max(0,cp0.tokens-sh);
          S.orders.push({time:new Date().toTimeString().slice(0,5),name:m.n,side:'sell',
            sz:qty(sh,sizeDp(m)),px:f,val:sh*f,status:'Filled',ref:'#'+orderId});
          toast(`Sold ${qty(sh,sizeDp(m))} ${m.sym} at ${money(f,dp(m.px))} · order #${orderId}`);
        }
        amtEl.value='';closeTicket();renderTrade();
      }catch(e){
        toast(`Order failed · ${(e.message||'').slice(0,120)}`);
      }finally{
        if(cta.disabled!==undefined){cta.disabled=false;cta.textContent=label}
      }
      return;
    }
    // No chain bundle beside the page (opened off disk): the simulation below
    // is that mode's honest behaviour.
  }
  const p=S.pos[m.id]||(S.pos[m.id]={sz:0,avg:0});
  const r=refCode();let sz;
  if(S.side==='buy'){sz=(amt-fee)/f;p.avg=(p.avg*p.sz+(amt-fee))/(p.sz+sz);p.sz+=sz;S.cash-=amt;
    toast(`Bought ${qty(sz,sizeDp(m))} ${m.sym} at ${money(f,dp(m.px))} · ${r}`)}
  else{sz=Math.min(amt/f,p.sz);p.sz-=sz;S.cash+=sz*f-fee;if(p.sz<1e-8)delete S.pos[m.id];
    toast(`Sold ${qty(sz,sizeDp(m))} ${m.sym} at ${money(f,dp(m.px))} · ${r}`)}
  S.orders.push({time:new Date().toTimeString().slice(0,5),name:m.n,side:S.side,
    sz:qty(sz,sizeDp(m)),px:f,val:amt,status:'Filled',ref:r});
  amtEl.value='';
  closeTicket();renderTrade();
}
/* ── stock picker — modelled on the index.html trade ticker dropdown ── */
let pickAnchor=null,pickHi=0,pickCat='all';
function pickRows(){
  const q=$('pickQ').value.trim().toLowerCase();
  return MARKETS.filter(m=>(pickCat==='all'||m.s===pickCat)&&
    (!q||m.n.toLowerCase().includes(q)||m.sym.toLowerCase().includes(q)));
}
function renderPick(){
  $('pickTabs').innerHTML=SECTORS.map(t=>
    `<button class="pickTab${t[0]===pickCat?' on':''}" data-pc="${t[0]}">${t[1]}</button>`).join('');
  $('pickTabs').querySelectorAll('[data-pc]').forEach(b=>b.onclick=()=>{
    pickCat=b.dataset.pc;pickHi=0;renderPick()});
  const rows=pickRows();
  if(pickHi>=rows.length)pickHi=Math.max(0,rows.length-1);
  const head=`<div class="pickHead"><span>Markets</span><span class="pickCol">Last price</span>
    <span class="pickCol">24h change</span><span class="pickCol">Volume</span></div>`;
  $('pickList').innerHTML=head+(rows.length?rows.map((m,i)=>
    `<div class="pickIt${m.id===S.mkt.id?' on':''}${i===pickHi?' hi':''}" data-p="${m.id}" role="option"
      aria-selected="${m.id===S.mkt.id}">
      <span class="pickMk"><span class="pickIc">${esc(m.n[0])}</span>
        <span class="pickNm num">${esc(m.sym)}</span>
        <span class="pickChips"><span class="pchip k">${esc(m.k)}</span></span></span>
      <span class="pickCol"><span class="pickPv num">${money(m.px,dp(m.px))}</span></span>
      <span class="pickCol"><span class="pickPd num ${dir(m.chg)}">${pctS(m.chg)}</span></span>
      <span class="pickCol"><span class="pickPv num">${volTxt(m)}</span></span></div>`).join('')
    :`<div class="pickNone">No markets match that search</div>`);
  $('pickList').querySelectorAll('[data-p]').forEach(el=>el.onclick=()=>choosePick(el.dataset.p));
}
let pickMode='trade';
function choosePick(id){
  closePick();
  if(pickMode==='chart'){pickMode='trade';S.chartMkt=id;
    renderHeroChart(M(id)||S.mkt);renderSectorRadar();renderSummary(M(id)||S.mkt);return}
  openMarket(id);
}
function openPick(anchor,mode){
  pickMode=mode||'trade';
  pickAnchor=anchor;pickCat='all';
  $('pickQ').value='';pickHi=Math.max(0,pickRows().findIndex(m=>m.id===S.mkt.id));renderPick();
  const menu=$('pickMenu');menu.classList.add('on');$('pickScrim').classList.add('on');
  anchor.setAttribute('aria-expanded','true');
  const r=anchor.getBoundingClientRect(),mw=menu.offsetWidth||480;
  menu.style.left=Math.max(12,Math.min(r.left,innerWidth-mw-12))+'px';
  menu.style.top=Math.min(r.bottom+6,innerHeight-menu.offsetHeight-12)+'px';
  setTimeout(()=>$('pickQ').focus(),30);
}
function closePick(){
  $('pickMenu').classList.remove('on');$('pickScrim').classList.remove('on');
  document.querySelectorAll('.picker').forEach(p=>p.setAttribute('aria-expanded','false'));
  pickAnchor=null;
}
function pickKey(e){
  if(!$('pickMenu').classList.contains('on'))return;
  const rows=pickRows();
  const move=d=>{pickHi=Math.max(0,Math.min(rows.length-1,pickHi+d));renderPick();
    const el=$('pickList').querySelector('.hi');if(el)el.scrollIntoView({block:'nearest'})};
  if(e.key==='ArrowDown'){e.preventDefault();move(1)}
  else if(e.key==='ArrowUp'){e.preventDefault();move(-1)}
  else if(e.key==='Enter'){e.preventDefault();if(rows[pickHi])choosePick(rows[pickHi].id)}
  else if(e.key==='Escape'){e.preventDefault();closePick()}
}

/* ── advanced mode (TradingView) ── */
// a market can name its own TradingView symbol (e.g. a real exchange listing);
// otherwise we chart the perp our quotes come from
function tvSymbol(m){
  if(m.tv)return m.tv;
  return m.v==='binance'?'BINANCE:'+m.f:'BITGET:'+m.f+'.P';
}

/* chart controls: indicator menu, candles/line, expand */
/* TradingView's embed ignores `favorites`, so the interval picker is ours */
const TV_INTERVALS=[['1','1m'],['5','5m'],['15','15m'],['30','30m'],['60','1h'],
  ['120','2h'],['240','4h'],['D','1D'],['W','1W'],['M','1M']];
if(!S.tvInt)S.tvInt='60';
const intLabel=v=>(TV_INTERVALS.find(x=>x[0]===v)||['','1h'])[1];
const STUDIES=[['MACD','MACD@tv-basicstudies'],['RSI','RSI@tv-basicstudies'],
  ['Volume','Volume@tv-basicstudies'],['Bollinger Bands','BB@tv-basicstudies'],
  ['Moving average','MASimple@tv-basicstudies']];
if(!S.studies)S.studies={MACD:1,RSI:1};
if(!S.ctype)S.ctype='candles';
const ICO_CANDLE=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round"><path d="M8 3v3M8 18v3M16 4v4M16 16v4"/>
  <rect x="5.5" y="6" width="5" height="12" rx="1.2"/><rect x="13.5" y="8" width="5" height="8" rx="1.2"/></svg>`;
const ICO_LINE=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5.5-6.5 4 3.2L18 5"/><path d="M14 5h4v4"/></svg>`;
const ICO_TICK=`<svg viewBox="0 0 24 24"><path d="M5 12.6l4.2 4.2L19 6.6"/></svg>`;
function renderIndMenu(){
  const mn=$('indMenu');if(!mn)return;
  mn.innerHTML=STUDIES.map(([k])=>`<div class="indrow ${S.studies[k]?'on':''}" data-ind="${k}"
    role="menuitemcheckbox" aria-checked="${!!S.studies[k]}">
    <span class="indck">${ICO_TICK}</span><span>${k}</span></div>`).join('');
  mn.querySelectorAll('[data-ind]').forEach(r=>r.onclick=()=>{
    const k=r.dataset.ind;S.studies[k]=S.studies[k]?0:1;
    renderIndMenu();loadTV();     // studies are a construction option, so the widget rebuilds
  });
}
function renderIntMenu(){
  const mn=$('intMenu');if(!mn)return;
  mn.innerHTML=TV_INTERVALS.map(([v,l])=>`<div class="indrow ${S.tvInt===v?'on':''}" data-int="${v}"
    role="menuitemradio" aria-checked="${S.tvInt===v}">
    <span class="indck">${ICO_TICK}</span><span>${l}</span></div>`).join('');
  mn.querySelectorAll('[data-int]').forEach(r=>r.onclick=()=>{
    S.tvInt=r.dataset.int;
    if($('intLbl'))$('intLbl').textContent=intLabel(S.tvInt);
    renderIntMenu();mn.classList.remove('on');loadTV();
  });
}
function initChartCtl(){
  const ib=$('indBtn'),mn=$('indMenu'),ct=$('ctype'),cf=$('cfull');
  const itb=$('intBtn'),itm=$('intMenu');
  if($('intLbl'))$('intLbl').textContent=intLabel(S.tvInt);
  if(itb&&itm&&!itb.dataset.wired){
    itb.dataset.wired='1';
    renderIntMenu();
    const shutInt=()=>{itm.classList.remove('on');
      itb.classList.remove('on');itb.setAttribute('aria-expanded','false')};
    itb.onclick=e=>{e.stopPropagation();
      const on=itm.classList.toggle('on');
      itb.classList.toggle('on',on);itb.setAttribute('aria-expanded',on)};
    itm.onclick=e=>e.stopPropagation();
    document.addEventListener('click',shutInt);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')shutInt()});
  }
  if(ct)ct.innerHTML=S.ctype==='line'?ICO_LINE:ICO_CANDLE;
  const shut=()=>{if(!mn)return;mn.classList.remove('on');
    ib.classList.remove('on');ib.setAttribute('aria-expanded','false')};
  if(ib&&mn&&!ib.dataset.wired){
    ib.dataset.wired='1';
    renderIndMenu();
    ib.onclick=e=>{e.stopPropagation();
      const on=mn.classList.toggle('on');
      ib.classList.toggle('on',on);ib.setAttribute('aria-expanded',on)};
    mn.onclick=e=>e.stopPropagation();
    document.addEventListener('click',shut);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')shut()});
  }
  if(ct&&!ct.dataset.wired){
    ct.dataset.wired='1';
    ct.onclick=()=>{S.ctype=S.ctype==='line'?'candles':'line';
      ct.innerHTML=S.ctype==='line'?ICO_LINE:ICO_CANDLE;loadTV()};
  }
  if(cf&&!cf.dataset.wired){
    cf.dataset.wired='1';
    const tc=cf.closest('.tc');
    cf.onclick=()=>tc.classList.toggle('full');
    document.addEventListener('keydown',e=>{if(e.key==='Escape')tc.classList.remove('full')});
  }
}
let tvTimer=null;
function loadTV(){
  const m=S.mkt,host=$('tvchart');if(!host)return;
  host.innerHTML='';$('tvfall').classList.remove('on');
  if(!window.TradingView||!window.TradingView.widget){showFallback();return}
  try{
    const light=document.documentElement.getAttribute('data-theme')==='light';
    new window.TradingView.widget({
      container_id:'tvchart',symbol:tvSymbol(m),interval:S.tvInt,autosize:true,
      theme:light?'light':'dark',style:S.ctype==='line'?'2':'1',locale:'en',timezone:'Etc/UTC',
      hide_side_toolbar:false,          // TV's drawing-tools rail down the left
      hide_top_toolbar:true,            // its bar carries a background + rule we can't restyle
      hide_volume:true,
      allow_symbol_change:false,
      withdateranges:false,   // drops the 1D/5D/All footer strip
      studies:STUDIES.filter(x=>S.studies[x[0]]).map(x=>x[1]),

      // the embed widget ignores `overrides`; these top-level params are the supported way
      gridColor:'rgba(0,0,0,0)',        // no grid, per the reference
      backgroundColor:cssv('--bg')||(light?'#ffffff':'#0b0b0d'),
      // the legend prints the upstream venue in the symbol string — keep it hidden
      // (`disabled_features` is charting-library only — the free embed drops it)
      hide_legend:true,hide_symbol_logo:true,save_image:false,details:false});
    clearTimeout(tvTimer);
    tvTimer=setTimeout(()=>{if(!host.querySelector('iframe'))showFallback()},4500);
  }catch(e){showFallback()}
}
function showFallback(){
  $('tvfall').classList.add('on');
  // setTimeout, not rAF — rAF can be throttled to never fire in embedded views
  let tries=0;
  const draw=()=>{const cv=$('fallChart');if(!cv)return;
    if((!cv.clientHeight||!cv.clientWidth)&&tries++<40)return setTimeout(draw,50);
    (S.ctype==='line'?area:candles)(cv,S.series,{pad:14})};
  draw();setTimeout(draw,80);
}
/* Technicals reading — derived only from live data we actually have:
   where the last price sits in the real 24h range, plus the 24h change. */
function techScore(m){
  if(m.chg==null||!m.hi||m.hi<=m.lo)return null;
  const pos=Math.max(0,Math.min(1,(m.px-m.lo)/(m.hi-m.lo)));
  const mom=Math.max(0,Math.min(1,(m.chg+4)/8));
  return Math.round((pos*0.45+mom*0.55)*100);
}
function techLabel(v){
  return v<20?['Strong sell','dn']:v<40?['Sell','dn']:v<60?['Neutral','']:v<80?['Buy','up']:['Strong buy','up'];
}
function gauge(v){
  const a=Math.PI*(1-(v==null?50:v)/100), cx=110,cy=92,r=74;
  const x=cx+r*Math.cos(a), y=cy-r*Math.sin(a);
  const arc=(f,t,col,w)=>{const a1=Math.PI*(1-f/100),a2=Math.PI*(1-t/100);
    return `<path d="M ${cx+r*Math.cos(a1)} ${cy-r*Math.sin(a1)} A ${r} ${r} 0 0 1 ${cx+r*Math.cos(a2)} ${cy-r*Math.sin(a2)}"
      fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`};
  return `<svg viewBox="0 0 220 104" aria-hidden="true">
    ${arc(0,38,cssv('--down'),9)}${arc(40,60,cssv('--mute'),9)}${arc(62,100,cssv('--up'),9)}
    <line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${cssv('--ink')}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="${cssv('--ink')}"/></svg>`;
}
function railNews(m){
  const key=m.sym.split('-')[0];
  const p=S.feed.find(x=>x.b.includes('$'+key))||S.feed.find(x=>x.b.toLowerCase().includes(m.n.toLowerCase()))||S.feed[0];
  return `<div class="r2news" data-news="1"><span class="r2bolt">⚡</span>
    <span><b style="color:var(--ink);font-weight:500">${esc(p.t)} · ${esc(p.src)}</b> — ${esc(p.b.slice(0,96))}${p.b.length>96?'…':''}</span></div>`;
}
function renderAdv(m,d,half){
  // the selector capsule carries the symbol alone — no mark, no name, no class
  $('tsi').style.display='none';$('tsi').textContent='';
  $('tname').textContent=m.sym;
  $('tsub').style.display='none';$('tsub').textContent='';
  // header reads as labelled stat columns; change is absolute / percent
  const chg=m.chg==null?'—'
    :smoney(m.px*m.chg/100,dp(m.px))+' / '+pctS(m.chg);
  $('hstats').innerHTML=[
    ['Price',money(m.px,dp(m.px)),''],
    ['24h Change',chg,dir(m.chg)],
    ['24h Volume',m.nolive?'—':compact(m.vol).replace('$','')+' USDC',''],
    ['Market Cap',compact(m.capN).replace('$','')+' USDC',''],
  ].map(r=>`<div class="hstat"><div class="hk">${r[0]}</div>
    <div class="hv num ${r[2]}">${r[1]}</div></div>`).join('');
  const st=$('tstar');
  if(st){st.className='tstar'+(S.watch[m.id]?' on':'');st.innerHTML=STAR();
    st.setAttribute('aria-label',(S.watch[m.id]?'Unpin ':'Pin ')+m.n);
    st.onclick=()=>{S.watch[m.id]=S.watch[m.id]?0:1;renderTrade();renderTape()}}
  initChartCtl();

  // performance across periods, read off the illustrative series (labelled as such)
  const per=[['1W','1W'],['1M','1M'],['3M','3M'],['1Y','1Y']].map(([tf,lab])=>{
    const a=series(m.id,m.px,tf);const chg=(a[a.length-1]-a[0])/a[0]*100;
    return{lab,chg}});
  const tv=techScore(m),tl=techLabel(tv==null?50:tv);

  // rail follows the reference's information order: price → mini chart →
  // market details → financials → about → news, with our additions after
  $('rail2').innerHTML=`
    <div class="r2card">
      <div class="r2head"><span style="min-width:0">
        <span class="h3" style="display:block">${esc(m.n)}</span>
        <span class="mini">${esc(m.sym)}</span></span></div>
      <div class="r2px num">${money(m.px,dp(m.px)).replace('$','')}<small>USDC</small></div>
      <div class="num ${dir(m.chg)}" style="font-size:13px;margin-top:5px">${m.chg==null?'—':smoney(m.px*m.chg/100,dp(m.px))+' ('+pctS(m.chg)+') today'}</div>
      <div class="cwrap" style="height:132px;margin-top:12px"><canvas id="r2chart"></canvas></div>
      <div class="r2tfs" id="r2tfs">${TFS.map(t=>`<button class="r2tf ${t===S.tf?'on':''}" data-rtf="${t}">${t}</button>`).join('')}</div>
    </div>

    <div class="r2card" id="advTicket"></div>

    <div class="r2card">
      <div class="h3">Market details</div>
      <div class="r2g3">${[['Bid',money(m.px-half,dp(m.px))],['Ask',money(m.px+half,dp(m.px))],
        ['Last sale',money(m.px,dp(m.px))],['24h volume',volTxt(m)],
        ['24h high',m.hi?money(m.hi,dp(m.px)):'—'],['24h low',m.lo?money(m.lo,dp(m.px)):'—'],
        ['Spread',(SPREAD_BPS/100).toFixed(2)+'%'],['Settlement','USDC'],['Class',m.k]]
        .map(r=>`<div><div class="r2k">${r[0]}</div><div class="r2v num">${r[1]}</div></div>`).join('')}</div>
    </div>

    <div class="r2card" id="r2shareCard">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
        <span class="h3">Market Share</span><span class="mini">By capitalisation, vs immediate rivals</span></div>
      <div class="r2radar"><canvas id="r2share"></canvas></div>
      <div class="r2shareL" id="r2shareL"></div>
    </div>

    <div class="r2card">
      <div class="h3">Financials</div>
      <div class="r2g3">${[['Market cap',compact(m.capN)],['P/E ratio',m.fin.pe],
        ['Shares out.',m.fin.shares],['Listing',m.fin.exch]]
        .map(r=>`<div><div class="r2k">${r[0]}</div><div class="r2v num">${r[1]}</div></div>`).join('')}</div>
    </div>

    <div class="r2card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span class="h3">Performance</span><span class="mini">Illustrative</span></div>
      <div class="perf">${per.map(p=>`<div class="perfT ${p.chg>=0?'up':'dn'}">
        <span class="perfV num">${(p.chg>=0?'+':'')+p.chg.toFixed(2)}%</span>
        <span class="perfL">${p.lab}</span></div>`).join('')}
        <div class="perfT ${dir(m.chg)}"><span class="perfV num">${pctS(m.chg)}</span><span class="perfL">24h</span></div>
        <div class="perfT"><span class="perfV num">${m.hi?(((m.hi-m.lo)/m.lo)*100).toFixed(2)+'%':'—'}</span>
          <span class="perfL">24h range</span></div></div>
    </div>

    <div class="r2card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="h3">Technicals</span><span class="mini">24h</span></div>
      <div class="gauge">${gauge(tv)}
        <div class="gaugeL"><span>Sell</span><span>Neutral</span><span>Buy</span></div>
        <span class="gaugePill ${tl[1]}" style="background:${tl[1]==='up'?'color-mix(in srgb,var(--up) 16%,transparent)':tl[1]==='dn'?'color-mix(in srgb,var(--down) 16%,transparent)':'var(--surface-2)'}">${tl[0]}</span></div>
      <div class="mini" style="margin-top:10px;line-height:1.45">From the live 24h range position and 24h change.</div>
    </div>

    <div class="r2card">
      <div class="h3">About</div>
      <div class="r2p" id="r2about">${esc(S.aboutOpen?m.about:m.about.slice(0,150)+(m.about.length>150?'… ':''))}${
        m.about.length>150?`<span class="r2more" id="r2more">${S.aboutOpen?'Show less':'Show more'}</span>`:''}</div>
    </div>

    <div class="r2card">
      <div class="h3" style="margin-bottom:4px">News</div>
      ${S.feed.slice(0,4).map((p,i)=>`<div class="r2news2" data-news="${i}">
        <div class="r2nm">${esc(p.src)} · ${esc(p.t)} ago</div>
        <div class="r2nh">${esc(p.b.slice(0,110))}${p.b.length>110?'…':''}</div></div>`).join('')}
    </div>
`;

  area($('r2chart'),d,{pad:8,axis:true,ref:false,
    times:['','','','now']});
  $('r2tfs').querySelectorAll('[data-rtf]').forEach(btn=>btn.onclick=()=>{
    S.tf=btn.dataset.rtf;S.series=series(m.id,m.px,S.tf);renderTrade()});
  const more=$('r2more');if(more)more.onclick=()=>{S.aboutOpen=!S.aboutOpen;renderTrade()};
  $('rail2').querySelectorAll('[data-news]').forEach(n=>n.onclick=()=>go('markets'));
  const nb=$('rail2').querySelector('[data-news]');if(nb)nb.onclick=()=>go('markets');
  renderShareRadar(m);
  renderObk();
  renderBook(m,half,BOOK_IDS);
  renderAdvTicket();renderPane();initSplit();initBookPane();initRailPane();
  if($('tvfall').classList.contains('on'))showFallback();
}

function renderObk(){
  const el=$('obk');if(!el)return;
  el.innerHTML=`
    <div class="obkH"><span class="h3" style="font-size:15px">Order book</span>
      <span class="mini">USDC</span></div>
    <div class="book">
      <div class="bh"><span>Price</span><span>Size</span><span>Total</span></div>
      <div id="asks2"></div>
      <div class="mid"><b class="num" id="midPx2">\u2014</b><span class="num" id="midSpr2">\u2014</span></div>
      <div id="bids2"></div></div>`;
}
const BOOK_W=262, BOOK_MIN=196, BOOK_MAX=460;
const uiZoom=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z'))||1;
function setBookW(px){
  S.bookW=Math.min(BOOK_MAX,Math.max(BOOK_MIN,Math.round(px)));
  const tl=document.querySelector('.tl');
  if(tl)tl.style.setProperty('--bookw',S.bookW+'px');
}
function setBookOpen(on){
  S.bookOpen=on;
  const tl=document.querySelector('.tl');
  if(tl)tl.dataset.book=on?'on':'off';
  const b=$('obkBtn');
  if(b){b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))}
}
function initBookPane(){
  if(S.bookOpen==null)S.bookOpen=true;
  setBookOpen(S.bookOpen);
  setBookW(S.bookW||BOOK_W);
  const sp=$('vsplit');
  const btn=$('obkBtn');
  if(btn&&!btn.dataset.wired){btn.dataset.wired='1';
    btn.onclick=()=>setBookOpen(!S.bookOpen)}
  if(!sp||sp.dataset.wired)return;
  sp.dataset.wired='1';
  let x0=0,w0=0,drag=false;
  sp.addEventListener('pointerdown',e=>{
    drag=true;x0=e.clientX;w0=$('obk').offsetWidth;
    sp.setPointerCapture(e.pointerId);sp.classList.add('on');e.preventDefault()});
  sp.addEventListener('pointermove',e=>{
    if(drag)setBookW(w0-(e.clientX-x0)/uiZoom())});   // drag left = wider book
  const end=e=>{if(!drag)return;drag=false;sp.classList.remove('on');
    try{sp.releasePointerCapture(e.pointerId)}catch(_){}};
  sp.addEventListener('pointerup',end);
  sp.addEventListener('pointercancel',end);
  sp.addEventListener('dblclick',()=>setBookW(BOOK_W));
  sp.addEventListener('keydown',e=>{
    const step=e.shiftKey?48:16;
    if(e.key==='ArrowLeft'){e.preventDefault();setBookW(($('obk').offsetWidth)+step)}
    else if(e.key==='ArrowRight'){e.preventDefault();setBookW(($('obk').offsetWidth)-step)}
    else if(e.key==='Home'){e.preventDefault();setBookW(BOOK_W)}});
}

const RAIL_W=344, RAIL_MIN=280, RAIL_MAX=620;
function setRailW(px){
  S.railW=Math.min(RAIL_MAX,Math.max(RAIL_MIN,Math.round(px)));
  const tl=document.querySelector('.tl');
  if(tl)tl.style.setProperty('--railw',S.railW+'px');
  try{localStorage.setItem('marco.railw',S.railW)}catch(e){}
  renderShareRadar(S.mkt);            // the radar canvas has to be redrawn at the new width
}
function initRailPane(){
  setRailW(S.railW||RAIL_W);
  const sp=$('rsplit');
  if(!sp||sp.dataset.wired)return;
  sp.dataset.wired='1';
  let x0=0,w0=0,drag=false;
  sp.addEventListener('pointerdown',e=>{
    drag=true;x0=e.clientX;w0=$('rail2').offsetWidth;
    sp.setPointerCapture(e.pointerId);sp.classList.add('on');e.preventDefault()});
  sp.addEventListener('pointermove',e=>{
    if(drag)setRailW(w0-(e.clientX-x0)/uiZoom())});   // drag left = wider rail
  const end=e=>{if(!drag)return;drag=false;sp.classList.remove('on');
    try{sp.releasePointerCapture(e.pointerId)}catch(_){}};
  sp.addEventListener('pointerup',end);
  sp.addEventListener('pointercancel',end);
  sp.addEventListener('dblclick',()=>setRailW(RAIL_W));
  sp.addEventListener('keydown',e=>{
    const step=e.shiftKey?48:16;
    if(e.key==='ArrowLeft'){e.preventDefault();setRailW($('rail2').offsetWidth+step)}
    else if(e.key==='ArrowRight'){e.preventDefault();setRailW($('rail2').offsetWidth-step)}
    else if(e.key==='Home'){e.preventDefault();setRailW(RAIL_W)}});
}

/* Chart height is whatever the bottom pane leaves behind (.tvwrap is flex:1),
   so the splitter resizes the pane and the chart takes up the slack. */
const PANE_H=112, PANE_MIN=44;
function paneMax(){return Math.max(PANE_MIN,Math.round(window.innerHeight/uiZoom()*0.6))}
function setPane(h){
  const p=$('tpane');if(!p)return;
  S.paneH=Math.min(paneMax(),Math.max(PANE_MIN,Math.round(h)));
  p.style.height=S.paneH+'px';
}
function initSplit(){
  if(S.paneH)setPane(S.paneH);            // survives re-renders and mode switches
  const sp=$('tsplit');if(!sp||sp.dataset.wired)return;
  sp.dataset.wired='1';
  let y0=0,h0=0,drag=false;
  sp.addEventListener('pointerdown',e=>{
    drag=true;y0=e.clientY;h0=$('tpane').offsetHeight;
    sp.setPointerCapture(e.pointerId);sp.classList.add('on');e.preventDefault();
  });
  sp.addEventListener('pointermove',e=>{
    if(drag)setPane(h0-(e.clientY-y0)/uiZoom());  // drag down → shorter pane → taller chart
  });
  const end=e=>{
    if(!drag)return;
    drag=false;sp.classList.remove('on');
    try{sp.releasePointerCapture(e.pointerId)}catch(_){}
  };
  sp.addEventListener('pointerup',end);
  sp.addEventListener('pointercancel',end);
  sp.addEventListener('dblclick',()=>setPane(PANE_H));
  sp.addEventListener('keydown',e=>{
    const step=e.shiftKey?48:16;
    if(e.key==='ArrowUp'){e.preventDefault();setPane(($('tpane').offsetHeight)+step)}
    else if(e.key==='ArrowDown'){e.preventDefault();setPane(($('tpane').offsetHeight)-step)}
    else if(e.key==='Home'){e.preventDefault();setPane(PANE_H)}
  });
}
function renderPane(){
  const p=$('tpane');
  if(S.tab==='orders'){
    const o=S.orders.filter(x=>x.status==='pending');
    p.innerHTML=o.length?tbl(o):`<div class="tempty">No pending orders</div>`;
  }else if(S.tab==='holdings'){
    // One row per market. A chain-backed market with a wallet connected shows
    // the REAL on-chain position (balance + cost basis from the program's
    // Holding record) and suppresses any stale simulated entry for the same
    // market — two rows for one holding would both be wrong.
    const liveIds=!DEMO_MODE&&chainLive()
      ?Object.keys(S.chainPos||{}).filter(id=>(S.chainPos[id]?.tokens||0)>0):[];
    const rows=Object.keys(S.pos)
      .filter(k=>S.pos[k].sz>0&&!liveIds.includes(k))
      .map(id=>({id,sz:S.pos[id].sz,avg:S.pos[id].avg,live:false}))
      .concat(liveIds.map(id=>({id,sz:S.chainPos[id].tokens,avg:S.chainPos[id].avgCost,live:true})));
    p.innerHTML=rows.length?`<table><thead><tr><th scope="col">Market</th><th scope="col" class="r">Size</th>
      <th scope="col" class="r">Avg</th><th scope="col" class="r">Mark</th><th scope="col" class="r">Value</th>
      <th scope="col" class="r">P&amp;L</th></tr></thead><tbody>`+
      rows.map(({id,sz,avg,live})=>{const m=M(id),val=sz*m.px,pl=(m.px-avg)*sz;
        return `<tr data-go="${id}"><td><span class="nm">${esc(m.n)}</span>${live?' <span class="mini" style="opacity:.7">on-chain</span>':''}</td>
          <td class="r num">${qty(sz,sizeDp(m))}</td><td class="r num">${money(avg,dp(m.px))}</td>
          <td class="r num">${money(m.px,dp(m.px))}</td><td class="r num">${money(val)}</td>
          <td class="r num ${pl>=0?'up':'dn'}">${smoney(pl)}</td></tr>`}).join('')+
      '</tbody></table>':`<div class="tempty">No holdings</div>`;
    p.querySelectorAll('[data-go]').forEach(r=>r.onclick=()=>openMarket(r.dataset.go));
  }else if(S.tab==='screener'){
    p.innerHTML=`<table><thead><tr><th scope="col">Ticker</th><th scope="col">Market</th>
      <th scope="col" class="r">Price</th><th scope="col" class="r">24h</th>
      <th scope="col" class="r">Volume</th><th scope="col" class="r">Signal</th></tr></thead><tbody>`+
      MARKETS.map(x=>{const v=techScore(x),l=techLabel(v==null?50:v);
        return `<tr data-go="${x.id}"><td class="nm num">${esc(x.sym.split('-')[0])}</td>
          <td>${esc(x.n)}</td><td class="r num">${money(x.px,dp(x.px))}</td>
          <td class="r num ${dir(x.chg)}">${pctS(x.chg)}</td>
          <td class="r num">${volTxt(x)}</td>
          <td class="r ${l[1]}">${l[0]}</td></tr>`}).join('')+'</tbody></table>';
    p.querySelectorAll('[data-go]').forEach(r=>r.onclick=()=>openMarket(r.dataset.go));
  }else p.innerHTML=S.orders.length?tbl(S.orders):`<div class="tempty">No order history</div>`;
}
function tbl(rows){
  return `<table><thead><tr><th scope="col">Time</th><th scope="col">Market</th><th scope="col">Side</th>
    <th scope="col" class="r">Size</th><th scope="col" class="r">Price</th><th scope="col" class="r">Value</th>
    <th scope="col" class="r">Status</th></tr></thead><tbody>`+
    rows.slice().reverse().map(o=>`<tr><td class="num">${o.time}</td><td><span class="nm">${esc(o.name)}</span></td>
      <td class="${o.side==='buy'?'up':'dn'}" style="text-transform:capitalize">${o.side}</td>
      <td class="r num">${o.sz}</td><td class="r num">${money(o.px,dp(o.px))}</td>
      <td class="r num">${money(o.val)}</td><td class="r mini">${o.status} · ${o.ref}</td></tr>`).join('')+'</tbody></table>';
}
/* share of the immediate competitive set, for the advanced rail */
function renderShareRadar(m){
  const card=$('r2shareCard'),cv=$('r2share');if(!card||!cv)return;
  const rows=rivalRows(m);
  if(rows.length<3){card.style.display='none';return}
  card.style.display='';
  drawShareRadar(cv,rows,{hi:cssv('--acc')});
  const lst=$('r2shareL');
  if(lst)lst.innerHTML=rows.slice().sort((a,b)=>b.share-a.share).map(r=>
    `<div class="r2sr${r.own?' on':''}"><span class="r2srN">${esc(r.n)}</span>
      <span class="r2srV num">${(r.share*100).toFixed(1)}%</span></div>`).join('');
}
/* inline order ticket — always visible in advanced mode */
function renderAdvTicket(){
  const m=S.mkt,box=$('advTicket');if(!box)return;
  box.innerHTML=`<div class="h3" style="margin-bottom:10px">Order ticket</div>`+`
    <div class="seg"><button class="buy ${S.side==='buy'?'on':''}" id="tkBuy">Buy</button>
      <button class="sell ${S.side==='sell'?'on':''}" id="tkSell">Sell</button></div>
    <div class="depbox">
      <div class="depTop"><span class="depL">Amount</span><span class="depL num" id="tkAvail">—</span></div>
      <input id="tkAmt" type="number" placeholder="0" min="0" class="num depAmt" aria-label="Amount">
      <div class="depBot"><span class="depSub num" id="tkSh">—</span>
        <span class="depUnit">${usdc()}<button id="tkMaxB">MAX</button></span></div>
    </div>
    <input class="rng" id="tkRng" type="range" min="0" max="100" value="0" aria-label="Percent of available">
    <div class="scale num"><span>0</span><span>25</span><span>50</span><span>75</span><span>100%</span></div>
    <button class="cta ${S.side}" id="tkCta" disabled>${S.side==='buy'?'Buy':'Sell'}</button>
    <div class="sum" style="margin-top:16px">
      <div class="row"><span>Fill price</span><b class="num" id="tkFill">—</b></div>
      <div class="row"><span>Spread <i>0.15%</i></span><b class="num" id="tkSpr">—</b></div>
      <div class="row"><span>Fee <i>0.25%</i></span><b class="num" id="tkFee">—</b></div>
      <div class="row tot"><span>Total</span><b class="num" id="tkTot">—</b></div></div>`;
  const upd=()=>{
    const amt=parseFloat($('tkAmt').value)||0,f=fillPx(),fee=amt*FEE_BPS/1e4;
    const sh=f>0?(S.side==='buy'?amt-fee:amt)/f:0;
    $('tkAvail').textContent=(S.side==='buy'?'Balance ':'Holding ')+
      (S.side==='buy'?money(S.cash,0):qty(S.pos[m.id]?S.pos[m.id].sz:0,sizeDp(m))+' '+m.sym);
    $('tkSh').textContent=(amt>0&&sh)?'\u2248 '+qty(sh,sizeDp(m))+' '+m.sym:'';
    $('tkFill').textContent=money(f,dp(m.px));
    $('tkSpr').textContent=amt?money(Math.abs(f-m.px)*sh):'—';
    $('tkFee').textContent=amt?money(fee):'—';
    $('tkTot').textContent=amt?money(amt):'—';
    const ok=amt>0&&amt<=maxAmt()+1e-9;
    $('tkCta').disabled=!ok;
    $('tkCta').textContent=ok?`${S.side==='buy'?'Buy':'Sell'} ${money(amt,0)}`:(S.side==='buy'?'Buy':'Sell');
    const mx=maxAmt();$('tkRng').value=mx>0?Math.min(100,Math.round(amt/mx*100)):0;
  };
  $('tkBuy').onclick=()=>{S.side='buy';renderAdvTicket()};
  $('tkSell').onclick=()=>{S.side='sell';renderAdvTicket()};
  $('tkAmt').oninput=upd;
  $('tkMaxB').onclick=()=>{$('tkAmt').value=maxAmt().toFixed(2);upd()};
  $('tkRng').oninput=()=>{const mx=maxAmt();$('tkAmt').value=mx>0?(mx*$('tkRng').value/100).toFixed(2):'';upd()};
  $('tkCta').onclick=()=>exec($('tkAmt'));
  upd();
}
function openTicket(side){S.side=side;renderAdvTicket();
  const el=$('tkAmt');if(el){el.focus();el.scrollIntoView({block:'nearest'})}}
function closeTicket(){$('tick').classList.remove('on');$('scrim').classList.remove('on')}

/* ════════ portfolio ════════ */
function spotVal(){return Object.keys(S.pos).reduce((a,id)=>{const m=M(id);return a+(m?S.pos[id].sz*m.px:0)},0)}
function spotCost(){return Object.keys(S.pos).reduce((a,id)=>a+S.pos[id].sz*S.pos[id].avg,0)}
function vaultVal(){return Object.keys(S.vpos).reduce((a,id)=>{const p=S.vpos[id],v=V(id);
  return a+p.tok*(v&&v.nrv?v.nrv:1)+p.sh*(v&&v.ipoPx?v.ipoPx:0)},0)}
function renderPortfolio(){
  const sv=spotVal(),vv=vaultVal(),eq=S.cash+sv+vv,pnl=sv-spotCost(),u=pnl>=0;
  $('pfEq').textContent=money(eq);
  const cost=spotCost(),pc=cost?pnl/cost*100:0;
  const ce=$('pfChg');ce.className='num '+(u?'up':'dn');ce.textContent=smoney(pnl);
  const cp=$('pfChgPct');cp.className='num '+(u?'up':'dn');
  cp.textContent=(u?'+':'')+pc.toFixed(2)+'%';
  $('pfCash').textContent=money(S.cash);$('pfSpot').textContent=money(sv);$('pfVault').textContent=money(vv);
  const pe=$('pfPnl');pe.textContent=smoney(pnl);pe.className='num '+(u?'up':'dn');
  // equity against cost basis, plus the two breakdown charts. Vaults contribute
  // their subscription net of the fee — the same basis the vault position
  // is marked against, so the two views cannot disagree.
  drawEquity($('pfChart'),series('equity',eq,'1M'),S.cash+spotCost()+
    Object.keys(S.vpos).reduce((a,id)=>a+vaultCost(S.vpos[id]),0));
  const held=Object.keys(S.pos).filter(id=>S.pos[id].sz>0&&M(id));
  drawDiverging($('pfPnlChart'),held.map(id=>{const mk=M(id),q=S.pos[id];
    return{k:mk.sym.split('-')[0],v:(mk.px-q.avg)*q.sz}}).sort((a,b)=>b.v-a.v));
  const rows=held.map(id=>{const mk=M(id);return{k:mk.sym.split('-')[0],v:S.pos[id].sz*mk.px}})
    .concat(Object.keys(S.vpos).filter(id=>V(id)&&(S.vpos[id].tok>0||S.vpos[id].sh>0||S.vpos[id].over>0))
      .map(id=>{const v=V(id),q=S.vpos[id];
        return{k:'m'+v.ticker,v:q.tok*(v.nrv||1)+q.sh*(v.ipoPx||0)}}))
    .concat([{k:'Cash',v:S.cash}]).sort((a,b)=>b.v-a.v);
  const tot=rows.reduce((a,r)=>a+r.v,0)||1;
  // donut: five largest holdings, the tail rolled into one slice so the ring stays legible
  const top=rows.slice(0,5),tail=rows.slice(5).reduce((a,r)=>a+r.v,0);
  donut($('pfAllocChart'),tail>0?top.concat([{k:'Other',v:tail}]):top,
    {label:'Total',total:compact(tot)});
  // return path of the same illustrative equity series, as a percentage from its start
  const es=series('equity',eq,'1M'),e0=es[0]||1;
  drawSilverLine($('pfRetChart'),es.map(v=>(v/e0-1)*100),{fmt:v=>v.toFixed(1)+'%'});
  // categorical, not directional — neutral silver ramp so it can't read as gain/loss
  donut($('pfMixChart'),
    [{k:'Cash',v:S.cash},{k:'Spot',v:sv},{k:'Vaults',v:vv}].filter(x=>x.v>0),
    {inner:0});
  let html='';
  Object.keys(S.pos).forEach(id=>{const m=M(id),p=S.pos[id];if(!m||p.sz<=0)return;
    const val=p.sz*m.px,pl=(m.px-p.avg)*p.sz,pc=p.avg?(m.px-p.avg)/p.avg*100:0,up=pl>=0;
    html+=`<tr data-go="${id}" tabindex="0" role="link"><td><span class="nm">${esc(m.n)}</span> <span class="mini num">${m.sym}</span></td>
      <td class="r num">${qty(p.sz,sizeDp(m))}</td><td class="r num">${money(p.avg,dp(m.px))}</td>
      <td class="r num">${money(m.px,dp(m.px))}</td><td class="r num">${money(val)}</td>
      <td class="r num ${up?'up':'dn'}">${smoney(pl)} <span style="opacity:.7">(${up?'+':''}${pc.toFixed(2)}%)</span></td></tr>`});
  $('pfPos').innerHTML=html||`<tr><td colspan="6" style="text-align:center;color:var(--mute);padding:32px">No spot positions</td></tr>`;
  $('pfPos').querySelectorAll('[data-go]').forEach(r=>r.onclick=()=>openMarket(r.dataset.go));
  const vk=Object.keys(S.vpos).filter(id=>{const p=S.vpos[id];return p.tok>0||p.sh>0});
  $('pfVaults').innerHTML=vk.length?vk.map(id=>{const v=V(id),p=S.vpos[id];if(!v)return'';
    return `<tr data-v="${id}" tabindex="0" role="link"><td><span class="nm">${esc(v.name)}</span> <span class="mini">m${v.ticker}</span></td>
      <td><span class="badge${v.status==='ipo'||v.status==='live'?' live':''}">${STATUS[v.status].l}</span></td>
      <td class="r num">${money(p.sub,0)}</td><td class="r num">${qty(Math.round(p.tok),0)}</td>
      <td class="r num">${p.sh?qty(p.sh,0):'—'}</td>
      <td class="r"><span class="btn" style="padding:6px 12px;font-size:13px">${v.status==='ipo'?'Take shares':v.status==='live'?'Redeem':'View'}</span></td></tr>`}).join('')
    :`<tr><td colspan="6" style="text-align:center;color:var(--mute);padding:32px">No pre-IPO vaults</td></tr>`;
  $('pfVaults').querySelectorAll('[data-v]').forEach(r=>r.onclick=()=>openVault(r.dataset.v));
}
