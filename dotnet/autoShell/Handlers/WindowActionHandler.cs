// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using autoShell.Handlers.Generated;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles window management commands: Maximize, Minimize, SwitchTo, and Tile.
/// </summary>
internal class WindowActionHandler : ActionHandlerBase
{
    private readonly IAppRegistry _appRegistry;
    private readonly IWindowService _window;

    public WindowActionHandler(IAppRegistry appRegistry, IWindowService window)
    {
        _appRegistry = appRegistry;
        _window = window;
        AddAction<MaximizeParams>("Maximize", HandleMaximize);
        AddAction<MinimizeParams>("Minimize", HandleMinimize);
        AddAction<SwitchToParams>("SwitchTo", HandleSwitchTo);
        AddAction<TileParams>("Tile", HandleTile);
    }

    private ActionResult HandleMaximize(MaximizeParams p)
    {
        string name = p.Name;
        string maxProcess = _appRegistry.ResolveProcessName(name);
        _window.MaximizeWindow(maxProcess);
        return ActionResult.Ok($"Maximized {name}");
    }

    private ActionResult HandleMinimize(MinimizeParams p)
    {
        string name = p.Name;
        string minProcess = _appRegistry.ResolveProcessName(name);
        _window.MinimizeWindow(minProcess);
        return ActionResult.Ok($"Minimized {name}");
    }

    private ActionResult HandleSwitchTo(SwitchToParams p)
    {
        string name = p.Name;
        string switchProcess = _appRegistry.ResolveProcessName(name);
        string path = _appRegistry.GetExecutablePath(name);
        _window.RaiseWindow(switchProcess, path);
        return ActionResult.Ok($"Switched to {name}");
    }

    private ActionResult HandleTile(TileParams p)
    {
        string leftName = p.LeftWindow;
        string rightName = p.RightWindow;

        if (!string.IsNullOrEmpty(leftName) && !string.IsNullOrEmpty(rightName))
        {
            string processName1 = _appRegistry.ResolveProcessName(leftName);
            string processName2 = _appRegistry.ResolveProcessName(rightName);
            _window.TileWindows(processName1, processName2);
            return ActionResult.Ok($"Tiled {leftName} and {rightName}");
        }
        return ActionResult.Fail("Tile requires both leftWindow and rightWindow");
    }
}
