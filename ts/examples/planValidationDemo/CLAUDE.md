# Plan-Validated Agent Execution

This project is governed by a plan-validation MCP server. **Every file access and
shell call you make must go through the `validated_*` tools.** The built-in
`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` tools are NOT available in this
session — only the MCP tools provided by the `plan-validation` server.

A live dashboard is running at http://localhost:3100 — every tool call you make
is visible there, including blocks.

## Required Workflow

### 1. Read the plan schema

Call `get_plan_schema`. Read it carefully — the AgentPlan DSL has strict shape
requirements and the validator runs 13 passes.

### 2. Read the task inputs

Use `validated_read` on [brief.md](brief.md) and [design-tokens.json](design-tokens.json).
These files describe what to build.

### 3. Submit a plan

Call `submit_plan` with an `AgentPlan` JSON that lists every tool call you
intend to make, in order. The plan must include:

- `version: "1.1"`, unique `id`, and a `goal` describing the landing page
- `steps`: ordered array of `PlanStep` nodes. Each step needs `tool`,
  `inputSpec` (input constraints — use `{ type: "exact", value: "..." }` or
  `{ type: "regex", pattern: "..." }`), `dependsOn`, and `effect`.
- `limits`: resource limits — must fit under the org policy caps
  (maxTotalSteps ≤ 20, maxFileWrites ≤ 10, maxBytesWritten ≤ 524288)
- `permissions.allowedWritePaths`: use a glob covering this directory,
  e.g. `<absolute path of this dir>/**` with forward slashes.
- `postconditions`: predicates checked after the last step. At minimum include:
  - `file_contains` on `index.html` for `Decisions, measured.`
  - `file_contains` on `index.html` for `Start a free trial`
  - `file_contains` on `style.css` for `--color-primary`
  - `file_contains` on `script.js` for `cta_click`
- `metadata.allowedTools`: list every distinct tool used by the steps.

If `submit_plan` returns errors, fix them and resubmit. The errors are specific.

### 4. Execute

Use only these tools, in the exact order your plan declares:

| Tool              | Purpose                              |
| ----------------- | ------------------------------------ |
| `validated_read`  | Read file contents                   |
| `validated_write` | Create or overwrite a file           |
| `validated_edit`  | String replacement in a file         |
| `validated_glob`  | Find files by pattern                |
| `validated_grep`  | Search file contents                 |
| `validated_npm`   | Run npm/pnpm (structured, safe)      |
| `validated_git`   | Run git (structured, safe)           |
| `validated_node`  | Run a node script (structured, safe) |
| `validated_tsc`   | Run tsc (structured, safe)           |

`validated_bash` is **blocked** by policy (capabilities-only mode). Any attempt
to use it will be visible on the dashboard as a block event.

### 5. Verify

After the last step, call `check_postconditions`. Every declared predicate must
pass. Then call `plan_trace` to see the hash-chained audit log.

## Failure handling

- **Plan violation** (wrong tool, wrong inputs): the plan aborts. Call `plan_reset`
  and build a corrected plan.
- **Policy violation** (blocked bash command, denied path): the call is blocked
  but the plan continues. Adjust the next step.
- **Permission denied** (path outside your declared `allowedWritePaths`): the
  call is blocked. Either widen the plan's permissions (requires `plan_reset`)
  or use a path inside the declared set.

## Rules

- NEVER use built-in `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` — only `validated_*`.
- NEVER try to fetch from the network — policy denies it and it would be
  blocked anyway.
- NEVER skip `submit_plan`. No plan → no execution.
- Keep the plan tight — fewer steps means less that can drift.
