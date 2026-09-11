import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { examApi } from '../../lib/api'

/* Standalone print route (no sidebar):
     /examinations/print?studentId=&sessionCode=&cardKey=   → live PREVIEW (not published)
     /examinations/print?published=id1,id2,…               → the frozen published cards
   The server renders each card as a complete HTML document; we lift the
   <style> once and stack the .page bodies so the browser prints one A4
   sheet per card. */

function split(html) {
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  const body = (html.match(/<body>([\s\S]*?)<\/body>/) || [])[1] || html
  return { css, body }
}

export default function ExamPrint() {
  const [params] = useSearchParams()
  const [docs, setDocs] = useState([])
  const [css, setCss] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const preview = !params.get('published')

  useEffect(() => {
    const ids = (params.get('published') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const run = async () => {
      try {
        let htmls = []
        if (ids.length) {
          const rows = await Promise.all(ids.map((id) => examApi.publishedOne(id)))
          htmls = rows.map((r) => r.html)
        } else {
          const { html } = await examApi.card(params.get('studentId'), params.get('sessionCode'), params.get('cardKey') || undefined)
          htmls = [html]
        }
        const parts = htmls.map(split)
        setCss(parts[0]?.css || ''); setDocs(parts.map((p) => p.body))
      } catch (e) { setErr(e.message || String(e)) }
      setLoading(false)
    }
    run()
  }, [params])

  if (loading) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Preparing card{params.get('published')?.includes(',') ? 's' : ''}…</div>
  if (err) return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#b00' }}>{err}</div>

  return (
    <div style={{ background: '#e9e9ea', minHeight: '100vh' }}>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e5e5', fontFamily: 'system-ui', fontSize: 13 }}>
        <button onClick={() => window.close()} style={tbtn}>Close</button>
        <span style={{ color: preview ? '#9a6b00' : '#1a4a2e', fontWeight: 600 }}>{preview ? 'PREVIEW — not published. Numbers reflect entries right now.' : `${docs.length} published card${docs.length === 1 ? '' : 's'}`}</span>
        <button onClick={() => window.print()} style={{ ...tbtn, marginLeft: 'auto', background: '#1a4a2e', color: '#fff', border: 'none' }}>Print</button>
      </div>
      <style>{css}</style>
      <style>{`@media print { .no-print { display:none !important } } .page { margin: 16px auto; box-shadow: 0 2px 12px rgba(0,0,0,0.12) } @media print { .page { margin: 0; box-shadow: none } }`}</style>
      {docs.map((b, i) => <div key={i} dangerouslySetInnerHTML={{ __html: b }} />)}
    </div>
  )
}
const tbtn = { padding: '7px 14px', background: '#fff', color: '#1a4a2e', border: '1px solid #ccc', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }
