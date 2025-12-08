// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ChannelProvider,
    createChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import WebSocket, { WebSocketServer } from "ws";
import registerDebug from "debug";
import { createPromiseWithResolvers } from "@typeagent/common-utils";

const debugWss = registerDebug("typeagent:channel:wss");
const debugWssError = registerDebug("typeagent:channel:wss:error");

let nextId = 0;

type WebSocketChannelServer = {
    close: () => void;
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
        const debug = registerDebug(`typeagent:channel:wss:ws-${id}`);
        const debugError = registerDebug(
            `typeagent:channel:wss:ws:${id}:error`,
        );
        debug(`connected`);
        const channelProvider = createChannelProviderAdapter((message, cb) => {
            const data = JSON.stringify(message);
            debug(`sending message: ${data}`);
            ws.send(
                data,
                cb
                    ? (err) => {
                          if (err) {
                              debugError(`send error callback: ${err}`);
                              cb(err);
                          } else {
                              cb(null);
                          }
                      }
                    : undefined,
            );
        });
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
