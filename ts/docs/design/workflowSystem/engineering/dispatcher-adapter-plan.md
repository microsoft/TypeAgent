# Dispatcher Adapter Plan

> **Status:** Draft
>
> **Purpose:** Plan the `workflow-adapter` package that wraps the
> workflow engine as a TypeAgent `AppAgent`, making workflows
> invocable via chat.

---

## 1. Goal

A user types something like _"run the standup prep workflow for
repos /a /b with author alice"_ in chat, and the dispatcher routes
it to the workflow agent, which executes the workflow and streams
progress back to the conversation.

No new engine features are needed. The adapter is a thin bridge
between the engine's `run()` API and the dispatcher's `AppAgent`
contract.

---

## 2. Package layout

```
examples/workflow/adapter/
  package.json
  tsconfig.json
  src/
    workflowManifest.json      # AppAgentManifest
    workflowSchema.ts          # Action type definitions
    workflowActionHandler.ts   # instantiate() -> AppAgent
    workflowDiscovery.ts       # Find workflow JSON files on disk
```

Package name: `workflow-agent`.
Depends on: `@typeagent/agent-sdk`, `workflow-engine`, `workflow-model`.

Registration in `defaultAgentProvider/data/config.json`:

```json
"workflow": {
  "name": "workflow-agent",
  "execMode": "dispatcher"
}
```

`execMode: "dispatcher"` keeps it in-process (no child process
overhead; workflows are CPU-light, I/O-heavy).

---

## 3. Schema design

Each discovered workflow becomes its own action type with typed
parameters derived from the workflow's `inputSchema`. This follows
the ScriptFlow pattern: dynamic per-workflow actions generated at
runtime via `getDynamicSchema()`.

There are no static management actions (`listWorkflows`,
`describeWorkflow`). The dynamic schema IS the discovery mechanism:
the LLM sees all workflow types, their descriptions, and their
parameters directly in the generated TypeScript. When a user asks
"what workflows are available?" the LLM can answer from context
without executing an action.

### 3.1 Static base schema

The static schema exists only to satisfy `asc` compilation and
provide the union type name. It is a placeholder that gets replaced
entirely by the dynamic schema at runtime.

```typescript
// workflowSchema.ts

// Placeholder: replaced at runtime by getDynamicSchema() with
// per-workflow action types derived from discovered workflow files.
export type WorkflowAction = {
  actionName: "noWorkflowsLoaded";
};
```

### 3.2 Dynamic per-workflow actions

`getDynamicSchema()` scans the discovered workflows and generates a
TypeScript union type. The dispatcher calls this on agent enable and
whenever `reloadAgentSchema()` is triggered.

For a workflow `d1-standup-prep.json` with:

```json
{
  "name": "d1-standup-prep",
  "description": "Standup prep: git log across N repos.",
  "inputSchema": {
    "type": "object",
    "required": ["repos", "author"],
    "properties": {
      "repos": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Absolute paths to git repos."
      },
      "author": { "type": "string", "description": "Git author name or email." }
    }
  }
}
```

The generated schema text includes:

```typescript
// Standup prep: git log across N repos.
export type D1StandupPrepAction = {
  actionName: "d1-standup-prep";
  parameters: {
    // Absolute paths to git repos.
    repos: string[];
    // Git author name or email.
    author: string;
  };
};
```

The full generated output is a union of all discovered workflows:

```typescript
export type WorkflowAction =
  | D1StandupPrepAction
  | D4CommitSummaryAction
  | D5CodeReviewPrepAction
  | D8SummarizeUrlAction;
```

### 3.3 Schema generation rules

- **actionName**: workflow `name` as-is (string literal, hyphens OK)
- **Type name**: PascalCase of `name` + `"Action"` suffix
  (`"d1-standup-prep"` -> `D1StandupPrepAction`)
- **Parameters**: derived from `inputSchema.properties`, with JSON
  Schema types mapped to TypeScript (`string` -> `string`,
  `number`/`integer` -> `number`, `boolean` -> `boolean`,
  `array` with `items.type: "string"` -> `string[]`,
  unrecognized -> `unknown`)
- **Required vs optional**: from `inputSchema.required` array;
  missing properties get `?` suffix
- **Descriptions**: `description` fields become `//` comments

### 3.4 getDynamicSchema implementation

```typescript
async getDynamicSchema(
    _context: SessionContext,
    _schemaName: string,
): Promise<SchemaContent | undefined> {
    return {
        format: "ts",
        content: generateDynamicSchemaText(agentContext.workflows),
    };
}
```

