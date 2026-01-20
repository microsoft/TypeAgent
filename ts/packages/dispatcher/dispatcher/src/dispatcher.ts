// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { Dispatcher } from "@typeagent/dispatcher-types";
import { getDispatcherStatus, processCommand } from "./command/command.js";
import { getCommandCompletion } from "./command/completion.js";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
    DispatcherOptions,
    initializeCommandHandlerContext,
} from "./context/commandHandlerContext.js";

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

async function checkCache(
    request: string,
    context: CommandHandlerContext,
): Promise<import("@typeagent/dispatcher-types").CommandResult | undefined> {
    const agentCache = context.agentCache;

    // Check if cache is enabled
    if (!agentCache.isEnabled()) {
        return {
            lastError: "Cache is not enabled",
        };
    }

    // Get active schema names from enabled agents
    const activeSchemaNames = context.agents.getActiveSchemas();

    if (activeSchemaNames.length === 0) {
        return {
            lastError: "No active agents",
        };
    }

    // Attempt to match the request against the cache
    const matches = agentCache.match(request, {
        wildcard: context.session.getConfig().cache.matchWildcard,
        entityWildcard: context.session.getConfig().cache.matchEntityWildcard,
        rejectReferences: context.session
            .getConfig()
            .explainer.filter.reference.list,
        namespaceKeys: agentCache.getNamespaceKeys(activeSchemaNames, undefined),
    });

    if (matches.length === 0) {
        return {
            lastError: "No cache match found",
        };
    }

    // Cache hit - execute the command normally to get the full result
    // This will execute the cached actions and return proper results through ClientIO
    return await processCommand(request, context);
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
        checkCache(request) {
            return checkCache(request, context);
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
        async getStatus() {
            return getDispatcherStatus(context);
        },
    };
}
