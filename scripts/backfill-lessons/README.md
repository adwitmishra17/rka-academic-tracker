# Lesson slotId Backfill

Stamps `slotId`, `offSchedule`, and `coveringFor` on existing lesson docs so the reconciliation tab (Step 4 of the lesson-plan-vs-log work) has clean data.

## Setup (once)

```bash
mkdir -p ~/Documents/RKA_Academic_tracker/backfill_lessons
cd ~/Documents/RKA_Academic_tracker/backfill_lessons
# drop the three files from /mnt/user-data/outputs/lessons-backfill/ here
npm install
```

`firebase-admin` will be the only dep installed.

## Service account

Defaults to:
```
/Users/adwitsdocs/Downloads/rka-academic-tracker-firebase-adminsdk-fbsvc-6996f7ee66.json
```

If yours is elsewhere, set the env var:
```bash
export SERVICE_ACCOUNT=/path/to/your-key.json
```

## Run

**Always start with a dry run** to see the match rate and a sample of unmatched lessons:

```bash
npm run dry
```

Output looks like:
```
=== Lesson slotId backfill (DRY RUN — no writes) ===

Loading timetable...
  248 timetable slots
  186 (day|period|class) keys indexed

Loading lessons...
  2,847 lessons

--- Summary ---
Already had slotId:      0
Newly matched:           2,612
Unmatched (legacy):      235
Updates queued:          2,847
Match rate:              91.7%

Unmatched samples (first 10):
  1. 2024-08-12 Monday P3 · Class 9 · Mrs. Asha Rai  [teacher mismatch]
  2. 2024-09-04 Wednesday P5 · Class 10 · Mr. Kapoor  [no slot exists for day/period/class]
  ...

(DRY RUN — no writes performed.)
```

Review the unmatched samples. Common reasons:
- **Teacher mismatch**: the lesson's `teacherId` doesn't match any slot for that class/period — likely a teacher who has since left, or the timetable was edited.
- **No slot exists**: the timetable doesn't have any slot for that (day, period, class) combination — probably a stale slot from a previous term, or an off-schedule lesson logged under v1.

Both cases are fine — they'll be marked `slotId: null, offSchedule: false` (legacy unmatched), and the reconciliation tab will surface them in a "legacy" bucket separate from intentional off-schedule lessons.

## Live run

When the dry-run output looks reasonable:

```bash
npm run backfill
```

The script gives you a 5-second window to Ctrl+C before writes start. Then it writes in batches of 400. ~2-3 seconds per batch.

## Idempotent

Safe to re-run. Lessons that already have `slotId` set get skipped. Useful if:
- New lessons were logged between the dry run and the live run.
- The timetable was updated and you want to retry matching unmatched ones (clear their `slotId` field first if you want them re-evaluated, or leave them — they're safe either way).

## Limit (testing)

To process only the first N unmatched lessons:

```bash
node backfill_slot_id.js --dry-run --limit=50
```

## After running

Verify in Firestore Console:
1. Open any lesson doc — confirm `slotId`, `offSchedule`, `coveringFor` are all present.
2. Pick a lesson where you know the timetable slot — confirm `slotId` matches.

Then Step 4 (the reconciliation tab in admin TeacherProfile) is unblocked.
