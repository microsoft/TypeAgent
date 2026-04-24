# Getting Started with Plan-Validated Execution

Plan validation makes LLM agent loops self-checking: the model declares a plan before acting, every tool call is verified against that plan, and organization policy is enforced at every step.

This works with **any MCP-capable client** — Claude Code, GitHub Copilot, Cursor, or the Anthropic Agent SDK.

---

## Quick Start

### Claude Code

```bash
cd my-project
node /path/to/mcpValidation/dist/init.js --client claude --policy dev

# Future (when published to npm):
# npx mcp-plan-validation init --client claude --policy dev
```

Creates:

- `.plan-validation-policy.json` — org policy
- `.claude/settings.local.json` — MCP server config
- `CLAUDE.md` — plan protocol instructions

Start Claude Code. Done.

### GitHub Copilot (VS Code)

```bash
cd my-project
node /path/to/mcpValidation/dist/init.js --client copilot --policy dev

# Future:
# npx mcp-plan-validation init --client copilot --policy dev
```

Creates:

- `.plan-validation-policy.json` — org policy
- `.vscode/mcp.json` — MCP server config
- `.github/copilot-instructions.md` — plan protocol instructions

Open VS Code. Copilot discovers the MCP server from `.vscode/mcp.json`.

### Cursor

```bash
cd my-project
node /path/to/mcpValidation/dist/init.js --client cursor --policy dev

# Future:
# npx mcp-plan-validation init --client cursor --policy dev
```

Creates:

- `.plan-validation-policy.json` — org policy
- `.cursor/mcp.json` — MCP server config
- `.cursorrules` — plan protocol instructions

Open Cursor. The MCP server is picked up from `.cursor/mcp.json`.

### All clients at once

```bash
node /path/to/mcpValidation/dist/init.js --client all --policy dev
```

Creates settings for Claude Code, Copilot, and Cursor simultaneously. The policy file is shared.

### Auto-detect

```bash
# Omit --client to auto-detect from existing config directories
node /path/to/mcpValidation/dist/init.js --policy dev
```

Detects which clients are configured by checking for `.claude/`, `.vscode/`, and `.cursor/` directories. Falls back to Claude Code if none are found.

---

## What Each Client Gets

|                       | Claude Code                             | GitHub Copilot                        | Cursor                    |
| --------------------- | --------------------------------------- | ------------------------------------- | ------------------------- |
| **Settings file**     | `.claude/settings.local.json`           | `.vscode/mcp.json`                    | `.cursor/mcp.json`        |
| **Settings format**   | `{ mcpServers: { ... } }`               | `{ servers: { type: "stdio", ... } }` | `{ mcpServers: { ... } }` |
| **Instructions file** | `CLAUDE.md`                             | `.github/copilot-instructions.md`     | `.cursorrules`            |
| **Policy file**       | `.plan-validation-policy.json` (shared) | same                                  | same                      |

### Claude Code settings format

```json
// .claude/settings.local.json
{
  "mcpServers": {
    "plan-validation": {
      "command": "node",
      "args": [
        "/path/to/dist/index.js",
        "--policy",
        "/path/to/.plan-validation-policy.json"
      ]
    }
  }
}
```

### GitHub Copilot settings format

```json
// .vscode/mcp.json
{
  "servers": {
    "plan-validation": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/dist/index.js",
        "--policy",
        "/path/to/.plan-validation-policy.json"
      ]
    }
  }
}
```

### Cursor settings format

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "plan-validation": {
      "command": "node",
      "args": [
        "/path/to/dist/index.js",
        "--policy",
        "/path/to/.plan-validation-policy.json"
      ]
    }
  }
}
```

### Anthropic Agent SDK (programmatic)

No init needed — configure in code:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createValidationServer } from "mcp-plan-validation/server";
import { loadOrgPolicy } from "validation";

const policy = loadOrgPolicy("./my-policy.json");
const { server } = createValidationServer({ policy });

for await (const msg of query({
  prompt: "your task here",
  options: {
    mcpServers: {
      "plan-validation": {
        type: "sdk",
        name: "plan-validation",
        instance: server,
      },
    },
    tools: [], // model uses only MCP tools
  },
})) {
  /* handle messages */
}
```

---

## Choosing a Policy

| Policy   | Bash                  | Network                         | Container            | Best for                           |
| -------- | --------------------- | ------------------------------- | -------------------- | ---------------------------------- |
| `strict` | Capability tools only | Blocked                         | No                   | Maximum safety. Code review, docs. |
| `dev`    | Allowlisted commands  | Dev ports (3000, 5173, 8080...) | Optional (bridge)    | Daily development.                 |
| `ml`     | Allowlisted commands  | Blocked                         | Yes (GPU, 16GB)      | ML training, data science.         |
| `ci`     | Limited commands      | Blocked                         | Optional (read-only) | CI/CD pipelines.                   |

**Start with `strict` if you're unsure.** Switch by editing `.plan-validation-policy.json`.

---

## Customizing the Policy

After running `init`, edit `.plan-validation-policy.json`:

### File paths

