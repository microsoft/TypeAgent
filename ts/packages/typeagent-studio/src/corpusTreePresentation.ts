// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusEntry, CorpusSource } from "@typeagent/core/corpus";

/**
 * Pure, vscode-free mapping from federated corpus entries to tree-node
 * descriptors. The VS Code `TreeDataProvider` is a thin adapter over these
 * descriptors so the grouping/labelling logic can be unit-tested without the
 * editor host (mirrors `sandboxTreePresentation.ts`).
 */

export type CorpusTreeNodeKind = "agent" | "source" | "entry" | "empty";

export interface CorpusTreeNode {
    kind: CorpusTreeNodeKind;
    /** Stable identifier, unique across the whole tree. */
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    /** Present on `agent`, `source`, and `entry` nodes. */
    agent?: string;
    /** Present on `source` and `entry` nodes. */
    source?: CorpusSource;
    /** Present on `entry` nodes. */
    entryId?: string;
    /** Whether the node should render as expandable. */
    hasChildren: boolean;
}

/** Fixed display order for federated corpus sources. */
export const CORPUS_SOURCE_ORDER: CorpusSource[] = [
    "in-repo",
    "captures",
    "external",
    "feedback",
];

const MAX_UTTERANCE_LENGTH = 80;

/** Build the top-level rows: one node per agent, or a single placeholder. */
export function buildCorpusAgentNodes(
    agents: readonly string[],
): CorpusTreeNode[] {
    if (agents.length === 0) {
        return [
            {
                kind: "empty",
                id: "corpus:empty",
                label: "No corpora available",
                description: "Load an agent into a sandbox",
                tooltip:
                    "Corpora are listed per agent loaded into a running sandbox.",
                hasChildren: false,
            },
        ];
    }

    return [...agents]
        .sort((a, b) => a.localeCompare(b))
        .map((agent) => ({
            kind: "agent" as const,
            id: `corpus:agent:${agent}`,
            label: agent,
            contextValue: "corpusAgent",
            agent,
            hasChildren: true,
        }));
}

/** Build the per-source group rows beneath a single agent. */
export function buildCorpusSourceNodes(
    agent: string,
    entries: readonly CorpusEntry[],
): CorpusTreeNode[] {
    const counts = countBySource(entries);
    const present = CORPUS_SOURCE_ORDER.filter(
        (source) => (counts.get(source) ?? 0) > 0,
    );

    if (present.length === 0) {
        return [
            {
                kind: "empty",
                id: `corpus:agent:${agent}:empty`,
                label: "Seed in-repo corpus\u2026",
                description: "No entries yet — click to create a corpus file",
                tooltip: `Click to create corpus/${agent}.utterances.jsonl and open it so you can add labelled utterances for ${agent}.`,
                contextValue: "corpusAgentSeed",
                agent,
                hasChildren: false,
            },
        ];
    }

    return present.map((source) => {
        const count = counts.get(source) ?? 0;
        return {
            kind: "source" as const,
            id: `corpus:agent:${agent}:source:${source}`,
            label: formatCorpusSource(source),
            description: `${count} entr${count === 1 ? "y" : "ies"}`,
            contextValue: "corpusSource",
            agent,
            source,
            hasChildren: count > 0,
        };
    });
}

/** Build the entry rows for a single (agent, source) pair. */
export function buildCorpusEntryNodes(
    agent: string,
    source: CorpusSource,
    entries: readonly CorpusEntry[],
): CorpusTreeNode[] {
    return entries
        .filter((entry) => entry.source === source)
        .map((entry) => ({
            kind: "entry" as const,
            id: `corpus:entry:${entry.id}`,
            label: truncateUtterance(entry.utterance),
            description: entry.feedback
                ? formatFeedbackBadge(entry.feedback.rating)
                : undefined,
            tooltip: buildEntryTooltip(entry),
            contextValue: "corpusEntry",
            agent,
            source,
            entryId: entry.id,
            hasChildren: false,
        }));
}

export function formatCorpusSource(source: CorpusSource): string {
    switch (source) {
        case "in-repo":
            return "In-repo";
        case "captures":
            return "Captures";
        case "external":
            return "External";
        case "feedback":
            return "Feedback";
        default:
            return source;
    }
}

export function truncateUtterance(utterance: string): string {
    const collapsed = utterance.replace(/\s+/g, " ").trim();
    if (collapsed.length <= MAX_UTTERANCE_LENGTH) {
        return collapsed;
    }
    return `${collapsed.slice(0, MAX_UTTERANCE_LENGTH - 1)}\u2026`;
}

function countBySource(
    entries: readonly CorpusEntry[],
): Map<CorpusSource, number> {
    const counts = new Map<CorpusSource, number>();
    for (const entry of entries) {
        counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
    }
    return counts;
}

function formatFeedbackBadge(rating: string): string {
    return `feedback: ${rating}`;
}

function buildEntryTooltip(entry: CorpusEntry): string {
    const lines = [
        entry.utterance,
        `Agent: ${entry.agent}`,
        `Source: ${formatCorpusSource(entry.source)}`,
        `Origin: ${entry.provenance.sourceUri}`,
    ];
    if (entry.provenance.requestId) {
        lines.push(`Request: ${entry.provenance.requestId}`);
    }
    if (entry.feedback) {
        lines.push(`Feedback: ${entry.feedback.rating}`);
        if (entry.feedback.comment) {
            lines.push(`Comment: ${entry.feedback.comment}`);
        }
    }
    if (entry.tags && entry.tags.length > 0) {
        lines.push(`Tags: ${entry.tags.join(", ")}`);
    }
    return lines.join("\n");
}
