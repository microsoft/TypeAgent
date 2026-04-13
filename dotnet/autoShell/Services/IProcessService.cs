// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace autoShell.Services;

/// <summary>
/// Abstracts process management operations for testability.
/// </summary>
internal interface IProcessService
{
    /// <summary>
    /// Returns all processes with the specified name.
    /// </summary>
    Process[] GetProcessesByName(string name);

    /// <summary>
    /// Starts a new process with the specified start info.
    /// </summary>
    Process Start(ProcessStartInfo startInfo);

    /// <summary>
    /// Starts a process using the OS shell (e.g., opening a URL or file).
    /// </summary>
    void StartShellExecute(string fileName);
}
