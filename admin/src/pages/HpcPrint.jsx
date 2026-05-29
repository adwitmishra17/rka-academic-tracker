import React, { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { hpcApi } from '../lib/api'
import { DOMAINS, RATINGS } from '../lib/hpcConstants'
import crest from '../assets/crest.png'

/* HPC — printable A4 (Tracker-native). Standalone route: /hpc/print?id= */

function ratingMeta(v) { return RATINGS.find(r => r.value === v) }

export default function HpcPrint() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const id = params.get('id')
  const [a, setA] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) { setError('Missing id'); setLoading(false); return }
    hpcApi.get(id).then(({ assessment }) => setA(assessment)).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div style={{ padding:40, fontFamily:'system-ui' }}>Loading HPC…</div>
  if (error)   return <div style={{ padding:40, fontFamily:'system-ui', color:'#b00' }}>{error} — <a href="#" onClick={() => navigate('/hpc')}>back</a></div>
  if (!a) return <div style={{ padding:40 }}>No data.</div>

  return (
    <div style={{ background:'#f4f4f5', minHeight:'100vh' }}>
      <div className="no-print" style={{ display:'flex', gap:12, padding:'14px 20px', background:'#fff', borderBottom:'1px solid #e5e5e5' }}>
        <button onClick={() => navigate('/hpc')} style={tbtn}>← HPC cards</button>
        <button onClick={() => window.print()} style={{ ...tbtn, marginLeft:'auto', background:'#1a4a2e', color:'#fff', border:'none' }}>Print</button>
      </div>

      <div style={{ display:'flex', justifyContent:'center', padding:20 }}>
        <div className="hpc-card" style={card_}>
          <div style={{ display:'flex', alignItems:'center', gap:14, borderBottom:'2px solid #1a4a2e', paddingBottom:12, marginBottom:14 }}>
            <img src={crest} alt="" style={{ width:58, height:58, objectFit:'contain' }} />
            <div style={{ flex:1, textAlign:'center' }}>
              <div style={{ fontSize:21, fontWeight:700, color:'#1a4a2e' }}>Radhakrishna Academy</div>
              <div style={{ fontSize:12, color:'#555' }}>{a.branches?.name || a.branches?.code || ''}</div>
              <div style={{ fontSize:13, fontWeight:600, marginTop:4 }}>HOLISTIC PROGRESS CARD · {a.exam_terms?.name || ''} {a.session_code}</div>
            </div>
            <div style={{ width:58 }} />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 24px', fontSize:12.5, marginBottom:14 }}>
            <Info label="Name" value={a.student_name} />
            <Info label="Class" value={`${a.class_name}${a.section ? ' - ' + a.section : ''}`} />
            <Info label="Admission No." value={a.admission_no} />
            <Info label="Roll No." value={a.roll_number} />
            <Info label="Father" value={a.father_name} />
            <Info label="Mother" value={a.mother_name} />
          </div>

          {DOMAINS.map(d => {
            const dom = a.domains?.[d.key] || {}
            const meta = ratingMeta(dom.rating)
            return (
              <div key={d.key} style={{ marginBottom:12, border:'1px solid #e5e5e5', borderRadius:8, overflow:'hidden' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 10px', background:'#f3f7f4' }}>
                  <span style={{ fontSize:13, fontWeight:700, color:'#1a4a2e' }}>{d.name}</span>
                  {meta && <span style={{ fontSize:11.5, fontWeight:700, color:meta.color }}>{meta.label}</span>}
                </div>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11.5 }}>
                  <tbody>
                    {d.indicators.map(ind => {
                      const im = ratingMeta(dom.indicators?.[ind.key])
                      return (
                        <tr key={ind.key}>
                          <td style={{ padding:'5px 10px', borderTop:'1px solid #eee' }}>{ind.label}</td>
                          <td style={{ padding:'5px 10px', borderTop:'1px solid #eee', textAlign:'right', width:96, fontWeight:600, color:im?.color || '#999' }}>{im?.label || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {dom.remarks && <div style={{ padding:'6px 10px', fontSize:11.5, color:'#444', fontStyle:'italic', borderTop:'1px solid #eee' }}>{dom.remarks}</div>}
              </div>
            )
          })}

          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#1a4a2e', marginBottom:4 }}>General Remarks</div>
            <div style={{ fontSize:12.5, lineHeight:1.6, color:'#222', minHeight:30 }}>{a.general_remarks || '—'}</div>
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', marginTop:36, fontSize:11.5, color:'#444' }}>
            <div style={sig}>Class Teacher</div>
            <div style={sig}>Parent / Guardian</div>
            <div style={sig}>Principal</div>
          </div>
        </div>
      </div>

      <style>{`@media print { .no-print { display:none !important } body { background:#fff !important } .hpc-card { box-shadow:none !important; width:auto !important } @page { size:A4 portrait; margin:14mm } }`}</style>
    </div>
  )
}

function Info({ label, value }) {
  return <div style={{ display:'flex', gap:6 }}><span style={{ color:'#777', minWidth:92 }}>{label}:</span><span style={{ fontWeight:600, color:'#1a1a1a' }}>{value || '—'}</span></div>
}

const card_ = { background:'#fff', color:'#1a1a1a', width:760, maxWidth:'100%', padding:'28px 32px', boxShadow:'0 2px 10px rgba(0,0,0,0.08)', boxSizing:'border-box', fontFamily:'Georgia, "Times New Roman", serif' }
const tbtn = { padding:'7px 14px', background:'#fff', color:'#1a4a2e', border:'1px solid #ccc', borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer' }
const sig = { borderTop:'1px solid #999', paddingTop:4, width:150, textAlign:'center' }
