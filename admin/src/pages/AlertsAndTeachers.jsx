import React, { useState, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'

export function Alerts() {
  const { effectiveBranches } = useAuth()
  const [absentees, setAbsentees] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDocs(query(collection(db, 'testMarks'), where('isAbsent', '==', true), ...branchConstraints('branchCode', effectiveBranches)))
      .then(s => { setAbsentees(s.docs.map(d => ({ id:d.id, ...d.data() }))); setLoading(false) })
      .catch(() => setLoading(false))
  }, [effectiveBranches])

  const byTest = absentees.reduce((acc, a) => {
    const key = a.testName || a.testId || 'Unknown Test'
    if (!acc[key]) acc[key] = { testName: key, className: a.className, subject: a.subject, testDate: a.testDate, students: [] }
    acc[key].students.push(a)
    return acc
  }, {})

  return (
    <div style={{ padding:'32px 36px', maxWidth:900 }}>
      <div className="fade-in" style={{ marginBottom:28 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Absentee Alerts</h1>
        <p style={{ fontSize:14, color:'var(--text-muted)' }}>Students who missed tests — grouped by test</p>
        <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : absentees.length === 0 ? (
        <div style={{ textAlign:'center', padding:64, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
          <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <p style={{ fontFamily:'var(--font-display)', fontSize:18, color:'var(--green-dark)', marginBottom:6 }}>No absentees recorded</p>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>All students have appeared in their tests so far.</p>
        </div>
      ) : Object.values(byTest).map(test => (
        <div key={test.testName} className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--crimson-light)', marginBottom:16, overflow:'hidden' }}>
          <div style={{ padding:'14px 20px', background:'var(--crimson-light)', borderBottom:'1px solid rgba(139,26,26,0.1)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--crimson)' }}>{test.testName}</h3>
              <p style={{ fontSize:12, color:'rgba(139,26,26,0.7)', marginTop:2 }}>{test.className} · {test.subject} · {test.testDate}</p>
            </div>
            <span style={{ background:'var(--crimson)', color:'white', fontSize:13, fontWeight:600, padding:'4px 12px', borderRadius:20 }}>{test.students.length} absent</span>
          </div>
          <div style={{ padding:'12px 20px', display:'flex', flexWrap:'wrap', gap:8 }}>
            {test.students.map(s => (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)', border:'1px solid var(--gray-100)' }}>
                <div style={{ width:24, height:24, borderRadius:'50%', background:'var(--crimson-light)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:11, fontWeight:600, color:'var(--crimson)' }}>{(s.studentName||'?')[0]}</span>
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{s.studentName}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>Roll {s.rollNumber || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Teachers() {
  const { effectiveBranches } = useAuth()
  const [teachers, setTeachers] = useState([])
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))),
      getDocs(query(collection(db, 'lessons'), ...branchConstraints('branchCode', effectiveBranches))),
      getDocs(query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches))),
    ]).then(([ts, ls, tt]) => {
      const ttData = tt.docs.map(d => d.data())
      const teachersData = ts.docs.map(d => {
        const t = { id:d.id, ...d.data() }
        // Derive classes from timetable
        const classSet = new Set()
        ttData.filter(s => s.teacherId === t.id).forEach(s => {
          if (Array.isArray(s.classNames) && s.classNames.length) s.classNames.forEach(c => c && classSet.add(c.trim()))
          else if (s.className) s.className.split('+').map(x => x.trim()).filter(Boolean).forEach(c => classSet.add(c))
        })
        return { ...t, classesAssigned: [...classSet].sort().join(', ') }
      })
      setTeachers(teachersData)
      setLessons(ls.docs.map(d => ({ id:d.id, ...d.data() })))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [effectiveBranches])

  const thisMonth = new Date().toISOString().slice(0, 7)

  return (
    <div style={{ padding:'32px 36px', maxWidth:1000 }}>
      <div className="fade-in" style={{ marginBottom:28 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Teachers</h1>
        <p style={{ fontSize:14, color:'var(--text-muted)' }}>Activity overview for all teaching staff</p>
        <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : teachers.length === 0 ? (
        <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
          <p style={{ color:'var(--text-muted)', fontSize:14 }}>No teachers added yet. Add teachers in Firestore under the <code>teachers</code> collection.</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16 }}>
          {teachers.map(t => {
            const tLessons = lessons.filter(l => l.teacherId === t.id)
            const monthLessons = tLessons.filter(l => (l.date||'').startsWith(thisMonth))
            const lastLesson = tLessons.sort((a,b) => (b.date||'').localeCompare(a.date||''))[0]
            const daysAgo = lastLesson ? Math.floor((new Date() - new Date(lastLesson.date)) / 86400000) : 999
            const status = daysAgo === 0 ? 'active' : daysAgo <= 3 ? 'recent' : daysAgo <= 7 ? 'warning' : 'inactive'
            const statusColors = { active:['var(--green-light)','var(--green)','Active'], recent:['var(--gold-light)','var(--gold-dark)','Recent'], warning:['#fff8e1','#b36d00','Inactive 4–7d'], inactive:['var(--crimson-light)','var(--crimson)','Inactive'] }
            const [bg, col, label] = statusColors[status]
            return (
              <div key={t.id} className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden', boxShadow:'var(--shadow-sm)' }}>
                <div style={{ height:4, background: col }} />
                <div style={{ padding:'20px' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid var(--green-muted)' }}>
                        <span style={{ fontSize:18, fontWeight:600, color:'var(--green)' }}>{(t.fullName||'?')[0]}</span>
                      </div>
                      <div>
                        <div style={{ fontSize:14, fontWeight:600, color:'var(--text)' }}>{t.fullName}</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)' }}>{t.email}</div>
                      </div>
                    </div>
                    <span style={{ fontSize:11, padding:'3px 9px', borderRadius:10, background:bg, color:col, fontWeight:500, flexShrink:0 }}>{label}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:12, lineHeight:1.5 }}>
                    <strong style={{ color:'var(--text)' }}>Subjects:</strong> {t.subjectsTaught || '—'}<br/>
                    <strong style={{ color:'var(--text)' }}>Classes:</strong> {t.classesAssigned || '—'}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                    {[
                      { label:'Total lessons', value: tLessons.length },
                      { label:'This month', value: monthLessons.length },
                      { label:'Last active', value: daysAgo === 999 ? 'Never' : daysAgo === 0 ? 'Today' : `${daysAgo}d ago` },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign:'center', padding:'10px 6px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)' }}>
                        <div style={{ fontSize:16, fontWeight:700, color:'var(--green-dark)', fontFamily:'var(--font-display)' }}>{s.value}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
