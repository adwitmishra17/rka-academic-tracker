import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses, DEFAULT_SUBJECTS_BY_BAND, inferGradeBand } from '../hooks/useClasses'

/* ============================================================
   Classes & Subjects Assignment

   Merges the former "Subjects" (global master list) and
   "Class Subjects" (per-class subject selection) pages into one:
     • Subject master   → settings/subjects   { list: [...] }
     • Per-class mapping → settings/classSubjects { map: { class: [...] } }
   Both are edited here; changes take effect immediately across the app.
   ============================================================ */

const DEFAULT_SUBJECTS = [
  'Mathematics', 'Science', 'Physics', 'Chemistry', 'Biology',
  'English', 'Hindi', 'Social Science', 'History', 'Geography',
  'Political Science', 'Economics', 'Accountancy', 'Business Studies',
  'Physical Education', 'Computers', 'Sanskrit', 'Home Science',
]

// Per-class subject DEFAULTS — override the band defaults for legacy classes.
const DEFAULTS = {
  'Class 9':  ['Mathematics','Science','English','Hindi','Social Science','History','Political Science','Geography','Economics','Sanskrit','Physical Education','Computers','Artificial Intelligence'],
  'Class 10': ['Mathematics','Science','English','Hindi','Social Science','History','Political Science','Geography','Economics','Sanskrit','Physical Education','Computers','Artificial Intelligence'],
  'Class 11 Science':      ['Physics','Chemistry','Biology','Mathematics','English','Hindi','Physical Education','Computers','Artificial Intelligence'],
  'Class 11 Commerce':     ['Accountancy','Business Studies','Economics','Mathematics','English','Hindi','Physical Education','Computers','Artificial Intelligence'],
  'Class 11 Humanities':   ['History','Political Science','Geography','Economics','English','Hindi','Physical Education','Computers','Artificial Intelligence'],
  'Class 12 Science':      ['Physics','Chemistry','Biology','Mathematics','English','Hindi','Physical Education','Computers','Artificial Intelligence'],
  'Class 12 Commerce':     ['Accountancy','Business Studies','Economics','Mathematics','English','Hindi','Physical Education','Computers','Artificial Intelligence'],
  'Class 12 Humanities':   ['History','Political Science','Geography','Economics','English','Hindi','Physical Education','Computers','Artificial Intelligence'],
}

function getDefaultsFor(className, classDoc) {
  if (DEFAULTS[className]) return DEFAULTS[className]
  const band = classDoc?.gradeBand || inferGradeBand(className)
  return DEFAULT_SUBJECTS_BY_BAND[band] || []
}

