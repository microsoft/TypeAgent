// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text.Json;
using autoShell.Logging;
using autoShell.Services;

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
    public CommandResult Handle(string key, JsonElement parameters)
    {
        switch (key)
        {
            case "ListResolutions":
                try
                {
                    string resolutions = _display.ListResolutions();
                    return CommandResult.Ok("Listed resolutions", JsonDocument.Parse(resolutions).RootElement.Clone());
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                    return CommandResult.Fail($"Failed to list resolutions: {ex.Message}");
                }

            case "SetScreenResolution":
                try
                {
                    int? width = parameters.GetNullableInt("width");
                    int? height = parameters.GetNullableInt("height");
                    if ((width ?? 0) == 0 || (height ?? 0) == 0)
                    {
                        return CommandResult.Fail("Invalid resolution: width and height required");
                    }

                    uint? refreshRate = (uint?)parameters.GetNullableInt("refreshRate");

                    string result = _display.SetResolution((uint)width.Value, (uint)height.Value, refreshRate);
                    return CommandResult.Ok($"Screen resolution set to {width}x{height}", JsonDocument.Parse(result).RootElement.Clone());
                }
                catch (Exception ex)
                {
                    _logger.Error(ex);
                    return CommandResult.Fail($"Failed to set resolution: {ex.Message}");
                }

            case "SetTextSize":
                try
                {
                    int textSizePct = parameters.GetNullableInt("size") ?? -1;
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
