# Plan-Validated Agent Execution: Executive Demo

## The Problem

Your team uses AI coding assistants — Claude Code, GitHub Copilot, Cursor. These tools are productive, but they operate with broad access: they can read any file, execute any command, modify any code, and access the network. There's no way for your organization to enforce policy on what an AI agent does.

**What managers are asking:**

> "Can we use AI agents on our codebase without giving them unrestricted access?"
>
> "How do I know the agent didn't read our .env files or exfiltrate code?"
>
> "Can we restrict agents to only run approved commands?"
>
> "Where's the audit trail showing what the agent actually did?"

This system answers all four questions.

---

## How It Works (30-second version)

```
            ┌──────────────────────────┐
            │   Organization Policy    │  ← You define this (JSON file)
            │   • Allowed tools        │     Not the AI — your team
            │   • Path restrictions    │
            │   • Bash command limits  │
            │   • Resource caps        │
            └───────────┬──────────────┘
                        │
         ┌──────────────▼──────────────┐
         │     Validation MCP Server    │  ← Sits between the AI and your code
         │                              │
         │  1. AI declares a PLAN       │
         │  2. Plan is VALIDATED        │
         │  3. Every tool call CHECKED  │
         │  4. Results VERIFIED         │
         │  5. Everything LOGGED        │
         └──────────────────────────────┘
```

The AI must **declare what it intends to do before doing it**. Every action is checked against the plan AND your organization's policy. A tamper-proof audit trail records everything.

---

## Scenario: Developer Asks Claude to Refactor Authentication

### Without plan validation (today)

The developer asks: _"Refactor the auth middleware to use JWT instead of sessions."_

The AI agent:

- Reads all files in the project (including `.env` with database credentials)
- Runs `npm install jsonwebtoken` (installs a package from the internet)
- Modifies 12 files across the codebase
- Runs `curl https://jwt.io/...` to check documentation
- Commits and pushes to the remote

**You have no visibility into what happened, no way to restrict it, and no audit trail.**

### With plan validation

The same request, but now the validation server mediates every action.

**Step 1: The AI submits a plan**

```
Plan: "Refactor auth middleware from sessions to JWT"
  Step 0: Read — src/middleware/auth.ts
  Step 1: Read — src/config/auth.ts
  Step 2: Edit — src/middleware/auth.ts (replace session check with JWT verify)
  Step 3: Edit — src/config/auth.ts (add JWT secret config)
  Step 4: Npm  — install jsonwebtoken @types/jsonwebtoken
  Step 5: Edit — src/middleware/auth.ts (add import)
  Postconditions:
    - src/middleware/auth.ts contains "jwt.verify"
    - src/middleware/auth.ts does not contain "req.session"
```

**Step 2: The plan is validated**

The server runs 13 structural checks and verifies the plan against your org policy:

```
✓ Plan structure valid
✓ All tools allowed by policy
✓ File paths within allowed read/write paths
✓ Npm install is an allowed command
✓ Step count (6) within limit (30)
✗ REJECTED: Step 4 uses Npm — would need to verify package is on approved list
```

If the plan violates policy, it's rejected **before any code is touched**.

**Step 3: Each tool call is verified**

```
Step 0: validated_read(src/middleware/auth.ts)
  ✓ Tool matches plan (Read)
  ✓ Path within allowed read paths
  ✓ Not in denied paths (.env, credentials)
  → Executed (45ms)

Step 2: validated_edit(src/middleware/auth.ts, ...)
  ✓ Tool matches plan (Edit)
  ✓ Path within allowed write paths
  ✓ Input satisfies constraints
  → Executed (12ms)
```

If the AI deviates — calls a different tool, accesses a file outside its plan, or tries to run a restricted command — the call is **blocked immediately**.

**Step 4: Postconditions verified**

After the last step, the server checks:

```
[PASS] src/middleware/auth.ts contains "jwt.verify"
[PASS] src/middleware/auth.ts does not contain "req.session"
```

**Step 5: Audit trail available**

