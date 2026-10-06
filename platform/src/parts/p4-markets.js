
/* ════════ ticker tape — page-aware ════════ */
function tapeMarketsHTML(half){
  return MARKETS.map(m=>`<button class="cap${m.id===S.mkt.id?' on':''}" data-m="${m.id}" tabindex="-1">
    <span class="capL"><span class="capN">${esc(m.n)}</span>
      <span class="capP num">${money(m.px,dp(m.px))}</span>
      <span class="capD num ${dir(m.chg)}">${pctS(m.chg)}</span></span>
    <canvas width="92" height="48" data-sp="${half}${m.id}"></canvas></button>`).join('');
}
function renderTape(){
  const tape=$('tape');
  // no ticker strip on portfolio, or on the advanced chart workspace
  if(S.page==='portfolio'||EMBED_PAGES.includes(S.page)||(S.page==='trade'&&S.mode==='adv')){tape.classList.add('off');return}
  tape.classList.remove('off');
  // duplicated once so the marquee loops seamlessly at -50%
  $('tapeRun').innerHTML=tapeMarketsHTML('a')+tapeMarketsHTML('b');
  const cs=getComputedStyle($('tapeRun'));
  const capv=v=>cs.getPropertyValue(v).trim();
  $('tapeRun').querySelectorAll('[data-sp]').forEach(c=>{
    const m=M(c.dataset.sp.slice(1));if(!m)return;
    spark(c,series(m.id,m.px,'1D'),m.chg==null?cssv('--mute'):m.chg>=0?capv('--cap-up'):capv('--cap-down'))});
  $('tapeRun').querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>openMarket(b.dataset.m));
  $('tapeRun').querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>openVault(b.dataset.v));
}
function tickCountdowns(){
  document.querySelectorAll('[data-cd]').forEach(e=>{e.textContent=cdShort(e.dataset.cd)});
  document.querySelectorAll('[data-cdfull]').forEach(e=>{
    const p=cdParts(e.dataset.cdfull);
    if(!p){e.textContent='Closed';return}
    e.innerHTML=[[p.d,'days'],[p.h,'hrs'],[p.m,'min'],[p.s,'sec']].map(u=>
      `<span class="cdu"><span class="cdv">${String(u[0]).padStart(2,'0')}</span><span class="cdl">${u[1]}</span></span>`).join('');
  });
}

/* ════════ watchlist panel ════════ */
function setWL(on){
  S.wlOpen=on;$('app').dataset.wl=on?'on':'off';
  $('wlBtn').classList.toggle('on',on);$('wlBtn').setAttribute('aria-pressed',String(on));
  if(on)renderWatch();
}
function renderWatch(){
  const starred=MARKETS.filter(m=>S.watch[m.id]);
  const row=m=>`<div class="wli ${m.id===S.mkt.id?'on':''}" data-w="${m.id}" tabindex="0" role="link">
    <div class="wlic">${esc(m.n[0])}</div>
    <div class="wlt"><div class="wlk">${esc(m.n)}</div><div class="wlsy num">${esc(m.sym)}</div></div>
    <div><div class="wlp2 num">${money(m.px,dp(m.px))}</div>
      <div class="wld num ${dir(m.chg)}">${pctS(m.chg)}</div></div>
    <span class="wlstar ${S.watch[m.id]?'on':''}" data-ws="${m.id}" role="button" tabindex="0"
      aria-label="${S.watch[m.id]?'Unpin':'Pin'} ${esc(m.n)}">${STAR()}</span></div>`;
  // pre-IPO entries are vaults, not tradeable markets — they route to the offering
  const vrow=v=>{const p=Math.min(100,v.raisedUsd/v.vaultSize*100),pTrue=v.raisedUsd/v.vaultSize*100;
    return `<div class="wli" data-wv="${v.id}" tabindex="0" role="link">
      <div class="wlic">${esc(v.ticker[0])}</div>
      <div class="wlt"><div class="wlk">${esc(v.name)}</div><div class="wlsy">${esc(v.sector)}</div></div>
      <div><div class="wlp2 num">${v.ipoValuation}</div>
        <div class="wld num" style="color:var(--acc)">${v.close&&cdParts(v.close)?cdShort(v.close):STATUS[v.status].l}</div></div>
      </div>`};
  const sect=(title,html)=>html?`<div class="wlsec">${title}</div>`+html:'';
  const pre=VAULTS.filter(v=>v.status==='open'||v.status==='soon');
  $('wlCount').textContent=MARKETS.length+pre.length;
  $('wlList').innerHTML=
     sect('Pinned',starred.map(row).join(''))
    +sect('AI',MARKETS.filter(m=>m.s==='ai'&&!S.watch[m.id]).map(row).join(''))
    +sect('Semiconductors',MARKETS.filter(m=>m.s==='semi'&&!S.watch[m.id]).map(row).join(''))
    +sect('Robotics',MARKETS.filter(m=>m.s==='robotics'&&!S.watch[m.id]).map(row).join(''))
    +sect('Tech',MARKETS.filter(m=>m.s==='tech'&&!S.watch[m.id]).map(row).join(''))
    +sect('Crypto',MARKETS.filter(m=>m.s==='crypto'&&!S.watch[m.id]).map(row).join(''))
    +sect('Pre-IPO',pre.map(vrow).join(''))
    +(starred.length?'':'<div class="mini" style="padding:10px 16px">Star a market to pin it to the top.</div>');
  $('wlList').querySelectorAll('[data-w]').forEach(r=>{
    const nav=e=>{if(e.target.closest('[data-ws]'))return;openMarket(r.dataset.w)};
    r.onclick=nav;
    r.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMarket(r.dataset.w)}}});
  $('wlList').querySelectorAll('[data-wv]').forEach(r=>{
    const nav=()=>openVault(r.dataset.wv);
    r.onclick=nav;r.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();nav()}}});
  $('wlList').querySelectorAll('[data-ws]').forEach(st=>{
    const toggle=e=>{e.stopPropagation();const id=st.dataset.ws;
      S.watch[id]=!S.watch[id];
      toast(S.watch[id]?`Pinned ${M(id).n}`:`Unpinned ${M(id).n}`);
      renderWatch();if(S.page==='markets')renderMarkets()};
    st.onclick=toggle;st.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(e)}}});
}

/* ════════ markets page ════════ */
function filtered(){
  const q=S.q.trim().toLowerCase();
  const out=MARKETS.filter(m=>(S.cat==='all'||m.s===S.cat)&&
    (!q||m.n.toLowerCase().includes(q)||m.sym.toLowerCase().includes(q)));
  const k=S.sort.k,d=S.sort.dir;
  out.sort((a,b)=>{let x=k==='n'?a.n.toLowerCase():a[k],y=k==='n'?b.n.toLowerCase():b[k];
    if(k==='chg'){x=x==null?-Infinity:x;y=y==null?-Infinity:y}
    return x<y?-d:x>y?d:0});
  return out;
}
function mktStats(m){
  const half=m.px*SPREAD_BPS/1e4/2;
  return [['24h volume',volTxt(m)],['Market cap',compact(m.capN)],
    ['24h high',m.hi?money(m.hi,dp(m.px)):'\u2014'],['24h low',m.lo?money(m.lo,dp(m.px)):'\u2014'],
    ['Bid',money(m.px-half,dp(m.px))],['Ask',money(m.px+half,dp(m.px))],
    ['Spread',(SPREAD_BPS/100).toFixed(2)+'%'],['Settlement','USDC'],['Class',m.k]];
}
/* the chart card is its own panel, as in the reference — title + timeframes,
   then the tab row, then the plot */
