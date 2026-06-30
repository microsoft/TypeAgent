// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusEntry, CorpusSource } from "@typeagent/core/corpus";
import type { FeedbackRating } from "@typeagent/core/events";
import { collapseAndTruncate } from "./textFormatting.js";
import {
    noteTooltip,
    type TooltipField,
    type TooltipModel,
} from "./tooltipModel.js";

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
    tooltip?: TooltipModel;
    contextValue?: string;
    /** Present on `agent`, `source`, and `entry` nodes. */
    agent?: string;
    /** Present on `source` and `entry` nodes. */
    source?: CorpusSource;
    /** Present on `entry` nodes. */
    entryId?: string;
    /** Present on `entry` nodes that carry feedback; drives the row icon. */
    feedbackRating?: FeedbackRating;
    /** Whether the node should render as expandable. */
    hasChildren: boolean;
}

/** Fixed display order for federated corpus sources. */
export const CORPUS_SOURCE_ORDER: CorpusSource[] = [
    "in-repo",
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
                tooltip: noteTooltip(
                    "Corpora are listed per agent loaded into a running sandbox.",
                ),
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
                tooltip: noteTooltip(
                    `Click to create corpus/${agent}.utterances.jsonl and open it so you can add labelled utterances for ${agent}.`,
                ),
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
            // Feedback is conveyed by the row icon (thumbs up/down), so no
            // description badge is needed.
            tooltip: buildEntryTooltip(entry),
            contextValue: "corpusEntry",
            agent,
            source,
            entryId: entry.id,
            ...(entry.feedback
                ? { feedbackRating: entry.feedback.rating }
                : {}),
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
    return collapseAndTruncate(utterance, MAX_UTTERANCE_LENGTH);
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

function buildEntryTooltip(entry: CorpusEntry): TooltipModel {
    const fields: TooltipField[] = [
        { label: "Agent", value: entry.agent },
        { label: "Source", value: formatCorpusSource(entry.source) },
        { label: "Origin", value: entry.provenance.sourceUri, mono: true },
    ];
    if (entry.provenance.requestId) {
        fields.push({
            label: "Request",
            value: entry.provenance.requestId,
            mono: true,
        });
    }
    if (entry.feedback) {
        fields.push({ label: "Feedback", value: entry.feedback.rating });
        if (entry.feedback.comment) {
            fields.push({ label: "Comment", value: entry.feedback.comment });
        }
    }
    if (entry.tags && entry.tags.length > 0) {
        fields.push({ label: "Tags", value: entry.tags.join(", ") });
    }
    return { title: entry.utterance, fields };
}
