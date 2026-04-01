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
        AutoShell.HandleWindowCommand(key, value);
    }
}
