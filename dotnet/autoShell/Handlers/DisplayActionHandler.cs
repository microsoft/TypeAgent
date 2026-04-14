// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Text.Json;
using autoShell.Handlers.Generated;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell.Handlers;

/// <summary>
/// Handles display commands: ListResolutions, SetScreenResolution, and SetTextSize.
/// </summary>
internal class DisplayActionHandler : ActionHandlerBase
{
    private readonly IDisplayService _display;
    private readonly ILogger _logger;

    public DisplayActionHandler(IDisplayService display, ILogger logger)
    {
        _display = display;
        _logger = logger;
        AddAction("ListResolutions", HandleListResolutions);
        // SetScreenResolution left as JsonElement because it also reads "refreshRate" not in the generated record
        AddAction("SetScreenResolution", HandleSetScreenResolution);
        // SetTextSize left as JsonElement because non-numeric input needs graceful handling
        AddAction("SetTextSize", HandleSetTextSize);
    }

    private ActionResult HandleListResolutions(JsonElement parameters)
    {
        try
        {
            string resolutions = _display.ListResolutions();
            return ActionResult.Ok("Listed resolutions", JsonDocument.Parse(resolutions).RootElement.Clone());
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ActionResult.Fail($"Failed to list resolutions: {ex.Message}");
        }
    }

    private ActionResult HandleSetScreenResolution(JsonElement parameters)
    {
        try
        {
            int? width = parameters.GetNullableInt("width");
            int? height = parameters.GetNullableInt("height");
            if ((width ?? 0) == 0 || (height ?? 0) == 0)
            {
                return ActionResult.Fail("Invalid resolution: width and height required");
            }

            uint? refreshRate = (uint?)parameters.GetNullableInt("refreshRate");

            string result = _display.SetResolution((uint)width.Value, (uint)height.Value, refreshRate);
            return ActionResult.Ok($"Screen resolution set to {width}x{height}", JsonDocument.Parse(result).RootElement.Clone());
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ActionResult.Fail($"Failed to set resolution: {ex.Message}");
        }
    }

    private ActionResult HandleSetTextSize(JsonElement parameters)
    {
        try
        {
            int textSizePct = parameters.GetNullableInt("size") ?? -1;
            if (textSizePct < 0)
            {
                return ActionResult.Fail("Invalid text size: size required");
            }

            _display.SetTextSize(textSizePct);
            return ActionResult.Ok($"Text size set to {textSizePct}%");
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ActionResult.Fail($"Failed to set text size: {ex.Message}");
        }
    }
}
