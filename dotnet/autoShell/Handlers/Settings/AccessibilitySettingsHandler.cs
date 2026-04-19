// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers.Generated;
using autoShell.Services;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles accessibility settings: filter keys, magnifier, narrator, sticky keys, and mono audio.
/// </summary>
internal class AccessibilitySettingsHandler : SettingsHandlerBase
{
    private readonly IProcessService _process;
    private readonly ISystemParametersService _systemParams;

    /// <summary>
    /// Registers registered actions for mono audio, filter keys, and sticky keys.
    /// Magnifier and Narrator require process start/kill and are handled as specialized actions.
    /// </summary>
    public AccessibilitySettingsHandler(IRegistryService registry, IProcessService process, ISystemParametersService systemParams)
        : base(registry, process)
    {
        _process = process;
        _systemParams = systemParams;

        AddRegistryToggleAction("MonoAudioToggle", new RegistryToggleConfig(
            @"Software\Microsoft\Multimedia\Audio", "AccessibilityMonoMixState", "enable", 1, 0));
        AddAction<EnableFilterKeysActionParams>("EnableFilterKeysAction", HandleFilterKeys);
        AddAction<EnableStickyKeysParams>("EnableStickyKeys", HandleStickyKeys);
        AddAction<EnableMagnifierParams>("EnableMagnifier", p => HandleToggleProcess(p.Enable ?? true, "magnify.exe", "Magnify", "Magnifier"));
        AddAction<EnableNarratorActionParams>("EnableNarratorAction", p => HandleToggleProcess(p.Enable ?? true, "narrator.exe", "Narrator", "Narrator"));
    }

    private ActionResult HandleFilterKeys(EnableFilterKeysActionParams p)
    {
        bool enable = p.Enable ?? true;
        _systemParams.SetFilterKeys(enable);
        return ActionResult.Ok($"Filter Keys {(enable ? "enabled" : "disabled")}");
    }

    private ActionResult HandleStickyKeys(EnableStickyKeysParams p)
    {
        bool enable = p.Enable;
        _systemParams.SetStickyKeys(enable);
        return ActionResult.Ok($"Sticky Keys {(enable ? "enabled" : "disabled")}");
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
