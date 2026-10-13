# Dispatcher Routing Pilot

Isolated schema routing, not action translation, execution, or production
integration. Four candidates load descriptions and schema metadata directly from
the current calendar, email, list, and player manifests. Their referenced schemas
support event scheduling/search/removal, email send/reply/forward/find, list
management, and music playback/device selection. The categories are pilot-owned,
not production dispatcher categories.

The 26 manually labeled requests include 20 single-schema requests, three
ambiguous/multi-schema requests (`clarify`), and three unsupported requests
(`no-fit`). These are development fixtures, not a benchmark or calibration set.
Missing action parameters are not validated because this pilot selects only a
schema. Selection never invokes an agent.

## Lanes

- `decisionChoice`: all eligible schema IDs plus `clarify` and `no-fit`.
- `retrievalDecision`: lexical top-three shortlist followed by decision choice.
- `hierarchical`: eligible category choice followed by schema choice in that
  category. Categories with no eligible schemas are removed before the model.
- Baseline: simple lexical overlap, not TypeAgent's current embedding dispatcher.

Every decision stage validates exact candidate membership and its fit predicate.
A fit below the pilot's uncalibrated 0.5 threshold returns `no-fit`; ambiguity can
return `clarify`. Missing/malformed responses and request failures fail closed
to `no-fit`, are counted as failures, and produce exit code 1. Label mismatches
are reported separately, not treated as infrastructure failures.

Offline runs execute only the lexical baseline. Decision lanes report
`actual: null`, `offline-not-run`, and zero calls, not fabricated model results.
Injected test clients are labeled `mock`; real calls use the existing Copilot
client with `gpt-6-luna-decisions`. Calls are serial. No install is needed.

## Commands

Run from the repository root in PowerShell:

```powershell
node --test ts/examples/decision/dispatcher/dispatcher.spec.mjs
Get-ChildItem ts/examples/decision/dispatcher/*.mjs | ForEach-Object { node --check $_.FullName }
node ts/examples/decision/dispatcher/main.mjs
node ts/examples/decision/dispatcher/main.mjs --dry-run --limit 1
node ts/examples/decision/dispatcher/main.mjs --live --limit 1 --cli-path '<existing Copilot executable>'
node ts/node_modules/prettier/bin/prettier.cjs --check 'ts/examples/decision/dispatcher/*.mjs' ts/examples/decision/dispatcher/README.md
```

Default and `--dry-run` make no decision calls and load no runtime configuration.
`--live --dry-run` is rejected; `--cli-path` requires `--live` and `--limit` accepts
1 through 26. Live output reports each lane's actual ID, candidate IDs, call count,
and label match. Live errors omit provider details to avoid exposing secrets.

## Verification

Eight focused tests pass, covering manifest fixtures, exact IDs, fit/clarification,
eligibility, empty/malformed/error paths, retrieval shortlist rejection, and CLI
behavior. Repository-wide gates belong to the parent task. Live smoke outcomes
are recorded below.

### Live Smoke Outcome

One serial case was run with the existing Copilot executable and requested model
`gpt-6-luna-decisions`: "Schedule a calendar appointment for Friday at two."
All calls completed without infrastructure/validation errors. `decisionChoice`
and `retrievalDecision` returned `no-fit`; `hierarchical` returned `clarify` at the
category stage. All three missed the `calendar` label; the lexical baseline
matched it. Exit code 0 indicates no infrastructure failures, not routing success.
No threshold tuning or broader performance claim follows from this smoke.
