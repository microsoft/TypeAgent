// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TopLevelTranslatorConfig = {
    emojiChar: string;
} & HierarchicalTranslatorConfig;

export type HierarchicalTranslatorConfig = {
    defaultEnabled?: boolean;
    actionDefaultEnabled?: boolean;
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

export interface AppAgent {
    initializeAgentContext?(): Promise<any>;
    updateAgentContext?(
        enable: boolean,
        context: SessionContext,
        translatorName: string, // for sub-translators
    ): Promise<void>;
    streamPartialAction?(
        actionName: string,
        name: string,
        value: string,
        partial: boolean,
        context: SessionContext,
    ): void;
    executeAction?(
        action: AppAction,
        context: ActionContext<any>,
    ): Promise<any>; // TODO: define return type.
    validateWildcardMatch?(
        action: AppAction,
        context: SessionContext,
    ): Promise<boolean>;

    getDynamicDisplay?(
        type: DisplayType,
        dynamicDisplayId: string,
        context: SessionContext,
    ): Promise<DynamicDisplay>;
    closeAgentContext?(context: SessionContext): Promise<void>;
}

export interface SessionContext<T = any> {
    readonly agentContext: T;

    // TODO: review if these should be exposed.
    readonly agentIO: AppAgentIO;
    readonly requestId: RequestId;
    readonly sessionStorage: Storage | undefined;
    readonly profileStorage: Storage; // storage that are preserved across sessions
    currentTranslatorName: string;
    issueCommand(command: string): Promise<void>;
    toggleAgent(name: string, enable: boolean): Promise<void>;
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

// TODO: review if these should be exposed. Duplicated from dispatcher's interactiveIO.ts
export type RequestId = string | undefined;
export interface AppAgentIO {
    readonly type: DisplayType;
    status(message: string): void;
    success(message: string): void;

    // Action status
    setActionStatus(message: string, actionIndex: number): void;
}

export interface ActionIO {
    readonly type: DisplayType;
    setActionDisplay(content: string): void;
}

export interface ActionContext<T = void> {
    readonly actionIO: ActionIO;
    readonly sessionContext: SessionContext<T>;
}
