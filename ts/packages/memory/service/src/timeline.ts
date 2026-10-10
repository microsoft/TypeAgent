// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryEvent } from "./types.js";
import type {
    TimelineContent,
    TimelineEvidenceRecord,
    TimelineRecord,
    ViewBuildBounds,
    ViewBuildSnapshot,
    ViewCitation,
    ViewRetainedInput,
    ViewRelationshipInput,
    ViewFactInventory,
} from "./viewTypes.js";
import { viewHash } from "./viewMerge.js";
import { factStatuses } from "./viewInventory.js";
import { viewSourceKey } from "./viewContent.js";
import { scanMarkdownStructure } from "./procedureDetector.js";

export function timelineTimestamp(value: unknown): string {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            value,
        ) ||
        !Number.isFinite(Date.parse(value))
    )
        throw new Error(
            "Timeline timestamps require valid explicit-timezone ISO timestamps",
        );
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > days)
        throw new Error("Invalid timeline calendar date");
    if (
        Number(value.slice(11, 13)) > 23 ||
        Number(value.slice(14, 16)) > 59 ||
        (value[16] === ":" && Number(value.slice(17, 19)) > 59)
    )
        throw new Error("Invalid timeline clock time");
    return new Date(value).toISOString();
}

function optionalTimestamp(value: string | undefined): string | null {
    return value === undefined || value === "unknown"
        ? null
        : timelineTimestamp(value);
}

export function timelineEligible(
    details: TimelineEvidenceRecord["details"],
    bounds: ViewBuildBounds,
): boolean {
    return (
        (!bounds.learnedBefore ||
            (details.learnedAt !== null &&
                details.learnedAt <=
                    timelineTimestamp(bounds.learnedBefore))) &&
        (!bounds.occurredFrom ||
            (details.occurredAt !== null &&
                details.occurredAt >=
                    timelineTimestamp(bounds.occurredFrom))) &&
        (!bounds.occurredTo ||
            (details.occurredAt !== null &&
                details.occurredAt <= timelineTimestamp(bounds.occurredTo)))
    );
}

function explicitField(content: string, label: string): string | undefined {
    const matches = scanMarkdownStructure(content).lines.filter(
        (line) => !line.fenced && line.text.startsWith(`${label}:`),
    );
    if (matches.length > 1)
        throw new Error(`Duplicate timeline record ${label}`);
    return matches[0]?.text.slice(label.length + 1).trim();
}

export function timelineDocumentInput(
    source: {
        sourceId: string;
        revisionId: string;
        title: string;
        content: string;
        capturedAt?: string | undefined;
    },
    bounds: ViewBuildBounds,
): ViewRetainedInput {
    const structure = scanMarkdownStructure(source.content);
    const headings = structure.headings.flatMap((heading) => {
        const line = structure.lines[heading.line];
        const match =
            /^## Record ([A-Za-z0-9][A-Za-z0-9._:-]{0,199})[ \t]*$/.exec(
                line.text,
            );
        return match ? [{ sourceRecordId: match[1], start: line.start }] : [];
    });
    if (!headings.length)
        throw new Error(
            "Timeline documents require explicit '## Record <id>' boundaries with Occurred at and Recorded / known at fields; unstructured checkpoint projection is unsupported",
        );
    const identities = new Set<string>();
    const records: TimelineEvidenceRecord[] = [];
    for (let index = 0; index < headings.length; index++) {
        const heading = headings[index];
        const sourceRecordId = heading.sourceRecordId;
        if (identities.has(sourceRecordId))
            throw new Error("Duplicate document timeline record ID");
        identities.add(sourceRecordId);
        const start = heading.start;
        const end = headings[index + 1]?.start ?? source.content.length;
        const excerpt = source.content.slice(start, end);
        const stateText = explicitField(excerpt, "State") ?? "unknown";
        const state = factStatuses.find((entry) => entry === stateText);
        if (!state)
            throw new Error("Unsupported explicit timeline record state");
        const details: TimelineEvidenceRecord["details"] = {
            kind: "event",
            identity: {
                kind: "documentRecord",
                sourceId: source.sourceId,
                sourceRecordId,
            },
            eventType: explicitField(excerpt, "Classification") ?? "unknown",
            state,
            outcome: explicitField(excerpt, "Outcome") ?? null,
            occurredAt: optionalTimestamp(
                explicitField(excerpt, "Occurred at"),
            ),
            learnedAt: optionalTimestamp(
                explicitField(excerpt, "Recorded / known at"),
            ),
            capturedAt: optionalTimestamp(source.capturedAt),
        };
        if (timelineEligible(details, bounds))
            records.push({
                id: `record:${viewHash([source.sourceId, sourceRecordId]).slice(0, 32)}`,
                details,
                citation: {
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                    locator: `chars:${start}-${end}`,
                    excerpt,
                },
            });
    }
    return {
        sourceId: source.sourceId,
        revisionId: source.revisionId,
        title: source.title,
        content: records.map((record) => record.citation.excerpt).join("\n"),
        contentHash: viewHash(source.content),
        passages: records.map((record) => record.citation),
        records,
    };
}

