import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { format, startOfWeek, addDays, subWeeks, addWeeks } from 'date-fns'

// =============================================================================
// PlanLogReconciliation
//
// Drop-in tab content for the admin TeacherProfile page. Shows a week-grid
// view of every timetable slot the teacher had, color-coded by reconciliation
// state. Click a cell to see the plan + log side-by-side.
//
// Four states per (date, slot) cell:
//   matched      plan exists AND log exists                 (green)
//   plan_only    plan exists, no log                        (yellow)
//   log_only     log exists, no plan                        (orange)
//   neither      slot scheduled, nothing happened           (red)
//
// Combined-class slots: any-of-N rule. The slot is "logged" if at least one
// of its className lesson records exists. (This matches Adwit's earlier
// decision on combined slot reconciliation.)
//
// Props:
//   teacherId  string  required — the teacher's docId
//   teacher    object  optional — for display, not query
// =============================================================================

const STATE_COLORS = {
  matched:   { bg: 'var(--green-light)',     border: 'var(--green-muted)',         text: 'var(--green-dark)', label: 'Plan + Log' },
  plan_only: { bg: '#fef9e7',                border: 'rgba(201,162,39,0.4)',       text: '#8a6d12',           label: 'Plan, no log' },
  log_only:  { bg: 'rgba(201,120,0,0.08)',   border: 'rgba(201,120,0,0.4)',        text: '#b85c00',           label: 'Log, no plan' },
  neither:   { bg: 'rgba(139,26,26,0.06)',   border: 'rgba(139,26,26,0.3)',        text: '#8b1a1a',           label: 'Neither' },
}

