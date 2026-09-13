import React, { useState, useEffect } from 'react'
import { examApi, reportTemplateApi } from '../../lib/api'
import { inp, lbl, card, Btn, Note } from './ui.jsx'

/* Card areas — the non-marks side of the card: co-scholastic areas, graded
   subjects and the discipline grade, all entered by the class teacher.
   Template-wide (shared by every class bound to the template). Lives on the
   Setup stage under the class's subjects; saving re-reads the template first
   so it never clobbers rules edited elsewhere, then creates the matching
   RCA / RCG entry rows for every class on the template. */

const SCALES = { 'A, B, C': ['A', 'B', 'C'], 'A, B, C, D, E': ['A', 'B', 'C', 'D', 'E'], 'A+, A, B, C, D': ['A+', 'A', 'B', 'C', 'D'], 'A only': ['A'] }
const scaleKey = (arr) => Object.keys(SCALES).find((k) => JSON.stringify(SCALES[k]) === JSON.stringify(arr || [])) || 'A, B, C'
const rowName = (r) => (typeof r === 'string' ? r : r?.name || '')
const pick = (def) => ({ coScholastic: def?.coScholastic || null, gradedSubjects: def?.gradedSubjects || null, discipline: def?.discipline || null })

export default function CardAreasEditor({ template, sharedClasses = [], branch, sessionCode, refreshConfig, onSaved }) {
  const [def, setDef] = useState(() => JSON.parse(JSON.stringify(pick(template?.definition))))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  useEffect(() => { setDef(JSON.parse(JSON.stringify(pick(template?.definition)))); setDirty(false) }, [template?.id, template?.definition]) // eslint-disable-line

  function upd(mut) { setDef((d) => { const n = JSON.parse(JSON.stringify(d)); mut(n); return n }); setDirty(true) }
  function areaList(path) { return (def?.[path]?.rows || []).map(rowName) }
  function setAreaList(path, names) { upd((d) => { d[path] = d[path] || { scale: SCALES['A, B, C'], rows: [] }; d[path].rows = path === 'gradedSubjects' ? names : names.map((n) => ({ name: n, owner: { type: 'classTeacher' } })) }) }
  function setScale(path, key) { upd((d) => { d[path] = d[path] || { rows: [] }; d[path].scale = SCALES[key] }) }

  async function save() {
    setBusy(true); setErr('')
    try {
      const { templates } = await reportTemplateApi.list(sessionCode)          // fresh copy — merge only the three area keys
      const live = templates.find((t) => t.id === template.id)?.definition || template.definition || {}
      const next = { ...live }
      for (const k of ['coScholastic', 'gradedSubjects', 'discipline']) { if (def[k]) next[k] = def[k]; else delete next[k] }
      await reportTemplateApi.save(template.id, { definition: next })
      const areas = await examApi.syncCardAreas(branch, sessionCode, template.id).catch(() => null)
      setFlash(`Card areas saved.${areas?.created ? ` ${areas.created} entry row${areas.created === 1 ? '' : 's'} created for the class teacher.` : ''}`); setTimeout(() => setFlash(''), 5000)
      setDirty(false); await refreshConfig?.(); onSaved?.()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (!template) return null
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Card areas — graded by the class teacher</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>Everything on the card that is a grade, not a mark. Entered by the office under Marks entry → Card entries. Shared by every class on <b>{template.name}</b>{sharedClasses.length > 1 ? ` (${sharedClasses.join(', ')})` : ''}.</div>
        </div>
        {flash && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{flash}</span>}
        {dirty && <Btn onClick={() => { setDef(JSON.parse(JSON.stringify(pick(template.definition)))); setDirty(false) }} disabled={busy}>Discard</Btn>}
        <Btn kind="primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save card areas'}</Btn>
      </div>
      {err && <div style={{ padding: '8px 14px' }}><Note tone="red">{err}</Note></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 0 }}>
        {[['coScholastic', 'Co-scholastic areas', 'e.g. Activity Assessment, Music & Dance, Games & Sports'], ['gradedSubjects', 'Graded subjects', 'e.g. Art & Activity, Conversation — subjects that print a grade, not marks']].map(([path, title, hint]) => (
          <div key={path} style={{ padding: '12px 14px', borderRight: '1px solid var(--gray-100)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{title}</div>
              <select value={scaleKey(def?.[path]?.scale)} onChange={(e) => setScale(path, e.target.value)} style={{ ...inp, padding: '3px 6px', fontSize: 11.5 }} title="Grade scale">{Object.keys(SCALES).map((k) => <option key={k}>{k}</option>)}</select>
            </div>
            {areaList(path).length === 0 && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>None on this card. {hint}</div>}
            {areaList(path).map((name, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                <input value={name} onChange={(e) => { const l = areaList(path); l[i] = e.target.value.toUpperCase(); setAreaList(path, l) }} style={{ ...inp, flex: 1, fontWeight: 600 }} />
                <button onClick={() => setAreaList(path, areaList(path).filter((_, j) => j !== i))} title="Remove" style={{ border: 'none', background: 'none', color: 'var(--crimson)', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            ))}
            <Btn small onClick={() => { const n = prompt(`${title.replace(/s$/, '')} name as it prints on the card:`); if (n && n.trim()) setAreaList(path, [...areaList(path), n.trim().toUpperCase()]) }}>+ Add</Btn>
          </div>
        ))}
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Discipline</div>
          <label style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={!!def?.discipline} onChange={(e) => upd((d) => { if (e.target.checked) d.discipline = d.discipline || { scale: SCALES['A, B, C'], owner: { type: 'classTeacher' } }; else d.discipline = null })} /> Printed on the card, one grade per term
          </label>
          {def?.discipline && <div style={{ marginTop: 8 }}><span style={lbl}>Scale</span><select value={scaleKey(def.discipline.scale)} onChange={(e) => setScale('discipline', e.target.value)} style={inp}>{Object.keys(SCALES).map((k) => <option key={k}>{k}</option>)}</select></div>}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>Remarks, height, weight and promotion are always available in Card entries and print when filled.</div>
        </div>
      </div>
    </div>
  )
}
