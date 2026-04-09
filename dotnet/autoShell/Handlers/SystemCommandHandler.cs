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
    public CommandResult Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "Debug":
                _debugger.Launch();
                return CommandResult.Ok("Debugger launched");

            case "ToggleNotifications":
                _process.StartShellExecute("ms-actioncenter:");
                return CommandResult.Ok("Toggled Action Center");

            default:
                return CommandResult.Fail($"Unknown system command: {key}");
        }
    }
}
