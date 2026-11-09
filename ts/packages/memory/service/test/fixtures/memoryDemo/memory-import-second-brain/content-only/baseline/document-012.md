# Identity and gateway migration - status

Project knowledge as-of: 2026-10-08T17:19:00Z

## Recorded status context

Token signature, issuer, audience, expiry and role decisions are distinct gates. A gateway 401 or 403 does not authorize bypassing any gate.

## Scope and failure boundaries

Token signature, issuer, audience, expiry and role decisions are distinct gates. A gateway 401 or 403 does not authorize bypassing any gate.

## Team interpretation

Status is a positive assertion with a knowledge-as-of time, not a file capture time. The checkpoint distinguishes project, incident and capacity state. Proposed milestones are not commitments; the named role placeholders are not confirmed people.

A late warning can restrict reuse without undoing an earlier bounded success. Maintain both claims with their original scope and source identity. Follow-up replaces the logical source revision under a guard; adding a second unrelated source would not preserve maintenance lineage.

Project status: active
Incident status: open
Capacity validation: unknown
Assigned person: unknown. Accountable role: <service-owner>.
Milestone: bounded acceptance review; state: proposed; due date: unknown.

## Project-specific review

Risk: Broadening accepted audiences creates a confused-deputy risk. A successful token decode is not a successful signature check. Disabling role policy to remove a 403 would hide a real authorization boundary.

Required checks: Record issuer/audience/key/revision tuples and expected accept or reject decisions; verify expired and wrong-audience negatives; preserve denied policy access and mixed-replica observations.

Recovery boundary: Keep traffic on the reviewed compatible revision until rollout approval. If policy rollback is separately authorized, select the prior immutable digest and recheck rejection cases; never bypass token verification.

## Evidence available to this role

### Review question 1: Which state is positively asserted?

Context to inspect: Rotate token issuer and audience compatibility without disabling authorization, then make gateway policy revisions observable across mixed deployments.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 2: Which milestone is merely proposed?

Context to inspect: A synthetic issuer signs tokens for explicitly named audiences. Gateway replicas retrieve public verification keys and evaluate policy revisions before forwarding. Downstream APIs enforce their own audience and authorization policy; gateway acceptance does not establish downstream compatibility.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 3: What is unknown about assignment?

Context to inspect: Use an explicit old/new issuer and audience matrix during overlap, with a reviewed expiry for old acceptance. Reject wildcard issuer matching and role removal. Pin the gateway policy to an immutable revision and correlate decisions with replica revision.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.

### Review question 4: What later evidence can narrow reuse?

Context to inspect: ID-22 requires mixed-replica token tests and a clock-skew boundary case. GW-8 requires policy digest visibility and a safe rollback preview. Key rotation and production rollout remain unexecuted.

This is planning context, not a new observed result. Resolve it using the selected session's retained messages and complete tool receipts. Unknown verification is not filled by a guide imported from another episode.
