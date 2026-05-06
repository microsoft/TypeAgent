// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
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
// We try `NotificationChanged += ...` first — it's the realtime API and works
// for packaged/UWP apps. It throws for unpackaged desktop apps, in which case
// we fall back to polling via `GetNotificationsAsync` and diffing against the
// previously-seen id set. Polling cadence is 3 seconds — a balance between
// responsiveness and CPU/RPC overhead.
//
// Stays alive while stdin is open; exits when the parent (Node-side
// windowsWatcher.ts) closes its end of the pipe. Stdin also doubles as a
// command channel: the line "sync" enumerates current notifications and
// emits them with fromSync:true.
internal static class Program
{
    private const int PollIntervalMs = 3000;

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

        // ---------------------------------------------------------------
        // Live change detection. Try NotificationChanged event first; if the
        // OS rejects the subscription (typical for unpackaged desktop apps),
        // fall back to polling. The "fallback" path also runs at startup for
        // unpackaged apps so we still detect new notifications going forward.
        // ---------------------------------------------------------------
        bool eventsRegistered = false;
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
            eventsRegistered = true;
        }
        catch
        {
            // Subscription rejected — fall through to polling below.
            // Don't surface as error; this is the normal path for
            // unpackaged desktop apps.
        }

        var stop = new CancellationTokenSource();
        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        Console.CancelKeyPress += (_, args) =>
        {
            args.Cancel = true;
            stop.Cancel();
            done.TrySetResult(true);
        };

        // Tracks notification ids we've already emitted "added" for, so the
        // polling loop only fires on truly new arrivals (and so the live
        // event handler's emits aren't duplicated by the next poll). Shared
        // between the event handler and the polling loop via locking.
        var seenIds = new HashSet<string>();
        var seenLock = new object();

        // Initial population: read currently-present notifications WITHOUT
        // emitting. This is the live-mode behavior — only NEW notifications
        // (arrivals after startup) are forwarded as live "added" events. The
        // explicit "sync" command from stdin will emit all current
        // notifications with fromSync:true regardless.
        try
        {
            var initial = await listener.GetNotificationsAsync(NotificationKinds.Toast);
            lock (seenLock)
            {
                foreach (var n in initial)
                {
                    seenIds.Add(n.Id.ToString(CultureInfo.InvariantCulture));
                }
            }
        }
        catch (Exception e)
        {
            Emit(new
            {
                kind = "error",
                message = $"Initial GetNotificationsAsync failed: {Describe(e)}",
            });
            // Keep going — we may still receive events / process sync.
        }

        // Polling task. Skipped if event subscription succeeded (no need to
        // poll). The diff against seenIds detects both added and removed.
        if (!eventsRegistered)
        {
            _ = Task.Run(async () =>
            {
                while (!stop.IsCancellationRequested)
                {
                    try
                    {
                        await Task.Delay(PollIntervalMs, stop.Token);
                    }
                    catch (OperationCanceledException) { break; }

                    try
                    {
                        var current = await listener.GetNotificationsAsync(NotificationKinds.Toast);
                        var currentIds = current
                            .Select(n => n.Id.ToString(CultureInfo.InvariantCulture))
                            .ToHashSet();

                        // Detect removals.
                        List<string> removed;
                        lock (seenLock)
                        {
                            removed = seenIds.Except(currentIds).ToList();
                            foreach (var id in removed) seenIds.Remove(id);
                        }
                        foreach (var id in removed)
                        {
                            Emit(new { kind = "removed", id });
                        }

                        // Detect additions.
                        foreach (var n in current)
                        {
                            var id = n.Id.ToString(CultureInfo.InvariantCulture);
                            bool isNew;
                            lock (seenLock)
                            {
                                isNew = seenIds.Add(id);
                            }
                            if (isNew) EmitAdded(n, fromSync: false);
                        }
                    }
                    catch (Exception ex)
                    {
                        // Don't spam — emit and continue. If the API is
                        // permanently broken we'll just keep retrying with no
                        // events fired, which is the right "fail-safe" mode.
                        Emit(new
                        {
                            kind = "error",
                            message = $"Polling iteration failed: {Describe(ex)}",
                        });
                    }
                }
            });
        }

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
                                // Track so the polling diff doesn't re-emit
                                // these as live "added" on the next tick.
                                lock (seenLock)
                                {
                                    seenIds.Add(n.Id.ToString(CultureInfo.InvariantCulture));
                                }
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
