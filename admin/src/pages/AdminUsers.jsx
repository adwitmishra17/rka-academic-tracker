import React, { useState, useEffect } from 'react'
import { collection, getDocs, setDoc, doc, deleteDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth, SUPER_ADMIN_EMAIL } from '../App'

// Role + branch metadata (single source of truth for this page)
const ROLES = [
  { value: 'admin',        label: 'Admin',      desc: 'Full tracker access for one branch' },
  { value: 'receptionist', label: 'Front desk', desc: 'Walk-in admissions for one branch' },
]
const BRANCHES = [
  { value: 'MAIN', label: 'Main Campus', desc: 'Sawarubandh / Akhar' },
  { value: 'CITY', label: 'City Branch', desc: 'Japlinganj' },
]
// Fixed display order for the table — super admin first, then admins, then front desk.
const ROLE_ORDER = { super_admin: 0, admin: 1, receptionist: 2 }

export default function AdminUsers() {
  const { user, isSuperAdmin } = useAuth()
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)

  // Add modal state
  const [showAdd, setShowAdd] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('admin')
  const [newBranch, setNewBranch] = useState('MAIN')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Edit modal state
  const [editing, setEditing] = useState(null) // admin object or null
  const [editRole, setEditRole] = useState('admin')
  const [editBranch, setEditBranch] = useState('MAIN')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'admins'))
      const docs = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      // Defensive sort — fixed role order, then alphabetical email
      docs.sort((a, b) => {
        const ra = ROLE_ORDER[a.role] ?? 99
        const rb = ROLE_ORDER[b.role] ?? 99
        if (ra !== rb) return ra - rb
        return (a.email || a.id || '').localeCompare(b.email || b.id || '')
      })
      setAdmins(docs)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  async function handleAdd() {
    setError('')
    const email = newEmail.trim().toLowerCase()
    const name = newName.trim()
    if (!email) { setError('Email is required.'); return }
    if (!name) { setError('Full name is required.'); return }
    if (!email.includes('@')) { setError('Invalid email format.'); return }
    if (email === SUPER_ADMIN_EMAIL) { setError('This email is already the super admin.'); return }
    if (admins.find(a => a.email === email)) { setError('This email is already an admin.'); return }
    if (!ROLES.find(r => r.value === newRole)) { setError('Pick a role.'); return }
    if (!BRANCHES.find(b => b.value === newBranch)) { setError('Pick a branch.'); return }

    setSaving(true)
    try {
      await setDoc(doc(db, 'admins', email), {
        email,
        fullName: name,
        role: newRole,
        branchCode: newBranch,
        isActive: true,
        addedById: user.uid,
        addedByName: user.displayName || user.email,
        addedAt: Timestamp.now(),
      })
      await load()
      setShowAdd(false)
      setNewEmail(''); setNewName(''); setNewRole('admin'); setNewBranch('MAIN')
    } catch(e) { setError(`Failed to add: ${e.message}`) }
    setSaving(false)
  }

  function openEdit(admin) {
    setEditing(admin)
    // Default to current values when valid; otherwise sensible fallbacks
    setEditRole(ROLES.find(r => r.value === admin.role) ? admin.role : 'admin')
    setEditBranch(BRANCHES.find(b => b.value === admin.branchCode) ? admin.branchCode : 'MAIN')
    setEditError('')
  }

  async function handleEditSave() {
    if (!editing) return
    setEditError('')
    if (!ROLES.find(r => r.value === editRole)) { setEditError('Pick a role.'); return }
    if (!BRANCHES.find(b => b.value === editBranch)) { setEditError('Pick a branch.'); return }
    setEditSaving(true)
    try {
      await setDoc(doc(db, 'admins', editing.id), {
        ...editing,
        role: editRole,
        branchCode: editBranch,
        updatedById: user.uid,
        updatedByName: user.displayName || user.email,
        updatedAt: Timestamp.now(),
      }, { merge: true })
      await load()
      setEditing(null)
    } catch(e) { setEditError(`Failed to update: ${e.message}`) }
    setEditSaving(false)
  }

  async function handleToggleRole(admin) {
    if (admin.email === SUPER_ADMIN_EMAIL) return
    const newR = admin.role === 'super_admin' ? 'admin' : 'super_admin'
    const label = newR === 'super_admin' ? 'Super Admin' : 'Admin'
    if (!confirm(`Change ${admin.fullName}'s role to ${label}?`)) return
    try {
      await setDoc(doc(db, 'admins', admin.id), { ...admin, role: newR }, { merge: true })
      await load()
    } catch(e) { alert(`Failed to update: ${e.message}`) }
  }

  async function handleRemove(admin) {
    if (admin.email === SUPER_ADMIN_EMAIL) { alert('Super admin cannot be removed.'); return }
    if (!confirm(`Remove ${admin.fullName} (${admin.email}) as admin? They will lose access immediately.`)) return
    try {
      await deleteDoc(doc(db, 'admins', admin.id))
      await load()
    } catch(e) { alert(`Failed to remove: ${e.message}`) }
  }

  async function handleToggleActive(admin) {
    if (admin.email === SUPER_ADMIN_EMAIL) return
    const next = admin.isActive === false
    if (!confirm(next ? `Reactivate ${admin.fullName}?` : `Deactivate ${admin.fullName}? They will lose access immediately.`)) return
    try {
      await setDoc(doc(db, 'admins', admin.id), { ...admin, isActive: next }, { merge: true })
      await load()
    } catch(e) { alert(`Failed to update: ${e.message}`) }
  }

  // Build the full admin list — including hardcoded super admin
  const superAdminEntry = {
    id: SUPER_ADMIN_EMAIL, email: SUPER_ADMIN_EMAIL, fullName: 'Adwit Mishra',
    role: 'super_admin', branchCode: null, isActive: true, isHardcoded: true,
  }
  const allAdmins = [superAdminEntry, ...admins.filter(a => a.email !== SUPER_ADMIN_EMAIL)]

  const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none', boxSizing:'border-box' }

  // Outlined action button — used in the table actions column
  const actionBtn = (color) => ({
    fontSize:11, padding:'5px 10px', borderRadius:6,
    border:'1px solid var(--gray-200)', background:'var(--white)',
    color, cursor:'pointer', fontWeight:500, whiteSpace:'nowrap',
  })

  // Inline pill renderers
  const RoleBadge = ({ role }) => {
    const isSuper = role === 'super_admin'
    const isRecep = role === 'receptionist'
    const bg = isSuper ? 'var(--gold-light)' : isRecep ? 'rgba(139,26,26,0.08)' : 'var(--green-light)'
    const fg = isSuper ? 'var(--gold-dark)' : isRecep ? 'var(--crimson)' : 'var(--green)'
    const label = isSuper ? '⭐ Super Admin' : isRecep ? 'Front desk' : 'Admin'
    return <span style={{ fontSize:11, padding:'3px 10px', borderRadius:12, background:bg, color:fg, fontWeight:600, whiteSpace:'nowrap', display:'inline-block' }}>{label}</span>
  }

  const BranchBadge = ({ admin }) => {
    if (admin.role === 'super_admin') {
      return <span style={{ fontSize:11, color:'var(--text-muted)', fontStyle:'italic', whiteSpace:'nowrap' }}>All branches</span>
    }
    if (!admin.branchCode) {
      return <span style={{ fontSize:11, padding:'3px 10px', borderRadius:12, background:'var(--crimson-light)', color:'var(--crimson)', fontWeight:600, whiteSpace:'nowrap', display:'inline-block' }}>Needs setup</span>
    }
    const b = BRANCHES.find(x => x.value === admin.branchCode)
    return <span style={{ fontSize:11, padding:'3px 10px', borderRadius:12, background:'var(--gray-50)', color:'var(--text)', fontWeight:600, whiteSpace:'nowrap', display:'inline-block' }}>{b ? b.label : admin.branchCode}</span>
  }

  if (!isSuperAdmin) {
    return (
      <div style={{ padding:'32px 36px', maxWidth:600 }}>
        <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-lg)', padding:'20px' }}>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:600, color:'var(--crimson)', marginBottom:6 }}>Access Restricted</h1>
          <p style={{ fontSize:13, color:'var(--crimson)' }}>Only the Super Admin can manage admin users. Contact Adwit Mishra if you need to add, remove, or modify administrators.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Admin Users</h1>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>Manage who has access to the admin portal. Super admins can add, remove, and change admin roles.</p>
          <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
        </div>
        <button onClick={() => setShowAdd(true)} style={{ padding:'10px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:7, whiteSpace:'nowrap' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Admin
        </button>
      </div>

      {/* Info banner */}
      <div style={{ background:'var(--gold-light)', border:'1px solid rgba(201,162,39,0.25)', borderRadius:'var(--radius-md)', padding:'12px 16px', marginBottom:20, display:'flex', alignItems:'flex-start', gap:12 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        <div style={{ fontSize:12, color:'var(--gold-dark)', lineHeight:1.6 }}>
          <strong>Admin</strong> has full tracker access for their assigned branch. <strong>Front desk</strong> can manage walk-in admissions for one branch. Both are tied to a single campus (Main or City).
          The <strong>Super Admin</strong> <code style={{ background:'rgba(201,162,39,0.15)', padding:'1px 6px', borderRadius:3, fontSize:11 }}>{SUPER_ADMIN_EMAIL}</code> is hardcoded, sees all branches, and cannot be removed.
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--gray-50)' }}>
                {['Admin','Email','Role','Branch','Added','Actions'].map(h => (
                  <th key={h} style={{ padding:'12px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allAdmins.map((a) => (
                <tr key={a.id} style={{ borderTop:'1px solid var(--gray-50)', opacity: a.isActive === false ? 0.5 : 1, verticalAlign:'middle' }}>
                  <td style={{ padding:'12px 16px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:34, height:34, borderRadius:'50%', background: a.role === 'super_admin' ? 'var(--gold-light)' : 'var(--green-light)', border:`1px solid ${a.role === 'super_admin' ? 'var(--gold)' : 'var(--green-muted)'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <span style={{ fontSize:12, fontWeight:700, color: a.role === 'super_admin' ? 'var(--gold-dark)' : 'var(--green)' }}>{((a.fullName||a.email||'?').split(' ').map(n=>n[0]||'').join('').slice(0,2) || '?').toUpperCase()}</span>
                      </div>
                      <div>
                        <div style={{ fontWeight:500, color:'var(--text)', whiteSpace:'nowrap' }}>{a.fullName || '—'}</div>
                        {a.isHardcoded && <div style={{ fontSize:10, color:'var(--gold-dark)', marginTop:1 }}>System</div>}
                        {a.isActive === false && <div style={{ fontSize:10, color:'var(--crimson)', marginTop:1, fontWeight:500 }}>Deactivated</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'12px 16px', color:'var(--text-muted)', fontSize:12 }}>{a.email || a.id || '—'}</td>
                  <td style={{ padding:'12px 16px' }}><RoleBadge role={a.role} /></td>
                  <td style={{ padding:'12px 16px' }}><BranchBadge admin={a} /></td>
                  <td style={{ padding:'12px 16px', fontSize:12, color:'var(--text-muted)' }}>
                    {a.isHardcoded ? '—' : (
                      <>
                        <div style={{ whiteSpace:'nowrap' }}>{a.addedByName || 'System'}</div>
                        <div style={{ fontSize:10, color:'var(--gray-400)' }}>{a.addedAt?.toDate ? a.addedAt.toDate().toLocaleDateString() : '—'}</div>
                      </>
                    )}
                  </td>
                  <td style={{ padding:'12px 16px' }}>
                    {a.isHardcoded ? (
                      <span style={{ fontSize:11, color:'var(--gray-400)', fontStyle:'italic' }}>Hardcoded</span>
                    ) : (
                      <div style={{ display:'flex', gap:6, flexWrap:'nowrap', alignItems:'center' }}>
                        <button onClick={() => openEdit(a)} style={actionBtn('var(--green)')}>
                          Edit
                        </button>
                        <button onClick={() => handleToggleRole(a)} style={actionBtn('var(--green)')}>
                          {a.role === 'super_admin' ? 'Demote' : 'Promote'}
                        </button>
                        <button onClick={() => handleToggleActive(a)} style={actionBtn('var(--gold-dark)')}>
                          {a.isActive === false ? 'Reactivate' : 'Deactivate'}
                        </button>
                        <button onClick={() => handleRemove(a)} style={actionBtn('var(--crimson)')}>
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Admin Modal */}
      {showAdd && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:20 }}>
          <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:500, boxShadow:'var(--shadow-lg)' }}>
            <div style={{ padding:'18px 22px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--green-dark)' }}>Add New Admin</h2>
              <button onClick={() => { setShowAdd(false); setError('') }} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22 }}>×</button>
            </div>
            <div style={{ padding:'22px', display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Email <span style={{ color:'var(--crimson)' }}>*</span></label>
                <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="e.g. principal@rkacademyballia.in" style={inp} />
                <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>The email must match the Google account they'll sign in with.</p>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Full Name <span style={{ color:'var(--crimson)' }}>*</span></label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Rajesh Kumar" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Role</label>
                <div style={{ display:'flex', gap:10 }}>
                  {ROLES.map(r => (
                    <label key={r.value} style={{ flex:1, padding:'12px 14px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor: newRole === r.value ? 'var(--green)' : 'var(--gray-200)', background: newRole === r.value ? 'var(--green-light)' : 'var(--white)', cursor:'pointer', display:'flex', flexDirection:'column', gap:4 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <input type="radio" name="role" value={r.value} checked={newRole===r.value} onChange={() => setNewRole(r.value)} />
                        <span style={{ fontSize:13, fontWeight:600, color: newRole === r.value ? 'var(--green-dark)' : 'var(--text)' }}>{r.label}</span>
                      </div>
                      <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:22 }}>{r.desc}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Branch</label>
                <div style={{ display:'flex', gap:10 }}>
                  {BRANCHES.map(b => (
                    <label key={b.value} style={{ flex:1, padding:'12px 14px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor: newBranch === b.value ? 'var(--green)' : 'var(--gray-200)', background: newBranch === b.value ? 'var(--green-light)' : 'var(--white)', cursor:'pointer', display:'flex', flexDirection:'column', gap:4 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <input type="radio" name="branch" value={b.value} checked={newBranch===b.value} onChange={() => setNewBranch(b.value)} />
                        <span style={{ fontSize:13, fontWeight:600, color: newBranch === b.value ? 'var(--green-dark)' : 'var(--text)' }}>{b.label}</span>
                      </div>
                      <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:22 }}>{b.desc}</span>
                    </label>
                  ))}
                </div>
              </div>

              {error && <div style={{ fontSize:12, color:'var(--crimson)', padding:'9px 12px', background:'var(--crimson-light)', borderRadius:'var(--radius-sm)' }}>{error}</div>}

              <button onClick={handleAdd} disabled={saving || !newEmail.trim() || !newName.trim()} style={{ padding:'12px', background:(!newEmail.trim()||!newName.trim())?'var(--gray-200)':'var(--green)', color:(!newEmail.trim()||!newName.trim())?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:600, cursor:(!newEmail.trim()||!newName.trim())?'not-allowed':'pointer', marginTop:4 }}>
                {saving ? 'Adding…' : 'Add Admin'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Admin Modal */}
      {editing && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:20 }}>
          <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:500, boxShadow:'var(--shadow-lg)' }}>
            <div style={{ padding:'18px 22px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--green-dark)' }}>Edit Admin</h2>
              <button onClick={() => { setEditing(null); setEditError('') }} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22 }}>×</button>
            </div>
            <div style={{ padding:'22px', display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ background:'var(--gray-50)', borderRadius:'var(--radius-sm)', padding:'10px 12px' }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{editing.fullName || '—'}</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{editing.email}</div>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Role</label>
                <div style={{ display:'flex', gap:10 }}>
                  {ROLES.map(r => (
                    <label key={r.value} style={{ flex:1, padding:'12px 14px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor: editRole === r.value ? 'var(--green)' : 'var(--gray-200)', background: editRole === r.value ? 'var(--green-light)' : 'var(--white)', cursor:'pointer', display:'flex', flexDirection:'column', gap:4 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <input type="radio" name="editRole" value={r.value} checked={editRole===r.value} onChange={() => setEditRole(r.value)} />
                        <span style={{ fontSize:13, fontWeight:600, color: editRole === r.value ? 'var(--green-dark)' : 'var(--text)' }}>{r.label}</span>
                      </div>
                      <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:22 }}>{r.desc}</span>
                    </label>
                  ))}
                </div>
                {editing.role === 'super_admin' && (
                  <p style={{ fontSize:11, color:'var(--crimson)', marginTop:6 }}>This admin currently has the legacy <strong>super_admin</strong> role. Saving will convert them to a branch-scoped role. (The hardcoded super admin is unaffected.)</p>
                )}
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:5 }}>Branch</label>
                <div style={{ display:'flex', gap:10 }}>
                  {BRANCHES.map(b => (
                    <label key={b.value} style={{ flex:1, padding:'12px 14px', borderRadius:'var(--radius-sm)', border:'1px solid', borderColor: editBranch === b.value ? 'var(--green)' : 'var(--gray-200)', background: editBranch === b.value ? 'var(--green-light)' : 'var(--white)', cursor:'pointer', display:'flex', flexDirection:'column', gap:4 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <input type="radio" name="editBranch" value={b.value} checked={editBranch===b.value} onChange={() => setEditBranch(b.value)} />
                        <span style={{ fontSize:13, fontWeight:600, color: editBranch === b.value ? 'var(--green-dark)' : 'var(--text)' }}>{b.label}</span>
                      </div>
                      <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:22 }}>{b.desc}</span>
                    </label>
                  ))}
                </div>
              </div>

              {editError && <div style={{ fontSize:12, color:'var(--crimson)', padding:'9px 12px', background:'var(--crimson-light)', borderRadius:'var(--radius-sm)' }}>{editError}</div>}

              <button onClick={handleEditSave} disabled={editSaving} style={{ padding:'12px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:600, cursor:editSaving?'not-allowed':'pointer', marginTop:4 }}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
