// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles display commands: setScreenResolution, listResolutions, setTextSize.
/// </summary>
internal class DisplayCommandHandler : ICommandHandler
{
    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ListResolutions",
        "SetScreenResolution",
        "SetTextSize",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "SetTextSize":
                if (int.TryParse(value, out int textSizePct))
                {
                    AutoShell.SetTextSize(textSizePct);
                }
                break;

            case "SetScreenResolution":
                AutoShell.SetDisplayResolution(rawValue);
                break;

            case "ListResolutions":
                AutoShell.ListDisplayResolutions();
                break;
        }
    }
}
