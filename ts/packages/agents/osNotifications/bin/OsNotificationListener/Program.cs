// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.ApplicationModel.Background;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace TypeAgent.OsNotificationListener;

// Reads Windows action-center notifications via UserNotificationListener and
// streams them to stdout as one JSON object per line, matching the
// OsNotificationEvent shape from watcherProtocol.ts:
//   { kind: "added", id, app, title, body, timestamp }
//   { kind: "removed", id }
//   { kind: "error", message }
//
// Stays alive while stdin is open. Closing stdin (the parent process exiting)
// triggers a graceful shutdown.
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
            Emit(new { kind = "error", message = $"RequestAccessAsync threw: {e.Message}" });
            return 1;
        }

        if (access != UserNotificationListenerAccessStatus.Allowed)
        {
            Emit(new { kind = "error", message = $"UserNotificationListener access denied: {access}" });
            return 2;
        }

        // Subscribe to changes — Added/Removed events fire as the action
        // center gains and loses notifications.
        try
        {
            listener.NotificationChanged += async (sender, e) =>
            {
                try
                {
                    if (e.ChangeKind == UserNotificationChangedKind.Added)
                    {
                        var n = await sender.GetNotificationAsync(e.UserNotificationId);
                        if (n != null)
                        {
                            EmitAdded(n, fromSync: false);
                        }
                    }
                    else if (e.ChangeKind == UserNotificationChangedKind.Removed)
                    {
                        Emit(new
                        {
                            kind = "removed",
                            id = e.UserNotificationId.ToString(CultureInfo.InvariantCulture)
                        });
                    }
                }
                catch (Exception ex)
                {
                    Emit(new { kind = "error", message = $"NotificationChanged handler: {ex.Message}" });
                }
            };
        }
        catch (Exception e)
        {
            Emit(new { kind = "error", message = $"Failed to subscribe to NotificationChanged: {e.Message}" });
            return 3;
        }

        // Block until stdin closes (parent process death) or Ctrl-C.
        // The same stdin loop also drives commands from the parent — currently
        // just "sync" to enumerate the current action center.
        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        Console.CancelKeyPress += (_, args) =>
        {
            args.Cancel = true;
            done.TrySetResult(true);
        };
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
                            Emit(new { kind = "error", message = $"sync failed: {ex.Message}" });
                        }
                    }
                    // Unknown commands are silently ignored — the loop also
                    // doubles as a parent-process-death detector via stdin EOF.
                }
            }
            catch { /* ignore */ }
            done.TrySetResult(true);
        });

        await done.Task;
        return 0;
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
            fromSync
        });
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static void Emit(object obj)
    {
        // Single-line JSON, newline-terminated, mutex'd so concurrent
        // NotificationChanged events don't interleave bytes.
        string json = JsonSerializer.Serialize(obj, JsonOpts);
        lock (StdoutLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }
}
