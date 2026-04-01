// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles theme-related commands: applyTheme, listThemes, setThemeMode, setWallpaper.
/// Delegates to existing static methods in AutoShell.
/// </summary>
internal class ThemeCommandHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ApplyTheme",
        "ListThemes",
        "SetThemeMode",
        "SetWallpaper",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        AutoShell.HandleThemeCommand(key, value);
    }
}
