// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import {
    RequestAction,
    printProcessRequestActionResult,
    HistoryContext,
    FullAction,
    ProcessRequestActionResult,
    ExplanationOptions,
    equalNormalizedParamObject,
    toFullActions,
} from "agent-cache";

import { CommandHandlerContext } from "../../commandHandlerContext.js";

import { CachedImageWithDetails } from "common-utils";
import { Logger } from "telemetry";
import { executeActions } from "../../../execute/actionHandlers.js";
import {
    TypeAgentTranslator,
    TranslatedAction,
} from "../../../translation/agentTranslators.js";
import {
    isMultipleAction,
    isPendingRequest,
} from "../../../translation/multipleActionSchema.js";
import registerDebug from "debug";
import ExifReader from "exifreader";
import { ProfileNames } from "../../../utils/profileNames.js";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { DispatcherName, isUnknownAction } from "../dispatcherUtils.js";
import {
    getChatHistoryForTranslation,
    getTranslatorForSchema,
    translateRequest,
} from "../../../translation/translateRequest.js";
import { matchRequest } from "../../../translation/matchRequest.js";
const debugExplain = registerDebug("typeagent:explain");

async function canTranslateWithoutContext(
    requestAction: RequestAction,
    usedTranslators: Map<string, TypeAgentTranslator<object>>,
    logger?: Logger,
) {
    if (requestAction.history === undefined) {
        return;
    }

    // Do the retranslation check, which will also check the action.
    const oldActions: FullAction[] = toFullActions(requestAction.actions);
    const newActions: (FullAction | undefined)[] = [];
    const request = requestAction.request;
    try {
        const translations = new Map<string, TranslatedAction>();
        for (const [translatorName, translator] of usedTranslators) {
            const result = await translator.checkTranslate(request);
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
        for (const { action } of requestAction.actions) {
            const translatorName = action.translatorName;
            const newTranslatedActions = translations.get(translatorName)!;
            let newAction: TranslatedAction;
            if (isMultipleAction(newTranslatedActions)) {
                const entry = newTranslatedActions.parameters.requests[index];
                if (isPendingRequest(entry)) {
                    throw new Error("Pending request in multiple action");
                }
                newAction = entry.action;
            } else {
                newAction = newTranslatedActions;
            }
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

function hasAdditionalInstructions(history?: HistoryContext) {
    return (
        history &&
        history.additionalInstructions !== undefined &&
        history.additionalInstructions.length > 0
    );
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
        requestAction.actions.length > 1
    ) {
        // filter multiple
        return undefined;
    }

    const usedTranslators = new Map<string, TypeAgentTranslator<object>>();
    const actions = requestAction.actions;
    for (const { action } of actions) {
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
                .history.enabled
                ? getChatHistoryForTranslation(systemContext)
                : undefined;

            // prefetch entities here
            systemContext.chatHistory.addUserEntry(
                request,
                systemContext.requestId,
                cachedAttachments,
            );

            // Make sure we clear any left over streaming context
            systemContext.streamingActionContext?.closeActionContext();
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
                          0,
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

            await executeActions(
                requestAction.actions,
                requestAction.history?.entities,
                context,
            );
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
