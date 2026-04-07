// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using autoShell.Logging;
using autoShell.Services.Interop;
using Microsoft.VisualBasic;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IWindowService"/> using Win32 P/Invoke.
/// </summary>
internal class WindowsWindowService : IWindowService
{
    #region P/Invoke

    private const uint WM_SYSCOMMAND = 0x112;
    private const uint SC_MAXIMIZE = 0xF030;
    private const uint SC_MINIMIZE = 0xF020;

    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport(NativeDlls.User32)]
    private static extern bool GetWindowRect(IntPtr hWnd, ref RECT rect);

    [DllImport(NativeDlls.User32)]
    private static extern IntPtr GetDesktopWindow();

    [DllImport(NativeDlls.User32)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport(NativeDlls.User32, EntryPoint = "SendMessage", SetLastError = true)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, uint wParam, IntPtr lParam);

    [DllImport(NativeDlls.User32)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport(NativeDlls.User32)]
    private static extern bool ShowWindow(IntPtr hWnd, uint nCmdShow);

    [DllImport(NativeDlls.User32)]
    private static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpClassName, string lpWindowName);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport(NativeDlls.User32)]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport(NativeDlls.User32)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport(NativeDlls.User32)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport(NativeDlls.User32)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    #endregion

    private readonly ILogger _logger;

    public WindowsWindowService(ILogger logger)
    {
        _logger = logger;
    }

    /// <inheritdoc/>
    public void MaximizeWindow(string processName)
    {
        Process[] processes = Process.GetProcessesByName(processName);
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                SendMessage(p.MainWindowHandle, WM_SYSCOMMAND, SC_MAXIMIZE, IntPtr.Zero);
                SetForegroundWindow(p.MainWindowHandle);
                Interaction.AppActivate(p.Id);
                return;
            }
        }

        (nint hWnd, int pid) = FindWindowByTitle(processName);
        if (hWnd != nint.Zero)
        {
            SendMessage(hWnd, WM_SYSCOMMAND, SC_MAXIMIZE, IntPtr.Zero);
            SetForegroundWindow(hWnd);
            Interaction.AppActivate(pid);
        }
    }

    /// <inheritdoc/>
    public void MinimizeWindow(string processName)
    {
        Process[] processes = Process.GetProcessesByName(processName);
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                SendMessage(p.MainWindowHandle, WM_SYSCOMMAND, SC_MINIMIZE, IntPtr.Zero);
                return;
            }
        }

        (nint hWnd, int pid) = FindWindowByTitle(processName);
        if (hWnd != nint.Zero)
        {
            SendMessage(hWnd, WM_SYSCOMMAND, SC_MINIMIZE, IntPtr.Zero);
        }
    }

    /// <inheritdoc/>
    public void RaiseWindow(string processName, string executablePath)
    {
        Process[] processes = Process.GetProcessesByName(processName);
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                SetForegroundWindow(p.MainWindowHandle);
                Interaction.AppActivate(p.Id);
                return;
            }
        }

        // All processes are background-only (e.g. Edge, Chrome). Try launching by path.
        if (executablePath != null)
        {
            Process.Start(executablePath);
        }
        else
        {
            // Try to find by window title
            (nint hWnd1, int pid) = FindWindowByTitle(processName);
            if (hWnd1 != nint.Zero)
            {
                SetForegroundWindow(hWnd1);
                Interaction.AppActivate(pid);
            }
        }
    }

    /// <inheritdoc/>
    public void TileWindows(string processName1, string processName2)
    {
        // TODO: Update this to account for UWP apps (e.g. calculator). UWPs are hosted by ApplicationFrameHost.exe
        IntPtr hWnd1 = IntPtr.Zero;
        IntPtr hWnd2 = IntPtr.Zero;
        int pid1 = -1;
        int pid2 = -1;

        Process[] processes1 = Process.GetProcessesByName(processName1);
        foreach (Process p in processes1)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                hWnd1 = p.MainWindowHandle;
                pid1 = p.Id;
                break;
            }
        }

        if (hWnd1 == IntPtr.Zero)
        {
            (hWnd1, pid1) = FindWindowByTitle(processName1);
        }

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

        if (hWnd2 == IntPtr.Zero)
        {
            (hWnd2, pid2) = FindWindowByTitle(processName2);
        }

        if (hWnd1 != IntPtr.Zero && hWnd2 != IntPtr.Zero)
        {
            // TODO: handle multiple monitors
            IntPtr desktopHandle = GetDesktopWindow();
            RECT desktopRect = new RECT();
            GetWindowRect(desktopHandle, ref desktopRect);

            // Find the taskbar to subtract its height
            IntPtr taskbarHandle = IntPtr.Zero;
            IntPtr hWnd = IntPtr.Zero;
            while ((hWnd = FindWindowEx(IntPtr.Zero, hWnd, "Shell_TrayWnd", null)) != IntPtr.Zero)
            {
                taskbarHandle = FindWindowEx(hWnd, IntPtr.Zero, "ReBarWindow32", null);
                if (taskbarHandle != IntPtr.Zero)
                {
                    break;
                }
            }
            if (hWnd == IntPtr.Zero)
            {
                _logger.Debug("Taskbar not found");
                return;
            }
            else
            {
                RECT taskbarRect = new RECT();
                GetWindowRect(hWnd, ref taskbarRect);
                _logger.Debug("Taskbar Rect: " + taskbarRect.Left + ", " + taskbarRect.Top + ", " + taskbarRect.Right + ", " + taskbarRect.Bottom);
                // TODO: handle left, top, right and nonexistent taskbars
                desktopRect.Bottom -= (int)((taskbarRect.Bottom - taskbarRect.Top) / 2);
            }

            int halfwidth = (desktopRect.Right - desktopRect.Left) / 2;
            int height = desktopRect.Bottom - desktopRect.Top;
            IntPtr HWND_TOP = IntPtr.Zero;
            uint showWindow = 0x40;

            // Restore windows first (SetWindowPos won't work on maximized windows)
            uint SW_RESTORE = 9;
            ShowWindow(hWnd1, SW_RESTORE);
            ShowWindow(hWnd2, SW_RESTORE);

            SetWindowPos(hWnd1, HWND_TOP, desktopRect.Left, desktopRect.Top, halfwidth, height, showWindow);
            SetForegroundWindow(hWnd1);
            Interaction.AppActivate(pid1);
            SetWindowPos(hWnd2, HWND_TOP, desktopRect.Left + halfwidth, desktopRect.Top, halfwidth, height, showWindow);
            SetForegroundWindow(hWnd2);
            Interaction.AppActivate(pid2);
        }
    }

    /// <inheritdoc/>
    public IntPtr FindProcessWindowHandle(string processName)
    {
        Process[] processes = Process.GetProcessesByName(processName);
        foreach (Process p in processes)
        {
            if (p.MainWindowHandle != IntPtr.Zero)
            {
                return p.MainWindowHandle;
            }
        }

        return FindWindowByTitle(processName).hWnd;
    }

    /// <summary>
    /// Finds a top-level window by partial title match (case-insensitive).
    /// </summary>
    private static (IntPtr hWnd, int pid) FindWindowByTitle(string titleSearch)
    {
        IntPtr foundHandle = IntPtr.Zero;
        int foundPid = -1;
        StringBuilder windowTitle = new StringBuilder(256);

        EnumWindows((hWnd, lParam) =>
        {
            if (!IsWindowVisible(hWnd))
            {
                return true;
            }

            int length = GetWindowText(hWnd, windowTitle, windowTitle.Capacity);
            if (length > 0)
            {
                string title = windowTitle.ToString();
                if (title.Contains(titleSearch, StringComparison.OrdinalIgnoreCase))
                {
                    foundHandle = hWnd;
                    _ = GetWindowThreadProcessId(hWnd, out uint pid);
                    foundPid = (int)pid;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);

        return (foundHandle, foundPid);
    }
}
