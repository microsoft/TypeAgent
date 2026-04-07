// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles audio commands: Mute, RestoreVolume, and Volume.
/// </summary>
internal class AudioCommandHandler : ICommandHandler
{
    private readonly IAudioService _audio;
    private double _savedVolumePct;

    public AudioCommandHandler(IAudioService audio)
    {
        _audio = audio;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "Mute",
        "RestoreVolume",
        "Volume",
    ];

    /// <inheritdoc/>
    public void Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "Mute":
            {
                bool mute = parameters.Value<bool?>("on") ?? false;
                _audio.SetMute(mute);
                break;
            }
            case "RestoreVolume":
                _audio.SetVolume((int)_savedVolumePct);
                break;
            case "Volume":
            {
                int pct = parameters.Value<int?>("targetVolume") ?? -1;
                if (pct >= 0)
                {
                    int currentVolume = _audio.GetVolume();
                    if (currentVolume > 0)
                    {
                        _savedVolumePct = currentVolume;
                    }
                    _audio.SetVolume(pct);
                }
                break;
            }
        }
    }
}
