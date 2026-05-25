// =========================================================================
// MyStudents.jsx
//
// Class-teacher-only student management for the teacher PWA.
//
// Behavior:
//   - Only available if the signed-in teacher has classTeacherOf set
//   - Roster is scoped to (teacher.classTeacherOf, teacher.branchCodes[0])
//   - Add / Edit / Withdraw available to the class teacher
//   - Soft delete only (Withdraw). No hard delete, no reactivate, no transfer.
//   - Bulk CSV upload supported; rows are forced to the teacher's class+branch
//   - All actions write to studentAudit with performedByRole = 'class_teacher'
//
// Permissions are enforced by Firestore rules using the classTeacherByEmail
// lookup collection. This UI is a thin client; rules are the real boundary.
// =========================================================================

import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  collection, getDocs, addDoc, updateDoc, doc, query, where, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../App'
import { normalizePhone } from '../lib/phone'
import { writeStudentAudit, diffStudent } from '../lib/studentAudit'
import { optionalSubjectsFor } from '../lib/classes'

const SCIENCE_PATHS = ['PCM', 'PCB']

const AUDIT_FIELDS = [
  'fullName', 'rollNumber', 'fatherName', 'motherName',
  'parentPhone', 'parentEmail', 'dateOfAdmission', 'dateOfBirth',
  'optionalSubject', 'sciencePath',
]

function needsOptional(cls) {
  return /^Class (11|12)\b/.test(cls || '')
}
function needsSciencePath(cls) {
  return /^Class (11|12) Science$/.test(cls || '')
}

const emptyForm = {
  fullName: '', rollNumber: '', fatherName: '', motherName: '',
  parentPhone: '', parentEmail: '', dateOfAdmission: '', dateOfBirth: '',
  optionalSubject: '', sciencePath: '',
}

