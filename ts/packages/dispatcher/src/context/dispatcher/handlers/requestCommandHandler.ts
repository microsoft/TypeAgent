// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import {
    RequestAction,
    Action,
    printProcessRequestActionResult,
    Actions,
    HistoryContext,
    FullAction,
    ProcessRequestActionResult,
    ExplanationOptions,
    ParamObjectType,
    equalNormalizedParamObject,
} from "agent-cache";

import { validateAction } from "action-schema";
import {
    CommandHandlerContext,
    getTranslatorForSchema,
    getTranslatorForSelectedActions,
} from "../../commandHandlerContext.js";

import {
    CachedImageWithDetails,
    getColorElapsedString,
    IncrementalJsonValueCallBack,
} from "common-utils";
import { Logger } from "telemetry";
import {
    executeActions,
    getSchemaNamePrefix,
    startStreamPartialAction,
    validateWildcardMatch,
} from "../../../execute/actionHandlers.js";
import { unicodeChar } from "../../../command/command.js";
import {
    isChangeAssistantAction,
    TypeAgentTranslator,
    TranslatedAction,
} from "../../../translation/agentTranslators.js";
import { loadAssistantSelectionJsonTranslator } from "../../../translation/unknownSwitcher.js";
import {
    MultipleAction,
    isMultipleAction,
} from "../../../translation/multipleActionSchema.js";
import { MatchResult } from "agent-cache";
import registerDebug from "debug";
import ExifReader from "exifreader";
import { ProfileNames } from "../../../utils/profileNames.js";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displayInfo,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { DispatcherName } from "../../interactiveIO.js";
import { getActionTemplateEditConfig } from "../../../translation/actionTemplate.js";
import { getActionSchema } from "../../../translation/actionSchemaFileCache.js";
import { isUnknownAction } from "../dispatcherAgent.js";
import { UnknownAction } from "../schema/dispatcherActionSchema.js";

const debugTranslate = registerDebug("typeagent:translate");
const debugSemanticSearch = registerDebug("typeagent:translate:semantic");
const debugExplain = registerDebug("typeagent:explain");
const debugConstValidation = registerDebug("typeagent:const:validation");

function validateReplaceActions(
    actions: unknown,
    systemContext: CommandHandlerContext,
): actions is FullAction[] {
    if (actions === null) {
        throw new Error("Request cancelled");
    }
    if (actions === undefined) {
        return false;
    }
    if (!Array.isArray(actions)) {
        throw new Error("Invalid replacement");
    }
    for (const action of actions) {
        if (typeof action !== "object") {
            throw new Error("Invalid replacement");
        }
        const actionInfo = getActionSchema(action, systemContext.agents);
        if (actionInfo === undefined) {
            throw new Error("Invalid replacement");
        }

        validateAction(actionInfo, action);
    }

    return true;
}

async function confirmTranslation(
    elapsedMs: number,
    source: string,
    requestAction: RequestAction,
    context: ActionContext<CommandHandlerContext>,
): Promise<{
    requestAction: RequestAction | undefined | null;
    replacedAction?: Actions;
}> {
    const actions = requestAction.actions;
    const systemContext = context.sessionContext.agentContext;
    if (!systemContext.developerMode || systemContext.batchMode) {
        const messages = [];

        messages.push(
            `${source}: ${chalk.blueBright(
                ` ${requestAction.toString()}`,
            )} ${getColorElapsedString(elapsedMs)}`,
        );
        messages.push();

        const prettyStr = JSON.stringify(actions, undefined, 2);
        messages.push(`${chalk.italic(chalk.cyanBright(prettyStr))}`);
        displayInfo(messages.join("\n"), context);
        return { requestAction };
    }
    const preface =
        "Use the buttons to run or cancel the following action(s). You can also press [Enter] to run it, [Del] to edit it, or [Escape] to cancel it.";
    const editPreface = `Edit the following action(s) to match your requests.  Click on the values to start editing. Use the ➕/✕ buttons to add/delete optional fields.`;

    const templateSequence = getActionTemplateEditConfig(
        systemContext,
        actions,
        preface,
        editPreface,
    );

    const newActions = await systemContext.clientIO.proposeAction(
        templateSequence,
        systemContext.requestId,
        DispatcherName,
    );

    return validateReplaceActions(newActions, systemContext)
        ? {
              requestAction: new RequestAction(
                  requestAction.request,
                  Actions.fromFullActions(newActions),
                  requestAction.history,
              ),
              replacedAction: actions,
          }
        : { requestAction };
}

