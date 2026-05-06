// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Rpc;

internal delegate Task<object?> RpcMethod(JsonElement? @params, CancellationToken ct);

internal sealed class Dispatch
{
    private readonly Dictionary<string, RpcMethod> _methods = new(StringComparer.Ordinal);

    public void Register(string name, RpcMethod method)
    {
        if (_methods.ContainsKey(name))
        {
            throw new InvalidOperationException($"Method already registered: {name}");
        }
        _methods[name] = method;
    }

    public Task<object?> InvokeAsync(string name, JsonElement? @params, CancellationToken ct)
    {
        if (!_methods.TryGetValue(name, out var method))
        {
            throw new RpcException(RpcErrorCode.MethodNotFound, $"Method not found: {name}");
        }
        return method(@params, ct);
    }
}
