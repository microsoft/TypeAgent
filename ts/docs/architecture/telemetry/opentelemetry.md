<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# OpenTelemetry in TypeAgent

**Status:** Settled design; implementation is landing in phases

**Area:** `@typeagent/telemetry`, `aiclient`, dispatcher, RPC, and TypeAgent-owned Node hosts

**Scope:** Node-hosted traces, logs, metrics, context propagation, and local telemetry files

## Value Proposition

OpenTelemetry gives TypeAgent one structured view of a request across
translation, LLM calls, action execution, agents, and RPC.

- **Developers** can diagnose latency and failures with correlated traces and
  logs, including an opt-in local JSONL log that needs no collector.
- **Operators** can export the same signals to any OTLP-compatible platform for
  dashboards and alerts.
- **Partners** can use TypeAgent instrumentation with their existing OTel
  providers, exporters, sampling, resources, and governance.

One instrumentation model serves local debugging, production operations, and
embedded TypeAgent libraries.

## Goals

- Instrument the core request path with traces, logs, and metrics.
- Preserve existing `debug`, Structured Logger, database, and `@trace` behavior.
- Propagate context across RPC without leaking private correlation data.
- Support local capture, OTLP export, partner hosts, privacy, and failure isolation.

## Non-Goals

- Selecting a vendor, collector topology, dashboards, or alerts.
- Replacing `debug`, Structured Logger, database sinks, or `@trace`.
- Browser telemetry or HTTP/`undici` auto-instrumentation in v1.
- A custom trace or metric file format.
- Managing local file rotation, retention, archival, or deletion.

## Current State

| Concern               | Existing mechanism                                 | OTel integration            |
| --------------------- | -------------------------------------------------- | --------------------------- |
| Developer tracing     | `debug` namespaces and `@trace`                    | Optional OTel log copies    |
| Application events    | `Logger`, `LoggerSink`, `MultiSinkLogger`          | `OtelLoggerSink`            |
| Correlation           | `traceId`, `sessionId`, `activationId`, `hostName` | Attributes and RPC metadata |
| LLM usage             | `TokenCounter`, completion callbacks               | Token metrics and LLM spans |
| Timing                | `RequestMetricsManager`, profiler, `StopWatch`     | Duration metrics and spans  |
| Redaction             | `filterSecrets`, object filters, `SecretFilter`    | Filter before recording     |
| Cross-process tracing | Debug namespace fan-out                            | W3C context in RPC metadata |

The design extends these seams instead of creating a separate telemetry system.

## Design Overview

```text
debug("typeagent:*") ─► stderr / CLI panel
         └─► optional bridge ───────────────────┐
Structured Logger ─► OtelLoggerSink ───────────┴─► OTel Logs API
                                                     ├─► OTLP logs
                                                     └─► local JSONL exporter

TokenCounter / timings ─► OTel Metrics API ─────────► OTLP metrics

core operation boundaries ─► OTel Trace API ───────► OTLP traces

RPC metadata ◄─ traceparent + TypeAgent correlation fields ─►
```

OTLP and local JSONL are independent and may be enabled together. The local file
contains OTel logs only. Traces and metrics use OTLP.

Instrumentation is compiled in but collection is disabled until configured.
TypeAgent-owned hosts create only the providers needed for enabled signals. A
logs-only configuration does not create trace or metric pipelines.

Trace and metric call sites use `@opentelemetry/api`. Log adapters use the
separate `@opentelemetry/api-logs` API. `@typeagent/telemetry` owns host
bootstrap, configuration, resources, redaction, the debug bridge, and
`OtelLoggerSink`. It does not wrap or re-export OTel tracers, meters, or spans.

```ts
initTelemetry(options?): Promise<void>;
shutdownTelemetry(): Promise<void>;
createOtelLoggerSink(): LoggerSink;
```

There is no `TypeAgentSpan` or custom telemetry API.

## Ownership and Partner Integration

**TypeAgent instrumentation works out of the box with an OTel-enabled host;
optional log integrations require one-time explicit wiring.**

Embeddable libraries use the host's global tracer and meter providers. They join
active context and follow host sampling, resources, and export policy. Without
providers, their trace and metric calls no-op. They never initialize or replace
global providers.

Logs require explicit composition:

- Attach `OtelLoggerSink` to the relevant TypeAgent logger to export Structured
  Logger events.
- Install the debug bridge to copy enabled TypeAgent debug output.
- Installing an OTel SDK alone does neither.

TypeAgent-owned Node composition roots attach `OtelLoggerSink` alongside the
existing debug and database sinks when `telemetry.structuredLogs` is enabled.
The setting defaults to false so embedded dispatcher consumers do not export
event payloads merely because another component installed a global OTel logs
provider. The environment override is
`TYPEAGENT_OTEL_STRUCTURED_LOGS=true`. Hosts also pass each process's `debug`
module instance to `initTelemetry()` so the optional bridge can preserve
existing output while copying eligible records into OTel.

