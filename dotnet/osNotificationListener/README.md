# OsNotificationListener (Windows helper)

Small .NET console exe that subscribes to
`Windows.UI.Notifications.Management.UserNotificationListener` and streams
notification events as JSON-per-line on stdout.

The TypeScript watcher in
[`../../ts/packages/agents/osNotifications/src/watchers/windowsWatcher.ts`](../../ts/packages/agents/osNotifications/src/watchers/windowsWatcher.ts)
spawns this binary, parses the lines, and forwards them to the agent.

## Build

The agent's [`@config agent setup osNotifications`](../../ts/packages/agents/osNotifications/README.md#sync-and-setup)
flow runs the full build/sign/register pipeline end-to-end. Use this manual
path when iterating on `Program.cs` or the identity manifest, where running
the full setup over and over is overkill.

```powershell
# 1. Publish — produces publish/OsNotificationListener.exe
dotnet publish -c Release -r win-x64 -o publish

# 2. Pack the sparse-identity MSIX
makeappx pack /o /d identity /nv /p TypeAgent.OsNotificationListener.msix

# 3. Sign with the dev cert (CurrentUser\My) — get the thumbprint via:
#    Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq "CN=dev.typeagent.microsoft.com"
signtool sign /sha1 <thumbprint> /fd SHA256 TypeAgent.OsNotificationListener.msix

# 4. Register the sparse package against the published exe
Add-AppxPackage -Path TypeAgent.OsNotificationListener.msix -ExternalLocation publish
```

The agent locates the exe in `publish/OsNotificationListener.exe` first,
falling back to the project root for hand-built copies.

## Caveats

- **Package identity is required for `NotificationChanged`.** Subscribing to
  the realtime notification event requires the calling process to have
  package identity. The sparse-package register step above gives the
  unpackaged exe identity — without it the subscription silently fails and
  we'd be stuck polling. The exe's `app.manifest` carries a side-by-side
  `<msix>` element pointing at `TypeAgent.OsNotificationListener` to make
  the linkage at runtime.

- **First-run consent.** Windows shows a system-level prompt the first time
  the helper calls `RequestAccessAsync`. The user can revoke consent later
  from Settings → Privacy & security → Notifications. The helper exits with
  code 2 if access is denied.

- **Coverage.** WinAppSDK has been moving some notification types onto its
  own APIs in Windows 11. The listener still surfaces standard toast
  notifications, but very new app frameworks may bypass it.

- **Cert trust split.** SignTool reads `CurrentUser\My`; `Add-AppxPackage`
  runs as SYSTEM and reads `LocalMachine`. The dev cert needs to live in
  both, with the chain trusted in `LocalMachine\Root`. See the agent's
  README for the `getCert.mjs` flow that handles all of this.
