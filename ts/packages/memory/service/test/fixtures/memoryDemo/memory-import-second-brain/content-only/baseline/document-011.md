# Identity and gateway migration - charter

Project knowledge as-of: 2026-10-08T08:00:00Z

## Recorded charter context

Rotate token issuer and audience compatibility without disabling authorization, then make gateway policy revisions observable across mixed deployments.

## Scope and failure boundaries

Token signature, issuer, audience, expiry and role decisions are distinct gates. A gateway 401 or 403 does not authorize bypassing any gate.

## Team interpretation

The project is measured by bounded acceptance work, not by the number of generated pages. An incident may close while engineering work remains active. Goals cover this fictional team only; other teams can reuse concepts but must establish their own workload evidence.

Admission to any change requires an explicitly selected source revision and an accountable role. Unknown owners and unknown due dates remain unknown. A remembered diagnostic procedure provides context for a request, never authority to mutate an environment.

Project status: active
Incident status: unknown
Capacity validation: unknown
Assigned person: unknown. Accountable role: <service-owner>.
Milestone: bounded acceptance review; state: proposed; due date: unknown.

## Project-specific review

Risk: Broadening accepted audiences creates a confused-deputy risk. A successful token decode is not a successful signature check. Disabling role policy to remove a 403 would hide a real authorization boundary.

Required checks: Record issuer/audience/key/revision tuples and expected accept or reject decisions; verify expired and wrong-audience negatives; preserve denied policy access and mixed-replica observations.

Recovery boundary: Keep traffic on the reviewed compatible revision until rollout approval. If policy rollback is separately authorized, select the prior immutable digest and recheck rejection cases; never bypass token verification.

## Evidence available to this role

### Review question 1: What would satisfy the bounded goal?

Context to inspect: Rotate token issuer and audience compatibility without disabling authorization, then make gateway policy revisions observable across mixed deployments.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 2: Which follow-up remains outside closure?

Context to inspect: A synthetic issuer signs tokens for explicitly named audiences. Gateway replicas retrieve public verification keys and evaluate policy revisions before forwarding. Downstream APIs enforce their own audience and authorization policy; gateway acceptance does not establish downstream compatibility.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 3: Who can approve reuse?

Context to inspect: Use an explicit old/new issuer and audience matrix during overlap, with a reviewed expiry for old acceptance. Reject wildcard issuer matching and role removal. Pin the gateway policy to an immutable revision and correlate decisions with replica revision.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 4: Which project must not inherit this conclusion?

Context to inspect: ID-22 requires mixed-replica token tests and a clock-skew boundary case. GW-8 requires policy digest visibility and a safe rollback preview. Key rotation and production rollout remain unexecuted.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.
