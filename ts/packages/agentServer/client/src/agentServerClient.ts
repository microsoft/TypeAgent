// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import type { ChannelProviderAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createClientIORpcServer } from "@typeagent/dispatcher-rpc/clientio/server";
import {
    createDispatcherRpcClient,
    wrapClientIOForCompletion,
} from "@typeagent/dispatcher-rpc/dispatcher/client";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-rpc/types";
import WebSocket from "isomorphic-ws";
import { spawn } from "child_process";
import type { StdioOptions } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import registerDebug from "debug";
import {
    AgentServerInvokeFunctions,
    AgentServerChannelName,
    AGENT_SERVER_DEFAULT_PORT,
    DispatcherConnectOptions,
    CreateConversationOptions,
    ConversationInfo,
    JoinConversationResult,
    RenameConversationOptions,
    SpeechToken,
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
    /** Server-assigned connectionId for this client (e.g. to label own queued requests). */
    connectionId: string;
    /** Server-side queue snapshot at join time, so clients can render correct
     *  queue state when joining mid-queue. Omitted by older servers. */
    queueSnapshot?: JoinConversationResult["queueSnapshot"];
};

export type AgentServerConnection = {
    joinConversation(
        clientIO: ClientIO,
        options?: DispatcherConnectOptions,
    ): Promise<ConversationDispatcher>;
    leaveConversation(conversationId: string): Promise<void>;
    createConversation(
        name: string,
        options?: CreateConversationOptions,
    ): Promise<ConversationInfo>;
    listConversations(name?: string): Promise<ConversationInfo[]>;
    renameConversation(
        conversationId: string,
        newName: string,
        options?: RenameConversationOptions,
    ): Promise<void>;
    deleteConversation(conversationId: string): Promise<void>;
    shutdown(): Promise<void>;
    /**
     * Request a short-lived Azure Speech authorization token from the server
     * (which owns the `speech:` config). Resolves to `undefined` when speech
     * isn't configured, so callers can hide/disable the mic affordance.
     */
    getSpeechToken(): Promise<SpeechToken | undefined>;
    /**
     * Reopen the underlying transport and rebind the control rpc onto it,
     * reusing this connection object instead of building a new one. Returns
     * false when the transport can't be reopened (caller retries). Per-
     * conversation channels are dropped — the caller must re-join.
     */
    reconnect(): Promise<boolean>;
    close(): Promise<void>;
};

/**
 * Options for connecting to the agent-server WebSocket. Use `headers` to pass
 * tunnel authorization tokens when connecting through a private Dev Tunnel.
 */
export interface AgentServerConnectOptions {
    /** Extra headers sent during the WebSocket upgrade handshake. */
    headers?: Record<string, string>;
}

/**
 * Build the connect options (including tunnel token header) from environment
 * variables. Returns undefined if no tunnel token is configured.
 *
 * Reads: `TYPEAGENT_TUNNEL_TOKEN`
 */
export function getConnectOptionsFromEnv():
    | AgentServerConnectOptions
    | undefined {
    const token = process.env.TYPEAGENT_TUNNEL_TOKEN;
    if (!token) return undefined;
    return {
        headers: { "X-Tunnel-Authorization": `tunnel ${token}` },
    };
}

/**
 * Build an {@link AgentServerConnection} over an already-connected channel
 * adapter. This is the transport-agnostic core shared by both the WebSocket
 * client ({@link connectAgentServer}) and the in-process loopback client used
 * when an agent server is embedded in the same process (e.g. the Electron
 * shell).
 *
 * @param channel  A connected channel provider adapter. The caller is
 *   responsible for pumping the underlying transport into
 *   `channel.notifyMessage(...)` and for calling `channel.notifyDisconnected()`
 *   when the transport drops.
 * @param closeTransport  Invoked by `connection.close()` to tear down the
 *   underlying transport (e.g. close the WebSocket, or disconnect the loopback).
 */
