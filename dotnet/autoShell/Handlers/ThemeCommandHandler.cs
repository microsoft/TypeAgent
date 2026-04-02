// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles theme-related commands: ApplyTheme, ListThemes, SetThemeMode, and SetWallpaper.
/// Contains all Windows theme management logic including discovery, application,
/// and light/dark mode toggling.
/// </summary>
internal partial class ThemeCommandHandler : ICommandHandler
{
    #region P/Invoke

    private const int SPI_SETDESKWALLPAPER = 0x0014;
    private const int SPIF_UPDATEINIFILE_SENDCHANGE = 3;
    private const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;

    [LibraryImport("kernel32.dll", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    private static partial IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool FreeLibrary(IntPtr hModule);

    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int LoadString(IntPtr hInstance, uint uID, [Out] char[] lpBuffer, int nBufferMax);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint msg,
        IntPtr wParam,
        string lParam,
        uint fuFlags,
        uint uTimeout,
        out IntPtr lpdwResult);

    #endregion P/Invoke

    private readonly IRegistryService _registry;
    private readonly IProcessService _process;
    private readonly ISystemParametersService _systemParams;

    private string _previousTheme;
    private Dictionary<string, string> _themeDictionary;
    private Dictionary<string, string> _themeDisplayNameDictionary;

    public ThemeCommandHandler(IRegistryService registry, IProcessService process, ISystemParametersService systemParams)
    {
        this._registry = registry;
        this._process = process;
        this._systemParams = systemParams;

        this.LoadThemes();
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ApplyTheme",
        "ListThemes",
        "SetThemeMode",
        "SetWallpaper",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "ApplyTheme":
                this.ApplyTheme(value);
                break;

            case "ListThemes":
                var themes = this.GetInstalledThemes();
                Console.WriteLine(JsonConvert.SerializeObject(themes));
                break;

            case "SetThemeMode":
                this.HandleSetThemeMode(value);
                break;

            case "SetWallpaper":
                this._systemParams.SetParameter(SPI_SETDESKWALLPAPER, 0, value, SPIF_UPDATEINIFILE_SENDCHANGE);
                break;
        }
    }

    #region Theme Management

