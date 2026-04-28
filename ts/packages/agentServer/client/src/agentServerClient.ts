// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import type { ChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createClientIORpcServer } from "@typeagent/dispatcher-rpc/clientio/server";
import { createDispatcherRpcClient } from "@typeagent/dispatcher-rpc/dispatcher/client";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-rpc/types";
import WebSocket from "isomorphic-ws";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import registerDebug from "debug";
import {
    AgentServerInvokeFunctions,
    AgentServerChannelName,
    DispatcherConnectOptions,
    ConversationInfo,
    JoinConversationResult,
    getDispatcherChannelName,
    getClientIOChannelName,
} from "@typeagent/agent-server-protocol";

const debug = registerDebug("typeagent:agent-server-client");
const debugErr = registerDebug("typeagent:agent-server-client:error");

function getServerPidPath(port: number): string {
    return path.join(os.homedir(), ".typeagent", `server-${port}.pid`);
}

export function writeServerPid(port: number, pid: number): void {
    const pidPath = getServerPidPath(port);
    const dir = path.dirname(pidPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(pidPath, String(pid));
}

export function removeServerPid(port: number): void {
    try {
        fs.unlinkSync(getServerPidPath(port));
    } catch {
        // Already gone
    }
}

function readServerPid(port: number): number | undefined {
    try {
        const content = fs.readFileSync(getServerPidPath(port), "utf-8").trim();
        const pid = parseInt(content, 10);
        return isNaN(pid) ? undefined : pid;
    } catch {
        return undefined;
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0); // signal 0 = existence check
        return true;
    } catch {
        return false;
    }
}

function forceKillServer(port: number): boolean {
    const pid = readServerPid(port);
    if (pid === undefined || !isProcessAlive(pid)) {
        removeServerPid(port);
        return false;
    }
    try {
        process.kill(pid, "SIGKILL");
    } catch {
        // Already dead
    }
    removeServerPid(port);
    return true;
}

export type ConversationDispatcher = {
    dispatcher: Dispatcher;
    conversationId: string;
    name: string;
};

export type AgentServerConnection = {
    joinConversation(
        clientIO: ClientIO,
        options?: DispatcherConnectOptions,
    ): Promise<ConversationDispatcher>;
    leaveConversation(conversationId: string): Promise<void>;
    createConversation(name: string): Promise<ConversationInfo>;
    listConversations(name?: string): Promise<ConversationInfo[]>;
    renameConversation(conversationId: string, newName: string): Promise<void>;
    deleteConversation(conversationId: string): Promise<void>;
    shutdown(): Promise<void>;
    close(): Promise<void>;
};

/**
 * Connect to an agent server and return a connection object that supports
 * multiple conversations over a single WebSocket.
 */
