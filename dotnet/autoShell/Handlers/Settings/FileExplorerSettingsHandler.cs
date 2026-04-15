// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Runtime.InteropServices;
using autoShell.Handlers.Generated;
using autoShell.Services;
using autoShell.Services.Interop;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles File Explorer settings: file extensions and hidden/system files visibility.
/// </summary>
internal partial class FileExplorerSettingsHandler : SettingsHandlerBase
{
    #region P/Invoke
    private const string ExplorerAdvanced = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";

    [LibraryImport(NativeDlls.User32, EntryPoint = "SendNotifyMessageW")]
    private static partial IntPtr SendNotifyMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    #endregion P/Invoke

    /// <summary>
    /// Registers a registered action for showing file extensions (inverted toggle).
    /// Show hidden files requires a multi-value registry write and is handled as a specialized action.
    /// </summary>
    public FileExplorerSettingsHandler(IRegistryService registry)
        : base(registry)
    {

        AddRegistryToggleAction("ShowFileExtensions", new RegistryToggleConfig(
            ExplorerAdvanced, "HideFileExt", "enable", OnValue: 0, OffValue: 1));
        AddAction<ShowHiddenAndSystemFilesParams>("ShowHiddenAndSystemFiles", HandleShowHiddenAndSystemFiles);
    }

    /// <inheritdoc/>
    public override ActionResult Handle(string key, System.Text.Json.JsonElement parameters)
    {
        var result = base.Handle(key, parameters);
        NotifySettingsChange();
        return result;
    }

    private static void NotifySettingsChange()
    {
        try
        {
            SendNotifyMessage((IntPtr)0xffff, 0x001A, IntPtr.Zero, IntPtr.Zero);
        }
        catch (EntryPointNotFoundException)
        {
            // P/Invoke may not be available in all environments
        }
    }

    private ActionResult HandleShowHiddenAndSystemFiles(ShowHiddenAndSystemFilesParams p)
    {
        bool enable = p.Enable ?? true;
        // 1 = show hidden files, 2 = don't show hidden files
        Registry.SetValue(ExplorerAdvanced, "Hidden", enable ? 1 : 2, RegistryValueKind.DWord);
        // Show protected operating system files
        Registry.SetValue(ExplorerAdvanced, "ShowSuperHidden", enable ? 1 : 0, RegistryValueKind.DWord);
        return ActionResult.Ok($"Hidden files {(enable ? "shown" : "hidden")}");
    }
}
