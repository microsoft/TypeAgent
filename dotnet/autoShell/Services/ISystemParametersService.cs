// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#nullable enable

using System;

namespace autoShell.Services;

/// <summary>
/// Abstracts SystemParametersInfo and related Win32 system parameter calls for testability.
/// </summary>
internal interface ISystemParametersService
{
    /// <summary>
    /// Sets a system parameter via SystemParametersInfo with an IntPtr value.
    /// </summary>
    /// <param name="action">The system parameter action constant (SPI_SET*).</param>
    /// <param name="param">Additional parameter whose meaning depends on the action.</param>
    /// <param name="vparam">Pointer to the value to set.</param>
    /// <param name="flags">Flags controlling persistence and notification (SPIF_*).</param>
    bool SetParameter(int action, int param, IntPtr vparam, int flags);

    /// <summary>
    /// Sets a system parameter via SystemParametersInfo with a string value.
    /// </summary>
    /// <param name="action">The system parameter action constant (SPI_SET*).</param>
    /// <param name="param">Additional parameter whose meaning depends on the action.</param>
    /// <param name="vparam">The string value to set.</param>
    /// <param name="flags">Flags controlling persistence and notification (SPIF_*).</param>
    bool SetParameter(int action, int param, string vparam, int flags);

    /// <summary>
    /// Sets a system parameter via SystemParametersInfo with an int array value.
    /// </summary>
    /// <param name="action">The system parameter action constant (SPI_SET*).</param>
    /// <param name="param">Additional parameter whose meaning depends on the action.</param>
    /// <param name="vparam">Array containing the value to set.</param>
    /// <param name="flags">Flags controlling persistence and notification (SPIF_*).</param>
    bool SetParameter(int action, int param, int[] vparam, int flags);

    /// <summary>
    /// Gets a system parameter via SystemParametersInfo into an int array.
    /// </summary>
    /// <param name="action">The system parameter action constant (SPI_GET*).</param>
    /// <param name="param">Additional parameter whose meaning depends on the action.</param>
    /// <param name="vparam">Array to receive the value.</param>
    /// <param name="flags">Flags (typically 0 for get operations).</param>
    bool GetParameter(int action, int param, int[] vparam, int flags);

    /// <summary>
    /// Swaps the primary and secondary mouse buttons.
    /// </summary>
    /// <param name="swap">If true, swaps the buttons; if false, restores default.</param>
    bool SwapMouseButton(bool swap);

    /// <summary>
    /// Enables or disables Filter Keys via SystemParametersInfo(SPI_SETFILTERKEYS).
    /// </summary>
    bool SetFilterKeys(bool enable);

    /// <summary>
    /// Enables or disables Sticky Keys via SystemParametersInfo(SPI_SETSTICKYKEYS).
    /// </summary>
    bool SetStickyKeys(bool enable);

    /// <summary>
    /// Loads a string resource from a native DLL by resource ID.
    /// Used to resolve localized display names (e.g., theme names from themeui.dll).
    /// </summary>
    /// <param name="dllPath">Full path to the DLL containing the string resource.</param>
    /// <param name="resourceId">The resource ID of the string to load.</param>
    /// <returns>The loaded string, or null if the resource could not be found.</returns>
    string? LoadStringResource(string dllPath, int resourceId);
}
