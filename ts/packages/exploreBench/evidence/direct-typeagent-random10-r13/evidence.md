# Direct TypeAgent random-10 verification (revision 13)

## Goal and final resource

Run one clean, serialized SWE-bench Verified matrix on a frozen unseen cohort:

1. Copilot SDK with the custom Explorer subagent (`baseline`)
2. Canonical TypeAgent dispatcher with the sole Explorer AppAgent (`typeagent`)
3. The same direct TypeAgent path with LSP enabled (`typeagent-lsp`)

The final resources are the 45-row JSONL stream and generated three-arm report
under:

`$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/`

Date: 2026-07-24. Credentials came from `LOCAL_LITELLM_API_KEY`; the value was
never printed or stored in commands, telemetry, reports, or this evidence.

## Frozen cohort provenance

Selection accessed only dataset instance IDs, prior result task IDs, prior
manifest task IDs, and the frozen cohort list. It did not inspect prompts, gold
patches, or scores.

- Dataset rows: 500
- Prior result files / rows: 135 / 2,839
- Unique prior result task IDs: 244
- Unique prior manifest task IDs: 274
- Eligible IDs after the exclusion union: 226
- Seed: `direct-typeagent-r13-host-proof-unseen-random10-20260724`
- Method: package FNV-1a seed normalization, Mulberry32/Fisher-Yates shuffle,
  first 10 eligible IDs
- Frozen IDs: [cohort.json](./cohort.json)

Raw selection audit:

```text
datasetRows=500
priorResultFiles=135
priorResultRows=2839
priorResultTaskIds=244
priorManifestTaskIds=274
exclusionTaskIds=274
eligibleTaskIds=226
cohortUnique=10
resultOverlap=[]
manifestOverlap=[]
```

An earlier cohort-2 run was interrupted after six rows because a delegated
read-only audit unexpectedly changed and rebuilt the shared runtime during the
run. Those partial rows are retained only as invalid diagnostic evidence. All
ten cohort-2 IDs were excluded before selecting this final cohort.

## Frozen implementation gates

The host-owned ripgrep provenance correction was complete before cohort
selection. Every subagent was completed before the final source freeze.

```text
Explorer:
Test Suites: 5 passed, 5 total
Tests:       73 passed, 73 total

ExploreBench:
tests 131
pass 131
fail 0
cancelled 0
skipped 0

Scoped formatting:
All matched files use Prettier code style!

git diff --check:
(no output; exit 0)
```

Frozen source and built-artifact digests were identical before and after the
paid run:

```text
source=878b72fc376bd807160c9293c00efc6299a7a411f4922e8bb98089cf1ed1d464
built=aaf222dd21891fc366a107d1c70f473c71e9ae362ad71ec4ab4088fbccd35545
```

Provider preflight reached the real local gateway and verified:

```text
livelinessStatus=200
modelsStatus=200
modelAdvertised=true
modelGroupStatus=200
matchingModelGroups=1
providerCount=1
pylsp=v1.14.0
```

## Real CLI run

Working directory: `$REPO/ts`.

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r13-host-proof-unseen-random10-3 \
  --limit 10 \
  --task-ids-file $REPO/ts/packages/exploreBench/evidence/direct-typeagent-random10-r13/cohort.json \
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

Raw CLI boundary output:

```text
cache force-rerun archived=0
runId=direct-typeagent-luna-r13-host-proof-unseen-random10-3
tasks=10 models=1 variants=3 rows=30
output=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/results.jsonl
...
results=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/results.jsonl
report=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/report.json
markdown=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/report.md
```

The single combined stream was used for both three-arm inputs:

```bash
node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input .data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/results.jsonl \
  --lsp-input .data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/results.jsonl \
  --output-dir .data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3
```

```text
report=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/report-three-arm.json
markdown=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r13-host-proof-unseen-random10-3/report-three-arm.md
```

## Common final-success comparison

Quality, tokens, and latency use only the three tasks whose terminal execution
succeeded in every arm. Tokens are final-success totals. Latency counts each
task's final successful execution exactly once; failed retries are excluded.