```json
{
  "planId": "refactor-auth-jwt",
  "status": "completed",
  "entries": [
    {
      "step": 0,
      "tool": "Read",
      "status": "success",
      "duration": "45ms",
      "hash": "a3f2..."
    },
    {
      "step": 1,
      "tool": "Read",
      "status": "success",
      "duration": "23ms",
      "hash": "7b1e..."
    },
    {
      "step": 2,
      "tool": "Edit",
      "status": "success",
      "duration": "12ms",
      "hash": "c9d4..."
    },
    {
      "step": 3,
      "tool": "Edit",
      "status": "success",
      "duration": "8ms",
      "hash": "e1a0..."
    },
    {
      "step": 4,
      "tool": "Npm",
      "status": "success",
      "duration": "3.2s",
      "hash": "f293..."
    },
    {
      "step": 5,
      "tool": "Edit",
      "status": "success",
      "duration": "9ms",
      "hash": "0b7d..."
    }
  ],
  "chainValid": true,
  "metrics": {
    "totalSteps": 6,
    "durationMs": 4521,
    "successCount": 6,
    "failedCount": 0
  }
}
```

Every entry is hash-chained (each includes the previous entry's hash). `chainValid: true` means the log hasn't been tampered with.

---

## What Org Policy Looks Like

Your VP of Engineering says:

> "Agents can read and write code in the src/ and test/ directories. They cannot access credentials, run curl, or open network connections. Limit them to 30 steps and 5 minutes."

That translates directly to a policy file:

```json
{
  "version": "1.0",
  "name": "engineering-standard",

  "paths": {
    "allowedReadPatterns": ["./src/**", "./test/**", "./package.json"],
    "allowedWritePatterns": ["./src/**", "./test/**"],
    "deniedPatterns": ["**/.env", "**/credentials*", "**/secrets*", "**/*.key"]
  },

  "bash": {
    "mode": "capabilities-only"
  },

  "deniedTools": ["WebFetch", "WebSearch"],

  "limitCaps": {
    "maxTotalSteps": 30,
    "maxDurationMs": 300000,
    "maxFileWrites": 10
  }
}
```

**Key points for managers:**

- **You write the policy, not the AI.** The AI cannot modify or override it.
- **`capabilities-only` mode** means no arbitrary shell commands. The agent uses structured tools (`validated_npm`, `validated_git`) that can't be exploited via shell injection.
- **deniedPatterns** means `.env` files are invisible to the agent — it can't even read them.
- **The policy is a JSON file** checked into your repo. It's version-controlled, reviewable, and auditable.

---

## Policy Templates for Common Scenarios

| Scenario                        | Template | What it restricts                                           |
| ------------------------------- | -------- | ----------------------------------------------------------- |
| **Code review & documentation** | `strict` | No bash at all. Read/write src and test only. No network.   |
| **Daily development**           | `dev`    | Bash with approved commands. Dev server ports open.         |
| **ML/data science**             | `ml`     | Docker sandbox with GPU. Python allowed. No network.        |
| **CI/CD pipelines**             | `ci`     | Read-only filesystem. Tight timeouts. No interactive tools. |

Each template is a starting point. Your team customizes it for their needs.

---

## What Gets Blocked (Real Examples)

### Agent tries to read credentials

```
validated_read(.env)
→ BLOCKED: Path '.env' matches denied pattern '**/.env'
```

### Agent tries to curl an external URL

```
validated_bash("curl https://example.com/api")
→ BLOCKED: Bash is restricted to capabilities-only mode.
   Use validated_npm, validated_git, validated_node, or validated_tsc instead.
```

### Agent calls the wrong tool (deviates from plan)

```
Plan says step 3 should be Edit. Agent calls Read.
→ BLOCKED: Expected tool 'Edit' at step 3, got 'Read'
→ Plan ABORTED. Agent must reset and re-plan.
```

### Agent tries to write outside allowed paths

```
validated_write(/etc/crontab, ...)
→ BLOCKED: Path '/etc/crontab' is not within allowed write paths
```

### Agent's plan exceeds resource limits

```
submit_plan({... maxTotalSteps: 100 ...})
→ REJECTED: Plan maxTotalSteps (100) exceeds policy cap (30)
```

---

## Adoption: One Command

For a developer already using Claude Code:

```bash
npx mcp-plan-validation init --policy dev
```

This creates three files in their project:

1. **Policy file** — your org's rules
2. **Settings file** — tells the AI client where the validation server is
3. **Instructions file** — tells the AI to use the plan protocol

The developer opens their editor. Everything works automatically.

For teams using different tools:

```bash
npx mcp-plan-validation init --client copilot --policy dev   # GitHub Copilot
npx mcp-plan-validation init --client cursor --policy dev    # Cursor
npx mcp-plan-validation init --client all --policy dev       # All three
```

---

## For Docker-Sandboxed Workloads

When teams need to run `python -c` or arbitrary scripts (ML, data processing), the container sandbox provides kernel-level enforcement:

```json
{
  "container": {
    "enabled": true,
    "image": "python:3.12-slim",
    "networkMode": "none",
    "readOnly": true,
    "memoryLimit": "512m",
    "devices": { "gpu": true }
  }
}
```

- **`networkMode: none`** — The kernel blocks all network access. `python -c "import socket; ..."` fails at the syscall level, not at string matching.
- **`readOnly: true`** — The container's filesystem is read-only (except mounted project dirs).
- **`memoryLimit`** — The container is killed if it exceeds the limit.
- **GPU access** is opt-in per policy.

---

## What Managers Can Tell Their Teams

> "We're enabling AI coding assistants with guardrails. Here's what changes:
>
> 1. **Your workflow doesn't change.** You still use Claude Code / Copilot / Cursor the same way. One setup command.
> 2. **The AI now declares a plan before acting.** You'll see it submit a plan, then execute step by step. If something goes wrong, it self-corrects.
> 3. **We have an org policy** that restricts what the AI can do. It can't read credentials, can't access the network, and can't run arbitrary commands. The policy is in `.plan-validation-policy.json` — review it.
> 4. **Everything is auditable.** The execution trace records every action with a tamper-proof hash chain. If compliance asks what the AI did, we have the answer.
> 5. **If you need more access** (a new tool, a wider path, a higher step limit), update the policy file and submit a PR. It's version-controlled like everything else."

---

## Live Dashboard

Run the interactive demo to see plan validation in action with a live web dashboard:

```bash
cd tools/mcpValidation
pnpm run demo
# Opens http://localhost:3100
```

The dashboard shows:

- **Organization Policy** — your loaded policy with path restrictions, bash mode, and limits
- **Active Plan** — current plan steps with real-time progress tracking
- **Execution Trace** — hash-chained audit ledger with per-step timing and integrity verification
- **Container Sandbox** — Docker status, image, network mode, resource limits
- **Event Log** — real-time stream of completions, violations, and state changes

The demo runs a self-contained scenario (no API key needed):

1. Loads a corporate policy (capabilities-only, no network, credential protection)
2. Submits and validates a plan to update a CSS file to a dark theme
3. Executes each step with trace recording
4. Simulates policy violations (curl blocked, .env blocked)

All updates appear live in the dashboard as the scenario unfolds.

---

## Summary

| Question                                 | Answer                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Can we restrict what AI agents do?       | Yes — org policy controls tools, paths, commands, network, and resource limits     |
| Can we prevent credential exposure?      | Yes — denied path patterns make sensitive files invisible to the agent             |
| Is there an audit trail?                 | Yes — hash-chained execution trace with per-step timing and integrity verification |
| Does this work with our existing tools?  | Yes — Claude Code, GitHub Copilot, and Cursor, with one setup command              |
| Who controls the policy?                 | Your team — it's a JSON file in the repo, not generated by the AI                  |
| What if the AI tries to break the rules? | Every call is blocked in real-time and logged. Plan violations abort execution.    |
| How hard is adoption?                    | One command: `npx mcp-plan-validation init --policy dev`                           |
