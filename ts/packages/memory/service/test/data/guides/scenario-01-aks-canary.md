---
type: operational-guide
scenario_id: S01
title: "Safe AKS canary deployment and rollback"
status: synthetic-demo
revision: 1
source_document: ../docs/runbooks/01-aks-canary-deployment.md
---

# Guide: Deploy payments-api to AKS with a canary

## Purpose and scope

Use this guide to deploy a new `payments-api` image to
`aks-payments-prod`, evaluate a canary, and make an evidence-based promote or
rollback decision.

This guide covers the Kubernetes workload and its observed service health. It
does not authorize database migrations, Key Vault changes, or external routing
changes. The first demo review uses recorded results and does not change Azure.

## When to use this guide

Use this guide when:

- a release has passed CI and is approved for production;
- the change can run safely beside the stable version;
- stable and canary telemetry can be separated by labels; and
- rollback means returning the Deployment to a known-good image and
  configuration.

Do not use it for an emergency change that cannot coexist with the current
version, an irreversible data migration, or a release whose rollback procedure
has not been reviewed.

## System overview

Azure API Management sends requests to `payments-api` in the `payments`
namespace. Stable and canary Deployments use `track=stable` and `track=canary`
labels. A Kubernetes Service distributes traffic across matching ready pods.

A replica ratio only approximates a traffic percentage. Kubernetes does not
guarantee weighted canary routing merely because one Deployment has fewer
replicas.

## Risk and change triage

| Condition | Decision |
| --- | --- |
| No approved change or no known-good revision | Stop |
| Preflight check fails | Stop and correct the release |
| Canary pods fail readiness or restart repeatedly | Roll back |
| Canary HTTP 5xx is at least 1 percent | Roll back |
| Payment success is below 99.5 percent | Roll back |
| Metrics are incomplete or cannot distinguish canary | Hold; do not promote |
| All gates remain healthy for the observation window | Eligible to promote |

The thresholds are Contoso demo policy, not Azure defaults.

## Prerequisites

- Approved change record and release owner
- Image digest and expected application version
- Known-good Deployment revision
- AKS credentials and Kubernetes RBAC
- Stable and canary labels present in telemetry
- Application Insights and Container Insights data available
- Confirmed rollback owner

`az aks get-credentials` changes the local kubeconfig. Use the expected account,
subscription, and kubeconfig before connecting:

```powershell
az aks get-credentials `
  --resource-group <resource-group> `
  --name <cluster>
```

Validation record: `aks-get-credentials`.

## Evidence to collect

Record these values before changing the workload:

- current stable image and Deployment revision;
- ready and desired replica counts;
- pod restart counts;
- HTTP request, 5xx, and payment-success baselines;
- current configuration and secret-reference revisions;
- change ID, approver, and planned observation window.

## Procedure

### 1. Confirm the current deployment

1. List stable and canary Deployments:

   ```powershell
   kubectl --namespace payments get deployment payments-api payments-api-canary -o wide
   ```

2. List pods with the labels used to separate telemetry:

   ```powershell
   kubectl --namespace payments get pods `
     -l app=payments-api `
     -L track,version `
     -o wide
   ```

3. Stop if the displayed image, labels, or stable replica health differs from
   the approved change record.

### 2. Apply the canary

1. Review the manifest and confirm it changes only the intended image,
   configuration, and canary replica count.
2. In an approved live environment, apply the reviewed manifest:

   ```powershell
   kubectl --namespace payments apply -f canary.yaml
   ```

3. During the first demo review, do not run this mutating command. Use recorded
   result `S01-canary-started`.

### 3. Verify Kubernetes rollout health

1. Wait for the named Deployment:

   ```powershell
   kubectl --namespace payments rollout status `
     deployment/payments-api-canary `
     --timeout=2m
   ```

2. Confirm desired replicas are ready and restarts are not increasing.
3. Review rollout history:

   ```powershell
   kubectl --namespace payments rollout history deployment/payments-api-canary
   ```

4. Stop and roll back on timeout, failed readiness, image-pull failure, or a
   sustained restart increase.

Validation record: `aks-rollout-status`.

### 4. Compare stable and canary behavior

Run this query only when collected pod metadata contains `track` labels:

```kusto
ContainerLogV2
| where TimeGenerated > ago(30m)
| where PodNamespace == "payments"
| extend Labels = KubernetesMetadata.podLabels
| extend Track = tostring(Labels["track"])
| where Track in ("stable", "canary")
| summarize
    LogLines=count(),
    Errors=countif(LogLevel in ("ERROR", "CRITICAL"))
    by Track, bin(TimeGenerated, 5m)
| extend ErrorPct=round(100.0 * Errors / LogLines, 2)
| order by TimeGenerated asc
```

This query compares log severity, not HTTP status. Pair it with the service's
HTTP and payment-success telemetry before deciding.

Validation record: `kql-canary-log-errors`.

### 5. Decide

1. Roll back if any stop condition is met.
2. Hold if evidence is missing or contradictory.
3. Promote only after all gates remain healthy for the approved observation
   window and the release owner records the decision.

For the recorded scenario, revision 2 sets the HTTP 5xx threshold to 1 percent.
The 1.4 percent canary result therefore requires rollback; revision 1's
2 percent threshold is stale.

## Verification

After promotion or rollback, verify:

1. all intended replicas are ready;
2. pod restarts are stable;
3. HTTP 5xx and payment-success metrics return to or remain within policy;
4. the serving image matches the decision; and
5. the change record contains the decision, evidence window, and operator.

The recorded successful rollback ends at HTTP 5xx of 0.2 percent and payment
success of 99.7 percent.

## Rollback or recovery

Roll back only the named Deployment revision:

```powershell
kubectl --namespace payments rollout undo `
  deployment/payments-api-canary `
  --to-revision=<known-good-revision>
```

Validation record: `aks-rollout-undo`.

This does not undo database, ConfigMap, Secret, or external-service changes.
Recover those through their own reviewed procedures. During the first demo
review, use recorded result `S01-rollback-completed` rather than executing the
command.

## Escalation

Escalate to `<release-owner>` when a promotion gate is ambiguous or the
known-good revision is unclear. Escalate persistent customer impact after
rollback to `<service-owner>`. Escalate security or secret-reference anomalies
to `<security-owner>`.

## References

- [AKS deployment quickstart](https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-cli)
- [AKS rollback strategies](https://learn.microsoft.com/en-us/azure/aks/kubernetes-migration-rollback-strategies)
- [ContainerLogV2 schema](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/containerlogv2)

