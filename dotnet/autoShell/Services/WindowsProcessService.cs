// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IProcessService"/> using <see cref="System.Diagnostics.Process"/>.
/// </summary>
internal class WindowsProcessService : IProcessService
{
    /// <inheritdoc/>
    public Process[] GetProcessesByName(string name)
    {
        return Process.GetProcessesByName(name);
    }

    /// <inheritdoc/>
    public Process Start(ProcessStartInfo startInfo)
    {
        return Process.Start(startInfo);
    }

    /// <inheritdoc/>
    public void StartShellExecute(string fileName)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = true
        });
    }
}
