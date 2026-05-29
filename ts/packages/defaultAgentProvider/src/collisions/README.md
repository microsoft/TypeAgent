# Collision-pipeline scripts

TypeScript scripts that boot a read-only dispatcher and exercise the
`@collision` command surface. These are operational tooling and smoke
tests, **not** the primary user surface — the actual functionality is
implemented as `@collision` command handlers that you invoke from the
shell or CLI prompt:

```
@collision corpus run                       # full pipeline
@collision corpus generate / probe / reanalyze / visualize
@collision probe "<phrase>"                 # single-phrase probe
@collision similar [--strategy …]           # static action similarity
@collision events                           # recent collision telemetry
```

The same commands work from the CLI (a thin WebSocket client to the
agent-server) — anything you'd type at the shell prompt also works from
the CLI prompt.

## Why they live here

These scripts need to (a) boot a real dispatcher and (b) wire up the
default app-agent providers. `default-agent-provider` already depends on
`agent-dispatcher`, so it's the natural place for tooling that combines
both. Putting them inside `agent-dispatcher` would create a workspace
dependency cycle — `default-agent-provider → agent-dispatcher → default-agent-provider`
— which fluid-build rejects.

## Building and running

Built by the package's normal build:

```bash
pnpm run build default-agent-provider
```

Then run from `ts/`:

```bash
node packages/defaultAgentProvider/dist/collisions/smokeTest.js
node packages/defaultAgentProvider/dist/collisions/probeRunner.js
node packages/defaultAgentProvider/dist/collisions/listModels.js
```

The scripts call `dotenv.config()` with no arguments, which loads
`./.env` relative to the cwd — so always run from the `ts/` directory.

## Scripts

### `smokeTest.ts`

Spins up a read-only dispatcher and runs `@collision corpus visualize`
and `@collision corpus reanalyze` against an existing reclassified
probe-results file (default `f:/tmp/probe-results-full-reclassified.json`).
Confirms the handlers wire correctly and the HTML output is well-formed.

Pre-req: a reclassified probe-results JSON file. Generate one via
`@collision corpus run` from a shell session and copy the output, or
edit `SOURCE_FILE` in the script to point at any compatible file.

### `probeRunner.ts`

Spins up a read-only dispatcher and runs `@collision probe "<phrase>"`
for each phrase in a hand-edited `PROBES` list at the top of the file.
Used early in the rollout to validate the embedding-vs-dispatch
distinction (i.e. whether high embedding similarity implies dispatch
ambiguity — it doesn't always). Edit the `PROBES` list to test new
hand-crafted utterances.

### `listModels.ts`

Lists every chat model wired in this checkout's `ts/.env`. Used to scope
multi-model phrase-corpus generation runs before committing to one.

### `silentClientIO.ts`

Shared helper: returns a typed `ClientIO` whose methods are all no-ops
by default. Each script wraps it with the `appendDisplay` overrides it
needs to capture output.

## Safety notes

Every script in this directory is **read-only by design**:

- The dispatcher is initialized with `agents.actions: false`,
  `cache.enabled: false`, `translation.enabled: false`, and
  `explainer.enabled: false`.
- The only outputs are: chat-completion API calls, JSON file writes
  under the workdir the user passes (or the default), and the final
  visualization HTML.
- No agent's `executeAction` runs, no cache mutates, no actions are
  dispatched.

The `@collision corpus *` command handlers themselves run inside a
`withReadOnlySession()` guard that disables the construction cache for
the duration of the work and restores the prior setting on exit, as a
belt-and-suspenders measure on top of the underlying read-only APIs.
