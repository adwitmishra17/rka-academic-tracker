import React, { useState, useEffect, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { examApi, reportTemplateApi } from '../lib/api'

/* ============================================================
   Report Card Templates — the card's single source of truth.

   A template declares exactly what appears on the printed card:
   scholastic rows per class (with marks schemes), graded-subject
   and co-scholastic rows WITH entry owners, discipline, scales,
   and footer fields. The card builder renders the template and
   nothing else — no more phantom subjects with no assessments,
   and a hard completeness gate before printing (later phases).

   Data lives in SMS Supabase (report_card_templates +
   report_card_template_classes), service-role only, edited here
   through admin/server.js.
   ============================================================ */

const FAMILY_LABEL = {
  performance_profile: 'Performance Profile (2-term marks card)',
  secondary_annual:    'Report Card (IX–X annual, IA 20 + exam 80)',
  senior_progress:     'Progress Report (XI–XII theory/practical)',
}

const inp = { padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)', background: 'var(--white)', outline: 'none' }
const chip = (bg, fg, bd) => ({ fontSize: 11.5, padding: '4px 10px', borderRadius: 12, background: bg, color: fg, border: `1px solid ${bd}`, fontWeight: 500, lineHeight: 1.4, display: 'inline-flex', alignItems: 'center', gap: 6 })
const btn = (primary) => ({ padding: '8px 16px', background: primary ? 'var(--green)' : 'var(--white)', color: primary ? 'white' : 'var(--text-muted)', border: `1px solid ${primary ? 'var(--green)' : 'var(--gray-200)'}`, borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: primary ? 600 : 400, cursor: 'pointer' })

// ── Small reusable editors ──────────────────────────────────────────────────

function ChipList({ items, onChange, placeholder = 'Add…' }) {
  const [text, setText] = useState('')
  const add = () => {
    const v = text.trim()
    if (!v || items.includes(v)) { setText(''); return }
    onChange([...items, v]); setText('')
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {items.map((s, i) => (
          <span key={s} style={chip('var(--green-light)', 'var(--green-dark)', 'var(--green-muted)')}>
            {s}
            <span style={{ display: 'inline-flex', gap: 2 }}>
              {i > 0 && <button onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }} title="Move up" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green-mid)', padding: 0, fontSize: 11 }}>↑</button>}
              <button onClick={() => onChange(items.filter(x => x !== s))} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', padding: 0, fontSize: 13, opacity: 0.7 }}>×</button>
            </span>
          </span>
        ))}
        {items.length === 0 && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>(none)</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={placeholder} style={{ ...inp, flex: 1, maxWidth: 260 }} />
        <button onClick={add} disabled={!text.trim()} style={btn(false)}>+ Add</button>
      </div>
    </div>
  )
}

function OwnerSelect({ owner, teachers, onChange }) {
  const val = owner?.type === 'teacher' ? owner.teacherId : 'classTeacher'
  return (
    <select value={val} onChange={e => {
      const v = e.target.value
      if (v === 'classTeacher') onChange({ type: 'classTeacher' })
      else {
        const t = teachers.find(t => t.id === v)
        onChange({ type: 'teacher', teacherId: v, teacherName: t?.fullName || '' })
      }
    }} style={{ ...inp, padding: '6px 8px', fontSize: 12.5 }}>
      <option value="classTeacher">Class teacher (of each class)</option>
      {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
    </select>
  )
}

// Co-scholastic rows: name + owner
function CoScholasticEditor({ rows, teachers, onChange }) {
  const [text, setText] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...chip('var(--gray-50)', 'var(--text)', 'var(--gray-200)'), minWidth: 180, justifyContent: 'space-between' }}>
            {r.name}
            <button onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', padding: 0, fontSize: 13, opacity: 0.7 }}>×</button>
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>entered by</span>
          <OwnerSelect owner={r.owner} teachers={teachers} onChange={(owner) => onChange(rows.map((x, j) => j === i ? { ...x, owner } : x))} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { onChange([...rows, { name: text.trim(), owner: { type: 'classTeacher' } }]); setText('') } }} placeholder="Add area…" style={{ ...inp, maxWidth: 220 }} />
        <button onClick={() => { if (text.trim()) { onChange([...rows, { name: text.trim(), owner: { type: 'classTeacher' } }]); setText('') } }} disabled={!text.trim()} style={btn(false)}>+ Add</button>
      </div>
    </div>
  )
}

