// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace UiAutomationHelper.Snapshot;

internal static class ProcessKiller
{
    /// <summary>
    /// Kill all processes matching the given identity. UWP AUMID matching is
    /// approximated via process-name match against the package name fragment;
    /// callers passing aumid should also pass processName when known.
    /// </summary>
    public static void KillByIdentity(string? aumid, string? processName, int gracefulMs = 1500)
    {
        var processes = new List<Process>();
        if (!string.IsNullOrEmpty(processName))
        {
            try
            {
                processes.AddRange(Process.GetProcessesByName(StripExe(processName)));
            }
            catch
            {
                /* Access denied is fine */
            }
        }
        if (!string.IsNullOrEmpty(aumid))
        {
            // AUMID is "<PackageName>_<PublisherHash>!<App>". Use the package
            // name as a fuzzy process-name hint (works for built-in apps where
            // the executable name reflects the package).
            var pkg = aumid.Split('_', '!')[0];
            try
            {
                processes.AddRange(Process.GetProcessesByName(pkg));
            }
            catch
            {
                /* Access denied is fine */
            }
        }

        foreach (var proc in processes.Distinct())
        {
            try
            {
                if (proc.HasExited) continue;
                try { proc.CloseMainWindow(); } catch { /* ignore */ }
                if (!proc.WaitForExit(gracefulMs))
                {
                    proc.Kill(entireProcessTree: true);
                    proc.WaitForExit(gracefulMs);
                }
            }
            catch
            {
                /* ignore individual failures */
            }
            finally
            {
                proc.Dispose();
            }
        }
    }

    private static string StripExe(string name) =>
        name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? name[..^4]
            : name;
}
