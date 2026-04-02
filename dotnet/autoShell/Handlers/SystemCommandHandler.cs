// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles system/utility commands: Debug and ToggleNotifications.
/// </summary>
internal class SystemCommandHandler : ICommandHandler
{
    private readonly IProcessService _process;
    private readonly IDebuggerService _debugger;

    public SystemCommandHandler(IProcessService process, IDebuggerService debugger)
    {
        _process = process;
        _debugger = debugger;
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
                _debugger.Launch();
                break;

            case "ToggleNotifications":
                _process.StartShellExecute("ms-actioncenter:");
                break;
        }
    }
}
