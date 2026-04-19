// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers.Generated;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles File Explorer settings: file extensions and hidden/system files visibility.
/// </summary>
internal class FileExplorerSettingsHandler : SettingsHandlerBase
{
    private const string ExplorerAdvanced = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";

    /// <summary>
    /// Registers a registered action for showing file extensions (inverted toggle).
    /// Show hidden files requires a multi-value registry write and is handled as a specialized action.
    /// </summary>
    public FileExplorerSettingsHandler(IRegistryService registry)
        : base(registry)
    {
        AddRegistryToggleAction("ShowFileExtensions", new RegistryToggleConfig(
            ExplorerAdvanced, "HideFileExt", "enable", OnValue: 0, OffValue: 1, NotifyShell: true));
        AddAction<ShowHiddenAndSystemFilesParams>("ShowHiddenAndSystemFiles", HandleShowHiddenAndSystemFiles);
    }

    private ActionResult HandleShowHiddenAndSystemFiles(ShowHiddenAndSystemFilesParams p)
    {
        bool enable = p.Enable ?? true;
        // 1 = show hidden files, 2 = don't show hidden files
        Registry.SetValue(ExplorerAdvanced, "Hidden", enable ? 1 : 2, RegistryValueKind.DWord);
        // Show protected operating system files
        Registry.SetValue(ExplorerAdvanced, "ShowSuperHidden", enable ? 1 : 0, RegistryValueKind.DWord);
        Registry.BroadcastSettingChange();
        Registry.NotifyShellChange();
        return ActionResult.Ok($"Hidden files {(enable ? "shown" : "hidden")}");
    }
}
