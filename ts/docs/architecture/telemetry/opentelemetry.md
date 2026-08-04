<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# OpenTelemetry in TypeAgent

**Status:** Settled design; implementation pending

**Area:** `@typeagent/telemetry`, `aiclient`, dispatcher, RPC, and TypeAgent-owned Node hosts

**Scope:** Node-hosted traces, logs, metrics, context propagation, and local telemetry files

## Value Proposition

OpenTelemetry gives TypeAgent a structured, end-to-end view of each request. It
improves local debugging now and prepares the codebase for production
observability and partner integration.

- **Local development:** Follow a request through translation, reasoning, LLM
  calls, action execution, agents, and RPC. Find latency and failures, correlate
  existing debug output, and opt in to a directly accessible local OTel JSONL
  log for parsing, tailing, and comparison without running an OTel Collector or
  observability backend. Traces and metrics remain available through OTLP.
- **Production operations:** Export the same signals to OTLP-compatible
  platforms. Build dashboards and alerts for latency, failures, token usage, and
  reliability while remaining vendor-neutral.
- **Partner integration:** Use the partner host's OTel configuration instead of
  creating a parallel SDK or export path. Partners retain control over
  providers, exporters, sampling, resources, privacy, storage, and governance.
  Optional log integrations remain explicit.

**Bottom line:** One instrumentation model supports local debugging, production
operations, and embedded TypeAgent libraries.

## Goals

- Instrument the core request path with traces, logs, and metrics while preserving existing logging workflows.
- Propagate context across RPC and make libraries observable without taking control of the host.
- Support simple local capture, OTLP production parity, privacy, and failure isolation.

## Non-Goals

- Selecting a vendor, dashboards, alerts, or collector topology.
- Replacing `debug`, `Logger`, database sinks, or the `@trace` command.
- Instrumenting browser surfaces or enabling HTTP/`undici` auto-instrumentation in v1.
- Defining custom trace/metric file formats or managing file rotation and retention.

## Current State

| Concern                  | Existing mechanism                                         | OTel integration point                |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------- |
| Developer tracing        | `debug` namespaces and runtime `@trace` control            | Optional bridged OTel log copies      |
| Structured Logger events | `Logger`, `LoggerSink`, `MultiSinkLogger`, `ChildLogger`   | Additional OTel logger sink           |
| Correlation              | `traceId`, `sessionId`, `activationId`, `hostName`         | OTel attributes and RPC metadata      |
| LLM usage                | `TokenCounter` and completion callbacks                    | Token metrics and LLM span attributes |
| Phase timing             | `RequestMetricsManager`, profiler, `StopWatch`             | Duration metrics and spans            |
| Redaction                | `filterSecrets`, `filterSecretsFromObject`, `SecretFilter` | Redaction before record/export        |
| Cross-process tracing    | Debug namespace fan-out only                               | W3C context in RPC metadata           |

The design extends these seams rather than creating a parallel telemetry system.

## Design Overview

Add a small OTel module to the existing `@typeagent/telemetry` package:

```text
debug("typeagent:*") ─► stderr / CLI debug panel
         └─► optional bridge copy ───────────────┐
Structured Logger events ─► OtelLoggerSink ─────┴─► OTel Logs API
                                                      │
                                                      └─► log provider/processors
                                                          ├─► OTLP logs
                                                          └─► local OTel JSONL log
                                                              (LogRecordExporter)

TokenCounter / timings ─► OTel Metrics API ─► meter provider/readers
                                                └─► OTLP metrics

core operation boundaries ─► OTel Trace API ─► tracer provider/processors
                                                  └─► OTLP traces

RPC metadata ◄─ traceparent and explicit TypeAgent correlation fields ─►
```

The OTLP and local file branches are independently optional and may be enabled
together. The local branch gives developers an opt-in local OTel JSONL log they
can open with normal tools; it does not require a collector or backend. It is
not the debug log. Internally, the configured path is implemented as a bounded
OTel Logs SDK `LogRecordExporter`, which writes OTel log records directly to
that file.

**Default policy:** OTel instrumentation is compiled in, but collection and
export remain disabled until configured. TypeAgent-owned processes create only
the providers, processors, and readers required for the configured signals. A
JSONL-only configuration creates a logs pipeline, not trace or metric pipelines.

