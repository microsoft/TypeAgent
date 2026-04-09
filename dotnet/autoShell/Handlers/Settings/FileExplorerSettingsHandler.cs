// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;
using autoShell.Services;
using autoShell.Services.Interop;
using Microsoft.Win32;

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
    public CommandResult Handle(string key, JsonElement parameters)
    {
        CommandResult result = key switch
        {
            "ShowFileExtensions" => HandleShowFileExtensions(parameters),
            "ShowHiddenAndSystemFiles" => HandleShowHiddenAndSystemFiles(parameters),
            _ => CommandResult.Fail($"Unknown file explorer command: {key}"),
        };

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

    private CommandResult HandleShowFileExtensions(JsonElement parameters)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);
        // Inverted: enable showing extensions = HideFileExt 0
        _registry.SetValue(ExplorerAdvanced, "HideFileExt", enable ? 0 : 1, RegistryValueKind.DWord);
        return CommandResult.Ok($"File extensions {(enable ? "shown" : "hidden")}");
    }

    private CommandResult HandleShowHiddenAndSystemFiles(JsonElement parameters)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);
        // 1 = show hidden files, 2 = don't show hidden files
        _registry.SetValue(ExplorerAdvanced, "Hidden", enable ? 1 : 2, RegistryValueKind.DWord);
        // Show protected operating system files
        _registry.SetValue(ExplorerAdvanced, "ShowSuperHidden", enable ? 1 : 0, RegistryValueKind.DWord);
        return CommandResult.Ok($"Hidden files {(enable ? "shown" : "hidden")}");
    }
}
