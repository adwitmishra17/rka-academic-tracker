// Default Holistic Progress Card definition — seeded into report_card_templates
// (family 'hpc') the first time a session is opened in HPC Cards → Setup.
// Shared by server (seed) and client (fallback rendering). Pure data.

export const HPC_SCALES = {
  nep4: { key: 'nep4', label: 'NEP levels · Beginner / Progressing / Proficient / Advanced', options: [
    { value: 'beginner', label: 'Beginner', short: 'B', color: '#a55b00' },
    { value: 'progressing', label: 'Progressing', short: 'P', color: '#1e40af' },
    { value: 'proficient', label: 'Proficient', short: 'Pf', color: '#0a7d3a' },
    { value: 'advanced', label: 'Advanced', short: 'A', color: '#0a7d3a' },
  ] },
  letters5: { key: 'letters5', label: 'Grades · A+ / A / B / C / D', options: [
    { value: 'A+', label: 'A+', short: 'A+', color: '#0a7d3a' }, { value: 'A', label: 'A', short: 'A', color: '#0a7d3a' },
    { value: 'B', label: 'B', short: 'B', color: '#1e40af' }, { value: 'C', label: 'C', short: 'C', color: '#a55b00' }, { value: 'D', label: 'D', short: 'D', color: '#b00020' },
  ] },
  abc: { key: 'abc', label: 'Grades · A / B / C', options: [
    { value: 'A', label: 'A', short: 'A', color: '#0a7d3a' }, { value: 'B', label: 'B', short: 'B', color: '#1e40af' }, { value: 'C', label: 'C', short: 'C', color: '#a55b00' },
  ] },
}

export const DEFAULT_HPC_DEFINITION = {
  v: 1,
  title: 'HOLISTIC PROGRESS CARD',
  classes: ['Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2'],
  termCodes: ['HY', 'AN'],
  scale: HPC_SCALES.nep4,
  domainRemarks: true,
  generalRemarks: true,
  domains: [
    { key: 'physical', name: 'Physical Development & Wellbeing', indicators: [
      { key: 'gross_motor', label: 'Gross motor skills (running, jumping, climbing)' },
      { key: 'fine_motor', label: 'Fine motor skills (holding pencil, scissors, beads)' },
      { key: 'self_care', label: 'Self-care (eating, washing, dressing)' },
      { key: 'health_habits', label: 'Hygiene and healthy habits' },
    ] },
    { key: 'socio', name: 'Socio-Emotional & Ethical Development', indicators: [
      { key: 'self_aware', label: 'Recognizes and expresses own feelings' },
      { key: 'empathy', label: 'Shows empathy and shares with peers' },
      { key: 'cooperation', label: 'Cooperates in group activities' },
      { key: 'manners', label: 'Follows classroom etiquette and rules' },
    ] },
    { key: 'cognitive', name: 'Cognitive Development', indicators: [
      { key: 'observation', label: 'Observes and asks questions about surroundings' },
      { key: 'reasoning', label: 'Solves age-appropriate puzzles' },
      { key: 'memory', label: 'Recalls instructions and stories' },
      { key: 'creativity', label: 'Comes up with new ideas in play and learning' },
    ] },
    { key: 'language', name: 'Language & Literacy Development', indicators: [
      { key: 'listening', label: 'Listens attentively to stories and instructions' },
      { key: 'speaking', label: 'Speaks clearly; uses age-appropriate vocabulary' },
      { key: 'reading', label: 'Recognizes letters/words; emerging reading' },
      { key: 'writing', label: 'Writes letters / own name / simple words' },
    ] },
    { key: 'numeracy', name: 'Numeracy & Environmental Awareness', indicators: [
      { key: 'counting', label: 'Counts and recognizes numbers' },
      { key: 'shapes', label: 'Identifies shapes, sizes, patterns' },
      { key: 'measurement', label: 'Compares quantity, length, weight (simple)' },
      { key: 'environment', label: 'Curious about plants, animals, weather' },
    ] },
    { key: 'aesthetic', name: 'Aesthetic, Cultural & Creative Arts', indicators: [
      { key: 'drawing', label: 'Drawing, painting, colouring' },
      { key: 'music', label: 'Engages with rhymes, songs, rhythm' },
      { key: 'dance', label: 'Movement and dance' },
      { key: 'culture', label: 'Participates in festivals / cultural activities' },
    ] },
  ],
}

/** Overall domain rating = the most common indicator rating (ties → the higher one on the scale). */
export function domainRatingFromIndicators(indicators = {}, scale = HPC_SCALES.nep4) {
  const order = scale.options.map((o) => o.value)
  const counts = new Map()
  for (const v of Object.values(indicators || {})) if (v) counts.set(v, (counts.get(v) || 0) + 1)
  if (!counts.size) return null
  let best = null, bestN = -1
  for (const [v, n] of counts) if (n > bestN || (n === bestN && order.indexOf(v) > order.indexOf(best))) { best = v; bestN = n }
  return best
}
export const slug = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'item'