Embeddable trace and metric instrumentation no-ops unless the partner host
installs the corresponding provider. OTel logs use the separate
`@opentelemetry/api-logs` API and require both a logger provider and TypeAgent
sink or debug bridge wiring. The debug bridge emits only namespaces enabled
through `DEBUG` or `@trace`.

**Separate authoring interfaces, one observability pipeline:** `debug(...)`
remains the lightweight, namespace-controlled interface for immediate terminal
and CLI-panel debug output. `logger.logEvent(...)` remains the Structured Logger
event interface. The bridge copies enabled debug output into separate OTel log
records, while `OtelLoggerSink` converts Structured Logger events without
flattening their fields.

The package uses a **thin hybrid facade**. Trace and metric instrumentation code
imports `@opentelemetry/api` directly. Log adapters use
`@opentelemetry/api-logs`. `@typeagent/telemetry` owns TypeAgent-host bootstrap,
configuration, resources, redaction, the optional debug bridge, and
`OtelLoggerSink`. It does not wrap OTel spans or instruments, and it does not
re-export `getTracer()` or `getMeter()`.

The setup boundary is:

```ts
initTelemetry(options?): Promise<void>;
shutdownTelemetry(): Promise<void>;
createOtelLoggerSink(): LoggerSink;
```

There is no `TypeAgentSpan` abstraction or custom telemetry API layered over OTel.

## Ownership and Partner Integration

**TypeAgent instrumentation works with an OTel-enabled partner host. Optional
log integrations require one-time explicit wiring.**

TypeAgent traces and metrics use the partner host's installed global tracer and
meter providers. They join its active context and follow its sampling, resources,
and export configuration. OTLP compatibility alone does not initialize OTel:
the partner host must configure an OTel SDK or providers and an exporter.

Structured TypeAgent `Logger` events require the host to attach
`OtelLoggerSink` once. Copying enabled TypeAgent debug output into OTel logs
requires explicit opt-in to the debug bridge. An OTel-enabled partner host does
not need a TypeAgent-specific OTLP endpoint or SDK initialization.

**Embeddable TypeAgent libraries** use the trace and metric APIs but never
initialize or replace global providers. Without host providers, that
instrumentation no-ops.

**TypeAgent-owned Node hosts** call `initTelemetry()` once per process and
`shutdownTelemetry()` on exit. Shell main, CLI, agent server, dispatcher hosts,
and agent subprocess hosts each install at most one process-global provider per
enabled signal and export directly. There is no SDK or provider per library,
agent, request, or session.

Global provider registration is first-writer-wins. TypeAgent-owned bootstrap
runs before application instrumentation. It treats an unexpected existing
provider as a configuration conflict rather than silently claiming ownership.
Embeddable code never replaces a host provider. Shutdown is idempotent but not
restartable in the same process; it does not unregister or replace host globals.

Each subprocess receives W3C context over RPC, creates child spans with its own
process-global provider, and exports them directly. Telemetry payloads are not
routed through the dispatcher.

The ownership rule does not make existing `Logger` events automatic.
TypeAgent-owned composition roots attach one `OtelLoggerSink` to each relevant
`MultiSinkLogger` while preserving debug and database sinks. A partner host that
wants structured TypeAgent events must also attach the sink through the
library's logger or integration option. Installing an OTel SDK alone is
insufficient. The sink emits through the host's global Logs API and does not
initialize a provider.

Embeddable libraries never install a process-wide `debug` hook. A partner may
explicitly install a TypeAgent-provided debug adapter at its composition root.
The partner accepts process-global hook behavior and identifies the `debug`
module instances to cover.

## Signals

### Traces

Use manual spans at these boundaries: command/request handling, translation,
reasoning when used, action execution, LLM calls, and RPC client/server
operations.

Use manual LLM spans only in v1. Do not enable HTTP or `undici`
auto-instrumentation. Transport spans add noise and increase the risk of
capturing headers or bodies without improving the operation-level view.

Spans record status and exceptions. Selected lifecycle and failure events may be
added to spans, but ordinary debug messages are not duplicated as span events.

### Logs and Debug Bridge

Use these terms consistently:

