---
type: "investigation-session"
source_id: "dream-session-03"
canonical_uri: "urn:memorydemo:distillation:dream-session-03"
revision: 1
available_at: "2026-10-06T08:15:00Z"
status: "synthetic-demo"
---


# Session 3 - Phase timing and configuration discovery

Recorded synthetic exploration, not a finished guide or execution authority.

Evidence availability is distinct from occurrence time. References use stable record IDs.


## Record S04-dream-phase-split

Classification: fact

Occurred at: 2026-10-06T08:00:00Z

Recorded / known at: 2026-10-06T08:00:00Z

Resource: appi-payments-prod

Correlation: cor-s04-dream-oct05


The affected traces spent a median 1850 milliseconds acquiring an application database connection and 140 milliseconds executing SQL. Total dependency duration had concealed which phase waited.


```json
{
  "median_connection_wait_ms": 1850,
  "median_sql_execution_ms": 140,
  "occurred_at": "2026-10-06T08:00:00Z",
  "phase": "baseline",
  "session_id": "session-03"
}
```


## Record S04-dream-config-discovered

Classification: fact

Occurred at: 2026-10-05T08:45:00Z

Recorded / known at: 2026-10-06T08:05:00Z

Resource: aks-payments-prod/payments-api

Correlation: cor-s04-dream-oct05


Configuration comparison discovered that cfg-dream-991 reduced maximum application pool size from 100 to 20 before the alert. The change occurred on October 5 at 08:45Z but became known to investigators in session 3.


```json
{
  "new_pool_size": 20,
  "occurred_at": "2026-10-05T08:45:00Z",
  "old_pool_size": 100,
  "phase": "baseline",
  "revision": "cfg-dream-991",
  "session_id": "session-03"
}
```


## Record S04-dream-pool-hypothesis

Classification: hypothesis

Occurred at: 2026-10-06T08:10:00Z

Recorded / known at: 2026-10-06T08:10:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


Pool exhaustion is now the leading hypothesis, supported by phase timing and the configuration comparison. It remains unverified until a bounded recovery and sustained observation confirm the explanation.


```json
{
  "based_on": [
    "S04-dream-phase-split",
    "S04-dream-config-discovered"
  ],
  "confirmed": false,
  "occurred_at": "2026-10-06T08:10:00Z",
  "phase": "baseline",
  "session_id": "session-03"
}
```


## Record S04-dream-recovery-proposed

Classification: decision

Occurred at: 2026-10-06T08:15:00Z

Recorded / known at: 2026-10-06T08:15:00Z

Resource: incident/demo-dream-sql

Correlation: cor-s04-dream-oct05


A request to restore the previous application pool setting was prepared for <service-owner>. No change was executed. The request requires workload headroom, a previous configuration for rollback, and approval; direct production edits and blind database scaling are excluded.


```json
{
  "approval": "pending",
  "based_on": [
    "S04-dream-pool-hypothesis",
    "S04-dream-defer-scale"
  ],
  "executed": false,
  "occurred_at": "2026-10-06T08:15:00Z",
  "phase": "baseline",
  "session_id": "session-03"
}
```
