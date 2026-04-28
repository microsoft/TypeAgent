# Contributing to mcp-plan-validation

## Prerequisites

- Node.js 20+
- pnpm 10+
- An Anthropic API key (for integration tests only)

## Repository Structure

```
tools/
├── validation/              # Core library (specSchema, planValidator, orgPolicy, predicateEvaluator)
│   ├── src/
│   │   ├── specSchema.ts        # AgentPlan type definitions and plan DSL
│   │   ├── planValidator.ts     # 13-pass static plan validator
│   │   ├── orgPolicy.ts         # Org policy types, bash sandboxing, container config
│   │   ├── predicateEvaluator.ts # Runtime postcondition evaluation
│   │   ├── index.ts             # Export barrel
│   │   └── prompts/             # Planning prompts and JSON schema
│   ├── package.json
│   └── tsconfig.json
│
└── mcpValidation/           # MCP server + CLI + tests
    ├── src/
    │   ├── server.ts            # MCP server with all validated tools
    │   ├── planState.ts         # Runtime state + execution trace
    │   ├── executor.ts          # File/shell/container executors
    │   ├── init.ts              # Project scaffolding (init command)
    │   ├── cli.ts               # CLI dispatcher (init vs serve)
    │   ├── index.ts             # MCP server entry point (stdio)
    │   └── mcpValidationTest.ts # All tests
    ├── policies/                # Policy templates (strict, dev, ml, ci)
    ├── templates/               # CLAUDE.md template
    ├── testProject/             # Test fixture (CSS + HTML files)
    ├── tsup.config.ts           # Bundle config
    ├── package.json
    └── tsconfig.json
```

## Building

The validation library must be built before the MCP server (it's a workspace dependency).

```bash
# From the repo root
pnpm install

# Build the validation library
cd tools/validation
pnpm run build

# Build the MCP server (tsc — for development and testing)
cd ../mcpValidation
pnpm run build
```

The `tsc` build outputs to `dist/` with individual .js files per source file. This is what tests use.

## Bundling

For distribution, `tsup` bundles everything (including the `validation` workspace dep) into self-contained files:

```bash
cd tools/mcpValidation
pnpm run bundle
```

This produces:

- `dist/index.js` (~90KB) — MCP server with all validation logic inlined
- `dist/cli.js` — CLI entry point
- `dist/init.js` — Init command

The bundle has no dependency on the `validation` workspace package at runtime.

## Testing

### Unit tests (fast, no API key needed)

```bash
cd tools/mcpValidation

pnpm run test:policy-unit      # 39 assertions: bash parsing, path/tool policy
pnpm run test:postcond-unit    # 38 assertions: predicate eval, path resolution, permissions
pnpm run test:capability       #  9 assertions: capability tools, capabilities-only mode
pnpm run test:container        # 25 assertions: volume derivation, docker args, devices, ports
```

Total: 111 unit assertions. Run in ~2 seconds, no external dependencies.

### Integration tests (require Anthropic API key)

These use the Claude Agent SDK to drive Claude Code through the MCP server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...

pnpm run test:happy                # Happy path: plan → execute → verify
pnpm run test:block                # Wrong tool detection
pnpm run test:constraint           # Input constraint enforcement
pnpm run test:policy-integration   # Org policy blocks curl at runtime
pnpm run test:postcond-integration # Postconditions evaluated after completion
```

Each integration test takes 30-90 seconds and costs ~$0.10-0.30 in API usage.

### Full suite

```bash
pnpm run test    # Runs all 9 tests (unit + integration)
```

### Adding a new test

Tests are in `src/mcpValidationTest.ts`. The pattern:

1. Create an async function `testYourFeature(): Promise<boolean>`
2. For unit tests: use the `check(name, fn)` + `assert(condition, msg)` helpers
3. For integration tests: use `createValidationServer()`, `createObservation()`, `makeHooks()`, and the Agent SDK's `query()`
4. Add to the runner section (search for `runTest(`)
5. Add a script to `package.json`: `"test:yourfeature": "tsc && node dist/mcpValidationTest.js yourfeature"`

## Key Design Decisions

### Plan validation vs. policy enforcement

Two separate layers:

- **Plan validation** (`validatePlan`): structural correctness of the plan itself (indices, bindings, dependencies). Violations **abort** the plan.
- **Policy enforcement** (`checkToolCallAgainstPolicy`): org-level restrictions. Violations **block the call** but don't abort — the model can adjust.

### Trace hash chaining

Each `TraceEntry.hash` is SHA-256 of `{ previousHash, stepIndex, tool, input, output, durationMs, status, error }`. The chain starts from a zero hash. `verifyTraceChain` recomputes every hash to detect tampering. Output is truncated to 1000 chars before hashing (and 500 for storage) to keep trace size reasonable.

### Container volume derivation

`deriveContainerVolumes` extracts base directories from glob patterns in the path policy. Subpath deduplication avoids mounting `/project/src` when `/project` is already mounted. Write patterns become read-write mounts; read patterns become read-only.

## Publishing to npm

```bash
cd tools/mcpValidation

# 1. Bump version
npm version patch  # or minor/major

# 2. Bundle (runs automatically via prepublishOnly, but you can run manually)
pnpm run bundle

# 3. Verify the bundle works
node dist/index.js  # Should print "plan-validation MCP server running on stdio"
node dist/cli.js init --help  # Should print usage

# 4. Publish
npm publish

# 5. Verify
npx mcp-plan-validation init --help
```

The `prepublishOnly` script runs `tsup` automatically, so `npm publish` builds the bundle before publishing.

### What gets published

Controlled by the `files` field in package.json:

- `dist/` — bundled JS + sourcemaps + .d.ts
- `policies/` — policy templates (strict.json, dev.json, ml.json, ci.json)
- `templates/` — CLAUDE.md template

Everything else (src/, tests, testProject/, tsconfig, tsup.config) is excluded.

## Modifying the Schema

The plan schema lives in `tools/validation/src/specSchema.ts`. Key rules:

1. **Adding new tool types**: Add to the `Tool` union, add to `TOOL_NAME_MAP` in `planState.ts`, register the MCP tool in `server.ts`, add an executor in `executor.ts`
2. **Adding new predicate types**: Add to the `Predicate` union in `specSchema.ts`, add evaluation logic in `predicateEvaluator.ts`, add structural validation in `planValidator.ts`
3. **Adding new policy types**: Add to `orgPolicy.ts`, export from `index.ts`, wire enforcement into `server.ts`'s `withValidation` or `submit_plan` handler

After schema changes, rebuild validation first, then mcpValidation.
