// ============================================================================
// BRANCH QUERY HELPERS — Firestore
//
// Returns spreadable arrays of Firestore query constraints (one or zero
// constraints) for branch filtering. Designed for the tracker's Firestore
// queries, where constraints are passed as positional args to query():
//
//   const q = query(
//     collection(db, 'students'),
//     ...branchConstraints('branchCode', effectiveBranches),
//     where('classId', '==', selectedClassId),
//   )
//
// Why a function returning an array instead of a single constraint?
//
//   1. When effectiveBranches covers all branches (super admin on All), no
//      filter is needed — Firestore charges a read per matched value when
//      using `in`, so skipping the constraint halves quota usage on All.
//
//   2. When effectiveBranches has exactly one element, we use the cheaper
//      `==` operator instead of `in`.
//
//   3. Spread syntax (...branchConstraints(...)) keeps page code clean
//      whether the result is empty, a single ==, or an `in`.
//
// Firestore caveat: Firestore allows at most ONE of these per query:
//   `in`, `not-in`, `array-contains-any`, `array-contains`, `!=`
// So if a query already uses one of those for a different field, you can't
// also use one here. The optimisation above (skip-on-All) helps avoid that.
// ============================================================================

import { where } from 'firebase/firestore'
import { BRANCH_CODES } from './branch'

/**
 * Constraints for a scalar branchCode field.
 *
 *   effectiveBranches=[]                → match nothing (defensive)
 *   effectiveBranches covers all        → []        (no filter needed)
 *   effectiveBranches=['MAIN']          → [where('branchCode','==','MAIN')]
 *   effectiveBranches=['MAIN','CITY']   → [] (covered by 'all' branch above)
 *
 * Use for: classes, students, lessons, lessonPlans, tests, testMarks,
 * timetable, arrangements, missedLessonAlerts.
 */
export function branchConstraints(field, effectiveBranches) {
  if (!effectiveBranches || effectiveBranches.length === 0) {
    // Defensive: impossible value matches no rows
    return [where(field, '==', '__no_access__')]
  }
  if (effectiveBranches.length >= BRANCH_CODES.length) {
    // User can see all branches — no filter needed (saves Firestore reads)
    return []
  }
  if (effectiveBranches.length === 1) {
    // Single branch — use cheap == operator
    return [where(field, '==', effectiveBranches[0])]
  }
  // 2+ specific branches (only if BRANCH_CODES expands later)
  return [where(field, 'in', effectiveBranches)]
}

/**
 * Constraints for an array branchCodes field. Returns rows where the
 * array overlaps with effectiveBranches.
 *
 * Use for: teachers (which can cover both campuses on alternate days).
 */
export function branchConstraintsArray(field, effectiveBranches) {
  if (!effectiveBranches || effectiveBranches.length === 0) {
    return [where(field, 'array-contains', '__no_access__')]
  }
  if (effectiveBranches.length >= BRANCH_CODES.length) {
    return []
  }
  if (effectiveBranches.length === 1) {
    // Cheaper than array-contains-any with a one-element array
    return [where(field, 'array-contains', effectiveBranches[0])]
  }
  return [where(field, 'array-contains-any', effectiveBranches)]
}

/**
 * Defensive single-record check after a getDoc(). Returns true if the
 * record's branchCode is accessible to the current user. Use to prevent
 * URL-tampering across branches:
 *
 *   const snap = await getDoc(doc(db, 'students', studentId))
 *   if (!isAccessible(snap.data().branchCode, effectiveBranches)) {
 *     navigate('/students')
 *     return
 *   }
 */
export function isAccessible(branchCode, effectiveBranches) {
  if (!branchCode) return false
  return effectiveBranches.includes(branchCode)
}

/**
 * Same idea for array branchCodes (teachers).
 */
export function isAccessibleArray(branchCodes, effectiveBranches) {
  if (!Array.isArray(branchCodes) || branchCodes.length === 0) return false
  return branchCodes.some(b => effectiveBranches.includes(b))
}
