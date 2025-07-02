// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext, ActivityContext } from "@typeagent/agent-sdk";
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
    getAppAgentName,
    isAdditionalActionLookupAction,
    loadAgentJsonTranslator,
    TranslatedAction,
    TypeAgentTranslator,
} from "./agentTranslators.js";
import { UnknownAction } from "../context/dispatcher/schema/dispatcherActionSchema.js";
import {
    DispatcherActivityName,
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
import { ActionConfig } from "./actionConfig.js";
import { AppAgentManager } from "../context/appAgentManager.js";
import { DispatcherConfig } from "../context/session.js";
import { openai as ai, CompleteUsageStatsCallback } from "aiclient";
const debugTranslate = registerDebug("typeagent:translate");
const debugSemanticSearch = registerDebug("typeagent:translate:semantic");

/**
 * Gather active action configs that are injected to include for translation and switching.
 * If firstSchemaName is specified, it will be included first regardless of whether it is injected/active or not.
 * If switchEnabled is false, all active schemas will be included regardless of whether it is injected or not.
 * If switchAgentAction is true, also collect action config that is not included in a separate array `switchActionConfigs`.
 *
 * @param agents the app agent manager
 * @param switchEnabled whether to enable the switch action.
 * @param switchAgentAction whether to generate the switch actions.
 * @param firstSchemaName the first schema name to include for injection
 * @returns
 */

function getTranslationActionConfigs(
    agents: AppAgentManager,
    switchEnabled: boolean,
    switchAgentAction: boolean,
    firstSchemaName?: string,
    activityContext?: ActivityContext,
) {
    const actionConfigs: ActionConfig[] = [];
    const switchActionConfigs: ActionConfig[] = [];
    if (firstSchemaName) {
        actionConfigs.push(agents.getActionConfig(firstSchemaName));
    }
    for (const actionConfig of agents.getActionConfigs()) {
        const name = actionConfig.schemaName;
        if (
            firstSchemaName === name ||
            !isSchemaActiveWithActivity(name, agents, activityContext)
        ) {
            continue;
        }
        // Include the schemas for injection if switch is disabled or it is injected.
        if (!switchEnabled || actionConfig.injected) {
            actionConfigs.push(actionConfig);
        } else if (switchAgentAction) {
            switchActionConfigs.push(actionConfig);
        }
    }
    return {
        actionConfigs,
        switchActionConfigs,
    };
}

export function isSwitchEnabled(config: DispatcherConfig) {
    return (
        config.translation.switch.embedding ||
        config.translation.switch.inline ||
        config.translation.switch.search
    );
}

export function getTranslatorForSchema(
    context: CommandHandlerContext,
    schemaName: string,
) {
    const switchEnabled = isSwitchEnabled(context.session.getConfig());
    const translatorName = switchEnabled ? schemaName : ""; // Use empty string to represent the one and only translator that combines all schemas.
    const activityContext = context.activityContext;
    // Can't use cached translator if we have activity
    const translator = activityContext
        ? undefined
        : context.translatorCache.get(schemaName);
    if (translator !== undefined) {
        debugTranslate(`Using cached translator for '${translatorName}'`);
        return translator;
    }
    const config = context.session.getConfig().translation;
    const { actionConfigs, switchActionConfigs } = getTranslationActionConfigs(
        context.agents,
        switchEnabled,
        config.switch.inline,
        schemaName,
        context.activityContext,
    );

    debugTranslate(
        `Creating translator for '${translatorName}':\n  schemas: ${actionConfigs
            .map((actionConfig) => actionConfig.schemaName)
            .join(",")}\n  switch: ${switchActionConfigs
            .map((actionConfig) => actionConfig.schemaName)
            .join(",")}`,
    );
    const generateOptions = config.schema.generation.enabled
        ? {
              exact: !config.schema.optimize.enabled,
              jsonSchema: config.schema.generation.jsonSchema,
              jsonSchemaFunction: config.schema.generation.jsonSchemaFunction,
              jsonSchemaWithTs: config.schema.generation.jsonSchemaWithTs,
              jsonSchemaValidate: config.schema.generation.jsonSchemaValidate,
          }
        : null;
    const newTranslator = loadAgentJsonTranslator(
        actionConfigs,
        switchActionConfigs,
        context.agents,
        {
            activity: context.agents.isSchemaEnabled(DispatcherActivityName),
            multiple: config.multiple,
        },
        generateOptions,
        config.model,
    );
    if (!activityContext) {
        context.translatorCache.set(translatorName, newTranslator);
        debugTranslate(`Cached translator for '${translatorName}'`);
    }
    return newTranslator;
}

async function getTranslatorForSelectedActions(
    context: CommandHandlerContext,
    schemaName: string,
    request: string,
    numActions: number,
): Promise<TypeAgentTranslator | undefined> {
    if (!isSwitchEnabled(context.session.getConfig())) {
        return undefined;
    }
    const actionSchemaFile = context.agents.tryGetActionSchemaFile(schemaName);
    if (
        actionSchemaFile === undefined ||
        actionSchemaFile.parsedActionSchema.actionSchemas.size <= numActions
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
    const { actionConfigs, switchActionConfigs } = getTranslationActionConfigs(
        context.agents,
        true,
        config.switch.inline,
    );
    return createTypeAgentTranslatorForSelectedActions(
        nearestNeighbors.map((e) => e.item.definition),
        context.agents.getActionConfig(schemaName),
        actionConfigs,
        switchActionConfigs,
        context.agents,
        {
            activity: context.agents.isSchemaEnabled(DispatcherActivityName),
            multiple: config.multiple,
        },
        config.model,
    );
}

async function pickInitialSchema(
    request: string,
    systemContext: CommandHandlerContext,
) {
    const switchConfig = systemContext.session.getConfig().translation.switch;
    if (switchConfig.fixed !== "") {
        if (!systemContext.agents.isSchemaActive(switchConfig.fixed)) {
            throw new Error("Fixed initial schema not active");
        }

        return switchConfig.fixed;
    }

    // Start with the last translator used
    const activityContext = systemContext.activityContext;
    const agents = systemContext.agents;

    let schemaName: string | undefined = systemContext.lastActionSchemaName;
    const embedding = switchConfig.embedding;
    if (embedding && request.length > 0) {
        const filter = activityContext
            ? (schemaName: string) =>
                  isSchemaActiveWithActivity(
                      schemaName,
                      agents,
                      activityContext,
                  )
            : undefined;

        debugSemanticSearch(`Using embedding for schema selection`);
        // Use embedding to determine the most likely action schema and use the schema name for that.
        const result = await agents.semanticSearchActionSchema(
            request,
            debugSemanticSearch.enabled ? 5 : 1,
            filter,
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

    if (!isSchemaActiveWithActivity(schemaName, agents, activityContext)) {
        if (activityContext !== undefined) {
            schemaName = activityContext.appAgentName;
            if (!agents.isSchemaActive(activityContext.appAgentName)) {
                throw new Error(
                    `Activity context schema ${activityContext.appAgentName} not active`,
                );
            }
        }

        debugTranslate(
            `Translating request using default translator: ${schemaName} not active`,
        );
        // REVIEW: Just pick the first one.
        schemaName = agents.getActiveSchemas()[0];
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

type TranslateStepResult<T = TranslatedAction> = {
    translatedAction: T;
    translator: TypeAgentTranslator;
};

async function translateRequestWithSchema(
    schemaName: string,
    request: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    context: ActionContext<CommandHandlerContext>,
    usageCallback: (usage: ai.CompletionUsageStats) => void,
    streamingActionIndex?: number,
    disableOptimize: boolean = false,
): Promise<TranslateStepResult> {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    const prefix = getSchemaNamePrefix(schemaName, systemContext);
    displayStatus(`${prefix}Translating '${request}'`, context);

    const optimize = config.translation.schema.optimize;
    if (
        !disableOptimize &&
        optimize.enabled &&
        optimize.numInitialActions > 0
    ) {
        const selectedActionTranslator = await getTranslatorForSelectedActions(
            systemContext,
            schemaName,
            request,
            optimize.numInitialActions,
        );
        if (selectedActionTranslator) {
            const translatedAction = await translateWithTranslator(
                selectedActionTranslator,
                request,
                history,
                attachments,
                context,
                usageCallback,
                streamingActionIndex,
            );

            if (!needAllAction(translatedAction, schemaName)) {
                return {
                    translatedAction,
                    translator: selectedActionTranslator,
                };
            }
        }
    }
    const translator = getTranslatorForSchema(systemContext, schemaName);
    const translatedAction = await translateWithTranslator(
        translator,
        request,
        history,
        attachments,
        context,
        usageCallback,
        streamingActionIndex,
    );

    return {
        translatedAction,
        translator,
    };
}

async function translateWithTranslator(
    translator: TypeAgentTranslator,
    request: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    context: ActionContext<CommandHandlerContext>,
    usageCallback: CompleteUsageStatsCallback,
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
                      const actionSchemaName = translator.getSchemaName(value);

                      if (
                          actionSchemaName === undefined ||
                          !systemContext.agents.isActionActive(actionSchemaName)
                      ) {
                          // don't stream if action not part of the translator or not active for the schema
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
            usageCallback,
        );

        if (!response.success) {
            throw new Error(response.message);
        }
        return response.data;
    } finally {
        profiler?.stop();
    }
}

type NextTranslation = {
    request: string;
    nextSchemaName: string;
    searched: boolean;
};

function isSchemaActiveWithActivity(
    schemaName: string,
    agents: AppAgentManager,
    activityContext?: ActivityContext,
) {
    return (
        agents.isSchemaActive(schemaName) &&
        isActivitySchema(schemaName, activityContext)
    );
}

function isActivitySchema(
    schemaName: string,
    activityContext?: ActivityContext,
) {
    return (
        activityContext === undefined ||
        // Dispatcher schema (for unknown) is always active
        schemaName === DispatcherName ||
        schemaName === DispatcherActivityName ||
        getAppAgentName(schemaName) === activityContext.appAgentName
    );
}

async function findAssistantForRequest(
    request: string,
    schemaName: string,
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
            (enabledSchemaName) =>
                schemaName !== enabledSchemaName &&
                isActivitySchema(
                    enabledSchemaName,
                    systemContext.activityContext,
                ),
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
    schemaName: string,
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
        ? findAssistantForRequest(request, schemaName, context)
        : undefined;
}

async function finalizeAction(
    action: TranslatedAction,
    translator: TypeAgentTranslator,
    schemaName: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    context: ActionContext<CommandHandlerContext>,
    usageCallback: (usage: ai.CompletionUsageStats) => void,
    resultEntityId?: string,
    streamingActionIndex?: number,
): Promise<ExecutableAction | ExecutableAction[]> {
    let currentAction = action;
    let currentTranslator = translator;
    let currentSchemaName: string = schemaName;
    const systemContext = context.sessionContext.agentContext;
    while (true) {
        const forceSearch = currentAction !== action; // force search if we have switched once
        const nextTranslation = await getNextTranslation(
            currentAction,
            currentSchemaName,
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

        const result = await translateRequestWithSchema(
            nextSchemaName,
            request,
            history,
            attachments,
            context,
            usageCallback,
            streamingActionIndex,
            nextSchemaName === currentSchemaName, // If we are retrying the same schema, then disable optimize
        );

        currentAction = result.translatedAction;
        currentTranslator = result.translator;
        currentSchemaName = nextSchemaName;
        // Don't keep on switching after we searched, just return unknown
        if (searched) {
            break;
        }
    }

    if (isMultipleAction(currentAction)) {
        return finalizeMultipleActions(
            currentAction,
            currentTranslator,
            currentSchemaName,
            history,
            attachments,
            context,
            usageCallback,
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

    const currentActionSchemaName = currentTranslator.getSchemaName(
        currentAction.actionName,
    );

    if (currentActionSchemaName === undefined) {
        // Should not happen
        throw new Error(
            `Internal Error: Unable to match schema name for action ${currentAction.actionName}`,
        );
    }

    return createExecutableAction(
        currentActionSchemaName,
        currentAction.actionName,
        currentAction.parameters,
        resultEntityId,
    );
}

async function finalizeMultipleActions(
    action: MultipleAction,
    translator: TypeAgentTranslator,
    schemaName: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    context: ActionContext<CommandHandlerContext>,
    usageCallback: CompleteUsageStatsCallback,
): Promise<ExecutableAction[]> {
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
            translator,
            schemaName,
            history,
            undefined, // TODO: What to do with attachments with multiple actions?
            context,
            usageCallback,
            request.resultEntityId,
        );
        if (Array.isArray(finalizedActions)) {
            actions.push(...finalizedActions);
        } else {
            actions.push(finalizedActions);
        }
    }
    return actions;
}

export function getHistoryContext(
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
    return {
        promptSections,
        entities,
        additionalInstructions,
        activityContext: context.activityContext,
    };
}

export type TranslationResult = {
    requestAction: RequestAction;
    elapsedMs: number;
    fromUser: boolean;
    fromCache: boolean;
    tokenUsage?: ai.CompletionUsageStats;
};

// null means cancelled because of replacement parse error.
export async function translateRequest(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
    streamingActionIndex?: number,
): Promise<TranslationResult> {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    if (!config.translation.enabled) {
        throw new Error("Translation is disabled.");
    }

    if (history) {
        debugTranslate(
            `Using history for translation. Entities: ${JSON.stringify(history.entities)}`,
        );
    }

    // Start with the last translator used
    const startTime = performance.now();
    const schemaName = await pickInitialSchema(request, systemContext);
    const tokenUsage: ai.CompletionUsageStats = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };

    const usageCallback = (usage: ai.CompletionUsageStats) => {
        tokenUsage.completion_tokens += usage.completion_tokens;
        tokenUsage.prompt_tokens += usage.prompt_tokens;
        tokenUsage.total_tokens += usage.total_tokens;
    };

    const result = await translateRequestWithSchema(
        schemaName,
        request,
        history,
        attachments,
        context,
        usageCallback,
        streamingActionIndex,
    );

    const { translatedAction, translator } = result;

    const executableAction = isMultipleAction(translatedAction)
        ? await finalizeMultipleActions(
              translatedAction,
              translator,
              schemaName,
              history,
              attachments,
              context,
              usageCallback,
          )
        : await finalizeAction(
              translatedAction,
              translator,
              schemaName,
              history,
              attachments,
              context,
              usageCallback,
          );

    const translated = RequestAction.create(request, executableAction, history);

    const elapsedMs = performance.now() - startTime;
    const { requestAction, replacedAction } = await confirmTranslation(
        elapsedMs,
        unicodeChar.robotFace,
        translated,
        context,
    );

    if (!systemContext.batchMode) {
        systemContext.logger?.logEvent("translation", {
            elapsedMs,
            schemaName,
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
        tokenUsage,
    };
}

export function translatePendingRequestAction(
    action: PendingRequestAction,
    context: ActionContext<CommandHandlerContext>,
    actionIndex?: number,
) {
    try {
        const systemContext = context.sessionContext.agentContext;
        const history = getHistoryContext(systemContext);
        return translateRequest(
            action.parameters.pendingRequest,
            context,
            history,
            undefined,
            actionIndex,
        );
    } catch (e: any) {
        e.message = `Error translating pending request action: ${e.message}`;
        throw e;
    }
}
