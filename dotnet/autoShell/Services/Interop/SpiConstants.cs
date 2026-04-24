// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace autoShell.Services.Interop;

/// <summary>
/// Win32 SystemParametersInfo (SPI) constants and flags.
/// Shared between handlers and tests to avoid duplicated magic numbers.
/// </summary>
internal static class SpiConstants
{
    // Flags
    public const int SPIF_UPDATEINIFILE = 0x01;
    public const int SPIF_SENDCHANGE = 0x02;
    public const int SPIF_UPDATEINIFILE_SENDCHANGE = SPIF_UPDATEINIFILE | SPIF_SENDCHANGE;

    // Mouse
    public const int SPI_GETMOUSE = 0x0003;
    public const int SPI_SETMOUSE = 0x0004;
    public const int SPI_SETDESKWALLPAPER = 0x0014;
    public const int SPI_SETMOUSETRAILS = 0x005D;
    public const int SPI_SETWHEELSCROLLLINES = 0x0069;
    public const int SPI_SETMOUSESPEED = 0x0071;
    public const int SPI_SETMOUSESONAR = 0x101D;

    // Accessibility
    public const int SPI_GETFILTERKEYS = 0x0032;
    public const int SPI_SETFILTERKEYS = 0x0033;
    public const int SPI_GETSTICKYKEYS = 0x003A;
    public const int SPI_SETSTICKYKEYS = 0x003B;
}
