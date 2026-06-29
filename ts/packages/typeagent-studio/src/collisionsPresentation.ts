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
import {
    noteTooltip,
    type TooltipField,
    type TooltipModel,
} from "./tooltipModel.js";

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
    tooltip?: TooltipModel;
    contextValue?: string;
    /** Codicon id (no `$()` wrapper) for the tree item. */
    icon: string;
    hasChildren: boolean;
    /** Absolute path the row opens when activated (navigable rows only). */
    openPath?: string;
    /** Owning agent package for skipped rows (used by the build action). */
    agentName?: string;
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

function formatCollisionTooltip(event: CollisionDetectedEvent): TooltipModel {
    const fields: TooltipField[] = [
        { label: "Kind", value: event.kind },
        { label: "Detected at", value: event.detectionPoint },
        { label: "Sandbox", value: event.sandboxId, mono: true },
    ];
    if (event.experimentId !== undefined) {
        fields.push({
            label: "Experiment",
            value: event.experimentId,
            mono: true,
        });
    }
    if (event.requestId !== undefined) {
        fields.push({ label: "Request", value: event.requestId, mono: true });
    }
    if (event.exemplarUtterances && event.exemplarUtterances.length > 0) {
        fields.push({
            label: "Exemplars",
            value: String(event.exemplarUtterances.length),
        });
    }
    return { fields };
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
            tooltip: noteTooltip(
                "Agents whose grammars couldn't be scanned (no compiled grammar, parse error, or compile error). Click to expand.",
            ),
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
    "grammar-not-built": "circle-slash",
    "parse-error": "warning",
    "compile-error": "error",
};

const SKIPPED_REASON_LABEL: Record<GrammarScanSkip["reason"], string> = {
    "no-grammar": "no grammar",
    "grammar-not-built": "grammar not built",
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
        // An unbuilt grammar is only buildable when the agent has a compile
        // script; otherwise it ships .agr source with no build step and the
        // "Build grammar" action would do nothing — so don't offer it.
        const buildable =
            skip.reason === "grammar-not-built" && skip.compilable === true;
        const reasonText =
            skip.reason === "grammar-not-built" && skip.compilable === false
                ? "grammar source not compiled (no build step)"
                : reasonLabel;
        const tooltipFields: TooltipField[] = [
            { label: "Schema", value: skip.schemaName },
        ];
        if (ownerSuffix !== "" && skip.agentName !== undefined) {
            tooltipFields.push({ label: "Agent", value: skip.agentName });
        }
        tooltipFields.push({ label: "Reason", value: reasonText });
        if (skip.error !== undefined) {
            tooltipFields.push({ label: "Detail", value: skip.error });
        }
        return {
            kind: "skipped",
            id: `collision:skipped:${index}`,
            label: `${skip.schemaName}${ownerSuffix}`,
            description:
                skip.error !== undefined
                    ? `${reasonText} — ${skip.error}`
                    : reasonText,
            tooltip: { fields: tooltipFields },
            contextValue: buildable
                ? "studioCollisionSkippedBuildable"
                : "studioCollisionSkipped",
            icon: SKIPPED_REASON_ICON[skip.reason] ?? "circle-slash",
            hasChildren: false,
            ...(skip.agentName !== undefined
                ? { agentName: skip.agentName }
                : {}),
        };
    });
}

/** Child rows (participants then exemplar utterances) for one collision. */
export function buildCollisionChildRows(entry: CollisionEntry): CollisionRow[] {
    const { seq, event } = entry;
    const rows: CollisionRow[] = event.participants.map((p, index) => {
        const navigable = isNavigablePath(p.file);
        return {
            kind: "participant" as const,
            id: `collision:${seq}:participant:${index}`,
            label: p.actionType || p.agent,
            description: `${p.file}:${p.range[0]}`,
            tooltip: {
                fields: [
                    { label: "Agent", value: p.agent },
                    {
                        label: "Location",
                        value: `${p.file} [${p.range[0]}-${p.range[1]}]`,
                        mono: true,
                    },
                ],
                ...(navigable
                    ? { hint: "Click to open the grammar source." }
                    : {}),
            },
            contextValue: "studioCollisionParticipant",
            icon: "symbol-class",
            hasChildren: false,
            ...(navigable ? { openPath: p.file } : {}),
        };
    });

    for (const [index, utterance] of (
        event.exemplarUtterances ?? []
    ).entries()) {
        rows.push({
            kind: "exemplar",
            id: `collision:${seq}:exemplar:${index}`,
            label: utterance,
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
