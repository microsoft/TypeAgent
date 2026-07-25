# Direct TypeAgent Explorer revision-28 evidence

Date: 2026-07-24 (America/Los_Angeles)

## Outcome

Revision 28 preserves the direct TypeAgent dispatcher → sole Explorer AppAgent
→ Code Mode harness and the shared Copilot-packaged ripgrep implementation. It
removes three generic treatment-only constraints: unused discovery calls now
carry into refinement, short grep observations are bounded by the 40,000
character action result rather than a fixed count of 40, and exact read evidence
is serialized before broad grep evidence. Prompt wording now independently asks
for every evidence-indicated block without singular “strongest candidate” or
“narrow or omit” bias.

The final untouched cohort does **not** meet the complete parity objective.
Both TypeAgent arms use substantially fewer tokens and improve mean latency,
but plain TypeAgent trails baseline recall by 0.021 and p50 latency by 0.57s;
TypeAgent with LSP trails baseline file F1 by 0.028 and line F1 by 0.035.
The cohort was not tuned or rerun after this result.

## Final resource and environment

The final resource is the built ExploreBench CLI executing all three canonical
arms against SWE-bench Verified through the configured local OpenAI-compatible
gateway route. Authentication came from the named `LITELLM_MASTER_KEY`
environment entry in an existing local environment file; no credential value
was logged or copied into an artifact.

Canonical arms:

- `baseline`: Copilot SDK with the Explorer subagent.
- `typeagent`: direct TypeAgent dispatcher with only Explorer enabled.
- `typeagent-lsp`: the same TypeAgent path with LSP navigation enabled.

## Generic regressions

Before implementation, the focused tests failed on the old contracts:

```text
Expected length: 80
Received length: 40

Expected repository calls: 6
Received repository calls: 5

Expected system prompt not to match /strongest candidate/i
Received prompt: “read the strongest candidate...”
```

After the correction, the focused regression set passed:

```text
Test Suites: 2 passed, 2 total
Tests:       63 skipped, 3 passed, 66 total
```

Additional coverage freezes read-first serialization under the result-size cap,
pre-serialization `observationsTruncated`, neutral action-result instructions,
and five valid refinement reads after one discovery call.

## Build, tests, and formatting

```text
Agent Flows: 7 suites, 77 tests passed
Dispatcher: 61 suites, 992 tests passed
Explorer: 6 suites, 104 tests passed
ExploreBench: 143 tests passed
Explorer formatting: passed
Changed ExploreBench files formatting: passed
git diff --check: passed
```

The package-wide ExploreBench formatter also sees the pre-existing untracked
`examples/swebench-verified-500-session-comparison.html` and reports its
formatting differences. That unrelated file was not rewritten; the changed
README/source/test files pass the exact formatting check.

## One-row end-to-end smoke

The real built CLI ran one row through all three arms at concurrency one:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r28-smoke-1 \
  --limit 1 \
  --model azure/gpt-5.6-luna \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp \
  --max-attempts 2 \
  --max-concurrency 1 \
  --timeout-ms 360000 \
  --force-rerun \
  --litellm-base-url http://127.0.0.1:4627/v1 \
  --api-key-env LITELLM_MASTER_KEY \
  --env-file "$EXPLORE_BENCH_ENV_FILE"
```

```text
baseline       attempt 1  ok     20.783s  46,728 tokens
typeagent      attempt 1  failed 81.736s  retry-only
typeagent      attempt 2  ok     30.954s  42,334 tokens
typeagent-lsp  attempt 1  ok     39.414s  17,605 tokens

validateResultRows: passed
validateRuntimeEvidence: passed
cache compatibility revision: 28
ripgrep SHA-256: e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
```

The failed TypeAgent smoke execution is retained but excluded from the
final-success token and latency comparison.

## Source/build freeze

The runtime was frozen before cohort selection and independently rehashed after
the final benchmark. Both values match exactly:

```text
algorithm=SHA-256 over each sorted path, NUL, file content, NUL
sourceFiles=56
sourceDigest=8ba96f923192d6ad88b1997442063259cdbeea9e13e73d45728845339e736ff6
builtFiles=160
builtDigest=1a72a25ac94a51bb0847a0a41105c644b5dab0ac1cfda016b992e6a0b2460023
```

## Untouched cohort selection

Selection used only instance IDs and file paths after the runtime freeze. It
did not inspect task prompts, repositories, patches, expected locations,
scores, traces, or model payloads. A second independent calculation reproduced
the exact IDs and order.

```text
seed=direct-typeagent-r28-final-random10-20260724
normalizedSeed=996673777
method=FNV-1a normalization + Mulberry32/Fisher-Yates
datasetRows=500
manifestFiles=160
resultFiles=159
priorCohortFiles=15
excludedUniqueIds=364
eligibleIds=136
selectedUnique=10
overlap=[]
selectionInventorySha256=0770b6bd42d773696f3b9c749375090692d54584d29ff499c7be381219be0f2e
```

The frozen IDs are in [cohort.json](./cohort.json).

## Final random-10 command

The cohort ran exactly once at model concurrency one:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r28-random10-1 \
  --limit 10 \
  --task-ids-file packages/exploreBench/evidence/direct-typeagent-random10-r28/cohort.json \
  --model azure/gpt-5.6-luna \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp \
  --max-attempts 2 \
  --max-concurrency 1 \
  --timeout-ms 360000 \
  --force-rerun \
  --litellm-base-url http://127.0.0.1:4627/v1 \
  --api-key-env LITELLM_MASTER_KEY \
  --env-file "$EXPLORE_BENCH_ENV_FILE"
```

