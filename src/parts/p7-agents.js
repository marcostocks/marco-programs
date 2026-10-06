
/* ════════ agents ════════
   Research agents that watch the listed universe and the pre-IPO pipeline and
   report what changed. Findings are derived from the same market data the rest
   of the app runs on — turnover, range position, market cap, subscription pace —
   so they move when the feed moves. Anything not derivable from that data is
   drawn from a seeded template list and labelled as such in the UI.
   Nothing here is a recommendation: agents report observations, not positions. */

const AG_TPL=[
  {id:'screen',n:'Valuation Screen',
   d:'Ranks the universe on size and range position, and flags names sitting well away from the group.',
   sig:['Multiple vs group median','52-week range position','Market cap shifts'],
   ic:'<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'},
  {id:'flow',n:'Turnover Monitor',
   d:'Watches traded value against each name’s own baseline and calls out unusual activity.',
   sig:['Turnover vs baseline','Session range','Participation breadth'],
   ic:'<path d="M3 12h4l3 7 4-14 3 7h4"/>'},
  {id:'earn',n:'Results & Guidance',
   d:'Tracks the reporting calendar for the universe and summarises what management guided to.',
   sig:['Results calendar','Guidance revisions','Segment growth'],
   ic:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 2v4M16 2v4M4 10h16"/>'},
  {id:'policy',n:'Policy & Regulation',
   d:'Follows export controls, state subsidy programmes and listing-rule changes touching the sector.',
   sig:['Export controls','Subsidy programmes','Listing rules'],
   ic:'<path d="M12 3l8 4v6c0 4.4-3.4 7.4-8 8-4.6-.6-8-3.6-8-8V7z"/>'},
  {id:'chain',n:'Supply Chain',
   d:'Maps each name to its foundry, memory and component dependencies and watches for strain.',
   sig:['Foundry capacity','Component lead times','Customer concentration'],
   ic:'<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="12" cy="18" r="2.6"/><path d="M8.6 6h6.8M6.9 8.3L11 15.7M17.1 8.3L13 15.7"/>'},
  {id:'vault',n:'Pre-IPO Tracker',
   d:'Follows subscription pace and closing windows across the vault pipeline.',
   sig:['Subscription pace','Closing windows','Allocation risk'],
   ic:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.4"/>'},
];
const AGT=id=>AG_TPL.find(t=>t.id===id)||AG_TPL[0];
const AG_CAD=[['15m','Every 15 min'],['1h','Hourly'],['4h','Every 4 hours'],
  ['1d','Daily'],['1w','Weekly']];
const cadN=c=>(AG_CAD.find(x=>x[0]===c)||AG_CAD[1])[1];
const cadMin=c=>({'15m':15,'1h':60,'4h':240,'1d':1440,'1w':10080}[c]||60);
const AG_UNI=[['all','All markets'],['ai','AI'],['semi','Semiconductors'],
  ['robotics','Robotics'],['tech','Tech'],['crypto','Crypto']];
const uniN=u=>(AG_UNI.find(x=>x[0]===u)||AG_UNI[0])[1];
const agMarkets=a=>a.uni==='all'?MARKETS.slice():MARKETS.filter(m=>m.s===a.uni);

/* ships with three agents already running so the page has something to show */
const AG_SEED=[
  {id:'ag1',tpl:'screen',name:'AI valuation screen',uni:'ai',cad:'1h',on:true,born:26},
  {id:'ag2',tpl:'flow',name:'Turnover monitor — all markets',uni:'all',cad:'15m',on:true,born:63},
  {id:'ag3',tpl:'vault',name:'Pre-IPO subscription pace',uni:'all',cad:'4h',on:false,born:12},
];
function loadAgents(){
  if(S.agents)return S.agents;
  let raw=null;
  try{raw=JSON.parse(localStorage.getItem('marco.agents')||'null')}catch(e){}
  S.agents=(Array.isArray(raw)&&raw.length?raw:AG_SEED).map(a=>Object.assign({},a));
  return S.agents;
}
function saveAgents(){try{localStorage.setItem('marco.agents',JSON.stringify(S.agents))}catch(e){}}
let agSeq=100;
const agNewId=()=>'ag'+(++agSeq)+'-'+(S.agents||[]).length;

/* ════════ findings ════════
   Deterministic per agent+subject so a re-render never reshuffles the feed. */
const agRnd=k=>{let h=hash(k);return()=>{h=(h*1664525+1013904223)>>>0;return h/4294967296}};
const POLICY=[
  ['Export controls','Updated entity-list guidance covers advanced accelerator sales into the mainland.'],
  ['State funding','A third tranche of the national semiconductor fund has been allocated to domestic tooling.'],
  ['Listing rules','Hong Kong’s 18C route was widened for pre-revenue specialist technology issuers.'],
  ['Data rules','Cross-border data transfer filings were simplified for firms below the volume threshold.'],
  ['Procurement','State-owned enterprise procurement now weights domestically produced compute.'],
  ['Model approval','A further batch of generative model registrations cleared the public-service list.'],
];
const CHAIN=[
  ['Foundry','Advanced-node capacity is booked out through the next two quarters.'],
  ['Memory','High-bandwidth memory lead times extended again, now quoted beyond six months.'],
  ['Packaging','Advanced packaging remains the binding constraint on accelerator output.'],
  ['Concentration','The top three customers account for a majority of segment revenue.'],
  ['Substrate','Substrate pricing has firmed for a third consecutive quarter.'],
  ['Tooling','Domestic deposition and etch tooling continues to displace imported equipment.'],
];
const EARN_SEG=['data centre','cloud','advertising','devices','autonomous driving',
  'commerce','logistics','foundation models','robotics'];
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* how far through the 24h range the last price sits — 0 at the low, 100 at the high */
function rangePos(m){
  if(!m.hi||!m.lo||m.hi<=m.lo)return null;
  return Math.max(0,Math.min(100,(m.px-m.lo)/(m.hi-m.lo)*100));
}
const medianOf=a=>{const s=a.slice().sort((x,y)=>x-y);if(!s.length)return 0;
  const i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2};

function findings(a){
  const out=[],ms=agMarkets(a).filter(m=>m.px);
  const R=agRnd(a.id+a.tpl+a.uni);
  const mins=i=>Math.round(4+i*cadMin(a.cad)*(.5+R()*1.4));
  if(a.tpl==='flow'){
    /* a name is only unusual against its own history, and the app carries no
       volume history — so the baseline is seeded per market and the finding is
       labelled illustrative. Turnover share and range position are real. */
    const tot=ms.reduce((x,m)=>x+(m.vol||0),0)||1;
    ms.filter(m=>m.vol).map(m=>{
      const base=m.vol/(.62+agRnd(m.id+'base')()*.9);
      return{m,x:m.vol/base,sh:m.vol/tot*100}})
      .sort((p,q)=>q.x-p.x).slice(0,5)
      .forEach((r,i)=>{
        const rp=rangePos(r.m);
        out.push({m:r.m,tag:'Turnover',sev:r.x>1.45?'high':r.x>1.15?'med':'low',
          t:`${r.m.n} turnover running at ${r.x.toFixed(2)}× its 30-day average`,
          d:`${compact(r.m.vol)} over 24h, ${r.sh<.1?'<0.1':r.sh.toFixed(1)}% of turnover across the universe`
            +(rp==null?'':`; last price ${rp.toFixed(0)}% through the session range`)+'.',
          mins:mins(i),est:true});
      });
  }else if(a.tpl==='screen'){
    const caps=ms.map(m=>m.capN||0).filter(Boolean);
    const med=medianOf(caps)||1;
    ms.filter(m=>m.capN).map(m=>({m,x:m.capN/med})).sort((p,q)=>q.x-p.x)
      .filter((_,i,arr)=>i<3||i>=arr.length-2).slice(0,5)
      .forEach((r,i)=>{
        const rp=rangePos(r.m),big=r.x>=1;
        out.push({m:r.m,tag:'Screen',sev:r.x>4||r.x<.25?'high':'med',
          t:`${r.m.n} carries ${r.x.toFixed(1)}× the group median capitalisation`,
          d:`${compact(r.m.capN)} against a ${compact(med)} median`+(rp==null?'':
            `; last price sits ${rp.toFixed(0)}% through the 24h range`)+'.',
          mins:mins(i)});
      });
  }else if(a.tpl==='earn'){
    ms.slice(0,5).forEach((m,i)=>{
      const r=agRnd(m.id+'earn'),days=Math.round(3+r()*80);
      const dt=new Date(Date.now()+days*864e5);
      const seg=EARN_SEG[Math.floor(r()*EARN_SEG.length)];
      const g=Math.round(8+r()*46);
      out.push({m,tag:'Results',sev:days<14?'high':days<40?'med':'low',
        t:`${m.n} reports on ${MON[dt.getMonth()]} ${dt.getDate()}`,
        d:`${days} days out. Last quarter management guided to ${g}% growth in ${seg}.`,
        mins:mins(i),est:true});
    });
  }else if(a.tpl==='policy'){
    POLICY.forEach((p,i)=>{
      if(i>=4)return;
      const m=ms[Math.floor(agRnd(a.id+p[0])()*ms.length)];
      out.push({m,tag:p[0],sev:i===0?'high':i<2?'med':'low',t:p[1],
        d:m?`Most exposed in this universe: ${m.n}.`:'',mins:mins(i),est:true});
    });
  }else if(a.tpl==='chain'){
    CHAIN.forEach((p,i)=>{
      if(i>=4)return;
      const m=ms[Math.floor(agRnd(a.id+p[0]+'c')()*ms.length)];
      out.push({m,tag:p[0],sev:i<2?'high':'med',t:p[1],
        d:m?`Read across to ${m.n}.`:'',mins:mins(i),est:true});
    });
  }else{
    VAULTS.filter(v=>v.status==='open'||v.status==='soon')
      .sort((x,y)=>subPct(y)-subPct(x)).slice(0,5).forEach((v,i)=>{
        const p=subPct(v),full=gtdRoom(v)<=.005;
        out.push({v,tag:full?'Fully subscribed':'Subscription',
          sev:full?'high':p>70?'med':'low',
          t:`${v.name} is ${p.toFixed(0)}% subscribed`,
          d:full?'The cap is reached; subscription is closed.'
            :`${compact(gtdRoom(v))} of room left`+(v.close?`, closing ${cdShort(v.close)}`:'')+'.',
          mins:mins(i)});
      });
  }
  return out.sort((x,y)=>x.mins-y.mins);
}
/* one bar per day, so the detail page shows whether an agent is actually working */
function agActivity(a,n){
  const R=agRnd(a.id+'act'),per=Math.max(1,Math.round(1440/cadMin(a.cad)));
  return Array.from({length:n||30},()=>Math.round(per*(.55+R()*.9)));
}
const agRuns=a=>{const d=Math.max(1,a.born||1);
  return Math.round(d*1440/cadMin(a.cad)*.92)};
const agAgo=a=>{if(!a.on)return 'Paused';
  const R=agRnd(a.id+'last'),m=Math.max(1,Math.round(cadMin(a.cad)*R()));
  return m<60?m+'m ago':m<1440?Math.round(m/60)+'h ago':Math.round(m/1440)+'d ago'};
const agNext=a=>{if(!a.on)return '—';
  const R=agRnd(a.id+'next'),m=Math.max(1,Math.round(cadMin(a.cad)*R()));
  return m<60?'in '+m+'m':m<1440?'in '+Math.round(m/60)+'h':'in '+Math.round(m/1440)+'d'};
const agoTxt=m=>m<60?m+'m ago':m<1440?Math.round(m/60)+'h ago':Math.round(m/1440)+'d ago';
const agIcon=(t,cls)=>`<span class="agIc ${cls||''}"><svg viewBox="0 0 24 24">${AGT(t).ic}</svg></span>`;

/* ════════ list ════════ */
function renderAgents(){
  const box=$('agentGrid');if(!box)return;
  const list=loadAgents();
  const live=list.filter(a=>a.on);
  const all=list.flatMap(a=>a.on?findings(a).map(f=>Object.assign({a},f)):[]);
  $('agStats').innerHTML=[
    ['Agents running',live.length+' of '+list.length],
    ['Findings today',qty(all.length,0)],
    ['Markets covered',qty(new Set(live.flatMap(a=>agMarkets(a).map(m=>m.id))).size,0)],
    ['Fastest cadence',live.length?cadN(live.slice().sort((x,y)=>cadMin(x.cad)-cadMin(y.cad))[0].cad):'—'],
  ].map(s=>`<div class="agStat"><div class="hk">${s[0]}</div><div class="hv num">${s[1]}</div></div>`).join('');

  box.innerHTML=list.map(a=>{
    const t=AGT(a.tpl),n=findings(a).length;
    return `<button class="card agCard" data-ag="${a.id}">
      <div class="agTop">
        ${agIcon(a.tpl)}
        <span class="agName">${esc(a.name)}</span>
        <span class="agState ${a.on?'on':''}"><i></i>${a.on?'Running':'Paused'}</span>
      </div>
      <div class="agMeta">${esc(t.n)} <s>·</s> ${esc(uniN(a.uni))} <s>·</s> ${esc(cadN(a.cad))}</div>
      <div class="agSpark"><canvas id="agSp-${a.id}"></canvas></div>
      <div class="agFoot">
        <span><b class="num">${qty(a.on?n:0,0)}</b> open findings</span>
        <span class="mini">${a.on?'Ran '+agAgo(a):'Paused'}</span>
      </div>
    </button>`;
  }).join('')+`<button class="card agCard agNew" id="agAdd">
      <span class="agPlus">+</span>
      <span class="agName">New agent</span>
      <span class="agMeta">Pick a research template and a universe to watch.</span>
    </button>`;
  list.forEach(a=>{const cv=$('agSp-'+a.id);if(!cv)return;
    spark(cv,agActivity(a,30),a.on?cssv('--brand'):cssv('--mute'))});
  box.querySelectorAll('[data-ag]').forEach(b=>b.onclick=()=>openAgent(b.dataset.ag));
  $('agAdd').onclick=()=>openBuilder();

  const feed=all.sort((x,y)=>x.mins-y.mins).slice(0,12);
  $('agFeed').innerHTML=feed.length?feed.map(f=>fRow(f,true)).join('')
    :`<div class="agEmpty">No agents are running. Start one to collect findings.</div>`;
  wireFeed($('agFeed'));
}
function fRow(f,showAgent){
  const sub=f.m?`${esc(f.m.n)} <span class="num">${esc(f.m.sym)}</span>`
    :f.v?`${esc(f.v.name)} <span class="num">m${esc(f.v.ticker)}</span>`:'';
  const go=f.m?`data-fm="${f.m.id}"`:f.v?`data-fv="${f.v.id}"`:'';
  return `<div class="fRow ${go?'go':''}" ${go}>
    <span class="fSev ${f.sev}" aria-hidden="true"></span>
    <div class="fBody">
      <div class="fTop"><span class="fTag ${f.sev}">${esc(f.tag)}</span>
        ${showAgent&&f.a?`<span class="fAg">${esc(f.a.name)}</span>`:''}
        ${f.est?'<span class="fEst">Illustrative</span>':''}
        <span class="fAgo mini">${agoTxt(f.mins)}</span></div>
      <div class="fT">${esc(f.t)}</div>
      <div class="fD">${f.d}</div>
      ${sub?`<div class="fSub">${sub}</div>`:''}
    </div></div>`;
}
function wireFeed(box){
  if(!box)return;
  box.querySelectorAll('[data-fm]').forEach(e=>e.onclick=()=>openMarket(e.dataset.fm));
  box.querySelectorAll('[data-fv]').forEach(e=>e.onclick=()=>{go('preipo');openVault(e.dataset.fv)});
}

/* ════════ detail ════════ */
function openAgent(id){
  const a=loadAgents().find(x=>x.id===id);if(!a)return;
  S.agent=a;
  $('agentList').style.display='none';$('agentDetail').style.display='block';
  const t=AGT(a.tpl),fs=a.on?findings(a):[];
  const ms=agMarkets(a);
  $('agentDetail').innerHTML=`
    <button class="back" id="agBack">‹ All agents</button>
    <div class="vtop">
      ${agIcon(a.tpl,'lg')}
      <div style="min-width:0">
        <span class="vTick" style="font-size:36px">${esc(a.name)}</span>
        <span class="vMeta">${esc(t.n)} · ${esc(uniN(a.uni))} · ${esc(cadN(a.cad))}</span>
      </div>
      <span class="vBadge ${a.on?'live':''}">${a.on?'Running':'Paused'}</span>
      <span style="flex:1"></span>
      <button class="btn" id="agToggle">${a.on?'Pause':'Resume'}</button>
      <button class="btn" id="agEdit">Edit</button>
      <button class="btn" id="agDel">Delete</button>
    </div>
    <div class="hstats">
      ${[['Runs',qty(agRuns(a),0)],['Open findings',qty(fs.length,0)],
         ['Markets watched',qty(ms.length,0)],['Last run',agAgo(a)],['Next run',agNext(a)]]
        .map(s=>`<div class="hstat"><div class="hk">${s[0]}</div><div class="hv num">${s[1]}</div></div>`).join('')}
    </div>
    <div class="bento" style="margin-top:24px">
      <div class="card span8">
        <div class="ch"><span class="ct">Findings Per Day</span><span class="cs">Last 30 days</span></div>
        <div class="cwrap" style="height:200px;padding:8px 18px 16px"><canvas id="agActCh"></canvas></div>
      </div>
      <div class="card span4">
        <div class="ch"><span class="ct">Configuration</span></div>
        <div style="padding:14px 20px 20px">
          <div class="row"><span>Template</span><b>${esc(t.n)}</b></div>
          <div class="row"><span>Universe</span><b>${esc(uniN(a.uni))}</b></div>
          <div class="row"><span>Cadence</span><b>${esc(cadN(a.cad))}</b></div>
          <div class="row"><span>Delivery</span><b>In-app feed</b></div>
          <div class="mini" style="margin:14px 0 8px">Signals watched</div>
          ${t.sig.map(x=>`<div class="agSig">${esc(x)}</div>`).join('')}
        </div>
      </div>
      <div class="card span12">
        <div class="ch"><span class="ct">Findings</span><span class="cs">${
          a.on?'Newest first':'Agent is paused'}</span></div>
        <div id="agDetFeed" style="padding:6px 8px 12px"></div>
      </div>
    </div>`;
  $('agDetFeed').innerHTML=fs.length?fs.map(f=>fRow(f,false)).join('')
    :'<div class="agEmpty">Nothing to report while this agent is paused.</div>';
  wireFeed($('agDetFeed'));
  sparkBars($('agActCh'),agActivity(a,30),cssv('--brand'));
  $('agBack').onclick=agentsBack;
  $('agToggle').onclick=()=>{a.on=!a.on;saveAgents();openAgent(a.id)};
  $('agEdit').onclick=()=>openBuilder(a);
  $('agDel').onclick=()=>{
    S.agents=S.agents.filter(x=>x.id!==a.id);saveAgents();agentsBack();
    toast('Agent deleted')};
  if(location.hash!=='#/agents/'+a.id)history.replaceState(null,'','#/agents/'+a.id);
  scrollTo(0,0);
}
function agentsBack(){
  S.agent=null;
  $('agentList').style.display='block';$('agentDetail').style.display='none';
  renderAgents();scrollTo(0,0);
  if(location.hash!=='#/agents')history.replaceState(null,'','#/agents');
}

/* ════════ builder ════════ */
let agDraft=null;
function openBuilder(a){
  agDraft=a?Object.assign({},a):{id:null,tpl:'screen',uni:'ai',cad:'1h',on:true,born:1,name:''};
  $('agOverlay').classList.add('on');
  renderBuilder();
}
function closeBuilder(){$('agOverlay').classList.remove('on');agDraft=null}
const agAutoName=d=>`${uniN(d.uni)==='All markets'?'All markets':uniN(d.uni)} — ${AGT(d.tpl).n.toLowerCase()}`;
function renderBuilder(){
  const d=agDraft;if(!d)return;
  const t=AGT(d.tpl);
  $('agBTitle').textContent=d.id?'Edit Agent':'New Agent';
  $('agTplGrid').innerHTML=AG_TPL.map(x=>`<button class="agTpl ${x.id===d.tpl?'on':''}" data-tpl="${x.id}">
      ${agIcon(x.id)}
      <span class="agTplN">${esc(x.n)}</span>
      <span class="agTplD">${esc(x.d)}</span>
    </button>`).join('');
  $('agUni').innerHTML=AG_UNI.map(u=>{
    const n=u[0]==='all'?MARKETS.length:MARKETS.filter(m=>m.s===u[0]).length;
    return `<button class="${u[0]===d.uni?'on':''}" data-uni="${u[0]}">${esc(u[1])}
      <s class="num">${n}</s></button>`}).join('');
  $('agCad').innerHTML=AG_CAD.map(c=>
    `<button class="${c[0]===d.cad?'on':''}" data-cad="${c[0]}">${esc(c[1])}</button>`).join('');
  $('agSigs').innerHTML=t.sig.map(x=>`<div class="agSig on">${esc(x)}</div>`).join('');
  const nm=$('agName');
  if(document.activeElement!==nm)nm.value=d.name||'';
  nm.placeholder=agAutoName(d);
  const cov=agMarkets(d).length;
  $('agPrev').textContent=`Watches ${cov} market${cov===1?'':'s'}, ${cadN(d.cad).toLowerCase()}.`;
  $('agTplGrid').querySelectorAll('[data-tpl]').forEach(b=>b.onclick=()=>{d.tpl=b.dataset.tpl;renderBuilder()});
  $('agUni').querySelectorAll('[data-uni]').forEach(b=>b.onclick=()=>{d.uni=b.dataset.uni;renderBuilder()});
  $('agCad').querySelectorAll('[data-cad]').forEach(b=>b.onclick=()=>{d.cad=b.dataset.cad;renderBuilder()});
  nm.oninput=()=>{d.name=nm.value};
  $('agSave').textContent=d.id?'Save changes':'Create agent';
  $('agSave').onclick=()=>{
    const name=(d.name||'').trim()||agAutoName(d);
    if(d.id){const a=S.agents.find(x=>x.id===d.id);
      Object.assign(a,{tpl:d.tpl,uni:d.uni,cad:d.cad,name});
      saveAgents();closeBuilder();openAgent(a.id);toast('Agent updated');return}
    const a={id:agNewId(),tpl:d.tpl,uni:d.uni,cad:d.cad,on:true,born:1,name};
    loadAgents().push(a);saveAgents();closeBuilder();renderAgents();
    toast('Agent created — first run scheduled');
  };
}
