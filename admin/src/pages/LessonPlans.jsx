import React, { useState, useEffect } from 'react'
import { collection, getDocs, query, where, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { useNavigate } from 'react-router-dom'
import { format, subDays, startOfWeek, addDays } from 'date-fns'

// CLASSES loaded via useClasses({ includeAll: true })

function weekLabel(weekStart) {
  const s = new Date(weekStart)
  const e = addDays(s, 5)
  return `${format(s,'d MMM')} – ${format(e,'d MMM yyyy')}`
}

export default function LessonPlans() {
  const { classNames: CLASSES } = useClasses({ includeAll: true })
  const { effectiveBranches } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState([])
  const [teachers, setTeachers] = useState([])
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterClass, setFilterClass] = useState('All')
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterWeek, setFilterWeek] = useState('')
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [editData, setEditData] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [plansSnap, teachersSnap, fieldsDoc] = await Promise.all([
          getDocs(query(collection(db, 'lessonPlans'), ...branchConstraints('branchCode', effectiveBranches))),
          getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))),
          getDocs(query(collection(db, 'settings'))),
        ])
        setPlans(plansSnap.docs.map(d => ({ id:d.id, ...d.data() }))
          .filter(p => p.status !== 'superseded')
          .sort((a,b) => (b.dateStr||'').localeCompare(a.dateStr||'')))
        setTeachers(teachersSnap.docs.map(d => ({ id:d.id, ...d.data() })))
        const fDoc = fieldsDoc.docs.find(d => d.id === 'lessonPlanFields')
        if (fDoc?.data()?.fields) setFields(fDoc.data().fields)
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [effectiveBranches])

  const weeks = [...new Set(plans.map(p => p.weekStart).filter(Boolean))].sort().reverse()

  const filtered = plans.filter(p =>
    (filterClass === 'All' || p.className === filterClass) &&
    (!filterTeacher || p.teacherId === filterTeacher) &&
    (!filterWeek || p.weekStart === filterWeek)
  )

  // Group by week → teacher → date
  const grouped = filtered.reduce((acc, p) => {
    const wk = p.weekStart || 'Unknown'
    if (!acc[wk]) acc[wk] = {}
    const tId = p.teacherName || p.teacherId || 'Unknown'
    if (!acc[wk][tId]) acc[wk][tId] = []
    acc[wk][tId].push(p)
    return acc
  }, {})

  async function handleDelete(planId) {
    if (!confirm('Delete this lesson plan? This cannot be undone.')) return
    try {
      await deleteDoc(doc(db, 'lessonPlans', planId))
      setPlans(prev => prev.filter(p => p.id !== planId))
      if (selectedPlan?.id === planId) setSelectedPlan(null)
    } catch(e) { console.error(e) }
  }

  async function handleSave() {
    if (!selectedPlan) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'lessonPlans', selectedPlan.id), { data: editData, adminEdited: true, adminEditedAt: new Date().toISOString() })
      setPlans(prev => prev.map(p => p.id === selectedPlan.id ? { ...p, data: editData } : p))
      setSelectedPlan(p => ({ ...p, data: editData }))
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none', boxSizing:'border-box' }

  if (selectedPlan) return (
    <div style={{ padding:'28px 36px', maxWidth:800 }}>
      <button onClick={() => { setSelectedPlan(null); setEditData({}) }} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, fontWeight:500, marginBottom:20, padding:0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Lesson Plans
      </button>

      <div style={{ background:'var(--green-dark)', borderRadius:'var(--radius-lg)', padding:'20px 24px', marginBottom:24, color:'white', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'linear-gradient(90deg, var(--gold), transparent)' }} />
        <div style={{ fontSize:16, fontWeight:600, marginBottom:6 }}>{selectedPlan.teacherName} — {selectedPlan.className} · {selectedPlan.subject}</div>
        <div style={{ fontSize:13, opacity:0.7 }}>
          {selectedPlan.dateStr} · Period {selectedPlan.period} · {selectedPlan.periodTime}
          {selectedPlan.adminEdited && <span style={{ marginLeft:10, background:'rgba(201,162,39,0.2)', padding:'2px 8px', borderRadius:8, fontSize:11, color:'var(--gold)' }}>Admin edited</span>}
        </div>
      </div>

      {saved && <div style={{ background:'var(--green)', color:'white', padding:'10px 16px', borderRadius:'var(--radius-md)', marginBottom:16, fontSize:13, fontWeight:500 }}>✓ Plan updated successfully</div>}

      <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:24 }}>
        {(fields.length > 0 ? fields : Object.keys(selectedPlan.data||{}).map(id => ({ id, label:id, type:'textarea', required:false }))).map(f => (
          <div key={f.id}>
            <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>
              {f.label}
              {f.required && <span style={{ color:'var(--crimson)', marginLeft:3 }}>*</span>}
            </label>
            {f.type === 'textarea' ? (
              <textarea value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} rows={3} style={{ ...inp, resize:'vertical' }} />
            ) : f.type === 'select' ? (
              <select value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} style={inp}>
                <option value="">Select…</option>
                {(f.options||[]).map(o => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input type="text" value={editData[f.id]||''} onChange={e => setEditData(p=>({...p,[f.id]:e.target.value}))} style={inp} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:10 }}>
        <button onClick={handleSave} disabled={saving} style={{ padding:'12px 32px', background: saving?'var(--gray-200)':'var(--green)', color: saving?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: saving?'not-allowed':'pointer', boxShadow: saving?'none':'0 2px 8px rgba(26,74,46,0.25)' }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={() => handleDelete(selectedPlan.id)} style={{ padding:'12px 20px', background:'var(--crimson-light)', color:'var(--crimson)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:'pointer' }}>
          Delete Plan
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ padding:'28px 36px', maxWidth:1100 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Lesson Plans</h1>
        <p style={{ fontSize:14, color:'var(--text-muted)' }}>All teacher-submitted lesson plans. Click any plan to view or edit.</p>
        <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:24 }}>
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          <option value="">All teachers</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
        </select>
        <select value={filterWeek} onChange={e => setFilterWeek(e.target.value)} style={{ padding:'8px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          <option value="">All weeks</option>
          {weeks.map(w => <option key={w} value={w}>{weekLabel(w)}</option>)}
        </select>
        <div style={{ marginLeft:'auto', fontSize:13, color:'var(--text-muted)', alignSelf:'center' }}>{filtered.length} plan{filtered.length!==1?'s':''}</div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:64 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px 24px', background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', color:'var(--text-muted)', fontSize:14 }}>
          No lesson plans submitted yet.
        </div>
      ) : (
        Object.entries(grouped).sort((a,b) => b[0].localeCompare(a[0])).map(([week, byTeacher]) => (
          <div key={week} style={{ marginBottom:28 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
              <span>Week of {weekLabel(week)}</span>
              <div style={{ flex:1, height:1, background:'var(--gray-100)' }} />
              <span>{Object.values(byTeacher).flat().length} plans</span>
            </div>
            {Object.entries(byTeacher).map(([teacherName, teacherPlans]) => (
              <div key={teacherName} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', marginBottom:12, overflow:'hidden' }}>
                <div style={{ padding:'12px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{teacherName}</span>
                  <span style={{ fontSize:12, color:'var(--green-mid)' }}>{teacherPlans.length} period{teacherPlans.length!==1?'s':''}</span>
                </div>
                <div style={{ padding:'8px 12px', display:'flex', flexDirection:'column', gap:6 }}>
                  {teacherPlans.sort((a,b) => (a.dateStr||'').localeCompare(b.dateStr||'')).map(plan => (
                    <div key={plan.id} onClick={() => { setSelectedPlan(plan); setEditData(plan.data||{}) }} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', borderRadius:'var(--radius-md)', background:'var(--gray-50)', cursor:'pointer', transition:'background 0.15s' }}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--green-light)'}
                      onMouseLeave={e=>e.currentTarget.style.background='var(--gray-50)'}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', gap:7, alignItems:'center', marginBottom:3, flexWrap:'wrap' }}>
                          <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{plan.dateStr} · Period {plan.period}</span>
                          <span style={{ fontSize:11, padding:'1px 7px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{plan.className}</span>
                          <span style={{ fontSize:11, padding:'1px 7px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)' }}>{plan.subject}</span>
                          {plan.adminEdited && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'rgba(201,162,39,0.15)', color:'var(--gold-dark)' }}>Edited</span>}
                        </div>
                        {plan.data?.topics && <div style={{ fontSize:12, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{plan.data.topics}</div>}
                      </div>
                        <button onClick={e => { e.stopPropagation(); handleDelete(plan.id) }} style={{ padding:'4px 10px', background:'var(--crimson-light)', color:'var(--crimson)', border:'none', borderRadius:'var(--radius-sm)', fontSize:11, fontWeight:500, cursor:'pointer', flexShrink:0 }}>Delete</button>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ flexShrink:0 }}><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
