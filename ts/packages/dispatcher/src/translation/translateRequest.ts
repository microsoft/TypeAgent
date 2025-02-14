// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    displayError,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import {
    createExecutableAction,
    ExecutableAction,
    HistoryContext,
    RequestAction,
} from "agent-cache";
import {
    CachedImageWithDetails,
    IncrementalJsonValueCallBack,
} from "common-utils";
import {
    isMultipleAction,
    isPendingRequest,
    MultipleAction,
} from "./multipleActionSchema.js";
import {
    createTypeAgentTranslatorForSelectedActions,
    isAdditionalActionLookupAction,
    loadAgentJsonTranslator,
    TranslatedAction,
    TypeAgentTranslator,
} from "./agentTranslators.js";
import { UnknownAction } from "../context/dispatcher/schema/dispatcherActionSchema.js";
import {
    DispatcherName,
    isUnknownAction,
} from "../context/dispatcher/dispatcherUtils.js";
import { loadAssistantSelectionJsonTranslator } from "./unknownSwitcher.js";
import {
    getSchemaNamePrefix,
    startStreamPartialAction,
} from "../execute/actionHandlers.js";
import { ProfileNames } from "../utils/profileNames.js";
import {
    createPendingRequestAction,
    PendingRequestAction,
} from "./pendingRequest.js";
import { unicodeChar } from "../command/command.js";
import registerDebug from "debug";
import { confirmTranslation } from "./confirmTranslation.js";
const debugTranslate = registerDebug("typeagent:translate");
const debugSemanticSearch = registerDebug("typeagent:translate:semantic");

function getActiveTranslators(context: CommandHandlerContext) {
    return Object.fromEntries(
        context.agents.getActiveSchemas().map((name) => [name, true]),
    );
}

export function getTranslatorForSchema(
    context: CommandHandlerContext,
    translatorName: string,
) {
    const translator = context.translatorCache.get(translatorName);
    if (translator !== undefined) {
        return translator;
    }
    const config = context.session.getConfig().translation;
    const newTranslator = loadAgentJsonTranslator(
        translatorName,
        context.agents,
        getActiveTranslators(context),
        config.switch.inline,
        config.multiple,
        config.schema.generation.enabled,
        config.model,
        {
            exact: !config.schema.optimize.enabled,
            jsonSchema: config.schema.generation.jsonSchema,
            jsonSchemaFunction: config.schema.generation.jsonSchemaFunction,
            jsonSchemaWithTs: config.schema.generation.jsonSchemaWithTs,
            jsonSchemaValidate: config.schema.generation.jsonSchemaValidate,
        },
    );
    context.translatorCache.set(translatorName, newTranslator);
    return newTranslator;
}

async function getTranslatorForSelectedActions(
    context: CommandHandlerContext,
    schemaName: string,
    request: string,
    numActions: number,
): Promise<TypeAgentTranslator | undefined> {
    const actionSchemaFile = context.agents.tryGetActionSchemaFile(schemaName);
    if (
        actionSchemaFile === undefined ||
        actionSchemaFile.actionSchemas.size <= numActions
    ) {
        return undefined;
    }
    const nearestNeighbors = await context.agents.semanticSearchActionSchema(
        request,
        numActions,
        (name) => name === schemaName,
    );

    if (nearestNeighbors === undefined) {
        return undefined;
    }
    const config = context.session.getConfig().translation;
    return createTypeAgentTranslatorForSelectedActions(
        nearestNeighbors.map((e) => e.item.definition),
        schemaName,
        context.agents,
        getActiveTranslators(context),
        config.switch.inline,
        config.multiple,
        config.model,
    );
}

