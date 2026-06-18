// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import {
    createChannelAdapter,
    type RpcChannel,
} from "@typeagent/agent-rpc/channel";

/**
 * Adapt a `ws` WebSocket to the `agent-rpc` {@link RpcChannel} interface.
 *
 * The handler bookkeeping (`on`/`once`/`off` and dispatch) is delegated to
 * `agent-rpc`'s {@link createChannelAdapter}; this only supplies the transport
 * glue — JSON-encode on send, JSON-decode on each frame (silently dropping
 * non-JSON frames), and map the socket's `close` to a disconnect.
 */
export function createWebSocketRpcChannel(socket: WebSocket): RpcChannel {
    const adapter = createChannelAdapter((message, cb) => {
        socket.send(JSON.stringify(message), (err) => cb?.(err ?? null));
    });

    socket.on("message", (data: WebSocket.RawData) => {
        let message: unknown;
        try {
            message = JSON.parse(data.toString());
        } catch {
            return; // ignore non-JSON frames
        }
        adapter.notifyMessage(message);
    });
    socket.on("close", () => adapter.notifyDisconnected());

    return adapter.channel;
}
