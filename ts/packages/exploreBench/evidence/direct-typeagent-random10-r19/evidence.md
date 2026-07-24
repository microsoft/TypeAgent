# Direct TypeAgent Explorer revision-19 evidence

## Goal and final resource

This run compares the requested single provider route across:

1. Copilot SDK with the Explorer subagent (`baseline`).
2. Raw TypeAgent grammar dispatch to the sole Explorer AppAgent, whose bounded
   reasoning loop generates Code Mode (`typeagent`).
3. The same TypeAgent path with language-server access (`typeagent-lsp`).

The final resources are the built ExploreBench CLI and the raw execution stream
under:

`$RANDOM_RUN_DIR`

Artifact level: Level 1 markdown. Date: 2026-07-24. Provider credentials came
from `LOCAL_LITELLM_API_KEY`; its value was never printed or copied into this
evidence.

## Frozen implementation

Revision 19 preserves the shared repository surface and Copilot-packaged
ripgrep implementation in every arm. The only runtime changes are:

- refinement preflight requires an actual `repo.read` call and, until the LSP
  requirement succeeds, an actual `repo.lsp` call;
- direct, element-access, property-alias, and destructured calls are accepted,
  while unused method references are not;
- the bounded reasoning loop permits at most six actions; and
- result integrity requires a matching, at-most-six-call reasoning trace.

A proposed TypeAgent-only candidate-retention rule was removed before the smoke
because it would have altered a scored output decision only in the treatment
arms.

The implementation and built outputs had identical hashes before the smoke,
after the smoke, and after the random-10 run:

```text
sourceFiles=38
sourceDigest=0d7e0fc6d98d2a175d6b422c961af4f1e27bcfc58f05dade7b7f7bee4bd0c7a0
builtFiles=229
builtDigest=95bbf8ac7c5f817a19b964b13057de7124dca93f289a7d3cbe18781257324ae4
ripgrepSha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
```

## Local gates

Direct package-local TypeScript builds exited 0. Authoritative tests after the
final source state:

```text
Explorer:
Test Suites: 6 passed, 6 total
Tests:       89 passed, 89 total
Snapshots:   0 total
exit_code=0

ExploreBench:
tests 138
pass 138
fail 0
exit_code=0
```

Every intended file passed package-local Prettier. `git diff --check` produced
no output and exited 0. The package-wide benchmark formatter also sees two
pre-existing untracked HTML files, so formatting was scoped explicitly to all
intended source, test, documentation, and evidence files.

## Real three-arm smoke

Provider preflight reached the real gateway without exposing the credential:

```text
credentialAvailable=true gatewayAlive=true requestedRouteAdvertised=true
benchmarkProcessActive=false
```

Command, from `$REPO/ts`:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id "$SMOKE_RUN_ID" \
  --limit 1 \
  --model "$MODEL_ROUTE" \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp \
  --max-attempts 1 \
  --max-concurrency 1 \
  --timeout-ms 360000 \
  --force-rerun \
  --litellm-base-url http://127.0.0.1:4627/v1 \
  --api-key-env LOCAL_LITELLM_API_KEY
