// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles application lifecycle commands: launchProgram, closeProgram, listAppNames.
/// </summary>
internal class AppCommandHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "CloseProgram",
        "LaunchProgram",
        "ListAppNames",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "LaunchProgram":
                AutoShell.OpenApplication(value);
                break;

            case "CloseProgram":
                AutoShell.CloseApplication(value);
                break;

            case "ListAppNames":
                var installedApps = AutoShell.GetAllInstalledAppsIds();
                Console.WriteLine(JsonConvert.SerializeObject(installedApps.Keys));
                break;
        }
    }
}
