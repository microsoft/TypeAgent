# Direct TypeAgent unseen random-10 verification (revision 12)

## Goal and final resource

Run the built ExploreBench CLI once on a frozen, never-before-executed
SWE-bench Verified cohort and compare:

1. Copilot SDK with the Explorer subagent (`baseline`)
2. Direct TypeAgent dispatcher with the sole Explorer AppAgent (`typeagent`)
3. The same direct TypeAgent path with LSP enabled (`typeagent-lsp`)

The final resources are the combined JSONL result stream and generated
three-arm report under:

`ts/.data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/`

Date: 2026-07-24. Credentials came from `LOCAL_LITELLM_API_KEY`; no secret
value was written to commands, output, telemetry, or this evidence.

## Frozen cohort provenance

Only `instance_id`, prior `taskId`, cohort IDs, and cache filenames were read
during selection. Prompts, gold patches, and scores were not inspected.

- Dataset rows: 500
- Prior primary result files / rows: 133 / 2,796
- Unique prior task IDs: 232
- Consumed revision-11 cohort IDs: 10, all already in the prior set
- Eligible never-run rows: 268
- Cached eligible repositories/images: 0
- Seed: `direct-typeagent-r12-unseen-random10-20260724`
- Method: dataset order, exclusion union, the package's FNV-1a seed
  normalization, Mulberry32/Fisher-Yates shuffle, first 10
- Frozen IDs: [cohort.json](./cohort.json)

Raw selection audit:

```text
datasetRows=500
priorResultFiles=133
priorResultRows=2796
priorUniqueTaskIds=232
r11UniqueTaskIds=10
uniqueExclusions=232
eligibleUnseenRows=268
cachedEligibleRows=0
cohortUnique=10
priorOverlap=[]
r11Overlap=[]
cachedRepoOverlap=[]
```

Strict cached-only and unseen selection was impossible: the 232 cached
repository IDs exactly equaled the 232 previously executed IDs. Preserving the
anti-overfitting condition therefore required pulling all ten selected images
and extracting new repositories. The runner created and removed only its own
temporary extraction containers; it did not stop, restart, or reconfigure any
existing container.

## Pre-run gates

The native-ripgrep character-class regression was first observed failing with
an empty result, then passed after native `rg --glob` became the sole grep-glob
semantic authority.

```text
PASS dist/test/repositoryApi.spec.js
Test Suites: 4 skipped, 1 passed, 1 of 5 total
Tests:       71 skipped, 1 passed, 72 total
```

Full package gates on the frozen source:

```text
Explorer:
Test Suites: 5 passed, 5 total
Tests:       72 passed, 72 total
Snapshots:   0 total

ExploreBench:
tests 128
pass 128
fail 0
cancelled 0
skipped 0

Scoped formatting:
All matched files use Prettier code style!

git diff --check:
(no output; exit 0)
```

The package-wide ExploreBench formatter also sees unrelated untracked example
HTML and reports `examples/swebench-verified-500-session-comparison.html`; that
generated file was deliberately not modified or included. All intended source,
tests, README, package metadata, and evidence pass scoped formatting.

## Real CLI run

Working directory:
`$REPO/ts`

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r12-canonical-unseen-random10-1 \
  --limit 10 \
  --task-ids-file "$PWD/packages/exploreBench/evidence/direct-typeagent-random10-r12/cohort.json" \
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

Raw CLI boundary output (middle per-execution lines omitted here; all 37 rows
remain in `results.jsonl`):

```text
runId=direct-typeagent-luna-r12-canonical-unseen-random10-1
tasks=10 models=1 variants=3 rows=30
output=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/results.jsonl
...
runId=direct-typeagent-luna-r12-canonical-unseen-random10-1
results=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/results.jsonl
report=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/report.json
markdown=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/report.md
```

The one combined stream was then used for both report inputs:

```bash
node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input .data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/results.jsonl \
  --lsp-input .data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/results.jsonl \
  --output-dir .data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1
```

```text
report=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/report-three-arm.json
markdown=$REPO/ts/.data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/report-three-arm.md
```

## Common final-success comparison

Metrics use only the seven tasks whose terminal execution succeeded in all
three arms. Latency is each task's final successful execution only; failed
attempts are not added. Tokens are summed final-attempt tokens on that same
common cohort.

