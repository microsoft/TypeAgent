// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services;

/// <summary>
/// Abstracts display resolution and text-scaling operations for testability.
/// </summary>
internal interface IDisplayService
{
    /// <summary>
    /// Lists all unique display resolutions as a JSON string.
    /// </summary>
    string ListResolutions();

    /// <summary>
    /// Sets the display resolution. Returns a status message.
    /// </summary>
    string SetResolution(uint width, uint height, uint? refreshRate = null);

    /// <summary>
    /// Sets the text scaling percentage via <see cref="autoShell.Services.Interop.UIAutomation"/>.
    /// </summary>
    void SetTextSize(int percentage);
}