The dispatcher prompt logger is intentionally not connected to
`OtelLoggerSink`, and its debug namespace remains excluded from the bridge.
Prompt capture requires a separate explicit privacy-reviewed design.

The sink emits through the host's global Logs API and does not create a provider.
Embeddable libraries never install a process-wide debug hook. A partner may
install the adapter at its composition root and identify each `debug` module
instance it wants covered.

TypeAgent-owned Node hosts call `initTelemetry()` once and
`shutdownTelemetry()` on exit. Each process installs at most one global provider
per enabled signal and exports directly. Libraries, agents, requests, and
sessions do not create providers.

The bridge includes `typeagent:*` namespaces by default. TypeAgent-owned hosts
may explicitly include a stable legacy prefix that they own. Agent server hosts
include `agent-server:*` this way rather than renaming existing namespaces and
breaking current `DEBUG` configurations.

Global provider registration is first-writer-wins. TypeAgent bootstrap runs
before instrumentation and reports an unexpected existing provider as a
configuration conflict. Shutdown is idempotent but does not make telemetry
restartable or replace host globals.

Each subprocess extracts RPC context, creates child spans with its own provider,
and exports independently. Telemetry payloads do not pass through the dispatcher.

## Signals

| Signal                   | Purpose                            | Producer                          | Output                  |
| ------------------------ | ---------------------------------- | --------------------------------- | ----------------------- |
| Debug output             | Immediate developer view           | `debug(...)`                      | stderr or CLI panel     |
| Structured Logger events | Stable application events          | `logger.logEvent(...)`            | Existing sinks          |
| OTel logs                | Correlated, processable records    | Debug bridge and `OtelLoggerSink` | OTLP and/or local JSONL |
| Traces                   | Request flow, timing, and failures | Manual spans                      | OTLP                    |
| Metrics                  | Aggregate usage and latency        | Existing counters and timers      | OTLP                    |

**Debug is the immediate developer view; OTel logs are the correlated,
processable telemetry record.**

### Traces

- Add manual spans at command/request, translation, reasoning, action execution,
  LLM, and RPC client/server boundaries.
- Record exceptions and error status, including failures converted to
  `ActionResult`.
- Use span events only for meaningful milestones or failures. Do not copy normal
  debug messages into span events.
- Use manual LLM spans in v1. Do not enable HTTP or `undici`
  auto-instrumentation.

### Logs

The two existing producer APIs remain unchanged. The downstream OTel pipeline
unifies their records and supplies trace correlation, redaction, batching, and
export.

`OtelLoggerSink` preserves each redacted, JSON-compatible `LogEvent.event` as the
OTel body. It adds `eventName` and allowlisted scalar correlation attributes,
but excludes nested or unbounded attributes. Existing debug and database sinks
remain attached.

The Structured Logger `Logger.logEvent(eventName, entry, severity?)` contract
carries an optional severity of `info`, `warning`, or `error`. `OtelLoggerSink`
maps these onto the standard OTel severity buckets (`INFO`, `WARN`, `ERROR`);
`undefined` defaults to `INFO`. The sink never infers severity from the event
name or the event payload - the caller is the only signal.

Before emit, the sink snapshots `LogEvent.event` with three bounds so a
misbehaving producer cannot hang or overflow the telemetry path:

- **Depth** is a deterministic hard cap (currently 32). Nodes at depths 0
  through 31 are preserved; a node at depth 32 is replaced with a truncation
  marker.
- **Cycles** are broken by a WeakSet-tracked visited path. A repeat visit within
  the same recursion becomes a `cycle` truncation marker.
- **Allocation size** has an approximate cap (currently 60 KiB, measured in
  UTF-16 code units as the walker descends). When the next value would exceed
  the cap, that value and subsequent subtrees are replaced with a `size`
  truncation marker.
- **Serialized size** has a hard cap (currently 64 KiB of UTF-8 JSON after
  redaction). If the final body exceeds the cap or cannot be serialized, the
  complete body is replaced with a root-level `size` marker.

A truncated subtree is
`{"__typeagent_otel_truncated": "depth" | "cycle" | "size" | "unsupported"}`.
The `unsupported` marker replaces values outside the Structured Logger's
JSON-compatible contract. The sink always prefers a bounded/truncated body over
dropping the whole record.

The OTel event name and each promoted correlation value are limited to 256
Unicode code points. An oversized event name becomes a fixed marker, and an
oversized correlation value is omitted. The sink does not retain a prefix:
partial truncation could expose part of a secret that the complete value would
have matched. Redaction runs only after this bound and the result must also fit.

