# Orders schema migration - charter

Project knowledge as-of: 2026-10-08T08:00:00Z

## Recorded charter context

Introduce a versioned order-state column through expand/backfill/dual-read/contract phases without long locks or inventing a completed production migration.

## Scope and failure boundaries

One long migration spans four sessions. A test backfill or successful schema diff is not proof that old writers disappeared or contract deletion is safe.

## Team interpretation

The project is measured by bounded acceptance work, not by the number of generated pages. An incident may close while engineering work remains active. Goals cover this fictional team only; other teams can reuse concepts but must establish their own workload evidence.

Admission to any change requires an explicitly selected source revision and an accountable role. Unknown owners and unknown due dates remain unknown. A remembered diagnostic procedure provides context for a request, never authority to mutate an environment.

Project status: active
Incident status: unknown
Capacity validation: unknown
Assigned person: unknown. Accountable role: <service-owner>.
Milestone: bounded acceptance review; state: proposed; due date: unknown.

## Project-specific review

Risk: An unbounded backfill can hold locks beyond the service budget. Dropping the legacy field while old writers remain converts a compatibility plan into an outage. Row-count equality alone can conceal semantic mismatches.

Required checks: Measure lock duration per bounded batch; reconcile selected, changed, skipped and failed rows; resume from the stored cursor; test old/new reader-writer combinations and preserve unresolved contract evidence.

Recovery boundary: Abort any batch exceeding the synthetic lock budget and retain its cursor. Leave the legacy column and fallback path intact. Contract remains blocked until a separately reviewed convergence and backup/recovery gate.

## Evidence available to this role

### Review question 1: What would satisfy the bounded goal?

Context to inspect: Introduce a versioned order-state column through expand/backfill/dual-read/contract phases without long locks or inventing a completed production migration.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 2: Which follow-up remains outside closure?

Context to inspect: Order writers persist legacy status and candidate status-v2 during overlap. Readers prefer a validated new value and retain a legacy fallback. A bounded backfill uses a stable key cursor and stores progress; contract removal waits for writer convergence, retention checks and lock-budget approval.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 3: Who can approve reuse?

Context to inspect: Expand with a nullable candidate column before enabling dual writes. Backfill in small resumable key ranges and keep legacy reads until convergence. Reject one transaction updating the entire table and early removal of the legacy column.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 4: Which project must not inherit this conclusion?

Context to inspect: ORD-7 requires stable-cursor resume and lock-budget measurements. ORD-13 requires old-writer detection, null reconciliation and contract approval. The migration is not finished and no production DDL has been executed.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.
