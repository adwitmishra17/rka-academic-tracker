import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, query, where, doc, getDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { format, startOfWeek, addDays, subWeeks, addWeeks, isToday, isBefore, startOfDay } from 'date-fns'

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const DEFAULT_FIELDS = [
  { id:'topics', label:'Topics to Cover', type:'textarea', required:true, placeholder:'List the specific topics/subtopics you plan to teach this period' },
  { id:'objectives', label:'Learning Objectives', type:'textarea', required:true, placeholder:'Students will be able to…' },
  { id:'method', label:'Teaching Method', type:'select', required:false, options:['Lecture','Discussion','Demonstration','Activity','Flipped Classroom','Group Work','Problem Solving'] },
  { id:'resources', label:'Resources & Materials', type:'text', required:false, placeholder:'e.g. NCERT p.45, projector, lab equipment' },
  { id:'homework', label:'Homework / Assignment', type:'text', required:false, placeholder:'e.g. Exercise 3.1 Q1-5' },
  { id:'remarks', label:'Remarks', type:'text', required:false, placeholder:'Any additional notes' },
]

function weekDays(weekStart) {
  return DAYS.map((day, i) => ({
    day,
    date: addDays(weekStart, i),
    dateStr: format(addDays(weekStart, i), 'yyyy-MM-dd'),
    label: format(addDays(weekStart, i), 'EEE, d MMM'),
  }))
}

