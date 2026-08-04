<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# OpenTelemetry in TypeAgent

**Status:** Settled design; implementation pending

**Area:** `@typeagent/telemetry`, `aiclient`, dispatcher, RPC, and TypeAgent-owned Node hosts

**Scope:** Node-hosted traces, logs, metrics, context propagation, and local telemetry files

## Value Proposition

OpenTelemetry gives TypeAgent a structured, end-to-end view of every request, making local debugging faster today while preparing the codebase for production observability and partner integration tomorrow.

- **Local development:** Follow a request through translation, reasoning, LLM calls, action execution, agents, and RPC; identify latency and failures; correlate existing debug output; and save structured local traces and logs for parsing and comparison.
- **Beyond local development:** Export the same signals to OTLP-compatible platforms; build dashboards and alerts for latency, failures, token usage, and reliability; correlate TypeAgent with surrounding services; and remain vendor-neutral.
- **Partner value:** TypeAgent trace and metric instrumentation joins a host's global OTel providers and no-ops without them. Structured `Logger` events join the host pipeline only when the host attaches `OtelLoggerSink`; debug mirroring is a separate explicit opt-in. Partners retain control over SDK initialization, exporters, sampling, resources, privacy, storage, and governance.

**Bottom line:** one instrumentation model supports local debugging, production operations, and embedded TypeAgent libraries.

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

| Concern               | Existing mechanism                                         | OTel integration point                |
| --------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Developer tracing     | `debug` namespaces and runtime `@trace` control            | Correlated OTel log bridge            |
| Structured logging    | `Logger`, `LoggerSink`, `MultiSinkLogger`, `ChildLogger`   | Additional OTel logger sink           |
| Correlation           | `traceId`, `sessionId`, `activationId`, `hostName`         | OTel attributes and RPC metadata      |
| LLM usage             | `TokenCounter` and completion callbacks                    | Token metrics and LLM span attributes |
| Phase timing          | `RequestMetricsManager`, profiler, `StopWatch`             | Duration metrics and spans            |
| Redaction             | `filterSecrets`, `filterSecretsFromObject`, `SecretFilter` | Redaction before record/export         |
| Cross-process tracing | Debug namespace fan-out only                               | W3C context in RPC metadata           |

The design extends these seams rather than creating a parallel telemetry system.

## Design Overview

Add a small OTel module to the existing `@typeagent/telemetry` package.

```text
debug("typeagent:*") ──► optional debug bridge ─┐
Logger / LoggerSink ──► attached OtelLoggerSink ┴─► OTel Logs API ─► log provider/processors ─┬─► OTLP logs
                                                                                             └─► JSONL LogRecordExporter
TokenCounter / timings ───────────────────────────► OTel Metrics API ─► meter provider/readers ──► OTLP metrics
core operation boundaries ───────────────────────► OTel Trace API ───► tracer provider/processors ► OTLP traces

RPC metadata ◄──────────── traceparent plus explicit TypeAgent correlation fields ────────────►
```

The OTLP and JSONL export branches are independently optional and may be enabled together.

**Default policy:** OTel instrumentation is compiled in, but collection and export remain disabled until configured. TypeAgent-owned processes create only the providers, processors, and readers required by the configured signals. A JSONL-only configuration creates a logs pipeline, not trace or metric pipelines. Embeddable trace and metric instrumentation no-ops unless the host installs the corresponding provider; OTel logs use the separate `@opentelemetry/api-logs` API and also require both a logger provider and TypeAgent sink/bridge wiring. The debug bridge emits only namespaces enabled through `DEBUG` or `@trace`.

**Separate authoring interfaces, one observability pipeline.** The unification is downstream: `debug(...)` remains the lightweight, namespace-controlled developer interface for immediate terminal and CLI-panel output, while `logger.logEvent(...)` remains the structured event interface. The debug bridge and `OtelLoggerSink` feed both into the same correlated OTel log processing and export path.

The package uses a **thin hybrid facade**. Trace and metric instrumentation imports `@opentelemetry/api` directly; log adapters use `@opentelemetry/api-logs`. `@typeagent/telemetry` owns TypeAgent-host bootstrap, configuration, resources, redaction, the optional debug bridge, and `OtelLoggerSink`. It does not wrap OTel spans or instruments and does not re-export `getTracer()` or `getMeter()`.

The setup boundary is:

```ts
initTelemetry(options?): Promise<void>;
shutdownTelemetry(): Promise<void>;
createOtelLoggerSink(): LoggerSink;
```

There is no `TypeAgentSpan` abstraction or custom telemetry API layered over OTel.

