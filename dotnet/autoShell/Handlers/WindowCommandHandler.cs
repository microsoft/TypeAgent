// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.Json;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles window management commands: Maximize, Minimize, SwitchTo, and Tile.
/// </summary>
internal class WindowCommandHandler : ICommandHandler
{
    private readonly IAppRegistry _appRegistry;
    private readonly IWindowService _window;

    public WindowCommandHandler(IAppRegistry appRegistry, IWindowService window)
    {
        _appRegistry = appRegistry;
        _window = window;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "Maximize",
        "Minimize",
        "SwitchTo",
        "Tile",
    ];

    /// <inheritdoc/>
    public CommandResult Handle(string key, JsonElement parameters)
    {
        switch (key)
        {
            case "Maximize":
            {
                string name = parameters.GetStringOrDefault("name");
                string maxProcess = _appRegistry.ResolveProcessName(name);
                _window.MaximizeWindow(maxProcess);
                return CommandResult.Ok($"Maximized {name}");
            }

            case "Minimize":
            {
                string name = parameters.GetStringOrDefault("name");
                string minProcess = _appRegistry.ResolveProcessName(name);
                _window.MinimizeWindow(minProcess);
                return CommandResult.Ok($"Minimized {name}");
            }

            case "SwitchTo":
            {
                string name = parameters.GetStringOrDefault("name");
                string switchProcess = _appRegistry.ResolveProcessName(name);
                string path = _appRegistry.GetExecutablePath(name);
                _window.RaiseWindow(switchProcess, path);
                return CommandResult.Ok($"Switched to {name}");
            }

            case "Tile":
            {
                string leftName = parameters.GetStringOrDefault("leftWindow");
                string rightName = parameters.GetStringOrDefault("rightWindow");

                if (leftName != null && rightName != null)
                {
                    string processName1 = _appRegistry.ResolveProcessName(leftName);
                    string processName2 = _appRegistry.ResolveProcessName(rightName);
                    _window.TileWindows(processName1, processName2);
                    return CommandResult.Ok($"Tiled {leftName} and {rightName}");
                }
                return CommandResult.Fail("Tile requires both leftWindow and rightWindow");
            }

            default:
                return CommandResult.Fail($"Unknown window command: {key}");
        }
    }
}
