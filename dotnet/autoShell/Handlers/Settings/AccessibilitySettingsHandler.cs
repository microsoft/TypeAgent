// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers.Generated;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles accessibility settings: filter keys, magnifier, narrator, sticky keys, and mono audio.
/// </summary>
internal class AccessibilitySettingsHandler : SettingsHandlerBase
{
    private readonly IProcessService _process;

    /// <summary>
    /// Registers registered actions for mono audio, filter keys, and sticky keys.
    /// Magnifier and Narrator require process start/kill and are handled as specialized actions.
    /// </summary>
    public AccessibilitySettingsHandler(IRegistryService registry, IProcessService process)
        : base(registry, process)
    {
        _process = process;

        AddRegistryToggleAction("MonoAudioToggle", new RegistryToggleConfig(
            @"Software\Microsoft\Multimedia\Audio", "AccessibilityMonoMixState", "enable", 1, 0));
        AddRegistryToggleAction("EnableFilterKeysAction", new RegistryToggleConfig(
            @"Control Panel\Accessibility\Keyboard Response", "Flags", "enable",
            OnValue: "2", OffValue: "126", ValueKind: RegistryValueKind.String, DisplayName: "Filter Keys"));
        AddRegistryToggleAction("EnableStickyKeys", new RegistryToggleConfig(
            @"Control Panel\Accessibility\StickyKeys", "Flags", "enable",
            OnValue: "510", OffValue: "506", ValueKind: RegistryValueKind.String, DisplayName: "Sticky Keys"));
        AddAction<EnableMagnifierParams>("EnableMagnifier", p => HandleToggleProcess(p.Enable ?? true, "magnify.exe", "Magnify", "Magnifier"));
        AddAction<EnableNarratorActionParams>("EnableNarratorAction", p => HandleToggleProcess(p.Enable ?? true, "narrator.exe", "Narrator", "Narrator"));
    }

    private ActionResult HandleToggleProcess(bool enable, string exeName, string processName, string displayName)
    {
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

        return ActionResult.Ok($"{displayName} {(enable ? "enabled" : "disabled")}");
    }
}
