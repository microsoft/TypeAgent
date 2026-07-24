# Direct TypeAgent random-10 verification (revision 14)

## Goal and final resource

Run one serialized SWE-bench Verified matrix after removing the baseline's
live-checkout read/shell advantage:

1. Copilot SDK with the custom Explorer subagent (`baseline`)
2. Canonical TypeAgent dispatcher with the sole Explorer AppAgent (`typeagent`)
3. The same direct TypeAgent path with LSP enabled (`typeagent-lsp`)

All arms expose the same immutable-snapshot `read`, `grep`, `glob`, and `ls`
primitives. Every grep uses the same Copilot-packaged `rg`. The final resources
are the 41-execution JSONL stream and generated reports under:

`$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/`

Date: 2026-07-24. Credentials came from `LOCAL_LITELLM_API_KEY`; the value was
never printed or stored in commands, telemetry, reports, or this evidence.

## Frozen cohort provenance

Selection accessed only dataset instance IDs, prior result task IDs, prior
manifest task IDs, and earlier cohort ID files. It did not inspect prompts,
gold patches, scores, repository contents, or task difficulty.

- Dataset rows: 500
- Prior manifest files: 138
- Prior result files / rows: 137 / 2,887
- Prior cohort files: 3
- Unique excluded task IDs: 284
- Eligible task IDs: 216
- Seed: `direct-typeagent-r14-shared-snapshot-random10-20260724`
- Method: package FNV-1a seed normalization, Mulberry32/Fisher-Yates shuffle,
  first 10 eligible IDs
- Frozen IDs: [cohort.json](./cohort.json)

Raw selection audit:

```text
datasetRows=500
manifestFiles=138
resultFiles=137
resultRows=2887
cohortFiles=3
excludedTaskIds=284
eligibleTaskIds=216
cohortUnique=10
overlap=[]
```

## Frozen implementation gates

The shared-snapshot correction and cache compatibility revision 14 were
complete before cohort selection. The hashes below identify the exact source
and build used for this cohort. A final post-cohort audit subsequently found
resume/cache-provenance gaps outside fresh model execution; revision 15 closes
those gaps without changing prompts, repository tools, scoring, or arm
execution. Its separate verification is recorded in
[`../direct-typeagent-final-r15/evidence.md`](../direct-typeagent-final-r15/evidence.md).

```text
Explorer:
Test Suites: 5 passed, 5 total
Tests:       73 passed, 73 total

ExploreBench:
tests 133
pass 133
fail 0

Scoped formatting:
All matched files use Prettier code style!

git diff --check:
(no output; exit 0)
```

The source digest covers the exact runtime source roots and custom-agent file;
the built digest covers both compiled package trees. These commands are the
complete reproducible aggregation procedure, including path ordering:

```bash
rg --files .copilot/agents/explorer.md \
  ts/packages/agents/explorer/src \
  ts/packages/exploreBench/src |
  LC_ALL=C sort |
  while IFS= read -r file; do shasum -a 256 "$file"; done |
  shasum -a 256

rg --files ts/packages/agents/explorer/dist \
  ts/packages/exploreBench/dist |
  LC_ALL=C sort |
  while IFS= read -r file; do shasum -a 256 "$file"; done |
  shasum -a 256
```

The counts and digests were identical immediately before and after the paid
run:

```text
sourceFiles=39
sourceDigest=afd02b738a9f7880ccd012295dfe1cd62fcf2e9107df7ee14b01548527c2f525
builtFiles=112
builtDigest=067be1e2748f69bd68041b77250301ccf78e1f003854edf2570eaa30776211f3
ripgrepSha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
```

Provider preflight reached the real local gateway:

```text
credentialAvailable=true
livelinessStatus=200
modelsJson=true modelAdvertised=true
```

## Real one-task smoke

Working directory: `$REPO/ts`.

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r14-shared-snapshot-smoke-1 \
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
ok  astropy__astropy-12907  azure/gpt-5.6-luna  baseline       24488ms  direct=0  subagent=1/1  mainInspect=false
ok  astropy__astropy-12907  azure/gpt-5.6-luna  typeagent      20451ms  direct=1  subagent=0/0  mainInspect=false
ok  astropy__astropy-12907  azure/gpt-5.6-luna  typeagent-lsp  19322ms  direct=1  subagent=0/0  mainInspect=false
```

Smoke trace validation:

```text
rows=3
cacheCompatibilityRevision=14
baselineNoBash=true
directTypeAgentExecutions=1/1
plainTypeAgentRipgrepExecutions=3
lspTypeAgentRipgrepExecutions=1
plainLspCalls=0
lspCalls=1
lspResults=1
exactUsageAccounting=true
runtimeSearch=ripgrep/copilot-packaged/rg
```

## Real random-10 matrix

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r14-shared-snapshot-random10-1 \
  --limit 10 \
  --task-ids-file $REPO/ts/packages/exploreBench/evidence/direct-typeagent-random10-r14/cohort.json \
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

Raw CLI boundary excerpt:

```text
cache  force-rerun  archived=0
runId=direct-typeagent-luna-r14-shared-snapshot-random10-1
tasks=10 models=1 variants=3 rows=30
...
results=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/results.jsonl
report=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/report.json
markdown=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/report.md
```

The single combined stream generated the three-arm report:

```bash
node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input .data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/results.jsonl \
  --lsp-input .data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/results.jsonl \
  --output-dir .data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1
