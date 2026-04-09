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
    public CommandResult Handle(string key, JObject parameters)
    {
        switch (key)
        {
            case "ListResolutions":
                try
                {
                    string resolutions = _display.ListResolutions();
                    return CommandResult.Ok("Listed resolutions", JToken.Parse(resolutions));
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                    return CommandResult.Fail($"Failed to list resolutions: {ex.Message}");
                }

            case "SetScreenResolution":
                try
                {
                    uint width = parameters.Value<uint>("width");
                    uint height = parameters.Value<uint>("height");
                    if (width == 0 || height == 0)
                    {
                        return CommandResult.Fail("Invalid resolution: width and height required");
                    }

                    uint? refreshRate = parameters.Value<uint?>("refreshRate");

                    string result = _display.SetResolution(width, height, refreshRate);
                    return CommandResult.Ok($"Screen resolution set to {width}x{height}", JToken.Parse(result));
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                    return CommandResult.Fail($"Failed to set resolution: {ex.Message}");
                }

            case "SetTextSize":
                try
                {
                    int textSizePct = parameters.Value<int?>("size") ?? -1;
                    if (textSizePct < 0)
                    {
                        return CommandResult.Fail("Invalid text size: size required");
                    }

                    _display.SetTextSize(textSizePct);
                    return CommandResult.Ok($"Text size set to {textSizePct}%");
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                    return CommandResult.Fail($"Failed to set text size: {ex.Message}");
                }

            default:
                return CommandResult.Fail($"Unknown display command: {key}");
        }
    }
}
