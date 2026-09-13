# Cleanup register — things left behind by the Examinations window (2026-09-12)

Everything below lost its last caller when the single-window exam pipeline
shipped (Tracker `cbf7a81`, teacher-pwa `57c960d`, parent `2b403e8`, SMS
`afc5d9c`). Nothing here is dangerous to leave; delete when convenient, in
the order given (data last). Tick items off as they go.

## 1. Deployed Cloud Functions (project `rka-academic-tracker`, codebase `tracker-sync`, region asia-south2)

Delete with `firebase functions:delete <name> --project rka-academic-tracker --region asia-south2`
after removing the export from `functions/index.js`.

| Function | Trigger | Why dead |
|---|---|---|
| `syncExamSubjects` | Firestore `examSubjects/{id}` | Tracker now writes `exam_subjects` directly (`admin/lib/examRoutes.js`). No UI writes Firestore `examSubjects` any more. |
| `syncExamTerms` | Firestore `examTerms/{id}` | Same — terms are seeded/edited straight into `exam_terms`. |
| `syncExamPapers` | Firestore `examPapers/{id}` | Dead since `firestore.rules` blocked writes to `examPapers` (2026-05); papers are typed + generated now. |
| `syncExamMarks` | Firestore `examMarks/{id}` | Dead since rules blocked `examMarks` writes; PWA writes `exam_marks` via its own API. |
| `syncExamCoschGrades` | Firestore `examCoschGrades/{id}` | Dead since rules blocked writes. |
| `syncHpcAssessments` | Firestore `hpcAssessments/{id}` | Dead since rules blocked writes; PWA writes `hpc_assessments` directly. |

Keep: `getHrmsDayAttendance`, `hrmsEmployeeSync`, `stampLessonPlanBranch`, `syncNonWorkingDays`, `syncStudentAttendance`.

Also drop from `functions/index.js` once the six are gone: `ensurePapersForSubject`, `isManualRow`, `getStudentIdByKeys` / `getStudentIdByFirestoreId` and their caches (only the exam triggers used them). Check nothing else imports them first.

## 2. Firestore data + rules (project `rka-academic-tracker`)

| Item | Why dead | Action |
|---|---|---|
| Collection `examSessions` (1 doc) | Sessions are `DISTINCT exam_terms.session_code` in Supabase. | Delete collection. |
| Collection `examTerms` (4 docs) | Mirrored once; Supabase is the store. | Delete collection. |
| Collection `examSubjects` (271 docs) | Mirrored once; Supabase is the store (teacher id/email/name live on `exam_subjects`). | Delete collection AFTER the functions above are gone (else a delete does nothing but a re-add would re-sync). |
| `firestore.rules` blocks for `examSessions`, `examTerms`, `examSubjects`, `examPapers`, `examMarks`, `examCoschGrades`, `hpcAssessments` | Collections gone. | Remove the `match` blocks; deploy rules. |

## 3. Tracker repo (`RKA_Academic_Tracker`)

| Path | Why dead | Action |
|---|---|---|
| `scripts/resync-exam-subjects/`, `scripts/resync-exam-terms/`, `scripts/backfill-exam-papers/` | Firestore→Supabase resync tooling for the retired mirror. | Delete directories. |
| `admin/src/lib/reportCardRemark.js` | Only the deleted `ReportCardPrint.jsx` imported it; the engine has its own `autoRemark`. | Delete file. |
| `admin/server.js` → `computeReportCard()` + `GET /api/exam/report-card` (~lines 403–520, 661–669) | Old three-copy card compute; the engine (`admin/lib/cardEngine.js`) replaced it. No client calls it. | Delete function + route + `CBSE_GRADES`/`gradeFor` if unused elsewhere. |
| `admin/server.js` → `POST /api/exam/papers` (create) | Papers are generated from rules; the create button was removed from Marks Entry. | Delete route. `PATCH` stays (date sheet / max edits). |
| `admin/src/lib/api.js` → `examApi.reportCard`, `examApi.createPaper` | No callers. | Delete the two lines. |
| `admin/src/pages/ReportCardTemplates.jsx` (Card Designer) | Off the menu since 2026-09-13; everything it edited now lives in Examinations → Setup (binding, rename) and Scoring rules (rows, schemes, card areas). Kept reachable at `/report-card-templates` for super-admins as a raw-JSON repair tool. | Delete once nobody has needed the JSON editor for a term; drop `reportTemplateApi.assign` callers there. The per-area `owner` field in template definitions is unread anywhere — drop it from the seed + definitions when convenient. |
| `admin/src/pages/MarksEntry.jsx` "Periodic" read-only paired column (`ptTerm`) | The card engine pairs terms now; the column is informational only. | Optional: remove to simplify. |
| `documentation.md` sections describing `examSubjects`/`examTerms` Firestore config and the CF mirror | Stale. | Rewrite to point at Examinations + `admin/lib/*`. |

