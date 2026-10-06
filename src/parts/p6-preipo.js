/* ════════ pre-IPO vaults and valuation futures — embedded products ════════

   Both are complete apps that also ship on their own. Inside the platform each
   runs in a same-origin frame filling the page beside the rail, and the shell
   owns what the three have to share: the theme, the wallet and the URL.

   The contract is window.MarcoShell. An embedded app registers
   {theme, wallet, route} with it, and reports its own wallet and route changes
   back. Opened anywhere else an app never finds a shell, and behaves exactly as
   it does standalone. */

/* vault arithmetic the markets, portfolio and agents views still use */
const subPct=v=>Math.min(100,v.raisedUsd/v.vaultSize*100);
const vaultCost=p=>Math.max(0,(p.sub||0)-(p.fee||0));
const gtdRoom=v=>Math.max(0,v.vaultSize-v.raisedUsd);

const EMBEDS={
  preipo:{src:'apps/preipo/index.html',title:'Marco pre-IPO vaults'},
  futures:{src:'apps/futures/index.html',title:'Marco valuation futures'},
};
const EMBED_PAGES=Object.keys(EMBEDS);
const embedApi={};     // page → the API its frame registered
const embedWant={};    // page → a route asked for before the frame was ready

const shellTheme=()=>document.documentElement.getAttribute('data-theme')||'dark';
/* A real wallet is shared with the frames; the labelled simulation is not —
   handing it on would have a frame try to sign with a wallet that isn't there. */
const realWallet=()=>!!S.wallet&&S.walletKind!=='simulated';
const eachEmbed=fn=>Object.values(embedApi).forEach(api=>{try{fn(api)}catch(e){console.warn(e)}});

/* The shell's @font-face rules, for a frame that ships without its own fonts. */
function shellFontCSS(){
  let css='';
  for(const sh of document.styleSheets){
    let rules;try{rules=sh.cssRules}catch{continue}
    for(const r of rules)if(r.type===CSSRule.FONT_FACE_RULE)css+=r.cssText+'\n';
  }
  return css;
}

window.MarcoShell={
  theme:shellTheme,
  fontCSS:shellFontCSS,
  register(page,api){
    embedApi[page]=api;
    api.theme?.(shellTheme());
    if(realWallet())api.wallet?.(true);
    if(embedWant[page]!=null){api.route?.(embedWant[page]);embedWant[page]=null}
  },
  /* a frame connected or disconnected on its own — e.g. Subscribe asking for a wallet */
  walletChanged(connected){if(connected!==realWallet())setWallet(connected,{fromFrame:true})},
  /* keep the address bar on the frame's view, so a pre-IPO deep link can be shared */
  routeChanged(page,path){
    if(S.page!==page)return;
    const h='#/'+page+(path?'/'+path:'');
    if(location.hash!==h)history.replaceState(null,'',h);
  },
  walletConnected:()=>realWallet(),
  demo:DEMO_MODE,          // the recorded tour: frames stay on their simulations
  open:(page,path)=>openEmbed(page,path),
  toast:msg=>toast(msg),
};

/* Frames are built on first visit, then kept: leaving Pre-IPO for Markets and
   coming back returns to the same offering, scrolled where it was. */
function embedFrame(page){
  const host=$('emb-'+page);
  let f=host.querySelector('iframe');
  if(f)return f;
  f=document.createElement('iframe');
  f.title=EMBEDS[page].title;
  const want=embedWant[page];embedWant[page]=null;
  f.src=EMBEDS[page].src+(want?'#/'+want:'');
  host.appendChild(f);
  return f;
}
function openEmbed(page,path){
  if(path!=null&&!embedApi[page])embedWant[page]=path;
  if(S.page!==page)go(page);else embedFrame(page);
  if(path!=null&&embedApi[page])embedApi[page].route?.(path);
}
/* every vault link in the platform — tape, pipeline, watchlist, portfolio,
   agents — lands on that offering in the Pre-IPO app */
function openVault(id){openEmbed('preipo',V(id)?id:'')}

