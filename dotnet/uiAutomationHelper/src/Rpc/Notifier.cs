// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace UiAutomationHelper.Rpc;

/// <summary>
/// Static facade so event handlers (which aren't connected to dispatch) can
/// push JSON-RPC notifications back to the client. Initialized in Program.cs.
/// </summary>
internal static class Notifier
{
    private static JsonRpcServer? _server;

    public static void Init(JsonRpcServer server)
    {
        _server = server;
    }

    public static void Send(string method, object? @params)
    {
        _server?.Notify(method, @params);
    }
}
