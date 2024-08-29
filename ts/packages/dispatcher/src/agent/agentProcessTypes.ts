// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ShimContext =
    | {
          contextId: number;
      }
    | undefined;

export enum AgentInvokeAPI {
    InitializeAgentContext = "initializeAgentContext",
    UpdateAgentContext = "updateAgentContext",
    ExecuteAction = "executeAction",
    ValidateWildcardMatch = "validateWildcardMatch",
    CloseAgentContext = "closeAgentContext",
}

export enum AgentCallAPI {
    StreamPartialAction = "streamPartialAction",
}

export const enum AgentContextCallAPI {
    // SessionContext
    AgentIOStatus = "agentIOStatus",
    AgentIOSuccess = "agentIOSuccess",
    SetActionStatus = "agentIOSetActionStatus",

    // ActionContext.actionIO
    SetActionDisplay = "setActionDisplay",
}

export const enum AgentContextInvokeAPI {
    // Storage
    StorageRead = "storageRead",
    StorageWrite = "storageWrite",
    StorageList = "storageList",
    StorageExists = "storageExists",
    StorageDelete = "storageDelete",

    TokenCachePersistenceLoad = "tokenCacheRead",
    TokenCachePersistenceSave = "tokenCacheWrite",

    // Context
    IssueCommand = "issueCommand",
    ToggleAgent = "toggleAgent",
}

export type InitializeMessage = {
    type: "initialized";
    agentInterface: AgentInvokeAPI[];
};

export type ContextParams = {
    contextId: number;
    hasSessionStorage: boolean;
    agentContextId: number | undefined;
};

export type ActionContextParams = ContextParams & {
    actionContextId: number;
};
