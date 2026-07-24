# Direct TypeAgent Explorer random-10 verification

## Goal

Verify the final three benchmark arms on a fresh seeded SWE-bench Verified
cohort after the direct-dispatch, ripgrep, and repairable LSP-refinement changes:

- Copilot SDK with the Explorer subagent (`baseline`)
- TypeAgent dispatcher with one Explorer AppAgent (`typeagent`)
- The same TypeAgent path with language-server navigation (`typeagent-lsp`)

## Artifact Level

Level 1 (markdown). The raw benchmark artifacts remain under the ignored local
benchmark data directory.

## Environment

```text
timestamp_utc=2026-07-24T06:58:45.727Z
base_commit=1d0262140fcbb7dd628670a984c7365e98507bd7
cache_compatibility_revision=5
tasks=10
variants=3
max_attempts=2
max_concurrency=3
```

The implementation under verification was present in the working tree, so the
base commit is recorded only as the branch point.

## Pre-registered cohort

Seed: `direct-typeagent-r5-generalization-1-20260723`

The selected task IDs were checked before execution and were disjoint from the
previous seeded random-10 cohort and the final smoke task:

```text
psf__requests-1142
django__django-16100
sphinx-doc__sphinx-9673
sphinx-doc__sphinx-7590
django__django-15572
sympy__sympy-17139
django__django-15467
pytest-dev__pytest-5787
django__django-14500
django__django-11880
```

## Reproduction

From `ts/`:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-random10-r5-lsp-repair-rg-v1 \
  --limit 10 \
  --task-seed direct-typeagent-r5-generalization-1-20260723 \
  --model azure/gpt-5.6-luna \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp \
  --max-attempts 2 \
  --max-concurrency 3 \
  --timeout-ms 360000 \
  --litellm-base-url http://127.0.0.1:4627/v1 \
  --api-key-env LITELLM_MASTER_KEY \
  --env-file <local-litellm-env-file>

node packages/exploreBench/dist/src/cli.js report-three-arm \
  --paired-input .data/explore-bench/runs/direct-typeagent-luna-random10-r5-lsp-repair-rg-v1/results.jsonl \
  --lsp-input .data/explore-bench/runs/direct-typeagent-luna-random10-r5-lsp-repair-rg-v1/results.jsonl
```

The CLI read the credential from the explicit local env file. No secret value
was printed or persisted in the command, manifest, report, or this evidence.

## Results

Quality, token, and latency values use the successful three-way intersection,
which contained all ten tasks. Latency counts one final successful execution
per task and excludes failed retries.

| Arm                    | Completed | Recall |       File P/R/F1 |       Line P/R/F1 |  Tokens | Latency mean/p50/p95 |
| ---------------------- | --------: | -----: | ----------------: | ----------------: | ------: | -------------------: |
| Copilot SDK + Explorer |     10/10 |  0.880 | 0.517/0.967/0.647 | 0.335/0.793/0.410 | 327,144 |    16.3s/16.5s/20.8s |
| TypeAgent              |     10/10 |  0.721 | 0.625/0.867/0.687 | 0.195/0.576/0.263 | 187,875 |    24.0s/25.1s/35.4s |
| TypeAgent + LSP        |     10/10 |  0.832 | 0.750/0.933/0.783 | 0.285/0.730/0.350 | 167,863 |    23.2s/24.1s/34.4s |

LSP was adopted in 10/10 final LSP rows, with 12 successful calls and eight
returned locations. Two earlier LSP executions hit the provider response
timeout; both raw failure rows remain in `results.jsonl`, and both task cells
completed on their predeclared second attempt.

## Integrity proof

The built fail-closed validator accepted all 32 execution rows against the run
manifest. A separate bounded audit then verified:

```json
{
  "requestedTasks": 10,
  "resultRows": 32,
  "finalCompletion": {
    "baseline": 10,
    "typeagent": 10,
    "typeagent-lsp": 10
  },
  "failedExecutions": {
    "baseline": 0,
    "typeagent": 0,
    "typeagent-lsp": 2
  },
  "successfulDirectTypeAgentRows": 20,
  "ripgrepCalls": 72,
  "invalidRipgrepCalls": 0,
  "tokenMismatches": 0,
  "lspIsolationFailures": 0
}
```

Every successful direct TypeAgent row retained exact natural-language ingress,
one parameterless translated Explorer action, one AppAgent execution, and no
Copilot or MCP use. Dispatcher and inner Explorer usage were retained
separately and summed exactly once. Every TypeAgent grep trace recorded
`engine: "ripgrep"` and `ripgrepPath: "rg"`.

## Package gates

```text
dispatcher: 61 suites, 992 tests passed
Explorer: 5 suites, 65 tests passed
ExploreBench: 126 tests passed
formatting: passed for all changed hand-authored files
```

## Raw sources of truth

- `ts/.data/explore-bench/runs/direct-typeagent-luna-random10-r5-lsp-repair-rg-v1/results.jsonl`
- `ts/.data/explore-bench/runs/direct-typeagent-luna-random10-r5-lsp-repair-rg-v1/report-three-arm.md`
- `ts/.data/explore-bench/runs/direct-typeagent-luna-random10-r5-lsp-repair-rg-v1/report-three-arm.json`
- `ts/.data/explore-bench/runs/direct-typeagent-luna-random10-r5-lsp-repair-rg-v1/telemetry/`

## Result

PASS. All three arms completed the fresh disjoint cohort. The TypeAgent arms
used the canonical dispatcher and one Explorer AppAgent without Copilot or MCP,
used ripgrep for every grep, preserved exact token accounting, and isolated LSP
to the LSP arm. The LSP refinement state remained repairable after failed
navigation instead of entering an impossible submission-only loop.

## Gaps

This ten-task cohort supports a post-change generalization check, not a broad
performance claim. All gold patches were Python, so TypeScript LSP benchmark
coverage remains zero in this cohort.
