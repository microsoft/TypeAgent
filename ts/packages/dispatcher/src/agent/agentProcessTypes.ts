// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayType, StorageListOptions } from "@typeagent/agent-sdk";
import { JSONAction } from "agent-cache";

export type AgentContextCallFunctions = {
    agentIOStatus: (param: { contextId: number; message: string }) => void;
    agentIOSuccess: (param: { contextId: number; message: string }) => void;
    setActionStatus: (param: {
        contextId: number;
        message: string;
        actionIndex: number;
    }) => void;
    setActionDisplay: (param: {
        actionContextId: number;
        message: string;
    }) => void;
    performanceMark: (param: { actionContextId: number; name: string }) => void;
};

export type AgentContextInvokeFunctions = {
    storageRead: (param: {
        contextId: number;
        session: boolean;
        storagePath: string;
        options: any;
    }) => Promise<any>;
    storageWrite: (param: {
        contextId: number;
        session: boolean;
        storagePath: string;
        data: string;
    }) => Promise<any>;
    storageList: (param: {
        contextId: number;
        session: boolean;
        storagePath: string;
        options: StorageListOptions;
    }) => Promise<any>;
    storageExists: (param: {
        contextId: number;
        session: boolean;
        storagePath: string;
    }) => Promise<any>;
    storageDelete: (param: {
        contextId: number;
        session: boolean;
        storagePath: string;
    }) => Promise<any>;
    tokenCacheRead: (param: {
        contextId: number;
        session: boolean;
    }) => Promise<any>;
    tokenCacheWrite: (param: {
        contextId: number;
        session: boolean;
        token: string;
    }) => Promise<any>;
    toggleTransientAgent: (param: {
        contextId: number;
        name: string;
        enable: boolean;
    }) => Promise<any>;
};

export type AgentCallFunctions = {
    streamPartialAction: (param: any) => void;
};

export type AgentInvokeFunctions = {
    initializeAgentContext: () => Promise<any>;
    updateAgentContext: (
        param: Partial<ContextParams> & {
            enable: boolean;
            translatorName: string;
        },
    ) => Promise<any>;
    executeAction: (
        param: Partial<ActionContextParams> & { action: JSONAction },
    ) => Promise<any>;
    validateWildcardMatch: (
        param: Partial<ContextParams> & { action: JSONAction },
    ) => Promise<any>;
    getDynamicDisplay: (
        param: Partial<ContextParams> & {
            type: DisplayType;
            displayId: string;
        },
    ) => Promise<any>;
    streamPartialAction: (
        param: Partial<ContextParams> & {
            actionName: string;
            type: string;
            displayId: string;
            partial: boolean;
        },
    ) => Promise<any>;
    closeAgentContext: (param: Partial<ContextParams>) => Promise<any>;
};

export type InitializeMessage = {
    type: "initialized";
    agentInterface: (keyof AgentInvokeFunctions)[];
};

export type ContextParams = {
    contextId: number;
    hasSessionStorage: boolean;
    agentContextId: number | undefined;
};

export type ActionContextParams = ContextParams & {
    actionContextId: number;
};