| Term                     | Purpose                         | Default state                    | Destination and persistence                          | Shape                    | Requires OTel |
| ------------------------ | ------------------------------- | -------------------------------- | ---------------------------------------------------- | ------------------------ | ------------- |
| Debug output             | Immediate developer view        | Disabled until a namespace is on | stderr/CLI debug panel; ephemeral, not persisted     | Text                     | No            |
| Structured Logger events | Stable application events       | Emitted by existing call sites   | Existing `LoggerSink`s; persistence is sink-specific | Named fields             | No            |
| OTel logs                | Correlated, processable records | Disabled until configured        | OTLP and/or the local OTel JSONL log                 | OTel log records         | Yes           |
| Local OTel JSONL log     | Opt-in persistent OTel log file | Disabled until configured        | Configured file path; persistent                     | One OTel record per line | Yes           |

**Rule:** Debug is the immediate developer view; OTel logs are the correlated,
processable telemetry record.

Debug output is the existing npm `debug` package output. It is controlled by
`DEBUG` and `@trace`, written immediately to stderr or the CLI debug panel, and
does not require OTel or persist locally by default. Structured Logger events are
existing `logger.logEvent(...)` records with stable event names and fields,
routed through `LoggerSink`s. OTel logs are separate records processed by the
OTel Logs SDK. The local OTel JSONL log is the opt-in file created by
`TYPEAGENT_OTEL_LOG_FILE` (or YAML `telemetry.logFile`); it is not "the debug
log."

Today, the paths are mostly separate. `DebugLoggerSink` provides a limited
one-way connection by serializing a Structured Logger event as JSON text under
`typeagent:logger:*`. That flattening loses structure for downstream processing
and does not provide OTel correlation or export.

JavaScript logs use the separate `@opentelemetry/api-logs` and
`@opentelemetry/sdk-logs` packages, which remain experimental. Pin a reviewed,
mutually compatible package set rather than allowing independent range upgrades.
`NodeSDK` may coordinate a logger provider only when configured with log
processors and exporters. Installing or starting it does not, by itself,
integrate the TypeAgent `Logger`.

The design preserves both producer APIs. `OtelLoggerSink` emits the redacted,
JSON-compatible `LogEvent.event` as the OTel log body. It adds `eventName` and
allowlisted scalar correlation fields as attributes, while excluding nested or
unbounded fields. This matches the current `ChildLogger`, which merges common
properties into the event rather than preserving their provenance.

Existing debug and database sinks continue alongside it. Debug messages remain
text bodies with namespace attributes when copied into OTel logs; Structured
Logger fields remain structured. Both OTel paths share active trace and span
correlation, resource attributes, redaction, batching, local OTel JSONL output,
and OTLP export.

A module-level `debug` hook tees each enabled `typeagent:*` debug message into a
separate OTel log record while preserving the original stderr or CLI output:

- It preserves `DEBUG` and runtime `@trace` namespace control.
- Only enabled namespaces are copied. With debug output off, there are no
  bridged debug records, although Structured Logger events can still produce
  OTel logs.
- It excludes structured logger namespaces such as `typeagent:logger:*` because
  configured Structured Logger events reach OTel through `OtelLoggerSink`.
- It excludes the bridge's diagnostic namespace and
  `typeagent:telemetry:promptLogger` to prevent recursion and duplicate flattened
  records.
- It emits one OTel log record per enabled debug call, correlated with the active
  trace and span.
- `TYPEAGENT_OTEL_DEBUG_BRIDGE=off` stops the copy independently; normal debug
  output continues.
- It tees to the exact prior `debug.log` implementation so stderr, color,
  timestamps, and CLI interception continue unchanged.
- It derives the namespace from the debug instance (`this.namespace`), not by
  parsing rendered text. The telemetry body is rendered separately without ANSI
  codes. Tests cover formatted objects and multi-argument calls.

The bridge does not move, replace, or automatically persist all debug output.
Persistence occurs only when an OTel log exporter is configured, and only debug
messages from enabled namespaces are eligible for the copy.

The hook affects only the resolved `debug` module instance on which it is
installed. TypeAgent agent processes can load a second instance from the agent
module, as `agentProcess.ts` already recognizes when forwarding `enable()`.
TypeAgent-owned bootstrap must install the debug bridge on each known distinct
instance or document that only host-package debug calls are covered. One hook
must not be described as process-wide coverage. A debugger with its own
instance-level `.log` override can also bypass a module-level hook and is outside
v1 unless explicitly adapted.

