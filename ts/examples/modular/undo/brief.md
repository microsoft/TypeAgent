# Undo list: the brief

Agreed 2026-11-19. This is the project's starting prose: the input to
phase 1, and, unchanged, the prose given to the vibe-coding workflow and
to a plain coding loop, so that their implementations can be compared.

> **Undo list.** A small library that keeps an ordered list of text items
> and lets the user undo and redo their changes. A user can add an item
> at any position, remove an item, and replace an item's text. Every
> change can be undone, in reverse order, back to the empty list;
> anything undone can be redone until the user makes a new change. The
> library can report whether there is anything to undo or redo. It's for
> one user in one process, with no saving to disk and no collaboration.
> Only the library is in scope: apps built on it, and any user
> interface, are not.