The raw output contains 39 execution rows. Retries are retained separately and
never summed into task latency:

| Arm             | Raw executions | Final successes | Failed executions | Retry executions | Terminal failures |
| --------------- | -------------: | --------------: | ----------------: | ---------------: | ----------------: |
| Baseline        |             16 |            6/10 |                10 |                6 |                 4 |
| TypeAgent       |             10 |           10/10 |                 0 |                0 |                 0 |
| TypeAgent + LSP |             13 |           10/10 |                 3 |                3 |                 0 |

Only six tasks have a final success in all three arms. The comparison below
uses exactly that common set and each key’s final successful execution.

## Final retry-excluded comparison

| Arm                    | Recall |       File P/R/F1 |       Line P/R/F1 |  Tokens | Latency mean/p50/p95 |
| ---------------------- | -----: | ----------------: | ----------------: | ------: | -------------------: |
| Copilot SDK + Explorer |  0.706 | 0.417/0.833/0.556 | 0.101/0.578/0.169 | 291,690 |    40.4s/34.6s/82.3s |
| TypeAgent              |  0.685 | 0.472/0.833/0.583 | 0.133/0.536/0.196 | 166,624 |    33.1s/35.2s/41.6s |
| TypeAgent + LSP        |  0.706 | 0.389/0.833/0.528 | 0.079/0.578/0.134 | 172,148 |    30.9s/28.5s/50.2s |

Independent recomputation matched every quality, token, and latency field in
`report-three-arm.json`.

Relative to baseline on the common six:

- TypeAgent saves 125,066 tokens (42.88%) and improves mean latency and both
  F1 values, but recall is 0.021 lower and p50 is 0.57s slower.
- TypeAgent with LSP saves 119,542 tokens (40.98%), improves mean and p50
  latency, and exactly matches recall, but file F1 is 0.028 lower and line F1
  is 0.035 lower.

## Isolation, ripgrep, LSP, and accounting audit

```text
validateResultRows(all 39 rows): passed
validateRuntimeEvidence(current packaged executables): passed
reusedFrom rows: 0
runtime cachedOnly: false

Successful direct TypeAgent rows: 20/20
natural-language grammar dispatch: 20/20
exact request identity: 20/20
active AppAgents exactly [explorer]: 20/20
outer translation requests/tokens: 0/0
Copilot use in TypeAgent arms: 0
MCP use in TypeAgent arms: 0
subagent use in TypeAgent arms: 0

TypeAgent execute_action requests: 39
TypeAgent + LSP execute_action requests: 35
all reasoning tools: execute_action only
every row completed discover -> refine -> submitExploration

executed TypeAgent grep calls with host provenance: 67
engine/executable on all 67: ripgrep/rg
every successful direct row has a successful executed ripgrep call: yes

plain TypeAgent LSP calls: 0
TypeAgent + LSP adoption: 10/10
successful LSP calls: 10
positive LSP results: 10

successful-row usage arithmetic and telemetry: exact
```

The baseline factory and direct Explorer both receive the same runner-resolved
Copilot-packaged ripgrep path. Runtime evidence records it as shared across
arms, and successful TypeAgent rows fail closed without executed ripgrep
provenance.

## Artifact integrity

```text
29fa8a6b16228cb28405780d244d6e6b75c9528626ed13b6beb7aee126d5b4e0  cohort.json
cc5b25d645414b3a0e3d13ab870dbd8d7ef97eeb7db4ac1c7beadb61711bd5b8  manifest.json
b73216692aaf862c1f1abf77433879e67b4ed20757a6c66ef2b2c0d95d6b41cf  copilot-runtime.json
30eda9f7c17d062674ef5605c908e5be167b1895331ecdab0dd721454985b1e8  results.jsonl
9fa641f174aba7c9fa26bc091f6162de186c6f31ba3307d2f1e9c547c14ee662  report-three-arm.json
31ceaa84ad0901adad800ebf9378c09c97cf6b0a83f63f34dd1b5c5a05db7711  report-three-arm.md
```

Local run artifacts:

- [results.jsonl](../../../../.data/explore-bench/runs/direct-typeagent-luna-r28-random10-1/results.jsonl)
- [report-three-arm.md](../../../../.data/explore-bench/runs/direct-typeagent-luna-r28-random10-1/report-three-arm.md)
- [manifest.json](../../../../.data/explore-bench/runs/direct-typeagent-luna-r28-random10-1/manifest.json)
- [copilot-runtime.json](../../../../.data/explore-bench/runs/direct-typeagent-luna-r28-random10-1/copilot-runtime.json)

## Limitations

- Baseline reached final success on only 6/10 tasks, so this is not a balanced
  ten-task three-way completed cohort. The valid comparative sample is six.
- The cohort is Python-only at the gold-patch level. LSP adoption is substantive
  through the configured Python server; TypeScript LSP coverage is zero here.
- This revision is preserved as an honest failed quality-parity result. No
  post-cohort prompt/runtime tuning or second run was performed.
