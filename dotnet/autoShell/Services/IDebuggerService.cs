// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services;

/// <summary>
/// Abstracts debugger operations for testability.
/// </summary>
internal interface IDebuggerService
{
    /// <summary>
    /// Launches and attaches a debugger to the process.
    /// </summary>
    void Launch();
}