export function createAgentServerConnection(
    channel: ChannelProviderAdapter,
    closeTransport: () => void,
    reopenTransport?: () => Promise<ChannelProviderAdapter | undefined>,
): AgentServerConnection {
    // The current transport channel; swapped on reconnect(). All per-call
    // channel work goes through currentChannel so it follows reconnects.
    let currentChannel = channel;
    const rpc = createRpc<AgentServerInvokeFunctions>(
        "agent-server:client",
        currentChannel.createChannel(AgentServerChannelName),
        undefined,
        undefined,
        { rebindable: true },
    );

    // Track joined conversations for cleanup on close
    const joinedConversations = new Map<
        string,
        { dispatcher: Dispatcher; connectionId: string }
    >();

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

            // Create the dispatcher RPC client first so we can wrap the
            // host's clientIO with completion-correlation forwarding
            // before the clientIO RPC server starts delivering events.
            const {
                dispatcher,
                notifyCommandComplete,
                notifyRequestCancelled,
            } = createDispatcherRpcClient(
                currentChannel.createChannel(
                    getDispatcherChannelName(conversationId),
                ),
                result.connectionId,
            );

            createClientIORpcServer(
                wrapClientIOForCompletion(clientIO, {
                    notifyCommandComplete,
                    notifyRequestCancelled,
                }),
                currentChannel.createChannel(
                    getClientIOChannelName(conversationId),
                ),
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
                connectionId: result.connectionId,
                queueSnapshot: result.queueSnapshot,
            };
        },

        async leaveConversation(conversationId: string): Promise<void> {
            const entry = joinedConversations.get(conversationId);
            if (entry === undefined) {
                return;
            }
            joinedConversations.delete(conversationId);
            currentChannel.deleteChannel(
                getDispatcherChannelName(conversationId),
            );
            currentChannel.deleteChannel(
                getClientIOChannelName(conversationId),
            );
            await rpc.invoke("leaveConversation", conversationId);
        },

        async createConversation(
            name: string,
            options?: CreateConversationOptions,
        ): Promise<ConversationInfo> {
            return rpc.invoke("createConversation", name, options);
        },

        async listConversations(name?: string): Promise<ConversationInfo[]> {
            return rpc.invoke("listConversations", name);
        },

        async renameConversation(
            conversationId: string,
            newName: string,
            options?: RenameConversationOptions,
        ): Promise<void> {
            return rpc.invoke(
                "renameConversation",
                conversationId,
                newName,
                options,
            );
        },

        async deleteConversation(conversationId: string): Promise<void> {
            // Clean up local channels if we're in this conversation
            const entry = joinedConversations.get(conversationId);
            if (entry !== undefined) {
                joinedConversations.delete(conversationId);
                currentChannel.deleteChannel(
                    getDispatcherChannelName(conversationId),
                );
                currentChannel.deleteChannel(
                    getClientIOChannelName(conversationId),
                );
            }
            return rpc.invoke("deleteConversation", conversationId);
        },

        async shutdown(): Promise<void> {
            debug("Requesting server shutdown via existing connection");
            await rpc.invoke("shutdown");
        },

        async getSpeechToken(): Promise<SpeechToken | undefined> {
            return rpc.invoke("getSpeechToken");
        },

        async reconnect(): Promise<boolean> {
            if (closed || reopenTransport === undefined) {
                return false;
            }
            const next = await reopenTransport();
            if (next === undefined) {
                return false;
            }
            currentChannel = next;
            rpc.rebind(currentChannel.createChannel(AgentServerChannelName));
            // The prior transport's per-conversation channels are gone; drop
            // our local bookkeeping so the caller re-joins cleanly.
            joinedConversations.clear();
            return true;
        },

        async close(): Promise<void> {
            if (closed) {
                return;
            }
            closed = true;
            debug("Closing agent server connection");
            closeTransport();
        },
    };

    return connection;
}

/**
 * Connect to an agent server and return a connection object that supports
 * multiple conversations over a single WebSocket.
 */
