// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace UiAutomationHelper.Models;

internal sealed class RpcNotification
{
    [JsonPropertyName("jsonrpc")] public string JsonRpc { get; init; } = "2.0";
    [JsonPropertyName("method")] public string Method { get; init; } = "";
    [JsonPropertyName("params")] public object? Params { get; init; }
}
