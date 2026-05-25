import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints, isAccessibleArray } from '../lib/branchQuery'
import { CLASS_NAMES } from '../lib/classes'
import PlanLogReconciliation from './PlanLogReconciliation'

function StatCard({ label, value, color='var(--green)', sub }) {
  return (
    <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'16px', border:'1px solid var(--gray-100)' }}>
      <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color, lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color, marginTop:2, fontWeight:500 }}>{sub}</div>}
      <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4 }}>{label}</div>
    </div>
  )
}

export default function TeacherProfile() {
  const { teacherId } = useParams()
  const navigate = useNavigate()
  const { effectiveBranches } = useAuth()
  const [teacher, setTeacher] = useState(null)
  const [lessons, setLessons] = useState([])
  const [tests, setTests] = useState([])
  const [syllabus, setSyllabus] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [lessonPlans, setLessonPlans] = useState([])
  const [editingPlan, setEditingPlan] = useState(null)
  const [editData, setEditData] = useState({})
  const [planSaving, setPlanSaving] = useState(false)
  const [planSaved, setPlanSaved] = useState(false)
  const [planFields, setPlanFields] = useState([])

  useEffect(() => {
    async function load() {
      try {
        const teacherDoc = await getDoc(doc(db, 'teachers', teacherId))
        if (!teacherDoc.exists()) { navigate('/teacher-management'); return }
        const t = { id: teacherDoc.id, ...teacherDoc.data() }
        // Defense in depth: bounce if a branch admin guesses a teacher URL
        // for someone outside their branch. Teachers use array branchCodes
        // because they can cover both campuses.
        if (!isAccessibleArray(t.branchCodes, effectiveBranches)) {
          navigate('/teacher-management')
          return
        }
        setTeacher(t)
        // (will enrich with derived classes below)

        // Derive classes from timetable (single source of truth)
        const ttQ = query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches))
        const ttSnap = await getDocs(ttQ)
        const mySlots = ttSnap.docs.map(d => d.data()).filter(s => s.teacherId === t.id)
        const classSet = new Set()
        mySlots.forEach(s => {
          if (Array.isArray(s.classNames) && s.classNames.length) s.classNames.forEach(c => c && classSet.add(c.trim()))
          else if (s.className) s.className.split('+').map(x => x.trim()).filter(Boolean).forEach(c => classSet.add(c))
        })
        const myClasses = [...classSet].sort()
        setTeacher(prev => prev ? { ...prev, classesAssignedDerived: myClasses } : prev)

        const fieldsSnap = await getDocs(query(collection(db, 'settings')))
        const fDoc = fieldsSnap.docs.find(d => d.id === 'lessonPlanFields')
        if (fDoc?.data()?.fields) setPlanFields(fDoc.data().fields)
        // lessons + tests are branched (scalar branchCode); syllabus is global.
        // Note: where('className','in',...) and branchConstraints both use 'in'
        // Firestore allows only one. Since syllabus is global, no branch filter
        // there — we keep the existing 'in' on className.
        const [lessonsSnap, testsSnap, syllabusSnap] = await Promise.all([
          getDocs(query(collection(db, 'lessons'), where('teacherId', '==', teacherId), ...branchConstraints('branchCode', effectiveBranches))),
          getDocs(query(collection(db, 'tests'), ...branchConstraints('branchCode', effectiveBranches))),
          myClasses.length > 0
            ? getDocs(query(collection(db, 'syllabus'), where('className', 'in', myClasses.slice(0,10))))
            : Promise.resolve({ docs: [] }),
        ])

        const lessonPlansSnap = await getDocs(query(collection(db, 'lessonPlans'), where('teacherId', '==', teacherId), ...branchConstraints('branchCode', effectiveBranches)))
        setLessonPlans(lessonPlansSnap.docs.map(d => ({ id:d.id, ...d.data() }))
          .filter(p => p.status !== 'superseded')
          .sort((a,b) => (b.dateStr||'').localeCompare(a.dateStr||'')))
        setLessons(lessonsSnap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => (b.date||'').localeCompare(a.date||'')))
        setTests(testsSnap.docs.map(d => ({ id:d.id, ...d.data() })).filter(t => t.teacherId === teacherId))
        setSyllabus(syllabusSnap.docs.map(d => ({ id:d.id, ...d.data() })))
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [teacherId, effectiveBranches])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    </div>
  )
  if (!teacher) return null

  const myClasses = teacher.classesAssignedDerived || []
  const initials = teacher.fullName?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()

  // Stats
  const totalLessons = lessons.length
  const thisMonth = lessons.filter(l => l.date?.startsWith(new Date().toISOString().slice(0,7))).length
  const testsConducred = tests.length
  const marksEntered = tests.filter(t => t.marksEntered).length

  // Syllabus completion per class
  const syllabusCompletion = myClasses.map(cls => {
    const classTopics = syllabus.filter(s => s.className === cls)
    const classLessons = lessons.filter(l => l.className === cls)
    const coveredIds = new Set(classLessons.flatMap(l => Array.isArray(l.topicIds) ? l.topicIds : []))
    const covered = classTopics.filter(t => coveredIds.has(t.id)).length
    const pct = classTopics.length > 0 ? Math.round((covered/classTopics.length)*100) : 0
    return { cls, total: classTopics.length, covered, pct }
  })

  // Lesson frequency — last 30 days by date
  const last30 = {}
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate()-i)
    last30[d.toISOString().slice(0,10)] = 0
  }
  lessons.forEach(l => { if (last30[l.date] !== undefined) last30[l.date]++ })

  // Subject distribution
  const subjectCount = {}
  lessons.forEach(l => { subjectCount[l.subject] = (subjectCount[l.subject]||0) + 1 })

  // Class distribution for lessons
  const classCount = {}
  lessons.forEach(l => { classCount[l.className] = (classCount[l.className]||0) + 1 })

  return (
    <div style={{ padding:'24px 28px', maxWidth:1100 }}>
      {/* Back */}
      <button onClick={() => navigate('/teacher-management')} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:20, padding:0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Teachers
      </button>

      {/* Header */}
      <div className="fade-in" style={{ background:'var(--green-dark)', borderRadius:'var(--radius-lg)', padding:'28px', marginBottom:24, color:'white', display:'flex', alignItems:'flex-start', gap:24, flexWrap:'wrap', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-40, right:-40, width:200, height:200, borderRadius:'50%', background:'rgba(201,162,39,0.08)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg, var(--gold), transparent)' }} />

        <div style={{ width:80, height:80, borderRadius:'50%', background:'rgba(201,162,39,0.2)', border:'2px solid rgba(201,162,39,0.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:700, color:'var(--gold)' }}>{initials}</span>
        </div>

        <div style={{ flex:1 }}>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'white', marginBottom:6 }}>{teacher.fullName}</h1>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
            <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.85)' }}>{teacher.email}</span>
            {teacher.phone && <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.7)' }}>{teacher.phone}</span>}
            {teacher.qualification && <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(201,162,39,0.2)', color:'var(--gold)' }}>{teacher.qualification}</span>}
            <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background: teacher.isActive !== false ? 'rgba(26,74,46,0.4)' : 'rgba(139,26,26,0.4)', color: teacher.isActive !== false ? '#9fe1cb' : '#ffb3b3' }}>
              {teacher.isActive !== false ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {(teacher.subjectsTaught||[]).map(s => (
              <span key={s} style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(255,255,255,0.07)', color:'rgba(255,255,255,0.8)', border:'1px solid rgba(255,255,255,0.12)' }}>{s}</span>
            ))}
            {myClasses.map(c => (
              <span key={c} style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(201,162,39,0.15)', color:'var(--gold)' }}>{c}</span>
            ))}
          </div>
        </div>

        <div style={{ display:'flex', gap:12, flexShrink:0, flexWrap:'wrap' }}>
          {[
            { label:'Total lessons', value: totalLessons, color:'white' },
            { label:'This month', value: thisMonth, color:'var(--gold)' },
            { label:'Tests conducted', value: testsConducred, color:'white' },
          ].map(s => (
            <div key={s.label} style={{ textAlign:'center', background:'rgba(255,255,255,0.07)', borderRadius:'var(--radius-md)', padding:'14px 16px', minWidth:80 }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.5)', marginTop:3 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, background:'var(--gray-50)', borderRadius:'var(--radius-md)', padding:4, border:'1px solid var(--gray-100)', width:'fit-content' }}>
        {[['overview','Overview'],['lessons','Lesson Log'],['tests','Tests'],['syllabus','Syllabus Status'],['plans','Lesson Plans'],['reconciliation','Plan vs Log']].map(([k,l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{ padding:'8px 18px', borderRadius:'var(--radius-sm)', border:'none', fontSize:13, fontWeight:500, cursor:'pointer', background: activeTab===k ? 'var(--white)' : 'transparent', color: activeTab===k ? 'var(--green)' : 'var(--text-muted)', boxShadow: activeTab===k ? 'var(--shadow-sm)' : 'none', transition:'all 0.15s' }}>{l}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div>
          {/* Class Teacher Assignment */}
          <ClassTeacherAssignment teacher={teacher} setTeacher={setTeacher} />

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:14, marginBottom:20 }}>
            <StatCard label="Total lessons logged" value={totalLessons} />
            <StatCard label="This month" value={thisMonth} color="var(--gold-dark)" />
            <StatCard label="Tests conducted" value={testsConducred} />
            <StatCard label="Marks entered" value={`${marksEntered}/${testsConducred}`} color={marksEntered === testsConducred ? 'var(--green)' : 'var(--gold-dark)'} />
          </div>

          {/* Syllabus completion */}
          {syllabusCompletion.length > 0 && (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'20px', marginBottom:20 }}>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)', marginBottom:14 }}>Syllabus completion by class</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {syllabusCompletion.filter(s => s.total > 0).map(s => (
                  <div key={s.cls}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                      <span style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{s.cls}</span>
                      <span style={{ fontSize:13, fontWeight:700, color: s.pct >= 80 ? 'var(--green)' : s.pct >= 50 ? 'var(--gold-dark)' : 'var(--crimson)' }}>{s.pct}% <span style={{ fontSize:11, fontWeight:400, color:'var(--text-muted)' }}>({s.covered}/{s.total})</span></span>
                    </div>
                    <div style={{ height:8, background:'var(--gray-100)', borderRadius:4, overflow:'hidden' }}>
                      <div style={{ width:`${s.pct}%`, height:'100%', background: s.pct >= 80 ? 'var(--green)' : s.pct >= 50 ? 'var(--gold-dark)' : 'var(--crimson)', borderRadius:4, transition:'width 0.6s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lesson activity heatmap — last 30 days */}
          <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'20px', marginBottom:20 }}>
            <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)', marginBottom:14 }}>Lesson activity — last 30 days</h3>
            <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
              {Object.entries(last30).map(([date, count]) => (
                <div key={date} title={`${date}: ${count} lesson${count!==1?'s':''}`} style={{ width:22, height:22, borderRadius:4, background: count === 0 ? 'var(--gray-100)' : count === 1 ? 'var(--green-light)' : count === 2 ? '#5a9e6e' : 'var(--green)', border:'1px solid rgba(0,0,0,0.05)', cursor:'default' }} />
              ))}
            </div>
            <div style={{ display:'flex', gap:12, marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:12, height:12, borderRadius:2, background:'var(--gray-100)', display:'inline-block' }} />No lessons</span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:12, height:12, borderRadius:2, background:'var(--green-light)', display:'inline-block' }} />1</span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:12, height:12, borderRadius:2, background:'var(--green)', display:'inline-block' }} />2+</span>
            </div>
          </div>

          {/* Subject and class distribution */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            {[['Subject distribution', subjectCount], ['Class distribution', classCount]].map(([title, data]) => (
              <div key={title} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'16px' }}>
                <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:12 }}>{title}</h3>
                {Object.entries(data).sort((a,b)=>b[1]-a[1]).map(([name, count]) => (
                  <div key={name} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                    <span style={{ fontSize:12, color:'var(--text)', flex:1 }}>{name}</span>
                    <div style={{ flex:2, height:6, background:'var(--gray-100)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ width:`${Math.round(count/Math.max(...Object.values(data))*100)}%`, height:'100%', background:'var(--green)', borderRadius:3 }} />
                    </div>
                    <span style={{ fontSize:12, color:'var(--text-muted)', minWidth:28, textAlign:'right' }}>{count}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LESSON LOG TAB */}
      {activeTab === 'lessons' && (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          {lessons.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No lessons logged yet.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  {['Date','Class','Subject','Topics Covered','Periods'].map(h => (
                    <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lessons.map((l,i) => (
                  <tr key={l.id} style={{ borderTop:'1px solid var(--gray-50)', background: i%2===0 ? 'var(--white)' : 'var(--gray-50)' }}>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)', whiteSpace:'nowrap' }}>{l.date}</td>
                    <td style={{ padding:'11px 16px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{l.className}</span>
                    </td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{l.subject}</td>
                    <td style={{ padding:'11px 16px', color:'var(--text)', maxWidth:300, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.topicNames || '—'}</td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)', textAlign:'center' }}>{l.actualPeriods || 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TESTS TAB */}
      {activeTab === 'tests' && (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          {tests.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No tests conducted by this teacher yet.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  {['Test Name','Class','Subject','Date','Max','Marks Status'].map(h => (
                    <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tests.map((t,i) => (
                  <tr key={t.id} style={{ borderTop:'1px solid var(--gray-50)', background: i%2===0 ? 'var(--white)' : 'var(--gray-50)' }}>
                    <td style={{ padding:'11px 16px', fontWeight:500, color:'var(--text)' }}>{t.testName}</td>
                    <td style={{ padding:'11px 16px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{t.className}</span>
                    </td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{t.subject}</td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{t.testDate}</td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{t.maxMarks}</td>
                    <td style={{ padding:'11px 16px' }}>
                      <span style={{ fontSize:11, padding:'3px 9px', borderRadius:8, background: t.marksEntered ? 'var(--green-light)' : 'var(--gold-light)', color: t.marksEntered ? 'var(--green)' : 'var(--gold-dark)', fontWeight:500 }}>
                        {t.marksEntered ? '✓ Entered' : '⏳ Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* LESSON PLANS TAB */}
      {activeTab === 'plans' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {planSaved && <div style={{ background:'var(--green)', color:'white', padding:'10px 16px', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500 }}>✓ Plan updated</div>}
          {lessonPlans.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:13 }}>No lesson plans submitted yet.</div>
          ) : editingPlan ? (
            <div>
              <button onClick={() => { setEditingPlan(null); setEditData({}) }} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:16, padding:0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                Back to plans list
              </button>
              <div style={{ background:'var(--green-light)', borderRadius:'var(--radius-lg)', padding:'14px 18px', marginBottom:16, fontSize:13 }}>
                <strong>{editingPlan.dateStr}</strong> · Period {editingPlan.period} · {editingPlan.className} · {editingPlan.subject}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:16 }}>
                {(planFields.length > 0 ? planFields : Object.keys(editingPlan.data||{}).map(id => ({ id, label:id, type:'textarea' }))).map(f => (
                  <div key={f.id}>
                    <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>{f.label}</label>
                    {f.type === 'textarea' ? (
                      <textarea value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} rows={3} style={{ width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', resize:'vertical', outline:'none' }} />
                    ) : f.type === 'select' ? (
                      <select value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} style={{ width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
                        <option value="">Select…</option>
                        {(f.options||[]).map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} style={{ width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }} />
                    )}
                  </div>
                ))}
              </div>
              <button onClick={async () => {
                setPlanSaving(true)
                try {
                  await updateDoc(doc(db, 'lessonPlans', editingPlan.id), { data: editData, adminEdited: true, adminEditedAt: new Date().toISOString() })
                  setLessonPlans(prev => prev.map(p => p.id === editingPlan.id ? { ...p, data: editData } : p))
                  setPlanSaved(true); setTimeout(() => setPlanSaved(false), 2500)
                  setEditingPlan(null); setEditData({})
                } catch(e) { console.error(e) }
                setPlanSaving(false)
              }} disabled={planSaving} style={{ padding:'11px 28px', background: planSaving?'var(--gray-200)':'var(--green)', color: planSaving?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: planSaving?'not-allowed':'pointer' }}>
                {planSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          ) : lessonPlans.map(plan => (
            <div key={plan.id} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
              <div style={{ padding:'11px 16px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{plan.dateStr} · Period {plan.period} · {plan.periodTime}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>
                    <span style={{ padding:'1px 6px', borderRadius:6, background:'var(--green-light)', color:'var(--green)', fontWeight:500, marginRight:5 }}>{plan.className}</span>
                    {plan.subject}
                    {plan.adminEdited && <span style={{ marginLeft:8, color:'var(--gold-dark)' }}>✎ Admin edited</span>}
                  </div>
                </div>
                <div style={{ display:'flex', gap:7 }}>
                  <button onClick={() => { setEditingPlan(plan); setEditData(plan.data||{}) }} style={{ padding:'6px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500, cursor:'pointer' }}>Edit</button>
                  <button onClick={async () => {
                    if (!confirm('Delete this lesson plan?')) return
                    try {
                      await deleteDoc(doc(db, 'lessonPlans', plan.id))
                      setLessonPlans(prev => prev.filter(p => p.id !== plan.id))
                    } catch(e) { console.error(e) }
                  }} style={{ padding:'6px 12px', background:'var(--crimson-light)', color:'var(--crimson)', border:'none', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500, cursor:'pointer' }}>Delete</button>
                </div>
              </div>
              <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:6 }}>
                {Object.entries(plan.data||{}).filter(([,v])=>v).map(([k,v]) => {
                  const field = planFields.find(f => f.id === k)
                  return (
                    <div key={k}>
                      <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:2 }}>{field?.label || k}</div>
                      <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.5 }}>{v}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SYLLABUS STATUS TAB */}
      {activeTab === 'syllabus' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {myClasses.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:13 }}>No classes assigned to this teacher.</div>
          ) : myClasses.map(cls => {
            const classTopics = syllabus.filter(s => s.className === cls)
            const classLessons = lessons.filter(l => l.className === cls)
            const coveredIds = new Set(classLessons.flatMap(l => Array.isArray(l.topicIds) ? l.topicIds : []))
            const bySubject = classTopics.reduce((acc, t) => {
              if (!acc[t.subject]) acc[t.subject] = []
              acc[t.subject].push(t)
              return acc
            }, {})
            return (
              <div key={cls} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                <div style={{ padding:'12px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{cls}</span>
                  <span style={{ fontSize:12, color:'var(--green-mid)' }}>
                    {classTopics.filter(t=>coveredIds.has(t.id)).length}/{classTopics.length} topics covered
                  </span>
                </div>
                <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
                  {Object.entries(bySubject).map(([subject, topics]) => {
                    const covered = topics.filter(t => coveredIds.has(t.id)).length
                    const pct = topics.length > 0 ? Math.round((covered/topics.length)*100) : 0
                    return (
                      <div key={subject}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                          <span style={{ fontSize:13, fontWeight:500 }}>{subject}</span>
                          <span style={{ fontSize:12, fontWeight:600, color: pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--gold-dark)' : 'var(--crimson)' }}>{pct}% ({covered}/{topics.length})</span>
                        </div>
                        <div style={{ height:7, background:'var(--gray-100)', borderRadius:4, overflow:'hidden' }}>
                          <div style={{ width:`${pct}%`, height:'100%', background: pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--gold-dark)' : 'var(--crimson)', borderRadius:4 }} />
                        </div>
                      </div>
                    )
                  })}
                  {Object.keys(bySubject).length === 0 && <p style={{ fontSize:13, color:'var(--text-muted)', fontStyle:'italic' }}>No syllabus data for this class.</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* PLAN VS LOG RECONCILIATION TAB */}
      {activeTab === 'reconciliation' && (
        <PlanLogReconciliation teacherId={teacherId} teacher={teacher} />
      )}
    </div>
  )
}


// =========================================================================
// ClassTeacherAssignment
//
// Renders the "Class Teacher Of" card on the Overview tab.
// Shows the teacher's current assignment, lets the admin change it via a
// dropdown of canonical class names. Before saving, queries other teacher
// docs to see if the chosen class is already assigned — if so, prompts the
// admin to confirm the replacement (which clears the other teacher's
// classTeacherOf field in the same write so we never have duplicates).
// =========================================================================
function ClassTeacherAssignment({ teacher, setTeacher }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(teacher.classTeacherOf || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Keep draft in sync if teacher doc changes underneath (e.g. another tab).
  useEffect(() => { setDraft(teacher.classTeacherOf || '') }, [teacher.classTeacherOf])

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const target = draft.trim()
      // Nothing changed
      if (target === (teacher.classTeacherOf || '')) {
        setEditing(false); setSaving(false); return
      }

      // If a real class chosen, check no one else in the SAME branch(es) holds it.
      // Different-branch holders are fine — Class 9 MAIN and Class 9 CITY have
      // separate class teachers, and both legitimately have classTeacherOf='Class 9'.
      let currentHolder = null
      if (target) {
        const myBranches = Array.isArray(teacher.branchCodes) ? teacher.branchCodes : []
        const snap = await getDocs(query(collection(db, 'teachers'), where('classTeacherOf', '==', target)))
        const others = snap.docs
          .filter(d => d.id !== teacher.id)
          .filter(d => {
            const otherBranches = Array.isArray(d.data().branchCodes) ? d.data().branchCodes : []
            // Only a collision if their branches overlap with this teacher's branches
            return otherBranches.some(b => myBranches.includes(b))
          })
        if (others.length > 0) {
          currentHolder = { id: others[0].id, ...others[0].data() }
          const holderBranch = (currentHolder.branchCodes && currentHolder.branchCodes[0]) || '?'
          const ok = window.confirm(
            `${currentHolder.fullName || '(unnamed)'} is currently class teacher of ${target} (${holderBranch}).\n\n` +
            `Continue to make ${teacher.fullName} the class teacher of ${target} instead?\n\n` +
            `${currentHolder.fullName}'s class teacher assignment will be cleared.`
          )
          if (!ok) { setSaving(false); return }
        }
      }

      // 1. Clear previous holder if applicable — both teacher doc + their classTeacherByEmail
      if (currentHolder) {
        await updateDoc(doc(db, 'teachers', currentHolder.id), { classTeacherOf: null })
        const prevEmail = (currentHolder.personalEmail || currentHolder.email || '').toLowerCase().trim()
        if (prevEmail) {
          try { await deleteDoc(doc(db, 'classTeacherByEmail', prevEmail)) } catch {}
        }
      }

      // 2. Update target teacher doc
      await updateDoc(doc(db, 'teachers', teacher.id), { classTeacherOf: target || null })

      // 3. Manage this teacher's classTeacherByEmail lookup doc
      //    Keyed by personalEmail (Gmail used to sign into the PWA), falling back
      //    to email if personalEmail isn't set. Branch derived from teacher.branchCodes[0]
      //    since a class teacher is single-branch in practice.
      const myEmail = (teacher.personalEmail || teacher.email || '').toLowerCase().trim()
      if (myEmail) {
        if (target) {
          const branch = Array.isArray(teacher.branchCodes) && teacher.branchCodes.length > 0
            ? teacher.branchCodes[0]
            : null
          if (!branch) {
            console.warn('Teacher has no branchCodes — classTeacherByEmail entry not written')
          } else {
            await setDoc(doc(db, 'classTeacherByEmail', myEmail), {
              className: target,
              branchCode: branch,
              teacherDocId: teacher.id,
              teacherName: teacher.fullName || '',
              updatedAt: serverTimestamp(),
            })
          }
        } else {
          // Unassigning — remove the lookup doc
          try { await deleteDoc(doc(db, 'classTeacherByEmail', myEmail)) } catch {}
        }
      }

      setTeacher(prev => ({ ...prev, classTeacherOf: target || null }))
      setEditing(false)
    } catch (e) {
      console.error('Save classTeacherOf failed:', e)
      setError(e.message || String(e))
    }
    setSaving(false)
  }

  const current = teacher.classTeacherOf

  return (
    <div style={{
      background: 'var(--white)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--gray-100)', padding: '16px 20px',
      marginBottom: 20, display: 'flex', alignItems: 'center',
      gap: 16, flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>
          Class Teacher Of
        </div>
        {!editing && (
          <div style={{ fontSize: 16, fontWeight: 600, color: current ? 'var(--green-dark)' : 'var(--text-muted)' }}>
            {current || 'Not assigned'}
          </div>
        )}
        {editing && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={draft}
              onChange={e => setDraft(e.target.value)}
              disabled={saving}
              style={{
                border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
                padding: '6px 10px', fontSize: 14, fontFamily: 'inherit',
                color: 'var(--text)', background: 'var(--white)',
              }}
            >
              <option value="">— Not assigned —</option>
              {CLASS_NAMES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={save}
              disabled={saving}
              style={{
                background: 'var(--green-dark)', color: 'white', border: 'none',
                borderRadius: 'var(--radius-sm)', padding: '7px 14px',
                fontSize: 13, fontWeight: 500, cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setDraft(current || ''); setEditing(false); setError(null) }}
              disabled={saving}
              style={{
                background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--gray-200)',
                borderRadius: 'var(--radius-sm)', padding: '7px 14px',
                fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--crimson)', marginTop: 6 }}>
            {error}
          </div>
        )}
      </div>
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          style={{
            background: 'transparent', color: 'var(--green-dark)',
            border: '1px solid var(--green-dark)', borderRadius: 'var(--radius-sm)',
            padding: '7px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {current ? 'Change' : 'Assign'}
        </button>
      )}
    </div>
  )
}

