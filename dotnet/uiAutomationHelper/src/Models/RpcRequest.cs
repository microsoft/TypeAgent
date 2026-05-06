// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace UiAutomationHelper.Models;

internal sealed class RpcRequest
{
    [JsonPropertyName("jsonrpc")] public string? JsonRpc { get; set; }
    [JsonPropertyName("id")] public JsonElement? Id { get; set; }
    [JsonPropertyName("method")] public string? Method { get; set; }
    [JsonPropertyName("params")] public JsonElement? Params { get; set; }
}
