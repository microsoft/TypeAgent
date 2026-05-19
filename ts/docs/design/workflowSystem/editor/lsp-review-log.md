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