export async function connectAgentServer(
    url: string | URL,
    onDisconnect?: () => void,
    connectOptions?: AgentServerConnectOptions,
): Promise<AgentServerConnection> {
    // A single logical connection over a transport that can be reopened in
    // place (reconnect()). `currentClose` tracks the live socket's teardown,
    // and `connectionClosed` fences the onclose/onDisconnect bookkeeping across
    // reconnects.
    let connectionClosed = false;
    let currentWs: WebSocket | undefined;
    // Identifies the live transport so a superseded socket's onclose (after a
    // reconnect) can't fire a spurious onDisconnect or clobber bookkeeping.
    let transportGeneration = 0;

    // Open a fresh ws + channel; resolves the channel on open, or undefined if
    // the attempt fails / closes before opening.
    const openTransport = (): Promise<ChannelProviderAdapter | undefined> =>
        new Promise((resolve) => {
            const myGeneration = ++transportGeneration;
            // Defensively drop any prior socket so a reconnect while the old one
            // is still open can't leak it; its (now superseded) onclose is
            // ignored via the generation guard below.
            currentWs?.close();
            const ws = new WebSocket(
                url,
                connectOptions?.headers
                    ? { headers: connectOptions.headers }
                    : undefined,
            );
            currentWs = ws;
            let opened = false;
            let settled = false;
            const settle = (value: ChannelProviderAdapter | undefined) => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(value);
            };

            const channel: ChannelProviderAdapter =
                createChannelProviderAdapter(
                    "agent-server:client",
                    (message: any) => {
                        debug("Sending message to server:", message);
                        ws.send(JSON.stringify(message));
                    },
                );

            ws.onopen = () => {
                debug("WebSocket connection established", ws.readyState);
                opened = true;
                settle(channel);
            };
            ws.onmessage = (event: WebSocket.MessageEvent) => {
                debug("Received message from server:", event.data);
                channel.notifyMessage(JSON.parse(event.data.toString()));
            };
            ws.onclose = (event: WebSocket.CloseEvent) => {
                debug("WebSocket connection closed", event.code, event.reason);
                channel.notifyDisconnected();
                if (!opened) {
                    // Closed before onopen fired — a failed attempt.
                    settle(undefined);
                    return;
                }
                // Ignore a superseded transport's close (a later reconnect
                // already moved on).
                if (myGeneration !== transportGeneration) {
                    return;
                }
                if (!connectionClosed) {
                    connectionClosed = true;
                    onDisconnect?.();
                }
            };
            ws.onerror = (error: WebSocket.ErrorEvent) => {
                debugErr("WebSocket error:", error);
                if (!opened) {
                    settle(undefined);
                }
            };
        });

    const firstChannel = await openTransport();
    if (firstChannel === undefined) {
        throw new Error(`Failed to connect to agent server at ${url}`);
    }

    return createAgentServerConnection(
        firstChannel,
        () => {
            if (connectionClosed) {
                return;
            }
            connectionClosed = true;
            currentWs?.close();
        },
        async () => {
            // Allow a fresh socket after a drop, then reopen.
            connectionClosed = false;
            return openTransport();
        },
    );
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

/**
 * Optional overrides for how the agent-server child process is spawned. The
 * defaults preserve the standard background-server behavior — its own process
 * group via `detached`, no console window via `windowsHide`, and ignored stdio.
 * Callers that need different lifecycle/IO semantics can override individual
 * fields. Only applies to the direct `node` spawn paths (background/hidden and
 * non-Windows), not the visible new-window path.
 */
export interface AgentServerSpawnOptions {
    detached?: boolean;
    windowsHide?: boolean;
    stdio?: StdioOptions;
}

// Choose a PowerShell executable for Windows. Detects whether PowerShell 7+
// (pwsh) is installed by probing its standard install locations and PATH, so
// installs outside the default "C:\Program Files\PowerShell\7" directory
// (winget, x86, a relocated Program Files) are still recognized. Returns a bare
// executable name — never an environment-derived path — so no path built from
// the environment is ever routed through cmd.exe; `start` resolves the name via
// PATH/App Paths, which every standard PowerShell 7 install registers. Falls
// back to Windows PowerShell (powershell.exe), which is always present.
function resolvePowerShellExe(): string {
    const candidates: string[] = [];
    for (const base of [
        process.env["ProgramFiles"],
        process.env["ProgramW6432"],
        process.env["ProgramFiles(x86)"],
    ]) {
        if (base) {
            candidates.push(path.join(base, "PowerShell", "7", "pwsh.exe"));
        }
    }
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (dir) {
            candidates.push(path.join(dir, "pwsh.exe"));
        }
    }
    return candidates.some((candidate) => fs.existsSync(candidate))
        ? "pwsh.exe"
        : "powershell.exe";
}

