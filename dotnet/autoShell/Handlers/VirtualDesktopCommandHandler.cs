// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles virtual desktop commands: createDesktop, switchDesktop, nextDesktop, previousDesktop,
/// moveWindowToDesktop, pinWindow.
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
        switch (key)
        {
            case "CreateDesktop":
                AutoShell.CreateDesktop(value);
                break;

            case "SwitchDesktop":
                AutoShell.SwitchDesktop(value);
                break;

            case "NextDesktop":
                AutoShell.BumpDesktopIndex(1);
                break;

            case "PreviousDesktop":
                AutoShell.BumpDesktopIndex(-1);
                break;

            case "MoveWindowToDesktop":
                AutoShell.MoveWindowToDesktop(rawValue);
                break;

            case "PinWindow":
                AutoShell.PinWindow(value);
                break;
        }
    }
}
