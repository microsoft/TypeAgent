# Connected AppAgent Provider — Decisions Log

> Every decision **not specified in** or **changed from** the
> [DESIGN.md](./DESIGN.md), appended as it is made. See
> [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) for the milestone structure.

## Milestone 2 — Cutover

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

## Milestone 4 — Per-name lifecycle tracker & failure semantics

- **`Map<name, DynamicAgentEntry>` replaces the flat `installedProviders` map.**
  An entry is `active { provider }` or `removing { provider, pending, then? }`.
  This is the source of truth for the dynamic set (design §7.2).

- **Drain coordination (`startDrain`).** `pending` starts as every connected host
  plus the issuing host. Each host's `removeProvider` settle — success, failure,
  OR disconnect — drops it from `pending` (via `.finally(drainDrop)`), so a failed
  or gone sibling never wedges name reuse (design §7.3/§7.4). When `pending`
  empties the name is freed (`entries.delete`) and any `then` runs.

- **`update` is a disruptive drain-then-add (global no-coexistence, §7.2).**
  Materialize P2 → write record (commit point) → drain P1 across **all** sessions
  → only then add P2 (the drain's `then`). This is stronger than M3's per-client
  remove-then-add: P2 is never added anywhere until P1 is gone everywhere, so two
  versions of a name can never be loaded at once. **Consequence:** during an
  update the agent is briefly absent in every session; the user's `@update`
  returns after the issuing-session remove + record commit, and the re-add lands
  post-drain (async). A failed materialize before the commit is a no-op (old entry
  stays `active`).

- **Load tombstone (`withTombstone`, §7.3).** Installed providers are wrapped so
  `loadAppAgent` throws while the name is `removing`, even if a draining session
  still holds the instance — nothing resurrects a name mid-teardown.

- **Name-reuse gating (§7.3).** `install`/`uninstall`/`update` reject with "still
  being removed; retry shortly" (`assertNotRemoving`) while a name is draining.

- **`listInstalled` hides `removing` names**, and `connect` vends only `active`
  entries (a connecting session never picks up a draining name), and `dispose`
  drops the host from every draining `pending` set (§7.3).

- **Failure semantics (§7.4).** The `agents.json` write is the commit point; the
  issuing host is awaited (error surfaces) but the record stays committed;
  siblings are best-effort (throw caught + logged) and still drop from `pending`.




## Post-M5 — Enable-state redesign ("Model B", §5)

The M1–M5 `withDisabledByDefault` + explicit-`enable` policy (installed agents
forced off, issuing session forced on) was reworked after review. Symptom: the
issuing session's install-enable was applied live but **not persisted**, while
`withDisabledByDefault` forced the manifest default to false — so any later
`setAppAgentStates` (any `@config`, a slow-agent schema-ready refresh, session
reload, or restart) recomputed the agent to `config[foo] ?? false = disabled`,
silently turning a just-installed agent off. That is a regression vs. today
(manifest default true → agents stay on).

**Decision (Model B), approved by the user ("agree with the sub-decision; the
table looks right; implement and update the design doc"):**

- **Honor the manifest default.** Remove `withDisabledByDefault`; installed
  agents derive state from `config[name] ?? manifestDefault` like bundled agents.
  `AppAgentHost.addProvider` drops the `enable` param (keeps only `notify`).
- **Persist enable state** (already true via `@config` → `updateSettings`);
  honoring the manifest default removes the clobber without an explicit persist.
- **"No surprise" via notification, not forcing-off.** Issuing conversation:
  inline result. Every other affected conversation: a system message (live
  siblings now; offline conversations on next open).
- **Load-time reconciliation** (`reconcileKnownAgents`, §5). Each session
  persists a `knownAgents` set; on load / session-switch it reports agents that
  appeared (added — enabled/disabled) or disappeared (removed) while offline,
  batched into one message. First load with no baseline is a silent baseline
  (covers brand-new sessions and the first load after upgrade). Also covers a
  new build changing **static** (bundled/mcp) agents.
- **Sub-decision — removal disposition.** Reconciliation-removal leaves the
  session's enable preference **dormant** (config entry stays, inert while the
  agent is absent); explicit `@uninstall` **drops** the config entry so a fresh
  reinstall starts clean from the manifest default.

**Files:** `session.ts` (persisted `knownAgents` + get/set); `agentProvider.ts`
+ `appAgentHost.ts` (`addProvider(provider, notify?)`, `applyAdd(provider,
notify)`); `commandHandlerContext.ts` (`hostAddProvider` = `installAppProvider` +
mark-known + notify; `hostRemoveProvider` drops config + unmarks known;
`emitAgentChangeNotification` reworded; new `reconcileKnownAgents` called at init
+ `setSessionOnCommandHandlerContext`; `applyExplicitAgentState` deleted);
`defaultAgentProviders.ts` (`withDisabledByDefault` removed; `fanOutAdd` siblings
`addProvider(p, true)`, issuing `addProvider(p, false)`).

**Green:** dispatcher full suite (1009, +6 reconciliation tests) +
default-agent-provider install-sources (153) + packageAgent (11) + appAgentHost
(25, +6 reconciliation, notification wording updated). Layering unchanged
(agent-dispatcher never imports default-agent-provider).
