# Natural-language actions for every TypeAgent `@` command

Status: In progress. This document is the source of truth for giving every
bundled executable TypeAgent `@` command a behaviorally equivalent
natural-language action. Progress lives in [STATUS.md](./STATUS.md).

## Goal and completion contract

The coverage universe is every bundled command descriptor returned by the
default providers: bare commands, explicit leaf descriptors, inline defaults,
and string-referenced default aliases. Tables that only group children are
namespaces and do not require actions.

No built-in command category is excluded. Agent and system commands, auth and
OAuth callbacks, configuration, diagnostics, developer tools, lifecycle
operations, browser controls, and platform-specific commands all remain in
scope. Environment-specific commands may return the same unavailable result as
their command path on an incompatible host.

A command is covered only when:

1. Its action is exported by a registered schema and resolves unambiguously.
2. Representative natural-language requests translate to that action with the
   correct parameters and defaults.
3. Action and command preserve the same side effects, errors, readiness gates,
   confirmations, and result behavior.
4. Both paths invoke the same command pipeline or typed helper.
5. Translation and command/action parity are tested.

`CommandDescriptor.action` is metadata only. Adding a link never creates
natural-language support and does not count as completion by itself.

## Verified baseline

Phase 0 replaced the old leaf estimate with executable-endpoint enumeration.
The baseline on 2026-07-31 is:

- 387 executable command endpoints
- 13 endpoints with valid action links (including inherited defaults)
- 374 endpoints with no action link
- 0 invalid declared links
- `mcpfilesystem` explicitly omitted because its action schema is generated at
  runtime and has no static payload without server arguments

## Mechanism and reference

- SDK field: `packages/agentSdk/src/command.ts` (~L45) —
  `CommandDescriptor.action?: string | { schema: string; actionName: string }`.
  This is **metadata only**: it records the equivalent action so tooling can
  cross-reference a typed command with its NL action. It does not itself wire
  execution.
- Reference implementation to copy (the `@system conversation` / `@system
history` commands are the only 12 that already declare the link):
  - Command handlers: `packages/dispatcher/dispatcher/src/context/system/handlers/conversationCommandHandlers.ts`
    (each handler has `public readonly action = "newConversation"` etc.) and
    `.../handlers/historyCommandHandler.ts`.
  - Action schema: `.../system/schema/conversationActionSchema.ts`.
  - Action handler: `.../system/action/conversationActionHandler.ts` — each
    action **delegates to its equivalent `@conversation` command** so the logic
    lives in exactly one place and the two paths cannot drift.
  - Tests: `.../test/conversationGrammar.spec.ts` and
    `.../test/conversationActionHandler.spec.ts`.
- Coverage verifier:
  `node tools/actionBrowser/dist/cli.js --check`. During migration,
  `--allow-missing` keeps missing actions visible without failing; invalid,
  ambiguous, or dangling declarations always fail.
- Object links use the fully qualified `ActionConfig.schemaName`, for example
  `{ schema: "browser.actionDiscovery", actionName: "inferActions" }`. A bare
  action name is valid only when unique across the host's registered schemas.

## Known corrections from review

- localPlayer `play` was broader than `playFile`; `shuffle` and `mute` toggled
  state while the old actions were explicit setters. The first implementation
  slice resolved these with `play`, `toggleShuffle`, and `toggleMute` actions.
- Browser `extractKnowledge` has no registered `extractPageKnowledge` action;
  `ask` points at an inactive `searchWebMemories` type; and `actions record` is
  not equivalent to `createWebFlowFromRecording`.
- Calendar and email login actions are intercepted by readiness preflight when
  signed out. Login must intentionally use the existing setup flow, and logout
  must call `notifyReadinessChanged()`.
- Action Browser previously discarded schema identity and counted any nonempty
  declaration as linked. Phase 0 now resolves exact registered actions before
  counting or rendering links.

## Action implementation rules

