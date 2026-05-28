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
    /// Returns the discovered port, or null when the agent isn't yet
    /// registered with the agent-server (transient — caller should retry).
    /// Throws on transport failure so the outer reconnect loop can apply
    /// its own retry/backoff. There is intentionally no hardcoded fallback
    /// port — the migrated TS clients (browser, code, coda) all return
    /// "undefined" on discovery failure and rely on the reconnect loop;
    /// dialing a stale well-known port would just connect to nothing.
    /// </summary>
    internal static class BridgeDiscovery
    {
        // Read on every resolve so users can flip behavior without
        // restarting the IDE between debugging sessions.
        private const string AgentServerPortEnv = "AGENT_SERVER_PORT";

        // Must match AGENT_SERVER_DEFAULT_PORT in agentServer/protocol.
        private const uint DefaultAgentServerPort = 8999;

        // Names this client uses to look itself up. Must match the role
        // registered by visualStudioActionHandler.ts.
        private const string AgentName = "visualStudio";
        private const string Role = "default";

        // The dispatcher's discovery channel always lives on the loopback
        // agent-server. Keep this as a const so the URL only appears in
        // one place; if/when the host becomes configurable, change here.
        private const string AgentServerHost = "ws://localhost";

        // Sanity cap on the discovery response payload. The protocol only
        // ever returns a tiny JSON envelope (~100 bytes); anything larger
        // is treated as a malformed/unexpected response.
        private const int MaxDiscoveryResponseBytes = 64 * 1024;

        /// <summary>
        /// Resolve the bridge port via discovery. Returns the discovered
        /// port, or null when the agent has not yet registered (transient
        /// — caller should retry on its reconnect loop).
        /// Throws on transport failure (agent-server unreachable, timeout,
        /// malformed response) so the caller can log and retry.
        /// </summary>
        public static async Task<uint?> ResolveBridgePortAsync(CancellationToken cancellation)
        {
            uint agentServerPort = GetAgentServerPort();
            uint? discovered = await LookupPortAsync(agentServerPort, cancellation).ConfigureAwait(false);
            if (discovered is uint p)
            {
                Debug.WriteLine($"[TypeAgent] Discovery resolved bridge port {p}");
            }
            else
            {
                Debug.WriteLine($"[TypeAgent] Discovery returned null for ({AgentName}, {Role}); agent not yet registered");
            }
            return discovered;
        }

        private static uint GetAgentServerPort()
        {
            string? raw = Environment.GetEnvironmentVariable(AgentServerPortEnv);
            if (uint.TryParse(raw, out uint p) && p > 0 && p <= 65535)
            {
                return p;
            }
            return DefaultAgentServerPort;
        }

        private static async Task<uint?> LookupPortAsync(uint agentServerPort, CancellationToken cancellation)
        {
            var uri = new Uri($"{AgentServerHost}:{agentServerPort}/");
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
            if (name != "discovery")
            {
                return null;
            }
            var inner = root["message"] as JObject;
            if (inner == null)
            {
                return null;
            }
            string? type = inner.Value<string>("type");
            if (type == "invokeError")
            {
                throw new InvalidOperationException(
                    inner.Value<string>("error") ?? "Discovery returned invokeError");
            }
            if (type != "invokeResult")
            {
                return null;
            }
            if (inner.Value<int?>("callId") != callId)
            {
                return null;
            }
            var result = inner["result"] as JObject;
            if (result == null)
            {
                return null;
            }
            // `port` is `int|null` on the wire; clamp to the valid port
            // range and surface anything else as "not registered".
            int? portValue = result.Value<int?>("port");
            if (portValue is int pv && pv > 0 && pv <= 65535)
            {
                return (uint)pv;
            }
            return null;
        }

        private static async Task<string> ReceiveFullMessageAsync(ClientWebSocket ws, CancellationToken cancellation)
        {
            // 16KB receive chunk; we loop until EndOfMessage so this is a
            // chunk size, not a hard message cap. The MaxDiscoveryResponseBytes
            // guard below bounds the total payload to protect against a
            // misbehaving peer streaming garbage.
            var buffer = new ArraySegment<byte>(new byte[16 * 1024]);
            var sb = new StringBuilder();
            WebSocketReceiveResult result;
            int totalBytes = 0;
            do
            {
                result = await ws.ReceiveAsync(buffer, cancellation).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    throw new InvalidOperationException("Discovery WS closed before response");
                }
                totalBytes += result.Count;
                if (totalBytes > MaxDiscoveryResponseBytes)
                {
                    throw new InvalidOperationException(
                        $"Discovery response exceeded {MaxDiscoveryResponseBytes} bytes; aborting");
                }
                sb.Append(Encoding.UTF8.GetString(buffer.Array!, 0, result.Count));
            } while (!result.EndOfMessage);
            return sb.ToString();
        }
    }
}
