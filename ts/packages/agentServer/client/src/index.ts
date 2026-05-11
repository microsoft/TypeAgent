// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    DEFAULT_AGENT_SERVER_PORT,
    getAgentServerPort,
    getAgentServerUrl,
    connectAgentServer,
    AgentServerConnection,
    ConversationDispatcher,
    connectDispatcher,
    ensureAgentServer,
    lookupAgentServer,
    ensureAndConnectDispatcher,
    ensureAndConnectConversation,
    stopAgentServer,
    isServerRunning,
    waitForServer,
} from "./agentServerClient.js";
export type {
    AgentServerHandle,
    EnsureAgentServerOptions,
} from "./agentServerClient.js";
export type * from "@typeagent/dispatcher-rpc/types";
export type {
    ConversationInfo,
    JoinConversationResult,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
