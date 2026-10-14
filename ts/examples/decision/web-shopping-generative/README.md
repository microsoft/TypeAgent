# Generative shopping baseline

This isolated runner reuses the approved shopping fixture, Playwright browser,
host observer, freshness check, and executor without modifying them. Generation
chooses exactly one issued candidate ID or `no_fit`. It never creates selectors,
action parameters, or numerical confidence. The caller rejects missing fields,
unknown IDs, extra properties and refusals, then uses the original host guards.

From the repository root:

```powershell
node ts/examples/decision/web-shopping-generative/run.mjs
node ts/examples/decision/web-shopping-generative/run.mjs --dry-run
node ts/examples/decision/web-shopping-generative/run.mjs --live --limit 2 --chat-model gpt-5-mini --cli-path $env:COPILOT_CLI_PATH
```

Default mode is `offline-fixture-mock`: a deliberately named fixture-specific
text matcher, not generative inference or a browser benchmark. Dry-run does not
open a browser or call a model. `--limit` is restricted to 1 or 2; calls run
serially. Live mode uses existing Copilot authentication and only the localhost
fixture. Both tasks are unchanged: filter cordless tools, then open Cordless
Drill details. DOM readback verifies the expected state after each action.
Every runner invocation creates a new isolated browser profile/context.

`selection.mjs` exports `generateTarget(snapshot, client, request)` returning
`{candidate, generation}`. Evidence contains only IDs and observed text metadata;
host action objects are never sent to the model. `no_fit` stops without action.
Provider, validation, freshness or execution failure stops without retry.

Generated outputs are `offline-evidence.json` and `live-evidence.json` in this
directory only; they are ignored by Git and recreated by the runner. They contain
per-case paths, issued IDs, selector/model counts, timings, token usage when
available, verified state and sanitized failures. A `running` checkpoint is
written before each selector invocation; an unfinished checkpoint is not a
successful result. There are no inherited p50 or speedup claims.

## Verified run

On 2026-10-13, live Copilot with requested model `gpt-5-mini` passed both local
fixture tasks with two generative calls and zero decision/executor model calls.
Selection timings were about 6550 ms and 1687 ms; cold setup is included in the
first call. These are individual observations, not performance estimates.
Requested model labels are not independent serving-model attestations.

Tests use injected structured JSON and a real local browser, covering schema
visibility, exact choice validation, all host action guards, stale/replaced/
hidden/disabled/inert/duplicate targets, navigation and verified readback.

```powershell
node --test ts/examples/decision/generative/*.spec.mjs ts/examples/decision/web-shopping-generative/*.spec.mjs ts/examples/decision/web-shopping-hybrid/*.spec.mjs
```
