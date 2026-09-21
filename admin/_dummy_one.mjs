import { readFileSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
const OUT='/private/tmp/claude-502/-Users-adwitsdocs/23ccad94-21ca-4562-8587-6bc3caa5e07d/scratchpad/out'
const html=readFileSync(`${OUT}/RKA-MAIN-dummy-report-cards.html`,'utf8')
const head=html.slice(0, html.indexOf('<body>')+6)
const pages=[...html.matchAll(/<div class="page">[\s\S]*?<\/div>\s*(?=<div class="page">|<\/body>)/g)].map(m=>m[0])
// Class 3 annual (final) card: section "3 – A" + PROMOTED (final)
const idx=pages.findIndex(p=>/>\s*3\s*[–-]\s*[A-Z]/.test(p) && /PROMOTED TO/.test(p))
console.log('Class 3 annual idx:', idx)
const doc=head+pages[idx]+'</body></html>'
writeFileSync(`${OUT}/RKA-class3-annual-sample.html`, doc)
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
execFileSync(CHROME,['--headless','--disable-gpu','--no-pdf-header-footer','--virtual-time-budget=18000',`--print-to-pdf=${OUT}/RKA-class3-annual-sample.pdf`,`file://${OUT}/RKA-class3-annual-sample.html`],{stdio:'ignore'})
execFileSync(CHROME,['--headless','--disable-gpu','--hide-scrollbars','--virtual-time-budget=15000','--window-size=794,1123',`--screenshot=${OUT}/shot_class3.png`,`file://${OUT}/RKA-class3-annual-sample.html`],{stdio:'ignore'})
console.log('done')
