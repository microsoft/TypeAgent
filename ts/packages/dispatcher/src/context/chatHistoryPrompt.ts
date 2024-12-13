// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Entity } from "@typeagent/agent-sdk";
import { HistoryContext } from "agent-cache";
import { CachedImageWithDetails } from "common-utils";
import { PromptSection, TypeChatJsonTranslator } from "typechat";

function entityToText(entity: Entity) {
    return `${entity.name} (${entity.type})${entity.additionalEntityText ? `: ${entity.additionalEntityText}` : ""}`;
}

export function createTypeAgentRequestPrompt(
    translator: TypeChatJsonTranslator<object>,
    request: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
) {
    let promptSections: PromptSection[] = [];
    let entities: Entity[] = [];
    let entityStr = "";
    let latestEntity = "";

    if (history) {
        promptSections = history.promptSections;
        entities = history.entities;

        if (entities.length > 0) {
            entityStr =
                "Most recent entities found in chat history, in order, newest first:\n";

            for (let i = 0; i < entities.length; ++i) {
                const entity = entities[i];

                let curEntityStr = entityToText(entity) + "\n";
                if (i > 0) {
                    entityStr += curEntityStr;
                } else {
                    latestEntity = curEntityStr;
                }
            }
        }
    }

    if (attachments !== undefined && attachments?.length > 0) {
        if (request.length == 0) {
            request = `Caption the first image in no less than 150 words without making any assumptions, remain factual.`;
        }
    }

    const prompts: string[] = [
        `You are a service that translates user requests into JSON objects of type "${translator.validator.getTypeName()}" according to the following TypeScript definitions:`,
        `\`\`\``,
        translator.validator.getSchemaText(),
        `\`\`\``,
    ];
    if (promptSections.length > 1) {
        prompts.push("The following is a summary of the chat history:");
        if (entityStr.length > 0) {
            prompts.push("###");
            prompts.push(entityStr);
            prompts.push("###");
        }
        if (latestEntity.length > 0) {
            prompts.push("The latest entity discussed:");
            prompts.push(latestEntity);
        }

        const additionalInstructions = history?.additionalInstructions;
        if (
            additionalInstructions !== undefined &&
            additionalInstructions.length > 0
        ) {
            prompts.push("Information about the latest assistant action:");
            prompts.push(...additionalInstructions);
        }

        prompts.push("The latest assistant response:");
        prompts.push(
            promptSections[promptSections.length - 1].content as string,
        );
    }
    prompts.push(
        `Current Date is ${new Date().toLocaleDateString("en-US")}. The time is ${new Date().toLocaleTimeString()}.`,
    );
    prompts.push(`The following is the latest user request:`);
    prompts.push(`"""\n${request}\n"""`);
    prompts.push(
        `Based primarily on the request but considering all available information in our chat history, the following is the latest user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:`,
    );
    //console.log(prompt);
    return prompts.join("\n");
}
