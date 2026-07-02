// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The heartbeat primitives now live in `@typeagent/websocket-utils` (the
// cross-cutting websocket package shared with the agents, including the
// SecretAgents submodule) so both the server-side (`attachHeartbeat`) and
// client-side (`attachClientHeartbeat`) liveness checks have a single home.
// Re-exported here so existing `websocket-channel-server` consumers keep
// importing them unchanged.
export {
    attachHeartbeat,
    attachClientHeartbeat,
    type HeartbeatOptions,
    type ClientHeartbeatOptions,
} from "@typeagent/websocket-utils/heartbeat";
