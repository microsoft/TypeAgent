# Direct TypeAgent Explorer random-10 verification

Date: 2026-07-24 (America/Los_Angeles)

## Goal and final resource

Verify the built `typeagent-explore-bench` CLI with three canonical arms:

1. Copilot SDK with the Explorer subagent (`baseline`).
2. Raw prompt through the TypeAgent dispatcher to the sole Explorer AppAgent
   and its inner Code Mode loop (`typeagent`).
3. The identical direct TypeAgent path with language-server navigation
   (`typeagent-lsp`).

The verification requires external ripgrep for every TypeAgent `repo.grep`, no
Copilot or MCP execution in either TypeAgent arm, lower TypeAgent token usage,
and a post-change seeded random-10 SWE-bench Verified comparison.

## Environment

```text
branch=domnguyen/typeagent-explorer-lsp
pre-verification-tip=f1dfd8946cf536bd395ac8251f0d2b0a081e1996
model=azure/gpt-5.6-luna
max_concurrency=1
max_attempts=2
timeout_ms=360000
dataset=princeton-nlp/SWE-bench_Verified
```

The CLI read `LOCAL_LITELLM_API_KEY` from the inherited environment and used
the configured `LITELLM_BASE_URL`. No credential value was printed or placed in
an argument.

## Frozen cohort

The seed was selected and the IDs were recorded before execution. The cohort
has zero overlap with the retained r5 random-10, final smoke, and Django trace
cohorts.

“Fresh” means these rows were newly executed after the direct-ripgrep change;
the run imported no cached results. It does not mean the task IDs were unseen:
all ten appeared in the historical 500-task matrix, and three appeared in the
retained 100-task run. No implementation or prompt was tuned against this
frozen cohort.

```text
seed=direct-typeagent-r6-post-rg-random10-20260724
matplotlib__matplotlib-26113
matplotlib__matplotlib-23412
matplotlib__matplotlib-20859
django__django-14787
sympy__sympy-12489
sphinx-doc__sphinx-8120
django__django-10914
django__django-12858
pydata__xarray-4687
django__django-16595
overlapWithR5Random10FinalSmokeAndTrace=[]
```

## Commands

From `ts/`:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-random10-r6-direct-rg-v1 \
  --limit 10 \
  --task-seed direct-typeagent-r6-post-rg-random10-20260724 \
  --model azure/gpt-5.6-luna \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp \
  --max-attempts 2 \
  --max-concurrency 1 \
  --timeout-ms 360000 \
  --litellm-base-url "$LITELLM_BASE_URL" \
  --api-key-env LOCAL_LITELLM_API_KEY

node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input .data/explore-bench/runs/direct-typeagent-luna-random10-r6-direct-rg-v1/results.jsonl \
  --lsp-input .data/explore-bench/runs/direct-typeagent-luna-random10-r6-direct-rg-v1/results.jsonl
