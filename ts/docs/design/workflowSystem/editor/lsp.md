# Workflow DSL — Language Service Architecture

> This document describes the implementation that lives in
> `ts/examples/workflow/lsp/` and `ts/examples/workflow/vscode/`.

---

## Design Rationale

**LSP, not in-process.** The server runs as a separate Node process
communicating over stdio (JSON-RPC). This lets any LSP-capable editor
(Neovim, Zed, IntelliJ, ...) reuse the server without any VS Code
dependency. The VS Code extension is a thin client that spawns the
server and provides static resources (grammar, snippets, icon).

**Server is bundle-only.** The extension bundles `dist/server.js` via
esbuild; the server is not published to npm or the VS Code Marketplace.
Standalone install for other editors is a future task; the server stays
architecturally decoupled so that path is straightforward.

---

## Packages

```
ts/examples/workflow/
├── dsl/          ← workflow-dsl: lexer, parser, type-checker, formatter, compiler
├── engine/       ← workflow-engine: task registry (aiclient dependency)
│   └── src/builtinTaskSchemas.ts  ← schemas-only export (no aiclient)
├── lsp/          ← workflow-lsp: standalone LSP server (this package)
│   ├── src/
│   │   ├── server.ts             ← entry; wires all feature handlers
│   │   ├── parsedDocument.ts     ← version-keyed lex+parse cache
│   │   ├── symbolResolver.ts     ← symbol table (TypeChecker doesn't expose one)
│   │   ├── taskSchemas.ts        ← loads builtinTaskSchemas; future: watch setting
│   │   ├── features/             ← one file per LSP feature
│   │   └── util/position.ts      ← DSL SourceLocation ↔ LSP Position/Range
│   └── test/                     ← Jest; in-process stream transport
└── vscode/       ← workflow-vscode: thin VS Code extension
    ├── src/extension.ts          ← activates LanguageClient, registers commands
    ├── syntaxes/workflow.tmLanguage.json  ← TextMate grammar
    ├── snippets/workflow.json    ← code snippets
    └── icons/wf.svg              ← file icon
```

---

## Data Flow

### Text-change → diagnostics

```
editor keystroke
  → textDocument/didChange (JSON-RPC)
  → server.ts: documents.onDidChangeContent
      → invalidate(uri)            clears parsedDocument cache
      → scheduleDiagnostics(uri)   100ms debounce
          → computeDiagnostics(text, schemas)
              → lex()  parse()  TypeChecker.check()
          → connection.sendDiagnostics(...)
```

### Hover / definition / completion / …

```
cursor move / trigger character
  → textDocument/hover (JSON-RPC)
  → server.ts: connection.onHover
      → documents.get(uri)         TextDocument (raw text + version)
      → computeHover(doc, pos, schemas)
          → getParsed(doc)         version-keyed cache:
              if cache stale → lex() + parse() + buildSymbolTable()
          → findReferenceAt(symbols, line, col)
          → construct Hover response
```

### Document cache (`parsedDocument.ts`)

The cache stores one `ParsedDocument` per URI keyed on the document
version. On every `didChange` the version increments, so the next
feature handler triggers a fresh lex+parse+symbol-table pass. The
last-good AST is preserved even if the new text has parse errors, so
features like hover continue working during incremental editing.

```typescript
interface ParsedDocument {
  version: number;
  text: string;
  tokens: Token[];
  comments: LexComment[];
  ast?: WorkflowDecl; // absent on parse error
  symbols?: SymbolTable; // absent if ast is absent
  propertyRefs?: PropertyRef[]; // cached by semanticTokens; lazy
}
```

---

## Symbol Table (`symbolResolver.ts`)

The DSL `TypeChecker` does not expose its internal `Scope`. The LSP
maintains its own symbol table built by a single AST walk:

```typescript
interface SymbolTable {
  defs: SymbolDef[]; // const / param / lambdaParam definitions
  refs: SymbolRef[]; // references to consts / params
  taskRefs: TaskRef[]; // task-call nodes
}
```

`buildSymbolTable(wf, text?)` takes the optional source text to
locate precise binding-name positions (the DSL's `ConstStatement.loc`
points to the `const` keyword; the actual name is scanned forward).

---

## Feature Inventory

| Feature            | LSP method                              | Source file                  |
| ------------------ | --------------------------------------- | ---------------------------- |
| Diagnostics        | `textDocument/publishDiagnostics`       | `features/diagnostics.ts`    |
| Formatting (full)  | `textDocument/formatting`               | `features/formatting.ts`     |
| Formatting (range) | `textDocument/rangeFormatting`          | `features/formatting.ts`     |
| Document symbols   | `textDocument/documentSymbol`           | `features/symbols.ts`        |
| Hover              | `textDocument/hover`                    | `features/hover.ts`          |
| Go-to-definition   | `textDocument/definition`               | `features/definition.ts`     |
| Find references    | `textDocument/references`               | `features/references.ts`     |
| Completion         | `textDocument/completion`               | `features/completion.ts`     |
| Signature help     | `textDocument/signatureHelp`            | `features/signatureHelp.ts`  |
| Inlay hints        | `textDocument/inlayHint`                | `features/inlayHints.ts`     |
| Semantic tokens    | `textDocument/semanticTokens/full`      | `features/semanticTokens.ts` |
| Rename             | `textDocument/rename` + `prepareRename` | `features/rename.ts`         |
| Code actions       | `textDocument/codeAction`               | `features/codeActions.ts`    |

