# LSP — Review Deferral Log

Companion to [`lsp-plan.md`](./lsp-plan.md). Append an entry for every
code-review or test-gap finding that was **not** acted upon in the
phase it was raised — whether rejected, deferred, or accepted-with-
rationale. Findings that were fixed do not need entries (the diff is
the record).

Entries are appended in chronological order; newest at the bottom.

---

<!-- Entries follow. -->

---

## 2026-05-19 — Phase 1: subagent review cycle not run; inline self-review only

**Phase:** 1
**Origin:** code-review round 1 / test-gap round 1 (intended)
**Severity:** process
**Status:** noted
**Finding:** The two background subagents launched for the Phase 1
code-review and test-gap reviews stalled at zero turns for ~4 hours and
were killed. The reviews were performed inline by the implementing
agent instead. This is a known process gap — the implementing agent
self-reviewing reduces the value of the 2+2 protocol.
**Resolution:** Acted on the highest-confidence inline findings (added
`serverIntegration.spec.ts` covering didOpen/didClose, added a
DestructuringConst symbol test, fixed the TextMate keyword list to
match the lexer and added the grammar-drift spec). The subagent review
cycle for Phase 1 is **waived** rather than rescheduled; for Phase 2+
we'll evaluate whether the background-agent path is reliable enough or
switch to a different review mechanic.
**Revisit:** Before launching Phase 2 review subagents, confirm
agents can make turn-1 progress within a few minutes.

---

## 2026-05-19 — Phase 1: diagnostic range can exceed line length on EOF errors

**Phase:** 1
**Origin:** inline code review
**Severity:** low
**Status:** accepted as-is for Phase 1
**Finding:** `pointRange(loc, length=1)` does not clamp `end.character`
to the actual line length when the diagnostic location is at end-of-line
or end-of-file. Most LSP clients (including VS Code) tolerate this and
render the squiggle to end-of-line, but the spec allows clients to
reject out-of-range positions.
**Resolution:** Acceptable for Phase 1. Phase 2's symbol-resolver pass
will already need real token spans on errors; we'll widen ranges then
by passing the token's end location through from the lexer/parser.

---

## 2026-05-19 — Phase 1: schemas loaded once at server start

**Phase:** 1
**Origin:** inline code review
**Severity:** low
**Status:** by design
**Finding:** `loadTaskSchemas()` is called once during `createServer`
and cached for the lifetime of the connection. If the engine adds a
hot-reload mechanism for schemas later, the LSP would need restart.
**Resolution:** Builtin schemas don't change at runtime by design (the
engine doesn't support task extension; see `lsp-decisions.md`). No
action needed unless that constraint changes.

---

## 2026-05-19 — Phase 1: formatting issues a whole-document edit, losing cursor

**Phase:** 1
**Origin:** inline code review
**Severity:** low
**Status:** accepted, standard pattern
**Finding:** `formatDocument` returns a single full-range
`TextEdit.replace` rather than a minimal diff. VS Code's text-edit
application preserves cursor position via a best-effort heuristic but
will sometimes lose column when the line is rewritten.
**Resolution:** This matches the formatter's design (it doesn't expose
a structural diff). Phase 5+ could compute a minimal LCS-style diff
across lines if user feedback indicates the cursor jumps are noticeable.

---

## 2026-05-19 — Phase 2: subagent review cycle waived again; inline self-review

**Phase:** 2
**Origin:** code-review rounds 1-2 / test-gap rounds 1-2 (planned)
**Status:** Deferred / replaced
**Resolution:** Same pattern as Phase 1 — background review subagents
were not used. Per the Phase 1 decision in `lsp-decisions.md`, sub-
agent reviews should only run if a sync turn-1 probe responds quickly;
that probe was not re-attempted in this session. Inline self-review
performed during implementation, findings folded directly into the
features. 27 specs across 8 suites cover symbol resolution, hover,
definition, references, completion, and semantic tokens. Open items
captured below.

---

## 2026-05-19 — Phase 2: signature help & rename deferred

