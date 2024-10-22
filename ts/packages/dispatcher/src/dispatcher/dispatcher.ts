// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayType, DynamicDisplay } from "@typeagent/agent-sdk";
import {
    getCommandCompletion,
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

export type CommandCompletionResult = {
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

    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        id: string,
    ): Promise<DynamicDisplay>;
    getTemplateSchema(
        templateAgentName: string,
        templateName: string,
        data: unknown,
    ): Promise<TemplateSchema>;

    getTemplateCompletion(
        templateAgentName: string,
        templateName: string,
        data: unknown,
        propertyName: string,
    ): Promise<string[] | undefined>;

    getCommandCompletion(
        prefix: string,
    ): Promise<CommandCompletionResult | undefined>;
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
    templateAgentName: string,
    templateName: string,
    data: unknown,
): Promise<TemplateSchema> {
    const appAgent = context.agents.getAppAgent(templateAgentName);
    if (appAgent.getTemplateSchema === undefined) {
        throw new Error(
            `Template schema not supported by '${templateAgentName}'`,
        );
    }
    const sessionContext = context.agents.getSessionContext(templateAgentName);
    return appAgent.getTemplateSchema(templateName, data, sessionContext);
}

async function getTemplateCompletion(
    templateAgentName: string,
    templateName: string,
    data: unknown,
    propertyName: string,
    context: CommandHandlerContext,
) {
    const appAgent = context.agents.getAppAgent(templateAgentName);
    if (appAgent.getTemplateCompletion === undefined) {
        throw new Error(
            `Template schema not supported by '${templateAgentName}'`,
        );
    }
    const sessionContext = context.agents.getSessionContext(templateAgentName);
    return appAgent.getTemplateCompletion(
        templateName,
        data,
        propertyName,
        sessionContext,
    );
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
        getCommandCompletion(prefix) {
            return getCommandCompletion(prefix, context);
        },

        getDynamicDisplay(appAgentName, type, id) {
            return getDynamicDisplay(context, appAgentName, type, id);
        },
        getTemplateSchema(templateAgentName, templateName, data) {
            return getTemplateSchema(
                context,
                templateAgentName,
                templateName,
                data,
            );
        },
        getTemplateCompletion(
            templateAgentName,
            templateName,
            data,
            propertyName,
        ) {
            return getTemplateCompletion(
                templateAgentName,
                templateName,
                data,
                propertyName,
                context,
            );
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
