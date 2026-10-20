// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.TypeAgent.VisualStudio.Bridge;
using Newtonsoft.Json.Linq;

internal static class Program
{
    private static int _assertions;
    private static readonly string[] HeaderSeparators = { "\r\n" };

    public static async Task<int> Main()
    {
        try
        {
            if (Environment.GetEnvironmentVariable("TYPEAGENT_VS_TEST_LOAD_CREDENTIAL") == "1")
            {
                BridgeCredential storedCredential = BridgeAuthentication.LoadCredential();
                Assert(
                    storedCredential.Secret.Length == 32,
                    "The C# client must load the TypeScript-provisioned credential");
            }
            TestDiscoveryAuthentication();
            AuthenticatedBridgeSession session = TestMutualHandshake();
            await TestAuthenticationTimeoutIsRetryableAsync();
            await TestExecutorGatingAsync(session);
            Console.WriteLine($"Visual Studio bridge authentication tests passed ({_assertions} assertions).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            return 1;
        }
    }

    private static void TestDiscoveryAuthentication()
    {
        BridgeCredential credential = CreateCredential(0x31);
        const long now = 1_800_000_000_000;
        DiscoveryAuthContext request = BridgeAuthentication.CreateDiscoveryRequest(
            credential,
            BridgeAuthentication.VisualStudioAgentName,
            BridgeAuthentication.VisualStudioAgentRole,
            now);
        const string serverNonce =
            "abababababababababababababababababababababababababababababababab";
        long expiresAt = now + 15_000;
        var auth = new JObject
        {
            ["version"] = 1,
            ["credentialId"] = credential.CredentialId,
            ["requestNonce"] = request.Nonce,
            ["serverNonce"] = serverNonce,
            ["issuedAt"] = now,
            ["expiresAt"] = expiresAt,
            ["proof"] = Proof(
                credential.Secret,
                "typeagent-vs-discovery-response-v1",
                BridgeAuthentication.VisualStudioAgentName,
                BridgeAuthentication.VisualStudioAgentRole,
                credential.CredentialId,
                request.Nonce,
                serverNonce,
                Format(now),
                Format(expiresAt),
                "43123",
                string.Empty),
        };

        Assert(
            BridgeAuthentication.VerifyDiscoveryResponse(
                credential,
                request,
                BridgeAuthentication.VisualStudioAgentName,
                BridgeAuthentication.VisualStudioAgentRole,
                43123,
                null,
                auth,
                now),
            "A valid signed discovery response must authenticate");
        Assert(
            !BridgeAuthentication.VerifyDiscoveryResponse(
                credential,
                request,
                BridgeAuthentication.VisualStudioAgentName,
                BridgeAuthentication.VisualStudioAgentRole,
                43124,
                null,
                auth,
                now),
            "A fake syntactically valid port must invalidate the response proof");
        Assert(
            !BridgeAuthentication.VerifyDiscoveryResponse(
                credential,
                request,
                BridgeAuthentication.VisualStudioAgentName,
                BridgeAuthentication.VisualStudioAgentRole,
                43123,
                null,
                null,
                now),
            "A missing discovery proof must fail closed");
        auth["proof"] = new string('0', 64);
        Assert(
            !BridgeAuthentication.VerifyDiscoveryResponse(
                credential,
                request,
                BridgeAuthentication.VisualStudioAgentName,
                BridgeAuthentication.VisualStudioAgentRole,
                43123,
                null,
                auth,
                now),
            "A wrong discovery proof must fail closed");
    }

    private static AuthenticatedBridgeSession TestMutualHandshake()
    {
        BridgeCredential credential = CreateCredential(0x31);
        long now = BridgeAuthentication.CurrentUnixMilliseconds();
        const string clientInstanceId = "1234567890abcdef1234567890abcdef";
        ClientHelloContext clientHello = BridgeAuthentication.CreateClientHello(
            credential,
            clientInstanceId,
            now);
        const string serverNonce =
            "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
        const string sessionId = "abcdefabcdefabcdefabcdefabcdefab";
        long expiresAt = now + 10 * 60_000;
        var serverHello = new JObject
        {
            ["type"] = "serverHello",
            ["version"] = 1,
            ["credentialId"] = credential.CredentialId,
            ["clientNonce"] = clientHello.ClientNonce,
            ["serverNonce"] = serverNonce,
            ["sessionId"] = sessionId,
            ["issuedAt"] = now,
            ["expiresAt"] = expiresAt,
            ["proof"] = Proof(
                credential.Secret,
                "typeagent-vs-server-hello-v1",
                credential.CredentialId,
                clientInstanceId,
                clientHello.ClientNonce,
                serverNonce,
                sessionId,
                Format(now),
                Format(expiresAt)),
        };
        AuthenticatedBridgeSession? session = BridgeAuthentication.VerifyServerHello(
            credential,
            clientHello,
            serverHello,
            now);
        Assert(session is not null, "A valid server proof must complete mutual authentication");

        serverHello["proof"] = new string('f', 64);
        Assert(
            BridgeAuthentication.VerifyServerHello(
                credential,
                clientHello,
                serverHello,
                now) is null,
            "A wrong server proof must fail before action processing");
        return session!;
    }

    private static async Task TestAuthenticationTimeoutIsRetryableAsync()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        using var serverCancellation = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        Task server = RunSilentWebSocketServerAsync(
            listener,
            expectedConnections: 2,
            serverCancellation.Token);
        try
        {
            int retryableFailures = 0;
            for (int attempt = 0; attempt < 2; attempt++)
            {
                try
                {
                    await AuthenticatedBridgeConnection.RunAsync(
                        new Uri($"ws://127.0.0.1:{port}"),
                        CreateCredential(0x31),
                        BridgeAuthentication.CreateClientInstanceId(),
                        new RecordingExecutor(),
                        CancellationToken.None,
                        TimeSpan.FromMilliseconds(100));
                    throw new InvalidOperationException(
                        "Assertion failed: A silent peer must not authenticate");
                }
                catch (InvalidOperationException ex)
                    when (ex.Message.Contains(
                        "authentication timed out",
                        StringComparison.Ordinal))
                {
                    retryableFailures++;
                }
                catch (OperationCanceledException ex)
                {
                    throw new InvalidOperationException(
                        "Assertion failed: Authentication timeout must be retryable",
                        ex);
                }
            }
            Assert(
                retryableFailures == 2,
                "A silent peer must time out as a retryable authentication failure");
        }
        finally
        {
            listener.Stop();
            serverCancellation.Cancel();
            try
            {
                await server;
            }
            catch (OperationCanceledException)
            {
            }
            catch (SocketException)
            {
            }
        }
    }