Returns raw TypeScript source text with `format: "ts"`. The
dispatcher compiles it and sends it to the LLM as the action type
definition. No grammar file needed: the LLM matches on type names,
action names, parameter names, and description comments.

### 3.5 Why dynamic, not static generation

- Workflows are JSON files on disk; adding a new workflow should not
  require rebuilding the adapter package.
- `reloadAgentSchema()` picks up new workflows mid-session.
- ScriptFlow already validates this pattern in production.

---

## 4. Agent context

```typescript
type WorkflowAgentContext = {
  engine: WorkflowEngine;
  registry: TaskRegistry;
  workflows: Map<string, WorkflowIR>; // name -> parsed IR
  workflowDir: string; // discovery directory
};
```

### 4.1 Lifecycle

- **`initializeAgentContext()`**: Create `TaskRegistry` with all
  builtins, create `WorkflowEngine`, return empty context.
- **`updateAgentContext(enable)`**: On enable, discover workflow JSON
  files from the configured directory, parse and validate each,
  populate the `workflows` map, then call
  `context.reloadAgentSchema()` to trigger `getDynamicSchema()`.
- **`closeAgentContext()`**: No-op (no persistent connections).

### 4.2 Workflow discovery

Scan a directory for `*.json` files, parse each, validate with
`validateWorkflowIR()`. Invalid files are logged but skipped.

Default discovery path: `examples/workflow/workflows/` (relative to
package). Users can add a custom path via `instanceStorage` later.

```typescript
// workflowDiscovery.ts
export async function discoverWorkflows(
    dir: string,
    registry: TaskRegistry,
): Promise<Map<string, WorkflowIR>> { ... }
```

---

## 5. Action execution

Every `actionName` the LLM can emit is a workflow name. The handler
is a direct lookup:

```typescript
async function executeWorkflowAction(
  action: { actionName: string; parameters?: Record<string, unknown> },
  context: ActionContext<WorkflowAgentContext>,
): Promise<ActionResult> {
  const ir = context.sessionContext.agentContext.workflows.get(
    action.actionName,
  );
  if (!ir) {
    return {
      error: `Unknown workflow '${action.actionName}'.`,
      fallbackToReasoning: true,
    };
  }
  return handleRunWorkflow(ir, action.parameters, context);
}
```

### 5.1 Run workflow

```
1. Look up actionName in the workflows map. If not found, return
   error with fallbackToReasoning: true.
2. Build RunOptions:
   - input: action.parameters (passed through directly;
     the LLM already extracted typed parameters)
   - signal: context.abortSignal
   - policy: all side-effecting tasks set to "prompt"
   - approve: wired to context.sessionContext.popupQuestion()
3. Attach event listener for progress tracking.
4. Call engine.run(ir, options).
5. Return ActionResult with output formatted as markdown.
```

No fuzzy matching needed: the LLM emits the exact `actionName`
string literal from the dynamic schema. Parameters arrive
pre-validated by the LLM translator against the generated types.
The engine still validates against `inputSchema` as a safety net.

---

## 6. Event streaming

The engine emits events (`nodeStarted`, `nodeCompleted`,
`taskError`, `workflowCompleted`). The adapter maps these to
user-visible progress.

### 6.1 Option A: Dynamic display (polling)

Register `getDynamicDisplay()`. The dispatcher polls at
`dynamicDisplayNextRefreshMs` intervals. The adapter accumulates
events in a progress log and returns a formatted display.

Pros: Simple, uses existing infrastructure.
Cons: Polling latency (100-500ms); progress is retrospective.

### 6.2 Option B: Action streaming

Use `streamPartialAction()` to push incremental updates as the
workflow runs.

Pros: Real-time progress.
Cons: More complex wiring; `streamPartialAction` is designed for
token-level streaming, not structured events.

### 6.3 Recommendation

Start with **Option A** (dynamic display). Workflow runs are
typically seconds to minutes; 500ms polling is acceptable. This
avoids overloading the streaming API with a use case it wasn't
designed for.

```typescript
getDynamicDisplay(type, displayId, context) {
    const progress = context.agentContext.activeRuns.get(displayId);
    if (!progress) return { content: "No active run.", kind: "text" };
    return {
        content: formatProgress(progress),
        kind: "markdown",
        nextRefreshMs: progress.done ? 0 : 500,
    };
}
```

---

## 7. Security: task policy bridge

