// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
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
        AddAction<AdjustVolumeParams>("AdjustVolume", HandleAdjustVolume);
        AddAction<MuteParams>("Mute", HandleMute);
        AddAction<RestoreVolumeParams>("RestoreVolume", HandleRestoreVolume);
        AddAction<VolumeParams>("Volume", HandleVolume);
    }

    private ActionResult HandleMute(MuteParams p)
    {
        bool mute = p.On;
        _audio.SetMute(mute);
        return ActionResult.Ok($"Audio {(mute ? "muted" : "unmuted")}");
    }

    private ActionResult HandleAdjustVolume(AdjustVolumeParams p)
    {
        int current = _audio.GetVolume();
        int amount = p.Amount is > 0 ? p.Amount.Value : 10;
        int target = p.Direction.Equals("down", StringComparison.OrdinalIgnoreCase)
            ? current - amount
            : current + amount;
        target = Math.Clamp(target, 0, 100);

        if (current > 0)
        {
            _savedVolumePct = current;
        }
        _audio.SetVolume(target);
        return ActionResult.Ok($"Volume adjusted from {current}% to {target}%");
    }

    private ActionResult HandleRestoreVolume(RestoreVolumeParams p)
    {
        _audio.SetVolume((int)_savedVolumePct);
        return ActionResult.Ok($"Volume restored to {(int)_savedVolumePct}%");
    }

    private ActionResult HandleVolume(VolumeParams p)
    {
        int pct = p.TargetVolume;
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