function renderHeroChart(m){
  const el=$('heroChartCard');if(!el)return;
  m=(S.chartMkt&&M(S.chartMkt))||m;                 // the capsule keeps its own symbol
  if(!S.heroTf)S.heroTf='1D';
  const half=m.px*SPREAD_BPS/1e4/2;
  el.style.padding='0';
  el.innerHTML=`
    <div class="ch hcHead">
      <button class="picker hcPick" id="hcPick" aria-haspopup="listbox" aria-expanded="false">
        <span class="mark" style="width:34px;height:34px;border-radius:10px;font-size:15px">${esc(m.n[0])}</span>
        <span style="text-align:left;min-width:0">
          <span class="ct" style="display:block">${esc(m.n)}</span>
          <span class="mini">${esc(m.sym)}</span></span>
        <svg class="pickCar" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="hstats hcStats">
        <div class="hstat"><div class="hk">24h volume</div><div class="hv num">${volTxt(m)}</div></div>
        <div class="hstat"><div class="hk">Market cap</div><div class="hv num">${compact(m.capN)}</div></div>
        <div class="hstat"><div class="hk">24h range</div><div class="hv num">${
          m.lo?money(m.lo,dp(m.px))+' – '+money(m.hi,dp(m.px)):'—'}</div></div>
      </div>
    </div>
    <div class="hcBody" style="padding:0 24px 16px">
      <div class="hcTop">
        <div>
          <div class="px num">${money(m.px,dp(m.px)).replace('$','')}<small>USDC</small></div>
          <div class="hcChg">
            <span class="pill ${m.chg==null?'':dir(m.chg)}">${m.chg==null?'—':pctS(m.chg)}</span>
            <span class="num mini">${m.chg==null?'—':smoney(m.px*m.chg/100,dp(m.px))}</span>
            <span class="mini">24h</span></div>
        </div>
      </div>
      <div class="cwrap grow" style="margin-top:14px"><canvas id="heroChart"></canvas></div>
      <div class="tfs hcTfs">${TFS.map(t=>
        `<button class="tf ${t===S.heroTf?'on':''}" data-htf="${t}">${t}</button>`).join('')}</div>
    </div>`;
  area($('heroChart'),series(m.id,m.px,S.heroTf),
    {pad:10,axis:true,ref:false,times:['','','','Now']});
  $('hcPick').onclick=e=>{e.stopPropagation();openPick($('hcPick'),'chart')};
  el.querySelectorAll('[data-htf]').forEach(t=>t.onclick=()=>{
    S.heroTf=t.dataset.htf;S.heroHold=Date.now();renderHeroChart(m)});
  el.classList.add('lift');
  el.setAttribute('role','link');el.setAttribute('tabindex','0');
  el.setAttribute('aria-label','Trade '+m.n);
  /* Capture phase, and wired once: the capsule rebuilds its own innerHTML when a
     timeframe is picked, so a bubbled click would arrive with a detached target
     and the control exclusions below would miss. */
  if(!el.dataset.goWired){
    el.dataset.goWired='1';
    const target=()=>(S.chartMkt&&M(S.chartMkt))||S.mkt;
    el.addEventListener('click',e=>{
      if(editMode)return;                            // editing the board, not trading
      if(e.target.closest('.picker,.tfs,.pickMenu,.wEdit'))return;
      openMarket(target().id);
    },true);
    el.addEventListener('keydown',e=>{
      if(editMode||e.target!==el)return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();openMarket(target().id)}});
  }
}
/* state of the whole board, from whatever the feed has marked */
function marketPulse(){
  const live=MARKETS.filter(m=>m.chg!=null);
  if(!live.length)return null;
  const byChg=[...live].sort((a,b)=>b.chg-a.chg);
  const secs=IDX_SECTORS.map(([k,lab])=>({lab,avg:idxAvg(k)})).filter(x=>x.avg!=null);
  return{n:live.length,
    avg:live.reduce((a,m)=>a+m.chg,0)/live.length,
    up:live.filter(m=>m.chg>0).length,
    dn:live.filter(m=>m.chg<0).length,
    vol:live.reduce((a,m)=>a+(m.vol||0),0),
    best:byChg[0],worst:byChg[byChg.length-1],
    secUp:secs.filter(x=>x.avg>0).length,secN:secs.length};
}
function renderPulse(){
  const box=$('pulse');if(!box)return;
  const p=marketPulse();
  if(!p){box.innerHTML='<div class="mini">Connecting…</div>';return}
  const u=p.avg>=0,tot=Math.max(1,p.up+p.dn);
  box.innerHTML=`<div class="pulseV num ${u?'up':'dn'}">${pctS(p.avg)}</div>
    <div class="pulseK">Equal-weight across ${p.n} live market${p.n===1?'':'s'} · 24h</div>
    <div class="pulseCh"><canvas id="pulseCh"></canvas></div>
    <div class="pulseBar"><i class="up" style="width:${p.up/tot*100}%"></i><i
      class="dn" style="width:${p.dn/tot*100}%"></i></div>
    <div class="pulseLeg"><span class="up">${p.up} advancing</span>
      <span class="dn">${p.dn} declining</span></div>
    <div class="pulseRows">
      <div><span>24h volume</span><b class="num">${compact(p.vol)}</b></div>
      <div><span>Sectors up</span><b class="num">${p.secUp} of ${p.secN}</b></div>
      <div data-pm="${p.best.id}"><span>Leader</span>
        <b class="num up">${esc(p.best.sym.split('-')[0])} ${pctS(p.best.chg)}</b></div>
      <div data-pm="${p.worst.id}"><span>Laggard</span>
        <b class="num ${p.worst.chg>=0?'up':'dn'}">${esc(p.worst.sym.split('-')[0])} ${pctS(p.worst.chg)}</b></div>
    </div>`;
  area($('pulseCh'),series('marco',100+p.avg,'1D'),{axis:false,ref:false,pad:2,
    color:cssv(u?'--up':'--down')});
  box.querySelectorAll('[data-pm]').forEach(el=>el.onclick=()=>openMarket(el.dataset.pm));
}
/* ── index strip: equal-weight sector composites, rebased to 100 at the 24h open ──
   Only markets with a live change contribute, so a partial feed can't skew a sector. */
const IDX_SECTORS=[['ai','AI'],['semi','Semis'],['robotics','Robotics'],
  ['tech','Tech'],['crypto','Crypto']];
function idxCells(){
  return [['marco','Marco '+MARKETS.length,null]].concat(
    IDX_SECTORS.filter(([k])=>MARKETS.some(m=>m.s===k&&m.chg!=null))
      .map(([k,lab])=>[k,lab,k]));
}
const ARW_UP=`<svg class="iarw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
  stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>`;
const ARW_DN=`<svg class="iarw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
  stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M15 17H7V9"/></svg>`;
function idxAvg(sec){
  const l=MARKETS.filter(m=>m.chg!=null&&(sec===null||m.s===sec));
  if(!l.length)return null;
  return l.reduce((a,m)=>a+m.chg,0)/l.length;
}
function renderIdxStrip(){
  const el=$('idxStrip');if(!el)return;
  const IDX=idxCells();
  const rows=IDX.map(([id,lab,sec],i)=>{
    const a=idxAvg(sec);
    return{id,lab:lab.replace(/ \d+$/,''),sec,a,
      col:sec===null?null:RING_BLUES[(i-1)%RING_BLUES.length]};
  });
  el.innerHTML=rows.map(r=>{
    const lvl=r.a==null?'—':(100*(1+r.a/100)).toFixed(2);
    return `<div class="icell">
      <div class="ik">${esc(r.lab)}</div>
      <div class="iv num">${lvl}</div>
      <div class="ic num ${r.a==null?'':dir(r.a)}">${r.a==null?'—':pctS(r.a)}</div>
      <div class="isp"><canvas data-isp="${r.id}"></canvas></div></div>`}).join('');
  /* every panel carries its own scale: on a day when one sector runs away, a
     shared axis would flatten the rest into a straight line */
  el.querySelectorAll('[data-isp]').forEach(cv=>{
    const r=rows.find(x=>x.id===cv.dataset.isp);
    if(!r||r.a==null)return;
    const box=cv.getBoundingClientRect();
    if(!box.width||!box.height)return;
    const k=2;                                  // 2x backing keeps the curve crisp
    cv.width=Math.round(box.width*k);cv.height=Math.round(box.height*k);
    spark(cv,series('idx:'+r.id,100*(1+r.a/100),'1D'),
      r.a>=0?cssv('--up'):cssv('--down'),1.3*k);
  });
}

/* ── summary: key/value list for whichever market the hero is showing ── */
function renderSummary(m){
  const el=$('summary');if(!el)return;
  if($('sumSym'))$('sumSym').textContent=m.sym;
  const half=m.px*SPREAD_BPS/1e4/2;
  const op=(m.chg!=null&&m.chg>-100)?m.px/(1+m.chg/100):null;
  const rows=[
    ['Previous close',op?money(op,dp(m.px)):'—'],
    ['Last price',money(m.px,dp(m.px))],
    ['Bid',money(m.px-half,dp(m.px))],
    ['Ask',money(m.px+half,dp(m.px))],
    ['24h range',m.lo?money(m.lo,dp(m.px))+' – '+money(m.hi,dp(m.px)):'—'],
    ['24h volume',volTxt(m)],
    ['Market cap',compact(m.capN)],
    ['Spread',(SPREAD_BPS/100).toFixed(2)+'%'],
    ['Settlement','USDC'],
  ];
  el.innerHTML=rows.map(r=>`<div class="sumr"><span>${r[0]}</span><b class="num">${r[1]}</b></div>`).join('');
}

/* ── sector strength: average live 24h change ──
   Volume share is useless here — crypto is ~99% of it and flattens every other bar. */
function renderSectorBars(){
  const el=$('sectorBars');if(!el)return;
  const secs=[['ai','AI'],['semi','Semiconductors'],['robotics','Robotics'],['tech','Tech'],['crypto','Crypto']];
  const rows=secs.map(([k,lab])=>{
    const l=MARKETS.filter(m=>m.s===k&&m.chg!=null);
    return{lab,n:l.length,avg:l.length?l.reduce((a,m)=>a+m.chg,0)/l.length:null}})
    .filter(r=>r.avg!=null).sort((a,b)=>b.avg-a.avg);
  if(!rows.length){el.innerHTML='<div class="mini">Connecting…</div>';return}
  const max=Math.max(...rows.map(r=>Math.abs(r.avg)))||1;
  el.innerHTML=rows.map(r=>`<div class="sbr">
    <span class="sbn">${esc(r.lab)}</span>
    <span class="sbt"><span class="sbf ${dir(r.avg)}" style="width:${(Math.abs(r.avg)/max*100).toFixed(1)}%"></span></span>
    <span class="sbv num ${dir(r.avg)}">${pctS(r.avg)}<span class="sbp">(${r.n})</span></span></div>`).join('');
}

