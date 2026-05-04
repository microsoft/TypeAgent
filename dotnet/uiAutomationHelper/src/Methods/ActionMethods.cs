// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class ActionMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("do.invoke", (p, ct) => Task.FromResult(Invoke(p)));
    }

    private static object? Invoke(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<DoInvokeParams>(@params);
        if (string.IsNullOrEmpty(p.Selector))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'selector' is required");
        }
        var el = SelectorResolver.ResolveOrThrow(p.Selector);
        if (!el.Properties.IsEnabled.ValueOrDefault)
        {
            throw new RpcException(RpcErrorCode.ElementNotEnabled, $"Element is not enabled: {p.Selector}");
        }
        if (!el.Patterns.Invoke.IsSupported)
        {
            throw new RpcException(RpcErrorCode.PatternNotSupported,
                $"Element does not support Invoke: {p.Selector}");
        }
        el.Patterns.Invoke.Pattern.Invoke();
        return new { ok = true };
    }
}

internal sealed class DoInvokeParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
}
