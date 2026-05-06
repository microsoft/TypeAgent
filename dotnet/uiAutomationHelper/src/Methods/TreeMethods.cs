// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;
using UiAutomationHelper.Models;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class TreeMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("tree.dump",        (p, ct) => Task.FromResult(Dump(p)));
        dispatch.Register("tree.fingerprint", (p, ct) => Task.FromResult(Fingerprint(p)));
    }

    private static object? Dump(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<TreeDumpParams>(@params);
        if (string.IsNullOrEmpty(p.Root))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'root' is required");
        }
        return ComRetry.Run(() =>
        {
            var element = SelectorResolver.ResolveOrThrow(p.Root);
            int depth = p.MaxDepth ?? 20;
            return (object?)TreeWalker.Walk(element, p.Root, depth);
        });
    }

    private static object? Fingerprint(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<TreeFingerprintParams>(@params);
        if (string.IsNullOrEmpty(p.Root))
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "'root' is required");
        }
        return ComRetry.Run(() =>
        {
            var element = SelectorResolver.ResolveOrThrow(p.Root);
            var result = FingerprintComputer.Compute(element, p.Root, p.DynamicRules);
            return (object?)new
            {
                hash = result.Hash,
                controlCount = result.ControlCount,
                activeWindowTitle = result.ActiveWindowTitle,
                focusedSelector = result.FocusedSelector,
            };
        });
    }
}

internal sealed class TreeDumpParams
{
    [JsonPropertyName("root")] public string? Root { get; set; }
    [JsonPropertyName("maxDepth")] public int? MaxDepth { get; set; }
    [JsonPropertyName("filter")] public string? Filter { get; set; }
}

internal sealed class TreeFingerprintParams
{
    [JsonPropertyName("root")] public string? Root { get; set; }
    [JsonPropertyName("dynamicRules")] public DynamicControlRule[]? DynamicRules { get; set; }
}
