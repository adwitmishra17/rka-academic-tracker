import React, { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, getDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { Link } from 'react-router-dom'

// CLASSES loaded via useClasses()
const EXAM_PERIODS = [
  { key:'all', label:'All' },
  { key:'periodic1', label:'Periodic 1', months:['Apr','May','Jun'] },
  { key:'halfyearly', label:'Half Yearly', months:['Jul','Aug','Sep'] },
  { key:'periodic2', label:'Periodic 2', months:['Oct','Nov'] },
  { key:'preboards', label:'Pre-Boards', months:['Dec','Jan'] },
  { key:'boards', label:'Boards', months:['Feb','Mar'] },
]
const MONTHS = ['Apr 2025','May 2025','Jun 2025','Jul 2025','Aug 2025','Sep 2025','Oct 2025','Nov 2025','Dec 2025','Jan 2026','Feb 2026','Mar 2026']
const ASSESSMENT_TYPES = ['summative','formative','practical','teacher_note']

function getExamPeriod(targetMonth) {
  if (!targetMonth) return 'periodic1'
  const m = targetMonth.toLowerCase()
  if (m.includes('apr')||m.includes('may')||m.includes('jun')) return 'periodic1'
  if (m.includes('jul')||m.includes('aug')||m.includes('sep')) return 'halfyearly'
  if (m.includes('oct')||m.includes('nov')) return 'periodic2'
  if (m.includes('dec')||m.includes('jan')) return 'preboards'
  if (m.includes('feb')||m.includes('mar')) return 'boards'
  return 'periodic1'
}

function ProgressBar({ value, max }) {
  const pct = max > 0 ? Math.round((value/max)*100) : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ flex:1, height:7, background:'var(--gray-100)', borderRadius:4, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background: pct>=80?'var(--green)':pct>=50?'var(--gold-dark)':'var(--crimson)', borderRadius:4, transition:'width 0.5s' }} />
      </div>
      <span style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', minWidth:36, textAlign:'right' }}>{pct}%</span>
    </div>
  )
}

const EMPTY_FORM = { unit:'', chapter:'', topicName:'', plannedPeriods:'3', targetMonth:'Apr 2025', assessmentType:'summative', subject:'' }

