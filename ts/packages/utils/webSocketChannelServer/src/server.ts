// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ChannelProvider,
    createChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import WebSocket, { WebSocketServer } from "ws";
import registerDebug from "debug";
import { createPromiseWithResolvers } from "@typeagent/common-utils";

const debugWss = registerDebug("typeagent:transport:wss");
const debugWssError = registerDebug("typeagent:transport:wss:error");

let nextId = 0;

type WebSocketChannelServer = {
    close: () => void;
};

/**
 * Extra options layered on top of `ws.ServerOptions` for our transport.
 */
export type WebSocketChannelServerOptions = WebSocket.ServerOptions & {
    /**
     * Optional allowlist of acceptable Origin header values. If set, any
     * upgrade with an Origin header NOT in this list (case-insensitive,
     * exact match unless the entry ends in `*` for prefix match) is
     * rejected with HTTP 403. Connections without an Origin header
     * (native apps, CLI clients) are always allowed — Origin is a
     * browser-set header, so its absence is not itself a signal of
     * privilege. When omitted, the upgrade is accepted regardless of
     * Origin (current default behavior).
     */
    originAllowlist?: string[];
};

function isOriginAllowed(origin: string, allowlist: string[]): boolean {
    const lower = origin.toLowerCase();
    return allowlist.some((entry) => {
        const e = entry.toLowerCase();
        if (e.endsWith("*")) {
            return lower.startsWith(e.slice(0, -1));
        }
        return lower === e;
    });
}

export async function createWebSocketChannelServer(
    options: WebSocketChannelServerOptions,
    onConnection: (
        channelProvider: ChannelProvider,
        closeFn: () => void,
    ) => void,
): Promise<WebSocketChannelServer> {
    const { originAllowlist, ...wsOptions } = options;
    // verifyClient runs synchronously during the HTTP upgrade; using it
    // (rather than rejecting after `connection`) means denied clients
    // never get to allocate a channelProvider or send any frames.
    const wssOptions: WebSocket.ServerOptions =
        originAllowlist !== undefined
            ? {
                  ...wsOptions,
                  verifyClient: (info, cb) => {
                      const origin = info.origin;
                      if (!origin) {
                          // No Origin = native client (CLI, shell). Allow.
                          cb(true);
                          return;
                      }
                      if (isOriginAllowed(origin, originAllowlist)) {
                          cb(true);
                          return;
                      }
                      debugWssError(
                          `rejecting upgrade: origin '${origin}' not in allowlist`,
                      );
                      cb(false, 403, "Origin not allowed");
                  },
              }
            : wsOptions;
    const wss = new WebSocketServer(wssOptions);
    wss.on("connection", (ws) => {
        const id = nextId++;
        const debugId = `typeagent:transport:wss:ws-${id}`;
        const debug = registerDebug(debugId);
        const debugError = registerDebug(`${debugId}:error`);
        debug(`connected`);
        const channelProvider = createChannelProviderAdapter(
            "agent-server:server",
            (message, cb) => {
                const data = JSON.stringify(message);
                debug(`sending message: ${data}`);
                // Skip sends to a socket that is closing/closed. ws.send()
                // would otherwise queue the failure on process.nextTick,
                // bypassing any synchronous try/catch around the caller and
                // becoming an uncaughtException. Best-effort: just drop the
                // message and report via the callback (if any).
                if (ws.readyState !== WebSocket.OPEN) {
                    debugError(
                        `dropping send: ws not open (readyState=${ws.readyState})`,
                    );
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
                            debugError(`send error callback: ${err}`);
                        }
                        if (cb) {
                            cb(err ?? null);
                        }
                    });
                } catch (err) {
                    // Synchronous failures from ws.send (e.g. socket closed
                    // mid-write) — surface to the caller if it asked, but
                    // don't escalate to an uncaughtException.
                    debugError(`send threw: ${err}`);
                    if (cb) {
                        cb(err as Error);
                    }
                }
            },
        );
        ws.on("message", (data: Buffer) => {
            debug(`receiving message: ${data}`);
            try {
                // REVIEW: assume all messages are JSON
                const message = JSON.parse(data.toString());
                channelProvider.notifyMessage(message);
            } catch (err) {
                debugError("Failed to parse message:", err);
            }
        });
        ws.on("error", (err) => {
            debugError("error:", err);
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
