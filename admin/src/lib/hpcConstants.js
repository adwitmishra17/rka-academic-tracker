// HPC domain/indicator structure + rating scale — mirror of SMS src/lib/hpc.js.
// Pure constants (no network). The mirrored `domains` JSONB uses these keys.

export const HPC_CLASSES = ['Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2']

export const RATINGS = [
  { value: 'beginner',    label: 'Beginner',    short: 'B',  color: '#a55b00' },
  { value: 'progressing', label: 'Progressing', short: 'P',  color: '#1e40af' },
  { value: 'proficient',  label: 'Proficient',  short: 'Pf', color: '#0a7d3a' },
  { value: 'advanced',    label: 'Advanced',    short: 'A',  color: '#0a7d3a' },
]
export function ratingLabel(v) { return RATINGS.find(r => r.value === v)?.label || '—' }

export const DOMAINS = [
  { key: 'physical', name: 'Physical Development & Wellbeing', indicators: [
    { key: 'gross_motor',   label: 'Gross motor skills (running, jumping, climbing)' },
    { key: 'fine_motor',    label: 'Fine motor skills (holding pencil, scissors, beads)' },
    { key: 'self_care',     label: 'Self-care (eating, washing, dressing)' },
    { key: 'health_habits', label: 'Hygiene and healthy habits' },
  ]},
  { key: 'socio', name: 'Socio-Emotional & Ethical Development', indicators: [
    { key: 'self_aware',  label: 'Recognizes and expresses own feelings' },
    { key: 'empathy',     label: 'Shows empathy and shares with peers' },
    { key: 'cooperation', label: 'Cooperates in group activities' },
    { key: 'manners',     label: 'Follows classroom etiquette and rules' },
  ]},
  { key: 'cognitive', name: 'Cognitive Development', indicators: [
    { key: 'observation', label: 'Observes and asks questions about surroundings' },
    { key: 'reasoning',   label: 'Solves age-appropriate puzzles' },
    { key: 'memory',      label: 'Recalls instructions and stories' },
    { key: 'creativity',  label: 'Comes up with new ideas in play and learning' },
  ]},
  { key: 'language', name: 'Language & Literacy Development', indicators: [
    { key: 'listening', label: 'Listens attentively to stories and instructions' },
    { key: 'speaking',  label: 'Speaks clearly; uses age-appropriate vocabulary' },
    { key: 'reading',   label: 'Recognizes letters/words; emerging reading' },
    { key: 'writing',   label: 'Writes letters / own name / simple words' },
  ]},
  { key: 'numeracy', name: 'Numeracy & Environmental Awareness', indicators: [
    { key: 'counting',    label: 'Counts and recognizes numbers' },
    { key: 'shapes',      label: 'Identifies shapes, sizes, patterns' },
    { key: 'measurement', label: 'Compares quantity, length, weight (simple)' },
    { key: 'environment', label: 'Curious about plants, animals, weather' },
  ]},
  { key: 'aesthetic', name: 'Aesthetic, Cultural & Creative Arts', indicators: [
    { key: 'drawing', label: 'Drawing, painting, colouring' },
    { key: 'music',   label: 'Engages with rhymes, songs, rhythm' },
    { key: 'dance',   label: 'Movement and dance' },
    { key: 'culture', label: 'Participates in festivals / cultural activities' },
  ]},
]