export function timelineEventInput(
    event: MemoryEvent,
    bounds: ViewBuildBounds,
): ViewRetainedInput {
    const stateText = event.metadata?.state ?? "unknown";
    const state = factStatuses.find((entry) => entry === stateText);
    if (
        !state ||
        (event.metadata?.outcome !== undefined &&
            typeof event.metadata.outcome !== "string")
    )
        throw new Error(
            "Canonical event timeline state/outcome metadata is unsupported",
        );
    const details: TimelineEvidenceRecord["details"] = {
        kind: "event",
        identity: { kind: "canonicalEvent", eventId: event.eventId },
        eventType: event.eventType,
        state,
        outcome:
            typeof event.metadata?.outcome === "string"
                ? event.metadata.outcome
                : null,
        occurredAt: timelineTimestamp(event.eventTime),
        learnedAt: timelineTimestamp(event.observedAt),
        capturedAt: timelineTimestamp(event.createdAt),
    };
    const content = JSON.stringify(event);
    const revisionId = viewHash(event);
    const evidence = { kind: "event" as const, eventId: event.eventId };
    const citation: ViewCitation = {
        sourceId: event.eventId,
        revisionId,
        evidence,
        locator: `chars:0-${content.length}`,
        excerpt: content,
    };
    const records = timelineEligible(details, bounds)
        ? [{ id: event.eventId, details, citation }]
        : [];
    return {
        sourceId: event.eventId,
        revisionId,
        evidence,
        title: event.eventType,
        content: records.length ? content : "",
        contentHash: revisionId,
        passages: records.map((record) => record.citation),
        records,
    };
}

export function orderTimeline(records: TimelineRecord[]): TimelineRecord[] {
    return records.sort(
        (left, right) =>
            (left.details.occurredAt ?? "\uffff").localeCompare(
                right.details.occurredAt ?? "\uffff",
            ) ||
            (left.details.learnedAt ?? "\uffff").localeCompare(
                right.details.learnedAt ?? "\uffff",
            ) ||
            left.id.localeCompare(right.id),
    );
}

export function validateTimeline(content: TimelineContent): void {
    timelineTimestamp(content.generatedAt);
    const identities = new Set<string>();
    for (const record of content.sections) {
        const details = record.details;
        if (record.role !== "event" || details?.kind !== "event")
            throw new Error("Timeline requires structured event records");
        if (
            Object.keys(details).some(
                (key) =>
                    ![
                        "kind",
                        "identity",
                        "eventType",
                        "state",
                        "outcome",
                        "occurredAt",
                        "learnedAt",
                        "capturedAt",
                        "inventoryIds",
                    ].includes(key),
            )
        )
            throw new Error("Unsupported timeline record metadata");
        if (
            !details.eventType?.trim() ||
            !factStatuses.includes(details.state) ||
            (details.outcome !== null && typeof details.outcome !== "string") ||
            !Array.isArray(details.inventoryIds)
        )
            throw new Error("Invalid timeline record classification");
        for (const time of [
            details.occurredAt,
            details.learnedAt,
            details.capturedAt,
        ])
            if (time !== null) timelineTimestamp(time);
        const identity = details.identity;
        if (
            !identity ||
            !["canonicalEvent", "documentRecord"].includes(identity.kind)
        )
            throw new Error("Invalid timeline record identity");
        const keys =
            identity.kind === "canonicalEvent"
                ? ["kind", "eventId"]
                : ["kind", "sourceId", "sourceRecordId"];
        if (
            Object.keys(identity).some((key) => !keys.includes(key)) ||
            Object.values(identity).some(
                (value) => typeof value !== "string" || !value.trim(),
            )
        )
            throw new Error("Invalid timeline provenance");
        const key = JSON.stringify(identity);
        if (identities.has(key))
            throw new Error("Duplicate timeline record identity");
        identities.add(key);
    }
    if (
        JSON.stringify(content.sections.map((record) => record.id)) !==
        JSON.stringify(
            orderTimeline([...content.sections]).map((record) => record.id),
        )
    )
        throw new Error(
            "Timeline records must use deterministic occurrence/knowledge/identity ordering",
        );
}

