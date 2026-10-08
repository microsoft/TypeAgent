---
type: "project-charter"
source_id: "dream-project"
canonical_uri: "urn:memorydemo:distillation:dream-project"
revision: 1
available_at: "2026-10-05T08:00:00Z"
status: "synthetic-demo"
---

# Payments reliability investigation charter

This is a synthetic project source, not a generated project brief or a runbook.
It links a new October rehearsal of scenario S04 to project
`payments-reliability`. It is independent of the September S04 episode.

## Goal and scope

Explain checkout latency, preserve the investigation trajectory across analyst
handoffs, and establish evidence requirements for safe future diagnosis.
The workload is `payments-api`; application connection pools and Azure SQL
execution are separate diagnostic concerns.

Target signals are checkout p95 below 750 milliseconds and error rate below
1 percent, under the fixture's approved observation conditions. These are
synthetic demo policy, not Microsoft defaults.

## Planned milestones

- Establish an incident window and compare competing hypotheses.
- Correlate traces, server pressure, and configuration changes.
- Record an approved simulated recovery and verification.
- Assess peak-load headroom before declaring the broader project complete.

## Ownership and risks

Accountable owner: `<service-owner>`; database escalation: `<database-owner>`.
The placeholders are unresolved identities, not actual assignments or approval.

Risks include premature query blame, mistaking server CPU for application pool
occupancy, and treating one successful pool setting as universally safe.
Meeting the incident recovery target does not complete capacity validation.

## Evidence boundary

Source records use correlation `cor-s04-dream-oct05` and IDs beginning
`S04-dream-`. Four sessions will contribute different evidence; no single session
is expected to contain a finished reusable guide. Never mix these records with
the September incident merely because both belong to scenario S04.
