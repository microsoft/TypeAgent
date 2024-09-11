// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayType, DynamicDisplay } from "@typeagent/agent-sdk";
import {
    getPrompt,
    getSettingSummary,
    getTranslatorNameToEmojiMap,
    processCommand,
} from "../command.js";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
    initializeCommandHandlerContext,
    InitializeCommandHandlerContextOptions,
} from "../handlers/common/commandHandlerContext.js";
import { getDynamicDisplay } from "../action/actionHandlers.js";
import { RequestId } from "../handlers/common/interactiveIO.js";

export interface Dispatcher {
    processCommand(
        command: string,
        requestId?: RequestId,
        attachments?: string[],
    ): Promise<void>;
    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        id: string,
    ): Promise<DynamicDisplay>;
    close(): Promise<void>;

    // TODO: Review these APIs
    getPrompt(): string;
    getSettingSummary(): string;
    getTranslatorNameToEmojiMap(): Map<string, string>;

    // TODO: Remove access to context
    getContext(): CommandHandlerContext;
}

export type DispatcherOptions = InitializeCommandHandlerContextOptions;
export async function createDispatcher(
    hostName: string,
    options: DispatcherOptions,
): Promise<Dispatcher> {
    const context = await initializeCommandHandlerContext(
        hostName,
        options,
    );
    return {
        processCommand(command, requestId, attachments) {
            return processCommand(command, context, requestId, attachments);
        },
        getDynamicDisplay(appAgentName, type, id) {
            return getDynamicDisplay(context, appAgentName, type, id);
        },
        async close() {
            await closeCommandHandlerContext(context);
        },
        getPrompt() {
            return getPrompt(context);
        },
        getSettingSummary() {
            return getSettingSummary(context);
        },
        getTranslatorNameToEmojiMap() {
            return getTranslatorNameToEmojiMap(context);
        },
        getContext() {
            return context;
        },
    };
}
