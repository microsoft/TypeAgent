// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createActionResultFromError,
    createActionResultFromHtmlDisplay,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    LookupAndAnswerAction,
    TermFilter,
} from "../context/dispatcher/schema/lookupActionSchema.js";
import { ActionContext, ActionResult, Entity } from "@typeagent/agent-sdk";
import { conversation } from "knowledge-processor";
import { getLookupSettings, handleLookup } from "./internet.js";
import registerDebug from "debug";
import { getImageElement, getMimeType } from "common-utils";
import { lookupAndAnswerFromMemory } from "../context/memory.js";

const debug = registerDebug("typeagent:dispatcher:lookup");
const debugError = registerDebug("typeagent:dispatcher:lookup:error");

async function getAnswerFromConversationManager(
    context: ActionContext<CommandHandlerContext>,
    question: string,
    conversationLookupFilters: TermFilter[],
) {
    const conversationManager =
        context.sessionContext.agentContext.conversationManager;
    if (conversationManager === undefined) {
        throw new Error("Conversation manager is undefined!");
    }
    let searchResponse = await conversationManager.getSearchResponse(
        question,
        conversationLookupFilters,
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
    const matches = await conversationManager.generateAnswerForSearchResponse(
        question,
        searchResponse,
    );
    if (matches && matches.response && matches.response.answer) {
        console.log("CONVERSATION MEMORY MATCHES:");
        conversation.log.logSearchResponse(matches.response);

        const whyNoAnswer = matches.response.answer.whyNoAnswer;
        if (whyNoAnswer) {
            debugError(`No Answer: ${whyNoAnswer}`);
            return createActionResultFromError(`Not Answered - ${whyNoAnswer}`);
        } else {
            debug(
                "Answer: " +
                    matches.response.answer.answer
                        ?.replace("\n", "")
                        .substring(0, 100) +
                    "...",
            );

            const matchEntities: Entity[] = matchedEntities(matches.response);
            const imageNames: (string | undefined)[] = matchEntities.map(
                (e) => {
                    if (e.type.includes("image")) {
                        return e.name;
                    }
                },
            );

            return createActionResultFromHtmlDisplay(
                `<div>${matches.response.answer.answer!}</div><div class='chat-smallImage'>${await rehydrateImages(context, imageNames)}</div>`,
                matches.response.answer.answer!,
                matchEntities,
            );
        }
    }

    debugError("bug bug");
    return createActionResultFromError("I don't know anything about that.");
}

export async function lookupAndAnswer(
    lookupAction: LookupAndAnswerAction,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionResult> {
    const source = lookupAction.parameters.lookup.source;
    switch (source) {
        case "internet": {
            const { question, lookup, originalRequest } =
                lookupAction.parameters;

            const result = handleLookup(
                question,
                lookup.internetLookups,
                lookup.site,
                context,
                await getLookupSettings(true),
                originalRequest,
            );

            return result;
        }
        case "conversation": {
            const systemContext = context.sessionContext.agentContext;
            if (systemContext.session.getConfig().execution.memory.legacy) {
                return getAnswerFromConversationManager(
                    context,
                    lookupAction.parameters.question,
                    lookupAction.parameters.lookup.conversationLookupFilters,
                );
            }
            const literalText = await lookupAndAnswerFromMemory(
                context,
                lookupAction.parameters.question,
            );
            // TODO: how about entities?
            return createActionResultNoDisplay(literalText.join("\n"));
        }
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

async function rehydrateImages(
    context: ActionContext<CommandHandlerContext>,
    files: (string | undefined)[],
) {
    let html = "<div>";

    if (files) {
        for (let i = 0; i < files.length; i++) {
            let name = files[i];

            if (files[i] && name) {
                console.log(`Rehydrating Image ${name}`);
                if (files[i]!.lastIndexOf("\\") > -1) {
                    name = files[i]!.substring(files[i]!.lastIndexOf("\\") + 1);
                }

                let a = await context.sessionContext.sessionStorage?.read(
                    `\\..\\user_files\\${name}`,
                    "base64",
                );

                if (a) {
                    html += getImageElement(
                        `data:image/${getMimeType(name.substring(name.indexOf(".")))};base64,${a}`,
                    );
                }
            }
        }
    }

    html += "</div>";

    return html;
}
