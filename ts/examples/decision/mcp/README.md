# MCP Eligible Tool Routing Pilot

Routing only: no tool arguments, execution, production integration, or Agency
connections. The 15-tool catalog is synthetic, not a discovered or verified
Agency catalog. IDs use `JSON.stringify([serverConfigId, toolName])`. Only the 13
enabled tools explicitly marked `allow` are exposed; unknown, disabled, and denied
policy states are excluded before model questions.

The 32 manually labeled fixtures cover direct requests, denied/disabled tools,
unsupported requests, injection distractors, ambiguity, and three requests with
reversed candidate order. The order cases do not establish order invariance.
This is a development pilot, not a benchmark or calibration study.

## Lanes

- `flatChoice`: all eligible tool IDs plus `no-fit`, with a fit predicate.
- `retrievalChoice`: lexical top-three shortlist and the same bounded decision.
- `twoStage`: eligible category choice, then eligible tools in that category
  with a fit predicate. `none` stops before stage two.
- Baseline: deterministic lexical overlap, not production embedding retrieval.

Exact tool/category membership is checked against each stage's presented set.
Fit below the uncalibrated pilot threshold of 0.5 produces `no-fit`. Ambiguous
requests should select `no-fit` rather than dispatch. Missing/malformed answers,
invalid distributions, and request failures fail closed to `no-fit`, increment
`failures`, and return exit code 1. Label mismatches are reported separately.
Provider error details are suppressed rather than echoed.

Offline mode executes the lexical baseline only; the three decision lanes have
`actual: null` and `fallback: offline-dry-run`. No mock decision is passed off as
a real decision. Injected clients/endpoints report `mock`; real inference reports
`copilot:gpt-6-luna-decisions`. Live calls run serially through the existing client.

## Commands

Run from the repository root in PowerShell:

```powershell
node --test ts/examples/decision/mcp/mcp.spec.mjs
Get-ChildItem ts/examples/decision/mcp/*.mjs | ForEach-Object { node --check $_.FullName }
node ts/examples/decision/mcp/main.mjs
node ts/examples/decision/mcp/main.mjs --dry-run --limit 1
node ts/examples/decision/mcp/main.mjs --live --limit 1 --cli-path '<existing Copilot executable>'
node ts/node_modules/prettier/bin/prettier.cjs --check 'ts/examples/decision/mcp/*.mjs' ts/examples/decision/mcp/README.md
```

Default and `--dry-run` load no runtime config and make zero decision calls.
`--live --dry-run` is rejected, `--cli-path` requires `--live`, and `--limit`
accepts 1 through 32. No installation or script approval is required.

## Audit And Verification

Removed an unreachable fetch mock containing incomplete/invalid distributions
that was overwritten by a second fetch mock. Added reachable malformed-response,
invalid-distribution, HTTP-error, thrown-request, invalid-category, fit-gate, and
explicit-allow tests. Mock results no longer claim to be live. Ten tests pass.
Repository-wide gates belong to the parent task. Live smoke outcomes are recorded
below.

### Live Smoke Outcome

One serial case was run with the existing Copilot executable and requested model
`gpt-6-luna-decisions`: "Send an email to sarah@example.com about project review."
All calls completed without infrastructure/validation errors, but all three
lanes returned `no-fit` and missed the send-mail label. Flat fit was 0.49;
retrieval fit was 0. The category stage selected `communication`; stage two
assigned 0.99 probability to send-mail but the enforced fit gate still abstained.
The lexical baseline matched. Exit code 0 reflects no infrastructure failures,
not routing success. No threshold tuning or broader performance claim follows.
