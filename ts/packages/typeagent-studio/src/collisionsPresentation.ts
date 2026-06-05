// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Pure, vscode-free mapping from `collision.detected` events to Collisions
 * tree rows. The VS Code `TreeDataProvider` is a thin adapter over these
 * descriptors so the summarization/labelling can be unit-tested without the
 * editor host (mirrors `eventLogPresentation.ts`).
 */

import type {
    CollisionDetectedEvent,
    CollisionKind,
} from "@typeagent/core/events";

export type CollisionRowKind =
    | "collision"
    | "participant"
    | "exemplar"
    | "empty";

export interface CollisionEntry {
    /** Monotonic sequence assigned by the provider as collisions arrive. */
    seq: number;
    event: CollisionDetectedEvent;
}

export interface CollisionRow {
    kind: CollisionRowKind;
    /** Stable identifier, unique across the displayed list. */
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    /** Codicon id (no `$()` wrapper) for the tree item. */
    icon: string;
    hasChildren: boolean;
    /** Absolute path the row opens when activated (navigable rows only). */
    openPath?: string;
}

const KIND_ICON: Record<CollisionKind, string> = {
    overlap: "git-merge",
    shadow: "eye-closed",
    ambiguity: "question",
};

export function iconForCollisionKind(kind: CollisionKind): string {
    return KIND_ICON[kind] ?? "warning";
}

/** Compact `agent.actionType` ↔ `agent.actionType` … summary of participants. */
export function formatParticipants(event: CollisionDetectedEvent): string {
    if (event.participants.length === 0) {
        return "(no participants)";
    }
    return event.participants
        .map((p) => p.actionType || p.agent)
        .join(" \u2194 ");
}

export function formatCollisionSummary(event: CollisionDetectedEvent): string {
    return `${event.kind}: ${formatParticipants(event)}`;
}

function formatCollisionTooltip(event: CollisionDetectedEvent): string {
    const lines = [
        `Kind: ${event.kind}`,
        `Detected at: ${event.detectionPoint}`,
        `Sandbox: ${event.sandboxId}`,
    ];
    if (event.experimentId !== undefined) {
        lines.push(`Experiment: ${event.experimentId}`);
    }
    if (event.requestId !== undefined) {
        lines.push(`Request: ${event.requestId}`);
    }
    if (event.exemplarUtterances && event.exemplarUtterances.length > 0) {
        lines.push(`Exemplars: ${event.exemplarUtterances.length}`);
    }
    return lines.join("\n");
}

/** Map provider entries (expected newest-first) into top-level rows. */
export function buildCollisionRows(
    entries: readonly CollisionEntry[],
): CollisionRow[] {
    if (entries.length === 0) {
        return [
            {
                kind: "empty",
                id: "collision:empty",
                label: "No collisions detected",
                description:
                    "Collisions appear as schemas and grammars overlap",
                icon: "check",
                hasChildren: false,
            },
        ];
    }

    return entries.map(({ seq, event }) => ({
        kind: "collision" as const,
        id: `collision:${seq}`,
        label: formatCollisionSummary(event),
        description: event.detectionPoint,
        tooltip: formatCollisionTooltip(event),
        contextValue: "studioCollision",
        icon: iconForCollisionKind(event.kind),
        hasChildren:
            event.participants.length > 0 ||
            (event.exemplarUtterances?.length ?? 0) > 0,
    }));
}

/** Child rows (participants then exemplar utterances) for one collision. */
export function buildCollisionChildRows(entry: CollisionEntry): CollisionRow[] {
    const { seq, event } = entry;
    const rows: CollisionRow[] = event.participants.map((p, index) => ({
        kind: "participant" as const,
        id: `collision:${seq}:participant:${index}`,
        label: p.actionType || p.agent,
        description: `${p.file}:${p.range[0]}`,
        tooltip: `${p.agent}\n${p.file} [${p.range[0]}-${p.range[1]}]`,
        contextValue: "studioCollisionParticipant",
        icon: "symbol-class",
        hasChildren: false,
        ...(isNavigablePath(p.file) ? { openPath: p.file } : {}),
    }));

    for (const [index, utterance] of (
        event.exemplarUtterances ?? []
    ).entries()) {
        rows.push({
            kind: "exemplar",
            id: `collision:${seq}:exemplar:${index}`,
            label: utterance,
            description: "exemplar",
            contextValue: "studioCollisionExemplar",
            icon: "quote",
            hasChildren: false,
        });
    }

    return rows;
}

/**
 * A participant `file` is navigable when it is a concrete path rather than one
 * of the placeholder markers (`<unknown>`, `<grammar>`) used when no source
 * location is available.
 */
function isNavigablePath(file: string): boolean {
    return file.length > 0 && !file.startsWith("<");
}
