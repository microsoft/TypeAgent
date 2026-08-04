<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# OpenTelemetry in TypeAgent — Design & Spec

**Status:** Draft — proposal, no production code yet.
**Last Updated:** 2026-08-03
**Area:** `ts/packages/telemetry` (new OTel module), `ts/packages/aiclient`, `ts/packages/dispatcher`, host processes (shell / cli / agentServer / agent subprocesses).
**Scope:** How TypeAgent should adopt OpenTelemetry (OTel) for traces, metrics, and logs; how it integrates with the existing `debug` tracing; and whether we need a TypeAgent-specific wrapper versus using the OTel API directly. This document does **not** cover choosing a specific backend/vendor or dashboards.

---

## Revision Notes (2026-08-03)

Two review passes on the original draft:

- **Iteration 1 (architecture & correctness).** Resolved the `traceId`
  reconciliation open question (an arbitrary string cannot be an OTel
  `trace_id` — carry it as an attribute). Fixed `service.instance.id` (a
  process-level id, not the per-session `activationId`). Made the debug bridge
  filter to `typeagent:*` and **exclude** the structured `typeagent:logger:*`
  namespaces so structured events are not exported twice. Split log-record vs.
  span-event emission so a single debug call does not produce duplicate
  signals. Added an explicit **lifecycle / shutdown-flush** requirement (short-
  lived cli/agent subprocesses drop data without it) and documented exporter-
  failure isolation. Corrected the LLM token metric to the real semantic
  convention (`gen_ai.client.token.usage` histogram, `gen_ai.token.type`).
- **Iteration 2 (developer experience & value).** Added a concrete facade
  surface (`@typeagent/telemetry`: `initTelemetry`, `shutdownTelemetry`,
  `getTracer`, `getMeter`, `createOtelLoggerSink`) and copy-pasteable snippets
  for the common paths (untouched debug calls, a manual span, a metric,
  structured logging, tests). Added a "what you get automatically vs. when to
  instrument manually vs. what must never go in attributes" guide, and replaced
  generic observability claims with specific TypeAgent scenarios.

## Goals

- Emit **traces, metrics, and logs** via OpenTelemetry from the core request path (dispatcher → translation → action execution) and the LLM client (`aiclient`).
- **Bridge the existing `debug` output into OTel** so developers keep using `DEBUG=typeagent:*` and that same signal can flow to an OTel backend without rewriting call sites.
- Preserve the existing internal `Logger`/`LoggerSink` abstraction and its **default dimensions** (`hostName`, `traceId`, `sessionId`, `activationId`) by adding an OTel sink rather than replacing the pipeline.
- **Propagate context** (trace/session/activation IDs) across TypeAgent's process boundaries (dispatcher ↔ agent subprocesses ↔ agent-server ↔ shell/cli over RPC).
- Apply **secret redaction** consistently before anything leaves the process.
- Make instrumentation **opt-in and zero-cost when disabled** (no exporter configured ⇒ no OTel SDK started).

## Non-Goals

- Not replacing `debug` as the developer-facing local tracing mechanism; `DEBUG=typeagent:*` stays.
- Not removing or rewriting the existing `Logger`/`MultiSinkLogger`/Cosmos/Mongo sinks; OTel is an **additional** sink/exporter.
- Not picking a concrete vendor/collector topology, dashboards, or alerting.
- Not auto-instrumenting every one of the ~289 files that call `debug` with manual spans. Manual spans are added only at meaningful boundaries.
- No token-budget/cost gating on telemetry (per repo convention, cost is not a constraint).

## Current-State Observations

TypeAgent already has most of the _concepts_ OTel formalizes, just not the wire format:

