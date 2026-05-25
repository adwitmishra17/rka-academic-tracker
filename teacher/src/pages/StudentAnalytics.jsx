import React, { useState, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import StudentProfileTab from '../components/StudentProfileTab'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { getTeacherClasses } from '../utils/teacherClasses'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

function pct(marks, max) { return max > 0 ? Math.round((marks / max) * 100) : 0 }
function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a,b) => a-b)
  const m = Math.floor(s.length/2)
  return s.length%2 ? s[m] : Math.round((s[m-1]+s[m])/2)
}

function ScoreBadge({ p, pass=40 }) {
  const color = p >= 80 ? 'var(--green)' : p >= pass ? 'var(--gold-dark)' : 'var(--crimson)'
  const bg = p >= 80 ? 'var(--green-light)' : p >= pass ? 'var(--gold-light)' : 'var(--crimson-light)'
  return <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:8, background:bg, color }}>{p}%</span>
}

export default function StudentAnalytics() {
  const { teacher, user } = useAuth()
  const [students, setStudents] = useState([])
  const [tests, setTests] = useState([])
  const [marks, setMarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedClass, setSelectedClass] = useState('All')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [search, setSearch] = useState('')
  const [threshold, setThreshold] = useState(40)
  const [view, setView] = useState('class') // class | student

  const [myClasses, setMyClasses] = useState([])
  useEffect(() => {
    if (teacher || user) getTeacherClasses(teacher, user).then(setMyClasses)
  }, [teacher, user])

  useEffect(() => {
    if (!teacher && !user) return
    async function load() {
      try {
        // Branch filter — supports single-branch (most teachers) and dual-branch teachers.
        // 'in' query requires non-empty array; default to ['MAIN'] if branchCodes missing.
        const teacherBranches = (teacher?.branchCodes && teacher.branchCodes.length > 0)
          ? teacher.branchCodes
          : ['MAIN']
        const [studentsSnap, testsSnap, marksSnap] = await Promise.all([
          getDocs(query(collection(db, 'students'), where('branchCode', 'in', teacherBranches))),
          getDocs(query(collection(db, 'tests'), where('branchCode', 'in', teacherBranches))),
          getDocs(query(collection(db, 'testMarks'), where('branchCode', 'in', teacherBranches))),
        ])
        // Withdrawn students are never shown in the teacher PWA — admin only.
        const allStudents = studentsSnap.docs
          .map(d => ({ id:d.id, ...d.data() }))
          .filter(s => s.isActive !== false)
        const allTests = testsSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        const allMarks = marksSnap.docs.map(d => ({ id:d.id, ...d.data() }))
        const myStudents = myClasses.length > 0 ? allStudents.filter(s => myClasses.includes(s.className)) : allStudents
        const myTests = myClasses.length > 0 ? allTests.filter(t => myClasses.includes(t.className)) : allTests
        const myMarks = myClasses.length > 0 ? allMarks.filter(m => myClasses.includes(m.className)) : allMarks
        setStudents(myStudents)
        setTests(myTests)
        setMarks(myMarks)
        if (myClasses.length > 0) setSelectedClass(myClasses[0])
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [teacher])

  const classes = ['All', ...new Set(students.map(s => s.className))]
  const filteredStudents = students
    .filter(s => selectedClass === 'All' || s.className === selectedClass)
    .filter(s => !search || s.fullName?.toLowerCase().includes(search.toLowerCase()) || s.rollNumber?.includes(search))

  // Build student performance
  const studentPerf = filteredStudents.map(s => {
    const sm = marks.filter(m => m.studentName === s.fullName && (selectedClass === 'All' || m.className === selectedClass))
    const appeared = sm.filter(m => !m.isAbsent)
    const avgPct = appeared.length > 0
      ? Math.round(appeared.reduce((a,m) => a + pct(Number(m.marksObtained||0), Number(m.maxMarks||1)), 0) / appeared.length)
      : null
    const absentCount = sm.filter(m => m.isAbsent).length
    const belowThreshold = appeared.filter(m => pct(Number(m.marksObtained||0), Number(m.maxMarks||1)) < threshold).length
    return { ...s, avgPct, appeared: appeared.length, absent: absentCount, belowThreshold }
  }).sort((a,b) => (b.avgPct||0) - (a.avgPct||0))

  // Class stats per test
  const classTests = tests.filter(t => selectedClass === 'All' || t.className === selectedClass)
    .sort((a,b) => (a.testDate||'').localeCompare(b.testDate||''))

  // Student profile view
  const StudentProfile = ({ student }) => {
    const { teacher, user } = useAuth()
    const [spTab, setSpTab] = React.useState('overview')
    const sm = marks.filter(m => m.studentName === student.fullName)
    const appeared = sm.filter(m => !m.isAbsent)
    const classTests = tests.filter(t => t.className === student.className).sort((a,b) => (a.testDate||'').localeCompare(b.testDate||''))
    const avgPct = appeared.length > 0 ? Math.round(appeared.reduce((a,m) => a + pct(Number(m.marksObtained||0), Number(m.maxMarks||1)), 0) / appeared.length) : null
    const initials = student.fullName?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()
    const chartData = classTests.map(t => {
      const m = sm.find(m => m.testId === t.id)
      return { name: t.testName?.slice(0,10)||t.id, score: m&&!m.isAbsent?pct(Number(m.marksObtained||0),Number(t.maxMarks||1)):null, absent:m?.isAbsent, pass:t.passMarks&&t.maxMarks?pct(Number(t.passMarks),Number(t.maxMarks)):40 }
    }).filter(d => d.score !== null || d.absent)
    const bySubject = {}
    appeared.forEach(m => { if (!bySubject[m.subject]) bySubject[m.subject]=[]; bySubject[m.subject].push(pct(Number(m.marksObtained||0),Number(m.maxMarks||1))) })

    return (
      <div>
        <button onClick={() => setSelectedStudent(null)} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:14, padding:0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to class
        </button>

        {/* Student header */}
        <div style={{ background:'var(--green-dark)', borderRadius:'var(--radius-lg)', padding:'20px', marginBottom:16, color:'white', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg, var(--gold), transparent)' }} />
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(201,162,39,0.2)', border:'2px solid rgba(201,162,39,0.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:700, color:'var(--gold)' }}>{initials}</span>
            </div>
            <div>
              <div style={{ fontSize:17, fontWeight:600 }}>{student.fullName}</div>
              <div style={{ fontSize:12, opacity:0.7 }}>Roll {student.rollNumber} · {student.className}</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            {[
              { label:'Overall avg', value: avgPct!==null?`${avgPct}%`:'—', color: avgPct>=60?'var(--green)':avgPct!==null?'#ffb3b3':'white' },
              { label:'Tests appeared', value: appeared.length, color:'white' },
              { label:'Absences', value: sm.filter(m=>m.isAbsent).length, color: sm.filter(m=>m.isAbsent).length>0?'#ffb3b3':'#9fe1cb' },
            ].map(s => (
              <div key={s.label} style={{ textAlign:'center', background:'rgba(255,255,255,0.07)', borderRadius:'var(--radius-sm)', padding:'10px 6px' }}>
                <div style={{ fontSize:18, fontWeight:700, color:s.color, fontFamily:'var(--font-display)' }}>{s.value}</div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,0.5)', marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display:'flex', background:'var(--gray-50)', borderRadius:'var(--radius-md)', padding:3, border:'1px solid var(--gray-100)', marginBottom:16, width:'fit-content' }}>
          {[['overview','Overview'],['profile','Profile']].map(([k,l]) => (
            <button key={k} onClick={() => setSpTab(k)} style={{ padding:'7px 18px', borderRadius:'var(--radius-sm)', border:'none', fontSize:13, fontWeight:500, cursor:'pointer', background:spTab===k?'var(--white)':'transparent', color:spTab===k?'var(--green)':'var(--text-muted)', boxShadow:spTab===k?'var(--shadow-sm)':'none', transition:'all 0.15s' }}>{l}</button>
          ))}
        </div>

        {spTab === 'profile' && (
          <StudentProfileTab
            studentId={student.id}
            studentName={student.fullName}
            className={student.className}
            addedByName={teacher?.fullName || 'Teacher'}
            addedById={teacher?.id || ''}
            readOnly={false}
          />
        )}

        {spTab === 'overview' && (
          <div>
            {chartData.length > 0 && (
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'16px', marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:12 }}>Score trend</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={chartData} barSize={20}>
                    <XAxis dataKey="name" tick={{ fontSize:9, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0,100]} tick={{ fontSize:9, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <ReferenceLine y={threshold} stroke="var(--crimson)" strokeDasharray="3 3" />
                    <Tooltip formatter={v => [`${v}%`,'Score']} contentStyle={{ fontSize:11, borderRadius:8 }} />
                    <Bar dataKey="score" radius={[3,3,0,0]}>
                      {chartData.map((d,i) => <Cell key={i} fill={d.score>=80?'#1a4a2e':d.score>=60?'#2a6b45':d.score>=threshold?'#c9a227':'#8b1a1a'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {Object.keys(bySubject).length > 0 && (
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'16px', marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:10 }}>Subject averages</div>
                {Object.entries(bySubject).map(([sub, scores]) => {
                  const avg = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)
                  return (
                    <div key={sub} style={{ marginBottom:8 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                        <span style={{ fontSize:12, color:'var(--text)' }}>{sub}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:avg>=60?'var(--green)':avg>=40?'var(--gold-dark)':'var(--crimson)' }}>{avg}%</span>
                      </div>
                      <div style={{ height:6, background:'var(--gray-100)', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ width:`${avg}%`, height:'100%', background:avg>=80?'var(--green)':avg>=60?'#2a6b45':avg>=40?'var(--gold-dark)':'var(--crimson)', borderRadius:3 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
              <div style={{ padding:'12px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', fontSize:13, fontWeight:600, color:'var(--text)' }}>All test marks</div>
              {classTests.map((t,i) => {
                const m = sm.find(m => m.testId === t.id)
                const isAbsent = m?.isAbsent
                const p = m&&!isAbsent?pct(Number(m.marksObtained||0),Number(t.maxMarks||1)):null
                return (
                  <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid var(--gray-50)', background:isAbsent?'var(--crimson-light)':i%2===0?'var(--white)':'var(--gray-50)' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>{t.testName}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>{t.subject} · {t.testDate}</div>
                    </div>
                    {isAbsent ? <span style={{ fontSize:11, color:'var(--crimson)', fontWeight:600 }}>Absent</span>
                      : !m ? <span style={{ fontSize:11, color:'var(--gray-400)' }}>—</span>
                      : <><span style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>{m.marksObtained}/{t.maxMarks}</span><ScoreBadge p={p} pass={pct(Number(t.passMarks||0),Number(t.maxMarks||1))} /></>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} /></div>

  if (selectedStudent) return <div style={{ padding:'20px' }}><StudentProfile student={selectedStudent} /></div>

  return (
    <div style={{ padding:'20px' }}>
      <div className="fade-up" style={{ marginBottom:18 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color:'var(--green-dark)' }}>Student Analytics</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>Performance overview for your classes</p>
      </div>

      {/* Class filter */}
      <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:12 }}>
        {classes.map(c => (
          <button key={c} onClick={() => setSelectedClass(c)} style={{ padding:'6px 13px', borderRadius:20, border:'1px solid', borderColor: selectedClass===c?'var(--green)':'var(--gray-200)', background: selectedClass===c?'var(--green)':'var(--white)', color: selectedClass===c?'white':'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>{c}</button>
        ))}
      </div>

      {/* Search and threshold */}
      <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center' }}>
        <div style={{ position:'relative', flex:1 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search student…" style={{ width:'100%', padding:'9px 10px 9px 28px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5, padding:'0 10px', background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', height:38 }}>
          <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>Flag &lt;</span>
          <input type="number" min="0" max="100" value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width:38, border:'none', fontSize:13, fontWeight:600, color:'var(--crimson)', outline:'none', textAlign:'center' }} />
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>%</span>
        </div>
      </div>

      {/* Class test summary */}
      {classTests.length > 0 && (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'14px', marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>Class test summary</div>
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {classTests.map(t => {
              const tm = marks.filter(m => m.testId === t.id && !m.isAbsent)
              const scores = tm.map(m => Number(m.marksObtained||0))
              const avg = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0
              const med = median(scores)
              const high = scores.length ? Math.max(...scores) : 0
              const avgP = pct(avg, Number(t.maxMarks||1))
              const belowT = tm.filter(m => pct(Number(m.marksObtained||0), Number(t.maxMarks||1)) < threshold).length
              return (
                <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.testName}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)' }}>{t.subject} · {t.testDate}</div>
                  </div>
                  {scores.length > 0 ? (
                    <div style={{ display:'flex', gap:8, fontSize:11, flexShrink:0 }}>
                      <span style={{ color:'var(--green)', fontWeight:600 }}>Avg {avgP}%</span>
                      <span style={{ color:'var(--text-muted)' }}>Med {pct(med, Number(t.maxMarks||1))}%</span>
                      <span style={{ color:'var(--text-muted)' }}>High {high}</span>
                      {belowT > 0 && <span style={{ color:'var(--crimson)', fontWeight:600 }}>⚠{belowT}</span>}
                    </div>
                  ) : <span style={{ fontSize:11, color:'var(--text-muted)' }}>No marks</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Student list */}
      <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>
        Students ({studentPerf.length})
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
        {studentPerf.length === 0 ? (
          <div style={{ textAlign:'center', padding:40, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:13 }}>No students found.</div>
        ) : studentPerf.map((s,i) => (
          <div key={s.id} onClick={() => setSelectedStudent(s)} style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px', background: s.belowThreshold > 0 ? 'var(--crimson-light)' : 'var(--white)', borderRadius:'var(--radius-lg)', border:`1px solid ${s.belowThreshold>0?'rgba(139,26,26,0.15)':'var(--gray-100)'}`, cursor:'pointer', transition:'all 0.15s' }}>
            <div style={{ width:32, height:32, borderRadius:'50%', background: i < 3 ? 'var(--green)' : 'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize:11, fontWeight:700, color: i<3?'white':'var(--green)' }}>{s.fullName?.[0]||'?'}</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.fullName}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)' }}>Roll {s.rollNumber} · {s.className}</div>
            </div>
            <div style={{ textAlign:'right', flexShrink:0 }}>
              {s.avgPct !== null ? <ScoreBadge p={s.avgPct} pass={threshold} /> : <span style={{ fontSize:11, color:'var(--gray-400)' }}>No marks</span>}
              {s.belowThreshold > 0 && <div style={{ fontSize:10, color:'var(--crimson)', fontWeight:600, marginTop:2 }}>⚠ {s.belowThreshold} test{s.belowThreshold>1?'s':''} below {threshold}%</div>}
            </div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ flexShrink:0 }}><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        ))}
      </div>
    </div>
  )
}