// Secondary (IX–X) scholastic rows: subject / LoC / written / practical / additional
function SecondaryRowsEditor({ rows, onChange }) {
  const upd = (i, patch) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr>
          {['Subject', 'LoC code', 'Written MM', 'Practical MM', 'Additional (not in aggregate)', ''].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '4px 10px 6px 0', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11.5 }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: '3px 10px 3px 0' }}><input value={r.subject} onChange={e => upd(i, { subject: e.target.value })} style={{ ...inp, width: 200, padding: '6px 8px' }} /></td>
              <td style={{ padding: '3px 10px 3px 0' }}><input value={r.locCode || ''} onChange={e => upd(i, { locCode: e.target.value })} style={{ ...inp, width: 70, padding: '6px 8px' }} /></td>
              <td style={{ padding: '3px 10px 3px 0' }}><input type="number" value={r.written ?? 0} onChange={e => upd(i, { written: Number(e.target.value || 0) })} style={{ ...inp, width: 70, padding: '6px 8px' }} /></td>
              <td style={{ padding: '3px 10px 3px 0' }}><input type="number" value={r.practical ?? 0} onChange={e => upd(i, { practical: Number(e.target.value || 0) })} style={{ ...inp, width: 70, padding: '6px 8px' }} /></td>
              <td style={{ padding: '3px 10px 3px 0', textAlign: 'center' }}>
                <input type="checkbox" checked={!!r.additional} onChange={e => upd(i, { additional: e.target.checked, countsInAggregate: !e.target.checked })} />
              </td>
              <td><button onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', fontSize: 14 }}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => onChange([...rows, { subject: '', locCode: '', written: 80, practical: 0 }])} style={{ ...btn(false), marginTop: 6 }}>+ Add subject</button>
    </div>
  )
}

