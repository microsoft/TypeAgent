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
- 2026-11-19: the first scenarios (`scenarios.ts`): allowed
  `edit-then-undo`, `undo-to-empty` (over every list of texts),
  `redo-after-undo`, `new-change-clears-redo` and `undo-nothing`;
  forbidden `undo-wrong-order` and `redo-survives-change`, to be proved
  in `proof/List.lean`. The reference that `typearc check` judges them on
  is `listkit.ts`, built from the vocabulary's `apply` and `unapply`.
- 2026-11-19: phase 1p, `proof/List.lean` (Lean 4, core only; `typearc
  check` runs it). The rules are consistent (`consistent`) and fix the
  state after every call (`determined`). The laws hold: an edit then undo
  restores the items and past (`edit_then_undo`); undo then redo, and
  redo then undo, restore the whole state (`undo_then_redo`,
  `redo_then_undo`); every reachable state's items are its past replayed
  on the empty list (`reached_reachable`). The brief's sentences: "back
  to the empty list" (`back_to_empty`), "redone until a new change"
  (`undo_then_redo` and `change_ends_redo`); "report whether there is
  anything to undo or redo" is the can-undo and can-redo invariants
  themselves. The forbidden scenarios are theorems with their names
  (`undo_wrong_order`, `redo_survives_change`). The translation is by
  hand: dropping "future is emptied" from add's `records` makes
  `determined` and `redo_survives_change` fail, as it should, but a
  translation that drifted from list.ts would not be noticed.
- 2026-11-19: seven adversaries (`adversaries/`), each a real fault:
  add appends; add keeps future; remove forgets its text; undo of a
  replace keeps the new text; redo from the end of future; a stale
  canUndo; get off by one. The history generator catches all seven on
  seeds 1 to 3. Redo from the end needs two undone changes before a
  redo, which short histories rarely reach; full-length histories and
  methods weighted above reads fixed that, with no undo-specific code.
