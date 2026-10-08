---
type: operational-guide
scenario_id: S02
title: "Post-deployment 5xx increase from a Key Vault reference failure"
status: synthetic-demo
revision: 1
source_document: ../docs/runbooks/02-key-vault-5xx.md
---

# Guide: Investigate post-deployment HTTP 5xx and Key Vault failures

## Purpose and scope

Use this guide when HTTP 5xx responses and unhealthy pods begin after an AKS
deployment and a Key Vault CSI or secret-reference problem is possible.

The goal is to distinguish workload failure, identity failure, missing or
disabled secret versions, and application defects without retrieving secret
values.

## Symptoms

- HTTP 5xx increases shortly after a deployment.
- New pods fail readiness while older pods remain healthy.
- Pods report mount or startup failures.
- Application logs report missing configuration or secret access errors.
- A deployment pins a specific Key Vault object version.

## Severity triage

| Condition | Demo severity | Immediate action |
| --- | --- | --- |
| More than 10 percent payment failure or all replicas unavailable | SEV-1 | Stop rollout and start rollback assessment |
| Partial availability with sustained HTTP 5xx above 1 percent | SEV-2 | Freeze promotion and investigate |
| Isolated pod failure with healthy capacity | SEV-3 | Replace or diagnose affected pod |

These severity definitions are synthetic demo policy.

## System overview

`payments-api` uses a managed identity and the Azure Key Vault provider for the
Secrets Store CSI Driver. A pod can fail even when identity authentication
succeeds if its `SecretProviderClass` references a missing, expired, or
disabled object version.

A Kubernetes Secret exists only when secret synchronization is configured and
a consuming pod mounts the volume. Its absence does not, by itself, prove a
Key Vault outage.

## Prerequisites

- AKS read access and Kubernetes RBAC for the workload namespace
- Permission to inspect `SecretProviderClass` resources and pod events
- Access to provider and CSI driver logs in `kube-system`
- Container Insights collecting `KubeEvents` and `ContainerLogV2`
- Exact deployment time and affected pod names
- A rule prohibiting secret-value output in the demo terminal

## Evidence to collect

Before mitigation, record:

- deployment version and start time;
- affected and healthy pod names;
- readiness failures and restart counts;
- `SecretProviderClass` name and object version references;
- mount events and provider error codes;
- managed identity authentication and authorization outcome;
- HTTP 5xx and payment-success rate.

Do not run `az keyvault secret show`; it returns the secret value.

## Procedure

### 1. Confirm timing and blast radius

1. Compare the deployment timestamp with the first HTTP 5xx alert.
2. Identify whether failures are limited to new pods or affect every replica.
3. Freeze promotion while evidence is incomplete.
4. If every replica is failing and rollback is known to be safe, prepare the
   rollback path in parallel with diagnosis.

### 2. Confirm the Key Vault provider configuration

Check the AKS add-on:

```powershell
az aks show `
  --resource-group <resource-group> `
  --name <cluster> `
  --query addonProfiles.azureKeyvaultSecretsProvider `
  --output json
```

Validation record: `aks-key-vault-addon-status`.

Inspect the workload without printing secret data:

```powershell
kubectl --namespace payments get pod <pod> -o wide
kubectl --namespace payments describe pod <pod>
kubectl --namespace payments get secretproviderclass
kubectl --namespace payments get secretproviderclass <name> -o yaml
```

### 3. Inspect pod events

```powershell
kubectl --namespace payments get events `
  --field-selector involvedObject.name=<pod> `
  --sort-by=.lastTimestamp
```

Validation record: `aks-pod-events`.

Look for `FailedMount`, missing `SecretProviderClass`, object-not-found,
disabled-version, authorization, DNS, or network evidence.

### 4. Query collected mount failures

```kusto
KubeEvents
| where TimeGenerated > ago(1h)
| where Namespace == "payments"
| where Reason == "FailedMount"
    or Message has_any (
        "SecretProviderClass",
        "secrets-store",
        "Key Vault",
        "secret not found"
    )
| project TimeGenerated, Namespace, Name, ObjectKind, Reason, Message
| order by TimeGenerated desc
```

Validation record: `kql-key-vault-failed-mounts`.

### 5. Query structured HTTP failures

Use this only when `LogMessage` contains structured JSON with one of the stated
status fields:

```kusto
ContainerLogV2
| where TimeGenerated > ago(1h)
| where PodNamespace == "payments"
| extend J=todynamic(LogMessage)
| extend Status=toint(coalesce(J.status, J.statusCode, J.http_status_code))
| where Status between (500 .. 599)
| summarize Responses5xx=count()
    by PodName, Status, bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

Validation record: `kql-container-http-5xx`.

### 6. Follow the decision path

1. If authentication fails, investigate workload identity assignment and token
   acquisition.
2. If authentication succeeds but Key Vault denies the operation, investigate
   authorization and object state.
3. If the referenced version is disabled or missing, compare it with the last
   known-good reference.
4. If mount and Key Vault operations succeed, return to application and image
   diagnosis.
5. Do not retain the initial image hypothesis after direct secret-version
   evidence disproves it.

In scenario `S02`, authentication succeeds and version `v17` is disabled. That
evidence corrects the initial bad-image hypothesis.

## Verification

After recovery, confirm:

1. all desired pods are ready;
2. mount failures stop;
3. the intended non-secret object version is referenced;
4. HTTP 5xx returns below 1 percent;
5. payment success returns above 99.5 percent; and
6. no secret value appeared in logs, terminal output, or incident notes.

## Rollback or recovery

The preferred recorded recovery updates the workload to active version `v18`
and restarts affected pods. This is a mutating operation and remains simulated
for the first review.

If the reference cannot be corrected safely, roll back the application to the
last known-good version. Do not enable an obsolete secret or weaken access
policy merely to restore service without security approval.

## Escalation

Escalate identity or Key Vault authorization problems to `<security-owner>`.
Escalate deployment rollback to `<release-owner>`. Escalate persistent 5xx
after secret recovery to `<service-owner>`.

## References

- [AKS Key Vault CSI troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/extensions/troubleshoot-key-vault-csi-secrets-store-csi-driver)
- [AKS Key Vault CSI provider](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-driver)
- [KubeEvents schema](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/kubeevents)

