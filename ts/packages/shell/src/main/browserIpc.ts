// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebSocketMessageV2,
    keepWebSocketAlive,
} from "@typeagent/websocket-utils";

import WebSocket from "ws";
import { discoverPort } from "@typeagent/agent-server-client/discovery";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type {
    BrowserControlInvokeFunctions,
    BrowserControlCallFunctions,
} from "@typeagent/browser-control-rpc/types";
import registerDebug from "debug";
const debugBrowserIPC = registerDebug("typeagent:browser:ipc");
const debugBrowserIPCError = registerDebug("typeagent:browser:ipc:error");

const AGENT_SERVER_DEFAULT_URL = "ws://localhost:8999/";

// Connect-mode override for the agent-server discovery base URL. In connect
// mode the shell talks to a remote/standalone agent-server on a specific
// port, so browser-agent discovery must target that server rather than the
// default localhost:8999. Set via BrowserAgentIpc.setAgentServerUrl().
let agentServerDiscoveryUrlOverride: string | undefined;

export class BrowserAgentIpc {
    private static instance: BrowserAgentIpc;
    public onMessageReceived: ((message: WebSocketMessageV2) => void) | null;
    public onRpcReply: ((message: any) => void) | null;
    public onSendNotification: ((message: string, id: string) => void) | null;
    private webSocket: any;
    private reconnectionPending: boolean = false;
    private webSocketPromise: Promise<WebSocket | undefined> | null = null;
    private messageQueue: WebSocketMessageV2[] = [];
    private maxQueueSize: number = 100;
    private reconnectAttempts: number = 0;
    private hasShownRestoringNotification: boolean = false;

    // Connect-mode inline browser control: when set, the shell serves its
    // in-process BrowserControl to the (remote) browser agent over the
    // inlineBrowser socket's `browserControl` RPC channel. In standalone the
    // control is provided in-process via agentInitOptions.browser and this
    // stays undefined.
    private browserControlHandlers?: {
        invokeFunctions: BrowserControlInvokeFunctions;
        callFunctions: BrowserControlCallFunctions;
    };
    private browserControlProvider?: ChannelProviderAdapter;

    private constructor() {
        this.webSocket = null;
        this.onMessageReceived = null;
        this.onRpcReply = null;
        this.onSendNotification = null;
    }

    public static getinstance = (): BrowserAgentIpc => {
        if (!BrowserAgentIpc.instance) {
            BrowserAgentIpc.instance = new BrowserAgentIpc();
        }

        return BrowserAgentIpc.instance;
    };

    /**
     * Set the agent-server discovery base URL for the inline browser socket.
     * Used in connect mode so browser-agent port discovery targets the
     * connected agent-server (which hosts discovery on its main port) instead
     * of the default localhost:8999.
     */
    public setAgentServerUrl(url: string | undefined) {
        agentServerDiscoveryUrlOverride = url;
    }

    public async ensureWebsocketConnected(): Promise<WebSocket | undefined> {
        // if there's a pending websocket promise, return it
        if (this.webSocketPromise) {
            return this.webSocketPromise;
        }

        if (this.webSocket) {
            if (this.webSocket.readyState === WebSocket.OPEN) {
                return this.webSocket;
            }
            try {
                this.webSocket.close();
                this.webSocket = undefined;
            } catch {}
        }

        //create a new promise to establish the websocket connection
        this.webSocketPromise = new Promise<WebSocket | undefined>(
            async (resolve) => {
                this.webSocket = await createInlineBrowserWebSocket();
                if (!this.webSocket) {
                    this.webSocketPromise = null;
                    resolve(undefined);
                    return;
                }

                this.webSocket.binaryType = "blob";
                keepWebSocketAlive(this.webSocket, "browser");

                this.webSocket.onmessage = async (event: any) => {
                    const text =
                        typeof event.data === "string"
                            ? event.data
                            : await (event.data as Blob).text();
                    try {
                        const data = JSON.parse(text) as any;

                        // Browser control channel: served in-process (main)
                        // by the shell's inline BrowserControl so the remote
                        // browser agent can drive the shell's own tabs in
                        // connect mode.
                        if (data.name === "browserControl") {
                            this.browserControlProvider?.notifyMessage(data);
                            return;
                        }

                        // Channel-multiplexed messages: forward agentService replies to renderer
                        if (data.name === "agentService") {
                            if (this.onRpcReply) {
                                this.onRpcReply(data.message);
                            }
                            return;
                        }

                        let schema = (data as WebSocketMessageV2).method?.split(
                            "/",
                        )[0];
                        schema = schema || "browser";

                        // Forward messages for browser, webAgent schemas, and import progress updates
                        if (
                            (schema == "browser" ||
                                schema == "webAgent" ||
                                schema.startsWith("browser.") ||
                                (data as WebSocketMessageV2).method ===
                                    "importProgress") &&
                            this.onMessageReceived
                        ) {
                            debugBrowserIPC("BrowserAgent -> Shell", data);
                            this.onMessageReceived(data as WebSocketMessageV2);
                        }
                    } catch {}
                };

                this.webSocket.onclose = () => {
                    debugBrowserIPC("websocket connection closed");
                    this.browserControlProvider?.notifyDisconnected();
                    this.browserControlProvider = undefined;
                    this.webSocket = undefined;
                    this.reconnectWebSocket();
                };

                // Serve the inline BrowserControl over this socket if enabled
                // (connect mode). Re-served on every (re)connect.
                this.serveBrowserControl();

                this.webSocketPromise = null;

                // Reset reconnection attempts on successful connection
                this.reconnectAttempts = 0;

                // Flush any queued messages
                this.flushMessageQueue();

                resolve(this.webSocket);
            },
        );

        return this.webSocketPromise;
    }

