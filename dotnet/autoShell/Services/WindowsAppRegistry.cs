// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Microsoft.WindowsAPICodePack.Shell;

namespace autoShell.Services;

/// <summary>
/// Windows implementation of <see cref="IAppRegistry"/>.
/// Builds lookups from a hardcoded list of well-known apps and
/// dynamically discovered AppUserModelIDs from the shell AppsFolder.
/// </summary>
internal sealed class WindowsAppRegistry : IAppRegistry
{
    private readonly Hashtable _friendlyNameToPath = [];
    private readonly Hashtable _friendlyNameToId = [];
    private readonly SortedList<string, string[]> _appMetadata;

    public WindowsAppRegistry()
    {
        string userName = Environment.UserName;

        _appMetadata = new SortedList<string, string[]>
        {
            { "chrome", ["chrome.exe"] },
            { "power point", ["C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE"] },
            { "powerpoint", ["C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE"] },
            { "word", ["C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE"] },
            { "winword", ["C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE"] },
            { "excel", ["C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE"] },
            { "outlook", ["C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE"] },
            { "visual studio", ["devenv.exe"] },
            { "visual studio code", [$"C:\\Users\\{userName}\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"] },
            { "edge", ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"] },
            { "microsoft edge", ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"] },
            { "notepad", ["C:\\Windows\\System32\\notepad.exe"] },
            { "paint", ["mspaint.exe"] },
            { "calculator", ["calc.exe"] },
            { "file explorer", ["C:\\Windows\\explorer.exe"] },
            { "control panel", ["C:\\Windows\\System32\\control.exe"] },
            { "task manager", ["C:\\Windows\\System32\\Taskmgr.exe"] },
            { "cmd", ["C:\\Windows\\System32\\cmd.exe"] },
            { "powershell", ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"] },
            { "snipping tool", ["C:\\Windows\\System32\\SnippingTool.exe"] },
            { "magnifier", ["C:\\Windows\\System32\\Magnify.exe"] },
            { "paint 3d", ["C:\\Program Files\\WindowsApps\\Microsoft.MSPaint_10.1807.18022.0_x64__8wekyb3d8bbwe\\"] },
            { "m365 copilot", ["C:\\Program Files\\WindowsApps\\Microsoft.MicrosoftOfficeHub_19.2512.45041.0_x64__8wekyb3d8bbwe\\M365Copilot.exe"] },
            { "copilot", ["C:\\Program Files\\WindowsApps\\Microsoft.MicrosoftOfficeHub_19.2512.45041.0_x64__8wekyb3d8bbwe\\M365Copilot.exe"] },
            { "spotify", ["C:\\Program Files\\WindowsApps\\SpotifyAB.SpotifyMusic_1.278.418.0_x64__zpdnekdrzrea0\\spotify.exe"] },
            { "github copilot", [$"{Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)}\\AppData\\Local\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe", "GITHUB_COPILOT_ROOT_DIR", "--allow-all-tools"] },
        };

        foreach (var kvp in _appMetadata)
        {
            _friendlyNameToPath.Add(kvp.Key, kvp.Value[0]);
        }

        try
        {
            var installedApps = GetAllInstalledAppIds();
            foreach (var kvp in installedApps)
            {
                _friendlyNameToId.Add(kvp.Key, kvp.Value);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to enumerate installed apps: {ex.Message}");
        }
    }

    public string GetExecutablePath(string friendlyName)
    {
        return (string)_friendlyNameToPath[friendlyName.ToLowerInvariant()];
    }

    public string GetAppUserModelId(string friendlyName)
    {
        return (string)_friendlyNameToId[friendlyName.ToLowerInvariant()];
    }

    public string ResolveProcessName(string friendlyName)
    {
        string path = GetExecutablePath(friendlyName);
        return path != null ? Path.GetFileNameWithoutExtension(path) : friendlyName;
    }

    public string GetWorkingDirectoryEnvVar(string friendlyName)
    {
        return _appMetadata.TryGetValue(friendlyName.ToLowerInvariant(), out string[] value) && value.Length > 1
            ? value[1]
            : null;
    }

    public string GetArguments(string friendlyName)
    {
        return _appMetadata.TryGetValue(friendlyName.ToLowerInvariant(), out string[] value) && value.Length > 2
            ? string.Join(" ", value.Skip(2))
            : null;
    }

    public IEnumerable<string> GetAllAppNames()
    {
        return _friendlyNameToId.Keys.Cast<string>();
    }

    private static SortedList<string, string> GetAllInstalledAppIds()
    {
        var FOLDERID_AppsFolder = new Guid("{1e87508d-89c2-42f0-8a7e-645a0f50ca58}");
        ShellObject appsFolder = (ShellObject)KnownFolderHelper.FromKnownFolderId(FOLDERID_AppsFolder);
        var appIds = new SortedList<string, string>();

        foreach (var app in (IKnownFolder)appsFolder)
        {
            string appName = app.Name.ToLowerInvariant();
            if (appIds.ContainsKey(appName))
            {
                Debug.WriteLine("Key has multiple values: " + appName);
            }
            else
            {
                appIds.Add(appName, app.ParsingName);
            }
        }

        return appIds;
    }
}
