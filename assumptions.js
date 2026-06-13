// assumptions.js — AuraRetire data model
// Static Firebase imports — more reliable than dynamic imports across browsers.

import { doc, getDoc, setDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
    spouseCurrentAge: 49,        // ⚠ Update with actual spouse age
    inflationRate:    3.0,       // % annual
    ssColaRate:       2.5,       // % annual SS COLA
  },

  socialSecurity: {
    user: {
      benefitAt67:  3278,        // $/month (actual SSA estimate)
      benefitAt70:  4186,        // $/month (actual SSA estimate)
      claimAge:     67,          // default; toggle to 70 to compare
    },
    spouse: {
      claimAge:       62,
      monthlyBenefit: 1250,      // $/month estimated
    }
  },

  income: {
    currentSalary:        126300,
    annualRaisePercent:   3.0,
    additionalRaises: [
      { atAge: 52, percent: 8.0 },
      { atAge: 58, percent: 8.0 },
    ]
  },

  k401: {
    currentBalance:                   235000,
    contributionPercent:              8.0,
    contributionIncreaseAtAge:        53,
    contributionPercentAfterIncrease: 10.0,
    employerMatchPercent:             50.0,
    employerMatchCapPercent:          6.0,
    returnPhases: [
      { fromAge: 49.5, toAge: 55,  annualReturnPercent: 8.0 },
      { fromAge: 55,   toAge: 100, annualReturnPercent: 6.0 },
    ]
  },

  brokerage: {
    currentBalance:      0,
    monthlyContribution: 1000,
    scheduledChanges: [
      { ageAtEvent: 50.83, lumpSum: 50000, newMonthlyContribution: 1500 }
    ],
    returnPhases: [
      { fromAge: 49.5, toAge: 58,  annualReturnPercent: 8.0 },
      { fromAge: 58,   toAge: 100, annualReturnPercent: 6.0 },
    ]
  },

  cash: {
    currentBalance: 67000,
  },

  housing: {
    currentHomeValue:       650000,
    homeSaleAge:            66,
    futureSaleValue:        750000,
    downsizePurchasePrice:  500000,
    ltcReserve:             250000,
    liquidityReserve:       50000,
    ltcAnnualReturnPercent: 4.0,
  },

  retirement: {
    targetAnnualSpendingToday:    70000,
    portfolioReturnPercent:       5.0,
    targetWithdrawalRatePercent:  3.75,
  },

  monteCarlo: {
    numSimulations:                    1000,
    accumulationReturnStdDevPercent:   12.0,
    distributionReturnStdDevPercent:   8.0,
    inflationStdDevPercent:            1.0,
  }

};

// ─── Load from Firestore (falls back to DEFAULTS) ────────────────────────────
export async function loadAssumptions() {
  if (!_db || !_uid) return structuredClone(DEFAULTS);
  try {
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
  await setDoc(doc(_db, 'users', _uid, 'data', 'assumptions'), assumptions);
}

// ─── Deep merge helper ────────────────────────────────────────────────────────
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}