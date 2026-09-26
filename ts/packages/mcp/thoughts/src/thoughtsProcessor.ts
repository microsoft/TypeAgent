// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";

export interface ProcessThoughtsOptions {
    // Raw text input (stream of consciousness or notes)
    rawText: string;
    // Additional instructions for how to format/structure the markdown
    instructions?: string;
    // Model to use
    model?: string;
    // Tags/keywords to append to the markdown for later lookup
    tags?: string[];
}

export interface ProcessThoughtsResult {
    // The generated markdown
    markdown: string;
    // Any metadata about the processing
    metadata?: {
        inputLength: number;
        outputLength: number;
    };
}

const DEFAULT_PROMPT = `You are an expert at transforming raw notes, stream-of-consciousness writing, and unstructured text into clear, well-organized markdown documents.

Your task is to:
1. Read the raw text carefully
2. Identify the main topics, ideas, and structure
3. Look for inline tag phrases like "tag this as X" or "tag X" and:
   - Remove the tag phrase from the content
   - Insert a tag marker at that location using the format: **🏷️ tag-name**
   - Place the tag marker on its own line
   - Convert the tag to lowercase and use hyphens instead of spaces
   - Example: "tag this as marshmallow colors" becomes "**🏷️ marshmallow-colors**"
4. Organize the content logically with appropriate headings
5. Clean up grammar and sentence structure while preserving the original meaning
6. Format as clean, readable markdown with:
   - Clear heading hierarchy (# ## ###)
   - Bullet points or numbered lists where appropriate
   - Code blocks if technical content is present
   - Emphasis (bold/italic) for important points
   - Links if URLs are mentioned
   - Inline tags where the author specified them

Preserve the author's voice and intent, but make it readable and well-structured.

RAW TEXT:
{rawText}

{instructions}

Generate a well-formatted markdown document:`;

export class ThoughtsProcessor {
    private model: string;

    constructor(model: string = "copilot:gpt-5.6-sol") {
        this.model = model;
    }

    async processThoughts(
        options: ProcessThoughtsOptions,
    ): Promise<ProcessThoughtsResult> {
        const { rawText, instructions, model, tags } = options;

        // Build the prompt
        let prompt = DEFAULT_PROMPT.replace("{rawText}", rawText);

        if (instructions) {
            prompt = prompt.replace(
                "{instructions}",
                `\nADDITIONAL INSTRUCTIONS:\n${instructions}\n`,
            );
        } else {
            prompt = prompt.replace("{instructions}", "");
        }

        const completion = await openai
            .createChatModel(model || this.model)
            .complete(prompt);
        if (!completion.success) {
            throw new Error(
                `Failed to process thoughts: ${completion.message}`,
            );
        }
        let markdown = completion.data;
        if (!markdown.trim()) {
            throw new Error("Failed to process thoughts: empty LLM response");
        }

        // Extract markdown from code blocks if present
        const codeBlockMatch = markdown.match(
            /```(?:markdown)?\n([\s\S]*?)\n```/,
        );
        if (codeBlockMatch) {
            markdown = codeBlockMatch[1];
        }

        // Append tags if provided
        if (tags && tags.length > 0) {
            markdown = markdown.trim();
            markdown += "\n\n## Tags\n\n";
            markdown += tags.map((tag) => `- ${tag}`).join("\n");
        }

        return {
            markdown: markdown.trim(),
            metadata: {
                inputLength: rawText.length,
                outputLength: markdown.length,
            },
        };
    }
}
