---
layout: docs
title: Shell Keyboard Shortcuts
---

The TypeAgent Shell supports the following keyboard shortcuts in the
chat input.

## Submitting and editing input

| Shortcut          | Action                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| **Enter**         | Submit the message — or accept the highlighted item when the dropdown menu is open. |
| **Shift+Enter**   | Insert a newline.                                                               |
| **Esc**           | Dismiss the completion menu (or break a running demo).                          |

## Completion menu

The completion menu opens automatically as you type:

- Free text shows an **inline ghost** suggestion you can accept with **Tab**.
- `@`-commands open a **dropdown** (regardless of your inline preference).

| Shortcut          | Action                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| **Tab**           | Accept the inline ghost completion, or the highlighted dropdown item.           |
| **Enter**         | Accept the highlighted dropdown item (when the dropdown is open).               |
| **↑ / ↓**         | Move selection in the dropdown.                                                 |
| **Ctrl+Space**    | Re-open the dropdown after dismissing it with Esc, or force a fresh fetch.      |
| **Esc**           | Dismiss the dropdown.                                                           |

After accepting a top-level command (e.g. `@shell`), the next-level
subcommand menu opens automatically — you don't need to type a space.

## Demo mode

| Shortcut          | Action                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| **Esc**           | Break the currently-running demo.                                               |
| **Ctrl+→**        | Continue past a `@pauseForInput` checkpoint.                                    |

You can also break a demo with the `@shell break` command.
