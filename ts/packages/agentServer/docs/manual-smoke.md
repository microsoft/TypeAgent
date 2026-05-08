# agentServer manual smoke tests

The automated smoke driver (`pnpm -F @typeagent/agent-server-client run smoke`) covers single-process happy-path discovery: spawn → discovery file appears → client connects → shutdown → file removed. This document lists the scenarios that **require manual verification** because they involve human-driven UI, multi-process timing, or environment knobs that aren't worth wiring into CI.

Run these before merging changes that touch:

- `agentServer/server/src/server.ts` (startup, shutdown, discovery file)
- `agentServer/client/src/{discovery, discoveryClient, agentServerClient}.ts`
- `shell/src/main/instance.ts` (Electron `--connect`)
- `vscode-shell/src/agentServerBridge.ts`
- `cli/src/commands/{connect, replay, run/*}.ts`
- `utils/webSocketChannelServer/src/server.ts`
- markdown / montage view-server (`view/route/service.ts`, `route/route.ts`)

**Conventions for these tests:**

- "the discovery file" = `~/.typeagent/agent-server.json`
- Run from `ts/` after `pnpm install && pnpm run build` unless noted otherwise
- For tests that need an isolated profile, set `TYPEAGENT_USER_DATA_DIR=$env:TEMP\ta-smoke-<test>` so they can't collide with your real session
- A "live AS" means the discovery file points at a process that is alive **and** answers WebSocket connects

---

## 1. Single-instance enforcement (the second AS is rejected)

The whole architecture rests on `lockInstanceDir` guaranteeing that only one AS runs per profile. Verify it.

