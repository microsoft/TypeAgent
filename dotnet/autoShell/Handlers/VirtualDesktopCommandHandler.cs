// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles virtual desktop commands: createDesktop, switchDesktop, nextDesktop, previousDesktop,
/// moveWindowToDesktop, pinWindow.
/// Delegates to existing static methods in AutoShell.
/// </summary>
internal class VirtualDesktopCommandHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "CreateDesktop",
        "MoveWindowToDesktop",
        "NextDesktop",
        "PinWindow",
        "PreviousDesktop",
        "SwitchDesktop",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        AutoShell.HandleVirtualDesktopCommand(key, value, rawValue);
    }
}
