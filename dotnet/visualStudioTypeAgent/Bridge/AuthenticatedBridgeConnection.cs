// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Microsoft.TypeAgent.VisualStudio.Bridge;

internal interface IBridgeActionExecutor
{
    Task<object?> ExecuteAsync(
        string actionName,
        JObject parameters,
        CancellationToken cancellation);
}

internal sealed class AuthenticatedBridgeRequestProcessor
{
    private readonly AuthenticatedBridgeSession _session;
    private readonly IBridgeActionExecutor _executor;
    private long _receiveSequence;
    private long _sendSequence;

    public AuthenticatedBridgeRequestProcessor(
        AuthenticatedBridgeSession session,
        IBridgeActionExecutor executor)
    {
        _session = session;
        _executor = executor;
    }

    public async Task<string> ProcessRequestAsync(
        string json,
        CancellationToken cancellation)
    {
        JObject root;
        try
        {
            root = JObject.Parse(json);
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException("Authenticated bridge frame was malformed", ex);
        }

        VerifiedSecureFrame? verified = BridgeAuthentication.VerifySecureFrame(
            root,
            _session,
            _receiveSequence + 1,
            "request",
            _session.ServerToClientKey);
        if (verified is null)
        {
            throw new InvalidOperationException("Authenticated bridge frame was rejected");
        }

        string? actionName = verified.Payload.Value<string>("actionName");
        JObject? parameters = verified.Payload["parameters"] as JObject;
        if (actionName is null
            || actionName.Trim().Length == 0
            || parameters is null)
        {
            throw new InvalidOperationException("Authenticated bridge request was malformed");
        }

        _receiveSequence = verified.Sequence;
        var response = new JObject
        {
            ["id"] = verified.Id,
        };
        try
        {
            object? result = await _executor
                .ExecuteAsync(actionName, parameters, cancellation)
                .ConfigureAwait(false);
            response["success"] = true;
            if (result is not null)
            {
                response["result"] = JToken.FromObject(result);
            }
        }
        catch (Exception ex)
        {
            response["success"] = false;
            response["error"] = ex.Message;
        }

        JObject frame = BridgeAuthentication.CreateSecureFrame(
            _session.SessionId,
            ++_sendSequence,
            "response",
            verified.Id,
            response,
            _session.ClientToServerKey);
        return frame.ToString(Formatting.None);
    }
}

internal static class AuthenticatedBridgeConnection
{
    // This channel carries only authenticated VisualStudioActions and compact
    // EnvDTE results. Chat and attachment data use the dispatcher connection,
    // so 1 MiB is ample while bounding peer-controlled buffering.
    internal const int MaxMessageBytes = 1024 * 1024;
    private static readonly TimeSpan DefaultAuthenticationTimeout =
        TimeSpan.FromSeconds(5);

    public static async Task RunAsync(
        Uri uri,
        BridgeCredential credential,
        string clientInstanceId,
        IBridgeActionExecutor executor,
        CancellationToken cancellation,
        TimeSpan? authenticationTimeout = null)
    {
        using var ws = new ClientWebSocket();
        await ws.ConnectAsync(uri, cancellation).ConfigureAwait(false);

        ClientHelloContext clientHello = BridgeAuthentication.CreateClientHello(
            credential,
            clientInstanceId);
        await SendTextAsync(
            ws,
            clientHello.Message.ToString(Formatting.None),
            cancellation).ConfigureAwait(false);

        TimeSpan timeout = authenticationTimeout ?? DefaultAuthenticationTimeout;
        if (timeout <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(
                nameof(authenticationTimeout),
                "Authentication timeout must be positive");
        }

        string serverHelloText;
        using (var authenticationCancellation =
            CancellationTokenSource.CreateLinkedTokenSource(cancellation))
        {
            authenticationCancellation.CancelAfter(timeout);
            try
            {
                serverHelloText = await ReceiveTextAsync(
                    ws,
                    authenticationCancellation.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException ex)
                when (!cancellation.IsCancellationRequested)
            {
                await CloseForPolicyViolationAsync(ws).ConfigureAwait(false);
                throw new InvalidOperationException(
                    "Bridge peer authentication timed out",
                    ex);
            }
        }
        AuthenticatedBridgeSession? session = BridgeAuthentication.VerifyServerHello(
            credential,
            clientHello,
            JObject.Parse(serverHelloText));
        if (session is null)
        {
            await CloseForPolicyViolationAsync(ws).ConfigureAwait(false);
            throw new InvalidOperationException("Bridge peer authentication failed");
        }

        var processor = new AuthenticatedBridgeRequestProcessor(session, executor);
        while (ws.State == WebSocketState.Open && !cancellation.IsCancellationRequested)
        {
            string request;
            try
            {
                request = await ReceiveTextAsync(ws, cancellation).ConfigureAwait(false);
            }
            catch (WebSocketException) when (ws.State != WebSocketState.Open)
            {
                return;
            }
            catch (InvalidOperationException)
            {
                await CloseForPolicyViolationAsync(ws).ConfigureAwait(false);
                throw;
            }

            string response;
            try
            {
                response = await processor
                    .ProcessRequestAsync(request, cancellation)
                    .ConfigureAwait(false);
            }
            catch (InvalidOperationException)
            {
                await CloseForPolicyViolationAsync(ws).ConfigureAwait(false);
                throw;
            }
            await SendTextAsync(ws, response, cancellation).ConfigureAwait(false);
        }
    }

    internal static async Task<string> ReceiveTextAsync(
        WebSocket ws,
        CancellationToken cancellation)
    {
        var buffer = new ArraySegment<byte>(new byte[16 * 1024]);
        var assembly = new StringBuilder();
        int totalBytes = 0;
        WebSocketReceiveResult result;
        do
        {
            result = await ws.ReceiveAsync(buffer, cancellation).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                if (ws.State == WebSocketState.CloseReceived)
                {
                    await ws.CloseOutputAsync(
                        WebSocketCloseStatus.NormalClosure,
                        null,
                        CancellationToken.None).ConfigureAwait(false);
                }
                throw new WebSocketException("Bridge WebSocket closed");
            }
            if (result.MessageType != WebSocketMessageType.Text)
            {
                throw new InvalidOperationException("Bridge sent a non-text message");
            }
            totalBytes += result.Count;
            if (totalBytes > MaxMessageBytes)
            {
                throw new InvalidOperationException("Bridge message exceeded the size limit");
            }
            assembly.Append(Encoding.UTF8.GetString(buffer.Array!, 0, result.Count));
        } while (!result.EndOfMessage);
        return assembly.ToString();
    }

    private static Task SendTextAsync(
        ClientWebSocket ws,
        string text,
        CancellationToken cancellation)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        return ws.SendAsync(
            new ArraySegment<byte>(bytes),
            WebSocketMessageType.Text,
            endOfMessage: true,
            cancellation);
    }

    private static async Task CloseForPolicyViolationAsync(ClientWebSocket ws)
    {
        if (ws.State != WebSocketState.Open && ws.State != WebSocketState.CloseReceived)
        {
            return;
        }
        try
        {
            await ws.CloseOutputAsync(
                WebSocketCloseStatus.PolicyViolation,
                "Authentication failed",
                CancellationToken.None).ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
        }
    }
}
