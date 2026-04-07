// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Logging;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles display commands: ListResolutions, SetScreenResolution, and SetTextSize.
/// </summary>
internal class DisplayCommandHandler : ICommandHandler
{
    private readonly IDisplayService _display;
    private readonly ILogger _logger;

    public DisplayCommandHandler(IDisplayService display, ILogger logger)
    {
        _display = display;
        _logger = logger;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ListResolutions",
        "SetScreenResolution",
        "SetTextSize",
    ];

    /// <inheritdoc/>
    public void Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "ListResolutions":
                try
                {
                    Console.WriteLine(_display.ListResolutions());
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                }
                break;

            case "SetScreenResolution":
                try
                {
                    uint width = parameters.Value<uint>("width");
                    uint height = parameters.Value<uint>("height");
                    if (width == 0 || height == 0)
                    {
                        break;
                    }

                    uint? refreshRate = parameters.Value<uint?>("refreshRate");

                    string result = _display.SetResolution(width, height, refreshRate);
                    Console.WriteLine(result);
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                }
                break;

            case "SetTextSize":
                try
                {
                    int textSizePct = parameters.Value<int?>("size") ?? -1;
                    if (textSizePct < 0)
                    {
                        break;
                    }

                    _display.SetTextSize(textSizePct);
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                }
                break;
        }
    }
}
