import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, deleteDoc, doc, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts'
import { useNavigate } from 'react-router-dom'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'

// CLASSES now loaded from Firestore via useClasses() hook below
const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

export default function Tests() {
  const navigate = useNavigate()
  const { classes: classDocs, classNames: CLASSES } = useClasses()
  const { effectiveBranches, currentBranch, allowedBranches, canSwitchBranches } = useAuth()
  // Picker for super admin on All Branches: defaults to current global branch when set,
  // otherwise to the first allowed branch. Re-syncs when global switcher changes.
  const [formBranch, setFormBranch] = useState(() => currentBranch || allowedBranches[0])
  useEffect(() => {
    if (currentBranch) setFormBranch(currentBranch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranch])
  const showBranchPicker = !currentBranch && canSwitchBranches && allowedBranches.length > 1
  const [tests, setTests] = useState([])
  const [marks, setMarks] = useState([])
  const [selectedClass, setSelectedClass] = useState('Class 9')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ testName:'', className:'Class 9', subject:'', teacherId:'', teacherName:'', testDate:'', maxMarks:'25', passMarks:'10', syllabusScope:'' })
  const [teachers, setTeachers] = useState([])
  const [classSubjectsMap, setClassSubjectsMap] = useState({})
  const [timetable, setTimetable] = useState([])

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))),
      (async () => { const { getDoc, doc } = await import('firebase/firestore'); return getDoc(doc(db, 'settings', 'classSubjects')) })(),
      getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches))),
    ]).then(([tSnap, csDoc, ttSnap]) => {
      setTeachers(tSnap.docs.map(d => ({ id:d.id, ...d.data() })).filter(t => t.isActive !== false).sort((a,b) => a.fullName.localeCompare(b.fullName)))
      if (csDoc.exists() && csDoc.data().map) setClassSubjectsMap(csDoc.data().map)
      setTimetable(ttSnap.docs.map(d => d.data()))
    }).catch(() => {})
  }, [effectiveBranches])

  async function load(cls) {
    setLoading(true)
    try {
      const [testsSnap, marksSnap] = await Promise.all([
        getDocs(query(collection(db, 'tests'), where('className', '==', cls), ...branchConstraints('branchCode', effectiveBranches))),
        getDocs(query(collection(db, 'testMarks'), where('className', '==', cls), ...branchConstraints('branchCode', effectiveBranches))),
      ])
      setTests(testsSnap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => (a.testDate||'').localeCompare(b.testDate||'')))
      setMarks(marksSnap.docs.map(d => ({ id:d.id, ...d.data() })))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load(selectedClass) }, [selectedClass, effectiveBranches])

  async function saveTest() {
    setError('')
    if (!form.testName.trim()) { setError('Test name is required'); return }
    if (!form.subject.trim()) { setError('Subject is required'); return }
    if (!form.testDate) { setError('Test date is required'); return }
    if (!formBranch) { setError('Please select a branch'); return }
    setSaving(true)
    try {
      await addDoc(collection(db, 'tests'), {
        testName: form.testName.trim(),
        className: form.className,
        subject: form.subject.trim(),
        teacherId: form.teacherId,
        teacherName: form.teacherName,
        testDate: form.testDate,
        maxMarks: Number(form.maxMarks) || 25,
        passMarks: Number(form.passMarks) || 10,
        syllabusScope: form.syllabusScope.trim(),
        marksEntered: false,
        branchCode: formBranch,
        createdAt: Timestamp.now()
      })
      setShowForm(false)
      setForm({ testName:'', className:selectedClass, subject:'', teacherId:'', teacherName:'', testDate:'', maxMarks:'25', passMarks:'10', syllabusScope:'' })
      await load(selectedClass)
    } catch(e) { setError('Failed to save. Check Firestore rules.') }
    setSaving(false)
  }

  async function deleteTest(id) {
    if (!confirm('Delete this test? All associated marks and absentee records will also be deleted.')) return
    try {
      // Cascade delete: remove all testMarks for this test first
      const marksSnap = await getDocs(query(collection(db, 'testMarks'), where('testId', '==', id)))
      await Promise.all(marksSnap.docs.map(d => deleteDoc(doc(db, 'testMarks', d.id))))
      // Then delete the test itself
      await deleteDoc(doc(db, 'tests', id))
      await load(selectedClass)
    } catch(e) { alert(`Delete failed: ${e.message}`) }
  }

  async function cleanupOrphans() {
    if (!confirm('Scan for test marks records whose tests no longer exist (orphaned data from previously deleted tests) and remove them. Continue?')) return
    try {
      const [allTestsSnap, allMarksSnap] = await Promise.all([
        getDocs(collection(db, 'tests')),
        getDocs(collection(db, 'testMarks')),
      ])
      const validIds = new Set(allTestsSnap.docs.map(d => d.id))
      const orphans = allMarksSnap.docs.filter(d => !validIds.has(d.data().testId))
      if (orphans.length === 0) { alert('No orphaned records found. Database is clean.'); return }
      for (const d of orphans) {
        await deleteDoc(doc(db, 'testMarks', d.id))
      }
      alert(`Cleanup complete. Removed ${orphans.length} orphaned record${orphans.length === 1 ? '' : 's'}.`)
      await load(selectedClass)
    } catch(e) { alert(`Cleanup failed: ${e.message}`) }
  }

  // Charts data
  const perfData = tests.map(t => {
    const tm = marks.filter(m => m.testId === t.id && !m.isAbsent)
    const avg = tm.length ? Math.round(tm.reduce((s,m) => s + Number(m.marksObtained||0), 0) / tm.length) : 0
    return { name: t.testName?.slice(0,14) || t.id, avg, max: Number(t.maxMarks||0), absent: marks.filter(m => m.testId === t.id && m.isAbsent).length }
  })

  const studentNames = [...new Set(marks.filter(m => !m.isAbsent).map(m => m.studentName))].slice(0,5)
  const trendData = tests.map(t => {
    const row = { name: t.testName?.slice(0,10) || t.id }
    studentNames.forEach(sn => {
      const m = marks.find(m => m.testId === t.id && m.studentName === sn)
      row[sn] = m ? Math.round((Number(m.marksObtained||0)/Number(t.maxMarks||1))*100) : null
    })
    return row
  })
  const COLORS = ['#1a4a2e','#c9a227','#8b1a1a','#2a6b45','#9e7d1a']

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom:24, display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Tests & Performance</h1>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>Schedule tests and track student performance</p>
          <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
        </div>
        <div style={{ display:'flex', gap:10, flexShrink:0 }}>
          <button onClick={cleanupOrphans} style={{ padding:'10px 14px', background:'var(--gold-light)', color:'var(--gold-dark)', border:'1px solid rgba(201,162,39,0.3)', borderRadius:'var(--radius-md)', fontSize:12, fontWeight:500, cursor:'pointer' }} title="Remove orphaned test marks left over from deleted tests">
            Clean orphans
          </button>
          <button onClick={() => { setShowForm(s => !s); setError('') }} style={{ padding:'10px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:7, boxShadow:'0 2px 8px rgba(26,74,46,0.25)' }}>
            <span style={{ fontSize:18, lineHeight:1 }}>{showForm ? '×' : '+'}</span>
            {showForm ? 'Cancel' : 'Schedule Test'}
          </button>
        </div>
      </div>

      {/* Schedule form */}
      {showForm && (
        <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--green-muted)', padding:'22px', marginBottom:22, boxShadow:'var(--shadow-md)' }}>
          <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, color:'var(--green-dark)', marginBottom:18 }}>New Test</h3>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12 }}>
            {showBranchPicker && (
              <div style={{ gridColumn:'1/-1', padding:'10px 12px', background:'var(--green-light)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-sm)' }}>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--green-mid)', display:'block', marginBottom:6 }}>Branch <span style={{ color:'var(--crimson)' }}>*</span></label>
                <div style={{ display:'flex', gap:14 }}>
                  {allowedBranches.map(b => (
                    <label key={b} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13 }}>
                      <input type="radio" name="formBranch" checked={formBranch === b} onChange={() => setFormBranch(b)} />
                      <span>{branchLabel(b)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div style={{ gridColumn:'1/-1' }}>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Test name <span style={{ color:'var(--crimson)' }}>*</span></label>
              <input value={form.testName} onChange={e => setForm(p=>({...p,testName:e.target.value}))} placeholder="e.g. Unit Test 1 — Science" style={inp} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Class <span style={{ color:'var(--crimson)' }}>*</span></label>
              <select value={form.className} onChange={e => setForm(p=>({...p,className:e.target.value}))} style={inp}>
                {(() => {
                  // When the form's branch is set (always for branch admins; resolved
                  // by picker for super admins on All Branches), restrict the class
                  // list to that branch so the user can't accidentally pair a CITY
                  // class with a MAIN-branch test.
                  const visibleClassNames = formBranch
                    ? [...new Set(classDocs.filter(c => c.branchCode === formBranch).map(c => c.className))]
                    : CLASSES
                  return visibleClassNames.map(c => <option key={c}>{c}</option>)
                })()}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Subject <span style={{ color:'var(--crimson)' }}>*</span></label>
              <select value={form.subject} onChange={e => setForm(p=>({...p,subject:e.target.value}))} style={inp}>
                <option value="">Select subject…</option>
                {(() => {
                  // Priority 1: subjects scheduled in timetable for this class (single source of truth)
                  const ttSubs = [...new Set(
                    timetable
                      .filter(s => s.className === form.className || (Array.isArray(s.classNames) && s.classNames.includes(form.className)))
                      .map(s => s.subject).filter(Boolean)
                  )].sort()
                  if (ttSubs.length > 0) return ttSubs.map(s => <option key={s}>{s}</option>)
                  // Priority 2: classSubjectsMap
                  const mapSubs = classSubjectsMap[form.className] || []
                  if (mapSubs.length > 0) return mapSubs.map(s => <option key={s}>{s}</option>)
                  // Priority 3: union of all teachers' subjectsTaught
                  const allTeacherSubs = [...new Set(teachers.flatMap(t => t.subjectsTaught || []))].sort()
                  if (allTeacherSubs.length > 0) return allTeacherSubs.map(s => <option key={s}>{s}</option>)
                  // Priority 4: common subjects fallback
                  const DEFAULT_SUBJECTS = ['Mathematics','Science','English','Hindi','Social Science','Physics','Chemistry','Biology','History','Political Science','Geography','Economics','Accountancy','Business Studies','Sanskrit','Physical Education','Computers','Artificial Intelligence']
                  return DEFAULT_SUBJECTS.map(s => <option key={s}>{s}</option>)
                })()}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Teacher</label>
              <select value={form.teacherId} onChange={e => {
                const t = teachers.find(t => t.id === e.target.value)
                setForm(p=>({...p, teacherId: e.target.value, teacherName: t?.fullName || ''}))
              }} style={inp}>
                <option value="">Select teacher…</option>
                {(() => {
                  // Filter to teachers at the form's branch first
                  // (teachers can be in multiple branches; branchCodes is an array)
                  const branchTeachers = formBranch
                    ? teachers.filter(t => (t.branchCodes || []).includes(formBranch))
                    : teachers
                  if (!form.subject) return branchTeachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)
                  // Priority 1: teachers who teach this subject in this class per timetable
                  const ttTeacherIds = new Set(
                    timetable
                      .filter(s => s.subject === form.subject && (s.className === form.className || (Array.isArray(s.classNames) && s.classNames.includes(form.className))))
                      .map(s => s.teacherId).filter(Boolean)
                  )
                  const ttTeachers = branchTeachers.filter(t => ttTeacherIds.has(t.id))
                  if (ttTeachers.length > 0) return ttTeachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)
                  // Priority 2: teachers qualified in this subject
                  const qualified = branchTeachers.filter(t => (t.subjectsTaught||[]).includes(form.subject))
                  if (qualified.length > 0) return qualified.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)
                  // Fallback: all teachers in this branch
                  return branchTeachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)
                })()}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Date <span style={{ color:'var(--crimson)' }}>*</span></label>
              <input type="date" value={form.testDate} onChange={e => setForm(p=>({...p,testDate:e.target.value}))} style={inp} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Max marks</label>
              <input type="number" value={form.maxMarks} onChange={e => setForm(p=>({...p,maxMarks:e.target.value}))} style={inp} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Pass marks</label>
              <input type="number" value={form.passMarks} onChange={e => setForm(p=>({...p,passMarks:e.target.value}))} style={inp} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Syllabus scope</label>
              <input value={form.syllabusScope} onChange={e => setForm(p=>({...p,syllabusScope:e.target.value}))} placeholder="e.g. Ch 1–3" style={inp} />
            </div>
          </div>
          {error && <p style={{ fontSize:13, color:'var(--crimson)', background:'var(--crimson-light)', padding:'8px 12px', borderRadius:'var(--radius-sm)', marginTop:12 }}>{error}</p>}
          <div style={{ display:'flex', gap:10, marginTop:16 }}>
            <button onClick={saveTest} disabled={saving} style={{ padding:'10px 24px', background: saving ? 'var(--gray-200)' : 'var(--green)', color: saving ? 'var(--gray-400)' : 'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save Test'}
            </button>
          </div>
        </div>
      )}

      {/* Class selector */}
      <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:20 }}>
        {CLASSES.map(c => (
          <button key={c} onClick={() => setSelectedClass(c)} style={{ padding:'7px 13px', borderRadius:20, border:'1px solid', borderColor: selectedClass===c ? 'var(--green)' : 'var(--gray-200)', background: selectedClass===c ? 'var(--green)' : 'var(--white)', color: selectedClass===c ? 'white' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
        <>
          {/* Test list */}
          {tests.length === 0 ? (
            <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', marginBottom:20 }}>
              <p style={{ color:'var(--text-muted)', fontSize:14 }}>No tests scheduled for {selectedClass} yet.</p>
              <p style={{ color:'var(--text-muted)', fontSize:13, marginTop:4 }}>Click "Schedule Test" to add one.</p>
            </div>
          ) : (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', marginBottom:20, overflow:'hidden' }}>
              <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--gray-100)' }}>
                <h2 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)' }}>Tests — {selectedClass}</h2>
              </div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr style={{ background:'var(--gray-50)' }}>
                      {['Test Name','Subject','Date','Max','Pass','Appeared','Avg','Absent','Status',''].map(h => (
                        <th key={h} style={{ padding:'9px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tests.map((t,i) => {
                      const tm = marks.filter(m => m.testId === t.id && !m.isAbsent)
                      const avg = tm.length ? Math.round(tm.reduce((s,m) => s + Number(m.marksObtained||0),0)/tm.length) : null
                      const absent = marks.filter(m => m.testId === t.id && m.isAbsent).length
                      return (
                        <tr key={t.id} onClick={() => navigate(`/tests/${t.id}`)} style={{ borderTop:'1px solid var(--gray-50)', background: i%2===0 ? 'var(--white)' : 'var(--gray-50)', cursor:'pointer', transition:'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background='var(--green-light)'} onMouseLeave={e => e.currentTarget.style.background= i%2===0 ? 'var(--white)' : 'var(--gray-50)'}>
                          <td style={{ padding:'11px 14px', fontWeight:500, color:'var(--green-dark)', display:'flex', alignItems:'center', gap:6 }}>
                            {t.testName}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green-mid)" strokeWidth="2" style={{ flexShrink:0, opacity:0.5 }}><polyline points="9 18 15 12 9 6"/></svg>
                          </td>
                          <td style={{ padding:'11px 14px', color:'var(--text-muted)' }}>{t.subject}</td>
                          <td style={{ padding:'11px 14px', color:'var(--text-muted)', whiteSpace:'nowrap' }}>{t.testDate}</td>
                          <td style={{ padding:'11px 14px', color:'var(--text-muted)' }}>{t.maxMarks}</td>
                          <td style={{ padding:'11px 14px', color:'var(--text-muted)' }}>{t.passMarks}</td>
                          <td style={{ padding:'11px 14px', color:'var(--text-muted)' }}>{tm.length || '—'}</td>
                          <td style={{ padding:'11px 14px' }}>
                            {avg !== null ? <span style={{ fontWeight:600, color: avg >= Number(t.passMarks||0) ? 'var(--green)' : 'var(--crimson)' }}>{avg}</span> : '—'}
                          </td>
                          <td style={{ padding:'11px 14px' }}>
                            {absent > 0 ? <span style={{ color:'var(--crimson)', background:'var(--crimson-light)', padding:'2px 7px', borderRadius:8, fontSize:12 }}>{absent}</span> : <span style={{ color:'var(--green)', fontSize:12 }}>None</span>}
                          </td>
                          <td style={{ padding:'11px 14px' }}>
                            {(() => {
                              const hasMarks = marks.some(m => m.testId === t.id)
                              return (
                                <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background: hasMarks ? 'var(--green-light)' : 'var(--gold-light)', color: hasMarks ? 'var(--green)' : 'var(--gold-dark)', fontWeight:500 }}>
                                  {hasMarks ? 'Done' : 'Pending'}
                                </span>
                              )
                            })()}
                          </td>
                          <td style={{ padding:'11px 14px' }}>
                            <button onClick={(e) => { e.stopPropagation(); deleteTest(t.id) }} style={{ background:'none', border:'none', color:'var(--crimson)', cursor:'pointer', fontSize:14, opacity:0.6 }}>✕</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charts */}
          {perfData.length > 0 && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:16 }}>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'18px 20px' }}>
                <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:14 }}>Average score by test</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={perfData} barSize={24}>
                    <XAxis dataKey="name" tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize:12, borderRadius:8 }} />
                    <Bar dataKey="avg" name="Avg Score" fill="#1a4a2e" radius={[4,4,0,0]} />
                    <Bar dataKey="max" name="Max Marks" fill="#c8dfd0" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {trendData.length > 1 && studentNames.length > 0 && (
                <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'18px 20px' }}>
                  <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:14 }}>Student score trend (%)</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />
                      <XAxis dataKey="name" tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0,100]} tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize:11, borderRadius:8 }} />
                      <Legend wrapperStyle={{ fontSize:11 }} />
                      {studentNames.map((s,i) => (
                        <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i%COLORS.length]} strokeWidth={2} dot={{ r:3 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