| Concern                   | Today                                                                                                                                                                                                            | Files                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Tracing (dev)**         | `debug` package, namespaces `typeagent:<area>:<sub>`; enabled via `DEBUG` env or the `@trace` command at runtime; `~683` call sites across `~289` files.                                                         | pervasive; `traceCommandHandler.ts`                                                           |
| **Runtime trace control** | `@trace` handler mutates `process.env.DEBUG`, calls `registerDebug.enable/disable`, and **fans out to agent subprocesses** via `setTraceNamespaces` → `provider.setTraceNamespaces` → `agent.trace(namespaces)`. | `traceCommandHandler.ts`, `appAgentManager.ts:1963`, `npmAgentProvider.ts:270`                |
| **Structured logging**    | `@typeagent/telemetry` `Logger`/`LoggerSink`; `MultiSinkLogger` fans to sinks; `ChildLogger` injects **common properties**. Sinks: `debug`, MongoDB, Cosmos DB.                                                  | `telemetry/src/logger/*`                                                                      |
| **Default dimensions**    | `ChildLogger(..., DispatcherName, { hostName, traceId, sessionId, activationId })`. `traceId` is passed in via `options.traceId`; `activationId = randomUUID()`.                                                 | `commandHandlerContext.ts:1187`                                                               |
| **Metrics**               | `TokenCounter` singleton (LLM prompt/completion/total tokens, keyed by `tags`); `RequestMetricsManager` + profiler/`StopWatch` for phase timing.                                                                 | `aiclient/src/tokenCounter.ts`, `dispatcher/.../utils/metrics.ts`, `telemetry/src/profiler/*` |
| **LLM usage hooks**       | `CompleteUsageStatsCallback` + `TokenCounter.getInstance().add(usage, tags)` already sit at every completion path.                                                                                               | `openai.ts`, `copilotModels.ts`, `ollamaModels.ts`                                            |
| **Redaction**             | Dependency-free `filterSecrets` / `filterSecretsFromObject` / `createSecretFilter` (known values + format detectors).                                                                                            | `utils/commonUtils/src/secretFilter.ts`                                                       |
| **Correlation / context** | `traceId` / `sessionId` / `activationId` exist as logger dimensions but are **not** propagated as a formal trace context across RPC.                                                                             | —                                                                                             |
| **OTel today**            | None. No `@opentelemetry/*` dependency anywhere in the repo.                                                                                                                                                     | (verified)                                                                                    |

Key takeaways: (1) there is already a **sink abstraction** and a **default-dimension** mechanism to hook into; (2) `debug` is the dominant, runtime-controllable, cross-process trace signal we must respect; (3) LLM token usage and phase timings are already captured and just need to be surfaced as OTel metrics; (4) redaction already exists and must be the enforcement point.

## Proposed Architecture

Introduce a small OTel module inside the existing `@typeagent/telemetry` package (it already owns the sink/logger abstractions and depends on `debug` and `common-utils`). Three OTel signals map onto existing seams:

```
                         @typeagent/telemetry (new: src/otel/*)
                         ┌─────────────────────────────────────────────┐
  debug("typeagent:*") ──┤ debug→OTel bridge  ──▶ Logs                  │
  Logger/LoggerSink   ───┤ OtelLoggerSink     ──▶ Logs (structured)     │──▶ OTLP exporter
  TokenCounter / timing ─┤ meters/counters    ──▶ Metrics               │    (opt-in)
  manual spans (API)  ───┤ tracer boundaries  ──▶ Traces                │
                         │ resource attrs + redaction + context prop.   │
                         └─────────────────────────────────────────────┘
```

