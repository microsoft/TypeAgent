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
    PartialInput = "partialInput",
    ValidateWildcardMatch = "validateWildcardMatch",
    CloseAgentContext = "closeAgentContext",
}

export const enum AgentContextCallAPI {
    // DispatcherAgentContext
    AgentIOClear = "agentIOClear",
    AgentIOInfo = "agentIOInfo",
    AgentIOStatus = "agentIOStatus",
    AgentIOSuccess = "agentIOSuccess",
    AgentIOWarn = "agentIOWarn",
    AgentIOError = "agentIOError",
    AgentIOResult = "agentIOResult",
    SetActionStatus = "agentIOSetActionStatus",
}

export const enum AgentContextInvokeAPI {
    // Storage
    StorageRead = "storageRead",
    StorageWrite = "storageWrite",
    StorageList = "storageList",
    StorageExists = "storageExists",
    StorageDelete = "storageDelete",

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
