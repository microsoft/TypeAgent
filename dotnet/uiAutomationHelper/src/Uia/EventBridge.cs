// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace UiAutomationHelper.Uia;

/// <summary>
/// Centralized hook for UIA events. Slice 2 only tracks "any focus change" as a
/// proxy for "UIA had activity"; full event subscription with notifications lands
/// in slice 5 (record mode).
/// </summary>
internal static class EventBridge
{
    private static long _lastEventTicks = DateTime.UtcNow.Ticks;
    private static IDisposable? _focusSub;
    private static readonly object _subLock = new();

    /// <summary>
    /// Idempotent. Subscribes to global focus changes the first time it's called.
    /// </summary>
    public static void EnsureSubscribed()
    {
        lock (_subLock)
        {
            if (_focusSub != null)
            {
                return;
            }
            _focusSub = AutomationHost.Automation.RegisterFocusChangedEvent(_ =>
            {
                Interlocked.Exchange(ref _lastEventTicks, DateTime.UtcNow.Ticks);
            });
        }
    }

    /// <summary>Resets the activity timestamp to "now". Call before measuring idle.</summary>
    public static void ResetActivityClock()
    {
        Interlocked.Exchange(ref _lastEventTicks, DateTime.UtcNow.Ticks);
    }

    /// <summary>Milliseconds since the last observed UIA event.</summary>
    public static long QuietMs()
    {
        long lastTicks = Interlocked.Read(ref _lastEventTicks);
        return (DateTime.UtcNow.Ticks - lastTicks) / TimeSpan.TicksPerMillisecond;
    }
}
