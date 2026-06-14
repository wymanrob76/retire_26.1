// app.js — AuraRetire — uses Firebase compat SDK (loaded via script tags)

// ── Firebase init ─────────────────────────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const auth     = firebase.auth();
const db       = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

// ── App state ─────────────────────────────────────────────────────────────────
const S = { user: null, assumptions: null, projection: null, mcResults: null, simResults: null, stressResults: null, simWorker: null, view: 'simulation', charts: {} };

// ── Auth ──────────────────────────────────────────────────────────────────────
auth.onAuthStateChanged(async user => {
  if (!user) { showAuth(); return; }

  // Restrict to allowed accounts if list is populated
  if (typeof ALLOWED_EMAILS !== 'undefined' && ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(user.email)) {
    await auth.signOut();
    showAuth('This app is private. Sign in with an authorized Google account.');
    return;
  }

  S.user = user;
  document.getElementById('user-initial').textContent = (user.displayName || user.email || 'R')[0].toUpperCase();
  try { S.assumptions = await loadAssumptions(); }
  catch { S.assumptions = deepClone(DEFAULTS); }
  recompute();
  showApp();
  navigate('simulation');
});

// Handle redirect result on page load
auth.getRedirectResult().catch(err => {
  if (err.code && err.code !== 'auth/no-auth-event') {
    document.getElementById('auth-msg').textContent = 'Sign-in failed. Try again.';
  }
});

document.getElementById('sign-in-btn').addEventListener('click', () => {
  document.getElementById('auth-msg').textContent = '';
  // Try popup first (works on most browsers when triggered by tap)
  // Falls back to redirect if popup is blocked
  auth.signInWithPopup(provider).catch(err => {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-cancelled') {
      auth.signInWithRedirect(provider);
    } else if (err.code && err.code !== 'auth/popup-closed-by-user') {
      document.getElementById('auth-msg').textContent = 'Sign-in failed (' + err.code + ')';
    }
  });
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  hideUserMenu();
  await auth.signOut();
});

// ── Firestore helpers ─────────────────────────────────────────────────────────
async function loadAssumptions() {
  if (!S.user) return deepClone(DEFAULTS);
  try {
    const snap = await db.collection('users').doc(S.user.uid).collection('data').doc('assumptions').get();
    if (snap.exists) return deepMerge(deepClone(DEFAULTS), snap.data());
  } catch (e) { console.warn('Firestore load failed:', e.message); }
  return deepClone(DEFAULTS);
}

async function saveAssumptions(assumptions) {
  if (!S.user) throw new Error('Not authenticated');
  await db.collection('users').doc(S.user.uid).collection('data').doc('assumptions').set(assumptions);
}

// ── User menu ─────────────────────────────────────────────────────────────────
document.getElementById('user-btn').addEventListener('click', toggleUserMenu);
document.addEventListener('click', e => {
  if (!e.target.closest('#user-menu') && !e.target.closest('#user-btn')) hideUserMenu();
});
function toggleUserMenu() {
  const m = document.getElementById('user-menu');
  if (m.hasAttribute('hidden')) {
    document.getElementById('menu-name').textContent  = S.user?.displayName || 'User';
    document.getElementById('menu-email').textContent = S.user?.email || '';
    m.removeAttribute('hidden');
  } else hideUserMenu();
}
function hideUserMenu() { document.getElementById('user-menu').setAttribute('hidden', ''); }

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => navigate(btn.dataset.view))
);
function navigate(view) {
  S.view = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  destroyCharts();
  const c = document.getElementById('view-container');
  c.scrollTop = 0;
  renderView(view, c);
}
function destroyCharts() {
  Object.values(S.charts).forEach(c => { try { c.destroy(); } catch {} });
  S.charts = {};
}

// ── Compute ───────────────────────────────────────────────────────────────────
function recompute() {
  S.projection = runProjection(S.assumptions);
  S.mcResults  = null;
}

