// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionIO, DisplayType, DynamicDisplay } from "./display.js";
import { ActionResult } from "./memory.js";
import { Profiler } from "./profiler.js";

//==============================================================================
// Manifest
//==============================================================================
export type AppAgentManifest = {
    emojiChar: string;
    commandDefaultEnabled?: boolean;
} & TranslatorDefinition;

export type SchemaDefinition = {
    description: string;
    schemaType: string;
    schemaFile: string;
    injected?: boolean; // whether the translator is injected into other domains, default is false
    cached?: boolean; // whether the translator's action should be cached, default is true
    streamingActions?: string[];
};

export type TranslatorDefinition = {
    defaultEnabled?: boolean;
    translationDefaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
    transient?: boolean; // whether the translator is transient, default is false

    schema?: SchemaDefinition;
    subTranslators?: { [key: string]: TranslatorDefinition };
};

//==============================================================================
// App Agent
//==============================================================================
export interface AppAction {
    actionName: string;
    translatorName?: string | undefined;
}

export interface AppActionWithParameters extends AppAction {
    parameters: { [key: string]: any };
}

export type CommandDescriptor = {
    description: string;
    help?: string;
};

export type CommandDescriptorTable = {
    description: string;
    commands: Record<string, CommandDescriptors>;
    defaultSubCommand?: CommandDescriptor | undefined;
};

export type CommandDescriptors = CommandDescriptor | CommandDescriptorTable;

export interface AppAgentCommandInterface {
    // Commands
    getCommands(context: SessionContext): Promise<CommandDescriptors>;

    executeCommand(
        commands: string[],
        args: string,
        context: ActionContext<unknown>,
        attachments?: string[],
    ): Promise<void>;
}

export interface AppAgent extends Partial<AppAgentCommandInterface> {
    // Setup
    initializeAgentContext?(): Promise<unknown>;
    updateAgentContext?(
        enable: boolean,
        context: SessionContext,
        translatorName: string, // for sub-translators
    ): Promise<void>;
    closeAgentContext?(context: SessionContext): Promise<void>;

    // Actions
    streamPartialAction?(
        actionName: string,
        name: string,
        value: string,
        delta: string | undefined,
        context: ActionContext<unknown>,
    ): void;
    executeAction?(
        action: AppAction,
        context: ActionContext<unknown>,
    ): Promise<ActionResult | undefined>;

    // Cache extensions
    validateWildcardMatch?(
        action: AppAction,
        context: SessionContext,
    ): Promise<boolean>;

    // Output
    getDynamicDisplay?(
        type: DisplayType,
        dynamicDisplayId: string,
        context: SessionContext,
    ): Promise<DynamicDisplay>;
}

//==============================================================================
// Context
//==============================================================================
export enum AppAgentEvent {
    Error = "error",
    Warning = "warning",
    Info = "info",
    Debug = "debug",
}

export interface SessionContext<T = unknown> {
    readonly agentContext: T;
    readonly sessionStorage: Storage | undefined;
    readonly profileStorage: Storage; // storage that are preserved across sessions

    notify(event: AppAgentEvent, message: string): void;

    // can only toggle the sub agent of the current agent
    toggleTransientAgent(agentName: string, active: boolean): Promise<void>;
}

// TODO: only utf8 is supported for now.
export type StorageEncoding = "utf8";

export type StorageListOptions = {
    dirs?: boolean;
};

export interface TokenCachePersistence {
    load(): Promise<string | null>;
    save(token: string): Promise<void>;
}

export interface Storage {
    read(storagePath: string, options: StorageEncoding): Promise<string>;
    write(storagePath: string, data: string): Promise<void>;
    list(storagePath: string, options?: StorageListOptions): Promise<string[]>;
    exists(storagePath: string): Promise<boolean>;
    delete(storagePath: string): Promise<void>;

    getTokenCachePersistence(): Promise<TokenCachePersistence>;
}

export interface ActionContext<T = void> {
    profiler?: Profiler | undefined;
    streamingContext: unknown;
    readonly actionIO: ActionIO;
    readonly sessionContext: SessionContext<T>;
}
