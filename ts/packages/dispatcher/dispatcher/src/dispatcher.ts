// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { displayError } from "@typeagent/agent-sdk/helpers/display";
import type {
    ActionInfo,
    AgentSchemaInfo,
    AgentSubSchemaInfo,
    CommandResult,
} from "@typeagent/dispatcher-types";
import {
    ConnectionId,
    Dispatcher,
    RequestId,
} from "@typeagent/dispatcher-types";
import type {
    DisplayLogEntry,
    PendingInteractionResponse,
} from "@typeagent/dispatcher-types";
import { getDispatcherStatus, processCommand } from "./command/command.js";
import { getCommandCompletion } from "./command/completion.js";
import { getActionContext } from "./execute/actionContext.js";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
    DispatcherOptions,
    initializeCommandHandlerContext,
} from "./context/commandHandlerContext.js";
import { randomUUID } from "node:crypto";
import type { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import { generateSchemaTypeDefinition } from "@typeagent/action-schema";

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
    requestId: RequestId,
): Promise<CommandResult | undefined> {
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
        rejectReferences:
            context.session.getConfig().explainer.filter.reference.list,
        namespaceKeys: agentCache.getNamespaceKeys(
            activeSchemaNames,
            undefined,
        ),
    });

    if (matches.length === 0) {
        return {
            lastError: "No cache match found",
        };
    }

    // Cache hit - execute the command normally to get the full result
    // This will execute the cached actions and return proper results through ClientIO
    return await processCommand(request, context, requestId);
}

/** Extract action names + descriptions from a parsed action schema. */
function extractActions(
    actionSchemas: Map<string, ActionSchemaTypeDefinition>,
): ActionInfo[] {
    const actions: ActionInfo[] = [];
    for (const [name, actionDef] of actionSchemas) {
        const description =
            (actionDef.comments?.[0] ?? "").trim() ||
            name
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (c) => c.toUpperCase())
                .trim();
        actions.push({ name, description });
    }
    return actions;
}

async function getAgentSchemas(
    context: CommandHandlerContext,
    agentName?: string,
): Promise<AgentSchemaInfo[]> {
    await context.agents.waitUntilReady();
    const configs = context.agents.getActionConfigs();
    // Group configs by top-level agent name (part before first '.')
    const agentMap = new Map<string, typeof configs>();
    for (const config of configs) {
        const topName = config.schemaName.split(".")[0];
        if (agentName != null && topName !== agentName) continue;
        const list = agentMap.get(topName) ?? [];
        list.push(config);
        agentMap.set(topName, list);
    }

    const result: AgentSchemaInfo[] = [];
    for (const [name, configList] of agentMap) {
        // Sort: main schema (schemaName === name) first, sub-schemas after
        const sorted = [...configList].sort((a, b) => {
            if (a.schemaName === name) return -1;
            if (b.schemaName === name) return 1;
            return a.schemaName.localeCompare(b.schemaName);
        });

        const subSchemas: AgentSubSchemaInfo[] = [];
        for (const config of sorted) {
            let schemaFile;
            try {
                schemaFile = context.agents.tryGetActionSchemaFile(
                    config.schemaName,
                );
            } catch {
                continue;
            }
            const actions = schemaFile
                ? extractActions(schemaFile.parsedActionSchema.actionSchemas)
                : [];
            if (actions.length === 0) continue;
            const schemaText = schemaFile?.parsedActionSchema.entry.action
                ? generateSchemaTypeDefinition(
                      schemaFile.parsedActionSchema.entry.action,
                  )
                : undefined;
            subSchemas.push({
                schemaName: config.schemaName,
                description: config.description,
                schemaText,
                actions,
            });
        }
        if (subSchemas.length === 0) continue;

        const mainConfig =
            configList.find((c) => c.schemaName === name) ?? configList[0];
        result.push({
            name,
            emoji: mainConfig.emojiChar,
            description: context.agents.getAppAgentDescription(name),
            subSchemas,
        });
    }
    return result;
}