    private flushMessageQueue(): void {
        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        debugBrowserIPC(`Flushing ${this.messageQueue.length} queued messages`);
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            if (message) {
                try {
                    debugBrowserIPC("Browser -> Dispatcher (queued)", message);
                    this.webSocket.send(JSON.stringify(message));
                } catch (error) {
                    debugBrowserIPC("Failed to send queued message", error);
                }
            }
        }

        // Reset notification flag after flushing queue
        this.hasShownRestoringNotification = false;
    }

    private reconnectWebSocket() {
        // if there is a reconnection pending just return
        if (this.reconnectionPending) {
            return;
        }

        // indicate a reconnection attempt is pending
        this.reconnectionPending = true;

        // Use exponential backoff: start at 1s, double each time, cap at 5s
        // Attempts: 1s, 2s, 4s, 5s, 5s, 5s...
        const retryDelay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            5000,
        );
        this.reconnectAttempts++;

        debugBrowserIPC(
            `Scheduling reconnection attempt in ${retryDelay}ms (attempt ${this.reconnectAttempts})`,
        );

        setTimeout(async () => {
            if (
                this.webSocket &&
                this.webSocket.readyState === WebSocket.OPEN
            ) {
                debugBrowserIPC(
                    "Connection already established, stopping reconnection",
                );
                this.reconnectionPending = false;
                return;
            }

            debugBrowserIPC("Retrying connection");
            await this.ensureWebsocketConnected();

            // reconnection was either successful or attempted
            this.reconnectionPending = false;

            // If still not connected, schedule another attempt
            if (
                !this.webSocket ||
                this.webSocket.readyState !== WebSocket.OPEN
            ) {
                this.reconnectWebSocket();
            }
        }, retryDelay);
    }

    public async send(message: WebSocketMessageV2) {
        const webSocket = await this.ensureWebsocketConnected();
        if (!webSocket) {
            // Queue the message if connection isn't ready yet
            if (this.messageQueue.length < this.maxQueueSize) {
                debugBrowserIPC(
                    "WebSocket not connected, queueing message",
                    message.method,
                );
                this.messageQueue.push(message);

                // Show notification when queueing site agent messages
                if (
                    !this.hasShownRestoringNotification &&
                    (message.method === "enableSiteTranslator" ||
                        message.method === "enableSiteAgent")
                ) {
                    this.hasShownRestoringNotification = true;
                    this.sendRestoringNotification();
                }
            } else {
                debugBrowserIPC(
                    "Message queue full, dropping message",
                    message.method,
                );
            }
            return;
        }
        debugBrowserIPC("Browser -> Dispatcher", message);
        webSocket.send(JSON.stringify(message));
    }

    private sendRestoringNotification(): void {
        if (this.onSendNotification) {
            this.onSendNotification(
                "Restoring site-specific agents...",
                "browser-restore-agents",
            );
        }
    }

    public isConnected(): boolean {
        return this.webSocket && this.webSocket.readyState === WebSocket.OPEN;
    }

    /**
     * Enable serving the shell's inline BrowserControl to the (remote) browser
     * agent over the inlineBrowser socket's `browserControl` RPC channel. Used
     * in connect mode, where the browser agent runs out-of-process and cannot
     * receive the control in-process via `agentInitOptions.browser`. Safe to
     * call before the socket connects; the channel is (re)served on each
     * connect. Standalone must NOT call this (the in-process control is used).
     */
    public enableInlineBrowserControl(handlers: {
        invokeFunctions: BrowserControlInvokeFunctions;
        callFunctions: BrowserControlCallFunctions;
    }) {
        this.browserControlHandlers = handlers;
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            this.serveBrowserControl();
        }
    }

    private serveBrowserControl() {
        if (!this.browserControlHandlers || !this.webSocket) {
            return;
        }
        // Drop any provider bound to a superseded socket before rebinding.
        this.browserControlProvider?.notifyDisconnected();
        const provider = createChannelProviderAdapter(
            "browser:inline-control",
            (message) => {
                if (
                    this.webSocket &&
                    this.webSocket.readyState === WebSocket.OPEN
                ) {
                    this.webSocket.send(JSON.stringify(message));
                }
            },
        );
        const channel = provider.createChannel("browserControl");
        createRpc(
            "shell:inlineBrowserControl",
            channel,
            this.browserControlHandlers.invokeFunctions,
            this.browserControlHandlers.callFunctions,
        );
        this.browserControlProvider = provider;
    }
}