    /// <summary>
    /// Applies a Windows theme by name.
    /// </summary>
    public bool ApplyTheme(string themeName)
    {
        string themePath = FindThemePath(themeName);
        if (string.IsNullOrEmpty(themePath))
        {
            return false;
        }

        try
        {
            string previous = GetCurrentTheme();

            if (!themeName.Equals("previous", StringComparison.OrdinalIgnoreCase))
            {
                this._process.StartShellExecute(themePath);
                this._previousTheme = previous;
                return true;
            }
            else
            {
                bool success = RevertToPreviousTheme();

                if (success)
                {
                    this._previousTheme = previous;
                }

                return success;
            }
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Gets the current Windows theme name.
    /// </summary>
    public string GetCurrentTheme()
    {
        try
        {
            const string ThemesPath = @"Software\Microsoft\Windows\CurrentVersion\Themes";
            string currentThemePath = this._registry.GetValue(ThemesPath, "CurrentTheme") as string;
            if (!string.IsNullOrEmpty(currentThemePath))
            {
                return Path.GetFileNameWithoutExtension(currentThemePath);
            }
        }
        catch
        {
            // Ignore errors reading registry
        }
        return null;
    }

    /// <summary>
    /// Returns a list of all installed Windows themes.
    /// </summary>
    public List<string> GetInstalledThemes()
    {
        HashSet<string> themes = [];

        themes.UnionWith(this._themeDictionary.Keys);
        themes.UnionWith(this._themeDisplayNameDictionary.Keys);

        return [.. themes];
    }

    /// <summary>
    /// Gets the name of the previous theme.
    /// </summary>
    public string GetPreviousTheme()
    {
        return this._previousTheme;
    }

    /// <summary>
    /// Reverts to the previous Windows theme.
    /// </summary>
    public bool RevertToPreviousTheme()
    {
        if (string.IsNullOrEmpty(this._previousTheme))
        {
            return false;
        }

        string themePath = FindThemePath(this._previousTheme);
        if (string.IsNullOrEmpty(themePath))
        {
            return false;
        }

        try
        {
            this._process.StartShellExecute(themePath);
            return true;
        }
        catch
        {
            return false;
        }
    }

    #endregion

    #region Light/Dark Mode

    /// <summary>
    /// Sets the Windows light or dark mode by modifying registry keys.
    /// </summary>
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    public bool SetLightDarkMode(bool useLightMode)
    {
        try
        {
            const string PersonalizePath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
            int value = useLightMode ? 1 : 0;

            this._registry.SetValue(PersonalizePath, "AppsUseLightTheme", value, RegistryValueKind.DWord);
            this._registry.SetValue(PersonalizePath, "SystemUsesLightTheme", value, RegistryValueKind.DWord);

            // Broadcast settings change notification to update UI
            BroadcastSettingsChange();

            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Toggles between light and dark mode.
    /// </summary>
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    public bool ToggleLightDarkMode()
    {
        bool? currentMode = GetCurrentLightMode();
        return currentMode.HasValue && this.SetLightDarkMode(!currentMode.Value);
    }

    #endregion

    private void HandleSetThemeMode(string value)
    {
        if (value.Equals("toggle", StringComparison.OrdinalIgnoreCase))
        {
            this.ToggleLightDarkMode();
        }
        else if (value.Equals("light", StringComparison.OrdinalIgnoreCase))
        {
            this.SetLightDarkMode(true);
        }
        else if (value.Equals("dark", StringComparison.OrdinalIgnoreCase))
        {
            this.SetLightDarkMode(false);
        }
        else if (bool.TryParse(value, out bool useLightMode))
        {
            this.SetLightDarkMode(useLightMode);
        }
    }

    /// <summary>
    /// Broadcasts a WM_SETTINGCHANGE message to notify the system of theme changes.
    /// </summary>
    private static void BroadcastSettingsChange()
    {
        const int HWND_BROADCAST = 0xffff;
        const int WM_SETTINGCHANGE = 0x001A;
        const uint SMTO_ABORTIFHUNG = 0x0002;
        SendMessageTimeout(
            (IntPtr)HWND_BROADCAST,
            WM_SETTINGCHANGE,
            IntPtr.Zero,
            "ImmersiveColorSet",
            SMTO_ABORTIFHUNG,
            1000,
            out nint result);
    }

    /// <summary>
    /// Finds the full path to a theme file by name or display name.
    /// </summary>
    private string FindThemePath(string themeName)
    {
        // First check by file name
        if (this._themeDictionary.TryGetValue(themeName, out string themePath))
        {
            return themePath;
        }

        // Then check by display name
        if (this._themeDisplayNameDictionary.TryGetValue(themeName, out string fileNameFromDisplay))
        {
            if (this._themeDictionary.TryGetValue(fileNameFromDisplay, out string themePathFromDisplay))
            {
                return themePathFromDisplay;
            }
        }

        return null;
    }

    /// <summary>
    /// Gets the current light/dark mode setting from the registry.
    /// </summary>
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private bool? GetCurrentLightMode()
    {
        try
        {
            const string PersonalizePath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
            object value = this._registry.GetValue(PersonalizePath, "AppsUseLightTheme");
            return value is int intValue ? intValue == 1 : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Parses the display name from a .theme file.
    /// </summary>
    private static string GetThemeDisplayName(string themeFilePath)
    {
        try
        {
            foreach (string line in File.ReadLines(themeFilePath))
            {
                if (line.StartsWith("DisplayName=", StringComparison.OrdinalIgnoreCase))
                {
                    string displayName = line["DisplayName=".Length..].Trim();
                    // Handle localized strings (e.g., @%SystemRoot%\System32\themeui.dll,-2013)
                    if (displayName.StartsWith('@'))
                    {
                        displayName = ResolveLocalizedString(displayName);
                    }
                    return displayName;
                }
            }
        }
        catch
        {
            // Ignore errors reading theme file
        }
        return null;
    }

    private void LoadThemes()
    {
        this._themeDictionary = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        this._themeDisplayNameDictionary = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        string[] themePaths =
        [
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Resources", "Themes"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Resources", "Ease of Access Themes"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Windows", "Themes")
        ];

        foreach (string themesFolder in themePaths)
        {
            if (Directory.Exists(themesFolder))
            {
                foreach (string themeFile in Directory.GetFiles(themesFolder, "*.theme"))
                {
                    string themeName = Path.GetFileNameWithoutExtension(themeFile);
                    if (!this._themeDictionary.ContainsKey(themeName))
                    {
                        this._themeDictionary[themeName] = themeFile;

                        // Parse display name from theme file
                        string displayName = GetThemeDisplayName(themeFile);
                        if (!string.IsNullOrEmpty(displayName) && !this._themeDisplayNameDictionary.ContainsKey(displayName))
                        {
                            this._themeDisplayNameDictionary[displayName] = themeName;
                        }
                    }
                }
            }
        }

        this._themeDictionary["previous"] = this.GetCurrentTheme();
    }

    /// <summary>
    /// Resolves a localized string resource reference.
    /// </summary>
    private static string ResolveLocalizedString(string localizedString)
    {
        try
        {
            // Remove the @ prefix
            string resourcePath = localizedString[1..];
            // Expand environment variables
            int commaIndex = resourcePath.LastIndexOf(',');
            if (commaIndex > 0)
            {
                string dllPath = Environment.ExpandEnvironmentVariables(resourcePath[..commaIndex]);
                string resourceIdStr = resourcePath[(commaIndex + 1)..];
                if (int.TryParse(resourceIdStr, out int resourceId))
                {
                    char[] buffer = new char[256];
                    IntPtr hModule = LoadLibraryEx(dllPath, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
                    if (hModule != IntPtr.Zero)
                    {
                        try
                        {
                            int result = LoadString(hModule, (uint)Math.Abs(resourceId), buffer, buffer.Length);
                            if (result > 0)
                            {
                                return new string(buffer, 0, result);
                            }
                        }
                        finally
                        {
                            FreeLibrary(hModule);
                        }
                    }
                }
            }
        }
        catch
        {
            // Ignore errors resolving localized string
        }
        return localizedString;
    }
}
