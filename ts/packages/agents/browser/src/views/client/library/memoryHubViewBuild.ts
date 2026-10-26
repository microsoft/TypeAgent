// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryEvent,
    ViewBuildBounds,
    ViewBuildRequest,
    ViewKind,
    ViewVersion,
} from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import { viewTimestamp } from "./memoryHubViewUi";

export type ReadyViewSource = {
    sourceId: string;
    revisionId: string;
    title: string;
};
type SourceInput = { sourceId: string; revisionId: string };

export async function readViewSourceText(
    corpusId: string,
    source: SourceInput,
): Promise<string> {
    let content = "";
    let offset = 0;
    do {
        const page = await invokeMemory("memoryGetSourceContent", {
            corpusId,
            ...source,
            offset,
            maxChars: Math.min(100000, 120000 - offset),
        });
        if (page.revisionId !== source.revisionId)
            throw new Error("Evidence revision changed; select sources again");
        if (
            page.totalChars > 120000 ||
            content.length + page.content.length > 120000
        )
            throw new Error(
                "Timeline record inspection exceeds the supported text bound; use smaller sources",
            );
        content += page.content;
        if (!page.truncated) return content;
        if (
            page.nextOffset === undefined ||
            page.nextOffset !== content.length ||
            page.nextOffset <= offset ||
            page.nextOffset >= 120000
        )
            throw new Error(
                "Source content paging did not advance within the supported text bound",
            );
        offset = page.nextOffset;
    } while (true);
}

export async function listReadyViewSources(
    corpusId: string,
): Promise<ReadyViewSource[]> {
    const sources: ReadyViewSource[] = [];
    let continuationToken: string | undefined;
    do {
        const page = await invokeMemory("memoryListSources", {
            corpusId,
            pageSize: 200,
            ...(continuationToken ? { continuationToken } : {}),
        });
        for (const source of page.items) {
            const revision = source.revisions.find(
                (entry) => entry.revisionId === source.activeRevisionId,
            );
            if (revision?.state === "ready")
                sources.push({
                    sourceId: source.sourceId,
                    revisionId: source.activeRevisionId,
                    title: source.title,
                });
        }
        continuationToken = page.nextContinuationToken;
    } while (continuationToken && sources.length < 1000);
    if (continuationToken)
        throw new Error(
            "Source selection exceeds 1000 ready sources; use a bounded corpus",
        );
    return sources;
}

export async function listViewTimelineEvents(
    corpusId: string,
): Promise<MemoryEvent[]> {
    const events: MemoryEvent[] = [];
    let continuationToken: string | undefined;
    do {
        const page = await invokeMemory("memoryListEvents", {
            corpusId,
            pageSize: 200,
            ...(continuationToken ? { continuationToken } : {}),
        });
        events.push(...page.items);
        continuationToken = page.nextContinuationToken;
    } while (continuationToken && events.length < 1000);
    if (continuationToken)
        throw new Error(
            "Event selection exceeds 1000 records; use a bounded corpus",
        );
    return events;
}

export function viewBuildBounds(
    learnedBefore: string,
    occurredFrom: string,
    occurredTo: string,
    timeline: boolean,
): ViewBuildBounds {
    const bounds = {
        learnedBefore: viewTimestamp(learnedBefore),
        occurredFrom: timeline ? viewTimestamp(occurredFrom) : undefined,
        occurredTo: timeline ? viewTimestamp(occurredTo) : undefined,
    };
    if (
        bounds.occurredFrom &&
        bounds.occurredTo &&
        bounds.occurredFrom > bounds.occurredTo
    )
        throw new Error(
            "Occurrence start must be before or equal to occurrence end",
        );
    return bounds;
}

function schemaBuildDefinition(rebuilding?: ViewVersion) {
    return rebuilding?.definition.schemaView
        ? { schemaView: rebuilding.definition.schemaView }
        : {};
}

export function createViewBuildTargets(
    kinds: Iterable<ViewKind>,
    ids: Map<ViewKind, string>,
    sources: SourceInput[],
    timelineSources: SourceInput[],
    events: Iterable<string>,
    rebuilding?: ViewVersion,
    projectQuery?: string,
    projectSources: SourceInput[] = sources,
): ViewBuildRequest["targets"] {
    const selectedKinds = [...kinds];
    if (
        selectedKinds.includes("schemaView") &&
        !rebuilding?.definition.schemaView
    )
        throw new Error(
            "Schema-defined views require an approved definition from Questions.",
        );
    if (selectedKinds.includes("wiki") && !rebuilding?.definition.wiki)
        throw new Error(
            "Wiki pages are created by the indexed informational family",
        );
    const eventInputs = [...events].map((eventId) => ({ eventId }));
    return selectedKinds.map((kind) => {
        if (
            kind === "projectBrief" &&
            !rebuilding?.definition.projectSummary &&
            !projectQuery?.trim()
        )
            throw new Error("A project summary requires a project query");
        const inputs =
            kind === "timeline"
                ? timelineSources
                : kind === "projectBrief"
                  ? projectSources
                  : sources;
        const count =
            inputs.length + (kind === "timeline" ? eventInputs.length : 0);
        if (!count && kind !== "projectBrief")
            throw new Error(`${kind} has no compatible evidence`);
        if (count > 32)
            throw new Error(
                `${kind} accepts at most 32 combined sources and events`,
            );
        const viewId = rebuilding?.viewId ?? ids.get(kind);
        if (!viewId)
            throw new Error(
                "The selected view type has no stable target identity",
            );
        return {
            expectedVersion: rebuilding?.version ?? 0,
            definition: {
                viewId,
                kind,
                selector:
                    kind === "timeline"
                        ? {
                              kind: "timelineEvidence",
                              sources: inputs,
                              events: eventInputs,
                          }
                        : { kind: "sources", sources: inputs },
                ...(rebuilding?.definition.maintenance
                    ? { maintenance: rebuilding.definition.maintenance }
                    : {}),
                ...(rebuilding?.definition.wiki
                    ? { wiki: rebuilding.definition.wiki }
                    : {}),
                ...schemaBuildDefinition(rebuilding),
                ...(rebuilding?.definition.projectSummary
                    ? { projectSummary: rebuilding.definition.projectSummary }
                    : kind === "projectBrief"
                      ? {
                            projectSummary: {
                                construction:
                                    "informational-project-summary-v1" as const,
                                query: projectQuery!.trim(),
                                aliases: [],
                                excludedSourceIds: [],
                            },
                        }
                      : {}),
            },
        };
    });
}
