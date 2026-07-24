# Direct TypeAgent Explorer Luna smoke

## Goal

Verify one SWE-bench Verified task through the three canonical arms:

- Copilot SDK with the Explorer subagent (`baseline`)
- Direct TypeAgent dispatcher with one Explorer AppAgent (`typeagent`)
- The same direct TypeAgent path with LSP (`typeagent-lsp`)

The proof must show direct natural-language dispatch, no Copilot or MCP inside
the TypeAgent arms, ripgrep-backed grep, mode-correct LSP isolation, one
discovery/refinement/submission flow, exact token aggregation, and parseable
benchmark output.

## Final Resource

The built benchmark CLI:

`node packages/exploreBench/dist/src/cli.js run`

## Artifact Level

Level 1 (markdown). No slideshow or video was requested.

## Environment

```text
timestamp_utc=2026-07-24T05:05:59Z
branch=domnguyen/typeagent-explorer-lsp
base_commit=1d0262140fcbb7dd628670a984c7365e98507bd7
node=v24.14.1
pnpm=10.34.4
task=sympy__sympy-13551
model=azure/gpt-5.6-luna
max_attempts=1
max_concurrency=1
```

The worktree contained the implementation under verification, so the base
commit identifies the branch point rather than claiming a clean committed
artifact.

## Commands Or Requests

From `ts/`, the fresh three-arm execution was:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-smoke-1-v4 \
  --limit 1 \
  --task-ids-file "$PWD/.data/explore-bench/cohorts/typeagent-direct-smoke-1.json" \
  --model azure/gpt-5.6-luna \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp \
  --max-attempts 1 \
  --max-concurrency 1 \
  --force-rerun \
  --litellm-base-url http://127.0.0.1:4627/v1 \
  --api-key-env LITELLM_MASTER_KEY \
  --env-file <local-litellm-env-file>
```

The plain TypeAgent execution timed out before dispatch. It remained recorded
as a failed execution. The identical single arm was then executed once more,
still with one harness attempt:

```bash
node packages/exploreBench/dist/src/cli.js run \
  --run-id direct-typeagent-luna-smoke-1-v4-typeagent-retry-1 \
  --limit 1 \
  --task-ids-file "$PWD/.data/explore-bench/cohorts/typeagent-direct-smoke-1.json" \
  --model azure/gpt-5.6-luna \
  --variant typeagent \
  --max-attempts 1 \
  --max-concurrency 1 \
  --force-rerun \
  --litellm-base-url http://127.0.0.1:4627/v1 \
  --api-key-env LITELLM_MASTER_KEY \
  --env-file <local-litellm-env-file>
