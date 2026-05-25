import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, runTransaction, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const CATEGORIES = [
  { key:'achievements', label:'Achievements', icon:'🏆', color:'var(--gold-dark)', bg:'var(--gold-light)', border:'rgba(201,162,39,0.25)', placeholder:'e.g. Won first place in district science olympiad, selected for state athletics...' },
  { key:'disciplinary', label:'Disciplinary', icon:'⚠️', color:'var(--crimson)', bg:'var(--crimson-light)', border:'rgba(139,26,26,0.2)', placeholder:'e.g. Repeated late submissions, altercation on 12 Apr, counselled regarding attendance...' },
  { key:'patterns', label:'Known Patterns', icon:'📋', color:'#185fa5', bg:'#e6f1fb', border:'#b5d4f4', placeholder:'e.g. Strong in theory, struggles with numericals, participates actively in discussions...' },
  { key:'general', label:'General Remarks', icon:'💬', color:'var(--text)', bg:'var(--gray-50)', border:'var(--gray-200)', placeholder:'e.g. Parent meeting held on 10 Mar, switched optional subject from Hindi to PE...' },
]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default function StudentProfileTab({ studentId, studentName, className, addedByName, addedById, readOnly = false }) {
  const [profile, setProfile] = useState({ achievements:[], disciplinary:[], patterns:[], general:[] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [activeAdd, setActiveAdd] = useState(null)
  const [newNote, setNewNote] = useState('')
  const [editEntry, setEditEntry] = useState(null)
  const [editText, setEditText] = useState('')

  useEffect(() => {
    if (!studentId) { setLoading(false); return }
    setLoading(true); setError(null)
    getDoc(doc(db, 'studentProfiles', studentId))
      .then(d => {
        if (d.exists()) {
          const data = d.data()
          setProfile({
            achievements: data.achievements || [],
            disciplinary: data.disciplinary || [],
            patterns: data.patterns || [],
            general: data.general || [],
          })
        }
      })
      .catch(e => {
        console.error('StudentProfileTab load error:', e)
        if (e.code === 'permission-denied') {
          setError('Permission denied. Please ensure Firestore rules include studentProfiles collection and have been published.')
        } else {
          setError(`Failed to load profile: ${e.message}`)
        }
      })
      .finally(() => setLoading(false))
  }, [studentId])

  // Operation-based save: each call provides instructions to apply against the latest server state.
  // Operations: { type: 'add', category, entry } | { type: 'delete', category, entryId } | { type: 'edit', category, entryId, note, editedByName }
  async function applyOperation(op) {
    setSaving(true)
    try {
      const ref = doc(db, 'studentProfiles', studentId)
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        const current = snap.exists() ? snap.data() : {}
        const next = {
          studentId: studentId || '',
          studentName: studentName || '',
          className: className || '',
          achievements: current.achievements || [],
          disciplinary: current.disciplinary || [],
          patterns: current.patterns || [],
          general: current.general || [],
        }
        const cat = op.category
        const list = [...(next[cat] || [])]
        if (op.type === 'add') {
          list.unshift(op.entry)
        } else if (op.type === 'delete') {
          const idx = list.findIndex(e => e.id === op.entryId)
          if (idx >= 0) list.splice(idx, 1)
        } else if (op.type === 'edit') {
          const idx = list.findIndex(e => e.id === op.entryId)
          if (idx >= 0) list[idx] = { ...list[idx], note: op.note, editedAt: new Date().toISOString(), editedByName: op.editedByName || 'Teacher' }
        }
        next[cat] = list
        next.updatedAt = Timestamp.now()
        tx.set(ref, next)
        return next
      })
      // Update local state with the authoritative server result
      setProfile({
        achievements: result.achievements || [],
        disciplinary: result.disciplinary || [],
        patterns: result.patterns || [],
        general: result.general || [],
      })
    } catch(e) {
      console.error('StudentProfileTab save error:', e)
      alert(e.code === 'permission-denied'
        ? 'Permission denied. Please publish the updated Firestore rules first.'
        : `Save failed: ${e.message}`)
    }
    setSaving(false)
  }

  function addEntry(category) {
    const text = newNote.trim()
    if (!text) return
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      note: text,
      date: todayStr(),
      addedById: addedById || '',
      addedByName: addedByName || 'Teacher',
      addedAt: new Date().toISOString(),
    }
    applyOperation({ type: 'add', category, entry })
    setNewNote('')
    setActiveAdd(null)
  }

  function deleteEntry(category, index) {
    if (!confirm('Delete this remark?')) return
    const entry = (profile[category] || [])[index]
    if (!entry) return
    // For legacy entries without id, fall back to deleting by index via in-memory write
    if (!entry.id) {
      const updated = { ...profile, [category]: (profile[category] || []).filter((_,i) => i !== index) }
      // Direct write — older entry without id, no race-safe path. Best effort.
      setSaving(true)
      ;(async () => {
        try {
          const ref = doc(db, 'studentProfiles', studentId)
          await setDoc(ref, { ...updated, studentId, studentName, className, updatedAt: Timestamp.now() }, { merge: true })
          setProfile(updated)
        } catch(e) { console.error(e); alert('Save failed: '+e.message) }
        setSaving(false)
      })()
      return
    }
    applyOperation({ type: 'delete', category, entryId: entry.id })
  }

  function startEdit(category, index) {
    setEditEntry({ category, index })
    setEditText((profile[category] || [])[index]?.note || '')
  }

  function saveEdit() {
    if (!editEntry || !editText.trim()) return
    const { category, index } = editEntry
    const entry = (profile[category] || [])[index]
    if (!entry) return
    if (!entry.id) {
      // Legacy entry without id — fall back to direct write
      const updated = {
        ...profile,
        [category]: (profile[category] || []).map((e, i) =>
          i === index ? { ...e, note: editText.trim(), editedAt: new Date().toISOString(), editedByName: addedByName || 'Teacher' } : e
        )
      }
      setSaving(true)
      ;(async () => {
        try {
          const ref = doc(db, 'studentProfiles', studentId)
          await setDoc(ref, { ...updated, studentId, studentName, className, updatedAt: Timestamp.now() }, { merge: true })
          setProfile(updated)
        } catch(e) { console.error(e); alert('Save failed: '+e.message) }
        setSaving(false)
      })()
    } else {
      applyOperation({ type: 'edit', category, entryId: entry.id, note: editText.trim(), editedByName: addedByName || 'Teacher' })
    }
    setEditEntry(null)
    setEditText('')
  }

  const totalEntries = CATEGORIES.reduce((sum, c) => sum + (profile[c.key] || []).length, 0)

  if (loading) return (
    <div style={{ textAlign:'center', padding:48 }}>
      <div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
      <p style={{ fontSize:13, color:'var(--text-muted)' }}>Loading profile…</p>
    </div>
  )

  if (error) return (
    <div style={{ padding:'20px', background:'var(--crimson-light)', borderRadius:'var(--radius-lg)', border:'1px solid rgba(139,26,26,0.2)' }}>
      <p style={{ fontSize:13, fontWeight:600, color:'var(--crimson)', marginBottom:6 }}>Could not load profile</p>
      <p style={{ fontSize:12, color:'var(--crimson)' }}>{error}</p>
      <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:8 }}>
        To fix: Go to Firebase Console → Firestore → Rules, add the <code>studentProfiles</code> rule, and publish.
      </p>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {totalEntries === 0 && !activeAdd && (
        <div style={{ textAlign:'center', padding:'32px 20px', background:'var(--gray-50)', borderRadius:'var(--radius-lg)', border:'1px dashed var(--gray-200)' }}>
          <div style={{ fontSize:32, marginBottom:10 }}>📝</div>
          <p style={{ fontSize:14, fontWeight:500, color:'var(--text)', marginBottom:4 }}>No remarks yet</p>
          <p style={{ fontSize:13, color:'var(--text-muted)' }}>
            Add achievements, disciplinary notes, observed patterns or general remarks about {studentName || 'this student'}.
          </p>
        </div>
      )}

      {CATEGORIES.map(cat => {
        const entries = profile[cat.key] || []
        const isAdding = activeAdd === cat.key
        const btnBg = cat.color === 'var(--text)' ? 'var(--green)' : cat.color

        return (
          <div key={cat.key} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>

            {/* Header */}
            <div style={{ padding:'12px 16px', background:cat.bg, borderBottom:`1px solid ${cat.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:15 }}>{cat.icon}</span>
                <span style={{ fontSize:13, fontWeight:600, color:cat.color }}>{cat.label}</span>
                {entries.length > 0 && (
                  <span style={{ fontSize:11, padding:'1px 8px', borderRadius:10, background:'rgba(0,0,0,0.1)', color:cat.color, fontWeight:600 }}>{entries.length}</span>
                )}
              </div>
              {!readOnly && !isAdding && (
                <button
                  onClick={() => { setActiveAdd(cat.key); setNewNote(''); setEditEntry(null) }}
                  style={{ fontSize:12, color:cat.color, background:'rgba(255,255,255,0.8)', border:`1px solid ${cat.border}`, borderRadius:'var(--radius-sm)', padding:'4px 12px', cursor:'pointer', fontWeight:500 }}
                >
                  + Add
                </button>
              )}
            </div>

            {/* Add input */}
            {isAdding && (
              <div style={{ padding:'14px 16px', background:'var(--white)', borderBottom:`1px solid ${cat.border}` }}>
                <textarea
                  autoFocus
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder={cat.placeholder}
                  rows={3}
                  style={{ width:'100%', padding:'10px 12px', border:`1px solid ${cat.border}`, borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none', resize:'vertical', lineHeight:1.6, boxSizing:'border-box' }}
                />
                <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center' }}>
                  <button
                    onClick={() => addEntry(cat.key)}
                    disabled={!newNote.trim() || saving}
                    style={{ padding:'8px 16px', background:!newNote.trim()?'var(--gray-200)':btnBg, color:!newNote.trim()?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:!newNote.trim()?'not-allowed':'pointer' }}
                  >
                    {saving ? 'Saving…' : 'Save remark'}
                  </button>
                  <button
                    onClick={() => { setActiveAdd(null); setNewNote('') }}
                    style={{ padding:'8px 14px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, cursor:'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Entries */}
            {entries.length === 0 && !isAdding ? (
              <div style={{ padding:'14px 16px', fontSize:13, color:'var(--gray-400)', fontStyle:'italic' }}>
                No {cat.label.toLowerCase()} recorded yet.
              </div>
            ) : (
              <div>
                {entries.map((entry, i) => {
                  const isEditing = editEntry?.category === cat.key && editEntry?.index === i
                  return (
                    <div key={i} style={{ padding:'12px 16px', borderBottom: i < entries.length - 1 ? '1px solid var(--gray-50)' : 'none' }}>
                      {isEditing ? (
                        <div>
                          <textarea
                            autoFocus
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            rows={3}
                            style={{ width:'100%', padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', outline:'none', resize:'vertical', marginBottom:8, boxSizing:'border-box' }}
                          />
                          <div style={{ display:'flex', gap:8 }}>
                            <button onClick={saveEdit} disabled={saving} style={{ padding:'6px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500, cursor:'pointer' }}>
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setEditEntry(null)} style={{ padding:'6px 12px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:12, cursor:'pointer' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p style={{ fontSize:13, color:'var(--text)', lineHeight:1.7, margin:'0 0 6px 0', whiteSpace:'pre-wrap' }}>{entry.note}</p>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{entry.date}</span>
                            <span style={{ fontSize:11, color:'var(--gray-300)' }}>·</span>
                            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{entry.addedByName}</span>
                            {entry.editedAt && (
                              <span style={{ fontSize:10, color:'var(--gray-400)', fontStyle:'italic' }}>(edited by {entry.editedByName})</span>
                            )}
                            {!readOnly && (
                              <div style={{ marginLeft:'auto', display:'flex', gap:10 }}>
                                <button onClick={() => startEdit(cat.key, i)} style={{ fontSize:11, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Edit</button>
                                <button onClick={() => deleteEntry(cat.key, i)} style={{ fontSize:11, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer' }}>Delete</button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
