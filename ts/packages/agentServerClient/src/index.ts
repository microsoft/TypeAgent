// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createClientIORpcServer } from "@typeagent/dispatcher-rpc/clientio/server";
import { createDispatcherRpcClient } from "@typeagent/dispatcher-rpc/dispatcher/client";
import { ClientIO, Dispatcher } from "agent-dispatcher";

import registerDebug from "debug";
const debug = registerDebug("typeagent:agent-server-client");
const debugErr = registerDebug("typeagent:agent-server-client:error");

type AgentServerInvokeFunctions = {
    join: () => Promise<void>;
};
export async function connectDispatcher(
    clientIO: ClientIO,
    url: string | URL,
): Promise<Dispatcher> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url); // Replace with the actual WebSocket server URL
        const channel = createChannelProviderAdapter((message: any) => {
            debug("Sending message to server:", message);
            // Server assume data are JSON strings
            ws.send(JSON.stringify(message));
        });

        const rpc = createRpc<AgentServerInvokeFunctions>(
            "agent-server-client",
            channel.createChannel("agent-server"),
        );

        let resolved = false;
        createClientIORpcServer(clientIO, channel.createChannel("clientio"));
        ws.onopen = () => {
            debug("WebSocket connection established", ws.readyState);
            rpc.invoke("join")
                .then(() => {
                    debug("Connected to dispatcher");
                    resolved = true;
                    const dispatcher = createDispatcherRpcClient(
                        channel.createChannel("dispatcher"),
                    );
                    resolve(dispatcher);
                })
                .catch((err) => {
                    debugErr("Failed to join dispatcher:", err);
                    reject(err);
                });
        };
        ws.onmessage = (event) => {
            debug("Received message from server:", event.data);
            channel.notifyMessage(JSON.parse(event.data));
        };
        ws.onclose = (event) => {
            debug("WebSocket connection closed", event.code, event.reason);
            channel.notifyDisconnected();
            if (!resolved) {
                reject(new Error("WebSocket connection closed"));
            }
        };
        ws.onerror = (error) => {
            debugErr("WebSocket error:", error);
            reject(error);
        };
    });
}
