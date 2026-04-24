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
└── pending/
    └── *.recipe.json           # Captured from reasoning, not yet promoted
```

## Lifecycle

1. `updateAgentContext(enable=true)` → init store → seed samples → register grammars
2. Grammar matcher routes to powershell agent on match
3. `executeAction` looks up flow from store → reads `.ps1` → executes in sandbox
4. Reasoning traces with PowerShell → `ScriptRecipeGenerator` → saved to `pending/`

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
  "sandbox": {
    "allowedCmdlets": ["Get-ChildItem", "Select-Object"],
    "allowedPaths": ["$env:USERPROFILE", "$PWD", "$env:TEMP"],
    "allowedModules": ["Microsoft.PowerShell.Management"],
    "maxExecutionTime": 30,
    "networkAccess": false
  }
}
```

### Key Differences from TaskFlow Recipes

- Uses `script.body` (PowerShell) instead of `steps` array of agent actions
- Has `sandbox` policy (cmdlet whitelist, path restrictions, timeout)
- `grammarPatterns` are objects with `isAlias` flag, not plain strings
- Parameter type can be `"path"` (validated as filesystem path)
- Stored in instance storage, not in the package directory

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
