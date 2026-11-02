// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { ViewReadRequest, ViewVersion } from "./viewTypes.js";

export const viewDetailPageChars = 256 * 1024;
export const viewDetailMaxChars = 32 * 1024 * 1024;

export type ViewDetailProjection = "complete" | "presentation";

export interface ViewDetailReadRequest extends ViewReadRequest {
    projection?: ViewDetailProjection | undefined;
}

export interface ViewDetailPageRequest extends ViewDetailReadRequest {
    offset?: number | undefined;
    digest?: string | undefined;
}

export interface ViewDetailPage {
    corpusId: string;
    viewId: string;
    revisionId: string;
    projection: ViewDetailProjection;
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
    const projection = request.projection ?? "complete";
    if (!["complete", "presentation"].includes(projection))
        throw new Error("Unsupported view detail projection");
    let detail = view;
    if (projection === "presentation" && view.generation?.input) {
        const generation = { ...view.generation };
        delete generation.input;
        detail = { ...view, generation };
    }
    const serialized = JSON.stringify(detail);
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
        projection,
        digest,
        offset,
        totalChars: serialized.length,
        text,
        ...(nextOffset < serialized.length ? { nextOffset } : {}),
    };
}
