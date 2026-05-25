// Cascade reschedule engine — pure function, no I/O.
// Takes plans to shift + timetable + session boundary; returns resolved mappings
// and dropped plans (cascade exceeded session end).

import { format, addDays, parseISO } from 'date-fns'

// Skip Sundays automatically. Pass a Set/array of YYYY-MM-DD holiday strings to also skip.
function nextWorkingDate(dateStr, holidays = new Set()) {
  let d = addDays(parseISO(dateStr), 1)
  while (d.getDay() === 0 || holidays.has(format(d, 'yyyy-MM-dd'))) {
    d = addDays(d, 1)
  }
  return format(d, 'yyyy-MM-dd')
}

function dayName(dateStr) {
  try { return format(parseISO(dateStr), 'EEEE') } catch { return '' }
}

function weekStart(dateStr) {
  try {
    const d = parseISO(dateStr)
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    return format(addDays(d, diff), 'yyyy-MM-dd')
  } catch { return dateStr }
}

/**
 * Given a plan, walk forward day by day looking for a matching slot in the timetable.
 * Returns { newDate, newSlotId, candidateDayName } or null if exhausted.
 */
function findNextSlot({ plan, fromDate, timetableByDay, sessionEnd, holidays, matchPeriod }) {
  // Returns the first matching slot (free or occupied) — caller decides whether to evict.
  // Returns null if no matching slot exists in the entire forward range.
  let candidate = nextWorkingDate(fromDate, holidays)
  let safety = 200
  while (safety-- > 0) {
    if (sessionEnd && candidate > sessionEnd) return null
    const day = dayName(candidate)
    const slots = timetableByDay[day] || []
    const candidates = slots.filter(s =>
      s.className === plan.className &&
      s.subject === plan.subject &&
      (!matchPeriod || Number(s.period) === Number(plan.period))
    )
    if (candidates.length > 0) {
      // Pick the lowest-period slot when multiple match (deterministic)
      candidates.sort((a, b) => Number(a.period || 0) - Number(b.period || 0))
      const slot = candidates[0]
      return { newDate: candidate, newSlotId: slot.id, slot, candidateDayName: day }
    }
    candidate = nextWorkingDate(candidate, holidays)
  }
  return null
}

/**
 * Cascade-shift a list of plans forward.
 *
 * @param {Object} params
 * @param {Array}  params.plansToShift - the plans the admin explicitly chose to move
 * @param {Array}  params.allTeacherPlans - every active plan for this teacher (used to detect collisions)
 * @param {Array}  params.timetable - teacher's timetable slots
 * @param {string} params.fromDate - earliest date the cascade may use
 * @param {string} [params.sessionEnd] - 'YYYY-MM-DD' end of session; plans pushed past this are dropped
 * @param {Set<string>} [params.holidays] - holiday dates to skip (in addition to Sundays)
 * @param {boolean} [params.matchPeriod=true] - require same period number for a match
 * @param {boolean} [params.cascade=true] - if false, refuse on any collision
 * @returns {{ resolved: Array, dropped: Array, refused: Array }}
 *   resolved: [{ plan, newDate, newSlotId, slot, evictedPlan? }]
 *   dropped: [{ plan, reason }]
 *   refused: [{ plan, reason }] (only when cascade=false and a collision was hit)
 */
export function cascadeShift({
  plansToShift,
  allTeacherPlans,
  timetable,
  fromDate,
  sessionEnd = null,
  holidays = new Set(),
  matchPeriod = true,
  cascade = true,
}) {
  // Group timetable by day
  const timetableByDay = {}
  for (const s of timetable || []) {
    if (!timetableByDay[s.day]) timetableByDay[s.day] = []
    timetableByDay[s.day].push(s)
  }

  // Track occupied (date, slotId) pairs — start with all current active plans
  const occupiedKeys = new Set()
  const planByKey = {}
  for (const p of allTeacherPlans || []) {
    if (p.status === 'superseded') continue
    if (!p.dateStr || !p.periodId) continue
    const key = `${p.dateStr}_${p.periodId}`
    occupiedKeys.add(key)
    planByKey[key] = p
  }

  // The set of plan IDs being moved (and so being released from their original slots)
  const movingPlanIds = new Set(plansToShift.map(p => p.id))

  // Release the slots of plans being explicitly moved
  for (const p of plansToShift) {
    if (!p.dateStr || !p.periodId) continue
    const key = `${p.dateStr}_${p.periodId}`
    occupiedKeys.delete(key)
  }

  // Process plans in order: latest first, so cascading later plans doesn't repeatedly evict earlier ones
  const queue = [...plansToShift].sort((a, b) => {
    if (a.dateStr !== b.dateStr) return b.dateStr.localeCompare(a.dateStr)
    return Number(b.period || 0) - Number(a.period || 0)
  })

  const resolved = []
  const dropped = []
  const refused = []

  // Cascade depth counter to prevent runaway
  let safety = 500

  while (queue.length > 0 && safety-- > 0) {
    const plan = queue.shift()

    // Where to start looking — at least fromDate if this is the original; otherwise day after the plan's existing date
    const baseFrom = plan.dateStr < fromDate ? fromDate : plan.dateStr
    const found = findNextSlot({
      plan,
      fromDate: baseFrom,
      timetableByDay,
      sessionEnd,
      holidays,
      matchPeriod,
    })

    if (!found) {
      // Walk forward until session end and check if any matching slot existed but was always taken
      // (vs no matching slot at all)
      dropped.push({
        plan,
        reason: sessionEnd
          ? `No matching slot found on or before ${sessionEnd}`
          : `No matching slot found in teacher's timetable`,
      })
      continue
    }

    const targetKey = `${found.newDate}_${found.newSlotId}`

    // Is the target slot currently occupied by a non-moving plan?
    // Note: occupiedKeys was already stripped of moving plans' original keys above
    // But it still contains slots occupied by OTHER active plans that weren't selected for shifting
    const existingPlan = planByKey[targetKey]
    const isOccupied = existingPlan && !movingPlanIds.has(existingPlan.id)

    if (isOccupied) {
      if (!cascade) {
        refused.push({
          plan,
          reason: `Target slot ${found.newDate} P${found.slot.period} is occupied`,
        })
        continue
      }
      // Evict the existing plan — push it into the queue to find its own new home
      queue.push(existingPlan)
      movingPlanIds.add(existingPlan.id)
      // Free its current slot
      const existingKey = `${existingPlan.dateStr}_${existingPlan.periodId}`
      occupiedKeys.delete(existingKey)
      // Mark the resolved plan's source slot as free already (was already, but safe)
      occupiedKeys.add(targetKey)
      resolved.push({
        plan,
        newDate: found.newDate,
        newSlotId: found.newSlotId,
        slot: found.slot,
        evictedPlanId: existingPlan.id,
      })
    } else {
      // Free landing
      occupiedKeys.add(targetKey)
      resolved.push({
        plan,
        newDate: found.newDate,
        newSlotId: found.newSlotId,
        slot: found.slot,
      })
    }
  }

  return { resolved, dropped, refused }
}

// Helpers for callers
export const cascadeUtils = {
  weekStart,
  dayName,
  nextWorkingDate,
}
