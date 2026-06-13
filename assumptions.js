// assumptions.js — AuraRetire data model
// All defaults loaded from Rob's June 2026 retirement planning assumptions.
// Values stored as plain numbers (%, $, ages) — no unit conversions in here.

// ─── Firestore handles ────────────────────────────────────────────────────────
let _db  = null;
let _uid = null;

export function initAssumptions(db, uid) {
  _db  = db;
  _uid = uid;
}

// ─── Defaults (Rob's 2026 model) ─────────────────────────────────────────────
export const DEFAULTS = {

  profile: {
    currentAge:       49.5,
    retirementAge:    63,
    lifeExpectancy:   90,
    spouseCurrentAge: 49,        // ⚠ Update with actual spouse age for accurate SS timing
    inflationRate:    3.0,       // % annual
    ssColaRate:       2.5,       // % annual SS cost-of-living adjustment
  },

  socialSecurity: {
    user: {
      benefitAt67:  3278,        // $/month (actual SSA estimate)
      benefitAt70:  4186,        // $/month (actual SSA estimate)
      claimAge:     67,          // default; toggle to 70 to compare
    },
    spouse: {
      claimAge:       62,
      monthlyBenefit: 1250,      // $/month estimated — update when SSA statement available
    }
  },

  income: {
    currentSalary:        126300,   // $
    annualRaisePercent:   3.0,      // % per year
    additionalRaises: [
      { atAge: 52, percent: 8.0 }, // +8% at age 52
      { atAge: 58, percent: 8.0 }, // +8% at age 58
    ]
  },

  k401: {
    currentBalance:                   235000,   // $
    contributionPercent:              8.0,       // % of salary
    contributionIncreaseAtAge:        53,
    contributionPercentAfterIncrease: 10.0,      // % of salary after age 53
    employerMatchPercent:             50.0,      // employer matches 50% of employee contribution
    employerMatchCapPercent:          6.0,       // employer match capped at 6% of salary
    returnPhases: [
      { fromAge: 49.5, toAge: 55,  annualReturnPercent: 8.0 }, // 87/13 equity/bond
      { fromAge: 55,   toAge: 100, annualReturnPercent: 6.0 }, // glide to 65/35
    ]
  },

  brokerage: {
    currentBalance:    0,          // $
    monthlyContribution: 1000,     // $/month starting immediately
    scheduledChanges: [
      // October 2027 ≈ age 50.83: $50k lump sum + increase to $1,500/month
      {
        ageAtEvent:              50.83,
        lumpSum:                 50000,
        newMonthlyContribution:  1500,
      }
    ],
    returnPhases: [
      { fromAge: 49.5, toAge: 58,  annualReturnPercent: 8.0 },
      { fromAge: 58,   toAge: 100, annualReturnPercent: 6.0 },
    ]
  },

  cash: {
    currentBalance: 67000,         // $ — emergency reserve, not modeled as invested
  },

  housing: {
    currentHomeValue:       650000,
    homeSaleAge:            66,    // midpoint of expected sale window 65-67
    futureSaleValue:        750000, // $ real dollars
    downsizePurchasePrice:  500000, // $
    ltcReserve:             250000, // $ from net proceeds → long-term care reserve
    liquidityReserve:       50000,  // $ from net proceeds → added to portfolio
    ltcAnnualReturnPercent: 4.0,    // % return on LTC reserve (conservative)
  },

  retirement: {
    targetAnnualSpendingToday:    70000,   // $ in today's dollars
    portfolioReturnPercent:       5.0,     // % nominal return on portfolio in retirement
    targetWithdrawalRatePercent:  3.75,    // % target — used as a reference metric
  },

  monteCarlo: {
    numSimulations:                    1000,
    accumulationReturnStdDevPercent:   12.0,  // % std dev for return randomization during accumulation
    distributionReturnStdDevPercent:   8.0,   // % std dev during distribution
    inflationStdDevPercent:            1.0,   // % std dev on inflation
  }

};

// ─── Load from Firestore (falls back to DEFAULTS) ────────────────────────────
export async function loadAssumptions() {
  if (!_db || !_uid) return structuredClone(DEFAULTS);

  try {
    const { doc, getDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snap = await getDoc(doc(_db, 'users', _uid, 'data', 'assumptions'));
    if (snap.exists()) {
      return deepMerge(structuredClone(DEFAULTS), snap.data());
    }
  } catch (err) {
    console.warn('[AuraRetire] Firestore load failed, using defaults:', err.message);
  }
  return structuredClone(DEFAULTS);
}

// ─── Save to Firestore ────────────────────────────────────────────────────────
export async function saveAssumptions(assumptions) {
  if (!_db || !_uid) throw new Error('Not authenticated');

  const { doc, setDoc } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  await setDoc(
    doc(_db, 'users', _uid, 'data', 'assumptions'),
    assumptions
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
