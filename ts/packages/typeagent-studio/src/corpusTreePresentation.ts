// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusEntry, CorpusSource } from "@typeagent/core/corpus";
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
    /** Absolute path of the backing file on file-backed `source` nodes. */
    filePath?: string;
    /** Present on `entry` nodes. */
    entryId?: string;
    /** Whether the node should render as expandable. */
    hasChildren: boolean;
}

/** Order in which source groups appear beneath an agent. */
export const CORPUS_SOURCE_ORDER: CorpusSource[] = ["in-repo", "external"];

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

/**
 * Build the group rows beneath a single agent.
 *
 * File-backed sources (in-repo, external) render as one row per backing file,
 * titled by the file name and carrying its path so the row can show the real
 * file icon and an open-file action. In-repo always maps to the one
 * `corpus/<agent>.utterances.jsonl` file; external can span several files.
 *
 * `inRepoFilePath`, when set, is the path of an existing in-repo corpus file.
 * It makes an empty (0-entry) file still appear as a row so the user can open
 * and fill it; without it, an agent with no entries falls back to the seed
 * action row.
 */
export function buildCorpusSourceNodes(
    agent: string,
    entries: readonly CorpusEntry[],
    inRepoFilePath?: string,
): CorpusTreeNode[] {
    const nodes: CorpusTreeNode[] = [];
    for (const source of CORPUS_SOURCE_ORDER) {
        const inSource = entries.filter((e) => e.source === source);
        if (source === "in-repo") {
            if (inSource.length > 0) {
                // All in-repo entries live in the single canonical corpus file.
                nodes.push(
                    fileGroupNode(
                        agent,
                        source,
                        inRepoFilePath ?? inSource[0].provenance.sourceUri,
                        inSource.length,
                    ),
                );
            } else if (inRepoFilePath) {
                // The file exists but is empty: show it so it can be opened.
                nodes.push(fileGroupNode(agent, source, inRepoFilePath, 0));
            }
            continue;
        }
        if (inSource.length === 0) {
            continue;
        }
        // external: one row per distinct backing file.
        const byFile = new Map<string, number>();
        for (const e of inSource) {
            const f = e.provenance.sourceUri;
            byFile.set(f, (byFile.get(f) ?? 0) + 1);
        }
        for (const filePath of [...byFile.keys()].sort((a, b) =>
            a.localeCompare(b),
        )) {
            nodes.push(
                fileGroupNode(agent, source, filePath, byFile.get(filePath)!),
            );
        }
    }
    if (nodes.length === 0) {
        return [seedAgentNode(agent)];
    }
    return nodes;
}

function seedAgentNode(agent: string): CorpusTreeNode {
    return {
        kind: "empty",
        id: `corpus:agent:${agent}:empty`,
        label: "Create corpus file\u2026",
        description: "No entries yet",
        tooltip: noteTooltip(
            `Click to create corpus/${agent}.utterances.jsonl and open it so you can add labelled utterances for ${agent}.`,
        ),
        contextValue: "corpusAgentSeed",
        agent,
        hasChildren: false,
    };
}

function fileGroupNode(
    agent: string,
    source: CorpusSource,
    filePath: string,
    count: number,
): CorpusTreeNode {
    return {
        kind: "source",
        id: `corpus:agent:${agent}:file:${source}:${filePath}`,
        label: fileNameOf(filePath),
        description: count === 0 ? "No entries yet" : entryCountLabel(count),
        tooltip: {
            title: fileNameOf(filePath),
            fields: [
                {
                    label: "Source",
                    value:
                        source === "in-repo"
                            ? "Repository (shared, committed)"
                            : "External",
                },
                { label: "Path", value: filePath, mono: true },
                { label: "Entries", value: String(count) },
            ],
        },
        contextValue: "corpusFile",
        agent,
        source,
        filePath,
        hasChildren: count > 0,
    };
}

/** Build the entry rows for a single source group (a backing file). */
export function buildCorpusEntryNodes(
    group: CorpusTreeNode,
    entries: readonly CorpusEntry[],
): CorpusTreeNode[] {
    const agent = group.agent ?? "";
    return entries
        .filter((entry) => entryBelongsToGroup(entry, group))
        .map((entry) => ({
            kind: "entry" as const,
            id: `corpus:entry:${entry.id}`,
            label: truncateUtterance(entry.utterance),
            tooltip: buildEntryTooltip(entry),
            contextValue: "corpusEntry",
            agent,
            ...(group.source !== undefined ? { source: group.source } : {}),
            entryId: entry.id,
            hasChildren: false,
        }));
}

/** Whether an entry belongs under the given source group. */
function entryBelongsToGroup(
    entry: CorpusEntry,
    group: CorpusTreeNode,
): boolean {
    if (entry.source !== group.source) {
        return false;
    }
    // External entries are split per backing file; match the group's file.
    if (group.source === "external") {
        return entry.provenance.sourceUri === group.filePath;
    }
    return true;
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

function entryCountLabel(count: number): string {
    return `${count} entr${count === 1 ? "y" : "ies"}`;
}

/** Last path segment, handling both POSIX and Windows separators. */
function fileNameOf(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
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
    if (entry.tags && entry.tags.length > 0) {
        fields.push({ label: "Tags", value: entry.tags.join(", ") });
    }
    return { title: entry.utterance, fields };
}
