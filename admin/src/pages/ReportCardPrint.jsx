import React, { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { examApi } from '../lib/api'
import { generateRemark, TONE_PRESETS } from '../lib/reportCardRemark'
import crest from '../assets/crest.png'
import bannerLight from '../assets/banner-light.png'

/* ============================================================
   Report Card — printable A4 (Tracker-native).
   Standalone route (no sidebar): /report-cards/print?studentId=&sessionCode=
   Same content as SMS's card (header, marks grid, overall, co-scholastic,
   auto-generated editable remark), A4 portrait, one student per page.
   ============================================================ */

export default function ReportCardPrint() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const studentId  = params.get('studentId')
  const sessionCode = params.get('sessionCode')

  const [card, setCard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tone, setTone] = useState('formal')
  const [remark, setRemark] = useState('')
  const [edited, setEdited] = useState(false)

  useEffect(() => {
    if (!studentId || !sessionCode) { setError('Missing studentId / sessionCode'); setLoading(false); return }
    setLoading(true)
    examApi.reportCard(studentId, sessionCode)
      .then(({ card }) => { setCard(card); setRemark(generateRemark(card, { tone: 'formal' })) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [studentId, sessionCode])

  useEffect(() => {
    if (card && !edited) setRemark(generateRemark(card, { tone }))
  }, [tone, card, edited])

  if (loading) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Loading report card…</div>
  if (error)   return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#b00' }}>{error} — <a href="#" onClick={() => navigate('/report-cards')}>back</a></div>
  if (!card)   return <div style={{ padding: 40 }}>No data.</div>

  const s = card.student
  const terms = card.terms || []

  return (
    <div style={{ background: '#f4f4f5', minHeight: '100vh' }}>
      {/* Toolbar — hidden in print */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', background: '#fff', borderBottom: '1px solid #e5e5e5', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/report-cards')} style={tbtn}>← Report cards</button>
        <label style={{ fontSize: 13, color: '#555' }}>Remark tone:&nbsp;
          <select value={tone} onChange={e => { setEdited(false); setTone(e.target.value) }} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ccc' }}>
            {TONE_PRESETS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <button onClick={() => window.print()} style={{ ...tbtn, marginLeft: 'auto', background: '#1a4a2e', color: '#fff', border: 'none' }}>Print</button>
      </div>

      {/* Remark editor — hidden in print */}
      <div className="no-print" style={{ maxWidth: 760, margin: '14px auto 0', padding: '0 12px' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>Class teacher's remark (editable — prints on the card)</div>
          <textarea value={remark} onChange={e => { setEdited(true); setRemark(e.target.value) }} rows={4}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: 10, borderRadius: 8, border: '1px solid #ccc', resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
      </div>

      {/* A4 card */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
        <div className="rc-card" style={card_}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderBottom: '2px solid #1a4a2e', paddingBottom: 12, marginBottom: 14 }}>
            <img src={crest} alt="" style={{ width: 60, height: 60, objectFit: 'contain' }} />
            <div style={{ flex: 1, textAlign: 'center' }}>
              {/* Transparent black+red wordmark — sits directly on the paper, no box */}
              <img src={bannerLight} alt="Radhakrishna Academy" style={{ display: 'block', width: '100%', maxWidth: 330, height: 'auto', margin: '0 auto' }} />
              <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{s.branches?.name || s.branches?.code || ''}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: '#222' }}>REPORT CARD · Session {card.sessionCode}</div>
            </div>
            <div style={{ width: 60 }} />
          </div>

          {/* Student info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 12.5, marginBottom: 14 }}>
            <Info label="Name" value={s.full_name} />
            <Info label="Class" value={`${s.class_name}${s.section ? ' - ' + s.section : ''}`} />
            <Info label="Admission No." value={s.admission_no} />
            <Info label="Roll No." value={s.roll_number} />
            <Info label="Father" value={s.father_name} />
            <Info label="Mother" value={s.mother_name} />
          </div>

          {/* Marks table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={cth}>Subject</th>
                {terms.map(t => <th key={t.id} style={{ ...cth, textAlign: 'center' }}>{t.short_code || t.name}</th>)}
                <th style={{ ...cth, textAlign: 'center' }}>Total</th>
                <th style={{ ...cth, textAlign: 'center' }}>Grade</th>
              </tr>
            </thead>
            <tbody>
              {card.grid.length === 0 && (
                <tr><td style={ctd} colSpan={terms.length + 3}>No scholastic subjects / papers for this class &amp; session.</td></tr>
              )}
              {card.grid.map(row => (
                <tr key={row.subject.id}>
                  <td style={{ ...ctd, fontWeight: 500 }}>{row.subject.subject_name}</td>
                  {terms.map(t => {
                    const c = row.byTerm[t.id]
                    return <td key={t.id} style={{ ...ctd, textAlign: 'center' }}>{!c || !('marks' in c) ? '—' : c.absent ? 'AB' : c.marks == null ? '—' : `${c.marks}/${c.max}`}</td>
                  })}
                  <td style={{ ...ctd, textAlign: 'center' }}>{row.total.max > 0 ? `${row.total.obtained}/${row.total.max}` : '—'}</td>
                  <td style={{ ...ctd, textAlign: 'center', fontWeight: 600 }}>{row.total.grade ? row.total.grade.grade : '—'}</td>
                </tr>
              ))}
            </tbody>
            {card.overall.max > 0 && (
              <tfoot>
                <tr>
                  <td style={{ ...ctd, fontWeight: 700, borderTop: '2px solid #999' }}>Overall</td>
                  <td style={{ ...ctd, borderTop: '2px solid #999' }} colSpan={terms.length}></td>
                  <td style={{ ...ctd, textAlign: 'center', fontWeight: 700, borderTop: '2px solid #999' }}>{card.overall.obtained}/{card.overall.max}</td>
                  <td style={{ ...ctd, textAlign: 'center', fontWeight: 700, borderTop: '2px solid #999' }}>
                    {card.overall.pct != null ? `${card.overall.pct.toFixed(1)}%` : ''} {card.overall.grade ? card.overall.grade.grade : ''}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>

          {/* Co-scholastic */}
          {card.coScholastic?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a4a2e', marginBottom: 6 }}>Co-Scholastic Areas</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {card.coScholastic.map(co => (
                    <tr key={co.name}>
                      <td style={ctd}>{co.name}</td>
                      <td style={{ ...ctd, textAlign: 'center', width: 80, fontWeight: 600 }}>{co.grade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Remark */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a4a2e', marginBottom: 4 }}>Class Teacher's Remark</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#222', minHeight: 40 }}>{remark || '—'}</div>
          </div>

          {/* Signatures */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40, fontSize: 11.5, color: '#444' }}>
            <div style={sigLine}>Class Teacher</div>
            <div style={sigLine}>Parent / Guardian</div>
            <div style={sigLine}>Principal</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .rc-card { box-shadow: none !important; margin: 0 !important; width: auto !important; }
          @page { size: A4 portrait; margin: 14mm; }
        }
      `}</style>
    </div>
  )
}

function Info({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ color: '#777', minWidth: 92 }}>{label}:</span>
      <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{value || '—'}</span>
    </div>
  )
}

const card_ = { background: '#fff', color: '#1a1a1a', width: 760, maxWidth: '100%', padding: '28px 32px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', boxSizing: 'border-box', fontFamily: 'Georgia, "Times New Roman", serif' }
const cth = { textAlign: 'left', padding: '7px 8px', fontSize: 11, fontWeight: 700, color: '#1a4a2e', borderBottom: '1.5px solid #1a4a2e', textTransform: 'uppercase', letterSpacing: 0.3 }
const ctd = { padding: '6px 8px', borderBottom: '1px solid #e5e5e5' }
const tbtn = { padding: '7px 14px', background: '#fff', color: '#1a4a2e', border: '1px solid #ccc', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }
const sigLine = { borderTop: '1px solid #999', paddingTop: 4, width: 150, textAlign: 'center' }
