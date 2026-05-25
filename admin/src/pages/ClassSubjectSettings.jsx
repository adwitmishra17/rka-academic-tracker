import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses, DEFAULT_SUBJECTS_BY_BAND, inferGradeBand } from '../hooks/useClasses'

// Per-class subject DEFAULTS — these override the band defaults for legacy classes
// New classes (created via Setup → Add Class) inherit subject defaults from their grade band.
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

// Get default subjects for a class — fall back to grade band defaults if no class-specific entry
function getDefaultsFor(className, classDoc) {
  if (DEFAULTS[className]) return DEFAULTS[className]
  const band = classDoc?.gradeBand || inferGradeBand(className)
  return DEFAULT_SUBJECTS_BY_BAND[band] || []
}

export default function ClassSubjectSettings() {
  const { classes: classDocs, classNames: CLASSES } = useClasses()
  const [classSubjects, setClassSubjects] = useState({})
  const [globalSubjects, setGlobalSubjects] = useState([])
  const [selectedClass, setSelectedClass] = useState('Class 9')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newSubject, setNewSubject] = useState('')

  useEffect(() => {
    async function load() {
      const [csDoc, gsDoc] = await Promise.all([
        getDoc(doc(db, 'settings', 'classSubjects')),
        getDoc(doc(db, 'settings', 'subjects')),
      ])
      // Load global subject list
      const global = gsDoc.exists() && gsDoc.data().list?.length ? gsDoc.data().list : []
      setGlobalSubjects(global)
      // Load per-class subjects — seed with defaults if not set
      if (csDoc.exists() && csDoc.data().map) {
        setClassSubjects(csDoc.data().map)
      } else {
        // Seed: merge defaults with any global subjects
        const seeded = {}
        CLASSES.forEach(cls => {
          const classDoc = classDocs.find(c => c.className === cls)
          const def = getDefaultsFor(cls, classDoc)
          const combined = [...new Set([...def, ...global])]
          seeded[cls] = combined.sort()
        })
        setClassSubjects(seeded)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function save(updated) {
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'classSubjects'), { map: updated, updatedAt: Timestamp.now() })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function toggleSubject(cls, subject) {
    const current = classSubjects[cls] || []
    const updated = current.includes(subject)
      ? current.filter(s => s !== subject)
      : [...current, subject].sort()
    const next = { ...classSubjects, [cls]: updated }
    setClassSubjects(next)
    save(next)
  }

  function addCustomSubject() {
    const s = newSubject.trim()
    if (!s) return
    const current = classSubjects[selectedClass] || []
    if (current.includes(s)) { setNewSubject(''); return }
    const updated = [...current, s].sort()
    const next = { ...classSubjects, [selectedClass]: updated }
    setClassSubjects(next)
    setNewSubject('')
    save(next)
  }

  function addToAll(subject) {
    const next = { ...classSubjects }
    CLASSES.forEach(cls => {
      if (!(next[cls] || []).includes(subject)) {
        next[cls] = [...(next[cls] || []), subject].sort()
      }
    })
    setClassSubjects(next)
    save(next)
  }

  function resetClass() {
    if (!confirm(`Reset ${selectedClass} to default subjects?`)) return
    const global = globalSubjects
    const classDoc = classDocs.find(c => c.className === selectedClass)
    const def = getDefaultsFor(selectedClass, classDoc)
    const reset = [...new Set([...def, ...global])].sort()
    const next = { ...classSubjects, [selectedClass]: reset }
    setClassSubjects(next)
    save(next)
  }

  const currentSubjects = (classSubjects[selectedClass] || []).sort()
  // All subjects across global list + defaults for this class + what's already assigned
  const allAvailable = [...new Set([
    ...(globalSubjects),
    ...(DEFAULTS[selectedClass] || []),
    ...(currentSubjects),
  ])].sort()

  return (
    <div style={{ padding:'24px 28px', maxWidth:1000 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Class Subject Mapping</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Define which subjects are available for each class. These control what appears in timetable, lesson log, and teacher assignments.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:28, height:28, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
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
              {/* Header */}
              <div style={{ padding:'14px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:600, color:'var(--green-dark)', fontFamily:'var(--font-display)' }}>{selectedClass}</div>
                  <div style={{ fontSize:12, color:'var(--green-mid)', marginTop:1 }}>{currentSubjects.length} subjects assigned</div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {saved && <span style={{ fontSize:12, color:'var(--green)', fontWeight:500 }}>✓ Saved</span>}
                  <button onClick={resetClass} style={{ fontSize:12, color:'var(--text-muted)', background:'none', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', padding:'5px 12px', cursor:'pointer' }}>Reset to defaults</button>
                </div>
              </div>

              {/* Subject chips — toggle on/off */}
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

                {/* Add custom subject to this class */}
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

            {/* Info box */}
            <div style={{ marginTop:14, padding:'12px 16px', background:'var(--green-light)', borderRadius:'var(--radius-md)', border:'1px solid var(--green-muted)', fontSize:12, color:'var(--green-dark)', lineHeight:1.7 }}>
              <strong>Changes take effect immediately</strong> across Timetable, Lesson Log, Teacher Assignment, and all other parts of the app that use subject dropdowns. Subjects from your global <em>Subjects</em> list are shown here automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