- **Bootstrap** (`initTelemetry()`): each host process (shell main, cli, agentServer, agent subprocess) calls a single init that, _only if an exporter is configured_, starts the NodeSDK with the shared **resource attributes**, registers exporters, and installs the debug bridge. If no exporter env is set, it is a no-op and the OTel API returns cheap no-op implementations. The matching `shutdownTelemetry()` flushes and stops the SDK on process exit (see "Lifecycle").
- **OtelLoggerSink**: implements the existing `LoggerSink` interface and is appended in `getLoggerSink()` (`commandHandlerContext.ts`) and `PromptLogger`, alongside the debug/DB sinks. Each `LogEvent` becomes an OTel log record; the `ChildLogger` common properties become log attributes, so `hostName`/`traceId`/`sessionId`/`activationId` carry through unchanged. This is the **structured** path — the debug bridge deliberately skips these events (below) so they are not exported twice.
- **debug→OTel bridge**: install one custom `registerDebug.log`. Whenever an enabled `typeagent:*` namespace fires, the formatted line is emitted as an OTel log record. It runs only when telemetry is initialized. See "Debug integration" below for the namespace filtering and the span-event opt-in.
- **Metrics**: register an OTel `Meter`; feed `TokenCounter.add(...)` into `gen_ai.client.token.usage` (histogram; attribute `gen_ai.token.type` = `input`/`output`, per the GenAI semantic convention) and `RequestMetricsManager`/profiler durations into `typeagent.request.duration` (histogram, per-phase). These are additive callbacks at sites that already compute the numbers.
- **Traces**: use the `@opentelemetry/api` tracer **directly** at a handful of boundaries — request handling in the dispatcher, translation, `executeAction`, and each LLM call in `aiclient`. The existing `traceId`/`sessionId`/`activationId` ride along as span attributes/baggage (they are correlation keys, _not_ the OTel `trace_id`; see "Context Propagation").

### Debug Integration

The user's explicit ask: debug output should emit telemetry. The mechanism is one
custom log function, because that is exactly what `debug` supports.

**How the hook works.** Inside `debug`, an enabled namespace runs
`const logFn = self.log || createDebug.log; logFn.apply(self, args)`
(`debug/src/common.js`). So a single assignment to `registerDebug.log` intercepts
**every enabled namespace in the process**, TypeAgent's and third-party's alike, and
receives the _already-formatted_ argument list (namespace prefix + message, colors
applied). Two consequences drive the design:

1. **Filter to `typeagent:*`.** The bridge checks `this.namespace` and ignores
   anything that is not a TypeAgent namespace, so a chatty dependency that uses
   `debug` does not flood the exporter.
2. **Exclude the structured namespaces.** `typeagent:logger:*` (from
   `createDebugLoggerSink`) and `typeagent:telemetry:promptLogger` already reach OTel
   as _structured_ records via `OtelLoggerSink`/`PromptLogger`. The bridge skips these
   namespaces so each structured event is exported once, with fields intact, instead
   of a second time as a flattened string. Redaction disable of colors (`inspectOpts`)
   keeps the captured body clean.

**Logs, not span events, by default.** Each mirrored line becomes one OTel **log
record**. If a span is active, the log record is automatically correlated to it by
`trace_id`/`span_id` through the active context — no separate span event is needed.
Emitting _both_ a log record and a span event for the same `debug(...)` call would
double the signal, so span-event emission is **off by default** and gated behind an
opt-in flag for the rare case a backend shows events but not logs.

**Runtime control is preserved.** The bridge honors the _same_ enabled-namespace set
that `@trace` toggles, because it reads `debug`'s own enabled check. Enabling/disabling
a namespace at runtime turns its OTel logs on/off too, including across agent
subprocesses via the existing `setTraceNamespaces` fan-out. `TYPEAGENT_OTEL_DEBUG_BRIDGE=off`
decouples export volume from local `DEBUG` verbosity when needed.

### Wrapper Decision (facade vs. direct OTel API)

**Recommendation: a _thin, hybrid_ TypeAgent facade — wrap only bootstrap, configuration, and the bridges; use the `@opentelemetry/api` directly for manual spans and metric instruments.**

Concretely, `@typeagent/telemetry` gains exactly these exports (nothing that shadows
the OTel API):

```ts
// @typeagent/telemetry  (new: src/otel/*)
initTelemetry(options?): Promise<void>;   // start SDK if an exporter is configured; else no-op
shutdownTelemetry(): Promise<void>;       // flush + stop; call on process exit
createOtelLoggerSink(): LoggerSink;       // append alongside debug/DB sinks
getTracer(name?): Tracer;                 // thin re-export of trace.getTracer, pre-namespaced "typeagent"
getMeter(name?): Meter;                   // thin re-export of metrics.getMeter, pre-namespaced "typeagent"
```

