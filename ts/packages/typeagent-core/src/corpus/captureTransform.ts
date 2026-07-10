// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusEntry, FeedbackLabel } from "./types.js";
import { computeEntryId } from "./id.js";

/**
 * Narrow structural view of a display-log entry that the capture transform
 * reads. It deliberately does not import the dispatcher's `DisplayLogEntry`
 * union: `typeagent-core` must not depend on the dispatcher, so the studio
 * service adapts a real `displayLog.json` into this shape before calling the
 * transform.
 *
 * Entries are correlated by `requestId.requestId`:
 *  - `user-request` carries the utterance in `command`.
 *  - `set-display-info` carries the dispatching agent in `source` and the
 *    resolved action in `action`; a single request may emit several of these
 *    (one per `actionIndex`). Only a structured `TypeAgentAction` object counts
 *    as a real action — framework sources (`dispatcher`, `system`) emit
 *    `string[]` display actions that are ignored.
 *  - `user-feedback` carries the rating; later entries for the same request
 *    shadow earlier ones, and `rating: null` means the rating was cleared.
 */
export interface CaptureLogEntry {
    type: string;
    seq?: number;
    timestamp?: number;
    requestId?: { requestId: string };
    /** user-request: the utterance. */
    command?: string;
    /** set-display-info: the dispatching agent. */
    source?: string;
    /** set-display-info: position within a multi-action request. */
    actionIndex?: number;
    /** set-display-info: the resolved action. */
    action?: unknown;
    /** user-feedback: the rating (`null` = cleared). */
    rating?: "up" | "down" | null;
    /** user-feedback: optional category. */
    category?: FeedbackLabel["category"];
    /** user-feedback: optional free-text comment. */
    comment?: string;
}

export interface CaptureTransformOptions {
    /** Source URI recorded in provenance (typically the displayLog path). */
    sourceUri: string;
    /** Session identifier recorded in provenance, when known. */
    sessionId?: string;
    /**
     * Decides whether an agent's requests are captured. Defaults to accepting
     * any non-empty agent name; callers pass an explicit allowlist to exclude
     * system/pseudo-sources.
     */
    agentFilter?: (agent: string) => boolean;
    /** Clock for `capturedAt`; defaults to `Date.now`. */
    now?: () => number;
}

interface RequestAccumulator {
    order: number;
    utterance?: string;
    agent?: string;
    actions: {
        index: number | undefined;
        seq: number | undefined;
        order: number;
        action: unknown;
    }[];
    feedback?: {
        seq: number | undefined;
        order: number;
        rating: "up" | "down" | null;
        category: FeedbackLabel["category"] | undefined;
        comment: string | undefined;
        recordedAt: number | undefined;
    };
}

/**
 * Turn display-log entries into corpus entries.
 *
 * Requests are grouped by `requestId.requestId`. Each kept request becomes one
 * `CorpusEntry { utterance, agent, expectedAction, feedback }`:
 *  - the utterance comes from the request's `user-request` entry;
 *  - the agent comes from the `source` of its action-bearing `set-display-info`
 *    entries (those carrying a structured `TypeAgentAction`);
 *  - `expectedAction` is the ordered action sequence (a single action when there
 *    is exactly one, an array when there are several), ordered by `actionIndex`,
 *    then `seq`, then log order;
 *  - feedback is the latest `user-feedback` entry, omitted when its rating was
 *    cleared (`null`).
 *
 * A request is dropped when it has no utterance, no resolvable agent, or no
 * resolved action. The entry id is the logical `computeEntryId(utterance,
 * agent)` so the same utterance recaptured under a different requestId is the
 * same entry; entries are deduped within the batch by that id, latest wins.
 */
export function displayLogToCorpusEntries(
    entries: CaptureLogEntry[],
    opts: CaptureTransformOptions,
): CorpusEntry[] {
    const now = opts.now ?? Date.now;
    const accept = opts.agentFilter ?? ((agent: string) => agent.length > 0);

    const byRequest = accumulateRequests(entries);
    const result = new Map<string, CorpusEntry>();
    const requests = [...byRequest.entries()].sort(
        (a, b) => a[1].order - b[1].order,
    );

    for (const [requestId, acc] of requests) {
        const entry = buildCorpusEntry(requestId, acc, opts, now, accept);
        if (entry !== undefined) {
            mergeLatestWins(result, entry);
        }
    }

    return [...result.values()];
}

/** Group raw log entries by requestId, folding each into an accumulator. */
function accumulateRequests(
    entries: CaptureLogEntry[],
): Map<string, RequestAccumulator> {
    const byRequest = new Map<string, RequestAccumulator>();
    let order = 0;
    for (const entry of entries) {
        const requestId = entry.requestId?.requestId;
        if (requestId === undefined) {
            continue;
        }
        let acc = byRequest.get(requestId);
        if (acc === undefined) {
            acc = { order, actions: [] };
            byRequest.set(requestId, acc);
        }
        accumulateEntry(acc, entry, order++);
    }
    return byRequest;
}

