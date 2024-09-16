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
} from "agent-cache";
import {
    CommandHandlerContext,
    getTranslator,
    getActiveTranslatorList,
    isTranslatorActive,
    updateCorrectionContext,
    isActionActive,
} from "./common/commandHandlerContext.js";

import { CachedImageWithDetails, getColorElapsedString } from "common-utils";
import {
    executeActions,
    getTranslatorPrefix,
    startStreamPartialAction,
    validateWildcardMatch,
} from "../action/actionHandlers.js";
import { unicodeChar } from "../utils/interactive.js";
import { isChangeAssistantAction } from "../translation/agentTranslators.js";
import { loadAssistantSelectionJsonTranslator } from "../translation/unknownSwitcher.js";
import {
    MultipleAction,
    isMultipleAction,
} from "../translation/systemActionsInlineSchema.js";
import { makeRequestPromptCreator } from "./common/chatHistoryPrompt.js";
import { MatchResult } from "../../../cache/dist/constructions/constructions.js";
import registerDebug from "debug";
import { getAllActionInfo } from "../translation/actionInfo.js";
import { IncrementalJsonValueCallBack } from "../../../commonUtils/dist/incrementalJsonParser.js";
import ExifReader from "exifreader";
import { Result } from "typechat";
import { ProfileNames } from "../utils/profileNames.js";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/commands";
import { ActionContext } from "@typeagent/agent-sdk";
import {
    displayError,
    displayInfo,
    displayStatus,
    displayWarn,
} from "./common/interactiveIO.js";

