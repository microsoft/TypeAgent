<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# Local Telemetry Debugging

Use this guide to inspect one TypeAgent request in local JSONL logs and
Grafana. It covers the current developer workflow. For telemetry design and
instrumentation contracts, see [OpenTelemetry in TypeAgent](./opentelemetry.md).

## Before You Start

You need:

- A configured TypeAgent checkout.
- Docker Desktop or Docker Engine.
- Ports `3000`, `4317`, and `4318` available on localhost.

If this is a fresh checkout, run the workspace setup from `ts`:

```powershell
pnpm run setup
```

Check that Docker is running:

```powershell
docker version
```

## 1. Start the Local Telemetry Stack

From `ts`, run:

```powershell
pnpm run telemetry:grafana
```

The command starts the local Grafana LGTM container. It includes Grafana,
Loki, Tempo, Prometheus, and an OpenTelemetry collector.

Once Grafana reports healthy, the command also enables the local sink in
`config.local.yaml` — no `OTEL_*` / `TYPEAGENT_OTEL_*` environment variables
are required. The block it writes looks like this (custom values you had are
preserved):

```yaml
telemetry:
  local:
    enabled: "true"
    otlpEndpoint: http://localhost:4318
    logFile: ~/.typeagent/logs/{process}-{timestamp}-p{pid}.jsonl
    debugBridge: "true"
    structuredLogs: "true"
```

The local sink is additive: if you already have a standard OTLP backend
configured in `telemetry.otlpEndpoint`, TypeAgent exports to both the
standard backend and the local Grafana LGTM stack in parallel (deduplicated
when they resolve to the same URL).

> TypeAgent reads `config.local.yaml` at process startup, so **restart the
> agent-server after enabling the local sink** — otherwise the running
> process will not pick up the new configuration.

