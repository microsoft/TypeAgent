---
type: operational-guide
scenario_id: S05
title: "IR-7421 security incident reconstruction and handoff"
status: synthetic-demo
revision: 1
source_document: ../docs/runbooks/05-ir-7421-handoff.md
---

# Guide: Investigate and hand off an identity-to-build-system incident

## Purpose and scope

Use this guide to investigate suspected identity compromise that reaches a
build runner and cloud resources, then produce an evidence-based handoff for a
new analyst.

The `IR-7421` names and indicators are synthetic. This guide demonstrates
evidence preservation, hypothesis correction, containment boundaries, and
cross-session memory. It does not replace an organization's approved security
incident-response plan.

## Symptoms

- Password spray or anomalous legacy authentication
- Service account sign-in from an unexpected address or host
- Encoded PowerShell or unapproved download on a build runner
- Periodic outbound callbacks
- Key Vault list or read activity
- Release-integrity mismatch

## Severity triage

Treat the incident as at least synthetic SEV-2 when a service identity is
compromised and execution occurs on a build host. Raise to synthetic SEV-1 if
evidence confirms signing-key retrieval or use, malicious artifact publication,
broad customer impact, or uncontrolled persistence.

Do not raise severity based solely on an unconfirmed digest mismatch.

## System overview

`svc-build` normally runs only from `build-runner-03`. The runner participates
in the deployment path and can reach selected Azure resources. Key Vault audit
evidence must distinguish listing metadata from retrieving a secret value or
performing a signing operation.

The investigation keeps confirmed facts, hypotheses, corrections, actions, and
decisions separate.

## Prerequisites

- Incident commander and security owner assigned
- Exact UTC investigation window
- Entra sign-in logs routed to Log Analytics
- Key Vault diagnostic settings populating `AZKVAuditLogs`
- Endpoint and proxy evidence
- Authority to inspect identity and Azure RBAC metadata
- Approved containment procedure

Risk detail can appear as `hidden` without the applicable Microsoft Entra ID
licensing.

## Evidence to collect

Preserve before containment when safe:

- source address, targeted identities, and successful sign-ins;
- authentication protocol, MFA state, application, and correlation ID;
- endpoint process tree, script hash, and download destination;
- outbound destination, port, interval, and first-seen time;
- Key Vault operation type and whether a value was returned;
- build and release-integrity results;
- every containment approval and observed result.

## Procedure

### 1. Bound the incident

1. Record the incident ID and UTC start and end times.
2. Identify the affected identity, normal execution host, and anomalous source.
3. Preserve raw evidence references before changing identity or host state.
4. Start a timeline that distinguishes observed time from recorded time.

### 2. Investigate Entra sign-ins

```kusto
SigninLogs
| where TimeGenerated between (
    datetime(<start-utc>) .. datetime(<end-utc>)
  )
| where UserPrincipalName =~ "<upn>"
    or IPAddress == "<suspicious-ip>"
| project
    TimeGenerated,
    UserPrincipalName,
    ServicePrincipalName,
    IPAddress,
    AppDisplayName,
    ResultType,
    ResultDescription,
    RiskLevelDuringSignIn,
    RiskState,
    CorrelationId
| order by TimeGenerated asc
```

Validation record: `kql-entra-signins`.

Confirm whether the event is a user or service-principal sign-in before drawing
identity conclusions.

### 3. Correlate endpoint and network execution

1. Build the parent-child process timeline.
2. Record the full script hash when available; use the fixture prefix only for
   the demo.
3. Correlate the first callback with script execution time.
4. Determine whether the callback stopped after containment.

For `IR-7421`, `w3wp.exe` launches encoded PowerShell, downloads `update.ps1`,
and the host begins 60-second callbacks to reserved address `198.51.100.24`.

### 4. Investigate Key Vault operations

List metadata without retrieving individual secret values:

```powershell
az keyvault secret list `
  --vault-name <vault> `
  --query '[].{name:name,enabled:attributes.enabled,updated:attributes.updated}' `
  --output table
```

Validation record: `key-vault-secret-metadata`.

Query audit operations:

```kusto
AZKVAuditLogs
| where TimeGenerated between (
    datetime(<start-utc>) .. datetime(<end-utc>)
  )
| where CallerIpAddress == "<suspicious-ip>"
    or tostring(Identity) has "<principal-id-or-upn>"
| project
    TimeGenerated,
    OperationName,
    Id,
    CallerIpAddress,
    Identity,
    HttpStatusCode,
    IsRbacAuthorized,
    ResultType,
    CorrelationId
| order by TimeGenerated asc
```

Validation record: `kql-key-vault-audit`.

Do not use `az keyvault secret show` in a shared terminal; it returns the
secret value.

### 5. Classify the artifact-integrity finding

1. Record a digest mismatch as a hypothesis.
2. Check verifier cache state, source manifest, signing logs, and artifact
   provenance.
3. Do not claim signing-key abuse without a secret-value read, signing
   operation, or other direct evidence.
4. Preserve both the hypothesis and any later correction.

In `IR-7421`, forensic validation identifies a stale verifier cache and confirms
that no signing key was retrieved or used.

### 6. Contain through approved procedures

Potential containment actions include:

- isolate the affected host;
- revoke active identity sessions;
- rotate the compromised credential;
- block or sinkhole the callback destination; and
- suspend affected deployment paths.

Session revocation is mutating:

```powershell
az rest `
  --method POST `
  --uri "https://graph.microsoft.com/v1.0/users/<user-id>/revokeSignInSessions"
```

Validation record: `entra-revoke-sessions`.

Disabling an identity and revoking sessions are separate actions. Revocation
propagation is not immediate. The first review uses recorded containment
`S05-containment`; it does not execute these changes.

### 7. Produce the handoff

Include:

1. exact UTC timeline;
2. confirmed initial access;
3. affected identity and host;
4. execution and command-and-control indicators;
5. cloud operations and their actual impact;
6. open hypotheses and confidence;
7. corrected false leads;
8. containment actions and observed results; and
9. prioritized next actions.

## Verification

The handoff is complete when it includes:

- `svc-build`;
- `build-runner-03`;
- password spray source `203.0.113.77`;
- command-and-control address `198.51.100.24`;
- Key Vault list activity without a secret-value read;
- completed containment;
- stale verifier cache correction; and
- an explicit statement that no signing key was retrieved or used.

Every conclusion must cite a source or fixture record.

## Rollback or recovery

Do not restore the identity or host merely because callbacks stopped. Recovery
requires credential rotation, host reimage or trusted rebuild, persistence
review, release-integrity verification, and explicit security approval.

If memory retrieval is incomplete during the demo, do not paste missing
indicators into the fresh chat. Verify Memory Hub import and the GitHub Copilot
CLI memory connection, then start a new session.

## Escalation

Escalate confirmed signing-key access, malicious release publication, or
uncontrolled persistence to `<security-owner>` immediately. Escalate memory
retrieval failures to `<demo-owner>`. Use the organization's real incident
response and legal/compliance processes outside this synthetic fixture.

## References

- [Analyze Entra activity logs](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-analyze-activity-logs-log-analytics)
- [SigninLogs schema](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/signinlogs)
- [Key Vault logging](https://learn.microsoft.com/en-us/azure/key-vault/general/howto-logging)
- [AZKVAuditLogs schema](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/azkvauditlogs)

