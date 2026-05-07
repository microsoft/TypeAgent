// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BridgeToWebviewMessage } from "./messages.js";
import { clientIdOf } from "./requestIds.js";

/**
 * Convert dispatcher display-history entries into a single
 * `historyReplay` bridge message. Pure transformation — buffering of
 * concurrent live events stays in the bridge.
 */
export function toHistoryReplayMessage(
    entries: Array<any>,
): BridgeToWebviewMessage {
    return {
        type: "historyReplay",
        entries: entries.map((e) => {
            switch (e.type) {
                case "user-request":
                    return {
                        type: "user-request",
                        seq: e.seq,
                        timestamp: e.timestamp,
                        requestId: clientIdOf(e.requestId),
                        command: e.command,
                    };
                case "set-display":
                    return {
                        type: "set-display",
                        seq: e.seq,
                        timestamp: e.timestamp,
                        message: e.message,
                        requestId: clientIdOf(e.message?.requestId),
                    };
                case "append-display":
                    return {
                        type: "append-display",
                        seq: e.seq,
                        timestamp: e.timestamp,
                        message: e.message,
                        mode: e.mode,
                        requestId: clientIdOf(e.message?.requestId),
                    };
                case "set-display-info":
                    return {
                        type: "set-display-info",
                        seq: e.seq,
                        timestamp: e.timestamp,
                        requestId: clientIdOf(e.requestId),
                        source: e.source,
                        actionIndex: e.actionIndex,
                        action: e.action,
                    };
                case "command-result":
                    return {
                        type: "command-result",
                        seq: e.seq,
                        timestamp: e.timestamp,
                        requestId: clientIdOf(e.requestId),
                        metrics: e.metrics,
                        tokenUsage: (e as any).tokenUsage,
                    };
                default:
                    return { type: "skip", seq: e.seq };
            }
        }),
    };
}
