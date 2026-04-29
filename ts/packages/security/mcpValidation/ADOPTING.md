# Adopting Plan-Validated Execution

This guide is for developers who want to add plan-validated execution to their project. After setup, your AI coding assistant (Claude Code, GitHub Copilot, or Cursor) will declare a plan before acting, have every tool call verified against that plan, and be constrained by your organization's policy.

## What You Get

- **Plan-before-act**: The model must submit a validated plan before touching any files
- **Tool-call verification**: Every read, write, edit, and shell command is checked against the plan
- **Organization policy**: External rules the model can't override — tool restrictions, path limits, bash sandboxing
- **Postcondition verification**: Declared outcomes are checked after execution
- **Audit trail**: Hash-chained execution trace for compliance

## Setup (2 minutes)

### Option A: From npm (when published)

```bash
cd your-project
npx mcp-plan-validation init --policy dev
```

### Option B: From the fawn repo

```bash
# One-time setup
git clone https://github.com/hlucco/fawn.git
cd fawn && pnpm install
cd tools/validation && pnpm run build
cd ../mcpValidation && pnpm run build
cd ../..

# Initialize your project
cd /path/to/your-project
node /path/to/fawn/tools/mcpValidation/dist/init.js --policy dev
```

### What happens

The `init` command creates three files:

| File                                 | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `.plan-validation-policy.json`       | Your org policy — edit this to match your needs |
| Settings file (varies by client)     | Tells the AI client where the MCP server is     |
| Instructions file (varies by client) | Tells the model to use the plan protocol        |

### Choosing a client

```bash
# Claude Code (default)
node dist/init.js --policy dev

# GitHub Copilot
node dist/init.js --client copilot --policy dev

# Cursor
node dist/init.js --client cursor --policy dev

# All three at once
node dist/init.js --client all --policy dev
```

Auto-detects from `.claude/`, `.vscode/`, `.cursor/` directories if `--client` is omitted.

### Choosing a policy

| Policy   | For               | Bash                                | Network        |
| -------- | ----------------- | ----------------------------------- | -------------- |
| `strict` | Maximum safety    | Structured tools only (no raw bash) | Blocked        |
| `dev`    | Daily development | Allowed with command allowlist      | Dev ports open |
| `ml`     | ML/data science   | Allowed, Docker sandbox with GPU    | Blocked        |
| `ci`     | CI/CD pipelines   | Limited commands, tight timeouts    | Blocked        |

**If unsure, start with `strict`.** You can always loosen it later.

## After Setup

### 1. Review the policy

Open `.plan-validation-policy.json` and check:

- **paths**: Are the allowed read/write paths correct for your project?
- **bash.allowedCommands**: Does the allowlist cover your toolchain?
- **limitCaps**: Are the step/time/write limits reasonable?

### 2. Start your AI client

- **Claude Code**: Just open the project. The MCP server starts automatically.
- **Copilot**: Open in VS Code. Copilot discovers the server from `.vscode/mcp.json`.
- **Cursor**: Open in Cursor. The server loads from `.cursor/mcp.json`.

### 3. Give it a task

The model will automatically:

1. Read the plan schema
2. Create and submit a plan
3. Execute using `validated_*` tools
4. Report postcondition results

If a step fails validation, the model self-corrects (re-plans or adjusts inputs).

## Customizing the Policy

### Allow more bash commands

```json
{
  "bash": {
    "mode": "policy-checked",
    "allowedCommands": ["npm", "git", "node", "python", "make", "cargo"]
  }
}
```

### Block bash entirely (safest)

```json
{
  "bash": {
    "mode": "capabilities-only"
  }
}
```

The model uses `validated_npm`, `validated_git`, `validated_node`, `validated_tsc` instead — structured tools with no shell injection.

### Allow network for dev servers

```json
{
  "bash": {
    "network": {
      "denyAll": false,
      "allowedPorts": [3000, 5173, 8080]
    }
  }
}
```