export default function ClassesAndSubjectsAssignment() {
  const { classes: classDocs, classNames: CLASSES } = useClasses()
  const [globalSubjects, setGlobalSubjects] = useState([])
  const [classSubjects, setClassSubjects]   = useState({})
  const [selectedClass, setSelectedClass]   = useState('Class 9')
  const [newSubject, setNewSubject]         = useState('')   // add to selected class
  const [newGlobal, setNewGlobal]           = useState('')   // add to master
  const [loading, setLoading]               = useState(true)
  const [savedGlobal, setSavedGlobal]       = useState(false)
  const [savedClass, setSavedClass]         = useState(false)

  useEffect(() => {
    async function load() {
      const [csDoc, gsDoc] = await Promise.all([
        getDoc(doc(db, 'settings', 'classSubjects')),
        getDoc(doc(db, 'settings', 'subjects')),
      ])
      const global = gsDoc.exists() && gsDoc.data().list?.length ? gsDoc.data().list : DEFAULT_SUBJECTS
      setGlobalSubjects(global)
      if (csDoc.exists() && csDoc.data().map) {
        setClassSubjects(csDoc.data().map)
      } else {
        const seeded = {}
        CLASSES.forEach(cls => {
          const classDoc = classDocs.find(c => c.className === cls)
          const def = getDefaultsFor(cls, classDoc)
          seeded[cls] = [...new Set([...def, ...global])].sort()
        })
        setClassSubjects(seeded)
      }
      setLoading(false)
    }
    load()
    // eslint-disable-next-line
  }, [])

  // ── Subject master (settings/subjects) ──
  async function saveGlobal(list) {
    try {
      await setDoc(doc(db, 'settings', 'subjects'), { list, updatedAt: Timestamp.now() })
      setSavedGlobal(true); setTimeout(() => setSavedGlobal(false), 2000)
    } catch (e) { console.error(e) }
  }
  function addGlobalSubject() {
    const s = newGlobal.trim()
    if (!s || globalSubjects.includes(s)) return
    const updated = [...globalSubjects, s].sort()
    setGlobalSubjects(updated); setNewGlobal(''); saveGlobal(updated)
  }
  function removeGlobalSubject(s) {
    if (!confirm(`Remove "${s}" from the master list? Classes that already have it keep it.`)) return
    const updated = globalSubjects.filter(x => x !== s)
    setGlobalSubjects(updated); saveGlobal(updated)
  }

  // ── Per-class mapping (settings/classSubjects) ──
  async function saveClass(map) {
    try {
      await setDoc(doc(db, 'settings', 'classSubjects'), { map, updatedAt: Timestamp.now() })
      setSavedClass(true); setTimeout(() => setSavedClass(false), 2000)
    } catch (e) { console.error(e) }
  }
  function toggleSubject(cls, subject) {
    const current = classSubjects[cls] || []
    const updated = current.includes(subject) ? current.filter(s => s !== subject) : [...current, subject].sort()
    const next = { ...classSubjects, [cls]: updated }
    setClassSubjects(next); saveClass(next)
  }
  function addCustomSubject() {
    const s = newSubject.trim()
    if (!s) return
    const current = classSubjects[selectedClass] || []
    if (current.includes(s)) { setNewSubject(''); return }
    const updated = [...current, s].sort()
    const next = { ...classSubjects, [selectedClass]: updated }
    setClassSubjects(next); setNewSubject(''); saveClass(next)
  }
  function addToAll(subject) {
    const next = { ...classSubjects }
    CLASSES.forEach(cls => {
      if (!(next[cls] || []).includes(subject)) next[cls] = [...(next[cls] || []), subject].sort()
    })
    setClassSubjects(next); saveClass(next)
  }
  function resetClass() {
    if (!confirm(`Reset ${selectedClass} to default subjects?`)) return
    const classDoc = classDocs.find(c => c.className === selectedClass)
    const def = getDefaultsFor(selectedClass, classDoc)
    const reset = [...new Set([...def, ...globalSubjects])].sort()
    const next = { ...classSubjects, [selectedClass]: reset }
    setClassSubjects(next); saveClass(next)
  }

  const currentSubjects = (classSubjects[selectedClass] || []).slice().sort()
  const allAvailable = [...new Set([
    ...globalSubjects,
    ...(DEFAULTS[selectedClass] || []),
    ...currentSubjects,
  ])].sort()

  const inputStyle = { flex:1, padding:'10px 14px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

  return (
    <div style={{ padding:'24px 28px', maxWidth:1000 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Classes &amp; Subjects Assignment</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Manage the school-wide subject master and choose which subjects each class offers. These control timetable, lesson log, teacher assignment, and exam subjects.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
        <>
          {/* ── Subject master ── */}
          <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden', marginBottom:24 }}>
            <div style={{ padding:'11px 18px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Subject Master ({globalSubjects.length})</span>
              {savedGlobal && <span style={{ fontSize:12, color:'var(--green)', fontWeight:500 }}>✓ Saved</span>}
            </div>
            <div style={{ padding:16 }}>
              <div style={{ fontSize:12.5, color:'var(--text-muted)', marginBottom:12, lineHeight:1.6 }}>
                The school-wide list of subjects. Every subject here is available to assign to any class below.
              </div>
              <div style={{ display:'flex', gap:10, marginBottom:16 }}>
                <input
                  value={newGlobal}
                  onChange={e => setNewGlobal(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addGlobalSubject()}
                  placeholder="Add a subject to the master list…"
                  style={inputStyle}
                />
                <button
                  onClick={addGlobalSubject}
                  disabled={!newGlobal.trim() || globalSubjects.includes(newGlobal.trim())}
                  style={{ padding:'10px 20px', background: !newGlobal.trim() ? 'var(--gray-200)' : 'var(--green)', color: !newGlobal.trim() ? 'var(--gray-400)' : 'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor: !newGlobal.trim() ? 'not-allowed' : 'pointer', whiteSpace:'nowrap' }}
                >
                  + Add
                </button>
              </div>
              {globalSubjects.length === 0 ? (
                <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No subjects yet. Add your first subject above.</div>
              ) : (
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {globalSubjects.map(s => (
                    <div key={s} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', background:'var(--green-light)', borderRadius:20, border:'1px solid var(--green-muted)' }}>
                      <span style={{ fontSize:13, fontWeight:500, color:'var(--green-dark)' }}>{s}</span>
                      <button onClick={() => removeGlobalSubject(s)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--crimson)', fontSize:14, lineHeight:1, padding:'0 0 0 2px', opacity:0.6 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Per-class assignment ── */}
          <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:20 }}>
            {/* Class selector sidebar */}
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {CLASSES.map(cls => {
                const count = (classSubjects[cls] || []).length
                return (
                  <button key={cls} onClick={() => setSelectedClass(cls)} style={{ padding:'10px 14px', borderRadius:'var(--radius-md)', border:'1px solid', textAlign:'left', borderColor:selectedClass===cls?'var(--green)':'var(--gray-100)', background:selectedClass===cls?'var(--green)':'var(--white)', color:selectedClass===cls?'white':'var(--text)', cursor:'pointer', transition:'all 0.12s', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, fontWeight:selectedClass===cls?600:400 }}>{cls}</span>
                    <span style={{ fontSize:11, opacity:0.7, background:selectedClass===cls?'rgba(255,255,255,0.2)':'var(--gray-100)', padding:'1px 7px', borderRadius:10 }}>{count}</span>
                  </button>
                )
              })}
            </div>

            {/* Subject editor */}
            <div>
              <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
                <div style={{ padding:'14px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:600, color:'var(--green-dark)', fontFamily:'var(--font-display)' }}>{selectedClass}</div>
                    <div style={{ fontSize:12, color:'var(--green-mid)', marginTop:1 }}>{currentSubjects.length} subjects assigned</div>
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {savedClass && <span style={{ fontSize:12, color:'var(--green)', fontWeight:500 }}>✓ Saved</span>}
                    <button onClick={resetClass} style={{ fontSize:12, color:'var(--text-muted)', background:'none', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', padding:'5px 12px', cursor:'pointer' }}>Reset to defaults</button>
                  </div>
                </div>

                <div style={{ padding:'16px 18px' }}>
                  <div style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', marginBottom:10 }}>
                    Click to toggle — green = enabled for this class
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:20 }}>
                    {allAvailable.map(s => {
                      const enabled = currentSubjects.includes(s)
                      return (
                        <button key={s} onClick={() => toggleSubject(selectedClass, s)} style={{ padding:'6px 14px', borderRadius:20, border:'1px solid', borderColor:enabled?'var(--green)':'var(--gray-200)', background:enabled?'var(--green)':'var(--white)', color:enabled?'white':'var(--text-muted)', fontSize:12, fontWeight:enabled?500:400, cursor:'pointer', transition:'all 0.12s', display:'flex', alignItems:'center', gap:5 }}>
                          {enabled && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                          {s}
                        </button>
                      )
                    })}
                  </div>

                  <div style={{ borderTop:'1px solid var(--gray-100)', paddingTop:16 }}>
                    <div style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', marginBottom:8 }}>Add a subject to {selectedClass}</div>
                    <div style={{ display:'flex', gap:8 }}>
                      <input
                        value={newSubject}
                        onChange={e => setNewSubject(e.target.value)}
                        onKeyDown={e => e.key==='Enter' && addCustomSubject()}
                        placeholder="Type subject name…"
                        style={{ flex:1, padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }}
                      />
                      <button onClick={addCustomSubject} disabled={!newSubject.trim()} style={{ padding:'9px 16px', background:!newSubject.trim()?'var(--gray-200)':'var(--green)', color:!newSubject.trim()?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:!newSubject.trim()?'not-allowed':'pointer' }}>
                        + Add
                      </button>
                      {newSubject.trim() && (
                        <button onClick={() => addToAll(newSubject.trim())} style={{ padding:'9px 14px', background:'var(--gold-light)', color:'var(--gold-dark)', border:'1px solid rgba(201,162,39,0.3)', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}>
                          + Add to all classes
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop:14, padding:'12px 16px', background:'var(--green-light)', borderRadius:'var(--radius-md)', border:'1px solid var(--green-muted)', fontSize:12, color:'var(--green-dark)', lineHeight:1.7 }}>
                <strong>Changes take effect immediately</strong> across Timetable, Lesson Log, Teacher Assignment, and exam subjects. Subjects from the <em>Subject Master</em> above are offered here automatically.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