async function getValidatedMatch(
    matches: MatchResult[],
    context: CommandHandlerContext,
) {
    for (const match of matches) {
        if (match.wildcardCharCount === 0) {
            return match;
        }
        if (await validateWildcardMatch(match, context)) {
            debugConstValidation(
                `Wildcard match accepted: ${match.match.actions}`,
            );
            return match;
        }
        debugConstValidation(`Wildcard match rejected: ${match.match.actions}`);
    }
    return undefined;
}

type TranslationResult = {
    requestAction: RequestAction;
    elapsedMs: number;
    fromUser: boolean;
    fromCache: boolean;
};
async function matchRequest(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
): Promise<TranslationResult | undefined | null> {
    const systemContext = context.sessionContext.agentContext;
    const constructionStore = systemContext.agentCache.constructionStore;
    if (constructionStore.isEnabled()) {
        const startTime = performance.now();
        const config = systemContext.session.getConfig();
        const activeSchemaNames = systemContext.agents.getActiveSchemas();
        const matches = constructionStore.match(request, {
            wildcard: config.cache.matchWildcard,
            rejectReferences: config.explainer.filter.reference.list,
            namespaceKeys:
                systemContext.agentCache.getNamespaceKeys(activeSchemaNames),
            history,
        });

        const elapsedMs = performance.now() - startTime;

        const match = await getValidatedMatch(matches, systemContext);
        if (match !== undefined) {
            const { requestAction, replacedAction } = await confirmTranslation(
                elapsedMs,
                unicodeChar.constructionSign,
                match.match,
                context,
            );

            if (requestAction) {
                if (!systemContext.batchMode) {
                    systemContext.logger?.logEvent("match", {
                        elapsedMs,
                        request,
                        actions: requestAction.actions,
                        replacedAction,
                        developerMode: systemContext.developerMode,
                        translators: activeSchemaNames,
                        explainerName: systemContext.agentCache.explainerName,
                        matchWildcard: config.cache.matchWildcard,
                        allMatches: matches.map((m) => {
                            const { construction: _, match, ...rest } = m;
                            return { action: match.actions, ...rest };
                        }),
                        history,
                    });
                }
                return {
                    requestAction,
                    elapsedMs,
                    fromUser: replacedAction !== undefined,
                    fromCache: true,
                };
            }
            return requestAction;
        }
    }
    return undefined;
}

async function translateRequestWithSchema(
    schemaName: string,
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
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
            );
            if (translatedAction === undefined) {
                return undefined;
            }

            if (
                !isUnknownAction(translatedAction) &&
                (!isChangeAssistantAction(translatedAction) ||
                    translatedAction.parameters.assistant !== schemaName)
            ) {
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
    );
}