## 4. Teacher PWA (`rka-teacher-pwa`)

Since 2026-09-13 report cards are **office-driven**: all exam marks and card entries are made in the Tracker (Examinations → Marks entry). The PWA keeps only monthly tests, HPC and My Marks.

| Path | Why dead | Action |
|---|---|---|
| `routes/marks.js`, `routes/papers.js`, `routes/cardentries.js`, `routes/grades.js` | Unmounted in `server.js` (old paths answer 410). | Delete the four files. |
| `client/src/pages/ExamMarksEntry.jsx`, `client/src/pages/ReportCardEntries.jsx` | Unrouted (`/exam-marks`, `/card-entries` redirect home). | Delete the two files; drop their `api.*` helpers in `client/src/lib/api.js` (`getPapers`, `savePaper`, `getMarks`, `saveMarks`, card-entries) if nothing else calls them. |
| `exam_subjects.assigned_teacher_email` as an ACCESS key | Nothing gates on it any more (`/api/my-subjects` still filters by it for the subject list). | Keep the column as "subject teacher" reference; no action. |

## 5. Parent app (`rka-parent-app`)

| Path | Why dead | Action |
|---|---|---|
| `routes/parent.js` `CBSE_GRADES` + `gradeFor` (lines ~73–79) | Card is a published snapshot; grades come pre-computed. | Delete if no other route uses them. |

## 6. SMS (`rka-sms-source`)

| Path | Why dead | Action |
|---|---|---|
| `src/lib/reportCards.js` → `getStudentReportCard`, `getReportCardsForStudents`, `generateRemark`, `TONE_PRESETS`, `overallGradeFor` | SMS prints published HTML only. Keep `listStudentsInClass`, `listPublishedCards`, `getPublishedCardHtml`. | Trim the file. |
| `src/lib/reportCardGrid.js` | Only the old builder used it. | Delete. |
| `src/lib/reportCardSettings.js` | Overlay retired; screen deleted. | Delete. |
| `src/components/ReportCardVisual.jsx` | Old renderer. (`Reconciliation.jsx` and `index.css` mention the name — check it is only a CSS class / comment before deleting.) | Delete. |

## 7. SMS database (Supabase `rka-sms`)

Write a migration for each; all are empty or unread.

| Object | Rows | Why dead |
|---|---|---|
| table `report_cards` (legacy, FKs to `sessions`/`report_terms`/`student_enrollments`) | 0 | Pre-dates everything; `published_report_cards` is the snapshot table. |
| table `report_terms` | 0 | Only referenced by the legacy `report_cards`. |
| table `report_card_settings` (mig 140) | 1 | SMS overlay; no reader after the settings screen was removed. |
| table `student_measurements` (mig 142) | 0 | Height/weight now in `report_card_student_meta`. |
| table `student_board_rolls` (mig 141) | 0 | Board reg. no. lives on `students.board_reg_no` (mig 152). |
| column `exam_terms.weight` | — | Never written, never read. |
| column `exam_terms.tracker_doc_id`, `exam_subjects.tracker_doc_id` | — | Mirror keys; harmless, drop with the functions. |
| enums `report_card_status`, `result_status` | — | Only used by legacy `report_cards`. |

Do NOT touch `sessions` (fees/rollover) or `student_enrollments` (transport FK).

## 8. Legacy free-text exam papers (data, not code)

`exam_papers` rows with `component_key IS NULL` are the pre-rules free-text
papers. Ones with marks are kept on purpose (raw crosslist history); empty
ones can be deleted from Examinations → Papers → Legacy papers, or in bulk:

```sql
delete from exam_papers p where p.component_key is null
  and not exists (select 1 from exam_marks m where m.paper_id = p.id);
```

## HPC (Holistic Progress Card) — office-driven since 2026-09-14

| What | Where | Why dead | Action |
|---|---|---|---|
| `routes/hpc.js` | teacher PWA | POST /api/hpc unmounted; server answers 410 | delete file |
| `client/src/pages/HpcEntry.jsx` | teacher PWA | route redirects home, menu card removed | delete file |
| Firestore `hpcTemplates` collection | Firebase | never written by anything (PWA fallback served its own default); PWA lookup deleted | nothing to delete (empty) |
| `syncHpcAssessments` CF | Firebase functions | already listed above; PWA no longer writes | undeploy |
| SMS `DOMAINS` / `RATINGS` / `HPC_CLASSES` in `src/lib/hpc.js` | SMS | only a fallback for sessions with no `hpc` template; every session now seeds one on first open of HPC Cards | remove once 2025-26 cards are no longer printed |
| Old `hpc_assessments` rows with `source='teacher_pwa'` | SMS DB | none exist for 2026-27 (0 rows) | nothing |
