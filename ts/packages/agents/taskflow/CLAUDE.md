# TaskFlow Agent — Claude Code Instructions

TaskFlow runs user-taught multi-step macros over existing TypeAgent actions.
Flows are pure JSON — no TypeScript logic. A deterministic compile script handles
all boilerplate generation (TypeScript type, grammar rule, manifest entry).

---

## Compiling Pending Recipes

When asked to "compile pending recipes" or similar:

```
pnpm run compile
```

That's it. `scripts/compileRecipes.mjs` reads `pending/*.recipe.json` and:
1. Writes `flows/ACTION_NAME.flow.json`
2. Appends TypeScript type to `src/schema/userActions.mts`
3. Appends grammar rule to `src/taskflowSchema.agr`
4. Updates `manifest.json` flows entry
5. Runs `pnpm run asc && pnpm run agc && npx tsc -b`
6. Moves processed recipes to `pending/processed/`

If the build fails, fix the error in the generated files and re-run `pnpm run build`.

---

## Writing a Recipe

When asked to write a recipe for a new flow (or if you notice a missing flow):

1. Use `discover_actions` to confirm exact schemaName + actionName + parameter types
2. Devise the step sequence — keep it linear; each step's output feeds the next
3. Write `pending/ACTION_NAME.recipe.json` using the format below
4. Tell the user: "Recipe written — run `pnpm run compile` from `packages/agents/taskflow`"

Do NOT write TypeScript files. Do NOT edit `userActions.mts`, `taskflowSchema.agr`,
`manifest.json`, or `actionHandler.mts` by hand — the compile script does all of that.

---

## Recipe Format

```json
{
  "version": 1,
  "actionName": "camelCaseActionName",
  "description": "what this flow does",
  "parameters": [
    {
      "name": "paramName",
      "type": "string | number | boolean",
      "required": true,
      "description": "shown in grammar and type"
    },
    {
      "name": "optionalParam",
      "type": "string",
      "required": false,
      "default": "default value",
      "description": "..."
    }
  ],
  "steps": [
    {
      "id": "stepId",
      "schemaName": "utility",
      "actionName": "webSearch",
      "parameters": {
        "query": "${paramName}"
      }
    },
    {
      "id": "result",
      "schemaName": "utility",
      "actionName": "llmTransform",
      "parameters": {
        "input": "${stepId.text}",
        "prompt": "Summarize the following...",
        "model": "claude-haiku-4-5-20251001"
      }
    }
  ],
  "grammarPatterns": [
    "3-5 natural ways to invoke this, with $(param:wildcard) or $(param:number) captures"
  ]
}
```

### Parameter references in step parameters

| Value | Resolves to |
|-------|-------------|
| `"${paramName}"` | flow parameter value (typed) |
| `"${stepId.text}"` | prior step's plain text output |
| `"${stepId.data}"` | prior step's output parsed as JSON |
| `"prefix ${paramName} suffix"` | interpolated string |
| Static value | passed through as-is (strings, numbers, booleans, objects, arrays) |

### Nested objects and arrays are fine

Step parameters can contain nested objects and arrays — the interpreter resolves
`${...}` references recursively:

```json
"parameters": {
  "messageRef": {
    "receivedDateTime": { "dayRange": "${timePeriod}" }
  },
  "to": ["me"]
}
```

### Grammar pattern syntax

- Captures: `$(varName:wildcard)` or `$(varName:number)`
- Optional tokens: `(word)?`
- Alternatives within a pattern: `(this | that)`
- Bare words only — no quotes around words
- The compile script extracts captures and builds the action body automatically

---

## Available Actions for Flows

Use `discover_actions schemaName` to see exact parameter types. Key schemas:

**utility** — `webSearch(query)`, `webFetch(url)`, `readFile(path)`, `writeFile(path, content)`,
`llmTransform(input, prompt, parseJson?, model?)`, `claudeTask(goal, parseJson?, model?, maxTurns?)`

**email** — `findEmail(messageRef)`, `sendEmail(subject, body?, to[], genContent)`,
`replyEmail(...)`, `forwardEmail(...)`

**player** — music/Spotify actions (see discover_actions)

**Note**: `sendEmail` with `to: ["me"]` automatically resolves to the user's own email address.
`genContent: { generateBody: false }` tells the handler to use the provided `body` as-is.

---

## LLM Model Selection for llmTransform / claudeTask

| Task | Model |
|------|-------|
| Simple extraction, formatting, summarisation | `claude-haiku-4-5-20251001` |
| Complex multi-step reasoning | `claude-sonnet-4-6` |

Default to Haiku.
