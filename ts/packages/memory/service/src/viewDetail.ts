// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { ViewReadRequest, ViewVersion } from "./viewTypes.js";

export const viewDetailPageChars = 256 * 1024;
export const viewDetailMaxChars = 32 * 1024 * 1024;

export interface ViewDetailPageRequest extends ViewReadRequest {
    offset?: number | undefined;
    digest?: string | undefined;
}

export interface ViewDetailPage {
    corpusId: string;
    viewId: string;
    revisionId: string;
    digest: string;
    offset: number;
    totalChars: number;
    text: string;
    nextOffset?: number | undefined;
}

export function viewDetailPage(
    view: ViewVersion,
    request: ViewDetailPageRequest,
): ViewDetailPage {
    const offset = request.offset ?? 0;
    if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        (offset > 0 && (!request.revisionId || !request.digest))
    )
        throw new Error(
            "View detail continuation requires a pinned revision and digest",
        );
    const serialized = JSON.stringify(view);
    if (serialized.length > viewDetailMaxChars)
        throw new Error(
            "View detail exceeds the complete-read character bound",
        );
    const digest = createHash("sha256").update(serialized).digest("hex");
    if (
        offset >= serialized.length ||
        (request.digest !== undefined && request.digest !== digest)
    )
        throw new Error(
            "View detail changed or continuation is invalid; restart the read",
        );
    const text = serialized.slice(offset, offset + viewDetailPageChars);
    const nextOffset = offset + text.length;
    return {
        corpusId: view.corpusId,
        viewId: view.viewId,
        revisionId: view.revisionId,
        digest,
        offset,
        totalChars: serialized.length,
        text,
        ...(nextOffset < serialized.length ? { nextOffset } : {}),
    };
}
