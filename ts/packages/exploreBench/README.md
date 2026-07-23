# TypeAgent Explore Bench

This package runs a read-only SWE-bench Verified localization benchmark through the real GitHub Copilot CLI, controlled by `@github/copilot-sdk`, and a local LiteLLM gateway. Reports use these presentation labels:

- **Copilot SDK (with explore agent)** (`baseline` internally): Copilot's default main agent must delegate once to the root `.copilot/agents/explorer.md` subagent. Only that subagent receives bounded custom `read`, `grep`, `glob`, and read-only `bash` tools.
- **TypeAgent** (`typeagent`): Copilot's default main agent receives only the native stdio `explore` tool, which runs TypeAgent Code Mode.
- **TypeAgent with LSP** (`typeagent-lsp` internally): the same TypeAgent arm also exposes bounded `definition` and `references` navigation through the all-language, pre-provisioned server registry. LSP calls consume the shared eight-call repository budget, and returned locations must still be grounded with `repo.read` before submission.

Legacy `typeagent-mcp` inputs are normalized when reading CLI arguments, manifests, or result JSONL. New manifests and result rows always write `typeagent`.

All arms keep Copilot's default main agent active and explicitly prompt it to use the required path. A Copilot SDK row fails unless its first action attempts one synchronous `task` delegation to `explorer`, exactly one subagent completes successfully after using repository tools, and the main agent performs no direct inspection. A TypeAgent row fails unless its first action attempts `explore`, exactly one outer invocation succeeds, no subagent or other repository tool starts, and matching TypeAgent telemetry is valid. Failed schema-validation attempts are retained in token usage but do not count as successful executions. Inside the successful TypeAgent call, Code Mode may use multiple `ls`, `glob`, `grep`, `read`, and—only in the LSP arm—`lsp` operations up to the shared eight-call budget.

This is localization, not SWE-bench pass@1. It does not generate patches, edit repositories, or run tests. It scores cited files and source-side line ranges against the gold patch.

## Build and test

From `ts/`:

```bash
pnpm --filter @typeagent/explore-bench build
pnpm --filter @typeagent/explore-bench test
```

Prepare the pinned Python language server once before an LSP run:

```bash
uv sync --project packages/mcp/explore/python-lsp --frozen
```

The TypeScript language server is a pinned runtime dependency of `explorer-typeagent`.

The Copilot SDK and CLI packages are pinned to the same versions as the reference harness rather than using `latest`.

## Run the 30-row matrix

Build the TypeAgent MCP server first, then pass its stdio command and arguments. For example:

```bash
cd ts
corepack pnpm --filter typeagent-explore-mcp build
corepack pnpm --filter @typeagent/explore-bench build

export CUSTOM_PROVIDER_API_KEY="..."

node packages/exploreBench/dist/src/cli.js run \
  --run-id typeagent-verified-30 \
  --limit 30 \
  --mcp-command node \
  --mcp-arg="$PWD/packages/mcp/explore/dist/server.js" \
  --mcp-cwd="$PWD"
```

For every Copilot treatment session, the harness appends the selected checkout, matrix model, LiteLLM URL, API-key environment variable name, the shared eight-call budget, and a unique telemetry path to the MCP command as `--repo`, `--model`, `--base-url`, `--api-key-env`, `--max-tool-calls`, and `--telemetry-file`. Do not put those dynamic flags in `--mcp-arg`.

The default matrix is [examples/matrix.json](examples/matrix.json):

- `azure/gpt-5.6-luna`
- `azure/gpt-5.6-terra`
- `azure/gpt-5.6-sol`

Thirty tasks × three routes × two variants produces 180 result rows. The selected tasks are deterministic: the loader preserves SWE-bench Verified dataset order while taking one row from each distinct repository before repeating a repository. One 30-row run produces paired summaries for prefixes 1, 5, 10, and 30.

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

Compatible successful keys are automatically reused from prior runs under the same `.data/explore-bench/runs` directory. Reuse requires the same dataset, model route, variant, agent prompt, provider, MCP configuration, Copilot runtime, limits, and execution settings, plus an exact task/query/SWE-bench identity match. The imported `results.jsonl` rows retain their complete attempt history and a `reusedFrom` record; `cache-provenance.json` summarizes every source. Failed keys and target keys that already have an attempt rerun normally.

The first 30 deterministic tasks are an exact prefix of the 100-task selection, so the completed 30-row matrix can supply 180 successful keys (184 raw attempts) to a compatible 100-row run. From the repository root:

```bash
export EXPLORE_BENCH_ENV_FILE="$HOME/Documents/mygithub.com/ai-agents-setup/.agents/.env.litellm"
just bench-100
```

`just bench-100-force` passes `--force-rerun`. Force mode bypasses all result reuse and archives the existing `results.jsonl`, reports, and cache provenance with a timestamp before starting, while retaining dataset, repository, Docker image, and dependency caches.

The default scheduler runs up to three sessions independently for each model (nine total for the three-model matrix). Baseline and TypeAgent MCP work share the same per-model pool. Override it with `--max-concurrency <n>`.