async function pickInitialSchema(
    request: string,
    systemContext: CommandHandlerContext,
) {
    // Start with the last translator used
    let schemaName = systemContext.lastActionSchemaName;

    const embedding =
        systemContext.session.getConfig().translation.switch.embedding;
    if (embedding && request.length > 0) {
        debugSemanticSearch(`Using embedding for schema selection`);
        // Use embedding to determine the most likely action schema and use the schema name for that.
        const result = await systemContext.agents.semanticSearchActionSchema(
            request,
            debugSemanticSearch.enabled ? 5 : 1,
        );
        if (result) {
            debugSemanticSearch(
                `Semantic search result: ${result
                    .map(
                        (r) =>
                            `${r.item.actionSchemaFile.schemaName}.${r.item.definition.name} (${r.score})`,
                    )
                    .join("\n")}`,
            );
            if (result.length > 0) {
                const found = result[0].item.actionSchemaFile.schemaName;
                // If it is close to dispatcher actions (unknown and clarify), just use the last used action schema
                if (found !== DispatcherName) {
                    schemaName = found;
                }
            }
        }
    }

    if (!systemContext.agents.isSchemaActive(schemaName)) {
        debugTranslate(
            `Translating request using default translator: ${schemaName} not active`,
        );
        // REVIEW: Just pick the first one.
        schemaName = systemContext.agents.getActiveSchemas()[0];
        if (schemaName === undefined) {
            throw new Error("No active translator available");
        }
    } else {
        debugTranslate(
            `Translating request using current translator: ${schemaName}`,
        );
    }
    return schemaName;
}

function needAllAction(translatedAction: TranslatedAction, schemaName: string) {
    return (
        isUnknownAction(translatedAction) ||
        (isAdditionalActionLookupAction(translatedAction) &&
            translatedAction.parameters.schemaName === schemaName)
    );
}
async function translateRequestWithSchema(
    schemaName: string,
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
    streamingActionIndex?: number,
) {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    const prefix = getSchemaNamePrefix(schemaName, systemContext);
    displayStatus(`${prefix}Translating '${request}'`, context);

    const optimize = config.translation.schema.optimize;
    if (optimize.enabled && optimize.numInitialActions > 0) {
        const selectedActionTranslator = await getTranslatorForSelectedActions(
            systemContext,
            schemaName,
            request,
            optimize.numInitialActions,
        );
        if (selectedActionTranslator) {
            const translatedAction = await translateWithTranslator(
                selectedActionTranslator,
                schemaName,
                request,
                history,
                attachments,
                context,
                streamingActionIndex,
            );
            if (translatedAction === undefined) {
                return undefined;
            }

            if (!needAllAction(translatedAction, schemaName)) {
                if (isMultipleAction(translatedAction)) {
                    const requests = translatedAction.parameters.requests;
                    for (const subRequest of requests) {
                        if (
                            isPendingRequest(subRequest) ||
                            !needAllAction(subRequest.action, schemaName)
                        ) {
                            continue;
                        }
                        // REVIEW: the subaction may not be
                        const translator = getTranslatorForSchema(
                            systemContext,
                            schemaName,
                        );
                        const action = await translateWithTranslator(
                            translator,
                            schemaName,
                            subRequest.request,
                            history,
                            attachments,
                            context,
                        );
                        if (action === undefined) {
                            return undefined;
                        }
                        subRequest.action = action;
                    }
                }
                return translatedAction;
            }
        }
    }
    const translator = getTranslatorForSchema(systemContext, schemaName);
    return translateWithTranslator(
        translator,
        schemaName,
        request,
        history,
        attachments,
        context,
        streamingActionIndex,
    );
}

async function translateWithTranslator(
    translator: TypeAgentTranslator,
    schemaName: string,
    request: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    context: ActionContext<CommandHandlerContext>,
    streamingActionIndex?: number,
) {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    const enableStreaming = config.translation.stream;
    const profiler = systemContext.commandProfiler?.measure(
        ProfileNames.translate,
    );

    let firstToken = true;
    let streamFunction: IncrementalJsonValueCallBack | undefined;
    systemContext.streamingActionContext?.closeActionContext();
    systemContext.streamingActionContext = undefined;
    const onProperty: IncrementalJsonValueCallBack | undefined =
        enableStreaming && streamingActionIndex !== undefined
            ? (prop: string, value: any, delta: string | undefined) => {
                  // TODO: streaming currently doesn't not support multiple actions
                  if (
                      prop === "actionName" &&
                      value !== "unknown" &&
                      delta === undefined
                  ) {
                      const actionSchemaName =
                          systemContext.agents.getInjectedSchemaForActionName(
                              value,
                          ) ?? schemaName;

                      if (
                          !systemContext.agents.isActionActive(actionSchemaName)
                      ) {
                          // don't stream if action is not active for the schema
                          return;
                      }
                      const prefix = getSchemaNamePrefix(
                          actionSchemaName,
                          systemContext,
                      );
                      displayStatus(
                          `${prefix}Translating '${request}' into action '${value}'`,
                          context,
                      );
                      const actionConfig =
                          systemContext.agents.getActionConfig(
                              actionSchemaName,
                          );
                      if (actionConfig.streamingActions?.includes(value)) {
                          streamFunction = startStreamPartialAction(
                              actionSchemaName,
                              value,
                              systemContext,
                              streamingActionIndex,
                          );
                      }
                  }

                  if (firstToken) {
                      profiler?.mark(ProfileNames.firstToken);
                      firstToken = false;
                  }

                  if (streamFunction) {
                      streamFunction(prop, value, delta);
                  }
              }
            : undefined;
    try {
        const response = await translator.translate(
            request,
            history,
            attachments,
            onProperty,
        );

        if (!response.success) {
            displayError(response.message, context);
            return undefined;
        }
        return response.data as TranslatedAction;
    } finally {
        profiler?.stop();
    }
}

