// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    connectAgentServer,
    AgentServerConnection,
    ConversationDispatcher,
    SessionDispatcher,
    connectDispatcher,
    ensureAgentServer,
    ensureAndConnectDispatcher,
    ensureAndConnectConversation,
    ensureAndConnectSession,
    stopAgentServer,
    isServerRunning,
} from "./agentServerClient.js";
export type * from "@typeagent/dispatcher-rpc/types";
export type {
    ConversationInfo,
    SessionInfo,
    JoinConversationResult,
    JoinSessionResult,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
