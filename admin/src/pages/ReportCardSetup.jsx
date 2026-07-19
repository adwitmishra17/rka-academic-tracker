import React, { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, writeBatch, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { CLASS_NAMES } from '../lib/classes'
import { branchLabel } from '../lib/branch'
import { branchConstraints } from '../lib/branchQuery'

// ─── Constants ────────────────────────────────────────────────────────────────

const HPC_CLASSES = new Set(['Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2'])

// Each assessment is independent — no weightage aggregation.
const STANDARD_TERMS = [
  { shortCode: 'T1', name: 'Term 1',      sortOrder: 1 },
  { shortCode: 'HY', name: 'Half Yearly', sortOrder: 2 },
  { shortCode: 'T2', name: 'Term 2',      sortOrder: 3 },
  { shortCode: 'AN', name: 'Annual',      sortOrder: 4 },
]

// Class-aware quick-add subject cloud. Admins click chips to add subjects;
// teacher is auto-filled from the active timetable. Custom subjects (not in
// the cloud) still go through the manual Add Subject form below.
const SUBJECT_GROUPS = {
  preprimary:    {
    scholastic:    ['English', 'Hindi', 'Numeracy', 'EVS', 'Pre-Reading', 'Pre-Writing'],
    co_scholastic: ['Rhymes', 'Drawing', 'Music', 'Dance', 'Stories'],
  },
  primary_lower: {
    scholastic:    ['English', 'Hindi', 'Mathematics', 'EVS', 'General Knowledge'],
    co_scholastic: ['Art & Craft', 'Music', 'Physical Education', 'Moral Science'],
  },
  primary_upper: {
    scholastic:    ['English', 'Hindi', 'Mathematics', 'EVS', 'Science', 'Social Studies', 'Computer', 'Sanskrit', 'General Knowledge'],
    co_scholastic: ['Art & Craft', 'Music', 'Physical Education', 'Moral Science'],
  },
  middle:        {
    scholastic:    ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies', 'Sanskrit', 'Computer', 'General Knowledge'],
    co_scholastic: ['Art & Craft', 'Music', 'Physical Education', 'Moral Science'],
  },
  secondary:     {
    scholastic:    ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies', 'Sanskrit', 'IT / Computer'],
    co_scholastic: ['Art', 'Physical Education'],
  },
  sr_science:    {
    scholastic:    ['English', 'Physics', 'Chemistry', 'Biology', 'Mathematics', 'Computer Science', 'Physical Education', 'Hindi'],
    co_scholastic: [],
  },
  sr_commerce:   {
    scholastic:    ['English', 'Accountancy', 'Business Studies', 'Economics', 'Mathematics', 'Computer Science', 'Physical Education', 'Hindi'],
    co_scholastic: [],
  },
  sr_humanities: {
    scholastic:    ['English', 'History', 'Geography', 'Political Science', 'Economics', 'Sociology', 'Psychology', 'Hindi', 'Physical Education'],
    co_scholastic: [],
  },
}

function suggestedSubjectsFor(className) {
  if (['Nursery', 'LKG', 'UKG'].includes(className))         return SUBJECT_GROUPS.preprimary
  if (['Class 1', 'Class 2'].includes(className))            return SUBJECT_GROUPS.primary_lower
  if (['Class 3', 'Class 4', 'Class 5'].includes(className)) return SUBJECT_GROUPS.primary_upper
  if (['Class 6', 'Class 7', 'Class 8'].includes(className)) return SUBJECT_GROUPS.middle
  if (['Class 9', 'Class 10'].includes(className))           return SUBJECT_GROUPS.secondary
  if (/^Class 1[12] Science$/.test(className))               return SUBJECT_GROUPS.sr_science
  if (/^Class 1[12] Commerce$/.test(className))              return SUBJECT_GROUPS.sr_commerce
  if (/^Class 1[12] Humanities$/.test(className))            return SUBJECT_GROUPS.sr_humanities
  return { scholastic: [], co_scholastic: [] }
}

// Look up the timetable for "who teaches `subjectName` to `className`?"
function lookupTeacherFromTimetable(slots, className, subjectName) {
  const subj = (subjectName || '').toLowerCase()
  const slot = (slots || []).find(s =>
    (s.classNames || []).includes(className) &&
    (s.subject || '').toLowerCase() === subj
  )
  return slot ? { teacherId: slot.teacherId, teacherName: slot.teacherName || '' } : null
}

// Subject-name hints used to guess scholastic vs co-scholastic when importing
// from the timetable. Conservative — anything not matched defaults to
// scholastic, and the admin can flip it in the import preview.
const CO_SCHOLASTIC_HINTS = [
  'art', 'craft', 'music', 'dance', 'physical education', ' pe', 'pe ',
  'sport', 'game', 'moral', 'yoga', 'drawing', 'painting', 'club',
  'library', 'value education', 'life skill',
]
function guessKindFromName(subjectName) {
  const n = ` ${(subjectName || '').toLowerCase()} `
  return CO_SCHOLASTIC_HINTS.some(h => n.includes(h)) ? 'co_scholastic' : 'scholastic'
}

// Derive the distinct (subject → most-frequent teacher) list for a class from
// the timetable slots. A subject taught across many periods by one teacher and
// a few by another picks the majority teacher; the admin can override later.
function deriveSubjectsFromTimetable(slots, className) {
  const bySubject = new Map()  // subject → Map(teacherId → { id, name, count })
  ;(slots || []).forEach(s => {
    if (!(s.classNames || []).includes(className)) return
    const subject = (s.subject || '').trim()
    if (!subject) return
    if (!bySubject.has(subject)) bySubject.set(subject, new Map())
    const tMap = bySubject.get(subject)
    const tid  = s.teacherId || ''
    const cur  = tMap.get(tid) || { id: tid, name: s.teacherName || '', count: 0 }
    cur.count += 1
    tMap.set(tid, cur)
  })
  const result = []
  for (const [subject, tMap] of bySubject) {
    let best = null
    for (const t of tMap.values()) if (!best || t.count > best.count) best = t
    result.push({
      subjectName: subject,
      teacherId:   best?.id   || '',
      teacherName: best?.name || '',
      kind:        guessKindFromName(subject),
    })
  }
  return result.sort((a, b) => a.subjectName.localeCompare(b.subjectName))
}

const HPC_DOMAINS = [
  { key: 'physical',  label: 'Physical Development' },
  { key: 'socio',     label: 'Socio-Emotional' },
  { key: 'cognitive', label: 'Cognitive' },
  { key: 'language',  label: 'Language' },
  { key: 'numeracy',  label: 'Numeracy' },
  { key: 'aesthetic', label: 'Aesthetic & Cultural' },
]

// Deterministic doc IDs for easy lookup without secondary queries
const sessionDocId = (b, s)    => `${b}_${s}`
const termDocId    = (b, s, t) => `${b}_${s}_${t}`

function isValidSessionCode(code) {
  return /^\d{4}-\d{2}$/.test(code.trim())
}

// ─── Shared style helpers ─────────────────────────────────────────────────────

const inp = {
  padding: '8px 11px',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  color: 'var(--text)',
  background: 'var(--white)',
  outline: 'none',
  fontFamily: 'var(--font-body)',
}

const tabStyle = (active) => ({
  padding: '9px 16px', border: 'none',
  borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', flex: 1, transition: 'all 0.15s',
  background: active ? 'var(--white)' : 'transparent',
  color:      active ? 'var(--green)' : 'var(--text-muted)',
  boxShadow:  active ? 'var(--shadow-sm)' : 'none',
})

const btn = (variant = 'primary', disabled = false) => ({
  padding: '8px 20px', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
  borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
  ...(disabled ? { background: 'var(--gray-200)', color: 'var(--gray-400)' } :
    variant === 'primary'  ? { background: 'var(--green)', color: 'white' } :
    variant === 'danger'   ? { background: 'var(--crimson-light)', color: 'var(--crimson)' } :
                             { background: 'var(--white)', color: 'var(--green)', border: '1px solid var(--gray-200)' }),
})

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportCardSetup() {
  const { user, effectiveBranches, isSuperAdmin } = useAuth()
  const [tab, setTab] = useState('sessions')

  // ── Sessions ─────────────────────────────────────────────────────────────
  const [sessions,        setSessions]        = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [newCode,         setNewCode]         = useState('')
  const [newBranch,       setNewBranch]       = useState('MAIN')
  const [sessionSaving,   setSessionSaving]   = useState(false)
  const [sessionError,    setSessionError]    = useState('')

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const constraints = branchConstraints('branchCode', effectiveBranches)
      const q = constraints.length
        ? query(collection(db, 'examSessions'), ...constraints)
        : query(collection(db, 'examSessions'))
      const snap = await getDocs(q)
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) =>
        a.branchCode !== b.branchCode
          ? a.branchCode.localeCompare(b.branchCode)
          : b.sessionCode.localeCompare(a.sessionCode)
      )
      setSessions(list)
    } catch (e) { console.error('loadSessions:', e) }
    setLoadingSessions(false)
  }, [effectiveBranches])

  useEffect(() => { loadSessions() }, [loadSessions])

  // Keep default branch in sync with what the admin can see
  useEffect(() => {
    if (effectiveBranches?.length) setNewBranch(effectiveBranches[0])
  }, [effectiveBranches])

  async function addSession() {
    const code = newCode.trim()
    if (!isValidSessionCode(code)) { setSessionError('Use YYYY-YY format, e.g. 2025-26'); return }
    const id = sessionDocId(newBranch, code)
    if (sessions.some(s => s.id === id)) { setSessionError(`${code} already exists for this branch.`); return }
    setSessionSaving(true); setSessionError('')
    try {
      await setDoc(doc(db, 'examSessions', id), {
        branchCode: newBranch, sessionCode: code,
        isActive: false, createdAt: Timestamp.now(), createdBy: user?.email || '',
      })
      setNewCode('')
      await loadSessions()
    } catch (e) { console.error('addSession:', e); setSessionError('Failed to save. Try again.') }
    setSessionSaving(false)
  }

  async function toggleActive(session) {
    try {
      const batch = writeBatch(db)
      if (!session.isActive) {
        // Deactivate siblings in same branch first
        sessions
          .filter(s => s.branchCode === session.branchCode && s.id !== session.id && s.isActive)
          .forEach(s => batch.update(doc(db, 'examSessions', s.id), { isActive: false }))
        batch.update(doc(db, 'examSessions', session.id), { isActive: true })
      } else {
        batch.update(doc(db, 'examSessions', session.id), { isActive: false })
      }
      await batch.commit()
      await loadSessions()
    } catch (e) { console.error('toggleActive:', e) }
  }

  async function deleteSession(session) {
    if (!window.confirm(
      `Delete session ${session.sessionCode} (${branchLabel(session.branchCode)})?\n\n` +
      `This removes only the session record — subjects and terms are NOT deleted.`
    )) return
    try {
      await deleteDoc(doc(db, 'examSessions', session.id))
      await loadSessions()
    } catch (e) { console.error('deleteSession:', e) }
  }

  // ── Terms ────────────────────────────────────────────────────────────────
  const [termsSession,  setTermsSession]  = useState(null)
  const [terms,         setTerms]         = useState([])
  const [loadingTerms,  setLoadingTerms]  = useState(false)
  const [termDrafts,    setTermDrafts]    = useState({})
  const [savingTerms,   setSavingTerms]   = useState(false)
  const [termsSaved,    setTermsSaved]    = useState(false)
  const [seedingTerms,  setSeedingTerms]  = useState(false)

  const loadTerms = useCallback(async (session) => {
    if (!session) return
    setLoadingTerms(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'examTerms'),
        where('branchCode',  '==', session.branchCode),
        where('sessionCode', '==', session.sessionCode),
      ))
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      setTerms(list)
      const drafts = {}
      list.forEach(t => {
        drafts[t.shortCode] = {
          startsOn:   t.startsOn  || '',
          endsOn:     t.endsOn    || '',
          resultDate: t.resultDate || '',
        }
      })
      setTermDrafts(drafts)
    } catch (e) { console.error('loadTerms:', e) }
    setLoadingTerms(false)
  }, [])

  useEffect(() => {
    if (termsSession) loadTerms(termsSession)
    else setTerms([])
  }, [termsSession, loadTerms])

  async function seedTerms() {
    if (!termsSession) return
    setSeedingTerms(true)
    try {
      const batch = writeBatch(db)
      const drafts = {}
      STANDARD_TERMS.forEach(t => {
        const id = termDocId(termsSession.branchCode, termsSession.sessionCode, t.shortCode)
        batch.set(doc(db, 'examTerms', id), {
          branchCode:  termsSession.branchCode,
          sessionCode: termsSession.sessionCode,
          name:        t.name,  shortCode: t.shortCode,
          sortOrder:   t.sortOrder,
          startsOn: '', endsOn: '', resultDate: '',
          isFinalized: false,
        }, { merge: true })
        drafts[t.shortCode] = { startsOn: '', endsOn: '', resultDate: '' }
      })
      await batch.commit()
      setTermDrafts(drafts)
      await loadTerms(termsSession)
    } catch (e) { console.error('seedTerms:', e) }
    setSeedingTerms(false)
  }

  async function saveTerms() {
    if (!termsSession || terms.length === 0) return
    setSavingTerms(true)
    try {
      const batch = writeBatch(db)
      terms.forEach(t => {
        const d = termDrafts[t.shortCode] || {}
        const id = termDocId(termsSession.branchCode, termsSession.sessionCode, t.shortCode)
        batch.update(doc(db, 'examTerms', id), {
          startsOn: d.startsOn || '', endsOn: d.endsOn || '', resultDate: d.resultDate || '',
        })
      })
      await batch.commit()
      setTermsSaved(true); setTimeout(() => setTermsSaved(false), 2500)
      await loadTerms(termsSession)
    } catch (e) { console.error('saveTerms:', e) }
    setSavingTerms(false)
  }

  function updateTermDraft(shortCode, field, value) {
    setTermDrafts(prev => ({ ...prev, [shortCode]: { ...(prev[shortCode] || {}), [field]: value } }))
  }

  // ── Subjects ─────────────────────────────────────────────────────────────
  const [subjectsSession, setSubjectsSession] = useState(null)
  const [subjectsClass,   setSubjectsClass]   = useState('Class 3')
  const [subjects,        setSubjects]        = useState([])
  const [loadingSubjects, setLoadingSubjects] = useState(false)
  const [teachers,        setTeachers]        = useState([])
  const [timetableSlots,  setTimetableSlots]  = useState([])
  const [newSubj,         setNewSubj]         = useState({ name: '', code: '', kind: 'scholastic', teacherId: '', teacherName: '' })
  const [addingSubj,      setAddingSubj]      = useState(false)
  const [subjError,       setSubjError]       = useState('')

  // Subject cloud draft state. Chip clicks update pendingCloudChanges instead
  // of writing to Firestore immediately. The Save button commits everything.
  // Key format: `${kind}__${subjectName}` (double-underscore avoids name clashes).
  // Value: 'add' or 'remove'.
  const [pendingCloudChanges, setPendingCloudChanges] = useState({})
  const [savingCloud,         setSavingCloud]         = useState(false)
  const [cloudSaved,          setCloudSaved]          = useState(false)

  // "Import from Timetable" modal state. importRows is the editable preview:
  // each row = { subjectName, teacherId, teacherName, kind, include, exists }.
  const [showImport,   setShowImport]   = useState(false)
  const [importRows,   setImportRows]   = useState([])
  const [importing,    setImporting]    = useState(false)

  // "Build from Timetable" (session-wide) modal state. buildAllRows is the flat
  // editable preview across ALL classes: each row =
  // { className, subjectName, teacherId, teacherName, kind, include, exists }.
  const [showBuildAll,   setShowBuildAll]   = useState(false)
  const [buildAllRows,   setBuildAllRows]   = useState([])
  const [buildingAll,    setBuildingAll]    = useState(false)
  const [buildAllResult, setBuildAllResult] = useState(null)

  // Reset draft state when the admin switches session or class — pending
  // changes don't carry across contexts.
  useEffect(() => {
    setPendingCloudChanges({})
    setCloudSaved(false)
  }, [subjectsSession, subjectsClass])

  const loadSubjects = useCallback(async () => {
    if (!subjectsSession) return
    setLoadingSubjects(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'examSubjects'),
        where('branchCode',  '==', subjectsSession.branchCode),
        where('sessionCode', '==', subjectsSession.sessionCode),
        where('className',   '==', subjectsClass),
      ))
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      setSubjects(list)
    } catch (e) { console.error('loadSubjects:', e) }
    setLoadingSubjects(false)
  }, [subjectsSession, subjectsClass])

  useEffect(() => {
    if (subjectsSession) loadSubjects()
    else setSubjects([])
  }, [subjectsSession, subjectsClass, loadSubjects])

  // Load teachers for the session's branch
  useEffect(() => {
    if (!subjectsSession) return
    ;(async () => {
      try {
        const snap = await getDocs(query(collection(db, 'teachers'), where('isActive', '==', true)))
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => (t.branchCodes || []).includes(subjectsSession.branchCode))
          .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
        setTeachers(list)
      } catch (e) { console.error('loadTeachers:', e) }
    })()
  }, [subjectsSession])

  // Load timetable slots for the session's branch (used by the subject cloud
  // to auto-fill assignedTeacherId when a chip is clicked)
  useEffect(() => {
    if (!subjectsSession) { setTimetableSlots([]); return }
    ;(async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'timetable'),
          where('branchCode', '==', subjectsSession.branchCode),
        ))
        setTimetableSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) { console.error('loadTimetable:', e) }
    })()
  }, [subjectsSession])

  // Toggle a chip in the draft state — no Firestore write until Save is clicked.
  // Three transitions are possible:
  //   (already added,   no pending change)   → mark 'remove'
  //   (not yet added,   no pending change)   → mark 'add'
  //   (any state,       has pending change)  → cancel the pending change
  function toggleCloudChip(subjectName, kind) {
    if (!subjectsSession) return
    setCloudSaved(false)
    const key = `${kind}__${subjectName}`
    const isAdded = subjects.some(s =>
      (s.subjectName || '').toLowerCase() === subjectName.toLowerCase() && s.kind === kind
    )
    setPendingCloudChanges(prev => {
      const next = { ...prev }
      if (next[key]) { delete next[key] }            // cancel pending
      else if (isAdded) { next[key] = 'remove' }
      else { next[key] = 'add' }
      return next
    })
  }

  // Commit all pending chip changes in a single sweep. Each 'add' resolves
  // the teacher from the timetable; each 'remove' deletes the existing doc.
  async function saveCloudChanges() {
    const entries = Object.entries(pendingCloudChanges)
    if (entries.length === 0 || !subjectsSession) return
    setSavingCloud(true)
    let runningOrder = subjects.length > 0 ? Math.max(...subjects.map(s => s.sortOrder || 0)) : 0
    try {
      for (const [key, action] of entries) {
        const [kind, ...nameParts] = key.split('__')
        const subjectName = nameParts.join('__')
        if (action === 'add') {
          // Skip if it was added by some other path in the meantime
          if (subjects.some(s => (s.subjectName || '').toLowerCase() === subjectName.toLowerCase() && s.kind === kind)) continue
          const teacher = lookupTeacherFromTimetable(timetableSlots, subjectsClass, subjectName)
          runningOrder += 1
          await addDoc(collection(db, 'examSubjects'), {
            branchCode:          subjectsSession.branchCode,
            sessionCode:         subjectsSession.sessionCode,
            className:           subjectsClass,
            subjectName,
            subjectCode:         '',
            kind,
            isOptional:          false,
            sortOrder:           runningOrder,
            assignedTeacherId:   teacher?.teacherId   || '',
            assignedTeacherName: teacher?.teacherName || '',
            createdAt:           Timestamp.now(),
            createdBy:           user?.email || '',
          })
        } else if (action === 'remove') {
          const subj = subjects.find(s =>
            (s.subjectName || '').toLowerCase() === subjectName.toLowerCase() && s.kind === kind
          )
          if (subj) await deleteDoc(doc(db, 'examSubjects', subj.id))
        }
      }
      setPendingCloudChanges({})
      await loadSubjects()
      setCloudSaved(true)
      setTimeout(() => setCloudSaved(false), 2500)
    } catch (e) {
      console.error('saveCloudChanges:', e)
      setSubjError('Failed to save subjects. Try again.')
    }
    setSavingCloud(false)
  }

  // ── Import from Timetable ──────────────────────────────────────────────
  // Derive the subject + teacher list for the selected class straight from
  // the timetable, present it as an editable preview, and let the admin
  // bulk-add. Subjects already mapped are pre-flagged and unchecked.
  function openImportFromTimetable() {
    if (!subjectsSession) return
    const derived = deriveSubjectsFromTimetable(timetableSlots, subjectsClass)
    const rows = derived.map(d => {
      const exists = subjects.some(s =>
        (s.subjectName || '').toLowerCase() === d.subjectName.toLowerCase() && s.kind === d.kind
      )
      return { ...d, exists, include: !exists }   // default-include only new ones
    })
    setImportRows(rows)
    setSubjError('')
    setShowImport(true)
  }

  function updateImportRow(idx, patch) {
    setImportRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  async function commitImport() {
    const toAdd = importRows.filter(r => r.include && !r.exists)
    if (toAdd.length === 0) { setShowImport(false); return }
    setImporting(true)
    let runningOrder = subjects.length > 0 ? Math.max(...subjects.map(s => s.sortOrder || 0)) : 0
    try {
      for (const r of toAdd) {
        // Re-check existence against the chosen kind (admin may have toggled it)
        if (subjects.some(s => (s.subjectName || '').toLowerCase() === r.subjectName.toLowerCase() && s.kind === r.kind)) continue
        runningOrder += 1
        await addDoc(collection(db, 'examSubjects'), {
          branchCode:          subjectsSession.branchCode,
          sessionCode:         subjectsSession.sessionCode,
          className:           subjectsClass,
          subjectName:         r.subjectName,
          subjectCode:         '',
          kind:                r.kind,
          isOptional:          false,
          sortOrder:           runningOrder,
          assignedTeacherId:   r.teacherId   || '',
          assignedTeacherName: r.teacherName || '',
          createdAt:           Timestamp.now(),
          createdBy:           user?.email || '',
        })
      }
      setShowImport(false)
      await loadSubjects()
    } catch (e) {
      console.error('commitImport:', e)
      setSubjError('Failed to import subjects. Try again.')
    }
    setImporting(false)
  }

  // ── Build from Timetable (all classes) ─────────────────────────────────
  // Sweep the WHOLE branch timetable: enumerate every class, derive its
  // subject → teacher list, and present one review list grouped by class.
  // This is the primary way to populate subjects for a session — the admin
  // no longer adds them class-by-class. Existing subjects are pre-skipped.
  async function openBuildAll() {
    if (!subjectsSession) return
    setSubjError('')
    setBuildAllResult(null)

    // Distinct classes present in the timetable, ordered by the canonical list
    const present = new Set()
    timetableSlots.forEach(s => (s.classNames || []).forEach(c => present.add(c)))
    const classes = CLASS_NAMES.filter(c => present.has(c))
    ;[...present].filter(c => !CLASS_NAMES.includes(c)).sort().forEach(c => classes.push(c))

    // Existing subjects for the whole session (all classes) → flag duplicates
    let existing = []
    try {
      const snap = await getDocs(query(
        collection(db, 'examSubjects'),
        where('branchCode',  '==', subjectsSession.branchCode),
        where('sessionCode', '==', subjectsSession.sessionCode),
      ))
      existing = snap.docs.map(d => d.data())
    } catch (e) { console.error('openBuildAll existing:', e) }
    const key = (cls, name, kind) => `${cls}__${kind}__${(name || '').toLowerCase()}`
    const existingSet = new Set(existing.map(s => key(s.className, s.subjectName, s.kind)))

    const rows = []
    classes.forEach(cls => {
      deriveSubjectsFromTimetable(timetableSlots, cls).forEach(d => {
        const exists = existingSet.has(key(cls, d.subjectName, d.kind))
        rows.push({ className: cls, ...d, exists, include: !exists })
      })
    })
    setBuildAllRows(rows)
    setShowBuildAll(true)
  }

  function updateBuildRow(idx, patch) {
    setBuildAllRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function setClassInclude(className, include) {
    setBuildAllRows(rows => rows.map(r =>
      r.className === className && !r.exists ? { ...r, include } : r
    ))
  }

  async function commitBuildAll() {
    const toAdd = buildAllRows.filter(r => r.include && !r.exists)
    if (toAdd.length === 0) { setShowBuildAll(false); return }
    setBuildingAll(true)
    try {
      // Firestore writeBatch caps at 500 ops; the school has < 250 (class×subject) pairs.
      const orderByClass = new Map()
      const batch = writeBatch(db)
      for (const r of toAdd) {
        const next = (orderByClass.get(r.className) ?? 0) + 1
        orderByClass.set(r.className, next)
        const ref = doc(collection(db, 'examSubjects'))
        batch.set(ref, {
          branchCode:          subjectsSession.branchCode,
          sessionCode:         subjectsSession.sessionCode,
          className:           r.className,
          subjectName:         r.subjectName,
          subjectCode:         '',
          kind:                r.kind,
          isOptional:          false,
          sortOrder:           next,
          assignedTeacherId:   r.teacherId   || '',
          assignedTeacherName: r.teacherName || '',
          createdAt:           Timestamp.now(),
          createdBy:           user?.email || '',
        })
      }
      await batch.commit()
      setBuildAllResult({ added: toAdd.length, classes: new Set(toAdd.map(r => r.className)).size })
      setShowBuildAll(false)
      await loadSubjects()
    } catch (e) {
      console.error('commitBuildAll:', e)
      setSubjError('Failed to build subjects from timetable. Try again.')
    }
    setBuildingAll(false)
  }

  async function addSubject() {
    const name = newSubj.name.trim()
    if (!name) { setSubjError('Subject name is required.'); return }
    if (subjects.some(s => s.subjectName.toLowerCase() === name.toLowerCase() && s.kind === newSubj.kind)) {
      setSubjError(`"${name}" already exists as a ${newSubj.kind} subject for ${subjectsClass}.`); return
    }
    setAddingSubj(true); setSubjError('')
    try {
      const nextOrder = subjects.length > 0 ? Math.max(...subjects.map(s => s.sortOrder || 0)) + 1 : 1
      await addDoc(collection(db, 'examSubjects'), {
        branchCode:          subjectsSession.branchCode,
        sessionCode:         subjectsSession.sessionCode,
        className:           subjectsClass,
        subjectName:         name,
        subjectCode:         newSubj.code.trim().toUpperCase(),
        kind:                newSubj.kind,
        isOptional:          false,
        sortOrder:           nextOrder,
        assignedTeacherId:   newSubj.teacherId,
        assignedTeacherName: newSubj.teacherName,
        createdAt: Timestamp.now(),
        createdBy: user?.email || '',
      })
      setNewSubj({ name: '', code: '', kind: 'scholastic', teacherId: '', teacherName: '' })
      await loadSubjects()
    } catch (e) { console.error('addSubject:', e); setSubjError('Failed to save. Try again.') }
    setAddingSubj(false)
  }

  async function deleteSubject(subj) {
    if (!window.confirm(`Remove "${subj.subjectName}" from ${subjectsClass}?\n\nExisting marks/grades for this subject will not be deleted.`)) return
    try { await deleteDoc(doc(db, 'examSubjects', subj.id)); await loadSubjects() }
    catch (e) { console.error('deleteSubject:', e) }
  }

  async function saveSubjectInline(subj, changes) {
    try { await updateDoc(doc(db, 'examSubjects', subj.id), changes); await loadSubjects() }
    catch (e) { console.error('saveSubjectInline:', e) }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 20px', maxWidth: 880 }}>
      {/* Header */}
      <div className="fade-up" style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 4 }}>
          Session &amp; Marks
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Set the academic session and terms, then build subjects straight from the timetable. Teachers can enter marks as soon as a term is set up.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', padding: 3, border: '1px solid var(--gray-100)', marginBottom: 24 }}>
        {[['sessions', 'Sessions'], ['terms', 'Terms'], ['subjects', 'Subjects']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tabStyle(tab === k)}>{l}</button>
        ))}
      </div>

      {/* ── SESSIONS TAB ──────────────────────────────────────────────────── */}
      {tab === 'sessions' && (
        <div className="fade-up">
          {/* Add form */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '18px 20px', marginBottom: 20 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>Add New Session</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Session code</label>
                <input
                  value={newCode} onChange={e => { setNewCode(e.target.value); setSessionError('') }}
                  placeholder="e.g. 2025-26" style={{ ...inp, width: '100%' }}
                  onKeyDown={e => e.key === 'Enter' && addSession()}
                />
              </div>
              {isSuperAdmin && (
                <div style={{ minWidth: 150 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Branch</label>
                  <select value={newBranch} onChange={e => setNewBranch(e.target.value)} style={{ ...inp }}>
                    <option value="MAIN">Main Campus</option>
                    <option value="CITY">City Branch</option>
                  </select>
                </div>
              )}
              <button onClick={addSession} disabled={sessionSaving || !newCode.trim()} style={btn('primary', sessionSaving || !newCode.trim())}>
                {sessionSaving ? 'Adding…' : 'Add Session'}
              </button>
            </div>
            {sessionError && <p style={{ fontSize: 12, color: 'var(--crimson)', marginTop: 8 }}>{sessionError}</p>}
          </div>

          {/* List */}
          {loadingSessions ? (
            <Spinner />
          ) : sessions.length === 0 ? (
            <EmptyState text="No sessions yet. Add the current academic year above." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map(s => (
                <div key={s.id} style={{
                  background: 'var(--white)',
                  border: `1px solid ${s.isActive ? 'var(--green-muted)' : 'var(--gray-100)'}`,
                  borderRadius: 'var(--radius-md)', padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{s.sessionCode}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{branchLabel(s.branchCode)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {s.isActive && (
                      <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: 'var(--green-light)', color: 'var(--green)', fontWeight: 600 }}>Active</span>
                    )}
                    <button
                      onClick={() => toggleActive(s)}
                      style={{ fontSize: 12, padding: '5px 13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-200)', background: 'var(--white)', color: s.isActive ? 'var(--text-muted)' : 'var(--green)', cursor: 'pointer', fontWeight: 500 }}
                    >
                      {s.isActive ? 'Deactivate' : 'Set Active'}
                    </button>
                    <button onClick={() => deleteSession(s)} style={{ ...btn('danger'), padding: '5px 11px', fontSize: 12 }}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TERMS TAB ─────────────────────────────────────────────────────── */}
      {tab === 'terms' && (
        <div className="fade-up">
          {/* Session picker */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 500 }}>SELECT SESSION</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sessions.length === 0
                ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions yet — add one in the Sessions tab first.</p>
                : sessions.map(s => (
                  <button key={s.id} onClick={() => setTermsSession(s)} style={{
                    padding: '7px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    border: termsSession?.id === s.id ? '1.5px solid var(--green)' : '1px solid var(--gray-200)',
                    background: termsSession?.id === s.id ? 'var(--green-light)' : 'var(--white)',
                    color: termsSession?.id === s.id ? 'var(--green)' : 'var(--text)',
                  }}>
                    {s.sessionCode} · {branchLabel(s.branchCode)}
                    {s.isActive && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--green)', fontWeight: 700 }}>● ACTIVE</span>}
                  </button>
                ))
              }
            </div>
          </div>

          {termsSession && (
            loadingTerms ? <Spinner /> :
            terms.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '44px 20px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--gray-200)' }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No terms configured for {termsSession.sessionCode}</p>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
                  Initialise the 4 standard terms (Term 1, Half Yearly, Term 2, Annual) to get started.<br />
                  You can edit dates after. Each assessment is independent — no weighting.
                </p>
                <button onClick={seedTerms} disabled={seedingTerms} style={btn('primary', seedingTerms)}>
                  {seedingTerms ? 'Initialising…' : 'Initialise 4 Standard Terms'}
                </button>
              </div>
            ) : (
              <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {termsSession.sessionCode} · {branchLabel(termsSession.branchCode)}
                  </h2>
                  <button onClick={saveTerms} disabled={savingTerms} style={btn('primary', savingTerms)}>
                    {termsSaved ? '✓ Saved' : savingTerms ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
                        {['Term', 'Code', 'Starts On', 'Ends On', 'Result Date'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {terms.map((t, i) => {
                        const d = termDrafts[t.shortCode] || {}
                        return (
                          <tr key={t.id} style={{ borderBottom: i < terms.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                            <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text)' }}>{t.name}</td>
                            <td style={{ padding: '12px 14px' }}>
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: 'var(--gold-light)', color: 'var(--gold-dark)', fontWeight: 600 }}>{t.shortCode}</span>
                            </td>
                            <td style={{ padding: '12px 14px' }}>
                              <input type="date" value={d.startsOn || ''} onChange={e => updateTermDraft(t.shortCode, 'startsOn', e.target.value)} style={{ ...inp, fontSize: 12 }} />
                            </td>
                            <td style={{ padding: '12px 14px' }}>
                              <input type="date" value={d.endsOn || ''} onChange={e => updateTermDraft(t.shortCode, 'endsOn', e.target.value)} style={{ ...inp, fontSize: 12 }} />
                            </td>
                            <td style={{ padding: '12px 14px' }}>
                              <input type="date" value={d.resultDate || ''} onChange={e => updateTermDraft(t.shortCode, 'resultDate', e.target.value)} style={{ ...inp, fontSize: 12 }} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ── SUBJECTS TAB ──────────────────────────────────────────────────── */}
      {tab === 'subjects' && (
        <div className="fade-up">
          {/* Filters */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 20, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Session</label>
              <select
                value={subjectsSession?.id || ''}
                onChange={e => { setSubjectsSession(sessions.find(s => s.id === e.target.value) || null); setSubjError('') }}
                style={{ ...inp }}
              >
                <option value="">— Select session —</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.sessionCode} · {branchLabel(s.branchCode)}{s.isActive ? ' ●' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Class</label>
              <select value={subjectsClass} onChange={e => { setSubjectsClass(e.target.value); setSubjError('') }} style={{ ...inp }}>
                {CLASS_NAMES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* HPC info banner — shown above the subject UI for early-years classes.
              Subjects can be configured in ADDITION to HPC for these classes. */}
          {HPC_CLASSES.has(subjectsClass) && (
            <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.35)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold-dark)', marginBottom: 6 }}>
                HPC Class — Subjects are supplemental
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--gold-dark)', lineHeight: 1.6, marginBottom: 10 }}>
                <strong>{subjectsClass}</strong> primarily uses the <strong>Holistic Progress Card</strong> (NEP 2020) — teachers rate
                the six domains below. You may also map subjects here if the school records academic
                marks/grades for this class alongside HPC.
              </p>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {HPC_DOMAINS.map(d => (
                  <span key={d.key} style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 8, background: 'rgba(201,162,39,0.2)', color: 'var(--gold-dark)', fontWeight: 500 }}>
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!subjectsSession ? (
            <EmptyState text="Select a session above to manage subjects for this class." />

          ) : (
            <>
              {/* Build from Timetable (session-wide) — the primary way to
                  populate subjects: derives every class's subject + teacher
                  from the branch timetable in one reviewed action. */}
              <div style={{ background: 'var(--green-light)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      Build subjects from the timetable
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--green-dark)', lineHeight: 1.55, opacity: 0.85 }}>
                      Reads the {branchLabel(subjectsSession.branchCode)} timetable and proposes the subject &amp; teacher for <strong>every class at once</strong>. Review the list, then add — subjects you already mapped are kept untouched.
                    </p>
                  </div>
                  <button
                    onClick={openBuildAll}
                    disabled={timetableSlots.length === 0}
                    title={timetableSlots.length === 0 ? 'No timetable found for this branch' : 'Derive subjects and teachers for all classes from the timetable'}
                    style={{
                      padding: '10px 18px', borderRadius: 'var(--radius-sm)',
                      background: timetableSlots.length === 0 ? 'var(--gray-200)' : 'var(--green)',
                      color: timetableSlots.length === 0 ? 'var(--gray-400)' : 'white',
                      border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                      cursor: timetableSlots.length === 0 ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                    }}
                  >
                    {timetableSlots.length === 0 ? 'No timetable found' : 'Build from Timetable'}
                  </button>
                </div>
              </div>

              {buildAllResult && (
                <div style={{ background: 'var(--green-light)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: 'var(--green-dark)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 14 }}>✓</span>
                  Added {buildAllResult.added} subject{buildAllResult.added === 1 ? '' : 's'} across {buildAllResult.classes} class{buildAllResult.classes === 1 ? '' : 'es'}. Pick a class below to fine-tune.
                </div>
              )}

              {/* Import a single class only (secondary) */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button
                  onClick={openImportFromTimetable}
                  disabled={timetableSlots.length === 0}
                  title={timetableSlots.length === 0 ? 'No timetable found for this branch' : 'Derive subjects and teachers from the timetable'}
                  style={{
                    padding: '8px 14px', borderRadius: 'var(--radius-sm)',
                    background: timetableSlots.length === 0 ? 'var(--gray-100)' : 'var(--white)',
                    color: timetableSlots.length === 0 ? 'var(--gray-400)' : 'var(--green-dark)',
                    border: '1px solid var(--green-muted)',
                    fontSize: 12.5, fontWeight: 600,
                    cursor: timetableSlots.length === 0 ? 'not-allowed' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  Import this class only
                </button>
              </div>

              {/* Subject cloud — class-aware draft picker with Save button */}
              <SubjectCloud
                className={subjectsClass}
                suggestions={suggestedSubjectsFor(subjectsClass)}
                addedSubjects={subjects}
                pendingChanges={pendingCloudChanges}
                onToggle={toggleCloudChip}
                onSave={saveCloudChanges}
                saving={savingCloud}
                saved={cloudSaved}
                lookupTeacher={(name) => lookupTeacherFromTimetable(timetableSlots, subjectsClass, name)}
              />

              {/* Subject list */}
              <div style={{ marginBottom: 16 }}>
                {loadingSubjects ? <Spinner /> :
                  subjects.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '28px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--gray-200)', color: 'var(--text-muted)', fontSize: 13 }}>
                      No subjects mapped for <strong>{subjectsClass}</strong> in <strong>{subjectsSession.sessionCode}</strong> yet.
                    </div>
                  ) : (
                    <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', gap: 10, padding: '10px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
                        <span style={{ flex: 1, ...colLabel }}>Subject</span>
                        <span style={{ width: 118, ...colLabel }}>Kind</span>
                        <span style={{ width: 170, ...colLabel }}>Assigned Teacher</span>
                        <span style={{ width: 48,  ...colLabel }}>#</span>
                        <span style={{ width: 76 }} />
                      </div>
                      {subjects.map((s, i) => (
                        <SubjectRow
                          key={s.id} subj={s} teachers={teachers}
                          isLast={i === subjects.length - 1}
                          onSave={(changes) => saveSubjectInline(s, changes)}
                          onDelete={() => deleteSubject(s)}
                        />
                      ))}
                    </div>
                  )
                }
              </div>

              {/* Add subject */}
              <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '18px 20px' }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>Add Subject to {subjectsClass}</h2>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ flex: 2, minWidth: 140 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Subject name *</label>
                    <input
                      value={newSubj.name}
                      onChange={e => { setNewSubj(p => ({ ...p, name: e.target.value })); setSubjError('') }}
                      placeholder="e.g. English"
                      style={{ ...inp, width: '100%' }}
                      onKeyDown={e => e.key === 'Enter' && addSubject()}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 80 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Code (opt.)</label>
                    <input
                      value={newSubj.code} maxLength={6}
                      onChange={e => setNewSubj(p => ({ ...p, code: e.target.value }))}
                      placeholder="ENG" style={{ ...inp, width: '100%' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Kind</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[['scholastic', 'Scholastic'], ['co_scholastic', 'Co-Scholastic']].map(([k, l]) => (
                        <button key={k} onClick={() => setNewSubj(p => ({ ...p, kind: k }))} style={{
                          padding: '7px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                          border: newSubj.kind === k ? '1.5px solid var(--green)' : '1px solid var(--gray-200)',
                          borderRadius: 'var(--radius-sm)',
                          background: newSubj.kind === k ? 'var(--green-light)' : 'var(--white)',
                          color: newSubj.kind === k ? 'var(--green)' : 'var(--text-muted)',
                        }}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 170 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Assign teacher</label>
                    <select
                      value={newSubj.teacherId}
                      onChange={e => {
                        const t = teachers.find(t => t.id === e.target.value)
                        setNewSubj(p => ({ ...p, teacherId: e.target.value, teacherName: t?.fullName || '' }))
                      }}
                      style={{ ...inp, width: '100%' }}
                    >
                      <option value="">— Unassigned —</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                    </select>
                  </div>
                </div>
                {subjError && <p style={{ fontSize: 12, color: 'var(--crimson)', marginBottom: 10 }}>{subjError}</p>}
                <button onClick={addSubject} disabled={addingSubj || !newSubj.name.trim()} style={btn('primary', addingSubj || !newSubj.name.trim())}>
                  {addingSubj ? 'Adding…' : '+ Add Subject'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Import-from-Timetable preview modal ──────────────────────────── */}
      {showImport && (
        <div
          onClick={() => !importing && setShowImport(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="fade-in"
            style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}
          >
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--gray-100)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)' }}>
                Import from Timetable — {subjectsClass}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                Subjects and teachers derived from the timetable. Review the scholastic / co-scholastic
                split (auto-guessed from the name), uncheck anything not graded on the report card, then add.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {importRows.length === 0 ? (
                <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No subjects found in the timetable for <strong>{subjectsClass}</strong>.
                  Check that the timetable has periods scheduled for this class.
                </div>
              ) : importRows.map((r, i) => (
                <div key={r.subjectName} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '9px 22px',
                  borderBottom: i < importRows.length - 1 ? '1px solid var(--gray-50)' : 'none',
                  opacity: r.exists ? 0.55 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={r.include}
                    disabled={r.exists}
                    onChange={e => updateImportRow(i, { include: e.target.checked })}
                    style={{ flexShrink: 0, width: 16, height: 16, cursor: r.exists ? 'not-allowed' : 'pointer' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
                      {r.subjectName}
                      {r.exists && <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>· already mapped</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {r.teacherName ? `Teacher: ${r.teacherName}` : 'No teacher in timetable'}
                    </div>
                  </div>
                  {/* Kind toggle */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {['scholastic', 'co_scholastic'].map(k => (
                      <button
                        key={k}
                        onClick={() => !r.exists && updateImportRow(i, { kind: k })}
                        disabled={r.exists}
                        style={{
                          padding: '4px 9px', borderRadius: 6, fontSize: 10.5, fontWeight: 600,
                          border: '1px solid ' + (r.kind === k ? 'var(--green)' : 'var(--gray-200)'),
                          background: r.kind === k ? 'var(--green-light)' : 'var(--white)',
                          color: r.kind === k ? 'var(--green-dark)' : 'var(--text-muted)',
                          cursor: r.exists ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {k === 'scholastic' ? 'Scholastic' : 'Co-Sch.'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {importRows.filter(r => r.include && !r.exists).length} of {importRows.filter(r => !r.exists).length} new subjects selected
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowImport(false)} disabled={importing} style={{ padding: '8px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--white)', color: 'var(--text-muted)', border: '1px solid var(--gray-200)', fontSize: 13, fontWeight: 500, cursor: importing ? 'not-allowed' : 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={commitImport}
                  disabled={importing || importRows.filter(r => r.include && !r.exists).length === 0}
                  style={btn('primary', importing || importRows.filter(r => r.include && !r.exists).length === 0)}
                >
                  {importing ? 'Adding…' : `Add ${importRows.filter(r => r.include && !r.exists).length} subjects`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Build-from-Timetable (all classes) preview modal ─────────────── */}
      {showBuildAll && (() => {
        const newRows    = buildAllRows.filter(r => !r.exists)
        const selected   = newRows.filter(r => r.include)
        const classCount = new Set(selected.map(r => r.className)).size
        // Group rows by class while preserving each row's flat index (for edits)
        const groups = []
        const seen = new Map()
        buildAllRows.forEach((r, idx) => {
          if (!seen.has(r.className)) { const arr = []; seen.set(r.className, arr); groups.push([r.className, arr]) }
          seen.get(r.className).push({ r, idx })
        })
        const miniBtn = (disabled) => ({
          padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
          border: '1px solid var(--green-muted)', background: 'var(--white)',
          color: disabled ? 'var(--gray-400)' : 'var(--green-dark)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        })
        return (
          <div
            onClick={() => !buildingAll && setShowBuildAll(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="fade-in"
              style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 720, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}
            >
              <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--gray-100)' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)' }}>
                  Build from Timetable — {branchLabel(subjectsSession.branchCode)} · {subjectsSession.sessionCode}
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  Subjects and teachers derived from the timetable for every class. Uncheck anything not graded on the report card,
                  flip the scholastic / co-scholastic guess if needed, then add. Already-mapped subjects are greyed out and skipped.
                </p>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {groups.length === 0 ? (
                  <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No classes found in the timetable for <strong>{branchLabel(subjectsSession.branchCode)}</strong>. Add periods in the Timetable section first.
                  </div>
                ) : groups.map(([cls, items]) => {
                  const clsNew = items.filter(({ r }) => !r.exists)
                  const clsSel = clsNew.filter(({ r }) => r.include)
                  return (
                    <div key={cls}>
                      <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 22px', background: 'var(--gray-50)', borderTop: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{cls}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{clsSel.length}/{clsNew.length} selected</span>
                          <button onClick={() => setClassInclude(cls, true)}  disabled={clsNew.length === 0} style={miniBtn(clsNew.length === 0)}>All</button>
                          <button onClick={() => setClassInclude(cls, false)} disabled={clsNew.length === 0} style={miniBtn(clsNew.length === 0)}>None</button>
                        </span>
                      </div>
                      {items.map(({ r, idx }) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 22px', borderBottom: '1px solid var(--gray-50)', opacity: r.exists ? 0.5 : 1 }}>
                          <input
                            type="checkbox"
                            checked={r.include}
                            disabled={r.exists}
                            onChange={e => updateBuildRow(idx, { include: e.target.checked })}
                            style={{ flexShrink: 0, width: 16, height: 16, cursor: r.exists ? 'not-allowed' : 'pointer' }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
                              {r.subjectName}
                              {r.exists && <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>· already mapped</span>}
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                              {r.teacherName ? `Teacher: ${r.teacherName}` : 'No teacher in timetable'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            {['scholastic', 'co_scholastic'].map(k => (
                              <button
                                key={k}
                                onClick={() => !r.exists && updateBuildRow(idx, { kind: k })}
                                disabled={r.exists}
                                style={{
                                  padding: '4px 9px', borderRadius: 6, fontSize: 10.5, fontWeight: 600,
                                  border: '1px solid ' + (r.kind === k ? 'var(--green)' : 'var(--gray-200)'),
                                  background: r.kind === k ? 'var(--green-light)' : 'var(--white)',
                                  color: r.kind === k ? 'var(--green-dark)' : 'var(--text-muted)',
                                  cursor: r.exists ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {k === 'scholastic' ? 'Scholastic' : 'Co-Sch.'}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>

              <div style={{ padding: '14px 22px', borderTop: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {selected.length} of {newRows.length} new subjects · {classCount} class{classCount === 1 ? '' : 'es'}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowBuildAll(false)} disabled={buildingAll} style={{ padding: '8px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--white)', color: 'var(--text-muted)', border: '1px solid var(--gray-200)', fontSize: 13, fontWeight: 500, cursor: buildingAll ? 'not-allowed' : 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={commitBuildAll} disabled={buildingAll || selected.length === 0} style={btn('primary', buildingAll || selected.length === 0)}>
                    {buildingAll ? 'Adding…' : `Add ${selected.length} subjects`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const colLabel = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }

/**
 * SubjectCloud — class-aware draft chip picker.
 *
 * Chip clicks build up `pendingChanges` in the parent (without writing to
 * Firestore). The Save button at the bottom commits them in one sweep.
 *
 * Visual states per chip:
 *   • Outlined dashed  + name           → currently absent, no pending change
 *   • Filled green     ✓ name           → currently present, no pending change
 *   • Outlined amber   ＋ name (italic)  → pending add (will be created on Save)
 *   • Outlined amber   ✕ name (italic)  → pending remove (will be deleted on Save)
 *
 * After Save: chips snap back to absent/present (the green/outlined states),
 * pendingChanges is cleared, and "✓ Saved Successfully" briefly appears.
 */
function SubjectCloud({
  className, suggestions, addedSubjects, pendingChanges,
  onToggle, onSave, saving, saved, lookupTeacher,
}) {
  if (!suggestions || (suggestions.scholastic.length === 0 && suggestions.co_scholastic.length === 0)) {
    return null
  }
  const pendingCount = Object.keys(pendingChanges || {}).length

  const isAdded  = (name, kind) =>
    addedSubjects.some(s => (s.subjectName || '').toLowerCase() === name.toLowerCase() && s.kind === kind)
  const pendingFor = (name, kind) => pendingChanges[`${kind}__${name}`] || null

  const chip = (name, kind) => {
    const added   = isAdded(name, kind)
    const pending = pendingFor(name, kind)            // 'add' | 'remove' | null
    const teacher = !added && !pending ? lookupTeacher(name) : null

    let icon, border, bg, color, fontStyle
    if (pending === 'add') {
      icon = '＋'; border = '1px dashed var(--gold)'; bg = 'rgba(201,162,39,0.10)'; color = 'var(--gold-dark)'; fontStyle = 'italic'
    } else if (pending === 'remove') {
      icon = '✕'; border = '1px dashed var(--gold)'; bg = 'rgba(201,162,39,0.10)'; color = 'var(--gold-dark)'; fontStyle = 'italic'
    } else if (added) {
      icon = '✓'; border = '1px solid var(--green)'; bg = 'var(--green-light)'; color = 'var(--green-dark)'; fontStyle = 'normal'
    } else {
      icon = '+'; border = '1px dashed var(--gray-300)'; bg = 'var(--white)'; color = 'var(--text)'; fontStyle = 'normal'
    }

    const tooltip = pending === 'add'
        ? 'Pending add — click to cancel'
      : pending === 'remove'
        ? 'Pending remove — click to cancel'
      : added
        ? 'Click to mark for removal'
      : teacher
        ? `Click to add — will auto-assign ${teacher.teacherName} (from timetable)`
        : 'Click to add — no teacher in timetable; you can pick one inline after Save'

    return (
      <button
        key={`${kind}_${name}`}
        onClick={() => onToggle(name, kind)}
        title={tooltip}
        style={{
          padding: '6px 12px', borderRadius: 18,
          border, background: bg, color,
          fontSize: 12.5, fontWeight: added || pending ? 600 : 500, fontStyle,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
          transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{icon}</span>
        <span>{name}</span>
        {!added && !pending && teacher && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 2 }}>
            · {teacher.teacherName.split(' ')[0]}
          </span>
        )}
      </button>
    )
  }

  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Quick add for {className}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.55 }}>
        Click chips to mark for add (＋) or remove (✕). Teacher is auto-filled from the timetable
        when a (class × subject) slot exists. Click <strong>Save Changes</strong> to commit.
      </p>

      {suggestions.scholastic.length > 0 && (
        <div style={{ marginBottom: suggestions.co_scholastic.length > 0 ? 12 : 14 }}>
          <div style={{ ...colLabel, marginBottom: 8 }}>Scholastic</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.scholastic.map(name => chip(name, 'scholastic'))}
          </div>
        </div>
      )}

      {suggestions.co_scholastic.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...colLabel, marginBottom: 8 }}>Co-Scholastic</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.co_scholastic.map(name => chip(name, 'co_scholastic'))}
          </div>
        </div>
      )}

      {/* Save footer */}
      <div style={{
        marginTop: 4, paddingTop: 14,
        borderTop: '1px solid var(--gray-100)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
      }}>
        {saved && (
          <span style={{
            fontSize: 12.5, fontWeight: 600, color: 'var(--green)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ fontSize: 14 }}>✓</span> Saved Successfully
          </span>
        )}
        {!saved && pendingCount > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {pendingCount} unsaved change{pendingCount > 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={onSave}
          disabled={saving || pendingCount === 0}
          style={{
            padding: '8px 18px', borderRadius: 'var(--radius-sm)',
            background: (saving || pendingCount === 0) ? 'var(--gray-200)' : 'var(--green)',
            color:      (saving || pendingCount === 0) ? 'var(--gray-400)'  : 'white',
            border: 'none', fontSize: 13, fontWeight: 600,
            cursor: (saving || pendingCount === 0) ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

function SubjectRow({ subj, teachers, isLast, onSave, onDelete }) {
  const [editing,      setEditing]      = useState(false)
  const [localTeacher, setLocalTeacher] = useState(subj.assignedTeacherId || '')
  const [localOrder,   setLocalOrder]   = useState(subj.sortOrder || 0)
  const [saving,       setSaving]       = useState(false)

  // Sync if parent reloads
  useEffect(() => {
    setLocalTeacher(subj.assignedTeacherId || '')
    setLocalOrder(subj.sortOrder || 0)
  }, [subj])

  async function save() {
    setSaving(true)
    const t = teachers.find(t => t.id === localTeacher)
    await onSave({ sortOrder: Number(localOrder) || 0, assignedTeacherId: localTeacher, assignedTeacherName: t?.fullName || '' })
    setSaving(false)
    setEditing(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px',
      borderBottom: isLast ? 'none' : '1px solid var(--gray-100)',
      background: editing ? 'var(--gray-50)' : 'var(--white)',
      transition: 'background 0.15s',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{subj.subjectName}</div>
        {subj.subjectCode && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{subj.subjectCode}</div>}
      </div>
      <div style={{ width: 118 }}>
        <span style={{
          fontSize: 11, padding: '3px 9px', borderRadius: 10, fontWeight: 500,
          background: subj.kind === 'scholastic' ? 'var(--green-light)' : 'var(--gold-light)',
          color:      subj.kind === 'scholastic' ? 'var(--green)'       : 'var(--gold-dark)',
        }}>
          {subj.kind === 'scholastic' ? 'Scholastic' : 'Co-Scholastic'}
        </span>
      </div>
      {/* Optional-subject toggle — syncs to SMS in real time; Class 11
          admission forms list the subjects flagged here. */}
      <div style={{ width: 66 }}>
        <button
          onClick={() => onSave({ isOptional: !subj.isOptional })}
          title="Toggle optional subject — flagged subjects appear as choices on Class 11 admission forms (SMS)"
          style={{
            fontSize: 11, padding: '3px 9px', borderRadius: 10, fontWeight: 500,
            border: '1px solid ' + (subj.isOptional ? 'var(--gold-dark)' : 'var(--gray-200)'),
            background: subj.isOptional ? 'var(--gold-light)' : 'var(--white)',
            color: subj.isOptional ? 'var(--gold-dark)' : 'var(--text-muted)',
            cursor: 'pointer',
          }}>
          {subj.isOptional ? 'Optional' : 'Core'}
        </button>
      </div>
      <div style={{ width: 170, minWidth: 0 }}>
        {editing ? (
          <select value={localTeacher} onChange={e => setLocalTeacher(e.target.value)}
            style={{ ...inp, width: '100%', fontSize: 12, padding: '5px 8px' }}>
            <option value="">— Unassigned —</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 12, color: subj.assignedTeacherName ? 'var(--text)' : 'var(--text-muted)' }}>
            {subj.assignedTeacherName || '—'}
          </span>
        )}
      </div>
      <div style={{ width: 48 }}>
        {editing ? (
          <input type="number" min="1" value={localOrder} onChange={e => setLocalOrder(e.target.value)}
            style={{ ...inp, width: 44, textAlign: 'center', fontSize: 12, padding: '5px 6px' }} />
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subj.sortOrder}</span>
        )}
      </div>
      <div style={{ width: 76, display: 'flex', gap: 4, justifyContent: 'flex-end', flexShrink: 0 }}>
        {editing ? (
          <>
            <button onClick={save} disabled={saving} style={{ fontSize: 12, padding: '5px 10px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 4, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {saving ? '…' : '✓'}
            </button>
            <button onClick={() => setEditing(false)} style={{ fontSize: 12, padding: '5px 9px', background: 'var(--gray-100)', color: 'var(--text-muted)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✕</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} title="Edit" style={{ fontSize: 12, padding: '5px 9px', background: 'var(--gray-50)', color: 'var(--text-muted)', border: '1px solid var(--gray-200)', borderRadius: 4, cursor: 'pointer' }}>✎</button>
            <button onClick={onDelete} title="Remove" style={{ fontSize: 12, padding: '5px 9px', background: 'var(--crimson-light)', color: 'var(--crimson)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>✕</button>
          </>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: 44 }}>
      <div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 20px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', color: 'var(--text-muted)', fontSize: 13 }}>
      {text}
    </div>
  )
}
