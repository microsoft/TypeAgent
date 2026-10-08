---
type: "investigation-session"
source_id: "dream-session-02"
canonical_uri: "urn:memorydemo:distillation:dream-session-02"
revision: 1
available_at: "2026-10-05T11:15:00Z"
status: "synthetic-demo"
---


# Session 2 - Query exclusion and a still-unresolved handoff

Recorded synthetic exploration, not a finished guide or execution authority.

Evidence availability is distinct from occurrence time. References use stable record IDs.


## Record S04-dream-query-exclusion

Classification: fact

Occurred at: 2026-10-05T11:00:00Z

Recorded / known at: 2026-10-05T11:00:00Z

Resource: appi-payments-prod

Correlation: cor-s04-dream-oct05


The reporting query completed outside the slow checkout trace intervals; zero affected traces contained it. Repeating the expensive-query approach did not explain the incident.


```json
{
  "correlated_slow_traces": 0,
  "occurred_at": "2026-10-05T11:00:00Z",
  "phase": "baseline",
  "query_hash": "query-demo-31",
  "session_id": "session-02"
}
```


## Record S04-dream-query-cleared

Classification: correction

Occurred at: 2026-10-05T11:05:00Z

Recorded / known at: 2026-10-05T11:05:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


The reporting-query hypothesis is rejected for this incident because its execution did not correlate with affected traces. This does not mean expensive queries can never cause latency.


```json
{
  "based_on": [
    "S04-dream-query-exclusion"
  ],
  "occurred_at": "2026-10-05T11:05:00Z",
  "phase": "baseline",
  "session_id": "session-02",
  "supersedes": "S04-dream-query-hypothesis"
}
```


## Record S04-dream-no-blocking

Classification: fact

Occurred at: 2026-10-05T11:10:00Z

Recorded / known at: 2026-10-05T11:10:00Z

Resource: sqldb-payments-prod

Correlation: cor-s04-dream-oct05


No sustained blocking or deadlock correlated with the affected window. Server CPU and blocking evidence did not support a scale-first response.


```json
{
  "blocking_sessions": 0,
  "deadlocks": 0,
  "occurred_at": "2026-10-05T11:10:00Z",
  "phase": "baseline",
  "session_id": "session-02"
}
```


## Record S04-dream-defer-scale

Classification: decision

Occurred at: 2026-10-05T11:15:00Z

Recorded / known at: 2026-10-05T11:15:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


Database scale-up was deferred, not attempted. The handoff requested separate connection-acquisition and SQL-execution spans; the cause and recovery were still unknown.


```json
{
  "based_on": [
    "S04-dream-cpu",
    "S04-dream-no-blocking",
    "S04-dream-query-cleared"
  ],
  "executed": false,
  "occurred_at": "2026-10-05T11:15:00Z",
  "phase": "baseline",
  "resolved": false,
  "session_id": "session-02"
}
```
