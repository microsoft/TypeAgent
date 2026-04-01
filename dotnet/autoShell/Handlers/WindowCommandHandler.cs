// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles window management commands: maximize, minimize, switchTo, tile.
/// </summary>
internal class WindowCommandHandler : ICommandHandler
{
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
                AutoShell.MaximizeWindow(value);
                break;

            case "Minimize":
                AutoShell.MinimizeWindow(value);
                break;

            case "SwitchTo":
                AutoShell.RaiseWindow(value);
                break;

            case "Tile":
                string[] apps = value.Split(',');
                if (apps.Length == 2)
                {
                    AutoShell.TileWindowPair(apps[0], apps[1]);
                }
                break;
        }
    }
}
