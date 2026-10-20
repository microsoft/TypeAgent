// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;

namespace Microsoft.TypeAgent.VisualStudio.Bridge;

/// <summary>
/// WebSocket client that connects to the visualstudio-agent's bridge.
/// Receives BridgeRequest messages, dispatches them through
/// DTEActionExecutor, and sends BridgeResponse messages back.
///
/// Port discovery:
///   The bridge port is no longer hardcoded. On each connect attempt
///   we ask the agent-server's discovery channel where the
///   `(visualStudio, default)` allocation lives. If discovery is
///   unreachable or the agent isn't yet registered, the reconnect
///   loop simply retries — there is no silent fallback to a
///   well-known port. To pin a specific port (e.g. when running the
///   bridge against a manually-launched agent), set
///   `TYPEAGENT_VS_BRIDGE_PORT`; that bypasses discovery entirely.
///   See <see cref="BridgeDiscovery"/> for the wire protocol and the
///   `AGENT_SERVER_PORT` env-var knob.
///
/// Discovery and every action connection are authenticated with the
/// per-user bridge credential. Explicit port overrides skip discovery
/// only; they still require the mutual handshake and protected frames.
/// </summary>
internal sealed class AgentBridgeClient : IDisposable
{
    private const string BridgePortOverrideEnv = "TYPEAGENT_VS_BRIDGE_PORT";
    private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(3);

    private readonly DTEActionExecutor _executor;
    private readonly CancellationTokenSource _cts = new CancellationTokenSource();
    private readonly string _clientInstanceId = BridgeAuthentication.CreateClientInstanceId();

    public AgentBridgeClient(AsyncPackage package)
    {
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
                BridgeCredential credential = BridgeAuthentication.LoadCredential();
                // Resolve the port fresh on every attempt: the agent may
                // have restarted on a different ephemeral port since the
                // last loop iteration, and the standalone shell may have
                // come up while we were retrying.
                uint? resolved = ResolvePortOverride()
                    ?? await BridgeDiscovery
                        .ResolveBridgePortAsync(credential, linked.Token)
                        .ConfigureAwait(false);
                if (resolved is null)
                {
                    // Discovery succeeded but the agent isn't registered
                    // yet — wait one reconnect cycle and try again.
                    Debug.WriteLine("[TypeAgent] visualStudio agent not yet registered; will retry");
                }
                else
                {
                    port = (int)resolved.Value;
                    await AuthenticatedBridgeConnection.RunAsync(
                        new Uri($"ws://localhost:{port}"),
                        credential,
                        _clientInstanceId,
                        _executor,
                        linked.Token).ConfigureAwait(false);
                }
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

    // Returns an explicit port override from `TYPEAGENT_VS_BRIDGE_PORT`,
    // or null when the env var is unset/malformed (caller falls through
    // to discovery). Mirrors `CODE_WEBSOCKET_HOST` from coda.
    private static uint? ResolvePortOverride()
    {
        string? raw = Environment.GetEnvironmentVariable(BridgePortOverrideEnv);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }
        if (uint.TryParse(raw, out uint p) && p > 0 && p <= 65535)
        {
            Debug.WriteLine($"[TypeAgent] {BridgePortOverrideEnv} override active: {p}");
            return p;
        }
        Debug.WriteLine($"[TypeAgent] Ignoring malformed {BridgePortOverrideEnv}={raw}");
        return null;
    }

    public void Dispose()
    {
        _cts.Cancel();
    }
}