// Senior schemes: subject → theory/practical MM
function SchemesEditor({ schemes, onChange }) {
  const entries = Object.entries(schemes)
  const [text, setText] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {entries.map(([sub, s]) => (
          <div key={sub} style={{ ...chip('var(--gray-50)', 'var(--text)', 'var(--gray-200)'), gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{sub}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Th</span>
            <input type="number" value={s.theory} onChange={e => onChange({ ...schemes, [sub]: { ...s, theory: Number(e.target.value || 0) } })} style={{ ...inp, width: 52, padding: '3px 6px', fontSize: 12 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pr</span>
            <input type="number" value={s.practical} onChange={e => onChange({ ...schemes, [sub]: { ...s, practical: Number(e.target.value || 0) } })} style={{ ...inp, width: 52, padding: '3px 6px', fontSize: 12 }} />
            <button onClick={() => { const n = { ...schemes }; delete n[sub]; onChange(n) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', padding: 0, fontSize: 13, opacity: 0.7 }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="New subject…" style={{ ...inp, maxWidth: 220 }} />
        <button onClick={() => { const v = text.trim().toUpperCase(); if (v && !schemes[v]) { onChange({ ...schemes, [v]: { theory: 80, practical: 20 } }); setText('') } }} disabled={!text.trim()} style={btn(false)}>+ Add</button>
      </div>
    </div>
  )
}

// ── Template editor (drawer) ────────────────────────────────────────────────

function TemplateEditor({ template, teachers, onSaved, onClose }) {
  const [def, setDef] = useState(() => JSON.parse(JSON.stringify(template.definition)))
  const [name, setName] = useState(template.name)
  const [editorClass, setEditorClass] = useState(() => Object.keys(template.definition.classRows || {})[0] || '')
  const [showJson, setShowJson] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonErr, setJsonErr] = useState('')
  const [saving, setSaving] = useState(false)
  const fam = template.family

  const patch = (p) => setDef(d => ({ ...d, ...p }))

  async function save() {
    let finalDef = def
    if (showJson) {
      try { finalDef = JSON.parse(jsonText); setJsonErr('') }
      catch (e) { setJsonErr('Invalid JSON: ' + e.message); return }
    }
    setSaving(true)
    try {
      const { template: updated } = await reportTemplateApi.save(template.id, { definition: finalDef, name })
      onSaved(updated)
    } catch (e) { alert('Save failed: ' + (e.message || e)) }
    setSaving(false)
  }

  const sectionTitle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '18px 0 8px' }

  return (
    <div className="fade-in" style={{ background: 'var(--white)', border: '1px solid var(--green-muted)', borderRadius: 'var(--radius-lg)', padding: '20px 22px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...inp, fontWeight: 600, fontSize: 14, minWidth: 300 }} />
        <span style={{ ...chip('var(--gold-light)', 'var(--gold-dark)', 'rgba(201,162,39,0.3)') }}>{FAMILY_LABEL[fam]}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => {
            if (!showJson) { setJsonText(JSON.stringify(def, null, 2)); setJsonErr('') }
            else { try { setDef(JSON.parse(jsonText)); setJsonErr('') } catch (e) { setJsonErr('Invalid JSON: ' + e.message); return } }
            setShowJson(s => !s)
          }} style={btn(false)}>{showJson ? '← Form editor' : 'Advanced (JSON)'}</button>
          <button onClick={onClose} style={btn(false)}>Cancel</button>
          <button onClick={save} disabled={saving} style={btn(true)}>{saving ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>

      {showJson ? (
        <div style={{ marginTop: 14 }}>
          {jsonErr && <div style={{ color: 'var(--crimson)', fontSize: 12.5, marginBottom: 8 }}>{jsonErr}</div>}
          <textarea value={jsonText} onChange={e => setJsonText(e.target.value)} spellCheck={false}
            style={{ ...inp, width: '100%', minHeight: 420, fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }} />
        </div>
      ) : (
        <>
          {/* Scholastic rows */}
          {(fam === 'performance_profile' || fam === 'secondary_annual') && (
            <>
              <div style={sectionTitle}>Scholastic subjects
                <select value={editorClass} onChange={e => setEditorClass(e.target.value)} style={{ ...inp, marginLeft: 10, padding: '5px 8px', fontSize: 12.5, textTransform: 'none' }}>
                  {Object.keys(def.classRows || {}).map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              {fam === 'performance_profile' ? (
                <ChipList
                  items={(def.classRows?.[editorClass] || []).map(r => r.subject)}
                  onChange={(subjects) => patch({ classRows: { ...def.classRows, [editorClass]: subjects.map(s => ({ subject: s })) } })}
                  placeholder="Add subject…"
                />
              ) : (
                <SecondaryRowsEditor
                  rows={def.classRows?.[editorClass] || []}
                  onChange={(rows) => patch({ classRows: { ...def.classRows, [editorClass]: rows } })}
                />
              )}
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                {fam === 'performance_profile'
                  ? `Each subject: ${(def.components || []).map(c => `${c.label} (${c.max})`).join(' + ')} per term.`
                  : `Each subject: IA ${def.ia?.total ?? 20} (${(def.ia?.components || []).map(c => `${c.label} ${c.max}`).join(' + ')}) + Annual ${def.annualExam?.total ?? 80}. "Additional" subjects print but don't count in the aggregate.`}
              </div>
            </>
          )}

          {fam === 'senior_progress' && (
            <>
              <div style={sectionTitle}>Subject schemes (theory / practical MM per exam)</div>
              <SchemesEditor schemes={def.schemes || {}} onChange={(schemes) => patch({ schemes })} />
              <div style={sectionTitle}>Core subject order
                <select value={editorClass || Object.keys(def.coreOrder || {})[0]} onChange={e => setEditorClass(e.target.value)} style={{ ...inp, marginLeft: 10, padding: '5px 8px', fontSize: 12.5, textTransform: 'none' }}>
                  {Object.keys(def.coreOrder || {}).map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <ChipList
                items={def.coreOrder?.[editorClass] || []}
                onChange={(list) => patch({ coreOrder: { ...def.coreOrder, [editorClass]: list } })}
                placeholder="Add core subject…"
              />
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
                A student's actual rows come from their exam enrollment (stream core + electives); this sets the display order and MM splits. Interim HY card: {def.interim?.enabled ? 'enabled (rank + section highest)' : 'disabled'}.
              </div>
            </>
          )}

          {/* Graded subjects (A-scale) — performance profile only */}
          {fam === 'performance_profile' && (
            <>
              <div style={sectionTitle}>Graded subjects (A-scale, no marks)</div>
              <ChipList items={def.gradedSubjects?.rows || []} onChange={(rowsV) => patch({ gradedSubjects: { ...(def.gradedSubjects || { scale: ['A'] }), rows: rowsV } })} placeholder="Add graded subject…" />
            </>
          )}

          {/* Co-scholastic + discipline owners */}
          {def.coScholastic && (
            <>
              <div style={sectionTitle}>Co-scholastic areas ({(def.coScholastic.scale || []).join('–')} scale) &amp; who enters them</div>
              <CoScholasticEditor rows={def.coScholastic.rows || []} teachers={teachers}
                onChange={(rowsV) => patch({ coScholastic: { ...def.coScholastic, rows: rowsV } })} />
            </>
          )}
          {def.discipline && (
            <>
              <div style={sectionTitle}>Discipline</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, color: 'var(--text)' }}>Scale {(def.discipline.scale || []).join('–')} · entered by</span>
                <OwnerSelect owner={def.discipline.owner} teachers={teachers} onChange={(owner) => patch({ discipline: { ...def.discipline, owner } })} />
              </div>
            </>
          )}

          <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-muted)' }}>
            Grade scale: {(def.gradeScale?.bands || []).map(([m, g]) => `${m}+ ${g}`).join(' · ')} · floor {def.gradeScale?.floorLabel}. Use Advanced (JSON) for scales, components, footer fields and attendance windows.
          </div>
        </>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ReportCardTemplates() {
  const [sessions, setSessions] = useState([])
  const [sessionCode, setSessionCode] = useState('')
  const [templates, setTemplates] = useState([])
  const [classMap, setClassMap] = useState({})
  const [teachers, setTeachers] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    examApi.sessions()
      .then(({ sessions: s }) => {
        const codes = (s || []).map(x => (typeof x === 'string' ? x : x.sessionCode || x.session_code)).filter(Boolean)
        setSessions(codes)
        setSessionCode(codes[0] || '2026-27')
      })
      .catch(() => setSessionCode('2026-27'))
    getDocs(collection(db, 'teachers'))
      .then(snap => setTeachers(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(t => t.isActive !== false)
        .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!sessionCode) return
    setLoading(true); setError('')
    reportTemplateApi.list(sessionCode)
      .then(({ templates: t, classMap: m }) => { setTemplates(t || []); setClassMap(m || {}) })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [sessionCode])

  const tplById = useMemo(() => new Map(templates.map(t => [t.id, t])), [templates])
  const classesOf = (id) => Object.entries(classMap).filter(([, tid]) => tid === id).map(([c]) => c)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <div className="fade-in" style={{ marginBottom: 22 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 3 }}>Report Card Templates</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>The card prints exactly what the template declares — subjects, marks schemes, co-scholastic areas and who enters them.</p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Session</span>
        <select value={sessionCode} onChange={e => setSessionCode(e.target.value)} style={{ ...inp, padding: '7px 10px' }}>
          {[...new Set([sessionCode, ...sessions])].filter(Boolean).map(s => <option key={s}>{s}</option>)}
        </select>
        {error && <span style={{ color: 'var(--crimson)', fontSize: 12.5 }}>{error}</span>}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><div style={{ width: 28, height: 28, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} /></div>
      ) : templates.length === 0 ? (
        <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 'var(--radius-lg)', padding: '26px 22px', textAlign: 'center', fontSize: 13, color: 'var(--gold-dark)' }}>
          No templates for {sessionCode}. Seed them with scripts/seed_report_card_templates.mjs (SMS repo).
        </div>
      ) : (
        templates.map(t => (
          editingId === t.id ? (
            <TemplateEditor key={t.id} template={t} teachers={teachers}
              onSaved={(updated) => { setTemplates(ts => ts.map(x => x.id === updated.id ? updated : x)); setEditingId(null) }}
              onClose={() => setEditingId(null)} />
          ) : (
            <div key={t.id} className="fade-in" style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)' }}>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{FAMILY_LABEL[t.family]}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  {classesOf(t.id).map(c => <span key={c} style={chip('var(--green-light)', 'var(--green-dark)', 'var(--green-muted)')}>{c}</span>)}
                  {classesOf(t.id).length === 0 && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>no classes mapped</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <button onClick={() => setEditingId(t.id)} style={btn(true)}>Edit</button>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 6 }}>
                  {t.updated_by ? `updated by ${t.updated_by}` : ''}
                </div>
              </div>
            </div>
          )
        ))
      )}

      <div style={{ marginTop: 8, padding: '12px 16px', background: 'var(--green-light)', borderRadius: 'var(--radius-md)', border: '1px solid var(--green-muted)', fontSize: 12, color: 'var(--green-dark)', lineHeight: 1.7 }}>
        Owners set here drive the teacher-app entry queues (Phase 2) and the completeness matrix + hard print gate (Phase 3): a class's cards can't generate until every template row has data. Nursery–UKG intentionally have no template — they use HPC cards.
      </div>
    </div>
  )
}
