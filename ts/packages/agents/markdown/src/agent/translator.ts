// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    MultimodalPromptContent,
    Result,
    TypeChatJsonTranslator,
} from "typechat";
import { ChatModelWithStreaming, openai as ai } from "@typeagent/aiclient";
import { createTypeScriptJsonValidator } from "typechat/ts";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import registerDebug from "debug";
import { createPromptLogger } from "@typeagent/telemetry";

const promptLogger = createPromptLogger();

import { MarkdownUpdateResult } from "./markdownOperationSchema.js";

const debug = registerDebug("typeagent:markdown:translator");

export async function createMarkdownAgent() {
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
    );
    return agent;
}

export class MarkdownAgent<T extends object> {
    schema: string;
    model: ChatModelWithStreaming;
    translator: TypeChatJsonTranslator<T>;
    // Optional accumulator the caller sets before issuing a request so the
    // LLM token usage reported by the model can be attributed back to the
    // dispatcher's "Action Tokens". Left undefined => usage is not tracked.
    tokenUsage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };

    constructor(schema: string, schemaName: string) {
        this.schema = schema;
        this.model = ai.createChatModel(undefined, undefined, undefined, [
            "markdown",
        ]);

        // Capture per-call token usage reported by the model. Both the
        // TypeChat translate() path and the direct model.complete() path
        // invoke this callback. Compose with any existing callback so we
        // don't clobber one set elsewhere.
        const previousCompletionCallback = this.model.completionCallback;
        this.model.completionCallback = (request, response) => {
            previousCompletionCallback?.(request, response);
            const usage = (response as any)?.usage;
            if (usage && this.tokenUsage) {
                this.tokenUsage.prompt_tokens += usage.prompt_tokens ?? 0;
                this.tokenUsage.completion_tokens +=
                    usage.completion_tokens ?? 0;
                this.tokenUsage.total_tokens += usage.total_tokens ?? 0;
            }
        };

        const validator = createTypeScriptJsonValidator<T>(
            this.schema,
            schemaName,
        );
        this.translator = createJsonTranslator(this.model, validator);
    }

    getMarkdownUpdatePrompts(
        currentMarkdown: string | undefined,
        intent: string,
        cursorPosition?: number,
        context?: any, // Already deserialized from JSON string
    ) {
        const contentPrompt = [];
        if (currentMarkdown) {
            contentPrompt.push({
                type: "text",
                text: `
            Here is the current markdown for the document. The document uses GitHub-flavored markdown: 
            '''
            ${currentMarkdown}
            '''
            `,
            });
        }

        // Add cursor position context if available
        const positionPrompt = [];
        if (typeof cursorPosition === "number" && cursorPosition >= 0) {
            positionPrompt.push({
                type: "text",
                text: `
            The user's cursor is currently at position ${cursorPosition} in the document. 
            When inserting content, consider this position for context-aware placement.
            Position 0 means the beginning of the document.
            `,
            });
        }

        const promptSections = [
            {
                type: "text",
                text: `You are a virtual assistant that helps users edit markdown documents.`,
            },
            ...contentPrompt,
            ...positionPrompt,
            {
                type: "text",
                text: `Operations use zero-based character offsets into the original raw Markdown string, not ProseMirror positions or rendered text. The original document length is ${currentMarkdown?.length ?? 0}; append content at position ${currentMarkdown?.length ?? 0}. All operations refer to that same original string. Preserve existing content unless the user asks to change it. When adding a paragraph without an explicit location, append it at the end. Include Markdown separators as needed.
The exact original string, JSON-encoded to make whitespace unambiguous, is: ${JSON.stringify(currentMarkdown ?? "")}`,
            },
            {
                type: "text",
                text: `
            Create operations to update the markdown document based on the user's request below. Format your response as a "MarkdownUpdateResult" 
            object using the typescript schema below.

            '''
            ${this.schema}
            '''
            
            Here is the request from the user: 
            '''
            ${intent}
            '''
            
            The following is the response formatted as a JSON object with 2 spaces of indentation and no properties with the value undefined:
        `,
            },
        ];
        return promptSections;
    }

    async updateDocument(
        currentMarkdown: string | undefined,
        intent: string,
        cursorPosition?: number,
        context?: any,
    ) {
        const promptSections = this.getMarkdownUpdatePrompts(
            currentMarkdown,
            intent,
            cursorPosition,
            context,
        );

        this.translator.createRequestPrompt = (input: string) => {
            debug(`Request prompt: ${input}`);
            return "";
        };

        const response = await this.translator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    async updateDocumentWithStreaming(
        currentMarkdown: string | undefined,
        intent: string,
        onChunk: (chunk: string) => void,
        cursorPosition?: number,
        context?: any, // Already deserialized from JSON string
    ): Promise<Result<MarkdownUpdateResult>> {
        debug("Starting streaming updateDocument");

        // For streaming commands, we'll use a simpler approach that generates text content
        // and then converts it to operations at the end
        const streamingPrompt = this.getStreamingPrompts(
            currentMarkdown,
            intent,
            cursorPosition,
            context,
        );

        const response = await this.model.complete(
            streamingPrompt,
            undefined,
            undefined,
            promptLogger.logModelRequest,
        );
        if (!response.success) {
            return response;
        }

        const content = response.data;
        debug(`Simulating streaming for ${content.length} chars`);
        const words = content.split(" ");
        for (let i = 0; i < words.length; i += 3) {
            const chunk =
                words.slice(i, i + 3).join(" ") +
                (i + 3 < words.length ? " " : "");
            onChunk(chunk);
            await new Promise((resolve) => setTimeout(resolve, 150));
        }

        return {
            success: true,
            data: {
                operations: this.convertContentToOperations(
                    content,
                    intent,
                    cursorPosition,
                ),
                operationSummary: `Generated ${content.length} characters of content`,
            },
        };
    }

    getStreamingPrompts(
        currentMarkdown: string | undefined,
        intent: string,
        cursorPosition?: number,
        context?: any,
    ) {
        let contextPrompt = "";
        if (currentMarkdown) {
            contextPrompt = `\n\nCurrent document content:\n${currentMarkdown}\n\n`;
        }

        // Add cursor position context
        let positionPrompt = "";
        if (typeof cursorPosition === "number" && cursorPosition >= 0) {
            positionPrompt = `The user's cursor is at position ${cursorPosition} in the document. `;
        }

        return [
            {
                role: "user" as const,
                content: `You are a helpful assistant that generates markdown content based on user requests.${contextPrompt}${positionPrompt}User request: ${intent}\n\nPlease generate the requested content directly as markdown text. Do not include any explanations or metadata, just the content that should be added to the document:`,
            },
        ];
    }

    convertContentToOperations(
        content: string,
        intent: string,
        cursorPosition?: number,
    ) {
        // Convert generated content to operations format
        const operations = [
            {
                type: "insert" as const,
                position: cursorPosition || 0, // Use the actual cursor position
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
