// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EventEmitterLike } from "../events/eventStream.js";
import { EVENT_SCHEMA_VERSION } from "../events/index.js";
import type { CorpusEntry } from "../corpus/types.js";
import { computeEntryId } from "../corpus/id.js";
import type {
    FeedbackBackend,
    FeedbackCorpusProjector,
    FeedbackFilter,
    FeedbackRecordInput,
    FeedbackRow,
    FeedbackService,
    FeedbackTopOptions,
} from "./types.js";

export interface FeedbackServiceOptions {
    backend: FeedbackBackend;
    emitter?: EventEmitterLike;
    now?: () => number;
}

/**
 * Canonical F0.4 wrapper around feedback operations.
 *
 * Write path delegates to the backend using PR #2341 operation names.
 * Read path prefers backend-native list support when available; otherwise it
 * falls back to an internal materialized cache of records made via this
 * service instance.
 */
export class CoreFeedbackService
    implements FeedbackService, FeedbackCorpusProjector
{
    private readonly backend: FeedbackBackend;
    private readonly emitter: EventEmitterLike | undefined;
    private readonly now: () => number;
    private readonly cache = new Map<string, FeedbackRow>();

    constructor(opts: FeedbackServiceOptions) {
        this.backend = opts.backend;
        this.emitter = opts.emitter;
        this.now = opts.now ?? Date.now;
    }

    async record(input: FeedbackRecordInput): Promise<void> {
        const row = this.normalize(input);
        await this.backend.recordUserFeedback({
            ...input,
            recordedAt: row.recordedAt,
        });
        this.cache.set(row.requestId, row);
        this.emitter?.emit({
            schemaVersion: EVENT_SCHEMA_VERSION,
            type: "feedback.recorded",
            ts: row.recordedAt,
            requestId: row.requestId,
            sandboxId: "studio",
            rating: row.rating,
            includesContext: row.includesContext,
            ...(row.category !== undefined ? { category: row.category } : {}),
            ...(row.comment !== undefined ? { comment: row.comment } : {}),
        });
    }

    async hide(requestId: string): Promise<void> {
        await this.backend.recordUserHide(requestId);
        const row = this.cache.get(requestId);
        if (row) {
            this.cache.set(requestId, { ...row, hidden: true });
        }
    }

    async restoreAllHidden(sessionId: string): Promise<void> {
        await this.backend.restoreAllHidden(sessionId);
        for (const [k, row] of this.cache.entries()) {
            if (row.sessionId === sessionId && row.hidden) {
                this.cache.set(k, { ...row, hidden: false });
            }
        }
    }

    async list(filter: FeedbackFilter = {}): Promise<FeedbackRow[]> {
        const rows = this.backend.listFeedbackRows
            ? await this.backend.listFeedbackRows(filter)
            : [...this.cache.values()];
        return rows.filter((r) => matchesFilter(r, filter));
    }

    async top(opts: FeedbackTopOptions): Promise<FeedbackRow[]> {
        const filter: FeedbackFilter = {
            hidden: false,
            ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
            ...(opts.category !== undefined ? { category: opts.category } : {}),
        };
        const rows = await this.list(filter);
        const grouped = new Map<string, FeedbackRow & { _score: number }>();
        for (const row of rows) {
            const key = `${row.agent ?? ""}|${row.category ?? ""}`;
            const current = grouped.get(key);
            const delta = row.rating === "down" ? 1 : -1;
            if (!current) {
                grouped.set(key, { ...row, _score: delta });
            } else {
                grouped.set(key, {
                    ...current,
                    _score: current._score + delta,
                    recordedAt: Math.max(current.recordedAt, row.recordedAt),
                });
            }
        }
        return [...grouped.values()]
            .sort((a, b) => b._score - a._score || b.recordedAt - a.recordedAt)
            .slice(0, Math.max(0, opts.limit))
            .map(({ _score: _ignored, ...rest }) => rest);
    }

    async exportJsonl(
        filter: FeedbackFilter | undefined,
        out: { write(chunk: string): boolean | void; end?(): void },
    ): Promise<number> {
        const rows = await this.list(filter);
        for (const row of rows) {
            out.write(JSON.stringify(row) + "\n");
        }
        out.end?.();
        return rows.length;
    }

    async count(filter: FeedbackFilter = {}): Promise<number> {
        return (await this.list(filter)).length;
    }

    async toCorpusEntries(agent: string): Promise<CorpusEntry[]> {
        const rows = await this.list({ agent, hidden: false });
        return rows
            .filter((r) => r.utterance !== undefined)
            .map((r) => {
                const provenance: CorpusEntry["provenance"] = {
                    sourceUri: "feedback://core",
                    requestId: r.requestId,
                    capturedAt: r.recordedAt,
                    ...(r.sessionId !== undefined
                        ? { sessionId: r.sessionId }
                        : {}),
                };

                const entry: CorpusEntry = {
                    id: computeEntryId(r.utterance!, agent, r.requestId),
                    utterance: r.utterance!,
                    agent,
                    source: "feedback",
                    provenance,
                    feedback: {
                        rating: r.rating,
                        recordedAt: r.recordedAt,
                        ...(r.category !== undefined
                            ? { category: r.category }
                            : {}),
                        ...(r.comment !== undefined
                            ? { comment: r.comment }
                            : {}),
                    },
                    ...(r.expectedAction !== undefined
                        ? { expectedAction: r.expectedAction }
                        : {}),
                    ...(r.tags !== undefined ? { tags: r.tags } : {}),
                };
                return entry;
            });
    }

    private normalize(input: FeedbackRecordInput): FeedbackRow {
        const existing = this.cache.get(input.requestId);
        const recordedAt = input.recordedAt ?? this.now();
        const row: FeedbackRow = {
            requestId: input.requestId,
            rating: input.rating,
            includesContext: input.includeContext ?? false,
            recordedAt,
            hidden: existing?.hidden ?? false,
            ...(input.category !== undefined
                ? { category: input.category }
                : existing?.category !== undefined
                  ? { category: existing.category }
                  : {}),
            ...(input.comment !== undefined
                ? { comment: input.comment }
                : existing?.comment !== undefined
                  ? { comment: existing.comment }
                  : {}),
            ...(input.agent !== undefined
                ? { agent: input.agent }
                : existing?.agent !== undefined
                  ? { agent: existing.agent }
                  : {}),
            ...(input.utterance !== undefined
                ? { utterance: input.utterance }
                : existing?.utterance !== undefined
                  ? { utterance: existing.utterance }
                  : {}),
            ...(input.expectedAction !== undefined
                ? { expectedAction: input.expectedAction }
                : existing?.expectedAction !== undefined
                  ? { expectedAction: existing.expectedAction }
                  : {}),
            ...(input.tags !== undefined
                ? { tags: input.tags }
                : existing?.tags !== undefined
                  ? { tags: existing.tags }
                  : {}),
            ...(input.sessionId !== undefined
                ? { sessionId: input.sessionId }
                : existing?.sessionId !== undefined
                  ? { sessionId: existing.sessionId }
                  : {}),
        };
        return row;
    }
}

function matchesFilter(row: FeedbackRow, filter: FeedbackFilter): boolean {
    if (filter.requestId && row.requestId !== filter.requestId) return false;
    if (filter.agent && row.agent !== filter.agent) return false;
    if (filter.rating && row.rating !== filter.rating) return false;
    if (filter.category && row.category !== filter.category) return false;
    if (filter.sessionId && row.sessionId !== filter.sessionId) return false;
    if (
        filter.hidden !== undefined &&
        (row.hidden ?? false) !== filter.hidden
    ) {
        return false;
    }
    if (filter.since !== undefined && row.recordedAt < filter.since) {
        return false;
    }
    if (filter.until !== undefined && row.recordedAt > filter.until) {
        return false;
    }
    return true;
}