function spawnAgentServer(
    serverPath: string,
    port: number,
    hidden: boolean = false,
    idleTimeout: number = 0,
    spawnOptions: AgentServerSpawnOptions = {},
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
                // Spawn node directly (no shell) so the absolute serverPath can
                // never be reinterpreted by a command interpreter. The defaults
                // give the child its own process group / DETACHED_PROCESS (so it
                // outlives this client) and suppress the console window
                // (CREATE_NO_WINDOW); callers can override via spawnOptions.
                const args = [serverPath, "--port", String(port), ...extraArgs];
                const child = spawn("node", args, {
                    detached: spawnOptions.detached ?? true,
                    stdio: spawnOptions.stdio ?? "ignore",
                    windowsHide: spawnOptions.windowsHide ?? true,
                });
                child.unref();
                debug(
                    `Agent server process spawned hidden (pid: ${child.pid})`,
                );
            } else {
                const psExe = resolvePowerShellExe();
                // Pass the server path, port and idle timeout to the child
                // through the environment rather than the command line so none
                // of them ever reach cmd.exe or the PowerShell parser as text.
                // The command handed to PowerShell is assembled only from
                // string literals (the --idle-timeout flag is appended based on
                // whether idleTimeout is set, but its text is still literal) and
                // reads the actual values from $env at runtime. It is delivered
                // as a base64 -EncodedCommand blob whose alphabet is inert to
                // both cmd.exe and PowerShell.
                const psCommand =
                    `$host.UI.RawUI.WindowTitle = ` +
                    `"TypeAgent Server (port $env:TYPEAGENT_SERVER_PORT)"; ` +
                    `& node $env:TYPEAGENT_SERVER_PATH --port $env:TYPEAGENT_SERVER_PORT` +
                    (idleTimeout > 0
                        ? ` --idle-timeout $env:TYPEAGENT_SERVER_IDLE_TIMEOUT`
                        : "");
                const encodedCommand = Buffer.from(
                    psCommand,
                    "utf16le",
                ).toString("base64");
                const psArgs = ["-NoExit", "-EncodedCommand", encodedCommand];
                // The first quoted argument to `start` is the new window's
                // initial title. It MUST be non-empty: an empty title leaves
                // the console window title blank, which trips a libuv bug on
                // Windows — GetConsoleTitleW returns 0 with GetLastError()==0,
                // libuv reads that as success but leaves process_title NULL,
                // and the next process.title read aborts with
                // "Assertion failed: process_title, file src\\win\\util.c".
                // A fixed literal keeps caller-supplied values out of the
                // cmd.exe argument list; the port is appended to the title from
                // the environment once PowerShell starts (see psCommand above).
                const windowTitle = "TypeAgent Server";
                const child = spawn(
                    "cmd.exe",
                    ["/c", "start", windowTitle, psExe, ...psArgs],
                    {
                        detached: true,
                        stdio: "ignore",
                        env: {
                            ...process.env,
                            TYPEAGENT_SERVER_PATH: serverPath,
                            TYPEAGENT_SERVER_PORT: String(port),
                            TYPEAGENT_SERVER_IDLE_TIMEOUT: String(idleTimeout),
                        },
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
                    detached: spawnOptions.detached ?? true,
                    stdio: spawnOptions.stdio ?? "ignore",
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
    port: number = AGENT_SERVER_DEFAULT_PORT,
    hidden: boolean = false,
    idleTimeout: number = 0,
    spawnOptions: AgentServerSpawnOptions = {},
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
        spawnAgentServer(serverPath, port, hidden, idleTimeout, spawnOptions);
        await waitForServer(url);
        console.log("TypeAgent server started.");
    }
}

export async function ensureAndConnectDispatcher(
    clientIO: ClientIO,
    port: number = AGENT_SERVER_DEFAULT_PORT,
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
    port: number = AGENT_SERVER_DEFAULT_PORT,
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
    port: number = AGENT_SERVER_DEFAULT_PORT,
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
