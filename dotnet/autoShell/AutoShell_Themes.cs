// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace autoShell
{
    internal partial class AutoShell
    {
        private static string s_previousTheme = null;
        private static Dictionary<string, string> s_themeDictionary = null;
        private static Dictionary<string, string> s_themeDisplayNameDictionary = null;

        private static void LoadThemes()
        {
            s_themeDictionary = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            s_themeDisplayNameDictionary = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            string[] themePaths = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Resources", "Themes"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Resources", "Ease of Access Themes"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Windows", "Themes")
            };

            foreach (string themesFolder in themePaths)
            {
                if (Directory.Exists(themesFolder))
                {
                    foreach (string themeFile in Directory.GetFiles(themesFolder, "*.theme"))
                    {
                        string themeName = Path.GetFileNameWithoutExtension(themeFile);
                        if (!s_themeDictionary.ContainsKey(themeName))
                        {
                            s_themeDictionary[themeName] = themeFile;

                            // Parse display name from theme file
                            string displayName = GetThemeDisplayName(themeFile);
                            if (!string.IsNullOrEmpty(displayName) && !s_themeDisplayNameDictionary.ContainsKey(displayName))
                            {
                                s_themeDisplayNameDictionary[displayName] = themeName;
                            }
                        }
                    }
                }
            }

            s_themeDictionary["previous"] = GetCurrentTheme();
        }

        /// <summary>
        /// Parses the display name from a .theme file.
        /// </summary>
        /// <param name="themeFilePath">The full path to the .theme file.</param>
        /// <returns>The display name, or null if not found.</returns>
        private static string GetThemeDisplayName(string themeFilePath)
        {
            try
            {
                foreach (string line in File.ReadLines(themeFilePath))
                {
                    if (line.StartsWith("DisplayName=", StringComparison.OrdinalIgnoreCase))
                    {
                        string displayName = line.Substring("DisplayName=".Length).Trim();
                        
                        // Handle localized strings (e.g., @%SystemRoot%\System32\themeui.dll,-2013)
                        if (displayName.StartsWith("@"))
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

        /// <summary>
        /// Resolves a localized string resource reference.
        /// </summary>
        /// <param name="localizedString">The localized string reference (e.g., @%SystemRoot%\System32\themeui.dll,-2013).</param>
        /// <returns>The resolved string, or the original string if resolution fails.</returns>
        private static string ResolveLocalizedString(string localizedString)
        {
            try
            {
                // Remove the @ prefix
                string resourcePath = localizedString.Substring(1);
                
                // Expand environment variables
                int commaIndex = resourcePath.LastIndexOf(',');
                if (commaIndex > 0)
                {
                    string dllPath = Environment.ExpandEnvironmentVariables(resourcePath.Substring(0, commaIndex));
                    string resourceIdStr = resourcePath.Substring(commaIndex + 1);
                    
                    if (int.TryParse(resourceIdStr, out int resourceId))
                    {
                        StringBuilder buffer = new StringBuilder(256);
                        IntPtr hModule = LoadLibraryEx(dllPath, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
                        if (hModule != IntPtr.Zero)
                        {
                            try
                            {
                                int result = LoadString(hModule, (uint)Math.Abs(resourceId), buffer, buffer.Capacity);
                                if (result > 0)
                                {
                                    return buffer.ToString();
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

        /// <summary>
        /// Returns a list of all installed Windows themes.
        /// </summary>
        /// <returns>A list of theme names (without the .theme extension).</returns>
        public static List<string> GetInstalledThemes()
        {
            HashSet<string> themes = new HashSet<string>();

            themes.UnionWith(s_themeDictionary.Keys);
            themes.UnionWith(s_themeDisplayNameDictionary.Keys);

            return themes.ToList();
        }

        /// <summary>
        /// Gets the current Windows theme name.
        /// </summary>
        /// <returns>The current theme name, or null if it cannot be determined.</returns>
        public static string GetCurrentTheme()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes"))
                {
                    if (key != null)
                    {
                        string currentThemePath = key.GetValue("CurrentTheme") as string;
                        if (!string.IsNullOrEmpty(currentThemePath))
                        {
                            return Path.GetFileNameWithoutExtension(currentThemePath);
                        }
                    }
                }
            }
            catch
            {
                // Ignore errors reading registry
            }
            return null;
        }

        /// <summary>
        /// Applies a Windows theme by name.
        /// </summary>
        /// <param name="themeName">The name of the theme to apply (without .theme extension).</param>
        /// <returns>True if the theme was applied successfully, false otherwise.</returns>
        public static bool ApplyTheme(string themeName)
        {
            string themePath = FindThemePath(themeName);
            if (string.IsNullOrEmpty(themePath))
            {
                return false;
            }

            try
            {
                string previous = GetCurrentTheme();

                if (themeName.ToLowerInvariant() != "previous")
                {
                    // Apply theme by opening the .theme file
                    Process p = Process.Start(themePath);
                    s_previousTheme = previous;

                    p.Exited += P_Exited;

                    return true;
                }
                else
                {
                    bool success = RevertToPreviousTheme();

                    if (success)
                    {
                        s_previousTheme = previous;
                    }

                    return success;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void P_Exited(object sender, EventArgs e)
        {
            Debug.WriteLine(((Process)sender).ExitCode);
        }

        /// <summary>
        /// Reverts to the previous Windows theme.
        /// </summary>
        /// <returns>True if the previous theme was applied successfully, false otherwise.</returns>
        public static bool RevertToPreviousTheme()
        {
            if (string.IsNullOrEmpty(s_previousTheme))
            {
                return false;
            }

            string themePath = FindThemePath(s_previousTheme);
            if (string.IsNullOrEmpty(themePath))
            {
                return false;
            }

            try
            {
                Process.Start(themePath);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Gets the name of the previous theme.
        /// </summary>
        /// <returns>The previous theme name, or null if no theme change has been made.</returns>
        public static string GetPreviousTheme()
        {
            return s_previousTheme;
        }

        /// <summary>
        /// Finds the full path to a theme file by name or display name.
        /// </summary>
        /// <param name="themeName">The name of the theme (file name without extension or display name).</param>
        /// <returns>The full path to the theme file, or null if not found.</returns>
        private static string FindThemePath(string themeName)
        {
            // First check by file name
            if (s_themeDictionary.TryGetValue(themeName, out string themePath))
            {
                return themePath;
            }

            // Then check by display name
            if (s_themeDisplayNameDictionary.TryGetValue(themeName, out string fileNameFromDisplay))
            {
                if (s_themeDictionary.TryGetValue(fileNameFromDisplay, out string themePathFromDisplay))
                {
                    return themePathFromDisplay;
                }
            }

            return null;
        }
    }
}
