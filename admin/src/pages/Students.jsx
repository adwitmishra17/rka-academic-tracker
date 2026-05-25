import React, { useState, useEffect, useRef } from 'react'
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase/config'
import { useClasses } from '../hooks/useClasses'
import { useAuth } from '../App'
import { branchConstraints } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'
import { normalizePhone, isValidPhone, formatPhoneForDisplay } from '../lib/phone'
import { writeStudentAudit, diffStudent } from '../lib/studentAudit'
import { optionalSubjectsFor } from '../lib/classes'

// CLASSES loaded via useClasses()
const SCIENCE_PATHS = ['PCM', 'PCB']
const inputStyle = { width:'100%', padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:14, fontFamily:'var(--font-body)', color:'var(--text)', outline:'none', background:'var(--white)' }

// Fields tracked for audit diffs on edit
const AUDIT_FIELDS = [
  'fullName', 'rollNumber', 'admissionNo', 'className', 'fatherName', 'motherName',
  'parentPhone', 'parentEmail', 'dateOfAdmission', 'dateOfBirth',
  'optionalSubject', 'sciencePath', 'isActive',
]

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:20 }}>
      <div className="fade-in" style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth: wide ? 720 : 520, maxHeight:'90vh', overflowY:'auto', boxShadow:'var(--shadow-lg)' }}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'var(--white)', zIndex:1 }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:600, color:'var(--green-dark)' }}>{title}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:22, lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'24px' }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:4 }}>
        {label} {required && <span style={{ color:'var(--crimson)' }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize:11, color:'var(--gray-400)', marginTop:3 }}>{hint}</p>}
    </div>
  )
}

const emptyForm = { fullName:'', rollNumber:'', admissionNo:'', className:'', fatherName:'', motherName:'', parentPhone:'', parentEmail:'', dateOfAdmission:'', dateOfBirth:'', optionalSubject:'', sciencePath:'', isActive:true }

