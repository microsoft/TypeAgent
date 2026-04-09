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
    public CommandResult Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "EnableFilterKeysAction":
                return HandleFilterKeys(parameters, "Filter Keys");

            case "EnableMagnifier":
                return HandleToggleProcess(parameters, "magnify.exe", "Magnify", "Magnifier");

            case "EnableNarratorAction":
                return HandleToggleProcess(parameters, "narrator.exe", "Narrator", "Narrator");

            case "EnableStickyKeys":
                return HandleStickyKeys(parameters, "Sticky Keys");

            case "MonoAudioToggle":
                return HandleMonoAudio(parameters, "Mono audio");

            default:
                return CommandResult.Fail($"Unknown accessibility command: {key}");
        }
    }

    private CommandResult HandleFilterKeys(JObject parameters, string displayName)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Control Panel\Accessibility\Keyboard Response",
            "Flags",
            enable ? "2" : "126",
            RegistryValueKind.String);
        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleStickyKeys(JObject parameters, string displayName)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Control Panel\Accessibility\StickyKeys",
            "Flags",
            enable ? "510" : "506",
            RegistryValueKind.String);
        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleMonoAudio(JObject parameters, string displayName)
    {
        bool enable = parameters.Value<bool?>("enable") ?? true;
        _registry.SetValue(
            @"Software\Microsoft\Multimedia\Audio",
            "AccessibilityMonoMixState",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleToggleProcess(JObject parameters, string exeName, string processName, string displayName)
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

        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }
}
