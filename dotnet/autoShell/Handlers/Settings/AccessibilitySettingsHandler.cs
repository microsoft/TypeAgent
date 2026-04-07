// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
        _registry = registry;
        _process = process;
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
    public void Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "EnableFilterKeysAction":
                HandleFilterKeys(parameters);
                break;

            case "EnableMagnifier":
                HandleToggleProcess(parameters, "magnify.exe", "Magnify");
                break;

            case "EnableNarratorAction":
                HandleToggleProcess(parameters, "narrator.exe", "Narrator");
                break;

            case "EnableStickyKeys":
                HandleStickyKeys(parameters);
                break;

            case "MonoAudioToggle":
                HandleMonoAudio(parameters);
                break;
        }
    }

    private void HandleFilterKeys(JObject parameters)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Control Panel\Accessibility\Keyboard Response",
            "Flags",
            enable ? "2" : "126",
            RegistryValueKind.String);
    }

    private void HandleStickyKeys(JObject parameters)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Control Panel\Accessibility\StickyKeys",
            "Flags",
            enable ? "510" : "506",
            RegistryValueKind.String);
    }

    private void HandleMonoAudio(JObject parameters)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Software\Microsoft\Multimedia\Audio",
            "AccessibilityMonoMixState",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
    }

    private void HandleToggleProcess(JObject parameters, string exeName, string processName)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;

        if (enable)
        {
            _process.Start(new System.Diagnostics.ProcessStartInfo { FileName = exeName });
        }
        else
        {
            foreach (var p in _process.GetProcessesByName(processName))
            {
                p.Kill();
            }
        }
    }
}
