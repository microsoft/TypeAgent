// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HistoryContext } from "agent-cache";
import { CachedImageWithDetails } from "common-utils";
import { PromptSection, TypeChatJsonTranslator } from "typechat";

export function createTypeAgentRequestPrompt(
    translator: TypeChatJsonTranslator<object>,
    request: string,
    history: HistoryContext | undefined,
    attachments: CachedImageWithDetails[] | undefined,
    context: boolean = true, // set to false to totally remove any context information (e.g. today's date), not just history
) {
    if (attachments !== undefined && attachments?.length > 0) {
        if (request.length == 0) {
            request = `Caption the first image in no less than 150 words without making any assumptions, remain factual.`;
        }
    }

    const prompts: string[] = [];
    if (translator.validator.getSchemaText() === "") {
        // If the schema is empty, we are skipping the type script schema because of json schema.
        prompts.push(
            `You are a service that translates user requests into JSON objects`,
        );
    } else {
        prompts.push(
            `You are a service that translates user requests into JSON objects of type "${translator.validator.getTypeName()}" according to the following TypeScript definitions:`,
            `\`\`\``,
            translator.validator.getSchemaText(),
            `\`\`\``,
        );
    }

    if (context) {
        if (history !== undefined) {
            const promptSections: PromptSection[] = history.promptSections;
            if (promptSections.length > 1) {
                prompts.push("The following is a summary of the chat history:");

                const promptEntities = history.entities;
                if (promptEntities.length > 0) {
                    prompts.push("###");
                    prompts.push(
                        "Recent entities found in chat history, in order, oldest first:",
                    );
                    prompts.push(
                        JSON.stringify(
                            promptEntities.map((entity, i) => ({
                                id: `\${entity-${i}}`,
                                name: entity.name,
                                type: entity.type,
                            })),
                            undefined,
                            2,
                        ),
                    );
                }

                const additionalInstructions = history?.additionalInstructions;
                if (
                    additionalInstructions !== undefined &&
                    additionalInstructions.length > 0
                ) {
                    prompts.push("###");
                    prompts.push(
                        "Information about the latest assistant action:",
                    );
                    prompts.push(...additionalInstructions);
                }

                prompts.push("###");
                prompts.push("The latest assistant response:");
                prompts.push(
                    promptSections[promptSections.length - 1].content as string,
                );
            }
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
            "Resolve all explicit and pronouns in the current user request with the recent entities in the chat history. Determine the entities implicitly referred in the current user request based on the chat history.",
            "MUST not use the entity's name as parameter values. Use entities' id as parameter values when referring to entities",
            "If there are multiple possible resolution, choose the most likely resolution based on conversation context, bias toward the newest. Avoid clarifying unless absolutely necessary. Infer the user's intent based on conversation context.",
        );
    }
    prompts.push(
        `Based primarily on the current user request with references and pronouns resolved with recent entities in the chat history, but considering the context of the whole chat history, the following is the current user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:`,
    );
    return prompts.join("\n");
}
