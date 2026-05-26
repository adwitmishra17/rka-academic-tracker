import React, { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, setDoc, getDocs, updateDoc,
  query, where, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'

// ─── Constants ────────────────────────────────────────────────────────────────

const GRADES = ['A+', 'A', 'B+', 'B', 'C', 'D']

const GRADE_COLOR = { 'A+': 'var(--green)', 'A': 'var(--green)', 'B+': 'var(--gold-dark)', 'B': 'var(--gold-dark)', 'C': 'var(--crimson)', 'D': 'var(--crimson)' }
const GRADE_BG    = { 'A+': 'var(--green-light)', 'A': 'var(--green-light)', 'B+': 'var(--gold-light)', 'B': 'var(--gold-light)', 'C': 'var(--crimson-light)', 'D': 'var(--crimson-light)' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExamGradesEntry() {
  const { teacher, user } = useAuth()

  const [step, setStep] = useState('subjects')

  const [mySubjects,   setMySubjects]   = useState([])
  const [loadingSubjs, setLoadingSubjs] = useState(true)

  const [selSubject,   setSelSubject]   = useState(null)
  const [terms,        setTerms]        = useState([])
  const [loadingTerms, setLoadingTerms] = useState(false)
  const [selTerm,      setSelTerm]      = useState(null)

  const [students,     setStudents]     = useState([])
  const [loadingEntry, setLoadingEntry] = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)

  // ── Load assigned co-scholastic subjects ───────────────────────────────────
  useEffect(() => {
    if (!teacher?.id) { setLoadingSubjs(false); return }
    ;(async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'examSubjects'),
          where('assignedTeacherId', '==', teacher.id),
          where('kind', '==', 'co_scholastic'),
        ))
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        list.sort((a, b) =>
          b.sessionCode.localeCompare(a.sessionCode) ||
          (a.className || '').localeCompare(b.className || '') ||
          (a.sortOrder || 0) - (b.sortOrder || 0)
        )
        setMySubjects(list)
      } catch (e) { console.error('load co_scholastic subjects:', e) }
      setLoadingSubjs(false)
    })()
  }, [teacher?.id])

  // ── Load terms ─────────────────────────────────────────────────────────────
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
    } catch (e) { console.error('load terms:', e) }
    setLoadingTerms(false)
  }, [])

  // ── Load students + existing grades ────────────────────────────────────────
  const loadEntry = useCallback(async (subj, term) => {
    setLoadingEntry(true)
    try {
      // Roster
      const rosterSnap = await getDocs(query(
        collection(db, 'students'),
        where('className',  '==', subj.className),
        where('branchCode', '==', subj.branchCode),
        where('isActive',   '==', true),
      ))
      const roster = new Map()
      rosterSnap.forEach(d => {
        const s    = d.data()
        const roll = String(s.rollNumber || '').trim()
        if (roll) roster.set(roll, { studentId: d.id, fullName: s.fullName || '', rollNumber: roll })
      })

      // Existing grades
      const gradesSnap = await getDocs(query(
        collection(db, 'examCoschGrades'),
        where('subjectId', '==', subj.id),
        where('termId',    '==', term.id),
      ))
      const existingById = new Map()
      gradesSnap.forEach(d => {
        const g = d.data()
        if (g.studentId) existingById.set(g.studentId, { docId: d.id, ...g })
      })

      // Merge
      const merged = []
      for (const [, info] of roster.entries()) {
        const ex = existingById.get(info.studentId)
        merged.push({
          docId:     ex?.docId   || null,
          studentId: info.studentId,
          rollNumber:info.rollNumber,
          name:      info.fullName,
          grade:     ex?.grade   || '',
          remarks:   ex?.remarks || '',
        })
      }
      merged.sort((a, b) => Number(a.rollNumber || 0) - Number(b.rollNumber || 0))
      setStudents(merged)
    } catch (e) { console.error('loadEntry grades:', e) }
    setLoadingEntry(false)
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function pickSubject(subj) {
    setSelSubject(subj); setSelTerm(null); setTerms([]); setStudents([])
    setStep('terms')
    loadTerms(subj)
  }

  async function pickTerm(term) {
    setSelTerm(term); setStep('loading-entry')
    await loadEntry(selSubject, term)
    setStep('entry')
  }

  function updateStudent(idx, field, value) {
    setStudents(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  async function handleSave() {
    if (!selSubject || !selTerm) return
    setSaving(true)
    try {
      const now   = Timestamp.now()
      const email = user?.email || teacher?.email || ''
      for (const s of students) {
        const data = {
          subjectId:   selSubject.id,
          termId:      selTerm.id,
          studentId:   s.studentId,
          studentName: s.name,
          className:   selSubject.className,
          branchCode:  selSubject.branchCode,
          sessionCode: selSubject.sessionCode,
          grade:       s.grade,
          remarks:     s.remarks || '',
          enteredBy:   email,
          enteredAt:   now,
          source:      'teacher_pwa',
        }
        const gradeId = `${selSubject.id}_${selTerm.id}_${s.studentId}`
        if (s.docId) {
          await updateDoc(doc(db, 'examCoschGrades', s.docId), data)
        } else {
          await setDoc(doc(db, 'examCoschGrades', gradeId), data, { merge: true })
        }
      }
      setSaved(true)
    } catch (e) { console.error('handleSave grades:', e) }
    setSaving(false)
  }

  function reset() {
    setStep('subjects'); setSelSubject(null); setSelTerm(null)
    setTerms([]); setStudents([]); setSaved(false)
  }

  const gradedCount = students.filter(s => s.grade).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px' }}>
      <div className="fade-up" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>
          Enter Co-Scholastic Grades
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          A+/A/B+/B/C/D qualitative grades per term
        </p>
      </div>

      {/* Breadcrumb */}
      {step !== 'subjects' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={reset} style={crumbBtn}>All Subjects</button>
          {selSubject && (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>
              <button onClick={() => { setStep('terms'); setSelTerm(null) }} style={crumbBtn}>
                {selSubject.subjectName} · {selSubject.className}
              </button>
            </>
          )}
          {selTerm && (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>
              <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{selTerm.name}</span>
            </>
          )}
        </div>
      )}

      {/* STEP: subjects */}
      {step === 'subjects' && (
        loadingSubjs ? <Spinner /> :
        mySubjects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 20px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)' }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>No co-scholastic subjects assigned</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ask the admin to assign you to subjects in Report Card Setup.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mySubjects.map(s => (
              <button key={s.id} onClick={() => pickSubject(s)} style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.15s' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--gold-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="1.8"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
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

      {/* STEP: terms */}
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
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* STEP: loading */}
      {step === 'loading-entry' && <Spinner />}

      {/* STEP: entry */}
      {step === 'entry' && (
        <>
          <SubjectHeader subj={selSubject} term={selTerm} />

          {/* Progress */}
          <div style={{ background: 'var(--gold-light)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--gold-dark)', fontWeight: 500 }}>
              Graded: <strong>{gradedCount}</strong> / {students.length}
            </span>
            {gradedCount === students.length && students.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ All graded</span>
            )}
          </div>

          {/* Student cards */}
          {loadingEntry ? <Spinner /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {students.map((s, i) => (
                <div key={s.studentId} style={{ background: 'var(--white)', border: `1px solid ${s.grade ? 'var(--green-muted)' : 'var(--gray-100)'}`, borderRadius: 'var(--radius-md)', padding: '14px 16px', transition: 'all 0.15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)' }}>{s.rollNumber}</span>
                    </div>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{s.name}</span>
                    {s.grade && (
                      <span style={{ fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: GRADE_BG[s.grade] || 'var(--gray-100)', color: GRADE_COLOR[s.grade] || 'var(--text)' }}>
                        {s.grade}
                      </span>
                    )}
                  </div>
                  {/* Grade picker */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {GRADES.map(g => (
                      <button key={g} onClick={() => updateStudent(i, 'grade', s.grade === g ? '' : g)} style={{
                        padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        border: s.grade === g ? '2px solid currentColor' : '1.5px solid var(--gray-200)',
                        borderRadius: 8,
                        background: s.grade === g ? (GRADE_BG[g] || 'var(--gray-100)') : 'var(--white)',
                        color: s.grade === g ? (GRADE_COLOR[g] || 'var(--text)') : 'var(--text-muted)',
                        transition: 'all 0.12s',
                      }}>{g}</button>
                    ))}
                  </div>
                  {/* Remarks */}
                  <input
                    value={s.remarks}
                    onChange={e => updateStudent(i, 'remarks', e.target.value)}
                    placeholder="Remarks (optional)"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'var(--font-body)', background: 'var(--gray-50)', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
            </div>
          )}

          <button onClick={handleSave} disabled={saving || students.length === 0} style={{ width: '100%', padding: '15px', background: saving || students.length === 0 ? 'var(--gray-200)' : 'var(--green)', color: saving || students.length === 0 ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600, cursor: saving || students.length === 0 ? 'not-allowed' : 'pointer', boxShadow: '0 4px 14px rgba(26,74,46,0.2)' }}>
            {saving ? 'Saving…' : `Save Grades (${students.length} students)`}
          </button>
        </>
      )}

      {/* Success */}
      {saved && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>Grades saved</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{selSubject?.subjectName} · {selTerm?.name}</p>
            <button onClick={reset} style={{ width: '100%', padding: '11px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const crumbBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--green)', fontWeight: 500, padding: 0, textDecoration: 'underline' }

function SubjectHeader({ subj, term }) {
  if (!subj) return null
  return (
    <div style={{ background: 'var(--gold)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 16, color: 'white' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{subj.subjectName}</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>
        {subj.className} · {subj.sessionCode} · {subj.branchCode}
        {term && ` · ${term.name}`}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: 48 }}>
      <div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
    </div>
  )
}
