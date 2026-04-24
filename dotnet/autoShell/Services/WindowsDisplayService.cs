// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using autoShell.Logging;
using autoShell.Services.Interop;

namespace autoShell.Services;

/// <summary>
/// Concrete implementation of <see cref="IDisplayService"/> using Win32 P/Invoke and <see cref="Interop.UIAutomation"/>.
/// </summary>
internal class WindowsDisplayService : IDisplayService
{
    #region P/Invoke

    private const int ENUM_CURRENT_SETTINGS = -1;
    private const int DISP_CHANGE_SUCCESSFUL = 0;
    private const int DISP_CHANGE_RESTART = 1;

    private const int DM_PELSWIDTH = 0x80000;
    private const int DM_PELSHEIGHT = 0x100000;
    private const int DM_DISPLAYFREQUENCY = 0x400000;

    private const int CDS_UPDATEREGISTRY = 0x01;
    private const int CDS_TEST = 0x02;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct DEVMODE
    {
        private const int CCHDEVICENAME = 32;
        private const int CCHFORMNAME = 32;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCHDEVICENAME)]
        public string dmDeviceName;
        public ushort dmSpecVersion;
        public ushort dmDriverVersion;
        public ushort dmSize;
        public ushort dmDriverExtra;
        public uint dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public uint dmDisplayOrientation;
        public uint dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCHFORMNAME)]
        public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel;
        public uint dmPelsWidth;
        public uint dmPelsHeight;
        public uint dmDisplayFlags;
        public uint dmDisplayFrequency;
        public uint dmICMMethod;
        public uint dmICMIntent;
        public uint dmMediaType;
        public uint dmDitherType;
        public uint dmReserved1;
        public uint dmReserved2;
        public uint dmPanningWidth;
        public uint dmPanningHeight;
    }

    [DllImport(NativeDlls.User32, CharSet = CharSet.Ansi)]
    private static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport(NativeDlls.User32, CharSet = CharSet.Ansi)]
    private static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);

    #endregion P/Invoke

    private record Resolution(uint Width, uint Height, uint BitsPerPixel, uint RefreshRate);

    private readonly ILogger _logger;

    public WindowsDisplayService(ILogger logger)
    {
        _logger = logger;
    }

    /// <inheritdoc/>
    public string ListResolutions()
    {
        var resolutions = new List<Resolution>();
        DEVMODE devMode = new DEVMODE();
        devMode.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));

        int modeNum = 0;
        while (EnumDisplaySettings(null, modeNum, ref devMode))
        {
            resolutions.Add(new Resolution(
                devMode.dmPelsWidth,
                devMode.dmPelsHeight,
                devMode.dmBitsPerPel,
                devMode.dmDisplayFrequency));
            modeNum++;
        }

        var uniqueResolutions = resolutions
            .GroupBy(r => new { r.Width, r.Height, r.RefreshRate })
            .Select(g => g.First())
            .OrderByDescending(r => r.Width)
            .ThenByDescending(r => r.Height)
            .ThenByDescending(r => r.RefreshRate)
            .ToList();

        return JsonSerializer.Serialize(uniqueResolutions, JsonOptions.CamelCase);
    }

    /// <inheritdoc/>
    public string SetResolution(uint width, uint height, uint? refreshRate = null)
    {
        DEVMODE currentMode = new DEVMODE();
        currentMode.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));

        if (!EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref currentMode))
        {
            return "Failed to get current display settings.";
        }

        DEVMODE newMode = new DEVMODE();
        newMode.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));

        int modeNum = 0;
        bool found = false;
        DEVMODE bestMatch = new DEVMODE();

        while (EnumDisplaySettings(null, modeNum, ref newMode))
        {
            if (newMode.dmPelsWidth == width && newMode.dmPelsHeight == height)
            {
                if (refreshRate.HasValue)
                {
                    if (newMode.dmDisplayFrequency == refreshRate.Value)
                    {
                        bestMatch = newMode;
                        found = true;
                        break;
                    }
                }
                else
                {
                    if (!found || newMode.dmDisplayFrequency > bestMatch.dmDisplayFrequency)
                    {
                        bestMatch = newMode;
                        found = true;
                    }
                }
            }
            modeNum++;
        }

        if (!found)
        {
            return $"Resolution {width}x{height}" + (refreshRate.HasValue ? $"@{refreshRate}Hz" : "") + " is not supported.";
        }

        bestMatch.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;

        // TODO: better handle return value from change mode
        int testResult = ChangeDisplaySettings(ref bestMatch, CDS_TEST);
        if (testResult != DISP_CHANGE_SUCCESSFUL && testResult != -2)
        {
            return $"Display mode test failed with code: {testResult}";
        }

        int result = ChangeDisplaySettings(ref bestMatch, CDS_UPDATEREGISTRY);
        return result switch
        {
            DISP_CHANGE_SUCCESSFUL => $"Resolution changed to {bestMatch.dmPelsWidth}x{bestMatch.dmPelsHeight}@{bestMatch.dmDisplayFrequency}Hz",
            DISP_CHANGE_RESTART => $"Resolution will change to {bestMatch.dmPelsWidth}x{bestMatch.dmPelsHeight} after restart.",
            _ => $"Failed to change resolution. Error code: {result}",
        };
    }

    /// <inheritdoc/>
    public void SetTextSize(int percentage)
    {
        if (percentage == -1)
        {
            percentage = new Random().Next(100, 225 + 1);
        }

        if (percentage < 100)
        {
            percentage = 100;
        }
        else if (percentage > 225)
        {
            percentage = 225;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "ms-settings:easeofaccess",
            UseShellExecute = true
        });

#pragma warning disable CS0618 // UIAutomation is intentionally marked obsolete as a last-resort approach
        UIAutomation.SetTextSizeViaUIAutomation(percentage, _logger);
#pragma warning restore CS0618
    }
}
