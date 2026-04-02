// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of IDebuggerService using System.Diagnostics.Debugger.
/// </summary>
internal class WindowsDebuggerService : IDebuggerService
{
    /// <inheritdoc/>
    public void Launch()
    {
        Debugger.Launch();
    }
}
