// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { z } from "zod";
import type {
    MemoryService,
    MemoryViewService,
    ViewVersion,
} from "@typeagent/memory-service";
import type {
    DerivedViewUsage,
    MemoryHubFunctions,
    ViewSourceUsageRequest,
    ViewSourceUsagePage,
} from "@typeagent/browser-control-rpc/viewRpc";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";

const cursorSchema = z.strictObject({
    version: z.literal(1),
    corpusId: z.string(),
    sourceId: z.string(),
    fingerprint: z.string(),
    offset: z.number().int().positive(),
});

function included(version: ViewVersion, sourceId: string): boolean {
    return (
        version.definition.selector.sources.some(
            (source) => source.sourceId === sourceId,
        ) ||
        version.content.citations.some(
            (citation) =>
                !("evidence" in citation && citation.evidence) &&
                citation.sourceId === sourceId,
        )
    );
}

async function sourceViewUsage(
    service: MemoryService & Partial<MemoryViewService>,
    request: ViewSourceUsageRequest,
): Promise<ViewSourceUsagePage> {
    const pageSize = request.pageSize ?? 20;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
        throw new Error(
            "Source View usage page size must be between 1 and 1000",
        );
    if (!(await service.getCapabilities()).derivedViews?.history)
        throw new Error(
            "Source View usage is unavailable in this Memory service",
        );
    const source = await service.getSource(request.corpusId, request.sourceId);
    if (
        !source ||
        source.corpusId !== request.corpusId ||
        source.sourceId !== request.sourceId
    )
        throw new Error(
            "Source was forgotten or is unavailable in the selected corpus",
        );
    const views = createMemoryServiceRpcFacade(service);
    const snapshot = await views.listViews(request.corpusId);
    const items: DerivedViewUsage[] = [];
    for (const current of snapshot.views) {
        for (const entry of await views.getViewHistory({
            corpusId: request.corpusId,
            viewId: current.viewId,
        })) {
            const version = entry.version;
            if (!included(version, request.sourceId)) continue;
            items.push({
                corpusId: request.corpusId,
                viewId: version.viewId,
                kind: version.content.kind,
                title: version.content.title,
                revisionId: version.revisionId,
                version: version.version,
                state:
                    version.revisionId === current.revisionId
                        ? "current"
                        : "historical",
                sectionIds: [
                    ...new Set(
                        version.relationships.flatMap((edge) =>
                            edge.from.kind === "section" &&
                            edge.to.kind === "source" &&
                            !edge.to.evidence &&
                            edge.to.sourceId === request.sourceId
                                ? [edge.from.sectionId]
                                : [],
                        ),
                    ),
                ],
                reason: `${version.state}; ${version.provenance}`,
            });
        }
    }
    for (const job of await views.listViewBuilds(request.corpusId)) {
        for (const target of job.results) {
            if (
                !target.snapshot.definition.selector.sources.some(
                    (selected) => selected.sourceId === request.sourceId,
                )
            )
                continue;
            items.push({
                corpusId: request.corpusId,
                viewId: target.viewId,
                kind: target.snapshot.definition.kind,
                title: target.viewId,
                jobId: job.jobId,
                ...(target.conflictId ? { conflictId: target.conflictId } : {}),
                state: target.conflictId ? "conflict" : "build",
                sectionIds: [],
                reason: `${target.state}: ${target.reason}`,
            });
        }
    }
    items.sort((left, right) =>
        JSON.stringify([
            left.viewId,
            left.revisionId ?? "",
            left.jobId ?? "",
        ]).localeCompare(
            JSON.stringify([
                right.viewId,
                right.revisionId ?? "",
                right.jobId ?? "",
            ]),
        ),
    );
    return usagePage(request, items, pageSize);
}

function usagePage(
    request: ViewSourceUsageRequest,
    items: DerivedViewUsage[],
    pageSize: number,
): ViewSourceUsagePage {
    const fingerprint = createHash("sha256")
        .update(JSON.stringify(items))
        .digest("hex");
    let offset = 0;
    if (request.continuationToken !== undefined) {
        let cursor: z.infer<typeof cursorSchema>;
        try {
            cursor = cursorSchema.parse(
                JSON.parse(
                    Buffer.from(
                        request.continuationToken,
                        "base64url",
                    ).toString("utf8"),
                ),
            );
        } catch {
            throw new Error("Invalid source View usage page token");
        }
        if (
            cursor.corpusId !== request.corpusId ||
            cursor.sourceId !== request.sourceId ||
            cursor.fingerprint !== fingerprint ||
            cursor.offset >= items.length
        )
            throw new Error(
                "Source View usage changed or its page token belongs to another scope; restart paging",
            );
        offset = cursor.offset;
    }
    const nextOffset = offset + pageSize;
    return {
        items: items.slice(offset, nextOffset),
        total: items.length,
        ...(nextOffset < items.length
            ? {
                  nextContinuationToken: Buffer.from(
                      JSON.stringify({
                          version: 1,
                          corpusId: request.corpusId,
                          sourceId: request.sourceId,
                          fingerprint,
                          offset: nextOffset,
                      }),
                  ).toString("base64url"),
              }
            : {}),
    };
}

export function createMemoryHubViewUsageFunctions(
    getService: () => MemoryService & Partial<MemoryViewService>,
): Pick<MemoryHubFunctions, "memoryHubViewUsedBy"> {
    return {
        memoryHubViewUsedBy: (request) =>
            sourceViewUsage(getService(), request),
    };
}
