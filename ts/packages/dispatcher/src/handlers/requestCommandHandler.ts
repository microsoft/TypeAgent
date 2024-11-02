// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import {
    IAction,
    RequestAction,
    Action,
    printProcessRequestActionResult,
    Actions,
    HistoryContext,
    FullAction,
    ProcessRequestActionResult,
} from "agent-cache";
import {
    CommandHandlerContext,
    getTranslator,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";

import {
    CachedImageWithDetails,
    getColorElapsedString,
    Logger,
} from "common-utils";
import {
    executeActions,
    getTranslatorPrefix,
    startStreamPartialAction,
    validateWildcardMatch,
} from "../action/actionHandlers.js";
import { unicodeChar } from "../utils/interactive.js";
import {
    isChangeAssistantAction,
    TypeAgentTranslator,
} from "../translation/agentTranslators.js";
import { loadAssistantSelectionJsonTranslator } from "../translation/unknownSwitcher.js";
import {
    MultipleAction,
    isMultipleAction,
} from "../translation/multipleActionSchema.js";
import { MatchResult } from "../../../cache/dist/constructions/constructions.js";
import registerDebug from "debug";
import { IncrementalJsonValueCallBack } from "../../../commonUtils/dist/incrementalJsonParser.js";
import ExifReader from "exifreader";
import { ProfileNames } from "../utils/profileNames.js";
import {
    ActionContext,
    ParsedCommandParams,
    Profiler,
} from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displayInfo,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { DispatcherName } from "./common/interactiveIO.js";
import { getActionTemplateEditConfig } from "../translation/actionTemplate.js";
import { getActionInfo, validateAction } from "../translation/actionInfo.js";
import { isUnknownAction } from "../dispatcher/dispatcherAgent.js";
import { UnknownAction } from "../dispatcher/dispatcherActionSchema.js";

const debugTranslate = registerDebug("typeagent:translate");
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
        const actionInfo = getActionInfo(action, systemContext);
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
    if (!systemContext.developerMode) {
        const messages = [];

        if (context.actionIO.type === "text") {
            // Provide a one line information for text output
            messages.push(
                `${source}: ${chalk.blueBright(
                    ` ${requestAction.toString()}`,
                )} ${getColorElapsedString(elapsedMs)}`,
            );
            messages.push();
        }

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

    const newActions = await systemContext.requestIO.proposeAction(
        templateSequence,
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
        const useTranslators = systemContext.agents.getActiveTranslators();
        const matches = constructionStore.match(request, {
            wildcard: config.matchWildcard,
            rejectReferences: config.explanationOptions.rejectReferences,
            useTranslators,
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
                if (systemContext.requestIO.isInputEnabled()) {
                    systemContext.logger?.logEvent("match", {
                        elapsedMs,
                        request,
                        actions: requestAction.actions,
                        replacedAction,
                        developerMode: systemContext.developerMode,
                        translators: useTranslators,
                        explainerName: systemContext.agentCache.explainerName,
                        matchWildcard: config.matchWildcard,
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

async function translateRequestWithTranslator(
    translatorName: string,
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
) {
    const systemContext = context.sessionContext.agentContext;
    const prefix = getTranslatorPrefix(translatorName, systemContext);
    displayStatus(`${prefix}Translating '${request}'`, context);

    if (history) {
        debugTranslate(
            `Using history for translation. Entities: ${JSON.stringify(history.entities)}`,
        );
    }

    const profiler = systemContext.commandProfiler?.measure(
        ProfileNames.translate,
    );

    let firstToken = true;
    let streamFunction: IncrementalJsonValueCallBack | undefined;
    systemContext.streamingActionContext = undefined;
    const onProperty: IncrementalJsonValueCallBack | undefined =
        systemContext.session.getConfig().stream
            ? (prop: string, value: any, delta: string | undefined) => {
                  // TODO: streaming currently doesn't not support multiple actions
                  if (prop === "actionName" && delta === undefined) {
                      const actionTranslatorName =
                          systemContext.agents.getInjectedTranslatorForActionName(
                              value,
                          ) ?? translatorName;

                      const prefix = getTranslatorPrefix(
                          actionTranslatorName,
                          systemContext,
                      );
                      displayStatus(
                          `${prefix}Translating '${request}' into action '${value}'`,
                          context,
                      );
                      const config =
                          systemContext.agents.getTranslatorConfig(
                              actionTranslatorName,
                          );
                      if (config.streamingActions?.includes(value)) {
                          streamFunction = startStreamPartialAction(
                              actionTranslatorName,
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
    const translator = getTranslator(systemContext, translatorName);
    try {
        const response = await translator.translate(
            request,
            history,
            attachments,
            onProperty,
        );

        // TODO: figure out if we want to keep track of this
        //Profiler.getInstance().incrementLLMCallCount(context.requestId);

        if (!response.success) {
            displayError(response.message, context);
            return undefined;
        }
        // console.log(`response: ${JSON.stringify(response.data)}`);
        return response.data as IAction;
    } finally {
        profiler?.stop();
    }
}

type NextTranslation = {
    request: string;
    nextTranslatorName: string;
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
            .getActiveTranslators()
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

    const nextTranslatorName = result.data.assistant;
    if (nextTranslatorName !== "unknown") {
        return {
            request,
            nextTranslatorName,
            searched: true,
        };
    }
    return undefined;
}

async function getNextTranslation(
    action: IAction,
    translatorName: string,
    context: ActionContext<CommandHandlerContext>,
    forceSearch: boolean,
): Promise<NextTranslation | undefined> {
    let request: string;
    if (isChangeAssistantAction(action)) {
        if (!forceSearch) {
            return {
                request: action.parameters.request,
                nextTranslatorName: action.parameters.assistant,
                searched: false,
            };
        }
        request = action.parameters.request;
    } else if (isUnknownAction(action)) {
        request = action.parameters.request;
    } else {
        return undefined;
    }

    return context.sessionContext.agentContext.session.getConfig().switch.search
        ? findAssistantForRequest(request, translatorName, context)
        : undefined;
}

async function finalizeAction(
    action: IAction,
    translatorName: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
): Promise<Action | Action[] | undefined> {
    let currentAction: IAction | undefined = action;
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

        const { request, nextTranslatorName, searched } = nextTranslation;
        if (!systemContext.agents.isTranslatorActive(nextTranslatorName)) {
            // this is a bug. May be the translator cache didn't get updated when state change?
            throw new Error(
                `Internal error: switch to disabled translator ${nextTranslatorName}`,
            );
        }

        currentAction = await translateRequestWithTranslator(
            nextTranslatorName,
            request,
            context,
            history,
        );
        if (currentAction === undefined) {
            return undefined;
        }

        currentTranslatorName = nextTranslatorName;
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
        currentAction,
        systemContext.agents.getInjectedTranslatorForActionName(
            currentAction.actionName,
        ) ?? currentTranslatorName,
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
    promptSections.unshift({
        content:
            "The following is a history of the conversation with the user that can be used to translate user requests",
        role: "system",
    });
    const entities = context.chatHistory.getTopKEntities(20);
    return { promptSections, entities };
}

export async function translateRequest(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    history?: HistoryContext,
    attachments?: CachedImageWithDetails[],
): Promise<TranslationResult | undefined | null> {
    const systemContext = context.sessionContext.agentContext;
    if (!systemContext.session.bot) {
        displayError("No translation found (GPT is off).", context);
        return;
    }
    // Start with the last translator used
    let translatorName = systemContext.lastActionTranslatorName;
    if (!systemContext.agents.isTranslatorActive(translatorName)) {
        debugTranslate(
            `Translating request using default translator: ${translatorName} not active`,
        );
        // REVIEW: Just pick the first one.
        translatorName = systemContext.agents.getActiveTranslators()[0];
        if (translatorName === undefined) {
            throw new Error("No active translator available");
        }
    } else {
        debugTranslate(
            `Translating request using current translator: ${translatorName}`,
        );
    }
    const startTime = performance.now();

    const action = await translateRequestWithTranslator(
        translatorName,
        request,
        context,
        history,
        attachments,
    );
    if (action === undefined) {
        return undefined;
    }

    const translatedAction = isMultipleAction(action)
        ? await finalizeMultipleActions(
              action,
              translatorName,
              context,
              history,
          )
        : await finalizeAction(action, translatorName, context, history);

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
        if (systemContext.requestIO.isInputEnabled()) {
            systemContext.logger?.logEvent("translation", {
                elapsedMs,
                translatorName,
                request,
                actions: requestAction.actions,
                replacedAction,
                developerMode: systemContext.developerMode,
                history,
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

function canExecute(
    requestAction: RequestAction,
    context: ActionContext<CommandHandlerContext>,
): boolean {
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
        const message = `Unable to determine ${actions.action === undefined ? "one or more actions in" : "action for"} the request.`;
        const details = `- ${unknown.map((action) => action.parameters.request).join("\n- ")}`;
        const fullMessage = `${message}\n${details}`;
        systemContext.chatHistory.addEntry(
            fullMessage,
            [],
            "assistant",
            systemContext.requestId,
        );

        displayError(fullMessage, context);
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
    if (!canExecute(requestAction, context)) {
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

    const oldActions: IAction[] = requestAction.actions.toIActions();
    const newActions: (IAction | undefined)[] = [];
    const request = requestAction.request;
    try {
        const translations = new Map<string, IAction>();
        for (const [translatorName, translator] of usedTranslators) {
            const result = await translator.translate(request);
            if (!result.success) {
                throw new Error("Failed to translate without history context");
            }
            const newActions = result.data as IAction;
            const count = isMultipleAction(newActions)
                ? newActions.parameters.requests.length
                : 1;

            if (count !== oldActions.length) {
                throw new Error("Action count mismatch without context");
            }
            translations.set(translatorName, result.data as IAction);
        }

        let index = 0;
        for (const action of requestAction.actions) {
            const translatorName = action.translatorName;
            const newTranslatedActions = translations.get(translatorName)!;
            const newAction = isMultipleAction(newTranslatedActions)
                ? newTranslatedActions.parameters.requests[index].action
                : newTranslatedActions;
            newActions.push(newAction);
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
                JSON.stringify(newAction.parameters) !==
                JSON.stringify(oldAction.parameters)
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
        context.requestIO.notify("explained", requestId, {
            time: new Date().toLocaleTimeString(),
            fromCache,
            fromUser,
            error,
        });
    };

    if (fromCache && !fromUser) {
        // If it is from cache, and not from the user, explanation is not necessary.
        notifyExplained();
        return;
    }

    if (!context.session.explanation) {
        // Explanation is disabled
        return;
    }

    const usedTranslators = new Map<string, TypeAgentTranslator<object>>();
    const actions = requestAction.actions;
    for (const action of actions) {
        if (isUnknownAction(action)) {
            return;
        }

        const translatorName = action.translatorName;
        if (
            context.agents.getTranslatorConfig(translatorName).cached === false
        ) {
            return;
        }

        usedTranslators.set(
            translatorName,
            getTranslator(context, translatorName),
        );
    }
    const { rejectReferences, retranslateWithoutContext } =
        context.session.getConfig().explanationOptions;

    const processRequestActionP = context.agentCache.processRequestAction(
        requestAction,
        true,
        {
            checkExplainable: retranslateWithoutContext
                ? (requestAction: RequestAction) =>
                      canTranslateWithoutContext(
                          requestAction,
                          usedTranslators,
                          context.logger,
                      )
                : undefined,
            rejectReferences,
        },
    );

    if (context.explanationAsynchronousMode) {
        processRequestActionP.then(notifyExplained).catch((e) =>
            context.requestIO.notify("explained", requestId, {
                error: e.message,
                fromCache,
                fromUser,
                time: new Date().toLocaleTimeString(),
            }),
        );
    } else {
        console.log(
            chalk.grey(`Generating explanation for '${requestAction}'`),
        );
        const processRequestActionResult = await processRequestActionP;
        notifyExplained(processRequestActionResult);

        // Only capture if done synchronously.
        updateCorrectionContext(
            context,
            requestAction,
            processRequestActionResult.explanationResult.explanation,
        );

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

            const history = systemContext.session.getConfig().history
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
                attachments === undefined || attachments.length === 0;
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
                systemContext.conversationManager.queueAddMessage(
                    request,
                    [],
                    new Date(),
                );
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