```

```text
report=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/report-three-arm.json
markdown=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r14-shared-snapshot-random10-1/report-three-arm.md
```

## Common final-success comparison

Quality, tokens, and latency use only the five tasks whose terminal execution
succeeded in every arm. Tokens are final-success totals. Latency counts each
task's final successful execution exactly once; failed retries are excluded.

| Arm           |   N | Recall |           File P/R/F1 |           Line P/R/F1 |  Tokens | Latency mean / p50 / p95 |
| ------------- | --: | -----: | --------------------: | --------------------: | ------: | -----------------------: |
| baseline      |   5 |  0.807 | 0.433 / 1.000 / 0.600 | 0.198 / 0.614 / 0.215 | 125,124 |    22.4s / 21.2s / 33.2s |
| typeagent     |   5 |  0.691 | 0.700 / 1.000 / 0.800 | 0.278 / 0.383 / 0.255 |  89,858 |    22.6s / 20.6s / 28.0s |
| typeagent-lsp |   5 |  0.711 | 0.700 / 0.800 / 0.733 | 0.437 / 0.623 / 0.438 | 117,325 |    26.3s / 24.5s / 30.6s |

Plain TypeAgent saved 35,266 tokens (28.2%) versus baseline. TypeAgent+LSP
saved 7,799 tokens (6.2%). Both TypeAgent arms improved file and line F1, but
both had lower overall recall. Plain TypeAgent's mean latency was 0.1s slower
and p50 was 0.6s faster; the LSP arm was 3.9s slower at mean and 3.3s slower at
p50. The common cohort is five tasks, so these results do not support a broad
equivalence claim.

An independent calculation from `results.jsonl` matched every generated report
metric exactly.

## Executions, retries, and reliability

| Arm           | Requested | Executions | Retry executions | Failed executions | Terminal successes | Terminal failures |
| ------------- | --------: | ---------: | ---------------: | ----------------: | -----------------: | ----------------: |
| baseline      |        10 |         10 |                0 |                 0 |                 10 |                 0 |
| typeagent     |        10 |         15 |                5 |                 8 |                  7 |                 3 |
| typeagent-lsp |        10 |         16 |                6 |                11 |                  5 |                 5 |

Failure counts over every failed execution:

```text
typeagent:
  unexpected outer Explorer action/request = 6
  provider fetch returned no response = 2

typeagent-lsp:
  unexpected outer Explorer action/request = 6
  repository call budget exhausted before exact read = 3
  provider fetch returned no response = 1
  provider request timeout = 1
```

Reliability remains the main failed criterion: baseline completed 10/10 tasks,
plain TypeAgent completed 7/10, and TypeAgent+LSP completed 5/10. No prompt,
repository-tool, scoring, or arm-execution change was made after this cohort was
selected or observed. The later revision-15 change is limited to fail-closed
resume and cached-evidence validation.

## Architecture, usage, LSP, and ripgrep integrity

Validation over all 12 successful TypeAgent treatment rows proved:

```text
directDispatch=true
exactUsageAccounting=true
provenHostOwnedRipgrep=true
plainNoLsp=true
lspSuccessfulRowsHaveResults=true
baselineNoBash=true
```

The runtime evidence and TypeAgent call traces record:

```text
engine=ripgrep
source=copilot-packaged
executable=rg
sha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
sharedAcrossArms=true
snapshot=filtered-immutable-directory
```

Across the full terminal cohort, the LSP arm adopted LSP on 7/10 tasks and
retained seven successful navigation calls with seven locations. All five
common-success tasks had one successful LSP call and result. Plain TypeAgent
made no LSP calls.

Artifact validation:

```text
resultsRows=41
cohortMatchesManifest=true
cacheCompatibilityRevision=14
independentMetricsMatch=true
sourceDigestStable=true
builtDigestStable=true
runtimeRipgrepHashMatches=true
resultsSha256=484f1319551623af356dc0ff178ce3edf7bb9cd991b31b84a038db4223f4f467
threeArmJsonSha256=1aa629750e162cc9278337f0efd9ba3cad48c89dd1d81b68d6422f961655d21c
threeArmMarkdownSha256=713edd4b1e54ee1ead781216496d4ce1884e1564e0be9ad44da7139ddb835fba
```

## Result

The run proves the requested direct TypeAgent harness, sole Explorer AppAgent,
typed Code Mode loop, optional all-language LSP, exact token accounting, and
shared immutable repository implementation. TypeAgent grep executes the same
Copilot-packaged ripgrep as baseline, and the baseline has no live-checkout
read or shell bypass.

Both TypeAgent arms used fewer tokens and improved file/line F1 on the common
cohort. The stronger parity claim is rejected because overall recall and
treatment reliability remained below baseline, and the LSP arm also had worse
mean and p50 latency. These are the observed frozen-cohort results; the cohort
was not tuned or rerun.