`getTracer`/`getMeter` are one-line conveniences that default the instrumentation-scope
name to `typeagent`; call sites are free to import `@opentelemetry/api` directly instead.
There is intentionally **no** `TypeAgentSpan`, `startSpan` wrapper, or metric wrapper.

Rationale, grounded in the current code:

- **A facade is justified for cross-cutting setup, not for instrumentation.** The things that genuinely need one home are: SDK bootstrap, the shared **resource attributes**, exporter/config resolution, the **debug→OTel bridge**, the `OtelLoggerSink`, **redaction enforcement**, and **context propagation across RPC**. These are exactly the pieces that would otherwise be duplicated and drift across the shell / cli / agentServer / agent-subprocess entry points. Centralizing them mirrors the existing `getLoggerSink()` pattern.
- **Do _not_ wrap the tracer/meter APIs.** `@opentelemetry/api`'s `trace`/`metrics` are _already_ a stable, vendor-neutral facade with a built-in no-op default. Re-wrapping them would add indirection with a single implementation (an anti-pattern this repo explicitly flags), make stack traces worse, and fight future auto-instrumentation. Manual spans/counters should import the OTel API directly at the ~handful of boundaries that need them.
- **Consistency of defaults is the real problem the facade solves.** Today `hostName`/`traceId`/`sessionId`/`activationId` are attached by hand in one place (`ChildLogger` construction). The facade makes the process-level ones **resource attributes** and the per-request ones propagated baggage, so every signal — trace, metric exemplar, log — carries them uniformly.

| Option                                         | Pros                                                                                                                    | Cons                                                                                                           | Verdict                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **A. Full wrapper** over trace/metric/log APIs | One import surface; can swap OTel out                                                                                   | Indirection with one impl; obscures spans; reinvents the OTel API; drift risk                                  | Rejected — over-engineering                       |
| **B. Direct OTel everywhere**, no facade       | No new abstraction                                                                                                      | Duplicated bootstrap/resource/redaction/propagation in every process; debug bridge has no home; defaults drift | Rejected — no place to enforce redaction/defaults |
| **C. Thin hybrid facade (recommended)**        | Single home for bootstrap/resource/exporter/bridge/redaction/propagation; instrumentation uses stable OTel API directly | Two idioms to learn (facade for setup, API for spans)                                                          | **Chosen**                                        |

### Default Resource Attributes / Dimensions

Set once at SDK init as OTel **resource attributes** (semantic-convention names where they exist), so they attach to every span/metric/log:

- `service.name` = `typeagent` (or `typeagent.dispatcher`, `typeagent.shell`, `typeagent.agent.<name>` per process role).
- `service.version` = package version; `service.instance.id` = a UUID generated once at process start (a _process_ identity). Note: this is **not** the per-session `activationId`, which is created later per `ChildLogger` and can vary within a process — `activationId` is a per-request span/log attribute, not a resource attribute.
- `host.name` = existing `hostName`; `os.type`, `process.pid`, `process.runtime.name/version` (Node).
- `deployment.environment` = dev / ci / prod (from config).

Per-request/session dimensions carried as span attributes + log attributes (and metric attributes where low-cardinality): `typeagent.session.id`, `typeagent.trace.id` (existing `traceId`), `typeagent.activation.id`, `typeagent.agent.name`, `typeagent.action.name`, and for LLM spans `gen_ai.system` / `gen_ai.request.model`. High-cardinality values (session/trace IDs, user text) go on **spans/logs only, never metric labels**.

### Configuration & Exporters

