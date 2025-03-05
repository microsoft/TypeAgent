// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import {
    getPrompt,
    getSettingSummary,
    getTranslatorNameToEmojiMap,
    processCommand,
} from "./command/command.js";
import {
    CommandCompletionResult,
    getCommandCompletion,
} from "./command/completion.js";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
    DispatcherOptions,
    initializeCommandHandlerContext,
} from "./context/commandHandlerContext.js";
import { RequestId } from "./context/interactiveIO.js";
import { RequestMetrics } from "./utils/metrics.js";
import { FullAction } from "agent-cache";
import { openai as ai } from "aiclient";

export type CommandResult = {
    hasError?: boolean;
    exception?: string;
    actions?: FullAction[];
    metrics?: RequestMetrics;
    tokenUsage?: ai.CompletionUsageStats;
};

export interface Dispatcher {
    processCommand(
        command: string,
        requestId?: RequestId,
        attachments?: string[],
    ): Promise<CommandResult | undefined>;

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

export async function createDispatcher(
    hostName: string,
    options?: DispatcherOptions,
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
    };
}
