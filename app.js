// app.js — AuraRetire main application module

import { initializeApp }                  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithRedirect, getRedirectResult,
         GoogleAuthProvider, signOut,
         onAuthStateChanged }             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore }                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG, ALLOWED_EMAILS } from './firebase-config.js';
import { DEFAULTS, initAssumptions,
         loadAssumptions, saveAssumptions } from './assumptions.js';
import { runProjection, accumulation,
         distribution, portfolioAtRetirement,
         exhaustionAge }                  from './projection.js';
import { runMonteCarlo }                  from './montecarlo.js';

// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const gProvider   = new GoogleAuthProvider();

// ── App State ─────────────────────────────────────────────────────────────────
const S = {
  user:        null,
  assumptions: null,
  projection:  null,
  mcResults:   null,
  view:        'dashboard',
  charts:      {},
  saving:      false,
};

// ── Auth ──────────────────────────────────────────────────────────────────────
// Handle the return trip from Google's sign-in redirect (fires on page load after redirect)
getRedirectResult(auth).catch(e => {
  if (e?.code && e.code !== 'auth/no-auth-event') {
    console.warn('[AuraRetire] Redirect error:', e.code);
    const msg = document.getElementById('auth-msg');
    if (msg) msg.textContent = 'Sign-in failed. Try again.';
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { showAuth(); return; }

  if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(user.email)) {
    await signOut(auth);
    showAuth('Access restricted. Sign in with your authorized Google account.');
    return;
  }

  S.user = user;
  initAssumptions(db, user.uid);
  document.getElementById('user-initial').textContent =
    (user.displayName || user.email || 'R')[0].toUpperCase();

  try {
    S.assumptions = await loadAssumptions();
  } catch {
    S.assumptions = structuredClone(DEFAULTS);
  }
  recompute();
  showApp();
  navigate('dashboard');
});

document.getElementById('sign-in-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sign-in-btn');
  const msg = document.getElementById('auth-msg');
  btn.textContent = 'Redirecting to Google…';
  btn.disabled = true;
  msg.textContent = '';
  try {
    await signInWithRedirect(auth, gProvider);
  } catch (e) {
    btn.textContent = 'Sign in with Google';
    btn.disabled = false;
    msg.textContent = 'Sign-in failed. Try again.';
  }
});

document.getElementById('sign-out-btn').addEventListener('click', async () => {
  hideUserMenu();
  await signOut(auth);
});

// ── User menu toggle ──────────────────────────────────────────────────────────
document.getElementById('user-btn').addEventListener('click', toggleUserMenu);
document.addEventListener('click', e => {
  if (!e.target.closest('#user-menu') && !e.target.closest('#user-btn')) hideUserMenu();
});

function toggleUserMenu() {
  const m = document.getElementById('user-menu');
  const hidden = m.hasAttribute('hidden');
  if (hidden) {
    document.getElementById('menu-name').textContent  = S.user?.displayName || 'User';
    document.getElementById('menu-email').textContent = S.user?.email       || '';
    m.removeAttribute('hidden');
  } else {
    hideUserMenu();
  }
}
function hideUserMenu() { document.getElementById('user-menu').setAttribute('hidden', ''); }

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => navigate(btn.dataset.view))
);

function navigate(view) {
  S.view = view;
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  destroyCharts();
  const container = document.getElementById('view-container');
  container.scrollTop = 0;
  renderView(view, container);
}

function destroyCharts() {
  Object.values(S.charts).forEach(c => { try { c.destroy(); } catch {} });
  S.charts = {};
}

// ── Compute ───────────────────────────────────────────────────────────────────
function recompute() {
  S.projection = runProjection(S.assumptions);
  S.mcResults  = null;   // invalidate; rerun lazily
}

// ── Formatting helpers ────────────────────────────────────────────────────────
const fmt  = n => n >= 1e6 ? `$${(n/1e6).toFixed(2)}M`
                : n >= 1e3 ? `$${Math.round(n/1e3)}k`
                : `$${Math.round(n).toLocaleString()}`;