| Arm           |   N | Recall |           File P/R/F1 |           Line P/R/F1 |  Tokens | Latency mean / p50 / p95 |
| ------------- | --: | -----: | --------------------: | --------------------: | ------: | -----------------------: |
| baseline      |   3 |  0.933 | 0.361 / 1.000 / 0.522 | 0.226 / 0.866 / 0.349 | 103,869 |    27.5s / 26.7s / 34.4s |
| typeagent     |   3 |  0.947 | 0.667 / 1.000 / 0.778 | 0.343 / 0.894 / 0.472 |  55,696 |    27.3s / 28.0s / 29.9s |
| typeagent-lsp |   3 |  0.859 | 0.778 / 1.000 / 0.833 | 0.572 / 0.717 / 0.525 |  65,385 |    26.5s / 29.5s / 30.9s |

Plain TypeAgent saved 48,173 tokens (46.4%) versus baseline. TypeAgent+LSP
saved 38,484 tokens (37.0%). Plain TypeAgent improved recall, file F1, and line
F1. The LSP arm improved file and line F1 but had lower overall recall. Both
TypeAgent arms had slightly lower mean latency, but both had higher p50
latency. The common cohort is only three tasks, so this supports neither a
broad parity claim nor a broad regression claim by itself.

Independent recomputation from `results.jsonl` matched every generated report
metric exactly.

## Executions, retries, and reliability

| Arm           | Requested | Executions | Retry executions | Failed executions | Retried tasks | Terminal successes | Terminal failures |
| ------------- | --------: | ---------: | ---------------: | ----------------: | ------------: | -----------------: | ----------------: |
| baseline      |        10 |         10 |                0 |                 0 |             0 |                 10 |                 0 |
| typeagent     |        10 |         17 |                7 |                12 |             7 |                  5 |                 5 |
| typeagent-lsp |        10 |         18 |                8 |                13 |             8 |                  5 |                 5 |

Failure counts over every failed execution:

```text
typeagent:
  unexpected outer Explorer action/request = 10
  invalid function-call arguments = 1
  provider request timeout = 1

typeagent-lsp:
  unexpected outer Explorer action/request = 10
  reasoning loop five-turn limit = 2
  repository call budget exhausted before exact read = 1
```

The reliability criterion is not met: both treatment arms completed only 5/10
tasks versus baseline's 10/10. No implementation or prompt tuning was done
after the final cohort was frozen or observed.

## Architecture, usage, LSP, and ripgrep integrity

Validation over all ten successful TypeAgent treatment rows proved:

```text
allCanonicalDirectTypeAgent=true
exactUsageAccounting=true
plainNoLsp=true
lspSuccessfulRowsHaveResults=true
```

`allCanonicalDirectTypeAgent` requires raw natural-language ingress, one active
`explorer` AppAgent/schema, one translated typed `exploreRepository` action
carrying the same request, one execution, no Copilot or MCP use, and completed
`discoverRepository -> refineRepository -> submitExploration` actions.

Every successful TypeAgent row contains at least one host-owned grep execution
record. Model-controlled input cannot supply this record. The same packaged
ripgrep binary and immutable filtered snapshot implementation are injected into
all three arms:

```text
engine=ripgrep
source=copilot-packaged
executable=rg
sha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
sharedAcrossArms=true
snapshot=filtered-immutable-directory
runtimeHashMatches=true
```

Across the full ten-task terminal cohort, the LSP arm adopted LSP on 8/10
tasks and retained eight successful navigation calls with eight locations.
Exactly three calls/results occurred on the three common-success tasks. Plain
TypeAgent made no LSP calls.

Artifact validation:

```text
resultsRows=45
cohortMatchesManifest=true
cacheCompatibilityRevision=13
independentMetricsMatch=true
sourceDigestStable=true
builtDigestStable=true
runtimeRipgrepHashMatches=true
resultsSha256=d4b582953fc60b298b3574032b319640a3b60ef3ae2ed0b6e7f48698e5215add
threeArmJsonSha256=0e594508ffb1aa7b67b786727cba5449be8cbe6ef0588a924aeb2561d673b7c0
threeArmMarkdownSha256=3650bee920509f1feeef1448cd55ed2e152b2181d90501b7d11eb7e1530c2c72
```

## Result

The final run proves the requested direct TypeAgent harness, sole Explorer
AppAgent, inner typed Code Mode loop, optional all-language LSP registry, exact
token accounting, and shared packaged-ripgrep implementation without MCP or
Copilot in the treatment arms.

On the small common-success intersection, plain TypeAgent is at least on par
for the requested quality metrics while both TypeAgent arms use fewer tokens.
However, the stronger overall success claim is rejected because treatment
reliability is 5/10 and the common cohort is only 3/10. This evidence is
reported as observed and was not used for post-hoc tuning.
