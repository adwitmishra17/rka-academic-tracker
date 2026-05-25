import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { isAccessible } from '../lib/branchQuery'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import StudentProfileTab from '../components/StudentProfileTab'
import StudentAuditTab from '../components/StudentAuditTab'
import StudentAttendanceTab from '../components/StudentAttendanceTab'

function pct(marks, max) { return max > 0 ? Math.round((marks / max) * 100) : 0 }

function ScoreBadge({ marks, max, pass }) {
  const p = pct(marks, max)
  const passP = pct(pass, max)
  const color = p >= 80 ? 'var(--green)' : p >= passP ? 'var(--gold-dark)' : 'var(--crimson)'
  const bg = p >= 80 ? 'var(--green-light)' : p >= passP ? 'var(--gold-light)' : 'var(--crimson-light)'
  return <span style={{ fontSize:12, fontWeight:600, padding:'3px 9px', borderRadius:10, background:bg, color }}>{p}%</span>
}

function Medal({ rank }) {
  if (rank === 1) return <span style={{ fontSize:15 }}>🥇</span>
  if (rank === 2) return <span style={{ fontSize:15 }}>🥈</span>
  if (rank === 3) return <span style={{ fontSize:15 }}>🥉</span>
  return <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:600, minWidth:22, display:'inline-block', textAlign:'center' }}>#{rank}</span>
}

