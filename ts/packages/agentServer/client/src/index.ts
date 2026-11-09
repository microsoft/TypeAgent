// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    StructuredActionClient,
    StructuredActionClientError,
} from "./structuredActionClient.js";
export type {
    StructuredActionBinding,
    StructuredActionClientErrorReason,
    StructuredActionClientOptions,
} from "./structuredActionClient.js";

export {
    AGENT_SERVER_DEFAULT_PORT,
    AGENT_SERVER_DEFAULT_URL,
} from "@typeagent/agent-server-protocol";
export type {
    CatalogEntry,
    CatalogSearchResult,
    CatalogState,
    ChangeSkillStateRequest,
    CheckSkillUpdateResponse,
    ConversationContentMatch,
    ConversationInfo,
    ConversationMatch,
    DispatcherConnectOptions,
    GetSkillRequest,
    JoinConversationResult,
    ListSkillsRequest,
    MacroDraftResult,
    PublishSkillRequest,
    ReadSkillFileRequest,
    ReadSkillFileResponse,
    SearchSkillsRequest,
    SelectSkillRevisionRequest,
    SkillAcquisitionPreview,
    SkillAcquisitionRequest,
    SkillAcquisitionRevisionResponse,
    SkillAcquisitionSource,
    SkillFileManifest,
    SkillGrammarRoutingResult,
    SkillIdentity,
    SkillRevision,
    SkillScope,
    SkillUpdateCheck,
    SpeechToken,
} from "@typeagent/agent-server-protocol";
export type * from "@typeagent/dispatcher-rpc/types";
export {
    AgentServerConnection,
    ConversationDispatcher,
    connectAgentServer,
    connectDispatcher,
    createAgentServerConnection,
    ensureAgentServer,
    ensureAndConnectConversation,
    ensureAndConnectDispatcher,
    getConnectOptionsFromEnv,
    isServerRunning,
    removeServerPid,
    stopAgentServer,
    writeServerPid,
} from "./agentServerClient.js";
export type {
    AgentServerConnectOptions,
    AgentServerSpawnOptions,
} from "./agentServerClient.js";
