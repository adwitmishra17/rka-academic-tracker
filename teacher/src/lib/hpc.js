// ============================================================================
// hpc.js — HPC domain / indicator constants for Nursery–Class 2
//
// IMPORTANT: The keys used here (domain keys and indicator keys) MUST match
// exactly the keys in the SMS repo's src/lib/hpc.js.  The Cloud Function sync
// writes these keys verbatim into the Supabase hpc_assessments.domains JSONB
// column, and the SMS print engine reads them by these exact names.
//
// Do NOT rename keys without also updating SMS + the sync function.
// ============================================================================

export const HPC_CLASSES = ['Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2']

export const RATINGS = ['beginner', 'progressing', 'proficient', 'advanced']

export const RATING_LABELS = {
  beginner:    'Beginner',
  progressing: 'Progressing',
  proficient:  'Proficient',
  advanced:    'Advanced',
}

export const RATING_COLORS = {
  beginner:    'var(--crimson)',
  progressing: 'var(--gold-dark)',
  proficient:  'var(--green)',
  advanced:    '#1a6e96',
}

export const RATING_BG = {
  beginner:    'var(--crimson-light)',
  progressing: 'var(--gold-light)',
  proficient:  'var(--green-light)',
  advanced:    '#e6f1fb',
}

// Ordered list of domains — keep this order; SMS prints in this sequence.
export const DOMAIN_KEYS = ['physical', 'socio', 'cognitive', 'language', 'numeracy', 'aesthetic']

export const DOMAINS = {
  physical: {
    label: 'Physical Development',
    indicators: {
      gross_motor:  'Gross Motor Skills',
      fine_motor:   'Fine Motor Skills',
      self_care:    'Self-Care & Independence',
      health_habits:'Health & Hygiene Habits',
    },
  },
  socio: {
    label: 'Socio-Emotional Development',
    indicators: {
      self_aware:  'Self-Awareness',
      empathy:     'Empathy & Feelings',
      cooperation: 'Cooperation & Sharing',
      manners:     'Manners & Etiquette',
    },
  },
  cognitive: {
    label: 'Cognitive Development',
    indicators: {
      observation: 'Observation & Curiosity',
      reasoning:   'Problem Solving & Reasoning',
      memory:      'Memory & Recall',
      creativity:  'Creativity & Imagination',
    },
  },
  language: {
    label: 'Language & Communication',
    indicators: {
      listening: 'Listening Comprehension',
      speaking:  'Speaking & Expression',
      reading:   'Pre-Reading / Reading',
      writing:   'Pre-Writing / Writing',
    },
  },
  numeracy: {
    label: 'Numeracy & Mathematical Thinking',
    indicators: {
      counting:    'Counting & Number Sense',
      shapes:      'Shapes & Spatial Sense',
      measurement: 'Measurement & Comparison',
      environment: 'Math in the Environment',
    },
  },
  aesthetic: {
    label: 'Aesthetic & Cultural Development',
    indicators: {
      drawing: 'Drawing & Visual Arts',
      music:   'Music & Rhymes',
      dance:   'Dance & Movement',
      culture: 'Cultural Appreciation',
    },
  },
}

/**
 * Build an empty domains payload ready for a new HPC assessment.
 * Each indicator and domain rating defaults to null (unset).
 */
export function emptyDomains() {
  const result = {}
  for (const dk of DOMAIN_KEYS) {
    const domain = DOMAINS[dk]
    result[dk] = {
      rating:     null,
      remarks:    '',
      indicators: Object.fromEntries(
        Object.keys(domain.indicators).map(ik => [ik, null])
      ),
    }
  }
  return result
}

/**
 * Suggest an overall domain rating from its indicator ratings.
 * Uses the mode (most frequent non-null rating); ties go to the higher level.
 */
export function suggestDomainRating(indicators) {
  const values = Object.values(indicators).filter(v => RATINGS.includes(v))
  if (!values.length) return null
  const counts = {}
  values.forEach(v => { counts[v] = (counts[v] || 0) + 1 })
  return RATINGS.slice().reverse().reduce((best, r) =>
    (counts[r] || 0) >= (counts[best] || 0) ? r : best
  )
}

/**
 * Returns true if every indicator in every domain has a non-null rating.
 */
export function isComplete(domains) {
  for (const dk of DOMAIN_KEYS) {
    const d = domains[dk]
    if (!d) return false
    if (!RATINGS.includes(d.rating)) return false
    for (const v of Object.values(d.indicators || {})) {
      if (!RATINGS.includes(v)) return false
    }
  }
  return true
}