```json
{
  "paths": {
    "allowedReadPatterns": ["/home/user/project/**", "/data/**"],
    "allowedWritePatterns": ["/home/user/project/src/**"],
    "deniedPatterns": ["**/.env", "**/secrets/**", "**/*.key"]
  }
}
```

Deny always overrides allow. Patterns use glob syntax (`**` = any depth).

### Bash access

| Mode                | Effect                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `capabilities-only` | `validated_bash` blocked. Use `validated_npm`, `validated_git`, `validated_node`, `validated_tsc`. |
| `policy-checked`    | `validated_bash` allowed, commands checked against allow/deny lists.                               |
| `unrestricted`      | No bash restrictions (not recommended).                                                            |

### Resource limits

```json
{
  "limitCaps": {
    "maxTotalSteps": 50,
    "maxDurationMs": 300000,
    "maxFileWrites": 20,
    "maxBytesWritten": 1048576
  }
}
```

### Container sandbox

For `python -c`, arbitrary scripts, or untrusted code:

```json
{
  "container": {
    "enabled": true,
    "image": "node:20-slim",
    "networkMode": "none",
    "deriveVolumesFromPolicy": true,
    "readOnly": true,
    "memoryLimit": "512m",
    "pidsLimit": 100
  }
}
```

Requires Docker. Volumes derived from path policy. Network restricted at kernel level.

### GPU and devices

```json
{
  "container": {
    "devices": {
      "gpu": true,
      "allowedDevices": ["/dev/video0", "/dev/snd"]
    }
  }
}
```

### Port publishing

```json
{
  "bash": { "network": { "allowedPorts": [3000, 8080] } },
  "container": { "networkMode": "bridge", "derivePortsFromPolicy": true }
}
```

---

## How It Works

```
User gives task
    ↓
Model reads plan schema (get_plan_schema)
    ↓
Model creates AgentPlan JSON → submit_plan
    ↓
┌─ Plan validated (13 structural checks)
├─ Policy validated (tools, limits, paths)
└─ Circular dependency check
    ↓ (pass)
Plan activated
    ↓
Model calls validated_read/write/edit/glob/grep/bash/npm/git/node/tsc
    ↓ (each call)
┌─ Plan step check: correct tool? input constraints? dependencies?
├─ Policy check: tool allowed? path allowed? bash command allowed?
├─ Permission check: plan's own declared paths?
└─ Execute (direct or in container)
    ↓ (after last step)
Postconditions evaluated (if declared)
```

**Three kinds of failures:**

| Type              | Cause                           | Effect                       | Recovery                                 |
| ----------------- | ------------------------------- | ---------------------------- | ---------------------------------------- |
| Plan violation    | Wrong tool, wrong inputs        | Plan aborted                 | `plan_reset`, re-plan                    |
| Policy violation  | Restricted command, denied path | Call blocked, plan continues | Adjust approach                          |
| Permission denied | Path outside plan's permissions | Call blocked, plan continues | `plan_reset`, re-plan with broader paths |

---

## Building from Source

```bash
git clone https://github.com/hlucco/fawn.git
cd fawn
pnpm install

# Build
cd tools/validation && pnpm run build && cd ../..
cd tools/mcpValidation && pnpm run build && cd ../..

# Initialize your project
cd tools/mcpValidation
node dist/init.js --client claude --policy dev --project-dir /path/to/your/project

# Or for all clients at once:
node dist/init.js --client all --policy dev --project-dir /path/to/your/project
```

---

## CLI Reference

```
mcp-plan-validation init [options]
  --client <name>       claude, copilot, cursor, all (default: auto-detect)
  --policy <name>       strict, dev, ml, ci (default: strict)
  --project-dir <path>  Target directory (default: cwd)

mcp-plan-validation serve [options]
  --policy <path>       Path to policy JSON file

mcp-plan-validation
  (no subcommand)       Starts MCP server (same as serve)
```

Idempotent: re-running `init` skips existing policy, merges settings, detects existing instructions.

---

## Troubleshooting

**MCP server doesn't start**: Check the path in the settings file points to the built `dist/index.js`. Run `pnpm run build` in `tools/mcpValidation`.

**Model doesn't follow the protocol**: Check that the instructions file exists and contains "Plan-Validated Agent Execution". Re-run `init` if needed.

**"No active plan" errors**: The model tried `validated_*` tools before `submit_plan`. The instructions file may not have loaded.

**Plan validation failures**: Structural errors in the plan. The error message is specific — the model self-corrects within 1-2 retries.

**Policy violations**: The org policy denied the action. The call is blocked but the plan continues. The model adjusts.

**Permission denied on paths**: The plan's own path permissions are too narrow. The model resets and re-plans with broader paths. Windows paths are normalized to forward slashes automatically.

**Docker not found**: Container sandbox requires Docker. Set `container.enabled: false` or install Docker.

**Copilot doesn't see the MCP server**: Ensure `.vscode/mcp.json` exists (not `settings.json`). Restart VS Code after creating the file.

**Cursor doesn't see the MCP server**: Ensure `.cursor/mcp.json` exists. Restart Cursor after creating the file.