// ── Formatting ────────────────────────────────────────────────────────────────
const fmt     = n => n >= 1e6 ? '$' + (n/1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + Math.round(n/1e3) + 'k' : '$' + Math.round(n).toLocaleString();
const fmtFull = n => '$' + Math.round(n).toLocaleString();

// ── Screen helpers ────────────────────────────────────────────────────────────
function showAuth(msg = '') {
  document.getElementById('auth-screen').removeAttribute('hidden');
  document.getElementById('app-screen').setAttribute('hidden', '');
  document.getElementById('auth-msg').textContent = msg;
}
function showApp() {
  document.getElementById('auth-screen').setAttribute('hidden', '');
  document.getElementById('app-screen').removeAttribute('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIEWS
// ═══════════════════════════════════════════════════════════════════════════════
function renderView(view, el) {
  switch (view) {
    case 'dashboard':  renderDashboard(el);  break;
    case 'projection': renderProjection(el); break;
    case 'simulation': renderSimulation(el); break;
    case 'timeline':   renderTimeline(el);   break;
    case 'settings':   renderSettings(el);   break;
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard(el) {
  const A         = S.assumptions;
  const proj      = S.projection;
  const dist      = getDistribution(proj);
  const accum     = getAccumulation(proj);
  const retPV     = getPortfolioAtRetirement(proj);
  const exAge     = getExhaustionAge(proj);
  const yrsLeft   = A.profile.retirementAge - A.profile.currentAge;
  const retRow    = accum.at(-1) || {};
  const ssAge     = A.socialSecurity.user.claimAge;
  const bridgeRow = dist.find(d => d.age === A.profile.retirementAge) || {};
  const ssMonthly = ssAge === 67 ? A.socialSecurity.user.benefitAt67 : A.socialSecurity.user.benefitAt70;

  // Runway segments
  const maxBal = Math.max(...dist.map(d => d.portfolioBalance), 1);
  const runway = dist.map(d => {
    const pct = d.portfolioBalance / maxBal;
    const cls = pct > 0.35 ? 'seg-ok' : pct > 0.10 ? 'seg-low' : 'seg-empty';
    return '<div class="runway-seg ' + cls + '" title="Age ' + d.age + ': ' + fmt(d.portfolioBalance) + '"></div>';
  }).join('');

  // Runway status (3-state)
  const minBal = dist.length ? Math.min(...dist.map(d => d.portfolioBalance)) : 0;
  let statusIcon, statusText, statusCls;
  if (exAge !== null) {
    statusIcon = '✕'; statusText = 'Not Funded'; statusCls = 'run-danger';
  } else if (retPV > 0 && minBal < retPV * 0.15) {
    statusIcon = '⚠'; statusText = 'Warning';    statusCls = 'run-warn';
  } else {
    statusIcon = '✓'; statusText = 'Funded';     statusCls = 'run-ok';
  }

  // Ring maths (simple 100x100 viewBox, r=40)
  const R          = 40;
  const circ       = +(2 * Math.PI * R).toFixed(2);
  const fraction   = Math.min(1, Math.max(0, (A.profile.currentAge - 22) / (A.profile.retirementAge - 22)));
  const offset     = +(circ * (1 - fraction)).toFixed(2);
  const retireYear = Math.round(new Date().getFullYear() + yrsLeft);
  const yrsDisplay = yrsLeft % 1 === 0 ? yrsLeft.toFixed(0) : yrsLeft.toFixed(1);

  el.innerHTML = '<div class="view-pad">' +

    // Combined card: ring + runway
    '<div class="card summary-card">' +

      '<div class="summary-top">' +
        // Small ring — no text inside, number lives in HTML
        '<svg viewBox="0 0 100 100" class="countdown-svg-sm">' +
          '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="rgba(91,108,249,0.14)" stroke-width="9"/>' +
          '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="#5B6CF9" stroke-width="9"' +
            ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '"' +
            ' stroke-linecap="butt" transform="rotate(-90 50 50)"/>' +
          '<circle cx="50" cy="' + (50 - R) + '" r="3.5" fill="#818CF8"' +
            ' transform="rotate(' + +(fraction * 360 - 90).toFixed(1) + ' 50 50)"/>' +
        '</svg>' +

        // Text block to the right
        '<div class="summary-info">' +
          '<div class="summary-yrs-row">' +
            '<span class="summary-yrs">' + yrsDisplay + '</span>' +
            '<span class="summary-yrs-lbl">YRS</span>' +
          '</div>' +
          '<div class="summary-retire-sub">to retirement</div>' +
          '<div class="summary-info-divider"></div>' +
          '<div class="summary-retire-age">Age ' + A.profile.retirementAge + '</div>' +
          '<div class="summary-retire-year">' + retireYear + '</div>' +
        '</div>' +
      '</div>' +

      // Rule between ring and runway
      '<div class="summary-rule"></div>' +

      // Runway
      '<div class="runway-header-row">' +
        '<span class="runway-section-lbl">Portfolio Runway</span>' +
        '<span class="run-status ' + statusCls + '">' + statusIcon + ' ' + statusText + '</span>' +
      '</div>' +
      '<div class="runway">' + runway + '</div>' +
      '<div class="runway-labels"><span>Age ' + A.profile.retirementAge + '</span><span>Age ' + A.profile.lifeExpectancy + '</span></div>' +

    '</div>' +

    // Projected at Retirement
    '<div class="card">' +
      '<div class="card-title">Projected at Retirement (Age ' + A.profile.retirementAge + ')</div>' +
      '<div class="stat-row">' +
        '<div class="stat"><span class="stat-val">' + fmt(retRow.k401Balance||0) + '</span><span class="stat-lbl">401(k)</span></div>' +
        '<div class="stat"><span class="stat-val">' + fmt(retRow.brokerageBalance||0) + '</span><span class="stat-lbl">Brokerage</span></div>' +
        '<div class="stat accent"><span class="stat-val">' + fmt(retPV) + '</span><span class="stat-lbl">Total</span></div>' +
      '</div>' +
    '</div>' +

    // Retirement Income
    '<div class="card">' +
      '<div class="card-title">Retirement Income</div>' +
      '<div class="income-list">' +
        '<div class="income-row"><span class="income-lbl">Bridge withdrawal (63–67)</span><span class="income-val">' + fmtFull(bridgeRow.withdrawal||0) + '/yr</span></div>' +
        '<div class="income-row"><span class="income-lbl">Your SS at age ' + ssAge + '</span><span class="income-val">' + fmtFull(ssMonthly*12) + '/yr</span></div>' +
        '<div class="income-row"><span class="income-lbl">Spouse SS at age ' + A.socialSecurity.spouse.claimAge + '</span><span class="income-val">' + fmtFull(A.socialSecurity.spouse.monthlyBenefit*12) + '/yr</span></div>' +
        '<div class="income-row"><span class="income-lbl">Spending target (Stodays $)</span><span class="income-val">' + fmtFull(A.retirement.targetAnnualSpendingToday) + '/yr</span></div>' +
      '</div>' +
    '</div>' +

    // MC teaser
    '<div class="card card-action" id="dash-mc-card">' +
      (S.mcResults
        ? '<div class="mc-big ' + mcColor(S.mcResults.successRate) + '">' + S.mcResults.successRate + '%</div><div class="mc-label">Monte Carlo success rate<br><span class="text-dim">' + S.mcResults.numSimulations.toLocaleString() + ' simulations</span></div>'
        : '<div class="mc-big mc-dim">—</div><div class="mc-label">Run Monte Carlo simulation<br><span class="text-dim">Tap Outlook to calculate</span></div>') +
    '</div>' +

  '</div>';

  document.getElementById('dash-mc-card').addEventListener('click', () => navigate('outlook'));
}


// ── PROJECTION ────────────────────────────────────────────────────────────────
function renderProjection(el) {
  const A     = S.assumptions;
  const proj  = S.projection;
  const accum = getAccumulation(proj);
  const dist  = getDistribution(proj);

  el.innerHTML = '<div class="view-pad">' +
    '<div class="card chart-card">' +
      '<div class="card-title-row">' +
        '<span class="card-title">Portfolio Growth</span>' +
        '<div class="toggle-group"><button class="toggle-btn active" id="tog-combined">Combined</button><button class="toggle-btn" id="tog-split">Split</button></div>' +
      '</div>' +
      '<canvas id="proj-chart" height="260"></canvas>' +
    '</div>' +

    '<div class="card chart-card">' +
      '<div class="card-title">Retirement: Spending vs Income</div>' +
      '<canvas id="dist-chart" height="220"></canvas>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-title-row">' +
        '<span class="card-title">SS Claim Age</span>' +
        '<div class="toggle-group">' +
          '<button class="toggle-btn ' + (A.socialSecurity.user.claimAge===67?'active':'') + '" id="ss-67">Age 67</button>' +
          '<button class="toggle-btn ' + (A.socialSecurity.user.claimAge===70?'active':'') + '" id="ss-70">Age 70</button>' +
        '</div>' +
      '</div>' +
      '<div class="ss-compare">' +
        '<div class="ss-col"><div class="ss-age">Age 67</div><div class="ss-amt">' + fmtFull(A.socialSecurity.user.benefitAt67*12) + '/yr</div></div>' +
        '<div class="ss-divider">vs</div>' +
        '<div class="ss-col"><div class="ss-age">Age 70</div><div class="ss-amt">' + fmtFull(A.socialSecurity.user.benefitAt70*12) + '/yr</div></div>' +
      '</div>' +
    '</div>' +
  '</div>';

  buildProjectionCharts(accum, dist, A);

  document.getElementById('ss-67').addEventListener('click', () => { S.assumptions.socialSecurity.user.claimAge = 67; recompute(); destroyCharts(); renderProjection(document.getElementById('view-container')); });
  document.getElementById('ss-70').addEventListener('click', () => { S.assumptions.socialSecurity.user.claimAge = 70; recompute(); destroyCharts(); renderProjection(document.getElementById('view-container')); });

  let split = false;
  document.getElementById('tog-combined').addEventListener('click', () => { if (split) { split=false; refreshProjChart(accum,dist,false); document.getElementById('tog-combined').classList.add('active'); document.getElementById('tog-split').classList.remove('active'); } });
  document.getElementById('tog-split').addEventListener('click', () => { if (!split) { split=true; refreshProjChart(accum,dist,true); document.getElementById('tog-split').classList.add('active'); document.getElementById('tog-combined').classList.remove('active'); } });
}

function buildProjectionCharts(accum, dist, A) {
  const allLabels = [...accum.map(r => ''+r.age), ...dist.map(r => ''+r.age)];
  const combined  = [...accum.map(r => r.totalPortfolio), ...dist.map(r => r.portfolioBalance)];
  const ltcs      = [...accum.map(() => null), ...dist.map(r => r.ltcBalance > 0 ? r.ltcBalance : null)];
  const retireIdx = allLabels.indexOf(''+A.profile.retirementAge);
  const annotations = {};
  if (retireIdx >= 0) annotations.retireLine = { type:'line', xMin:retireIdx, xMax:retireIdx, borderColor:'rgba(255,255,255,0.2)', borderWidth:1.5, borderDash:[4,3], label:{content:'Retire', display:true, position:'start', color:'#94A3B8', font:{size:10}} };

  S.charts.proj = new Chart(document.getElementById('proj-chart'), {
    type: 'line',
    data: { labels: allLabels, datasets: [
      { label:'Total Portfolio', data:combined, borderColor:'#818CF8', backgroundColor:'rgba(129,140,248,0.08)', borderWidth:2.5, pointRadius:0, fill:true, tension:0.35 },
      { label:'LTC Reserve',    data:ltcs,     borderColor:'#F59E0B', borderWidth:1.5, pointRadius:0, borderDash:[4,3] },
    ]},
    options: chartOpts(allLabels, annotations),
  });

  S.charts.dist = new Chart(document.getElementById('dist-chart'), {
    type: 'line',
    data: { labels: dist.map(r => ''+r.age), datasets: [
      { label:'Spending',   data:dist.map(r=>r.inflatedSpending), borderColor:'#94A3B8', borderWidth:1.5, pointRadius:0, borderDash:[3,3] },
      { label:'SS Income',  data:dist.map(r=>r.ssIncome),         borderColor:'#22C55E', borderWidth:2,   pointRadius:0 },
      { label:'Withdrawal', data:dist.map(r=>r.withdrawal),       borderColor:'#EF4444', borderWidth:2,   pointRadius:0 },
    ]},
    options: chartOpts(dist.map(r=>''+r.age), {}),
  });
}

function refreshProjChart(accum, dist, split) {
  const ch = S.charts.proj; if (!ch) return;
  const allLabels = [...accum.map(r=>''+r.age), ...dist.map(r=>''+r.age)];
  const ltcs = [...accum.map(()=>null), ...dist.map(r=>r.ltcBalance>0?r.ltcBalance:null)];
  if (split) {
    ch.data.datasets = [
      { label:'401(k)',    data:[...accum.map(r=>r.k401Balance),      ...dist.map(()=>null)], borderColor:'#818CF8', borderWidth:2, pointRadius:0 },
      { label:'Brokerage', data:[...accum.map(r=>r.brokerageBalance), ...dist.map(()=>null)], borderColor:'#22D3EE', borderWidth:2, pointRadius:0 },
      { label:'LTC Reserve', data:ltcs, borderColor:'#F59E0B', borderWidth:1.5, pointRadius:0, borderDash:[4,3] },
    ];
  } else {
    ch.data.datasets = [
      { label:'Total Portfolio', data:[...accum.map(r=>r.totalPortfolio), ...dist.map(r=>r.portfolioBalance)], borderColor:'#818CF8', backgroundColor:'rgba(129,140,248,0.08)', borderWidth:2.5, pointRadius:0, fill:true, tension:0.35 },
      { label:'LTC Reserve', data:ltcs, borderColor:'#F59E0B', borderWidth:1.5, pointRadius:0, borderDash:[4,3] },
    ];
  }
  ch.update('none');
}

function chartOpts(labels, annotations) {
  return {
    responsive:true, animation:false,
    plugins: {
      legend:{ display:true, position:'bottom', labels:{color:'#94A3B8', boxWidth:12, font:{size:11}} },
      annotation:{ annotations },
      tooltip:{ callbacks:{ label: ctx => ' ' + ctx.dataset.label + ': ' + (ctx.parsed.y >= 1000 ? fmt(ctx.parsed.y) : ctx.parsed.y + '%') } }
    },
    scales: {
      x:{ ticks:{color:'#64748B', maxTicksLimit:8, font:{size:10}}, grid:{color:'rgba(255,255,255,0.04)'} },
      y:{ ticks:{color:'#64748B', callback: v => fmt(v), font:{size:10}}, grid:{color:'rgba(255,255,255,0.05)'} }
    }
  };
}


// ── TIMELINE ──────────────────────────────────────────────────────────────────
function renderTimeline(el) {
  const A = S.assumptions;
  const events = [
    { age: A.profile.currentAge, type:'now', icon:'◉', label:'Today', detail:'Age ' + A.profile.currentAge + ' · Salary ' + fmtFull(A.income.currentSalary) + '/yr' },
    { age: A.brokerage.scheduledChanges[0]?.ageAtEvent || 50.83, type:'invest', icon:'⬆', label:'Brokerage boost', detail:'$' + ((A.brokerage.scheduledChanges[0]?.lumpSum||50000)/1000) + 'k lump sum + ' + fmtFull(A.brokerage.scheduledChanges[0]?.newMonthlyContribution||1500) + '/mo' },
    ...A.income.additionalRaises.map(r => ({ age:r.atAge, type:'raise', icon:'↑', label:'+' + r.percent + '% raise', detail:'Applied at age ' + r.atAge })),
    { age: A.k401.contributionIncreaseAtAge, type:'invest', icon:'⬆', label:'401(k) → 10%', detail:'Contribution increases from 8% to 10% of salary' },
    { age: A.profile.retirementAge, type:'retire', icon:'★', label:'Retirement', detail:'Portfolio target: ' + fmt(getPortfolioAtRetirement(S.projection)) },
    { age: A.housing.homeSaleAge, type:'house', icon:'⌂', label:'Home sale', detail:'Net: ' + fmt(A.housing.futureSaleValue - A.housing.downsizePurchasePrice) + ' → $' + (A.housing.ltcReserve/1000) + 'k LTC + $' + (A.housing.liquidityReserve/1000) + 'k liquidity' },
    { age: A.socialSecurity.user.claimAge, type:'ss', icon:'$', label:'Your SS begins', detail:fmtFull((A.socialSecurity.user.claimAge===67?A.socialSecurity.user.benefitAt67:A.socialSecurity.user.benefitAt70)*12) + '/yr at age ' + A.socialSecurity.user.claimAge },
    { age: A.profile.lifeExpectancy, type:'target', icon:'⊙', label:'Life expectancy target', detail:'Age ' + A.profile.lifeExpectancy + ' — model endpoint' },
  ].sort((a, b) => a.age - b.age);

  el.innerHTML = '<div class="view-pad"><div class="timeline">' +
    events.map(e =>
      '<div class="tl-item tl-' + e.type + '">' +
        '<div class="tl-icon">' + e.icon + '</div>' +
        '<div class="tl-body">' +
          '<div class="tl-age">Age ' + (e.age % 1 ? e.age.toFixed(1) : e.age) + '</div>' +
          '<div class="tl-label">' + e.label + '</div>' +
          '<div class="tl-detail">' + e.detail + '</div>' +
        '</div>' +
      '</div>'
    ).join('') +
  '</div></div>';
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function renderSettings(el) {
  const A = S.assumptions;
  const fld = (path, label, value, step) =>
    '<div class="field-row"><label class="field-label">' + label + '</label>' +
    '<input class="setting-input" type="number" value="' + value + '" step="' + (step||1) + '" data-path="' + path + '"></div>';

  el.innerHTML = '<div class="view-pad">' +
    section('Profile', true,
      fld('profile.currentAge','Current age',A.profile.currentAge,0.5) +
      fld('profile.retirementAge','Retirement age',A.profile.retirementAge) +
      fld('profile.lifeExpectancy','Life expectancy',A.profile.lifeExpectancy) +
      fld('profile.spouseCurrentAge','Spouse current age',A.profile.spouseCurrentAge) +
      fld('profile.inflationRate','Inflation rate (%)',A.profile.inflationRate,0.1) +
      fld('profile.ssColaRate','SS COLA (%)',A.profile.ssColaRate,0.1)
    ) +
    section('Social Security', false,
      fld('socialSecurity.user.benefitAt67','Your benefit at 67 ($/mo)',A.socialSecurity.user.benefitAt67) +
      fld('socialSecurity.user.benefitAt70','Your benefit at 70 ($/mo)',A.socialSecurity.user.benefitAt70) +
      fld('socialSecurity.user.claimAge','Your claim age (67 or 70)',A.socialSecurity.user.claimAge) +
      fld('socialSecurity.spouse.monthlyBenefit','Spouse benefit ($/mo)',A.socialSecurity.spouse.monthlyBenefit) +
      fld('socialSecurity.spouse.claimAge','Spouse claim age',A.socialSecurity.spouse.claimAge)
    ) +
    section('Employment', false,
      fld('income.currentSalary','Current salary ($)',A.income.currentSalary,100) +
      fld('income.annualRaisePercent','Annual raise (%)',A.income.annualRaisePercent,0.1) +
      '<div class="field-note">Age-gated raises: ' + A.income.additionalRaises.map(r=>'+'+r.percent+'% at age '+r.atAge).join(', ') + '</div>'
    ) +
    section('401(k)', false,
      fld('k401.currentBalance','Current balance ($)',A.k401.currentBalance,100) +
      fld('k401.contributionPercent','Contribution rate (%)',A.k401.contributionPercent,0.5) +
      fld('k401.contributionIncreaseAtAge','Increase to higher rate at age',A.k401.contributionIncreaseAtAge) +
      fld('k401.contributionPercentAfterIncrease','Rate after increase (%)',A.k401.contributionPercentAfterIncrease,0.5) +
      fld('k401.returnPhases.0.annualReturnPercent','Return age 49–55 (%)',A.k401.returnPhases[0].annualReturnPercent,0.1) +
      fld('k401.returnPhases.1.annualReturnPercent','Return age 55+ (%)',A.k401.returnPhases[1].annualReturnPercent,0.1)
    ) +
    section('Brokerage', false,
      fld('brokerage.currentBalance','Current balance ($)',A.brokerage.currentBalance,100) +
      fld('brokerage.monthlyContribution','Monthly contribution ($/mo)',A.brokerage.monthlyContribution,50) +
      fld('brokerage.scheduledChanges.0.lumpSum','Oct 2027 lump sum ($)',A.brokerage.scheduledChanges[0]?.lumpSum||50000,1000) +
      fld('brokerage.scheduledChanges.0.newMonthlyContribution','Oct 2027 new monthly ($)',A.brokerage.scheduledChanges[0]?.newMonthlyContribution||1500,50) +
      fld('brokerage.returnPhases.0.annualReturnPercent','Return age 49–58 (%)',A.brokerage.returnPhases[0].annualReturnPercent,0.1) +
      fld('brokerage.returnPhases.1.annualReturnPercent','Return age 58+ (%)',A.brokerage.returnPhases[1].annualReturnPercent,0.1)
    ) +
    section('Housing', false,
      fld('housing.homeSaleAge','Expected sale age',A.housing.homeSaleAge) +
      fld('housing.futureSaleValue','Expected sale price ($)',A.housing.futureSaleValue,1000) +
      fld('housing.downsizePurchasePrice','Downsize purchase ($)',A.housing.downsizePurchasePrice,1000) +
      fld('housing.ltcReserve','LTC reserve from proceeds ($)',A.housing.ltcReserve,1000) +
      fld('housing.liquidityReserve','Liquidity reserve ($)',A.housing.liquidityReserve,1000) +
      fld('housing.ltcAnnualReturnPercent','LTC return (%)',A.housing.ltcAnnualReturnPercent,0.1)
    ) +
    section('Retirement', false,
      fld('retirement.targetAnnualSpendingToday','Spending target today\'s $ ($/yr)',A.retirement.targetAnnualSpendingToday,500) +
      fld('retirement.portfolioReturnPercent','Portfolio return in retirement (%)',A.retirement.portfolioReturnPercent,0.1) +
      fld('retirement.targetWithdrawalRatePercent','Target withdrawal rate (%)',A.retirement.targetWithdrawalRatePercent,0.05)
    ) +
    '<div class="settings-footer">' +
      '<button class="btn-primary" id="save-btn">Save assumptions</button>' +
      '<div id="save-status"></div>' +
    '</div>' +
  '</div>';

  el.querySelectorAll('.setting-input').forEach(input => {
    input.addEventListener('change', () => {
      setNestedValue(S.assumptions, input.dataset.path, parseFloat(input.value));
      recompute();
      document.getElementById('save-status').textContent = '⬤ Unsaved changes';
      document.getElementById('save-status').className = 'save-unsaved';
    });
  });

  document.getElementById('save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-btn');
    const status = document.getElementById('save-status');
    btn.disabled = true; status.textContent = 'Saving…';
    try {
      await saveAssumptions(S.assumptions);
      status.textContent = '✓ Saved'; status.className = 'save-ok';
    } catch (e) {
      status.textContent = '✗ Save failed'; status.className = 'save-err';
    } finally { btn.disabled = false; }
  });
}

function section(title, open, content) {
  return '<details class="setting-group"' + (open?' open':'') + '><summary>' + title + '</summary>' + content + '</details>';
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    cur = isNaN(k) ? cur[k] : cur[+k];
  }
  const last = parts.at(-1);
  if (isNaN(last)) cur[last] = value; else cur[+last] = value;
}

function mcColor(r) { return r >= 85 ? 'mc-success' : r >= 70 ? 'mc-warn' : 'mc-danger'; }


// ── Map AuraRetire assumptions → RetirementSim params ────────────────────────
function assumptionsToSimParams(A) {
  var p = RetirementSim.defaultParams();
  var ch = A.brokerage.scheduledChanges[0] || {};

  // Profile
  p.cur    = A.profile.currentAge;
  p.retAge = A.profile.retirementAge;
  p.endAge = A.profile.lifeExpectancy;
  p.infl   = A.profile.inflationRate / 100;
  p.ivol   = A.monteCarlo.inflationStdDevPercent / 100;

  // 401(k) / income
  p.k401  = A.k401.currentBalance;
  p.sal   = A.income.currentSalary;
  p.p1    = A.k401.contributionPercent / 100;
  p.p2    = A.k401.contributionPercentAfterIncrease / 100;
  // Effective match = cap% × match% (e.g. 6% × 50% = 3%)
  p.match = (A.k401.employerMatchCapPercent / 100) * (A.k401.employerMatchPercent / 100);

  // Brokerage
  p.brokInit    = A.brokerage.monthlyContribution;
  p.brok        = ch.newMonthlyContribution || 1500;
  p.brokStepAge = Math.round(ch.ageAtEvent  || 51);
  p.lump        = ch.lumpSum                || 50000;
  p.lumpAge     = Math.round(ch.ageAtEvent  || 51);

  // Returns & vol
  p.rpre = A.k401.returnPhases[0].annualReturnPercent / 100;
  p.rpost = A.k401.returnPhases[1].annualReturnPercent / 100;
  p.vol   = A.monteCarlo.accumulationReturnStdDevPercent / 100;

  // Spending (Go-Go / Slow-Go / No-Go)
  p.spend1 = A.retirement.targetAnnualSpendingToday;
  p.spend2 = Math.round(p.spend1 * 0.786);  // ~$55k at $70k base
  p.spend3 = Math.round(p.spend1 * 0.643);  // ~$45k at $70k base

  // Social Security
  p.ssBase      = A.socialSecurity.user.benefitAt67 * 12;
  p.ss70        = A.socialSecurity.user.benefitAt70 * 12;
  p.ssAge       = A.socialSecurity.user.claimAge;
  p.ss          = p.ssAge === 67 ? p.ssBase : p.ss70;
  p.spouseSS    = A.socialSecurity.spouse.monthlyBenefit * 12;
  p.spouseSSAge = A.socialSecurity.spouse.claimAge;

  // Housing (right-size event at 65 in simulator)
  p.home = A.housing.futureSaleValue;
  p.down = A.housing.downsizePurchasePrice;

  return p;
}

// ── SIMULATION VIEW (RetirementSim) ──────────────────────────────────────────
function renderSimulation(el) {
  var A = S.assumptions;

  // Show loading state immediately
  el.innerHTML =
    '<div class="view-pad">' +
      '<div class="card sim-loading">' +
        '<div class="sim-spinner"></div>' +
        '<div class="sim-loading-text">Running forecast…</div>' +
        '<div class="sim-loading-sub">Monte Carlo + stress tests via Web Worker</div>' +
      '</div>' +
    '</div>';

  // Terminate any previous worker
  if (S.simWorker) { try { S.simWorker.terminate(); } catch(e){} }

  var params = assumptionsToSimParams(A);
  var worker = new Worker('./worker.js');
  S.simWorker = worker;
  var mc = null;

  worker.onmessage = function(e) {
    var task   = e.data.task;
    var result = e.data.result;

    if (result && result.error) {
      el.innerHTML = '<div class="view-pad"><div class="card"><p style="color:var(--danger)">Error: ' + result.error + '</p></div></div>';
      worker.terminate(); return;
    }

    if (task === 'monteCarlo') {
      mc = result;
      S.simResults = result;
      renderSimResults(el, A, mc, null);
      // Chain: now run stress tests
      worker.postMessage({ task: 'stress', params: params, N: 2000 });

    } else if (task === 'stress') {
      S.stressResults = result;
      renderSimResults(el, A, mc, result);
      worker.terminate();
      S.simWorker = null;
    }
  };

  worker.onerror = function(e) {
    el.innerHTML = '<div class="view-pad"><div class="card"><p style="color:var(--danger)">Worker error: ' + e.message + '</p></div></div>';
  };

  worker.postMessage({ task: 'monteCarlo', params: params, N: 5000 });
}

function renderSimResults(el, A, mc, stress) {
  var sr       = mc.successRate;
  var srCls    = sr >= 85 ? 'mc-success' : sr >= 70 ? 'mc-warn' : 'mc-danger';
  var retireY  = Math.round(new Date().getFullYear() + (A.profile.retirementAge - A.profile.currentAge));

  // Stress table rows
  var stressRows = '';
  if (stress) {
    stress.scenarios.forEach(function(s) {
      var rate  = s.result.successRate;
      var delta = s.result.deltaVsBaseline;
      var cls   = rate >= 85 ? 'sr-good' : rate >= 70 ? 'sr-ok' : 'sr-bad';
      var dStr  = s.id === 'baseline' ? '—'
                : (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'pts';
      stressRows +=
        '<tr>' +
          '<td>' + s.label + '</td>' +
          '<td class="' + cls + '">' + rate.toFixed(1) + '%</td>' +
          '<td style="color:' + (delta < 0 ? 'var(--danger)' : 'var(--text-dim)') + '">' + dStr + '</td>' +
        '</tr>';
    });
  }

  // HC sensitivity rows
  var hcRows = '';
  mc.hcSensitivity.forEach(function(h) {
    var cls = h.successRate >= 85 ? 'sr-good' : h.successRate >= 70 ? 'sr-ok' : 'sr-bad';
    hcRows += '<tr><td>' + h.label + '</td><td class="' + cls + '">' + h.successRate.toFixed(1) + '%</td></tr>';
  });

  // Fail distribution
  var fd = mc.failAgeDistribution;
  var totalFails = mc.failCount || 1;

  el.innerHTML =
    '<div class="view-pad">' +

    // ── Hero ──
    '<div class="card sim-hero">' +
      '<div class="sim-sr ' + srCls + '">' + sr.toFixed(1) + '%</div>' +
      '<div class="sim-sr-label">success rate · ' + mc.simulations.toLocaleString() + ' simulations</div>' +
      (stress
        ? '<div class="sim-fortress" style="color:' + stress.fortressScore.color + '">' + stress.fortressScore.label + '</div>'
        : '<div class="sim-fortress" style="color:var(--text-mute)">Running stress tests…</div>') +
      '<button class="btn-primary" id="rerun-sim-btn" style="margin-top:14px">Re-run Forecast</button>' +
    '</div>' +

    // ── Key metrics ──
    '<div class="card">' +
      '<div class="card-title">Key Metrics</div>' +
      '<div class="income-list">' +
        '<div class="income-row"><span class="income-lbl">Median portfolio at SS age (' + A.socialSecurity.user.claimAge + ')</span><span class="income-val">' + fmt(mc.medianAtSSAge) + '</span></div>' +
        '<div class="income-row"><span class="income-lbl">Median portfolio at 80</span><span class="income-val">' + fmt(mc.medianAt80 || 0) + '</span></div>' +
        '<div class="income-row"><span class="income-lbl">Median portfolio at 90</span><span class="income-val">' + fmt(mc.medianAt90 || 0) + '</span></div>' +
        '<div class="income-row"><span class="income-lbl">Cash sleeve success rate</span><span class="income-val">' + mc.sleeveSuccessRate.toFixed(1) + '%</span></div>' +
        '<div class="income-row"><span class="income-lbl">No-sleeve success rate</span><span class="income-val">' + mc.noSleeveSuccessRate.toFixed(1) + '%</span></div>' +
        '<div class="income-row"><span class="income-lbl">Sleeve lift</span><span class="income-val ' + (mc.sleeveLiftPoints > 0 ? 'text-success' : '') + '">+' + mc.sleeveLiftPoints.toFixed(1) + ' pts</span></div>' +
      '</div>' +
    '</div>' +

    // ── Percentile fan chart ──
    '<div class="card chart-card">' +
      '<div class="card-title">Portfolio Percentile Fan</div>' +
      '<canvas id="fan-chart" height="240"></canvas>' +
      '<div class="fan-legend">' +
        '<span class="fan-key" style="background:#818CF8">p90</span>' +
        '<span class="fan-key" style="background:#5B6CF9">p50</span>' +
        '<span class="fan-key" style="background:#F59E0B">p25</span>' +
        '<span class="fan-key" style="background:#EF4444">p10</span>' +
      '</div>' +
    '</div>' +

    // ── Fail age distribution ──
    '<div class="card">' +
      '<div class="card-title">Failure Age Distribution (' + mc.failCount + ' failures)</div>' +
      '<div class="income-list">' +
        '<div class="income-row"><span class="income-lbl">Before age 70</span><span class="income-val text-danger">' + fd.before70 + '</span></div>' +
        '<div class="income-row"><span class="income-lbl">Ages 71–80</span><span class="income-val text-warn">' + (fd['71to80'] || fd['71to80'] || 0) + '</span></div>' +
        '<div class="income-row"><span class="income-lbl">Ages 81–90</span><span class="income-val text-dim">' + (fd['81to90'] || 0) + '</span></div>' +
        '<div class="income-row"><span class="income-lbl">After 90</span><span class="income-val text-success">' + (fd.after90 || 0) + '</span></div>' +
      '</div>' +
    '</div>' +

    // ── Healthcare sensitivity ──
    '<div class="card">' +
      '<div class="card-title">Healthcare Cost Sensitivity</div>' +
      '<table class="sim-table">' +
        '<thead><tr><th>Monthly Premium</th><th>Success Rate</th></tr></thead>' +
        '<tbody>' + hcRows + '</tbody>' +
      '</table>' +
    '</div>' +

    // ── Stress tests ──
    (stress
      ? '<div class="card">' +
          '<div class="card-title">Stress Tests</div>' +
          '<table class="sim-table">' +
            '<thead><tr><th>Scenario</th><th>Rate</th><th>Δ</th></tr></thead>' +
            '<tbody>' + stressRows + '</tbody>' +
          '</table>' +
        '</div>'
      : '<div class="card sim-loading-mini"><div class="sim-spinner-sm"></div> <span class="text-dim">Running stress tests…</span></div>') +

    '</div>';

  // Re-run button
  var rerunBtn = document.getElementById('rerun-sim-btn');
  if (rerunBtn) rerunBtn.addEventListener('click', function() { renderSimulation(document.getElementById('view-container')); });

  // Fan chart
  buildFanChart(mc);
}

function buildFanChart(mc) {
  var canvas = document.getElementById('fan-chart');
  if (!canvas) return;
  destroyCharts();

  // Only label every 5 years for readability
  var labels = mc.ages.map(function(a) { return a % 5 === 0 ? String(a) : ''; });

  S.charts.fan = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label:'p90', data:mc.p90, borderColor:'rgba(129,140,248,0.5)', borderWidth:1, pointRadius:0 },
        { label:'p75', data:mc.p75, borderColor:'rgba(129,140,248,0.7)', borderWidth:1, pointRadius:0 },
        { label:'p50', data:mc.p50, borderColor:'#5B6CF9',               borderWidth:2.5, pointRadius:0 },
        { label:'p25', data:mc.p25, borderColor:'rgba(245,158,11,0.7)',  borderWidth:1, pointRadius:0 },
        { label:'p10', data:mc.p10, borderColor:'rgba(239,68,68,0.6)',   borderWidth:1, pointRadius:0 },
      ]
    },
    options: {
      responsive:true, animation:false,
      plugins: {
        legend:{ display:false },
        tooltip:{
          callbacks:{
            title: function(items) { return 'Age ' + mc.ages[items[0].dataIndex]; },
            label: function(ctx) { return ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y); }
          }
        }
      },
      scales:{
        x:{ ticks:{ color:'#64748B', font:{size:10}, maxRotation:0 }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y:{ ticks:{ color:'#64748B', callback: function(v){ return fmt(v); }, font:{size:10} }, grid:{ color:'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e));
}