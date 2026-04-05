// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Logging;
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
    private readonly ILogger _logger;
    private readonly IVirtualDesktopService _virtualDesktop;
    private readonly IWindowService _window;

    public VirtualDesktopCommandHandler(IAppRegistry appRegistry, IWindowService window, IVirtualDesktopService virtualDesktop, ILogger logger)
    {
        _appRegistry = appRegistry;
        _logger = logger;
        _virtualDesktop = virtualDesktop;
        _window = window;
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
                    IntPtr hWnd = _window.FindProcessWindowHandle(resolvedName);
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
                IntPtr pinHWnd = _window.FindProcessWindowHandle(pinProcess);
                if (pinHWnd != IntPtr.Zero)
                {
                    _virtualDesktop.PinWindow(pinHWnd);
                }
                else
                {
                    _logger.Warning($"The window handle for '{value}' could not be found");
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
}