SWE-bench Verified has exactly 500 rows. `just bench-1000` therefore exits during dataset loading before any model call. A real 1,000-row run requires an explicit switch to full SWE-bench; results from that dataset must not be labeled as or directly compared with SWE-bench Verified.

## Run exactly one TypeAgent MCP row

From `ts/`, after building `typeagent-explore-mcp` and `@typeagent/explore-bench`, this single command runs the first deterministic SWE-bench task through Luna and the TypeAgent MCP arm only. `--max-attempts 1` guarantees exactly one raw JSONL result row even if the session fails.

```bash
node packages/exploreBench/dist/src/cli.js run --limit 1 --model azure/gpt-5.6-luna --variant typeagent --max-attempts 1 --max-concurrency 1 --litellm-base-url http://127.0.0.1:4627/v1 --api-key-env LITELLM_MASTER_KEY --env-file "$HOME/Documents/mygithub.com/ai-agents-setup/.agents/.env.litellm" --mcp-command node --mcp-arg="$PWD/packages/mcp/explore/dist/server.js" --mcp-cwd="$PWD/packages/mcp/explore"
```

Use `--model azure/gpt-5.6-terra` or `--model azure/gpt-5.6-sol` to select another allowed route. Omit `--variant` to restore the default paired baseline and MCP comparison. `--model` and `--matrix` are mutually exclusive.

## Record every model-server request and response

The trace wrapper runs only the TypeAgent MCP variant and routes both the outer
Copilot session and inner TypeAgent model calls through a loopback proxy. From
`ts/`, this single command runs one Luna row and records each HTTP exchange:

```bash
node packages/exploreBench/scripts/run-mcp-with-http-trace.mjs --trace-output "$PWD/.data/explore-bench/luna-mcp-http.jsonl" --upstream-base-url http://127.0.0.1:4627/v1 -- --limit 1 --model azure/gpt-5.6-luna --max-attempts 1 --max-concurrency 1 --api-key-env LITELLM_MASTER_KEY --env-file "$HOME/Documents/mygithub.com/ai-agents-setup/.agents/.env.litellm" --mcp-command node --mcp-arg="$PWD/packages/mcp/explore/dist/server.js" --mcp-cwd="$PWD/packages/mcp/explore"
```

The wrapper owns `--variant`, `--litellm-base-url`, and `--force-rerun`; do not
pass them after `--`. Forced fresh execution ensures a cache hit cannot produce
an empty trace. The wrapper refuses to overwrite an existing trace. JSONL rows
contain correlated `request` and `response` (or transport `error`) events with
exact bodies in base64 and UTF-8. Credential headers and sensitive URL
parameters are redacted, but prompts and model outputs are not, so treat the
trace as sensitive.

## Copilot CLI/SDK isolation

The harness starts the packaged native Copilot executable over the SDK's stdio JSON-RPC connection. It records the runtime version and protocol in `copilot-runtime.json`. Each session uses:

- SDK `mode: "empty"` with a run-scoped Copilot home
- config discovery, custom instructions, skills, memory, hooks, embeddings, and infinite sessions disabled
- source-qualified tool filters: `task` for the baseline main agent, MCP only for the treatment main agent
- `defaultAgent.excludedTools` keeps baseline `read`/`grep`/`glob`/`bash` available to `explorer` but hidden from the main agent
- deny-by-default permissions
- fixed absolute baseline command paths with a sanitized child `PATH`
- a trimmed runtime environment that excludes the LiteLLM credential
- per-session working directories fixed to the extracted SWE-bench repository

The harness resolves Copilot in this order: `--copilot`, `COPILOT_CLI_PATH`, the platform package installed with `@github/copilot`, then platform-specific `PATH` and Bun locations. Node/npm shims are rejected.

The LiteLLM credential defaults to `CUSTOM_PROVIDER_API_KEY`. Resolution order is inherited environment, `launchctl getenv`, then an explicit `--env-file` override. Its environment-variable name is automatically forwarded to the MCP server; only the name appears in arguments and configuration. Secret values are never written to arguments, manifests, progress logs, or reports. Use `--mcp-env NAME` only for additional named variables the MCP needs.

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

`results.jsonl` is the raw source of truth. Every row records RPC proof that no custom main agent was selected. Baseline rows record correlated `task`, `subagent.started`, child repository-tool, `subagent.completed`, and root task-completion events. Treatment rows verify that the MCP process advertises exactly one tool named `explore`, then record its exclusive invocation and TypeAgent telemetry. Missing, failed-only, or repeated-success required-path execution, direct main-agent inspection, malformed answers, failed telemetry, or model mismatch makes the row retryable.

Regenerate reports with:

```bash
node dist/src/cli.js report \
  --input .data/explore-bench/runs/typeagent-verified-10/results.jsonl
```

Both report formats include the raw per-variant leaderboard and an explicit `typeagent − baseline` delta table for every available 1/5/10/30/100/500/1000 prefix. Token columns report absolute outer Copilot, inner TypeAgent Code Mode, and combined counts; no token-saving percentage is substituted for token usage. Paired token deltas compare treatment combined tokens against baseline Copilot tokens, which already include both the main and explorer subagent calls. Totals are input plus output without double-counting cache or reasoning subsets.