/**
 * Build the inline-browser → agent-server WebSocket URL by discovering the
 * browser agent's port via the agent-server discovery channel, then opening
 * the connection. Mirrors the chrome extension's resolveBrowserEndpoint /
 * createWebSocket flow (see ts/packages/agents/browserExtension/src/
 * extension/serviceWorker/websocket.ts) so both clients of the browser agent reach
 * the same dynamic port.
 *
 * The agent-server discovery URL defaults to ws://localhost:8999/ but can
 * be overridden with WEBSOCKET_HOST for non-default deployments.
 *
 * NOTE on WEBSOCKET_HOST semantics: this caller treats it as a *base URL*
 * (protocol + host + port) and builds its own path/query. The legacy
 * `createWebSocket` helper in `packages/utils/webSocketUtils/src/webSockets.ts`
 * treats the same env var as a *complete endpoint replacement*. Set
 * WEBSOCKET_HOST to a base URL without a path (e.g. `ws://example.com:9000/`)
 * for predictable behavior across both call sites.
 */
async function createInlineBrowserWebSocket(): Promise<WebSocket | undefined> {
    const agentServerUrl =
        agentServerDiscoveryUrlOverride ||
        process.env["WEBSOCKET_HOST"] ||
        AGENT_SERVER_DEFAULT_URL;
    const sessionId = "default";

    const result = await discoverPort("browser", sessionId, {
        url: agentServerUrl,
    });
    if (result.kind !== "found") {
        if (result.kind === "not-registered") {
            debugBrowserIPC(
                "Browser agent not registered with agent-server at %s",
                agentServerUrl,
            );
        } else {
            debugBrowserIPCError(
                "Agent-server discovery unreachable at %s: %s",
                agentServerUrl,
                result.error.message,
            );
        }
        return undefined;
    }

    let endpoint: string;
    try {
        const u = new URL(agentServerUrl);
        // `URL.hostname` strips IPv6 brackets in some Node versions
        // (e.g. returns `::1` instead of `[::1]`), which would produce
        // an invalid URL like `ws://::1:8999/...`. Re-bracket bare IPv6
        // literals before composing the endpoint. We use `hostname`
        // (not `host`) because `host` includes the existing port and we
        // need to substitute the discovered port from the registrar.
        endpoint = `${u.protocol}//${u.hostname.includes(":") && !u.hostname.startsWith("[") ? `[${u.hostname}]` : u.hostname}:${result.port}/?channel=browser&role=client&clientId=inlineBrowser&sessionId=${sessionId}`;
    } catch (e) {
        debugBrowserIPCError("Invalid agent-server URL: %s", e);
        return undefined;
    }

    debugBrowserIPC("Connecting inlineBrowser to: %s", endpoint);
    return new Promise<WebSocket | undefined>((resolve) => {
        const ws = new WebSocket(endpoint);
        ws.onopen = () => {
            debugBrowserIPC("inlineBrowser websocket open");
            resolve(ws);
        };
        ws.onerror = (event: any) => {
            debugBrowserIPCError(
                "inlineBrowser websocket error: %s",
                event?.message ?? "unknown",
            );
            resolve(undefined);
        };
        ws.onclose = () => {
            debugBrowserIPC("inlineBrowser websocket closed");
            resolve(undefined);
        };
    });
}
