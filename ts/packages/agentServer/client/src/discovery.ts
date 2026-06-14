// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Discovery client for the agent-server's read-only port lookup channel.
 *
 * Designed for **external clients** (Coda VS Code extension, Chrome /
 * Edge browser extensions, the C# VS plugin, scaffolded onboarding
 * agents) that need to discover the dynamically-assigned port of an
 * in-process agent before connecting to its WebSocket server.
 *
 * Separate from the top-level `@typeagent/agent-server-client` entry
 * because that pulls in `fs`, `os`, `child_process`, and the full
 * dispatcher RPC surface — none of which an extension-side discovery
 * caller needs. This module imports only:
 *   - agent-rpc framing (the same JSON-RPC over WebSocket the
 *     agentServer's discovery handler speaks),
 *   - isomorphic-ws (browser- and node-compatible WebSocket),
 *   - the small constants/types module
 *     `@typeagent/agent-server-protocol`.
 *
 * Usage:
 *   const port = await discoverPort("code");
 *   if (port === null) throw new Error("code agent isn't running");
 *   const ws = new WebSocket(`ws://localhost:${port}?...`);
 */

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import WebSocket from "isomorphic-ws";
import {
    AGENT_SERVER_DEFAULT_URL,
    DiscoveryChannelName,
    DiscoveryInvokeFunctions,
} from "@typeagent/agent-server-protocol";

export type DiscoverPortOptions = {
    /**
     * Agent-server URL. Defaults to `ws://localhost:8999` — matches
     * `AGENT_SERVER_DEFAULT_URL`. Callers that honor an environment
     * override (e.g. `AGENT_SERVER_URL`) should resolve it themselves
     * and pass the result here.
     */
    url?: string;
    /** Per-attempt timeout in milliseconds. Default 5_000. */
    timeoutMs?: number;
    /**
     * Ask the server to answer with a remote-realm (tunnel) URL when one is
     * configured and live. Set by clients connecting from another device; a
     * local client leaves it unset and keeps getting localhost. See the
     * dev-tunnel discovery design.
     */
    remote?: boolean;
};

/** What `discoverPort` returns. */
export type DiscoverPortResult =
    /**
     * Agent has registered a port for `(agentName, role)`. `url`, when
     * present, is a fully-qualified address (e.g. a `wss://…devtunnels.ms`
     * tunnel URL) to connect to instead of `ws://localhost:<port>`; when
     * absent, build the localhost URL from `port` as before.
     */
    | { kind: "found"; port: number; url?: string }
    /** Discovery channel reached but no live allocation found. */
    | { kind: "not-registered" }
    /** Discovery channel could not be reached (agentServer down, etc). */
    | { kind: "unreachable"; error: Error };

/**
 * Look up the port currently registered for `(agentName, role)` via
 * the agent-server's discovery WS channel.
 *
 * **About `role`:** roles are agent-defined free-form strings — the
 * registrar/discovery layer is intentionally generic and does not know
 * which role names a given agent advertises. Each agent owns its own
 * role namespace and SHOULD export role constants for callers to
 * import (e.g. `code` could export
 * `CODE_ROLES = { default: "default", debug: "debug" } as const`).
 * Omit `role` (or pass undefined) to ask for the agent's default role,
 * which matches what `setLocalHostPort` registered for legacy
 * single-listener agents. We deliberately keep this as a string rather
 * than a central enum so adding a new role on one agent doesn't force
 * a coordinated change across every package, and so this function
 * doesn't have to import every agent that exposes a port.
 *
 * Returns a tagged result rather than throwing so callers can distinguish
 * "agent isn't running yet — retry" from "agentServer isn't running —
 * fall back to a hardcoded default for back-compat" without parsing
 * error messages.
 *
 * Closes the underlying WS after the lookup completes (success or
 * failure) — discovery connections are intentionally short-lived to
 * keep the agentServer's idle-shutdown timer honest.
 */
export async function discoverPort(
    agentName: string,
    role?: string,
    options?: DiscoverPortOptions,
): Promise<DiscoverPortResult> {
    const url = options?.url ?? AGENT_SERVER_DEFAULT_URL;
    const timeoutMs = options?.timeoutMs ?? 5_000;
    return new Promise<DiscoverPortResult>((resolve) => {
        let settled = false;
        const settle = (result: DiscoverPortResult) => {
            if (settled) return;
            settled = true;
            try {
                ws.close();
            } catch {
                // Already closed or never opened.
            }
            clearTimeout(timeoutHandle);
            resolve(result);
        };

        const ws = new WebSocket(url);

        const timeoutHandle = setTimeout(() => {
            settle({
                kind: "unreachable",
                error: new Error(
                    `discoverPort(${agentName}, ${role ?? "default"}) timed out after ${timeoutMs}ms against ${url}`,
                ),
            });
        }, timeoutMs);

        const channel = createChannelProviderAdapter(
            "discovery:client",
            (message: any) => {
                try {
                    ws.send(JSON.stringify(message));
                } catch (e: any) {
                    settle({
                        kind: "unreachable",
                        error: e instanceof Error ? e : new Error(String(e)),
                    });
                }
            },
        );

        ws.onmessage = (event: WebSocket.MessageEvent) => {
            try {
                channel.notifyMessage(JSON.parse(event.data.toString()));
            } catch (e: any) {
                settle({
                    kind: "unreachable",
                    error: e instanceof Error ? e : new Error(String(e)),
                });
            }
        };

        ws.onerror = (event: WebSocket.ErrorEvent) => {
            settle({
                kind: "unreachable",
                error: new Error(
                    `discoverPort WS error against ${url}: ${event.message ?? "unknown"}`,
                ),
            });
        };

        ws.onclose = () => {
            channel.notifyDisconnected();
            // If the socket closes before we settled (rare race with
            // a successful response landing concurrently), treat as
            // unreachable; if already settled, this is a no-op.
            settle({
                kind: "unreachable",
                error: new Error(
                    `discoverPort WS closed before response from ${url}`,
                ),
            });
        };

        ws.onopen = () => {
            const rpc = createRpc<DiscoveryInvokeFunctions>(
                "discovery:client",
                channel.createChannel(DiscoveryChannelName),
            );
            const params: {
                agentName: string;
                role?: string;
                remote?: boolean;
            } = { agentName };
            if (role !== undefined) params.role = role;
            if (options?.remote) params.remote = true;
            rpc.invoke("lookupPort", params).then(
                (result) => {
                    if (result.port === null) {
                        settle({ kind: "not-registered" });
                    } else {
                        settle(
                            result.url === undefined
                                ? { kind: "found", port: result.port }
                                : {
                                      kind: "found",
                                      port: result.port,
                                      url: result.url,
                                  },
                        );
                    }
                },
                (e: unknown) => {
                    settle({
                        kind: "unreachable",
                        error: e instanceof Error ? e : new Error(String(e)),
                    });
                },
            );
        };
    });
}
