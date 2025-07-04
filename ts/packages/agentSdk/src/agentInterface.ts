// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction, ActionResult, TypeAgentAction } from "./action.js";
import { AppAgentCommandInterface } from "./command.js";
import { ActionIO, DisplayType, DynamicDisplay } from "./display.js";
import { Entity } from "./memory.js";
import { Profiler } from "./profiler.js";
import { TemplateSchema } from "./templateInput.js";

//==============================================================================
// Manifest
//==============================================================================
export type AppAgentManifest = {
    emojiChar: string;
    description: string;
    commandDefaultEnabled?: boolean;
    localView?: boolean; // whether the agent serve a local view, default is false
    sharedLocalView?: string[]; // list of agents to share the local view with, default is none
} & ActionManifest;

export type SchemaTypeNames = {
    action?: string;
    activity?: string;
    entities?: string;
};

export type SchemaFormat = "ts" | "pas";
export type SchemaManifest = {
    description: string;
    schemaType: string | SchemaTypeNames; // string if there are only action schemas
    schemaFile: string | { format: SchemaFormat; content: string };
    injected?: boolean; // whether the translator is injected into other domains, default is false
    cached?: boolean; // whether the translator's action should be cached, default is true
    streamingActions?: string[];
};

export type ActionManifest = {
    defaultEnabled?: boolean;
    schemaDefaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
    transient?: boolean; // whether the translator is transient, default is false

    schema?: SchemaManifest;
    subActionManifests?: { [key: string]: ActionManifest };
};

//==============================================================================
// App Agent
//==============================================================================

export type AppAgentInitSettings = {
    localHostPort?: number; // the assigned port to use to serve the view if localHostPort is true in the manifest
    options?: unknown; // additional options specific for the agent initialization
};

export type ResolveEntityResult = {
    match: "exact" | "fuzzy";
    entities: Entity[];
};

export interface AppAgent extends Partial<AppAgentCommandInterface> {
    // Setup
    initializeAgentContext?(settings?: AppAgentInitSettings): Promise<unknown>;
    updateAgentContext?(
        enable: boolean,
        context: SessionContext,
        schemaName: string, // for sub-action schemas
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
        action: TypeAgentAction,
        context: ActionContext<unknown>,
    ): Promise<ActionResult | undefined>;

    // Cache extensions
    validateWildcardMatch?(
        action: AppAction,
        context: SessionContext,
    ): Promise<boolean>;

    // Input
    resolveEntity?(
        type: string,
        name: string,
        context: SessionContext,
    ): Promise<ResolveEntityResult | undefined>;
    getTemplateSchema?(
        templateName: string,
        data: unknown,
        context: SessionContext,
    ): Promise<TemplateSchema>;
    getTemplateCompletion?(
        templateName: string,
        data: unknown,
        propertyName: string,
        context: SessionContext,
    ): Promise<string[]>;
    // For action template
    getActionCompletion?(
        partialAction: AppAction, // action schemaName and actionName are validated by the dispatcher.
        propertyName: string,
        context: SessionContext,
    ): Promise<string[]>;
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
    readonly instanceStorage: Storage | undefined; // storage that are preserved across sessions

    notify(event: AppAgentEvent, message: string): void;

    // choices default to ["Yes", "No"]
    popupQuestion(
        message: string,
        choices?: string[],
        defaultId?: number,
    ): Promise<number>;

    // can only toggle the sub agent of the current agent
    toggleTransientAgent(agentName: string, active: boolean): Promise<void>;

    // Only for selected agents (browser) can dynamically add agent. Throw if not permitted.
    addDynamicAgent(
        agentName: string,
        manifest: AppAgentManifest,
        appAgent: AppAgent,
    ): Promise<void>;

    removeDynamicAgent(agentName: string): Promise<void>;

    // Experimental: get the shared local host port
    getSharedLocalHostPort(agentName: string): Promise<number>;

    // Experimental: get the available indexes
    indexes(type: "image" | "email" | "website" | "all"): Promise<any[]>;
}

// TODO: only utf8 & base64 is supported for now.
export type StorageEncoding = "utf8" | "base64";

export type StorageListOptions = {
    dirs?: boolean;
    fullPath?: boolean;
};

export interface TokenCachePersistence {
    load(): Promise<string | null>;
    save(token: string): Promise<void>;
    delete(): Promise<boolean>;
}

export interface Storage {
    read(storagePath: string): Promise<Uint8Array>;
    read(storagePath: string, options: StorageEncoding): Promise<string>;
    write(
        storagePath: string,
        data: string,
        options?: StorageEncoding, // default is utf8
    ): Promise<void>;
    write(storagePath: string, data: Uint8Array): Promise<void>;
    list(storagePath: string, options?: StorageListOptions): Promise<string[]>;
    exists(storagePath: string): Promise<boolean>;
    delete(storagePath: string): Promise<void>;

    getTokenCachePersistence(): Promise<TokenCachePersistence>;
}

export type ActivityContext<T = Record<string, unknown>> = {
    appAgentName: string;
    activityName: string;
    description: string;
    state: T;
    openLocalView?: boolean | undefined;
    activityEndAction?: AppAction | undefined;
};

export interface ActionContext<T = void> {
    profiler?: Profiler | undefined;
    streamingContext: unknown;
    readonly activityContext: ActivityContext | undefined;
    readonly actionIO: ActionIO;
    readonly sessionContext: SessionContext<T>;

    // queue up toggle transient agent to be executed at the end of the commands
    queueToggleTransientAgent(
        agentName: string,
        active: boolean,
    ): Promise<void>;
}
