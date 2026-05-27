# Wipe students + testMarks

One-off cleanup script to drop the legacy Firestore `students` and `testMarks`
collections, run **after** the Tracker has been pivoted to read students from
the SMS Supabase database.

## What it does

Deletes every document from:
- `students` — superseded by SMS Supabase `public.students`
- `testMarks` — old marks pipeline (the new `exam_marks` lives in Supabase)

Leaves alone: `tests`, `lessons`, `lessonPlans`, `studentAttendance`,
`attendanceAudit`, `studentAudit`, `studentProfiles`, `examMarks`,
`examCoschGrades`, `hpcAssessments`, `examSubjects`, `examTerms`,
`examSessions`, `examPapers`, `teachers`, `classes`, `timetable`,
`settings`, `syllabus`, `syllabusDocuments`, `missedLessonAlerts`,
`studentAlerts`, `arrangements`, `attendance_events`, `classTeacherByEmail`,
`admins`.

## Prerequisites

- Node 18+
- Firebase service account JSON at `~/.config/rka-academic-tracker/service-account.json`
  (or set `SERVICE_ACCOUNT=/path/to/key.json` when invoking)

## Setup

```bash
cd scripts/wipe-students-and-testmarks
npm install
```

## Usage

**Always preview first:**

```bash
npm run dry
```

Sample output:
```
✔  Connected to project: rka-academic-tracker
   Mode:        DRY RUN (no writes)
   Collections: students, testMarks

📊 students: 248 document(s) would be deleted

📊 testMarks: 1893 document(s) would be deleted

────────────────────────────────────────────────────
Would delete 2141 document(s) total in 4.3s.
```

**Then commit:**

```bash
npm run wipe
```

Sample output:
```
✔  Connected to project: rka-academic-tracker
   Mode:        LIVE — deletions WILL happen
   Collections: students, testMarks

⚠️  Starting in 5 seconds. Press Ctrl+C to abort.

🗑  students: deleting…
   batch   1: -400  (running total: 400)
   batch   2: -248  (running total: 648)
✅ students: deleted 648 document(s)

🗑  testMarks: deleting…
   batch   1: -400  (running total: 400)
   ...
✅ testMarks: deleted 1893 document(s)

────────────────────────────────────────────────────
Deleted 2541 document(s) total in 12.6s.
```

## Wipe a single collection only

```bash
node wipe.js --confirm --only=students
node wipe.js --confirm --only=testMarks
```

## Safety

- Without `--confirm` (and not in `--dry-run`), the script refuses to run.
- A 5-second grace period prints before deletion starts — Ctrl+C to abort.
- Batches of 400 are well under Firestore's 500/commit limit.
- Idempotent: re-running on an already-empty collection is a no-op.

## Recovery

Firestore deletes are **not undoable** through the script.

If your Firebase project has Point-In-Time Recovery (PITR) enabled (Blaze plan,
opt-in feature), you can restore to a timestamp before the deletion via
`gcloud firestore databases restore`. Otherwise, restore from your last export.

**Export first if in doubt:**

```bash
gcloud firestore export gs://your-bucket/$(date +%F)
```