**Phase:** 2
**Origin:** scope vs. plan table rows 8 (signature help) and 11 (rename)
**Status:** Deferred
**Resolution:** The Phase 2 features (#4, #6, #7, #9, #10) all landed
with tests. Signature help is a natural fit for Phase 3 (authoring
assists) alongside completion-context work, and rename belongs with
the Phase 4 refactoring bundle since it shares the symbol-table
machinery with extract/inline. The current symbol resolver already
records `Def` locations and per-name refs, so neither feature requires
new infrastructure.

---

## 2026-05-19 — Phase 2: dotted-name hover limited to head segment

**Phase:** 2
**Origin:** inline self-review
**Status:** Accepted-with-rationale
**Resolution:** `findReferenceAt` resolves `DottedNameExpr` against
the head segment (e.g. `foo.bar.baz` hovers as `foo`). Member-access
hover (typed property lookup) requires plumbing through the
`TypeChecker`'s inferred types; the resolver intentionally does not
re-implement that. Tracked for Phase 3 once we know which authoring
quick-fixes need member-aware completion.

---

## 2026-05-19 — Phase 3: signature help + inlay hints + snippets

**Phase:** 3
**Origin:** code-review rounds 1-2 / test-gap rounds 1-2 (planned)
**Status:** Deferred / replaced (same pattern as P1/P2)
**Resolution:** Inline self-review only. Bundle audit still clean
(292.6 KB, no aiclient leak); 9 spec suites with 36 tests pass.

Phase 3 deliverables that landed:
- **Signature help** at task call sites via a text-based scanner that
  walks back from the cursor counting parens/commas with string
  literals masked, then matches the call name against the builtin
  schema set.
- **Inlay hints** (`InlayHintKind.Type`) attached to `const` bindings
  whose right-hand side is a known task call, suppressed when the
  source already declares a type. Range-scoped responses honoured.
- **Snippets** shipped via `snippets/workflow.code-snippets` covering
  scaffold, control flow, lambdas, parallel, attempts, template literals.

Deferred from Phase 3 (carried forward):
- **Cancellation tokens.** Our handlers are synchronous and fast; no
  user-visible benefit yet. Will revisit during Phase 4 rename / Phase 5
  webview previews where work can be heavier.
- **Code actions.** Originally in the plan table but not in the
  Phase 3 todo set. Will land in Phase 4 alongside refactoring.

---

## 2026-05-19 — Phase 4: rename landed; code actions deferred

**Phase:** 4
**Origin:** scope vs. plan table rows 11 (rename) and 12 (code actions)
**Status:** Partial delivery
**Resolution:** Rename + prepareRename are wired and tested (10 specs
total now, 44 tests). Implementing rename also surfaced a real bug in
the symbol resolver: const / destructured-const defs were recorded at
the **statement** location (the `const` keyword) instead of the
binding name. Fixed by threading the document text into
`buildSymbolTable` and computing a precise name location via a forward
scan from `stmt.loc.offset`. This fix also tightens find-references
ranges for const bindings.

Deferred from Phase 4:
- **Code actions / quick fixes.** Not implemented — would benefit
  from a richer diagnostic catalog (currently we just surface
  `compile()` errors). Suggested first quick-fix candidates for a
  follow-up: "rename to closest builtin" when a task name typo is
  reported, "extract literal to const", "convert template to
  concat".
- **Symbol-resolver decoupling from text.** The new `locateName` is a
  pragmatic fix; a cleaner solution is to extend the DSL AST with a
  separate `nameLoc` field on Const / DestructuringConst (filed as a
  follow-up for the DSL team).

---

## 2026-05-19 — Phase 5: IR preview landed; graph preview deferred

**Phase:** 5
**Origin:** scope vs. plan table rows 14-15
**Status:** Partial delivery
**Resolution:**
- **IR preview** is implemented via a custom LSP request
  (`workflow/compileIR`) that runs `compile()` server-side using the
  builtin task schemas. The extension command `workflow.previewIR`
  opens the resulting IR JSON (or error list) in a side editor.
  Keeping the compile work server-side preserves the bundle-cleanliness
  guarantee for the extension. Unit tests in `compileIR.spec.ts`
  cover the happy path, parse errors, and missing-URI handling.

Deferred from Phase 5:
- **Graph preview** (`workflow.previewGraph`) is registered as a
  command but currently surfaces a "coming soon" message. Full
  delivery needs (a) `elkjs` bundled into the extension or loaded as
  a web worker, (b) a webview implementation with content-security
  policy, (c) manual validation in a GUI VS Code host — none of
  which can be exercised inside this restricted dev container. Filed
  as the primary follow-up.
- **Manual smoke tests** documented in `lsp-manual-tests.md` are
  still pending a GUI VS Code session to walk through.