function PeriodForm({ period, fields, value, onChange, onSubmit, saving, submitted, saveError }) {
  const [open, setOpen] = useState(isToday(period.date) && !submitted)
  const allRequiredFilled = fields.filter(f => f.required).every(f => (value[f.id] || '').trim())

  return (
    <div style={{ border: `1px solid ${submitted ? 'var(--green-muted)' : open ? 'var(--gold-dark)' : 'var(--gray-200)'}`, borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 10, background: 'var(--white)' }}>

      {/* Header */}
      <div onClick={() => setOpen(o => !o)} style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: submitted ? 'var(--green-light)' : open ? '#fffdf0' : 'var(--white)', userSelect: 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: submitted ? 'var(--green)' : 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {submitted
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            : <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>P{period.period}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: submitted ? 'var(--green-dark)' : 'var(--text)' }}>
            Period {period.period}{period.periodTime ? ` · ${period.periodTime}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
            {period.className} · <span style={{ color: 'var(--gold-dark)', fontWeight: 500 }}>{period.subject}</span>
          </div>
          {submitted && value.topics && (
            <div style={{ fontSize: 11, color: 'var(--green-mid)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value.topics}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 16, background: submitted ? 'var(--green)' : 'var(--gray-100)', color: submitted ? 'white' : 'var(--text-muted)', fontWeight: 500 }}>
            {submitted ? 'Done' : 'Pending'}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      {/* Read-only view when submitted */}
      {open && submitted && (
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--green-muted)', background: 'var(--green-light)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--green-mid)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Submitted Plan</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fields.filter(f => value[f.id]).map(f => (
              <div key={f.id}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 2 }}>{f.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{value[f.id]}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--green-mid)', fontStyle: 'italic' }}>Contact admin to make changes to this plan.</div>
        </div>
      )}

      {/* Editable form when not submitted */}
      {open && !submitted && (
        <div style={{ padding: '16px', borderTop: '1px solid var(--gray-100)', background: 'var(--white)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map(f => (
              <div key={f.id}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  {f.label}{f.required && <span style={{ color: 'var(--crimson)', marginLeft: 3 }}>*</span>}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={value[f.id] || ''}
                    onChange={e => onChange(f.id, e.target.value)}
                    placeholder={f.placeholder || ''}
                    rows={3}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text)', resize: 'vertical', fontFamily: 'var(--font-body)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }}
                  />
                ) : f.type === 'select' ? (
                  <select
                    value={value[f.id] || ''}
                    onChange={e => onChange(f.id, e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)' }}
                  >
                    <option value="">Select…</option>
                    {(f.options || []).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={value[f.id] || ''}
                    onChange={e => onChange(f.id, e.target.value)}
                    placeholder={f.placeholder || ''}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }}
                  />
                )}
              </div>
            ))}
          </div>

          {saveError && (
            <div style={{ fontSize: 12, color: 'var(--crimson)', background: 'var(--crimson-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginTop: 12, border: '1px solid rgba(139,26,26,0.15)' }}>
              ⚠ {saveError}
            </div>
          )}

          <button
            onClick={onSubmit}
            disabled={saving || !allRequiredFilled}
            style={{ width: '100%', padding: '13px', marginTop: 14, background: (!allRequiredFilled || saving) ? 'var(--gray-200)' : 'var(--green)', color: (!allRequiredFilled || saving) ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: (!allRequiredFilled || saving) ? 'not-allowed' : 'pointer', boxShadow: (!allRequiredFilled || saving) ? 'none' : '0 2px 8px rgba(26,74,46,0.25)' }}
          >
            {saving ? 'Saving…' : 'Save Period Plan'}
          </button>
          {!allRequiredFilled && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>Fill in required fields (*) to save</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function LessonPlan() {
  const { teacher, user } = useAuth()
  const [fields, setFields] = useState([])
  const [timetable, setTimetable] = useState([])
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [plans, setPlans] = useState({})
  const [formData, setFormData] = useState({})
  const [saving, setSaving] = useState({})
  const [saveError, setSaveError] = useState('')
  const [successKey, setSuccessKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [openDays, setOpenDays] = useState({})

  const teacherId = teacher?.id || user?.uid || ''
  const teacherEmail = teacher?.email || user?.email || ''

  // Load plan fields from admin settings
  useEffect(() => {
    getDoc(doc(db, 'settings', 'lessonPlanFields'))
      .then(d => setFields(d.exists() && d.data().fields?.length ? d.data().fields : DEFAULT_FIELDS))
      .catch(() => setFields(DEFAULT_FIELDS))
  }, [])

  // Load timetable — 3-strategy resolution to handle id/name mismatches
  useEffect(() => {
    if (!teacherId && !teacherEmail) return
    async function loadTimetable() {
      try {
        const allSnap = await getDocs(collection(db, 'timetable'))
        const allSlots = allSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        // Strategy 1: teacherId match
        let mySlots = teacherId ? allSlots.filter(s => s.teacherId === teacherId) : []
        // Strategy 2: teacherName match
        if (mySlots.length === 0 && teacher?.fullName) {
          mySlots = allSlots.filter(s => s.teacherName?.toLowerCase().trim() === teacher.fullName.toLowerCase().trim())
        }
        // Strategy 3: re-resolve via email
        if (mySlots.length === 0 && teacherEmail) {
          let tSnap = await getDocs(query(collection(db, 'teachers'), where('email', '==', teacherEmail)))
          if (tSnap.empty) tSnap = await getDocs(query(collection(db, 'teachers'), where('personalEmail', '==', teacherEmail)))
          if (!tSnap.empty) {
            const rId = tSnap.docs[0].id
            const rName = tSnap.docs[0].data().fullName || ''
            mySlots = allSlots.filter(s => s.teacherId === rId || s.teacherName?.toLowerCase().trim() === rName.toLowerCase().trim())
          }
        }
        setTimetable(mySlots)
      } catch(e) { console.error('Timetable load error:', e) }
    }
    loadTimetable()
  }, [teacherId, teacherEmail])

  // Load existing plans for the current week
  useEffect(() => {
    if (!teacherId) { setLoading(false); return }
    const weekStartStr = format(weekStart, 'yyyy-MM-dd')
    const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    setLoading(true)
    // Single-field query only — avoids compound index requirement
    // Filter by date range client-side
    getDocs(query(
      collection(db, 'lessonPlans'),
      where('teacherId', '==', teacherId)
    )).then(snap => {
      const p = {}
      const fd = {}
      snap.docs.forEach(d => {
        const plan = { id: d.id, ...d.data() }
        // Skip plans superseded by a reschedule — they're ghost entries from a previous date
        if (plan.status === 'superseded') return
        // Client-side date range filter
        if (!plan.dateStr || plan.dateStr < weekStartStr || plan.dateStr > weekEndStr) return
        const key = `${plan.dateStr}_${plan.periodId}`
        p[key] = plan
        fd[key] = plan.data || {}
      })
      setPlans(p)
      setFormData(prev => ({ ...fd, ...Object.fromEntries(Object.entries(prev).filter(([k]) => !fd[k])) }))
      setLoading(false)
    }).catch(e => { console.error('Lesson plan load error:', e.code, e.message); setLoading(false) })
  }, [teacherId, weekStart])

  // Open today by default
  useEffect(() => {
    const todayDay = format(new Date(), 'EEEE')
    setOpenDays({ [todayDay]: true })
  }, [])

  const days = weekDays(weekStart)

  function slotsForDay(day) {
    return timetable.filter(s => s.day === day).sort((a, b) => Number(a.period || 0) - Number(b.period || 0))
  }

  function planKey(dateStr, slotId) { return `${dateStr}_${slotId}` }

  function handleChange(dateStr, slotId, fieldId, val) {
    const key = planKey(dateStr, slotId)
    setSaveError('')
    setFormData(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [fieldId]: val } }))
  }

  async function handleSave(dateStr, slot) {
    const key = planKey(dateStr, slot.id)
    setSaving(prev => ({ ...prev, [key]: true }))
    setSaveError('')
    try {
      // Plans inherit branchCode from the timetable slot they're attached to.
      // Slots are branched (admin app stamps branchCode at create time as of v91),
      // and pre-v91 slots got MAIN via the backfill. Defensive fallbacks below
      // for any edge cases.
      const branchCode = slot.branchCode || teacher?.branchCodes?.[0] || 'MAIN'
      const planDoc = {
        teacherId,
        teacherName: teacher?.fullName || user?.displayName || '',
        dateStr,
        periodId: slot.id,
        period: slot.period,
        periodTime: slot.periodTime || '',
        className: slot.className,
        subject: slot.subject,
        day: slot.day,
        weekStart: format(weekStart, 'yyyy-MM-dd'),
        data: formData[key] || {},
        submittedAt: Timestamp.now(),
        status: 'submitted',
        branchCode,
      }
      const ref = await addDoc(collection(db, 'lessonPlans'), planDoc)
      setPlans(prev => ({ ...prev, [key]: { id: ref.id, ...planDoc } }))
      // Show success banner for 2.5 seconds
      setSuccessKey(key)
      setTimeout(() => setSuccessKey(k => k === key ? '' : k), 2500)
    } catch(e) {
      console.error('Save error:', e)
      setSaveError(e.message || 'Failed to save. Check permissions and internet connection.')
    }
    setSaving(prev => ({ ...prev, [key]: false }))
  }

  const totalSlots = days.reduce((sum, d) => sum + slotsForDay(d.day).length, 0)
  const filledSlots = Object.keys(plans).length

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ padding: '20px' }}>
      <div className="fade-up" style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>Lesson Plans</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>Fill your plan for each period as per your timetable</p>
      </div>

      {/* Success banner */}
      {successKey && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 999, background: 'var(--green)', color: 'white', padding: '12px 24px', borderRadius: 'var(--radius-lg)', fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(26,74,46,0.35)', display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Lesson plan saved successfully!
        </div>
      )}

      {/* Week navigator */}
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => setWeekStart(d => subWeeks(d, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 10px', fontSize: 22, lineHeight: 1 }}>‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-dark)' }}>
            {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 5), 'd MMM yyyy')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {format(weekStart, 'yyyy-MM-dd') === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') ? 'Current week' : 'Past week'}
            {totalSlots > 0 && ` · ${filledSlots}/${totalSlots} periods planned`}
          </div>
        </div>
        <button onClick={() => setWeekStart(d => addWeeks(d, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 10px', fontSize: 22, lineHeight: 1 }}>›</button>
      </div>

      {/* Progress bar */}
      {totalSlots > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Week completion</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: filledSlots === totalSlots ? 'var(--green)' : 'var(--text-muted)' }}>{Math.round((filledSlots / totalSlots) * 100)}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--gray-100)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((filledSlots / totalSlots) * 100)}%`, height: '100%', background: 'var(--green)', borderRadius: 3, transition: 'width 0.5s ease' }} />
          </div>
        </div>
      )}

      {timetable.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--gold-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>No timetable assigned</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ask the admin to set up your timetable in the Timetable section.</p>
        </div>
      ) : (
        <div>
          {days.map(({ day, date, dateStr, label }) => {
            const slots = slotsForDay(day)
            if (slots.length === 0) return null
            const isOpen = !!openDays[day]
            const dayFilled = slots.filter(s => !!plans[planKey(dateStr, s.id)]).length
            const isTod = isToday(date)
            const isPast = isBefore(startOfDay(date), startOfDay(new Date()))

            return (
              <div key={day} style={{ marginBottom: 12 }}>
                {/* Day header */}
                <div
                  onClick={() => setOpenDays(prev => ({ ...prev, [day]: !prev[day] }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: isTod ? 'var(--green)' : 'var(--green-dark)', borderRadius: isOpen ? 'var(--radius-lg) var(--radius-lg) 0 0' : 'var(--radius-lg)', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>{day}</span>
                      {isTod && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 600 }}>Today</span>}
                      {isPast && !isTod && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Past</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{label} · {slots.length} period{slots.length > 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {slots.map(s => (
                        <div key={s.id} style={{ width: 10, height: 10, borderRadius: '50%', background: plans[planKey(dateStr, s.id)] ? 'var(--gold)' : 'rgba(255,255,255,0.25)' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', minWidth: 32, textAlign: 'right' }}>{dayFilled}/{slots.length}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </div>

                {/* Periods */}
                {isOpen && (
                  <div style={{ background: 'var(--gray-50)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', border: '1px solid var(--gray-100)', borderTop: 'none', padding: '10px' }}>
                    {slots.map(slot => {
                      const key = planKey(dateStr, slot.id)
                      const submitted = !!plans[key]
                      return (
                        <PeriodForm
                          key={slot.id}
                          period={{ ...slot, date }}
                          fields={fields}
                          value={formData[key] || {}}
                          onChange={(fieldId, val) => handleChange(dateStr, slot.id, fieldId, val)}
                          onSubmit={() => handleSave(dateStr, slot)}
                          saving={!!saving[key]}
                          submitted={submitted}
                          saveError={saveError}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