- **OTLP** (`@opentelemetry/exporter-*-otlp-*`) driven by standard env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER`, …). Presence of an endpoint is the on-switch.
- TypeAgent config surfaces (env / `config.local.yaml`) may set these; the facade reads config once and translates to OTel env/SDK options so we do not invent a parallel config schema.
- Sampling: parent-based + ratio sampler, configurable; default `off`/very low in dev to keep `debug` cheap.
- No exporter configured ⇒ SDK not started ⇒ OTel API no-ops ⇒ effectively zero overhead.

### Context Propagation

- Adopt W3C `traceparent`/`baggage` propagation. TypeAgent already crosses process boundaries via WebSocket/RPC (`agentRpc`, `agentServer`, agent subprocesses). Inject/extract trace context at those RPC seams so a request's spans in the dispatcher, agent subprocess, and agent-server share one trace.
- **`traceId` reconciliation (resolved).** The existing `options.traceId` is an arbitrary caller-supplied string; an OTel `trace_id` must be a 16-byte hex value, so the existing id **cannot** be used as the OTel trace id. Decision: let OTel generate the canonical `trace_id`, and carry the existing value as the `typeagent.trace.id` attribute (and in baggage) for correlation with pre-OTel logs. `activationId`/`sessionId` likewise travel as baggage so downstream processes and their logs/metrics inherit them.
- The `@trace`/`setTraceNamespaces` fan-out is the model to follow for pushing propagation config to subprocesses.

### Lifecycle: init, flush, and shutdown

- `initTelemetry()` runs once per process, before other imports create spans. It is idempotent and a no-op when no exporter is configured.
- **Flush on exit is mandatory.** cli invocations and agent subprocesses are short-lived; without a flush, the batch exporters drop everything buffered when the process ends. `shutdownTelemetry()` (which calls `NodeSDK.shutdown()` → force-flush) must be wired to `SIGINT`/`SIGTERM` and `beforeExit` in each host entry point. This is the single most common way to "lose" telemetry, so it belongs in the facade, not each call site.
- **Exporter failures are isolated.** Use the batch span/log processors so export is asynchronous and off the request path; OTLP errors are swallowed and surfaced only through OTel's `diag` logger, never thrown into TypeAgent code. A backend outage degrades to no telemetry, never to a failed request.

### Privacy / Redaction

- **All** exported attributes/log bodies pass through the existing `filterSecrets` / `filterSecretsFromObject` before leaving the process. The facade owns a `SpanProcessor`/log-record processor (and pre-export hook on the `OtelLoggerSink`) that runs redaction so no instrumentation site can forget it.
- Known secret values already registered with a `SecretFilter` (API keys from config) are redacted in addition to format detectors.
- Default to **not** capturing raw user text or full prompts on spans; gate any prompt/response capture behind an explicit developer-mode flag (mirroring `PromptLogger`/`DevTrace`, which already exist and are dev-gated). LLM spans record token counts and model, not content, by default.
- Never place user content or secrets in **metric labels** (cardinality + privacy).

## Using It (Developer Experience)

The design point: **the common case is no work at all.** Instrument by hand only at
the few boundaries where a span or metric adds real signal.

**What you get automatically (no code changes):**

- Every existing `debug("typeagent:...")` call is mirrored to OTel logs when an
  exporter is configured — the ~683 existing call sites need no edits.
- Every structured `logger.logEvent(...)` reaches OTel with its fields and the
  default dimensions (`hostName`/`traceId`/`sessionId`/`activationId`).
- LLM token usage and request/phase timings become metrics from the existing
  `TokenCounter` / `RequestMetricsManager` hooks.
- Resource attributes, redaction, and context propagation are applied for you.

**When to add a manual span:** you want a _timed, correlated_ unit of work that
isn't already a boundary — e.g. wrapping a new multi-step operation so its latency
and failures show up as their own span under the request trace.

**When to add a metric:** you have a number worth aggregating across requests (a
count, a duration, a size). One-off values belong on a span, not a metric.

### 1. Ordinary debug — unchanged

```ts
import registerDebug from "debug";
const debug = registerDebug("typeagent:dispatcher:translate");
debug("translated request in %dms", elapsed); // now also an OTel log when enabled
```

### 2. A manual span (direct `@opentelemetry/api`)

```ts
import { trace, SpanStatusCode } from "@opentelemetry/api";
const tracer = trace.getTracer("typeagent"); // or getTracer() from @typeagent/telemetry

