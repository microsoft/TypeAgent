<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# Local OpenTelemetry Debugging

**Status:** Draft (Phase 0/1 implementation in progress)

**Area:** `@typeagent/telemetry`, dispatcher, TypeAgent-owned Node hosts

**Last updated:** 2026-08-14

## Decision Summary

TypeAgent separates local telemetry into two independent controls:

- **`@trace`** is the only runtime knob for debug **producers**: the Node
  `debug` package's namespace patterns, its stderr output, `process.env.DEBUG`
  for future child processes, and propagation to active and future agents.
- **`@log`** is the only runtime knob for local OTel **sinks**: the local
  profile, whether enabled debug output is copied into the OTel logs pipeline
  JSONL file (`debug-copy`), local status, and reset.

`@log` never modifies debug namespace selection. `@trace` never changes what
the local OTel exporters or the debug-copy bridge do. The two commands share
no state beyond the fact that `@log status` reads the current `@trace` patterns
so a developer can see everything in one place.

Existing `@trace` syntax and behavior are preserved unchanged. `@trace` adds
one optional flag, `--preset <name>`, whose value expands to existing debug
namespace patterns; presets are not new namespaces and are not persisted state.

Named local profiles (`focused`, `diagnostic`, `verbose`, `off`) control local
OTel export, not debug filtering. Structured logger events are curated at the
event-emission site and are included unfiltered in every non-`off` profile.

## Problem Statement

An audit of 29 local telemetry files found that 2,523 of 2,579 records were
bridged debug records; one 1.2 MB file contained 1,611 debug records and only
four structured records. The dominant sources were startup, agent and schema
loading, semantic embeddings, cache loading, and transport payloads. Useful
request-flow information was buried.

The audit also showed that the debug bridge's include/exclude prefixes were
immutable once installed. `@trace` could change the debug namespace selection
at runtime, but nothing could turn off the copy from `debug` to OTel logs
without a restart. Some users implicitly expected `debugBridge: true` to be
their "verbose local logging" switch, which conflated two distinct concerns:
debug producers and local OTel capture.

## Goals

- Give developers a small, readable local telemetry stream by default.
- Keep debug producers and OTel sinks independently controllable at runtime,
  with clearly named commands (`@trace` and `@log`) that never surprise each
  other.
- Preserve the current `@trace` syntax, `DEBUG` semantics, `debugBridge`
  configuration, and partner-host no-op behavior.
- Provide friendly named presets for common `@trace` scenarios without
  inventing new debug namespaces.
- Keep sensitive or high-volume content out of normal local capture.

## Non-Goals (Phase 0/1)

- Duration-based logging (`@log for 10m ...`), timeline commands, and
  custom local span viewers. Developers use the supported local Grafana OTLP
  stack for trace visualization. The grammar `@log next-request` may be
  reserved for a future phase but is not implemented in Phase 1.
- Replacing the `debug` package or the Structured Logger producer APIs.
- A mutable-at-runtime namespace-matcher policy on the debug bridge beyond the
  simple enabled/disabled gate that Phase 1 introduces.
- Full production LLM/request-tree instrumentation. Existing stable spans and
  attributes continue to be produced by their existing call sites; changes to
  those are out of scope for Phase 0/1.
- Deciding a production OTLP collector/backend strategy. The general
  [OpenTelemetry design](./opentelemetry.md) remains authoritative for
  production and partner integration.

## Current Behavior That Must Be Preserved

- `@trace` reads the current effective settings via `debug.disable()`, appends
  new namespaces or `--clear`s them, writes `process.env.DEBUG`, calls
  `agents.setTraceNamespaces(settings)`, then `debug.enable(settings)`.
- `telemetry.debugBridge` (YAML) and `TYPEAGENT_OTEL_DEBUG_BRIDGE` (env) remain
  valid, and `true` continues to install the debug-copy bridge at startup.
- `telemetry.structuredLogs` (YAML) and `TYPEAGENT_OTEL_STRUCTURED_LOGS` (env)
  continue to be an explicit opt-in for the dispatcher's structured OTel
  logger sink.
- `telemetry.logFile` continues to write the local JSONL log file at the
  configured path (default `~/.typeagent/logs/typeagent-{service}-{process}-{pid}.jsonl`
  when a log file is configured).
