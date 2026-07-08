// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DisplayLogEntry,
    IAgentMessage,
    RequestId,
} from "@typeagent/dispatcher-types";
import type { CopilotTurnRow } from "./sessionStoreReader.js";

/**
 * Synthesize a TypeAgent {@link DisplayLogEntry} stream from a Copilot
 * session's turns so an imported session renders in the conversation UI via
 * the normal display-history replay path.
 *
 * Each Copilot turn becomes two entries that share one synthesized
 * {@link RequestId} (this is how the UI groups a user bubble with its agent
 * response):
 *   1. a `user-request` entry carrying `user_message`
 *   2. a `set-display` entry carrying `assistant_response` as markdown
 *
 * The output is fully deterministic for a given (sessionId, turns) input:
 * sequence numbers and request ids are derived from the turn index, so
 * re-synthesizing the same session yields byte-identical entries. That keeps
 * mirror imports idempotent.
 */

/** `source` label attached to synthesized agent bubbles. */
export const COPILOT_SOURCE = "copilot";

/**
 * Stable, deterministic request id for a synthesized turn. Encodes the origin
 * so the entry is traceable back to the exact Copilot turn and so repeated
 * imports collide intentionally.
 */
export function synthesizeRequestId(
    sessionId: string,
    turnIndex: number,
): RequestId {
    return { requestId: `copilot:${sessionId}:${turnIndex}` };
}

export function synthesizeDisplayLog(
    sessionId: string,
    turns: CopilotTurnRow[],
): DisplayLogEntry[] {
    const entries: DisplayLogEntry[] = [];
    let seq = 0;
    let lastTimestamp = 0;

    // Copilot guarantees contiguous 0-based turn_index, but sort defensively
    // in case a future schema or partial read delivers them out of order.
    const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);

    for (const turn of ordered) {
        const timestamp = toEpochMs(turn.timestamp, lastTimestamp);
        lastTimestamp = timestamp;
        const requestId = synthesizeRequestId(sessionId, turn.turnIndex);

        entries.push({
            type: "user-request",
            seq: seq++,
            timestamp,
            requestId,
            command: turn.userMessage ?? "",
        });

        const message: IAgentMessage = {
            message: {
                type: "markdown",
                content: turn.assistantResponse ?? "",
            },
            requestId,
            source: COPILOT_SOURCE,
        };

        entries.push({
            type: "set-display",
            seq: seq++,
            timestamp,
            message,
        });
    }

    return entries;
}

/**
 * Convert a Copilot ISO timestamp to epoch milliseconds. Copilot stores a
 * non-null ISO string, but fall back to the previous entry's timestamp (then
 * 0) on an unparseable value so output stays deterministic and monotonic.
 */
function toEpochMs(iso: string | null | undefined, fallback: number): number {
    if (iso) {
        const parsed = Date.parse(iso);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return fallback;
}