```

## Sanitized Auth Source

The CLI read `LITELLM_MASTER_KEY` from the explicit local env file. No secret
value was printed, persisted in a CLI argument, or copied into this evidence.

## Qualifying Proof Artifacts

Fresh three-arm CLI output:

```text
warning: limits below 30 cannot produce all 1/5/10/30 prefix summaries
cache	force-rerun	archived=0
runId=direct-typeagent-luna-smoke-1-v4
tasks=1 models=1 variants=3 rows=3
output=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4/results.jsonl
start	sympy__sympy-13551	azure/gpt-5.6-luna	baseline	attempt=1/1
ok	sympy__sympy-13551	azure/gpt-5.6-luna	baseline	13500ms	direct=0	subagent=1/1	mainInspect=false
start	sympy__sympy-13551	azure/gpt-5.6-luna	typeagent	attempt=1/1
fail	sympy__sympy-13551	azure/gpt-5.6-luna	typeagent	122268ms	direct=0	subagent=0/0	mainInspect=false
start	sympy__sympy-13551	azure/gpt-5.6-luna	typeagent-lsp	attempt=1/1
ok	sympy__sympy-13551	azure/gpt-5.6-luna	typeagent-lsp	26949ms	direct=1	subagent=0/0	mainInspect=false
runId=direct-typeagent-luna-smoke-1-v4
results=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4/results.jsonl
report=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4/report.json
markdown=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4/report.md
```

Plain TypeAgent replacement execution:

```text
warning: limits below 30 cannot produce all 1/5/10/30 prefix summaries
cache	force-rerun	archived=0
runId=direct-typeagent-luna-smoke-1-v4-typeagent-retry-1
tasks=1 models=1 variants=1 rows=1
output=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4-typeagent-retry-1/results.jsonl
start	sympy__sympy-13551	azure/gpt-5.6-luna	typeagent	attempt=1/1
ok	sympy__sympy-13551	azure/gpt-5.6-luna	typeagent	12673ms	direct=1	subagent=0/0	mainInspect=false
runId=direct-typeagent-luna-smoke-1-v4-typeagent-retry-1
results=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4-typeagent-retry-1/results.jsonl
report=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4-typeagent-retry-1/report.json
markdown=<workspace>/ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4-typeagent-retry-1/report.md
```

The built integrity validator accepted both result files. A separate assertion
probe then checked identical task/model/query identity; exact raw ingress; one
Explorer schema, translated action, and execution; no Copilot/MCP/subagent
evidence in TypeAgent arms; ripgrep evidence on every grep; strict action
sequence; exact dispatcher-plus-Explorer token sums; and LSP isolation:

```json
{
  "status": "PASS",
  "taskId": "sympy__sympy-13551",
  "model": "azure/gpt-5.6-luna",
  "successfulExecutions": {
    "baseline": {
      "durationMs": 13500,
      "file": {
        "score": 0.4555555555555556,
        "precision": 0.5,
        "recall": 1,
        "f1": 0.6666666666666666,
        "nCitation": 2,
        "nPatch": 1
      },
      "line": {
        "score": -0.04722222222222222,
        "precision": 0.23529411764705882,
        "recall": 1,
        "f1": 0.38095238095238093,
        "nCitation": 34,
        "nPatch": 8
      },
      "tokens": 32912,
      "modelRequests": 6,
      "toolCalls": 9,
      "lspCalls": 0
    },
    "typeagent": {
      "durationMs": 12673,
      "file": {
        "score": 0.4555555555555556,
        "precision": 0.5,
        "recall": 1,
        "f1": 0.6666666666666666,
        "nCitation": 2,
        "nPatch": 1
      },
      "line": {
        "score": -0.48750000000000004,
        "precision": 0,
        "recall": 0,
        "f1": 0,
        "nCitation": 47,
        "nPatch": 8
      },
      "tokens": 25043,
      "dispatcherTokens": 909,
      "explorerTokens": 24134,
      "modelRequests": 4,
      "toolCalls": 8,
      "lspCalls": 0
    },
    "typeagentLsp": {
      "durationMs": 26949,
      "file": {
        "score": 1,
        "precision": 1,
        "recall": 1,
        "f1": 1,
        "nCitation": 1,
        "nPatch": 1
      },
      "line": {
        "score": -0.39642857142857146,
        "precision": 0.14814814814814814,
        "recall": 1,
        "f1": 0.25806451612903225,
        "nCitation": 54,
        "nPatch": 8
      },
      "tokens": 21140,
      "dispatcherTokens": 957,
      "explorerTokens": 20183,
      "modelRequests": 4,
      "toolCalls": 8,
      "lspCalls": 2
    }
  },
  "excludedFailure": {
    "variant": "typeagent",
    "durationMs": 122268,
    "error": "Responses request timed out"
  }
}
```

Supporting implementation verification:

```text
Explorer repository API: 16 passed, 0 failed
ExploreBench package: 123 passed, 0 failed
```

Raw sources of truth:

- `ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4/results.jsonl`
- `ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4/telemetry/`
- `ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4-typeagent-retry-1/results.jsonl`
- `ts/.data/explore-bench/runs/direct-typeagent-luna-smoke-1-v4-typeagent-retry-1/telemetry/`

## Watchable Artifact Behavior Gate

N/A — Level 1 only.

## Result

PASS. Each canonical arm produced one successful, parseable localization for
the same Luna task. The direct TypeAgent paths crossed the canonical dispatcher
and one Explorer AppAgent without Copilot or MCP. Their grep calls used
ripgrep. Only the LSP arm completed LSP calls. Dispatcher and inner Explorer
tokens were retained separately and summed exactly once.

The successful-execution latency values are 13.500 s for baseline, 12.673 s for
TypeAgent, and 26.949 s for TypeAgent with LSP. The failed 122.268 s provider
timeout is reported separately and is not included as successful latency.

## Gaps

This is a one-task smoke, not a quality or performance conclusion. The retained
100-task Luna cohort and the separate seeded 10-random-task generalization run
remain required before making aggregate claims.
