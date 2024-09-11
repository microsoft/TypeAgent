// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TopLevelTranslatorConfig = {
    emojiChar: string;
} & HierarchicalTranslatorConfig;

export type HierarchicalTranslatorConfig = {
    translationDefaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
    transient?: boolean; // whether the translator is transient, default is false
    schema?: {
        description: string;
        schemaFile: string;
        schemaType: string;
        constructions?: {
            data: string[];
            file: string;
        };
        translations?: string[];
        dataFrameColumns?: { [key: string]: string };
        injected?: boolean; // whether the translator is injected into other domains, default is false
        cached?: boolean; // whether the translator's action should be cached, default is true
        streamingActions?: string[];
    };
    subTranslators?: { [key: string]: HierarchicalTranslatorConfig };
};

export interface AppAction {
    actionName: string;
    translatorName?: string | undefined;
}

export interface AppActionWithParameters extends AppAction {
    parameters: { [key: string]: any };
}

export type DisplayType = "html" | "text";

export type DynamicDisplay = {
    content: string;
    nextRefreshMs: number; // in milliseconds, -1 means no more refresh.
};

export type CommandDescriptor = {
    description: string;
    help?: string;
};

export type CommandDescriptorTable = {
    description: string;
    commands: Record<string, CommandDescriptor | CommandDescriptorTable>;
    defaultSubCommand?: CommandDescriptor | undefined;
};

export interface AppAgentCommandInterface {
    // Commands
    getCommands(
        context: SessionContext,
    ): Promise<CommandDescriptor | CommandDescriptorTable>;

    executeCommand(
        command: string[] | undefined,
        args: string,
        context: ActionContext<unknown>,
        attachments?: string[],
    ): Promise<void>;
}

export interface AppAgent extends Partial<AppAgentCommandInterface> {
    // Setup
    initializeAgentContext?(): Promise<any>;
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
        partial: boolean,
        context: ActionContext<unknown>,
    ): void;
    executeAction?(
        action: AppAction,
        context: ActionContext<unknown>,
    ): Promise<any>; // TODO: define return type.

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

export interface ActionIO {
    readonly type: DisplayType;
    setActionDisplay(content: string): void;
}

export interface ActionContext<T = void> {
    readonly actionIO: ActionIO;
    readonly sessionContext: SessionContext<T>;
    performanceMark(markName: string): void;
}
