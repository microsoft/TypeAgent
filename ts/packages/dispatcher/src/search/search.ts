// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { LookupAndAnswerAction } from "../context/dispatcher/schema/lookupActionSchema.js";
import { ActionContext, ActionResult, Entity } from "@typeagent/agent-sdk";
import { conversation } from "knowledge-processor";
import { getLookupSettings, handleLookup } from "./internet.js";

export async function lookupAndAnswer(
    lookupAction: LookupAndAnswerAction,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionResult> {
    switch (lookupAction.parameters.lookup.source) {
        case "internet":
            console.log("Running internet lookups");
            return handleLookup(
                lookupAction.parameters.question,
                lookupAction.parameters.lookup.internetLookups,
                context,
                await getLookupSettings(true),
            );
        case "conversation":
            const conversationManager: conversation.ConversationManager = (
                context.sessionContext as any
            ).conversationManager;
            if (conversationManager !== undefined) {
                let searchResponse =
                    await conversationManager.getSearchResponse(
                        lookupAction.parameters.question,
                        lookupAction.parameters.lookup
                            .conversationLookupFilters,
                    );
                if (searchResponse) {
                    searchResponse.response?.hasHits()
                        ? console.log(
                              `Search response has ${searchResponse.response?.messages?.length} hits`,
                          )
                        : console.log("No search hits");

                    const matches =
                        await conversationManager.generateAnswerForSearchResponse(
                            lookupAction.parameters.question,
                            searchResponse,
                        );
                    if (
                        matches &&
                        matches.response &&
                        matches.response.answer
                    ) {
                        console.log("CONVERSATION MEMORY MATCHES:");
                        conversation.log.logSearchResponse(matches.response);

                        if (matches.response.answer.whyNoAnswer) {
                            console.log(
                                "No Answer: " + matches.response.answer.whyNoAnswer
                            );
                            return createActionResult(
                                "Not Answered - " + matches.response.answer.whyNoAnswer,
                                undefined,
                                matchedEntities(matches.response),
                            );
                        } else {
                            console.log(
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
                    } else {
                        console.log("bug bug");
                        return createActionResult(
                            "I don't know anything about that.",
                        );
                    }
                }
            } else {
                console.log("Conversation manager is undefined!");
            }
    }
    return createActionResult("No information found");
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