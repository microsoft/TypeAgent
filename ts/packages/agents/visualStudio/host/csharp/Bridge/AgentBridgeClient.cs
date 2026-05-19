// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Microsoft.TypeAgent.VisualStudio.Bridge
{
    /// <summary>
    /// WebSocket client that connects to the visualstudio-agent's bridge.
    /// Receives BridgeRequest messages, dispatches them through
    /// DTEActionExecutor, and sends BridgeResponse messages back.
    ///
    /// Port discovery:
    ///   The bridge port is no longer hardcoded. On each connect attempt
    ///   we ask the agent-server's discovery channel where the
    ///   `(visualStudio, default)` allocation lives, falling back to the
    ///   well-known port (5680) when discovery is disabled or fails.
    ///   See <see cref="BridgeDiscovery"/> for the wire protocol and the
    ///   env-var knobs (`AGENT_SERVER_PORT`,
    ///   `TYPEAGENT_VS_USE_DISCOVERY`, `TYPEAGENT_VS_FALLBACK_PORT`).
    ///
    /// Wire format (matches packages/agents/visualStudio/src/visualStudioActionHandler.ts):
    ///   request:  { id, actionName, parameters }
    ///   response: { id, success, result?, error? }
    /// </summary>
    internal sealed class AgentBridgeClient : IDisposable
    {
        private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(3);

        private readonly AsyncPackage _package;
        private readonly DTEActionExecutor _executor;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private ClientWebSocket? _ws;

        public AgentBridgeClient(AsyncPackage package)
        {
            _package = package;
            _executor = new DTEActionExecutor(package);
        }

        public async Task StartAsync(CancellationToken cancellation)
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellation);
            while (!linked.IsCancellationRequested)
            {
                int port = 0;
                try
                {
                    // Resolve the port fresh on every attempt: the agent may
                    // have restarted on a different ephemeral port since the
                    // last loop iteration, and the standalone shell may have
                    // come up while we were retrying.
                    port = await BridgeDiscovery.ResolveBridgePortAsync(linked.Token).ConfigureAwait(false);
                    await ConnectAndReceiveAsync(port, linked.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[TypeAgent] Bridge error (port {port}): {ex.Message}");
                }
                try
                {
                    await Task.Delay(ReconnectDelay, linked.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }

        private async Task ConnectAndReceiveAsync(int port, CancellationToken cancellation)
        {
            var uri = new Uri($"ws://localhost:{port}");
            _ws = new ClientWebSocket();
            await _ws.ConnectAsync(uri, cancellation).ConfigureAwait(false);
            Debug.WriteLine($"[TypeAgent] Bridge connected to {uri}");

            var buffer = new ArraySegment<byte>(new byte[16 * 1024]);
            var assembly = new StringBuilder();

            while (_ws.State == WebSocketState.Open && !cancellation.IsCancellationRequested)
            {
                assembly.Clear();
                WebSocketReceiveResult result;
                do
                {
                    result = await _ws.ReceiveAsync(buffer, cancellation).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, cancellation).ConfigureAwait(false);
                        return;
                    }
                    assembly.Append(Encoding.UTF8.GetString(buffer.Array!, 0, result.Count));
                } while (!result.EndOfMessage);

                _ = HandleRequestAsync(assembly.ToString(), cancellation);
            }
        }

        private async Task HandleRequestAsync(string json, CancellationToken cancellation)
        {
            string id = "";
            try
            {
                var root = JObject.Parse(json);
                id = root.Value<string>("id") ?? "";
                var actionName = root.Value<string>("actionName") ?? "";
                var parameters = root["parameters"] as JObject ?? new JObject();

                var result = await _executor.ExecuteAsync(actionName, parameters, cancellation);
                await SendResponseAsync(id, success: true, result: result, error: null, cancellation);
            }
            catch (Exception ex)
            {
                await SendResponseAsync(id, success: false, result: null, error: ex.Message, cancellation);
            }
        }

        private async Task SendResponseAsync(string id, bool success, object? result, string? error, CancellationToken cancellation)
        {
            var ws = _ws;
            if (ws is null || ws.State != WebSocketState.Open) return;

            var payload = new BridgeResponse
            {
                id = id,
                success = success,
                result = result,
                error = error,
            };
            var json = JsonConvert.SerializeObject(payload, BridgeJson.Settings);
            var bytes = Encoding.UTF8.GetBytes(json);
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, endOfMessage: true, cancellation);
        }

        public void Dispose()
        {
            _cts.Cancel();
            try { _ws?.Dispose(); } catch { }
        }

        private sealed class BridgeResponse
        {
            public string id { get; set; } = "";
            public bool success { get; set; }
            public object? result { get; set; }
            public string? error { get; set; }
        }
    }

    internal static class BridgeJson
    {
        // Preserve property names as authored (already camelCase) and drop nulls.
        public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
        };
    }
}
