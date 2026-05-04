// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using FlaUI.UIA3;

namespace UiAutomationHelper.Uia;

internal static class AutomationHost
{
    private static UIA3Automation? _automation;
    private static readonly object _lock = new();

    public static UIA3Automation Automation
    {
        get
        {
            lock (_lock)
            {
                return _automation ??= new UIA3Automation();
            }
        }
    }

    public static void Dispose()
    {
        lock (_lock)
        {
            _automation?.Dispose();
            _automation = null;
        }
    }
}
