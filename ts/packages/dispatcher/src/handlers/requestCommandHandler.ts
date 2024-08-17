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
import { CommandHandler } from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    getTranslator,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";

import { getColorElapsedString } from "common-utils";
import {
    executeActions,
    validateWildcardMatch,
} from "../action/actionHandlers.js";
import { unicodeChar } from "../utils/interactive.js";
import {
    getInjectedTranslatorForActionName,
    getTranslatorConfig,
    isChangeAssistantAction,
} from "../translation/agentTranslators.js";
import { loadAssistantSelectionJsonTranslator } from "../translation/unknownSwitcher.js";
import {
    MultipleAction,
    isMultipleAction,
} from "../translation/systemActionsInlineSchema.js";
import { makeRequestPromptCreator } from "./common/chatHistoryPrompt.js";
import { MatchResult } from "../../../cache/dist/constructions/constructions.js";
import registerDebug from "debug";
import { getAllActionInfo } from "../translation/actionInfo.js";

const debugConstValidation = registerDebug("typeagent:const:validation");

async function confirmTranslation(
    elapsedMs: number,
    source: string,
    requestAction: RequestAction,
    context: CommandHandlerContext,
): Promise<{
    requestAction: RequestAction | undefined | null;
    replacedAction?: Actions;
}> {
    const messages = [];
    const requestIO = context.requestIO;
    if (requestIO.type === "text") {
        // Provide a one line information for text output
        messages.push(
            `${source}: ${chalk.blueBright(
                ` ${requestAction.toString()}`,
            )} ${getColorElapsedString(elapsedMs)}`,
        );
        messages.push();
    }

    const actions = requestAction.actions;
    const prettyStr = JSON.stringify(actions, undefined, 2);
    messages.push(`${chalk.italic(chalk.cyanBright(prettyStr))}`);

    if (!context.developerMode) {
        requestIO.info(messages.join("\n"));
        return { requestAction };
    }
    const prefaceSingle =
        "Use the buttons to run or cancel the following action. You can also type Enter to run it or Del to cancel it.";
    const prefaceMultiple =
        "Use the buttons to run or cancel the following sequence of actions. You can also type Enter to run it or Del to cancel it.";
    const translatorNames = context.session.useTranslators.filter(
        (name) => !name.startsWith("system."),
    );
    const allActionInfo = getAllActionInfo(translatorNames);
    const templateSequence = actions.toTemplateSequence(
        prefaceSingle,
        prefaceMultiple,
        allActionInfo,
    );
    context.clientIO?.actionCommand(
        templateSequence,
        "register",
        context.requestId!,
    );
    const accept = await requestIO.askYesNo("reserved", true);
    if (accept) {
        return { requestAction };
    }

    const searchMenuItems = Array.from(allActionInfo.values()).map(
        (info) => info.item,
    );
    context.clientIO?.searchMenuCommand(
        "actions",
        "register",
        "",
        searchMenuItems,
        true,
    );
    const actionLegend = `Select the action you would like to run for this request ...`;
    context.clientIO?.searchMenuCommand("actions", "legend", actionLegend);
    const answer = await requestIO.question(actionLegend);
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
    context: CommandHandlerContext,
    history?: HistoryContext,
): Promise<TranslationResult | undefined | null> {
    const constructionStore = context.agentCache.constructionStore;
    if (constructionStore.isEnabled()) {
        const startTime = performance.now();
        const config = context.session.getConfig();
        const matches = constructionStore.match(request, {
            wildcard: config.matchWildcard,
            useTranslators: context.session.useTranslators,
            history,
        });

        const elapsedMs = performance.now() - startTime;

        const match = await getValidatedMatch(matches, context);
        if (match !== undefined) {
            const { requestAction, replacedAction } = await confirmTranslation(
                elapsedMs,
                unicodeChar.constructionSign,
                match.match,
                context,
            );

            if (requestAction) {
                if (context.requestIO.isInputEnabled()) {
                    context.logger?.logEvent("match", {
                        elapsedMs,
                        request,
                        actions: requestAction.actions,
                        replacedAction,
                        developerMode: context.developerMode,
                        translators: context.session.useTranslators,
                        explainerName: context.agentCache.explainerName,
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
    context: CommandHandlerContext,
    history?: HistoryContext,
) {
    context.requestIO.status(`[${translatorName}] Translating '${request}'`);
    const translator = getTranslator(context, translatorName);

    const orp = translator.createRequestPrompt;
    if (history) {
        context.requestIO.info(
            `Using history for translation. Entities: ${JSON.stringify(history.entities)}`,
        );
    }

    translator.createRequestPrompt = makeRequestPromptCreator(
        translator,
        history,
    );

    const response = await translator.translate(
        request,
        history?.promptSections,
    );
    translator.createRequestPrompt = orp;
    if (!response.success) {
        context.requestIO.error(response.message);
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
    context: CommandHandlerContext,
): Promise<NextTranslation | undefined> {
    context.requestIO.status(
        `[switcher] Looking for another assistant to handle request '${request}'`,
    );
    const selectTranslator = loadAssistantSelectionJsonTranslator(
        context.session.useTranslators.filter(
            (enabledTranslatorName) => translatorName !== enabledTranslatorName,
        ),
    );

    const result = await selectTranslator.translate(request);
    if (!result.success) {
        context.requestIO.warn(`Failed to switch assistant: ${result.message}`);
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
    context: CommandHandlerContext,
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

    return context.session.getConfig().switch.search
        ? findAssistantForRequest(request, translatorName, context)
        : undefined;
}

async function finalizeAction(
    action: IAction,
    translatorName: string,
    context: CommandHandlerContext,
    history?: HistoryContext,
): Promise<Action | Action[] | undefined> {
    let currentAction: IAction | undefined = action;
    let currentTranslatorName: string = translatorName;
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
        getInjectedTranslatorForActionName(currentAction.actionName) ??
            currentTranslatorName,
    );
}

async function finalizeMultipleActions(
    action: MultipleAction,
    translatorName: string,
    context: CommandHandlerContext,
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
    context: CommandHandlerContext,
    history?: HistoryContext,
): Promise<TranslationResult | undefined | null> {
    if (!context.session.bot) {
        context.requestIO.error("No translation found (GPT is off).");
        return;
    }
    let translatorName = context.currentTranslatorName;
    if (context.session.getConfig().translators[translatorName] !== true) {
        // REVIEW: Just pick the first one.
        translatorName = context.session.useTranslators[0];
        if (translatorName === undefined) {
            throw new Error("No active translator available");
        }
    }
    const startTime = performance.now();

    const action = await translateRequestWithTranslator(
        translatorName,
        request,
        context,
        history,
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
        if (context.requestIO.isInputEnabled()) {
            context.logger?.logEvent("translation", {
                elapsedMs,
                translatorName,
                request,
                actions: requestAction.actions,
                replacedAction,
                developerMode: context.developerMode,
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
    context: CommandHandlerContext,
): boolean {
    const requestIO = context.requestIO;

    const enabledActions = context.session.getConfig().actions;
    const actions = requestAction.actions;

    const unknown: Action[] = [];
    const disabled = new Set<string>();
    for (const action of actions) {
        if (action.actionName === "unknown") {
            unknown.push(action);
        }
        if (
            action.translatorName &&
            enabledActions[action.translatorName] !== true
        ) {
            disabled.add(action.translatorName);
        }
    }

    if (unknown.length > 0) {
        requestIO.error(
            `Unable to determine action for ${actions.action === undefined ? "one or more actions in " : ""}'${requestAction.request}'.\n- ${unknown.map((action) => action.parameters.text).join("\n- ")}`,
        );
        return false;
    }

    if (disabled.size > 0) {
        requestIO.warn(
            `Not executed. Action disabled for ${Array.from(disabled.values()).join(", ")}`,
        );
        return false;
    }

    return true;
}

async function requestExecute(
    requestAction: RequestAction,
    context: CommandHandlerContext,
) {
    if (!canExecute(requestAction, context)) {
        return;
    }

    const requestIO = context.requestIO;
    const actions = requestAction.actions;
    const action = actions.action;
    if (action === undefined) {
        requestIO.status(`Executing multiple actions...`);
    } else {
        requestIO.status(`Executing action ${action.fullActionName}`);
    }

    await executeActions(requestAction.actions, context);
}

async function requestExplain(
    requestAction: RequestAction,
    context: CommandHandlerContext,
    fromCache: boolean,
    fromUser: boolean,
) {
    // Make sure the current requestIO is captured
    const requestIO = context.requestIO;
    const notifyExplained = () => {
        requestIO.notify("explained", {
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
            getTranslatorConfig(action.translatorName).cached === false
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
    public async run(request: string, context: CommandHandlerContext) {
        // Don't handle the request if it contains the separator
        if (request.includes(RequestAction.Separator)) {
            throw new Error(
                `Invalid translation request with translation separator '${RequestAction.Separator}'.  Use @explain if you want to explain a translation.`,
            );
        }

        const history = context.session.getConfig().history
            ? getChatHistoryForTranslation(context)
            : undefined;
        if (history) {
            let entities = [];
            // prefetch entities here
            context.chatHistory.addEntry(
                request,
                [],
                "user",
                context.requestIO.getRequestId(),
            );
        }
        const match = await matchRequest(request, context, history);
        const translationResult =
            match === undefined // undefined means not found
                ? await translateRequest(request, context, history)
                : match; // result or null

        if (!translationResult) {
            // undefined means not found or not translated
            // null means cancelled because of replacement parse error.
            return;
        }

        const { requestAction, fromUser, fromCache } = translationResult;

        await requestExecute(requestAction, context);
        await requestExplain(requestAction, context, fromCache, fromUser);
    }
}
