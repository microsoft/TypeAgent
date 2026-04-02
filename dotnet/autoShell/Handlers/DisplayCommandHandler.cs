// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles display commands: setScreenResolution, listResolutions, setTextSize.
/// </summary>
internal class DisplayCommandHandler : ICommandHandler
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

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    private static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    private static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);

    #endregion P/Invoke

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ListResolutions",
        "SetScreenResolution",
        "SetTextSize",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "SetTextSize":
                if (int.TryParse(value, out int textSizePct))
                {
                    this.SetTextSize(textSizePct);
                }
                break;

            case "SetScreenResolution":
                this.SetDisplayResolution(rawValue);
                break;

            case "ListResolutions":
                ListDisplayResolutions();
                break;
        }
    }

    /// <summary>
    /// Sets the system text scaling factor (percentage).
    /// </summary>
    private void SetTextSize(int percentage)
    {
        try
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
            UIAutomation.SetTextSizeViaUIAutomation(percentage);
#pragma warning restore CS0618
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    /// <summary>
    /// Lists all available display resolutions for the primary monitor.
    /// </summary>
    private void ListDisplayResolutions()
    {
        try
        {
            var resolutions = new List<object>();
            DEVMODE devMode = new DEVMODE();
            devMode.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));

            int modeNum = 0;
            while (EnumDisplaySettings(null, modeNum, ref devMode))
            {
                resolutions.Add(new
                {
                    Width = devMode.dmPelsWidth,
                    Height = devMode.dmPelsHeight,
                    BitsPerPixel = devMode.dmBitsPerPel,
                    RefreshRate = devMode.dmDisplayFrequency
                });
                modeNum++;
            }

            var uniqueResolutions = resolutions
                .GroupBy(r => new { ((dynamic)r).Width, ((dynamic)r).Height, ((dynamic)r).RefreshRate })
                .Select(g => g.First())
                .OrderByDescending(r => ((dynamic)r).Width)
                .ThenByDescending(r => ((dynamic)r).Height)
                .ThenByDescending(r => ((dynamic)r).RefreshRate)
                .ToList();

            Console.WriteLine(JsonConvert.SerializeObject(uniqueResolutions));
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }

    /// <summary>
    /// Sets the display resolution.
    /// </summary>
    private void SetDisplayResolution(JToken value)
    {
        try
        {
            uint width;
            uint height;
            uint? refreshRate = null;

            if (value.Type == JTokenType.Object)
            {
                width = value.Value<uint>("width");
                height = value.Value<uint>("height");
                if (value["refreshRate"] != null)
                {
                    refreshRate = value.Value<uint>("refreshRate");
                }
            }
            else
            {
                string resString = value.ToString();
                string[] parts = resString.ToLowerInvariant().Split('x', '@');
                if (parts.Length < 2)
                {
                    AutoShell.LogWarning("Invalid resolution format. Use 'WIDTHxHEIGHT' or 'WIDTHxHEIGHT@REFRESH' (e.g., '1920x1080' or '1920x1080@60')");
                    return;
                }

                if (!uint.TryParse(parts[0].Trim(), out width) || !uint.TryParse(parts[1].Trim(), out height))
                {
                    AutoShell.LogWarning("Invalid resolution values. Width and height must be positive integers.");
                    return;
                }

                if (parts.Length >= 3 && uint.TryParse(parts[2].Trim(), out uint parsedRefresh))
                {
                    refreshRate = parsedRefresh;
                }
            }

            DEVMODE currentMode = new DEVMODE();
            currentMode.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));

            if (!EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref currentMode))
            {
                AutoShell.LogWarning("Failed to get current display settings.");
                return;
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
                AutoShell.LogWarning($"Resolution {width}x{height}" + (refreshRate.HasValue ? $"@{refreshRate}Hz" : "") + " is not supported.");
                return;
            }

            bestMatch.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;

            // TODO: better handle return value from change mode
            int testResult = ChangeDisplaySettings(ref bestMatch, CDS_TEST);
            if (testResult != DISP_CHANGE_SUCCESSFUL && testResult != -2)
            {
                AutoShell.LogWarning($"Display mode test failed with code: {testResult}");
                return;
            }

            int result = ChangeDisplaySettings(ref bestMatch, CDS_UPDATEREGISTRY);
            switch (result)
            {
                case DISP_CHANGE_SUCCESSFUL:
                    Console.WriteLine($"Resolution changed to {bestMatch.dmPelsWidth}x{bestMatch.dmPelsHeight}@{bestMatch.dmDisplayFrequency}Hz");
                    break;
                case DISP_CHANGE_RESTART:
                    Console.WriteLine($"Resolution will change to {bestMatch.dmPelsWidth}x{bestMatch.dmPelsHeight} after restart.");
                    break;
                default:
                    AutoShell.LogWarning($"Failed to change resolution. Error code: {result}");
                    break;
            }
        }
        catch (Exception ex)
        {
            AutoShell.LogError(ex);
        }
    }
}