function miniRow(m,val,cls){
  return `<div class="row" data-go="${m.id}" style="cursor:pointer"><span class="nm">${esc(m.n)}</span>
    <b class="num ${cls||''}">${val}</b></div>`;
}
function renderMarkets(){
  renderLayoutSeg();wireEditor();watchResize();
  applyWidgets(currentWidgets());
  renderIdxStrip();renderSectorBars();renderSectorRadar();renderPfSnap();renderActive();
  renderWeight();renderVolShare();renderHist();renderRetSince();
  renderPulse();renderHeroChart(S.mkt);renderSummary(S.mkt);
  if(editMode){decorateAll();renderPalette()}
  const ready=MARKETS.filter(m=>m.chg!=null);
  const byChg=[...ready].sort((a,b)=>b.chg-a.chg);
  const gN=fitRows('gainers',44,2,8);
  $('gainers').innerHTML=byChg.slice(0,gN).map(m=>miniRow(m,pctS(m.chg),dir(m.chg))).join('')||'<div class="mini">Loading…</div>';
  const lN=fitRows('losers',44,2,8);
  $('losers').innerHTML=byChg.slice(-lN).reverse().map(m=>miniRow(m,pctS(m.chg),dir(m.chg))).join('')||'<div class="mini">Loading…</div>';

  $('pipeline').innerHTML=`<div data-fut style="cursor:pointer;padding:10px 0">
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span class="nm">Moonshot AI · Valuation future</span><span class="num mini">Up to 10×</span></div>
      <div class="mini" style="margin-top:5px">Long or short the valuation · cash-settles at the IPO</div></div>`
    +VAULTS.filter(v=>v.status==='open'||v.status==='soon')
    .slice(0,Math.max(1,fitRows('pipeline',62,1,6)-1)).map(v=>{
    const p=Math.min(100,v.raisedUsd/v.vaultSize*100),pTrue=v.raisedUsd/v.vaultSize*100;
    return `<div data-v="${v.id}" style="cursor:pointer;padding:10px 0">
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span class="nm">${esc(v.name)}</span><span class="num mini">${v.ipoValuation}</span></div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <span class="bar" style="flex:1"><span class="barF" style="width:${p}%"></span></span>
        <span class="mini num">${pTrue.toFixed(0)}%</span></div>
      <div class="mini" style="margin-top:5px">${esc(v.sector)} · closes in <span class="num" data-cd="${v.close}">${cdShort(v.close)}</span></div></div>`}).join('');

  const cols=[['','',0],['n','Market',0],['','',0],['px','Price',1],['chg','24h %',1],['vol','Volume (24h)',1],['capN','Market cap',1]];
  $('mktHead').innerHTML=cols.map(c=>{
    if(!c[0])return `<th scope="col">${c[1]}</th>`;
    const on=S.sort.k===c[0];
    return `<th scope="col" class="s${on?' act':''}${c[2]?' r':''}" data-k="${c[0]}">${c[1]}<span class="car">${on&&S.sort.dir>0?'▲':'▼'}</span></th>`}).join('');
  $('mktHead').querySelectorAll('[data-k]').forEach(h=>h.onclick=()=>{
    const k=h.dataset.k;S.sort=S.sort.k===k?{k,dir:-S.sort.dir}:{k,dir:k==='n'?1:-1};renderMarkets()});

  const rows=filtered();
  $('resCount').textContent=`${rows.length} of ${MARKETS.length} markets`;
  $('mktBody').innerHTML=rows.map(m=>`<tr data-go="${m.id}" tabindex="0" role="link"${S.pos[m.id]?' class="held"':''}>
    <td style="width:44px"><span class="star ${S.watch[m.id]?'on':''}" data-w="${m.id}" role="button" tabindex="0"
      aria-label="${S.watch[m.id]?'Remove from':'Add to'} watchlist">${STAR()}</span></td>
    <td><div class="nm">${esc(m.n)}</div><div class="mini num">${esc(m.sym)}</div></td>
    <td style="width:80px"><canvas width="128" height="40" data-row="${m.id}" style="width:64px;height:20px"></canvas></td>
    <td class="r num" style="color:var(--ink)">${money(m.px,dp(m.px))}<div class="mini">USDC</div></td>
    <td class="r num ${dir(m.chg)}">${pctS(m.chg)}</td>
    <td class="r num">${volTxt(m)}</td><td class="r num">${compact(m.capN)}</td></tr>`).join('')
    ||`<tr><td colspan="7" style="text-align:center;color:var(--mute);padding:32px">No markets match “${esc(S.q)}”</td></tr>`;
  rows.forEach(m=>{const c=document.querySelector(`[data-row="${m.id}"]`);
    if(c)sparkBars(c,series(m.id,m.px,'1D'),m.chg==null?cssv('--mute'):m.chg>=0?cssv('--up'):cssv('--down'))});
  $('mktBody').querySelectorAll('tr[data-go]').forEach(r=>{
    r.onclick=e=>{if(!e.target.closest('[data-w]'))openMarket(r.dataset.go)};
    r.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMarket(r.dataset.go)}}});
  $('mktBody').querySelectorAll('[data-w]').forEach(s=>{
    const t=e=>{e.stopPropagation();const id=s.dataset.w;S.watch[id]=!S.watch[id];
      toast(S.watch[id]?`Added ${M(id).sym} to watchlist`:`Removed ${M(id).sym} from watchlist`);
      renderMarkets();if(S.wlOpen)renderWatch()};
    s.onclick=t;s.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')t(e)}});
  document.querySelectorAll('#gainers [data-go],#losers [data-go]')
    .forEach(r=>r.onclick=()=>openMarket(r.dataset.go));
  document.querySelectorAll('#pipeline [data-v]').forEach(r=>r.onclick=()=>openVault(r.dataset.v));
  document.querySelectorAll('#pipeline [data-fut]').forEach(r=>r.onclick=()=>openEmbed('futures'));
  renderFeed();
}
function linkCash(t){
  return esc(t).replace(/\$([A-Z]{2,10})/g,(_,tk)=>{
    const mk=MARKETS.find(x=>x.sym.split('-')[0].toUpperCase()===tk);
    if(mk)return `<span class="cash" data-cash="${mk.id}">$${tk}</span>`;
    const vt=VAULTS.find(x=>x.ticker===tk);
    if(vt)return `<span class="cash" data-vault="${vt.id}">$${tk}</span>`;
    return `$${tk}`});
}
const FEED_RAILS=[['feedRail','markets']];
const feedTake=rail=>{
  const h=rail.clientHeight;
  if(h>60)return Math.max(1,Math.min(6,Math.floor(h/78)));
  return Math.max(1,parseInt(rail.dataset.take||'3',10));
};
const FEED_AGES=['now','1m','4m','12m','27m','44m','1h','2h','3h'];
function feedAge(i){return FEED_AGES[Math.min(i,FEED_AGES.length-1)]}
function stampFeed(rail){
  [...rail.children].forEach((el,i)=>{
    const m=el.querySelector('.pmeta');if(m)m.textContent=feedAge(i);
  });
}
function feedRowHTML(p){
  return `<div class="phead"><span class="psrc">${esc(p.src)}</span><span class="pname">${esc(p.n)}</span>
      <span class="pmeta"></span></div>
    <div class="pbody">${linkCash(p.b)}</div>`;
}
function wireFeedRow(el){
  el.querySelectorAll('[data-cash]').forEach(b=>b.onclick=()=>openMarket(b.dataset.cash));
  el.querySelectorAll('[data-vault]').forEach(b=>b.onclick=()=>openVault(b.dataset.vault));
}
/* full paint — only when a page first renders its rail */
function renderFeed(){
  FEED_RAILS.forEach(([id])=>{
    const rail=$(id);if(!rail)return;
    const n=S.feed.length,take=Math.min(feedTake(rail),n);
    rail.innerHTML='';
    for(let k=0;k<take;k++){
      const el=document.createElement('div');
      el.className='srow';
      el.innerHTML=feedRowHTML(S.feed[(S.feedI+k)%n]);
      rail.appendChild(el);wireFeedRow(el);
    }
    stampFeed(rail);
  });
}
/* a live feed gains a post at the top; it does not repaint itself. The row that
   was newest gives up its "now" stamp and falls back to its own timestamp. */
function rotateFeed(){
  const live=FEED_RAILS.filter(([id,pg])=>S.page===pg&&$(id)&&$(id).offsetParent!==null);
  if(!live.length)return;
  const n=S.feed.length;
  S.feedI=(S.feedI-1+n)%n;              // step back so the arriving post is one not on screen
  const p=S.feed[S.feedI];
  live.forEach(([id])=>{
    const rail=$(id);
    const el=document.createElement('div');
    el.className='srow in';
    el.innerHTML=feedRowHTML(p);
    rail.prepend(el);wireFeedRow(el);
    while(rail.children.length>feedTake(rail))rail.lastElementChild.remove();
    stampFeed(rail);                      // everything below just got older
  });
}

/* ── sector profile radar for the markets page ──
   Five measures per sector, each rescaled against the leading sector on that
   axis, because the raw units (percent, USDC, counts) share no scale. Momentum
   can be negative, so it is shifted before scaling rather than clipped. */
const SEC_AXES=[['mom','Momentum'],['brd','Breadth'],['vol','Volume'],
                ['vlt','Volatility'],['wgt','Weight']];
function marketSectorProfile(){
  const totVol=MARKETS.reduce((a,m)=>a+(m.vol||0),0)||1;
  const rows=IDX_SECTORS
    .filter(([k])=>MARKETS.some(m=>m.s===k&&m.chg!=null))
    .map(([k,lab])=>{
      const l=MARKETS.filter(m=>m.s===k&&m.chg!=null);
      return{k,lab,
        mom:l.reduce((a,m)=>a+m.chg,0)/l.length,
        brd:l.filter(m=>m.chg>0).length/l.length,
        vol:l.reduce((a,m)=>a+(m.vol||0),0)/totVol,
        vlt:l.reduce((a,m)=>a+Math.abs(m.chg),0)/l.length,
        wgt:l.length/MARKETS.length};
    });
  if(!rows.length)return[];
  SEC_AXES.forEach(([key])=>{                    // rescale each axis to its leader
    const vals=rows.map(r=>r[key]);
    const lo=Math.min(0,...vals),hi=Math.max(...vals);
    const rg=(hi-lo)||1;
    rows.forEach(r=>r[key+'N']=(r[key]-lo)/rg);
  });
  return rows;
}
function drawSectorRadar(cv,rows){
  const G=fitCanvas(cv);if(!G)return;const{ctx,w,h}=G;
  if(!rows.length)return;
  const F=radarFrame(ctx,w,h,SEC_AXES.map(a=>a[1]));if(!F)return;
  rows.forEach((row,si)=>{
    const c=RING_HUES[si%RING_HUES.length],rgb=c[0]+','+c[1]+','+c[2];
    radarPoly(ctx,F,SEC_AXES.map(([key])=>row[key+'N']),1,
      `rgba(${rgb},.86)`,`rgba(${rgb},.10)`,1.5);
  });
  radarLabels(ctx,F,SEC_AXES.map(a=>a[1]));
}
/* a read on your own book, so the dashboard isn't only about the market */
function renderPfSnap(){
  const box=$('pfSnap');if(!box)return;
  const sv=spotVal(),vv=vaultVal(),eq=S.cash+sv+vv;
  const pnl=sv-spotCost(),u=pnl>=0;
  const held=Object.keys(S.pos).filter(id=>S.pos[id].sz>0&&M(id))
    .map(id=>{const m=M(id),q=S.pos[id];
      return{m,val:q.sz*m.px,pl:(m.px-q.avg)*q.sz,pc:q.avg?(m.px/q.avg-1)*100:0}})
    .sort((a,b)=>b.val-a.val).slice(0,fitRows('pfSnap',34,1,6));
  box.innerHTML=`<div class="snapK">Total equity</div>
    <div class="snapV num">${money(eq,0)}</div>
    <div class="snapP num ${u?'up':'dn'}">${smoney(pnl,0)} <span style="opacity:.7">on spot</span></div>
    <div class="snapCh"><canvas id="pfSnapCh"></canvas></div>
    ${(()=>{
      const parts=[['Cash',S.cash],['Spot',sv],['Pre-IPO',vv]].filter(p=>p[1]>0);
      const tot=parts.reduce((a,p)=>a+p[1],0)||1;
      const col=i=>`rgba(${RING_BLUES[i%RING_BLUES.length].join(',')},.9)`;
      return `<div class="snapBar">${parts.map((p,i)=>
          `<i style="flex:${p[1]};background:${col(i)}" title="${esc(p[0])}"></i>`).join('')}</div>
        <div class="snapKey">${parts.map((p,i)=>
          `<span><b style="background:${col(i)}"></b>${esc(p[0])}
            <u class="num">${compact(p[1])}</u>
            <s class="num">${(p[1]/tot*100).toFixed(0)}%</s></span>`).join('')}</div>`;
    })()}
    ${held.length?`<div class="snapRows">${held.map(x=>`<div class="snapRow" data-sm="${x.m.id}">
      <span class="snapN">${esc(x.m.sym.split('-')[0])}</span>
      <span class="snapA num">${compact(x.val)}</span>
      <span class="snapX num ${x.pl>=0?'up':'dn'}">${x.pc>=0?'+':''}${x.pc.toFixed(1)}%</span></div>`).join('')}</div>`:''}`;
  drawSilverLine($('pfSnapCh'),series('equity',eq,'1M'),{fmt:v=>compact(v)});
  box.querySelectorAll('[data-sm]').forEach(el=>el.onclick=()=>openMarket(el.dataset.sm));
}
/* the book's own path, in percent from the start of the window rather than in
   dollars, so a small account and a large one read the same */
function renderRetSince(){
  const box=$('retSince');if(!box)return;
  if(!S.retTf)S.retTf='1M';
  const eq=S.cash+spotVal()+vaultVal();
  const es=series('equity',eq,S.retTf),e0=es[0]||1;
  const pts=es.map(v=>(v/e0-1)*100);
  const now=pts[pts.length-1]||0,u=now>=0;
  const peak=Math.max(...pts),trough=Math.min(...pts);
  box.innerHTML=`<div class="retTop">
      <div class="retV num">${money(eq,0)}</div>
      <div class="retSub"><span class="num ${u?'up':'dn'}">${smoney(eq-e0,0)}</span>
        <span class="num ${u?'up':'dn'}">${u?'+':''}${now.toFixed(2)}%</span>
        <span>on ${esc(S.retTf)}</span></div>
    </div>
    <div class="retCh"><canvas id="retCh"></canvas></div>
    <div class="tfs retTfs">${['1W','1M','3M','1Y','5Y'].map(t=>
      `<button class="tf ${t===S.retTf?'on':''}" data-rtf="${t}">${t}</button>`).join('')}</div>
    <div class="retFoot">
      <span>Best<b class="num up">+${peak.toFixed(1)}%</b></span>
      <span>Worst<b class="num ${trough<0?'dn':'up'}">${trough>=0?'+':''}${trough.toFixed(1)}%</b></span>
      <span>Cash<b class="num">${compact(S.cash)}</b></span>
    </div>`;
  drawSilverLine($('retCh'),pts,{fmt:v=>(v>0?'+':'')+v.toFixed(0)+'%'});
  box.querySelectorAll('[data-rtf]').forEach(t=>t.onclick=()=>{
    S.retTf=t.dataset.rtf;renderRetSince()});
}
/* discovery: what is actually trading today */
function renderActive(){
  const box=$('active');if(!box)return;
  const rows=MARKETS.filter(m=>m.vol!=null&&!m.nolive)
    .sort((a,b)=>b.vol-a.vol).slice(0,fitRows('active',38,2,9));
  if(!rows.length){box.innerHTML='<div class="mini">Loading…</div>';return}
  const mx=rows[0].vol||1;
  box.innerHTML=rows.map(m=>`<div class="actRow2" data-am="${m.id}">
    <span class="actN">${esc(m.n)}</span>
    <span class="actBar"><i style="width:${m.vol/mx*100}%"></i></span>
    <span class="actV num">${compact(m.vol)}</span>
    <span class="actX num ${dir(m.chg)}">${m.chg==null?'—':pctS(m.chg)}</span></div>`).join('');
  box.querySelectorAll('[data-am]').forEach(el=>el.onclick=()=>openMarket(el.dataset.am));
}
/* where the listed value sits, by sector */
function renderWeight(){
  const cv=$('weightCh');if(!cv)return;
  const by={};
  MARKETS.forEach(m=>{
    const lab=(IDX_SECTORS.find(x=>x[0]===m.s)||[null,'Other'])[1];
    by[lab]=(by[lab]||0)+(m.capN||0);
  });
  const items=Object.entries(by).map(([k,v])=>({k,v})).filter(x=>x.v>0)
    .sort((a,b)=>b.v-a.v);
  if(!items.length)return;
  donut(cv,items,{label:'Listed',total:compact(items.reduce((a,x)=>a+x.v,0))});
}
/* who is actually being traded today — the tail is folded into one slice so the
   ring stays readable */
function renderVolShare(){
  const cv=$('volShareCh');if(!cv)return;
  const live=MARKETS.filter(m=>m.vol!=null&&!m.nolive).sort((a,b)=>b.vol-a.vol);
  if(!live.length)return;
  const items=live.slice(0,5).map(m=>({k:m.sym.split('-')[0],v:m.vol}));
  const rest=live.slice(5).reduce((a,m)=>a+m.vol,0);
  if(rest>0)items.push({k:'Other',v:rest});
  donut(cv,items,{label:'24h',total:compact(live.reduce((a,m)=>a+m.vol,0))});
}
function renderSectorRadar(){
  const cv=$('secRadarCh');if(!cv)return;
  const m=(S.chartMkt&&M(S.chartMkt))||S.mkt;
  const rows=rivalRows(m);
  const sub=$('secRadarSub');
  const lg=$('secRadarLeg');
  if(rows.length<3){
    if(sub)sub.textContent=m.n+' · no comparable set';
    const F=fitCanvas(cv);
    if(F){F.ctx.fillStyle=cssv('--mute');F.ctx.textAlign='center';F.ctx.textBaseline='middle';
      F.ctx.font='500 12px "Open Sauce Sans",sans-serif';
      F.ctx.fillText('No comparable set',F.w/2,F.h/2)}
    if(lg)lg.innerHTML='';
    return;
  }
  if(sub)sub.textContent=m.n+' · by capitalisation';
  drawShareRadar(cv,rows,{hi:cssv('--brand')});
  if(lg)lg.innerHTML=rows.slice().sort((a,b)=>b.share-a.share).map(r=>
    `<span class="${r.own?'on':''}"><i style="background:${r.own?cssv('--brand'):'rgba(228,231,238,.55)'}"></i>${
      esc(r.n)}<u class="num">${(r.share*100).toFixed(1)}%</u></span>`).join('');
}

/* ════════ dashboard layouts ════════
   Preset arrangements of the markets board, after Robinhood Legend's
   purpose-built templates. A layout lists widgets in order with their column
   span; anything it omits is hidden rather than deleted, so switching back
   restores it without a re-render. */
/* Each entry is [widget, columns, rows]. Layouts are banded: every row adds to
   12 columns and its widgets share a height, which is what makes the board tile
   with no holes — dense packing alone cannot fill a gap left by mismatched
   heights, because only a later widget that happens to fit can backfill it. */
const DEFAULT_LAYOUT='overview';
const LAYOUTS={
  overview:{n:'Overview',d:'Chart, your book and the whole board at a glance.',
    w:[['chart',6,5],['pulse',3,5],['portfolio',3,5],
       ['weight',3,4],['radar',3,4],['social',6,4],
       ['pipeline',3,4],['index',6,4],['hist',3,4],
       ['table',12,9]]},
  trading:{n:'Stock Trading',d:'Enter and exit quickly with price action up front.',
    w:[['chart',8,5],['summary',4,5],
       ['pulse',4,4],['active',4,4],['index',4,4],
       ['gainers',4,3],['losers',4,3],['sectors',4,3],
       ['table',12,9]]},
  chartspot:{n:'Chart Spotlight',d:'Trade from a larger chart as the market moves.',
    w:[['chart',12,6],
       ['portfolio',4,4],['pulse',4,4],['radar',4,4],
       ['table',12,9]]},
  portfolio:{n:'Positions Analysis',d:'Deep dive on your book and plan the next move.',
    w:[['portfolio',5,5],['chart',7,5],
       ['retsince',4,4],['summary',4,4],['pulse',4,4],
       ['radar',6,4],['pipeline',6,4],
       ['table',12,9]]},
  discovery:{n:'Discovery',d:'What is moving, and what people are saying.',
    w:[['pulse',4,4],['active',4,4],['social',4,4],
       ['gainers',4,3],['losers',4,3],['sectors',4,3],
       ['radar',4,4],['pipeline',4,4],['index',4,4],
       ['table',12,9]]},
  monitoring:{n:'Market Monitoring',d:'Track the whole board at a glance.',
    w:[['pulse',4,4],['index',8,4],
       ['sectors',4,4],['radar',4,4],['active',4,4],
       ['weight',6,4],['volshare',6,4],
       ['table',12,9]]},
  preipo:{n:'Pre-IPO Focus',d:'Follow the pipeline and what you already hold.',
    w:[['pipeline',8,4],['portfolio',4,4],
       ['pulse',4,4],['social',4,4],['active',4,4],
       ['table',12,9]]},
  compact:{n:'Compact',d:'Just the pulse, the chart and the tape.',
    w:[['pulse',4,5],['chart',8,5],
       ['table',12,9]]},
};
/* the thumbnail is packed from the layout itself, so a preview can never drift
   from the arrangement it applies */
const THUMB_KIND={chart:'ch',pulse:'ch',portfolio:'ch',radar:'ch',index:'bar',
  weight:'ch',volshare:'ch',hist:'bar',
  sectors:'bar',gainers:'row',losers:'row',active:'row',social:'row',
  summary:'row',pipeline:'row',table:'row'};
function layoutThumb(L){
  const rows=[];let cur=[],w=0;
  L.w.forEach(([id,sp,h])=>{
    if(w+sp>12){rows.push(cur);cur=[];w=0}
    cur.push([id,sp,wH(id,h)]);w+=sp;
  });
  if(cur.length)rows.push(cur);
  const inner=id=>{
    const k=THUMB_KIND[id]||'row';
    if(k==='ch')return '<i class="tk-ch"></i>';
    if(k==='bar')return '<i class="tk-b"></i><i class="tk-b"></i><i class="tk-b"></i>';
    return '<i class="tk-r"></i><i class="tk-r"></i><i class="tk-r"></i>';
  };
  return `<div class="lt">${rows.map(r=>
    `<div class="ltr" style="flex:${Math.max(...r.map(x=>x[2]))}">${r.map(([id,sp])=>
      `<div class="ltc" style="flex:${sp}">${inner(id)}</div>`).join('')}</div>`).join('')}</div>`;
}
function renderTemplates(g,done){
  g=g||$('ltGrid');if(!g)return;
  done=done||closeTemplates;
  const custom=S.custom&&S.custom.length
    ? `<button class="ltCard${S.layout==='custom'?' on':''}" data-ly="__custom">
        ${layoutThumb({w:S.custom})}
        <div class="ltN">Your layout</div>
        <div class="ltD">The arrangement you built, ${S.custom.length} capsules.</div></button>`
    : '';
  g.innerHTML=custom+Object.entries(LAYOUTS).map(([k,L])=>
    `<button class="ltCard${k===S.layout?' on':''}" data-ly="${k}">
      ${layoutThumb(L)}
      <div class="ltN">${esc(L.n)}</div>
      <div class="ltD">${esc(L.d)}</div></button>`).join('');
  g.querySelectorAll('[data-ly]').forEach(b=>b.onclick=()=>{
    if(b.dataset.ly==='__custom'){S.layout='custom';
      try{localStorage.setItem('marco.layout','custom')}catch(e){}
      applyWidgets(currentWidgets());if(editMode)decorateAll();}
    else applyLayout(b.dataset.ly);
    renderLayoutSeg();done();
  });
}
function openTemplates(){renderTemplates();$('ltOverlay').classList.add('on');
  document.body.style.overflow='hidden'}
function closeTemplates(){$('ltOverlay').classList.remove('on');document.body.style.overflow=''}
function openLayoutMenu(anchor){
  renderTemplates($('ltmGrid'),closeLayoutMenu);
  const menu=$('ltMenu');menu.classList.add('on');$('pickScrim').classList.add('on');
  anchor.setAttribute('aria-expanded','true');
  const r=anchor.getBoundingClientRect(),mw=menu.offsetWidth||660;
  const left=r.left+mw+12>innerWidth?r.right-mw:r.left;
  menu.style.left=Math.max(12,Math.min(left,innerWidth-mw-12))+'px';
  menu.style.top=Math.min(r.bottom+6,Math.max(12,innerHeight-menu.offsetHeight-12))+'px';
}
function closeLayoutMenu(){
  $('ltMenu').classList.remove('on');
  if(!$('pickMenu').classList.contains('on'))
    $('pickScrim').classList.remove('on');
  $('layoutBtn').setAttribute('aria-expanded','false');
}
const SPANS=[2,3,4,5,6,7,8,9,10,11,12];
function applyLayout(key){
  const L=LAYOUTS[key]||LAYOUTS[DEFAULT_LAYOUT];
  S.layout=LAYOUTS[key]?key:DEFAULT_LAYOUT;S.custom=null;
  try{localStorage.setItem('marco.layout',S.layout);
    localStorage.removeItem('marco.custom')}catch(e){}
  applyWidgets(L.w.map(x=>x.slice()));
  if(editMode)renderPalette();
}
function renderLayoutSeg(){
  const b=$('layoutBtn');if(!b)return;
  b.querySelector('.lbN').textContent=S.layout==='custom'?'Your layout'
    :(LAYOUTS[S.layout]||LAYOUTS[DEFAULT_LAYOUT]).n;
  b.onclick=e=>{e.stopPropagation();
    $('ltMenu').classList.contains('on')?closeLayoutMenu():openLayoutMenu(b)};
}

/* ════════ layout editor ════════
   Widgets already exist in the DOM — a layout only sets order, span and
   visibility — so adding one from the palette is an unhide and a reorder, not a
   fresh render. Charts keep their pixels; the social feed keeps its place. */
const WIDGETS={
  pulse:{n:'Market Pulse',sp:5,h:5},index:{n:'Sector Composites',sp:7,h:2},
  chart:{n:'Price Chart',sp:8,h:5},summary:{n:'Summary',sp:4,h:4},
  portfolio:{n:'Your Portfolio',sp:4,h:5},social:{n:'Social',sp:4,h:4},
  active:{n:'Most Active',sp:4,h:3},gainers:{n:'Top Gainers',sp:4,h:3},
  losers:{n:'Top Losers',sp:4,h:3},sectors:{n:'Sector Strength',sp:4,h:3},
  radar:{n:'Market Share',sp:4,h:5},pipeline:{n:'Pre-IPO Pipeline',sp:4,h:4},
  weight:{n:'Market Weight',sp:4,h:4},volshare:{n:'Volume Share',sp:4,h:4},
  hist:{n:'Return Distribution',sp:4,h:4},retsince:{n:'Total Equity',sp:4,h:4},
  table:{n:'All Markets',sp:12,h:9},
};
const wH=(id,h)=>h||(WIDGETS[id]||{}).h||4;
const SIZE_W=[['S',4],['M',6],['L',12]];      // a third, a half, full width
const SIZE_H=[['S',3],['M',5],['L',8]];       // rows of the 80px grid
const nearestSize=(v,set)=>set.reduce((a,b)=>
  Math.abs(b[1]-v)<Math.abs(a[1]-v)?b:a)[0];
/* how many rows of rowH fit in a widget's body, so a taller capsule shows more
   rather than leaving dead space and a shorter one clips nothing */
function fitRows(id,rowH,min,max){
  const el=$(id);if(!el)return min;
  const h=el.clientHeight||el.parentElement&&el.parentElement.clientHeight||0;
  if(!h)return min;
  return Math.max(min,Math.min(max,Math.floor(h/rowH)));
}
const pkRows=(n,cls)=>Array.from({length:n},()=>
  `<i class="pk-kv"><b></b><u class="${cls||''}"></u></i>`).join('');
const pkBars=(n,cls)=>Array.from({length:n},(_,i)=>
  `<i class="pk-bar"><b></b><s class="${cls||''}" style="width:${86-i*22}%"></s></i>`).join('');
const WPREVIEW={
  pulse:()=>`<i class="pk-big"></i><i class="pk-split"><b></b><u></u></i><i class="pk-curve"></i>`,
  index:()=>`<i class="pk-cols">${Array.from({length:4},()=>
    '<i><b></b><u></u></i>').join('')}</i><i class="pk-l w60"></i>`,
  chart:()=>`<i class="pk-curve tall"></i><i class="pk-tfs">${
    Array.from({length:5},()=>'<b></b>').join('')}</i>`,
  summary:()=>pkRows(5),
  portfolio:()=>`<i class="pk-big sm"></i><i class="pk-curve"></i>${pkBars(2,'up')}`,
  social:()=>Array.from({length:3},()=>
    `<i class="pk-post"><b></b><span><u></u><u class="w70"></u></span></i>`).join(''),
  active:()=>pkBars(4),
  gainers:()=>pkRows(4,'up'),
  losers:()=>pkRows(4,'dn'),
  sectors:()=>pkBars(3,'up'),
  weight:()=>`<svg class="pk-poly" viewBox="0 0 40 34" aria-hidden="true">
    <circle cx="20" cy="17" r="12" fill="none" stroke="rgba(128,182,251,.85)" stroke-width="7"
      stroke-dasharray="34 42"/>
    <circle cx="20" cy="17" r="12" fill="none" stroke="rgba(52,122,205,.8)" stroke-width="7"
      stroke-dasharray="20 56" stroke-dashoffset="-34"/>
    <circle cx="20" cy="17" r="12" fill="none" stroke="rgba(226,229,237,.25)" stroke-width="7"
      stroke-dasharray="22 54" stroke-dashoffset="-54"/></svg>`,
  volshare:()=>WPREVIEW.weight(),
  hist:()=>`<svg class="pk-poly" viewBox="0 0 40 34" aria-hidden="true">
    ${[6,11,17,26,20,9,5].map((v,i)=>
      `<rect x="${3+i*5.2}" y="${29-v}" width="3.6" height="${v}" rx="1"
        fill="${i<3?'rgba(255,69,58,.75)':i===3?'rgba(226,229,237,.5)':'rgba(48,209,88,.75)'}"/>`).join('')}
    <path d="M2 29.5H38" stroke="rgba(226,229,237,.25)" stroke-width="1"/></svg>`,
  radar:()=>`<svg class="pk-poly" viewBox="0 0 40 34" aria-hidden="true">
    <polygon points="20,3 36,14 30,31 10,31 4,14" fill="none" stroke="currentColor" stroke-width=".8" opacity=".35"/>
    <polygon points="20,10 29,16 26,26 14,26 11,16" fill="rgba(77,155,240,.28)" stroke="rgba(77,155,240,.9)" stroke-width="1"/></svg>`,
  retsince:()=>`<i class="pk-big sm"></i><i class="pk-curve tall"></i><i class="pk-tfs">${
    Array.from({length:4},()=>'<b></b>').join('')}</i>`,
  pipeline:()=>pkBars(3,'up'),
  table:()=>`<i class="pk-head"></i>${pkRows(4)}`,
};
const widgetPreview=id=>`<span class="wpArt">${(WPREVIEW[id]||(()=>pkRows(3)))()}</span>`;
let editMode=false,dragId=null,dragFrom=null;
function currentWidgets(){
  if(S.custom&&S.custom.length)return S.custom.map(x=>x.slice());
  return (LAYOUTS[S.layout]||LAYOUTS[DEFAULT_LAYOUT]).w.map(x=>x.slice());
}
/* pack into rows of 12 and give each row one height, so an edit can't leave a
   hole. A row that no longer sums to 12 grows its last widget to close the gap. */
const MIN_SP=3;
/* the same row packing normalise does, but kept as rows so a drop can target one */
function toRows(list){
  const rows=[];let row=[],w=0;
  list.forEach(item=>{
    const it=[item[0],Math.max(2,Math.min(12,item[1]||4)),wH(item[0],item[2])];
    if(w+it[1]>12){rows.push(row);row=[];w=0}
    row.push(it);w+=it[1];
  });
  if(row.length)rows.push(row);
  return rows;
}
/* dropping a capsule between two others has to squeeze that row to make room.
   Appending to the flat list instead overflows the row, which pushes the last
   capsule onto a line of its own and reads as a replacement, not an insert. */
function insertBeside(list,item,i){
  const rows=toRows(list);
  if(!rows.length)return[item];
  let seen=0,ri=rows.length-1,pos=rows[ri].length;
  for(let r=0;r<rows.length;r++){
    if(i<seen+rows[r].length){ri=r;pos=i-seen;break}
    seen+=rows[r].length;
  }
  const row=rows[ri];
  row.splice(Math.max(0,Math.min(pos,row.length)),0,item);
  const sum=()=>row.reduce((a,x)=>a+x[1],0);
  // take width off the widest neighbour first, so the row stays even
  for(let g=0;sum()>12&&g<200;g++){
    const w=row.filter(x=>x!==item&&x[1]>MIN_SP).sort((a,b)=>b[1]-a[1])[0];
    if(!w)break;
    w[1]--;
  }
  for(let g=0;sum()>12&&item[1]>MIN_SP&&g<12;g++)item[1]--;
  if(sum()>12){                       // genuinely full — spill the last neighbour
    const last=row[row.length-1]===item?row[row.length-2]:row[row.length-1];
    row.splice(row.indexOf(last),1);
    rows.splice(ri+1,0,[last]);
  }
  for(let g=0;sum()<12&&g<24;g++){     // and close any slack so the row still tiles
    row.sort((a,b)=>a[1]-b[1])[0][1]++;
  }
  return rows.flat();
}
/* Resizing has to rebalance the whole row. Shrinking a capsule that sits alone
   on its row leaves the row short, and normalise fills a short row by inflating
   its last item — so without this the capsule would snap straight back to full
   width. Pull the next row up instead. */
function setSpan(list,id,sp){
  const rows=toRows(list);
  const ri=rows.findIndex(r=>r.some(x=>x[0]===id));
  if(ri<0)return list;
  const row=rows[ri],it=row.find(x=>x[0]===id);
  it[1]=Math.max(2,Math.min(12,sp));
  const sum=()=>row.reduce((a,x)=>a+x[1],0);
  for(let g=0;sum()>12&&g<200;g++){          // too wide: take it off the neighbours
    const wd=row.filter(x=>x!==it&&x[1]>MIN_SP).sort((a,b)=>b[1]-a[1])[0];
    if(!wd)break;
    wd[1]--;
  }
  while(sum()>12&&row.length>1){             // still over: spill the last neighbour
    const last=row[row.length-1]===it?row[row.length-2]:row[row.length-1];
    row.splice(row.indexOf(last),1);
    rows.splice(ri+1,0,[last]);
  }
  while(sum()<12&&rows[ri+1]&&rows[ri+1].length){   // too narrow: pull the next row up
    const nxt=rows[ri+1][0],room=12-sum();
    if(nxt[1]>room){
      if(room<MIN_SP)break;
      nxt[1]=room;
    }
    row.push(nxt);rows[ri+1].shift();
  }
  return rows.filter(r=>r.length).flat();
}
function normalise(list){
  const out=[];let row=[],w=0;
  const flush=()=>{
    if(!row.length)return;
    let sum=row.reduce((a,x)=>a+x[1],0);
    if(sum!==12){
      const last=row[row.length-1];
      last[1]=Math.max(2,Math.min(12,last[1]+(12-sum)));
      sum=row.reduce((a,x)=>a+x[1],0);
      for(let i=0;sum!==12&&i<row.length*8;i++){         // spread any remainder
        const it=row[i%row.length],d=sum<12?1:-1;
        if(it[1]+d>=2&&it[1]+d<=12){it[1]+=d;sum+=d}
      }
    }
    const h=Math.max(...row.map(x=>x[2]));
    row.forEach(x=>{x[2]=h});
    out.push(...row);row=[];w=0;
  };
  list.forEach(item=>{
    const it=[item[0],Math.max(2,Math.min(12,item[1]||4)),wH(item[0],item[2])];
    if(w+it[1]>12)flush();
    row.push(it);w+=it[1];
  });
  flush();
  return out;
}
function saveCustom(list){
  list=normalise(list);
  S.custom=list;S.layout='custom';
  try{localStorage.setItem('marco.custom',JSON.stringify(list));
    localStorage.setItem('marco.layout','custom')}catch(e){}
  applyWidgets(list);renderPalette();
}
function applyWidgets(list){
  const want=new Map(list.map(([id,sp,h],i)=>[id,{sp,h:wH(id,h),i}]));
  document.querySelectorAll('#p-markets [data-wg]').forEach(el=>{
    const it=want.get(el.dataset.wg);
    if(!it){el.style.display='none';el.style.gridRow='';return}
    el.style.display='';el.style.order=it.i;
    el.style.gridRow='span '+it.h;
    SPANS.forEach(n=>el.classList.toggle('span'+n,n===it.sp));
  });
  if(editMode)decorateAll();
  const b=$('layoutBtn');
  if(b)b.querySelector('.lbN').textContent=
    S.layout==='custom'?'Custom':(LAYOUTS[S.layout]||LAYOUTS[DEFAULT_LAYOUT]).n;
}
/* per-card edit chrome: handle, span stepper, remove */
function decorate(el,sp,h){
  let bar=el.querySelector(':scope > .wEdit');
  if(!bar){bar=document.createElement('div');bar.className='wEdit';el.appendChild(bar)}
  bar.innerHTML=`<span class="wGrip">⠿ ${esc((WIDGETS[el.dataset.wg]||{}).n||el.dataset.wg)}</span>
    <span class="wSize"><i>W</i>${SIZE_W.map(([k,n])=>
      `<button data-sp="${n}" class="${k===nearestSize(sp,SIZE_W)?'on':''}"
        title="${k==='S'?'One third':k==='M'?'Half':'Full'} width">${k}</button>`).join('')}</span>
    <span class="wSize"><i>H</i>${SIZE_H.map(([k,n])=>
      `<button data-h="${n}" class="${k===nearestSize(h,SIZE_H)?'on':''}"
        title="${k} height">${k}</button>`).join('')}</span>
    <button class="wX" data-x aria-label="Remove widget">✕</button>`;
  bar.querySelectorAll('[data-h]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const list=currentWidgets(),rows=[];let row=[],w=0;
    list.forEach(it=>{if(w+it[1]>12){rows.push(row);row=[];w=0}row.push(it);w+=it[1]});
    if(row.length)rows.push(row);
    const band=rows.find(r=>r.some(x=>x[0]===el.dataset.wg));
    if(!band)return;
    band.forEach(x=>{x[2]=+b.dataset.h});   // a band shares one height
    saveCustom(list);});
  bar.querySelectorAll('[data-sp]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    saveCustom(setSpan(currentWidgets(),el.dataset.wg,+b.dataset.sp))});
  bar.querySelector('[data-x]').onclick=e=>{e.stopPropagation();
    saveCustom(currentWidgets().filter(x=>x[0]!==el.dataset.wg))};
}
function decorateAll(){
  const want=new Map(currentWidgets().map(([id,sp,h])=>[id,[sp,wH(id,h)]]));
  document.querySelectorAll('#p-markets [data-wg]').forEach(el=>{
    if(el.style.display==='none'){
      el.draggable=false;
      const b=el.querySelector(':scope > .wEdit');if(b)b.remove();
      return;
    }
    el.draggable=true;
    const it=want.get(el.dataset.wg)||[4,4];
    decorate(el,it[0],it[1]);
  });
}
function undecorate(){
  document.querySelectorAll('#p-markets .wEdit').forEach(b=>b.remove());
  document.querySelectorAll('#p-markets [data-wg]').forEach(el=>{el.draggable=false});
}
function renderPalette(){
  const box=$('wPalette');if(!box)return;
  const placed=new Set(currentWidgets().map(x=>x[0]));
  const spare=Object.keys(WIDGETS).filter(id=>!placed.has(id));
  box.innerHTML=`<span class="wpL">Drag a capsule onto the board</span>
    <span class="wpItems">${spare.length?spare.map(id=>
      `<button class="wpI" draggable="true" data-add="${id}" title="${esc(WIDGETS[id].n)}">
        ${widgetPreview(id)}<span class="wpN">${esc(WIDGETS[id].n)}</span></button>`).join('')
      :'<span class="wpNone">Every capsule is on the board.</span>'}</span>
    <button class="btn" id="wTpl">Start from a template</button>
    <button class="btn p" id="wDone">Done</button>`;
  box.querySelectorAll('[data-add]').forEach(b=>{
    b.ondragstart=e=>{dragId=b.dataset.add;dragFrom='palette';
      e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',dragId)};
    b.ondragend=clearDrop;
  });
  $('wTpl').onclick=openTemplates;
  $('wDone').onclick=()=>setEdit(false);
}
function clearDrop(){
  document.querySelectorAll('#p-markets .dropBefore').forEach(e=>e.classList.remove('dropBefore'));
  dragId=null;dragFrom=null;
}
/* insertion point = the first visible card whose midpoint is past the pointer */
function dropIndex(e){
  const cards=[...document.querySelectorAll('#p-markets [data-wg]')]
    .filter(el=>el.style.display!=='none')
    .sort((a,b)=>(+a.style.order)-(+b.style.order));
  for(let i=0;i<cards.length;i++){
    const r=cards[i].getBoundingClientRect();
    if(e.clientY<r.top+r.height/2||(e.clientY<r.bottom&&e.clientX<r.left+r.width/2))
      return{i,before:cards[i]};
  }
  return{i:cards.length,before:null};
}
function setEdit(on){
  editMode=on;
  const page=$('p-markets');
  page.classList.toggle('editing',on);
  $('wPalette').classList.toggle('on',on);
  $('editBtn').classList.toggle('on',on);
  if(!on){undecorate();clearDrop();return}
  if(!S.custom||!S.custom.length)S.custom=currentWidgets();
  applyWidgets(currentWidgets());renderPalette();
}
/* a canvas does not reflow on resize — it has to be redrawn at the new size */
const REDRAW={pulseCh:()=>renderPulse(),pfSnapCh:()=>renderPfSnap(),
  secRadarCh:()=>renderSectorRadar(),heroChart:()=>renderHeroChart(S.mkt),
  weightCh:()=>renderWeight(),volShareCh:()=>renderVolShare(),histCh:()=>renderHist(),
  retCh:()=>renderRetSince()};
let roTimer=null,roDirty=new Set(),roBusy=false;
function watchResize(){
  if(typeof ResizeObserver!=='function')return;
  const bento=document.querySelector('#p-markets .bento');if(!bento||bento.dataset.ro)return;
  bento.dataset.ro='1';
  const LIST=['gainers','losers','active','pipeline','portfolio','social'];
  const ro=new ResizeObserver(entries=>{
    if(roBusy)return;
    entries.forEach(e=>{const w=e.target.dataset.wg;if(w)roDirty.add(w)});
    clearTimeout(roTimer);
    roTimer=setTimeout(()=>{
      roBusy=true;
      try{
        if(LIST.some(w=>roDirty.has(w)))renderMarkets();
        Object.keys(REDRAW).forEach(id=>{if($(id))REDRAW[id]()});
      }finally{
        roDirty.clear();
        setTimeout(()=>{roBusy=false},60);   // let the relayout settle first
      }
    },140);
  });
  bento.querySelectorAll('[data-wg]').forEach(el=>ro.observe(el));
}
function wireEditor(){
  const bento=document.querySelector('#p-markets .bento');if(!bento||bento.dataset.wired)return;
  bento.dataset.wired='1';
  bento.addEventListener('dragstart',e=>{
    const card=e.target.closest('[data-wg]');if(!card||!editMode)return;
    dragId=card.dataset.wg;dragFrom='board';
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);
    card.classList.add('dragging');
  });
  bento.addEventListener('dragend',e=>{
    const card=e.target.closest('[data-wg]');if(card)card.classList.remove('dragging');
    clearDrop();
  });
  bento.addEventListener('dragover',e=>{
    if(!editMode||!dragId)return;
    e.preventDefault();
    e.dataTransfer.dropEffect=dragFrom==='palette'?'copy':'move';
    const{before}=dropIndex(e);
    document.querySelectorAll('#p-markets .dropBefore').forEach(x=>x.classList.remove('dropBefore'));
    if(before)before.classList.add('dropBefore');
  });
  bento.addEventListener('drop',e=>{
    if(!editMode||!dragId)return;
    e.preventDefault();
    const{i}=dropIndex(e);
    let list=currentWidgets();
    const at=list.findIndex(x=>x[0]===dragId);
    const item=at>=0?list.splice(at,1)[0]
      :[dragId,(WIDGETS[dragId]||{}).sp||4,wH(dragId)];
    const idx=at>=0&&at<i?i-1:i;
    list=insertBeside(list,item,Math.max(0,Math.min(idx,list.length)));
    clearDrop();saveCustom(list);
  });
}

/* ════════ generative sector art ════════
   Deterministic SVG per sector — seeded off the sector key so a sector always
   draws the same picture, and inline so the file stays self-contained with no
   image host for a CSP to block. Each sector gets its own geometry rather than
   one shape recoloured. */
function artRnd(seed){let a=hash(seed)>>>0;
  return()=>{a^=a<<13;a>>>=0;a^=a>>17;a^=a<<5;a>>>=0;return a/4294967296}}
const ART_SPECS={
  ai:{t:'AI & semis',f(r){                       // die lattice with lit traces
    let g='';
    for(let y=0;y<5;y++)for(let x=0;x<8;x++){
      const cx=34+x*46,cy=40+y*44,lit=r()>.74;
      g+=`<circle cx="${cx}" cy="${cy}" r="${lit?3.4:2}"
        fill="${lit?'rgba(77,155,240,.95)':'rgba(226,229,237,.30)'}"/>`;
      if(x<7&&r()>.42)g+=`<path d="M${cx+4} ${cy}H${cx+42}" stroke="${
        r()>.7?'rgba(77,155,240,.55)':'rgba(226,229,237,.14)'}" stroke-width="1.1"/>`;
      if(y<4&&r()>.62)g+=`<path d="M${cx} ${cy+4}V${cy+40}" stroke="rgba(226,229,237,.12)" stroke-width="1.1"/>`;
    }
    return g+`<rect x="120" y="82" width="150" height="96" rx="10" fill="none"
      stroke="rgba(77,155,240,.45)" stroke-width="1.4"/>`}},
  robotics:{t:'Robotics',f(r){                   // an articulated arm over a floor grid
    let g='';
    for(let i=0;i<9;i++)g+=`<path d="M0 ${190+i*9} H400" stroke="rgba(226,229,237,.07)" stroke-width="1"/>`;
    for(let i=0;i<11;i++)g+=`<path d="M${i*40} 190 L${i*40+(i-5)*16} 260"
      stroke="rgba(226,229,237,.07)" stroke-width="1"/>`;
    const j=[[70,196],[126,120],[214,96],[292,132],[330,176]];
    j.forEach((p,i)=>{const n=j[i+1];
      if(n)g+=`<path d="M${p[0]} ${p[1]} L${n[0]} ${n[1]}" stroke="rgba(226,229,237,.55)"
        stroke-width="${9-i*1.2}" stroke-linecap="round"/>`});
    j.forEach((p,i)=>{
      g+=`<circle cx="${p[0]}" cy="${p[1]}" r="${9-i}" fill="rgba(20,21,25,.9)"
        stroke="${i===j.length-1?'rgba(77,155,240,.95)':'rgba(226,229,237,.7)'}" stroke-width="2"/>`});
    g+=`<circle cx="330" cy="176" r="18" fill="none" stroke="rgba(77,155,240,.35)" stroke-width="1.2"/>`;
    for(let i=0;i<14;i++){const x=r()*400,y=r()*150;
      g+=`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(r()*1.4+.5).toFixed(1)}"
        fill="rgba(226,229,237,.22)"/>`}
    return g}},
  china:{t:'China tech',f(r){                    // skyline against a rising arc
    let g=`<circle cx="200" cy="205" r="120" fill="none" stroke="rgba(77,155,240,.28)" stroke-width="1.4"/>
      <circle cx="200" cy="205" r="168" fill="none" stroke="rgba(226,229,237,.10)" stroke-width="1.2"/>`;
    let x=18;
    while(x<392){const w=16+r()*30,h=40+r()*130;
      g+=`<rect x="${x.toFixed(0)}" y="${(228-h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"
        rx="2" fill="rgba(226,229,237,${(0.07+r()*0.13).toFixed(2)})"/>`;
      for(let wy=(228-h)+10;wy<220;wy+=14)if(r()>.62)
        g+=`<rect x="${(x+4).toFixed(0)}" y="${wy.toFixed(0)}" width="4" height="4"
          fill="rgba(77,155,240,${(0.3+r()*0.5).toFixed(2)})"/>`;
      x+=w+6+r()*10}
    return g+`<path d="M0 228H400" stroke="rgba(226,229,237,.22)" stroke-width="1.2"/>`}},
  crypto:{t:'Crypto',f(r){                       // hex mesh with a linked spine
    let g='';const hex=(cx,cy,s,fill,st)=>{
      const p=[];for(let i=0;i<6;i++){const a=Math.PI/180*(60*i-30);
        p.push(`${(cx+s*Math.cos(a)).toFixed(1)},${(cy+s*Math.sin(a)).toFixed(1)}`)}
      return`<polygon points="${p.join(' ')}" fill="${fill}" stroke="${st}" stroke-width="1.1"/>`};
    for(let row=0;row<5;row++)for(let col=0;col<8;col++){
      const cx=34+col*50+(row%2?25:0),cy=38+row*46,on=r()>.78;
      g+=hex(cx,cy,20,on?'rgba(77,155,240,.20)':'none',
        on?'rgba(77,155,240,.85)':'rgba(226,229,237,.14)')}
    const spine=[[60,84],[135,130],[210,84],[285,130],[350,84]];
    g+=`<path d="M${spine.map(p=>p.join(' ')).join(' L')}" fill="none"
      stroke="rgba(77,155,240,.55)" stroke-width="1.6"/>`;
    spine.forEach(p=>{g+=`<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="rgba(77,155,240,.95)"/>`});
    return g}},
};
function sectorArtSVG(key){
  const spec=ART_SPECS[key]||ART_SPECS.ai;
  const r=artRnd('art:'+key);
  return `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><radialGradient id="sag-${key}" cx="50%" cy="20%" r="80%">
      <stop offset="0" stop-color="rgba(77,155,240,.16)"/>
      <stop offset="1" stop-color="rgba(77,155,240,0)"/></radialGradient></defs>
    <rect width="400" height="260" fill="url(#sag-${key})"/>
    ${spec.f(r)}</svg>`;
}
/* how the day's moves are spread across the board — one bar per return bucket,
   so a broad rally and a narrow one look different at a glance */
const HIST_EDGES=[-8,-4,-2,-1,0,1,2,4,8];
function histBins(){
  const live=MARKETS.filter(m=>m.chg!=null);
  const bins=[];
  for(let i=0;i<=HIST_EDGES.length;i++){
    const lo=i===0?-Infinity:HIST_EDGES[i-1],hi=i===HIST_EDGES.length?Infinity:HIST_EDGES[i];
    const mid=i===0?HIST_EDGES[0]-1:i===HIST_EDGES.length?HIST_EDGES[i-1]+1:(lo+hi)/2;
    bins.push({lo,hi,mid,n:live.filter(m=>m.chg>=lo&&m.chg<hi).length,
      edge:i?(HIST_EDGES[i-1]>0?'+':'')+HIST_EDGES[i-1]+'%':null});
  }
  return{bins,live};
}
function renderHist(){
  const box=$('histBody');if(!box)return;
  const{bins,live}=histBins();
  if(!live.length){box.innerHTML='<div class="mini">Connecting…</div>';return}
  const up=live.filter(m=>m.chg>0).length,dn=live.filter(m=>m.chg<0).length;
  const avg=live.reduce((a,m)=>a+m.chg,0)/live.length;
  const wid=Math.max(...live.map(m=>Math.abs(m.chg)));
  box.innerHTML=`<div class="histCh"><canvas id="histCh"></canvas></div>
    <div class="histFoot">
      <span>Advancing<b class="num up">${up}</b></span>
      <span>Declining<b class="num dn">${dn}</b></span>
      <span>Median<b class="num ${dir(avg)}">${pctS(avg)}</b></span>
      <span>Widest<b class="num">${wid.toFixed(1)}%</b></span>
    </div>`;
  drawHistogram($('histCh'),bins);
}
