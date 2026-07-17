# TypeAgent — AI Assistant Instructions

## Build & Test

This is a **pnpm monorepo** rooted at `ts/`. All commands run from the `ts/` directory.

```bash
# Install & build
pnpm i
pnpm run build               # Uses fluid-build to build all packages
pnpm run build <directory>   # Uses fluid-build to build directory (and dependencies)
pnpm run build <package name regexp>   # Uses fluid-build to build a package which name matches the regexp (and dependencies)
pnpm run build:shell         # Build only the shell app and its dependencies

# Clean
pnpm run clean               # works at the root and per package

# Test
pnpm run test:local          # All unit tests (*.spec.ts) across packages
pnpm run test:live           # Integration tests (*.test.ts) — requires API keys
pnpm run test                # Both local + live + shell tests

# Run tests for a single package
pnpm --filter <package-name> test
# e.g., pnpm --filter action-grammar test

# Run a single test file (cd into the package directory first)
# The jest-esm script wraps `node --experimental-vm-modules jest` — use it
# instead of invoking node/jest directly.
pnpm run jest-esm --testPathPattern="merge.spec.js"

# Run a single test by name (cd into the package directory first)
pnpm run jest-esm --testNamePattern="your test name"

# Lint
pnpm run prettier            # Check formatting
pnpm run prettier:fix        # Fix formatting
```

Tests run against compiled output in `dist/test/` — you must build before running tests.

## Architecture

TypeAgent is a **personal agent** that routes natural language requests to specialized **application agents** (plugins). The core flow is:

```
User input → Grammar matcher → Typed action → Dispatcher → Agent handler → ActionResult
```

Detail architecture descriptions are located in the **`docs/architecture`** directory.

### Key packages

- **`packages/dispatcher/`** — Core routing engine. Matches user input to agents and dispatches typed actions.
- **`packages/agentSdk/`** — Interface definitions (`AppAgent`) that all agents must implement.
- **`packages/actionSchema/`** — Parses TypeScript action types into JSON Schema for validation.
- **`packages/actionGrammar/`** — NFA/DFA compiler that converts `.agr` grammar files into matchers for natural language understanding.
- **`packages/cache/`** — Caches action translations to minimize LLM calls.
- **`packages/knowPro/`** — Structured RAG implementation for conversational memory.
- **`packages/agents/`** — All application agents (player, calendar, email, list, browser, etc.).
- **`packages/shell/`** — Electron GUI app.
- **`packages/cli/`** — Console app (connected-mode only; all commands route through `agent-server` via WebSocket RPC).

### Agent plugin structure

Each agent follows this layout:

```
packages/agents/<name>/src/
  <name>Manifest.json    # Agent metadata, schema pointers, emoji
  <name>Schema.ts        # TypeScript action/activity type definitions
  <name>Schema.agr       # Grammar rules (NL patterns → structured actions)
  <name>ActionHandler.ts # Implements instantiate(): AppAgent
```

Agents export an `instantiate()` function returning an `AppAgent` object. The dispatcher calls `executeAction(action, context)` with already-validated, typed actions — agents never parse natural language directly.

### Dispatcher ↔ Agent interface

Agents implement `AppAgent` from `@typeagent/agent-sdk`:

- `initializeAgentContext()` — One-time setup
- `updateAgentContext()` — Enable/disable per session
- `executeAction(action, context)` — Handle a typed action, return `ActionResult`
- Optional: `handleChoice()`, `resolveEntity()`, `getActionCompletion()`, `getDynamicDisplay()`

## Conventions

### Engineering tradeoffs

- **API / embedding / LLM cost is not a constraint.** Don't gate features
  on token budget, don't apologize for "5× embedding cost," don't add
  cost-saving caveats unless the user asks for them. If the right
  experiment runs every embedding twice or every LLM call three times,
  that's fine.

### Code style

- **4-space indentation** for TypeScript/JavaScript, **2-space** for JSON
- **LF** line endings
- **Prettier** for formatting (no `.prettierrc` — uses defaults)
- Every `.ts`/`.js` file must start with:
  ```typescript
  // Copyright (c) Microsoft Corporation.
  // Licensed under the MIT License.
  ```

### Comments

- Write comments in plain, direct language. Say what the code does and
  why. Avoid "consultant speak" - filler like "owns its own X," "single
  source of truth," "never has to know about Y," or restating a design
  principle instead of explaining the code. Technical terms are fine; use
  the precise word rather than talking around it.
- Don't use em-dashes (—) in comments. Use `-`, `:`, parentheses, or two
  sentences instead.

### Package references

- Internal packages use `"workspace:*"` protocol in `package.json`
- Build is orchestrated by `fluid-build` at the workspace root; individual packages use `tsc -b`
- TypeScript targets ES2021, module system is Node16, strict mode enabled

### File types

- `.ts` / `.mts` — TypeScript source (`.mts` for ES module contexts)
- `.agr` — Grammar rule definitions (natural language patterns for action matching)
- `.ag.json` — Compiled grammar output
- `.pas.json` — Grammar metadata for schema-to-grammar generation

### Testing conventions

- Unit tests: `test/*.spec.ts` → run via `test:local`
- Integration tests: `test/*.test.ts` → run via `test:live` (require API keys)
- Tests compile to `dist/test/` and Jest runs against the compiled JS
- Test timeout: 90 seconds (configured in root `jest.config.js`)

### Environment

