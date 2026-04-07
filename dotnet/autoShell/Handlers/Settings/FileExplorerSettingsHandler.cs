// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using autoShell.Services;
using autoShell.Services.Interop;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles File Explorer settings: file extensions and hidden/system files visibility.
/// </summary>
internal partial class FileExplorerSettingsHandler : ICommandHandler
{
    #region P/Invoke
    private const string ExplorerAdvanced = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced";

    [LibraryImport(NativeDlls.User32, EntryPoint = "SendNotifyMessageW")]
    private static partial IntPtr SendNotifyMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    #endregion P/Invoke

    private readonly IRegistryService _registry;

    public FileExplorerSettingsHandler(IRegistryService registry)
    {
        _registry = registry;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ShowFileExtensions",
        "ShowHiddenAndSystemFiles",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        var param = JObject.Parse(value);

        switch (key)
        {
            case "ShowFileExtensions":
                HandleShowFileExtensions(param);
                break;

            case "ShowHiddenAndSystemFiles":
                HandleShowHiddenAndSystemFiles(param);
                break;
        }

        NotifySettingsChange();
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

    private void HandleShowFileExtensions(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        // Inverted: enable showing extensions = HideFileExt 0
        _registry.SetValue(ExplorerAdvanced, "HideFileExt", enable ? 0 : 1, RegistryValueKind.DWord);
    }

    private void HandleShowHiddenAndSystemFiles(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        // 1 = show hidden files, 2 = don't show hidden files
        _registry.SetValue(ExplorerAdvanced, "Hidden", enable ? 1 : 2, RegistryValueKind.DWord);
        // Show protected operating system files
        _registry.SetValue(ExplorerAdvanced, "ShowSuperHidden", enable ? 1 : 0, RegistryValueKind.DWord);
    }
}
