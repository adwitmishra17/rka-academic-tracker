import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs, addDoc, updateDoc, doc, query, where, limit, orderBy, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { format } from 'date-fns'

// =============================================================================
// LogLesson v2 — timetable-driven
//
// Behavior change vs v1: the teacher no longer picks class/subject/period
// freely. They pick a date, then tap one of their timetable slots for that
// day (own slots + cover slots from arrangements). Class, subject, period,
// periodTime, and branchCode are all locked from the slot.
//
// Soft-strict: a "Log an off-schedule lesson" toggle is always available,
// reveals the legacy free-form fields, and stamps offSchedule:true on the
// saved record.
//
// Substitutions: when an arrangement names this teacher as the cover,
// the corresponding slot from the original teacher's timetable surfaces
// in the picker as a cover card. Saved logs include coveringFor:
// originalTeacherId so admin reports can attribute correctly.
//
// New fields stamped on saved lesson docs:
//   slotId: timetable slot id, or null in off-schedule mode
//   offSchedule: boolean
//   coveringFor: absent teacher's id, or null
// =============================================================================

const FALLBACK_CLASSES = [
  'Class 9','Class 10',
  'Class 11 Science','Class 11 Commerce','Class 11 Humanities',
  'Class 12 Science','Class 12 Commerce','Class 12 Humanities',
]

