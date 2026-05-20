# LSP — Review Deferral Log

Companion to [`lsp-plan.md`](./lsp-plan.md). Append an entry for every
code-review or test-gap finding that was **not** acted upon in the
phase it was raised — whether rejected, deferred, or accepted-with-
rationale. Findings that were fixed do not need entries (the diff is
the record).

Entries are appended in chronological order; newest at the bottom.
Resolved entries are pruned from this log once the fix lands — the
diff is the record.

---

<!-- Entries follow. -->

---

## 2026-05-19 — Phase 1: diagnostic range can exceed line length on EOF errors

**Phase:** 1
**Origin:** inline code review
**Severity:** low
**Status:** Still open (audited 2026-05-20)
**Finding:** `pointRange(loc, length=1)` does not clamp `end.character`
to the actual line length when the diagnostic location is at end-of-line
or end-of-file. Most LSP clients (including VS Code) tolerate this and
render the squiggle to end-of-line, but the spec allows clients to
reject out-of-range positions.
**Resolution:** Acceptable for Phase 1. The original plan was for the
Phase 2 symbol-resolver pass to widen ranges using real token spans;
that did not happen. `util/position.ts:40` remains unchanged. Low
priority follow-up: clamp `end.character` to the document line length.

---

## 2026-05-19 — Phase 1: schemas loaded once at server start

**Phase:** 1
**Origin:** inline code review
**Severity:** low
**Status:** By design (still applies)
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
**Status:** Accepted, standard pattern (still applies)
**Finding:** `formatDocument` returns a single full-range
`TextEdit.replace` rather than a minimal diff. VS Code's text-edit
application preserves cursor position via a best-effort heuristic but
will sometimes lose column when the line is rewritten.
**Resolution:** This matches the formatter's design (it doesn't expose
a structural diff). A future iteration could compute a minimal
LCS-style diff across lines if user feedback indicates the cursor
jumps are noticeable.

---

## 2026-05-19 — Phase 2: dotted-name hover limited to head segment

**Phase:** 2
**Origin:** inline self-review
**Status:** Accepted-with-rationale (still applies)
**Resolution:** `findReferenceAt` resolves `DottedNameExpr` against
the head segment (e.g. `foo.bar.baz` hovers as `foo`). Member-access
hover (typed property lookup) requires plumbing through the
`TypeChecker`'s inferred types; the resolver intentionally does not
re-implement that. Revisit if user feedback wants member-aware hover.

---

## 2026-05-19 — Phase 4: symbol-resolver decoupling from text

**Phase:** 4
**Origin:** scope vs. plan table row 11 (rename)
**Status:** Still open (DSL-team follow-up)
**Resolution:** The `locateName` text scan in `symbolResolver.ts` is a
pragmatic fix for recording precise name locations on const /
destructured-const definitions. The cleaner solution is to extend the
DSL AST with a separate `nameLoc` field on `Const` /
`DestructuringConst` so the LSP doesn't need the document text to
compute symbol ranges. Filed as a follow-up for the DSL team.

---

## 2026-05-19 — Phase 5: graph preview + manual smoke tests deferred

**Phase:** 5
**Origin:** scope vs. plan table rows 14-15
**Status:** Still open (environment-constrained)
**Resolution:**

- **Graph preview** (`workflow.previewGraph`) is registered as a
  command but currently surfaces a "coming soon" message. Full
  delivery needs (a) `elkjs` bundled into the extension or loaded as
  a web worker, (b) a webview implementation with content-security
  policy, (c) manual validation in a GUI VS Code host — none of
  which can be exercised inside this restricted dev container.
  Formally captured as a container-constrained deferral in
  `lsp-decisions.md` ("Graph preview deferred"). Revisit when running
  in a full devcontainer.
- **Manual smoke tests** documented in `lsp-manual-tests.md` are
  still pending a GUI VS Code session to walk through; same
  environment dependency.

---

## 2026-05-20 — Open follow-ups snapshot

After pruning resolved entries, the live follow-ups are:

| #   | Item                                                   | Notes                               |
| --- | ------------------------------------------------------ | ----------------------------------- |
| 1   | `pointRange` line-length clamp                         | `util/position.ts:40`; low priority |
| 2   | Dotted-name hover beyond head segment                  | only if user feedback requests it   |
| 3   | DSL AST `nameLoc` field on Const / DestructuringConst  | cross-team ask                      |
| 4   | Graph preview webview + `elkjs` bundling               | needs GUI dev host                  |
| 5   | Manual smoke-test walkthrough of `lsp-manual-tests.md` | needs GUI VS Code session           |