const fmtFull = n => '$' + Math.round(n).toLocaleString();
const pct     = n => `${Math.round(n)}%`;

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
    case 'dashboard':  renderDashboard(el);   break;
    case 'projection': renderProjection(el);  break;
    case 'outlook':    renderOutlook(el);     break;
    case 'timeline':   renderTimeline(el);    break;
    case 'settings':   renderSettings(el);    break;
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard(el) {
  const A    = S.assumptions;
  const proj = S.projection;
  const dist = distribution(proj);
  const accum = accumulation(proj);
  const retirePV = portfolioAtRetirement(proj);
  const exAge  = exhaustionAge(proj);
  const yearsLeft = A.profile.retirementAge - A.profile.currentAge;

  // Build runway segments (1 per year of retirement, 63–90)
  const maxBal = Math.max(...dist.map(d => d.portfolioBalance), 1);
  const runway = dist.map(d => {
    const ratio = d.portfolioBalance / maxBal;
    const cls   = ratio > 0.35 ? 'seg-ok' : ratio > 0.10 ? 'seg-low' : 'seg-empty';
    return `<div class="runway-seg ${cls}" title="Age ${d.age}: ${fmt(d.portfolioBalance)}"></div>`;
  }).join('');

  // SS scenario label
  const ssAge = A.socialSecurity.user.claimAge;
  const ssStart67 = dist.find(d => d.age === 67);
  const ssStart70 = dist.find(d => d.age === 70);

  // Bridge period spending (no SS yet, age 63–67)
  const bridgeRow = dist.find(d => d.age === 63);
  const bridgeWithdrawal = bridgeRow ? bridgeRow.withdrawal : 0;

  el.innerHTML = `
    <div class="view-pad">

      <!-- Hero -->
      <div class="card hero-card">
        <div class="hero-label">Years to retirement</div>
        <div class="hero-number">${yearsLeft.toFixed(1)}</div>
        <div class="hero-sub">Target retirement age: ${A.profile.retirementAge}</div>
      </div>

      <!-- Portfolio at Retirement -->
      <div class="card">
        <div class="card-title">Projected at Retirement (Age ${A.profile.retirementAge})</div>
        <div class="stat-row">
          <div class="stat"><span class="stat-val">${fmt(accum.find(r=>r.age===A.profile.retirementAge)?.k401Balance||0)}</span><span class="stat-lbl">401(k)</span></div>
          <div class="stat"><span class="stat-val">${fmt(accum.find(r=>r.age===A.profile.retirementAge)?.brokerageBalance||0)}</span><span class="stat-lbl">Brokerage</span></div>
          <div class="stat accent"><span class="stat-val">${fmt(retirePV)}</span><span class="stat-lbl">Total</span></div>
        </div>
      </div>

      <!-- Runway -->
      <div class="card">
        <div class="card-title-row">
          <span class="card-title">Portfolio Runway  <span class="card-sub">Age ${A.profile.retirementAge}–${A.profile.lifeExpectancy}</span></span>
          ${exAge ? `<span class="badge badge-warn">Risk at ${exAge}</span>` : `<span class="badge badge-ok">Funded</span>`}
        </div>
        <div class="runway">${runway}</div>
        <div class="runway-labels">
          <span>Age ${A.profile.retirementAge}</span>
          <span>Age ${A.profile.lifeExpectancy}</span>
        </div>
      </div>

      <!-- Income at retirement -->
      <div class="card">
        <div class="card-title">Retirement Income Summary</div>
        <div class="income-list">
          <div class="income-row">
            <span class="income-lbl">Bridge withdrawal (age 63–${ssAge})</span>
            <span class="income-val">${fmtFull(bridgeWithdrawal)}/yr</span>
          </div>
          <div class="income-row">
            <span class="income-lbl">Your Social Security (age ${ssAge})</span>
            <span class="income-val">${fmtFull((ssAge===67?A.socialSecurity.user.benefitAt67:A.socialSecurity.user.benefitAt70)*12)}/yr</span>
          </div>
          <div class="income-row">
            <span class="income-lbl">Spouse SS (age ${A.socialSecurity.spouse.claimAge})</span>
            <span class="income-val">${fmtFull(A.socialSecurity.spouse.monthlyBenefit*12)}/yr</span>
          </div>
          <div class="income-row">
            <span class="income-lbl">Spending target (today's $)</span>
            <span class="income-val">${fmtFull(A.retirement.targetAnnualSpendingToday)}/yr</span>
          </div>
        </div>
      </div>

      <!-- MC teaser -->
      <div class="card card-action" id="dash-mc-card">
        ${S.mcResults
          ? `<div class="mc-big ${mcColor(S.mcResults.successRate)}">${S.mcResults.successRate}%</div>
             <div class="mc-label">Monte Carlo success rate<br><span class="text-dim">${S.mcResults.numSimulations.toLocaleString()} simulations</span></div>`
          : `<div class="mc-big mc-dim">—</div>
             <div class="mc-label">Run Monte Carlo simulation<br><span class="text-dim">Tap Outlook to calculate</span></div>`
        }
      </div>

    </div>`;

  document.getElementById('dash-mc-card').addEventListener('click', () => navigate('outlook'));
}