Every new action type MUST follow the onboarding agent's **schema-authoring
guidelines**: the shared `schemaGuidelines` constant in
`packages/dispatcher/dispatcher/src/translation/schemaGuidelines.ts` (exported via
`agent-dispatcher/internal`; it is the exact system prompt the onboarding
`schemaGen` handler uses). In short:

- Comments live **above** the declaration (no inline trailing comments), ordered
  broad-context / aliases → `IMPORTANT`/`NOTE` hard constraints → a one-sentence
  **identity line** immediately above the type/property (identity closest to the
  declaration).
- The action-level block leads with user/agent example pairs, then rules, then
  the one-sentence "what it does" directly above the type.
- Hard constraints embed a concrete `WRONG` / `RIGHT` example above the identity
  line.
- Enum-like parameters are explicit unions of string literals (never bare
  `string`); the identity line names the underlying enum and default. Don't
  overfit examples to real user/benchmark data; prefer widening the right action
  over "DO NOT use for" anti-examples.

Pattern per new action: (1) add the interface to `<name>Schema.ts` with comments
per `schemaGuidelines`; (2) add phrasings to `<name>Schema.agr` (or lean on
schema translation); (3) implement it in the `executeAction` switch, delegating
to the **same** service/helper the command calls (no divergence); (4) add the
`readonly action` link on the command; (5) add grammar + action-handler tests
mirroring the conversation specs.

Add metadata only after schema registration, execution, translation, and parity
tests exist. Agent commands and actions share a typed helper or service. System
actions delegate to `processCommandNoLock`, following conversation/history,
unless command-string serialization cannot preserve a value; in that case both
paths use a shared typed helper.

## Phases

1. **Coverage infrastructure.** Enumerate executable defaults, resolve links by
   qualified schema, fail strict collection errors, report runtime-only
   omissions, add missing/invalid counters, and generate the endpoint ledger.
2. **Exact existing equivalents.** Audit parameters, defaults, toggles, side
   effects, and readiness before linking PowerShell, OS notifications,
   self-help, exact localPlayer operations, and exact browser operations.
3. **Complete agent-host actions.** Add the known localPlayer and browser gaps,
   auth/OAuth actions, browser configuration, and dispatcher diagnostics.
   PowerShell `show` and email indexing were completed in the second
   implementation slice. No agent-host command remains excluded.
4. **Complete existing system families.** Finish `system.config`,
   `system.conversation`, `system.describe`, `system.grammar`, `system.history`,
   `system.notify`, and `system.settings`.
5. **Add remaining system families.** Register focused schemas for session,
   memory, index, Copilot, collision, construction, feedback, demo, help,
   diagnostics, and lifecycle commands.
6. **Closure.** Make strict coverage a permanent regression test and finish
   only when missing, ambiguous, dangling, inactive, and unverified counts are
   all zero.

## Verification

- Build before tests because Jest runs compiled output.
- After each host, run its focused grammar/translation and handler parity
  specs, then `node tools/actionBrowser/dist/cli.js --check --allow-missing`.
- Regenerate the catalog and update STATUS from executable endpoints, never
  from namespace groups or stale estimates.
- Before completion run `pnpm run test:local`, `pnpm run prettier`, and strict
  coverage without `--allow-missing`.
- Smoke-test an exact link, parameterized action, toggle, auth/setup flow,
  browser configuration, diagnostic, lifecycle command, default-off agent, and
  unavailable platform/client result.

## Decisions

- All bundled executable commands are in scope; there are no permanent waivers.
- Fully qualified schema names are canonical in object links. Bare names are a
  convenience only when unique within the host.
- Existing enablement, readiness, confirmation, and host-capability rules are
  authoritative behavior and must not be weakened.
- Default-off agents stay off. Natural-language invocation follows the same
  enable/readiness policy as the command, including enable-on-demand where
  already supported.
- Temporary blockers remain visible in STATUS and prevent the zero-gap
  milestone.
