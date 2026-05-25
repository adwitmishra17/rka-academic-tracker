import React, { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchLabel } from '../lib/branch'

function timeToMinutes(t) { const [h,m] = t.split(':').map(Number); return h*60+m }
function minutesToTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` }

function buildSchedule(startTime, periods, breaks) {
  // periods: [{duration}, ...]  breaks: [{afterPeriod, duration}, ...]
  let current = timeToMinutes(startTime)
  const rows = []
  periods.forEach((p, i) => {
    const pNum = i + 1
    const start = minutesToTime(current)
    const end = minutesToTime(current + Number(p.duration))
    rows.push({ type:'period', period: pNum, start, end, duration: p.duration, label:`${start}–${end}` })
    current += Number(p.duration)
    const brk = breaks.find(b => b.afterPeriod === pNum)
    if (brk) {
      const bStart = minutesToTime(current)
      const bEnd = minutesToTime(current + Number(brk.duration))
      rows.push({ type:'break', afterPeriod: pNum, start: bStart, end: bEnd, duration: brk.duration })
      current += Number(brk.duration)
    }
  })
  return rows
}

export default function PeriodSettings() {
  const { currentBranch, allowedBranches, canSwitchBranches } = useAuth()

  // Period times are stored per-branch (settings/periods_MAIN, settings/periods_CITY).
  // editingBranch is LOCAL state — switching it does NOT change the global
  // branch switcher, so a super admin can edit either branch's schedule
  // without losing their global view.
  const [editingBranch, setEditingBranch] = useState(() => currentBranch || allowedBranches[0])

  // If the global switcher changes to a specific branch, follow it.
  // (If it changes to All Branches — currentBranch=null — keep our existing
  // editing branch; user is mid-edit and we shouldn't yank it away.)
  useEffect(() => {
    if (currentBranch && currentBranch !== editingBranch) {
      setEditingBranch(currentBranch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranch])

  const [startTime, setStartTime] = useState('09:20')
  const [weekdayPeriods, setWeekdayPeriods] = useState(8)
  const [saturdayPeriods, setSaturdayPeriods] = useState(5)
  const [periods, setPeriods] = useState([]) // [{duration}]
  const [breaks, setBreaks] = useState([])   // [{afterPeriod, duration}]
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!editingBranch) { setLoading(false); return }
    setLoading(true)
    setSaved(false)
    getDoc(doc(db, 'settings', `periods_${editingBranch}`)).then(d => {
      if (d.exists()) {
        const data = d.data()
        setStartTime(data.startTime || '09:20')
        setWeekdayPeriods(Number(data.weekdayPeriods || 8))
        setSaturdayPeriods(Number(data.saturdayPeriods || 5))
        if (data.periods?.length) {
          setPeriods(data.periods)
        } else {
          // Migrate from old single-duration format
          const dur = Number(data.duration || 40)
          const maxP = Math.max(Number(data.weekdayPeriods||8), Number(data.saturdayPeriods||5))
          setPeriods(Array.from({length: maxP}, () => ({ duration: dur })))
          setBreaks(data.breakAfter ? [{ afterPeriod: Number(data.breakAfter), duration: Number(data.breakDuration||20) }] : [])
        }
        if (data.breaks) setBreaks(data.breaks)
        else if (!data.breakAfter) setBreaks([])
      } else {
        // No periods doc for this branch yet — start with sensible defaults
        const maxP = 8
        setStartTime('09:20')
        setWeekdayPeriods(8)
        setSaturdayPeriods(5)
        setPeriods(Array.from({length: maxP}, () => ({ duration: 40 })))
        setBreaks([{ afterPeriod: 4, duration: 20 }])
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [editingBranch])

  // Sync periods array length when weekday/saturday count changes
  function handlePeriodCountChange(weekday, saturday) {
    const newMax = Math.max(weekday, saturday)
    const oldMax = periods.length
    if (newMax > oldMax) {
      setPeriods(p => [...p, ...Array.from({length: newMax - oldMax}, () => ({ duration: p[oldMax-1]?.duration || 40 }))])
    } else if (newMax < oldMax) {
      setPeriods(p => p.slice(0, newMax))
      setBreaks(b => b.filter(br => br.afterPeriod < newMax))
    }
  }

  function setPeriodDuration(idx, dur) {
    setPeriods(prev => prev.map((p,i) => i===idx ? { ...p, duration: Number(dur) } : p))
  }

  function addBreak() {
    const usedAfter = new Set(breaks.map(b => b.afterPeriod))
    for (let i = 1; i <= periods.length; i++) {
      if (!usedAfter.has(i)) { setBreaks(b => [...b, { afterPeriod: i, duration: 20 }].sort((a,b)=>a.afterPeriod-b.afterPeriod)); break }
    }
  }

  function removeBreak(idx) { setBreaks(b => b.filter((_,i) => i !== idx)) }
  function updateBreak(idx, key, val) { setBreaks(prev => prev.map((b,i) => i===idx ? {...b,[key]:Number(val)} : b)) }

  const schedule = buildSchedule(startTime, periods, breaks)

  async function handleSave() {
    if (!editingBranch) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', `periods_${editingBranch}`), {
        startTime, weekdayPeriods: Number(weekdayPeriods), saturdayPeriods: Number(saturdayPeriods),
        periods, breaks, updatedAt: Timestamp.now(),
        // Keep legacy fields for backward compat
        duration: periods[0]?.duration || 40,
        breakAfter: breaks[0]?.afterPeriod || null,
        breakDuration: breaks[0]?.duration || null,
      })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const inp = { padding:'9px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)', outline:'none' }

  // Always-visible tab bar for super admins with multiple branches.
  // For branch admins (single allowed branch), show a static label instead.
  const showTabs = canSwitchBranches && allowedBranches.length > 1

  return (
    <div style={{ padding:'24px 28px', maxWidth:1000 }}>
      <div className="fade-in" style={{ marginBottom:20 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:600, color:'var(--green-dark)', marginBottom:3 }}>Period Settings</h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>Configure school timings with custom durations per period and multiple breaks. Each branch has its own schedule.</p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      {/* Branch selector — tabs for super admin, label for branch admin */}
      {showTabs ? (
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Editing schedule for</span>
          <div role="tablist" style={{ display:'flex', gap:8 }}>
            {allowedBranches.map(b => {
              const active = editingBranch === b
              return (
                <button
                  key={b}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setEditingBranch(b)}
                  style={{
                    padding:'10px 22px',
                    background: active ? 'var(--green)' : 'var(--white)',
                    color: active ? 'white' : 'var(--text)',
                    border: active ? 'none' : '1px solid var(--gray-200)',
                    borderRadius:'var(--radius-md)',
                    fontSize:13, fontWeight:500, cursor:'pointer',
                    boxShadow: active ? '0 2px 8px rgba(26,74,46,0.25)' : 'none',
                    transition:'all 120ms ease',
                  }}>
                  {branchLabel(b)}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, marginBottom:20, padding:'8px 14px', background:'var(--green-light)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-md)' }}>
          <span style={{ fontSize:12, fontWeight:500, color:'var(--green-mid)' }}>Editing:</span>
          <span style={{ fontSize:13, fontWeight:600, color:'var(--green-dark)' }}>{branchLabel(editingBranch)}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, alignItems:'start' }}>

          {/* Settings panel */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* Basic settings */}
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'20px' }}>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)', marginBottom:16 }}>Basic Settings</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>School start time</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={{ ...inp, width:'100%' }} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div>
                    <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Mon–Fri periods</label>
                    <input type="number" min="1" max="12" value={weekdayPeriods} onChange={e => { const v=Number(e.target.value); setWeekdayPeriods(v); handlePeriodCountChange(v, saturdayPeriods) }} style={{ ...inp, width:'100%' }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>Saturday periods</label>
                    <input type="number" min="1" max="10" value={saturdayPeriods} onChange={e => { const v=Number(e.target.value); setSaturdayPeriods(v); handlePeriodCountChange(weekdayPeriods, v) }} style={{ ...inp, width:'100%' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Per-period durations */}
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'20px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)' }}>Period Durations</h3>
                <button onClick={() => setPeriods(p => p.map(() => ({duration: periods[0]?.duration || 40})))} style={{ fontSize:11, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer' }}>Reset all to equal</button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {periods.map((p, i) => {
                  const maxP = Math.max(weekdayPeriods, saturdayPeriods)
                  if (i >= maxP) return null
                  const isWeekdayOnly = i >= saturdayPeriods
                  const isSatOnly = i >= weekdayPeriods
                  return (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <span style={{ fontSize:12, fontWeight:600, color:'var(--green-dark)', minWidth:28 }}>P{i+1}</span>
                      <input
                        type="number" min="10" max="90" value={p.duration}
                        onChange={e => setPeriodDuration(i, e.target.value)}
                        style={{ ...inp, width:70, textAlign:'center' }}
                      />
                      <span style={{ fontSize:11, color:'var(--text-muted)' }}>min</span>
                      {isWeekdayOnly && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)' }}>Mon–Fri only</span>}
                      {!isWeekdayOnly && !isSatOnly && <span style={{ fontSize:10, color:'var(--gray-400)' }}>All days</span>}
                    </div>
                  )
                })}
              </div>
              <p style={{ fontSize:11, color:'var(--gray-400)', marginTop:10 }}>Set different durations for different periods (e.g. first/last period shorter)</p>
            </div>

            {/* Breaks */}
            <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', padding:'20px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--text)' }}>Breaks / Intervals</h3>
                <button onClick={addBreak} style={{ fontSize:12, color:'var(--green)', background:'none', border:'1px solid var(--green-muted)', borderRadius:16, padding:'4px 12px', cursor:'pointer', fontWeight:500 }}>+ Add break</button>
              </div>
              {breaks.length === 0 ? (
                <p style={{ fontSize:13, color:'var(--text-muted)', fontStyle:'italic' }}>No breaks configured. Click "Add break" to add an interval.</p>
              ) : breaks.map((brk, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, padding:'10px 14px', background:'#fffbea', borderRadius:'var(--radius-md)', border:'1px solid rgba(201,162,39,0.2)' }}>
                  <span style={{ fontSize:12, fontWeight:500, color:'var(--gold-dark)', flexShrink:0 }}>☕ After P</span>
                  <input
                    type="number" min="1" max={periods.length - 1} value={brk.afterPeriod}
                    onChange={e => updateBreak(i, 'afterPeriod', e.target.value)}
                    style={{ ...inp, width:52, textAlign:'center' }}
                  />
                  <span style={{ fontSize:12, color:'var(--text-muted)', flexShrink:0 }}>Duration</span>
                  <input
                    type="number" min="5" max="60" value={brk.duration}
                    onChange={e => updateBreak(i, 'duration', e.target.value)}
                    style={{ ...inp, width:58, textAlign:'center' }}
                  />
                  <span style={{ fontSize:11, color:'var(--text-muted)', flexShrink:0 }}>min</span>
                  <button onClick={() => removeBreak(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--crimson)', fontSize:16, marginLeft:'auto', flexShrink:0 }}>×</button>
                </div>
              ))}
            </div>

            {saved && <div style={{ fontSize:13, color:'var(--green)', background:'var(--green-light)', padding:'10px 14px', borderRadius:'var(--radius-sm)', border:'1px solid var(--green-muted)' }}>✓ Period settings saved for {branchLabel(editingBranch)}</div>}
            <button onClick={handleSave} disabled={saving} style={{ padding:'12px', background: saving?'var(--gray-200)':'var(--green)', color: saving?'var(--gray-400)':'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: saving?'not-allowed':'pointer', boxShadow: saving?'none':'0 2px 8px rgba(26,74,46,0.25)' }}>
              {saving ? 'Saving…' : `Save Settings for ${branchLabel(editingBranch)}`}
            </button>
          </div>

          {/* Schedule preview */}
          <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden', position:'sticky', top:24 }}>
            <div style={{ padding:'14px 18px', background:'var(--green-light)', borderBottom:'1px solid var(--green-muted)' }}>
              <h3 style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:600, color:'var(--green-dark)' }}>Live Schedule Preview · {branchLabel(editingBranch)}</h3>
              <p style={{ fontSize:11, color:'var(--green-mid)', marginTop:2 }}>Updates as you change settings</p>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  {['','Start','End','Duration','Days'].map(h => (
                    <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.map((row, i) => row.type === 'break' ? (
                  <tr key={`b-${i}`} style={{ background:'#fffbea', borderTop:'1px solid rgba(201,162,39,0.15)' }}>
                    <td colSpan={5} style={{ padding:'8px 14px', fontSize:12, color:'var(--gold-dark)', fontWeight:500 }}>
                      ☕ Interval — {row.duration} min &nbsp;({row.start}–{row.end})
                    </td>
                  </tr>
                ) : (
                  <tr key={`p-${row.period}`} style={{ borderTop:'1px solid var(--gray-50)', background: i%2===0?'var(--white)':'var(--gray-50)' }}>
                    <td style={{ padding:'9px 14px', fontWeight:700, color:'var(--green-dark)' }}>P{row.period}</td>
                    <td style={{ padding:'9px 14px', fontWeight:500 }}>{row.start}</td>
                    <td style={{ padding:'9px 14px', color:'var(--text-muted)' }}>{row.end}</td>
                    <td style={{ padding:'9px 14px', color:'var(--text-muted)' }}>{row.duration}m</td>
                    <td style={{ padding:'9px 14px' }}>
                      <div style={{ display:'flex', gap:4 }}>
                        {row.period <= Number(weekdayPeriods) && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>Mon–Fri</span>}
                        {row.period <= Number(saturdayPeriods) && <span style={{ fontSize:10, padding:'1px 6px', borderRadius:6, background:'var(--gold-light)', color:'var(--gold-dark)', fontWeight:500 }}>Sat</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
