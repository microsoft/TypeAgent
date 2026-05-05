# OsNotificationListener (Windows helper)

Small .NET console exe that subscribes to
`Windows.UI.Notifications.Management.UserNotificationListener` and streams
notification events as JSON-per-line on stdout.

The TypeScript watcher in
[`../../src/watchers/windowsWatcher.ts`](../../src/watchers/windowsWatcher.ts)
spawns this binary, parses the lines, and forwards them to the agent.

## Build

```powershell
dotnet publish -c Release -r win-x64 -o ../../dist/bin/OsNotificationListener
```

The `postbuild` script in `package.json` copies the contents of `bin/**` into
`dist/bin/**`, so the built `.exe` ends up adjacent to the runtime watcher
module.

## Caveats

- **Package identity.** `UserNotificationListener` was originally a UWP API.
  Microsoft has loosened the requirement over time but on some Windows builds
  this API returns `AccessStatus.Denied` when called from a plain unpackaged
  console exe. If you ship via MSIX / sparse package the API just works; from
  a pure desktop install you may need to test on the target build. The helper
  emits a `kind:"error"` event in that case, which the agent surfaces once.

- **First-run consent.** Windows shows a system-level prompt the first time
  the helper calls `RequestAccessAsync`. The user can revoke consent later
  from Settings → Privacy & security → Notifications.

- **Coverage.** WinAppSDK has been moving some notification types onto its
  own APIs in Windows 11. The listener still surfaces standard toast
  notifications, but very new app frameworks may bypass it.