- Partner hosts that do not initialize an OTel provider must see no runtime
  effect from any of these controls.

## Command Grammar

### `@trace`

```text
@trace [--clear|-*]
       [--preset <name>[,<name>...]]...
       [<namespace>...]
```

Semantics identical to the pre-existing handler, extended only by
`--preset`:

- `--clear` (or `-*`) empties the current debug settings string.
- Positional `<namespace>` values are appended to the settings string.
- Each `--preset <name>` expands to the preset's registered debug patterns and
  is appended alongside positional args. Unknown preset names fail the command
  without changing the current settings.
- After the settings string is composed, the handler updates
  `process.env.DEBUG`, calls `agents.setTraceNamespaces(settings)`, and
  invokes `debug.enable(settings)`. This is the existing sequence.

Presets available in Phase 1:

| Preset        | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| `request`     | Queue lifecycle, request correlation, command processing |
| `translation` | Command resolution, grammar, model translation           |
| `reasoning`   | Reasoning orchestration                                  |
| `actions`     | Action setup and execution                               |
| `rpc`         | Client/server calls and transport                        |
| `cache`       | Construction, semantic, and agent cache decisions        |
| `agents`      | Agent selection, activation, process lifecycle           |
| `startup`     | Host, telemetry, and initialization                      |

Presets are TypeAgent-owned bundles of `debug` namespace patterns and nothing
more. They are not new namespaces, they are not persisted, and enabling a
preset via `@trace --preset X` is exactly equivalent to typing the patterns
it expands to. The authoritative list of expansions lives in
`packages/telemetry/src/otel/localTelemetryState.ts` (`TRACE_PRESETS`) and is
published verbatim by `@log status` so a developer can see the exact patterns
that would be selected.

### `@log`

```text
@log status
@log profile <focused|diagnostic|verbose|off>
@log debug-copy <on|off>
@log clear
```

Semantics:

- `status` (also the default subcommand of `@log`) prints:
  - the current local profile;
  - the current `debug-copy` state;
  - the current `@trace` patterns and whether they came from `env DEBUG` or
    from runtime `@trace` calls;
  - every preset name and the exact patterns it would expand to;
  - the local JSONL log path if `telemetry.logFile` is configured;
  - trace and meter provider availability, plus whether local JSONL is
    configured.
    Never prints secrets. No environment values beyond the `DEBUG` string.
- `profile <name>` replaces the local profile. `off` disables local OTel
  capture; it does not clear `@trace` and it does not change
  `process.env.DEBUG`.
- `debug-copy on|off` controls whether enabled debug records are admitted to
  the local JSONL exporter. When on, only debug output that is already enabled
  by `DEBUG` or `@trace` is written locally; `debug-copy` never enables
  namespaces and never changes OTLP export. Default off unless the existing
  explicit `debugBridge: true` configuration enables compatibility behavior.
- `clear` returns local settings to `focused` and `debug-copy off` in a single
  atomic update. It leaves `@trace` unchanged and does not touch
  `process.env.DEBUG`.

### Reserved for future phases

`@log next-request ...` is documented as reserved so tooling can prepare for
it, but is not implemented in Phase 1. Duration-based logging (`@log for
<duration> ...`) and timeline commands are not part of the settled model and
are not reserved.

## Profiles

| Profile      | Local OTel export | Structured logs     | Bridged debug                                                   | Intended use                      |
| ------------ | ----------------- | ------------------- | --------------------------------------------------------------- | --------------------------------- |
| `focused`    | Enabled           | All approved events | Written locally only when `debug-copy on` and namespace enabled | Default daily development         |
| `diagnostic` | Enabled           | All approved events | Written locally only when `debug-copy on` and namespace enabled | Investigating a subsystem         |
| `verbose`    | Enabled           | All approved events | Written locally only when `debug-copy on` and namespace enabled | Deep investigation                |
| `off`        | Disabled          | Suppressed locally  | Suppressed locally                                              | Stop TypeAgent local JSONL writes |

Phase 1 concretely implements the following per-profile differences:

