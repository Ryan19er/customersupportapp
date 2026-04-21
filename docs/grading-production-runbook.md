# Grading Core Production Runbook

## Scope
Single live deployment for grading + review subsystem.

## Preconditions
- Database migration `018_advanced_grading_engine.sql` is available.
- Supabase secrets are present for edge functions.
- Admin panel deploy pipeline is green.

## Deployment Order (must follow)
1. Apply database migration.
2. Deploy `supabase/functions/grade-answer`.
3. Deploy admin API routes.
4. Deploy admin UI.
5. Run smoke checks below.

## Smoke Checks
1. Trigger one chat reply and confirm:
   - Row exists in `answer_audit`.
   - Row exists in `answer_grades` with `reason_code`, `severity`, `queue_decision`.
2. Trigger known high-severity deterministic case:
   - Confirm `auto_flagged=true`.
   - Confirm queue row is created (`correction_review_queue`) with `triage_bucket` and `cluster_key`.
3. Trigger duplicate medium-severity case within dedupe window:
   - Confirm grade row writes.
   - Confirm queue decision is `deduped` and no additional pending queue item is created.
4. Open admin pages:
   - `/admin/review`: source tabs + triage tabs load correctly.
   - `/admin/knowledge`: advanced telemetry and trends render.

## Rollback Strategy
- If UI/API issue only: roll back admin deploy first.
- If grading logic issue: roll back edge function deploy.
- Do **not** roll back migration unless absolutely required.
- Migration is additive; old code paths remain readable with null-safe handling.

## Post-Deploy Monitoring (first 24h)
- Watch flagged rate, severity mix, queue decision mix.
- Verify critical/high incidents are always queued.
- Verify queue volume is reduced for repeated medium/low noise.

## Vision Diagnosis Addendum
### Additional Deployment Order
1. Apply migration `019_vision_training_system.sql`.
2. Verify storage bucket `vision-training-images` exists and is writable.
3. Deploy admin vision APIs (`/api/admin/vision/*`).
4. Deploy `anthropic-chat` with vision runtime support.
5. Deploy Flutter + admin UI changes.

### Vision Smoke Checks
1. Upload one admin image in Vision training tab and save manual labels.
2. Approve the image and confirm `vision_training_images.label_status='approved'`.
3. Send a customer chat with one image attachment:
   - Confirm row exists in `vision_diagnosis_audit`.
   - Confirm low/unknown confidence creates `vision_diagnosis_review_queue` row.
4. Resolve one queue row in admin and confirm status flips to `resolved`.

### Vision Rollback
- Disable image upload in frontend (feature flag or temporary UI hide).
- Stop vision queue processing if needed; keep existing text chat live.
- If diagnosis quality regresses, revert to prior edge-function deploy while
  keeping tables (additive schema).
