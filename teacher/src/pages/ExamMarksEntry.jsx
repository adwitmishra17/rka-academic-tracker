import React, { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, getDoc, setDoc, getDocs, updateDoc,
  query, where, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const paperDocId = (subjectId, termId) => `${subjectId}_${termId}`

function pct(marks, max) { return max > 0 ? Math.round((marks / max) * 100) : 0 }

const inp = {
  padding: '8px 11px', border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)', fontSize: 13,
  color: 'var(--text)', background: 'var(--white)', outline: 'none',
  fontFamily: 'var(--font-body)', width: '100%',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExamMarksEntry() {
  const { teacher, user } = useAuth()

  // Step state: 'subjects' → 'terms' → 'paper-setup' → 'entry' → 'review'
  const [step, setStep] = useState('subjects')

  // Step 1: assigned scholastic subjects
  const [mySubjects,    setMySubjects]    = useState([])
  const [loadingSubjs,  setLoadingSubjs]  = useState(true)

  // Step 2: selected subject + terms
  const [selSubject,    setSelSubject]    = useState(null)
  const [terms,         setTerms]         = useState([])
  const [loadingTerms,  setLoadingTerms]  = useState(false)
  const [selTerm,       setSelTerm]       = useState(null)

  // Step 3: paper config (max/pass marks)
  const [paper,         setPaper]         = useState(null)   // null = not yet loaded
  const [paperDraft,    setPaperDraft]    = useState({ maxMarks: '', passingMarks: '', examDate: '' })
  const [paperSaving,   setPaperSaving]   = useState(false)

  // Step 4: student marks entry
  const [students,      setStudents]      = useState([])
  const [loadingEntry,  setLoadingEntry]  = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [showReview,    setShowReview]    = useState(false)

  // ── Load assigned scholastic subjects ──────────────────────────────────────
  useEffect(() => {
    if (!teacher?.id) { setLoadingSubjs(false); return }
    ;(async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'examSubjects'),
          where('assignedTeacherId', '==', teacher.id),
          where('kind', '==', 'scholastic'),
        ))
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        // Sort: session desc, then class, then sortOrder
        list.sort((a, b) =>
          b.sessionCode.localeCompare(a.sessionCode) ||
          (a.className || '').localeCompare(b.className || '') ||
          (a.sortOrder || 0) - (b.sortOrder || 0)
        )
        setMySubjects(list)
      } catch (e) { console.error('load examSubjects:', e) }
      setLoadingSubjs(false)
    })()
  }, [teacher?.id])

  // ── Load terms for selected subject ───────────────────────────────────────
  const loadTerms = useCallback(async (subj) => {
    setLoadingTerms(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'examTerms'),
        where('branchCode',  '==', subj.branchCode),
        where('sessionCode', '==', subj.sessionCode),
      ))
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      setTerms(list)
    } catch (e) { console.error('load examTerms:', e) }
    setLoadingTerms(false)
  }, [])

  // ── Load paper config + students + existing marks ──────────────────────────
  const loadEntry = useCallback(async (subj, term) => {
    setLoadingEntry(true)
    setPaper(null)
    try {
      // Paper config
      const pId   = paperDocId(subj.id, term.id)
      const pSnap = await getDoc(doc(db, 'examPapers', pId))
      if (pSnap.exists()) {
        const p = pSnap.data()
        setPaper(p)
        setPaperDraft({ maxMarks: String(p.maxMarks || ''), passingMarks: String(p.passingMarks || ''), examDate: p.examDate || '' })
      } else {
        setPaper(null)  // triggers paper-setup step
        setPaperDraft({ maxMarks: '', passingMarks: '', examDate: '' })
      }

      // Student roster — active only
      const rosterSnap = await getDocs(query(
        collection(db, 'students'),
        where('className',  '==', subj.className),
        where('branchCode', '==', subj.branchCode),
        where('isActive',   '==', true),
      ))
      const roster = new Map()
      rosterSnap.forEach(d => {
        const s = d.data()
        const roll = String(s.rollNumber || '').trim()
        if (roll) roster.set(roll, { studentId: d.id, fullName: s.fullName || '', rollNumber: roll })
      })

      // Existing marks
      const marksSnap = await getDocs(query(
        collection(db, 'examMarks'),
        where('subjectId', '==', subj.id),
        where('termId',    '==', term.id),
      ))
      const existingByStudentId = new Map()
      marksSnap.forEach(d => {
        const m = d.data()
        if (m.studentId) existingByStudentId.set(m.studentId, { docId: d.id, ...m })
      })

      // Merge roster + existing
      const merged = []
      for (const [, info] of roster.entries()) {
        const ex = existingByStudentId.get(info.studentId)
        merged.push({
          docId:      ex?.docId  || null,
          studentId:  info.studentId,
          rollNumber: info.rollNumber,
          name:       info.fullName,
          marks:      ex?.isAbsent ? '' : (ex?.marksObtained != null ? String(ex.marksObtained) : ''),
          isAbsent:   ex?.isAbsent || false,
          remarks:    ex?.remarks || '',
        })
      }
      merged.sort((a, b) => Number(a.rollNumber || 0) - Number(b.rollNumber || 0))
      setStudents(merged)
    } catch (e) { console.error('loadEntry:', e) }
    setLoadingEntry(false)
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function pickSubject(subj) {
    setSelSubject(subj)
    setSelTerm(null)
    setTerms([])
    setPaper(null)
    setStudents([])
    setStep('terms')
    loadTerms(subj)
  }

  function pickTerm(term) {
    setSelTerm(term)
    setStep('loading-entry')
    loadEntry(selSubject, term).then(() => {
      // After loading, decide step: paper-setup or entry
      setStep('_check')
    })
  }

  // After loadEntry completes, determine correct step
  useEffect(() => {
    if (step !== '_check') return
    setStep(paper === null ? 'paper-setup' : 'entry')
  }, [step, paper])

  async function savePaper() {
    const max  = Number(paperDraft.maxMarks)
    const pass = Number(paperDraft.passingMarks)
    if (!max || max <= 0) return
    setPaperSaving(true)
    try {
      const pId = paperDocId(selSubject.id, selTerm.id)
      const data = {
        subjectId:    selSubject.id,
        termId:       selTerm.id,
        branchCode:   selSubject.branchCode,
        sessionCode:  selSubject.sessionCode,
        className:    selSubject.className,
        subjectName:  selSubject.subjectName,
        termName:     selTerm.name,
        termShortCode:selTerm.shortCode,
        maxMarks:     max,
        passingMarks: pass || 0,
        examDate:     paperDraft.examDate || '',
        createdAt:    Timestamp.now(),
        createdBy:    user?.email || teacher?.email || '',
      }
      await setDoc(doc(db, 'examPapers', pId), data, { merge: true })
      setPaper(data)
      setStep('entry')
    } catch (e) { console.error('savePaper:', e) }
    setPaperSaving(false)
  }

  function updateStudent(idx, field, value) {
    if (field === 'marks' && value !== '' && paper) {
      const num = Number(value)
      if (isNaN(num)) return
      if (num < 0) value = '0'
      if (num > paper.maxMarks) value = String(paper.maxMarks)
    }
    setStudents(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  async function handleSave() {
    if (!selSubject || !selTerm || !paper) return
    setSaving(true)
    try {
      const now   = Timestamp.now()
      const email = user?.email || teacher?.email || ''
      const pId   = paperDocId(selSubject.id, selTerm.id)

      for (const s of students) {
        const marksNum = s.isAbsent ? null : (s.marks !== '' ? Number(s.marks) : null)
        const data = {
          subjectId:    selSubject.id,
          termId:       selTerm.id,
          paperId:      pId,
          studentId:    s.studentId,
          studentName:  s.name,
          className:    selSubject.className,
          branchCode:   selSubject.branchCode,
          sessionCode:  selSubject.sessionCode,
          marksObtained:marksNum,
          maxMarks:     paper.maxMarks,
          passingMarks: paper.passingMarks || 0,
          isAbsent:     s.isAbsent,
          remarks:      s.remarks || '',
          enteredBy:    email,
          enteredAt:    now,
          source:       'teacher_pwa',
        }
        if (s.docId) {
          await updateDoc(doc(db, 'examMarks', s.docId), data)
        } else {
          // Use deterministic doc id to prevent duplicates on retry
          const markId = `${pId}_${s.studentId}`
          await setDoc(doc(db, 'examMarks', markId), data, { merge: true })
        }
      }
      setSaved(true)
    } catch (e) { console.error('handleSave:', e) }
    setSaving(false)
  }

  function reset() {
    setStep('subjects')
    setSelSubject(null)
    setSelTerm(null)
    setTerms([])
    setPaper(null)
    setStudents([])
    setSaved(false)
    setShowReview(false)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const appeared  = students.filter(s => !s.isAbsent && s.marks !== '')
  const absentCnt = students.filter(s => s.isAbsent).length
  const avg       = appeared.length ? Math.round(appeared.reduce((s, x) => s + Number(x.marks), 0) / appeared.length) : 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px' }}>
      <div className="fade-up" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>
          Enter Exam Marks
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Term-wise marks for scholastic subjects
        </p>
      </div>

      {/* Breadcrumb back buttons */}
      {(step !== 'subjects') && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={reset} style={crumbBtn}>All Subjects</button>
          {['terms', 'paper-setup', 'entry', 'review'].includes(step) && selSubject && (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>
              <button onClick={() => { setStep('terms'); setSelTerm(null) }} style={crumbBtn}>
                {selSubject.subjectName} · {selSubject.className}
              </button>
            </>
          )}
          {['paper-setup', 'entry', 'review'].includes(step) && selTerm && (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>
              <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{selTerm.name}</span>
            </>
          )}
        </div>
      )}

      {/* ── STEP: subjects ── */}
      {step === 'subjects' && (
        loadingSubjs ? <Spinner /> :
        mySubjects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 20px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)' }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>No scholastic subjects assigned</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ask the admin to assign you to subjects in Report Card Setup.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mySubjects.map(s => (
              <button key={s.id} onClick={() => pickSubject(s)} style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.15s' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{s.subjectName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.className} · {s.sessionCode} · {s.branchCode}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        )
      )}

      {/* ── STEP: terms ── */}
      {step === 'terms' && (
        <>
          <SubjectHeader subj={selSubject} />
          {loadingTerms ? <Spinner /> :
          terms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', color: 'var(--text-muted)', fontSize: 13 }}>
              No terms configured yet. Ask the admin to initialise terms in Report Card Setup.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {terms.map(t => (
                <button key={t.id} onClick={() => pickTerm(t)} style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '16px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{t.name}</div>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: 'var(--gold-light)', color: 'var(--gold-dark)', fontWeight: 600 }}>{t.shortCode}</span>
                  {t.startsOn && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t.startsOn} – {t.endsOn || '?'}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── STEP: loading entry ── */}
      {(step === 'loading-entry' || step === '_check') && <Spinner />}

      {/* ── STEP: paper setup ── */}
      {step === 'paper-setup' && (
        <>
          <SubjectHeader subj={selSubject} term={selTerm} />
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Paper Setup</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
              First-time setup for <strong>{selSubject?.subjectName}</strong> · <strong>{selTerm?.name}</strong>. Set the marks schema before entering individual scores.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Max Marks *</label>
                <input type="number" min="1" value={paperDraft.maxMarks} onChange={e => setPaperDraft(p => ({ ...p, maxMarks: e.target.value }))} placeholder="e.g. 100" style={{ ...inp }} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Passing Marks</label>
                <input type="number" min="0" value={paperDraft.passingMarks} onChange={e => setPaperDraft(p => ({ ...p, passingMarks: e.target.value }))} placeholder="e.g. 33" style={{ ...inp }} />
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Exam Date (opt.)</label>
                <input type="date" value={paperDraft.examDate} onChange={e => setPaperDraft(p => ({ ...p, examDate: e.target.value }))} style={{ ...inp }} />
              </div>
            </div>
            <button onClick={savePaper} disabled={paperSaving || !paperDraft.maxMarks} style={{ padding: '10px 24px', background: !paperDraft.maxMarks ? 'var(--gray-200)' : 'var(--green)', color: !paperDraft.maxMarks ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 14, fontWeight: 600, cursor: !paperDraft.maxMarks ? 'not-allowed' : 'pointer' }}>
              {paperSaving ? 'Saving…' : 'Continue to Mark Entry →'}
            </button>
          </div>
        </>
      )}

      {/* ── STEP: entry ── */}
      {step === 'entry' && paper && (
        <>
          <SubjectHeader subj={selSubject} term={selTerm} />

          {/* Paper info */}
          <div style={{ background: 'var(--green-light)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--green-dark)', fontWeight: 500 }}>Max: <strong>{paper.maxMarks}</strong></span>
            {paper.passingMarks > 0 && <span style={{ fontSize: 13, color: 'var(--green-dark)', fontWeight: 500 }}>Pass: <strong>{paper.passingMarks}</strong></span>}
            {paper.examDate && <span style={{ fontSize: 12, color: 'var(--green-mid)' }}>{paper.examDate}</span>}
            <button onClick={() => setStep('paper-setup')} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--green)', background: 'none', border: '1px solid var(--green-muted)', borderRadius: 4, padding: '3px 9px', cursor: 'pointer' }}>Edit</button>
          </div>

          {/* Stats */}
          {students.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { label: 'Students', value: students.length },
                { label: 'Absent',   value: absentCnt, color: absentCnt > 0 ? 'var(--crimson)' : 'var(--text)' },
                { label: 'Class avg', value: appeared.length ? `${pct(avg, paper.maxMarks)}%` : '—', color: appeared.length && pct(avg, paper.maxMarks) >= pct(paper.passingMarks, paper.maxMarks) ? 'var(--green)' : 'var(--text)' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--white)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-100)', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color || 'var(--text)', fontFamily: 'var(--font-display)' }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Student rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {students.map((s, i) => (
              <div key={s.studentId} style={{ background: s.isAbsent ? 'var(--crimson-light)' : 'var(--white)', borderRadius: 'var(--radius-md)', border: `1px solid ${s.isAbsent ? 'rgba(139,26,26,0.15)' : 'var(--gray-100)'}`, padding: '12px 14px', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: s.isAbsent ? 0 : 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.isAbsent ? 'var(--crimson)' : 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: s.isAbsent ? 'white' : 'var(--green)' }}>{s.rollNumber}</span>
                  </div>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{s.name}</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flexShrink: 0 }}>
                    <input type="checkbox" checked={s.isAbsent} onChange={e => updateStudent(i, 'isAbsent', e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--crimson)' }} />
                    <span style={{ fontSize: 11, color: s.isAbsent ? 'var(--crimson)' : 'var(--text-muted)', fontWeight: s.isAbsent ? 600 : 400 }}>Absent</span>
                  </label>
                </div>
                {!s.isAbsent && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="number" min="0" max={paper.maxMarks} step="0.5"
                      value={s.marks} onChange={e => updateStudent(i, 'marks', e.target.value)}
                      placeholder="Marks"
                      style={{ width: 80, padding: '7px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 14, textAlign: 'center', outline: 'none' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {paper.maxMarks}</span>
                    {s.marks !== '' && (
                      <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 'auto', color: pct(Number(s.marks), paper.maxMarks) >= pct(paper.passingMarks, paper.maxMarks) ? 'var(--green)' : 'var(--crimson)' }}>
                        {pct(Number(s.marks), paper.maxMarks)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <button onClick={() => setShowReview(true)} disabled={saving || students.length === 0} style={{ width: '100%', padding: '15px', background: saving || students.length === 0 ? 'var(--gray-200)' : 'var(--green)', color: saving || students.length === 0 ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600, cursor: saving || students.length === 0 ? 'not-allowed' : 'pointer', boxShadow: '0 4px 14px rgba(26,74,46,0.2)' }}>
            Review & Save ({students.length} students)
          </button>
        </>
      )}

      {/* ── Review modal ── */}
      {showReview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', width: '100%', maxWidth: 520, maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--gray-100)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--green-dark)' }}>Review entries</h3>
                <button onClick={() => setShowReview(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1, padding: 4 }}>×</button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selSubject?.subjectName} · {selTerm?.name} · Max {paper?.maxMarks}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Badge label={`${appeared.length} appeared`} color="var(--green)" bg="var(--green-light)" />
                <Badge label={`${absentCnt} absent`}          color="var(--crimson)" bg="var(--crimson-light)" />
                <Badge label={`${students.length - appeared.length - absentCnt} blank`} color="var(--gold-dark)" bg="var(--gold-light)" />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
              {students.map((s, i) => {
                const blank  = !s.isAbsent && (s.marks === '' || s.marks == null)
                const marksN = blank ? null : (s.isAbsent ? null : Number(s.marks))
                const p      = marksN != null && paper ? pct(marksN, paper.maxMarks) : null
                const passed = p != null && paper?.passingMarks ? marksN >= paper.passingMarks : null
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i === students.length - 1 ? 'none' : '1px solid var(--gray-100)' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: s.isAbsent ? 'var(--crimson)' : blank ? 'var(--gold-light)' : 'var(--green-light)', color: s.isAbsent ? 'white' : blank ? 'var(--gold-dark)' : 'var(--green)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.rollNumber}</div>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {s.isAbsent ? <span style={{ fontSize: 11, color: 'var(--crimson)', fontWeight: 600 }}>Absent</span>
                       : blank    ? <span style={{ fontSize: 11, color: 'var(--gold-dark)', fontWeight: 600 }}>—</span>
                       : <div>
                           <div style={{ fontSize: 13, fontWeight: 600, color: passed ? 'var(--green)' : 'var(--crimson)' }}>{s.marks}<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>/{paper?.maxMarks}</span></div>
                           {p != null && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p}%</div>}
                         </div>}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '14px 20px 20px', borderTop: '1px solid var(--gray-100)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowReview(false)} style={{ flex: 1, padding: '12px', background: 'var(--white)', color: 'var(--green)', border: '1.5px solid var(--green-muted)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>← Edit</button>
                <button onClick={async () => { setShowReview(false); await handleSave() }} disabled={saving} style={{ flex: 2, padding: '12px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(26,74,46,0.2)' }}>
                  {saving ? 'Saving…' : 'Confirm & Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Success modal ── */}
      {saved && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>Marks saved</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{selSubject?.subjectName} · {selTerm?.name} · {students.length} students</p>
            <button onClick={reset} style={{ width: '100%', padding: '11px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

const crumbBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--green)', fontWeight: 500, padding: 0, textDecoration: 'underline' }

function SubjectHeader({ subj, term }) {
  if (!subj) return null
  return (
    <div style={{ background: 'var(--green-dark)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 16, color: 'white' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{subj.subjectName}</div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        {subj.className} · {subj.sessionCode} · {subj.branchCode}
        {term && ` · ${term.name}`}
      </div>
    </div>
  )
}

function Badge({ label, color, bg }) {
  return <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: bg, color, fontWeight: 600 }}>{label}</span>
}

function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: 48 }}>
      <div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
    </div>
  )
}
