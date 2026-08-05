// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EvaluatedQueryRecord } from "../query/index.js";

export function renderPacketRecord(
    record: EvaluatedQueryRecord,
    detail: "cards" | "snippets" | "full",
    citation: string,
): string {
    const title = `${citation} ${label(record.entityKind)}: ${record.title} (rev ${record.revision})`;
    const content = normalizeWhitespace(record.content);
    if (detail === "snippets") {
        return `${title} - ${truncate(content, 240)}`;
    }
    const state = record.fields.state;
    const metadata = [
        typeof state === "string" ? `state=${state}` : undefined,
        `occurred=${record.occurredAt}`,
    ].filter((value): value is string => value !== undefined);
    if (detail === "cards") {
        return [title, content, metadata.join("; ")].join("\n");
    }
    const fields = Object.entries(record.fields)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    const evidence = record.evidence.map((item) => ({
        clauseId: item.clauseId,
        channels: item.channels,
        quality: item.quality,
        references: item.references,
    }));
    return [
        title,
        content,
        metadata.join("; "),
        `fields=${JSON.stringify(Object.fromEntries(fields))}`,
        `evidence=${JSON.stringify(evidence)}`,
    ].join("\n");
}

export function renderFacetSummary(
    facetKind: string,
    summary: string,
    sourceWatermark: number,
    citation: string,
): string {
    return `${citation} ${label(facetKind)} summary through sequence ${sourceWatermark}\n${normalizeWhitespace(summary)}`;
}

function label(kind: string): string {
    const labels: Readonly<Record<string, string>> = {
        topic: "Topic",
        turn: "Turn",
        action: "Action",
        term: "Term",
        artifact: "Artifact",
        artifactChange: "Artifact change",
        goal: "Goal",
        designNote: "Design note",
        output: "Output",
        property: "Property",
        memory: "Memory",
    };
    return labels[kind] ?? kind;
}

function normalizeWhitespace(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

function truncate(value: string, maximumLength: number): string {
    if (value.length <= maximumLength) {
        return value;
    }
    const prefix = value.slice(0, maximumLength - 1);
    const boundary = prefix.lastIndexOf(" ");
    return `${prefix.slice(0, boundary > maximumLength / 2 ? boundary : prefix.length)}...`;
}
