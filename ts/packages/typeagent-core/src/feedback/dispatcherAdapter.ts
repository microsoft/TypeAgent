// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EventEmitterLike } from "../events/eventStream.js";
import { CoreFeedbackService } from "./service.js";
import type {
    FeedbackBackend,
    FeedbackFilter,
    FeedbackRecordInput,
    FeedbackRow,
    FeedbackService,
} from "./types.js";

/**
 * Dispatcher-side RPC shape from PR #2341 naming.
 *
 * This is intentionally structural (not imported from dispatcher package) so
 * `@typeagent/core` remains dependency-light.
 */
export interface DispatcherFeedbackRpcClient {
    recordUserFeedback(input: FeedbackRecordInput): Promise<void>;
    recordUserHide(requestId: string): Promise<void>;
    restoreAllHidden(sessionId: string): Promise<void>;
    flushHidden?(): Promise<void>;
    listFeedbackRows?(filter: FeedbackFilter): Promise<FeedbackRow[]>;
}

export interface DispatcherFeedbackServiceOptions {
    emitter?: EventEmitterLike;
    now?: () => number;
}

export function createFeedbackServiceFromDispatcher(
    rpc: DispatcherFeedbackRpcClient,
    opts: DispatcherFeedbackServiceOptions = {},
): FeedbackService {
    const backend: FeedbackBackend = {
        recordUserFeedback: (input) => rpc.recordUserFeedback(input),
        recordUserHide: (requestId) => rpc.recordUserHide(requestId),
        restoreAllHidden: (sessionId) => rpc.restoreAllHidden(sessionId),
        flushHidden: () => rpc.flushHidden?.() ?? Promise.resolve(),
        listFeedbackRows: (filter) =>
            rpc.listFeedbackRows
                ? rpc.listFeedbackRows(filter)
                : Promise.resolve([]),
    };
    return new CoreFeedbackService({
        backend,
        ...(opts.emitter !== undefined ? { emitter: opts.emitter } : {}),
        ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
}
