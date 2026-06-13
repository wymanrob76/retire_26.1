// projection.js — AuraRetire core projection engine
// Produces a year-by-year array from currentAge → lifeExpectancy.
// All dollar amounts are nominal (inflation is applied to spending in distribution).

export function runProjection(A) {
  const results    = [];
  const currentAge = A.profile.currentAge;        // 49.5
  const retireAge  = A.profile.retirementAge;     // 63
  const lifeExp    = A.profile.lifeExpectancy;    // 90
  const inflation  = A.profile.inflationRate / 100;
  const ssColaRate = A.profile.ssColaRate  / 100;

  // ── Accumulation phase state ──────────────────────────────────────────────
  let age          = currentAge;
  let salary       = A.income.currentSalary;
  let k401Bal      = A.k401.currentBalance;
  let brokerageBal = A.brokerage.currentBalance;
  let monthlyBrok  = A.brokerage.monthlyContribution;

  // Track which one-time events have fired
  const raisesApplied = new Set();
  const changes = [...A.brokerage.scheduledChanges].sort((a, b) => a.ageAtEvent - b.ageAtEvent);
  const changesApplied = new Set();

  // ── ACCUMULATION: currentAge → retirementAge ──────────────────────────────
  while (age < retireAge) {
    const stepStart = age;
    const stepEnd   = Math.min(age + 1, retireAge);
    const yr        = stepEnd - stepStart;    // fraction of year (last step may be < 1)

    // Salary: apply annual raise at the start of each new year past the first
    if (age > currentAge) salary *= (1 + A.income.annualRaisePercent / 100);

    // Age-gated bonus raises (applied when threshold is crossed in this step)
    for (const [i, raise] of A.income.additionalRaises.entries()) {
      if (!raisesApplied.has(i) && stepStart < raise.atAge && stepEnd >= raise.atAge) {
        salary *= (1 + raise.percent / 100);
        raisesApplied.add(i);
      }
    }

    // 401(k)
    const k401Rate       = phaseRate(age, A.k401.returnPhases) / 100;
    const k401ContribPct = (age < A.k401.contributionIncreaseAtAge
      ? A.k401.contributionPercent
      : A.k401.contributionPercentAfterIncrease) / 100;
    const matchCapPct    = A.k401.employerMatchCapPercent / 100;
    const matchRate      = A.k401.employerMatchPercent   / 100;
    const empContrib     = salary * k401ContribPct * yr;
    const emplMatch      = salary * Math.min(k401ContribPct, matchCapPct) * matchRate * yr;
    k401Bal = k401Bal * Math.pow(1 + k401Rate, yr) + empContrib + emplMatch;

    // Brokerage: check for scheduled lump-sum / contribution changes
    let lumpSum = 0;
    for (const [i, ch] of changes.entries()) {
      if (!changesApplied.has(i) && stepStart < ch.ageAtEvent && stepEnd >= ch.ageAtEvent) {
        lumpSum += ch.lumpSum || 0;
        if (ch.newMonthlyContribution != null) monthlyBrok = ch.newMonthlyContribution;
        changesApplied.add(i);
      }
    }
    const brokRate   = phaseRate(age, A.brokerage.returnPhases) / 100;
    brokerageBal     = brokerageBal * Math.pow(1 + brokRate, yr)
                     + monthlyBrok * 12 * yr
                     + lumpSum;

    results.push({
      age:              +stepEnd.toFixed(2),
      phase:            'accumulation',
      salary:           Math.round(salary),
      k401Balance:      Math.round(k401Bal),
      brokerageBalance: Math.round(brokerageBal),
      totalPortfolio:   Math.round(k401Bal + brokerageBal),
    });

    age = stepEnd;
  }

  // ── DISTRIBUTION: retirementAge → lifeExpectancy ──────────────────────────
  const baseSpending    = A.retirement.targetAnnualSpendingToday;
  const portReturn      = A.retirement.portfolioReturnPercent / 100;
  const userSSClaimAge  = A.socialSecurity.user.claimAge;          // 67 or 70
  const userSSYearly    = (userSSClaimAge === 67
    ? A.socialSecurity.user.benefitAt67
    : A.socialSecurity.user.benefitAt70) * 12;
  const spouseSSYearly  = A.socialSecurity.spouse.monthlyBenefit * 12;
  const spouseClaimAge  = A.socialSecurity.spouse.claimAge;
  const spouseCurrentAge = A.profile.spouseCurrentAge;

  let portfolioBal  = k401Bal + brokerageBal;   // merge accounts at retirement
  let ltcBal        = 0;
  let homeEventDone = false;

  for (let distAge = retireAge; distAge <= lifeExp; distAge++) {
    const yearsFromNow    = distAge - currentAge;       // for inflation calc
    const inflatedSpend   = baseSpending * Math.pow(1 + inflation, yearsFromNow);

    // ── SS income ──
    let ssIncome = 0;

    // User SS: starts at claim age (67 default, 70 alternate)
    if (distAge >= userSSClaimAge) {
      const cola = Math.pow(1 + ssColaRate, distAge - userSSClaimAge);
      ssIncome += userSSYearly * cola;
    }

    // Spouse SS: starts when spouse reaches claim age
    const spouseAgeThisYear = spouseCurrentAge + yearsFromNow;
    if (spouseAgeThisYear >= spouseClaimAge) {
      const spouseYrs = spouseAgeThisYear - spouseClaimAge;
      ssIncome += spouseSSYearly * Math.pow(1 + ssColaRate, Math.max(0, spouseYrs));
    }

    // ── Home sale ──
    if (!homeEventDone && distAge >= A.housing.homeSaleAge) {
      ltcBal       += A.housing.ltcReserve;       // $250k → separate LTC reserve
      portfolioBal += A.housing.liquidityReserve; // $50k  → main portfolio
      homeEventDone = true;
    }

    // ── LTC reserve grows separately ──
    if (ltcBal > 0) ltcBal *= (1 + A.housing.ltcAnnualReturnPercent / 100);

    // ── Portfolio withdrawal ──
    const withdrawal     = Math.max(0, inflatedSpend - ssIncome);
    const actualWithdraw = Math.min(withdrawal, Math.max(0, portfolioBal));
    const withdrawalRate = portfolioBal > 0 ? (actualWithdraw / portfolioBal) * 100 : 0;

    // Portfolio: grows at portReturn, then subtract withdrawal
    portfolioBal = portfolioBal * (1 + portReturn) - actualWithdraw;
    const exhausted = portfolioBal <= 0;
    if (portfolioBal < 0) portfolioBal = 0;

    results.push({
      age:              distAge,
      phase:            'distribution',
      inflatedSpending: Math.round(inflatedSpend),
      ssIncome:         Math.round(ssIncome),
      withdrawal:       Math.round(actualWithdraw),
      withdrawalRate:   Math.round(withdrawalRate * 10) / 10,
      portfolioBalance: Math.round(portfolioBal),
      ltcBalance:       Math.round(ltcBal),
      totalWealth:      Math.round(portfolioBal + ltcBal),
      exhausted,
    });

    if (exhausted) break;  // portfolio gone; stop projecting
  }

  return results;
}

// ── Derived getters used by the UI ────────────────────────────────────────────

export function accumulation(results) {
  return results.filter(r => r.phase === 'accumulation');
}

export function distribution(results) {
  return results.filter(r => r.phase === 'distribution');
}

/** Portfolio value at the moment of retirement */
export function portfolioAtRetirement(results) {
  const pt = accumulation(results).at(-1);
  return pt ? pt.totalPortfolio : 0;
}

/** Age at which portfolio is exhausted, or null if it lasts to life expectancy */
export function exhaustionAge(results) {
  const pt = distribution(results).find(r => r.exhausted);
  return pt ? pt.age : null;
}

// ── Internal: find the applicable return rate for a given age ─────────────────
export function phaseRate(age, phases) {
  for (let i = phases.length - 1; i >= 0; i--) {
    if (age >= phases[i].fromAge) return phases[i].annualReturnPercent;
  }
  return phases[0].annualReturnPercent;
}
