# PowerShell MXC Experiment

Isolated, Windows-only measurement harness. Production broker, script host,
approval UI, and TypeScript routing are unchanged. The project links the existing
broker's protocol and native launcher source and pins `Microsoft.Mxc.Sdk` 1.0.0
with a NuGet lock file. This is not a production execution adapter.

## Run

From the TypeAgent repository root in PowerShell, with .NET 8 runtime and a
compatible SDK installed:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
dotnet restore dotnet/powerShellSandboxBroker.Experiment --locked-mode
dotnet run --project dotnet/powerShellSandboxBroker.Experiment -c Release -- --probe
dotnet run --project dotnet/powerShellSandboxBroker.Experiment -c Release -- --check dotnet/powerShellSandboxBroker.Experiment/results/new-check
dotnet run --project dotnet/powerShellSandboxBroker.Experiment -c Release -- --run dotnet/powerShellSandboxBroker.Experiment/results/new-run
```

Each evidence directory must be new. `--run` checks correctness before timing.
Required failures stop timing; the separate module/cwd compatibility failure is
recorded as an adoption blocker, not silently converted into a fast sample.
No elevation, security-setting changes, ACL augmentation, permissive learning
mode, or unrestricted fallback is performed. Only synthetic trusted fixtures run.

## Routes And Policy

- H: existing v2 approved-local launcher, FullLanguage, current-user privileges.
- A: existing v1 restricted AppContainer launcher, AST checks, ConstrainedLanguage.
- M: MXC ProcessContainer with the same host, AST checks and ConstrainedLanguage.

M grants read-only access to its staged host/request, System32 and Microsoft.NET
runtime directories, and read-write access only to fresh scratch. It denies
ingress, egress and host loopback and supplies a minimal environment. DACL
augmentation is rejected. Windows PowerShell requires Win32k during startup:
`Ui.Disable=false` is explicit, with clipboard, input, external-handle, atom,
desktop, system-setting and IME restrictions retained. Those UI protections are
requested and probed, not individually attack-tested.

H is not security-equivalent to A/M. A also limits the job to one process,
whereas M allows descendants within its kill-on-close job. Filesystem staging,
environment and startup differ, so these are end-to-end route costs, not
isolated native MXC overhead.

## Measurements

`--run` records 10 process-cold samples, 5 excluded warm-ups and 100 warm samples
per route/fixture, serially interleaved with seed 20261013. Cold means a fresh
harness process and child, not an OS/cache reset. Warm retains the harness but
launches a fresh child every time. The four fixtures are minimal output, JSON
transform, a bounded CPU loop and literal typed parameters. Capture off/on is a
separate 100-pair minimal-fixture variant after 5 excluded warm-up pairs.

Warm total covers protocol validation/serialization through exact result
validation and cleanup. Cold additionally includes parent launch, harness
startup, sample serialization and parent parsing. Preparation/launch,
execution/drain and cleanup are coarse measured intervals; host-ready and script
body are not separately instrumented. No model calls, service latency or human
approval time is measured. Quantiles use linear interpolation; paired p05/p95
describe observed spread, not confidence intervals.

Evidence includes metadata and artifact hashes, raw JSONL samples, correctness
outcomes, route summaries, paired deltas and optional block-mode denial capture.
Results are ignored here; the retained run is archived with the research in
[codeDocs](../../../codeDocs/TypeAgent/forAgent/investigations/completed/2026/2026-10-13_execution-containment/powershell-experiment.md#executed-results).

## First Run

Windows 25H2 26200.9457, x64, non-elevated, .NET SDK 10.0.402/runtime 8.0.32,
MXC native 1.0.0, selected tier BaseContainer without warnings or DACL changes.
The run began October 14 UTC (October 13 local).

Warm latency in milliseconds, p50 / p95, 100 samples per cell:

| Fixture | H | A | M | M-H p50 | M-A p50 |
|---|---|---|---|---|---|
| Minimal | 554.6 / 568.6 | 558.4 / 563.8 | 640.9 / 648.6 | +86.2 (+15.5%) | +82.4 (+14.8%) |
| JSON | 565.2 / 575.8 | 570.0 / 575.9 | 637.4 / 648.1 | +72.2 (+12.8%) | +67.4 (+11.8%) |
| CPU | 603.5 / 615.9 | 619.6 / 625.1 | 700.4 / 710.1 | +96.9 (+16.1%) | +80.8 (+13.0%) |
| Typed | 560.9 / 570.5 | 565.8 / 571.7 | 638.8 / 651.6 | +78.0 (+13.9%) | +73.0 (+12.9%) |

Process-cold MXC p50 added 174-183 ms versus A and 180-203 ms versus H.
Enforcing denial capture added 335.7 ms (+52.5%) at p50 and 326.8 ms (+46.5%)
at p95 against its interleaved capture-off control.

All 1,590 timing/warm-up samples were valid. 29 mandatory checks passed. The
approved-module/cwd variant failed inside PowerShell `SetLocation` path
normalization under the narrow filesystem grants. Do not grant an entire drive
or user profile merely to make this pass. Enumeration-only policy is unsupported
on this build and is correctly rejected.

First-run decision: optimize/retest, not production adoption. FullLanguage/cwd
compatibility, explicit latency budgets, production approval binding and
packaging remain acceptance work. Cancellation was tested during startup;
mid-body/descendant cancellation, external network allow/deny rules, direct UI
attacks, concurrency, memory/CPU limits and cross-platform execution were not
measured. This experiment does not reduce the intended host-capability design
to an offline-only product.

## Remediation Follow-Up

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
dotnet run --project dotnet/powerShellSandboxBroker.Experiment -c Release -- --compatibility dotnet/powerShellSandboxBroker.Experiment/results/new-compatibility
dotnet run --project dotnet/powerShellSandboxBroker.Experiment -c Release -- --compatibility-staged dotnet/powerShellSandboxBroker.Experiment/results/new-staged-compatibility
dotnet run --project dotnet/powerShellSandboxBroker.Experiment -c Release -- --verify-adoption dotnet/powerShellSandboxBroker.Experiment/results/new-adoption-verification
```

Compatibility modes isolate native cwd/reads, physical provider cwd, RO module
import and a temporary rooted PSDrive. `--compatibility-staged` uses a fresh
owned directory directly below the current volume root, never granting the
root itself. Both modes remove their staging and retain negative canaries.
Exit 0 denotes mandatory probe integrity, not adoption; physical provider-cwd
and PSDrive contract failures remain separately visible in checks.

`--verify-adoption` tests owned outside-container window/atom denial and
cancellation after both root and a live identified descendant enter their
bodies. It deliberately exits 1 while full UI assurance remains unverified.
The tree-kill job's UI mask is not an effective BaseContainer PSEC-policy query.
No user clipboard, input, settings or session is mutated.

`--published-smoke` uses the production broker's source-generated response
serializer and can run from x64 self-contained/full-trim/single-file publish
output. It requires exact output, BaseContainer, no warnings and scratch cleanup.
It is not a production IPC adapter; other diagnostic/reporting modes still
have trim warnings. ARM64 execution and installation verification remain open.

Follow-up decision: **NO-GO for the current Windows PowerShell deployment**.
Module import, mid-body tree cancellation, x64 packaged smoke and clean-output
regressions pass; narrow-grant physical cwd parity and full UI assurance do not.
Production host, routing, approval and security settings remain unchanged.
Full outcomes and immutable evidence are in the
[remediation report](../../../codeDocs/TypeAgent/forAgent/investigations/completed/2026/2026-10-13_execution-containment/powershell-run-results.md#executed-remediation-and-decision).
