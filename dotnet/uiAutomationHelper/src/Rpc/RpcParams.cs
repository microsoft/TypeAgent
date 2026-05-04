// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Rpc;

internal static class RpcParams
{
    public static T Parse<T>(JsonElement? @params) where T : new()
    {
        if (@params == null
            || @params.Value.ValueKind == JsonValueKind.Null
            || @params.Value.ValueKind == JsonValueKind.Undefined)
        {
            return new T();
        }
        try
        {
            return JsonSerializer.Deserialize<T>(@params.Value, JsonRpcServer.JsonOpts) ?? new T();
        }
        catch (JsonException ex)
        {
            throw new RpcException(RpcErrorCode.InvalidParams, ex.Message);
        }
    }

    public static T ParseRequired<T>(JsonElement? @params) where T : new()
    {
        if (@params == null
            || @params.Value.ValueKind == JsonValueKind.Null
            || @params.Value.ValueKind == JsonValueKind.Undefined)
        {
            throw new RpcException(RpcErrorCode.InvalidParams, "Missing params");
        }
        return Parse<T>(@params);
    }
}