The dispatcher places an allowlisted projection in front of `OtelLoggerSink`.
Only bounded correlation identifiers, agent/schema/action names, state and
reason fields, durations and counts, booleans, and command/schema-name arrays
reach OTel. Prompt and response text, history, action parameters, errors and
stacks, feedback comments and context, and all unknown fields are excluded.
Other producers that attach `OtelLoggerSink` remain responsible for an
equivalent source-specific projection. The sink applies known-secret and
secret-format filtering as defense in depth, covering the promoted correlation
attributes and every string reachable in the projected body.

The local JSONL exporter restricts each file, and any leaf directory it creates,
to the current user before writing log content. It enforces `0700`/`0600` modes
on POSIX and replaces inherited Windows ACLs with current-user-only access. It
does not change an existing parent directory's permissions. If the file or a
new directory cannot be secured, the export fails closed and reports a
content-free diagnostic.

Emit failures are isolated: the sink drops the OTel record and never re-enters
the `MultiSinkLogger` fan-out. A rate-limited diagnostic writes directly to
stderr (or an injected non-recursive callback) without including event content.

The debug bridge tees enabled `typeagent:*` calls into OTel without changing
their original output:

- Preserve `DEBUG`, `@trace`, stderr, colors, timestamps, and CLI interception.
- Call the exact prior `debug.log` implementation, and restore it on shutdown
  only while the bridge still owns it.
- Derive the namespace from the debug instance; capture arguments before
  `debug` adds timestamps, namespace prefixes, colors, and elapsed time, then
  render the OTel body separately without ANSI codes.
- Cover each known distinct `debug` module instance. One hook is not assumed to
  cover the process.
- Install idempotently, avoid wrapping an instance twice, and use reentrancy and
  OTel suppression guards.
- Exclude `typeagent:logger:*`, bridge diagnostics, and
  `typeagent:telemetry:promptLogger` to prevent duplicates or recursion.
- Allow `TYPEAGENT_OTEL_DEBUG_BRIDGE=off` to stop copying without disabling
  normal debug output.

Only enabled debug namespaces are copied. Bridged logs are independent of trace
sampling, so a log may name a trace the backend did not retain.

Do not emit both `debug()` and `logEvent()` for the same fact.

JavaScript logs use the experimental `@opentelemetry/api-logs` and
`@opentelemetry/sdk-logs` packages. Pin and review a mutually compatible OTel
Logs, Node SDK, and GenAI convention set rather than upgrading them independently.

### Metrics

- Feed token usage from `TokenCounter`.
- Feed request and phase durations from `RequestMetricsManager` and profiler
  timing.
- Use stable dimensions such as model, agent, operation, status, and token type.
- Never use session, trace, or activation IDs, user text, or other unbounded
  values as metric attributes.

Use reviewed GenAI semantic conventions and schema URLs. If names are unstable,
use documented `typeagent.*` instruments instead.

## Context and Attributes

Inject W3C `traceparent` into a dedicated TypeAgent RPC metadata envelope.
Receivers validate and extract it before handling the operation.
Outbound injection and inbound extraction are separate explicit channel
policies. TypeAgent-owned composition roots enable both only for approved
destinations and trusted transports; a globally configured propagator alone
does not cause metadata disclosure.

OTel owns the canonical trace ID. Preserve the existing caller value as
`typeagent.trace.id`. Carry these values on spans and logs:

- `typeagent.trace.id`
- `typeagent.session.id`
- `typeagent.activation.id`

Send TypeAgent correlation values as explicit, allowlisted RPC metadata, not
broad W3C baggage. V1 does not inject them into generic HTTP propagation.

Accept remote context only on designated RPC channels. Enforce OTel parsing,
size limits, and correlation-field length and character rules. Ignore malformed
context. Partner-supplied parent context requires explicit opt-in; otherwise
start a root span and optionally link to separately validated context.

TypeAgent-owned processes set:

- `service.name`, `service.version`, `service.instance.id`
- `host.name`, `os.type`, `process.pid`
- `process.runtime.name`, `process.runtime.version`
- `deployment.environment.name`

`activationId` is not `service.instance.id`. It identifies the dispatcher
activation created with `CommandHandlerContext`, not an individual request.

Useful operation attributes include `typeagent.agent.name`,
`typeagent.action.name`, `gen_ai.system`, and `gen_ai.request.model`.
High-cardinality correlation belongs on spans and logs, never metrics.

TypeAgent-owned processes also record source revisions as resource attributes.
Resources are attached to every exported span, so the values remain available
for span filtering without duplicating them on every operation:

- `vcs.ref.head.revision` is the commit checked out at `HEAD`.
- `vcs.ref.base.revision` is the merge-base of `HEAD` and `origin/main`,
  identifying the standard revision the local work is based on.

