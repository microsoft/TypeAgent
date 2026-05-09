# agentServer manual smoke

A single-pass walkthrough covering everything the automated smoke (`pnpm -F @typeagent/agent-server-client run smoke`) does not. Run before merging changes that touch `agentServer/`, `shell/src/main/instance.ts`, `vscode-shell/src/agentServerBridge.ts`, `cli/src/commands/`, `webSocketChannelServer`, or markdown/montage view-server code.

Total run time: ~10 min. Run from `cwd = ts/` after `pnpm install && pnpm run build`. **Commands assume PowerShell** (Windows). On macOS/Linux, translate the env-var and `Remove-Item` syntax accordingly.

The `agent-cli` command requires the CLI to be linked globally — from `ts/packages/cli`, run `pnpm link --global` once (see `packages/cli/README.md`). Otherwise substitute `pnpm -F agent-cli start --` for `agent-cli` in the steps below.

> Discovery file = `~/.typeagent/agent-server.json` (referred to below as `$file`).

---

Pre-flight: define the `$file` shortcut used in later steps, and clear any AS / stale discovery file left over from earlier dev work so step 1 starts from a clean slate.

```pwsh
$file = "$env:USERPROFILE\.typeagent\agent-server.json"
agent-cli server stop 2>$null; Remove-Item $file -ErrorAction SilentlyContinue
```

### 1. AS picks an ephemeral port and publishes the discovery file

```pwsh
pnpm --filter agent-server start
```
✅ Console: `Agent server started at ws://localhost:<port>` (port ≠ 8999, ≠ 8082).
✅ `Get-Content $file` shows `{port, pid, startedAt}` matching that port and the AS's pid.

### 2. Single-instance lock rejects a second AS

In a **second** terminal:
```pwsh
pnpm --filter agent-server start
```
✅ Within ~30 s: prints `Another agent-server (or shell) is already using the instance directory`, exits non-zero.
✅ `$file` is unchanged.

### 3. CLI auto-discovers and connects

In a third terminal:
```pwsh
agent-cli run request "what time is it"
```
✅ Prints a response (no spawn — reused the running AS).

### 4. Multi-client to the same conversation

```pwsh
agent-cli connect --conversation shared-test     # window A
agent-cli connect --conversation shared-test     # window B
```
✅ Both prompts appear. A request from A displays in A only; from B in B only. Both see transcript updates.
Exit both (`Ctrl+C`).

### 5. Electron shell `--connect` uses discovery (no port flag)

```pwsh
pnpm --filter agent-shell start -- --connect
```
✅ Shell launches, connects, chat works. Close the shell.

### 6. vscode-shell uses discovery; `typeagent.serverUrl` overrides

- F5 the `vscode-shell` package → open chat panel → send a request. ✅ Works (no setting needed).
- Set `typeagent.serverUrl = ws://localhost:1` → reload extension → send request. ✅ Fails (proves override is honored).
- Clear the setting → reload → ✅ Works again.

### 7. markdown / montage view-server regression (the `getBoundPort` refactor)

In the running shell from step 5:
```
@markdown create a new file called test.md
@montage start slideshow
```
✅ Both views open as iframes; URLs contain OS-assigned ports; AS console shows no `EADDRINUSE`.

### 8. Stale discovery-file recovery

```pwsh
$pid = (Get-Content $file | ConvertFrom-Json).pid
Stop-Process -Id $pid -Force                     # leave $file behind
agent-cli server status                          # ✅ "no agent-server is running"
agent-cli run request "ping"                     # ✅ auto-spawns fresh AS, $file updated
```

### 9. `--port` override still works

```pwsh
agent-cli server stop
pnpm --filter agent-server start -- --port 9876
```
✅ `(Get-Content $file | ConvertFrom-Json).port` is `9876`.

### 10. `--idle-timeout` shutdown

```pwsh
agent-cli server stop
node packages/agentServer/server/dist/server.js --idle-timeout 30 &
agent-cli run request "hi"                       # connects + disconnects
# wait ~30 s
Test-Path $file                                  # ✅ False — AS exited and cleaned up
```

### 11. Graceful stop resolves port from discovery file

```pwsh
pnpm --filter agent-server start &
agent-cli server stop                             # no port arg
```
✅ AS exits cleanly; `Test-Path $file` → `False`.

---

If any step fails, capture the AS console output, the contents of `$file` at the time of failure, and any client-side error before reporting.
