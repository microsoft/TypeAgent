// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
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
        AddAction("Mute", HandleMute);
        AddAction("RestoreVolume", HandleRestoreVolume);
        AddAction("Volume", HandleVolume);
    }

    private ActionResult HandleMute(JsonElement parameters)
    {
        bool mute = parameters.GetBoolOrDefault("on");
        _audio.SetMute(mute);
        return ActionResult.Ok($"Audio {(mute ? "muted" : "unmuted")}");
    }

    private ActionResult HandleRestoreVolume(JsonElement parameters)
    {
        _audio.SetVolume((int)_savedVolumePct);
        return ActionResult.Ok($"Volume restored to {(int)_savedVolumePct}%");
    }

    private ActionResult HandleVolume(JsonElement parameters)
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
