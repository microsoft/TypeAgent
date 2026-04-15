// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    connectAgentServer,
    AgentServerConnection,
    SessionDispatcher,
    connectDispatcher,
    ensureAgentServer,
    ensureAndConnectDispatcher,
    ensureAndConnectSession,
    stopAgentServer,
    isServerRunning,
} from "./agentServerClient.js";
export type * from "@typeagent/dispatcher-rpc/types";
export type {
    SessionInfo,
    JoinSessionResult,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
