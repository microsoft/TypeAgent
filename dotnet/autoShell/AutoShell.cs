// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using AudioSwitcher.AudioApi.CoreAudio;
using System.IO;
using System.Collections;
using Newtonsoft.Json.Linq;
using Microsoft.VisualBasic;
using Microsoft.WindowsAPICodePack.Shell;
using Newtonsoft.Json;


namespace autoShell
{
    // window rect structure
    struct RECT
    {
        public int Left;        // x position of upper-left corner
        public int Top;         // y position of upper-left corner
        public int Right;       // x position of lower-right corner
        public int Bottom;      // y position of lower-right corner
    }

    internal class AutoShell
    {
        // create a map of friendly names to executable paths
        static Hashtable s_friendlyNameToPath = new Hashtable();
        static Hashtable s_friendlyNameToId = new Hashtable();
        static double s_savedVolumePct = 0.0;
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
                { "paint 3d", "C:\\Program Files\\WindowsApps\\Microsoft.MSPaint_10.1807.18022.0_x64__8wekyb3d8bbwe\\"}
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
            CoreAudioDevice defaultPlaybackDevice = new CoreAudioController().DefaultPlaybackDevice;
            s_savedVolumePct = defaultPlaybackDevice.Volume;
            defaultPlaybackDevice.Volume = pct;
        }

        static void RestoreMasterVolume()
        {
            CoreAudioDevice defaultPlaybackDevice = new CoreAudioController().DefaultPlaybackDevice;
            defaultPlaybackDevice.Volume = s_savedVolumePct;
        }

        static void SetMasterMute(bool mute)
        {
            CoreAudioDevice defaultPlaybackDevice = new CoreAudioController().DefaultPlaybackDevice;
            Debug.WriteLine("Current Mute:" + defaultPlaybackDevice.IsMuted);
            defaultPlaybackDevice.Mute(mute);
        }

        // import GetWindowRect
        [DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hWnd, ref RECT Rect);

        // import GetShellWindow
        [DllImport("user32.dll")]
        static extern IntPtr GetShellWindow();

        // import GetDesktopWindow
        [DllImport("user32.dll")]
        static extern IntPtr GetDesktopWindow();

        // import SetForegroundWindow
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", EntryPoint = "SendMessage", SetLastError = true)]
        static extern IntPtr SendMessage(IntPtr hWnd, UInt32 Msg, UInt32 wParam, IntPtr lParam);


        // import SetWindowPos
        [DllImport("user32.dll")]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        // import FindWindowEx
        [DllImport("user32.dll")]
        static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpClassName, string lpWindowName);

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

        // given part of a process name, raise the window of that process to the top level
        static void RaiseWindow(string processName)
        {
            processName = ResolveProcessNameFromFriendlyName(processName);
            Process[] processes = Process.GetProcessesByName(processName);
            bool foundMatch = false;
            // loop through the processes that match the name; raise the first one that has a main window
            foreach (Process p in processes)
            {
                if (p.MainWindowHandle != IntPtr.Zero)
                {
                    foundMatch = true;
                    SetForegroundWindow(p.MainWindowHandle);
                    Interaction.AppActivate(p.Id);
                    break;
                }
            }

            if (!foundMatch)
            {
                // this means all the applications processes are running in the background. This happens for edge and chrome browsers.
                string path = (string)s_friendlyNameToPath[processName];
                if (path != null)
                {
                    Process.Start(path);
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
                    break;
                }
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
                    catch { }
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

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);

        private const int SPI_SETDESKWALLPAPER = 20;
        private const int SPIF_UPDATEINIFILE = 0x01;
        private const int SPIF_SENDCHANGE = 0x02;

        private static void SetDesktopWallpaper(string imagePath)
        {
            SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, imagePath, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        }

        static bool execLine(string line)
        {
            var quit = false;
            // parse the line as a json object with one or more command keys (with values as parameters)
            JObject root = JObject.Parse(line);
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
                    default:
                        Debug.WriteLine("Unknown command: " + key);
                        break;
                }
            }
            return quit;
        }
        static void Main(string[] args)
        {
            bool quit = false;
            while (!quit)
            {
                // read a line from the console
                string line = Console.ReadLine();
                quit = execLine(line);
            }
        }
    }
}
