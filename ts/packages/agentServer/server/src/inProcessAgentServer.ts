// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import type { ChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import {
    AgentServerConnection,
    createAgentServerConnection,
} from "@typeagent/agent-server-client";
import { UserIdentity } from "@typeagent/agent-server-protocol";
import { DispatcherOptions } from "agent-dispatcher";
import os from "node:os";
import registerDebug from "debug";

import {
    createConversationManager,
    ConversationManager,
} from "./conversationManager.js";
import { createAgentServerConnectionHandler } from "./connectionHandler.js";

const debug = registerDebug("agent-server:in-process");

function defaultUserIdentity(): UserIdentity {
    const username = os.userInfo().username || "user";
    const envName = process.env.TYPEAGENT_USER_NAME?.trim();
    const displayName = envName || username;
    const initial = (displayName[0] ?? "U").toUpperCase();
    return { username, displayName, initial };
}

export type InProcessAgentServerOptions = {
    /**
     * Invoked when the dispatcher requests a shutdown (e.g. via the `@exit`
     * command path that calls clientIO.shutdown()). For the Electron shell
     * this should quit the app.
     */
    shutdown: () => void | Promise<void>;
    /** Returns the resolved user identity; defaults to the OS user. */
    getUserIdentity?: () => UserIdentity;
    /**
     * Idle timeout for conversations in ms. Embedded hosts own the process for
     * a single user, so the default is 0 (never idle-close a conversation).
     */
    idleTimeoutMs?: number;
};

export type InProcessAgentServer = {
    connection: AgentServerConnection;
    conversationManager: ConversationManager;
    close(): Promise<void>;
};

/**
 * Create an agent server that runs entirely in the current process and return
 * an {@link AgentServerConnection} to it over an in-memory loopback channel —
 * no WebSocket, no separate process. This lets a host (e.g. the Electron
 * shell) use the exact same conversation/dispatcher code path as the
 * out-of-process agent server while keeping its own custom clientIO,
 * in-process browser control, and app lifecycle.
 *
 * The connection is wired to the same per-connection handler the WebSocket
 * server uses, so join/leave/create/list conversations, per-conversation
 * clientIO + dispatcher RPC, and display-log replay all behave identically.
 */
export async function createInProcessAgentServer(
    hostName: string,
    dispatcherOptions: DispatcherOptions,
    instanceDir: string,
    options: InProcessAgentServerOptions,
): Promise<InProcessAgentServer> {
    const conversationManager = await createConversationManager(
        hostName,
        dispatcherOptions,
        instanceDir,
        options.idleTimeoutMs ?? 0,
    );

    // Pre-warm so the first join is fast and conversation metadata exists.
    await conversationManager.prewarmMostRecentConversation();

    const handler = createAgentServerConnectionHandler({
        conversationManager,
        shutdown: options.shutdown,
        getUserIdentity: options.getUserIdentity ?? defaultUserIdentity,
        // No discovery RPC here: embedded hosts run their own discovery
        // server so external clients (e.g. the Chrome extension) can find
        // in-process agent ports. (portRegistrar omitted on purpose.)
    });

    // Cross-wire two channel-provider adapters so that messages sent on one
    // side are delivered to the other. This is the in-memory equivalent of a
    // WebSocket: server.send → client.notifyMessage and vice versa.
    let clientAdapter: ChannelProviderAdapter | undefined;
    const serverAdapter: ChannelProviderAdapter = createChannelProviderAdapter(
        "agent-server:inproc:server",
        (message: any) => {
            debug("server → client", message?.name);
            clientAdapter?.notifyMessage(message);
        },
    );
    clientAdapter = createChannelProviderAdapter(
        "agent-server:inproc:client",
        (message: any) => {
            debug("client → server", message?.name);
            serverAdapter.notifyMessage(message);
        },
    );

    let closed = false;
    const closeTransport = () => {
        if (closed) {
            return;
        }
        closed = true;
        serverAdapter.notifyDisconnected();
        clientAdapter!.notifyDisconnected();
    };

    // Drive the server-side per-connection handler with the server adapter.
    handler(serverAdapter, closeTransport);

    // Build the client-side connection over the client adapter.
    const connection = createAgentServerConnection(clientAdapter, () => {
        closeTransport();
    });

    return {
        connection,
        conversationManager,
        async close(): Promise<void> {
            closeTransport();
            await conversationManager.close();
        },
    };
}
