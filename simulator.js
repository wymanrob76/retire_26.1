/**
 * ============================================================
 * ORO VALLEY FORTRESS — Retirement Monte Carlo Engine
 * simulator.js  |  Vanilla JS  |  No dependencies
 * ============================================================
 *
 * USAGE (plain script tag):
 *   <script src="simulator.js"></script>
 *   <script>
 *     var params = RetirementSim.defaultParams();
 *     params.retAge = 63;
 *     params.ss = 39336;
 *
 *     // Baseline Monte Carlo
 *     var result = RetirementSim.runMonteCarlo(params, 10000);
 *     console.log(result.successRate);        // e.g. 78.4
 *     console.log(result.medianAtSSAge);      // e.g. 612000
 *     console.log(result.percentiles[67]);    // { p10, p25, p50, p75, p90 }
 *
 *     // Stress tests
 *     var stress = RetirementSim.runStressTests(params, 2000);
 *     console.log(stress.scenarios);          // array of scenario results
 *     console.log(stress.fortressScore);      // { score, label, color, minRate }
 *
 *     // Tornado analysis
 *     var tornado = RetirementSim.buildTornado(params, result.successRate, 1000);
 *     console.log(tornado);                   // array sorted by adverse impact
 *   </script>
 *
 * ============================================================
 * PARAMS OBJECT — all fields and defaults
 * ============================================================
 *
 *  ACCUMULATION
 *    k401          {number}  Current traditional 401k balance          210000
 *    sal           {number}  Current gross salary                      126300
 *    p1            {number}  401k contrib rate before age 53           0.08
 *    p2            {number}  401k contrib rate age 53+                 0.10
 *    match         {number}  Employer match rate                       0.03
 *    roth401kStart {number}  Age to begin Roth 401k contributions      53
 *    roth401kPct   {number}  Incremental % going to Roth 401k          0.02
 *    brokInit      {number}  Initial monthly brokerage contribution     1000
 *    brok          {number}  Step-up monthly brokerage contribution     1500
 *    brokStepAge   {number}  Age step-up contribution begins            51
 *    lump          {number}  One-time brokerage injection amount        50000
 *    lumpAge       {number}  Age of one-time injection                  51
 *
 *  RETURNS & INFLATION
 *    rpre          {number}  Mean annual return before age 55           0.08
 *    rpost         {number}  Mean annual return age 55+                 0.06
 *    vol           {number}  Annual return volatility (sigma)           0.14
 *    infl          {number}  Mean annual inflation rate                 0.03
 *    ivol          {number}  Inflation volatility (sigma)               0.01
 *
 *  RETIREMENT & BRIDGE
 *    cur           {number}  Current age                                49
 *    retAge        {number}  Retirement age                             63
 *    endAge        {number}  Plan horizon age                           92
 *    spend1        {number}  Go-Go spending/yr today's $  (ret–74)      70000
 *    spend2        {number}  Slow-Go spending/yr today's $ (75–84)      55000
 *    spend3        {number}  No-Go spending/yr today's $  (85+)         45000
 *    hc            {number}  ACA healthcare cost per month pre-65       1500
 *    hci           {number}  Healthcare inflation rate                  0.05
 *    car           {number}  Vehicle purchase (deducted from brok)      0
 *
 *  CASH SLEEVE
 *    sleeve        {number}  Cash sleeve size at retirement             150000
 *    sleeveR       {number}  Sleeve annual cash return                  0.045
 *    sleeveMethod  {string}  'carve' or 'prefund'                       'carve'
 *
 *  SOCIAL SECURITY
 *    ssBase        {number}  SS benefit at FRA 67 (today's $)           39336
 *    ss70          {number}  SS benefit at age 70 (today's $)           50232
 *    ss            {number}  SS benefit actually used in model          39336
 *    ssAge         {number}  SS filing age                              67
 *    spouseSS      {number}  Spouse SS benefit (today's $)              12000
 *    spouseSSAge   {number}  Spouse SS filing age                       62
 *
 *  ROTH CONVERSIONS
 *    roth1         {number}  Phase 1 conversion/yr (ages 63–64)         95000
 *    rothTax1      {number}  Effective tax rate phase 1                 0.12
 *    roth2         {number}  Phase 2 conversion/yr (ages 65–66)         155000
 *    rothTax2      {number}  Effective tax rate phase 2                 0.22
 *    acaCap        {number}  ACA MAGI cap MFJ                          133000
 *    irmaa         {number}  IRMAA threshold MFJ                        212000
 *
 *  GUARDRAIL (spending cut on market drop)
 *    grTrig        {number}  Portfolio drop % that triggers cut          0.10
 *    grCut         {number}  Go-Go spending cut % when triggered         0.10
 *    grRec         {number}  Years spending cut remains active           2
 *
 *  RIGHT-SIZE EVENT
 *    home          {number}  Home sale net proceeds at age 65            750000
 *    down          {number}  Downsize purchase cost                      500000
 *
 *  STRESS SCENARIO OVERRIDES (set by runStressTests — not for manual use)
 *    seqReturns    {Array}   Override returns for first N retirement years
 *    highInflRate  {number}  Forced inflation rate for highInfl window
 *    highInflStart {number}  Start age of high inflation window
 *    highInflEnd   {number}  End age of high inflation window
 *    ltcShockAge   {number}  Age LTC shock begins
 *    ltcShockAmt   {number}  Additional annual spending (today's $)
 *    ltcShockYears {number}  Number of years LTC shock lasts
 */

