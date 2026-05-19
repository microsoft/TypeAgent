// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Microsoft.TypeAgent.VisualStudio.Bridge
{
    /// <summary>
    /// Looks up the visualStudio agent's bridge port via the dispatcher's
    /// discovery channel.
    ///
    /// Wire protocol (matches packages/agentServer/protocol/src/protocol.ts):
    ///   client → server:
    ///     { "name": "discovery",
    ///       "message": { "type": "invoke", "callId": N, "name": "lookupPort",
    ///                    "args": [{ "agentName": "visualStudio",
    ///                               "role": "default" }] } }
    ///   server → client:
    ///     { "name": "discovery",
    ///       "message": { "type": "invokeResult", "callId": N,
    ///                    "result": { "port": &lt;int|null&gt; } } }
    ///
    /// Returns the port on success, or null when the agent isn't currently
    /// registered (caller should retry with backoff). Throws on transport
    /// failure so the outer reconnect loop can apply its own retry policy.
    /// </summary>
    internal static class BridgeDiscovery
    {
        // Env var read on every resolve so users can flip behavior without
        // restarting the IDE between debugging sessions.
        private const string AgentServerPortEnv = "AGENT_SERVER_PORT";
        private const string UseDiscoveryEnv = "TYPEAGENT_VS_USE_DISCOVERY";
        private const string FallbackPortEnv = "TYPEAGENT_VS_FALLBACK_PORT";

        // Must match AGENT_SERVER_DEFAULT_PORT in agentServer/protocol.
        private const int DefaultAgentServerPort = 8999;

        // Hardcoded fallback when discovery is disabled or fails before the
        // agent has registered. Matches the pre-discovery hardcoded port —
        // ports 5678 + 5679 are taken by the Excel agent.
        private const int DefaultFallbackBridgePort = 5680;

        // Names this client uses to look itself up. Must match the role
        // registered by visualStudioActionHandler.ts.
        private const string AgentName = "visualStudio";
        private const string Role = "default";

        /// <summary>
        /// Resolve the bridge port. Returns the discovered port, or the
        /// fallback when discovery is disabled / unreachable / returned
        /// null. Never throws — callers expect a usable port.
        /// </summary>
        public static async Task<int> ResolveBridgePortAsync(CancellationToken cancellation)
        {
            int fallback = GetFallbackPort();
            if (!IsDiscoveryEnabled())
            {
                Debug.WriteLine($"[TypeAgent] Discovery disabled; using fallback port {fallback}");
                return fallback;
            }
            int agentServerPort = GetAgentServerPort();
            try
            {
                int? discovered = await LookupPortAsync(agentServerPort, cancellation).ConfigureAwait(false);
                if (discovered is int p)
                {
                    Debug.WriteLine($"[TypeAgent] Discovery resolved bridge port {p}");
                    return p;
                }
                Debug.WriteLine($"[TypeAgent] Discovery returned null for ({AgentName}, {Role}); using fallback {fallback}");
                return fallback;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[TypeAgent] Discovery failed ({ex.Message}); using fallback port {fallback}");
                return fallback;
            }
        }

        private static bool IsDiscoveryEnabled()
        {
            // Discovery is on by default; explicit "false"/"0" disables.
            string? raw = Environment.GetEnvironmentVariable(UseDiscoveryEnv);
            if (string.IsNullOrEmpty(raw)) return true;
            return !(raw!.Equals("false", StringComparison.OrdinalIgnoreCase) || raw == "0");
        }

        private static int GetAgentServerPort()
        {
            string? raw = Environment.GetEnvironmentVariable(AgentServerPortEnv);
            if (int.TryParse(raw, out int p) && p > 0 && p <= 65535)
            {
                return p;
            }
            return DefaultAgentServerPort;
        }

        private static int GetFallbackPort()
        {
            string? raw = Environment.GetEnvironmentVariable(FallbackPortEnv);
            if (int.TryParse(raw, out int p) && p > 0 && p <= 65535)
            {
                return p;
            }
            return DefaultFallbackBridgePort;
        }

        private static async Task<int?> LookupPortAsync(int agentServerPort, CancellationToken cancellation)
        {
            var uri = new Uri($"ws://localhost:{agentServerPort}/");
            using var ws = new ClientWebSocket();
            // Cap the discovery call so a hung agent-server doesn't stall
            // the whole reconnect loop. The outer AgentBridgeClient loop
            // already retries on a separate cadence.
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellation, timeout.Token);

            await ws.ConnectAsync(uri, linked.Token).ConfigureAwait(false);

            // callId is arbitrary — the server echoes it back verbatim,
            // and we only have one outstanding request per socket.
            const int callId = 1;
            var request = new JObject
            {
                ["name"] = "discovery",
                ["message"] = new JObject
                {
                    ["type"] = "invoke",
                    ["callId"] = callId,
                    ["name"] = "lookupPort",
                    ["args"] = new JArray
                    {
                        new JObject
                        {
                            ["agentName"] = AgentName,
                            ["role"] = Role,
                        },
                    },
                },
            };
            byte[] requestBytes = Encoding.UTF8.GetBytes(request.ToString(Formatting.None));
            await ws.SendAsync(
                new ArraySegment<byte>(requestBytes),
                WebSocketMessageType.Text,
                endOfMessage: true,
                linked.Token).ConfigureAwait(false);

            string responseText = await ReceiveFullMessageAsync(ws, linked.Token).ConfigureAwait(false);
            try
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None).ConfigureAwait(false);
            }
            catch
            {
                // Best-effort close — the response is already in hand.
            }

            var root = JObject.Parse(responseText);
            string? name = root.Value<string>("name");
            if (name != "discovery") return null;
            var inner = root["message"] as JObject;
            if (inner == null) return null;
            string? type = inner.Value<string>("type");
            if (type == "invokeError")
            {
                throw new InvalidOperationException(
                    inner.Value<string>("error") ?? "Discovery returned invokeError");
            }
            if (type != "invokeResult") return null;
            if (inner.Value<int?>("callId") != callId) return null;
            var result = inner["result"] as JObject;
            if (result == null) return null;
            // `port` is `int|null`; JObject returns null cleanly for both.
            return result.Value<int?>("port");
        }

        private static async Task<string> ReceiveFullMessageAsync(ClientWebSocket ws, CancellationToken cancellation)
        {
            var buffer = new ArraySegment<byte>(new byte[16 * 1024]);
            var sb = new StringBuilder();
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(buffer, cancellation).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    throw new InvalidOperationException("Discovery WS closed before response");
                }
                sb.Append(Encoding.UTF8.GetString(buffer.Array!, 0, result.Count));
            } while (!result.EndOfMessage);
            return sb.ToString();
        }
    }
}
