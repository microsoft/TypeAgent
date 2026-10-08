---
type: operational-guide
scenario_id: S04
title: "Azure SQL latency and connection-pool exhaustion"
status: synthetic-demo
revision: 1
source_document: ../docs/runbooks/04-sql-latency.md
---

# Guide: Investigate Azure SQL latency and connection-pool exhaustion

## Purpose and scope

Use this guide when checkout latency rises and Azure SQL appears implicated.
The procedure separates application connection waits from server CPU, worker,
session, blocking, deadlock, and query-execution pressure before a scaling
decision is made.

Do not scale the database solely because CPU increased, and do not treat an
expensive query as causal without correlation to the affected requests.

## Symptoms

- Checkout p95 latency exceeds 750 milliseconds.
- Application dependency calls wait before SQL execution begins.
- Connection-pool timeout exceptions appear.
- Azure SQL CPU, sessions, or workers rise.
- A recent application configuration revision changed pool limits.

## Severity triage

| Condition | Demo severity | Response |
| --- | --- | --- |
| Checkout unavailable or payment state uncertain | SEV-1 | Freeze risky changes and escalate |
| p95 above 2 seconds for at least 10 minutes | SEV-2 | Investigate and mitigate |
| Elevated latency with error rate below 1 percent | SEV-3 | Diagnose before changing capacity |

## System overview

Each `payments-api` process owns a local database connection pool. Azure SQL
can report server-side CPU, sessions, workers, I/O, connections, blocking, and
deadlocks. It cannot directly observe occupancy or wait time inside the
application's local pool.

High `sessions_percent` or `workers_percent` can support a server-pressure
hypothesis. They do not prove application pool exhaustion. Application traces
and configuration revisions are required for that conclusion.

## Prerequisites

- Azure Monitor Reader access to the database resource
- Application Insights dependency and exception telemetry
- Exact incident time window and application version
- Current and previous connection-pool configuration
- Database escalation owner
- Authorization before viewing SQL text or parameters

Avoid projecting `AppDependencies.Data`; it can contain SQL text or sensitive
parameters.

## Evidence to collect

Collect:

- request p50, p95, and p99 latency;
- application error and timeout rate;
- SQL dependency duration and success;
- connection-pool exception messages;
- Azure SQL CPU, reads, writes, sessions, workers, connections, and deadlocks;
- blocking-query evidence;
- traffic volume;
- configuration revisions in the incident window.

## Procedure

### 1. Establish the customer-impact window

1. Record when checkout latency first crossed policy.
2. Compare traffic volume, latency, and error rate.
3. Identify affected application versions and pods.
4. Use one UTC time window for application and database evidence.

### 2. Measure Azure SQL server pressure

```powershell
az monitor metrics list `
  --resource <sql-database-resource-id> `
  --metrics cpu_percent physical_data_read_percent log_write_percent sessions_percent workers_percent `
  --interval PT1M `
  --offset 1h `
  --aggregation Average Maximum `
  --output json
```

Validation record: `sql-pressure-metrics`.

Interpretation:

- sustained CPU, session, or worker saturation supports a server-capacity
  investigation;
- low or moderate server pressure weakens a scale-first hypothesis;
- metric availability varies by database type and service tier.

### 3. Compare application-observed SQL latency

```kusto
AppDependencies
| where TimeGenerated > ago(1h)
| where DependencyType =~ "SQL"
| summarize
    Calls=sum(ItemCount),
    Failures=sumif(ItemCount, Success == false),
    P50ms=percentile(DurationMs, 50),
    P95ms=percentile(DurationMs, 95),
    P99ms=percentile(DurationMs, 99)
  by Target, Name, bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

Validation record: `kql-sql-dependency-latency`.

Telemetry sampling affects percentile interpretation. `ItemCount` corrects
aggregate counts, not percentile weighting.

### 4. Find connection-pool evidence

```kusto
AppExceptions
| where TimeGenerated > ago(1h)
| where OuterMessage has_any (
    "connection pool",
    "obtaining a connection from the pool",
    "pool size"
  )
| project
    TimeGenerated,
    AppRoleName,
    OperationName,
    ExceptionType,
    OuterMessage
| order by TimeGenerated desc
```

Validation record: `kql-connection-pool-exceptions`.

Also inspect traces that separate connection acquisition time from SQL
execution time. A long total dependency duration alone does not identify which
phase waited.

### 5. Check blocking and query hypotheses

1. Look for sustained blocking sessions and deadlocks in the same UTC window.
2. Correlate candidate expensive queries with the slow checkout traces.
3. Preserve an expensive-query explanation as a hypothesis until correlation
   exists.
4. If a query ran outside the slow traces, do not use it as the root cause.

### 6. Compare configuration revisions

1. Identify pool-size, timeout, and retry changes made before the incident.
2. Compare the affected version with the last known-good revision.
3. Determine whether the configured pool can serve expected concurrency.
4. Prefer restoring a known-good application setting before scaling the
   database when server-pressure evidence is weak.

In scenario `S04`, revision `cfg-991` reduced the maximum pool from 100 to 20.
Slow traces spent about 1.85 seconds acquiring a connection and about
140 milliseconds executing SQL. Azure SQL CPU reached 68 percent, with no
sustained blocking. This evidence supports pool exhaustion and rejects a
database scale-up as the first response.

## Verification

After restoring the known-good pool setting, verify:

1. connection-acquisition waits return to baseline;
2. pool timeout exceptions stop;
3. checkout p95 is below 750 milliseconds;
4. checkout errors are below 1 percent;
5. SQL CPU, workers, and sessions remain healthy; and
6. the recovery remains stable through the approved observation window.

The recorded scenario recovers to p95 of 460 milliseconds and an error rate of
0.2 percent.

## Rollback or recovery

Restore the previous application pool configuration through the normal
configuration deployment path. Do not edit production configuration directly
during diagnosis.

If latency persists after pool recovery:

1. reopen the server-pressure and blocking investigation;
2. capture new evidence rather than reusing the recorded conclusion;
3. evaluate database scale only when resource evidence supports it; and
4. preserve the original configuration revision for rollback.

The first demo review uses recorded action `S04-pool-restored`; it does not
change a live workload.

## Escalation

Escalate application pool and configuration issues to `<service-owner>`.
Escalate confirmed Azure SQL saturation, blocking, or deadlocks to
`<database-owner>`. Escalate possible sensitive SQL telemetry exposure to
`<security-owner>`.

## References

- [Azure SQL monitoring reference](https://learn.microsoft.com/en-us/azure/azure-sql/database/monitoring-sql-database-azure-monitor-reference?view=azuresql-db)
- [AppDependencies schema](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/appdependencies)
- [AppExceptions schema](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/appexceptions)

