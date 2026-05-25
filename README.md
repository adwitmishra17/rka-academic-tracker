# RKA Academic Tracker

Firebase-backed academic management for Radhakrishna Academy: classes,
timetable, lessons, tests, marks, and student/teacher attendance. Two
client apps share one Firebase project (`rka-academic-tracker`,
region `asia-south2`).

This is one of four RKA apps:

| App                  | Stack                | Repo                |
|----------------------|----------------------|---------------------|
| Academic Tracker     | React + Firebase     | this repo           |
| Teacher PWA          | React + Firebase     | this repo (`teacher/`) |
| HRMS                 | (separate)           | — |
| SMS (Student Mgmt)   | React + Supabase     | `rka-sms`           |

## Layout

```
.
├── admin/                       Vite + React admin app (teachers,
│                                tests, lesson plans, timetable,
│                                student profiles, attendance).
├── teacher/                     Vite + React teacher PWA — daily
│                                attendance + marks entry.
├── scripts/
│   └── backfill-lessons/        One-shot node script that stamped
│                                slotId / offSchedule / coveringFor on
│                                pre-existing lesson docs.
├── firestore.rules              Firestore security rules.
├── firestore.indexes.json
├── firebase.json
└── .firebaserc
```

## Firestore collections

From `firestore.rules`:

| Collection           | Owner / writer                           | Notes |
|----------------------|------------------------------------------|-------|
| `admins/{email}`     | super admin                              | branch access + isActive flag |
| `userBranches/{email}`| sync function / backfill script         | rules-lookup table for branch access |
| `teachers/{id}`      | HRMS sync (Admin SDK)                    | identity owned by HRMS; admin may edit `subjectsTaught` / `classesAssigned` etc. |
| `students/{id}`      | SMS sync (Admin SDK)                     | mirrored from SMS Supabase |
| `tests/{id}`         | admins + teachers (branch-scoped)        | exam definitions |
| `testMarks/{id}`     | admins + teachers (branch-scoped)        | per-student marks |
| `lessons/{id}`       | admins + teachers (branch-scoped)        | logged lessons |
| `lessonPlans/{id}`   | admins + teachers (branch-scoped)        | weekly/daily plans |
| `timetable/{slotId}` | admins                                   | day × period × class slots |
| `absentees/{id}`     | admins                                   | teacher absences |
| `arrangements/{id}`  | admins                                   | substitute teacher assignments |
| `holidays/{id}`      | admins (global)                          | branch-nullable = applies to all |
| `syllabus/{id}`      | admins (global)                          | |
| `classes/{id}`       | admins (global)                          | class catalogue |
| `settings/{id}`      | admins (global)                          | |
| `attendance_events/{id}` | Hikvision sync function (Admin SDK)  | teacher biometric events |

## Local development

Each app is a standard Vite project:

```bash
cd admin && npm install && npm run dev      # admin app
cd teacher && npm install && npm run dev    # teacher PWA
```

## Service account (for backfill / Admin SDK scripts)

The Firebase service account JSON is **not** in the repo. Default path:

```
~/.config/rka-academic-tracker/service-account.json
```

Backfill scripts read `SERVICE_ACCOUNT` env var if set; otherwise they
default to the above path.

## Deploying Firestore rules

From the repo root:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```
