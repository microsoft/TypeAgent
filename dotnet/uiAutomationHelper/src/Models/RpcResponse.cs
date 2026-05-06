// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace UiAutomationHelper.Models;

internal sealed class RpcResponse
{
    [JsonPropertyName("jsonrpc")] public string JsonRpc { get; init; } = "2.0";
    [JsonPropertyName("id")] public JsonElement? Id { get; init; }
    [JsonPropertyName("result")] public object? Result { get; init; }
    [JsonPropertyName("error")] public RpcErrorObject? Error { get; init; }

    public static RpcResponse Success(JsonElement? id, object? result) =>
        new() { Id = id, Result = result };

    public static RpcResponse Fail(JsonElement? id, RpcErrorCode code, string message, object? data = null) =>
        new()
        {
            Id = id,
            Error = new RpcErrorObject { Code = (int)code, Message = message, Data = data },
        };
}

internal sealed class RpcErrorObject
{
    [JsonPropertyName("code")] public int Code { get; set; }
    [JsonPropertyName("message")] public string Message { get; set; } = "";
    [JsonPropertyName("data")] public object? Data { get; set; }
}
