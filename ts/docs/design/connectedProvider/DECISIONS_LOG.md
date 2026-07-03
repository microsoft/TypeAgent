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
