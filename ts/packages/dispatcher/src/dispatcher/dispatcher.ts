// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayType, DynamicDisplay } from "@typeagent/agent-sdk";
import {
    getPartialCompletion,
    getPrompt,
    getSettingSummary,
    getTranslatorNameToEmojiMap,
    processCommand,
} from "./command.js";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
    initializeCommandHandlerContext,
    InitializeCommandHandlerContextOptions,
} from "../handlers/common/commandHandlerContext.js";
import { RequestId } from "../handlers/common/interactiveIO.js";
import { RequestMetrics } from "../utils/metrics.js";
import { TemplateSchema } from "../../../agentSdk/dist/templateInput.js";

export type PartialCompletionResult = {
    partial: string; // The head part of the completion
    space: boolean; // require space between partial and prefix
    prefix: string; // the prefix for completion match
    completions: string[]; // All the partial completions available after partial (and space if true)
};

export interface Dispatcher {
    processCommand(
        command: string,
        requestId?: RequestId,
        attachments?: string[],
    ): Promise<RequestMetrics | undefined>;
    getPartialCompletion(
        prefix: string,
    ): Promise<PartialCompletionResult | undefined>;
    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        id: string,
    ): Promise<DynamicDisplay>;
    getTemplateSchema(
        appAgentName: string,
        templateName: string,
        data: unknown,
    ): TemplateSchema;
    close(): Promise<void>;

    // TODO: Review these APIs
    getPrompt(): string;
    getSettingSummary(): string;
    getTranslatorNameToEmojiMap(): Map<string, string>;

    // TODO: Remove access to context
    getContext(): CommandHandlerContext;
}

async function getDynamicDisplay(
    context: CommandHandlerContext,
    appAgentName: string,
    type: DisplayType,
    displayId: string,
): Promise<DynamicDisplay> {
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.getDynamicDisplay === undefined) {
        throw new Error(`Dynamic display not supported by '${appAgentName}'`);
    }
    const sessionContext = context.agents.getSessionContext(appAgentName);
    return appAgent.getDynamicDisplay(type, displayId, sessionContext);
}

function getTemplateSchema(
    context: CommandHandlerContext,
    appAgentName: string,
    templateName: string,
    data: unknown,
): TemplateSchema {
    const appAgent = context.agents.getAppAgent(appAgentName);
    if (appAgent.getTemplateSchema === undefined) {
        throw new Error(`Template schema not supported by '${appAgentName}'`);
    }
    const sessionContext = context.agents.getSessionContext(appAgentName);
    return appAgent.getTemplateSchema(templateName, data, sessionContext);
}

export type DispatcherOptions = InitializeCommandHandlerContextOptions;
export async function createDispatcher(
    hostName: string,
    options: DispatcherOptions,
): Promise<Dispatcher> {
    const context = await initializeCommandHandlerContext(hostName, options);
    return {
        processCommand(command, requestId, attachments) {
            return processCommand(command, context, requestId, attachments);
        },
        getPartialCompletion(prefix) {
            return getPartialCompletion(prefix, context);
        },
        getDynamicDisplay(appAgentName, type, id) {
            return getDynamicDisplay(context, appAgentName, type, id);
        },
        getTemplateSchema(appAgentName, templateName, data) {
            return getTemplateSchema(context, appAgentName, templateName, data);
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
