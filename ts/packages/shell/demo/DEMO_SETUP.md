# VS Code Shell Extension Demo — Setup Checklist

Pre-flight checklist for running the two-part demo
(`vscode_shell_extension_part1.txt` → `vscode_shell_extension_part2.txt`).

---

## 1. One-time build / install

Run from `ts/`:

```bash
pnpm install
pnpm run build
```

Then build & install the three pieces that live outside the standard build:

| Component | Location | Command |
|---|---|---|
| **coda** VS Code extension (required for `code` agent: split, theme, new file) | `ts/packages/coda` | `pnpm run build`, then install the `.vsix` in VS Code (or F5 launch) |
| **vscode-shell** VS Code extension (the sidebar chat) | `ts/packages/vscode-shell` | `pnpm --filter vscode-shell run deploy:local` (or F5) |
| **autoShell** (so `switch to Code` actually foregrounds the IDE) | `dotnet/autoShell` | `dotnet build`; ensure the desktop agent is configured to use the built exe |

Reinstall coda after any changes to `ts/packages/coda` or `ts/packages/agents/code`.
Reinstall vscode-shell after any changes to `ts/packages/vscode-shell` (including
`media/chat.css` and webview JS).

---

## 2. Processes that must be running before you start

1. **Agent server** — `pnpm --filter agent-server start` (listens on `ws://localhost:8999`).
2. **Code agent's WebSocket** on port `8082` — started automatically when the
   `code` schema is enabled in your session, and consumed by the coda extension.
3. **VS Code** open, with the **TypeAgent activity-bar icon visible**
   (vscode-shell installed). Do **not** click the icon until Part 1 hands off.
4. **gh CLI authenticated** — `gh auth status` should be green. Set the default
   repo to `microsoft/TypeAgent` if you want to omit `--repo` from prompts.
5. **Pre-create the `demo` label** in the target repo (one-time):
   ```
   gh label create demo --color BFD4F2 --repo microsoft/TypeAgent
   ```
   `gh issue edit --add-label` does NOT auto-create missing labels.

---

## 3. Session configuration

Run these once in the **Electron shell** before starting Part 1, then save the
session so the vscode-shell sidebar inherits them:

```
@config schema code on             # editor actions (split, theme, new file)
@config schema desktop on          # for "switch to Code"
@config schema github-cli on       # all github actions
@config schema onboarding off      # prevents "Integration not found" on "create scratch.ts"
@config request reasoning copilot  # PR/issue memory across turns
@session save vscode-demo
```

The vscode-shell sidebar attaches to the **same session**, so these settings
carry over automatically — no need to repeat them in Part 2.

---

## 4. Demo wording gotchas (already baked into the `.txt` files)

- Use **"switch to Code"** (exact Start-Menu name) — not "VS Code".
- Use **"change my vscode color theme to Monokai"** — without the word "vscode"
  the desktop agent grabs the request.
- Use **"split the editor to the right"** — matches the `<splitEditorSimple>` rule.
- In `add label "demo" to issue 2222 in microsoft/TypeAgent`, replace `2222`
  with the real issue number returned by the preceding `create issue` step.

---

## 5. Keyboard during the demo (inside the vscode-shell webview)

- **Ctrl+→** — advance past `@pauseForInput`
- **Esc** — cancel the demo

Both work from inside the chat input thanks to the capture-phase keydown
listener installed by the webview.

---

## 6. Known weak spots — verify or have a backup plan

| Symptom | Cause | Fix |
|---|---|---|
| `add label "X" to issue N` returns "'X' not found" | Label does not exist in repo | Pre-create with `gh label create X --color HEXCOLOR --repo OWNER/REPO` |
| "add label to that issue" / "delete that issue" doesn't resolve | Entity resolution requires the prior turn to be `issueCreate`/`prCreate` and stays in the same conversation | The `issueCreate` and `prCreate` actions emit a `resultEntity` for the new issue/PR; use immediately after creation |
| `show check runs for that PR` runs `gh run view <num>` and 404s | Reasoning maps "for that PR" to a workflow-run id, and there's no conversation memory of the prior PR | Use the explicit phrasing `show check runs for PR N [in OWNER/REPO]` (now backed by `gh pr checks`) |
| `create scratch.ts` returns "Unknown action name: code.code-general" | Reasoning hallucinates a sub-schema name as an action name | Rephrase as `create a typescript file scratch.ts with a hello world function` (drop "called" and "new"); long-term tracked in plan.md |
| `splitEditor` returns "Did not handle the action" | Installed coda is older than `ts/packages/coda` source | Rebuild & reinstall coda |
| `splitEditor` returns "No websocket connection" | Code agent WS server isn't up in this session | `@config schema code on` (then verify port 8082 is listening) |
| `create scratch.ts` returns "Integration ... not found" | Onboarding agent grabbed the request | `@config schema onboarding off` |
| `change my color theme to ...` toggles the title-bar instead of the theme | Desktop agent grabbed the request because the prompt didn't say "vscode" | Use the exact wording in the demo file |
| "remind me which PR we were just looking at" hallucinates PR #123 / `example/repo` | Reasoning has no conversation memory | `@config request reasoning copilot` |
| `switch to Code` doesn't foreground the IDE | autoShell missing or desktop agent not pointed at it | Rebuild `dotnet/autoShell` and re-link |
| Sidebar opens to a different session than the shell | vscode-shell session sync hasn't picked up | Reload the VS Code window after starting agent-server |

---

## 7. Quick sanity check before going live

1. `gh auth status` → logged in.
2. Agent server log shows `Listening on 8999`.
3. In the shell: `@config schema` → confirm `code`, `desktop`, `github-cli` are
   on and `onboarding` is off.
4. In the shell: type `show my assigned issues on github` — should render as a
   markdown bullet list with linked issue titles.
5. In the shell: type `switch to Code` — VS Code window comes to the foreground.
6. Click the TypeAgent activity-bar icon — sidebar opens with the same
   conversation already populated.
7. In the sidebar: type `split the editor to the right` — editor splits.
8. In the sidebar, with the demo paused: press **Ctrl+→** — demo advances.

If all eight pass, you're ready to run the demo end-to-end.
