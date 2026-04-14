// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Text.Json;
using autoShell.Handlers.Generated;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles virtual desktop commands: CreateDesktop, MoveWindowToDesktop, NextDesktop,
/// PinWindow, PreviousDesktop, and SwitchDesktop.
/// </summary>
internal class VirtualDesktopActionHandler : ActionHandlerBase
{
    private readonly IAppRegistry _appRegistry;
    private readonly ILogger _logger;
    private readonly IVirtualDesktopService _virtualDesktop;
    private readonly IWindowService _window;

    public VirtualDesktopActionHandler(IAppRegistry appRegistry, IWindowService window, IVirtualDesktopService virtualDesktop, ILogger logger)
    {
        _appRegistry = appRegistry;
        _logger = logger;
        _virtualDesktop = virtualDesktop;
        _window = window;
        // CreateDesktop left as JsonElement because "names" is an array but generated record has string
        AddAction("CreateDesktop", HandleCreateDesktop);
        // MoveWindowToDesktop left as JsonElement because desktopId may be a string in JSON
        AddAction("MoveWindowToDesktop", HandleMoveWindowToDesktop);
        AddAction<NextDesktopParams>("NextDesktop", HandleNextDesktop);
        AddAction<PinWindowParams>("PinWindow", HandlePinWindow);
        AddAction<PreviousDesktopParams>("PreviousDesktop", HandlePreviousDesktop);
        // SwitchDesktop left as JsonElement because desktopId may be a string in JSON
        AddAction("SwitchDesktop", HandleSwitchDesktop);
    }

    private ActionResult HandleCreateDesktop(JsonElement parameters)
    {
        string namesJson = parameters.TryGetProperty("names", out JsonElement names)
            ? names.GetRawText()
            : "[\"desktop 1\"]";
        _virtualDesktop.CreateDesktops(namesJson);
        return ActionResult.Ok("Created new desktop(s)");
    }

    private ActionResult HandleMoveWindowToDesktop(JsonElement parameters)
    {
        string process = parameters.GetStringOrDefault("name");
        string desktop = parameters.GetStringOrDefault("desktopId");
        if (string.IsNullOrEmpty(process) || string.IsNullOrEmpty(desktop))
        {
            return ActionResult.Fail("MoveWindowToDesktop requires name and desktopId");
        }

        string resolvedName = _appRegistry.ResolveProcessName(process);
        IntPtr hWnd = _window.FindProcessWindowHandle(resolvedName);
        if (hWnd == IntPtr.Zero)
        {
            return ActionResult.Fail($"Could not find window for '{process}'");
        }

        _virtualDesktop.MoveWindowToDesktop(hWnd, desktop);
        return ActionResult.Ok($"Moved {process} to desktop {desktop}");
    }

    private ActionResult HandleNextDesktop(NextDesktopParams p)
    {
        _virtualDesktop.NextDesktop();
        return ActionResult.Ok("Switched to next desktop");
    }

    private ActionResult HandlePinWindow(PinWindowParams p)
    {
        string name = p.Name;
        string pinProcess = _appRegistry.ResolveProcessName(name);
        IntPtr pinHWnd = _window.FindProcessWindowHandle(pinProcess);
        if (pinHWnd == IntPtr.Zero)
        {
            return ActionResult.Fail($"Could not find window for '{name}'");
        }

        _virtualDesktop.PinWindow(pinHWnd);
        return ActionResult.Ok($"Pinned '{name}' to all desktops");
    }

    private ActionResult HandlePreviousDesktop(PreviousDesktopParams p)
    {
        _virtualDesktop.PreviousDesktop();
        return ActionResult.Ok("Switched to previous desktop");
    }

    private ActionResult HandleSwitchDesktop(JsonElement parameters)
    {
        string desktopId = parameters.GetStringOrDefault("desktopId");
        _virtualDesktop.SwitchDesktop(desktopId);
        return ActionResult.Ok($"Switched to desktop {desktopId}");
    }
}
