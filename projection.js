// projection.js — loaded as a plain script, no imports/exports

const DEFAULTS = {
  profile: {
    currentAge: 49.5, retirementAge: 63, lifeExpectancy: 90,
    spouseCurrentAge: 49, inflationRate: 3.0, ssColaRate: 2.5,
  },
  socialSecurity: {
    user: { benefitAt67: 3278, benefitAt70: 4186, claimAge: 67 },
    spouse: { claimAge: 62, monthlyBenefit: 1250 }
  },
  income: {
    currentSalary: 126300, annualRaisePercent: 3.0,
    additionalRaises: [{ atAge: 52, percent: 8.0 }, { atAge: 58, percent: 8.0 }]
  },
  k401: {
    currentBalance: 235000, contributionPercent: 8.0,
    contributionIncreaseAtAge: 53, contributionPercentAfterIncrease: 10.0,
    employerMatchPercent: 50.0, employerMatchCapPercent: 6.0,
    returnPhases: [
      { fromAge: 49.5, toAge: 55,  annualReturnPercent: 8.0 },
      { fromAge: 55,   toAge: 100, annualReturnPercent: 6.0 },
    ]
  },
  brokerage: {
    currentBalance: 0, monthlyContribution: 1000,
    scheduledChanges: [{ ageAtEvent: 50.83, lumpSum: 50000, newMonthlyContribution: 1500 }],
    returnPhases: [
      { fromAge: 49.5, toAge: 58,  annualReturnPercent: 8.0 },
      { fromAge: 58,   toAge: 100, annualReturnPercent: 6.0 },
    ]
  },
  cash: { currentBalance: 67000 },
  housing: {
    currentHomeValue: 650000, homeSaleAge: 66,
    futureSaleValue: 750000, downsizePurchasePrice: 500000,
    ltcReserve: 250000, liquidityReserve: 50000, ltcAnnualReturnPercent: 4.0,
  },
  retirement: {
    targetAnnualSpendingToday: 70000, portfolioReturnPercent: 5.0,
    targetWithdrawalRatePercent: 3.75,
  },
  monteCarlo: {
    numSimulations: 1000, accumulationReturnStdDevPercent: 12.0,
    distributionReturnStdDevPercent: 8.0, inflationStdDevPercent: 1.0,
  }
};

function phaseRate(age, phases) {
  for (let i = phases.length - 1; i >= 0; i--) {
    if (age >= phases[i].fromAge) return phases[i].annualReturnPercent;
  }
  return phases[0].annualReturnPercent;
}

