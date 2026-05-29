// ============================================================================
// admin/src/lib/reportCardRemark.js
//
// Pure (no-network) port of SMS src/lib/reportCards.js — CBSE grading + the
// rule-based teacher-remark generator. Takes a `card` object (as returned by
// /api/exam/report-card) and a tone, returns a 4–6 sentence remark.
// ============================================================================

const CBSE_GRADES = [
  { min: 91, grade: 'A1', point: 10 }, { min: 81, grade: 'A2', point: 9 },
  { min: 71, grade: 'B1', point: 8 },  { min: 61, grade: 'B2', point: 7 },
  { min: 51, grade: 'C1', point: 6 },  { min: 41, grade: 'C2', point: 5 },
  { min: 33, grade: 'D',  point: 4 },  { min: 0,  grade: 'E',  point: 0 },
]
export function gradeFor(pct) {
  if (pct == null || isNaN(pct)) return null
  for (const g of CBSE_GRADES) if (pct >= g.min) return g
  return CBSE_GRADES[CBSE_GRADES.length - 1]
}

export const TONE_PRESETS = [
  { value: 'formal', label: 'Formal',  description: 'Neutral, professional, third-person.' },
  { value: 'warm',   label: 'Warm',    description: 'Encouraging, personal — works well for primary classes.' },
  { value: 'strict', label: 'Strict',  description: 'Direct, demanding — flags issues plainly.' },
]

const PRONOUNS = {
  Male:   { subj: 'He',          poss: 'his',   obj: 'him'  },
  Female: { subj: 'She',         poss: 'her',   obj: 'her'  },
  Other:  { subj: 'They',        poss: 'their', obj: 'them' },
  null:   { subj: 'The student', poss: 'their', obj: 'them' },
}
function pronounsFor(gender) { return PRONOUNS[gender] || PRONOUNS.null }

