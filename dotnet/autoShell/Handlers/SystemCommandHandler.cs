// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Diagnostics;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles system/utility commands: debug, toggleNotifications.
/// </summary>
internal class SystemCommandHandler : ICommandHandler
{
    private readonly IProcessService _process;

    public SystemCommandHandler(IProcessService process)
    {
        this._process = process;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "Debug",
        "ToggleNotifications",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "Debug":
                Debugger.Launch();
                break;

            case "ToggleNotifications":
                this._process.StartShellExecute("ms-actioncenter:");
                break;
        }
    }
}