These OpenTelemetry VCS semantic-convention attributes distinguish source
revisions from `service.version`, which remains the version of the deployable
service component. The revision attributes primarily support local debugging:
they identify the exact checkout that produced telemetry and the standard
`origin/main` revision on which the local work is based. Local development
resolves the revisions from Git once during telemetry initialization.
`InitTelemetryOptions.sourceVersion` remains available for tests or hosts that
already have revision metadata. Packaged deployments without a Git checkout
omit unavailable values.

## Configuration and Local Files

TypeAgent-owned processes support:

```yaml
telemetry:
  otlpEndpoint: http://localhost:4318
  logFile: ~/.typeagent/logs/typeagent-{service}-{process}-{pid}.jsonl
  debugBridge: true
  tracesSampler: always_on
```

Standard `OTEL_*` variables override YAML. Relevant settings include:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_SERVICE_NAME`
- `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG`
- `TYPEAGENT_OTEL_LOG_FILE`
- `TYPEAGENT_OTEL_DEBUG_BRIDGE`

TypeAgent resolves configuration and passes explicit, signal-specific
components to the SDKs. It does not accept defaults that create exporters for
unspecified signals. Signal-specific `OTEL_*_EXPORTER=none` settings are honored.
Partner libraries use host configuration and do not read TypeAgent YAML.

Local development samples all traces by default when trace export is enabled.
Deployments may configure standard OTel sampling. Partner hosts own sampling.

### Local OTel JSONL Log

Set `TYPEAGENT_OTEL_LOG_FILE` or YAML `telemetry.logFile` to write OTel logs
directly, without OTLP, a collector, or a backend:

```powershell
$env:TYPEAGENT_OTEL_LOG_FILE = "$HOME\.typeagent\logs\typeagent-{service}-{process}-{pid}.jsonl"
```

For dispatcher PID 12345, the resolved path may be:

```text
C:\Users\<user>\.typeagent\logs\typeagent-dispatcher-12345.jsonl
```

Read or tail it with normal tools:

```powershell
Get-Content -Wait C:\Users\<user>\.typeagent\logs\typeagent-dispatcher-12345.jsonl
```

The file contains OTel **log records only**: Structured Logger events and, when
enabled, bridged debug records. Each line is one valid JSON object with
timestamp, severity, body, resource, event or namespace, trace/span IDs, and
TypeAgent correlation. Traces and metrics still require OTLP.

The path is implemented as an OTel `LogRecordExporter` behind a bounded
`BatchLogRecordProcessor`:

- Serialize asynchronous writes in accepted-record order.
- Bound the queue and account for dropped records.
- Isolate open, write, and disk-full failures from requests.
- Rate-limit diagnostics and disable or retry under a documented policy.
- Apply redaction before enqueueing records.

Expand `~` before `path.resolve()`. Sanitize `{service}`, `{process}`, and
`{pid}`. TypeAgent-owned hosts identify their process role as `agent-server`,
`api-server`, `shell`, `cli`, or `agent-<name>`. If `{process}` or `{pid}` is
absent, insert it before the extension so filenames remain identifiable and
processes never share a writer. Create parent directories and report the
resolved path once through a status or diagnostic path that cannot recurse into
the exporter.

The OS or external tools manage rotation and retention. JSONL and OTLP are
additive. A JSONL-only configuration creates only the logs provider.

## Local End-to-End Validation with Grafana

This procedure runs the Grafana LGTM development stack locally, sends TypeAgent
telemetry to it over OTLP/HTTP, and writes the same OTel logs to JSONL. It
validates the complete path:

```text
TypeAgent debug + Structured Logger
  └─► OTel logs provider
        ├─► local JSONL file
        └─► OTLP/HTTP collector ─► Loki ─► Grafana

TypeAgent spans ─► OTLP/HTTP collector ─► Tempo ─► Grafana
```

### Prerequisites

Install the TypeAgent workspace dependencies with `pnpm run setup` from `ts/`
if the checkout has not already been provisioned.

Docker Desktop is the only external prerequisite. On Windows and macOS, the
repository helper can install it explicitly:

```powershell
pnpm run telemetry:grafana --install
```

This uses `winget` on Windows or Homebrew on macOS and may request elevation or
acceptance of the Docker Desktop installer. Linux developers should install
Docker Engine using their distribution's supported procedure. Docker Desktop
may require a restart or sign-out after its first installation.

Docker Desktop may also be
[installed manually](https://docs.docker.com/desktop/) before running the
normal start command.

The Grafana
[`otel-lgtm`](https://hub.docker.com/r/grafana/otel-lgtm) image contains an OTel
collector, Loki, Tempo, Prometheus, and Grafana with the data sources already
connected.

### 1. Start Grafana LGTM

Run the repository helper from `ts/`:

```powershell
pnpm run telemetry:grafana
```

The helper:

- Optionally installs Docker Desktop when `--install` is specified.
- Verifies that the Docker CLI is installed.
- Starts Docker Desktop when needed on Windows or macOS and waits for its
  engine.
- Pulls `grafana/otel-lgtm:latest` when it is not already installed.
- Starts or reuses the `typeagent-otel` container.
- Waits for Grafana to become healthy.
- Publishes Grafana and both collector receivers on `127.0.0.1` only.

The loopback binding keeps the services inaccessible from other machines on
the network. Do not publish these ports on all interfaces unless remote access
is intentional and protected separately.

The relevant endpoints are:

| Port | Endpoint                          |
| ---- | --------------------------------- |
| 3000 | Grafana UI                        |
| 4317 | OTel collector OTLP/gRPC          |
| 4318 | OTel collector OTLP/HTTP/protobuf |

Verify that Grafana is ready:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

### 2. Configure and Start TypeAgent

From `ts/`, build the agent server and configure its process environment:

```powershell
pnpm run build agent-server

