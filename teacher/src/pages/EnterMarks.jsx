import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { getTeacherClasses } from '../utils/teacherClasses'

export default function EnterMarks() {
  const { teacher, user } = useAuth()
  const [tests, setTests] = useState([])
  const [testIdsWithMarks, setTestIdsWithMarks] = useState(new Set())
  const [selectedTest, setSelectedTest] = useState(null)
  const [students, setStudents] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [studentCount, setStudentCount] = useState('')
  const [loading, setLoading] = useState(true)

  const [myClasses, setMyClasses] = useState([])
  useEffect(() => {
    if (teacher || user) getTeacherClasses(teacher, user).then(setMyClasses)
  }, [teacher, user])

  useEffect(() => {
    if (!teacher) return
    Promise.all([
      getDocs(collection(db, 'tests')),
      getDocs(collection(db, 'testMarks')),
    ]).then(([testsSnap, marksSnap]) => {
      const all = testsSnap.docs.map(d => ({ id:d.id, ...d.data() }))
      // Only show tests owned by this teacher (matched by teacherId, falling back to teacherName for legacy data)
      const teacherIdMatch = teacher?.id
      const teacherNameLower = (teacher?.fullName || '').toLowerCase().trim()
      const filtered = all.filter(t => {
        if (teacherIdMatch && t.teacherId === teacherIdMatch) return true
        if (teacherNameLower && (t.teacherName || '').toLowerCase().trim() === teacherNameLower) return true
        return false
      })
      setTests(filtered.sort((a,b) => (b.testDate||'').localeCompare(a.testDate||'')))
      // Build a Set of test IDs that have at least one marks document
      const idsWithMarks = new Set(marksSnap.docs.map(d => d.data().testId).filter(Boolean))
      setTestIdsWithMarks(idsWithMarks)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [teacher, myClasses])

  // When test selected, load existing marks and students.
  // Strategy: load the live roster (students collection) AND any existing
  // testMarks, then merge. Roster is authoritative for name + order.
  // testMarks is authoritative for actual marks. This guarantees:
  //   - Names always reflect the current student record (no stale snapshots)
  //   - Roll numbers appear sorted numerically (not insertion order)
  //   - New students who joined after the test was created appear with blank marks
  //   - Students who left but have marks still appear (so historical data isn't lost)
  useEffect(() => {
    if (!selectedTest) return
    setStudents([])
    setStudentCount('')

    let cancelled = false
    ;(async () => {
      try {
        const branchCode = selectedTest.branchCode || teacher?.branchCodes?.[0] || 'MAIN'

        // 1. Load roster — class + branch, both active and withdrawn
        const rosterSnap = await getDocs(query(
          collection(db, 'students'),
          where('className', '==', selectedTest.className),
          where('branchCode', '==', branchCode),
        ))
        const rosterByRoll = new Map()   // rollNumber (canonical string) → { studentId, fullName, isActive }
        rosterSnap.forEach(d => {
          const s = d.data()
          const key = String(s.rollNumber || '').trim()
          if (key) rosterByRoll.set(key, { studentId: d.id, fullName: s.fullName || '', isActive: s.isActive !== false })
        })

        // 2. Load existing testMarks for this test
        const marksSnap = await getDocs(query(
          collection(db, 'testMarks'),
          where('testId', '==', selectedTest.id),
        ))
        const marksByRoll = new Map()   // rollNumber → testMarks doc
        marksSnap.forEach(d => {
          const m = { docId: d.id, ...d.data() }
          const key = String(m.rollNumber || '').trim()
          if (key) marksByRoll.set(key, m)
        })

        // 3. Merge. Active roster students only — withdrawn students are never
        //    shown in the teacher PWA. Their existing testMarks rows are left
        //    untouched in the database (the save loop only upserts students in
        //    this list) and remain visible to the admin.
        const merged = []
        for (const [roll, info] of rosterByRoll.entries()) {
          if (!info.isActive) continue   // withdrawn → not shown to teachers
          const m = marksByRoll.get(roll)
          merged.push({
            docId: m?.docId,
            studentId: info.studentId,
            rollNumber: roll,
            name: info.fullName,
            marks: m?.isAbsent ? '' : (m?.marksObtained != null ? String(m.marksObtained) : ''),
            isAbsent: m?.isAbsent || false,
            fromRoster: true,
          })
        }

        // 5. Sort numerically by rollNumber so the order matches admit-list order
        merged.sort((a, b) => Number(a.rollNumber || 0) - Number(b.rollNumber || 0))

        if (!cancelled) setStudents(merged)
      } catch (e) {
        console.error('Failed to load students/marks for entry:', e)
      }
    })()

    return () => { cancelled = true }
  }, [selectedTest])

  function initStudents(count) {
    const n = Number(count)
    if (!n || n < 1) return
    setStudents(Array.from({length: n}, (_, i) => ({
      name: '', rollNumber: String(i+1).padStart(3,'0'), marks: '', isAbsent: false
    })))
  }

  function updateStudent(idx, field, value) {
    // Validate marks field — clamp to [0, maxMarks]
    if (field === 'marks' && value !== '' && selectedTest) {
      const maxMarks = Number(selectedTest.maxMarks || 0)
      const num = Number(value)
      if (isNaN(num)) return  // reject non-numeric
      if (num < 0) value = '0'
      else if (maxMarks > 0 && num > maxMarks) value = String(maxMarks)
    }
    setStudents(prev => prev.map((s,i) => i === idx ? { ...s, [field]: value } : s))
  }

  async function handleSubmit() {
    if (!selectedTest || students.length === 0) return
    // Ownership guard: only the teacher who owns this test can save marks for it
    const teacherIdMatch = teacher?.id
    const teacherNameLower = (teacher?.fullName || '').toLowerCase().trim()
    const ownsTest =
      (teacherIdMatch && selectedTest.teacherId === teacherIdMatch) ||
      (teacherNameLower && (selectedTest.teacherName || '').toLowerCase().trim() === teacherNameLower)
    if (!ownsTest) {
      alert('You can only enter marks for tests you created. Please ask the teacher who created this test to enter the marks, or speak to the admin.')
      return
    }
    setSaving(true)
    try {
      // Load ALL existing testMarks for this test (authoritative source)
      const existingSnap = await getDocs(query(collection(db, 'testMarks'), where('testId', '==', selectedTest.id)))
      const existingDocs = existingSnap.docs.map(d => ({ docId:d.id, ...d.data() }))
      // Group by rollNumber — if duplicates already exist, we'll keep the first and delete the rest
      const existingByRoll = {}
      const duplicatesToDelete = []
      existingDocs.forEach(d => {
        const key = String(d.rollNumber || '').trim()
        if (!key) return
        if (!existingByRoll[key]) existingByRoll[key] = d
        else duplicatesToDelete.push(d.docId)
      })
      // Delete any pre-existing duplicates
      for (const docId of duplicatesToDelete) {
        try { await deleteDoc(doc(db, 'testMarks', docId)) } catch(e) { console.error('Dedup delete failed:', e) }
      }
      // Now save each student — match by rollNumber, update if exists, add if new
      // testMarks branchCode mirrors the parent test (so a CITY test's marks are
      // discoverable in CITY-filtered queries). Falls back to the teacher's first
      // branch, then MAIN, in case selectedTest is somehow missing branchCode.
      const branchCode = selectedTest.branchCode || teacher?.branchCodes?.[0] || 'MAIN'
      for (const s of students) {
        const marksNum = s.isAbsent ? 0 : Number(s.marks || 0)
        const maxMarks = Number(selectedTest.maxMarks || 1)
        const data = {
          testId: selectedTest.id,
          testName: selectedTest.testName || '',
          classId: selectedTest.classId || '',
          className: selectedTest.className || '',
          subject: selectedTest.subject || '',
          testDate: selectedTest.testDate || '',
          studentId: s.studentId || null,
          studentName: s.name,
          rollNumber: s.rollNumber,
          marksObtained: marksNum,
          maxMarks: selectedTest.maxMarks,
          isAbsent: s.isAbsent,
          percentage: s.isAbsent ? 0 : Math.round((marksNum / maxMarks) * 100),
          branchCode,
          createdAt: Timestamp.now()
        }
        const rollKey = String(s.rollNumber || '').trim()
        const existing = rollKey ? existingByRoll[rollKey] : null
        if (existing) {
          await updateDoc(doc(db, 'testMarks', existing.docId), data)
        } else {
          await addDoc(collection(db, 'testMarks'), data)
        }
      }
      await updateDoc(doc(db, 'tests', selectedTest.id), { marksEntered: true })
      setSaved(true)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const absentCount = students.filter(s => s.isAbsent).length
  const appeared = students.filter(s => !s.isAbsent && s.marks !== '')
  const avgMarks = appeared.length > 0 ? Math.round(appeared.reduce((sum,s) => sum + Number(s.marks||0), 0) / appeared.length) : 0

  if (myClasses.length === 0 && !loading) return (
    <div style={{ padding:24 }}>
      <div style={{ background:'var(--gold-light)', border:'1px solid rgba(201,162,39,0.3)', borderRadius:'var(--radius-lg)', padding:'28px 20px', textAlign:'center' }}>
        <p style={{ fontSize:14, color:'var(--gold-dark)', fontWeight:500, marginBottom:6 }}>No classes assigned yet</p>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Ask the admin to add your periods to the timetable.</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding:'20px' }}>
      <div className="fade-up" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color:'var(--green-dark)' }}>Enter Test Marks</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>Select a test and enter marks for each student</p>
      </div>


      {showReview && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'flex-end', justifyContent:'center', zIndex:1000, padding:0, animation:'fadeIn 0.2s ease' }}>
          <div className="fade-up" style={{ background:'var(--white)', borderRadius:'var(--radius-lg) var(--radius-lg) 0 0', width:'100%', maxWidth:520, maxHeight:'85vh', boxShadow:'0 -8px 40px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column' }}>
            {/* Header */}
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid var(--gray-100)', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                <h3 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--green-dark)' }}>Review entries</h3>
                <button onClick={() => setShowReview(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22, padding:4, lineHeight:1 }}>×</button>
              </div>
              <p style={{ fontSize:12, color:'var(--text-muted)' }}>{selectedTest?.testName} · {selectedTest?.className} · Max {selectedTest?.maxMarks}</p>
              <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                <span style={{ fontSize:11, padding:'3px 9px', borderRadius:10, background:'var(--green-light)', color:'var(--green)', fontWeight:600 }}>{appeared.length} appeared</span>
                <span style={{ fontSize:11, padding:'3px 9px', borderRadius:10, background:'var(--crimson-light)', color:'var(--crimson)', fontWeight:600 }}>{absentCount} absent</span>
                <span style={{ fontSize:11, padding:'3px 9px', borderRadius:10, background:'var(--gold-light)', color:'var(--gold-dark)', fontWeight:600 }}>{students.length - appeared.length - absentCount} blank</span>
              </div>
            </div>

            {/* Scrollable list */}
            <div style={{ flex:1, overflowY:'auto', padding:'8px 20px' }}>
              {students.map((s, i) => {
                const blank = !s.isAbsent && (s.marks === '' || s.marks == null)
                const marksNum = blank ? null : (s.isAbsent ? null : Number(s.marks))
                const pct = (marksNum != null && selectedTest?.maxMarks) ? Math.round((marksNum / Number(selectedTest.maxMarks)) * 100) : null
                const passed = pct != null && selectedTest?.passMarks != null ? marksNum >= Number(selectedTest.passMarks) : null
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom: i === students.length - 1 ? 'none' : '1px solid var(--gray-100)' }}>
                    <div style={{ width:26, height:26, borderRadius:6, background: s.isAbsent ? 'var(--crimson)' : blank ? 'var(--gold-light)' : 'var(--green-light)', color: s.isAbsent ? 'white' : blank ? 'var(--gold-dark)' : 'var(--green)', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{s.rollNumber}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:500, color: s.name ? 'var(--text)' : 'var(--gray-400)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name || <em>(no name)</em>}</div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      {s.isAbsent ? (
                        <span style={{ fontSize:11, color:'var(--crimson)', fontWeight:600 }}>Absent</span>
                      ) : blank ? (
                        <span style={{ fontSize:11, color:'var(--gold-dark)', fontWeight:600 }}>—</span>
                      ) : (
                        <div>
                          <div style={{ fontSize:13, fontWeight:600, color: passed ? 'var(--green)' : 'var(--crimson)' }}>{s.marks}<span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:500 }}>/{selectedTest?.maxMarks}</span></div>
                          {pct != null && <div style={{ fontSize:10, color:'var(--text-muted)' }}>{pct}%</div>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer with confirm/edit */}
            <div style={{ padding:'14px 20px 18px', borderTop:'1px solid var(--gray-100)', flexShrink:0, background:'var(--white)' }}>
              {(students.length - appeared.length - absentCount) > 0 && (
                <p style={{ fontSize:11, color:'var(--gold-dark)', marginBottom:10, padding:'7px 10px', background:'var(--gold-light)', borderRadius:'var(--radius-sm)', border:'1px solid rgba(201,162,39,0.25)' }}>
                  ⚠ {students.length - appeared.length - absentCount} student{(students.length - appeared.length - absentCount) > 1 ? 's have' : ' has'} no marks entered yet. They'll be saved as blank.
                </p>
              )}
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={() => setShowReview(false)} style={{ flex:1, padding:'12px', background:'var(--white)', color:'var(--green)', border:'1.5px solid var(--green-muted)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  ← Edit
                </button>
                <button onClick={async () => { setShowReview(false); await handleSubmit() }} disabled={saving} style={{ flex:2, padding:'12px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
                  {saving ? 'Saving…' : 'Confirm & save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {saved && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20, animation:'fadeIn 0.2s ease' }}>
          <div className="fade-up" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'28px 24px', width:'100%', maxWidth:340, boxShadow:'0 20px 60px rgba(0,0,0,0.3)', textAlign:'center' }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--green-light)', border:'2px solid var(--green-muted)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:600, color:'var(--green-dark)', marginBottom:6 }}>Marks successfully saved</h3>
            <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:18 }}>Your entries have been recorded.</p>
            <button onClick={() => { setSaved(false); setSelectedTest(null) }} style={{ width:'100%', padding:'11px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:600, cursor:'pointer' }}>
              OK
            </button>
          </div>
        </div>
      )}

      {!selectedTest ? (
        loading ? (
          <div style={{ textAlign:'center', padding:48 }}>
            <div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} />
          </div>
        ) : tests.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 20px', background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
            <p style={{ color:'var(--text-muted)', fontSize:14 }}>No tests scheduled for your classes yet.</p>
            <p style={{ color:'var(--text-muted)', fontSize:13, marginTop:4 }}>Tests are created by the admin.</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {tests.map(t => (
              <button key={t.id} onClick={() => setSelectedTest(t)} style={{ background:'var(--white)', border:'1px solid var(--gray-100)', borderRadius:'var(--radius-md)', padding:'14px 16px', cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{t.testName || 'Unnamed Test'}</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)' }}>{t.className} · {t.subject} · {t.testDate || 'No date'}</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                  {(() => {
                    const done = testIdsWithMarks.has(t.id)
                    return (
                      <span style={{ fontSize:11, padding:'3px 9px', borderRadius:10, background: done ? 'var(--green-light)' : 'var(--gold-light)', color: done ? 'var(--green)' : 'var(--gold-dark)', fontWeight:500 }}>
                        {done ? 'Done' : 'Pending'}
                      </span>
                    )
                  })()}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          {/* Test header */}
          <div style={{ background:'var(--green-light)', borderRadius:'var(--radius-md)', padding:'14px 16px', marginBottom:16, border:'1px solid var(--green-muted)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
              <h2 style={{ fontSize:15, fontWeight:600, color:'var(--green-dark)' }}>{selectedTest.testName}</h2>
              <button onClick={() => setSelectedTest(null)} style={{ background:'none', border:'none', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:500 }}>← Back</button>
            </div>
            <div style={{ fontSize:12, color:'var(--green-mid)' }}>{selectedTest.className} · {selectedTest.subject} · Max: {selectedTest.maxMarks} · Pass: {selectedTest.passMarks}</div>
          </div>

          {/* Student count setup if no students loaded */}
          {students.length === 0 && (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'16px', marginBottom:16 }}>
              <label style={{ fontSize:13, fontWeight:500, color:'var(--text)', display:'block', marginBottom:8 }}>How many students appeared for this test?</label>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <input type="number" min="1" max="60" value={studentCount} onChange={e => setStudentCount(e.target.value)} placeholder="e.g. 42" style={{ flex:1, padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:14 }} />
                <button onClick={() => initStudents(studentCount)} disabled={!studentCount} style={{ padding:'10px 16px', background: studentCount ? 'var(--green)' : 'var(--gray-200)', color: studentCount ? 'white' : 'var(--gray-400)', border:'none', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor: studentCount ? 'pointer' : 'not-allowed' }}>Set up</button>
              </div>
            </div>
          )}

          {/* Live summary */}
          {students.length > 0 && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
              {[
                { label:'Students', value: students.length },
                { label:'Absent', value: absentCount, color: absentCount > 0 ? 'var(--crimson)' : 'var(--text)' },
                { label:'Class avg', value: avgMarks || '—', color: avgMarks >= Number(selectedTest.passMarks||0) ? 'var(--green)' : 'var(--crimson)' },
              ].map(s => (
                <div key={s.label} style={{ background:'var(--white)', borderRadius:'var(--radius-sm)', border:'1px solid var(--gray-100)', padding:'10px', textAlign:'center' }}>
                  <div style={{ fontSize:20, fontWeight:700, color: s.color || 'var(--text)', fontFamily:'var(--font-display)' }}>{s.value}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Student rows */}
          {students.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
              {students.map((s, i) => (
                <div key={i} style={{ background: s.isAbsent ? 'var(--crimson-light)' : 'var(--white)', borderRadius:'var(--radius-md)', border:`1px solid ${s.isAbsent ? 'rgba(139,26,26,0.15)' : 'var(--gray-100)'}`, padding:'12px 14px', transition:'all 0.15s' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: s.isAbsent ? 0 : 8 }}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background: s.isAbsent ? 'var(--crimson)' : 'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <span style={{ fontSize:11, fontWeight:600, color: s.isAbsent ? 'white' : 'var(--green)' }}>{s.rollNumber}</span>
                    </div>
                    {s.fromRoster ? (
                      <span style={{ flex:1, fontSize:13, color:'var(--text)', fontWeight:500, fontFamily:'var(--font-body)' }}>
                        {s.name}
                      </span>
                    ) : (
                      <input value={s.name} onChange={e => updateStudent(i, 'name', e.target.value)} placeholder={`Student ${i+1} name`} style={{ flex:1, border:'none', outline:'none', fontSize:13, color:'var(--text)', background:'transparent', fontFamily:'var(--font-body)' }} />
                    )}                    <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', flexShrink:0 }}>
                      <input type="checkbox" checked={s.isAbsent} onChange={e => updateStudent(i, 'isAbsent', e.target.checked)} style={{ width:14, height:14, accentColor:'var(--crimson)' }} />
                      <span style={{ fontSize:11, color: s.isAbsent ? 'var(--crimson)' : 'var(--text-muted)', fontWeight: s.isAbsent ? 600 : 400 }}>Absent</span>
                    </label>
                  </div>
                  {!s.isAbsent && (
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <input type="number" min="0" max={selectedTest.maxMarks} step="0.5" value={s.marks} onChange={e => updateStudent(i, 'marks', e.target.value)} placeholder="Marks" style={{ width:80, padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:14, textAlign:'center' }} />
                      <span style={{ fontSize:12, color:'var(--text-muted)' }}>/ {selectedTest.maxMarks}</span>
                      {s.marks !== '' && (
                        <span style={{ fontSize:12, fontWeight:600, marginLeft:'auto', color: (Number(s.marks)/Number(selectedTest.maxMarks||1)*100) >= (Number(selectedTest.passMarks||0)/Number(selectedTest.maxMarks||1)*100) ? 'var(--green)' : 'var(--crimson)' }}>
                          {Math.round(Number(s.marks)/Number(selectedTest.maxMarks||1)*100)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {students.length > 0 && (
            <button onClick={() => setShowReview(true)} disabled={saving} style={{ width:'100%', padding:'15px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border:'none', borderRadius:'var(--radius-md)', fontSize:15, fontWeight:600, cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
              {saving ? 'Saving marks…' : `Review & Save Marks (${students.length} students)`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
