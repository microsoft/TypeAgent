// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RequestId } from "@typeagent/dispatcher-types";

/**
 * Coerce a RequestId (server-side `{requestId, clientRequestId}` shape) or
 * already-string identifier down to the plain client request id used
 * throughout the webview. Returns undefined if no usable id is present.
 *
 * The webview never deals in `RequestId` objects — every outgoing bridge
 * message normalizes through this helper so `main.ts` can use plain string
 * comparisons / map keys.
 */
export function clientIdOf(
    rid: RequestId | string | undefined,
): string | undefined {
    if (rid === undefined || rid === null) return undefined;
    if (typeof rid === "string") return rid;
    return (rid as { clientRequestId?: string }).clientRequestId;
}
