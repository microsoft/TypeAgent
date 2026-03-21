// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createClientIORpcServer } from "@typeagent/dispatcher-rpc/clientio/server";
import { createDispatcherRpcClient } from "@typeagent/dispatcher-rpc/dispatcher/client";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-rpc/types";
import WebSocket from "isomorphic-ws";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import registerDebug from "debug";
import {
    AgentServerInvokeFunctions,
    ChannelName,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";

const debug = registerDebug("typeagent:agent-server-client");
const debugErr = registerDebug("typeagent:agent-server-client:error");

export async function connectDispatcher(
    clientIO: ClientIO,
    url: string | URL,
    options?: DispatcherConnectOptions,
    onDisconnect?: () => void,
): Promise<Dispatcher> {
    return new Promise((resolve, reject: (e: Error) => void) => {
        const ws = new WebSocket(url);
        const channel = createChannelProviderAdapter(
            "agent-server:client",
            (message: any) => {
                debug("Sending message to server:", message);
                // Server assume data are JSON strings
                ws.send(JSON.stringify(message));
            },
        );

        const rpc = createRpc<AgentServerInvokeFunctions>(
            "agent-server:client",
            channel.createChannel(ChannelName.AgentServer),
        );

        let resolved = false;
        createClientIORpcServer(
            clientIO,
            channel.createChannel(ChannelName.ClientIO),
        );
        ws.onopen = () => {
            debug("WebSocket connection established", ws.readyState);
            rpc.invoke("join", options)
                .then((connectionId) => {
                    debug("Connected to dispatcher");
                    resolved = true;
                    const dispatcher = createDispatcherRpcClient(
                        channel.createChannel(ChannelName.Dispatcher),
                        connectionId,
                    );
                    // Override the close method to close the WebSocket connection
                    dispatcher.close = async () => {
                        debug("Closing WebSocket connection");
                        ws.close();
                    };
                    resolve(dispatcher);
                })
                .catch((err: any) => {
                    debugErr("Failed to join dispatcher:", err);
                    reject(err);
                });
        };
        ws.onmessage = (event: WebSocket.MessageEvent) => {
            debug("Received message from server:", event.data);

            channel.notifyMessage(JSON.parse(event.data.toString()));
        };
        ws.onclose = (event: WebSocket.CloseEvent) => {
            debug("WebSocket connection closed", event.code, event.reason);
            channel.notifyDisconnected();
            if (resolved) {
                onDisconnect?.();
            } else {
                reject(new Error(`Failed to connect to dispatcher at ${url}`));
            }
        };
        ws.onerror = (error: WebSocket.ErrorEvent) => {
            debugErr("WebSocket error:", error);
        };
    });
}

function getAgentServerEntryPoint(): string {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    // From client/dist/ -> server/dist/server.js
    const serverPath = path.resolve(thisDir, "../../server/dist/server.js");
    if (!fs.existsSync(serverPath)) {
        throw new Error(
            `Agent server entry point not found at ${serverPath}. ` +
                `The expected relative path from the client package may have changed. ` +
                `Ensure the agent-server package is built.`,
        );
    }
    return serverPath;
}

function isServerRunning(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
            ws.close();
            resolve(false);
        }, 2000);
        ws.onopen = () => {
            clearTimeout(timer);
            ws.close();
            resolve(true);
        };
        ws.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };
    });
}

function spawnAgentServer(serverPath: string): void {
    debug(`Starting agent server from ${serverPath}`);
    const isWindows = process.platform === "win32";
    const child = spawn("node", [serverPath], {
        // On Unix, detached creates a new session so the child survives parent exit.
        // On Windows, detached creates a visible console window, so we skip it —
        // stdio: 'ignore' + unref() is sufficient for the child to outlive the parent.
        detached: !isWindows,
        stdio: "ignore",
        windowsHide: true,
    });
    child.unref();
    debug(`Agent server process spawned (pid: ${child.pid})`);
}

async function waitForServer(
    url: string,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 500,
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isServerRunning(url)) {
            return;
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(
        `Agent server did not become available at ${url} within ${timeoutMs}ms`,
    );
}

export async function ensureAndConnectDispatcher(
    clientIO: ClientIO,
    port: number = 8999,
    options?: DispatcherConnectOptions,
    onDisconnect?: () => void,
): Promise<Dispatcher> {
    const url = `ws://localhost:${port}`;
    if (!(await isServerRunning(url))) {
        const serverPath = getAgentServerEntryPoint();
        spawnAgentServer(serverPath);
        await waitForServer(url);
    }
    return connectDispatcher(clientIO, url, options, onDisconnect);
}

export async function stopAgentServer(port: number = 8999): Promise<void> {
    const url = `ws://localhost:${port}`;
    if (!(await isServerRunning(url))) {
        console.log("Agent server is not running.");
        return;
    }

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const channel = createChannelProviderAdapter(
            "agent-server:stop",
            (message: any) => {
                ws.send(JSON.stringify(message));
            },
        );
        const rpc = createRpc<AgentServerInvokeFunctions>(
            "agent-server:stop",
            channel.createChannel(ChannelName.AgentServer),
        );

        ws.onopen = () => {
            rpc.invoke("shutdown")
                .then(() => {
                    debug("Shutdown request sent");
                    resolve();
                })
                .catch((err: any) => {
                    debugErr("Failed to send shutdown:", err);
                    reject(err);
                });
        };
        ws.onmessage = (event: WebSocket.MessageEvent) => {
            channel.notifyMessage(JSON.parse(event.data.toString()));
        };
        ws.onclose = () => {
            resolve();
        };
        ws.onerror = (error: WebSocket.ErrorEvent) => {
            debugErr("WebSocket error during shutdown:", error);
            reject(new Error(`Failed to connect to agent server at ${url}`));
        };
    });
}
