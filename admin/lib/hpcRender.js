// ============================================================================
// admin/lib/hpcRender.js — Holistic Progress Card → four A4 pages of HTML.
//
// Playful, modelled on the CBSE / PARAKH Foundational Stage card:
//   sheet 1 front  cover · child details · monthly attendance
//   sheet 1 back   "Me and my surroundings" (child fills in by hand)
//   sheet 2 front  "How I am growing" — every domain, indicator dots, strengths, next steps
//   sheet 2 back   "How I feel about school" (child/peer/parent by hand) · teacher's summary
// The same string is stored on hpc_assessments.rendered_html (SMS prints it)
// and shown in the Tracker print page. Pure: no I/O.
// ============================================================================

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const assetBase = () => (process.env.CARD_ASSET_BASE || 'https://tracker.rkacademyballia.in').replace(/\/$/, '')
const DOT = ['#F7C948', '#F28C28', '#5DBB63', '#4FB3E8']              // level 1..4
const DOM_COLOURS = ['#F26B5B', '#8E5BC9', '#4FB3E8', '#5DBB63', '#F28C28', '#E0569B', '#2AA8A0', '#B5651D']
const DOM_ICONS = { physical: '🏃', socio: '💛', cognitive: '🧩', language: '📚', numeracy: '🔢', aesthetic: '🎨', habits: '🌟' }
const MONTHS = [['04', 'Apr'], ['05', 'May'], ['06', 'Jun'], ['07', 'Jul'], ['08', 'Aug'], ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'], ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar']]
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
const firstName = (s) => titleCase(String(s || '').trim().split(/\s+/)[0] || '')
const dmyLong = (iso) => { if (!iso) return null; const d = new Date(iso); if (isNaN(d)) return null; return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }
const dayMonth = (iso) => { if (!iso) return null; const d = new Date(iso); if (isNaN(d)) return null; return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) }
const ageYears = (iso, at = new Date()) => { if (!iso) return null; const d = new Date(iso); if (isNaN(d)) return null; let a = at.getFullYear() - d.getFullYear(); const m = at.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && at.getDate() < d.getDate())) a -= 1; return a }

