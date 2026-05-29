// CBSE List of Candidates — pure constants (mirror of SMS src/lib/loc.js).

export const EXAM_CLASSES = [
  { value: '10', label: 'Class 10 (AISSE)' },
  { value: '12', label: 'Class 12 (AISSCE)' },
]
export const STATUSES = [
  { value: 'draft',     label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'finalised', label: 'Finalised' },
  { value: 'withdrawn', label: 'Withdrawn' },
]
export const CWSN_CATEGORIES = [
  { value: 'VI',  label: 'Visually impaired' },
  { value: 'HI',  label: 'Hearing impaired' },
  { value: 'OPH', label: 'Orthopedically handicapped' },
  { value: 'AUT', label: 'Autism spectrum disorder' },
  { value: 'LD',  label: 'Specific learning disability' },
  { value: 'CP',  label: 'Cerebral palsy' },
  { value: 'OTH', label: 'Other' },
]

// CSV columns for the CBSE LoC portal (review vs the year's template before upload).
export const LOC_CSV_COLUMNS = [
  { label: 'School Code',           get: () => '' },
  { label: 'Adm No.',               get: (r) => r.students?.admission_no || '' },
  { label: 'Candidate Name',        get: (r) => r.candidate_name || '' },
  { label: 'Father Name',           get: (r) => r.father_name || '' },
  { label: 'Mother Name',           get: (r) => r.mother_name || '' },
  { label: 'Date of Birth',         get: (r) => r.date_of_birth || '' },
  { label: 'Gender',                get: (r) => r.gender || '' },
  { label: 'Nationality',           get: (r) => r.nationality || 'Indian' },
  { label: 'Category',              get: (r) => r.category || '' },
  { label: 'Religion',              get: (r) => r.religion || '' },
  { label: 'Aadhaar No.',           get: (r) => r.aadhaar_no || '' },
  { label: 'APAAR ID',              get: (r) => r.apaar_id || '' },
  { label: 'Identification Mark 1', get: (r) => r.identification_mark_1 || '' },
  { label: 'Identification Mark 2', get: (r) => r.identification_mark_2 || '' },
  { label: 'Subject Codes',         get: (r) => (r.subject_codes || []).join('+') },
  { label: 'Subject Names',         get: (r) => r.subject_names || '' },
  { label: 'CWSN',                  get: (r) => r.is_cwsn ? 'YES' : 'NO' },
  { label: 'CWSN Category',         get: (r) => r.cwsn_category || '' },
  { label: 'Needs Scribe',          get: (r) => r.needs_scribe ? 'YES' : 'NO' },
  { label: 'Needs Extra Time',      get: (r) => r.needs_extra_time ? 'YES' : 'NO' },
  { label: 'Stream',                get: (r) => r.stream || '' },
  { label: 'Science Path',          get: (r) => r.science_path || '' },
]

export function toCsv(candidates) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = LOC_CSV_COLUMNS.map(c => esc(c.label)).join(',')
  const rows = candidates.map(r => LOC_CSV_COLUMNS.map(c => esc(c.get(r))).join(','))
  return [header, ...rows].join('\n')
}
