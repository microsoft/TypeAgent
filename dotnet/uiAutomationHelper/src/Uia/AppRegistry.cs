// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace UiAutomationHelper.Uia;

/// <summary>
/// Tracks AUMIDs for apps the helper launched, since UIA exposes no way to
/// recover an AUMID from a window or process.
/// </summary>
internal static class AppRegistry
{
    private static readonly Dictionary<int, string> _aumidByPid = new();
    private static readonly object _lock = new();

    public static void Register(int pid, string? aumid)
    {
        if (string.IsNullOrEmpty(aumid))
        {
            return;
        }
        lock (_lock)
        {
            _aumidByPid[pid] = aumid;
        }
    }

    public static string? GetAumid(int pid)
    {
        lock (_lock)
        {
            return _aumidByPid.TryGetValue(pid, out var a) ? a : null;
        }
    }

    public static void Forget(int pid)
    {
        lock (_lock)
        {
            _aumidByPid.Remove(pid);
        }
    }
}
