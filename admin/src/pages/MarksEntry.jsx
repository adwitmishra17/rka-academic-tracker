import React, { useState, useEffect, useMemo } from 'react'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchLabel } from '../lib/branch'
import { examApi } from '../lib/api'

/* ============================================================
   Marks Entry — office-side exam marks entry (Tracker admin).

   ALL of the subject-term's papers render as side-by-side
   columns (Main /80 · Portfolio /5 · Notebook /5 …) with one
   row per student and a live total — a single pass per student
   instead of switching papers.

   Cell values: a number (clamped to that paper's max) or AB
   (absent for that paper). The row's Absent checkbox is a
   shortcut that fills AB into the row's empty cells — so a
   child absent for the exam can still carry Portfolio marks.

   Writes go through POST /api/exam/marks (source='manual', the
   sentinel the teacher-app mirror never overwrites).
   ============================================================ */

const inp = { padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none' }
const lbl = { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 500 }

const isAB = (v) => String(v).trim().toUpperCase() === 'AB' || String(v).trim().toUpperCase() === 'A'
const numOrNull = (v) => (v === '' || v == null || isAB(v) ? null : Number(v))

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
  const [editingPaper, setEditingPaper] = useState(null)   // paper being edited (object)
  const [paperForm, setPaperForm] = useState(null)
  const [newPaperOpen, setNewPaperOpen] = useState(false)
  const [newPaper, setNewPaper] = useState({ paperName: '', maxMarks: 5, passingMarks: '' })
  const [rows, setRows] = useState([])                     // roster with per-paper values
  const [ptCol, setPtCol] = useState(null)                 // read-only Periodic column {label, max, by:Map}
  const [dirty, setDirty] = useState(new Set())
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

  useEffect(() => {
    if (!branch || !sessionCode) return
    setTerms([]); setTermId('')
    examApi.terms(branch, sessionCode)
      .then(({ terms: t }) => { setTerms(t || []); if ((t || []).length) setTermId(t[0].id) })
      .catch(e => setError(e.message))
  }, [branch, sessionCode])

  useEffect(() => {
    setSubjects([]); setSubjectId('')
    if (!branch || !sessionCode || !className) return
    examApi.subjects(branch, sessionCode, className)
      .then(({ subjects: s }) => setSubjects((s || []).filter(x => x.kind !== 'co_scholastic')))
      .catch(e => setError(e.message))
  }, [branch, sessionCode, className])

  useEffect(() => {
    setPapers([]); setEditingPaper(null)
    if (!subjectId || !termId) return
    examApi.papers(subjectId, termId)
      .then(({ papers: p }) => setPapers(p || []))
      .catch(e => setError(e.message))
  }, [subjectId, termId])

  // The exam term whose entered marks show read-only beside this term's
  // boxes: the card pairs Periodic Test 1 (Term 1) with Half Yearly, and
  // PT2 (Term 2) with Annual — together they make the /100.
  const ptTerm = useMemo(() => {
    const cur = terms.find(t => t.id === termId)
    if (!cur) return null
    const label = `${cur.short_code || ''} ${cur.name || ''}`.toUpperCase()
    const want = /HY|HALF/.test(label) ? /(^|\s)T1(\s|$)|TERM 1/ : (/(^|\s)AN(\s|$)|ANNUAL/.test(label) ? /(^|\s)T2(\s|$)|TERM 2/ : null)
    if (!want) return null
    return terms.find(t => t.id !== cur.id && want.test(`${t.short_code || ''} ${t.name || ''}`.toUpperCase())) || null
  }, [terms, termId])

  // ── roster + existing marks for ALL papers (+ the paired PT term, read-only) ──
  const papersKey = papers.map(p => p.id).join(',')
  useEffect(() => {
    setRows([]); setPtCol(null); setDirty(new Set())
    if (!papers.length || !className) return
    setLoadingRoster(true)
    const ptPromise = ptTerm
      ? examApi.papers(subjectId, ptTerm.id).then(async ({ papers: pp }) => {
          const sets = await Promise.all((pp || []).map(p => examApi.paperMarks(p.id).then(({ marks }) => [p, marks || []])))
          const by = new Map()
          let max = 0
          for (const [p, marks] of sets) {
            max += Number(p.max_marks || 0)
            for (const m of marks) {
              const cur = by.get(m.student_id) || { sum: 0, has: false, absent: false }
              if (m.is_absent) cur.absent = true
              else if (m.marks_obtained != null) { cur.sum += Number(m.marks_obtained); cur.has = true }
              by.set(m.student_id, cur)
            }
          }
          return (pp || []).length ? { label: ptTerm.name || 'Periodic', max, by } : null
        }).catch(() => null)
      : Promise.resolve(null)
    Promise.all([
      examApi.reportCardStudents(branch, className, section || undefined),
      ptPromise,
      ...papers.map(p => examApi.paperMarks(p.id).then(({ marks }) => [p.id, marks || []])),
    ]).then(([{ students }, pt, ...markSets]) => {
      setPtCol(pt)
      const byPaper = new Map(markSets.map(([pid, marks]) => [pid, new Map(marks.map(m => [m.student_id, m]))]))
      setRows((students || []).map(s => {
        const vals = {}, th = {}, pr = {}, sources = {}
        for (const p of papers) {
          const m = byPaper.get(p.id)?.get(s.id)
          if (p.has_practical) {
            th[p.id] = m?.is_absent ? 'AB' : (m?.theory_obtained == null ? '' : String(m.theory_obtained))
            pr[p.id] = m?.is_absent ? '' : (m?.practical_obtained == null ? '' : String(m.practical_obtained))
          } else {
            vals[p.id] = m?.is_absent ? 'AB' : (m?.marks_obtained == null ? '' : String(m.marks_obtained))
          }
          if (m?.source) sources[p.id] = m.source
        }
        return { studentId: s.id, roll: s.roll_number || '', name: s.full_name, section: s.section || '', vals, th, pr, sources }
      }))
      setLoadingRoster(false)
    }).catch(e => { setError(e.message || String(e)); setLoadingRoster(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papersKey, section, className, branch, ptTerm?.id, subjectId])

  const clampCell = (v, max) => {
    if (v === '' || isAB(v)) return isAB(v) ? 'AB' : ''
    const n = Number(v)
    if (Number.isNaN(n)) return ''
    return String(Math.min(Math.max(n, 0), max > 0 ? max : Infinity))
  }

  function upd(id, patch) {
    setRows(rs => rs.map(r => r.studentId === id ? { ...r, ...patch } : r))
    setDirty(d => new Set([...d, id]))
  }

  // Absent shortcut: fill AB into the row's EMPTY cells / clear ABs on untick.
  function rowAllAbsent(r) {
    return papers.length > 0 && papers.every(p => p.has_practical ? isAB(r.th[p.id]) : isAB(r.vals[p.id]))
  }
  function toggleAbsent(r, on) {
    const vals = { ...r.vals }, th = { ...r.th }, pr = { ...r.pr }
    for (const p of papers) {
      if (p.has_practical) {
        if (on && th[p.id] === '') th[p.id] = 'AB'
        if (!on && isAB(th[p.id])) th[p.id] = ''
      } else {
        if (on && vals[p.id] === '') vals[p.id] = 'AB'
        if (!on && isAB(vals[p.id])) vals[p.id] = ''
      }
    }
    upd(r.studentId, { vals, th, pr })
  }

  async function saveAll() {
    if (dirty.size === 0) return
    setSaving(true); setError('')
    try {
      const payload = []
      for (const r of rows.filter(r => dirty.has(r.studentId))) {
        for (const p of papers) {
          if (p.has_practical) {
            payload.push({
              paperId: p.id, studentId: r.studentId,
              isAbsent: isAB(r.th[p.id]),
              theoryObtained: numOrNull(r.th[p.id]),
              practicalObtained: numOrNull(r.pr[p.id]),
            })
          } else {
            payload.push({
              paperId: p.id, studentId: r.studentId,
              isAbsent: isAB(r.vals[p.id]),
              marksObtained: numOrNull(r.vals[p.id]),
            })
          }
        }
      }
      const { saved } = await examApi.saveMarks(payload)
      setRows(rs => rs.map(r => dirty.has(r.studentId)
        ? { ...r, sources: Object.fromEntries(papers.map(p => [p.id, 'manual'])) } : r))
      setDirty(new Set())
      setSavedFlash(`✓ Saved ${saved} entries`)
      setTimeout(() => setSavedFlash(''), 2500)
    } catch (e) { setError('Save failed: ' + (e.message || e)) }
    setSaving(false)
  }

  async function savePaperEdit() {
    try {
      const { paper: updated } = await examApi.savePaper(editingPaper.id, paperForm)
      setPapers(ps => ps.map(p => p.id === updated.id ? updated : p))
      setEditingPaper(null)
    } catch (e) { alert('Paper save failed: ' + (e.message || e)) }
  }

  const termMax = papers.reduce((s, p) => s + Number(p.max_marks || 0), 0)
  const grandMax = termMax + (ptCol?.max || 0)
  const ptOf = (r) => ptCol?.by.get(r.studentId) || null
  const rowTotal = (r) => papers.reduce((s, p) => s + (p.has_practical
    ? (numOrNull(r.th[p.id]) ?? 0) + (numOrNull(r.pr[p.id]) ?? 0)
    : (numOrNull(r.vals[p.id]) ?? 0)), 0) + (ptOf(r)?.has ? ptOf(r).sum : 0)
  const rowHasEntry = (r) => papers.some(p => p.has_practical
    ? r.th[p.id] !== '' : r.vals[p.id] !== '')
  const entered = rows.filter(r => rowHasEntry(r) && !rowAllAbsent(r)).length
  const absent = rows.filter(rowAllAbsent).length
  const sections = useMemo(() => [...new Set(rows.map(r => r.section).filter(Boolean))].sort(), [rows])
  const rowSource = (r) => {
    const ss = Object.values(r.sources)
    return ss.includes('manual') ? 'manual' : ss.length ? 'teacher' : null
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <div className="fade-in" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 3 }}>Marks Entry</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Office-side exam marks — any subject, no teacher gating. Saved as manual entries the teacher-app sync never overwrites.</p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      {/* Pickers */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
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
        {sections.length > 1 && (
          <div><span style={lbl}>Section</span>
            <select value={section} onChange={e => setSection(e.target.value)} style={inp}>
              <option value="">All</option>
              {sections.map(s => <option key={s}>{s}</option>)}
            </select></div>
        )}
      </div>

      {error && <div style={{ color: 'var(--crimson)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {/* Paper chips: every paper of the term shows as a column; edit each here */}
      {subjectId && termId && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          {papers.map(p => (
            <button key={p.id}
              onClick={() => { setEditingPaper(editingPaper?.id === p.id ? null : p); setPaperForm({ maxMarks: Number(p.max_marks), passingMarks: p.passing_marks == null ? '' : Number(p.passing_marks), hasPractical: !!p.has_practical, theoryMax: p.theory_max == null ? '' : Number(p.theory_max), practicalMax: p.practical_max == null ? '' : Number(p.practical_max), examDate: p.exam_date || '' }) }}
              style={{ padding: '7px 13px', borderRadius: 'var(--radius-md)', fontSize: 12.5, border: '1px solid ' + (editingPaper?.id === p.id ? 'var(--green)' : 'var(--green-muted)'), background: editingPaper?.id === p.id ? 'var(--green)' : 'var(--green-light)', color: editingPaper?.id === p.id ? 'white' : 'var(--green-dark)', cursor: 'pointer' }}>
              <b>{p.paper_name}</b> /{Number(p.max_marks)} ✎
            </button>
          ))}
          {!newPaperOpen ? (
            <button onClick={() => { setNewPaperOpen(true); setNewPaper({ paperName: '', maxMarks: 5, passingMarks: '' }) }}
              style={{ padding: '7px 14px', background: 'var(--white)', color: 'var(--green-dark)', border: '1px dashed var(--green-muted)', borderRadius: 'var(--radius-md)', fontSize: 12.5, cursor: 'pointer' }}>
              ＋ New paper (Portfolio, Notebook…)
            </button>
          ) : null}
        </div>
      )}

      {/* New paper form */}
      {newPaperOpen && subjectId && termId && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-md)', padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
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
              setPapers(ps => [...ps, created]); setNewPaperOpen(false)
            } catch (e) { alert(e.message || e) }
          }} disabled={!newPaper.paperName.trim() || !(Number(newPaper.maxMarks) > 0)}
            style={{ padding: '8px 16px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            Create paper
          </button>
          <button onClick={() => setNewPaperOpen(false)} style={{ padding: '8px 12px', background: 'var(--white)', color: 'var(--text-muted)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}

      {/* Paper editor */}
      {editingPaper && paperForm && (
        <div style={{ background: 'var(--green-light)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <b style={{ fontSize: 13, color: 'var(--green-dark)', marginRight: 4 }}>{editingPaper.paper_name}</b>
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
          <button onClick={() => setEditingPaper(null)} style={{ padding: '8px 12px', background: 'var(--white)', color: 'var(--text-muted)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, cursor: 'pointer' }}>Close</button>
        </div>
      )}

      {subjectId && termId && papers.length === 0 && !loadingRoster && (
        <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-md)', padding: '14px 16px', fontSize: 13, color: 'var(--gold-dark)' }}>
          No paper exists for this subject in this term yet — create one above.
        </div>
      )}

      {/* Roster grid: one column per paper */}
      {papers.length > 0 && (loadingRoster ? (
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
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 + papers.length * 110 }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={{ padding: '9px 12px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Roll · Student</th>
                  {ptCol && (
                    <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.03em', borderRight: '1px solid var(--gray-100)' }}
                        title={`Entered under ${ptCol.label} — read-only here`}>
                      Periodic<br /><span style={{ fontWeight: 500 }}>/{ptCol.max} · {ptCol.label}</span>
                    </th>
                  )}
                  {papers.map(p => (
                    <th key={p.id} style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      {p.paper_name}<br /><span style={{ fontWeight: 500 }}>{p.has_practical ? `Th /${Number(p.theory_max)} + Pr /${Number(p.practical_max)}` : `/${Number(p.max_marks)}`}</span>
                    </th>
                  ))}
                  <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--green-dark)', textAlign: 'center' }}>TOTAL<br /><span style={{ fontWeight: 500 }}>/{grandMax}</span></th>
                  <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>ABSENT</th>
                  <th style={{ padding: '9px 10px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>SOURCE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const allAbs = rowAllAbsent(r)
                  return (
                    <tr key={r.studentId} style={{ borderTop: '1px solid var(--gray-50)', background: allAbs ? 'var(--crimson-light)' : dirty.has(r.studentId) ? 'var(--gold-light)' : i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                      <td style={{ padding: '6px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 7 }}>{r.roll}</span>{r.name}
                        {sections.length > 1 && !section && r.section ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {r.section}</span> : null}
                      </td>
                      {ptCol && (() => {
                        const pt = ptOf(r)
                        return (
                          <td style={{ padding: '4px 6px', textAlign: 'center', borderRight: '1px solid var(--gray-100)', fontSize: 13, fontWeight: 600, color: pt?.has ? 'var(--text)' : pt?.absent ? 'var(--crimson)' : 'var(--gray-400)' }}>
                            {pt?.has ? pt.sum : pt?.absent ? 'AB' : '—'}
                          </td>
                        )
                      })()}
                      {papers.map(p => (
                        <td key={p.id} style={{ padding: '4px 6px', textAlign: 'center' }}>
                          {p.has_practical ? (
                            <span style={{ display: 'inline-flex', gap: 4 }}>
                              <input value={r.th[p.id]} placeholder="Th"
                                onChange={e => upd(r.studentId, { th: { ...r.th, [p.id]: clampCell(e.target.value, Number(p.theory_max)) } })}
                                style={{ ...inp, width: 52, textAlign: 'center', padding: '6px 4px', fontWeight: isAB(r.th[p.id]) ? 700 : 400, color: isAB(r.th[p.id]) ? 'var(--crimson)' : 'var(--text)' }} />
                              <input value={r.pr[p.id]} placeholder="Pr" disabled={isAB(r.th[p.id])}
                                onChange={e => upd(r.studentId, { pr: { ...r.pr, [p.id]: clampCell(e.target.value, Number(p.practical_max)) } })}
                                style={{ ...inp, width: 52, textAlign: 'center', padding: '6px 4px' }} />
                            </span>
                          ) : (
                            <input value={r.vals[p.id]}
                              onChange={e => upd(r.studentId, { vals: { ...r.vals, [p.id]: clampCell(e.target.value, Number(p.max_marks)) } })}
                              style={{ ...inp, width: 74, textAlign: 'center', padding: '6px 6px', fontWeight: isAB(r.vals[p.id]) ? 700 : 400, color: isAB(r.vals[p.id]) ? 'var(--crimson)' : 'var(--text)' }} />
                          )}
                        </td>
                      ))}
                      <td style={{ padding: '4px 6px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: rowHasEntry(r) ? 'var(--green-dark)' : 'var(--gray-400)' }}>
                        {rowHasEntry(r) && !allAbs ? rowTotal(r) : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <input type="checkbox" checked={allAbs} onChange={e => toggleAbsent(r, e.target.checked)} style={{ accentColor: 'var(--crimson)' }} title="Fills AB into the empty boxes — cells with marks are kept" />
                      </td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', fontSize: 10.5, color: rowSource(r) === 'manual' ? 'var(--gold-dark)' : 'var(--text-muted)' }}>
                        {rowSource(r) || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={saveAll} disabled={saving || dirty.size === 0}
              style={{ padding: '12px 26px', background: (saving || dirty.size === 0) ? 'var(--gray-200)' : 'var(--green)', color: (saving || dirty.size === 0) ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: (saving || dirty.size === 0) ? 'default' : 'pointer', boxShadow: (saving || dirty.size === 0) ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
              {saving ? 'Saving…' : `Save ${dirty.size} student${dirty.size === 1 ? '' : 's'}`}
            </button>
            {savedFlash && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>{savedFlash}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
              Type <b>AB</b> in a box for absent-in-that-paper · Absent ✓ fills AB into the empty boxes only · saved as <b>manual</b>
            </span>
          </div>
        </>
      ))}
    </div>
  )
}
