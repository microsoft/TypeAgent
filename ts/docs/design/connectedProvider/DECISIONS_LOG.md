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

## Milestone 3 — Fan-out & enable policy

- **`AppAgentHost.addProvider`/`removeProvider` gained an optional `notify`
  param** (extends design §3.1). It drives the sibling system message (§5): the
  issuing session passes `notify=false` (reports inline via `actionIO`); siblings
  pass `notify=true` and the dispatcher surfaces a `clientIO.notify` Info message
  naming the agent + its resulting state. Chosen over a separate notification
  channel because the applicator already runs in the sibling's context and has
  `clientIO`; the flag cleanly distinguishes fan-out from initial connect
  registration (which does not notify).

- **Fan-out lives in the source** (design §4). `install`/`uninstall`/`update` now
  take the `issuingHost` and iterate the `clients` registry: siblings are
  enqueued fire-and-forget FIRST (best-effort; a throw is caught + logged per
  client, never failing the committed op), then the issuing host is **awaited**
  (errors surface to the user). Enqueuing siblings before awaiting issuing means a
  busy issuing session never delays sibling delivery. The `@package` handler is
  now a thin delegator (validates the name, calls the source, displays the
  result).

- **Installed agents are disabled by default in every session (§5)** — implemented
  by wrapping the vended installed provider's `getAppAgentManifest`
  (`withDisabledByDefault`) to force **all four** enable-default fields
  (`defaultEnabled`, `schemaDefaultEnabled`, `actionDefaultEnabled`,
  `commandDefaultEnabled`) to `false`. This makes both the register-time state
  derivation and the session-config default land on "off", and prevents an
  installed agent that explicitly sets e.g. `commandDefaultEnabled: true` from
  silently turning itself on in a non-issuing session (which would violate §5 "no
  surprise"). A user's explicit per-session `@config agent` enable (persisted in
  the conversation config) still wins (config precedence).
  **Consequence:** after `@install` + restart, the agent is disabled until
  re-enabled — the issuing session's live-enable is not persisted (matching
  today's install, which also did not persist enable). This is the §5 "no
  surprise" intent: an agent is on only where/when explicitly enabled.
  _(The all-four-fields strengthening was applied during the M3 gate round 2.)_

- **`update` fans out remove-then-add per client** (issuing awaited; siblings
  best-effort). M3 relies on the applicator's FIFO to keep remove-before-add per
  session; the full **no-coexistence drain** across sessions (§7.2) is added in
  Milestone 4.


