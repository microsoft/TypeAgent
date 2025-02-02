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
    context: boolean = true,
) {
    let promptSections: PromptSection[] = [];
    let entities: Entity[] = [];
    let entityStr: string[] = [];

    if (context && history !== undefined) {
        promptSections = history.promptSections;
        entities = history.entities;

        if (entities.length > 0) {
            for (let i = 0; i < entities.length; ++i) {
                const entity = entities[i];

                entityStr.push(entityToText(entity));
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
    if (context) {
        if (promptSections.length > 1) {
            prompts.push("The following is a summary of the chat history:");
            if (entityStr.length > 0) {
                prompts.push("###");
                prompts.push(
                    "Recent entities found in chat history, in order, oldest first:",
                );
                prompts.push(...entityStr.reverse());
            }

            const additionalInstructions = history?.additionalInstructions;
            if (
                additionalInstructions !== undefined &&
                additionalInstructions.length > 0
            ) {
                prompts.push("###");
                prompts.push("Information about the latest assistant action:");
                prompts.push(...additionalInstructions);
            }

            prompts.push("###");
            prompts.push("The latest assistant response:");
            prompts.push(
                promptSections[promptSections.length - 1].content as string,
            );
        }

        prompts.push("###");
        prompts.push(
            `Current Date is ${new Date().toLocaleDateString("en-US")}. The time is ${new Date().toLocaleTimeString()}.`,
        );
    }
    prompts.push("###");
    prompts.push(`The following is the current user request:`);
    prompts.push(`"""\n${request}\n"""`);

    prompts.push("###");
    if (context && history !== undefined) {
        prompts.push(
            "Resolve all references and pronouns in the current user request with the recent entities in the chat history.  If there are multiple possible resolution, choose the most likely resolution based on conversation context, bias toward the newest.",
        );
        prompts.push(
            "Avoid clarifying unless absolutely necessary. Infer the user's intent based on conversation context.",
        );
    }
    prompts.push(
        `Based primarily on the current user request with references and pronouns resolved with recent entities in the chat history, but considering the context of the whole chat history, the following is the current user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:`,
    );
    return prompts.join("\n");
}
