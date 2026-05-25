import React, { useState, useEffect } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { getTeacherClasses } from '../utils/teacherClasses'

const EXAM_PERIODS = [
  { key:'periodic1', label:'Periodic 1', color:'#e6f1fb', textColor:'#185fa5' },
  { key:'halfyearly', label:'Half Yearly', color:'var(--green-light)', textColor:'var(--green)' },
  { key:'periodic2', label:'Periodic 2', color:'var(--gold-light)', textColor:'var(--gold-dark)' },
  { key:'preboards', label:'Pre-Boards', color:'var(--crimson-light)', textColor:'var(--crimson)' },
  { key:'boards', label:'Boards', color:'#f0e8f5', textColor:'#6b21a8' },
]

// Assign exam period based on target month
function getExamPeriod(targetMonth) {
  if (!targetMonth) return 'periodic1'
  const m = targetMonth.toLowerCase()
  if (m.includes('apr') || m.includes('may') || m.includes('jun')) return 'periodic1'
  if (m.includes('jul') || m.includes('aug') || m.includes('sep')) return 'halfyearly'
  if (m.includes('oct') || m.includes('nov')) return 'periodic2'
  if (m.includes('dec') || m.includes('jan')) return 'preboards'
  if (m.includes('feb') || m.includes('mar')) return 'boards'
  return 'periodic1'
}

