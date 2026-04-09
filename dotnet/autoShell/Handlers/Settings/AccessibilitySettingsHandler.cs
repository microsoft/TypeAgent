// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.Json;
using autoShell.Services;
using Microsoft.Win32;

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
    public CommandResult Handle(string key, JsonElement parameters)
    {
        return key switch
        {
            "EnableFilterKeysAction" => HandleFilterKeys(parameters, "Filter Keys"),
            "EnableMagnifier" => HandleToggleProcess(parameters, "magnify.exe", "Magnify", "Magnifier"),
            "EnableNarratorAction" => HandleToggleProcess(parameters, "narrator.exe", "Narrator", "Narrator"),
            "EnableStickyKeys" => HandleStickyKeys(parameters, "Sticky Keys"),
            "MonoAudioToggle" => HandleMonoAudio(parameters, "Mono audio"),
            _ => CommandResult.Fail($"Unknown accessibility command: {key}"),
        };
    }

    private CommandResult HandleFilterKeys(JsonElement parameters, string displayName)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);
        _registry.SetValue(
            @"Control Panel\Accessibility\Keyboard Response",
            "Flags",
            enable ? "2" : "126",
            RegistryValueKind.String);
        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleStickyKeys(JsonElement parameters, string displayName)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);
        _registry.SetValue(
            @"Control Panel\Accessibility\StickyKeys",
            "Flags",
            enable ? "510" : "506",
            RegistryValueKind.String);
        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleMonoAudio(JsonElement parameters, string displayName)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);
        _registry.SetValue(
            @"Software\Microsoft\Multimedia\Audio",
            "AccessibilityMonoMixState",
            enable ? 1 : 0,
            RegistryValueKind.DWord);
        return CommandResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleToggleProcess(JsonElement parameters, string exeName, string processName, string displayName)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);

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
