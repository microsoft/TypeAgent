// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services;

/// <summary>
/// Abstracts Windows Core Audio API operations for testability.
/// </summary>
internal interface IAudioService
{
    /// <summary>
    /// Sets the system volume to the specified percentage (0–100).
    /// </summary>
    void SetVolume(int percent);

    /// <summary>
    /// Gets the current system volume as a percentage (0–100).
    /// </summary>
    int GetVolume();

    /// <summary>
    /// Sets or clears the system mute state.
    /// </summary>
    void SetMute(bool mute);

    /// <summary>
    /// Gets the current system mute state.
    /// </summary>
    bool GetMute();
}
