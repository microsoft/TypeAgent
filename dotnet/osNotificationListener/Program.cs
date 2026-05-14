// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace TypeAgent.OsNotificationListener;

// Reads Windows action-center notifications via UserNotificationListener and
// streams them to stdout as one JSON object per line, matching the
// OsNotificationEvent shape from watcherProtocol.ts:
//   { kind: "added", id, app, title, body, timestamp, fromSync }
//   { kind: "removed", id }
//   { kind: "error", message }
//
// Requires package identity to subscribe to NotificationChanged. The exe
// gets identity from the sparse package whose manifest lives in
// ../identity/AppxManifest.xml — registration is handled by the agent's
// buildWindowsHelper flow, not here. Without identity, RequestAccessAsync
// may succeed but the NotificationChanged subscription throws.
//
// Stays alive while stdin is open; exits when the parent (Node-side
// windowsWatcher.ts) closes its end of the pipe. Stdin doubles as a
// command channel: the line "sync" enumerates current notifications and
// emits them with fromSync:true.
internal static class Program
{
    private static readonly object StdoutLock = new();

    public static async Task<int> Main()
    {
        Console.OutputEncoding = Encoding.UTF8;

        var listener = UserNotificationListener.Current;
        UserNotificationListenerAccessStatus access;
        try
        {
            access = await listener.RequestAccessAsync();
        }
        catch (Exception e)
        {
            Emit(new
            {
                kind = "error",
                message = $"RequestAccessAsync threw: {Describe(e)}",
            });
            return 1;
        }

        if (access != UserNotificationListenerAccessStatus.Allowed)
        {
            Emit(new
            {
                kind = "error",
                message = $"UserNotificationListener access denied: {access}",
            });
            return 2;
        }

        // Subscribe to the realtime change event. Requires package identity
        // (userNotificationListener restricted capability) — without it,
        // this throws with an unhelpful empty Message.
        try
        {
            listener.NotificationChanged += (sender, e) =>
            {
                try
                {
                    if (e.ChangeKind == UserNotificationChangedKind.Added)
                    {
                        var n = sender.GetNotification(e.UserNotificationId);
                        if (n != null) EmitAdded(n, fromSync: false);
                    }
                    else if (e.ChangeKind == UserNotificationChangedKind.Removed)
                    {
                        Emit(new
                        {
                            kind = "removed",
                            id = e.UserNotificationId.ToString(CultureInfo.InvariantCulture),
                        });
                    }
                }
                catch (Exception ex)
                {
                    Emit(new
                    {
                        kind = "error",
                        message = $"NotificationChanged handler: {Describe(ex)}",
                    });
                }
            };
        }
        catch (Exception e)
        {
            // Package identity is missing or broken. The exe shouldn't
            // be invoked in this state — the agent's setup flow registers
            // the identity package before launching. Surface the failure
            // and exit so the parent restarts / surfaces a build issue.
            Emit(new
            {
                kind = "error",
                message =
                    $"Failed to subscribe to NotificationChanged ({Describe(e)}). "
                    + "Likely cause: the identity package isn't registered for this exe location. "
                    + "Re-run the agent's helper-build flow or `Add-AppxPackage -ExternalLocation`.",
            });
            return 3;
        }

        var stop = new CancellationTokenSource();
        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        Console.CancelKeyPress += (_, args) =>
        {
            args.Cancel = true;
            stop.Cancel();
            done.TrySetResult(true);
        };

        // Stdin loop: drives commands from the parent (currently just "sync")
        // and detects parent-process death via EOF.
        _ = Task.Run(async () =>
        {
            try
            {
                string? line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    var cmd = line.Trim();
                    if (cmd.Length == 0) continue;
                    if (cmd == "sync")
                    {
                        try
                        {
                            var current = await listener.GetNotificationsAsync(NotificationKinds.Toast);
                            foreach (var n in current)
                            {
                                EmitAdded(n, fromSync: true);
                            }
                        }
                        catch (Exception ex)
                        {
                            Emit(new
                            {
                                kind = "error",
                                message = $"sync failed: {Describe(ex)}",
                            });
                        }
                    }
                    // Unknown commands are silently ignored.
                }
            }
            catch { /* swallow — EOF on stdin signals parent exit */ }
            stop.Cancel();
            done.TrySetResult(true);
        });

        await done.Task;
        return 0;
    }

    // Some WinRT exceptions surface with empty Message (the helpful info is
    // in HResult). Build a human-readable string that always has *something*.
    private static string Describe(Exception e)
    {
        var msg = (e.Message ?? "").Trim();
        var hr = $"0x{e.HResult:X8}";
        return msg.Length > 0
            ? $"{e.GetType().Name}: {msg} (HRESULT {hr})"
            : $"{e.GetType().Name} (HRESULT {hr})";
    }

    private static void EmitAdded(UserNotification n, bool fromSync)
    {
        string app = n.AppInfo?.DisplayInfo?.DisplayName ?? "";
        string title = "";
        string body = "";

        try
        {
            var toastBinding = n.Notification?.Visual?.GetBinding(KnownNotificationBindings.ToastGeneric);
            if (toastBinding != null)
            {
                var lines = toastBinding.GetTextElements();
                int i = 0;
                foreach (var line in lines)
                {
                    if (i == 0) title = line.Text ?? "";
                    else if (i == 1) body = line.Text ?? "";
                    else { body += "\n" + (line.Text ?? ""); }
                    i++;
                }
            }
        }
        catch
        {
            // Some notifications don't have a toast binding (e.g. tile-only).
            // Title/body stay empty rather than crash.
        }

        long ts = (long)(n.CreationTime.UtcDateTime - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        Emit(new
        {
            kind = "added",
            id = n.Id.ToString(CultureInfo.InvariantCulture),
            app,
            title,
            body,
            timestamp = ts,
            fromSync,
        });
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static void Emit(object obj)
    {
        // Single-line JSON, newline-terminated, mutex'd so concurrent emits
        // don't interleave bytes.
        string json = JsonSerializer.Serialize(obj, JsonOpts);
        lock (StdoutLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }
}