    private static async Task RunSilentWebSocketServerAsync(
        TcpListener listener,
        int expectedConnections,
        CancellationToken cancellation)
    {
        var connections = new List<Task>();
        for (int i = 0; i < expectedConnections; i++)
        {
            TcpClient client = await listener
                .AcceptTcpClientAsync(cancellation)
                .ConfigureAwait(false);
            connections.Add(
                CompleteWebSocketHandshakeAndStaySilentAsync(client, cancellation));
        }
        await Task.WhenAll(connections).ConfigureAwait(false);
    }

    private static async Task CompleteWebSocketHandshakeAndStaySilentAsync(
        TcpClient client,
        CancellationToken cancellation)
    {
        using (client)
        using (NetworkStream stream = client.GetStream())
        {
            string headers = await ReadHttpHeadersAsync(stream, cancellation)
                .ConfigureAwait(false);
            string? webSocketKey = null;
            foreach (string line in headers.Split(HeaderSeparators, StringSplitOptions.None))
            {
                const string keyHeader = "Sec-WebSocket-Key:";
                if (line.StartsWith(keyHeader, StringComparison.OrdinalIgnoreCase))
                {
                    webSocketKey = line.Substring(keyHeader.Length).Trim();
                    break;
                }
            }
            if (string.IsNullOrEmpty(webSocketKey))
            {
                throw new InvalidOperationException("WebSocket key was missing");
            }

            byte[] acceptInput = Encoding.ASCII.GetBytes(
                webSocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
#pragma warning disable CA5350 // RFC 6455 requires SHA-1 for Sec-WebSocket-Accept.
            string accept = Convert.ToBase64String(SHA1.HashData(acceptInput));
#pragma warning restore CA5350
            byte[] response = Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + $"Sec-WebSocket-Accept: {accept}\r\n\r\n");
            await stream.WriteAsync(response.AsMemory(), cancellation)
                .ConfigureAwait(false);
            await stream.FlushAsync(cancellation).ConfigureAwait(false);
            await Task.Delay(500, cancellation).ConfigureAwait(false);
        }
    }

