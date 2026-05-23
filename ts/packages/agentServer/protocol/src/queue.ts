// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Re-export queue wire types from @typeagent/dispatcher-types so clients depending
// only on the agent-server protocol package can import them from one place.

export type {
    QueueRequestState,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
    QueueEventVersion,
    SubmitResult,
    CancelResult,
} from "@typeagent/dispatcher-types";
export {
    QueueFullError,
    ServerStoppingError,
} from "@typeagent/dispatcher-types";
