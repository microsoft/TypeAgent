// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Logging;
using autoShell.Services;
using Newtonsoft.Json.Linq;

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
    public void Handle(string key, string value, JToken rawValue)
    {
        var param = JObject.Parse(value);

        switch (key)
        {
            case "AdjustMousePointerSize":
            case "MousePointerCustomization":
                this._process.StartShellExecute("ms-settings:easeofaccess-mouse");
                break;

            case "CursorTrail":
                this.HandleMouseCursorTrail(value);
                break;

            case "EnableTouchPad":
            case "TouchpadCursorSpeed":
                this._process.StartShellExecute("ms-settings:devices-touchpad");
                break;

            case "EnhancePointerPrecision":
                this.HandleEnhancePointerPrecision(param);
                break;

            case "MouseCursorSpeed":
                this.HandleMouseCursorSpeed(param);
                break;

            case "MouseWheelScrollLines":
                this.HandleMouseWheelScrollLines(param);
                break;

            case "SetPrimaryMouseButton":
                HandleSetPrimaryMouseButton(param);
                break;
        }
    }

    private void HandleEnhancePointerPrecision(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        int[] mouseParams = new int[3];
        this._systemParams.GetParameter(SPI_GETMOUSE, 0, mouseParams, 0);
        mouseParams[2] = enable ? 1 : 0;
        this._systemParams.SetParameter(SPI_SETMOUSE, 0, mouseParams, SPIF_UPDATEINIFILE_SENDCHANGE);
    }

    private void HandleMouseCursorSpeed(JObject param)
    {
        int speed = param.Value<int?>("speedLevel") ?? 10;
        this._systemParams.SetParameter(SPI_SETMOUSESPEED, 0, (IntPtr)speed, SPIF_UPDATEINIFILE_SENDCHANGE);
    }

    /// <summary>
    /// Enables or disables the mouse cursor trail and sets its length.
    /// Command: {"CursorTrail": "{\"enable\":true,\"length\":7}"}
    /// SPI_SETMOUSETRAILS: 0 = off, 2-12 = trail length
    /// </summary>
    private void HandleMouseCursorTrail(string jsonParams)
    {
        var param = JObject.Parse(jsonParams);
        var enable = param.Value<bool?>("enable") ?? true;
        var length = param.Value<int?>("length") ?? 7;

        // Clamp trail length to valid range
        length = Math.Max(2, Math.Min(12, length));

        int trailValue = enable ? length : 0;

        this._systemParams.SetParameter(SPI_SETMOUSETRAILS, trailValue, IntPtr.Zero, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        _logger.Debug(enable
            ? $"Cursor trail enabled with length {length}"
            : "Cursor trail disabled");
    }

    private void HandleMouseWheelScrollLines(JObject param)
    {
        int lines = param.Value<int?>("scrollLines") ?? 3;
        this._systemParams.SetParameter(SPI_SETWHEELSCROLLLINES, lines, IntPtr.Zero, SPIF_UPDATEINIFILE_SENDCHANGE);
    }

    private void HandleSetPrimaryMouseButton(JObject param)
    {
        string button = param.Value<string>("primaryButton") ?? "left";
        bool leftPrimary = button.Equals("left", StringComparison.OrdinalIgnoreCase);
        _systemParams.SwapMouseButton(!leftPrimary);
    }
}
