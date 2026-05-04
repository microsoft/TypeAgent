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
            if (_automation != null)
            {
                return _automation;
            }
            lock (_lock)
            {
                _automation ??= new UIA3Automation();
                return _automation;
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
