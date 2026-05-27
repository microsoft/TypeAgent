// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    FeedbackCategory,
    FeedbackRating,
} from "../events/types.js";
import type { CorpusEntry, CorpusWritable } from "../corpus/types.js";

export interface FeedbackRecordInput {
    requestId: string;
    rating: FeedbackRating;
    category?: FeedbackCategory;
    comment?: string;
    includeContext?: boolean;
    /** Optional metadata used for list/top/corpus projection in Studio. */
    agent?: string;
    utterance?: string;
    expectedAction?: unknown;
    tags?: string[];
    sessionId?: string;
    recordedAt?: number;
}

export interface FeedbackFilter {
    requestId?: string;
    agent?: string;
    rating?: FeedbackRating;
    category?: FeedbackCategory;
    sessionId?: string;
    hidden?: boolean;
    since?: number;
    until?: number;
}

export interface FeedbackRow {
    requestId: string;
    rating: FeedbackRating;
    category?: FeedbackCategory;
    comment?: string;
    includesContext: boolean;
    recordedAt: number;
    agent?: string;
    utterance?: string;
    expectedAction?: unknown;
    tags?: string[];
    sessionId?: string;
    hidden?: boolean;
}

export interface FeedbackTopOptions {
    agent?: string;
    category?: FeedbackCategory;
    limit: number;
}

/** Minimal backend contract matching PR #2341-style RPC operation names. */
export interface FeedbackBackend {
    recordUserFeedback(input: FeedbackRecordInput): Promise<void>;
    recordUserHide(requestId: string): Promise<void>;
    restoreAllHidden(sessionId: string): Promise<void>;
    flushHidden?(): Promise<void>;
    /** Optional read-side hooks when a backend has native query support. */
    listFeedbackRows?(filter: FeedbackFilter): Promise<FeedbackRow[]>;
}

export interface FeedbackService {
    record(input: FeedbackRecordInput): Promise<void>;
    hide(requestId: string): Promise<void>;
    restoreAllHidden(sessionId: string): Promise<void>;
    list(filter?: FeedbackFilter): Promise<FeedbackRow[]>;
    top(opts: FeedbackTopOptions): Promise<FeedbackRow[]>;
    exportJsonl(filter: FeedbackFilter | undefined, out: CorpusWritable): Promise<number>;
    count(filter?: FeedbackFilter): Promise<number>;
}

/**
 * Optional extension for services that can project feedback rows into corpus
 * entries directly (used by F0.2 `FileCorpusService.feedbackProvider`).
 */
export interface FeedbackCorpusProjector {
    toCorpusEntries(agent: string): Promise<CorpusEntry[]>;
}

export class FeedbackRowNotFoundError extends Error {
    constructor(public readonly requestId: string) {
        super(`Feedback row not found for requestId: ${requestId}`);
        this.name = "FeedbackRowNotFoundError";
    }
}
