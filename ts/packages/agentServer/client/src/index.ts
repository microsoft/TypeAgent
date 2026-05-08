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
    waitForDiscoveryFile,
    writeServerPid,
    removeServerPid,
} from "./agentServerClient.js";
export {
    ensureAgentServerViaDiscovery,
    lookupAgentServerViaDiscovery,
} from "./discoveryClient.js";
export type {
    AgentServerHandle,
    EnsureAgentServerOptions,
} from "./discoveryClient.js";
export {
    DISCOVERY_FILE_NAME,
    getDiscoveryFilePath,
    readDiscoveryFile,
    writeDiscoveryFile,
    removeDiscoveryFile,
    isProcessAlive,
} from "./discovery.js";
export type { DiscoveryRecord } from "./discovery.js";
export type * from "@typeagent/dispatcher-rpc/types";
export type {
    ConversationInfo,
    JoinConversationResult,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
