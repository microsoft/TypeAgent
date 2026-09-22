// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    StructuredActionClient,
    StructuredActionClientError,
} from "./structuredActionClient.js";
export type {
    StructuredActionClientOptions,
    StructuredActionBinding,
    StructuredActionClientErrorReason,
} from "./structuredActionClient.js";

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
    ConversationMatch,
    ConversationContentMatch,
    JoinConversationResult,
    DispatcherConnectOptions,
    SpeechToken,
    CatalogEntry,
    CatalogSearchResult,
    CatalogState,
    ChangeSkillStateRequest,
    GetSkillRequest,
    ListSkillsRequest,
    PublishSkillRequest,
    ReadSkillFileRequest,
    ReadSkillFileResponse,
    SearchSkillsRequest,
    SelectSkillRevisionRequest,
    SkillFileManifest,
    SkillIdentity,
    SkillRevision,
    SkillScope,
} from "@typeagent/agent-server-protocol";
export {
    AGENT_SERVER_DEFAULT_PORT,
    AGENT_SERVER_DEFAULT_URL,
} from "@typeagent/agent-server-protocol";
