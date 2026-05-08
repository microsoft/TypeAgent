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
    /** TCP port the underlying server is bound to (resolved after `listening`). */
    port: number;
};
export async function createWebSocketChannelServer(
    options: WebSocket.ServerOptions,
    onConnection: (
        channelProvider: ChannelProvider,
        closeFn: () => void,
    ) => void,
): Promise<WebSocketChannelServer> {
    const wss = new WebSocketServer(options);
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
        const addr = wss.address();
        debugWss("WebSocketServer listening on:", addr);
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        promise.resolve({ close: () => wss.close(), port });
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
