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

## 2026-05-20 — Open follow-ups snapshot (updated)

| #   | Item                                                   | Notes                             |
| --- | ------------------------------------------------------ | --------------------------------- |
| 1   | Dotted-name hover beyond head segment                  | only if user feedback requests it |
| 3   | Manual smoke-test walkthrough of `lsp-manual-tests.md` | still needs GUI VS Code session   |

---

## 2026-05-20 — Open follow-ups from `workflow/previewGraph` + extension wiring review

Two rounds of code review and two rounds of test-gap analysis over the
graph-preview LSP request, the webview renderer, the `LogOutputChannel`
wiring, and the `@vscode/test-electron` scaffolding. Items below were
**not** acted on and remain open:

1. **No DOM/JSDOM unit test for the inline webview layout JS.** The
   `RENDER_SCRIPT` template literal is dead-code from the host's
   perspective and is only exercised end-to-end. Extract the layered
   layout into a pure function and unit-test it with `jsdom` if the
   layout grows past trivial.
2. **Magic-string LSP method names** (`workflow/previewGraph`,
   `workflow/compileIR`) duplicated between server and extension.
   Both sides are covered by integration tests, so the typo risk is
   small; revisit if a third caller appears.
3. **`localResourceRoots: []` + `retainContextWhenHidden: true`**
   trade memory for snappier panel re-show. Audit if users routinely
   keep many graph panels open per session.
4. **O(n²) `Array.find` calls in the webview layout** (`g.params.find`,
   `g.groups.find` inside loops). Acceptable below ~50 nodes; if a
   real workflow hits that, pre-index into Maps.
5. **No cancellation token support in `previewGraph` / `compileIR`.**
   Rapid saves enqueue requests; the most recent always wins so this
   is rarely user-visible. Pass through `CancellationToken` if/when
   long-running passes are added (e.g. typechecker for IR).
6. **CSP uses `'unsafe-inline'` for styles.** The `<style>` block is
   constant per panel and contains no user data, but using a nonce
   would tighten the policy.
7. **No e2e test that `workflow.previewIR` / `workflow.previewGraph`
   actually open their previews.** The Mocha suite only asserts
   command registration. Add behavioral tests once a CI runner with
   `xvfb-run` is wired up.
8. **`RENDER_SCRIPT` lives as a giant `String.raw` template literal
   in `graphPreview.ts`.** Maintenance pain past ~150 lines. Move to
   a sibling `.webview.js` loaded via `webview.asWebviewUri` when the
   renderer grows.
9. **`previewGraph` handler re-lexes/re-parses on every call** instead
   of reusing the `parsedDocument` cache shared by hover / completion.
   Cheap in practice; cache only stores errors implicitly by AST
   presence, which doesn't surface lex errors to the handler today.
10. **No test for `workflow/previewGraph` against an unopened URI in
    `serverIntegration.spec.ts`.** That path is covered in the unit
    spec; not strictly necessary at the JSON-RPC level.

