# Direct TypeAgent Explorer revision-22 evidence

## Goal and final resource

Compare the requested single provider route across the final three harnesses:

1. Copilot SDK with its Explorer subagent (`baseline`).
2. Raw TypeAgent grammar dispatch to the sole Explorer AppAgent, whose bounded
   reasoning loop emits Code Mode programs (`typeagent`).
3. The same TypeAgent path with language-server navigation
   (`typeagent-lsp`).

The final resources are the built ExploreBench CLI and the raw 31-execution
stream under:

`$RUN_DIR`

Artifact level: Level 1 markdown. Date: 2026-07-24. Provider credentials came
from `LOCAL_LITELLM_API_KEY`; the value was never printed or copied into this
evidence.

## Frozen implementation and ripgrep parity

Both TypeAgent arms preserve untouched natural-language ingress through a
static TypeAgent grammar, one active Explorer AppAgent/schema, one executed
typed outer action, and a bounded inner Code Mode action loop. Neither arm
loads or invokes Copilot or MCP. Dispatcher model usage is zero because static
grammar handles the outer action.

The runner resolves one ripgrep executable from Copilot's platform package,
hashes it once, and injects that exact path into all three arms. Explorer
`repo.grep` has no in-process text-search fallback: it snapshots the filtered
repository and reaches `spawn(ripgrepPath, ...)`. A missing executable fails
closed.

The built parity regression and runtime/integrity regressions passed:

```text
keeps Copilot and TypeAgent grep results in the same ripgrep order: 1/1 pass
runtime evidence / TypeAgent ripgrep integrity focused checks: 3/3 pass
ripgrep 15.0.0 (rev 3a612f88b8)
ripgrepSha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
```

The ordered parity case covers regex and literal search, default and capped
results, exact file and directory paths, native character-class globs, hidden
files, missing targets, and invalid/empty regex errors. Separate repository
tests freeze native path order and prohibit file-diversity reranking.

The runtime roots and compiled package trees were hashed in sorted path order
before and after the paid run. Both observations matched:

```bash
rg --files .copilot/agents/explorer.md \
  ts/packages/agent-flows/src \
  ts/packages/agents/explorer/src \
  ts/packages/exploreBench/src |
  LC_ALL=C sort |
  while IFS= read -r file; do shasum -a 256 "$file"; done |
  shasum -a 256

rg --files ts/packages/agent-flows/dist \
  ts/packages/agents/explorer/dist \
  ts/packages/exploreBench/dist |
  LC_ALL=C sort |
  while IFS= read -r file; do shasum -a 256 "$file"; done |
  shasum -a 256
```

```text
sourceFiles=54
sourceDigest=c33f93ae04797e6922b8745daf03ca6c400a72f33b818794fde864881f1bdcdf
builtFiles=156
builtDigest=f0c403c590f887f4285eac065ee1256f89d1a2a3e6ec7b5d5a37d398ba107b15
```

## Local gates and real smoke

The final revision-22 implementation passed the authoritative package gates
before cohort selection and the same complete suites passed again after the
run:

```text
Agent Flows: 77/77
Explorer: 96/96
ExploreBench: 139/139
Prettier: passed
git diff --check: passed
```

The final Agent Flows wrapper probe stopped before Jest because Corepack
resolved pnpm 11.0.4 while the workspace currently declares pnpm 10.34.4. The
package build and the script's exact package-local Node/Jest command were run
directly instead; they produced the 77/77 result above. Explorer emitted a
forced-worker-exit warning only after all 96 tests passed. ExploreBench's real
`npm test` command built the package and passed all 139 tests.

### Post-run landing audit

After the cohort was consumed, an independent final-diff audit found that a
generated program could start a repository promise without awaiting it, return,
and let the execution-lease rejection escape as an unhandled process-level
rejection. A focused real-dispatcher regression reproduced the failure before
the fix. The lease API now attaches a host-owned rejection observer while
returning the original promise, so awaited callers still receive the rejection
and detached calls cannot terminate the benchmark process.