type NextTranslation = {
    request: string;
    nextSchemaName: string;
    searched: boolean;
};

async function findAssistantForRequest(
    request: string,
    translatorName: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<NextTranslation | undefined> {
    displayStatus(
        `[↔️ (switcher)] Looking for another assistant to handle request '${request}'`,
        context,
    );
    const systemContext = context.sessionContext.agentContext;
    const schemaNames = systemContext.agents
        .getActiveSchemas()
        .filter(
            (enabledTranslatorName) => translatorName !== enabledTranslatorName,
        );

    if (schemaNames.length === 0) {
        return undefined;
    }

    const selectTranslator = loadAssistantSelectionJsonTranslator(
        schemaNames,
        systemContext.agents,
    );

    const result = await selectTranslator.translate(request);
    if (!result.success) {
        displayWarn(`Failed to switch assistant: ${result.message}`, context);
        return undefined;
    }

    const nextSchemaName = result.data.assistant;
    if (nextSchemaName !== "unknown") {
        return {
            request,
            nextSchemaName,
            searched: true,
        };
    }
    return undefined;
}

async function getNextTranslation(
    action: TranslatedAction,
    translatorName: string,
    context: ActionContext<CommandHandlerContext>,
    forceSearch: boolean,
): Promise<NextTranslation | undefined> {
    let request: string;
    if (isAdditionalActionLookupAction(action)) {
        if (!forceSearch) {
            return {
                request: action.parameters.request,
                nextSchemaName: action.parameters.schemaName,
                searched: false,
            };
        }
        request = action.parameters.request;
    } else if (isUnknownAction(action)) {
        request = action.parameters.request;
    } else {
        return undefined;
    }

    const config = context.sessionContext.agentContext.session.getConfig();
    return config.translation.switch.search
        ? findAssistantForRequest(request, translatorName, context)
        : undefined;
}

async function finalizeAction(
    action: TranslatedAction,
    translatorName: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
    resultEntityId?: string,
    streamingActionIndex?: number,
): Promise<ExecutableAction | ExecutableAction[] | undefined> {
    let currentAction: TranslatedAction | undefined = action;
    let currentTranslatorName: string = translatorName;
    const systemContext = context.sessionContext.agentContext;
    while (true) {
        const forceSearch = currentAction !== action; // force search if we have switched once
        const nextTranslation = await getNextTranslation(
            currentAction,
            currentTranslatorName,
            context,
            forceSearch,
        );
        if (nextTranslation === undefined) {
            break;
        }

        const { request, nextSchemaName, searched } = nextTranslation;
        if (!systemContext.agents.isSchemaActive(nextSchemaName)) {
            // this is a bug. May be the translator cache didn't get updated when state change?
            throw new Error(
                `Internal error: switch to disabled translator ${nextSchemaName}`,
            );
        }

        currentAction = await translateRequestWithSchema(
            nextSchemaName,
            request,
            context,
            history,
            attachments,
            streamingActionIndex,
        );
        if (currentAction === undefined) {
            return undefined;
        }

        currentTranslatorName = nextSchemaName;
        // Don't keep on switching after we searched, just return unknown
        if (searched) {
            break;
        }
    }

    if (isMultipleAction(currentAction)) {
        return finalizeMultipleActions(
            currentAction,
            currentTranslatorName,
            context,
            history,
        );
    }

    if (isAdditionalActionLookupAction(currentAction)) {
        // This is the second change, stop it and return unknown
        const unknownAction: UnknownAction = {
            actionName: "unknown",
            parameters: { request: currentAction.parameters.request },
        };
        currentAction = unknownAction;
    }

    return createExecutableAction(
        systemContext.agents.getInjectedSchemaForActionName(
            currentAction.actionName,
        ) ?? currentTranslatorName,
        currentAction.actionName,
        currentAction.parameters,
        resultEntityId,
    );
}

async function finalizeMultipleActions(
    action: MultipleAction,
    translatorName: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
): Promise<ExecutableAction[] | undefined> {
    if (attachments !== undefined && attachments.length !== 0) {
        // TODO: What to do with attachments with multiple actions?
        throw new Error("Attachments with multiple actions not supported");
    }
    const requests = action.parameters.requests;
    const actions: ExecutableAction[] = [];
    for (const request of requests) {
        if (isPendingRequest(request)) {
            actions.push(createPendingRequestAction(request));
            continue;
        }

        const finalizedActions = await finalizeAction(
            request.action,
            translatorName,
            context,
            history,
            undefined, // TODO: What to do with attachments with multiple actions?
            request.resultEntityId,
        );
        if (finalizedActions === undefined) {
            return undefined;
        }
        if (Array.isArray(finalizedActions)) {
            actions.push(...finalizedActions);
        } else {
            actions.push(finalizedActions);
        }
    }
    return actions;
}

export function getChatHistoryForTranslation(
    context: CommandHandlerContext,
): HistoryContext {
    const promptSections = context.chatHistory.getPromptSections();
    if (promptSections.length !== 0) {
        promptSections.unshift({
            content:
                "The following is a history of the conversation with the user that can be used to translate user requests",
            role: "system",
        });
    }
    const translateConfig = context.session.getConfig().translation;
    const entities = context.chatHistory.getTopKEntities(
        translateConfig.history.limit,
    );
    const additionalInstructions = translateConfig.promptConfig
        .additionalInstructions
        ? context.chatHistory.getCurrentInstructions()
        : undefined;
    return { promptSections, entities, additionalInstructions };
}

export type TranslationResult = {
    requestAction: RequestAction;
    elapsedMs: number;
    fromUser: boolean;
    fromCache: boolean;
};

// null means cancelled because of replacement parse error.
export async function translateRequest(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
    streamingActionIndex?: number,
): Promise<TranslationResult | undefined | null> {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    if (!config.translation.enabled) {
        displayError("Translation is disabled.", context);
        return;
    }

    if (history) {
        debugTranslate(
            `Using history for translation. Entities: ${JSON.stringify(history.entities)}`,
        );
    }

    // Start with the last translator used
    const startTime = performance.now();
    const schemaName = await pickInitialSchema(request, systemContext);
    const action = await translateRequestWithSchema(
        schemaName,
        request,
        context,
        history,
        attachments,
        streamingActionIndex,
    );
    if (action === undefined) {
        return undefined;
    }

    const translatedAction = isMultipleAction(action)
        ? await finalizeMultipleActions(
              action,
              schemaName,
              context,
              history,
              attachments,
          )
        : await finalizeAction(
              action,
              schemaName,
              context,
              history,
              attachments,
          );

    if (translatedAction === undefined) {
        return undefined;
    }
    const translated = RequestAction.create(request, translatedAction, history);

    const elapsedMs = performance.now() - startTime;
    const { requestAction, replacedAction } = await confirmTranslation(
        elapsedMs,
        unicodeChar.robotFace,
        translated,
        context,
    );

    if (requestAction) {
        if (!systemContext.batchMode) {
            systemContext.logger?.logEvent("translation", {
                elapsedMs,
                translatorName: schemaName,
                request,
                actions: requestAction.actions,
                replacedAction,
                developerMode: systemContext.developerMode,
                history,
                config: systemContext.session.getConfig().translation,
                metrics: systemContext.metricsManager?.getMeasures(
                    systemContext.requestId!,
                    ProfileNames.translate,
                ),
            });
        }
        return {
            requestAction,
            elapsedMs,
            fromCache: false,
            fromUser: replacedAction !== undefined,
        };
    }

    return requestAction;
}

export function translatePendingRequestAction(
    action: PendingRequestAction,
    context: ActionContext<CommandHandlerContext>,
    actionIndex?: number,
) {
    const systemContext = context.sessionContext.agentContext;
    const history = getChatHistoryForTranslation(systemContext);
    return translateRequest(
        action.parameters.pendingRequest,
        context,
        history,
        undefined,
        actionIndex,
    );
}