$env:OTEL_SERVICE_NAME = "typeagent-local"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318"
$env:OTEL_TRACES_SAMPLER = "always_on"
$env:TYPEAGENT_OTEL_LOG_FILE = "$HOME\.typeagent\logs\typeagent-{service}-{process}-{pid}.jsonl"
$env:TYPEAGENT_OTEL_DEBUG_BRIDGE = "true"
$env:TYPEAGENT_OTEL_STRUCTURED_LOGS = "true"
$env:DEBUG = "typeagent:*,agent-server:*"

pnpm run start:agent-server
```

The environment settings enable:

- OTLP export for configured signals.
- One local JSONL file per process.
- Copies of enabled `debug` namespaces in the OTel logs pipeline.
- Privacy-filtered dispatcher Structured Logger events.
- Full local trace sampling so every generated trace can be inspected.

The equivalent settings may be placed under `telemetry` in
`config.local.yaml`. Environment variables are useful for validation because
they apply only to the current terminal and override YAML.

Only enabled `DEBUG` namespaces are bridged. Existing terminal debug output is
unchanged. Structured logging must be enabled explicitly because dispatcher
events can originate from user requests.

### 3. Generate Telemetry

In another terminal, connect the CLI:

```powershell
cd C:\path\to\TypeAgent\ts
pnpm cli
```

Run a supported `@` command and a normal TypeAgent request. Wait a few seconds
for the batch exporters, or stop the agent server with `Ctrl+C` to flush pending
telemetry.

### 4. Inspect the Local JSONL Logs

Find the most recently written process log:

```powershell
$log = Get-ChildItem "$HOME\.typeagent\logs\typeagent-local-*.jsonl" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$log.FullName
Get-Content $log.FullName -Wait
```

Each line is a JSON object. Expected fields include `timestamp`,
`severityText`, `body`, `eventName`, `traceId`, `spanId`, `attributes`, and
`resource`.

Structured dispatcher records include events such as `command` and
`requestQueue:start`. Bridged debug records include their debug namespace.
Prompt text, response text, action parameters, errors, stacks, and unknown
dispatcher fields are excluded by the dispatcher projection.

### 5. Inspect the Same Logs in Grafana

Open [http://localhost:3000](http://localhost:3000), select **Explore**, choose
the **Loki** data source, and switch the query editor to **Code** mode. Do not
use Logs Drilldown or its search box; those use a different search API rather
than executing the LogQL below. Query all records from this validation run:

```logql
{service_name="typeagent-local"}
```

Set the Explore time range to cover the validation run. For the `@help`
example, this query matches both structured and bridged records containing
`help`:

```logql
{service_name="typeagent-local"} |= "help"
```

Use a distinctive, non-sensitive term from the command you ran when validating
a different request. Avoid copying PowerShell-escaped strings such as `\"`
into the Grafana query editor; LogQL strings use normal quotes there.

To inspect queue bridge output:

```logql
{service_name="typeagent-local"} |= "requestQueue"
```

Expand a log entry to inspect its structured body, resource attributes,
severity, and trace correlation. The local JSONL and Loki records come from the
same OTel log pipeline, so event names, bodies, and correlation identifiers
should agree.

### 6. Inspect the Correlated Trace

In Grafana **Explore**, choose the **Tempo** data source and search for service
name `typeagent-local`. A log emitted inside an active span contains `traceId`
and `spanId`; use the trace ID from either Loki or the JSONL record to open the
corresponding request trace in Tempo.

This demonstrates the tangible improvement over terminal-only debug output:
structured application events and familiar debug records are searchable in one
backend and can be correlated with the request trace that produced them.

### 7. Stop the Local Stack

Stop TypeAgent with `Ctrl+C` first so its telemetry providers flush, then stop
Grafana LGTM:

```powershell
pnpm run telemetry:grafana --stop
```

## Privacy and Reliability

