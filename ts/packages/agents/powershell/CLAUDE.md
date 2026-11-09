# PowerShell Agent — Claude Code Instructions

PowerShell captures and reuses PowerShell scripts from reasoning traces.
Scripts persist in instance storage (`~/.typeagent/profiles/<profile>/powershell/`)
across sessions. Grammar rules are registered dynamically at runtime — no build
step needed for user-created flows.

---

## Architecture

- **Instance storage**: flows + scripts persist across sessions via `SessionContext.instanceStorage`
- **Runtime grammar registration**: `.agr` rule text → `globalAgentGrammarRegistry.addGeneratedRules()`
- **Sample seeding**: `samples/*.recipe.json` are copied to instance storage on first activation
- **Build-time compilation** (`compileRecipes.mjs`): only for developer workflow, not production

## Storage Layout (in instance storage)

```
powershell/
├── index.json                  # Flow registry index
├── flows/
│   └── listFiles.flow.json     # Flow metadata + parameters + sandbox
├── scripts/
│   └── listFiles.ps1           # Separated PowerShell script
├── revisions/
│   └── listFiles.json          # Saved-version fingerprint, not permission
└── pending/
    └── *.recipe.json           # Captured from reasoning, not yet promoted
```

## Lifecycle

1. `updateAgentContext(enable=true)` → init store → seed samples → register grammars
2. Grammar matcher routes to powershell agent on match
3. `executeAction` looks up a flow, reads `.ps1`, obtains/verifies authorization, then executes locally
4. Reasoning traces with PowerShell → `ScriptRecipeGenerator` → shared validated store

Initialize flow storage and seed samples only when the root `powershell` schema
is enabled. Static namespaces can enable concurrently; they must not create
competing store instances or revoke the root flow approvals on disable.

## Execution authorization

Dynamic flows require trusted user authorization and the Windows execution
broker, without execution feature flags. The obsolete `dynamicExecution.enabled`
and `brokerExecution.enabled` settings are ignored, including explicit false
values. No configuration setting grants script approval.

Approved-local execution is not a sandbox. Its central runner requires trusted
UI authorization, including before tests, drafts, and repairs. The model cannot
approve code through recipe fields. Direct connected-client calls may remember
the exact script/definition/arguments/working-directory/timeout for the current
session; reasoning calls require fresh consent. Approval records are in memory,
not saved next to the scripts. They use the host-issued session lifetime, not
the identity of a transient RPC wrapper. Restarting asks again.

Use `requestSecurityApproval`, never `popupQuestion`, for execution consent.
Only an explicitly interactive client implements this channel. Model-callable
structured continuations cannot supply it. Forward it through reasoning capture
and agent/client RPC without putting it in the shared pending-interaction registry.

Pass the host's action working directory to every dynamic execution request and
use it for the safe `$env:PWD` parameter alias. The host forwards request
cancellation to the approval UI; never serialize an AbortSignal across RPC.

The initial confirmation is compact: flow, working directory, arguments, and
current-user execution warning. **Review script and details** exposes the full
snapshot before approval; viewing it is not authorization. Both views default
to Cancel, and truncated summary fields are explicitly labelled.

The `sandbox.maxExecutionTime` field is an operational timeout, not containment.
`requiredModules` are loaded after approval. Old `allowedModules` lists are
accepted as dependencies; other old permission fields do not restrict execution.
Do not present paths or networking as sandbox-restricted.
Use `@powershell revoke` to clear session approvals. Restricted broker protocol v1
remains only for compatibility.

## Script Recipe Format

```json
{
  "version": 1,
  "actionName": "camelCaseActionName",
  "description": "what this script does",
  "displayName": "Human Readable Name",
  "parameters": [
    {
      "name": "path",
      "type": "path",
      "required": false,
      "description": "Directory to list",
      "default": "."
    }
  ],
  "script": {
    "language": "powershell",
    "body": "param([string]$Path = '.')\nGet-ChildItem -Path $Path",
    "expectedOutputFormat": "table"
  },
  "grammarPatterns": [
    {
      "pattern": "list files in $(path:wildcard)",
      "isAlias": false,
      "examples": ["list files in downloads"]
    },
    {
      "pattern": "ls $(path:wildcard)",
      "isAlias": true,
      "examples": ["ls downloads"]
    }
  ],
  "requiredModules": ["Microsoft.PowerShell.Management"],
  "sandbox": { "maxExecutionTime": 30 }
}
```

### Key Differences from TaskFlow Recipes

- Uses `script.body` (PowerShell) instead of `steps` array of agent actions
- Has an operational timeout and optional module dependencies
- `grammarPatterns` are objects with `isAlias` flag, not plain strings
- Parameter type can be `"path"` (validated as filesystem path)
- Stored in instance storage, not in the package directory

The store and recipe types live in `@typeagent/agent-flows/powershell`.
Saved revision records detect unexpected changes; they never grant approval.
Missing records on older flows are an `unverified` review state, not a reason
to drop the store or silently approve existing scripts.

### Grammar Pattern Syntax

- Captures: `$(varName:wildcard)` for strings/paths, `$(varName:number)` for numbers
- Optional tokens: `(word)?`
- Alternatives: `(this | that)`
- `isAlias: true` for terse shell-like forms (ls, dir, ps)

## Build-time Compilation (developer workflow only)

```
pnpm run compile
```

`scripts/compileRecipes.mjs` reads `pending/*.recipe.json` and generates build-time
artifacts. This is useful for testing but not used in production — production flows
are loaded from instance storage at runtime.
