// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;

namespace autoShell.Services;

/// <summary>
/// Abstracts Windows virtual desktop COM operations for testability.
/// </summary>
internal interface IVirtualDesktopService
{
    /// <summary>
    /// Creates one or more virtual desktops from a JSON array of names.
    /// </summary>
    void CreateDesktops(string jsonDesktopNames);

    /// <summary>
    /// Moves a window to the specified desktop by index (1-based) or name.
    /// </summary>
    void MoveWindowToDesktop(IntPtr hWnd, string desktopIdentifier);

    /// <summary>
    /// Switches to the next virtual desktop.
    /// </summary>
    void NextDesktop();

    /// <summary>
    /// Pins a window (by handle) to all desktops.
    /// </summary>
    void PinWindow(IntPtr hWnd);

    /// <summary>
    /// Switches to the previous virtual desktop.
    /// </summary>
    void PreviousDesktop();

    /// <summary>
    /// Switches to a virtual desktop by index or name.
    /// </summary>
    void SwitchDesktop(string desktopIdentifier);
}
