
/* ════════ settings ════════
   Account, verification and preferences. The preference toggles are real and
   persist; the verification flow is scaffolding for a provider that is not
   connected yet, and says so rather than showing a status nobody has earned. */

const PREF_DEFAULTS={confirmOrders:true,priceAlerts:true,vaultAlerts:true,
  agentAlerts:false,statements:true,marketing:false};
function loadPrefs(){
  if(S.prefs)return S.prefs;
  let raw=null;
  try{raw=JSON.parse(localStorage.getItem('marco.prefs')||'null')}catch(e){}
  S.prefs=Object.assign({},PREF_DEFAULTS,raw&&typeof raw==='object'?raw:{});
  return S.prefs;
}
function savePrefs(){try{localStorage.setItem('marco.prefs',JSON.stringify(S.prefs))}catch(e){}}

/* KYC is not wired to a provider yet, so every account sits at the base tier.
   The ladder is shown in full because the limits are what a user needs to plan
   around, but nothing here claims a check has run. */
const KYC_TIERS=[
  {id:'t0',n:'Account',d:'Email and a connected wallet.',
   caps:['Browse markets and vaults','No deposits or trading'],state:'done'},
  {id:'t1',n:'Tier 1 · Identity',d:'Government photo ID and a liveness check.',
   caps:['Deposit and trade up to $50,000 a year','Subscribe to pre-IPO vaults'],state:'next'},
  {id:'t2',n:'Tier 2 · Address and source of funds',
   d:'Proof of address and evidence of where the funds come from.',
   caps:['Raises the annual limit to $500,000'],state:'locked'},
  {id:'t3',n:'Tier 3 · Enhanced due diligence',
   d:'Institutional review, including beneficial ownership.',
   caps:['No preset limit','Corporate and fund accounts'],state:'locked'},
];
const KYC_ONGOING=[
  ['Sanctions and PEP screening','Checked at onboarding and re-screened daily against updated lists.'],
  ['Transaction monitoring','Deposits, withdrawals and vault subscriptions are monitored for unusual patterns.'],
  ['Travel rule','Originator and beneficiary details are exchanged with counterparty institutions above the threshold.'],
  ['Record keeping','Identity records and transaction history are retained for the statutory period.'],
];

const sRow=(k,v,sub)=>`<div class="setRow"><div class="setK">${k}${
  sub?`<span class="setSub">${sub}</span>`:''}</div><div class="setV">${v}</div></div>`;
const sToggle=(id,k,sub)=>`<div class="setRow"><div class="setK">${k}${
  sub?`<span class="setSub">${sub}</span>`:''}</div>
  <button class="tgl${loadPrefs()[id]?' on':''}" role="switch" data-pref="${id}"
    aria-checked="${!!loadPrefs()[id]}" aria-label="${esc(k)}"><i></i></button></div>`;

const SET_TABS=[['account','Account'],['verify','Verification'],['trading','Trading'],
  ['alerts','Notifications'],['appearance','Appearance'],['security','Security'],['data','Data']];

function setPanel(key){
  document.querySelectorAll('#p-settings .vsec').forEach(x=>x.classList.toggle('on',x.id==='set-'+key));
  document.querySelectorAll('#setNav button').forEach(b=>b.classList.toggle('on',b.dataset.st===key));
  S.setTab=key;
  const h=location.hash.split('/');
  const want='#/settings/'+key;
  if(location.hash!==want)history.replaceState(null,'',want);
}