// ── PROJECTION ────────────────────────────────────────────────────────────────
function renderProjection(el) {
  const A    = S.assumptions;
  const proj = S.projection;
  const accum = accumulation(proj);
  const dist  = distribution(proj);

  el.innerHTML = `
    <div class="view-pad">
      <div class="card chart-card">
        <div class="card-title-row">
          <span class="card-title">Portfolio Growth</span>
          <div class="toggle-group">
            <button class="toggle-btn active" id="tog-combined">Combined</button>
            <button class="toggle-btn" id="tog-split">Split</button>
          </div>
        </div>
        <canvas id="proj-chart" height="260"></canvas>
      </div>

      <div class="card chart-card">
        <div class="card-title">Retirement Distribution</div>
        <canvas id="dist-chart" height="220"></canvas>
      </div>

      <div class="card">
        <div class="card-title">Withdrawal Rate Over Retirement</div>
        <canvas id="rate-chart" height="160"></canvas>
      </div>

      <div class="card">
        <div class="card-title-row">
          <span class="card-title">SS Claim Age</span>
          <div class="toggle-group">
            <button class="toggle-btn ${A.socialSecurity.user.claimAge===67?'active':''}" id="ss-67">Age 67</button>
            <button class="toggle-btn ${A.socialSecurity.user.claimAge===70?'active':''}" id="ss-70">Age 70</button>
          </div>
        </div>
        <div class="ss-compare">
          <div class="ss-col">
            <div class="ss-age">Age 67</div>
            <div class="ss-amt">${fmtFull(A.socialSecurity.user.benefitAt67*12)}/yr</div>
          </div>
          <div class="ss-divider">vs</div>
          <div class="ss-col">
            <div class="ss-age">Age 70</div>
            <div class="ss-amt">${fmtFull(A.socialSecurity.user.benefitAt70*12)}/yr</div>
          </div>
        </div>
      </div>
    </div>`;

  buildProjectionCharts(accum, dist, A);

  // SS toggle
  document.getElementById('ss-67').addEventListener('click', () => switchSS(67));
  document.getElementById('ss-70').addEventListener('click', () => switchSS(70));

  // Split/combined toggle
  let split = false;
  document.getElementById('tog-combined').addEventListener('click', () => {
    if (split) { split = false; refreshProjChart(accum, dist, split); setToggle('tog-combined','tog-split'); }
  });
  document.getElementById('tog-split').addEventListener('click', () => {
    if (!split) { split = true; refreshProjChart(accum, dist, split); setToggle('tog-split','tog-combined'); }
  });
}

function setToggle(activeId, inactiveId) {
  document.getElementById(activeId)?.classList.add('active');
  document.getElementById(inactiveId)?.classList.remove('active');
}

function switchSS(age) {
  S.assumptions.socialSecurity.user.claimAge = age;
  recompute();
  destroyCharts();
  renderProjection(document.getElementById('view-container'));
}

