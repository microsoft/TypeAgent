// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    FeedbackBackend,
    FeedbackFilter,
    FeedbackRecordInput,
    FeedbackRow,
} from "./types.js";

/**
 * Simple in-memory backend useful for tests and local Studio flows before
 * dispatcher RPC wiring lands.
 */
export class InMemoryFeedbackBackend implements FeedbackBackend {
    private readonly rows = new Map<string, FeedbackRow>();

    async recordUserFeedback(input: FeedbackRecordInput): Promise<void> {
        const existing = this.rows.get(input.requestId);
                const row: FeedbackRow = {
            requestId: input.requestId,
            rating: input.rating,
            includesContext: input.includeContext ?? false,
            recordedAt: input.recordedAt ?? Date.now(),
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
                this.rows.set(input.requestId, row);
    }

    async recordUserHide(requestId: string): Promise<void> {
        const row = this.rows.get(requestId);
        if (row) {
            this.rows.set(requestId, { ...row, hidden: true });
        }
    }

    async restoreAllHidden(sessionId: string): Promise<void> {
        for (const [k, row] of this.rows.entries()) {
            if (row.sessionId === sessionId && row.hidden) {
                this.rows.set(k, { ...row, hidden: false });
            }
        }
    }

    async flushHidden(): Promise<void> {
        for (const [k, row] of this.rows.entries()) {
            if (row.hidden) {
                this.rows.delete(k);
            }
        }
    }

    async listFeedbackRows(_filter: FeedbackFilter): Promise<FeedbackRow[]> {
        return [...this.rows.values()];
    }
}
