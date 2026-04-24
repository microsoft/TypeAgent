// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using autoShell.Handlers.Generated;
using autoShell.Logging;
using autoShell.Services;
using static autoShell.Services.Interop.SpiConstants;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles mouse and touchpad settings: precision, cursor speed, scroll lines,
/// primary button, cursor trail, pointer size, pointer customization, and touchpad.
/// </summary>
internal class MouseSettingsHandler : SettingsHandlerBase
{
    private readonly ISystemParametersService _systemParams;
    private readonly ILogger _logger;

    /// <summary>
    /// Registers registered open-settings actions for mouse pointer size, pointer customization,
    /// touchpad enable, and touchpad cursor speed. SPI-based actions are handled as specialized actions.
    /// </summary>
    public MouseSettingsHandler(IRegistryService registry, IProcessService process, ISystemParametersService systemParams, ILogger logger)
        : base(registry, process)
    {
        _systemParams = systemParams;
        _logger = logger;

        AddOpenSettingsAction("AdjustMousePointerSize", new OpenSettingsConfig("ms-settings:easeofaccess-mouse", "mouse settings"));
        AddOpenSettingsAction("MousePointerCustomization", new OpenSettingsConfig("ms-settings:easeofaccess-mouse", "mouse settings"));
        AddOpenSettingsAction("EnableTouchPad", new OpenSettingsConfig("ms-settings:devices-touchpad", "touchpad settings"));
        AddOpenSettingsAction("TouchpadCursorSpeed", new OpenSettingsConfig("ms-settings:devices-touchpad", "touchpad settings"));
        AddAction<ToggleMouseSonarParams>("ToggleMouseSonar", HandleToggleMouseSonar);
        AddAction<CursorTrailParams>("CursorTrail", HandleMouseCursorTrail);
        AddAction<EnhancePointerPrecisionParams>("EnhancePointerPrecision", HandleEnhancePointerPrecision);
        AddAction<MouseCursorSpeedParams>("MouseCursorSpeed", HandleMouseCursorSpeed);
        AddAction<MouseWheelScrollLinesParams>("MouseWheelScrollLines", HandleMouseWheelScrollLines);
        AddAction<SetPrimaryMouseButtonParams>("SetPrimaryMouseButton", HandleSetPrimaryMouseButton);
    }

    private ActionResult HandleToggleMouseSonar(ToggleMouseSonarParams p)
    {
        bool enable = p.Enable;
        _systemParams.SetParameter(SPI_SETMOUSESONAR, 0, (IntPtr)(enable ? 1 : 0), SPIF_UPDATEINIFILE_SENDCHANGE);
        return ActionResult.Ok($"Mouse Sonar {(enable ? "enabled" : "disabled")}");
    }

    private ActionResult HandleEnhancePointerPrecision(EnhancePointerPrecisionParams p)
    {
        bool enable = p.Enable ?? true;
        int[] mouseParams = new int[3];
        _systemParams.GetParameter(SPI_GETMOUSE, 0, mouseParams, 0);
        // Set acceleration (third parameter): 1 = enhanced precision on, 0 = off
        mouseParams[2] = enable ? 1 : 0;
        _systemParams.SetParameter(SPI_SETMOUSE, 0, mouseParams, SPIF_UPDATEINIFILE_SENDCHANGE);
        return ActionResult.Ok($"Enhanced pointer precision {(enable ? "enabled" : "disabled")}");
    }

    private ActionResult HandleMouseCursorSpeed(MouseCursorSpeedParams p)
    {
        // Speed range: 1-20 (default 10)
        int speed = p.SpeedLevel > 0 ? p.SpeedLevel : 10;
        speed = Math.Clamp(speed, 1, 20);
        _systemParams.SetParameter(SPI_SETMOUSESPEED, 0, (IntPtr)speed, SPIF_UPDATEINIFILE_SENDCHANGE);
        return ActionResult.Ok($"Mouse cursor speed set to {speed}");
    }

    /// <summary>
    /// Enables or disables the mouse cursor trail and sets its length.
    /// SPI_SETMOUSETRAILS: 0 = off, 2-12 = trail length
    /// </summary>
    private ActionResult HandleMouseCursorTrail(CursorTrailParams p)
    {
        var enable = p.Enable;
        var length = p.Length ?? 7;

        // Clamp trail length to valid range
        length = Math.Max(2, Math.Min(12, length));

        int trailValue = enable ? length : 0;

        _systemParams.SetParameter(SPI_SETMOUSETRAILS, trailValue, IntPtr.Zero, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        _logger.Debug(enable
            ? $"Cursor trail enabled with length {length}"
            : "Cursor trail disabled");
        return ActionResult.Ok($"Cursor trail {(enable ? $"enabled (length {length})" : "disabled")}");
    }

    private ActionResult HandleMouseWheelScrollLines(MouseWheelScrollLinesParams p)
    {
        int lines = p.ScrollLines > 0 ? p.ScrollLines : 3;
        lines = Math.Clamp(lines, 1, 100);
        _systemParams.SetParameter(SPI_SETWHEELSCROLLLINES, lines, IntPtr.Zero, SPIF_UPDATEINIFILE_SENDCHANGE);
        return ActionResult.Ok($"Mouse wheel scroll lines set to {lines}");
    }

    private ActionResult HandleSetPrimaryMouseButton(SetPrimaryMouseButtonParams p)
    {
        string button = p.PrimaryButton;
        if (string.IsNullOrEmpty(button))
        {
            button = "left";
        }

        bool leftPrimary = button.Equals("left", StringComparison.OrdinalIgnoreCase);
        _systemParams.SwapMouseButton(!leftPrimary);
        return ActionResult.Ok($"Primary mouse button set to {button}");
    }
}