export default function MyStudents() {
  const { user, teacher } = useAuth()
  const navigate = useNavigate()

  const classTeacherOf = teacher?.classTeacherOf || null
  const branchCode = Array.isArray(teacher?.branchCodes) && teacher.branchCodes.length > 0
    ? teacher.branchCodes[0]
    : null

  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  // CSV state
  const [csvRows, setCsvRows] = useState([])
  const [csvInvalidRows, setCsvInvalidRows] = useState([])
  const [showCsvPreview, setShowCsvPreview] = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResult, setCsvResult] = useState(null)
  const fileInputRef = useRef(null)

  // Audit attribution
  function auditActor() {
    return {
      performedBy: teacher?.id || user?.uid || 'unknown',
      performedByName: teacher?.fullName || user?.email || 'unknown',
      performedByRole: 'class_teacher',
    }
  }

  async function load() {
    if (!classTeacherOf || !branchCode) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const q = query(
        collection(db, 'students'),
        where('className', '==', classTeacherOf),
        where('branchCode', '==', branchCode),
      )
      const snap = await getDocs(q)
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => Number(a.rollNumber || 0) - Number(b.rollNumber || 0))
      setStudents(list)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [classTeacherOf, branchCode])

  function nextRoll() {
    const taken = students.filter(s => s.isActive !== false).map(s => Number(s.rollNumber)).filter(n => Number.isFinite(n))
    return taken.length === 0 ? '1' : String(Math.max(...taken) + 1)
  }

  function isRollDuplicate(roll, ignoreId) {
    const r = Number(roll)
    return students.some(s => Number(s.rollNumber) === r && s.id !== ignoreId && s.isActive !== false)
  }

  function openAdd() {
    setEditing(null)
    setForm({ ...emptyForm, rollNumber: nextRoll() })
    setError('')
    setShowForm(true)
  }
  function openEdit(s) {
    setEditing(s)
    setForm({
      fullName: s.fullName || '', rollNumber: s.rollNumber || '',
      fatherName: s.fatherName || '', motherName: s.motherName || '',
      parentPhone: s.parentPhone || '', parentEmail: s.parentEmail || '',
      dateOfAdmission: s.dateOfAdmission || '', dateOfBirth: s.dateOfBirth || '',
      optionalSubject: s.optionalSubject || '', sciencePath: s.sciencePath || '',
    })
    setError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.fullName.trim()) { setError('Full name is required.'); return }
    const rollNum = Number(form.rollNumber)
    if (!Number.isFinite(rollNum) || rollNum < 1) { setError('Roll number must be 1 or higher.'); return }
    if (isRollDuplicate(form.rollNumber, editing?.id)) {
      const taker = students.find(s => Number(s.rollNumber) === rollNum && s.id !== editing?.id)
      setError(`Roll ${rollNum} is already used by ${taker?.fullName || 'another student'}.`)
      return
    }
    if (!form.fatherName.trim()) { setError("Father's name is required."); return }
    if (!form.motherName.trim()) { setError("Mother's name is required."); return }

    // Phone validation
    let normalizedPhone = ''
    if (form.parentPhone.trim()) {
      const n = normalizePhone(form.parentPhone)
      if (!n) { setError('Parent phone is invalid. Must be a 10-digit Indian mobile.'); return }
      normalizedPhone = n
    } else {
      setError('Parent phone is required.')
      return
    }

    if (needsOptional(classTeacherOf) && !form.optionalSubject) {
      setError('Optional subject is required for Class 11/12.')
      return
    }
    if (needsSciencePath(classTeacherOf) && !form.sciencePath) {
      setError('Science path (PCM or PCB) is required for Class 11/12 Science.')
      return
    }

    setSaving(true); setError('')
    const data = {
      fullName: form.fullName.trim(),
      rollNumber: String(rollNum),
      className: classTeacherOf,   // forced
      branchCode: branchCode,      // forced
      fatherName: form.fatherName.trim(),
      motherName: form.motherName.trim(),
      parentPhone: normalizedPhone,
      parentEmail: form.parentEmail.trim(),
      dateOfAdmission: form.dateOfAdmission,
      dateOfBirth: form.dateOfBirth,
      optionalSubject: needsOptional(classTeacherOf) ? form.optionalSubject : '',
      sciencePath: needsSciencePath(classTeacherOf) ? form.sciencePath : '',
      isActive: true,
    }

    try {
      if (editing) {
        await updateDoc(doc(db, 'students', editing.id), { ...data, updatedAt: Timestamp.now() })
        const { changedFields, hasChanges } = diffStudent(editing, data, AUDIT_FIELDS)
        if (hasChanges) {
          await writeStudentAudit({
            student: { id: editing.id, fullName: data.fullName, className: classTeacherOf, branchCode },
            action: 'edit',
            changedFields,
            ...auditActor(),
          })
        }
      } else {
        const newDoc = await addDoc(collection(db, 'students'), {
          ...data,
          createdAt: Timestamp.now(),
        })
        await writeStudentAudit({
          student: { id: newDoc.id, fullName: data.fullName, className: classTeacherOf, branchCode },
          action: 'add',
          ...auditActor(),
        })
      }
      await load()
      setShowForm(false)
    } catch (e) {
      setError('Failed to save: ' + (e.message || String(e)))
    }
    setSaving(false)
  }

  async function handleWithdraw(student) {
    if (!confirm(`Withdraw ${student.fullName} from ${classTeacherOf}?\n\nTheir record will be kept but hidden from active rosters.`)) return
    try {
      await updateDoc(doc(db, 'students', student.id), {
        isActive: false,
        withdrawnAt: Timestamp.now(),
        withdrawnBy: user?.email || teacher?.id || 'unknown',
      })
      await writeStudentAudit({
        student,
        action: 'withdraw',
        ...auditActor(),
      })
      await load()
    } catch (e) {
      alert('Failed to withdraw: ' + (e.message || String(e)))
    }
  }

  // CSV
  function downloadTemplate() {
    const headers = 'fullName,rollNumber,fatherName,motherName,parentPhone,parentEmail,dateOfAdmission,dateOfBirth,optionalSubject,sciencePath'
    const sample1 = 'Aarav Singh,1,Rajesh Singh,Priya Singh,9800000001,,2024-04-01,2010-08-15,,'
    const sample2 = 'Priya Yadav,2,Suresh Yadav,Meena Yadav,9800000002,parent@example.com,2024-04-01,2010-11-22,,'
    const csv = [headers, sample1, sample2].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${classTeacherOf.replace(/\s+/g, '_')}_template.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  function handleCsvFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      const lines = text.trim().split('\n')
      const headers = lines[0].split(',').map(h => h.trim())
      const allRows = lines.slice(1).map((line, idx) => {
        const vals = line.split(',').map(v => v.trim())
        const obj = { _rowNum: idx + 2 }
        headers.forEach((h, i) => { obj[h] = vals[i] || '' })
        return obj
      })

      const existing = new Set(students.filter(s => s.isActive !== false).map(s => Number(s.rollNumber)))
      const seenInCsv = new Set()
      const valid = []
      const invalid = []
      for (const r of allRows) {
        if (!r.fullName) { invalid.push({ ...r, _reason: 'Missing fullName' }); continue }
        const rn = Number(r.rollNumber)
        if (!Number.isFinite(rn) || rn < 1) { invalid.push({ ...r, _reason: `Invalid rollNumber "${r.rollNumber}"` }); continue }
        if (!r.fatherName) { invalid.push({ ...r, _reason: "Missing fatherName" }); continue }
        if (!r.motherName) { invalid.push({ ...r, _reason: "Missing motherName" }); continue }
        if (!r.parentPhone) { invalid.push({ ...r, _reason: 'Missing parentPhone' }); continue }
        const normPhone = normalizePhone(r.parentPhone)
        if (!normPhone) { invalid.push({ ...r, _reason: `Invalid parentPhone "${r.parentPhone}"` }); continue }
        if (needsOptional(classTeacherOf) && !r.optionalSubject) {
          invalid.push({ ...r, _reason: 'Class 11/12 needs optionalSubject' }); continue
        }
        if (needsSciencePath(classTeacherOf) && !r.sciencePath) {
          invalid.push({ ...r, _reason: 'Class 11/12 Science needs sciencePath' }); continue
        }
        if (r.sciencePath && !SCIENCE_PATHS.includes(r.sciencePath)) {
          invalid.push({ ...r, _reason: `Invalid sciencePath "${r.sciencePath}"` }); continue
        }
        if (seenInCsv.has(rn)) { invalid.push({ ...r, _reason: `Duplicate roll ${rn} in CSV` }); continue }
        if (existing.has(rn)) { invalid.push({ ...r, _reason: `Roll ${rn} already exists in class` }); continue }
        seenInCsv.add(rn)
        valid.push({ ...r, rollNumber: String(rn), parentPhone: normPhone })
      }
      setCsvRows(valid); setCsvInvalidRows(invalid)
      setShowCsvPreview(true); setCsvResult(null)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function importCsv() {
    setCsvImporting(true)
    let success = 0, failed = 0
    for (const row of csvRows) {
      try {
        const data = {
          fullName: row.fullName, rollNumber: row.rollNumber,
          className: classTeacherOf, branchCode,
          fatherName: row.fatherName, motherName: row.motherName,
          parentPhone: row.parentPhone, parentEmail: row.parentEmail || '',
          dateOfAdmission: row.dateOfAdmission || '',
          dateOfBirth: row.dateOfBirth || '',
          optionalSubject: needsOptional(classTeacherOf) ? (row.optionalSubject || '') : '',
          sciencePath: needsSciencePath(classTeacherOf) ? (row.sciencePath || '') : '',
          isActive: true,
          createdAt: Timestamp.now(),
        }
        const newDoc = await addDoc(collection(db, 'students'), data)
        await writeStudentAudit({
          student: { id: newDoc.id, fullName: data.fullName, className: classTeacherOf, branchCode },
          action: 'csv_import',
          notes: `CSV row ${row._rowNum}`,
          ...auditActor(),
        })
        success++
      } catch (e) { failed++ }
    }
    setCsvResult({ success, failed })
    setCsvImporting(false)
    await load()
  }

  // --- RENDER ---

  if (!teacher) {
    return <div style={loadingStyle}>Loading your profile…</div>
  }

  if (!classTeacherOf) {
    return (
      <div style={containerStyle}>
        <Link to="/" style={backLinkStyle}>&larr; Back to home</Link>
        <h1 style={titleStyle}>My Class Students</h1>
        <div style={{
          background: 'var(--white, #fff)', border: '1px solid #e8e6dc',
          borderRadius: 8, padding: 24, marginTop: 16, textAlign: 'center',
        }}>
          <p style={{ fontSize: 14, color: '#6b6b6b', marginBottom: 8 }}>
            You are not assigned as a class teacher.
          </p>
          <p style={{ fontSize: 13, color: '#999' }}>
            Ask the admin to assign you a class through the admin portal.
          </p>
        </div>
      </div>
    )
  }

  // Teacher PWA never shows withdrawn students — admin-only.
  const visible = students.filter(s => s.isActive !== false)
  const activeCount = visible.length

  return (
    <div style={containerStyle}>
      <Link to="/" style={backLinkStyle}>&larr; Back to home</Link>
      <h1 style={titleStyle}>{classTeacherOf} <span style={{ fontSize: 14, color: '#6b6b6b', fontWeight: 400 }}>({branchCode})</span></h1>
      <p style={{ fontSize: 13, color: '#6b6b6b', margin: '0 0 16px' }}>
        {activeCount} student{activeCount !== 1 ? 's' : ''}
      </p>

      <div style={toolbarStyle}>
        <button onClick={openAdd} style={primaryBtn}>+ Add student</button>
        <button onClick={() => fileInputRef.current?.click()} style={secondaryBtn}>Bulk upload</button>
        <button onClick={downloadTemplate} style={secondaryBtn}>Template</button>
      </div>

      <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsvFile} />

      {loading && <div style={loadingStyle}>Loading roster…</div>}
      {error && !showForm && <div style={errorStyle}>{error}</div>}
      {!loading && visible.length === 0 && (
        <div style={emptyStyle}>
          No students in {classTeacherOf} yet. Tap "Add student" or "Bulk upload" to get started.
        </div>
      )}
      {!loading && visible.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(s => (
            <li key={s.id} style={{
              background: '#fff', border: '1px solid #e8e6dc', borderRadius: 8,
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                minWidth: 36, height: 36, borderRadius: '50%', background: '#1a4a2e',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 600, fontSize: 13,
              }}>{s.rollNumber}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.fullName}
                </div>
                <div style={{ fontSize: 12, color: '#6b6b6b', marginTop: 2 }}>
                  {s.fatherName && <>S/o {s.fatherName} · </>}{s.parentPhone || 'no phone'}
                </div>
              </div>
              <button onClick={() => openEdit(s)} style={miniBtnSecondary}>Edit</button>
              <button onClick={() => handleWithdraw(s)} style={miniBtnDanger}>Withdraw</button>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <FormModal
          form={form}
          setForm={setForm}
          classTeacherOf={classTeacherOf}
          editing={editing}
          saving={saving}
          error={error}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setError('') }}
        />
      )}

      {showCsvPreview && (
        <CsvPreviewModal
          valid={csvRows}
          invalid={csvInvalidRows}
          result={csvResult}
          importing={csvImporting}
          onImport={importCsv}
          onClose={() => { setShowCsvPreview(false); setCsvRows([]); setCsvInvalidRows([]); setCsvResult(null) }}
        />
      )}
    </div>
  )
}


