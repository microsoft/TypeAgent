// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles mouse and touchpad settings: pointer size, precision, cursor speed, scroll lines,
/// primary button, customization, and touchpad.
/// </summary>
internal partial class MouseSettingsHandler : ICommandHandler
{
    private const int SPI_GETMOUSE = 3;
    private const int SPI_SETMOUSE = 4;
    private const int SPI_SETMOUSESPEED = 0x0071;
    private const int SPI_SETWHEELSCROLLLINES = 0x0069;
    private const int SPIF_UPDATEINIFILE_SENDCHANGE = 3;

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SwapMouseButton(int fSwap);

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "AdjustMousePointerSize",
        "EnableTouchPad",
        "EnhancePointerPrecision",
        "MouseCursorSpeed",
        "MousePointerCustomization",
        "MouseWheelScrollLines",
        "SetPrimaryMouseButton",
        "TouchpadCursorSpeed",
    ];

    private readonly ISystemParametersService _systemParams;
    private readonly IProcessService _process;

    public MouseSettingsHandler(ISystemParametersService systemParams, IProcessService process)
    {
        this._systemParams = systemParams;
        this._process = process;
    }

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        try
        {
            var param = JObject.Parse(value);

            switch (key)
            {
                case "AdjustMousePointerSize":
                case "MousePointerCustomization":
                    this._process.StartShellExecute("ms-settings:easeofaccess-mouse");
                    break;

                case "EnableTouchPad":
                case "TouchpadCursorSpeed":
                    this._process.StartShellExecute("ms-settings:devices-touchpad");
                    break;

                case "EnhancePointerPrecision":
                    this.HandleEnhancePointerPrecision(param);
                    break;

                case "SetPrimaryMouseButton":
                    HandleSetPrimaryMouseButton(param);
                    break;

                case "MouseCursorSpeed":
                    this.HandleMouseCursorSpeed(param);
                    break;

                case "MouseWheelScrollLines":
                    this.HandleMouseWheelScrollLines(param);
                    break;
            }
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    private void HandleMouseCursorSpeed(JObject param)
    {
        int speed = param.Value<int?>("speedLevel") ?? 10;
        this._systemParams.SetParameter(SPI_SETMOUSESPEED, 0, (IntPtr)speed, SPIF_UPDATEINIFILE_SENDCHANGE);
    }

    private void HandleMouseWheelScrollLines(JObject param)
    {
        int lines = param.Value<int?>("scrollLines") ?? 3;
        this._systemParams.SetParameter(SPI_SETWHEELSCROLLLINES, lines, IntPtr.Zero, SPIF_UPDATEINIFILE_SENDCHANGE);
    }

    private void HandleEnhancePointerPrecision(JObject param)
    {
        bool enable = param.Value<bool?>("enable") ?? true;
        int[] mouseParams = new int[3];
        this._systemParams.GetParameter(SPI_GETMOUSE, 0, mouseParams, 0);
        mouseParams[2] = enable ? 1 : 0;
        this._systemParams.SetParameter(SPI_SETMOUSE, 0, mouseParams, SPIF_UPDATEINIFILE_SENDCHANGE);
    }

    private static void HandleSetPrimaryMouseButton(JObject param)
    {
        string button = param.Value<string>("primaryButton") ?? "left";
        bool leftPrimary = button.Equals("left", StringComparison.OrdinalIgnoreCase);
        SwapMouseButton(leftPrimary ? 0 : 1);
    }
}
