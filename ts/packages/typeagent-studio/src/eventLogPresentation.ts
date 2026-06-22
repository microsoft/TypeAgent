// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioEvent, StudioEventType } from "@typeagent/core/events";
import { collapseAndTruncate } from "./textFormatting.js";

/**
 * Pure, vscode-free mapping from structured events to event-log row
 * descriptors. The VS Code `TreeDataProvider` is a thin adapter over these
 * descriptors so the summarization/labelling can be unit-tested without the
 * editor host (mirrors `sandboxTreePresentation.ts`).
 */

export type EventLogRowKind = "event" | "empty";

export interface EventLogEntry {
    /** Monotonic sequence assigned by the provider as events arrive. */
    seq: number;
    event: StudioEvent;
}

export interface EventLogRow {
    kind: EventLogRowKind;
    /** Stable identifier, unique across the displayed list. */
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    eventType?: StudioEventType;
    hasChildren: boolean;
}

/** Map provider entries (expected newest-first) into displayable rows. */
export function buildEventLogRows(
    entries: readonly EventLogEntry[],
): EventLogRow[] {
    if (entries.length === 0) {
        return [
            {
                kind: "empty",
                id: "event:empty",
                label: "No events yet",
                description: "Events appear as the sandbox runs",
                hasChildren: false,
            },
        ];
    }

    return entries.map(({ seq, event }) => ({
        kind: "event" as const,
        id: `event:${seq}`,
        label: formatEventSummary(event),
        description: formatEventDescription(event),
        tooltip: buildEventTooltip(event),
        contextValue: "studioEvent",
        eventType: event.type,
        hasChildren: false,
    }));
}

export function formatEventSummary(event: StudioEvent): string {
    switch (event.type) {
        case "phase.start":
            return `phase ${event.phase} started`;
        case "phase.end":
            return `phase ${event.phase} ${
                event.success ? "ok" : "failed"
            } (${event.durationMs}ms)`;
        case "cache.hit":
            return `cache hit (${event.systemKind})`;
        case "cache.miss":
            return `cache miss (${event.systemKind})`;
        case "grammar.match.attempt":
            return `grammar attempt: ${quote(event.utterance)}`;
        case "grammar.match.result":
            return `grammar ${
                event.matched ? "matched" : "no match"
            }: ${quote(event.utterance)}`;
        case "action.selected":
            return `action ${event.actionType} via ${event.source}`;
        case "action.executed":
            return `action ${event.actionType} ${
                event.success ? "ok" : "failed"
            } (${event.durationMs}ms)`;
        case "feedback.recorded":
            return `feedback ${event.rating}${
                event.category ? ` (${event.category})` : ""
            }`;
        case "collision.detected":
            return `collision ${event.kind} at ${event.detectionPoint}`;
        case "reasoning.step":
            return `reasoning: ${event.stepName}`;
        case "sandbox.start":
            return "sandbox started";
        case "sandbox.stop":
            return "sandbox stopped";
        case "sandbox.restart":
            return "sandbox restarted";
        case "sandbox.agent.loaded":
            return `agent loaded${
                event.affectedAgent ? `: ${event.affectedAgent}` : ""
            }`;
        case "sandbox.agent.unloaded":
            return `agent unloaded${
                event.affectedAgent ? `: ${event.affectedAgent}` : ""
            }`;
        case "replay.row":
            return `replay row ${event.rowIndex} ${
                event.equal ? "=" : "\u2260"
            }`;
        case "replay.summary":
            return `replay summary ${event.equalCount}/${event.rowCount} equal`;
        default:
            return (event as StudioEvent).type;
    }
}

export function iconForEvent(event: StudioEvent): string {
    switch (event.type) {
        case "phase.start":
            return "debug-start";
        case "phase.end":
            return event.success ? "pass" : "error";
        case "cache.hit":
        case "cache.miss":
            return "database";
        case "grammar.match.attempt":
        case "grammar.match.result":
            return "regex";
        case "action.selected":
            return "target";
        case "action.executed":
            return event.success ? "check" : "error";
        case "feedback.recorded":
            return event.rating === "up" ? "thumbsup" : "thumbsdown";
        case "collision.detected":
            return "warning";
        case "reasoning.step":
            return "lightbulb";
        case "sandbox.start":
        case "sandbox.stop":
        case "sandbox.restart":
        case "sandbox.agent.loaded":
        case "sandbox.agent.unloaded":
            return "vm";
        case "replay.row":
        case "replay.summary":
            return "history";
        default:
            return "circle-small";
    }
}

/** Deterministic UTC `HH:MM:SS` rendering of an epoch-ms timestamp. */
export function formatEventTime(ts: number): string {
    return new Date(ts).toISOString().slice(11, 19);
}

function formatEventDescription(event: StudioEvent): string {
    const time = formatEventTime(event.ts);
    return event.agent ? `${time} · ${event.agent}` : time;
}

function buildEventTooltip(event: StudioEvent): string {
    const lines: string[] = [
        `${event.type} @ ${new Date(event.ts).toISOString()}`,
        `sandbox: ${event.sandboxId}`,
    ];
    if (event.agent) {
        lines.push(`agent: ${event.agent}`);
    }
    if (event.requestId) {
        lines.push(`requestId: ${event.requestId}`);
    }
    if (event.runId) {
        lines.push(`runId: ${event.runId}`);
    }
    return lines.join("\n");
}

function quote(value: string): string {
    return `"${collapseAndTruncate(value, 60)}"`;
}
