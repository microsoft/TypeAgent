// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Runtime.InteropServices;

namespace UiAutomationHelper.Uia;

/// <summary>
/// Wraps UIA operations that can throw transient COMExceptions when the desktop
/// tree is mutating mid-enumeration (e.g., immediately after a window closes).
/// </summary>
internal static class ComRetry
{
    public static T Run<T>(Func<T> op, int maxRetries = 2, int delayMs = 100)
    {
        Exception? last = null;
        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                return op();
            }
            catch (COMException ex) when (IsTransient(ex))
            {
                last = ex;
                if (attempt == maxRetries)
                {
                    break;
                }
                Thread.Sleep(delayMs);
            }
        }
        throw last!;
    }

    private static bool IsTransient(COMException ex)
    {
        // Common race-condition HRESULTs observed during teardown / structure-change.
        return ex.HResult switch
        {
            unchecked((int)0x80040201) => true, // EVENT_E_QUERYSYNTAX (UIA event marshaling)
            unchecked((int)0x80040E14) => true, // generic transient
            unchecked((int)0x80131509) => true, // InvalidOperationException COM-mapped
            unchecked((int)0x80004005) => true, // E_FAIL — frequently transient on UIA enumeration
            _ => false,
        };
    }
}
