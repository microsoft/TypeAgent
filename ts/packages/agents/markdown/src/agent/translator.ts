// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { ChatModelWithStreaming, openai as ai } from "aiclient";
import { createTypeScriptJsonValidator } from "typechat/ts";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { MarkdownContent } from "./markdownDocumentSchema.js";

export async function createMarkdownAgent(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT-v" | "GPT_4o",
) {
    const packageRoot = path.join("../../");
    const schemaText = await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(packageRoot, "./src/agent/markdownDocumentSchema.ts"),
                import.meta.url,
            ),
        ),
        "utf8",
    );

    const agent = new MarkdownAgent<MarkdownContent>(
        schemaText,
        "MarkdownContent",
        model,
    );
    return agent;
}

export class MarkdownAgent<T extends object> {
    schema: string;
    model: ChatModelWithStreaming;
    translator: TypeChatJsonTranslator<T>;

    constructor(schema: string, schemaName: string, fastModelName: string) {
        this.schema = schema;
        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            fastModelName,
        );
        this.model = ai.createChatModel(apiSettings, undefined, undefined, [
            "markdown",
        ]);
        const validator = createTypeScriptJsonValidator<T>(
            this.schema,
            schemaName,
        );
        this.translator = createJsonTranslator(this.model, validator);
    }

    getMarkdownUpdatePrompts(
        currentMarkdown: string | undefined,
        intent: string,
    ) {
        let contentPrompt = [];
        if (currentMarkdown) {
            contentPrompt.push({
                type: "text",
                text: `
            Here is the current markdown for the document.
            '''
            ${currentMarkdown}
            '''
            `,
            });
        }

        const promptSections = [
            {
                type: "text",
                text: "You are a virtual assistant that can help users to edit a markdown document. The document uses the github markdown flavor.",
            },
            ...contentPrompt,
            {
                type: "text",
                text: `
            Create an updated markdown document that applies the changes requested by the user below. Format your response as a "MarkdownContent" 
            object using the typescript schema below:
            '''
            ${this.schema}
            
            '''
            
            user:
            The following is a user request:
            '''
            ${intent}
            '''
            The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:
        `,
            },
        ];
        return promptSections;
    }

    async updateDocument(currentMarkdown: string | undefined, intent: string) {
        const promptSections = this.getMarkdownUpdatePrompts(
            currentMarkdown,
            intent,
        );

        this.translator.createRequestPrompt = (input: string) => {
            console.log(input);
            return "";
        };
        const response = await this.translator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }
}
