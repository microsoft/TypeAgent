<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# OpenTelemetry in TypeAgent

**Status:** Settled design; implementation pending

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

The sink emits through the host's global Logs API and does not create a provider.
Embeddable libraries never install a process-wide debug hook. A partner may
install the adapter at its composition root and identify each `debug` module
instance it wants covered.

TypeAgent-owned Node hosts call `initTelemetry()` once and
`shutdownTelemetry()` on exit. Each process installs at most one global provider
per enabled signal and exports directly. Libraries, agents, requests, and
sessions do not create providers.

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

The debug bridge tees enabled `typeagent:*` calls into OTel without changing
their original output:

- Preserve `DEBUG`, `@trace`, stderr, colors, timestamps, and CLI interception.
- Call the exact prior `debug.log` implementation, and restore it on shutdown
  only while the bridge still owns it.
- Derive the namespace from the debug instance; render the OTel body separately
  without ANSI codes.
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

## Configuration and Local Files

TypeAgent-owned processes support:

```yaml
telemetry:
  otlpEndpoint: http://localhost:4318
  logFile: ~/.typeagent/logs/typeagent-{service}-{pid}.jsonl
  debugBridge: true
  tracesSampler: always_on
```

Standard `OTEL_*` variables override YAML. Relevant settings include:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_SERVICE_NAME`
- `OTEL_RESOURCE_ATTRIBUTES`
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
$env:TYPEAGENT_OTEL_LOG_FILE = "$HOME\.typeagent\logs\typeagent-{service}-{pid}.jsonl"
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

Expand `~` before `path.resolve()`. Sanitize `{service}` and `{pid}`. If `{pid}`
is absent, insert it before the extension so processes never share a writer.
Create parent directories and report the resolved path once through a status or
diagnostic path that cannot recurse into the exporter.

The OS or external tools manage rotation and retention. JSONL and OTLP are
additive. A JSONL-only configuration creates only the logs provider.

## Privacy and Reliability

- Do not capture prompts, responses, user content, or known secrets by default.
- Gate sensitive development capture behind an explicit setting.
- Apply `filterSecrets`, `filterSecretsFromObject`, and registered
  `SecretFilter` values before creating TypeAgent log records.
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

```ts
import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("typeagent");

return tracer.startActiveSpan("typeagent.translate", async (span) => {
  try {
    span.setAttribute("typeagent.agent.name", agentName);
    return await translateRequest(request);
  } catch (error) {
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
});
```

`startActiveSpan()` makes nested async work a child automatically. Logs emitted
inside the callback receive its trace and span IDs. If code converts an exception
to `ActionResult`, it must still record the exception and error status.

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
