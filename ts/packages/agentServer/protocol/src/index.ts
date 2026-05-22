// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    DispatcherConnectOptions,
    AgentServerInvokeFunctions,
    AgentServerChannelName,
    AGENT_SERVER_DEFAULT_PORT,
    AGENT_SERVER_DEFAULT_URL,
    AGENT_SERVER_DISCOVERY_NAME,
    DiscoveryChannelName,
    DiscoveryInvokeFunctions,
    createDiscoveryHandlers,
    ConversationInfo,
    JoinConversationResult,
    UserIdentity,
    DefaultUserIdentity,
    getDispatcherChannelName,
    getClientIOChannelName,
    registerClientType,
    getClientType,
    unregisterClient,
} from "./protocol.js";

export type {
    QueueRequestState,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
    QueueEventVersion,
    SubmitResult,
    CancelResult,
} from "./queue.js";
export { QueueFullError, ServerStoppingError } from "./queue.js";