function FormModal({ form, setForm, classTeacherOf, editing, saving, error, onSave, onClose }) {
  return (
    <div style={modalBackdrop}>
      <div style={modalCard}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a4a2e', margin: 0 }}>
            {editing ? 'Edit student' : 'Add student to ' + classTeacherOf}
          </h2>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>
        <div style={{ padding: 20 }}>
          <Field label="Full name" required>
            <input value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Roll number" required>
            <input type="number" min="1" value={form.rollNumber} onChange={e => setForm(p => ({ ...p, rollNumber: e.target.value }))} style={inputStyle} />
          </Field>
          {needsOptional(classTeacherOf) && (
            <Field label="Optional subject" required>
              <div style={{ display: 'flex', gap: 6 }}>
                {optionalSubjectsFor(classTeacherOf).map(s => (
                  <button key={s} type="button" onClick={() => setForm(p => ({ ...p, optionalSubject: s }))}
                    style={pillBtn(form.optionalSubject === s)}>{s}</button>
                ))}
              </div>
            </Field>
          )}
          {needsSciencePath(classTeacherOf) && (
            <Field label="Science path" required>
              <div style={{ display: 'flex', gap: 6 }}>
                {SCIENCE_PATHS.map(s => (
                  <button key={s} type="button" onClick={() => setForm(p => ({ ...p, sciencePath: s }))}
                    style={pillBtn(form.sciencePath === s)}>{s}</button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Father's name" required>
            <input value={form.fatherName} onChange={e => setForm(p => ({ ...p, fatherName: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Mother's name" required>
            <input value={form.motherName} onChange={e => setForm(p => ({ ...p, motherName: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Parent phone" required hint="10-digit mobile, or +91 prefixed">
            <input value={form.parentPhone} onChange={e => setForm(p => ({ ...p, parentPhone: e.target.value }))} placeholder="9876543210" style={inputStyle} />
          </Field>
          <Field label="Parent email">
            <input value={form.parentEmail} onChange={e => setForm(p => ({ ...p, parentEmail: e.target.value }))} placeholder="optional" style={inputStyle} />
          </Field>
          <Field label="Date of admission">
            <input type="date" value={form.dateOfAdmission} onChange={e => setForm(p => ({ ...p, dateOfAdmission: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Date of birth">
            <input type="date" value={form.dateOfBirth} onChange={e => setForm(p => ({ ...p, dateOfBirth: e.target.value }))} style={inputStyle} />
          </Field>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={onSave} disabled={saving} style={{ ...primaryBtn, flex: 1, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add student'}
            </button>
            <button onClick={onClose} style={secondaryBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CsvPreviewModal({ valid, invalid, result, importing, onImport, onClose }) {
  return (
    <div style={modalBackdrop}>
      <div style={{ ...modalCard, maxWidth: 600 }}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a4a2e', margin: 0 }}>CSV Preview</h2>
          <button onClick={onClose} style={closeBtn}>×</button>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 14 }}>
            <strong style={{ color: '#1a4a2e' }}>{valid.length}</strong> valid rows ready to import.
            {invalid.length > 0 && <> <strong style={{ color: '#8b1a1a' }}>{invalid.length}</strong> rows have issues and will be skipped.</>}
          </p>

          {invalid.length > 0 && (
            <div style={{ background: '#fdecec', border: '1px solid #f5c7c7', borderRadius: 6, padding: 10, marginTop: 12, maxHeight: 180, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#8b1a1a', marginBottom: 6 }}>Issues:</div>
              {invalid.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: '#8b1a1a', marginBottom: 2 }}>
                  Row {r._rowNum}: {r._reason}
                </div>
              ))}
            </div>
          )}

          {result && (
            <div style={{ background: '#e6f3ed', border: '1px solid #1a4a2e', borderRadius: 6, padding: 12, marginTop: 12, fontSize: 13 }}>
              Imported: <strong>{result.success}</strong> students.
              {result.failed > 0 && <> Failed: <strong>{result.failed}</strong>.</>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            {!result && (
              <button onClick={onImport} disabled={importing || valid.length === 0} style={{ ...primaryBtn, flex: 1, opacity: (importing || valid.length === 0) ? 0.6 : 1 }}>
                {importing ? 'Importing…' : `Import ${valid.length} students`}
              </button>
            )}
            <button onClick={onClose} style={secondaryBtn}>{result ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#6b6b6b', display: 'block', marginBottom: 4 }}>
        {label} {required && <span style={{ color: '#8b1a1a' }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{hint}</p>}
    </div>
  )
}

// styles
const containerStyle = { maxWidth: 600, margin: '0 auto', padding: '16px 16px 80px' }
const backLinkStyle = { display: 'inline-block', fontSize: 13, color: '#1a4a2e', textDecoration: 'none', marginBottom: 12 }
const titleStyle = { fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 600, color: '#1a4a2e', margin: '0 0 4px' }
const toolbarStyle = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }
const primaryBtn = { background: '#1a4a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }
const secondaryBtn = { background: '#fff', color: '#1a4a2e', border: '1px solid #1a4a2e', borderRadius: 6, padding: '9px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }
const miniBtnSecondary = { background: 'transparent', color: '#1a4a2e', border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: '4px 8px' }
const miniBtnDanger = { background: 'transparent', color: '#8b1a1a', border: 'none', fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: '4px 8px' }
const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid #d9d6cb', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
const loadingStyle = { padding: '32px 16px', textAlign: 'center', color: '#6b6b6b', fontSize: 14 }
const errorStyle = { padding: 10, marginTop: 8, background: '#fdecec', border: '1px solid #f5c7c7', borderRadius: 6, color: '#8b1a1a', fontSize: 13 }
const emptyStyle = { padding: '40px 16px', textAlign: 'center', color: '#6b6b6b', fontSize: 14, background: '#fafaf7', border: '1px solid #e8e6dc', borderRadius: 8 }
const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }
const modalCard = { background: '#fff', borderRadius: 10, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }
const modalHeader = { padding: '16px 20px', borderBottom: '1px solid #f0eee5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff' }
const closeBtn = { background: 'none', border: 'none', cursor: 'pointer', color: '#6b6b6b', fontSize: 22, lineHeight: 1 }

function pillBtn(active) {
  return {
    flex: 1, padding: '9px', border: '1px solid', borderColor: active ? '#1a4a2e' : '#d9d6cb',
    background: active ? '#e6f3ed' : '#fff', color: active ? '#1a4a2e' : '#6b6b6b',
    borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
  }
}