### Rename scope rules

`prepareRename` rejects the request when the cursor is on a built-in
task name, a namespace token (e.g. `shell`, `string`), or a keyword.
The rename walks the symbol table and updates:

- All `SymbolRef` entries whose `defOffset` matches the target definition.
- Identifiers inside template-literal `${...}` substitutions.
- Lexically scoped shadowing is respected: renaming an inner `const`
  does not touch an outer `const` with the same name.
  | IR preview | `workflow/compileIR` (custom) | `features/compileIR.ts` |
  | Graph preview | `workflow/previewGraph` (custom) | `features/previewGraph.ts` |

---

## Extension Points

### Task schema loading

`taskSchemas.ts` exports `loadTaskSchemas(): TaskSchema[]`. Currently
it always returns the static builtin set from `workflow-engine/schemas`.
A future revision will resolve a `workflow.taskSchemas` workspace
setting (glob of JSON schema files) and watch for changes, letting
users register project-local tasks without modifying the engine.

### Custom LSP requests

The server registers two custom requests:

- **`workflow/compileIR`** — compiles the named `.wf` URI and returns
  `{ ir, errors }`. The VS Code extension uses this for the
  "Preview IR" command. Any LSP-capable editor can invoke the same
  request.
- **`workflow/previewGraph`** — returns `{ graph?: GraphModel, errors }`
  for the named `.wf` URI. The VS Code extension renders the graph as
  inline SVG in a webview (layered top-down layout). A real layout
  engine (`elkjs`, `dagre`, …) was considered and deferred — revisit
  if graphs routinely exceed ~30 nodes or routing becomes a complaint.

---

## VS Code Extension (`workflow-vscode`)

The extension is intentionally thin: it starts the LSP server and
contributes static resources (grammar, snippets, file icons). No
language logic lives in the extension itself.

### Activation

```
package.json: "activationEvents": ["onLanguage:workflow"]
  → extension.ts: activate()
      → LanguageClient.start()   spawns dist/server.js via IPC
      → registers workflow.previewIR command
      → registers workflow.previewGraph command
      → registers workflow.showServerOutput command
```

### IR Preview live refresh

When a `.wf` document is saved and an IR preview tab is already open,
`workspace.onDidSaveTextDocument` re-sends `workflow/compileIR` and
replaces the tab content. The tab URI uses `untitled:workflow-ir` so
the same document object is reused across saves.

---

## Testing Strategy

| Layer                     | Tool                       | Location                                               |
| ------------------------- | -------------------------- | ------------------------------------------------------ |
| Feature unit tests        | Jest (ESM)                 | `lsp/test/*.spec.ts`                                   |
| In-process integration    | Jest + PassThrough streams | `lsp/test/serverIntegration.spec.ts`                   |
| Grammar / lexer snapshots | Jest snapshot              | `lsp/test/grammar.spec.ts`                             |
| Cancellation behaviour    | Jest                       | `lsp/test/cancellation.spec.ts`                        |
| Extension UI tests        | `@vscode/test-electron`    | `vscode/src/test/`, `vscode/scripts/extension-test.sh` |

Coverage thresholds (v8): branches 60%, functions/lines/statements 70%.

---

## Known Limitations / Deferred Work

- **Graph layout** — uses an inline layered top-down algorithm. Revisit
  a real layout engine (e.g. `elkjs` or `dagre`) if workflows routinely
  exceed ~30 nodes or users ask for cleaner edge routing.
- **Incremental re-parse** — currently re-lexes and re-parses the full
  document on every change. For very large `.wf` files a tree-sitter
  incremental parse would be faster. Not a bottleneck for current file
  sizes.
- **Task schema live reload** — `workflow.taskSchemas` glob is read
  once at startup. A `FileSystemWatcher` is planned but not yet wired.
- **`builtinTaskSchemas.ts` sync** — schemas are duplicated between
  `builtinTasks.ts` and `builtinTaskSchemas.ts`; a jest spec asserts
  parity. A future cleanup can generate one from the other.

---

## Out of Scope

- **Debugger / DAP integration** — running and stepping through
  workflows inside the editor. No timeline.
- **Visual graph editor** — the graph preview is read-only. An
  interactive drag-and-drop editor is tracked separately in
  `docs/design/workflowSystem/editor/plan.md`.
- **Workspace-wide refactors** — cross-file go-to-definition,
  workspace rename, etc. The v0.1 DSL is single-file; revisit when
  the language gains imports.
- **Marketplace publishing** — the extension is distributed as a
  `.vsix` for internal use only.
