// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ActionContext } from "@typeagent/agent-sdk";
import {
    createExecutableAction,
    ExecutableAction,
    HistoryContext,
    ParamObjectType,
    RequestAction,
} from "agent-cache";
import {
    DispatcherClarifyName,
} from "../context/dispatcher/dispatcherUtils.js";
import { AgentMatchCandidate } from "../context/dispatcher/schema/clarifyActionSchema.js";
import { buildClarifyMultipleAgentMatches } from "./clarifyHelpers.js";
import {
    CollisionStrategy,
    emitCollisionEvent,
} from "../context/collisionTelemetry.js";
import { getAgentPriority } from "./matchCollision.js";
import {
    CachedImageWithDetails,
    IncrementalJsonValueCallBack,
} from "typechat-utils";
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
import registerDebug from "debug";
import { ActionConfig } from "./actionConfig.js";
import { DispatcherConfig } from "../context/session.js";
import { openai as ai, CompleteUsageStatsCallback } from "aiclient";
import { ActionConfigProvider } from "./actionConfigProvider.js";
import { getHistoryContext } from "./interpretRequest.js";

const debugTranslate = registerDebug("typeagent:translate");
const debugSemanticSearch = registerDebug("typeagent:translate:semantic");

/**
 * Gather active action configs that are injected to include for translation and switching.
 * If firstSchemaName is specified, it will be included first regardless of whether it is injected/active or not.
 * If switchEnabled is false, all active schemas will be included regardless of whether it is injected or not.
 * If switchAgentAction is true, also collect action config that is not included in a separate array `switchActionConfigs`.
 *
 * @param provider the app agent manager
 * @param switchEnabled whether to enable the switch action.
 * @param switchAgentAction whether to generate the switch actions.
 * @param firstSchemaName the first schema name to include for injection
 * @returns
 */