export default function LogLesson() {
  const { teacher, user } = useAuth()

  // ---- form state -----------------------------------------------------------
  // The shared fields (date, notes, manualTopics) are used in both modes.
  // Off-schedule (`os*`) fields are only used when offSchedule === true.
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
    manualTopics: '',
    osClassId: '',
    osClassName: '',
    osClassNames: [],
    osSubject: '',
    osPeriod: '1',
    osActualPeriods: '1',
  })

  // The selected timetable slot (or cover slot). null until the teacher taps one.
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [offSchedule, setOffSchedule] = useState(false)

  // Topics + syllabus
  const [syllabus, setSyllabus] = useState([])
  const [selectedTopics, setSelectedTopics] = useState([])

  // Slot data
  const [allMySlots, setAllMySlots] = useState([])
  const [allSlotsByDay, setAllSlotsByDay] = useState({})
  const [arrangementsForDate, setArrangementsForDate] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(true)

  // Off-schedule fallback: classes + subjects (from same timetable derivation
  // pattern as v1, so the off-schedule path still surfaces sensible options).
  const [classes, setClasses] = useState([])
  const [subjects, setSubjects] = useState([])
  const [classSubjectsMap, setClassSubjectsMap] = useState({})

  // Misc
  const [recentLessons, setRecentLessons] = useState([])
  const [showAllRecent, setShowAllRecent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // --- Edit window logic -----------------------------------------------------
  // Once a teacher logs a slot, they have 10 minutes to edit. After that the
  // slot is locked (admin-only edits). The picker shows three states:
  //   - new (no log) → selectable, normal
  //   - editable (logged within last 10 min) → selectable, shows countdown
  //   - locked (logged > 10 min ago) → unclickable, shows alert tooltip
  // We tick `nowMs` every second so the countdown updates smoothly.
  // The cost is one state update per second, which is negligible — React
  // already re-renders for other reasons and formatCountdown is cheap.
  const EDIT_WINDOW_MS = 10 * 60 * 1000
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Map of slotId → { docs: [...], earliestCreatedMs }, scoped to TODAY only.
  // Earliest createdAt drives the edit window (matches "keep earliest" cleanup
  // policy). Combined-class slots have multiple lessons docs sharing slotId;
  // we use the earliest across them all.
  function buildTodayLogMap(lessons, todayStr) {
    const map = new Map()
    for (const l of lessons) {
      if (!l.slotId || l.date !== todayStr) continue
      const created = l.createdAt && l.createdAt.toDate
        ? l.createdAt.toDate().getTime()
        : (l.createdAt instanceof Date ? l.createdAt.getTime() : null)
      const existing = map.get(l.slotId) || { docs: [], earliestCreatedMs: Infinity }
      existing.docs.push(l)
      if (created !== null && created < existing.earliestCreatedMs) {
        existing.earliestCreatedMs = created
      }
      map.set(l.slotId, existing)
    }
    return map
  }
  const todayLogMap = useMemo(() => buildTodayLogMap(recentLessons, form.date), [recentLessons, form.date])

  // Returns { state: 'new'|'editable'|'locked', msRemaining, logEntry }
  function slotLogStatus(slot) {
    if (!slot?.slotId) return { state: 'new', msRemaining: 0, logEntry: null }
    const entry = todayLogMap.get(slot.slotId)
    if (!entry || entry.docs.length === 0) return { state: 'new', msRemaining: 0, logEntry: null }
    // No createdAt means we can't measure age — treat as locked per spec.
    if (!Number.isFinite(entry.earliestCreatedMs)) {
      return { state: 'locked', msRemaining: 0, logEntry: entry }
    }
    const ageMs = nowMs - entry.earliestCreatedMs
    if (ageMs < EDIT_WINDOW_MS) {
      return { state: 'editable', msRemaining: EDIT_WINDOW_MS - ageMs, logEntry: entry }
    }
    return { state: 'locked', msRemaining: 0, logEntry: entry }
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}m ${String(s).padStart(2, '0')}s`
  }
  const [error, setError] = useState('')

  // ---- load classSubjectsMap (used for off-schedule subject suggestions) ----
  useEffect(() => {
    import('firebase/firestore').then(({ getDoc, doc }) => {
      getDoc(doc(db, 'settings', 'classSubjects'))
        .then(d => { if (d.exists() && d.data().map) setClassSubjectsMap(d.data().map) })
        .catch(() => {})
    })
  }, [])

  // ---- load timetable -------------------------------------------------------
  // Pulls the full timetable once. From it we derive (a) `allMySlots` for the
  // own-slot picker, (b) `allSlotsByDay` indexed for cover-slot lookups, and
  // (c) the off-schedule `classes` list (same logic as v1).
  useEffect(() => {
    if (!teacher && !user) return
    let cancelled = false
    async function loadTimetable() {
      try {
        const teacherId = teacher?.id || ''
        const teacherName = (teacher?.fullName || '').toLowerCase().trim()
        const emailLower = (teacher?.email || teacher?.personalEmail || user?.email || '').toLowerCase().trim()

        const allTTSnap = await getDocs(collection(db, 'timetable'))
        const allSlots = allTTSnap.docs.map(d => ({ id: d.id, ...d.data() }))

        let mySlots = allSlots.filter(s =>
          (teacherId && s.teacherId === teacherId) ||
          (teacherName && s.teacherName?.toLowerCase().trim() === teacherName)
        )

        if (mySlots.length === 0 && emailLower) {
          const allTeachersSnap = await getDocs(collection(db, 'teachers'))
          const matched = allTeachersSnap.docs.find(d => {
            const data = d.data()
            return (data.email || '').toLowerCase().trim() === emailLower ||
                   (data.personalEmail || '').toLowerCase().trim() === emailLower
          })
          if (matched) {
            const resolvedId = matched.id
            const resolvedName = (matched.data().fullName || '').toLowerCase().trim()
            mySlots = allSlots.filter(s =>
              s.teacherId === resolvedId ||
              s.teacherName?.toLowerCase().trim() === resolvedName
            )
          }
        }

        if (cancelled) return
        setAllMySlots(mySlots)

        // Index every slot by day-name for cover-slot lookups
        const byDay = {}
        allSlots.forEach(s => {
          if (!s.day) return
          if (!byDay[s.day]) byDay[s.day] = []
          byDay[s.day].push(s)
        })
        setAllSlotsByDay(byDay)

        // Build off-schedule classes list (preserves combined-class entries
        // and per-class branchCode resolution from v1)
        if (mySlots.length > 0) {
          const individualClasses = new Set()
          const combinedGroups = new Map()
          const subjectsByClass = {}
          const branchByClass = {}

          mySlots.forEach(slot => {
            const slotClasses = Array.isArray(slot.classNames) && slot.classNames.length
              ? slot.classNames.map(c => c.trim()).filter(Boolean)
              : slot.className ? slot.className.split('+').map(s => s.trim()).filter(Boolean) : []

            slotClasses.forEach(c => {
              individualClasses.add(c)
              if (!subjectsByClass[c]) subjectsByClass[c] = new Set()
              if (slot.subject) subjectsByClass[c].add(slot.subject)
              if (!branchByClass[c] && slot.branchCode) branchByClass[c] = slot.branchCode
            })

            if (slotClasses.length > 1) {
              const key = [...slotClasses].sort().join(' + ')
              if (!combinedGroups.has(key)) {
                combinedGroups.set(key, { classNames: [...slotClasses].sort(), subjects: new Set(), branchCode: slot.branchCode })
              }
              if (slot.subject) combinedGroups.get(key).subjects.add(slot.subject)
            }
          })

          const entries = []
          ;[...individualClasses].sort().forEach(name => {
            entries.push({
              id: name,
              className: name,
              classNames: [name],
              subjects: [...(subjectsByClass[name] || [])],
              isCombined: false,
              branchCode: branchByClass[name] || teacher?.branchCodes?.[0] || 'MAIN',
            })
          })
          ;[...combinedGroups.entries()].forEach(([key, grp]) => {
            entries.push({
              id: `combined:${key}`,
              className: key,
              classNames: grp.classNames,
              subjects: [...grp.subjects],
              isCombined: true,
              branchCode: grp.branchCode || teacher?.branchCodes?.[0] || 'MAIN',
            })
          })
          if (!cancelled) setClasses(entries)
        } else {
          // Final fallback: load classes collection for off-schedule mode
          try {
            const classesSnap = await getDocs(collection(db, 'classes'))
            const dynamicClasses = classesSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(c => c.isActive !== false)
              .map(c => ({ id: c.className, className: c.className, classNames: [c.className] }))
            if (!cancelled) {
              setClasses(dynamicClasses.length > 0
                ? dynamicClasses
                : FALLBACK_CLASSES.map(name => ({ id: name, className: name, classNames: [name] })))
            }
          } catch (e) {
            if (!cancelled) setClasses(FALLBACK_CLASSES.map(name => ({ id: name, className: name, classNames: [name] })))
          }
        }
      } catch (e) {
        console.error('timetable load error:', e)
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    }
    loadTimetable()
    return () => { cancelled = true }
  }, [teacher, user])

  // ---- load arrangements for selected date ----------------------------------
  useEffect(() => {
    if (!form.date) return
    let cancelled = false
    setArrangementsForDate([])
    getDocs(query(collection(db, 'arrangements'), where('date', '==', form.date)))
      .then(snap => {
        if (cancelled) return
        setArrangementsForDate(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      })
      .catch(() => { if (!cancelled) setArrangementsForDate([]) })
    return () => { cancelled = true }
  }, [form.date])

  // ---- compute the day-of-week and per-day slot lists -----------------------
  const dayName = useMemo(() => {
    if (!form.date) return ''
    try { return format(new Date(form.date + 'T00:00:00'), 'EEEE') } catch { return '' }
  }, [form.date])

  const ownSlots = useMemo(() => {
    return allMySlots
      .filter(s => s.day === dayName)
      .map(s => ({
        source: 'own',
        slotId: s.id,
        period: s.period,
        periodTime: s.periodTime || '',
        className: s.className,
        classNames: Array.isArray(s.classNames) && s.classNames.length ? s.classNames : [s.className],
        subject: s.subject || '',
        branchCode: s.branchCode || teacher?.branchCodes?.[0] || 'MAIN',
        isCombined: Array.isArray(s.classNames) && s.classNames.length > 1,
        coveringFor: null,
        coveringForName: null,
      }))
      .sort((a, b) => Number(a.period || 0) - Number(b.period || 0))
  }, [allMySlots, dayName, teacher])

  const coverSlots = useMemo(() => {
    if (!teacher?.id) return []
    return arrangementsForDate
      .filter(a => a.arrangementTeacherId === teacher.id)
      .map(a => {
        // Find the original (absent) teacher's timetable slot to fill in the
        // missing pieces (subject, slotId, branchCode). Arrangements don't
        // store subject; we match on (day, period, className, absentTeacher).
        const origSlot = (allSlotsByDay[dayName] || []).find(s =>
          s.teacherId === a.absentTeacherId &&
          Number(s.period) === Number(a.period) &&
          (s.className === a.className || (Array.isArray(s.classNames) && s.classNames.includes(a.className)))
        )
        return {
          source: 'cover',
          slotId: origSlot?.id || null,
          period: a.period,
          periodTime: a.periodTime || origSlot?.periodTime || '',
          className: a.className,
          classNames: Array.isArray(origSlot?.classNames) && origSlot.classNames.length ? origSlot.classNames : [a.className],
          subject: origSlot?.subject || '',
          branchCode: origSlot?.branchCode || teacher?.branchCodes?.[0] || 'MAIN',
          isCombined: Array.isArray(origSlot?.classNames) && origSlot.classNames.length > 1,
          coveringFor: a.absentTeacherId,
          coveringForName: a.absentTeacherName,
          arrangementId: a.id,
          arrangementNotes: a.notes || '',
        }
      })
      .sort((a, b) => Number(a.period || 0) - Number(b.period || 0))
  }, [arrangementsForDate, allSlotsByDay, dayName, teacher])

  // Arrangements where THIS teacher is absent (display-only, can't log)
  const absentArrangements = useMemo(() => {
    if (!teacher?.id) return []
    return arrangementsForDate.filter(a => a.absentTeacherId === teacher.id)
  }, [arrangementsForDate, teacher])

  // ---- pre-fill form when re-selecting an editable (already-logged) slot ----
  // When a teacher taps a slot that they logged within the last 10 minutes,
  // restore their previous topics + notes so the edit feels continuous.
  useEffect(() => {
    if (!selectedSlot || offSchedule) return
    const status = slotLogStatus(selectedSlot)
    if (status.state !== 'editable' || !status.logEntry) return
    // Use the first doc as the canonical source (combined slots share topics)
    const src = status.logEntry.docs[0]
    if (!src) return
    setSelectedTopics(Array.isArray(src.topicIds) ? src.topicIds : [])
    setForm(p => ({
      ...p,
      notes: src.notes || '',
      manualTopics: Array.isArray(src.manualTopics) ? src.manualTopics.join(', ') : (src.manualTopics || ''),
    }))
    // We intentionally only do this when slot SELECTION changes (not on every
    // nowMs tick) — otherwise the user's in-progress edits would be wiped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlot?.slotId, selectedSlot?.source])

  // ---- syllabus: load when class/slot changes -------------------------------
  // In slot mode, classId is the slot's first className. In off-schedule mode,
  // it's the picked osClassId. Either way, query syllabus by classId.
  useEffect(() => {
    let key = ''
    if (offSchedule) {
      key = form.osClassId
    } else if (selectedSlot) {
      key = selectedSlot.classNames?.[0] || selectedSlot.className
    }
    if (!key) {
      setSyllabus([])
      return
    }
    getDocs(query(collection(db, 'syllabus'), where('classId', '==', key)))
      .then(snap => setSyllabus(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(e => { console.error('syllabus load error:', e); setSyllabus([]) })
  }, [selectedSlot, offSchedule, form.osClassId])

  // ---- recent lessons (preserved from v1) -----------------------------------
  async function loadRecentLessons() {
    const teacherDocId = teacher?.id || ''
    if (!teacherDocId && !teacher?.fullName) return
    try {
      let snap
      if (teacherDocId) {
        try {
          snap = await getDocs(query(
            collection(db, 'lessons'),
            where('teacherId', '==', teacherDocId),
            orderBy('date', 'desc'),
            limit(100)
          ))
        } catch (e) {
          snap = await getDocs(query(collection(db, 'lessons'), where('teacherId', '==', teacherDocId), limit(500)))
        }
      }
      if (!snap || snap.empty) {
        try {
          snap = await getDocs(query(
            collection(db, 'lessons'),
            where('teacherName', '==', teacher?.fullName || ''),
            orderBy('date', 'desc'),
            limit(100)
          ))
        } catch (e) {
          snap = await getDocs(query(collection(db, 'lessons'), where('teacherName', '==', teacher?.fullName || ''), limit(500)))
        }
      }
      const sorted = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      setRecentLessons(sorted)
    } catch (e) { console.error('lessons load error:', e.code, e.message) }
  }
  useEffect(() => { if (teacher || user) loadRecentLessons() }, [teacher, user])

  // ---- topic toggle ---------------------------------------------------------
  function toggleTopic(topicId) {
    setSelectedTopics(prev => prev.includes(topicId) ? prev.filter(t => t !== topicId) : [...prev, topicId])
  }

  // ---- subject filtering for the topic picker -------------------------------
  const activeSubject = offSchedule ? form.osSubject : selectedSlot?.subject
  const filteredTopics = syllabus.filter(t => t.subject === activeSubject)
  const byChapter = filteredTopics.reduce((acc, t) => {
    if (!acc[t.chapter]) acc[t.chapter] = []
    acc[t.chapter].push(t)
    return acc
  }, {})

  // ---- save -----------------------------------------------------------------
  async function handleSubmit() {
    // Mode-specific validation
    if (!offSchedule && !selectedSlot) {
      setError('Pick a period from the schedule below, or switch to off-schedule.')
      return
    }
    if (offSchedule && (!form.osClassId && !form.osClassName)) {
      setError('Off-schedule lessons need a class.')
      return
    }
    if (offSchedule && !form.osSubject) {
      setError('Off-schedule lessons need a subject.')
      return
    }
    if (selectedTopics.length === 0 && !form.manualTopics.trim()) {
      setError('Pick topics from the syllabus or describe what you taught manually.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const selectedTopicDocs = syllabus.filter(t => selectedTopics.includes(t.id))
      const syllabusNames = selectedTopicDocs.map(t => t.topicName)
      const manualList = form.manualTopics.trim()
        ? form.manualTopics.split(',').map(s => s.trim()).filter(Boolean)
        : []
      const allTopicNames = [...syllabusNames, ...manualList]

      let baseData
      let classesToLog

      if (offSchedule) {
        classesToLog = form.osClassNames?.length > 0 ? form.osClassNames : [form.osClassName]
        const isCombined = classesToLog.length > 1
        const selectedEntry = classes.find(c => c.id === form.osClassId)
        const branchCode = selectedEntry?.branchCode || teacher?.branchCodes?.[0] || 'MAIN'
        baseData = {
          date: form.date,
          subject: form.osSubject,
          teacherId: teacher?.id || user?.uid || '',
          teacherName: teacher?.fullName || user?.displayName || '',
          topicIds: selectedTopics,
          topicNames: allTopicNames.join(', '),
          manualTopics: manualList,
          period: Number(form.osPeriod),
          actualPeriods: Number(form.osActualPeriods),
          notes: form.notes,
          isCombined,
          combinedWith: isCombined ? classesToLog : [],
          branchCode,
          slotId: null,
          offSchedule: true,
          coveringFor: null,
          createdAt: Timestamp.now(),
        }
      } else {
        classesToLog = selectedSlot.classNames?.length > 0 ? selectedSlot.classNames : [selectedSlot.className]
        const isCombined = classesToLog.length > 1
        baseData = {
          date: form.date,
          subject: selectedSlot.subject,
          teacherId: teacher?.id || user?.uid || '',
          teacherName: teacher?.fullName || user?.displayName || '',
          topicIds: selectedTopics,
          topicNames: allTopicNames.join(', '),
          manualTopics: manualList,
          period: Number(selectedSlot.period),
          actualPeriods: 1, // slot mode: one slot = one period
          notes: form.notes,
          isCombined,
          combinedWith: isCombined ? classesToLog : [],
          branchCode: selectedSlot.branchCode || teacher?.branchCodes?.[0] || 'MAIN',
          slotId: selectedSlot.slotId,
          offSchedule: false,
          coveringFor: selectedSlot.coveringFor || null,
          createdAt: Timestamp.now(),
        }
      }

      // ---- Save / Edit decision -------------------------------------------
      // Slot-mode saves consult the edit window. Off-schedule lessons remain
      // append-only (no edit window) because they're ad-hoc by nature and
      // don't have a deterministic key for "same lesson again."
      const isSlotMode = !offSchedule && selectedSlot
      const existingForSlot = isSlotMode ? todayLogMap.get(selectedSlot.slotId) : null

      if (isSlotMode && existingForSlot && existingForSlot.docs.length > 0) {
        // Re-saving an existing slot. Confirm we're still within the window
        // (a slow user could have started typing 9 minutes ago and saved at
        // 11 minutes — the rules don't enforce, but UI should be honest).
        const ageMs = nowMs - existingForSlot.earliestCreatedMs
        if (!Number.isFinite(existingForSlot.earliestCreatedMs) || ageMs >= EDIT_WINDOW_MS) {
          setError('Edit window expired. Contact admin to make changes to this lesson.')
          setSaving(false)
          return
        }
        // Within the window: UPDATE each existing doc (one per className for
        // combined slots). Keep the original createdAt so the window doesn't
        // restart with each edit. Stamp editedAt for audit.
        const editPatch = {
          // Same fields as baseData, but omit createdAt (preserve original).
          ...baseData,
          editedAt: Timestamp.now(),
        }
        delete editPatch.createdAt
        await Promise.all(existingForSlot.docs.map(d =>
          updateDoc(doc(db, 'lessons', d.id), { ...editPatch, classId: d.className, className: d.className })
        ))
      } else {
        // New log — pre-flight check against race conditions (very rare, but
        // matches the "no duplicates" guarantee).
        if (isSlotMode) {
          try {
            const existsCheck = await getDocs(query(
              collection(db, 'lessons'),
              where('date', '==', baseData.date),
              where('slotId', '==', baseData.slotId),
              where('teacherId', '==', baseData.teacherId),
              limit(1),
            ))
            if (!existsCheck.empty) {
              await loadRecentLessons()
              setError('Already logged for this period. Edit it from the slot picker (within 10 minutes of the original save).')
              setSaving(false)
              return
            }
          } catch (e) {
            // If the check fails (offline, rules), proceed — addDoc is the
            // canonical action; we prefer occasional dup over blocked save.
            // We log to console so if duplicates appear despite the state
            // machine, we can see whether this guard was bypassed.
            console.warn('Pre-flight duplicate check failed:', e?.code, e?.message)
          }
        }
        // One lesson record per className. All N records share the same slotId
        // (and coveringFor, branchCode, etc.) so reconciliation can match the
        // slot regardless of which className it came in under.
        await Promise.all(classesToLog.map(cls => addDoc(collection(db, 'lessons'), {
          ...baseData,
          classId: cls,
          className: cls,
        })))
      }

      setSaved(true)
      setSelectedTopics([])
      setSelectedSlot(null)
      setForm(p => ({ ...p, notes: '', manualTopics: '' }))
      await loadRecentLessons()
      window.scrollTo({ top: 0, behavior: 'smooth' })
      setTimeout(() => setSaved(false), 4000)
    } catch (e) {
      console.error('Save error:', e)
      setError(`Failed to save: ${e.message}`)
    }
    setSaving(false)
  }

  // ---- helpers for off-schedule subject suggestions -------------------------
  function pickOsClass(classId) {
    const cls = classes.find(c => c.id === classId)
    const ttSubjects = cls?.subjects || []
    const mapSubs = cls?.classNames?.length
      ? [...new Set(cls.classNames.flatMap(c => classSubjectsMap[c] || []))]
      : (classSubjectsMap[cls?.className] || [])
    const combined = [...new Set([...ttSubjects, ...mapSubs])].sort()
    setSubjects(combined)
    setForm(p => ({
      ...p,
      osClassId: classId,
      osClassName: cls?.className || '',
      osClassNames: cls?.classNames || [],
      osSubject: combined.length > 0 ? combined[0] : '',
    }))
    setSelectedTopics([])
  }

  // ---- render ---------------------------------------------------------------
  const showLessonForm = offSchedule
    ? !!(form.osClassName && form.osSubject)
    : !!selectedSlot

  return (
    <div style={{ padding: '20px' }}>
      <div className="fade-up" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>Log a Lesson</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>Pick a period from your schedule, then record what you taught</p>
      </div>

      {/* Success banner */}
      {saved && (
        <div className="fade-up" style={{ background: 'var(--green)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span style={{ fontSize: 14, color: 'white', fontWeight: 600 }}>✓ Lesson logged successfully!</span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ background: 'var(--crimson-light)', border: '1px solid rgba(139,26,26,0.2)', color: 'var(--crimson)', padding: '12px 14px', borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Date picker (always visible — controls slot list and arrangements) */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Date</label>
        <input
          type="date"
          value={form.date}
          onChange={e => {
            setForm(p => ({ ...p, date: e.target.value }))
            setSelectedSlot(null)
          }}
          style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', fontSize: 14, color: 'var(--text)', background: 'var(--white)' }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{dayName}</p>
      </div>

      {/* Absent-from-school notice */}
      {absentArrangements.length > 0 && (
        <div style={{ background: 'rgba(139,26,26,0.04)', border: '1px solid rgba(139,26,26,0.15)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--crimson)', marginBottom: 4 }}>
            You're marked absent on {dayName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {absentArrangements.length} period{absentArrangements.length > 1 ? 's' : ''} covered by:{' '}
            {[...new Set(absentArrangements.map(a => a.arrangementTeacherName).filter(Boolean))].join(', ')}
          </div>
        </div>
      )}

      {/* Slot picker (timetable mode) */}
      {!offSchedule && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Your periods on {dayName}
          </div>

          {loadingSlots ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
            </div>
          ) : ownSlots.length === 0 && coverSlots.length === 0 ? (
            <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '20px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--gold-dark)', fontWeight: 500, marginBottom: 4 }}>No periods scheduled</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing on your timetable for {dayName}. Use off-schedule below if you need to log anyway.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...ownSlots, ...coverSlots].sort((a, b) => Number(a.period || 0) - Number(b.period || 0)).map(slot => {
                const isSelected = selectedSlot && selectedSlot.slotId === slot.slotId &&
                                   selectedSlot.source === slot.source &&
                                   selectedSlot.period === slot.period
                const isCover = slot.source === 'cover'
                const accentColor = isCover ? '#b85c00' : 'var(--green)'
                const accentBg = isCover ? 'rgba(201,120,0,0.06)' : 'var(--green-light)'
                const accentBorder = isCover ? 'rgba(201,120,0,0.3)' : 'var(--green-muted)'

                // Logged-state visuals
                const logStatus = slotLogStatus(slot)
                const isLocked = logStatus.state === 'locked'
                const isEditable = logStatus.state === 'editable'

                // Apply visual overrides on top of selected/cover styling
                const lockedBg = '#f5f4ef'
                const lockedBorder = '#d9d6cb'
                const lockedColor = '#9e9b8f'
                const editableBorder = isCover ? 'rgba(201,120,0,0.5)' : 'var(--green)'
                const editableBg = isCover ? 'rgba(201,120,0,0.10)' : 'rgba(26,74,46,0.08)'

                return (
                  <button
                    key={`${slot.source}-${slot.slotId || slot.arrangementId}-${slot.period}`}
                    onClick={() => {
                      if (isLocked) {
                        alert('Already logged. Contact admin to make changes.')
                        return
                      }
                      // Editable or new: select the slot. If editable, pre-fill is
                      // handled by an effect that reads selectedSlot + todayLogMap.
                      setSelectedSlot(slot)
                      setSelectedTopics([])
                      setError('')
                    }}
                    disabled={isLocked}
                    style={{
                      borderRadius: 'var(--radius-md)',
                      border: `1.5px solid ${
                        isLocked ? lockedBorder
                        : isSelected ? accentColor
                        : isEditable ? editableBorder
                        : accentBorder
                      }`,
                      background: isLocked ? lockedBg
                        : isSelected ? accentBg
                        : isEditable ? editableBg
                        : 'var(--white)',
                      padding: '12px 14px',
                      textAlign: 'left',
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      boxShadow: isSelected ? `0 0 0 2px ${accentBg}` : 'none',
                      color: isLocked ? lockedColor : 'inherit',
                      opacity: isLocked ? 0.75 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: isCover ? 'rgba(201,120,0,0.15)' : 'var(--green-muted)', color: isCover ? '#b85c00' : 'var(--green-dark)' }}>
                        {isCover ? `Covering for ${slot.coveringForName}` : 'Your period'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Period {slot.period}{slot.periodTime ? ` · ${slot.periodTime}` : ''}
                      </span>
                      {isEditable && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#fff7d6', color: '#a36b00' }}>
                          Logged · editable for {formatCountdown(logStatus.msRemaining)}
                        </span>
                      )}
                      {isLocked && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'var(--gray-100, #ececec)', color: '#6b6b6b' }}>
                          Logged ✓
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isLocked ? lockedColor : 'var(--text)' }}>
                      {slot.className} <span style={{ color: isLocked ? lockedColor : 'var(--gold-dark)', fontWeight: 500 }}>· {slot.subject || '—'}</span>
                    </div>
                    {slot.isCombined && (
                      <div style={{ fontSize: 11, color: isLocked ? lockedColor : 'var(--green)', marginTop: 3 }}>
                        Combined period — {slot.classNames.length} classes
                      </div>
                    )}
                    {!slot.subject && (
                      <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 3 }}>
                        Subject not in timetable for this slot — switch to off-schedule to log.
                      </div>
                    )}
                    {isCover && slot.arrangementNotes && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                        {slot.arrangementNotes}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Off-schedule toggle — always visible, even when slots exist */}
          <button
            onClick={() => { setOffSchedule(true); setSelectedSlot(null); setError('') }}
            style={{ marginTop: 12, width: '100%', padding: '10px', background: 'var(--white)', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            Log an off-schedule lesson →
          </button>
        </div>
      )}

      {/* Off-schedule mode banner + free-form fields */}
      {offSchedule && (
        <>
          <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold-dark)', marginBottom: 2 }}>Off-schedule lesson</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This won't match a timetable slot. Logged for record-keeping only.</div>
            </div>
            <button
              onClick={() => { setOffSchedule(false); setSelectedTopics([]); setError('') }}
              style={{ fontSize: 11, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              Use schedule
            </button>
          </div>

          {/* Class */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Class</label>
            <select
              value={form.osClassId}
              onChange={e => pickOsClass(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', fontSize: 14, color: 'var(--text)', background: 'var(--white)' }}
            >
              <option value="">Select class…</option>
              {classes.filter(c => !c.isCombined).map(c => <option key={c.id} value={c.id}>{c.className}</option>)}
              {classes.some(c => c.isCombined) && <option disabled>── Combined periods ──</option>}
              {classes.filter(c => c.isCombined).map(c => <option key={c.id} value={c.id}>{c.className} (combined)</option>)}
            </select>
            {form.osClassNames?.length > 1 && (
              <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 6 }}>
                Combined period — {form.osClassNames.length} lesson records will be created.
              </p>
            )}
          </div>

          {/* Subject */}
          {subjects.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Subject</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {subjects.map(s => (
                  <button key={s} onClick={() => { setForm(p => ({ ...p, osSubject: s })); setSelectedTopics([]) }} style={{ padding: '8px 14px', borderRadius: 20, border: '1px solid', borderColor: form.osSubject === s ? 'var(--green)' : 'var(--gray-200)', background: form.osSubject === s ? 'var(--green)' : 'var(--white)', color: form.osSubject === s ? 'white' : 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Period + Periods used */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Period number</label>
              <select value={form.osPeriod} onChange={e => setForm(p => ({ ...p, osPeriod: e.target.value }))} style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', fontSize: 14, background: 'var(--white)' }}>
                {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>Period {n}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Periods used</label>
              <select value={form.osActualPeriods} onChange={e => setForm(p => ({ ...p, osActualPeriods: e.target.value }))} style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', fontSize: 14, background: 'var(--white)' }}>
                {[1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      {/* Lesson body — appears once a slot is picked or off-schedule fields filled */}
      {showLessonForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Topics */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 10 }}>
              Topics from syllabus <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(optional)</span>
              {selectedTopics.length > 0 && <span style={{ color: 'var(--green)', marginLeft: 8, fontWeight: 600 }}>{selectedTopics.length} selected</span>}
            </label>
            {Object.keys(byChapter).length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px', background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)' }}>No syllabus found for this class/subject. Use the manual topics field below.</p>
            ) : Object.entries(byChapter).map(([chapter, topics]) => (
              <div key={chapter} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{chapter}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {topics.map(t => {
                    const sel = selectedTopics.includes(t.id)
                    return (
                      <button key={t.id} onClick={() => toggleTopic(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${sel ? 'var(--green)' : 'var(--gray-200)'}`, background: sel ? 'var(--green-light)' : 'var(--white)', cursor: 'pointer', textAlign: 'left' }}>
                        <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--green)' : 'var(--gray-300)'}`, background: sel ? 'var(--green)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {sel && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                        </div>
                        <span style={{ fontSize: 13, color: sel ? 'var(--green-dark)' : 'var(--text)', fontWeight: sel ? 500 : 400, flex: 1 }}>{t.topicName}</span>
                        {t.plannedPeriods && <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{t.plannedPeriods}p</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Manual topics */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>
              What you taught
              {selectedTopics.length === 0 && <span style={{ color: 'var(--crimson)', marginLeft: 4 }}>*</span>}
              <span style={{ fontWeight: 400, color: 'var(--gray-400)', marginLeft: 6 }}>(comma-separated)</span>
            </label>
            <textarea
              value={form.manualTopics}
              onChange={e => setForm(p => ({ ...p, manualTopics: e.target.value }))}
              placeholder="e.g. Newton's First Law, Inertia, Free body diagrams"
              rows={2}
              style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--text)', resize: 'none', fontFamily: 'var(--font-body)', background: 'var(--white)' }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="e.g. Covered sections 3.1–3.2, assigned Q1–5 as homework"
              rows={3}
              style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--text)', resize: 'none', fontFamily: 'var(--font-body)', background: 'var(--white)' }}
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              width: '100%', padding: '15px',
              background: saving ? 'var(--green-mid)' : 'var(--green)',
              color: 'white', border: 'none', borderRadius: 'var(--radius-md)',
              fontSize: 15, fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(26,74,46,0.25)',
            }}
          >
            {saving ? 'Saving lesson…' : (() => {
              const total = selectedTopics.length +
                (form.manualTopics.trim() ? form.manualTopics.split(',').map(s => s.trim()).filter(Boolean).length : 0)
              return `Save Lesson${total > 0 ? ` (${total} topic${total > 1 ? 's' : ''})` : ''}`
            })()}
          </button>
        </div>
      )}

      {/* Recent lessons */}
      {recentLessons.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Your recent lessons <span style={{ color: 'var(--green)', marginLeft: 4 }}>({recentLessons.length})</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(showAllRecent ? recentLessons : recentLessons.slice(0, 10)).map(l => (
              <div key={l.id} style={{ background: 'var(--white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-100)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{l.className} · {l.subject}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.date}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.topicNames || 'Topics logged'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--green)' }}>Period {l.period} · {l.actualPeriods} period{l.actualPeriods > 1 ? 's' : ''} used</span>
                  {l.offSchedule && (
                    <span style={{ fontSize: 10, color: 'var(--gold-dark)', background: 'var(--gold-light)', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>off-schedule</span>
                  )}
                  {l.coveringFor && (
                    <span style={{ fontSize: 10, color: '#b85c00', background: 'rgba(201,120,0,0.1)', padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>cover</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {recentLessons.length > 10 && (
            <button onClick={() => setShowAllRecent(v => !v)} style={{ marginTop: 10, width: '100%', padding: '10px', background: 'var(--white)', border: '1px dashed var(--green-muted)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 500, color: 'var(--green)', cursor: 'pointer' }}>
              {showAllRecent ? 'Show less' : `Show all ${recentLessons.length} lessons`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