export default function Syllabus() {
  const { classNames: CLASSES } = useClasses()
  const [selectedClass, setSelectedClass] = useState('Class 9')
  const [topics, setTopics] = useState([])
  const [lessons, setLessons] = useState([])
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterPeriod, setFilterPeriod] = useState('all')
  const [filterSubject, setFilterSubject] = useState('All')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editTopic, setEditTopic] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [classes, setClasses] = useState([])

  const inp = { width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

  async function load(cls) {
    setLoading(true)
    try {
      const [topicsSnap, lessonsSnap, classesSnap, subjectsDoc] = await Promise.all([
        getDocs(query(collection(db, 'syllabus'), where('className', '==', cls))),
        getDocs(query(collection(db, 'lessons'), where('className', '==', cls))),
        getDocs(collection(db, 'classes')),
        getDoc(doc(db, 'settings', 'subjects')),
      ])
      const t = topicsSnap.docs.map(d => ({ id:d.id, ...d.data() }))
      setTopics(t)
      setLessons(lessonsSnap.docs.map(d => ({ id:d.id, ...d.data() })))
      setClasses(classesSnap.docs.map(d => ({ id:d.id, ...d.data() })))
      // Subjects: from settings or infer from existing topics
      if (subjectsDoc.exists() && subjectsDoc.data().list?.length) {
        setSubjects(subjectsDoc.data().list)
      } else {
        setSubjects([...new Set(t.map(x => x.subject).filter(Boolean))])
      }
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load(selectedClass) }, [selectedClass])

  const coveredIds = new Set(lessons.flatMap(l => Array.isArray(l.topicIds) ? l.topicIds : []))

  const classDoc = classes.find(c => c.className === selectedClass)
  const classId = classDoc?.id || ''

  function openAdd() {
    setEditTopic(null)
    setForm({ ...EMPTY_FORM, subject: subjects[0] || '' })
    setShowModal(true)
  }

  function openEdit(topic) {
    setEditTopic(topic)
    setForm({
      unit: topic.unit || '',
      chapter: topic.chapter || '',
      topicName: topic.topicName || '',
      plannedPeriods: String(topic.plannedPeriods || 3),
      targetMonth: topic.targetMonth || 'Apr 2025',
      assessmentType: topic.assessmentType || 'summative',
      subject: topic.subject || '',
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.topicName.trim() || !form.chapter.trim()) return
    setSaving(true)
    try {
      const data = {
        className: selectedClass,
        classId,
        subject: form.subject,
        unit: form.unit.trim(),
        chapter: form.chapter.trim(),
        topicName: form.topicName.trim(),
        plannedPeriods: Number(form.plannedPeriods) || 3,
        targetMonth: form.targetMonth,
        assessmentType: form.assessmentType,
        updatedAt: Timestamp.now(),
      }
      if (editTopic) {
        await updateDoc(doc(db, 'syllabus', editTopic.id), data)
      } else {
        await addDoc(collection(db, 'syllabus'), { ...data, createdAt: Timestamp.now() })
      }
      await load(selectedClass)
      setShowModal(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function handleDelete(topic) {
    if (!confirm(`Delete "${topic.topicName}"? This cannot be undone.`)) return
    await deleteDoc(doc(db, 'syllabus', topic.id))
    setTopics(prev => prev.filter(t => t.id !== topic.id))
  }

  async function handleDeleteAll() {
    if (!confirm(`Delete ALL ${topics.length} topics for ${selectedClass}? This cannot be undone.`)) return
    await Promise.all(topics.map(t => deleteDoc(doc(db, 'syllabus', t.id))))
    setTopics([])
  }

  // Filter
  const allSubjects = ['All', ...new Set(topics.map(t => t.subject).filter(Boolean))]
  const filtered = topics.filter(t => {
    const matchPeriod = filterPeriod === 'all' || getExamPeriod(t.targetMonth) === filterPeriod
    const matchSubject = filterSubject === 'All' || t.subject === filterSubject
    const matchSearch = !search || t.topicName?.toLowerCase().includes(search.toLowerCase()) || t.chapter?.toLowerCase().includes(search.toLowerCase())
    return matchPeriod && matchSubject && matchSearch
  })

  // Group by chapter
  const byChapter = filtered.reduce((acc, t) => {
    const key = `${t.subject}||${t.chapter}`
    if (!acc[key]) acc[key] = { subject: t.subject, chapter: t.chapter, topics: [] }
    acc[key].topics.push(t)
    return acc
  }, {})

  const totalTopics = topics.length
  const coveredTopics = topics.filter(t => coveredIds.has(t.id)).length
  const assessmentBadge = (type) => {
    const map = { summative:['Summative','var(--green)','var(--green-light)'], formative:['Formative','var(--gold-dark)','var(--gold-light)'], practical:['Practical','#185fa5','#e6f1fb'], teacher_note:['Teacher note','var(--text-muted)','var(--gray-100)'] }
    const [label,color,bg] = map[type] || map.summative
    return <span style={{ fontSize:10, padding:'2px 7px', borderRadius:8, background:bg, color, fontWeight:500, flexShrink:0 }}>{label}</span>
  }

  return (
    <div style={{ padding:'24px 28px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:20, display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Syllabus</h1>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>View, add, edit and delete syllabus topics per class</p>
          <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <Link to="/syllabus-upload" style={{ padding:'9px 16px', background:'var(--green-light)', color:'var(--green)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, textDecoration:'none' }}>↑ Upload PDF</Link>
          <button onClick={openAdd} style={{ padding:'9px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer', boxShadow:'0 2px 8px rgba(26,74,46,0.2)' }}>+ Add Topic</button>
        </div>
      </div>

      {/* Class selector */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {CLASSES.map(c => (
          <button key={c} onClick={() => { setSelectedClass(c); setFilterPeriod('all'); setFilterSubject('All'); setSearch('') }} style={{ padding:'7px 14px', borderRadius:20, border:'1px solid', borderColor: selectedClass===c?'var(--green)':'var(--gray-200)', background: selectedClass===c?'var(--green)':'var(--white)', color: selectedClass===c?'white':'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
            {c}
          </button>
        ))}
      </div>

      {/* Summary */}
      {!loading && (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'16px 20px', border:'1px solid var(--gray-100)', marginBottom:16, display:'flex', alignItems:'center', gap:24, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, color:'var(--green-dark)' }}>{coveredTopics}<span style={{ fontSize:16, fontWeight:400, color:'var(--text-muted)' }}>/{totalTopics}</span></div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>topics covered</div>
          </div>
          <div style={{ flex:1, minWidth:200 }}><ProgressBar value={coveredTopics} max={totalTopics} /></div>
          <div style={{ fontSize:12, color:'var(--text-muted)' }}>{filtered.length} showing · {topics.length} total</div>
          {topics.length > 0 && (
            <button onClick={handleDeleteAll} style={{ fontSize:12, color:'var(--crimson)', background:'none', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-sm)', padding:'5px 12px', cursor:'pointer' }}>Delete all for {selectedClass}</button>
          )}
        </div>
      )}

      {/* Exam period filter */}
      <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:12 }}>
        {EXAM_PERIODS.map(ep => (
          <button key={ep.key} onClick={() => setFilterPeriod(ep.key)} style={{ padding:'5px 13px', borderRadius:20, border:'1px solid', borderColor: filterPeriod===ep.key?'var(--green)':'var(--gray-200)', background: filterPeriod===ep.key?'var(--green)':'var(--white)', color: filterPeriod===ep.key?'white':'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
            {ep.label}
          </button>
        ))}
      </div>

      {/* Search and subject filter */}
      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <div style={{ position:'relative', flex:1, minWidth:180 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search topics or chapters…" style={{ width:'100%', padding:'9px 10px 9px 30px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }} />
        </div>
        <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} style={{ padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          {allSubjects.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : Object.keys(byChapter).length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 24px', background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
          <p style={{ fontSize:15, fontWeight:500, color:'var(--text)', marginBottom:8 }}>No topics found</p>
          <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:16 }}>Upload a syllabus PDF or add topics manually.</p>
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <Link to="/syllabus-upload" style={{ padding:'10px 20px', background:'var(--green-light)', color:'var(--green)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, textDecoration:'none' }}>↑ Upload PDF</Link>
            <button onClick={openAdd} style={{ padding:'10px 20px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer' }}>+ Add Topic</button>
          </div>
        </div>
      ) : (
        Object.entries(byChapter).map(([key, { subject, chapter, topics: chTopics }]) => {
          const chCovered = chTopics.filter(t => coveredIds.has(t.id)).length
          return (
            <div key={key} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', marginBottom:12, overflow:'hidden' }}>
              <div style={{ padding:'11px 16px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--green-dark)' }}>{chapter}</div>
                  {subject && <div style={{ fontSize:11, color:'var(--green-mid)', marginTop:1 }}>{subject}</div>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:60, height:5, background:'rgba(26,74,46,0.15)', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ width:`${chTopics.length>0?Math.round(chCovered/chTopics.length*100):0}%`, height:'100%', background:'var(--green)', borderRadius:3 }} />
                  </div>
                  <span style={{ fontSize:11, color:'var(--green-dark)', fontWeight:600 }}>{chCovered}/{chTopics.length}</span>
                </div>
              </div>
              <div style={{ padding:'4px 10px' }}>
                {chTopics.map(t => {
                  const covered = coveredIds.has(t.id)
                  return (
                    <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 6px', borderBottom:'1px solid var(--gray-50)' }}>
                      <div style={{ width:16, height:16, borderRadius:'50%', flexShrink:0, background: covered?'var(--green)':'var(--white)', border:`1.5px solid ${covered?'var(--green)':'var(--gray-200)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {covered && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                      </div>
                      <span style={{ flex:1, fontSize:13, color: covered?'var(--green-dark)':'var(--text)', fontWeight: covered?500:400 }}>{t.topicName}</span>
                      {assessmentBadge(t.assessmentType)}
                      <span style={{ fontSize:11, color:'var(--text-muted)', flexShrink:0, minWidth:55, textAlign:'right' }}>{t.targetMonth}</span>
                      <span style={{ fontSize:11, color:'var(--text-muted)', flexShrink:0 }}>{t.plannedPeriods}p</span>
                      <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                        <button onClick={() => openEdit(t)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Edit</button>
                        <button onClick={() => handleDelete(t)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer' }}>✕</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:20 }}>
          <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:500, boxShadow:'var(--shadow-lg)', maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'var(--white)', zIndex:1 }}>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:600, color:'var(--green-dark)' }}>{editTopic ? 'Edit Topic' : 'Add Topic'} — {selectedClass}</h2>
              <button onClick={() => setShowModal(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22, lineHeight:1 }}>×</button>
            </div>
            <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Subject <span style={{ color:'var(--crimson)' }}>*</span></label>
                <select value={form.subject} onChange={e => setForm(p=>({...p, subject:e.target.value}))} style={inp}>
                  <option value="">Select subject…</option>
                  {subjects.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Unit / Section</label>
                <input value={form.unit} onChange={e => setForm(p=>({...p, unit:e.target.value}))} placeholder="e.g. Chemical Substances - Nature and Behaviour" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Chapter <span style={{ color:'var(--crimson)' }}>*</span></label>
                <input value={form.chapter} onChange={e => setForm(p=>({...p, chapter:e.target.value}))} placeholder="e.g. Chemical Reactions and Equations" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Topic Name <span style={{ color:'var(--crimson)' }}>*</span></label>
                <input value={form.topicName} onChange={e => setForm(p=>({...p, topicName:e.target.value}))} placeholder="e.g. Types of chemical reactions" style={inp} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Planned Periods</label>
                  <input type="number" min="1" max="10" value={form.plannedPeriods} onChange={e => setForm(p=>({...p, plannedPeriods:e.target.value}))} style={inp} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Target Month</label>
                  <select value={form.targetMonth} onChange={e => setForm(p=>({...p, targetMonth:e.target.value}))} style={inp}>
                    {MONTHS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Assessment Type</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {ASSESSMENT_TYPES.map(t => (
                    <button key={t} onClick={() => setForm(p=>({...p, assessmentType:t}))} style={{ padding:'6px 12px', borderRadius:16, border:'1px solid', borderColor: form.assessmentType===t?'var(--green)':'var(--gray-200)', background: form.assessmentType===t?'var(--green)':'var(--white)', color: form.assessmentType===t?'white':'var(--text-muted)', fontSize:12, fontWeight:500, cursor:'pointer', textTransform:'capitalize' }}>
                      {t.replace('_',' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display:'flex', gap:10, marginTop:4 }}>
                <button onClick={handleSave} disabled={saving||!form.topicName.trim()||!form.chapter.trim()} style={{ flex:1, padding:'11px', background:(!form.topicName.trim()||!form.chapter.trim())?'var(--gray-200)':'var(--green)', color:(!form.topicName.trim()||!form.chapter.trim())?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:(!form.topicName.trim()||!form.chapter.trim())?'not-allowed':'pointer' }}>
                  {saving ? 'Saving…' : editTopic ? 'Update Topic' : 'Add Topic'}
                </button>
                <button onClick={() => setShowModal(false)} style={{ padding:'11px 16px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, cursor:'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