Installation is reference-counted or otherwise idempotent. It does not wrap the
same instance twice, uses a reentrancy guard with OTel suppression for exporter
and diagnostic paths, and restores the exact prior hook on shutdown only if the
debug bridge still owns it. These rules prevent duplicate records, recursive
diagnostics, and damage to hooks installed by the host.

Developers should not emit both `debug()` and `logEvent()` for the same fact.

Bridged debug records follow enabled debug namespaces and the debug bridge
toggle, independently of trace sampling. An OTel log may therefore refer to a
trace that the backend did not retain.

### Metrics

Surface values TypeAgent already calculates:

- `TokenCounter` feeds token-usage instruments. GenAI semantic conventions are
  still evolving, so implementation pins a reviewed convention version and
  schema URL. If the desired names are not stable in that version, use
  documented `typeagent.*` names rather than presenting experimental names as
  permanent.
- `RequestMetricsManager` and profiler timing feed request/phase duration
  instruments such as `typeagent.request.duration`.
- Stable attributes may include model, agent, operation, status, and token type.

Do not use session IDs, trace IDs, activation IDs, user text, or other unbounded
values as metric attributes.

## Context and Attributes

Use W3C `traceparent` over TypeAgent WebSocket and RPC boundaries. Callers inject
active trace context into a dedicated metadata envelope. Receivers validate and
extract it before handling the operation.

OTel generates the canonical trace ID. The existing caller-supplied `traceId`
may be arbitrary, so preserve it as `typeagent.trace.id`.

Carry `typeagent.trace.id`, `typeagent.session.id`, and
`typeagent.activation.id` as span and log attributes. When a TypeAgent subprocess
needs them, send them as explicit, allowlisted TypeAgent RPC metadata rather than
global W3C baggage. V1 does not inject these identifiers into generic HTTP
propagation because baggage can escape through downstream requests and cross
partner trust boundaries.

Accept remote trace context only on designated TypeAgent RPC channels. Use the
OTel propagator's parsing rules, bound the metadata or header size, and ignore
malformed context. Validate TypeAgent correlation fields for expected length and
character set before attaching them. Accept external or partner-supplied parent
context only when the embedding boundary explicitly opts in. Otherwise, start a
new root and optionally link to separately validated context.

TypeAgent-owned processes set these process-level resource attributes once:
`service.name`, `service.version`, a per-process `service.instance.id`,
`host.name`, `os.type`, `process.pid`, `process.runtime.name`,
`process.runtime.version`, and `deployment.environment`.

`activationId` is not `service.instance.id` and is not currently per request.
The dispatcher creates it when `CommandHandlerContext` is initialized, so it
identifies that dispatcher activation until the context is recreated.

Useful operation attributes include `typeagent.agent.name`,
`typeagent.action.name`, `gen_ai.system`, and `gen_ai.request.model`.

High-cardinality correlation values belong on spans and logs, not metrics.

## Configuration and Local Files

TypeAgent-owned processes support a `telemetry:` section in TypeAgent YAML:

```yaml
telemetry:
  otlpEndpoint: http://localhost:4318
  logFile: ~/.typeagent/logs/typeagent-{service}-{pid}.jsonl
  debugBridge: true
  tracesSampler: always_on
```

The local OTel JSONL log is opt-in. A developer can enable it with either
`TYPEAGENT_OTEL_LOG_FILE` or the YAML
`telemetry.logFile` setting, without configuring OTLP or running an OTel
Collector or observability backend. For example, in PowerShell:

```powershell
$env:TYPEAGENT_OTEL_LOG_FILE = "$HOME\.typeagent\logs\typeagent-{service}-{pid}.jsonl"
```

For a dispatcher process with PID 12345, this could resolve to:

```text
C:\Users\<user>\.typeagent\logs\typeagent-dispatcher-12345.jsonl
```