(function (global) {
  'use strict';

  // ── Box-Muller normal random ─────────────────────────────────────────────
  function randn() {
    var u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ── Default parameter object ─────────────────────────────────────────────
  function defaultParams() {
    return {
      // Accumulation
      k401:          235000,
      sal:           126300,
      p1:            0.08,
      p2:            0.10,
      match:         0.03,
      roth401kStart: 53,
      roth401kPct:   0.02,
      brokInit:      1000,
      brok:          1500,
      brokStepAge:   51,
      lump:          50000,
      lumpAge:       51,
      // Returns & inflation
      rpre:  0.08,
      rpost: 0.06,
      vol:   0.14,
      infl:  0.03,
      ivol:  0.01,
      // Retirement
      cur:    49,
      retAge: 63,
      endAge: 92,
      spend1: 70000,
      spend2: 55000,
      spend3: 45000,
      hc:     1500,
      hci:    0.05,
      car:    0,
      // Sleeve
      sleeve:       150000,
      sleeveR:      0.045,
      sleeveMethod: 'carve',
      // Social Security
      ssBase:      39336,
      ss70:        50232,
      ss:          39336,
      ssAge:       67,
      spouseSS:    12000,
      spouseSSAge: 62,
      // Roth conversions
      roth1:    95000,
      rothTax1: 0.12,
      roth2:    155000,
      rothTax2: 0.22,
      acaCap:   133000,
      irmaa:    212000,
      // Guardrail
      grTrig: 0.10,
      grCut:  0.10,
      grRec:  2,
      // Right-size
      home: 750000,
      down: 500000
    };
  }

  // ── Single simulation path ───────────────────────────────────────────────
  // Returns { path: [{age, tot}], fail: age|null }
  function simOne(p) {
    var brok        = 0;
    var k401        = p.k401;
    var roth401     = 0;
    var sal         = p.sal;
    var ic          = 1.0;
    var fail        = null;
    var hcBase      = p.hc * 12;
    var sleeve      = 0;
    var sleeve_acc  = 0;
    var prevPortVal = 0;
    var grCutYrsLeft = 0;
    var path        = [];

    for (var age = p.cur; age <= p.endAge; age++) {
      var mu  = age < 55 ? p.rpre : p.rpost;
      var ret;

      // Sequence-of-returns override (Scenario F)
      if (p.seqReturns && age >= p.retAge) {
        var seqIdx = age - p.retAge;
        ret = seqIdx < p.seqReturns.length ? p.seqReturns[seqIdx] : (mu + p.vol * randn());
      } else {
        ret = mu + p.vol * randn();
      }

      // Inflation — high-inflation window override (Scenario D)
      var baseIr = Math.max(0.005, p.infl + p.ivol * randn());
      var ir = (p.highInflRate && age >= p.highInflStart && age <= p.highInflEnd)
        ? Math.max(baseIr, p.highInflRate)
        : baseIr;
      ic *= (1 + ir);

      // ── ACCUMULATION ──────────────────────────────────────────────────────
      if (age < p.retAge) {
        if (age === 52)      sal *= 1.08;
        else if (age === 58) sal *= 1.08;
        else                 sal *= 1.03;

        var cp = age >= 53 ? p.p2 : p.p1;
        var roth401kContrib = (p.roth401kPct > 0 && age >= p.roth401kStart)
          ? sal * p.roth401kPct : 0;
        var trad401kContrib = sal * (cp - (age >= p.roth401kStart ? p.roth401kPct : 0) + p.match);
        k401    = k401    * (1 + ret) + Math.max(0, trad401kContrib);
        roth401 = roth401 * (1 + ret) + roth401kContrib;

        if (p.lump > 0 && age === p.lumpAge) brok += p.lump;
        if (p.car  > 0 && age === 51)        brok -= p.car;

        var monthlyContrib = age >= p.brokStepAge ? p.brok : p.brokInit;
        if (p.sleeveMethod === 'prefund' && age >= (p.retAge - 2)) {
          sleeve_acc += monthlyContrib * 12;
          brok = brok * (1 + ret);
        } else {
          brok = brok * (1 + ret) + monthlyContrib * 12;
        }

      // ── DECUMULATION ──────────────────────────────────────────────────────
      } else {

        // Carve cash sleeve at retirement
        if (age === p.retAge && p.sleeve > 0) {
          if (p.sleeveMethod === 'prefund') {
            var rem   = Math.max(0, p.sleeve - sleeve_acc);
            var carve = Math.min(rem, brok);
            brok   -= carve;
            sleeve  = sleeve_acc + carve;
            sleeve_acc = 0;
          } else {
            var carve = Math.min(p.sleeve, brok);
            brok  -= carve;
            sleeve = carve;
          }
        }

        // Guardrail trigger
        var portVal = brok + sleeve + k401 + roth401;
        if (age > p.retAge && prevPortVal > 0 && p.grTrig > 0) {
          if ((prevPortVal - portVal) / prevPortVal >= p.grTrig) {
            grCutYrsLeft = p.grRec;
          }
        }
        if (grCutYrsLeft > 0) grCutYrsLeft--;

        // Age-banded spending
        var spendBase = age <= 74 ? p.spend1 : age <= 84 ? p.spend2 : p.spend3;
        var guardrailMult = (grCutYrsLeft > 0 && age <= 74) ? (1 - p.grCut) : 1;
        var spendN = spendBase * ic * guardrailMult;

        // Healthcare
        var hcYrs = age - p.retAge;
        var hcN   = age < 65
          ? hcBase * Math.pow(1 + p.hci, hcYrs)
          : 3600   * Math.pow(1 + p.hci, hcYrs);

        // Right-size home equity injection at 65
        if (age === 65) brok += Math.max(0, (p.home || 0) - (p.down || 0));

        // Two-phase Roth conversions
        var convAmt = 0, convTax = 0;
        if (age >= 63 && age <= 64 && p.roth1 > 0) {
          convAmt = Math.min(p.roth1, k401);
          convTax = convAmt * p.rothTax1;
        } else if (age >= 65 && age <= 66 && p.roth2 > 0) {
          convAmt = Math.min(p.roth2, k401);
          convTax = convAmt * p.rothTax2;
        }
        if (convAmt > 0 && brok >= convTax) {
          k401    -= convAmt;
          brok    -= convTax;
          roth401 += convAmt;
        }

        // Income
        var ssInc       = age >= p.ssAge       ? p.ss       * ic : 0;
        var spouseSSInc = age >= p.spouseSSAge  ? p.spouseSS * ic : 0;

        // LTC shock (Scenario E)
        var ltcExtra = 0;
        if (p.ltcShockAge && age >= p.ltcShockAge && age < (p.ltcShockAge + p.ltcShockYears)) {
          ltcExtra = p.ltcShockAmt * ic;
        }

        var need = Math.max(0, spendN + hcN + ltcExtra - ssInc - spouseSSInc);

        // Withdrawal hierarchy: sleeve → Roth → brokerage → 401k
        if (sleeve > 0) {
          var ds = Math.min(sleeve, need);
          sleeve = (sleeve - ds) * (1 + p.sleeveR);
          need  -= ds;
        } else { sleeve = 0; }

        if (need > 0 && roth401 > 0 && age >= 63 && age <= 67) {
          var dr = Math.min(roth401, need);
          roth401 = (roth401 - dr) * (1 + ret);
          need -= dr;
        } else { roth401 = roth401 * (1 + ret); }

        if (need > 0 && brok > 0) {
          var d1 = Math.min(brok, need);
          brok = (brok - d1) * (1 + ret);
          need -= d1;
        } else { brok = Math.max(0, brok) * (1 + ret); }

        if (need > 0) {
          if (k401 > 0) {
            var d2 = Math.min(k401, need);
            k401 = (k401 - d2) * (1 + ret);
            need -= d2;
          } else { k401 = 0; }
        } else {
          k401 = k401 * (1 + ret);
        }

        if (need > 0 && fail === null) fail = age;
      }

      prevPortVal = brok + sleeve + k401 + roth401;
      path.push({ age: age, tot: prevPortVal });
    }

    return { path: path, fail: fail };
  }

  // ── Run N simulations, return structured metrics ─────────────────────────
  function runScenario(p, N) {
    N = N || 2000;
    var fails = 0, failAges = [], retVals = [], ssVals = [], v80 = [], v90 = [];

    for (var i = 0; i < N; i++) {
      var r = simOne(p);
      if (r.fail !== null) { fails++; failAges.push(r.fail); }
      var atRet = r.path.find(function(x){ return x.age === p.retAge; });
      var atSS  = r.path.find(function(x){ return x.age === p.ssAge; });
      var at80  = r.path.find(function(x){ return x.age === 80; });
      var at90  = r.path.find(function(x){ return x.age === 90; });
      if (atRet) retVals.push(atRet.tot);
      if (atSS)  ssVals.push(atSS.tot);
      if (at80)  v80.push(at80.tot);
      if (at90)  v90.push(at90.tot);
    }

    function median(arr) {
      if (!arr.length) return 0;
      var s = arr.slice().sort(function(a,b){ return a-b; });
      return s[Math.floor(s.length / 2)];
    }

    return {
      successRate:   (N - fails) / N * 100,
      failCount:     fails,
      failRate:      fails / N * 100,
      medianAtRetirement: median(retVals),
      medianAtSSAge:      median(ssVals),
      medianAt80:         median(v80),
      medianAt90:         median(v90),
      earliestFailAge: failAges.length ? Math.min.apply(null, failAges) : null,
      failAgeDistribution: {
        'before70': failAges.filter(function(a){ return a <= 70; }).length,
        '71to80':   failAges.filter(function(a){ return a > 70 && a <= 80; }).length,
        '81to90':   failAges.filter(function(a){ return a > 80 && a <= 90; }).length,
        'after90':  failAges.filter(function(a){ return a > 90; }).length
      }
    };
  }

  // ── Full Monte Carlo baseline with percentile fan ────────────────────────
  // Returns all scenario metrics PLUS percentile arrays keyed by age
  function runMonteCarlo(p, N) {
    N = N || 10000;
    var paths = [], fails = 0, failAges = [], bridgeVals = [];

    for (var i = 0; i < N; i++) {
      var r = simOne(p);
      paths.push(r.path);
      if (r.fail !== null) { fails++; failAges.push(r.fail); }
      var atSS = r.path.find(function(x){ return x.age === p.ssAge; });
      if (atSS) bridgeVals.push(atSS.tot);
    }

    var ages = paths[0].map(function(x){ return x.age; });
    var p10 = [], p25 = [], p50 = [], p75 = [], p90 = [];
    ages.forEach(function(age, i) {
      var vals = paths.map(function(pt){ return pt[i].tot; })
                      .sort(function(a,b){ return a-b; });
      var at = function(pct){ return vals[Math.floor(pct/100 * vals.length)] || 0; };
      p10.push(at(10)); p25.push(at(25)); p50.push(at(50));
      p75.push(at(75)); p90.push(at(90));
    });

    // Percentiles keyed by age for easy lookup: result.percentiles[67]
    var percentiles = {};
    ages.forEach(function(age, i) {
      percentiles[age] = { p10: p10[i], p25: p25[i], p50: p50[i], p75: p75[i], p90: p90[i] };
    });

    var bvS  = bridgeVals.slice().sort(function(a,b){ return a-b; });
    var medB = bvS[Math.floor(bvS.length/2)] || 0;

    // No-sleeve comparison
    var pNS  = JSON.parse(JSON.stringify(p)); pNS.sleeve = 0;
    var fcNS = 0;
    for (var k = 0; k < N; k++) { if (simOne(pNS).fail !== null) fcNS++; }

    // Healthcare sensitivity
    var hcScenarios = [
      { label: '$800/mo',   val: 800  },
      { label: '$1,500/mo', val: 1500 },
      { label: '$2,200/mo', val: 2200 },
      { label: '$3,000/mo', val: 3000 }
    ];
    var hcSensitivity = hcScenarios.map(function(s) {
      var pp = JSON.parse(JSON.stringify(p)); pp.hc = s.val;
      var fc = 0;
      for (var j = 0; j < 2000; j++) { if (simOne(pp).fail !== null) fc++; }
      return { label: s.label, monthlyAmount: s.val, successRate: (2000-fc)/2000*100 };
    });

    return {
      // Core result
      successRate:        (N - fails) / N * 100,
      failCount:          fails,
      simulations:        N,
      // Bridge
      medianAtSSAge:      medB,
      sleeveSuccessRate:  (N - fails)  / N * 100,
      noSleeveSuccessRate:(N - fcNS)   / N * 100,
      sleeveLiftPoints:   ((N - fails) - (N - fcNS)) / N * 100,
      // Percentile fan
      ages:               ages,
      p10:                p10,
      p25:                p25,
      p50:                p50,
      p75:                p75,
      p90:                p90,
      percentiles:        percentiles,   // percentiles[age] = {p10,p25,p50,p75,p90}
      // Failure analysis
      failAgeDistribution: {
        before70: failAges.filter(function(a){ return a <= 70; }).length,
        '71to80': failAges.filter(function(a){ return a > 70 && a <= 80; }).length,
        '81to90': failAges.filter(function(a){ return a > 80 && a <= 90; }).length,
        after90:  failAges.filter(function(a){ return a > 90; }).length
      },
      earliestFailAge: failAges.length ? Math.min.apply(null, failAges) : null,
      // Sensitivity
      hcSensitivity: hcSensitivity
    };
  }

  // ── Stress test engine — all 7 scenarios + perfect storm ────────────────
  function runStressTests(p, N) {
    N = N || 2000;

    var base = runScenario(p, N);

    // A: No home downsize
    var pA = JSON.parse(JSON.stringify(p));
    pA.home = 0; pA.down = 0;

    // B: SS -25%
    var pB = JSON.parse(JSON.stringify(p));
    pB.ss *= 0.75; pB.spouseSS *= 0.75;

    // C: Retire one year earlier
    var pC = JSON.parse(JSON.stringify(p));
    pC.retAge = Math.max(49, p.retAge - 1);

    // D: High inflation decade
    var pD = JSON.parse(JSON.stringify(p));
    pD.highInflStart = p.retAge;
    pD.highInflEnd   = p.retAge + 10;
    pD.highInflRate  = 0.05;

    // E: LTC shock at 85
    var pE = JSON.parse(JSON.stringify(p));
    pE.ltcShockAge   = 85;
    pE.ltcShockAmt   = 100000;
    pE.ltcShockYears = 5;

    // F: Sequence of returns
    var pF = JSON.parse(JSON.stringify(p));
    pF.seqReturns = [-0.35, -0.20, 0.05];

    // G: Perfect storm
    var pG = JSON.parse(JSON.stringify(p));
    pG.home = 0; pG.down = 0;
    pG.ss       *= 0.75; pG.spouseSS *= 0.75;
    pG.retAge    = Math.max(49, p.retAge - 1);
    pG.highInflStart = pG.retAge; pG.highInflEnd = pG.retAge + 10; pG.highInflRate = 0.05;
    pG.ltcShockAge = 85; pG.ltcShockAmt = 100000; pG.ltcShockYears = 5;
    pG.seqReturns  = [-0.35, -0.20, 0.05];

    var scenarios = [
      { id: 'baseline',  label: 'Baseline',                       params: p,  result: base },
      { id: 'noDownsize',label: 'A — No Home Downsize',           params: pA, result: runScenario(pA, N) },
      { id: 'ssReduced', label: 'B — SS Reduced 25%',             params: pB, result: runScenario(pB, N) },
      { id: 'earlyRet',  label: 'C — Retire Age ' + (p.retAge-1), params: pC, result: runScenario(pC, N) },
      { id: 'highInfl',  label: 'D — High Inflation Decade',      params: pD, result: runScenario(pD, N) },
      { id: 'ltcShock',  label: 'E — LTC Shock at 85',            params: pE, result: runScenario(pE, N) },
      { id: 'seqRisk',   label: 'F — Sequence of Returns',        params: pF, result: runScenario(pF, N) },
      { id: 'perfect',   label: 'G — Perfect Storm',              params: pG, result: runScenario(pG, N) }
    ];

    // Add delta vs baseline to each
    scenarios.forEach(function(s) {
      s.result.deltaVsBaseline = s.result.successRate - base.successRate;
    });

    var allRates = scenarios.map(function(s){ return s.result.successRate; });
    var minRate  = Math.min.apply(null, allRates);

    return {
      scenarios:     scenarios,
      fortressScore: calcFortressScore(minRate),
      baselineRate:  base.successRate,
      worstScenario: scenarios.slice(1).reduce(function(a,b){
        return b.result.successRate < a.result.successRate ? b : a;
      }),
      bestScenario: scenarios.slice(1).reduce(function(a,b){
        return b.result.successRate > a.result.successRate ? b : a;
      })
    };
  }

  // ── Fortress score ───────────────────────────────────────────────────────
  function calcFortressScore(minRate) {
    var score, label, color;
    if      (minRate >= 90) { score = 100; label = 'FORTRESS';   color = '#3ddc84'; }
    else if (minRate >= 80) { score = 90;  label = 'RESILIENT';  color = '#3ddc84'; }
    else if (minRate >= 70) { score = 80;  label = 'SOLID';      color = '#ffb74d'; }
    else if (minRate >= 60) { score = 70;  label = 'ADEQUATE';   color = '#ffb74d'; }
    else if (minRate >= 50) { score = 60;  label = 'VULNERABLE'; color = '#ff5252'; }
    else                    { score = 50;  label = 'AT RISK';    color = '#ff5252'; }
    return { score: score, label: label, color: color, minRate: minRate };
  }

  // ── Tornado analysis ─────────────────────────────────────────────────────
  // Returns array sorted by largest adverse impact (worst first)
  function buildTornado(p, baseSR, N) {
    N = N || 1000;

    function test(pp) {
      var fc = 0;
      for (var i = 0; i < N; i++) { if (simOne(pp).fail !== null) fc++; }
      return (N - fc) / N * 100;
    }

    function clone(overrides) {
      return Object.assign(JSON.parse(JSON.stringify(p)), overrides || {});
    }

    var results = [
      {
        label: 'Retirement Age',
        adverseRate:    test(clone({ retAge: p.retAge - 1 })),
        favourableRate: test(clone({ retAge: p.retAge + 1 }))
      },
      {
        label: 'Spending Level',
        adverseRate:    test(clone({ spend1: p.spend1*1.10, spend2: p.spend2*1.10, spend3: p.spend3*1.10 })),
        favourableRate: test(clone({ spend1: p.spend1*0.90, spend2: p.spend2*0.90, spend3: p.spend3*0.90 }))
      },
      {
        label: 'Home Equity Release',
        adverseRate:    test(clone({ home: 0, down: 0 })),
        favourableRate: test(clone({ home: Math.min(p.home * 1.5, 1200000) }))
      },
      {
        label: 'Social Security',
        adverseRate:    test(clone({ ss: p.ss * 0.75, spouseSS: p.spouseSS * 0.75 })),
        favourableRate: test(clone({ ss: p.ss * 1.10, spouseSS: p.spouseSS * 1.10 }))
      },
      {
        label: 'Inflation Rate',
        adverseRate:    test(clone({ infl: Math.min(0.12, p.infl + 0.01) })),
        favourableRate: test(clone({ infl: Math.max(0.005, p.infl - 0.01) }))
      },
      {
        label: 'Healthcare Costs',
        adverseRate:    test(clone({ hc: p.hc + 500 })),
        favourableRate: test(clone({ hc: Math.max(0, p.hc - 500) }))
      },
      {
        label: 'Market Sequence Risk',
        adverseRate:    test(clone({ seqReturns: [-0.35, -0.20, 0.05] })),
        favourableRate: test(clone({ seqReturns: [0.12, 0.15, 0.18] }))
      }
    ];

    // Annotate with impact vs baseline
    results.forEach(function(r) {
      r.adverseImpact    = baseSR - r.adverseRate;     // positive = harmful
      r.favourableImpact = r.favourableRate - baseSR;  // positive = helpful
      r.totalSwing       = r.adverseImpact + r.favourableImpact;
      r.baseSR           = baseSR;
    });

    // Sort largest adverse impact first
    results.sort(function(a, b) { return b.adverseImpact - a.adverseImpact; });

    return results;
  }

  // ── Public API ───────────────────────────────────────────────────────────
  global.RetirementSim = {
    defaultParams:    defaultParams,
    runMonteCarlo:    runMonteCarlo,
    runScenario:      runScenario,
    runStressTests:   runStressTests,
    buildTornado:     buildTornado,
    calcFortressScore:calcFortressScore,
    // Exposed for custom scenario building
    simOne:           simOne
  };

}(typeof window !== 'undefined' ? window : this));