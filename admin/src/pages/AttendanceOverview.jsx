// =========================================================================
// AttendanceOverview.jsx — at /attendance
// Grid of class cards showing today's marking status across all classes.
// Click a card → marking page for that class on selected date.
// =========================================================================

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints } from '../lib/branchQuery'
import { todayIST, friendlyDateLabel, isSunday } from '../lib/attendanceDates'

export default function AttendanceOverview() {
  const navigate = useNavigate()
  const { effectiveBranches } = useAuth()
  const [selectedDate, setSelectedDate] = useState(todayIST())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      // 1) Load classes from the classes collection, branch-scoped.
      //    This is the source of truth for "which classes exist" — even
      //    if no students are enrolled yet.
      const classesSnap = await getDocs(query(
        collection(db, 'classes'),
        ...branchConstraints('branchCode', effectiveBranches),
      ))
      const classMap = new Map()   // key 'className||branchCode' → { className, branchCode, total }
      classesSnap.forEach(d => {
        const c = d.data()
        if (c.isActive === false) return
        if (!c.className || !c.branchCode) return
        const key = c.className + '||' + c.branchCode
        if (!classMap.has(key)) classMap.set(key, { className: c.className, branchCode: c.branchCode, total: 0 })
      })

      // 2) Count active students per class+branch, branch-scoped.
      const studentsSnap = await getDocs(query(
        collection(db, 'students'),
        ...branchConstraints('branchCode', effectiveBranches),
      ))
      const activeStudentIds = new Set()
      studentsSnap.forEach(d => {
        const s = d.data()
        if (s.isActive === false) return
        activeStudentIds.add(d.id)
        const key = (s.className || '?') + '||' + (s.branchCode || '?')
        if (!classMap.has(key)) classMap.set(key, { className: s.className || '?', branchCode: s.branchCode || '?', total: 0 })
        classMap.get(key).total++
      })

      // 3) Load attendance for selected date, branch-scoped.
      const attSnap = await getDocs(query(
        collection(db, 'studentAttendance'),
        where('date', '==', selectedDate),
        ...branchConstraints('branchCode', effectiveBranches),
      ))
      const marked = {}, presents = {}, lates = {}, absents = {}
      attSnap.forEach(d => {
        const x = d.data()
        // Skip attendance for withdrawn students — they'd inflate marked count
        if (!activeStudentIds.has(x.studentId)) return
        const key = (x.className || '?') + '||' + (x.branchCode || '?')
        marked[key] = (marked[key] || 0) + 1
        if (x.status === 'absent') absents[key] = (absents[key] || 0) + 1
        else if (x.isLate) lates[key] = (lates[key] || 0) + 1
        else presents[key] = (presents[key] || 0) + 1
      })

      const out = []
      for (const [key, c] of classMap.entries()) {
        out.push({
          ...c,
          marked: marked[key] || 0,
          present: presents[key] || 0,
          late: lates[key] || 0,
          absent: absents[key] || 0,
        })
      }
      out.sort((a, b) => {
        const cn = a.className.localeCompare(b.className, 'en', { numeric: true })
        return cn !== 0 ? cn : a.branchCode.localeCompare(b.branchCode)
      })
      setRows(out)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [selectedDate, effectiveBranches.join(',')])

  // Aggregate stats across all classes for the selected date
  const totalActive   = rows.reduce((s, r) => s + r.total,   0)
  const totalMarked   = rows.reduce((s, r) => s + r.marked,  0)
  const totalPresent  = rows.reduce((s, r) => s + r.present, 0)
  const totalLate     = rows.reduce((s, r) => s + r.late,    0)
  const totalAbsent   = rows.reduce((s, r) => s + r.absent,  0)

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1200 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600,
          color: 'var(--green-dark)', margin: '0 0 6px',
        }}>Student Attendance</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {friendlyDateLabel(selectedDate)}
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 10, borderRadius: 1 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Date</label>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--white)' }}
        />
        {isSunday(selectedDate) && (
          <span style={{ fontSize: 12, color: '#8a6d18', background: '#fff8e6', padding: '4px 10px', borderRadius: 12, border: '1px solid #f0d895' }}>
            Sunday
          </span>
        )}
      </div>

      {/* Aggregate stats */}
      {!loading && rows.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12, marginBottom: 18,
        }}>
          <BigStat label="Marked"   primary={totalMarked + '/' + totalActive} color="var(--green-dark)" />
          <BigStat label="Present"  primary={totalPresent} color="var(--green)" />
          <BigStat label="Late"     primary={totalLate}    color="#c9a227" />
          <BigStat label="Absent"   primary={totalAbsent}  color="var(--crimson)" />
        </div>
      )}

      {loading && <div style={loadingStyle}>Loading classes…</div>}
      {error && <div style={errorStyle}>{error}</div>}

      {!loading && rows.length === 0 && (
        <div style={emptyStyle}>No active students found.</div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {rows.map(r => {
            const isEmpty = r.total === 0
            const allMarked = !isEmpty && r.marked >= r.total
            const noneMarked = r.marked === 0
            const partial = !isEmpty && !allMarked && !noneMarked
            const barColor = isEmpty ? 'var(--text-muted)' : allMarked ? 'var(--green)' : partial ? '#c9a227' : 'var(--crimson)'
            const statusLabel = isEmpty ? 'No students' : allMarked ? 'Complete' : partial ? 'Partial' : 'Not started'
            const pct = r.total > 0 ? Math.round((r.marked / r.total) * 100) : 0
            return (
              <button
                key={r.className + '_' + r.branchCode}
                onClick={() => navigate('/attendance/' + encodeURIComponent(r.className) + '/' + r.branchCode + '?date=' + selectedDate)}
                style={{
                  background: 'var(--white)', border: '1px solid var(--gray-100)',
                  borderRadius: 'var(--radius-md)', padding: '14px 16px', textAlign: 'left',
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.12s',
                  borderLeft: '3px solid ' + barColor,
                  opacity: isEmpty ? 0.6 : 1,
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{r.className}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.branchCode}</div>
                  </div>
                  <div style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                    background: isEmpty ? 'rgba(0,0,0,0.06)' : allMarked ? 'rgba(26,74,46,0.1)' : partial ? 'rgba(201,162,39,0.15)' : 'rgba(139,26,26,0.1)',
                    color: barColor, textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>{statusLabel}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {isEmpty ? 'Add students to mark attendance' : `${r.marked} of ${r.total} marked (${pct}%)`}
                </div>
                {!isEmpty && (
                  <div style={{ height: 4, background: 'var(--gray-100)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: pct + '%', height: '100%', background: barColor, transition: 'width 0.3s' }} />
                  </div>
                )}
                {r.marked > 0 && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                    {r.present > 0 && <span><strong style={{ color: 'var(--green)' }}>{r.present}</strong> P</span>}
                    {r.late > 0    && <span><strong style={{ color: '#c9a227' }}>{r.late}</strong> L</span>}
                    {r.absent > 0  && <span><strong style={{ color: 'var(--crimson)' }}>{r.absent}</strong> A</span>}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BigStat({ label, primary, color }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color, fontFamily: 'var(--font-display)', marginTop: 4 }}>{primary}</div>
    </div>
  )
}

const loadingStyle = { padding: 32, textAlign: 'center', color: 'var(--text-muted)' }
const errorStyle = { padding: 12, background: 'var(--crimson-light)', color: 'var(--crimson)', borderRadius: 'var(--radius-sm)' }
const emptyStyle = { padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--white)', border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)' }