/* ════════ router ════════ */
function go(page){
  S.page=page;
  if(page!=='agents'&&S.agent)S.agent=null;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('on',p.id==='p-'+page));
  document.querySelectorAll('.rbtn[data-nav]').forEach(b=>{
    const on=b.dataset.nav===page;b.classList.toggle('on',on);
    on?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current')});
  const av=$('avatar');
  if(av){av.classList.toggle('on',page==='settings');
    page==='settings'?av.setAttribute('aria-current','page'):av.removeAttribute('aria-current')}
  // an embedded page keeps its sub-route; the frame reports it via routeChanged
  const path='#/'+page;
  if(location.hash!==path&&!location.hash.startsWith(path+'/'))history.replaceState(null,'',path);
  renderTape();
  if(page==='markets')renderMarkets();
  if(page==='trade'){S.series=series(S.mkt.id,S.mkt.px,S.tf);setMode(S.mode)}
  if(page==='portfolio')renderPortfolio();
  if(EMBED_PAGES.includes(page))embedFrame(page);
  // Chain-backed vaults refresh in the background, so the platform's own
  // figures for them (tape, pipeline, portfolio) match the Pre-IPO app.
  if(page==='markets'||page==='portfolio')syncChainVaults({fresh:true}).then(changed=>{
    if(!changed)return;
    if(S.page==='portfolio')renderPortfolio();
    if(S.page==='markets')renderMarkets();
  });
  if(page==='agents'&&!S.agent){$('agentList').style.display='block';
    $('agentDetail').style.display='none';renderAgents()}
  if(page==='settings')renderSettings();
  if(S.wlOpen)renderWatch();
  scrollTo(0,0);
}

/* ════════ live feed ════════ */
async function feed(){
  let n=0;
  await Promise.all([
    fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=usdt-futures').then(r=>r.json()).then(j=>{
      const by={};(j.data||[]).forEach(t=>by[t.symbol]=t);
      MARKETS.filter(m=>m.v==='bitget').forEach(m=>{const t=by[m.f];if(!t)return;
        m.px=parseFloat(t.lastPr);m.chg=parseFloat(t.change24h)*100;m.vol=parseFloat(t.usdtVolume||0);
        m.hi=parseFloat(t.high24h||0);m.lo=parseFloat(t.low24h||0);n++})}).catch(()=>{}),
    fetch('https://api.binance.com/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(
      MARKETS.filter(m=>m.v==='binance').map(m=>m.f)))).then(r=>r.json()).then(a=>{
      const by={};(Array.isArray(a)?a:[]).forEach(t=>by[t.symbol]=t);
      MARKETS.filter(m=>m.v==='binance').forEach(m=>{const t=by[m.f];if(!t)return;
        m.px=parseFloat(t.lastPrice);m.chg=parseFloat(t.priceChangePercent);m.vol=parseFloat(t.quoteVolume||0);
        m.hi=parseFloat(t.highPrice||0);m.lo=parseFloat(t.lowPrice||0);n++})}).catch(()=>{}),
    (async()=>{
      const ms=MARKETS.filter(m=>m.v==='gate');if(!ms.length)return;
      const q='?contract='+ms.map(m=>m.f).join(',');
      let rows=null;
      for(const u of ['https://api.gateio.ws/api/v4/futures/usdt/tickers'+q,'/api/gate/tickers'+q]){
        try{const r=await fetch(u);if(!r.ok)continue;const j=await r.json();
          if(Array.isArray(j)&&j.length){rows=j;break}}catch(e){}
      }
      if(!rows)return;
      const by={};rows.forEach(t=>by[t.contract]=t);
      ms.forEach(m=>{const t=by[m.f];if(!t)return;
        m.px=parseFloat(t.last);m.chg=parseFloat(t.change_percentage);
        m.vol=parseFloat(t.volume_24h_quote||0);
        m.hi=parseFloat(t.high_24h||0);m.lo=parseFloat(t.low_24h||0);n++});
    })().catch(()=>{}),
  ]);
  S.live=n>0;
  const fe=$('feed');if(fe)fe.textContent=n?n+' live':'Offline';
  const rd=$('rdot');if(rd)rd.className='rdot'+(n?'':' off');
  renderTape();
  if(S.page==='markets')renderMarkets();
  if(S.page==='trade'){S.series=series(S.mkt.id,S.mkt.px,S.tf);renderTrade()}
  if(S.page==='portfolio')renderPortfolio();
  if(S.page==='agents')S.agent?openAgent(S.agent.id):renderAgents();
  if(S.wlOpen)renderWatch();
}