1. Open two PowerShell windows.
2. **Window 1:** `pnpm --filter agent-server start`. Wait until you see `Agent server started at ws://localhost:<port>`.
3. **Window 2:** `pnpm --filter agent-server start`.
4. **Expected:** Window 2 prints `Another agent-server (or shell) is already using the instance directory: ...` after a brief retry window (up to ~30 s, controlled by `lockInstanceDir`'s retry policy) and exits non-zero.
5. **Expected:** the discovery file still points at Window 1's port and pid (`Get-Content $env:USERPROFILE\.typeagent\agent-server.json`).
6. **Cleanup:** `agent-cli server stop` from any window.

> Why manual: `lockInstanceDir`'s retry window plus the dispatcher's agent loading mean a reliable cross-platform timing in CI is fragile. Easier to verify by eye.

---

## 2. Stale discovery file recovery

Verify that when the discovery file points at a dead pid (e.g. AS crashed or was killed), the next client cleans up and spawns a fresh AS instead of blocking on the stale entry.

1. Start AS: `pnpm --filter agent-server start`.
2. Note the pid in `~/.typeagent/agent-server.json`.
3. **Force-kill** it: `Stop-Process -Id <pid> -Force`. Do NOT use `agent-cli server stop` — we want to leave the file behind.
4. Verify the file is still there: `Test-Path $env:USERPROFILE\.typeagent\agent-server.json` → `True`.
5. From a new shell, run `agent-cli server status`.
6. **Expected:** reports "no agent-server is running" (because the pid is dead).
7. Run `agent-cli connect`.
8. **Expected:** the CLI auto-spawns a new AS, the discovery file is updated to the new pid/port, and the CLI connects successfully.
9. **Cleanup:** `agent-cli server stop`.

---

## 3. Discovery file is per-OS-user, not per-`TYPEAGENT_USER_DATA_DIR`

The discovery file lives at `~/.typeagent/agent-server.json` regardless of the data directory. Verify two ASes with different `TYPEAGENT_USER_DATA_DIR` cannot both publish.

1. **Window 1:** `$env:TYPEAGENT_USER_DATA_DIR="$env:TEMP\ta-profile-A"; pnpm --filter agent-server start`.
2. Wait until ready.
3. **Window 2:** `$env:TYPEAGENT_USER_DATA_DIR="$env:TEMP\ta-profile-B"; pnpm --filter agent-server start`.
4. **Expected:** Window 2 starts successfully (different instance dir, different lock) but the discovery file is overwritten — only one AS at a time can be discovered.
5. **Expected behavior** (this is intentional, document the surprise): a CLI that calls `ensureAgentServerViaDiscovery` will land on whichever AS most recently wrote the file. If you need both ASes addressable, you must connect to each by explicit URL — the discovery file is a single-AS convenience.
6. **Cleanup:** stop both, remove `$env:TEMP\ta-profile-A` and `$env:TEMP\ta-profile-B`.

> If we ever need true multi-profile discovery, this is where the design needs to change.

---

## 4. CLI `agent-cli connect` interactive flow

End-to-end: CLI auto-spawns AS, joins default conversation, sends a request, receives display output.

1. Make sure no AS is running: `agent-cli server stop` (idempotent).
2. Make sure no discovery file: `Remove-Item $env:USERPROFILE\.typeagent\agent-server.json -ErrorAction SilentlyContinue`.
3. Run `agent-cli connect`.
4. **Expected:** a visible terminal window appears (the spawned AS); the CLI prints the connect URL; you land at the prompt.
5. Type a request like `what time is it`. Verify a response is displayed.
6. Exit (`Ctrl+C` or `exit`).
7. **Expected:** the spawned AS keeps running (no `--idle-timeout` was passed). Verify `agent-cli server status` reports it.
8. `agent-cli server stop`.

Repeat with `agent-cli connect --hidden`. Expected: no terminal window for the spawned AS, but everything else works the same.

---

## 5. CLI `agent-cli run request` non-interactive flow

1. No AS running, no discovery file.
2. Run `agent-cli run request "what time is it"`.
3. **Expected:** AS spawns hidden (no window), the response is printed to stdout, then the AS exits roughly 10 minutes later (`--idle-timeout 600` is passed by default).
4. To verify hidden window: open Task Manager, watch for a `node` process; you should see one appear and then disappear after ~10 min.
5. To verify the idle timer, run a second `agent-cli run request "..."` within the 10-min window — it should reuse the existing AS (no second spawn).

Repeat with `--show`. Expected: a visible AS window appears.

Repeat with `--conversation my-test` to verify conversation routing.

---

## 6. CLI `agent-cli replay` ephemeral conversation

1. Find a `.har` or replay log to use, or use any saved transcript.
2. Run `agent-cli replay <file>`.
3. **Expected:** AS spawns hidden, an ephemeral conversation `cli-replay-<uuid>` is created, replay runs, conversation is **deleted** on exit.
4. Verify the cleanup: `Get-Content $env:USERPROFILE\.typeagent\profiles\dev\conversations\conversations.json` should not contain a `cli-replay-*` entry.

---

## 7. `agent-cli server stop` resolves port from discovery file

Regression check that `stop` no longer requires a port argument.

1. Start AS (any way).
2. Run `agent-cli server stop` with no arguments.
3. **Expected:** finds the AS via discovery file, sends shutdown, AS exits cleanly, discovery file is removed.

---

## 8. Electron shell `--connect` discovers the AS

1. Start AS: `pnpm --filter agent-server start`.
2. From `ts/`: `pnpm --filter agent-shell start -- --connect`.
3. **Expected:** the shell starts, finds the AS via discovery file (no port flag needed), and routes the chat through WebSocket. Send a request and verify a response appears in the chat.
4. Close the shell. AS continues running.
5. Restart the shell with `--connect`. Should discover the same AS.
6. `agent-cli server stop` to clean up.

Without `--connect`, the shell should run the dispatcher in-process and **not** consult the discovery file. Verify by stopping any running AS, removing the discovery file, and launching the shell normally — it should still work.

---

## 9. vscode-shell extension discovers the AS

1. Start AS: `pnpm --filter agent-server start`.
2. Open the vscode-shell extension dev host (F5 in VS Code on the `vscode-shell` package).
3. Open the chat panel; send a request.
4. **Expected:** the extension discovers the AS via the discovery file (no `typeagent.serverUrl` setting needed) and routes the request.
5. In the dev-host VS Code, set `typeagent.serverUrl` = `ws://localhost:<some-other-port>`.
6. Reload the extension. Send a request.
7. **Expected:** the extension uses the explicit URL (and fails if nothing is listening there) — confirms the setting overrides discovery.
8. Clear `typeagent.serverUrl` (or set it to `""`). Reload. Should fall back to discovery.

---

## 10. Multi-client concurrent connections

Verify multiple clients can share one AS and one conversation.

1. Start AS.
2. **Window 1:** `agent-cli connect --conversation shared-test`. Wait for prompt.
3. **Window 2:** `agent-cli connect --conversation shared-test`. Wait for prompt.
4. From Window 1, send a request. **Expected:** response appears in Window 1 (and not in Window 2 — `clientio` is per-connection).
5. From Window 2, send a different request. Verify response appears in Window 2.
6. Both should see the conversation transcript update (via the shared dispatcher).
7. Disconnect Window 1. Verify Window 2 keeps working.
8. Disconnect Window 2. Verify the conversation dispatcher is evicted from memory after 5 minutes (debug log: `evicting conversation 'shared-test' (no clients for 5m)`).

---

## 11. `--port` override pin

The default is ephemeral, but `--port <n>` should still pin the AS to a specific port (used for tests, port-forwarding setups, or remote-host scenarios).

1. `pnpm --filter agent-server start -- --port 9000`.
2. Verify discovery file says `port: 9000`.
3. `agent-cli server status` resolves to port 9000.
4. Stop. Restart without `--port`; verify it picks an OS-assigned port again (not 9000).

---

## 12. markdown view server (refactor regression)

This was touched by the `getBoundPort` refactor — verify the view still works end-to-end.

1. Start AS. Open the shell connected to it.
2. From the chat: `@markdown create a new file called test.md`.
3. **Expected:** the markdown view opens in the shell webview, content is editable, the URL contains an OS-assigned port (look in the iframe URL via shell devtools).
4. Open the same shell again in another window: `@markdown open test.md`. Verify the second view opens on a **different** port (each session gets its own).

---

## 13. montage view server (refactor regression)

Same as above, for montage:

1. Start AS + shell connected.
2. From the chat: `@montage start slideshow` (or similar montage action).
3. **Expected:** montage view opens, OS-assigned port, no `EADDRINUSE` errors in the AS console.

---

## 14. Idle-timeout shutdown

Verify the `--idle-timeout` flag actually causes shutdown after the last client disconnects.

1. Start AS with: `node ts/packages/agentServer/server/dist/server.js --idle-timeout 30`.
2. Run `agent-cli connect`. Connect, send a request, exit.
3. **Expected:** within 30 seconds of the disconnect, the AS prints a shutdown message and exits. Discovery file is removed.

> CI doesn't cover this because it requires sub-minute precision over a real wall-clock — easy to flake.

---

## 15. Cross-machine connection (explicit URL bypasses discovery)

Verify discovery is purely a local convenience and explicit URLs still work.

1. Start AS on host A: `pnpm --filter agent-server start -- --port 9876` (pinning a port for ease).
2. From host B (or just another PowerShell on the same host with a fresh `TYPEAGENT_USER_DATA_DIR`), use the agent-server-client API directly:
   ```js
   import { connectAgentServer } from "@typeagent/agent-server-client";
   const conn = await connectAgentServer("ws://<host-A>:9876");
   ```
3. **Expected:** connects without ever reading the discovery file.

---

## When to add to the automated smoke

Add a scenario to `agentServer/client/scripts/smoke.mjs` only if:
- it doesn't depend on UI (Electron, VS Code, terminal windows)
- it doesn't depend on wall-clock timing > a few seconds
- it can be set up and torn down within an isolated `TYPEAGENT_USER_DATA_DIR`

Everything else stays in this manual smoke list.
