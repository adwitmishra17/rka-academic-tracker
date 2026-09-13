import React, { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { hpcApi } from '../lib/api'
import { DEFAULT_HPC_DEFINITION, domainRatingFromIndicators } from '../../lib/hpcDefaults.js'
import crest from '../assets/crest.png'
import bannerLight from '../assets/banner-light.png'

/* HPC — printable A4, one card per page. Route: /hpc/print?ids=a,b,c (or ?id=)
   Layout comes from the session's HPC setup (domains, indicators, scale). */

export default function HpcPrint() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const ids = (params.get('ids') || params.get('id') || '').split(',').map(s => s.trim()).filter(Boolean)
  const [cards, setCards] = useState([])
  const [defs, setDefs] = useState({})       // sessionCode → definition
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!ids.length) { setError('No card selected'); setLoading(false); return }
    Promise.all(ids.map(id => hpcApi.get(id).then(r => r.assessment).catch(() => null))).then(async (list) => {
      const rows = list.filter(Boolean); setCards(rows)
      const sessions = [...new Set(rows.map(a => a.session_code))]
      const d = {}
      await Promise.all(sessions.map(sc => hpcApi.setup(sc).then(({ template }) => { d[sc] = template?.definition || DEFAULT_HPC_DEFINITION }).catch(() => { d[sc] = DEFAULT_HPC_DEFINITION })))
      setDefs(d)
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [params.get('ids'), params.get('id')]) // eslint-disable-line

  if (loading) return <div style={{ padding:40, fontFamily:'system-ui' }}>Loading HPC…</div>
  if (error)   return <div style={{ padding:40, fontFamily:'system-ui', color:'#b00' }}>{error} — <a href="#" onClick={() => navigate('/hpc')}>back</a></div>

  return (
    <div style={{ background:'#f4f4f5', minHeight:'100vh' }}>
      <div className="no-print" style={{ display:'flex', gap:12, padding:'14px 20px', background:'#fff', borderBottom:'1px solid #e5e5e5' }}>
        <button onClick={() => navigate('/hpc')} style={tbtn}>← HPC cards</button>
        <span style={{ alignSelf:'center', fontSize:13, color:'#555' }}>{cards.length} card{cards.length === 1 ? '' : 's'}</span>
        <button onClick={() => window.print()} style={{ ...tbtn, marginLeft:'auto', background:'#1a4a2e', color:'#fff', border:'none' }}>Print</button>
      </div>
      {cards.map(a => <Card key={a.id} a={a} def={defs[a.session_code] || DEFAULT_HPC_DEFINITION} />)}
      <style>{`@media print { .no-print { display:none !important } body { background:#fff !important } .hpc-wrap { padding:0 !important } .hpc-card { box-shadow:none !important; width:auto !important; page-break-after:always } @page { size:A4 portrait; margin:12mm } }`}</style>
    </div>
  )
}

function Card({ a, def }) {
  const options = def.scale?.options || []
  const meta = (v) => options.find(o => o.value === v)
  return (
    <div className="hpc-wrap" style={{ display:'flex', justifyContent:'center', padding:20 }}>
      <div className="hpc-card" style={card_}>
        <div style={{ display:'flex', alignItems:'center', gap:14, borderBottom:'2px solid #1a4a2e', paddingBottom:12, marginBottom:12 }}>
          <img src={crest} alt="" style={{ width:58, height:58, objectFit:'contain' }} />
          <div style={{ flex:1, textAlign:'center' }}>
            <img src={bannerLight} alt="Radhakrishna Academy" style={{ display:'block', width:'100%', maxWidth:320, height:'auto', margin:'0 auto' }} />
            <div style={{ fontSize:12, color:'#555', marginTop:4 }}>{a.branches?.name || a.branches?.code || ''}</div>
            <div style={{ fontSize:13, fontWeight:600, marginTop:4 }}>{def.title || 'HOLISTIC PROGRESS CARD'} · {a.exam_terms?.name || ''} {a.session_code}</div>
          </div>
          <div style={{ width:58 }} />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 24px', fontSize:12.5, marginBottom:12 }}>
          <Info label="Name" value={a.student_name} />
          <Info label="Class" value={`${a.class_name}${a.section ? ' - ' + a.section : ''}`} />
          <Info label="Admission No." value={a.admission_no} />
          <Info label="Roll No." value={a.roll_number} />
          <Info label="Father" value={a.father_name} />
          <Info label="Mother" value={a.mother_name} />
        </div>

        <div style={{ display:'flex', gap:14, fontSize:10.5, color:'#555', marginBottom:8, flexWrap:'wrap' }}>
          {options.map(o => <span key={o.value}><b style={{ color:o.color }}>{o.short}</b> {o.label}</span>)}
        </div>

        {def.domains.map(d => {
          const dom = a.domains?.[d.key] || {}
          const overall = dom.rating || domainRatingFromIndicators(dom.indicators || {}, def.scale)
          const om = meta(overall)
          return (
            <div key={d.key} style={{ marginBottom:9, border:'1px solid #e5e5e5', borderRadius:8, overflow:'hidden' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', background:'#f3f7f4' }}>
                <span style={{ fontSize:12.5, fontWeight:700, color:'#1a4a2e' }}>{d.name}</span>
                {om && <span style={{ fontSize:11.5, fontWeight:700, color:om.color }}>{om.label}</span>}
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11.5 }}>
                <tbody>
                  {(d.indicators || []).map(ind => {
                    const im = meta(dom.indicators?.[ind.key])
                    return (
                      <tr key={ind.key}>
                        <td style={{ padding:'4px 10px', borderTop:'1px solid #eee' }}>{ind.label}</td>
                        <td style={{ padding:'4px 10px', borderTop:'1px solid #eee', textAlign:'right', width:96, fontWeight:600, color:im?.color || '#999' }}>{im?.label || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {def.domainRemarks !== false && dom.remarks && <div style={{ padding:'5px 10px', fontSize:11.5, color:'#444', fontStyle:'italic', borderTop:'1px solid #eee' }}>{dom.remarks}</div>}
            </div>
          )
        })}

        {def.generalRemarks !== false && (
          <div style={{ marginTop:8 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#1a4a2e', marginBottom:4 }}>General Remarks</div>
            <div style={{ fontSize:12.5, lineHeight:1.6, color:'#222', minHeight:30 }}>{a.general_remarks || '—'}</div>
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', marginTop:30, fontSize:11.5, color:'#444' }}>
          <div style={sig}>Class Teacher</div>
          <div style={sig}>Parent / Guardian</div>
          <div style={sig}>Principal</div>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }) {
  return <div style={{ display:'flex', gap:6 }}><span style={{ color:'#777', minWidth:92 }}>{label}:</span><span style={{ fontWeight:600, color:'#1a1a1a' }}>{value || '—'}</span></div>
}
const card_ = { background:'#fff', color:'#1a1a1a', width:760, maxWidth:'100%', padding:'28px 32px', boxShadow:'0 2px 10px rgba(0,0,0,0.08)', boxSizing:'border-box', fontFamily:'Georgia, "Times New Roman", serif' }
const tbtn = { padding:'7px 14px', background:'#fff', color:'#1a4a2e', border:'1px solid #ccc', borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer' }
const sig = { borderTop:'1px solid #999', paddingTop:4, width:150, textAlign:'center' }
