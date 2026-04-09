// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text.Json;
using autoShell.Logging;
using autoShell.Services;

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
    public CommandResult Handle(string key, JsonElement parameters)
    {
        switch (key)
        {
            case "CreateDesktop":
            {
                string namesJson = parameters.TryGetProperty("names", out JsonElement names)
                    ? names.GetRawText()
                    : "[\"desktop 1\"]";
                _virtualDesktop.CreateDesktops(namesJson);
                return CommandResult.Ok("Created new desktop(s)");
            }

            case "MoveWindowToDesktop":
            {
                string process = parameters.GetStringOrDefault("name");
                string desktop = parameters.GetStringOrDefault("desktopId");
                if (string.IsNullOrEmpty(process) || string.IsNullOrEmpty(desktop))
                {
                    return CommandResult.Fail("MoveWindowToDesktop requires name and desktopId");
                }

                string resolvedName = _appRegistry.ResolveProcessName(process);
                IntPtr hWnd = _window.FindProcessWindowHandle(resolvedName);
                if (hWnd == IntPtr.Zero)
                {
                    return CommandResult.Fail($"Could not find window for '{process}'");
                }

                _virtualDesktop.MoveWindowToDesktop(hWnd, desktop);
                return CommandResult.Ok($"Moved {process} to desktop {desktop}");
            }

            case "NextDesktop":
                _virtualDesktop.NextDesktop();
                return CommandResult.Ok("Switched to next desktop");

            case "PinWindow":
            {
                string name = parameters.GetStringOrDefault("name");
                string pinProcess = _appRegistry.ResolveProcessName(name);
                IntPtr pinHWnd = _window.FindProcessWindowHandle(pinProcess);
                if (pinHWnd == IntPtr.Zero)
                {
                    return CommandResult.Fail($"Could not find window for '{name}'");
                }

                _virtualDesktop.PinWindow(pinHWnd);
                return CommandResult.Ok($"Pinned '{name}' to all desktops");
            }

            case "PreviousDesktop":
                _virtualDesktop.PreviousDesktop();
                return CommandResult.Ok("Switched to previous desktop");

            case "SwitchDesktop":
            {
                string desktopId = parameters.GetStringOrDefault("desktopId");
                _virtualDesktop.SwitchDesktop(desktopId);
                return CommandResult.Ok($"Switched to desktop {desktopId}");
            }

            default:
                return CommandResult.Fail($"Unknown virtual desktop command: {key}");
        }
    }
}