async function executeAction(action, context) {
  return tracer.startActiveSpan("executeAction", async (span) => {
    span.setAttribute("typeagent.agent.name", action.agent);
    span.setAttribute("typeagent.action.name", action.name);
    try {
      return await runAction(action, context);
    } catch (e) {
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.end();
    }
  });
}
```

`startActiveSpan` makes the span current, so nested spans and any `debug(...)` logs
inside `runAction` correlate to it automatically — no context threading.

### 3. A metric (direct `@opentelemetry/api`)

```ts
import { metrics } from "@opentelemetry/api";
const meter = metrics.getMeter("typeagent"); // or getMeter() from @typeagent/telemetry
const tokenUsage = meter.createHistogram("gen_ai.client.token.usage");

tokenUsage.record(usage.prompt_tokens, {
  "gen_ai.token.type": "input",
  "gen_ai.request.model": model, // low-cardinality only
});
```

### 4. Structured logging (unchanged; default dimensions come for free)

```ts
logger.logEvent("actionCompleted", { agent: action.agent, durationMs });
// hostName/traceId/sessionId/activationId are injected by ChildLogger and become log attributes
```

### 5. Tests (offline, in-memory exporter)

```ts
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
// init the SDK with an InMemorySpanExporter, run the code under test, then:
const spans = exporter.getFinishedSpans();
expect(spans.map((s) => s.name)).toContain("executeAction");
```

### What must never go in attributes

- **Metric labels:** no user text, no session/trace/activation IDs, no unbounded
  values — only low-cardinality keys (model name, agent name, token type, status).
  High cardinality blows up the metrics backend.
- **Any signal:** no secrets and no raw prompts/responses by default. Redaction runs
  before export as a backstop, but don't rely on it — keep content off spans unless
  the dev-mode prompt-capture flag is on.

### Avoiding duplicate signals

- Don't emit a `debug(...)` line _and_ a structured `logEvent(...)` for the same
  fact — pick one. The bridge already excludes `typeagent:logger:*` so structured
  events aren't double-exported.
- Don't wrap something that is already a span boundary (dispatcher request,
  translation, `executeAction`, LLM call) in another span for the same work.

## Why This Pays Off — TypeAgent Scenarios

Concrete wins that the current `debug`-only setup cannot give:

- **Dispatcher latency breakdown.** With spans at request → translation → cache
  lookup → `executeAction`, one trace shows _where_ a slow request spent its time
  (e.g. LLM translation vs. agent execution) instead of scattered timestamped log
  lines. `typeagent.request.duration` per phase turns this into a p50/p95 dashboard.
- **Agent execution failures.** An `executeAction` span with `ERROR` status and a
  recorded exception, tagged `typeagent.agent.name`/`action.name`, makes "which agent
  is failing and how often" a query, not a log grep.
- **RPC correlation across processes.** W3C propagation across the `agentRpc`/WebSocket
  seams stitches dispatcher, agent subprocess, and agent-server spans into **one
  trace**, so a request that fans out to a subprocess is followed end-to-end — today
  those are disconnected `debug` streams in separate processes.
- **LLM/token metrics.** `gen_ai.client.token.usage` (input/output) and per-model
  request counts/durations, sourced from the existing `TokenCounter` and completion
  callbacks, give token-per-request and cost-shape trends across models without any
  new bookkeeping.

## Rollout Phases

1. **P0 — Foundation (facade + config, no signals yet).** Add OTel deps to `@typeagent/telemetry`; implement `initTelemetry()` bootstrap, resource attributes, exporter/config resolution, and the redaction processor. No-op when unconfigured. Wire `initTelemetry()` into each host entry point.
2. **P1 — Logs + debug bridge.** Add `OtelLoggerSink` to `getLoggerSink()` and `PromptLogger`; install the debug→OTel bridge honoring enabled namespaces. Deliverable: existing `debug`/`Logger` output reaches an OTLP backend with default dimensions.
3. **P2 — Metrics.** Register a `Meter`; route `TokenCounter` and `RequestMetricsManager`/profiler numbers into counters/histograms. Deliverable: token usage + phase-latency dashboards.
4. **P3 — Traces + propagation.** Manual spans at dispatcher request / translation / `executeAction` / `aiclient` completion; W3C propagation across RPC seams; carry the existing `traceId` as `typeagent.trace.id`. Deliverable: end-to-end distributed traces spanning subprocesses.
5. **P4 — Hardening.** Sampling tuning, cardinality review, dev-mode prompt capture gating, docs + an architecture page under `docs/architecture/`.

## Testing / Validation

- **Unit (`*.spec.ts`, offline):** `OtelLoggerSink` maps `LogEvent` → OTel record with expected attributes; debug bridge mirrors only enabled namespaces; redaction processor scrubs known values + patterns from span/log attributes; init is a no-op with no exporter configured. Use the OTel **in-memory exporter** so tests need no backend and stay in `test:local`.
- **Integration (`*.test.ts`, live):** stand up an in-process OTLP/collector stub; assert a request produces one trace spanning dispatcher → agent subprocess with shared trace/session IDs, and token-usage counters increment.
- **Regression:** confirm `DEBUG=typeagent:*` output and the `@trace` command behavior are unchanged with the bridge installed and with OTel disabled.
- **Shutdown flush:** assert `shutdownTelemetry()` force-flushes buffered spans/logs so a short-lived cli/agent-subprocess run does not drop data on exit.
- **Overhead check:** measure request latency with OTel unconfigured to confirm the no-op path is effectively free.
- Build/test via the repo flow: `pnpm run build`, `pnpm --filter @typeagent/telemetry test`.

## Open Questions

- [ ] Where does the SDK live for **agent subprocesses** — one SDK per process (simple, more exporters) vs. funneling child telemetry back through the dispatcher over RPC?
- [ ] Do we want auto-instrumentation for HTTP/`undici` in `aiclient`/`restClient`, or manual LLM spans only (less noise, less redaction risk)?
- [ ] Default sampling ratio in dev vs. prod, and whether the debug bridge should be sampled independently of traces.
- [ ] Browser/Electron renderer + browser-extension surfaces: in-scope for OTel-JS (web) later, or Node-host processes only for v1?
- [ ] Config surface: reuse raw `OTEL_*` env vars as the source of truth, or expose a TypeAgent-shaped config block in `config.local.yaml` that the facade translates?

_(Resolved during review: `traceId` reconciliation — OTel generates the canonical `trace_id`; the existing string rides along as `typeagent.trace.id`. See "Context Propagation".)_

## References

- `ts/packages/telemetry/src/logger/logger.ts` — `Logger`/`LoggerSink`/`ChildLogger`/`MultiSinkLogger`.
- `ts/packages/telemetry/src/logger/debugLoggerSink.ts` — existing `debug` sink.
- `ts/packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts` — `getLoggerSink()`, default dimensions.
- `ts/packages/dispatcher/dispatcher/src/context/system/handlers/traceCommandHandler.ts` — runtime `@trace` control.
- `ts/packages/dispatcher/dispatcher/src/context/appAgentManager.ts`, `nodeProviders/.../npmAgentProvider.ts` — `setTraceNamespaces` cross-process fan-out.
- `ts/packages/aiclient/src/tokenCounter.ts`, `openai.ts`, `copilotModels.ts` — token-usage metrics hooks.
- `ts/packages/dispatcher/dispatcher/src/utils/metrics.ts`, `telemetry/src/profiler/*` — phase timing.
- `ts/packages/utils/commonUtils/src/secretFilter.ts` — redaction.
