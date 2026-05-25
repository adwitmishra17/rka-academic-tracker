import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const DEFAULT_FIELDS = [
  { id:'topic', label:'Topic / Chapter', type:'text', required:true, placeholder:'e.g. Chemical Reactions - Combination and Decomposition' },
  { id:'objectives', label:'Learning Objectives', type:'textarea', required:true, placeholder:'Students will be able to…' },
  { id:'method', label:'Teaching Method', type:'select', required:false, options:['Lecture','Discussion','Demonstration','Activity','Flipped Classroom','Group Work','Problem Solving'], placeholder:'' },
  { id:'resources', label:'Resources & Materials', type:'text', required:false, placeholder:'e.g. NCERT textbook p.45, projector, lab equipment' },
  { id:'activity', label:'Classroom Activity', type:'textarea', required:false, placeholder:'Describe any activity, experiment or group task' },
  { id:'homework', label:'Homework / Assignment', type:'text', required:false, placeholder:'e.g. Exercise 3.1 Q1-5' },
  { id:'assessment', label:'Assessment Plan', type:'text', required:false, placeholder:'e.g. Quick quiz, oral questions' },
  { id:'remarks', label:'Additional Remarks', type:'textarea', required:false, placeholder:'Any other notes for this lesson' },
]

const FIELD_TYPES = ['text','textarea','select']

