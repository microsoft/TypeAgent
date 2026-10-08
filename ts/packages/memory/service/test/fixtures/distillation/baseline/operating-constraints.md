---
type: "reference"
source_id: "dream-constraints"
canonical_uri: "urn:memorydemo:distillation:dream-constraints"
revision: 1
available_at: "2026-10-05T08:00:00Z"
status: "synthetic-demo"
---

# Recorded investigation operating constraints

This is shared reference material for the October distillation rehearsal,
not an executable procedure.

## Authority and safety

All observations and changes are recorded synthetic evidence. Approval recorded
in one session authorizes no future live action. Pool restoration is a mutating
configuration change, simulated in this fixture. No command is supplied or run.

Read access, a known previous configuration, workload headroom, and explicit
change approval are prerequisites for considering a recovery in a real setting.
Use the normal reviewed configuration deployment path, never a direct
production edit. If a change is unsafe or evidence is missing, stop and escalate
to `<service-owner>` or `<database-owner>`.

## Interpretation

Total SQL dependency duration does not reveal connection-acquisition time.
Azure SQL CPU does not measure occupancy of an application's local pool.
An expensive query is a hypothesis until correlated with the affected traces.
A rejected query hypothesis for this episode is not a rule to ignore future
query or blocking problems.

## Recovery and reuse limits

Preserve the previous application configuration for rollback. If a reviewed
change degrades the workload, follow the approved restoration/escalation policy;
no automatic rollback or live command is authorized by these notes.

Reuse requires fresh phase-timing, configuration, and server-pressure evidence.
The value 100 is a recorded setting, not a recommended constant. Verify latency,
errors, connection waits, timeout exceptions, and workload/server health over
the approved window. Keep an unsuccessful or unsafe attempted approach in
investigation history, not in the recommended action path.
