// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentEvent,
    DisplayAppendMode,
    DisplayContent,
    DisplayType,
    StorageListOptions,
} from "@typeagent/agent-sdk";
import { JSONAction } from "agent-cache";

export type AgentContextCallFunctions = {
    notify(param: {
        contextId: number;
        event: AppAgentEvent;
        message: string;
    }): void;
    setDisplay: (param: {
        actionContextId: number;
        content: DisplayContent;
    }) => void;
    appendDisplay: (param: {
        actionContextId: number;
        content: DisplayContent;
        mode: DisplayAppendMode;
    }) => void;
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
    streamPartialAction: (
        param: Partial<ContextParams> & {
            actionName: string;
            name: string;
            value: string;
            delta: string | undefined;
        },
    ) => void;
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
    closeAgentContext: (param: Partial<ContextParams>) => Promise<any>;
    getCommands: (param: Partial<ContextParams>) => Promise<any>;
    executeCommand(
        param: Partial<ActionContextParams> & {
            commands: string[];
            args: string;
        },
    ): Promise<void>;
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
