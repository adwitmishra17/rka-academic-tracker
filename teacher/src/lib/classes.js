// =========================================================================
// classes.js — canonical class list and helpers for RKA
//
// This is the single source of truth for class names across the entire
// system. Both the admin app and teacher PWA should import from this file.
// Database stores className as the exact string from CLASS_NAMES below.
// =========================================================================

// Ordered list — used for dropdowns and sorting. Display order is academic
// progression (Nursery first, Class 12 streams last).
export const CLASS_NAMES = [
  'Nursery', 'LKG', 'UKG',
  'Class 1', 'Class 2', 'Class 3', 'Class 4',
  'Class 5', 'Class 6', 'Class 7', 'Class 8',
  'Class 9', 'Class 10',
  'Class 11 Science', 'Class 11 Commerce', 'Class 11 Humanities',
  'Class 12 Science', 'Class 12 Commerce', 'Class 12 Humanities',
]

// Quick membership check
export function isValidClass(name) {
  return CLASS_NAMES.includes(name)
}

// True for pre-primary classes (Nursery/LKG/UKG) — they may need
// different UI treatment (e.g. fewer required fields).
export function isPreSchool(className) {
  return ['Nursery', 'LKG', 'UKG'].includes(className)
}

// True only for Class 11/12 — used to decide whether to require the
// `optional` subject field on student records.
export function requiresOptional(className) {
  return /^Class (11|12)\b/.test(className)
}

// True only for Class 11/12 SCIENCE — used to decide whether to require
// `sciencePath` (PCM/PCB) on student records.
export function requiresSciencePath(className) {
  return /^Class (11|12) Science$/.test(className)
}

// Optional subjects offered for Class 11/12 students by default.
// (Commerce streams additionally offer Maths — see optionalSubjectsFor.)
export const OPTIONAL_SUBJECTS = ['Hindi', 'Physical Education', 'Computers']

// Returns the optional-subject list to show for a given className.
// Default = the constant above.
// Class 11/12 Commerce additionally include 'Maths' (some commerce students
// elect to take Maths; others choose one of the default three).
export function optionalSubjectsFor(className) {
  if (className === 'Class 11 Commerce' || className === 'Class 12 Commerce') {
    return [...OPTIONAL_SUBJECTS, 'Maths']
  }
  return OPTIONAL_SUBJECTS
}

// Science streams offered for Class 11/12 Science students.
export const SCIENCE_PATHS = ['PCM', 'PCB']

// Sort order for class names matches their order in CLASS_NAMES.
// Used to sort lists of mixed classes consistently.
const ORDER_MAP = new Map(CLASS_NAMES.map((c, i) => [c, i]))
export function compareClasses(a, b) {
  const ai = ORDER_MAP.has(a) ? ORDER_MAP.get(a) : 999
  const bi = ORDER_MAP.has(b) ? ORDER_MAP.get(b) : 999
  return ai - bi
}