export default function LessonPlanFields() {
  const [fields, setFields] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newField, setNewField] = useState({ label:'', type:'text', required:false, placeholder:'', options:'' })

  const inp = { width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

  useEffect(() => {
    getDoc(doc(db, 'settings', 'lessonPlanFields')).then(d => {
      if (d.exists() && d.data().fields?.length) setFields(d.data().fields)
      else setFields(DEFAULT_FIELDS)
      setLoading(false)
    }).catch(() => { setFields(DEFAULT_FIELDS); setLoading(false) })
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'lessonPlanFields'), { fields, updatedAt: Timestamp.now() })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function moveField(idx, dir) {
    const f = [...fields]
    const swap = idx + dir
    if (swap < 0 || swap >= f.length) return
    ;[f[idx], f[swap]] = [f[swap], f[idx]]
    setFields(f)
  }

  function removeField(idx) {
    if (!confirm('Remove this field?')) return
    setFields(f => f.filter((_,i) => i !== idx))
  }

  function updateField(idx, key, value) {
    setFields(prev => prev.map((f,i) => i === idx ? { ...f, [key]: value } : f))
  }

  function addField() {
    if (!newField.label.trim()) return
    const options = newField.type === 'select' ? newField.options.split(',').map(s=>s.trim()).filter(Boolean) : []
    setFields(prev => [...prev, { id: Date.now().toString(), ...newField, options, placeholder: newField.placeholder || '' }])
    setNewField({ label:'', type:'text', required:false, placeholder:'', options:'' })
    setShowAdd(false)
  }

  function resetToDefault() {
    if (!confirm('Reset all fields to default? This cannot be undone.')) return
    setFields(DEFAULT_FIELDS)
  }

  return (
    <div style={{ padding:'24px 28px', maxWidth:800 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Lesson Plan Fields</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Configure the fields teachers fill when submitting a weekly lesson plan</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
        <>
          <div style={{ background:'var(--green-light)', borderRadius:'var(--radius-md)', padding:'12px 16px', marginBottom:20, fontSize:13, color:'var(--green-dark)', lineHeight:1.6 }}>
            These fields appear in the teacher app when a teacher submits a weekly lesson plan. Drag to reorder using the arrows. Required fields must be filled before submission.
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
            {fields.map((f, idx) => (
              <div key={f.id||idx} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                {editingId === (f.id||idx) ? (
                  <div style={{ padding:'16px' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:10, marginBottom:10 }}>
                      <div>
                        <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Field label</label>
                        <input value={f.label} onChange={e => updateField(idx,'label',e.target.value)} style={inp} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Type</label>
                        <select value={f.type} onChange={e => updateField(idx,'type',e.target.value)} style={inp}>
                          {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                        <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', marginBottom:3 }}>
                          <input type="checkbox" checked={f.required||false} onChange={e => updateField(idx,'required',e.target.checked)} style={{ accentColor:'var(--green)' }} />
                          <span style={{ fontSize:12, color:'var(--text-muted)' }}>Required</span>
                        </label>
                      </div>
                    </div>
                    <div style={{ marginBottom:10 }}>
                      <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Placeholder text</label>
                      <input value={f.placeholder||''} onChange={e => updateField(idx,'placeholder',e.target.value)} style={inp} />
                    </div>
                    {f.type === 'select' && (
                      <div style={{ marginBottom:10 }}>
                        <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Options (comma-separated)</label>
                        <input value={(f.options||[]).join(', ')} onChange={e => updateField(idx,'options',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} style={inp} />
                      </div>
                    )}
                    <button onClick={() => setEditingId(null)} style={{ padding:'7px 16px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500, cursor:'pointer' }}>Done</button>
                  </div>
                ) : (
                  <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                      <button onClick={() => moveField(idx,-1)} disabled={idx===0} style={{ background:'none', border:'none', cursor: idx===0?'not-allowed':'pointer', color: idx===0?'var(--gray-200)':'var(--gray-400)', lineHeight:1, padding:'1px 4px', fontSize:12 }}>▲</button>
                      <button onClick={() => moveField(idx,1)} disabled={idx===fields.length-1} style={{ background:'none', border:'none', cursor: idx===fields.length-1?'not-allowed':'pointer', color: idx===fields.length-1?'var(--gray-200)':'var(--gray-400)', lineHeight:1, padding:'1px 4px', fontSize:12 }}>▼</button>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{f.label}</span>
                        {f.required && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'var(--crimson-light)', color:'var(--crimson)', fontWeight:500 }}>Required</span>}
                        <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'var(--gray-100)', color:'var(--text-muted)' }}>{f.type}</span>
                      </div>
                      {f.placeholder && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>Placeholder: {f.placeholder}</div>}
                      {f.type==='select' && f.options?.length > 0 && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>Options: {f.options.join(', ')}</div>}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={() => setEditingId(f.id||idx)} style={{ fontSize:12, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Edit</button>
                      <button onClick={() => removeField(idx)} style={{ fontSize:12, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer' }}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add new field */}
          {showAdd ? (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--green-muted)', padding:'18px', marginBottom:16 }}>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:14 }}>New field</h3>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:10, marginBottom:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Label <span style={{ color:'var(--crimson)' }}>*</span></label>
                  <input value={newField.label} onChange={e => setNewField(p=>({...p,label:e.target.value}))} placeholder="e.g. Learning Objectives" style={inp} />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Type</label>
                  <select value={newField.type} onChange={e => setNewField(p=>({...p,type:e.target.value}))} style={inp}>
                    {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                    <input type="checkbox" checked={newField.required} onChange={e => setNewField(p=>({...p,required:e.target.checked}))} style={{ accentColor:'var(--green)' }} />
                    <span style={{ fontSize:12, color:'var(--text-muted)' }}>Required</span>
                  </label>
                </div>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Placeholder</label>
                <input value={newField.placeholder} onChange={e => setNewField(p=>({...p,placeholder:e.target.value}))} style={inp} />
              </div>
              {newField.type === 'select' && (
                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:3 }}>Options (comma-separated)</label>
                  <input value={newField.options} onChange={e => setNewField(p=>({...p,options:e.target.value}))} placeholder="Option 1, Option 2, Option 3" style={inp} />
                </div>
              )}
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={addField} disabled={!newField.label.trim()} style={{ padding:'8px 20px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:'pointer' }}>Add Field</button>
                <button onClick={() => setShowAdd(false)} style={{ padding:'8px 16px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, cursor:'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)} style={{ width:'100%', padding:'11px', background:'var(--white)', color:'var(--green)', border:'1px dashed var(--green-muted)', borderRadius:'var(--radius-lg)', fontSize:13, fontWeight:500, cursor:'pointer', marginBottom:16 }}>
              + Add Field
            </button>
          )}

          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            {saved && <span style={{ fontSize:13, color:'var(--green)', fontWeight:500 }}>✓ Saved successfully</span>}
            <button onClick={resetToDefault} style={{ padding:'10px 16px', background:'var(--white)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, cursor:'pointer' }}>Reset to default</button>
            <button onClick={handleSave} disabled={saving} style={{ flex:1, padding:'11px', background: saving?'var(--gray-200)':'var(--green)', color: saving?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: saving?'not-allowed':'pointer', boxShadow: saving?'none':'0 2px 8px rgba(26,74,46,0.25)' }}>
              {saving ? 'Saving…' : 'Save Fields'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
