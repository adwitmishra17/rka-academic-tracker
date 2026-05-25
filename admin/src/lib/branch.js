// ============================================================================
// BRANCH
//
// Branch-awareness primitives. Single source of truth for:
//   - the two valid branch codes
//   - the localStorage key holding the user's last-selected branch
//   - helpers for normalising / persisting branch selections
//
// Higher-level branch *context* (which branches the current user is allowed
// to see, what's currently selected) lives in src/App.jsx via useAuth().
//
// Sister module: src/lib/branchQuery.js — Firestore query constraint helpers.
// ============================================================================

export const BRANCHES = [
  { code: 'MAIN', label: 'Main Campus', sub: 'Sawarubandh / Akhar' },
  { code: 'CITY', label: 'City Branch', sub: 'Japlinganj' },
]

export const BRANCH_CODES = BRANCHES.map(b => b.code)

// Distinct from HRMS's key — they share Firebase auth but UI state is per-app.
const LS_KEY = 'rka-tracker-current-branch'

/**
 * Read the user's last-selected branch from localStorage.
 *
 *   'MAIN' or 'CITY'  →  branch code
 *   'ALL'             →  null (user explicitly chose All Branches)
 *   missing/invalid   →  null (first sign-in or corrupted)
 */
export function readStoredBranch() {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v === 'ALL') return null
    if (BRANCH_CODES.includes(v)) return v
    return null
  } catch {
    return null
  }
}

export function writeStoredBranch(branchCode) {
  try {
    localStorage.setItem(LS_KEY, branchCode === null ? 'ALL' : branchCode)
  } catch { /* localStorage unavailable — fine */ }
}

/**
 * Resolve what currentBranch should actually be given a desired value
 * and the user's allowed branches. Defensive: a stale value (e.g. user
 * was demoted from super admin) is silently corrected.
 */
export function resolveBranch(desired, allowedBranches) {
  if (!allowedBranches || allowedBranches.length === 0) return null
  if (allowedBranches.length === 1) return allowedBranches[0]
  if (desired === null) return null
  if (allowedBranches.includes(desired)) return desired
  return null
}

/**
 * Compute the set of branches a query should actually filter by.
 *   currentBranch === null  →  all allowed (super admin viewing All)
 *   currentBranch is set    →  just that one
 */
export function effectiveBranches(currentBranch, allowedBranches) {
  if (currentBranch === null) return allowedBranches
  return [currentBranch]
}

export function branchLabel(code) {
  if (code === null) return 'All Branches'
  return BRANCHES.find(b => b.code === code)?.label || code
}
