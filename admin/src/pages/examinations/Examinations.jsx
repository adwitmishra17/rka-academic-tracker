import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../App'
import { useClasses } from '../../hooks/useClasses'
import { branchLabel } from '../../lib/branch'
import { compareClasses } from '../../lib/classes'
import { examApi } from '../../lib/api'
import { inp, lbl, Pill } from './ui.jsx'
import SetupStage from './SetupStage.jsx'
import RulesStage from './RulesStage.jsx'
import PapersStage from './PapersStage.jsx'
import StatusStage from './StatusStage.jsx'
import CrosslistStage from './CrosslistStage.jsx'
import CardsStage from './CardsStage.jsx'

/* ============================================================
   Examinations — the single window for the whole exam → report-card
   pipeline. Context (branch · session · class) sits at the top; the
   left rail is the workflow in order and doubles as the progress view:

     1 Setup     terms · subjects & teachers · card template per class
     2 Rules     scoring rules (component → paper, raw max → card max)
     3 Papers    generated from the rules (typed, never free-text)
     4 Status    who has entered what (marks + card entries), office entry
     5 Crosslist class sheet, raw per term or normalised per card
     6 Cards     completeness gate → preview → publish → print
   ============================================================ */

const STAGES = [
  { key: 'setup', n: 1, label: 'Setup', hint: 'Terms, subjects, teachers, template' },
  { key: 'rules', n: 2, label: 'Scoring rules', hint: 'Components, max marks, normalisation' },
  { key: 'papers', n: 3, label: 'Papers', hint: 'Generated from the rules · date sheet' },
  { key: 'status', n: 4, label: 'Entry status', hint: 'Who owes marks · office entry' },
  { key: 'crosslist', n: 5, label: 'Crosslist', hint: 'Class sheet · exports' },
  { key: 'cards', n: 6, label: 'Report cards', hint: 'Gate · preview · publish' },
]

