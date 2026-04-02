// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles virtual desktop commands: CreateDesktop, MoveWindowToDesktop, NextDesktop,
/// PinWindow, PreviousDesktop, and SwitchDesktop.
/// </summary>
internal class VirtualDesktopCommandHandler : ICommandHandler
{
    private readonly IAppRegistry _appRegistry;
    private readonly IProcessService _process;
    private readonly IVirtualDesktopService _virtualDesktop;

    public VirtualDesktopCommandHandler(IAppRegistry appRegistry, IProcessService process, IVirtualDesktopService virtualDesktop)
    {
        _appRegistry = appRegistry;
        _process = process;
        _virtualDesktop = virtualDesktop;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "CreateDesktop",
        "MoveWindowToDesktop",
        "NextDesktop",
        "PinWindow",
        "PreviousDesktop",
        "SwitchDesktop",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "CreateDesktop":
                _virtualDesktop.CreateDesktops(value);
                break;

            case "MoveWindowToDesktop":
                string process = rawValue.SelectToken("process")?.ToString();
                string desktop = rawValue.SelectToken("desktop")?.ToString();
                if (!string.IsNullOrEmpty(process) && !string.IsNullOrEmpty(desktop))
                {
                    string resolvedName = _appRegistry.ResolveProcessName(process);
                    IntPtr hWnd = FindMainWindowHandle(resolvedName);
                    if (hWnd != IntPtr.Zero)
                    {
                        _virtualDesktop.MoveWindowToDesktop(hWnd, desktop);
                    }
                }
                break;

            case "NextDesktop":
                _virtualDesktop.NextDesktop();
                break;

            case "PinWindow":
                string pinProcess = _appRegistry.ResolveProcessName(value);
                IntPtr pinHWnd = FindMainWindowHandle(pinProcess);
                if (pinHWnd != IntPtr.Zero)
                {
                    _virtualDesktop.PinWindow(pinHWnd);
                }
                else
                {
                    Console.WriteLine($"The window handle for '{value}' could not be found");
                }
                break;

            case "PreviousDesktop":
                _virtualDesktop.PreviousDesktop();
                break;

            case "SwitchDesktop":
                _virtualDesktop.SwitchDesktop(value);
                break;
        }
    }

    private IntPtr FindMainWindowHandle(string processName)
    {
        foreach (Process p in _process.GetProcessesByName(processName))
        {
            if (p.MainWindowHandle != IntPtr.Zero)
                return p.MainWindowHandle;
        }
        return IntPtr.Zero;
    }
}