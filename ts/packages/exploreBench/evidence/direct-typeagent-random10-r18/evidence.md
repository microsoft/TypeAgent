# Direct TypeAgent random-10 verification (revision 18)

## Goal and final resource

Verify one frozen, serialized SWE-bench Verified comparison of:

1. Copilot SDK with the Explorer subagent (`baseline`)
2. TypeAgent dispatcher with the sole Explorer AppAgent in Code Mode (`typeagent`)
3. The same TypeAgent path with LSP (`typeagent-lsp`)

The final resources are the built benchmark CLI and the 32-execution JSONL
stream under:

`$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r18-ripgrep-timeout-random10-1/`

Artifact level: Level 1 markdown. Date: 2026-07-24. Provider credentials
came from `LOCAL_LITELLM_API_KEY`; the value was never printed or copied into
this evidence.

## Frozen implementation and local gates

Revision 18 uses the same Copilot-packaged ripgrep binary and shared immutable
repository implementation in all three arms. A broad grep receives an
actionable internal deadline before Code Mode's outer deadline, while a later
path-scoped call can succeed. Baseline and TypeAgent also share this neutral
semantic policy:

> Start with exact task clues; narrow broad or truncated searches before
> reading; follow task- or evidence-indicated companion sites; read every
> submitted range; stop after all indicated sites are verified.

The former TypeAgent-only category ranking for production files over tests,
docs, examples, and generated files was removed before cohort selection.

The deterministic fake-ripgrep regression reached the built API:

```text
PASS dist/test/repositoryApi.spec.js
✓ surfaces an actionable ripgrep timeout before the script deadline and permits a narrower retry
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
```

Authoritative package gates:

```text
Explorer:
Test Suites: 6 passed, 6 total
Tests:       85 passed, 85 total

ExploreBench:
tests 137
pass 137
fail 0
cancelled 0
skipped 0
todo 0

Explorer formatting:
All matched files use Prettier code style!

Scoped formatting for every changed benchmark file:
All matched files use Prettier code style!

git diff --check:
(no output; exit 0)
```

The package-wide ExploreBench formatter also inspects a pre-existing untracked
generated HTML file that is intentionally preserved and excluded from this
change. Every changed tracked benchmark file passed the explicit scoped check.

The runtime source and built outputs were hashed in sorted path order before
the smoke, after the smoke, and after the random-10 run. All three observations
were identical:

```text
sourceFiles=39
sourceDigest=17e4044e259be3ae04db1ee0ad8ffbdd4c66b638092d6b0b1f699be764fef651
builtFiles=114
builtDigest=bff9b42497b825a56f86c11495193a7eabb21ff3bd9873f203d2c3723d30aea3
ripgrepSha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
```

Provider preflight reached the real gateway without exposing the credential:

```text
livelinessStatus=200
livelinessBody="I'm alive!"
requestedModelAdvertised=true
```

## Real one-task smoke

Working directory: `$REPO/ts`.

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r18-ripgrep-timeout-smoke-1 \
  --limit 1 \
  --model azure/gpt-5.6-luna \
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
ok  astropy__astropy-12907  azure/gpt-5.6-luna  baseline       20067ms  direct=0  subagent=1/1  mainInspect=false
ok  astropy__astropy-12907  azure/gpt-5.6-luna  typeagent      11360ms  direct=1  subagent=0/0  mainInspect=false
ok  astropy__astropy-12907  azure/gpt-5.6-luna  typeagent-lsp  11945ms  direct=1  subagent=0/0  mainInspect=false
exit_code=0
```

Smoke validation from the emitted JSONL:

```text
rows=3
cacheCompatibilityRevision=18
baselineDelegations=1
baselineMainInspection=false
typeagentDispatch=grammar
typeagentDispatcherRequests=0
typeagentActions=discoverRepository,refineRepository,submitExploration
typeagentGrepCalls=3/3 proven ripgrep
typeagentLspCalls=0
typeagentLspGrepCalls=2/2 proven ripgrep
typeagentLspCalls=1
typeagentUsedCopilot=false
typeagentUsedMcp=false
```

## Unseen cohort selection

Selection read only dataset instance IDs, prior manifest/result task IDs, and
retained cohort ID files. It did not inspect task prompts, gold patches,
scores, repository contents, or difficulty fields.

- Seed: `direct-typeagent-r18-ripgrep-timeout-random10-20260724`
- Method: package FNV-1a seed normalization, Mulberry32/Fisher-Yates shuffle,
  first 10 eligible IDs
- Frozen IDs: [cohort.json](./cohort.json)

```text
datasetRows=500
manifestFiles=143
resultFiles=142
resultRows=2977
cohortFiles=4
excludedTaskIds=304
eligibleTaskIds=196
cohortUnique=10
overlap=[]
```

## Real random-10 matrix

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r18-ripgrep-timeout-random10-1 \
  --limit 10 \
  --task-ids-file packages/exploreBench/evidence/direct-typeagent-random10-r18/cohort.json \
  --model azure/gpt-5.6-luna \
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

```text
cache  force-rerun  archived=0
runId=direct-typeagent-luna-r18-ripgrep-timeout-random10-1
tasks=10 models=1 variants=3 rows=30
...
results=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r18-ripgrep-timeout-random10-1/results.jsonl
report=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r18-ripgrep-timeout-random10-1/report.json
markdown=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r18-ripgrep-timeout-random10-1/report.md
exit_code=0
```

The combined JSONL generated the three-arm report without another model call:

```bash
node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input .data/explore-bench/runs/direct-typeagent-luna-r18-ripgrep-timeout-random10-1/results.jsonl \
  --lsp-input .data/explore-bench/runs/direct-typeagent-luna-r18-ripgrep-timeout-random10-1/results.jsonl \
  --output-dir .data/explore-bench/runs/direct-typeagent-luna-r18-ripgrep-timeout-random10-1