export default function MySyllabus() {
  const { teacher, user } = useAuth()
  const [syllabus, setSyllabus] = useState([])
  const [lessons, setLessons] = useState([])
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState('all')
  const [loading, setLoading] = useState(true)

  const [myClasses, setMyClasses] = useState([])
  useEffect(() => {
    if (teacher || user) getTeacherClasses(teacher, user).then(setMyClasses)
  }, [teacher, user])

  useEffect(() => {
    if (myClasses.length > 0 && !selectedClass) setSelectedClass(myClasses[0])
  }, [teacher])

  useEffect(() => {
    if (!selectedClass) { setLoading(false); return }
    setLoading(true)
    const promises = [
      getDocs(query(collection(db, 'syllabus'), where('className', '==', selectedClass)))
    ]
    if (teacher?.id) {
      promises.push(getDocs(query(collection(db, 'lessons'), where('teacherId', '==', teacher.id), where('className', '==', selectedClass))))
    } else {
      promises.push(Promise.resolve({ docs: [] }))
    }
    Promise.all(promises).then(([sSnap, lSnap]) => {
      const syll = sSnap.docs.map(d => ({ id:d.id, ...d.data() }))
      setSyllabus(syll)
      setLessons(lSnap.docs.map(d => ({ id:d.id, ...d.data() })))
      // Auto-select first subject
      const subjects = [...new Set(syll.map(t => t.subject))]
      if (subjects.length > 0 && !selectedSubject) setSelectedSubject(subjects[0])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selectedClass, teacher])

  const coveredIds = new Set(lessons.flatMap(l => Array.isArray(l.topicIds) ? l.topicIds : []))
  const periodsByTopic = lessons.reduce((acc, l) => {
    const ids = Array.isArray(l.topicIds) ? l.topicIds : []
    ids.forEach(tid => { acc[tid] = (acc[tid]||0) + (Number(l.actualPeriods)||1) })
    return acc
  }, {})

  const subjects = [...new Set(syllabus.map(t => t.subject))]

  // Filter by subject and exam period
  const filtered = syllabus.filter(t => {
    const matchSubject = !selectedSubject || t.subject === selectedSubject
    const matchPeriod = selectedPeriod === 'all' || getExamPeriod(t.targetMonth) === selectedPeriod
    return matchSubject && matchPeriod
  })

  const byChapter = filtered.reduce((acc, t) => {
    if (!acc[t.chapter]) acc[t.chapter] = []
    acc[t.chapter].push(t)
    return acc
  }, {})

  // Overall progress
  const total = syllabus.filter(t => !selectedSubject || t.subject === selectedSubject).length
  const covered = syllabus.filter(t => (!selectedSubject || t.subject === selectedSubject) && coveredIds.has(t.id)).length
  const pct = total > 0 ? Math.round((covered/total)*100) : 0

  // Period-wise progress
  const periodProgress = EXAM_PERIODS.map(ep => {
    const periodTopics = syllabus.filter(t => (!selectedSubject || t.subject === selectedSubject) && getExamPeriod(t.targetMonth) === ep.key)
    const periodCovered = periodTopics.filter(t => coveredIds.has(t.id)).length
    const periodPct = periodTopics.length > 0 ? Math.round((periodCovered/periodTopics.length)*100) : 0
    return { ...ep, total: periodTopics.length, covered: periodCovered, pct: periodPct }
  }).filter(ep => ep.total > 0)

  if (myClasses.length === 0) return (
    <div style={{ padding:24 }}>
      <div style={{ background:'var(--gold-light)', border:'1px solid rgba(201,162,39,0.3)', borderRadius:'var(--radius-lg)', padding:'28px 20px', textAlign:'center' }}>
        <p style={{ fontSize:14, color:'var(--gold-dark)', fontWeight:500 }}>No classes assigned yet</p>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginTop:4 }}>Ask the admin to add your periods to the timetable.</p>
      </div>
    </div>
  )

  return (
    <div style={{ padding:'20px' }}>
      <div className="fade-up" style={{ marginBottom:18 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:600, color:'var(--green-dark)' }}>My Syllabus</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginTop:3 }}>Track completion across exam periods</p>
      </div>

      {/* Class tabs */}
      <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:12 }}>
        {myClasses.map(c => (
          <button key={c} onClick={() => { setSelectedClass(c); setSelectedSubject(''); setSelectedPeriod('all') }} style={{ padding:'7px 13px', borderRadius:20, border:'1px solid', borderColor: selectedClass===c ? 'var(--green)' : 'var(--gray-200)', background: selectedClass===c ? 'var(--green)' : 'var(--white)', color: selectedClass===c ? 'white' : 'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
            {c}
          </button>
        ))}
      </div>

      {/* Subject tabs */}
      {subjects.length > 0 && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
          {subjects.map(s => (
            <button key={s} onClick={() => setSelectedSubject(s)} style={{ padding:'5px 12px', borderRadius:16, border:'1px solid', borderColor: selectedSubject===s ? 'var(--gold-dark)' : 'var(--gray-200)', background: selectedSubject===s ? 'var(--gold-light)' : 'var(--white)', color: selectedSubject===s ? 'var(--gold-dark)' : 'var(--text-muted)', fontSize:11, fontWeight:500, cursor:'pointer' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Overall progress */}
      <div style={{ background:'var(--green)', borderRadius:'var(--radius-lg)', padding:'16px', marginBottom:14, color:'white' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:10 }}>
          <div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, lineHeight:1 }}>{pct}%</div>
            <div style={{ fontSize:11, opacity:0.7, marginTop:3 }}>overall completion</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:20, fontWeight:700 }}>{covered}<span style={{ fontSize:12, fontWeight:400, opacity:0.7 }}>/{total}</span></div>
            <div style={{ fontSize:11, opacity:0.7 }}>topics covered</div>
          </div>
        </div>
        <div style={{ height:8, background:'rgba(255,255,255,0.2)', borderRadius:4, overflow:'hidden' }}>
          <div style={{ width:`${pct}%`, height:'100%', background:'var(--gold)', borderRadius:4, transition:'width 0.6s ease' }} />
        </div>
      </div>

      {/* Exam period progress cards */}
      {periodProgress.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>By Exam Period</div>
          <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
            {periodProgress.map(ep => (
              <button key={ep.key} onClick={() => setSelectedPeriod(selectedPeriod === ep.key ? 'all' : ep.key)} style={{ flex:'1', minWidth:80, padding:'10px 8px', borderRadius:'var(--radius-md)', border:`2px solid ${selectedPeriod===ep.key ? ep.textColor : 'transparent'}`, background: ep.color, cursor:'pointer', textAlign:'center', transition:'all 0.15s' }}>
                <div style={{ fontSize:14, fontWeight:700, color:ep.textColor }}>{ep.pct}%</div>
                <div style={{ fontSize:10, color:ep.textColor, opacity:0.8, marginTop:2, fontWeight:500 }}>{ep.label}</div>
                <div style={{ fontSize:10, color:ep.textColor, opacity:0.6 }}>{ep.covered}/{ep.total}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter pill */}
      {selectedPeriod !== 'all' && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>Showing:</span>
          <span style={{ fontSize:12, padding:'3px 10px', borderRadius:16, background: EXAM_PERIODS.find(e=>e.key===selectedPeriod)?.color, color: EXAM_PERIODS.find(e=>e.key===selectedPeriod)?.textColor, fontWeight:500 }}>
            {EXAM_PERIODS.find(e=>e.key===selectedPeriod)?.label}
          </span>
          <button onClick={() => setSelectedPeriod('all')} style={{ fontSize:11, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer' }}>Clear ×</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:'center', padding:40 }}>
          <div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} />
        </div>
      ) : Object.keys(byChapter).length === 0 ? (
        <div style={{ textAlign:'center', padding:'32px 20px', background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
          <p style={{ color:'var(--text-muted)', fontSize:14 }}>No topics found for this selection.</p>
        </div>
      ) : Object.entries(byChapter).map(([chapter, topics]) => {
        const chCovered = topics.filter(t => coveredIds.has(t.id)).length
        const chPct = Math.round((chCovered/topics.length)*100)
        return (
          <div key={chapter} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', marginBottom:12, overflow:'hidden' }}>
            <div style={{ padding:'12px 14px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--green-dark)', flex:1 }}>{chapter}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:60, height:6, background:'rgba(26,74,46,0.15)', borderRadius:3, overflow:'hidden' }}>
                  <div style={{ width:`${chPct}%`, height:'100%', background:'var(--green)', borderRadius:3 }} />
                </div>
                <span style={{ fontSize:12, fontWeight:600, color:'var(--green-dark)', minWidth:30 }}>{chPct}%</span>
              </div>
            </div>
            <div style={{ padding:'6px 10px' }}>
              {topics.map(t => {
                const done = coveredIds.has(t.id)
                const actualP = periodsByTopic[t.id] || 0
                const ep = EXAM_PERIODS.find(e => e.key === getExamPeriod(t.targetMonth))
                const aType = t.assessmentType
                return (
                  <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 4px', borderBottom:'1px solid var(--gray-50)' }}>
                    <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0, background: done ? 'var(--green)' : 'var(--white)', border:`1.5px solid ${done ? 'var(--green)' : 'var(--gray-200)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {done && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                    </div>
                    <span style={{ flex:1, fontSize:12, color: done ? 'var(--green-dark)' : 'var(--text)', fontWeight: done ? 500 : 400 }}>{t.topicName}</span>
                    {ep && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:ep.color, color:ep.textColor, flexShrink:0 }}>{ep.label}</span>}
                    {aType && aType !== 'summative' && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'var(--gray-100)', color:'var(--text-muted)', flexShrink:0 }}>{aType}</span>}
                    <span style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>
                      {done ? `${actualP}/${t.plannedPeriods||'?'}p` : `${t.plannedPeriods||'?'}p`}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
