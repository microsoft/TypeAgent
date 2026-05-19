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
