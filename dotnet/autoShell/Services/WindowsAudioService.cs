// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using autoShell.Logging;
using autoShell.Services.Interop;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IAudioService"/> using Windows Core Audio COM API.
/// </summary>
internal class WindowsAudioService : IAudioService
{
    private readonly ILogger _logger;

    public WindowsAudioService(ILogger logger)
    {
        _logger = logger;
    }

    /// <inheritdoc/>
    public void SetVolume(int percent)
    {
        try
        {
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out IMMDevice device);
            var audioEndpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref audioEndpointVolumeGuid, 0, IntPtr.Zero, out object obj);
            var audioEndpointVolume = (IAudioEndpointVolume)obj;
            audioEndpointVolume.SetMasterVolumeLevelScalar(percent / 100.0f, Guid.Empty);
        }
        catch (Exception ex)
        {
            _logger.Debug("Failed to set volume: " + ex.Message);
        }
    }

    /// <inheritdoc/>
    public int GetVolume()
    {
        try
        {
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out IMMDevice device);
            var audioEndpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref audioEndpointVolumeGuid, 0, IntPtr.Zero, out object obj);
            var audioEndpointVolume = (IAudioEndpointVolume)obj;
            audioEndpointVolume.GetMasterVolumeLevelScalar(out float currentVolume);
            return (int)(currentVolume * 100.0);
        }
        catch (Exception ex)
        {
            _logger.Debug("Failed to get volume: " + ex.Message);
            return 0;
        }
    }

    /// <inheritdoc/>
    public void SetMute(bool mute)
    {
        try
        {
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out IMMDevice device);
            var audioEndpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref audioEndpointVolumeGuid, 0, IntPtr.Zero, out object obj);
            var audioEndpointVolume = (IAudioEndpointVolume)obj;
            audioEndpointVolume.SetMute(mute, Guid.Empty);
        }
        catch (Exception ex)
        {
            _logger.Debug("Failed to set mute: " + ex.Message);
        }
    }

    /// <inheritdoc/>
    public bool GetMute()
    {
        try
        {
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out IMMDevice device);
            var audioEndpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref audioEndpointVolumeGuid, 0, IntPtr.Zero, out object obj);
            var audioEndpointVolume = (IAudioEndpointVolume)obj;
            audioEndpointVolume.GetMute(out bool currentMute);
            return currentMute;
        }
        catch (Exception ex)
        {
            _logger.Debug("Failed to get mute: " + ex.Message);
            return false;
        }
    }
}