### Restrict file access

```json
{
  "paths": {
    "allowedWritePatterns": ["./src/**", "./test/**"],
    "deniedPatterns": ["**/.env", "**/secrets/**"]
  }
}
```

### Enable Docker sandbox

For running `python -c`, arbitrary scripts, or untrusted code:

```json
{
  "container": {
    "enabled": true,
    "image": "node:20-slim",
    "networkMode": "none",
    "readOnly": true,
    "memoryLimit": "512m"
  }
}
```

Requires Docker to be running.

### Set resource limits

```json
{
  "limitCaps": {
    "maxTotalSteps": 30,
    "maxDurationMs": 300000,
    "maxFileWrites": 10
  }
}
```

The model's plan cannot exceed these caps.

## What the Model Sees

The model gets access to these MCP tools:

| Category            | Tools                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| **Planning**        | `get_plan_schema`, `submit_plan`, `plan_status`, `plan_reset`, `plan_trace`                               |
| **File operations** | `validated_read`, `validated_write`, `validated_edit`, `validated_glob`, `validated_grep`                 |
| **Shell**           | `validated_bash` (may be restricted), `validated_npm`, `validated_git`, `validated_node`, `validated_tsc` |
| **Info**            | `container_status`                                                                                        |

Every `validated_*` call is checked against:

1. The plan (correct tool? correct inputs? dependencies met?)
2. The org policy (tool allowed? path allowed? command allowed?)
3. The plan's own permissions (within declared read/write paths?)

## Checking the Audit Trail

After execution, call `plan_trace` (or inspect `state.trace` programmatically) to get the hash-chained log:

```json
{
  "planId": "update-css-theme",
  "status": "completed",
  "entryCount": 3,
  "entries": [
    {
      "stepIndex": 0,
      "tool": "Read",
      "status": "success",
      "durationMs": 45,
      "hash": "a3f2..."
    },
    {
      "stepIndex": 1,
      "tool": "Edit",
      "status": "success",
      "durationMs": 12,
      "hash": "7b1e..."
    },
    {
      "stepIndex": 2,
      "tool": "Edit",
      "status": "success",
      "durationMs": 8,
      "hash": "c9d4..."
    }
  ],
  "metrics": {
    "totalSteps": 3,
    "durationMs": 1234,
    "successCount": 3,
    "failedCount": 0
  },
  "chainValid": true
}
```

`chainValid: true` means no entries were tampered with (each hash includes the previous hash).

## Troubleshooting

| Problem                        | Fix                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| MCP server doesn't start       | Check the path in your settings file points to the built `dist/index.js`. Rebuild with `pnpm run build`.     |
| Model doesn't follow protocol  | Check CLAUDE.md / .cursorrules / copilot-instructions.md contains the plan instructions. Re-run `init`.      |
| "No active plan" errors        | Model called `validated_*` before `submit_plan`. Instructions file may not have loaded — restart the client. |
| Plan validation failures       | Structural errors in the plan. The error message is specific. The model self-corrects in 1-2 retries.        |
| Policy blocks a needed command | Edit `.plan-validation-policy.json` and add the command to `bash.allowedCommands`.                           |
| Path permission denied         | The model's plan declared narrow permissions. It will reset and re-plan with broader paths.                  |
| Docker not found               | Set `container.enabled: false` or install Docker.                                                            |

## Updating

### From npm

```bash
npx mcp-plan-validation@latest init --policy dev
```

Re-running `init` is safe — it skips existing policy, merges settings, and detects existing instructions.

### From source

```bash
cd /path/to/fawn
git pull
cd tools/validation && pnpm run build
cd ../mcpValidation && pnpm run build
```

The MCP server picks up changes on next client restart.

## Removing

Delete the three files `init` created:

```bash
rm .plan-validation-policy.json
# Then remove the plan-validation entry from your settings file
# and the "Plan-Validated Agent Execution" section from your instructions file
```
