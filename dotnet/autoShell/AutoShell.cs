// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Controls;
using Microsoft.VisualBasic;
using Microsoft.WindowsAPICodePack.Shell;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using static autoShell.AutoShell;


namespace autoShell;

internal partial class AutoShell
{
    // create a map of friendly names to executable paths
    static Hashtable s_friendlyNameToPath = [];
    static Hashtable s_friendlyNameToId = [];
    static double s_savedVolumePct = 0.0;

    static IServiceProvider10 s_shell;
    static IVirtualDesktopManager s_virtualDesktopManager;
    static IVirtualDesktopManagerInternal s_virtualDesktopManagerInternal;
    static IVirtualDesktopManagerInternal_BUGBUG s_virtualDesktopManagerInternal_BUGBUG;
    static IApplicationViewCollection s_applicationViewCollection;
    static IVirtualDesktopPinnedApps s_virtualDesktopPinnedApps;


    /// <summary>
    /// Constructor used to get system wide information required for specific commands.
    /// </summary>
    static AutoShell()
    {
        // get current user name
        string userName = Environment.UserName;
        SortedList<string, string> sortedList = new SortedList<string, string>
        {
            { "chrome", "chrome.exe" },
            { "power point", "C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE" },
            { "powerpoint", "C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE" },
            { "word", "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" },
            { "winword", "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" },
            { "excel", "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE" },
            { "outlook", "C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE" },
            { "visual studio", "devenv.exe" },
            { "visual studio code", "C:\\Users\\" + userName + "\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
            { "edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" },
            { "microsoft edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" },
            { "notepad", "C:\\Windows\\System32\\notepad.exe" },
            { "paint", "mspaint.exe" },
            { "calculator", "calc.exe" },
            { "file explorer", "C:\\Windows\\explorer.exe" },
            { "control panel", "C:\\Windows\\System32\\control.exe" },
            { "task manager", "C:\\Windows\\System32\\Taskmgr.exe" },
            { "cmd", "C:\\Windows\\System32\\cmd.exe" },
            { "powershell", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
            { "snipping tool", "C:\\Windows\\System32\\SnippingTool.exe" },
            { "magnifier", "C:\\Windows\\System32\\Magnify.exe" },
            { "paint 3d", "C:\\Program Files\\WindowsApps\\Microsoft.MSPaint_10.1807.18022.0_x64__8wekyb3d8bbwe\\"},
            { "m365 copilot", "C:\\Program Files\\WindowsApps\\Microsoft.MicrosoftOfficeHub_19.2512.45041.0_x64__8wekyb3d8bbwe\\M365Copilot.exe" },
            { "copilot", "C:\\Program Files\\WindowsApps\\Microsoft.MicrosoftOfficeHub_19.2512.45041.0_x64__8wekyb3d8bbwe\\M365Copilot.exe" },
            { "spotify", "C:\\Program Files\\WindowsApps\\SpotifyAB.SpotifyMusic_1.279.427.0_x64__zpdnekdrzrea0\\spotify.exe" },
        };

        // add the entries to the hashtable
        foreach (var kvp in sortedList)
        {
            s_friendlyNameToPath.Add(kvp.Key, kvp.Value);
        }

        var installedApps = GetAllInstalledAppsIds();
        foreach (var kvp in installedApps)
        {
            s_friendlyNameToId.Add(kvp.Key, kvp.Value);
        }

        // Load the installed themes
        LoadThemes();

        // Desktop management
        s_shell = (IServiceProvider10)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_ImmersiveShell));
        s_virtualDesktopManagerInternal = (IVirtualDesktopManagerInternal)s_shell.QueryService(CLSID_VirtualDesktopManagerInternal, typeof(IVirtualDesktopManagerInternal).GUID);
        s_virtualDesktopManagerInternal_BUGBUG = (IVirtualDesktopManagerInternal_BUGBUG)s_shell.QueryService(CLSID_VirtualDesktopManagerInternal, typeof(IVirtualDesktopManagerInternal).GUID);
        s_virtualDesktopManager = (IVirtualDesktopManager)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_VirtualDesktopManager));
        s_applicationViewCollection = (IApplicationViewCollection)s_shell.QueryService(typeof(IApplicationViewCollection).GUID, typeof(IApplicationViewCollection).GUID);
        s_virtualDesktopPinnedApps = (IVirtualDesktopPinnedApps)s_shell.QueryService(CLSID_VirtualDesktopPinnedApps, typeof(IVirtualDesktopPinnedApps).GUID);
    }

    /// <summary>
    /// Program entry point
    /// </summary>
    /// <param name="args">Any command line arguments</param>
    static void Main(string[] args)
    {
        string rawCmdLine = Marshal.PtrToStringUni(GetCommandLineW());

        // if there are command line args let's execute those one at a time and then exit
        // user can specify a single JSON object command or an array of them on the command line
        if (args.Length > 0)
        {
            string exe = $"\"{Environment.ProcessPath}\"";
            string cmdLine = rawCmdLine.Replace(exe, "");

            if (cmdLine.StartsWith(exe, StringComparison.OrdinalIgnoreCase))
            {
                cmdLine = cmdLine[exe.Length..];
            }
            else if (cmdLine.StartsWith(Path.GetFileName(Environment.ProcessPath), StringComparison.OrdinalIgnoreCase))
            {
                cmdLine = cmdLine[Path.GetFileName(Environment.ProcessPath).Length..];
            }
            else if (cmdLine.StartsWith(Path.GetFileNameWithoutExtension(Environment.ProcessPath), StringComparison.OrdinalIgnoreCase))
            {
                cmdLine = cmdLine[Path.GetFileNameWithoutExtension(Environment.ProcessPath).Length..];
            }

            try
            {
                JArray commands = JArray.Parse(cmdLine);
                foreach (JObject jo in commands.Children<JObject>())
                {
                    execLine(jo);
                }
            }
            catch (JsonReaderException)
            {
                execLine(JObject.Parse(cmdLine));
            }

            // exit
            return;
        }

        // run in interactive mode, keep accepting commands until we get the shutdown command
        bool quit = false;
        while (!quit)
        {
            try
            {
                // read a line from the console
                string line = Console.ReadLine();

                // if stdin is closed (e.g., piped input finished), exit
                if (line == null)
                {
                    break;
                }

                // parse the line as a json object with one or more command keys (with values as parameters)
                JObject root = JObject.Parse(line);

                // execute the line
                quit = execLine(root);
            }
            catch (Exception ex)
            {
                LogError(ex);
            }
        }
    }

    static void LogError(Exception ex)
    {
        Debug.WriteLine(ex);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine("Error: " + ex.Message);
        Console.ForegroundColor = previousColor;
    }

    static void LogWarning(string message)
    {
        Debug.WriteLine(message);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("Warning: " + message);
        Console.ForegroundColor = previousColor;
    }

    static SortedList<string, string> GetAllInstalledAppsIds()
    {
        // GUID taken from https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid
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
                // The ParsingName property is the AppUserModelID
                appIds.Add(appName, app.ParsingName);
            }
        }

        return appIds;
    }

    static void SetMasterVolume(int pct)
    {
        // Using Windows Core Audio API via COM interop
        try
        {
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out IMMDevice device);
            var audioEndpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref audioEndpointVolumeGuid, 0, IntPtr.Zero, out object obj);
            var audioEndpointVolume = (IAudioEndpointVolume)obj;
            audioEndpointVolume.GetMasterVolumeLevelScalar(out float currentVolume);
            s_savedVolumePct = currentVolume * 100.0;
            audioEndpointVolume.SetMasterVolumeLevelScalar(pct / 100.0f, Guid.Empty);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("Failed to set volume: " + ex.Message);
        }
    }

    static void RestoreMasterVolume()
    {
        // Using Windows Core Audio API via COM interop
        try
        {
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out IMMDevice device);
            var audioEndpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref audioEndpointVolumeGuid, 0, IntPtr.Zero, out object obj);
            var audioEndpointVolume = (IAudioEndpointVolume)obj;
            audioEndpointVolume.SetMasterVolumeLevelScalar((float)(s_savedVolumePct / 100.0), Guid.Empty);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("Failed to restore volume: " + ex.Message);
        }
    }

    static void SetMasterMute(bool mute)
    {
        // Using Windows Core Audio API via COM interop
        try
        {
            var deviceEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            deviceEnumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out IMMDevice device);
            var audioEndpointVolumeGuid = typeof(IAudioEndpointVolume).GUID;
            device.Activate(ref audioEndpointVolumeGuid, 0, IntPtr.Zero, out object obj);
            var audioEndpointVolume = (IAudioEndpointVolume)obj;
            audioEndpointVolume.GetMute(out bool currentMute);
            Debug.WriteLine("Current Mute:" + currentMute);
            audioEndpointVolume.SetMute(mute, Guid.Empty);
        }
        catch (Exception ex)
        {
            Debug.WriteLine("Failed to set mute: " + ex.Message);
        }
    }

    static string ResolveProcessNameFromFriendlyName(string friendlyName)
    {
        string path = (string)s_friendlyNameToPath[friendlyName.ToLowerInvariant()];
        if (path != null)
        {
            return Path.GetFileNameWithoutExtension(path);
        }
        else
        {
            return friendlyName;
        }
    }

    static IntPtr FindProcessWindowHandle(string processName)
    {
        processName = ResolveProcessNameFromFriendlyName(processName);
        Process[] processes = Process.GetProcessesByName(processName);
        // loop through the processes that match the name; raise the first one that has a main window
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                return p.MainWindowHandle;
            }
        }

        // Try to find by window title if we haven't found it and bring it forward
        return FindWindowByTitle(processName).hWnd;
    }

    // given part of a process name, raise the window of that process to the top level
    static void RaiseWindow(string processName)
    {
        processName = ResolveProcessNameFromFriendlyName(processName);
        Process[] processes = Process.GetProcessesByName(processName);
        // loop through the processes that match the name; raise the first one that has a main window
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                SetForegroundWindow(p.MainWindowHandle);
                Interaction.AppActivate(p.Id);
                return;
            }
        }

        // this means all the applications processes are running in the background. This happens for edge and chrome browsers.
        string path = (string)s_friendlyNameToPath[processName];
        if (path != null)
        {
            Process.Start(path);
        }
        else
        {
            // Try to find by window title if we haven't found it and bring it forward
            (nint hWnd1, int pid) = FindWindowByTitle(processName);

            if (hWnd1 != nint.Zero)
            {
                SetForegroundWindow(hWnd1);
                Interaction.AppActivate(pid);
            }
        }
    }

    static void MaximizeWindow(string processName)
    {
        processName = ResolveProcessNameFromFriendlyName(processName);
        Process[] processes = Process.GetProcessesByName(processName);
        // loop through the processes that match the name; raise the first one that has a main window
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                uint WM_SYSCOMMAND = 0x112;
                uint SC_MAXIMIZE = 0xf030;
                SendMessage(p.MainWindowHandle, WM_SYSCOMMAND, SC_MAXIMIZE, IntPtr.Zero);
                SetForegroundWindow(p.MainWindowHandle);
                Interaction.AppActivate(p.Id);
                return;
            }
        }

        // if we haven't found what we are looking for let's enumerate the top level windows and try that way
        (nint hWnd, int pid) = FindWindowByTitle(processName);
        if (hWnd != nint.Zero)
        {
            uint WM_SYSCOMMAND = 0x112;
            uint SC_MAXIMIZE = 0xf030;
            SendMessage(hWnd, WM_SYSCOMMAND, SC_MAXIMIZE, IntPtr.Zero);
            SetForegroundWindow(hWnd);
            Interaction.AppActivate(pid);
        }
    }

    static void MinimizeWindow(string processName)
    {
        processName = ResolveProcessNameFromFriendlyName(processName);
        Process[] processes = Process.GetProcessesByName(processName);
        // loop through the processes that match the name; raise the first one that has a main window
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                uint WM_SYSCOMMAND = 0x112;
                uint SC_MINIMIZE = 0xF020;
                SendMessage(p.MainWindowHandle, WM_SYSCOMMAND, SC_MINIMIZE, IntPtr.Zero);
                break;
            }
        }

        // if we haven't found what we are looking for let's enumerate the top level windows and try that way
        (nint hWnd, int pid) = FindWindowByTitle(processName);
        if (hWnd != nint.Zero)
        {
            uint WM_SYSCOMMAND = 0x112;
            uint SC_MINIMIZE = 0xF020;
            SendMessage(hWnd, WM_SYSCOMMAND, SC_MINIMIZE, IntPtr.Zero);
            SetForegroundWindow(hWnd);
            Interaction.AppActivate(pid);
        }
    }

    static void TileWindowPair(string processName1, string processName2)
    {
        // find both processes
        // TODO: Update this to account for UWP apps (e.g. calculator). UWPs are hosted by ApplicationFrameHost.exe
        processName1 = ResolveProcessNameFromFriendlyName(processName1);
        Process[] processes1 = Process.GetProcessesByName(processName1);
        IntPtr hWnd1 = IntPtr.Zero;
        IntPtr hWnd2 = IntPtr.Zero;
        int pid1 = -1;
        int pid2 = -1;

        foreach (Process p in processes1)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                hWnd1 = p.MainWindowHandle;
                pid1 = p.Id;
                break;
            }
        }

        // If no process found by name, search by window title
        if (hWnd1 == IntPtr.Zero)
        {
            (hWnd1, pid1) = FindWindowByTitle(processName1);
        }

        processName2 = ResolveProcessNameFromFriendlyName(processName2);
        Process[] processes2 = Process.GetProcessesByName(processName2);
        foreach (Process p in processes2)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                hWnd2 = p.MainWindowHandle;
                pid2 = p.Id;
                break;
            }
        }

        // If no process found by name, search by window title
        if (hWnd2 == IntPtr.Zero)
        {
            (hWnd2, pid2) = FindWindowByTitle(processName2);
        }

        if (hWnd1 != IntPtr.Zero && hWnd2 != IntPtr.Zero)
        {
            // TODO: handle multiple monitors
            // get the screen size 
            IntPtr desktopHandle = GetDesktopWindow();
            RECT desktopRect = new RECT();
            GetWindowRect(desktopHandle, ref desktopRect);
            // get the dimensions of the taskbar
            // find the taskbar window
            IntPtr taskbarHandle = IntPtr.Zero;
            IntPtr hWnd = IntPtr.Zero;
            while ((hWnd = FindWindowEx(IntPtr.Zero, hWnd, "Shell_TrayWnd", null)) != IntPtr.Zero)
            {
                // find the taskbar window's child
                taskbarHandle = FindWindowEx(hWnd, IntPtr.Zero, "ReBarWindow32", null);
                if (taskbarHandle != IntPtr.Zero)
                {
                    break;
                }
            }
            if (hWnd == IntPtr.Zero)
            {
                Debug.WriteLine("Taskbar not found");
                return;
            }
            else
            {
                RECT taskbarRect = new RECT();
                GetWindowRect(hWnd, ref taskbarRect);
                Debug.WriteLine("Taskbar Rect: " + taskbarRect.Left + ", " + taskbarRect.Top + ", " + taskbarRect.Right + ", " + taskbarRect.Bottom);
                // TODO: handle left, top, right and nonexistant taskbars
                // subtract the taskbar height from the screen height
                desktopRect.Bottom -= (int)((taskbarRect.Bottom - taskbarRect.Top) / 2);
            }
            // set the window positions using the shellRect and making sure the windows are visible
            int halfwidth = (desktopRect.Right - desktopRect.Left) / 2;
            IntPtr HWND_TOP = IntPtr.Zero;
            uint showWindow = 0x40;
            SetWindowPos(hWnd1, HWND_TOP, desktopRect.Left, desktopRect.Top, halfwidth, desktopRect.Bottom, showWindow);
            SetForegroundWindow(hWnd1);
            Interaction.AppActivate(pid1);
            SetWindowPos(hWnd2, HWND_TOP, desktopRect.Left + halfwidth, desktopRect.Top, halfwidth, desktopRect.Bottom, showWindow);
            SetForegroundWindow(hWnd2);
            Interaction.AppActivate(pid2);
        }
    }

    /// <summary>
    /// Finds a top-level window by searching for a partial match in the window title.
    /// </summary>
    /// <param name="titleSearch">The text to search for in window titles (case-insensitive).</param>
    /// <returns>A tuple containing the window handle and process ID, or (IntPtr.Zero, -1) if not found.</returns>
    static (IntPtr hWnd, int pid) FindWindowByTitle(string titleSearch)
    {
        IntPtr foundHandle = IntPtr.Zero;
        int foundPid = -1;
        StringBuilder windowTitle = new StringBuilder(256);

        EnumWindows((hWnd, lParam) =>
        {
            // Only consider visible windows
            if (!IsWindowVisible(hWnd))
            {
                return true; // Continue enumeration
            }

            // Get window title
            int length = GetWindowText(hWnd, windowTitle, windowTitle.Capacity);
            if (length > 0)
            {
                string title = windowTitle.ToString();
                // Case-insensitive partial match
                if (title.Contains(titleSearch, StringComparison.OrdinalIgnoreCase))
                {
                    foundHandle = hWnd;
                    GetWindowThreadProcessId(hWnd, out uint pid);
                    foundPid = (int)pid;
                    return false; // Stop enumeration
                }
            }
            return true; // Continue enumeration
        }, IntPtr.Zero);

        return (foundHandle, foundPid);
    }

    // given a friendly name, check if it's running and if not, start it; if it's running raise it to the top level
    static void OpenApplication(string friendlyName)
    {
        // check to see if the application is running
        Process[] processes = Process.GetProcessesByName(friendlyName);
        if (processes.Length == 0)
        {
            // if not, start it
            Debug.WriteLine("Starting " + friendlyName);
            string path = (string)s_friendlyNameToPath[friendlyName.ToLowerInvariant()];
            if (path != null)
            {
                try
                {
                    Process.Start(path);
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // alternate start method
                    Process.Start(friendlyName);
                }
            }
            else
            {
                string appModelUserID = (string)s_friendlyNameToId[friendlyName.ToLowerInvariant()];
                if (appModelUserID != null)
                {
                    try
                    {
                        Process.Start("explorer.exe", @" shell:appsFolder\" + appModelUserID);
                    }
                    catch { }
                }
            }
        }
        else
        {
            // if so, raise it to the top level
            Debug.WriteLine("Raising " + friendlyName);
            RaiseWindow(friendlyName);
        }
    }

    // close application
    static void CloseApplication(string friendlyName)
    {
        // check to see if the application is running
        string processName = ResolveProcessNameFromFriendlyName(friendlyName);
        Process[] processes = Process.GetProcessesByName(processName);
        if (processes.Length != 0)
        {
            // if so, close it
            Debug.WriteLine("Closing " + friendlyName);
            foreach (Process p in processes)
            {
                if (p.MainWindowHandle != IntPtr.Zero)
                {
                    p.CloseMainWindow();
                }
            }
        }
    }

    private static void SetDesktopWallpaper(string imagePath)
    {
        SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, imagePath, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
    }

    /// <summary>
    /// Creates virtual desktops from a JSON array of desktop names.
    /// </summary>
    /// <param name="jsonValue">JSON array containing desktop names, e.g., ["Work", "Personal", "Gaming"]</param>
    static void CreateDesktop(string jsonValue)
    {
        try
        {
            // Parse the JSON array of desktop names
            JArray desktopNames = JArray.Parse(jsonValue);

            if (desktopNames == null || desktopNames.Count == 0)
            {
                desktopNames = ["desktop X"];
            }

            if (s_virtualDesktopManagerInternal == null)
            {
                Debug.WriteLine($"Failed to get Virtual Desktop Manager Internal");
                return;
            }

            foreach (JToken desktopNameToken in desktopNames)
            {
                string desktopName = desktopNameToken.ToString();

                if (string.IsNullOrWhiteSpace(desktopName))
                {
                    continue;
                }

                try
                {
                    // Create a new virtual desktop
                    IVirtualDesktop newDesktop = s_virtualDesktopManagerInternal.CreateDesktop();

                    if (newDesktop != null)
                    {
                        // Set the desktop name (Windows 10 build 20231+ / Windows 11)
                        try
                        {
                            // TODO: debug & get working
                            // Works in .NET framework but not .NET
                            //s_virtualDesktopManagerInternal_BUGBUG.SetDesktopName(newDesktop, desktopName);
                            //Debug.WriteLine($"Created virtual desktop: {desktopName}");
                        }
                        catch (Exception ex2)
                        {
                            // Older Windows version - name setting not supported
                            Debug.WriteLine($"Created virtual desktop (naming not supported on this Windows version): {ex2.Message}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"Failed to create desktop '{desktopName}': {ex.Message}");
                }
            }
        }
        catch (JsonException ex)
        {
            Debug.WriteLine($"Failed to parse desktop names JSON: {ex.Message}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Error creating desktops: {ex.Message}");
        }
    }

    static void SwitchDesktop(string desktopIdentifier)
    {
        if (!int.TryParse(desktopIdentifier, out int index))
        {
            // Try to find the desktop by name
            s_virtualDesktopManagerInternal.SwitchDesktop(FindDesktopByName(desktopIdentifier));
        }
        else
        {
            SwitchDesktop(index);
        }
    }

    static void SwitchDesktop(int index)
    {
        s_virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
        desktops.GetAt(index, typeof(IVirtualDesktop).GUID, out object od);

        // BUGBUG: different windows versions use different COM interfaces
        // Different Windows versions use different COM interfaces for desktop switching
        // Windows 11 22H2 (build 22621) and later use the updated interface
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22621))
        {
            // Use the BUGBUG interface for Windows 11 22H2+
            s_virtualDesktopManagerInternal_BUGBUG.SwitchDesktopWithAnimation((IVirtualDesktop)od);
        }
        else if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            // Windows 11 21H2 (build 22000)
            s_virtualDesktopManagerInternal.SwitchDesktopWithAnimation((IVirtualDesktop)od);
        }
        else
        {
            // Windows 10 - use the original interface
            s_virtualDesktopManagerInternal.SwitchDesktopAndMoveForegroundView((IVirtualDesktop)od);
        }

        Marshal.ReleaseComObject(desktops);
    }

    static void BumpDesktopIndex(int bump)
    {
        IVirtualDesktop desktop = s_virtualDesktopManagerInternal.GetCurrentDesktop();
        int index = GetDesktopIndex(desktop);
        int count = s_virtualDesktopManagerInternal.GetCount();

        if (index == -1)
        {
            Debug.WriteLine("Undable to get the index of the current desktop");
            return;
        }

        index += bump;

        if (index > count)
        {
            index = 0;
        }
        else if (index < 0)
        {
            index = count - 1;
        }

        SwitchDesktop(index);
    }

    static IVirtualDesktop FindDesktopByName(string name)
    {
        int count = s_virtualDesktopManagerInternal.GetCount();

        s_virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
        for (int i = 0; i < count; i++)
        {
            desktops.GetAt(i, typeof(IVirtualDesktop).GUID, out object od);

            if (string.Equals(((IVirtualDesktop)od).GetName(), name, StringComparison.OrdinalIgnoreCase))
            {
                Marshal.ReleaseComObject(desktops);
                return (IVirtualDesktop)od;
            }
        }

        Marshal.ReleaseComObject(desktops);

        return null;
    }

    static int GetDesktopIndex(IVirtualDesktop desktop)
    {
        int index = -1;
        int count = s_virtualDesktopManagerInternal.GetCount();

        s_virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
        for (int i = 0; i < count; i++)
        {
            desktops.GetAt(i, typeof(IVirtualDesktop).GUID, out object od);

            if (desktop.GetId() == ((IVirtualDesktop)od).GetId())
            {
                Marshal.ReleaseComObject(desktops);
                return i;
            }
        }

        Marshal.ReleaseComObject(desktops);

        return -1;
    }

    /// <summary>
    /// 
    /// </summary>
    /// <param name="value"></param>
    /// <remarks>Currently not working correction, returns ACCESS_DENIED // TODO: investigate</remarks>
    static void MoveWindowToDesktop(JToken value)
    {
        string process = value.SelectToken("process").ToString();
        string desktop = value.SelectToken("desktop").ToString();
        if (string.IsNullOrEmpty(process))
        {
            Debug.WriteLine("No process name supplied");
            return;
        }

        if (string.IsNullOrEmpty(desktop))
        {
            Debug.WriteLine("No desktop id supplied");
            return;
        }

        IntPtr hWnd = FindProcessWindowHandle(process);

        if (int.TryParse(desktop, out int desktopIndex))
        {
            s_virtualDesktopManagerInternal.GetDesktops(out IObjectArray desktops);
            if (desktopIndex < 1 || desktopIndex > s_virtualDesktopManagerInternal.GetCount())
            {
                Debug.WriteLine("Desktop index out of range");
                Marshal.ReleaseComObject(desktops);
                return;
            }
            desktops.GetAt(desktopIndex - 1, typeof(IVirtualDesktop).GUID, out object od);
            Guid g = ((IVirtualDesktop)od).GetId();
            s_virtualDesktopManager.MoveWindowToDesktop(hWnd, ref g);
            Marshal.ReleaseComObject(desktops);
            return;
        }

        IVirtualDesktop ivd = FindDesktopByName(desktop);
        if (ivd is not null)
        {
            Guid desktopGuid = ivd.GetId();
            s_virtualDesktopManager.MoveWindowToDesktop(hWnd, ref desktopGuid);
        }
    }

    static void PinWindow(string processName)
    {
        IntPtr hWnd = FindProcessWindowHandle(processName);

        if (hWnd != IntPtr.Zero)
        {
            s_applicationViewCollection.GetViewForHwnd(hWnd, out IApplicationView view);

            if (view is not null)
            {
                s_virtualDesktopPinnedApps.PinView((IApplicationView)view);
            }
        }
        else
        {
            Console.WriteLine($"The window handle for '{processName}' could not be found");
        }
    }

    static IVirtualDesktopManagerInternal GetVirtualDesktopManagerInternal()
    {
        try
        {
            IServiceProvider shellServiceProvider = (IServiceProvider)Activator.CreateInstance(
                Type.GetTypeFromCLSID(CLSID_ImmersiveShell));

            shellServiceProvider.QueryService(
                CLSID_VirtualDesktopManagerInternal,
                typeof(IVirtualDesktopManagerInternal).GUID,
                out object objVirtualDesktopManagerInternal);

            return (IVirtualDesktopManagerInternal)objVirtualDesktopManagerInternal;
        }
        catch
        {
            return null;
        }
    }

    static bool execLine(JObject root)
    {
        var quit = false;
        foreach (var kvp in root)
        {
            string key = kvp.Key;
            string value = kvp.Value.ToString();
            switch (key)
            {
                case "launchProgram":
                    OpenApplication(value);
                    break;
                case "closeProgram":
                    CloseApplication(value);
                    break;
                case "maximize":
                    MaximizeWindow(value);
                    break;
                case "minimize":
                    MinimizeWindow(value);
                    break;
                case "switchTo":
                    RaiseWindow(value);
                    break;
                case "quit":
                    quit = true;
                    break;
                case "tile":
                    string[] apps = value.Split(',');
                    if (apps.Length == 2)
                    {
                        TileWindowPair(apps[0], apps[1]);
                    }
                    break;
                case "volume":
                    int pct = 0;
                    if (int.TryParse(value, out pct))
                    {
                        SetMasterVolume(pct);
                    }
                    break;
                case "restoreVolume":
                    RestoreMasterVolume();
                    break;
                case "mute":
                    bool mute = false;
                    if (bool.TryParse(value, out mute))
                    {
                        SetMasterMute(mute);
                    }
                    break;
                case "listAppNames":
                    var installedApps = GetAllInstalledAppsIds();
                    Console.WriteLine(JsonConvert.SerializeObject(installedApps.Keys));
                    break;
                case "setWallpaper":
                    SetDesktopWallpaper(value);
                    break;
                case "applyTheme":
                    bool result = ApplyTheme(value);
                    break;
                case "listThemes":
                    var themes = GetInstalledThemes();
                    Console.WriteLine(JsonConvert.SerializeObject(themes));
                    break;
                case "setThemeMode":
                    // value can be "light", "dark", "toggle", or boolean
                    if (value.Equals("toggle", StringComparison.OrdinalIgnoreCase))
                    {
                        ToggleLightDarkMode();
                    }
                    else
                    {
                        bool useLightMode;
                        if (bool.TryParse(value, out useLightMode))
                        {
                            SetLightDarkMode(useLightMode);
                        }
                        else if (value.Equals("light", StringComparison.OrdinalIgnoreCase))
                        {
                            SetLightDarkMode(true);
                        }
                        else if (value.Equals("dark", StringComparison.OrdinalIgnoreCase))
                        {
                            SetLightDarkMode(false);
                        }
                    }
                    break;
                case "createDesktop":
                    CreateDesktop(value);
                    break;
                case "switchDesktop":
                    SwitchDesktop(value);
                    break;
                case "nextDesktop":
                    BumpDesktopIndex(1);
                    break;
                case "previousDesktop":
                    BumpDesktopIndex(-1);
                    break;
                case "moveWindowToDesktop":
                    MoveWindowToDesktop(kvp.Value);
                    break;
                case "pinWindow":
                    PinWindow(value);
                    break;
                case "toggleNotifications":
                    ShellExecute(IntPtr.Zero, "open", "ms-actioncenter:", null, null, 1);
                    break;
                case "debug":
                    Debugger.Launch();
                    break;
                case "toggleAirplaneMode":
                    SetAirplaneMode(bool.Parse(value));
                    break;
                case "listWifiNetworks":
                    ListWifiNetworks();
                    break;
                case "connectWifi":
                    JObject netInfo = JObject.Parse(value);
                    string ssid = netInfo.Value<string>("ssid");
                    string password = netInfo["password"] is not null ? netInfo.Value<string>("password") : "";
                    ConnectToWifi(ssid, password);
                    break;
                case "disconnectWifi":
                    DisconnectFromWifi();
                    break;
                default:
                    Debug.WriteLine("Unknown command: " + key);
                    break;
            }
        }
        return quit;
    }

    /// <summary>
    /// Sets the airplane mode state using the Radio Management API.
    /// </summary>
    /// <param name="enable">True to enable airplane mode, false to disable.</param>
    static void SetAirplaneMode(bool enable)
    {
        IRadioManager radioManager = null;
        try
        {
            // Create the Radio Management API COM object
            Type radioManagerType = Type.GetTypeFromCLSID(CLSID_RadioManagementAPI);
            if (radioManagerType == null)
            {
                Debug.WriteLine("Failed to get Radio Management API type");
                return;
            }

            object obj = Activator.CreateInstance(radioManagerType);
            radioManager = (IRadioManager)obj;

            if (radioManager == null)
            {
                Debug.WriteLine("Failed to create Radio Manager instance");
                return;
            }

            // Get current state (for logging)
            int hr = radioManager.GetSystemRadioState(out int currentState, out int _, out int _);
            if (hr < 0)
            {
                Debug.WriteLine($"Failed to get system radio state: HRESULT 0x{hr:X8}");
                return;
            }

            // currentState: 0 = airplane mode ON (radios off), 1 = airplane mode OFF (radios on)
            bool airplaneModeCurrentlyOn = currentState == 0;
            Debug.WriteLine($"Current airplane mode state: {(airplaneModeCurrentlyOn ? "on" : "off")}");

            // Set the new state
            // bEnabled: 0 = turn airplane mode ON (disable radios), 1 = turn airplane mode OFF (enable radios)
            int newState = enable ? 0 : 1;
            hr = radioManager.SetSystemRadioState(newState);
            if (hr < 0)
            {
                Debug.WriteLine($"Failed to set system radio state: HRESULT 0x{hr:X8}");
                return;
            }

            Debug.WriteLine($"Airplane mode set to: {(enable ? "on" : "off")}");
        }
        catch (COMException ex)
        {
            Debug.WriteLine($"COM Exception setting airplane mode: {ex.Message} (HRESULT: 0x{ex.HResult:X8})");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to set airplane mode: {ex.Message}");
        }
        finally
        {
            if (radioManager != null)
            {
                Marshal.ReleaseComObject(radioManager);
            }
        }
    }

    /// <summary>
    /// Lists all WiFi networks currently in range.
    /// </summary>
    static void ListWifiNetworks()
    {
        IntPtr clientHandle = IntPtr.Zero;
        IntPtr wlanInterfaceList = IntPtr.Zero;
        IntPtr networkList = IntPtr.Zero;

        try
        {
            // Open WLAN handle
            int result = WlanOpenHandle(2, IntPtr.Zero, out uint negotiatedVersion, out clientHandle);
            if (result != 0)
            {
                Debug.WriteLine($"Failed to open WLAN handle: {result}");
                return;
            }

            // Enumerate wireless interfaces
            result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out wlanInterfaceList);
            if (result != 0)
            {
                Debug.WriteLine($"Failed to enumerate WLAN interfaces: {result}");
                return;
            }

            WLAN_INTERFACE_INFO_LIST interfaceList = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(wlanInterfaceList);

            if (interfaceList.dwNumberOfItems == 0)
            {
                Console.WriteLine("[]");
                return;
            }

            var allNetworks = new List<object>();

            for (int i = 0; i < interfaceList.dwNumberOfItems; i++)
            {
                WLAN_INTERFACE_INFO interfaceInfo = interfaceList.InterfaceInfo[i];

                // Scan for networks (trigger a refresh)
                WlanScan(clientHandle, ref interfaceInfo.InterfaceGuid, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);

                // Small delay to allow scan to complete
                System.Threading.Thread.Sleep(100);

                // Get available networks
                result = WlanGetAvailableNetworkList(clientHandle, ref interfaceInfo.InterfaceGuid, 0, IntPtr.Zero, out networkList);
                if (result != 0)
                {
                    Debug.WriteLine($"Failed to get network list: {result}");
                    continue;
                }

                WLAN_AVAILABLE_NETWORK_LIST availableNetworkList = Marshal.PtrToStructure<WLAN_AVAILABLE_NETWORK_LIST>(networkList);

                IntPtr networkPtr = networkList + 8; // Skip dwNumberOfItems and dwIndex

                for (int j = 0; j < availableNetworkList.dwNumberOfItems; j++)
                {
                    WLAN_AVAILABLE_NETWORK network = Marshal.PtrToStructure<WLAN_AVAILABLE_NETWORK>(networkPtr);

                    string ssid = Encoding.ASCII.GetString(network.dot11Ssid.SSID, 0, (int)network.dot11Ssid.SSIDLength);

                    if (!string.IsNullOrEmpty(ssid))
                    {
                        allNetworks.Add(new
                        {
                            SSID = ssid,
                            SignalQuality = network.wlanSignalQuality,
                            Secured = network.bSecurityEnabled,
                            Connected = (network.dwFlags & 1) != 0 // WLAN_AVAILABLE_NETWORK_CONNECTED
                        });
                    }

                    networkPtr += Marshal.SizeOf<WLAN_AVAILABLE_NETWORK>();
                }

                if (networkList != IntPtr.Zero)
                {
                    WlanFreeMemory(networkList);
                    networkList = IntPtr.Zero;
                }
            }

            // Remove duplicates and sort by signal strength
            var uniqueNetworks = allNetworks
                .GroupBy(n => ((dynamic)n).SSID)
                .Select(g => g.OrderByDescending(n => ((dynamic)n).SignalQuality).First())
                .OrderByDescending(n => ((dynamic)n).SignalQuality)
                .ToList();

            Console.WriteLine(JsonConvert.SerializeObject(uniqueNetworks));
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Error listing WiFi networks: {ex.Message}");
            Console.WriteLine("[]");
        }
        finally
        {
            if (networkList != IntPtr.Zero)
                WlanFreeMemory(networkList);
            if (wlanInterfaceList != IntPtr.Zero)
                WlanFreeMemory(wlanInterfaceList);
            if (clientHandle != IntPtr.Zero)
                WlanCloseHandle(clientHandle, IntPtr.Zero);
        }
    }

    /// <summary>
    /// Connects to a WiFi network by name (SSID). If the network requires a password and one is provided,
    /// it will create a temporary profile. For networks with existing profiles, it connects using the profile.
    /// </summary>
    /// <param name="ssid">The SSID of the network to connect to.</param>
    /// <param name="password">Optional password for secured networks.</param>
    static void ConnectToWifi(string ssid, string password = null)
    {
        IntPtr clientHandle = IntPtr.Zero;
        IntPtr wlanInterfaceList = IntPtr.Zero;

        try
        {
            // Open WLAN handle
            int result = WlanOpenHandle(2, IntPtr.Zero, out uint negotiatedVersion, out clientHandle);
            if (result != 0)
            {
                LogWarning($"Failed to open WLAN handle: {result}");
                return;
            }

            // Enumerate wireless interfaces
            result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out wlanInterfaceList);
            if (result != 0)
            {
                LogWarning($"Failed to enumerate WLAN interfaces: {result}");
                return;
            }

            WLAN_INTERFACE_INFO_LIST interfaceList = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(wlanInterfaceList);

            if (interfaceList.dwNumberOfItems == 0)
            {
                LogWarning("No wireless interfaces found.");
                return;
            }

            // Use the first available wireless interface
            WLAN_INTERFACE_INFO interfaceInfo = interfaceList.InterfaceInfo[0];

            // If password is provided, create a profile and connect
            if (!string.IsNullOrEmpty(password))
            {
                string profileXml = GenerateWifiProfileXml(ssid, password);

                result = WlanSetProfile(clientHandle, ref interfaceInfo.InterfaceGuid, 0, profileXml, null, true, IntPtr.Zero, out uint reasonCode);
                if (result != 0)
                {
                    LogWarning($"Failed to set WiFi profile: {result}, reason: {reasonCode}");
                    return;
                }
            }

            // Set up connection parameters
            WLAN_CONNECTION_PARAMETERS connectionParams = new WLAN_CONNECTION_PARAMETERS
            {
                wlanConnectionMode = WLAN_CONNECTION_MODE.wlan_connection_mode_profile,
                strProfile = ssid,
                pDot11Ssid = IntPtr.Zero,
                pDesiredBssidList = IntPtr.Zero,
                dot11BssType = DOT11_BSS_TYPE.dot11_BSS_type_any,
                dwFlags = 0
            };

            result = WlanConnect(clientHandle, ref interfaceInfo.InterfaceGuid, ref connectionParams, IntPtr.Zero);
            if (result != 0)
            {
                LogWarning($"Failed to connect to WiFi network '{ssid}': {result}");
                return;
            }

            Debug.WriteLine($"Successfully initiated connection to WiFi network: {ssid}");
            Console.WriteLine($"Connecting to WiFi network: {ssid}");
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
        finally
        {
            if (wlanInterfaceList != IntPtr.Zero)
                WlanFreeMemory(wlanInterfaceList);
            if (clientHandle != IntPtr.Zero)
                WlanCloseHandle(clientHandle, IntPtr.Zero);
        }
    }

    /// <summary>
    /// Generates a WiFi profile XML for WPA2-Personal (PSK) networks.
    /// </summary>
    static string GenerateWifiProfileXml(string ssid, string password)
    {
        // Convert SSID to hex
        string ssidHex = BitConverter.ToString(Encoding.UTF8.GetBytes(ssid)).Replace("-", "");

        return $@"<?xml version=""1.0""?>
<WLANProfile xmlns=""http://www.microsoft.com/networking/WLAN/profile/v1"">
    <name>{ssid}</name>
    <SSIDConfig>
        <SSID>
            <hex>{ssidHex}</hex>
            <name>{ssid}</name>
        </SSID>
    </SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>auto</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>WPA2PSK</authentication>
                <encryption>AES</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
            <sharedKey>
                <keyType>passPhrase</keyType>
                <protected>false</protected>
                <keyMaterial>{password}</keyMaterial>
            </sharedKey>
        </security>
    </MSM>
</WLANProfile>";
    }

    /// <summary>
    /// Disconnects from the currently connected WiFi network.
    /// </summary>
    static void DisconnectFromWifi()
    {
        IntPtr clientHandle = IntPtr.Zero;
        IntPtr wlanInterfaceList = IntPtr.Zero;

        try
        {
            // Open WLAN handle
            int result = WlanOpenHandle(2, IntPtr.Zero, out uint negotiatedVersion, out clientHandle);
            if (result != 0)
            {
                LogWarning($"Failed to open WLAN handle: {result}");
                return;
            }

            // Enumerate wireless interfaces
            result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out wlanInterfaceList);
            if (result != 0)
            {
                LogWarning($"Failed to enumerate WLAN interfaces: {result}");
                return;
            }

            WLAN_INTERFACE_INFO_LIST interfaceList = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(wlanInterfaceList);

            if (interfaceList.dwNumberOfItems == 0)
            {
                LogWarning("No wireless interfaces found.");
                return;
            }

            // Disconnect from all wireless interfaces
            for (int i = 0; i < interfaceList.dwNumberOfItems; i++)
            {
                WLAN_INTERFACE_INFO interfaceInfo = interfaceList.InterfaceInfo[i];

                result = WlanDisconnect(clientHandle, ref interfaceInfo.InterfaceGuid, IntPtr.Zero);
                if (result != 0)
                {
                    LogWarning($"Failed to disconnect from WiFi on interface {i}: {result}");
                }
                else
                {
                    Debug.WriteLine($"Successfully disconnected from WiFi on interface: {interfaceInfo.strInterfaceDescription}");
                    Console.WriteLine("Disconnected from WiFi");
                }
            }
        }
        catch (Exception ex)
        {
            LogError(ex);
        }
        finally
        {
            if (wlanInterfaceList != IntPtr.Zero)
                WlanFreeMemory(wlanInterfaceList);
            if (clientHandle != IntPtr.Zero)
                WlanCloseHandle(clientHandle, IntPtr.Zero);
        }
    }
}