```

## Raw architecture and ripgrep proof

```text
packages/agents/explorer/src/script/repositoryApi.ts:459:                        engine: "ripgrep",
packages/agents/explorer/src/script/repositoryApi.ts:1045:        const child = spawn(ripgrepPath, args, {
packages/exploreBench/src/typeAgent.ts:37:import { readExploreTelemetry } from "./exploreTelemetry.js";
packages/exploreBench/src/typeAgent.ts:110:export async function runTypeAgentDispatcher(
packages/exploreBench/src/runner.ts:204:                        ? await runTypeAgentDispatcher({
packages/exploreBench/src/runner.ts:216:                        : await runCopilot(client!, {
packages/exploreBench/src/copilot.ts:211:        throw new Error("Copilot runner supports only the baseline arm");
```

The direct TypeAgent module no longer imports the Copilot module. Ripgrep
receives only paths from the prefiltered repository snapshot, and each emitted
line is checked against the snapshot before becoming observable.

On the retained 6,218-file Django checkout, the identical first TypeAgent grep
fell from about 9.7 seconds through a copied temp tree to 0.9 seconds against
the prepared checkout's allowlisted paths.

A post-run robustness review added a smaller Windows-only argument batch and
retained validated partial results when another indexed path disappears. The
POSIX batch size used by this macOS run is unchanged, and no benchmark checkout
mutated during execution, so these safeguards do not alter the frozen results.

## Raw package gates

```text
Explorer:
Test Suites: 5 passed, 5 total
Tests:       67 passed, 67 total

Dispatcher:
Test Suites: 61 passed, 61 total
Tests:       992 passed, 992 total

ExploreBench:
tests 120
pass 120
fail 0
```

## Random-10 result

Quality, tokens, and latency use the successful three-way intersection of all
ten tasks. Latency counts one final successful execution per task and excludes
failed retry time.

| Arm                    | Completed | Recall |       File P/R/F1 |       Line P/R/F1 |  Tokens | Latency mean/p50/p95 |
| ---------------------- | --------: | -----: | ----------------: | ----------------: | ------: | -------------------: |
| Copilot SDK + Explorer |     10/10 |  0.782 | 0.437/1.000/0.600 | 0.155/0.563/0.210 | 291,403 |    17.8s/17.9s/23.4s |
| TypeAgent              |     10/10 |  0.819 | 0.667/1.000/0.767 | 0.260/0.638/0.295 | 208,331 |    17.4s/16.8s/24.3s |
| TypeAgent + LSP        |     10/10 |  0.855 | 0.767/1.000/0.833 | 0.246/0.711/0.336 | 182,473 |    18.3s/14.2s/54.0s |

All quality and token criteria pass. Plain TypeAgent also beats baseline mean
and p50 latency. TypeAgent + LSP beats baseline p50 but misses mean latency by
0.5 seconds because one successful row took 54.0 seconds while its repository
tools took only 1.1 seconds. That execution remains included.

```text
task                                  baseline  typeagent  typeagent-lsp  TA tools  LSP tools
matplotlib__matplotlib-26113             15.1s      20.1s          19.4s      3.4s       1.2s
matplotlib__matplotlib-23412             22.5s      15.5s          54.0s      3.9s       1.1s
matplotlib__matplotlib-20859             17.9s      14.5s          13.4s      3.6s       1.2s
django__django-14787                     23.4s      14.3s          15.9s      1.1s       1.1s
sympy__sympy-12489                       18.0s      20.6s          11.6s      0.5s       1.0s
sphinx-doc__sphinx-8120                  13.2s      12.5s          13.3s      1.1s       1.4s
django__django-10914                     21.3s      15.4s          15.0s      2.5s       2.7s
django__django-12858                     15.1s      18.6s          14.3s      1.6s       2.3s
pydata__xarray-4687                      13.2s      18.1s          14.2s      0.6s       0.5s
django__django-16595                     17.8s      24.3s          12.5s      8.8s       1.2s
```

Final successful rows made 55 baseline requests, 41 TypeAgent requests, and 40
TypeAgent + LSP requests. The TypeAgent arms recorded 35 and 30 ripgrep calls,
respectively. Every final successful LSP row contained one error-free call: ten
calls returned eight locations.

Two failed attempts remain in the raw JSONL and are excluded only from the
final-execution latency aggregates:

```text
sympy__sympy-12489 typeagent attempt=1 125.927s Responses request timed out
sphinx-doc__sphinx-8120 typeagent-lsp attempt=1 10.141s refinement did not complete required LSP navigation
```

## Artifacts

- `.data/explore-bench/runs/direct-typeagent-luna-random10-r6-direct-rg-v1/results.jsonl`
- `.data/explore-bench/runs/direct-typeagent-luna-random10-r6-direct-rg-v1/report-three-arm.md`
- `.data/explore-bench/runs/direct-typeagent-luna-random10-r6-direct-rg-v1/report-three-arm.json`
- `.data/explore-bench/runs/direct-typeagent-luna-random10-r6-direct-rg-v1/telemetry/`
- `.data/explore-bench/request-traces/direct-rg-smoke-django-12308-v1/`
- `.data/explore-bench/request-traces/direct-rg-smoke-django-12308-v3/`

The telemetry directory contains the direct TypeAgent invocation files.
Baseline Copilot SDK session events and tool traces are embedded in
`results.jsonl`; the baseline rows do not have separate telemetry JSON files.

## Result

PASS for architecture, ripgrep parity, token use, and all quality metrics.
PASS for plain TypeAgent mean and median latency. PARTIAL for TypeAgent + LSP
latency: median passes; mean misses baseline by 0.5 seconds due one retained
successful provider-tail execution.