export default function Examinations() {
  const { allowedBranches = [], currentBranch } = useAuth()
  const { classes: classDocs } = useClasses()
  const [params, setParams] = useSearchParams()

  const branch = params.get('branch') || currentBranch || allowedBranches[0] || 'MAIN'
  const sessionCode = params.get('session') || ''
  const className = params.get('class') || ''
  const stage = params.get('stage') || 'setup'
  const setParam = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
      return next
    }, { replace: true })
  }, [setParams])
  useEffect(() => { if (currentBranch && currentBranch !== params.get('branch')) setParam({ branch: currentBranch, class: '' }) }, [currentBranch]) // eslint-disable-line

  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    examApi.sessions().then(({ sessions: s }) => {
      const list = (s || []).filter(Boolean)
      setSessions(list)
      if (!sessionCode) setParam({ session: list[0] || defaultSession() })
    }).catch(() => { if (!sessionCode) setParam({ session: defaultSession() }) })
  }, []) // eslint-disable-line

  const refreshConfig = useCallback(() => {
    if (!branch || !sessionCode) return Promise.resolve()
    setLoading(true); setError('')
    return examApi.config(branch, sessionCode)
      .then((c) => { setConfig(c); if (c.sessions?.length) setSessions((old) => [...new Set([...old, ...c.sessions])].sort().reverse()) })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false))
  }, [branch, sessionCode])
  useEffect(() => { refreshConfig() }, [refreshConfig])

  const classNames = useMemo(() => {
    const fromDocs = (classDocs || []).filter((c) => c.branchCode === branch).map((c) => c.className)
    const fromSubjects = (config?.subjects || []).map((s) => s.class_name)
    return [...new Set([...fromDocs, ...fromSubjects])].sort(compareClasses)
  }, [classDocs, branch, config])

  const classBadges = useMemo(() => {
    const out = {}
    for (const c of classNames) {
      const subs = (config?.subjects || []).filter((s) => s.class_name === c)
      out[c] = { subjects: subs.length, unassigned: subs.filter((s) => (s.kind || 'scholastic') === 'scholastic' && !s.assigned_teacher_email).length, template: !!config?.classMap?.[c], typed: config?.paperCounts?.[c]?.typed || 0 }
    }
    return out
  }, [classNames, config])

  const ctx = { branch, sessionCode, className, config, refreshConfig, classNames, classBadges, setStage: (s) => setParam({ stage: s }), setClass: (c) => setParam({ class: c }) }
  const Stage = { setup: SetupStage, rules: RulesStage, papers: PapersStage, status: StatusStage, crosslist: CrosslistStage, cards: CardsStage }[stage] || SetupStage
  const needsClass = stage !== 'setup'
  const termsOk = (config?.terms || []).length > 0

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400 }}>
      {/* Context bar */}
      <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ marginRight: 'auto' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 2 }}>Examinations</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Setup → rules → papers → entry → crosslist → published cards, in one place.</p>
        </div>
        {allowedBranches.length > 1 && !currentBranch && (
          <div><span style={lbl}>Branch</span>
            <select value={branch} onChange={(e) => setParam({ branch: e.target.value, class: '' })} style={inp}>
              {allowedBranches.map((b) => <option key={b} value={b}>{branchLabel(b)}</option>)}
            </select></div>
        )}
        <div><span style={lbl}>Session</span>
          <select value={sessionCode} onChange={(e) => setParam({ session: e.target.value })} style={inp}>
            {[...new Set([sessionCode, ...sessions, defaultSession(), nextSession()])].filter(Boolean).map((s) => <option key={s}>{s}</option>)}
          </select></div>
        <div><span style={lbl}>Class</span>
          <select value={className} onChange={(e) => setParam({ class: e.target.value })} style={{ ...inp, minWidth: 170 }}>
            <option value="">{needsClass ? 'Select a class…' : 'All classes'}</option>
            {classNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
      </div>

      {error && <div style={{ color: 'var(--crimson)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '218px 1fr', gap: 18, alignItems: 'start' }}>
        {/* Stage rail */}
        <nav style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-lg)', padding: 8, position: 'sticky', top: 64 }}>
          {STAGES.map((s) => {
            const active = s.key === stage
            const badge = railBadge(s.key, { config, className, classBadges, termsOk })
            return (
              <button key={s.key} onClick={() => setParam({ stage: s.key })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', margin: '2px 0', border: 'none', borderRadius: 12, cursor: 'pointer', background: active ? 'var(--text)' : 'transparent', color: active ? 'var(--white)' : 'var(--text)' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: active ? 'var(--white)' : 'var(--gray-100)', color: active ? 'var(--text)' : 'var(--text-muted)', flexShrink: 0 }}>{s.n}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: active ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.hint}</span>
                </span>
                {badge && <span style={{ width: 8, height: 8, borderRadius: '50%', background: badge === 'ok' ? 'var(--green)' : badge === 'warn' ? 'var(--gold)' : 'var(--crimson)', flexShrink: 0 }} />}
              </button>
            )
          })}
          <div style={{ padding: '10px 10px 4px', fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {loading ? 'Refreshing…' : config ? <>{branch} · {sessionCode}<br />{config.terms.length} terms · {config.subjects.length} subjects</> : ''}
          </div>
        </nav>

        {/* Stage body */}
        <div style={{ minWidth: 0 }}>
          {needsClass && !className ? (
            <div style={{ background: 'var(--white)', border: '1px dashed var(--gray-200)', borderRadius: 'var(--radius-lg)', padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Pick a class at the top to work on <b>{STAGES.find((s) => s.key === stage)?.label}</b>.
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 14 }}>
                {classNames.map((c) => <button key={c} onClick={() => setParam({ class: c })} style={{ padding: '5px 11px', borderRadius: 99, border: '1px solid var(--gray-200)', background: 'var(--white)', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>{c} {classBadges[c]?.template ? <Pill tone="green">card</Pill> : <Pill tone="red">no card</Pill>}</button>)}
              </div>
            </div>
          ) : config ? <Stage {...ctx} /> : null}
        </div>
      </div>
    </div>
  )
}

function railBadge(key, { config, className, classBadges, termsOk }) {
  if (!config) return null
  if (key === 'setup') {
    if (!termsOk) return 'bad'
    const unassigned = Object.values(classBadges).reduce((s, b) => s + b.unassigned, 0)
    const noTpl = Object.values(classBadges).filter((b) => b.subjects > 0 && !b.template).length
    return unassigned || noTpl ? 'warn' : 'ok'
  }
  if (!className) return null
  const b = classBadges[className]
  if (key === 'rules') return b?.template ? 'ok' : 'bad'
  if (key === 'papers') return b?.typed > 0 ? 'ok' : 'bad'
  return null
}

function defaultSession() {
  const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String(y + 1).slice(2)}`
}
function nextSession() {
  const [a] = defaultSession().split('-'); const y = Number(a) + 1
  return `${y}-${String(y + 1).slice(2)}`
}
