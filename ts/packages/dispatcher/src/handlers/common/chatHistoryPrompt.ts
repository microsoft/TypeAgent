// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Entity } from "@typeagent/agent-sdk";
import { HistoryContext } from "agent-cache";
import { TypeChatJsonTranslator } from "typechat";

function entityToText(entity: Entity) {
    return `${entity.name} (${entity.type})${entity.additionalEntityText ? `: ${entity.additionalEntityText}` : ""}`;
}

export function makeRequestPromptCreator(
    translator: TypeChatJsonTranslator<object>,
    history: HistoryContext | undefined,
) {
    let promptSections: any[] = [];
    let entities = [];
    let entityStr = "";
    let latestEntity = "";

    if (history) {
        promptSections = history.promptSections;
        entities = history.entities;

        entityStr =
            "Most recent entities found in chat history, in order, newest first:\n";

        latestEntity = "";
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

    return (request: string) => {
        let prompt =
            `You are a service that translates user requests into JSON objects of type "${translator.validator.getTypeName()}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${translator.validator.getSchemaText()}\`\`\`\n`;
        if (promptSections.length > 1) {
            prompt +=
                `The following is a summary of the chat history:\n###\n` +
                entityStr +
                "###\n" +
                "The latest entity discussed:\n" +
                latestEntity +
                "\n" +
                `The latest assistant response:\n` +
                promptSections[promptSections.length - 1].content +
                "\n";
        }
        prompt +=
            `Current Date is ${new Date().toLocaleDateString("en-US")}.\n` +
            `The following is the latest user request:\n` +
            `"""\n${request}\n"""\n` +
            `Based primarily on the request but considering all available information in our chat history, the following is the latest user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`;
        // console.log(prompt);
        return prompt;
    };
}
