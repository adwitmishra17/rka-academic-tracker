import React, { useState, useEffect } from 'react'
import { collection, getDocs, updateDoc, doc, getDoc, query, Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints, branchConstraintsArray } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'

// =============================================================================
// SSoT migration (Phase A) — what changed in this file:
//
// HRMS is now the single source of truth for teacher identity. Identity fields
// (name, school email, personal email, phone, branchCodes, isActive) are
// synced from HRMS by the `sync-employee-to-firestore` Edge Function. The
// tracker UI no longer creates, deactivates, or edits identity — only
// academic fields (subjects, qualification, joining date) remain editable.
//
// Removed from this page:
//   - "Add Teacher" button + add modal path
//   - "Import CSV" button + entire CSV import flow
//   - "Sanitize emails" maintenance button (sync controls input now)
//   - "Deactivate / Reactivate" toggle on each card
//   - Branch picker in the edit modal
//
// Server-side, firestore.rules also enforces these constraints — even if a
// client bypasses the UI, identity-field writes are rejected.
// =============================================================================

const HRMS_EMPLOYEES_URL = 'https://hrms.rkacademyballia.in/employees'

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:20 }}>
      <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto', boxShadow:'var(--shadow-lg)', overflowX:'hidden' }}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:600, color:'var(--green-dark)' }}>{title}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:20, lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'24px' }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:5 }}>
        {label} {required && <span style={{ color:'var(--crimson)' }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{hint}</p>}
    </div>
  )
}

const inputStyle = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:14, fontFamily:'var(--font-body)', color:'var(--text)', outline:'none', background:'var(--white)' }
const lockedInputStyle = { ...inputStyle, background:'var(--gray-50)', color:'var(--text-muted)', cursor:'not-allowed' }

function getTeacherClasses(teacherId, timetable) {
  const classNames = new Set()
  timetable.filter(s => s.teacherId === teacherId).forEach(s => {
    if (Array.isArray(s.classNames) && s.classNames.length) s.classNames.forEach(c => c && classNames.add(c.trim()))
    else if (s.className) s.className.split('+').map(x => x.trim()).filter(Boolean).forEach(c => classNames.add(c))
  })
  return [...classNames].sort()
}

