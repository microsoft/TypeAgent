# TypeAgent Explore Bench

This package runs a read-only SWE-bench Verified localization benchmark through the real GitHub Copilot CLI, controlled by `@github/copilot-sdk`, and a local LiteLLM gateway. Reports use these presentation labels:

- **Copilot SDK (with explore agent)** (`baseline` internally): Copilot's default main agent must delegate once to the root `.copilot/agents/explorer.md` subagent. Only that subagent receives bounded immutable-snapshot `read`, `grep`, `glob`, and `ls` tools.
- **TypeAgent** (`typeagent`): the raw task enters the canonical TypeAgent dispatcher, whose static grammar constructs exactly one `exploreRepository` action for its sole active Explorer application agent without an outer model request. Explorer then runs its bounded typed-action/Code Mode loop in process.
- **TypeAgent with LSP** (`typeagent-lsp` internally): the same TypeAgent arm also exposes bounded `definition` and `references` navigation through the all-language, pre-provisioned server registry. LSP calls consume the shared eight-call repository budget, and returned locations must still be grounded with `repo.read` before submission. An error-free call counts as successful even when the language server returns no locations; reports show successful calls and returned locations separately.

Legacy `typeagent-mcp` inputs are normalized when reading CLI arguments, manifests, or result JSONL. New manifests and result rows always write `typeagent`.