    private static async Task<string> ReadHttpHeadersAsync(
        NetworkStream stream,
        CancellationToken cancellation)
    {
        var headers = new StringBuilder();
        var buffer = new byte[1024];
        while (!headers.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
        {
            int count = await stream
                .ReadAsync(buffer.AsMemory(), cancellation)
                .ConfigureAwait(false);
            if (count == 0)
            {
                throw new IOException("WebSocket peer closed during handshake");
            }
            headers.Append(Encoding.ASCII.GetString(buffer, 0, count));
            if (headers.Length > 16 * 1024)
            {
                throw new InvalidOperationException("WebSocket headers exceeded the size limit");
            }
        }
        return headers.ToString();
    }

    private static async Task TestExecutorGatingAsync(AuthenticatedBridgeSession session)
    {
        Assert(
            session.ExpiresAt > BridgeAuthentication.CurrentUnixMilliseconds(),
            "The valid-action fixture must use a live authentication session");
        var executor = new RecordingExecutor();
        var processor = new AuthenticatedBridgeRequestProcessor(session, executor);
        const string requestId = "00112233445566778899aabbccddeeff";
        JObject validFrame = BridgeAuthentication.CreateSecureFrame(
            session.SessionId,
            1,
            "request",
            requestId,
            new JObject
            {
                ["actionName"] = "executeCommand",
                ["parameters"] = new JObject
                {
                    ["commandName"] = "File.SaveAll",
                },
            },
            session.ServerToClientKey);

        string responseText = await processor.ProcessRequestAsync(
            validFrame.ToString(Newtonsoft.Json.Formatting.None),
            CancellationToken.None);
        Assert(executor.CallCount == 1, "An authenticated action must reach the executor once");
        VerifiedSecureFrame? response = BridgeAuthentication.VerifySecureFrame(
            JObject.Parse(responseText),
            session,
            1,
            "response",
            session.ClientToServerKey);
        Assert(response is not null, "The executor response must be protected by the session key");
        Assert(response!.Id == requestId, "The protected response must preserve the request ID");

        await AssertRejectedWithoutExecutorCallAsync(
            processor,
            validFrame,
            executor,
            expectedCalls: 1,
            "A replayed frame must not execute twice");

        var missingAuthExecutor = new RecordingExecutor();
        var missingAuthProcessor = new AuthenticatedBridgeRequestProcessor(
            session,
            missingAuthExecutor);
        await AssertRejectedWithoutExecutorCallAsync(
            missingAuthProcessor,
            new JObject
            {
                ["id"] = requestId,
                ["actionName"] = "executeCommand",
                ["parameters"] = new JObject(),
            },
            missingAuthExecutor,
            expectedCalls: 0,
            "An unprotected action must not reach the executor");

        var wrongCredentialExecutor = new RecordingExecutor();
        var wrongCredentialProcessor = new AuthenticatedBridgeRequestProcessor(
            session,
            wrongCredentialExecutor);
        JObject wrongCredentialFrame = BridgeAuthentication.CreateSecureFrame(
            session.SessionId,
            1,
            "request",
            requestId,
            new JObject
            {
                ["actionName"] = "executeCommand",
                ["parameters"] = new JObject(),
            },
            new byte[32]);
        await AssertRejectedWithoutExecutorCallAsync(
            wrongCredentialProcessor,
            wrongCredentialFrame,
            wrongCredentialExecutor,
            expectedCalls: 0,
            "A wrong or cross-user session key must not reach the executor");

        var expiredExecutor = new RecordingExecutor();
        var expiredSession = new AuthenticatedBridgeSession(
            session.SessionId,
            BridgeAuthentication.CurrentUnixMilliseconds() - 1,
            session.ClientToServerKey,
            session.ServerToClientKey);
        var expiredProcessor = new AuthenticatedBridgeRequestProcessor(
            expiredSession,
            expiredExecutor);
        JObject expiredFrame = BridgeAuthentication.CreateSecureFrame(
            expiredSession.SessionId,
            1,
            "request",
            requestId,
            new JObject
            {
                ["actionName"] = "executeCommand",
                ["parameters"] = new JObject(),
            },
            expiredSession.ServerToClientKey);
        await AssertRejectedWithoutExecutorCallAsync(
            expiredProcessor,
            expiredFrame,
            expiredExecutor,
            expectedCalls: 0,
            "An expired session must not reach the executor");
    }

    private static async Task AssertRejectedWithoutExecutorCallAsync(
        AuthenticatedBridgeRequestProcessor processor,
        JObject frame,
        RecordingExecutor executor,
        int expectedCalls,
        string message)
    {
        try
        {
            await processor.ProcessRequestAsync(
                frame.ToString(Newtonsoft.Json.Formatting.None),
                CancellationToken.None);
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
        catch (InvalidOperationException ex)
        {
            Assert(
                !ex.Message.Contains("001122", StringComparison.Ordinal),
                "Authentication failures must not disclose authenticated envelopes");
        }
        Assert(executor.CallCount == expectedCalls, message);
    }

    private static BridgeCredential CreateCredential(byte fill)
    {
        byte[] secret = new byte[32];
        Array.Fill(secret, fill);
        using var sha256 = SHA256.Create();
        string credentialId = Hex(sha256.ComputeHash(secret)).Substring(0, 32);
        return new BridgeCredential(credentialId, secret);
    }

    private static string Proof(byte[] key, string domain, params string[] fields)
    {
        using var hmac = new HMACSHA256(key);
        var input = new StringBuilder(domain);
        foreach (string field in fields)
        {
            input.Append('\n');
            input.Append(field);
        }
        return Hex(hmac.ComputeHash(Encoding.UTF8.GetBytes(input.ToString())));
    }

    private static string Hex(byte[] value)
    {
        var builder = new StringBuilder(value.Length * 2);
        foreach (byte b in value)
        {
            builder.Append(b.ToString("x2", CultureInfo.InvariantCulture));
        }
        return builder.ToString();
    }

    private static string Format(long value) =>
        value.ToString(CultureInfo.InvariantCulture);

    private static void Assert(bool condition, string message)
    {
        _assertions++;
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }

    private sealed class RecordingExecutor : IBridgeActionExecutor
    {
        public int CallCount { get; private set; }

        public Task<object?> ExecuteAsync(
            string actionName,
            JObject parameters,
            CancellationToken cancellation)
        {
            CallCount++;
            return Task.FromResult<object?>(new
            {
                actionName,
                parameters,
            });
        }
    }
}
