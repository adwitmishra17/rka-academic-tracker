import React, { useState, useEffect, useMemo } from 'react'
import { examApi } from '../../lib/api'
import { inp, lbl, card, th, td, Btn, Pill, Note, Spinner, fmtWhen } from './ui.jsx'

/* Stage 6 — Report cards: completeness gate → preview → publish → print.
   Publishing freezes the computed card + its HTML in published_report_cards;
   SMS and the parent app read only that. Students with missing entries are
   blocked (hard gate) and listed with what is missing. */

export default function CardsStage({ branch, sessionCode, className, setStage }) {
  const [cardKey, setCardKey] = useState('')
  const [section, setSection] = useState('')
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [showMissing, setShowMissing] = useState(null)

  const load = () => {
    setBusy('load'); setErr('')
    examApi.classCards(branch, sessionCode, className, cardKey || undefined, section || undefined)
      .then((d) => { setData(d); if (!cardKey) setCardKey(d.cardKey); setPicked(new Set()) })
      .catch((e) => { setErr(e.message); setData(null) }).finally(() => setBusy(''))
  }
  useEffect(load, [branch, sessionCode, className, cardKey, section]) // eslint-disable-line

  const rows = data?.rows || []
  const sections = useMemo(() => [...new Set(rows.map((r) => r.section).filter(Boolean))].sort(), [rows])
  const ready = rows.filter((r) => r.ok)
  const blocked = rows.filter((r) => !r.ok)
  const publishedRows = rows.filter((r) => r.published)
  const stale = rows.filter((r) => r.published && r.ok) // republish candidates (rank/marks may have changed)
  const label = data?.cardKeys?.find((k) => k.key === (data?.cardKey))?.label || cardKey

  async function publish(ids) {
    const n = ids ? ids.length : ready.length
    if (!confirm(`Publish ${n} ${label}${n === 1 ? '' : 's'} for ${className}? Parents and the SMS will see these cards; republishing later creates a new version.`)) return
    setBusy('publish'); setErr(''); setResult(null)
    try {
      const r = await examApi.publish({ branchCode: branch, sessionCode, className, cardKey: data.cardKey, section: section || undefined, studentIds: ids })
      setResult(r); load()
    } catch (e) { setErr(e.message) }
    setBusy('')
  }
  async function withdraw(ids) {
    if (!confirm(`Withdraw ${ids.length} published card${ids.length === 1 ? '' : 's'}? Parents will no longer see them until republished.`)) return
    setBusy('withdraw')
    try { await examApi.unpublish(ids); load() } catch (e) { setErr(e.message) }
    setBusy('')
  }
  const openPreview = (studentId) => window.open(`/examinations/print?studentId=${studentId}&sessionCode=${encodeURIComponent(sessionCode)}&cardKey=${encodeURIComponent(data.cardKey)}`, '_blank')
  const openPublished = (ids) => window.open(`/examinations/print?published=${ids.join(',')}`, '_blank')
  const togglePick = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      {result && (
        <Note tone={result.blocked?.length ? 'gold' : 'green'}>
          Published <b>{result.published}</b> card{result.published === 1 ? '' : 's'}.
          {result.blocked?.length ? <> <b>{result.blocked.length}</b> blocked by missing entries: {result.blocked.slice(0, 6).map((b) => b.name).join(', ')}{result.blocked.length > 6 ? '…' : ''}</> : null}
        </Note>
      )}

      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-dark)' }}>Report cards · {className}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{rows.length} students · <b style={{ color: 'var(--green)' }}>{ready.length} ready</b> · <b style={{ color: 'var(--crimson)' }}>{blocked.length} blocked</b> · {publishedRows.length} published</div>
        </div>
        <div><span style={lbl}>Card</span><select value={cardKey} onChange={(e) => setCardKey(e.target.value)} style={inp}>{(data?.cardKeys || []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></div>
        {sections.length > 1 && <div><span style={lbl}>Section</span><select value={section} onChange={(e) => setSection(e.target.value)} style={inp}><option value="">All</option>{sections.map((s) => <option key={s}>{s}</option>)}</select></div>}
        <Btn onClick={() => openPublished(publishedRows.map((r) => r.published.id))} disabled={!publishedRows.length}>Print published ({publishedRows.length})</Btn>
        {picked.size > 0 ? <Btn kind="primary" onClick={() => publish([...picked])} disabled={!!busy}>Publish selected ({picked.size})</Btn>
          : <Btn kind="primary" onClick={() => publish()} disabled={!!busy || !ready.length}>{busy === 'publish' ? 'Publishing…' : `Publish all ready (${ready.length})`}</Btn>}
      </div>

      {blocked.length > 0 && rows.length > 0 && (
        <Note tone="gold"><b>Hard gate:</b> a card publishes only when every scholastic component and co-scholastic grade on it is entered. Fix the gaps in <button onClick={() => setStage('status')} style={{ border: 'none', background: 'none', color: 'var(--gold-dark)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>Entry status</button>; click a red pill to see exactly what is missing.</Note>
      )}

      {busy === 'load' && !data ? <Spinner /> : data && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>
              <th style={th}><input type="checkbox" checked={picked.size > 0 && picked.size === ready.length} onChange={(e) => setPicked(e.target.checked ? new Set(ready.map((r) => r.studentId)) : new Set())} title="select all ready" /></th>
              <th style={th}>Roll</th><th style={th}>Student</th><th style={th}>Gate</th><th style={{ ...th, textAlign: 'center' }}>Total</th><th style={{ ...th, textAlign: 'center' }}>%</th><th style={{ ...th, textAlign: 'center' }}>Grade</th><th style={{ ...th, textAlign: 'center' }}>Rank</th><th style={th}>Published</th><th style={th}></th>
            </tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.studentId} style={{ background: picked.has(r.studentId) ? 'var(--green-light)' : i % 2 ? 'var(--gray-50)' : 'var(--white)' }}>
                <td style={td}><input type="checkbox" checked={picked.has(r.studentId)} disabled={!r.ok} onChange={() => togglePick(r.studentId)} /></td>
                <td style={{ ...td, color: 'var(--text-muted)' }}>{r.roll || '—'}</td>
                <td style={{ ...td, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.name}{r.section ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {r.section}</span> : null}</td>
                <td style={td}>{r.ok ? <Pill tone="green">ready</Pill> : <button onClick={() => setShowMissing(r)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}><Pill tone="red">{r.missing.length} missing</Pill></button>}{r.warnings?.length ? <span title={r.warnings.map((w) => `${w.row}${w.term ? ' · ' + w.term : ''}: ${w.reason}`).join('\n')} style={{ marginLeft: 4 }}><Pill tone="gold">{r.warnings.length} soft</Pill></span> : null}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.overall.max ? `${r.overall.obtained}/${r.overall.max}` : '—'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{r.overall.pct != null ? r.overall.pct.toFixed(1) : '—'}</td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 600, color: 'var(--green)' }}>{r.overall.grade || '—'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{r.rank ?? '—'}</td>
                <td style={{ ...td, fontSize: 11.5 }}>{r.published ? <span title={`by ${r.published.published_by}`}><Pill tone="ink">v{r.published.version}</Pill> <span style={{ color: 'var(--text-muted)' }}>{fmtWhen(r.published.published_at)}</span></span> : <span style={{ color: 'var(--gray-400)' }}>—</span>}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <Btn small onClick={() => openPreview(r.studentId)}>Preview</Btn>{' '}
                  {r.published && <><Btn small onClick={() => openPublished([r.published.id])}>Print</Btn>{' '}<Btn small kind="danger" onClick={() => withdraw([r.published.id])}>Withdraw</Btn></>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {stale.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Republishing a student creates a new version and updates rank/section-highest for the whole section on that card. Old versions stay in the history table.</div>}

      {showMissing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowMissing(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--white)', borderRadius: 'var(--radius-lg)', width: 'min(640px, 94vw)', maxHeight: '80vh', overflow: 'auto', padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{showMissing.name} — what blocks the card</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10 }}>{label}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Row</th><th style={th}>Term</th><th style={th}>Component</th><th style={th}>Reason</th></tr></thead>
              <tbody>{showMissing.missing.map((m, i) => <tr key={i}><td style={{ ...td, fontWeight: 600 }}>{m.row}</td><td style={td}>{m.term || '—'}</td><td style={td}>{m.component || '—'}</td><td style={{ ...td, color: 'var(--crimson)' }}>{m.reason}</td></tr>)}</tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}><Btn onClick={() => setShowMissing(null)}>Close</Btn><Btn kind="primary" onClick={() => setStage('status')}>Go to Entry status</Btn></div>
          </div>
        </div>
      )}
    </div>
  )
}
