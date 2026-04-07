// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Services;
using Newtonsoft.Json.Linq;

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
    public void Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "Maximize":
            {
                string name = parameters.Value<string>("name");
                string maxProcess = _appRegistry.ResolveProcessName(name);
                _window.MaximizeWindow(maxProcess);
                break;
            }

            case "Minimize":
            {
                string name = parameters.Value<string>("name");
                string minProcess = _appRegistry.ResolveProcessName(name);
                _window.MinimizeWindow(minProcess);
                break;
            }

            case "SwitchTo":
            {
                string name = parameters.Value<string>("name");
                string switchProcess = _appRegistry.ResolveProcessName(name);
                string path = _appRegistry.GetExecutablePath(name);
                _window.RaiseWindow(switchProcess, path);
                break;
            }

            case "Tile":
            {
                string leftName = parameters.Value<string>("leftWindow");
                string rightName = parameters.Value<string>("rightWindow");

                if (leftName != null && rightName != null)
                {
                    string processName1 = _appRegistry.ResolveProcessName(leftName);
                    string processName2 = _appRegistry.ResolveProcessName(rightName);
                    _window.TileWindows(processName1, processName2);
                }
                break;
            }
        }
    }
}
