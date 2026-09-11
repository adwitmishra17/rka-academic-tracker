import React, { useState, useEffect, useMemo } from 'react'
import { examApi } from '../../lib/api'
import { card, th, td, Btn, Pill, Note, Spinner, Drawer, fmtWhen } from './ui.jsx'
import MarksEntry from '../MarksEntry'
import CardEntries from '../CardEntries'

/* Stage 4 — Entry status: subject × paper matrix (who has entered what,
   how many of the roster, when, office-overridden?), plus the class-teacher
   pack (card entries) per term. Click any cell to enter/override in place. */

const COMP_LABEL = { pt: 'Periodic test', portfolio: 'Portfolio', se: 'Sub. enrichment', exam: 'Exam', notebook: 'Notebook' }
const STATE = { empty: { tone: 'red', label: 'not started' }, partial: { tone: 'gold', label: 'partial' }, done: { tone: 'green', label: 'complete' } }

export default function StatusStage({ branch, sessionCode, className, setStage, setClass }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [drawer, setDrawer] = useState(null) // { kind:'marks', termId, subjectId, label } | { kind:'card', termId, label }

  const load = () => {
    setBusy(true); setErr('')
    examApi.status(branch, sessionCode, className).then(setData).catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  useEffect(load, [branch, sessionCode, className]) // eslint-disable-line

  const terms = data?.terms || []
  const ORDER = ['pt', 'portfolio', 'se', 'notebook', 'exam']
  const cols = useMemo(() => terms.map((t) => ({ ...t, keys: [...new Set((data?.items || []).flatMap((it) => it.papers.filter((p) => p.termId === t.id).map((p) => p.componentKey)))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)) })), [data, terms])
  const totals = useMemo(() => {
    const all = (data?.items || []).flatMap((it) => it.papers)
    return { papers: all.length, done: all.filter((p) => p.state === 'done').length, partial: all.filter((p) => p.state === 'partial').length, empty: all.filter((p) => p.state === 'empty').length, noTeacher: (data?.items || []).filter((it) => !it.teacherEmail).length }
  }, [data])

  if (busy && !data) return <Spinner />
  if (!data) return err ? <Note tone="red">{err}</Note> : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <Note tone="red">{err}</Note>}
      <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--green-dark)' }}>Entry status · {className}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
            {data.roster} students{data.sections?.length ? ` · sections ${data.sections.join(', ')}` : ''} · class teacher <b style={{ color: 'var(--text)' }}>{data.classTeacher?.name || '—'}</b>
            {data.legacyPapers ? ` · ${data.legacyPapers} legacy papers not shown` : ''}
          </div>
        </div>
        <Stat n={totals.done} label="complete" tone="green" /><Stat n={totals.partial} label="partial" tone="gold" /><Stat n={totals.empty} label="not started" tone="red" />
        {totals.noTeacher > 0 && <Stat n={totals.noTeacher} label="no teacher" tone="red" />}
        <Btn small onClick={load} disabled={busy}>Refresh</Btn>
      </div>

      {!data.template && <Note tone="red">No template bound for {className} — the card cannot be built. Bind one in Setup.</Note>}
      {data.template && totals.papers === 0 && <Note tone="gold">No typed papers yet — generate them in <b>Papers</b>.</Note>}

      {totals.papers > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr><th style={th} rowSpan={2}>Subject</th><th style={th} rowSpan={2}>Teacher</th>{cols.map((t) => <th key={t.id} style={{ ...th, textAlign: 'center', borderLeft: '1px solid var(--gray-100)' }} colSpan={Math.max(1, t.keys.length)}>{t.name}</th>)}</tr>
              <tr>{cols.map((t) => (t.keys.length ? t.keys : ['—']).map((k) => <th key={t.id + k} style={{ ...th, textAlign: 'center', fontSize: 9.5, borderLeft: '1px solid var(--gray-100)' }}>{COMP_LABEL[k] || k}</th>))}</tr>
            </thead>
            <tbody>{data.items.map((it) => (
              <tr key={it.subjectId}>
                <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{it.subjectName}</td>
                <td style={{ ...td, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  <button onClick={() => { setClass?.(className); setStage('setup') }} title="Change in Setup" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, color: it.teacherEmail ? 'var(--text)' : 'var(--crimson)', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{it.teacher || 'no teacher — assign'}</button>
                </td>
                {cols.map((t) => (t.keys.length ? t.keys : ['—']).map((k) => {
                  const p = it.papers.find((x) => x.termId === t.id && x.componentKey === k)
                  if (!p) return <td key={t.id + k} style={{ ...td, textAlign: 'center', color: 'var(--gray-400)', borderLeft: '1px solid var(--gray-50)' }}>·</td>
                  const st = STATE[p.state]
                  return (
                    <td key={p.id} style={{ ...td, textAlign: 'center', borderLeft: '1px solid var(--gray-50)', padding: 4 }}>
                      <button onClick={() => setDrawer({ kind: 'marks', termId: p.termId, subjectId: it.subjectId, label: `${it.subjectName} · ${p.termName} · ${p.paperName}` })}
                        title={`${p.paperName} /${p.maxMarks}${p.cardMax != null ? ` → /${p.cardMax}` : ''}\n${p.entered}/${p.roster} entered · ${p.absent} absent · ${p.manual} office\nlast ${fmtWhen(p.lastAt)}${p.examDate ? `\nexam ${p.examDate}` : ''}`}
                        style={{ width: '100%', minWidth: 62, border: 'none', borderRadius: 8, padding: '5px 4px', cursor: 'pointer', background: st.tone === 'green' ? 'var(--green-light)' : st.tone === 'gold' ? 'var(--gold-light)' : 'var(--crimson-light)', color: st.tone === 'green' ? 'var(--green-dark)' : st.tone === 'gold' ? 'var(--gold-dark)' : 'var(--crimson)' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{p.entered}<span style={{ fontWeight: 400, fontSize: 10 }}>/{p.roster}</span></div>
                        <div style={{ fontSize: 9.5 }}>{p.manual ? `${p.manual} office` : st.label}</div>
                      </button>
                    </td>
                  )
                }))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Card entries (class-teacher pack) */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--gray-100)', fontSize: 13, fontWeight: 600 }}>Card entries — co-scholastic grades, discipline, remarks (class teacher · {data.classTeacher?.name || '—'})</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Term</th><th style={th}>Area grades</th><th style={th}>Discipline</th><th style={th}>Remarks</th><th style={th}></th></tr></thead>
          <tbody>{data.cardEntries.map((ce) => {
            const pct = ce.gradesExpected ? Math.round(100 * ce.gradesEntered / ce.gradesExpected) : null
            return (
              <tr key={ce.termId}>
                <td style={{ ...td, fontWeight: 600 }}>{ce.termName} <Pill tone="muted">{ce.termCode}</Pill></td>
                <td style={td}>{ce.areas ? <><Pill tone={pct === 100 ? 'green' : pct > 0 ? 'gold' : 'red'}>{ce.gradesEntered}/{ce.gradesExpected}</Pill> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ce.areas} areas</span></> : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no areas configured</span>}</td>
                <td style={td}><Pill tone={ce.discipline === ce.roster ? 'green' : ce.discipline ? 'gold' : 'muted'}>{ce.discipline}/{ce.roster}</Pill></td>
                <td style={td}><Pill tone={ce.remarks === ce.roster ? 'green' : ce.remarks ? 'gold' : 'muted'}>{ce.remarks}/{ce.roster}</Pill></td>
                <td style={{ ...td, textAlign: 'right' }}><Btn small onClick={() => setDrawer({ kind: 'card', termId: ce.termId, label: `Card entries · ${ce.termName}` })}>Open</Btn></td>
              </tr>
            )
          })}</tbody>
        </table>
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--gray-100)' }}>Class teachers enter these in the PWA (Marks → Co-scholastic Entries). The office can enter or override here; office rows lock the teacher's.</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={() => setStage('crosslist')}>Crosslist →</Btn>
        <Btn kind="primary" onClick={() => setStage('cards')}>Report cards →</Btn>
      </div>

      {drawer && (
        <Drawer title={drawer.label} onClose={() => { setDrawer(null); load() }}>
          {drawer.kind === 'marks'
            ? <MarksEntry embedded ctx={{ branch, sessionCode, className, termId: drawer.termId, subjectId: drawer.subjectId }} />
            : <CardEntries embedded ctx={{ branch, sessionCode, className, termId: drawer.termId }} />}
        </Drawer>
      )}
    </div>
  )
}

function Stat({ n, label, tone }) {
  const c = { green: 'var(--green)', gold: 'var(--gold-dark)', red: 'var(--crimson)' }[tone]
  return <div style={{ textAlign: 'center', minWidth: 60 }}><div style={{ fontSize: 20, fontWeight: 700, color: c, fontFamily: 'var(--font-display)' }}>{n}</div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div></div>
}
