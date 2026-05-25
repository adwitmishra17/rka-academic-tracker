import React, { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'

// CLASSES loaded via useClasses()
const SUBJECTS = {
  'Class 9': ['Science','Mathematics','English','Hindi','Social Science'],
  'Class 10': ['Science','Mathematics','English','Hindi','Social Science'],
  'Class 11 Science': ['Physics','Chemistry','Biology','Mathematics','English','Hindi','Physical Education','Computers'],
  'Class 11 Commerce': ['Accountancy','Business Studies','Economics','English','Hindi','Physical Education','Computers'],
  'Class 11 Humanities': ['History','Political Science','Geography','English','Hindi','Physical Education','Computers'],
  'Class 12 Science': ['Physics','Chemistry','Biology','Mathematics','English','Hindi','Physical Education','Computers'],
  'Class 12 Commerce': ['Accountancy','Business Studies','Economics','English','Hindi','Physical Education','Computers'],
  'Class 12 Humanities': ['History','Political Science','Geography','English','Hindi','Physical Education','Computers'],
}
const MONTHS = ['Apr 2025','May 2025','Jun 2025','Jul 2025','Aug 2025','Sep 2025','Oct 2025','Nov 2025','Dec 2025','Jan 2026','Feb 2026']
const inp = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
// Try models in order until one works
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-preview-04-17',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
]

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function callGemini(base64, mimeType, className, subject, modelName) {
  const prompt = `You are a CBSE school syllabus parser. This is the official CBSE syllabus document for ${className} - ${subject}.

Extract EVERY teaching item following the exact hierarchy in the document.

SYLLABUS STRUCTURE:
- Units (e.g. "Chemical Substances - Nature and Behaviour") contain chapters
- Chapters (e.g. "Chemical Reactions and Equations") contain topics
- Topics are the specific items listed under each chapter
- Practicals are a separate section with numbered experiments
- Teacher Notes are at the end

Return ONLY a raw JSON array. No markdown, no explanation, no code fences.

Each object must have these 6 fields:
- "unit": unit name without number prefix (e.g. "Chemical Substances - Nature and Behaviour"). Use "Practicals" for experiments. Use "Teacher Notes" for teacher instructions.
- "chapter": chapter name within the unit (e.g. "Chemical Reactions and Equations"). For practicals use experiment name (e.g. "Experiment 1: pH of samples").
- "topicName": the specific topic, subtopic, or experiment task
- "plannedPeriods": integer 1-6 (practical=2, simple=2, normal=3, complex=4-5)
- "targetMonth": distribute Apr 2025 to Feb 2026 chronologically by unit order
- "assessmentType": "summative" for main topics, "formative" for topics explicitly marked as formative-only or not assessed in year-end exam, "practical" for experiments, "teacher_note" for teacher instructions

Example output:
[
  {"unit":"Chemical Substances - Nature and Behaviour","chapter":"Chemical Reactions and Equations","topicName":"Types of chemical reactions: combination, decomposition, displacement","plannedPeriods":3,"targetMonth":"Apr 2025","assessmentType":"summative"},
  {"unit":"Chemical Substances - Nature and Behaviour","chapter":"Periodic Classification of Elements","topicName":"Dobereiner Triads and Newlands Law of Octaves","plannedPeriods":2,"targetMonth":"May 2025","assessmentType":"formative"},
  {"unit":"Practicals","chapter":"Experiment 1: pH of samples","topicName":"Finding pH of dilute HCl using pH paper","plannedPeriods":2,"targetMonth":"May 2025","assessmentType":"practical"},
  {"unit":"Teacher Notes","chapter":"Notes for Teachers","topicName":"Topics not assessed in year-end examination","plannedPeriods":1,"targetMonth":"Feb 2026","assessmentType":"teacher_note"}
]

Now extract everything from the syllabus PDF:`

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 65536 }
      })
    }
  )

  const data = await res.json()

  // Check for quota/rate limit errors
  if (!res.ok) {
    const msg = data?.error?.message || ''
    if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate')) {
      throw new Error('QUOTA')
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!rawText) {
    const reason = data.candidates?.[0]?.finishReason || 'unknown'
    throw new Error(`Empty response (reason: ${reason})`)
  }

  return rawText
}