export async function connectAgentServer(
    url: string | URL,
    onDisconnect?: () => void,
): Promise<AgentServerConnection> {
    return new Promise((resolve, reject: (e: Error) => void) => {
        const ws = new WebSocket(url);
        const channel: ChannelProviderAdapter = createChannelProviderAdapter(
            "agent-server:client",
            (message: any) => {
                debug("Sending message to server:", message);
                ws.send(JSON.stringify(message));
            },
        );

        const rpc = createRpc<AgentServerInvokeFunctions>(
            "agent-server:client",
            channel.createChannel(AgentServerChannelName),
        );

        // Track joined conversations for cleanup on close
        const joinedConversations = new Map<
            string,
            { dispatcher: Dispatcher; connectionId: string }
        >();

        let opened = false;
        let resolved = false;
        let closed = false;

        const connection: AgentServerConnection = {
            async joinConversation(
                clientIO: ClientIO,
                options?: DispatcherConnectOptions,
            ): Promise<ConversationDispatcher> {
                const requestedConversationId = options?.conversationId;
                if (
                    requestedConversationId !== undefined &&
                    joinedConversations.has(requestedConversationId)
                ) {
                    throw new Error(
                        `Already joined conversation '${requestedConversationId}'. Call leaveConversation() before joining again.`,
                    );
                }

                const result: JoinConversationResult = await rpc.invoke(
                    "joinConversation",
                    options,
                );

                const conversationId = result.conversationId;

                // Create conversation-namespaced channels
                createClientIORpcServer(
                    clientIO,
                    channel.createChannel(
                        getClientIOChannelName(conversationId),
                    ),
                );

                const dispatcher = createDispatcherRpcClient(
                    channel.createChannel(
                        getDispatcherChannelName(conversationId),
                    ),
                    result.connectionId,
                );

                // Override close to leave the conversation rather than close the WebSocket
                dispatcher.close = async () => {
                    await connection.leaveConversation(conversationId);
                };

                joinedConversations.set(conversationId, {
                    dispatcher,
                    connectionId: result.connectionId,
                });

                return {
                    dispatcher,
                    conversationId,
                    name: result.name,
                };
            },

            async leaveConversation(conversationId: string): Promise<void> {
                const entry = joinedConversations.get(conversationId);
                if (entry === undefined) {
                    return;
                }
                joinedConversations.delete(conversationId);
                channel.deleteChannel(getDispatcherChannelName(conversationId));
                channel.deleteChannel(getClientIOChannelName(conversationId));
                await rpc.invoke("leaveConversation", conversationId);
            },

            async createConversation(name: string): Promise<ConversationInfo> {
                return rpc.invoke("createConversation", name);
            },

            async listConversations(
                name?: string,
            ): Promise<ConversationInfo[]> {
                return rpc.invoke("listConversations", name);
            },

            async renameConversation(
                conversationId: string,
                newName: string,
            ): Promise<void> {
                return rpc.invoke(
                    "renameConversation",
                    conversationId,
                    newName,
                );
            },

            async deleteConversation(conversationId: string): Promise<void> {
                // Clean up local channels if we're in this conversation
                const entry = joinedConversations.get(conversationId);
                if (entry !== undefined) {
                    joinedConversations.delete(conversationId);
                    channel.deleteChannel(
                        getDispatcherChannelName(conversationId),
                    );
                    channel.deleteChannel(
                        getClientIOChannelName(conversationId),
                    );
                }
                return rpc.invoke("deleteConversation", conversationId);
            },

            async shutdown(): Promise<void> {
                debug("Requesting server shutdown via existing connection");
                await rpc.invoke("shutdown");
            },

            async close(): Promise<void> {
                if (closed) {
                    return;
                }
                closed = true;
                debug("Closing agent server connection");
                ws.close();
            },
        };

        ws.onopen = () => {
            debug("WebSocket connection established", ws.readyState);
            opened = true;
            resolved = true;
            resolve(connection);
        };
        ws.onmessage = (event: WebSocket.MessageEvent) => {
            debug("Received message from server:", event.data);
            channel.notifyMessage(JSON.parse(event.data.toString()));
        };
        ws.onclose = (event: WebSocket.CloseEvent) => {
            debug("WebSocket connection closed", event.code, event.reason);
            channel.notifyDisconnected();
            joinedConversations.clear();
            if (!opened) {
                // Closed before onopen fired — reject the pending promise.
                if (!resolved) {
                    resolved = true;
                    reject(
                        new Error(
                            `Failed to connect to agent server at ${url}`,
                        ),
                    );
                }
                return;
            }
            if (!closed) {
                closed = true;
                onDisconnect?.();
            }
        };
        ws.onerror = (error: WebSocket.ErrorEvent) => {
            debugErr("WebSocket error:", error);
            if (!opened && !resolved) {
                resolved = true;
                reject(
                    new Error(`Failed to connect to agent server at ${url}`),
                );
            }
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

export function isServerRunning(url: string): Promise<boolean> {
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

function spawnAgentServer(
    serverPath: string,
    port: number,
    hidden: boolean = false,
    idleTimeout: number = 0,
): void {
    // Use an exclusive lock file to prevent two concurrent client processes from
    // both concluding the server is down and each spawning their own copy.
    // fs.openSync with 'wx' is atomic: exactly one caller creates the file.
    const lockFile = path.join(
        os.tmpdir(),
        `typeagent-server-${port}.spawn.lock`,
    );
    let fd: number;
    try {
        fd = fs.openSync(lockFile, "wx");
    } catch {
        // Another process is already spawning the server — just wait for it.
        debug(
            `Agent server spawn lock held by another process, skipping spawn`,
        );
        return;
    }

    const extraArgs =
        idleTimeout > 0 ? ["--idle-timeout", String(idleTimeout)] : [];

    try {
        debug(`Starting agent server from ${serverPath}`);
        const isWindows = process.platform === "win32";
        if (isWindows) {
            if (hidden) {
                // On Windows, detached: true creates a new console window
                // for the child and any processes it spawns. To avoid this,
                // spawn via cmd /c start /B which runs the process truly in
                // the background with no visible windows.
                const args = [serverPath, "--port", String(port), ...extraArgs];
                const child = spawn(
                    "cmd.exe",
                    ["/c", "start", "/B", "node", ...args],
                    {
                        stdio: "ignore",
                        windowsHide: true,
                    },
                );
                child.unref();
                debug(
                    `Agent server process spawned hidden (pid: ${child.pid})`,
                );
            } else {
                const pwsh7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
                const psExe = fs.existsSync(pwsh7) ? pwsh7 : "powershell.exe";
                const psCommand = `node "${serverPath}" --port ${port}${idleTimeout > 0 ? ` --idle-timeout ${idleTimeout}` : ""}`;
                const psArgs = ["-NoExit", "-Command", psCommand];
                const child = spawn(
                    "cmd.exe",
                    ["/c", "start", "", psExe, ...psArgs],
                    {
                        detached: true,
                        stdio: "ignore",
                    },
                );
                child.unref();
                debug(
                    `Agent server process spawned via ${psExe} in new window (pid: ${child.pid})`,
                );
            }
        } else {
            const child = spawn(
                "node",
                [serverPath, "--port", String(port), ...extraArgs],
                {
                    detached: true,
                    stdio: "ignore",
                },
            );
            child.unref();
            debug(`Agent server process spawned (pid: ${child.pid})`);
        }
    } finally {
        fs.closeSync(fd);
        try {
            fs.unlinkSync(lockFile);
        } catch {
            // Best effort — lock file cleanup
        }
    }
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

export async function ensureAgentServer(
    port: number = 8999,
    hidden: boolean = false,
    idleTimeout: number = 0,
): Promise<void> {
    const url = `ws://localhost:${port}`;
    if (await isServerRunning(url)) {
        console.log(
            `Connecting to existing TypeAgent server on port ${port}...`,
        );
    } else {
        if (hidden) {
            console.log("Starting TypeAgent server in the background...");
        } else {
            console.log("Starting TypeAgent server in a new window...");
        }
        const serverPath = getAgentServerEntryPoint();
        spawnAgentServer(serverPath, port, hidden, idleTimeout);
        await waitForServer(url);
        console.log("TypeAgent server started.");
    }
}

export async function ensureAndConnectDispatcher(
    clientIO: ClientIO,
    port: number = 8999,
    options?: DispatcherConnectOptions,
    onDisconnect?: () => void,
    hidden: boolean = false,
): Promise<Dispatcher> {
    await ensureAgentServer(port, hidden);
    const url = `ws://localhost:${port}`;
    return connectDispatcher(clientIO, url, options, onDisconnect);
}

export async function ensureAndConnectConversation(
    clientIO: ClientIO,
    port: number = 8999,
    options?: DispatcherConnectOptions,
    onDisconnect?: () => void,
    hidden: boolean = false,
    idleTimeout: number = 0,
): Promise<ConversationDispatcher> {
    await ensureAgentServer(port, hidden, idleTimeout);
    const url = `ws://localhost:${port}`;
    const connection = await connectAgentServer(url, onDisconnect);
    const conversation = await connection.joinConversation(clientIO, options);
    conversation.dispatcher.close = async () => {
        await connection.close();
    };
    return conversation;
}

export async function stopAgentServer(
    port: number = 8999,
    force: boolean = false,
): Promise<void> {
    const url = `ws://localhost:${port}`;

    // Try graceful shutdown first
    const gracefulShutdown = (): Promise<void> => {
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
                channel.createChannel(AgentServerChannelName),
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
                reject(
                    new Error(`Failed to connect to agent server at ${url}`),
                );
            };
        });
    };

    if (!force) {
        if (!(await isServerRunning(url))) {
            console.log("Agent server is not running.");
            return;
        }
        return gracefulShutdown();
    }

    // Force mode: try graceful with a timeout, then force-kill
    try {
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error("Graceful shutdown timed out")),
                5000,
            ),
        );
        await Promise.race([gracefulShutdown(), timeout]);
        return;
    } catch {
        // Graceful failed — force kill
        debug("Graceful shutdown failed, attempting force kill");
        if (forceKillServer(port)) {
            console.log("Agent server force-stopped via PID file.");
        } else {
            console.log("Agent server is not running (no live process found).");
        }
    }
}

/**
 * Convenience wrapper: connect to an agent server and immediately join a
 * conversation. Returns a single Dispatcher (backward compatible with old API).
 *
 * @deprecated Use `connectAgentServer()` for full multi-conversation support.
 */
export async function connectDispatcher(
    clientIO: ClientIO,
    url: string | URL,
    options?: DispatcherConnectOptions,
    onDisconnect?: () => void,
): Promise<Dispatcher> {
    const connection = await connectAgentServer(url, onDisconnect);
    const { dispatcher } = await connection.joinConversation(clientIO, options);
    // Override close to also close the WebSocket (old behavior)
    dispatcher.close = async () => {
        await connection.close();
    };
    return dispatcher;
}