export function createDispatcherFromContext(
    context: CommandHandlerContext,
    connectionId?: ConnectionId,
    closeFn?: () => Promise<void>,
): Dispatcher {
    const dispatcher: Dispatcher = {
        get connectionId() {
            return connectionId;
        },
        processCommand(command, clientRequestId, attachments, options) {
            return processCommand(
                command,
                context,
                {
                    connectionId,
                    requestId: randomUUID(),
                    clientRequestId,
                },
                attachments,
                options,
            );
        },
        getCommandCompletion(prefix, direction) {
            return getCommandCompletion(prefix, direction, context);
        },
        checkCache(request) {
            return checkCache(request, context, {
                connectionId,
                requestId: randomUUID(),
            });
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
        async getDisplayHistory(afterSeq?: number): Promise<DisplayLogEntry[]> {
            return context.displayLog.getEntries(afterSeq);
        },
        async close() {
            await closeFn?.();
            const descriptors = Object.getOwnPropertyDescriptors(this);
            for (const [name] of Object.entries(descriptors)) {
                // TODO: Note this doesn't prevent the function continue to be call if is saved.
                Object.defineProperty(this, name, {
                    get: () => {
                        throw new Error("Dispatcher is closed.");
                    },
                });
            }
        },
        async getStatus() {
            return getDispatcherStatus(context);
        },
        async getAgentSchemas(agentName?: string) {
            return getAgentSchemas(context, agentName);
        },
        cancelCommand(requestId: string) {
            const controller = context.activeRequests.get(requestId);
            if (controller) {
                controller.abort();
            }
        },
        async respondToChoice(choiceId: string, response: boolean | number[]) {
            return context.commandLock(async () => {
                const pending = context.pendingChoiceRoutes.get(choiceId);
                if (!pending) {
                    throw new Error("Choice not found or expired");
                }
                context.pendingChoiceRoutes.delete(choiceId);

                // Use original requestId so display appends to same message group
                context.currentRequestId = pending.requestId;
                context.commandResult = undefined;
                try {
                    const appAgent = context.agents.getAppAgent(
                        pending.agentName,
                    );
                    if (!appAgent.handleChoice) {
                        throw new Error(
                            `Agent '${pending.agentName}' does not support choices`,
                        );
                    }
                    const { actionContext, closeActionContext } =
                        getActionContext(
                            pending.agentName,
                            context,
                            pending.requestId,
                            pending.actionIndex,
                        );
                    try {
                        const result = await appAgent.handleChoice(
                            choiceId,
                            response,
                            actionContext,
                        );
                        if (result) {
                            if (result.error !== undefined) {
                                displayError(result.error, actionContext);
                            } else if (result.displayContent !== undefined) {
                                actionContext.actionIO.appendDisplay(
                                    result.displayContent,
                                    "block",
                                );
                            }
                        }
                    } finally {
                        closeActionContext();
                    }
                } finally {
                    const result = context.commandResult;
                    context.commandResult = undefined;
                    context.currentRequestId = undefined;
                    return result;
                }
            });
        },
        async respondToInteraction(
            _response: PendingInteractionResponse,
        ): Promise<void> {
            // Base dispatcher does not manage pending interactions.
            // The server's SharedDispatcher overrides this method on the
            // per-connection dispatcher instance.
            throw new Error(
                "respondToInteraction is not supported on this dispatcher instance",
            );
        },
        cancelInteraction(_interactionId: string): void {
            // Base dispatcher does not manage pending interactions.
            // The server's SharedDispatcher overrides this method on the
            // per-connection dispatcher instance.
            throw new Error(
                "cancelInteraction is not supported on this dispatcher instance",
            );
        },
    };
    return dispatcher;
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
    return createDispatcherFromContext(context, undefined, async () =>
        closeCommandHandlerContext(context),
    );
}
