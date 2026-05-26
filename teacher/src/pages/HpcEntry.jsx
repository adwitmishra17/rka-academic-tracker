import React, { useState, useEffect, useCallback } from 'react'
import {
  collection, doc, getDoc, setDoc, getDocs,
  query, where, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import {
  HPC_CLASSES, DOMAIN_KEYS, DOMAINS, RATINGS,
  RATING_LABELS, RATING_COLORS, RATING_BG,
  emptyDomains, suggestDomainRating, isComplete,
} from '../lib/hpc'
import { getTeacherClasses } from '../utils/teacherClasses'

// ─── Component ────────────────────────────────────────────────────────────────

export default function HpcEntry() {
  const { teacher, user } = useAuth()

  // Step: 'pick' → 'loading' → 'form'
  const [step,         setStep]         = useState('pick')

  // Pick step state
  const [myHpcClasses, setMyHpcClasses] = useState([])
  const [sessions,     setSessions]     = useState([])
  const [terms,        setTerms]        = useState([])
  const [students,     setStudents]     = useState([])
  const [loadingPick,  setLoadingPick]  = useState(true)

  const [selSession,   setSelSession]   = useState(null)
  const [selClass,     setSelClass]     = useState('')
  const [selTerm,      setSelTerm]      = useState(null)
  const [selStudent,   setSelStudent]   = useState(null)

  // Form state
  const [domains,        setDomains]        = useState(emptyDomains)
  const [generalRemarks, setGeneralRemarks] = useState('')
  const [existingDocId,  setExistingDocId]  = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)

  // Derived
  const complete = isComplete(domains)
  const branchCode = teacher?.branchCodes?.[0] || 'MAIN'

  // ── Bootstrap: load teacher's HPC classes + active sessions ───────────────
  useEffect(() => {
    if (!teacher) return
    ;(async () => {
      setLoadingPick(true)
      try {
        // Teacher's assigned classes
        const allClasses = await getTeacherClasses(teacher, user)
        const hpc        = allClasses.filter(c => HPC_CLASSES.includes(c))
        setMyHpcClasses(hpc)

        if (hpc.length === 0) { setLoadingPick(false); return }

        // Active sessions for this teacher's branch
        const snap = await getDocs(query(
          collection(db, 'examSessions'),
          where('branchCode', '==', branchCode),
          where('isActive',   '==', true),
        ))
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setSessions(list)

        if (hpc.length === 1) setSelClass(hpc[0])
        if (list.length === 1) setSelSession(list[0])
      } catch (e) { console.error('HpcEntry bootstrap:', e) }
      setLoadingPick(false)
    })()
  }, [teacher, user, branchCode])

  // Load terms when session selected
  useEffect(() => {
    if (!selSession) { setTerms([]); return }
    ;(async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'examTerms'),
          where('branchCode',  '==', selSession.branchCode),
          where('sessionCode', '==', selSession.sessionCode),
        ))
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        setTerms(list)
      } catch (e) { console.error('load terms:', e) }
    })()
  }, [selSession])

  // Load students when class + session selected
  useEffect(() => {
    if (!selClass || !selSession) { setStudents([]); return }
    ;(async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'students'),
          where('className',  '==', selClass),
          where('branchCode', '==', branchCode),
          where('isActive',   '==', true),
        ))
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => Number(a.rollNumber || 0) - Number(b.rollNumber || 0))
        setStudents(list)
      } catch (e) { console.error('load students:', e) }
    })()
  }, [selClass, selSession, branchCode])

  // ── Load existing HPC assessment ──────────────────────────────────────────
  const loadAssessment = useCallback(async (student, term) => {
    if (!student || !term) return
    setStep('loading')
    try {
      // Deterministic doc ID: prevents duplicate assessments per (student, term)
      const docId = `${student.id}_${term.id}`
      const snap  = await getDoc(doc(db, 'hpcAssessments', docId))
      if (snap.exists()) {
        const data = snap.data()
        if (!data.isVoid) {
          setDomains(data.domains || emptyDomains())
          setGeneralRemarks(data.generalRemarks || '')
          setExistingDocId(docId)
        } else {
          setDomains(emptyDomains())
          setGeneralRemarks('')
          setExistingDocId(null)
        }
      } else {
        setDomains(emptyDomains())
        setGeneralRemarks('')
        setExistingDocId(null)
      }
    } catch (e) { console.error('loadAssessment:', e) }
    setStep('form')
  }, [])

  // ── Domain/indicator updates ───────────────────────────────────────────────

  function setIndicator(domainKey, indicatorKey, rating) {
    setDomains(prev => {
      const updated   = { ...prev, [domainKey]: { ...prev[domainKey], indicators: { ...prev[domainKey].indicators, [indicatorKey]: rating } } }
      // Auto-suggest domain rating from indicators, but only if not manually overridden
      const suggested = suggestDomainRating(updated[domainKey].indicators)
      return { ...updated, [domainKey]: { ...updated[domainKey], rating: suggested } }
    })
  }

  function setDomainRating(domainKey, rating) {
    setDomains(prev => ({ ...prev, [domainKey]: { ...prev[domainKey], rating } }))
  }

  function setDomainRemark(domainKey, remarks) {
    setDomains(prev => ({ ...prev, [domainKey]: { ...prev[domainKey], remarks } }))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selStudent || !selTerm || !selSession) return
    setSaving(true)
    try {
      const docId = `${selStudent.id}_${selTerm.id}`
      const now   = Timestamp.now()
      const email = user?.email || teacher?.email || ''
      const data  = {
        studentId:   selStudent.id,
        termId:      selTerm.id,
        branchCode,
        sessionCode: selSession.sessionCode,
        className:   selClass,
        // Student snapshot (frozen for printing — changes to student record won't affect printed HPC)
        studentName: selStudent.fullName || '',
        admissionNo: selStudent.admissionNo || '',
        rollNumber:  String(selStudent.rollNumber || ''),
        dateOfBirth: selStudent.dateOfBirth  || '',
        fatherName:  selStudent.fatherName   || '',
        motherName:  selStudent.motherName   || '',
        photoKey:    selStudent.photoKey     || '',
        // Assessment payload
        domains,
        generalRemarks,
        source:      'teacher_pwa',
        assessedAt:  now,
        assessedBy:  email,
        isVoid:      false,
      }
      await setDoc(doc(db, 'hpcAssessments', docId), data, { merge: true })
      setExistingDocId(docId)
      setSaved(true)
    } catch (e) { console.error('handleSave HPC:', e) }
    setSaving(false)
  }

  function reset() {
    setStep('pick'); setSelStudent(null); setSelTerm(null)
    setDomains(emptyDomains()); setGeneralRemarks('')
    setExistingDocId(null); setSaved(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px' }}>
      <div className="fade-up" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)' }}>
          HPC Assessment
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Holistic Progress Card · NEP 2020 · Nursery–Class 2
        </p>
      </div>

      {/* STEP: pick */}
      {step === 'pick' && (
        <div className="fade-up">
          {loadingPick ? <Spinner /> :
          myHpcClasses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '44px 20px', background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)' }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>No HPC classes assigned</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>HPC is for Nursery, LKG, UKG, Class 1 and Class 2. You'll see this form once you're assigned to one of those classes.</p>
            </div>
          ) : (
            <>
              {/* Session picker */}
              {sessions.length > 1 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>SESSION</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {sessions.map(s => (
                      <button key={s.id} onClick={() => setSelSession(s)} style={pickerBtn(selSession?.id === s.id)}>
                        {s.sessionCode}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {sessions.length === 0 && (
                <div style={{ padding: '14px 16px', background: 'var(--gold-light)', borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: 13, color: 'var(--gold-dark)' }}>
                  No active session found. Ask the admin to set an active session in Report Card Setup.
                </div>
              )}

              {/* Class picker */}
              {myHpcClasses.length > 1 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>CLASS</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {myHpcClasses.map(c => (
                      <button key={c} onClick={() => setSelClass(c)} style={pickerBtn(selClass === c)}>{c}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Term picker */}
              {terms.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>TERM</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {terms.map(t => (
                      <button key={t.id} onClick={() => setSelTerm(t)} style={pickerBtn(selTerm?.id === t.id)}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Student list */}
              {selSession && selClass && selTerm && students.length > 0 && (
                <>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 8, fontWeight: 600 }}>SELECT STUDENT</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {students.map(s => (
                      <button key={s.id} onClick={() => { setSelStudent(s); loadAssessment(s, selTerm) }} style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.15s' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>{s.rollNumber}</span>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{s.fullName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.admissionNo || ''}</div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* STEP: loading */}
      {step === 'loading' && <Spinner />}

      {/* STEP: form */}
      {step === 'form' && selStudent && selTerm && (
        <div className="fade-up">
          {/* Header */}
          <div style={{ background: 'var(--green-dark)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 20, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{selStudent.fullName}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{selClass} · {selTerm.name} · {selSession?.sessionCode}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {existingDocId && <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.15)', padding: '3px 8px', borderRadius: 6, letterSpacing: '0.05em' }}>UPDATING</span>}
              <button onClick={reset} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 6, padding: '6px 12px', color: 'white', fontSize: 12, cursor: 'pointer' }}>← Back</button>
            </div>
          </div>

          {/* Completion badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--gray-100)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: 'var(--green)', transition: 'width 0.3s', width: `${(DOMAIN_KEYS.filter(dk => domains[dk]?.rating).length / DOMAIN_KEYS.length) * 100}%` }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {DOMAIN_KEYS.filter(dk => domains[dk]?.rating).length} / {DOMAIN_KEYS.length} domains rated
            </span>
          </div>

          {/* Domain cards */}
          {DOMAIN_KEYS.map(dk => {
            const domain   = DOMAINS[dk]
            const dState   = domains[dk] || {}
            const filled   = Object.values(dState.indicators || {}).filter(v => RATINGS.includes(v)).length
            const total    = Object.keys(domain.indicators).length
            const domRating = dState.rating

            return (
              <div key={dk} style={{ background: 'var(--white)', border: `1px solid ${domRating ? 'var(--green-muted)' : 'var(--gray-100)'}`, borderRadius: 'var(--radius-lg)', marginBottom: 14, overflow: 'hidden' }}>
                {/* Domain header */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{domain.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{filled}/{total} indicators rated</div>
                  </div>
                  {/* Overall domain rating */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {RATINGS.map(r => (
                      <button key={r} onClick={() => setDomainRating(dk, domRating === r ? null : r)} title={RATING_LABELS[r]} style={{
                        width: 28, height: 28, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                        border: domRating === r ? '2px solid currentColor' : '1.5px solid var(--gray-200)',
                        background: domRating === r ? RATING_BG[r] : 'var(--white)',
                        color: domRating === r ? RATING_COLORS[r] : 'var(--gray-400)',
                        transition: 'all 0.12s',
                      }}>
                        {r[0].toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {domRating && (
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 8, background: RATING_BG[domRating], color: RATING_COLORS[domRating], fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {RATING_LABELS[domRating]}
                    </span>
                  )}
                </div>

                {/* Indicators */}
                <div style={{ padding: '10px 16px 4px' }}>
                  {Object.entries(domain.indicators).map(([ik, iLabel]) => {
                    const curRating = dState.indicators?.[ik] || null
                    return (
                      <div key={ik} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{iLabel}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {RATINGS.map(r => (
                            <button key={r} onClick={() => setIndicator(dk, ik, curRating === r ? null : r)} title={RATING_LABELS[r]} style={{
                              padding: '5px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                              border: curRating === r ? '2px solid currentColor' : '1.5px solid var(--gray-200)',
                              borderRadius: 6,
                              background: curRating === r ? RATING_BG[r] : 'var(--white)',
                              color: curRating === r ? RATING_COLORS[r] : 'var(--gray-400)',
                              whiteSpace: 'nowrap', transition: 'all 0.12s',
                            }}>
                              {RATING_LABELS[r]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Domain remark */}
                <div style={{ padding: '0 16px 14px' }}>
                  <input
                    value={dState.remarks || ''}
                    onChange={e => setDomainRemark(dk, e.target.value)}
                    placeholder={`Remark for ${domain.label} (optional)`}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'var(--font-body)', background: 'var(--gray-50)', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            )
          })}

          {/* General remark */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '16px 16px', marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', marginBottom: 8 }}>General Remark</label>
            <textarea
              value={generalRemarks}
              onChange={e => setGeneralRemarks(e.target.value)}
              placeholder="Overall observation for the student's progress this term…"
              rows={3}
              style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'var(--font-body)', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>

          {/* Save button */}
          {!complete && (
            <p style={{ fontSize: 12, color: 'var(--gold-dark)', marginBottom: 10, padding: '8px 12px', background: 'var(--gold-light)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(201,162,39,0.25)' }}>
              ⚠ Not all indicators are rated. You can still save — SMS will flag incomplete assessments.
            </p>
          )}
          <button onClick={handleSave} disabled={saving} style={{ width: '100%', padding: '15px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(26,74,46,0.2)', marginBottom: 32 }}>
            {saving ? 'Saving…' : existingDocId ? 'Update HPC Assessment' : 'Save HPC Assessment'}
          </button>
        </div>
      )}

      {/* Success */}
      {saved && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="fade-up" style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>HPC saved</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{selStudent?.fullName} · {selTerm?.name}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setSaved(false); setStep('form') }} style={{ flex: 1, padding: '11px', background: 'var(--white)', color: 'var(--green)', border: '1.5px solid var(--green-muted)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
              <button onClick={reset} style={{ flex: 2, padding: '11px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Next Student →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const pickerBtn = (active) => ({
  padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
  border: active ? '1.5px solid var(--green)' : '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  background: active ? 'var(--green-light)' : 'var(--white)',
  color: active ? 'var(--green)' : 'var(--text)',
  transition: 'all 0.15s',
})

function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: 48 }}>
      <div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
    </div>
  )
}