Open Grafana at [http://localhost:3000](http://localhost:3000).

Check that Grafana is ready:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

The response should report that the database is `ok`.

## 2. Start TypeAgent with Telemetry

Open another PowerShell terminal in `ts`:

```powershell
pnpm run build agent-server

# The local sink (endpoint, JSONL log file, debug bridge, structured logs) is
# already provisioned by `pnpm run telemetry:grafana` — no OTEL_* / TYPEAGENT_*
# environment variables are required. Only DEBUG is still needed so the
# TypeAgent debug modules the bridge forwards from actually emit anything.
$env:DEBUG = "typeagent:*,agent-server:*"

pnpm run start:agent-server
```

To override the service name from the shell, set `OTEL_SERVICE_NAME`
(`typeagent` is the default). Any `OTEL_*` / `TYPEAGENT_OTEL_*` value set in
the environment still wins over the YAML — for example, set
`OTEL_EXPORTER_OTLP_ENDPOINT` to point at a shared backend and the local
sink will run alongside it as an additional exporter.

The JSONL filename identifies the process and run:

```text
agent-server-20260818T194041Z-p14952.jsonl
```

The timestamp is the process start time in UTC. The PID prevents two processes
started at the same time from using the same file. The OTel records still
contain `service.name`; it is not repeated in the filename.

## 3. Send a Request

Open a third terminal in `ts` and connect the CLI:

```powershell
pnpm cli
```

Send a normal TypeAgent request. Wait a few seconds for telemetry batches to
reach Grafana.

## 4. Inspect the Local JSONL Log

Find the latest agent-server log:

```powershell
$log = Get-ChildItem "$HOME\.typeagent\logs\agent-server-*.jsonl" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$log.FullName
Get-Content $log.FullName -Wait
```

Useful fields include:

| Field       | Meaning                                  |
| ----------- | ---------------------------------------- |
| `traceId`   | The OTel trace containing the request    |
| `spanId`    | The span active when the log was written |
| `requestId` | TypeAgent's request identifier           |
| `event`     | The structured event name                |
| `message`   | A short, content-safe description        |

Press `Ctrl+C` to stop following the file.

## 5. Find the Trace

The easiest lookup key is the trace ID. Copy it from:

- A JSONL record for the request.
- A correlated Loki log entry.
- The request metrics hover in the VS Code client.

In Grafana:

1. Open **Explore**.
2. Select the **Tempo** data source.
3. Search for the trace ID.

If you do not have the trace ID, search for service
`typeagent-local` and narrow the time range to when you sent the request.

## 6. Read the Trace

A request may contain these spans:

| Span                    | What it shows                 |
| ----------------------- | ----------------------------- |
| `typeagent.request`     | The complete request          |
| `typeagent.translation` | Request-to-action translation |
| `typeagent.reasoning`   | Reasoning or tool selection   |
| `typeagent.action`      | Action execution              |
| `typeagent.llm`         | One model call                |

Select a slow or failed span first. Then inspect its attributes and events.

### LLM Classification

Each supported `typeagent.llm` span has three classification attributes:

| Attribute               | Meaning                                | Example            |
| ----------------------- | -------------------------------------- | ------------------ |
| `typeagent.llm.phase`   | The lifecycle stage that owns the call | `translation`      |
| `typeagent.llm.purpose` | Why the model was called               | `schema-selection` |
| `typeagent.llm.scope`   | Whether the request waits for it       | `foreground`       |

Calls made outside a classified operation use `unclassified` for all three
values and include a `typeagent.llm.classification.missing` span event. Treat
this as an instrumentation defect. It is visible for debugging but does not
stop the model request.

Nested operations can change the purpose while keeping the phase and scope
from their high-level operation. For example, parallel schema selection runs
inside the foreground translation phase.

## 7. Inspect Logs in Grafana

In Grafana **Explore**, choose **Loki** and use Code mode:

```logql
{service_name="typeagent-local"}
```

To find logs for one trace, use its trace ID:

```logql
{service_name="typeagent-local"} | trace_id = "<trace-id>"
```

Expand a result to inspect its `span_id`, event, severity, and attributes.

### Current "Logs for this span" Limitation

The Tempo **Logs for this span** button may currently generate a query that
contains only `trace_id`. Such a query shows logs for the entire trace, not
only the selected span.

Check the generated Loki query. If it does not contain `span_id`, add the
selected span ID:

```logql
{service_name="typeagent-local"}
| trace_id = "<trace-id>"
| span_id = "<span-id>"
```

An exact-span query can correctly return no results when that span did not
emit any logs.

## 8. Stop Everything

Stop the agent server with `Ctrl+C` first. This lets TypeAgent flush pending
telemetry.

Then stop the local stack:

```powershell
pnpm run telemetry:grafana --stop
```

`--stop` also flips `telemetry.local.enabled` to `"false"` in
`config.local.yaml` (custom local values are preserved for the next start).

## Log Retention and Manual Cleanup

TypeAgent runs a **best-effort** retention cleanup once at telemetry
startup. It enumerates `.jsonl` files in the log file's parent directory
(non-recursive) and, when the total exceeds `telemetry.logRetentionBytes`,
deletes the oldest inactive files first until the total is at or below
the cap.

- Default cap: **524288000 bytes (500 MiB)**.
- Set `telemetry.logRetentionBytes` (or `telemetry.local.logRetentionBytes`
  in the local block) in `config.local.yaml` to change the cap.
- Env override: `TYPEAGENT_OTEL_LOG_RETENTION_BYTES`.
- Set the value to `0` to disable automatic cleanup.
- The active log file and any file currently open by another
  `JsonlLogExporter` in **this** process are always protected.
- Files open in **other** processes are not tracked directly. Cleanup
  simply calls `unlink`; on Windows the OS typically refuses to delete a
  file another process still has open, and that failure is reported to
  stderr and skipped. On POSIX, `unlink` usually succeeds even against a
  peer's open handle (the peer keeps writing until it closes the file).
  This is best-effort — there is no cross-process lock — so a peer's log
  may occasionally be reclaimed on POSIX if it happens to be the oldest
  inactive file.
- Any unlink failure (Windows lock, permission error, etc.) is reported
  once to stderr and never fails telemetry startup. Whatever remains
  above the cap is surfaced in the final diagnostic so an operator can
  raise the limit, close peer processes, or delete files by hand.

To review the files yourself:

```powershell
Get-ChildItem "$HOME\.typeagent\logs\*.jsonl" |
  Sort-Object LastWriteTime -Descending
```

For example, after reviewing the list, remove one specific file:

```powershell
Remove-Item "$HOME\.typeagent\logs\agent-server-20260818T194041Z-p14952.jsonl"
```

Stopping or recreating the Grafana container does not delete these JSONL
files.

## Troubleshooting

### Grafana Does Not Open

Run:

```powershell
docker ps --filter "name=typeagent-otel"
Invoke-RestMethod http://localhost:3000/api/health
```

If Docker is stopped, start it and run `pnpm run telemetry:grafana` again.

### No Traces Appear

Check that:

- `pnpm run telemetry:grafana` completed successfully and printed
  `Enabled telemetry.local in ...config.local.yaml`.
- `config.local.yaml` contains `telemetry.local.enabled: "true"` (the value
  must be the string `"true"`, not the YAML boolean `true`).
- The agent server was restarted **after** the sink was enabled — config is
  read at process startup.
- Nothing in the environment sets `OTEL_TRACES_EXPORTER=none` for the shell
  that started the agent server (that explicitly opts out of the traces
  signal even when the local sink is enabled).
- The Grafana time range covers the request.

### Traces Appear but Logs Do Not

Check that `telemetry.local.structuredLogs` is `true` in `config.local.yaml`
(this is the default when the local sink is enabled) or that
`TYPEAGENT_OTEL_STRUCTURED_LOGS=true` is set in the shell that started the
agent server. In Loki, start with:

```logql
{service_name="typeagent-local"}
```

Widen the time range before adding more filters.

### "Logs for this span" Shows Unrelated Logs

Inspect the generated query. Add `span_id` as shown in the current limitation
section when the query filters only by trace ID.

### An LLM Span Is Unclassified

Look for the `typeagent.llm.classification.missing` span event. The model was
called outside a translation, reasoning, action, or explanation telemetry
context. Fix the high-level caller rather than assigning a guessed
classification in the model wrapper.

### No JSONL File Appears

Check that `telemetry.local.logFile` (or the standard `telemetry.logFile` /
`TYPEAGENT_OTEL_LOG_FILE` when you override it) is set to a path the process
can write to.
Also check the startup diagnostics for the resolved path or a file permission
error.

## Working Setup Checklist

The local flow is working when:

- Grafana health reports `ok`.
- A request produces a trace in Tempo.
- The trace contains the expected request and child spans.
- LLM spans have meaningful phase, purpose, and scope values.
- JSONL records contain trace and span IDs that match Grafana.
- A Loki query with both IDs returns logs only for the selected span.
