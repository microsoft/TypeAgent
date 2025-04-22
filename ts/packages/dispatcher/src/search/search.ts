// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createActionResult,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { LookupAndAnswerAction } from "../context/dispatcher/schema/lookupActionSchema.js";
import { ActionContext, ActionResult, Entity } from "@typeagent/agent-sdk";
import { conversation } from "knowledge-processor";
import { getLookupSettings, handleLookup } from "./internet.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:dispatcher:lookup");
const debugError = registerDebug("typeagent:dispatcher:lookup:error");

export async function lookupAndAnswer(
    lookupAction: LookupAndAnswerAction,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionResult> {
    const source = lookupAction.parameters.lookup.source;
    switch (source) {
        case "internet":
            const { question, lookup } = lookupAction.parameters;
            return handleLookup(
                question,
                lookup.internetLookups,
                lookup.site,
                context,
                await getLookupSettings(true),
            );
        case "conversation":
            const conversationManager: conversation.ConversationManager = (
                context.sessionContext as any
            ).conversationManager;
            if (conversationManager === undefined) {
                throw new Error("Conversation manager is undefined!");
            }
            let searchResponse = await conversationManager.getSearchResponse(
                lookupAction.parameters.question,
                lookupAction.parameters.lookup.conversationLookupFilters,
            );
            if (searchResponse === undefined) {
                throw new Error("Search response is undefined!");
            }

            if (debug.enabled) {
                searchResponse.response?.hasHits()
                    ? debug(
                          `Search response has ${searchResponse.response?.messages?.length} hits`,
                      )
                    : debug("No search hits");
            }
            const matches =
                await conversationManager.generateAnswerForSearchResponse(
                    lookupAction.parameters.question,
                    searchResponse,
                );
            if (matches && matches.response && matches.response.answer) {
                console.log("CONVERSATION MEMORY MATCHES:");
                conversation.log.logSearchResponse(matches.response);

                const whyNoAnswer = matches.response.answer.whyNoAnswer;
                if (whyNoAnswer) {
                    debugError(`No Answer: ${whyNoAnswer}`);
                    return createActionResultFromError(
                        `Not Answered - ${whyNoAnswer}`,
                    );
                } else {
                    debug(
                        "Answer: " +
                            matches.response.answer.answer
                                ?.replace("\n", "")
                                .substring(0, 100) +
                            "...",
                    );
                    return createActionResult(
                        matches.response.answer.answer!,
                        undefined,
                        matchedEntities(matches.response),
                    );
                }
            }
            debugError("bug bug");
            return createActionResultFromError(
                "I don't know anything about that.",
            );
        default:
            throw new Error(`Unknown lookup source: ${source}`);
    }
}

function matchedEntities(response: conversation.SearchResponse): Entity[] {
    const entities = response.getEntities();
    return entities.length > 0
        ? entities.map((e) => compositeEntityToEntity(e))
        : [];
}

function compositeEntityToEntity(entity: conversation.CompositeEntity): Entity {
    return {
        name: entity.name,
        type: [...entity.type, conversation.KnownEntityTypes.Memorized],
    };
}
