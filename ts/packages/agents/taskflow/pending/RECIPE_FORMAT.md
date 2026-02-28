# TaskFlow Recipe Format

Recipe files are written here by the TypeAgent shell (Claude reasoning phase).
Claude Code CLI compiles them into TypeScript handlers (code generation phase).

## Creating a Recipe

In the TypeAgent shell, say:

```
learn: find the top 10 streaming bluegrass songs this month and create a Spotify playlist from them
```

Claude will discover available agents/actions, extract parameters, and write a `.recipe.json` file
in this directory. Then run `claude --print "compile pending recipes"` from the package root.

## Recipe JSON Schema

```json
{
  "version": 1,
  "actionName": "camelCaseActionName",
  "description": "human-readable description of what this flow does",
  "parameters": [
    {
      "name": "paramName",
      "type": "string | number | boolean",
      "required": true,
      "description": "what this parameter means"
    },
    {
      "name": "optionalParam",
      "type": "number",
      "required": false,
      "default": 10,
      "description": "optional param with default value"
    }
  ],
  "steps": [
    {
      "id": "resultVariable",
      "type": "callAction",
      "schemaName": "exactSchemaNameFromDiscoverAgents",
      "actionName": "exactActionNameFromDiscoverAgents",
      "params": {
        "key": "params.paramName",
        "otherKey": "priorStepId",
        "templateKey": "`literal ${params.paramName} text`"
      },
      "comment": "what this step does"
    },
    {
      "id": "parsedResult",
      "type": "query",
      "prompt": "Extract data from this text:\n{priorStepId}",
      "model": "claude-haiku-4-5-20251001",
      "inputVars": ["priorStepId"],
      "comment": "why LLM interpretation is needed here"
    }
  ],
  "grammarPatterns": [
    "3 to 5 natural language patterns for invoking this flow",
    "each pattern can use $(paramName:wildcard) or $(paramName:number) captures"
  ]
}
```

## Step Types

**callAction** — direct TypeAgent action dispatch (no LLM reasoning):

- `schemaName`: exact schema name from `discover_agents level 2`
- `actionName`: exact action name from `discover_agents level 2`
- `params` values:
  - `"params.foo"` → flow parameter `foo`
  - `"priorId"` → result of prior step with that id
  - ``"`template ${params.x}`"`` → TypeScript template literal expression

**query** — LLM call for text interpretation (use sparingly):

- `prompt`: the prompt text; use `{varName}` to reference prior step results
- `model`: `claude-haiku-4-5-20251001` (default), `claude-sonnet-4-6` (complex reasoning only)
- `inputVars`: list of prior step IDs referenced in the prompt
