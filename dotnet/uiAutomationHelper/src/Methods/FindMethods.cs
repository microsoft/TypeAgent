// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.Text.Json.Serialization;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class FindMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("find", FindAsync);
    }

    private static async Task<object?> FindAsync(System.Text.Json.JsonElement? @params, CancellationToken ct)
    {
        var p = RpcParams.ParseRequired<FindParams>(@params);
        if (string.IsNullOrEmpty(p.Selector))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'selector' is required");
        }
        var path = SelectorParser.Parse(p.Selector);
        int timeoutMs = p.TimeoutMs ?? 0;
        var sw = Stopwatch.StartNew();
        while (true)
        {
            var element = SelectorResolver.Resolve(path);
            if (element != null)
            {
                return new { found = true, resolved = p.Selector };
            }
            if (sw.ElapsedMilliseconds >= timeoutMs)
            {
                return new { found = false };
            }
            await Task.Delay(100, ct).ConfigureAwait(false);
        }
    }
}

internal sealed class FindParams
{
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("timeoutMs")] public int? TimeoutMs { get; set; }
}
