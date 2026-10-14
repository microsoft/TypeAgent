// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryService } from "@typeagent/memory-service";
import type {
    MemoryHubFunctions,
    MemoryHubSourceOriginal,
    MemoryHubSourceOriginalRequest,
} from "@typeagent/browser-control-rpc/viewRpc";
import { timed } from "./memoryHubQuerySupport.mjs";

function sourceLocation(
    locator: string | undefined,
    totalChars: number,
): MemoryHubSourceOriginal["location"] {
    if (locator === undefined) return undefined;
    const match = /^(?:characters|chars):(\d+)[:-](\d+)$/.exec(locator);
    if (!match)
        throw new Error("Unsupported retained source character locator");
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > totalChars
    )
        throw new Error(
            "Retained evidence character locator is outside its revision",
        );
    return { kind: "characters", start, end };
}

async function sourceOriginal(
    service: MemoryService,
    request: MemoryHubSourceOriginalRequest,
): Promise<MemoryHubSourceOriginal> {
    try {
        const source = await timed(
            service.getSource(request.corpusId, request.sourceId),
        );
        if (!source) throw new Error("Source was forgotten or is unavailable");
        if (
            !source.revisions.some(
                (revision) =>
                    revision.revisionId === request.revisionId &&
                    revision.state !== "deleted",
            )
        )
            throw new Error("Exact retained source revision is unavailable");
        const read = (offset?: number) =>
            timed(
                service.getSourceContent({
                    corpusId: request.corpusId,
                    sourceId: request.sourceId,
                    revisionId: request.revisionId,
                    maxChars: 12_000,
                    ...(offset === undefined ? {} : { offset }),
                }),
            );
        let content = await read(request.offset);
        if (content.revisionId !== request.revisionId)
            throw new Error(
                "Original evidence resolved a different source revision",
            );
        const location = sourceLocation(request.locator, content.totalChars);
        if (
            request.offset === undefined &&
            location &&
            location.start >= content.offset + content.content.length
        ) {
            content = await read(location.start);
            if (content.revisionId !== request.revisionId)
                throw new Error(
                    "Original evidence resolved a different source revision",
                );
        }
        return {
            available: true,
            title: source.title,
            content: content.content,
            offset: content.offset,
            totalChars: content.totalChars,
            ...(content.nextOffset === undefined
                ? {}
                : { nextOffset: content.nextOffset }),
            ...(location === undefined ? {} : { location }),
        };
    } catch (error) {
        return {
            available: false,
            title: request.sourceId,
            content: "",
            offset: request.offset ?? 0,
            totalChars: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function createMemoryHubSourceOriginalFunctions(
    getService: () => MemoryService,
): Pick<MemoryHubFunctions, "memoryHubSourceOriginal"> {
    return {
        memoryHubSourceOriginal: (request) =>
            sourceOriginal(getService(), request),
    };
}
