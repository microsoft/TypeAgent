// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles accessibility settings: filter keys, magnifier, narrator, sticky keys, and mono audio.
/// </summary>
internal class AccessibilitySettingsHandler : ICommandHandler
{
    private readonly IRegistryService _registry;
    private readonly IProcessService _process;

    public AccessibilitySettingsHandler(IRegistryService registry, IProcessService process)
    {
        this._registry = registry;
        this._process = process;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "EnableFilterKeysAction",
        "EnableMagnifier",
        "EnableNarratorAction",
        "EnableStickyKeys",
        "MonoAudioToggle",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        try
        {
            var param = JObject.Parse(value);

            switch (key)
            {
                case "EnableFilterKeysAction":
                    this.HandleFilterKeys(param);
                    break;

                case "EnableMagnifier":
                    this.HandleToggleProcess(param, "magnify.exe", "Magnify");
                    break;

                case "EnableNarratorAction":
                    this.HandleToggleProcess(param, "narrator.exe", "Narrator");
                    break;

                case "EnableStickyKeys":
                    this.HandleStickyKeys(param);
                    break;

                case "MonoAudioToggle":
                    this.HandleMonoAudio(param);
                    break;
            }
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    private void HandleFilterKeys(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        this._registry.SetValue(
            @"Control Panel\Accessibility\Keyboard Response",
            "Flags",
            enable ? "2" : "126",
            RegistryValueKind.String);
    }

    private void HandleStickyKeys(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        this._registry.SetValue(
            @"Control Panel\Accessibility\StickyKeys",
            "Flags",
            enable ? "510" : "506",
            RegistryValueKind.String);
    }

    private void HandleMonoAudio(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        this._registry.SetValue(
            @"Software\Microsoft\Multimedia\Audio",
            "AccessibilityMonoMixState",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
    }

    private void HandleToggleProcess(JObject param, string exeName, string processName)
    {
        bool enable = param.Value<bool?>("enable") ?? true;

        if (enable)
        {
            this._process.Start(new System.Diagnostics.ProcessStartInfo { FileName = exeName });
        }
        else
        {
            foreach (var p in this._process.GetProcessesByName(processName))
            {
                p.Kill();
            }
        }
    }
}