function getTranslationActionConfigs(
    provider: ActionConfigProvider,
    activeSchemas: Set<string>,
    switchEnabled: boolean,
    switchAgentAction: boolean,
    firstSchemaName?: string,
) {
    const actionConfigs: ActionConfig[] = [];
    const switchActionConfigs: ActionConfig[] = [];
    if (firstSchemaName) {
        actionConfigs.push(provider.getActionConfig(firstSchemaName));
    }
    for (const name of activeSchemas) {
        if (firstSchemaName === name) {
            continue;
        }
        const actionConfig = provider.getActionConfig(name);
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
    activeSchemas: Set<string>,
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
    const sessionConfig = context.session.getConfig();
    const config = sessionConfig.translation;
    const { actionConfigs, switchActionConfigs } = getTranslationActionConfigs(
        context.agents,
        activeSchemas,
        switchEnabled,
        config.switch.inline,
        schemaName,
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
        context.promptLogger,
        sessionConfig.execution.entityPromptShape,
        sessionConfig.translation.entity.pathNavigation !== "off",
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
    activeSchemas: Set<string>,
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
    const sessionConfig = context.session.getConfig();
    const config = sessionConfig.translation;
    const { actionConfigs, switchActionConfigs } = getTranslationActionConfigs(
        context.agents,
        activeSchemas,
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
        context.promptLogger,
        sessionConfig.execution.entityPromptShape,
        sessionConfig.translation.entity.pathNavigation !== "off",
    );
}

/**
 * Result type for pickInitialSchema. Returns a chosen schemaName, or a
 * pre-built ExecutableAction representing a clarify request when LLM-select
 * collision detection determined the embedding result was ambiguous and the
 * configured strategy is "user-clarify".
 */
type PickInitialSchemaResult =
    | { kind: "schema"; schemaName: string }
    | { kind: "clarify"; clarify: ExecutableAction };

async function pickInitialSchema(
    request: string,
    activeSchemas: Set<string>,
    systemContext: CommandHandlerContext,
): Promise<PickInitialSchemaResult> {
    const switchConfig = systemContext.session.getConfig().translation.switch;
    const collisionCfg =
        systemContext.session.getConfig().collision.llmSelect;
    if (switchConfig.fixed !== "") {
        if (!activeSchemas.has(switchConfig.fixed)) {
            throw new Error("Fixed initial schema not active");
        }
        // Fixed pin overrides any ambiguity detection by definition.
        return { kind: "schema", schemaName: switchConfig.fixed };
    }

    // Start with the last translator used
    const agents = systemContext.agents;

    let schemaName: string | undefined = systemContext.lastActionSchemaName;
    const embedding = switchConfig.embedding;
    if (embedding && request.length > 0) {
        debugSemanticSearch(`Using embedding for schema selection`);
        // Use embedding to determine the most likely action schema and use the schema name for that.
        // When LLM-select collision detection is on, ask for top-N so we can
        // compare scores and decide whether the choice is ambiguous.
        const maxMatches = collisionCfg.detect
            ? Math.max(2, collisionCfg.topN)
            : debugSemanticSearch.enabled
              ? 5
              : 1;
        try {
            const result = await agents.semanticSearchActionSchema(
                request,
                maxMatches,
                (schemaName: string) => activeSchemas.has(schemaName),
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

                    // Ambiguity check: top-2 score delta within threshold.
                    // Skip when the top result is already the dispatcher (unknown/clarify)
                    // since that path falls back to lastActionSchemaName anyway.
                    if (
                        collisionCfg.detect &&
                        found !== DispatcherName &&
                        result.length >= 2
                    ) {
                        const delta = result[0].score - result[1].score;
                        if (delta < collisionCfg.scoreDeltaThreshold) {
                            const cluster = result.filter(
                                (r) =>
                                    result[0].score - r.score <
                                    collisionCfg.scoreDeltaThreshold,
                            );
                            const decision = applyLlmSelectStrategy(
                                cluster.map((r) => ({
                                    schemaName:
                                        r.item.actionSchemaFile.schemaName,
                                    actionName: r.item.definition.name,
                                    score: r.score,
                                })),
                                collisionCfg.strategy,
                                request,
                                systemContext,
                            );
                            if (decision.kind === "clarify") {
                                return decision;
                            }
                            schemaName = decision.schemaName;
                        } else if (found !== DispatcherName) {
                            schemaName = found;
                        }
                    } else if (found !== DispatcherName) {
                        // If it is close to dispatcher actions (unknown and clarify), just use the last used action schema
                        schemaName = found;
                    }
                }
            }
        } catch (e: any) {
            debugSemanticSearch(`Semantic search failed: ${e}`);
        }
    }

    if (!activeSchemas.has(schemaName)) {
        debugTranslate(
            `Translating request using default translator: ${schemaName} not active`,
        );
        // REVIEW: Just pick the first one.
        schemaName = activeSchemas.values().next().value;
        if (schemaName === undefined) {
            throw new Error("No active translator available");
        }
    } else {
        debugTranslate(
            `Translating request using current translator: ${schemaName}`,
        );
    }
    return { kind: "schema", schemaName };
}

/**
 * Apply the configured LLM-select collision strategy to an ambiguous cluster
 * of embedding matches. Returns either the chosen schema name (string) or a
 * synthesized clarify ExecutableAction when strategy is "user-clarify".
 */
function applyLlmSelectStrategy(
    cluster: AgentMatchCandidate[],
    strategy: CollisionStrategy,
    request: string,
    systemContext: CommandHandlerContext,
): PickInitialSchemaResult {
    const startedAt = performance.now();
    let chosen: AgentMatchCandidate;
    switch (strategy) {
        case "first-match":
        case "score-rank":
            chosen = cluster[0];
            break;
        case "priority": {
            const sorted = [...cluster].sort(
                (a, b) =>
                    getAgentPriority(
                        getAppAgentName(a.schemaName),
                        systemContext,
                    ) -
                    getAgentPriority(
                        getAppAgentName(b.schemaName),
                        systemContext,
                    ),
            );
            chosen = sorted[0];
            break;
        }
        case "user-clarify": {
            const clarify = buildClarifyMultipleAgentMatches(request, cluster);
            const action = createExecutableAction(
                DispatcherClarifyName,
                clarify.actionName,
                clarify.parameters as unknown as ParamObjectType,
            );
            emitCollisionEvent(
                {
                    kind: "llmSelect",
                    request,
                    candidates: cluster,
                    // first-match would have picked cluster[0] (cluster is
                    // pre-sorted by embedding score); record it for
                    // divergence analysis.
                    firstMatchCandidate: cluster[0],
                    strategy,
                    elapsedMs: performance.now() - startedAt,
                },
                systemContext,
            );
            return { kind: "clarify", clarify: action };
        }
        default:
            chosen = cluster[0];
    }
    emitCollisionEvent(
        {
            kind: "llmSelect",
            request,
            candidates: cluster,
            chosen,
            firstMatchCandidate: cluster[0],
            strategy,
            elapsedMs: performance.now() - startedAt,
        },
        systemContext,
    );
    return { kind: "schema", schemaName: chosen.schemaName };
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

// Translate once using the schema name and current agent active and activity states to get the translator.
// If schema option is set to true, will try to use selected actions for translation first.
// Return non-finalized result.
async function translateRequestWithSchema(
    schemaName: string,
    activeSchemas: Set<string>,
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
            activeSchemas,
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
    const translator = getTranslatorForSchema(
        systemContext,
        schemaName,
        activeSchemas,
    );
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

// Translate once using the translator with streaming support and return the non-finalized result.
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
            systemContext.currentAbortSignal,
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

async function findAssistantForRequest(
    request: string,
    schemaName: string, // The schema that we already tried
    activeSchemas: Set<string>,
    context: ActionContext<CommandHandlerContext>,
): Promise<NextTranslation | undefined> {
    displayStatus(
        `[↔️ (switcher)] Looking for another assistant to handle request '${request}'`,
        context,
    );
    const systemContext = context.sessionContext.agentContext;
    const schemaNames = Array.from(activeSchemas).filter(
        (enabledSchemaName) => schemaName !== enabledSchemaName,
    );

    if (schemaNames.length === 0) {
        return undefined;
    }

    const selectTranslator = loadAssistantSelectionJsonTranslator(
        schemaNames,
        systemContext.agents,
        systemContext.promptLogger,
    );

    const result = await selectTranslator.translate(
        request,
        systemContext.currentAbortSignal,
    );
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
    activeSchemas: Set<string>,
    context: ActionContext<CommandHandlerContext>,
    forceSearch: boolean,
): Promise<NextTranslation | undefined> {
    context.sessionContext.agentContext.currentAbortSignal?.throwIfAborted();
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
        ? findAssistantForRequest(request, schemaName, activeSchemas, context)
        : undefined;
}

async function finalizeAction(
    action: TranslatedAction,
    translator: TypeAgentTranslator,
    schemaName: string,
    activeSchemas: Set<string>,
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
    while (true) {
        context.sessionContext.agentContext.currentAbortSignal?.throwIfAborted();
        const forceSearch = currentAction !== action; // force search if we have switched once
        const nextTranslation = await getNextTranslation(
            currentAction,
            currentSchemaName,
            activeSchemas,
            context,
            forceSearch,
        );
        if (nextTranslation === undefined) {
            break;
        }

        const { request, nextSchemaName, searched } = nextTranslation;
        if (!activeSchemas.has(nextSchemaName)) {
            // this is a bug. May be the translator cache didn't get updated when state change?
            throw new Error(
                `Internal error: switch to disabled translator ${nextSchemaName}`,
            );
        }

        const result = await translateRequestWithSchema(
            nextSchemaName,
            activeSchemas,
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
            activeSchemas,
            history,
            attachments,
            context,
            usageCallback,
        );
    }

    if (isAdditionalActionLookupAction(currentAction)) {
        // This is the second action lookup, stop it and return unknown
        const unknownAction: UnknownAction = {
            actionName: "unknown",
            parameters: { request: currentAction.parameters.request },
        };
        currentAction = unknownAction;
    }

    // A translator may combine actions from multiple schemas (inline, selected actions)
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
    activeSchemas: Set<string>,
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
        context.sessionContext.agentContext.currentAbortSignal?.throwIfAborted();
        if (isPendingRequest(request)) {
            actions.push(createPendingRequestAction(request));
            continue;
        }

        const finalizedActions = await finalizeAction(
            request.action,
            translator,
            schemaName,
            activeSchemas,
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

async function translateRequestWithActiveSchemas(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    streamingActionIndex: number | undefined,
    activeSchemas: Set<string>,
    usageCallback: (usage: ai.CompletionUsageStats) => void,
): Promise<ExecutableAction | ExecutableAction[]> {
    const systemContext = context.sessionContext.agentContext;
    const picked = await pickInitialSchema(
        request,
        activeSchemas,
        systemContext,
    );

    if (picked.kind === "clarify") {
        // LLM-select detected ambiguity and the user-clarify strategy is on.
        // Short-circuit translation; downstream execution dispatches the
        // synthesized ClarifyMultipleAgentMatches action.
        return picked.clarify;
    }
    const schemaName = picked.schemaName;

    const result = await translateRequestWithSchema(
        schemaName,
        activeSchemas,
        request,
        history,
        attachments,
        context,
        usageCallback,
        streamingActionIndex,
    );

    const { translatedAction, translator } = result;

    return isMultipleAction(translatedAction)
        ? await finalizeMultipleActions(
              translatedAction,
              translator,
              schemaName,
              activeSchemas,
              history,
              attachments,
              context,
              usageCallback,
          )
        : await finalizeAction(
              translatedAction,
              translator,
              schemaName,
              activeSchemas,
              history,
              attachments,
              context,
              usageCallback,
          );
}

export type TranslationResult = {
    requestAction: RequestAction;
    elapsedMs: number;

    type: "translate" | "construction" | "grammar";
    config: any;
    allMatches?: any;
};

// null means cancelled because of replacement parse error.
export async function translateRequest(
    context: ActionContext<CommandHandlerContext>,
    request: string,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
    streamingActionIndex?: number,
    activeSchemas?: string[],
    usageCallback: (usage: ai.CompletionUsageStats) => void = () => {},
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

    const startTime = performance.now();
    const activeSchemaNames =
        activeSchemas ?? systemContext.agents.getActiveSchemas();
    debugTranslate(`Active schemas: ${activeSchemaNames.join(",")}`);

    const executableAction = await translateRequestWithActiveSchemas(
        request,
        context,
        history,
        attachments,
        streamingActionIndex,
        new Set(activeSchemaNames),
        usageCallback,
    );

    const requestAction = RequestAction.create(
        request,
        executableAction,
        history,
    );

    const elapsedMs = performance.now() - startTime;

    return {
        type: "translate",
        requestAction,
        elapsedMs,
        config: systemContext.session.getConfig().translation,
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
            context,
            action.parameters.pendingRequest,
            history,
            undefined,
            actionIndex,
        );
    } catch (e: any) {
        e.message = `Error translating pending request action: ${e.message}`;
        throw e;
    }
}