Standard `OTEL_*` environment variables override YAML. Relevant settings are:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_SERVICE_NAME`
- `OTEL_RESOURCE_ATTRIBUTES`
- `OTEL_TRACES_SAMPLER`
- `OTEL_TRACES_SAMPLER_ARG`
- `TYPEAGENT_OTEL_LOG_FILE`
- `TYPEAGENT_OTEL_DEBUG_BRIDGE`

TypeAgent resolves this configuration first and passes explicit signal
components to the SDKs. It does not rely on SDK defaults that may create
exporters for unspecified signals.

Partner libraries do not read TypeAgent telemetry configuration; they use the host's OTel configuration.

### Sampling

- Local development captures 100% of traces when trace export is enabled unless explicitly overridden.
- Deployed TypeAgent-owned processes use standard configurable OTel sampling.
- Partner hosts own sampling for embedded TypeAgent libraries.

### Local OTel JSONL Log

`TYPEAGENT_OTEL_LOG_FILE` or YAML `telemetry.logFile` enables direct local OTel
log output. This file is not the debug log. It contains OTel **log records
only**: Structured Logger events converted by `OtelLoggerSink`, plus copies of
enabled debug output when the debug bridge is enabled. It does not contain trace
span objects or metrics; those signals remain available through OTLP to a
collector or backend.

- Each line is one complete, valid JSON object. Records include timestamp,
  severity, body, namespace or event name, resources, `trace_id`, `span_id`, and
  TypeAgent correlation attributes. Developers can read or tail the resolved
  path with normal tools, for example:

  ```powershell
  Get-Content -Wait C:\Users\<user>\.typeagent\logs\typeagent-dispatcher-12345.jsonl
  ```

- Internally, the configured path is implemented as an OTel `LogRecordExporter`
  behind a bounded `BatchLogRecordProcessor`. The exporter writes directly to
  the file; this is not a parallel TypeAgent event format or an ambiguously named
  SDK processor.
- Asynchronous writes serialized in accepted-record order, with a bounded queue
  and explicit drop accounting when the queue is full.
- Open, write, and disk-full failures isolated from request handling.
  Diagnostics are rate-limited. The writer disables itself or retries according
  to a documented policy instead of allowing memory to grow without bound.

The path supports `{service}` and `{pid}` expansion. Expand `~` with
`os.homedir()` before `path.resolve()` so YAML behaves consistently on Windows.
Placeholder values must be filename-safe. If `{pid}` is absent, insert `.<pid>`
before the extension so separate processes never share a writer. Create the
parent directory recursively. When local OTel JSONL logging initializes,
TypeAgent-owned hosts report the resolved path once through an existing host
status or diagnostic mechanism that is not routed into the exporter, avoiding
recursive log writes. External tooling or the OS manages rotation, retention,
archival, and deletion.

The local OTel JSONL log and OTLP are additive. The local file covers OTel logs
only. OTLP through a local collector remains the path for all signals,
cross-process aggregation, and production parity.

If neither OTLP nor the local OTel JSONL log is configured, `initTelemetry()`
registers no providers, and OTel API calls remain no-ops. Signal-specific
`OTEL_*_EXPORTER=none` settings are honored. Enabling only the local OTel JSONL
log must not create default trace or metric exporters.

## Privacy and Reliability

- Do not capture raw prompts, responses, user content, or known secrets by
  default.
- Gate sensitive development capture behind an explicit developer setting and
  retain redaction.
- TypeAgent-controlled bridges and sinks apply `filterSecrets`,
  `filterSecretsFromObject`, and registered `SecretFilter` values before creating
  each log record. TypeAgent span attributes are similarly filtered before
  `setAttribute()` when their source is not already allowlisted.
- Processors and exporters provide defense in depth for TypeAgent-created
  attributes. They cannot guarantee redaction of arbitrary log bodies or events
  emitted directly by partner code or other instrumentation.
- Partner hosts own final export filtering and privacy policy.
- Never put user content or secrets in metric attributes.

Use batch processors so export remains off the request path. `initTelemetry()` is
idempotent. It retains the exact providers, processors, exporters, and debug-hook
restorers that TypeAgent created. `shutdownTelemetry()` coordinates them with a
bounded timeout and is also idempotent.

`NodeSDK.shutdown()` flushes and shuts down the tracer, meter, and logger
providers that the `NodeSDK` instance created. It does not cover a separately
constructed `LoggerProvider`, an unattached `OtelLoggerSink`, or an independent
file writer. The preferred local OTel JSONL design registers its exporter with
the owned logger provider so provider shutdown reaches it. Any separately owned
component must be explicitly included in coordinated shutdown.

Wire awaited shutdown into normal TypeAgent-owned host exit paths and graceful
`SIGINT`/`SIGTERM` handlers. Do not rely on `beforeExit` alone, and do not call
`process.exit()` before the bounded flush completes. Forced termination may
still lose buffered telemetry.

Exporter and file failures degrade to missing telemetry, never a failed
TypeAgent request. Report failures through OTel diagnostics or a guarded
telemetry debug namespace so error reporting cannot recurse into the failing
exporter.

## Developer Usage

Ordinary `debug(...)` and `logger.logEvent(...)` calls do not change.

A span is a timed record for one meaningful operation. `startActiveSpan()` starts
the timer and makes the span current during the async callback. Awaited or nested
instrumented work uses OTel async context and becomes a child automatically.
There is no need to pass span objects through every function. Structured Logger
events sent through `OtelLoggerSink` and bridged copies of enabled
`typeagent:*` debug output receive the current trace and span IDs.

```ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("typeagent");

