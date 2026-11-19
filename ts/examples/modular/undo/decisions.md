# Undo list: decisions

Phase 1 decisions, agreed with the human. The design is `list.ts` and
`list.vocab.ts`; the starting prose is `brief.md`.

- 2026-11-19: one interface, `List`, with `add(index, text)`,
  `remove(index)`, `replace(index, text)`, `undo()`, `redo()`,
  `canUndo`, `canRedo`, and the readers `items`, `length` and
  `get(index)`.
- 2026-11-19: items are addressed by index, not by value (texts may
  repeat) or by identity (no references are held across changes in this
  brief; identity would need IDs and an identity model in proofs).
  Revisit if collaboration or selection comes into scope.
- 2026-11-19: an index outside the list is the caller's fault
  (`@requires in-range`), so errors stay out of the design for now.
- 2026-11-19: undo with nothing to undo, and redo with nothing to redo,
  change nothing, until error behavior is designed.
- 2026-11-19: the history is observable, as `past` and `future` on its
  own interface `UndoHistory`, so each rule is about one call.
- 2026-11-19: the history holds operations, not snapshots. Each entry is
  smaller for a person to read, and the longer rules for undoing each
  kind fall to the AI (`../tool/motivation.md`). Operations also relate
  undo to the collaboration pattern (circles' operations and their
  processor), which is expected to relate strongly to undo and redo.
- 2026-11-19: the laws (an edit then undo restores the items; undo then
  redo restores them when something was undone; items equal past applied
  to the empty list) are to be proved from the rules in phase 1p, not
  stated as rules.
