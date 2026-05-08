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
    DEFAULT_WORKSPACE_KEY,
    ensureAgentServerForWorkspace,
    lookupAgentServerForWorkspace,
} from "./workspaceClient.js";
export type {
    AgentServerHandle,
    EnsureAgentServerOptions,
} from "./workspaceClient.js";
export type * from "@typeagent/dispatcher-rpc/types";
export type {
    ConversationInfo,
    JoinConversationResult,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