```

## Common final-success metrics

Quality, tokens, and latency use only the eight tasks whose terminal execution
succeeded in all three arms. Tokens are terminal-success totals. Latency counts
each task's final successful execution exactly once; failed retries are
excluded.

| Arm             |   N | Recall |           File P/R/F1 |           Line P/R/F1 |  Tokens | Latency mean / p50 / p95 |
| --------------- | --: | -----: | --------------------: | --------------------: | ------: | -----------------------: |
| Baseline        |   8 |  0.753 | 0.438 / 0.896 / 0.537 | 0.103 / 0.610 / 0.128 | 239,839 |    31.6s / 33.3s / 45.0s |
| TypeAgent       |   8 |  0.664 | 0.510 / 0.792 / 0.592 | 0.254 / 0.535 / 0.281 | 112,469 |    22.9s / 24.5s / 29.1s |
| TypeAgent + LSP |   8 |  0.534 | 0.625 / 0.667 / 0.633 | 0.302 / 0.402 / 0.302 | 125,211 |    23.6s / 23.2s / 43.5s |

An independent direct JSONL calculation matched every generated quality,
token, and latency value exactly.

Relative to baseline, TypeAgent used 127,370 fewer tokens (53.1%), with mean
latency 8.7s lower and p50 8.7s lower. TypeAgent + LSP used 114,628 fewer
tokens (47.8%), with mean latency 7.9s lower and p50 10.0s lower. Both
TypeAgent arms improved file and line F1, but overall recall was lower:
TypeAgent by 0.090 and TypeAgent + LSP by 0.219.

## Executions, retries, and reliability

All executions are counted here. A retry is one execution after the first for
the same task/model/arm key.

| Arm             | Requested | Executions | Retry executions | Failed executions | Terminal successes | Terminal failures |
| --------------- | --------: | ---------: | ---------------: | ----------------: | -----------------: | ----------------: |
| Baseline        |        10 |         10 |                0 |                 0 |                 10 |                 0 |
| TypeAgent       |        10 |         10 |                0 |                 0 |                 10 |                 0 |
| TypeAgent + LSP |        10 |         12 |                2 |                 4 |                  8 |                 2 |

Overall, 28/30 task-arm keys succeeded. The stream contains 32 executions:
28 successful and 4 failed. Both retry executions failed.

The four failed LSP executions were audited only after the frozen run ended:

```text
django-13794 attempt 1: refinement exhausted the eight-call repository budget without an exact read
django-13794 attempt 2: unread submission range, then the five-turn limit
django-16819 attempt 1: repeated refinement candidate/read/program failures, then the five-turn limit
django-16819 attempt 2: repeated refinement candidate/read failures, then the five-turn limit

grepCallsAcrossFailures=19
grepErrors=0
maxGrepDuration=12.37s
actionableRipgrepTimeouts=0
```

The revision-17 dominant failure—an outer script timeout masking a 30-second
ripgrep timeout—did not recur. The two LSP task failures remain real terminal
reliability failures and are not attributed to ripgrep.

## Harness integrity

Validation over every terminal-success row produced:

```text
typeagentSuccessfulRows=18
grammarDispatch=true
zeroDispatcherModelRequests=true
oneActiveExplorerAgent=true
completedActionSequence=true
explicitSubmission=true
usedCopilot=false
usedMcp=false
allSuccessfulTypeagentGrepCallsProvenRipgrep=true
plainTypeagentLspCalls=0
lspSuccessfulRowsWithAdoption=8
baselineDelegationAndIsolation=true
runtimeSearch=ripgrep/copilot-packaged/rg
runtimeSearchSharedAcrossArms=true
```

## Result

The ripgrep correction passes its direct regression and removed the masked
broad-search timeout failure seen in revision 17. Plain TypeAgent now matches
baseline terminal reliability and beats baseline on token use, mean latency,
p50 latency, file F1, and line F1. TypeAgent + LSP also beats baseline on the
common cohort's tokens, latency, file F1, and line F1.

The full parity goal is **not achieved**. Both TypeAgent arms have lower overall
recall than baseline, and TypeAgent + LSP completes only 8/10 tasks versus
baseline's 10/10. These unseen results are published without runtime tuning or
rerunning the cohort.
