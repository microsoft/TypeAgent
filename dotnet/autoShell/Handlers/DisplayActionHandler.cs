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
        AddAction<SetScreenResolutionParams>("SetScreenResolution", HandleSetScreenResolution);
        AddAction<SetTextSizeParams>("SetTextSize", HandleSetTextSize);
    }

    private ActionResult HandleListResolutions(JsonElement parameters)
    {
        try
        {
            string resolutions = _display.ListResolutions();
            using var doc = JsonDocument.Parse(resolutions);
            return ActionResult.Ok("Listed resolutions", doc.RootElement.Clone());
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ActionResult.Fail($"Failed to list resolutions: {ex.Message}");
        }
    }

    private ActionResult HandleSetScreenResolution(SetScreenResolutionParams p)
    {
        try
        {
            int width = p.Width;
            int height = p.Height;
            if (width <= 0 || height <= 0)
            {
                return ActionResult.Fail("Invalid resolution: width and height must be positive");
            }

            uint? refreshRate = null;
            if (p.RefreshRate.HasValue)
            {
                if (p.RefreshRate.Value <= 0)
                {
                    return ActionResult.Fail("Invalid refresh rate: must be positive");
                }
                refreshRate = (uint)p.RefreshRate.Value;
            }

            string result = _display.SetResolution((uint)width, (uint)height, refreshRate);
            return ActionResult.Ok(result);
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return ActionResult.Fail($"Failed to set resolution: {ex.Message}");
        }
    }

    private ActionResult HandleSetTextSize(SetTextSizeParams p)
    {
        try
        {
            int textSizePct = p.Size;
            if (textSizePct <= 0)
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
