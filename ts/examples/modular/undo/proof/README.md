# Proofs about the undo list's design

Status: 2026-11-19. Lean 4.36.0, core only (no Mathlib). `typearc check
undo` runs it; by hand, from this directory:

    lean List.lean

`List.lean` translates the rules of `../list.ts` and the vocabulary of
`../list.vocab.ts` by hand; each definition's comment names its source.
The theorems are about the design: they involve no implementation.

## What it proves

| Claim | Theorem |
|---|---|
| The rules are consistent | `consistent` |
| The rules fix the state after every call | `determined` |
| An edit, then undo, restores the items and past | `edit_then_undo` |
| Undo then redo, and redo then undo, restore the whole state | `undo_then_redo`, `redo_then_undo` |
| A reachable state's items are its past applied to the empty list | `reached_reachable` |
| Brief: "every change can be undone … back to the empty list" | `back_to_empty` |
| Brief: "anything undone can be redone until … a new change" | `undo_then_redo`, `change_ends_redo` |
| Forbidden `undo-wrong-order` | `undo_wrong_order` |
| Forbidden `redo-survives-change` | `redo_survives_change` |

The brief's third sentence, "the library can report whether there is
anything to undo or redo", needs no proof: it is the `can-undo` and
`can-redo` invariants themselves.

A forbidden scenario in `../scenarios.ts` counts as proved when a
theorem has its ID, with dashes written as underscores. `check` fails a
proof file that uses `sorry`.

## What the proofs catch that the scenario judge doesn't

Dropping "future is emptied" from add's `records` rule leaves the
scenario judge passing, since the reference still empties it, but makes
`determined` and `redo_survives_change` fail.

## Limit

The translation is by hand. If `list.ts` changed and the translation
didn't, nothing would notice, and the name link can't tell whether a
theorem states its scenario faithfully. Generating the Lean from the
rule expressions would close this; it is open in `../../STATE.md`.
