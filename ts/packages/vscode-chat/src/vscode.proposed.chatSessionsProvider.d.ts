/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module "vscode" {
    export enum ChatSessionStatus {
        Failed = 0,
        Completed = 1,
        InProgress = 2,
        NeedsInput = 3,
    }

    export namespace chat {
        export function createChatSessionItemController(
            chatSessionType: string,
            refreshHandler: ChatSessionItemControllerRefreshHandler,
        ): ChatSessionItemController;

        export function registerChatSessionContentProvider(
            scheme: string,
            provider: ChatSessionContentProvider,
            defaultChatParticipant: ChatParticipant,
            capabilities?: ChatSessionCapabilities,
        ): Disposable;
    }

    export type ChatSessionItemControllerRefreshHandler = (
        token: CancellationToken,
    ) => Thenable<void>;

    export interface ChatSessionItemControllerNewItemHandlerContext {
        readonly request: {
            readonly prompt: string;
            readonly command?: string;
        };
        readonly inputState: ChatSessionInputState;
    }

    export type ChatSessionItemControllerNewItemHandler = (
        context: ChatSessionItemControllerNewItemHandlerContext,
        token: CancellationToken,
    ) => Thenable<ChatSessionItem>;

    export interface ChatSessionItemController {
        readonly id: string;
        dispose(): void;
        readonly items: ChatSessionItemCollection;
        createChatSessionItem(resource: Uri, label: string): ChatSessionItem;
        readonly refreshHandler: ChatSessionItemControllerRefreshHandler;
        readonly onDidChangeChatSessionItemState: Event<ChatSessionItem>;
        newChatSessionItemHandler?: ChatSessionItemControllerNewItemHandler;
        resolveChatSessionItem?: (
            item: ChatSessionItem,
            token: CancellationToken,
        ) => Thenable<void>;
        createChatSessionInputState(
            groups: ChatSessionProviderOptionGroup[],
        ): ChatSessionInputState;
    }

    export interface ChatSessionItemCollection
        extends Iterable<readonly [id: Uri, chatSessionItem: ChatSessionItem]> {
        readonly size: number;
        replace(items: readonly ChatSessionItem[]): void;
        forEach(
            callback: (
                item: ChatSessionItem,
                collection: ChatSessionItemCollection,
            ) => unknown,
            thisArg?: any,
        ): void;
        add(item: ChatSessionItem): void;
        delete(resource: Uri): void;
        get(resource: Uri): ChatSessionItem | undefined;
    }

    export interface ChatSessionItem {
        readonly resource: Uri;
        label: string;
        iconPath?: IconPath;
        description?: string | MarkdownString;
        badge?: string | MarkdownString;
        status?: ChatSessionStatus;
        tooltip?: string | MarkdownString;
        archived?: boolean;
        readonly legacyResource?: Uri;
        timing?: {
            readonly created: number;
            readonly lastRequestStarted?: number;
            readonly lastRequestEnded?: number;
        };
        metadata?: { readonly [key: string]: any };
    }

    export interface ChatSession {
        readonly title?: string;
        readonly history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>;
        readonly activeResponseCallback?: (
            stream: ChatResponseStream,
            token: CancellationToken,
        ) => Thenable<void>;
        readonly requestHandler: ChatRequestHandler | undefined;
    }

    export interface ChatSessionContentProvider {
        provideChatSessionContent(
            resource: Uri,
            token: CancellationToken,
            context: {
                readonly inputState: ChatSessionInputState;
            },
        ): Thenable<ChatSession> | ChatSession;
    }

    export interface ChatContext {
        readonly chatSessionContext?: ChatSessionContext;
    }

    export interface ChatSessionContext {
        readonly chatSessionItem: ChatSessionItem;
        readonly isUntitled: boolean;
        readonly inputState: ChatSessionInputState;
    }

    export interface ChatSessionCapabilities {
        supportsInterruptions?: boolean;
    }

    export interface ChatSessionProviderOptionItem {
        readonly id: string;
        readonly name: string;
        readonly description?: string;
        readonly locked?: boolean;
        readonly icon?: ThemeIcon;
        readonly default?: boolean;
        readonly slashCommand?: string;
        readonly tooltip?: string;
    }

    export interface ChatSessionProviderOptionGroup {
        readonly id: string;
        readonly name: string;
        readonly description?: string;
        readonly selected?: ChatSessionProviderOptionItem;
        readonly items: readonly ChatSessionProviderOptionItem[];
        readonly when?: string;
        readonly icon?: ThemeIcon;
        readonly commands?: Command[];
        readonly kind?: "permissions";
    }

    export interface ChatSessionInputState {
        readonly onDidDispose: Event<void>;
        readonly onDidChange: Event<void>;
        readonly sessionResource: Uri | undefined;
        groups: readonly ChatSessionProviderOptionGroup[];
    }
}