async function translateWithTranslator(
    translator: TypeAgentTranslator,
    schemaName: string,
    request: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    const profiler = systemContext.commandProfiler?.measure(
        ProfileNames.translate,
    );

    let firstToken = true;
    let streamFunction: IncrementalJsonValueCallBack | undefined;
    systemContext.streamingActionContext = undefined;
    const onProperty: IncrementalJsonValueCallBack | undefined = config
        .translation.stream
        ? (prop: string, value: any, delta: string | undefined) => {
              // TODO: streaming currently doesn't not support multiple actions
              if (prop === "actionName" && delta === undefined) {
                  const actionSchemaName =
                      systemContext.agents.getInjectedSchemaForActionName(
                          value,
                      ) ?? schemaName;

                  const prefix = getSchemaNamePrefix(
                      actionSchemaName,
                      systemContext,
                  );
                  displayStatus(
                      `${prefix}Translating '${request}' into action '${value}'`,
                      context,
                  );
                  const actionConfig =
                      systemContext.agents.getActionConfig(actionSchemaName);
                  if (actionConfig.streamingActions?.includes(value)) {
                      streamFunction = startStreamPartialAction(
                          actionSchemaName,
                          value,
                          systemContext,
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
    const selectTranslator = loadAssistantSelectionJsonTranslator(
        systemContext.agents
            .getActiveSchemas()
            .filter(
                (enabledTranslatorName) =>
                    translatorName !== enabledTranslatorName,
            ),
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
    if (isChangeAssistantAction(action)) {
        if (!forceSearch) {
            return {
                request: action.parameters.request,
                nextSchemaName: action.parameters.assistant,
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
): Promise<Action | Action[] | undefined> {
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

    if (isChangeAssistantAction(currentAction)) {
        const unknownAction: UnknownAction = {
            actionName: "unknown",
            parameters: { request: currentAction.parameters.request },
        };
        currentAction = unknownAction;
    }

    return new Action(
        systemContext.agents.getInjectedSchemaForActionName(
            currentAction.actionName,
        ) ?? currentTranslatorName,
        currentAction.actionName,
        currentAction.parameters,
    );
}

async function finalizeMultipleActions(
    action: MultipleAction,
    translatorName: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
): Promise<Action[] | undefined> {
    const requests = action.parameters.requests;
    const actions: Action[] = [];
    for (const request of requests) {
        const finalizedActions = await finalizeAction(
            request.action,
            translatorName,
            context,
            history,
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

function getChatHistoryForTranslation(
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
    const entities = context.chatHistory.getTopKEntities(20);
    const additionalInstructions = context.session.getConfig().translation
        .promptConfig.additionalInstructions
        ? context.chatHistory.getCurrentInstructions()
        : undefined;
    return { promptSections, entities, additionalInstructions };
}

function hasAdditionalInstructions(history?: HistoryContext) {
    return (
        history &&
        history.additionalInstructions !== undefined &&
        history.additionalInstructions.length > 0
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
    if (embedding) {
        debugSemanticSearch(`Using embedding for schema selection`);
        // Use embedding to determine the most likely action schema and use the schema name for that.
        const result =
            await systemContext.agents.semanticSearchActionSchema(request);
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
                schemaName = result[0].item.actionSchemaFile.schemaName;
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

export async function translateRequest(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
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
    );
    if (action === undefined) {
        return undefined;
    }

    const translatedAction = isMultipleAction(action)
        ? await finalizeMultipleActions(action, schemaName, context, history)
        : await finalizeAction(action, schemaName, context, history);

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

async function canExecute(
    requestAction: RequestAction,
    context: ActionContext<CommandHandlerContext>,
): Promise<boolean> {
    const actions = requestAction.actions;
    const systemContext = context.sessionContext.agentContext;
    const unknown: UnknownAction[] = [];
    const disabled = new Set<string>();
    for (const action of actions) {
        if (isUnknownAction(action)) {
            unknown.push(action);
        }
        if (
            action.translatorName &&
            !systemContext.agents.isActionActive(action.translatorName)
        ) {
            disabled.add(action.translatorName);
        }
    }

    if (unknown.length > 0) {
        const unknownRequests = unknown.map(
            (action) => action.parameters.request,
        );
        const lines = [
            `Unable to determine ${actions.action === undefined ? "one or more actions in" : "action for"} the request.`,
            ...unknownRequests.map((s) => `- ${s}`),
        ];
        systemContext.chatHistory.addEntry(
            lines.join("\n"),
            [],
            "assistant",
            systemContext.requestId,
        );

        const config = systemContext.session.getConfig();
        if (
            !config.translation.switch.search &&
            !config.translation.switch.embedding &&
            !config.translation.switch.inline
        ) {
            lines.push("");
            lines.push("Switching agents is disabled");
        } else {
            const entries = await Promise.all(
                unknownRequests.map((request) =>
                    systemContext.agents.semanticSearchActionSchema(
                        request,
                        1,
                        () => true, // don't filter
                    ),
                ),
            );
            const schemaNames = new Set(
                entries
                    .filter((e) => e !== undefined)
                    .map((e) => e![0].item.actionSchemaFile.schemaName)
                    .filter(
                        (schemaName) =>
                            !systemContext.agents.isSchemaActive(schemaName),
                    ),
            );

            if (schemaNames.size > 0) {
                lines.push("");
                lines.push(
                    `Possible agent${schemaNames.size > 1 ? "s" : ""} to handle the request${unknownRequests.length > 1 ? "s" : ""} are not active: ${Array.from(schemaNames).join(", ")}`,
                );
            }
        }

        displayError(lines, context);
        return false;
    }

    if (disabled.size > 0) {
        const message = `Not executed. Action disabled for ${Array.from(disabled.values()).join(", ")}`;
        systemContext.chatHistory.addEntry(
            message,
            [],
            "assistant",
            systemContext.requestId,
        );

        displayWarn(message, context);
        return false;
    }

    return true;
}

async function requestExecute(
    requestAction: RequestAction,
    context: ActionContext<CommandHandlerContext>,
) {
    if (!(await canExecute(requestAction, context))) {
        return;
    }

    await executeActions(requestAction.actions, context);
}

async function canTranslateWithoutContext(
    requestAction: RequestAction,
    usedTranslators: Map<string, TypeAgentTranslator<object>>,
    logger?: Logger,
) {
    if (requestAction.history === undefined) {
        return;
    }

    // Do the retranslation check, which will also check the action.
    const oldActions: FullAction[] = requestAction.actions.toFullActions();
    const newActions: (FullAction | undefined)[] = [];
    const request = requestAction.request;
    try {
        const translations = new Map<string, TranslatedAction>();
        for (const [translatorName, translator] of usedTranslators) {
            const result = await translator.translate(request);
            if (!result.success) {
                throw new Error("Failed to translate without history context");
            }
            const newActions = result.data as TranslatedAction;
            const count = isMultipleAction(newActions)
                ? newActions.parameters.requests.length
                : 1;

            if (count !== oldActions.length) {
                throw new Error("Action count mismatch without context");
            }
            translations.set(translatorName, result.data as TranslatedAction);
        }

        let index = 0;
        for (const action of requestAction.actions) {
            const translatorName = action.translatorName;
            const newTranslatedActions = translations.get(translatorName)!;
            const newAction = isMultipleAction(newTranslatedActions)
                ? newTranslatedActions.parameters.requests[index].action
                : newTranslatedActions;
            newActions.push({
                translatorName,
                ...newAction,
            });
        }

        debugExplain(
            `With context: ${JSON.stringify(oldActions)}\nWithout context: ${JSON.stringify(newActions)}`,
        );

        if (oldActions.length !== newActions.length) {
            throw new Error("Action count mismatch without context");
        }

        index = 0;
        for (const oldAction of oldActions) {
            const newAction = newActions[index];
            if (newAction === undefined) {
                throw new Error(`Action missing without context`);
            }

            if (newAction.actionName !== oldAction.actionName) {
                throw new Error(`Action Name mismatch without context`);
            }

            if (
                !equalNormalizedParamObject(
                    newAction.parameters,
                    oldAction.parameters,
                )
            ) {
                throw new Error(`Action parameters mismatch without context`);
            }
            index++;
        }
        logger?.logEvent("contextlessTranslation", {
            request,
            actions: oldActions,
            history: requestAction.history,
            newActions,
        });
    } catch (e: any) {
        logger?.logEvent("contextlessTranslation", {
            requestAction,
            actions: oldActions,
            history: requestAction.history,
            newActions,
            error: e.message,
        });
        throw e;
    }
}

function getExplainerOptions(
    requestAction: RequestAction,
    context: CommandHandlerContext,
): ExplanationOptions | undefined {
    if (!context.session.explanation) {
        // Explanation is disabled
        return undefined;
    }

    if (hasAdditionalInstructions(requestAction.history)) {
        // Translation with additional instructions are not cachable.
        return undefined;
    }

    if (
        !context.session.getConfig().explainer.filter.multiple &&
        requestAction.actions.action === undefined
    ) {
        // filter multiple
        return undefined;
    }

    const usedTranslators = new Map<string, TypeAgentTranslator<object>>();
    const actions = requestAction.actions;
    for (const action of actions) {
        if (isUnknownAction(action)) {
            // can't explain unknown actions
            return undefined;
        }

        const schemaName = action.translatorName;
        if (context.agents.getActionConfig(schemaName).cached === false) {
            // explanation disable at the translator level
            return undefined;
        }

        usedTranslators.set(
            schemaName,
            getTranslatorForSchema(context, schemaName),
        );
    }
    const { list, value, translate } =
        context.session.getConfig().explainer.filter.reference;

    return {
        checkExplainable: translate
            ? (requestAction: RequestAction) =>
                  canTranslateWithoutContext(
                      requestAction,
                      usedTranslators,
                      context.logger,
                  )
            : undefined,
        valueInRequest: value,
        noReferences: list,
    };
}

async function requestExplain(
    requestAction: RequestAction,
    context: CommandHandlerContext,
    fromCache: boolean,
    fromUser: boolean,
) {
    // Make sure the current requestId is captured
    const requestId = context.requestId;
    const notifyExplained = (result?: ProcessRequestActionResult) => {
        const explanationResult = result?.explanationResult.explanation;
        const error = explanationResult?.success
            ? undefined
            : explanationResult?.message;
        context.clientIO.notify(
            "explained",
            requestId,
            {
                time: new Date().toLocaleTimeString(),
                fromCache,
                fromUser,
                error,
            },
            DispatcherName,
        );
    };

    if (fromCache && !fromUser) {
        // If it is from cache, and not from the user, explanation is not necessary.
        notifyExplained();
        return;
    }

    const options = getExplainerOptions(requestAction, context);
    if (options === undefined) {
        return;
    }

    const processRequestActionP = context.agentCache.processRequestAction(
        requestAction,
        true,
        options,
    );

    if (context.explanationAsynchronousMode) {
        processRequestActionP.then(notifyExplained).catch((e) =>
            context.clientIO.notify(
                "explained",
                requestId,
                {
                    error: e.message,
                    fromCache,
                    fromUser,
                    time: new Date().toLocaleTimeString(),
                },
                DispatcherName,
            ),
        );
    } else {
        console.log(
            chalk.grey(`Generating explanation for '${requestAction}'`),
        );
        const processRequestActionResult = await processRequestActionP;
        notifyExplained(processRequestActionResult);

        printProcessRequestActionResult(processRequestActionResult);
    }
}

export class RequestCommandHandler implements CommandHandler {
    public readonly description = "Translate and explain a request";
    public readonly parameters = {
        args: {
            request: {
                description: "Request to translate",
                implicitQuotes: true,
                optional: true, // can be optional since the user can supply images and no text // TODO: revisit
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
        attachments?: string[],
    ) {
        const systemContext = context.sessionContext.agentContext;
        const profiler = systemContext.commandProfiler?.measure(
            ProfileNames.request,
        );
        try {
            // Don't handle the request if it contains the separator
            const request =
                params.args.request === undefined ? "" : params.args.request;
            if (request.includes(RequestAction.Separator)) {
                throw new Error(
                    `Invalid translation request with translation separator '${RequestAction.Separator}'.  Use @explain if you want to explain a translation.`,
                );
            }

            // store attachments for later reuse
            const cachedAttachments: CachedImageWithDetails[] = [];
            if (attachments) {
                for (let i = 0; i < attachments?.length; i++) {
                    const [attachmentName, tags]: [string, ExifReader.Tags] =
                        await systemContext.session.storeUserSuppliedFile(
                            attachments![i],
                        );

                    cachedAttachments.push(
                        new CachedImageWithDetails(
                            tags,
                            attachmentName,
                            attachments![i],
                        ),
                    );
                }
            }

            const history = systemContext.session.getConfig().translation
                .history
                ? getChatHistoryForTranslation(systemContext)
                : undefined;
            if (history) {
                // prefetch entities here
                systemContext.chatHistory.addEntry(
                    request,
                    [],
                    "user",
                    systemContext.requestId,
                    cachedAttachments,
                );
            }

            // Make sure we clear any left over streaming context
            systemContext.streamingActionContext = undefined;

            const canUseCacheMatch =
                (attachments === undefined || attachments.length === 0) &&
                !hasAdditionalInstructions(history);
            const match = canUseCacheMatch
                ? await matchRequest(request, context, history)
                : undefined;

            const translationResult =
                match === undefined // undefined means not found
                    ? await translateRequest(
                          request,
                          context,
                          history,
                          cachedAttachments,
                      )
                    : match; // result or null

            if (!translationResult) {
                // undefined means not found or not translated
                // null means cancelled because of replacement parse error.
                return;
            }

            const { requestAction, fromUser, fromCache } = translationResult;
            if (
                requestAction !== null &&
                requestAction !== undefined &&
                systemContext.conversationManager
            ) {
                systemContext.conversationManager.queueAddMessage({
                    text: request,
                    timestamp: new Date(),
                });
            }
            await requestExecute(requestAction, context);
            if (canUseCacheMatch) {
                await requestExplain(
                    requestAction,
                    systemContext,
                    fromCache,
                    fromUser,
                );
            }
        } finally {
            profiler?.stop();
        }
    }
}