This landing-only safety fix does not change prompts, search semantics,
candidate selection, scoring, or result formatting. The consumed cohort was
not rerun. Its exact benchmark implementation remains identified by the frozen
hashes above. Cache compatibility advanced to revision 23 so frozen revision-22
rows cannot be imported under the corrected runtime. Final post-audit gates
passed:

```text
Agent Flows: 77/77
Explorer: 97/97
ExploreBench: 139/139
Prettier over intended tracked files: passed
git diff --check: passed
postAuditSourceDigest=b95735c3fdb2bafb70100885842427077158855dedb922c13f501e120bb03d8b
postAuditBuiltDigest=ecd1e09dec3f80ebf2d3fc24ccb03d150f46ddfc889d02321d60e82bc73223a7
```

The real one-task, three-arm smoke also passed at cache compatibility revision
22:

```text
runId=$SMOKE_RUN_ID
baseline       ok  durationMs=26293  tokens=39319
typeagent      ok  durationMs=12000  tokens=20591  dispatcherRequests=0
typeagent-lsp  ok  durationMs=19597  tokens=22724  dispatcherRequests=0
runtimeSearch=ripgrep/copilot-packaged/rg
```

Its raw results passed fail-closed integrity validation. Both TypeAgent rows
used the sole Explorer agent, no Copilot/MCP, and proven ripgrep; only the LSP
arm used LSP.

## Unseen cohort selection

Selection occurred only after the smoke and source freeze. Two independent
calculations read only cached dataset instance IDs, prior manifest/result task
IDs, and retained cohort ID files. They did not inspect candidate prompts,
patches, repositories, scores, or difficulty.

- Seed: `direct-typeagent-r22-random10-20260724`
- Normalized seed: `749879458`
- Method: package FNV-1a normalization and Mulberry32/Fisher-Yates shuffle
- Frozen IDs: [cohort.json](./cohort.json)

```text
datasetRows=500
manifestFiles=150
resultFiles=149
resultRows=3090
cohortFiles=12
exclusionFiles=311
excludedUniqueIds=334
eligibleIds=166
selectedUnique=10
overlap=[]
selectionInventorySha256=ab2e054a03f66eb92b51ec583fbb97d7b353448d79b0c10d087ec4a0f7dd66d2
```

## Real random-10 matrix

The frozen cohort ran exactly once, serialized at model concurrency one:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id "$RUN_ID" \
  --limit 10 \
  --task-ids-file packages/exploreBench/evidence/direct-typeagent-random10-r22/cohort.json \
  --model "$MODEL_ROUTE" \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp \
  --max-attempts 2 \
  --max-concurrency 1 \
  --timeout-ms 360000 \
  --force-rerun \
  --litellm-base-url http://127.0.0.1:4627/v1 \
  --api-key-env LOCAL_LITELLM_API_KEY
```

Raw CLI boundary excerpts:

```text
cache  force-rerun  archived=0
runId=$RUN_ID
tasks=10 models=1 variants=3 rows=30
...
fail  django__django-14170  $MODEL_ROUTE  typeagent-lsp  122715ms
start django__django-14170  $MODEL_ROUTE  typeagent-lsp  attempt=2/2
ok    django__django-14170  $MODEL_ROUTE  typeagent-lsp  25526ms
...
results=$RUN_DIR/results.jsonl
report=$RUN_DIR/report.json
markdown=$RUN_DIR/report.md
exit_code=0
```

The single combined JSONL generated the three-arm report without a model call:

```bash
node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input "$RUN_DIR/results.jsonl" \
  --lsp-input "$RUN_DIR/results.jsonl" \
  --output-dir "$RUN_DIR"
