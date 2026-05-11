# agentServer manual smoke

A single-pass walkthrough covering everything the automated smoke (`pnpm -F @typeagent/agent-server-client run smoke`) does not. Run before merging changes that touch `agentServer/`, `shell/src/main/instance.ts`, `vscode-shell/src/agentServerBridge.ts`, `cli/src/commands/`, `webSocketChannelServer`, or markdown/montage view-server code.

Total run time: ~10 min. Run from `cwd = ts/` after `pnpm install && pnpm run build`. **Commands assume PowerShell** (Windows). On macOS/Linux, translate the env-var syntax accordingly.

The `agent-cli` command requires the CLI to be linked globally — from `ts/packages/cli`, run `pnpm link --global` once (see `packages/cli/README.md`). Otherwise substitute `pnpm -F agent-cli start --` for `agent-cli` in the steps below.

> AS port = `AGENT_SERVER_PORT` env var, default `8999`. URL is `ws://localhost:8999`.

---

Pre-flight: stop any AS left over from earlier dev work so step 1 starts from a clean slate.

```pwsh
agent-cli server stop 2>$null
```

### 1. AS binds the well-known port

```pwsh
pnpm --filter agent-server start
```
✅ Console: `Agent server started at ws://localhost:8999`.
✅ `Test-NetConnection -ComputerName localhost -Port 8999` → `TcpTestSucceeded : True`.

### 2. Single-instance lock rejects a second AS at the same data dir

In a **second** terminal:
```pwsh
$env:AGENT_SERVER_PORT = "9001"     # different port — proves the conflict is the data dir, not the port
pnpm --filter agent-server start
```
✅ Within ~30 s: prints `Another agent-server (or shell) is already using the instance directory`, exits non-zero.

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

### 5. Electron shell `--connect` uses the well-known port

```pwsh
pnpm --filter agent-shell start -- --connect
```
✅ Shell launches, connects, chat works. Close the shell.

### 6. vscode-shell connects; `typeagent.serverUrl` overrides

- F5 the `vscode-shell` package → open chat panel → send a request. ✅ Works (no setting needed).
- Set `typeagent.serverUrl = ws://localhost:1` → reload extension → send request. ✅ Fails (proves override is honored).
- Clear the setting → reload → ✅ Works again.

### 7. markdown / montage view-server regression

In the running shell from step 5:
```
@markdown create a new file called test.md
@montage start slideshow
```
✅ Both views open as iframes; URLs contain OS-assigned ports; AS console shows no `EADDRINUSE`.

### 8. AS auto-spawn after a crash

```pwsh
$conn = Test-NetConnection -ComputerName localhost -Port 8999 -InformationLevel Quiet
# Find the AS process and kill it forcibly
Get-Process node | Where-Object { $_.CommandLine -like "*agentServer*" } | Stop-Process -Force
agent-cli server status                          # ✅ "no agent-server is running"
agent-cli run request "ping"                     # ✅ auto-spawns a fresh AS at port 8999
```

### 9. `AGENT_SERVER_PORT` override

```pwsh
agent-cli server stop
$env:AGENT_SERVER_PORT = "9876"
pnpm --filter agent-server start
```
In a separate terminal (with the same `AGENT_SERVER_PORT` set):
```pwsh
$env:AGENT_SERVER_PORT = "9876"
agent-cli run request "hi"                       # ✅ connects to :9876
```

### 10. `--idle-timeout` shutdown

```pwsh
agent-cli server stop
node packages/agentServer/server/dist/server.js --idle-timeout 30 &
agent-cli run request "hi"                       # connects + disconnects
# wait ~30 s
Test-NetConnection -ComputerName localhost -Port 8999 -InformationLevel Quiet  # ✅ $false
```

### 11. Graceful stop via RPC

```pwsh
pnpm --filter agent-server start &
agent-cli server stop                             # no port arg — uses the configured URL
```
✅ AS exits cleanly; the port stops answering.

---

If any step fails, capture the AS console output, the result of `Test-NetConnection -ComputerName localhost -Port 8999`, and any client-side error before reporting.
