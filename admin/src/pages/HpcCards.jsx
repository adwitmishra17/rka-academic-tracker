import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { examApi, hpcApi } from '../lib/api'
import { CLASS_NAMES } from '../lib/classes'
import { HPC_SCALES, DEFAULT_HPC_DEFINITION, domainRatingFromIndicators, slug } from '../../lib/hpcDefaults.js'

/* ============================================================
   HPC Cards — Holistic Progress Card, office-driven (2026-09-14).
     Setup   one definition per session: classes, terms, rating scale,
             domains + indicators (report_card_templates, family 'hpc')
     Entry   class grid: students × indicators, typed by the office
     Cards   assessments list · override · print
   All three read/write SMS Supabase through admin/server.js (/api/hpc/*).
   ============================================================ */

const card = { background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }
const sel = { padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:13, color:'var(--text)', background:'var(--white)', outline:'none', minWidth:130 }
const inp = { padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, color:'var(--text)', background:'var(--white)', outline:'none', width:'100%', boxSizing:'border-box' }
const th = { textAlign:'left', padding:'9px 10px', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--gray-100)' }
const td = { padding:'8px 10px', fontSize:13, borderBottom:'1px solid var(--gray-50)' }
const ghost = { padding:'5px 10px', background:'var(--white)', color:'var(--text)', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:12, cursor:'pointer' }
const primary = { padding:'7px 14px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:12.5, fontWeight:500, cursor:'pointer' }
const taStyle = { width:'100%', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit', fontSize:13, padding:'8px 10px', borderRadius:8, border:'1px solid var(--gray-200)', outline:'none' }
const lbl = { fontSize:12, color:'var(--text-muted)' }
const xBtn = { border:'none', background:'none', color:'var(--crimson)', cursor:'pointer', fontSize:12, padding:'2px 4px' }
const small = { ...ghost, padding:'3px 8px', fontSize:11.5 }

export default function HpcCards() {
  const { allowedBranches = [], currentBranch } = useAuth()
  const [tab, setTab] = useState('entry')
  const [branchCode, setBranch] = useState(currentBranch || allowedBranches[0] || '')
  const [sessions, setSessions] = useState([])
  const [sessionCode, setSession] = useState('')
  const [template, setTemplate] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { examApi.sessions().then(({ sessions }) => { setSessions(sessions); if (sessions[0]) setSession(s => s || sessions[0]) }).catch(e => setError(e.message)) }, [])
  const loadTemplate = () => { if (!sessionCode) return; hpcApi.setup(sessionCode).then(({ template }) => setTemplate(template)).catch(e => setError(e.message)) }
  useEffect(() => { setTemplate(null); loadTemplate() }, [sessionCode]) // eslint-disable-line
  const def = template?.definition || DEFAULT_HPC_DEFINITION

  return (
    <div style={{ padding:'24px 28px', maxWidth:1280 }}>
      <div className="fade-in" style={{ marginBottom:16 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>HPC Cards</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Holistic Progress Card. Set it up once per session, enter the ratings class by class, print. Office-driven — nothing is entered in the teacher app.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      <div style={{ display:'flex', alignItems:'flex-end', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ display:'inline-flex', border:'1px solid var(--gray-200)', borderRadius:99, overflow:'hidden', background:'var(--white)' }}>
          {[['setup','Setup'],['entry','Entry'],['cards','Cards']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding:'7px 16px', border:'none', fontSize:12.5, fontWeight:600, cursor:'pointer', background: tab===k ? 'var(--text)' : 'transparent', color: tab===k ? 'var(--white)' : 'var(--text-muted)' }}>{l}</button>
          ))}
        </div>
        <label style={lbl}>Branch<div><select value={branchCode} onChange={e => setBranch(e.target.value)} style={sel}>{allowedBranches.map(b => <option key={b} value={b}>{b}</option>)}</select></div></label>
        <label style={lbl}>Session<div><select value={sessionCode} onChange={e => setSession(e.target.value)} style={sel}>{sessions.length===0 && <option value="">—</option>}{sessions.map(s => <option key={s} value={s}>{s}</option>)}</select></div></label>
        {template && <span style={{ fontSize:11.5, color:'var(--text-muted)', paddingBottom:10 }}>{def.classes.length} classes · {def.domains.length} domains · {def.domains.reduce((n,d) => n + (d.indicators||[]).length, 0)} indicators · scale {def.scale?.options?.map(o => o.short).join(' / ')}</span>}
      </div>

      {error && <div style={{ background:'#fde8e8', color:'var(--crimson)', padding:'10px 14px', borderRadius:'var(--radius-md)', fontSize:13, marginBottom:16 }}>{error}</div>}

      {tab === 'setup' && template && <HpcSetup key={template.id + (template.updated_at || '')} template={template} sessionCode={sessionCode} branchCode={branchCode} onSaved={loadTemplate} />}
      {tab === 'entry' && template && <HpcEntry def={def} branchCode={branchCode} sessionCode={sessionCode} />}
      {tab === 'cards' && template && <HpcList def={def} branchCode={branchCode} sessionCode={sessionCode} />}
      {!template && sessionCode && !error && <div style={{ ...card, padding:20, color:'var(--text-muted)', fontSize:13 }}>Loading the HPC setup for {sessionCode}…</div>}
    </div>
  )
}