export default function StudentProfile() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const { user, effectiveBranches } = useAuth()
  const [student, setStudent] = useState(null)
  const [marks, setMarks] = useState([])
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    async function load() {
      try {
        const [studentDoc, marksSnap, testsSnap] = await Promise.all([
          getDoc(doc(db, 'students', studentId)),
          getDocs(query(collection(db, 'testMarks'), where('studentName', '==', ''))), // placeholder
          getDocs(collection(db, 'tests')),
        ])
        if (!studentDoc.exists()) { navigate('/students'); return }
        const studentData = { id: studentDoc.id, ...studentDoc.data() }
        // Defense in depth: a branch admin shouldn't be able to view a student
        // belonging to the other branch by guessing the URL. Bounce them.
        if (!isAccessible(studentData.branchCode, effectiveBranches)) {
          navigate('/students')
          return
        }
        setStudent(studentData)
        setTests(testsSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        // Load marks by student name
        const marksSnap2 = await getDocs(query(collection(db, 'testMarks'), where('studentName', '==', studentData.fullName)))
        setMarks(marksSnap2.docs.map(d => ({ id:d.id, ...d.data() })))
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [studentId, effectiveBranches])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    </div>
  )

  if (!student) return null

  const appeared = marks.filter(m => !m.isAbsent)
  const absent = marks.filter(m => m.isAbsent)
  const totalPct = appeared.length > 0
    ? Math.round(appeared.reduce((s,m) => s + pct(Number(m.marksObtained||0), Number(m.maxMarks||1)), 0) / appeared.length)
    : null

  // Tests for this student's class, with their result
  const classTests = tests.filter(t => t.className === student.className).sort((a,b) => (a.testDate||'').localeCompare(b.testDate||''))

  // Subject-wise breakdown
  const bySubject = {}
  appeared.forEach(m => {
    if (!bySubject[m.subject]) bySubject[m.subject] = { marks: [], tests: 0 }
    bySubject[m.subject].marks.push(pct(Number(m.marksObtained||0), Number(m.maxMarks||1)))
    bySubject[m.subject].tests++
  })
  const subjectStats = Object.entries(bySubject).map(([subject, data]) => ({
    subject,
    avg: Math.round(data.marks.reduce((a,b)=>a+b,0)/data.marks.length),
    tests: data.tests
  })).sort((a,b) => b.avg - a.avg)

  // Chart data
  const chartData = classTests.map(t => {
    const m = marks.find(m => m.testId === t.id)
    return {
      name: t.testName?.replace('Unit Test','UT')?.replace('Monthly','MT')?.slice(0,12) || t.id,
      score: m && !m.isAbsent ? pct(Number(m.marksObtained||0), Number(t.maxMarks||1)) : null,
      absent: m?.isAbsent ? 1 : 0,
      pass: t.passMarks && t.maxMarks ? pct(Number(t.passMarks), Number(t.maxMarks)) : 40,
      max: 100
    }
  }).filter(d => d.score !== null || d.absent)

  const initials = student.fullName?.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()

  return (
    <div style={{ padding:'24px 28px', maxWidth:1000 }}>
      {/* Back */}
      <button onClick={() => navigate('/students')} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:20, padding:0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Students
      </button>

      {/* Profile header */}
      <div className="fade-in" style={{ background:'var(--green-dark)', borderRadius:'var(--radius-lg)', padding:'28px', marginBottom:24, color:'white', display:'flex', alignItems:'flex-start', gap:24, flexWrap:'wrap', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-40, right:-40, width:200, height:200, borderRadius:'50%', background:'rgba(201,162,39,0.08)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg, var(--gold), transparent)' }} />

        {/* Avatar */}
        <div style={{ width:80, height:80, borderRadius:'50%', background:'rgba(201,162,39,0.2)', border:'2px solid rgba(201,162,39,0.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <span style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:700, color:'var(--gold)' }}>{initials}</span>
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'white', marginBottom:6 }}>{student.fullName}</h1>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
            <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.85)' }}>Roll {student.rollNumber}</span>
            <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(201,162,39,0.2)', color:'var(--gold)' }}>{student.className}</span>
            {student.optionalSubject && <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.7)' }}>{student.optionalSubject}</span>}
            <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background: student.isActive !== false ? 'rgba(26,74,46,0.4)' : 'rgba(139,26,26,0.4)', color: student.isActive !== false ? '#9fe1cb' : '#ffb3b3' }}>
              {student.isActive !== false ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:8 }}>
            {student.fatherName && <div style={{ fontSize:12 }}><span style={{ opacity:0.6 }}>Father: </span>{student.fatherName}</div>}
            {student.motherName && <div style={{ fontSize:12 }}><span style={{ opacity:0.6 }}>Mother: </span>{student.motherName}</div>}
            {student.parentPhone && <div style={{ fontSize:12 }}><span style={{ opacity:0.6 }}>Phone: </span>{student.parentPhone}</div>}
            {student.dateOfAdmission && <div style={{ fontSize:12 }}><span style={{ opacity:0.6 }}>Admitted: </span>{student.dateOfAdmission}</div>}
          </div>
        </div>

        {/* Quick stats */}
        <div style={{ display:'flex', gap:12, flexShrink:0 }}>
          {[
            { label:'Overall avg', value: totalPct !== null ? `${totalPct}%` : '—', color: totalPct >= 60 ? 'var(--green)' : totalPct >= 40 ? 'var(--gold)' : 'var(--crimson)' },
            { label:'Tests appeared', value: appeared.length, color:'white' },
            { label:'Absences', value: absent.length, color: absent.length > 0 ? '#ffb3b3' : '#9fe1cb' },
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
        {[['overview','Overview'],['tests','All Tests'],['subjects','By Subject'],['profile','Profile'],['attendance','Attendance'],['history','History']].map(([k,l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{ padding:'8px 20px', borderRadius:'var(--radius-sm)', border:'none', fontSize:13, fontWeight:500, cursor:'pointer', background: activeTab===k ? 'var(--white)' : 'transparent', color: activeTab===k ? 'var(--green)' : 'var(--text-muted)', boxShadow: activeTab===k ? 'var(--shadow-sm)' : 'none', transition:'all 0.15s' }}>{l}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div>
          {/* Performance chart */}
          {chartData.length > 0 && (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'20px', marginBottom:20 }}>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)', marginBottom:16 }}>Score trend across tests</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} barSize={28}>
                  <XAxis dataKey="name" tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0,100]} tick={{ fontSize:10, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={40} stroke="var(--crimson)" strokeDasharray="4 3" label={{ value:'Pass', fill:'var(--crimson)', fontSize:10 }} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Score']} contentStyle={{ fontSize:12, borderRadius:8 }} />
                  <Bar dataKey="score" radius={[4,4,0,0]}>
                    {chartData.map((d,i) => (
                      <Cell key={i} fill={d.score >= 80 ? '#1a4a2e' : d.score >= 60 ? '#2a6b45' : d.score >= 40 ? '#c9a227' : '#8b1a1a'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Subject breakdown */}
          {subjectStats.length > 0 && (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'20px', marginBottom:20 }}>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)', marginBottom:14 }}>Subject-wise average</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {subjectStats.map(s => (
                  <div key={s.subject}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{s.subject}</span>
                      <span style={{ fontSize:13, fontWeight:700, color: s.avg >= 60 ? 'var(--green)' : s.avg >= 40 ? 'var(--gold-dark)' : 'var(--crimson)' }}>{s.avg}%</span>
                    </div>
                    <div style={{ height:8, background:'var(--gray-100)', borderRadius:4, overflow:'hidden' }}>
                      <div style={{ width:`${s.avg}%`, height:'100%', background: s.avg >= 80 ? 'var(--green)' : s.avg >= 60 ? '#2a6b45' : s.avg >= 40 ? 'var(--gold-dark)' : 'var(--crimson)', borderRadius:4, transition:'width 0.6s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Absences */}
          {absent.length > 0 && (
            <div style={{ background:'var(--crimson-light)', borderRadius:'var(--radius-lg)', border:'1px solid rgba(139,26,26,0.15)', padding:'16px 20px' }}>
              <h3 style={{ fontSize:14, fontWeight:600, color:'var(--crimson)', marginBottom:10 }}>⚠ Absent in {absent.length} test{absent.length>1?'s':''}</h3>
              <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                {absent.map(m => {
                  const test = tests.find(t => t.id === m.testId)
                  return (
                    <span key={m.id} style={{ fontSize:12, padding:'4px 11px', borderRadius:16, background:'var(--crimson)', color:'white', fontWeight:500 }}>
                      {test?.testName || m.testName || 'Test'} · {m.subject || test?.subject}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ALL TESTS TAB */}
      {activeTab === 'tests' && (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          {classTests.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No tests scheduled for {student.className} yet.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  {['Test','Subject','Date','Marks','Score','Status'].map(h => (
                    <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classTests.map((t,i) => {
                  const m = marks.find(m => m.testId === t.id)
                  const isAbsent = m?.isAbsent
                  const notTaken = !m
                  return (
                    <tr key={t.id} style={{ borderTop:'1px solid var(--gray-50)', background: isAbsent ? 'var(--crimson-light)' : i%2===0 ? 'var(--white)' : 'var(--gray-50)' }}>
                      <td style={{ padding:'11px 16px', fontWeight:500, color:'var(--text)' }}>{t.testName}</td>
                      <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{t.subject}</td>
                      <td style={{ padding:'11px 16px', color:'var(--text-muted)', whiteSpace:'nowrap' }}>{t.testDate}</td>
                      <td style={{ padding:'11px 16px', fontFamily:'var(--font-display)', fontSize:15, fontWeight:700, color: isAbsent ? 'var(--crimson)' : 'var(--text)' }}>
                        {isAbsent ? '—' : notTaken ? '—' : `${m.marksObtained}/${t.maxMarks}`}
                      </td>
                      <td style={{ padding:'11px 16px' }}>
                        {isAbsent || notTaken ? null : <ScoreBadge marks={Number(m.marksObtained||0)} max={Number(t.maxMarks||1)} pass={Number(t.passMarks||0)} />}
                      </td>
                      <td style={{ padding:'11px 16px' }}>
                        {isAbsent ? <span style={{ fontSize:11, padding:'3px 9px', borderRadius:8, background:'var(--crimson)', color:'white', fontWeight:600 }}>Absent</span>
                          : notTaken ? <span style={{ fontSize:11, color:'var(--gray-400)' }}>Not entered</span>
                          : Number(m.marksObtained||0) >= Number(t.passMarks||0)
                            ? <span style={{ fontSize:11, padding:'3px 9px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>Pass</span>
                            : <span style={{ fontSize:11, padding:'3px 9px', borderRadius:8, background:'var(--crimson-light)', color:'var(--crimson)', fontWeight:500 }}>Fail</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* BY SUBJECT TAB */}
      {activeTab === 'subjects' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {Object.entries(
            marks.reduce((acc, m) => {
              const sub = m.subject || 'Unknown'
              if (!acc[sub]) acc[sub] = []
              acc[sub].push(m)
              return acc
            }, {})
          ).map(([subject, subMarks]) => {
            const app = subMarks.filter(m => !m.isAbsent)
            const abs = subMarks.filter(m => m.isAbsent)
            const avg = app.length ? Math.round(app.reduce((s,m) => s + pct(Number(m.marksObtained||0), Number(m.maxMarks||1)), 0) / app.length) : 0
            // Find rank in class for this subject
            return (
              <div key={subject} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                <div style={{ padding:'12px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{subject}</span>
                  <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                    <span style={{ fontSize:12, color:'var(--green-mid)' }}>{app.length} tests · {abs.length} absent</span>
                    <span style={{ fontSize:15, fontWeight:700, color: avg >= 60 ? 'var(--green)' : avg >= 40 ? 'var(--gold-dark)' : 'var(--crimson)' }}>{avg}% avg</span>
                  </div>
                </div>
                <div style={{ padding:'8px 14px' }}>
                  {subMarks.sort((a,b) => (a.testDate||'').localeCompare(b.testDate||'')).map(m => {
                    const test = tests.find(t => t.id === m.testId)
                    return (
                      <div key={m.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 4px', borderBottom:'1px solid var(--gray-50)', background: m.isAbsent ? 'var(--crimson-light)' : 'transparent', borderRadius: m.isAbsent ? 4 : 0 }}>
                        <span style={{ flex:1, fontSize:13, color:'var(--text)', fontWeight:500 }}>{m.testName || test?.testName}</span>
                        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{m.testDate || test?.testDate}</span>
                        {m.isAbsent ? (
                          <span style={{ fontSize:12, padding:'2px 8px', borderRadius:8, background:'var(--crimson)', color:'white', fontWeight:600 }}>Absent</span>
                        ) : (
                          <>
                            <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{m.marksObtained}/{m.maxMarks}</span>
                            <ScoreBadge marks={Number(m.marksObtained||0)} max={Number(m.maxMarks||1)} pass={Number(test?.passMarks||0)} />
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {activeTab === 'profile' && (
        <StudentProfileTab
          studentId={studentId}
          studentName={student.fullName}
          className={student.className}
          addedByName={user?.email === 'adwit@rkacademyballia.in' ? 'Admin (Adwit)' : 'Admin (Amit)'}
          addedById={user?.uid || ''}
          readOnly={false}
        />
      )}
      {activeTab === 'history' && (
        <StudentAuditTab studentId={studentId} />
      )}
      {activeTab === 'attendance' && (
        <StudentAttendanceTab studentId={studentId} />
      )}
    </div>
  )
}
