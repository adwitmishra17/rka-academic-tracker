import React, { useState, useEffect, useMemo } from 'react'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchLabel } from '../lib/branch'
import { examApi } from '../lib/api'

/* ============================================================
   Marks Entry — office-side exam marks entry (Tracker admin).

   Mirrors the teacher PWA flow (branch → session → class → term
   → subject → paper → roster) but without teacher-assignment
   gating: the office can enter or correct ANY subject. Writes go
   through POST /api/exam/marks which stamps source='manual' —
   the sentinel the Firestore mirror never overwrites, so office
   entries always win over teacher-app resyncs.

   The paper header is editable inline (max/passing marks,
   theory-practical split) — fixes mis-seeded /100 papers without
   leaving the page.
   ============================================================ */

const inp = { padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none' }
const lbl = { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 500 }

export default function MarksEntry() {
  const { classes: classDocs } = useClasses()
  const { allowedBranches, currentBranch } = useAuth()

  const [branch, setBranch] = useState(() => currentBranch || allowedBranches[0] || 'MAIN')
  useEffect(() => { if (currentBranch) setBranch(currentBranch) }, [currentBranch])
  const [sessions, setSessions] = useState([])
  const [sessionCode, setSessionCode] = useState('')
  const [className, setClassName] = useState('')
  const [section, setSection] = useState('')
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [subjects, setSubjects] = useState([])
  const [subjectId, setSubjectId] = useState('')
  const [papers, setPapers] = useState([])
  const [paperId, setPaperId] = useState('')
  const [editPaper, setEditPaper] = useState(false)
  const [paperForm, setPaperForm] = useState(null)
  const [newPaperOpen, setNewPaperOpen] = useState(false)
  const [newPaper, setNewPaper] = useState({ paperName: '', maxMarks: 5, passingMarks: '' })
  const [rows, setRows] = useState([])            // roster merged with marks
  const [dirty, setDirty] = useState(new Set())   // studentIds changed
  const [loadingRoster, setLoadingRoster] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState('')
  const [error, setError] = useState('')

  const classNames = useMemo(
    () => [...new Set((classDocs || []).filter(c => c.branchCode === branch).map(c => c.className))],
    [classDocs, branch])

  useEffect(() => {
    examApi.sessions().then(({ sessions: s }) => {
      const codes = (s || []).filter(Boolean)
      setSessions(codes); setSessionCode(codes[0] || '2026-27')
    }).catch(() => setSessionCode('2026-27'))
  }, [])

  // terms per branch+session
  useEffect(() => {
    if (!branch || !sessionCode) return
    setTerms([]); setTermId('')
    examApi.terms(branch, sessionCode)
      .then(({ terms: t }) => {
        const list = t || []
        setTerms(list)
        if (list.length) setTermId(list[0].id)
      }).catch(e => setError(e.message))
  }, [branch, sessionCode])

  // subjects per class
  useEffect(() => {
    setSubjects([]); setSubjectId('')
    if (!branch || !sessionCode || !className) return
    examApi.subjects(branch, sessionCode, className)
      .then(({ subjects: s }) => setSubjects((s || []).filter(x => x.kind !== 'co_scholastic')))
      .catch(e => setError(e.message))
  }, [branch, sessionCode, className])

  // papers per subject+term
  useEffect(() => {
    setPapers([]); setPaperId(''); setEditPaper(false)
    if (!subjectId || !termId) return
    examApi.papers(subjectId, termId)
      .then(({ papers: p }) => {
        setPapers(p || [])
        if ((p || []).length) setPaperId(p[0].id)
      }).catch(e => setError(e.message))
  }, [subjectId, termId])

  const paper = papers.find(p => p.id === paperId) || null

  // roster + existing marks
  useEffect(() => {
    setRows([]); setDirty(new Set())
    if (!paper || !className) return
    setLoadingRoster(true)
    Promise.all([
      examApi.reportCardStudents(branch, className, section || undefined),
      examApi.paperMarks(paper.id),
    ]).then(([{ students }, { marks }]) => {
      const byStudent = new Map((marks || []).map(m => [m.student_id, m]))
      setRows((students || []).map(s => {
        const m = byStudent.get(s.id)
        return {
          studentId: s.id,
          roll: s.roll_number || '',
          name: s.full_name,
          section: s.section || '',
          marks: m?.marks_obtained == null ? '' : String(m.marks_obtained),
          theory: m?.theory_obtained == null ? '' : String(m.theory_obtained),
          practical: m?.practical_obtained == null ? '' : String(m.practical_obtained),
          isAbsent: !!m?.is_absent,
          source: m?.source || null,
        }
      }))
      setLoadingRoster(false)
    }).catch(e => { setError(e.message); setLoadingRoster(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, section, className, branch])

  const clamp = (v, max) => {
    if (v === '') return ''
    const n = Number(v)
    if (Number.isNaN(n)) return ''
    return String(Math.min(Math.max(n, 0), max > 0 ? max : Infinity))
  }

  function updRow(id, patch) {
    setRows(rs => rs.map(r => r.studentId === id ? { ...r, ...patch } : r))
    setDirty(d => new Set([...d, id]))
  }

  async function saveAll() {
    if (!paper || dirty.size === 0) return
    setSaving(true); setError('')
    try {
      const payload = rows.filter(r => dirty.has(r.studentId)).map(r => ({
        paperId: paper.id,
        studentId: r.studentId,
        isAbsent: r.isAbsent,
        ...(paper.has_practical
          ? { theoryObtained: r.theory === '' ? null : Number(r.theory), practicalObtained: r.practical === '' ? null : Number(r.practical) }
          : { marksObtained: r.marks === '' ? null : Number(r.marks) }),
      }))
      const { saved } = await examApi.saveMarks(payload)
      setDirty(new Set())
      setRows(rs => rs.map(r => payload.some(p => p.studentId === r.studentId) ? { ...r, source: 'manual' } : r))
      setSavedFlash(`✓ Saved ${saved}`)
      setTimeout(() => setSavedFlash(''), 2500)
    } catch (e) { setError('Save failed: ' + (e.message || e)) }
    setSaving(false)
  }

  async function savePaperEdit() {
    try {
      const { paper: updated } = await examApi.savePaper(paper.id, paperForm)
      setPapers(ps => ps.map(p => p.id === updated.id ? updated : p))
      setEditPaper(false)
    } catch (e) { alert('Paper save failed: ' + (e.message || e)) }
  }

  const entered = rows.filter(r => !r.isAbsent && (paper?.has_practical ? (r.theory !== '' || r.practical !== '') : r.marks !== '')).length
  const absent = rows.filter(r => r.isAbsent).length
  const sections = useMemo(() => [...new Set(rows.map(r => r.section).filter(Boolean))].sort(), [rows])

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1000 }}>
      <div className="fade-in" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 3 }}>Marks Entry</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Office-side exam marks — any subject, no teacher gating. Saved as manual entries the teacher-app sync never overwrites.</p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      {/* Pickers */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
        {allowedBranches.length > 1 && !currentBranch && (
          <div><span style={lbl}>Branch</span>
            <select value={branch} onChange={e => { setBranch(e.target.value); setClassName('') }} style={inp}>
              {allowedBranches.map(b => <option key={b} value={b}>{branchLabel(b)}</option>)}
            </select></div>
        )}
        <div><span style={lbl}>Session</span>
          <select value={sessionCode} onChange={e => setSessionCode(e.target.value)} style={inp}>
            {[...new Set([sessionCode, ...sessions])].filter(Boolean).map(s => <option key={s}>{s}</option>)}
          </select></div>
        <div><span style={lbl}>Class</span>
          <select value={className} onChange={e => setClassName(e.target.value)} style={inp}>
            <option value="">Select…</option>
            {classNames.map(c => <option key={c}>{c}</option>)}
          </select></div>
        <div><span style={lbl}>Term</span>
          <select value={termId} onChange={e => setTermId(e.target.value)} style={inp}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.name || t.label}</option>)}
          </select></div>
        <div><span style={lbl}>Subject</span>
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)} style={{ ...inp, minWidth: 170 }}>
            <option value="">Select…</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
          </select></div>
        {papers.length > 1 && (
          <div><span style={lbl}>Paper</span>
            <select value={paperId} onChange={e => setPaperId(e.target.value)} style={inp}>
              {papers.map(p => <option key={p.id} value={p.id}>{p.paper_name}</option>)}
            </select></div>
        )}
        {sections.length > 1 && (
          <div><span style={lbl}>Section</span>
            <select value={section} onChange={e => setSection(e.target.value)} style={inp}>
              <option value="">All</option>
              {sections.map(s => <option key={s}>{s}</option>)}
            </select></div>
        )}
      </div>

      {error && <div style={{ color: 'var(--crimson)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {subjectId && termId && papers.length === 0 && (
        <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-md)', padding: '14px 16px', fontSize: 13, color: 'var(--gold-dark)', marginBottom: 12 }}>
          No paper exists for this subject in this term yet — create one below.
        </div>
      )}

      {/* New paper — extra assessments (Portfolio /5, Notebook /5) live as
          small papers beside the Main exam; the card build reads them as
          IA components. */}
      {subjectId && termId && (
        <div style={{ marginBottom: 14 }}>
          {!newPaperOpen ? (
            <button onClick={() => { setNewPaperOpen(true); setNewPaper({ paperName: '', maxMarks: 5, passingMarks: '' }) }}
              style={{ padding: '7px 14px', background: 'var(--white)', color: 'var(--green-dark)', border: '1px dashed var(--green-muted)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, cursor: 'pointer' }}>
              ＋ New paper (Portfolio, Notebook…)
            </button>
          ) : (
            <div style={{ background: 'var(--white)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-md)', padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <span style={lbl}>Paper name</span>
                <input value={newPaper.paperName} onChange={e => setNewPaper(f => ({ ...f, paperName: e.target.value }))} placeholder="e.g. Portfolio" style={{ ...inp, width: 160 }} />
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  {['Portfolio', 'Notebook', 'Sub. Enrichment'].map(n => (
                    <button key={n} onClick={() => setNewPaper(f => ({ ...f, paperName: n, maxMarks: 5 }))}
                      style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 9, background: 'var(--green-light)', color: 'var(--green-dark)', border: '1px solid var(--green-muted)', cursor: 'pointer' }}>{n}</button>
                  ))}
                </div>
              </div>
              <div><span style={lbl}>Max marks</span><input type="number" value={newPaper.maxMarks} onChange={e => setNewPaper(f => ({ ...f, maxMarks: e.target.value }))} style={{ ...inp, width: 80 }} /></div>
              <div><span style={lbl}>Pass (opt.)</span><input type="number" value={newPaper.passingMarks} onChange={e => setNewPaper(f => ({ ...f, passingMarks: e.target.value }))} style={{ ...inp, width: 80 }} /></div>
              <button onClick={async () => {
                try {
                  const { paper: created } = await examApi.createPaper({ subjectId, termId, paperName: newPaper.paperName, maxMarks: Number(newPaper.maxMarks), passingMarks: newPaper.passingMarks })
                  setPapers(ps => [...ps, created]); setPaperId(created.id); setNewPaperOpen(false)
                } catch (e) { alert(e.message || e) }
              }} disabled={!newPaper.paperName.trim() || !(Number(newPaper.maxMarks) > 0)}
                style={{ padding: '8px 16px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                Create paper
              </button>
              <button onClick={() => setNewPaperOpen(false)} style={{ padding: '8px 12px', background: 'var(--white)', color: 'var(--text-muted)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Paper header + inline editor */}
      {paper && (
        <div style={{ background: 'var(--green-light)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--green-dark)' }}>
              {subjects.find(s => s.id === subjectId)?.subject_name} · {paper.paper_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--green-mid)' }}>
              {paper.has_practical
                ? <>Theory /{Number(paper.theory_max)} + Practical /{Number(paper.practical_max)} = <b>/{Number(paper.max_marks)}</b></>
                : <>Max <b>/{Number(paper.max_marks)}</b></>}
              {paper.passing_marks != null && <> · pass {Number(paper.passing_marks)}</>}
              {paper.exam_date && <> · {paper.exam_date}</>}
            </div>
            <button onClick={() => { setEditPaper(o => !o); setPaperForm({ maxMarks: Number(paper.max_marks), passingMarks: paper.passing_marks == null ? '' : Number(paper.passing_marks), hasPractical: !!paper.has_practical, theoryMax: paper.theory_max == null ? '' : Number(paper.theory_max), practicalMax: paper.practical_max == null ? '' : Number(paper.practical_max), examDate: paper.exam_date || '' }) }}
              style={{ marginLeft: 'auto', padding: '5px 12px', background: 'var(--white)', color: 'var(--green-dark)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer' }}>
              {editPaper ? 'Close' : 'Edit paper'}
            </button>
          </div>
          {editPaper && paperForm && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--green-muted)' }}>
              <label style={{ fontSize: 11.5, color: 'var(--green-dark)' }}>
                <input type="checkbox" checked={paperForm.hasPractical} onChange={e => setPaperForm(f => ({ ...f, hasPractical: e.target.checked }))} style={{ marginRight: 5 }} />
                Theory/Practical split
              </label>
              {paperForm.hasPractical ? (<>
                <div><span style={lbl}>Theory max</span><input type="number" value={paperForm.theoryMax} onChange={e => setPaperForm(f => ({ ...f, theoryMax: e.target.value }))} style={{ ...inp, width: 80 }} /></div>
                <div><span style={lbl}>Practical max</span><input type="number" value={paperForm.practicalMax} onChange={e => setPaperForm(f => ({ ...f, practicalMax: e.target.value }))} style={{ ...inp, width: 80 }} /></div>
              </>) : (
                <div><span style={lbl}>Max marks</span><input type="number" value={paperForm.maxMarks} onChange={e => setPaperForm(f => ({ ...f, maxMarks: e.target.value }))} style={{ ...inp, width: 80 }} /></div>
              )}
              <div><span style={lbl}>Pass marks</span><input type="number" value={paperForm.passingMarks} onChange={e => setPaperForm(f => ({ ...f, passingMarks: e.target.value }))} style={{ ...inp, width: 80 }} /></div>
              <div><span style={lbl}>Exam date</span><input type="date" value={paperForm.examDate} onChange={e => setPaperForm(f => ({ ...f, examDate: e.target.value }))} style={inp} /></div>
              <button onClick={savePaperEdit} style={{ padding: '8px 16px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Save paper</button>
            </div>
          )}
        </div>
      )}

      {/* Roster */}
      {paper && (loadingRoster ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div style={{ width: 26, height: 26, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No active students for this class{section ? ` · section ${section}` : ''}.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <span>{rows.length} students</span>
            <span style={{ color: 'var(--green)' }}>{entered} entered</span>
            <span style={{ color: 'var(--crimson)' }}>{absent} absent</span>
            <span>{rows.length - entered - absent} blank</span>
          </div>
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, padding: '9px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <span style={{ width: 44 }}>Roll</span>
              <span style={{ flex: 1 }}>Student</span>
              {paper.has_practical ? (<>
                <span style={{ width: 90, textAlign: 'center' }}>Theory /{Number(paper.theory_max)}</span>
                <span style={{ width: 90, textAlign: 'center' }}>Prac /{Number(paper.practical_max)}</span>
              </>) : (
                <span style={{ width: 100, textAlign: 'center' }}>Marks /{Number(paper.max_marks)}</span>
              )}
              <span style={{ width: 64, textAlign: 'center' }}>Absent</span>
              <span style={{ width: 70, textAlign: 'right' }}>Source</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.studentId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 16px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--gray-50)', background: r.isAbsent ? 'var(--crimson-light)' : dirty.has(r.studentId) ? 'var(--gold-light)' : 'var(--white)' }}>
                <span style={{ width: 44, fontSize: 12, color: 'var(--text-muted)' }}>{r.roll}</span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{sections.length > 1 && !section && r.section ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {r.section}</span> : null}</span>
                {paper.has_practical ? (<>
                  <input type="number" disabled={r.isAbsent} value={r.isAbsent ? '' : r.theory} onChange={e => updRow(r.studentId, { theory: clamp(e.target.value, Number(paper.theory_max)) })} style={{ ...inp, width: 90, textAlign: 'center', padding: '6px 8px' }} />
                  <input type="number" disabled={r.isAbsent} value={r.isAbsent ? '' : r.practical} onChange={e => updRow(r.studentId, { practical: clamp(e.target.value, Number(paper.practical_max)) })} style={{ ...inp, width: 90, textAlign: 'center', padding: '6px 8px' }} />
                </>) : (
                  <input type="number" disabled={r.isAbsent} value={r.isAbsent ? '' : r.marks} onChange={e => updRow(r.studentId, { marks: clamp(e.target.value, Number(paper.max_marks)) })} style={{ ...inp, width: 100, textAlign: 'center', padding: '6px 8px' }} />
                )}
                <span style={{ width: 64, textAlign: 'center' }}>
                  <input type="checkbox" checked={r.isAbsent} onChange={e => updRow(r.studentId, { isAbsent: e.target.checked })} style={{ accentColor: 'var(--crimson)' }} />
                </span>
                <span style={{ width: 70, textAlign: 'right', fontSize: 10.5, color: r.source === 'manual' ? 'var(--gold-dark)' : 'var(--text-muted)' }}>
                  {r.source === 'manual' ? 'manual' : r.source ? 'teacher' : '—'}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={saveAll} disabled={saving || dirty.size === 0}
              style={{ padding: '12px 26px', background: (saving || dirty.size === 0) ? 'var(--gray-200)' : 'var(--green)', color: (saving || dirty.size === 0) ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: (saving || dirty.size === 0) ? 'default' : 'pointer', boxShadow: (saving || dirty.size === 0) ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
              {saving ? 'Saving…' : `Save ${dirty.size} change${dirty.size === 1 ? '' : 's'}`}
            </button>
            {savedFlash && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>{savedFlash}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>Only changed rows are saved · entries are marked <b>manual</b> (teacher-app sync never overwrites them)</span>
          </div>
        </>
      ))}
    </div>
  )
}