/* ───────────────────────── Setup ───────────────────────── */
function HpcSetup({ template, sessionCode, branchCode, onSaved }) {
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(template.definition)))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [terms, setTerms] = useState([])
  useEffect(() => { if (branchCode && sessionCode) examApi.terms(branchCode, sessionCode).then(({ terms }) => setTerms(terms || [])).catch(() => {}) }, [branchCode, sessionCode])
  const upd = (mut) => { setD(x => { const n = JSON.parse(JSON.stringify(x)); mut(n); return n }); setDirty(true) }
  const toggle = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]
  const move = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]] }
  const uniqueKey = (base, taken) => { let k = base, n = 2; while (taken.includes(k)) k = `${base}_${n++}`; return k }

  async function save() {
    setBusy(true); setErr(''); setMsg('')
    try { await hpcApi.saveSetup(sessionCode, d); setDirty(false); setMsg('HPC setup saved — every class listed uses it from now on.'); onSaved?.() } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ ...card, padding:'12px 16px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--green-dark)' }}>{template.name} · {sessionCode}</div>
          <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>One setup for the whole session, both branches. Changing it changes what the Entry grid asks for and what the card prints; ratings already entered stay under their keys.</div>
        </div>
        {msg && <span style={{ fontSize:12, color:'var(--green)', fontWeight:600 }}>{msg}</span>}
        {dirty && <button onClick={() => { setD(JSON.parse(JSON.stringify(template.definition))); setDirty(false) }} style={ghost} disabled={busy}>Discard</button>}
        <button onClick={save} disabled={!dirty || busy} style={{ ...primary, opacity: !dirty || busy ? .5 : 1 }}>{busy ? 'Saving…' : 'Save setup'}</button>
      </div>
      {err && <div style={{ background:'#fde8e8', color:'var(--crimson)', padding:'10px 14px', borderRadius:'var(--radius-md)', fontSize:13 }}>{err}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:14 }}>
        <div style={{ ...card, padding:'12px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Classes that get an HPC</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))', gap:'4px 10px' }}>
            {CLASS_NAMES.map(c => <label key={c} style={{ fontSize:12.5, display:'flex', alignItems:'center', gap:6 }}><input type="checkbox" checked={d.classes.includes(c)} onChange={() => upd(n => { n.classes = CLASS_NAMES.filter(x => toggle(n.classes, c).includes(x)) })} />{c}</label>)}
          </div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:8 }}>Nursery–UKG also get a marks card from Examinations; both can exist side by side.</div>
        </div>
        <div style={{ ...card, padding:'12px 16px' }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Terms assessed</div>
          {terms.length === 0 ? <div style={{ fontSize:12, color:'var(--text-muted)' }}>No exam terms for {branchCode} · {sessionCode} yet — seed them in Examinations → Setup.</div> :
            terms.map(t => <label key={t.id} style={{ fontSize:12.5, display:'flex', alignItems:'center', gap:6, marginBottom:4 }}><input type="checkbox" checked={(d.termCodes || []).includes(t.short_code)} onChange={() => upd(n => { n.termCodes = toggle(n.termCodes || [], t.short_code) })} />{t.name} <span style={{ color:'var(--text-muted)' }}>({t.short_code})</span></label>)}
          <div style={{ fontSize:13, fontWeight:600, margin:'14px 0 6px' }}>Rating scale</div>
          <select value={d.scale?.key || 'nep4'} onChange={e => upd(n => { n.scale = HPC_SCALES[e.target.value] })} style={{ ...sel, width:'100%' }}>{Object.values(HPC_SCALES).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:12.5, display:'flex', gap:6, alignItems:'center' }}><input type="checkbox" checked={d.domainRemarks !== false} onChange={e => upd(n => { n.domainRemarks = e.target.checked })} />A remark line under each domain (entered via Override)</label>
            <label style={{ fontSize:12.5, display:'flex', gap:6, alignItems:'center' }}><input type="checkbox" checked={d.generalRemarks !== false} onChange={e => upd(n => { n.generalRemarks = e.target.checked })} />General remarks at the foot of the card</label>
          </div>
          <div style={{ marginTop:12 }}><span style={lbl}>Card title</span><input value={d.title || ''} onChange={e => upd(n => { n.title = e.target.value.toUpperCase() })} style={inp} /></div>
        </div>
      </div>

      <div style={{ ...card, padding:0 }}>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 16px', borderBottom:'1px solid var(--gray-100)' }}>
          <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600 }}>Domains and indicators — in print order</div><div style={{ fontSize:11.5, color:'var(--text-muted)' }}>Each indicator gets one rating in the Entry grid; the domain's overall rating is the most common of its indicators.</div></div>
          <button style={small} onClick={() => { const name = prompt('Domain name as it prints on the card:'); if (!name?.trim()) return; upd(n => { n.domains.push({ key: uniqueKey(slug(name), n.domains.map(x => x.key)), name: name.trim(), indicators: [] }) }) }}>+ Domain</button>
        </div>
        {d.domains.map((dom, i) => (
          <div key={dom.key} style={{ padding:'10px 16px', borderBottom:'1px solid var(--gray-100)', display:'grid', gridTemplateColumns:'minmax(220px, 1fr) 2fr', gap:14 }}>
            <div>
              <input value={dom.name} onChange={e => upd(n => { n.domains[i].name = e.target.value })} style={{ ...inp, fontWeight:600 }} />
              <div style={{ display:'flex', gap:4, marginTop:6 }}>
                <button style={small} onClick={() => upd(n => move(n.domains, i, -1))} disabled={i === 0}>↑</button>
                <button style={small} onClick={() => upd(n => move(n.domains, i, 1))} disabled={i === d.domains.length - 1}>↓</button>
                <button style={{ ...small, color:'var(--crimson)' }} onClick={() => { if (confirm(`Remove "${dom.name}" and its ${dom.indicators.length} indicators from the card?`)) upd(n => { n.domains.splice(i, 1) }) }}>Remove domain</button>
              </div>
              <div style={{ fontSize:10.5, color:'var(--text-muted)', marginTop:4, fontFamily:'ui-monospace, monospace' }}>{dom.key}</div>
            </div>
            <div>
              {dom.indicators.map((ind, j) => (
                <div key={ind.key} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:5 }}>
                  <input value={ind.label} onChange={e => upd(n => { n.domains[i].indicators[j].label = e.target.value })} style={inp} />
                  <button style={small} onClick={() => upd(n => move(n.domains[i].indicators, j, -1))} disabled={j === 0}>↑</button>
                  <button style={small} onClick={() => upd(n => move(n.domains[i].indicators, j, 1))} disabled={j === dom.indicators.length - 1}>↓</button>
                  <button style={xBtn} onClick={() => upd(n => { n.domains[i].indicators.splice(j, 1) })} title="Remove indicator">✕</button>
                </div>
              ))}
              <button style={small} onClick={() => { const label = prompt(`New indicator under ${dom.name}:`); if (!label?.trim()) return; upd(n => { const list = n.domains[i].indicators; list.push({ key: uniqueKey(slug(label), list.map(x => x.key)), label: label.trim() }) }) }}>+ Indicator</button>
            </div>
          </div>
        ))}
        {d.domains.length === 0 && <div style={{ padding:16, fontSize:12.5, color:'var(--text-muted)' }}>No domains yet — add one.</div>}
      </div>
    </div>
  )
}

