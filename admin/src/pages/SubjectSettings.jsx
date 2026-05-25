import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const DEFAULT_SUBJECTS = [
  'Mathematics', 'Science', 'Physics', 'Chemistry', 'Biology',
  'English', 'Hindi', 'Social Science', 'History', 'Geography',
  'Political Science', 'Economics', 'Accountancy', 'Business Studies',
  'Physical Education', 'Computers', 'Sanskrit', 'Home Science'
]

export default function SubjectSettings() {
  const [subjects, setSubjects] = useState([])
  const [newSubject, setNewSubject] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'subjects'))
      .then(d => {
        if (d.exists() && d.data().list?.length) setSubjects(d.data().list)
        else setSubjects(DEFAULT_SUBJECTS)
        setLoading(false)
      })
      .catch(() => { setSubjects(DEFAULT_SUBJECTS); setLoading(false) })
  }, [])

  async function save(list) {
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'subjects'), { list, updatedAt: Timestamp.now() })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function addSubject() {
    const s = newSubject.trim()
    if (!s || subjects.includes(s)) return
    const updated = [...subjects, s].sort()
    setSubjects(updated)
    setNewSubject('')
    save(updated)
  }

  function removeSubject(s) {
    if (!confirm(`Remove "${s}"? This won't affect existing data.`)) return
    const updated = subjects.filter(x => x !== s)
    setSubjects(updated)
    save(updated)
  }

  return (
    <div style={{ padding:'24px 28px', maxWidth:700 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Subject Settings</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Define all subjects available in the school. These appear when assigning teachers, creating tests, and logging lessons.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
        <>
          <div style={{ background:'var(--green-light)', borderRadius:'var(--radius-md)', padding:'12px 16px', marginBottom:20, fontSize:13, color:'var(--green-dark)', lineHeight:1.6 }}>
            {subjects.length} subjects defined. Teachers are assigned subjects from this list. Changes take effect immediately across the app.
          </div>

          {/* Add new */}
          <div style={{ display:'flex', gap:10, marginBottom:20 }}>
            <input
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSubject()}
              placeholder="Type a subject name and press Enter or Add…"
              style={{ flex:1, padding:'10px 14px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }}
            />
            <button
              onClick={addSubject}
              disabled={!newSubject.trim() || subjects.includes(newSubject.trim())}
              style={{ padding:'10px 20px', background: !newSubject.trim() ? 'var(--gray-200)' : 'var(--green)', color: !newSubject.trim() ? 'var(--gray-400)' : 'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor: !newSubject.trim() ? 'not-allowed' : 'pointer', whiteSpace:'nowrap' }}
            >
              + Add
            </button>
          </div>

          {/* Subject list */}
          <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
            <div style={{ padding:'11px 18px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              All Subjects ({subjects.length})
            </div>
            {subjects.length === 0 ? (
              <div style={{ padding:32, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No subjects added yet. Add your first subject above.</div>
            ) : (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, padding:16 }}>
                {subjects.map(s => (
                  <div key={s} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', background:'var(--green-light)', borderRadius:20, border:'1px solid var(--green-muted)' }}>
                    <span style={{ fontSize:13, fontWeight:500, color:'var(--green-dark)' }}>{s}</span>
                    <button onClick={() => removeSubject(s)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--crimson)', fontSize:14, lineHeight:1, padding:'0 0 0 2px', opacity:0.6 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {saved && <div style={{ marginTop:14, fontSize:13, color:'var(--green)', fontWeight:500 }}>✓ Subjects saved</div>}
        </>
      )}
    </div>
  )
}
