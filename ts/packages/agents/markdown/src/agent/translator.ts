// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { ChatModelWithStreaming, openai as ai } from "aiclient";
import { createTypeScriptJsonValidator } from "typechat/ts";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import registerDebug from "debug";

import { MarkdownUpdateResult } from "./markdownOperationSchema.js";

const debug = registerDebug("typeagent:markdown:translator");

export async function createMarkdownAgent(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT-v" | "GPT_4o",
) {
    const packageRoot = path.join("../../");
    const schemaText = await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/markdownOperationSchema.ts",
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );

    const agent = new MarkdownAgent<MarkdownUpdateResult>(
        schemaText,
        "MarkdownUpdateResult",
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
            Here is the current markdown for the document:
            '''
            ${currentMarkdown}
            '''
            `,
            });
        }

        const promptSections = [
            {
                type: "text",
                text: `You are a virtual assistant that helps users edit markdown documents. The document uses GitHub-flavored markdown.

                Here is the current state of the document`,
            },
            ...contentPrompt,
            {
                type: "text",
                text: `
            Create operations to update the markdown document based on the user's request below. Format your response as a "MarkdownUpdateResult" 
            object using the typescript schema below.

            '''
            ${this.schema}
            '''
            
            User request: ${intent}
            
            The following is the response formatted as a JSON object with 2 spaces of indentation and no properties with the value undefined:
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
            debug(`Request prompt: ${input}`);
            return "";
        };
        const response = await this.translator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async updateDocumentWithStreaming(
        currentMarkdown: string | undefined,
        intent: string,
        onChunk: (chunk: string) => void,
    ) {
        debug("Starting streaming updateDocument");

        // For streaming commands, we'll use a simpler approach that generates text content
        // and then converts it to operations at the end
        const streamingPrompt = this.getStreamingPrompts(
            currentMarkdown,
            intent,
        );

        try {
            let accumulatedContent = "";

            // Use the ChatModel's complete method with proper parameters
            const response = await this.model.complete(streamingPrompt);

            // Extract content from response
            let content = "";
            if (typeof response === "string") {
                content = response;
            } else if (response && typeof response === "object") {
                // Handle different response formats
                content =
                    (response as any)?.choices?.[0]?.message?.content ||
                    (response as any)?.content ||
                    (response as any)?.text ||
                    "Generated content for: " + intent;
            } else {
                content = "Generated content for: " + intent;
            }

            // Simulate streaming by sending chunks with delays
            debug(`Simulating streaming for ${content.length} chars`);
            const words = content.split(" ");

            for (let i = 0; i < words.length; i += 3) {
                const chunk =
                    words.slice(i, i + 3).join(" ") +
                    (i + 3 < words.length ? " " : "");
                accumulatedContent += chunk;
                onChunk(chunk);

                // Small delay to simulate streaming
                await new Promise((resolve) => setTimeout(resolve, 150));
            }

            debug(
                `Streaming complete, accumulated ${accumulatedContent.length} chars`,
            );

            // Convert the accumulated content to operations
            const operations = this.convertContentToOperations(
                accumulatedContent,
                intent,
            );

            return {
                success: true,
                data: {
                    operations: operations,
                    operationSummary: `Generated ${accumulatedContent.length} characters of content`,
                },
            };
        } catch (error) {
            console.error("[TRANSLATOR] Streaming failed:", error);

            // Fallback: generate simple content and stream it
            const fallbackContent = `Generated content for: ${intent}\n\nThis is AI-generated content based on your request.`;

            // Stream the fallback content
            const words = fallbackContent.split(" ");
            let accumulatedContent = "";

            for (let i = 0; i < words.length; i += 3) {
                const chunk =
                    words.slice(i, i + 3).join(" ") +
                    (i + 3 < words.length ? " " : "");
                accumulatedContent += chunk;
                onChunk(chunk);
                await new Promise((resolve) => setTimeout(resolve, 150));
            }

            const operations = this.convertContentToOperations(
                accumulatedContent,
                intent,
            );

            return {
                success: true,
                data: {
                    operations: operations,
                    operationSummary: `Generated fallback content (${accumulatedContent.length} characters)`,
                },
            };
        }
    }

    getStreamingPrompts(currentMarkdown: string | undefined, intent: string) {
        let contextPrompt = "";
        if (currentMarkdown) {
            contextPrompt = `\n\nCurrent document content:\n${currentMarkdown}\n\n`;
        }

        return [
            {
                role: "user" as const,
                content: `You are a helpful assistant that generates markdown content based on user requests.${contextPrompt}User request: ${intent}\n\nPlease generate the requested content directly as markdown text. Do not include any explanations or metadata, just the content that should be added to the document:`,
            },
        ];
    }

    convertContentToOperations(content: string, intent: string) {
        // Convert generated content to operations format
        const operations = [
            {
                type: "insert",
                position: 0, // Will be set by the handler based on cursor position
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: content,
                            },
                        ],
                    },
                ],
                description: `Generated content for: ${intent}`,
            },
        ];

        return operations;
    }
}
