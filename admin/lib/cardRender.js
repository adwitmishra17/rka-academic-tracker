// ============================================================================
// admin/lib/cardRender.js — engine card → self-contained A4 HTML string.
//
// The SAME string is: previewed in the Examinations window, frozen into
// published_report_cards.html at publish time, printed from SMS, and shown
// in the parent app. Only the crest + wordmark load from this app's public
// folder; everything else is inline.
// ============================================================================

// Header assets are referenced by URL (public/ files served by this app with
// no auth) so a stored card stays ~15 KB instead of carrying 90 KB of base64
// per student. Override the host with CARD_ASSET_BASE for staging.
// Read lazily: ES imports are hoisted above server.js's dotenv.config(), so a
// module-level read would miss a .env.local override in local dev.
const assetBase = () => (process.env.CARD_ASSET_BASE || 'https://tracker.rkacademyballia.in').replace(/\/$/, '')

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const dash = '—'
const fmt = (v) => (v == null ? dash : String(v))
const cellVal = (c) => (!c || c.hidden ? '' : c.missing ? dash : c.absent ? 'AB' : fmt(c.value))

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#f4f4f5;font-family:Georgia,"Times New Roman",serif;color:#111}
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:12mm 12mm 10mm;position:relative}
  .hdr{display:flex;align-items:center;gap:10px;border-bottom:2.5px solid #1a4a2e;padding-bottom:8px;margin-bottom:8px}
  .hdr img.crest{width:58px;height:58px;object-fit:contain}
  .hdr .mid{flex:1;text-align:center}
  .hdr img.banner{max-width:300px;width:100%;height:auto;display:block;margin:0 auto}
  .hdr .branch{font-size:10.5px;color:#444;margin-top:2px}
  .hdr .aff{font-size:9.5px;color:#666;letter-spacing:.06em}
  .title{text-align:center;font-weight:700;font-size:15px;letter-spacing:.12em;margin:6px 0 2px;color:#1a4a2e}
  .sub{text-align:center;font-size:11px;color:#333;margin-bottom:8px}
  .info{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 14px;font-size:11px;margin-bottom:8px}
  .info b{font-weight:600;color:#000}
  .info span{color:#555}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th,td{border:1px solid #444;padding:3px 4px;text-align:center;vertical-align:middle}
  th{background:#eef4ef;font-weight:700;font-size:9.5px;letter-spacing:.02em}
  td.l,th.l{text-align:left}
  td.sub{font-weight:600;text-transform:uppercase}
  tr.tot td{font-weight:700;background:#f7f7f2}
  .sec{margin-top:8px}
  .sec h4{margin:0 0 3px;font-size:11px;letter-spacing:.08em;color:#1a4a2e}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .remark{border:1px solid #444;padding:5px 7px;min-height:38px;font-size:11px;line-height:1.5}
  .foot{display:flex;justify-content:space-between;margin-top:22px;font-size:10.5px}
  .foot div{border-top:1px solid #333;padding-top:3px;width:150px;text-align:center}
  .legend{font-size:9px;color:#444;margin-top:5px}
  .result{margin-top:6px;font-size:11.5px}
  .fail{color:#b00020;font-weight:700}
  .stamp{position:absolute;right:12mm;top:12mm;font-size:8.5px;color:#888;text-align:right}
  @media print{body{background:#fff}.page{margin:0;width:auto;min-height:auto;page-break-after:always}@page{size:A4 portrait;margin:0}}
`

export function renderCardHtml(card, opts = {}) {
  const body = renderCardBody(card)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(card.student?.name || 'Report card')} · ${esc(card.sessionCode)}</title><style>${CSS}</style></head><body>${body}</body></html>`
}

/** Several cards in one printable document (SMS batch print). */
export function renderCardsDocument(htmlBodies) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report cards</title><style>${CSS}</style></head><body>${htmlBodies.join('\n')}</body></html>`
}
/** Just the <div class="page"> for a card (for renderCardsDocument). */
export function renderCardBody(card) {
  return card.family === 'secondary_annual' ? renderSecondary(card)
    : card.family === 'senior_progress' ? renderSenior(card)
    : card.family === 'pre_primary' ? renderPrePrimary(card)
    : renderPerformanceProfile(card)
}

// ── Family: pre_primary (Nursery / KG) ──────────────────────────────────────
function renderPrePrimary(card) {
  const terms = card.plan.cardTerms
  const shown = terms.filter((t) => card.showTerms.includes(t.key))
  const both = shown.length === terms.length
  const head1 = `<tr><th class="l" rowspan="2">SUBJECTS</th>${shown.map((t) => `<th colspan="6">${esc(t.label)}</th>`).join('')}${both ? '<th colspan="3">TOTAL MARKS</th>' : ''}</tr>`
  const head2 = `<tr>${shown.map(() => '<th>PAPER</th><th>M.M.</th><th>M.O.</th><th>M.M.</th><th>M.O.</th><th>GRADE</th>').join('')}${both ? '<th>M.M.</th><th>M.O.</th><th>GRADE</th>' : ''}</tr>`
  const rowsHtml = card.rows.map((r) => {
    const parts = [['oral', 'ORAL', r.oralMax], ['written', 'WRITTEN', r.writtenMax]].filter(([, , m]) => m > 0)
    const n = parts.length
    return parts.map(([k, label, max], i) => {
      const first = i === 0
      return `<tr>${first ? `<td class="l sub" rowspan="${n}">${esc(r.subject)}</td>` : ''}${shown.map((t) => {
        const cell = r.byTerm[t.key]; const v = cell?.comps?.[k]
        const paperCells = `<td>${label}</td><td>${max}</td><td><b>${cellVal(v)}</b></td>`
        return first ? paperCells + `<td rowspan="${n}">${cell?.max || dash}</td><td rowspan="${n}"><b>${cell?.complete ? cell.obtained : dash}</b></td><td rowspan="${n}">${cell?.complete ? esc(cell.grade) : dash}</td>` : paperCells
      }).join('')}${both && first ? `<td rowspan="${n}">${r.total.max || dash}</td><td rowspan="${n}"><b>${r.total.max ? r.total.obtained : dash}</b></td><td rowspan="${n}">${r.total.grade ? esc(r.total.grade) : dash}</td>` : ''}</tr>`
    }).join('')
  }).join('')
  const ov = card.overall
  const agg = `<tr class="tot"><td class="l">AGGREGATE MARKS</td>${shown.map((t) => { const o = ov.byTerm?.[t.key]; return `<td colspan="6">${o ? `${o.obtained}/${o.max}, PER : ${o.pct.toFixed(2)} %` : dash}</td>` }).join('')}${both ? `<td colspan="3">${ov.max ? `${ov.obtained}/${ov.max}, ${ov.pct.toFixed(2)} %` : dash}</td>` : ''}</tr>`
  const a = card.attendance
  const attRow = a ? `<tr class="tot"><td class="l">ATTENDANCE</td>${shown.map((t) => { const x = a.byTerm?.[t.key]; return `<td colspan="6">${x ? `${x.present} / ${x.marked}, ${(100 * x.present / (x.marked || 1)).toFixed(2)} %` : dash}</td>` }).join('')}${both ? `<td colspan="3">${a.sessionTotal ? `${a.sessionTotal.present} / ${a.sessionTotal.marked}, ${(100 * a.sessionTotal.present / (a.sessionTotal.marked || 1)).toFixed(2)} %` : dash}</td>` : ''}</tr>` : ''
  const banner = `<div class="sec" style="background:#111;color:#fff;text-align:center;font-weight:700;font-size:12px;padding:5px 8px;letter-spacing:.04em">TOTAL MARKS : ${ov.max ? `${ov.obtained}/${ov.max}` : dash}, PER : ${ov.pct != null ? ov.pct.toFixed(2) + '%' : dash}, RANK : ${card.rank ?? dash} , OVERALL GRADE : ${ov.grade ? esc(ov.grade) : dash}</div>`
  const extra = [['Weight', card.session?.weightKg ? `${card.session.weightKg} K.G.` : null], ['Height', card.session?.heightCm ? `${card.session.heightCm} C.M.` : null]]
  return `<div class="page">${stamp(card)}${header(card, `PROGRESS REPORT CARD ( SESSION : ${esc(card.sessionCode)} )${card.interim ? ' · ' + esc(shown[0].label) : ''}`)}${infoBlock(card, extra)}
  <table><thead>${head1}${head2}</thead><tbody>${rowsHtml}${agg}${attRow}</tbody></table>
  ${banner}
  <div class="two">${gradeTable('CO - CURRICULAR ACTIVITIES', card.coScholastic, terms, card.showTerms)}<div class="sec"><h4>GRADING</h4>${gradeLegend(card)}</div></div>
  ${remarkBlock(card)}
  ${footer(card)}</div>`
}

// ── shared chrome ───────────────────────────────────────────────────────────
function header(card, subtitle) {
  const s = card.student || {}
  return `
  <div class="hdr">
    <img class="crest" src="${assetBase()}/crest-card.png" alt="" onerror="this.style.visibility='hidden'">
    <div class="mid">
      <img class="banner" src="${assetBase()}/banner-card.png" alt="RADHAKRISHNA ACADEMY" onerror="this.replaceWith(Object.assign(document.createElement('div'),{textContent:'RADHAKRISHNA ACADEMY',style:'font-size:20px;font-weight:700;letter-spacing:.08em'}))">
      <div class="branch">${esc(s.branchName || s.branchCode || '')}</div>
      <div class="aff">AFFILIATED TO CBSE, NEW DELHI</div>
    </div>
    <div style="width:58px"></div>
  </div>
  <div class="title">${esc(card.title || 'REPORT CARD')}</div>
  <div class="sub">${esc(subtitle)}</div>`
}
function stamp(card) {
  const v = card.publishedVersion ? `v${card.publishedVersion} · ` : ''
  const when = card.publishedAt || card.computedAt
  return `<div class="stamp">${card.publishedAt ? 'PUBLISHED' : 'PREVIEW'} · ${v}${esc(new Date(when).toLocaleDateString('en-IN'))}</div>`
}
function infoBlock(card, extra = []) {
  const s = card.student || {}
  const items = [
    ['Name', s.name], ['Class', `${s.className || ''}${s.section ? ' - ' + s.section : ''}`], ['Roll No.', s.rollNumber],
    ['Admission No.', s.admissionNo], ['Father', s.father], ['Mother', s.mother],
    ['Date of Birth', s.dob ? fmtDate(s.dob) : null], ...extra,
  ].filter(([, v]) => v != null && v !== '')
  return `<div class="info">${items.map(([k, v]) => `<div><span>${esc(k)}: </span><b>${esc(v)}</b></div>`).join('')}</div>`
}
function fmtDate(d) { try { const x = new Date(d); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d } }
function attendanceLine(card) {
  const a = card.attendance
  if (!a) return ''
  if (a.mode === 'perTerm') {
    const parts = card.plan.cardTerms.filter((t) => card.showTerms.includes(t.key)).map((t) => { const x = a.byTerm?.[t.key]; return `${esc(t.label)}: ${x ? `${x.present}/${x.marked}` : dash}` })
    return `<div class="sec"><b style="font-size:11px">Attendance</b> &nbsp; ${parts.join(' &nbsp;·&nbsp; ')}</div>`
  }
  const x = a.sessionTotal
  return x ? `<div class="sec"><b style="font-size:11px">Attendance</b> &nbsp; ${x.present} / ${x.marked} days</div>` : ''
}
function gradeTable(title, rows, terms, showTerms) {
  if (!rows?.length) return ''
  const shown = terms.filter((t) => showTerms.includes(t.key))
  return `<div class="sec"><h4>${esc(title)}</h4><table><thead><tr><th class="l">Area</th>${shown.map((t) => `<th>${esc(t.label)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr><td class="l">${esc(r.name)}</td>${shown.map((t) => `<td>${esc(r.byTerm?.[t.key] ?? dash)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}
function remarkBlock(card) {
  return `<div class="sec"><h4>CLASS TEACHER'S REMARKS</h4><div class="remark">${esc(card.remark || '')}</div></div>`
}
function footer(card) {
  const f = card.footer || {}
  const bits = []
  if (f.achievement && card.session?.achievement) bits.push(`<div><span>Achievement: </span><b>${esc(card.session.achievement)}</b></div>`)
  if (f.heightWeight && (card.session?.heightCm || card.session?.weightKg)) bits.push(`<div><span>Height: </span><b>${fmt(card.session.heightCm)} cm</b> &nbsp; <span>Weight: </span><b>${fmt(card.session.weightKg)} kg</b></div>`)
  if ((f.promotedTo || f.promotedLine) && card.session?.promotedTo) bits.push(`<div><span>Promoted to: </span><b>${esc(card.session.promotedTo)}</b></div>`)
  if (f.result && card.result) bits.push(`<div class="result"><span>RESULT: </span><b class="${card.result === 'FAIL' ? 'fail' : ''}">${esc(card.result)}</b></div>`)
  return `${bits.length ? `<div class="sec info" style="grid-template-columns:1fr 1fr">${bits.join('')}</div>` : ''}
  <div class="foot"><div>Class Teacher</div><div>Parent / Guardian</div><div>Principal</div></div>`
}
function gradeLegend(card) {
  const b = card.scales?.gradeScale?.bands || []
  return `<div class="legend">Grading: ${b.map(([m, g]) => `${g} ≥ ${m}`).join(' · ')} · below ${b[b.length - 1]?.[0] ?? 33}: ${esc(card.scales?.gradeScale?.floorLabel || 'E')}</div>`
}

// ── Family: performance_profile (I–VIII) ────────────────────────────────────
function renderPerformanceProfile(card) {
  const terms = card.plan.cardTerms
  const shown = terms.filter((t) => card.showTerms.includes(t.key))
  const comps = card.plan.components
  const perTermMax = comps.reduce((s, c) => s + (c.max || 0), 0)
  const head1 = `<tr><th class="l" rowspan="2">SUBJECT</th>${shown.map((t) => `<th colspan="${comps.length + 2}">${esc(t.label)}${t.examLabel ? `<br><span style="font-weight:500">(${esc(t.examLabel)})</span>` : ''}</th>`).join('')}<th rowspan="2">GRAND<br>TOTAL<br>/${perTermMax * shown.length}</th><th rowspan="2">GRADE</th></tr>`
  const head2 = `<tr>${shown.map(() => comps.map((c) => `<th>${esc(c.label)}<br>/${c.max}</th>`).join('') + `<th>TOTAL<br>/${perTermMax}</th><th>GR.</th>`).join('')}</tr>`
  const body = card.rows.map((r) => `<tr><td class="l sub">${esc(r.subject)}</td>${shown.map((t) => {
    const cell = r.byTerm[t.key]
    if (!cell || cell.hidden) return comps.map(() => '<td></td>').join('') + '<td></td><td></td>'
    return comps.map((c) => `<td>${cellVal(cell.comps[c.key])}</td>`).join('') + `<td><b>${cell.complete ? cell.obtained : dash}</b></td><td>${cell.complete ? esc(cell.grade) : dash}</td>`
  }).join('')}<td><b>${r.total.max ? r.total.obtained : dash}</b></td><td>${r.total.grade ? esc(r.total.grade) : dash}</td></tr>`).join('')
  const ov = card.overall
  const tot = `<tr class="tot"><td class="l">TOTAL</td>${shown.map((t) => { const o = ov.byTerm?.[t.key]; return comps.map(() => '<td></td>').join('') + `<td>${o ? `${o.obtained}/${o.max}` : dash}</td><td>${o?.grade ? esc(o.grade) : ''}</td>` }).join('')}<td>${ov.max ? `${ov.obtained}/${ov.max}` : dash}</td><td>${ov.pct != null ? `${ov.pct.toFixed(1)}%` : ''}</td></tr>`
  const subtitle = `Session ${card.sessionCode}${card.interim || card.showTerms.length === 1 ? ` · ${shown.map((t) => t.label).join(' & ')}` : ''}`
  return `<div class="page">${stamp(card)}${header(card, subtitle)}${infoBlock(card, [['House', card.student?.house]])}
  <table><thead>${head1}${head2}</thead><tbody>${body}${tot}</tbody></table>
  ${gradeLegend(card)}
  <div class="two">${gradeTable('GRADED SUBJECTS', card.gradedSubjects, terms, card.showTerms)}${gradeTable('CO-SCHOLASTIC AREAS', card.coScholastic, terms, card.showTerms)}</div>
  ${disciplineRow(card, shown)}
  ${attendanceLine(card)}
  ${remarkBlock(card)}
  ${footer(card)}</div>`
}
function disciplineRow(card, shown) {
  if (!card.discipline) return ''
  const any = shown.some((t) => card.discipline[t.key] != null)
  if (!any) return ''
  return `<div class="sec" style="font-size:11px"><b>Discipline:</b> ${shown.map((t) => `${esc(t.label)} <b>${esc(card.discipline[t.key] ?? dash)}</b>`).join(' &nbsp;·&nbsp; ')}</div>`
}

// ── Family: secondary_annual (IX–X) ─────────────────────────────────────────
function renderSecondary(card) {
  const ia = card.plan.components.filter((c) => c.ia)
  const exam = card.plan.components.find((c) => !c.ia)
  const iaTotal = card.plan.iaTotal || ia.reduce((s, c) => s + c.max, 0)
  const head1 = `<tr><th class="l" rowspan="2">SUBJECT</th><th rowspan="2">CODE</th><th colspan="${ia.length + 1}">INTERNAL ASSESSMENT /${iaTotal}</th><th colspan="3">ANNUAL EXAM</th><th rowspan="2">TOTAL<br>/${card.plan.subjectTotal}</th><th rowspan="2">GRADE</th></tr>`
  const head2 = `<tr>${ia.map((c) => `<th>${esc(c.label)}<br>/${c.max}</th>`).join('')}<th>TOTAL</th><th>PRAC.</th><th>WRITTEN</th><th>TOTAL</th></tr>`
  const body = card.rows.map((r) => {
    const cell = r.byTerm.annual || {}
    const iaSum = ia.reduce((s, c) => { const v = cell.comps?.[c.key]; return v && !v.missing ? s + (v.value || 0) : s }, 0)
    const iaOk = ia.every((c) => { const v = cell.comps?.[c.key]; return v && !v.missing })
    const ex = cell.comps?.exam
    const exTot = ex && !ex.missing ? (ex.absent ? 'AB' : ex.value) : dash
    const pr = ex && !ex.missing && ex.practicalMax ? ex.practical : (ex && !ex.missing ? dash : dash)
    const wr = ex && !ex.missing ? (ex.theoryMax ? ex.theory : ex.value) : dash
    return `<tr><td class="l sub">${esc(r.subject)}${r.additional ? ' <span style="font-weight:400;font-size:9px">(Additional)</span>' : ''}</td><td>${esc(r.locCode || '')}</td>${ia.map((c) => `<td>${cellVal(cell.comps?.[c.key])}</td>`).join('')}<td><b>${iaOk ? iaSum : dash}</b></td><td>${ex?.absent ? 'AB' : fmt(pr)}</td><td>${ex?.absent ? 'AB' : fmt(wr)}</td><td><b>${fmt(exTot)}</b></td><td><b>${cell.complete ? cell.obtained : dash}</b></td><td>${cell.complete ? esc(cell.grade) : dash}</td></tr>`
  }).join('')
  const ov = card.overall
  const tot = `<tr class="tot"><td class="l" colspan="${ia.length + 6}">GRAND TOTAL (excluding additional subjects)</td><td>${ov.max ? `${ov.obtained}/${ov.max}` : dash}</td><td>${ov.pct != null ? `${ov.pct.toFixed(1)}%` : ''}</td></tr>`
  const extra = [['Board Reg. No.', card.student?.boardRegNo], ['Comp ID', card.student?.compId]]
  return `<div class="page">${stamp(card)}${header(card, `Session ${card.sessionCode} · ANNUAL`)}${infoBlock(card, extra)}
  <table><thead>${head1}${head2}</thead><tbody>${body}${tot}</tbody></table>
  ${card.legend ? `<div class="legend">${esc(card.legend)}</div>` : ''}${gradeLegend(card)}
  <div class="two">${gradeTable('CO-SCHOLASTIC AREAS', card.coScholastic, card.plan.cardTerms, card.showTerms)}${gradeTable('GRADED SUBJECTS', card.gradedSubjects, card.plan.cardTerms, card.showTerms)}</div>
  ${disciplineRow(card, card.plan.cardTerms)}
  ${attendanceLine(card)}
  ${remarkBlock(card)}
  ${footer(card)}</div>`
}

// ── Family: senior_progress (XI–XII) ────────────────────────────────────────
function renderSenior(card) {
  const terms = card.plan.cardTerms
  const shown = terms.filter((t) => card.showTerms.includes(t.key))
  const head1 = `<tr><th class="l" rowspan="2">SUBJECT</th>${shown.map((t) => `<th colspan="4">${esc(t.label)}</th>`).join('')}<th rowspan="2">TOTAL<br>/${card.plan.subjectTotal / terms.length * shown.length}</th><th rowspan="2">GRADE</th></tr>`
  const head2 = `<tr>${shown.map(() => '<th>MM<br>TH/PR</th><th>THEORY</th><th>PRAC.</th><th>TOTAL</th>').join('')}</tr>`
  const body = card.rows.map((r) => `<tr><td class="l sub">${esc(r.subject)}</td>${shown.map((t) => {
    const cell = r.byTerm[t.key]; const ex = cell?.comps?.exam
    if (!cell || cell.hidden) return '<td></td><td></td><td></td><td></td>'
    if (!ex || ex.missing) return `<td>${dash}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td>`
    const mm = ex.theoryMax ? `${ex.theoryMax}/${ex.practicalMax}` : `${ex.max}`
    return `<td>${mm}</td><td>${ex.absent ? 'AB' : fmt(ex.theoryMax ? ex.theory : ex.value)}${cell.fail ? ' <span class="fail">F</span>' : ''}</td><td>${ex.absent ? 'AB' : (ex.practicalMax ? fmt(ex.practical) : dash)}</td><td><b>${ex.absent ? 'AB' : fmt(ex.value)}</b></td>`
  }).join('')}<td><b>${r.total.max ? r.total.obtained : dash}</b></td><td>${r.total.grade ? esc(r.total.grade) : dash}</td></tr>`).join('')
  const ov = card.overall
  const tot = `<tr class="tot"><td class="l">TOTAL</td>${shown.map((t) => { const o = ov.byTerm?.[t.key]; return `<td colspan="3"></td><td>${o ? `${o.obtained}/${o.max}` : dash}</td>` }).join('')}<td>${ov.max ? `${ov.obtained}/${ov.max}` : dash}</td><td>${ov.pct != null ? `${ov.pct.toFixed(1)}%` : ''}</td></tr>`
  const interimBits = card.interim ? `<div class="sec info" style="grid-template-columns:1fr 1fr 1fr"><div><span>Rank in section: </span><b>${card.rank ?? dash}${card.sectionStrength ? ` / ${card.sectionStrength}` : ''}</b></div>${card.sectionHighest ? `<div style="grid-column:span 2"><span>Section highest: </span><b>${esc(card.rows.filter((r) => !r.unmapped).map((r) => `${titleish(r.subject)} ${card.sectionHighest[r.subject] ?? dash}`).join(' · '))}</b></div>` : ''}</div>` : ''
  const extra = [['Stream', (card.className || '').replace(/^Class \d+ /, '')], ['Board Reg. No.', card.student?.boardRegNo]]
  return `<div class="page">${stamp(card)}${header(card, `Session ${card.sessionCode} · ${shown.map((t) => t.label).join(' & ')}`)}${infoBlock(card, extra)}
  <table><thead>${head1}${head2}</thead><tbody>${body}${tot}</tbody></table>
  ${gradeLegend(card)}${interimBits}
  ${disciplineRow(card, shown)}
  ${attendanceLine(card)}
  ${remarkBlock(card)}
  ${footer(card)}</div>`
}
function titleish(s) { return String(s).split(' ').map((w) => w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w).join(' ') }
