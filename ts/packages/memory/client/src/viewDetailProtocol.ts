// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { z } from "zod";
import {
    viewDetailMaxChars,
    viewDetailPageChars,
    type ViewDetailPage,
    type ViewDetailPageRequest,
    type ViewReadRequest,
    type ViewVersion,
} from "@typeagent/memory-service";
import { viewReadRequestSchema, viewVersionSchema } from "./viewProtocol.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const viewDetailPageRequestSchema = viewReadRequestSchema
    .extend({
        offset: z.number().int().min(0).max(viewDetailMaxChars).optional(),
        digest: digest.optional(),
    })
    .refine(
        (request) =>
            !request.offset || !!(request.revisionId && request.digest),
        "Continuation requires a pinned revision and digest",
    );
export const viewDetailPageSchema = z.strictObject({
    corpusId: z.string().min(1),
    viewId: z.string().min(1),
    revisionId: z.string().min(1),
    digest,
    offset: z.number().int().min(0).max(viewDetailMaxChars),
    totalChars: z.number().int().min(1).max(viewDetailMaxChars),
    text: z.string().min(1).max(viewDetailPageChars),
    nextOffset: z.number().int().min(1).max(viewDetailMaxChars).optional(),
});

export async function readViewDetail(
    service: {
        getViewDetailPage?(
            request: ViewDetailPageRequest,
        ): Promise<ViewDetailPage | undefined>;
    },
    request: ViewReadRequest,
): Promise<ViewVersion | undefined> {
    if (!service.getViewDetailPage)
        throw new Error(
            "Connected memory service does not support paged view details",
        );
    const chunks: string[] = [];
    let pinned: z.infer<typeof viewDetailPageSchema> | undefined;
    let offset = 0;
    for (;;) {
        const raw = await service.getViewDetailPage({
            ...request,
            ...(pinned
                ? { revisionId: pinned.revisionId, digest: pinned.digest }
                : {}),
            offset,
        });
        if (!raw) {
            if (!pinned) return undefined;
            throw new Error(
                "Pinned view detail became unavailable during pagination",
            );
        }
        const page = viewDetailPageSchema.parse(raw);
        if (
            page.corpusId !== request.corpusId ||
            page.viewId !== request.viewId ||
            (request.revisionId && page.revisionId !== request.revisionId) ||
            page.offset !== offset ||
            (pinned &&
                (page.revisionId !== pinned.revisionId ||
                    page.digest !== pinned.digest ||
                    page.totalChars !== pinned.totalChars))
        )
            throw new Error("View detail page does not match the pinned read");
        const end = offset + page.text.length;
        if (
            (end < page.totalChars &&
                page.text.length !== viewDetailPageChars) ||
            end > page.totalChars ||
            (end < page.totalChars
                ? page.nextOffset !== end
                : page.nextOffset !== undefined)
        )
            throw new Error(
                "View detail page is incomplete or has an invalid continuation",
            );
        chunks.push(page.text);
        pinned = page;
        if (page.nextOffset === undefined) break;
        offset = page.nextOffset;
    }
    if (!pinned) throw new Error("Complete view detail was not received");
    const text = chunks.join("");
    if (createHash("sha256").update(text).digest("hex") !== pinned.digest)
        throw new Error("Complete view detail digest mismatch");
    const view = viewVersionSchema.parse(JSON.parse(text));
    if (
        view.corpusId !== pinned.corpusId ||
        view.viewId !== pinned.viewId ||
        view.revisionId !== pinned.revisionId
    )
        throw new Error("Complete view detail identity mismatch");
    return view as ViewVersion;
}
