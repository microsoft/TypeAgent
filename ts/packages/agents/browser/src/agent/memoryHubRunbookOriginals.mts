// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryService,
    PersonalHowToService,
    ProcedureSourceCitation,
    ProcedureVersion,
} from "@typeagent/memory-service";
import type {
    RunbookOriginal,
    RunbookLocator,
    RunbookStaleComparison,
} from "@typeagent/browser-control-rpc/viewRpc";
import { timed } from "./memoryHubQuery.mjs";
import { listRunbookAssets } from "./memoryHubRunbookAssets.mjs";

export function runbookLocator(
    locator: string | undefined,
    totalChars: number,
): RunbookLocator | undefined {
    if (!locator) return undefined;
    const match = /^(?:characters|chars):(\d+)[:-](\d+)$/.exec(locator);
    if (!match) return undefined;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > totalChars
    ) {
        throw new Error(
            "Retained evidence character locator is outside its revision",
        );
    }
    return { kind: "characters", start, end };
}

export async function loadRunbookOriginal(
    service: MemoryService,
    corpusId: string,
    citation: ProcedureSourceCitation,
    offset?: number,
): Promise<RunbookOriginal> {
    try {
        const source = await timed(
            service.getSource(corpusId, citation.sourceId),
        );
        if (!source) throw new Error("Source was forgotten or is unavailable");
        if (
            !source.revisions.some(
                (revision) =>
                    revision.revisionId === citation.revisionId &&
                    revision.state !== "deleted",
            )
        ) {
            throw new Error("Exact retained source revision is unavailable");
        }
        let content = await timed(
            service.getSourceContent({
                corpusId,
                sourceId: citation.sourceId,
                revisionId: citation.revisionId,
                maxChars: 12_000,
                ...(offset === undefined ? {} : { offset }),
            }),
        );
        if (content.revisionId !== citation.revisionId)
            throw new Error(
                "Original evidence resolved a different source revision",
            );
        const location = runbookLocator(citation.locator, content.totalChars);
        if (
            offset === undefined &&
            location &&
            location.start >= content.offset + content.content.length
        ) {
            content = await timed(
                service.getSourceContent({
                    corpusId,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    maxChars: 12_000,
                    offset: location.start,
                }),
            );
            if (content.revisionId !== citation.revisionId)
                throw new Error(
                    "Original evidence resolved a different source revision",
                );
        }
        const assets = await listRunbookAssets(
            service,
            corpusId,
            citation.sourceId,
            citation.revisionId,
        );
        return {
            citation,
            title: source.title,
            available: true,
            content: content.content,
            offset: content.offset,
            totalChars: content.totalChars,
            ...(content.nextOffset === undefined
                ? {}
                : { nextOffset: content.nextOffset }),
            ...(location === undefined ? {} : { location }),
            ...assets,
        };
    } catch (error) {
        return {
            citation,
            title: citation.sourceId,
            available: false,
            content: "",
            offset: offset ?? 0,
            totalChars: 0,
            assets: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function runbookOriginals(
    service: MemoryService,
    corpusId: string,
    citations: readonly ProcedureSourceCitation[],
): Promise<RunbookOriginal[]> {
    const results: RunbookOriginal[] = [];
    for (let index = 0; index < citations.length; index += 4) {
        results.push(
            ...(await Promise.all(
                citations
                    .slice(index, index + 4)
                    .map((citation) =>
                        loadRunbookOriginal(service, corpusId, citation),
                    ),
            )),
        );
    }
    return results;
}

export async function runbookHistory(
    service: PersonalHowToService,
    corpusId: string,
    procedureId: string,
    beforeVersion?: number,
    pageSize = 20,
) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new Error("Runbook history page size must be between 1 and 100");
    const latest = await timed(service.getProcedure(corpusId, procedureId));
    if (!latest) throw new Error("Procedure is unavailable");
    if (
        beforeVersion !== undefined &&
        (!Number.isInteger(beforeVersion) ||
            beforeVersion < 1 ||
            beforeVersion > latest.version + 1)
    ) {
        throw new Error("Invalid runbook history version cursor");
    }
    const first = (beforeVersion ?? latest.version + 1) - 1;
    const last = Math.max(1, first - pageSize + 1);
    const items: ProcedureVersion[] = [];
    for (let version = first; version >= last; version--) {
        const entry =
            version === latest.version
                ? latest
                : await timed(
                      service.getProcedure(corpusId, procedureId, version),
                  );
        if (!entry)
            throw new Error(`Procedure version ${version} is unavailable`);
        items.push(entry);
    }
    return {
        items,
        total: latest.version,
        ...(last > 1 ? { nextContinuationToken: String(last) } : {}),
    };
}

export async function compareRunbook(
    service: MemoryService & PersonalHowToService,
    corpusId: string,
    procedureId: string,
    version: number,
): Promise<RunbookStaleComparison> {
    const current = await timed(
        service.getProcedure(corpusId, procedureId, version),
    );
    if (!current) throw new Error("Selected procedure version is unavailable");
    const previous = await runbookOriginals(
        service,
        corpusId,
        current.document.citations,
    );
    const updated = await Promise.all(
        current.document.citations.map(
            async (citation): Promise<RunbookOriginal> => {
                const source = await timed(
                    service.getSource(corpusId, citation.sourceId),
                );
                if (!source)
                    return loadRunbookOriginal(service, corpusId, citation);
                return loadRunbookOriginal(service, corpusId, {
                    sourceId: citation.sourceId,
                    revisionId: source.activeRevisionId,
                });
            },
        ),
    );
    const changed = new Set(
        previous
            .filter(
                (original, index) =>
                    !original.available ||
                    !updated[index].available ||
                    original.citation.revisionId !==
                        updated[index].citation.revisionId,
            )
            .map((original) => original.citation.sourceId),
    );
    const affectedSteps = (current.document.agentEdition?.steps ?? [])
        .filter((step) => {
            const citations = step.citations.length
                ? step.citations
                : current.document.citations;
            return citations.some((citation) => changed.has(citation.sourceId));
        })
        .map((step) => ({
            stepId: step.id,
            reasons: [
                "Cited original changed or is unavailable; review this step against retained and current evidence.",
            ],
        }));
    return {
        previous,
        updated,
        current,
        affectedSteps,
        warnings: [...previous, ...updated]
            .filter((original) => !original.available)
            .map(
                (original) =>
                    `${original.citation.sourceId}@${original.citation.revisionId}: ${original.error}`,
            ),
    };
}