/* ───────────────────────── Entry grid ───────────────────────── */
function HpcEntry({ def, branchCode, sessionCode }) {
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [className, setClassName] = useState('')
  const [section, setSection] = useState('')
  const [data, setData] = useState(null)
  const [vals, setVals] = useState({})        // sid → { ind: { `${dom}.${ind}`: value }, general }
  const [dirty, setDirty] = useState(new Set())
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const options = def.scale?.options || []
  const assessedTerms = useMemo(() => terms.filter(t => !def.termCodes?.length || def.termCodes.includes(t.short_code)), [terms, def])

  useEffect(() => {
    setTerms([]); setTermId('')
    if (!branchCode || !sessionCode) return
    examApi.terms(branchCode, sessionCode).then(({ terms }) => { setTerms(terms || []) }).catch(e => setErr(e.message))
  }, [branchCode, sessionCode])
  useEffect(() => { if (!termId && assessedTerms[0]) setTermId(assessedTerms[0].id) }, [assessedTerms]) // eslint-disable-line
  useEffect(() => { if (!className && def.classes[0]) setClassName(def.classes[0]) }, [def]) // eslint-disable-line

  const load = () => {
    setData(null); setVals({}); setDirty(new Set())
    if (!branchCode || !sessionCode || !termId || !className) return
    setBusy('load'); setErr('')
    hpcApi.entries(branchCode, sessionCode, termId, className, section || undefined).then(d => {
      setData(d)
      const v = {}
      for (const s of d.students) {
        const ind = {}
        for (const dom of def.domains) for (const i of dom.indicators || []) ind[`${dom.key}.${i.key}`] = s.assessment?.domains?.[dom.key]?.indicators?.[i.key] || ''
        v[s.id] = { ind, general: s.assessment?.general_remarks || '' }
      }
      setVals(v)
    }).catch(e => setErr(e.message)).finally(() => setBusy(''))
  }
  useEffect(load, [branchCode, sessionCode, termId, className, section]) // eslint-disable-line

  const sections = useMemo(() => [...new Set((data?.students || []).map(s => s.section).filter(Boolean))].sort(), [data])
  const set = (sid, patch) => { setVals(v => ({ ...v, [sid]: { ...v[sid], ...patch } })); setDirty(x => new Set([...x, sid])) }
  const setInd = (sid, key, value) => { setVals(v => ({ ...v, [sid]: { ...v[sid], ind: { ...v[sid].ind, [key]: value } } })); setDirty(x => new Set([...x, sid])) }
  const fillColumn = (key, value) => { setVals(v => { const n = { ...v }; for (const s of data.students) n[s.id] = { ...n[s.id], ind: { ...n[s.id].ind, [key]: value } }; return n }); setDirty(new Set(data.students.map(s => s.id))) }
  const done = (sid) => { const v = vals[sid]; return v && Object.values(v.ind).every(Boolean) }

  async function save() {
    if (!dirty.size) return
    setBusy('save'); setErr('')
    try {
      const rows = [...dirty].map(sid => {
        const s = data.students.find(x => x.id === sid)
        const domains = JSON.parse(JSON.stringify(s?.assessment?.domains || {}))   // keep remarks entered via Override
        for (const dom of def.domains) {
          const indicators = {}
          for (const i of dom.indicators || []) { const v = vals[sid].ind[`${dom.key}.${i.key}`]; if (v) indicators[i.key] = v }
          domains[dom.key] = { ...(domains[dom.key] || {}), indicators, rating: domainRatingFromIndicators(indicators, def.scale) }
        }
        return { studentId: sid, domains, generalRemarks: vals[sid].general }
      })
      const r = await hpcApi.saveEntries(branchCode, sessionCode, termId, rows)
      setFlash(`Saved ${r.saved} student${r.saved === 1 ? '' : 's'}`); setTimeout(() => setFlash(''), 3000)
      load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }

  const cellSel = { padding:'4px 2px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:12, background:'var(--white)', color:'var(--text)', width:52, textAlign:'center' }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ ...card, padding:'12px 16px', display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
        <label style={lbl}>Term<div><select value={termId} onChange={e => setTermId(e.target.value)} style={sel}>{assessedTerms.length === 0 && <option value="">No terms</option>}{assessedTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div></label>
        <label style={lbl}>Class<div><select value={className} onChange={e => { setClassName(e.target.value); setSection('') }} style={sel}>{def.classes.map(c => <option key={c} value={c}>{c}</option>)}</select></div></label>
        {sections.length > 1 && <label style={lbl}>Section<div><select value={section} onChange={e => setSection(e.target.value)} style={sel}><option value="">All</option>{sections.map(s => <option key={s}>{s}</option>)}</select></div></label>}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
          {flash && <span style={{ fontSize:12.5, color:'var(--green)', fontWeight:600 }}>{flash}</span>}
          {data && <span style={{ fontSize:11.5, color:'var(--text-muted)' }}>{data.students.filter(s => done(s.id)).length} / {data.students.length} complete</span>}
          <button onClick={save} disabled={busy === 'save' || dirty.size === 0} style={{ ...primary, opacity: dirty.size ? 1 : .5 }}>{busy === 'save' ? 'Saving…' : `Save ${dirty.size ? dirty.size + ' student' + (dirty.size === 1 ? '' : 's') : ''}`}</button>
        </div>
      </div>
      {err && <div style={{ background:'#fde8e8', color:'var(--crimson)', padding:'10px 14px', borderRadius:'var(--radius-md)', fontSize:13 }}>{err}</div>}
      <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>One rating per indicator ({options.map(o => `${o.short} = ${o.label}`).join(', ')}). The domain's overall rating is worked out from its indicators. Use the ▾ under a column to fill it for the whole class, then change the exceptions.</div>

      {busy === 'load' && <div style={{ ...card, padding:20, color:'var(--text-muted)' }}>Loading…</div>}
      {data && (
        <div style={{ ...card, overflow:'auto' }}>
          <table style={{ borderCollapse:'collapse', minWidth:900 }}>
            <thead>
              <tr>
                <th style={{ ...th, position:'sticky', left:0, background:'var(--gray-50)', zIndex:3, minWidth:220 }} rowSpan={2}>Roll · Student</th>
                {def.domains.map(dom => <th key={dom.key} colSpan={Math.max(1, (dom.indicators || []).length)} style={{ ...th, textAlign:'center', borderLeft:'1px solid var(--gray-100)', background:'var(--gray-50)' }}>{dom.name}</th>)}
                {def.generalRemarks !== false && <th style={{ ...th, minWidth:220 }} rowSpan={2}>General remarks</th>}
              </tr>
              <tr>
                {def.domains.flatMap(dom => (dom.indicators || []).map((i, j) => {
                  const key = `${dom.key}.${i.key}`
                  return (
                    <th key={key} title={i.label} style={{ ...th, textAlign:'center', fontWeight:500, textTransform:'none', letterSpacing:0, borderLeft: j === 0 ? '1px solid var(--gray-100)' : 'none', padding:'4px 3px', verticalAlign:'bottom' }}>
                      <div style={{ fontSize:10.5, maxWidth:64, whiteSpace:'normal', lineHeight:1.2 }}>{shortLabel(i.label)}</div>
                      <select value="" onChange={e => { if (e.target.value) fillColumn(key, e.target.value) }} title="Fill this column for every student" style={{ ...cellSel, width:36, marginTop:3, padding:'1px 0', fontSize:10.5, color:'var(--text-muted)' }}><option value="">▾</option>{options.map(o => <option key={o.value} value={o.value}>{o.short}</option>)}</select>
                    </th>
                  )
                }))}
              </tr>
            </thead>
            <tbody>
              {data.students.map((s, ri) => (
                <tr key={s.id} style={{ background: ri % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                  <td style={{ ...td, position:'sticky', left:0, background:'inherit', zIndex:2, whiteSpace:'nowrap', fontWeight:500 }}>
                    <span style={{ display:'inline-block', width:6, height:6, borderRadius:3, background: done(s.id) ? 'var(--green)' : 'var(--gray-200)', marginRight:8 }} />
                    <span style={{ color:'var(--text-muted)', fontSize:11, marginRight:6 }}>{s.roll || '—'}</span>{s.name}{!section && s.section ? <span style={{ color:'var(--text-muted)', fontSize:11 }}> · {s.section}</span> : null}
                    {s.assessment?.source === 'teacher_pwa' && <span title="Originally entered in the teacher app" style={{ marginLeft:6, fontSize:10, color:'var(--text-muted)' }}>PWA</span>}
                  </td>
                  {def.domains.flatMap(dom => (dom.indicators || []).map((i, j) => {
                    const key = `${dom.key}.${i.key}`; const v = vals[s.id]?.ind[key] || ''
                    return (
                      <td key={key} style={{ ...td, padding:'3px 3px', textAlign:'center', borderLeft: j === 0 ? '1px solid var(--gray-100)' : 'none', background: dirty.has(s.id) ? 'var(--gold-light)' : 'transparent' }}>
                        <select value={v} onChange={e => setInd(s.id, key, e.target.value)} style={{ ...cellSel, color: v ? (options.find(o => o.value === v)?.color || 'var(--text)') : 'var(--text-muted)', fontWeight: v ? 700 : 400 }}>
                          <option value="">–</option>{options.map(o => <option key={o.value} value={o.value}>{o.short}</option>)}
                        </select>
                      </td>
                    )
                  }))}
                  {def.generalRemarks !== false && <td style={{ ...td, padding:'3px 6px' }}><input value={vals[s.id]?.general || ''} onChange={e => set(s.id, { general: e.target.value })} placeholder="—" style={{ ...inp, minWidth:200 }} /></td>}
                </tr>
              ))}
              {data.students.length === 0 && <tr><td style={{ ...td, color:'var(--text-muted)', padding:22 }} colSpan={99}>No students in {className}{section ? ' - ' + section : ''} on {branchCode}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
function shortLabel(s) { const t = String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); return t.length > 26 ? t.slice(0, 24) + '…' : t }

/* ───────────────────────── Cards list · override · print ───────────────────────── */
function HpcList({ def, branchCode, sessionCode }) {
  const navigate = useNavigate()
  const { isSuperAdmin } = useAuth()
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [className, setClassName] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ domains:{}, general_remarks:'' })
  const [saving, setSaving] = useState(false)
  const options = def.scale?.options || []

  useEffect(() => {
    setTerms([]); setTermId('')
    if (!branchCode || !sessionCode) return
    examApi.terms(branchCode, sessionCode).then(({ terms }) => { setTerms(terms); if (terms[0]) setTermId(terms[0].id) }).catch(e => setError(e.message))
  }, [branchCode, sessionCode])

  function load() {
    setRows([])
    if (!branchCode || !termId || !className) return
    setLoading(true); setError(null)
    hpcApi.list(branchCode, termId, className).then(({ assessments }) => setRows(assessments)).catch(e => setError(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [branchCode, termId, className]) // eslint-disable-line

  function openEdit(row) {
    const base = {}
    for (const d of def.domains) { const ex = row.domains?.[d.key] || {}; base[d.key] = { rating: ex.rating || '', remarks: ex.remarks || '' } }
    setDraft({ domains: base, general_remarks: row.general_remarks || '' })
    setEditing(row)
  }
  function setDomainField(key, field, value) { setDraft(prev => ({ ...prev, domains: { ...prev.domains, [key]: { ...prev.domains[key], [field]: value } } })) }
  async function saveOverride() {
    setSaving(true); setError(null)
    try {
      const merged = { ...(editing.domains || {}) }
      for (const d of def.domains) {
        const dr = draft.domains[d.key] || {}
        merged[d.key] = { ...(editing.domains?.[d.key] || {}), rating: dr.rating || null, remarks: dr.remarks?.trim() ? dr.remarks.trim() : null }
      }
      await hpcApi.override(editing.id, merged, draft.general_remarks)
      setEditing(null); load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  async function handleVoid(row) {
    const reason = window.prompt(`Void HPC for ${row.student_name}? Reason:`)
    if (!reason?.trim()) return
    try { await hpcApi.void(row.id, reason.trim()); load() } catch (e) { setError(e.message) }
  }

  return (
    <div>
      <div style={{ ...card, padding:'14px 16px', marginBottom:16, display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
        <label style={lbl}>Term<div><select value={termId} onChange={e => setTermId(e.target.value)} style={sel}><option value="">{terms.length?'Pick a term':'No terms'}</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div></label>
        <label style={lbl}>Class<div><select value={className} onChange={e => setClassName(e.target.value)} style={sel}><option value="">Pick a class</option>{def.classes.map(c => <option key={c} value={c}>{c}</option>)}</select></div></label>
        {rows.length > 0 && <button onClick={() => navigate(`/hpc/print?ids=${rows.map(r => r.id).join(',')}`)} style={{ ...ghost, marginLeft:'auto' }}>Print all {rows.length}</button>}
      </div>
      {error && <div style={{ background:'#fde8e8', color:'var(--crimson)', padding:'10px 14px', borderRadius:'var(--radius-md)', fontSize:13, marginBottom:16 }}>{error}</div>}
      <div style={card}>
        <div style={{ padding:'10px 14px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', fontSize:12, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Assessments {rows.length ? `(${rows.length})` : ''}</div>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr><th style={th}>Student</th><th style={th}>Adm</th><th style={th}>Sec</th><th style={th}>Roll</th><th style={th}>Rated</th><th style={th}>Source</th><th style={{ ...th, textAlign:'right' }}></th></tr></thead>
          <tbody>
            {!loading && !className && <tr><td style={{ ...td, color:'var(--text-muted)', textAlign:'center', padding:22 }} colSpan={7}>Pick a term &amp; class to list assessments.</td></tr>}
            {loading && <tr><td style={{ ...td, color:'var(--text-muted)', textAlign:'center', padding:22 }} colSpan={7}>Loading…</td></tr>}
            {!loading && className && rows.length===0 && <tr><td style={{ ...td, color:'var(--text-muted)', textAlign:'center', padding:22 }} colSpan={7}>Nothing entered yet for this term — use the Entry tab.</td></tr>}
            {rows.map(r => {
              const total = def.domains.reduce((n, d) => n + (d.indicators||[]).length, 0)
              const rated = def.domains.reduce((n, d) => n + (d.indicators||[]).filter(i => r.domains?.[d.key]?.indicators?.[i.key]).length, 0)
              return (
                <tr key={r.id}>
                  <td style={{ ...td, fontWeight:500 }}>{r.student_name}</td>
                  <td style={{ ...td, color:'var(--text-muted)' }}>{r.admission_no || '—'}</td>
                  <td style={{ ...td, color:'var(--text-muted)' }}>{r.section || '—'}</td>
                  <td style={{ ...td, color:'var(--text-muted)' }}>{r.roll_number || '—'}</td>
                  <td style={{ ...td, color: rated === total ? 'var(--green)' : 'var(--gold-dark)', fontWeight:600 }}>{rated} / {total}</td>
                  <td style={td}><span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:999, background:'rgba(52,199,89,0.12)', color:'#0a7d3a' }}>{r.source === 'teacher_pwa' ? 'Teacher app (old)' : 'Office'}</span></td>
                  <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                    <button onClick={() => openEdit(r)} style={ghost} title="Overall domain rating + domain remarks">Remarks</button>{' '}
                    <button onClick={() => navigate(`/hpc/print?ids=${r.id}`)} style={ghost}>Print</button>
                    {isSuperAdmin && <>{' '}<button onClick={() => handleVoid(r)} style={{ ...ghost, color:'var(--crimson)', borderColor:'rgba(139,26,26,0.3)' }}>Void</button></>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={() => !saving && setEditing(null)}>
          <div style={{ background:'var(--white)', borderRadius:14, padding:20, width:'min(640px,100%)', maxHeight:'86vh', overflowY:'auto', border:'1px solid var(--gray-100)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--green-dark)', marginBottom:4 }}>{editing.student_name} — domain ratings &amp; remarks</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>The overall rating is normally worked out from the indicators; set it here only to override. Indicator ratings are edited in the Entry tab.</div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {def.domains.map(d => (
                <div key={d.key} style={{ borderBottom:'1px solid var(--gray-100)', paddingBottom:10 }}>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>{d.name}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:8, alignItems:'start' }}>
                    <select value={draft.domains[d.key]?.rating || ''} onChange={e => setDomainField(d.key, 'rating', e.target.value)} style={sel}>
                      <option value="">— from indicators —</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {def.domainRemarks !== false ? <textarea value={draft.domains[d.key]?.remarks || ''} onChange={e => setDomainField(d.key, 'remarks', e.target.value)} placeholder="Remark for this domain (optional)" rows={2} style={taStyle} /> : <span />}
                  </div>
                </div>
              ))}
              {def.generalRemarks !== false && <div>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>General remarks</div>
                <textarea value={draft.general_remarks} onChange={e => setDraft(d => ({ ...d, general_remarks: e.target.value }))} rows={3} style={taStyle} />
              </div>}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
              <button onClick={() => setEditing(null)} style={ghost}>Cancel</button>
              <button onClick={saveOverride} disabled={saving} style={primary}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