export const HPC_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap');
  :root{--sky:#4FB3E8;--sky-soft:#E3F3FC;--coral:#F26B5B;--coral-soft:#FDE4E0;--sun:#F7C948;--sun-soft:#FFF3C7;--leaf:#5DBB63;--leaf-soft:#E2F4E3;--grape:#8E5BC9;--grape-soft:#EEE4F9;--tang:#F28C28;--tang-soft:#FDE9D6;--ink:#2B2B3A;--muted:#6E6E80;--paper:#FFFDF7;--line:#E8E3D6}
  *{box-sizing:border-box}
  html{color-scheme:light}
  body{margin:0;background:#E9E6DE;color:var(--ink);font-family:Nunito,system-ui,sans-serif;font-size:12px;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;height:297mm;margin:16px auto;background:var(--paper);position:relative;overflow:hidden;padding:12mm 13mm;display:flex;flex-direction:column;gap:5mm}
  h1,h2,h3{font-family:Fredoka,sans-serif;margin:0;font-weight:600}
  .deco{position:absolute;pointer-events:none}
  .hd{display:flex;align-items:center;gap:10px}
  .hd img.crest{width:38px;height:38px;object-fit:contain}
  .hd .name{font-family:Fredoka;font-weight:700;font-size:15px;letter-spacing:.04em}
  .hd img.wordmark{display:block;height:30px;width:auto;max-width:200px;margin-bottom:2px}
  .hd .sub{font-size:10px;color:var(--muted)}
  .hd .tag{margin-left:auto;background:var(--sky);color:#fff;font-family:Fredoka;font-weight:600;padding:4px 12px;border-radius:999px;font-size:11px;white-space:nowrap}
  .band{display:inline-block;background:var(--tang);color:#fff;font-family:Fredoka;font-weight:700;font-size:17px;padding:6px 18px;border-radius:999px;letter-spacing:.04em}
  .cover{background:linear-gradient(180deg,#EAF6FD 0%,#FFF9E3 100%);justify-content:space-between}
  .cover .title{font-family:Fredoka;line-height:.95;margin-top:14mm}
  .cover .title .a{font-size:40px;color:var(--coral);font-weight:700;letter-spacing:.02em}
  .cover .title .b{font-size:50px;color:var(--sky);font-weight:700}
  .cover .title .c{font-size:50px;color:var(--grape);font-weight:700}
  .cover .session{display:inline-block;border:2.5px dashed var(--ink);border-radius:999px;padding:5px 16px;font-family:Fredoka;font-weight:600;font-size:16px;letter-spacing:.2em;background:#fff}
  .cover .child{background:#fff;border-radius:18px;padding:12px 16px;box-shadow:0 6px 0 var(--sun);display:flex;gap:14px;align-items:center;margin-top:2mm}
  .photo{width:30mm;height:34mm;border-radius:14px;background:var(--sky-soft);border:3px solid #fff;box-shadow:0 0 0 2px var(--sky);display:grid;place-items:center;color:var(--sky);font-family:Fredoka;font-size:11px;text-align:center;overflow:hidden;flex-shrink:0}
  .photo img{width:100%;height:100%;object-fit:cover;display:block}
  .child .nm{font-family:Fredoka;font-size:24px;font-weight:700;color:var(--ink)}
  .info{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 12px;font-size:11px;margin-top:8px}
  .info div span{display:block;font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .info div b{font-family:Fredoka;font-weight:600;font-size:12.5px}
  .cover .foot{font-size:11px;color:var(--muted)}
  .cover .foot b{font-family:Fredoka;font-size:14px;color:var(--ink);display:block}
  .attwrap{background:#fff;border-radius:16px;padding:10px 12px;box-shadow:0 4px 0 var(--sky-soft);position:relative;z-index:1}
  .attwrap h3{color:var(--sky);font-size:13px;margin-bottom:6px}
  table{width:100%;border-collapse:collapse}
  .att th{font-family:Fredoka;font-weight:600;font-size:10.5px;background:var(--sky-soft);padding:4px 3px;border:1px solid #fff;text-align:center}
  .att td{padding:4px 3px;text-align:center;border-bottom:1px solid var(--line);font-size:10.5px}
  .att td:first-child{text-align:left;font-weight:700;color:var(--muted)}
  .att td.pct{font-weight:800;color:var(--leaf)}
  .me{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
  .blob{border-radius:18px;padding:10px 12px;position:relative}
  .blob h3{font-size:14px;margin-bottom:6px}
  .blob .fill{font-family:Fredoka;font-size:16px;font-weight:600}
  .blob .line{border-bottom:2px dotted var(--muted);height:20px}
  .box{border:3px solid;border-radius:16px;background:#fff;min-height:44mm;display:grid;place-items:center;color:var(--muted);font-style:italic}
  .fav{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}
  .fav div{display:flex;align-items:center;gap:6px;font-family:Fredoka;font-weight:600;font-size:12px}
  .fav div span{flex:1;height:18px;border-radius:6px;background:var(--tang-soft)}
  .quote{border-left:5px solid var(--sky);padding:6px 12px;font-style:italic;color:var(--muted);font-size:11px;background:#fff;border-radius:0 12px 12px 0}
  .legend{display:flex;gap:8px;align-items:center;font-size:10.5px;color:var(--muted);white-space:nowrap}
  .legend b{font-family:Fredoka;font-weight:600;color:var(--ink);margin-left:4px}
  .legend .lad{display:flex;gap:4px;align-items:center}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:4mm 5mm}
  .dom{border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 3px 0 var(--line)}
  .dom .top{display:flex;align-items:center;gap:8px;padding:5px 9px;color:#fff}
  .dom .top .ic{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.28);display:grid;place-items:center;font-size:12px}
  .dom .top h3{font-size:11.5px;flex:1}
  .dom .top .lvl{font-family:Fredoka;font-weight:700;font-size:10px;background:#fff;border-radius:999px;padding:2px 8px}
  .ind{display:grid;grid-template-columns:1fr auto;gap:0 6px;padding:4px 9px 7px}
  .ind .lab{padding:6px 0;border-bottom:1px dotted var(--line);font-size:10px;line-height:1.25}
  .ind .lad{display:flex;gap:4px;align-items:center;padding:6px 0;border-bottom:1px dotted var(--line)}
  .lad i{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--line);background:#fff;display:block}
  .lad i.on{border-color:transparent}
  .lad small{font-family:Fredoka;font-weight:600;font-size:8.5px;width:52px;margin-left:2px}
  .dom .note{font-size:9.5px;padding:2px 9px 6px;font-style:italic;color:var(--muted)}
  .chk{display:flex;flex-wrap:wrap;gap:8px}
  .chk span{border:2px solid var(--grape);border-radius:999px;padding:4px 10px;font-family:Fredoka;font-weight:600;font-size:11px;background:#fff}
  .feel{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
  .smile{display:flex;justify-content:space-around;padding:8px 0}
  .smile div{width:40px;height:40px;border-radius:50%;border:2.5px solid var(--tang);display:grid;place-items:center;font-size:22px;background:#fff}
  .sum{background:#fff;border:3px solid var(--leaf);border-radius:18px;padding:12px 14px;flex:1}
  .sum h3{font-size:14px;color:var(--leaf);margin-bottom:6px}
  .sum p{margin:0;font-size:12.5px;line-height:1.55;font-style:italic}
  .sig{display:flex;justify-content:space-between;margin-top:auto;font-family:Fredoka;font-weight:600;font-size:11px;color:var(--muted)}
  .sig div{width:48mm;border-top:2px solid var(--ink);text-align:center;padding-top:4px}
  .pg{position:absolute;bottom:6mm;right:13mm;font-size:9px;color:var(--muted);font-family:Fredoka}
  .rec{position:absolute;bottom:6mm;left:13mm;font-size:8px;color:var(--muted);font-family:ui-monospace,monospace}
  @media print{body{background:#fff}.page{margin:0;page-break-after:always}@page{size:A4 portrait;margin:0}}
`

/**
 * card = {
 *   assessment: hpc_assessments row (+ branches{code,name}, exam_terms{name,short_code,session_code})
 *   def:        the session's HPC definition (classes, scale, domains…)
 *   extras:     { attendance:{ byMonth:{ '04':{marked,present}… }, marked, present }, heightCm, weightKg,
 *                 classTeacher, photoDataUrl, schoolLine, branchLine, printedAt }
 * }
 */
export function renderHpcHtml(card) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(card.assessment.student_name)} · HPC ${esc(card.assessment.session_code)}</title><style>${HPC_CSS}</style></head><body>${renderHpcPages(card)}</body></html>`
}
export function renderHpcDocument(cards) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Holistic Progress Cards</title><style>${HPC_CSS}</style></head><body>${cards.map(renderHpcPages).join('\n')}</body></html>`
}

export function renderHpcPages(card) {
  const a = card.assessment, def = card.def, x = card.extras || {}
  const scale = def.scale?.options || []
  const levelIdx = (v) => scale.findIndex((o) => o.value === v)
  const meta = (v) => scale.find((o) => o.value === v)
  const cls = `${a.class_name || ''}${a.section ? ' – ' + a.section : ''}`
  const termLabel = a.exam_terms?.name || ''
  const branchName = String(a.branches?.name || a.branches?.code || '').replace(/^Radhakrishna Academy\s*[—–-]\s*/i, '')
  const first = firstName(a.student_name)
  const tag = `${esc(first)} · ${esc((a.class_name || '').replace(/^Class /, ''))}${a.section ? '-' + esc(a.section) : ''}`
  const recordNo = `HPC/${a.branches?.code || 'RKA'}/${a.session_code}/${a.exam_terms?.short_code || ''}/${a.admission_no || ''}`
  const summary = (a.domains && a.domains._summary) || {}
  const lines = (arr) => (Array.isArray(arr) ? arr : String(arr || '').split(/\n|;/)).map((t) => String(t).trim()).filter(Boolean)
  const strengths = lines(summary.strengths), canDo = lines(summary.canDo), next = lines(summary.next)

  const hd = (sub) => `<div class="hd"><img class="crest" src="${assetBase()}/crest-card.png" alt="" onerror="this.style.visibility='hidden'"><div><img class="wordmark" src="${assetBase()}/banner-card.png?v=3" alt="RADHAKRISHNA ACADEMY" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'name',textContent:'RADHAKRISHNA ACADEMY'}))"><div class="sub">${esc(sub)}</div></div><div class="tag">${tag}</div></div>`

  // ── dots ────────────────────────────────────────────────────────────────
  const dots = (v) => { const i = levelIdx(v); return `<span class="lad">${scale.map((_, k) => `<i class="${k <= i && i >= 0 ? 'on' : ''}" style="${k <= i && i >= 0 ? `background:${DOT[Math.min(k, 3)]}` : ''}"></i>`).join('')}<small>${i >= 0 ? esc(meta(v).label) : '—'}</small></span>` }
  const overallOf = (dom) => { const d = a.domains?.[dom.key] || {}; if (d.rating) return d.rating; const vals = Object.values(d.indicators || {}).filter(Boolean); if (!vals.length) return null; const counts = new Map(); for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1); let best = null, n = -1; for (const [v, c] of counts) if (c > n || (c === n && levelIdx(v) > levelIdx(best))) { best = v; n = c } return best }
  const domCard = (dom, i) => {
    const d = a.domains?.[dom.key] || {}
    const ov = overallOf(dom); const om = meta(ov)
    const colour = dom.colour || DOM_COLOURS[i % DOM_COLOURS.length]
    const icon = dom.icon || DOM_ICONS[dom.key] || '⭐'
    return `<div class="dom"><div class="top" style="background:${colour}"><div class="ic">${icon}</div><h3>${esc(dom.name)}</h3>${om ? `<span class="lvl" style="color:${colour}">${esc(om.label)}</span>` : ''}</div>
      <div class="ind">${(dom.indicators || []).map((ind) => `<div class="lab">${esc(ind.label)}</div>${dots(d.indicators?.[ind.key])}`).join('')}</div>
      ${def.domainRemarks !== false && d.remarks ? `<div class="note">Teacher's note: ${esc(d.remarks)}</div>` : ''}</div>`
  }

  // ── attendance ──────────────────────────────────────────────────────────
  const att = x.attendance || { byMonth: {} }
  const mrow = (label, f, cls2 = '') => `<tr><td>${label}</td>${MONTHS.map(([m]) => { const c = att.byMonth?.[m]; return `<td class="${cls2}">${c ? f(c) : ''}</td>` }).join('')}<td class="${cls2}">${att.marked ? f({ marked: att.marked, present: att.present }) : ''}</td></tr>`
  const pct = (c) => (c.marked ? `${Math.round(100 * c.present / c.marked)}%` : '')
  const attTable = `<table class="att"><thead><tr><th style="text-align:left">Month</th>${MONTHS.map(([, n]) => `<th>${n}</th>`).join('')}<th>Total</th></tr></thead><tbody>
    ${mrow('School days', (c) => c.marked)}${mrow('Days present', (c) => Math.round(c.present))}${mrow('Attendance', pct, 'pct')}</tbody></table>`

  // ── page 1 · cover ──────────────────────────────────────────────────────
  const p1 = `<div class="page cover">
  <svg class="deco" style="left:-20mm;top:-20mm" width="200" height="200" viewBox="0 0 220 220"><circle cx="110" cy="110" r="110" fill="#FDE4E0"/></svg>
  <svg class="deco" style="right:-34mm;top:34mm" width="240" height="240" viewBox="0 0 260 260"><circle cx="130" cy="130" r="130" fill="#FFF3C7"/></svg>
  <svg class="deco" style="right:16mm;top:12mm" width="60" height="60" viewBox="0 0 24 24"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7.1L12 17.3 5.7 21l1.7-7.1L2 9.2l7.1-.6z" fill="#F7C948"/></svg>
  <svg class="deco" style="right:52mm;top:26mm" width="30" height="30" viewBox="0 0 24 24"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7.1L12 17.3 5.7 21l1.7-7.1L2 9.2l7.1-.6z" fill="#F26B5B"/></svg>
  <svg class="deco" style="right:14mm;top:118mm" width="70" height="90" viewBox="0 0 60 80"><ellipse cx="30" cy="30" rx="26" ry="30" fill="#8E5BC9"/><path d="M30 60 q6 8 -4 18" stroke="#8E5BC9" stroke-width="2" fill="none"/></svg>
  <svg class="deco" style="right:40mm;top:132mm" width="52" height="66" viewBox="0 0 60 80"><ellipse cx="30" cy="30" rx="26" ry="30" fill="#4FB3E8"/><path d="M30 60 q-6 8 4 18" stroke="#4FB3E8" stroke-width="2" fill="none"/></svg>
  <div class="hd" style="position:relative;z-index:1"><img class="crest" src="${assetBase()}/crest-card.png" alt="" onerror="this.style.visibility='hidden'"><div><img class="wordmark" src="${assetBase()}/banner-card.png?v=3" alt="RADHAKRISHNA ACADEMY" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'name',textContent:'RADHAKRISHNA ACADEMY'}))"><div class="sub">Affiliated to CBSE, New Delhi${branchName ? ' · ' + esc(branchName) : ''} · Ballia</div></div></div>
  <div style="position:relative;z-index:1">
    <div class="session">SESSION ${esc(a.session_code)}</div>
    <div class="title"><div class="a">HOLISTIC</div><div class="b">PROGRESS</div><div class="c">CARD</div></div>
    <div style="font-family:Fredoka;font-size:14px;color:var(--muted);margin-top:6px">Foundational Stage · ${esc(a.class_name || '')}${termLabel ? ' · ' + esc(termLabel) : ''}</div>
  </div>
  <div class="child" style="position:relative;z-index:1">
    <div class="photo">${x.photoDataUrl ? `<img src="${x.photoDataUrl}" alt="">` : "child's<br>photo"}</div>
    <div style="flex:1"><div class="nm">${esc(titleCase(a.student_name))}</div>
      <div class="info">
        <div><span>Class</span><b>${esc(cls) || '—'}</b></div><div><span>Roll no.</span><b>${esc(a.roll_number) || '—'}</b></div><div><span>Admission no.</span><b>${esc(a.admission_no) || '—'}</b></div>
        <div><span>Date of birth</span><b>${esc(dmyLong(a.date_of_birth)) || '—'}</b></div><div><span>Father</span><b>${esc(titleCase(a.father_name)) || '—'}</b></div><div><span>Mother</span><b>${esc(titleCase(a.mother_name)) || '—'}</b></div>
        <div><span>Class teacher</span><b>${esc(x.classTeacher) || '—'}</b></div><div><span>Height</span><b>${x.heightCm ? esc(x.heightCm) + ' cm' : '—'}</b></div><div><span>Weight</span><b>${x.weightKg ? esc(x.weightKg) + ' kg' : '—'}</b></div>
      </div></div>
  </div>
  <div class="attwrap"><h3>My days at school</h3>${attTable}</div>
  <div class="foot" style="position:relative;z-index:1"><b>Every child is unique and learns in their own way, at their own pace.</b>National Curriculum Framework for the Foundational Stage, 2022</div>
</div>`

  // ── page 2 · me and my surroundings ─────────────────────────────────────
  const age = ageYears(a.date_of_birth, x.printedAt ? new Date(x.printedAt) : new Date())
  const p2 = `<div class="page">
  ${hd(`Holistic Progress Card · ${a.session_code}`)}
  <div style="text-align:center"><span class="band">ME AND MY SURROUNDINGS</span></div>
  <div class="me">
    <div class="blob" style="background:var(--sky-soft)"><h3 style="color:var(--sky)">This is me</h3><div class="box" style="border-color:var(--sky)">draw or stick a picture</div></div>
    <div style="display:flex;flex-direction:column;gap:5mm">
      <div class="blob" style="background:var(--sun-soft)"><h3 style="color:var(--tang)">I am <span class="fill" style="background:#fff;border-radius:999px;padding:0 10px">${age ?? '&nbsp;&nbsp;&nbsp;'}</span> years old</h3><div style="font-size:11px;color:var(--muted)">My birthday is on <span class="fill" style="font-size:13px;color:var(--ink)">${esc(dayMonth(a.date_of_birth)) || '………………'}</span></div></div>
      <div class="blob" style="background:var(--grape-soft)"><h3 style="color:var(--grape)">I live in</h3><div class="line"></div><div class="line"></div></div>
      <div class="blob" style="background:var(--coral-soft)"><h3 style="color:var(--coral)">I want to be a</h3><div class="line"></div><div style="font-family:Fredoka;font-weight:600;font-size:12px;margin-top:4px;text-align:right">when I grow up</div></div>
    </div>
    <div class="blob" style="background:var(--leaf-soft)"><h3 style="color:var(--leaf)">This is my family</h3><div style="font-size:11px;margin-bottom:6px">Papa <b>${esc(titleCase(a.father_name)) || '……'}</b> · Mummy <b>${esc(titleCase(a.mother_name)) || '……'}</b></div><div class="box" style="border-color:var(--leaf);min-height:30mm">draw your family</div></div>
    <div class="blob" style="background:var(--sky-soft)"><h3 style="color:var(--sky)">These are my friends</h3><div class="line"></div><div class="line"></div><div class="line"></div><div class="line"></div></div>
  </div>
  <div class="blob" style="background:#fff;border:3px solid var(--sun)"><h3 style="color:var(--tang);text-align:center">My favourite</h3>
    <div class="fav"><div>🎨 Colour <span></span></div><div>🌸 Flower <span></span></div><div>🍛 Food <span></span></div><div>⚽ Sport <span></span></div><div>🐘 Animal <span></span></div><div>📖 Subject <span></span></div></div></div>
  <div class="me" style="flex:1">
    <div class="blob" style="background:var(--sun-soft);display:flex;flex-direction:column"><h3 style="color:var(--tang)">My hand print</h3><div class="box" style="border-color:var(--sun);flex:1;min-height:0">press your painted hand here</div></div>
    <div class="blob" style="background:var(--grape-soft)"><h3 style="color:var(--grape)">At school I love to</h3><div class="chk"><span>🎨 paint</span><span>🎵 sing</span><span>📚 hear stories</span><span>🏃 run &amp; play</span><span>🧩 do puzzles</span><span>💃 dance</span><span>🧱 build blocks</span><span>🌱 water plants</span></div><div style="font-size:10px;color:var(--muted);margin-top:8px">colour the ones you love</div></div>
  </div>
  <div class="quote">For the child to fill in at home or in class — drawings, stickers, or help from the family. It is part of the card, not a worksheet.</div>
  <div class="pg">2</div>
</div>`

  // ── page 3 · how I am growing ───────────────────────────────────────────
  const legend = `<div class="legend"><span>How to read the dots</span>${scale.map((o, i) => `<span class="lad" style="${i ? 'margin-left:8px' : ''}">${scale.map((_, k) => `<i class="${k <= i ? 'on' : ''}" style="${k <= i ? `background:${DOT[Math.min(k, 3)]}` : ''}"></i>`).join('')}</span><b>${esc(o.label)}</b>`).join('')}</div>`
  const p3 = `<div class="page">
  ${hd(`Holistic Progress Card · ${a.session_code}${termLabel ? ' · ' + termLabel : ''}`)}
  <div style="text-align:center"><span class="band" style="background:var(--leaf)">HOW I AM GROWING</span></div>
  ${legend}
  <div class="two">${(def.domains || []).map(domCard).join('')}</div>
  ${strengths.length ? `<div style="text-align:center"><span class="band" style="background:var(--grape);font-size:14px;padding:5px 14px">MY STRENGTHS THIS TERM</span></div><div class="chk" style="justify-content:center">${strengths.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
  <div class="me" style="flex:1">
    <div class="blob" style="background:var(--leaf-soft)"><h3 style="color:var(--leaf);font-size:12.5px">Things I can do now</h3><div style="font-size:11px;line-height:1.7">${canDo.length ? canDo.map((s) => `✔ ${esc(s)}`).join('<br>') : '<span style="color:var(--muted)">—</span>'}</div></div>
    <div class="blob" style="background:var(--sky-soft)"><h3 style="color:var(--sky);font-size:12.5px">Next, we will work on</h3><div style="font-size:11px;line-height:1.7">${next.length ? next.map((s) => `→ ${esc(s)}`).join('<br>') : '<span style="color:var(--muted)">—</span>'}</div>${next.length ? '<div style="font-size:10px;color:var(--muted);margin-top:8px">Written by the class teacher from the ratings above — not a mark, a next step.</div>' : ''}</div>
  </div>
  <div class="pg">3</div>
</div>`

  // ── page 4 · how I feel · family · summary ──────────────────────────────
  const p4 = `<div class="page">
  ${hd(`Holistic Progress Card · ${a.session_code}`)}
  <div style="text-align:center"><span class="band" style="background:var(--coral)">HOW I FEEL ABOUT SCHOOL</span></div>
  <div class="feel">
    <div class="blob" style="background:var(--sun-soft)"><h3 style="color:var(--tang)">I like coming to school</h3><div class="smile"><div>😊</div><div>😐</div><div>🤔</div></div><p style="margin:0;text-align:center;font-size:10px;color:var(--muted)">circle one</p></div>
    <div class="blob" style="background:var(--sky-soft)"><h3 style="color:var(--sky)">I find my work easy</h3><div class="smile"><div>😊</div><div>😐</div><div>🤔</div></div><p style="margin:0;text-align:center;font-size:10px;color:var(--muted)">circle one</p></div>
    <div class="blob" style="background:var(--grape-soft);grid-column:1/-1"><h3 style="color:var(--grape)">To do my work, I get help from</h3><div class="chk"><span>👫 my friends</span><span>👩‍🏫 my teacher</span><span>📚 books</span><span>💻 a computer</span><span>🙋 nobody, I do it myself</span></div></div>
    <div class="blob" style="background:var(--leaf-soft)"><h3 style="color:var(--leaf)">My friend says about me</h3><div class="line"></div><div class="line"></div><div class="line"></div></div>
    <div class="blob" style="background:var(--coral-soft)"><h3 style="color:var(--coral)">At home we have</h3><div class="chk"><span>📖 books</span><span>📰 newspaper</span><span>🧸 toys &amp; games</span><span>📱 phone</span><span>📺 TV</span><span>📻 radio</span></div><div style="font-size:10px;color:var(--muted);margin-top:6px">Parents please tick</div></div>
  </div>
  <div class="blob" style="background:var(--sun-soft)"><h3 style="color:var(--tang)">A note from my family</h3><div style="font-size:10px;color:var(--muted);margin-bottom:4px">Parents, tell us something your child did this term that made you proud.</div><div class="line"></div><div class="line"></div><div class="line"></div></div>
  ${def.generalRemarks !== false ? `<div class="sum"><h3>Teacher's summary${termLabel ? ' · ' + esc(termLabel) : ''}</h3><p>${esc(a.general_remarks) || '<span style="color:var(--muted);font-style:normal">—</span>'}</p></div>` : ''}
  <div style="font-size:10px;color:var(--muted)">This card describes progress, not marks. There are no grades or ranks at the Foundational Stage — every child is assessed against their own growth, as recommended by NCF-FS 2022 and the CBSE Holistic Progress Card.</div>
  <div class="sig"><div>Class Teacher</div><div>Parent / Guardian</div><div>Principal</div></div>
  <div class="rec">${esc(recordNo)} · ${esc(x.printedAt ? new Date(x.printedAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB'))}</div>
  <div class="pg">4</div>
</div>`

  return p1 + p2 + p3 + p4
}
