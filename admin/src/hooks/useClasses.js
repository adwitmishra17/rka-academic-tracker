import { useState, useEffect } from 'react'
import { collection, getDocs, onSnapshot, query } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { branchConstraints } from '../lib/branchQuery'

// Grade band ordering (lower = appears first in sorted lists)
const GRADE_BAND_ORDER = {
  'pre-primary': 0,
  'primary': 1,
  'middle': 2,
  'secondary': 3,
  'senior-secondary': 4,
}

// Infer grade band from class name when the field isn't set on the doc
// (used for backwards compatibility with classes created before gradeBand existed)
export function inferGradeBand(className) {
  if (!className) return 'secondary'
  const lower = className.toLowerCase()
  if (lower.includes('nursery') || lower.includes('lkg') || lower.includes('ukg') || lower.includes('pre-primary') || lower.includes('kg')) return 'pre-primary'
  if (lower.match(/class\s*[1-5]\b/)) return 'primary'
  if (lower.match(/class\s*[6-8]\b/)) return 'middle'
  if (lower.match(/class\s*9\b/) || lower.match(/class\s*10\b/)) return 'secondary'
  if (lower.match(/class\s*1[12]/)) return 'senior-secondary'
  return 'secondary'
}

// Extract sortable grade number from class name (Nursery=-3, LKG=-2, UKG=-1, Class N = N)
function gradeNum(className) {
  if (!className) return 999
  const lower = className.toLowerCase()
  if (lower.includes('nursery')) return -3
  if (lower.includes('lkg')) return -2
  if (lower.includes('ukg')) return -1
  const m = className.match(/\d+/)
  return m ? Number(m[0]) : 999
}

// Sort classes: by grade band first, then numeric grade, then alphabetic for streams
function sortClasses(arr) {
  return [...arr].sort((a, b) => {
    const ba = GRADE_BAND_ORDER[a.gradeBand] ?? GRADE_BAND_ORDER[inferGradeBand(a.className)]
    const bb = GRADE_BAND_ORDER[b.gradeBand] ?? GRADE_BAND_ORDER[inferGradeBand(b.className)]
    if (ba !== bb) return ba - bb
    const ga = gradeNum(a.className), gb = gradeNum(b.className)
    if (ga !== gb) return ga - gb
    return (a.className || '').localeCompare(b.className || '')
  })
}

/**
 * useClasses — load all classes from Firestore, sorted by grade band + grade number.
 *
 * @param {Object} opts
 * @param {boolean} [opts.includeAll=false] — prefix the returned name list with 'All'
 * @param {string|string[]} [opts.bands] — restrict to these grade bands (e.g. 'middle', or ['middle','secondary'])
 * @param {boolean} [opts.live=false] — use a real-time listener instead of one-shot fetch
 * @returns {{ classes: Array, classNames: string[], loading: boolean, error: any, refresh: ()=>void }}
 *   classes: full class docs with gradeBand, optionalSubjects, classTeacherId, etc.
 *   classNames: just the className strings (for dropdowns)
 */
export function useClasses(opts = {}) {
  const { includeAll = false, bands, live = false } = opts
  const { effectiveBranches } = useAuth()
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let unsub = null
    setLoading(true)
    // Apply branch filter — useAuth provides effectiveBranches; on All Branches
    // (super admin) the constraints array is empty and the query is a no-op
    // filter (i.e. returns all classes).
    const q = query(collection(db, 'classes'), ...branchConstraints('branchCode', effectiveBranches))
    if (live) {
      unsub = onSnapshot(
        q,
        snap => {
          const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          setClasses(sortClasses(data))
          setLoading(false)
        },
        err => { setError(err); setLoading(false) }
      )
    } else {
      getDocs(q)
        .then(snap => {
          const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          setClasses(sortClasses(data))
          setLoading(false)
        })
        .catch(err => { setError(err); setLoading(false) })
    }
    return () => { if (unsub) unsub() }
  }, [live, refreshKey, effectiveBranches])

  // Filter by grade band(s) if requested
  const filtered = bands
    ? classes.filter(c => {
        const band = c.gradeBand || inferGradeBand(c.className)
        return Array.isArray(bands) ? bands.includes(band) : band === bands
      })
    : classes

  const classNames = filtered.map(c => c.className).filter(Boolean)
  const namesWithAll = includeAll ? ['All', ...classNames] : classNames

  return {
    classes: filtered,
    classNames: namesWithAll,
    loading,
    error,
    refresh: () => setRefreshKey(k => k + 1),
  }
}

// Default subject lists by grade band — used when creating new classes
// to seed sensible defaults in classSubjects mapping
export const DEFAULT_SUBJECTS_BY_BAND = {
  'pre-primary': ['English', 'Hindi', 'Numbers', 'Stories', 'Art', 'Physical Activity'],
  'primary': ['English', 'Hindi', 'Mathematics', 'EVS', 'Computer Science', 'Art', 'Physical Education', 'General Knowledge'],
  'middle': ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Sanskrit', 'Computer Science', 'Art', 'Physical Education', 'General Knowledge'],
  'secondary': ['Mathematics', 'Science', 'English', 'Hindi', 'Social Science', 'History', 'Political Science', 'Geography', 'Economics', 'Sanskrit', 'Physical Education', 'Computers', 'Artificial Intelligence'],
  'senior-secondary': ['Mathematics', 'English', 'Hindi', 'Physical Education', 'Computers'],
}

export const GRADE_BAND_LABELS = {
  'pre-primary': 'Pre-Primary (Nursery, LKG, UKG)',
  'primary': 'Primary (Class 1–5)',
  'middle': 'Middle School (Class 6–8)',
  'secondary': 'Secondary (Class 9–10)',
  'senior-secondary': 'Senior Secondary (Class 11–12)',
}

export { GRADE_BAND_ORDER }
