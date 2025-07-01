// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    ActivityContext,
    AppAction,
    AppAgentEvent,
    AppAgentInitSettings,
    AppAgentManifest,
    ClientAction,
    CommandDescriptors,
    DisplayAppendMode,
    DisplayContent,
    DisplayType,
    DynamicDisplay,
    ParameterDefinitions,
    ParsedCommandParams,
    StorageEncoding,
    StorageListOptions,
    TemplateSchema,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { ResolveEntityResult } from "../../agentSdk/dist/agentInterface.js";
import { AgentInterfaceFunctionName } from "./server.js";

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
    takeAction: (param: {
        actionContextId: number;
        action: ClientAction;
        data?: unknown;
    }) => void;
    appendDiagnosticData: (param: {
        actionContextId: number;
        data: any;
    }) => void;
};

export type AgentContextInvokeFunctions = {
    storageRead: (param: {
        contextId: number;
        session: boolean;
        storagePath: string;
        options?: StorageEncoding | undefined;
    }) => Promise<any>;
    storageWrite: (param: {
        contextId: number;
        session: boolean;
        storagePath: string;
        data: string;
        options?: StorageEncoding | undefined;
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
    tokenCacheDelete: (param: {
        contextId: number;
        session: boolean;
    }) => Promise<any>;
    toggleTransientAgent: (param: {
        contextId: number;
        name: string;
        enable: boolean;
    }) => Promise<any>;
    addDynamicAgent: (param: {
        contextId: number;
        name: string;
        manifest: AppAgentManifest;
        agentInterface: AgentInterfaceFunctionName[];
    }) => Promise<void>;
    removeDynamicAgent: (param: {
        contextId: number;
        name: string;
    }) => Promise<void>;
    getSharedLocalHostPort: (param: {
        contextId: number;
        agentName: string;
    }) => Promise<number>;
    indexes: (param: { contextId: number; type: string }) => Promise<any>;
    popupQuestion: (param: {
        contextId: number;
        message: string;
        choices?: string[] | undefined;
        defaultId?: number | undefined;
    }) => Promise<number>;

    queueToggleTransientAgent: (
        contextId: number,
        agentName: string,
        active: boolean,
    ) => Promise<void>;
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
    initializeAgentContext: (param: {
        settings: AppAgentInitSettings | undefined;
        optionsCallBack:
            | {
                  id: number;
                  functions: string[];
              }
            | undefined;
    }) => Promise<unknown>;
    updateAgentContext: (
        param: Partial<ContextParams> & {
            enable: boolean;
            schemaName: string;
        },
    ) => Promise<void>;
    executeAction: (
        param: Partial<ActionContextParams> & {
            action: TypeAgentAction;
        },
    ) => Promise<ActionResult | undefined>;
    validateWildcardMatch: (
        param: Partial<ContextParams> & { action: AppAction },
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
    resolveEntity(
        param: Partial<ContextParams> & {
            type: string;
            name: string;
        },
    ): Promise<ResolveEntityResult | undefined>;
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

export type ContextParams = {
    contextId: number;
    hasInstanceStorage: boolean;
    hasSessionStorage: boolean;
    agentContextId: number | undefined;
};

export type ActionContextParams = ContextParams & {
    actionContextId: number;
    activityContext: ActivityContext | undefined;
};

export type OptionsFunctionCallBack = {
    callback(param: {
        name: string;
        id: number;
        args: unknown[];
    }): Promise<unknown>;
};
