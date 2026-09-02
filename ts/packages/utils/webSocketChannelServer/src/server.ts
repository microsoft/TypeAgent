// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ChannelProvider,
    createChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import WebSocket, { WebSocketServer } from "ws";
import registerDebug from "debug";
import { createPromiseWithResolvers } from "@typeagent/common-utils";
import {
    createConfiguredOriginAllowlist,
    VISUAL_STUDIO_WEBVIEW_ORIGIN,
} from "@typeagent/websocket-utils/originAllowlist";
import { LOOPBACK_HOST } from "@typeagent/websocket-utils/loopback";
import { attachHeartbeat } from "./heartbeat.js";

const debugWss = registerDebug("typeagent:transport:wss");
const debugWssError = registerDebug("typeagent:transport:wss:error");

let nextId = 0;

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
function errType(err: unknown): string | undefined {
    return err instanceof Error ? err.name : undefined;
}
function errStack(err: unknown): string | undefined {
    return err instanceof Error ? err.stack : undefined;
}

type WebSocketChannelServer = {
    close: () => void;
};

/**
 * Origin policy applied when the caller doesn't supply one. The channels
 * served here reach the dispatcher, so the only legitimate clients are
 * same-machine ones: Node `ws` callers (CLI, shell, VS Code extension host),
 * which send no Origin, loopback web pages, the TypeAgent browser
 * extension, and the Visual Studio chat panel. A web page the user happens
 * to visit is not on that list and gets a 403 during the handshake.
 *
 * The Visual Studio panel is a WebView2 serving bundled content from a
 * virtual host, so it sends {@link VISUAL_STUDIO_WEBVIEW_ORIGIN} rather than
 * a loopback origin. It is allowed by exact match. Reaching this listener
 * still requires the ability to run code on the loopback interface, since
 * that origin resolves to a folder mapping inside the WebView2 host rather
 * than to anything a remote page can be served from.
 *
 * `Origin: null` is refused: it is the opaque-origin sentinel a sandboxed
 * iframe sends, so accepting it would let a hostile page reach the
 * dispatcher through an iframe it controls. Native clients send no Origin
 * header at all, which is a separate case and still allowed.
 */
const defaultIsOriginAllowed = createConfiguredOriginAllowlist(
    {
        extensionSchemes: ["chrome-extension://", "moz-extension://"],
        allowNullOrigin: false,
    },
    [VISUAL_STUDIO_WEBVIEW_ORIGIN],
);

/**
 * Extra options layered on top of `ws.ServerOptions` for our transport.
 *
 * `verifyClient` is not accepted: this factory installs its own, built from
 * {@link WebSocketChannelServerOptions.isOriginAllowed}. Taking one here would
 * silently discard it and drop the caller's access check.
 */
export type WebSocketChannelServerOptions = Omit<
    WebSocket.ServerOptions,
    "verifyClient"
> & {
    /**
     * Optional Origin gate. An upgrade whose `Origin` header is rejected by
     * the predicate is refused with HTTP 403 during the handshake, so denied
     * clients never allocate a channel or send frames. Defaults to an
     * allowlist of no-Origin native clients, loopback web origins, and the
     * TypeAgent browser extension schemes; pass `() => true` to accept every
     * Origin. Build a different policy with `createAgentOriginAllowlist` from
     * `@typeagent/websocket-utils`.
     */
    isOriginAllowed?: (origin: string | string[] | undefined) => boolean;
};