function buildProjectionCharts(accum, dist, A) {
  const retireAge = A.profile.retirementAge;
  const allData   = [...accum, ...dist];

  // Combined accumulation line
  const labels    = allData.map(r => `${r.age}`);
  const totals    = accum.map(r => r.totalPortfolio);
  const portBals  = dist.map(r => r.portfolioBalance);
  const combined  = [...totals, ...portBals];
  const k401s     = [...accum.map(r => r.k401Balance),      ...dist.map(() => null)];
  const broks     = [...accum.map(r => r.brokerageBalance), ...dist.map(() => null)];
  const ltcs      = [...accum.map(() => null), ...dist.map(r => r.ltcBalance > 0 ? r.ltcBalance : null)];

  const retireIdx = labels.indexOf(`${retireAge}`);

  S.charts.proj = new Chart(document.getElementById('proj-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total Portfolio', data: combined, borderColor: '#818CF8', backgroundColor: 'rgba(129,140,248,0.08)', borderWidth: 2.5, pointRadius: 0, fill: true, tension: 0.35 },
        { label: 'LTC Reserve',    data: ltcs,     borderColor: '#F59E0B', borderWidth: 1.5, pointRadius: 0, borderDash: [4,3], tension: 0.35 },
      ]
    },
    options: chartOptions(labels, retireAge, A.profile.lifeExpectancy),
  });

  // Distribution chart (spending vs SS vs withdrawal)
  S.charts.dist = new Chart(document.getElementById('dist-chart'), {
    type: 'line',
    data: {
      labels: dist.map(r => `${r.age}`),
      datasets: [
        { label: 'Spending',   data: dist.map(r=>r.inflatedSpending), borderColor: '#94A3B8', borderWidth: 1.5, pointRadius: 0, borderDash:[3,3] },
        { label: 'SS Income',  data: dist.map(r=>r.ssIncome),          borderColor: '#22C55E', borderWidth: 2,   pointRadius: 0 },
        { label: 'Withdrawal', data: dist.map(r=>r.withdrawal),        borderColor: '#EF4444', borderWidth: 2,   pointRadius: 0 },
      ]
    },
    options: chartOptions(dist.map(r=>`${r.age}`), null, A.profile.lifeExpectancy, false),
  });

  // Withdrawal rate chart
  S.charts.rate = new Chart(document.getElementById('rate-chart'), {
    type: 'line',
    data: {
      labels: dist.map(r => `${r.age}`),
      datasets: [
        { label: 'Withdrawal Rate %', data: dist.map(r=>r.withdrawalRate), borderColor: '#F59E0B', borderWidth: 2, pointRadius: 0, fill: true, backgroundColor:'rgba(245,158,11,0.08)' },
        { label: 'Target 3.75%',       data: dist.map(()=>3.75),            borderColor: '#64748B', borderWidth: 1, pointRadius: 0, borderDash:[3,3] },
      ]
    },
    options: chartOptions(dist.map(r=>`${r.age}`), null, A.profile.lifeExpectancy, false),
  });
}

function refreshProjChart(accum, dist, split) {
  const chart = S.charts.proj;
  if (!chart) return;

  const totals   = accum.map(r => r.totalPortfolio);
  const portBals = dist.map(r => r.portfolioBalance);
  const combined = [...totals, ...portBals];
  const k401s    = [...accum.map(r => r.k401Balance),      ...dist.map(()=>null)];
  const broks    = [...accum.map(r => r.brokerageBalance), ...dist.map(()=>null)];
  const ltcs     = [...accum.map(()=>null), ...dist.map(r => r.ltcBalance > 0 ? r.ltcBalance : null)];

  if (split) {
    chart.data.datasets = [
      { label: '401(k)',      data: k401s,    borderColor:'#818CF8', borderWidth:2, pointRadius:0, tension:0.35 },
      { label: 'Brokerage',   data: broks,    borderColor:'#22D3EE', borderWidth:2, pointRadius:0, tension:0.35 },
      { label: 'LTC Reserve', data: ltcs,     borderColor:'#F59E0B', borderWidth:1.5, pointRadius:0, borderDash:[4,3] },
    ];
  } else {
    chart.data.datasets = [
      { label: 'Total Portfolio', data: combined, borderColor:'#818CF8', backgroundColor:'rgba(129,140,248,0.08)', borderWidth:2.5, pointRadius:0, fill:true, tension:0.35 },
      { label: 'LTC Reserve',     data: ltcs,     borderColor:'#F59E0B', borderWidth:1.5, pointRadius:0, borderDash:[4,3] },
    ];
  }
  chart.update('none');
}

