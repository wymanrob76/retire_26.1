// montecarlo.js — plain script, uses phaseRate from projection.js

function randn(mean, sd) {
  let u, v;
  do { u = Math.random(); v = Math.random(); } while (u === 0);
  return mean + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
}

function runMonteCarlo(A) {
  const N      = A.monteCarlo.numSimulations || 1000;
  const accSd  = A.monteCarlo.accumulationReturnStdDevPercent  / 100;
  const distSd = A.monteCarlo.distributionReturnStdDevPercent  / 100;
  const inflSd = A.monteCarlo.inflationStdDevPercent           / 100;

  let successes = 0;
  const finalWealth  = [];
  const retireWealth = [];

  for (let i = 0; i < N; i++) {
    const r = simulateOnce(A, accSd, distSd, inflSd);
    if (!r.exhausted) successes++;
    finalWealth.push(r.finalWealth);
    retireWealth.push(r.portfolioAtRetirement);
  }

  finalWealth.sort((a, b)  => a - b);
  retireWealth.sort((a, b) => a - b);

  return {
    successRate: Math.round((successes / N) * 100),
    numSimulations: N,
    finalWealth: {
      p10: finalWealth[Math.floor(N * 0.10)],
      p25: finalWealth[Math.floor(N * 0.25)],
      median: finalWealth[Math.floor(N * 0.50)],
      p75: finalWealth[Math.floor(N * 0.75)],
      p90: finalWealth[Math.floor(N * 0.90)],
    },
    retireWealth: {
      p10:    retireWealth[Math.floor(N * 0.10)],
      median: retireWealth[Math.floor(N * 0.50)],
      p90:    retireWealth[Math.floor(N * 0.90)],
    },
  };
}

function simulateOnce(A, accSd, distSd, inflSd) {
  const currentAge   = A.profile.currentAge;
  const retireAge    = A.profile.retirementAge;
  const lifeExp      = A.profile.lifeExpectancy;
  const baseInfl     = A.profile.inflationRate / 100;
  const ssColaRate   = A.profile.ssColaRate    / 100;

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

    const k401Rate = Math.max(-0.5, randn(phaseRate(age, A.k401.returnPhases) / 100, accSd));
    const brokRate = Math.max(-0.5, randn(phaseRate(age, A.brokerage.returnPhases) / 100, accSd));
    const k401Pct  = (age < A.k401.contributionIncreaseAtAge
      ? A.k401.contributionPercent : A.k401.contributionPercentAfterIncrease) / 100;
    k401Bal = k401Bal * Math.pow(1 + k401Rate, yr)
            + salary * k401Pct * yr
            + salary * Math.min(k401Pct, A.k401.employerMatchCapPercent / 100) * (A.k401.employerMatchPercent / 100) * yr;

    let lumpSum = 0;
    for (const [i, ch] of changes.entries()) {
      if (!changesApplied.has(i) && stepStart < ch.ageAtEvent && stepEnd >= ch.ageAtEvent) {
        lumpSum += ch.lumpSum || 0;
        if (ch.newMonthlyContribution != null) monthlyBrok = ch.newMonthlyContribution;
        changesApplied.add(i);
      }
    }
    brokerageBal = brokerageBal * Math.pow(1 + brokRate, yr) + monthlyBrok * 12 * yr + lumpSum;
    age = stepEnd;
  }

  const portfolioAtRetirement = k401Bal + brokerageBal;
  const baseSpend    = A.retirement.targetAnnualSpendingToday;
  const portReturn   = A.retirement.portfolioReturnPercent / 100;
  const userSSAge    = A.socialSecurity.user.claimAge;
  const userSSYearly = (userSSAge === 67 ? A.socialSecurity.user.benefitAt67 : A.socialSecurity.user.benefitAt70) * 12;
  const spouseSSYearly  = A.socialSecurity.spouse.monthlyBenefit * 12;
  const spouseClaimAge  = A.socialSecurity.spouse.claimAge;
  const spouseStartAge  = A.profile.spouseCurrentAge;

  let portfolioBal  = portfolioAtRetirement;
  let ltcBal        = 0;
  let homeEventDone = false;
  let exhausted     = false;

  for (let da = retireAge; da <= lifeExp; da++) {
    const yearsFromNow  = da - currentAge;
    const thisInfl      = Math.max(0, randn(baseInfl, inflSd));
    const thisPortRet   = Math.max(-0.5, randn(portReturn, distSd));
    const inflatedSpend = baseSpend * Math.pow(1 + thisInfl, yearsFromNow);

    let ssIncome = 0;
    if (da >= userSSAge) ssIncome += userSSYearly * Math.pow(1 + ssColaRate, da - userSSAge);
    const spouseAgeNow = spouseStartAge + yearsFromNow;
    if (spouseAgeNow >= spouseClaimAge)
      ssIncome += spouseSSYearly * Math.pow(1 + ssColaRate, Math.max(0, spouseAgeNow - spouseClaimAge));

    if (!homeEventDone && da >= A.housing.homeSaleAge) {
      ltcBal += A.housing.ltcReserve;
      portfolioBal += A.housing.liquidityReserve;
      homeEventDone = true;
    }
    if (ltcBal > 0) ltcBal *= (1 + A.housing.ltcAnnualReturnPercent / 100);

    const withdraw = Math.max(0, Math.min(inflatedSpend - ssIncome, portfolioBal));
    portfolioBal   = portfolioBal * (1 + thisPortRet) - withdraw;
    if (portfolioBal <= 0) { exhausted = true; break; }
  }

  return { exhausted, portfolioAtRetirement, finalWealth: Math.max(0, portfolioBal) + ltcBal };
}