export default function TeacherManagement() {
  const navigate = useNavigate()
  const { effectiveBranches, currentBranch } = useAuth()
  const [teachers, setTeachers] = useState([])
  const [timetable, setTimetable] = useState([])
  const [availableSubjects, setAvailableSubjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  // Form holds editable academic fields + read-only display values for identity.
  // Identity fields here exist for display only; handleSave never sends them.
  const [form, setForm] = useState({
    fullName:'', schoolEmail:'', personalEmail:'', phone:'',
    qualification:'', joiningDate:'',
    isActive:true, subjectsTaught:[], branchCodes:[],
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'settings', 'subjects'))
      .then(d => setAvailableSubjects(d.exists() && d.data().list?.length ? d.data().list : []))
      .catch(() => {})
  }, [])

  async function loadTimetable() {
    try {
      const q = query(collection(db, 'timetable'), ...branchConstraints('branchCode', effectiveBranches))
      const snap = await getDocs(q)
      setTimetable(snap.docs.map(d => d.data()))
    }
    catch(e) {}
  }

  async function loadTeachers() {
    const q = query(collection(db, 'teachers'), ...branchConstraintsArray('branchCodes', effectiveBranches))
    const snap = await getDocs(q)
    setTeachers(snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => a.fullName.localeCompare(b.fullName)))
    setLoading(false)
  }

  useEffect(() => { loadTeachers(); loadTimetable() }, [effectiveBranches])

  function openEdit(t) {
    setEditing(t)
    setForm({
      fullName: t.fullName || '',
      schoolEmail: t.email || '',
      personalEmail: t.personalEmail || '',
      phone: t.phone || '',
      qualification: t.qualification || '',
      joiningDate: t.joiningDate || '',
      isActive: t.isActive !== false,
      subjectsTaught: t.subjectsTaught || [],
      branchCodes: (t.branchCodes && t.branchCodes.length) ? t.branchCodes : ['MAIN'],
    })
    setError(''); setSuccess('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!editing) {
      // Defensive — there is no "create" path on this page anymore.
      setError('Adding teachers happens in HRMS. Open the link above.')
      return
    }
    setSaving(true); setError('')
    // Whitelist of fields the tracker UI is allowed to write. Anything else
    // (name, emails, phone, branchCodes, isActive) is owned by HRMS and is
    // also blocked at the firestore.rules layer.
    const data = {
      qualification: form.qualification.trim(),
      joiningDate: form.joiningDate,
      subjectsTaught: form.subjectsTaught || [],
      classesAssigned: editing?.classesAssigned || [],
      updatedAt: Timestamp.now(),
    }
    try {
      await updateDoc(doc(db, 'teachers', editing.id), data)
      setSuccess('Teacher updated successfully.')
      await loadTeachers()
      setTimeout(() => { setShowModal(false); setSuccess('') }, 1500)
    } catch(e) {
      // Most likely cause: firestore.rules rejected the update because a
      // locked field changed. Surface a helpful message rather than the raw error.
      const msg = (e?.message || '').toLowerCase()
      if (msg.includes('permission') || msg.includes('insufficient')) {
        setError('Update blocked. Identity fields (name, email, phone, branch, status) are managed in HRMS.')
      } else {
        setError('Failed to save. Please try again.')
      }
    }
    setSaving(false)
  }

  const filtered = teachers.filter(t =>
    t.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    t.email?.toLowerCase().includes(search.toLowerCase()) ||
    (t.subjectsTaught || []).join(' ').toLowerCase().includes(search.toLowerCase())
  )

  const active = filtered.filter(t => t.isActive !== false)
  const inactive = filtered.filter(t => t.isActive === false)

  return (
    <div style={{ padding:'32px 36px', maxWidth:1100 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom:20, display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Teacher Management</h1>
          <p style={{ fontSize:14, color:'var(--text-muted)' }}>View teachers, assign subjects and classes</p>
          <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
        </div>
        <a
          href={HRMS_EMPLOYEES_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            padding:'11px 18px', background:'var(--green)', color:'white',
            border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500,
            cursor:'pointer', display:'flex', alignItems:'center', gap:8,
            textDecoration:'none', boxShadow:'0 2px 8px rgba(26,74,46,0.25)', flexShrink:0,
          }}
        >
          Manage in HRMS
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>

      {/* SSoT banner */}
      <div style={{
        background:'var(--gold-light)',
        border:'1px solid rgba(201,162,39,0.35)',
        borderRadius:'var(--radius-md)',
        padding:'12px 16px',
        marginBottom:24,
        display:'flex',
        alignItems:'flex-start',
        gap:10,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2" style={{ flexShrink:0, marginTop:1 }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.5 }}>
          Teacher identity (name, email, phone, branch, active status) is managed in <strong>HRMS</strong>. Add, remove, or change those fields there — updates appear here within seconds. Subjects and class assignments still happen on this page.
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:14, marginBottom:24 }}>
        {[
          { label:'Total teachers', value: teachers.length, color:'var(--green)' },
          { label:'Active', value: teachers.filter(t => t.isActive !== false).length, color:'var(--green-mid)' },
          { label:'Assigned to classes', value: teachers.filter(t => getTeacherClasses(t.id, timetable).length > 0).length, color:'var(--gold-dark)' },
        ].map(s => (
          <div key={s.label} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'18px 20px', border:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:s.color, flexShrink:0 }} />
            <div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--text)', lineHeight:1 }}>{s.value}</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:3 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position:'relative', marginBottom:20 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search teachers by name, email or subject…" style={{ ...inputStyle, paddingLeft:38 }} />
      </div>

      {/* Teacher list */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
        <>
          {/* Active teachers */}
          {active.length > 0 && (
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Active teachers ({active.length})</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:12 }}>
                {active.map(t => <TeacherCard key={t.id} teacher={t} timetable={timetable} currentBranch={currentBranch} onEdit={() => openEdit(t)} onView={() => navigate(`/teacher-management/${t.id}`)} />)}
              </div>
            </div>
          )}

          {/* Inactive teachers */}
          {inactive.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Inactive ({inactive.length})</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:12 }}>
                {inactive.map(t => <TeacherCard key={t.id} teacher={t} timetable={timetable} currentBranch={currentBranch} onEdit={() => openEdit(t)} onView={() => navigate(`/teacher-management/${t.id}`)} />)}
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <div style={{ textAlign:'center', padding:48, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
              <p style={{ color:'var(--text-muted)', fontSize:14, marginBottom:10 }}>No teachers found.</p>
              <a href={HRMS_EMPLOYEES_URL} target="_blank" rel="noreferrer" style={{ fontSize:13, color:'var(--green)', textDecoration:'underline' }}>Add teachers in HRMS →</a>
            </div>
          )}
        </>
      )}

      {/* Edit Modal */}
      {showModal && (
        <Modal title="Edit Teacher" onClose={() => setShowModal(false)}>
          {/* Identity section — read-only, sourced from HRMS */}
          <div style={{
            background:'var(--gray-50)',
            borderRadius:'var(--radius-md)',
            padding:'14px 16px',
            marginBottom:18,
            border:'1px solid var(--gray-100)',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
              <span style={{ fontSize:10.5, fontWeight:600, color:'var(--gold-dark)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                Identity · Managed in HRMS
              </span>
              <a href={HRMS_EMPLOYEES_URL} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--green)', textDecoration:'none', marginLeft:'auto' }}>
                Edit in HRMS ↗
              </a>
            </div>

            <Field label="Full name">
              <input value={form.fullName} disabled style={lockedInputStyle} />
            </Field>
            <Field label="School email">
              <input value={form.schoolEmail} disabled style={lockedInputStyle} />
            </Field>
            <Field label="Personal email (login)">
              <input value={form.personalEmail || ''} disabled style={lockedInputStyle} placeholder="—" />
            </Field>
            <Field label="Phone">
              <input value={form.phone || ''} disabled style={lockedInputStyle} placeholder="—" />
            </Field>
            <Field label="Teaches at">
              <input
                value={(form.branchCodes || []).map(branchLabel).join(', ') || '—'}
                disabled
                style={lockedInputStyle}
              />
            </Field>
            <Field label="Status">
              <input
                value={form.isActive ? 'Active' : 'Inactive'}
                disabled
                style={{ ...lockedInputStyle, color: form.isActive ? 'var(--green)' : 'var(--crimson)', fontWeight:500 }}
              />
            </Field>
          </div>

          {/* Editable academic + employment info */}
          <Field label="Qualification">
            <input value={form.qualification} onChange={e => setForm(p => ({...p, qualification: e.target.value}))} placeholder="e.g. M.Sc Physics, B.Ed" style={inputStyle} />
          </Field>

          <Field label="Joining date">
            <input type="date" value={form.joiningDate} onChange={e => setForm(p => ({...p, joiningDate: e.target.value}))} style={inputStyle} />
          </Field>

          <Field label="Subjects taught">
            {availableSubjects.length === 0 ? (
              <p style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>No subjects defined. Add subjects in Subject Settings first.</p>
            ) : (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {availableSubjects.map(s => {
                  const selected = (form.subjectsTaught||[]).includes(s)
                  return (
                    <button key={s} type="button" onClick={() => setForm(p => ({...p, subjectsTaught: selected ? p.subjectsTaught.filter(x=>x!==s) : [...(p.subjectsTaught||[]),s]}))} style={{ padding:'5px 12px', borderRadius:16, border:'1px solid', borderColor: selected ? 'var(--green)' : 'var(--gray-200)', background: selected ? 'var(--green)' : 'var(--white)', color: selected ? 'white' : 'var(--text-muted)', fontSize:12, fontWeight: selected ? 500 : 400, cursor:'pointer', transition:'all 0.12s' }}>
                      {s}
                    </button>
                  )
                })}
              </div>
            )}
          </Field>

          {error && <p style={{ fontSize:13, color:'var(--crimson)', background:'var(--crimson-light)', padding:'8px 12px', borderRadius:'var(--radius-sm)', marginBottom:12 }}>{error}</p>}
          {success && <p style={{ fontSize:13, color:'var(--green)', background:'var(--green-light)', padding:'8px 12px', borderRadius:'var(--radius-sm)', marginBottom:12 }}>✓ {success}</p>}

          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button onClick={handleSave} disabled={saving} style={{ flex:1, padding:'12px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Update Teacher'}
            </button>
            <button onClick={() => setShowModal(false)} style={{ padding:'12px 20px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:14, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TeacherCard({ teacher: t, timetable, currentBranch, onEdit, onView }) {
  const initials = t.fullName?.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || '?'
  const isActive = t.isActive !== false
  const teacherClasses = getTeacherClasses(t.id, timetable)
  const assigned = teacherClasses.length > 0
  const teacherBranches = t.branchCodes || []
  const showBranchChips = !currentBranch && teacherBranches.length > 0

  return (
    <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden', opacity: isActive ? 1 : 0.65 }}>
      <div style={{ height:3, background: isActive ? 'var(--green)' : 'var(--gray-200)' }} />
      <div style={{ padding:'16px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:12 }}>
          <div style={{ width:42, height:42, borderRadius:'50%', background: isActive ? 'var(--green-light)' : 'var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, border: isActive ? '2px solid var(--green-muted)' : '2px solid var(--gray-200)' }}>
            <span style={{ fontSize:14, fontWeight:700, color: isActive ? 'var(--green)' : 'var(--gray-400)' }}>{initials}</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:2 }}>
              <span style={{ fontSize:14, fontWeight:600, color:'var(--text)' }}>{t.fullName}</span>
              {showBranchChips && teacherBranches.map(b => (
                <span key={b} style={{ fontSize:9.5, padding:'1px 6px', borderRadius:6, background: b === 'MAIN' ? 'var(--green-light)' : 'var(--gold-light)', color: b === 'MAIN' ? 'var(--green)' : 'var(--gold-dark)', fontWeight:500, whiteSpace:'nowrap' }}>{b === 'MAIN' ? 'Main' : 'City'}</span>
              ))}
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.email}</div>
            {t.phone && <div style={{ fontSize:12, color:'var(--text-muted)' }}>{t.phone}</div>}
          </div>
          <span style={{ fontSize:10, padding:'3px 8px', borderRadius:10, background: isActive ? 'var(--green-light)' : 'var(--gray-100)', color: isActive ? 'var(--green)' : 'var(--gray-400)', fontWeight:500, flexShrink:0 }}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Subjects and classes */}
        <div style={{ marginBottom:12, minHeight:28 }}>
          {(t.subjectsTaught || []).length > 0 ? (
            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
              {(t.subjectsTaught || []).map(s => (
                <span key={s} style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)', fontWeight:500 }}>{s}</span>
              ))}
            </div>
          ) : (
            <span style={{ fontSize:12, color:'var(--gray-400)', fontStyle:'italic' }}>No subjects assigned yet</span>
          )}
        </div>

        {teacherClasses.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:12 }}>
            {teacherClasses.map(c => (
              <span key={c} style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{c}</span>
            ))}
          </div>
        )}

        {!assigned && isActive && (
          <div style={{ fontSize:11, color:'var(--gold-dark)', background:'var(--gold-light)', padding:'5px 10px', borderRadius:'var(--radius-sm)', marginBottom:12, display:'flex', alignItems:'center', gap:5 }}>
            <span>⚠</span> Not assigned to any class yet
          </div>
        )}

        {/* Active/Inactive toggle removed — isActive is HRMS-owned. */}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onView} style={{ flex:1, padding:'8px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:600, cursor:'pointer' }}>View Profile</button>
          <button onClick={onEdit} style={{ flex:1, padding:'8px', background:'var(--green-light)', color:'var(--green)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500, cursor:'pointer' }}>
            Edit
          </button>
        </div>
      </div>
    </div>
  )
}
