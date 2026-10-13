---
type: "investigation-session"
source_id: "dream-session-01"
canonical_uri: "urn:memorydemo:distillation:dream-session-01"
revision: 1
available_at: "2026-10-05T09:15:00Z"
status: "synthetic-demo"
---


# Session 1 - Symptoms and an unproven query hypothesis

Recorded synthetic exploration, not a finished guide or execution authority.

Evidence availability is distinct from occurrence time. References use stable record IDs.


## Record S04-dream-alert

Classification: fact

Occurred at: 2026-10-05T09:00:00Z

Recorded / known at: 2026-10-05T09:00:00Z

Resource: aks-payments-prod/payments-api

Correlation: cor-s04-dream-oct05


In a separate synthetic rehearsal, checkout p95 rose from 420 to 2800 milliseconds; application errors reached 2.1 percent.


```json
{
  "baseline_p95_ms": 420,
  "error_rate_basis_points": 210,
  "observed_p95_ms": 2800,
  "occurred_at": "2026-10-05T09:00:00Z",
  "phase": "baseline",
  "session_id": "session-01"
}
```


## Record S04-dream-cpu

Classification: fact

Occurred at: 2026-10-05T09:05:00Z

Recorded / known at: 2026-10-05T09:05:00Z

Resource: sqldb-payments-prod

Correlation: cor-s04-dream-oct05


Azure SQL CPU was 68 percent. The recorded demo scale-review threshold is 80 percent; CPU alone neither proves nor excludes a database bottleneck.


```json
{
  "cpu_percent": 68,
  "occurred_at": "2026-10-05T09:05:00Z",
  "phase": "baseline",
  "scale_review_threshold_percent": 80,
  "session_id": "session-01"
}
```


## Record S04-dream-query-hypothesis

Classification: hypothesis

Occurred at: 2026-10-05T09:10:00Z

Recorded / known at: 2026-10-05T09:10:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


The analyst suspected reporting query query-demo-31. No trace correlation had been established; an expensive query is not yet a root cause.


```json
{
  "confirmed": false,
  "occurred_at": "2026-10-05T09:10:00Z",
  "phase": "baseline",
  "query_hash": "query-demo-31",
  "session_id": "session-01"
}
```


## Record S04-dream-first-handoff

Classification: decision

Occurred at: 2026-10-05T09:15:00Z

Recorded / known at: 2026-10-05T09:15:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


The session ended unresolved. The next analyst should correlate reporting-query execution with the slow checkout traces and check blocking before proposing a resource change.


```json
{
  "based_on": [
    "S04-dream-alert",
    "S04-dream-cpu",
    "S04-dream-query-hypothesis"
  ],
  "occurred_at": "2026-10-05T09:15:00Z",
  "phase": "baseline",
  "resolved": false,
  "session_id": "session-01"
}
```
