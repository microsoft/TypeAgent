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
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "Maximize":
                string maxProcess = _appRegistry.ResolveProcessName(value);
                _window.MaximizeWindow(maxProcess);
                break;

            case "Minimize":
                string minProcess = _appRegistry.ResolveProcessName(value);
                _window.MinimizeWindow(minProcess);
                break;

            case "SwitchTo":
                string switchProcess = _appRegistry.ResolveProcessName(value);
                string path = _appRegistry.GetExecutablePath(value);
                _window.RaiseWindow(switchProcess, path);
                break;

            case "Tile":
                string[] apps = value.Split(',');
                if (apps.Length == 2)
                {
                    string processName1 = _appRegistry.ResolveProcessName(apps[0]);
                    string processName2 = _appRegistry.ResolveProcessName(apps[1]);
                    _window.TileWindows(processName1, processName2);
                }
                break;
        }
    }
}
