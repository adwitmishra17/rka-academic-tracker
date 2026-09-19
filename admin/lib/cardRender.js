// ============================================================================
// admin/lib/cardRender.js — engine card → self-contained A4 HTML ("Passport").
//
// The SAME string is previewed in the Examinations window, frozen into
// published_report_cards.html at publish time, printed from SMS and shown in
// the parent app. Look: cream paper, near-black ink, one maroon accent; Lora
// for names/headings, JetBrains Mono for record numbers, Inter for the rest.
// One page layout for every family; only the marks table changes shape.
// Interim (single-term) cards carry section average/highest; final cards
// carry both terms side by side and the session total.
// ============================================================================

// Only the crest loads by URL (public/ file, no auth). Read lazily: imports are
// hoisted above server.js's dotenv.config(), so a module-level read would miss
// a .env.local override in local dev.
const assetBase = () => (process.env.CARD_ASSET_BASE || 'https://tracker.rkacademyballia.in').replace(/\/$/, '')
const AFFILIATION = '2133183', SCHOOL_CODE = '71447'
const ADDRESS = 'Affiliated to CBSE, New Delhi · Ballia, Uttar Pradesh'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const dash = '—'
const fmt = (v) => (v == null ? dash : String(v))
const pct1 = (v) => (v == null ? dash : `${Number(v).toFixed(1)}%`)
const cellVal = (c) => (!c || c.hidden ? '' : c.missing ? dash : c.absent ? 'AB' : fmt(c.value))
const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, '&').replace(/\bLng\b/, 'Lng').replace(/\bGk\b/, 'GK').replace(/\bLit\b/, 'Lit.').replace(/\bEvs\b/, 'EVS').replace(/\bIt\b/, 'IT').replace(/\bIp\b/, 'IP')
const dmy = (d) => { try { const x = new Date(d); return isNaN(x) ? String(d) : `${String(x.getDate()).padStart(2, '0')}-${String(x.getMonth() + 1).padStart(2, '0')}-${x.getFullYear()}` } catch { return String(d) } }
const grey = (s) => `<td class="dim">${s}</td>`

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap');
  *{box-sizing:border-box}
  html{color-scheme:light}
  body{margin:0;background:#e9e7e0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1A1A1A;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;height:297mm;margin:0 auto;background:#FAF7F0;color:#1A1A1A;position:relative;padding:10mm 12mm 8mm;display:flex;flex-direction:column;gap:6px;overflow:hidden}
  .hd{display:flex;align-items:center;gap:12px;border-bottom:1px solid #D8D2C2;padding-bottom:7px}
  .hd img.crest{width:62px;height:62px;object-fit:contain;flex-shrink:0}
  .school img.wordmark{display:block;height:50px;width:auto;max-width:300px}
  .school b{display:block;font-family:Lora,Georgia,serif;font-size:22px;letter-spacing:.06em;line-height:1.1}
  .school span{font-size:12px;color:#1A1A1A}
  .meta{margin-left:auto;text-align:right;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;color:#1A1A1A;line-height:1.6;white-space:nowrap}
  .meta b{color:#7B1F2B;font-size:12.5px}
  .title{display:flex;align-items:baseline;justify-content:space-between;padding:1px 0}
  .title h2{margin:0;font-family:Lora,Georgia,serif;font-size:21px;letter-spacing:.2em;font-weight:600;white-space:nowrap}
  .title span{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;color:#1A1A1A;letter-spacing:.06em;white-space:nowrap}
  .strip{display:grid;grid-template-columns:1fr;gap:12px;border:1px solid #D8D2C2;padding:7px 9px}
  .strip.hasphoto{grid-template-columns:26mm 1fr}
  .photo{width:26mm;height:30mm;background:#E8E4D8;object-fit:cover;display:block}
  .cells{display:grid;grid-template-columns:repeat(3,1fr);gap:5px 12px;align-content:center}
  .cell small{display:block;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#1A1A1A}
  .cell b{font-size:13px;font-weight:600}
  .cell b.mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:500}
  .cell b.name{font-family:Lora,Georgia,serif;font-size:16px}
  .metrics{display:grid;grid-template-columns:1.2fr 1.35fr .9fr .7fr .7fr;border:1px solid #D8D2C2}
  .metrics div{padding:5px 6px;border-right:1px solid #D8D2C2;text-align:center}
  .metrics div:last-child{border-right:0}
  .metrics .v{font-family:Lora,Georgia,serif;font-size:19px;font-weight:600;line-height:1.15;white-space:nowrap}
  .metrics .v.red{color:#7B1F2B}
  .metrics .k{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#1A1A1A}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:#1A1A1A;text-align:center;padding:4px 3px;border-bottom:1px solid #1A1A1A;line-height:1.3;font-weight:600;vertical-align:bottom}
  th.l,td.l{text-align:left}
  th.band{border-bottom:1px solid #D8D2C2;color:#1A1A1A;letter-spacing:.14em;padding-bottom:2px}
  th.sep,td.sep{border-left:1px solid #D8D2C2}
  td{padding:5.5px 3px;text-align:center;border-bottom:1px solid #D8D2C2;color:#1A1A1A}
  tbody tr:nth-child(even) td{background:rgba(123,31,43,.035)}
  td.sub{font-weight:600;font-size:13px;white-space:nowrap}
  td.sub small{display:block;font-weight:400;font-size:10.5px;color:#1A1A1A}
  td.t{font-weight:700}
  td.g{color:#7B1F2B;font-weight:700}
  td.dim{color:#1A1A1A}
  td.fail{color:#7B1F2B;font-weight:700}
  td small.mm{color:#1A1A1A;font-size:10px}
  table.dense{font-size:10.5px}
  table.dense td{padding:4px 1px}
  table.dense th{letter-spacing:.02em;padding:3px 1.5px;font-size:8.5px}
  table.dense td.sub{font-size:11px;white-space:normal}
  td.skill{font-size:10.5px;text-align:center;white-space:nowrap}
  td.skill small{display:block;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:#1A1A1A}
  table.roomy td{padding:8px 3px}
  tr.sum td{border-top:1.5px solid #1A1A1A;border-bottom:1.5px solid #1A1A1A;font-weight:700;background:#EFE9DC!important;white-space:nowrap;padding-top:6px;padding-bottom:6px}
  td.t,td.g{white-space:nowrap}
  h4{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#1A1A1A;margin:0 0 3px;font-weight:600}
  .row2{display:grid;grid-template-columns:1.05fr 1fr;gap:16px;margin-top:14px}
  .chart svg{width:100%;height:auto;display:block;margin-top:10px}
  .legend{display:flex;gap:12px;font-size:10.5px;color:#1A1A1A;margin-top:2px}
  .legend i{display:inline-block;width:9px;height:9px;margin-right:4px;vertical-align:-1px;border-radius:2px}
  .co div{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px dotted #D8D2C2;padding:5px 0;font-size:13px}
  .co small{color:#1A1A1A;font-style:italic;font-family:Lora,Georgia,serif;font-size:11px;margin-left:5px}
  .co b{color:#7B1F2B;font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:700;font-size:14px}
  .co b.plain{color:#1A1A1A;font-family:Inter,sans-serif;font-weight:600}
  .bottom{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:2px;flex:0 0 auto}
  .bottom>div{display:flex;flex-direction:column}
  .box{border:1px solid #D8D2C2;padding:6px 9px;font-size:12.5px;line-height:1.45;min-height:20mm}
  .box i{font-family:Lora,Georgia,serif}
  .box .who{display:block;font-size:10px;color:#1A1A1A;margin-top:4px;letter-spacing:.06em;text-transform:uppercase}
  .box .kv{display:grid;grid-template-columns:auto 1fr;gap:0 10px}
  .box .kv span{color:#1A1A1A;font-size:11.5px}
  .box .kv b{font-weight:600}
  .box .result{font-family:Lora,Georgia,serif;font-size:16px;font-weight:700;color:#7B1F2B;margin-top:2px;letter-spacing:.04em}
  .box .note{font-size:11px;color:#1A1A1A;margin-top:5px}
  .key{font-size:10px;color:#1A1A1A;line-height:1.5}
  .sig{display:flex;justify-content:space-between;margin-top:auto;padding-top:14mm;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#1A1A1A}
  .sig div{border-top:1px solid #1A1A1A;width:44mm;text-align:center;padding-top:4px}
  .foot{display:flex;justify-content:space-between;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9.5px;color:#1A1A1A}
  /* Print: ink-safe. White paper, black rules, no tints, maroon accents → black, nothing under 10.5px.
     Screen (Tracker preview, parent app) keeps the cream-and-maroon look. */
  @media print{
    @page{size:A4 portrait;margin:0}
    body{background:#fff}
    .page{margin:0;background:#fff;page-break-after:always}
    .hd,.strip,.metrics,.metrics div,.box,th.band,th.sep,td.sep,td{border-color:#1A1A1A}
    .co div{border-bottom-color:#1A1A1A}
    .photo{background:#fff}
    tbody tr:nth-child(even) td{background:transparent}
    tr.sum td{background:#E6E6E6!important}
    .meta b,.metrics .v.red,td.g,td.fail,.co b,.box .result{color:#000}
    .chart .gl{stroke:#C4C4C4}
    .chart .b-me{fill:#000}
    .chart .b-avg{fill:#D4D4D4;stroke:#000;stroke-width:.5}
    .chart .vl{fill:#000}
    .legend .sw-me{background:#000!important}
    .legend .sw-avg{background:#D4D4D4!important;border:1px solid #000}
    .legend .sw-hi{background:#fff!important}
    .meta,.cell small,.metrics .k,th,h4,.box .who,.key,.foot,td small.mm,td.sub small,.legend,.co small,.box .kv span,.box .note{font-size:10.5px}
    table.dense th{font-size:9.5px;letter-spacing:0}
  }
`

export function renderCardHtml(card) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(card.student?.name || 'Report card')} · ${esc(card.sessionCode)}</title><style>${CSS}</style></head><body>${renderCardBody(card)}</body></html>`
}
/** Several cards in one printable document (SMS batch print). */
export function renderCardsDocument(bodies) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report cards</title><style>${CSS}</style></head><body>${bodies.join('\n')}</body></html>`
}
/** Just the <div class="page"> for a card (for renderCardsDocument). */
export function renderCardBody(card) {
  const shown = card.plan.cardTerms.filter((t) => card.showTerms.includes(t.key))
  const final = card.plan.cardTerms.length > 1 && shown.length === card.plan.cardTerms.length
  const table = card.family === 'secondary_annual' ? tableSecondary(card, shown)
    : card.family === 'senior_progress' ? tableSenior(card, shown, final)
    : card.family === 'pre_primary' ? tablePrePrimary(card, shown, final)
    : tablePerformance(card, shown, final)
  const resultTitle = final || card.family === 'secondary_annual' ? `Result · Session ${card.sessionCode}` : `Result · ${shown.map((t) => t.label).join(' & ')}`
  return `<div class="page">
    ${header(card)}
    ${titleStrip(card, shown)}
    ${studentStrip(card)}
    ${metrics(card, shown, final)}
    ${table}
    <div class="row2">
      <div class="chart">${chart(card, shown, final)}</div>
      <div>${coScholastic(card, shown)}</div>
    </div>
    <div class="bottom">
      <div><h4>Class teacher's remarks</h4><div class="box"><i>${esc(card.remark || '')}</i></div></div>
      <div><h4>${esc(resultTitle)}</h4><div class="box">${resultBox(card, final)}</div></div>
    </div>
    <div class="key">${gradeKey(card)}</div>
    <div class="sig"><div>Class Teacher</div><div>Parent / Guardian</div><div>Principal</div></div>
    <div class="foot"><span>${esc(recordNo(card))} · ${card.publishedAt ? 'issued ' + dmy(card.publishedAt) + (card.publishedVersion > 1 ? ` · v${card.publishedVersion}` : '') : 'PREVIEW · ' + dmy(card.computedAt)}</span><span>${esc(card.student?.branchName || card.student?.branchCode || '')}</span></div>
  </div>`
}

// ── shared blocks ───────────────────────────────────────────────────────────
function recordNo(card) { return `RC/${card.student?.branchCode || 'RKA'}/${card.sessionCode}/${card.cardKey}/${card.student?.admissionNo || dash}` }
function header(card) {
  return `<div class="hd"><img class="crest" src="${assetBase()}/crest-card.png" alt="" onerror="this.style.visibility='hidden'">
    <div class="school"><img class="wordmark" src="${assetBase()}/banner-card.png?v=3" alt="RADHAKRISHNA ACADEMY" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'RADHAKRISHNA ACADEMY'}))"></div>
    <div class="meta">AFFILIATION <b>${AFFILIATION}</b><br>SCHOOL CODE <b>${SCHOOL_CODE}</b><br>RECORD ${esc(recordNo(card))}</div></div>`
}
function titleStrip(card, shown) {
  const t = 'REPORT CARD'   // same heading on every class
  const sub = card.family === 'secondary_annual' ? 'ANNUAL' : shown.map((x) => x.label.toUpperCase()).join(' & ')
  return `<div class="title"><h2>${t}</h2><span>SESSION ${esc(card.sessionCode)} · ${esc(sub)}</span></div>`
}
function studentStrip(card) {
  const s = card.student || {}
  const senior = card.family === 'senior_progress' || card.family === 'secondary_annual'
  const cls = `${(s.className || '').replace(/^Class /, '')}${s.section ? ' – ' + s.section : ''}`
  const cells = [
    ['Student', s.name, 'name'], ['Class / Section', cls], ['Roll No.', s.rollNumber, 'mono'],
    ['Admission No.', s.admissionNo, 'mono'], ['Date of Birth', s.dob ? dmy(s.dob) : null, 'mono'],
    senior ? ['Board Reg. No.', s.boardRegNo, 'mono'] : ['House', s.house],
    ['Father', s.father], ['Mother', s.mother], ['APAAR ID', s.apaarId, 'mono'],
  ]
  const photo = card.photoUrl ? `<img class="photo" src="${esc(card.photoUrl)}" alt="" onerror="this.style.visibility='hidden'">` : ''
  return `<div class="strip${photo ? ' hasphoto' : ''}">${photo}<div class="cells">${cells.map(([k, v, c]) => `<div class="cell"><small>${k}</small><b class="${c || ''}">${v == null || v === '' ? dash : esc(v)}</b></div>`).join('')}</div></div>`
}
function attendanceFor(card, shown, final) {
  const a = card.attendance; if (!a) return null
  if (final || a.mode !== 'perTerm') return a.sessionTotal
  let present = 0, marked = 0, any = false
  for (const t of shown) { const x = a.byTerm?.[t.key]; if (x) { present += x.present; marked += x.marked; any = true } }
  return any ? { present, marked } : a.sessionTotal
}
function metrics(card, shown, final) {
  const a = attendanceFor(card, shown, final)
  const o = card.overall
  const present = a ? Math.round(a.present) : null, marked = a ? Math.round(a.marked) : null
  const scope = final || card.family === 'secondary_annual' ? 'Session' : (shown.length === 1 ? shown[0].label : 'Overall')
  return `<div class="metrics">
    <div><div class="v">${marked != null ? `${present} / ${marked}` : dash}</div><div class="k">Attendance${marked ? ' · ' + pct1(100 * present / marked) : ''}</div></div>
    <div><div class="v">${totalCell(o)}</div><div class="k">${esc(scope)} marks</div></div>
    <div><div class="v">${o.pct != null ? pct1(o.pct) : dash}</div><div class="k">Percentage</div></div>
    <div><div class="v red">${o.grade ? esc(o.grade) : dash}</div><div class="k">Grade</div></div>
    <div><div class="v red">${fmt(card.rank)}</div><div class="k">Rank</div></div>
  </div>`
}
/** Section average / highest columns — interim cards only (the final card spends the width on the second term). */
function sectionCols(card, shown, final, rowspan) {
  if (final || !card.sectionAverage) return { head: '', cell: () => '', sum: '' }
  const t = shown[0]?.key
  const rs = rowspan ? ` rowspan="${rowspan}"` : ''
  return {
    head: `<th class="sep"${rs}>Section<br>average</th><th${rs}>Section<br>highest</th>`,
    cell: (r) => { const avg = card.sectionAverageByTerm?.[`${r.subject}|${t}`] ?? card.sectionAverage?.[r.subject]; return `<td class="dim sep">${avg == null ? dash : avg}</td><td class="dim">${card.sectionHighest?.[r.subject] == null ? dash : card.sectionHighest[r.subject]}</td>` },
    sum: `<td class="sep"></td><td></td>`,
  }
}
const totalCell = (o) => (o?.max ? `${o.obtained} / ${o.max}` : dash)
const gradeCell = (g) => `<td class="g">${g ? esc(g) : dash}</td>`

// ── family: performance_profile (I–VIII) ────────────────────────────────────
function tablePerformance(card, shown, final) {
  const comps = card.plan.components
  const perTerm = comps.reduce((s, c) => s + (c.max || 0), 0)
  const sc = sectionCols(card, shown, final)
  // print labels: PA-1 / PA-2 for the periodic test, PF, S.E., and HY / AN for the term exam
  const short = (c, ti) => c.key === 'pt' ? `PA-${ti + 1}` : (c.key === 'portfolio' || /portfolio/i.test(c.label)) ? 'PF' : (c.key === 'se' || /subject\s*enrich/i.test(c.label)) ? 'S.E.' : c.key === 'exam' ? (ti === 0 ? 'HY' : 'AN') : c.label
  const termIdx = (key) => Math.max(0, card.plan.cardTerms.findIndex((x) => x.key === key))
  const compHead = (first, ti = 0) => comps.map((c, j) => `<th class="${!first && !j ? 'sep' : ''}">${esc(short(c, ti))}<br>/${c.max}</th>`).join('')
  const head = final
    ? `<tr><th class="l" rowspan="2">Scholastic area</th>${shown.map((t, i) => `<th class="band ${i ? 'sep' : ''}" colspan="${comps.length + 2}">${esc(t.label)}${t.examLabel ? ' · ' + esc(t.examLabel) : ''}</th>`).join('')}<th class="band sep" colspan="2">Session</th></tr>
       <tr>${shown.map((t, i) => compHead(i === 0, termIdx(t.key)) + `<th>Total<br>/${perTerm}</th><th>Grade</th>`).join('')}<th class="sep">Total<br>/${perTerm * shown.length}</th><th>Grade</th></tr>`
    : `<tr><th class="l">Scholastic area</th>${compHead(true, termIdx(shown[0].key))}<th class="sep">Total<br>/${perTerm}</th><th>Grade</th>${sc.head}</tr>`
  const body = card.rows.map((r) => {
    const cells = shown.map((t, i) => {
      const cell = r.byTerm[t.key]
      return comps.map((c, j) => `<td class="${i && !j ? 'sep' : ''}">${cellVal(cell?.comps?.[c.key])}</td>`).join('')
        + `<td class="t ${!final ? 'sep' : ''}">${cell?.complete ? cell.obtained : dash}</td>${gradeCell(cell?.complete ? cell.grade : null)}`
    }).join('')
    const tail = final ? `<td class="t sep">${r.total.max ? r.total.obtained : dash}</td>${gradeCell(r.total.grade)}` : sc.cell(r)
    return `<tr><td class="l sub">${esc(title(r.subject))}</td>${cells}${tail}</tr>`
  }).join('')
  const o = card.overall
  const sum = `<tr class="sum"><td class="l">Total</td>${shown.map((t, i) => { const x = o.byTerm?.[t.key]; return `<td colspan="${comps.length}" class="${i ? 'sep' : ''}"></td><td class="${!final ? 'sep' : ''}">${totalCell(x)}</td>${gradeCell(x?.grade)}` }).join('')}${final ? `<td class="sep">${totalCell(o)}</td>${gradeCell(o.grade)}` : sc.sum}</tr>`
  return `<table class="${final ? 'dense' : (card.rows.length <= 6 ? 'roomy' : '')}"><thead>${head}</thead><tbody>${body}${sum}</tbody></table>`
}

// ── family: secondary_annual (IX–X) ─────────────────────────────────────────
function tableSecondary(card, shown) {
  const ia = card.plan.components.filter((c) => c.ia)
  const iaTotal = card.plan.iaTotal || ia.reduce((s, c) => s + c.max, 0)
  const sc = sectionCols(card, shown, false, 2)
  // Half-yearly columns: printed for information (written + practical + total per row); the subject total is IA + annual.
  const head = `<tr><th class="l" rowspan="2">Scholastic area</th><th rowspan="2">Code</th><th class="band sep" colspan="3">Half-yearly examination</th><th class="band sep" colspan="${ia.length + 1}">Internal assessment · ${iaTotal}</th><th class="band sep" colspan="3">Annual examination</th><th rowspan="2" class="sep">Total<br>/${card.plan.subjectTotal}</th><th rowspan="2" style="text-align:center;padding-left:0;padding-right:0">Grade</th>${sc.head}</tr>
    <tr><th class="sep">Prac.</th><th>Written</th><th>Total</th>${ia.map((c) => `<th class="${!ia.indexOf(c) ? 'sep' : ''}">${esc(/portfolio/i.test(c.label) || c.key === 'portfolio' ? 'PF' : /subject\s*enrich/i.test(c.label) || c.key === 'se' ? 'SE' : c.label)}<br>/${c.max}</th>`).join('')}<th class="${ia.length ? '' : 'sep'}">Total</th><th class="sep">Prac.</th><th>Written</th><th>Total</th></tr>`
  const body = card.rows.map((r) => {
    const cell = r.byTerm.annual || {}
    const iaOk = ia.every((c) => cell.comps?.[c.key] && !cell.comps[c.key].missing)
    const iaSum = ia.reduce((s, c) => { const v = cell.comps?.[c.key]; return v && !v.missing ? s + (v.value || 0) : s }, 0)
    const ex = cell.comps?.exam
    const has = ex && !ex.missing
    const wr = has ? (ex.absent ? 'AB' : fmt(ex.theoryMax ? ex.theory : ex.value)) : dash
    const pr = has ? (ex.absent ? 'AB' : (ex.practicalMax ? fmt(ex.practical) : dash)) : dash
    const exT = has ? (ex.absent ? 'AB' : fmt(ex.value)) : dash
    const hy = cell.comps?.hy
    const hyHas = hy && !hy.missing
    const hyWr = hyHas ? (hy.absent ? 'AB' : fmt(hy.theoryMax ? hy.theory : hy.value)) : dash
    const hyPr = hyHas ? (hy.absent ? 'AB' : (hy.practicalMax ? fmt(hy.practical) : dash)) : dash
    const hyT = hyHas ? (hy.absent ? 'AB' : fmt(hy.value)) : dash
    const hyCells = `<td class="sep">${hyPr}</td><td>${hyWr}</td><td class="t">${hyT}</td>`
    const iaCells = r.skill
      ? `<td colspan="${ia.length + 1}" class="skill sep"><small>Skill subject</small>no internal assessment</td>`
      : `${ia.map((c, i) => `<td class="${i ? '' : 'sep'}">${cellVal(cell.comps?.[c.key])}</td>`).join('')}<td class="t ${ia.length ? '' : 'sep'}">${iaOk ? iaSum : dash}</td>`
    return `<tr><td class="l sub">${esc(title(r.subject))}${r.additional ? '<small>Additional · not in aggregate</small>' : ''}</td>${grey(esc(r.locCode || ''))}${hyCells}${iaCells}<td class="sep">${pr}</td><td>${wr}</td><td class="t">${exT}</td><td class="t sep">${cell.complete ? cell.obtained : dash}</td>${gradeCell(cell.complete ? cell.grade : null)}${sc.cell(r)}</tr>`
  }).join('')
  const o = card.overall
  return `<table class="dense"><thead>${head}</thead><tbody>${body}<tr class="sum"><td class="l" colspan="${ia.length + 9}">Aggregate · excluding additional subjects</td><td class="sep">${totalCell(o)}</td>${gradeCell(o.grade)}${sc.sum}</tr></tbody></table>`
}

// ── family: senior_progress (XI–XII) ────────────────────────────────────────
function tableSenior(card, shown, final) {
  const sc = sectionCols(card, shown, final, 2)
  const head = `<tr><th class="l" rowspan="2">Subject</th>${shown.map((t, i) => `<th class="band ${i ? 'sep' : ''}" colspan="4">${esc(t.label)}</th>`).join('')}${final ? '<th class="band sep" colspan="2">Session</th>' : `<th rowspan="2" class="sep">Grade</th>${sc.head}`}</tr>
    <tr>${shown.map((t, i) => `<th class="${i ? 'sep' : ''}">Max<br>Th / Pr</th><th>Theory</th><th>Prac.</th><th>Total</th>`).join('')}${final ? `<th class="sep">Total<br>/${card.plan.subjectTotal}</th><th>Grade</th>` : ''}</tr>`
  const body = card.rows.map((r) => {
    const cells = shown.map((t, i) => {
      const cell = r.byTerm[t.key]; const ex = cell?.comps?.exam
      const mm = r.practical ? `${r.written} / ${r.practical}` : (r.written != null ? `${r.written}` : dash)
      if (!ex || ex.missing) return `<td class="${i ? 'sep' : ''} dim">${mm}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td>`
      const mmLive = ex.theoryMax ? `${ex.theoryMax} / ${ex.practicalMax}` : `${ex.max}`
      return `<td class="${i ? 'sep' : ''} dim">${mmLive}</td><td class="${cell.fail ? 'fail' : ''}">${ex.absent ? 'AB' : fmt(ex.theoryMax ? ex.theory : ex.value)}${cell.fail ? ' F' : ''}</td><td>${ex.absent ? 'AB' : (ex.practicalMax ? fmt(ex.practical) : dash)}</td><td class="t">${ex.absent ? 'AB' : fmt(ex.value)}</td>`
    }).join('')
    const tail = final ? `<td class="t sep">${r.total.max ? r.total.obtained : dash}</td>${gradeCell(r.total.grade)}` : `<td class="g sep">${r.total.grade ? esc(r.total.grade) : dash}</td>${sc.cell(r)}`
    return `<tr><td class="l sub">${esc(title(r.subject))}</td>${cells}${tail}</tr>`
  }).join('')
  const o = card.overall
  const sum = `<tr class="sum"><td class="l">Total</td>${shown.map((t, i) => { const x = o.byTerm?.[t.key]; return `<td colspan="3" class="${i ? 'sep' : ''}"></td><td>${totalCell(x)}</td>` }).join('')}${final ? `<td class="sep">${totalCell(o)}</td>${gradeCell(o.grade)}` : `<td class="g sep">${o.grade ? esc(o.grade) : dash}</td>${sc.sum}`}</tr>`
  return `<table class="${card.rows.length <= 6 ? 'roomy' : ''}"><thead>${head}</thead><tbody>${body}${sum}</tbody></table>`
}

// ── family: pre_primary (Nursery / KG) ──────────────────────────────────────
function tablePrePrimary(card, shown, final) {
  const sc = sectionCols(card, shown, final, 2)
  const head = `<tr><th class="l" rowspan="2">Subject</th>${shown.map((t, i) => `<th class="band ${i ? 'sep' : ''}" colspan="4">${esc(t.label)}</th>`).join('')}${final ? '<th class="band sep" colspan="2">Session</th>' : sc.head}</tr>
    <tr>${shown.map((t, i) => `<th class="${i ? 'sep' : ''}">Oral</th><th>Written</th><th>Total</th><th>Grade</th>`).join('')}${final ? '<th class="sep">Total</th><th>Grade</th>' : ''}</tr>`
  const body = card.rows.map((r) => {
    const cells = shown.map((t, i) => {
      const cell = r.byTerm[t.key]
      const oral = r.oralMax ? `${cellVal(cell?.comps?.oral)}<small class="mm"> /${r.oralMax}</small>` : dash
      const written = r.writtenMax ? `${cellVal(cell?.comps?.written)}<small class="mm"> /${r.writtenMax}</small>` : dash
      return `<td class="${i ? 'sep' : ''}">${oral}</td><td>${written}</td><td class="t">${cell?.complete ? `${cell.obtained}<small class="mm"> /${cell.max}</small>` : dash}</td>${gradeCell(cell?.complete ? cell.grade : null)}`
    }).join('')
    const tail = final ? `<td class="t sep">${r.total.max ? `${r.total.obtained}<small class="mm"> /${r.total.max}</small>` : dash}</td>${gradeCell(r.total.grade)}` : sc.cell(r)
    return `<tr><td class="l sub">${esc(title(r.subject))}</td>${cells}${tail}</tr>`
  }).join('')
  const o = card.overall
  const sum = `<tr class="sum"><td class="l">Aggregate</td>${shown.map((t, i) => { const x = o.byTerm?.[t.key]; return `<td colspan="2" class="${i ? 'sep' : ''}"></td><td>${totalCell(x)}</td>${gradeCell(x?.grade)}` }).join('')}${final ? `<td class="sep">${totalCell(o)}</td>${gradeCell(o.grade)}` : sc.sum}</tr>`
  return `<table class="${card.rows.length <= 6 ? 'roomy' : ''}"><thead>${head}</thead><tbody>${body}${sum}</tbody></table>`
}

// ── chart: subject totals vs section (interim) or term vs term (final) ──────
function shortName(s) {
  const t = title(s).replace(/^English.*/, 'English').replace(/^Hindi.*/, 'Hindi').replace('Social Science', 'Soc. Sci.').replace('Mathematics', 'Maths').replace('Artificial Intelligence', 'A.I.').replace('English Lng & Lit.', 'English').replace('Hindi Course-A', 'Hindi').replace('Hindi Course-B', 'Hindi').replace(/ Core$/, '').replace('General Awareness', 'Gen. Aw.').replace('Environmental Studies', 'EVS').replace('Computer Science', 'Comp. Sci.').replace('Informatics Practices', 'IP').replace('Physical Education', 'Phy. Ed.').replace('Business Studies', 'Bus. St.').replace('Accountancy', 'Accounts').replace('Political Science', 'Pol. Sci.').replace('Fine Arts', 'Arts')
  return t.length > 12 ? t.slice(0, 11) + '.' : t
}
function chart(card, shown, final) {
  const rows = card.rows.filter((r) => !r.unmapped && !r.additional)
  if (!rows.length) return ''
  const perRow = (r, k) => r.byTerm[k]?.max || null
  const per = card.family === 'secondary_annual' ? (card.plan.subjectTotal || 100) : (Math.max(...rows.map((r) => perRow(r, shown[0]?.key) || 0)) || 100)
  const W = 400, base = 150, H = 134, n = rows.length, gw = W / n
  const y = (v) => base - Math.max(0, Math.min(per, v)) * H / per
  const grid = [25, 50, 75, 100].map((p) => { const v = Math.round(per * p / 100); return `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="gl" stroke="#E8E4D8" stroke-width=".6"/><text x="0" y="${y(v) - 1.5}" font-size="8" fill="#1A1A1A" font-family="Inter,sans-serif">${v}</text>` }).join('')
  const labels = rows.map((r, i) => `<text x="${i * gw + gw / 2}" y="${base + 9}" text-anchor="middle" font-size="8" fill="#1A1A1A" font-family="Inter,sans-serif">${esc(shortName(r.subject).toUpperCase())}</text>`).join('')
  const bw = Math.min(12, gw / 2.6)
  let bars, legend, h4
  if (final && shown.length >= 2) {
    const [a, b] = shown
    bars = rows.map((r, i) => {
      const x = i * gw + gw / 2, ca = r.byTerm[a.key], cb = r.byTerm[b.key]; const va = ca?.complete ? ca.obtained : 0, vb = cb?.complete ? cb.obtained : 0
      return `<rect x="${x - bw - 1}" y="${y(va)}" width="${bw}" height="${base - y(va)}" class="b-avg" fill="#D8D2C2"/><rect x="${x + 1}" y="${y(vb)}" width="${bw}" height="${base - y(vb)}" class="b-me" fill="#7B1F2B"/>${cb?.complete ? `<text class="vl" x="${x + 1 + bw / 2}" y="${y(vb) - 2}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#7B1F2B" font-family="Inter,sans-serif">${vb}</text>` : ''}`
    }).join('')
    legend = `<span><i class="sw-avg" style="background:#D8D2C2"></i>${esc(a.label)}</span><span><i class="sw-me" style="background:#7B1F2B"></i>${esc(b.label)}</span>`
    h4 = `${esc(a.label)} against ${esc(b.label)} · marks out of ${per}`
  } else {
    const t = shown[0]?.key
    const hasSection = !!card.sectionAverage
    bars = rows.map((r, i) => {
      const x = i * gw + gw / 2, c = r.byTerm[t]; const v = c?.complete ? c.obtained : 0
      const avg = card.sectionAverageByTerm?.[`${r.subject}|${t}`] ?? card.sectionAverage?.[r.subject]; const hi = card.sectionHighest?.[r.subject]
      const mine = hasSection ? `<rect x="${x + 1}" y="${y(v)}" width="${bw}" height="${base - y(v)}" class="b-me" fill="#7B1F2B"/>` : `<rect x="${x - bw / 2}" y="${y(v)}" width="${bw}" height="${base - y(v)}" class="b-me" fill="#7B1F2B"/>`
      const lx = hasSection ? x + 1 + bw / 2 : x
      return `${hasSection && avg != null ? `<rect x="${x - bw - 1}" y="${y(avg)}" width="${bw}" height="${base - y(avg)}" class="b-avg" fill="#D8D2C2"/>` : ''}${mine}${hasSection && hi != null ? `<line x1="${x - bw - 2}" x2="${x + bw + 2}" y1="${y(hi)}" y2="${y(hi)}" stroke="#1A1A1A" stroke-width=".9"/>` : ''}${c?.complete ? `<text class="vl" x="${lx}" y="${y(v) - 2}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#7B1F2B" font-family="Inter,sans-serif">${v}</text>` : ''}`
    }).join('')
    legend = `<span><i class="sw-me" style="background:#7B1F2B"></i>${esc((card.student?.name || 'Student').split(' ')[0])}</span>${hasSection ? '<span><i class="sw-avg" style="background:#D8D2C2"></i>Section average</span><span><i class="sw-hi" style="border:1px solid #1A1A1A;background:#FAF7F0"></i>Section highest</span>' : ''}`
    h4 = `${esc(shown[0]?.label || '')} · marks out of ${per}${hasSection ? ' against the section' : ''}`
  }
  return `<h4>${h4}</h4><svg viewBox="0 0 400 166">${grid}${bars}<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="#1A1A1A" stroke-width=".8"/>${labels}</svg><div class="legend">${legend}</div>`
}

// ── co-scholastic list (graded subjects, areas, discipline, height/weight) ──
function coScholastic(card, shown) {
  const tk = shown.map((t) => t.key)
  const g = (row) => tk.map((k) => row.byTerm?.[k] ?? dash).join(' / ')
  const lines = []
  for (const r of card.gradedSubjects || []) lines.push(`<div><span>${esc(title(r.name))}<small>graded subject</small></span><b>${esc(g(r))}</b></div>`)
  for (const r of card.coScholastic || []) lines.push(`<div><span>${esc(title(r.name))}</span><b>${esc(g(r))}</b></div>`)
  if (card.discipline && tk.some((k) => card.discipline[k] != null)) lines.push(`<div><span>Discipline<small>punctuality, conduct</small></span><b>${esc(tk.map((k) => card.discipline[k] ?? dash).join(' / '))}</b></div>`)
  if (card.session?.heightCm || card.session?.weightKg) lines.push(`<div><span>Height · Weight</span><b class="plain">${card.session.heightCm ? card.session.heightCm + ' cm' : dash} · ${card.session.weightKg ? card.session.weightKg + ' kg' : dash}</b></div>`)
  if (!lines.length) return ''
  const scale = (card.scales?.coScholastic || []).join('–')
  const termNote = tk.length > 1 ? ' · ' + shown.map((t) => esc(t.label.replace(/ exam$/i, ''))).join(' / ') : ''
  return `<h4>Co-scholastic${scale ? ` · scale ${esc(scale)}` : ''}${termNote}</h4><div class="co">${lines.join('')}</div>`
}

// ── result box ──────────────────────────────────────────────────────────────
function resultBox(card, final) {
  const isFinal = final || card.family === 'secondary_annual'
  if (isFinal) {
    const promo = card.session?.promotedTo
    if (card.family === 'secondary_annual' && card.result) return `<div class="result">RESULT: ${esc(card.result)}</div>`
    if (promo) { const p = String(promo).replace(/^Class /i, '').toUpperCase(); return `<div class="result">PROMOTED TO ${/^\d/.test(p) ? 'CLASS ' : ''}${esc(p)}</div>` }
    return `<div class="note">Promotion as decided by the school.</div>`
  }
  return `<div class="note">Promotion is decided on the final card.</div>`
}
function gradeKey(card) {
  const b = card.scales?.gradeScale?.bands || []
  const parts = b.map(([m, g]) => `${g} ≥ ${m}`)
  const extra = card.family === 'performance_profile' ? ' PA = periodic assessment (out of 40, shown out of 10) · PF = portfolio · S.E. = subject enrichment · HY / AN = half-yearly / annual exam.' : card.family === 'secondary_annual' ? ' P.P.T. = pen-paper test; M.A. = multiple assessment; internal assessment as per CBSE.' : ''
  return `Grades · ${parts.join(' · ')} · ${esc(card.scales?.gradeScale?.floorLabel || 'E')} below ${b[b.length - 1]?.[0] ?? 33}.${extra} AB = absent.`
}
