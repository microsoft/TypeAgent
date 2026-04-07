// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;

namespace autoShell.Services;

/// <summary>
/// Abstracts Win32 window-management operations for testability.
/// </summary>
internal interface IWindowService
{
    /// <summary>
    /// Maximizes a window by process name or window title.
    /// </summary>
    void MaximizeWindow(string processName);

    /// <summary>
    /// Minimizes a window by process name or window title.
    /// </summary>
    void MinimizeWindow(string processName);

    /// <summary>
    /// Brings a window to the foreground by process name, launching it if needed.
    /// </summary>
    void RaiseWindow(string processName, string executablePath);

    /// <summary>
    /// Tiles two windows side by side.
    /// </summary>
    void TileWindows(string processName1, string processName2);

    /// <summary>
    /// Finds a window handle by process name, falling back to title search.
    /// </summary>
    /// <param name="processName">The process name or window title to search for.</param>
    /// <returns>The window handle if found; otherwise <see cref="IntPtr.Zero"/>.</returns>
    IntPtr FindProcessWindowHandle(string processName);
}
