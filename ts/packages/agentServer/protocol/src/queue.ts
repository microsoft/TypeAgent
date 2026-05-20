// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 1 of the server-side message queue lives in @typeagent/dispatcher-types
// so the Dispatcher and ClientIO interfaces can reference it. Re-export the
// wire-level shapes here so clients depending only on the agent-server
// protocol package can import them from a single place.

export type {
    QueueRequestState,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
