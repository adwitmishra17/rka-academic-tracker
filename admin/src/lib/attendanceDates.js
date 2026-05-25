// =========================================================================
// attendanceDates.js — date helpers for the attendance system
//
// All dates are YYYY-MM-DD strings in IST (Asia/Kolkata).
// The school operates entirely in IST, so we don't need timezone gymnastics —
// just be consistent about always formatting in IST.
// =========================================================================

const IST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric', month: '2-digit', day: '2-digit',
})

// Format a Date object as YYYY-MM-DD in IST
export function toISTDateStr(d = new Date()) {
  return IST_FORMATTER.format(d)   // en-CA gives "2026-05-13"
}

// Today's YYYY-MM-DD in IST
export function todayIST() {
  return toISTDateStr(new Date())
}

// Returns YYYY-MM-DD for n days ago (n=0 is today, n=1 is yesterday)
export function dateNDaysAgoIST(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toISTDateStr(d)
}

// Day-of-week (0=Sun, 6=Sat) for a YYYY-MM-DD string interpreted in IST
export function dayOfWeekFromDateStr(dateStr) {
  // Parsing YYYY-MM-DD always interprets as UTC midnight; that's fine because
  // it's a date-only concept and dayOfWeek doesn't change by timezone.
  const d = new Date(dateStr + 'T00:00:00')
  return d.getDay()
}

export function isSunday(dateStr) {
  return dayOfWeekFromDateStr(dateStr) === 0
}

// Returns array of last 7 dates including today, newest first
// e.g. ['2026-05-13', '2026-05-12', ..., '2026-05-07']
export function lastSevenDays() {
  return Array.from({ length: 7 }, (_, i) => dateNDaysAgoIST(i))
}

// Friendly label like "Today (Wed, May 13)" or "Yesterday (Tue, May 12)" or "Mon, May 11"
export function friendlyDateLabel(dateStr) {
  const today = todayIST()
  const d = new Date(dateStr + 'T00:00:00')
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (dateStr === today) return `Today (${dayName}, ${monthDay})`
  if (dateStr === dateNDaysAgoIST(1)) return `Yesterday (${dayName}, ${monthDay})`
  return `${dayName}, ${monthDay}`
}

// Returns true if `dateStr` is within the teacher edit window (today or last 7 days)
export function isWithinTeacherEditWindow(dateStr) {
  return lastSevenDays().includes(dateStr)
}
