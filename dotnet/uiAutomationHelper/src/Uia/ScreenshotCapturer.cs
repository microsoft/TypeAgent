// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Uia;

internal static class ScreenshotCapturer
{
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private const int PW_RENDERFULLCONTENT = 0x00000002;

    public static (byte[] PngBytes, Rect Bounds) Capture(IntPtr hwnd)
    {
        if (!GetWindowRect(hwnd, out var r))
        {
            throw new InvalidOperationException("GetWindowRect failed");
        }
        int w = r.Right - r.Left;
        int h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0)
        {
            throw new InvalidOperationException($"Invalid window size {w}x{h}");
        }

        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            var hdc = g.GetHdc();
            try
            {
                if (!PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT))
                {
                    throw new InvalidOperationException("PrintWindow failed");
                }
            }
            finally
            {
                g.ReleaseHdc(hdc);
            }
        }

        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        return (ms.ToArray(), new Rect(r.Left, r.Top, w, h));
    }
}
