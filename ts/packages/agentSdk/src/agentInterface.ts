// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TODO: remove duplicate type
export type SearchMenuItem = {
    matchText: string;
    selectedText: string;
    emojiChar?: string;
    groupName?: string;
};

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
    };
    subTranslators?: { [key: string]: HierarchicalTranslatorConfig };
};

export interface DispatcherAction {
    actionName: string;
    translatorName?: string | undefined;
}

export interface DispatcherActionWithParameters extends DispatcherAction {
    parameters: { [key: string]: any };
}

export interface DispatcherAgent {
    initializeAgentContext?(): Promise<any>;
    updateAgentContext?(
        enable: boolean,
        context: DispatcherAgentContext,
        translatorName: string, // for sub-translators
    ): Promise<void>;
    executeAction?(
        action: DispatcherAction,
        context: DispatcherAgentContext,
        actionIndex: number, // TODO: can we avoid passing this index?
    ): Promise<any>; // TODO: define return type.
    partialInput?(text: string, context: DispatcherAgentContext): void;
    validateWildcardMatch?(
        action: DispatcherAction,
        context: DispatcherAgentContext,
    ): Promise<boolean>;
    closeAgentContext?(context: DispatcherAgentContext): Promise<void>;
}

export interface DispatcherAgentContext<T = any> {
    readonly context: T;

    // TODO: review if these should be exposed.
    readonly requestIO: DispatcherAgentIO;
    readonly requestId: RequestId;
    readonly sessionStorage: Storage | undefined;
    readonly profileStorage: Storage; // storage that are preserved across sessions
    currentTranslatorName: string;
    issueCommand(command: string): Promise<void>;
    getUpdateActionStatus():
        | ((message: string, group_id: string) => void)
        | undefined;

    searchMenuCommand(
        menuId: string,
        command: SearchMenuCommand,
        prefix?: string,
        choices?: SearchMenuItem[],
        visible?: boolean,
    ): void;
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

export interface DispatcherAgentIO {
    type: "html" | "text";
    clear(): void;
    info(message: string): void;
    status(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    result(message: string): void;

    // Action status
    setActionStatus(
        message: string,
        actionIndex: number,
        groupId?: string,
    ): void;
}

export type SearchMenuCommand =
    | "register"
    | "legend"
    | "complete"
    | "cancel"
    | "show"
    | "remove";

export type SearchMenuState = "active" | "inactive";

export type SearchMenuContext = {
    state: SearchMenuState;
    menuId: string;
    lastPrefix: string;
    choices?: string[];
};
