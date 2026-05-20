# LSP — Manual Test Plan

Scenarios that require a real VS Code window and cannot run in the
restricted dev container. Phase exit does NOT depend on these — they
are a checklist for a future smoke pass in a capable environment.

Each section is appended at the end of the phase that introduces it.

---

## Phase 0 — Scaffolding

**Goal:** confirm the extension activates against a `.wf` file and
spawns the LSP server.

1. Build both packages (`pnpm -w build`).
2. Open `ts/examples/workflow/vscode/` in VS Code.
3. Press F5 to launch an Extension Development Host.
4. In the dev host, open `ts/examples/workflow/dsl/examples/d1-standup-prep.wf`.
5. Check the language mode (bottom-right) shows "Workflow DSL".
6. Open the Output panel → "Workflow DSL Language Server"; confirm the
   server logged `initialized`.
7. Set `workflow.trace.server` to `verbose`; reopen the file; confirm
   `textDocument/didOpen` appears in the trace channel.

---

## Phase 1 — Diagnostics, Formatting, Document Symbols

### 1a — Syntax diagnostics
1. Open `ts/examples/workflow/dsl/examples/d1-standup-prep.wf` in the dev host.
2. Introduce a deliberate error: delete the closing `}` of the workflow body.
3. Confirm a red squiggle appears on the affected line.
4. Hover over the squiggle; confirm the error message describes a parse error.
5. Undo the change; confirm the squiggle disappears within 1 second.

### 1b — Type-check diagnostics
1. In any `.wf` file, add `const x = unknownIdent;`.
2. Confirm a red squiggle appears under `unknownIdent`.
3. Confirm the hover message says the identifier is not defined.

### 1c — Full document formatting
1. Open a `.wf` file and manually mis-indent a line.
2. Run "Format Document" (Shift+Alt+F on Windows/Linux, Shift+Option+F on macOS).
3. Confirm the indentation is restored to canonical 4-space style.
4. Confirm no trailing newline is added/removed unexpectedly.

### 1d — Document symbols
1. Open a multi-step `.wf` workflow.
2. Open the Outline panel (View → Outline).
3. Confirm the workflow name and each `const`/step appear as outline nodes.
4. Click a symbol; confirm the cursor jumps to its definition.

---

## Phase 2 — Hover, Definition, References, Completion, Semantic Tokens

### 2a — Hover
1. Hover over a `const` name (the binding site).
2. Confirm a hover card appears showing the inferred type.
3. Hover over a task call name (e.g., `shell.run`).
4. Confirm the hover card shows the task's input/output schema summary.

### 2b — Go-to-definition
1. Ctrl+click (Cmd+click on macOS) a `const` reference.
2. Confirm the editor jumps to the `const` declaration.
3. Try Ctrl+click on a parameter name inside a nested body.
4. Confirm it jumps to the enclosing workflow's parameter list.

### 2c — Find references
1. Right-click a `const` name → "Find All References".
2. Confirm the References panel lists all usage sites.
3. Confirm the declaration is included when "Include Declaration" is checked.

### 2d — Completion
1. In a workflow body, type `shell.` and wait for suggestions.
2. Confirm the list contains only `shell.*` task names.
3. Type `const x = ` and press Ctrl+Space.
4. Confirm the list contains in-scope const/param names plus DSL keywords.

### 2e — Semantic tokens
1. Open a `.wf` file with syntax highlighting enabled.
2. Confirm `const` names are coloured differently from task call names.
3. Confirm parameter names inside `(param: type)` use the parameter colour.

---

## Phase 3 — Signature Help, Inlay Hints, Snippets

### 3a — Signature help
1. In a workflow body, type `shell.run(` (opening paren).
2. Confirm a signature help tooltip appears listing the task's parameters.
3. Type a comma; confirm the tooltip advances to highlight the next parameter.
4. Press Escape; confirm the tooltip closes.

### 3b — Inlay hints
1. Open a `.wf` file with a task call that has named parameters.
2. Confirm inlay hints show the parameter names before each positional argument.
3. Open VS Code settings and set `editor.inlayHints.enabled` to `off`.
4. Confirm the hints disappear.

### 3c — Snippets
1. In a `.wf` file, type `wf` and press Tab.
2. Confirm a `workflow Name(param: type): ReturnType { ... }` scaffold is inserted.
3. Confirm tab-stops cycle through `Name`, `param`, `type`, `ReturnType`.

---

## Phase 4 — Rename

### 4a — Basic rename
1. Place the cursor on a `const` binding name.
2. Press F2; type a new name; press Enter.
3. Confirm all references in the file are renamed.
4. Confirm the declaration site is also renamed.

### 4b — Rename conflict
1. Try to rename a `const` to a name that is already in scope.
2. Confirm the rename either fails with an error message or shows a warning.

### 4c — Prepare-rename on keyword
1. Place the cursor on the keyword `const` (not a name).
2. Press F2.
3. Confirm VS Code shows an error: "Cannot rename this element."

### 4d — Prepare-rename on task call
1. Place the cursor on a task name like `shell.run`.
2. Press F2.
3. Confirm VS Code shows an error (built-in tasks are not renameable).

---

## Phase 5 — IR Preview, Graph Preview

### 5a — Preview IR (happy path)
1. Open a valid `.wf` file.
2. Run command "Workflow: Preview IR" (Ctrl+Shift+P → type "Preview IR").
3. Confirm a new editor tab opens showing JSON.
4. Confirm the JSON contains a `steps` array.

### 5b — Preview IR (error path)
1. Introduce a type error in the `.wf` file (e.g., wrong number of arguments).
2. Run "Workflow: Preview IR".
3. Confirm the JSON tab shows an `errors` array with a descriptive message.

### 5c — Preview IR live refresh
1. Open a valid `.wf` file and run "Workflow: Preview IR".
2. Note the number of steps in the JSON.
3. Add a new task call to the `.wf` file and save (Ctrl+S).
4. Confirm the IR preview tab content refreshes automatically.

### 5d — Preview Graph
1. Run "Workflow: Preview Graph".
2. Confirm an information message appears: "Workflow graph preview is coming in a follow-up release."
3. Confirm no error is thrown in the Output panel.