function chartOptions(labels, retireAge, lifeExp, showRetireLine = true) {
  const annotations = {};
  if (showRetireLine && retireAge) {
    const ri = labels.indexOf(`${retireAge}`);
    if (ri >= 0) annotations.retireLine = {
      type: 'line', xMin: ri, xMax: ri,
      borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1.5, borderDash: [4, 3],
      label: { content: 'Retire', display: true, position: 'start', color: '#94A3B8', font: { size: 10 } }
    };
  }

  return {
    responsive: true,
    animation: false,
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: '#94A3B8', boxWidth: 12, font: { size: 11 } } },
      annotation: { annotations },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${typeof ctx.parsed.y === 'number' ? (ctx.parsed.y > 100 ? fmt(ctx.parsed.y) : ctx.parsed.y.toFixed(1) + '%') : ''}`,
        }
      }
    },
    scales: {
      x: { ticks: { color: '#64748B', maxTicksLimit: 8, font:{size:10} }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#64748B', callback: v => v > 1000 ? fmt(v) : v, font:{size:10} }, grid: { color: 'rgba(255,255,255,0.05)' } }
    }
  };
}

// ── OUTLOOK (Monte Carlo) ─────────────────────────────────────────────────────
function renderOutlook(el) {
  const mc = S.mcResults;
  el.innerHTML = `
    <div class="view-pad">
      <div class="card hero-card">
        ${mc
          ? `<div class="mc-hero ${mcColor(mc.successRate)}">${mc.successRate}%</div>
             <div class="hero-sub">probability of sustaining ${fmtFull(S.assumptions.retirement.targetAnnualSpendingToday)}/yr<br>through age ${S.assumptions.profile.lifeExpectancy}</div>`
          : `<div class="mc-hero mc-dim">?</div>
             <div class="hero-sub">Run simulation to calculate success rate</div>`
        }
        <button class="btn-primary" id="run-mc-btn">${mc ? 'Re-run' : 'Run'} Simulation</button>
        <div id="mc-progress" class="mc-progress"></div>
      </div>

      ${mc ? `
      <div class="card">
        <div class="card-title">Portfolio at Age ${S.assumptions.profile.lifeExpectancy}</div>
        <div class="stat-row three">
          <div class="stat"><span class="stat-val text-danger">${fmt(mc.finalWealth.p10)}</span><span class="stat-lbl">10th pct</span></div>
          <div class="stat"><span class="stat-val">${fmt(mc.finalWealth.median)}</span><span class="stat-lbl">Median</span></div>
          <div class="stat"><span class="stat-val text-success">${fmt(mc.finalWealth.p90)}</span><span class="stat-lbl">90th pct</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Portfolio at Retirement (Age ${S.assumptions.profile.retirementAge})</div>
        <div class="stat-row three">
          <div class="stat"><span class="stat-val text-danger">${fmt(mc.retireWealth.p10)}</span><span class="stat-lbl">10th pct</span></div>
          <div class="stat"><span class="stat-val">${fmt(mc.retireWealth.median)}</span><span class="stat-lbl">Median</span></div>
          <div class="stat"><span class="stat-val text-success">${fmt(mc.retireWealth.p90)}</span><span class="stat-lbl">90th pct</span></div>
        </div>
      </div>

      <div class="card">
        <canvas id="mc-chart" height="180"></canvas>
      </div>` : ''}

      <div class="card info-card">
        <div class="info-title">How this works</div>
        <div class="info-body">Runs ${S.assumptions.monteCarlo.numSimulations.toLocaleString()} simulations with randomised annual returns (σ = ${S.assumptions.monteCarlo.accumulationReturnStdDevPercent}% accumulation, ${S.assumptions.monteCarlo.distributionReturnStdDevPercent}% distribution) and inflation (σ = ${S.assumptions.monteCarlo.inflationStdDevPercent}%). A simulation "succeeds" if the portfolio is not exhausted before age ${S.assumptions.profile.lifeExpectancy}. Inheritance is excluded from all calculations.</div>
      </div>
    </div>`;

  document.getElementById('run-mc-btn').addEventListener('click', () => {
    const btn = document.getElementById('run-mc-btn');
    const prog = document.getElementById('mc-progress');
    btn.disabled = true;
    prog.textContent = 'Running…';
    setTimeout(() => {
      S.mcResults = runMonteCarlo(S.assumptions);
      recompute(); // refresh projection too (assumptions unchanged, but mc is fresh)
      renderOutlook(document.getElementById('view-container'));
    }, 30);
  });

  if (mc) buildMCChart(mc);
}

function buildMCChart(mc) {
  const canvas = document.getElementById('mc-chart');
  if (!canvas) return;
  const buckets = 20;
  const vals  = [mc.finalWealth.p10, mc.finalWealth.p25, mc.finalWealth.median, mc.finalWealth.p75, mc.finalWealth.p90];
  S.charts.mc = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['P10', 'P25', 'Median', 'P75', 'P90'],
      datasets: [{
        label: `Portfolio at Age ${S.assumptions.profile.lifeExpectancy}`,
        data: vals,
        backgroundColor: ['rgba(239,68,68,0.7)','rgba(245,158,11,0.7)','rgba(129,140,248,0.7)','rgba(34,197,94,0.6)','rgba(34,197,94,0.9)'],
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y) } } },
      scales: {
        x: { ticks: { color:'#64748B', font:{size:11} }, grid:{display:false} },
        y: { ticks: { color:'#64748B', callback: v => fmt(v), font:{size:10} }, grid:{ color:'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

function mcColor(rate) {
  if (rate >= 85) return 'mc-success';
  if (rate >= 70) return 'mc-warn';
  return 'mc-danger';
}

// ── TIMELINE ──────────────────────────────────────────────────────────────────
function renderTimeline(el) {
  const A = S.assumptions;

  const events = [
    { age: A.profile.currentAge,      type:'now',     icon:'◉', label:'Today',                         detail: `Age ${A.profile.currentAge} · Salary ${fmtFull(A.income.currentSalary)}/yr` },
    { age: A.brokerage.scheduledChanges[0]?.ageAtEvent || 50.83, type:'invest', icon:'⬆', label:'Brokerage boost', detail:`$${(A.brokerage.scheduledChanges[0]?.lumpSum/1000||50)}k lump sum + increase to ${fmtFull(A.brokerage.scheduledChanges[0]?.newMonthlyContribution||1500)}/mo` },
    ...A.income.additionalRaises.map(r => ({
      age: r.atAge, type:'raise', icon:'↑', label:`${r.percent}% raise`, detail: `Applied at age ${r.atAge}`
    })),
    { age: A.k401.contributionIncreaseAtAge, type:'invest', icon:'⬆', label:'401(k) to 10%',   detail:`Contribution rate increases from 8% → 10% of salary` },
    { age: A.profile.spouseCurrentAge + (A.socialSecurity.spouse.claimAge - A.profile.spouseCurrentAge), type:'ss', icon:'$', label:`Spouse SS begins`,  detail:`${fmtFull(A.socialSecurity.spouse.monthlyBenefit*12)}/yr (estimated, COLA'd)` },
    { age: A.profile.retirementAge,      type:'retire',  icon:'★', label:'Retirement',                  detail: `Portfolio target: ${fmt(portfolioAtRetirement(S.projection))} · Age ${A.profile.retirementAge}` },
    { age: A.housing.homeSaleAge,         type:'house',   icon:'⌂', label:'Home sale',                   detail:`Proceeds: ${fmt(A.housing.futureSaleValue - A.housing.downsizePurchasePrice)} net → $${A.housing.ltcReserve/1000}k LTC + $${A.housing.liquidityReserve/1000}k liquidity` },
    { age: A.socialSecurity.user.claimAge, type:'ss',    icon:'$', label:`Your SS begins`,              detail:`${fmtFull((A.socialSecurity.user.claimAge===67?A.socialSecurity.user.benefitAt67:A.socialSecurity.user.benefitAt70)*12)}/yr at age ${A.socialSecurity.user.claimAge}` },
    { age: A.profile.lifeExpectancy,      type:'target',  icon:'⊙', label:'Life expectancy target',      detail:`Age ${A.profile.lifeExpectancy} — model endpoint` },
  ].sort((a, b) => a.age - b.age);

  el.innerHTML = `
    <div class="view-pad">
      <div class="timeline">
        ${events.map(e => `
          <div class="tl-item tl-${e.type}">
            <div class="tl-icon">${e.icon}</div>
            <div class="tl-body">
              <div class="tl-age">Age ${e.age % 1 ? e.age.toFixed(1) : e.age}</div>
              <div class="tl-label">${e.label}</div>
              <div class="tl-detail">${e.detail}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