- Requires **Node ≥22**, **pnpm ≥10**
- API keys go in `ts/config.local.yaml` (see `config.sample.yaml` for reference). Legacy `.env` is still supported but deprecated.
- User data stored in `~/.typeagent/`
- Tracing via the `debug` package — enable with `DEBUG=typeagent:*` env var

## Code Review Guidelines

Use these criteria both when **writing** changes and when **reviewing** code (your
own or a diff you are asked to review). Report only high-confidence, substantive
issues — prefer a short list of real problems over an exhaustive nitpick list. For
each issue, name the file/line, explain _why_ it matters, and suggest a concrete
fix. Do not comment on formatting that Prettier already enforces.

### Readability & maintainability

- **Clarity first.** Prefer straightforward, self-explanatory code over clever
  one-liners. A reader should be able to follow the intent without reverse-engineering it.
- **Meaningful names.** Names should describe intent (`isSchemaEnabled`, not `flag`).
  Match the vocabulary already used in the surrounding module.
- **Small, focused units.** Functions should do one thing. Flag deeply nested
  logic, long parameter lists, and functions that mix unrelated concerns — suggest
  extracting a helper.
- **Comment the "why," not the "what."** Per repo style, only comment code that
  needs clarification (non-obvious intent, workarounds, invariants). Remove
  redundant comments that merely restate the code. Comment intent accurately —
  distinguish a temporary **NYI (TODO)** from a fundamental limitation.
- **Clear signatures.** Order parameters so common callers rely on defaults, make
  optional callbacks optional, and drop dead/unused parameters instead of threading
  constants through.
- **Clean up as you go.** Remove stale comments and tests that reference relocated
  or deleted code.

### DRY — avoid redundancy

- Flag copy-pasted logic, duplicated constants/literals, and parallel code paths
  that should share a single implementation.
- When two implementations of the same logic diverge (even slightly), extract one
  shared helper and route both callers through it — divergent copies drift and
  cause bugs. Aim for a single source of truth.
- Before adding a new helper, check whether an existing utility already covers it
  (search the package and its workspace dependencies). Reuse over reinvention.
- Balance DRY against clarity — **don't over-extract.** A small, incidental
  duplication is preferable to a premature or leaky abstraction that couples
  unrelated call sites, and a helper with a single real caller — or one that forces
  the reader to jump away to follow otherwise-simple logic — is a code smell;
  inline it.

### Consistency with the codebase

- New code should follow the conventions of the **surrounding context** and the
  broader codebase: file layout, naming, error-handling patterns, import style,
  and the `AppAgent` / dispatcher contracts described above.
- Reuse established patterns (e.g., the agent plugin structure, `ActionResult`
  return shapes, `debug`-based tracing) instead of introducing new ones without
  justification.
- Every `.ts`/`.js` file must carry the Microsoft copyright header. Internal
  dependencies use `workspace:*`.
- Match the established **file-naming pattern** of the area (e.g., grammar matcher
  tests are `grammarMatcher<Name>.spec.ts`).

### Abstractions & design

- Abstractions should have a clear, single responsibility and hide the right
  details. Flag leaky abstractions, unnecessary indirection, and over-engineering
  (interfaces/layers with a single implementation and no foreseeable second one).
- Prefer the simplest design that satisfies the requirement. Don't add
  configurability, generality, or extension points that aren't needed yet.
- Watch module boundaries: respect package dependency direction and avoid
  reaching into another package's internals.

### Root-cause fixes & workarounds

- Fix the underlying cause rather than routing around a not-yet-implemented (NYI)
  gap by weakening defaults or disabling a feature. Prefer making an unsupported
  path _work_ over changing a default to avoid triggering it.
- When a temporary workaround is genuinely needed, make it **opt-in and
  self-deleting**: gate it behind an explicit flag/option and add a `TODO` to remove
  it once the root fix lands. A workaround baked into a default reads as the intended
  long-term design.
- Before adding a new error path or constraint, confirm the existing intended
  behavior from the relevant `docs/architecture` doc and surrounding code — don't
  over-constrain a previously-valid case, and keep code and docs in sync.

### Correctness & robustness

- Check edge cases, error/exception paths, `async`/`await` correctness, and
  resource cleanup. Remember that some constructors (e.g., embedding-model
  creation) can **throw** rather than return `undefined` — guard construction, not
  just the call.
- Validate inputs at trust boundaries; agents receive already-typed, validated
  actions, so avoid re-parsing natural language in handlers.
- Validate invariants once, early, and unconditionally — hoist a distinct check
  (e.g., rejecting an unsupported shape) to a single location rather than mixing it
  into unrelated logic, which conflates concerns and yields differently-worded
  errors depending on which branch is hit.
- Distinguish **user-facing validation errors** from **internal invariant errors**
  ("should never happen") so the latter aren't mistaken for user mistakes.

### Test coverage

- New or changed behavior should be covered by tests. Unit tests are
  `test/*.spec.ts` (run offline via `test:local`); live/integration tests are
  `test/*.test.ts` (`test:live`, require API keys).
- Tests must exercise meaningful behavior and edge cases, not just the happy path,
  and should assert on outcomes rather than restating the implementation.
- Avoid duplicate coverage: check whether existing tests already cover the behavior,
  and prefer shared/parameterized harnesses (e.g., `describeForEachMatcher`, which
  runs a case across AST/NFA/DFA) so behavior is verified across all variants.
  Assert on actual error messages, not guessed substrings.
- Remember tests run against **compiled output** in `dist/test/` — build before
  running, and after switching branches run `pnpm run clean` first to purge stale
  compiled specs.
