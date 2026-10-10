// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryService,
    MemoryViewService,
    ViewVersion,
} from "@typeagent/memory-service";
import type { DerivedViewUsage } from "@typeagent/browser-control-rpc/viewRpc";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";

export async function sourceViewUsage(
    service: MemoryService & Partial<MemoryViewService>,
    corpusId: string,
    sourceId: string,
): Promise<DerivedViewUsage[] | undefined> {
    if (!(await service.getCapabilities()).derivedViews?.history)
        return undefined;
    const views = createMemoryServiceRpcFacade(service);
    const snapshot = await views.listViews(corpusId);
    const result: DerivedViewUsage[] = [];
    function included(version: ViewVersion) {
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
    for (const current of snapshot.views) {
        if (current.content.kind === "procedure") continue;
        const history = await views.getViewHistory({
            corpusId,
            viewId: current.viewId,
        });
        for (const entry of history) {
            const version = entry.version;
            if (!included(version) || version.content.kind === "procedure")
                continue;
            result.push({
                corpusId,
                viewId: version.viewId,
                kind: version.content.kind,
                title: version.content.title,
                revisionId: version.revisionId,
                version: version.version,
                state:
                    version.revisionId === current.revisionId
                        ? "current"
                        : "historical",
                sectionIds: version.relationships.flatMap((edge) =>
                    edge.from.kind === "section" &&
                    edge.to.kind === "source" &&
                    !edge.to.evidence &&
                    edge.to.sourceId === sourceId
                        ? [edge.from.sectionId]
                        : [],
                ),
                reason: `${version.state}; ${version.provenance}`,
            });
        }
    }
    for (const job of await views.listViewBuilds(corpusId)) {
        for (const target of job.results) {
            if (
                !target.snapshot.definition.selector.sources.some(
                    (source) => source.sourceId === sourceId,
                )
            )
                continue;
            result.push({
                corpusId,
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
    return result;
}
