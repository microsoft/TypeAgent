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
            message = JSON.parse(rawDataToString(data));
        } catch {
            return; // ignore non-JSON frames
        }
        adapter.notifyMessage(message);
    });
    socket.on("close", () => adapter.notifyDisconnected());

    return adapter.channel;
}

/**
 * Decode a `ws` frame to a UTF-8 string. `ws` can deliver a frame as a string,
 * a `Buffer`, an `ArrayBuffer`, or an array of `Buffer`s (depending on the
 * socket's `binaryType` and fragmentation), so decode each shape explicitly —
 * a bare `data.toString()` on an `ArrayBuffer`/`Buffer[]` yields garbage and
 * would silently drop valid RPC messages.
 */
function rawDataToString(data: WebSocket.RawData): string {
    if (typeof data === "string") {
        return data;
    }
    if (Array.isArray(data)) {
        return Buffer.concat(data).toString("utf8");
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString("utf8");
    }
    return (data as Buffer).toString("utf8");
}
