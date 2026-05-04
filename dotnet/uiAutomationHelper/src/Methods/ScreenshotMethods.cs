// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class ScreenshotMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("screenshot", (p, ct) => Task.FromResult(Capture(p)));
    }

    private static object? Capture(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<ScreenshotParams>(@params);
        if (string.IsNullOrEmpty(p.Root))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'root' is required");
        }
        var element = SelectorResolver.ResolveOrThrow(p.Root);
        var hwnd = (IntPtr)element.Properties.NativeWindowHandle.ValueOrDefault;
        if (hwnd == IntPtr.Zero)
        {
            throw new RpcException(RpcErrorCode.InternalError, "Element has no native window handle");
        }
        try
        {
            var (bytes, rect) = ScreenshotCapturer.Capture(hwnd);
            return new { pngBase64 = Convert.ToBase64String(bytes), rect };
        }
        catch (Exception ex)
        {
            throw new RpcException(RpcErrorCode.InternalError, $"Screenshot failed: {ex.Message}");
        }
    }
}

internal sealed class ScreenshotParams
{
    [JsonPropertyName("root")] public string? Root { get; set; }
}
