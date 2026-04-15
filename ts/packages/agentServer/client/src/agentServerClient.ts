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
    SessionInfo,
    JoinSessionResult,
    getDispatcherChannelName,
    getClientIOChannelName,
} from "@typeagent/agent-server-protocol";

const debug = registerDebug("typeagent:agent-server-client");
const debugErr = registerDebug("typeagent:agent-server-client:error");

export type SessionDispatcher = {
    dispatcher: Dispatcher;
    sessionId: string;
    name: string;
};

export type AgentServerConnection = {
    joinSession(
        clientIO: ClientIO,
        options?: DispatcherConnectOptions,
    ): Promise<SessionDispatcher>;
    leaveSession(sessionId: string): Promise<void>;
    createSession(name: string): Promise<SessionInfo>;
    listSessions(name?: string): Promise<SessionInfo[]>;
    renameSession(sessionId: string, newName: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    close(): Promise<void>;
};

/**
 * Connect to an agent server and return a connection object that supports
 * multiple sessions over a single WebSocket.
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

        // Track joined sessions for cleanup on close
        const joinedSessions = new Map<
            string,
            { dispatcher: Dispatcher; connectionId: string }
        >();

        let opened = false;
        let resolved = false;
        let closed = false;

        const connection: AgentServerConnection = {
            async joinSession(
                clientIO: ClientIO,
                options?: DispatcherConnectOptions,
            ): Promise<SessionDispatcher> {
                const requestedSessionId = options?.sessionId;
                if (
                    requestedSessionId !== undefined &&
                    joinedSessions.has(requestedSessionId)
                ) {
                    throw new Error(
                        `Already joined session '${requestedSessionId}'. Call leaveSession() before joining again.`,
                    );
                }

                const result: JoinSessionResult = await rpc.invoke(
                    "joinSession",
                    options,
                );

                const sessionId = result.sessionId;

                // Create session-namespaced channels
                createClientIORpcServer(
                    clientIO,
                    channel.createChannel(getClientIOChannelName(sessionId)),
                );

                const dispatcher = createDispatcherRpcClient(
                    channel.createChannel(getDispatcherChannelName(sessionId)),
                    result.connectionId,
                );

                // Override close to leave the session rather than close the WebSocket
                dispatcher.close = async () => {
                    await connection.leaveSession(sessionId);
                };

                joinedSessions.set(sessionId, {
                    dispatcher,
                    connectionId: result.connectionId,
                });

                return {
                    dispatcher,
                    sessionId,
                    name: result.name,
                };
            },

            async leaveSession(sessionId: string): Promise<void> {
                const entry = joinedSessions.get(sessionId);
                if (entry === undefined) {
                    return;
                }
                joinedSessions.delete(sessionId);
                channel.deleteChannel(getDispatcherChannelName(sessionId));
                channel.deleteChannel(getClientIOChannelName(sessionId));
                await rpc.invoke("leaveSession", sessionId);
            },

            async createSession(name: string): Promise<SessionInfo> {
                return rpc.invoke("createSession", name);
            },

            async listSessions(name?: string): Promise<SessionInfo[]> {
                return rpc.invoke("listSessions", name);
            },

            async renameSession(
                sessionId: string,
                newName: string,
            ): Promise<void> {
                return rpc.invoke("renameSession", sessionId, newName);
            },

            async deleteSession(sessionId: string): Promise<void> {
                // Clean up local channels if we're in this session
                const entry = joinedSessions.get(sessionId);
                if (entry !== undefined) {
                    joinedSessions.delete(sessionId);
                    channel.deleteChannel(getDispatcherChannelName(sessionId));
                    channel.deleteChannel(getClientIOChannelName(sessionId));
                }
                return rpc.invoke("deleteSession", sessionId);
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
            joinedSessions.clear();
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
                // Hidden mode: spawn node directly with windowsHide so no
                // console window appears. The process is detached so it
                // survives the parent exiting.
                const child = spawn(
                    "node",
                    [serverPath, "--port", String(port), ...extraArgs],
                    {
                        detached: true,
                        stdio: "ignore",
                        windowsHide: true,
                    },
                );
                child.unref();
                debug(
                    `Agent server process spawned hidden (pid: ${child.pid})`,
                );
            } else {
                // Visible mode: spawn a PowerShell window so the user can see
                // server output and any errors. Try PowerShell 7 (pwsh.exe)
                // first, falling back to Windows PowerShell 5 (powershell.exe).
                // We wrap in `cmd /c start` to force CREATE_NEW_CONSOLE — without
                // this, the child inherits the parent's console and no new window
                // appears when the CLI is itself running inside a console host.
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
            // On Unix, detached creates a new session so the child survives
            // parent exit. Background node process, no visible window.
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

export async function ensureAndConnectSession(
    clientIO: ClientIO,
    port: number = 8999,
    options?: DispatcherConnectOptions,
    onDisconnect?: () => void,
    hidden: boolean = false,
    idleTimeout: number = 0,
): Promise<SessionDispatcher> {
    await ensureAgentServer(port, hidden, idleTimeout);
    const url = `ws://localhost:${port}`;
    const connection = await connectAgentServer(url, onDisconnect);
    const session = await connection.joinSession(clientIO, options);
    session.dispatcher.close = async () => {
        await connection.close();
    };
    return session;
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
            reject(new Error(`Failed to connect to agent server at ${url}`));
        };
    });
}

/**
 * Convenience wrapper: connect to an agent server and immediately join a
 * session. Returns a single Dispatcher (backward compatible with old API).
 *
 * @deprecated Use `connectAgentServer()` for full multi-session support.
 */
export async function connectDispatcher(
    clientIO: ClientIO,
    url: string | URL,
    options?: DispatcherConnectOptions,
    onDisconnect?: () => void,
): Promise<Dispatcher> {
    const connection = await connectAgentServer(url, onDisconnect);
    const { dispatcher } = await connection.joinSession(clientIO, options);
    // Override close to also close the WebSocket (old behavior)
    dispatcher.close = async () => {
        await connection.close();
    };
    return dispatcher;
}
