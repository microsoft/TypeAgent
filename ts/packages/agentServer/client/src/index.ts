// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    connectAgentServer,
    createAgentServerConnection,
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
    getConnectOptionsFromEnv,
} from "./agentServerClient.js";
export type {
    AgentServerSpawnOptions,
    AgentServerConnectOptions,
} from "./agentServerClient.js";
export type * from "@typeagent/dispatcher-rpc/types";
export type {
    ConversationInfo,
    JoinConversationResult,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
export {
    AGENT_SERVER_DEFAULT_PORT,
    AGENT_SERVER_DEFAULT_URL,
} from "@typeagent/agent-server-protocol";