function runProjection(A) {
  const results = [];
  const currentAge = A.profile.currentAge;
  const retireAge  = A.profile.retirementAge;
  const lifeExp    = A.profile.lifeExpectancy;
  const inflation  = A.profile.inflationRate / 100;
  const ssColaRate = A.profile.ssColaRate    / 100;

  let age          = currentAge;
  let salary       = A.income.currentSalary;
  let k401Bal      = A.k401.currentBalance;
  let brokerageBal = A.brokerage.currentBalance;
  let monthlyBrok  = A.brokerage.monthlyContribution;

  const raisesApplied  = new Set();
  const changes        = [...A.brokerage.scheduledChanges].sort((a, b) => a.ageAtEvent - b.ageAtEvent);
  const changesApplied = new Set();

  while (age < retireAge) {
    const stepStart = age;
    const stepEnd   = Math.min(age + 1, retireAge);
    const yr        = stepEnd - stepStart;

    if (age > currentAge) salary *= (1 + A.income.annualRaisePercent / 100);
    for (const [i, raise] of A.income.additionalRaises.entries()) {
      if (!raisesApplied.has(i) && stepStart < raise.atAge && stepEnd >= raise.atAge) {
        salary *= (1 + raise.percent / 100);
        raisesApplied.add(i);
      }
    }

    const k401Rate      = phaseRate(age, A.k401.returnPhases) / 100;
    const k401ContribPct = (age < A.k401.contributionIncreaseAtAge
      ? A.k401.contributionPercent
      : A.k401.contributionPercentAfterIncrease) / 100;
    const matchCapPct   = A.k401.employerMatchCapPercent / 100;
    const matchRate     = A.k401.employerMatchPercent    / 100;
    const empContrib    = salary * k401ContribPct * yr;
    const emplMatch     = salary * Math.min(k401ContribPct, matchCapPct) * matchRate * yr;
    k401Bal = k401Bal * Math.pow(1 + k401Rate, yr) + empContrib + emplMatch;

    let lumpSum = 0;
    for (const [i, ch] of changes.entries()) {
      if (!changesApplied.has(i) && stepStart < ch.ageAtEvent && stepEnd >= ch.ageAtEvent) {
        lumpSum += ch.lumpSum || 0;
        if (ch.newMonthlyContribution != null) monthlyBrok = ch.newMonthlyContribution;
        changesApplied.add(i);
      }
    }
    const brokRate = phaseRate(age, A.brokerage.returnPhases) / 100;
    brokerageBal   = brokerageBal * Math.pow(1 + brokRate, yr) + monthlyBrok * 12 * yr + lumpSum;

    results.push({
      age: +stepEnd.toFixed(2), phase: 'accumulation',
      salary: Math.round(salary),
      k401Balance: Math.round(k401Bal),
      brokerageBalance: Math.round(brokerageBal),
      totalPortfolio: Math.round(k401Bal + brokerageBal),
    });
    age = stepEnd;
  }

  // Distribution
  const baseSpending   = A.retirement.targetAnnualSpendingToday;
  const portReturn     = A.retirement.portfolioReturnPercent / 100;
  const userSSClaimAge = A.socialSecurity.user.claimAge;
  const userSSYearly   = (userSSClaimAge === 67
    ? A.socialSecurity.user.benefitAt67
    : A.socialSecurity.user.benefitAt70) * 12;
  const spouseSSYearly  = A.socialSecurity.spouse.monthlyBenefit * 12;
  const spouseClaimAge  = A.socialSecurity.spouse.claimAge;
  const spouseCurrentAge = A.profile.spouseCurrentAge;

  let portfolioBal  = k401Bal + brokerageBal;
  let ltcBal        = 0;
  let homeEventDone = false;

  for (let da = retireAge; da <= lifeExp; da++) {
    const yearsFromNow  = da - currentAge;
    const inflatedSpend = baseSpending * Math.pow(1 + inflation, yearsFromNow);

    let ssIncome = 0;
    if (da >= userSSClaimAge) {
      ssIncome += userSSYearly * Math.pow(1 + ssColaRate, da - userSSClaimAge);
    }
    const spouseAgeNow = spouseCurrentAge + yearsFromNow;
    if (spouseAgeNow >= spouseClaimAge) {
      ssIncome += spouseSSYearly * Math.pow(1 + ssColaRate, Math.max(0, spouseAgeNow - spouseClaimAge));
    }

    if (!homeEventDone && da >= A.housing.homeSaleAge) {
      ltcBal       += A.housing.ltcReserve;
      portfolioBal += A.housing.liquidityReserve;
      homeEventDone = true;
    }
    if (ltcBal > 0) ltcBal *= (1 + A.housing.ltcAnnualReturnPercent / 100);

    const withdrawal     = Math.max(0, inflatedSpend - ssIncome);
    const actualWithdraw = Math.min(withdrawal, Math.max(0, portfolioBal));
    const withdrawalRate = portfolioBal > 0 ? (actualWithdraw / portfolioBal) * 100 : 0;
    portfolioBal = portfolioBal * (1 + portReturn) - actualWithdraw;
    const exhausted = portfolioBal <= 0;
    if (portfolioBal < 0) portfolioBal = 0;

    results.push({
      age: da, phase: 'distribution',
      inflatedSpending: Math.round(inflatedSpend),
      ssIncome: Math.round(ssIncome),
      withdrawal: Math.round(actualWithdraw),
      withdrawalRate: Math.round(withdrawalRate * 10) / 10,
      portfolioBalance: Math.round(portfolioBal),
      ltcBalance: Math.round(ltcBal),
      totalWealth: Math.round(portfolioBal + ltcBal),
      exhausted,
    });
    if (exhausted) break;
  }
  return results;
}

function getAccumulation(results) { return results.filter(r => r.phase === 'accumulation'); }
function getDistribution(results) { return results.filter(r => r.phase === 'distribution'); }
function getPortfolioAtRetirement(results) {
  const pt = getAccumulation(results).at(-1);
  return pt ? pt.totalPortfolio : 0;
}
function getExhaustionAge(results) {
  const pt = getDistribution(results).find(r => r.exhausted);
  return pt ? pt.age : null;
}
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], source[key]);
    } else { target[key] = source[key]; }
  }
  return target;
}