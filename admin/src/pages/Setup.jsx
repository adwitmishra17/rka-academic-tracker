import React, { useState, useEffect } from 'react'
import { collection, getDocs, updateDoc, doc, addDoc, deleteDoc, query, arrayUnion, arrayRemove, Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraintsArray } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'
import { useClasses, GRADE_BAND_LABELS, DEFAULT_SUBJECTS_BY_BAND, inferGradeBand } from '../hooks/useClasses'

const OPTIONAL_SUBJECTS = ['Hindi', 'Physical Education', 'Computers', 'Artificial Intelligence']

// Bands that allow optional subjects (currently only senior secondary uses optionalSubjects field for elective selection)
function classNeedsOptional(className, band) {
  const b = band || inferGradeBand(className)
  return b === 'senior-secondary'
}

const BAND_OPTIONS = [
  { value: 'pre-primary',     label: 'Pre-Primary (Nursery, LKG, UKG)' },
  { value: 'primary',         label: 'Primary (Class 1–5)' },
  { value: 'middle',          label: 'Middle (Class 6–8)' },
  { value: 'secondary',       label: 'Secondary (Class 9–10)' },
  { value: 'senior-secondary',label: 'Senior Secondary (Class 11–12)' },
]

export default function Setup() {
  const navigate = useNavigate()
  const { effectiveBranches, currentBranch, allowedBranches, canSwitchBranches } = useAuth()
  const { classes, refresh } = useClasses()
  const [teachers, setTeachers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ className:'', gradeBand:'middle' })
  const [formBranch, setFormBranch] = useState(() => currentBranch || allowedBranches[0])
  useEffect(() => {
    if (currentBranch) setFormBranch(currentBranch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranch])
  const showBranchPicker = !currentBranch && canSwitchBranches && allowedBranches.length > 1
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [editingClass, setEditingClass] = useState(null)
  const [editForm, setEditForm] = useState({ className:'', gradeBand:'' })

  useEffect(() => {
    getDocs(query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches)))
      .then(snap => setTeachers(snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(t => t.isActive !== false).sort((a,b)=>a.fullName.localeCompare(b.fullName))))
      .catch(()=>{})
  }, [effectiveBranches])

  // One-time backfill: ensure every class doc has gradeBand. Safe to run multiple times.
  useEffect(() => {
    async function backfill() {
      for (const c of classes) {
        if (!c.gradeBand) {
          try {
            await updateDoc(doc(db, 'classes', c.id), { gradeBand: inferGradeBand(c.className) })
          } catch (_) {}
        }
      }
    }
    if (classes.length > 0) backfill()
  }, [classes.length])

  async function toggleOptional(classDoc, subject) {
    const has = (classDoc.optionalSubjects || []).includes(subject)
    await updateDoc(doc(db, 'classes', classDoc.id), {
      optionalSubjects: has ? arrayRemove(subject) : arrayUnion(subject)
    })
    refresh()
  }

  async function handleCreate(e) {
    e?.preventDefault?.()
    setCreateError('')
    const name = createForm.className.trim()
    if (!name) { setCreateError('Class name is required'); return }
    if (!formBranch) { setCreateError('Please select a branch'); return }
    // Branch-scoped duplicate check: Class 9 in MAIN does not conflict with Class 9 in CITY
    if (classes.some(c => (c.className || '').toLowerCase() === name.toLowerCase() && c.branchCode === formBranch)) {
      setCreateError(`A class with this name already exists in ${branchLabel(formBranch)}`)
      return
    }
    setCreating(true)
    try {
      await addDoc(collection(db, 'classes'), {
        className: name,
        gradeBand: createForm.gradeBand,
        // classTeacherId intentionally NOT set here — class teacher
        // is managed via teacher.classTeacherOf in TeacherProfile.
        optionalSubjects: [],
        isActive: true,
        branchCode: formBranch,
        createdAt: Timestamp.now(),
      })
      setShowCreate(false)
      setCreateForm({ className:'', gradeBand:'middle' })
      refresh()
    } catch(err) {
      setCreateError('Failed to create class: ' + (err.message || 'unknown'))
    }
    setCreating(false)
  }

  async function handleSaveEdit() {
    if (!editingClass) return
    try {
      await updateDoc(doc(db, 'classes', editingClass.id), {
        gradeBand: editForm.gradeBand,
        // classTeacherId intentionally NOT updated here — managed elsewhere.
      })
      setEditingClass(null)
      refresh()
    } catch(err) { console.error(err) }
  }

  async function handleDeleteClass(c) {
    if (!confirm(`Delete "${c.className}"? Students enrolled in this class will need to be reassigned. This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'classes', c.id))
      refresh()
    } catch(err) { console.error(err); alert('Could not delete: ' + (err.message || '')) }
  }

  // Group classes by band
  const byBand = {}
  for (const c of classes) {
    const b = c.gradeBand || inferGradeBand(c.className)
    if (!byBand[b]) byBand[b] = []
    byBand[b].push(c)
  }

  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:28 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4, flexWrap:'wrap', gap:10 }}>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)' }}>Setup</h1>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => setShowCreate(true)} style={{ padding:'9px 18px', background:'var(--gold)', color:'#1a2e10', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:7, boxShadow:'0 2px 8px rgba(201,162,39,0.3)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Class
            </button>
            <button onClick={() => navigate('/teacher-management')} style={{ padding:'9px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Teacher
            </button>
          </div>
        </div>
        <p style={{ fontSize:14, color:'var(--text-muted)' }}>Manage classes, class teachers, and optional subjects. Teacher-class assignments are managed via the Timetable.</p>
        <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {/* Info banner */}
      <div style={{ background:'var(--green-light)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-lg)', padding:'14px 18px', marginBottom:24, display:'flex', alignItems:'center', gap:14 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.8" style={{ flexShrink:0 }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--green-dark)' }}>Teacher assignments live in the Timetable</div>
          <div style={{ fontSize:12, color:'var(--green-mid)' }}>Add each teacher's periods there — the system infers which teacher teaches which subject in which class. No separate assignment needed.</div>
        </div>
        <button onClick={() => navigate('/timetable')} style={{ padding:'8px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
          Go to Timetable →
        </button>
      </div>

      {/* Classes by grade band */}
      <div style={{ marginBottom:32 }}>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--text)', marginBottom:4 }}>Classes</h2>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:16 }}>{classes.length} class{classes.length !== 1 ? 'es' : ''} configured</p>
        {Object.entries(BAND_OPTIONS).map(([_, band]) => null) /* placeholder */}
        {BAND_OPTIONS.map(band => {
          const classesInBand = byBand[band.value] || []
          if (classesInBand.length === 0) return null
          return (
            <div key={band.value} style={{ marginBottom:18 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>{band.label}</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12 }}>
                {classesInBand.map(c => {
                  // Read class teacher from the new source of truth:
                  // teachers.classTeacherOf matching this class's name+branch.
                  // Falls back to legacy classes.classTeacherId for any pre-migration data.
                  const ct = teachers.find(t =>
                    t.classTeacherOf === c.className &&
                    (Array.isArray(t.branchCodes) ? t.branchCodes.includes(c.branchCode) : false)
                  ) || teachers.find(t => t.id === c.classTeacherId)
                  return (
                    <div key={c.id} style={{ background:'white', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-100)', padding:'14px 16px', display:'flex', flexDirection:'column', gap:8 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                          <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--green-dark)' }}>{c.className}</div>
                          {/* Branch chip — only useful when viewing across branches; otherwise the global switcher already constrains the list */}
                          {!currentBranch && c.branchCode && (
                            <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background: c.branchCode === 'MAIN' ? 'var(--green-light)' : 'var(--gold-light)', color: c.branchCode === 'MAIN' ? 'var(--green)' : 'var(--gold-dark)', fontWeight:500, whiteSpace:'nowrap' }}>{branchLabel(c.branchCode)}</span>
                          )}
                        </div>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={() => { setEditingClass(c); setEditForm({ className: c.className, gradeBand: c.gradeBand || inferGradeBand(c.className) }) }}
                                  style={{ padding:'4px 9px', background:'var(--gray-100)', color:'var(--text-muted)', border:'none', borderRadius:'var(--radius-sm)', fontSize:11, cursor:'pointer' }}>Edit</button>
                          <button onClick={() => handleDeleteClass(c)} style={{ padding:'4px 9px', background:'none', color:'var(--crimson)', border:'1px solid var(--crimson-light)', borderRadius:'var(--radius-sm)', fontSize:11, cursor:'pointer' }}>Delete</button>
                        </div>
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                        Class teacher: <span style={{ color: ct ? 'var(--green-dark)' : 'var(--gray-400)', fontWeight: ct ? 500 : 400 }}>
                          {ct ? ct.fullName : 'Not assigned'}
                        </span>
                      </div>
                      {(c.optionalSubjects || []).length > 0 && (
                        <div style={{ fontSize:10.5, color:'var(--text-muted)' }}>
                          Optional subjects: <span style={{ color:'var(--green-dark)', fontWeight:500 }}>{(c.optionalSubjects||[]).join(', ')}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {classes.length === 0 && (
          <div style={{ background:'white', borderRadius:'var(--radius-md)', border:'1px dashed var(--gray-200)', padding:'30px 20px', textAlign:'center' }}>
            <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:10 }}>No classes set up yet</p>
            <button onClick={() => setShowCreate(true)} style={{ padding:'9px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:12, fontWeight:600, cursor:'pointer' }}>+ Add your first class</button>
          </div>
        )}
      </div>

      {/* Optional subjects per class — only show senior-secondary classes */}
      {classes.some(c => classNeedsOptional(c.className, c.gradeBand)) && (
        <div style={{ marginBottom:16 }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--text)', marginBottom:4 }}>Optional Subjects (Senior Secondary)</h2>
          <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:20 }}>Shown to Class 11–12 students during admissions for elective selection. Independent of the timetable.</p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>
            {classes.filter(c => classNeedsOptional(c.className, c.gradeBand)).map(c => {
              const enabled = c.optionalSubjects || []
              return (
                <div key={c.id} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                  <div style={{ padding:'12px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)' }}>
                    <h3 style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{c.className}</h3>
                  </div>
                  <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:8 }}>
                    {OPTIONAL_SUBJECTS.map(subject => {
                      const on = enabled.includes(subject)
                      return (
                        <div key={subject} onClick={() => toggleOptional(c, subject)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderRadius:'var(--radius-sm)', border:`1px solid ${on ? 'var(--green-muted)' : 'var(--gray-100)'}`, background: on ? 'var(--green-light)' : 'var(--gray-50)', cursor: 'pointer' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <div style={{ width:18, height:18, borderRadius:4, border:`1.5px solid ${on ? 'var(--green)' : 'var(--gray-300)'}`, background: on ? 'var(--green)' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                              {on && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                            </div>
                            <span style={{ fontSize:12.5, fontWeight: on ? 500 : 400, color: on ? 'var(--green-dark)' : 'var(--text)' }}>{subject}</span>
                          </div>
                          <span style={{ fontSize:10, padding:'2px 7px', borderRadius:8, background: on ? 'var(--green)' : 'var(--gray-200)', color: on ? 'white' : 'var(--gray-400)', fontWeight:500 }}>
                            {on ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Create class modal */}
      {showCreate && (
        <Modal title="Add a class" onClose={() => { setShowCreate(false); setCreateError('') }}>
          <form onSubmit={handleCreate} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {showBranchPicker && (
              <FormRow label="Branch" required>
                <div style={{ display:'flex', gap:14, padding:'2px 0' }}>
                  {allowedBranches.map(b => (
                    <label key={b} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13 }}>
                      <input type="radio" name="setupBranch" checked={formBranch === b} onChange={() => setFormBranch(b)} />
                      <span>{branchLabel(b)}</span>
                    </label>
                  ))}
                </div>
              </FormRow>
            )}
            <FormRow label="Class name" required>
              <input value={createForm.className} onChange={e => setCreateForm(f => ({ ...f, className: e.target.value }))}
                     placeholder="e.g. Class 6, Class 7, Nursery, LKG"
                     style={inputStyle()} autoFocus />
            </FormRow>
            <FormRow label="Grade band" required>
              <select value={createForm.gradeBand} onChange={e => setCreateForm(f => ({ ...f, gradeBand: e.target.value }))} style={inputStyle()}>
                {BAND_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
              <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:5 }}>
                Default subjects for this band: <strong>{(DEFAULT_SUBJECTS_BY_BAND[createForm.gradeBand] || []).slice(0,5).join(', ')}{(DEFAULT_SUBJECTS_BY_BAND[createForm.gradeBand] || []).length > 5 ? '…' : ''}</strong>
              </p>
            </FormRow>
            <FormRow label="Class teacher">
              <div style={{ fontSize:13, color:'var(--text-muted)', padding:'10px 12px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)', border:'1px solid var(--gray-100)' }}>
                Class teachers are assigned from each teacher's profile page, not here. After creating this class, open the relevant teacher's profile and pick this class in their "Class Teacher Of" card.
              </div>
            </FormRow>
            {createError && <div style={{ fontSize:12, color:'var(--crimson)', background:'var(--crimson-light)', padding:'8px 12px', borderRadius:'var(--radius-sm)' }}>{createError}</div>}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:6 }}>
              <button type="button" onClick={() => { setShowCreate(false); setCreateError('') }} style={{ padding:'9px 16px', background:'white', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, cursor:'pointer' }}>Cancel</button>
              <button type="submit" disabled={creating} style={{ padding:'9px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:creating?'wait':'pointer' }}>{creating ? 'Creating…' : 'Create class'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit class modal */}
      {editingClass && (
        <Modal title={`Edit ${editingClass.className}`} onClose={() => setEditingClass(null)}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <FormRow label="Grade band">
              <select value={editForm.gradeBand} onChange={e => setEditForm(f => ({ ...f, gradeBand: e.target.value }))} style={inputStyle()}>
                {BAND_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </FormRow>
            <FormRow label="Class teacher">
              <div style={{ fontSize:13, color:'var(--text-muted)', padding:'10px 12px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)', border:'1px solid var(--gray-100)' }}>
                Managed from the teacher's profile page, not here.
              </div>
            </FormRow>
            <p style={{ fontSize:11, color:'var(--text-muted)' }}>Class name cannot be changed (would orphan student/timetable records). Delete and recreate if needed.</p>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:6 }}>
              <button onClick={() => setEditingClass(null)} style={{ padding:'9px 16px', background:'white', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, cursor:'pointer' }}>Cancel</button>
              <button onClick={handleSaveEdit} style={{ padding:'9px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:600, cursor:'pointer' }}>Save</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function inputStyle() {
  return { width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'white', outline:'none' }
}

function FormRow({ label, required, children }) {
  return (
    <div>
      <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', display:'block', marginBottom:5 }}>
        {label} {required && <span style={{ color:'var(--crimson)' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(15,23,32,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:20 }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background:'white', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:480, boxShadow:'var(--shadow-lg)' }}>
        <div style={{ padding:'18px 22px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h3 style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:600, color:'var(--green-dark)' }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, color:'var(--text-muted)', cursor:'pointer', padding:0 }}>×</button>
        </div>
        <div style={{ padding:'20px 22px' }}>{children}</div>
      </div>
    </div>
  )
}
