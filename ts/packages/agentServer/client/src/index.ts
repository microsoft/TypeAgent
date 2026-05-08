// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    connectAgentServer,
    AgentServerConnection,
    ConversationDispatcher,
    connectDispatcher,
    ensureAgentServer,
    ensureAndConnectDispatcher,
    ensureAndConnectConversation,
    stopAgentServer,
    isServerRunning,
    writeServerPid,
    removeServerPid,
} from "./agentServerClient.js";
export {
    DEFAULT_AGENT_SERVER_PORT,
    ensureAgentServerViaRegistry,
    lookupAgentServerViaRegistry,
} from "./registryClient.js";
export type {
    AgentServerHandle,
    EnsureAgentServerOptions,
} from "./registryClient.js";
export type * from "@typeagent/dispatcher-rpc/types";
export type {
    ConversationInfo,
    JoinConversationResult,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
