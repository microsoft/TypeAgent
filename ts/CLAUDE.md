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

### Code style

- **4-space indentation** for TypeScript/JavaScript, **2-space** for JSON
- **LF** line endings
- **Prettier** for formatting (no `.prettierrc` — uses defaults)
- Every `.ts`/`.js` file must start with:
  ```typescript
  // Copyright (c) Microsoft Corporation.
  // Licensed under the MIT License.
  ```

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

- Requires **Node ≥20**, **pnpm ≥10**
- API keys go in `ts/.env` (Azure OpenAI or OpenAI endpoints)
- User data stored in `~/.typeagent/`
- Tracing via the `debug` package — enable with `DEBUG=typeagent:*` env var
