// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
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
        AddAction("Maximize", HandleMaximize);
        AddAction("Minimize", HandleMinimize);
        AddAction("SwitchTo", HandleSwitchTo);
        AddAction("Tile", HandleTile);
    }

    private ActionResult HandleMaximize(JsonElement parameters)
    {
        string name = parameters.GetStringOrDefault("name");
        string maxProcess = _appRegistry.ResolveProcessName(name);
        _window.MaximizeWindow(maxProcess);
        return ActionResult.Ok($"Maximized {name}");
    }

    private ActionResult HandleMinimize(JsonElement parameters)
    {
        string name = parameters.GetStringOrDefault("name");
        string minProcess = _appRegistry.ResolveProcessName(name);
        _window.MinimizeWindow(minProcess);
        return ActionResult.Ok($"Minimized {name}");
    }

    private ActionResult HandleSwitchTo(JsonElement parameters)
    {
        string name = parameters.GetStringOrDefault("name");
        string switchProcess = _appRegistry.ResolveProcessName(name);
        string path = _appRegistry.GetExecutablePath(name);
        _window.RaiseWindow(switchProcess, path);
        return ActionResult.Ok($"Switched to {name}");
    }

    private ActionResult HandleTile(JsonElement parameters)
    {
        string leftName = parameters.GetStringOrDefault("leftWindow");
        string rightName = parameters.GetStringOrDefault("rightWindow");

        if (leftName != null && rightName != null)
        {
            string processName1 = _appRegistry.ResolveProcessName(leftName);
            string processName2 = _appRegistry.ResolveProcessName(rightName);
            _window.TileWindows(processName1, processName2);
            return ActionResult.Ok($"Tiled {leftName} and {rightName}");
        }
        return ActionResult.Fail("Tile requires both leftWindow and rightWindow");
    }
}
