// Single source of truth: derive a teacher's classes from the timetable collection
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'

export async function getTeacherClasses(teacher, user) {
  try {
    const teacherId = teacher?.id || ''
    const teacherName = (teacher?.fullName || '').toLowerCase().trim()
    const emailLower = (teacher?.email || teacher?.personalEmail || user?.email || '').toLowerCase().trim()

    const ttSnap = await getDocs(collection(db, 'timetable'))
    const allSlots = ttSnap.docs.map(d => ({ id:d.id, ...d.data() }))

    let mySlots = allSlots.filter(s =>
      (teacherId && s.teacherId === teacherId) ||
      (teacherName && s.teacherName?.toLowerCase().trim() === teacherName)
    )

    if (mySlots.length === 0 && emailLower) {
      const teachersSnap = await getDocs(collection(db, 'teachers'))
      const matched = teachersSnap.docs.find(d => {
        const data = d.data()
        return (data.email||'').toLowerCase().trim() === emailLower ||
               (data.personalEmail||'').toLowerCase().trim() === emailLower
      })
      if (matched) {
        const rId = matched.id
        const rName = (matched.data().fullName || '').toLowerCase().trim()
        mySlots = allSlots.filter(s =>
          s.teacherId === rId ||
          s.teacherName?.toLowerCase().trim() === rName
        )
      }
    }

    const classNames = new Set()
    mySlots.forEach(slot => {
      if (Array.isArray(slot.classNames) && slot.classNames.length) {
        slot.classNames.forEach(c => c && classNames.add(c.trim()))
      } else if (slot.className) {
        slot.className.split('+').map(s => s.trim()).filter(Boolean).forEach(c => classNames.add(c))
      }
    })
    return [...classNames].sort()
  } catch(e) {
    console.error('getTeacherClasses error:', e)
    return []
  }
}