```

```text
ok  astropy__astropy-12907  $MODEL_ROUTE  baseline       24238ms
ok  astropy__astropy-12907  $MODEL_ROUTE  typeagent      13379ms
ok  astropy__astropy-12907  $MODEL_ROUTE  typeagent-lsp  12669ms
exit_code=0
```

The raw smoke JSONL and runtime artifact passed fail-closed validation:

```text
rows=3 revision=19
baseline tokens=43777 durationMs=24238 explorerDelegations=1 mainInspect=false
typeagent actions=discoverRepository,refineRepository,submitExploration
typeagent requests=3 grep=3 lsp=0 tokens=16772 durationMs=13379
typeagent-lsp actions=discoverRepository,refineRepository,submitExploration
typeagent-lsp requests=3 grep=2 lsp=1 tokens=15787 durationMs=12669
ripgrepSha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
```

Both TypeAgent arms used raw grammar ingress, one active Explorer agent/schema,
zero dispatcher model requests, no Copilot or MCP, and exact combined usage.

## Unseen cohort selection

Selection occurred only after the smoke and source freeze. It read dataset
instance IDs, prior manifest/result task IDs, and retained cohort ID files. It
did not inspect candidate prompts, patches, repositories, difficulty, or
scores.

- Seed: `direct-typeagent-r19-preflight-random10-20260724`
- Method: package FNV-1a seed normalization and Mulberry32/Fisher-Yates shuffle
- Frozen IDs: [cohort.json](./cohort.json)

```text
datasetRows=500
manifestFiles=146
resultFiles=144
cohortFiles=9
priorUniqueIds=314
eligibleIds=186
selectedUnique=10
overlap=[]
```

## Real random-10 matrix

The cohort ran once, serialized at model concurrency one:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id "$RANDOM_RUN_ID" \
  --limit 10 \
  --task-ids-file packages/exploreBench/evidence/direct-typeagent-random10-r19/cohort.json \
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

The combined JSONL then generated the three-arm report without another model
request:

```bash
node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input "$RANDOM_RUN_DIR/results.jsonl" \
  --lsp-input "$RANDOM_RUN_DIR/results.jsonl" \
  --output-dir "$RANDOM_RUN_DIR"
```

Raw execution and terminal-result counts:

```text
Arm             Executions  Failed executions  Retry executions  Terminal success
baseline        10          0                  0                 10/10
typeagent       10          0                  0                 10/10
typeagent-lsp   13          4                  3                  9/10
```

The LSP arm retried three tasks. Two retries succeeded. The remaining task had
a first execution exhaust the repository budget after 50.5 seconds and a second
execution hit a provider response timeout after 122.4 seconds. These failed
executions remain in `results.jsonl`; they are not included in final-success
tokens or latency.

## Common final-success metrics

Quality, tokens, and latency use only the nine tasks whose terminal execution
succeeded in all three arms. Latency counts each task's final successful
execution exactly once. P95 is nearest-rank.

| Arm                    | Recall |       File P/R/F1 |       Line P/R/F1 |  Tokens |      Mean/P50/P95 | Complete |
| ---------------------- | -----: | ----------------: | ----------------: | ------: | ----------------: | -------: |
| Copilot SDK + Explorer |  0.769 | 0.578/1.000/0.704 | 0.128/0.539/0.167 | 252,262 | 23.1s/21.3s/33.0s |    10/10 |
| TypeAgent              |  0.654 | 0.574/0.889/0.681 | 0.104/0.420/0.160 | 141,495 | 17.1s/16.5s/24.5s |    10/10 |
| TypeAgent + LSP        |  0.677 | 0.778/0.833/0.778 | 0.311/0.521/0.350 | 133,803 | 16.5s/17.2s/21.7s |     9/10 |

Raw integrity summary:

```text
rows=33 cacheCompatibilityRevision=19 commonSuccessfulTasks=9
baselineIsolation=10/10
treatmentGrammarIsolation=19/19
soleExplorer=19/19
boundedSubmittedActions=19/19
plainLspCalls=0
lspSuccessfulRowsWithLsp=9/9 lspCalls=9 lspLocations=8
plainRipgrep=26/26
lspRipgrep=20/20
```

## Strict result

This revision is rejected against the full success criteria.

- Both TypeAgent arms pass token, mean-latency, and p50-latency criteria.
- Plain TypeAgent passes 10/10 reliability, but misses baseline recall, file F1,
  and line F1.
- TypeAgent with LSP exceeds baseline file F1 and line F1, but misses recall and
  terminal reliability.
- No result, retry, or failed criterion was hidden or reclassified.

The quality gap is not caused by MCP, Copilot leakage, a JavaScript grep
fallback, dispatcher token undercounting, or retry-inclusive latency. The
consumed cohort showed one generic missed-file case in each treatment and LSP
reliability loss from repository-budget recovery plus provider-tail failures.
No task-specific correction was made after observing this cohort.
