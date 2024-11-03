// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    AppAction,
    AppAgentEvent,
    CommandDescriptors,
    DisplayAppendMode,
    DisplayContent,
    DisplayType,
    DynamicDisplay,
    ParameterDefinitions,
    ParsedCommandParams,
    StorageListOptions,
    TemplateSchema,
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
    takeAction: (param: { actionContextId: number; action: string }) => void;
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
        options?: StorageListOptions | undefined;
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
    initializeAgentContext: () => Promise<unknown>;
    updateAgentContext: (
        param: Partial<ContextParams> & {
            enable: boolean;
            translatorName: string;
        },
    ) => Promise<void>;
    executeAction: (
        param: Partial<ActionContextParams> & { action: JSONAction },
    ) => Promise<ActionResult | undefined>;
    validateWildcardMatch: (
        param: Partial<ContextParams> & { action: JSONAction },
    ) => Promise<boolean>;
    getDynamicDisplay: (
        param: Partial<ContextParams> & {
            type: DisplayType;
            displayId: string;
        },
    ) => Promise<DynamicDisplay>;
    closeAgentContext: (param: Partial<ContextParams>) => Promise<void>;
    getCommands: (param: Partial<ContextParams>) => Promise<CommandDescriptors>;
    getCommandCompletion(
        param: Partial<ContextParams> & {
            commands: string[];
            params: ParsedCommandParams<ParameterDefinitions>;
            names: string[];
        },
    ): Promise<string[]>;
    executeCommand(
        param: Partial<ActionContextParams> & {
            commands: string[];
            params: ParsedCommandParams<ParameterDefinitions> | undefined;
        },
    ): Promise<void>;
    getTemplateSchema(
        param: Partial<ContextParams> & {
            templateName: string;
            data: unknown;
        },
    ): Promise<TemplateSchema>;
    getTemplateCompletion(
        param: Partial<ContextParams> & {
            templateName: string;
            data: unknown;
            propertyName: string;
        },
    ): Promise<string[]>;
    getActionCompletion(
        param: Partial<ContextParams> & {
            partialAction: AppAction;
            propertyName: string;
        },
    ): Promise<string[]>;
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