Side-effecting tasks (`shell.exec`, `file.write`) need user approval
in a chat context. The adapter bridges the engine's `approve`
callback to the dispatcher's `popupQuestion()`.

```typescript
approve: async (taskName, resolvedInputs) => {
    const description = formatTaskDescription(taskName, resolvedInputs);
    const choice = await context.sessionContext.popupQuestion(
        `Workflow wants to execute: ${description}`,
        ["Allow", "Deny"],
    );
    return choice === 0; // 0 = "Allow"
},
```

All side-effecting tasks default to `"prompt"` policy in the chat
context. The CLI can still use `"allow"` for unattended execution.

---

## 8. Manifest

```json
{
  "emojiChar": "🔄",
  "description": "Run, list, and inspect developer workflows",
  "schema": {
    "description": "Workflow agent for running automated developer workflows",
    "originalSchemaFile": "./workflowSchema.ts",
    "schemaFile": "../dist/workflowSchema.pas.json",
    "schemaType": "WorkflowAction"
  }
}
```

The static schema provides the type name for `asc` compilation.
`getDynamicSchema()` replaces it entirely at runtime with
per-workflow actions.

---

## 9. Build integration

The adapter needs `asc` (action schema compiler) to compile
`workflowSchema.ts` into `workflowSchema.pas.json`.

```json
// package.json (scripts excerpt)
{
  "asc": "asc -i ./src/workflowSchema.ts -o ./dist/workflowSchema.pas.json -t WorkflowAction",
  "build": "concurrently npm:tsc npm:asc"
}
```

No grammar file (`.agr`). The LLM matches on the generated
TypeScript types, which include action names, parameter names, and
description comments. Per-workflow typed parameters give the LLM
enough signal; a grammar would add maintenance cost without clear
benefit.

---

## 10. Implementation sequence

| Step | Task                                  | Notes                                                |
| ---- | ------------------------------------- | ---------------------------------------------------- |
| 1    | Scaffold `examples/workflow/adapter/` | package.json, tsconfig, directory structure          |
| 2    | Write `workflowSchema.ts`             | Placeholder union type for `asc` compilation         |
| 3    | Write `workflowDiscovery.ts`          | Scan dir, parse, validate                            |
| 4    | Write `generateSchema.ts`             | JSON Schema -> TypeScript source text generation     |
| 5    | Write `workflowActionHandler.ts`      | `instantiate()`, `executeAction`, `getDynamicSchema` |
| 6    | Write `workflowManifest.json`         | Manifest with schema references                      |
| 7    | Build and verify schema compilation   | `asc` produces valid `.pas.json` for base schema     |
| 8    | Register in `config.json`             | Add `"workflow"` entry                               |
| 9    | Unit test schema generation           | Verify generated TS for known workflow inputSchemas  |
| 10   | Integration test with shell           | Manual: chat invocation end-to-end                   |

---

## 11. Resolved decisions

1. **Workflow directory**: Hard-coded path to
   `examples/workflow/workflows/` (relative to package). Add
   configurable paths via `instanceStorage` later if needed.

2. **Workflow-as-action**: Each workflow is a distinct action type
   with typed parameters, generated at runtime via
   `getDynamicSchema()`. No fuzzy name matching needed: the LLM
   emits the exact `actionName` from the generated schema.
   Follows the ScriptFlow pattern.

3. **No grammar file**: Schema-only matching. The generated
   TypeScript types with descriptions give the LLM enough signal.
   Grammar can be added later if matching proves insufficient.

4. **Multi-workflow runs**: Deferred. The dispatcher's reasoning
   loop already handles multiple actions per turn. Eventually,
   the reasoning loop may emit workflows directly, so no need
   to add array support in the action schema.

5. **Workflow output as entity**: Deferred. Output is returned as
   `displayContent` only. Entity registration can be added when
   there is a concrete downstream use case.

---

## 12. Risks

- **Side-effect approval UX**: `popupQuestion()` for each
  side-effecting task step could be chatty for workflows with many
  shell/file operations. Mitigation: add "allow all for this run"
  option later, or batch approval.

- **Workflow errors in chat**: Engine errors (missing task, invalid
  input, task failure) must produce clear, actionable error messages
  in the chat context, not raw stack traces. The adapter formats
  `RunResult.error` into markdown.

- **Schema size with many workflows**: Each workflow adds a type
  definition to the dynamic schema. With dozens of workflows, the
  schema text sent to the LLM grows. Mitigation: unlikely to be a
  problem at current scale (4 workflows); can filter to
  enabled-only or paginate later.
