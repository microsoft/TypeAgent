// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;
using UiAutomationHelper.Models;

namespace UiAutomationHelper.Rpc;

internal sealed class JsonRpcServer
{
    private readonly TextReader _input;
    private readonly TextWriter _output;
    private readonly Dispatch _dispatch;
    private readonly object _writeLock = new();

    internal static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public JsonRpcServer(TextReader input, TextWriter output, Dispatch dispatch)
    {
        _input = input;
        _output = output;
        _dispatch = dispatch;
    }

    /// <summary>
    /// Send a JSON-RPC notification (server → client, no id). Safe to call
    /// from background threads (UIA event handler thread, etc.).
    /// </summary>
    public void Notify(string method, object? @params)
    {
        var msg = new RpcNotification { Method = method, Params = @params };
        string json;
        try
        {
            json = JsonSerializer.Serialize(msg, JsonOpts);
        }
        catch
        {
            return; // best-effort
        }
        lock (_writeLock)
        {
            try
            {
                _output.WriteLine(json);
                _output.Flush();
            }
            catch
            {
                // Pipe may be closed during shutdown; ignore.
            }
        }
    }

    public async Task RunAsync(CancellationToken ct = default)
    {
        while (!ct.IsCancellationRequested)
        {
            string? line;
            try
            {
                line = await _input.ReadLineAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (line == null)
            {
                break;
            }
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var response = await HandleLineAsync(line, ct).ConfigureAwait(false);
            Write(response);
        }
    }

    private async Task<RpcResponse> HandleLineAsync(string line, CancellationToken ct)
    {
        RpcRequest? request = null;
        try
        {
            request = JsonSerializer.Deserialize<RpcRequest>(line, JsonOpts);
            if (request == null || string.IsNullOrEmpty(request.Method))
            {
                return RpcResponse.Fail(request?.Id, RpcErrorCode.InvalidRequest, "Invalid request");
            }
            var result = await _dispatch.InvokeAsync(request.Method, request.Params, ct)
                .ConfigureAwait(false);
            return RpcResponse.Success(request.Id, result);
        }
        catch (JsonException ex)
        {
            return RpcResponse.Fail(request?.Id, RpcErrorCode.ParseError, ex.Message);
        }
        catch (RpcException ex)
        {
            return RpcResponse.Fail(request?.Id, ex.Code, ex.Message, ex.ErrorData);
        }
        catch (OperationCanceledException)
        {
            return RpcResponse.Fail(request?.Id, RpcErrorCode.InternalError, "Cancelled");
        }
        catch (Exception ex)
        {
            return RpcResponse.Fail(request?.Id, RpcErrorCode.InternalError, ex.Message);
        }
    }

    private void Write(RpcResponse response)
    {
        string json;
        try
        {
            json = JsonSerializer.Serialize(response, JsonOpts);
        }
        catch (Exception ex)
        {
            json = JsonSerializer.Serialize(
                RpcResponse.Fail(response.Id, RpcErrorCode.InternalError, $"Failed to serialize response: {ex.Message}"),
                JsonOpts);
        }
        lock (_writeLock)
        {
            _output.WriteLine(json);
            _output.Flush();
        }
    }
}