```

## Common final-success metrics

All ten tasks reached terminal success in every arm. Quality, tokens, and
latency therefore use the same ten-task intersection. Token totals use only
each task's final successful execution. Latency counts exactly one final
successful execution per task; the failed 122.7-second attempt is excluded.

| Arm                    |   N | Overall recall |           File P/R/F1 |           Line P/R/F1 |  Tokens |      Mean / P50 / P95 |
| ---------------------- | --: | -------------: | --------------------: | --------------------: | ------: | --------------------: |
| Copilot SDK + Explorer |  10 |          0.612 | 0.287 / 0.650 / 0.395 | 0.082 / 0.573 / 0.134 | 294,244 | 25.4s / 22.6s / 40.8s |
| TypeAgent              |  10 |          0.502 | 0.533 / 0.700 / 0.590 | 0.138 / 0.303 / 0.176 | 162,965 | 19.5s / 19.8s / 28.7s |
| TypeAgent + LSP        |  10 |          0.489 | 0.450 / 0.650 / 0.517 | 0.166 / 0.328 / 0.212 | 194,979 | 21.7s / 21.2s / 30.6s |

Relative to baseline:

- TypeAgent used 131,279 fewer tokens (44.6%), with mean latency 5.9s lower
  and p50 2.8s lower.
- TypeAgent+LSP used 99,265 fewer tokens (33.7%), with mean latency 3.8s lower
  and p50 1.4s lower.
- Both treatment arms improved file precision/F1 and line precision/F1.
- Plain TypeAgent improved file recall; the LSP arm matched baseline file
  recall.
- Line recall fell from 0.573 to 0.303 and 0.328, which also lowered overall
  recall to 0.502 and 0.489.

An independent calculation from the raw JSONL, without importing the report
aggregation functions, matched every generated quality, token, and latency
value exactly.

## Executions, retries, and reliability

Every emitted execution is counted here. Retry executions are attempts after
the first for the same task/model/arm key.

| Arm                    | Requested | Executions | Retry executions | Failed executions | Terminal successes | Terminal failures |
| ---------------------- | --------: | ---------: | ---------------: | ----------------: | -----------------: | ----------------: |
| Copilot SDK + Explorer |        10 |         10 |                0 |                 0 |                 10 |                 0 |
| TypeAgent              |        10 |         10 |                0 |                 0 |                 10 |                 0 |
| TypeAgent + LSP        |        10 |         11 |                1 |                 1 |                 10 |                 0 |

The only failed execution was a 122.715-second provider Responses timeout in
the LSP arm before a direct Explorer execution began. Its second attempt
succeeded in 25.526 seconds. The failed duration and its incomplete usage are
not blended into final-success latency or tokens.

## Harness integrity

Validation over all terminal-success rows proved:

```text
baselineExclusiveExplorerDelegation=10/10
baselineMainRepositoryInspection=false
treatmentGrammarDispatch=20/20
treatmentDispatcherRequests=0
treatmentSoleExplorer=20/20
treatmentUsedCopilot=false
treatmentUsedMcp=false
plainLspCalls=0
lspAdoption=10/10
successfulLspCalls=11
lspLocations=10
treatmentSuccessfulGrepCallsProvenRipgrep=true
runtimeSearchSharedAcrossArms=true
```

Artifact hashes:

```text
resultsSha256=475a5de10c11686a9fe01b2b260affe6431858ab2bc90b96660db501f3dc8de3
manifestSha256=920a99ea9220e6c5a99fb7995ea306474c69b6c166bdb3544db5521d1fb77d19
runtimeSha256=ec50442a6082b81ac6bd0ca365848a092908485e939c37e60eaeed9c636aaedd
threeArmJsonSha256=2a0c5c22f20d9998f379c70c594819c65ab7f8dd5201a6dc1ba39970647c1b56
threeArmMarkdownSha256=567fb19e1865acaae891f7ffa8ef12713ac0cb3133ecbe0d7562f6741c74c01d
```

## Strict result

The architecture, ripgrep parity, token, latency, F1, and terminal-reliability
criteria pass. The full quality-parity claim is **rejected** because both
TypeAgent arms have materially lower line recall and overall recall than the
Copilot SDK baseline on this untouched cohort.

This cohort is now consumed. No runtime, prompt, scoring, or output-selection
change was made in response to its scores, and it was not rerun. The independent
post-run lease-safety correction is documented above. The result is reported as
observed rather than tuned into a pass.