// ── SETTINGS (Assumptions editor) ────────────────────────────────────────────
function renderSettings(el) {
  const A = S.assumptions;
  el.innerHTML = `
    <div class="view-pad">

      <details class="setting-group" open>
        <summary>Profile</summary>
        ${field('profile.currentAge',        'Current age',                  A.profile.currentAge,        'number', 0.5)}
        ${field('profile.retirementAge',     'Retirement age',               A.profile.retirementAge,     'number', 1)}
        ${field('profile.lifeExpectancy',    'Life expectancy',              A.profile.lifeExpectancy,    'number', 1)}
        ${field('profile.spouseCurrentAge',  'Spouse current age',           A.profile.spouseCurrentAge,  'number', 1)}
        ${field('profile.inflationRate',     'Inflation rate (%)',           A.profile.inflationRate,     'number', 0.1)}
        ${field('profile.ssColaRate',        'SS COLA rate (%)',             A.profile.ssColaRate,        'number', 0.1)}
      </details>

      <details class="setting-group">
        <summary>Social Security</summary>
        ${field('socialSecurity.user.benefitAt67',      'Your benefit at 67 ($/mo)',    A.socialSecurity.user.benefitAt67,     'number', 1)}
        ${field('socialSecurity.user.benefitAt70',      'Your benefit at 70 ($/mo)',    A.socialSecurity.user.benefitAt70,     'number', 1)}
        ${field('socialSecurity.user.claimAge',         'Your claim age (67 or 70)',    A.socialSecurity.user.claimAge,        'number', 1)}
        ${field('socialSecurity.spouse.monthlyBenefit', 'Spouse benefit ($/mo, est.)',  A.socialSecurity.spouse.monthlyBenefit,'number', 1)}
        ${field('socialSecurity.spouse.claimAge',       'Spouse claim age',             A.socialSecurity.spouse.claimAge,      'number', 1)}
      </details>

      <details class="setting-group">
        <summary>Employment & Income</summary>
        ${field('income.currentSalary',       'Current salary ($)',    A.income.currentSalary,       'number', 100)}
        ${field('income.annualRaisePercent',  'Annual raise (%)',     A.income.annualRaisePercent,  'number', 0.1)}
        <div class="field-note">Additional raises: ${A.income.additionalRaises.map(r=>`+${r.percent}% at age ${r.atAge}`).join(', ')}<br>Edit source to change these.</div>
      </details>

      <details class="setting-group">
        <summary>401(k)</summary>
        ${field('k401.currentBalance',                   'Current balance ($)',            A.k401.currentBalance,                   'number', 100)}
        ${field('k401.contributionPercent',              'Contribution rate (%)',          A.k401.contributionPercent,              'number', 0.5)}
        ${field('k401.contributionIncreaseAtAge',        'Increase to higher rate at age',A.k401.contributionIncreaseAtAge,        'number', 1)}
        ${field('k401.contributionPercentAfterIncrease', 'Contribution rate after (%)',   A.k401.contributionPercentAfterIncrease, 'number', 0.5)}
        ${field('k401.returnPhases.0.annualReturnPercent','Return rate age 49–55 (%)',    A.k401.returnPhases[0].annualReturnPercent,'number',0.1)}
        ${field('k401.returnPhases.1.annualReturnPercent','Return rate age 55+ (%)',      A.k401.returnPhases[1].annualReturnPercent,'number',0.1)}
      </details>

      <details class="setting-group">
        <summary>Taxable Brokerage</summary>
        ${field('brokerage.currentBalance',   'Current balance ($)',         A.brokerage.currentBalance,   'number', 100)}
        ${field('brokerage.monthlyContribution','Monthly contribution ($/mo)',A.brokerage.monthlyContribution,'number',50)}
        ${field('brokerage.scheduledChanges.0.lumpSum',         'Oct 2027 lump sum ($)',    A.brokerage.scheduledChanges[0]?.lumpSum||50000,        'number',1000)}
        ${field('brokerage.scheduledChanges.0.newMonthlyContribution','Oct 2027 new monthly ($/mo)',A.brokerage.scheduledChanges[0]?.newMonthlyContribution||1500,'number',50)}
        ${field('brokerage.returnPhases.0.annualReturnPercent','Return rate age 49–58 (%)',A.brokerage.returnPhases[0].annualReturnPercent,'number',0.1)}
        ${field('brokerage.returnPhases.1.annualReturnPercent','Return rate age 58+ (%)', A.brokerage.returnPhases[1].annualReturnPercent,'number',0.1)}
      </details>

      <details class="setting-group">
        <summary>Housing</summary>
        ${field('housing.currentHomeValue',      'Current home value ($)',      A.housing.currentHomeValue,      'number',1000)}
        ${field('housing.homeSaleAge',           'Expected sale age',           A.housing.homeSaleAge,           'number',1)}
        ${field('housing.futureSaleValue',       'Expected sale price ($)',     A.housing.futureSaleValue,       'number',1000)}
        ${field('housing.downsizePurchasePrice', 'Downsize purchase price ($)', A.housing.downsizePurchasePrice, 'number',1000)}
        ${field('housing.ltcReserve',            'LTC reserve from proceeds ($)',A.housing.ltcReserve,           'number',1000)}
        ${field('housing.liquidityReserve',      'Liquidity reserve ($)',       A.housing.liquidityReserve,      'number',1000)}
        ${field('housing.ltcAnnualReturnPercent','LTC reserve return (%)',      A.housing.ltcAnnualReturnPercent,'number',0.1)}
      </details>

      <details class="setting-group">
        <summary>Retirement Spending</summary>
        ${field('retirement.targetAnnualSpendingToday','Spending target, today\'s $ ($/yr)',A.retirement.targetAnnualSpendingToday,'number',500)}
        ${field('retirement.portfolioReturnPercent',   'Portfolio return in retirement (%)', A.retirement.portfolioReturnPercent,   'number',0.1)}
        ${field('retirement.targetWithdrawalRatePercent','Target withdrawal rate (%)',       A.retirement.targetWithdrawalRatePercent,'number',0.05)}
      </details>

      <details class="setting-group">
        <summary>Monte Carlo</summary>
        ${field('monteCarlo.numSimulations',                   'Number of simulations',             A.monteCarlo.numSimulations,                   'number',100)}
        ${field('monteCarlo.accumulationReturnStdDevPercent',  'Return std dev — accumulation (%)', A.monteCarlo.accumulationReturnStdDevPercent,  'number',0.5)}
        ${field('monteCarlo.distributionReturnStdDevPercent',  'Return std dev — distribution (%)', A.monteCarlo.distributionReturnStdDevPercent,  'number',0.5)}
        ${field('monteCarlo.inflationStdDevPercent',           'Inflation std dev (%)',              A.monteCarlo.inflationStdDevPercent,           'number',0.1)}
      </details>

      <div class="settings-footer">
        <button class="btn-primary" id="save-btn">Save assumptions</button>
        <div id="save-status"></div>
      </div>
    </div>`;

  // Attach change listeners
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
    btn.disabled = true;
    status.textContent = 'Saving…';
    try {
      await saveAssumptions(S.assumptions);
      status.textContent = '✓ Saved';
      status.className = 'save-ok';
    } catch (e) {
      status.textContent = '✗ Save failed';
      status.className = 'save-err';
    } finally {
      btn.disabled = false;
    }
  });
}

function field(path, label, value, type = 'number', step = 1) {
  return `
    <div class="field-row">
      <label class="field-label">${label}</label>
      <input class="setting-input" type="${type}" value="${value}" step="${step}" data-path="${path}">
    </div>`;
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!isNaN(k)) cur = cur[+k];
    else cur = cur[k];
  }
  const last = parts.at(-1);
  if (!isNaN(last)) cur[+last] = value;
  else cur[last] = value;
}

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.warn);
}