- Do not capture prompts, responses, user content, or known secrets by default.
- Gate sensitive development capture behind an explicit setting.
- Sanitize data at the producer before creating a TypeAgent log record. The
  producer decides whether content is appropriate to record; sink-level secret
  filtering cannot make arbitrary prompts, responses, user content, or PII
  safe to export.
- Apply `filterSecrets`, `filterSecretsFromObject`, and registered
  `SecretFilter` values at the OTel sink as defense in depth for recognizable
  and registered secrets.
- Filter non-allowlisted TypeAgent span attributes before `setAttribute()`.
- Never put user content or secrets in metric attributes.

Processors and exporters provide defense in depth but cannot sanitize arbitrary
records emitted by partner code. Partner hosts own final export policy.

Use batch processors to keep export off the request path. `initTelemetry()` and
`shutdownTelemetry()` are idempotent. TypeAgent retains every provider,
processor, exporter, file writer, and debug-hook restorer it creates.

`shutdownTelemetry()` coordinates all TypeAgent-owned components with a bounded
timeout. Do not assume `NodeSDK.shutdown()` covers a separately constructed Logs
provider, sink, or writer. Wire awaited shutdown into normal exits and graceful
`SIGINT`/`SIGTERM` handling; do not rely on `beforeExit` or call `process.exit()`
before the bounded flush.

Exporter, queue, and file failures lose telemetry, not requests. Diagnostics use
a guarded path that cannot recurse into the failing exporter.

## Developer Usage

Ordinary `debug(...)` and `logger.logEvent(...)` calls do not change. Add a span
for an externally meaningful or independently timed operation:

### Adding a new span

Use the global OTel API directly with TypeAgent's shared instrumentation scope,
span-name contract, and allowlisted attribute helper. A manual span has this
structure:

1. Acquire a tracer with the shared instrumentation scope.
2. Start an active span so nested asynchronous work inherits its context.
3. Set only allowlisted attributes.
4. Record a stable, privacy-safe error classification and status.
5. End the span in `finally`.

```ts
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";

const tracer = trace.getTracer(
  otel.INSTRUMENTATION_SCOPE_NAME,
  otel.INSTRUMENTATION_SCOPE_VERSION,
);

return tracer.startActiveSpan(
  otel.TYPEAGENT_SPAN_NAMES.TRANSLATION,
  async (span) => {
    otel.setTypeAgentSpanAttributes(span, { agentName });

    try {
      return await translateRequest(request);
    } catch (error) {
      span.recordException({
        name: "TranslationError",
        message: "translation failed",
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "translation failed",
      });
      throw error;
    } finally {
      span.end();
    }
  },
);
```

`startActiveSpan()` makes nested async work a child automatically. Logs emitted
inside the callback receive its trace and span IDs. If code converts an exception
to `ActionResult`, it must still record the exception and error status.

Before introducing a new stable `typeagent.*` span name or attribute, add it to
`packages/telemetry/src/otel/traceContract.ts` and use the exported constant or
helper at the call site. Do not put prompts, responses, user content, exception
messages, or stacks on spans.

