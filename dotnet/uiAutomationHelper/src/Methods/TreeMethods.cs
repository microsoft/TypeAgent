// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;
using UiAutomationHelper.Rpc;
using UiAutomationHelper.Uia;

namespace UiAutomationHelper.Methods;

internal static class TreeMethods
{
    public static void Register(Dispatch dispatch)
    {
        dispatch.Register("tree.dump", (p, ct) => Task.FromResult(Dump(p)));
    }

    private static object? Dump(System.Text.Json.JsonElement? @params)
    {
        var p = RpcParams.ParseRequired<TreeDumpParams>(@params);
        if (string.IsNullOrEmpty(p.Root))
        {
            throw new Models.RpcException(Models.RpcErrorCode.InvalidParams, "'root' is required");
        }
        var element = SelectorResolver.ResolveOrThrow(p.Root);
        var depth = p.MaxDepth ?? 20;
        return TreeWalker.Walk(element, p.Root, depth);
    }
}

internal sealed class TreeDumpParams
{
    [JsonPropertyName("root")] public string? Root { get; set; }
    [JsonPropertyName("maxDepth")] public int? MaxDepth { get; set; }
    [JsonPropertyName("filter")] public string? Filter { get; set; }
}