The Copilot SDK row keeps Copilot's default main agent active and fails unless it completes exactly one synchronous `task` delegation to `explorer`, the subagent uses repository tools, and the main agent performs no direct inspection. The two TypeAgent arms do not start Copilot or MCP: the untouched natural-language task must cross the dispatcher through TypeAgent's static grammar without an outer model request, only Explorer may be active, exactly one outer action must carry that same request as a validated parameter (allowing only TypeAgent's CRLF-to-LF string normalization), and its output must become the final answer. Inside that action, Explorer may use multiple `ls`, `glob`, `grep`, `read`, and—only in the LSP arm—`lsp` operations up to the shared eight-call budget. All three arms use the same immutable filtered repository snapshot and the same repository-search implementation; grep executes the one resolved Copilot-packaged `rg` binary, whose digest is retained in runtime evidence, and TypeAgent also records the engine and executable name in tool telemetry.

This is localization, not SWE-bench pass@1. It does not generate patches, edit repositories, or run tests. It scores cited files and source-side line ranges against the gold patch.

## Build and test

From `ts/`:

```bash
pnpm --filter @typeagent/explore-bench build
pnpm --filter @typeagent/explore-bench test
```

Prepare the pinned Python language server once before an LSP run. The direct
harness resolves this venv executable by absolute path:

```bash
uv sync --project packages/mcp/explore/python-lsp --frozen
```

The TypeScript language server is a pinned runtime dependency of `explorer-typeagent`.

The Copilot SDK and CLI packages are pinned to the same versions as the reference harness rather than using `latest`.

## Run the 30-row matrix

Build the benchmark package, then run the three canonical arms:

```bash
cd ts
corepack pnpm --filter @typeagent/explore-bench build

export CUSTOM_PROVIDER_API_KEY="..."

node packages/exploreBench/dist/src/cli.js run \
  --run-id typeagent-verified-30 \
  --limit 30 \
  --variant baseline \
  --variant typeagent \
  --variant typeagent-lsp
```

The default matrix is [examples/matrix.json](examples/matrix.json):

- `azure/gpt-5.6-luna`
- `azure/gpt-5.6-terra`
- `azure/gpt-5.6-sol`

Thirty tasks × three routes × three variants produces 270 result rows. The selected tasks are deterministic: the loader preserves SWE-bench Verified dataset order while taking one row from each distinct repository before repeating a repository. One 30-row run produces summaries for prefixes 1, 5, 10, and 30.

Use `--task-offset 10 --limit 10` to select tasks 11–20 from that same deterministic order for a held-out check. The offset changes only task selection; both variants still receive the same tasks, repositories, prompts, limits, and scoring.

Use `--task-ids-file /absolute/path/tasks.json` to reproduce an exact retained
cohort from a JSON array of SWE-bench instance IDs. This is mutually exclusive
with `--task-seed` and `--task-offset`; when `--limit` is supplied it must equal
the array length.

Use `--task-seed <seed> --limit 10` for a deterministic random sample without
replacement from all SWE-bench Verified rows. The seed and selected task IDs are
stored in the run manifest. `--task-seed` and `--task-offset` are mutually
exclusive so a run cannot silently mix selection modes.

## Run larger matrices and reuse results

Compatible successful keys are automatically reused from prior runs under the same `.data/explore-bench/runs` directory. Reuse requires the same dataset, model route, variant, agent prompt, provider, harness compatibility revision, limits, and execution settings, plus an exact task/query/SWE-bench identity match. Revision 18 requires the outer TypeAgent action to capture the user request losslessly through TypeAgent's static grammar without an outer model request, three completed inner Explorer actions in order (`discoverRepository`, `refineRepository`, then explicit `submitExploration`), visible grep truncation, read-grounded final citations, recoverable LSP call-budget reservations, error-free LSP calls to count as successful even when they return zero locations, and a neutral search policy shared with the baseline Explorer. Every arm exposes the same filtered immutable-snapshot read/list/search primitives with Copilot's packaged ripgrep; broad searches receive the same actionable 20-second internal deadline before the outer execution deadline, custom shorter execution deadlines derive a still-shorter grep deadline, ripgrep execution provenance remains host-owned outside model-controlled input, and every imported row requires a verified direct-source manifest/runtime artifact. The imported `results.jsonl` rows retain their complete attempt history and a `reusedFrom` record; `cache-provenance.json` summarizes every source. Cache-of-cache rows are not imported, stale same-run task payloads are rejected, and failed or occupied target keys rerun normally.

The first 30 deterministic tasks are an exact prefix of the 100-task selection, so the completed 30-row matrix can supply 180 successful keys (184 raw attempts) to a compatible 100-row run. From the repository root:

```bash
export EXPLORE_BENCH_ENV_FILE="/absolute/path/to/litellm.env"
just bench-100
```

`just bench-100-force` passes `--force-rerun`. Force mode bypasses all result reuse and archives the existing `results.jsonl`, reports, and cache provenance with a timestamp before starting, while retaining dataset, repository, Docker image, and dependency caches.

The default scheduler runs up to three executions independently for each model (nine total for the three-model matrix). All arms share the same per-model pool. Override it with `--max-concurrency <n>`.

SWE-bench Verified has exactly 500 rows. `just bench-1000` therefore exits during dataset loading before any model call. A real 1,000-row run requires an explicit switch to full SWE-bench; results from that dataset must not be labeled as or directly compared with SWE-bench Verified.

## Run exactly one direct TypeAgent row

From `ts/`, after building `@typeagent/explore-bench`, this single command runs the first deterministic SWE-bench task through Luna and the direct TypeAgent arm only. `--max-attempts 1` guarantees exactly one raw JSONL result row even if the execution fails.

```bash
node packages/exploreBench/dist/src/cli.js run --limit 1 --model azure/gpt-5.6-luna --variant typeagent --max-attempts 1 --max-concurrency 1 --litellm-base-url http://127.0.0.1:4627/v1 --api-key-env LITELLM_MASTER_KEY --env-file /absolute/path/to/litellm.env
```

Use `--model azure/gpt-5.6-terra` or `--model azure/gpt-5.6-sol` to select another allowed route. Omit `--variant` for the default paired baseline and direct TypeAgent comparison. `--model` and `--matrix` are mutually exclusive.

## Record every model-server request and response

The trace wrapper records any one canonical arm and routes every model call
through a loopback proxy. For TypeAgent arms, the dispatcher grammar makes no
model request, so the trace contains the inner Explorer calls. From `ts/`, this single command runs
one Luna TypeAgent row and records each HTTP exchange:

```bash
node packages/exploreBench/scripts/run-mcp-with-http-trace.mjs --trace-output "$PWD/.data/explore-bench/luna-typeagent-http.jsonl" --upstream-base-url http://127.0.0.1:4627/v1 --variant typeagent -- --limit 1 --model azure/gpt-5.6-luna --max-attempts 1 --max-concurrency 1 --api-key-env LITELLM_MASTER_KEY --env-file /absolute/path/to/litellm.env
```

Select `--variant baseline`, `--variant typeagent`, or `--variant
typeagent-lsp` before `--`; the default is `typeagent`. The wrapper owns
`--variant`, `--litellm-base-url`, and `--force-rerun`, so do not pass them after
`--`. Forced fresh execution ensures a cache hit cannot produce an empty trace.
The wrapper refuses to overwrite an existing trace. JSONL rows contain
correlated `request` and `response` (or transport `error`) events with exact
bodies in base64 and UTF-8. Credential headers and sensitive URL parameters are
redacted, but prompts and model outputs are not, so treat the trace as
sensitive.

## Harness isolation

Only the baseline starts the packaged native Copilot executable over the SDK's stdio JSON-RPC connection. It records the runtime version and protocol in `copilot-runtime.json`. Each baseline session uses:

- SDK `mode: "empty"` with a run-scoped Copilot home
- config discovery, custom instructions, skills, memory, hooks, embeddings, and infinite sessions disabled
- a source-qualified `task` tool for the baseline main agent
- `defaultAgent.excludedTools` keeps baseline `read`/`grep`/`glob`/`ls` available to `explorer` but hidden from the main agent
- deny-by-default permissions
- fixed absolute baseline command paths with a sanitized child `PATH`
- a trimmed runtime environment that excludes the LiteLLM credential
- per-session working directories fixed to the extracted SWE-bench repository

The harness resolves Copilot in this order: `--copilot`, `COPILOT_CLI_PATH`, the platform package installed with `@github/copilot`, then platform-specific `PATH` and Bun locations. Node/npm shims are rejected.

The LiteLLM credential defaults to `CUSTOM_PROVIDER_API_KEY`. Resolution order is inherited environment, `launchctl getenv`, then an explicit `--env-file` override. Secret values are never written to arguments, manifests, progress logs, or reports. The TypeAgent arms configure the same provider route directly in process.

Copilot's provider is configured per session as OpenAI-compatible with the Responses wire API. The default gateway URL is `http://localhost:4627/v1`; the LiteLLM route remains the wire model.

## Docker and data

SWE-bench rows are cached from the Hugging Face dataset server. For each selected row, the harness:

1. Pulls the standard SWE-bench image only if absent.
2. Creates a new stopped temporary container.
3. Copies `/testbed` into the local cache.
4. Removes only that temporary container.

It does not stop, restart, or reconfigure existing containers.

### Periodically clean processed task images

The cleanup command is dry-run by default. A task becomes eligible only after
every requested model and variant has a terminal result (success or exhausted
final attempt), every result names the exact task image, and the extracted local
repository has matching provenance. It checks all running and stopped
containers before removing one exact image reference without force. It never
uses Docker prune, mutates containers, removes volumes, or deletes extracted
repository caches.

```bash
# Preview currently eligible images once.
just bench-cleanup-images

# Remove currently eligible images once.
just bench-cleanup-images-apply

# Apply every five minutes until all 500 tasks have terminal results.
just bench-cleanup-images-periodic-apply
```

The retained repository cache is sufficient for result retries. If that cache
later fails provenance validation, the benchmark simply pulls the exact image
again.

Default data layout:

```text
.data/explore-bench/
  swebench/datasets/verified-test.rows.json
  swebench/repos/verified/<instance_id>/
  runs/<run-id>/manifest.json
  runs/<run-id>/results.jsonl
  runs/<run-id>/telemetry/*.json
  runs/<run-id>/report.json
  runs/<run-id>/report.md
```

`results.jsonl` is the raw source of truth. Baseline rows record RPC proof that no custom main agent was selected plus correlated `task`, `subagent.started`, child repository-tool, `subagent.completed`, and root task-completion events. TypeAgent rows record the untouched submitted request, active application agent/schema, grammar-constructed action, executed output, zero dispatcher model usage, inner Explorer usage, combined usage, and schema-v4 repository-tool/action telemetry. Missing or repeated grammar dispatch/execution, Copilot/MCP evidence in a TypeAgent arm, malformed answers, inconsistent usage, invalid ripgrep evidence, wrong-mode LSP activity, failed telemetry, or model mismatch makes the row retryable.

Regenerate reports with:

```bash
node dist/src/cli.js report \
  --input .data/explore-bench/runs/typeagent-verified-10/results.jsonl
```

Both report formats include the raw per-variant leaderboard and an explicit `typeagent − baseline` delta table for every available 1/5/10/20/30/50/100/500/1000 prefix. Token columns report absolute dispatcher, inner Explorer, and combined counts; no token-saving percentage is substituted for token usage. Paired token deltas compare TypeAgent combined tokens against baseline Copilot tokens, which already include both the main and explorer subagent calls. Totals are input plus output without double-counting cache or reasoning subsets.

The three-arm report shows latency as mean/p50/p95 over the same successful
task intersection. Each task contributes its final successful execution only;
failed retries are excluded. Token columns are also final-attempt totals.