For a complete implementation example, see
[PR #2842](https://github.com/microsoft/TypeAgent/pull/2842).

Dispatcher request spans start a new trace by default. Embedded hosts can join
the OTel context active when each request is submitted with a one-time option:

```ts
await createDispatcher(hostName, {
  telemetry: { joinActiveTrace: true },
});
```

Original exception messages and stacks are omitted because they can contain user
content. Record a stable classification and message at the catch site.

## Currently Captured Dispatcher Telemetry

### Root dispatcher command span

The dispatcher creates one `typeagent.request` span for each command processed
by `processCommand`. It starts a new trace by default. An embedded host can opt
in to parenting it under the context active when the request was submitted by
setting `telemetry.joinActiveTrace`.

The span covers command locking and command processing, including translation
and action execution. Best-effort display logging and command-complete
notification performed by the request queue after `processCommand` returns are
outside the span.

| Captured data     | Current behavior                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Attributes        | `typeagent.session.id`, `typeagent.activation.id`, and the preserved caller value in `typeagent.trace.id`, when available |
| Success           | Span status remains unset                                                                                                 |
| Cancellation      | Span status is `ERROR` with the stable message `cancelled`                                                                |
| Thrown failure    | Records a privacy-safe `RequestError` exception and sets `ERROR` with `request failed`                                    |
| Converted failure | Command processing records the exception and error status before converting it to a cancellation or user-visible result   |
| Parent context    | New root by default; joins an explicitly selected active context only                                                     |

### Translation span

The dispatcher creates one `typeagent.translation` child span for each logical
translation operation. The normal `interpretRequest` path includes
grammar/construction-cache lookup and any subsequent model translation in the
same span. Direct `translateRequest` callers also create a span. Re-entrant calls
reuse the active translation span instead of creating nested duplicates.

The span ends after the translation result is produced. Interactive
confirmation, translation logging, developer-trace persistence, and
conversation-signal updates happen afterward and are not included in its
duration.

Translation events currently captured are:

| Event                          | Meaning                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `translation.grammar.matched`  | A grammar match produced the translation result                                                                |
| `translation.grammar.no_match` | The unified matcher produced no grammar result                                                                 |
| `translation.cache.hit`        | A construction-cache match produced the translation result                                                     |
| `translation.cache.miss`       | The unified matcher produced no construction result                                                            |
| `translation.cache.bypassed`   | Matching was intentionally skipped; `bypass_reason` is a bounded value                                         |
| `translation.fallback`         | An assistant-switch translation attempt was initiated                                                          |
| `translation.retry`            | A same-operation retry was initiated; `retry_number` is sequential within the span and `retry_kind` is bounded |

A unified matcher miss emits both `translation.grammar.no_match` and
`translation.cache.miss`. Fallback and retry events describe initiated attempts,
so the event remains present when the following translation fails. Activity
context can perform several lookups in one span; their event order reflects the
execution order.

Translation spans carry the same available correlation attributes as the root
request span. Errors record a privacy-safe `TranslationError`, or `AbortError`
for cancellation, and set a stable error status before rethrowing.

### Action span

Each dispatcher action execution creates a `typeagent.action` span after its
action context is initialized and before readiness checks, flow processing, or
the agent handler runs. It includes result emission and ends exactly once when
the action returns, throws, or is cancelled. The span is a child of the
currently active span: `typeagent.request` in the normal flow, or another
`typeagent.action` when a flow step dispatches a sub-action.

Failure modes are recorded distinctly and use bounded, allowlisted values:

- Pre-handler precondition failures (`handler_missing`, `agent_not_ready`)
  fire `action.setup.failed` with the enumerated `failure_kind`. No handler
  ran.
- A handler-thrown exception that was converted to an `ActionResult` fires
  the standard `exception` event with the privacy-safe pair
  `ActionHandlerError` / `action handler failed`. The original message and
  stack are never exported.
- A flow-interpreter exception converted to an `ActionResult` uses the
  privacy-safe pair `ActionFlowError` / `action flow failed`.
- A handler that returned a typed `ActionResult.error` fires
  `action.result.error` with `failure_kind: "result_error"`. The
  `ActionResult.error` text itself is never stamped.
- An exception that escapes the wrapper is recorded as `AbortError` /
  `cancelled` for cancellation and `ActionError` / `action failed`
  otherwise, matching the request and translation span conventions.

Auto-setup replacement results (produced when `setupOnFirstUse` runs setup
in place of the user's action) leave the span status unset regardless of
the result's shape.

### Reasoning span

Each Claude or Copilot reasoning operation creates one
`typeagent.reasoning` span under the active request or action. The span covers
the complete SDK operation, including streamed responses, tool execution, and
optional reasoning-trace persistence. It ends only after the operation returns,
throws, or is cancelled. `gen_ai.system` identifies the reasoning engine and
`gen_ai.request.model` identifies the configured model.

Each tool execution emits `reasoning.tool_call` with a one-based
numeric `tool_call_number`. Calls above 100 collapse into one
`reasoning.tool_call.overflow` event, which bounds event volume for runaway
loops without changing the attribute's type. Tool names, arguments, results,
prompts, responses, and reasoning text are never recorded on the span.

Timeout and external cancellation are propagated to the underlying SDK
operation before the span ends. Cancellation records the privacy-safe
`AbortError` / `cancelled` exception classification and sets error status.
Other escaping exceptions use `ReasoningError` / `reasoning failed`. Original
exception messages and stack traces are never exported.

| Signal          | Use                                          |
| --------------- | -------------------------------------------- |
| Span attributes | Stable facts such as agent, action, or model |
| Span events     | Timestamped milestones such as a retry       |
| Logs            | Diagnostic detail for one request            |
| Metrics         | Counts and durations across requests         |

Add spans for RPC, LLM, retry, fallback, or core latency boundaries. Avoid spans
for trivial helpers, every debug message, or work already covered by a core span.
Always end manual spans in `finally`.

## Implementation Plan

| Phase                             | Delivers / value                      | Scope                                                                                                                             | Exit                                                                                               |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **0. Foundation**                 | Safe lifecycle and ownership seams    | Module structure, dependencies, names, signal-specific configuration, resources, redaction, test injection, host startup/shutdown | Unconfigured hosts no-op; configured hosts start and stop only components they own                 |
| **1. Core Traces**                | **First usable OTel** in one process  | Manual command, translation, reasoning, action, and LLM spans; status, exceptions, OTLP and in-memory export                      | One coherent request trace with accurate failure status; embedded spans join a host provider       |
| **2. Logs and Local Diagnostics** | **Local debugging checkpoint**        | `OtelLoggerSink`, composition-root wiring, multi-instance debug bridge, bounded process-safe JSONL exporter, trace correlation    | Structured and debug OTel logs correlate without changing existing sinks; JSONL and OTLP logs work |
| **3. Distributed Context**        | **Functional MVP** across processes   | RPC client/server spans, validated W3C context, explicit TypeAgent metadata, independent process export                           | One correctly parented trace crosses dispatcher, agent server, and agent subprocesses              |
| **4. Local Grafana POC**          | Visual proof of OTLP interoperability | Optional `otel-lgtm` or Alloy/Tempo/Loki setup and short verification steps                                                       | A developer views one Phase 3 trace and correlated logs in Grafana                                 |
| **5. Metrics**                    | **Operational visibility**            | Token and duration instruments, bounded attributes, in-memory tests, optional Grafana queries                                     | Readers verify values; partner metrics join the host provider; POC can inspect export              |
| **6. Hardening**                  | **Production-ready v1**               | Provider/no-provider, partner wiring, privacy, compatibility, overhead, queue/disk/export/shutdown failures                       | Partner and operational tests meet ownership, reliability, privacy, and performance requirements   |

Phases normally proceed in order. Phase 4 depends on Phase 3 so the POC shows
the Functional MVP. Metrics implementation may start after Phase 0, but the
primary sequence integrates it after the POC.

Deferred beyond v1: browser/web telemetry, HTTP auto-instrumentation, production
collector topology, dashboards and alerts, file lifecycle management, new
business metrics, and MCP OTel integration.

## MCP OpenTelemetry Stretch Goal

After v1, TypeAgent may propagate validated W3C context through MCP
`params._meta` (SEP-414) and create MCP client/server spans. Treat metadata as
untrusted, do not broadly propagate baggage or private TypeAgent fields, and use
one canonical policy across stdio and HTTP carriers. Reuse SDK-created operation
spans when present instead of creating duplicates.

## Validation

- Use in-memory providers, exporters, and readers for configuration, resources,
  sampling, signal mapping, pre-record redaction, converted failures, lifecycle,
  and provider/no-provider behavior.
- Test Structured Logger and debug coexistence across distinct `debug` instances:
  tee behavior, prior-hook restoration, recursion guards, and duplicate prevention.
- Test ordered, valid, process-safe JSONL output; bounded queues; drop accounting;
  and file, exporter, and shutdown failures.
- Verify active-span log correlation and parent-child continuity across
  independently exporting RPC processes.
- Cover enabled, disabled, and unconfigured modes while preserving `DEBUG`,
  `@trace`, stderr, CLI, database sinks, library no-op behavior, and explicit
  partner log wiring.
- Pin and test compatible OTel Logs, Node SDK, and GenAI convention versions.
- Measure representative disabled and enabled paths for overhead, privacy, and
  cardinality.
- Keep the Grafana POC an optional smoke test, not a replacement for
  backend-independent tests.

Use the repository build and test flow:

```text
pnpm run build
pnpm --filter @typeagent/telemetry test
pnpm --filter agent-dispatcher run jest-esm --testPathPattern="otel.*spec.js"
```

The dispatcher suite includes deterministic one-process trace coverage with an
in-memory provider. Run the separate OTLP/protobuf receiver smoke path explicitly:

```powershell
$env:TYPEAGENT_OTEL_OTLP_SMOKE = "1"
pnpm --filter agent-dispatcher run jest-esm --runInBand --testPathPattern="otelOtlpSmoke.spec.js"
```

## References

- Logging and profiling: `packages/telemetry/src/logger/`, `packages/telemetry/src/profiler/`
- Dispatcher logging, trace control, RPC, and metrics: `packages/dispatcher/dispatcher/src/context/`, `packages/dispatcher/dispatcher/src/utils/metrics.ts`
- LLM usage: `packages/aiclient/src/tokenCounter.ts`, `packages/aiclient/src/openai.ts`, `packages/aiclient/src/copilotModels.ts`
- Redaction: `packages/utils/commonUtils/src/secretFilter.ts`
- Multiple `debug` instances and trace fan-out: `packages/dispatcher/nodeProviders/src/agentProvider/process/agentProcess.ts`
- OpenTelemetry JS manual instrumentation: <https://opentelemetry.io/docs/languages/js/instrumentation/>
- OpenTelemetry JS Logs SDK: <https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-logs.html>
- OpenTelemetry baggage security guidance: <https://www.w3.org/TR/baggage/#security-considerations>
- OpenTelemetry GenAI semantic conventions: <https://github.com/open-telemetry/semantic-conventions-genai>
- MCP Python SDK v2 OpenTelemetry integration: <https://py.sdk.modelcontextprotocol.io/v2/run/opentelemetry/>
- MCP SEP-414 request metadata trace context: <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/414-request-meta.md>