const debugTranslate = registerDebug("typeagent:translate");
const debugConstValidation = registerDebug("typeagent:const:validation");

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
    const prefaceSingle =
        "Use the buttons to run or cancel the following action. You can also type Enter to run it or Del to cancel it.";
    const prefaceMultiple =
        "Use the buttons to run or cancel the following sequence of actions. You can also type Enter to run it or Del to cancel it.";
    const translatorNames = getActiveTranslatorList(systemContext).filter(
        (name) => !name.startsWith("system."),
    );

    const allActionInfo = getAllActionInfo(
        translatorNames,
        systemContext.agents,
    );
    const templateSequence = actions.toTemplateSequence(
        prefaceSingle,
        prefaceMultiple,
        allActionInfo,
    );
    systemContext.clientIO?.actionCommand(
        templateSequence,
        "register",
        systemContext.requestId!,
    );
    const accept = await systemContext.requestIO.askYesNo("reserved", true);
    if (accept) {
        return { requestAction };
    }

    const searchMenuItems = Array.from(allActionInfo.values()).map(
        (info) => info.item,
    );
    systemContext.clientIO?.searchMenuCommand(
        "actions",
        "register",
        "",
        searchMenuItems,
        true,
    );
    const actionLegend = `Select the action you would like to run for this request ...`;
    systemContext.clientIO?.searchMenuCommand(
        "actions",
        "legend",
        actionLegend,
    );
    const answer = await systemContext.requestIO.question(actionLegend);
    if (answer !== undefined) {
        const actionInfo = allActionInfo.get(answer);
        if (actionInfo && actionInfo.template) {
            console.log(
                `Selected action: ${actionInfo.template.agent}.${actionInfo.item.matchText}`,
            );
        }
    }
    return { requestAction: null };
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
        const useTranslators = getActiveTranslatorList(systemContext);
        const matches = constructionStore.match(request, {
            wildcard: config.matchWildcard,
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

    const translator = getTranslator(systemContext, translatorName);

    const orp = translator.createRequestPrompt;
    if (history) {
        debugTranslate(
            `Using history for translation. Entities: ${JSON.stringify(history.entities)}`,
        );
    }

    translator.createRequestPrompt = makeRequestPromptCreator(
        translator,
        history,
        attachments,
    );

    const profiler = systemContext.commandProfiler?.measure(
        ProfileNames.translate,
    );

    let response: Result<object>;
    try {
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

        response = await translator.translate(
            request,
            history?.promptSections,
            onProperty,
            attachments,
            );
    } finally {
        translator.createRequestPrompt = orp;
        profiler?.stop();
    }

    // TODO: figure out if we want to keep track of this
    //Profiler.getInstance().incrementLLMCallCount(context.requestId);

    if (!response.success) {
        displayError(response.message, context);
        return undefined;
    }
    // console.log(`response: ${JSON.stringify(response.data)}`);
    return response.data as IAction;
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
        getActiveTranslatorList(systemContext).filter(
            (enabledTranslatorName) => translatorName !== enabledTranslatorName,
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
    } else if (action.actionName === "unknown") {
        request = action.parameters.text as string;
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
        if (!isTranslatorActive(nextTranslatorName, systemContext)) {
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
        currentAction = {
            actionName: "unknown",
            parameters: { text: currentAction.parameters.request },
        };
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
    if (!isTranslatorActive(translatorName, systemContext)) {
        debugTranslate(
            `Translating request using default translator: ${translatorName} not active`,
        );
        // REVIEW: Just pick the first one.
        translatorName = getActiveTranslatorList(systemContext)[0];
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

// remove whitespace from a string, except for whitespace within quotes
function removeUnquotedWhitespace(str: string) {
    return str.replace(/\s(?=(?:(?:[^"]*"){2})*[^"]*$)/g, "");
}

function canExecute(
    requestAction: RequestAction,
    context: ActionContext<CommandHandlerContext>,
): boolean {
    const actions = requestAction.actions;

    const unknown: Action[] = [];
    const disabled = new Set<string>();
    for (const action of actions) {
        if (action.actionName === "unknown") {
            unknown.push(action);
        }
        if (
            action.translatorName &&
            !isActionActive(
                action.translatorName,
                context.sessionContext.agentContext,
            )
        ) {
            disabled.add(action.translatorName);
        }
    }

    if (unknown.length > 0) {
        displayError(
            `Unable to determine action for ${actions.action === undefined ? "one or more actions in " : ""}'${requestAction.request}'.\n- ${unknown.map((action) => action.parameters.text).join("\n- ")}`,
            context,
        );
        return false;
    }

    if (disabled.size > 0) {
        displayWarn(
            `Not executed. Action disabled for ${Array.from(disabled.values()).join(", ")}`,
            context,
        );
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

async function requestExplain(
    requestAction: RequestAction,
    context: CommandHandlerContext,
    fromCache: boolean,
    fromUser: boolean,
) {
    // Make sure the current requestId is captured
    const requestId = context.requestId;
    const notifyExplained = () => {
        context.requestIO.notify("explained", requestId, {
            time: new Date().toLocaleTimeString(),
            fromCache,
            fromUser,
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

    const actions = requestAction.actions;
    for (const action of actions) {
        if (action.actionName === "unknown") {
            return;
        }

        if (
            action.translatorName !== undefined &&
            context.agents.getTranslatorConfig(action.translatorName).cached ===
                false
        ) {
            return;
        }
    }

    const processRequestActionP = context.agentCache.processRequestAction(
        requestAction,
        true,
    );

    if (context.explanationAsynchronousMode) {
        // TODO: result/error handler in Asynchronous mode
        processRequestActionP.then(notifyExplained).catch();
    } else {
        console.log(
            chalk.grey(`Generating explanation for '${requestAction}'`),
        );
        const processRequestActionResult = await processRequestActionP;
        notifyExplained();

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
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
        attachments?: string[],
    ) {
        const systemContext = context.sessionContext.agentContext;
        const profiler = systemContext.commandProfiler?.measure(
            ProfileNames.request,
        );
        try {
            // Don't handle the request if it contains the separator
            if (request.includes(RequestAction.Separator)) {
                throw new Error(
                    `Invalid translation request with translation separator '${RequestAction.Separator}'.  Use @explain if you want to explain a translation.`,
                );
            }

        // store attachments for later reuse
        let cachedAttachments: CachedImageWithDetails[] = new Array<CachedImageWithDetails>();
        if (attachments) {
            for (let i = 0; i < attachments?.length; i++) {
                const [attachmentName, tags]: [string, ExifReader.Tags] =
                    await systemContext.session.storeUserSuppliedFile(
                        attachments![i],
                    );

                cachedAttachments.push(new CachedImageWithDetails(tags, attachmentName, attachments![i]));
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

        const match = await matchRequest(request, context, history);
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
                systemContext.conversationManager.addMessage(
                    request,
                    [],
                    new Date(),
                );
            }
            await requestExecute(requestAction, context);
            await requestExplain(
                requestAction,
                systemContext,
                fromCache,
                fromUser,
            );
        } finally {
            profiler?.stop();
        }
    }
}