/* ════════ wire ════════ */
document.querySelectorAll('.rbtn[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));
/* the mark is the way back to the top of the app, wherever you have got to */
$('homeBtn').onclick=()=>{
  if(S.agent)agentsBack();
  go('markets');scrollTo(0,0);
};
$('wlBtn').onclick=()=>setWL(!S.wlOpen);
$('catPills').innerHTML=SECTORS.map(s=>`<button data-c="${s[0]}" class="${s[0]===S.cat?'on':''}">${s[1]}</button>`).join('');
$('catPills').querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{
  S.cat=b.dataset.c;$('catPills').querySelectorAll('[data-c]').forEach(x=>x.classList.toggle('on',x.dataset.c===S.cat));
  renderMarkets()});
$('mktSearch').oninput=e=>{S.q=e.target.value;renderMarkets()};
$('pipeAll').onclick=e=>{e.preventDefault();go('preipo')};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('pickBtn').onclick=e=>{e.stopPropagation();
  $('pickMenu').classList.contains('on')?closePick():openPick($('pickBtn'))};
$('pickBtn2').onclick=e=>{e.stopPropagation();
  $('pickMenu').classList.contains('on')?closePick():openPick($('pickBtn2'))};
$('pickScrim').onclick=closePick;
$('pickQ').oninput=()=>{pickHi=0;renderPick()};
$('pickQ').onkeydown=pickKey;
$('sBuy').onclick=()=>setSide('buy');$('sSell').onclick=()=>setSide('sell');
$('amt').oninput=ticket;
$('rng').oninput=()=>{const mx=maxAmt();$('amt').value=mx>0?(mx*$('rng').value/100).toFixed(2):'';ticket()};
$('cta').onclick=()=>exec($('amt'));
$('scrim').onclick=closeTicket;
document.querySelectorAll('.utab').forEach(t=>t.onclick=()=>{
  S.tab=t.dataset.tab;document.querySelectorAll('.utab').forEach(x=>x.classList.toggle('on',x===t));renderPane()});
(function(){
  const hero=$('stdHero');if(!hero)return;
  hero.addEventListener('click',e=>{
    if(e.target.closest('.picker,.modeBtn,.tfs,.pickMenu'))return;
    setMode('adv');
  },true);
  hero.addEventListener('keydown',e=>{
    if(e.target!==hero)return;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();setMode('adv')}});
})();
$('chart').addEventListener('mousemove',e=>{
  const g=S.geo;if(!g)return;const r=e.target.getBoundingClientRect(),x=e.clientX-r.left;
  const i=Math.max(0,Math.min(S.series.length-1,Math.round((x-g.pad)/((g.w-g.pad*2)/(S.series.length-1)))));
  const v=S.series[i],c=$('cross');c.style.opacity=1;c.textContent=money(v,dp(v));
  c.style.left=Math.min(g.w-100,Math.max(0,g.X(i)-48))+'px';c.style.top=Math.max(0,g.Y(v)-42)+'px'});
$('chart').addEventListener('mouseleave',()=>$('cross').style.opacity=0);
$('avatar').onclick=()=>go('settings');
$('avatar').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go('settings')}};
$('themeBtn').onclick=()=>{const d=document.documentElement.getAttribute('data-theme')==='dark';
  document.documentElement.setAttribute('data-theme',d?'light':'dark');
  eachEmbed(api=>api.theme?.(shellTheme()));
  go(S.page);if(S.page==='trade'&&S.mode==='adv')loadTV()};
/* wallet connection — a real Solana wallet when marco-chain.js is present,
   otherwise a labelled simulation so the page still demonstrates the flow */
