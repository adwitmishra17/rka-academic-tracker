import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { hpcApi } from '../lib/api'

/* HPC print — the four-page playful card, rendered by the server
   (lib/hpcRender.js) and frozen on each assessment for SMS to print too.
   Route: /hpc/print?ids=a,b,c (or ?id=). Every visit re-renders, so the
   attendance table and photo are current. */

export default function HpcPrint() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const ids = (params.get('ids') || params.get('id') || '').split(',').map(s => s.trim()).filter(Boolean)
  const [html, setHtml] = useState('')
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const frame = useRef(null)

  useEffect(() => {
    if (!ids.length) { setError('No card selected'); setLoading(false); return }
    setLoading(true); setError(null)
    hpcApi.render(ids).then(({ html, cards }) => { setHtml(html); setCards(cards) }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [params.get('ids'), params.get('id')]) // eslint-disable-line

  const print = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print() } }

  return (
    <div style={{ background:'#E9E6DE', minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', gap:12, alignItems:'center', padding:'12px 20px', background:'#fff', borderBottom:'1px solid #e5e5e5' }}>
        <button onClick={() => navigate('/hpc')} style={tbtn}>← HPC cards</button>
        <span style={{ fontSize:13, color:'#555' }}>{loading ? 'Rendering…' : `${cards.length} card${cards.length === 1 ? '' : 's'} · 4 pages each · two sheets, print both sides`}</span>
        <button onClick={print} disabled={loading || !html} style={{ ...tbtn, marginLeft:'auto', background:'#1a4a2e', color:'#fff', border:'none' }}>Print</button>
      </div>
      {error && <div style={{ padding:40, fontFamily:'system-ui', color:'#b00' }}>{error}</div>}
      {loading && <div style={{ padding:40, fontFamily:'system-ui', color:'#555' }}>Rendering the cards — fetching attendance, photos and the class teacher…</div>}
      {!loading && html && <iframe ref={frame} title="HPC cards" srcDoc={html} style={{ flex:1, width:'100%', border:'none', minHeight:'calc(100vh - 54px)' }} />}
    </div>
  )
}
const tbtn = { padding:'7px 14px', background:'#fff', color:'#1a4a2e', border:'1px solid #ccc', borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer' }
