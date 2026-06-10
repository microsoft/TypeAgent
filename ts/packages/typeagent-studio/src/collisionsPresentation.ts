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
import type { GrammarScanSkip } from "@typeagent/core/collisionScanner";

export type CollisionRowKind =
    | "collision"
    | "participant"
    | "exemplar"
    | "empty"
    | "skipped-group"
    | "skipped";

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
    skipped: readonly GrammarScanSkip[] = [],
): CollisionRow[] {
    const rows: CollisionRow[] = [];

    if (skipped.length > 0) {
        rows.push({
            kind: "skipped-group",
            id: "collision:skipped",
            label: `Skipped (${skipped.length})`,
            description: "Agents excluded from the most recent scan",
            tooltip:
                "Agents whose grammars couldn't be scanned (no compiled grammar, parse error, or compile error). Click to expand.",
            contextValue: "studioCollisionSkippedGroup",
            icon: "circle-slash",
            hasChildren: true,
        });
    }

    if (entries.length === 0) {
        rows.push({
            kind: "empty",
            id: "collision:empty",
            label: "No collisions detected",
            description: "Collisions appear as schemas and grammars overlap",
            icon: "check",
            hasChildren: false,
        });
        return rows;
    }

    for (const { seq, event } of entries) {
        rows.push({
            kind: "collision",
            id: `collision:${seq}`,
            label: formatCollisionSummary(event),
            description: event.detectionPoint,
            tooltip: formatCollisionTooltip(event),
            contextValue: "studioCollision",
            icon: iconForCollisionKind(event.kind),
            hasChildren:
                event.participants.length > 0 ||
                (event.exemplarUtterances?.length ?? 0) > 0,
        });
    }
    return rows;
}

const SKIPPED_REASON_ICON: Record<GrammarScanSkip["reason"], string> = {
    "no-grammar": "circle-outline",
    "parse-error": "warning",
    "compile-error": "error",
};

const SKIPPED_REASON_LABEL: Record<GrammarScanSkip["reason"], string> = {
    "no-grammar": "no grammar",
    "parse-error": "parse error",
    "compile-error": "compile error",
};

/** Build the child rows under the "Skipped (N)" group. */
export function buildSkippedRows(
    skipped: readonly GrammarScanSkip[],
): CollisionRow[] {
    return skipped.map((skip, index) => {
        const reasonLabel = SKIPPED_REASON_LABEL[skip.reason];
        // Surface the owning agent when the skipped schema is a sub-schema of
        // a different package (e.g. `crossword` inside `browser`) so authors
        // aren't confused by a name that doesn't match a loaded agent.
        const ownerSuffix =
            skip.agentName !== undefined && skip.agentName !== skip.schemaName
                ? ` (${skip.agentName})`
                : "";
        const tooltipLines = [`Schema: ${skip.schemaName}`];
        if (ownerSuffix !== "") {
            tooltipLines.push(`Agent: ${skip.agentName}`);
        }
        tooltipLines.push(`Reason: ${reasonLabel}`);
        if (skip.error !== undefined) {
            tooltipLines.push(`Detail: ${skip.error}`);
        }
        return {
            kind: "skipped",
            id: `collision:skipped:${index}`,
            label: `${skip.schemaName}${ownerSuffix}`,
            description:
                skip.error !== undefined
                    ? `${reasonLabel} — ${skip.error}`
                    : reasonLabel,
            tooltip: tooltipLines.join("\n"),
            contextValue: "studioCollisionSkipped",
            icon: SKIPPED_REASON_ICON[skip.reason] ?? "circle-slash",
            hasChildren: false,
        };
    });
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