const DEMO_WALLET='0x71a3…4d02';
function renderWallet(){
  const b=$('walletBtn');if(!b)return;
  b.classList.toggle('on',!!S.wallet);
  b.dataset.tip=S.wallet?('Wallet '+S.wallet):'Connect wallet';
  b.setAttribute('aria-label',S.wallet?('Wallet connected, '+S.wallet):'Connect wallet');
  b.setAttribute('aria-pressed',String(!!S.wallet));
}
async function setWallet(on,{fromFrame=false}={}){
  if(!on){
    if(!S.wallet)return;
    const was=realWallet();
    await disconnectWallet();
    S.wallet=null;S.walletKind=null;
    restoreDemoBook();
    renderWallet();go(S.page);
    if(was&&!fromFrame)eachEmbed(api=>api.wallet?.(false));
    return toast('Wallet disconnected');
  }
  try{
    const w=await connectWallet();
    S.wallet=w.short;S.walletKind=w.kind;
    renderWallet();
    if(!fromFrame)eachEmbed(api=>api.wallet?.(true));
    loadChainBook().then(()=>go(S.page));
    // Naming the burner explicitly matters: a key in localStorage must never
    // be mistaken for the user's real wallet.
    toast(w.kind==='dev'
      ?`Dev wallet · ${w.short} — burner key, localnet only`
      :`Wallet connected · ${w.short}`);
  }catch(e){
    // A frame already holds the real wallet; it said so and this is the echo.
    if(fromFrame)return;
    // With the chain bundle present every market is real, so a failed or
    // declined connection leaves you disconnected — never on a stand-in.
    if(await chain())return toast(e.message||'Wallet connection failed');
    // Only with no bundle at all (opened off disk) is the labelled simulation
    // the honest behaviour: there is no chain for a wallet to talk to.
    S.wallet=DEMO_WALLET;S.walletKind='simulated';
    renderWallet();go(S.page);
    toast(`Simulated wallet · ${DEMO_WALLET} — ${e.message}`);
  }
}
$('walletBtn').onclick=()=>setWallet(!S.wallet);
renderWallet();
addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeTicket();closePick()}
  if(e.key==='/'&&S.page==='markets'&&document.activeElement!==$('mktSearch')){e.preventDefault();$('mktSearch').focus()}});
addEventListener('resize',()=>{
  if(EMBED_PAGES.includes(S.page))return;                        // the frame lays itself out
  if(S.page==='agents'&&S.agent)return openAgent(S.agent.id);   // canvases need a redraw
  go(S.page)});
addEventListener('hashchange',()=>{
  const seg=(location.hash||'#/markets').replace('#/','').split('/');
  const p=seg[0];
  if(!['markets','trade','portfolio','agents','settings',...EMBED_PAGES].includes(p))return;
  if(EMBED_PAGES.includes(p))return openEmbed(p,seg.slice(1).join('/'));
  if(p==='agents'&&seg[1]){if(!S.agent||S.agent.id!==seg[1])openAgent(seg[1]);return}
  if(p==='settings'&&seg[1]){if(S.page!=='settings'){S.setTab=seg[1];go('settings')}
    else setPanel(seg[1]);return}
  if(p==='agents'&&S.agent)return agentsBack();
  if(p!==S.page)go(p)});
setInterval(tickCountdowns,1000);
setInterval(rotateFeed,5000);
$('editBtn').onclick=()=>setEdit(!editMode);
$('ltClose').onclick=closeTemplates;
$('pickScrim').addEventListener('click',closeLayoutMenu);
addEventListener('keydown',e=>{if(e.key==='Escape')closeLayoutMenu()});
$('agNewBtn').onclick=()=>openBuilder();
$('agBClose').onclick=closeBuilder;
$('agOverlay').addEventListener('click',e=>{if(e.target===$('agOverlay'))closeBuilder()});
addEventListener('keydown',e=>{if(e.key==='Escape'&&$('agOverlay').classList.contains('on'))closeBuilder()});
$('ltOverlay').addEventListener('click',e=>{if(e.target===$('ltOverlay'))closeTemplates()});
addEventListener('keydown',e=>{if(e.key==='Escape'&&$('ltOverlay').classList.contains('on'))closeTemplates()});
setInterval(tickBook,2000);

