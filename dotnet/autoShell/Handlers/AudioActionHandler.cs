// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers.Generated;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles audio commands: Mute, RestoreVolume, and Volume.
/// </summary>
internal class AudioActionHandler : ActionHandlerBase
{
    private readonly IAudioService _audio;
    private double _savedVolumePct;

    public AudioActionHandler(IAudioService audio)
    {
        _audio = audio;
        AddAction<MuteParams>("Mute", HandleMute);
        AddAction<RestoreVolumeParams>("RestoreVolume", HandleRestoreVolume);
        // Volume left as JsonElement to distinguish missing targetVolume (default -1) from explicit 0
        AddAction("Volume", HandleVolume);
    }

    private ActionResult HandleMute(MuteParams p)
    {
        bool mute = p.On;
        _audio.SetMute(mute);
        return ActionResult.Ok($"Audio {(mute ? "muted" : "unmuted")}");
    }

    private ActionResult HandleRestoreVolume(RestoreVolumeParams p)
    {
        _audio.SetVolume((int)_savedVolumePct);
        return ActionResult.Ok($"Volume restored to {(int)_savedVolumePct}%");
    }

    private ActionResult HandleVolume(System.Text.Json.JsonElement parameters)
    {
        int pct = parameters.GetIntOrDefault("targetVolume", -1);
        if (pct < 0)
        {
            return ActionResult.Fail("Invalid volume: targetVolume required");
        }

        int currentVolume = _audio.GetVolume();
        if (currentVolume > 0)
        {
            _savedVolumePct = currentVolume;
        }
        _audio.SetVolume(pct);
        return ActionResult.Ok($"Volume set to {pct}%");
    }
}
