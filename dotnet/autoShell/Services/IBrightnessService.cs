// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services;

/// <summary>
/// Abstracts display brightness operations for testability.
/// </summary>
internal interface IBrightnessService
{
    /// <summary>
    /// Gets the current display brightness (0–100).
    /// </summary>
    byte GetCurrentBrightness();

    /// <summary>
    /// Sets the display brightness (0–100).
    /// </summary>
    void SetBrightness(byte brightness);
}
