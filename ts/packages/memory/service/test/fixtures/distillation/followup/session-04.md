---
type: "investigation-session"
source_id: "dream-session-04"
canonical_uri: "urn:memorydemo:distillation:dream-session-04"
revision: 2
available_at: "2026-10-07T09:10:00Z"
status: "synthetic-demo"
---


# Session 4 - Simulated recovery and bounded verification

Recorded synthetic exploration, not a finished guide or execution authority.

Evidence availability is distinct from occurrence time. References use stable record IDs.


## Record S04-dream-recovery-recorded

Classification: action

Occurred at: 2026-10-06T10:00:00Z

Recorded / known at: 2026-10-06T10:00:00Z

Resource: aks-payments-prod/payments-api

Correlation: cor-s04-dream-oct05


The rehearsal records a simulated, approved restoration of pool size to 100 through the normal configuration deployment path. It changes no live Azure resource and grants no future approval.


```json
{
  "approval": "recorded rehearsal approval only",
  "based_on": [
    "S04-dream-recovery-proposed"
  ],
  "occurred_at": "2026-10-06T10:00:00Z",
  "owner": "<service-owner>",
  "phase": "baseline",
  "pool_size": 100,
  "session_id": "session-04",
  "simulated": true
}
```


## Record S04-dream-recovery-metrics

Classification: fact

Occurred at: 2026-10-06T10:15:00Z

Recorded / known at: 2026-10-06T10:15:00Z

Resource: appi-payments-prod

Correlation: cor-s04-dream-oct05


After the recorded restoration, checkout p95 was 460 milliseconds and errors were 0.2 percent; connection waits returned to baseline and pool timeout exceptions stopped.


```json
{
  "connection_waits_baseline": true,
  "error_rate_basis_points": 20,
  "occurred_at": "2026-10-06T10:15:00Z",
  "p95_ms": 460,
  "phase": "baseline",
  "pool_timeout_exceptions": 0,
  "session_id": "session-04"
}
```


## Record S04-dream-pool-confirmed

Classification: correction

Occurred at: 2026-10-06T10:30:00Z

Recorded / known at: 2026-10-06T10:30:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


The recorded recovery and stable observation support application pool exhaustion for this episode. The leading hypothesis is now the fixture's confirmed explanation; the query theory remains rejected. A pool value of 100 is not a universal recommendation.


```json
{
  "based_on": [
    "S04-dream-phase-split",
    "S04-dream-config-discovered",
    "S04-dream-recovery-recorded",
    "S04-dream-recovery-metrics"
  ],
  "occurred_at": "2026-10-06T10:30:00Z",
  "phase": "baseline",
  "session_id": "session-04",
  "supersedes": "S04-dream-pool-hypothesis"
}
```


## Record S04-dream-closure

Classification: decision

Occurred at: 2026-10-06T10:35:00Z

Recorded / known at: 2026-10-06T10:35:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


Close the rehearsal incident after 20 minutes of healthy observation, but keep peak-load validation and owner sign-off as open project actions. Future cases require fresh evidence; reopen server-pressure and query investigation if a reviewed pool restoration does not recover the workload.


```json
{
  "based_on": [
    "S04-dream-pool-confirmed",
    "S04-dream-recovery-metrics"
  ],
  "incident_closed": true,
  "observation_minutes": 20,
  "occurred_at": "2026-10-06T10:35:00Z",
  "phase": "baseline",
  "project_complete": false,
  "session_id": "session-04"
}
```


## Record S04-dream-followup-headroom

Classification: fact

Occurred at: 2026-10-07T08:50:00Z

Recorded / known at: 2026-10-07T09:00:00Z

Resource: aks-payments-prod/payments-api

Correlation: cor-s04-dream-oct05


A separate recorded peak-load rehearsal at 100 concurrent requests reached the fixture's workload-memory warning level with pool size 100. This does not undo the earlier recovery; it limits reuse without workload-headroom validation.


```json
{
  "based_on": [
    "S04-dream-closure"
  ],
  "concurrent_requests": 100,
  "memory_warning": true,
  "occurred_at": "2026-10-07T08:50:00Z",
  "phase": "followup",
  "session_id": "session-04"
}
```


## Record S04-dream-followup-decision

Classification: decision

Occurred at: 2026-10-07T09:10:00Z

Recorded / known at: 2026-10-07T09:10:00Z

Resource: project/payments-reliability

Correlation: cor-s04-dream-oct05


Keep the successful investigation trajectory, but require measured workload headroom before selecting a pool target. Mark capacity-validation follow-up as blocked pending <service-owner> review; do not automatically increase pools or publish a skill.


```json
{
  "auto_publish": false,
  "based_on": [
    "S04-dream-followup-headroom"
  ],
  "occurred_at": "2026-10-07T09:10:00Z",
  "owner": "<service-owner>",
  "phase": "followup",
  "project_status": "capacity validation blocked",
  "session_id": "session-04"
}
```