function formatList(items) {
  if (!items?.length) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

const TEMPLATES = {
  formal: {
    openOutstanding:  (n)    => `${n} has had an outstanding year, demonstrating exceptional command across all subjects.`,
    openStrong:       (n)    => `${n} is a strong and dedicated learner, consistently performing well throughout the year.`,
    openSteady:       (n, p) => `${n} is a good student who shows steady engagement with ${p.poss} studies.`,
    openSatisfactory: (n)    => `${n} has had a satisfactory year and shows promise with greater effort.`,
    openNeedsHelp:    (n, p) => `${n} requires additional support and is encouraged to engage with ${p.poss} teachers regularly.`,
    strengths:  (p, subjects) => `${p.subj} has shown particular strength in ${subjects}.`,
    weaknesses: (n, subjects) => `More focused effort is needed in ${subjects} next year.`,
    slightWeak: (p, s)        => `With slightly more deliberate practice in ${s}, ${p.subj.toLowerCase()} can perform even better.`,
    improving:  () => `There is clear improvement from the start of the session to the end.`,
    declining:  () => `Performance has dipped since the start of the session — this calls for renewed focus.`,
    coScho:     (p, areas) => `${p.subj} also stands out in ${areas}.`,
    attLow:     (pct) => `Attendance at ${pct}% needs urgent improvement; regular school presence is essential.`,
    attHigh:    () => `Excellent attendance throughout the year is also commendable.`,
    closingGood:() => `Keep up the good work.`,
    closingBad: () => `With consistent effort and support from parents, the coming year holds great promise.`,
  },
  warm: {
    openOutstanding:  (n)    => `We're so proud of ${n} — a fantastic year of growth and achievement across the board.`,
    openStrong:       (n)    => `${n} is a wonderful, hard-working student who has done really well this year.`,
    openSteady:       (n, p) => `${n} is a sincere learner who engages thoughtfully with ${p.poss} lessons.`,
    openSatisfactory: (n)    => `${n} has shown good effort this year and has plenty to be proud of.`,
    openNeedsHelp:    (n, p) => `${n} has been giving it ${p.poss} best — with a little more practice and support, the year ahead looks promising.`,
    strengths:  (p, subjects) => `${p.subj} has a particular flair for ${subjects}, and it shows in ${p.poss} work.`,
    weaknesses: (n, subjects) => `We'd love to see a bit more time spent on ${subjects} next year.`,
    slightWeak: (p, s)        => `A small extra push in ${s} would round things out beautifully.`,
    improving:  () => `It has been lovely to watch the growth from the start of the year to now.`,
    declining:  () => `We've noticed a dip lately — let's work together to bring back the spark.`,
    coScho:     (p, areas) => `${p.subj} truly shines in ${areas}.`,
    attLow:     () => `We would love to see more of you in school — every day really does matter.`,
    attHigh:    () => `The dedication to attendance has been wonderful to see.`,
    closingGood:() => `Keep being your wonderful self!`,
    closingBad: () => `Wishing a brilliant year ahead — we are cheering for you.`,
  },
  strict: {
    openOutstanding:  (n) => `${n} has met the school's expectations exceptionally well this year.`,
    openStrong:       (n) => `${n} is a serious student whose discipline shows in the results.`,
    openSteady:       (n) => `${n}'s performance is acceptable but capable of more.`,
    openSatisfactory: (n) => `${n}'s results indicate room for considerable improvement next year.`,
    openNeedsHelp:    (n) => `${n}'s performance is below the required standard. Immediate corrective action is necessary.`,
    strengths:  (p, subjects) => `${p.subj} demonstrates command of ${subjects}.`,
    weaknesses: (n, subjects) => `${n} must focus seriously on ${subjects} next year. No further drop is acceptable.`,
    slightWeak: (p, s)        => `${p.subj} is expected to improve in ${s}.`,
    improving:  () => `The improvement curve is in the right direction. Maintain it.`,
    declining:  () => `Performance has fallen since the start of the session. This must be reversed.`,
    coScho:     (p, areas) => `${p.subj} also performs well in ${areas}.`,
    attLow:     (pct) => `Attendance at ${pct}% is unacceptable. Regular presence is mandatory.`,
    attHigh:    () => `Attendance has been consistent — as expected.`,
    closingGood:() => `Continue with the same discipline.`,
    closingBad: (n) => `${n} must commit to substantially higher effort. Parents are advised to monitor closely.`,
  },
}

export function generateRemark(card, options = {}) {
  if (!card?.student || !card.overall) return ''
  const pct = card.overall.pct
  if (pct == null) return ''

  const tone = TONE_PRESETS.find((t) => t.value === options.tone)?.value || 'formal'
  const t = TEMPLATES[tone]
  const firstName = String(card.student.full_name || '').split(' ')[0] || 'The student'
  const p = pronounsFor(card.student.gender)
  const out = []

  if      (pct >= 90) out.push(t.openOutstanding(firstName))
  else if (pct >= 75) out.push(t.openStrong(firstName))
  else if (pct >= 60) out.push(t.openSteady(firstName, p))
  else if (pct >= 45) out.push(t.openSatisfactory(firstName))
  else                out.push(t.openNeedsHelp(firstName, p))

  const subjects = (card.grid || [])
    .filter((r) => r.total.max > 0)
    .map((r) => ({ name: r.subject.subject_name, pct: 100 * r.total.obtained / r.total.max }))
    .sort((a, b) => b.pct - a.pct)
  if (subjects.length >= 2 && subjects[0].pct >= 80) {
    out.push(t.strengths(p, formatList(subjects.slice(0, 2).map((s) => s.name))))
  }

  const failing = subjects.filter((s) => s.pct < 45)
  if (failing.length >= 1) {
    out.push(t.weaknesses(firstName, formatList(failing.slice(0, 2).map((s) => s.name))))
  } else if (subjects.length && subjects[subjects.length - 1].pct < 65 && pct >= 60) {
    out.push(t.slightWeak(p, subjects[subjects.length - 1].name))
  }

  const tT1  = (card.terms || []).find((x) => x.short_code === 'T1')
  const tAnn = (card.terms || []).find((x) => x.short_code === 'AN')
  if (tT1 && tAnn && card.grid?.length) {
    let t1O = 0, t1M = 0, anO = 0, anM = 0
    for (const row of card.grid) {
      const c1 = row.byTerm[tT1.id], cA = row.byTerm[tAnn.id]
      if (c1?.marks != null) { t1O += Number(c1.marks); t1M += Number(c1.max) }
      if (cA?.marks != null) { anO += Number(cA.marks); anM += Number(cA.max) }
    }
    if (t1M && anM) {
      const delta = (100 * anO / anM) - (100 * t1O / t1M)
      if (delta > 5) out.push(t.improving())
      else if (delta < -5) out.push(t.declining())
    }
  }

  const topCo = (card.coScholastic || []).filter((c) => /^A\+?$/i.test(String(c.grade || '').trim()))
  if (topCo.length >= 2) out.push(t.coScho(p, formatList(topCo.slice(0, 2).map((c) => c.name))))

  const attPct = card.attendance?.attendance_pct
  if (attPct != null) {
    if (attPct < 75) out.push(t.attLow(attPct))
    else if (attPct >= 95 && pct >= 70) out.push(t.attHigh())
  }

  if (pct >= 70) out.push(t.closingGood())
  else           out.push(t.closingBad(firstName))

  return out.join(' ')
}
