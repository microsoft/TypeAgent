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
- 2026-11-19: phase 1p also checks the brief's sentences against the
  rules (`../tool/elements.md`, "Checking prose against the rules"):
  - "Every change can be undone, in reverse order, back to the empty
    list": from any state reached from a new list, `past.length` undos
    leave the items empty (needs the law that the items equal past
    applied to the empty list), and each undo reverses `last(past)`.
  - "Anything undone can be redone until the user makes a new change":
    two readings. Redo stays available until a new change (from the
    `records` rules, which empty `future`), and redo restores the state
    before the undo (the undo-then-redo law).
  - "The library can report whether there is anything to undo or redo":
    from the `can-undo` and `can-redo` invariants.
  - "One user in one process", "no saving to disk", and what is in
    scope: unchecked.
  The rule headlines are checked the same way: for example, "with
  nothing in past, changes nothing" on `undoes` follows from its
  expression, since `last([])` is undefined and `unapply` leaves the
  items unchanged.