- `focused`, `diagnostic`, and `verbose` all admit every approved structured
  event to the OTel logger sink when `telemetry.structuredLogs === true`.
  Structured logger events are curated at emission and are already privacy
  reviewed; no additional filter is applied on the local sink.
- `off` suppresses emission through the dispatcher's structured OTel logger
  exporter only. OTLP logs, traces, and metrics are unaffected by the profile.

`focused`, `diagnostic`, and `verbose` are semantically identical in Phase 1
for the sinks that exist today. The three names are established so future
phases can differ in local span/event verbosity without redefining the
command surface.

Profiles never modify `DEBUG` or `@trace` patterns. `debug-copy` is a
separate boolean toggle and is orthogonal to profile.

## Structured Event Policy

Structured logger events remain the responsibility of the emitting call site.
The dispatcher's OTel projection lives in
`packages/dispatcher/dispatcher/src/otel/structuredLogSink.ts` and continues
to allowlist a fixed set of safe fields (`SAFE_STRING_FIELDS`,
`SAFE_NUMBER_FIELDS`, `SAFE_BOOLEAN_FIELDS`, `SAFE_STRING_ARRAY_FIELDS`) with
bounded string and array lengths. There is no event-name filter; every
approved structured event flows through in every non-`off` profile.

Current structured event names include `dispatcher:command` and
`dispatcher:requestQueue:*`. These are event names on the Structured Logger,
not `debug` namespaces, and `@trace` has no effect on them.

## JSONL Contract Direction (Phase 0 statement)

Today the local JSONL file is an OTel logs file (`packages/telemetry/src/otel/jsonlLogExporter.ts`)
produced by the standard log record processor. It contains OTel log records
only. Debug output is copied into it when `debug-copy` is on and a namespace
is enabled. Structured events land in it when `structuredLogs` is on and the
profile is not `off`.

The local JSONL remains a log-focused artifact. Spans continue through OTLP and
are viewed with the supported local Grafana stack. Phase 1 does not add span
records, a custom span file format, or an inline trace viewer.

## Stable Span, Event, and Attribute Names

The current stable contract in
`packages/telemetry/src/otel/traceContract.ts` remains authoritative:

- Span names (`TYPEAGENT_SPAN_NAMES`): `typeagent.request`,
  `typeagent.translation`, `typeagent.reasoning`, `typeagent.action`,
  `typeagent.llm`.
- Attribute keys (`TYPEAGENT_SPAN_ATTRIBUTES`): `typeagent.agent.name`,
  `typeagent.action.name`, `gen_ai.system`, `gen_ai.request.model`,
  `typeagent.session.id`, `typeagent.activation.id`, `typeagent.trace.id`.

Phase 1 adds no new stable span names or attribute keys. Any additions in
later phases must be added to the frozen constants in `traceContract.ts` and
must remain backward-compatible: existing keys keep their names, and no
required attribute becomes optional or vice versa.

## Runtime State

Phase 1 introduces one small in-process state object owned by
`@typeagent/telemetry`:

- Type `LocalTelemetryProfile = "focused" | "diagnostic" | "verbose" | "off"`.
- `TRACE_PRESETS`: frozen record from preset name to a readonly string array
  of `debug` namespace patterns.
- `expandTracePresets(names)`: returns `{ patterns, unknown }`.
- `LocalTelemetrySnapshot`: profile, debug-copy state, immutable capabilities,
  and revision (frozen).
- The snapshot also reports immutable process capabilities:
  `debugBridgeAvailable` and `localLogAvailable`.
- `createLocalTelemetryState(...)` returns an object with `getSnapshot()`,
  `setProfile(p)`, `setDebugCopy(bool)`, and `clear()`. Every mutation
  atomically replaces the snapshot and bumps `revision`; `onChange` fires
  after the swap.
- Module-level `getLocalTelemetryState()` / `setLocalTelemetryState()` allow
  `initTelemetry()` to install one state instance. Libraries default to a
  no-op instance so callers never crash when no host has installed one.

The debug bridge continues to copy enabled debug calls into the shared OTel
logs pipeline whenever `debugBridge: true`. Runtime local filtering occurs in
the processor dedicated to `JsonlLogExporter`, at the OTel `onEmit` boundary:

- profile `off` rejects every local JSONL record;
- debug records (`eventName === "debug"`) are rejected while `debugCopy` is
  false; and
- structured records are accepted in every non-`off` profile.

Filtering at `onEmit` makes each record use the settings active when it was
produced rather than settings observed later by an asynchronous batch export.
The filter wraps only the JSONL processor because the same OTel Logs provider
may also have an OTLP processor. `@log` must never suppress OTLP records.

The state is process-scoped. An `@log` command controls the dispatcher-host
process and its per-process JSONL file. It does not propagate to agent
subprocesses in Phase 1. `@log status` reports the process ID and configured
path so this scope is visible. `@trace` propagation remains unchanged.

## Configuration Compatibility

Existing configuration keys and environment variables retain their meaning:

```yaml
telemetry:
  debugBridge: true # Produce OTel copies of enabled debug namespaces.
  structuredLogs: true # Also send structured events through OTel logs.
  logFile: ~/.typeagent/logs/typeagent-{service}-{process}-{pid}.jsonl
  otlpEndpoint: ... # Unchanged.
```

- When both `debugBridge: true` and `logFile` are configured, local
  `debug-copy` starts on for compatibility. A developer can turn local copying
  off at runtime without affecting stderr or OTLP.
- `debugBridge: false` (or unset) does not install the bridge. `@log
debug-copy on` reports that no bridge is available.
- `structuredLogs: true` remains the opt-in for structured events to reach
  OTel logs. Profile `off` suppresses them only in local JSONL; OTLP remains
  unchanged. Other profiles do not filter beyond the existing allowlist.
- `logFile` continues to configure the local JSONL path.
- `DEBUG` continues to control the Node `debug` package selection. `@trace`
  reads and writes it; `@log` never touches it.

Phase 1 introduces no new YAML keys and no new environment variables.

## Testing

### Automated

- `expandTracePresets` returns the exact registered patterns for known
  presets and reports unknown names without partial success.
- Runtime state transitions are atomic: revision monotonically increases,
  snapshots are frozen, `onChange` fires exactly once per mutation, and
  `clear()` bumps revision once (not once per field).
- The JSONL processor admits structured records in non-`off` profiles, filters
  debug records while `debug-copy` is off, and filters all local records while
  the profile is `off`, using the state active when each record is emitted.
- `@log status` output includes profile, debug-copy state, current
  `@trace` patterns, preset expansions, local capabilities, process scope, and
  provider availability, and prints no secrets.
- `@log profile` accepts only the four documented values.
- `@log debug-copy on` reports an actionable error when the bridge or local
  JSONL exporter is not configured.
- `@log clear` resets to `focused` + `debug-copy off` and does not change
  `process.env.DEBUG`.
- `@trace --preset <name>` expands to the registered patterns; unknown preset
  names fail the command without changing state.
- OTLP structured and debug records remain unaffected by local profile and
  debug-copy changes.

### Representative local scenario (proof)

For an offline command such as `@help`:

- With `focused` profile and `debug-copy off`, the local JSONL contains
  structured events (`dispatcher:command`, `dispatcher:requestQueue:*`) and
  no `debug` records.
- After `@trace --preset request` (a narrow preset) and `@log debug-copy on`,
  the local JSONL contains the same structured events plus only the debug
  records for namespaces the preset enabled. Namespaces the preset did not
  enable remain absent.

## References

- [OpenTelemetry in TypeAgent](./opentelemetry.md)
- `packages/telemetry/src/otel/localTelemetryState.ts` - runtime state and
  preset registry
- `packages/telemetry/src/otel/debugBridge.ts` - OTel debug producer bridge
- `packages/telemetry/src/otel/bootstrap.ts` - runtime state initialization
- `packages/telemetry/src/otel/traceContract.ts` - stable span/attribute names
- `packages/telemetry/src/otel/jsonlLogExporter.ts` - current local file format
- `packages/dispatcher/dispatcher/src/context/system/handlers/logCommandHandler.ts`
- `packages/dispatcher/dispatcher/src/context/system/handlers/traceCommandHandler.ts`
- `packages/dispatcher/dispatcher/src/otel/structuredLogSink.ts`