export function validateTimelineEvidence(
    input: ViewBuildSnapshot,
    content: TimelineContent,
    inventory?: ViewFactInventory,
): void {
    validateTimeline(content);
    const retained = input.inputs.flatMap((source) => source.records ?? []);
    for (const record of content.sections) {
        const source = retained.find((entry) => entry.id === record.id);
        const { inventoryIds, ...details } = record.details;
        if (
            !source ||
            viewHash(details) !== viewHash(source.details) ||
            !timelineEligible(details, input.bounds)
        )
            throw new Error(
                "Timeline identity, classification or temporal metadata differs from eligible retained record evidence",
            );
        if (
            !content.citations.some(
                (citation) =>
                    viewSourceKey(citation) ===
                        viewSourceKey(source.citation) &&
                    citation.locator === source.citation.locator &&
                    citation.excerpt === source.citation.excerpt,
            )
        )
            throw new Error("Timeline record lacks exact retained evidence");
        if (inventoryIds.some((id) => typeof id !== "string"))
            throw new Error(
                "Timeline inventory references require stable identities",
            );
        if (inventory) {
            for (const id of inventoryIds) {
                const item = inventory.items.find((item) => item.id === id);
                if (
                    !item ||
                    !item.citations.length ||
                    item.citations.some(
                        (citation) =>
                            viewHash(citation) !== viewHash(source.citation),
                    ) ||
                    (item.occurredAt &&
                        timelineTimestamp(item.occurredAt) !==
                            details.occurredAt) ||
                    (item.learnedAt &&
                        timelineTimestamp(item.learnedAt) !== details.learnedAt)
                )
                    throw new Error(
                        "Timeline field inventory provenance or timing differs from its exact retained record",
                    );
            }
        }
    }
}

export function timelineCorrectionSupported(
    from: TimelineEvidenceRecord,
    to: TimelineEvidenceRecord,
    predicate: "corrects" | "supersedes",
): boolean {
    const targetId =
        to.details.identity.kind === "canonicalEvent"
            ? to.details.identity.eventId
            : to.details.identity.sourceRecordId;
    const declaredTarget =
        from.details.identity.kind === "canonicalEvent"
            ? (JSON.parse(from.citation.excerpt) as MemoryEvent).metadata?.[
                  predicate
              ]
            : explicitField(
                  from.citation.excerpt,
                  predicate === "corrects" ? "Corrects" : "Supersedes",
              );
    return (
        declaredTarget === targetId &&
        from.details.identity.kind === to.details.identity.kind &&
        (from.details.identity.kind !== "documentRecord" ||
            (to.details.identity.kind === "documentRecord" &&
                from.details.identity.sourceId ===
                    to.details.identity.sourceId)) &&
        !!from.details.learnedAt &&
        !!to.details.learnedAt &&
        from.details.learnedAt >= to.details.learnedAt
    );
}

export function validateTimelineCorrections(
    input: ViewBuildSnapshot,
    content: TimelineContent,
    edges: ViewRelationshipInput[],
): void {
    const retained = input.inputs.flatMap((source) => source.records ?? []);
    for (const edge of edges) {
        if (edge.predicate !== "corrects" && edge.predicate !== "supersedes")
            continue;
        const from = retained.find(
            (record) => record.id === edge.from.sectionId,
        );
        const target =
            edge.to.kind === "section" ? edge.to.sectionId : undefined;
        const to = retained.find((record) => record.id === target);
        if (
            !from ||
            !to ||
            from.id === to.id ||
            !content.sections.some((record) => record.id === from.id) ||
            !content.sections.some((record) => record.id === to.id) ||
            !timelineCorrectionSupported(from, to, edge.predicate) ||
            edge.citations.some(
                (citation) => viewHash(citation) !== viewHash(from.citation),
            )
        )
            throw new Error(
                "Timeline correction is not grounded to its exact existing records and knowledge ordering",
            );
    }
}