function parseTopics(rawText) {
  // Strategy 1: clean and direct parse
  const strategies = [
    () => JSON.parse(rawText.trim()),
    () => JSON.parse(rawText.replace(/```json|```/gi, '').trim()),
    () => {
      const s = rawText.indexOf('['), e = rawText.lastIndexOf(']')
      if (s < 0 || e < 0) throw new Error('no array')
      return JSON.parse(rawText.slice(s, e + 1))
    },
  ]
  for (const fn of strategies) {
    try {
      const result = fn()
      if (Array.isArray(result) && result.length > 0) return result
    } catch(e) {}
  }

  // Strategy 2: response was truncated — extract all complete {...} objects
  const clean = rawText.replace(/```json|```/gi, '').trim()
  const objects = []
  let depth = 0, start = -1
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (clean[i] === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        try {
          const obj = JSON.parse(clean.slice(start, i + 1))
          if (obj.topicName || obj.chapter) objects.push(obj)
        } catch(e) {}
        start = -1
      }
    }
  }
  if (objects.length > 0) return objects

  throw new Error(`Could not parse response. Got: "${rawText.slice(0, 150)}"`)
}

export default function SyllabusUpload() {
  const { classNames: CLASSES } = useClasses()
  const [uploads, setUploads] = useState([])
  const [classes, setClasses] = useState([])
  const [selectedClass, setSelectedClass] = useState('Class 9')
  const [selectedSubject, setSelectedSubject] = useState('Science')
  const [file, setFile] = useState(null)
  const [step, setStep] = useState('upload')
  const [editingTopics, setEditingTopics] = useState([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [savedCount, setSavedCount] = useState(0)
  const [modelUsed, setModelUsed] = useState('')
  const fileRef = useRef()

  async function loadUploads() {
    try {
      const snap = await getDocs(collection(db, 'syllabusDocuments'))
      setUploads(snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => (b.uploadedAt?.seconds||0)-(a.uploadedAt?.seconds||0)))
    } catch(e) {}
  }

  useEffect(() => {
    loadUploads()
    getDocs(collection(db, 'classes')).then(snap => setClasses(snap.docs.map(d => ({ id:d.id, ...d.data() })))).catch(()=>{})
  }, [])

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.type !== 'application/pdf') { setError('Please upload a PDF file.'); return }
    if (f.size > 25 * 1024 * 1024) { setError('File too large. Max 25MB.'); return }
    setFile(f); setError(''); setStep('upload'); setEditingTopics([])
    e.target.value = ''
  }

  async function handleExtract() {
    if (!file || !GEMINI_KEY) {
      setError('Gemini API key not set. Add VITE_GEMINI_API_KEY to .env.production and rebuild.')
      return
    }
    setStep('extracting'); setError('')
    setProgress('Converting PDF…')

    try {
      const base64 = await fileToBase64(file)
      let rawText = null
      let successModel = ''

      // Try each model until one works
      const modelErrors = []
      for (const model of GEMINI_MODELS) {
        try {
          setProgress(`Trying ${model}…`)
          rawText = await callGemini(base64, 'application/pdf', selectedClass, selectedSubject, model)
          successModel = model
          break
        } catch(e) {
          const errMsg = e.message || 'unknown error'
          modelErrors.push(`${model}: ${errMsg}`)
          setProgress(`${model} failed — ${errMsg.slice(0,60)}`)
          await new Promise(r => setTimeout(r, 500))
          continue
        }
      }

      if (!rawText) {
        throw new Error('All models failed:\n' + modelErrors.join('\n'))
      }

      setProgress(`Parsing response from ${successModel}…`)
      setModelUsed(successModel)

      const topics = parseTopics(rawText)

      // Sanitise and add UI fields
      const clean = topics.map((t, i) => ({
        id: i,
        unit: String(t.unit || t.Unit || 'General').trim(),
        chapter: String(t.chapter || t.Chapter || '').trim(),
        topicName: String(t.topicName || t.topic || t.name || t.title || '').trim(),
        plannedPeriods: Math.max(1, Math.min(8, parseInt(t.plannedPeriods || t.periods || 3) || 3)),
        targetMonth: String(t.targetMonth || t.month || 'Apr 2025').trim(),
        assessmentType: String(t.assessmentType || 'summative').trim(),
        selected: true
      })).filter(t => t.topicName && t.chapter)

      if (clean.length === 0) throw new Error('No valid topics found in PDF. Make sure it is a CBSE syllabus document.')

      setEditingTopics(clean)
      setStep('preview')
      setProgress('')

    } catch(e) {
      setError(e.message)
      setStep('upload')
      setProgress('')
    }
  }

  function updateTopic(idx, field, value) {
    setEditingTopics(prev => prev.map((t,i) => i===idx ? {...t,[field]:value} : t))
  }
  function toggleTopic(idx) {
    setEditingTopics(prev => prev.map((t,i) => i===idx ? {...t,selected:!t.selected} : t))
  }
  function toggleAll(val) {
    setEditingTopics(prev => prev.map(t => ({...t,selected:val})))
  }
  function addTopic() {
    setEditingTopics(prev => [...prev, {id:Date.now(),chapter:'',topicName:'',plannedPeriods:3,targetMonth:'Apr 2025',selected:true}])
  }
  function removeTopic(idx) {
    setEditingTopics(prev => prev.filter((_,i) => i!==idx))
  }

  async function handleSave() {
    const toSave = editingTopics.filter(t => t.selected && t.topicName?.trim() && t.chapter?.trim())
    if (toSave.length === 0) { setError('No topics selected to save.'); return }
    setStep('saving'); setError('')
    setProgress(`Saving ${toSave.length} topics to Firestore…`)
    try {
      const classDoc = classes.find(c => c.className === selectedClass)
      const classId = classDoc?.id || ''
      for (const topic of toSave) {
        await addDoc(collection(db, 'syllabus'), {
          classId, className: selectedClass, subject: selectedSubject,
          unit: topic.unit || 'General',
          chapter: topic.chapter.trim(), topicName: topic.topicName.trim(),
          plannedPeriods: Number(topic.plannedPeriods) || 3,
          targetMonth: topic.targetMonth || 'Apr 2025',
          assessmentType: topic.assessmentType || 'summative',
          sourceDocUrl: '', createdAt: Timestamp.now()
        })
      }
      await addDoc(collection(db, 'syllabusDocuments'), {
        className: selectedClass, subject: selectedSubject,
        fileName: file.name, fileSize: file.size, pdfUrl: '',
        topicsExtracted: toSave.length, modelUsed,
        uploadedAt: Timestamp.now()
      })
      setSavedCount(toSave.length)
      setStep('done')
      setProgress('')
      loadUploads()
    } catch(e) {
      setError(`Save failed: ${e.message}`)
      setStep('preview')
      setProgress('')
    }
  }

  async function handleExtractMore() {
    if (!file || !GEMINI_KEY) return
    setStep('extracting'); setError('')
    setProgress('Looking for missed topics…')
    try {
      const base64 = await fileToBase64(file)
      const alreadyExtracted = editingTopics.filter(t => t.selected).map(t => t.topicName).join(', ')

      let rawText = null
      let successModel = ''
      const modelErrors = []

      for (const model of GEMINI_MODELS) {
        try {
          setProgress(`Trying ${model} for remaining topics…`)
          const prompt = `This is a CBSE syllabus PDF for ${selectedClass} - ${selectedSubject}.
The following topics have ALREADY been extracted:
${alreadyExtracted}

Your task: Find ONLY the topics that are in the PDF but NOT in the list above.
Return ONLY a JSON array of the MISSING topics. No explanation, no markdown.
Format: [{"chapter":"...","topicName":"...","plannedPeriods":3,"targetMonth":"Apr 2025"}]
If no topics are missing, return an empty array: []`

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { inline_data: { mime_type: 'application/pdf', data: base64 } },
                    { text: prompt }
                  ]
                }],
                generationConfig: { temperature: 0, maxOutputTokens: 65536 }
              })
            }
          )
          const data = await res.json()
          if (!res.ok) {
            const msg = data?.error?.message || ''
            if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate')) throw new Error('QUOTA')
            throw new Error(msg || `HTTP ${res.status}`)
          }
          rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
          successModel = model
          break
        } catch(e) {
          modelErrors.push(`${model}: ${e.message}`)
          continue
        }
      }

      if (!rawText) throw new Error('All models failed:\n' + modelErrors.join('\n'))

      const newTopics = parseTopics(rawText)
      if (newTopics.length === 0) {
        setError('No additional topics found — the syllabus appears complete.')
        setStep('preview')
        setProgress('')
        return
      }

      // Append new topics to existing list
      const withIds = newTopics.map((t, i) => ({
        ...t,
        id: Date.now() + i,
        chapter: String(t.chapter || '').trim(),
        topicName: String(t.topicName || '').trim(),
        plannedPeriods: Math.max(1, Math.min(8, parseInt(t.plannedPeriods || 3) || 3)),
        targetMonth: String(t.targetMonth || 'Apr 2025').trim(),
        selected: true
      })).filter(t => t.topicName && t.chapter)

      setEditingTopics(prev => [...prev, ...withIds])
      setModelUsed(successModel)
      setStep('preview')
      setProgress('')

    } catch(e) {
      setError(e.message)
      setStep('preview')
      setProgress('')
    }
  }

  function resetForm() {
    setFile(null); setStep('upload'); setEditingTopics([])
    setError(''); setProgress(''); setSavedCount(0); setModelUsed('')
  }

  const selectedCount = editingTopics.filter(t => t.selected).length
  const units = [...new Set(editingTopics.map(t => t.unit))]
  const chapters = [...new Set(editingTopics.map(t => t.chapter))]

  const assessmentBadge = (type) => {
    const map = {
      summative: { label:'Summative', bg:'var(--green-light)', color:'var(--green)' },
      formative: { label:'Formative only', bg:'var(--gold-light)', color:'var(--gold-dark)' },
      practical: { label:'Practical', bg:'#e6f1fb', color:'#185fa5' },
      teacher_note: { label:'Teacher note', bg:'var(--gray-100)', color:'var(--text-muted)' },
    }
    const s = map[type] || map.summative
    return <span style={{fontSize:10,padding:'2px 7px',borderRadius:8,background:s.bg,color:s.color,fontWeight:500,flexShrink:0,whiteSpace:'nowrap'}}>{s.label}</span>
  }

  return (
    <div style={{ padding:'24px 28px', maxWidth:1150 }}>
      <div className="fade-in" style={{ marginBottom:22 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Syllabus Upload</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Upload a CBSE syllabus PDF — Gemini AI reads and extracts topics accurately</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {!GEMINI_KEY && (
        <div style={{ background:'#fff8e6', border:'1px solid rgba(201,162,39,0.4)', borderRadius:'var(--radius-md)', padding:'14px 18px', marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--gold-dark)', marginBottom:6 }}>⚠ Gemini API key not configured</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.7 }}>
            1. Go to <strong>aistudio.google.com</strong> → Get API Key → Create API key<br/>
            2. Create a file <code style={{ background:'var(--gray-100)', padding:'1px 5px', borderRadius:4 }}>rka-admin/.env.production</code> with:<br/>
            <code style={{ background:'var(--gray-100)', padding:'4px 10px', borderRadius:4, display:'inline-block', marginTop:4 }}>VITE_GEMINI_API_KEY=AIza...your key</code><br/>
            3. Run <code style={{ background:'var(--gray-100)', padding:'1px 5px', borderRadius:4 }}>npm run build</code> and redeploy
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:20, alignItems:'start' }}>
        <div>
          {/* STEP 1 */}
          {(step==='upload'||step==='extracting') && (
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'24px' }}>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)', marginBottom:18 }}>Step 1 — Select class, subject and upload PDF</h2>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:18 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Class</label>
                  <select value={selectedClass} onChange={e=>{setSelectedClass(e.target.value);setSelectedSubject(SUBJECTS[e.target.value]?.[0]||'')}} style={inp}>
                    {CLASSES.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Subject</label>
                  <select value={selectedSubject} onChange={e=>setSelectedSubject(e.target.value)} style={inp}>
                    {(SUBJECTS[selectedClass]||[]).map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div onClick={()=>fileRef.current?.click()} style={{ border:`2px dashed ${file?'var(--green)':'var(--gray-200)'}`, borderRadius:'var(--radius-md)', padding:'32px 20px', textAlign:'center', cursor:'pointer', background:file?'var(--green-light)':'var(--gray-50)', marginBottom:16, transition:'all 0.2s' }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={file?'var(--green)':'var(--gray-400)'} strokeWidth="1.5" style={{display:'block',margin:'0 auto 12px'}}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                {file ? (
                  <><p style={{fontSize:14,fontWeight:600,color:'var(--green)',marginBottom:2}}>{file.name}</p><p style={{fontSize:12,color:'var(--green-mid)'}}>{(file.size/1024/1024).toFixed(1)} MB · Click to change</p></>
                ) : (
                  <><p style={{fontSize:14,fontWeight:500,color:'var(--text)',marginBottom:3}}>Click to upload CBSE syllabus PDF</p><p style={{fontSize:12,color:'var(--text-muted)'}}>Searchable PDF · Max 25MB</p></>
                )}
                <input ref={fileRef} type="file" accept=".pdf" onChange={handleFileChange} style={{display:'none'}} />
              </div>

              {error && (
                <div style={{fontSize:13,color:'var(--crimson)',background:'var(--crimson-light)',padding:'12px 16px',borderRadius:'var(--radius-sm)',marginBottom:14,lineHeight:1.6,border:'1px solid rgba(139,26,26,0.15)'}}>
                  {error}
                </div>
              )}

              {step==='extracting' ? (
                <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',background:'var(--green-light)',borderRadius:'var(--radius-md)',border:'1px solid var(--green-muted)'}}>
                  <div style={{width:20,height:20,border:'2px solid var(--green-muted)',borderTopColor:'var(--green)',borderRadius:'50%',animation:'spin 0.8s linear infinite',flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,color:'var(--green-dark)'}}>AI is reading your syllabus…</div>
                    <div style={{fontSize:12,color:'var(--green-mid)',marginTop:2}}>{progress}</div>
                  </div>
                </div>
              ) : (
                <button onClick={handleExtract} disabled={!file||!GEMINI_KEY} style={{width:'100%',padding:'13px',background:(!file||!GEMINI_KEY)?'var(--gray-200)':'var(--green)',color:(!file||!GEMINI_KEY)?'var(--gray-400)':'white',border:'none',borderRadius:'var(--radius-md)',fontSize:14,fontWeight:600,cursor:(!file||!GEMINI_KEY)?'not-allowed':'pointer',boxShadow:(!file||!GEMINI_KEY)?'none':'0 2px 8px rgba(26,74,46,0.25)'}}>
                  Extract Topics with Gemini AI
                </button>
              )}
            </div>
          )}

          {/* STEP 2 — Preview */}
          {step==='preview' && (
            <div className="fade-in">
              <div style={{background:'var(--green-light)',borderRadius:'var(--radius-md)',border:'1px solid var(--green-muted)',padding:'14px 18px',marginBottom:14}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:'var(--green-dark)'}}>✓ {editingTopics.length} topics extracted across {chapters.length} chapters</div>
                    <div style={{fontSize:12,color:'var(--green-mid)',marginTop:2}}>
                      {selectedClass} · {selectedSubject} · via {modelUsed} · {selectedCount} selected
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>toggleAll(true)} style={{padding:'5px 11px',background:'var(--green)',color:'white',border:'none',borderRadius:'var(--radius-sm)',fontSize:11,fontWeight:500,cursor:'pointer'}}>Select all</button>
                    <button onClick={()=>toggleAll(false)} style={{padding:'5px 11px',background:'var(--white)',color:'var(--text-muted)',border:'1px solid var(--gray-200)',borderRadius:'var(--radius-sm)',fontSize:11,cursor:'pointer'}}>None</button>
                    <button onClick={addTopic} style={{padding:'5px 11px',background:'var(--white)',color:'var(--green)',border:'1px solid var(--green-muted)',borderRadius:'var(--radius-sm)',fontSize:11,fontWeight:500,cursor:'pointer'}}>+ Add</button>
                    <button onClick={handleExtractMore} style={{padding:'5px 11px',background:'var(--white)',color:'var(--green)',border:'1px solid var(--green-muted)',borderRadius:'var(--radius-sm)',fontSize:11,fontWeight:500,cursor:'pointer'}}>Find missing topics</button>
                    <button onClick={resetForm} style={{padding:'5px 11px',background:'var(--white)',color:'var(--text-muted)',border:'1px solid var(--gray-200)',borderRadius:'var(--radius-sm)',fontSize:11,cursor:'pointer'}}>Start over</button>
                  </div>
                </div>
              </div>

              {error && <div style={{fontSize:13,color:'var(--crimson)',background:'var(--crimson-light)',padding:'10px 14px',borderRadius:'var(--radius-sm)',marginBottom:12,border:'1px solid rgba(139,26,26,0.15)'}}>{error}</div>}

              <div style={{display:'flex',flexDirection:'column',gap:16,marginBottom:16}}>
                {units.map(unit => {
                  const unitTopics = editingTopics.filter(t => t.unit===unit)
                  const unitSel = unitTopics.filter(t => t.selected).length
                  const unitChapters = [...new Set(unitTopics.map(t => t.chapter))]
                  return (
                    <div key={unit} style={{borderRadius:'var(--radius-lg)',overflow:'hidden',border:'1px solid var(--gray-100)'}}>
                      {/* Unit header */}
                      <div style={{padding:'10px 16px',background:'var(--green-dark)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                        <span style={{fontSize:14,fontWeight:700,color:'white',fontFamily:'var(--font-display)'}}>{unit}</span>
                        <span style={{fontSize:11,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.1)',padding:'2px 8px',borderRadius:10}}>{unitSel}/{unitTopics.length} topics</span>
                      </div>
                      {/* Chapters within unit */}
                      {unitChapters.map(chapter => {
                        const chTopics = unitTopics.filter(t => t.chapter===chapter)
                        const chSel = chTopics.filter(t => t.selected).length
                        return (
                          <div key={chapter} style={{background:'var(--white)',borderBottom:'1px solid var(--gray-100)'}}>
                            <div style={{padding:'8px 16px',background:'var(--green-light)',borderBottom:'1px solid var(--green-muted)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                              <span style={{fontSize:12,fontWeight:600,color:'var(--green-dark)'}}>{chapter}</span>
                              <span style={{fontSize:11,color:'var(--green-mid)'}}>{chSel}/{chTopics.length}</span>
                            </div>
                            <div style={{padding:'4px 12px'}}>
                              {chTopics.map(t => {
                                const idx = editingTopics.indexOf(t)
                                return (
                                  <div key={t.id||idx} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 4px',borderBottom:'1px solid var(--gray-50)',opacity:t.selected?1:0.4}}>
                                    <input type="checkbox" checked={t.selected} onChange={()=>toggleTopic(idx)} style={{width:14,height:14,accentColor:'var(--green)',flexShrink:0}}/>
                                    <input value={t.topicName} onChange={e=>updateTopic(idx,'topicName',e.target.value)} style={{...inp,flex:1,padding:'4px 8px',fontSize:12,border:'none',background:'transparent'}} onFocus={e=>{e.target.style.background='var(--gray-50)'}} onBlur={e=>{e.target.style.background='transparent'}}/>
                                    {assessmentBadge(t.assessmentType)}
                                    <input type="number" min="1" max="8" value={t.plannedPeriods} onChange={e=>updateTopic(idx,'plannedPeriods',e.target.value)} style={{...inp,width:46,padding:'4px 6px',fontSize:12,textAlign:'center'}} title="Periods"/>
                                    <select value={t.targetMonth} onChange={e=>updateTopic(idx,'targetMonth',e.target.value)} style={{...inp,width:98,padding:'4px 6px',fontSize:11}}>
                                      {MONTHS.map(m=><option key={m}>{m}</option>)}
                                    </select>
                                    <button onClick={()=>removeTopic(idx)} style={{background:'none',border:'none',color:'var(--crimson)',cursor:'pointer',fontSize:14,opacity:0.4,flexShrink:0}}>✕</button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                <span style={{fontSize:12,color:'var(--text-muted)'}}>Topic name · Periods · Month</span>
                <button onClick={handleSave} disabled={selectedCount===0} style={{padding:'12px 28px',background:selectedCount===0?'var(--gray-200)':'var(--green)',color:selectedCount===0?'var(--gray-400)':'white',border:'none',borderRadius:'var(--radius-md)',fontSize:14,fontWeight:600,cursor:selectedCount===0?'not-allowed':'pointer',boxShadow:selectedCount===0?'none':'0 2px 8px rgba(26,74,46,0.25)',whiteSpace:'nowrap'}}>
                  Save {selectedCount} Topics
                </button>
              </div>
            </div>
          )}

          {/* Saving */}
          {step==='saving' && (
            <div style={{background:'var(--white)',borderRadius:'var(--radius-lg)',border:'1px solid var(--gray-100)',padding:'48px 24px',textAlign:'center'}}>
              <div style={{width:44,height:44,border:'3px solid var(--green-muted)',borderTopColor:'var(--green)',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 18px'}}/>
              <p style={{fontSize:14,fontWeight:500,color:'var(--text)',marginBottom:4}}>Saving to Firestore…</p>
              <p style={{fontSize:12,color:'var(--text-muted)'}}>{progress}</p>
            </div>
          )}

          {/* Done */}
          {step==='done' && (
            <div style={{background:'var(--white)',borderRadius:'var(--radius-lg)',border:'1px solid var(--green-muted)',padding:'48px 24px',textAlign:'center'}}>
              <div style={{width:52,height:52,borderRadius:'50%',background:'var(--green)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 18px'}}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <p style={{fontFamily:'var(--font-display)',fontSize:20,fontWeight:600,color:'var(--green-dark)',marginBottom:6}}>{savedCount} topics saved!</p>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:22}}>{selectedClass} — {selectedSubject} syllabus is now live in Firestore.<br/>Teachers can see it immediately in My Syllabus.</p>
              <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
                <button onClick={()=>{setStep('preview')}} style={{padding:'10px 20px',background:'var(--white)',color:'var(--green)',border:'1px solid var(--green-muted)',borderRadius:'var(--radius-md)',fontSize:13,fontWeight:500,cursor:'pointer'}}>Check for missing topics</button>
                <button onClick={resetForm} style={{padding:'10px 24px',background:'var(--green)',color:'white',border:'none',borderRadius:'var(--radius-md)',fontSize:14,fontWeight:500,cursor:'pointer'}}>Upload another</button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{background:'var(--white)',borderRadius:'var(--radius-lg)',border:'1px solid var(--gray-100)',overflow:'hidden',position:'sticky',top:24}}>
          <div style={{padding:'14px 18px',background:'var(--green-light)',borderBottom:'1px solid var(--green-muted)'}}>
            <h3 style={{fontFamily:'var(--font-display)',fontSize:14,fontWeight:600,color:'var(--green-dark)'}}>Uploaded syllabi</h3>
            <p style={{fontSize:11,color:'var(--green-mid)',marginTop:1}}>{uploads.length} document{uploads.length!==1?'s':''}</p>
          </div>
          {uploads.length===0 ? (
            <div style={{padding:'28px 18px',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>No syllabi uploaded yet.</div>
          ) : (
            <div style={{maxHeight:480,overflowY:'auto'}}>
              {uploads.map(u=>(
                <div key={u.id} style={{padding:'12px 16px',borderBottom:'1px solid var(--gray-50)'}}>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:5}}>{u.fileName}</div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:4}}>
                    <span style={{fontSize:11,padding:'2px 7px',borderRadius:8,background:'var(--green-light)',color:'var(--green)',fontWeight:500}}>{u.className}</span>
                    <span style={{fontSize:11,padding:'2px 7px',borderRadius:8,background:'var(--gold-light)',color:'var(--gold-dark)',fontWeight:500}}>{u.subject}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontSize:11,color:'var(--text-muted)'}}>{u.topicsExtracted} topics</span>
                    {u.modelUsed && <span style={{fontSize:10,color:'var(--gray-400)'}}>{u.modelUsed}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