return tracer.startActiveSpan("typeagent.translate", async (span) => {
  try {
    span.setAttribute("typeagent.agent.name", agentName);
    return await translateRequest(request);
  } finally {
    span.end();
  }
});
```

The attribute records a stable, searchable fact about the operation. If
`translateRequest()` contains an instrumented cache or LLM call, that span
becomes a child of `typeagent.translate`. OTel logs emitted before the callback
finishes correlate with the same active span; ordinary debug output remains the
immediate terminal or CLI-panel view.

Use each signal for a different purpose:

| Signal          | Use                                                                |
| --------------- | ------------------------------------------------------------------ |
| Span attributes | Stable facts and query dimensions, such as agent, action, or model |
| Span events     | Timestamped milestones, such as starting a retry                   |
| Logs            | Diagnostic detail for investigating one request                    |
| Metrics         | Aggregated counts and durations across many requests               |

Record failures explicitly when TypeAgent converts an exception into an
`ActionResult` instead of allowing it to escape:

```ts
import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("typeagent");

return tracer.startActiveSpan("typeagent.execute_action", async (span) => {
  span.setAttribute("typeagent.agent.name", agentName);
  span.setAttribute("typeagent.action.name", action.actionName);
  span.addEvent("typeagent.action.dispatch_started");

  try {
    return await agent.executeAction(action, context);
  } catch (error) {
    const exception = error instanceof Error ? error : String(error);
    span.recordException(exception);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    return createActionResultFromError(
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    span.end();
  }
});
```

Without `recordException()` and an error status, this span could appear
successful because the callback returns an `ActionResult`. Always call
`span.end()` in `finally`, whether the operation succeeds, throws, or converts
the error.

Active context also creates the expected nesting without plumbing spans through
translation and action APIs:

```text
typeagent.command
├── typeagent.translate
│   └── typeagent.llm
└── typeagent.execute_action
```

OTel logs emitted in any node carry that node's trace and span IDs
automatically.

**When should I add one?**

- Add a span for an externally meaningful or independently timed boundary.
- Add one for an async, RPC, or LLM call, a retry or fallback, or an operation
  whose latency or failure needs separate diagnosis.
- Do not add one for trivial helpers, every debug message, or work already covered
  by an existing core span.

A manual span marks a meaningful boundary, not every function. Do not add a
second span around an existing core boundary. Do not emit both a debug message
and a Structured Logger event for the same fact.

## Implementation Plan

Each phase uses the same structure: objective, value, key work, exit criteria,
and work deferred to a later phase.

### Phase 0: Foundation

**Objective:** Establish shared configuration, lifecycle, provider ownership, and
test seams.

**Value:** Internal enablement and risk reduction. No direct user-visible value.

**Key work:**

- Add the minimal `@typeagent/telemetry` module structure, dependencies, and
  instrumentation names.
- Define signal-specific configuration, provider ownership, resources,
  redaction, timeout handling, idempotent lifecycle coordination, and in-memory
  test injection.
- Wire lifecycle only into TypeAgent-owned Node entry points. Do not fully build
  every provider pipeline upfront.

**Exit criteria:** Each TypeAgent-owned process remains a no-op when unconfigured,
starts only requested signal components, and cleanly shuts down every component
it created.

**Not included yet:** Application logs, spans, metrics, or cross-process
propagation.

### Phase 1: Core Traces

**Objective:** Trace the main request path within one process.

**Value:** First differentiated OTel benefit and first usable OTel checkpoint.
TypeAgent library spans can join an OTel-enabled partner host.

**Key work:**

- Add manual spans at command/request, translation, reasoning, `executeAction`,
  and LLM boundaries.
- Record status and exceptions where TypeAgent converts or swallows failures.
- Export through OTLP and validate with an in-memory exporter or simple
  collector.

**Exit criteria:** One process produces a coherent request trace across the
selected boundaries, including accurate failure status. Embeddable spans join a
host-provided active context and tracer provider.

**Not included yet:** OTel log integration, RPC spans, cross-process propagation,
or metrics.

### Phase 2: Logs and Local Diagnostics

**Objective:** Add correlated OTel logs from Structured Logger events and
enabled debug output, plus persistent local diagnostics.

**Value:** Detailed diagnostics for a selected span and persistent, parseable
local OTel logs. This is the local debugging checkpoint.

**Key work:**

- Implement `OtelLoggerSink` and attach it at TypeAgent-owned logger composition
  roots.
- Add the opt-in, multi-instance-safe debug bridge.
- Implement the bounded, process-safe local OTel JSONL log.
- Correlate both log paths with Phase 1 spans while preserving stderr, CLI
  interception, and database sinks without duplicates.

**Exit criteria:** OTel logs from Structured Logger events and bridged debug
output carry active trace and span correlation. Local OTel JSONL output is valid
and process-safe, OTLP logs work when configured, and existing logging behavior
remains unchanged.

**Not included yet:** RPC client/server spans, cross-process propagation, or
metrics.

### Phase 3: Distributed Context and Functional MVP

**Objective:** Extend trace context across dispatcher, agent server, and agent
subprocess boundaries.

**Value:** One end-to-end trace across TypeAgent processes. This fulfills the
core TypeAgent observability value proposition.

**Key work:** Add RPC client/server spans, W3C `traceparent` injection and
extraction, explicit allowlisted TypeAgent metadata, validation at RPC trust
boundaries, and independent export from each process.

**Exit criteria:** One request forms a single correctly parented trace across the
dispatcher, agent server, and agent subprocesses.

This phase delivers the **Functional MVP**: core traces, correlated OTel logs
from Structured Logger events and bridged debug records, the local OTel JSONL
log, OTLP export, cross-process continuity, partner host trace-provider
compatibility, and the metric provider ownership and no-op seams implemented so
far. Application metrics are not included yet.

**Not included yet:** Metrics, browser/web propagation, HTTP/`undici`
auto-instrumentation, or production collector topology.

### Phase 4: Local Grafana Integration POC

**Objective:** Prove the Functional MVP against an optional local Grafana-based
backend.

**Value:** A visual workflow for developers and proof that standard OTLP
interoperates with a major backend.

**Key work:**

- Document a local reference setup, preferably Grafana `otel-lgtm` or Grafana
  Alloy with Tempo, Loki, and Grafana.
- Provide a minimal Docker command or compose/reference configuration.
- Configure TypeAgent OTLP HTTP or gRPC for the local receiver.
- Add short verification steps for a Phase 3 multi-process trace and correlated
  OTel logs. Include Loki trace-log correlation if feasible.

Grafana remains an optional development dependency, not a TypeAgent production
dependency.

**Exit criteria:** A developer starts the documented stack, runs one request,
and inspects its end-to-end spans and correlated logs in Grafana.

**Not included yet:** Custom dashboards, alerts, application metrics,
vendor-specific instrumentation, or production deployment guidance beyond stack
defaults.

### Phase 5: Metrics

**Objective:** Export the token and timing data TypeAgent already calculates.

**Value:** Aggregate latency, token-use, and reliability trends across requests.
This is the operational observability checkpoint.

**Key work:**

- Connect `TokenCounter` to token instruments.
- Connect `RequestMetricsManager` and profiler timing to request and phase
  duration instruments.
- Review every attribute for bounded cardinality and privacy.
- Expand the Grafana POC to query or display these metrics when practical,
  without adding vendor-specific instrumentation.

**Exit criteria:** In-memory readers verify token and duration values and
attributes. Partner host metric instrumentation joins the host meter provider.
The local POC can inspect the exported metrics when practical.

**Not included yet:** New business metrics, custom dashboards, alerts, or
vendor-specific instruments.

### Phase 6: Partner and Operational Hardening

**Objective:** Validate safe embedding and production-ready failure behavior.

**Value:** Safe, broader partner and production adoption.

**Key work:** Validate:

- Provider and no-provider behavior.
- Explicit logger-sink and debug bridge integration.
- Exporter, disk, queue, and shutdown failures.
- Privacy and cardinality controls.
- Enabled and disabled overhead.
- Documentation and dependency/convention compatibility.

**Exit criteria:** Partner host and operational tests demonstrate the stated
ownership, privacy, reliability, compatibility, and performance expectations.
The end of this phase is **Production-ready v1**.

**Not included yet:** Browser/web telemetry, HTTP auto-instrumentation, MCP OTel
stretch integration, production collector topology, or file rotation and
retention.

| Phase | Milestone                    |
| ----: | ---------------------------- |
|     0 | Internal readiness           |
|     1 | First usable OTel            |
|     2 | Local debugging checkpoint   |
|     3 | **Functional MVP**           |
|     4 | Grafana interoperability POC |
|     5 | Operational visibility       |
|     6 | **Production-ready v1**      |

Phases generally proceed in order. Phase 4 depends on Phase 3 so the Grafana POC
can demonstrate the complete Functional MVP. Metrics work may begin after Phase
0 in parallel, but the primary plan integrates it after the Grafana POC.

## Future / Stretch Considerations

### MCP OpenTelemetry Integration

- MCP does not define a complete telemetry signal model for span naming, metrics,
  logs, or exporters, but ecosystem integrations exist. The MCP Python SDK v2
  automatically creates server spans and propagates trace context from client to
  server.
- SEP-414 standardizes W3C context in MCP request `params._meta` using
  `traceparent`, `tracestate`, and optional `baggage`. TypeAgent should validate
  and extract this context before handling inbound MCP operations, then inject
  the active context into outbound requests.
- TypeAgent should create MCP client/server child spans and use compatible stable
  attributes, such as method, protocol, and tool-operation names. If the MCP SDK
  already emits the operation span, configure or reuse that integration instead
  of wrapping it with a duplicate span.
- Treat remote metadata as untrusted. Enforce format and size limits, and do not
  blindly propagate baggage or TypeAgent-private correlation fields. Apply the
  trust-boundary, privacy, and allowlisting rules above.
- Stdio propagation must use MCP message metadata because it has no HTTP headers.
  Streamable HTTP may receive context through transport headers and MCP `_meta`.
  Define one canonical extraction and injection policy so the two carriers
  cannot create conflicting parents.
- This work is a stretch goal after v1 rather than an additional implementation
  phase.

## Validation

Validation is incremental at each phase and remains backend-independent where
possible:

- Keep core behavior backend-independent. Use in-memory providers, exporters, and
  readers to cover configuration, resources, sampling, signal mapping,
  pre-record redaction, provider/no-provider behavior, converted failures, and
  coordinated flush.
- Use integration tests for logger and debug coexistence across distinct resolved
  `debug` instances, prior-hook restoration, duplicate prevention, valid ordered
  process-safe local OTel JSONL output, queue and disk failures, active-span
  correlation, and parent-child continuity across independently exporting RPC
  processes.
- Validate enabled, disabled, and unconfigured telemetry modes. Preserve `DEBUG`,
  runtime `@trace`, stderr, CLI and database logging, library no-op behavior,
  explicit log integration, and partner host provider participation.
- Exercise exporter, file, queue, and shutdown failures. Confirm that requests
  continue normally, buffers remain bounded, and shutdown completes within its
  timeout.
- Add an optional local Grafana POC smoke validation. Start the documented stack,
  run one multi-process request, and inspect its complete trace and correlated
  logs. After Phase 5, verify metrics there when practical. This supplements
  rather than replaces backend-independent tests.
- Measure representative disabled and enabled paths. Inspect emitted attributes
  for unacceptable overhead, privacy exposure, or cardinality growth.

Use the repository build and test flow:

```text
pnpm run build
pnpm --filter @typeagent/telemetry test
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