## Ownership and Partner Integration

**Embeddable TypeAgent libraries** use the trace and metric APIs but never initialize or replace global providers. They join the host's active context, no-op without a provider, and use the host's exporters, sampling, resources, privacy policy, and configuration.

**TypeAgent-owned Node hosts** call `initTelemetry()` once per process and `shutdownTelemetry()` on exit. Shell main, CLI, agent server, dispatcher hosts, and agent subprocess hosts each install at most one process-global provider per enabled signal and export directly. There is no SDK or provider per library, agent, request, or session.

Global provider registration is first-writer-wins. TypeAgent-owned bootstrap runs before application instrumentation and treats an unexpected existing provider as a configuration conflict rather than silently claiming ownership. Embeddable code never replaces a host provider. Shutdown is idempotent but not restartable in the same process; it does not unregister or swap host globals.

Each subprocess receives W3C context over RPC, creates child spans with its own process-global provider, and exports them directly. Telemetry payloads are not routed through the dispatcher.

The ownership rule does not make existing `Logger` events automatic. TypeAgent-owned composition roots attach one `OtelLoggerSink` to each relevant `MultiSinkLogger` while preserving debug and database sinks. An embedding host that wants structured TypeAgent events must likewise attach the sink through the library's logger/integration option; merely installing an OTel SDK is insufficient. The sink emits through the host's global Logs API and does not initialize a provider.

Embeddable libraries never install a process-wide `debug` hook. A partner may explicitly install a TypeAgent-provided debug adapter at its composition root, accepting process-global hook behavior and identifying the `debug` module instances to cover.

## Signals

### Traces

Use manual spans at these boundaries: command/request handling, translation, reasoning when used, action execution, LLM calls, and RPC client/server operations.

Use manual LLM spans only in v1. Do not enable HTTP or `undici` auto-instrumentation; transport spans add noise and increase the risk of capturing headers or bodies without improving the operation-level view.

Spans record status and exceptions. Selected lifecycle and failure events may be added to spans, but ordinary debug output remains logs rather than being duplicated as span events.

### Logs and Debug Bridge

Today the paths are mostly separate: `debug(...)` formats text for stderr, while `Logger.logEvent(...)` creates structured events for logger sinks. `DebugLoggerSink` provides a limited one-way connection by serializing a structured event as JSON text under `typeagent:logger:*`; that flattening is lossy for downstream structured processing and does not itself provide OTel correlation or export.

JavaScript logs use the separate `@opentelemetry/api-logs` and `@opentelemetry/sdk-logs` packages, which remain experimental. Pin a mutually compatible reviewed package set rather than allowing independent range upgrades. `NodeSDK` may coordinate a logger provider only when configured with log processors/exporters; installing or starting it is not, by itself, the TypeAgent `Logger` integration.

The design preserves both producer APIs and unifies them downstream. `OtelLoggerSink` emits the redacted JSON-compatible `LogEvent.event` as the log body, adds `eventName` plus allowlisted scalar correlation fields as attributes, and leaves nested or unbounded fields out of attributes. This matches the current `ChildLogger`, which merges common properties into the event rather than preserving their provenance. Existing debug/database sinks continue alongside it. Debug messages remain text bodies with namespace attributes. Both paths share active trace/span correlation, resource attributes, redaction, batching, JSONL output, and OTLP export.

A process-wide `debug` hook mirrors enabled `typeagent:*` namespaces into OTel logs:

- It preserves `DEBUG` and runtime `@trace` namespace control.
- It excludes structured logger namespaces such as `typeagent:logger:*` because configured structured events reach OTel through `OtelLoggerSink`. It also excludes the bridge's own diagnostic namespace and `typeagent:telemetry:promptLogger` to prevent recursion or duplicate flattened records.
- It emits one log record per debug call, correlated with the active trace and span.
- `TYPEAGENT_OTEL_DEBUG_BRIDGE=off` disables the bridge independently.
- It tees to the exact prior `debug.log` implementation so stderr, color, timestamps, and CLI interception continue unchanged.
- It derives the namespace from the debug instance (`this.namespace`), not by parsing rendered text. The telemetry body is a separately rendered, ANSI-free string; formatted objects and multi-argument calls are tested explicitly.

The hook affects only the resolved `debug` module instance on which it is installed. TypeAgent agent processes can load a second instance from the agent module, as `agentProcess.ts` already recognizes when forwarding `enable()`. TypeAgent-owned bootstrap must install the bridge on each known distinct instance or document that only host-package debug calls are covered; it must not claim process-wide coverage from one hook. A debugger with its own instance-level `.log` override can also bypass a module-level hook and is outside v1 unless explicitly adapted.

