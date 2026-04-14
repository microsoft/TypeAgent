// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
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
        AddAction<CreateDesktopParams>("CreateDesktop", HandleCreateDesktop);
        AddAction<MoveWindowToDesktopParams>("MoveWindowToDesktop", HandleMoveWindowToDesktop);
        AddAction<NextDesktopParams>("NextDesktop", HandleNextDesktop);
        AddAction<PinWindowParams>("PinWindow", HandlePinWindow);
        AddAction<PreviousDesktopParams>("PreviousDesktop", HandlePreviousDesktop);
        AddAction<SwitchDesktopParams>("SwitchDesktop", HandleSwitchDesktop);
    }

    private ActionResult HandleCreateDesktop(CreateDesktopParams p)
    {
        string namesJson = p.Names != null
            ? System.Text.Json.JsonSerializer.Serialize(p.Names)
            : "[\"desktop 1\"]";
        _virtualDesktop.CreateDesktops(namesJson);
        return ActionResult.Ok("Created new desktop(s)");
    }

    private ActionResult HandleMoveWindowToDesktop(MoveWindowToDesktopParams p)
    {
        string process = p.Name;
        string desktop = p.DesktopId.ToString();
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

    private ActionResult HandleSwitchDesktop(SwitchDesktopParams p)
    {
        string desktopId = p.DesktopId.ToString();
        _virtualDesktop.SwitchDesktop(desktopId);
        return ActionResult.Ok($"Switched to desktop {desktopId}");
    }
}
