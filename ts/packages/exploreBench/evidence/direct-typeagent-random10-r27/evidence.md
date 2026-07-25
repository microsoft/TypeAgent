# Direct TypeAgent Explorer revision-27 evidence

## Goal and frozen implementation

Compare one provider route across:

1. Copilot SDK with its Explorer subagent (`baseline`).
2. Raw TypeAgent grammar dispatch to the sole Explorer AppAgent, whose bounded
   reasoning loop emits Code Mode programs (`typeagent`).
3. The same TypeAgent path with language-server navigation
   (`typeagent-lsp`).

Revision 27 removes the treatment-only rule that required every advisory
refinement candidate to be retained in full or explicitly excluded. The final
typed action may narrow or omit candidates, but every submitted line must still
be wholly covered by a successful host-observed read. The prompt also states
that a whole `repo.read` location is an evidence window, not automatically the
final change-bearing block.

No task IDs, repositories, gold patches, or expected locations are encoded in
the implementation or prompt.

## Ripgrep and harness parity

The runner resolves one executable from Copilot's platform package, hashes it,
and injects the exact path into all three arms. TypeAgent `repo.grep` reaches
`spawn(ripgrepPath, ...)`; no JavaScript search or system-`grep` fallback is
reachable. Missing ripgrep fails closed.

```text
engine=ripgrep
source=copilot-packaged
executable=rg
ripgrepSha256=e87c40f1044faa43588be9b8320dddd6a1437639c54eb6110df33bce81711863
sharedAcrossArms=true
snapshot=filtered-immutable-directory
```

Across the 19 successful TypeAgent rows, all 19 have host-owned successful
ripgrep execution evidence. All have zero dispatcher model requests/tokens,
one grammar-dispatched outer action, one active Explorer agent/schema, exact
ingress identity, and no Copilot or MCP use. Plain TypeAgent has zero LSP calls;
all 9 successful LSP rows have an error-free LSP call.

## Local gates and freeze

The final source and compiled runtime trees were hashed in sorted path order,
including the dispatcher reasoning adapter:

```text
sourceFiles=56
sourceDigest=f913e3ed19f2fe7eb2a3dfff97a45f49d637db4ccb44701f768573d67d862fa4
builtFiles=160
builtDigest=ec12795c8ad386539469da515aa61ab972571b1c16bb4112ad285e156049b3bb
```

Pre-cohort gates:

```text
Agent Flows: 77/77
Dispatcher: 992/992
Explorer: 101/101
ExploreBench: 143/143
Explorer, Dispatcher, and scoped ExploreBench formatting: passed
git diff --check: passed
```

The full ExploreBench formatting command also sees an unrelated untracked
generated HTML file with pre-existing formatting differences. It was not
rewritten; the tracked README/source/test scope passes.

Two frozen revision-27 smoke sets produced four TypeAgent successes in four
executions. Baseline exhausted both attempts in each set through honest strict
query-preservation or read-grounding failures. A prior revision-26 smoke under
the same baseline source/build path did complete baseline successfully. After
three repeated smoke sets showed the same understood stochastic baseline
failure mode, no validation was weakened and the retry loop stopped.

## Unseen cohort selection

Selection occurred only after the final source/build freeze. Two independent
calculations accessed only dataset instance IDs, prior manifest/result task
IDs, retained cohort ID arrays, and their file paths. They did not inspect
prompts, patches, repositories, difficulty, scores, or traces.

```text
seed=direct-typeagent-r27-final-random10-20260724
normalizedSeed=1415509232
method=FNV-1a normalization + Mulberry32/Fisher-Yates
datasetRows=500
manifestFiles=158
resultFiles=157
priorCohortFiles=13
excludedUniqueIds=354
eligibleIds=146
selectedUnique=10
overlap=[]
selectionInventorySha256=b5254de200daa4c8e20958bdbc9ee2c35feaf5654710265a0b381743b550bf20
```

The frozen IDs are in [cohort.json](./cohort.json).

## Real random-10 run

The cohort ran once, serialized at model concurrency one:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-r27-parity-random10-1 \
  --limit 10 \
  --task-ids-file packages/exploreBench/evidence/direct-typeagent-random10-r27/cohort.json \
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

Raw artifact hashes:

```text
results.jsonl lines=39
resultsSha256=49c4a29c9802b368557cd8ceac93e790271a8b88be1e3bd4289e6672d8d0f9ee
runtimeEvidenceSha256=f9afbbd7c6d62183215aeaa72bb775c9cbdd048100e9c98869cc742a8a7aff30
```

## Common final-success metrics

Quality, tokens, and latency use the same five-task three-way final-success
intersection. Tokens and latency include one final successful execution per
task; failed attempts are excluded. Completion and raw execution counts cover
all ten requested tasks.

| Arm                    | Completed | Recall |       File P/R/F1 |       Line P/R/F1 |  Tokens |      Mean/P50/P95 |
| ---------------------- | --------: | -----: | ----------------: | ----------------: | ------: | ----------------: |
| Copilot SDK + Explorer |      6/10 |  0.745 | 0.700/0.900/0.767 | 0.480/0.591/0.451 | 132,507 | 43.0s/36.9s/67.8s |
| TypeAgent              |     10/10 |  0.534 | 0.600/0.700/0.600 | 0.438/0.369/0.305 |  83,710 | 26.6s/25.5s/35.4s |
| TypeAgent + LSP        |      9/10 |  0.550 | 0.700/0.700/0.667 | 0.463/0.400/0.410 | 117,561 | 30.4s/26.4s/53.2s |

Raw executions and retries:

| Arm                    | Executions | Final successes | Failed executions | Failed-attempt time |
| ---------------------- | ---------: | --------------: | ----------------: | ------------------: |
| Copilot SDK + Explorer |         16 |               6 |                10 |            338.906s |
| TypeAgent              |         11 |              10 |                 1 |              4.113s |
| TypeAgent + LSP        |         12 |               9 |                 3 |            235.527s |

LSP was adopted on 9/10 requested tasks, with 9 successful calls and 7
returned locations. The missing task exhausted both attempts because the
refinement did not leave enough call budget to read exact candidate context.

## Outcome

The direct TypeAgent harness goal and shared-ripgrep requirement are proven.
Both TypeAgent arms beat baseline token use, mean latency, and p50 latency on
the common task set. The quality-parity goal is not met: plain TypeAgent trails
baseline by 0.211 recall, 0.167 file F1, and 0.146 line F1; LSP trails by 0.195,
0.100, and 0.041 respectively. No post-cohort source or prompt tuning was done.

The generated report is
`ts/.data/explore-bench/runs/direct-typeagent-luna-r27-parity-random10-1/report-three-arm.md`.