Installation is reference-counted or otherwise idempotent, does not wrap the same instance twice, uses a reentrancy guard plus OTel suppression for exporter/diagnostic paths, and restores the exact prior hook on shutdown only if the bridge still owns it. These rules prevent duplicate records, recursive diagnostics, and damage to hooks installed by the host.

Developers should not emit both `debug()` and `logEvent()` for the same fact.

Debug log export follows enabled debug namespaces and the bridge toggle, independently of trace sampling. A log may therefore refer to a trace that the backend did not retain.

### Metrics

Surface values TypeAgent already calculates:

- `TokenCounter` feeds token-usage instruments. GenAI semantic conventions are still evolving, so implementation pins a reviewed convention version and schema URL; if the desired names are not stable in that version, use documented `typeagent.*` names rather than presenting experimental names as permanent.
- `RequestMetricsManager` and profiler timing feed request/phase duration instruments such as `typeagent.request.duration`.
- Stable attributes may include model, agent, operation, status, and token type.

Do not use session IDs, trace IDs, activation IDs, user text, or other unbounded values as metric attributes.

## Context and Attributes

Use W3C `traceparent` over TypeAgent WebSocket and RPC boundaries. Callers inject active trace context into a dedicated metadata envelope; receivers validate and extract it before handling the operation.

OTel generates the canonical trace ID. The existing caller-supplied `traceId` may be arbitrary, so preserve it as `typeagent.trace.id`.

Carry `typeagent.trace.id`, `typeagent.session.id`, and `typeagent.activation.id` as span and log attributes. When a TypeAgent subprocess needs them, send them as explicit, allowlisted TypeAgent RPC metadata rather than global W3C baggage. V1 does not inject these identifiers into generic HTTP propagation, because baggage can escape through downstream requests and cross partner trust boundaries.

Accept remote trace context only on designated TypeAgent RPC channels. Use the OTel propagator's parsing rules, bound the metadata/header size, ignore malformed context, and validate TypeAgent correlation fields for expected length and character set before attaching them. External or partner-supplied parent context is accepted only when the embedding boundary explicitly opts in; otherwise start a new root and optionally link to separately validated context.

TypeAgent-owned processes set process-level resource attributes once: `service.name`, `service.version`, a per-process `service.instance.id`, `host.name`, `os.type`, `process.pid`, `process.runtime.name`, `process.runtime.version`, and `deployment.environment`.

`activationId` is not `service.instance.id` and is not currently per request. The dispatcher creates it when `CommandHandlerContext` is initialized, so it identifies that dispatcher activation until the context is recreated.

Useful operation attributes include `typeagent.agent.name`, `typeagent.action.name`, `gen_ai.system`, and `gen_ai.request.model`.

High-cardinality correlation values belong on spans and logs, not metrics.

## Configuration and Local Files

TypeAgent-owned processes support a `telemetry:` section in TypeAgent YAML:

```yaml
telemetry:
  otlpEndpoint: http://localhost:4318
  logFile: ~/.typeagent/logs/telemetry-{service}-{pid}.jsonl
  debugBridge: true
  tracesSampler: always_on
```

Standard `OTEL_*` environment variables override YAML. Relevant settings include `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG`, `TYPEAGENT_OTEL_LOG_FILE`, and `TYPEAGENT_OTEL_DEBUG_BRIDGE`. TypeAgent resolves this configuration first and passes explicit signal components to the SDKs; it does not rely on SDK defaults that may create exporters for unspecified signals.

Partner libraries do not read TypeAgent telemetry configuration; they use the host's OTel configuration.

### Sampling

- Local development captures 100% of traces when trace export is enabled unless explicitly overridden.
- Deployed TypeAgent-owned processes use standard configurable OTel sampling.
- Partner hosts own sampling for embedded TypeAgent libraries.

### Local JSONL Logs

`TYPEAGENT_OTEL_LOG_FILE` or YAML `logFile` enables direct local OTel log output:

- One valid JSON object per line with timestamp, severity, body, namespace/event name, resources, `trace_id`, `span_id`, and TypeAgent correlation attributes.
- Implemented as an OTel `LogRecordExporter` behind a bounded `BatchLogRecordProcessor`, not as a parallel TypeAgent event format or an ambiguously named SDK processor.
- Asynchronous writes serialized in accepted-record order, with a bounded queue and explicit drop accounting when full.
- Open, write, and disk-full failures are isolated from request handling, rate-limited in diagnostics, and disable or retry the writer according to a documented policy rather than growing memory without bound.

