# LSP — Design Decisions Log

Companion to [`lsp-plan.md`](./lsp-plan.md). Append an entry for every
non-obvious design choice, wrong initial assumption that needed change,
or solution with viable alternatives worth revisiting. Fixed bugs and
straightforward implementation choices do NOT need entries — the diff
is the record.

Entries are appended in chronological order; newest at the bottom.

---

## Update: @vscode/test-electron scaffolding added (still gated on display)

**Phase:** 0/5
**Status:** scaffolding landed, execution still env-gated
**Context:** Earlier decision deferred adding the harness at all. The
follow-up plan called for landing the runner + a single smoke test so
that developers with a GUI VS Code host (or a CI runner with `xvfb`)
can run it without further setup.
**Decision:** Add `@vscode/test-electron`, `mocha`, and `glob` as
dev-dependencies; create `src/test/runTests.ts`,
`src/test/suite/index.ts`, and `src/test/suite/extension.test.ts`
(activation + command-registration smoke); add `test:e2e` script;
replace the previous error-stub `scripts/extension-test.sh` with a
thin wrapper that fails loudly if `DISPLAY` is missing on Linux.
**Revisit when:** A CI job adds `xvfb-run` so this can run on every
PR — at that point promote it from manual to required.

