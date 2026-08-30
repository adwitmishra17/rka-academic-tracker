import React, { useState, useEffect, useMemo } from 'react'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchLabel } from '../lib/branch'
import { examApi, cardEntriesApi, reportTemplateApi } from '../lib/api'

/* ============================================================
   Card Entries — Phase 2 of the report-card rework.

   Everything on the printed card that is NOT subject marks:
   · co-scholastic areas (A–C for I–VIII, A–E for IX–X)
   · graded subjects (Art & Activity, Conversation — A scale)
   · discipline (per term)
   · class-teacher remarks (per term)
   · achievement / height / weight (session-level)

   Grades land in exam_coscholastic_grades (source='manual');
   the rest in report_card_student_meta. Scales come from the
   class's report-card template.
   ============================================================ */

const inp = { padding: '7px 9px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none' }
const lbl = { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 500 }

export default function CardEntries() {
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
  const [templates, setTemplates] = useState([])
  const [classMap, setClassMap] = useState({})
  const [areas, setAreas] = useState([])
  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')
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
    if (!sessionCode) return
    reportTemplateApi.list(sessionCode)
      .then(({ templates: t, classMap: m }) => { setTemplates(t || []); setClassMap(m || {}) })
      .catch(() => {})
  }, [sessionCode])

  useEffect(() => {
    if (!branch || !sessionCode) return
    setTerms([]); setTermId('')
    examApi.terms(branch, sessionCode).then(({ terms: t }) => {
      setTerms(t || [])
      if ((t || []).length) setTermId(t[0].id)
    }).catch(e => setError(e.message))
  }, [branch, sessionCode])

  // template-driven scales for this class
  const template = useMemo(() => templates.find(t => t.id === classMap[className]) || null, [templates, classMap, className])
  const def = template?.definition || {}
  const areaScale   = def.coScholastic?.scale || ['A', 'B', 'C']
  const gradedScale = def.gradedSubjects?.scale || ['A']
  const discScale   = def.discipline?.scale || areaScale

  // load pack
  useEffect(() => {
    setRows([]); setAreas([]); setDirty(new Set())
    if (!branch || !sessionCode || !className || !termId) return
    setLoading(true); setError('')
    cardEntriesApi.load(branch, sessionCode, className, termId, section || undefined)
      .then(({ students, areas: a, grades, meta }) => {
        setAreas(a || [])
        setRows((students || []).map(s => {
          const g = grades?.[s.id] || {}
          const m = meta?.[s.id] || {}
          return {
            studentId: s.id, roll: s.roll_number || '', name: s.full_name, section: s.section || '',
            grades: Object.fromEntries((a || []).map(ar => [ar.id, g[ar.id] || ''])),
            discipline: m.discipline || '', remarks: m.remarks || '',
            achievement: m.achievement || '', heightCm: m.heightCm ?? '', weightKg: m.weightKg ?? '',
          }
        }))
        setLoading(false)
      })
      .catch(e => { setError(e.message || String(e)); setLoading(false) })
  }, [branch, sessionCode, className, termId, section])

  function upd(id, patch) {
    setRows(rs => rs.map(r => r.studentId === id ? { ...r, ...patch } : r))
    setDirty(d => new Set([...d, id]))
  }

  async function saveAll() {
    if (dirty.size === 0) return
    setSaving(true); setError('')
    try {
      const dirtyRows = rows.filter(r => dirty.has(r.studentId))
      const grades = dirtyRows.flatMap(r => areas.map(a => ({ studentId: r.studentId, subjectId: a.id, grade: r.grades[a.id] || null })))
      const meta = dirtyRows.map(r => ({
        studentId: r.studentId,
        discipline: r.discipline || null, remarks: r.remarks || null,
        achievement: r.achievement || null, heightCm: r.heightCm, weightKg: r.weightKg,
      }))
      const { saved } = await cardEntriesApi.save(sessionCode, termId, grades, meta)
      setDirty(new Set())
      setFlash(`✓ Saved (${saved} records)`)
      setTimeout(() => setFlash(''), 2500)
    } catch (e) { setError('Save failed: ' + (e.message || e)) }
    setSaving(false)
  }

  const gradedAreas = areas.filter(a => a.subject_code === 'RCG')
  const coshAreas   = areas.filter(a => a.subject_code === 'RCA')
  const sections = useMemo(() => [...new Set(rows.map(r => r.section).filter(Boolean))].sort(), [rows])
  const gradeSelect = (value, scale, onChange) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, width: 52, textAlign: 'center', padding: '5px 4px' }}>
      <option value="">—</option>
      {scale.map(g => <option key={g}>{g}</option>)}
    </select>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <div className="fade-in" style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 3 }}>Card Entries</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Co-scholastic grades, discipline, remarks, achievement, height &amp; weight — everything on the card that isn't subject marks.</p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

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
        {sections.length > 1 && (
          <div><span style={lbl}>Section</span>
            <select value={section} onChange={e => setSection(e.target.value)} style={inp}>
              <option value="">All</option>
              {sections.map(s => <option key={s}>{s}</option>)}
            </select></div>
        )}
        {flash && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, marginBottom: 8 }}>{flash}</span>}
      </div>

      {error && <div style={{ color: 'var(--crimson)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {className && !loading && areas.length === 0 && rows.length > 0 && (
        <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: 12.5, color: 'var(--gold-dark)', marginBottom: 12 }}>
          No card areas configured for this class (senior classes have discipline &amp; remarks only).
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div style={{ width: 26, height: 26, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
      ) : rows.length > 0 && (
        <>
          <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={{ padding: '9px 10px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--gray-50)' }}>Student</th>
                  {gradedAreas.map(a => <th key={a.id} style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--gold-dark)', textAlign: 'center' }} title="Graded subject">{a.subject_name}</th>)}
                  {coshAreas.map(a => <th key={a.id} style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>{a.subject_name}</th>)}
                  <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>Discipline</th>
                  <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', minWidth: 200 }}>Remarks (term)</th>
                  <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', minWidth: 140 }}>Achievement</th>
                  <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>Ht (cm)</th>
                  <th style={{ padding: '9px 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>Wt (kg)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.studentId} style={{ borderTop: '1px solid var(--gray-50)', background: dirty.has(r.studentId) ? 'var(--gold-light)' : i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                    <td style={{ padding: '6px 10px', fontSize: 12.5, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'inherit' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginRight: 6 }}>{r.roll}</span>{r.name}
                    </td>
                    {gradedAreas.map(a => (
                      <td key={a.id} style={{ padding: '4px 6px', textAlign: 'center' }}>
                        {gradeSelect(r.grades[a.id], gradedScale, v => upd(r.studentId, { grades: { ...r.grades, [a.id]: v } }))}
                      </td>
                    ))}
                    {coshAreas.map(a => (
                      <td key={a.id} style={{ padding: '4px 6px', textAlign: 'center' }}>
                        {gradeSelect(r.grades[a.id], areaScale, v => upd(r.studentId, { grades: { ...r.grades, [a.id]: v } }))}
                      </td>
                    ))}
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      {gradeSelect(r.discipline, discScale, v => upd(r.studentId, { discipline: v }))}
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input value={r.remarks} onChange={e => upd(r.studentId, { remarks: e.target.value })} placeholder="—" style={{ ...inp, width: '100%', minWidth: 190 }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input value={r.achievement} onChange={e => upd(r.studentId, { achievement: e.target.value })} placeholder="—" style={{ ...inp, width: '100%', minWidth: 130 }} />
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <input type="number" value={r.heightCm} onChange={e => upd(r.studentId, { heightCm: e.target.value })} style={{ ...inp, width: 62, textAlign: 'center' }} />
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      <input type="number" value={r.weightKg} onChange={e => upd(r.studentId, { weightKg: e.target.value })} style={{ ...inp, width: 62, textAlign: 'center' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={saveAll} disabled={saving || dirty.size === 0}
              style={{ padding: '12px 26px', background: (saving || dirty.size === 0) ? 'var(--gray-200)' : 'var(--green)', color: (saving || dirty.size === 0) ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: (saving || dirty.size === 0) ? 'default' : 'pointer', boxShadow: (saving || dirty.size === 0) ? 'none' : '0 4px 14px rgba(26,74,46,0.25)' }}>
              {saving ? 'Saving…' : `Save ${dirty.size} student${dirty.size === 1 ? '' : 's'}`}
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Grades &amp; discipline are per <b>term</b> · achievement / height / weight are per <b>session</b> · scales come from the class's card template
            </span>
          </div>
        </>
      )}
    </div>
  )
}
