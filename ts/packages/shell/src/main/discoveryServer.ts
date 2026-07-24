// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocketChannelServer } from "@typeagent/websocket-channel-server";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    AGENT_SERVER_DISCOVERY_NAME,
    DiscoveryChannelName,
    createDiscoveryHandlers,
} from "@typeagent/agent-server-protocol";
import {
    type IPortRegistrar,
    SYSTEM_SESSION_CONTEXT_ID,
} from "agent-dispatcher";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:discovery");
const debugError = registerDebug("typeagent:shell:discovery:error");

export type StandaloneDiscoveryServer = {
    /** Port the WS is bound on (always === requested port; bind is exact). */
    port: number;
    /** Stop the server. Idempotent. */
    close: () => void;
};

/**
 * Stand up a tiny WebSocket server in the standalone Electron shell that
 * exposes the same `discovery` channel as the agent-server process. This
 * lets the Chrome extension (and any other external client) call
 * `discoverPort(...)` against the shell exactly the way it would against
 * a real agent-server, so the in-process browser agent's dynamically
 * assigned port can be located without hardcoding.
 *
 * The handler logic is shared with `agentServer/server/server.ts` via
 * `createDiscoveryHandlers` so both hosts speak the same protocol.
 *
 * Bind is exact: if the port is already taken (real agent-server
 * running, another shell instance, etc.) the bind throws EADDRINUSE
 * which surfaces to the caller. Failing loudly is intentional — silent
 * fallback to a random port would break the extension's default
 * `agentServerHost` setting and the user wouldn't know why discovery
 * stopped working.
 */
export async function startStandaloneDiscoveryServer(
    port: number,
    portRegistrar: IPortRegistrar,
): Promise<StandaloneDiscoveryServer> {
    const wss = await createWebSocketChannelServer(
        { port },
        (channelProvider) => {
            createRpc(
                "shell:discovery",
                channelProvider.createChannel(DiscoveryChannelName),
                createDiscoveryHandlers((agentName, role) =>
                    portRegistrar.lookup(agentName, role),
                ),
            );
        },
    );

    // Mirror agent-server: register self under the well-known name so a
    // client that bootstrapped from a different known port can still
    // resolve back to this one. Use SYSTEM_SESSION_CONTEXT_ID so the
    // entry survives real-session releases for the lifetime of the
    // process.
    try {
        portRegistrar.register(
            AGENT_SERVER_DISCOVERY_NAME,
            "default",
            port,
            SYSTEM_SESSION_CONTEXT_ID,
        );
    } catch (e) {
        // Self-registration failure is non-fatal for discovery itself
        // (lookups for other agents still work) but indicates a
        // conflicting allocation, so log it.
        debugError("self-registration failed: %s", (e as Error).message);
    }

    debug("standalone discovery server listening on ws://localhost:%d", port);

    return {
        port,
        close: () => {
            try {
                wss.close();
            } catch (e) {
                debugError("close failed: %s", (e as Error).message);
            }
        },
    };
}
