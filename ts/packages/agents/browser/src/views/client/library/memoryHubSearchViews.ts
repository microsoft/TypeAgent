// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryHubEvidence,
    MemoryHubSearchInsights,
} from "@typeagent/browser-control-rpc/viewRpc";
export type { MemoryHubSearchInsights } from "@typeagent/browser-control-rpc/viewRpc";

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEntity(
    value: unknown,
): value is MemoryHubSearchInsights["relatedEntities"][number] {
    return (
        record(value) &&
        typeof value.name === "string" &&
        typeof value.type === "string" &&
        (value.confidence === undefined ||
            (typeof value.confidence === "number" &&
                Number.isFinite(value.confidence) &&
                value.confidence >= 0 &&
                value.confidence <= 1))
    );
}

function isStatus(value: unknown): value is MemoryHubSearchInsights["status"] {
    return (
        value === "available" ||
        value === "unsupported" ||
        value === "unavailable"
    );
}

export function readMemoryHubSearchInsights(
    value: unknown,
): MemoryHubSearchInsights {
    if (
        !record(value) ||
        (value.provider !== "canonical" &&
            value.provider !== "fixedBrowserMemory") ||
        !isStatus(value.status) ||
        (value.corpusId !== undefined && typeof value.corpusId !== "string") ||
        (value.message !== undefined && typeof value.message !== "string") ||
        !Array.isArray(value.topTopics) ||
        !value.topTopics.every(
            (topic): topic is string => typeof topic === "string",
        ) ||
        !Array.isArray(value.relatedEntities) ||
        !value.relatedEntities.every(isEntity)
    )
        throw new Error(
            "Search insights returned an invalid typed metadata response.",
        );
    return {
        provider: value.provider,
        status: value.status,
        corpusId: value.corpusId,
        topTopics: value.topTopics,
        relatedEntities: value.relatedEntities,
        message: value.message,
    };
}

export function isMemoryHubWebEvidence(evidence: MemoryHubEvidence): boolean {
    return evidence.kind === "source" && evidence.sourceType === "web";
}

function groupKey(evidence: MemoryHubEvidence, mode: "timeline" | "domain") {
    if (mode === "timeline") {
        const time = evidence.eventTime
            ? new Date(evidence.eventTime).getTime()
            : NaN;
        return Number.isFinite(time)
            ? new Date(time).toISOString().slice(0, 10)
            : "Date unavailable";
    }
    if (!evidence.canonicalUri) return "Domain unavailable";
    try {
        const uri = new URL(evidence.canonicalUri);
        return uri.protocol === "https:" || uri.protocol === "http:"
            ? uri.hostname
            : "Domain unavailable";
    } catch {
        // Missing or invalid metadata is shown, never guessed from a snippet.
        return "Domain unavailable";
    }
}

export function renderMemoryHubWebGroups(
    matches: MemoryHubEvidence[],
    mode: "timeline" | "domain",
    renderCard: (evidence: MemoryHubEvidence) => HTMLElement,
): HTMLElement[] {
    const groups = new Map<string, MemoryHubEvidence[]>();
    const other = matches.filter(
        (evidence) => !isMemoryHubWebEvidence(evidence),
    );
    for (const evidence of matches.filter(isMemoryHubWebEvidence)) {
        const key = groupKey(evidence, mode);
        const values = groups.get(key) ?? [];
        values.push(evidence);
        groups.set(key, values);
    }
    const unknown =
        mode === "timeline" ? "Date unavailable" : "Domain unavailable";
    const keys = Array.from(groups.keys()).sort((left, right) => {
        if (left === unknown) return 1;
        if (right === unknown) return -1;
        return mode === "timeline"
            ? right.localeCompare(left)
            : left.localeCompare(right);
    });
    function section(title: string, evidence: MemoryHubEvidence[]) {
        const group = document.createElement("section");
        group.className = "phase2-search-group";
        const heading = document.createElement("h3");
        heading.textContent = title;
        const cards = document.createElement("div");
        cards.className = "phase2-group-results";
        cards.append(...evidence.map(renderCard));
        group.append(heading, cards);
        return group;
    }
    const sections = keys.map((key) =>
        section(
            mode === "timeline" && key !== unknown
                ? `${key} (UTC capture date)`
                : key,
            groups.get(key)!,
        ),
    );
    if (other.length)
        sections.push(section("Other memory evidence (List)", other));
    return sections;
}