function renderSettings(){
  const box=$('settingsBody');if(!box)return;
  loadPrefs();
  const wallet=S.wallet?esc(S.wallet):'Not connected';
  box.innerHTML=`
    <div class="setHead">
      <div class="setAv">TT</div>
      <div>
        <h1 class="h1" style="font-size:30px">Tony Tran</h1>
        <div class="mini">tony@marcostocks.com · Member since January 2026</div>
      </div>
    </div>
    <div class="vnav" id="setNav">${SET_TABS.map(t=>
      `<button data-st="${t[0]}">${esc(t[1])}</button>`).join('')}</div>

    <section class="vsec" id="set-account"><div class="bento">
      <div class="card setCard span6">
        <div class="setCardH">Profile</div>
        ${sRow('Display name','Tony Tran')}
        ${sRow('Email','tony@marcostocks.com')}
        ${sRow('Region','Abu Dhabi, UAE')}
        ${sRow('Member since','January 2026')}
      </div>
      <div class="card setCard span6">
        <div class="setCardH">Funding</div>
        ${sRow('Wallet',`<span class="num">${wallet}</span>`,'Deposits, settlement and redemption')}
        ${sRow('Base currency','USDC','All balances and marks are quoted in USDC')}
        ${sRow('Networks','Solana · Ethereum · Base')}
        ${sRow('Cash balance',`<span class="num">${money(S.cash)}</span>`)}
      </div>
    </div></section>

    <section class="vsec" id="set-verify"><div class="bento">
      <div class="card setCard kycCard span8">
        <div class="kycTop">
          <div>
            <div class="setK" style="margin:0">Verification status</div>
            <div class="kycState">Not started</div>
          </div>
          <button class="btn p" id="kycStart">Start verification</button>
        </div>
        <div class="kycNote">Checks are not running in this preview — the compliance
          provider is not connected yet.</div>
        <div class="kycList">${KYC_TIERS.map(t=>`<div class="kycT ${t.state}">
          <span class="kycDot"></span>
          <div class="kycTBody">
            <div class="kycTN">${esc(t.n)}
              <span class="kycTag ${t.state}">${
                t.state==='done'?'Complete':t.state==='next'?'Required next':'Locked'}</span></div>
            <div class="kycTD">${esc(t.d)}</div>
            <ul class="kycCaps">${t.caps.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>
          </div></div>`).join('')}</div>
      </div>
      <div class="card setCard span4">
        <div class="setCardH">Ongoing obligations</div>
        ${KYC_ONGOING.map(x=>sRow(esc(x[0]),'<span class="setPend">Planned</span>',esc(x[1]))).join('')}
      </div>
    </div></section>

    <section class="vsec" id="set-trading"><div class="bento">
      <div class="card setCard span6">
        <div class="setCardH">Order defaults</div>
        ${sToggle('confirmOrders','Confirm before submitting','Show a review step on every order')}
        ${sRow('Order size preset','25% of balance')}
      </div>
      <div class="card setCard span6">
        <div class="setCardH">Costs</div>
        ${sRow('Spread','0.15%','Applied to the mid price on every fill')}
        ${sRow('Protocol fee','0.25%','Spot trades')}
        ${sRow('Vault fee','5.00%','Skimmed from your redemption proceeds')}
      </div>
    </div></section>

    <section class="vsec" id="set-alerts"><div class="bento">
      <div class="card setCard span6">
        <div class="setCardH">Markets</div>
        ${sToggle('priceAlerts','Price alerts','Markets on your watchlist')}
        ${sToggle('vaultAlerts','Vault closings','When a subscription window is about to close')}
        ${sToggle('agentAlerts','Agent findings','A digest of what your research agents report')}
      </div>
      <div class="card setCard span6">
        <div class="setCardH">Email</div>
        ${sToggle('statements','Monthly statements','Emailed on the first business day')}
        ${sToggle('marketing','Product updates','Occasional news about new markets and features')}
      </div>
    </div></section>

    <section class="vsec" id="set-appearance"><div class="bento">
      <div class="card setCard span6">
        <div class="setCardH">Display</div>
        <div class="setRow"><div class="setK">Theme
          <span class="setSub">Applies across the app</span></div>
          <div class="segc" id="setTheme">
            <button data-th="dark">Dark</button><button data-th="light">Light</button></div></div>
        ${sRow('Number format','1,234.56','Comma grouping on every figure')}
      </div>
      <div class="card setCard span6">
        <div class="setCardH">Markets board</div>
        ${sRow('Layout',`<span class="num">${esc((LAYOUTS[S.layout]||{}).n||'Custom')}</span>`,
          'Change it from the Markets page')}
        ${sRow('Capsule editing','Drag and drop','Use Edit on the Markets page')}
      </div>
    </div></section>

    <section class="vsec" id="set-security"><div class="bento">
      <div class="card setCard span6">
        <div class="setCardH">Sign-in</div>
        ${sRow('Two-factor authentication','<span class="setPend">Planned</span>','An authenticator app or a hardware key')}
        ${sRow('Active sessions','1 device','This browser')}
      </div>
      <div class="card setCard span6">
        <div class="setCardH">Access</div>
        ${sRow('API keys','<span class="setPend">Planned</span>','Read-only keys for portfolio tooling')}
        ${sRow('Withdrawal address book','<span class="setPend">Planned</span>','Allow-list the addresses you can withdraw to')}
      </div>
    </div></section>

    <section class="vsec" id="set-data"><div class="bento">
      <div class="card setCard span6">
        <div class="setCardH">This device</div>
        <div class="setRow"><div class="setK">Reset local data
          <span class="setSub">Clears your saved layout, agents and preferences</span></div>
          <button class="btn" id="setReset">Reset</button></div>
      </div>
      <div class="card setCard span6">
        <div class="setCardH">Your records</div>
        ${sRow('Export account data','<span class="setPend">Planned</span>','Positions and transaction history')}
        ${sRow('Close account','<span class="setPend">Planned</span>','Redeem or withdraw everything first')}
      </div>
    </div></section>

    <div class="foot">Vault tokens are not equity. Marco Labs · Pre-IPO vaults · 2026<br>
      Verification, monitoring and reporting described here are planned controls, not live services.</div>`;

  $('setNav').querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>setPanel(b.dataset.st));
  setPanel(SET_TABS.some(t=>t[0]===S.setTab)?S.setTab:'account');

  box.querySelectorAll('[data-pref]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.pref;
    S.prefs[k]=!S.prefs[k];savePrefs();
    b.classList.toggle('on',S.prefs[k]);b.setAttribute('aria-checked',String(!!S.prefs[k]));
  });
  const th=$('setTheme');
  const dark=()=>document.documentElement.getAttribute('data-theme')!=='light';
  th.querySelectorAll('[data-th]').forEach(b=>b.classList.toggle('on',b.dataset.th===(dark()?'dark':'light')));
  th.querySelectorAll('[data-th]').forEach(b=>b.onclick=()=>{
    if((dark()?'dark':'light')===b.dataset.th)return;
    $('themeBtn').click();          // one code path for the theme, wherever it is flipped
  });
  $('kycStart').onclick=()=>toast('Verification opens once the compliance provider is connected');
  $('setReset').onclick=()=>{
    try{['marco.layout','marco.custom','marco.agents','marco.prefs','marco.railw']
      .forEach(k=>localStorage.removeItem(k))}catch(e){}
    S.prefs=null;S.agents=null;S.custom=null;S.layout=DEFAULT_LAYOUT;
    renderSettings();toast('Local data cleared');
  };
}