/** Fold one log entry into its request accumulator by entry type. */
function accumulateEntry(
    acc: RequestAccumulator,
    entry: CaptureLogEntry,
    entryOrder: number,
): void {
    switch (entry.type) {
        case "user-request":
            if (
                typeof entry.command === "string" &&
                acc.utterance === undefined
            ) {
                acc.utterance = entry.command;
            }
            break;
        case "set-display-info":
            accumulateAction(acc, entry, entryOrder);
            break;
        case "user-feedback":
            accumulateFeedback(acc, entry, entryOrder);
            break;
        default:
            break;
    }
}

/**
 * Record a structured action and, if not yet known, the request's agent. Only
 * a structured action (a `TypeAgentAction` object) counts. Framework sources
 * like `dispatcher`/`system` emit `string[]` display actions (e.g.
 * `["request"]`); those carry no expected action and must not define the
 * request's agent.
 */
function accumulateAction(
    acc: RequestAccumulator,
    entry: CaptureLogEntry,
    entryOrder: number,
): void {
    if (!isStructuredAction(entry.action)) {
        return;
    }
    if (
        acc.agent === undefined &&
        typeof entry.source === "string" &&
        entry.source.length > 0
    ) {
        acc.agent = entry.source;
    }
    acc.actions.push({
        index: entry.actionIndex,
        seq: entry.seq,
        order: entryOrder,
        action: entry.action,
    });
}

/** Keep the latest non-cleared feedback for the request. */
function accumulateFeedback(
    acc: RequestAccumulator,
    entry: CaptureLogEntry,
    entryOrder: number,
): void {
    if (entry.rating === undefined) {
        return;
    }
    const candidate = {
        seq: entry.seq,
        order: entryOrder,
        rating: entry.rating,
        category: entry.category,
        comment: entry.comment,
        recordedAt: entry.timestamp,
    };
    if (acc.feedback === undefined || laterThan(candidate, acc.feedback)) {
        acc.feedback = candidate;
    }
}

/**
 * Build a corpus entry from one accumulated request, or `undefined` when the
 * request lacks an utterance, a resolvable agent, or any resolved action, or
 * when the agent is filtered out.
 */
function buildCorpusEntry(
    requestId: string,
    acc: RequestAccumulator,
    opts: CaptureTransformOptions,
    now: () => number,
    accept: (agent: string) => boolean,
): CorpusEntry | undefined {
    if (
        acc.utterance === undefined ||
        acc.agent === undefined ||
        acc.actions.length === 0 ||
        !accept(acc.agent)
    ) {
        return undefined;
    }

    const ordered = [...acc.actions].sort(compareActions).map((a) => a.action);
    const expectedAction = ordered.length === 1 ? ordered[0] : ordered;

    const entry: CorpusEntry = {
        id: computeEntryId(acc.utterance, acc.agent),
        utterance: acc.utterance,
        agent: acc.agent,
        source: "captures",
        provenance: {
            sourceUri: opts.sourceUri,
            rawSourceUri: opts.sourceUri,
            capturedAt: now(),
            requestId,
            ...(opts.sessionId !== undefined
                ? { sessionId: opts.sessionId }
                : {}),
        },
        expectedAction,
    };

    if (acc.feedback !== undefined && acc.feedback.rating !== null) {
        const label: FeedbackLabel = {
            rating: acc.feedback.rating,
            recordedAt: acc.feedback.recordedAt ?? now(),
            ...(acc.feedback.category !== undefined
                ? { category: acc.feedback.category }
                : {}),
            ...(acc.feedback.comment !== undefined
                ? { comment: acc.feedback.comment }
                : {}),
        };
        entry.feedback = label;
    }

    return entry;
}

/**
 * Insert `entry`, letting the latest occurrence of a logical id win while the
 * Map keeps the first occurrence's position so output order stays stable.
 */
function mergeLatestWins(
    result: Map<string, CorpusEntry>,
    entry: CorpusEntry,
): void {
    const existing = result.get(entry.id);
    if (existing !== undefined) {
        entry.provenance = {
            ...entry.provenance,
            ...(existing.provenance.sessionId !== undefined &&
            entry.provenance.sessionId === undefined
                ? { sessionId: existing.provenance.sessionId }
                : {}),
        };
    }
    result.set(entry.id, entry);
}

function isStructuredAction(action: unknown): boolean {
    return (
        typeof action === "object" && action !== null && !Array.isArray(action)
    );
}

function laterThan(
    a: { seq: number | undefined; order: number },
    b: { seq: number | undefined; order: number },
): boolean {
    if (a.seq !== undefined && b.seq !== undefined) {
        return a.seq >= b.seq;
    }
    return a.order >= b.order;
}

function compareActions(
    a: { index: number | undefined; seq: number | undefined; order: number },
    b: { index: number | undefined; seq: number | undefined; order: number },
): number {
    if (a.index !== undefined && b.index !== undefined && a.index !== b.index) {
        return a.index - b.index;
    }
    if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) {
        return a.seq - b.seq;
    }
    return a.order - b.order;
}
