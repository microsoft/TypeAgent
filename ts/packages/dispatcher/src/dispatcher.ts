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

/**
 * A dispatcher instance
 */
export interface Dispatcher {
    /**
     * Process a single user request.
     *
     * @param command user request to process.  Request that starts with '@' are direct commands, otherwise they are treaded as a natural language request.
     * @param requestId an optional request id to track the command
     * @param attachments encoded image attachments for the model
     */
    processCommand(
        command: string,
        requestId?: RequestId,
        attachments?: string[],
    ): Promise<CommandResult | undefined>;

    /**
     * Close the dispatcher and release all resources.
     */
    close(): Promise<void>;

    /**
     * Get the latest update on a dynamic display that is returned to the host via ClientIO or CommandResult
     * @param appAgentName the agent name that originated the display
     * @param type the type of the display content.
     * @param displayId the displayId of the display content as given from ClientIO or CommandResult.
     */
    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        displayId: string,
    ): Promise<DynamicDisplay>;

    // APIs for form filling templates.
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

    // APIs to get command completion for intellisense like functionality.
    getCommandCompletion(
        prefix: string,
    ): Promise<CommandCompletionResult | undefined>;

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

/**
 * Create a instance of the dispatcher.
 *
 * @param hostName A name use to identify the application that hosts the dispatcher for logging purposes.
 * @param options A set of options to initialize the dispatcher.  See `DispatcherOptions` for more details.
 * @returns a new dispatcher instance.
 */
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
