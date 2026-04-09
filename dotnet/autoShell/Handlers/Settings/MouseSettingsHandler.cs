// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text.Json;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles mouse and touchpad settings: pointer size, precision, cursor speed, scroll lines,
/// primary button, customization, and touchpad.
/// </summary>
internal class MouseSettingsHandler : ICommandHandler
{
    private const int SPI_GETMOUSE = 3;
    private const int SPI_SETMOUSE = 4;
    private const int SPI_SETMOUSESPEED = 0x0071;
    private const int SPI_SETMOUSETRAILS = 0x005D;
    private const int SPI_SETWHEELSCROLLLINES = 0x0069;
    private const int SPIF_UPDATEINIFILE = 0x01;
    private const int SPIF_SENDCHANGE = 0x02;
    private const int SPIF_UPDATEINIFILE_SENDCHANGE = 3;

    private readonly ISystemParametersService _systemParams;
    private readonly IProcessService _process;
    private readonly ILogger _logger;

    public MouseSettingsHandler(ISystemParametersService systemParams, IProcessService process, ILogger logger)
    {
        _systemParams = systemParams;
        _process = process;
        _logger = logger;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "AdjustMousePointerSize",
        "CursorTrail",
        "EnableTouchPad",
        "EnhancePointerPrecision",
        "MouseCursorSpeed",
        "MousePointerCustomization",
        "MouseWheelScrollLines",
        "SetPrimaryMouseButton",
        "TouchpadCursorSpeed",
    ];

    /// <inheritdoc/>
    public CommandResult Handle(string key, JsonElement parameters)
    {
        switch (key)
        {
            case "AdjustMousePointerSize":
            case "MousePointerCustomization":
                _process.StartShellExecute("ms-settings:easeofaccess-mouse");
                return CommandResult.Ok("Opened mouse pointer settings");

            case "CursorTrail":
                return HandleMouseCursorTrail(parameters);

            case "EnableTouchPad":
            case "TouchpadCursorSpeed":
                _process.StartShellExecute("ms-settings:devices-touchpad");
                return CommandResult.Ok("Opened touchpad settings");

            case "EnhancePointerPrecision":
                return HandleEnhancePointerPrecision(parameters);

            case "MouseCursorSpeed":
                return HandleMouseCursorSpeed(parameters);

            case "MouseWheelScrollLines":
                return HandleMouseWheelScrollLines(parameters);

            case "SetPrimaryMouseButton":
                return HandleSetPrimaryMouseButton(parameters);

            default:
                return CommandResult.Fail($"Unknown mouse command: {key}");
        }
    }

    private CommandResult HandleEnhancePointerPrecision(JsonElement parameters)
    {
        bool enable = parameters.GetBoolOrDefault("enable", true);
        int[] mouseParams = new int[3];
        _systemParams.GetParameter(SPI_GETMOUSE, 0, mouseParams, 0);
        // Set acceleration (third parameter): 1 = enhanced precision on, 0 = off
        mouseParams[2] = enable ? 1 : 0;
        _systemParams.SetParameter(SPI_SETMOUSE, 0, mouseParams, SPIF_UPDATEINIFILE_SENDCHANGE);
        return CommandResult.Ok($"Enhanced pointer precision {(enable ? "enabled" : "disabled")}");
    }

    private CommandResult HandleMouseCursorSpeed(JsonElement parameters)
    {
        // Speed range: 1-20 (default 10)
        int speed = parameters.GetNullableInt("speedLevel") ?? 10;
        speed = Math.Clamp(speed, 1, 20);
        _systemParams.SetParameter(SPI_SETMOUSESPEED, 0, (IntPtr)speed, SPIF_UPDATEINIFILE_SENDCHANGE);
        return CommandResult.Ok($"Mouse cursor speed set to {speed}");
    }

    /// <summary>
    /// Enables or disables the mouse cursor trail and sets its length.
    /// SPI_SETMOUSETRAILS: 0 = off, 2-12 = trail length
    /// </summary>
    private CommandResult HandleMouseCursorTrail(JsonElement parameters)
    {
        var enable = parameters.GetBoolOrDefault("enable", true);
        var length = parameters.GetNullableInt("length") ?? 7;

        // Clamp trail length to valid range
        length = Math.Max(2, Math.Min(12, length));

        int trailValue = enable ? length : 0;

        _systemParams.SetParameter(SPI_SETMOUSETRAILS, trailValue, IntPtr.Zero, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        _logger.Debug(enable
            ? $"Cursor trail enabled with length {length}"
            : "Cursor trail disabled");
        return CommandResult.Ok($"Cursor trail {(enable ? $"enabled (length {length})" : "disabled")}");
    }

    private CommandResult HandleMouseWheelScrollLines(JsonElement parameters)
    {
        int lines = parameters.GetNullableInt("scrollLines") ?? 3;
        lines = Math.Clamp(lines, 1, 100);
        _systemParams.SetParameter(SPI_SETWHEELSCROLLLINES, lines, IntPtr.Zero, SPIF_UPDATEINIFILE_SENDCHANGE);
        return CommandResult.Ok($"Mouse wheel scroll lines set to {lines}");
    }

    private CommandResult HandleSetPrimaryMouseButton(JsonElement parameters)
    {
        string button = parameters.GetStringOrDefault("primaryButton", "left");
        bool leftPrimary = button.Equals("left", StringComparison.OrdinalIgnoreCase);
        _systemParams.SwapMouseButton(!leftPrimary);
        return CommandResult.Ok($"Primary mouse button set to {button}");
    }
}
