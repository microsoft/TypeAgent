// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    MultimodalPromptContent,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "node:url";

export type HtmlFragments = {
    frameId: string;
    content: string;
    text?: string;
    cssSelector?: string;
};

export interface ContentSection {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
    };
}

function getPrefixPromptSection() {
    return [
        {
            type: "text",
            text: "You are an AI assistant specialized in extracting structured knowledge from web page content.",
        },
    ];
}

function getSuffixPromptSection() {
    return [
        {
            type: "text",
            text: `
The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
`,
        },
    ];
}

async function getSchemaFileContents(fileName: string): Promise<string> {
    const packageRoot = path.join("..", "..", "..");
    return await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/knowledge/schema",
                    fileName,
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

export async function createKnowledgeTranslator(
    model:
        | "GPT_35_TURBO"
        | "GPT_4"
        | "GPT_v"
        | "GPT_4_O"
        | "GPT_4_O_MINI" = "GPT_4_O",
) {
    const knowledgeSchema = await getSchemaFileContents(
        "knowledgeExtraction.mts",
    );

    const agent = new KnowledgeAgent(
        knowledgeSchema,
        "KnowledgeExtractionResult",
        model,
    );
    return agent;
}

export class KnowledgeAgent {
    knowledgeSchema: string;
    model: TypeChatLanguageModel;
    translator: TypeChatJsonTranslator<any>;

    constructor(
        knowledgeSchema: string,
        schemaName: string,
        modelName: string,
    ) {
        this.knowledgeSchema = knowledgeSchema;

        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            modelName,
        );
        this.model = ai.createChatModel(apiSettings, undefined, undefined, [
            "knowledgeExtraction",
        ]);
        const validator = createTypeScriptJsonValidator<any>(
            this.knowledgeSchema,
            schemaName,
        );
        this.translator = createJsonTranslator(this.model, validator);
    }

    async extractKnowledge(
        textContent: string,
        title: string,
        url: string,
        quality: string = "balanced",
        extractEntities: boolean = true,
        extractRelationships: boolean = true,
        suggestQuestions: boolean = true,
    ) {
        const maxContentLength = this.getMaxContentLength(quality);
        const truncatedContent =
            textContent.length > maxContentLength
                ? textContent.substring(0, maxContentLength) + "..."
                : textContent;

        const entityCount =
            quality === "fast"
                ? "5-10"
                : quality === "balanced"
                  ? "10-20"
                  : "20-50";
        const topicCount =
            quality === "fast"
                ? "3-5"
                : quality === "balanced"
                  ? "5-8"
                  : "8-12";
        const questionCount = suggestQuestions
            ? quality === "fast"
                ? "3-5"
                : quality === "balanced"
                  ? "5-8"
                  : "8-12"
            : "0";

        const promptSections = [
            ...getPrefixPromptSection(),
            {
                type: "text",
                text: `
Extract structured knowledge from this web page content and return a valid JSON object matching the KnowledgeExtractionResult schema.

URL: ${url}
Title: ${title}

Content:
'''
${truncatedContent}
'''

Guidelines:
- Extract ${entityCount} most important entities if extractEntities is true
- Entity types: Person, Organization, Technology, Concept, Product, Service, Location, Event, etc.
- Extract relationships between entities if extractRelationships is true
- Relationship types: describes, uses, implements, creates, manages, located_in, part_of, etc.
- Include ${topicCount} key topics that summarize the main themes
- Generate ${questionCount} relevant questions about the content if suggestQuestions is true
- Confidence scores: 0.0-1.0 based on clarity and relevance in the text
- Provide a brief summary of the page content

Use the following TypeScript schema:

'''
${this.translator.validator.getSchemaText()}
'''
`,
            },
            ...getSuffixPromptSection(),
        ];

        const response = await this.translator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);

        return response;
    }

    async answerQuery(
        query: string,
        relevantContent: any[],
        relatedEntities: any[],
    ) {
        const prompt = `
Based on the following web content from the user's browsing history, answer this question: "${query}"

Available content:
${relevantContent
    .map(
        (content, index) => `
**Source ${index + 1}: ${content.title}** (${content.url})
${content.summary ? `Summary: ${content.summary}` : ""}
Content: ${content.content}
Key entities: ${content.entities.map((e: any) => e.name).join(", ")}
---`,
    )
    .join("\n")}

${
    relatedEntities.length > 0
        ? `
Related entities from knowledge graph: ${relatedEntities.map((e: any) => e.name).join(", ")}
`
        : ""
}

Instructions:
- Provide a comprehensive answer based on the available content
- Reference specific sources when possible
- If the content doesn't fully answer the question, say so
- Be concise but informative
- Use a natural, conversational tone
- If multiple sources provide different information, acknowledge the differences

Answer:`;

        const response = await this.model.complete(prompt);
        return response.success ? response.data : "Error generating response";
    }

    private getMaxContentLength(quality: string): number {
        switch (quality) {
            case "fast":
                return 2000;
            case "balanced":
                return 4000;
            case "deep":
                return 8000;
            default:
                return 4000;
        }
    }
}
