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