The path supports `{service}` and `{pid}` expansion. `~` is expanded with `os.homedir()` before `path.resolve()` so YAML behaves consistently on Windows; placeholder values are filename-safe. If `{pid}` is absent, insert `.<pid>` before the extension so separate processes never share a writer. Create the parent directory recursively. External tooling or the OS owns rotation, retention, archival, and deletion.

JSONL and OTLP are additive. JSONL covers logs only; OTLP through a local collector remains the path for all signals, cross-process aggregation, and production parity.

If neither OTLP nor JSONL is configured, `initTelemetry()` registers no providers and OTel API calls remain no-ops. Signal-specific `OTEL_*_EXPORTER=none` settings are honored; configuration must not accidentally create default trace or metric exporters while enabling only JSONL logs.

## Privacy and Reliability

- Do not capture raw prompts, responses, user content, or known secrets by default.
- Gate sensitive development capture behind an explicit developer setting and retain redaction.
- TypeAgent-controlled bridges and sinks apply `filterSecrets`, `filterSecretsFromObject`, and registered `SecretFilter` values before creating each log record. TypeAgent span attributes are similarly filtered before `setAttribute()` when their source is not already allowlisted.
- Processors/exporters provide defense in depth for TypeAgent-created attributes, but cannot guarantee redaction of arbitrary log bodies or events emitted directly by partner code or other instrumentation.
- Partner hosts own final export filtering and privacy policy.
- Never put user content or secrets in metric attributes.

Use batch processors so export remains off the request path. `initTelemetry()` is idempotent. It retains the exact providers/processors/exporters and debug-hook restorers that TypeAgent created. `shutdownTelemetry()` coordinates them with a bounded timeout and is also idempotent.

`NodeSDK.shutdown()` flushes and shuts down the tracer, meter, and logger providers that the `NodeSDK` instance actually created. It does not cover a separately constructed `LoggerProvider`, an unattached `OtelLoggerSink`, or an independent file writer. The preferred JSONL design registers its exporter with the owned logger provider so provider shutdown reaches it; any separately owned component must be explicitly included in coordinated shutdown.

Wire awaited shutdown into normal owned-host exit paths and graceful `SIGINT`/`SIGTERM` handlers. Do not rely on `beforeExit` alone, and do not call `process.exit()` before the bounded flush completes. Forced termination may still lose buffered telemetry.

Exporter and file failures degrade to missing telemetry, never a failed TypeAgent request. Report failures through OTel diagnostics or a guarded telemetry debug namespace so error reporting cannot recurse into the failing exporter.

## Developer Usage

Ordinary debug and structured logging calls do not change.

A span is a timed record for one meaningful operation. `startActiveSpan()` starts
the timer and makes that span current for the async callback. Awaited or nested
instrumented work uses OTel async context to become a child automatically; do not
pass span objects through every function. OTel logs, and enabled `typeagent:*`
debug output mirrored by the debug bridge, receive the current trace and span IDs.

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
`translateRequest()` contains an instrumented cache or LLM call, its span becomes
a child of `typeagent.translate`. Debug or OTel logs emitted before the callback
finishes are correlated with the same active span.

Use each signal for a different purpose:

| Signal          | Use                                                                 |
| --------------- | ------------------------------------------------------------------- |
| Span attributes | Stable facts and query dimensions, such as agent, action, or model  |
| Span events     | Timestamped milestones within the operation, such as starting retry |
| Logs            | Diagnostic detail useful while investigating one request            |
| Metrics         | Aggregated counts and durations across many requests                |

Failures need explicit recording when TypeAgent converts an exception into an
`ActionResult` instead of letting it escape:

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

Without `recordException()` and error status, this span could appear successful
because the callback returns an `ActionResult`. Always call `span.end()` in
`finally`, whether the operation succeeds, throws, or converts the error.

Active context also creates the expected nesting without plumbing spans through
translation and action APIs:

```text
typeagent.command
├── typeagent.translate
│   └── typeagent.llm
└── typeagent.execute_action
```

Logs emitted in any node carry that node's trace and span IDs automatically.

**When should I add one?**

- Add a span for an externally meaningful or independently timed boundary.
- Add one for an async, RPC, or LLM call, a retry or fallback, or an operation
  whose latency or failure needs separate diagnosis.
- Do not add one for trivial helpers, every debug line, or work already covered
  by an existing core span.

A manual span marks a meaningful boundary, not every function. Do not add another
span around an existing core boundary, and do not emit both a debug line and a
structured log event for the same fact.

