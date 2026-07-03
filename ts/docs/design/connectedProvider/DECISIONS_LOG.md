# Connected AppAgent Provider — Decisions Log

> Every decision **not specified in** or **changed from** the
> [DESIGN.md](./DESIGN.md), appended as it is made. See
> [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) for the milestone structure.

## Milestone 1 — Dispatcher seams

- **Applicator idle-gating uses `context.commandLock` (the single-slot `Limiter`).**
  The design (§7.1) specifies "apply at the session's next idle" but does not
  name the mechanism. The dispatcher already serializes user commands through
  `context.commandLock` (a `createLimiter(1)`). The `AppAgentHost` applicator
  enqueues each op onto that same limiter, so an op runs between user commands
  (when the single slot is free) and never interleaves with an in-flight
  command. This reuses the existing FIFO/serialization guarantee rather than
  building a second idle-detector.

- **`AppAgentHost` / `AppAgentSource` / `AppAgentConnection` live in
  `agentProvider.ts`** alongside the (still-present in M1) `AppAgentInstaller`,
  and are re-exported from the package barrel (`src/index.ts`), matching how
  `AppAgentProvider` is exported. Keeps all host-facing contracts in one module.

## Milestone 2 — Cutover

- **`@package` agent name is `"package"`, command-only, normally-enabled**
  (`commandDefaultEnabled: true`, no schema). It is NOT added to
  `alwaysEnabledAgents` — unlike `system` it can be toggled via `@config`. The
  host contributes it as its own app agent (design §3.4).

- **The `@package list` per-agent emoji is dropped.** The old core handler looked
  up emoji via `context.agents.getAppAgentEmoji`. The host-owned
  `PackageAgentContext` has no `AppAgentManager` (that is exactly the layering the
  cutover enforces), so the list now renders agent name + reference without an
  emoji column. Cosmetic only; the `@package` surface is otherwise unchanged.

- **`InstallCommandHandler` drops the live `agents.isAppAgentName(name)`
  pre-check.** Name uniqueness is enforced at the record-store write
  (`agents.json`) and builtins are rejected by the source's `isBuiltin` check
  (design §4: "validation locus moves to the record store"). The legal-name regex
  check stays in the handler, before materialize.

- **`getDefaultAppAgentProviders` no longer includes the installed multi-root
  provider.** Installed agents are vended by the connected `AppAgentSource` as
  per-agent single-root providers (design §3.3). `getIndexingServiceRegistry`
  still enumerates installed agents via a private `getInstalledAppAgentProvider`
  helper so their indexing services are not lost. Other static callers of
  `getDefaultAppAgentProviders` (collision runners, schemaStudio, tests) run
  without an instance dir / with an empty `agents.json`, so dropping installed is
  a no-op for them.

- **The concrete source exposes an `api` property** (the write/command surface —
  `InstalledAgentSourceApi`) alongside `connect()`. `getDefaultAppAgentSource`
  narrows the return to `AppAgentSource` (connect only) for hosts;
  `createDefaultInstalledAgentSource` returns the wider type for the `@package`
  agent wiring and tests. Matches design §3.2 ("the concrete host object also
  carries the write/command surface, but the dispatcher is handed only the narrow
  connect view").

- **`installAppProvider` (the pre-M1 register path) is retained** for the
  `connect()` init registration of the vended providers. Removal is deferred to
  Milestone 5 (cleanup) per the plan.

- **Source `install`/`uninstall`/`update` return provider(s), not void.** `update`
  returns `{ oldProvider, newProvider }` and `uninstall` returns `{ provider }` so
  the `@package` handler can drive `AppAgentHost.removeProvider`/`addProvider`
  (remove-then-add) itself. In M3 this fan-out moves into the source.