export default function Students() {
  const { classes: classDocs, classNames: CLASSES } = useClasses()
  const { effectiveBranches, currentBranch, allowedBranches, canSwitchBranches, user } = useAuth()
  const [formBranch, setFormBranch] = useState(() => currentBranch || allowedBranches[0])
  useEffect(() => {
    if (currentBranch) setFormBranch(currentBranch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranch])
  const showBranchPicker = !currentBranch && canSwitchBranches && allowedBranches.length > 1
  const navigate = useNavigate()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterClass, setFilterClass] = useState('All')
  const [search, setSearch] = useState('')
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showCSV, setShowCSV] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [csvRows, setCsvRows] = useState([])
  const [csvInvalidRows, setCsvInvalidRows] = useState([])
  const [showDataIssues, setShowDataIssues] = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef()

  // When CLASSES loads, ensure the form has a valid default
  useEffect(() => {
    if (CLASSES.length > 0 && !form.className) {
      setForm(f => ({ ...f, className: CLASSES[0] }))
    }
  }, [CLASSES.length])

  async function load() {
    setLoading(true)
    const q = query(collection(db, 'students'), ...branchConstraints('branchCode', effectiveBranches))
    const snap = await getDocs(q)
    setStudents(snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b) => {
      if (a.className !== b.className) return a.className.localeCompare(b.className)
      return Number(a.rollNumber||0) - Number(b.rollNumber||0)
    }))
    setLoading(false)
  }

  useEffect(() => { load() }, [effectiveBranches])

  // Filter
  const filtered = students.filter(s => {
    const matchClass = filterClass === 'All' || s.className === filterClass
    const matchSearch = !search || s.fullName?.toLowerCase().includes(search.toLowerCase()) || s.rollNumber?.includes(search)
    const matchActive = showWithdrawn ? true : (s.isActive !== false)
    return matchClass && matchSearch && matchActive
  })

  const needsOptional = (cls) => ['Class 11 Science','Class 11 Commerce','Class 11 Humanities','Class 12 Science','Class 12 Commerce','Class 12 Humanities'].includes(cls)
  const needsSciencePath = (cls) => ['Class 11 Science', 'Class 12 Science'].includes(cls)

  // Audit attribution — used in writeStudentAudit calls
  function auditActor() {
    const email = user?.email || 'unknown'
    return {
      performedBy: email,
      performedByName: email === 'adwit@rkacademyballia.in' ? 'Adwit (Super Admin)' : email,
      performedByRole: 'admin',  // this page is admin-only
    }
  }

  // Roll number helpers
  function nextAvailableRoll(className) {
    if (!className) return ''
    const inClass = students.filter(s => s.className === className).map(s => Number(s.rollNumber)).filter(n => Number.isFinite(n) && n > 0)
    if (inClass.length === 0) return '1'
    const max = Math.max(...inClass)
    // Use first gap if any (e.g. roll 5 missing in 1..10), else max+1
    for (let i = 1; i <= max; i++) {
      if (!inClass.includes(i)) return String(i)
    }
    return String(max + 1)
  }

  function isRollDuplicate(roll, className, ignoreStudentId = null) {
    const r = Number(roll)
    if (!Number.isFinite(r) || r < 1) return false
    return students.some(s => {
      if (ignoreStudentId && s.id === ignoreStudentId) return false
      return s.className === className && Number(s.rollNumber) === r
    })
  }

  // Existing data quality check — duplicates and bad roll numbers in current data
  const dataIssues = (() => {
    const dupes = []
    const badRolls = []
    const byClass = {}
    students.forEach(s => {
      const r = Number(s.rollNumber)
      if (!Number.isFinite(r) || r < 1) {
        badRolls.push(s)
        return
      }
      const key = `${s.className}__${r}`
      if (!byClass[key]) byClass[key] = []
      byClass[key].push(s)
    })
    Object.values(byClass).forEach(arr => { if (arr.length > 1) dupes.push(...arr) })
    return { dupes, badRolls }
  })()

  // Add / Edit student
  function openAdd() {
    setEditing(null)
    const initialClass = CLASSES[0] || ''
    setForm({ ...emptyForm, className: initialClass, rollNumber: initialClass ? nextAvailableRoll(initialClass) : '' })
    setError('')
    setShowAdd(true)
  }

  function openEdit(s) {
    setEditing(s)
    setForm({
      fullName: s.fullName || '', rollNumber: s.rollNumber || '',
      admissionNo: s.admissionNo || '',
      className: s.className || (CLASSES[0] || ''), fatherName: s.fatherName || '',
      motherName: s.motherName || '', parentPhone: s.parentPhone || '',
      parentEmail: s.parentEmail || '', dateOfAdmission: s.dateOfAdmission || '',
      dateOfBirth: s.dateOfBirth || '',
      optionalSubject: s.optionalSubject || '', sciencePath: s.sciencePath || '',
      isActive: s.isActive !== false
    })
    setError('')
    setShowAdd(true)
  }

  async function handleDelete(student) {
    if (!confirm(`Permanently delete ${student.fullName} from ${student.className}? This cannot be undone. (Tip: use Withdraw if you want to keep records.)`)) return
    try {
      await deleteDoc(doc(db, 'students', student.id))
      await writeStudentAudit({
        student,
        action: 'delete',
        ...auditActor(),
      })
      await load()
    } catch(e) { console.error(e) }
  }

  async function handleWithdraw(student) {
    if (!confirm(`Withdraw ${student.fullName} from ${student.className}? Their record stays but is hidden from active rosters.`)) return
    try {
      await updateDoc(doc(db, 'students', student.id), {
        isActive: false,
        withdrawnAt: Timestamp.now(),
        withdrawnBy: user?.email || 'unknown',
      })
      await writeStudentAudit({
        student,
        action: 'withdraw',
        ...auditActor(),
      })
      await load()
    } catch(e) { console.error(e) }
  }

  async function handleReactivate(student) {
    if (!confirm(`Reactivate ${student.fullName} in ${student.className}?`)) return
    try {
      await updateDoc(doc(db, 'students', student.id), {
        isActive: true,
        reactivatedAt: Timestamp.now(),
        reactivatedBy: user?.email || 'unknown',
      })
      await writeStudentAudit({
        student,
        action: 'reactivate',
        ...auditActor(),
      })
      await load()
    } catch(e) { console.error(e) }
  }

  async function handleBulkDelete(className) {
    const toDelete = students.filter(s => s.className === className)
    if (toDelete.length === 0) { alert(`No students found in ${className}.`); return }
    if (!confirm(`Delete ALL ${toDelete.length} students in ${className}? This permanently removes their records and cannot be undone.`)) return
    try {
      // Write audit entries first so we keep history of bulk deletes
      await Promise.all(toDelete.map(s => writeStudentAudit({
        student: s, action: 'delete', notes: 'bulk delete by class', ...auditActor(),
      })))
      await Promise.all(toDelete.map(s => deleteDoc(doc(db, 'students', s.id))))
      await load()
    } catch(e) { console.error(e) }
  }

  async function handleSave() {
    if (!form.fullName.trim()) { setError('Full name is required.'); return }
    if (!form.rollNumber.toString().trim()) { setError('Roll number is required.'); return }
    const rollNum = Number(form.rollNumber)
    if (!Number.isFinite(rollNum) || rollNum < 1) { setError('Roll number must be a number 1 or higher.'); return }
    if (!form.className || !form.className.trim()) { setError('Class is required.'); return }
    if (isRollDuplicate(form.rollNumber, form.className, editing?.id)) {
      const taker = students.find(s => s.className === form.className && Number(s.rollNumber) === rollNum && s.id !== editing?.id)
      setError(`Roll number ${rollNum} is already used by ${taker?.fullName || 'another student'} in ${form.className}.`)
      return
    }
    if (needsOptional(form.className) && !form.optionalSubject) { setError('Optional subject is required for Class 11 & 12.'); return }
    if (needsSciencePath(form.className) && !form.sciencePath) { setError('Science path (PCM or PCB) is required for Class 11/12 Science.'); return }

    // Phone validation — empty allowed, junk rejected, valid normalized
    let normalizedPhone = ''
    const phoneInput = (form.parentPhone || '').trim()
    if (phoneInput) {
      const n = normalizePhone(phoneInput)
      if (!n) { setError('Parent phone is invalid. Must be a 10-digit Indian mobile (e.g. 9876543210 or +91 98765 43210).'); return }
      normalizedPhone = n
    }

    setSaving(true); setError('')
    const data = {
      fullName: form.fullName.trim(),
      rollNumber: String(rollNum),  // canonical numeric string
      admissionNo: (form.admissionNo || '').trim(),
      className: form.className,
      fatherName: form.fatherName.trim(),
      motherName: form.motherName.trim(),
      parentPhone: normalizedPhone,
      parentEmail: form.parentEmail.trim(),
      dateOfAdmission: form.dateOfAdmission,
      dateOfBirth: form.dateOfBirth,
      optionalSubject: needsOptional(form.className) ? form.optionalSubject : '',
      sciencePath: needsSciencePath(form.className) ? form.sciencePath : '',
      isActive: form.isActive,
    }
    try {
      if (editing) {
        // Editing preserves the original branch (don't allow accidental cross-branch moves here)
        await updateDoc(doc(db, 'students', editing.id), { ...data, updatedAt: Timestamp.now() })
        // Audit: diff what actually changed
        const { changedFields, hasChanges } = diffStudent(editing, data, AUDIT_FIELDS)
        if (hasChanges) {
          await writeStudentAudit({
            student: { id: editing.id, fullName: data.fullName, className: data.className, branchCode: editing.branchCode },
            action: 'edit',
            changedFields,
            ...auditActor(),
          })
        }
      } else {
        if (!formBranch) { setError('Please select a branch'); setSaving(false); return }
        const newDoc = await addDoc(collection(db, 'students'), { ...data, branchCode: formBranch, createdAt: Timestamp.now() })
        await writeStudentAudit({
          student: { id: newDoc.id, fullName: data.fullName, className: data.className, branchCode: formBranch },
          action: 'add',
          ...auditActor(),
        })
      }
      await load()
      setShowAdd(false)
    } catch(e) { setError('Failed to save. Please try again.') }
    setSaving(false)
  }

  // CSV handling
  function downloadTemplate() {
    const headers = 'fullName,rollNumber,admissionNo,className,fatherName,motherName,parentPhone,parentEmail,dateOfAdmission,dateOfBirth,optionalSubject,sciencePath'
    const sample1 = 'Aarav Singh,001,RKA/2024/001,Class 9,Rajesh Singh,Priya Singh,9800000001,,2024-04-01,2010-08-15,,'
    const sample2 = 'Priya Yadav,002,RKA/2024/002,Class 11 Science,Suresh Yadav,Meena Yadav,9800000002,,2024-04-01,2008-11-22,Physical Education,PCM'
    const sample3 = 'Rahul Gupta,001,RKA/2024/003,Class 11 Commerce,Amit Gupta,Neha Gupta,9800000003,neha@gmail.com,2024-04-01,2008-03-12,Hindi,'
    const csv = [headers, sample1, sample2, sample3].join('\n')
    const blob = new Blob([csv], { type:'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'RKA_Students_Template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      const lines = text.trim().split('\n')
      const headers = lines[0].split(',').map(h => h.trim())
      const allRows = lines.slice(1).map((line, idx) => {
        const vals = line.split(',').map(v => v.trim())
        const obj = { _rowNum: idx + 2 }   // +2 because line 0 is headers, +1 for 1-indexed
        headers.forEach((h, i) => { obj[h] = vals[i] || '' })
        return obj
      })

      // Build a Set of existing (className, rollNumber) for collision detection
      const existing = new Set()
      students.forEach(s => {
        const r = Number(s.rollNumber)
        if (Number.isFinite(r) && r >= 1) existing.add(`${s.className}__${r}`)
      })

      // Validate each row, also detect duplicates within the CSV itself
      const seenInCsv = new Set()
      const validRows = []
      const invalidRows = []
      for (const r of allRows) {
        if (!r.fullName) { invalidRows.push({ ...r, _reason: 'Missing fullName' }); continue }
        if (!r.className) { invalidRows.push({ ...r, _reason: 'Missing className' }); continue }
        const rollNum = Number(r.rollNumber)
        if (!Number.isFinite(rollNum) || rollNum < 1) {
          invalidRows.push({ ...r, _reason: `Invalid rollNumber "${r.rollNumber}" — must be 1 or higher` })
          continue
        }
        // Class 11/12 must specify optional subject; Science must specify path
        if (needsOptional(r.className) && !r.optionalSubject) {
          invalidRows.push({ ...r, _reason: `Class 11/12 student must have optionalSubject` })
          continue
        }
        if (needsSciencePath(r.className) && !r.sciencePath) {
          invalidRows.push({ ...r, _reason: `Class 11/12 Science student must have sciencePath (PCM or PCB)` })
          continue
        }
        if (r.sciencePath && !['PCM', 'PCB'].includes(r.sciencePath)) {
          invalidRows.push({ ...r, _reason: `Invalid sciencePath "${r.sciencePath}" — must be PCM or PCB` })
          continue
        }
        // Phone validation — empty allowed, invalid rejected, valid normalized
        let normalizedPhone = ''
        if (r.parentPhone) {
          const n = normalizePhone(r.parentPhone)
          if (!n) {
            invalidRows.push({ ...r, _reason: `Invalid parentPhone "${r.parentPhone}"` })
            continue
          }
          normalizedPhone = n
        }
        const key = `${r.className}__${rollNum}`
        if (seenInCsv.has(key)) {
          invalidRows.push({ ...r, _reason: `Duplicate roll ${rollNum} in ${r.className} (also in this CSV)` })
          continue
        }
        if (existing.has(key)) {
          invalidRows.push({ ...r, _reason: `Roll ${rollNum} already exists in ${r.className}` })
          continue
        }
        seenInCsv.add(key)
        // Normalize the rollNumber + phone to canonical form before adding
        validRows.push({ ...r, rollNumber: String(rollNum), parentPhone: normalizedPhone })
      }

      setCsvRows(validRows)
      setCsvInvalidRows(invalidRows)
      setShowPreview(true)
      setImportResult(null)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function importCSV() {
    if (!formBranch) { return }
    setCsvImporting(true)
    let success = 0; let failed = 0
    for (const row of csvRows) {
      try {
        const data = {
          fullName: row.fullName || '',
          rollNumber: row.rollNumber || '',
          admissionNo: (row.admissionNo || '').trim(),
          className: row.className || '',
          fatherName: row.fatherName || '',
          motherName: row.motherName || '',
          parentPhone: row.parentPhone || '',
          parentEmail: row.parentEmail || '',
          dateOfAdmission: row.dateOfAdmission || '',
          dateOfBirth: row.dateOfBirth || '',
          optionalSubject: needsOptional(row.className) ? (row.optionalSubject || '') : '',
          sciencePath: needsSciencePath(row.className) ? (row.sciencePath || '') : '',
          isActive: true,
          branchCode: formBranch,
          createdAt: Timestamp.now()
        }
        const newDoc = await addDoc(collection(db, 'students'), data)
        // Write per-row audit
        await writeStudentAudit({
          student: { id: newDoc.id, fullName: data.fullName, className: data.className, branchCode: formBranch },
          action: 'csv_import',
          notes: `Imported via CSV (row ${row._rowNum})`,
          ...auditActor(),
        })
        success++
      } catch(e) { failed++ }
    }
    setImportResult({ success, failed })
    setCsvImporting(false)
    await load()
  }

  // Stats
  const byClass = CLASSES.reduce((acc, c) => { acc[c] = students.filter(s => s.className === c).length; return acc }, {})
  const total = students.length
  const active = students.filter(s => s.isActive !== false).length

  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom:28, display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:4 }}>Students</h1>
          <p style={{ fontSize:14, color:'var(--text-muted)' }}>Manage student records and optional subject enrollment</p>
          <div style={{ width:48, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={() => setShowCSV(true)} style={{ padding:'10px 18px', background:'var(--white)', color:'var(--green)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV
          </button>
          <button onClick={openAdd} style={{ padding:'10px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:7, boxShadow:'0 2px 8px rgba(26,74,46,0.25)' }}>
            <span style={{ fontSize:18, lineHeight:1 }}>+</span> Add Student
          </button>
        </div>
      </div>

      {/* Data quality alert */}
      {(dataIssues.dupes.length > 0 || dataIssues.badRolls.length > 0) && (
        <div style={{ background:'var(--gold-light)', border:'1px solid rgba(201,162,39,0.35)', borderRadius:'var(--radius-lg)', padding:'14px 18px', marginBottom:18, display:'flex', gap:12, alignItems:'flex-start' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2" style={{ flexShrink:0, marginTop:2 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--gold-dark)', marginBottom:4 }}>Data quality issues found</div>
            <div style={{ fontSize:12, color:'var(--gold-dark)', lineHeight:1.5 }}>
              {dataIssues.dupes.length > 0 && (
                <div>{dataIssues.dupes.length} students have <strong>duplicate roll numbers</strong> within their class.</div>
              )}
              {dataIssues.badRolls.length > 0 && (
                <div>{dataIssues.badRolls.length} students have <strong>invalid roll numbers</strong> (zero, negative, empty, or non-numeric).</div>
              )}
              <div style={{ marginTop:6, fontSize:11.5 }}>
                Click "Review issues" to see them grouped — Edit each student to fix their roll number.
              </div>
            </div>
          </div>
          <button onClick={() => setShowDataIssues(s => !s)} style={{ padding:'7px 14px', background:'white', color:'var(--gold-dark)', border:'1px solid rgba(201,162,39,0.4)', borderRadius:'var(--radius-sm)', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            {showDataIssues ? 'Hide' : 'Review issues'}
          </button>
        </div>
      )}

      {showDataIssues && (dataIssues.dupes.length > 0 || dataIssues.badRolls.length > 0) && (
        <div style={{ background:'white', borderRadius:'var(--radius-md)', border:'1px solid var(--gold)', padding:'14px 18px', marginBottom:18 }}>
          {dataIssues.badRolls.length > 0 && (
            <div style={{ marginBottom: dataIssues.dupes.length > 0 ? 14 : 0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', marginBottom:8 }}>Invalid roll numbers ({dataIssues.badRolls.length})</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:200, overflowY:'auto' }}>
                {dataIssues.badRolls.map(s => (
                  <div key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)', fontSize:12 }}>
                    <span style={{ minWidth:60, color:'var(--crimson)', fontFamily:'var(--font-mono)' }}>"{s.rollNumber || '(empty)'}"</span>
                    <span style={{ flex:1 }}>{s.fullName} <span style={{ color:'var(--text-muted)' }}>· {s.className || 'no class'}</span></span>
                    <button onClick={() => openEdit(s)} style={{ padding:'3px 10px', background:'var(--green-light)', color:'var(--green)', border:'none', borderRadius:'var(--radius-sm)', fontSize:11, fontWeight:600, cursor:'pointer' }}>Edit</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dataIssues.dupes.length > 0 && (
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', marginBottom:8 }}>Duplicate roll numbers ({dataIssues.dupes.length})</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:240, overflowY:'auto' }}>
                {dataIssues.dupes.map(s => (
                  <div key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', background:'var(--gray-50)', borderRadius:'var(--radius-sm)', fontSize:12 }}>
                    <span style={{ minWidth:60, color:'var(--crimson)', fontFamily:'var(--font-mono)', fontWeight:600 }}>#{s.rollNumber}</span>
                    <span style={{ flex:1 }}>{s.fullName} <span style={{ color:'var(--text-muted)' }}>· {s.className}</span></span>
                    <button onClick={() => openEdit(s)} style={{ padding:'3px 10px', background:'var(--green-light)', color:'var(--green)', border:'none', borderRadius:'var(--radius-sm)', fontSize:11, fontWeight:600, cursor:'pointer' }}>Edit</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:24 }}>
        <div style={{ background:'var(--green)', borderRadius:'var(--radius-lg)', padding:'16px 18px', color:'white' }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600 }}>{total}</div>
          <div style={{ fontSize:12, opacity:0.8, marginTop:2 }}>Total students</div>
        </div>
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'16px 18px', border:'1px solid var(--gray-100)' }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, color:'var(--green-dark)' }}>{active}</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>Active</div>
        </div>
        {Object.entries(byClass).filter(([,v]) => v > 0).slice(0,4).map(([cls, count]) => (
          <div key={cls} style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', padding:'16px 18px', border:'1px solid var(--gray-100)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:600, color:'var(--text)' }}>{count}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{cls}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:200 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or roll number…" style={{ ...inputStyle, paddingLeft:34 }} />
        </div>
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ padding:'10px 12px', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontFamily:'var(--font-body)', color:'var(--text)', background:'var(--white)' }}>
          <option value="All">All classes</option>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
        <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, color:'var(--text-muted)', padding:'9px 12px', background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)' }}>
          <input type="checkbox" checked={showWithdrawn} onChange={e => setShowWithdrawn(e.target.checked)} />
          Show withdrawn
        </label>
        <button
          onClick={() => navigate('/students-audit')}
          style={{ padding:'9px 14px', background:'var(--white)', color:'var(--green-dark)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}
        >
          View audit log
        </button>
        {filterClass !== 'All' && (
          <button
            onClick={() => handleBulkDelete(filterClass)}
            style={{ padding:'9px 14px', background:'var(--crimson-light)', color:'var(--crimson)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:6 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete all in {filterClass}
          </button>
        )}
        <div style={{ fontSize:13, color:'var(--text-muted)' }}>{filtered.length} students</div>
      </div>

      {/* Student table */}
      {loading ? (
        <div style={{ textAlign:'center', padding:48 }}><div style={{ width:32, height:32, border:'2px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:56, background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)' }}>
          <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--green-light)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
          <p style={{ fontFamily:'var(--font-display)', fontSize:16, color:'var(--text)', marginBottom:6 }}>No students yet</p>
          <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:20 }}>Add students one by one or import a CSV file for bulk upload.</p>
          <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
            <button onClick={downloadTemplate} style={{ padding:'9px 18px', background:'var(--green-light)', color:'var(--green)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer' }}>Download CSV template</button>
            <button onClick={openAdd} style={{ padding:'9px 18px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:13, fontWeight:500, cursor:'pointer' }}>Add manually</button>
          </div>
        </div>
      ) : (
        <div style={{ background:'var(--white)', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-100)', overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)' }}>
                  {['Roll No.','Name','Class','Optional Subject','Parent Phone','Status',''].map(h => (
                    <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)} style={{ borderBottom:'1px solid var(--gray-50)', background: i%2===0 ? 'var(--white)' : 'var(--gray-50)', opacity: s.isActive === false ? 0.6 : 1, cursor:'pointer' }}>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)', fontWeight:500 }}>{s.rollNumber}</td>
                    <td style={{ padding:'11px 16px', fontWeight:500, color:'var(--text)' }}>{s.fullName}</td>
                    <td style={{ padding:'11px 16px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--green-light)', color:'var(--green)', fontWeight:500 }}>{s.className}</span>
                    </td>
                    <td style={{ padding:'11px 16px' }}>
                      {s.optionalSubject ? <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background:'var(--gold-light)', color:'var(--gold-dark)', fontWeight:500 }}>{s.optionalSubject}</span> : <span style={{ color:'var(--gray-400)', fontSize:12 }}>—</span>}
                    </td>
                    <td style={{ padding:'11px 16px', color:'var(--text-muted)' }}>{s.parentPhone || '—'}</td>
                    <td style={{ padding:'11px 16px' }}>
                      <span style={{ fontSize:11, padding:'2px 8px', borderRadius:8, background: s.isActive !== false ? 'var(--green-light)' : 'var(--gray-100)', color: s.isActive !== false ? 'var(--green)' : 'var(--gray-400)', fontWeight:500 }}>
                        {s.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding:'11px 16px' }}>
                      <button onClick={(e) => { e.stopPropagation(); openEdit(s) }} style={{ fontSize:12, color:'var(--green)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Edit</button>
                      {s.isActive !== false ? (
                        <button onClick={(e) => { e.stopPropagation(); handleWithdraw(s) }} style={{ fontSize:12, color:'var(--gold-dark)', background:'none', border:'none', cursor:'pointer', marginLeft:8 }}>Withdraw</button>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); handleReactivate(s) }} style={{ fontSize:12, color:'var(--green-dark)', background:'none', border:'none', cursor:'pointer', marginLeft:8 }}>Reactivate</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(s) }} style={{ fontSize:12, color:'var(--crimson)', background:'none', border:'none', cursor:'pointer', marginLeft:8 }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAdd && (
        <Modal title={editing ? 'Edit Student' : 'Add Student'} onClose={() => setShowAdd(false)}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {showBranchPicker && !editing && (
              <div style={{ gridColumn:'1/-1', padding:'10px 12px', background:'var(--green-light)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-sm)' }}>
                <label style={{ fontSize:12, fontWeight:500, color:'var(--green-mid)', display:'block', marginBottom:6 }}>Branch <span style={{ color:'var(--crimson)' }}>*</span></label>
                <div style={{ display:'flex', gap:14 }}>
                  {allowedBranches.map(b => (
                    <label key={b} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13 }}>
                      <input type="radio" name="studentBranch" checked={formBranch === b} onChange={() => { setFormBranch(b); setForm(p => ({ ...p, className: '' })) }} />
                      <span>{branchLabel(b)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div style={{ gridColumn:'1/-1' }}>
              <Field label="Full name" required>
                <input value={form.fullName} onChange={e => setForm(p=>({...p,fullName:e.target.value}))} placeholder="e.g. Aarav Singh" style={inputStyle} />
              </Field>
            </div>
            <Field label="Roll number" required hint={form.className && !editing ? `Suggested: next available in ${form.className}` : null}>
              <input type="number" min="1" value={form.rollNumber} onChange={e => setForm(p=>({...p,rollNumber:e.target.value}))} placeholder="e.g. 1" style={inputStyle} />
            </Field>
            <Field label="Admission no." hint="From sheshmani / school register. Leave blank if unknown.">
              <input value={form.admissionNo} onChange={e => setForm(p=>({...p,admissionNo:e.target.value}))} placeholder="e.g. RKA/2024/001" style={inputStyle} />
            </Field>
            <Field label="Class" required>
              <select value={form.className} onChange={e => {
                const newClass = e.target.value
                setForm(p => ({
                  ...p,
                  className: newClass,
                  optionalSubject: '',
                  // Auto-suggest a fresh roll number when adding (not editing) and class changes
                  rollNumber: !editing ? nextAvailableRoll(newClass) : p.rollNumber,
                }))
              }} style={inputStyle}>
                {!form.className && <option value="" disabled>— Select class —</option>}
                {(() => {
                  // Restrict class list to the form's branch (resolved by picker for super
                  // admin on All Branches; equals currentBranch for branch admins).
                  const visible = formBranch
                    ? [...new Set(classDocs.filter(c => c.branchCode === formBranch).map(c => c.className))]
                    : CLASSES
                  return visible.map(c => <option key={c} value={c}>{c}</option>)
                })()}
              </select>
            </Field>
            {needsOptional(form.className) && (
              <div style={{ gridColumn:'1/-1' }}>
                <Field label="Optional subject" required hint="Every Class 11 & 12 student must choose one optional subject">
                  <div style={{ display:'flex', gap:8 }}>
                    {optionalSubjectsFor(form.className).map(s => (
                      <button key={s} type="button" onClick={() => setForm(p=>({...p,optionalSubject:s}))} style={{ flex:1, padding:'9px', border:'1px solid', borderColor: form.optionalSubject===s ? 'var(--green)' : 'var(--gray-200)', background: form.optionalSubject===s ? 'var(--green-light)' : 'var(--white)', color: form.optionalSubject===s ? 'var(--green)' : 'var(--text-muted)', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}
            {needsSciencePath(form.className) && (
              <div style={{ gridColumn:'1/-1' }}>
                <Field label="Science path" required hint="PCM (Maths) or PCB (Biology)">
                  <div style={{ display:'flex', gap:8 }}>
                    {SCIENCE_PATHS.map(s => (
                      <button key={s} type="button" onClick={() => setForm(p=>({...p,sciencePath:s}))} style={{ flex:1, padding:'9px', border:'1px solid', borderColor: form.sciencePath===s ? 'var(--green)' : 'var(--gray-200)', background: form.sciencePath===s ? 'var(--green-light)' : 'var(--white)', color: form.sciencePath===s ? 'var(--green)' : 'var(--text-muted)', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:'pointer', transition:'all 0.15s' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}
            <Field label="Father's name">
              <input value={form.fatherName} onChange={e => setForm(p=>({...p,fatherName:e.target.value}))} placeholder="Father's full name" style={inputStyle} />
            </Field>
            <Field label="Mother's name">
              <input value={form.motherName} onChange={e => setForm(p=>({...p,motherName:e.target.value}))} placeholder="Mother's full name" style={inputStyle} />
            </Field>
            <Field label="Parent phone" hint="10-digit Indian mobile (e.g. 9876543210). +91 prefix accepted.">
              <input value={form.parentPhone} onChange={e => setForm(p=>({...p,parentPhone:e.target.value}))} placeholder="e.g. 9800000001 or +91 98000 00001" style={inputStyle} />
            </Field>
            <Field label="Parent email">
              <input value={form.parentEmail} onChange={e => setForm(p=>({...p,parentEmail:e.target.value}))} placeholder="optional" style={inputStyle} />
            </Field>
            <Field label="Date of admission">
              <input type="date" value={form.dateOfAdmission} onChange={e => setForm(p=>({...p,dateOfAdmission:e.target.value}))} style={inputStyle} />
            </Field>
            <Field label="Date of birth" hint="Optional">
              <input type="date" value={form.dateOfBirth} onChange={e => setForm(p=>({...p,dateOfBirth:e.target.value}))} style={inputStyle} />
            </Field>
            <Field label="Status">
              <div style={{ display:'flex', gap:8 }}>
                {['Active','Inactive'].map(s => (
                  <button key={s} type="button" onClick={() => setForm(p=>({...p,isActive:s==='Active'}))} style={{ flex:1, padding:'9px', border:'1px solid', borderColor: (s==='Active')===form.isActive ? 'var(--green)' : 'var(--gray-200)', background: (s==='Active')===form.isActive ? 'var(--green-light)' : 'var(--white)', color: (s==='Active')===form.isActive ? 'var(--green)' : 'var(--text-muted)', borderRadius:'var(--radius-sm)', fontSize:13, fontWeight:500, cursor:'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          {error && <p style={{ fontSize:13, color:'var(--crimson)', background:'var(--crimson-light)', padding:'8px 12px', borderRadius:'var(--radius-sm)', marginTop:12 }}>{error}</p>}
          <div style={{ display:'flex', gap:10, marginTop:16 }}>
            <button onClick={handleSave} disabled={saving} style={{ flex:1, padding:'12px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : editing ? 'Update Student' : 'Add Student'}
            </button>
            <button onClick={() => setShowAdd(false)} style={{ padding:'12px 20px', background:'var(--gray-50)', color:'var(--text-muted)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontSize:14, cursor:'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* CSV Import Modal */}
      {showCSV && (
        <Modal title="Import Students via CSV" onClose={() => { setShowCSV(false); setCsvRows([]); setCsvInvalidRows([]); setImportResult(null) }}>
          <div style={{ background:'var(--green-light)', borderRadius:'var(--radius-md)', padding:'14px 16px', marginBottom:20, fontSize:13, color:'var(--green-dark)', lineHeight:1.6 }}>
            <strong>How it works:</strong> Download the CSV template, fill it in with your student data in Excel or Google Sheets, then upload it here. All students will be imported at once into the selected branch.
          </div>
          {showBranchPicker && (
            <div style={{ padding:'10px 12px', background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', marginBottom:16 }}>
              <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)', display:'block', marginBottom:6 }}>Import into branch <span style={{ color:'var(--crimson)' }}>*</span></label>
              <div style={{ display:'flex', gap:14 }}>
                {allowedBranches.map(b => (
                  <label key={b} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13 }}>
                    <input type="radio" name="csvBranch" checked={formBranch === b} onChange={() => setFormBranch(b)} />
                    <span>{branchLabel(b)}</span>
                  </label>
                ))}
              </div>
              <p style={{ fontSize:11, color:'var(--gray-400)', marginTop:6 }}>All students in this CSV will be assigned to this branch.</p>
            </div>
          )}
          <button onClick={downloadTemplate} style={{ width:'100%', padding:'12px', background:'var(--white)', color:'var(--green)', border:'1px solid var(--green-muted)', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:16 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download CSV Template
          </button>
          <div onClick={() => fileRef.current?.click()} style={{ border:'2px dashed var(--green-muted)', borderRadius:'var(--radius-md)', padding:'32px', textAlign:'center', cursor:'pointer', background:'var(--green-light)', marginBottom:16 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.5" style={{ margin:'0 auto 10px', display:'block' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p style={{ fontSize:14, color:'var(--green-dark)', fontWeight:500, marginBottom:4 }}>Click to upload your filled CSV</p>
            <p style={{ fontSize:12, color:'var(--green-mid)' }}>.csv files only</p>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} style={{ display:'none' }} />
          </div>
          {csvRows.length > 0 && (
            <div style={{ background:'var(--gray-50)', borderRadius:'var(--radius-sm)', padding:'12px 14px', fontSize:13, color:'var(--text)', marginBottom:16 }}>
              <strong>{csvRows.length} students</strong> found in CSV and ready to import.
              <div style={{ marginTop:6, color:'var(--text-muted)', fontSize:12 }}>
                Classes: {[...new Set(csvRows.map(r => r.className))].join(', ')}
              </div>
            </div>
          )}
          {csvInvalidRows.length > 0 && (
            <div style={{ background:'var(--crimson-light)', border:'1px solid rgba(139,26,26,0.2)', borderRadius:'var(--radius-sm)', padding:'12px 14px', fontSize:12, color:'var(--crimson)', marginBottom:16 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>{csvInvalidRows.length} row{csvInvalidRows.length!==1?'s':''} skipped</div>
              <div style={{ maxHeight:140, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
                {csvInvalidRows.slice(0, 30).map((r, i) => (
                  <div key={i} style={{ display:'flex', gap:8, fontSize:11 }}>
                    <span style={{ color:'var(--text-muted)', minWidth:50 }}>Row {r._rowNum}</span>
                    <span style={{ flex:1 }}><strong>{r.fullName || '(no name)'}</strong> — {r._reason}</span>
                  </div>
                ))}
                {csvInvalidRows.length > 30 && <div style={{ fontSize:11, fontStyle:'italic', marginTop:3 }}>+{csvInvalidRows.length - 30} more skipped rows</div>}
              </div>
            </div>
          )}
          {importResult && (
            <div style={{ background: importResult.failed > 0 ? 'var(--gold-light)' : 'var(--green-light)', border:`1px solid ${importResult.failed > 0 ? 'rgba(201,162,39,0.3)' : 'var(--green-muted)'}`, borderRadius:'var(--radius-sm)', padding:'12px 14px', fontSize:13, color: importResult.failed > 0 ? 'var(--gold-dark)' : 'var(--green-dark)', marginBottom:16 }}>
              ✓ {importResult.success} students imported successfully.
              {importResult.failed > 0 && ` ${importResult.failed} failed.`}
            </div>
          )}
          {csvRows.length > 0 && !importResult && (
            <button onClick={importCSV} disabled={csvImporting} style={{ width:'100%', padding:'12px', background:'var(--green)', color:'white', border:'none', borderRadius:'var(--radius-md)', fontSize:14, fontWeight:500, cursor: csvImporting ? 'not-allowed' : 'pointer', opacity: csvImporting ? 0.7 : 1 }}>
              {csvImporting ? `Importing ${csvRows.length} students…` : `Import ${csvRows.length} Students`}
            </button>
          )}
        </Modal>
      )}
    </div>
  )
}