## Implementation Plan

### Phase 0 — Foundation

**Objective:** Establish the shared OTel runtime and test seams without changing application signals.

- **Key work:** Add dependencies and module structure in `@typeagent/telemetry`; define instrumentation names and scope; implement signal-specific configuration resolution and an idempotent lifecycle coordinator with resource, redaction, no-op, timeout, and in-memory injection seams. Wire lifecycle only into TypeAgent-owned Node entry points.
- **Exit criteria:** Each owned process remains a no-op when unconfigured, starts only requested signal components, and cleanly shuts down every component it created.
- **Not included yet:** Application logs, spans, metrics, or cross-process propagation.

### Phase 1 — Logs and Local Diagnostics

**Objective:** Produce useful local and exported diagnostics while preserving current logging behavior.

- **Key work:** Implement `OtelLoggerSink`; attach it at TypeAgent-owned logger composition roots; add the opt-in, multi-instance-safe debug bridge; and implement the bounded JSONL `LogRecordExporter`. Preserve local debug/database behavior, redact before record creation, and coordinate logger-provider/exporter shutdown.
- **Exit criteria:** JSONL-only mode works without trace or metric providers; local files are parseable; OTLP logs are emitted when configured; active trace context is attached when present; and existing stderr/CLI/database sinks behave as before.
- **Not included yet:** New application spans, distributed propagation, or metrics.

### Phase 2 — Core Traces

**Objective:** Trace the main request path within one process and correlate its logs.

- **Key work:** Add manual spans at command/request, translation, reasoning, `executeAction`, and LLM boundaries. Record status and exceptions explicitly where code converts or swallows errors, and correlate OTel logs with the active span.
- **Exit criteria:** One process produces a coherent request trace covering the selected boundaries, including accurate failure status and correlated logs.
- **Not included yet:** RPC client/server spans or cross-process context propagation.

### Phase 3 — Distributed Context

**Objective:** Extend core traces across dispatcher, agent server, and agent subprocess boundaries.

- **Key work:** Add RPC client and server spans plus W3C `traceparent` inject/extract and explicit allowlisted TypeAgent correlation metadata. Validate remote metadata, keep it off generic downstream HTTP, and export directly from each process.
- **Exit criteria:** One end-to-end request forms a single trace across processes with correct parent-child relationships and independent export.
- **Not included yet:** Browser/web propagation or HTTP/`undici` auto-instrumentation.

### Phase 4 — Metrics

**Objective:** Export the token and timing data TypeAgent already calculates.

- **Key work:** Connect `TokenCounter` to token instruments and `RequestMetricsManager` and profiler timing to request/phase duration instruments. Review every attribute for bounded cardinality and privacy.
- **Exit criteria:** In-memory readers verify token and duration values and attributes, with no correlation IDs or user content on metrics.
- **Not included yet:** New business metrics, dashboards, alerts, or vendor-specific instruments.

### Phase 5 — Partner and Operational Hardening

**Objective:** Validate safe embedding and production-ready failure behavior.

- **Key work:** Verify trace/metric libraries join host providers and no-op without them; verify structured logs require explicit sink attachment and debug bridging requires explicit host opt-in; validate failure isolation, coordinated shutdown, documentation, and disabled-path overhead.
- **Exit criteria:** Partner-host tests cover provider-only, sink-attached, debug-opt-in, and no-provider cases, and operational tests demonstrate the stated privacy, reliability, and performance expectations.
- **Not included yet:** Browser/web telemetry, HTTP auto-instrumentation, collector topology, or file rotation and retention.

Phases proceed in order because distributed context depends on core spans. Metrics may begin after Phase 0 in parallel if resourcing allows.

## Validation

Validation is incremental at each phase and remains backend-independent where possible:

- Use unit tests with in-memory providers, exporters, and readers for configuration, resources, sampling, signal mapping, pre-record redaction, no-provider behavior, error handling, and coordinated flush behavior.
- Use integration tests for logger/debug coexistence across distinct resolved `debug` instances, prior-hook restoration, valid and ordered JSONL output, queue overflow/disk failure, active-span correlation, and parent-child continuity across RPC processes that export independently.
- Run compatibility checks with telemetry enabled, disabled, and unconfigured to preserve `DEBUG`, runtime `@trace`, library no-op behavior, and host-provider participation.
- Exercise exporter and file failures to confirm requests continue normally and shutdown completes.
- Measure disabled and representative enabled paths to detect unacceptable overhead or cardinality growth.

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
