---
type: "reference"
source_id: "dream-platform"
canonical_uri: "urn:memorydemo:distillation:dream-platform"
revision: 1
available_at: "2026-10-05T08:00:00Z"
status: "synthetic-demo"
---

# Contoso Payments Platform service overview

## Purpose

This synthetic service provides one coherent Azure topology for runbook-memory
demos. It is not connected to a live subscription.

## Request and settlement paths

Client payment requests enter through Azure API Management and reach
`payments-api` in `aks-payments-prod`. The API reads application secrets from
`kv-payments-prod`, stores payment state in `sqldb-payments-prod`, and publishes
settlement work to `sb-payments-prod`.

Settlement workers consume the queue asynchronously. Azure Monitor,
Application Insights, Log Analytics, and recorded Kubernetes events supply the
evidence used by the scenarios.

```text
Client
  -> Azure API Management
  -> AKS payments-api
       -> Key Vault
       -> Azure SQL
       -> Service Bus settlement queue
            -> AKS settlement-worker
```

## Service objectives

| Signal | Demo objective |
| --- | --- |
| Payment success rate | At least 99.5 percent |
| HTTP 5xx rate | Below 1 percent during canary promotion |
| Checkout p95 latency | Below 750 milliseconds |
| Settlement oldest-message age | Below 5 minutes |
| Critical workload readiness | All desired replicas ready |

These values are fixture decisions, not Microsoft defaults or production
recommendations.

## Evidence model

The raw fixture distinguishes:

- `fact`: an observed synthetic telemetry record;
- `hypothesis`: a possible explanation not yet established;
- `correction`: evidence that supersedes a hypothesis;
- `action`: an approved or simulated operational change; and
- `decision`: a documented choice based on evidence.

Use the stable `record_id` and `correlation_id` values when citing evidence.

## Ownership placeholders

| Responsibility | Owner |
| --- | --- |
| Service owner | `<service-owner>` |
| Release owner | `<release-owner>` |
| Incident commander | `<incident-commander>` |
| Security escalation | `<security-owner>` |
| Database escalation | `<database-owner>` |

