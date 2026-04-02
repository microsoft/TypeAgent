// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles volume, mute, and restoreVolume commands.
/// </summary>
internal class AudioCommandHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "Mute",
        "RestoreVolume",
        "Volume",
    ];

    private readonly IAudioService _audio;
    private double _savedVolumePct;

    public AudioCommandHandler(IAudioService audio)
    {
        this._audio = audio;
    }

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "Volume":
                if (int.TryParse(value, out int pct))
                {
                    this._savedVolumePct = this._audio.GetVolume();
                    this._audio.SetVolume(pct);
                }
                break;
            case "RestoreVolume":
                this._audio.SetVolume((int)this._savedVolumePct);
                break;
            case "Mute":
                if (bool.TryParse(value, out bool mute))
                {
                    this._audio.SetMute(mute);
                }
                break;
        }
    }
}
