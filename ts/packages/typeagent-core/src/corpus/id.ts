// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

/**
 * Compute a stable corpus entry id from its identifying tuple.
 *
 * The id is the first 16 hex chars of SHA-256 over
 * `${utterance}|${agent}|${requestId ?? ""}`. Two captures of the same
 * utterance for the same agent with different requestIds are distinct
 * entries; without a requestId, repeated captures collapse to the same id
 * (which is intentional — bulk imports of plain utterance lists dedupe).
 */
export function computeEntryId(
    utterance: string,
    agent: string,
    requestId?: string,
): string {
    const h = createHash("sha256");
    h.update(utterance);
    h.update("|");
    h.update(agent);
    h.update("|");
    h.update(requestId ?? "");
    return h.digest("hex").slice(0, 16);
}
