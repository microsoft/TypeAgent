# Separate hybrid shopping demo

This is a separate runner and browser instance, not a modification of the
approved shopping design. It calls the original `decisionObserve` with its
unchanged fit threshold of 0.8. An accepted candidate goes straight to the
original `explicitAct` freshness and host-action guards with zero generation.
Only semantic abstention (`no_fit` or valid fit below 0.8) allows fallback.
Fallback observes a fresh snapshot and invokes the small generative candidate
selector, never reusing IDs from the decision snapshot.

Provider errors, malformed fit, unknown accepted IDs, invalid host actions,
refusals, stale targets and failed execution fail closed. They do not cause
unconditional fallback, retries, duplicate dispatch or purchases. An empty
snapshot produces no invented candidate. All browser activity is localhost-only.

From the repository root:

```powershell
node ts/examples/decision/web-shopping-hybrid/run.mjs
node ts/examples/decision/web-shopping-hybrid/run.mjs --dry-run
node ts/examples/decision/web-shopping-hybrid/run.mjs --live --limit 2 --chat-model gpt-5-mini --decision-model gpt-6-luna-decisions --cli-path $env:COPILOT_CLI_PATH
```

Default `offline-fixture-mock` intentionally makes the filter task a decision
fast-path hit and the detail task a semantic miss with generative mock fallback.
Both states are verified in a real local browser, but neither mock is a live
model result. Each invocation has a separate profile/context and writes only
this directory's evidence. Calls are serial; `--limit` is 1 or 2.

Generated `offline-evidence.json` records the verified fast and
fallback paths and separate decision/generative call counts and timings.
Generated `live-evidence.json` records the actual live attempt.
Both files are ignored by Git and recreated by the runner.
These are demonstrations, not comparative latency or speedup measurements.

## Live limitation

On 2026-10-13 the capped live hybrid attempt exited with code 1 and no stdout,
stderr or evidence report. The sanitized blocker is
`process_exited_without_report`. Completed decision/generative calls and paths
are unknown; no live hybrid success is claimed. No second live attempt was made,
preserving the call cap. Zero-call dry-run and all offline hybrid/browser tests
passed. Subsequent runs write `running` checkpoints before selector calls to
retain attempted counts if a process exits abruptly. A checkpoint is not proof
of completion. The separate generative-only live baseline passed both tasks.

Tests cover the exact 0.8 boundary, fast-path zero generation, low-fit/no-fit
fallback with fresh IDs, provider-error non-fallback, generation abstention and
failure without retries, and freshness rejection on both paths.
