import React, { useState, useEffect } from 'react'
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, Timestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage, auth } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'

/* ============================================================
   Syllabus PDF — upload one PDF per class + subject. Stored in
   Firebase Storage (syllabus/<class>/<subject>.pdf); a matching
   `syllabusFiles/<class>__<subject>` Firestore doc holds the
   metadata + download URL. Parents see these class-wise in the
   parent app; teachers upload their own subjects from the Teacher
   PWA. Subjects come from the canonical settings/classSubjects map
   (all classes) — NOT the old hardcoded list.
   ============================================================ */

const inp = { width: '100%', padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none' }
const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const fileKey = (className, subject) => `${sanitize(className)}__${sanitize(subject)}`
const storagePathFor = (className, subject) => `syllabus/${sanitize(className)}/${sanitize(subject)}.pdf`

export default function SyllabusFiles() {
  const { classNames: CLASSES } = useClasses()
  const [classSubjectsMap, setClassSubjectsMap] = useState({})
  const [globalSubjects, setGlobalSubjects] = useState([])
  const [files, setFiles] = useState([])
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [pdf, setPdf] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  async function loadFiles() {
    try {
      const snap = await getDocs(collection(db, 'syllabusFiles'))
      setFiles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.className).localeCompare(String(b.className)) || String(a.subject).localeCompare(String(b.subject))))
    } catch (e) { /* ignore */ }
  }

  useEffect(() => {
    loadFiles()
    getDoc(doc(db, 'settings', 'classSubjects')).then((d) => { if (d.exists() && d.data().map) setClassSubjectsMap(d.data().map) }).catch(() => {})
    getDoc(doc(db, 'settings', 'subjects')).then((d) => { if (d.exists() && Array.isArray(d.data().list)) setGlobalSubjects(d.data().list) }).catch(() => {})
  }, [])

  // Default the class once the class list loads.
  useEffect(() => { if (!selectedClass && CLASSES.length) setSelectedClass(CLASSES[0]) }, [CLASSES, selectedClass])

  // Subjects for the chosen class: canonical per-class map, else the global
  // master list (so NO class ever has an empty subject dropdown).
  const subjectsForClass = (classSubjectsMap[selectedClass]?.length ? classSubjectsMap[selectedClass] : globalSubjects)
  useEffect(() => { setSelectedSubject(subjectsForClass[0] || '') }, [selectedClass, classSubjectsMap, globalSubjects]) // eslint-disable-line

  function pickFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.type !== 'application/pdf') { setError('Please choose a PDF file.'); return }
    if (f.size > 25 * 1024 * 1024) { setError('PDF too large. Max 25 MB.'); return }
    setPdf(f); setError(''); setOk('')
  }

  async function handleUpload() {
    if (!selectedClass || !selectedSubject) { setError('Pick a class and subject.'); return }
    if (!pdf) { setError('Choose a PDF to upload.'); return }
    setBusy(true); setError(''); setOk(''); setProgress('Uploading PDF…')
    try {
      const path = storagePathFor(selectedClass, selectedSubject)
      const sref = ref(storage, path)
      await uploadBytes(sref, pdf, { contentType: 'application/pdf' })
      const url = await getDownloadURL(sref)
      setProgress('Saving…')
      await setDoc(doc(db, 'syllabusFiles', fileKey(selectedClass, selectedSubject)), {
        className: selectedClass,
        subject: selectedSubject,
        pdfUrl: url,
        storagePath: path,
        fileName: pdf.name,
        fileSize: pdf.size,
        uploadedByRole: 'admin',
        uploadedByEmail: auth.currentUser?.email || null,
        uploadedAt: Timestamp.now(),
      })
      setOk(`Uploaded ${selectedClass} · ${selectedSubject}`)
      setPdf(null); setProgress('')
      loadFiles()
    } catch (e) {
      setError(`Upload failed: ${e.message || e}`)
      setProgress('')
    } finally { setBusy(false) }
  }

  async function handleDelete(f) {
    if (!window.confirm(`Remove the syllabus PDF for ${f.className} · ${f.subject}?`)) return
    setBusy(true); setError('')
    try {
      if (f.storagePath) { try { await deleteObject(ref(storage, f.storagePath)) } catch (e) { /* file may already be gone */ } }
      await deleteDoc(doc(db, 'syllabusFiles', f.id))
      loadFiles()
    } catch (e) { setError(`Delete failed: ${e.message || e}`) } finally { setBusy(false) }
  }

  const existing = files.find((f) => f.className === selectedClass && f.subject === selectedSubject)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1050 }}>
      <div className="fade-in" style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 3 }}>Syllabus PDF</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Upload a syllabus PDF for each class &amp; subject — parents see it class-wise in the parent app.</p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
        {/* Upload card */}
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Class</label>
              <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} style={inp}>
                {CLASSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Subject</label>
              <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)} style={inp}>
                {subjectsForClass.map((s) => <option key={s}>{s}</option>)}
                {subjectsForClass.length === 0 && <option value="">No subjects configured for this class</option>}
              </select>
            </div>
          </div>

          <label style={{ display: 'block', border: `2px dashed ${pdf ? 'var(--green)' : 'var(--gray-200)'}`, borderRadius: 'var(--radius-md)', padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: pdf ? 'var(--green-light)' : 'var(--gray-50)', marginBottom: 14 }}>
            <input type="file" accept="application/pdf,.pdf" onChange={pickFile} style={{ display: 'none' }} />
            {pdf ? (
              <><p style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)', marginBottom: 2 }}>{pdf.name}</p><p style={{ fontSize: 12, color: 'var(--green-mid)' }}>{(pdf.size / 1024 / 1024).toFixed(1)} MB · click to change</p></>
            ) : (
              <><p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>Click to choose the syllabus PDF</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>PDF · max 25 MB</p></>
            )}
          </label>

          {existing && !pdf && (
            <div style={{ fontSize: 12, color: 'var(--gold-dark)', background: 'var(--gold-light)', padding: '9px 13px', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
              A syllabus already exists for {selectedClass} · {selectedSubject}. Uploading will replace it. <a href={existing.pdfUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--green)', fontWeight: 600 }}>View current</a>
            </div>
          )}
          {error && <div style={{ fontSize: 13, color: 'var(--crimson)', background: 'var(--crimson-light)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 12, border: '1px solid rgba(139,26,26,0.15)' }}>{error}</div>}
          {ok && <div style={{ fontSize: 13, color: 'var(--green)', background: 'var(--green-light)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>✓ {ok}</div>}

          <button onClick={handleUpload} disabled={busy || !pdf} style={{ width: '100%', padding: 13, background: (busy || !pdf) ? 'var(--gray-200)' : 'var(--green)', color: (busy || !pdf) ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: (busy || !pdf) ? 'not-allowed' : 'pointer' }}>
            {busy ? (progress || 'Working…') : (existing ? 'Replace syllabus PDF' : 'Upload syllabus PDF')}
          </button>
        </div>

        {/* Existing list */}
        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--gray-100)', overflow: 'hidden', position: 'sticky', top: 24 }}>
          <div style={{ padding: '14px 18px', background: 'var(--green-light)', borderBottom: '1px solid var(--green-muted)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--green-dark)' }}>Uploaded syllabi</h3>
            <p style={{ fontSize: 11, color: 'var(--green-mid)', marginTop: 1 }}>{files.length} PDF{files.length !== 1 ? 's' : ''}</p>
          </div>
          {files.length === 0 ? (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No syllabus PDFs yet.</div>
          ) : (
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              {files.map((f) => (
                <div key={f.id} style={{ padding: '11px 16px', borderBottom: '1px solid var(--gray-50)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{f.className} · {f.subject}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.fileName}{f.uploadedByRole === 'teacher' ? ' · by teacher' : ''}
                    </div>
                  </div>
                  <a href={f.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>View</a>
                  <button onClick={() => handleDelete(f)} disabled={busy} style={{ background: 'none', border: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 14, opacity: 0.5, flexShrink: 0 }} title="Remove">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
