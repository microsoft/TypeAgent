---
type: operational-guide
scenario_id: S03
title: "Service Bus backlog and poison-message isolation"
status: synthetic-demo
revision: 1
source_document: ../docs/runbooks/03-service-bus-backlog.md
---

# Guide: Investigate a Service Bus backlog and poison messages

## Purpose and scope

Use this guide when settlement processing falls behind while the synchronous
payment API remains healthy. It distinguishes insufficient consumer throughput
from repeated processing of a poison message.

The guide covers queue and worker diagnosis, temporary scale-out, safe
dead-letter isolation, and recovery verification. It does not authorize reading
unredacted message bodies or replaying dead-letter messages.

## Symptoms

- Active message count or oldest-message age increases.
- Incoming message rate exceeds completion rate.
- Retry or abandon counts rise.
- Worker CPU remains low despite backlog growth.
- A small set of message IDs repeatedly fails schema validation.

## Severity triage

| Condition | Demo severity | Response |
| --- | --- | --- |
| Settlement unavailable or data-integrity risk | SEV-1 | Stop unsafe processing and escalate |
| Oldest-message age above 15 minutes and rising | SEV-2 | Mitigate and investigate |
| Backlog above normal but draining | SEV-3 | Monitor and correct capacity |

## System overview

`payments-api` sends settlement work to the `settlement` queue in
`sb-payments-prod`. `settlement-worker` pods consume and complete messages.
After the delivery count reaches the configured maximum, Service Bus can move a
message to the dead-letter queue.

Scaling consumers can improve total throughput. It cannot correct a malformed
message, incompatible schema, or deterministic downstream rejection.

## Prerequisites

- Azure Service Bus Reader access for management counters and metrics
- AKS read access for worker health
- Sanitized application logs containing message IDs but not message bodies
- Approved scale ceiling and scale-in plan
- A documented dead-letter handling policy

## Evidence to collect

Record:

- active and dead-letter message counts;
- oldest-message age;
- incoming and completed messages per interval;
- worker replicas, CPU, memory, restarts, and concurrency;
- retry counts and repeated message IDs;
- sanitized dead-letter reason and schema error;
- downstream dependency health.

## Procedure

### 1. Confirm queue depth

```powershell
az servicebus queue show `
  --resource-group <resource-group> `
  --namespace-name <namespace> `
  --name settlement `
  --query countDetails `
  --output table
```

Validation record: `service-bus-queue-counters`.

Expected fields include active, dead-letter, scheduled, transfer, and transfer
dead-letter message counts. Do not poll these broker counters aggressively.

### 2. Inspect depth metrics

```powershell
az monitor metrics list `
  --resource <service-bus-namespace-resource-id> `
  --metrics ActiveMessages DeadletteredMessages `
  --dimension EntityName `
  --interval PT1M `
  --offset 1h `
  --aggregation Average Maximum `
  --output json
```

Validation record: `service-bus-depth-metrics`.

### 3. Compare ingress and egress

```kusto
AzureMetrics
| where TimeGenerated > ago(6h)
| where _ResourceId =~ "<service-bus-namespace-resource-id>"
| where MetricName in ("IncomingMessages", "OutgoingMessages")
| summarize Messages=sum(Total)
    by MetricName, bin(TimeGenerated, 5m)
| render timechart
```

Validation record: `kql-service-bus-flow`.

This query shows flow, not queue depth. `ActiveMessages` and
`DeadletteredMessages` are not exported to Logs as queue-depth records; use the
management counters or Metrics API for depth.

### 4. Check worker capacity

1. Confirm desired replicas are ready.
2. Compare worker CPU and memory with the approved scale ceiling.
3. Review restarts and dependency failures.
4. If workers are saturated and failures are diverse, scale-out may be the
   appropriate mitigation.
5. If workers have headroom and the same message repeatedly fails, scaling is
   unlikely to resolve the incident.

### 5. Apply temporary scale mitigation

1. Record current replicas and the approved temporary target.
2. Obtain explicit approval.
3. Scale only within the documented ceiling.
4. Observe completion rate, retry rate, and backlog.
5. Classify the action as partial mitigation if backlog or retries continue.

The first review uses recorded results `S03-scale-approved` and
`S03-scale-completed`; it does not scale a live workload.

### 6. Isolate a poison message

1. Retrieve only sanitized metadata required to identify the repeated failure.
2. Confirm the error is deterministic and specific to that message.
3. Confirm dead-letter policy and approval.
4. Isolate the message without replaying or exposing its body.
5. Record the message ID, reason, delivery count, and owning schema team.

Azure CLI reports dead-letter counts but does not inspect
`DeadLetterReason` or settle message bodies. Use an approved Service Bus
Explorer or SDK workflow for those operations.

## Verification

The incident is recovered when:

1. completion rate remains above ingress;
2. active message count decreases;
3. oldest-message age returns below five minutes;
4. retries stop increasing;
5. the poison message remains isolated; and
6. worker replicas can return to their normal count without renewed backlog.

## Rollback or recovery

Do not replay the isolated message until the schema owner has corrected or
approved it. If scale-out creates downstream pressure, return to the previous
replica count and reassess. Preserve the dead-letter evidence for follow-up.

## Escalation

Escalate repeated schema failures to `<partner-integration-owner>`. Escalate
Service Bus availability or quota issues to `<service-owner>`. Escalate any
message-content exposure to `<security-owner>`.

## References

- [Service Bus message counters](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-counters)
- [Service Bus monitoring reference](https://learn.microsoft.com/en-us/azure/service-bus-messaging/monitor-service-bus-reference)
- [Service Bus dead-letter queues](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues)