| Arm           |   N | Recall |           File P/R/F1 |           Line P/R/F1 |  Tokens | Latency mean / p50 / p95 |
| ------------- | --: | -----: | --------------------: | --------------------: | ------: | -----------------------: |
| baseline      |   7 |  0.852 | 0.405 / 0.929 / 0.541 | 0.189 / 0.775 / 0.269 | 176,206 |    25.3s / 24.9s / 32.1s |
| typeagent     |   7 |  0.762 | 0.607 / 0.929 / 0.676 | 0.327 / 0.596 / 0.357 | 150,140 |    28.4s / 27.2s / 36.0s |
| typeagent-lsp |   7 |  0.775 | 0.714 / 0.929 / 0.762 | 0.415 / 0.621 / 0.365 | 134,623 |    27.7s / 27.8s / 34.3s |

Raw report extraction:

```text
Model               Arm            Common N  Recall              File P/R/F1        Line P/R/F1        Final tokens  Latency mean/p50/p95
azure/gpt-5.6-luna  baseline       7         0.8519947291893857  0.405/0.929/0.541  0.189/0.775/0.269  176206        25.3s/24.9s/32.1s
azure/gpt-5.6-luna  typeagent      7         0.7622679988025745  0.607/0.929/0.676  0.327/0.596/0.357  150140        28.4s/27.2s/36s
azure/gpt-5.6-luna  typeagent-lsp  7         0.7749452070904698  0.714/0.929/0.762  0.415/0.621/0.365  134623        27.7s/27.8s/34.3s
```

Relative to baseline, plain TypeAgent used 14.8% fewer tokens but had 12.2%
higher mean and 8.9% higher p50 latency. TypeAgent+LSP used 23.6% fewer tokens
but had 9.4% higher mean and 11.5% higher p50 latency.

## Executions, retries, and failures

```text
Arm            Requested  Executions  Retry executions  Failed executions  Retried tasks  Terminal successes  Terminal failures  Missing
baseline       10         10          0                 0                  0              10                  0                  0
typeagent      10         14          4                 7                  4              7                   3                  0
typeagent-lsp  10         13          3                 6                  3              7                   3                  0
```

The three terminal failures in each TypeAgent arm occurred on the same tasks.
Plain TypeAgent's failed attempts all failed closed on a translated outer
action/request mismatch. TypeAgent+LSP also had fail-closed translation errors
and one terminal repository-call-budget exhaustion. A successful baseline
execution outside the common cohort took 296.6 seconds; it is visible in the
raw stream but correctly does not affect the common-success latency table.

## Architecture and ripgrep integrity

Runtime evidence:

```json
{
  "repositorySearch": {
    "engine": "ripgrep",
    "source": "copilot-packaged",
    "executable": "rg",
    "sha256": "e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863",
    "sharedAcrossArms": true,
    "snapshot": "filtered-immutable-directory"
  },
  "typeagentHarness": {
    "outerTranslation": "natural-language",
    "applicationAgents": ["explorer"],
    "mcp": false
  }
}
```

Aggregate validation over all 14 successful TypeAgent rows:

```json
{
  "successfulRows": 14,
  "allCanonicalOuter": true,
  "allNoMcp": true,
  "allNoCopilotDelegation": true,
  "allInnerFlow": true,
  "allGrepEvidence": true,
  "plainNoLsp": true,
  "lspAllPositive": true
}
```

`allCanonicalOuter` requires one active `explorer` agent/schema, one natural-
language translation and execution, ingress/typed-request identity, and no
Copilot or MCP use. `allInnerFlow` requires completed
`discoverRepository` -> `refineRepository` -> `submitExploration` actions.
Every successful TypeAgent row includes external ripgrep evidence. Plain
TypeAgent made no LSP calls. TypeAgent+LSP made nine successful LSP calls with
nine results across the full ten-task cohort; seven calls/results occurred on
the seven common rows.

Artifact validation:

```text
37 .data/explore-bench/runs/direct-typeagent-luna-r12-canonical-unseen-random10-1/results.jsonl
manifest=valid
runtime=valid
report=valid
```

## Result

The run proves the direct dispatcher/AppAgent/Code Mode architecture and shared
packaged-ripgrep path without MCP or Copilot in either treatment arm. Both
TypeAgent arms improve file and line F1 and use fewer tokens on the fair common
cohort. The stronger full-parity claim is not supported: treatment reliability
is 7/10 versus baseline 10/10, overall recall is lower, and successful mean/p50
latency is higher. No implementation or prompt tuning was performed after this
cohort was frozen or observed.

Non-blocking evidence hardening remains: persisted rows are not
cryptographically bound to the separate runtime-ripgrep SHA file, although the
runner resolves one path once and injects that exact path into all arms.