const navBtnStyle = {
  padding: '7px 12px',
  background: 'var(--white)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12,
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export default function PlanLogReconciliation({ teacherId, teacher }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [slots, setSlots] = useState([])
  const [plans, setPlans] = useState({})       // keyed by `${dateStr}|${periodId}`
  const [lessons, setLessons] = useState({})   // keyed by `${date}|${slotId}`, value is array
  const [loading, setLoading] = useState(true)
  const [selectedCell, setSelectedCell] = useState(null)

  // Load teacher's full timetable once (slot list rarely changes within a session)
  useEffect(() => {
    if (!teacherId) return
    let cancelled = false
    getDocs(query(collection(db, 'timetable'), where('teacherId', '==', teacherId)))
      .then(snap => {
        if (cancelled) return
        setSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      })
      .catch(e => console.error('reconciliation: timetable load error', e))
    return () => { cancelled = true }
  }, [teacherId])

  // Reload plans + lessons when week or teacher changes
  useEffect(() => {
    if (!teacherId) return
    let cancelled = false
    setLoading(true)
    const fromStr = format(weekStart, 'yyyy-MM-dd')
    const toStr = format(addDays(weekStart, 5), 'yyyy-MM-dd')

    Promise.all([
      // Plans: lessonPlans collection, keyed by (dateStr, periodId)
      getDocs(query(
        collection(db, 'lessonPlans'),
        where('teacherId', '==', teacherId),
        where('dateStr', '>=', fromStr),
        where('dateStr', '<=', toStr),
      )),
      // Lessons: keyed by (date, slotId). Multiple lesson docs can share
      // a slotId for combined classes — we keep them all; any-of-N rule
      // means the slot is "logged" if the list is non-empty.
      getDocs(query(
        collection(db, 'lessons'),
        where('teacherId', '==', teacherId),
        where('date', '>=', fromStr),
        where('date', '<=', toStr),
      )),
    ]).then(([plansSnap, lessonsSnap]) => {
      if (cancelled) return
      const plansByKey = {}
      plansSnap.docs.forEach(d => {
        const data = d.data()
        if (!data.periodId || !data.dateStr) return
        plansByKey[`${data.dateStr}|${data.periodId}`] = { id: d.id, ...data }
      })
      const lessonsByKey = {}
      lessonsSnap.docs.forEach(d => {
        const data = d.data()
        // Lessons without slotId (legacy unmatched, or off-schedule) bucket
        // under their own keys so they don't collide with each other but
        // also don't fill in any cell. They surface in the "unmatched"
        // count below the grid.
        const slotKey = data.slotId || `_no_slot_${d.id}`
        const k = `${data.date}|${slotKey}`
        if (!lessonsByKey[k]) lessonsByKey[k] = []
        lessonsByKey[k].push({ id: d.id, ...data })
      })
      setPlans(plansByKey)
      setLessons(lessonsByKey)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      console.error('reconciliation: plans/lessons load error', e)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [teacherId, weekStart])

  // Build the cells for the week + summary stats
  const { cells, stats, unmatchedLogs } = useMemo(() => {
    const result = []
    const seenLessonKeys = new Set()
    const weekDates = [0, 1, 2, 3, 4, 5].map(i => addDays(weekStart, i))

    weekDates.forEach((date, dayIdx) => {
      const dateStr = format(date, 'yyyy-MM-dd')
      const dayName = format(date, 'EEEE')
      const slotsForDay = slots
        .filter(s => s.day === dayName)
        .sort((a, b) => Number(a.period || 0) - Number(b.period || 0))

      slotsForDay.forEach(slot => {
        const key = `${dateStr}|${slot.id}`
        const plan = plans[key] || null
        const lessonList = lessons[key] || []
        if (lessonList.length > 0) seenLessonKeys.add(key)

        let state = 'neither'
        if (plan && lessonList.length > 0) state = 'matched'
        else if (plan) state = 'plan_only'
        else if (lessonList.length > 0) state = 'log_only'

        result.push({ key, date, dateStr, dayName, dayIdx, slot, plan, lessons: lessonList, state })
      })
    })

    // Lessons that didn't match any cell — legacy unmatched (slotId null) or
    // off-schedule. These don't get a grid cell but should be surfaced as
    // a footer count. Filter to ones in the current week range.
    const unmatched = []
    const fromStr = format(weekStart, 'yyyy-MM-dd')
    const toStr = format(addDays(weekStart, 5), 'yyyy-MM-dd')
    Object.entries(lessons).forEach(([k, arr]) => {
      const [d] = k.split('|')
      if (d < fromStr || d > toStr) return
      if (!seenLessonKeys.has(k)) {
        arr.forEach(l => unmatched.push(l))
      }
    })

    const total = result.length
    const matched = result.filter(c => c.state === 'matched').length
    const planOnly = result.filter(c => c.state === 'plan_only').length
    const logOnly = result.filter(c => c.state === 'log_only').length
    const neither = result.filter(c => c.state === 'neither').length

    return {
      cells: result,
      unmatchedLogs: unmatched,
      stats: {
        total, matched, planOnly, logOnly, neither,
        rate: total > 0 ? Math.round((matched / total) * 100) : 0,
      },
    }
  }, [slots, plans, lessons, weekStart])

  // Index cells by day for grid render
  const cellsByDay = useMemo(() => {
    const byDay = {}
    cells.forEach(c => {
      if (!byDay[c.dayIdx]) byDay[c.dayIdx] = []
      byDay[c.dayIdx].push(c)
    })
    return byDay
  }, [cells])

  const dayLabels = [0, 1, 2, 3, 4, 5].map(i => {
    const d = addDays(weekStart, i)
    return { idx: i, name: format(d, 'EEE'), date: format(d, 'MMM d') }
  })

  return (
    <div style={{ padding: '20px 4px' }}>
      {/* Week navigator + reconciliation rate */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setWeekStart(subWeeks(weekStart, 1))} style={navBtnStyle}>‹ Prev</button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            style={{ ...navBtnStyle, background: 'var(--green)', color: 'white', border: 'none' }}
          >
            This week
          </button>
          <button onClick={() => setWeekStart(addWeeks(weekStart, 1))} style={navBtnStyle}>Next ›</button>
          <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--text-muted)' }}>
            {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 5), 'MMM d, yyyy')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 30, fontWeight: 600, fontFamily: 'var(--font-display)',
              color: stats.rate >= 80 ? 'var(--green-dark)'
                  : stats.rate >= 60 ? 'var(--gold-dark)'
                  : 'var(--crimson)',
              lineHeight: 1,
            }}>
              {stats.rate}%
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Reconciliation rate
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {stats.matched} of {stats.total} slots matched
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 11, flexWrap: 'wrap' }}>
        {[
          ['matched', stats.matched],
          ['plan_only', stats.planOnly],
          ['log_only', stats.logOnly],
          ['neither', stats.neither],
        ].map(([state, count]) => {
          const c = STATE_COLORS[state]
          return (
            <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: c.bg, border: `1px solid ${c.border}`, display: 'inline-block' }} />
              <span style={{ color: c.text, fontWeight: 500 }}>{c.label}</span>
              <span style={{ color: 'var(--text-muted)' }}>{count}</span>
            </div>
          )
        })}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        </div>
      ) : stats.total === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', background: 'var(--gray-50)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)' }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>No timetable slots scheduled this week.</p>
          {unmatchedLogs.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {unmatchedLogs.length} lesson{unmatchedLogs.length > 1 ? 's' : ''} logged without a slot match (legacy or off-schedule).
            </p>
          )}
        </div>
      ) : (
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {/* Day headers */}
            {dayLabels.map(d => (
              <div key={d.idx} style={{ padding: '10px 12px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', borderRight: d.idx < 5 ? '1px solid var(--gray-100)' : 'none' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text)' }}>{d.date}</div>
              </div>
            ))}
            {/* Day columns */}
            {dayLabels.map(d => {
              const dayCells = cellsByDay[d.idx] || []
              return (
                <div key={d.idx} style={{ padding: 8, borderRight: d.idx < 5 ? '1px solid var(--gray-100)' : 'none', minHeight: 120, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dayCells.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--gray-400)', fontStyle: 'italic', padding: 4 }}>No periods</div>
                  ) : (
                    dayCells.map(cell => {
                      const c = STATE_COLORS[cell.state]
                      return (
                        <button
                          key={cell.key}
                          onClick={() => setSelectedCell(cell)}
                          style={{
                            background: c.bg,
                            border: `1px solid ${c.border}`,
                            borderRadius: 'var(--radius-sm)',
                            padding: '6px 8px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontSize: 11,
                            color: c.text,
                            fontFamily: 'inherit',
                          }}
                          title={c.label}
                        >
                          <div style={{ fontWeight: 600 }}>P{cell.slot.period}</div>
                          <div style={{ fontSize: 10.5, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cell.slot.className}
                          </div>
                          {cell.lessons.length > 1 && (
                            <div style={{ fontSize: 9.5, marginTop: 2, opacity: 0.85, fontWeight: 500 }}>
                              {cell.lessons.length}× combined
                            </div>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Unmatched logs footer */}
      {unmatchedLogs.length > 0 && stats.total > 0 && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--gold-light)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(201,162,39,0.3)', fontSize: 12, color: 'var(--gold-dark)' }}>
          <strong>{unmatchedLogs.length}</strong> lesson{unmatchedLogs.length > 1 ? 's' : ''} logged this week without matching a timetable slot
          {' '}({unmatchedLogs.filter(l => l.offSchedule).length} off-schedule, {unmatchedLogs.filter(l => !l.offSchedule).length} legacy unmatched).
          These don't count toward the reconciliation rate.
        </div>
      )}

      {/* Detail modal */}
      {selectedCell && <CellDetailModal cell={selectedCell} onClose={() => setSelectedCell(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail modal: shows plan + log(s) side-by-side, plus topic-match indicator
// ---------------------------------------------------------------------------
function CellDetailModal({ cell, onClose }) {
  const c = STATE_COLORS[cell.state]
  const { slot, plan, lessons } = cell

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', maxWidth: 720, width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                {c.label}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {cell.dayName}, {format(cell.date, 'MMM d, yyyy')}
              </span>
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)' }}>
              Period {slot.period} · {slot.className} <span style={{ color: 'var(--gold-dark)', fontWeight: 500 }}>· {slot.subject || '—'}</span>
            </h2>
            {slot.periodTime && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{slot.periodTime}</p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, marginLeft: 12 }}>×</button>
        </div>

        {/* Plan + Log columns */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Plan */}
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Lesson plan
              </div>
              {plan ? (
                <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 14, border: '1px solid var(--gray-100)' }}>
                  {Array.isArray(plan.topics) && plan.topics.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {plan.topics.map((t, i) => <li key={i} style={{ marginBottom: 3 }}>{typeof t === 'string' ? t : (t.topicName || t.name || JSON.stringify(t))}</li>)}
                    </ul>
                  ) : plan.topicNames ? (
                    <p style={{ fontSize: 13 }}>{plan.topicNames}</p>
                  ) : Array.isArray(plan.topicIds) && plan.topicIds.length > 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{plan.topicIds.length} topic{plan.topicIds.length > 1 ? 's' : ''} planned</p>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>No topics specified</p>
                  )}
                  {plan.notes && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gray-200)' }}>
                      {plan.notes}
                    </p>
                  )}
                </div>
              ) : (
                <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 14, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
                  Not planned
                </div>
              )}
            </div>

            {/* Logs */}
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Lesson log {lessons.length > 1 && `(${lessons.length} entries)`}
              </div>
              {lessons.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {lessons.map(l => (
                    <div key={l.id} style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 14, border: '1px solid var(--gray-100)' }}>
                      {lessons.length > 1 && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 4 }}>{l.className}</div>
                      )}
                      {l.topicNames ? (
                        <p style={{ fontSize: 13 }}>{l.topicNames}</p>
                      ) : (
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>No topics recorded</p>
                      )}
                      {l.notes && (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--gray-200)' }}>
                          {l.notes}
                        </p>
                      )}
                      {(l.coveringFor || l.offSchedule) && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                          {l.coveringFor && (
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(201,120,0,0.1)', color: '#b85c00', fontWeight: 600 }}>
                              cover lesson
                            </span>
                          )}
                          {l.offSchedule && (
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'var(--gold-light)', color: 'var(--gold-dark)', fontWeight: 600 }}>
                              off-schedule
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 14, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
                  Not logged
                </div>
              )}
            </div>
          </div>

          {plan && lessons.length > 0 && <TopicMatchIndicator plan={plan} lessons={lessons} />}
        </div>
      </div>
    </div>
  )
}

// Topic-match indicator. Compares the set of topicIds from the plan against
// the union of topicIds across all lesson records for this slot. Shown only
// when both sides have something to compare.
function TopicMatchIndicator({ plan, lessons }) {
  // Collect plan topic IDs from either `topicIds` array or `topics: [{id,...}]`
  const planIds = new Set([
    ...(Array.isArray(plan.topicIds) ? plan.topicIds : []),
    ...(Array.isArray(plan.topics) ? plan.topics.map(t => t?.id).filter(Boolean) : []),
  ])
  // Collect lesson topic IDs from all lesson records (combined classes)
  const lessonIds = new Set()
  lessons.forEach(l => {
    (Array.isArray(l.topicIds) ? l.topicIds : []).forEach(id => lessonIds.add(id))
  })

  if (planIds.size === 0 || lessonIds.size === 0) return null

  const intersection = [...planIds].filter(id => lessonIds.has(id))
  const matchPct = Math.round((intersection.length / planIds.size) * 100)
  const aligned = matchPct >= 50

  return (
    <div style={{
      marginTop: 16, padding: 12,
      background: aligned ? 'var(--green-light)' : 'var(--gold-light)',
      borderRadius: 'var(--radius-md)',
      border: `1px solid ${aligned ? 'var(--green-muted)' : 'rgba(201,162,39,0.3)'}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: aligned ? 'var(--green-dark)' : 'var(--gold-dark)' }}>
        {aligned ? '✓ Delivered as planned' : '⚠ Topics deviated from plan'}
        {' — '}
        {intersection.length} of {planIds.size} planned topic{planIds.size > 1 ? 's' : ''} taught
        {' '}({matchPct}%)
      </div>
    </div>
  )
}