export async function createWebSocketChannelServer(
    options: WebSocketChannelServerOptions,
    onConnection: (
        channelProvider: ChannelProvider,
        closeFn: () => void,
    ) => void,
): Promise<WebSocketChannelServer> {
    const { isOriginAllowed = defaultIsOriginAllowed, ...wsOptions } = options;
    // `ws` binds every interface when given a `port` with no `host`, which
    // would put this unauthenticated RPC surface on the LAN. Callers here
    // serve same-machine clients, so bind loopback unless one names a host
    // explicitly (a container publishing the port, for example).
    const listenOptions: WebSocket.ServerOptions =
        wsOptions.port !== undefined &&
        (wsOptions.host === undefined || wsOptions.host.trim() === "")
            ? { ...wsOptions, host: LOOPBACK_HOST }
            : wsOptions;
    // verifyClient runs synchronously during the HTTP upgrade; using it
    // (rather than rejecting after `connection`) means denied clients
    // never get to allocate a channelProvider or send any frames.
    const wssOptions: WebSocket.ServerOptions = {
        ...listenOptions,
        verifyClient: (info, cb) => {
            if (isOriginAllowed(info.origin)) {
                cb(true);
                return;
            }
            debugWssError(
                `rejecting upgrade: origin '${info.origin}' not allowed`,
            );
            cb(false, 403, "Origin not allowed");
        },
    };
    const wss = new WebSocketServer(wssOptions);
    attachHeartbeat(wss);
    wss.on("connection", (ws) => {
        const id = nextId++;
        const debugId = `typeagent:transport:wss:ws-${id}`;
        const debug = registerDebug(debugId);
        const debugWarn = registerDebug(`${debugId}:warn`);
        const debugError = registerDebug(`${debugId}:error`);
        debug(`connected`);
        const channelProvider = createChannelProviderAdapter(
            "agent-server:server",
            (message, cb) => {
                const data = JSON.stringify(message);
                debug("sending message", {
                    channel: message?.name,
                    type: message?.message?.type,
                    method: message?.message?.name,
                    callId: message?.message?.callId,
                    bytes: Buffer.byteLength(data),
                });
                // Skip sends to a socket that is closing/closed. ws.send()
                // would otherwise queue the failure on process.nextTick,
                // bypassing any synchronous try/catch around the caller and
                // becoming an uncaughtException. Best-effort: just drop the
                // message and report via the callback (if any).
                if (ws.readyState !== WebSocket.OPEN) {
                    debugWarn("dropping send: socket not open", {
                        connection: id,
                        readyState: ws.readyState,
                        channel: message?.name,
                        type: message?.message?.type,
                        callId: message?.message?.callId,
                    });
                    if (cb) {
                        cb(
                            new Error(
                                `WebSocket is not open: readyState ${ws.readyState}`,
                            ),
                        );
                    }
                    return;
                }
                try {
                    ws.send(data, (err) => {
                        if (err) {
                            debugWarn("send callback error", {
                                connection: id,
                                errorType: errType(err),
                                error: errMessage(err),
                            });
                        }
                        if (cb) {
                            cb(err ?? null);
                        }
                    });
                } catch (err) {
                    // Synchronous failures from ws.send (e.g. socket closed
                    // mid-write) — surface to the caller if it asked, but
                    // don't escalate to an uncaughtException.
                    debugError("synchronous send failure", {
                        connection: id,
                        channel: message?.name,
                        type: message?.message?.type,
                        callId: message?.message?.callId,
                        errorType: errType(err),
                        error: errMessage(err),
                        stack: errStack(err),
                    });
                    if (cb) {
                        cb(err as Error);
                    }
                }
            },
        );
        ws.on("message", (data: Buffer) => {
            debug("receiving message", {
                connection: id,
                bytes: data.length,
            });
            try {
                // REVIEW: assume all messages are JSON
                const message = JSON.parse(data.toString());
                channelProvider.notifyMessage(message);
            } catch (err) {
                debugWarn("failed to parse inbound message", {
                    connection: id,
                    bytes: data.length,
                    errorType: errType(err),
                });
            }
        });
        ws.on("error", (err) => {
            debugError("socket error event", {
                connection: id,
                readyState: ws.readyState,
                errorType: errType(err),
                error: errMessage(err),
                stack: errStack(err),
            });
            ws.close();
        });
        ws.on("close", (code, reason) => {
            debug(`closed: ${code} ${reason}`);
            channelProvider.notifyDisconnected();
        });

        onConnection(channelProvider, () => ws.close());
    });

    const promise = createPromiseWithResolvers<WebSocketChannelServer>();
    const listeningHandler = () => {
        debugWss("WebSocketServer listening on:", wss.address());
        promise.resolve({ close: () => wss.close() });
        wss.off("listening", listeningHandler);
        wss.off("error", errorHandler);
    };
    const errorHandler = (err: Error) => {
        debugWssError("WebSocketServer error:", err);
        promise.reject(err);
        wss.off("listening", listeningHandler);
        wss.off("error", errorHandler);
    };
    wss.on("listening", listeningHandler);
    wss.on("error", errorHandler);
    return promise.promise;
}
